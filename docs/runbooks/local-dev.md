# Local Development Runbook

Goal: a fresh clone runs end-to-end on Docker Postgres in ~5 minutes — no AWS, no real API keys required.

## Prerequisites

- Node.js ≥ 22 (`node --version`)
- pnpm ≥ 10 (`npm install -g pnpm@latest`)
- Docker Desktop running

## Bootstrap

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Bring up local Postgres + pgvector
pnpm db:up

# 3. Create the local .env from the template
cp .env.example .env   # only if .env is missing

# .env.example ships DATABASE_URL blank, and a blank value fails with no useful error.
# Set it to the docker-compose credentials (note port 5433, not 5432):
#   DATABASE_URL=postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable

# 4. Build the schema with the MIGRATION path — not `db push`. See the warning below.
pnpm db:generate
pnpm db:migrate

# 5. Seed sample data (3 students, 11 aliases, 2 donors, 3 gifts, 4 finance snapshots)
pnpm db:seed

# 6. Build the MCP server — REQUIRED before `pnpm test`, not just for running the server.
#    The integration suite spawns `apps/mcp-server/dist/index.js`; without it you get
#    the unhelpful failure `RPC initialize timed out`.
pnpm --filter @lp-ai/mcp-server build

# 7. Verify — expect 131 passed, 0 skipped, 10 files
pnpm -r typecheck
pnpm test
```

> **Use `pnpm db:migrate`, never `pnpm --filter @lp-ai/lib-db push`.**
>
> This runbook previously said to use `db push`. Two reasons that was wrong:
>
> 1. **`db push` runs no migration SQL**, so none of the `tool_permissions` seed rows land. The ACL
>    registry (`apps/mcp-server/src/permissions.ts`) **fails closed** — a tool with no row is denied
>    to everyone, including admin. A `db push` environment therefore returns `permission_denied` for
>    every tool call, which looks like a broken server rather than an empty table.
> 2. **`db push` hides schema/migration drift.** It diff-syncs from `schema.prisma` and writes no
>    migration file, which is exactly how two tables ended up in `schema.prisma` with no migration
>    creating them. See `packages/grants/CHANGELOG.md`, 2026-08-03.
>
> `db:migrate` is also how production builds its schema, so a local environment built this way is
> production-equivalent. Reserve `db push` for throwaway experiments you intend to delete.

## Running the apps

### HQ dashboard
```bash
pnpm --filter @lp-ai/hq dev          # http://localhost:3000
```

If HQ logs `MissingSecret` or Prisma attempts to connect with mock credentials, start HQ with explicit local env vars:

```bash
AUTH_SECRET=local-dev-secret-not-for-production-use-only \
DATABASE_URL='postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable' \
pnpm --filter @lp-ai/hq dev
```

Then validate:

```bash
curl http://localhost:3000/api/health
```

The dashboard reads from local Postgres. Sign-in is gated by Google OAuth + domain check; the middleware will redirect you to `/auth/signin`. For local dev you can either:
- Bypass the middleware temporarily, or
- Create a Google OAuth client (see `docs/setup/08-hq-dashboard.md`) and fill in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` in `.env`.

### MCP server (stdio — for Claude Desktop)
```bash
pnpm --filter @lp-ai/mcp-server build
pnpm --filter @lp-ai/mcp-server start
```

Point Claude Desktop at the built `dist/index.js` (see `docs/setup/07-mcp-server.md`).

### MCP server (HTTP — for the ECS Fargate deployment / local testing)
```bash
pnpm --filter @lp-ai/mcp-server build
pnpm --filter @lp-ai/mcp-server start:http   # http://localhost:8080
```

Probe it:
```bash
curl http://localhost:8080/health
curl -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

If `SYNC_SECRET` is set in `.env`, the `/mcp` endpoint requires `Authorization: Bearer <SYNC_SECRET>`.

## Connectors

Each connector exposes a CLI:
```bash
pnpm sync:sheets       # google-sheets (live — 12 syncs)
pnpm sync:aplos        # aplos (live)
pnpm sync:notion       # notion meeting transcripts (live)
pnpm sync:drive        # google-drive (Grants catalog discovery)
pnpm sync:slack        # slack (skeleton)
```

Live connectors sync real data when credentials are set. Skeleton connectors return `status: "noop"`. Each run writes a row to `sync_runs` — visible in HQ at `/sync`.

## Smoke-test the full pipeline

After seed:
```bash
# 1. Stdio MCP: resolve a Slack handle to a student record
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_student_info","arguments":{"student_name":"@maria.g"}}}' \
  | node apps/mcp-server/dist/index.js | tail -1

# 2. HQ health endpoint
curl http://localhost:3000/api/health

# 3. Watch usage_logs populate
psql "$DATABASE_URL" -c "SELECT tool_name, duration_ms, called_at FROM usage_logs ORDER BY called_at DESC LIMIT 5;"
```

## Building & deploying the app images

Production images are built and deployed by **GitHub Actions** (`.github/workflows/deploy.yml`) — auto on push to `master`, or manually with `gh workflow run deploy.yml -f services=hq`. You do not build or push images by hand for local development; `pnpm dev` runs the apps directly against the local Postgres.

## Common operations

| Task | Command |
|---|---|
| Reset local DB | `pnpm db:down && pnpm db:up && pnpm db:migrate && pnpm db:seed` |
| Re-seed a DB that already has rows | `cd packages/db && SEED_FORCE=true node --env-file=../../.env dist/seed-cli.js` |
| Open Prisma Studio (GUI) | `pnpm db:studio` |
| Tail Postgres logs | `docker logs -f lp-internal-postgres` |
| Run a single test file | `pnpm exec vitest run packages/db/src/entity-resolution.test.ts` |
| Rebuild Prisma client after schema change | `pnpm db:generate` then `pnpm db:migrate` |
| Check migration state | `pnpm exec prisma migrate status --config ./prisma.config.ts` |

**On re-seeding.** `pnpm db:seed` is guarded: if `students` or `donor_contacts` already hold rows it
no-ops and reports `{"studentsInserted":0,"donorsInserted":0}`. That is the guard working, not a
failure. Use `SEED_FORCE=true` to wipe and rebuild the sample data.

**A full `pnpm test` run leaves `students` empty.** `packages/db/src/entity-resolution.test.ts` wipes
students, staff, and aliases in a `beforeEach` for isolation and does not re-seed afterwards. This is
expected. Re-seed with `SEED_FORCE=true` if you want the sample data back for manual poking.

## Known things that won't work without credentials

- `pnpm sync:drive` — requires `GOOGLE_SERVICE_ACCOUNT_JSON` (creds available but connector is skeleton)
- `pnpm sync:slack` — requires `SLACK_BOT_TOKEN`
- MCP tools that embed (`search_documents`, `search_conversations`, `search_by_person`) — require `OPENAI_API_KEY`
- AWS Secrets Manager fetch path — requires `USE_AWS_SECRETS=true` and an authenticated AWS environment
- Google OAuth sign-in to HQ — requires `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (or set `HQ_DEV_NO_AUTH=true`)

**Connectors that are live with credentials:** `sync:sheets`, `sync:aplos`, `sync:notion`.

Everything else above works against a clean clone.

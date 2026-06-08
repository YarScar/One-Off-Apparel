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

# 3. Create the local .env from the template (already exists if you cloned the repo)
cp .env.example .env   # only if .env is missing

# 4. Apply the schema to the local DB (uses prisma db push, non-interactive)
pnpm db:generate
pnpm --filter @lp-ai/lib-db push

# 5. Seed sample data (3 students, donors, certifications, finance)
pnpm db:seed

# 6. Verify
pnpm -r typecheck
pnpm test                   # 28 tests; entity-resolution + MCP integration suites need step 2 running
```

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
pnpm sync:sheets       # google-sheets
pnpm sync:drive        # google-drive
pnpm sync:bigquery     # bigquery
pnpm sync:givebutter   # givebutter
pnpm sync:aplos        # aplos
pnpm sync:slack        # slack
pnpm sync:roam         # roam
```

All currently return `status: "noop"` until their per-connector implementation lands. Each run writes a row to `sync_runs` — visible in HQ at `/sync`.

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

## Docker images

Production-shaped images are buildable today:
```bash
docker build -f apps/hq/Dockerfile -t lp-hq:dev .
docker build -f apps/mcp-server/Dockerfile -t lp-mcp:dev .
```

Run them against the same Docker Postgres:
```bash
docker run --rm -p 3001:3000 \
  --network lpinternalaiv1_default \
  -e DATABASE_URL=postgresql://lpapp:lpapp@lp-internal-postgres:5432/lpinternal?sslmode=disable \
  -e AUTH_SECRET=local-dev-secret-not-for-production-use-only \
  -e AUTH_TRUST_HOST=true \
  lp-hq:dev

docker run --rm -p 8091:8080 \
  --network lpinternalaiv1_default \
  -e DATABASE_URL=postgresql://lpapp:lpapp@lp-internal-postgres:5432/lpinternal?sslmode=disable \
  lp-mcp:dev
```

## Common operations

| Task | Command |
|---|---|
| Reset local DB | `pnpm db:down && pnpm db:up && pnpm --filter @lp-ai/lib-db push && pnpm db:seed` |
| Open Prisma Studio (GUI) | `pnpm db:studio` |
| Tail Postgres logs | `docker logs -f lp-internal-postgres` |
| Run a single test file | `pnpm test --run packages/db/src/entity-resolution.test.ts` |
| Rebuild Prisma client after schema change | `pnpm db:generate` then `pnpm --filter @lp-ai/lib-db push` |

## Known things that won't work without credentials

- `pnpm sync:sheets` / `:drive` — require `GOOGLE_SERVICE_ACCOUNT_JSON`
- `pnpm sync:bigquery` — requires Google service account + BigQuery access
- `pnpm sync:givebutter` — requires `GIVEBUTTER_API_KEY`
- `pnpm sync:aplos` — requires `APLOS_CLIENT_ID` + `APLOS_API_KEY`
- `pnpm sync:slack` — requires `SLACK_BOT_TOKEN`
- `pnpm sync:roam` — requires `ROAM_API_KEY` + `ROAM_GRAPH_NAME`
- MCP tools that embed (`search_documents`, `search_conversations`, `search_by_person`) — require `OPENAI_API_KEY`
- AWS Secrets Manager fetch path — requires `USE_AWS_SECRETS=true` and an authenticated AWS environment
- Google OAuth sign-in to HQ — requires `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`

Everything else above works against a clean clone.

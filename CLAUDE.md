# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An internal AI intelligence layer for Launchpad that lets team members query Claude with live organizational data — student profiles, program outcomes, certifications, competency scores, finances, donations, and communications. Built on a fully AWS-native stack. The system ingests data through seven connectors (Google Drive, Google Sheets, BigQuery, GiveButter, Aplos, Slack, Roam), stores it in Postgres + pgvector, and exposes it to Claude through an MCP server. A Next.js HQ dashboard provides sync status and operational visibility.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode throughout) |
| HQ App | Next.js 14 (App Router) |
| MCP Server | `@modelcontextprotocol/sdk` (stdio + Streamable HTTP transports) |
| AI Client | `@anthropic-ai/sdk` (Claude is the consumer of the MCP server, not embedded) |
| Embeddings | OpenAI `text-embedding-3-large` (1536 dimensions) |
| Structured DB | Postgres 16 via Prisma ORM (local Docker today, AWS RDS in production) |
| Vector search | pgvector extension |
| App hosting | AWS ECS Fargate (production); local Docker images built and verified |
| Cron / scheduling | AWS EventBridge |
| Secrets | AWS Secrets Manager (production); `.env` for local dev |
| Monitoring | Sentry |
| Auth | NextAuth v5 (Auth.js) + Google provider, gated to `@launchpadphilly.org` |
| UI | Tailwind (shadcn-style components inline) |
| Tests | Vitest (unit + live-DB integration + spawned MCP server integration) |
| CI | GitHub Actions with a pgvector service container |
| Monorepo | pnpm workspaces |

## Connectors

| Connector | Source | Destination | Status |
|---|---|---|---|
| `google-sheets` | Launchpad Dashboard + Outcomes sheets | Postgres | Skeleton — awaiting `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `google-drive` | Drive docs folder | Postgres + pgvector | Skeleton — awaiting `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `bigquery` | `lp-internal-ai` BigQuery project | Postgres | Skeleton — awaiting Google service account |
| `givebutter` | GiveButter donation platform | `donor_contacts`, `donor_gifts` | REST client implemented; awaiting `GIVEBUTTER_API_KEY` |
| `aplos` | Aplos nonprofit accounting | Postgres | Skeleton — awaiting `APLOS_CLIENT_ID` + `APLOS_API_KEY` |
| `slack` | Designated Slack channels | pgvector | Skeleton — awaiting `SLACK_BOT_TOKEN` |
| `roam` | Roam chat/messaging app | pgvector | Skeleton — awaiting `ROAM_API_KEY` |

Every connector exports `sync()` which calls `runSync('<name>', ...)` from `packages/db/src/sync-runs.ts` — each run lands in the `sync_runs` table and appears in the HQ `/sync` page.

## Commands

```bash
# First-time bootstrap
pnpm install
pnpm db:up                      # start Postgres + pgvector via Docker
pnpm db:generate                # generate Prisma client
pnpm db:push                    # apply schema (no migration file created)
pnpm db:seed                    # seed sample data

# Daily development
pnpm -r typecheck               # typecheck all packages
pnpm lint                       # lint all packages
pnpm test                       # run all tests (vitest run)
pnpm test:watch                 # run tests in watch mode

# Run a single test file
pnpm exec vitest run packages/db/src/entity-resolution.test.ts

# HQ dashboard
pnpm --filter @lp-ai/hq dev     # Next.js dev server at http://localhost:3000

# MCP server (development — hot-reload via node --watch)
pnpm --filter @lp-ai/mcp-server build     # compile TypeScript first
pnpm --filter @lp-ai/mcp-server dev       # stdio, hot-reload
pnpm --filter @lp-ai/mcp-server dev:http  # HTTP at :8080, hot-reload

# MCP server (production-like)
pnpm --filter @lp-ai/mcp-server start      # stdio (for Claude Desktop)
pnpm --filter @lp-ai/mcp-server start:http # HTTP at :8080 (for ECS / local testing)

# Connector syncs (noop until credentials are set)
pnpm sync:givebutter
pnpm sync:sheets && pnpm sync:drive && pnpm sync:bigquery
pnpm sync:aplos && pnpm sync:slack && pnpm sync:roam
pnpm sync:all                   # all connectors in parallel

# Database tools
pnpm db:studio                  # open Prisma Studio
pnpm db:migrate                 # deploy pending migrations (production)
pnpm --filter @lp-ai/lib-db migrate:dev  # create new migration file (dev)
pnpm db:down                    # stop Docker Postgres

# Production Docker images (run from repo root)
docker build -f apps/hq/Dockerfile -t lp-hq:dev .
docker build -f apps/mcp-server/Dockerfile -t lp-mcp:dev .
```

## Architecture

### Package graph

```
apps/hq              → @lp-ai/lib-db, @lp-ai/lib-config
apps/mcp-server      → @lp-ai/lib-db, @lp-ai/lib-config, @lp-ai/lib-embedding
connectors/*         → @lp-ai/lib-db, @lp-ai/lib-config
packages/db          → Prisma client, entity resolution, sync-runs helper, seed
packages/embedding   → OpenAI embedding batch/retry helpers
packages/config      → Zod env schema, AWS Secrets Manager loader
```

### Key files

- `packages/db/prisma/schema.prisma` — single source of truth for the DB schema; Prisma client is generated to `packages/db/generated/prisma/` (non-standard path)
- `prisma.config.ts` (repo root) — Prisma config pointing at the schema and migrations
- `packages/db/src/entity-resolution.ts` — fuzzy name matching across all data sources; called by `get_student_info` and `search_by_person`
- `packages/db/src/sync-runs.ts` — `runSync()` wrapper used by every connector
- `apps/mcp-server/src/make-server.ts` — registers all 14 tools; edit here to add/remove tools
- `apps/mcp-server/src/tool-helpers.ts` — `runTool()` wrapper (error capture + usage logging), `parseStr()`, `parseNum()`
- `apps/mcp-server/src/errors.ts` — `toolError()` and `notImplemented()` for structured error envelopes
- `apps/mcp-server/src/usage-log.ts` — writes every tool call to `usage_logs` table; surfaced in HQ `/tools`
- `apps/hq/auth.ts` + `apps/hq/auth.config.ts` — NextAuth v5 config; domain restricted to `AUTH_ALLOWED_DOMAIN`
- `apps/hq/middleware.ts` — gates all routes except `/auth/signin`, `/api/auth`, `/api/health`

### HQ dashboard routes

| Route | Purpose |
|---|---|
| `/` | Data freshness overview |
| `/sync` | Connector sync run history (`sync_runs` table) |
| `/tools` | MCP tool call log (`usage_logs` table) |
| `/aws-jobs` | AWS EventBridge job details |
| `/api/health` | Unauthenticated health check |
| `/auth/signin` | Google OAuth sign-in (whitelisted from auth middleware) |

### Adding a new MCP tool

1. Create `apps/mcp-server/src/tools/<tool-name>.ts` — export `registerXxx(server: McpServer): void`
2. Inside, call `server.registerTool(NAME, { description, inputSchema }, (input) => runTool(NAME, input, async () => { ... }))`
3. Use `toolError(code, message)` or `notImplemented(NAME)` for structured error returns
4. Import and call `registerXxx(server)` in `apps/mcp-server/src/make-server.ts`
5. Update the count in `apps/mcp-server/src/__tests__/tools.test.ts` and add the tool name to the expected list

### Implementing a connector

All connectors follow the same pattern:

```ts
export async function sync(): Promise<SyncRunRecord> {
  return runSync('connector-name', async () => {
    const env = await loadEnv();
    if (!env.REQUIRED_KEY) return { status: 'noop', notes: 'key not set' };
    // ... upsert records into Prisma ...
    return { status: 'ok', recordsUpserted: n };
  });
}
```

The `runSync` wrapper creates the `sync_runs` row, captures errors, and records duration. See `connectors/givebutter/src/index.ts` as the reference implementation.

## Environment Variables

Only `DATABASE_URL` is required at startup; all other keys are validated at call sites. Local `.env` points `DATABASE_URL` at Docker Postgres (`postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable`).

In production, set `USE_AWS_SECRETS=true` to have `loadEnv()` (from `@lp-ai/lib-config`) fetch secrets from AWS Secrets Manager under the `lp-internal/` prefix instead of reading `.env`.

Full env schema is in `packages/config/src/schema.ts`. See [docs/runbooks/credentials-checklist.md](docs/runbooks/credentials-checklist.md) for what each key unlocks.

## Coding Conventions

- **TypeScript strict mode** — no `any`, explicit return types on all exported functions, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- **Named exports only** — no default exports
- **Prisma** for all Postgres queries; `$queryRaw` / `$queryRawUnsafe` only for pgvector cosine similarity (`<=>`) and `percentile_cont`
- **Zod schemas** for all external data (API responses, tool inputs) and env validation
- **Error handling** — MCP tools return `{ error: { code, message } }` envelopes via `toolError()`; connectors throw and let `runSync` capture into the `sync_runs` row
- **Environment variables** — always via the typed `env` object from `@lp-ai/lib-config`, never `process.env` directly in business logic
- **Tests** — live-DB tests are gated on `DATABASE_URL` containing `localhost` and skipped elsewhere; integration tests spawn the actual MCP server binary via `McpStdioClient`

## Spec Documents

Before modifying any component, read the relevant spec:

- [Architecture](docs/architecture.md) — system overview and data flow
- [Database Schema](docs/database-schema.md) — all Postgres tables
- [MCP Server Spec](docs/mcp-server-spec.md) — all 14 tool definitions with input/output schemas
- [Entity Resolution](docs/entity-resolution.md) — how students/staff are resolved across sources
- Per-connector specs in `docs/data-sources/`

## Setup

New to this project?
1. Read this file end-to-end.
2. Follow [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) to get a working clone.
3. See [docs/runbooks/credentials-checklist.md](docs/runbooks/credentials-checklist.md) for what each API key unlocks and how to obtain it.
4. Phase-numbered AWS / production setup guides are in [docs/setup/](docs/setup/README.md).

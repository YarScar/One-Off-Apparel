# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Slimmed 2026-08-20 to cut per-request context — how-to detail lives in project skills (`add-mcp-tool`,
`implement-connector`) and loads only when used.

## Work Tracking — OpenProject is mandatory

**Every piece of work on this project must be associated with an OpenProject work package.** This
covers work in progress, work planned, and work committed. If a change relates to this project
directly, it has a work package; if it does not have one, create one before starting.

| | |
|---|---|
| Instance | `https://projects.liftofflearning.tech` |
| Project identifier | `internal-ai-integrations` |
| API docs | https://www.openproject.org/docs/api/ |
| Credential | `OPENPROJECT_API_KEY` in `.env` — HTTP Basic, username literal `apikey`, password the key |

What this means in practice:

- **Before starting work**, find the work package that covers it, or create one. Set it to *In
  progress* when you begin.
- **Commit messages reference the work package** — `refs #<id>` in the body (OpenProject parses this
  and links the commit to the work package). Use `closes #<id>` when the commit finishes it.
- **Discovered work gets its own work package**, related to the one you found it from, rather than
  being folded silently into the current change.
- **Close the work package** when the work is done and verified, with a comment saying what landed.
- **Exception:** incidental local housekeeping that touches nothing in the repo — scratch files,
  local tooling, environment setup on your own machine. Everything that produces a commit here is in
  scope.

Never read, print, or otherwise ingest `.env` itself. Reference `OPENPROJECT_API_KEY` through the
environment.

## What This Is

An internal AI intelligence layer for Launchpad that lets team members query Claude with live organizational data — student profiles, program outcomes, certifications, competency scores, finances, donations, and communications. Built on a fully AWS-native stack. The system ingests data through six connectors (Google Sheets, Google Drive, Aplos, Slack, Notion, plus a sync task runner), stores it in Postgres + pgvector, and exposes it to Claude through an MCP server. A Next.js HQ dashboard provides sync status and operational visibility.

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
| App hosting | AWS ECS Fargate (production); images built & deployed by GitHub Actions (deploy.yml) |
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
| `google-sheets` | Launchpad Dashboard + Outcomes sheets (12 spreadsheets) | Postgres | ✅ Live — all 12 sheet syncs ported; 27K+ records ingested |
| `google-drive` | Drive `Grants` tree | `grant_documents` catalog (no text, no embeddings) | ✅ Live locally — 1253 files catalogued, 1248 with a Drive ID; verified end to end against real Drive. **Production auth unverified** (the service account has no access to the tree) |
| `aplos` | Aplos nonprofit accounting | `finance_snapshots` (accounts, funds, transactions) | ✅ Live — RSA-decryption auth; 16K+ records; synced daily in production via EventBridge |
| `notion` | Notion meeting transcripts database | `document_chunks` (pgvector) | ✅ Live — meeting transcript sync with embeddings |
| `slack` | Designated Slack channels | pgvector | Skeleton — awaiting `SLACK_BOT_TOKEN` |

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

# Connector syncs
pnpm sync:sheets                # google-sheets (live)
pnpm sync:aplos                 # aplos (live)
pnpm sync:notion                # notion meeting transcripts (live)
pnpm sync:drive                 # google-drive (Grants catalog discovery)
pnpm sync:slack                 # slack (skeleton — awaiting SLACK_BOT_TOKEN)
pnpm sync:all                   # all connectors in parallel

# Production sync schedule (EventBridge → ECS Fargate)
# google-sheets: rate(1 hour) — lp-sync-google-sheets task
# aplos:         cron(30 3 * * ? *) — lp-sync-aplos task
# To trigger a one-off sync in production:
#   AWS_PROFILE=lp-internal aws ecs run-task --cluster lp-internal \
#     --task-definition lp-sync-google-sheets:1 --launch-type FARGATE ...

# Deploy: GitHub Actions builds the image (Buildx) and ships via the lp-github-deploy OIDC rule.
# See .github/workflows/deploy.yml. Auto-deploys on push to main (CI-gated); manual:
#   gh workflow run deploy.yml -f services=hq   (or all|mcp-server|aws-mcp-server|sync)
# Task definitions live in infra/ecs/*-taskdef.json; the workflow pins the image to the commit SHA.

# Database tools
pnpm db:studio                  # open Prisma Studio
pnpm db:migrate                 # deploy pending migrations (production)
pnpm --filter @lp-ai/lib-db migrate:dev  # create new migration file (dev)
pnpm db:down                    # stop the local Postgres container
```

**Migrations — do not touch the deploy ordering.** Since 2026-08-18 the workflow's `migrate` job runs
a one-off task pinned to the image the `build-mcp-server` job just registered (commit-SHA-pinned
`--task-definition`), and fails unless the image's applied-migration count matches the repo's.
**Do not unpin `--task-definition`, do not move `build-mcp-server` after `migrate`.** Before that fix,
`migrate` ran unpinned against the *previous* release's image and migrations lagged exactly one deploy
(#295). Any green `migrate` job from before 2026-08-18 does not prove that commit's migration ran.

## Architecture

### Package graph

```
apps/hq              → @lp-ai/lib-db, @lp-ai/lib-config
apps/mcp-server      → @lp-ai/lib-db, @lp-ai/lib-config, @lp-ai/lib-embedding, @lp-ai/lib-grants
apps/aws-mcp-server  → @lp-ai/lib-db, @lp-ai/lib-config
apps/sync            → connectors/* (one-off Fargate task runner for scheduled syncs)
connectors/*         → @lp-ai/lib-db, @lp-ai/lib-config
packages/db          → Prisma client, entity resolution, sync-runs helper, seed
packages/embedding   → OpenAI embedding batch/retry helpers
packages/config      → Zod env schema, AWS Secrets Manager loader
packages/grants      → zod; deterministic grant-writing logic + seed (question bank, KB, form fixtures)
```

### Key files

- `packages/db/prisma/schema.prisma` — single source of truth for the DB schema; Prisma client is generated to `packages/db/generated/prisma/` (non-standard path)
- `prisma.config.ts` (repo root) — Prisma config pointing at the schema and migrations
- `packages/db/src/entity-resolution.ts` — fuzzy name matching across all data sources; called by `get_student_info` and `search_by_person`
- `packages/db/src/sync-runs.ts` — `runSync()` wrapper used by every connector
- `apps/mcp-server/src/make-server.ts` — registers all tools; edit here to add/remove tools. Verify with `grep -c "NAME = '" apps/mcp-server/src/tools/*.ts | awk -F: '{s+=$2} END {print s}'` rather than trusting a number
- `apps/mcp-server/src/tool-helpers.ts` — `runTool()` wrapper (error capture + usage logging), `parseStr()`, `parseNum()`
- `apps/mcp-server/src/errors.ts` — `toolError()` and `notImplemented()` for structured error envelopes
- `apps/mcp-server/src/usage-log.ts` — writes every tool call to `usage_logs` table; surfaced in HQ `/tools`
- `apps/hq/auth.ts` + `apps/hq/auth.config.ts` — NextAuth v5 config; domain restricted to `AUTH_ALLOWED_DOMAIN`
- `apps/hq/middleware.ts` — gates all routes except `/auth/signin`, `/api/auth`, `/api/health`, `/aws-jobs`, `/api/aws-jobs`; supports `HQ_DEV_NO_AUTH=true` bypass for local dev

### HQ dashboard routes

| Route | Purpose |
|---|---|
| `/` | Data freshness overview |
| `/dashboard` | Analytic dashboard (enrollment, attendance, finances, donors) |
| `/sync` | Connector sync run history (`sync_runs` table) |
| `/tools` | MCP tool call log (`usage_logs` table) |
| `/admin` | MCP OAuth user/role management + tool permissions |
| `/aws-jobs/[id]` | AWS resource job details (approval workflow) |
| `/api/health` | Unauthenticated health check |
| `/auth/signin` | Google OAuth sign-in (whitelisted from auth middleware) |

### How-tos live in skills

- **Adding / renaming / removing an MCP tool** → invoke the `add-mcp-tool` skill. It covers the
  `registerTool` call + annotations, `make-server.ts` wiring, the tool-count test, and the
  `tool_permissions` migration + admin-page category step (including the **`DO UPDATE`, never
  `DO NOTHING`** rule and the new-category step).
- **Implementing or changing a connector** → invoke the `implement-connector` skill. It covers the
  `sync()` + `runSync()` wrapper shape, the noop-when-key-missing pattern, and declaring tables for
  the 5% integrity guard.

**The critical sync safety rule, which applies regardless:** NEVER use `deleteMany({})` or `TRUNCATE`
before inserting data. If the sync crashes midway, the table is left empty with no recovery. Instead:
1. **Upsert** every row using a stable `sourceId` (platform ID or composite natural key — never row numbers)
2. **Track** which sourceIds were seen during this run
3. **After all upserts succeed**, delete only rows whose sourceId was NOT seen
4. If the sync fails at any point, existing data is untouched

See `connectors/google-sheets/src/sync-employment.ts` as the reference for the upsert + stale-cleanup pattern.

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
- [MCP Server Spec](docs/mcp-server-spec.md) — tool definitions with input/output schemas
- [Entity Resolution](docs/entity-resolution.md) — how students/staff are resolved across sources
- Per-connector specs in `docs/data-sources/`

The grant writing layer keeps its own document set, scoped to that workstream — start at
[`packages/grants/README.md`](packages/grants/README.md). Two of its files are worth knowing about
from outside it, because the grant work landed platform-wide changes and recorded them there:

- [Changelog](packages/grants/CHANGELOG.md) — material changes that workstream landed, including schema, tool surface, and corrections to documented procedures
- [Documentation conventions](packages/grants/CLAUDE.md) — sources of truth, current verified state, and documentation debt (detail lives in [`packages/grants/docs/STATE.md`](packages/grants/docs/STATE.md))

## Setup

New to this project?
1. Read this file end-to-end.
2. Follow [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) to get a working clone.
3. See [docs/runbooks/credentials-checklist.md](docs/runbooks/credentials-checklist.md) for what each API key unlocks and how to obtain it.
4. Phase-numbered AWS / production setup guides are in [docs/setup/](docs/setup/README.md).

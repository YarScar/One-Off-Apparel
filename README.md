# LP Internal AI — V1

An internal AI intelligence layer for Launchpad that lets team members query Claude with live organizational data — student records, program outcomes, certifications, competency scores, finances, donations, and communications.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Folder Structure](#folder-structure)
- [Workspace Packages](#workspace-packages)
- [Getting Started](#getting-started)
- [Onboarding Resources](#onboarding-resources)
- [Package Management](#package-management)
- [MCP Tools](#mcp-tools)
- [Connectors](#connectors)
- [Current Status](#current-status)

---

## System Architecture

Four logical layers: **data sources → connectors → storage → MCP server + Claude**, with the HQ dashboard running alongside.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                │
│                                                                     │
│  Google Sheets   Google Drive   BigQuery   GiveButter   Aplos       │
│  (students,      (docs, notes,  (BI data)  (donations)  (accounting)│
│   outcomes,       student info)                                     │
│   attendance,                             Slack         Roam        │
│   finances)                               (channels)    (chat)      │
└───────────────────────┬─────────────────────────────────────────────┘
                        │  scheduled syncs (AWS EventBridge)
                        │  manual: pnpm sync:<name>
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CONNECTORS  (7)                                 │
│                                                                     │
│  Each connector runs sync() → calls runSync() → writes to          │
│  sync_runs table. Errors are captured; HQ dashboard shows status.  │
│                                                                     │
│  google-sheets  google-drive  bigquery  givebutter  aplos           │
│  slack          roam                                                │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        STORAGE                                      │
│                                                                     │
│  Postgres 16 (AWS RDS / local Docker)                               │
│  ├── Structured tables (Prisma ORM)                                 │
│  │     students, staff, entity_aliases                              │
│  │     student_phase_outcomes, student_certifications               │
│  │     attendance_records, enrollment_snapshots                     │
│  │     finance_snapshots, aplos_transactions                        │
│  │     donor_contacts, donor_gifts, donor_pipeline                  │
│  │     sync_runs, usage_log                                         │
│  └── Vector store (pgvector extension)                              │
│        document_chunks  ←  OpenAI text-embedding-3-large            │
│        (Google Drive docs + Slack + Roam → 1536-dim embeddings)     │
│                                                                     │
│  Entity Resolution: entity_aliases table deduplicates the same     │
│  person across all sources using exact + fuzzy (pg_trgm) matching. │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   MCP SERVER  (14 tools)                            │
│                                                                     │
│  Exposes structured Prisma queries + pgvector semantic search       │
│  as Model Context Protocol tools.                                   │
│                                                                     │
│  Transport A: stdio  → Claude Desktop (local)                       │
│  Transport B: Streamable HTTP → AWS ECS Fargate behind ALB (production) │
│                                                                     │
│  All tool calls are logged to usage_log for adoption tracking.      │
│  All tools return structured { error: { code, message } } on fail. │
└───────────────────────┬─────────────────────────────────────────────┘
                        │  MCP protocol
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CLAUDE (Anthropic)                               │
│                                                                     │
│  Receives tool definitions + calls tools at query time.            │
│  Composes answers from structured data + semantic search results.   │
│  Team members interact via Claude Desktop or any MCP-capable client.│
└─────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   HQ DASHBOARD       │
                    │   (Next.js 14)       │
                    │                      │
                    │  /        freshness  │
                    │  /sync    sync runs  │
                    │  /tools   tool logs  │
                    │                      │
                    │  Auth: NextAuth v5   │
                    │  Google OAuth        │
                    │  @launchpadphilly.org│
                    └──────────────────────┘
```

At query time, Claude calls MCP tools → the server runs Prisma queries or pgvector similarity search → results are returned and synthesized into a natural-language answer. At sync time, EventBridge (or `pnpm sync:<name>`) triggers a connector → it upserts rows via Prisma and, for document sources, generates embeddings via OpenAI → every run writes a result to `sync_runs`.

---

## Tech Stack

### Application layer

| Concern | Technology | Notes |
|---|---|---|
| Language | TypeScript 5 (strict) | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Monorepo | pnpm workspaces | 15 workspace packages |
| HQ Dashboard | Next.js 14 (App Router) | Standalone Docker image |
| Auth | NextAuth v5 (Auth.js) | Google OAuth, domain-gated to `@launchpadphilly.org` |
| MCP Server | `@modelcontextprotocol/sdk` | stdio + Streamable HTTP transports |
| Embeddings | OpenAI `text-embedding-3-large` | 1536 dimensions, batch + retry helpers |
| ORM | Prisma | All queries; `$queryRaw` only for pgvector + `percentile_cont` |
| Database | Postgres 16 + pgvector + pg_trgm | Local Docker; AWS RDS in production |
| Validation | Zod | All external data and env vars |
| Tests | Vitest | Unit + live-DB integration + spawned MCP server integration |
| CI | GitHub Actions | pgvector service container; full suite on every push |

### Infrastructure & tooling

| Concern | Technology |
|---|---|
| App hosting | AWS ECS Fargate behind ALB |
| Scheduling | AWS EventBridge |
| Secrets | AWS Secrets Manager (prod) / `.env` (local) |
| Monitoring | Sentry |
| BI dashboards | Metabase (self-hosted on AWS) |
| Workflow automation | n8n (self-hosted on AWS) |
| Data warehouse | Athena over S3 |
| Ingestion tooling | Airbyte (self-hosted; future non-Sheets sources) |

---

## Folder Structure

```
lp-internal-ai-v1/
├── apps/
│   ├── hq/                          # Next.js 14 HQ dashboard
│   │   ├── app/
│   │   │   ├── page.tsx             # / — data freshness overview
│   │   │   ├── sync/page.tsx        # /sync — connector sync run history
│   │   │   ├── tools/page.tsx       # /tools — MCP tool call log
│   │   │   └── api/health/route.ts  # GET /api/health (unauthenticated)
│   │   ├── auth.ts                  # NextAuth v5 config + Google provider
│   │   ├── middleware.ts            # Route guard
│   │   └── Dockerfile
│   └── mcp-server/                  # MCP server — 14 tools
│       ├── src/
│       │   ├── index.ts             # Entry: stdio (Claude Desktop)
│       │   ├── serve-http.ts        # Entry: Streamable HTTP (ECS Fargate)
│       │   ├── make-server.ts       # Tool registration
│       │   ├── usage-log.ts         # Logs every tool call
│       │   └── tools/               # One file per MCP tool (14 files)
│       └── Dockerfile
├── packages/
│   ├── db/                          # @lp-ai/lib-db — Prisma client, schema, seed
│   ├── config/                      # @lp-ai/lib-config — typed env loader
│   └── embedding/                   # @lp-ai/lib-embedding — OpenAI batch helpers
├── connectors/                      # One package per source (7 total)
│   ├── givebutter/                  # ← REST client implemented
│   └── google-sheets|drive|bigquery|aplos|slack|roam/   # skeletons
├── infra/
│   ├── postgres-init/               # SQL: CREATE EXTENSION pgvector, pg_trgm
│   └── iam/                         # AWS IAM policy templates
├── docs/
│   ├── architecture.md              # Detailed system overview
│   ├── database-schema.md           # All 18 tables with columns + indexes
│   ├── mcp-server-spec.md           # All 14 tool definitions (input/output schemas)
│   ├── entity-resolution.md         # Cross-source deduplication strategy
│   ├── setup/                       # Phase-by-phase AWS setup guides (00–21)
│   ├── runbooks/                    # local-dev.md, credentials-checklist.md, aws-permissions.md
│   ├── decisions/                   # Architecture Decision Records
│   └── data-sources/                # Per-connector specs
├── docker-compose.yml               # Local Postgres 16 + pgvector
├── vitest.config.ts
├── tsconfig.base.json               # Shared TS config (ES2022, NodeNext, strict)
├── pnpm-workspace.yaml              # Workspace roots: apps/*, packages/*, connectors/*
├── package.json                     # Root scripts: db:*, sync:*, build, test
└── .env.example                     # Authoritative inventory of all env variables
```

---

## Workspace Packages

pnpm resolves `workspace:*` references to local source at install time — no publishing required. Build order follows this graph:

```
@lp-ai/lib-config          (no internal deps)
@lp-ai/lib-db              (no internal deps)
@lp-ai/lib-embedding       (no internal deps)
      │
      ├── @lp-ai/connector-google-sheets   → lib-config, lib-db
      ├── @lp-ai/connector-bigquery        → lib-config, lib-db
      ├── @lp-ai/connector-givebutter      → lib-config, lib-db
      ├── @lp-ai/connector-aplos           → lib-config, lib-db
      ├── @lp-ai/connector-google-drive    → lib-config, lib-db, lib-embedding
      ├── @lp-ai/connector-slack           → lib-config, lib-db, lib-embedding
      ├── @lp-ai/connector-roam            → lib-config, lib-db, lib-embedding
      ├── @lp-ai/hq                        → lib-config, lib-db
      ├── @lp-ai/mcp-server                → lib-config, lib-db, lib-embedding
      └── @lp-ai/aws-mcp-server            → lib-config, lib-db
```

---

## Getting Started

> Full walkthrough: [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) — Credential requirements: [docs/runbooks/credentials-checklist.md](docs/runbooks/credentials-checklist.md)

**Prerequisites:** Node ≥ 20, pnpm ≥ 9, Docker Desktop running.

```bash
pnpm install                                              # all 15 packages
cp .env.example .env                                      # fill in values you have
pnpm db:up                                                # start Postgres + pgvector
pnpm db:generate                                          # generate Prisma client
pnpm --filter @lp-ai/lib-db push --skip-generate          # apply schema
pnpm db:seed                                              # 3 students, donors, finance, certs

pnpm -r typecheck && pnpm test                            # verify: 31 tests

pnpm --filter @lp-ai/hq dev                               # HQ → http://localhost:3000
pnpm --filter @lp-ai/mcp-server build
pnpm --filter @lp-ai/mcp-server start                     # MCP stdio (Claude Desktop)
pnpm --filter @lp-ai/mcp-server start:http                # MCP HTTP → http://localhost:8080
```

Only `DATABASE_URL` is required to boot — it defaults to the local Docker Postgres in `.env.example`. All API keys are optional at load time and validated at first use.

---

## Onboarding Resources

- New contributor checklist: [docs/reference/new-developer-playbook.md](docs/reference/new-developer-playbook.md)
- Connector maturity and verification map: [docs/reference/connector-capability-matrix.md](docs/reference/connector-capability-matrix.md)
- Skills workflow reference: [HOW-SKILLS-WORK.md](HOW-SKILLS-WORK.md)

---

## Package Management

All commands run from the **repository root**. Never use `npm` or `yarn`.

### Installing dependencies

```bash
# Add to a specific workspace
pnpm add <package> --filter @lp-ai/<name>
pnpm add -D <package> --filter @lp-ai/<name>

# Add to root (shared tooling only: vitest, eslint, prettier, typescript, prisma CLI)
pnpm add -D -w <package>
```

### Updating dependencies

```bash
pnpm update -r --interactive              # interactive update across all packages
pnpm update -r <package>                  # update one package everywhere
pnpm update --filter @lp-ai/<name>        # update all deps in one workspace
```

After updating, commit all changed `package.json` files and `pnpm-lock.yaml` together.

### Removing dependencies

```bash
pnpm remove <package> --filter @lp-ai/<name>
```

### Adding a new internal dependency

Add the `workspace:*` reference manually in the consuming package's `package.json`, then run `pnpm install`:

```jsonc
// e.g. connectors/givebutter/package.json
{
  "dependencies": {
    "@lp-ai/lib-config": "workspace:*",
    "@lp-ai/lib-db": "workspace:*"
  }
}
```

### After editing the Prisma schema

```bash
pnpm db:generate                                          # regenerate Prisma client
pnpm --filter @lp-ai/lib-db push --skip-generate          # local dev (no migration file)
pnpm db:migrate                                           # production/staging (tracked migration)
```

Use `push` for local iteration. Use `migrate` for any change that must be tracked and replayed on the production RDS instance.

---

## MCP Tools

All tools return structured JSON. Errors use `{ error: { code, message } }`.

| Tool | Description |
|---|---|
| `get_student_info` | Student profile + aliases from Google Drive seed doc |
| `get_entity_brief` | Composite: profile + phase progression + certs + recent mentions + donor history |
| `get_finance_brief` | Composite: budget summary + actuals + grants + giving pipeline |
| `query_students` | Population stats + filtered student lists |
| `query_outcomes` | Phase progression (Foundations → 101 → Lightspeed → LiftOff) |
| `query_enrollment` | Enrollment stats by phase, school, cohort, race |
| `query_certifications` | PCEP exam results and scores |
| `query_competency` | Per-student Beacon competency scores |
| `query_attendance` | Unified attendance across three cohort formats |
| `query_finances` | Budgets, actuals, forecasts, stipends, CRM giving/pipeline/grants |
| `query_donors` | Building21 Development CRM donor lookup |
| `search_conversations` | Semantic search over Drive docs (Slack/transcripts in V0.2) |
| `search_by_person` | Scoped document search by student or staff name |
| `search_documents` | Raw document chunk search with optional entity filter |

Full input/output schemas: [docs/mcp-server-spec.md](docs/mcp-server-spec.md)

---

## Connectors

| Connector | Source | Destination | Status |
|---|---|---|---|
| `google-sheets` | Student Dashboard + Outcomes sheets | Postgres | Skeleton — needs `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `google-drive` | Drive docs folder | Postgres + pgvector | Skeleton — needs `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `bigquery` | `lp-internal-ai` BigQuery project | Postgres | Skeleton — needs Google service account |
| `givebutter` | GiveButter donation platform | `donor_contacts`, `donor_gifts` | **REST client implemented** — needs `GIVEBUTTER_API_KEY` |
| `aplos` | Aplos nonprofit accounting | Postgres | Skeleton — needs `APLOS_CLIENT_ID` + `APLOS_API_KEY` |
| `slack` | Designated Slack channels | pgvector | Skeleton — needs `SLACK_BOT_TOKEN` |
| `roam` | Roam chat / messaging | pgvector | Skeleton — needs `ROAM_API_KEY` |

Each connector's `sync()` is wrapped by `runSync()`, which writes a success/error row to `sync_runs` on every run — visible in the HQ `/sync` page.

---

## Current Status

| Area | State |
|---|---|
| Typecheck | ✅ All 15 packages pass |
| Tests | ✅ 31 tests, 5 files (Vitest) |
| Local DB | ✅ Postgres 16 + pgvector via Docker Compose |
| MCP tools | ✅ All 14 wired to real Prisma queries |
| HQ dashboard | ✅ Renders against live Postgres; auth gated |
| GiveButter connector | ✅ Full REST client implemented |
| Other 6 connectors | 🟡 Working skeletons — awaiting API credentials |
| AWS production | 🟡 Docker images built; awaiting Phase 2 (RDS + ECS Fargate) |
| CI | ✅ GitHub Actions with pgvector service container |

See [docs/runbooks/credentials-checklist.md](docs/runbooks/credentials-checklist.md) for credential requirements. See [docs/setup/README.md](docs/setup/README.md) for the phase-by-phase AWS production setup status.

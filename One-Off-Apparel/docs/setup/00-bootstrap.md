# Phase 0 — Project Bootstrap

**Goal:** Get the monorepo scaffolded, git initialized, and running on any developer's machine with a clean `pnpm install`.

**Prerequisites:**
- macOS or Linux
- Node.js ≥ 20 (`node --version`)
- pnpm ≥ 9 (`pnpm --version` — install with `npm install -g pnpm@latest`)
- Git
- Access to the LP Internal AI V1 repository

---

## 1. Clone the repository

```bash
git clone <repo-url> "LP Internal AI V1"
cd "LP Internal AI V1"
```

---

## 2. Install dependencies

```bash
pnpm install
```

This installs all packages across `apps/`, `packages/`, and `connectors/` via pnpm workspaces. There is no separate install step per package.

---

## 3. Set up your local environment file

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | AWS RDS connection string — see [02-rds-postgres.md](02-rds-postgres.md) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Base64-encoded service account JSON — see [05-google-connectors.md](05-google-connectors.md) |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID/SECRET` | Google Cloud Console OAuth credentials — see [08-hq-dashboard.md](08-hq-dashboard.md) |

Leave `USE_AWS_SECRETS=false` for local dev. All other variables can be populated incrementally as you work through the setup phases.

---

## 4. Verify TypeScript compiles

```bash
pnpm typecheck
```

Expected: no errors on a fresh clone (packages are empty stubs at this stage).

---

## 5. Project structure overview

```
apps/hq/             → Next.js 14 HQ dashboard (App Router, NextAuth, shadcn/ui)
apps/mcp-server/     → MCP server exposing 13+ Claude tools over HTTP+SSE

packages/db/         → Prisma schema, client, migrations
packages/embedding/  → OpenAI embedding helpers (batch + retry)
packages/config/     → Typed env loader (Secrets Manager + .env fallback)

connectors/google-sheets/   → Sheets → Postgres
connectors/google-drive/    → Drive docs → Postgres + pgvector
connectors/aplos/           → Aplos accounting → Postgres
connectors/slack/           → Slack channels → pgvector

docs/setup/          → This series of setup guides (00–21)
docs/runbooks/       → Operational playbooks (sync failures, RDS alerts, secret rotation)
docs/decisions/      → Architecture Decision Records (ADRs)
docs/data-sources/   → Per-connector data specs
docs/reference/      → Reference material (V0 migrations, etc.)
```

---

## 6. Useful pnpm commands

```bash
# Run a command in one package
pnpm --filter @lp-ai/hq dev
pnpm --filter @lp-ai/mcp-server dev

# Run all connector syncs
pnpm sync:sheets
pnpm sync:drive
pnpm sync:aplos
pnpm sync:slack

# Database
pnpm db:generate     # Regenerate Prisma client after schema changes
pnpm db:migrate      # Apply migrations to the database
pnpm db:studio       # Open Prisma Studio (browser GUI)

# Repo-wide
pnpm build           # Build all packages
pnpm typecheck       # Type-check all packages
pnpm lint            # Lint all packages
```

---

## 7. Next step

Proceed to [01-aws-baseline.md](01-aws-baseline.md) to set up the AWS account and IAM roles.

---

## Verification checklist

- [ ] `pnpm install` runs without errors
- [ ] `.env` created from `.env.example`
- [ ] `pnpm typecheck` passes
- [ ] Directory structure matches the tree above

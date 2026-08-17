# LP Internal AI V1 — Setup Guide Index

This folder contains a step-by-step setup guide for every system in the V1 stack. Work through them in order — each phase assumes the previous one is complete.

**Stack locked:** May 18 2026 · Updated: June 10 2026 · Next review: August 2026

Quick onboarding resources:

- [../reference/new-developer-playbook.md](../reference/new-developer-playbook.md)
- [../reference/connector-capability-matrix.md](../reference/connector-capability-matrix.md)
- [../../HOW-SKILLS-WORK.md](../../HOW-SKILLS-WORK.md)

---

## Checklist

Status legend: ✅ Complete · 🟡 Built (awaiting credential to activate) · 🔲 Pending

| # | Phase | Guide | Status | Notes |
|---|---|---|---|---|
| 0 | Project bootstrap — monorepo, git, config files | [00-bootstrap.md](00-bootstrap.md) | ✅ Complete | 17 workspace packages, vitest, CI |
| 1 | AWS account + IAM baseline | [01-aws-baseline.md](01-aws-baseline.md) | ✅ Complete | Account 851725317896, IAM user Kunkelch, profile lp-internal, us-east-1 |
| 2 | AWS RDS Postgres + pgvector extension | [02-rds-postgres.md](02-rds-postgres.md) | 🟡 Local | Docker Compose stands in for RDS today; schema ready |
| 3 | AWS Secrets Manager + `@lp-ai/lib-config` package | [03-secrets-manager.md](03-secrets-manager.md) | 🟡 Config | `@lp-ai/lib-config` built; Secrets Manager fetch path ready |
| 4 | Prisma schema — all tables | [04-prisma-schema.md](04-prisma-schema.md) | ✅ Complete | 30 models incl. NextAuth, MCP OAuth, employment, postsecondary |
| 5 | Google connectors — Sheets + Drive | [05-google-connectors.md](05-google-connectors.md) | ✅ Sheets live | All 12 sheet syncs ported; 26K+ records; Drive still skeleton |
| 6 | Embeddings + pgvector search | [06-embeddings-pgvector.md](06-embeddings-pgvector.md) | ✅ Complete | OpenAI `text-embedding-3-large` verified and live |
| 7 | MCP server — 25 tools | [07-mcp-server.md](07-mcp-server.md) | ✅ Complete | 16 data tools wired to Prisma; `find_grant_documents` reads the `grant_documents` catalog; the 3 grant tools and 5 skill tools read seed data only; stdio + HTTP + MCP OAuth transports |
| 8 | HQ dashboard — Next.js + NextAuth | [08-hq-dashboard.md](08-hq-dashboard.md) | ✅ Complete | All pages live incl. analytic dashboard, admin panel |
| 9 | ECS Fargate deployment | [09-ecs-express-mode.md](09-ecs-express-mode.md) | 🟡 In progress | 4 Dockerfiles + 5 ECS task defs built; deployment in progress |
| 10 | AWS EventBridge cron scheduling | [10-eventbridge-cron.md](10-eventbridge-cron.md) | 🔲 Pending | |
| 11 | Sentry error monitoring | [11-sentry.md](11-sentry.md) | 🔲 Pending | |
| 12 | Notion connector + knowledge base | [12-notion.md](12-notion.md) | ✅ Connector live | Meeting transcript sync implemented; knowledge base structure pending |
| 13 | n8n workflow automation (self-hosted) | [13-n8n.md](13-n8n.md) | 🔲 Pending | |
| 14 | Metabase BI dashboards (self-hosted) | [14-metabase.md](14-metabase.md) | 🔲 Pending | |
| 15 | Airbyte ingestion tooling (self-hosted) | [15-airbyte.md](15-airbyte.md) | 🔲 Pending | |
| 17 | Aplos connector | [17-aplos-connector.md](17-aplos-connector.md) | ✅ Complete | RSA-decryption auth; 16K+ records synced |
| 18 | Slack connector | [18-slack-connector.md](18-slack-connector.md) | 🟡 Scaffold | Awaiting `SLACK_BOT_TOKEN` |
| 21 | Athena over S3 (analytics warehouse) | [21-athena-s3.md](21-athena-s3.md) | 🔲 Pending | |
| 22 | Anthropic Admin API usage connector | [22-anthropic-usage-connector.md](22-anthropic-usage-connector.md) | 🔲 Pending | Populates token usage in HQ home page |

For the working local-dev path that doesn't require any AWS or external credentials, see [docs/runbooks/local-dev.md](../runbooks/local-dev.md). For the credential-gathering plan, see [docs/runbooks/credentials-checklist.md](../runbooks/credentials-checklist.md).

---

## How this works

Each guide covers one system end-to-end:

1. **Prerequisites** — what must be done first
2. **Step-by-step setup** — exact commands, console steps, and config values
3. **Verification** — how to confirm it's working
4. **Teardown** — how to undo (useful for dev/staging environments)
5. **Known pitfalls** — common mistakes and fixes

When a phase is complete, update the status column above to `✅ Complete`.

---

## Stack reference

| Layer | Tool |
|---|---|
| Language | TypeScript (strict) |
| Monorepo | pnpm workspaces |
| ORM | Prisma |
| Relational DB | Postgres on AWS RDS |
| Vector search | pgvector (on RDS) |
| Embeddings | OpenAI `text-embedding-3-large` |
| App hosting | AWS ECS (Fargate) behind ALB |
| Cron | AWS EventBridge |
| Secrets | AWS Secrets Manager |
| Auth | NextAuth (Auth.js) + Google |
| Frontend | Next.js 14 + shadcn/ui |
| Monitoring | Sentry |
| BI | Metabase (self-hosted) |
| Automation | n8n (self-hosted) |
| Ingestion | Airbyte (self-hosted) |
| Warehouse | Athena over S3 |
| AI | Claude (Anthropic) via MCP |

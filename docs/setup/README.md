# LP Internal AI V1 — Setup Guide Index

This folder contains a step-by-step setup guide for every system in the V1 stack. Work through them in order — each phase assumes the previous one is complete.

**Stack locked:** May 18 2026 · Next review: August 2026

Quick onboarding resources:

- [../reference/new-developer-playbook.md](../reference/new-developer-playbook.md)
- [../reference/connector-capability-matrix.md](../reference/connector-capability-matrix.md)
- [../../HOW-SKILLS-WORK.md](../../HOW-SKILLS-WORK.md)

---

## Checklist

Status legend: ✅ Complete · 🟡 Built (awaiting credential to activate) · 🔲 Pending

| # | Phase | Guide | Status | Notes |
|---|---|---|---|---|
| 0 | Project bootstrap — monorepo, git, config files | [00-bootstrap.md](00-bootstrap.md) | ✅ Complete | 12 workspace projects, vitest, CI |
| 1 | AWS account + IAM baseline | [01-aws-baseline.md](01-aws-baseline.md) | 🔲 Pending | Blocks all AWS phases |
| 2 | AWS RDS Postgres + pgvector extension | [02-rds-postgres.md](02-rds-postgres.md) | 🟡 Local | Docker compose stands in for RDS today; schema ready |
| 3 | AWS Secrets Manager + `@lp-ai/lib-config` package | [03-secrets-manager.md](03-secrets-manager.md) | 🟡 Config | `@lp-ai/lib-config` built; Secrets Manager fetch path stubbed until Phase 1 |
| 4 | Prisma schema — all tables | [04-prisma-schema.md](04-prisma-schema.md) | ✅ Complete | 22 tables incl. NextAuth + sync_runs + pending_aliases; init migration captured |
| 5 | Google connectors — Sheets + Drive | [05-google-connectors.md](05-google-connectors.md) | 🟡 Scaffold | Awaiting `GOOGLE_SERVICE_ACCOUNT_JSON` |
| 6 | Embeddings + pgvector search | [06-embeddings-pgvector.md](06-embeddings-pgvector.md) | 🟡 Built | `@lp-ai/lib-embedding` ready; awaiting `OPENAI_API_KEY` for runtime |
| 7 | MCP server — 14 tools | [07-mcp-server.md](07-mcp-server.md) | ✅ Complete | All 14 tools wired to Prisma; stdio + HTTP transports; smoke-tested |
| 8 | HQ dashboard — Next.js + NextAuth | [08-hq-dashboard.md](08-hq-dashboard.md) | 🟡 Built | All pages live; sign-in awaits `AUTH_GOOGLE_ID`/`SECRET` |
| 9 | ECS Fargate deployment | [09-ecs-express-mode.md](09-ecs-express-mode.md) | 🔲 Pending | Docker images built and verified locally; awaiting AWS |
| 10 | AWS EventBridge cron scheduling | [10-eventbridge-cron.md](10-eventbridge-cron.md) | 🔲 Pending | |
| 11 | Sentry error monitoring | [11-sentry.md](11-sentry.md) | 🔲 Pending | |
| 12 | Notion knowledge base | [12-notion.md](12-notion.md) | 🔲 Pending | |
| 13 | n8n workflow automation (self-hosted) | [13-n8n.md](13-n8n.md) | 🔲 Pending | |
| 14 | Metabase BI dashboards (self-hosted) | [14-metabase.md](14-metabase.md) | 🔲 Pending | |
| 15 | Airbyte ingestion tooling (self-hosted) | [15-airbyte.md](15-airbyte.md) | 🔲 Pending | |
| 16 | GiveButter connector | [16-givebutter-connector.md](16-givebutter-connector.md) | 🟡 Built | REST client + tests; awaiting `GIVEBUTTER_API_KEY` |
| 17 | Aplos connector | [17-aplos-connector.md](17-aplos-connector.md) | 🟡 Scaffold | Awaiting `APLOS_CLIENT_ID`/`API_KEY` |
| 18 | Slack connector | [18-slack-connector.md](18-slack-connector.md) | 🟡 Scaffold | Awaiting `SLACK_BOT_TOKEN` |
| 19 | Roam connector | [19-roam-connector.md](19-roam-connector.md) | 🟡 Scaffold | Awaiting `ROAM_API_KEY` |
| 20 | BigQuery connector (source pull) | [20-bigquery-connector.md](20-bigquery-connector.md) | 🟡 Scaffold | Awaiting Google service account |
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

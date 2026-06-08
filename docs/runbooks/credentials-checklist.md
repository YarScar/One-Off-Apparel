# Credentials Checklist

What credentials to request, from whom, and what each one unlocks. Suggested gather order minimizes blocked time — the AWS-tier creds unlock the most downstream work, but several connectors can be activated independently.

## Quick-glance table

| # | Credential | Who can provide | Unlocks | Local-dev workaround |
|---|---|---|---|---|
| 1 | AWS IAM user (admin or specific policy) | AWS account admin | All AWS phases (RDS, ECS, EventBridge, Secrets Manager, S3/Athena) | Docker Postgres works for everything except the production deploy |
| 2 | `OPENAI_API_KEY` | OpenAI billing-account owner | Embedding generation; `search_documents`, `search_conversations`, `search_by_person` MCP tools | Other 11 MCP tools work without it |
| 3 | `ANTHROPIC_API_KEY` | Anthropic billing-account owner | Only needed for systems that *call* Claude directly. The MCP server is *called by* Claude (via Claude Desktop or claude.ai), so MCP itself does not need this key. | n/a |
| 4 | Google OAuth client (`AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`) | Google Workspace admin (launchpadphilly.org) | HQ dashboard sign-in | Disable middleware locally to view pages without auth |
| 5 | Google service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) + Sheet IDs + Drive folder ID | Google Workspace admin | `google-sheets`, `google-drive`, `bigquery` connectors | Seed script provides sample data |
| 6 | `GIVEBUTTER_API_KEY` | Launchpad GiveButter account owner | `givebutter` connector (real REST client already implemented) | Seed includes 2 sample donors |
| 7 | `APLOS_CLIENT_ID` + `APLOS_API_KEY` | Launchpad Aplos account owner | `aplos` connector + `get_finance_brief` Aplos sections | Finance snapshots from seed |
| 8 | `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` | Launchpad Slack admin | `slack` connector + `search_conversations` Slack source | Drive-only `search_conversations` until Slack lands |
| 9 | `ROAM_API_KEY` + `ROAM_GRAPH_NAME` | Roam workspace owner | `roam` connector | n/a |
| 10 | `SENTRY_DSN_HQ` + `SENTRY_DSN_MCP` | Sentry workspace owner | Production error monitoring | Local errors print to stderr |
| 11 | `SYNC_SECRET` | Generated; share between EventBridge + the ECS MCP service | Bearer auth on the MCP server's `/mcp` HTTP endpoint | Endpoint is unauthed when unset |

## Recommended order

**Tier 1 — unlocks the most work**

1. **AWS IAM access (#1)**
   - Unlocks: RDS Postgres, ECS deploy, Secrets Manager, EventBridge scheduling, S3 + Athena.
   - Even basic AWS access lets us deploy the Docker images already built locally (`apps/hq/Dockerfile`, `apps/mcp-server/Dockerfile`) and move secrets out of the local `.env`.
   - Request: an IAM user (or SSO role) with permissions for RDS, ECS, Secrets Manager, EventBridge, S3, IAM (for ECS task role creation). Phase 1 setup guide ([docs/setup/01-aws-baseline.md](../setup/01-aws-baseline.md)) has the policy template.

2. **OpenAI API key (#2)**
   - Unlocks 3 of 14 MCP tools (everything that needs query embedding).
   - Independent of AWS; can be activated immediately.
   - Cost note: `text-embedding-3-large` is ~$0.13 / 1M tokens. Initial backfill of Drive docs + Slack history is likely under $5.
   - Request: `OPENAI_API_KEY` from the existing OpenAI organization, or create a new account at platform.openai.com.

**Tier 2 — light-up connectors**

3. **GiveButter API key (#6)** — REST client is fully implemented; this is the fastest connector to bring online.
4. **Aplos credentials (#7)** — large finance value; connector skeleton needs implementation but the data model is in place.
5. **Slack bot token (#8)** — required for `search_conversations` to actually search Slack.
6. **Google service account (#5)** — the heaviest setup because it requires Google Workspace admin to create a service account, share Sheet/Drive permissions, and gather all the sheet IDs. Worth doing in one batch.
7. **Roam API key (#9)** — small footprint; Roam is the lightest connector.

**Tier 3 — auth + observability**

8. **Google OAuth client (#4)** — needed once you want to share the HQ dashboard with the team rather than running it locally.
9. **Sentry DSNs (#10)** — production-only; not strictly required until ECS deploy.
10. **`SYNC_SECRET` (#11)** — generate with `openssl rand -base64 32` once we have ECS + EventBridge.

## What's safe to share with admins

When you message an admin to request a credential, you can safely share:
- That this is an internal Launchpad AI project storing data in Postgres
- That the data flows are read-only (the system never writes back to source systems)
- That production secrets will live in AWS Secrets Manager, never in code

Things to **never** share over chat:
- The credential values themselves once issued — store them in `.env` locally and AWS Secrets Manager in production
- Any database connection string with embedded password

## For each credential — where it goes

All credentials are added to `.env` locally (which is gitignored) and to AWS Secrets Manager in production. The Zod schema in `packages/config/src/schema.ts` is the authoritative list of every env var the codebase understands.

| Variable | Local | Production |
|---|---|---|
| `DATABASE_URL` | `.env` (Docker URL today) | Secrets Manager `lp-internal/db` |
| `OPENAI_API_KEY` | `.env` | Secrets Manager `lp-internal/openai` |
| `ANTHROPIC_API_KEY` | `.env` (optional) | Secrets Manager `lp-internal/anthropic` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `AUTH_SECRET` | `.env` | Secrets Manager `lp-internal/nextauth` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` + sheet IDs | `.env` | Secrets Manager `lp-internal/google` |
| `GIVEBUTTER_API_KEY` | `.env` | Secrets Manager `lp-internal/givebutter` |
| `APLOS_CLIENT_ID` / `APLOS_API_KEY` | `.env` | Secrets Manager `lp-internal/aplos` |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` | `.env` | Secrets Manager `lp-internal/slack` |
| `ROAM_API_KEY` / `ROAM_GRAPH_NAME` | `.env` | Secrets Manager `lp-internal/roam` |
| `SENTRY_DSN_HQ` / `SENTRY_DSN_MCP` | `.env` | Secrets Manager `lp-internal/sentry` |
| `SYNC_SECRET` | `.env` | Secrets Manager `lp-internal/sync` |

Once `USE_AWS_SECRETS=true` in production, `packages/config` fetches all of these from Secrets Manager on startup and validates them through the Zod schema before any business logic runs.

## Pending docs to write once we have credentials

- A "first sync" runbook for each connector (commands, what to expect in logs, how to verify rows landed in Postgres) — currently only the GiveButter pattern exists, in `connectors/givebutter/src/index.ts`.
- Production deployment runbook for ECS once Phase 9 begins (see docs/setup/09-ecs-express-mode.md).

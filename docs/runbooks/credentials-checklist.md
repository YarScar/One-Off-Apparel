# Credentials Checklist

What credentials to request, from whom, and what each one unlocks. Suggested gather order minimizes blocked time — the AWS-tier creds unlock the most downstream work, but several connectors can be activated independently.

## Quick-glance table

| # | Credential | Who can provide | Unlocks | Local-dev workaround |
|---|---|---|---|---|
| 1 | AWS IAM user (admin or specific policy) | AWS account admin | All AWS phases (RDS, ECS, EventBridge, Secrets Manager, S3/Athena) | Docker Postgres works for everything except the production deploy |
| 2 | `OPENAI_API_KEY` | OpenAI billing-account owner | Embedding generation; `search_documents`, `search_conversations`, `search_by_person` MCP tools | Other 13 MCP tools work without it |
| 3 | `ANTHROPIC_API_KEY` | Anthropic billing-account owner | Only needed for systems that *call* Claude directly. The MCP server is *called by* Claude (via Claude Desktop or claude.ai), so MCP itself does not need this key. | n/a |
| 4 | Google OAuth client (`AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`) | Google Workspace admin (launchpadphilly.org) | HQ dashboard sign-in | Disable middleware locally to view pages without auth |
| 5 | Google service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) + Sheet IDs + Drive folder ID | Google Workspace admin | `google-sheets`, `google-drive` connectors | Seed script provides sample data |
| 5b | Desktop OAuth client (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) → `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` | Anyone with GCP project access, plus a person who can open the `Grants` tree | Running the `google-drive` walk **locally** against the real corpus. Never production — the token is one person's | Service account, once the tree is shared with its `client_email`. See [google-drive-connector.md](../data-sources/google-drive-connector.md) |
| 6 | `APLOS_CLIENT_ID` + `APLOS_API_KEY` | Launchpad Aplos account owner | `aplos` connector + `get_finance_brief` + `query_finances` Aplos sections | ✅ Live — 16K+ records (accounts, funds, transactions) |
| 7 | `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` | Launchpad Slack admin | `slack` connector + `search_conversations` Slack source | Drive-only `search_conversations` until Slack lands |
| 8 | `NOTION_API_KEY` + `NOTION_MEETING_TRANSCRIPTS_DB_ID` | Notion workspace admin | `notion` connector — meeting transcripts → pgvector | n/a |
| 9 | `SENTRY_DSN_HQ` + `SENTRY_DSN_MCP` | Sentry workspace owner | Production error monitoring | Local errors print to stderr |
| 10 | `SYNC_SECRET` | Generated; share between EventBridge + the ECS MCP service | Bearer auth on the MCP server's `/mcp` HTTP endpoint | Endpoint is unauthed when unset |
| 11 | MCP OAuth (`MCP_OAUTH_ISSUER`, `JWT_PRIVATE_KEY`, `JWT_KID`) | Generated during Phase 23 setup | MCP OAuth 2.0 PKCE flow for tool-level access control | Tools accessible without OAuth when unset |
| 12 | `CLAUDE_TELEMETRY_SHARED_TOKEN` | Generated; share between the Claude organization's managed settings (`claude.ai/admin-settings/claude-code`) and HQ | Bearer auth on `/api/telemetry`, the Claude Code OpenTelemetry ingestion endpoint | Endpoint rejects every request (fails closed) when unset — see [docs/setup/22-anthropic-usage-connector.md](../setup/22-anthropic-usage-connector.md) |

## Recommended order

**Tier 1 — unlocks the most work**

1. **AWS IAM access (#1)**
   - Unlocks: RDS Postgres, ECS deploy, Secrets Manager, EventBridge scheduling, S3 + Athena.
   - Even basic AWS access lets GitHub Actions build and deploy the app images to ECS, and lets us move secrets out of the local `.env` into Secrets Manager.
   - Request: an IAM user (or SSO role) with permissions for RDS, ECS, Secrets Manager, EventBridge, S3, IAM (for ECS task role creation). Phase 1 setup guide ([docs/setup/01-aws-baseline.md](../setup/01-aws-baseline.md)) has the policy template.

2. **OpenAI API key (#2)**
   - Unlocks 3 of 16 MCP tools (everything that needs query embedding).
   - Independent of AWS; can be activated immediately.
   - Cost note: `text-embedding-3-large` is ~$0.13 / 1M tokens. Initial backfill of Drive docs + Slack history is likely under $5.
   - Request: `OPENAI_API_KEY` from the existing OpenAI organization, or create a new account at platform.openai.com.

**Tier 2 — light-up connectors**

3. **Aplos credentials (#6)** — ✅ live; connector syncs accounts, funds, and transactions into `finance_snapshots`.
4. **Slack bot token (#7)** — required for `search_conversations` to actually search Slack.
5. **Google service account (#5)** — the heaviest setup because it requires Google Workspace admin to create a service account, share Sheet/Drive permissions, and gather all the sheet IDs. Worth doing in one batch.

**Tier 3 — auth + observability**

6. **Google OAuth client (#4)** — needed once you want to share the HQ dashboard with the team rather than running it locally.
7. **Sentry DSNs (#9)** — production-only; not strictly required until ECS deploy.
8. **`SYNC_SECRET` (#10)** — generate with `openssl rand -base64 32` once we have ECS + EventBridge.
9. **`CLAUDE_TELEMETRY_SHARED_TOKEN` (#12)** — generate the same way, once `/api/telemetry` is deployed; the same value goes into both Secrets Manager and the Claude org's managed settings (`OTEL_EXPORTER_OTLP_HEADERS`).

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
| `APLOS_CLIENT_ID` / `APLOS_API_KEY` | `.env` | Secrets Manager `lp-internal/aplos` |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` | `.env` | Secrets Manager `lp-internal/slack` |
| `NOTION_API_KEY` / `NOTION_MEETING_TRANSCRIPTS_DB_ID` | `.env` | Secrets Manager `lp-internal/notion` |
| `SENTRY_DSN_HQ` / `SENTRY_DSN_MCP` | `.env` | Secrets Manager `lp-internal/sentry` |
| `SYNC_SECRET` | `.env` | Secrets Manager `lp-internal/sync` |
| `MCP_OAUTH_ISSUER` / `JWT_PRIVATE_KEY` / `JWT_KID` | `.env` | Secrets Manager `lp-internal/mcp-oauth` |
| `CLAUDE_TELEMETRY_SHARED_TOKEN` | `.env` | Secrets Manager `lp-internal/anthropic` |

Once `USE_AWS_SECRETS=true` in production, `packages/config` fetches all of these from Secrets Manager on startup and validates them through the Zod schema before any business logic runs.

## Pending docs to write once we have credentials

- A "first sync" runbook for each connector (commands, what to expect in logs, how to verify rows landed in Postgres).
- Production deployment runbook for ECS once Phase 9 begins (see docs/setup/09-ecs-express-mode.md).

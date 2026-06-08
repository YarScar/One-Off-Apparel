# Phase 3 — AWS Secrets Manager + Config Package

**Goal:** Store all credentials in Secrets Manager, then build the `@lp-ai/lib-config` package so every app and connector loads secrets the same way — Secrets Manager in production, `.env` file locally.

**Prerequisites:**
- Phase 1 complete — AWS CLI configured
- Phase 2 complete — RDS is running and `lpapp` password exists
- All API keys collected: Anthropic, OpenAI, Google service account, GiveButter, Aplos, Slack, Roam

---

## 1. Create secrets in Secrets Manager

Each secret is a JSON object grouped by concern. The naming convention is `lp-internal/<group>`.

```bash
# Database
aws secretsmanager create-secret \
  --name lp-internal/db \
  --description "RDS Postgres connection string" \
  --secret-string '{"DATABASE_URL":"postgresql://lpapp:<password>@<host>:5432/lpinternal?sslmode=require"}'

# Anthropic
aws secretsmanager create-secret \
  --name lp-internal/anthropic \
  --description "Anthropic API key" \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-..."}'

# OpenAI
aws secretsmanager create-secret \
  --name lp-internal/openai \
  --description "OpenAI API key (embeddings)" \
  --secret-string '{"OPENAI_API_KEY":"sk-..."}'

# Google
aws secretsmanager create-secret \
  --name lp-internal/google \
  --description "Google service account + Sheet IDs" \
  --secret-string '{
    "GOOGLE_SERVICE_ACCOUNT_JSON":"<base64-encoded-json>",
    "GOOGLE_DRIVE_FOLDER_ID":"...",
    "GOOGLE_SHEETS_STUDENT_INFO_ID":"...",
    "GOOGLE_SHEETS_DASHBOARD_ID":"...",
    "GOOGLE_SHEETS_DEVELOPMENT_CRM":"..."
  }'

# NextAuth
aws secretsmanager create-secret \
  --name lp-internal/nextauth \
  --description "NextAuth credentials" \
  --secret-string '{
    "AUTH_SECRET":"<openssl rand -base64 32>",
    "AUTH_GOOGLE_ID":"...",
    "AUTH_GOOGLE_SECRET":"..."
  }'

# GiveButter
aws secretsmanager create-secret \
  --name lp-internal/givebutter \
  --description "GiveButter API key" \
  --secret-string '{"GIVEBUTTER_API_KEY":"..."}'

# Aplos
aws secretsmanager create-secret \
  --name lp-internal/aplos \
  --description "Aplos API credentials" \
  --secret-string '{"APLOS_CLIENT_ID":"...","APLOS_API_KEY":"..."}'

# Slack
aws secretsmanager create-secret \
  --name lp-internal/slack \
  --description "Slack bot credentials" \
  --secret-string '{"SLACK_BOT_TOKEN":"xoxb-...","SLACK_SIGNING_SECRET":"..."}'

# Roam
aws secretsmanager create-secret \
  --name lp-internal/roam \
  --description "Roam API credentials" \
  --secret-string '{"ROAM_API_KEY":"...","ROAM_GRAPH_NAME":"..."}'

# Sync shared secret (EventBridge → MCP server auth)
aws secretsmanager create-secret \
  --name lp-internal/sync \
  --description "Shared secret for sync endpoint auth" \
  --secret-string "{\"SYNC_SECRET\":\"$(openssl rand -base64 32)\"}"

# Sentry
aws secretsmanager create-secret \
  --name lp-internal/sentry \
  --description "Sentry DSNs" \
  --secret-string '{"SENTRY_DSN_HQ":"...","SENTRY_DSN_MCP":"..."}'
```

Verify they were created:

```bash
aws secretsmanager list-secrets --query "SecretList[*].Name" --output table
```

---

## 2. Update an existing secret

```bash
aws secretsmanager put-secret-value \
  --secret-id lp-internal/db \
  --secret-string '{"DATABASE_URL":"postgresql://..."}'
```

---

## 3. Build the `@lp-ai/lib-config` package

```bash
mkdir -p "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/packages/config/src"
```

Create `packages/config/package.json`:

```json
{
  "name": "@lp-ai/lib-config",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aws-sdk/client-secrets-manager": "^3.600.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

Create `packages/config/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

The implementation is built during Phase 4 (Prisma setup), since it needs to know which secret keys to expose. See `packages/config/src/index.ts` once Phase 4 is complete.

---

## 4. How the config package works at runtime

```
USE_AWS_SECRETS=false  → reads from process.env / .env file (local dev)
USE_AWS_SECRETS=true   → fetches from AWS Secrets Manager at startup (production)
```

In production (ECS Fargate), no `.env` file exists. The execution role attached to the ECS task definition (`lp-ecs-execution-role`) fetches Secrets Manager values via the `secrets` block in the task definition and injects them as environment variables before the container starts. The task role (`lp-ecs-task-role`) can also fetch secrets directly at runtime if needed.

---

## Verification checklist

- [ ] All 11 secrets visible in AWS Console → Secrets Manager
- [ ] `aws secretsmanager get-secret-value --secret-id lp-internal/db` returns the correct JSON
- [ ] `packages/config/` directory created with `package.json` and `tsconfig.json`

---

## Updating secrets later

```bash
# Retrieve current value, edit, re-upload
aws secretsmanager get-secret-value --secret-id lp-internal/google --query SecretString --output text | jq '.'
```

---

## Known pitfalls

- **Secrets Manager costs $0.40/secret/month** — 11 secrets ≈ $4.40/month. Acceptable.
- **Secret names are case-sensitive** — always use lowercase `lp-internal/<name>`
- **Don't store secrets in git** — `.env` is in `.gitignore`. Never commit a filled-in `.env` file.
- **Rotation** — Secrets Manager supports automatic rotation. Not required at this scale, but worth enabling on `lp-internal/db` once the system is stable.

---

**Next:** [04-prisma-schema.md](04-prisma-schema.md)

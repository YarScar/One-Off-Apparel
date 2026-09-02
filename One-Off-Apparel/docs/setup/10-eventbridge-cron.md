# Phase 10 — AWS EventBridge Cron Scheduling

**Goal:** Replace Railway's cron with AWS EventBridge schedule rules that trigger each connector sync on its own cadence, authenticated against the MCP server via a shared secret.

**Prerequisites:**
- Phase 9 complete — ECS services running
- `SYNC_SECRET` stored in `lp-internal/sync` in Secrets Manager
- Each connector exposes a `POST /sync/<connector>` endpoint on the MCP server (or a dedicated sync service)

---

## 1. Add sync endpoints to the MCP server

Add a lightweight HTTP server alongside the MCP stdio transport that accepts authenticated sync triggers. (On ECS, this is the same container that serves the Streamable HTTP MCP endpoint behind the ALB.)

**`apps/mcp-server/src/sync-handler.ts`:**
```typescript
import { createServer } from 'http';

const SYNC_SECRET = process.env['SYNC_SECRET'];

export function startSyncServer(port = 3001): void {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${SYNC_SECRET}`) {
      res.writeHead(401);
      res.end();
      return;
    }

    const connector = req.url?.replace('/sync/', '');
    try {
      await runSync(connector ?? '');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, connector }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  server.listen(port, () => {
    console.warn(`Sync server listening on :${port}`);
  });
}
```

---

## 2. Create a Lambda function to trigger syncs

The EventBridge rule calls a Lambda; the Lambda calls the ECS sync endpoint via the ALB hostname. This keeps EventBridge decoupled from the ECS service URL.

```bash
# Create the Lambda execution role
cat > /tmp/lambda-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name lp-sync-trigger-role \
  --assume-role-policy-document file:///tmp/lambda-trust.json

aws iam attach-role-policy \
  --role-name lp-sync-trigger-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name lp-sync-trigger-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

Create the Lambda function code (`/tmp/sync-trigger/index.mjs`):

```javascript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: 'us-east-1' });

export const handler = async (event) => {
  const { connector, syncUrl } = event;

  const secret = await sm.send(new GetSecretValueCommand({ SecretId: 'lp-internal/sync' }));
  const { SYNC_SECRET } = JSON.parse(secret.SecretString);

  const response = await fetch(`${syncUrl}/sync/${connector}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SYNC_SECRET}` },
  });

  if (!response.ok) throw new Error(`Sync failed: ${response.status}`);
  return await response.json();
};
```

Deploy the Lambda:

```bash
cd /tmp/sync-trigger && zip -r ../sync-trigger.zip .

aws lambda create-function \
  --function-name lp-sync-trigger \
  --runtime nodejs20.x \
  --role arn:aws:iam::${AWS_ACCOUNT_ID}:role/lp-sync-trigger-role \
  --handler index.handler \
  --zip-file fileb:///tmp/sync-trigger.zip \
  --timeout 30
```

---

## 3. Create EventBridge schedule rules

```bash
MCP_URL="https://mcp.launchpadinc.org"
LAMBDA_ARN="arn:aws:lambda:us-east-1:${AWS_ACCOUNT_ID}:function:lp-sync-trigger"

# Allow EventBridge to invoke the Lambda
aws lambda add-permission \
  --function-name lp-sync-trigger \
  --statement-id eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com

# Google Sheets — every hour
aws events put-rule \
  --name lp-sync-google-sheets \
  --schedule-expression "rate(1 hour)" \
  --state ENABLED

aws events put-targets \
  --rule lp-sync-google-sheets \
  --targets "[{\"Id\":\"1\",\"Arn\":\"${LAMBDA_ARN}\",\"Input\":\"{\\\"connector\\\":\\\"google-sheets\\\",\\\"syncUrl\\\":\\\"${MCP_URL}\\\"}\"}]"

# Google Drive — every 6 hours
aws events put-rule \
  --name lp-sync-google-drive \
  --schedule-expression "rate(6 hours)" \
  --state ENABLED

aws events put-targets \
  --rule lp-sync-google-drive \
  --targets "[{\"Id\":\"1\",\"Arn\":\"${LAMBDA_ARN}\",\"Input\":\"{\\\"connector\\\":\\\"google-drive\\\",\\\"syncUrl\\\":\\\"${MCP_URL}\\\"}\"}]"

# Aplos — daily at 3:30am UTC
aws events put-rule \
  --name lp-sync-aplos \
  --schedule-expression "cron(30 3 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule lp-sync-aplos \
  --targets "[{\"Id\":\"1\",\"Arn\":\"${LAMBDA_ARN}\",\"Input\":\"{\\\"connector\\\":\\\"aplos\\\",\\\"syncUrl\\\":\\\"${MCP_URL}\\\"}\"}]"
```

Repeat the pattern for the Slack connector once it is built.

---

## Verification checklist

- [ ] Lambda `lp-sync-trigger` deployed and testable manually:
  ```bash
  aws lambda invoke --function-name lp-sync-trigger \
    --payload '{"connector":"google-sheets","syncUrl":"https://..."}' \
    /tmp/response.json && cat /tmp/response.json
  ```
- [ ] EventBridge rule `lp-sync-google-sheets` shows as **Enabled**
- [ ] After one hour, CloudWatch Logs for `lp-sync-trigger` show a successful invocation
- [ ] `synced_at` timestamps in Postgres update automatically without manual intervention

---

## Known pitfalls

- **EventBridge cron syntax** — AWS uses `cron(min hour day month dow year)` not standard Unix cron. The `?` is required in either day-of-month or day-of-week.
- **Lambda timeout** — set to 30s. If a sync takes longer (large Drive folder), increase to 300s.
- **ECS task placement delay** — Fargate task startup is ~30s. If the EventBridge target has no retry policy and the service has `desiredCount: 0`, the Lambda invocation will fail. Keep `desiredCount >= 1` for sync-target services.

---

**Next:** [11-sentry.md](11-sentry.md)

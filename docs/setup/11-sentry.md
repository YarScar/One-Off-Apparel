# Phase 11 — Sentry Error Monitoring

**Goal:** Add Sentry to both the HQ dashboard and MCP server so errors surface immediately with full context, without waiting to notice something broke.

**Prerequisites:**
- Phase 9 complete — both apps deployed to ECS Fargate
- Sentry account (sentry.io — free tier is sufficient to start)

---

## 1. Create Sentry projects

1. Log into [sentry.io](https://sentry.io)
2. **Projects → Create Project**
3. Create two projects:
   - Platform: **Next.js** → Name: `lp-internal-hq`
   - Platform: **Node.js** → Name: `lp-internal-mcp`
4. Copy each project's **DSN** (shown on the project setup page)
5. Store both in Secrets Manager:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id lp-internal/sentry \
     --secret-string '{"SENTRY_DSN_HQ":"https://...@sentry.io/...","SENTRY_DSN_MCP":"https://...@sentry.io/..."}'
   ```
6. Add both to your local `.env`

---

## 2. Add Sentry to the HQ dashboard

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/hq"
pnpm add @sentry/nextjs
pnpm dlx @sentry/wizard@latest -i nextjs
```

The wizard creates:
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- Updates `next.config.js` with the Sentry webpack plugin

Update `sentry.server.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN_HQ'],
  tracesSampleRate: 0.2,
  environment: process.env['NODE_ENV'],
});
```

---

## 3. Add Sentry to the MCP server

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/mcp-server"
pnpm add @sentry/node
```

**`apps/mcp-server/src/instrument.ts`:**
```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN_MCP'],
  tracesSampleRate: 0.2,
  environment: process.env['NODE_ENV'],
});
```

Import at the very top of `apps/mcp-server/src/index.ts`:
```typescript
import './instrument.js';
```

Wrap tool handlers with Sentry error capture:
```typescript
} catch (err) {
  Sentry.captureException(err);
  return { content: [{ type: 'text', text: `Error: ${String(err)}` }] };
}
```

---

## 4. Configure alerts

In the Sentry dashboard for each project:
1. **Alerts → Create Alert Rule**
2. Trigger: **Any new issue**
3. Action: **Send an email** to `christian@launchpadphilly.org`
4. (Optional) Add a Slack notification if the Slack workspace is available

---

## 5. Test that errors are captured

Temporarily add a throwing route to the HQ app:

```typescript
// apps/hq/app/api/test-error/route.ts
export function GET() {
  throw new Error('Sentry test error — delete this route');
}
```

Hit `http://localhost:3000/api/test-error` → verify the error appears in Sentry within ~30 seconds. Then delete the route.

---

## Verification checklist

- [ ] Both Sentry projects created and DSNs in Secrets Manager
- [ ] Test error appears in `lp-internal-hq` Sentry project
- [ ] Alert email received for the test error
- [ ] Source maps uploaded (errors show line numbers, not minified code)
- [ ] Remove the test error route after verification

---

## Known pitfalls

- **Source maps** — Next.js with Sentry plugin uploads source maps automatically on `next build`. For the MCP server, configure `sentry-cli` in the build step or use `@sentry/node`'s `rewriteFramesIntegration`.
- **DSN in client bundle** — Sentry DSNs in client-side Next.js code are public by design (they only accept events, not admin actions). This is expected.
- **Too many alerts** — if a bug causes repeated errors, Sentry will group them into one issue and alert once. You won't get flooded.

---

**Next:** [12-notion.md](12-notion.md)

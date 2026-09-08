# Security Review

**Date:** 2026-06-11
**Scope:** Full repository audit — auth, secrets, injection, data exposure, infrastructure

---

## Critical

### ~~1. AWS Jobs routes bypass authentication~~ FIXED 2026-06-11

**File:** `apps/hq/middleware.ts:5`

`/aws-jobs` and `/api/aws-jobs` were in `PUBLIC_PATHS`, meaning anyone could view, approve, or reject AWS resource deployment jobs without signing in.

**Fix:** Removed both from `PUBLIC_PATHS`. These routes now require authentication.

---

### ~~2. Approver email accepted from client in AWS Jobs API~~ FIXED 2026-06-16

**File:** `apps/hq/app/api/aws-jobs/[id]/route.ts:31,50`

The POST endpoint accepts an arbitrary `approver` field from the request body:
```typescript
const { action, approver } = body as { action?: string; approver?: string };
approver: approver ?? 'admin@launchpadphilly.org',
```

Any caller can impersonate any email as the approver.

**Fix:** Approver is now extracted from the NextAuth session (`auth()`). Client-provided `approver` field is ignored. Returns 401 if no session.

---

### ~~3. Terraform code execution without sandboxing~~ MITIGATED 2026-06-16

**File:** `apps/aws-mcp-server/src/tools/aws-resources.ts:81,121-131`

User-supplied Terraform code is written directly to disk and executed via `execAsync`. A malicious Terraform provider or backend configuration could execute arbitrary commands.

**Fix (partial):** Added `validateTerraformCode()` that blocks `local-exec`/`remote-exec` provisioners, `external` data sources, non-S3 backends, and unapproved provider sources before code is written to disk. Full container sandboxing remains a future hardening step.

---

### ~~4. SQL injection via column name fallback in query_students~~ FIXED 2026-06-11

**File:** `apps/mcp-server/src/tools/query-students.ts:70`

The `?? field` fallback meant if `field` wasn't in the whitelist, raw user input was interpolated into SQL.

**Fix:** Removed the `?? field` fallback. Now returns an error if `field` is not in `FIELD_TO_COLUMN`.

---

## High

### ~~5. HQ_DEV_NO_AUTH bypass has no NODE_ENV guard~~ FIXED 2026-06-11

**File:** `apps/hq/middleware.ts:14`

The dev auth bypass could fire in production if the env var was set.

**Fix:** Added `process.env.NODE_ENV === 'development'` guard to the condition.

---

### ~~6. Error messages leak internal details~~ FIXED 2026-06-16

**Files:**
- `apps/hq/app/api/aws-jobs/[id]/route.ts:23,70` — raw `err.message` returned
- `apps/mcp-server/src/serve-http.ts:140,254` — database errors forwarded to client
- `apps/mcp-server/src/tool-helpers.ts:48-52` — full error message in tool response

**Fix:** All three sites now return generic error messages to clients. Full details logged to stderr. Tool helper additionally sanitizes sensitive patterns (connection strings, API keys, tokens) from error messages.

---

### ~~7. No rate limiting on OAuth or MCP endpoints~~ FIXED 2026-06-16

**Files:**
- `apps/mcp-server/src/serve-http.ts:161` — `/oauth/register` accepts unlimited DCR requests
- `apps/mcp-server/src/serve-http.ts:179` — `/oauth/authorize` has no throttle
- `apps/mcp-server/src/serve-http.ts:211` — `/mcp` endpoint has no per-user rate limit

**Fix:** Added in-memory sliding-window rate limiter (`apps/mcp-server/src/rate-limit.ts`):
- `/oauth/register`: 10 req/min per IP
- `/oauth/authorize`, `/oauth/token`: 100 req/min per IP
- `/mcp`: 1,000 calls/hour per user (keyed by email or IP for service callers)

---

### ~~8. OAuth redirect URI allows any HTTPS domain~~ FIXED 2026-06-16

**File:** `apps/mcp-server/src/oauth/dcr.ts:36-46`

DCR enforces HTTPS but allows any domain as a redirect URI. An attacker could register a phishing domain.

**Fix:** Added `ALLOWED_REDIRECT_DOMAINS` whitelist in DCR (`claude.ai`, `console.anthropic.com`, `launchpadphilly.org`, `launchpadinc.org`). Loopback always allowed for dev. Unknown domains rejected at registration.

---

### ~~9. OAuth authorization code reuse race condition~~ FIXED 2026-06-16

**File:** `apps/mcp-server/src/oauth/flow.ts:224`

The check for `usedAt` and the update that sets it are not atomic:
```typescript
if (row.usedAt) return fail('code already used');
// gap — another request could use the same code here
await prisma.oAuthAuthorizationCode.update({ where: { code }, data: { usedAt: new Date() } });
```

**Fix:** Replaced with `prisma.oAuthAuthorizationCode.updateMany({ where: { code, usedAt: null }, data: { usedAt: new Date() } })` and checking `updated.count === 0`. Now atomic — concurrent exchange attempts see count=0 and fail.

---

## Medium

### ~~10. SQL injection surface in HQ freshness query~~ FIXED 2026-06-16

**File:** `apps/hq/app/page.tsx:68`

```typescript
`SELECT COUNT(*)::bigint AS count, MAX("${column}") AS last_at FROM "${table}"`
```

Currently safe because table/column values are hardcoded, but the pattern invites future injection if parameters become dynamic.

**Fix:** Added `ALLOWED_TABLES` and `ALLOWED_COLUMNS` sets. `latest()` now throws if table/column is not in the whitelist.

---

### ~~11. Service callers bypass all tool ACLs~~ FIXED 2026-06-16

**File:** `apps/mcp-server/src/tool-helpers.ts:26`

Callers with `SYNC_SECRET` skip permission checks entirely. If the secret leaks, the attacker gets unrestricted access to all 16 MCP tools.

**Fix:** Service callers are now scoped to `SERVICE_ALLOWED_TOOLS` — the 16 read-only data query tools. Skill tools (`skill_grant_writing`, `skill_grant_prospecting`, `skill_finance_audit`, `skill_board_reporting`) are blocked for service callers. All service calls continue to be logged with `callerEmail: '_service'`.

---

### ~~12. Direct process.env access bypasses validation~~ FIXED 2026-06-16

**Files:**
- `apps/hq/middleware.ts:14` — kept (edge runtime, uses `NODE_ENV` + `HQ_DEV_NO_AUTH` at startup)
- `connectors/aplos/src/aplos-client.ts:10,20` — **fixed**: now uses `loadEnv()`
- `apps/mcp-server/src/serve-http.ts:19,21` — kept (`NODE_ENV` for Sentry init, `PORT` is Node convention)
- `apps/aws-mcp-server/src/tools/aws-resources.ts:17,167,168` — **fixed**: now uses `loadEnv()`, new vars added to schema

**Fix:** Aplos client and AWS resources tool now use `loadEnv()`. Three new env vars (`MOCK_TERRAFORM`, `AWS_ENV`, `AUTO_APPLY_DEV`) added to Zod schema. Remaining `process.env` references are at startup/edge boundaries where `loadEnv()` is not practical.

---

### ~~13. SYNC_SECRET has no minimum length validation~~ FIXED 2026-06-16

**File:** `packages/config/src/schema.ts:69`

```typescript
SYNC_SECRET: optional,
```

An empty or trivially short value would be accepted.

**Fix:** Now `z.string().trim().min(32, 'SYNC_SECRET must be at least 32 characters').optional()` with preprocess to treat empty strings as undefined.

---

## Low

### ~~14. No Content Security Policy headers~~ FIXED 2026-06-16

The HQ dashboard does not set CSP headers. Internal tool, but CSP would prevent any future XSS.

**Fix:** Added CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` headers via `apps/hq/next.config.mjs` `headers()` function.

---

### ~~15. No audit logging for failed login attempts~~ FIXED 2026-06-16

**File:** `apps/hq/auth.config.ts`

Failed sign-in attempts (wrong domain) are silently dropped.

**Fix:** `signIn` callback now writes structured JSON log (`auth_signin_rejected` event with email and timestamp) to stdout when domain check fails.

---

### ~~16. Docker images lack additional hardening~~ N/A 2026-06-16

All Dockerfiles correctly use non-root users. Missing: `--security-opt=no-new-privileges`, read-only root filesystem, dropped capabilities.

**Status:** No longer applicable — deployment moved from Docker/ECS to GitHub Actions.

---

### 17. NextAuth is a beta version

`next-auth@5.0.0-beta.31` — acceptable for an internal tool but worth tracking for stable release.

---

## Positive Findings

- All Dockerfiles run as non-root users
- Prisma ORM used consistently (prevents most SQL injection)
- Secrets stored in AWS Secrets Manager, not in code
- MCP OAuth implements PKCE with constant-time comparison
- Domain restriction on Google sign-in (`@launchpadphilly.org`, `@b21.org`)
- Tool permission ACLs checked on every call with DB-backed cache
- No hardcoded secrets anywhere in the codebase
- Usage logging on all MCP tool calls
- All external data validated with Zod schemas

---

## Priority Order

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | ~~AWS Jobs routes unauthenticated (#1)~~ | Critical | **FIXED** 2026-06-11 |
| 2 | ~~Approver email spoofing (#2)~~ | Critical | **FIXED** 2026-06-16 |
| 3 | ~~SQL injection fallback (#4)~~ | Critical | **FIXED** 2026-06-11 |
| 4 | ~~NODE_ENV guard on dev bypass (#5)~~ | High | **FIXED** 2026-06-11 |
| 5 | ~~Error message sanitization (#6)~~ | High | **FIXED** 2026-06-16 |
| 6 | ~~Rate limiting (#7)~~ | High | **FIXED** 2026-06-16 |
| 7 | ~~OAuth redirect URI whitelist (#8)~~ | High | **FIXED** 2026-06-16 |
| 8 | ~~Auth code race condition (#9)~~ | High | **FIXED** 2026-06-16 |
| 9 | ~~Terraform sandboxing (#3)~~ | Critical | **MITIGATED** 2026-06-16 |
| 10 | ~~SQL injection surface (#10)~~ | Medium | **FIXED** 2026-06-16 |
| 11 | ~~Service caller ACL bypass (#11)~~ | Medium | **FIXED** 2026-06-16 |
| 12 | ~~Direct process.env access (#12)~~ | Medium | **FIXED** 2026-06-16 |
| 13 | ~~SYNC_SECRET min length (#13)~~ | Medium | **FIXED** 2026-06-16 |
| 14 | ~~CSP headers (#14)~~ | Low | **FIXED** 2026-06-16 |
| 15 | ~~Failed login logging (#15)~~ | Low | **FIXED** 2026-06-16 |
| 16 | ~~Docker hardening (#16)~~ | Low | **N/A** — no longer using Docker |
| 17 | NextAuth beta (#17) | Low | Open — tracking |

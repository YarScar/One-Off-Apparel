# Phase 23 — MCP OAuth 2.0 Authorization

**Goal:** Replace the static `SYNC_SECRET` bearer-token check on the production MCP endpoints with the **MCP OAuth 2.0 authorization spec**, so the Anthropic Console can connect at the org level and every tool call is bound to a real Launchpad user identity with role-based access control.

**Status:** Planning. No implementation yet — this doc captures the design for review.

**Replaces:** the org-level integration story in `mcp-setup-instructions.md`. That file documented per-user Claude Desktop with a shared bearer token; it stays valid for power users but is no longer the supported path for general team access.

---

## Why this exists

Three things our current bearer-token model can't do, that the team needs:

1. **No single shared secret distributed to dozens of laptops.** One bearer for the whole team is one breach away from a full data leak.
2. **Per-user audit trail.** `usage_logs` should answer "who ran this tool" — not "the team's shared token did."
3. **Per-user permissions.** A program manager and a development director should not see the same fields.

The MCP authorization spec (RFC 9728 + 8414 + 7591 + OAuth 2.0 + PKCE) is the standard answer. Implementing it makes our MCP server work with the Anthropic Console's built-in "Add custom connector" flow.

---

## End-user workflow (non-developer)

### One-time per-device setup (~30 seconds)

1. Open Claude (web at claude.ai, desktop, or mobile) — signed into an Anthropic account in the Launchpad Anthropic org.
2. **Connectors** → see **LP Internal AI** listed (enabled org-wide by admin).
3. Click **Connect** → popup at `https://mcp.launchpadinc.org/oauth/authorize?...`.
4. Server: **"Sign in with Google to access LP Internal AI."**
5. Google OAuth — user picks their `@launchpadphilly.org` account.
6. First time only: server prompts **"LP Internal AI is requesting access to your account. Allow?"** — they click Allow.
7. Popup closes; Claude shows **Connected**.

### Daily use

User asks Claude something concrete: "Pull a brief on student John Doe." Claude picks the right MCP tool, includes the user's stored JWT in the request, server validates, runs tool, returns data. **No additional login UI ever** until token expiry.

### When login recurs

- **First time on a new device** — one Connect click (~5 sec popup).
- **Refresh-token expiry** — set to **30 days**; user reconnects once per cycle.
- **Account disabled** — admin disables their `users` row → next request fails with `account_disabled`; user can no longer use the tools until reactivated.

---

## OAuth flow (sequence)

```
USER                  CLAUDE/ANTHROPIC               OUR MCP SERVER              GOOGLE
 │                          │                              │                       │
 │  click Connect           │                              │                       │
 ├─────────────────────────►│                              │                       │
 │                          │  GET /.well-known/           │                       │
 │                          │      oauth-protected-resource│                       │
 │                          ├─────────────────────────────►│                       │
 │                          │◄─── { authServer: ... } ─────│                       │
 │                          │                              │                       │
 │                          │  GET /.well-known/           │                       │
 │                          │      oauth-authorization-server                      │
 │                          ├─────────────────────────────►│                       │
 │                          │◄─── { register, authorize,   │                       │
 │                          │       token, jwks } ─────────│                       │
 │                          │                              │                       │
 │                          │  POST /oauth/register (DCR)  │                       │
 │                          ├─────────────────────────────►│                       │
 │                          │◄─── { client_id } ───────────│                       │
 │                          │                              │                       │
 │  authorize popup         │                              │                       │
 │◄─────────────────────────┤                              │                       │
 │  GET /oauth/authorize?client_id=...&PKCE=...            │                       │
 ├────────────────────────────────────────────────────────►│                       │
 │                          │                              │  redirect to Google   │
 │◄────────────────────────────────────────────────────────┤                       │
 │  Google OAuth                                                                    │
 ├─────────────────────────────────────────────────────────────────────────────────►│
 │◄─────────────────────────────────────────────────────────────────────────────────┤
 │  /oauth/google-callback?code=...                                                 │
 ├────────────────────────────────────────────────────────►│                       │
 │                          │       (verify @launchpadphilly.org;                  │
 │                          │        ensure users.email exists, status=active)     │
 │                          │       (consent UI on first connect)                  │
 │  redirect to Anthropic with our auth code                                        │
 │◄────────────────────────────────────────────────────────┤                       │
 │  passes code to Anthropic                                                        │
 ├─────────────────────────►│                              │                       │
 │                          │  POST /oauth/token           │                       │
 │                          │  { code, code_verifier }     │                       │
 │                          ├─────────────────────────────►│                       │
 │                          │◄── { access_token (JWT, 1h), │                       │
 │                          │       refresh_token (30d) }──│                       │
 │                          │                              │                       │
 │  ── (Connected) ──                                                               │
 │                          │                              │                       │
 │  later: "ask Claude something"                                                   │
 ├─────────────────────────►│                              │                       │
 │                          │  POST /mcp                   │                       │
 │                          │  Authorization: Bearer <JWT> │                       │
 │                          ├─────────────────────────────►│                       │
 │                          │       (JWT verify;            │                       │
 │                          │        DB lookup roles;       │                       │
 │                          │        check tool ACL)        │                       │
 │                          │◄── { tool result } ──────────│                       │
```

Key points:

- **PKCE required** (S256). Anthropic does the dance; we just validate.
- **Dynamic Client Registration** (RFC 7591) — Anthropic registers itself with our server on first connection. No manual client provisioning per Anthropic org.
- **Two tokens**: short-lived access token (1h, JWT) and refresh token (30d, opaque DB-stored).
- **Identity delegation** to Google — we don't store passwords; we redirect to Google OAuth using the existing HQ OAuth client + an additional redirect URI.
- **Roles fetched fresh from DB** on every tool call — JWT only carries the user's stable identity (`sub` = email). Role changes take effect immediately without forcing reconnect.

---

## Database additions

New Prisma models. Migration to follow in the implementation PR.

```prisma
model User {
  email      String   @id
  status     UserStatus @default(PENDING)
  roles      String[] // e.g. ["program_staff"], ["leadership", "admin"]
  createdAt  DateTime @default(now())  @map("created_at")
  lastLogin  DateTime?                 @map("last_login")

  @@map("users")
}

enum UserStatus {
  PENDING
  ACTIVE
  DISABLED
}

model OAuthClient {
  clientId        String   @id                                   @map("client_id")
  clientName      String                                          @map("client_name")
  redirectUris    String[]                                        @map("redirect_uris")
  tokenLifetimeS  Int      @default(3600)                         @map("token_lifetime_s")
  createdAt       DateTime @default(now())                        @map("created_at")

  @@map("oauth_clients")
}

model OAuthAuthorizationCode {
  code            String   @id
  clientId        String                                          @map("client_id")
  userEmail       String                                          @map("user_email")
  redirectUri     String                                          @map("redirect_uri")
  codeChallenge   String                                          @map("code_challenge")
  expiresAt       DateTime                                        @map("expires_at")
  usedAt          DateTime?                                       @map("used_at")
  createdAt       DateTime @default(now())                        @map("created_at")

  @@index([expiresAt])
  @@map("oauth_authorization_codes")
}

model OAuthRefreshToken {
  tokenId         String   @id                                   @map("token_id")
  clientId        String                                          @map("client_id")
  userEmail       String                                          @map("user_email")
  expiresAt       DateTime                                        @map("expires_at")
  revokedAt       DateTime?                                       @map("revoked_at")
  createdAt       DateTime @default(now())                        @map("created_at")

  @@index([userEmail])
  @@index([expiresAt])
  @@map("oauth_refresh_tokens")
}
```

The existing NextAuth `Account` / `Session` / `User` tables stay for HQ sign-in — independent of MCP OAuth.

`usage_logs` already has `anthropic_user_email` (from the Phase 22 migration); we'll start populating it on every MCP call.

---

## Role model

Eight roles. Multi-role users are supported (`roles: String[]`).

| Role | Purpose |
|---|---|
| `pending` | Just connected for the first time. Cannot call any tool. Awaiting admin promotion. |
| `program_staff` | Day-to-day program team. Reads student / outcomes / attendance / certifications data. |
| `development` | Fundraising team. Reads donor + grant data. |
| `sales` | Business development. Reads HubSpot data + donor pipeline. (Most tools future.) |
| `finance` | Finance team. Reads accounting / line-item / aggregated revenue. |
| `software_dev` | Engineering. Reads GitHub + Notion (policies, meeting notes, client docs). (All tools future.) |
| `leadership` | Senior leadership. Full read access across every domain. |
| `admin` | Can manage `users` table via HQ `/admin`. Combinable with any other role. |

---

## Tool → role ACL (current tools)

| Tool | program_staff | development | sales | finance | software_dev | leadership | admin |
|---|---|---|---|---|---|---|---|
| `get_student_info` | ✓ | | | | | ✓ | ✓ |
| `query_students` | ✓ | | | | | ✓ | ✓ |
| `query_outcomes` | ✓ | | | | | ✓ | ✓ |
| `query_enrollment` | ✓ | | | | | ✓ | ✓ |
| `query_certifications` | ✓ | | | | | ✓ | ✓ |
| `query_competency` | ✓ | | | | | ✓ | ✓ |
| `query_attendance` | ✓ | | | | | ✓ | ✓ |
| `query_donors` | | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `query_finances` | | | | ✓ | | ✓ | ✓ |
| `get_finance_brief` | | | | ✓ | | ✓ | ✓ |
| `get_entity_brief` | | ✓ | ✓ | | | ✓ | ✓ |
| `search_by_person` | ✓ | ✓ | | | | ✓ | ✓ |
| `search_conversations` | ✓ | | | | ✓ | ✓ | ✓ |
| `search_documents` | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |

### Future tools (placeholders, not yet implemented)

| Tool | Source | Allowed roles |
|---|---|---|
| `query_hubspot_contacts` | HubSpot | sales, leadership, admin |
| `query_hubspot_deals` | HubSpot | sales, leadership, admin |
| `query_github_issues` | GitHub | software_dev, leadership, admin |
| `query_github_prs` | GitHub | software_dev, leadership, admin |
| `query_policy` | Notion | software_dev, leadership, admin, program_staff |
| `query_clients` | Notion | software_dev, sales, leadership, admin |

These are documented now so the registry has slots for them when the connectors ship — no schema or auth churn needed at that point.

---

## Field-level redaction (deferred to follow-up PR)

The implementation PR for this phase will ship **tool-level ACL only** — every field returned by an allowed tool is visible. The field-level redaction layer (e.g. hiding `ssn`, `homeAddress` from non-leadership roles) is a follow-up that doesn't block initial rollout.

When we do that follow-up, the registry shape will look like:

```ts
type FieldGate = { field: string; roles: Role[] };
const FIELD_GATES: Record<string, FieldGate[]> = {
  query_students: [
    { field: 'firstName', roles: ['program_staff', 'leadership', 'admin'] },
    { field: 'lastName',  roles: ['program_staff', 'leadership', 'admin'] },
    { field: 'phone',     roles: ['leadership', 'admin'] },
    { field: 'homeAddress', roles: ['leadership', 'admin'] },
    { field: 'ssn',       roles: ['admin'] },
    // ...
  ],
};
```

Then the `runTool()` wrapper redacts the response before returning. Open question for the field-level PR: which fields and which roles. Needs a one-pass schema review with stakeholders.

---

## Admin UI (HQ `/admin`)

A new page in the HQ Next.js app:

- **Users table** — email, status, roles (chips), last login, "promote" / "disable" buttons.
- **Search + filter** by role / status.
- **Audit pane** — recent role changes (who changed whom, when), pulled from a new `audit_log` table (also added in the impl PR).
- **Gated to `admin` role only** — middleware redirects non-admins.

Christian starts as the only `admin`. Adds others through the UI as needed.

### Default behavior for new sign-ins

First time a `@launchpadphilly.org` user clicks Connect:

1. Google OAuth succeeds.
2. Server creates `users` row with `status=PENDING`, `roles=[]`.
3. Server **does not** issue an access token; instead the OAuth flow returns `access_denied` with a message: **"Your account is pending approval. An admin has been notified."**
4. Optional: send Slack / email notification to `admin` users — out of scope for the first PR.
5. Admin promotes them via `/admin` → next Connect attempt succeeds.

---

## Token policy

- **Access token (JWT)**: lifetime **1 hour**. Carries `sub` (email), `iss` (`https://mcp.launchpadinc.org`), `aud` (`mcp.launchpadinc.org`), `iat`, `exp`, `jti`. **Does not** carry roles — those are fetched fresh from DB per request.
- **Refresh token**: lifetime **30 days**. Opaque token ID; full row stored in `oauth_refresh_tokens` for rotation and revocation.
- **Refresh rotation**: each refresh issues a new refresh token + revokes the old (single-use). Catches token theft.
- **Revocation**: admin can revoke all refresh tokens for a user from the admin UI ("Force re-auth").

JWT signing: RS256 with a 2048-bit RSA keypair stored at `lp-internal/jwt-signing` in Secrets Manager. JWKS endpoint at `/.well-known/jwks.json` exposes the public key.

---

## Implementation plan

When approved, the implementation PR will include:

1. **Add dependency**: `oidc-provider` (Apache 2.0). Most of the OAuth machinery comes from this library — discovery, DCR, authorize, token, JWKS endpoints. We configure it; we don't roll our own.
2. **`apps/mcp-server/src/oauth/`** — adapter modules that plug `oidc-provider` into our Prisma store and our Google-delegated identity.
3. **New endpoints** mounted on the existing HTTP server in `serve-http.ts`:
   - `/.well-known/oauth-protected-resource`
   - `/.well-known/oauth-authorization-server`
   - `/.well-known/jwks.json`
   - `/oauth/register`
   - `/oauth/authorize` (renders consent UI on first connect; auto-approves on subsequent)
   - `/oauth/google-callback`
   - `/oauth/token`
4. **`apps/mcp-server/src/permissions.ts`** — the role + tool registry from the tables above, plus a `checkToolAccess(email, tool)` function called by `runTool()`.
5. **`apps/mcp-server/src/auth.ts`** — JWT verification middleware. Replaces the `SYNC_SECRET` bearer check on `/mcp`.
6. **`SYNC_SECRET` doesn't go away** — it stays usable for service-to-service calls (e.g. EventBridge → MCP for sync triggers, which never have a human identity). The middleware accepts either a valid JWT *or* `Authorization: Bearer $SYNC_SECRET` for backwards compatibility with the cron path. The latter is logged distinctly in `usage_logs` (`anthropic_user_email='_service'`).
7. **Mirror in `apps/aws-mcp-server`** — same JWT validation, same JWKS source.
8. **Migration** for the four new tables.
9. **New JWT signing secret** generated and stored in Secrets Manager.
10. **HQ `/admin` page** — user management UI.
11. **Documentation** — update `mcp-setup-instructions.md` to point general users at the Anthropic Console flow; keep the desktop bridge as the "advanced / developer" path.
12. **Anthropic Console pairing** — admin retries adding the connector; this time the OAuth flow completes; we verify a sign-in end-to-end.

### Estimate

- With `oidc-provider`: **1 to 1.5 days** of focused implementation + testing.
- Plus ~half a day for the HQ `/admin` page and tests.
- Total: ~2 days clock time, broken into 2-3 PRs (OAuth server + admin UI + cutover).

---

## Open questions

None blocking — every decision above came from the most recent design pass. Items deliberately deferred:

- **Field-level redaction** — separate follow-up PR.
- **Notification on `pending` user sign-in** — Slack / email integration deferred.
- **Per-tool rate limiting** — could come for free from `oidc-provider`'s rate-limit hooks if we need it.

---

## Out of scope for this phase

- Service accounts for non-human integrations (e.g. n8n calling MCP) — would be a separate `client_credentials` OAuth grant later.
- Federated SSO providers beyond Google — not needed; Launchpad is Google Workspace.
- Multi-tenancy — single Launchpad org for the foreseeable future.

---

**Next:** approval on this plan → implementation PR(s).

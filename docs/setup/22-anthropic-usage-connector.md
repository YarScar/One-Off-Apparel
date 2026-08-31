# Phase 22 — Claude Code Telemetry Ingestion

**Goal:** Populate the HQ home page's "Claude token usage" and "Claude Code activity" sections
with real per-person data — token consumption, cost, and tool/session activity.

**Status:** Live. `apps/hq/app/api/telemetry` receives it; `apps/hq/app/page.tsx` displays it.

---

## Why this replaced the original Admin API plan

The original version of this doc planned to pull usage from Anthropic's **Admin API**
(`/v1/organizations/usage_report`). That requires an Enterprise plan — Team plans (what this
org is on) only expose a manual CSV export from the claude.ai console, with no API and a
built-in one-day delay.

Claude Code has its own **OpenTelemetry export**, independent of the Team/Enterprise
distinction — it's a Claude Code CLI feature, not a claude.ai billing feature. It reports
token usage, cost, and session/tool-call activity in real time, and (for this org, which
does its work through Claude Code) is a superset of what the Admin API would have given —
it adds per-tool-call activity detail the Admin API doesn't carry at all. That's what this
phase builds against instead.

The trade-off, for the record: this covers Claude Code specifically, not `claude.ai` web
chat, Projects, Cowork, or Office Agents — a gap the Admin API wouldn't have had. And unlike
the Admin API, this is a pipeline we own and have to keep an eye on ourselves (see
"Watching it" below), not a service Anthropic runs for us.

---

## How it fits together

1. **Ingestion** — `apps/hq/app/api/telemetry/v1/metrics` and `.../v1/logs` accept OTLP/HTTP
   JSON POSTs (the format Claude Code's exporter sends). Auth is a shared bearer token,
   `CLAUDE_TELEMETRY_SHARED_TOKEN`, checked in `_lib/auth.ts` — this endpoint is
   unauthenticated at the NextAuth/middleware layer (Claude Code has no Google session to
   present), same pattern as the Notion webhook receiver.
2. **Storage** — two tables, `claude_telemetry_metrics` (token/cost/session-count data
   points) and `claude_telemetry_events` (tool calls, prompts, other session activity).
   Both key their upsert on a hash of the raw data point (`sourceId`), so a retried/re-sent
   export can't double-count — the same discipline this repo's sync connectors use, applied
   to a push endpoint instead of a pull.
3. **Display** — `apps/hq/app/page.tsx`'s `fetchTokenUsage` / `fetchClaudeActivity` read
   these tables directly (not `usage_logs`, which only ever covers calls to *our own* MCP
   tools, a narrower thing than "all Claude Code activity").
4. **Health** — `apps/hq/app/api/telemetry/status` and the badge next to "Claude token
   usage" on the home page both check "has anything actually arrived recently," not just
   "is the server up." The threshold is day-scale on purpose — nights and weekends are
   legitimate silence, not a broken pipeline.

---

## Turning it on for the team

Once the endpoint is deployed and reachable at a real URL, an **Owner** or **Primary
Owner** on the Claude organization (not just any Admin) configures it from
[`claude.ai/admin-settings/claude-code`](https://claude.ai/admin-settings/claude-code) →
Managed settings — no per-laptop file, no MDM:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://<hq-domain>/api/telemetry",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <CLAUDE_TELEMETRY_SHARED_TOKEN>"
  }
}
```

The exporter appends `/v1/metrics` and `/v1/logs` to that base endpoint itself — don't
include those suffixes in the configured URL. Each teammate sees a one-time approval
dialog in Claude Code the first time this reaches them (Claude Code always asks before
applying a policy that sets a real destination URL).

---

## Unverified assumptions — check these against real traffic first

These were built from Claude Code's published metric/event names and the general OTLP
spec, not from inspecting a real export (nothing in this environment could enable
telemetry and capture real traffic). Before trusting the numbers:

- **The `type` attribute on `claude_code.token.usage`** is assumed to hold `input` /
  `output` / `cacheRead` (or `cache_read`) — this is what splits the input/output/cache
  columns on the home page. If the real attribute key or values differ, the *total*
  tokens figure stays correct (it doesn't depend on `type`), but the breakdown columns
  will read zero. Check `attributes` on a few real `claude_telemetry_metrics` rows to
  confirm, and adjust the `CASE WHEN` clauses in `fetchTokenUsage` (`apps/hq/app/page.tsx`)
  if the key or values are different.
- **`eventName` vs. an `event.name` attribute** — the logs route checks both, since OTLP's
  event-log convention has shifted between a dedicated field and an attribute over time.
- **Field names in general** — `user.id`, `user.email`, `session.id`, `tool_use_id`, etc.
  are read from OTLP attributes as documented by Claude Code; the full raw attribute set
  is always kept in the `attributes` JSON column on both tables regardless, specifically
  so a wrong mapping guess is recoverable without losing data — reprocess `attributes`
  once the real shape is confirmed, rather than re-collecting.

Do this check as part of testing on one person before turning telemetry on for the whole
team (see the "test on one or two people first" step in the rollout plan).

---

## Watching it

Unlike the Admin API (Anthropic's own service, billing-grade, backed by their pipeline),
this is infrastructure we run — a health check has to be someone's job:

- `/api/telemetry/status` and the badge on the home page say whether data is actually
  flowing, not just whether the server responds.
- Errors in the ingestion routes should reach the same Sentry project the rest of HQ uses.
- The `claude_telemetry_events` table especially can grow fast (one row per tool call,
  across the whole team) — worth a retention policy (e.g., keep 90 days of detail, matching
  the CSV export's own window) once this has been running a while.

---

## Known pitfalls

- **This is Claude Code activity only** — it does not see `claude.ai` web chat, Projects,
  Cowork, or Office Agents usage. If someone chats with Claude outside Claude Code, that
  usage won't appear here.
- **A retried export is deduplicated, not rejected** — the `sourceId` hash upsert means a
  legitimate resend lands as a no-op update, which is correct, but also means a bug that
  hashes two genuinely different data points to the same value would silently drop one.
  Watch for suspiciously round numbers if this is ever suspected.
- **The shared bearer token is one token for the whole org** — anyone with it can post
  fake data. It's a shared secret, not per-user auth; rotate it via
  `CLAUDE_TELEMETRY_SHARED_TOKEN` and the console's `OTEL_EXPORTER_OTLP_HEADERS` together
  if it ever leaks.

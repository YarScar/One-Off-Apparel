# Phase 22 — Claude Usage on the HQ Dashboard

**Goal:** Populate the HQ home page's "Claude token usage" section with real per-person
data — token consumption and cost across the whole team.

**Status:** Live, via manual CSV import. See `apps/hq/app/csv-upload`.

---

## How we got here

This section was originally built years ago, wired to read token columns on `usage_logs`
that a planned **Anthropic Admin API** connector was supposed to fill. That connector was
never built — the Admin API requires an **Enterprise** plan, which this org doesn't have
(Team plans get no usage API at all, per Anthropic's own docs).

We then built and fully verified a second approach: **Claude Code's OpenTelemetry export**,
which reports token/cost/activity data in real time and isn't gated by Team vs. Enterprise
at all — it's a Claude Code CLI feature, independent of the claude.ai billing plan. It
worked end-to-end against a real terminal session. But it has a confirmed, unfixed
upstream limitation: OpenTelemetry reporting does not work from Claude Code's **VS Code
extension** (github.com/anthropics/claude-code/issues/35105, closed by Anthropic as "not
planned") — only from the terminal CLI. Since this team's Claude Code usage is almost
entirely through the VS Code extension, that pipeline would have shown data for one or two
people and looked like almost nobody uses Claude, which is worse than not having the
feature at all. That work was set aside rather than shipped here.

**What's actually live**: a manual import of Anthropic's **Team-plan spend-report CSV**
(`claude.ai` → Settings → Analytics → "Export spend report," Owner/Primary Owner only).
It's server-tracked by Anthropic, so unlike OpenTelemetry it sees every Claude surface for
every person — the real trade-off is that there's no API for it on Team plan, so someone
has to download and re-upload it by hand periodically to keep it current.

---

## How it works

1. Someone with the Owner or Primary Owner role exports the CSV from claude.ai.
2. They upload it at `/csv-upload` on HQ (protected by the normal Google sign-in — no
   special credential needed, since a person is already logged in when they use it).
3. `apps/hq/app/api/csv-upload/route.ts` parses it (loosely matching column headers, since
   nobody in this org had actually seen a real export when this was built — see the note in
   `apps/hq/app/api/csv-upload/_lib/parse.ts`) and stores it in `claude_csv_uploads` /
   `claude_csv_usage_rows`.
4. The home page's "Claude token usage" section (`apps/hq/app/page.tsx`) reads the *latest*
   upload and shows per-person totals, with a note on how current the data is.

## Keeping it current

There's no automation for this on Team plan — someone (Chris, or whoever holds the Owner
role) needs to re-export and re-upload periodically. Weekly is a reasonable cadence given
the export's own 90-day lookback window.

## Verification checklist

- [ ] A real CSV export has been uploaded at `/csv-upload` and parsed without errors
- [ ] The parsed columns (user, tokens, cost) match what the actual downloaded file shows —
      confirm this against a real export, since the parser was built from Anthropic's
      support documentation, not a real sample file
- [ ] The home page shows real per-person numbers, not the "no spend report uploaded yet"
      banner

## Known pitfalls

- **Column names are unverified.** If a column doesn't match, the row still saves (nothing
  is dropped — the raw row is kept in `rowData`), but the parsed total for that column
  reads zero. Check a real upload's rows against the source file directly if numbers look
  off.
- **This is a snapshot, not a running total.** Each upload replaces "the latest picture";
  it doesn't merge with the previous one. Re-uploading with a wider date range is how you
  see more history.

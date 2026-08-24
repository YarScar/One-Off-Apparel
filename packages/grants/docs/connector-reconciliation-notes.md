# Connector reconciliation notes

Staff-only audit trail of read-only cross-checks between the KB corpus (`seed/kb_launchpad.json`)
and the live LP Internal AI MCP connector. **Not read by any code path** — not `data.ts`'s integrity
scan, not `pipeline.ts`, not any tool a drafting model can reach. Append a new dated entry each time
a reconciliation pass runs; do not edit old entries in place, so the trail stays honest about when
each figure was true.

This file replaced `kb.meta.connector_reconciliation` (removed 2026-08-21, WP #322): that field held
the same kind of content but lived inside `kb_launchpad.json`, which the platform treats as
answer-bearing corpus — `computeIntegrityReport`'s `stored_literal_figure` staleness scan covers
`kb.answers`, but nothing scanned `kb.meta`, so this content aged silently for a month with no
warning anywhere. Moving it here removes that risk instead of extending the scan to cover it: this
file is documentation, not corpus, so a stale figure here can't leak into a draft.

## 2026-07-23 — reconciliation pass

Cross-checked KB narrative against the live connector 2026-07-23 (read-only queries).

**CONFIRMED/REFRESHED — Employment:** connector aggregate = $360,487 paid to 45 participants across
86 jobs (asOf 2026-07-23), confirming and slightly updating the William Penn Jul 2026 figure
($350,268 / 45 / 88 jobs); 45 participants matches exactly. Per the recency rule the connector figure
is now the most-recent, but narrative numbers feed live drafts — do NOT silently overwrite; align
when a draft is finalized.

**FLAGS FOR STAFF** (definitional gaps, not auto-changed):

1. **SERVED COUNT** — connector reports 301 total distinct student records (all phases/statuses/
   all-time); the 2026 apps say "~145 served." Likely "meaningfully participated" vs. "all records" —
   reconcile which definition a funder should see.
2. **PCEP** — connector all-time pass rate = 32/59 = 54.2%; KB narrative says "70–100% per cohort,
   100% most recent." The aggregate (incl. all fails/cohorts) is lower than the per-cohort framing —
   reconcile before quoting a rate.
3. **LIGHTSPEED** — connector confirms the phase EXISTS (Foundations→101→Lightspeed→LiftOff; 15
   Lightspeed completions) but KB program descriptions (`kb.programs`, `kb.program_desc`) omit it —
   CONTENT GAP to fill. Confirmed 2026-07-29: no answer in this file mentions Lightspeed. Still true
   as of 2026-08-11 (`docs/STATE.md` doc-debt #7) — the facts now exist in `enrollment_by_phase` in
   `src/figures.ts`; writing the copy is a staff decision, not an engineering gap.
4. **POSTSECONDARY** — connector: 67 distinct students with NSC college records, 3 graduated (4.5%
   completion) — new datapoint available if a funder asks about college persistence.

**LIMITATION:** `query_finances` and `query_donors` are blocked by the permission classifier in the
current mode (sensitive finance/donor PII); use `get_finance_brief` (fund balances) + `sources/` for
budget/donor facts, or run those queries in a session with finance access.

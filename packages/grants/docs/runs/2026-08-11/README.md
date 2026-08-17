# Pipeline run, 2026-08-11

An observation run of the whole grant-writing pipeline as it stands today, over four real form
fixtures. Nothing here was filed. Nothing here is submittable.

Bank version at run time: the working tree of `writing/dev` at commit `d15d9e4` plus the uncommitted
`seed/questions.json` changes. Figures verified live against LP Internal AI on 2026-08-11.

## What ran

```bash
pnpm --filter @lp-ai/lib-grants build
node packages/grants/docs/runs/2026-08-11/run-drafts.mjs <out-dir> \
  hamilton_loi_2025 wpf_workforce_2026 jff_ai_pathways_2026 aug7_gsk
```

`run-drafts.mjs` calls `loadForm` → `runPipeline` → `renderMarkdown` per fixture. It reads only.

Then, by hand: the 12 figure checks the work order named were run against the MCP connector, the
answers were filled and rewritten to the style rules, and `count.mjs` was run over every filled
answer.

## Layout

| Path | What it is |
|---|---|
| `package/*.md` | `renderMarkdown` output, unedited. The reviewable draft package the layer produces. |
| `package/*.json` | The `DraftPackage` object behind each render, including the figure work order. |
| `filled/*.FILLED.md` | The applications after live figure verification and drafting. 29 of 44 fields answered, 15 marked `[STAFF]` with the reason. |
| `filled/FIGURE-LEDGER.md` | All 12 figure checks: KB claim, live value, tool, verdict. Read this first. |
| `filled/counts-input.json` | The `count.mjs` input. All 44 answers passed: none over limit, no em dashes, no banned jargon. |

The unobtained-information register this run produced lives in `../../INFORMATION-GAPS.md` and stays
current as gaps close; this folder is the dated snapshot of the evidence.

> **Superseded in part, 2026-08-14 — do not read the budget fields as current.** Every
> `[DATA UNAVAILABLE]` budget field in `filled/*.FILLED.md` was caused by two tool defects, not by
> missing data. Both fixes (PRs #49 and #50) merged and deployed on 2026-08-13, and the figures were
> re-sourced live on 2026-08-14: **Total Income actuals $1,572,906.30, Total Expense actuals
> $1,734,075.87, per-phase actuals launchpad $1,532,790 / hs $459,805 / liftoff $446,220.** The
> `.FILLED.md` files are **left exactly as they were run** — they are the record of what the pipeline
> produced on 2026-08-11, not a current draft. Read `filled/FIGURE-LEDGER.md` under "Re-source,
> 2026-08-14" for what those fields would hold today, and note that the new figures still carry **no
> fiscal year**, so none of them is filable without a staff decision. Work package `#216`.

## Per-form result

| Form | Questions | Matched | Filled | `[STAFF]` | Notes |
|---|---|---|---|---|---|
| `aug7_gsk` | 15 | 15 @ 1.00 | 11 | 4 | Most complete of the four. Two routing defects surfaced here. |
| `wpf_workforce_2026` | 12 | 12 @ 1.00 | 8 | 4 | One `compression_infeasible` (250-char field against a 1,403-char stored answer) and one `derive_from_reference`. |
| `jff_ai_pathways_2026` | 8 | 8 @ 1.00 | 6 | 2 | Narrative-heavy, no stated limits, one attachment field. |
| `hamilton_loi_2025` | 9 | 9 @ 1.00 | 4 | 5 | Mostly cover-sheet dollar amounts and dates. |

All 44 matches landed at 1.00 because all four fixtures are funders whose wordings are already in the
bank. This run says nothing about matcher behaviour on an unseen funder.

## What the run found

**The deterministic layer behaved.** Seed integrity clean. `compression_infeasible` correctly refused
to squeeze WPF's project description rather than truncating it, and `needs_attachment`,
`derive_from_reference` and `per_application` each routed to the right actor.

**Live drift on the headline figure.** The KB's `$350,268 across 88 jobs` is now `$367,662.19 across
86 consolidated jobs`, same 45 participants. The `~$20/hr` claim holds only for currently active jobs
(`$19.28`); the all-time average is `$15.52`.

**A phase missing from the KB.** The platform records a **Lightspeed** phase with 15 completions that
no KB program description mentions. A program description drafted from the KB alone is incomplete.

**Three checks the named calls cannot satisfy.** `get_finance_brief(ytd)` returns no income or expense
total, `query_finances(phase_budget_dashboard)` returns zero records, and the staff-roster
`search_documents` returns zero results. Every budget field in all four applications is
`[DATA UNAVAILABLE]`, including Hamilton Q3 "Total Cost", which the pipeline classified `fetch_figure`
and pointed at a call that cannot answer it.

**Two question-bank routing defects, both at 1.00 confidence**, both in `seed/questions.json`:

- `"Website"` is a registered wording for `cover.address`, so GSK Q15 and WPF Q5 both answered with
  the street address.
- `"Year your organization received 501(c)(3) status"` routes to `cover.ein_taxstatus` and returns the
  EIN. The determination year is not in the KB at all.

Same class as the `cover.address` defect already documented in the grant-writing skill: a confident
match to the wrong slot is worse than no match, because nothing downstream flags it.

**Stored answers fail this repo's own style gate.** The KB text is full of em dashes, which
`references/style.md` bans and `count.mjs` fails on. Every answer in `filled/` had to be rewritten to
strip them. A draft taken straight from `renderMarkdown` will not pass `count.mjs`.

**Two definitional conflicts reached the drafts and stayed there as questions.** "Black or Brown" is
80.4% or 96.0% of the 301 enrolled depending on which rows count, and PCEP is 54.2% all-time or
70-100% per cohort. Both are marked `[STAFF]` in every draft that uses them rather than resolved.

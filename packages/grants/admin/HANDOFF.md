# Grant writing layer — cover note

**Date:** 2026-07-28
**From:** Demitri DeLuca-Lyons
**To:** Rob Thomas, VP of Technology
**Re:** Where to look, and what to flag

## Why there are four documents now

The first pass was one long document that mixed the pitch, the architecture, and the build steps. It is split. Each document has one audience and one job.

| Document | What it is | Who it is for | Your interest |
|---|---|---|---|
| `PROPOSAL.md` | Scope, deliverables, timeline, three decisions. Brief. | The project manager, and anyone outside engineering | Confirm the scope and the deliverables read correctly |
| `TAD.md` | Architecture, security, compliance, data governance. | **You** | **This is the one to review for flags** |
| `SPEC.md` | Build detail and release gates. | The developer | Skim only, if you want the depth |
| `README.md` | Folder index. | Anyone opening the folder | None |

`PROPOSAL.md` is the document that goes outside engineering. `TAD.md` and `SPEC.md` stay internal.

## What changed from what you saw

- **Scope and deliverables are now explicit.** `PROPOSAL.md` section 2 is scope, in and out. Section 3 is six named deliverables, each with a completion test. That was the main gap you hit.
- **Security and compliance has a real home.** `TAD.md` section 2: a threat model line, a seven-control table, and the reasons. `PROPOSAL.md` section 5 carries a short summary that points at it, so a non-technical reader sees the posture without the detail.
- **The proposal is much shorter.** It lost the module names, the code, the internal findings, and the revision history. All of it moved to `TAD.md` or `SPEC.md`. Nothing was deleted.
- **The spec is now a build guide with release gates**, not a monolith. Five gates, G1 to G5, each with a pass condition. The architecture and the data rules moved out of it into `TAD.md`.

## Three things worth your flag check

**1. One security control is load-bearing, and it constrains the design.** The layer returns a *list* of data calls and never makes one. The caller runs each call under its own identity. The reason: the permission check reads the inbound tool name, so a grant tool that read the database itself would get finance and donor data authorised as a grant read. `TAD.md` section 2.3. If you disagree with that reading of the ACL, it changes the shape of the draft builder, so it is worth five minutes.

**2. There is one external dependency, and it needs an owner.** Two Notion sources are not reaching the platform. The design requires every teamspace read to go through the platform so it is permission-checked and logged, and that rule does not work until this is fixed. It is a configuration change on the Notion connector, not code, but it is not our package. `TAD.md` section 4.3 has the evidence; `SPEC.md` section 7 has the mechanics.

**3. One risk can move the timeline, and it is scheduled first for that reason.** The matcher needs a Python standard-library function rebuilt in TypeScript. If it does not reach parity, everything above it is unreliable. That is release gate G2, in week 2, with three named outcomes including "stop and re-plan". `SPEC.md` section 5.

## Status

Deliverable 1 — the question bank and knowledge base — is built and checked: 88 questions, 11 categories, 29 approved answers, 248 recorded funder wordings, 7 form fixtures. The knowledge base is a prototype build, sufficient to proceed, and it expands when the Data team finalises.

A working prototype proves the whole method and runs today. Its test suite is the quality bar: 45 tests cover this path. We rewrite in TypeScript rather than move the Python, for toolchain consistency — `TAD.md` section 1.3.

## Progress since this note was written (2026-07-29)

We started building before approval, on the understanding that these documents stay open and get corrected as the work turns things up. **Gates G1 and G2 have passed. G2 was the risk gate, and it passed on the best of its three outcomes. G3 is built and its gate is still open** — refer to `SPEC.md` §1.

Figures below revised 2026-08-04.

| | |
|---|---|
| Modules | 9 (added `handback.ts` and `pipeline.ts` at G3) |
| Tests | 162 in this package, 207 across the repo. No network; this package needs no database |
| Tools registered | 3 of 3 — `grant_match_question`, `grant_build_draft`, `grant_resize_answer` |
| Type check | clean across all fourteen packages |
| Lint | clean on `packages/grants`; repo-wide baseline 415, tracked separately |

**The sequence-ratio parity risk is closed.** `SPEC.md` section 5 called this the one real technical risk, because a divergence would change every match score. Result: 28,690 of 28,690 recorded `difflib` ratios reproduce exactly, and all 337 recorded `match_question` results reproduce field for field, including the winning variant source and the rounded confidence. All 69 questions across the four form fixtures produce byte-identical output from the TypeScript build and the Python original. Equality is asserted with `!==`, not a tolerance.

The 13 tests this document offered as the G2 bar were not sufficient on their own — they are behavioural invariants that an approximate ratio function would also pass. The real bar is a pair of fixtures generated by running CPython's `difflib` and the prototype's own matcher over the real bank.

### Five things worth your flag check

1. **There was no platform Anthropic client, and we no longer need one.** `TAD.md` decision 6 said to reuse it. `@anthropic-ai/sdk` is in no `package.json` in this repository, and `ANTHROPIC_API_KEY` is declared in the config schema but never read. Building one would have solved the wrong problem: the prototype needs a Claude client because a Python CLI has no model in the loop, but an MCP tool is invoked *by* Claude. So the resize tool returns the answer, the limit, the measurement, and the guardrails, and the calling Claude does the rewrite. The layer now has no outbound call at all, which keeps "no new external dependency" true and removes all mocking from the test suite.

2. **One of the two seed integrity warnings was a bug in the checker, not in the data.** It flagged all eight attachment questions for carrying a `kb_ref`, but all eight route correctly — `kb.docs` holds exactly the checklist of documents to attach. The check now allowlists the attachment slots and flags only an attachment question pointing at ordinary prose, which is the defect its own comment always described. The other warning was a stale slot name (`kb.serve`), retargeted to the real slot. **The content gap it was carrying is still open**: no answer in the knowledge base mentions Lightspeed, and that is a Data team task.

3. **The Notion item is handed off and is out of our gate.** Two corrections: "configuration, not code" held for the Grant Applications database but never for the Playbook, because the connector reads databases only and the Playbook is a page. And the Playbook question is now moot — it is in the repository at `docs/PLAYBOOK.md`. A third source also surfaced that appears in none of these documents: a Research Wiki database the drafting guidance depends on.

4. **The Playbook asks for things these documents do not sanction, and we deliberately have not resolved them.** It opens by having Claude *create* a Grant Applications record and closes by *updating* it — a write path, against control 6 and the `readOnlyHint` on every planned tool. It also carries two rules stronger than anything in `TAD.md` section 3 (never name an entity not traceable to a confirmed current source; ask the fiscal-sponsorship framing every time), and it reconciles the wage claim as $550K stale versus $300K current where `TAD.md` section 3.2 documents $350,268 versus $362,361.82. **Decision: build the pipeline first, then assess.** Watering either document down to match the other before we can see a real draft package would be guessing.

5. **Two ordinary grant questions do not match confidently, and that is the prototype's behaviour, not a port defect.** "How will you measure whether the program succeeded?" and "Upload your IRS letter of determination." both score below the 0.42 threshold in the Python original and in ours. They route to human review, which is the safe outcome, but it suggests the bank wants variants for them. A matching quality review is worth scheduling separately from parity.

   **Reviewed 2026-08-03 under board B6 (#62). Half closed.** The review confirmed this flag was right
   that it is not a port defect, and turned up three things the flag did not anticipate.

   - **Neither question was mis-routing.** Both already matched the correct canonical entry, with the
     widest margin over the runner-up of any sub-threshold case. Only the confidence flag was wrong.
   - **The IRS question is fixed** by a real FFTC wording that was never recorded — `Attach IRS
     letter.` — which lifts it from 0.351 to 0.43. Bank v0.3.1.
   - **The success-measures question cannot be fixed by adding variants**, so this flag stays open for
     it. The shortfall is one unstemmed inflection: the same sentence scores 0.352 with `succeeded` and
     **0.644 with `success`**. Six real sourced wordings were trialled and none moved it.
   - **Both strings are the prototype's own smoke-test samples** — `matcher.py` lines 160–161, inside
     `if __name__ == "__main__"` — and appear in no funder form. The guess that "the bank wants variants
     for them" was therefore half wrong: the real wordings behind both questions were already recorded.
     Adding these two would mean inventing a funder source.

   What remains is a decision, not a task: accept the safe human-review outcome, or add stemming and
   move the parity baseline off the filed-application prototype. `TAD.md` should record whichever.
   **Recommend accepting** — the question appears on no real form, so stemming would move the G2 parity
   baseline for a case that has never occurred. The measurement is on #62 and in `../CHANGELOG.md`.

   **Reviewed again 2026-08-04, and this flag had the risk model backwards.** It measures misses. Across
   all 106 questions in the seven form fixtures, **105 of 106 match confidently**, and the one miss is
   the intended control. Recall is not the problem. The damaging class is a **confident wrong match**: a
   miss routes to staff review and says so, while a confident wrong match routes to a knowledge-base slot
   and the draft presents that slot's content as the answer. Four were found by scanning each confident
   match's `answer_type` against what the funder's wording asks for.

   - **One fixed** (bank v0.4.1). JEVS's conflict-of-interest question matched `attachments.board_list`
     at 0.459, confidently, on "Board of Directors" — so a yes/no disclosure routed to `kb.docs`. No
     entry covered conflict of interest at all, which is why variants could never have fixed it. Added
     `cover.funder_connection`. Both parity fixtures regenerated, control pass first; exactly one existing
     matcher case changed and it was the defect.
   - **Three recorded** on `bd` `grant-h32`, all on `aug7_truist`, all bank-typing rather than KB gaps —
     including the Truist `demographic` question `grant-miy` carved out for this review.
   - **`grant-miy`'s count corrected 42 → 35.** Eight non-narrative entries have `kb_ref: null` and route
     to `per_application`, which is right, not a gap.

### Not verified, and why

**Rewritten 2026-08-04.** Everything this section previously listed was fixed on 2026-08-03 and the old text is gone — it claimed there was no `.env`, no Docker daemon, an unapplied permission migration, and a repository-wide `pnpm lint` break from a missing `@eslint/js`. None of that is true now: the local database runs, the migrations are applied, `grant_match_question` was driven through the server with real bearer tokens, and lint runs. Refer to `../CLAUDE.md` §3 for the current snapshot, which is the owner of this claim.

What is genuinely unverified today, and it is narrower:

- **Everything is local.** Whether the grant `tool_permissions` rows exist on RDS is unknown, and the apply has no named owner. Board A3 (#52). Also unknown for production: whether `student_postsecondary` and `aws_resource_jobs` exist there.
- **`grant_build_draft`'s ACL path has never been driven.** Its permission row exists and was confirmed by query, so it will resolve, but nothing has repeated the bearer-token method for it. **A green test run is no evidence here** — `tool-helpers.ts` reaches `canCallTool()` only when `currentCaller` is set, and only `serve-http.ts` sets it, so not even the integration suite that spawns the real server touches the ACL branch.
- **The G3 gate's parity half — settled 2026-08-04.** Restated as 20 cases; the 5 that tested a resizer moved onto G4, whose bar became 12. Both gates then passed. Board D2 (#72).

## The three decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Add the two Notion sources to the copy list, and name an owner. | Approve. Configuration change. |
| 2 | Who may use the three grant tools. | Leadership and administrator. Mandatory — the platform denies any tool without a permission record. |
| 3 | Keep the question bank in files for now, rather than the database. | Keep files until the tools pass their test bar, then review. |

`PROPOSAL.md` section 8 holds the reasoning.

## On process

We have not defined a process for this kind of document, so treat the split as a first proposal for one rather than a finished standard. If the shape is wrong — different documents, different boundaries, a gate review you want to own — say so and I will restructure. A tune-up is cheap at this stage.

---

## Session of 2026-08-11 — multi-grant test, bank v0.4.2 → v0.4.3, triage review, MCP-first skill

*(Items 1–5 are the morning's work and took the bank to v0.4.2; items 6–7 are the afternoon's and
took it to v0.4.3. Counts inside items 1–5 are the record as at v0.4.2 and are left as written —
the current figures are in "Where the project is now".)*

### What was done

**1. Tested the implementation against three grants with no filed response** (from `data/Grants/`):
JFF & Google Advancing AI Resilient Early Career Pathways RFP (2026), Allen Hiles Fund (blank
template), and Dolfinger-McMahon Foundation. Before the session, the matcher routed JFF **0 of 8**
questions confidently, Allen Hiles 3 of 11, Dolfinger 3 of 4.

**2. Grew the question bank to v0.4.2** (`seed/questions.json`) to fix those routes:
- 15 real funder wordings appended to existing canonicals (all from the three forms).
- 2 new canonical questions: `organization.community_voice` → `kb.dei` and `program.operations` →
  `kb.program_desc`. Both reuse existing KB slots — no KB answers were created (gap-fill agent's lane).
- 3 new form fixtures committed: `forms/allen_hiles_2024.json`, `forms/jff_ai_pathways_2026.json`,
  `forms/dolfinger_mcmahon_2023.json`.
- Both parity fixtures regenerated from the prototype (control passes clean, zero shared-case
  regressions): matcher parity 337 → **404 cases**, seq-ratio 59,616 → **71,001 pairs**.
- Bank counts: 88 → **90 questions**, 248 → **265 wordings**, 25 sources, `kb_entries` unchanged (29).
- Suite: **187 of 187 pass** across 9 files in `packages/grants`.
- After: **all three grants route 100% of questions confidently** (JFF 8/8, Allen Hiles 11/11,
  Dolfinger 4/4).

**3. Reviewed the grant-data triage** (`docs/grant-data-triage.md` + seven H2 reports in
`docs/grant-data-triage/`). Findings: the five H2 extraction reports and the redaction execution are
evidence-only; they changed nothing under `packages/`. The redaction is done (63 copies in
`/tmp/opencode/redacted/`, originals untouched); the credential swap-in and ~30 password rotations are
staff-gated.

**4. Made the grant-writing skill MCP-first** (`.claude/skills/grant-writing/`), per the architectural
decision that the server has **no local `data/Grants` mirror** — everything is reachable through the
Drive MCP / internal MCP chain:
- Source-ladder rung 3 (prior filed applications) now routes through `search_documents({source})` via
  the Drive chain; `corpus_search.py` is demoted to a dev-only fallback and its dead default root
  (`/tmp/opencode/grants-zip/Grants`) was repointed at `data/Grants`.
- Figure-claims guidance now states explicitly that the work order's claim strings are **snapshots,
  not facts** — the live `query_*` call wins, and "fixing a stale claim" in `figures.ts` is drift
  working as intended, not a bug. No `figures.ts` claims were edited.

**5. `.gitignore`** — added `data` (the 1,234-file untracked Grants mirror; matches the existing
`packages/grants/data/` rule). Note the edit currently drops the trailing newline.

### Continued, same day — bank v0.4.3 and a red suite nobody had seen

**6. Closed board `grant-h32`** (three funder wordings matching at confidence 1.000 to canonicals of
the wrong `answer_type`). Re-diagnosed against the code before touching anything, and **two of the
three had moved** — D1a/D1b landed between the board entry and today, changing the symptom without
changing the cause. The worst of them was no longer visible at all: D1a's structured branch answered
Truist's two-part 200-word question with **9 words** and marked it `fits` / `actor: none`, meaning no
work owed. Fixed under growth rule 1 with two new canonicals, `program.population_impact` and
`financials.budget_allocation`. Bank **90 → 92 questions, 265 wordings unchanged** — this release
*moved* three variants and invented no funder source, which `data.test.ts` asserts. Both parity
fixtures regenerated with control passes first; **exactly 5 of 406 matcher cases changed and all 5
were intended**. On `aug7_truist`, `fits` 10 → 11 and the two-part question now returns 86/200 words
of narrative instead of 9.

**7. Found and fixed a defect that had left the full suite red since 2026-08-10.** D1b's
`fetch_figure` set `actor: 'llm'` with no `handback`, breaking a documented contract and an
integration assertion — a caller driving off `handback` silently skipped every figure question.
**This is the part to read.** It went unseen because this workstream verifies with
`vitest run packages/grants`, and that package contains no test reaching `apps/mcp-server`; sessions
5 and 6 both recorded "187 of 187 pass" truthfully while the repo suite was failing. A second gap
underneath it: `pnpm test` does not typecheck, and `pnpm -r typecheck` caught a stale local type in
the same file that every runtime case passed. Contract widened to "every `llm` result carries exactly
one of `handback` or `figure_call`". Boards `grant-gab` (closed) and `grant-h32.1`/`grant-a54` (the
carved-out figure-args question).

**8. Guarded D1a's mechanism — the general shape behind item 6, not just its one instance.** New
`needs_expand` status (`actor: llm`) fires when a stored structured value *fits* a funder's field but
does not *answer* it. The handback carries the confirmed value as an `anchor_value` that must survive
verbatim plus the KB slot prose as material, under new `EXPAND_RULES`.

This is the highest-risk handback in the layer and it is written that way: a short fact plus a large
empty field is exactly what produces invented grant content, so the rules state that **the limit is a
ceiling, not a target**. A guard that provoked padding would be worse than the defect it replaced — a
reviewer can see an under-answer; a padded one reads as finished.

**The guard shipped a false positive and it was caught before it mattered**, by running all ten seeded
forms rather than trusting the design. Sized on field-size and fill-ratio alone, it fired on Hamilton's
"Project/ Program/ Campaign Name" — a 250-character box holding `Launchpad` — and would have told the
model to pad a title to 250 characters. The missing test was `answer_type`; a `field` is a name however
large the box. All ten forms now come back clean.

**It catches nothing today, and that is intended.** The one real instance was fixed at the bank level,
so this is a regression guard for the ~14 structured values `grant-miy` will add. One gap is recorded
rather than papered over: it cannot fire on a form that states **no** limit, because with no cap there
is no evidence the field is large and asserting one would be inventing. Board `grant-lyy`;
`DECISIONS.md` D1e.

**Verified state now: 217 of 217 in `packages/grants`, 262 of 262 across 14 files repo-wide, 14
packages typecheck clean.**

Board movement: `grant-h32` closed, `grant-0ov` closed against verified criteria, `grant-afb` closed
as a byte-identical duplicate created 6 seconds after `grant-0ov`; `grant-gab` (D1b contract defect,
closed), `grant-a54` (figure-args carve-out) and `grant-lyy` (the D1e no-limit gap) opened.

### Where the project is now

- **Deterministic layer is green and route-complete** on the three grants that previously exposed its
  coverage gaps. The bank grows by real wordings only; parity is asserted field-for-field.
- **The full suite is green for the first time since D1b landed**, and the reason it was not is now a
  written rule in `../CLAUDE.md` §3: run `pnpm test` *and* `pnpm -r typecheck`, never the package
  suite alone, before claiming green.
- **Nothing from this session is committed.** Working tree holds the bank edit, both parity fixtures,
  three form fixtures, the test count updates, `CHANGELOG.md`, `QUESTIONS-SCHEMA.md`, the skill edits,
  and the `.gitignore` change, alongside the pre-existing D1a/D1b working-tree edits (data/pipeline/
  figures/schemas/KB/CHANGELOG/CLAUDE/NEXT-SESSION/DECISIONS). Branch `writing/dev` is 5 commits ahead
  of origin.
- **Triage is complete on the executable side.** `grant-19o` children H2.1–H2.6 + redaction execution
  all delivered. What remains is staff-gated.

### What to do next

1. **Staff-gated (no code):** password rotation at ~30 portals + swap redacted copies into the tree
   (`grant-19o.7`); approve H2.1 structured-value candidates → the gap-fill agent applies the D1b KB
   edit; `kb.docs` reference text; apply the H2.6 Siegel framing replacement to the docx + re-export.
2. **Open, in-lane:** `grant-kmi.3` — verify the Drive sync under the **production** identity (the
   service account cannot see the Grants Shared Drive, so the MCP-first `search_documents` path has no
   corpus on the server until this lands).
3. **Open, content:** `grant-miy` (Sean) — the remaining ~14 structured KB values; ~7
   accepted-manual-fill decisions recorded in `DECISIONS.md`.
4. **When the KB content lands:** re-run `prep.mjs` on the three test grants to confirm the
   `no_kb_answer` / `kb_unverified` gaps shrink. Do **not** chase `figures.ts` claim strings as the KB
   changes — that is drift working as intended.
5. **Commit decision:** this session's change set is ready to commit on `writing/dev` once the
   pre-existing D1a/D1b edits are reconciled with it.


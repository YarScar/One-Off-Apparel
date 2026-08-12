# Changelog — the grant workstream

A living record of material changes landed by this workstream — schema, tools, connectors,
infrastructure, and the documentation itself. Entries reach outside `packages/grants` when the work
did: the grant layer touches the MCP tool surface, the `tool_permissions` table, and the migration
set, and it has corrected platform documentation it found wrong.

**This is not a repository-wide changelog.** No other workstream is required to write here, so read it
as "what this workstream changed", not "everything that changed". Verify any platform-wide claim
against the sources of truth in [`CLAUDE.md`](CLAUDE.md) §2 rather than against this file.

**Scope.** Entries belong here when they change something a teammate could trip over: the database
schema, the MCP tool surface, a connector's behaviour or status, the deploy path, or a documented
procedure that turned out to be wrong. Routine refactors, formatting, and dependency bumps do not
need an entry.

**Maintenance contract.** See [`CLAUDE.md`](CLAUDE.md) beside this file. The short version: when a
change lands, add the entry here *and* fix every other document the change falsifies. A changelog
that grows while the runbooks rot is worse than no changelog, because it looks maintained.

**Format.** Newest first, grouped by date (`YYYY-MM-DD`). The repository has no release tags, so
dates are the only ordering that means anything. Each entry says what changed, why, and — where it
matters — what it means for anyone who already has a local clone. Reference files by path so an
entry can be verified rather than trusted.

---

## 2026-08-12

### Verified — every gap in `docs/INFORMATION-GAPS.md` re-tested live, and the finance gaps are not data gaps

Each claim in the gap register was re-run against the live production MCP. **The tool defects
reproduced exactly as recorded.** But probing production with `query_finances`' `tab_name` override —
which bypasses the broken map — proved the rows exist:

| Probe | Result |
|---|---|
| `tab_name: "phase_dashboard:2025 actuals"` | real rows — per-phase actuals by account (`account_number`, `total_launchpad`, `liftoff`, `liftoff_pct`, `hs`, `hs_pct`) |
| `tab_name: "Combined Funds"` | real rows — account-level totals across every fund |
| `tab_name: "development:grants tracker"` | real rows — funder records with `lifetime_total`, `received_to_date` |

So §1.1, §1.2 and §8.2 are **casing defects in `query-finances.ts`, not missing organizational data**.
The budget fields that all four drafts in the 2026-08-11 run filed as `[DATA UNAVAILABLE]` are
answerable today. **Re-source them rather than treating them as gaps.** For an annual budget total the
right call is `query_finances(fund_balances)` (the `Combined Funds` tab), not `get_finance_brief` —
that tool genuinely carries no income or expense total and never did; its `period` argument only
labels the response.

Confirmed still broken, unchanged: §8.1 `query_enrollment` filter dropping (`by_phase` with
`current_phase: Lightspeed` + `enrollment_status: Completed` returned the full 301-student,
all-four-phase breakdown), §8.3 `query_competency(scores)` capped at exactly 1000, §2 staff headcount
(`search_documents` → 0 results), §7 routing defects (92 questions, still no `cover.website` and no
determination-year canonical).

### Added — two PRs against `master`

- **PR #49** — `fix/mcp-finance-tab-mapping`, the branch that had sat unmerged since 2026-08-05. Its
  tab map was checked character-for-character against the connectors that write those tabs
  (`connectors/google-sheets/src/sync-phase-budget-dashboard.ts:108-112` and
  `sync-development-crm.ts:21-26`) and matches exactly. Verified: build clean, `pnpm -r typecheck`
  clean across 13 packages, **49/49 tests**, including all 10 `finance-tab-map.test.ts` cases.
- **PR #50** — `fix/query-enrollment-filter-application`, written from scratch; **no branch among the
  44 local and remote refs had ever touched this**. All five non-date filters now apply to all eight
  query types (student columns reach phase-outcome queries through the `student` relation,
  `phase`/`status` reach student-level queries through `phaseOutcomes: { some: ... }`), and every
  response carries `filters_applied` plus `filters_ignored`. Adds `query-enrollment-filters.test.ts`,
  8 cases. Verified: typecheck clean, **56/56 tests**.

Reading `query-enrollment.ts` to fix it showed the defect was **wider than §8.1 recorded**:
`active_during` builds its own `where`, never uses `studentWhere` at all, *and* ignores `status`; and
`total`, `by_cohort`, `by_school`, `by_race` and `by_program_year` all ignore `phase`/`status`. All
eight query types dropped something.

**Neither PR is merged or deployed, so the live tools still misbehave.**

### Fixed — `docs/mcp-server-spec.md` overclaimed on three tools

Corrections landed on the PR branches, not here, since `packages/grants` does not exist on `master`.

- `query_finances` documented `fund`, `category`, `row_type`, `launchpad_only` and `donor` input
  filters, a `tabs_queried` / `launchpad_only` output pair, and a Launchpad-scoping rule keyed on
  `TABS_WITH_LAUNCHPAD_FILTER`. **None of those symbols exist in the file.** Removed; `query_donors`
  serves those lookups. The real inputs are `query_type`, `tab_name`, `period`, `contains`, `limit`.
- `get_finance_brief` claimed "YTD revenue vs. expenses" and "top campaigns" in both its heading and
  its Claude-facing description. Neither is computed. **That overclaim is the direct cause of the
  §1.1 misdiagnosis** — an absent total read as an organizational gap because the spec promised it.
- `query_enrollment`'s `by_student` advertises a "full student-info filter set" (race, gender, zip,
  income and parental-ed ranges, …) and `by_program_year` advertises retention projections. Neither is
  in the code. **Recorded as debt rather than corrected**, per [`CLAUDE.md`](CLAUDE.md) §1 rule 5 —
  closing either is a tool change with its own review.

### Corrected — a "broken `master`" report, withdrawn

Mid-session I reported 8 × TS1362 in `apps/mcp-server/src/tools/query-certifications.ts` as a defect
`master` had picked up from #47, and 9 consequent integration-test failures. **That was wrong.** The
cause was a stale local `packages/db/dist/index.d.ts` dated 2026-08-03, which exports `Prisma` as a
type where `packages/db/src/index.ts:3` exports it as a value; `apps/mcp-server` resolves
`@lp-ai/lib-db` to the built `.d.ts`. After `pnpm --filter @lp-ai/lib-db build`, `master` typechecks
clean and the suite passes. `master` was never broken and no fix is needed.

Recorded because the failure mode generalises, and it is the same one that produced the finance
misdiagnosis in the first place: **`pnpm test` alone would not have caught it, and `pnpm -r typecheck`
reported a stale artifact as a source error.** Rebuild workspace packages before believing a type
error, exactly as you should probe with `tab_name` before believing an empty result.

---

## 2026-08-11

### Added — four integrity checks, closing the seed-audit findings that could be closed mechanically

An audit of `questions.json`, `kb_launchpad.json`, and `FIGURE_CHECKS` against each other. The bank's
structure was sound — no duplicate ids, no dangling `kb_ref`, no orphan answer, counts matching
`meta.version` — and the existing seven checks reported empty and still do. What the audit found is
that **the checks covered the bank's internal shape and almost nothing about provenance or figure
coverage**, which is where the corpus had actually drifted.

`computeIntegrityReport()` in `src/data.ts` gains four checks, each exercised in `src/data.test.ts`
against a corpus that has the defect (the file's existing discipline — an empty report proves the
seed is clean only if the checker still fires):

- **`figure_claim_uncovered`** — the inverse of `figure_check_ref_dangling`. That one asks whether
  every slot a check *declares* exists; this asks whether every slot *carrying* the claim gets
  declared. Both fail silently for the same reason: `buildFigureWorkOrder()` scopes by `appears_in`,
  so an undeclared slot means a draft built from it gets no verification item and publishes the
  frozen figure. This was the audit's largest finding — see the fixes below.
- **`question_figure_check_dangling`** — validates `QUESTION_FIGURE_CHECKS` on both sides. That map
  is the entire `fetch_figure` path. A renamed question id or check key does not error; the lookup
  misses, the question quietly takes the normal path, and the draft ships the static number the live
  lookup exists to replace. Nothing validated it before.
- **`variant_source_undeclared`** — every `source` on a variant or a limit must be declared in
  `meta.sources`. Provenance is the only thing separating this bank from invented questions.
- **`structured_value_missing`** — fires when a short-value question routes to a slot that carries
  per-question structured values for its siblings but not for it. Deliberately narrower than "routes
  to prose", which is the designed fallback and would flag every attachment question in the bank.

**Two debt registers ship with them, and they are the honest part of this entry.** Ten real defects
are recorded rather than fixed, because fixing them needs something this change could not supply:

- `ACKNOWLEDGED_TIES` (3) — funder wordings recorded against two canonicals each, where an incoming
  form asking one verbatim scores 1.0 against both and bank order decides the match. Resolving one
  means moving a real wording, which changes matcher output and obliges regenerating
  `src/__fixtures__/matcher-parity.json` against the prototype.
- `STRUCTURED_VALUE_DEBT` (7) — `cover.legal_name`, `cover.year_founded`, `cover.fiscal_year`,
  `cover.authorized_rep`, and three `eligibility.*` questions, each returning a full narrative slot
  where a funder gave a one-line box. The values are organisational facts, and `kb.profile.identity`
  says itself that the registered legal name is still to be confirmed. Per `CLAUDE.md` "Do not
  invent", they are named, not guessed.

Read the empty integrity report accordingly: it is empty *given* those ten. `CLAUDE.md` §3 now says so
at the G1 bullet.

### Fixed — eight figure claims that appeared in KB slots their check never declared

Found by `figure_claim_uncovered` and by hand, then confirmed sentence by sentence in
`kb_launchpad.json`. Every one meant a draft scoped to the undeclared slot published a frozen figure
with no verification step and no warning — the exact failure `figures.ts` was written to prevent.
`appears_in` in `src/figures.ts` now names them:

| check | slots added |
|---|---|
| `demographics_race` | `kb.need`, `kb.target_population`, `kb.metrics`, `kb.eligibility` |
| `employment_wage_range` | `kb.outcomes`, `kb.programs`, `kb.budget_narrative`, `kb.management_plan` |
| `phase_costs` | `kb.programs`, `kb.program_desc`, `kb.uniqueness` |
| `employment_earnings_total` | `kb.theory_of_change`, `kb.capacity` |
| `top_employers` | `kb.theory_of_change`, `kb.risk` |
| `annual_budget` | `kb.eligibility` |

`kb.eligibility` is the sharpest of these: its `eligibility.budget_size` structured value literally
reads `FY2025 expenses ~$1.34M`, and no check claimed it. `kb.risk` is the next: it uses "17+ partners"
as the stated mitigation for employer dependence, so a stale count there understates a control the
application is relying on.

### Fixed — `cert_pass_rate` described a figure that is not in the knowledge base

The check's `claim` read `92% certification pass rate`. **No KB slot says that.** The 92% in
`kb.metrics` and `kb.capacity` is the Cohort 1 *paid-work* rate — 11 of 12 at six months — and the
certification claim is the PCEP range, `70–100% per cohort`. A reviewer sent to find "92%
certification pass rate" in `kb.metrics` finds a 92% that means something else and confirms the wrong
thing. The claim is corrected to the wording the KB actually carries.

### Added — a `placement_rate` figure check

The paid-work rate was the most-quoted outcome in the corpus and had no check at all; `cert_pass_rate`
had been standing in for it by accident. Four slots restate some form of it. It is `conflict_kind:
'unknown'` on purpose: no `query_*` tool returns a cohort placement rate directly — `query_employment`
`aggregate` gives participant and job counts, and the denominator has to come from `query_enrollment`.
The cohort framing is also a moving window; "100% in paid work now" is dated by whenever "now" was.

### Fixed — two funder sources cited by 31 wordings and never declared

`GSK-STEM-2026` (14 wordings) and `Truist-Inspire-2026` (17) — the two Aug-7 pilot forms, added as
variants at v0.3 and cited ever since without an entry in `meta.sources`. Provenance did not resolve
for any of them. Both are now declared, taking the source count 25 → 27, and
`variant_source_undeclared` enforces it. `Truist-Inspire-2026` is genuinely distinct from the
already-declared `Truist`, which carries 2 wordings from the generic Truist Foundation application.

**No `canonical` or `variants[]` text changed**, so matcher output is untouched and the parity
fixtures did **not** need regenerating. The full suite confirms it: `matcher.test.ts` and
`seq-ratio.test.ts` both pass unchanged. `data.test.ts` pins the source count at 27.

**Blast radius:** none at runtime beyond wider figure work orders, which is the safe direction — more
figures now carry a verification item. If you have a clone: `pnpm -r typecheck && pnpm test`. Expect
**275 across 14 files**, `packages/grants` **230 across 9**.

### Verified — what Lightspeed actually is, from the live connector

The content gap had been open since 2026-07-29 with only "the phase exists" recorded. Queried
2026-08-11 through the LP Internal AI connector, read-only. **Lightspeed is a 7-week summer intensive,
run twice** — 2024-07-01 → 2024-08-19 (7 completers) and 2025-07-07 → 2025-08-27 (8) — with **15 of 15
completing and none dropping**, and **14 of the 15 sat PCEP and all 14 passed**. Its completers appear
later under `LiftOff` and `Alumni`; no student has it as `current_phase`, and `query_students`
`breakdown` on `current_phase` returns no Lightspeed value at all.

**The KB's own reconciliation prose is wrong about it.** That note describes
`Foundations → 101 → Lightspeed → LiftOff`, a linear pipeline. The data does not support it: Lightspeed
runs in the summer gap between school years (101 runs Sept–Aug), and both completers whose full phase
history was inspected had `101: Not Enrolled`. A drafter who filled the gap from the reconciliation
prose — the obvious move, since it is the only place the phase was described — would have written a
false sequence into a grant application. The facts and that warning are now in the
`enrollment_by_phase` note in `src/figures.ts`.

Also worth knowing: those 14 Lightspeed passes are 14 of the 59 all-time PCEP attempts, and the other
45 (`_101`) are 18 pass / 27 fail = 40%. That is what the 54.2% all-time aggregate is averaging, and
it is a sharper version of the definitional conflict `cert_pass_rate` already flags.

### Found — `query_enrollment` silently drops filters it does not apply

Hit while querying the above, then confirmed in
`apps/mcp-server/src/tools/query-enrollment.ts`. `phase: 'Lightspeed', status: 'Completed'` on
`by_student` returned 20 arbitrary students, most of them `Lightspeed: Not Enrolled`;
`current_phase: 'LiftOff'` on `by_phase` returned results byte-identical to the unfiltered call.

The cause is per-branch: `by_phase` builds a `studentWhere` and never uses it, so `current_phase`,
`enrollment_status` and `cohort` are dropped; `by_student` uses `studentWhere` but ignores `phase` and
`status`, which live on the phase-outcome row. Nothing errors and nothing echoes which filters were
honoured, so a caller who believes they scoped to 15 students gets all 301.

**Recorded, not fixed** — a tool change with its own review, per `CLAUDE.md` §1 rule 5. Added as §4
row 10. The workaround for a phase roster is `active_during` with `phase` and a wide date window,
which does filter correctly; that is what produced the census above, and it is now named in the
`enrollment_by_phase` note so the next drafter does not repeat the wrong call.

### Recorded — three seed defects the audit found and could not fix

Added to `CLAUDE.md` §4 as rows 7–9 rather than left silent:

- **Lightspeed is still missing from the KB.** The platform records
  `Foundations → 101 → Lightspeed → LiftOff` with 15 completions. The KB's own reconciliation prose
  flagged it on 2026-07-29; re-confirmed 2026-08-11, still **0 of 29 slots**. Every drafted program
  description omits a phase.
- **Six slots cannot fill the longest ask routed to them** — `kb.staff_bios` is 110 words against a
  600-word question. The `needs_expand` guard makes this visible rather than silent, but expansion is
  where invention happens, and the underlying content is thin.
- **The KB snapshot (`2026-07-23`) is older than the bank (`2026-08-11`)**, and all four staff flags
  in its reconciliation prose are still open.

### Added — `needs_expand`, guarding D1a's mechanism against answering a field it has only filled

Closes the general shape left open when `grant-h32` was fixed. The bank split fixed the one *instance*
where a 9-word structured value was returned into a 200-word narrative field as `fits` / `actor: none`;
nothing stopped the next one. `grant-miy` is about to add roughly fourteen more structured values, so
the guard is worth having before them rather than after.

**The principle: fitting is not answering.** The layer measured whether a value was *inside* a
funder's cap and treated that as done. A caller reading `actor` therefore saw the outstanding-work
count go *down* on a question the draft had barely touched — the worst shape a defect can take in a
tool whose whole job is telling a caller what is left to do.

**What it does.** `limits.ts::underfillsProseField` is the test; `pipeline.ts` returns the new
`needs_expand` status (`actor: llm`) with a handback carrying **both** the confirmed value as an
`anchor_value` that must survive verbatim **and** the KB slot's prose as material to draw on. The two
travel separately on purpose: one is checked and must be preserved, the other is context that may be
used, and a caller that concatenated them would lose the distinction every rule depends on.

**The value is deliberately not returned as `answer`.** Present, it renders as a finished answer in
the Markdown package and to anything else walking `results` — which is exactly the appearance that let
the original defect through.

**`EXPAND_RULES` is the riskiest guardrail in the layer, and it is written that way.** The other two
tasks constrain a model with *too much* material: resizing chooses what to drop, deriving picks one
value out of prose. This one hands a model a short fact and a large empty field, which is the precise
situation that produces invented grant content. Two clauses carry the weight:

- **"The limit is a CEILING, NOT A TARGET. Do not pad to reach it."** Without this the guard would
  trade a silent under-answer for a padded, invented one — strictly worse, because a reviewer can see
  the first and the second reads as finished work.
- **The anchor must appear unchanged.** It is the one part already checked against filed material; a
  paraphrase swaps a verified fact for an unverified one while looking like it did the work.

**Three tests, all required — and the third was added because the guard shipped a false positive.**
A first cut used only the size of the field and the fill ratio. Run across all ten seeded forms before
being trusted, it fired on Hamilton's LOI: "Project/ Program/ Campaign Name", a **250-character** box
holding `Launchpad`, which fills 3.6% of it and is the complete correct answer. The guard would have
instructed the model to pad a title to 250 characters — causing the exact harm its own rules forbid.
The missing test was `answer_type`: a `field` is a name however large the box.
`EXPANDABLE_ANSWER_TYPES` (`schemas.ts`) is `narrative` and `demographic` only, and is deliberately
**not** the complement of `NON_NARRATIVE_ANSWER_TYPES` — `demographic` is in both, because "who do you
serve, and how many?" takes a value or a paragraph depending on the room given.

| Test | Question it asks | What it alone would get wrong |
|---|---|---|
| `EXPANDABLE_ANSWER_TYPES` | Could this field want prose at all? | — |
| `PROSE_LIMIT_FLOOR` (50 words / 250 chars / 3 sentences) | Is the cap big enough to hold prose? | fires on a 190-word answer in a 200-word field |
| `MIN_STRUCTURED_FILL_RATIO` (0.25) | Is most of the room unused? | the Hamilton false positive |

**Current effect: none, and that is the intended state.** All ten seeded forms come back clean — the
one real instance was fixed at the bank level, so this is a regression guard for the structured values
`grant-miy` will add, not something catching live defects today.

**Known gap, recorded rather than papered over.** The guard cannot fire when a form states **no**
limit. With no cap there is no evidence the field is large, and asserting one would be inventing. The
no-limit path still returns the value as `ready`. `admin/DECISIONS.md` D1e holds this.

Suite: 192 → **217 in `packages/grants`**, 237 → **262 repo-wide** across 14 files. 25 new cases,
weighted toward what the guard must *not* do.

### Fixed — `fetch_figure` broke the `actor: llm` ⇒ `handback` contract, and the full suite was red

**Found by accident** while re-diagnosing `grant-h32`, which is the part worth recording: nobody was
looking for it, and nothing in the grant workstream's own habits would have surfaced it.

D1b added the `fetch_figure` status with `actor: 'llm'` and a `figure_call` payload, but no
`handback`. `pipeline.ts` documented `handback` as "present **exactly when** `actor` is `llm`, so a
caller can drive every outstanding rewrite off this field alone", and
`apps/mcp-server/src/__tests__/tools.test.ts` asserted it. So a caller walking `results`, filtering to
`actor: 'llm'`, and reading `handback` **silently skipped every figure question** — the tool reported
work owed and handed over nothing to do it with.

**The full suite had been red since D1b landed.** It was not noticed because the grant workstream
verifies with `vitest run packages/grants`, and that package contains no test that goes through
`apps/mcp-server`. The 2026-08-10 and 2026-08-11 sessions both recorded "187 of 187 pass" truthfully
and both were reading a suite that structurally cannot see this class of defect. `CLAUDE.md` §3 gains
the rule that follows from it.

**Resolution: the contract was widened, not the code bent to fit it.** `fetch_figure` is a genuinely
second kind of model work — the task is running a `query_*` call, not reshaping prose — and forcing it
into a `Handback` would have meant a `verify_with` naming `grant_resize_answer` for a question with
nothing to resize. The invariant is now:

> Every `actor: 'llm'` result carries **exactly one of `handback` or `figure_call`**.

That preserves the property a caller actually depends on — outstanding work is drivable off the result
alone — without pretending the two kinds of work are one. `pipeline.ts`'s doc comment on `handback`
records why it changed, and `tools.test.ts` gains a case asserting the invariant directly rather than
only checking each payload's shape.

**A second, quieter gap.** `pnpm test` does **not** typecheck. The integration test declares its own
narrow shape for the tool's result, that declaration had no `figure_call`, and every case passed at
runtime while `tsc` rejected the file. `pnpm -r typecheck` is what caught it. Neither command alone is
a green light.

**If you have a local clone:** run `pnpm --filter @lp-ai/mcp-server build` before `pnpm test` — the
integration suite spawns the compiled server, so a stale `dist/` tests the old contract.

### Fixed — question bank at v0.4.3: two canonicals split, closing board `grant-h32`

`grant-h32` recorded three funder wordings matching at confidence **1.000** to canonicals of the
wrong `answer_type`. That is not a recall failure — all three were *recorded variants*, which is why
they scored 1.000 — so no amount of variant-adding could have found or fixed them. It is the B6
defect class reached from the other side: B6 was a coverage gap surfacing as a confident wrong match,
this is a **typing** error surfacing the same way.

**Re-diagnosed against the code before fixing, and two of the three had moved since the board wrote
them.** D1a/D1b landed in between and changed the symptom without changing the cause:

| Wording | `grant-h32` recorded | Actual behaviour on 2026-08-11 |
|---|---|---|
| "Who does your solution serve, and in what ways will the solution impact their lives?" | `derive_from_reference` | `fits`, `actor: none`, **9 words into a 200-word field** |
| "How is your current budget allocated?" | `derive_from_reference` | `fetch_figure` → `get_finance_brief {period:"ytd"}` |
| "What was your organizational budget for fiscal year 2025 and 2026?" | `derive_from_reference` | `fetch_figure` — **now the right shape**; h32's diagnosis is superseded here |

The first is the one worth reading twice. D1a's structured-value branch gave it a real answer —
`Philadelphia young people ages 16–24 (101: 16–18; LiftOff/Inc: 18–24)` — and marked it `fits` with
`actor: none`, meaning **no work owed**. Against a 200-word narrative field that answers half the
question in 9 words and reports done. D1a converted a visible defect into an invisible one; the
outstanding-work count went down while the draft got worse. Recorded here because the failure is
structural, not specific to this question: any short structured value on a long narrative field
does the same thing.

**The fix, under growth rule 1.** `answer_type` belongs to the ENTRY, not the variant
(`seed/QUESTIONS-SCHEMA.md`), so retyping was never available — `program.target_population` is
genuinely `demographic` and `financials.operating_budget` is genuinely a `number`. Two new canonicals
take the misplaced wordings:

- **`program.population_impact`** (`narrative` → `kb.target_population`, 200-word limit from Truist) —
  takes the Truist and JFF two-part who-and-how wordings.
- **`financials.budget_allocation`** (`narrative` → `kb.budget_narrative`, 150-word limit from Truist) —
  takes "How is your current budget allocated?". `kb.budget_narrative` already holds allocation prose
  and is `verified: true`, so this needed no KB writing.

Bank **90 → 92 questions, 265 wordings unchanged, v0.4.2 → v0.4.3**. The unchanged wording count is
the point and is asserted by `data.test.ts`: this release **moved** three variants and invented no
funder source. A split that fabricated a wording would fail the suite.

**Effect on the real form** (`seed/forms/aug7_truist.json`): `fits` 10 → 11, `fetch_figure` 2 → 1.
The two-part question now returns **86/200 words** of narrative instead of 9, and the allocation
question returns **99/150 words** of budget prose instead of an instruction to write a number into a
prose field.

**Parity: both fixtures regenerated, control pass first.**

| Fixture | Control | Result |
|---|---|---|
| `matcher-parity.json` | 0 regression differences | 404 → **406 cases**. **Exactly 5 changed**, and all 5 are the intended ones: 3 moved wordings plus the 2 new canonical self-matches (0.334 → 1.00 and 0.385 → 1.00). Nothing else moved. |
| `seq-ratio-parity.json` | 71,001 overlapping pairs, 0 regression differences, 1,104 pairs not yet covered | **72,105 pairs** over 380 strings, CPython 3.14.6, all reproducing exactly |

Five regression cases added to `src/matcher.test.ts` under an `h32` describe block, pinning both new
routings **and** that the split did not drag the canonicals it was split from. Suite: 187 → **192 of
192** across 9 files.

**Unresolved, and deliberately not guessed.** The FY2025/2026 budget question carries
`get_finance_brief {period: "ytd"}`, which cannot express a fiscal year — `apps/mcp-server/src/tools/get-finance-brief.ts:13`
accepts only `period: 'ytd' | 'last_30_days' | 'last_quarter'`. So the args cannot be widened; the
tool that can answer it is `query_finances`, whose enum includes `annual` and `budget_actuals`
(`apps/mcp-server/src/tools/query-finances.ts:13`). Changing the `annual_budget` FIGURE_CHECK would
also move the figure work order for every KB slot referencing it, so this is left open on `grant-h32`
rather than changed under a bank release.

**If you have a local clone:** nothing is required — no schema, tool surface, or migration moved.
The prototype bank at `~/Projects/Grants/question-bank/questions.json` was re-synced as part of the
regeneration procedure and is byte-identical to `seed/questions.json`.

### Changed — question bank at v0.4.2: three real unfilled forms transcribed and routed

Multi-grant coverage test against grants in `data/Grants/` with no filed response surfaced three
forms whose questions the bank could not route confidently: **JFF & Google Advancing AI Resilient
Early Career Pathways RFP (2026)** (all 8 questions under the 0.42 floor), **Allen Hiles Fund** (8
of 11), and **Dolfinger-McMahon Foundation** (1 of 4).

15 real wordings appended to existing canonicals, two new canonical questions added, all under the
growth rules in `seed/QUESTIONS-SCHEMA.md`:

- `organization.community_voice` (narrative → `kb.dei`) — "How does your organization include the
  people it serves in its decision-making process?" Previously routed to `attachments.org_chart` at
  0.37 — a confident-shape trap of the same class board B6 pinned in v0.4.1.
- `program.operations` (narrative → `kb.program_desc`) — "Describe how the project will operate,
  including hours of operation, staffing, and volunteers." Previously landed on
  `program.team_qualifications` at 0.20, which answers only the staffing half.

The three forms are now committed as fixtures (`forms/allen_hiles_2024.json`,
`forms/jff_ai_pathways_2026.json`, `forms/dolfinger_mcmahon_2023.json`) so their question texts
enter both parity fixtures. Bank: 88 → **90 questions**, 248 → **265 wordings**, `kb_entries`
unchanged at 29 (no new KB slots — the other agent is gap-filling answers). `meta.version`
0.4.1 → **0.4.2**, three new `meta.sources`.

**Parity:** both fixtures regenerated with control passes clean — `regenerate-matcher-parity.py`
reported 0 shared-case changes (337 → 404 cases; the JFF form now matches all 8 questions at 1.00)
and `regenerate-seq-ratio-parity.py` 0 regressions (59,616 → 71,001 pairs). Suite: **187 of 187
pass, 9 files, zero skipped** after the count assertions in `data.test.ts` moved with the bank.

**If you have a local clone:** nothing is required — no schema or tool surface moved. The prototype
bank at `~/Projects/Grants/question-bank/questions.json` was synced to the repo seed (byte-identical
sha256) as part of the regeneration.

## 2026-08-10

### Added — per-question structured values and the live-figure path (D1a + D1b, grant-miy)

`kb_launchpad.json` answer objects can now carry `structured: { "<question id>": { value, verified } }`.
Slots are shared — `kb.eligibility` answers eight questions — so the value is keyed by question id,
not by slot. `buildAnswer` returns a stored value as a real answer (`fits`/`ready`, `actor: none`)
ahead of the `derive_from_reference` branch, with `from_structured: true` in the provenance footline.
Per-value `verified` overrides the entry-level flag. `computeIntegrityReport` gained
`structured_key_dangling`, which fires when a structured key names a question id that no longer
exists in `questions.json` — a renamed question silently falling through to `derive_from_reference`
was the failure mode this check exists to prevent.

The three number questions whose answer is a live figure (`cover.budget_totals`,
`financials.operating_budget`, `program.jobs_and_participants`) no longer derive from frozen prose.
They return a new status carrying the exact `query_*` call from `FIGURE_CHECKS`: **`fetch_figure`**
(`actor: 'llm'` — run the call, write the live number) or **`figure_definitional`** (`actor: 'staff'`
— the number depends on which population the funder means, so a person confirms first). Two statuses
so `STATUS_ACTOR` stays a clean mapping. `renderMarkdown` shows the named call for both.

`figures.ts`: `students_served_total.appears_in` gained `kb.metrics`, because
`program.jobs_and_participants` routes there and a metrics-only draft otherwise lost the live
`query_enrollment` call, leaving only the definitional flag.

Seed: 11 structured values landed across five slots (`kb.program_desc`, `kb.profile.identity`,
`kb.profile.contacts`, `kb.target_population`, `kb.eligibility`), including the sharp case —
Truist `cover.project_title` now answers **"Launchpad"** instead of a 199-word program description
flagged over limit. Suite: 177 → **187 across 9 files**. No `meta.version` bump, no matcher-parity
regeneration (matching is untouched). Design and decisions: `packages/grants/admin/DECISIONS.md` D1.


### Verified — all three grant tools resolve in the ACL, not just `grant_match_question`

The G1 method, repeated on `grant_build_draft` and `grant_resize_answer`. **No source file changed.**

From 2026-08-04 to today the claim about these two rested on the `tool_permissions` rows being
present by query. That says a tool *will* resolve; it does not say one *was seen* resolving, and the
distinction is exactly the kind this workstream has been caught by before. It is also the one thing
no test run could settle: `tool-helpers.ts` reaches `canCallTool()` only when `currentCaller` is set,
and only `serve-http.ts` sets it, from a verified bearer token. **The ACL branch is unreachable from
the entire suite**, including the integration tests that spawn the real server over stdio.

Method, unchanged from 2026-08-03: `dist/serve-http.js` against local Postgres, a throwaway RSA
keypair in `JWT_PRIVATE_KEY`, and two `ACTIVE` `mcp_users` — one `leadership`, one `program_staff`.
Tokens signed with the same key, then `initialize` and `tools/call` over Streamable HTTP.

| Caller | Tool | HTTP | Outcome |
|---|---|---|---|
| no bearer token | — | 401 | refused by the transport, never reaches a tool |
| `leadership` | `grant_build_draft` | 200 | draft package returned (`form`, `summary`, `results`, `kb_refs_used`) |
| `leadership` | `grant_resize_answer` | 200 | resize result returned (`model`, `answer_full`, `answer_truncated_preview`, `units_before`) |
| `program_staff` | `grant_build_draft` | 200 | `isError: true`, `{ code: 'permission_denied' }` |
| `program_staff` | `grant_resize_answer` | 200 | `isError: true`, `{ code: 'permission_denied' }` |

**All four authenticated calls reached `usage_logs` with the caller email, refusals included** — a
denied call is visible on HQ `/tools` rather than silent. The `usage_logs` rows are left in place as
the evidence: `select tool_name, anthropic_user_email, error from usage_logs where
anthropic_user_email like 'acl-%'` reproduces the table on any clone that ran this.

**What it still does not prove.** Production. Every result is local, and whether the grant
`tool_permissions` rows exist on RDS remains unknown and unowned — board **A7 (#163)**.

**Blast radius: none.** The keypair lived only in a session scratchpad and was deleted; the server
was stopped and both test users removed.

### Added — the reframe seam, built and deliberately not connected (board D4 / #74)

`packages/grants/src/reframe.ts` and `reframe.test.ts`. `admin/SPEC.md` §8 and `admin/TAD.md` §5
decision 7 both say the same thing about this hook: port the seam, do not wire it. Both halves landed.

**There was no implementation to port.** The prototype never wired reframe either — `pipeline.py`
threads a `hat` through its `context` dict and marks the transform TODO, and `resize.py`'s
`_build_user_prompt` carries a comment calling the real hook "a separate, richer transform". So what
ported is the *interface*: the funder-hat vocabulary, the context assembly, and a guardrail. There is
no parity fixture for this module and there cannot be one.

**The guardrail is not the resize guardrail with a word changed, and that is the substance of the
package.** Resizing asks a model to say less, which fails safe. Reframing asks it to lean into a
theme, which fails by *manufacturing* the theme when the source does not support it — and no length
check or figure check would ever catch that. So `REFRAME_RULES` carries the no-invention clause
word-for-word from `RESIZE_RULES` (a model that gets a softer guardrail from one tool than another
uses the softer one), then adds the two rules this task needs:

- Reframing is **reordering and re-weighting** what is already there, not adding material.
- If the source contains nothing supporting the funder's emphasis, **say so and return it unchanged**.
  A mismatch is a finding about the knowledge base, not a writing problem to solve.

**`FUNDER_HATS` is a closed vocabulary** — `workforce`, `youth`, `tech_equity`, `economic_mobility`,
`dei`, `education_innovation`, `place_based` — taken from the prototype's roadmap entry, where
`research/LaunchPad-Philly-Application.md` records that a hat is concretely about which program and
phase you pitch. `buildReframeHandback` throws on an unrecognised one rather than passing it through:
a typo'd hat reaching a prompt would read to the model as an instruction somebody meant to give.

**How it stays unconnected, mechanically.** The module is **not re-exported from `src/index.ts`**.
`@lp-ai/lib-grants` is the only door the MCP tools have into this package, so leaving it off that
barrel is what makes the seam unreachable rather than merely unused. It also does **not** widen
`HandbackTask` with a `'reframe'` value, which would put the new task into a module three registered
tools import — precisely the wiring decision 7 defers. The seam pays a small duplication to stay a
seam.

**The acceptance criterion is asserted structurally, not by spying.** A spy only proves the paths a
test happens to exercise; unreachability is a property of the import graph. Three assertions:
`index.ts` does not mention it, nothing under `apps/mcp-server/src/` mentions it, and nothing else in
`packages/grants/src/` imports it. Each walks the real files at test time, so wiring it without
deleting the test fails the suite.

**To wire it later:** revisit `admin/TAD.md` decision 7 first — the decision is what holds it, not the
code — then add the barrel export, register a tool, and delete the unreachability test, in that order.

**Tool surface unchanged at 23.** No migration, no `tool_permissions` row: an unregistered seam needs
neither. **Suite: 207 → 222 tests across 14 files**, all passing, zero skipped. `packages/grants`
alone is **177 in 9 files**, still with no database and no network.

---

## 2026-08-04 (later)

### Fixed — a confident WRONG match on the JEVS form, and bank v0.4.0 → v0.4.1 (board B6 / #62)

The B6 matcher quality review. **The review's main result is that B6 was measuring the wrong thing.**

B6's acceptance criteria measure **misses** — questions falling below the 0.42 threshold. Scanned across
all 106 questions in the seven form fixtures, **105 of 106 match confidently**, and the single miss is
the intended control (`What is your organization's policy on merchandise returns?`, 0.373 — a question
the bank should not answer, correctly routed to review). So the real form corpus has **zero genuine
misses** and the matcher's recall is not the problem.

The damaging class is the opposite one, and the criteria are blind to it. **A miss is the safe failure:**
the draft says "confirm this mapping" and a person looks. **A confident wrong match is not**, because it
routes to a knowledge-base slot and the draft presents that slot's content as the answer. Scanning each
confident match's `answer_type` against what the funder's wording asks for and against the stated limit
found four.

**The one fixed here.** `Does the organization have any connection with JEVS (including its Board of
Directors)?` matched `attachments.board_list` at **0.459, confidently**, on the shared words "Board of
Directors". A conflict-of-interest disclosure routed to `kb.docs`, so a draft offered an attachment
checklist as the answer to a yes/no question. No bank entry covered conflict of interest at all, and the
nearest correct candidate — `organization.board` — scored 0.361, below the floor. **That is a bank
coverage gap surfacing as a wrong answer rather than as a gap**, which is exactly why adding variants,
what B6 asks for, could never have found it.

Added `cover.funder_connection` (`boolean`, `kb_ref: null`, frequency `low`) under growth rule 1, with
the JEVS wording as its first variant. `kb_ref: null` is deliberate — whether a connection exists is a
fact about one application, not about LaunchPad, so no stored answer can hold it. Bank **87 → 88
questions, 247 → 248 variants, v0.4.0 → v0.4.1**.

**Both fixtures regenerated, control pass first in both cases**, per the harnesses in `scripts/`:

| Fixture | Control | Result |
|---|---|---|
| `matcher-parity.json` | 0 regression differences | 377 → **378 cases**. Exactly **one** existing case changed, and it is the defect. Nothing else moved. |
| `seq-ratio-parity.json` | 58,926 overlapping pairs, 0 regression differences, 690 pairs not yet covered | **59,616 pairs** over 353 strings, all reproducing exactly |

`seq-ratio.test.ts` is what caught the second fixture: the bank edit added candidate strings with no
recorded CPython ratio, and the suite **failed** on that state rather than staying green. That guard was
added on 2026-08-03 for precisely this case and this is the first time it has fired in anger.

Three regression cases added to `src/matcher.test.ts`, pinning the answer shape, the null `kb_ref`, and
that the real board-list attachment request did not follow the new canonical home.

**Three more confident wrong matches are recorded on `bd` `grant-h32`, not fixed here.** All on
`aug7_truist`, all matching at confidence 1.000 because all are recorded variants: the `demographic`
"Who does your solution serve…" question against a 200-word cap (the one `grant-miy` carved out for this
review — now diagnosed), and two `number`-typed budget questions against 150-word caps. None can be
fixed by retyping, because `answer_type` belongs to the **entry** and both entries involved are correctly
typed for their own canonical. Each needs a new canonical, which is a bank-design decision with a
`kb_ref` choice in it — recorded rather than guessed.

**Corrected — `grant-miy`'s count is 35, not 42.** Recounted at v0.4.1: of 43 non-narrative bank
questions, **35 route to a narrative KB slot** and **8 have `kb_ref: null`**. The 8 route to no slot at
all, so the pipeline returns `per_application` — the correct outcome, not a content gap. `grant-miy`'s
per-type breakdown counts all non-narrative entries and describes them all as routing to a narrative
slot. Excluding `attachment`, which its own criteria exclude, the KB content gap is **27 questions, not
34**. Full detail as a comment on that issue.

**Still open on B6, and it is a decision rather than work.** `How will you measure whether the program
succeeded?` remains at 0.352 and **cannot be fixed by adding variants** — measured 2026-08-03, the
shortfall is one unstemmed inflection (0.352 with `succeeded`, 0.644 with `success`), six real sourced
wordings were trialled, and none moved it. Both of B6's strings are the prototype's own smoke-test
samples (`matcher.py` lines 160–161) and appear in no funder form, so adding them would mean inventing a
funder source. The choice is accept the safe staff-review outcome, or adopt stemming and move the G2
parity baseline off the prototype that produced LaunchPad's filed applications. **Recommend accepting**
— the question has never occurred on a real form.

### Added — `grant_resize_answer`, the resize seam (board D3 / #73, gate G4)

`packages/grants/src/resize.ts`, `packages/grants/src/warnings.ts`, and
`apps/mcp-server/src/tools/grant-resize-answer.ts`. The port of the prototype's `resize.py`, and the
one module where the re-expression changes the architecture rather than the language: the resize loop
turns inside out.

```
prototype:  build_answer → resizer(text, limit, ctx) → ResizeResult   [in-process, networked]
now:        caller → grant_resize_answer(text, limit)          → handback
            caller rewrites
            caller → grant_resize_answer(text, limit, rewrite)  → verdict
```

`MAX_ATTEMPTS`, `make_resizer`, `DEFAULT_MODEL`, `ClaudeResizer`, and the retry loop do not port —
`admin/TAD.md` §5 decision 6 settled that on 2026-07-29. What ports is everything around that call:
the `_SYSTEM_PROMPT` guardrail (landed at G3 as `RESIZE_RULES`), `_build_user_prompt`'s context
assembly (landed at G3 as `buildHandback`), the unit re-measurement, the overflow feedback wording, and
the `ResizeResult` field set. `ResizeResult.model` is retained and is always `null`, exactly as the
prototype documented it for a non-LLM resizer.

**Tool surface: 22 → 23.** `readOnlyHint: true` like its siblings. Its `tool_permissions` row already
existed — migration `20260729000000_add_grant_tool_permissions` reserved it for `leadership` and
`admin` under category `grants` — so **no new migration was needed**. Confirmed by query on the local
database: `grant_resize_answer | {leadership,admin} | grants`. Every registered tool now has a
permission row, and the count of rows with no registered tool drops 7 → 6, all `future` placeholders.

**Added beyond the prototype: figure fidelity, and it is the reason to prefer this tool over a bare
re-measure.** `ResizeResult.figure_check` compares the numeric values in a rewrite against those in its
source and rejects one the source does not state, however well the rewrite fits. The prototype
re-measures length only, so a rewrite that trimmed forty words and moved a dollar figure by a digit came
back marked `fits` — and rule 1 of the guardrail calls exactly that output unusable. A rule nothing
checks is a suggestion. Dropping a figure stays allowed; rule 2 licenses it. **Callers must branch on
`accepted`, not on `fits_after_resize`** — the tool's own description says so, because the two differ
precisely in the dangerous case.

Measured against the real knowledge base: a tampered digit is detected in **all 29 slots that state a
figure**, with **no false positive** on either an identity rewrite or a genuine sentence-level trim.
This needed a second extraction pattern rather than reuse of `containsNumericClaim` — `\b\d{2,}\b` does
not span a thousands comma, so `8,000` tokenised as `000` and a rewrite moving it to `9,000` compared
equal. Comma-grouped counts are most of what grant prose states, so that miss would have covered most
of what a resize can get wrong. **Known gap, recorded in `figures.ts` rather than assumed away:** a
magnitude suffix is not part of the token, so `$1.34M` normalises to `1.34` and a restatement as
`$1.34B` reads as the same value. Catching that needs unit awareness, and the figure work order covers
it — every figure needs live `query_*` confirmation before publishing regardless.

### Changed — `handback.verify_with` now names `grant_resize_answer`

`packages/grants/src/handback.ts`. It named `grant_build_draft` deliberately until now, because
pointing a caller at a tool absent from `tools/list` produces a failed call and a model that improvises
around it. Two tests pinned the old behaviour on purpose and both flipped:
`packages/grants/src/handback.test.ts` and `apps/mcp-server/src/__tests__/tools.test.ts`. The latter now
asserts against the live `tools/list` result rather than a hard-coded name, since reachability is the
property that matters and hard-coding is what broke it.

**This also fixes an instruction that could not be followed.** The old wording told a caller to pass
rewritten text back through `grant_build_draft` "as the answer for this question" — and
`grant_build_draft` takes a whole form, with no parameter that accepts a rewritten answer. It was
asking for something the named tool could not do.

### Changed — the two data-honesty warnings moved to `warnings.ts`

Extracted from `pipeline.ts` so `resize.ts` appends the same strings rather than restating them. The
prototype's `test_resized_answer_keeps_unverified_warning` exists because a shortened answer that
quietly loses its "not grounded in a filed application" marker reads to a reviewer as more trustworthy
than the text it came from; two modules building that marker from two string literals is how it goes
missing from one of them. `resize.ts` reads the `verified` flag **from the knowledge-base slot** rather
than from the caller, so a caller cannot assert grounding an answer never earned. `verified: null`
(no slot named) appends nothing and is not a clean bill of health.

### Verified — gates G3 and G4 both passed, both on restated conditions

**G3's condition is restated as 20 pipeline parity cases and the 5 resizer cases move onto G4.** The
alternative was holding G3 open until G4 landed. Decided 2026-08-04. The shortfall was never about G3's
deliverable — `grant_build_draft` was complete — and a gate that reports a delivered tool as failed on
a condition naming code that cannot exist measures the condition rather than the tool. The five cases
are not dropped; they are the first half of G4's bar, in `src/resize.test.ts`.

**G4's bar is restated as 12 rather than 7**, and the second half of that number is the same finding as
G3's applied to `test_resize.py`: **6 of its 7 cases test the code `admin/SPEC.md` §2.2 says does not
port** — five `ClaudeResizerTests` and one `MakeResizerTests`. Four port, three have no analogue at all
(`MAX_ATTEMPTS`, `DEFAULT_MODEL`, `make_resizer`), and those three are recorded per case in `SPEC.md`
§1 rather than written as stand-ins that would pass without testing anything. So 5 + 4 = 9 parity
cases, plus 3 figure-fidelity cases the prototype cannot have a counterpart for. `SPEC.md` §4 gains a
`Portable` column making the same point across all three test files: 37 of the prototype's 45 cases can
be re-expressed, and the 8 that cannot are named.

**Suite: 183 → 207 tests across 13 files, all passing, zero skipped.** `packages/grants` alone is
141 → **162**, in 8 files. 18 new in `src/resize.test.ts`, 3 in `src/matcher.test.ts` for the B6 fix
above, and 3 new integration cases driving the tool
through the spawned server. `pnpm -r typecheck` passes across all fourteen packages and
`packages/grants` lints clean.

**What this does not say.** `grant_resize_answer`'s ACL path is unproven, exactly as
`grant_build_draft`'s is. Its permission row was confirmed by query, so it will resolve; nothing has
driven a real bearer-token call through it the way G1 did for `grant_match_question`. A green test run
is not evidence about permissions — `tool-helpers.ts` only calls `canCallTool()` when a caller is set,
and only `serve-http.ts` sets one.

---

## 2026-08-04

### Added — `grant_build_draft`, the form-to-draft pipeline (board D1 / #71)

`packages/grants/src/pipeline.ts` and `apps/mcp-server/src/tools/grant-build-draft.ts`. The port of
the prototype's `pipeline.py` — `build_answer`, `run`, `render_markdown` — completing the path
**form → match → knowledge-base retrieve → limit check → Markdown**. `count_units` and
`truncate_preview`, the other two functions `admin/SPEC.md` §2.2 assigns to this tool, had already
landed in `limits.ts` at G2 and were not re-ported.

**Tool surface: 21 → 22.** `grant_build_draft` carries `readOnlyHint: true` like its siblings. Its
`tool_permissions` row already existed — migration `20260729000000_add_grant_tool_permissions`
reserved it for `leadership` and `admin` — so **no new migration was needed** and the tool is
reachable on any database that has run `pnpm db:migrate`. Confirmed by query on the local database.

It takes either an inline captured form (`funder` + `questions[]`, each with an optional `limit`) or
`form_id` for one of the 7 stored fixtures. It returns per-question answer plans, the outstanding work
split into `your_tasks` and `staff_actions`, the rendered Markdown draft, and the figure work order.

**It makes no connector call, by design.** It returns the `query_*` calls a caller must run and the
caller runs them. `figures.ts` holds the reason: `runTool`'s permission check keys on the *inbound*
tool name, so a grant tool reading the database internally would be authorised as itself rather than
as `query_finances`, laundering finance and donor data past the role ACL. Do not "optimise" this.

**Resize is off, per the gate** — meaning this tool does not rewrite anything. It hands the work back.
See the next entry.

#### Added — `handback.ts`, the contract for work this layer gives back to the calling model

The mechanism that makes the layer an *assist* rather than a gate. The knowledge base exists so a
model does not regenerate answers LaunchPad has already written and approved; when a stored answer
does not drop straight into a funder's field, the material goes back to the calling model with the
limit, the measurement, and the rules, and the model does the shaping.

`RESIZE_RULES` is the prototype's `resize.py::_SYSTEM_PROMPT`, carried over as `admin/SPEC.md` §2.2
requires — including the load-bearing clause, "NEVER invent, add, infer, or embellish any fact,
figure, statistic, name, date, program detail, or outcome." `buildHandback`'s context assembly is its
`_build_user_prompt`: funder, emphasis to preserve, and what the stored answer answers.

**Shared on purpose.** `grant_resize_answer` (G4) emits the same payload. A model given a stricter
guardrail by one tool than by the other produces inconsistent drafts, so the payload is built once
here. That also makes G4 a small tool rather than a second implementation.

**No model client, and none is coming.** `TAD.md` §6 decision 6 already recorded why: an MCP tool is
invoked *by* Claude, so a tool that opened its own client would solve the wrong problem.
`@anthropic-ai/sdk` is in no `package.json` in this repository, and `ANTHROPIC_API_KEY` is declared in
`packages/config/src/schema.ts` but never read. Everything here stays unit-testable with no mocking
and no key.

`verify_with` deliberately names `grant_build_draft` and **not** `grant_resize_answer`, because only
the former is registered. Pointing a caller at a tool absent from `tools/list` produces a failed call
and a model that improvises around it. `handback.test.ts` asserts that; add the reference at G4.

#### Four branches that go beyond the prototype

Each exists because the prototype is demonstrably wrong on the real seed, and each is pinned by a
test in `src/pipeline.test.ts`:

| Branch | Actor | Why |
|---|---|---|
| `derive_from_reference` | `llm` | A field wanting a short structured value whose KB slot holds narrative. The prototype returns the prose as the answer; this hands it back as source material to derive the value from. |
| `needs_attachment` | `staff` | Split out of the above — an upload is the one outstanding task the calling model cannot do. A document is not text it can write. |
| `compression_infeasible` | `llm` | Over the limit by more than `MAX_COMPRESSION_RATIO` (4x). Still handed back, but carrying the warning that facts must be dropped and that the reply must name which. The prototype reports a 46x overrun identically to a 1.2x one. |
| `carries_figures` | — | Set from `containsNumericClaim`, independently of the KB's `verified` flag. |

The last matters most. `figures.ts` already recorded that `verified` is the wrong axis for
staleness — it fires on `kb.docs`, which holds no figures, and stays silent on `kb.metrics`, whose
wage figure drifts about $1,500 every four days. A `verified: true` answer full of moving figures is
both the common case and the dangerous one, so the two warnings are independent and both can apply.

#### Changed — outcomes name an actor, replacing a single "needs a human" flag

**This corrected a scope error made earlier the same day.** The first cut of this module treated every
unfinished question as human work: an over-limit answer, and a short field holding narrative, both
came back marked for a person with the text withheld from the answer slot. That inverts what the layer
is for. Shortening an answer and pulling a value out of prose are exactly what the calling model is
there to do; only a fact or a decision the layer does not hold needs a person.

So `AnswerPlan.needs_human: boolean` became `AnswerPlan.actor: 'none' | 'llm' | 'staff'`, with
`STATUS_ACTOR` exported as the single mapping and `summary.by_actor` counting all three. The tool
splits its outstanding-work summary the same way: `your_tasks` (with the handback attached, ready to
do) and `staff_actions`.

The difference is not cosmetic. On the `aug7_truist` fixture the old shape reported **9 of 17
questions needing a person**; the same form now reports **8 done, 8 the calling model can finish
immediately, and 1 genuinely needing staff** — the requested amount. A model reading the old output
would have stalled a draft that was ready to finish.

`renderMarkdown` follows: the header reads "N awaiting a rewrite · N awaiting staff", and source text
for owed work renders in a collapsed block labelled by task rather than as a blockquote that reads as
the answer.

### Found — the knowledge base cannot answer 42 of the 87 bank questions

Measured while building `reference_only`, and the reason that branch fires on 43 of the 106 questions
across the seven form fixtures rather than on a handful.

**Every non-narrative question in the v0.4.0 bank routes to a narrative KB slot.** All 42 of them:

| `answer_type` | Questions | Shortest slot it routes to |
|---|---|---|
| `field` | 15 | `kb.profile.state_pa`, 30 words |
| `single_select` | 8 | `kb.eligibility`, 124 words |
| `attachment` | 8 | `kb.docs`, 41 words |
| `boolean` | 5 | `kb.financials`, 116 words |
| `number` | 4 | `kb.metrics`, 184 words |
| `demographic` | 2 | `kb.profile.demographics`, 55 words |

The knowledge base holds 29 narrative answers and **zero short structured values**. So the sharpest
case is not a rounding error: Truist's `cover.project_title`, a 30-character "name of your solution"
field, routes to the 199-word `kb.program_desc`. The correct answer is "Launchpad".

This is a **content gap, not a code defect**, and `grant_build_draft` cannot close it — the honest
behaviour is to flag the field and hand the prose over as background, which is what it does. Closing
it means either adding short structured slots to `kb_launchpad.json` or accepting that ~40% of a
typical form is filled in by hand. **Not yet on the board**; it belongs with the Phase B content work.

One case inside that number is a bank-typing question rather than a content gap: Truist's "Who does
your solution serve, and in what ways will the solution impact their lives?" is typed `demographic`
and reads as narrative. The pipeline is not the right place to second-guess the bank's typing, so it
flags it like the rest.

### Verified — the G3 gate's second half, through the real server

`grant_build_draft` with `form_id: 'aug7_truist'` returns a 17-question draft package and a figure
work order scoped to the KB slots that draft used, asserted in
`apps/mcp-server/src/__tests__/tools.test.ts` against the spawned server rather than the library.
Full suite: **183 tests across 12 files**, up from 131 — 41 new in `src/pipeline.test.ts`, 8 in
`src/handback.test.ts`, and 3 new integration cases. `packages/grants` lints clean.

### Not verified — the G3 gate's first half, and why more code will not fix it

**G3 has not passed, and `admin/SPEC.md`'s own gate table now says so.** Its first half is "25
pipeline parity tests pass" and the real number is **20 of 25**:

| Prototype class | Cases | Where they are |
|---|---|---|
| `CountUnitsTests` | 5 | `src/limits.test.ts` — ported into `limits.ts` at G2 |
| `TruncatePreviewTests` | 3 | `src/limits.test.ts` — same |
| `BuildAnswerTests` | 9 | `src/pipeline.test.ts`, one for one |
| `ResizeHookTests` | 6 | 1 here (`resizer absent` ≡ resize off); **5 unportable at G3** |
| `RunTests` | 2 | `src/pipeline.test.ts`, one for one |

The five deferred cases inject a `ClaudeResizer` into `build_answer`. `admin/SPEC.md` §2.2 already
records that `ClaudeResizer` **does not port at all** — an MCP tool is invoked *by* Claude, so there
is no in-process resizer to inject, and `grant_resize_answer` returns instructions for the caller
instead. Those cases cannot pass before G4 exists, and writing stand-ins that pass without it would
make the gate report coverage it does not have.

**This is a gate decision, in the same class as G1's "three table rows, one registered tool".** Either
restate G3 as 20 cases and move the 5 onto G4 — making G4's bar 12 rather than 7 — or hold G3 open
until G4 lands. Recorded on board D1 (#71) and the D2 milestone (#72). Nothing about
`grant_build_draft` itself is outstanding.

### Not verified — `grant_build_draft`'s ACL path

Its `tool_permissions` row exists and was confirmed by query, so it will resolve. But nothing has
driven a real bearer-token call through it the way 2026-08-03 did for `grant_match_question`, and a
green test run is not evidence about permissions: `tool-helpers.ts` reaches `canCallTool()` only when
`currentCaller` is set, and only `serve-http.ts` sets it. Repeating the G1 method per tool is the only
thing that would settle it.

### Fixed — stale seed counts in `admin/SPEC.md` and `src/data.ts`

Both said the bank held 82 questions and 211–212 variants. It has held **87 questions and 247
variants** since v0.4.0 — `jq` over `seed/questions.json` settles it, and the `grant_match_question`
tool description already carried the correct figures. Found by grepping for the claims this change
falsified, per [`CLAUDE.md`](CLAUDE.md) §1.

---

## 2026-08-03

### Added — a `grant-writing` Claude Code skill that drives the deterministic layer, and a matcher defect it exposed

`README.md` describes `docs/PLAYBOOK.md` as "the source the grant writing skill is authored from"
while no such skill existed. It does now: `.claude/skills/grant-writing/`, with `SKILL.md` (the
workflow), `references/style.md` (voice, banned words, the two non-negotiables, the self-edit
checklist), `references/figures.md` (how to act on the 17 figure checks), and two scripts that drive
`@lp-ai/lib-grants` from the command line:

- `scripts/prep.mjs <form-id-or-path>` — refuses to run on a non-empty integrity report, then reports
  per question the matched bank entry and confidence, the KB slot, the `measure()` verdict against the
  funder's limit, a `GAPS` block, and the scoped figure work order. Reads only; makes no connector call.
- `scripts/count.mjs <drafts.json>` — `measureAll()` over drafted answers, plus em-dash and
  banned-jargon checks. Exits non-zero on any failure, so "within limits" cannot be asserted by eye.

This is distinct from the `skill_grant_writing` MCP tool, which returns a prompt and does not touch
the matcher, `limits.ts`, or `figures.ts`.

### Added — gap-fill: a researched-candidate path for questions the bank cannot answer

Previously a gap stalled the draft. `SKILL.md` said "write from live data or ask", so a form like the
NBA Foundation's — 9 low-confidence, 1 `no_kb_answer`, 1 `kb_unverified` out of 13 — produced a package
with holes. The skill now researches and drafts a candidate instead, via `references/gap-fill.md` and
two new scripts:

- `scripts/gapfill.mjs <form> --out candidates.json` classifies every gap (`unmatched`,
  `no_kb_answer`, `kb_unverified`, `low_confidence`) and emits a record per gap carrying the source
  ladder to work. `--validate` then enforces: non-empty answer, **at least one source**,
  `verified:false`, within limit, no em dash, no banned jargon.
- `scripts/corpus_search.py "<terms>"` searches prior filed applications in the grant corpus for how a
  question was already answered. This is the highest-yield rung and the most often skipped — the NBA
  Spring 2026 filing left "five most recent funders" blank while the Nov 2025 filing answers it.

**The verified boundary is preserved deliberately.** Candidates are `verified:false` and nothing writes
to `seed/kb_launchpad.json`; promotion is a human edit. `verified:true` there means grounded in filed
material, and an automated promotion path would turn every researched guess into apparent confirmed
fact one cycle later. Dollar amounts, the three framing choices, unconfirmed entity names, and
definitional figure conflicts still go to a person regardless of what research turns up.

### Added — `grant-writing-standalone`, a portable skill with no platform dependency

`.claude/skills/grant-writing-standalone/` carries the craft with none of the infrastructure: no
`@lp-ai/lib-grants`, no MCP tools, no knowledge base, no corpus. It builds a reusable fact base from
whatever the user supplies (`references/fact-base.md`), drafts against the funder's transcribed
questions, and verifies lengths with `scripts/check.py` — Python stdlib only, so the folder can be
copied into any Claude instance. Organization-agnostic, so it is usable outside Launchpad.

Verified decoupled: `grep -rn "lp-ai\|packages/grants\|query_\|Launchpad"` over that folder returns
nothing. Its counter uses Python `split()`, which is the same semantics `py.ts` ports for the platform,
so counts agree with `limits.ts` rather than merely approximating it.

**Defect found, not fixed — `matchQuestion()` mis-routes an unseen funder's need statement to the
mailing-address slot.** "Explain the issue that your program is seeking to address." returns
`cover.address` ("What is your organization's mailing address and contact information?", `kb_ref:
kb.profile.identity`) at confidence 0.353. The correct target is `need.problem_statement`, which
shares both `issue` and `address`. The verb "address" collides with the noun, and `cover.address`'s
shorter canonical wins on the weighted Jaccard. Reproduce:

```bash
node -e "const {matchQuestion}=await import('./packages/grants/dist/index.js');
console.log(matchQuestion('Explain the issue that your program is seeking to address.'))"
```

`DEFAULT_THRESHOLD` (0.42) marks it `is_confident: false`, so the gate holds and a drafter is warned.
The routing is still wrong, and a top-1 match presented without its confidence would answer a
statement of need with an address.

**Match quality collapses on a funder absent from the bank.** Against the NBA Foundation Spring 2026
form (13 questions, transcribed from `Prospects and Proposals/NBA Foundation/Spring 2026/`), 11 of 13
questions came back below threshold; against `hamilton_loi_2025`, a variant source in the bank, all 9
matched at 1.00. The bank's 247 wordings come from 24 forms and NBA is not one of them. Treat
`prep.mjs` output for a new funder as a triage list, not a routing decision.

### Security — plaintext funder-portal passwords across the grants corpus, redacted locally; rotation still required

**Scope is far wider than the two NBA documents first spotted.** A sweep of every `.docx`/`.xlsx` in
the corpus found **92 plaintext password occurrences across 73 files**, covering roughly 50 distinct
funder portals. The grant response template itself carries a "User Name / Password" row, so every
document copied from it inherited the field and staff filled it in.

Aggravating factors:

- **Heavy reuse.** `Building21!` appears across at least 12 unrelated funder portals. `A!BXRMYaBZr57Ty`
  is shared by the NBA Foundation and Nordstrom portals; `Samantha2008!` by NBA Foundation and the
  Philadelphia Foundation. One password compromises many portals.
- **A name-and-year password** (`Samantha2008!`) on funder portals suggests a personal password reused
  from outside work. Rotation needs to extend to wherever else it was used.
- Accounts span `melanie@b-21.org`, `Dannyelle@launchpadphilly.org`, `giving@launchpadphilly.org`,
  `tom@b-21.org`, and funder-issued portal identities.

**What was done.** All 92 occurrences were replaced with `[REDACTED PASSWORD]` in the two local copies
— the extracted tree at `/tmp/opencode/grants-zip/Grants/` and the archive at
`packages/grants/data/Grants-20260803T150803Z-1-001.zip`, which was unpacked, redacted, and repacked.
A re-scan of both reports zero remaining occurrences. Usernames were deliberately left in place: they
identify which account a document belongs to and are not secrets.

**What was not done, and matters more.** `packages/grants/data/` is gitignored and was never committed,
so there is no git history to purge — confirmed via `git log --all -- packages/grants/data/`. But the
**authoritative copies live in staff Google Drive and were not touched.** Redaction is not
containment:

1. **Rotate every password listed in the corpus**, treating all as compromised. Prioritize the reused
   ones and `Samantha2008!` wherever else it was used.
2. Purge or redact the Drive originals, including revision history and any Gmail attachments.
3. **Remove the "Password" row from `Grant Response Template (MAKE A COPY).docx` and
   `Grant Report Template (MAKE A COPY).docx`**, or every future copy reproduces this.
4. Move portal logins to a shared password manager and reference them by entry name.

`README.md` §6 bars sensitive data from this repository; the archive under `packages/grants/data/` is
how this corpus reached it.

### Fixed — mutation audit of the test suite: the integrity checker had no test that could fail, and the skip bound's soundness was argued but not asserted

The suite was audited by breaking the code on purpose — 16 single-line mutations across `data.ts`,
`limits.ts`, `py.ts`, `matcher.ts`, and `seq-ratio.ts`, each run against the full suite to see whether
any test noticed. 13 were caught. Three survived: two of them disabled integrity checks (item 1) and
one tightened the matcher's skip bound (item 2). **If you have a local clone:** `pnpm test` — expect
**131 passing across 10 files**, up from 118.

1. **The entire integrity report engine could be deleted with the suite still green.** Replacing
   `loadIntegrityReport()`'s body with `return []` failed nothing; so did disabling any individual
   check. Every assertion on it said the report is *empty* on the current seed, which a working
   checker on a clean seed and a checker that has stopped firing produce identically — and the
   latter is the failure that matters, because these warnings are what tells staff a KB slot was
   renamed out from under a question or a figure check. The seven checks account for ~130 lines that
   nothing exercised.

   The pure checks are now `computeIntegrityReport(bank, kb)` in `src/data.ts`; `loadIntegrityReport()`
   is the memoised wrapper over the seed on disk, unchanged in behaviour. `src/data.test.ts` runs each
   of the seven codes against a mutated deep copy of the real seed — a declared slot with no answer, a
   renamed figure slot, an attachment question on a narrative slot, and so on — and asserts the code,
   the severity, and that the message names the offending id. It also pins the two near-miss cases the
   checks must *not* flag: a `null` `kb_ref`, and an attachment question correctly routed to
   `kb.docs`. Mutating the checker now fails 8 tests where it previously failed none.

2. **`matchQuestion()`'s bounded skip could be tightened to `0.7 * J + 0.25` with the suite green.**
   The skip is only exact while `0.7 * J + 0.3` is a true upper bound on the blended score, and both
   the full-scan reference test and the prototype parity fixture are input-dependent: they diverge
   only if the bank happens to hold a candidate the tighter bound wrongly skips. At 0.25 none did, so
   an unsound optimization looked identical to a sound one. The bound is now
   `scoreUpperBound(jaccard)` — one exported function, the only place the constant lives — and
   `matcher.test.ts` asserts it against every one of the ~35,400 blended scores a reference pass computes
   in full. Both 0.25 and 0.299 now fail.

Two smaller items, no behaviour change: `pyLen`'s test asserted `'🚀'.length === 2`, a claim about
JavaScript that no change to this package can falsify, alongside a BMP-only case (`—≥⚠✅`) that passes
under a plain `.length` too and so proved nothing; it now uses a mixed astral string that does not.
Nothing else in the audit needed changing — the sequence-ratio parity fixture, the autojunk cases, the
`limits.ts` verdict and preview rules, and every `py.ts` primitive all caught their mutations,
including the ones that reintroduced the original bugs those tests were written for.

### Fixed — code review of `packages/grants`: a parity gate that had stopped covering the bank, and five latent defects

A review of the package and its build wiring. All 43 tests, typecheck, and lint passed before it, so
every item was either latent or a gate that had quietly stopped checking what it claimed. **If you
have a local clone:** nothing to run beyond `pnpm test` — expect **118 passing across 10 files**, up
from 82 across 8, because `limits.ts` and `py.ts` had no test file at all and now have one each.

1. **The G2 `difflib` parity fixture had gone stale, and the assertions could not detect it.**
   `src/__fixtures__/seq-ratio-parity.json` was generated on 2026-07-29 against the 82-question /
   211-variant bank and never regenerated for v0.4.0. 35 of the current 322 candidate strings were
   absent from it, including three of the six that now cross the 200-character autojunk threshold —
   `program.description`/WPF-2026 (352 chars), `organization.history`/JEVS-C2L (244), and
   `organization.why_this_funder`/Hamilton-2025 (221), the longest and most autojunk-exposed strings
   the v0.4.0 bank added. The suite stayed green because it asserted `pairs.length > 28_000` and
   `autojunk_candidates` `toHaveLength(3)`, both of which a stale fixture satisfies. So "G2 parity is
   intact — all 28,690 ratios unchanged", in the entry below, was true of the pairs recorded and
   silent about the ones that were not.

   Fixed three ways. The fixture was regenerated: **58,926 of 58,926 pairs reproduce CPython 3.14.6
   exactly**, and a control pass confirmed all 26,098 pairs carried over from the old fixture are
   bit-identical, so the new harness is not quietly a different measurement. Coverage now spans every
   candidate as `b`, every canonical and every captured form question as `a`, and every
   autojunk-crossing candidate in both orientations. The assertions are derived from the live bank
   rather than hard-coded — a candidate the fixture has never compared against CPython now fails
   `seq-ratio.test.ts`. And the generator, which had never been checked in, is now
   `scripts/regenerate-seq-ratio-parity.py` plus `scripts/dump-parity-strings.ts`; it needs no
   prototype checkout, since `ratio()` is CPython stdlib, and it takes its normalized strings from
   this package's own `normalize()` so the fixture cannot disagree with the port about tokenization.

2. **`scripts/regenerate-matcher-parity.py` silently skipped every form fixture.** `REPO_ROOT =
   parents[2]` resolved to `<repo>/packages`, so `repo_seed` pointed at a nonexistent
   `packages/seed`; `Path.glob` on a missing directory yields nothing, so `form_texts()` returned
   `[]` while the harness printed success. The documented procedure's "appends any new bank texts
   **and form-fixture question texts**" had never done the second half. Now `parents[1]`, and
   `form_texts()` raises on a missing directory rather than returning empty. Verified: 106 form
   question texts are found, all 106 already covered by the checked-in fixture, so no regeneration
   was needed — which is why this never surfaced. The next transcribed funder form would have been
   the first to go missing.

3. **Nothing validated the KB slot ids in `FIGURE_CHECKS`.** `loadIntegrityReport()` checked question
   `kb_ref`s and the `kb_launchpad.json` meta prose, but not `figures.ts`. Since
   `buildFigureWorkOrder()` scopes by intersecting `appears_in` with the caller's slots, one renamed
   KB slot would have dropped a `severity: 'high'` check — `employment_earnings_total`, say — out of
   every scoped work order, and the draft would publish the frozen `$350,268` with no verification
   step and no warning. That is the exact failure `figures.ts` exists to prevent. Added the
   `figure_check_ref_dangling` warning in `src/data.ts` and a test. All 26 refs resolve today.

4. **Four Dockerfiles' `deps` stages were missing three workspace manifests.** `packages/grants`,
   `connectors/bigquery`, and `connectors/roam` were absent from the `COPY */package.json` list in
   all of `apps/{mcp-server,aws-mcp-server,hq,sync}/Dockerfile` — 11 of the lockfile's 14 importers.
   The images build today only because grants' one dependency (`zod`) is already in the lockfile via
   other packages; the first grants-only dependency would fail the builder's `pnpm install
   --frozen-lockfile --offline` with `ERR_PNPM_NO_OFFLINE_TARBALL`. Verified by reproducing the deps
   stage in a scratch directory: with the three added, pnpm resolves all 14 importers and leaves
   `pnpm-lock.yaml` byte-identical.

5. **`measure()` read its verdict off the rounded display ratio, and accepted `max: 0`.** At 4.04x
   the ratio rounds to 4.0, compared false against `MAX_COMPRESSION_RATIO`, and came back
   `over_limit` with "cut the least-essential supporting detail" guidance for a text needing more
   than the 4x compression that constant exists to refuse. The verdict now uses the exact ratio and
   the display keeps rounding. `max` is validated as a positive integer — it is a public export and
   the seed schemas are not the only caller, so `max: 0` previously produced `ratio: Infinity` and
   guidance reading "(Infinityx)".

6. **A sentence-unit preview could itself be over the limit, and was unmarked.** `truncatePreview`
   splits with `pySplitSentences` (terminal punctuation *plus* whitespace) while `countUnits` counts
   with `pyCountSentences` (punctuation alone). Any decimal figure splits the two rules apart, and
   grant narrative is made of decimal figures: `'Our FY2025 budget is $1.34M. We serve 145 young
   people.'` is two chunks to the splitter and three sentences to the counter, so slicing to `max = 2`
   chunks returned the whole string as a "preview" that re-measures as `over_limit`. The branch now
   keeps chunks only while the counter agrees they fit, and marks the cut with `…` like the `words`
   and `characters` branches always did. Both prototype rules are unchanged — neither can move. One
   stated exception: when not even the first chunk fits, it is kept anyway, because an empty preview
   tells a reviewer nothing and cutting inside the chunk would mangle the figure.

7. **`pySplit`, `pyRstrip`, and `pySplitSentences` used JS `\s`, which is not Python's whitespace
   set.** Python treats U+001C–U+001F and U+0085 as whitespace and JS does not; JS matches U+FEFF and
   Python does not. Nothing in the seed hits either case today, but U+0085 rides in on text pasted
   out of Word or Drive, and the result would be a word count off by one against a hard funder cap —
   the same latent class `pyLen` is documented for. All three now use an explicit Python whitespace
   class, and `pyCountSentences` counts blank pieces by the same rule.

8. **`matchQuestion` re-normalized all 322 candidates on every call.** With `grant_match_question`
   accepting up to 200 questions, one call burned ~1.7 s of synchronous CPU in the single-threaded
   HTTP server, blocking every other request and `/health` for that window. Candidates are now
   normalized once per bank (`WeakMap`-keyed), and a candidate whose `0.7 * J + 0.3` upper bound
   cannot beat the incumbent skips the `difflib` call entirely. That second part is exact, not a
   heuristic — `sequenceRatio ≤ 1` and IEEE `+`/`*` are monotone, so the bound never sits below the
   true score, and a candidate only ever wins on a strictly greater score. A 200-question batch of
   real form questions went from ~1.7 s to 0.53 s. **Worst case is unchanged in kind:** 200 questions
   that match nothing keep the incumbent low enough that the bound never bites, and still cost ~1.2 s.
   Guarded by a new test that pins the result against a full-scan reference matcher on every captured
   form question and every autojunk-crossing candidate, in addition to the 377-case prototype fixture.

Also corrected, mechanically: the autojunk table in `src/seq-ratio.ts` (293 candidates and three
crossings, now 322 and six), and the suite counts in `CLAUDE.md` §3 and §6, `docs/runbooks/local-dev.md`,
`admin/ARCHITECTURE.md`, `admin/SPEC.md`, and `README.md`. The dated G2 result table in `admin/SPEC.md`
§5 is left as the 2026-07-29 record, with the re-verification noted beneath it.

### Fixed — the grant layer now builds as part of the MCP image; the regeneration harness is dev-only tooling

Two deploy-path corrections that land with the v0.4.0 bank below. **If you have a local clone:**
rebuild the image normally — nothing new is required; the mcp-server Dockerfile now builds
`@lp-ai/lib-grants` before `@lp-ai/mcp-server`.

1. **The MCP image never built the grant package.** `apps/mcp-server/src/tools/grant-match-question.ts`
   imports `@lp-ai/lib-grants`, whose `main`/`types` resolve to `packages/grants/dist/`. The mcp-server
   Dockerfile built `lib-config`, `lib-db`, `lib-embedding`, and `mcp-server` but never `lib-grants`, so a
   clean image build failed with `TS2307: Cannot find module '@lp-ai/lib-grants'`. The fix is one line:
   `RUN pnpm --filter @lp-ai/lib-grants build` inserted before the mcp-server build in
   `apps/mcp-server/Dockerfile`. Verified by deleting `packages/grants/dist` and running the chain in the
   Dockerfile's order — the mcp-server build now succeeds.

2. **The Python regeneration harness is dev-only and is now excluded from the image.** TAD §1.3 says
   "no Python survives into the platform": the runtime grant layer is TypeScript throughout
   (`@lp-ai/lib-grants` depends on `zod` and nothing else; `grant_match_question` consumes it directly).
   The one Python file in `packages/grants` — `scripts/regenerate-matcher-parity.py` — is build tooling
   that regenerates the checked-in `matcher-parity.json` fixture, and it must run CPython `difflib` to
   preserve G2 parity (the fixture is asserted against the prototype). It is not part of the runtime,
   but the Dockerfile's broad `COPY ./packages` was shipping it anyway. `.dockerignore` now excludes
   `packages/grants/scripts` and `packages/grants/data` so neither the harness nor the raw Drive archive
   enters the build context. The tool description on `grant_match_question` also carried the pre-v0.4.0
   bank counts (82/211); updated to 87/247.

Also updated for the new dependency: the root `CLAUDE.md` package graph now lists `@lp-ai/lib-grants`
under `apps/mcp-server`, closing the gap recorded in this package's `CLAUDE.md` §4 (debt item 5).

### Added — question bank at v0.4.0: first archive-derived forms, five new canonicals, and T2 figure checks

**If you have a local clone:** the parity fixture changed with the bank, so nothing is required on
your side — the suite regenerates nothing at runtime. But any future edit to `seed/questions.json`
must follow the regeneration procedure below, unchanged from the v0.3.1 entry.

**What landed.** Three real funder-form fixtures transcribed from the Google Drive Grants archive
export at `packages/grants/data/Grants-*.zip` (the archive itself is not committed — `README.md`
rule 6, `TAD.md` §2.5):

- `seed/forms/jevs_c2l_2024.json` — JEVS C2L-PHL youth provider RFP, 16 questions, 2 word limits.
- `seed/forms/wpf_workforce_2026.json` — William Penn Workforce Training Supports RFP, 12 questions, 3 character limits.
- `seed/forms/hamilton_loi_2025.json` — Hamilton Family Charitable Trust LOI, 9 questions, 6 character limits.

The bank grew from 82 → 87 canonical questions and 212 → 247 recorded wordings. 35 new wordings were
appended to existing canonicals as `variants` with real `source` labels (`JEVS-C2L`, `WPF-2026`,
`Hamilton-2025`), three new sources registered in `meta.sources` (19 → 22). Five new canonical
questions were added under growth rule 1: `cover.fiscal_sponsor`, `cover.grant_period`,
`cover.multi_year`, `eligibility.minority_owned`, and `eligibility.debarment` — each with a real
sourced wording as its first variant.

**Degradation control, the part that matters.** The matcher parity fixture was regenerated from the
prototype against the new bank (same procedure as v0.3.1: sync the prototype bank, control-pass
first, then regenerate and read the diff). Result: **all 337 previously recorded match cases are
byte-identical** — zero shared-case changes, 40 new cases added. G2 parity is intact (all 28,690
`difflib` ratios unchanged). Every canonical and every variant still self-matches above the 0.42
threshold, asserted by the suite. Full suite: **43 of 43 pass.**

**The regeneration harness is now in the repository.** The v0.3.1 entry below recorded that no
generator script survived the porting session; that gap is closed. `scripts/regenerate-matcher-parity.py`
is the committed version of the reconstructed procedure — it takes the prototype pipeline directory
with `--prototype`, supports `--control`, and regenerates the fixture in place. Any future bank edit
should run it (copy `seed/questions.json` to the prototype's `question-bank/` first, then
`python3 packages/grants/scripts/regenerate-matcher-parity.py --prototype ~/Projects/Grants/pipeline packages/grants/src/__fixtures__/matcher-parity.json`).

One subtle placement decision is recorded because it prevents a regression: the WPF "Project
description" wording and its 250-character cap live on `program.description`, not
`cover.project_summary`. Putting it on the summary question creates a 1.0 tie between the two for the
string "Project Description.", and bank order flips the recorded match. See `seed/QUESTIONS-SCHEMA.md`
under v0.4.0.

**T2 — the archive's second use.** The KB was already distilled from this same archive family (its
`source_recency` named WPF 2026, GSK/Truist Aug-7), so the T2 move was narrower than expected: the
newest approved document in the archive is the Barra Foundation Launchpad Inc overview (Jul 2026),
which introduces figure claims the KB and its figure work order did not carry. Added three checks to
`src/figures.ts` (`inc_client_work_booked`, `program_size_reach`, and an updated `top_employers`
note) and registered the Barra overview in `kb_launchpad.json`'s `source_recency`. No KB answers were
rewritten — filed-figure staleness rules (`TAD.md` §3.1–3.2) mean figures move through the work order,
not the KB.

**Data provenance.** Questions and limits came from the three archive files named in each fixture's
`meta.note`. No personal data, no transcripts, no budgets-as-figures were ingested. Nothing was
invented: every added wording is verbatim from a real form.

### Changed — question bank at v0.3.1, and the parity fixture regeneration procedure

Board B6 (#62), the matcher quality review. **If you have a local clone, nothing is required** — no
schema, no tool surface, no env var moves. But if you ever edit `seed/questions.json`, read the
regeneration procedure below, because the suite will fail until you follow it.

**The bank change.** One recorded funder wording added under growth rule 2 in
`seed/QUESTIONS-SCHEMA.md`: `{ "text": "Attach IRS letter.", "source": "FFTC" }` on
`attachments.501c3`. `meta.version` 0.3.0 → **0.3.1**, 211 → 212 wordings. It lifts
`Upload your IRS letter of determination.` from 0.351 to **0.43**, above the 0.42 threshold.

The wording is real — FFTC's Applicant Summary asks *"Is your org a 501(c)(3) with valid EIN?\* →
EIN\*, attach IRS letter\*, attach Board list\*"*. No provenance was invented.

**Corrected procedure — you cannot edit the bank without regenerating the fixture.**
`src/matcher.test.ts` asserts `fixture.bank_version === bank.meta.version`, so any bank edit fails the
suite until `src/__fixtures__/matcher-parity.json` is regenerated. The fixture says "Do not hand-edit"
and **no generator script survived the porting session**, so the procedure had to be reconstructed.
B6's own task description was wrong on this point: it says to regenerate "from the snippet in each
fixture's `note` field", and neither note contains a snippet.

What actually works, and what any future bank edit must do:

1. The **inputs are recoverable from the fixture itself** — every case carries its `incoming` string.
   337 cases plus 15 `threshold_cases`.
2. The prototype is **not in this repository** by design (`admin/TAD.md` §2.5) but is on the build
   machine at `/home/demitridmili/Projects/Grants/pipeline/matcher.py`. Verify the prototype bank is
   byte-identical to `seed/questions.json` (sha256) *before* changing anything, and that Python is
   **3.14.6** — the version the fixture records.
3. **Run a control pass first.** Re-run the unmodified `matcher.py` over the fixture's own inputs
   against the *unchanged* bank and diff against the recorded expectations. It must report **zero
   differences**. A harness that cannot reproduce the fixture must not be trusted to replace it.
4. Then regenerate against the updated bank, and read the diff. Ours was **3 field changes on 1 case**
   plus `bank_version`. Anything wider than intended means the bank edit had side effects.
5. **Do not modify `matcher.py`.** Parity means parity with the prototype that produced LaunchPad's
   filed applications. Changing the prototype to preserve a green suite would make the parity evidence
   circular.

Also updated for the new count: the `data.test.ts` shape assertion (211 → 212) and the coverage
section of `seed/QUESTIONS-SCHEMA.md`.

**Suite after the change: 82 of 82 pass, 8 files, zero skipped**, including all 337 matcher parity
cases and all 28,690 recorded `difflib` ratios. G2 parity is intact.

**Unresolved, and deliberately left open.** B6's other question,
`How will you measure whether the program succeeded?`, is **not fixed and cannot be fixed by adding
variants**. The shortfall is one unstemmed inflection: the same question scores 0.352 with `succeeded`
and **0.644 with `success`**. `succeeded` matches no token in the bank and also misses the
`success: 2.0` keyword weight. Six real sourced wordings were trialled and every one left the score at
0.352.

Both of B6's strings turned out to be the prototype's own smoke-test samples — `matcher.py`
lines 160–161, inside `if __name__ == "__main__"` — and appear in no funder form. Adding the wording as
a variant would mean inventing a funder source, which §1's "do not invent" rule forbids. The fix is
either an inflection hack or real stemming, and both move the parity baseline off the filed-application
prototype. **That is a `TAD.md` decision, not a task.** The measurement is on #62.

### Verified — G1 half 2, the ACL path, through a running server

The second half of the G1 gate condition in `packages/grants/admin/SPEC.md` §1 — "the three tools
resolve in the ACL" — is now proven rather than assumed. **G1 has passed.** Board: A5 (#54) and the
A6 milestone (#55) are closed.

The gap this closes was specific. `apps/mcp-server/src/tool-helpers.ts` only reaches
`canCallTool()` when `currentCaller` is set, and the caller is set in exactly one place —
`serve-http.ts`, from a verified bearer token. The stdio path never sets it, so **no unit or
integration test in this repository has ever executed the ACL branch**, including the suite that
spawns the real server. Proving this half required the HTTP transport and a real token.

Method: `dist/serve-http.js` against local Postgres, with a throwaway RSA keypair in
`JWT_PRIVATE_KEY` and two `ACTIVE` `mcp_users` rows — one `leadership`, one `program_staff`. Tokens
minted against the same key, then `initialize` and `tools/call` to `/mcp`.

| Caller | HTTP | Outcome |
|---|---|---|
| no bearer token | 401 `unauthorized` | refused by the transport, never reaches the tool |
| `leadership` | 200 | matched `organization.mission`, confidence 1.0, `integrity_warnings: []` |
| `program_staff` | 200 | `isError: true`, `{ code: 'permission_denied' }` |

Both authenticated calls wrote to `usage_logs` with the caller email attached, which is what HQ
`/tools` reads. **The refusal is logged too**, not only the success — a denied call is visible on
`/tools` rather than silent.

**What this does not prove.** Two things, and neither is covered by the gate's own pass condition:

- **Production.** Every result above is local. Whether the grant `tool_permissions` rows exist on RDS
  is still unknown and still unowned — board A3 (#52) stays open for it.
- **Three working tools.** The pass condition is satisfied by three *table rows*, and only
  `grant_match_question` is registered. `grant_build_draft` and `grant_resize_answer` are reserved
  rows awaiting G3 and G4. G1 passing means the ACL path works on the one tool that exists.

**Blast radius: none.** No source file changed. The keypair was never committed and lives only in a
session scratchpad; the server was stopped and both test users deleted. The `usage_logs` rows are
left in place as the evidence, so `select * from usage_logs where tool_name = 'grant_match_question'`
reproduces the table above on any clone that ran this.

To repeat it on another clone: start `dist/serve-http.js` with `JWT_PRIVATE_KEY`, `JWT_KID`,
`MCP_OAUTH_ISSUER`, and `MCP_PUBLIC_URL` set, insert two `mcp_users` with differing roles, and sign
tokens with the same key. §5.2 of `admin/ARCHITECTURE.md` records why CI cannot do this yet.

### Fixed — two tables had no migration, which broke every fresh local setup

`schema.prisma` declared `StudentPostsecondary` (`student_postsecondary`) and `AwsResourceJob`
(`aws_resource_jobs`), but **no migration ever created either table**. Both had only ever been
created by `prisma db push`, which diff-syncs the database and writes no migration file. The gap was
identical on `origin/master`, so it was not branch-local.

Consequences on any database built by `prisma migrate deploy` — which is how production deploys:

- `pnpm db:seed` aborted outright on `prisma.studentPostsecondary.deleteMany()`, so a
  migrate-built local environment could not be seeded at all.
- `packages/db/src/entity-resolution.test.ts` calls the same `deleteMany` in `beforeEach`, so that
  entire suite could not run.
- `query_postsecondary` failed at runtime, even though migration
  `20260610190000_add_query_postsecondary_permission` had already granted it a permission row.
- The HQ `/aws-jobs/[id]` route failed at runtime.

Added `packages/db/prisma/migrations/20260803000000_add_missing_postsecondary_and_aws_jobs_tables/`.
It transcribes both models following the conventions of `20260527000000` (native `uuid` primary keys
with `gen_random_uuid()`, `timestamp(3)`, `IF NOT EXISTS` on every statement, `DO`-block-guarded
foreign key). It drops nothing and rewrites no column, so it is a **no-op** on a database where
`db push` already created these tables — it simply records itself in `_prisma_migrations`.

**If you have an existing local clone:** run `pnpm db:migrate`. Nothing is destroyed.

**Still open:** whether production actually holds these two tables is *unverified*. If production was
ever `db push`ed it does, and this migration is a harmless no-op there. If not, `query_postsecondary`
and `/aws-jobs` are broken in production right now. RDS is not publicly reachable, so checking needs
an ECS one-off task or the bastion.

**Deliberately not fixed:** `prisma migrate diff` also reports `id` columns on
`student_employment`, `student_postsecondary`, and `aws_resource_jobs` as differing — native
`uuid`/`gen_random_uuid()` in the database versus `String @default(uuid())` in `schema.prisma`. This
is representational only; Prisma maps Postgres `uuid` to `String` and the relations work. Closing it
would mean dropping and recreating live primary keys. Those diff entries are expected to persist.

### Changed — the local setup path is `db:migrate`, not `db:push`

`docs/runbooks/local-dev.md` told you to build the local schema with
`pnpm --filter @lp-ai/lib-db push`. That instruction is what kept the defect above invisible, and it
has a second cost: `db push` runs no migration SQL, so **none of the `tool_permissions` seed rows
land**. A `db push` local environment therefore has an empty ACL, and because the registry fails
closed (`apps/mcp-server/src/permissions.ts`), every tool call returns `permission_denied` for
every user.

The runbook now uses `pnpm db:migrate`, which is also how production builds its schema. Corrected
alongside it in that file:

- Test count was documented as 42; the suite is **82 tests across 8 files**.
- `cp .env.example .env` leaves `DATABASE_URL` blank, which fails with no useful error. The runbook
  now gives the value explicitly.
- `pnpm --filter @lp-ai/mcp-server build` is a **prerequisite for `pnpm test`**, not just for
  running the server. Without `dist/`, the integration suite spawns a nonexistent entrypoint and
  fails with `RPC initialize timed out`, which points nowhere near the real cause.
- Re-seeding a database that already has rows needs `SEED_FORCE=true`; the guard in
  `packages/db/src/seed.ts` otherwise no-ops and reports `0 inserted`.
- The reset recipe used `push` too, and is corrected.

### Changed — tool count corrected from 16 to 21

**Ten occurrences across five files** claimed the server exposes 16 tools. It registers **21**: 16
data tools, `grant_match_question`, and 4 `skill_*` tools. `grant_match_question` was added
2026-07-31 in `e4ea030` and no documentation was updated. Corrected in the root `CLAUDE.md`,
`README.md`, `docs/mcp-server-spec.md`, `docs/setup/07-mcp-server.md`, and `docs/setup/README.md`.

Worth noting how the last three were found: the first pass caught seven and looked complete. Grepping
for *the claim* rather than for the files already open surfaced three more. That is the entire
technique behind the rule in `CLAUDE.md` §1.

The authoritative count is `grep -c "NAME = '" apps/mcp-server/src/tools/*.ts`, and
`apps/mcp-server/src/__tests__/tools.test.ts` asserts it.

### Added — `admin/ARCHITECTURE.md`, and this changelog moved into `packages/grants`

`packages/grants/admin/ARCHITECTURE.md` is new: the platform surface the grant layer builds against,
the toolchain, and the working cadence. It is deliberately **not** the missing `docs/architecture.md`
— see `CLAUDE.md` §4 item 1.

This changelog and `CLAUDE.md` were written as `docs/CHANGELOG.md` and `docs/CLAUDE.md` and now live
in `packages/grants/`, so that a reader can tell grant-workstream material from repository-wide
documentation without opening it. Both keep their content; both had their scope statements corrected
to match the new location. `CLAUDE.md` records the sources of truth, the current state of the system,
and the rule that a change means reconciling every document it falsifies — plus the verification
commands that make "is this still true?" a query rather than a guess.

Pointers updated: the root `CLAUDE.md` spec list and `docs/runbooks/local-dev.md`.

### Found — CI builds its schema with `db push`, so it cannot prove the ACL

`.github/workflows/ci.yml` line 55 runs `pnpm --filter @lp-ai/lib-db push`. That is the same defect the
local runbook carried: `db push` writes no migration SQL, so **no `tool_permissions` row exists in
CI**, and the registry fails closed. CI is a real signal on the build, the types, and the
database-gated tests. It is **not** evidence for the second half of the G1 gate condition — "the three
tools resolve in the ACL" — and a green check must not be read as closing it. Recorded in
`admin/ARCHITECTURE.md` §5.2. The fix is a platform change of the same shape as the runbook
correction: migrate instead of push. Not done here.

### Verified — G1 half 1, and the ACL invariant

- `packages/grants/src/data.test.ts` passes 10/10 and asserts the seed integrity report is empty, so
  the first half of the G1 gate condition in `packages/grants/admin/SPEC.md` §1 is proven and cannot
  silently regress.
- Every registered tool has a `tool_permissions` row, so nothing currently fails closed. The 8 rows
  without a registered tool are the 6 `future` placeholders plus `grant_build_draft` and
  `grant_resize_answer`, which are reserved for G3 and G4.

---

## Before this changelog

The changelog starts 2026-08-03. Earlier history lives in `git log`; this section records only the
milestones needed to read the current state, each verifiable from a commit.

| Date | Commit | Milestone |
|---|---|---|
| 2026-07-31 | `14d2088`, `e4ea030`, `ced45f8` | Grant writing layer lands: `@lp-ai/lib-grants` question bank and matcher, `grant_match_question` registered, grant `tool_permissions` migration and the HQ grants category |
| 2026-06-26 | `f31bddf`, `4041383` | Notion sync extended to all databases into pgvector; transcript ingestion; Givebutter removed |
| 2026-06-24 | `96a2353` | GiveButter, BigQuery, and Roam connectors removed from all documentation |
| 2026-06-17 | `c7198af` | Destructive delete-before-sync eliminated across all connectors — the origin of the upsert + stale-cleanup rule in the root `CLAUDE.md` |
| 2026-06-17 | `03b93ec` | Aplos integration, sync safety, and production infrastructure documented |
| 2026-05-19 | — | First commit |

Note the gap: the documentation set was broadly last revised **2026-06-24/26**, and the grant writing
work of 2026-07-31 changed the tool surface and the schema without touching `docs/`. That is the
staleness this changelog and `CLAUDE.md` exist to stop repeating.

# Grant Writing Layer — Assessment and Work Package Set

| Field | Value |
|---|---|
| Audience | The project manager, the VP of Technology, and the Grant Writing lane |
| Date | 2026-07-31 |
| Revised | 2026-08-03 — the readability pass. Subjects, descriptions, Accountable, categories, and versions. Refer to "The readability pass". |
| Source | Shared running notes, entries 2026-07-17 to 2026-07-31. The 2026-07-29 Chip and Iman session. The four `admin/` documents. |
| Purpose | Record where the project stands, and hold the work package set for OpenProject. |
| Board | OpenProject `internal-ai-integrations`, work packages #49 to #88. Refer to "The board of record". |
| Companion file | `openproject-import.csv` — the reviewable record of the set, mirroring the board. |

**What this document is.** Two parts. Part 1 is a judgement pass: where the project stands against where its own documents say it stands. Part 2 is the work package set for the Grant Writing lane, as it stands on the board.

**What this document is not.** It does not restate the architecture, the data rules, or the build detail. `TAD.md` and `SPEC.md` own those and stay the authority. Where this document disagrees with them, this document names the disagreement and schedules a task to resolve it. It does not resolve it silently.

**On the Aug 7 applications.** Truist and GSK are both due 2026-08-07. They are not a delivery target for this set. The sequence below follows the `SPEC.md` release gates.

This document follows ASD-STE100 Simplified Technical English, as `PROPOSAL.md` section 11 does. Short sentences. Active voice. One meaning for each term. It uses the em dash as a heading and label separator, as the other `admin/` documents do; the Playbook's no-em-dash rule governs grant prose, not build documents.

---

# Part 1 — Assessment

Eight judgements. Each one cites a note date or a document section, and each one produces at least one work package.

## 1 G1 is not complete, and the board must not say it is

`SPEC.md` section 1 marks G1 as "code complete". The pass condition in the same table is different: *"The loader reports zero warnings. The three tools resolve in the ACL."* The first half holds. The second half is unproven.

`HANDOFF.md`, under "Not verified, and why", records the reason. The permission migration is written and not applied. No tool has been invoked through the server. There is no `.env` in the checkout and no Docker daemon, so Postgres is unavailable, `prisma generate` cannot run, and every database-gated test skips. `pnpm lint` also fails across the repository because `@eslint/js` is not installed.

So the ACL path, the usage-log entry, and the HQ `/admin` Grants section are all untested. Each one is a place where the tool works in isolation and fails in the product.

**Judgement.** Show G1 as open until a tool call reaches the ACL and appears on HQ `/tools`. The first work is the environment, not the next feature. Refer to Phase A.

## 2 The remaining risk is content, not code

G2 closed the one technical risk the documents named, and it closed on the best of the three outcomes in `SPEC.md` section 5.3. The numbers: 28,690 of 28,690 recorded `difflib` ratios reproduce exactly, and all 337 recorded matcher results reproduce field for field.

What is unproven is the knowledge base. It holds 29 answers. Four are `verified:false`. One content gap is confirmed open: no answer mentions Lightspeed, per `SPEC.md` section 3.1. On 2026-07-29 Chip said the Model Grant Applications page is new to him, that he does not use it, and that we should start it from scratch. He and Iman also need time to refine Canonical Facts.

The draft builder can only return what the knowledge base holds. Its quality ceiling is the content, not the matcher.

**Judgement.** The content asks from 2026-07-31 sit on the critical path, not beside it. Schedule the model-grant analysis in parallel with the build, not after it. Refer to Phase B.

## 3 The Playbook contradicts the architecture, and the deferral has expired

`docs/PLAYBOOK.md` opens by having Claude *create* a record in the Grant Applications database with status Researching. It closes by *updating* that record with the amount requested, the framing, and the draft link. That is a write path. It runs against control 6 in `TAD.md` section 2.2 and against `readOnlyHint: true` on all three planned tools.

`HANDOFF.md` flag 4 deferred this on purpose: *"Decision: build the pipeline first, then assess."* The reasoning was sound at the time. Watering either document down before a real draft existed would have been guessing.

G2 is now closed and `grant_match_question` is registered. The pipeline exists far enough to assess.

**Judgement.** The deferral has served its purpose and should now close. Either the Playbook loses the create and update steps, or `TAD.md` sanctions a write tool with its own permission record and its own audit line. Record the reasoning either way. Refer to C1.

The Playbook also carries two rules that are stronger than anything in `TAD.md` section 3. Never name an entity that cannot be traced to a confirmed current source. Ask the fiscal-sponsorship framing every time. Both are correct, and both should move up into `TAD.md` rather than be weakened to match it.

## 4 The wage figure is stated three ways across two documents

`docs/PLAYBOOK.md` reconciles the participant wage claim as $550K stale against $300K current. `TAD.md` section 3.2 documents the same claim as $350,268 in a filed application narrative against $362,361.82 in live platform data on 2026-07-28.

Those are not the same reconciliation. A person reading the Playbook and a person reading the TAD would file different numbers.

This is the exact case that `PROPOSAL.md` section 6, rule 3 says must never resolve automatically: two figures that count different things do not resolve by recency.

**Judgement.** Escalate to Chip and Iman for one sourced number with a stated population and a stated date. Then correct both documents in the same change. Do not let the next editor harmonise them by choosing. Refer to B7.

## 5 Playbook ownership is moving, and the sync direction is undefined

On 2026-07-29 the Playbook was confirmed as *"the source of truth for Grant Writing skill"*. On 2026-07-31 the note reads *"Handbook: tests needed, Iman will own going forward, will schedule time with her next week"*. A comment on the notes document adds: *"Grant Writing Handbook is accurate, this isn't a replacement, we want to use this"*, and *"Part of Iman's responsibility"*.

The Playbook is in this repository at `docs/PLAYBOOK.md`, which is the version-controlled home `TAD.md` section 4.2 argues for. Iman will edit in Notion.

Two homes and no stated direction is a drift condition. The skill is authored from the Playbook at build time, so a Notion edit that never reaches the repository changes nothing in the product, and a repository edit that never reaches Notion is invisible to the owner.

**Judgement.** Settle the direction before Iman starts editing. Name one source of truth, one sync direction, one person who re-authors the skill when the Playbook changes, and one review cadence. Refer to C3 and C4.

## 6 Canonical Facts and the figure work order are the same thing built twice

On 2026-07-29 Chip described Canonical Facts as follows. Latency will be an issue. Each data point should be the language with a query or skill for Claude to run. Consider including the language to paste in to rerun on demand, and a dashboard showing them live.

That description is already built. `src/figures.ts` holds 15 checks. Each names the claim as it appears in the knowledge base, the knowledge base slots that carry it, the exact connector tool, the exact arguments, the conflict kind, and the severity. The live view is an HQ page.

**Judgement.** Name this as one shared artifact before Chip rebuilds the Notion page. The work order supplies the queries. HQ supplies the live view. Two artifacts would diverge on the first figure that changes. Refer to E4.

## 7 The lane's scope boundary is under pressure and should be held

`PROPOSAL.md` section 2.2 puts funder eligibility and fit scoring outside this package. The 2026-07-31 notes assign *"Parsing questions out of grants will be on prospecting team"*.

The same notes open with a gut check: 85 hours across the team, with no code, no documentation, and no recommendations, and with only two people logging hours outside the check-ins. The Grant Writing lane holds the landed deliverables. It is therefore the likely place that other lanes' work arrives.

**Judgement.** Hold the boundary in writing. The lane consumes a parsed form and returns a draft package. It does not parse forms, score funders, or rank opportunities. Work that arrives from another lane gets a work package in that lane, not this one.

## 8 The approval gate and the build have decoupled

`PROPOSAL.md` states "Six weeks from approval" and "Status: For review. Not yet approved." The build is two gates in. `HANDOFF.md` says this happened on purpose: *"We started building before approval, on the understanding that these documents stay open and get corrected as the work turns things up."*

That was a reasonable call. It leaves the schedule unmeasurable. A six-week plan counted from an event that has not happened cannot be tracked on a board.

**Judgement.** Close the three open decisions in `PROPOSAL.md` section 8, or replace "six weeks from approval" with dated milestones. The work package set below assumes the second, and starts on 2026-08-03. Refer to E5 and E6.

---

# Part 2 — Work package set

## Structure

Six phases. Each phase is an OpenProject **Phase** work package. Its children are **Task** work packages. Gate boundaries are **Milestone** work packages.

| Phase | Covers | From assessment |
|---|---|---|
| A | Environment and G1 close-out | 1 |
| B | Model-grant content analysis | 2 |
| C | Playbook, ownership, and tests | 3, 5 |
| D | Build gates G3 to G5 | — (`SPEC.md` section 1) |
| E | External dependencies and decisions | 6, 8 |
| F | Operating procedures | 2026-07-31 notes |

Dependencies use the OpenProject `follows` relation. The `Follows` column in the CSV holds the predecessor subject.

Owners are lane roles, not a staffing decision. Confirm them at intake.

- **Demitri** — build, architecture documents, gate close-out
- **Sean** — content analysis, extraction, drafting craft
- **Iman** — Playbook ownership and content approval
- **External** — another lane or another team. Tracked here because the design depends on it. Not our work.

## Phase A — Environment and G1 close-out

Blocks every other phase. Nothing in Phase D can be proven until a tool call reaches the ACL.

### A1 — Restore a working local environment
Load `.env` from the credentials checklist. Start Postgres with `pnpm db:up`. Run `pnpm db:generate`.
**Acceptance:** the database-gated tests in `packages/grants` run rather than skip. `pnpm exec vitest run packages/grants` reports zero skips for database reasons.
**Owner:** Demitri. **Estimate:** 3h.

### A2 — Fix the repository lint break
`@eslint/js` is not installed, so `pnpm lint` fails everywhere. This is not our defect and it blocks our gate check.
**Acceptance:** `pnpm lint` completes on `packages/grants` with no configuration error.
**Owner:** Demitri. **Estimate:** 2h. No predecessor: the lint break is independent of the database.

### A3 — Apply the tool_permissions migration
The migration at `packages/db/prisma/migrations/20260729000000_add_grant_tool_permissions/` is written and untracked. Apply it locally with `pnpm db:migrate`. Apply it to production with a one-off ECS task or the bastion, because RDS is not publicly reachable.
**Acceptance:** the `tool_permissions` row exists in both environments. The recommended roles are leadership and administrator, per `TAD.md` section 2.4, pending E5.
**Owner:** Demitri. **Estimate:** 3h. **Follows:** A1.

### A4 — Add the grants category to the HQ admin page
`grants` is a new category. Add it to `CATEGORY_ORDER` and `CATEGORY_LABELS` in `apps/hq/app/admin/PermissionsMatrix.tsx`. The file is already modified in the working tree. Verify and finish.
**Acceptance:** the grant tools render in a Grants section on HQ `/admin`, and an administrator can change the roles there.
**Owner:** Demitri. **Estimate:** 2h. **Follows:** A3.

### A5 — Invoke grant_match_question through the running server
The unit tests do not exercise the ACL path or the usage log. Start the server and make a real call.
**Acceptance:** the call appears on HQ `/tools` with the caller identity. A call from a role outside the permission record is refused.
**Owner:** Demitri. **Estimate:** 3h. **Follows:** A3.

### A6 — Milestone: G1 passed
**Pass condition:** the loader reports zero warnings, and the tools resolve in the ACL. `SPEC.md` section 1.
**Follows:** A5 and A4.

## Phase B — Model-grant content analysis

The direct ask from 2026-07-31: *"Where is your analysis of the efficacy of the content we have used in the past? What examples are you using from our past grants to improve our future grants?"*

The notes also set the method: identify the best language manually, focus on six model grants, define the categories to fill, and extract the best in each category from the six models.

Runs in parallel with Phase A. It needs no environment.

### B1 — Define the answer categories the drafts must fill
Reconcile the 11 categories and 29 knowledge base slots in `seed/questions.json` against what the six model grants actually contain.
**Acceptance:** a category matrix. Every slot is marked as strongly sourced, weakly sourced, or unsourced. Every unsourced slot names the grant most likely to hold the language.
**Owner:** Sean. **Estimate:** 8h.

### B2 — Extract best-in-category language from the six model grants
The six, from the "Key LaunchPad Development Files" folder and the 2026-07-21 session: Upwork, Connelly, Google Foundation, Hummingbird, Linehan Family Foundation, and United Way.

Their stated strengths, from the same session. Upwork and Connelly best reflect the current AI engineer, LiftOff, and Inc. framing. Google Foundation carries the structural-shift language on AI and the economy. Hummingbird focuses on Launchpad 101 and enrichment. Linehan covers all programs. United Way is the recommended addition for 101.

Manual extraction, per the 2026-07-31 note.
**Acceptance:** one candidate passage per category, each carrying its source grant and the reason it was chosen.
**Owner:** Sean. **Estimate:** 16h. **Follows:** B1.

### B3 — Write the efficacy analysis
The 2026-07-31 question, answered in writing. What worked. What is stale. What must never re-enter a draft.

One item is already known and is not optional: the retired 12-month full-stack model. `PROPOSAL.md` section 6, rule 4 and `TAD.md` section 3.5 both state that text describing a retired program model must never enter a new draft. The 2026-07-21 session confirms the shift to a shorter AI engineering focus.
**Acceptance:** a short document, in the `admin/` register, naming the retired framings and the passages that carry them.
**Owner:** Sean. **Estimate:** 8h. **Follows:** B2.

### B4 — Fold approved language into the knowledge base
Candidate answers land in `seed/kb_launchpad.json` as `verified:false` until Chip or Iman approves them. `verified:false` is a true unknown and is never presented as confirmed, per `README.md` rule 1.
**Acceptance:** the loader integrity report stays empty. `data.test.ts` asserts this, so a bad entry fails the suite.
**Owner:** Sean, with Demitri on the schema. **Estimate:** 8h. **Follows:** B3.

### B5 — Close the Lightspeed content gap
No answer in the knowledge base mentions Lightspeed. `SPEC.md` section 3.1 records this as a content task for the Data team, not a code task. Tracked here because a draft that omits it is incomplete.
**Acceptance:** an owner is named and the gap is either filled or formally accepted.
**Owner:** External — Data team. **Estimate:** 2h to hand off.

### B6 — Matcher quality review
Two ordinary questions score below the 0.42 threshold in the Python original and in the TypeScript port: *"How will you measure whether the program succeeded?"* and *"Upload your IRS letter of determination."* They route to human review, which is the safe outcome. `HANDOFF.md` flag 5 records that this is prototype behaviour and not a port defect, and asks for this review to be scheduled separately from parity.

Add variants per the growth rules in `seed/QUESTIONS-SCHEMA.md`. Then regenerate the fixtures in `src/__fixtures__/` from the snippet in each fixture's `note` field.
**Acceptance:** both questions match confidently. All existing parity tests still pass against the regenerated fixtures.
**Owner:** Demitri. **Estimate:** 6h. **Follows:** A1.

**REVIEW RUN 2026-08-04. Stays open on a decision, not on work.** Three things, and the first is that this package was measuring the wrong thing.

1. **The premise is half stale, and the acceptance criteria are unreachable as written.** The IRS question matches confidently at 0.430 — fixed in bank v0.3.1 by a real FFTC wording. The success-measures question **cannot** be fixed by adding variants: the shortfall is one unstemmed inflection (0.352 with `succeeded`, 0.644 with `success`), six real sourced wordings were trialled and none moved it, and both of this package's strings are the prototype's own smoke-test samples appearing in **no funder form** — so adding them would mean inventing a funder source, which `../CLAUDE.md` §1 forbids. What is left is a `TAD.md` decision: accept the safe staff-review outcome, or adopt stemming and move the G2 parity baseline off the prototype that produced LaunchPad's filed applications. **Recommend accepting.**

2. **The criteria measure misses, and misses are the safe failure.** Across all 106 questions in the seven form fixtures, **105 of 106 match confidently**; the single miss is the intended control. Recall is not the problem. The damaging class is a **confident wrong match** — it routes to a knowledge-base slot and the draft presents that slot's content as the answer, where a miss says "confirm this mapping" and a person looks. Four were found by scanning each confident match's `answer_type` against the funder's wording and the stated limit.

3. **One fixed, three handed on, and one other package's number corrected.** JEVS's conflict-of-interest question matched `attachments.board_list` at 0.459 *confidently*, on the shared words "Board of Directors" — a yes/no disclosure routed to `kb.docs`. Nothing in the bank covered conflict of interest, so no variant could have fixed it; added `cover.funder_connection` (boolean, `kb_ref: null`), bank v0.4.0 → **v0.4.1**, 87 → 88 questions. Both fixtures regenerated with a control pass first: matcher 377 → 378 cases with **exactly one existing case changed**, and difflib 58,926 → 59,616 pairs. Three more confident wrong matches are on `bd` `grant-h32`, all `aug7_truist` bank-typing defects including the `demographic` question B-phase carved out for here. And `grant-miy`'s "42 non-narrative questions route to a narrative KB slot" is **35** — eight have `kb_ref: null` and correctly route to `per_application`.

### B7 — Escalate the wage-figure conflict
Assessment 4. Take the conflict to Chip and Iman. Ask for one number, with the population it counts and the date it was measured.
**Acceptance:** one sourced figure is recorded. `docs/PLAYBOOK.md` and `TAD.md` section 3.2 are corrected in the same change.
**Owner:** Demitri, with Iman. **Estimate:** 3h.

## Phase C — Playbook, ownership, and tests

The other two asks from 2026-07-31: *"What changes are you proposing to the grant writing playbook? How are you coordinating updates with Iman?"* and *"How are you handling updates to the playbook/skill over time?"*

### C1 — Resolve the Playbook write-path conflict
Assessment 3. Two options. Drop the create and update steps from the Playbook, and have a person maintain the Grant Applications record. Or sanction a write tool in `TAD.md`, with its own permission record, its own audit line, and `readOnlyHint: false`.
**Acceptance:** a decision, with the reasoning recorded in `TAD.md` section 5. `HANDOFF.md` flag 4 is closed.
**Owner:** Demitri, with the VP of Technology. **Estimate:** 4h. No predecessor: this is a decision, and G2 already closed the deferral it was waiting on.

### C2 — Write the Playbook change proposal
The 2026-07-31 question, answered in writing. Covers C1. Covers B7. Covers the two rules the Playbook carries that are stronger than `TAD.md` section 3, and recommends promoting both rather than weakening either.

Also carries the 2026-07-29 feedback on the earlier playbook: *"Likes non negotiables. Not enough information per step."*
**Acceptance:** a document Iman can review in one sitting, with each proposed change marked as a correction, an addition, or a promotion.
**Owner:** Demitri and Sean. **Estimate:** 8h. **Follows:** C1.

### C3 — Run the Iman working session
The 2026-07-31 note says to schedule time with her next week. Agenda: C2, the ownership handoff, and the update cadence.
**Acceptance:** the session happens. The decisions are written up the same day.
**Owner:** Demitri, with Iman. **Estimate:** 3h. **Follows:** C2.

### C4 — Define the Playbook update process
The 2026-07-31 question. Name the source of truth. Name the sync direction. Name who re-authors the skill when the Playbook changes. Name the review cadence.

Constraint: `TAD.md` section 4.2 argues the guidance belongs in the platform under version control, not fetched per draft. Whatever process is agreed must keep that true.
**Acceptance:** a governance section in `TAD.md` or `README.md`. Iman confirms she can work within it.
**Owner:** Demitri, with Iman. **Estimate:** 4h. **Follows:** C3.

### C5 — Build the Playbook test set
Chip and Iman asked for tests on the handbook. A fixed set of prompts whose drafts are graded against the Playbook style rules and non-negotiables, so a Playbook edit can be regression-checked instead of trusted.

Grade against the rules the Playbook already states: no em dashes, no nonprofit jargon, no throat-clearing openers, no setup-and-pivot, every number sourced, no entity named without a traceable current source, and word limits verified programmatically.
**Acceptance:** the set runs against a Playbook change and reports which rules a draft broke.
**Owner:** Sean. **Estimate:** 12h. **Follows:** C2.

## Phase D — Build gates G3 to G5

From `SPEC.md` section 1 and section 2.2. No scope changes here. This phase restates the gates as work packages so they appear on the board.

### D1 — Build grant_build_draft (G3)
`apps/mcp-server/src/tools/grant-build-draft.ts`, plus the pipeline modules it consumes. Ports `count_units`, `truncate_preview`, `build_answer`, `run`, and `render_markdown`.

The path is form, then match, then knowledge base retrieve, then limit check, then Markdown. `render_markdown` emits question, answer, provenance footline, and human-action flags.

The tool returns the figure work order and makes no connector call. `TAD.md` section 2.3 holds the security reason. Do not optimise this by having the tool make the call.

Resize stays off for this gate. Emit the deterministic overflow report and the truncation preview.
**Acceptance:** 25 pipeline parity tests pass. A full form fixture returns a draft package and a figure work order. `readOnlyHint: true`.
**Owner:** Demitri. **Estimate:** 40h. **Follows:** A6.

**CLOSED 2026-08-04**, at well under the estimate — `count_units` and `truncate_preview` had already landed in `limits.ts` at G2, and the figure work order was already built. Two corrections to the description above:

- It says `render_markdown` emits "human-action flags". It emits **actor-scoped** flags: every outcome names `none`, `llm`, or `staff`, and `llm` outcomes carry a `handback` with the source text, the limit, the measurement, and the guardrail rules. The knowledge base assists the calling model rather than gating it, so shortening an answer and deriving a short value are the model's work, not a person's.
- `handback.ts` landed alongside `pipeline.ts` and is **shared with D3**, which makes that package materially smaller.

The acceptance condition was only half met on close: half 2 passed, half 1 was 20 of 25 cases. That was a gate decision, carried on D2 and **settled 2026-08-04** — the condition is restated as 20 and the 5 resizer cases moved onto D3. Refer to `../CHANGELOG.md` under 2026-08-04.

### D2 — Milestone: G3 passed
**Pass condition:** ~~25~~ **20** pipeline parity tests pass, and a full form fixture returns a draft package. `PROPOSAL.md` section 7 calls this the main benefit.
**Follows:** D1.

**PASSED 2026-08-04.** It was on hold pending a decision rather than work, and the decision went to restating the condition: **20 cases, with the 5 that inject a `ClaudeResizer` moved onto D3**, whose bar became 12 rather than 7. The alternative was holding this milestone until D3 landed. The restatement was chosen because the shortfall was never about D1's deliverable — `grant_build_draft` was complete — and a gate reporting a delivered tool as failed on a condition naming code that `SPEC.md` §2.2 says cannot exist measures the condition rather than the tool. The 5 cases are not dropped; they are the first half of D3's bar, written in `src/resize.test.ts`. Both halves now hold, half 2 proven through the spawned server.

### D3 — Build grant_resize_answer (G4)
No SDK. No network. No client. The tool returns `{ source_text, limit, measurement, instructions }`. The calling Claude rewrites and calls back to re-measure.

What ports: `_SYSTEM_PROMPT` verbatim, including the guardrail against inventing any fact, figure, statistic, name, date, program detail, or outcome. Also the context assembly from `_build_user_prompt`, and the `ResizeResult` shape.

What does not port: `ClaudeResizer`, `make_resizer`, `MAX_ATTEMPTS`, and the retry-with-feedback loop.

`MAX_COMPRESSION_RATIO` is 4. Above that the verdict is `compression_infeasible`. `TAD.md` section 3.6 holds the case.
**Acceptance:** ~~7~~ **12** parity tests pass with no network.
**Owner:** Demitri. **Estimate:** 20h. **Follows:** D2.

**CLOSED 2026-08-04**, well under the estimate, because `handback.ts` already emitted the payload — it landed at D1 shared with this package by design. `packages/grants/src/resize.ts` and `warnings.ts`, plus `apps/mcp-server/src/tools/grant-resize-answer.ts`. **Tool surface 22 → 23**, and no migration was needed: migration `20260729000000` had reserved the `tool_permissions` row.

Three things to know that the description above does not say:

- **The bar is 12, not 7, and both halves of that number were restated.** Half 1 is the 5 cases that moved off D2. Half 2 is `test_resize.py`, and **6 of its 7 cases test the code that does not port** — five `ClaudeResizerTests` and one `MakeResizerTests`. Four port; three have no analogue at all and are recorded per case in `SPEC.md` §1 rather than stubbed. So 9 parity cases, plus 3 figure-fidelity cases the prototype has no counterpart for.
- **One addition beyond the prototype: figure fidelity.** The tool compares the numeric values in a rewrite against its source and rejects one the source does not state, however well the rewrite fits. The prototype re-measures length only, so a rewrite that moved a dollar figure by a digit came back marked `fits` — and rule 1 of the ported guardrail calls that output unusable. Callers branch on `accepted`, not `fits_after_resize`. Measured against the real knowledge base: 29 of 29 slots that state a figure have a tampered digit caught, zero false positives on an identity rewrite or a sentence-level trim.
- **`handback.verify_with` now names this tool.** It named `grant_build_draft` until now because that was the only registered target, and the old wording asked callers to pass a rewritten answer back through a tool with no parameter that accepts one.

### D4 — Port the reframe seam, unconnected
`SPEC.md` section 8 and `TAD.md` decision 7. The prototype has a reframe hook that re-emphasises an answer for a specific funder. Port the seam. Do not wire it. Connecting it now would add an untested Claude call to the path.
**Acceptance:** the seam exists and is unreachable from any registered tool. A test asserts it is not called.
**Owner:** Demitri. **Estimate:** 4h. **Follows:** D3.

**CLOSED 2026-08-06**, well under the estimate for a reason worth recording, because it is the third
package in a row to land short: **there was no prototype implementation to port.** The prototype
marks reframe TODO too — `pipeline.py` threads a `hat` through its `context` dict, and `resize.py`
comments that the real hook is "a separate, richer transform". So the port is the *interface*, and
this module has **no parity fixture and cannot have one**. It is not part of the 45-case accounting
in `SPEC.md` §4. Two corrections to the description above:

- **The guardrail is the substance of the package, not the plumbing.** `REFRAME_RULES` is not
  `RESIZE_RULES` reworded. Resizing asks a model to say less, which fails safe; reframing asks it to
  lean into a theme, which fails by *manufacturing* the theme — invisible to the length check and to
  the figure check both. The no-invention clause is carried verbatim, and two rules are added:
  reframing is reordering and re-weighting rather than adding, and a source that does not support the
  funder's emphasis gets said so and returned unchanged, because that mismatch is a knowledge-base
  finding rather than a writing problem.
- **"A test asserts it is not called" is asserted structurally, not by a spy.** A spy proves only the
  paths a test exercises. `src/reframe.ts` is left off `src/index.ts` — the only door the MCP tools
  have into this package — and does not widen `HandbackTask`, which would put a `reframe` value into
  a module three registered tools import. The test walks `index.ts`, `apps/mcp-server/src/`, and the
  rest of `packages/grants/src/` at run time, so wiring the seam without deleting the test fails the
  suite.

15 cases. Suite 207 → **222 across 14 files**. Tool surface unchanged at 23; an unregistered seam
needs no `tool_permissions` row.

### D5 — Rewrite skill_grant_writing (G5)
`apps/mcp-server/src/prompts/grant-writing.ts`. The skill calls the three new tools first, then verifies every figure through the existing `query_*` tools, then drafts.

Keep the prototype skill's argument names and step structure. It was derived from this platform's boilerplate, so it ports back mechanically.

The skill also carries the drafting craft, absorbed from the Playbook at authoring time rather than read per draft. `TAD.md` section 4.2 states the rule. This half depends on Phase C.
**Acceptance:** a draft produced from the skill alone is judged at least as good as a prototype draft. The judge is Chip or Iman, not the lane.
**Owner:** Demitri and Sean. **Estimate:** 24h. **Follows:** D3 and C5.

### D6 — Milestone: G5 passed, release and pilot
**Pass condition:** staff use the layer on the platform and confirm the result. `PROPOSAL.md` deliverable 6.
**Follows:** D5.

## Phase E — External dependencies and decisions

None of this is Grant Writing work. It is here because the design depends on it, and because an untracked dependency is a dependency that arrives late.

### E1 — Add the two Notion databases to the copy list
`connectors/notion/src/sync-databases.ts` reads `NOTION_SYNC_DATABASE_IDS`, formatted `id:Name, id:Name`. Add two entries and re-run the sync.

- Grant Applications: `e696f630-919c-48ff-998a-993a1ebdada5`
- Research Wiki: `33779abd-443f-8075-8a47-000b973f8eba`

The Grant Writing Playbook is not part of this ask. It is a page and not a database, and `syncDatabases()` posts to `/databases/{id}/query`, which fails on a page id. The Playbook is in this repository instead, which is where `TAD.md` section 4.2 wanted it.

Verify with the query in `SPEC.md` section 7. A semantic search cannot prove absence.
**Acceptance:** both database names appear in the `document_chunks` distinct-source query.
**Owner:** External — needs the owner `PROPOSAL.md` section 8.1 asks for. **Estimate:** 4h.

### E2 — Confirm the ingest captures application rows
`SPEC.md` section 7, follow-up 1. A database view may behave differently from a page. Confirm the ingest captures the application rows and not only the view container.
**Acceptance:** a named application row is retrievable through `search_documents`.
**Owner:** External — Data team. **Estimate:** 3h. **Follows:** E1.

### E3 — Tune min_similarity at the search_documents call site
Observed similarity scores sit near 0.30 to 0.44. The default threshold filtered every realistic grant query to zero results. Without this change, G5 reads as an empty result rather than as a missing page, which is the harder failure to diagnose.
**Acceptance:** a realistic grant query returns the expected passages. The chosen threshold is recorded with the evidence.
**Owner:** Demitri. **Estimate:** 4h. **Follows:** E2.

### E4 — Align Canonical Facts with the figure work order
Assessment 6. One artifact, not two. `src/figures.ts` supplies the 15 checks and the exact queries. HQ supplies the live view. Agree this with Chip before he rebuilds the Notion page.
**Acceptance:** Chip agrees the work order is the source, and the Notion page either links to it or holds the paste-in language generated from it.
**Owner:** Demitri, with Chip. **Estimate:** 4h.

### E5 — Close the three open decisions
`PROPOSAL.md` section 8.

1. Approve the Notion configuration change and name an owner. Configuration, not code.
2. Approve who may use the three grant tools. Recommendation: leadership and administrator. Mandatory, because the platform refuses any tool without a permission record. Decide at the same time whether a background job may run them. The default already refuses, so a "no" changes nothing.
3. Confirm that the question bank and the knowledge base stay in files for now. Recommendation: keep files until the tools pass their test bar, then review.

**Acceptance:** all three are recorded with a date and a decision-maker.
**Owner:** Project manager and VP of Technology. **Estimate:** 2h.

### E6 — Reconcile the timeline with reality
Assessment 8. Replace "six weeks from approval" in `PROPOSAL.md` section 7 with dated milestones, or record the approval date and count from it.
**Acceptance:** every milestone in `PROPOSAL.md` section 7 carries a date that matches the OpenProject board.
**Owner:** Demitri, with the project manager. **Estimate:** 2h. **Follows:** E5.

## Phase F — Operating procedures

From the new operating procedures in the 2026-07-31 notes. These are standing obligations, not deliverables. Where OpenProject supports a recurring work package, make them recurring.

### F1 — Log hours by category in the shared sheet
Log the specific hours for each category in the Google sheet. Temporary, per the note. F4 retires it.
**Owner:** All lane members. **Recurring:** daily.

### F2 — Daily report-out to Slack
Three lines, in addition to the hour log. What you finished today. What you are prioritising tomorrow. Blockers, if any.
**Owner:** All lane members. **Recurring:** daily.

### F3 — Work in the pit
Work in the pit, not wherever you want. A location requirement, not a remote-by-default arrangement.
**Owner:** All lane members. **Recurring:** daily.

### F4 — Migrate hour logging into OpenProject
The 2026-07-31 note marks the sheet as temporary and says logging will move to OpenProject. Do the migration and retire F1.
**Acceptance:** hours are logged against work packages. The sheet is closed.
**Owner:** Project manager. **Estimate:** 4h.

---

# Sequence

Phases A, B, E, and F start together. Phase A blocks Phase D. Phase C blocks D5.

| Week | Dates | Work |
|---|---|---|
| 1 | Aug 03 to Aug 07 | A1. A2. A3. A4. A5. B1. E5. F1 to F3 start. |
| 2 | Aug 10 to Aug 14 | A6 (G1). B2. B5. B6. B7. E1. E6. F4. D1 starts. |
| 3 | Aug 17 to Aug 21 | B3. C1. E2. D1. |
| 4 | Aug 24 to Aug 28 | B4. C2. E3. E4. D1. |
| 5 | Aug 31 to Sep 04 | D1 finishes. D2 (G3). C3. C5. |
| 6 | Sep 07 to Sep 11 | D3. C4. |
| 7 | Sep 14 to Sep 18 | D4. D5. D6 (G5). |

The largest part of the value lands at D2, on 2026-09-01. `PROPOSAL.md` section 7 says the same about G3 being the main benefit. The weeks after it add the length handling, the drafting quality, and the release.

These dates are read back from the board, not typed by hand. OpenProject schedules automatically: it computes each date from the dependencies and skips non-working days. Refer to the section below.

# What is not in this set

- Funder prospecting, eligibility, and fit scoring. `PROPOSAL.md` section 2.2. Another lane.
- Parsing questions out of grant forms. Assigned to the Prospecting team on 2026-07-31.
- Submission to funders. The layer has no send path, by design.
- Moving the question bank into the platform database. Deferred, pending E5, decision 3.
- Grant reporting. Named as a later priority on 2026-07-27.
- The Aug 7 Truist and GSK applications. Not a delivery target for this set.

# The board of record

The set is live in OpenProject at `projects.liftofflearning.tech`, project **Internal AI Integrations** (`internal-ai-integrations`), as work packages **#49 to #88**. It was created through the API v3, not a CSV import.

## The 2026-08-06 reconciliation

The board had drifted two days behind the repository. `bd` had not — it carried D1, D2, D3 and all of Phase A closed since 2026-08-04, so this was a one-way sync into OpenProject, and **`bd` is the tracker to trust when the two disagree** (`../CLAUDE.md` §2 says as much).

What changed:

| Work package | Was | Now |
|---|---|---|
| **D3** (#73) | New | **Closed.** Built 2026-08-04; the 7 → 12 restatement and the figure-fidelity addition are on the journal entry. |
| **D2** (#72) | On hold | **Closed.** G3 passed on the restated 20-case condition. |
| **A3** (#52) | In progress | **Closed** on its local half only. |
| **A7** (#163) | — | **New.** The production migration half, split off #52 because it has no owner and a different access path — RDS is not publicly reachable. |
| **Phase H** (#164) | — | **New**, with H1 (#165) and H2 (#166) closed and H3 (#167) open. |
| **#168, #169** | — | **New.** The lint rollout and the CI lint step, which existed in `bd` (`grant-0sk`, `grant-b5c`) and had never reached the board. |

**Phase H is the Google Drive discovery workstream**, built 2026-08-06 outside this set because the grant layer could not reach LaunchPad's own past applications and the cause turned out to be a platform defect: the `Grants` tree is in a Shared Drive, so every Drive call needs `supportsAllDrives` and `includeItemsFromAllDrives`. It is lettered **H rather than G** because G1 to G5 are the release gates in `SPEC.md` §1 and a Phase G would collide with them in every conversation.

**#168 and #169 are deliberately not children of any phase.** They are platform work with their own owner, and `NEXT-SESSION.md` is explicit that lint debt does not belong inside a grant gate.

Four `bd` issues remain deliberately `bd`-only, because each is a finding rather than a scheduled package: `grant-h32`, `grant-miy`, `grant-l0f`, and the documentation-debt register `grant-sl0`.

Type mapping, because this instance has no Phase type:

| This document | OpenProject type |
|---|---|
| Phase | Summary task (id 3) |
| Task | Task (id 1) |
| Milestone | Milestone (id 2) |

Every work package opens at status **New**. Summary tasks carry no dates or effort of their own; OpenProject derives both from their children.

## The readability pass, 2026-08-03

The first load carried the set across but not its detail. Titles arrived code-prefixed with their punctuation stripped, and each description arrived as one flat paragraph with the acceptance criteria behind an inline `AC:`. Three fields the board offers were left empty.

What changed:

- **Subjects** now read `A1 — Restore a working local environment`. The code stays, because this document and the running notes refer to tasks by it. Phase rows take a `Phase` prefix and milestones an explicit `Milestone:` label, so `A6` reads as a gate to pass rather than as a claim that G1 has passed. The headings in Part 2 above match the board exactly.
- **Descriptions** are structured Markdown: the work, an **Acceptance** list, a **Source** line carrying the citations, and an **Owner** line carrying the full owner string including collaborators. Nothing was invented; the material is Part 2 of this document, plus current state read from `NEXT-SESSION.md` where a task has moved since the set was written.
- **Accountable** is filled from the owner lines. It holds one person, so the collaborator stays in the description body. Eight rows are deliberately blank: the four External rows, `E5`, and the three recurring F items.
- **Category** carries work kind, not phase: `Build`, `Content`, `Decision`, `External`, `Recurring`. Phase and lane genuinely diverge — `B6` is build work inside a content phase, `B7` is a decision inside one, `E3` is build work inside an external phase — so the field earns its place instead of restating the parent. Phases and milestones stay uncategorised. `C5` is filed `Build` because it ships a runnable test set; `F4` is `Build` because it is a one-off migration, not a standing obligation.
- **Version** carries the release gate, tagged only onto the packages a gate's pass condition covers: `G1` on A1 to A6, `G3` on D1 and D2, `G4` on D3, `G5` on D5 and D6. `SPEC.md` section 1 defines G4 as a gate in its own right, so it gets a version even though the set has no G4 milestone. `D4` stays unversioned on purpose: the seam must not read as part of G5.

The hierarchy was not touched. The six phase rows still own their derived dates and their rolled-up work, and all 23 relations survived the pass unchanged.

## Scheduling is automatic, and it owns the dates

OpenProject computes each date from the `follows` relations and skips non-working days. It does not keep a hand-typed date that a dependency contradicts. Every date in this document is therefore read back from the board rather than asserted.

The first load exposed a defect in this document, not in the tool: successors were dated to start on the same day their predecessor finished, which the scheduler correctly refuses. The cascade pushed the release from 2026-09-11 to 2026-09-25.

## The relation audit

All 23 relations were then checked against one question: does the successor genuinely need the predecessor's output? Seven did not.

| Change | Relation | Reason |
|---|---|---|
| Dropped | A2 follows A1 | Installing `@eslint/js` does not need Postgres. |
| Dropped | C1 follows A6 | C1 is a decision. `HANDOFF.md` flag 4 waited on the pipeline, and G2 already closed that. |
| Dropped | D5 follows D4 | D4 is a seam that must stay unwired. Nothing in the skill depends on it. |
| Retargeted | A5 follows A3, not A4 | A5 proves the ACL and the usage log. It needs the permission row, not the admin page. |
| Retargeted | B6 follows A1, not A6 | The matcher review runs vitest. It needs a runnable suite, not a resolved ACL. |
| Retargeted | C5 follows C2, not C4 | The test set grades against the style rules, which C2 settles. It does not need the governance process. |
| Added | A6 follows A4 | The gate covers the admin page as well as the server call. |
| Added | D5 follows D3 and C5 | The skill needs all three tools and the settled craft. |

`C1 → C2 → C3 → C4` stayed as written. Each one is genuinely input to the next, and that chain is what sets the length of Phase C.

Result: the release moved back to **2026-09-16**, and G1 from 2026-08-12 to **2026-08-10**.

## Three things to fix at intake

1. **Iman has no account on this instance.** C3 is the working session she owns, and it is unassigned with her name in the description only. Chip has no account either, and E4 is his agreement to give. Invite them, or those tasks have no owner on the board.
2. **Nine work packages are unassigned**: the five External rows, the three recurring F items, and C3. The External rows are deliberate, because they belong to another team and need the owner `PROPOSAL.md` section 8.1 asks for. Accountable is filled wherever an account exists, which leaves the same set blank for the same reasons.
3. **The categories and the versions need creating by an administrator.** API v3 has no category-create endpoint, and `POST /api/v3/versions` returns `403 MissingPermission` for the lane's key. Both are made under **Project settings**, then assigned by API. Until they exist, the scheme lives in `openproject-import.csv` and in the section above, not on the board.

Confirm the assignees at intake. The owners in this document are lane roles, not a staffing decision.

## The CSV

`openproject-import.csv` is no longer the import path. It is kept as the reviewable record of the set, and it now mirrors the board: a `Work package` column carrying each id, the board's computed dates, and the corrected `Follows` values. Where a work package has two predecessors, the `Follows` cell holds both, separated by a semicolon.

It was regenerated from the board through API v3 in the readability pass, and should be regenerated rather than hand-edited, so that the two cannot drift. Three columns were added — `Category`, `Version`, and `Accountable`. The first two are the record of a scheme the board cannot hold until intake item 3 is done. `Description` now carries the full Markdown body, so those cells are multi-line and quoted.

One column does not come from the board. `Assignee` keeps the intended owner for the six rows that have no account on this instance — `External` on B5, E1, E2, E5, and F4, and `Iman` on C3 — as the previous revision did. The board itself shows those rows unassigned, which is intake items 1 and 2.

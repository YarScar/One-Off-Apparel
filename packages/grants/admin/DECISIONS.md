# Grant Writing Layer — Pending Decisions

| Field | Value |
|---|---|
| Audience | Chip, Iman, the project manager, the VP of Technology |
| Date | 2026-08-10 |
| Purpose | Hold every open decision for the grant lane in one reviewable document, with a recommendation and a place to sign |
| Status | **D1a and D1b shipped 2026-08-10.** D1c, D1d, D2, D3, D4, D5 for review. Nothing else is decided. |
| Sources | `bd` issues `grant-miy`, `grant-k4i`, `grant-jc3.1`, `grant-p6g.6`, `grant-xh5.2`; `TAD.md` section 5; `SPEC.md` section 1; `PROPOSAL.md` section 8 |

This document collects the decisions that stand between the lane and the G5 release gate. Each one
is either a decision a person must make, or a recorded acceptance that the documentation allows.
A decision here is not made until a name and a date sit next to it.

Where a decision says "record it", recording follows the standing rule: a date and a decision-maker,
written in the owning document. `bd` issue `grant-miy` says the same in its acceptance criteria —
*"a recorded decision accepts the manual fill with a date and a decision-maker."*

---

## D1 — The knowledge base mechanism (grant-miy) — owner Sean, reviewer Chip/Iman

### The decision

How the knowledge base answers the 27 non-narrative, non-attachment questions that today route to a
narrative slot — and how the pipeline is made able to return a short value at all.

### Why it exists

`kb_launchpad.json` holds 29 narrative answers and zero short structured values. Every non-narrative
question therefore routes to a narrative slot, and `grant_build_draft` returns the prose as
`reference_only` background rather than as an answer. Measured over the seven form fixtures, roughly
40 percent of a form is filled in by hand. This is the keystone blocker on G5.

### What the code actually shows

Reading `pipeline.ts`, `schemas.ts`, `figures.ts`, and the seed changes the problem's shape in three
ways. All three matter, because the earlier framing drove the wrong count.

1. **The failure is structural, not content.** `buildAnswer` (pipeline.ts:242) returns
   `derive_from_reference` for every non-narrative answer type *before* the limit checks run, and it
   does this regardless of what the slot holds. So repointing `kb_ref` to a shorter slot changes
   nothing. The mechanism has no path from "slot holds a short value" to "answer is that value". No
   amount of KB writing fixes that; a pipeline branch does.

2. **The slots are shared, which the naive fix cannot see.** One KB slot answers many questions.
   `kb.eligibility` answers **8**; `kb.profile.identity` answers **5**; `kb.financials` answers 4 plus
   a narrative. A single `structured: { value }` on an answer object cannot serve `cover.fiscal_sponsor`
   and `eligibility.org_type` and `eligibility.geography` from the same `kb.eligibility` entry — each
   wants a different value. Any structured mechanism must be keyed by question, not by slot.

3. **Most of the 27 values already exist in the seed — as prose.** The KB text states the EIN
   (47-2514219), the address (801 Market Street), the contact, the fiscal-sponsor relationship, the
   geographic area (Philadelphia), the age band (16–24), and the demographic shares. But a straight
   "~19 in prose" count overstates clarity. Split honestly, the 27 are:
   **~14 clearly derivable** (a single value the prose states unambiguously), **3 context-dependent**
   (`cover.legal_name` — Building 21 vs Launchpad, the funder's framing decides; `cover.year_founded`
   — 2013 vs 2023, same split; `cover.authorized_rep` — Dannyelle Austin vs Chip Linehan, per
   opportunity), **3 numbers that drift** (`budget_totals`, `operating_budget`,
   `jobs_and_participants`), and **7 genuinely absent** (UEI/SAM, congressional district, NAICS/vendor,
   indirect rate, minority-owned, debarment, fiscal-year start). The problem is extraction and framing,
   not absence — but the three context-dependent values must not be treated as "extract it and you're
   done": the right value depends on funder framing the pipeline does not hold.

So the decision is mostly *where the short value lives and how the branch finds it* — and the content
ask is far smaller than the issue's "42 of 87" suggests. One further wrinkle: **three of the 27 are
numbers that drift** (`budget_totals`, `operating_budget`, `jobs_and_participants`). `figures.ts`
exists precisely because a frozen KB figure is wrong by design (~$1,500 drift every four days). A
static structured number for those three is the one answer this layer must not give.

### The options, reworked

1. **Structured values keyed by question id on existing answers (recommended).** Each KB entry gains
   `structured: { "<question id>": { "value": ..., "verified": ... } }`. The pipeline, before the
   `NON_NARRATIVE` branch, checks `entry.structured?.[match.matched_id]` and returns the value as a
   real answer (`fits` / `ready`, `actor: none`). This handles the shared slots by construction, leaves
   `questions.json` untouched (no `meta.version` bump, **no matcher-parity regeneration**), and lands
   about 14 clearly-derivable seed values plus one branch plus tests. `kbAnswerSchema` is
   `.passthrough()`, so the loader accepts the new field today; per the schema's own philosophy
   ("anything a drafted answer depends on IS validated"), the field should then be moved into the
   schema proper. **Two companion rules, added after the 2026-08-10 review:**
   - **The integrity checker must catch a dangling structured key.** `computeIntegrityReport`
     (data.ts) validates `kb_entries`↔`answers`, dangling `kb_ref`s, figure-check slots, and
     attachments — but nothing checks that a `structured` key names a real question id. A renamed or
     removed question would silently fall through to `derive_from_reference`. Add a
     `structured_key_dangling` check: every `structured` key across the KB must appear in
     `bank.questions[].id`.
   - **`verified` precedence must be stated.** The entry-level flag is the default; a per-value flag
     overrides it. `kb.profile.identity.verified: true` with
     `structured["cover.fiscal_year"].verified: false` must read as not-grounded for that one value.
     Without the rule, a reviewer cannot tell which flag governs the value that actually ships.
2. **Split the profile slots into per-field structured slots** (`kb.profile.legal_name`,
   `kb.profile.ein_taxstatus`, ...). This matches the seed schema's own declaration that
   "slots prefixed `kb.profile.*` are structured org-profile fields" — the intent was already
   structured, and the seed filled them with narrative. But it changes `kb_ref` on every affected
   question, bumps `meta.version`, and **forces matcher-parity regeneration** against the prototype
   (`scripts/regenerate-matcher-parity.py`). It also does not fix `kb.eligibility`, where 8 questions
   still need 8 distinct values from one slot. Cleaner provenance; real cost for no added ability.
3. **Leave it to `derive_from_reference`.** Correct for the genuinely absent values and for
   `single_select`, where the funder's option list is unknowable at build time and a model must map
   the stored fact to the form's options anyway. Wrong as the mechanism for the ~14 clearly-derivable
   values that are in the seed, because it makes deterministic extraction non-deterministic — which is
   exactly the property the G5 comparator measures.
4. **Accept the manual fill.** Record the acceptance with a date and a decision-maker. Now honest at a
   much smaller scope than the issue assumes: it covers the ~7 absent values, not 40 percent of a form.
   The acceptance criteria's OR-branch is satisfied by recording it.
5. **Route the three number questions to the live connector (new option).** `figures.ts` already names
   the exact `query_*` call for each drifting figure — `annual_budget` → `query_finances {query_type:
   'annual'}` (this said `get_finance_brief` until work package `#275` corrected it on 2026-08-17; that
   tool returns no income or expense total),
   `students_served_total` → `query_enrollment`. The caller runs that call and writes the live number
   into the field; a frozen KB number never ships. This is `derive_from_reference`'s sibling: derive
   from the *live tool*, not from prose. It keeps the no-fetch rule intact (the caller executes the
   query under its own name) and gives G5 a number path that is deterministic in the tool call.

**The composite recommendation is 1 + 3 + 5.** Option 1 is the mechanism for the ~14 clearly-derivable
values the seed already holds, keyed by question. Option 3 remains for the ~7 absent values and for
every `single_select` (the model maps the stored fact to the funder's options). Option 5 covers the 3
numbers, so no frozen figure ships and `figures.ts` earns its keep. Option 2 is parked: it is the
same outcome at the price of a bank-wide `kb_ref` rewrite and a parity regeneration, and it cannot fix
`kb.eligibility` anyway.

### What the recommendation needs

- **D1a — the mechanism.** Option 1: `structured` keyed by question id, a `buildAnswer` branch, a
  `kbAnswerSchema` addition, a `structured_key_dangling` integrity check, and a pinned test on the
  sharp case (`cover.project_title` → `Launchpad` on `aug7_truist`). The lane owns the branch; the
  branch is the load-bearing change. **D1a and D1b must be designed together** — both branches insert
  at the same point (before pipeline.ts:242), and shipping one without the other means rework.
- **D1b — the numbers (interface now settled, shipped as two statuses).** A drifting number question
  returns **`fetch_figure`** (`actor: 'llm'`), carrying the exact `query_*` tool and arguments from
  `FIGURE_CHECKS` on the answer plan — the caller runs it under its own name and writes the live
  number. A **definitional** number question returns **`figure_definitional`** (`actor: 'staff'`),
  still carrying the call, because the number depends on which population the funder means and a
  person confirms that first. Two statuses, not one, so the `STATUS_ACTOR` invariant holds — a caller
  groups by actor without restating the mapping. **Prerequisite, already landed with this review:**
  `students_served_total.appears_in` gained `kb.metrics` in `figures.ts`, because
  `program.jobs_and_participants` routes there and a metrics-only draft otherwise lost the live
  `query_enrollment` call.
- **D1c — the single_select policy.** Option 3: the fact is stored in `structured`, and the model maps
  it to the funder's options. The form fixtures do **not** capture dropdown options, so the mapping is
  a guess from the model's training data — flag that in the skill prompt rather than presenting the
  mapped option as a sourced fact.
- **D1d — the content.** ~14 clearly-derivable values extracted from the prose that already states
  them; the **3 context-dependent values** (`legal_name`, `year_founded`, `authorized_rep`) recorded
  as needing a funder-framing instruction, not auto-filled; ~7 recorded as accept-manual-fill with
  dates and names (UEI/SAM, districts, NAICS/vendor, indirect rate, minority-owned, debarment,
  fiscal-year start). Numbers never written as static values. The h32 bank-typing fixes stay separate
  (they are a `questions.json` change with their own parity obligation).
- **Provenance.** A structured-value answer must carry a distinct footline (e.g. "from structured
  value") so a reviewer can tell it apart from one derived from narrative. This is part of D1a's
  tests, not an afterthought.

### Sign

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| D1a — mechanism | **SHIPPED** 2026-08-10: `structured` keyed by question id; branch in `buildAnswer`; `structured_key_dangling` check; verified-precedence rule. **Corrected 2026-08-11** — see note below. | | | |
| D1b — numbers | **SHIPPED** 2026-08-10: `fetch_figure` (llm) + `figure_definitional` (staff) carrying the `query_*` call; figures.ts gap fixed. **Corrected 2026-08-11** — see note below. | | | |
| D1c — single_select | Option 3: store the fact; model maps it to funder options (flagged as un-sourced) | | | |
| D1d — content | ~14 values extracted from prose; 3 context-dependent recorded; ~7 absent values accepted-manual-fill | | | |

**Two corrections landed 2026-08-11, both found while re-diagnosing board `grant-h32`.** Neither
changes a decision; both change what "shipped" was taken to mean.

**D1b shipped a broken contract, and the full suite was red for a day without anyone seeing it.**
`fetch_figure` set `actor: 'llm'` and carried no `handback`, against a `pipeline.ts` doc comment
saying `handback` is "present exactly when `actor` is `llm`" and an integration test asserting it. A
caller driving off `handback` skipped every figure question. It went unnoticed because this
workstream verifies with `vitest run packages/grants`, and that package has no test reaching
`apps/mcp-server`. The contract is now "every `llm` result carries **exactly one of** `handback` or
`figure_call`". Board `grant-gab`; `../CHANGELOG.md` 2026-08-11.

**D1a's mechanism can report work as done when it is half done.** On a two-part 200-word narrative
question, the structured branch returned a 9-word value and marked it `fits` / `actor: none` — *no
work owed*. That is worse than the `derive_from_reference` it replaced, which at least appeared in
the outstanding-work count: the count went down while the draft got worse. The specific instance was
fixed at bank v0.4.3 (`grant-h32`); **the general shape is now guarded — see D1e.**

---

## D1e — the `needs_expand` guard on D1a's mechanism — decided and shipped 2026-08-11

**Decision: guard it, and route to the calling model rather than to staff.** Taken rather than
deferred because `grant-miy` is about to add roughly fourteen more structured values, and the guard
is cheap before them and expensive after.

**The principle it encodes: fitting is not answering.** D1a asked only whether a stored value was
inside the funder's cap. A value can be well inside a cap and leave the field substantially
unanswered, and the layer had no way to say so.

**Why `llm` and not `staff`.** This layer is an *assist*, not the writer — `PROPOSAL.md` §1 and the
`handback.ts` module note. The material to finish the answer already exists in the KB slot; what is
missing is the writing, and writing is the calling model's job. Sending this to staff would make a
person do work the model can do from sourced material, and would put the layer in the position of
gatekeeping rather than assisting.

**What ships.** `limits.ts::underfillsProseField` is the predicate; `needs_expand` (`actor: llm`) is
the status; the handback carries the confirmed value as `anchor_value` (must survive verbatim) and
the slot prose as `source_text` (material that may be drawn on), under `EXPAND_RULES`. The value is
**not** returned as `answer` — present, it renders as a finished answer, which is the appearance that
let the original defect through.

**The rule that matters most is the one about not padding.** Expansion is the highest-risk task in the
layer: a short fact plus a large empty field is precisely the situation that produces invented grant
content. `EXPAND_RULES` states that the limit is a ceiling and not a target, in those words. A guard
that provoked padding would be strictly worse than the defect it replaced — a reviewer can see an
under-answer; a padded one reads as finished.

**A false positive was found and fixed before this shipped, and it is the reason for the third test.**
The first cut used field size and fill ratio alone. Run across all ten seeded forms, it fired on
Hamilton's "Project/ Program/ Campaign Name" — a 250-character box holding `Launchpad`, the complete
correct answer — and would have told the model to pad a title to 250 characters. The missing test was
`answer_type`. `EXPANDABLE_ANSWER_TYPES` is `narrative` and `demographic` only.

**Open, and deliberately not solved: the no-limit case.** The guard cannot fire when a form states no
limit, because with no cap there is no evidence the field is large and asserting one would be
inventing. Several real forms state no limits at all (`allen_hiles_2024`, `jff_ai_pathways_2026`), so
this is not a corner case. Settling it needs a source of expected answer length that does not exist
today — plausibly a per-question `expected_length` in the bank. Not attempted here.

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| D1e — guard the mechanism | **SHIPPED** 2026-08-11: `needs_expand` (llm) + `underfillsProseField` + `EXPAND_RULES`; no-limit case left open | | | |

---

## D2 — What "at least as good as a prototype draft" means for G5 (grant-k4i) — owner Demitri, judge Chip/Iman

### The decision

Three separable decisions sit inside one sentence of `SPEC.md` section 1: *"A draft produced from the
skill alone is judged at least as good as a prototype draft."*

### Decision 2.1 — where the line falls between the test set and the human judge

`C5` (grant-jc3.5) builds a test set grading against the Playbook rules — sourced entities, sourced
numbers, no em dashes, the jargon blacklist, word limits checked by machine. Anything C5 can grade is
a test, not a judgement. What remains for Chip and Iman is the residue — is the prose better. Undrawn,
the gate double-counts and neither measurement is clean.

**Recommendation.** Draw the line in C5's description: C5 owns every rule that a program can check;
Chip and Iman own only the prose quality that remains. Recorded in `grant-jc3.5`.

### Decision 2.2 — whether the prototype draft is the right comparator

The baseline is `~/Projects/Grants/drafts/aug7-truist-draft.md`: 17 questions, its own header reading
`fits 11 / needs_resize 5 / per_application 1`. Its question 1 asks "What is the name of your solution?"
against a 30-character cap and returns a 1,403-character program description flagged over limit — the
`grant-miy` gap exactly. So on the non-narrative questions the comparison is between two artifacts that
both fail, and on the narrative ones the platform clears the bar trivially. As written, the condition
measures the knowledge base's content gap rather than the skill.

This is the same failure class that forced G3 to be restated 25 to 20 and G4 7 to 12 — a pass condition
naming something the tool is not. It cost a decision each time, taken after the build.

**Recommendation.** Restate the comparator before D5, following the G3 and G4 precedent: judge G5 on the
narrative questions, and judge the structured questions against the bank slots, not against a prototype
that fails them the same way. The restatement is recorded in `SPEC.md` section 1.

### Decision 2.3 — which Playbook the judge judges against

The skill is authored from the Playbook at build time, and `TAD.md` section 4.2 rules that when the two
later disagree, the skill is wrong. But C1 (the write path) and C4 (source of truth and sync direction)
are undecided, and Iman is taking ownership while editing in Notion. Judging against a standard
mid-handover means the standard can move after the draft is written.

**Recommendation.** Hold this decision until C1 and C4 land. It genuinely blocks on Phase C.

### Unverified

Whether Chip or Iman has read either prototype draft. If neither has, the condition asks a judge to
compare against an artifact they have no prior on. Establish this before the session that signs D2.1
and D2.2.

### Sign

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| 2.1 — test/judge line | C5 owns every checkable rule; Chip and Iman own the residue | | | |
| 2.2 — comparator | Restate before D5: narrative vs narrative, structured vs bank slots | | | |
| 2.3 — Playbook | Hold until C1 and C4 land | | | |

---

## D3 — The Playbook write path (grant-jc3.1) — owner Demitri, record in TAD.md section 5

### The decision

`packages/grants/docs/PLAYBOOK.md` opens by having Claude create a record in the Grant Applications
database with status Researching, and closes by updating that record with amount, framing, and the
draft link. That is a write path, against control 6 in `TAD.md` section 2.2 and against
`readOnlyHint: true` on all three grant tools. `HANDOFF.md` flag 4 deferred this until the pipeline
existed; G2 closed that deferral.

### The options

1. **Drop the create and update steps (recommended).** The Playbook becomes read-only, matching the
   tools and the architecture. Claude drafts; a person creates the record and later updates it. No new
   tool, no new permission record, no new audit line. This is the "water the document down" side of the
   deferral's two outcomes, but it is watering the document to match a security control, not to fit a
   preference.
2. **Sanction a write tool.** A new tool with its own permission record, its own audit line, and
   `readOnlyHint: false`, that TAD.md section 2.2 sanctions as a controlled exception. More surface for
   a prototype-stage lane.

**Recommendation.** Option 1. The write tool adds surface, permission, and audit complexity for a lane
whose gate is drafting quality, not record keeping. Record the reasoning in `TAD.md` section 5 and
close `HANDOFF.md` flag 4.

**Carried with it.** Two Playbook rules are stronger than anything in `TAD.md` section 3 — never name an
entity that cannot be traced to a confirmed current source, and ask the fiscal-sponsorship framing every
time. Both are correct. Promote them into `TAD.md` rather than weaken them to match it.

### Sign

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| D3 — write path | Option 1 (drop create/update; record in TAD.md section 5) | | | |

---

## D4 — The four open decisions for the PM and VP (grant-p6g.6, E5)

### The decision

Four decisions sit on the record. Three are in `PROPOSAL.md` section 8. One more is raised in
`TAD.md` section 2.4. Each has a sensible default; "change nothing" is a valid answer to every one.
The acceptance is the same for all: recorded with a date and a decision-maker.

### 4.1 — the Notion configuration change, and its owner

The platform needs a configuration change to reach the drafting guidance and teamspace facts. Approve
it and name an owner.

**Recommendation.** Approve, and name the owner in the same session.

### 4.2 — who may use the three grant tools

Every tool on this platform needs a permission record. Without one, the platform refuses the tool for
every user — the correct behaviour. The recommendation from `TAD.md` section 2.4: **leadership and
administrator**. (Note `skill_grant_writing` already holds leadership, administrator, development, and
finance; the three grant tools are the narrower set.)

**Recommendation.** Approve leadership and administrator. This pins down the roles on A3.

### 4.3 — the data stays in files for now

`PROPOSAL.md` section 8.3 defers moving the question bank and knowledge base into the platform
database.

**Recommendation.** Confirm the files stay for now. Nothing in D1 changes this — structured values are
an addition to the file schema, not a move to the database.

### 4.4 — may a service caller run the grant tools

`TAD.md` section 2.4 raises a fourth decision this issue does not carry: whether a service caller with
a sync secret may invoke the grant tools via `SERVICE_ALLOWED_TOOLS`, a hardcoded set separate from the
`tool_permissions` table. It currently excludes every skill tool.

**Recommendation.** No — change nothing. The default already denies, and the grant lane is a staff
lane, not a machine lane.

### Sign

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| 4.1 — Notion config | Approve, name an owner | | | |
| 4.2 — tool access | leadership and administrator | | | |
| 4.3 — files stay | Confirm | | | |
| 4.4 — service caller | No, default denies | | | |

---

## D5 — The wage figure (grant-xh5.2, B7) — Chip and Iman

### The decision

One sourced figure for the participant wage claim, with the population it counts and the date it was
measured. `PLAYBOOK.md` reconciles $550K stale against $300K current. `TAD.md` section 3.2 documents
$350,268 in a filed narrative against $362,361.82 in live platform data on 2026-07-28. Those are
different reconciliations. `PROPOSAL.md` section 6 rule 3 says two figures counting different things
must never resolve by recency. A reader of the Playbook and a reader of the TAD would file different
numbers.

### The decision to make

Which figure is the sourced truth, what population it counts, and on what date it was measured.
`PLAYBOOK.md` and `TAD.md` section 3.2 are then corrected in the same change.

### Sign

| Decision | Recommendation | Decision | Name | Date |
|---|---|---|---|---|
| D5 — wage figure | One sourced figure + population + date; both documents corrected together | | | |

---

## How the decisions flow

| Decision | Unblocks | Belongs in a session with |
|---|---|---|
| D1a, D1b | D2 (the comparator needs a draft worth showing) | Sean decides; Chip/Iman supply content |
| D2.1, D2.2 | D5 (G5) starts | Chip and Iman judge |
| D3 | C2, C5, then D5's craft half | Lane records; VP aware |
| D4.1–4.4 | E6, A3's roles | PM and VP |
| D5 | B7 closes; documents stop disagreeing | Chip and Iman |

The single highest-value move is one session with Chip and Iman that signs D1b's content list, D2.1,
D2.2, and D5 together. D3 and D4 do not need that session and can be recorded in parallel.

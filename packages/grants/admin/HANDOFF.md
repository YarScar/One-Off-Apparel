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

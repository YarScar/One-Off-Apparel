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

## 2026-08-06

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

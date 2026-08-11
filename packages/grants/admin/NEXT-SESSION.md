# Next session — the database decision

| Field | Value |
|---|---|
| Written | 2026-07-31, end of session |
| Revised | 2026-07-31, following session — items 1 and 2 done |
| Revised | 2026-08-03 — item 3's blockers cleared. Phase A closed and G1 passed. Refer to "What changed on 2026-08-03". |
| Revised | 2026-08-04 — **D1 built and closed.** Refer to "What changed on 2026-08-04". |
| Revised | 2026-08-04, later — **D2 settled and D3 built. G3 and G4 both passed.** Refer to "What changed at D3/G4". |
| Purpose | Carry the plan forward so none of it is re-derived next time. |
| Status | Items 1 and 2 done. **Item 3's blockers are gone**; its remaining question is a decision, not a task. D1 is closed and **two new decisions are open** — the G3 gate count and the knowledge-base content gap. |

The previous revision listed three items. Two are closed. What remains is item 3, which was always a
decision rather than a task. **Everything blocking this workstream is a decision, not a task.** That is
the single most useful thing to know starting a session here.

Of the two decisions D1 opened, **the G3 gate count is settled** (2026-08-04 — restated as 20, the 5
resizer cases moved onto G4, both gates then passed). **The knowledge-base content gap has its
mechanism now and its content remaining** — the pipeline half of `grant-miy` shipped 2026-08-10
(per-question `structured` values plus the `fetch_figure` live-number path, `DECISIONS.md` D1a/D1b);
what remains is Sean's content work — the ~14 values still to extract and the ~7 accepted-manual-fill
decisions.

---

## State now

Checked rather than assumed, at the end of the 2026-08-06 D4 session.

| | |
|---|---|
| `packages/grants` tests | **177 pass**, 222 across the whole repo in about 9 seconds. No database, no network for this package. |
| Release gates | **G1 passed 2026-08-03, locally** — refer to `CHANGELOG.md`. **G2 passed exactly.** **G3 and G4 both passed 2026-08-04**, each on a restated condition (20 cases and 12 cases). **G5 not started.** |
| Tools registered | **3 of 3** — `grant_match_question`, `grant_build_draft`, `grant_resize_answer`, all wired into `make-server.ts`. The reframe seam is deliberately **not** among them. |
| OpenProject board | **Live and current as of 2026-08-06.** D1 (#71), D2 (#72), D3 (#73) and A3 (#52) all closed; #72 and #73 had been stale since 2026-08-04. Seven packages added: A7 (#163, the production migration half split off #52), Phase H (#164) with H1 (#165) and H2 (#166) closed and H3 (#167) open, plus the lint rollout (#168) and the CI lint step (#169). `bd` now mirrors all of it. |
| Committed to git | **Everything.** 19 commits on `writing/dev`; the D3/G4 work is `1f3a2fb`, `19ca6e9`, `715862e`. Working tree clean apart from two files unrelated to this workstream — see "Open the PR". |
| Pushed / PR opened | **Pushed 2026-08-04**, in sync with `origin/writing/dev`, 19 ahead of `origin/master`. **PR not opened.** Refer to "Open the PR" below. |
| Linter | **Runs.** `packages/grants` is clean. Repo-wide baseline measured — 415. |
| `pnpm -r typecheck` | Passes across all fourteen packages. |
| Local database | **Available since 2026-08-03.** Postgres 16.14 via `pnpm db:up`, 13 migrations applied. |

---

## What changed at D3/G4 (2026-08-04, later session)

**D2 is settled, D3 is built, and G3 and G4 have both passed.** All three grant tools are registered
— tool surface 22 → 23, no migration needed, because `20260729000000` had reserved the
`grant_resize_answer` permission row. Suite 183 → **207 across 13 files**. Detail in `../CHANGELOG.md`.

**The G3 gate count went the recommended way: restate as 20, move the 5 onto G4.** G4's bar became 12.
That closed the milestone on evidence that already existed rather than holding a delivered tool open
against a condition naming code `SPEC.md` §2.2 says cannot exist.

**Then the same problem turned up in G4's own bar, and this is the thing to know before reading "G4
passed".** G4's stated bar was "7 resize parity tests pass". Read against `tests/test_resize.py`, **6
of those 7 cases test the code that does not port** — five `ClaudeResizerTests` and one
`MakeResizerTests`. Four port. Three have no analogue anywhere: `MAX_ATTEMPTS` (the loop is the
caller's, so there is no ceiling to give up at), `DEFAULT_MODEL` (no model), and `make_resizer` (no
backends). Those three are recorded per case in `SPEC.md` §1 rather than stubbed. So the 12 is 5 moved
from G3 + 4 portable + 3 figure-fidelity cases the prototype has no counterpart for.

`SPEC.md` §4 now carries a `Portable` column making the same point once across all three test files:
**37 of the prototype's 45 parity cases can be re-expressed, and the 8 that cannot are named.** If a
future gate's bar is quoted from that table, quote the second column.

### The one thing D3 added beyond the port

`resize.ts` checks **figure fidelity**, which the prototype does not. It compares the numeric values in
a rewrite against its source and rejects one the source does not state, however well the rewrite fits.
The prototype re-measures length only and takes the model's word on the rest, so a rewrite that trimmed
forty words and moved a dollar figure by a digit came back marked `fits` — and rule 1 of the guardrail
it ports calls exactly that output unusable. A rule nothing checks is a suggestion.

Two consequences worth carrying forward:

1. **Callers branch on `accepted`, not `fits_after_resize`.** The two differ precisely in the dangerous
   case. The tool description says so; so does `docs/mcp-server-spec.md`.
2. **The extraction pattern is separate from `containsNumericClaim`, and it has to be.** `\b\d{2,}\b`
   does not span a thousands comma, so `8,000` tokenised as `000` and a rewrite moving it to `9,000`
   compared equal. Comma-grouped counts are most of what grant prose states. Measured after the fix:
   29 of 29 slots that state a figure have a tampered digit caught, with no false positive on an
   identity rewrite or on a genuine sentence-level trim. **Known gap:** a magnitude suffix is not part
   of the token, so `$1.34M` normalises to `1.34` and `$1.34B` reads as the same value. Recorded in
   `figures.ts`; the figure work order is what covers it.

### What D3 did NOT do

- **The ACL path is still unproven**, now for two tools rather than one. Both permission rows were
  confirmed by query, so both will resolve. Nothing has driven a bearer-token call through either the
  way G1 did for `grant_match_question`. A green suite says nothing here.
- ~~**D4 (the reframe seam) is not started.**~~ **Done 2026-08-06.** `src/reframe.ts`, 15 cases,
  unwired and asserted unwired. Refer to `../CHANGELOG.md` under 2026-08-06.

---

## What changed on 2026-08-04

**D1 is built and closed (#71). The G3 gate is not passed, and cannot be by writing more code.**

`grant_build_draft` is registered — tool surface 21 → 22 — and needed no migration, because
`20260729000000` had already reserved its permission row. `packages/grants/src/pipeline.ts` and
`handback.ts` landed with it. Suite 131 → **183 across 12 files**. Detail in `../CHANGELOG.md`.

**A scope correction happened mid-build, and it is the thing to understand before touching this code.**
The first cut treated every unfinished question as human work — an over-limit answer and a short field
holding narrative both came back marked for a person, with the text withheld. That inverts the layer's
purpose. The knowledge base exists so the **calling model** does not regenerate answers LaunchPad has
already approved; it assists, it does not gate. Shortening an answer and pulling a value out of prose
are the calling model's job. Only a fact or a decision the layer does not hold needs a person.

So outcomes now name an `actor` — `none`, `llm`, or `staff` — and `llm` outcomes carry a `handback`
with the source text, the limit, the measurement, and the guardrail rules. On `aug7_truist` that moved
the reading from "9 of 17 need a person" to "8 done, 8 the model finishes now, 1 needs staff".

**There is no model client and none is coming.** No SDK, no API key, no network anywhere in this
layer — `TAD.md` §6 decision 6 settled that on 2026-07-29. These are tools inside an MCP server,
invoked *by* Claude; a tool that opened its own client would be solving the wrong problem.

### Two decisions opened by D1

1. **The G3 gate count.** Its first half is "25 pipeline parity tests pass" and the real number is 20.
   The 5 missing cases inject a `ClaudeResizer`, which `SPEC.md` §2.2 says does not port at all, so
   they cannot pass before G4. Either restate G3 as 20 and move the 5 onto G4 — G4's bar becomes 12,
   not 7 — or hold G3 open until G4 lands. On D2 (#72), now **On hold**. Recommend the former.
2. **The knowledge base cannot answer 42 of the 87 bank questions.** Every non-narrative question
   routes to a narrative KB slot; there are zero short structured values in `kb_launchpad.json`. That
   is roughly 40% of a typical form. `bd` issue `grant-miy`, and on Phase B (#56) — it is content work,
   not something the pipeline can fix.

### One thing D1 made cheaper

`handback.ts` is shared with **D3/G4 by design**, so `grant_resize_answer` is now close to a thin
wrapper: accept `{ text, limit, context? }`, measure, return `buildHandback({ task: 'resize', ... })`.
Do not write a second guardrail. Note that `handback.ts`'s `verify_with` names only
`grant_build_draft` today, deliberately — `handback.test.ts` pins that, and the assertion changes when
D3 registers.

---

## What changed on 2026-08-03

This section supersedes the three stale claims below it. They are left in place because the reasoning
around them is still worth reading; the state they describe is not current.

| Was | Now |
|---|---|
| Local database unavailable — no Docker daemon, no `DATABASE_URL` | Both resolved. Postgres 16.14 with `vector 0.8.6` and `pg_trgm 1.6`, 13 migrations applied, `DATABASE_URL` present in `.env` |
| "G1 code complete but unverified" | **G1 passed.** Both halves have evidence — refer to `../CHANGELOG.md` |
| Order of work, item 3 blocked A1 | A1 to A6 are all closed on the board except A3's production half |

**Use `pnpm db:migrate`, not `db:push`.** `db push` writes no migration SQL, so the
`tool_permissions` rows never land and every tool call fails closed. This corrects the setup path
quoted in item 3 below, which names `db:push` from the root `CLAUDE.md`.

**Item 3's remaining question stands unchanged**, and it was always the interesting half: not "local
or remote" but *what data a local database must contain*. The answer looks like "both" — a local
Postgres for the build and the tests, plus read access to real data for the figure checks and for E3's
similarity tuning, which cannot be done against seed data at all. Questions 1, 2, 4, and 5 in "To
bring to the discussion" are still open. Question 3 is now answerable by running the seed.

**Two things the closed items did not cover**, both still open:

1. **A3's production half.** The grant `tool_permissions` rows are unverified on RDS, and the apply has
   no named owner. This is question 4 below, and it is now the only thing standing between the local
   gate and a production one.
2. **The lint rollout package.** A2 closed at 415 problems measured; the rollout package the figure was
   measured for is still not open on the board.

---

## What closed

### Item 1 — the work is committed

Seven commits on `writing/dev`, in the planned order:

| | |
|---|---|
| `14d2088` | `feat(grants)` — the package, seed data, parity fixtures, four admin docs |
| `ef97f34` | `docs(grants)` — assessment and OpenProject work package set |
| `e4ea030` | `feat(mcp)` — register `grant_match_question`, 20 tools → 21 |
| `ced45f8` | `feat(db)` — permission migration plus the HQ `grants` category |
| `e84c073` | `chore` — pin `@sentry/cli` `allowBuilds` to false |
| `8e7e3fb` | `chore` — ignore local `.claude/` |
| `f810f30` | `chore(grants)` — make the linter runnable, get the package clean |

One change from the plan: commit 6 was going to add the two project skills under `.claude/`. The decision was **local, not shared**, so `.claude/` went into `.gitignore` instead. Nothing is left untracked and undecided.

### Item 2 — the linter runs, and the rollout number is known

The three scoped steps are done. `@eslint/js` and `typescript-eslint` are installed at the root, `packages/grants` has a `lint` script, and it reports clean.

Twelve errors were found in `packages/grants` and all twelve are fixed. Two were real bugs of a quiet kind: `questionSchema.variants` is `.default([])` and `variantSchema.source` is required, so `q.variants ?? []` and `v.source ?? 'variant'` were dead branches in the matcher and in two tests. The linter earned its place on its first run. Five string spreads were flagged and deliberately kept — CPython iterates `str` by code point and G2 parity is asserted exactly, so grapheme segmentation would diverge from `difflib`. Those are disabled inline with the reason.

---

## The repo-wide lint baseline

The previous revision said the count was unknown and that nobody should estimate the rollout without it. Here it is.

**415 problems — 343 errors, 72 warnings, across 54 files.**

Measured across `apps/mcp-server`, `apps/aws-mcp-server`, all seven connectors, and `packages/{config,db,embedding}`. `apps/hq` is excluded; it is on `next lint` and needs migrating before it can be measured against this config.

### Read the first number carefully

The first measurement came back at **1,962**. That number is wrong and should not be quoted.

`packages/db` publishes its types from `dist/`, and `dist/` had never been built. Every consumer's `import type { Prisma, StudentEmployment } from '@lp-ai/lib-db'` therefore resolved to nothing, and `strictTypeChecked` reported each downstream property access as `no-unsafe-member-access` — "a type that cannot be resolved." Building `packages/db` dropped the count from 1,962 to 415. **Seventy-nine percent of the apparent debt was one missing build artifact.**

The lesson is procedural, not incidental: any type-aware lint run in this repo is meaningless unless `pnpm db:generate && pnpm --filter @lp-ai/lib-db build` has run first.

`ci.yml` already gets this ordering right — generate, push, `pnpm -r build`, typecheck, test. The gap there is different: **CI never runs lint at all.** Adding a lint step after the build step would report the honest number; adding it anywhere earlier would report the inflated one. Until it is added, nothing enforces the config we just turned on.

### Where the 415 sits

| Package | Count |
|---|---|
| `connectors/google-sheets` | 191 |
| `apps/aws-mcp-server` | 92 |
| `apps/mcp-server` | 92 |
| `connectors/notion` | 24 |
| `connectors/aplos` | 11 |
| `packages/db` | 3 |
| `packages/config` | 2 |
| `packages/embedding` | 0 |

| Rule | Count |
|---|---|
| `restrict-template-expressions` | 132 |
| `no-unnecessary-condition` | 81 |
| `no-console` | 41 |
| `no-non-null-assertion` | 37 |
| `explicit-function-return-type` | 31 |
| `no-unsafe-member-access` / `-assignment` | 37 |
| `no-explicit-any` | 18 |
| everything else | 38 |

### What this says about the rollout

415 is a backlog one person can work through, not a rewrite. It concentrates: `connectors/google-sheets` alone is 46 percent of it, and the top two rules are 51 percent. `no-explicit-any` — the convention root `CLAUDE.md` states most plainly — is violated 18 times in the entire codebase.

That changes the recommendation the previous revision hedged on. **`strictTypeChecked` repo-wide is defensible.** The earlier worry that it would be too much to absorb was a reaction to the inflated 1,962. There is no need to split into `strictTypeChecked` for new packages and `recommended` for legacy.

Suggested shape for the rollout work package: add the twelve missing `lint` scripts, migrate `apps/hq` off `next lint` and measure it, then clear the backlog package by package starting with `connectors/google-sheets`. Still platform work with its own owner. Still does not belong inside a grant gate.

### Board correction, now actionable

A2 (#51) reads "`pnpm lint` completes on `packages/grants` with no configuration error." That is satisfied, and then some — the package is clean, not merely loadable. Close it and open the rollout package with the 415 figure and the build-order caveat attached.

---

## Item 3 — the database

**This is the open discussion.** Unchanged in substance, but one blocker cleared and one detail corrected.

The proposal was to stand up a local Postgres to mimic the real database. Start from this: that is already the designed local workflow and it is documented. Root `CLAUDE.md` specifies `pnpm db:up`, `pnpm db:push`, `pnpm db:seed`, and a local connection string of the form `postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable`. It does not need designing. It needs turning on.

| Blocker | Status |
|---|---|
| Prisma client not generated | **Cleared.** `pnpm db:generate` succeeds with a `DATABASE_URL` supplied inline. Generation never connects, so no live database is needed for it. `packages/db` is also built now. |
| `DATABASE_URL` | Still missing. The previous revision said "empty in `.env`"; it is in fact **absent from `.env` entirely**. |
| Docker daemon | Still not running. `/var/run/docker.sock` does not exist. |

### The question worth discussing

Not "local or remote." It is **what data a local database needs to contain**, because the answer differs by work package:

- **A1, A3, A5, A6, and D1** need only a schema and a permission row. `pnpm db:push && pnpm db:seed` is sufficient. A local Postgres fully unblocks the critical path.
- **The figure checks in `figures.ts`** name exact `query_*` tools and exact arguments. Sample seed data returns sample answers — fine for wiring, useless for judging whether a figure is right.
- **E3, tuning `min_similarity`,** cannot be done locally in any useful way. It needs real Notion content embedded in `document_chunks`, and the observed 0.30 to 0.44 similarity band came from real data. A seeded local database has nothing to tune against.

So the likely answer is **both**: a local Postgres for the build and the tests, and read access to the real data for the figure work and the similarity tuning. Worth confirming rather than assuming.

### To bring to the discussion

1. Where does the real `DATABASE_URL` come from — `docs/runbooks/credentials-checklist.md`, AWS Secrets Manager under `lp-internal/db`, or a person?
2. Is RDS reachable from a developer machine at all? `SPEC.md` section 6 says it is not publicly accessible and that migrations need a one-off ECS task or the bastion. If that holds, local is not a preference, it is the only option.
3. Does `pnpm db:seed` produce enough for the grant path, or does the seed need extending? Nobody has run it against this work.
4. Who can apply the migration to production, given the same access constraint. This is A3's second half and it has no named owner.
5. Should the local database carry a redacted copy of real data? Note the standing rule first: `README.md` rule 6 and `TAD.md` section 2.5 keep customer records, transactions, student personal data, and transcripts out of this repository. A local database is not the repository, but the intent behind the rule should be checked before copying anything.

---

## Open the PR

Not done, deliberately — pushing is outward-facing and was left for a decision.

**Pushed 2026-08-04. `writing/dev` is in sync with `origin/writing/dev` and 19 ahead of `origin/master`. The PR itself is still not opened** — that is the outward-facing step and it is a separate decision.

Opening a PR to `master` runs CI against a pgvector service container, which means the database-gated tests that skip locally will actually execute. That is still the first real signal on the tool code, and it does not depend on item 3 being settled. **What a green check will NOT tell you:** CI builds with `db push`, so the `tool_permissions` rows never land there, and its integration suite runs over stdio, which never sets a caller. The ACL is untouched by it — `ARCHITECTURE.md` §5.2.

**Two files in the working tree are not this workstream's** and were deliberately left out of every commit: a `.gitignore` edit adding `.opencode` (which also drops the trailing newline), and an untracked `EchoesVault/` directory. `EchoesVault/` is neither committed nor ignored, so it will keep showing up in `git status` and is one careless `git add -A` away from being committed. Worth a decision by whoever owns it.

Worth doing before the discussion, not after.

---

## Order of work next session

Rewritten 2026-08-04 after D3/G4. **Nothing on this list is blocked by missing code.** The first three
items are done; what is left is one outward-facing step, two build packages, and three ownership gaps.
Struck-through items record what was done, so the next session does not redo them.

1. ~~**Commit the D3/G4 change set.**~~ Done 2026-08-04 — `1f3a2fb` (the tool), `19ca6e9` (the B6
   bank fix), `715862e` (the documentation).
2. **Open the PR to `master`.** `writing/dev` is pushed and in sync; the PR is not opened, and that is
   the only outward-facing step left. Note what CI can and cannot tell you — refer to "Open the PR".
3. ~~**B6, the matcher quality review.**~~ Run 2026-08-04. Read the finding before trusting the old
   framing: B6 measured misses, and misses are the safe failure. One confident wrong match fixed
   (bank v0.4.1), three recorded on `bd` `grant-h32`, and `grant-miy`'s count corrected 42 → 35. It
   stays open on the stemming decision, which is a `TAD.md` decision and already fully measured.
4. ~~**D4, the reframe seam.**~~ Done 2026-08-06. Two things the package turned up that its
   description did not anticipate: there was **no prototype implementation to port** (the prototype
   marks it TODO too), so the port is the interface and there is no parity fixture; and the reframe
   guardrail is **not** the resize guardrail reworded, because the two tasks fail in opposite
   directions. Unreachability is asserted structurally over the real import graph, not by a spy.
5. **D5 / G5 is BLOCKED, and not on Phase C.** Its pass condition is an open decision — `bd`
   `grant-k4i`, raised 2026-08-06. The pipeline half of the knowledge-bank blocker shipped 2026-08-10
   (`DECISIONS.md` D1a/D1b: per-question `structured` values, `fetch_figure` live numbers) — the 
   content half (`grant-miy`, Sean) still decides how many of the remaining ~14 values land as
   structured entries versus accepted-manual-fill. **Refine the knowledge bank first.**
   `SPEC.md` §1 holds the three decisions inside that one sentence. When it
   does start: the last gate, no parity fixture to check itself against, and do not read its estimate
   as soft the way D1's, D3's and D4's turned out to be — those landed short because earlier gates had
   already built their parts, and G5 has nothing underneath it.
6. ~~**Prove one ACL path end to end.**~~ Done 2026-08-06, on **both** tools rather than one.
   `leadership` succeeded on each, `program_staff` was refused on each, and all four calls reached
   `usage_logs` with the caller email — refusals included. "The row exists" is no longer an inference
   anywhere in this layer. Still local; production is A7 (#163).
7. **Find an owner for A3's production half.** Still the last thing holding G1 to a local claim.
8. **Open the lint rollout package** with the 415 figure and the build-order caveat, and **add the CI
   lint step** (`bd` `grant-b5c`) — nothing enforces the config that is already turned on.

**Phase D is close to done** (#70). D1 and D3 both closed at roughly a quarter of their 40h and 20h
estimates, for the same reason twice: work assumed to be in the package had already landed a gate
earlier. D1 got `count_units`, `truncate_preview`, and the figure work order for free; D3 got
`handback.ts`. **That pattern does not extend to D5** — G5 is drafting-quality work judged by a person,
with nothing already built underneath it.

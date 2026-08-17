# Next session

| Field | Value |
|---|---|
| Written | 2026-07-31, end of session |
| Revised | 2026-08-03, 2026-08-04, 2026-08-04 (later), 2026-08-06 — see the dated sections below |
| Revised | **2026-08-14 — PR #51 is open, and the deploy pipeline does not apply migrations.** Start at "Where this stands, 2026-08-14". |
| Revised | **2026-08-14 (evening) — RDS access solved; prod's real state known.** See "Resolved this evening" inside the 2026-08-14 section. |
| Purpose | Carry the plan forward so none of it is re-derived next time. |
| Status | **Two things before anything else: `#220`, and the `fix/google-drive-discovery` decision in "Resolved this evening".** |

---

## Where this stands, 2026-08-14

Everything below this section is the historical record and is still worth reading for the reasoning.
This section is the current state. Four sessions landed between the 2026-08-06 revision and this one —
the 2026-08-11 pipeline run, the 2026-08-12 live gap re-test, the 2026-08-13 tool-contract chain, and
today.

### Read this first: nothing in the deploy pipeline applies migrations

`.github/workflows/deploy.yml` has a job named `migrate` that all three service deploys gate on. Its
container command is a read-only `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`.
It prints the list and exits 0. **It applies nothing**, despite the job name, the step title
("Run migrations via ECS one-off task") and its own inline comment ("runs each pending migration's
SQL"). Ruled out the alternatives: no `entryPoint`/`command` in the task definition, image `CMD` is
`node dist/serve-http.js`, no `start*` script migrates, `ci.yml` never touches RDS.

The job's one useful output — the applied-migration list — is fetched **only on failure**, so it is
discarded on every successful run. Verified on run `31722645475`.

**Why this outranks everything else here.** It changes what merging PR #51 means. The
`tool_permissions` registry fails closed, so the three `grant_*` tools would deploy and refuse every
caller including admin, with a green deploy and no signal anywhere. Work package **`#220`**, blocking
**`#163`**.

**Check first, because it is a live symptom rather than a pending one:** `skill_grant_sourcing_evaluation`
merged with PR #48 on 2026-08-12 and its permission migration was never applied. It may be in production
right now, registered and unreachable.

**Resolved this evening — prod's true state is now known, from its own database** (fresh local copy,
2026-08-14 evening; procedure in `docs/runbooks/rds-copy-down.md`):

- **Prod is on the June-era schema.** `_prisma_migrations` ends at `20260617000000` (12 recorded
  migrations, including the repo-foreign `20260610200000_create_student_postsecondary`). The
  **only** migrations pending on prod are the repo's `20260729000000_add_grant_tool_permissions`,
  `20260803000000_add_missing_postsecondary_and_aws_jobs_tables`, and — harmlessly re-runnable —
  `20260812000000_add_grant_sourcing_evaluation_permission` (its INSERT is `ON CONFLICT DO NOTHING`).
  So `#220`'s owner job is now exactly "run these two migrations" (`20260729`, `20260803`), no
  exploration left.
- **`skill_grant_sourcing_evaluation`'s permission row IS present in prod** (27 `tool_permissions`
  rows = main's 21 tools + the 6 phantom "future" rows; the grants tools are absent). The row was
  inserted outside the migration machinery — `20260812000000` is not in prod's `_prisma_migrations`
  yet the row exists. Since PR #48's code deployed 2026-08-13, the tool is **registered and
  reachable in prod right now**. One live call still settles it, but the evidence says it is not
  broken.
- **`find_grant_documents` is a roll-back risk, not a missing row.** Prod has no such row (27 rows
  include it nowhere), and no migration in the repo inserts it — because the whole
  `grant_documents` subsystem lives on the **unmerged** `fix/google-drive-discovery` branch (6
  commits, ~4,700 lines: the catalog + the tool + the drive connector rebuild + the `20260806*`
  migrations). It was deployed to prod on 2026-08-06, from that branch, before `main` became the
  only deploy branch. **Merging PR #51 and deploying removes it from prod** (the merged build
  doesn't register the tool, the merged connector doesn't fill the catalog). Decide before merge:
  cherry-pick that branch in, or retire the feature deliberately (and clean the row if it ever
  appears on prod).
- **Prod's 27-row permission set is consistent with main's 21 tools + 6 phantom rows.** The three
  `grant_*` tools will land registered-but-unreachable until `#220` is done — unchanged from the
  paragraph above.

### The state of the branch

| | |
|---|---|
| PR | **#51 open** against `main` — "Grant writing layer and the unmatchable-filter guard". **69 commits ahead, 0 behind** `origin/main` as of 2026-08-17: PR #46 merged in at `d58ecff` (work package `#260`), the lockfile auto-merged, and `pnpm install --frozen-lockfile` confirms no drift. **Not yet pushed** |
| Suite | **501 passing across 24 files, zero skipped.** `packages/grants` alone is 320 in 11 |
| Build / typecheck / lint | `pnpm -r build` clean **including `apps/hq`**, the only package whose build lints. `pnpm -r typecheck` clean across fourteen. `pnpm lint` clean — but it covers only `apps/hq` and `packages/grants`; `pnpm exec eslint apps/mcp-server` still reports errors (`#168`/`#169`) |
| Tool surface | **25** on this branch, 21 on `main` — and **prod is not a subset**: it lacks the three `grant_*` tools and the fifth `skill_*`, and it *has* `find_grant_documents`, deployed from `fix/google-drive-discovery` on 2026-08-06 and merged here only on 2026-08-17 |
| Migrations | **19** applied locally, `migrate status` clean. `migrate diff --from-migrations` shows only the **`student_employment`** entries — down from three tables (`#254`) plus the Drive index rename (`#256`). **A checksum changed:** see the CHANGELOG's 2026-08-17 clone note before running `pnpm db:migrate` on an existing clone |
| Pre-merge review | Code review 2026-08-17, work package `#249`. Seven correctness fixes landed (`#250`–`#255` + `#220`), `fix/google-drive-discovery` merged in (`#256`), then three low findings folded (`#257` clamped `limit` echo, `#258` `pyRound` half-even, `#259` the project skills) and `origin/main` merged in (`#260`). **One blocker left: `#220`'s deploy verification**, which needs a real deploy log. Two low findings deliberately left open: `#261` (a `ZodError` dump reaching the `/aws-jobs/[id]` error banner) and `#262` (the `grant_*` rows narrower than `skill_grant_writing`'s audience — an organisational call, not a code fix) |
| Release gates | G1–G4 passed, all locally. **G5 not started and still blocked** — unchanged |
| Local DB | **Faithful prod copy as of the 2026-08-14 snapshot** — 301 students, 19,128 attendance, 24,623 finance snapshots, 1,062 usage logs — with the branch's 3 migrations applied. Procedure and caveats: `docs/runbooks/rds-copy-down.md`. **Caveat: `pnpm test` wipes it** (`tools.test.ts` runs `seed({ force: true })`, whose `deleteMany`s are unfiltered). |

### What closed since 2026-08-06

- **PRs #49 and #50 merged and deployed 2026-08-13.** Re-tested live on 2026-08-14 rather than assumed:
  `INFORMATION-GAPS.md` §1.1, §1.2, §8.1 and §8.2 are closed with figures. Total Income actuals
  $1,572,906.30, Total Expense actuals $1,734,075.87, per-phase actuals launchpad $1,532,790 / hs
  $459,805 / liftoff $446,220. Work package `#216`, closed.
- **`dev_grants_tracker` answers `eligibility.prior_funding`** — 96 funder records with `lifetime_total`
  and `received_to_date`. That was a `STRUCTURED_VALUE_DEBT` entry.
- **`query_hours` withdrawn** (`#219`, closed). Not grant work; hours live in a separate project now.
  The commit is preserved on the pushed `feat/hours-ingestion` branch. `CLAUDE.md` §4 item 15 has the
  two caveats for re-landing it.
- **Tool count corrected across six files.** It had been wrong in three directions at once. The root
  `CLAUDE.md` now carries the `grep` that settles it.

### Two findings that are staff questions, not tool questions

Both came out of the figure re-source and neither is closable by code:

1. **The KB's `$1.34M FY2025 expenses` matches no live total.** Nearest is Total *Administrative*
   Expenses at $1,394,055.02 — a narrower measure. Whether the KB ever meant total expense needs a
   person.
2. **No finance figure carries a fiscal year.** The `YTD Budget vs Actual` tab returns `period: ""`.
   Board `grant-a54`. **Answered is not filable.** Untested candidates that carry a period in their
   names: `q3_2026_actuals*` and `phase_actuals_2025_*` — probe those before escalating.

### Order of work next session

1. **Verify `#220`'s fix on the first real deploy.** The code is done (2026-08-17): `deploy.yml`'s
   `migrate` job runs `prisma migrate deploy` and dumps the applied-migration list from CloudWatch
   unconditionally. **What cannot be verified from here is the run** — RDS is private, so the proof is a
   deploy whose workflow log lists `20260729000000` and `20260803000000` as applied. Watch that log; do
   not assume a green job means what it used to fail to mean. `#163` closes on the same evidence.
   Two things to expect and not misread:
   - Production's `_prisma_migrations` holds `20260610200000`, which this repo now also holds — restored
     verbatim, checksum verified against the recorded row, so it re-runs as a no-op rather than
     tripping a checksum error.
   - `20260817000000_align_postsecondary_fk_with_schema` will apply too. It swaps one FK's delete
     action; it touches no data.
2. ~~**Decide on `fix/google-drive-discovery`**~~ **DONE 2026-08-17 — merged in, work package `#256`.**
   Decision was: keep the feature. The merge had a shared base at `0998ca3` and produced **five
   conflicts, all in documentation and none in code**; the tool surface is now 25 and the two
   `20260806*` migrations it brought are the ones production already has. One new drift entry came with
   it (a hand-written index name) and is closed by
   `20260817000100_rename_grant_documents_archive_ext_index`. **What is still unverified is the
   production Drive identity** — the service account has no access to that tree, so the catalog sync has
   only ever run under a user identity. That is board H3 (`#167`), unchanged, and it is a credential
   question rather than a merge question.
3. **Check `skill_grant_sourcing_evaluation` in production** — the permission row exists (27 rows
   on prod), so this is now a one-call confirmation rather than an investigation.
4. **Probe `q3_2026_actuals*` / `phase_actuals_2025_*`** for a fiscal-year label. Cheap, and it either
   closes `grant-a54` or proves it needs escalating.
5. **The two staff questions above**, which are Sean's and Chip's, not this lane's.
6. G5 is **still blocked on `grant-k4i`**, which is still blocked on the KB content gap
   (`grant-miy`). Unchanged since 2026-08-06 and not worth re-deriving.

### Still true, still unowned

`#163` needs a named owner. The investigation narrowed it — the owner's job is now "apply
`20260729000000_add_grant_tool_permissions` and `20260803000000_add_missing_postsecondary_and_aws_jobs_tables`
to prod" (the `20260812` one has already taken effect outside the migration table and re-runs as a no-op)
rather than "work out how to reach RDS" — and reaching RDS is now solved and documented
(`docs/runbooks/rds-copy-down.md`). Two errors in that ticket's own text are corrected in its comments:
the migration it says to carry (`20260806000100_add_find_grant_documents_permission`) **does not exist
in the repo**, and no migration in the repo inserts `find_grant_documents` — the row that was in the
local database came from the unmerged `fix/google-drive-discovery` branch, which deployed its
`20260806*` migrations to prod and is now a merge decision (see "Resolved this evening").

**RDS access from this machine is solved** — the previous claim (no `aws` CLI, no credentials) is
obsolete. `.env` carries working keys, and the snapshot-restore-to-temp-instance path in the runbook
is validated end to end. Prod itself stays unreachable (private by design); the runbook goes around
that rather than through it.

---

## State now (2026-08-06 — superseded by "Where this stands, 2026-08-14")

Checked rather than assumed, at the end of the 2026-08-06 D4 session. **The numbers below are that
session's and are no longer current**; the reasoning is why they are kept.

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

**Reversed 2026-08-17, work package `#259`.** "Local, not shared" was the wrong call for the skills specifically: `add-mcp-tool` and `implement-connector` are procedures the root `CLAUDE.md` requires, and blanket-ignoring `.claude/` meant no other clone could ever have them. The ignore is now `.claude/*` with a `!.claude/skills/` exception — four skills tracked, everything machine-local still ignored.

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

## Open the PR — DONE 2026-08-14

**Superseded. PR #51 is open** against `main` (not `master` — `main` became the single deploy branch on
2026-08-13, `e3641f9`/`89c31a2`). The reasoning below is kept because the caveat in it still holds and is
restated in the PR body: CI builds with `db push`, so `tool_permissions` never lands there, and its
integration suite runs over stdio, which never sets a caller. **A green CI still says nothing about the
ACL.** What the section below could not have known is `#220` — the deploy pipeline does not apply
migrations either, so production is in the same position as CI.

Original note follows.

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
2. ~~**Open the PR to `master`.**~~ Done 2026-08-14 — **PR #51**, against `main`. Note what CI can and
   cannot tell you — refer to "Open the PR", and to `#220`, which is the larger version of the same
   problem.
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

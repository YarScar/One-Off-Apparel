# Next session — the database decision

| Field | Value |
|---|---|
| Written | 2026-07-31, end of session |
| Revised | 2026-07-31, following session — items 1 and 2 done |
| Revised | 2026-08-03 — item 3's blockers cleared. Phase A closed and G1 passed. Refer to "What changed on 2026-08-03". |
| Purpose | Carry the plan forward so none of it is re-derived next time. |
| Status | Items 1 and 2 done. **Item 3's blockers are gone**; its remaining question is a decision, not a task. |

The previous revision listed three items. Two are closed. What remains is item 3, which was always a decision rather than a task.

---

## State now

Checked rather than assumed, at the end of the 2026-07-31 follow-up session.

| | |
|---|---|
| `packages/grants` tests | **43 of 43 pass** in about 8 seconds. No database, no network. |
| Release gates | **G1 passed 2026-08-03, locally** — refer to `CHANGELOG.md`. **G2 passed exactly.** G3, G4, G5 not started. |
| Tools registered | 1 of 3 — `grant_match_question`, wired into `make-server.ts`. |
| OpenProject board | **Live.** 40 work packages, #49 to #88, Aug 03 to Sep 16. |
| Committed to git | **All of it.** Seven commits on `writing/dev`. Working tree clean. |
| Pushed / PR opened | **No.** Refer to "Open the PR" below. |
| Linter | **Runs.** `packages/grants` is clean. Repo-wide baseline measured — 415. |
| `pnpm -r typecheck` | Passes across all fourteen packages. |
| Local database | **Available since 2026-08-03.** Postgres 16.14 via `pnpm db:up`, 13 migrations applied. |

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

Seven commits sit unpushed on `writing/dev`. Opening a PR to `master` runs CI against a pgvector service container, which means the database-gated tests that skip locally will actually execute. That is still the first real signal on the tool code, and it does not depend on item 3 being settled.

Worth doing before the discussion, not after.

---

## Order of work next session

Rewritten 2026-08-03. Items 2 and 3 of the previous list are done; item 1 is not.

1. **Push `writing/dev` and open the PR.** Still not done, and still deliberately so — pushing is
   outward-facing. Note what CI can and cannot tell you: it builds with `db push`, so the
   `tool_permissions` rows never land there, and its integration suite runs over stdio, which never
   sets a caller. **A green check says nothing about the ACL.** Refer to `ARCHITECTURE.md` §5.2.
2. **B6, the matcher quality review.** Follows A1, which is closed, so this is unblocked build work —
   the two questions that score below the 0.42 threshold.
3. **Find an owner for A3's production half.** It is the last thing holding G1 to a local claim.
4. **Open the lint rollout package** with the 415 figure and the build-order caveat. A2 is closed; the
   package it pointed at is not open.

**Phase D is now unblocked** — A6 has passed, and D1 follows it. Do not read that as a green light to
start D1 today: it is a 40-hour package, and B6 sharpens the matcher it consumes.

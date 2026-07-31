# Next session — commit the work, make the linter real, decide on the database

| Field | Value |
|---|---|
| Written | 2026-07-31, end of session |
| Purpose | Carry the plan forward so none of it is re-derived next time. |
| Status | Nothing in here is done. All three items are planned only. |

Three items. Item 1 is mechanical and should go first. Item 2 is smaller than it looked and needs a scope cut. Item 3 is a decision, not a task, and it is the one that needs discussion.

---

## State at the end of this session

What is true right now, checked rather than assumed.

| | |
|---|---|
| `packages/grants` tests | **43 of 43 pass** in about 8 seconds. No database, no network. |
| Release gates | G1 code complete but unverified. **G2 passed exactly.** G3, G4, G5 not started. |
| Tools registered | 1 of 3 — `grant_match_question`, wired into `make-server.ts`. |
| OpenProject board | **Live.** 40 work packages, #49 to #88, Aug 03 to Sep 16. |
| Committed to git | **Nothing.** Refer to item 1. |
| Local database | Not available. Refer to item 3. |
| Linter | Configured, never run. Refer to item 2. |

The board and `OPENPROJECT-TASKS.md` are in sync with each other. Neither is in git yet.

---

## Item 1 — Commit the work

**Why this is first.** Every artifact this lane has produced is untracked on branch `writing/dev`. One `git clean -fd` erases the package, the seed data, the parity fixtures, the six documents, and the migration. It also means the 2026-07-31 gut check ("85 hours and we have zero code") is still true from outside the working tree, because nothing is visible to anyone else.

`dist/` is correctly covered by `.gitignore:6`, so no build output is staged. `packages/grants` stages 30 files.

### Six commits, in this order

**1. `feat(grants): add @lp-ai/lib-grants question bank, matcher, and figure work order`**

```
packages/grants/package.json
packages/grants/tsconfig.json
packages/grants/README.md
packages/grants/src/{index,schemas,py,data,limits,figures,seq-ratio,matcher}.ts
packages/grants/src/{data,matcher,seq-ratio}.test.ts
packages/grants/src/__fixtures__/{matcher-parity,seq-ratio-parity}.json
packages/grants/seed/{questions,kb_launchpad}.json
packages/grants/seed/QUESTIONS-SCHEMA.md
packages/grants/seed/forms/*.json
packages/grants/docs/PLAYBOOK.md
packages/grants/admin/{PROPOSAL,TAD,SPEC,HANDOFF}.md
```

The message should record what G2 actually proved, because it is the load-bearing result: 28,690 of 28,690 `difflib` ratios and 337 of 337 matcher results reproduce exactly, asserted with `!==` rather than a tolerance.

**2. `docs(grants): add project assessment and OpenProject work package set`**

```
packages/grants/admin/OPENPROJECT-TASKS.md
packages/grants/admin/openproject-import.csv
packages/grants/admin/NEXT-SESSION.md   ← this file
```

Split from commit 1 so a reviewer can separate the layer from the plan for it.

**3. `feat(mcp): register grant_match_question`**

```
apps/mcp-server/src/tools/grant-match-question.ts   (new)
apps/mcp-server/src/make-server.ts                  (+5 lines: import and register)
apps/mcp-server/src/__tests__/tools.test.ts         (20 tools -> 21)
apps/mcp-server/package.json                        (+ @lp-ai/lib-grants workspace dep)
pnpm-lock.yaml
```

The lockfile belongs here. Its whole diff is 13 insertions and 16 deletions, and `lib-grants` is its only meaningful entry, so it does not need splitting across commits.

**4. `feat(db): add grant tool permissions and the HQ grants category`**

```
packages/db/prisma/migrations/20260729000000_add_grant_tool_permissions/
apps/hq/app/admin/PermissionsMatrix.tsx
```

These belong together: the migration writes a row in a new `grants` category, and the matrix silently drops any category missing from `CATEGORY_ORDER`. Committing one without the other ships a row that cannot be seen or edited.

The code for both is already written. **Applying the migration is separate and is still open** — refer to A3 on the board.

**5. `chore: pin @sentry/cli allowBuilds to false`**

```
pnpm-workspace.yaml
```

Unrelated to the grant work. The diff adds `'@sentry/cli': false` to `allowBuilds` and nothing else. `packages/*` was already in the workspace globs, so `packages/grants` needed no change here. Keep it standalone so it is not buried in a feature commit.

**6. `chore: add add-mcp-tool and implement-connector project skills`**

```
.claude/skills/add-mcp-tool/SKILL.md
.claude/skills/implement-connector/SKILL.md
```

Decide first whether `.claude/` is meant to be shared with the team or stay local. If shared, commit it. If local, add it to `.gitignore` instead. Do not leave it untracked and undecided.

### Then

Open a PR to `master`. CI runs against a pgvector service container, so the database-gated tests that skip locally will actually run there. That is the first real signal on the tool code.

---

## Item 2 — Make the linter real, but cut the scope

**The finding.** We do not have a broken linter. We have a linter that has never run.

`eslint.config.mjs` is a serious config: `js.configs.recommended`, `tseslint.configs.strictTypeChecked`, plus `no-explicit-any: error`, `explicit-function-return-type: warn`, and `no-console: warn`. `eslint ^9` is in root devDependencies.

Two failures sit on top of each other.

1. **The config cannot load.** It imports `@eslint/js` and `typescript-eslint`. Neither is in any `package.json`. The earlier report of "`@eslint/js` is not installed" was half the story.

2. **Fixed, it would still lint almost nothing.** Root `lint` is `pnpm -r lint`, which runs each package's own lint script. One of fourteen packages has one: `apps/hq`, using `next lint`, which is Next's deprecated wrapper and does not use this config. `packages/*`, `connectors/*`, `apps/mcp-server`, and `apps/aws-mcp-server` have never been linted.

**Why it matters.** Root `CLAUDE.md` advertises `pnpm lint` as a daily command and states conventions — no `any`, explicit return types on exported functions, named exports only — that are exactly what this config enforces. Nothing enforces them today. `pnpm -r typecheck` carries the load and checks none of those three. The conventions are aspirational, not verified.

### The scope cut

Do this inside our lane:

1. `pnpm add -Dw @eslint/js typescript-eslint`
2. Add a `lint` script to `packages/grants/package.json` only
3. Get `packages/grants` clean

Open a **separate work package** for the repo-wide rollout: the other 12 lint scripts, migrating `apps/hq` off `next lint`, and the violation backlog. That is platform work with its own owner and its own estimate, like the Notion configuration item. It does not belong inside a grant gate.

### Measure before committing to the rollout

`strictTypeChecked` against a codebase it has never touched will produce a lot, and `no-explicit-any` is an error rather than a warning. **The count is unknown and unmeasured.** Get the number before anyone estimates the work.

Worth deciding at the same time: whether `strictTypeChecked` is the right target repo-wide, or whether `strictTypeChecked` for new packages and `recommended` for the legacy surface is the more honest goal.

### Board correction needed

A2 on the board (#51) says its acceptance criterion is "`pnpm lint` completes on `packages/grants` with no configuration error." That silently assumed a lint script exists there. It does not. Both the description and the AC need updating when this is picked up.

---

## Item 3 — The database: what we need, and what we already have

**This is the open discussion, not a task.** The proposal on the table was to stand up a local Postgres to mimic the real database for staging and testing.

**Start from this: that is already the designed local workflow, and it is documented.** Root `CLAUDE.md` specifies `pnpm db:up` for Postgres plus pgvector via Docker, `pnpm db:push` for the schema, `pnpm db:seed` for sample data, and a local connection string of the form `postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable`. So this does not need designing. It needs turning on.

What is actually blocking, as of this session:

| Blocker | Detail |
|---|---|
| Docker daemon | Not running. `/var/run/docker.sock` does not exist. |
| `DATABASE_URL` | **Empty in `.env`.** The OpenProject variables were filled in; this one was not. |
| Prisma client | Not generated. `packages/db/generated/prisma/` does not exist. |

### The question worth actually discussing

Not "local or remote." It is **what data a local database needs to contain**, because the answer differs by work package:

- **A1, A3, A5, A6, and D1** need only a schema and a permission row. `pnpm db:push && pnpm db:seed` is sufficient. A local Postgres fully unblocks the critical path.
- **The figure checks in `figures.ts`** name exact `query_*` tools and exact arguments. Sample seed data will return sample answers, which is fine for wiring and useless for judging whether a figure is right.
- **E3, tuning `min_similarity`** cannot be done locally in any useful way. It needs the real Notion content embedded in `document_chunks`, and the observed 0.30 to 0.44 similarity band came from real data. A seeded local database has nothing to tune against.

So the likely answer is **both**: a local Postgres for the build and the tests, and read access to the real data for the figure work and the similarity tuning. Worth confirming rather than assuming.

### To bring to the discussion

1. Where does the real `DATABASE_URL` come from — `docs/runbooks/credentials-checklist.md`, AWS Secrets Manager under `lp-internal/db`, or a person?
2. Is RDS reachable from a developer machine at all? `SPEC.md` section 6 says it is not publicly accessible and that migrations need a one-off ECS task or the bastion. If that holds, local is not a preference, it is the only option.
3. Does `pnpm db:seed` produce enough for the grant path, or does the seed need extending? Nobody has run it against this work.
4. Who can apply the migration to production, given the same access constraint. This is A3's second half and it has no named owner.
5. Should the local database carry a redacted copy of real data? Note the standing rule first: `README.md` rule 6 and `TAD.md` section 2.5 keep customer records, transactions, student personal data, and transcripts out of this repository. A local database is not the repository, but the intent behind the rule should be checked before copying anything.

---

## Order of work next session

1. Item 1, commits 1 through 6. Mechanical, unblocks nothing but protects everything.
2. Item 2, the three scoped steps. Then measure the repo-wide violation count and open the rollout work package.
3. Item 3, the discussion. Then A1 becomes a real task rather than a blocked one.

Do not start Phase D. D1 follows A6, and A6 cannot pass until item 3 is settled.

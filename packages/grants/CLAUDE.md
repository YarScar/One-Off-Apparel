# CLAUDE.md — `packages/grants`

Instructions for working inside `packages/grants`, and for any documentation this workstream touches
elsewhere in the repository. The root `CLAUDE.md` owns platform architecture, commands, and coding
conventions; this file owns **how documentation is kept true**. Where the two overlap, the root file
wins on facts about the system and this file wins on documentation process.

**Scope note.** This file and `CHANGELOG.md` beside it were written during the grant-layer work and
moved here on 2026-08-03 to keep the grant workstream visibly separate from repository-wide `docs/`.
They still record platform-wide facts, because the grant work turned those facts up and fixed them.
Where a fact is platform-wide it says so; the authority for it is always the code, per §2 — never
this file.

---

## 1 The rule

**Changing a document means reconciling every other document that change falsifies, not just the
one you opened.** A correction landing in one file while three others keep the old claim is worse
than leaving all four alone, because the fixed one makes the set look maintained.

Concretely, for any change:

1. **Add an entry to `packages/grants/CHANGELOG.md`** — see §5 for what qualifies.
2. **Grep for the claim you just invalidated**, not for the file you happened to edit. Counts,
   command names, table names, tool names, and connector statuses are all repeated across files.
   `grep -rn '<the old claim>' docs/ packages/grants README.md CLAUDE.md` is the whole technique.
3. **Fix every hit**, or record it in §4 as known debt with a reason. Silence is not an option —
   an unfixed inconsistency you knew about must be written down.
4. **Verify against code, never against another document.** §2 says which artifact is authoritative
   for what. If a doc and the code disagree, the code is right and the doc is a bug.
5. **Never fix a doc by changing the code to match it.** If the doc describes better behaviour than
   the code has, that is a code change with its own review, not a documentation task.

### Do not invent

If a fact cannot be verified from code, a command's output, or `git log`, it does not go in. Write
"unverified" and say what would settle it. `CHANGELOG.md` currently carries two such flags — the
production table check and the `student_employment.id` diff — and both are more useful than a
confident guess would have been.

---

## 2 Sources of truth

Documentation is downstream of all of these. When they disagree with a document, the document is
wrong.

| Domain | Authority | Notes |
|---|---|---|
| Database schema | `packages/db/prisma/schema.prisma` | The single source of truth. `docs/database-schema.md` is a derived narrative. |
| Schema history | `packages/db/prisma/migrations/` | What a database is actually *built* from. Can drift from `schema.prisma` — see §3. |
| MCP tool surface | `apps/mcp-server/src/make-server.ts` and `src/tools/*.ts` | Count: `grep -c "NAME = '" apps/mcp-server/src/tools/*.ts`. Asserted by `src/__tests__/tools.test.ts`. |
| Tool reachability | `tool_permissions` table + `apps/mcp-server/src/permissions.ts` | The registry **fails closed**: no row means denied to everyone, including admin. |
| Env var contract | `packages/config/src/schema.ts` | Zod schema. `.env.example` is a template, not the contract. |
| Connector behaviour | `connectors/*/src/` | Status claims in docs go stale fastest; check for a real implementation, not a `sync()` stub. |
| Deploy path | `.github/workflows/deploy.yml`, `infra/ecs/*-taskdef.json` | GitHub Actions builds and ships. No local Docker build. |
| Grant layer scope | `packages/grants/admin/PROPOSAL.md` (scope), `TAD.md` (architecture, security), `SPEC.md` (build detail, release gates) | `TAD.md` wins where it touches `SPEC.md`. `PROPOSAL.md` owns scope and schedule. |
| Task state | `bd` (beads) — `bd ready --json` | The board, not any document, is authoritative for what is next. |

### Documents that own a topic

Do not restate these; link to them. Duplication is how the set drifts.

| Document | Owns |
|---|---|
| Root `CLAUDE.md` | Stack, commands, coding conventions, the sync safety rule, how to add a tool or connector |
| `docs/database-schema.md` | Table-by-table narrative |
| `docs/mcp-server-spec.md` | Per-tool input/output schemas |
| `docs/entity-resolution.md` | Fuzzy name matching across sources |
| `docs/runbooks/local-dev.md` | Getting a clone working |
| `docs/runbooks/credentials-checklist.md` | What each key unlocks and how to get it |
| `docs/setup/*` | Phase-numbered AWS/production build-out |
| `docs/data-sources/*` | Per-connector detail |
| `docs/user-guides/*` | Consumer-facing usage |
| `packages/grants/CHANGELOG.md` | What changed and when |
| `packages/grants/admin/ARCHITECTURE.md` | The platform surface the grant layer builds against, and the toolchain and cadence this workstream runs on |

---

## 3 Where we are — verified 2026-08-06

Re-verify before trusting this section; it is a snapshot, not a contract. Every claim here was
checked by running something.

**Local development works, and the path is `db:migrate`.** Postgres 16.14 with `vector 0.8.6` and
`pg_trgm 1.6` via `pnpm db:up`. 13 migrations applied. The full suite is **275 tests across 14
files, all passing, zero skipped**, including the integration suite that spawns the real MCP server
over stdio. `packages/grants` alone is **230 in 9 files**, with no database and no network. (217 in 9
before the seed audit added four integrity checks on 2026-08-11; 192 in 9
before the `needs_expand` guard landed earlier the same day; 187 in 9
before earlier the same day, when board `grant-h32` split two canonicals at bank v0.4.3; 177 in 9
before 2026-08-10, when D1a/D1b added the structured-value and fetch_figure branches; 207 across
13 before 2026-08-06, when D4 added `reframe.test.ts`; 183 across 12 before G4 added `resize.test.ts`
and three integration cases; 131 across 10 before G3 added `pipeline.test.ts` and `handback.test.ts`;
82 across 8 before 2026-08-03, when the code review added suites for `limits.ts` and `py.ts`, which
had none.)

Use `pnpm db:migrate`, never `db:push`, for local setup. `db push` writes no migration SQL, so the
`tool_permissions` rows never land and every tool call fails closed. This is not a preference — it is
the difference between a working environment and a silently broken one.

**Run `pnpm test`, not the package suite, before claiming green.** A `vitest run packages/grants`
pass says nothing about the tool surface: `packages/grants` has no test that goes through
`apps/mcp-server`, so a library change that breaks a tool's output contract leaves it green. This is
not hypothetical — D1b's `fetch_figure` broke the `actor: llm` ⇒ `handback` invariant, the grants
suite passed 187/187 throughout, and the break sat undetected in the working tree until 2026-08-11.
**And `pnpm test` is itself not enough**: it does not typecheck, so a test file's own local type
declarations can go stale while every case passes. `pnpm -r typecheck` caught exactly that on the
same fix. The pairing is the check; neither half is.

**MCP server: 23 tools registered** — 16 data, `grant_match_question`, `grant_build_draft`,
`grant_resize_answer`, 4 `skill_*`. Every one has a `tool_permissions` row, so nothing currently fails
closed. Of the 29 rows, 6 have no registered tool, all `future` placeholders — the reserved
`grant_resize_answer` row was claimed at G4, so no grant tool is pending a registration any more.

**Connectors** (root `CLAUDE.md` holds the detail): `google-sheets`, `aplos`, and `notion` are live.
`google-drive` and `slack` are skeletons that return `status: "noop"` — Drive has credentials and no
implementation; Slack awaits `SLACK_BOT_TOKEN`.

**Grant writing layer:** **G1, G2, G3 and G4 have all passed. G5 not started.** All three grant tools
are registered. G3 and G4 both passed on **restated conditions**, and the restatement is the same
finding in both cases: 8 of the prototype's 45 parity cases test code `admin/SPEC.md` §2.2 says does not
port at all, so counting them as a bar measured the condition rather than the tool. G3 restated 25 → 20;
G4 restated 7 → 12, absorbing the 5 that left G3. `admin/SPEC.md` §1 and §4 hold the per-case
accounting, and the 3 cases with no analogue anywhere are named there rather than stubbed.

- **G1 half 1 proven** — `packages/grants/src/data.test.ts` passes 39/39. It asserts the seed
  integrity report is empty, so a defect cannot regress silently, *and* exercises each of the eleven
  checks against a corpus that has the defect — an empty report proves the seed is clean only if the
  checker still fires, and until 2026-08-03 nothing tested that. **Read the empty report as narrowly
  as the rest of G1.** Two of the eleven checks are gated by a debt register — `ACKNOWLEDGED_TIES`
  (3 entries) and `STRUCTURED_VALUE_DEBT` (7) — so the report is empty *given ten known defects that
  are recorded rather than fixed*, and those registers are where to look before trusting it. They
  exist because the fixes need either a parity regeneration or an organisational fact this layer must
  not invent; both registers name what would settle each entry.
- **G1 half 2 proven** — "the three tools resolve in the ACL", verified 2026-08-03 through
  `dist/serve-http.js` with real bearer tokens. A `leadership` caller succeeded, a `program_staff`
  caller was refused with `permission_denied`, and both calls landed in `usage_logs` with the caller
  email. See `CHANGELOG.md` under 2026-08-03 for the method and the table.
- **Read "G1 passed" narrowly.** The pass condition is satisfied by three *table rows*, only one of
  which had a registered tool when it passed, so it does not mean three working tools. It means the
  ACL path was proven, on `grant_match_question`. And it is proven **locally only** — nothing is
  verified against RDS; board A7 (#163) is open for that.
- **All three grant tools now have a proven ACL path, verified 2026-08-06.** The G1 method was
  repeated on `grant_build_draft` and `grant_resize_answer`: a `leadership` caller succeeded on both,
  a `program_staff` caller was refused on both with `permission_denied`, and all four calls landed in
  `usage_logs` with the caller email — refusals included. This replaces the inference that stood from
  2026-08-04 to 2026-08-06, which was "the row exists, so the tool will resolve". Method and table in
  `CHANGELOG.md` under 2026-08-06. **Still local only.**
- The ACL branch is unreachable from the test suite. `tool-helpers.ts` only calls `canCallTool()`
  when `currentCaller` is set, and only `serve-http.ts` sets it. **A green test run is not evidence
  about permissions** — not even the integration suite that spawns the real server over stdio.
- Do **not** treat `SPEC.md`'s own "✅ code complete" marking as evidence. That marking is precisely
  what the gate existed to test, and the gate is what settled it.
- **G3 and G4 both passed 2026-08-04**, on restated conditions — 20 cases and 12 cases respectively.
  Read those passes as narrowly as G1's: they say the parity that can be re-expressed is re-expressed
  and the tools behave, not that the ACL was exercised. G5 not started.

**Known schema drift.** `prisma migrate diff` is not empty even on a correctly migrated database:
`id` columns on `student_employment`, `student_postsecondary`, and `aws_resource_jobs` show native
`uuid`/`gen_random_uuid()` against `String @default(uuid())` in `schema.prisma`. Representational
only — Prisma maps Postgres `uuid` to `String`. **Expected. Do not "fix" it**; closing it means
dropping and recreating live primary keys.

**Production is less verified than local.** Two open unknowns, both needing an ECS one-off task or the
bastion because RDS is not publicly reachable: whether the grant `tool_permissions` rows exist there,
and whether `student_postsecondary` / `aws_resource_jobs` exist there.

---

## 4 What needs doing

Documentation debt, known and unowned. Add to this list rather than leaving an inconsistency
unrecorded. Tracked build work lives in `bd` — `bd ready --json` — not here.

| # | Item | Detail |
|---|---|---|
| 1 | **`docs/architecture.md` does not exist** | The root `CLAUDE.md` links it as "Architecture — system overview and data flow" and instructs reading it before modifying any component. The link is dead, so that instruction cannot be followed. Either write it or drop the reference — but a broken pointer in an instruction file is the worst of the three states. **`packages/grants/admin/ARCHITECTURE.md` is not this document** and must not be pointed at from the root as if it were: it is scoped to the grant workstream, and a platform-wide instruction resolving into one package's folder is the confusion it was written to avoid. |
| 2 | **Eight dead links, five missing targets** | Found by the §6 link check on 2026-08-03. Targets: `docs/architecture.md` (from `CLAUDE.md`); `HOW-SKILLS-WORK.md` (from `README.md` and `docs/setup/README.md`); `docs/reference/connector-capability-matrix.md` and `docs/reference/new-developer-playbook.md` (each from both `README.md` and `docs/setup/README.md`); `docs/embedding-pipeline.md` (from `docs/data-sources/google-drive-connector.md`). `docs/reference/` contains only `v0-migrations/`. Each needs a decision: write it, or remove the pointer. Do not leave them dangling. |
| 3 | **`docs/setup/` is unaudited against reality** | 25 phase-numbered files, most last revised 2026-06-24 or earlier, describing AWS build-out. Numbering skips 16, 19, 20. Nothing has confirmed these still match the deployed infrastructure. Treat as historical until audited. |
| 4 | **Connector status claims spread across files** | Live/skeleton status appears in the root `CLAUDE.md`, `docs/data-sources/*`, and `docs/runbooks/local-dev.md`. A connector changing status requires all three. Candidate for collapsing into one owner. |
| 5 | **Grant layer under-documented in `docs/`** | Partly retired 2026-08-04: `docs/mcp-server-spec.md` now carries entries for all three grant tools — `grant_match_question`, `grant_build_draft`, and `grant_resize_answer`. Still missing: any `docs/data-sources/` or user-guide coverage. All other grant documentation lives in `packages/grants/`, aimed at the build rather than at consumers — `admin/ARCHITECTURE.md` included, which orients a developer and does not serve a staff user. |
| 6 | **No doc-drift check in CI** | Every inconsistency in this file was found by hand. The cheap subset is mechanical: dead relative links, and the tool count against `grep -c "NAME = '"`. |
| 7 | **The KB is missing the Lightspeed phase, still** | `kb_launchpad.json` `meta.connector_reconciliation` flagged this and recorded "Confirmed 2026-07-29: no answer in this file mentions Lightspeed." Re-confirmed **2026-08-11: still 0 of 29 slots**. Every drafted program description omits a phase. The connector was queried on 2026-08-11 and the facts are now in the `enrollment_by_phase` note in `src/figures.ts`, so the material to write it exists; what is left is programme copy in Launchpad's voice, which is a staff decision. **The reconciliation prose's own framing — `Foundations → 101 → Lightspeed → LiftOff` — is contradicted by the data** and must not be copied into a draft: Lightspeed is a 7-week summer intensive run twice, not a linear stage. |
| 10 | ~~**`query_enrollment` silently drops filters it does not apply**~~ **Fixed 2026-08-12, PR #50, not yet merged** | Was: the input schema accepts `phase`, `status`, `current_phase`, `enrollment_status`, and `cohort` on every `query_type`, and each branch applied only some — `by_phase` built `studentWhere` and never used it; `by_student` used it but ignored `phase` / `status`. No error and no echo, so a caller who thought they scoped to 15 Lightspeed completers got all 301 students back. Reproduced live on 2026-08-12, then fixed on `fix/query-enrollment-filter-application`. **The defect was wider than this entry recorded**: `active_during` never used `studentWhere` at all *and* ignored `status`, and the four `groupBy` branches ignored `phase` / `status` too — all eight query types dropped something. All five non-date filters now apply to all eight query types, and every response carries `filters_applied` / `filters_ignored`. **Keep this row until PR #50 merges and deploys** — the live tool still misbehaves. |
| 11 | **Finance tab-mapping fix still unmerged** | `fix/mcp-finance-tab-mapping` (PR #49) has sat unmerged since 2026-08-05 while `query_finances` returns `record_count: 0` for 11 of 29 query types on a casing mismatch. Verified 2026-08-12: the branch's map matches `connectors/google-sheets/src/sync-phase-budget-dashboard.ts:108-112` and `sync-development-crm.ts:21-26` exactly, and probing production with the `tab_name` override proves the rows exist. **So the budget figures the grant layer filed as `[DATA UNAVAILABLE]` are answerable, not missing** — see `docs/INFORMATION-GAPS.md` §1 and §9. Until it merges, every finance figure sourced through the mapped query types is suspect. |
| 12 | **Rebuild workspace packages before believing a type error** | Not documentation debt so much as a trap that has now cost time twice. A stale `packages/db/dist/index.d.ts` (dated 2026-08-03, exporting `Prisma` as a type where `src/index.ts:3` exports it as a value) produced 8 × TS1362 in `query-certifications.ts` and 9 integration failures on 2026-08-12 that read exactly like a defect on `master`. It was reported as such and withdrawn after `pnpm --filter @lp-ai/lib-db build`. `master` was never broken. §3's insistence that `pnpm test` and `pnpm -r typecheck` are both needed is right but insufficient — **typecheck reported a stale artifact as a source error**. Add the workspace build to the pairing, or record why not. |
| 8 | **Six KB slots cannot fill the longest ask routed to them** | The KB's own note says answers are "the LONGEST canonical version" and the pipeline resizes *down*. Measured 2026-08-11 against the largest word limit recorded on any question routing to each slot: `kb.staff_bios` 110 words vs 600, `kb.history` 119 vs 500, `kb.target_population` 86 vs 300, `kb.capacity` 129 vs 250, `kb.dei` 122 vs 250, `kb.evaluation` 116 vs 200. The `needs_expand` guard (2026-08-11) makes this visible at draft time rather than silent, but the underlying content is thin and expansion is where invention happens. |
| 9 | **`kb_launchpad.json` snapshot is older than the bank** | `kb.meta.updated` is `2026-07-23`; `questions.json` `meta.updated` is `2026-08-11`. The connector reconciliation prose is dated the same 2026-07-23 and its four staff flags — served count, PCEP denominator, Lightspeed, postsecondary — are all still open. Nothing enforces a maximum age, and a date-based check would be flaky in the suite; this is the record instead. |

---

## 5 Maintaining `CHANGELOG.md`

**Qualifies:** schema changes, migrations, tool surface changes, connector behaviour or status
changes, deploy path changes, env var contract changes, and **corrections to a documented procedure
that was wrong** — that last category is the most valuable and the most often skipped.

**Does not qualify:** formatting, dependency bumps, refactors with no behavioural change, work in
progress. Land the entry with the change, not in advance of it.

**Writing an entry.** Newest first, grouped by date. Say what changed, why, and what it means for
someone who already has a clone. Reference files by path so a reader can verify rather than trust.
Prefer `Added` / `Changed` / `Fixed` / `Removed` / `Verified` as the leading verb. State the blast
radius: "if you have an existing local clone, run X". If something is unverified, say so and say what
would settle it.

---

## 6 Verification commands

How to check the claims in §3 rather than trusting them.

```bash
# Tool count — authoritative
grep -c "NAME = '" apps/mcp-server/src/tools/*.ts | awk -F: '{s+=$2} END {print s}'

# Any registered tool missing a permission row would fail closed for everyone
grep -rh "NAME = '" apps/mcp-server/src/tools/*.ts | sed "s/.*NAME = '//;s/'.*//" | sort -u > /tmp/reg.txt
docker exec lp-internal-postgres psql -U lpapp -d lpinternal -tAc \
  'select tool_name from tool_permissions order by 1;' | sed 's/[[:space:]]*$//' | sort -u > /tmp/perms.txt
comm -23 /tmp/reg.txt /tmp/perms.txt   # empty is correct

# Schema drift: migrations vs schema.prisma (expect only the documented uuid entries)
pnpm exec prisma migrate diff \
  --from-schema packages/db/prisma/schema.prisma \
  --to-config-datasource --config ./prisma.config.ts

# Migration state
pnpm exec prisma migrate status --config ./prisma.config.ts

# Full suite — expect 275 passed, 0 skipped, 14 files.
# Requires: pnpm db:up, pnpm db:migrate, and pnpm --filter @lp-ai/mcp-server build
pnpm test

# Dead relative links across the docs set
grep -rhoE '\]\(([a-zA-Z0-9_./-]+\.md)\)' docs/ packages/grants --include='*.md' README.md CLAUDE.md \
  | sed 's/](//;s/)//' | sort -u

# Is a doc stale? Compare its last touch against the code it describes
git log -1 --format='%ad %s' --date=short -- docs/mcp-server-spec.md
git log -1 --format='%ad %s' --date=short -- apps/mcp-server/src/make-server.ts
```

A caveat on `pnpm -r build`: it currently fails in `apps/hq` on pre-existing
`@typescript-eslint/no-unnecessary-condition` errors, which is tracked lint-rollout work and not a
regression. It blocks `next build`, so verifying anything in HQ needs
`pnpm --filter @lp-ai/hq dev` rather than a production build.

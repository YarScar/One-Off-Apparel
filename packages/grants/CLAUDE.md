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

## 3 Where we are — verified 2026-08-04

Re-verify before trusting this section; it is a snapshot, not a contract. Every claim here was
checked by running something.

**Local development works, and the path is `db:migrate`.** Postgres 16.14 with `vector 0.8.6` and
`pg_trgm 1.6` via `pnpm db:up`. 13 migrations applied. The full suite is **183 tests across 12
files, all passing, zero skipped**, including the integration suite that spawns the real MCP server
over stdio. (131 across 10 before 2026-08-04, when G3 added `pipeline.test.ts`, `handback.test.ts`,
and three `grant_build_draft` integration cases; 82 across 8 before 2026-08-03, when the code review
added suites for `limits.ts` and `py.ts`, which had none.)

Use `pnpm db:migrate`, never `db:push`, for local setup. `db push` writes no migration SQL, so the
`tool_permissions` rows never land and every tool call fails closed. This is not a preference — it is
the difference between a working environment and a silently broken one.

**MCP server: 22 tools registered** — 16 data, `grant_match_question`, `grant_build_draft`, 4
`skill_*`. Every one has a `tool_permissions` row, so nothing currently fails closed. Of the 29 rows,
7 have no registered tool: 6 `future` placeholders and `grant_resize_answer`, reserved for G4.

**Connectors** (root `CLAUDE.md` holds the detail): `google-sheets`, `aplos`, and `notion` are live.
`google-drive` and `slack` are skeletons that return `status: "noop"` — Drive has credentials and no
implementation; Slack awaits `SLACK_BOT_TOKEN`.

**Grant writing layer:** **G1 and G2 have both passed. G3 is built and its gate has not passed.**
`grant_build_draft` is registered and complete; 20 of G3's 25 pipeline parity cases are covered and
the other 5 test a resizer that cannot exist before G4. That shortfall is a gate decision, not
outstanding code — `admin/SPEC.md` §1 holds the table and the two options. G4 and G5 not started.

- **G1 half 1 proven** — `packages/grants/src/data.test.ts` passes 23/23. It asserts the seed
  integrity report is empty, so a defect cannot regress silently, *and* exercises each of the seven
  checks against a corpus that has the defect — an empty report proves the seed is clean only if the
  checker still fires, and until 2026-08-03 nothing tested that.
- **G1 half 2 proven** — "the three tools resolve in the ACL", verified 2026-08-03 through
  `dist/serve-http.js` with real bearer tokens. A `leadership` caller succeeded, a `program_staff`
  caller was refused with `permission_denied`, and both calls landed in `usage_logs` with the caller
  email. See `CHANGELOG.md` under 2026-08-03 for the method and the table.
- **Read "G1 passed" narrowly.** The pass condition is satisfied by three *table rows*, only one of
  which had a registered tool when it passed, so it does not mean three working tools. It means the
  ACL path is proven, on `grant_match_question`. And it is proven **locally only** — nothing is
  verified against RDS; board A3 (#52) is still open for that.
- **`grant_build_draft`'s ACL path is unproven.** Its `tool_permissions` row exists and was confirmed
  by query on 2026-08-04 (`leadership`, `admin`), so it will resolve, but nothing has driven a real
  bearer-token call through it the way G1 did for `grant_match_question`. Repeating that method per
  tool is the only thing that would settle it.
- The ACL branch is unreachable from the test suite. `tool-helpers.ts` only calls `canCallTool()`
  when `currentCaller` is set, and only `serve-http.ts` sets it. **A green test run is not evidence
  about permissions** — not even the integration suite that spawns the real server over stdio.
- Do **not** treat `SPEC.md`'s own "✅ code complete" marking as evidence. That marking is precisely
  what the gate existed to test, and the gate is what settled it.
- **G3 built 2026-08-04, gate not passed** — 20 of 25 parity cases; the other 5 need G4. G4, G5 not started.

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
| 5 | **Grant layer under-documented in `docs/`** | Partly retired 2026-08-04: `docs/mcp-server-spec.md` now carries entries for `grant_match_question` and `grant_build_draft`. Still missing: any `docs/data-sources/` or user-guide coverage. All other grant documentation lives in `packages/grants/`, aimed at the build rather than at consumers — `admin/ARCHITECTURE.md` included, which orients a developer and does not serve a staff user. |
| 6 | **No doc-drift check in CI** | Every inconsistency in this file was found by hand. The cheap subset is mechanical: dead relative links, and the tool count against `grep -c "NAME = '"`. |

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

# Full suite — expect 131 passed, 0 skipped, 10 files.
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

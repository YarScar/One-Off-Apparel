# CLAUDE.md — `packages/grants`

Instructions for working inside `packages/grants`, and for any documentation this workstream touches
elsewhere in the repository. The root `CLAUDE.md` owns platform architecture, commands, and coding
conventions; this file owns **how documentation is kept true**. Where the two overlap, the root file
wins on facts about the system and this file wins on documentation process.

_Context note: this file was slimmed from a ~380-line version to cut per-request cost. The verified
state snapshot, the doc-debt list, and the verification commands now live in
[`docs/STATE.md`](docs/STATE.md) and load only when read._

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
3. **Fix every hit**, or record it in §4 of `docs/STATE.md` as known debt with a reason. Silence is
   not an option — an unfixed inconsistency you knew about must be written down.
4. **Verify against code, never against another document.** §2 says which artifact is authoritative
   for what. If a doc and the code disagree, the code is right and the doc is a bug.
5. **Never fix a doc by changing the code to match it.** If the doc describes better behaviour than
   the code has, that is a code change with its own review, not a documentation task.

### Do not invent

If a fact cannot be verified from code, a command's output, or `git log`, it does not go in. Write
"unverified" and say what would settle it.

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
| `docs/STATE.md` (this package) | Verified state snapshot, doc-debt list, verification commands |
| `packages/grants/admin/ARCHITECTURE.md` | The platform surface the grant layer builds against, and the toolchain and cadence this workstream runs on |

---

## 3 Where we are — current state

This is the one-paragraph version; the full verified snapshot, the doc-debt list (§4), and the
verification commands (§6) are in [`docs/STATE.md`](docs/STATE.md). Re-read that file before trusting
any of the paragraph below — it is a snapshot, not a contract.

- The corpus stores **language only**: live figures are `{{slot}}` fills owned by `query_*` calls;
  `pipeline.ts` refuses to return slotted text as an `answer`. **Zero `high` integrity warnings is
  the guarantee**, and as of 2026-08-21 the report is fully empty — the `medium`
  (`stored_figure_unsourced`) register that used to sit here was retired by removing its five
  unsourced claims from the corpus rather than settling them. See `docs/STATE.md` §3.
- **19 migrations applied** locally via `pnpm db:migrate` — never `db:push` (no migration SQL ⇒
  `tool_permissions` rows never land ⇒ every tool fails closed).
- **Run `pnpm test`, not just the grants suite**, before claiming green — the grants suite cannot see
  MCP tool-surface breaks — *and* pair it with `pnpm -r typecheck` (a green test run misses stale
  types). The pair is the check; neither half is.
- **MCP server: 26 tools registered on this branch** (16 data + `find_grant_documents` + 4 `grant_*`
  + 5 `skill_*`); production is at 21 and is **not** a subset (main lacks the `grant_*` tools but has
  `find_grant_documents`). **Quote the command, not the number.**
- **Every registered tool has a `tool_permissions` row locally**; whether the grant rows exist on RDS
  is still unverified (board A7 / #163) and the registry fails closed. #295's migration pin fix landed
  2026-08-18 but is not yet proven by a deploy — see root `CLAUDE.md`.
- **Grant writing layer:** G1–G4 passed (G3/G4 on restated conditions; read them narrowly — they prove
  parity and tool behaviour, not the ACL), **G5 not started**.
- **Known schema drift is down to `student_employment`** — native uuid vs `String @default(uuid())`,
  `ON DELETE SET NULL` vs `RESTRICT`. **Expected. Do not "fix" it**; a diff growing past that entry is
  real drift. See `docs/STATE.md` §3 for the re-measure commands.

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

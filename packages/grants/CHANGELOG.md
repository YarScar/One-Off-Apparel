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

## 2026-08-03

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

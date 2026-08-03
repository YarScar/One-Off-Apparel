# Grant Writing Layer — Working Architecture

| Field | Value |
|---|---|
| Subject | The platform surface this layer builds against, the tools we work with, and the cadence that keeps the document set true |
| Prepared for | Anyone joining or resuming this workstream |
| Date | 2026-08-03 |
| Status | Current. Every claim was checked by running something; refer to §7 for how to re-check it. |
| Scope | **The grant workstream only.** Not a platform architecture document — refer to §1.2. |
| Companion documents | `TAD.md`, `SPEC.md`, `PROPOSAL.md`, `HANDOFF.md`, `NEXT-SESSION.md`, `../docs/PLAYBOOK.md` |

---

## 1 What this document is for

### 1.1 The gap it fills

The existing set answers *what we are building* and *why it is safe*. None of them answers *what we
are standing on and what we are holding*. That question comes up at the start of every session and
gets re-derived, so it is written down here.

| Document | Answers | Authority over |
|---|---|---|
| `PROPOSAL.md` | What we build, for whom, by when | Scope and schedule |
| `TAD.md` | How it fits, how it stays inside access control, which data rules bind it | Architecture decisions, security, data governance |
| `SPEC.md` | The module-level build steps and the release gates | Build detail, gate conditions |
| `../docs/PLAYBOOK.md` | How a good application is actually written | The drafting craft |
| **This document** | **The platform we build on, the tools we work with, and how work and documents move** | **Nothing the four above own.** It routes. Refer to §6.3. |

Where this document and any of the four disagree, **the other document wins** and this one is a bug.
It holds no decisions of its own.

### 1.2 What it is not

It is **not** the missing `docs/architecture.md`. The root `CLAUDE.md` links that path, the link is
dead, and that debt is recorded in `../CLAUDE.md` §4 item 1. Filling it with this file would put
platform-wide instruction inside one package's folder — the exact confusion the separation exists to
prevent. Everything here is written from the grant layer outward. A reader who wants the platform on
its own terms should read the root `CLAUDE.md`.

---

## 2 The platform surface we build against

Three layers exist. The grant layer adds to two of them and adds nothing to the stack — `TAD.md` §1.1
holds the reasoning. This section says what is actually there, so that a call in the write path can be
traced to a real file.

| Layer | What we depend on | Where it lives |
|---|---|---|
| Data | Postgres 16 with `vector` and `pg_trgm`, through Prisma. The layer reads none of it directly. | `packages/db/prisma/schema.prisma` |
| Tools | An MCP server with 21 registered tools. Our figure work order names `query_*` tools by name and the caller runs them. | `apps/mcp-server/src/make-server.ts`, `src/tools/*.ts` |
| Access | A fail-closed ACL over `tool_permissions`, plus a usage log written by the `runTool` wrapper. | `apps/mcp-server/src/permissions.ts`, `src/tool-helpers.ts` |
| Guidance | Four `skill_*` tools. `skill_grant_writing` is ours to rewrite at G5. | `apps/mcp-server/src/tools/` |
| Ingestion | Seven connectors. Three are live. The Notion one is the copy process our teamspace read depends on. | `connectors/*/src/` |
| Surface | The HQ dashboard, where the usage log and the sync history are visible. | `apps/hq/app/tools`, `app/sync`, `app/admin` |

**Connector reality, checked on 2026-08-03.** `google-sheets`, `aplos`, and `notion` are live.
`google-drive`, `slack`, `bigquery`, and `roam` are skeletons that return `status: "noop"`. Two notes
that matter to anyone reading platform documentation for this:

1. The root `CLAUDE.md` connector table lists five and omits `bigquery` and `roam` entirely, so the
   code has seven and the instruction file describes five.
2. The `bigquery` and `roam` skeletons each point a reader at `docs/data-sources/<name>-connector.md`.
   Neither file exists. These are dead pointers *from code*, which no documentation link check finds.

Neither is grant work. Both are recorded here because we found them and because a teamspace-read
design that leans on the connector set should not lean on an inaccurate description of it.

### 2.1 Dependency direction

```
apps/mcp-server  ──depends on──▶  @lp-ai/lib-grants  ──depends on──▶  zod
                                        │
                                        └── and nothing else. No db client,
                                            no network client, no Anthropic SDK.
```

That single-dependency shape is a deliberate consequence of two decisions — the layer never makes a
data call (`TAD.md` §2.3) and it makes no model call (`TAD.md` decision 6). It is worth protecting: a
new dependency in `packages/grants/package.json` is the cheapest early signal that one of those two
decisions is being walked back.

`apps/mcp-server` depends on `lib-config`, `lib-db`, `lib-embedding`, and `lib-grants`. The direction
is one way. Nothing in `packages/grants` may import from `apps/`.

---

## 3 What is ours, what we borrow, what is not ours to change

The most common way to lose time on this workstream is to start fixing something in the third column.

| Ours | Borrowed unchanged | Not ours |
|---|---|---|
| `packages/grants/src/*` — seven modules | `runTool` — error envelopes and the usage log | The Notion copy list (`TAD.md` §4.3, handed off) |
| `seed/*` — question bank, knowledge base, form fixtures | `permissions.ts` — the fail-closed ACL | The repo-wide lint rollout (`NEXT-SESSION.md`, 415 problems) |
| The three grant tools in `apps/mcp-server/src/tools/` | `search_documents` — the teamspace read path | Production database access (RDS is not publicly reachable) |
| `skill_grant_writing`, at G5 | The `query_*` tools our figure work order names | The CI workflow, though §5.2 is a finding against it |
| The grant `tool_permissions` migration | `SERVICE_ALLOWED_TOOLS`, which already denies by default | The `docs/` set, except where our work falsifies a claim in it |

Borrowing unchanged is the point. Registering through `runTool` means the audit trail and the error
shape arrive at no cost, and it is why `TAD.md` §2.2 can list controls 1 and 2 as already satisfied.

---

## 4 The tools we work with

### 4.1 Platform tools the layer consumes

The layer never calls a tool. It names one. `grant_build_draft` returns a work order of 15 checks,
each naming a `query_*` tool and its exact arguments, and the caller executes them under its own
identity. The security reason is `TAD.md` §2.3 and it is load-bearing — do not shortcut it. Teamspace
material arrives through `search_documents` scoped to the Notion source, per `TAD.md` §4.1.

The exact tool names and arguments live in `packages/grants/src/figures.ts`. That file is the contract
between this layer and the platform tool surface, so a rename on either side breaks it silently — the
work order is data, not a typed call.

### 4.2 Development toolchain

| Concern | Tool | What to know here |
|---|---|---|
| Package management | pnpm workspaces, Node 22 | `@lp-ai/lib-grants` is a workspace member, so it takes part in `pnpm -r build` and `-r typecheck`. |
| Language | TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | `TAD.md` §1.3. No `any`, named exports only, explicit return types on exports. |
| Validation | zod | Every seed file has a schema in `src/schemas.ts`. The loader reports integrity at load time, lazily and memoised (`TAD.md` decision 4). |
| Tests | vitest | 79 tests in this package. No network, no database, no mocking — a property of decision 6, not an accident. Keep it. |
| Lint | eslint + typescript-eslint `strictTypeChecked` | `packages/grants` is clean. **Any type-aware lint run needs `pnpm db:generate && pnpm --filter @lp-ai/lib-db build` first**, or the number is meaningless — `NEXT-SESSION.md` explains the 1,962-to-415 correction. |
| Database | Prisma 7, Postgres in Docker | Use `pnpm db:migrate`. **Never `db:push`** — refer to §5.2. |
| CI | GitHub Actions, pgvector service container | Runs on pull request. Refer to §5.2 before treating it as proof. |
| Deploy | `deploy.yml` via OIDC; no local Docker build | Not reached yet by this workstream. |
| Task state | `bd` for ready work; OpenProject for the plan | `bd ready --json`. The board holds 40 work packages, #49 to #88. `OPENPROJECT-TASKS.md` maps them. |

### 4.3 Commands that matter here

The root `CLAUDE.md` owns the full list. These are the ones this workstream runs.

```bash
pnpm exec vitest run packages/grants        # the package's own suite — no db, no network
pnpm --filter @lp-ai/lib-grants typecheck   # strict-mode check, this package only
pnpm --filter @lp-ai/lib-grants lint        # clean today; keep it that way

pnpm db:up && pnpm db:migrate               # local schema, including the tool_permissions rows
pnpm --filter @lp-ai/mcp-server build       # prerequisite for `pnpm test`, not optional
pnpm test                                   # full suite: 131 tests, 10 files
```

---

## 5 The state we build on

### 5.1 Verified, 2026-08-03

`../CLAUDE.md` §3 is the owner of this snapshot and holds the detail. The short form, and the
corrections that matter to a reader coming from an older document in this folder:

| Claim | State |
|---|---|
| Local development | **Works.** Postgres 16.14, `vector 0.8.6`, `pg_trgm 1.6`, 13 migrations applied. |
| Full suite | 131 tests across 10 files, all passing, zero skipped — including the suite that spawns the real MCP server over stdio. |
| Tool surface | 21 registered. Every one has a `tool_permissions` row, so nothing fails closed today. |
| This package | 92 tests, 7 modules, `grant_match_question` registered — 1 tool of 3. |
| Gates | **G1 passed 2026-08-03, locally.** **G2 passed exactly.** G3, G4, G5 not started. |

**`NEXT-SESSION.md` is stale on one point.** It records the local database as unavailable and item 3
as the open discussion. The local environment now works and the path is `pnpm db:migrate`. Item 3's
real question — what data a local database must *contain*, and that the similarity tuning in E3 needs
real embedded content that a seed cannot supply — is unchanged and still open.

### 5.2 CI is still not proof of the ACL half of G1, even though that half now has proof

`ci.yml` builds its schema with `pnpm --filter @lp-ai/lib-db push` (line 55). `db push` writes no
migration SQL, so **the `tool_permissions` rows never land in CI** — the same defect the local runbook
carried until 2026-08-03. The registry fails closed, so a permission-checked call has no row to find.

The consequence is specific: `NEXT-SESSION.md` offers CI as "the first real signal on the tool code".
It is a real signal on the build, the types, and the database-gated tests. It is **not** evidence for
G1's second half — "the three tools resolve in the ACL" — and it cannot become that until CI migrates
instead of pushing.

**G1's ACL half was proven on 2026-08-03, and not by CI.** It took a running `serve-http.js` and a
real bearer token, by hand. Refer to `../CHANGELOG.md` under that date. So the gate is closed, and
this section stays, because the underlying gap is unchanged and is now the more dangerous of the two:

- `db push` in CI still means the `tool_permissions` rows never land there, so a permission-checked
  call in CI has no row to find.
- More fundamentally, **no test in this repository can reach the ACL branch at all.**
  `tool-helpers.ts` calls `canCallTool()` only when `currentCaller` is set, and only `serve-http.ts`
  sets it. The integration suite spawns the real server over **stdio**, which never sets a caller.
  Fixing the `db push` line would therefore not be sufficient; a test would also have to drive the
  HTTP transport with a signed token.

The practical rule is unchanged and now applies to regressions rather than to the gate: a green check
says nothing about permissions. If the ACL breaks, this suite will pass.

This is platform work with the same shape as the runbook fix, and it is not a grant gate.

---

## 6 How work moves

### 6.1 Cadence

Gates, not sprints. `SPEC.md` §5 owns the gate conditions; G3 is next. A gate passes on evidence that
can be re-run, which is why G2's bar became a pair of generated parity fixtures rather than
hand-written expectations. Treat "code complete" as a claim awaiting a gate, never as a pass —
`../CLAUDE.md` §3 says this about `SPEC.md`'s own markings.

### 6.2 Branch and review

Work sits on `writing/dev`. Pushing and opening the PR is outward-facing and was deliberately left as
a decision (`NEXT-SESSION.md`). Read §5.2 before assuming what CI will prove.

### 6.3 Where a new fact goes

Keeping pace is mostly a routing problem. When a session turns something up:

| What you learned | Where it goes |
|---|---|
| A design or security decision, or its reversal | `TAD.md` §5, with a rationale and a revisit condition |
| A change to what we build or when | `PROPOSAL.md` |
| A build step, a module detail, a gate condition | `SPEC.md` |
| Something the VP should flag | `HANDOFF.md` |
| What to pick up next, and why it is blocked | `NEXT-SESSION.md` |
| Drafting craft | `../docs/PLAYBOOK.md` |
| A platform fact, a toolchain fact, or a stale claim in another document | Here, plus `../CHANGELOG.md` if it qualifies |
| Anything that falsifies a claim elsewhere | Fix every hit, or record it as debt — `../CLAUDE.md` §1 |

The document duty is not optional and it is cheap only if it happens in the same session as the
change. One corrected file beside three stale ones is worse than four stale ones, because the fixed
one makes the set look maintained.

---

## 7 Re-checking this document

`../CLAUDE.md` §6 holds the full verification set. The three that keep this file honest:

```bash
# Tool count, authoritative
grep -c "NAME = '" apps/mcp-server/src/tools/*.ts | awk -F: '{s+=$2} END {print s}'

# This layer's dependency shape — expect zod and nothing else
grep -A4 '"dependencies"' packages/grants/package.json

# Does CI still push instead of migrate? (§5.2)
grep -n 'lib-db push\|lib-db migrate' .github/workflows/ci.yml
```

---

## 8 Open items this workstream is carrying

Each of these is recorded elsewhere in full. This is the list, so that none of them is rediscovered.

| # | Item | Owner | Recorded in |
|---|---|---|---|
| 1 | Two Notion sources not reaching the platform; a third, the Research Wiki, appears in no review document | Platform, unnamed | `TAD.md` §4.3 |
| 2 | No test can reach the ACL branch — G1's ACL half was proven by hand, and CI cannot re-prove it | Platform, unnamed | §5.2, `../CLAUDE.md` §3 |
| 2b | Grant `tool_permissions` rows unverified on RDS, and the production apply has no owner | Unowned | Board A3 (#52), `../CHANGELOG.md` 2026-08-03 |
| 3 | What a local database must contain; E3 similarity tuning needs real embedded content | Open decision | `NEXT-SESSION.md` item 3 |
| 4 | The Playbook asks for a Notion write path and carries a wage reconciliation that conflicts with `TAD.md` §3.2 | Deliberately deferred until a draft package exists | `HANDOFF.md` flag 4 |
| 5 | Repo-wide lint rollout, 415 problems, with the build-order caveat | Platform, unnamed | `NEXT-SESSION.md` |
| 6 | No `grant_match_question` entry in `docs/mcp-server-spec.md`; no consumer-facing grant documentation | This workstream | `../CLAUDE.md` §4 item 5 |
| 7 | Knowledge base has no answer mentioning Lightspeed | Data team | `HANDOFF.md` flag 2 |

---

## 9 References

| Item | Contents |
|---|---|
| `../README.md` | The package index and the six rules that cannot be broken |
| `../CLAUDE.md` | Documentation discipline, sources of truth, and the verified state snapshot |
| `../CHANGELOG.md` | What this workstream changed, and when |
| `PROPOSAL.md`, `TAD.md`, `SPEC.md`, `HANDOFF.md`, `NEXT-SESSION.md`, `OPENPROJECT-TASKS.md` | The review set — refer to §1.1 |
| `../docs/PLAYBOOK.md` | The drafting craft; the source G5 authors the skill from |
| `../src/figures.ts` | The figure work order: the contract with the platform tool surface |
| Root `CLAUDE.md` | Platform architecture, the full command list, and the coding conventions |
| `.github/workflows/ci.yml` | The CI job. Refer to §5.2. |

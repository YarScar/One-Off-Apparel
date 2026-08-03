# Grant Writing Layer — Implementation Spec

| Field | Value |
|---|---|
| Audience | The developer who does the build |
| Date | 2026-07-28, revised 2026-07-29 |
| Status | **G1 and G2 complete.** Seven modules, 79 tests, one tool registered (`grant_match_question`). G3 not started. |
| Companion documents | `PROPOSAL.md` (scope), `TAD.md` (architecture, security, governance) |

**What this document is.** The build detail and the release gates. It maps each prototype module to its target tool, names the functions to port, and holds the parity test tables.

**What this document is not.** It does not restate the architecture, the security controls, or the data rules — `TAD.md` owns those, and it is the authority where the two touch. It does not restate the scope or the schedule; `PROPOSAL.md` owns those.

**Where the code goes.** The package is `packages/grants` (`@lp-ai/lib-grants`), a pnpm workspace member. Deterministic logic lives in `packages/grants/src/`. The MCP tools that wrap it land in `apps/mcp-server/src/tools/`, because that app owns tool registration and the `runTool` wrapper.

---

## Preface
* Changed lanaugage (XX/X/XXXX)

## 1 Release gates

Five gates. Do not start a gate until the one before it passes. Each maps to a deliverable in `PROPOSAL.md` section 3 and a week in section 7.

| Gate | Work | Passes when | State |
|---|---|---|---|
| **G1** | Preparation. Clear the two seed integrity warnings. Land the three `ToolPermission` migrations. | The loader reports zero warnings. The three tools resolve in the ACL. | ✅ **passed 2026-08-03**, locally. Refer to the note below |
| **G2** | `grant_match_question`. | 13 matcher parity tests pass. **Sequence-ratio parity is proven.** Refer to section 5. | ✅ **passed exactly** |
| **G3** | `grant_build_draft`, resize off. | 25 pipeline parity tests pass. A full form fixture returns a draft package and a figure work order. | not started |
| **G4** | `grant_resize_answer`. | 7 resize parity tests pass, with no network. | not started |
| **G5** | Rewrite `skill_grant_writing`. Author in the Playbook craft. Release and pilot. | A draft produced from the skill alone is judged at least as good as a prototype draft. | not started |

**G2 is the risk gate.** Stop there and check the result before building anything above it. Refer to section 5.3.

**How G1 passed, and what it does not say.** Both halves have evidence as of 2026-08-03. The loader
reports zero warnings, asserted by `packages/grants/src/data.test.ts`. The ACL half was proven by
driving a real call through `dist/serve-http.js` with a bearer token: a `leadership` caller
succeeded, a `program_staff` caller was refused, and both appeared in `usage_logs`. The method is in
`../CHANGELOG.md` under 2026-08-03.

Two limits on the claim, neither of which the pass condition covers. **The evidence is local** —
nothing here is verified against RDS, and that half of the migration work is still open and unowned.
**And the condition is satisfied by three table rows, only one of which has a registered tool**, so
G1 passing means the ACL path works on `grant_match_question`; `grant_build_draft` and
`grant_resize_answer` are reserved rows awaiting G3 and G4.

Two changes to G1 as originally written:

1. **The Notion configuration fix left G1.** It is another team's work and cannot gate ours. Refer to section 7.
2. **The Playbook requirement left G1.** It was "the document search returns Playbook passages"; the Playbook is now in the repository at `docs/PLAYBOOK.md`, which is the version-controlled home `TAD.md` section 4.2 argues for. Nothing needs to reach the vector store for G5 to read it.

---

## 2 What moves

### 2.1 Seed data — moved as-is, file-based

Landed under `packages/grants/seed/`. Counts verified 2026-07-27, and the wording count re-verified
2026-08-03 at bank v0.3.1, which added one FFTC wording under B6. Changing the bank obliges a
regeneration of `src/__fixtures__/matcher-parity.json` — refer to `../CHANGELOG.md` under 2026-08-03.

| File | Contents | Count |
|---|---|---|
| `questions.json` | Canonical questions | 82 |
| `questions.json` | Categories | 11 |
| `questions.json` | Declared KB slots | 29 |
| `questions.json` | Recorded funder wordings (variants) | 212 |
| `kb_launchpad.json` | Stored answers (4 are `verified:false`) | 29 |
| `forms/*.json` | Incoming form fixtures | 7 |

| Fixture | Questions | Questions with a stated limit |
|---|---|---|
| `aug7_truist` | 17 | 17 |
| `aug7_gsk` | 15 | 0 |
| `sample_philly_innovation` | 21 | 8 |
| `sample_incoming` | 16 | 5 |
| `jevs_c2l_2024` | 16 | 2 |
| `wpf_workforce_2026` | 12 | 3 |
| `hamilton_loi_2025` | 9 | 6 |

The seed holds no funder corpus and no organization profile. `funders.json` and `org_profile.json` belong to the prospecting scope and are not in this package.

### 2.2 Logic — re-expressed Python to TypeScript, not copied

Each module becomes one deterministic MCP tool following the platform convention: a zod input schema, the `runTool` wrapper, a snake_case tool `NAME`, and a kebab-case file. All logic is pure and deterministic except the resize step.

| Prototype module | Key surface | Target tool |
|---|---|---|
| `pipeline/matcher.py` | `normalize`, `_weighted_jaccard`, `_seq_ratio`, `match_question`, `match_form` | `grant_match_question` (`tools/grant-match-question.ts`) |
| `pipeline/pipeline.py` | `count_units`, `truncate_preview`, `build_answer`, `run`, `render_markdown` | `grant_build_draft` (`tools/grant-build-draft.ts`) |
| `pipeline/resize.py` | `ResizeResult`, `ClaudeResizer`, `make_resizer` | `grant_resize_answer` (`tools/grant-resize-answer.ts`) |

Notes per tool:

- **`grant_match_question`** — pure. Weighted token overlap, plus a `difflib`-equivalent sequence ratio, plus a threshold. Refer to section 5 before writing any of it.
- **`grant_build_draft`** — the write path: form → match → KB retrieve → limit check → (resize) → Markdown. `render_markdown` emits question → answer → provenance footline → human-action flags. It returns the figure work order and **never makes a connector call**; `TAD.md` section 2.3 states why.
- **`grant_resize_answer`** — **no SDK, no network, no client.** An earlier revision of this section said to reuse the platform Anthropic client. There is no platform Anthropic client — `@anthropic-ai/sdk` appears nowhere in the repository and `ANTHROPIC_API_KEY` is declared in `packages/config/src/schema.ts` but never read. More to the point, building one would be solving the wrong problem: the prototype needs `ClaudeResizer` because a Python CLI has no model in the loop, but an MCP tool is invoked *by* Claude. So the tool returns `{ source_text, limit, measurement, instructions }`, the calling Claude rewrites, and it calls back to re-measure.

  What ports: `_SYSTEM_PROMPT` verbatim — the "never invent, add, infer, or embellish any fact, figure, statistic, name, date, program detail, or outcome" guardrail — plus `_build_user_prompt`'s context assembly and the `ResizeResult` shape. What does not port: `ClaudeResizer`, `make_resizer`, `MAX_ATTEMPTS`, and the retry-with-feedback loop. With resize off, emit the deterministic overflow report and truncation preview as before.

All three carry `readOnlyHint: true`, matching the `query_*` annotations.

### 2.3 Skill prompt — rewrite in place

The prototype's skill at `.claude/skills/grant-writing/` encodes the end-to-end workflow: capture form → run pipeline → verify every figure against live data → resolve gaps → deliver a review draft → never submit. Fold that into `src/prompts/grant-writing.ts` so the skill calls the three new tools first, then verifies figures via the existing `query_*` tools, then drafts.

Keep the prototype skill's argument names and step structure. It was derived from this platform's boilerplate, so it ports back mechanically.

The skill must also carry the drafting craft, absorbed from the Playbook at authoring time rather than read per draft. `TAD.md` section 4.2 states the rule. That half depends on G1.

### 2.4 Do not move into this repository

- `Grants/sources/` — ~5.6 MB of sensitive real data. Refer to `TAD.md` section 2.5. **Must not enter this repository's history.**
- `Grants/drafts/` — generated draft outputs. Working artifacts, not platform code.
- `Grants/research/`, `Grants/docs/`, `Grants/legacy/`, `Grants/reference/` — prototype working knowledge, superseded by these documents.

---

## 3 Existing support modules

Five modules are in `packages/grants/src/`. They are not tools; the tools consume them.

| Module | Function |
|---|---|
| `schemas.ts` | zod schemas and types for each seed file. |
| `py.ts` | Four counting primitives with Python semantics. Refer to section 3.2. |
| `data.ts` | The seed loader and the load-time integrity report. Refer to section 3.1. |
| `limits.ts` | Length measurement against a stated limit, plus `MAX_COMPRESSION_RATIO`. |
| `figures.ts` | The 15-check figure verification work order. |

### 3.1 `data.ts` — loader and integrity report

**Load mechanism.** `fs.readFileSync` at runtime, lazy and memoised. A malformed seed file therefore fails inside a tool call and surfaces as a structured error envelope; it does not stop the server at boot. The alternative was `resolveJsonModule`, which is off across this repository and would force `tsc` and `eslint` to infer types for 87 questions and 247 variants on every run.

**Seed path.** `SEED_DIR` resolves relative to the module. `dist/` mirrors `src/`, so one hop up reaches the package root from either location. Do not move the constant into a subdirectory without changing the hop count.

**Integrity report.** Six problem classes, reported at load time. The report never blocks a result. The codes are `kb_entry_without_answer`, `kb_answer_without_entry`, `question_kb_ref_dangling`, `kb_ref_dangling_in_prose`, `attachment_questions_route_to_prose`, and `unknown_question_category`.

**Both warnings that fired on the 2026-07-28 seed are cleared (G1). The report is now empty**, asserted by `data.test.ts` so it cannot regress.

1. `kb_ref_dangling_in_prose` — the `kb_launchpad.json` meta block referenced a slot `kb.serve` that does not exist in `answers`, leaving a content gap unassigned. `kb.serve` was a stale name; the gap it carries is real, and it is Lightspeed being missing from the program descriptions. Retargeted to `kb.program_desc`, the slot that actually holds that text, and confirmed that no answer in the file mentions Lightspeed. **The gap itself is still open** — it is a content task for the Data team, not a code task.
2. `attachment_questions_route_to_prose` — **this was a false positive, and the check was wrong, not the data.** It flagged every `answer_type: 'attachment'` question carrying a non-null `kb_ref`. But all eight route correctly: four to `kb.docs`, whose text is exactly a checklist of documents to attach via Building 21 as fiscal sponsor, and two budget attachments to `kb.budget_narrative`. The check now carries an `ATTACHMENT_SLOTS` allowlist and flags only an attachment question pointing at ordinary narrative prose, which is the defect the code comment always described. Keep the allowlist short — a slot belongs in it only if its text tells staff what to upload.

### 3.2 `py.ts` — five Python primitives

Five operations differ between the languages. Each primitive exists to remove a class of silent defect. `pyRound` is the fifth, added by G2; refer to section 5.

1. **`str.split()` on an empty string.** Python returns an empty list. The naive TypeScript port returns a list of one item, and therefore counts an empty answer as one word.

2. **`len()` versus `.length`.** Python counts code points; TypeScript counts UTF-16 code units. The values differ only outside the Basic Multilingual Plane — `🚀` is 1 code point and 2 code units.

   **This risk is latent, not measured.** A check on 2026-07-28 found no such character in either seed file; both return identical counts either way. An earlier revision cited `—`, `≥`, `⚠`, and `✅` as evidence, which was wrong — all four are inside the BMP and count as 1 in both languages.

   Keep the primitive anyway. One emoji in a future KB answer would overcount silently against the tightest 30-character cap, and the failure would present as a limit error rather than an encoding error. The primitive costs nothing and removes the class.

3. **`str.rstrip()` versus `trim()`.** Python removes trailing whitespace only; `trim()` also removes leading whitespace, which matters in a truncation preview.

4. **Sentence patterns.** The prototype uses one pattern to count and a different pattern to truncate. A single shared pattern changes the output.

### 3.3 `limits.ts` — `MAX_COMPRESSION_RATIO`

`MAX_COMPRESSION_RATIO = 4`, returning the verdict `compression_infeasible` above that ratio. The rationale and the real case are in `TAD.md` section 3.6.

### 3.4 `figures.ts` — the work order

15 checks. Each names the claim as it appears in the KB, the KB slots carrying it, the exact connector tool, the exact arguments, the conflict kind, and the severity.

**The module returns the calls and never runs one.** `TAD.md` section 2.3 holds the security rationale. Do not "optimise" this by having the tool make the call.

---

## 4 Parity tests — the acceptance bar

Re-express as vitest. The root `vitest.config.ts` collects `packages/**/src/**/*.test.ts`. The platform convention is co-location — `permissions.test.ts` sits beside `permissions.ts` — so put `limits.test.ts` beside `limits.ts`.

| Python test file | Tests | Covers | Gate |
|---|---|---|---|
| `tests/test_matcher.py` | 13 | `normalize`, scoring, threshold, `match_question` / `match_form` | G2 |
| `tests/test_pipeline.py` | 25 | `count_units`, `truncate_preview`, every `build_answer` branch, `run` aggregation, Markdown render | G3 |
| `tests/test_resize.py` | 7 | Resize wiring via a fake resizer and injected fake client | G4 |
| **Total** | **45** | | |

The prototype suite has 96 tests. The remaining 51 (`tests/test_prospecting.py`) cover the prospecting scope and are not a bar for this package.

**Port the no-network discipline from `test_resize.py`.** Tests inject a fake resizer and client, so the deterministic core stays testable without reaching Claude.

---

## 5 The one real technical risk: sequence-ratio parity — **resolved**

**Outcome, 2026-07-29: scores match exactly.** This is the first row of the table in section 5.3, so the remaining estimates carry low risk and G3 may proceed. The evidence:

| Bar | Result |
|---|---|
| `sequenceRatio` vs CPython `difflib`, 28,690 recorded pairs | 28,690 exact matches, 0 mismatches |
| `matchQuestion` vs `matcher.py`, 337 inputs, whole-object comparison | 337 exact matches, 0 mismatches |
| All 69 questions across all four form fixtures, TypeScript `dist/` vs Python | identical `matched_id`, `matched_via`, `confidence`, `is_confident` |
| The 13 ported `test_matcher.py` cases | pass |

Equality is asserted with `!==`, not a tolerance. Both sides compute `2 * M / T` in IEEE-754 doubles from the same integer `M` and `T`, so any difference would mean the block search diverged rather than that a float drifted.

The 13 tests alone were not a sufficient bar. They are behavioural invariants — "every canonical matches itself confidently" — and would pass against an approximate ratio function that changed which stored answer a question reached. The fixtures in `src/__fixtures__/` were generated by running CPython's own `difflib` and the prototype's own `match_question` over the real bank, so the port is compared against the function being ported. Regenerate them with the scripts in `../scripts/` when the bank grows — `regenerate-seq-ratio-parity.py` for the `difflib` fixture and `regenerate-matcher-parity.py` for the matcher fixture.

**Re-verified 2026-08-03, at wider coverage.** The table above is the 2026-07-29 result and stands. The code review that day found the `difflib` fixture had been generated against the 82-question/211-variant bank and never regenerated for v0.4.0, so 35 of the current 322 candidate strings — including three of the six that now cross the autojunk threshold — had never been compared against CPython, while the suite stayed green on a `pairs.length > 28_000` assertion. The fixture was regenerated: **58,926 of 58,926 pairs reproduce exactly, 0 mismatches**, every candidate in the bank is now covered as `b`, and the coverage assertions are derived from the live bank rather than hard-coded, so the same staleness now fails the suite instead of passing it. All 377 matcher-parity cases still reproduce field for field.

### 5.1 The problem

`matcher.py` uses `difflib.SequenceMatcher.ratio()`, applied to space-joined token strings. TypeScript has no standard-library equivalent. The port must reproduce that function's ratio semantics. A different implementation changes **every** match score.

### 5.2 The requirement

Build and validate the ratio function **first**, against the `test_matcher.py` fixtures, before writing anything that sits above the matcher.

Note that `SequenceMatcher.ratio()` is not a plain edit-distance ratio. It is `2 * M / T`, where `M` is the total size of matched blocks found by its recursive longest-matching-block algorithm and `T` is the total length of both sequences. Its autojunk heuristic also affects results on longer inputs. Reproduce the algorithm, not an approximation of its output.

Three traps surfaced during the port. All three are live on the real bank, and all three are documented in the header of `src/seq-ratio.ts`:

1. **Autojunk fires.** Six of the bank's 322 unique candidate token-strings reach the 200-character threshold at v0.4.0: `program.description` (GSK-STEM-2026, 201), `program.equitable_access` (GEPA-427, 210), `program.partnerships` (PAsmart, 215), `organization.why_this_funder` (Hamilton-2025, 221), `organization.history` (JEVS-C2L, 244), and `program.description` (WPF-2026, 352). All six are variants rather than canonical phrasings — the heuristic fires exactly where funder wording runs longest. The set is derived from the bank by `seq-ratio.test.ts`; do not maintain it by hand.
2. **The function is asymmetric.** Autojunk is computed over the second argument alone, so argument order changes the score on those three rows. The incoming question is `a`; the candidate is `b`.
3. **A popular character is dropped from the index but is not junk.** CPython keeps `bpopular` and `bjunk` as separate sets, and only `bjunk` blocks the match-extension loops. An autojunked character cannot start a match but can still be absorbed into one. Treating popular characters as junk is the obvious simplification and it is wrong.

A fourth divergence sits outside `difflib`: `matcher.py` reports `round(best_score, 3)`, and Python rounds half-to-even while `Math.round` rounds half-up to an integer. `pyRound` in `src/py.ts` is the fifth primitive in that file, and its comment records why `toFixed` is provably equivalent at three digits.

### 5.3 G2 outcomes

| Outcome | Action |
|---|---|
| Scores match exactly | Proceed to G3. Remaining estimates carry low risk. |
| Scores are close but not equal | Escalate. An approximate match changes which stored answer a funder question reaches. Staff review every draft, so a near match may be acceptable — but that is a business decision, not a developer decision. |
| Scores do not match | Stop. Return for a re-plan before G3. Do not build on a broken base. |

---

## 6 Permission migrations

Each tool needs a `ToolPermission` row. `TAD.md` section 2.4 explains why the registry fails closed and what the recommended roles are.

Closest template: `packages/db/prisma/migrations/20260616000000_add_skill_tool_permissions`.

```sql
INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  '<tool_name>',
  ARRAY['leadership', 'admin'],
  'grants',
  '<human-readable description>',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;
```

Two follow-ups:

1. `grants` is a new category. Add it to `CATEGORY_ORDER` and `CATEGORY_LABELS` in `apps/hq/app/admin/PermissionsMatrix.tsx`, or the tools will not render on the admin page.
2. Apply each migration locally with `pnpm db:migrate`, and to production via a one-off ECS task or the bastion — RDS is not publicly reachable.

---

## 7 The Notion sources — handed off, not a gate

**This left G1.** It is not our package, it needs the owner `PROPOSAL.md` section 8.1 asks for, and holding a gate open on another team's queue would have stalled G2 for no benefit. `TAD.md` section 4.3 holds the finding and the evidence. The mechanics:

`connectors/notion/src/sync-databases.ts` reads `NOTION_SYNC_DATABASE_IDS`, formatted `id:Name, id:Name`. Add the databases and re-run the sync.

| Resource | Id | Present in `document_chunks`? | Fix |
|---|---|---|---|
| Grant Applications database | `e696f630-919c-48ff-998a-993a1ebdada5` | No | Config: add to the env var |
| Research Wiki database | `33779abd-443f-8075-8a47-000b973f8eba` | Not checked | Config: add to the env var |
| Grant Writing Playbook (a page, not a database) | `38bbc938-2180-8106-859b-e8c4cf05b580` | No | **Moot** — now in-repo at `docs/PLAYBOOK.md` |
| Glossary | `51d1e870-ea7c-45fe-96e3-76a42d1dfd56` | Yes | — |
| People & Entities | `695211e1-afbd-4730-a576-2bb87a66349e` | Yes | — |
| Meeting transcripts | `15d1f4e8-9763-4bcb-bfcc-9e2ba152c14b` | Yes | — |

Two corrections to the original framing of this item:

1. **"Configuration, not code" was only half right.** `syncDatabases()` iterates `queryDatabase(db.id)`, which posts to `/databases/{id}/query`. A page id sent there fails. So the Playbook could never have been reached by adding it to that variable, whatever `PROPOSAL.md` section 8.1 said. It no longer matters, because the Playbook is in the repository — but if a page ever does need ingesting, `syncOnePage` and `walkPageBlocks` in that connector are the reusable core and a `NOTION_SYNC_PAGE_IDS` path would be a small addition.
2. **The Research Wiki is a third source, and it was in none of the review documents.** `docs/PLAYBOOK.md` names it and instructs Claude to search it before responding. Same rule as the others: reach it through `search_documents`, never a direct Notion call.

A semantic search cannot prove absence. This query makes the finding definitive:

```sql
SELECT DISTINCT metadata->>'notion_database_name' AS db,
       metadata->>'notion_database_id'   AS db_id
FROM document_chunks WHERE source = 'notion';
```

Three follow-up checks:

1. Confirm the ingest captures application **rows**, not only the view container. A database view may behave differently from a page.
2. The Playbook is a page, not a database row, and `sync-databases.ts` walks databases. Confirm the connector reaches it at all.
3. Observed similarity scores sit near 0.30 to 0.44, and the default threshold filtered every realistic grant query to zero results. Tune `min_similarity` at the call site, or G5 will read as an empty result rather than a missing page.

Ingested rows stay addressable: each carries `source = 'notion'` and a `source_id` of the form `notion:<page_id>:<chunk_index>`.

---

## 8 Carried but not connected

One Claude seam exists in the prototype and stays unconnected: **reframe**, which re-emphasises an answer for a specific funder. Port the seam. Do not wire it. Refer to `TAD.md` section 5, decision 7.

---

## 9 Key files

| File | Role |
|---|---|
| `apps/mcp-server/src/make-server.ts` | Tool registration. Add the three tools here. |
| `apps/mcp-server/src/tool-helpers.ts` | `runTool`, the usage log, `SERVICE_ALLOWED_TOOLS`. |
| `apps/mcp-server/src/permissions.ts` | The ACL registry. Fails closed. |
| `apps/mcp-server/src/prompts/grant-writing.ts` | The skill prompt that G5 rewrites. |
| `apps/mcp-server/src/tools/search-documents.ts` | The read path for teamspace material. |
| `apps/mcp-server/src/errors.ts` | `toolError()` and `notImplemented()`. |
| `connectors/notion/src/sync-databases.ts` | The copy process. Refer to section 7. |
| `apps/hq/app/admin/PermissionsMatrix.tsx` | The admin page category list. Refer to section 6. |
| `packages/grants/seed/QUESTIONS-SCHEMA.md` | Question bank schema and growth rules. |
| `CLAUDE.md` (repository root) | Platform architecture and tool conventions. |

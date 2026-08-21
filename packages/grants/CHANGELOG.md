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

## 2026-08-21

### Added — WP #323: `get_grant_document_text`, the Drive text-fetch tool `find_grant_documents` promised

`find_grant_documents` catalogs 1,253 Drive files but only ever returned metadata — its `usage_note`
pointed at "a Google Drive read tool" that did not exist. New MCP tool
`apps/mcp-server/src/tools/get-grant-document-text.ts` closes that: given a `drive_file_id`, it reads
the `grant_documents` catalog to gate on `contentClass`/`driveFileId` (the same `fetchable` flag
`find_grant_documents` already returns), then fetches via the `google-drive` connector's own client
(`clientFromEnv`, now exposed to `apps/mcp-server` as `@lp-ai/connector-google-drive`) rather than a
second Drive credential path. Google Docs/Slides export as plain text; uploaded `.docx`/`.dotx` are
downloaded raw and extracted with a new `extractDocxText` (`packages/grants/src/docx.ts`, new `jszip`
dependency) — a straight port of `.claude/skills/grant-writing/scripts/corpus_search.py`'s paragraph
extraction, kept in parity with it deliberately. Other `contentClass: "text"` types (PDF, `.doc`,
spreadsheets, `.csv`, `.vtt`, `.html`) are out of scope for this pass and return `not_yet_implemented`
— `find_grant_documents`'s `fetchable=true` no longer guarantees this tool can read the file, which is
now stated in both tools' descriptions and in `docs/mcp-server-spec.md`. `find-grant-documents.ts`'s
`usage_note` and `.claude/skills/grant-writing/references/gap-fill.md` (rung 3) now name the new tool
as the production path, with `corpus_search.py` kept as the documented dev-only fallback. Registered
in `make-server.ts`; `tool_permissions` row added
(`20260821010000_add_get_grant_document_text_permission`, same roles as `find_grant_documents`).
**Production Drive auth for the Grants tree remains unverified** (the service account may lack
access) — this tool inherits that limitation and says so in its error path rather than papering over
it. Tool count: 26 → 27 on this branch; `docs/mcp-server-spec.md`, `docs/STATE.md`, and this package's
`CLAUDE.md` all updated. If you have an existing local clone: `pnpm install` (new `jszip` dependency)
and `pnpm db:migrate`.

### Removed — WP #322: `kb.meta.connector_reconciliation` relocated out of the KB

`kb_launchpad.json`'s `meta.connector_reconciliation` carried dollar/percentage figures dated
2026-07-23, a month stale against `meta.updated` (2026-08-20), and outside every staleness check:
`computeIntegrityReport`'s `stored_literal_figure` scan (`src/data.ts`) only walks `kb.answers`, and
the only scan that touched `meta` at all (`kb_ref_dangling_in_prose`) checks for dangling KB-slot
references, a different concern. Confirmed (2026-08-21) the field was read by nothing besides that
dangling-ref scan — never surfaced to a drafting model — so the field is deleted from the KB and its
content relocated verbatim to [`docs/connector-reconciliation-notes.md`](docs/connector-reconciliation-notes.md),
a dated staff note no code path reads. This removes the staleness risk instead of scanning for it
forever. `knowledgeBaseSchema` (`src/schemas.ts`) no longer declares the field; `data.ts`'s prose scan
now runs over `source_recency` + `note` only. If you have an existing local clone with an older
`kb_launchpad.json`, `pnpm db:seed` or re-pulling picks up the trimmed file automatically — no
migration involved, this is corpus JSON, not the database.

### Added — WP #321: `grant_verify_figure` closed-loop figure check

`figure_call` in `pipeline.ts` tells the drafting model which `query_*` tool sources a figure, but
nothing mechanically checked that the number it wrote down actually matched what that tool
returned — the drafting model could still hallucinate a plausible-looking figure.

- **New `verifyFigureAnswer(draftText, figureCall, queryResult)`** (`packages/grants/src/verify.ts`) —
  extracts literal figures from the draft via the existing `literalFigures()` (`slots.ts`), walks
  `queryResult` recursively collecting every numeric leaf (numbers and numeric substrings in
  strings, via the existing `extractNumericClaims()` from `figures.ts`), and reports which drafted
  figures do and don't appear anywhere in the live result. No new number-parsing was written.
- **New MCP tool `grant_verify_figure`** (`apps/mcp-server/src/tools/grant-verify-figure.ts`) — takes
  `{ answer_text, figure_call, query_result }` and returns `needs_input` naming the unmatched
  figure(s) plus the correct live value(s) as suggestions, or `{ matched: true, drafted_figures }`
  on success. Registered in `make-server.ts`; ACL row added via migration
  `20260821000000_add_grant_verify_figure_permission` (`leadership`, `admin`, same as the other
  `grant_*` tools).
- **Deviates from the WP's literal text on purpose.** WP #321 as written says
  `grant_verify_figure` should re-invoke the named `query_*` tool server-side. That would launder
  permissions: `runTool`'s ACL check (`apps/mcp-server/src/permissions.ts`) keys on the literal
  inbound tool name, so an internal call to e.g. `query_finances` from inside
  `grant_verify_figure` would be authorized as `grant_verify_figure`, not as `query_finances` —
  exactly the ACL-bypass pattern `figures.ts`'s own header comment already forbids. Raised to the
  user, who chose the caller-supplies-`query_result` shape instead: the drafting model runs the
  `query_*` tool itself (ACL-checked under its own name) and hands the raw result to
  `grant_verify_figure` for comparison only. `pipeline.ts`'s `fetch_figure` action-text and the
  markdown renderer's `figure_call` block both now instruct the drafting model to call
  `grant_verify_figure` with that result before finalizing a figure answer.
- **Verified:** `pnpm -r typecheck` clean across 14 packages, `pnpm test` 573/573, `pnpm lint`
  clean. New coverage: `verify.test.ts` (5 cases — match, mismatch, nested-in-result match,
  vacuous pass with no literal figures, multiple simultaneous mismatches) and two `tools.test.ts`
  integration cases (mismatch → `needs_input` with the correct suggestion; match → `matched: true`).

### Added — WP #320: `needs_input` gate enforces program/framing before drafting

`admin/HANDOFF.md`'s three-principle review found principle 3 unenforced: `program`/`framing` on
`grant_build_draft` were optional Zod fields nothing ever checked, `cover.fiscal_sponsor` was one
hardcoded answer regardless of which fiscal-sponsorship posture applied, and no "ask for
clarification" mechanism existed anywhere in this MCP server.

- **New `ToolErrorCode`: `needs_input`** (`apps/mcp-server/src/errors.ts`) — not a failure; the tool
  needs a fact only the caller's conversation has. Reuses the existing `{ error: { code, message,
  suggestions? } }` envelope.
- **`grant_build_draft` gates on `program`/`framing` before calling `runPipeline`**
  (`apps/mcp-server/src/tools/grant-build-draft.ts`) — the one chokepoint every draft passes through,
  per `docs/PLAYBOOK.md` steps 2 and 3. Missing either returns `needs_input` naming which is missing,
  with suggestions listing the concrete choices (program: 101/LiftOff/Inc.; framing: the three
  postures below). Applies to both the inline-`questions` path and the `form_id` stored-fixture path.
- **`framing` is now a closed enum, not a free string** — `FRAMINGS` / `framingSchema` / `Framing`
  (`packages/grants/src/schemas.ts`): `initiative` | `fiscal_sponsorship` | `silent`, naming the three
  postures `docs/PLAYBOOK.md` step 3 says to ask about every time. Applies to
  `incomingFormSchema.meta.framing` and the `grant_build_draft` tool's `framing` input.
- **`cover.fiscal_sponsor` now varies by framing** — `kbStructuredValueSchema` gained an optional
  `by_framing` map (`packages/grants/src/schemas.ts`); `packages/grants/seed/kb_launchpad.json`'s
  `cover.fiscal_sponsor` carries an `initiative` and a `fiscal_sponsorship` variant (the `silent`
  variant and the base `value` are the same minimal answer). `pipeline.ts::buildAnswer` resolves the
  effective value from `formContext.emphasis`, falling back to `value` when framing is absent or the
  slot carries no variant for it — so any other structured value is unaffected.
- **Blast radius: all 10 stored form fixtures now carry a `framing`.** Five (`allen_hiles_2024`,
  `dolfinger_mcmahon_2023`, `jff_ai_pathways_2026`, `sample_incoming`, `sample_philly_innovation`) had
  none and were backfilled `"silent"` — the least-assumption default for a blank template or a
  synthetic non-real fixture. Five had descriptive free-text framing and were normalized to the
  nearest enum value (`aug7_gsk`, `hamilton_loi_2025`, `jevs_c2l_2024` → `initiative`; `aug7_truist`,
  `wpf_workforce_2026` → `fiscal_sponsorship`) — no test asserted the old wording, confirmed by grep
  before the change.
- **Deliberately out of scope, tracked as follow-on debt** (`docs/STATE.md`): full per-program KB
  sharding and a matcher-side ambiguity/runner-up signal. The KB is flat prose; splitting it by
  program is a content lift, not a code fix.
- **Verified:** `pnpm -r typecheck` clean across 14 packages, `pnpm test` 567/567 (one pre-existing
  `pipeline.test.ts` assertion updated — it checked a fixture's old free-text framing string passed
  through verbatim, not the feature under test), `pnpm lint` clean. New coverage:
  `pipeline.test.ts` (`by_framing` resolution + fallback) and `tools.test.ts` (the gate, drafting once
  supplied, and the enum rejecting an unlisted posture at the schema layer).

### Removed — the five `FIGURE_DEBT` unsourced figures, stripped from the corpus rather than settled

The language-only rule already blocked any *new* stored figure without a live slot or a recorded
exemption (`stored_literal_figure`, `high`). It also carried one standing exception: `FIGURE_DEBT`
(`packages/grants/src/slots.ts`) let five figures that drift with no connector to source them stay
literal, reported at `medium` (`stored_figure_unsourced`) rather than blocked. On review, that
exception was itself a hole in the "nothing pulled from the knowledge base can violate the live-figures
rule" guarantee — so the five claims were removed from the corpus instead of left as acknowledged debt:

- **Outreach reach** — "reached more than 1,000 young people through info sessions and outreach" /
  "1,000+ reached through outreach" (`kb.history`, `kb.capacity`, `kb.metrics`).
- **Recruitment footprint** — "more than 30 non-selective high schools", "30+ ZIP codes"
  (`kb.program_desc`, `kb.target_population`, `kb.partnerships`, `kb.profile.demographics`).
- **Volunteer count** — "roughly 30 volunteers" (`kb.staff_bios`).
- **Recruitment-interest split** — "fewer than 10% of recruited students... the other ~90%", the stated
  rationale for the Entrepreneurial Leadership pathway (`kb.dei`, rewritten to keep the pathway
  rationale without the unsourced split).
- **Draft-reconciliation commentary** — a note comparing how two draft applications rounded the wage
  total, which had leaked into stored answer prose rather than staying in `meta` (`kb.outcomes`,
  `kb.metrics`).

`packages/grants/seed/kb_launchpad.json` no longer states any of these. The matching five entries in
`slots.ts::FIGURE_DEBT` were removed with them — leaving a dead register entry pointing at a claim the
corpus no longer makes would have been the "delete an entry to quiet the warning" move the module's own
doc comment forbids; removing the claim and the entry together is not that. `FIGURE_DEBT` is now an
empty array, kept as the mechanism for any *future* unfillable figure.

**Test changes:** `data.test.ts::BASELINE_CODES` and the "carries no violation" assertion now expect an
empty integrity report instead of `['stored_figure_unsourced']`. `slots.test.ts`'s "no leaked /g regex
state" test for `FIGURE_DEBT` now asserts 0 matches instead of 1, since there is nothing left in the
register to match — the regression it guards against re-arms the moment a new entry is added.

**Blast radius:** `pnpm exec vitest run packages/grants/src/data.test.ts packages/grants/src/slots.test.ts`
— 69/69 pass. Full `pnpm test` — 562/562 pass. `pnpm -r typecheck` clean across all fourteen typechecked
packages. `loadIntegrityReport()` on the real seed now returns `[]` — zero warnings of any severity,
not just zero `high`. See `CLAUDE.md` §3 and `docs/STATE.md` §3 for the updated snapshot.

## 2026-08-20

### Changed — `packages/grants/CLAUDE.md` slimmed; state snapshot, debt list, and verification commands moved to `docs/STATE.md`

To cut per-request context cost (the file was ~38 KB and loads into every Claude Code request),
`packages/grants/CLAUDE.md` now carries only the load-bearing rules: §1 (the reconciliation rule),
§2 (sources of truth), a one-paragraph §3 current-state summary, and §5 (changelog maintenance).
The full verified snapshot, the documentation-debt list, and the verification commands moved
byte-for-byte into `packages/grants/docs/STATE.md` (§3 / §4 / §6 unchanged, plus a header noting the
move). Root `CLAUDE.md` was slimmed the same way — the add-tool and connector how-tos were already
duplicated verbatim by the `add-mcp-tool` and `implement-connector` skills, so those sections are now
pointers to the skills; the migration-deploy ordering note is condensed.

**Blast radius:** nothing functionally changed — same commands, same authority, same debt record, all
one path hop away. If you reference `CLAUDE.md` §4 or §6, point at `docs/STATE.md` instead.

### Added — three org-identity facts filled in `kb_launchpad.json`, closing a gap three runs flagged

`drafts/runs/2026-08-19/GAPS-AND-UNCERTAINTIES.md` §D listed website, mailing address, and year founded
as facts the platform holds no answer for, needed by all four grants in `#304`. The same gap was
recorded on 2026-08-11 (`docs/INFORMATION-GAPS.md`) and never closed. Per staff direction, financial
and other number-based figures were left alone here because they move day to day; these three do not.

Added to `kb.profile.identity`'s prose (`packages/grants/seed/kb_launchpad.json`), sourced from public
IRS filing data via web search — **not** filed Launchpad material, which is this KB's usual bar, so
flag if a stricter provenance standard is wanted for this class of fact:

- **Website**: `https://launchpadphilly.org`. Read off the org's own email domain already on file
  (`dannyelle@launchpadphilly.org`, `giving@launchpadphilly.org`) and confirmed by web search.
- **Building 21's IRS-registered address is not the Philadelphia hub.** ProPublica Nonprofit Explorer
  (EIN 47-2514219) lists the registered locality as Plymouth Meeting, PA; 801 Market Street is
  Launchpad's program site, not Building 21's registered address. Exact street still
  `[STAFF CONFIRM]` — the full address sits behind an embedded PDF viewer this pass didn't extract.
- **501(c)(3) determination year is 2018, not the 2013 founding year.** Same ProPublica source:
  "tax-exempt since April 2018." The KB previously had only the founding year, so any field asking
  specifically for the determination year had nothing correct to answer with — three separate runs
  (`aug7_gsk`, `wpf_workforce_2026`) filed `[DATA UNAVAILABLE]` here.

**Did not add** a `cover.website` structured value: no such question id exists in `questions.json` yet
(`docs/INFORMATION-GAPS.md` §7.1 — the "Website" question currently routes to `cover.address` by
design, a bank-wording defect, not a content one). Adding the key anyway fires
`structured_key_dangling` (`data.test.ts`) — verified by trying it, reverting, and confirming
`pnpm exec vitest run packages/grants` returns to 320/320 green. Wiring a real `cover.website`
canonical is engineering work and is unchanged by this pass.

Still open, and not addressable without a person: exact Building 21 registered street address, board
list, audited financials/990 attachment. Tracked as work package `#317`, child of `#304`.

## 2026-08-19

### Fixed — `recent_gifts` returned the OLDEST gifts, because sheet order is not chronological

Work package `#306`, found by testing the repoint against production immediately after deploying it.
The repoint made `get_finance_brief.recent_gifts` return rows instead of an empty array — and they came
back **FY20, Dec 2019 / Jan 2020**, on a tab whose row 523 is FY26. A field named `recent_gifts`
returning the tab's oldest gifts is a worse failure than the empty array it replaced, because it looks
like an answer.

**Two independent causes, both real:**

1. **`orderBy: { sourceId: 'asc' }` is a lexical sort.** `development:giving history:99` sorts *after*
   `…:784`, because `'9' > '7'`. So the query was never in sheet order, and "the last ten rows" under
   that ordering were the low-numbered — oldest — ones.
2. **Sheet order is not chronological anyway.** Rows 523–526 of the 784-row giving-history tab are FY26
   (Jul 2025) while its final rows are FY20. Older gifts were appended after newer ones, so *no* slice
   off either end of that tab can mean "recent". The comment shipped in the first cut said sheet order
   was "append-chronological in the observed data" — that assumption was wrong, and only production
   data showed it.

**Fix.** New `byFiscalYearDesc()` in `dev-crm.ts` sorts on the `fiscal_year` cell (`FY26` → 26), which
is the only ordering key on these tabs that means anything — `date` is a display string (`"Aug 2025"`)
and does not sort. `readDevTab` now sorts numerically on the row number parsed out of `sourceId`, so
sheet order is actually sheet order for anything that wants it. Rows with no parseable fiscal year sort
last rather than being dropped.

The response note now says what the field is: **ten gifts from the most recent fiscal years, not the
ten most recent gifts**, with no meaningful order within a year.

`summariseGiving`'s `first_gift` / `last_gift` are replaced by `first_fiscal_year` /
`latest_fiscal_year`, derived from the fiscal-year keys. The old pair read the `date` cell off either
end of the array and was wrong for both reasons above. Nothing consumed them, so no caller changes.

Seven new tests, including both causes reproduced directly: one asserts that a lexical `sourceId` sort
picks the FY20 row as "most recent" and that `byFiscalYearDesc` does not, and one covers a
non-chronological tab in true numeric order. Suite **562 passing across 27 files**.

### Changed — `query_donors`, `get_entity_brief` and `get_finance_brief` repointed at the Development CRM tabs

Work package `#306`, item 4, decided and implemented rather than deferred. All three tools read the
typed `donor_contacts` / `donor_gifts` / `donor_pipeline` tables, which **no connector has ever
written**. They now read the `development:*` tabs in `finance_snapshots` — the rows `query_finances`'s
`dev_*` types serve — through a new shared reader, `apps/mcp-server/src/dev-crm.ts`.

The alternative was a Givebutter connector to populate the typed tables. Rejected: its advantage was
keeping typed relations, and once the data was already reachable that bought ergonomics for a sync that
does not exist, while leaving two documented routes to one answer with one of them dead and returning a
reply indistinguishable from a real negative.

**Four things the repoint had to get right.** Each would otherwise have swapped a silent zero for a
silent wrong number, which is worse:

1. **`launchpad_only` was accepted and never read.** Every response was all-Building-21 scope while the
   description promised Launchpad-only. It now defaults to `true` and is applied, and every response
   carries `scope` and `scope_note`.
2. **Giving is summed from gift rows, not read from `dev_contacts`.** Summing is also what makes
   `launchpad_only` mean anything for a total — a precomputed all-scope column cannot express scope.
3. **Totals are split by project** (`giving_summary.by_project`). See the figure correction below.
4. **A funder with no Contacts row still resolves.** Contacts is a stewardship roster, not the set of
   everyone we have asked. A name found only on the giving-history, pipeline or denied tabs returns a
   profile with `profile: null` and a `profile_note` rather than `no_records`. Without it a funder that
   had *declined* us was invisible — the single most framing-relevant record there is. This was caught
   by its own test, not by review.

Name matching is confined to the name columns. `query_finances`'s `contains` matches the serialized
row, so "William Penn" there also returns **Project Based Learning, Inc.**, whose `primary_fund` is
named "William Penn". Reporting one organisation's giving under another's name is worse than returning
nothing. `no_records` now distinguishes out-of-scope, absent-from-Contacts, and absent-everywhere.

`[VP]` and `NOT YET MARKED` are withholding markers in the grants tracker, not values. `cell()` maps
them to `null` so the literal string `[VP]` cannot reach a draft as a deadline or a program officer.

**`packages/db/src/seed.ts` now seeds `development:*` rows**, including William Penn's real
two-gifts-per-year split, so local dev and CI exercise the production path. The old integration test
asserted `total_donors === 2` against the seeded typed tables — it passed in CI while production
returned nothing, which is why this survived as long as it did.

Coverage: `apps/mcp-server/src/dev-crm.test.ts` (28 unit tests over the parsers and scope logic,
fixtures copied from live probes rather than invented, since the connector derives column keys from the
sheet's own header row) plus six integration tests. Suite **555 passing across 27 files**, clean
`pnpm -r typecheck`, clean `pnpm lint`.

`FigureCheck.args` widened from `Record<string, string>` to `Record<string, string | number | boolean>`
— `launchpad_only` is a boolean, and a work order printing `launchpad_only: "true"` would tell the
drafter to send the wrong type. `SlotRequirement.args`, `figure_call.args` and `figureCallsFor` widened
with it.

### Corrected — the William Penn figure is a scope difference, not drift, and Launchpad's share is $425,000/yr

Also `#306`, found by running the repointed tool against live data. The earlier entry below called the
$1.5M-versus-$1.6M gap drift and said the connector wins. **That would have been wrong**, and it would
have replaced a correct figure with an incorrect one.

Three numbers, all true, all different:

| Figure | Population |
|---|---|
| **$1,600,000** | All-time, all Building 21 projects |
| **$1,500,000** | The FY24–FY26 three-year grant — what the KB's stored "$1.5M" claim means |
| **$1,375,000** | All-time, **Launchpad only** |

Because each year is **two gifts**: `$425,000` to Launchpad plus `$75,000` to Network Unrestricted,
in FY24, FY25 and FY26, plus a `$100,000` FY22 gift. So "$500,000/yr" is the Building 21 figure and
**Launchpad's share is $425,000/yr**. Quoting $500,000 as the Launchpad grant overstates it by $75,000
a year, and the `#304` run's FUNDER-HISTORY.md records $500,000/yr without the split.

`prior_funding_wpf` is therefore reclassified from `drift` to **`definitional`** — which routes it to
staff escalation instead of silent connector-wins resolution — and points back at `query_donors`
`profile` now that one call returns the split. `figure-cuts.md` carries the worked table.

### Fixed — funder history is in `query_finances dev_*`, not `query_donors`, which reads tables nothing populates

Work package `#306`. The `#304` run recorded prior-funder giving history as `[DATA UNAVAILABLE]` for
all four targets because `query_donors` returned `no_records` and the run read that as an ACL denial.
Both halves were wrong, and the second is the more serious one.

**`query_donors` is permitted, and structurally empty.** The `donor_contacts`, `donor_gifts` and
`donor_pipeline` tables have **no connector writing them** — `packages/db/src/seed.ts` is their only
writer in the repository, and Givebutter, the source `schema.prisma` names on
`donor_contacts.givebutter_contact_id`, has no connector at all. So `no_records` does not mean "this
funder has not given"; it means no donor is recorded anywhere. That failure mode is invisible: the
reply is well-formed and per-funder, so it reads as a fact about the funder.

**The documented fallbacks are dead too.** `figures.ts` told callers to fall back to
`get_finance_brief`; that tool reads `donorGift` (`apps/mcp-server/src/tools/get-finance-brief.ts:78`),
the same empty table. `get_entity_brief` reads all three. There was no working path.

**Funder history is live in the `development:*` sheet tabs**, through `query_finances`. Six `dev_*`
query types, not the four first identified — `dev_denied` and `dev_launchpad_pipeline` matter as much
as the rest, since a prior decline reframes an application exactly as a prior gift does:

| Query type | Tab | Holds |
|---|---|---|
| `dev_grants_tracker` | `development:grants tracker` | Per-funder lifetime total, received to date, outstanding pledges, lifecycle |
| `dev_giving_history` | `development:giving history` | Every gift: donor, date, fiscal year, gross amount, fund, project, grant status |
| `dev_contacts` | `development:contacts` | Program officer, relationship owner, notes, Drive folder link. **Giving columns broken — see below.** |
| `dev_prospect_pipeline` | `development:prospect pipeline` | The full multi-fund ask behind one Launchpad pipeline row |
| `dev_launchpad_pipeline` | `development:launchpad pipeline` | Launchpad-scoped open asks |
| `dev_denied` | `development:denied` | Prior declines |

Worked example, and it takes both tabs: `dev_grants_tracker` gives William Penn Foundation a lifetime
**$1,600,000.00**, all received; `dev_giving_history` itemises **$500,000/yr in FY24, FY25 and FY26**,
ending 6/30/26. The tracker alone gives a total with no schedule. Under the old information P-0041 is a
cold $225,000 prospect at 20% probability; under the new it is a renewal against a grant that just
ended.

Landed:

- `src/figures.ts` — `prior_funding_wpf` now calls `query_finances {query_type:"dev_grants_tracker",
  contains:"William Penn"}`; its `note` says not to use `query_donors` and why. The `blocked` entry for
  `query_donors` is rewritten from "may be denied (donor PII)" to permitted-and-unpopulated, with the
  six `dev_*` types named. The module header's claim that the KB records `query_donors` as blocked is
  corrected.
- `FigureWorkOrder.blocked` — widened from ACL denials to per-tool caveats generally, with a doc
  comment saying so, because a permitted-but-empty tool fails a drafter identically and there was no
  other channel that reached them.
- `.claude/skills/grant-writing/references/figure-cuts.md` — new **Funder history** section. There was
  none, which is why the run reached for `query_donors` in the first place.
- `.claude/skills/grant-writing/references/figures.md` — the ACL-denial section no longer names
  `query_donors` as refusable.
- `.claude/skills/grant-writing/scripts/prep.mjs` — the caveats heading is no longer
  `TOOLS THAT MAY BE ACL-DENIED`. Calling a permitted-but-empty tool an ACL denial tells the drafter to
  expect a permission error and treat the tool as unavailable *to them* rather than wrong *for
  everyone* — a different and wrong next action.

**Decided and done — see the repoint entry above.** This paragraph originally left open whether
`donor_contacts` should be populated by a Givebutter connector or whether the three tools should be
repointed at the `dev_*` tabs. Repointed. The trap this described — two documented paths to one answer,
one of them dead — is closed.

The `donor_contacts` / `donor_gifts` / `donor_pipeline` tables and their Prisma models are **left in
place**, still seeded, and no longer on any tool's read path. Dropping them is a destructive migration
with no caller asking for it; if nothing claims them by the time someone next touches the schema, that
is the moment to remove them.

### Fixed — `dev_contacts` fiscal-year and lifetime giving columns are wrong at source

Also `#306`. `dev_contacts` reports `lifetime_giving` of **$0.00** for William Penn Foundation and
**$100.00** for Philadelphia Foundation, against `dev_grants_tracker` totals of **$1,600,000.00** and
**$112,000.00**. `fy25_giving` and `fy26_giving` are `$0.00` on every row inspected while
`cy2025_giving` carries real values — the calendar-year columns work and the fiscal-year and lifetime
columns do not.

The fix belongs in the sheet, not in the connector or this layer, so nothing was changed in code beyond
recording it: a `blocked` entry in `figures.ts` and a subsection in `figure-cuts.md`. **Any draft or
tool reading `lifetime_giving` from that tab is reading a wrong number today.** Take giving figures
from `dev_grants_tracker` or `dev_giving_history`; use `dev_contacts` for stewardship fields only.

### Fixed — `prep.mjs` refused to run on a correct seed

Work package `#307`. `prep.mjs` gated on `integrity.length > 0`, but since `#275` a correctly
maintained seed returns **exactly one `medium`** warning (`stored_figure_unsourced`, the `FIGURE_DEBT`
register) and the guarantee is **zero `high`** — stated in `CLAUDE.md` §4 item 17 and encoded in
`data.test.ts::BASELINE_CODES`. So step 1 of the documented drafting workflow could not be run at all,
and its failure message said the opposite of what was true:

```
REFUSING: seed integrity report is not empty (1 warnings).
Fix the seed before drafting — a defect here propagates into a funder-facing draft.
```

There was nothing to fix. This is the failure mode `CLAUDE.md` §4 item 17 warned about as a hazard;
it had already shipped. The `#304` run worked around it with a local copy gated on `high` only —
correct, but not the shipped path, and the skill's own "do not skip the deterministic layer" section
forbids the other way out.

- Gate is now `high`-only. Non-blocking warnings are printed, one truncated line each, then a note
  saying they are expected. The register's `message` concatenates all 11 debt entries into ~2,600
  characters; printed in full it buried the work order beneath it.
- The success line no longer prints `SEED integrity clean`, which was a false statement whenever the
  register was non-empty — i.e. always. It now reads
  `SEED integrity zero high, 1 non-blocking (stored_figure_unsourced); 12 questions`.
- `--json` output carries a new `seed_integrity: { high, non_blocking }`, so a consumer cannot infer
  "exit 0, therefore the report was empty".
- `count.mjs` and `gapfill.mjs` were checked for the same pattern. Neither has the gate; `count.mjs`'s
  `length > 0` checks are em-dash and jargon scans, where gating on presence is correct.

Verified: all ten fixtures in `seed/forms/` now exit 0 through `prep.mjs`. Suite unchanged at **522
passing across 26 files**, clean `pnpm -r typecheck`.

### Added — FY27 grant run for four prospects (`drafts/runs/2026-08-19/`)

Work package `#304`. Drafted four FY27 applications identified from the Prospect Pipeline spreadsheet
(`1CoVgJDiRuXmIBekGdxFq8k8A65yh525b76Hr-S7SeCM`): P-0041 William Penn ($225,000), P-0047 Philadelphia
Foundation DAF ($30,000), P-0033 Siegel Family Endowment ($100,000), P-0048 Comcast ($150,000). The
run directory carries a figure ledger, a consolidated gaps report, and the four drafts.

The William Penn and Philadelphia Foundation answer sets in `drafts/answers/` were **refreshed, not
rewritten** — carried forward verbatim except for figures that drifted since 2026-08-17. Siegel and
Comcast have no captured form and are concept notes organised against the question bank's
high-frequency canonical questions; that is stated at the top of each file.

### Changed — the "70-100% per cohort" PCEP claim is unverifiable and must not be quoted

`docs/runs/2026-08-11` and the 2026-08-17 work order both list `cert_pass_rate` as a definitional
conflict between an all-time 54.2% and "per-cohort 70-100%". The per-cohort range **cannot be produced
by any tool**. `query_certifications` reports by *phase*, not cohort, and the phase figures are
**14/14 = 100% (Lightspeed)** and **18/45 = 40% (Launchpad 101)** — the 40% sits below the bottom of
the stated range. Until someone produces cohort-level numbers, quoting "70-100% per cohort" states a
range the platform contradicts. Recorded in `drafts/runs/2026-08-19/GAPS-AND-UNCERTAINTIES.md` B2.

Note the phase filter values are `Lightspeed` and `_101` — with the leading underscore, which
`query_certifications({query_type:"by_phase"})` returns and which the `phase` filter requires
literally.

### Changed — `query_finances` was NOT ACL-denied; three grant tools were

The 2026-08-17 work order warns that `query_finances` and `query_donors` "may be ACL-denied" and to
prefer `get_finance_brief`. In this run **`query_finances` was permitted** and `get_finance_brief`
turned out to be the weaker tool for the purpose: it returns no income/expense summary at all, only
fund balances, a chart-of-accounts count, and recent transactions. `query_finances({query_type:
"annual"})` with a `contains` filter is the call that actually produces the FY totals.

Denied for this role instead: **`grant_build_draft`** and **`find_grant_documents`**. The second one is the one that hurts — it is the only tool that can see inside the
Drive `Grants` tree, so this run could not check whether Siegel or Comcast material exists there.
That is discovered work needing its own work package related to `#304`.

**`query_donors` was originally listed here as denied. It is not — see the 2026-08-19 `#306` entry
below.** It is permitted and returns `no_records` for every funder because nothing populates the
tables behind it. This run misread that as a denial and filed prior-funder giving history as
`[DATA UNAVAILABLE]` for all four targets.

### Documented — Comcast NBCUniversal Local Impact Grants: Launchpad fails the budget-size gate

The question bank holds four Comcast eligibility criteria and no Comcast narrative questions. Launchpad
fails the **$1,000,000 total-expense ceiling** on arithmetic — FY2026 total expense is $1,732,500.06 —
and arguably fails the **schools and educational institutions exclusion**, since Building 21 is a
competency-based school network. Screen in `drafts/runs/2026-08-19/P-0048-comcast.md`. The $150,000
pipeline ask is also well above typical Local Impact Grant size, so the row may target a different
Comcast vehicle entirely.

---

## 2026-08-18

### Changed — permission migrations now assert their own role declaration (`DO UPDATE`, not `DO NOTHING`)

Work package `#294`, commit `7a46554`. Every migration writing `tool_permissions` ended in
`ON CONFLICT ("tool_name") DO NOTHING`, which makes the insert a **silent no-op whenever a row for
that tool already exists**: the declared roles never land, Prisma still records the migration as
applied, and the registry fails closed (`apps/mcp-server/src/permissions.ts:87`). The symptom is
`permission_denied` for a caller the migration says is allowed, with no signal anywhere. It is the
shared cause behind `#204` and `#262`.

The documented procedure taught the broken clause in three places, now all corrected to
`DO UPDATE SET "allowed_roles" = EXCLUDED."allowed_roles", "category" = EXCLUDED."category",
"description" = EXCLUDED."description", "updated_at" = NOW()`:

- root `CLAUDE.md` — step 6 of "Adding a new MCP tool", plus a paragraph stating the one tradeoff.
- `.claude/skills/add-mcp-tool/SKILL.md` — step 6, so the skill cannot teach it either.
- `packages/grants/admin/SPEC.md` §6 — with a warning that its own "closest template",
  `20260616000000_add_skill_tool_permissions`, still reads `DO NOTHING`: copy its shape, not that clause.

**The tradeoff, recorded because it is presumably why `DO NOTHING` was chosen.** `DO UPDATE`
overwrites a role change an admin made on HQ `/admin` in the window between a merge and the deploy
that applies the migration. A migration applies exactly once, so an edit made after it applied is
never touched. Accepted deliberately: a migration that cannot assert its own declaration is worse,
because it fails closed and silently.

**The six existing `DO NOTHING` migrations are NOT corrected in place.** Prisma checksums applied
migrations; editing one breaks `migrate deploy` and `migrate status` on every environment that already
ran it. New guard: `packages/db/src/tool-permission-migrations.test.ts` (3 tests) fails the build on
any *new* `DO NOTHING` insert, exempts the six by name, and fails if an exemption goes stale — so the
allowlist cannot silently start covering a new file that reuses an exempted name. Verified in both
directions with a probe migration. Suite after: **504 passing across 25 files, 0 skipped.**

### Corrected — a green `migrate` job attests only to the PREVIOUS release's migration set

Work package `#295` (Immediate). `#220` is closed and its fix works, and it is **not sufficient**.
The job launches `aws ecs run-task --task-definition lp-internal-mcp-server` with no revision, so ECS
resolves the latest registered revision — the *previous* deploy's image — and it runs before the new
image is built. Deploy run `32047334123` (the PR #51 merge, first run with the fix) logged
`12 migrations found in prisma/migrations`; the deployed commit `fc2a43d` carries **19**, and 12 is the
count at `f756a44`, the PR #46 merge of 2026-08-13. The count is a directory count, not a database
figure — `prisma migrate status` against the 19-dir tree locally prints `19 migrations found`.

So seven migrations in the release were never considered, `20260729000000_add_grant_tool_permissions`
among them, and the job printed "Database schema is up to date!" regardless. **The grant `tool_permissions`
rows still very likely do not exist on RDS**, which keeps board A7 (`#163`) and `#262`'s note open, and
means the three `grant_*` tools are deployed and will refuse every caller. Documents reconciled:
root `CLAUDE.md` deploy block, `CLAUDE.md` §3 (this package) in both the tool-reachability and
production-verification paragraphs, and `admin/NEXT-SESSION.md`.

### Corrected — `#204`'s diagnosis, twice in one session

First recorded as cause 1 (row missing), inferred from run `32047334123` applying `20260812000000`.
That inference does not hold once `#295` is known: the run attests to the stale 12-migration set only.
And this package's own `admin/NEXT-SESSION.md`, from the 2026-08-14 prod copy-down, states the row
**is** present in prod from a hand-insert — so the 08-17 apply hit an existing row with `DO NOTHING`
and plausibly wrote nothing. Cause 2 is now the more likely of the two, and `#204` stands unresolved
with the fix unchanged: set the roles on HQ `/admin`, no deploy, effective within the 60s
`CACHE_TTL_MS`.

---

## 2026-08-17

### Changed — committed artifacts store LANGUAGE ONLY; a figure is a slot filled live, or the answer is rejected

Work package `#275`. The direction change: **the corpus stores prose, and every figure with a live
source is a `{{slot}}` filled from the `query_*` call that owns it.** `pipeline.ts` will not return
slotted text as an `answer`, so an unfilled figure is a visible hole rather than a stale number that
reads as finished.

**Why the previous state was not enough.** `figures.ts` already carried the policy — "do not publish
any figure until the paired `query_*` call confirms it" — and it was advisory in the one way that
mattered: the frozen figure sat inside the stored sentence. Skipping the verification step produced a
publishable-looking answer. The cost is in `figures.ts`' own header: the wage aggregate drifted
~$1,500 every four days, and the filed `$350,268` was `$362,030.26` live within a week.

**What landed.**

- **`packages/grants/src/slots.ts`** (new) — the `{{slot_id}}` syntax, `FIGURE_SLOTS` (39 slots, each
  naming the `FIGURE_CHECKS` key that fills it), and the two registers below. Also
  `needsManualFigureCheck`, which replaces `containsNumericClaim` as the trigger for the
  "⚠ carries figures" warning.
- **`kb_launchpad.json` scrubbed** — 56 replacements across 25 of the 29 slots. `high`-severity
  literal-figure violations: 25 slots before, **zero** after.
- **Two new statuses**, `needs_live_figures` (actor `llm`) and `needs_application_figures` (actor
  `staff`), plus `figure_slots` and `figure_template` on `AnswerPlan`. The template is deliberately
  not called `answer`: a caller that treated it as one would paste `{{wages_total}}` into a portal.
- **A `fill_figures` handback task** with `FILL_FIGURE_RULES` in `handback.ts`.
- **Three integrity checks** in `data.ts`: `stored_literal_figure` (high), `figure_slot_unknown`
  (high), `figure_slot_unresolved` (high), plus `stored_figure_unsourced` (medium — the debt register).
- **A resize guardrail**, `ResizeNote: 'slots_dropped'` — a rewrite that loses a slot is rejected the
  way an invented figure is. Dropping a *figure* is allowed; dropping the *requirement to fetch one*
  is not.
- **`slots.test.ts`** (new, 20 cases). Two of them guard bugs this change actually hit: a regex
  exemption that matches nothing, and `/g` regex `lastIndex` leaking across calls.

**Two registers, because a two-bucket rule does not survive the real corpus.**

`IMMUTABLE_FIGURES` exempts *phrases*, each with its reason. A blanket "no digits in stored prose"
rule deletes the organisation's own name: `21` is **Building 21** in 15 of 29 slots, `101` is
**Launchpad 101**, and `501(c)(3)`/`47-2514219`/`990`/`801 Market Street`/`19107` are legal and postal
identifiers. Exemptions are keyed on phrases, not tokens, because `90%` means three different things
in this corpus — the low-income share (live), the pathway-interest split (unsourced), and the
Pennsylvania EITC credit rate (statutory).

`FIGURE_DEBT` holds what neither bucket can honestly take: figures that **drift and have no live
source**. `1,000+ reached through outreach`, `30+ ZIP codes`, `roughly 30 volunteers`. Slotting them
would make those slots permanently unfillable, which teaches a reader to ignore unfilled slots and
destroys the mechanism; allowlisting them would assert they are stable, which is false. They stay
literal and stay reported at `medium`, each with what would settle it.

**Corrections this turned up, all of them in `figures.ts`:**

- **`annual_budget`, `revenue_mix` and `inc_client_work_booked` named a tool that cannot answer them.**
  All three said `get_finance_brief`, reasoning that `query_finances` "may be denied by the role ACL" —
  which traded a tool that might be refused for one that returns no income or expense total at all
  (verified: it returns aplos fund rows, an account *count*, recent transactions, fund balances and
  recent gifts). Retargeted to `query_finances {query_type: 'annual'}`; the ACL fallback in
  `buildFigureWorkOrder().blocked` was also telling callers to fall back to `get_finance_brief` and now
  says to leave the slot unfilled. `admin/DECISIONS.md` §5 stated the same wrong mapping and is fixed.
  **This workstream had already observed it and left it in place.** Raised by a peer session on
  2026-08-17 — but `docs/runs/2026-08-11/filled/FIGURE-LEDGER.md:16` recorded the same thing six days
  earlier ("Not returned… the call succeeded and carries no income or expense total") and filed
  `[DATA UNAVAILABLE]` against it, and three filled applications in that run say so too. The finding
  was written down as an *outcome of one run* rather than as a *defect in the check*, so nothing
  changed and the next caller was sent to the same dead tool. Worth generalising: a `[DATA UNAVAILABLE]`
  that recurs is a bug report about the work order, not a property of the data.

  **It was four checks, not one, and the ledger had already found the answers too.** `annual_budget`,
  `inc_client_work_booked`, `staff_count` and `competency_growth` were all recorded `[DATA UNAVAILABLE]`
  or `PARTIAL` on 2026-08-11 and all four were independently rediscovered on 2026-08-17. Worse, the
  ledger's own **2026-08-14 re-source section** (work package `#216`) had already established what
  answers them — `query_finances` returning Total Income/Expense actuals — three days before either
  session "found" it. Two checks were corrected a second time from that section rather than from our own
  calls: `inc_client_work_booked` now names
  `query_finances {query_type: 'fund_balances', contains: 'Total Income'}`, since the ledger found the
  `launchpad_inc` fund column carrying $305,000.00 and marked it PARTIAL because fund income is not
  bookings; and `phase_costs`' population now states that **the tab's shape is not the KB sentence's
  shape** — it breaks out `hs` and `liftoff` against `total_launchpad`, so `{{cost_shared_admin}}` is a
  residual to compute rather than a column to read.

  The same section also shows a gap closing on its own: `phase_costs` returned 0 records on 2026-08-11
  and 163 rows on 2026-08-14, once the sheets sync populated the tab. A prose ledger cannot tell you
  that a recorded gap has gone stale, which is the argument for a checked register over a document.
- **`staff_count`'s claim said the KB states "15 staff / 9 staff"** and sent a reviewer to reconcile two
  headcounts. There is one: 9 full-time, 1 part-time. The `15` is "**15+ years** in education and
  workforce development" — the Executive Director's experience.
- **`phase_costs` mislabelled overhead as a phase.** Its claim reads "$519K / $455K / $362K per phase";
  `kb.financials` reads $519,000 for Launchpad 101, $455,000 for LiftOff, and $362,000 in *shared
  administrative cost*. The slot is `cost_shared_admin`, not a third phase.
- **The `phase_budget_summary` warning was wrong in both halves.** The header comment said three prompt
  files still used the invalid value and that it "silently returns zero rows". A peer session fixed all
  five occurrences and verified it fails loudly with `invalid_enum_value`. That inverts the risk: a
  loud rejection is the safe failure, and what it actually broke was a board report erroring out at the
  phase-cost step. Not re-verified here.
- **`FigureCheck` gained a required `population` field**, and this is the one to read if you only read
  one. `args` is fixed at authoring time; the correct cut depends on the question. `students_served_total`
  carries `query_type: 'total'` — every enrollment record ever — and three funders in the current batch
  asked how many were served *in the past twelve months*. Filling from the default gives a live,
  correctly-dated, **wrong** number with nothing flagging it, which is worse than a stale one because
  staleness has a warning attached. The population is now stated beside every call, and
  `FILL_FIGURE_RULES` says that a mismatch means the stored sentence does not answer the question —
  not that it should be filled with a different cut. Raised by a peer session; the
  question-shape-to-cut catalogue is at `.claude/skills/grant-writing/references/figure-cuts.md`.

**What this means for an existing clone.** No migration, no schema change; the seed JSON and the
library changed together. Two behavioural consequences worth knowing:

1. **`grant_build_draft` now reports far more outstanding model work**, because most stored answers
   need a fill step before they are answers. On `aug7_truist`: 12 of 17 questions are
   `needs_live_figures`. That is the intended reading of "figures are fetched live", not a regression.
2. **The resize and expand paths are largely unreachable from `grant_build_draft`** on the current
   fixtures, since the gate precedes every length branch. They are reached by passing *filled* text to
   `grant_resize_answer`, which is what the fill handback's `verify_with` instructs. Two
   `pipeline.test.ts` cases were rewritten to assert that sequencing rather than the old ordering.

**Also recorded, not verified here** (reported by a peer session, both in the same family):
`query_enrollment {query_type: 'active_during'}` appears to match only records with a non-null
`end_date`, silently dropping every In Progress record — OpenProject `#278`, and the
`enrollment_by_phase` note now points at it instead of recommending the call. And
`query_competency {query_type: 'scores'}` truncates at 1000 rows against ~2346 in the table, so an
org-wide competency figure from a single call is a partial slice; that is stated in the
`competency_growth` population.

### Fixed — `pyRound` now rounds half-to-even, because the tie case it argued was unreachable is not

Work package `#258`. `packages/grants/src/py.ts` implemented Python's `round(x, ndigits)` as
`Number(value.toFixed(ndigits))`, justified by an argument in its own doc comment: an exact half-way
tie at 3 decimals needs a denominator of 5⁴, no binary double can represent that, so half-up and
half-even can never disagree.

**The argument was inverted.** A tie needs 5⁴ to divide the *numerator* of `n / 10⁴`, and that is
precisely what makes it representable. There are eight exact ties in [0, 1] at 3 decimals — the odd
multiples of 1/16 — and CPython 3.14.6 disagrees with `toFixed` on four of them:

| value | `round(v, 3)` | `(v).toFixed(3)` |
|---|---|---|
| 0.0625 | 0.062 | 0.063 |
| 0.3125 | 0.312 | 0.313 |
| 0.5625 | 0.562 | 0.563 |
| 0.8125 | 0.812 | 0.813 |

`matchQuestion` reports `pyRound(bestScore, 3)` as `confidence`, and the score is
`0.7 * jaccard + 0.3 * sequenceRatio`, so hitting one of the eight is remote — but "remote" is not a
parity contract, and the comment claimed impossible. The rule is now implemented rather than argued:
the double is decomposed into `m · 2^e`, the remainder compared against half the divisor in `BigInt`,
and an exact tie broken to the even quotient. The result is assembled as a decimal string so the
final conversion lands on the nearest double to the rounded decimal, as Python's does.

**No recorded confidence moved.** The `matchQuestion` prototype-parity suite, which reproduces every
recorded `MatchResult` field for field, passes unchanged — so this is a closed hole rather than a
changed match. Nine cases added to `py.test.ts` pin all eight ties plus the sign and zero paths.

### Fixed — `query_attendance` echoed the caller's `limit` instead of the clamp it applied

Work package `#257`. `apps/mcp-server/src/tools/query-attendance.ts` builds its `filters_applied`
echo from the raw input, but both row-returning branches clamp: `events` at 500, `by_student` at
1000. A caller sending `limit: 5000` was told `filters_applied.limit: 5000` while 500 rows came back
and `truncated: true` sat in the same envelope contradicting it. The echo now reports the effective
limit, and only when the caller actually sent one, so an absent `limit` still reads as absent rather
than as the branch default. Case added to `query-attendance-filters.test.ts`.

### Changed — `.gitignore` no longer hides the project skills from every other clone

Work package `#259`. `.gitignore` ignored all of `.claude/` as "local Claude Code config", but four
of the skills beneath it describe *this repository* and belong in it: `add-mcp-tool` (the
`tool_permissions` migration and admin-category steps a new tool needs before any role can reach it),
`implement-connector` (the `runSync` shape and the never-TRUNCATE rule), and `grant-writing` /
`grant-writing-mcp`. They could never reach `main`, so only this machine had them — including the
two whose whole content is a procedure the root `CLAUDE.md` says must be followed.

Now `.claude/*` with a `!.claude/skills/` exception, so `settings.local.json` and anything else
machine-local stays ignored. 108 KiB, scanned for credentials before committing. **If you have an
existing clone, `git pull` gives you four skills you did not have; nothing you had is removed.**

### Merged — `fix/google-drive-discovery`, so `find_grant_documents` survives the deploy

Work package `#256`, and this was the second of the two pre-merge blockers — the one that was a
**decision** rather than a defect.

`find_grant_documents` and the grant-document catalog were deployed to production on 2026-08-06 **from
that branch**, before `main` became the only deploy branch, and the branch never merged. The build on
`writing/dev` did not register the tool and its Drive connector did not fill the catalog, so **merging
PR #51 would have removed a live production feature with no signal anywhere** — a silent rollback
dressed as a green deploy. Decided: bring the branch in.

**The merge was smaller than "6 commits, ~4,700 lines" suggests.** `git merge-base` puts the two
branches' common ancestor at exactly `0998ca3`, with the six Drive commits sitting directly on top, so
this was a true merge with a shared base rather than a replay — history and SHAs preserved. `merge-tree`
predicted five conflicts, **all in documentation and none in code**: `CLAUDE.md`,
`docs/mcp-server-spec.md`, `docs/setup/README.md`, this file, and `packages/grants/CLAUDE.md`. Both
branches had been editing the same claims in the same files, which is exactly what §1 predicts.

Resolved by reconciling rather than by picking a side. The tool-count claims are the clearest case: HEAD
said 24 with 5 `skill_*` and no Drive tool, the branch said 24 with 4 `skill_*` and the Drive tool, and
**both were right about themselves and wrong about the merge.** The answer is **25**, and each of those
files now carries the `grep` that settles it rather than the number alone.

**One thing the resolution surfaced that is worth stating on its own.** Production's 21 tools are **not a
subset** of this branch's 25. `main` lacks the three `grant_*` tools and the fifth `skill_*` tool, and it
*has* `find_grant_documents`. Any reasoning of the form "the branch is ahead, so merging is additive" was
false for this pair, and the shape is worth checking for before assuming otherwise.

**Two migrations arrived already applied in production.** `20260806000000_add_grant_documents_catalog`
and `20260806000100_add_find_grant_documents_permission` were deployed from that branch by hand.
`prisma migrate deploy` applied both to the local prod copy without a checksum complaint, which is the
signal that matters now that #220 makes the deploy job apply migrations for real. Note this also settles
a correction recorded on `#163`: that ticket's text said
`20260806000100_add_find_grant_documents_permission` "does not exist in the repo". It does now.

**One new drift entry, fixed the same way as #254.** The catalog migration hand-wrote its index as
`grant_documents_archive_ext_idx`, while `schema.prisma`'s `@@index([archiveOnly, externalReference])`
derives `grant_documents_archive_only_external_reference_idx` — so `migrate diff` reported a RenameIndex
on every run. `20260817000100_rename_grant_documents_archive_ext_index` closes it: a new migration, not
an edit, because `20260806000000` is applied in production. A rename is metadata only — no index is
rebuilt and no query plan changes. **The diff is back to the `student_employment` residue alone.**

Also removed two duplicate `.gitignore` entries the auto-merge produced: a second, unanchored `data/`
(which would have re-broken the fix below) and a bare `.opencode` alongside the existing `.opencode/`.

**Counts after the merge:** `pnpm test` **470 across 23 files, 0 skipped**. `packages/grants` alone is
**290 in 10**. **25 tools**, **19 migrations**. `pnpm -r build`, `pnpm -r typecheck` and `pnpm lint` all
clean across fifteen packages.

---

Pre-merge pass on `writing/dev` before it goes to `main`, from a code review of the branch. Parent work
package `#249`. Gates were already green — `pnpm -r typecheck` clean, `pnpm lint` clean, `pnpm test`
373/373 — so none of this was caught by CI, and that is the common thread: every item below is a case
where the code and a document disagreed, and the document was the one being believed.

### Fixed — `deploy.yml`'s `migrate` job now applies migrations

Work package `#220`, recorded as a correction on 2026-08-14 (below) and now closed in code.
`.github/workflows/deploy.yml`'s ECS one-off task runs `prisma migrate deploy` followed by
`prisma migrate status`, in place of the read-only `SELECT` that applied nothing.

Two details that took verifying and are worth not re-deriving:

- **`prisma.config.ts` resolves `schema` and `migrations.path` relative to itself, not to the process
  cwd.** So `--config prisma.config.ts` from `/workspace` is correct regardless of the image's
  `WORKDIR` (which is `/workspace/apps/mcp-server`). Confirmed by running the same command from
  `packages/db` with `--config ../../prisma.config.ts`.
- **The image already carries everything needed.** `prisma` is a devDependency of `@lp-ai/lib-db` and
  the runner stage copies `node_modules` wholesale from the builder; `packages/db/prisma/migrations`
  and `prisma.config.ts` are both copied; `DATABASE_URL` is already injected from Secrets Manager.
  Nothing about the Dockerfile or the task definition had to change.

**The applied-migration list is now fetched from CloudWatch unconditionally**, not only on failure.
That alone is why the old job's uselessness went unnoticed for as long as it did: a successful run left
no record anywhere outside CloudWatch, so `#163` could not be answered from a workflow log.

### Fixed — `20260610200000_create_student_postsecondary` is restored to the branch

**Production had a migration this repository did not contain.** `20260610200000` exists only on
`origin/feat/query-postsecondary-tool` (commit `129903c`), whose message records that it was applied to
RDS by hand via a one-off ECS task. The local prod copy shows it: 15 rows in `_prisma_migrations`
against 14 migration directories.

`prisma migrate deploy` tolerates that asymmetry — verified, it does not error, which is why nothing
surfaced it — but the repository's migration history no longer described how production was built. The
file is restored verbatim, and its checksum matches the recorded row (verified: `migrate deploy` accepts
it and reports 15 migrations found).

It also happens to be the Prisma-generated DDL, with none of the drift in the next entry.

### Fixed — `20260803000000` no longer drifts from `schema.prisma`, and its FK is no longer unusable

Work package `#254`. That migration's header predicted **one** persistent `migrate diff` entry. Measured
with `prisma migrate diff --from-migrations … --to-schema …` against a shadow database, the real answer
was **eight statements across six objects**. Two defects:

1. It wrote native `uuid` primary keys with `gen_random_uuid()`, and a DB-side default on
   `aws_resource_jobs.updated_at`. `schema.prisma` declares `String @default(uuid())` — a client-side
   default, so `text` with no DB default — and `@updatedAt`, which Prisma generates with no default at
   all. Any developer running `prisma migrate dev` on a migrate-built database got a drift prompt
   offering to reset.
2. The FK on `student_postsecondary.student_number` was `ON DELETE SET NULL` **on a column the same
   file declares `NOT NULL`**. Deleting a `students` row with postsecondary rows raised a not-null
   violation from inside the FK trigger rather than a clean referential error.

Both corrected. `20260817000000_align_postsecondary_fk_with_schema` is added for the FK created by
`20260610200000` (`NO ACTION`, where Prisma generates `RESTRICT`) — a new migration rather than an edit,
because that file's checksum is recorded in production and editing an applied migration is what
`migrate deploy` refuses on principle.

**The diff is now down to `student_employment` alone**, which is the only entry that should persist: that
table is live in production with data, it was created by `20260527000000` which is applied there, and
closing it means dropping and recreating a live primary key. `CLAUDE.md` §3's "known schema drift"
paragraph is updated accordingly — it named three tables and should now name one.

**If you have an existing local clone:** `20260803000000`'s checksum changed. `pnpm db:migrate` will
refuse with a modified-migration error. Either recompute the recorded checksum —

```bash
NEW=$(sha256sum packages/db/prisma/migrations/20260803000000_*/migration.sql | cut -d' ' -f1)
docker exec lp-internal-postgres psql -U lpapp -d lpinternal -c \
  "UPDATE _prisma_migrations SET checksum='$NEW' WHERE migration_name LIKE '20260803000000%';"
pnpm db:migrate
```

— or rebuild the database from scratch. Both migrations are guarded and idempotent, so re-applying
changes nothing. **Production is unaffected**: neither `20260803000000` nor `20260817000000` has ever
been applied there.

### Fixed — `grant_build_draft` hid three statuses from both work lists

Work package `#250`. `your_tasks` and `staff_actions` were built from two hand-written
`Record<string, string>` maps and the builder iterated **the map's** keys, so a status absent from both
maps counted toward `by_actor` and appeared in neither list. Three were missing: `fetch_figure` and
`needs_expand` (`llm`), and `figure_definitional` (`staff`).

Verified before the fix: `grant_build_draft {form_id:'hamilton_loi_2025'}` returned `by_actor.llm = 1`
with `your_tasks: []`. `jevs_c2l_2024` reported 2 of its 3 staff items, hiding a definitional figure
conflict from the people meant to resolve it — the one status where a wrong number reaches a funder.

Now one map keyed on `AnswerStatus`, split by `STATUS_ACTOR` at read time rather than by hand, so the
compiler rejects a new status with no next step and the split cannot disagree with the pipeline's own
routing. Pinned by a conservation law over all ten stored fixtures rather than by naming the three
statuses, because the failure is structural.

### Fixed — `grant_resize_answer` accepted a whitespace-only rewrite as a faithful resize

Work package `#251`. The verify path treated any non-`undefined` `rewrite` as a candidate, and every
check downstream waves a blank one through: it measures 0 units so it fits every limit, and it states no
figure so nothing is invented. A 95-word answer with figures plus `rewrite: '   '` came back
`notes: 'fits'`, `accepted: true`, `text: '   '`, with the action line "Accepted: 0/10 words, down from
95, and every figure traces to the source."

`grant-resize-answer.ts` already guarded exactly this on `text`, and its comment named the failure mode.
The guard was never applied to the other input. Now guarded in both places — the tool boundary and
`resizeAnswer` itself, which is a public export — with a new `ResizeNote`, `rewrite_empty`, so the caller
learns its rewrite was discarded rather than silently ignored.

### Fixed — the `needs_expand` guard now fires on the narrative path

Work package `#252`, and this one falsifies a claim in `CLAUDE.md` §4 item 8. That item says the guard
"makes this visible at draft time rather than silent". It did not: the guard was wired only into the
structured-value branch, which left unguarded the case it was written about.

The knowledge base's own note says its answers are "the LONGEST canonical version" and the pipeline
resizes *down*, so a thin slot against a roomy field is the common shape. Measured against the real seed:
`kb.staff_bios` 110/600 words, `kb.history` 119/500, `kb.target_population` 86/600, `kb.dei` 122/600,
`kb.evaluation` 116/600 — every one reporting `fits` / `actor: none` while `underfillsProseField` returned
`true`.

The narrative path carries **no anchor**, and that is not cosmetic: there is no separately confirmed short
value, so `EXPAND_RULES`' "the confirmed value MUST appear unchanged" rule has no referent, and stating it
anyway asks a model to preserve verbatim something it would have to invent first — on the one task in this
layer most likely to produce invented statistics. `EXPAND_RULES_NO_ANCHOR` is the same set minus that
rule, expressed by reference so the two cannot drift, and the `expand` instruction has a second wording
for the unanchored case.

### Fixed — `renderMarkdown` mislabelled an expand handback and dropped `anchor_value`

Work package `#253`. The collapsed-block heading was a ternary on `task === 'resize'`, so everything else
fell through to the `derive_short_value` wording: an `expand` handback rendered as "Source material to
derive the value from — NOT the answer to this field", which is the opposite instruction.

Worse, `anchor_value` was emitted nowhere. A `needs_expand` result deliberately withholds the confirmed
value from `answer`, so the rendered artifact told the reviewer to keep a value verbatim while that value
appeared nowhere in the document. It is now rendered first and outside the collapsed block. The heading is
a `switch` over `HandbackTask`, so the compiler catches the next task added.

### Fixed — a sentence-limit truncation preview could come back unmarked and byte-identical

Work package `#255`. `pyCountSentences` breaks on `[.!?]` alone and `pySplitSentences` breaks on `[.!?]`
followed by whitespace — a documented, deliberate prototype divergence that neither rule may move. Where
the only over-limit break is a decimal point or an abbreviation, the splitter sees one chunk and the
counter sees two: nothing was dropped, so the old `kept.length === chunks.length` test said "not cut" and
returned the preview **byte-identical to the over-limit input, with no `…`**.

`measure` calls `truncatePreview` only when the text is over the limit, so an unmarked identical preview
lies in the one direction that matters — it reads as text already trimmed to fit, on a field where
overrunning the cap means rejection. Verified on `'We spent 1.5 million dollars.'` at `max: 1`, and
`cover.project_summary` and `organization.mission` both carry 3-sentence limits.

The cut is now marked whenever the preview does not actually measure within `max`, not only when chunks
were dropped. **The counting rules are unchanged** — the inflated count is prototype parity and is
intended; the unmarked preview was not.

### Fixed — `.gitignore`'s `data/` pattern was unanchored

`data/` matched a directory named `data` at any depth. `git check-ignore` confirmed it swallowing
`apps/hq/app/data/` and `connectors/google-sheets/src/data/`. Nothing lived there, so nothing was lost,
but the next source directory named `data` would have gone uncommitted with no error anywhere. Now
`/data/`.

### Changed — `grant_build_draft`'s `form_id` description no longer risks taking down the tool surface

`listFormIds()` ran at module evaluation to build the `form_id` description, doing a `readdirSync` on
`packages/grants/seed/forms`. An unguarded throw there happens while `make-server.ts` is still importing,
which takes down **all 24 tools** rather than degrading one — the opposite of the lazy-load invariant
`data.ts` documents. It works today only because the Dockerfile copies `packages/` wholesale, and
`.dockerignore` already excludes two `packages/grants/*` paths. Now wrapped, and the description omits the
list rather than the server omitting every tool.

### Verified — counts after this pass

`pnpm test` is **397 across 19 files, 0 skipped** (was 373). `packages/grants` alone is **262 in 9 files**
(was 240). `pnpm -r build`, `pnpm -r typecheck` and `pnpm lint` all clean. `pnpm db:migrate` applies
**16 migrations** (was 14). Tool count unchanged at 24.

**These are the numbers as of this pass, not the current ones.** The Drive merge landed later the same
day and moved every one of them — 470 across 23, 290 in 10, 19 migrations, 25 tools. See the entry above.
Kept as written because a changelog that rewrites its own history stops being a record of what happened.

---

## 2026-08-14

### Corrected — the deploy pipeline does not apply migrations, and every document implying it does was wrong

Work package `#220`, found while investigating `#163`. This is the §5 "correction to a documented
procedure that was wrong" category, which that section calls the most valuable and most often skipped.

**What is actually true.** `.github/workflows/deploy.yml` has a job named `migrate` that all three
service deploys gate on (`needs: [changes, migrate]`). Its ECS one-off task runs exactly one statement:

```sql
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at
```

It prints the list and exits 0. **No migration is applied by any part of the deploy path.** The step is
titled "Run migrations via ECS one-off task" and its inline comment says it "runs each pending
migration's SQL"; both are false. Alternatives ruled out: `infra/ecs/mcp-server-taskdef.json` sets no
`entryPoint` and no `command`, the image `CMD` is `["node", "dist/serve-http.js"]`, no `start*` script in
`apps/mcp-server/package.json` migrates, and `ci.yml` only ever migrates its own service container.

The job's one useful output is discarded: CloudWatch logs are fetched only inside
`if [ "$EXIT_CODE" != "0" ]`. Verified on run `31722645475` — the log contains "Waiting for migration
task to complete...", "Migration task exit code: 0", and nothing else. **So the job can only fail if RDS
is unreachable**; a missing migration passes it every time.

**What this falsifies.** Any reading of the job graph as "migrations are applied before deploy" —
which is the natural reading and, as far as can be told, the intended one. Concretely for this
workstream: merging PR #51 will **not** create the grant `tool_permissions` rows on RDS, and since the
registry fails closed, the three `grant_*` tools would deploy and refuse every caller including admin
with a green deploy and no signal. `CLAUDE.md` §3 already said "production is less verified than local";
it was understating the reason.

**A live symptom probably already exists.** `20260812000000_add_grant_sourcing_evaluation_permission`
merged with PR #48 on 2026-08-12, so `skill_grant_sourcing_evaluation` is registered on `main` with a
permission row that was never applied. **Unverified** — RDS is not reachable from a developer machine
and there is no `aws` CLI, `boto3` or `~/.aws` here. One call from a client that can reach production
settles it, and it is the cheapest check on this page.

**Two further errors in `#163`'s own text**, corrected in its comments rather than here: the migration
it instructs you to carry, `20260806000100_add_find_grant_documents_permission`, **does not exist**; and
**no migration anywhere inserts `find_grant_documents`**, though the row is present in the local
database — so local state holds a `tool_permissions` row that no migration would reproduce on RDS.

> **Both of those stopped being true on 2026-08-17.** `fix/google-drive-discovery` merged in (`#256`) and
> brought that exact migration with it, so it now exists in the repo and does insert the row. The
> paragraph above is left as the record of what was true on 2026-08-14; do not act on it.

### Removed — `query_hours` and the hours ingestion, withdrawn from this branch

Tool surface **25 → 24**; the google-sheets connector **13 → 12 spreadsheets**. Recorded here because
it changes the tool surface, a connector's scope, the schema, the migration set, and the env contract —
five of the six categories §5 says qualify.

**Why.** It is not grant-writing work and it was not needed for this PR. Hours are handled in a separate
project at `~/Projects/hours`, which has its own store and its own MCP server — the same one that
records time against these work packages. Keeping a second, read-only mirror of the same spreadsheet
inside the LP platform meant two things claiming the same fact.

**What came out.** `apps/mcp-server/src/tools/query-hours.ts` and its registration;
`connectors/google-sheets/src/sync-hours.ts` and its wiring, export, table declaration and `sync_runs`
notes field; the `HourLog` model; migrations `20260812000000_add_hour_logs` and
`20260812100000_add_query_hours_permission`; the seed's three `HOUR_LOGS` rows and their teardown;
`GOOGLE_SHEETS_HOURS_ID` from `packages/config/src/schema.ts` and `.env.example`; the four
`query_hours` integration cases; and the `hour_logs` / `query_hours` sections of
`docs/mcp-server-spec.md`, `docs/database-schema.md`, `docs/data-sources/google-sheets-connector.md`,
`docs/user-guides/using-the-mcp-server.md` and `docs/runbooks/mcp-silent-empty-results.md`.

**What deliberately stayed.** `41b16ef` mixed two concerns, and only one was withdrawn. **The OpenProject
work-tracking mandate stays** — the rule at the top of the root `CLAUDE.md`, and `OPENPROJECT_URL` /
`OPENPROJECT_PROJECT_ID` / `OPENPROJECT_API_KEY` in `.env.example`. A plain `git revert 41b16ef` would
have taken the mandate with it; this was done hunk by hunk instead.

**If you have a local clone**, the two migrations were already applied. Drop the table, delete the
permission row, and remove both `_prisma_migrations` rows, or `migrate status` reports applied
migrations whose files no longer exist:

```sql
DROP TABLE IF EXISTS "hour_logs";
DELETE FROM "tool_permissions" WHERE tool_name = 'query_hours';
DELETE FROM _prisma_migrations
 WHERE migration_name IN ('20260812000000_add_hour_logs','20260812100000_add_query_hours_permission');
```

Verified after: 14 migrations found, "Database schema is up to date", and `prisma migrate diff` shows
only the three documented `uuid` entries — **zero mentions of `hour_logs` anywhere in the diff**.

**Re-gated after the removal**, not assumed: `pnpm -r build` and `pnpm -r typecheck` clean, `pnpm test`
**373 passed across 19 files, zero skipped** — 377 minus exactly the four `query_hours` integration
cases, which is the arithmetic that says nothing else broke. Tool count 24 by the §6 command.

**Preserved, not deleted.** `41b16ef` is on the **`feat/hours-ingestion`** branch, pushed, so re-landing
is a cherry-pick. Two things to know if that happens: the cherry-pick must **drop** the `CLAUDE.md` and
`.env.example` OpenProject hunks, since those are already on `main`'s side of the history; and the
direction conflict recorded on work package **#180** still stands — **F4 (#88) retires the shared Hours
spreadsheet** in favour of logging against work packages, so reading that sheet may never be worth
re-landing. `CLAUDE.md` §4 item 15 carries this.

### Verified — the merged finance and filter fixes close three gaps the register listed as open

OpenProject `#216`. PRs **#49** (finance tab mapping) and **#50** (`query_enrollment` filters) merged
and deployed on 2026-08-13, at 15:25 and 16:28. Every gap they were supposed to close was re-tested
against production on 2026-08-14 and the figures recorded, because "the fix merged" and "the figure is
answerable" are different claims and this workstream had been burned by asserting the second from the
first.

**Closed — `annual_budget` (§1.1).** `query_finances(budget_actuals, tab_name: "YTD Budget vs Actual")`
returns Total Income actuals **$1,572,906.30** against FY budget $1,655,155.00, and Total Expense
actuals **$1,734,075.87** against FY budget $1,607,803.87, plus category totals. Note `budget_actuals`
spans two tabs and the prior-month rows are all zero — **split on `tab_name` before reading**.

**Closed — `phase_costs` (§1.2).** `query_finances(phase_budget_dashboard)` matches
`phase_dashboard:2025 actuals` with no override, 163 rows. Total Expense: `total_launchpad` **$1,532,790**,
`hs` **$459,805**, `liftoff` **$446,220**.

**Closed — the dropped-filter defect (§8.1).** `query_enrollment(by_phase, phase: "Lightspeed")` scopes
correctly and echoes `filters_applied`. Lightspeed live: 15 Completed, 12 In Progress, 1 Dropped.

**Two KB claims did not survive the check, and this is the material part.** `$1.34M FY2025 expenses`
matches **no** total the tool returns; the nearest figure is Total *Administrative* Expenses at
$1,394,055.02, a narrower measure. And the KB's `$519K / $455K / $362K` per-phase split has no
counterpart in the data, which carries **two** phase columns rather than three. Neither is a tool defect
now — both are staff questions. **Nor can any of these figures be attributed to a fiscal year**: the YTD
tab returns `period: ""` with no FY label (board `grant-a54`). Answered is not filable.

**New query types the register never saw.** `query_finances` gained ~15, and two answer recorded gaps:
`dev_grants_tracker` (96 funder records with `lifetime_total`, `received_to_date`, lifecycle) is a live
source for `eligibility.prior_funding`, previously a `STRUCTURED_VALUE_DEBT` entry; `dev_launchpad_pipeline`
(59 rows) gives prior asks by funder and fiscal year. `q3_2026_actuals*` and `phase_actuals_2025_*` carry
a period in their names and are the likely answer to the fiscal-year ambiguity — **not yet probed**.

**Unchanged, and said plainly:** `query_competency(scores)` still returns exactly `record_count: 1000`
with no `total_matching` / `truncated`; `search_documents` for a staff roster still returns 0 results.

### Found — a silent empty result is still reachable in production, because the fix is not merged

`query_enrollment(by_phase, current_phase: "Zzzznotaphase")` returns
`{"breakdown":[],"filters_applied":{...}}` — no error. **This is not a new defect and must not be
re-diagnosed as one.** The `no_records` guard is at
`apps/mcp-server/src/tools/query-enrollment.ts:217-224` on `writing/dev`, tested, and among 44 commits
`main` does not have. Production runs #49 and #50 only.

**How to tell which build you are querying: read the tool's live description, not its response.** The
deployed `query_enrollment` description ends at `filters_ignored`; this branch's continues into the
`no_records` contract and names `E` and `N`. The same technique confirmed #49 is present, because the
deployed `query_finances` already documents `tab_names_matched` and `truncated`. Recorded as
`docs/INFORMATION-GAPS.md` §8.4 and `CLAUDE.md` §4 item 14. Until it merges, prefer the `phase` enum over
free-text `current_phase`, and read an empty `breakdown` from a value-based filter as *unknown*, not zero.

### Verified — the full gate is green on this branch

Run 2026-08-14 before opening the PR: `pnpm -r build` clean across all packages **including `apps/hq`**,
which is the only one whose build runs ESLint; `pnpm -r typecheck` clean across all fourteen;
`pnpm test` **377 passed across 19 files, zero skipped**, in 15.4s, with the live-DB suites executing
rather than skipping. `packages/grants` alone is 240 in 9. Tool surface was **25** on this branch against
**21** on `main` at the time of this run; `query_hours` was withdrawn later the same day, so the figures
below this entry are 24 and the three `grant_*` tools. Re-gated after the withdrawal — see the entry
above. The §6 permission
check is empty, so nothing fails closed locally — **but the grant rows are still unverified on RDS
(A7, #163), and the registry fails closed, so those three tools will refuse every caller in production
until that migration is applied.**

---

## 2026-08-13

### Changed — three data tools now error where they returned zero, which changes what a drafting run sees

OpenProject `#209` and `#210`, continuing `#207`. Recorded here because the grant layer is a
*consumer* of these tools: `docs/runs/2026-08-11/filled/FIGURE-LEDGER.md` sources live figures from
`query_enrollment`, `query_students` and `query_attendance`, and this changes their contract.

**The rule, now applied by four tools rather than one.** A filter value absent from its own column's
distinct values returns `toolError('no_records', ...)` naming the field, the `table.column` and the
values present. A combination of values that are each present but co-occur in no row still returns an
honest empty result. `#207` did `query_enrollment`; `#210` adds `query_students` (five filters),
`query_postsecondary` (two) and `query_certifications` (`phase`).

**What this means for a figure check.** A drafting run that reads an empty result as "Launchpad has no
such data" was already the failure mode this guards against — but the reverse is now possible too: a
run that treats *any* non-empty `error` envelope as a tool outage will now see one where it used to
see `{ total: 0 }`. `enrollment_status: 'Active'` is the live example. The column holds `E` and `N`,
so that value cannot match; the error names the codes, so the retry costs one round trip instead of a
wrong figure. Prefer retrying on `no_records` over aborting.

**`query_attendance` was worse than a zero.** `#209`: it declared `current_phase` and read it nowhere,
so a phase-scoped attendance rate was the org-wide rate, reported as though scoped. Any phase-scoped
attendance figure previously quoted from this tool is wrong by construction. Nothing records which
figures went out; if one reached a funder, re-pulling it is separate work. The tool now also pages
`by_student` on `limit` and echoes `filters_applied` / `filters_ignored` on every response.

Full reasoning, including why each domain is read **unscoped** and what was deliberately left out (the
substring filters), is in
[`docs/runbooks/mcp-silent-empty-results.md`](../../docs/runbooks/mcp-silent-empty-results.md) fixes 7
and 8.

### Fixed — `pnpm -r build` passes, so the deploy path is no longer blocked

OpenProject `#213`. `apps/hq` had 39 type-aware lint errors and `next build` fails on lint errors, so
`pnpm -r build` failed — which is `ci.yml`'s third step and `deploy.yml`'s gate. Because
`@eslint/js` and `typescript-eslint` are in this branch's root `package.json` and not `main`'s, the
merge that brings this workstream to `main` would have turned CI red in files it never touched.

The caveat in [`CLAUDE.md`](CLAUDE.md) that called this "pre-existing lint-rollout work" is corrected
there: ten of the 39 were a missing `noUncheckedIndexedAccess` in `apps/hq/tsconfig.json` making
load-bearing `?.` guards look redundant, not dead code.

**Still outstanding, and not build-failing:** `pnpm exec eslint .` reports 402 errors repo-wide, two
of them in `packages/grants`. Only `apps/hq` fails CI, because only its build runs ESLint.

---

## 2026-08-12

### Fixed — four of the seed integrity checks could not catch what they were written to catch

A code review of the 2026-08-11 seed-audit checks found each of them silently ineffective on the
*next* edit rather than wrong today: the live report is empty before and after, and it stayed empty
under the stricter versions, so the seed really is clean. What changed is that the checks now fire.

- **`figures.ts` `CLAIM_CURRENCY` swallowed the next word's leading capital.** The magnitude suffix
  was `\s?[MKB]?`, so `$500,000 Kresge grant` tokenized to `$500,000 K` — a token no KB text
  contains, which retired `figure_claim_uncovered` for that claim entirely instead of reporting
  anything. Suffix is now `(?:\s?[MKB](?![A-Za-z]))?`.
- **`figures.ts` `statesFigure` accepted decimal and magnitude continuations**, contradicting its own
  docstring: `statesFigure('about $20.50 per hour', '$20')` and `statesFigure('$1.34M', '$1.34')` both
  returned `true`, so a slot quoting an unrelated `$20.50/hr` was reported as restating the `~$20/hr`
  wage claim. The lookahead now rejects all three continuations (`\.\d`, not a bare `.`, so a token
  ending a sentence still matches).
- **`data.ts` `figure_claim_uncovered` scanned only `answer.text`**, never `answer.structured[*].value`
  — though a structured value is the whole answer to its question. The motivating real case
  (`kb.eligibility`, added 2026-08-11) fired only because its prose also quotes `$1.34M`; a figure
  restated *only* in a structured value went uncovered. Both are scanned now.
- **`data.ts` `variant_shared_across_questions` used its own normalization**, `[^a-z0-9 ] -> ''`,
  where `matcher.ts:81` uses `[^a-z0-9 ]+ -> ' '`. `"Program/project description"` and
  `"Program project description"` tie at 1.0 in the matcher and were different keys here — the exact
  confident-wrong-match class the check exists for. It now keys on `matcher.normalize()` and indexes
  canonicals alongside variants, because `candidatesFor()` scores canonicals as candidates too. **No
  new live ties**: still the three in `ACKNOWLEDGED_TIES`.
- **`data.ts` `structured_value_missing` read `structured: {}` as "carries structured values"**, so
  emptying a slot's map would have flagged every short-value question routed there. Guard is now on
  key count.
- **`figures.ts` `inc_client_work_booked`'s claim said `$50-80K`**, which tokenizes to a bare `$50` —
  two orders of magnitude off and generic enough to match unrelated prose. Written out as
  `$50K-$80K`. The extractor still does not understand a range with a shared trailing suffix; write
  ranges out.

`data.test.ts` gains 10 cases (39 → 49), one per fix plus direct coverage of `extractCurrencyClaims`
and `statesFigure`, which had no unit tests of their own. Suite: `packages/grants` **240 in 9 files**,
repository **294 in 14**, `pnpm -r typecheck` clean.

### Verified — every gap in `docs/INFORMATION-GAPS.md` re-tested live, and the finance gaps are not data gaps

Each claim in the gap register was re-run against the live production MCP. **The tool defects
reproduced exactly as recorded.** But probing production with `query_finances`' `tab_name` override —
which bypasses the broken map — proved the rows exist:

| Probe | Result |
|---|---|
| `tab_name: "phase_dashboard:2025 actuals"` | real rows — per-phase actuals by account (`account_number`, `total_launchpad`, `liftoff`, `liftoff_pct`, `hs`, `hs_pct`) |
| `tab_name: "Combined Funds"` | real rows — account-level totals across every fund |
| `tab_name: "development:grants tracker"` | real rows — funder records with `lifetime_total`, `received_to_date` |

So §1.1, §1.2 and §8.2 are **casing defects in `query-finances.ts`, not missing organizational data**.
The budget fields that all four drafts in the 2026-08-11 run filed as `[DATA UNAVAILABLE]` are
answerable today. **Re-source them rather than treating them as gaps.** For an annual budget total the
right call is `query_finances(fund_balances)` (the `Combined Funds` tab), not `get_finance_brief` —
that tool genuinely carries no income or expense total and never did; its `period` argument only
labels the response.

Confirmed still broken, unchanged: §8.1 `query_enrollment` filter dropping (`by_phase` with
`current_phase: Lightspeed` + `enrollment_status: Completed` returned the full 301-student,
all-four-phase breakdown), §8.3 `query_competency(scores)` capped at exactly 1000, §2 staff headcount
(`search_documents` → 0 results), §7 routing defects (92 questions, still no `cover.website` and no
determination-year canonical).

### Added — two PRs against `master`

- **PR #49** — `fix/mcp-finance-tab-mapping`, the branch that had sat unmerged since 2026-08-05. Its
  tab map was checked character-for-character against the connectors that write those tabs
  (`connectors/google-sheets/src/sync-phase-budget-dashboard.ts:108-112` and
  `sync-development-crm.ts:21-26`) and matches exactly. Verified: build clean, `pnpm -r typecheck`
  clean across 13 packages, **49/49 tests**, including all 10 `finance-tab-map.test.ts` cases.
- **PR #50** — `fix/query-enrollment-filter-application`, written from scratch; **no branch among the
  44 local and remote refs had ever touched this**. All five non-date filters now apply to all eight
  query types (student columns reach phase-outcome queries through the `student` relation,
  `phase`/`status` reach student-level queries through `phaseOutcomes: { some: ... }`), and every
  response carries `filters_applied` plus `filters_ignored`. Adds `query-enrollment-filters.test.ts`,
  8 cases. Verified: typecheck clean, **56/56 tests**.

Reading `query-enrollment.ts` to fix it showed the defect was **wider than §8.1 recorded**:
`active_during` builds its own `where`, never uses `studentWhere` at all, *and* ignores `status`; and
`total`, `by_cohort`, `by_school`, `by_race` and `by_program_year` all ignore `phase`/`status`. All
eight query types dropped something.

**Neither PR is merged or deployed, so the live tools still misbehave.**

### Fixed — `docs/mcp-server-spec.md` overclaimed on three tools

Corrections landed on the PR branches, not here, since `packages/grants` does not exist on `master`.

- `query_finances` documented `fund`, `category`, `row_type`, `launchpad_only` and `donor` input
  filters, a `tabs_queried` / `launchpad_only` output pair, and a Launchpad-scoping rule keyed on
  `TABS_WITH_LAUNCHPAD_FILTER`. **None of those symbols exist in the file.** Removed; `query_donors`
  serves those lookups. The real inputs are `query_type`, `tab_name`, `period`, `contains`, `limit`.
- `get_finance_brief` claimed "YTD revenue vs. expenses" and "top campaigns" in both its heading and
  its Claude-facing description. Neither is computed. **That overclaim is the direct cause of the
  §1.1 misdiagnosis** — an absent total read as an organizational gap because the spec promised it.
- `query_enrollment`'s `by_student` advertises a "full student-info filter set" (race, gender, zip,
  income and parental-ed ranges, …) and `by_program_year` advertises retention projections. Neither is
  in the code. **Recorded as debt rather than corrected**, per [`CLAUDE.md`](CLAUDE.md) §1 rule 5 —
  closing either is a tool change with its own review.

### Corrected — a "broken `master`" report, withdrawn

Mid-session I reported 8 × TS1362 in `apps/mcp-server/src/tools/query-certifications.ts` as a defect
`master` had picked up from #47, and 9 consequent integration-test failures. **That was wrong.** The
cause was a stale local `packages/db/dist/index.d.ts` dated 2026-08-03, which exports `Prisma` as a
type where `packages/db/src/index.ts:3` exports it as a value; `apps/mcp-server` resolves
`@lp-ai/lib-db` to the built `.d.ts`. After `pnpm --filter @lp-ai/lib-db build`, `master` typechecks
clean and the suite passes. `master` was never broken and no fix is needed.

Recorded because the failure mode generalises, and it is the same one that produced the finance
misdiagnosis in the first place: **`pnpm test` alone would not have caught it, and `pnpm -r typecheck`
reported a stale artifact as a source error.** Rebuild workspace packages before believing a type
error, exactly as you should probe with `tab_name` before believing an empty result.

---

## 2026-08-11

### Added — four integrity checks, closing the seed-audit findings that could be closed mechanically

An audit of `questions.json`, `kb_launchpad.json`, and `FIGURE_CHECKS` against each other. The bank's
structure was sound — no duplicate ids, no dangling `kb_ref`, no orphan answer, counts matching
`meta.version` — and the existing seven checks reported empty and still do. What the audit found is
that **the checks covered the bank's internal shape and almost nothing about provenance or figure
coverage**, which is where the corpus had actually drifted.

`computeIntegrityReport()` in `src/data.ts` gains four checks, each exercised in `src/data.test.ts`
against a corpus that has the defect (the file's existing discipline — an empty report proves the
seed is clean only if the checker still fires):

- **`figure_claim_uncovered`** — the inverse of `figure_check_ref_dangling`. That one asks whether
  every slot a check *declares* exists; this asks whether every slot *carrying* the claim gets
  declared. Both fail silently for the same reason: `buildFigureWorkOrder()` scopes by `appears_in`,
  so an undeclared slot means a draft built from it gets no verification item and publishes the
  frozen figure. This was the audit's largest finding — see the fixes below.
- **`question_figure_check_dangling`** — validates `QUESTION_FIGURE_CHECKS` on both sides. That map
  is the entire `fetch_figure` path. A renamed question id or check key does not error; the lookup
  misses, the question quietly takes the normal path, and the draft ships the static number the live
  lookup exists to replace. Nothing validated it before.
- **`variant_source_undeclared`** — every `source` on a variant or a limit must be declared in
  `meta.sources`. Provenance is the only thing separating this bank from invented questions.
- **`structured_value_missing`** — fires when a short-value question routes to a slot that carries
  per-question structured values for its siblings but not for it. Deliberately narrower than "routes
  to prose", which is the designed fallback and would flag every attachment question in the bank.

**Two debt registers ship with them, and they are the honest part of this entry.** Ten real defects
are recorded rather than fixed, because fixing them needs something this change could not supply:

- `ACKNOWLEDGED_TIES` (3) — funder wordings recorded against two canonicals each, where an incoming
  form asking one verbatim scores 1.0 against both and bank order decides the match. Resolving one
  means moving a real wording, which changes matcher output and obliges regenerating
  `src/__fixtures__/matcher-parity.json` against the prototype.
- `STRUCTURED_VALUE_DEBT` (7) — `cover.legal_name`, `cover.year_founded`, `cover.fiscal_year`,
  `cover.authorized_rep`, and three `eligibility.*` questions, each returning a full narrative slot
  where a funder gave a one-line box. The values are organisational facts, and `kb.profile.identity`
  says itself that the registered legal name is still to be confirmed. Per `CLAUDE.md` "Do not
  invent", they are named, not guessed.

Read the empty integrity report accordingly: it is empty *given* those ten. `CLAUDE.md` §3 now says so
at the G1 bullet.

### Fixed — eight figure claims that appeared in KB slots their check never declared

Found by `figure_claim_uncovered` and by hand, then confirmed sentence by sentence in
`kb_launchpad.json`. Every one meant a draft scoped to the undeclared slot published a frozen figure
with no verification step and no warning — the exact failure `figures.ts` was written to prevent.
`appears_in` in `src/figures.ts` now names them:

| check | slots added |
|---|---|
| `demographics_race` | `kb.need`, `kb.target_population`, `kb.metrics`, `kb.eligibility` |
| `employment_wage_range` | `kb.outcomes`, `kb.programs`, `kb.budget_narrative`, `kb.management_plan` |
| `phase_costs` | `kb.programs`, `kb.program_desc`, `kb.uniqueness` |
| `employment_earnings_total` | `kb.theory_of_change`, `kb.capacity` |
| `top_employers` | `kb.theory_of_change`, `kb.risk` |
| `annual_budget` | `kb.eligibility` |

`kb.eligibility` is the sharpest of these: its `eligibility.budget_size` structured value literally
reads `FY2025 expenses ~$1.34M`, and no check claimed it. `kb.risk` is the next: it uses "17+ partners"
as the stated mitigation for employer dependence, so a stale count there understates a control the
application is relying on.

### Fixed — `cert_pass_rate` described a figure that is not in the knowledge base

The check's `claim` read `92% certification pass rate`. **No KB slot says that.** The 92% in
`kb.metrics` and `kb.capacity` is the Cohort 1 *paid-work* rate — 11 of 12 at six months — and the
certification claim is the PCEP range, `70–100% per cohort`. A reviewer sent to find "92%
certification pass rate" in `kb.metrics` finds a 92% that means something else and confirms the wrong
thing. The claim is corrected to the wording the KB actually carries.

### Added — a `placement_rate` figure check

The paid-work rate was the most-quoted outcome in the corpus and had no check at all; `cert_pass_rate`
had been standing in for it by accident. Four slots restate some form of it. It is `conflict_kind:
'unknown'` on purpose: no `query_*` tool returns a cohort placement rate directly — `query_employment`
`aggregate` gives participant and job counts, and the denominator has to come from `query_enrollment`.
The cohort framing is also a moving window; "100% in paid work now" is dated by whenever "now" was.

### Fixed — two funder sources cited by 31 wordings and never declared

`GSK-STEM-2026` (14 wordings) and `Truist-Inspire-2026` (17) — the two Aug-7 pilot forms, added as
variants at v0.3 and cited ever since without an entry in `meta.sources`. Provenance did not resolve
for any of them. Both are now declared, taking the source count 25 → 27, and
`variant_source_undeclared` enforces it. `Truist-Inspire-2026` is genuinely distinct from the
already-declared `Truist`, which carries 2 wordings from the generic Truist Foundation application.

**No `canonical` or `variants[]` text changed**, so matcher output is untouched and the parity
fixtures did **not** need regenerating. The full suite confirms it: `matcher.test.ts` and
`seq-ratio.test.ts` both pass unchanged. `data.test.ts` pins the source count at 27.

**Blast radius:** none at runtime beyond wider figure work orders, which is the safe direction — more
figures now carry a verification item. If you have a clone: `pnpm -r typecheck && pnpm test`. Expect
**275 across 14 files**, `packages/grants` **230 across 9**.

### Verified — what Lightspeed actually is, from the live connector

The content gap had been open since 2026-07-29 with only "the phase exists" recorded. Queried
2026-08-11 through the LP Internal AI connector, read-only. **Lightspeed is a 7-week summer intensive,
run twice** — 2024-07-01 → 2024-08-19 (7 completers) and 2025-07-07 → 2025-08-27 (8) — with **15 of 15
completing and none dropping**, and **14 of the 15 sat PCEP and all 14 passed**. Its completers appear
later under `LiftOff` and `Alumni`; no student has it as `current_phase`, and `query_students`
`breakdown` on `current_phase` returns no Lightspeed value at all.

**The KB's own reconciliation prose is wrong about it.** That note describes
`Foundations → 101 → Lightspeed → LiftOff`, a linear pipeline. The data does not support it: Lightspeed
runs in the summer gap between school years (101 runs Sept–Aug), and both completers whose full phase
history was inspected had `101: Not Enrolled`. A drafter who filled the gap from the reconciliation
prose — the obvious move, since it is the only place the phase was described — would have written a
false sequence into a grant application. The facts and that warning are now in the
`enrollment_by_phase` note in `src/figures.ts`.

Also worth knowing: those 14 Lightspeed passes are 14 of the 59 all-time PCEP attempts, and the other
45 (`_101`) are 18 pass / 27 fail = 40%. That is what the 54.2% all-time aggregate is averaging, and
it is a sharper version of the definitional conflict `cert_pass_rate` already flags.

### Found — `query_enrollment` silently drops filters it does not apply

Hit while querying the above, then confirmed in
`apps/mcp-server/src/tools/query-enrollment.ts`. `phase: 'Lightspeed', status: 'Completed'` on
`by_student` returned 20 arbitrary students, most of them `Lightspeed: Not Enrolled`;
`current_phase: 'LiftOff'` on `by_phase` returned results byte-identical to the unfiltered call.

The cause is per-branch: `by_phase` builds a `studentWhere` and never uses it, so `current_phase`,
`enrollment_status` and `cohort` are dropped; `by_student` uses `studentWhere` but ignores `phase` and
`status`, which live on the phase-outcome row. Nothing errors and nothing echoes which filters were
honoured, so a caller who believes they scoped to 15 students gets all 301.

**Recorded, not fixed** — a tool change with its own review, per `CLAUDE.md` §1 rule 5. Added as §4
row 10. The workaround for a phase roster is `active_during` with `phase` and a wide date window,
which does filter correctly; that is what produced the census above, and it is now named in the
`enrollment_by_phase` note so the next drafter does not repeat the wrong call.

### Recorded — three seed defects the audit found and could not fix

Added to `CLAUDE.md` §4 as rows 7–9 rather than left silent:

- **Lightspeed is still missing from the KB.** The platform records
  `Foundations → 101 → Lightspeed → LiftOff` with 15 completions. The KB's own reconciliation prose
  flagged it on 2026-07-29; re-confirmed 2026-08-11, still **0 of 29 slots**. Every drafted program
  description omits a phase.
- **Six slots cannot fill the longest ask routed to them** — `kb.staff_bios` is 110 words against a
  600-word question. The `needs_expand` guard makes this visible rather than silent, but expansion is
  where invention happens, and the underlying content is thin.
- **The KB snapshot (`2026-07-23`) is older than the bank (`2026-08-11`)**, and all four staff flags
  in its reconciliation prose are still open.

### Added — `needs_expand`, guarding D1a's mechanism against answering a field it has only filled

Closes the general shape left open when `grant-h32` was fixed. The bank split fixed the one *instance*
where a 9-word structured value was returned into a 200-word narrative field as `fits` / `actor: none`;
nothing stopped the next one. `grant-miy` is about to add roughly fourteen more structured values, so
the guard is worth having before them rather than after.

**The principle: fitting is not answering.** The layer measured whether a value was *inside* a
funder's cap and treated that as done. A caller reading `actor` therefore saw the outstanding-work
count go *down* on a question the draft had barely touched — the worst shape a defect can take in a
tool whose whole job is telling a caller what is left to do.

**What it does.** `limits.ts::underfillsProseField` is the test; `pipeline.ts` returns the new
`needs_expand` status (`actor: llm`) with a handback carrying **both** the confirmed value as an
`anchor_value` that must survive verbatim **and** the KB slot's prose as material to draw on. The two
travel separately on purpose: one is checked and must be preserved, the other is context that may be
used, and a caller that concatenated them would lose the distinction every rule depends on.

**The value is deliberately not returned as `answer`.** Present, it renders as a finished answer in
the Markdown package and to anything else walking `results` — which is exactly the appearance that let
the original defect through.

**`EXPAND_RULES` is the riskiest guardrail in the layer, and it is written that way.** The other two
tasks constrain a model with *too much* material: resizing chooses what to drop, deriving picks one
value out of prose. This one hands a model a short fact and a large empty field, which is the precise
situation that produces invented grant content. Two clauses carry the weight:

- **"The limit is a CEILING, NOT A TARGET. Do not pad to reach it."** Without this the guard would
  trade a silent under-answer for a padded, invented one — strictly worse, because a reviewer can see
  the first and the second reads as finished work.
- **The anchor must appear unchanged.** It is the one part already checked against filed material; a
  paraphrase swaps a verified fact for an unverified one while looking like it did the work.

**Three tests, all required — and the third was added because the guard shipped a false positive.**
A first cut used only the size of the field and the fill ratio. Run across all ten seeded forms before
being trusted, it fired on Hamilton's LOI: "Project/ Program/ Campaign Name", a **250-character** box
holding `Launchpad`, which fills 3.6% of it and is the complete correct answer. The guard would have
instructed the model to pad a title to 250 characters — causing the exact harm its own rules forbid.
The missing test was `answer_type`: a `field` is a name however large the box.
`EXPANDABLE_ANSWER_TYPES` (`schemas.ts`) is `narrative` and `demographic` only, and is deliberately
**not** the complement of `NON_NARRATIVE_ANSWER_TYPES` — `demographic` is in both, because "who do you
serve, and how many?" takes a value or a paragraph depending on the room given.

| Test | Question it asks | What it alone would get wrong |
|---|---|---|
| `EXPANDABLE_ANSWER_TYPES` | Could this field want prose at all? | — |
| `PROSE_LIMIT_FLOOR` (50 words / 250 chars / 3 sentences) | Is the cap big enough to hold prose? | fires on a 190-word answer in a 200-word field |
| `MIN_STRUCTURED_FILL_RATIO` (0.25) | Is most of the room unused? | the Hamilton false positive |

**Current effect: none, and that is the intended state.** All ten seeded forms come back clean — the
one real instance was fixed at the bank level, so this is a regression guard for the structured values
`grant-miy` will add, not something catching live defects today.

**Known gap, recorded rather than papered over.** The guard cannot fire when a form states **no**
limit. With no cap there is no evidence the field is large, and asserting one would be inventing. The
no-limit path still returns the value as `ready`. `admin/DECISIONS.md` D1e holds this.

Suite: 192 → **217 in `packages/grants`**, 237 → **262 repo-wide** across 14 files. 25 new cases,
weighted toward what the guard must *not* do.

### Fixed — `fetch_figure` broke the `actor: llm` ⇒ `handback` contract, and the full suite was red

**Found by accident** while re-diagnosing `grant-h32`, which is the part worth recording: nobody was
looking for it, and nothing in the grant workstream's own habits would have surfaced it.

D1b added the `fetch_figure` status with `actor: 'llm'` and a `figure_call` payload, but no
`handback`. `pipeline.ts` documented `handback` as "present **exactly when** `actor` is `llm`, so a
caller can drive every outstanding rewrite off this field alone", and
`apps/mcp-server/src/__tests__/tools.test.ts` asserted it. So a caller walking `results`, filtering to
`actor: 'llm'`, and reading `handback` **silently skipped every figure question** — the tool reported
work owed and handed over nothing to do it with.

**The full suite had been red since D1b landed.** It was not noticed because the grant workstream
verifies with `vitest run packages/grants`, and that package contains no test that goes through
`apps/mcp-server`. The 2026-08-10 and 2026-08-11 sessions both recorded "187 of 187 pass" truthfully
and both were reading a suite that structurally cannot see this class of defect. `CLAUDE.md` §3 gains
the rule that follows from it.

**Resolution: the contract was widened, not the code bent to fit it.** `fetch_figure` is a genuinely
second kind of model work — the task is running a `query_*` call, not reshaping prose — and forcing it
into a `Handback` would have meant a `verify_with` naming `grant_resize_answer` for a question with
nothing to resize. The invariant is now:

> Every `actor: 'llm'` result carries **exactly one of `handback` or `figure_call`**.

That preserves the property a caller actually depends on — outstanding work is drivable off the result
alone — without pretending the two kinds of work are one. `pipeline.ts`'s doc comment on `handback`
records why it changed, and `tools.test.ts` gains a case asserting the invariant directly rather than
only checking each payload's shape.

**A second, quieter gap.** `pnpm test` does **not** typecheck. The integration test declares its own
narrow shape for the tool's result, that declaration had no `figure_call`, and every case passed at
runtime while `tsc` rejected the file. `pnpm -r typecheck` is what caught it. Neither command alone is
a green light.

**If you have a local clone:** run `pnpm --filter @lp-ai/mcp-server build` before `pnpm test` — the
integration suite spawns the compiled server, so a stale `dist/` tests the old contract.

### Fixed — question bank at v0.4.3: two canonicals split, closing board `grant-h32`

`grant-h32` recorded three funder wordings matching at confidence **1.000** to canonicals of the
wrong `answer_type`. That is not a recall failure — all three were *recorded variants*, which is why
they scored 1.000 — so no amount of variant-adding could have found or fixed them. It is the B6
defect class reached from the other side: B6 was a coverage gap surfacing as a confident wrong match,
this is a **typing** error surfacing the same way.

**Re-diagnosed against the code before fixing, and two of the three had moved since the board wrote
them.** D1a/D1b landed in between and changed the symptom without changing the cause:

| Wording | `grant-h32` recorded | Actual behaviour on 2026-08-11 |
|---|---|---|
| "Who does your solution serve, and in what ways will the solution impact their lives?" | `derive_from_reference` | `fits`, `actor: none`, **9 words into a 200-word field** |
| "How is your current budget allocated?" | `derive_from_reference` | `fetch_figure` → `get_finance_brief {period:"ytd"}` |
| "What was your organizational budget for fiscal year 2025 and 2026?" | `derive_from_reference` | `fetch_figure` — **now the right shape**; h32's diagnosis is superseded here |

The first is the one worth reading twice. D1a's structured-value branch gave it a real answer —
`Philadelphia young people ages 16–24 (101: 16–18; LiftOff/Inc: 18–24)` — and marked it `fits` with
`actor: none`, meaning **no work owed**. Against a 200-word narrative field that answers half the
question in 9 words and reports done. D1a converted a visible defect into an invisible one; the
outstanding-work count went down while the draft got worse. Recorded here because the failure is
structural, not specific to this question: any short structured value on a long narrative field
does the same thing.

**The fix, under growth rule 1.** `answer_type` belongs to the ENTRY, not the variant
(`seed/QUESTIONS-SCHEMA.md`), so retyping was never available — `program.target_population` is
genuinely `demographic` and `financials.operating_budget` is genuinely a `number`. Two new canonicals
take the misplaced wordings:

- **`program.population_impact`** (`narrative` → `kb.target_population`, 200-word limit from Truist) —
  takes the Truist and JFF two-part who-and-how wordings.
- **`financials.budget_allocation`** (`narrative` → `kb.budget_narrative`, 150-word limit from Truist) —
  takes "How is your current budget allocated?". `kb.budget_narrative` already holds allocation prose
  and is `verified: true`, so this needed no KB writing.

Bank **90 → 92 questions, 265 wordings unchanged, v0.4.2 → v0.4.3**. The unchanged wording count is
the point and is asserted by `data.test.ts`: this release **moved** three variants and invented no
funder source. A split that fabricated a wording would fail the suite.

**Effect on the real form** (`seed/forms/aug7_truist.json`): `fits` 10 → 11, `fetch_figure` 2 → 1.
The two-part question now returns **86/200 words** of narrative instead of 9, and the allocation
question returns **99/150 words** of budget prose instead of an instruction to write a number into a
prose field.

**Parity: both fixtures regenerated, control pass first.**

| Fixture | Control | Result |
|---|---|---|
| `matcher-parity.json` | 0 regression differences | 404 → **406 cases**. **Exactly 5 changed**, and all 5 are the intended ones: 3 moved wordings plus the 2 new canonical self-matches (0.334 → 1.00 and 0.385 → 1.00). Nothing else moved. |
| `seq-ratio-parity.json` | 71,001 overlapping pairs, 0 regression differences, 1,104 pairs not yet covered | **72,105 pairs** over 380 strings, CPython 3.14.6, all reproducing exactly |

Five regression cases added to `src/matcher.test.ts` under an `h32` describe block, pinning both new
routings **and** that the split did not drag the canonicals it was split from. Suite: 187 → **192 of
192** across 9 files.

**Unresolved, and deliberately not guessed.** The FY2025/2026 budget question carries
`get_finance_brief {period: "ytd"}`, which cannot express a fiscal year — `apps/mcp-server/src/tools/get-finance-brief.ts:13`
accepts only `period: 'ytd' | 'last_30_days' | 'last_quarter'`. So the args cannot be widened; the
tool that can answer it is `query_finances`, whose enum includes `annual` and `budget_actuals`
(`apps/mcp-server/src/tools/query-finances.ts:13`). Changing the `annual_budget` FIGURE_CHECK would
also move the figure work order for every KB slot referencing it, so this is left open on `grant-h32`
rather than changed under a bank release.

**If you have a local clone:** nothing is required — no schema, tool surface, or migration moved.
The prototype bank at `~/Projects/Grants/question-bank/questions.json` was re-synced as part of the
regeneration procedure and is byte-identical to `seed/questions.json`.

### Changed — question bank at v0.4.2: three real unfilled forms transcribed and routed

Multi-grant coverage test against grants in `data/Grants/` with no filed response surfaced three
forms whose questions the bank could not route confidently: **JFF & Google Advancing AI Resilient
Early Career Pathways RFP (2026)** (all 8 questions under the 0.42 floor), **Allen Hiles Fund** (8
of 11), and **Dolfinger-McMahon Foundation** (1 of 4).

15 real wordings appended to existing canonicals, two new canonical questions added, all under the
growth rules in `seed/QUESTIONS-SCHEMA.md`:

- `organization.community_voice` (narrative → `kb.dei`) — "How does your organization include the
  people it serves in its decision-making process?" Previously routed to `attachments.org_chart` at
  0.37 — a confident-shape trap of the same class board B6 pinned in v0.4.1.
- `program.operations` (narrative → `kb.program_desc`) — "Describe how the project will operate,
  including hours of operation, staffing, and volunteers." Previously landed on
  `program.team_qualifications` at 0.20, which answers only the staffing half.

The three forms are now committed as fixtures (`forms/allen_hiles_2024.json`,
`forms/jff_ai_pathways_2026.json`, `forms/dolfinger_mcmahon_2023.json`) so their question texts
enter both parity fixtures. Bank: 88 → **90 questions**, 248 → **265 wordings**, `kb_entries`
unchanged at 29 (no new KB slots — the other agent is gap-filling answers). `meta.version`
0.4.1 → **0.4.2**, three new `meta.sources`.

**Parity:** both fixtures regenerated with control passes clean — `regenerate-matcher-parity.py`
reported 0 shared-case changes (337 → 404 cases; the JFF form now matches all 8 questions at 1.00)
and `regenerate-seq-ratio-parity.py` 0 regressions (59,616 → 71,001 pairs). Suite: **187 of 187
pass, 9 files, zero skipped** after the count assertions in `data.test.ts` moved with the bank.

**If you have a local clone:** nothing is required — no schema or tool surface moved. The prototype
bank at `~/Projects/Grants/question-bank/questions.json` was synced to the repo seed (byte-identical
sha256) as part of the regeneration.

## 2026-08-10

### Added — per-question structured values and the live-figure path (D1a + D1b, grant-miy)

`kb_launchpad.json` answer objects can now carry `structured: { "<question id>": { value, verified } }`.
Slots are shared — `kb.eligibility` answers eight questions — so the value is keyed by question id,
not by slot. `buildAnswer` returns a stored value as a real answer (`fits`/`ready`, `actor: none`)
ahead of the `derive_from_reference` branch, with `from_structured: true` in the provenance footline.
Per-value `verified` overrides the entry-level flag. `computeIntegrityReport` gained
`structured_key_dangling`, which fires when a structured key names a question id that no longer
exists in `questions.json` — a renamed question silently falling through to `derive_from_reference`
was the failure mode this check exists to prevent.

The three number questions whose answer is a live figure (`cover.budget_totals`,
`financials.operating_budget`, `program.jobs_and_participants`) no longer derive from frozen prose.
They return a new status carrying the exact `query_*` call from `FIGURE_CHECKS`: **`fetch_figure`**
(`actor: 'llm'` — run the call, write the live number) or **`figure_definitional`** (`actor: 'staff'`
— the number depends on which population the funder means, so a person confirms first). Two statuses
so `STATUS_ACTOR` stays a clean mapping. `renderMarkdown` shows the named call for both.

`figures.ts`: `students_served_total.appears_in` gained `kb.metrics`, because
`program.jobs_and_participants` routes there and a metrics-only draft otherwise lost the live
`query_enrollment` call, leaving only the definitional flag.

Seed: 11 structured values landed across five slots (`kb.program_desc`, `kb.profile.identity`,
`kb.profile.contacts`, `kb.target_population`, `kb.eligibility`), including the sharp case —
Truist `cover.project_title` now answers **"Launchpad"** instead of a 199-word program description
flagged over limit. Suite: 177 → **187 across 9 files**. No `meta.version` bump, no matcher-parity
regeneration (matching is untouched). Design and decisions: `packages/grants/admin/DECISIONS.md` D1.


### Verified — all three grant tools resolve in the ACL, not just `grant_match_question`

The G1 method, repeated on `grant_build_draft` and `grant_resize_answer`. **No source file changed.**

From 2026-08-04 to today the claim about these two rested on the `tool_permissions` rows being
present by query. That says a tool *will* resolve; it does not say one *was seen* resolving, and the
distinction is exactly the kind this workstream has been caught by before. It is also the one thing
no test run could settle: `tool-helpers.ts` reaches `canCallTool()` only when `currentCaller` is set,
and only `serve-http.ts` sets it, from a verified bearer token. **The ACL branch is unreachable from
the entire suite**, including the integration tests that spawn the real server over stdio.

Method, unchanged from 2026-08-03: `dist/serve-http.js` against local Postgres, a throwaway RSA
keypair in `JWT_PRIVATE_KEY`, and two `ACTIVE` `mcp_users` — one `leadership`, one `program_staff`.
Tokens signed with the same key, then `initialize` and `tools/call` over Streamable HTTP.

| Caller | Tool | HTTP | Outcome |
|---|---|---|---|
| no bearer token | — | 401 | refused by the transport, never reaches a tool |
| `leadership` | `grant_build_draft` | 200 | draft package returned (`form`, `summary`, `results`, `kb_refs_used`) |
| `leadership` | `grant_resize_answer` | 200 | resize result returned (`model`, `answer_full`, `answer_truncated_preview`, `units_before`) |
| `program_staff` | `grant_build_draft` | 200 | `isError: true`, `{ code: 'permission_denied' }` |
| `program_staff` | `grant_resize_answer` | 200 | `isError: true`, `{ code: 'permission_denied' }` |

**All four authenticated calls reached `usage_logs` with the caller email, refusals included** — a
denied call is visible on HQ `/tools` rather than silent. The `usage_logs` rows are left in place as
the evidence: `select tool_name, anthropic_user_email, error from usage_logs where
anthropic_user_email like 'acl-%'` reproduces the table on any clone that ran this.

**What it still does not prove.** Production. Every result is local, and whether the grant
`tool_permissions` rows exist on RDS remains unknown and unowned — board **A7 (#163)**.

**Blast radius: none.** The keypair lived only in a session scratchpad and was deleted; the server
was stopped and both test users removed.

### Added — the reframe seam, built and deliberately not connected (board D4 / #74)

`packages/grants/src/reframe.ts` and `reframe.test.ts`. `admin/SPEC.md` §8 and `admin/TAD.md` §5
decision 7 both say the same thing about this hook: port the seam, do not wire it. Both halves landed.

**There was no implementation to port.** The prototype never wired reframe either — `pipeline.py`
threads a `hat` through its `context` dict and marks the transform TODO, and `resize.py`'s
`_build_user_prompt` carries a comment calling the real hook "a separate, richer transform". So what
ported is the *interface*: the funder-hat vocabulary, the context assembly, and a guardrail. There is
no parity fixture for this module and there cannot be one.

**The guardrail is not the resize guardrail with a word changed, and that is the substance of the
package.** Resizing asks a model to say less, which fails safe. Reframing asks it to lean into a
theme, which fails by *manufacturing* the theme when the source does not support it — and no length
check or figure check would ever catch that. So `REFRAME_RULES` carries the no-invention clause
word-for-word from `RESIZE_RULES` (a model that gets a softer guardrail from one tool than another
uses the softer one), then adds the two rules this task needs:

- Reframing is **reordering and re-weighting** what is already there, not adding material.
- If the source contains nothing supporting the funder's emphasis, **say so and return it unchanged**.
  A mismatch is a finding about the knowledge base, not a writing problem to solve.

**`FUNDER_HATS` is a closed vocabulary** — `workforce`, `youth`, `tech_equity`, `economic_mobility`,
`dei`, `education_innovation`, `place_based` — taken from the prototype's roadmap entry, where
`research/LaunchPad-Philly-Application.md` records that a hat is concretely about which program and
phase you pitch. `buildReframeHandback` throws on an unrecognised one rather than passing it through:
a typo'd hat reaching a prompt would read to the model as an instruction somebody meant to give.

**How it stays unconnected, mechanically.** The module is **not re-exported from `src/index.ts`**.
`@lp-ai/lib-grants` is the only door the MCP tools have into this package, so leaving it off that
barrel is what makes the seam unreachable rather than merely unused. It also does **not** widen
`HandbackTask` with a `'reframe'` value, which would put the new task into a module three registered
tools import — precisely the wiring decision 7 defers. The seam pays a small duplication to stay a
seam.

**The acceptance criterion is asserted structurally, not by spying.** A spy only proves the paths a
test happens to exercise; unreachability is a property of the import graph. Three assertions:
`index.ts` does not mention it, nothing under `apps/mcp-server/src/` mentions it, and nothing else in
`packages/grants/src/` imports it. Each walks the real files at test time, so wiring it without
deleting the test fails the suite.

**To wire it later:** revisit `admin/TAD.md` decision 7 first — the decision is what holds it, not the
code — then add the barrel export, register a tool, and delete the unreachability test, in that order.

**Tool surface unchanged at 23.** No migration, no `tool_permissions` row: an unregistered seam needs
neither. **Suite: 207 → 222 tests across 14 files**, all passing, zero skipped. `packages/grants`
alone is **177 in 9 files**, still with no database and no network.

---

## 2026-08-06

### Fixed — Drive discovery rebuilt as a connector: efficient enumeration, and identity that refuses to guess

Landed on branch `fix/google-drive-discovery`. The catalog design bet is unchanged — query
`grant_documents` to find a document, then fetch it by ID — but the thing that fills the catalog is no
longer a one-off script, and no longer limited to what the local mirror happened to hold.

**Connector `google-drive` is implemented.** It was a 16-line `noop`. It now walks the Drive `Grants`
tree and upserts `grant_documents`. It writes **no document text and no embeddings**, which settles
question 1 of Fix 4 in `docs/data-sources/google-drive-discovery.md` §6: fetch-by-ID already covers
retrieval, so embedding 3.5+ GiB would be cost without capability. `OPENAI_API_KEY` is not needed.

- `connectors/google-drive/src/drive-client.ts` — the **only** code permitted to call Drive. Sets
  `supportsAllDrives` + `includeItemsFromAllDrives` on every call (omitting either is what makes a
  Shared Drive return an empty list instead of an error), retries 429/5xx with backoff, and resolves
  shortcuts to `shortcutDetails.targetId` — a shortcut's own ID reads as empty content.
- `connectors/google-drive/src/reconcile.ts` — identity, strongest evidence first: `drive_file_id`,
  then exact path, then *unique* normalized path, then a new row. Two candidates is never resolved by
  picking one; the row is flagged `needs_review` instead. A wrong ID silently serves a grant writer
  the wrong funder's document.
- `connectors/google-drive/src/sync.ts` — walk, classify, upsert. **Throws** when the root reads but
  lists nothing, because that is the original bug's exact signature and `ok, 0 records` would have
  been the most expensive possible outcome: green runs in HQ `/sync` while the catalog rotted.
- `packages/grants/scripts/drive-walk-grants.ts` — reduced to a CLI over the connector (`--dry-run`,
  plus the `data/drive-manifest.jsonl` audit trail). Its own copy of the walk is gone, so the
  scheduled sync and the script cannot behave differently.

**Enumeration costs `ceil(n/1000)` API calls instead of ~600.** Where the root is in a Shared Drive
the connector sweeps it once with `corpora: 'drive'` and reassembles the tree locally from each file's
`parents`; the per-folder walk survives as the My Drive fallback. Fewer calls is not only faster — each
call was a chance to be rate-limited into a truncated walk that looks like a complete one.

**Drive-only files now get catalog rows.** The old script could only stamp IDs onto rows the local
mirror had already created, which made the ~1243-file gap between the 1.6 GB mirror and the 3.5+ GiB
corpus permanently invisible. Drive is the discovery source now; the mirror is secondary.
`data/drive-unmatched.txt` is no longer written — that gap is the run's `created` count.

### Fixed — the deployment path, which this connector had quietly broken

Reviewed against the real target (ECS Fargate one-off tasks, `apps/sync` image, EventBridge) and
verified by building and running that image locally. Five problems, four of them ours:

1. **The image build was broken.** `apps/sync/Dockerfile` builds `lib-config`, `lib-db` and
   `lib-embedding` and then every connector — but never `lib-grants`, which `google-drive` now
   imports for classification. `tsc` cannot resolve its types, so the sync image would have failed
   to build on the next push touching `connectors/`. Fixed by building it before the connectors.
   **Verified**: `docker build -f apps/sync/Dockerfile` succeeds, and the taskdef's exact command
   inside that image runs the real sync — 1253 files, `status ok`.
2. **A failed sync exited 0.** `runSync` records the failure in `sync_runs` and returns normally, so
   a one-off Fargate task would report success to ECS with nothing for EventBridge or a human to
   notice. `connectors/google-drive/src/cli.ts` now sets `process.exitCode = 1` on
   `status: 'error'`. **This is repo-wide behaviour and only google-drive is fixed** — every other
   connector still exits 0 on failure, which is worth a follow-up.
3. **No timeout on Drive requests.** gaxios has none by default; a hung socket in a task with no
   timeout of its own runs until somebody kills it. Now 30s per request, with the existing backoff.
4. **A user token could have become production auth.** The OAuth identity added for local testing
   took precedence whenever all three variables were set — including in Secrets Manager. Now
   refused outright when `NODE_ENV=production` or `USE_AWS_SECRETS=true`. **Verified in-image**: the
   trio present under the image's baked `NODE_ENV=production` yields `status: noop`, not a run.
5. **No task definition existed.** Added `infra/ecs/sync-google-drive-taskdef.json`, matching
   `sync-notion`'s shape. Deliberately **not** scheduled in EventBridge: the corpus is
   human-curated and rarely changes, and an hourly job would only manufacture failing tasks while
   the access prerequisite below is unmet.

**Two prerequisites production cannot satisfy by itself**, both documented in
`docs/data-sources/google-drive-connector.md`:

- The `Grants` tree must be shared with the service account's `client_email`, or that account added
  to the shared drive. A service account does not inherit a person's "Shared with me" access, so
  **the identity that has been verified against real Drive is not the one production will use.**
- `grant_documents` must exist in RDS. Worth stating plainly: the `migrate` job in `deploy.yml`
  *lists* applied migrations, it does not apply them, so no migration in this repository reaches
  production automatically.

### Verified — the catalog write, applied to the local database

`pnpm sync:drive` with writes enabled, three runs, 2026-08-06. The `sync_runs` row reads
`status ok`, `recordsUpserted 1253`, and the 5% integrity guard did not warn.

| Before | After |
|---|---|
| 1252 rows, **9** with a Drive ID, **9** fetchable | 1356 rows, **1248** with a Drive ID, **1181** fetchable |
| `find_grant_documents({only_fetchable: true})` → 9 | → **595** (after the default archive/external exclusions) |

Checked through the tool rather than only in SQL: `find_grant_documents({funder: 'truist'})` returns 5
rows, all fetchable, including `8/10/2026 Truist Application` — the file the discovery doc records
Drive search as never finding. **The re-run is idempotent**: 1243 of 1253 files matched on
`drive_file_id`, and the only rows still not matched are the ones deliberately refused as ambiguous.

Production is untouched and unverified: nothing has run against RDS, and the service account still has
no access to the tree.

### Fixed — one Drive file was trying to become three catalog rows

The first write attempt died four minutes in on `Unique constraint failed on (drive_file_id)`. Three
files in the corpus are filed at two or three paths each — a shortcut inside an application folder plus
the file itself under reporting — which is ordinary curation, but `grant_documents.drive_file_id` is
unique. `dedupeById` now keeps the instance where the file actually lives (a shortcut is a pointer) and
reports the dropped alias paths in the run notes.

**Worth stating plainly: the dry run reported success on this.** It counted the same three files three
times and never wrote, so nothing surfaced. A dry run proves the read path; only the write proves the
write path.

### Added — a fifth identity tier, and two collections real Drive turned out to have

- **Same filename inside the same funder folder**, used only after every precise key misses and only
  when the name is unique on *both* sides. Documents get reorganized: 18 catalog rows pointed at a file
  Drive now keeps one or two folders deeper, and no path-based key can see that. Scoped to the funder
  because `Launchpad Team 012023` exists under two different funders in this corpus — matching those
  would stamp one funder's Drive ID onto the other's row, which is the confident-wrong-match failure
  this layer exists to prevent, and there is a test pinning that refusal.
- **`Templates` and `Key Statistics`** map to the `org_reference` collection. Both are top-level folders
  in the real tree that classification did not know: the live grant response and report templates, and
  the demographics and outcomes reference sheets. They were landing in `unknown` and flagged for review —
  prime drafting material, hidden behind a filter nobody would think to widen. `unknown` is now 0 rows.

**Suite: 280 tests across 17 files.**

### Verified — the walk works against real Drive, and the root cause is confirmed

Run 2026-08-06 as `ddelu0068@launchpadphilly.org` through the user-identity path, `--dry-run`, against
the live tree. **No database writes yet.**

- **`Grants` is in a Shared Drive: `driveId=0AAj6r5Nb_TnNUk9PVA`.** H1 in
  `docs/data-sources/google-drive-discovery.md` §4 is **confirmed**: with `supportsAllDrives` +
  `includeItemsFromAllDrives` set, the same human identity the Claude Drive connector failed with
  enumerated **1257 files across 617 folders** — the operation that previously returned `{}`.
- **Reading by ID works**: 47,886 characters of `3_31_25 Truist Foundation Grant Response` exported as
  text.
- **1145 of 1234 `Grants` catalog rows reconciled** (607 exact path, 538 loose), 112 Drive-only files
  would be added, 60 ambiguous refused and flagged, 107 rows not seen and **left alone**.
- The drive-scoped sweep was **refused** for this identity — `corpora: 'drive'` needs membership of the
  drive, and this account holds the folder by direct share — so the per-folder walk carried the run in
  646 calls. The fallback added for exactly this case is what made the run possible.

**Corrected: the corpus is ~1.5 GiB and 1257 files, not "3.5+ GiB".** That figure appears in earlier
entries below and in `admin/` docs; it was never measured. Entries are not rewritten, so read any
"3.5+ GiB" in this file as superseded by this measurement.

### Fixed — three accuracy defects only real Drive could surface

All three produced *plausible* catalog rows, which is the dangerous kind of wrong.

1. **121 Drive filenames contain `/`** (`12/8/25 Vanguard Philanthropic Impact Fund Response`).
   Concatenated into a path, one filename became three fake folders, so the file classified under a
   funder subtree that does not exist. Names are now escaped per segment (`escapePathSegment`), the way
   Drive for Desktop already does locally; the true name is still stored in `filename`.
2. **The mirror's names were rewritten inconsistently by downloading**, so precise matching reconciled
   only 608 of 1234 rows. Google-native files arrived as `.docx`/`.xlsx`, `/` inside a folder name
   became ` - ` in one place and `_` in another, `*` became `_`. Rather than chase substitutions,
   `looseKey` collapses punctuation and drops the extension — used **only** after the precise keys
   miss, and **only** when it names exactly one row. 1145 rows now reconcile; 60 collisions are refused
   and flagged rather than guessed.
3. **Shortcut targets were assumed fetchable, and 16 of 29 are not.** 10 point at files in someone
   else's drive: the walk now probes each target and stores `content_class = 'unknown'`, so
   `find_grant_documents` reports `fetchable: false` instead of handing over an ID that 404s. The other
   7 pointed at **folders** and were being catalogued as documents; those are traversal instructions
   now — probed first, because an inaccessible folder **lists as empty rather than failing**, which is
   the original bug's own signature. 6 of the 7 are inaccessible and are named by path in the run
   output, which makes them an access request rather than a silent hole.

The walk also gained a visited-set: a shortcut can point at a folder already in the tree, or at an
ancestor of it, and following one without that is an infinite walk.

**Suite: 269 tests across 17 files** at that point.

### Added — a second Drive identity, so the walk can be tested without waiting on the folder's owner

`connectors/google-drive` now authenticates either way:

- **Service account** (`GOOGLE_SERVICE_ACCOUNT_JSON`) — production and the scheduled sync, unchanged.
- **A person's own Google account** (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`) — local runs. `connectors/google-drive/scripts/authorize.ts` is
  a one-time loopback consent flow that prints the refresh token; it writes nothing.

The reason is the access asymmetry that has blocked verification all along: a service account does not
inherit the "Shared with me" access a human holds, so proving the walk works as one requires the
`Grants` tree's owner (`chip@b-21.org`) to share it. A team member who can already open the tree can
authorize in one browser round trip. A fully configured user identity takes precedence when present;
a half-configured one is ignored rather than used to build a client that cannot authenticate.

This is also the cleanest test of H1 vs H2 in `docs/data-sources/google-drive-discovery.md` §4 — it
runs the same human identity the Claude Drive connector failed with, but with the shared-drive flags
set. Success implicates the missing flags (H1, ours, fixed); continued empty listings implicate that
connector's index (H2, not ours).

**A drive-scoped sweep is no longer fatal when refused.** `corpora: 'drive'` requires membership of
the drive, so an identity holding the folder by direct share gets 403/404 — which is the likely shape
of a user-identity run here. That now falls back to the per-folder walk and says so in the strategy
string, rather than failing the run. `withRetry` was changed to rethrow non-retryable errors
unchanged so the status code survives for that branch to read.

### Fixed — `parseYear` returned null for underscore-dated filenames it documented as handled

`8_7_2026 GSK Grant` parsed to no year: underscores are word characters, so `\b(20\d{2})\b` never
matched. Every underscore-dated file in the tree was losing its application year, and with it its
`archive_only` decision — an undated file is treated as current, so pre-2025 applications were
reaching drafting context. `parseYear` now scans an underscore-to-space copy, the same trick
`classifyByFilename` already used. **If you have a loaded catalog, re-run the loader** — existing rows
keep the wrong `year` until something rewrites them.

### Changed — classification extracted from a script into `packages/grants/src/catalog.ts`

Two callers now classify the same corpus: `scripts/build-grants-index.ts` over the local mirror, and
the connector over Drive. Two copies would mean a file classified one way when found locally and
another way when found remotely. The module is pure — no filesystem, no network, no database — and is
re-exported from `@lp-ai/lib-grants`. `load-grant-catalog.ts` was switched onto its `needsReview`,
`mimeForExt` and `driveUrlFor`, deleting a third copy.

It was also **entirely untested** while it lived in a script; it now has 24 cases covering the
judgements that would otherwise be re-argued — fiscal-year shifting, span years, the `7.28`
month-day trap, archive-only policy, and externally-authored material.

**Suite: 255 tests across 17 files, all passing** (was 207 across 13). New: `catalog.test.ts` (24),
`connectors/google-drive/src/{drive-client,reconcile,sync}.test.ts` (24).

### Added — `GOOGLE_DRIVE_GRANTS_FOLDER_ID`

Optional, in `packages/config/src/schema.ts`. Overrides the grant root; defaults to the known
`Grants` folder ID. Distinct from `GOOGLE_DRIVE_FOLDER_ID`, which the never-built student-document
ingestion claimed.

### Unverified — none of this has run against real Drive

`GOOGLE_SERVICE_ACCOUNT_JSON` is empty in this environment and `USE_AWS_SECRETS` is off, so the API
path is exercised only by unit tests with a fake client. The root cause of the original failure
(`H1` vs `H2` in the discovery doc) is therefore **still unconfirmed** — the code is written to be
correct under either, and reports the root's `driveId` in `sync_runs.notes` so the first successful
run answers it as a side effect. What would settle it: `pnpm sync:drive` with an identity that is a
member of the shared drive, or the folder shared with the service account's `client_email`.


### Added — `grant_documents` catalog and `find_grant_documents`, because Drive cannot find its own files

The Drive "Grants" tree could not be discovered through any existing tool. Two separate causes, and
neither was a query mistake:

**The Google Drive connector cannot enumerate the tree.** Verified by direct calls:
`get_file_metadata` on `Prospects and Proposals` succeeds, but listing its children
(`parentId = '<id>'`) returns `{}` — same for `Current and Past`. `title contains 'Truist'` finds only
an unrelated shortcut, never the real `8_10_2026 Truist Application.docx`. This is **not** a recursion
limit: `Meeting Transcripts` and `Project Management (do not ingest)` are nested just as deep under
`Launchpad Internal AI OS` and list fine. The pattern — metadata by ID works, listing returns empty,
shortcuts unreadable — is the signature of a **Shared Drive queried without `includeItemsFromAllDrives`**.
*Unverified:* confirming that needs a Drive API call with the shared-drive flags set, which requires
credentials this workstream did not have.

**`search_documents` returned nothing because `document_chunks` is empty.** `select source, count(*)
from document_chunks group by source` returns **0 rows** — every source, not just Drive, including the
Notion sync the README describes as live. `connectors/google-drive/src/index.ts` is still a stub
returning `status: 'noop'`. Nothing had ever been ingested locally.

Crucially, **fetching a Grants-tree file by ID works** — confirmed by reading
`1mnx4NjQlZFHDljMgcpeSa-368C4wcYHkKsXkRQ7vRCo` (Cambiar Thrive working response) and getting full
content. So only the *discovery* half is broken. That is why this landed as a **catalog** rather than an
ingestion pipeline: 3.5+ GiB of grant material stays reachable with nothing embedded.

**Schema.** New `grant_documents` table — migration
`20260806000000_add_grant_documents_catalog`. One row per file, **no document text**: Drive file ID,
path, funder, year, `doc_kind`, and the flags below. Anyone with an existing clone needs
`pnpm db:migrate`.

**Tool surface: 23 → 24.** `find_grant_documents` (`apps/mcp-server/src/tools/find-grant-documents.ts`)
filters by funder, year range, kind, and collection, returning Drive file IDs plus facet counts. Reachable
via `20260806000100_add_find_grant_documents_permission`
(`program_staff`, `development`, `finance`, `leadership`, `admin` — wider than the deterministic grant
tools, since it returns no document text). Category `grants` already existed in
`PermissionsMatrix.tsx`, so no HQ change was needed.

**Two safety flags, both enforced as query defaults.** `archive_only` implements the 2026-07-21 client
rule *"Do NOT load old grants as AI writing context"* via `ARCHIVE_BEFORE_YEAR = 2025` — 572 of 1252
files. `external_reference` marks the **32 files Launchpad did not author** (funder NOFOs, scoring
rubrics, and two other grantees' winning narratives under `Reference/`); quoting those into a submission
is plagiarism, not staleness, which is why it is a separate column. Both are excluded unless explicitly
requested, and `excluded` rows (22 files under `Project Management (do not ingest)` and `Ignore`) are
never returned on any flag combination.

**Scripts** (`packages/grants/scripts/`, outside the package build — `packages/grants` keeps its
zero-dependency-beyond-zod contract, hence the relative import of `../../db/src/client.js`):
`build-grants-index.ts` (read-only walk of `data/` → CSV/JSONL/summary), `load-grant-catalog.ts`
(index → catalog), `drive-walk-grants.ts` (backfills Drive IDs; sets the shared-drive flags).
`googleapis` was added to **root** devDependencies for the walk.

**Known incomplete.** Only **9 of 1252** rows have a Drive ID — harvested from `.gdoc`/`.gsheet` stubs,
the only place the mirror records one. The rest need `drive-walk-grants.ts`, which needs an identity with
shared-drive membership; a human's browser access is not sufficient. **393 rows are flagged
`needs_review`** (no year, or `doc_kind = other`) — `funder`, `year`, and `doc_kind` are inferred from
folder and file names only, never from contents. The local mirror is also **1.6 GB of a 3.5+ GiB
corpus**, so the catalog undercounts; the walk writes `data/drive-unmatched.txt` listing Drive files with
no catalog row.

### Added — a diagnosis document for the Drive discovery failure, and a staleness banner on the old spec

`docs/data-sources/google-drive-discovery.md` — the diagnosis, the rule-outs, the ranked hypotheses with
a decisive test for each, and the ordered remediation. Written to hand the work to a branch rather than
leave it in a conversation.

Two things in it are worth knowing even if you never open it:

- **The `parentId`-is-not-recursive explanation is wrong, and this workstream published it.** Recursion
  by repeated `parentId` calls works fine elsewhere in the same Drive — `Meeting Transcripts` and
  `Project Management (do not ingest)` are nested just as deep under `Launchpad Internal AI OS` and list
  their children. The Grants tree specifically is unenumerable below its first level. The document
  records the rule-outs so the branch does not re-test them.
- **Root cause remains unconfirmed.** The best-fit hypothesis is a Shared Drive queried without
  `includeItemsFromAllDrives`, which matches the whole signature (get-by-ID works, listing returns empty,
  shortcuts unreadable). Settling it is one `files.get` with `fields: 'driveId'`, which needs credentials
  this workstream did not have. Stated as unverified rather than asserted.

`docs/data-sources/google-drive-connector.md` gained a warning banner. It scopes the connector to two
student documents, never mentions the grant corpus, and its "Sync Logic" step 2 — list a folder by name
pattern — is the exact operation proven not to work for that tree. Reconciling it is tracked as §7 of the
new document rather than left silent.

Also added `packages/grants/scripts/export-grant-catalog.ts`. Neither artifact on disk paired a document
with its Drive ID: `build-grants-index.ts` writes the index from the local mirror, which records no IDs,
and the IDs are attached later by the loader and the walk — landing only in Postgres. This exports the
pairing to `data/grant-catalog.{json,csv}`. Currently 9 of 1252 rows carry an ID, all Cambiar Education
`.gdoc`/`.gsheet` stubs.

Four classification bugs were found by validating against all 1252 real paths rather than a sample, and
each would have shipped silently: multi-year folders like `2026-2028 Grant` filed a 2026 application
under **2028** (spans now take the earlier year); `FY27` meant applied-in-**2026**, not 2027, since
Building 21's fiscal year starts in July (confirmed by that folder's own invoice reading `3.1.26-6.30.26`);
74 files dated `M.D.YY` parsed to no year at all; and `\bReport\b` never matched `Report_` because
underscore is a word character — filenames are now normalized before kind matching, which cut
`doc_kind = other` from 385 to 285.

---

## 2026-08-04 (later)

### Fixed — a confident WRONG match on the JEVS form, and bank v0.4.0 → v0.4.1 (board B6 / #62)

The B6 matcher quality review. **The review's main result is that B6 was measuring the wrong thing.**

B6's acceptance criteria measure **misses** — questions falling below the 0.42 threshold. Scanned across
all 106 questions in the seven form fixtures, **105 of 106 match confidently**, and the single miss is
the intended control (`What is your organization's policy on merchandise returns?`, 0.373 — a question
the bank should not answer, correctly routed to review). So the real form corpus has **zero genuine
misses** and the matcher's recall is not the problem.

The damaging class is the opposite one, and the criteria are blind to it. **A miss is the safe failure:**
the draft says "confirm this mapping" and a person looks. **A confident wrong match is not**, because it
routes to a knowledge-base slot and the draft presents that slot's content as the answer. Scanning each
confident match's `answer_type` against what the funder's wording asks for and against the stated limit
found four.

**The one fixed here.** `Does the organization have any connection with JEVS (including its Board of
Directors)?` matched `attachments.board_list` at **0.459, confidently**, on the shared words "Board of
Directors". A conflict-of-interest disclosure routed to `kb.docs`, so a draft offered an attachment
checklist as the answer to a yes/no question. No bank entry covered conflict of interest at all, and the
nearest correct candidate — `organization.board` — scored 0.361, below the floor. **That is a bank
coverage gap surfacing as a wrong answer rather than as a gap**, which is exactly why adding variants,
what B6 asks for, could never have found it.

Added `cover.funder_connection` (`boolean`, `kb_ref: null`, frequency `low`) under growth rule 1, with
the JEVS wording as its first variant. `kb_ref: null` is deliberate — whether a connection exists is a
fact about one application, not about LaunchPad, so no stored answer can hold it. Bank **87 → 88
questions, 247 → 248 variants, v0.4.0 → v0.4.1**.

**Both fixtures regenerated, control pass first in both cases**, per the harnesses in `scripts/`:

| Fixture | Control | Result |
|---|---|---|
| `matcher-parity.json` | 0 regression differences | 377 → **378 cases**. Exactly **one** existing case changed, and it is the defect. Nothing else moved. |
| `seq-ratio-parity.json` | 58,926 overlapping pairs, 0 regression differences, 690 pairs not yet covered | **59,616 pairs** over 353 strings, all reproducing exactly |

`seq-ratio.test.ts` is what caught the second fixture: the bank edit added candidate strings with no
recorded CPython ratio, and the suite **failed** on that state rather than staying green. That guard was
added on 2026-08-03 for precisely this case and this is the first time it has fired in anger.

Three regression cases added to `src/matcher.test.ts`, pinning the answer shape, the null `kb_ref`, and
that the real board-list attachment request did not follow the new canonical home.

**Three more confident wrong matches are recorded on `bd` `grant-h32`, not fixed here.** All on
`aug7_truist`, all matching at confidence 1.000 because all are recorded variants: the `demographic`
"Who does your solution serve…" question against a 200-word cap (the one `grant-miy` carved out for this
review — now diagnosed), and two `number`-typed budget questions against 150-word caps. None can be
fixed by retyping, because `answer_type` belongs to the **entry** and both entries involved are correctly
typed for their own canonical. Each needs a new canonical, which is a bank-design decision with a
`kb_ref` choice in it — recorded rather than guessed.

**Corrected — `grant-miy`'s count is 35, not 42.** Recounted at v0.4.1: of 43 non-narrative bank
questions, **35 route to a narrative KB slot** and **8 have `kb_ref: null`**. The 8 route to no slot at
all, so the pipeline returns `per_application` — the correct outcome, not a content gap. `grant-miy`'s
per-type breakdown counts all non-narrative entries and describes them all as routing to a narrative
slot. Excluding `attachment`, which its own criteria exclude, the KB content gap is **27 questions, not
34**. Full detail as a comment on that issue.

**Still open on B6, and it is a decision rather than work.** `How will you measure whether the program
succeeded?` remains at 0.352 and **cannot be fixed by adding variants** — measured 2026-08-03, the
shortfall is one unstemmed inflection (0.352 with `succeeded`, 0.644 with `success`), six real sourced
wordings were trialled, and none moved it. Both of B6's strings are the prototype's own smoke-test
samples (`matcher.py` lines 160–161) and appear in no funder form, so adding them would mean inventing a
funder source. The choice is accept the safe staff-review outcome, or adopt stemming and move the G2
parity baseline off the prototype that produced LaunchPad's filed applications. **Recommend accepting**
— the question has never occurred on a real form.

### Added — `grant_resize_answer`, the resize seam (board D3 / #73, gate G4)

`packages/grants/src/resize.ts`, `packages/grants/src/warnings.ts`, and
`apps/mcp-server/src/tools/grant-resize-answer.ts`. The port of the prototype's `resize.py`, and the
one module where the re-expression changes the architecture rather than the language: the resize loop
turns inside out.

```
prototype:  build_answer → resizer(text, limit, ctx) → ResizeResult   [in-process, networked]
now:        caller → grant_resize_answer(text, limit)          → handback
            caller rewrites
            caller → grant_resize_answer(text, limit, rewrite)  → verdict
```

`MAX_ATTEMPTS`, `make_resizer`, `DEFAULT_MODEL`, `ClaudeResizer`, and the retry loop do not port —
`admin/TAD.md` §5 decision 6 settled that on 2026-07-29. What ports is everything around that call:
the `_SYSTEM_PROMPT` guardrail (landed at G3 as `RESIZE_RULES`), `_build_user_prompt`'s context
assembly (landed at G3 as `buildHandback`), the unit re-measurement, the overflow feedback wording, and
the `ResizeResult` field set. `ResizeResult.model` is retained and is always `null`, exactly as the
prototype documented it for a non-LLM resizer.

**Tool surface: 22 → 23.** `readOnlyHint: true` like its siblings. Its `tool_permissions` row already
existed — migration `20260729000000_add_grant_tool_permissions` reserved it for `leadership` and
`admin` under category `grants` — so **no new migration was needed**. Confirmed by query on the local
database: `grant_resize_answer | {leadership,admin} | grants`. Every registered tool now has a
permission row, and the count of rows with no registered tool drops 7 → 6, all `future` placeholders.

**Added beyond the prototype: figure fidelity, and it is the reason to prefer this tool over a bare
re-measure.** `ResizeResult.figure_check` compares the numeric values in a rewrite against those in its
source and rejects one the source does not state, however well the rewrite fits. The prototype
re-measures length only, so a rewrite that trimmed forty words and moved a dollar figure by a digit came
back marked `fits` — and rule 1 of the guardrail calls exactly that output unusable. A rule nothing
checks is a suggestion. Dropping a figure stays allowed; rule 2 licenses it. **Callers must branch on
`accepted`, not on `fits_after_resize`** — the tool's own description says so, because the two differ
precisely in the dangerous case.

Measured against the real knowledge base: a tampered digit is detected in **all 29 slots that state a
figure**, with **no false positive** on either an identity rewrite or a genuine sentence-level trim.
This needed a second extraction pattern rather than reuse of `containsNumericClaim` — `\b\d{2,}\b` does
not span a thousands comma, so `8,000` tokenised as `000` and a rewrite moving it to `9,000` compared
equal. Comma-grouped counts are most of what grant prose states, so that miss would have covered most
of what a resize can get wrong. **Known gap, recorded in `figures.ts` rather than assumed away:** a
magnitude suffix is not part of the token, so `$1.34M` normalises to `1.34` and a restatement as
`$1.34B` reads as the same value. Catching that needs unit awareness, and the figure work order covers
it — every figure needs live `query_*` confirmation before publishing regardless.

### Changed — `handback.verify_with` now names `grant_resize_answer`

`packages/grants/src/handback.ts`. It named `grant_build_draft` deliberately until now, because
pointing a caller at a tool absent from `tools/list` produces a failed call and a model that improvises
around it. Two tests pinned the old behaviour on purpose and both flipped:
`packages/grants/src/handback.test.ts` and `apps/mcp-server/src/__tests__/tools.test.ts`. The latter now
asserts against the live `tools/list` result rather than a hard-coded name, since reachability is the
property that matters and hard-coding is what broke it.

**This also fixes an instruction that could not be followed.** The old wording told a caller to pass
rewritten text back through `grant_build_draft` "as the answer for this question" — and
`grant_build_draft` takes a whole form, with no parameter that accepts a rewritten answer. It was
asking for something the named tool could not do.

### Changed — the two data-honesty warnings moved to `warnings.ts`

Extracted from `pipeline.ts` so `resize.ts` appends the same strings rather than restating them. The
prototype's `test_resized_answer_keeps_unverified_warning` exists because a shortened answer that
quietly loses its "not grounded in a filed application" marker reads to a reviewer as more trustworthy
than the text it came from; two modules building that marker from two string literals is how it goes
missing from one of them. `resize.ts` reads the `verified` flag **from the knowledge-base slot** rather
than from the caller, so a caller cannot assert grounding an answer never earned. `verified: null`
(no slot named) appends nothing and is not a clean bill of health.

### Verified — gates G3 and G4 both passed, both on restated conditions

**G3's condition is restated as 20 pipeline parity cases and the 5 resizer cases move onto G4.** The
alternative was holding G3 open until G4 landed. Decided 2026-08-04. The shortfall was never about G3's
deliverable — `grant_build_draft` was complete — and a gate that reports a delivered tool as failed on
a condition naming code that cannot exist measures the condition rather than the tool. The five cases
are not dropped; they are the first half of G4's bar, in `src/resize.test.ts`.

**G4's bar is restated as 12 rather than 7**, and the second half of that number is the same finding as
G3's applied to `test_resize.py`: **6 of its 7 cases test the code `admin/SPEC.md` §2.2 says does not
port** — five `ClaudeResizerTests` and one `MakeResizerTests`. Four port, three have no analogue at all
(`MAX_ATTEMPTS`, `DEFAULT_MODEL`, `make_resizer`), and those three are recorded per case in `SPEC.md`
§1 rather than written as stand-ins that would pass without testing anything. So 5 + 4 = 9 parity
cases, plus 3 figure-fidelity cases the prototype cannot have a counterpart for. `SPEC.md` §4 gains a
`Portable` column making the same point across all three test files: 37 of the prototype's 45 cases can
be re-expressed, and the 8 that cannot are named.

**Suite: 183 → 207 tests across 13 files, all passing, zero skipped.** `packages/grants` alone is
141 → **162**, in 8 files. 18 new in `src/resize.test.ts`, 3 in `src/matcher.test.ts` for the B6 fix
above, and 3 new integration cases driving the tool
through the spawned server. `pnpm -r typecheck` passes across all fourteen packages and
`packages/grants` lints clean.

**What this does not say.** `grant_resize_answer`'s ACL path is unproven, exactly as
`grant_build_draft`'s is. Its permission row was confirmed by query, so it will resolve; nothing has
driven a real bearer-token call through it the way G1 did for `grant_match_question`. A green test run
is not evidence about permissions — `tool-helpers.ts` only calls `canCallTool()` when a caller is set,
and only `serve-http.ts` sets one.

---

## 2026-08-04

### Added — `grant_build_draft`, the form-to-draft pipeline (board D1 / #71)

`packages/grants/src/pipeline.ts` and `apps/mcp-server/src/tools/grant-build-draft.ts`. The port of
the prototype's `pipeline.py` — `build_answer`, `run`, `render_markdown` — completing the path
**form → match → knowledge-base retrieve → limit check → Markdown**. `count_units` and
`truncate_preview`, the other two functions `admin/SPEC.md` §2.2 assigns to this tool, had already
landed in `limits.ts` at G2 and were not re-ported.

**Tool surface: 21 → 22.** `grant_build_draft` carries `readOnlyHint: true` like its siblings. Its
`tool_permissions` row already existed — migration `20260729000000_add_grant_tool_permissions`
reserved it for `leadership` and `admin` — so **no new migration was needed** and the tool is
reachable on any database that has run `pnpm db:migrate`. Confirmed by query on the local database.

It takes either an inline captured form (`funder` + `questions[]`, each with an optional `limit`) or
`form_id` for one of the 7 stored fixtures. It returns per-question answer plans, the outstanding work
split into `your_tasks` and `staff_actions`, the rendered Markdown draft, and the figure work order.

**It makes no connector call, by design.** It returns the `query_*` calls a caller must run and the
caller runs them. `figures.ts` holds the reason: `runTool`'s permission check keys on the *inbound*
tool name, so a grant tool reading the database internally would be authorised as itself rather than
as `query_finances`, laundering finance and donor data past the role ACL. Do not "optimise" this.

**Resize is off, per the gate** — meaning this tool does not rewrite anything. It hands the work back.
See the next entry.

#### Added — `handback.ts`, the contract for work this layer gives back to the calling model

The mechanism that makes the layer an *assist* rather than a gate. The knowledge base exists so a
model does not regenerate answers LaunchPad has already written and approved; when a stored answer
does not drop straight into a funder's field, the material goes back to the calling model with the
limit, the measurement, and the rules, and the model does the shaping.

`RESIZE_RULES` is the prototype's `resize.py::_SYSTEM_PROMPT`, carried over as `admin/SPEC.md` §2.2
requires — including the load-bearing clause, "NEVER invent, add, infer, or embellish any fact,
figure, statistic, name, date, program detail, or outcome." `buildHandback`'s context assembly is its
`_build_user_prompt`: funder, emphasis to preserve, and what the stored answer answers.

**Shared on purpose.** `grant_resize_answer` (G4) emits the same payload. A model given a stricter
guardrail by one tool than by the other produces inconsistent drafts, so the payload is built once
here. That also makes G4 a small tool rather than a second implementation.

**No model client, and none is coming.** `TAD.md` §6 decision 6 already recorded why: an MCP tool is
invoked *by* Claude, so a tool that opened its own client would solve the wrong problem.
`@anthropic-ai/sdk` is in no `package.json` in this repository, and `ANTHROPIC_API_KEY` is declared in
`packages/config/src/schema.ts` but never read. Everything here stays unit-testable with no mocking
and no key.

`verify_with` deliberately names `grant_build_draft` and **not** `grant_resize_answer`, because only
the former is registered. Pointing a caller at a tool absent from `tools/list` produces a failed call
and a model that improvises around it. `handback.test.ts` asserts that; add the reference at G4.

#### Four branches that go beyond the prototype

Each exists because the prototype is demonstrably wrong on the real seed, and each is pinned by a
test in `src/pipeline.test.ts`:

| Branch | Actor | Why |
|---|---|---|
| `derive_from_reference` | `llm` | A field wanting a short structured value whose KB slot holds narrative. The prototype returns the prose as the answer; this hands it back as source material to derive the value from. |
| `needs_attachment` | `staff` | Split out of the above — an upload is the one outstanding task the calling model cannot do. A document is not text it can write. |
| `compression_infeasible` | `llm` | Over the limit by more than `MAX_COMPRESSION_RATIO` (4x). Still handed back, but carrying the warning that facts must be dropped and that the reply must name which. The prototype reports a 46x overrun identically to a 1.2x one. |
| `carries_figures` | — | Set from `containsNumericClaim`, independently of the KB's `verified` flag. |

The last matters most. `figures.ts` already recorded that `verified` is the wrong axis for
staleness — it fires on `kb.docs`, which holds no figures, and stays silent on `kb.metrics`, whose
wage figure drifts about $1,500 every four days. A `verified: true` answer full of moving figures is
both the common case and the dangerous one, so the two warnings are independent and both can apply.

#### Changed — outcomes name an actor, replacing a single "needs a human" flag

**This corrected a scope error made earlier the same day.** The first cut of this module treated every
unfinished question as human work: an over-limit answer, and a short field holding narrative, both
came back marked for a person with the text withheld from the answer slot. That inverts what the layer
is for. Shortening an answer and pulling a value out of prose are exactly what the calling model is
there to do; only a fact or a decision the layer does not hold needs a person.

So `AnswerPlan.needs_human: boolean` became `AnswerPlan.actor: 'none' | 'llm' | 'staff'`, with
`STATUS_ACTOR` exported as the single mapping and `summary.by_actor` counting all three. The tool
splits its outstanding-work summary the same way: `your_tasks` (with the handback attached, ready to
do) and `staff_actions`.

The difference is not cosmetic. On the `aug7_truist` fixture the old shape reported **9 of 17
questions needing a person**; the same form now reports **8 done, 8 the calling model can finish
immediately, and 1 genuinely needing staff** — the requested amount. A model reading the old output
would have stalled a draft that was ready to finish.

`renderMarkdown` follows: the header reads "N awaiting a rewrite · N awaiting staff", and source text
for owed work renders in a collapsed block labelled by task rather than as a blockquote that reads as
the answer.

### Found — the knowledge base cannot answer 42 of the 87 bank questions

Measured while building `reference_only`, and the reason that branch fires on 43 of the 106 questions
across the seven form fixtures rather than on a handful.

**Every non-narrative question in the v0.4.0 bank routes to a narrative KB slot.** All 42 of them:

| `answer_type` | Questions | Shortest slot it routes to |
|---|---|---|
| `field` | 15 | `kb.profile.state_pa`, 30 words |
| `single_select` | 8 | `kb.eligibility`, 124 words |
| `attachment` | 8 | `kb.docs`, 41 words |
| `boolean` | 5 | `kb.financials`, 116 words |
| `number` | 4 | `kb.metrics`, 184 words |
| `demographic` | 2 | `kb.profile.demographics`, 55 words |

The knowledge base holds 29 narrative answers and **zero short structured values**. So the sharpest
case is not a rounding error: Truist's `cover.project_title`, a 30-character "name of your solution"
field, routes to the 199-word `kb.program_desc`. The correct answer is "Launchpad".

This is a **content gap, not a code defect**, and `grant_build_draft` cannot close it — the honest
behaviour is to flag the field and hand the prose over as background, which is what it does. Closing
it means either adding short structured slots to `kb_launchpad.json` or accepting that ~40% of a
typical form is filled in by hand. **Not yet on the board**; it belongs with the Phase B content work.

One case inside that number is a bank-typing question rather than a content gap: Truist's "Who does
your solution serve, and in what ways will the solution impact their lives?" is typed `demographic`
and reads as narrative. The pipeline is not the right place to second-guess the bank's typing, so it
flags it like the rest.

### Verified — the G3 gate's second half, through the real server

`grant_build_draft` with `form_id: 'aug7_truist'` returns a 17-question draft package and a figure
work order scoped to the KB slots that draft used, asserted in
`apps/mcp-server/src/__tests__/tools.test.ts` against the spawned server rather than the library.
Full suite: **183 tests across 12 files**, up from 131 — 41 new in `src/pipeline.test.ts`, 8 in
`src/handback.test.ts`, and 3 new integration cases. `packages/grants` lints clean.

### Not verified — the G3 gate's first half, and why more code will not fix it

**G3 has not passed, and `admin/SPEC.md`'s own gate table now says so.** Its first half is "25
pipeline parity tests pass" and the real number is **20 of 25**:

| Prototype class | Cases | Where they are |
|---|---|---|
| `CountUnitsTests` | 5 | `src/limits.test.ts` — ported into `limits.ts` at G2 |
| `TruncatePreviewTests` | 3 | `src/limits.test.ts` — same |
| `BuildAnswerTests` | 9 | `src/pipeline.test.ts`, one for one |
| `ResizeHookTests` | 6 | 1 here (`resizer absent` ≡ resize off); **5 unportable at G3** |
| `RunTests` | 2 | `src/pipeline.test.ts`, one for one |

The five deferred cases inject a `ClaudeResizer` into `build_answer`. `admin/SPEC.md` §2.2 already
records that `ClaudeResizer` **does not port at all** — an MCP tool is invoked *by* Claude, so there
is no in-process resizer to inject, and `grant_resize_answer` returns instructions for the caller
instead. Those cases cannot pass before G4 exists, and writing stand-ins that pass without it would
make the gate report coverage it does not have.

**This is a gate decision, in the same class as G1's "three table rows, one registered tool".** Either
restate G3 as 20 cases and move the 5 onto G4 — making G4's bar 12 rather than 7 — or hold G3 open
until G4 lands. Recorded on board D1 (#71) and the D2 milestone (#72). Nothing about
`grant_build_draft` itself is outstanding.

### Not verified — `grant_build_draft`'s ACL path

Its `tool_permissions` row exists and was confirmed by query, so it will resolve. But nothing has
driven a real bearer-token call through it the way 2026-08-03 did for `grant_match_question`, and a
green test run is not evidence about permissions: `tool-helpers.ts` reaches `canCallTool()` only when
`currentCaller` is set, and only `serve-http.ts` sets it. Repeating the G1 method per tool is the only
thing that would settle it.

### Fixed — stale seed counts in `admin/SPEC.md` and `src/data.ts`

Both said the bank held 82 questions and 211–212 variants. It has held **87 questions and 247
variants** since v0.4.0 — `jq` over `seed/questions.json` settles it, and the `grant_match_question`
tool description already carried the correct figures. Found by grepping for the claims this change
falsified, per [`CLAUDE.md`](CLAUDE.md) §1.

---

## 2026-08-03

### Added — a `grant-writing` Claude Code skill that drives the deterministic layer, and a matcher defect it exposed

`README.md` describes `docs/PLAYBOOK.md` as "the source the grant writing skill is authored from"
while no such skill existed. It does now: `.claude/skills/grant-writing/`, with `SKILL.md` (the
workflow), `references/style.md` (voice, banned words, the two non-negotiables, the self-edit
checklist), `references/figures.md` (how to act on the 17 figure checks), and two scripts that drive
`@lp-ai/lib-grants` from the command line:

- `scripts/prep.mjs <form-id-or-path>` — refuses to run on a non-empty integrity report, then reports
  per question the matched bank entry and confidence, the KB slot, the `measure()` verdict against the
  funder's limit, a `GAPS` block, and the scoped figure work order. Reads only; makes no connector call.
- `scripts/count.mjs <drafts.json>` — `measureAll()` over drafted answers, plus em-dash and
  banned-jargon checks. Exits non-zero on any failure, so "within limits" cannot be asserted by eye.

This is distinct from the `skill_grant_writing` MCP tool, which returns a prompt and does not touch
the matcher, `limits.ts`, or `figures.ts`.

### Added — gap-fill: a researched-candidate path for questions the bank cannot answer

Previously a gap stalled the draft. `SKILL.md` said "write from live data or ask", so a form like the
NBA Foundation's — 9 low-confidence, 1 `no_kb_answer`, 1 `kb_unverified` out of 13 — produced a package
with holes. The skill now researches and drafts a candidate instead, via `references/gap-fill.md` and
two new scripts:

- `scripts/gapfill.mjs <form> --out candidates.json` classifies every gap (`unmatched`,
  `no_kb_answer`, `kb_unverified`, `low_confidence`) and emits a record per gap carrying the source
  ladder to work. `--validate` then enforces: non-empty answer, **at least one source**,
  `verified:false`, within limit, no em dash, no banned jargon.
- `scripts/corpus_search.py "<terms>"` searches prior filed applications in the grant corpus for how a
  question was already answered. This is the highest-yield rung and the most often skipped — the NBA
  Spring 2026 filing left "five most recent funders" blank while the Nov 2025 filing answers it.

**The verified boundary is preserved deliberately.** Candidates are `verified:false` and nothing writes
to `seed/kb_launchpad.json`; promotion is a human edit. `verified:true` there means grounded in filed
material, and an automated promotion path would turn every researched guess into apparent confirmed
fact one cycle later. Dollar amounts, the three framing choices, unconfirmed entity names, and
definitional figure conflicts still go to a person regardless of what research turns up.

### Added — `grant-writing-standalone`, a portable skill with no platform dependency

`.claude/skills/grant-writing-standalone/` carries the craft with none of the infrastructure: no
`@lp-ai/lib-grants`, no MCP tools, no knowledge base, no corpus. It builds a reusable fact base from
whatever the user supplies (`references/fact-base.md`), drafts against the funder's transcribed
questions, and verifies lengths with `scripts/check.py` — Python stdlib only, so the folder can be
copied into any Claude instance. Organization-agnostic, so it is usable outside Launchpad.

Verified decoupled: `grep -rn "lp-ai\|packages/grants\|query_\|Launchpad"` over that folder returns
nothing. Its counter uses Python `split()`, which is the same semantics `py.ts` ports for the platform,
so counts agree with `limits.ts` rather than merely approximating it.

**Defect found, not fixed — `matchQuestion()` mis-routes an unseen funder's need statement to the
mailing-address slot.** "Explain the issue that your program is seeking to address." returns
`cover.address` ("What is your organization's mailing address and contact information?", `kb_ref:
kb.profile.identity`) at confidence 0.353. The correct target is `need.problem_statement`, which
shares both `issue` and `address`. The verb "address" collides with the noun, and `cover.address`'s
shorter canonical wins on the weighted Jaccard. Reproduce:

```bash
node -e "const {matchQuestion}=await import('./packages/grants/dist/index.js');
console.log(matchQuestion('Explain the issue that your program is seeking to address.'))"
```

`DEFAULT_THRESHOLD` (0.42) marks it `is_confident: false`, so the gate holds and a drafter is warned.
The routing is still wrong, and a top-1 match presented without its confidence would answer a
statement of need with an address.

**Match quality collapses on a funder absent from the bank.** Against the NBA Foundation Spring 2026
form (13 questions, transcribed from `Prospects and Proposals/NBA Foundation/Spring 2026/`), 11 of 13
questions came back below threshold; against `hamilton_loi_2025`, a variant source in the bank, all 9
matched at 1.00. The bank's 247 wordings come from 24 forms and NBA is not one of them. Treat
`prep.mjs` output for a new funder as a triage list, not a routing decision.

### Security — plaintext funder-portal passwords across the grants corpus, redacted locally; rotation still required

**Scope is far wider than the two NBA documents first spotted.** A sweep of every `.docx`/`.xlsx` in
the corpus found **92 plaintext password occurrences across 73 files**, covering roughly 50 distinct
funder portals. The grant response template itself carries a "User Name / Password" row, so every
document copied from it inherited the field and staff filled it in.

Aggravating factors:

- **Heavy reuse.** `Building21!` appears across at least 12 unrelated funder portals. `A!BXRMYaBZr57Ty`
  is shared by the NBA Foundation and Nordstrom portals; `Samantha2008!` by NBA Foundation and the
  Philadelphia Foundation. One password compromises many portals.
- **A name-and-year password** (`Samantha2008!`) on funder portals suggests a personal password reused
  from outside work. Rotation needs to extend to wherever else it was used.
- Accounts span `melanie@b-21.org`, `Dannyelle@launchpadphilly.org`, `giving@launchpadphilly.org`,
  `tom@b-21.org`, and funder-issued portal identities.

**What was done.** All 92 occurrences were replaced with `[REDACTED PASSWORD]` in the two local copies
— the extracted tree at `/tmp/opencode/grants-zip/Grants/` and the archive at
`packages/grants/data/Grants-20260803T150803Z-1-001.zip`, which was unpacked, redacted, and repacked.
A re-scan of both reports zero remaining occurrences. Usernames were deliberately left in place: they
identify which account a document belongs to and are not secrets.

**What was not done, and matters more.** `packages/grants/data/` is gitignored and was never committed,
so there is no git history to purge — confirmed via `git log --all -- packages/grants/data/`. But the
**authoritative copies live in staff Google Drive and were not touched.** Redaction is not
containment:

1. **Rotate every password listed in the corpus**, treating all as compromised. Prioritize the reused
   ones and `Samantha2008!` wherever else it was used.
2. Purge or redact the Drive originals, including revision history and any Gmail attachments.
3. **Remove the "Password" row from `Grant Response Template (MAKE A COPY).docx` and
   `Grant Report Template (MAKE A COPY).docx`**, or every future copy reproduces this.
4. Move portal logins to a shared password manager and reference them by entry name.

`README.md` §6 bars sensitive data from this repository; the archive under `packages/grants/data/` is
how this corpus reached it.

### Fixed — mutation audit of the test suite: the integrity checker had no test that could fail, and the skip bound's soundness was argued but not asserted

The suite was audited by breaking the code on purpose — 16 single-line mutations across `data.ts`,
`limits.ts`, `py.ts`, `matcher.ts`, and `seq-ratio.ts`, each run against the full suite to see whether
any test noticed. 13 were caught. Three survived: two of them disabled integrity checks (item 1) and
one tightened the matcher's skip bound (item 2). **If you have a local clone:** `pnpm test` — expect
**131 passing across 10 files**, up from 118.

1. **The entire integrity report engine could be deleted with the suite still green.** Replacing
   `loadIntegrityReport()`'s body with `return []` failed nothing; so did disabling any individual
   check. Every assertion on it said the report is *empty* on the current seed, which a working
   checker on a clean seed and a checker that has stopped firing produce identically — and the
   latter is the failure that matters, because these warnings are what tells staff a KB slot was
   renamed out from under a question or a figure check. The seven checks account for ~130 lines that
   nothing exercised.

   The pure checks are now `computeIntegrityReport(bank, kb)` in `src/data.ts`; `loadIntegrityReport()`
   is the memoised wrapper over the seed on disk, unchanged in behaviour. `src/data.test.ts` runs each
   of the seven codes against a mutated deep copy of the real seed — a declared slot with no answer, a
   renamed figure slot, an attachment question on a narrative slot, and so on — and asserts the code,
   the severity, and that the message names the offending id. It also pins the two near-miss cases the
   checks must *not* flag: a `null` `kb_ref`, and an attachment question correctly routed to
   `kb.docs`. Mutating the checker now fails 8 tests where it previously failed none.

2. **`matchQuestion()`'s bounded skip could be tightened to `0.7 * J + 0.25` with the suite green.**
   The skip is only exact while `0.7 * J + 0.3` is a true upper bound on the blended score, and both
   the full-scan reference test and the prototype parity fixture are input-dependent: they diverge
   only if the bank happens to hold a candidate the tighter bound wrongly skips. At 0.25 none did, so
   an unsound optimization looked identical to a sound one. The bound is now
   `scoreUpperBound(jaccard)` — one exported function, the only place the constant lives — and
   `matcher.test.ts` asserts it against every one of the ~35,400 blended scores a reference pass computes
   in full. Both 0.25 and 0.299 now fail.

Two smaller items, no behaviour change: `pyLen`'s test asserted `'🚀'.length === 2`, a claim about
JavaScript that no change to this package can falsify, alongside a BMP-only case (`—≥⚠✅`) that passes
under a plain `.length` too and so proved nothing; it now uses a mixed astral string that does not.
Nothing else in the audit needed changing — the sequence-ratio parity fixture, the autojunk cases, the
`limits.ts` verdict and preview rules, and every `py.ts` primitive all caught their mutations,
including the ones that reintroduced the original bugs those tests were written for.

### Fixed — code review of `packages/grants`: a parity gate that had stopped covering the bank, and five latent defects

A review of the package and its build wiring. All 43 tests, typecheck, and lint passed before it, so
every item was either latent or a gate that had quietly stopped checking what it claimed. **If you
have a local clone:** nothing to run beyond `pnpm test` — expect **118 passing across 10 files**, up
from 82 across 8, because `limits.ts` and `py.ts` had no test file at all and now have one each.

1. **The G2 `difflib` parity fixture had gone stale, and the assertions could not detect it.**
   `src/__fixtures__/seq-ratio-parity.json` was generated on 2026-07-29 against the 82-question /
   211-variant bank and never regenerated for v0.4.0. 35 of the current 322 candidate strings were
   absent from it, including three of the six that now cross the 200-character autojunk threshold —
   `program.description`/WPF-2026 (352 chars), `organization.history`/JEVS-C2L (244), and
   `organization.why_this_funder`/Hamilton-2025 (221), the longest and most autojunk-exposed strings
   the v0.4.0 bank added. The suite stayed green because it asserted `pairs.length > 28_000` and
   `autojunk_candidates` `toHaveLength(3)`, both of which a stale fixture satisfies. So "G2 parity is
   intact — all 28,690 ratios unchanged", in the entry below, was true of the pairs recorded and
   silent about the ones that were not.

   Fixed three ways. The fixture was regenerated: **58,926 of 58,926 pairs reproduce CPython 3.14.6
   exactly**, and a control pass confirmed all 26,098 pairs carried over from the old fixture are
   bit-identical, so the new harness is not quietly a different measurement. Coverage now spans every
   candidate as `b`, every canonical and every captured form question as `a`, and every
   autojunk-crossing candidate in both orientations. The assertions are derived from the live bank
   rather than hard-coded — a candidate the fixture has never compared against CPython now fails
   `seq-ratio.test.ts`. And the generator, which had never been checked in, is now
   `scripts/regenerate-seq-ratio-parity.py` plus `scripts/dump-parity-strings.ts`; it needs no
   prototype checkout, since `ratio()` is CPython stdlib, and it takes its normalized strings from
   this package's own `normalize()` so the fixture cannot disagree with the port about tokenization.

2. **`scripts/regenerate-matcher-parity.py` silently skipped every form fixture.** `REPO_ROOT =
   parents[2]` resolved to `<repo>/packages`, so `repo_seed` pointed at a nonexistent
   `packages/seed`; `Path.glob` on a missing directory yields nothing, so `form_texts()` returned
   `[]` while the harness printed success. The documented procedure's "appends any new bank texts
   **and form-fixture question texts**" had never done the second half. Now `parents[1]`, and
   `form_texts()` raises on a missing directory rather than returning empty. Verified: 106 form
   question texts are found, all 106 already covered by the checked-in fixture, so no regeneration
   was needed — which is why this never surfaced. The next transcribed funder form would have been
   the first to go missing.

3. **Nothing validated the KB slot ids in `FIGURE_CHECKS`.** `loadIntegrityReport()` checked question
   `kb_ref`s and the `kb_launchpad.json` meta prose, but not `figures.ts`. Since
   `buildFigureWorkOrder()` scopes by intersecting `appears_in` with the caller's slots, one renamed
   KB slot would have dropped a `severity: 'high'` check — `employment_earnings_total`, say — out of
   every scoped work order, and the draft would publish the frozen `$350,268` with no verification
   step and no warning. That is the exact failure `figures.ts` exists to prevent. Added the
   `figure_check_ref_dangling` warning in `src/data.ts` and a test. All 26 refs resolve today.

4. **Four Dockerfiles' `deps` stages were missing three workspace manifests.** `packages/grants`,
   `connectors/bigquery`, and `connectors/roam` were absent from the `COPY */package.json` list in
   all of `apps/{mcp-server,aws-mcp-server,hq,sync}/Dockerfile` — 11 of the lockfile's 14 importers.
   The images build today only because grants' one dependency (`zod`) is already in the lockfile via
   other packages; the first grants-only dependency would fail the builder's `pnpm install
   --frozen-lockfile --offline` with `ERR_PNPM_NO_OFFLINE_TARBALL`. Verified by reproducing the deps
   stage in a scratch directory: with the three added, pnpm resolves all 14 importers and leaves
   `pnpm-lock.yaml` byte-identical.

5. **`measure()` read its verdict off the rounded display ratio, and accepted `max: 0`.** At 4.04x
   the ratio rounds to 4.0, compared false against `MAX_COMPRESSION_RATIO`, and came back
   `over_limit` with "cut the least-essential supporting detail" guidance for a text needing more
   than the 4x compression that constant exists to refuse. The verdict now uses the exact ratio and
   the display keeps rounding. `max` is validated as a positive integer — it is a public export and
   the seed schemas are not the only caller, so `max: 0` previously produced `ratio: Infinity` and
   guidance reading "(Infinityx)".

6. **A sentence-unit preview could itself be over the limit, and was unmarked.** `truncatePreview`
   splits with `pySplitSentences` (terminal punctuation *plus* whitespace) while `countUnits` counts
   with `pyCountSentences` (punctuation alone). Any decimal figure splits the two rules apart, and
   grant narrative is made of decimal figures: `'Our FY2025 budget is $1.34M. We serve 145 young
   people.'` is two chunks to the splitter and three sentences to the counter, so slicing to `max = 2`
   chunks returned the whole string as a "preview" that re-measures as `over_limit`. The branch now
   keeps chunks only while the counter agrees they fit, and marks the cut with `…` like the `words`
   and `characters` branches always did. Both prototype rules are unchanged — neither can move. One
   stated exception: when not even the first chunk fits, it is kept anyway, because an empty preview
   tells a reviewer nothing and cutting inside the chunk would mangle the figure.

7. **`pySplit`, `pyRstrip`, and `pySplitSentences` used JS `\s`, which is not Python's whitespace
   set.** Python treats U+001C–U+001F and U+0085 as whitespace and JS does not; JS matches U+FEFF and
   Python does not. Nothing in the seed hits either case today, but U+0085 rides in on text pasted
   out of Word or Drive, and the result would be a word count off by one against a hard funder cap —
   the same latent class `pyLen` is documented for. All three now use an explicit Python whitespace
   class, and `pyCountSentences` counts blank pieces by the same rule.

8. **`matchQuestion` re-normalized all 322 candidates on every call.** With `grant_match_question`
   accepting up to 200 questions, one call burned ~1.7 s of synchronous CPU in the single-threaded
   HTTP server, blocking every other request and `/health` for that window. Candidates are now
   normalized once per bank (`WeakMap`-keyed), and a candidate whose `0.7 * J + 0.3` upper bound
   cannot beat the incumbent skips the `difflib` call entirely. That second part is exact, not a
   heuristic — `sequenceRatio ≤ 1` and IEEE `+`/`*` are monotone, so the bound never sits below the
   true score, and a candidate only ever wins on a strictly greater score. A 200-question batch of
   real form questions went from ~1.7 s to 0.53 s. **Worst case is unchanged in kind:** 200 questions
   that match nothing keep the incumbent low enough that the bound never bites, and still cost ~1.2 s.
   Guarded by a new test that pins the result against a full-scan reference matcher on every captured
   form question and every autojunk-crossing candidate, in addition to the 377-case prototype fixture.

Also corrected, mechanically: the autojunk table in `src/seq-ratio.ts` (293 candidates and three
crossings, now 322 and six), and the suite counts in `CLAUDE.md` §3 and §6, `docs/runbooks/local-dev.md`,
`admin/ARCHITECTURE.md`, `admin/SPEC.md`, and `README.md`. The dated G2 result table in `admin/SPEC.md`
§5 is left as the 2026-07-29 record, with the re-verification noted beneath it.

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

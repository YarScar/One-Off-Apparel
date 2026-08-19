# MCP Server Spec

## Tool Availability

The server currently exposes **25 tools** — 16 data tools, `find_grant_documents`, `grant_match_question`, `grant_build_draft`, `grant_resize_answer`, and 5 `skill_*` tools — backed by Google Sheets, Aplos, Notion, and Google Drive connectors. Counted 2026-08-17 on `writing/dev` after `fix/google-drive-discovery` merged in; `main` is at 21. Semantic search uses pgvector with OpenAI `text-embedding-3-large` embeddings (1536 dimensions).

`main`'s 21 do **not** map onto a subset of these 25 in the obvious way, and the difference matters when reasoning about what production can answer. `main` lacks the three `grant_*` tools and the fifth `skill_*` tool, and it *has* `find_grant_documents` — which was deployed to production from `fix/google-drive-discovery` on 2026-08-06, before `main` became the only deploy branch. Merging this branch is what finally makes the repository and production agree on that tool. Verify the count with:

```bash
grep -c "NAME = '" apps/mcp-server/src/tools/*.ts | awk -F: '{s+=$2} END {print s}'
```

**Active tools (16):**
- `get_student_info` — Sheets student roster + Drive student info doc
- `query_outcomes` — Phase progression from Student Information sheet
- `query_enrollment` — enrollment statistics by phase, school, cohort, race, date ranges, with full per-student profile filters
- `query_certifications` — PCEP pass/fail results, scores, by phase
- `query_students` — population statistics + filtered lists with full demographic, academic, and post-program filter set
- `query_competency` — per-student competency scores and the rubric structure
- `query_finances` — Launchpad Dashboard, Phase Budget Dashboard (incl. monthly LiftOff/HS), Phase Actuals 2025 + Q3 2026, Rapid + PEX stipends, **and Building21 Development CRM** (giving history, prospect pipeline, denied, Launchpad pipeline, grants tracker, contacts)
- `query_donors` — Building21 Development CRM donor lookup (list / profile / summary). Profile mode joins one donor's record to their gift history, pipeline, Launchpad-specific asks, and grants
- `query_attendance` — three Launchpad cohort attendance sheets unified into `attendance_records`. By-student rates, aggregate breakdowns, raw event drill-downs
- `query_employment` — post-program employment data (employer, wages, hours, exit codes) from the Employment tab
- `query_postsecondary` — college enrollment tracking from National Student Clearinghouse data
- `search_conversations` — semantic search over Drive docs + Notion meeting transcripts (pgvector)
- `search_by_person` — document search scoped to a student or staff name
- `search_documents` — raw document chunk search with optional entity filter
- `get_entity_brief` — student profile + phase progression + certifications + recent mentions; **also surfaces donor profile + giving history + pipeline + grants** when the named person matches a donor
- `get_finance_brief` — Aplos fund balances, chart-of-accounts summary, and recent Aplos transactions

**Grant writing tools (3):** deterministic, and they read seed files in `packages/grants/seed/` rather than the database. No model, no network, no database in any of them.
- `grant_match_question` — funder question → canonical entry in the question bank
- `grant_build_draft` — captured funder form → reviewable draft package + figure verification work order
- `grant_resize_answer` — one stored answer + one stated limit → the measurement, the rewrite rules, and a check on the rewrite the caller sends back

**Grant document discovery (1):** listed apart from the three above because it is *not* one of them — it queries the `grant_documents` Postgres catalog, not the seed files, so it is a data tool that happens to serve grant work.
- `find_grant_documents` — funder / year / kind filters over the Drive Grants catalog → matching files and their Drive file IDs

**Still pending:**
- Slack connector for `search_conversations`

Composite tools (`get_entity_brief`, `get_finance_brief`) MUST gracefully omit sections whose underlying data source is not yet active, rather than erroring. Each section in the response should be optional and the tool should annotate which sources contributed.

## Overview

The MCP server exposes 25 tools to Claude. It runs as a Node.js HTTP server using the `@modelcontextprotocol/sdk` package with Streamable HTTP transport (or stdio for local desktop use). All tools are read-only — no writes to any data source.

Every tool call is logged to the `usage_logs` Postgres table (tool name, timestamp, duration, caller identity, token usage).

**Server location:** `apps/mcp-server/`
**Transport:** Streamable HTTP (production on ECS Fargate behind ALB) + stdio (Claude Desktop)
**Production URL:** `https://mcp.launchpadinc.org`

## Tool Definitions

---

### `query_outcomes`

Query Beacon competency outcomes for a student.

**Description shown to Claude:**
> Look up Beacon Learning Management System outcomes and competency assessments for a student. Returns competency levels and scores. Use this tool when asked about student progress, competency development, or academic outcomes.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "student_name": {
      "type": "string",
      "description": "Name, nickname, or ID of the student."
    },
    "competency": {
      "type": "string",
      "description": "Optional: filter to a specific competency name (partial match supported)."
    },
    "term": {
      "type": "string",
      "description": "Optional: filter to a specific term (e.g. 'Spring 2024')."
    }
  },
  "required": []
}
```

**Output Schema:**
```json
{
  "student": { "id": "uuid", "canonical_name": "Maria Garcia" },
  "outcomes": [
    {
      "competency": "Critical Thinking",
      "level": "Developing",
      "score": 2.5,
      "assessed_at": "2024-03-10",
      "term": "Spring 2024"
    }
  ],
  "entity_resolved": true,
  "entity_confidence": 1.0
}
```

---

### `get_student_info`

Retrieve a student's structured profile.

**Description shown to Claude:**
> Get structured profile information for a student — grade, cohort, program, IEP/ELL status, interests, goals, and known aliases across all data sources. Use this tool to understand who a student is before asking follow-up questions about their attendance or outcomes.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "student_name": {
      "type": "string",
      "description": "Name, nickname, or ID of the student."
    }
  },
  "required": ["student_name"]
}
```

**Output Schema:**
```json
{
  "student": {
    "id": "uuid",
    "canonical_name": "Maria Garcia",
    "student_id": "S1042",
    "grade": "11",
    "cohort": "2025",
    "program": "Launchpad",
    "email": "maria@school.edu",
    "iep": false,
    "ell": true,
    "interests": ["engineering", "robotics"],
    "goals": ["college readiness", "internship by senior year"],
    "known_aliases": [
      { "source": "slack", "alias": "@maria.g" },
      { "source": "sheets", "alias": "S1042" }
    ]
  },
  "entity_resolved": true,
  "entity_confidence": 1.0
}
```

---

### `search_conversations`

Semantic search across Slack messages and Notion meeting transcripts.

**Description shown to Claude:**
> Search Slack messages and Notion meeting transcripts for content relevant to a query. Returns the most semantically similar passages. Use this tool when asked about team discussions, decisions, or anything said in Slack or meetings.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Natural language search query."
    },
    "sources": {
      "type": "array",
      "items": { "type": "string", "enum": ["slack", "notion"] },
      "description": "Optional: limit to specific source(s). Searches both by default."
    },
    "top_k": {
      "type": "integer",
      "description": "Number of results to return. Default 8, max 20.",
      "default": 8
    }
  },
  "required": ["query"]
}
```

**Output Schema:**
```json
{
  "results": [
    {
      "source": "slack",
      "channel": "general",
      "author": "Jane Smith",
      "timestamp": "2024-03-15T14:22:00Z",
      "content": "...relevant passage...",
      "score": 0.92
    }
  ],
  "query": "spring showcase planning"
}
```

Only results with `score >= 0.75` are returned.

---

### `search_by_person`

Cross-source semantic search scoped to a specific student or staff member.

**Description shown to Claude:**
> Search all conversations (Slack and Notion meeting transcripts) for content about or involving a specific person. Resolves the person's identity across sources before searching. Use this tool when you want to find everything that's been said about a particular student or staff member.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "person_name": {
      "type": "string",
      "description": "Name, nickname, or handle of the student or staff member."
    },
    "query": {
      "type": "string",
      "description": "Optional: narrow the search with a semantic query within results for this person."
    },
    "top_k": {
      "type": "integer",
      "default": 10
    }
  },
  "required": ["person_name"]
}
```

**Output Schema:** Same as `search_conversations`, plus:
```json
{
  "entity": { "id": "uuid", "canonical_name": "Maria Garcia", "entity_type": "student" },
  "entity_resolved": true,
  "results": [...]
}
```

---

### `get_entity_brief`

Return a full summary card for a person — student profile + phase progression + certifications + recent Drive mentions, and **also** donor profile + giving history + pipeline + grants when the named person matches a donor in the Development CRM. Looks up student and donor sources in parallel; students take precedence when both match.

**Description shown to Claude:**
> Get a comprehensive brief on a student: profile, phase progression, certifications, and recent Drive document mentions. Also surfaces donor information (giving history, pipeline, grants) when the named person matches a Development CRM donor. Use this as a starting point when asked to summarize or give an overview of a person.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "person_name": {
      "type": "string",
      "description": "Name, nickname, or handle of the student, staff member, or donor."
    }
  },
  "required": ["person_name"]
}
```

**Output Schema:**
```json
{
  "entity": { "id": "uuid", "canonical_name": "Maria Garcia", "entity_type": "student" },
  "profile": { /* full students-table record (or null if entity is a donor) */ },
  "phase_progression": { /* student_phase_outcomes */ },
  "certifications": [ /* PCEP etc. */ ],
  "donor_profile": { /* Contacts row if matched, else null */ },
  "donor_giving_history": [ /* Launchpad-scoped gifts */ ],
  "donor_prospect_pipeline": [],
  "donor_launchpad_pipeline": [],
  "donor_grants": [],
  "recent_mentions": [ /* top 5 from search_by_person */ ],
  "sources_active": ["google_sheets", "google_drive"],
  "sources_deferred": ["slack", "notion"]
}
```

If the name resolves only to a donor, `entity.entity_type` is `"donor"` and student-side fields (`profile`, `phase_progression`, `certifications`) are null. If neither student nor donor matches, returns the student-side error or the donor ambiguity response.

This tool calls `getStudentInfo`, `queryOutcomes`, `queryDonors:profile`, and `searchByPerson` in parallel and aggregates results.

---

---

### `query_finances`

Look up financial data across multiple ingested sheets — Launchpad budgets and actuals, phase allocations, stipend transactions, and Building21 fundraising/development records. Each `query_type` maps to a specific tab in `finance_snapshots`. The handler is generic: it returns the row data with optional `fund` / `category` / `donor` text filters and a Launchpad scoping flag for CRM queries.

**Description shown to Claude:**
> Look up financial data — budgets, actuals, forecasts, fund balances, stipend transactions, and Building21 fundraising/development records. Use for spending, budget vs. actual variances, phase cost allocations, Rapid/PEX payment history, year-over-year trends, donor gifts, prospect pipeline, and grant lifecycle. Development CRM types (`dev_*`) cover all B21 fundraising; pass `launchpad_only=false` to see non-Launchpad data.

**Query types:**

| `query_type` | Source tab | Returns |
|---|---|---|
| `prior_month` | Prior Month Budget vs Actual | Last closed month actuals vs budget |
| `ytd` | YTD Budget vs Actual | YTD actuals vs budget |
| `forecast` | Rolling Forecast | Rolling monthly forecast |
| `monthly` | Monthly | Month-by-month detail |
| `fund_balances` | Combined Funds | Balances by fund |
| `annual` | Annual | Year-over-year totals |
| `budget_actuals` | Prior Month + YTD | Prior month + YTD combined |
| `phase_budget_dashboard` | `phase_dashboard:2025 actuals` | HS / LiftOff % allocations from Budget by Phase Dashboard "2025 Actuals" tab |
| `phase_budget_monthly_liftoff` | `phase_dashboard:monthly liftoff only` | Projected monthly LiftOff spend by account; columns are `projected_total_fy<year>` + 24 monthly fields (`jul_<year>` … `jun_<year+2>`) |
| `phase_budget_monthly_hs` | `phase_dashboard:monthly hs only` | Same shape, HS phase (HS = 101) |
| `q3_2026_actuals_global_pct/hc_pct/actuals` | `q3_2026_actuals:*` tabs | Cost allocation %, human capital %, account-level actuals from Q3 2026 by-phase actuals sheet |
| `phase_actuals_2025_global_pct/hc_pct/actuals` | `phase_actuals_2025:*` tabs | Same for the 2025 by-phase actuals sheet |
| `rapid_dashboard` | `rapid:Dashboard` | Monthly Rapid stipend totals by account |
| `rapid_transactions` | `rapid:FY2023..FY2025` | Individual Rapid payments |
| `pex_dashboard` | `pex:Dashboard` | Monthly PEX card totals by account |
| `pex_transactions` | `pex:FY2022..FY2026` | Individual PEX card transactions |
| `dev_giving_history` | `development:giving history` | Past gifts (gross_amount, donor_name, fund_name, project, fiscal_year, …) |
| `dev_prospect_pipeline` | `development:prospect pipeline` | Open prospects with strategy / owner / next_action |
| `dev_denied` | `development:denied` | Prospects that were denied |
| `dev_launchpad_pipeline` | `development:launchpad pipeline` | Launchpad-specific asks (already Launchpad-scoped; ask_amount, status, fy, month, probability) |
| `dev_grants_tracker` | `development:grants tracker` | Grants lifecycle (deadlines, report due dates, period start/end, restrictions) |
| `dev_contacts` | `development:contacts` | Donor master records (donor_name, donor_type_coa, status, primary_fund, lifetime_giving, FY giving totals) |
| `aplos_accounts` | `aplos:accounts` | Aplos chart of accounts (account_number, name, category, type, activity) |
| `aplos_funds` | `aplos:funds` | Aplos fund snapshots (fund name, balance_account_name, snapshot_date) |
| `aplos_transactions` | `aplos:transactions` | Aplos accounting transactions (date, amount, memo, contact) |

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query_type": { "type": "string", "enum": ["prior_month", "ytd", "forecast", "monthly", "fund_balances", "annual", "budget_actuals", "phase_budget_dashboard", "phase_budget_monthly_liftoff", "phase_budget_monthly_hs", "q3_2026_actuals_global_pct", "q3_2026_actuals_hc_pct", "q3_2026_actuals", "phase_actuals_2025_global_pct", "phase_actuals_2025_hc_pct", "phase_actuals_2025_actuals", "rapid_dashboard", "rapid_transactions", "pex_dashboard", "pex_transactions", "dev_giving_history", "dev_prospect_pipeline", "dev_denied", "dev_launchpad_pipeline", "dev_grants_tracker", "dev_contacts", "aplos_accounts", "aplos_funds", "aplos_transactions"] },
    "tab_name": { "type": "string", "description": "Override the tab_name match (advanced). Matched case-insensitively, but escaped first." },
    "period": { "type": "string", "description": "Exact match on the period column." },
    "contains": { "type": "string", "description": "Substring match against the JSON-serialized rowData." },
    "limit": { "type": "number", "description": "Default 500, capped at 1000." }
  },
  "required": ["query_type"]
}
```

**Output Schema (every query_type):**
```json
{
  "query_type": "...",
  "tab_names_matched": ["phase_dashboard:2025 actuals"],
  "tab_names_returned": ["phase_dashboard:2025 actuals"],
  "record_count": 174,
  "total_matching": 174,
  "total_matching_is_lower_bound": true,
  "truncated": false,
  "contains_applied": "…",
  "scan_incomplete": "Searched N of M rows for \"…\" (…). total_matching is a lower bound; …",
  "records": [ /* row_data fields, vary by tab. See connector docs for column names. */ ],
  "sources": ["google_sheets", "aplos"]
}
```

`contains_applied` appears only when `contains` was passed. `scan_incomplete` and
`total_matching_is_lower_bound` appear only when the `contains` scan did not reach every matching
row — either because the tab exceeds the 5000-row scan cap, or because the scan stopped as soon as it
had enough matches to fill `limit` and prove truncation.

**`tab_names_matched` vs `tab_names_returned`.** The first is computed over the filter, independent of
`limit`; the second describes the page. They differ whenever a limit bites, and only the first can be
read as "which tabs hold data": `budget_actuals` spans tabs whose rows sort under different `period`
values, so one tab lands entirely ahead of the other and a small limit made the second look empty.

**Why `total_matching` and `truncated` exist.** An empty or short result set used to be
indistinguishable from a missing tab. That is the specific way this tool misled callers — see
[the silent-empty-results runbook](runbooks/mcp-silent-empty-results.md). `record_count` is what was
returned; `total_matching` is what the filter actually matched.

**`total_matching` is a lower bound when `total_matching_is_lower_bound` is set.** With `contains`,
matching happens in memory over a paged scan that stops early, so the count is a floor, not a total —
quote it as "at least N" or raise `limit` to search further. Reporting a partial count as final was
the original defect in these two fields: over the ~16K-row `aplos:transactions` tab,
`contains: "grant"` returned `total_matching: 3, truncated: false`.

**`budget_actuals` spans two tabs, so it double-counts by construction.** The same account line
appears once for prior month and once for YTD. Split on each record's `tab_name` before summing or
differencing.

**Tab matching is exact, and deliberately not case-insensitive.** Prisma compiles
`mode: 'insensitive'` to `ILIKE` and passes the value through unescaped, so the `%` in
`q3_2026_actuals:global %` would become a wildcard and claim rows from any tab sharing that prefix.
The tab names in the table above are copied from the connectors that write them, and
`finance-tab-map.test.ts` locks the casing. Seed-only aliases (`ytd`, `fund_balances`) are matched
alongside the live names so seeded databases stay reachable. A caller-supplied `tab_name` override
stays case-insensitive for convenience, but is escaped before use.

> **Doc drift, corrected 2026-08-12.** This section previously documented `fund`, `category`,
> `row_type`, `launchpad_only` and `donor` input filters, a `tabs_queried` / `launchpad_only` output
> pair, and a "Launchpad scoping" rule keyed on `TABS_WITH_LAUNCHPAD_FILTER`. **None of those exist in
> `query-finances.ts`** — no such symbol appears in the file. Donor-scoped and Launchpad-scoped CRM
> lookups are served by `query_donors`, which does implement them. Removed rather than recorded,
> because unlike the tab-name casing below there was no code behaviour to preserve.

---

### `query_donors`

Donor lookup against the Building21 Development CRM (Contacts tab + linked records). Three modes:
- `list` — donors filtered by name / type / status
- `profile` — full record for one donor + linked Giving History + Prospect Pipeline + Launchpad Pipeline + Grants + prior declines
- `summary` — donor count and lifetime giving total, by fiscal year

> **Repointed 2026-08-19, work package #306.** This tool, `get_entity_brief`'s donor arm and
> `get_finance_brief.recent_gifts` read the typed `donor_contacts` / `donor_gifts` / `donor_pipeline`
> tables. **No connector has ever written them** — `packages/db/src/seed.ts` is their only writer in
> the repo, and Givebutter, the source `schema.prisma` names, has no connector. All three returned
> nothing in production while their descriptions promised Development CRM data.
>
> They now read the `development:*` tabs in `finance_snapshots` — the same rows `query_finances`'s
> `dev_*` query types serve — via `apps/mcp-server/src/dev-crm.ts`. Four behaviours follow, and each
> one changes a number a caller might quote:
>
> 1. **`launchpad_only` defaults to `true` and is now actually applied.** The previous implementation
>    accepted the flag and never read it, so every response was all-Building-21 scope while the
>    description promised Launchpad-only. Every response carries `scope` and `scope_note`.
> 2. **Giving totals are summed from individual gift rows**, not read from the Contacts tab's
>    `lifetime_giving` / `fy25_giving` / `fy26_giving` columns, which are **wrong at source** — William
>    Penn Foundation reads `$0.00` lifetime against a real `$1,600,000.00`. Summing also makes
>    `launchpad_only` mean something for a total, which a precomputed all-scope column cannot support.
> 3. **`giving_summary.by_project` splits Launchpad from the other projects.** This matters: William
>    Penn gives $500,000/yr of which **$425,000 is Launchpad** and $75,000 is Network Unrestricted.
>    Quoting $500,000 as the Launchpad grant overstates it by $75,000/yr.
> 4. **A funder with no Contacts row still resolves.** The Contacts tab is a stewardship roster, not
>    the set of everyone we have asked, so a name found only on the giving-history, pipeline or denied
>    tabs returns a profile with `profile: null` and a `profile_note` rather than `no_records`. Without
>    this, a funder that had *declined* us was invisible — the most framing-relevant record there is.
>
> Name matching is confined to the name columns (`donor_name`, `funder`, the split person columns).
> `query_finances`'s `contains` matches the serialized row, so searching it for "William Penn" also
> returns Project Based Learning, Inc. — whose `primary_fund` is "William Penn". Reporting one
> organisation's giving under another's name is worse than returning nothing.
>
> `no_records` now distinguishes three cases: out of Launchpad scope (retry with
> `launchpad_only=false`), absent from Contacts but present on a transaction tab (returns a profile),
> and absent everywhere. The old undifferentiated `no_records` read as "this funder has not given" when
> it meant "no donor exists anywhere", which is how a 2026-08-19 drafting run filed
> `[DATA UNAVAILABLE]` for four funders with live history.

**Description shown to Claude:**
> Look up Building21 donors and donor relationships from the Development CRM. Use for questions about specific donors ('what has Vanguard given'), donor population breakdowns ('how many active foundations'), or pulling a complete donor profile (gifts, pipeline, grants). Defaults to Launchpad-only data — set `launchpad_only=false` to see all B21 development data. For aggregate finance views (total raised, pipeline value by month, etc.), use `query_finances` with the `dev_*` query types instead.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query_type": { "type": "string", "enum": ["list", "profile", "summary"] },
    "donor_name": { "type": "string", "description": "Required for 'profile'. Partial, case-insensitive name match. Multiple matches return ambiguous=true with candidates." },
    "donor_type": { "type": "string", "description": "List only. Filter by donor_type_coa (Individual / Foundation / Corporate / Government / EITC) — exact, case-insensitive." },
    "status": { "type": "string", "description": "List only. Filter by donor status (Active / Inactive / Prospect)." },
    "launchpad_only": { "type": "boolean", "description": "Default true. On profile results, filters linked records (gifts / pipeline / grants) to those whose Fund or Project mentions 'Launchpad'. The Contacts record itself is always included." }
  },
  "required": ["query_type"]
}
```

**Output Schema (`profile`):**
```json
{
  "query_type": "profile",
  "matched_name": "William Penn Foundation",
  "contact_id": "D-197",
  "launchpad_only": true,
  "profile": { /* full Contacts row */ },
  "giving_history": [ /* linked gifts, Launchpad-scoped */ ],
  "prospect_pipeline": [ /* open prospects */ ],
  "launchpad_pipeline": [ /* Launchpad-specific asks */ ],
  "grants": [ /* grants tracker rows */ ]
}
```

If the name resolves to multiple donors, returns `ambiguous: true` with a `candidates` array instead.

**Output Schema (`summary`):**
```json
{
  "query_type": "summary",
  "total_donors": 253,
  "by_donor_type": [{ "donor_type": "Individual", "count": 129 }, ...],
  "by_status": [{ "status": "Active", "count": 135 }, ...],
  "lifetime_giving": { "total": 19078234.50, "contributing_donors": 246 }
}
```

---

### `get_finance_brief`

Return a high-level financial overview — Aplos fund balances, a chart-of-accounts category summary, recent Aplos transactions, and recent donor gifts.

**Description shown to Claude:**
> Get a high-level financial overview of the organization: Aplos fund balances, chart-of-accounts summary, recent Aplos transactions, and recent donor gifts. Use this as a starting point for any general finance question.

> **This tool carries no income or expense total.** The heading and the Claude-facing description both
> claimed "YTD revenue vs. expenses" and "top campaigns" until 2026-08-12; neither is computed
> anywhere in `get-finance-brief.ts`, and `period` only labels the response — it does not aggregate.
> Grant drafting spent a cycle treating the absence as "the organization has no budget data". For an
> annual budget total, read the `Combined Funds` tab via `query_finances(fund_balances)`, which holds
> account-level totals across every fund.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "period": {
      "type": "string",
      "enum": ["ytd", "last_30_days", "last_quarter"],
      "description": "Time period for income/expense summary. Defaults to 'ytd'.",
      "default": "ytd"
    }
  },
  "required": []
}
```

**Output Schema:**
```json
{
  "period": "ytd",
  "aplos_funds": [ /* fund records from Aplos (name, balance_account_name, snapshot_date) */ ],
  "aplos_accounts_summary": {
    "total": 232,
    "by_category": { "asset": 40, "liability": 12, "revenue": 80, "expense": 90, "equity": 10 }
  },
  "recent_transactions": [ /* last 20 Aplos transactions (date, memo, amount) */ ],
  "sheet_fund_balances": [ /* Google Sheets fund balance rows from the Combined Funds tab */ ],
  "recent_gifts": [ /* last 10 development:giving history rows, in SHEET ORDER — see note */ ],
  "recent_gifts_note": "…",
  "sources_active": ["aplos", "google_sheets"]
}
```

Queries Aplos (`finance_snapshots` with `aplos:*` tab names) and Google Sheets fund balances directly.

**`recent_gifts` was always empty until 2026-08-19 (#306).** It read `donor_gifts`, a table no
connector writes. It now reads `development:giving history`. Two caveats carried in
`recent_gifts_note`: these are the **last ten rows in sheet order**, not a computed top-ten-by-date —
the tab's `date` cell is a display string (`"Aug 2025"`) and is not sortable — and they are
all-Building-21 scope. Use `query_donors` for a Launchpad-scoped view.

**`aplos_funds` is pinned to one snapshot date.** The Aplos connector snapshots funds daily, so an
unbounded "newest 50" spanned two `period` values and truncated the newest one — a caller reading the
list saw duplicate fund names and an incomplete current picture. The query now resolves the newest
`period` first and returns only that day's funds (up to 200).

**`sheet_fund_balances` matches `Combined Funds`.** The dashboard sync writes that tab name; the
seed's name is `fund_balances`. Both are matched **exactly and case-sensitively** — a tab written
`combined funds` would still be missed, and the fix for that is another entry in the array, not a
relaxed match. Looking for only the seed name is why this array was empty against real data.

**`sheet_fund_balances` is a page, and says so.** It is ordered by `tab_name` then `source_id`, not by
`period`: for dashboard tabs `period` is a selector-cell string shared by every row in the tab, so
ordering by it is arbitrary. The response carries `sheet_fund_balances_total`, and
`sheet_fund_balances_truncated` when the 500-row cap bites. Do not sum a truncated page — the note
above points at `query_finances(fund_balances)` for an annual budget total, and that is the call to
make for any figure that has to add up.

---

### `query_enrollment`

Aggregate student enrollment data from `student_phase_outcomes`. Supports total headcount, phase breakdowns with optional status filter, date-range active queries, school / cohort / race breakdowns, per-student rows with the full demographic filter set, and per-Launchpad-cohort grad/retention rates.

**Query types:**
- `total` — all-time headcount
- `by_phase` — count per phase, optional `status` filter (Completed / Dropped Before Completion / In Progress / Not Enrolled)
- `active_during` — students enrolled in a phase during a date window
- `by_school` — breakdown by school name
- `by_cohort` — breakdown by HS graduation year
- `by_race` — breakdown by race / ethnicity
- `by_student` — per-student records with phase statuses, supports the **full student-info filter set** (race, gender, school, current_phase, enrollment_status, withdrawal_code, entry/withdrawal date ranges, city, zip, college_enroll, university, major, workforce_*, internship_status, income range, parental_ed range, plus numeric range filters on interview/GPA/algebra/geometry scores)
- `by_program_year` — grad/retention rates per Launchpad cohort year (grouped by foundations_start_date), supports `liftoff_graduating` and `phase_101_graduating` projections

`by_student` is the right tool for sliced retention queries (e.g., "101 retention for African American students" → `query_type=by_student`, `phase=101`, `race='Black or African American'`, then tally `phase_101_status` on the result).

**Filters, and how they are reported.** The input schema accepts `phase`, `status`, `current_phase`,
`enrollment_status`, `cohort`, `start_date` and `end_date`. `phase` and `status` are
`student_phase_outcomes` columns; `current_phase`, `enrollment_status` and `cohort` are `students`
columns. **All five apply to every `query_type`** — student columns reach phase-outcome queries
through the `student` relation, and `phase` / `status` reach student-level queries through
`phaseOutcomes: { some: ... }`. `phase` without `status` means "this phase has an outcome at all";
`status` without `phase` means "any phase carries this status".

`start_date` / `end_date` are read only by `active_during`.

Every response carries `filters_applied`, and `filters_ignored` when a supplied filter does not apply
to the chosen `query_type`. This matters because until 2026-08-12 several branches accepted filters
and silently discarded them — `by_phase` built a student predicate and never used it, and
`active_during` discarded the student filters and `status` entirely — so a caller who scoped to the
Lightspeed completers received every student with nothing in the envelope to say so. A silently
unscoped count is a wrong denominator, which is the specific way this tool can mislead.

Filter presence is tested, not truthiness, so `cohort: 0` is a filter like any other. A blank or
whitespace-only string is treated as **absent on every `query_type`** rather than as a literal
column match, and string filters are trimmed. A blank filter is named in `filters_ignored`: it
reaches no query, and a caller who believes a blank narrowed their query needs the envelope to say
otherwise, or "treated as absent" becomes its own silent unscoping.

`active_during` and `by_student` report `student_count` as the number of rows matching the filters,
counted separately from the page they return. When the page is short of that count they add
`truncated: true`, `returned` (rows in this response) and `limit`. Reporting the page size as the
count is the same wrong denominator as a dropped filter, reached from the other direction — and with
`limit` defaulting to 500, a caller with more matches than that sees a plausible number rather than
an obviously clipped one.

On `active_during`, `phase` is a predicate and not merely a column selector. That distinction is the
one thing this section got wrong when it was written: `PHASE_FIELDS[phase]` chose which columns
`status` and the dates were applied to, while `phase` itself never entered the `WHERE` clause. A call
supplying dates hid the defect, because a non-null date column implies the phase exists; a dateless
call — legal, since only `phase` is required — returned every outcome row in scope beside a
`filters_applied` naming the phase. `active_during` now composes the same predicate as every other
branch, so `phase: 'LiftOff'` cannot count a student with no LiftOff data.

> **Doc drift, unfixed.** The `by_student` bullet above claims a "full student-info filter set"
> (race, gender, withdrawal_code, entry/withdrawal date ranges, city, zip, college/workforce fields,
> income and parental-ed ranges, numeric score ranges) and the `by_program_year` bullet claims
> grad/retention rates with `liftoff_graduating` / `phase_101_graduating` projections. **Neither is in
> the code.** `query-enrollment.ts` accepts the seven filters listed above and nothing else, and
> `by_program_year` is a plain `groupBy` on `hsGraduationYear`. Those filters do exist on
> `query_students`. Recorded here rather than silently corrected, because closing it is a tool change
> with its own review.

---

### `query_students`

Population-level analytics on the `students` table. Supports numeric stats (avg/min/max/quartiles), categorical breakdowns, and filtered list pulls. Filters cover every queryable column on the students table (PII columns like email/phone/street are intentionally excluded at ingest).

**Query types:** `numeric_stats`, `breakdown`, `list`.

**Numeric fields:** interview_score, tech_interest_onboarding, interview_passion_score, interview_college_score, hs_gpa, algebra1_grade, geometry_grade, zip, distance_to_office_miles.

**Categorical fields (for breakdown):** current_phase, enrollment_status, cohort, neighborhood, zip, school_name, hs_graduation_year, withdrawal_code, college_enroll, university, major, workforce_program_referral, workforce_referral_status, internship_status, parental_ed, income.

> Note: as of the current implementation, only `current_phase`, `enrollment_status`, `cohort`, `neighborhood`, `zip`, `school_name`, `hs_graduation_year`, and `withdrawal_code` are wired into `BREAKDOWN_FIELDS`. `distance_to_office` and `hs_graduation_year` are wired into the `filter_field` numeric-range filter (`filter_min`/`filter_max`); only `distance_to_office` is wired into `NUMERIC_FIELDS` (the `numeric_stats` aggregate query type). The remaining fields below describe the original design intent but are not yet implemented — treat them as a backlog, not current behavior.

**Filter set (all query types):** enrollment_status, current_phase, cohort, school (partial match on school_name), hs_graduation_year (exact match; range via `filter_field=hs_graduation_year`), dob_start / dob_end (ISO date bounds on date of birth), withdrawal_code (exact match), withdrawal_date_start / withdrawal_date_end (ISO date bounds), zip, plus numeric range on distance_to_office via `filter_field` + `filter_min` / `filter_max`. The five exact-match filters — `enrollment_status`, `current_phase`, `cohort`, `hs_graduation_year`, `withdrawal_code` — are domain-checked as of `#210`: a value absent from its column returns a `no_records` error listing the values present, instead of an empty answer. `school` is a substring match and is deliberately not checked that way. See [the silent-empty-results runbook](runbooks/mcp-silent-empty-results.md). Everything else in this line — race, gender, graduation_year (LP program), entry_date_start/end, city, college_enroll, university (partial), major, workforce_program_referral, workforce_referral_status, internship_status, income/parental_ed ranges — is not yet implemented (see note above).

`withdrawal_code`/`withdrawal_date` are designed as join keys for cross-tool analysis: pull a `student_number` list filtered by withdrawal reason or date here, then feed those numbers into `query_certifications`, `query_attendance`, etc. to correlate withdrawal with outcomes in other data sources.

---

### `query_certifications`

Certification data (PCEP, future certs) — pass/fail rates, scores, and breakdowns by cert type, LP phase, date range, or student zip code.

**Query types:** `summary`, `by_type`, `by_phase`, `by_result`, `by_zip`, `scores`.

**Filters:** `type`, `phase`, `result` (Pass / Fail), `start_date`, `end_date` — all apply to `by_zip` too.

As of `#210`, `phase` is matched against the distinct values that column holds; an absent
value returns a `no_records` error listing the phases present, rather than
`{ total: 0, passed: 0, pass_rate_pct: null }`, which reads as "nobody in that phase has
certified". `type` is a substring match and is not checked that way; `result` is an enum
and is rejected before the handler runs.

`by_zip` joins to `students.zip` (zip isn't a column on `student_certifications`) and returns `{ zip, count, avg_score }` per zip, e.g. `query_type=by_zip, type=PCEP` for average PCEP score by zip code. Rows with a null zip are excluded.

---

### Truncation reporting (`query_competency`, `query_students`, `query_enrollment`, `query_finances`)

Every query_type that returns a capped page of rows emits the same four keys:

| Key | Meaning |
|---|---|
| `record_count` | Rows in **this response**. Never a population figure. |
| `total_matching` | Rows matching the filter, counted in the database independently of `limit`. |
| `truncated` | `record_count < total_matching` — the rows are a sample. |
| `limit` | The cap applied, so a caller knows what to raise. |

**Quote `total_matching`; never quote `record_count`.** Where a tool also returns a
domain-specific name — `query_enrollment`'s and `query_students`'s `student_count` — that name
now carries the true total on every path, matching `query_enrollment({query_type: "total"})`.
`query_finances` additionally reports `total_matching_is_lower_bound` when a `contains` scan
stopped early.

---

### `query_competency`

Per-student competency data (scores), the rubric structure (skills + opportunity totals by
phase and term), or an org-wide growth aggregate.

**Query types:** `scores`, `rubric`, `growth_aggregate`.

**Filters:** `student_number`, `competency` (partial match), `limit` (default 500, max 1000;
`scores` and `rubric` only).

`scores` and `rubric` return a page and report it as one: `record_count`, `total_matching`,
`truncated` and `limit` (see "Truncation reporting" below). `growth_aggregate` reads every
matching row and returns scalars — `avg_growth`, `min_growth`, `max_growth`, `avg_baseline`,
`avg_performance_level`, `avg_progress`, `row_count`, `student_count`, the per-column non-null
counts that are the real denominators, and a `by_competency` breakdown.

**Quote growth from `growth_aggregate`, never from `scores` rows.** `scores` capped at 1000 of
~2346 rows and said nothing (#276), so any figure averaged from its response described an
arbitrary slice of the organization.

---

### `grant_match_question`

Match a funder application question to a canonical entry in the LaunchPad grant question bank (88 questions, 11 categories, 248 recorded funder wordings). Deterministic — no model, no database, no network; it reads seed files in `packages/grants/seed/`.

**Inputs:** `question` (one string) or `questions` (array, max 200); optional `threshold` (defaults to 0.42, the value used for LaunchPad's filed applications).

**Returns:** per-question `matched_id`, `kb_ref`, `answer_type`, `confidence`, `matched_via`, and `is_confident`, plus `integrity_warnings`.

**`is_confident: false` means the question has no reliable stored answer.** Do not route it to the returned `kb_ref`.

---

### `grant_build_draft`

Resolve a captured funder form into a reviewable draft package: match each question, retrieve the mapped knowledge-base answer, measure it against the funder's stated limit, and flag what a person must do. Deterministic, and it reads seed files only.

**Inputs:** either `funder` + `questions[]` (each `{ text, limit?: { unit, max } }`, max 200) or `form_id` for a stored fixture; optional `program`, `due`, `framing`, `threshold`, `include_markdown`.

**Returns:** `results[]` (one answer plan per question), `summary` (including `by_actor`), `your_tasks`, `staff_actions`, `kb_refs_used`, `figure_work_order`, `integrity_warnings`, and the rendered `markdown` draft.

**Every result names an actor — who does the next step:**

| Actor | Statuses | Meaning |
|---|---|---|
| `none` | `fits`, `ready` | Text is ready for staff review. |
| `llm` | `needs_resize`, `needs_expand`, `compression_infeasible`, `derive_from_reference`, `fetch_figure` | **Yours to finish.** See the payload rule below. |
| `staff` | `needs_attachment`, `per_application`, `needs_review`, `kb_gap`, `kb_placeholder`, `figure_definitional` | Needs a fact or a decision this layer does not hold. |

**Every `llm` result carries exactly one of two payloads**, and a caller that reads only the first
will silently skip work:

- **`handback`** — the shaping tasks (`needs_resize`, `needs_expand`, `compression_infeasible`,
  `derive_from_reference`). Carries the source text, the limit, the measurement, and the rules. On a
  `needs_expand` task it also carries **`anchor_value`**: a confirmed short value that must appear in
  your answer unchanged, with `source_text` as material to build around it. That task's limit is a
  **ceiling, not a target** — writing less than the limit is correct when the source supports no more.
- **`figure_call`** — `fetch_figure` only. The work is running the named `query_*` call under your own
  identity and writing the live number, not reshaping text, so there is nothing to hand back.

**Three contracts worth knowing before you call it:**

- **The knowledge base is an assist, not a gate.** It exists so you do not rewrite answers LaunchPad has already written and approved. Where a stored answer does not drop straight into a field, you shape it from the `handback` — the tool never calls a model to do that for you, and there is no Anthropic client anywhere in this repository.
- **It makes no connector call.** `figure_work_order` names the `query_*` calls *you* must run to verify every figure. This is a security boundary, not an oversight — `runTool`'s permission check keys on the inbound tool name, so a grant tool reading the database internally would bypass the ACL on `query_finances` and `query_donors`. See `packages/grants/src/figures.ts`.
- **Nothing it returns is submittable.** A person always reviews and always submits.

---

### `find_grant_documents`

Find grant documents in the Google Drive "Grants" tree by funder, year, and document kind. Returns a **catalog listing — no document text**. Reads the `grant_documents` table; touches neither Drive nor pgvector.

**Why it exists.** Drive discovery does not work for this tree. Listing a subfolder's children returns an empty set and `title`/`fullText` search never matches inside it, while fetching a *known* file ID returns full content. Only the discovery half is broken, so this tool replaces it: filter here to get Drive file IDs, then fetch those IDs with a Google Drive read tool. That keeps 3.5+ GiB of grant material reachable with nothing embedded.

**Inputs:** all optional — `funder` (case-insensitive substring, so `truist` matches `Truist Foundation`), `year`, `year_min`, `year_max`, `doc_kind`, `collection`, `title_contains`, `include_archive`, `include_external`, `only_fetchable`, `limit` (default 25, max 100).

**Returns:** `total_matching`, `returned`, `facets` (counts by funder and by kind, for narrowing a broad hit list without a second call), `results[]`, and `usage_note`. Each result carries `drive_file_id`, `drive_url`, `fetchable`, `path`, `filename`, `funder`, `year`, `doc_kind`, `collection`, `mime_type`, `archive_only`, `external_reference`, `needs_review`, `size_bytes`, `modified_at`.

| `doc_kind` | Meaning |
|---|---|
| `application_response` | Narrative answers submitted to a funder |
| `budget` | Budgets, financials, invoices, 990s |
| `report` | Grant reports and performance measures |
| `letter_of_support` | Letters of support |
| `loi` | Letters of inquiry / intent |
| `agreement` | Executed grant agreements |
| `program_description` | Launchpad describing its own programs — prime drafting context |
| `template` | Blank templates |
| `attachment` | Consent forms, signature requests, supporting paperwork |
| `transcript` | Interview and meeting transcripts |
| `meeting_notes` | Meeting notes |
| `external_reference` | **Not written by Launchpad** — funder rules, other grantees' applications |
| `other` | Not confidently classified; see `needs_review` |

**Three contracts worth knowing before you call it:**

- **Two exclusions are on by default, and they are not the same risk.** `archive_only` hides applications predating the current program (`ARCHIVE_BEFORE_YEAR = 2025`), which describe a program Launchpad no longer runs — the failure is a confidently outdated draft. `external_reference` hides documents Launchpad did not author — the failure there is **plagiarism**, putting another organization's narrative in a Launchpad submission. Pass `include_archive` / `include_external` for research, never for drafting.
- **`excluded` rows are never returned, on any flag combination.** Those files sit under `Project Management (do not ingest)` or `Ignore` and were marked by an explicit human instruction rather than by inference, so no argument overrides them.
- **`funder`, `year`, and `doc_kind` are inferred from folder and file names only** — nothing is read from file contents. `needs_review` marks rows where inference was not decisive (no year, or `doc_kind = other`). Treat a filter built on them as a good shortlist, not a guarantee of completeness.

**`fetchable=false` means the row has no Drive file ID recorded yet**, so it can be seen but not read. IDs come from the `google-drive` connector (`pnpm sync:drive`, or `packages/grants/scripts/drive-walk-grants.ts --dry-run` to look first), which needs an identity with shared-drive membership — see [docs/data-sources/google-drive-connector.md](data-sources/google-drive-connector.md).

### `grant_resize_answer`

Fit one stored answer to one funder's stated limit. Deterministic, and it reads seed files only. **You do the rewriting — this tool measures.** There is no model client anywhere in this repository, and an MCP tool is invoked *by* Claude, so the loop is: call it, rewrite, call it again.

**Inputs:** `text` (the SOURCE answer, and on the second call still the source, not your rewrite), `limit` (`{ unit, max }`); optional `rewrite`, `attempt`, `funder`, `framing`, `kb_ref`, `answers`.

**Returns:** `notes` (the verdict), `accepted`, `text` (the accepted rewrite, or `null`), `handback`, `measurement`, `source_measurement`, `figure_check`, `units_before` / `units_after`, `fits_after_resize`, `answer_full`, `answer_truncated_preview`, `trace`, `action`, plus `kb_ref`, `verified`, and `carries_figures`.

| `notes` | Meaning |
|---|---|
| `fits` | Nothing owed. Either the source already fits, or your rewrite fits and altered no figure. |
| `rewrite_owed` | Over the limit. `handback` carries the source, the limit, the measurement, and the rules. |
| `compression_infeasible` | Over by more than 4x. Still handed back, but facts will have to be dropped and the rewrite must say which. |
| `still_over_limit` | Your rewrite is still over. `handback` carries the overflow feedback. |
| `figures_altered` | **Rejected.** Your rewrite states a figure the source does not. |

**Two contracts worth knowing before you call it:**

- **Branch on `accepted`, not on `fits_after_resize`.** They differ in exactly the dangerous case: a rewrite that fits the limit but moved a figure. `fits_after_resize` is length only. A rewrite stating a figure the source does not is rejected however well it fits, because the first guardrail rule calls that output unusable — dropping a figure is allowed, inventing or changing one is not. See `figure_check.invented`.
- **Passing `kb_ref` makes the answer more honest, not just more convenient.** With it, the tool reads that slot's own grounding flag rather than taking your word for it, so it can carry the "not grounded in a filed application" warning through the resize. Without it, `verified` is `null` — which is not a clean bill of health.

An accepted rewrite is still a draft. The stored figures are a frozen snapshot, so verify each one against live data via `grant_build_draft`'s figure work order before publishing, and a person reviews and submits.

---

## Error Response Format (All Tools)

```json
{
  "error": {
    "code": "entity_not_found",
    "message": "Could not resolve 'maria g' to a known student or staff member.",
    "suggestions": ["Maria Garcia (student)", "Maria Chen (staff)"]
  }
}
```

Error codes: `entity_not_found`, `no_records`, `search_failed`, `internal_error`

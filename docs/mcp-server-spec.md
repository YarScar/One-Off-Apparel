# MCP Server Spec

## Tool Availability

The server currently exposes **23 tools** — 16 data tools, `grant_match_question`, `grant_build_draft`, `grant_resize_answer`, and 4 `skill_*` tools — backed by Google Sheets, Aplos, and Notion connectors. Semantic search uses pgvector with OpenAI `text-embedding-3-large` embeddings (1536 dimensions).

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

**Still pending:**
- Slack connector for `search_conversations`

Composite tools (`get_entity_brief`, `get_finance_brief`) MUST gracefully omit sections whose underlying data source is not yet active, rather than erroring. Each section in the response should be optional and the tool should annotate which sources contributed.

## Overview

The MCP server exposes 23 tools to Claude. It runs as a Node.js HTTP server using the `@modelcontextprotocol/sdk` package with Streamable HTTP transport (or stdio for local desktop use). All tools are read-only — no writes to any data source.

Every tool call is logged to the `usage_logs` Postgres table (tool name, timestamp, duration, caller identity, token usage).

**Server location:** `apps/mcp-server/`
**Transport:** Streamable HTTP (production on ECS Fargate behind ALB) + stdio (Claude Desktop)
**Production URL:** `https://mcp.launchpadinc.org`

## Tool Definitions

---

### `query_attendance`

Query Launchpad student attendance from the three cohort sheets unified into the `attendance_records` table. Supports per-student rates, aggregate breakdowns by any demographic dimension, and raw event drill-downs over a date range.

**Source:** Three Google Sheets (`GOOGLE_SHEETS_ATTENDANCE_COHORT_1/2/3`).

**Cohort shapes:**
- Cohort 1 — weekly aggregate rows with a `Percentage` column (0–100); no P/A/E codes.
- Cohort 2 — daily rows with `Code` ∈ {`P`, `A`, `E`}, `Check in` / `Check out` decimal times, expected vs. actual time-spent.
- Cohort 3 — weekly check-in / check-out logs with `Code` (`P`/`A`/`E`) and `CheckInOrOut` event type. `LearningExp` values: `F1`/`F2` = Foundations Term 1/2, `O1` = 101.

Cohorts are loose Launchpad groupings; a student may move between cohorts as they accelerate. Linkage to the students table is via `student_number` (LP####).

**Description shown to Claude:**
> Query Launchpad student attendance from the three cohort sheets (Cohort 1 / 2 / 3). Use for per-student attendance rates, aggregate rates by phase / race / cohort / school / etc., or raw event drill-downs over a date range. Cohorts are loose Launchpad groupings (students may move between them as they accelerate); rates blend cohort 1 (already-aggregated weekly %), cohort 2 (daily P/A/E codes), and cohort 3 (weekly check-in/out logs with codes). Excused absences are excluded from rate calculations.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query_type": { "type": "string", "enum": ["by_student", "aggregate", "events"] },
    "student_number": { "type": "string", "description": "LP#### (joins students.student_id)" },
    "cohort": { "type": "number", "enum": [1, 2, 3], "description": "Restrict to one cohort. Default: all three." },
    "current_phase": { "type": "string", "description": "Foundations / 101 / Lightspeed / LiftOff. Joined via students table." },
    "race": { "type": "string" },
    "gender": { "type": "string" },
    "school": { "type": "string", "description": "Partial match." },
    "enrollment_status": { "type": "string", "description": "E / EP / EL / N." },
    "graduation_year": { "type": "number" },
    "start_date": { "type": "string", "format": "date" },
    "end_date": { "type": "string", "format": "date" },
    "group_by": {
      "type": "string",
      "enum": ["cohort", "current_phase", "race", "gender", "school", "enrollment_status", "graduation_year"],
      "description": "For 'aggregate' only. Default 'cohort'."
    },
    "limit": { "type": "number", "description": "For 'events' only. Default 200, max 500." }
  },
  "required": ["query_type"]
}
```

**Rate calculation:**
- Cohort 1 — weighted average of the `percentage` column.
- Cohort 2 / 3 — `present / (present + absent)`, with **excused excluded from both numerator and denominator**.
- Mixed-cohort students contribute via both signals (cohort-1 rows weight 1 each; cohort-2/3 P/A rows weight 1 each).

**Output Schema (`by_student`):**
```json
{
  "query_type": "by_student",
  "total_students": 151,
  "students": [
    {
      "student_number": "LP0181",
      "canonical_name": "Tai Pham",
      "current_phase": "101",
      "race": "Asian",
      "school": "Furness High School",
      "cohorts": [2, 3],
      "attendance_rate_pct": 92.4,
      "rows_counted": 187,
      "present": 167,
      "absent": 14,
      "excused": 6
    }
  ]
}
```

**Output Schema (`aggregate`):**
```json
{
  "query_type": "aggregate",
  "group_by": "cohort",
  "overall": { "student_count": 151, "attendance_rate_pct": 86.1, "rows_counted": 14092 },
  "breakdown": [
    { "group": "cohort_3", "student_count": 85, "attendance_rate_pct": 85.1,
      "rows_counted": 8296, "present": 6438, "absent": 1126, "excused": 112 }
  ]
}
```

**Output Schema (`events`):**
```json
{
  "query_type": "events",
  "total_rows_matched": 8296,
  "records_returned": 200,
  "truncated": true,
  "records": [
    { "id": "...", "cohort": 3, "studentNumber": "LP0181", "date": "2026-04-22",
      "code": "P", "rowData": { "learning_exp": "O1", "...": "..." } }
  ]
}
```

---

### `query_employment`

Query post-program employment data from the `student_employment` table. Tracks employer, job title, wages, hours, and exit codes.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "student_number": { "type": "string", "description": "LP#### — filter to one student." },
    "employer": { "type": "string", "description": "Partial match on employer name." },
    "employment_type": { "type": "string", "description": "Filter by type (e.g. Full-time, Part-time, Internship)." },
    "exit_code": { "type": "string", "description": "Filter by exit code." }
  },
  "required": []
}
```

---

### `query_postsecondary`

Query college enrollment data from the `student_postsecondary` table (National Student Clearinghouse). Tracks institution, enrollment status, class level, majors, and graduation.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "student_number": { "type": "string", "description": "LP#### — filter to one student." },
    "institution": { "type": "string", "description": "Partial match on institution name." },
    "enrollment_status": { "type": "string", "description": "Single-letter code: F=Full-time, Q=Three-quarter, H=Half-time, etc." },
    "graduated": { "type": "boolean", "description": "Filter to graduated or not." }
  },
  "required": []
}
```

---

### `search_documents`

Raw document chunk search with optional entity filter. Searches `document_chunks` using pgvector cosine similarity.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Natural language search query." },
    "source": { "type": "string", "description": "Filter by source (e.g. 'notion', 'drive')." },
    "top_k": { "type": "integer", "description": "Number of results. Default 8, max 20.", "default": 8 }
  },
  "required": ["query"]
}
```

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
    "fund": { "type": "string", "description": "Filter by fund name (partial match). On dev_* types matches across the standard fund/project columns." },
    "category": { "type": "string", "description": "Filter by account name / category (partial match)." },
    "row_type": { "type": "string", "enum": ["detail", "summary", "all"], "description": "Default 'all'." },
    "launchpad_only": { "type": "boolean", "description": "Default true. Applies to dev_* query types only — restricts CRM rows to those whose Fund / Project mentions 'Launchpad'. Set false to see all B21 development data. The Launchpad Pipeline tab is implicitly scoped." },
    "donor": { "type": "string", "description": "Filter by donor name (partial, case-insensitive). Most useful on dev_giving_history, dev_prospect_pipeline, dev_denied, dev_grants_tracker, dev_launchpad_pipeline, dev_contacts." }
  },
  "required": ["query_type"]
}
```

**Output Schema (every query_type):**
```json
{
  "query_type": "...",
  "tabs_queried": ["..."],
  "launchpad_only": true,
  "record_count": 174,
  "records": [ /* row_data fields, vary by tab. See connector docs for column names. */ ],
  "sources": ["google_sheets"]
}
```

**Launchpad scoping:** When `launchpad_only=true` (default) and the query targets a CRM tab listed in `TABS_WITH_LAUNCHPAD_FILTER`, rows are filtered to those whose `fund`, `fund_name`, `fund_s`, `primary_fund`, `project`, `projects`, or `project_s` contains "launchpad" (case-insensitive). The `dev_launchpad_pipeline` tab is excluded from the filter (already Launchpad-scoped by construction).

---

### `query_donors`

Donor lookup against the Building21 Development CRM (Contacts tab + linked records). Three modes:
- `list` — donors filtered by name / type / status
- `profile` — full record for one donor + linked Giving History + Prospect Pipeline + Launchpad Pipeline + Grants
- `summary` — breakdown by donor type, status, lifetime giving total

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

Return a comprehensive financial overview — fund balances, YTD revenue vs. expenses, top campaigns, recent transactions.

**Description shown to Claude:**
> Get a high-level financial overview of the organization: fund balances, year-to-date income and expenses, active fundraising campaigns, and recent Aplos transactions. Use this as a starting point for any general finance question or when asked for a financial summary.

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
  "sheet_fund_balances": [ /* Google Sheets fund balance rows, if any */ ],
  "sources_active": ["aplos", "google_sheets"]
}
```

Queries Aplos (`finance_snapshots` with `aplos:*` tab names) and Google Sheets fund balances directly.

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

---

### `query_students`

Population-level analytics on the `students` table. Supports numeric stats (avg/min/max/quartiles), categorical breakdowns, and filtered list pulls. Filters cover every queryable column on the students table (PII columns like email/phone/street are intentionally excluded at ingest).

**Query types:** `numeric_stats`, `breakdown`, `list`.

**Numeric fields:** interview_score, tech_interest_onboarding, interview_passion_score, interview_college_score, hs_gpa, algebra1_grade, geometry_grade, zip, distance_to_office_miles.

**Categorical fields (for breakdown):** current_phase, enrollment_status, cohort, neighborhood, zip, school_name, hs_graduation_year, withdrawal_code, college_enroll, university, major, workforce_program_referral, workforce_referral_status, internship_status, parental_ed, income.

> Note: as of the current implementation, only `current_phase`, `enrollment_status`, `cohort`, `neighborhood`, `zip`, `school_name`, `hs_graduation_year`, and `withdrawal_code` are wired into `BREAKDOWN_FIELDS`. `distance_to_office` and `hs_graduation_year` are wired into the `filter_field` numeric-range filter (`filter_min`/`filter_max`); only `distance_to_office` is wired into `NUMERIC_FIELDS` (the `numeric_stats` aggregate query type). The remaining fields below describe the original design intent but are not yet implemented — treat them as a backlog, not current behavior.

**Filter set (all query types):** enrollment_status, current_phase, cohort, school (partial match on school_name), hs_graduation_year (exact match; range via `filter_field=hs_graduation_year`), dob_start / dob_end (ISO date bounds on date of birth), withdrawal_code (exact match), withdrawal_date_start / withdrawal_date_end (ISO date bounds), zip, plus numeric range on distance_to_office via `filter_field` + `filter_min` / `filter_max`. Everything else in this line — race, gender, graduation_year (LP program), entry_date_start/end, city, college_enroll, university (partial), major, workforce_program_referral, workforce_referral_status, internship_status, income/parental_ed ranges — is not yet implemented (see note above).

`withdrawal_code`/`withdrawal_date` are designed as join keys for cross-tool analysis: pull a `student_number` list filtered by withdrawal reason or date here, then feed those numbers into `query_certifications`, `query_attendance`, etc. to correlate withdrawal with outcomes in other data sources.

---

### `query_certifications`

Certification data (PCEP, future certs) — pass/fail rates, scores, and breakdowns by cert type, LP phase, date range, or student zip code.

**Query types:** `summary`, `by_type`, `by_phase`, `by_result`, `by_zip`, `scores`.

**Filters:** `type`, `phase`, `result` (Pass / Fail), `start_date`, `end_date` — all apply to `by_zip` too.

`by_zip` joins to `students.zip` (zip isn't a column on `student_certifications`) and returns `{ zip, count, avg_score }` per zip, e.g. `query_type=by_zip, type=PCEP` for average PCEP score by zip code. Rows with a null zip are excluded.

---

### `query_competency`

Per-student competency data (scores) or the rubric structure (skills + opportunity totals by phase and term).

**Query types:** `scores`, `rubric`.

**Filters:** `student_number`, `competency` (partial match).

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

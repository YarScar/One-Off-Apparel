# Google Sheets Connector

## Purpose

Syncs structured data from multiple Google Sheets into Postgres. The connector is **strictly read-only** — see "Read-Only Enforcement" below.

| Sheet | Env var | Destination |
|---|---|---|
| Student Information for Launchpad LLMs | `GOOGLE_SHEETS_STUDENT_INFO_ID` | `students`, `student_phase_outcomes`, `student_certifications` |
| Launchpad Dashboard | `GOOGLE_SHEETS_DASHBOARD_ID` | `finance_snapshots` (6 tabs) |
| Launchpad Budget by Phase Dashboard | `GOOGLE_SHEETS_PHASE_DASHBOARD_ID` | `finance_snapshots` (3 tabs: 2025 Actuals, Monthly LiftOff Only, Monthly HS Only) |
| Launchpad By Phase Actuals Q3 2026 | `GOOGLE_SHEETS_BY_PHASE_Q3_2026_ACTUALS` | `finance_snapshots` (3 tabs) |
| Launchpad By Phase Actuals 2025 | `GOOGLE_SHEETS_BUDGET_BY_PHASE_ACTUALS_2025` | `finance_snapshots` (3 tabs) |
| Rapid stipend transactions | `GOOGLE_SHEETS_RAPID` | `finance_snapshots` (Dashboard + FY2023–FY2025) |
| PEX card transactions | `GOOGLE_SHEETS_PEX` | `finance_snapshots` (Dashboard + FY2022–FY2026) |
| Student Competency | `GOOGLE_SHEETS_STUDENT_COMPETENCY` | `finance_snapshots` (`student_competency:scores`, `student_competency:rubric`) |
| Building21 Development CRM | `GOOGLE_SHEETS_DEVELOPMENT_CRM` | `finance_snapshots` (6 tabs: contacts, giving history, prospect pipeline, denied, launchpad pipeline, grants tracker) |
| Attendance — Cohort 1 | `GOOGLE_SHEETS_ATTENDANCE_COHORT_1` | `attendance_records` (cohort=1) |
| Attendance — Cohort 2 | `GOOGLE_SHEETS_ATTENDANCE_COHORT_2` | `attendance_records` (cohort=2) |
| Attendance — Cohort 3 | `GOOGLE_SHEETS_ATTENDANCE_COHORT_3` | `attendance_records` (cohort=3) |

## Read-Only Enforcement

This connector must never write to any spreadsheet. Three layers:

1. **No write function exists.** `sheets-client.ts` has no `writeSheetCell`, `values.update`, or `batchUpdate` calls. There is no API to invoke from sync code.
2. **Settings preconditions throw, never write.** Tabs that depend on dropdown / selector cells (e.g., the `View=Detail`, `Year=FY 2026`, `Revenue Type=Projected` selectors at row 3 of the Phase Budget Dashboard's monthly tabs, or the View/Revenue Type/Fund/Year selectors on the Launchpad Dashboard tabs) are validated with `verifySettings` / `validateSelectors`. On mismatch the sync raises `SheetSettingsMismatchError` (defined in `src/errors.ts`) with a per-cell breakdown (spreadsheet ID, tab, A1 address, expected value, actual value). The user fixes the cell manually.
3. **OAuth scope.** The connector authenticates with `https://www.googleapis.com/auth/spreadsheets`. The `.readonly` scope is documented as covering reads, but Google's data-filter endpoints (`spreadsheets.getByDataFilter`, `values.batchGetByDataFilter`) require the broader scope — without them we'd OOM on large multi-tab sheets like PEX. The actual write protection is layers 1 + 2; the scope is the minimum that supports targeted-tab fetches.

When a settings mismatch fires, `logSheetSettingsMismatch` writes a `‼️ SHEET SETTINGS MISMATCH` block to `console.error` so the message rises above routine progress logs in CloudWatch. One mismatch on one tab does not sink the rest of the run; that tab is skipped, others continue.

## Sheets and Tabs in Scope

### Student Information for Launchpad LLMs

| Tab | Destination | Notes |
|---|---|---|
| `Students` | `students` + `student_phase_outcomes` | 38 non-blank cols; 4 excluded for PII |
| `Certifications` | `student_certifications` | Phase attempt records |
| `Outcomes` | _skipped_ | Exact subset of Students cols 6–17; read from Students instead |

### Launchpad Dashboard

All six tabs → `finance_snapshots` (JSONB per row).

| Tab | Period inference |
|---|---|
| Prior Month Budget vs Actual | From control row (`Month` cell) |
| YTD Budget vs Actual | From control row |
| Rolling Forecast | From column headers |
| Monthly | From `Date` column per row |
| Combined Funds | From control row |
| Annual | Static multi-year |

The four selector cells on each tab (View, Revenue Type, Fund, Year) must match expected values before the sync reads data. On mismatch the sync throws `SheetSettingsMismatchError` and skips that tab.

### Launchpad Budget by Phase Dashboard

| Tab | Stored `tab_name` | Header row | Notes |
|---|---|---|---|
| 2025 Actuals | `phase_dashboard:2025 actuals` | dynamic (detected by `HS %` + `LiftOff %`) | Cols: account_number, account_name, total_launchpad, hs_pct, hs, liftoff_pct, liftoff |
| Monthly LiftOff Only | `phase_dashboard:monthly liftoff only` | row 7 | Cols D–AD: account_number, account_name, projected_total_fy<year>, then 24 monthly columns spanning two fiscal years (Jul N → Jun N+2) |
| Monthly HS Only | `phase_dashboard:monthly hs only` | row 7 | Identical layout to LiftOff (HS = 101 phase) |

Monthly tabs require row-3 settings: `E=Detail`, `G=current FY label` (e.g. `FY 2026`, computed dynamically), `H=Projected`, `I=blank`. Mismatches throw `SheetSettingsMismatchError`.

### Launchpad By Phase Actuals (2025 + Q3 2026)

Both spreadsheets follow the same shape: three tabs each, with `%` characters in two of the tab names. The connector resolves tab titles via metadata to avoid range-string parsing issues.

| Tab name | Stored `tab_name` (each spreadsheet) |
|---|---|
| Global % | `q3_2026_actuals:global %`, `phase_actuals_2025:global %` |
| Human Capital % | `q3_2026_actuals:Human capital %`, `phase_actuals_2025:Human capital %` |
| Actuals By Phase | `q3_2026_actuals:actuals by phase`, `phase_actuals_2025:actuals by phase` |

Tab name lookup is case-insensitive (matches `Global %` to a config of `'global %'`).

### Rapid + PEX Stipends

| Sheet | Tabs |
|---|---|
| Rapid (`GOOGLE_SHEETS_RAPID`) | `Dashboard`, `FY2023`, `FY2024`, `FY2025` → `rapid:*` |
| PEX (`GOOGLE_SHEETS_PEX`) | `Dashboard`, `FY2022`, `FY2023`, `FY2024`, `FY2025`, `FY2026` → `pex:*` |

`*Dashboard` tabs hold monthly totals by account; `FY*` tabs hold individual transactions (date, description, amount, program, …).

### Building21 Development CRM

CRM data covers all of B21, not only Launchpad. Per-row fund/project columns are used by the MCP `query_finances` and `query_donors` tools to scope queries to Launchpad-only data when `launchpad_only=true` (the default).

| Sheet tab | Header row | Stored `tab_name` |
|---|---|---|
| Contacts | row 1 | `development:contacts` |
| Giving History | row 1 | `development:giving history` |
| Prospect Pipeline | row 4 | `development:prospect pipeline` |
| Denied | row 1 | `development:denied` |
| Launchpad Pipeline | row 5 | `development:launchpad pipeline` |
| Grants Tracker | row 2 | `development:grants tracker` |

PII handling note: per the data owner, **no fields are excluded from the Contacts tab** — emails, phone, names, zip, and giving totals are all ingested. This differs from the Students sheet (which excludes DOB, disability flags, IEP status, personal email, phone, street). The CRM use case requires per-donor attribution including contact channels.

Column names are normalized to snake_case via `headerToKey`: lowercased, non-alphanumerics collapsed to underscores, `(auto)`, `?`, and `$` stripped (e.g., `Donor Type (COA)` → `donor_type_coa`; `Admin Fee?` → `admin_fee`).

### Attendance — three cohort sheets

Each cohort is a separate spreadsheet ingested into the `attendance_records` table (cohort column 1 / 2 / 3). Cohorts are loose Launchpad student groupings — students may move between them as they accelerate.

| Cohort | Row granularity | Source-tab convention |
|---|---|---|
| 1 | Weekly aggregates with a `Percentage` column | tab name ends in `attendanceData` |
| 2 | Daily rows with `Code` ∈ {P, A, E} | tab name ends in `attendanceData` |
| 3 | Weekly check-in/out logs (one event per row), `Code` + `CheckInOrOut` event type | tab name ends in `attendanceData` (Cohort 3's actual tab is `Attendance Tracker _ Cohort3 - allAttendanceData`, matched by suffix) |

Sync flow per cohort (memory-bounded):
1. Metadata-only fetch: list tab titles + grid dimensions
2. Filter titles by `/attendanceData$/i` regex
3. Fetch row 1 of each candidate (single-row, cheap) to find the live tab via the "Student Number" header check
4. Loop in 5,000-row chunks via `values.get` with quoted A1 ranges; upsert each chunk; never hold the full tab in memory

Skipped headers (sheet-script metadata): `sheetName`, `sheetId`, `spreadsheetName`, `spreadsheetId`, `teacherPostingDate`. For Cohort 3 only: `ExpStartTime`, `ExpEndTime` (superseded by `StuExpStartTime` / `StuExpEndTime` per data owner).

### Student Competency

The scores tab is detected by content (its name includes a date suffix that changes per export, e.g. `StudentCompetency 2026-04-29T12...`). Stored as `student_competency:scores`. The rubric tab (`Sheet1`) has a multi-row header layout (rows 2–4 combined) — stored as `student_competency:rubric`.

## PII Handling Guardrails (Students tab)

**EXCLUDED columns — must never be read or persisted:** `dob` (col R), `hasDisability` (col W), `iep504` (col X), and any future column matching those names.

Enforcement: the connector reads only the columns in `STUDENTS_ALLOWED_COLS` (a column-letter set defined as a constant). The raw API response is filtered before any parsing — excluded columns never enter application memory.

### Header-Drift Guard

Before reading any data, the connector reads `Students!A1:AN1` and compares against `EXPECTED_STUDENTS_HEADERS` (the 40-cell canonical sequence including blank cells). If any header differs in position, the sync aborts immediately with error code `students_header_mismatch` and writes the mismatch detail to `sync_runs.error_message`. This prevents silent data corruption if columns are reordered.

## Column Mappings

### `Students` tab → `students` (38 non-blank cols, 4 excluded)

| Col | Sheet header | Postgres field | Notes |
|---|---|---|---|
| A | ID | `student_id` | LP#### |
| B | First Name | `canonical_name` (part) | Combined with Last Name |
| C | Last Name | `canonical_name` (part) | |
| D | left b4 HS grad | `left_before_hs_grad` | blank → false |
| E | Completed a Phase? | `completed_phase` | Y → true |
| F | Foundations | → `student_phase_outcomes` | Phase status |
| G | Foundation Start Date | → `student_phase_outcomes` | |
| H | Foundations End Date | → `student_phase_outcomes` | |
| I | 101 | → `student_phase_outcomes` | |
| J | 101 Start Date | → `student_phase_outcomes` | |
| K | 101 End Date | → `student_phase_outcomes` | |
| L | Lightspeed | → `student_phase_outcomes` | |
| M | Lightspeed Start Date | → `student_phase_outcomes` | |
| N | Lightspeed End Date | → `student_phase_outcomes` | |
| O | LiftOff | → `student_phase_outcomes` | |
| P | Liftoff Start Date | → `student_phase_outcomes` | |
| Q | Liftoff End Date | → `student_phase_outcomes` | |
| R | dob | **EXCLUDED** | PII |
| S | gender | `gender` | |
| T | raceEthnicity | `race_ethnicity` | |
| U | schoolName | `school_name` | |
| V | hsGraduationYear | `hs_graduation_year` | integer |
| W | hasDisability | **EXCLUDED** | PII |
| X | iep504 | **EXCLUDED** | PII |
| Y | entryDate | `entry_date` | |
| Z | withdrawalDate | `withdrawal_date` | |
| AA | _(blank)_ | skipped | |
| AB | programWithdrawalCode | `withdrawal_code` | W0–W12 |
| AC | zip | `zip` | |
| AD | interviewScore | `interview_score` | numeric |
| AE | techInterestOnboarding | `tech_interest_onboarding` | integer |
| AF | interviewPassionScore | `interview_passion_score` | integer |
| AG | interviewCollegeScore | `interview_college_score` | integer |
| AH | hsGpa | `hs_gpa` | numeric |
| AI | algebra1Grade | `algebra1_grade` | |
| AJ | geometryGrade | `geometry_grade` | |
| AK | collegeEnroll | `college_enroll` | |
| AL | university | `university` | |
| AM | major | `major` | |
| AN | _(blank)_ | skipped | |
| AO | Income | `income` | |
| AP | Parental Ed | `parental_ed` | |

Upsert conflict key: `student_id` (LP####).

### `Certifications` tab → `student_certifications`

| Sheet column | Postgres field | Notes |
|---|---|---|
| id | `source_id` | e.g. `SP001` |
| studentId | `student_id` | FK lookup via `student_id` on `students` |
| studentName | ignored | Derived from join |
| phase | `phase` | Foundations, 101, Lightspeed, LiftOff — no leading underscore |
| status | `status` | Completed, Dropped Before Completion, etc. |
| startDate | `start_date` | |
| endDate | `end_date` | |
| phaseWithdrawalCode | `phase_withdrawal_code` | W-code if applicable |

Upsert conflict key: `source_id` (SP###).

### Launchpad Dashboard tabs → `finance_snapshots`

All tabs follow the same storage pattern: each data row is stored as JSONB with `tab_name` and `source_id` = `"{tabName}:{rowIndex}"`. Column headers are stored as keys in `row_data` exactly as they appear in the sheet. The `period` field is inferred from the tab's control row or a date column where available.

## Sync Logic

### Student Information sheet

1. Write `sync_runs` row (`status = 'running'`, `connector = 'google-sheets'`)
2. Read `Students!A1:AN1` — compare against `EXPECTED_STUDENTS_HEADERS`; abort on mismatch
3. Read `Students!A2:AN` (all data rows, allowed cols only)
4. For each row: upsert into `students` on conflict `student_id`; upsert phase cols into `student_phase_outcomes` on conflict `student_id`
5. Read `Certifications!A2:H` (all data rows)
6. For each row: resolve `student_id` FK, upsert into `student_certifications` on conflict `source_id`
7. Update `sync_runs`

### Launchpad Dashboard sheet

1. Write `sync_runs` row
2. For each of the six tabs (in order): read all rows, upsert each into `finance_snapshots` on conflict `source_id`
3. Update `sync_runs`

Row numbers are stable as long as rows aren't deleted and reinserted. The header-drift guard on the Students tab covers the most sensitive case; finance tabs use JSONB so column additions/renames degrade gracefully.

## Sync Schedule

AWS EventBridge: **daily at 3:00 AM ET** (via `apps/sync` Fargate task)

Manual: `pnpm sync:sheets`

## Auth

Same Google service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) used by the Drive connector. Both sheets must be shared with the service account email as Viewer.

Required GCP API: **Google Sheets API v4**

## Error Handling

- `students_header_mismatch` → abort entire sync, write detail to `sync_runs.error_message`
- Sheet/tab not found → fail sync, write error
- Unparseable date or number in a row → log warning with row index, skip row, continue
- FK lookup miss (studentId not in `students`) → log warning, skip row
- Auth failure → fail sync

## Environment Variables

```
GOOGLE_SERVICE_ACCOUNT_JSON=                 # base64-encoded service account JSON
DATABASE_URL=

# Required spreadsheet IDs (long alphanumeric from each sheet's URL)
GOOGLE_SHEETS_STUDENT_INFO_ID=
GOOGLE_SHEETS_DASHBOARD_ID=
GOOGLE_SHEETS_PHASE_DASHBOARD_ID=
GOOGLE_SHEETS_BY_PHASE_Q3_2026_ACTUALS=
GOOGLE_SHEETS_BUDGET_BY_PHASE_ACTUALS_2025=
GOOGLE_SHEETS_RAPID=
GOOGLE_SHEETS_PEX=
GOOGLE_SHEETS_STUDENT_COMPETENCY=
GOOGLE_SHEETS_DEVELOPMENT_CRM=
GOOGLE_SHEETS_ATTENDANCE_COHORT_1=
GOOGLE_SHEETS_ATTENDANCE_COHORT_2=
GOOGLE_SHEETS_ATTENDANCE_COHORT_3=
```

Each spreadsheet must be shared with the service account email as **Viewer** (read-only — the connector cannot write regardless of share permission).

## Connector Location

`connectors/google-sheets/`

Key files:
- `src/env.ts` — typed env (required: every `GOOGLE_SHEETS_*` var listed above)
- `src/sheets-client.ts` — Sheets API v4 wrapper. Exports `getSheetRows`, `getAllSheetRows` (targeted-tab fetch via `values.batchGetByDataFilter`), `listSheetTitles`, `getSheetGridDimensions`. **No write functions.**
- `src/errors.ts` — `SheetSettingsMismatchError` + `logSheetSettingsMismatch`
- `src/parse.ts` — Students-tab row parsing, header constants
- `src/sync-students.ts` — Students + Outcomes + Certifications
- `src/sync-dashboard.ts` — Launchpad Dashboard (with selector validation, read-only)
- `src/sync-phase-dashboard.ts` — Phase Actuals 2025 + Q3 2026
- `src/sync-phase-budget-dashboard.ts` — Phase Budget Dashboard (2025 Actuals + Monthly LiftOff/HS)
- `src/sync-rapid.ts`, `src/sync-pex.ts` — stipend sheets
- `src/sync-student-competency.ts` — competency scores + rubric
- `src/sync-development-crm.ts` — Building21 CRM (6 tabs)
- `src/sync-attendance.ts` — three cohort sheets, chunked-fetch (5,000 rows per chunk)
- `src/sync-distances.ts` — geocodes student zips to office distance
- `src/sync.ts` — orchestrates all syncs, writes `sync_runs`
- `src/index.ts` — entrypoint

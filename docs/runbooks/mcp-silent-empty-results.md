# MCP tools that returned empty instead of failing

Audit date: 2026-08-05. Found while sourcing figures for grant drafting, where an
empty result is indistinguishable from "the organization has no such data" and
ends up shaping what gets told to a funder.

The common failure mode: a tool returns a well-formed envelope with zero rows.
Nothing errors, nothing warns. The caller concludes the data does not exist.

## Fixed in this branch

### 1. `query_finances` matched tab names case-sensitively (11 of 29 query types dead)

`QUERY_TYPE_TO_TAB` held Title Case names while the sheet connectors write lower
case, and Postgres string equality is case sensitive.

| query_type | Map expected | Connector writes |
|---|---|---|
| `dev_giving_history` | `development:Giving History` | `development:giving history` |
| `dev_prospect_pipeline` | `development:Prospect Pipeline` | `development:prospect pipeline` |
| `dev_denied` | `development:Denied` | `development:denied` |
| `dev_launchpad_pipeline` | `development:Launchpad Pipeline` | `development:launchpad pipeline` |
| `dev_grants_tracker` | `development:Grants Tracker` | `development:grants tracker` |
| `dev_contacts` | `development:Contacts` | `development:contacts` |
| `phase_budget_dashboard` | `phase_dashboard:2025 Actuals` | `phase_dashboard:2025 actuals` |
| `phase_budget_monthly_liftoff` | `phase_dashboard:Monthly LiftOff Only` | `phase_dashboard:monthly liftoff only` |
| `phase_budget_monthly_hs` | `phase_dashboard:Monthly HS Only` | `phase_dashboard:monthly hs only` |
| `fund_balances` | `fund_balances` | `Combined Funds` (`fund_balances` is the seed's name) |
| `budget_actuals` | no mapping at all, fell through to `tabName = 'budget_actuals'` | `Prior Month Budget vs Actual` + `YTD Budget vs Actual` |

Sources: `connectors/google-sheets/src/sync-development-crm.ts`,
`sync-phase-budget-dashboard.ts`, `sync-dashboard.ts`.

The map appears to have been written against `packages/db/src/seed.ts`, which uses
its own short names (`ytd`, `fund_balances`), rather than against the connectors.

Fix: correct the names against the connectors and keep the seed names as aliases.
`budget_actuals` maps to both budget-vs-actual tabs, which is what
`docs/mcp-server-spec.md` documented all along ("Prior month + YTD combined") —
rows carry their own `tab_name`, so a caller can still split them. Four shipped
prompts call that query_type (`prompts/board-reporting.ts`, `finance-audit.ts`,
`grant-prospecting.ts`, `grant-writing.ts`), so erroring on it was not an option.

Tab names are matched **exactly**, via `tabName: { in: [...] }`, not with
`mode: 'insensitive'`. Prisma compiles that mode to `ILIKE` and passes the value
through unescaped, which would make the `%` in `q3_2026_actuals:global %` a
wildcard and let the query claim rows from any tab sharing that prefix — verified
against a planted neighbour tab. The one place a LIKE pattern survives is the
caller's `tab_name` override, which stays case-insensitive for convenience and is
run through `escapeLike()` first. **That wildcard hazard is this change's own, not
the old code's**: the previous override was `where.tabName = tabOverride`, plain
equality, so `tab_name: '%'` matched nothing. Making the override case-insensitive
is what turned the value into a LIKE pattern, and `escapeLike()` closes it in the
same change. Exact matching also lets the query use
`finance_snapshots_tab_name_idx`, which `ILIKE` cannot.

`apps/mcp-server/src/__tests__/finance-tab-map.test.ts` locks the casing, asserts
no query_type resolves only to its own name, and — against a local DB — plants a
`q3_2026_actuals:global %-other` tab to prove neither the map nor a `%` override
reaches it.

### 2. `query_finances` accepted a `contains` filter and ignored it

`contains` was declared in the input schema, documented as "substring match
against the JSON-serialized rowData", and never read. A nonsense needle returned
the same rows as no needle. Because the YTD tab contains a row named
`Total 5005 - Part-Time Employees`, a caller searching for "Total Expenses" got
back something that looked like a match.

Fix: implemented as a case-insensitive substring match over the serialized
`rowData`, applied after a bounded scan (`SCAN_CAP`), with `contains_applied` and
`scan_incomplete` echoed back.

### 3. `query_finances` truncated without saying so

`record_count` reported rows returned, with no total. A caller passing `limit: 5`
against a 182-row tab could not tell a small page from a small tab.

Fix: every response now carries `total_matching`, `truncated`, and
`tab_names_matched`.

### 4. `get_finance_brief` mixed two snapshot dates in `aplos_funds`

`aplos:funds` is snapshotted daily. `orderBy period desc, take: 50` returned all
of today's funds plus a partial slice of yesterday's, so the same fund appeared
twice with different `snapshot_date` values and the list looked longer than the
chart of funds.

Fix: resolve the newest period first, then return only that snapshot.

### 5. `get_finance_brief.sheet_fund_balances` used the seed's tab name

Same `fund_balances` versus `Combined Funds` mismatch as above, so this key was
always `[]`. Now matches either name via `tabName: { in: [...] }` — **exactly, and
case-sensitively**, for the `ILIKE` reason above. A tab written as `combined funds`
would still be missed; the fix is to add the name to that array, not to relax the
match.

The same key was also capped at 50 rows ordered by `period`, which for dashboard
tabs is a selector-cell string shared by every row (`sync-dashboard.ts:235`) rather
than a date — so the cap took an arbitrary slice, and the spec points callers at
`Combined Funds` for an annual budget total. It is now ordered deterministically,
capped well past the real tab size, and reports
`sheet_fund_balances_total` plus `sheet_fund_balances_truncated` when the cap bites.

### 6. `query_enrollment` accepted filter values that cannot match anything

Added 2026-08-13, OpenProject `#207`.

`query_enrollment { query_type: 'by_phase', enrollment_status: 'Active' }` returned
`{"breakdown":[],"filters_applied":{"enrollment_status":"Active"}}`. Unfiltered, the same
call returns 14 populated rows and `query_type: 'total'` returns 301 students.
`students.enrollment_status` holds short source codes — `E` and `N` were the values
observed in production — so `'Active'` occurs in no row and never could. The input schema
was `z.string().optional()`, the description enumerated nothing, and the codes were
discoverable only by calling `by_student` and reading individual records. "How many active
students" answered zero.

Fix: before any counting, each supplied `current_phase`, `enrollment_status`, `cohort` and
`status` is checked against the distinct values its own column holds. A value absent from
that column returns `toolError('no_records', ...)` naming the field, the `table.column`,
and the values present, so the caller retries in one round trip. Checked once ahead of the
`switch`, so all eight query_types answer identically.

`no_records` is reused rather than a new code added: `query_finances` already returns it
for a query_type no table backs, which is the same "your input cannot be answered from
this data" one level up.

**The line, which is the whole substance of it:** a value absent from its column's domain
is a bad input and errors; values that are each present but co-occur in no row are a
truthful zero and still return empty. That is why every domain is read **unscoped** — the
distinct values of one column across the whole table, never narrowed by the sibling
filters. Scope the domain by the siblings and the last filter standing always looks
unmatchable, so every real zero becomes an error: the false-zero defect replaced by a
false-error one. `apps/mcp-server/src/__tests__/query-enrollment-filters.test.ts` asserts
both directions against the live server, and the second direction is the one that fails
when the domain is scoped.

Two filters are deliberately not domain-checked. `phase` is a `z.enum`, so a bad value is
rejected before the handler runs. `start_date` / `end_date` are windows, not values drawn
from a column, so a window outside the data's range is a real zero.

An empty domain — the column null in every row — errors too, with its own message, since a
zero drawn from an unpopulated column is exactly the false fact this runbook is about. That
path is covered by unit test only; it is not reachable with a fixture that populates the
column.

**Propagated to the sibling tools in fix 8 below.**

### 7. `query_attendance` declared `current_phase` and never read it

Added 2026-08-13, OpenProject `#209`.

`query-attendance.ts:20` accepted `current_phase`; nothing in the handler applied it. Every
other occurrence of the name in the file was something else — the `group_by` enum member, or
an output field shaped from a joined student record — which is what made it hard to see by
reading.

So a caller scoping attendance to one phase got **every phase back**, in a response whose
own envelope named the filter. Not a silent zero but a silent **superset**, which is the
worse direction: a zero invites suspicion, and a plausible org-wide rate presented as a
phase rate does not. Any phase-scoped attendance rate ever quoted from this tool was the
org-wide rate. Same class as `query_finances.contains` in fix 2 — a declared parameter the
handler ignores.

Fix: `attendance_records` carries a bare `student_number` with **no relation** to
`students` (`schema.prisma`, `model AttendanceRecord`), so the phase cannot be a column
predicate. It is resolved to its student numbers first — one read that yields both the
predicate and the domain, so the two cannot disagree — and matched as
`studentNumber: { in: [...] }`. That goes in through Prisma's `AND` rather than onto
`where.studentNumber`, because `student_number` and `current_phase` can both be supplied and
assigning the same key twice keeps only one: a student number outside the requested phase
now returns a truthful zero rather than every row for that student.

`current_phase` and `cohort` are domain-checked on the way in, on the same rule as fix 6.
The `current_phase` domain is scoped to students **who have an attendance row** — that is
the population the tool answers over at all, so offering a phase held only by students with
no attendance data would move the false zero one round trip later rather than remove it. It
is *not* scoped by the caller's cohort or dates, for the fix-6 reason.

**Two other declared inputs on the same tool, checked while there.** `enrollment_status` is
not a filter at all here, only a `group_by` member, so there was nothing to apply. `limit`
was read by the `events` branch alone, so `by_student` returned every student to a caller
who asked for ten and `aggregate` said nothing about ignoring it. `by_student` now pages on
it, reporting `total_students` (matched), `students_returned` and `truncated` separately —
the `student_count`-is-sometimes-a-page-size trap recorded under `#195` below — and orders
the page by `student_number`, since the rows arrive in whatever order Postgres yields.

Every response now echoes `filters_applied`, plus `filters_ignored` for an input the
query_type cannot honour (`limit` on `aggregate`) or a blank value treated as absent,
following the contract fix 6 established.

`apps/mcp-server/src/__tests__/query-attendance-filters.test.ts`. Verified load-bearing by
mutation: reverting the predicate fails 9 of the 14 cases, disabling the domain check fails
the 3 error cases and nothing else. The membership assertions are the ones that pin it —
they name the student the phase must exclude, so they fail with the filter reverted rather
than merely on an empty table.

### 8. The unmatchable-filter check reached only `query_enrollment`

Added 2026-08-13, OpenProject `#210`. Fix 6 was deliberately scoped to one tool; these are
the siblings with the same shape, now done.

| Tool | Filters domain-checked | Column |
|---|---|---|
| `query_students` | `enrollment_status`, `current_phase`, `cohort`, `hs_graduation_year`, `withdrawal_code` | `students.*` |
| `query_postsecondary` | `enrollment_status`, `class_level` | `student_postsecondary.*` |
| `query_certifications` | `phase` | `student_certifications.phase` |

`query_students` was the one that mattered: it filters the **same**
`students.enrollment_status` and `students.current_phase` columns with the same short source
codes, so the identical `enrollment_status: 'Active'` → confident zero stayed reachable
through it after fix 6 closed the other door. `query_certifications` had the worst-*reading*
one: `summary` answered `{ total: 0, passed: 0, pass_rate_pct: null }`, which is not "that
phase does not exist" but "nobody in that phase has certified".

Two filters listed in `#210`'s own table turned out not to belong here. `query_students`
gained `cohort` and `hs_graduation_year` — both exact-match, same shape, so they are checked
too. `query_certifications.type` is a `contains` match, not exact, so it falls under the
substring class that ticket deliberately left out of scope.

The check itself is unchanged: `unmatchableFilterError` in
`apps/mcp-server/src/filter-domain.ts` was already pure and tool-agnostic. What this fix
added is `filter-domain-loaders.ts`, the Prisma half — one loader per column, shared rather
than copied, because `query_students` and `query_enrollment` read the *same two columns* and
a second copy of either loader is a second place for the two tools to drift on what "the
values present" means. `filterStr` moved from `query-enrollment.ts` to `tool-helpers.ts` for
the same reason: all four tools need identical blank-means-absent semantics, or the domain
check errors on an empty string the caller never asked to match.

`query_students` also switched its `where` clause from truthiness to presence
(`cohort ? ...` → `cohort !== undefined ? ...`). A zero-valued filter was silently dropped,
which is unscoping one value wide. Neither zero occurs in the data, so this changes no
existing answer; it stops the `where` clause from disagreeing with the domain check, which
keys off presence. **Not covered by a test** — it is not observable without planting a
cohort 0.

**Deliberately still out of scope.** The substring filters —
`query_employment.employer_name` / `exit_code`, `query_postsecondary.institution` /
`institution_type`, `query_competency.competency`,
`query_students.school`, `query_certifications.type` — are the same class with a wider net. A
domain list fits a `contains` filter poorly: a substring matching no value is not the same
fact as a value absent from a column, and enumerating a free-text column's distinct values is
not a usable error message. Each tool's suite now pins this as a decision rather than an
oversight, asserting that a nonsense substring still returns a silent zero.
`query_donors.donor_type` / `status` remain moot until that tool has a data source at all
(below).

`apps/mcp-server/src/__tests__/sibling-filter-domains.test.ts`, both directions per tool.
Verified load-bearing by mutation, and the two mutations separate cleanly: neutralising the
three checks fails exactly the 7 error-direction cases, and scoping one domain by a sibling
filter fails exactly the 1 legitimate-zero case. That second result is the boundary — it is
the test that stops a future change from replacing the false zero with a false error.

## Found, not fixed, needs a decision

> The first item below is **resolved** (2026-08-19, `#306`) and left in place, with its
> resolution recorded, because its failure mode — a permitted tool answering a specific-looking
> `no_records` over a table nothing writes — is the sharpest example in this document of the
> class the whole runbook is about. Everything after it is still open.


### `query_donors` had no data source in production — FIXED 2026-08-19 (#306)

**Resolved.** Kept here rather than deleted, because the failure mode is the most
instructive one in this runbook: a tool that was *permitted* and *wrong* rather than
denied or erroring.

`query_donors`, `get_finance_brief.recent_gifts` and `get_entity_brief`'s donor arm
read the `donor_contacts` / `donor_gifts` / `donor_pipeline` tables. The only writer
of any of them is `packages/db/src/seed.ts`; no connector populates them, and
Givebutter — the source `schema.prisma` names on `donor_contacts.givebutter_contact_id`
— has no connector at all. So in production every donor query returned zero donors
and zero lifetime giving while the tool's description promised Development CRM data.

**Why it went undetected for so long.** The tool is not ACL-denied, so it answered
`no_records` *per funder* — a well-formed, specific-looking reply that reads as "this
funder has not given" when it meant "no donor exists anywhere." A 2026-08-19 grant
drafting run filed `[DATA UNAVAILABLE]` for four funders on exactly that misreading,
with $1.6M of William Penn history live in the sheet the whole time. The integration
test made it worse: it asserted `total_donors === 2` against the *seeded* rows, so it
passed locally and in CI while the production path returned nothing.

**The fix, option 1 of the two originally listed here.** All three tools now read the
`development:*` tabs in `finance_snapshots` — the rows `query_finances`'s `dev_*`
query types serve — through `apps/mcp-server/src/dev-crm.ts`. Option 2 (a sync
writing the typed tables from the CRM sheet) was rejected: its advantage was keeping
typed relations, and once the data was already reachable that bought ergonomics for a
sync that did not exist, while leaving two documented routes to one answer with one of
them dead.

Four things the repoint had to get right, each of which would otherwise have replaced
a silent zero with a silent wrong number:

1. **`launchpad_only` was accepted and never read.** Every response was
   all-Building-21 scope while the description promised Launchpad-only. It now
   defaults to `true` and is applied, and every response states its `scope`.
2. **Giving is summed from gift rows, not read from `dev_contacts`.** That tab's
   `lifetime_giving`, `fy25_giving` and `fy26_giving` columns are broken at source —
   William Penn reads `$0.00` against a real `$1,600,000.00`, while `cy2025_giving` on
   the same row carries a correct `$500,000.00`. They are inconsistent rather than
   uniformly empty, which is what makes them unusable: a caller cannot tell a true
   zero from a broken one. **Still broken at source; fix belongs in the sheet.**
3. **Totals are split by project.** William Penn gives $500,000/yr of which $425,000
   is Launchpad and $75,000 is Network Unrestricted. A precomputed all-scope column
   could never express that, and quoting $500,000 as the Launchpad grant overstates it.
4. **A funder with no Contacts row still resolves.** Contacts is a stewardship roster,
   not the set of everyone we have asked. A name found only on the giving-history,
   pipeline or denied tabs returns a profile with `profile: null` rather than
   `no_records` — without which a funder that had *declined* us was invisible.

Name matching is confined to the name columns. `query_finances`'s `contains` matches
the serialized row, so "William Penn" there also returns Project Based Learning, Inc.,
whose `primary_fund` is "William Penn"; reporting one organisation's giving under
another's name is worse than returning nothing.

Covered by `apps/mcp-server/src/dev-crm.test.ts` (28 unit tests over the parsers and
scope logic, fixtures copied from live probes) and six integration tests in
`__tests__/tools.test.ts`. `packages/db/src/seed.ts` now seeds `development:*` rows,
including William Penn's real two-gifts-per-year split, so local dev and CI exercise
the production path instead of a table nothing writes.

### `aplos:funds` rows carry no balance

`get_finance_brief` is described as returning "Aplos fund balances", and the fund
rows hold only `name`, `snapshot_date`, `balance_account_name`, and
`balance_account_number`. There is no amount. Either the Aplos funds sync should
fetch balances or the tool description should stop promising them.

### `query_employment({query_type: "by_employer"})` does not group by employer

It returns individual job rows, including student names, wages, and free-text
notes. The aggregate path is `{query_type: "aggregate", group_by: "employer"}`.
The `by_employer` name invites the wrong call and returns identifiable data about
minors to a caller who wanted a summary.

### `query_postsecondary` publishes a misleading rate

`graduation_rate_pct` divides graduates by every student with an NSC record, most
of whom are recent high-school graduates still enrolled. It read as 4.5%. The
field needs a cohort restriction or a `note` explaining the denominator.

### `by_school` and `by_race` return unnormalized free text

`by_school` holds casing and spelling variants of the same school, so its row
count overstates the number of schools. `by_race` returns multi-select answers as
delimited combinations inside one value, so rows cannot be summed. Both are
correct as raw data and dangerous as reportable figures.

### `query_students` and `query_enrollment` report a page size as a student count

Added 2026-08-13, OpenProject `#195`. Found while porting these fixes into the
North10 fork (`north10-ai` #193) and diffing the two repos.

Fix 3 above solved this for `query_finances` — `total_matching`, `truncated`,
`tab_names_matched`. **It was never propagated to the sibling tools.**
`query_attendance` does carry `truncated`. Three paths do not:

| Site | `query_type` | `orderBy` |
|---|---|---|
| `apps/mcp-server/src/tools/query-students.ts:191` | `list` | `canonicalName` only |
| `apps/mcp-server/src/tools/query-enrollment.ts:99` | `active_during` | **none** |
| `apps/mcp-server/src/tools/query-enrollment.ts:174` | `by_student` | **none** |

All three `take: limit` (default 500, cap 1000) and return
`student_count: rows.length` with no total and no truncation flag.

**The field name is the trap.** In the same tool, `query-enrollment.ts:66`
(`query_type: 'total'`) returns `student_count` from a real `prisma.count()`. So
`student_count` is a true total on one path and a page size on two others, with
nothing in the response to tell them apart. Ask how many students were active
during a window and you get a plausible number that is silently
`min(actual, 500)` — the same shape as the empty results this runbook is about: a
well-formed answer that reads as fact.

**Ordering compounds it.** The two enrollment paths have no `orderBy`, so row
order is whatever Postgres returns and a truncated page is an arbitrary subset
that can differ between identical calls. `query_students` sorts on
`canonicalName` alone, which is not unique, so duplicate names tie and reorder.

Fix, following what `query_finances` established: a `count({ where })` beside the
`findMany`, `total_matching` and `truncated` in the response, and an `orderBy`
ending in a guaranteed-unique column. The North10 equivalents are commits
`7e43ee8` and `d39d7f7`; the `McpStdioClient` harness there was ported *from*
this repo and gained a `dist/`-staleness guard worth pulling back.

**Severity, for prioritising:** no path here sums currency from a truncated page,
so unlike the North10 money tools there is no wrong dollar figure. The exposure is
headcount and completeness claims.

## Fixed since: truncation now reports itself (#276, #195)

`query_competency({query_type: "scores"})` was unbounded, then capped at 1000 of ~2346 rows
with nothing in the response saying so; `query_students({query_type: "list"})` returned
`student_count: rows.length`, a page size under the name `query_enrollment`'s `total` path
uses for a real `prisma.count()`; and `query_enrollment`'s `active_during` and `by_student`
paths had no `orderBy` at all, so a truncated page was an arbitrary subset that could differ
between two identical calls.

All of them now emit the one envelope `query_finances` established — `record_count`,
`total_matching`, `truncated`, `limit` — from `apps/mcp-server/src/result-envelope.ts`, and
each paged query ends its `orderBy` on a unique column. `query_competency` gained
`query_type: "growth_aggregate"`, which computes org-wide growth in the database over every
matching row; it is the only growth figure safe to quote. Covered by
`apps/mcp-server/src/__tests__/result-envelope.test.ts`, whose live-DB fixture front-loads low
growth values so an aggregate that silently paged returns a visibly different number.

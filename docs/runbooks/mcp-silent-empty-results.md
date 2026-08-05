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
run through `escapeLike()` first; without that, `tab_name: '%'` returned rows from
every tab in `finance_snapshots`. Exact matching also lets the query use
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
always `[]`. Now matches either name, case-insensitively.

## Found, not fixed, needs a decision

### `query_donors` has no data source in production

`query_donors` and `get_finance_brief.recent_gifts` read the `donor_contacts` and
`donor_gifts` tables. The only writer of either table is `packages/db/src/seed.ts`.
No connector populates them, so in production every donor query returns zero
donors and zero lifetime giving, while the tool's own description promises
Development CRM data.

The actual Development CRM *is* synced, by `sync-development-crm.ts`, into
`finance_snapshots` under `development:*`. Two ways forward:

1. **Repoint `query_donors` at the `development:*` tabs.** No new sync, but the
   tool has to interpret sheet columns instead of typed relations, and
   `get_entity_brief`'s donor lookup needs the same treatment.
2. **Add a sync that writes `donor_contacts` and `donor_gifts` from the CRM
   sheet.** Keeps the tool and its relations, costs a connector and a schema
   mapping, and gives `get_entity_brief` donor joins for free.

Until one lands, treat donor and funder-history questions as unanswerable through
the MCP and source them from staff.

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

### `query_competency({query_type: "scores"})` is unbounded

With no `student_number` it returns every score row, which measured 238 KB and
exceeds what a client can read in one response. It should require a student or
paginate.

### `query_postsecondary` publishes a misleading rate

`graduation_rate_pct` divides graduates by every student with an NSC record, most
of whom are recent high-school graduates still enrolled. It read as 4.5%. The
field needs a cohort restriction or a `note` explaining the denominator.

### `by_school` and `by_race` return unnormalized free text

`by_school` holds casing and spelling variants of the same school, so its row
count overstates the number of schools. `by_race` returns multi-select answers as
delimited combinations inside one value, so rows cannot be summed. Both are
correct as raw data and dangerous as reportable figures.

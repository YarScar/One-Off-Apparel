# Figure verification ledger

Every figure used in the filled drafts in this folder, with the tool that returned it and the date.
KB snapshot date: 2026-07-23. All live calls run 2026-08-11 against LP Internal AI.

| Check | KB claim (snapshot 2026-07-23) | Live value (asOf 2026-08-11) | Tool | Verdict |
|---|---|---|---|---|
| `employment_earnings_total` | $350,268 to 45 participants across 88 jobs | **$367,662.19 to 45 participants across 86 consolidated jobs** | `query_employment(aggregate)` | DRIFTED. Both the dollar figure and the job count moved. Use live. |
| `employment_wage_range` | $15,000-$35,000 earned; ~$20/hr | **avg $15.52/hr, avg 20.26 weekly hours; active jobs avg $19.28/hr** | `query_employment(aggregate)` | DRIFTED. The ~$20/hr claim holds only for currently active jobs, not the all-time average. |
| `enrollment_by_phase` | Phases: Foundations, 101, LiftOff | **Foundations, 101, Lightspeed, LiftOff.** Completions: Foundations 146, 101 38, Lightspeed 15, LiftOff 12; 18 in LiftOff now | `query_enrollment(by_phase)` | CONTENT GAP CONFIRMED. Lightspeed exists in the platform and in no KB program description. |
| enrollment total | not carried | **301 students** | `query_enrollment(total)` | New, usable. |
| `demographics_race` | 85% Black or Brown / ~90% low-income / 100% FRL | **96.0% (289/301) identify as other than white alone. Black or Latino: 242/301 = 80.4%. Asian: 40 (13.3%). White alone: 10. Undisclosed: 3** | `query_enrollment(by_race)` | DEFINITIONAL. "Black or Brown" is 80.4% or 96.0% depending on whether Asian, MENA and multiracial rows count. STAFF to pick the population before this number is filed. Low-income and FRL shares are not in the connector at all. |
| `cert_pass_rate` | PCEP 70-100% per cohort; 100% most recent | **32 of 59 attempts passed, 54.2% all-time** | `query_certifications(summary)` | DEFINITIONAL, as the KB warned. The connector returns all-time attempts; the filed applications quote per-cohort rates. Any sentence must name its denominator. |
| `top_employers` | 17 employer partners / 20 employers | **41 distinct employer names, 38 external.** Tech-sector: Accenture 12 jobs, Seer Interactive 7, CreateAccess 4, Bentley Systems 3, HiTouch Enterprise 2, Hack Club 1, AECOM (PYN) 1, Nerd Street (PYN) 1. Internal: Launchpad Inc. 20, Launchpad Program 3, Building 21 2. Remainder is retail, food service and community organizations | `query_employment(by_employer)` | NEITHER KB COUNT RECONCILES. A raw count of 38 would present a Popeyes shift as an employer partnership. No partner count is filed in these drafts. STAFF owns the partner roster. |
| `placement_rate` | 11 of 12 (92%) at six months; 100% now; 95% of 101 grads | **Not derivable.** No tool returns a cohort placement rate; `query_employment(aggregate)` gives counts, not a cohort denominator | `query_employment(aggregate)` | UNVERIFIED. Carried in the drafts only where marked `[STAFF VERIFY]`. |
| `annual_budget` | $1.34M FY2025 expenses; $1.68M FY2026 projected revenue | **Not returned.** `get_finance_brief(ytd)` returned the 39-fund list with no balances, a 234-account category summary, 20 recent transactions, and empty `sheet_fund_balances` and `recent_gifts` | `get_finance_brief(ytd)` | **[DATA UNAVAILABLE].** Not an ACL denial: the call succeeded and carries no income or expense total. |
| `phase_costs` | $519K / $455K / $362K per phase; ~$6,000 stipend floor | **0 records returned** | `query_finances(phase_budget_dashboard)` | **[DATA UNAVAILABLE].** The query_type the work order names is valid and empty. |
| `inc_client_work_booked` | $75,000 booked July 2026; two clients at $50-80K hiring intent | **Not returned** by the named call | `get_finance_brief(ytd)` | **[DATA UNAVAILABLE].** The work order already says no tool returns Inc. bookings directly. |
| `staff_count` | 15 staff / 9 staff | **0 results** | `search_documents("org chart staff roster headcount")` | **[DATA UNAVAILABLE]**, exactly as the check instructed. Headcount is not filed in any draft here. |
| `competency_growth` | qualitative | **177 students, 21 competencies, 328 scored rows: mean growth +0.24, median 0.0, 39.9% positive** | `query_competency(scores)` | PARTIAL. `record_count` came back exactly 1000, so the result is capped and these aggregates cover a truncated set. Not filed as a figure. |

## Re-source, 2026-08-14 — three of the four finance checks now answer

The rows above are the 2026-08-11 snapshot and are left as they were run. This section records what the
same checks return after PRs **#49** (finance tab mapping) and **#50** (`query_enrollment` filters)
merged and deployed on 2026-08-13. Work package `#216`.

| Check | 2026-08-11 verdict | 2026-08-14 live value | Tool | New verdict |
|---|---|---|---|---|
| `annual_budget` | `[DATA UNAVAILABLE]` | **Total Income actuals $1,572,906.30** against FY budget $1,655,155.00; **Total Expense actuals $1,734,075.87** against FY budget $1,607,803.87. Category totals: Salaries $690,035.47, Administrative Expenses $1,394,055.02, Stipends $196,678.01, Contributions Income $1,525,636.30, Other Income $47,270.00 | `query_finances(budget_actuals, tab_name: "YTD Budget vs Actual")` | ANSWERED, **fiscal year unverified** — see below. The KB's `$1.34M FY2025 expenses` matches none of these. Closest is Total *Administrative* Expenses at $1,394,055.02, which is a narrower measure than total expense. |
| `phase_costs` | `[DATA UNAVAILABLE]` — 0 records | 163 rows. Total Expense row: **total_launchpad $1,532,790, hs $459,805, liftoff $446,220** | `query_finances(phase_budget_dashboard)` | ANSWERED, **but not in the KB's shape.** The tab carries two phase columns (`hs`, `liftoff`); the KB's `$519K / $455K / $362K` is a three-way split with no counterpart here. Do not map one onto the other. |
| `inc_client_work_booked` | `[DATA UNAVAILABLE]` | `fund_balances` carries a **`launchpad_inc`** fund column; Total Income under it is **$305,000.00** | `query_finances(fund_balances, contains: "Total Income")` | PARTIAL. A live Inc figure exists, but fund income is not the same measure as the KB's "$75,000 booked July 2026". Filing either requires naming which one. |
| `staff_count` | `[DATA UNAVAILABLE]` | **0 results**, unchanged | `search_documents("staff org chart roster headcount")` | `[DATA UNAVAILABLE]`, still. Staff-owned. |
| `competency_growth` | PARTIAL, capped at 1000 | `record_count` **still exactly 1000**, still no `total_matching` / `truncated` | `query_competency(scores)` | PARTIAL, unchanged. No fix in flight. |
| `enrollment_by_phase` | content gap confirmed | **Lightspeed: 15 Completed, 12 In Progress, 1 Dropped, 272 Not Enrolled**, correctly scoped | `query_enrollment(by_phase, phase: Lightspeed)` | Re-confirmed against a tool that now actually applies the filter. The 2026-08-11 figure was right; it was previously unscoped by accident. |

### Two cautions on the new finance figures

**The fiscal year is not established by any of these calls.** The `YTD Budget vs Actual` tab returns
`period: ""` and carries no FY label, so nothing above can be attributed to a fiscal year from the tool
alone. Board `grant-a54` is exactly this carve-out. **No figure in this section may be filed to a funder
until the FY is settled by a person.**

**A silent empty result is still reachable in production.**
`query_enrollment(by_phase, current_phase: "Zzzznotaphase")` returns an empty breakdown with no error.
This is not a new defect — the `no_records` guard exists at
`apps/mcp-server/src/tools/query-enrollment.ts:217-224` and is unmerged. Production runs #49/#50 only.
Prefer the `phase` enum over the free-text `current_phase` until that ships.

## What staff must settle before any of these go to a funder

1. Which population "Black or Brown" means (80.4% or 96.0%).
2. Which PCEP denominator is being quoted, all-time 54.2% or per-cohort.
3. The employer partner roster and count. The employment table cannot supply it.
4. The Cohort 1 placement rate, which no tool confirms.
5. ~~Every budget total. Three separate finance checks came back empty today.~~ **Narrowed 2026-08-14:**
   the totals are returned now. What staff must settle is **which fiscal year** they belong to, whether
   the KB's `$1.34M` was ever total expense or was always the administrative subtotal, and which Inc.
   measure to quote.
6. Staff headcount.

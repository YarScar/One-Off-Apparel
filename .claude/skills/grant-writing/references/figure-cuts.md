# The figure cut catalogue

Participant and program figures are **always fetched live**. There is no stored number to check
against, no snapshot to compare, and no decision about whether the number is fresh enough. The only
work is choosing the cut that matches what the question asked.

This file is that mapping. It exists because the older path through `figures.ts` fires a check only
when a knowledge-base slot happens to carry a stale claim, which is the wrong trigger: a funder
asking "how many participants did you serve last year" needs a live call whether or not the KB
mentions a number. Read this file whenever a question asks for a count, a rate, a wage, or a dollar
figure. `prep.mjs` still tells you which stored claims have drifted; this tells you how to answer the
question in front of you.

Every call below was run against the live connector on 2026-08-17. Where a value is shown it is what
came back that day, included so you can tell a working call from a broken one, **not** so you can
quote it. Quote your own call's result with your own `asOf` date.

## How this file relates to `FigureCheck.population`

As of 2026-08-17 each `FigureCheck` in `packages/grants/src/figures.ts` carries a required
`population` field stating what its call actually counts, and `SlotRequirement` carries it through to
the fill instruction. That is the same claim this file makes, expressed per call rather than per
question shape, and the two have to be kept in sync: **a new `query_type` needs an entry here and a
`population` there.**

The division of labour, and it is worth understanding before you use either:

- `population` tells you what the cut you are about to run counts.
- This file tells you which cut the question wants.

When those differ, the answer is **not** to fill the stored sentence from a different cut. Stored
prose asserts its own population in its wording, so a twelve-month figure dropped into "young people
served to date" produces a false sentence containing a true number. Say the stored answer does not
cover the ask, and do not reword the sentence to make the cut you happen to have fit.

## The rule

> Never answer a participant or program question from the KB, from a prior filing, or from this file.
> Run the call. Cut it the way the question asks. Stamp it with the tool and the date.

Three corollaries that catch most mistakes:

- **The cut is part of the number.** "301 participants" is not an answer; "301 enrollment records
  across all phases and all time" is. State the population in the same sentence as the figure.
- **If the question is scoped and your call is not, you have the wrong number.** A question about the
  past 12 months is not answered by an all-time count, however live the all-time count is.
- **A sum of per-phase counts double-counts.** Participants appear in every phase they touch. Union
  on `student_number` before reporting a total.

## Enrollment and participants

| The question asks for | Call | Notes |
|---|---|---|
| Every participant ever, all phases, all statuses | `query_enrollment {query_type:"total"}` | Returned 301. This is the widest possible cut and is rarely what a funder asked for. |
| Breakdown by phase and status | `query_enrollment {query_type:"by_phase"}` | The workhorse. Returns Completed / In Progress / Dropped Before Completion / Not Enrolled per phase. |
| One phase only | `by_phase`, then read that phase's rows | There are four phases: Foundations, 101, Lightspeed, LiftOff. |
| Currently enrolled | `by_phase`, sum the In Progress rows | 50 across 101, Lightspeed and LiftOff on 2026-08-17. Do not include Foundations without checking whether it has In Progress rows. |
| Completions | `by_phase`, the Completed rows | |
| Completion rate | `Completed / (Completed + Dropped)` from `by_phase` | **Exclude In Progress from the denominator**, or you report every current participant as a failure. Say that you excluded them. |
| By high school graduation year | `query_enrollment {query_type:"by_program_year"}` | A cohort proxy, not a served-in-year count. |
| By race and ethnicity | `query_enrollment {query_type:"by_race"}` | Free-text, multi-category values. Decide whether you are counting "names this category at all" or "this category alone" and say which. |
| By school | `query_enrollment {query_type:"by_school"}` | |
| By cohort | `query_enrollment {query_type:"by_cohort"}` | |
| Per-participant rows | `query_enrollment {query_type:"by_student"}` | **Cannot filter by phase.** |
| Served during a date window | `query_enrollment {query_type:"active_during", phase, start_date, end_date}` | **Broken. See the defect below. Do not use it for a served count without reading that section.** |
| Population stats and breakdowns on the students table | `query_students {query_type:"numeric_stats"\|"breakdown"\|"list"}` | Where age, withdrawal codes, and graduation year live. Use this for an age range rather than quoting a range from an old application. |

### The `active_during` defect — OpenProject #278

`active_during` matches only records with a non-null `end_date`, so it silently drops every
In Progress record.

```
by_phase        -> LiftOff: 12 Completed, 18 In Progress, 10 Dropped   (40 records)
active_during   -> LiftOff, 2025-01-01..2025-12-31: 22
active_during   -> LiftOff, 2025-01-01..2026-12-31: 22   <- unchanged, 18 still missing
```

A date-scoped served count therefore undercounts by the entire currently-enrolled population. Until
#278 lands, a "served in the last 12 months" or "served in calendar 2025" question cannot be answered
from the platform. Write `[DATA UNAVAILABLE]`, say the tool undercounts and by roughly how much, and
flag it. Do not substitute the all-time count and do not quote a served figure from a prior filing.

`active_during` also requires `phase`, so a program-wide window count means one call per phase unioned
on `student_number` by you. The sum of the four phase counts is not the answer.

## Employment, wages, and placement

| The question asks for | Call | Notes |
|---|---|---|
| Total wages, job count, participant count, average wage and hours | `query_employment {query_type:"aggregate"}` | One call answers all of these. Returned $373,590.65 across 87 consolidated jobs and 46 participants, $15.58/hr, 20.21 hrs/wk. |
| Active placements only | `aggregate`, read the `(active)` group | Its average wage differs materially from the all-jobs average. $19.32 vs $15.58 on 2026-08-17. Say which you are quoting. |
| Why placements ended | `query_employment {query_type:"by_exit_code"}` or the `aggregate` breakdown | The honest basis for any retention answer. |
| Employers, and counts per employer | `query_employment {query_type:"by_employer"}` | Returns **job rows, not a breakdown**. Aggregate them yourself on employer name. 42 names on 2026-08-17, of which 3 are internal (Launchpad - Inc, Launchpad - Program, Self Employed). |
| Placements in a date window | `query_employment {query_type:"active_during", start_date, end_date}` | Check whether it shares the #278 null-`end_date` bug before trusting it. Active jobs here are also identified by a blank `end_date`. |
| One participant's jobs | `query_employment {query_type:"by_student", student_number}` | |

**Employer names are the one place a live call is not sufficient authority.** The platform records
employers of record for participant jobs. That is not the same population as "employer partners", and
a placement record is not a partnership agreement. Name only employers with a placement on record,
describe the relationship at the strength the record supports, and send any partnership claim to
staff. See `style.md`.

**No tool returns a cohort placement rate.** The numerator and denominator come from different tools
and the cohort window is not queryable. Any placement rate is hand-assembled: state both counts, both
dates, and who assembled it.

## Certifications

| The question asks for | Call | Notes |
|---|---|---|
| Overall pass rate | `query_certifications {query_type:"summary"}` | Returned 32 of 59, 54.2%, all-time across every attempt. |
| By credential type | `query_certifications {query_type:"by_type"}` | |
| By phase | `query_certifications {query_type:"by_phase"}` | |
| Per-cohort rate | `summary` with `start_date` / `end_date` | This is the cut that resolves the all-time-vs-per-cohort tension without escalating: run both and label each. |
| Score distribution | `query_certifications {query_type:"scores"}` | |

The all-time and per-cohort rates are both correct against different denominators. Name the
denominator in the sentence. "92% pass rate" with nothing attached is the failure mode.

## Postsecondary

| The question asks for | Call | Notes |
|---|---|---|
| Enrollment and graduation summary | `query_postsecondary {query_type:"summary"}` | Returned 170 records, 67 distinct participants, 3 graduates. The 4.5% rate is over the 67 with records, not over all participants. |
| By institution, status, or class level | `by_institution` / `by_status` / `by_class_level` | |
| Graduates | `query_postsecondary {query_type:"graduates"}` | |

## Finance

| The question asks for | Call | Notes |
|---|---|---|
| Income or expense by fiscal year | `query_finances {query_type:"annual", contains:"Total Expense"}` | **This is the call for organizational budget questions.** The Annual tab carries FY2025 actual through FY2028 projected in one row. Use `contains` to pull a single line. **The current year's column is `fy_<year>_actual_projected` and the label is load-bearing:** see the period warning below. |
| Budget against actual, current year | `query_finances {query_type:"budget_actuals", contains:"Total Expense"}` | Matches two tabs, Prior Month and YTD. Split on `tab_name` before comparing. The YTD row carries `budget`, `actuals`, `variance`, `fy_budget`, `fy_actual_projected` and `funds_remaining`. |
| Launchpad Inc. income | `query_finances {query_type:"fund_balances", contains:"Total Income"}` | The `launchpad_inc` fund column. **Fund income is not bookings**, so this does not answer "how much did Inc. book in July". Naming which measure you are quoting is mandatory here. |
| Any single budget line by year | `query_finances {query_type:"annual", contains:"<account name>"}` | Works for stipends, government grants, consulting fees, and each named salary line. |
| Spend by program phase | `query_finances {query_type:"phase_budget_dashboard"}` | Maps to the 2025 actuals tab. `phase_budget_dashboard` is the real enum value; `phase_budget_summary` is not, and fails validation with `invalid_enum_value`. **Administration is not a phase.** The tab carries shared administrative cost alongside the programme phases, and the `q3_2026_actuals` tab makes this explicit with a separate `actuals_admin` column beside `actuals_101`, `actuals_liftoff` and `actuals_inc`. Prior filings have listed three per-phase figures where the third was overhead. Read the column name, do not infer a phase from position. |
| Current-year actuals by phase | `query_finances {query_type:"q3_2026_actuals", contains:"Total Expense"}` | |
| Fund balances, accounts, recent transactions | `get_finance_brief {period}` | See the warning below. |

### The current fiscal year is not a clean actual, and the label matters

`query_finances {query_type:"budget_actuals"}` returns the YTD row with **`actuals` and
`fy_actual_projected` carrying the same value** ($1,734,075.87 on 2026-08-17), and the Annual tab's
column is literally named `fy_2026_actual_projected`. The source fuses actual-to-date with full-year
projection and nothing in the data separates them. The prior fiscal year is clean: `fy_2025_actual`.

So a funder question of the form "what was your organizational budget for FY2025 and FY2026" cannot be
answered for the current year without a caveat. Give the figure, say that the source does not
distinguish a closed year from a projection, and route it to finance. Do not present it as a closed
actual.

This is recorded as an open staff question: `FIGURE-LEDGER.md` under "Re-source, 2026-08-14" marks
`annual_budget` ANSWERED with **fiscal year unverified**, and `packages/grants/CLAUDE.md` §4 item 11
carries it as `grant-a54`. The same note records a second open question worth knowing: **no live total
matches the KB's `$1.34M FY2025 expenses`.** The closest is Total *Administrative* Expenses at
$1,394,055.02, which is a narrower measure than total expense, so the KB figure may never have meant
what it appears to.

### `get_finance_brief` does not answer budget questions

It returns fund and account metadata, a recent-transaction sample, and sheet fund balances. It
carries **no income or expense totals**. `figures.md` previously said it was preferred for
`annual_budget`, and three checks in `figures.ts` still name it as the fallback for `annual_budget`,
`revenue_mix` and `inc_client_work_booked`. It cannot answer any of the three.

Use `query_finances {query_type:"annual"}`. If your role is denied `query_finances`, that is a real
denial: write `[DATA UNAVAILABLE]`. A denial is never permission to quote the frozen KB figure.

**Launchpad Inc. client bookings** are not in any tool. `query_finances {query_type:"fund_balances",
contains:"Total Income"}` gives the closest live figure, the `launchpad_inc` fund column, but fund
income is a different measure from bookings and substituting one for the other is the error this row
exists to prevent. A bookings figure comes from staff and is a projection, not a measured result.

## Funder history

Added 2026-08-19, OpenProject #306. There was no section here before, which is why a drafting run
reached for `query_donors`, read `no_records`, and filed prior-funder giving history as
`[DATA UNAVAILABLE]` for four funders that have collectively given seven figures.

**Use `query_donors`.** It was repointed under #306 and now reads the `development:*` CRM tabs. Until
that landed it read `donor_contacts` / `donor_gifts` / `donor_pipeline`, which no connector has ever
written, so it answered `no_records` for every funder — and because it is *permitted, not ACL-denied*,
that reply looks like a fact about the funder rather than an empty table. That is the misreading that
cost the 2026-08-19 run. `get_finance_brief.recent_gifts` and `get_entity_brief`'s donor arm were
repointed in the same change.

| The question asks for | Call | Notes |
|---|---|---|
| Everything about one funder | `query_donors {query_type:"profile", donor_name:"William Penn Foundation"}` | **Start here.** One call returns giving summary, itemised history, grants tracker, both pipelines and prior declines. Defaults to **Launchpad scope** — see the scope note below, it changes the number. |
| Whether this funder has declined us before | Same `profile` call — read `prior_declines` | Carries `prior_declines_note` when non-empty. A prior decline changes the framing as much as a prior gift does; check it before writing a first-approach narrative. |
| A list of funders by type or status | `query_donors {query_type:"list", donor_type:"Foundations"}` | Substring match on the COA and status columns. |
| Total raised, all donors | `query_donors {query_type:"summary"}` | Donor count and lifetime giving, split by fiscal year. |
| Raw tab rows, or a figure the profile does not expose | `query_finances {query_type:"dev_*", contains:"…"}` | Six types: `dev_grants_tracker`, `dev_giving_history`, `dev_contacts`, `dev_prospect_pipeline`, `dev_launchpad_pipeline`, `dev_denied`. Use when you need a column `query_donors` does not map. **`contains` matches the whole serialized row**, so "William Penn" also returns Project Based Learning, Inc., whose *fund* is named William Penn. `query_donors` matches name columns only. |

### Scope is not a detail — it changes the figure by six figures

`query_donors` defaults to `launchpad_only: true`. William Penn Foundation, worked all the way
through, gives **three different true numbers**:

| Number | What it is |
|---|---|
| **$1,600,000** | All-time, all Building 21 projects |
| **$1,500,000** | The FY24–FY26 three-year grant — what the KB's stored "$1.5M" claim means |
| **$1,375,000** | All-time, **Launchpad only** |

Because each year is **two gifts**: $425,000 to Launchpad plus $75,000 to Network Unrestricted. So
"$500,000/yr" is the Building 21 figure and **Launchpad's share is $425,000/yr**. Quoting $500,000 as
the Launchpad grant overstates it by $75,000 a year.

Read `giving_summary.by_project` and `by_fiscal_year` and **say in the sentence which scope you
mean**. This is a definitional conflict, not drift: the stored $1.5M was never wrong, it was scoped to
the three-year grant. Resolving it to $1.6M "because the connector wins" would be the error.

### A funder with no Contacts row still resolves

The Contacts tab is a stewardship roster, not the set of everyone we have asked. A funder appearing
only on the giving-history, pipeline or denied tabs comes back with `profile: null` and a
`profile_note` — not `no_records`. Expect no program officer or Drive link on those, but the giving
and decline records are real. If you get `no_records`, read the message: it distinguishes out-of-scope
(retry with `launchpad_only: false`) from absent everywhere.

### `dev_contacts` giving columns are broken at source

`lifetime_giving`, `fy25_giving` and `fy26_giving` disagree with the gift rows — William Penn
Foundation reads `$0.00` lifetime against a real `$1,600,000.00`, and Philadelphia Foundation `$100.00`
against `$112,000.00`. `cy2025_giving` on the same William Penn row carries a correct `$500,000.00`, so
the columns are **inconsistent rather than uniformly empty**: you cannot tell a true zero from a broken
one by looking.

`query_donors` does not read them — it sums the gift rows instead, which is also what makes
`launchpad_only` mean anything for a total. If you go to `dev_contacts` directly, take stewardship
fields only and never a giving figure. The fix belongs in the sheet, not in the connector or this
layer; #306 records it.

## Competency

`query_competency {query_type:"scores"}` **truncates at 1000 rows** against roughly 2346 in the
table. Any mean, growth figure, or completion percentage computed from one call is a partial slice.
Do not quote an org-wide competency figure from it. `query_outcomes {student_name}` is per-participant
and is fine.

## Staff headcount: one number, not two

`figures.ts` previously reported the KB as stating "15 staff / 9 staff" and sent reviewers off to
reconcile two headcounts. There is one. The filed text reads **9 full-time and 1 part-time, all W-2,
plus roughly 30 volunteers**, and the `15` is from the same sentence's "15+ years in education and
workforce development", describing the Executive Director's experience. Corrected in `figures.ts` on
2026-08-17.

No tool returns headcount. What the platform holds is **funded positions** in the Launchpad budget,
readable from the `Annual` tab's salary lines: 7 with non-zero FY2026 spend, 8 projected for FY2027.
Report those as funded positions and say so. A funded budget line and a filled seat are different
things, and they are not expected to reconcile. For an actual roster, ask staff.

## What to write when a cut does not exist

In order of preference:

1. A different cut that honestly answers the question, with its population named.
2. The components, and let the reader combine them. "12 completed, 10 dropped, 18 in progress" is
   more useful than a rate you had to invent a denominator for.
3. `[DATA UNAVAILABLE]`, naming the tool you tried and why it could not answer.

Never: the all-time number when the question was scoped, a figure from a prior filing, or a KB claim
string. All three read as sourced and are not.

**And if you write the same `[DATA UNAVAILABLE]` a second time, that is a bug report.** A gap written
once is honest. The same gap written in the next application means the work order is sending callers
to a tool that cannot answer, and the fix belongs in `figures.ts`. This has already cost the team
once: `get_finance_brief` carrying no income or expense totals was recorded on 2026-08-11 as a run
outcome rather than a defect, and every caller for the next six days was sent to the same dead tool.
Check whether a previous run already wrote your gap. Raise it rather than restating it.

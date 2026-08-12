# Information gaps in the grant pipeline

Every instance found so far where the pipeline could not supply information a funded application
needs: no tool returns it, the tool returns nothing useful, the KB does not hold it, or the stored
answer cannot be trusted without a person.

Source of record: the 2026-08-11 observation run (`docs/runs/2026-08-11/`) over four real form
fixtures, the figure ledger it produced, and the debt registers in `src/data.ts` and `CLAUDE.md` §4.
The run filled 29 of 44 fields; **15 were left `[STAFF]`**. All four fixtures were funders already in
the bank (every question matched at 1.00), so this list is the floor, not the worst case: an unseen
funder adds gap-fill work on top of it.

This file is the persistent register. The run folder records what happened on 2026-08-11; this file
stays and is updated as gaps close.

> **Update 2026-08-12 — the finance gaps are not data gaps.** Every claim in this file was re-tested
> against the live production MCP. The tool defects reproduced exactly as recorded, but probing
> production with `query_finances`' `tab_name` override proved **the rows exist**: `phase_dashboard:2025
> actuals` returns per-phase actuals by account, `Combined Funds` returns account-level totals across
> every fund, `development:grants tracker` returns funder records with `lifetime_total`. §1.1, §1.2 and
> §8.2 are **casing defects in `query-finances.ts`**, so the budget fields all four drafts filed as
> `[DATA UNAVAILABLE]` are answerable today. Two PRs are open: **#49** (finance tab mapping) and
> **#50** (`query_enrollment` filters, §8.1). §9 has the detail.

## How to read the markers

| Marker | Meaning |
|---|---|
| `[DATA UNAVAILABLE]` | A live tool exists but cannot answer. The frozen KB figure is **not** filed, per `references/figures.md`. |
| `[STAFF]` | No tool and no KB answer. A person must supply it. Includes application-specific values that will never be in the KB. |
| Definitional / `[STAFF VERIFY]` | Two correct numbers counting different populations. A person picks the population and the sentence names its denominator. |
| Routing defect | The pipeline answered confidently (1.00) with the wrong slot. Worse than no answer, because nothing downstream flags it. |

---

## 1. Finance and budget figures — `[DATA UNAVAILABLE]`

Every budget field in all four applications came back `[DATA UNAVAILABLE]`. Three separate checks
failed on 2026-08-11.

### 1.1 Annual budget totals — `annual_budget`

- **KB claim:** `$1.34M` FY2025 expenses; `$1.68M` FY2026 projected revenue.
- **Call:** `get_finance_brief(period: ytd)`.
- **Result:** the call succeeded and returned a 39-fund list with **no balances**, a 234-account
  category summary, 20 recent transactions, and empty `sheet_fund_balances` and `recent_gifts`.
  This is not an ACL denial; the tool carries no income or expense total.
- **Blocked on it:** Hamilton Q3 "Total Cost" (the pipeline classified it `fetch_figure` and pointed
  at this call), WPF Q11 "Request Amount", JFF Q8 "Budget Summary". See also §5.1.
- **Re-tested 2026-08-12 — wrong call, and the tool overclaimed.** `get_finance_brief` genuinely
  carries no income or expense total, and never did: `period` only labels the response. The spec
  advertised "YTD revenue vs. expenses" and "top campaigns" anyway, which is what made the absence
  read as an organizational data gap. That overclaim is corrected in PR #49. **The right call is
  `query_finances(fund_balances)`**, matching the `Combined Funds` tab, which returns account-level
  totals across every fund — probed live and populated. Re-source this figure before filing it.

### 1.2 Per-phase costs — `phase_costs`

- **KB claim:** `$519K / $455K / $362K` per phase; `~$6,000` stipend floor.
- **Call:** `query_finances(phase_budget_dashboard)`.
- **Result:** **0 records returned.** The query type the work order named is valid and empty.
- **Blocked on it:** every budget field in all four drafts, WPF Q12 program description, JFF Q8.
- **Re-tested 2026-08-12 — the data is there.** `record_count: 0` reproduced, but the same call with
  `tab_name: "phase_dashboard:2025 actuals"` returned real rows: per-phase actuals by account, with
  `account_number`, `account_name`, `total_launchpad`, `liftoff`, `liftoff_pct`, `hs`, `hs_pct`. The
  connector writes that name in lower case (`sync-phase-budget-dashboard.ts:108-112`); the tool looked
  for Title Case. **Per-phase costs are derivable now.** Fixed in PR #49.

### 1.3 Inc. client-work bookings — `inc_client_work_booked`

- **KB claim:** `$75,000` of Launchpad Inc. client work booked July 2026; two clients with hiring
  intent in writing at `$50,000–$80,000`.
- **Call:** `get_finance_brief(ytd)` — the only finance tool. The work order itself already says no
  tool returns Inc. bookings directly.
- **Blocked on it:** JFF Q6 (scaling narrative) and JFF Q8. Both claims are strong material if a
  person can source them, and are currently filed nowhere.

### 1.4 Root cause, and the fix in flight

The `fix/mcp-finance-tab-mapping` branch documents why 1.1 and 1.2 looked like "the organization has
no such data": the tab-name lookup in `query_finances` matched Title Case while the Google Sheets
connectors write lower case, so every phase and development query type returned `record_count: 0`;
`sheet_fund_balances` looked for the seed's tab name instead of `Combined Funds`; `budget_actuals`
had no mapping and fell through to a tab nothing writes; and `get_finance_brief` mixed two daily
`aplos:funds` snapshots into one list, duplicating funds and truncating the newest date
(commits `1e5ed0e`, `0591d1b`). **That branch is not merged into `writing/dev`, so the run saw the
broken behaviour.** It also fixes `get_finance_brief`'s reporting (`total_matching`, `truncated`,
`tab_names_matched`) so a small tab is no longer indistinguishable from a missing one. Merge and
re-run before concluding the finance gaps are real data gaps.

**Settled 2026-08-12.** The branch was verified and opened as **PR #49** against `master`. Its tab map
was checked character-for-character against the connectors that write the tabs
(`sync-phase-budget-dashboard.ts:108-112`, `sync-development-crm.ts:21-26`) and matches exactly, and
the branch is green on its own merits: build clean, `pnpm -r typecheck` clean across 13 packages,
**49/49 tests** including all 10 `finance-tab-map.test.ts` cases. The spec doc for these two tools was
also wrong in the other direction and is corrected in the same PR — it documented five
`query_finances` input filters (`fund`, `category`, `row_type`, `launchpad_only`, `donor`) that do not
exist in the code at all.

---

## 2. Organizational facts with no tool and no KB value

These are cover-sheet and people facts that every application needs and nothing returns.

| Fact | Where it blocked | Why it is missing |
|---|---|---|
| Website | GSK Q15, WPF Q5 | No website stored anywhere. The pipeline answered with the street address (routing defect, §7.1). |
| 501(c)(3) determination year | GSK Q13 | KB holds the founding year (2013) and the EIN, not the determination year; the two are not the same fact. The pipeline pasted the EIN (routing defect, §7.2). |
| Building 21 registered address | GSK Q11 | KB holds only Launchpad's hub (801 Market Street). The fiscal sponsor's registered address is a different fact. |
| Contact phone | GSK Q14 | Name, title, and email are stored; phone is not. |
| Low-income / free-reduced-lunch shares | GSK Q8, Hamilton Q9 | Prior filings claim `~90%` low-income and `100%` FRL. **Neither figure is in the connector.** Hamilton's criteria require `>70%` FRL, so this is an eligibility claim and must be sourced from the enrollment workbook before filing. |
| Staff headcount | JFF Q3 | `search_documents("org chart staff roster headcount")` returned **0 results** on 2026-08-11. The KB carries two conflicting numbers (15 and 9), and the stored answer asserts 9 full-time + 1 part-time + ~30 volunteers. Not filed. |
| Individual team bios | JFF Q7 | Bios for program directors, instructors, coaches, and Inc. delivery leads are not in the KB. Naming them requires a person. |

### 2.1 Identity values that return paragraphs instead of one-line answers

`STRUCTURED_VALUE_DEBT` in `src/data.ts` (7 entries) — `cover.legal_name`, `cover.year_founded`,
`cover.fiscal_year`, `cover.authorized_rep`, `eligibility.debarment`, `eligibility.minority_owned`,
`eligibility.prior_funding`. A funder asks for one line; the pipeline returns a full narrative slot
(e.g. `cover.legal_name` returns the 778-character `kb.profile.identity` paragraph). They are
recorded rather than filled because they are organisational facts this layer must not invent —
`kb.profile.identity` says itself: "Still to confirm before applying: Launchpad's own registered
legal name/EIN."

---

## 3. Definitional conflicts — both numbers correct, a person must pick

| Figure | Candidate A | Candidate B | Where it blocked |
|---|---|---|---|
| "Black or Brown" | **80.4%** — 242/301 Black or Latino | **96.0%** — 289/301 identify as other than white alone | GSK Q8, WPF Q12, JFF Q4, Hamilton Q9 |
| PCEP pass rate | **54.2%** all-time — 32 of 59 attempts | **70–100%** per cohort (100% most recent) | JFF Q5, Hamilton Q7, and any certification claim |
| Employer partner roster | KB: **17** and **20** partner counts | Table: **38** external employer names, but most are retail, food service, or community roles, not partnerships. A raw count would present a Popeyes shift as a partnership | WPF Q12 partners paragraph |
| Students served | **145** vs **301** | two definitions of the served population, flagged in `students_served_total` | any "how many people served" sentence |

The Black-or-Brown and PCEP conflicts are marked `[STAFF]` in every draft that uses them rather than
resolved. `query_enrollment(by_race)` returned the 301 detail: Asian 40, White alone 10, undisclosed
3. The PCEP denominator must be named in whatever sentence ends up filed (§8.3 sharpens why).

---

## 4. Claims carried in prior filings that no tool confirms

These were never asserted in the filled drafts; each is a `[STAFF VERIFY]` because the platform
cannot back it.

| Claim | Tool | What came back |
|---|---|---|
| Cohort 1 placement: **11 of 12** (92%) in paid work or training at six months | `query_employment(aggregate)` | Counts of participants and jobs, not a cohort placement rate. No tool returns the denominator. |
| **95%** of 101 graduates move to college, training, or work | none | Same class. 101 all-time shows 38 completed against 34 dropped — a different measure over a different period, not a substitute. |
| **72%** 101 completion rate, most recent program year | none | Same class; not derivable. |
| `$75,000` Inc. bookings + client hiring intent | none | See §1.3. |

The wage drift is *not* on this list: `$350,268 / 88 jobs / ~$20/hr` was re-verified live to
`$367,662.19 / 86 jobs`, avg `$15.52/hr` all-time and `$19.28/hr` for active jobs, and the live
numbers were filed. Drift with a live answer resolves; drift without one is a gap.

---

## 5. Application-specific values — always `[STAFF]`, by design

These will never be in the KB, because they change per application. The pipeline correctly routes
them to staff rather than inventing them:

- Request amounts: WPF Q11, Hamilton Q2, JFF Q8.
- Total project cost: Hamilton Q3 (double-blocked by §1.1).
- Anticipated start/end dates: WPF Q9, Hamilton Q5, Hamilton Q6, JFF Q2 calendar.
- Duration in months: WPF Q10.
- Multi-year request? Hamilton Q4.
- Type of funding requested: Hamilton Q8.
- Proposed project title: WPF Q7 — the stored value is just "Launchpad".
- Joint funding proposal: GSK Q9 — no stored answer, and the pipeline routed it to the partnerships
  narrative, which does not answer a yes/no. Expected "no" but a person must confirm.
- Fiscal-sponsorship framing: the JFF fixture records none, so `[STAFF: confirm framing]` applies to
  the whole document.
- Named staff assignments and the grant-period calendar: JFF Q2.

---

## 6. Content gaps in the knowledge base

### 6.1 The Lightspeed phase — 0 of 29 KB slots mention it

The platform records a **Lightspeed** phase with **15 completions** (7 in summer 2024, 8 in summer
2025, 15 of 15 completing, none dropping, 14 of 14 who sat PCEP passing) that appears in **no** KB
program description. Every drafted program description therefore omits a phase. Re-confirmed
2026-08-11: still absent.

The KB's own reconciliation prose is **wrong about it** and must not be copied into a draft: it
describes `Foundations → 101 → Lightspeed → LiftOff` as a linear pipeline, but the data does not
support that — Lightspeed is a 7-week summer intensive run between school years, and both completers
whose full history was inspected had `101: Not Enrolled`. The correct facts are now in the
`enrollment_by_phase` note in `src/figures.ts`; what remains is programme copy in Launchpad's voice,
which is a staff decision.

### 6.2 Six slots too thin for the longest ask routed to them

`needs_expand` (2026-08-11) makes this visible at draft time rather than silent. Measured against
the largest word limit recorded on any question routing to each slot: `kb.staff_bios` 110 words vs
600, `kb.history` 119 vs 500, `kb.target_population` 86 vs 300, `kb.capacity` 129 vs 250,
`kb.dei` 122 vs 250, `kb.evaluation` 116 vs 200. Expansion is where invention happens; needs a
person.

### 6.3 The KB snapshot is older than the bank

`kb.meta.updated` is `2026-07-23`; `questions.json` `meta.updated` is `2026-08-11`. The connector
reconciliation prose is dated the same 07-23 and its four staff flags — served count, PCEP
denominator, Lightspeed, postsecondary — are all still open. Every figure the KB carries is
therefore a 07-23 snapshot, and the ledger re-checked each live before filing.

---

## 7. Routing defects at 1.00 confidence

A confident match to the wrong slot, all in `seed/questions.json`. Same class as the `cover.address`
defect already documented in the grant-writing skill.

| Wording | Routed to | Returned | Blocked on it |
|---|---|---|---|
| "Website" | `cover.address` | the street address | GSK Q15, WPF Q5 |
| "Year your organization received 501(c)(3) status" | `cover.ein_taxstatus` | the EIN | GSK Q13 |
| "Explain the issue that your program is seeking to address" | `cover.address` (the *mailing address*) | the address | known defect, any funder using the wording |

Plus `ACKNOWLEDGED_TIES` (3) in `src/data.ts`: wordings recorded against two canonicals each
(Instrumentl mission/history, NNG board list + demographics, FFTC target population + count), where
an incoming form asking one verbatim scores 1.0 against both and bank order decides the match. These
are recorded rather than resolved because placing the wording changes matcher output and obliges a
parity regeneration.

---

## 8. Tool behaviour that undermines answers

### 8.1 `query_enrollment` silently drops filters — fixed in PR #50

The input schema accepts `phase`, `status`, `current_phase`, `enrollment_status`, and `cohort` on
every `query_type`, but each branch applies only some: `by_phase` builds `studentWhere` and never
uses it; `by_student` ignores `phase`/`status`. No error and no echo of which filters were honoured
(`apps/mcp-server/src/tools/query-enrollment.ts`, verified 2026-08-11). A caller who thinks they
scoped to 15 Lightspeed completers gets all 301 students back. This is the grant layer's whole
failure mode: the wrong denominator.

**Reproduced live 2026-08-12**, exactly as recorded: `by_phase` with `current_phase: Lightspeed` and
`enrollment_status: Completed` returned the full 301-student, all-four-phase breakdown.

**The defect was wider than this entry recorded.** Reading the file to fix it turned up two more:
`active_during` builds its own `where`, never uses `studentWhere` at all, **and ignores `status`**; and
`total`, `by_cohort`, `by_school`, `by_race` and `by_program_year` all ignore `phase`/`status`. Every
one of the eight query types dropped something.

**Fixed in PR #50.** All five non-date filters now apply to all eight query types — student columns
reach phase-outcome queries through the `student` relation, `phase`/`status` reach student-level
queries through `phaseOutcomes: { some: ... }`. Every response carries `filters_applied`, plus
`filters_ignored` when a filter does not apply to the chosen `query_type`, so a dropped filter can
never again be invisible. Adds `query-enrollment-filters.test.ts` (8 cases); full suite 56/56.

### 8.2 `query_finances` case-mismatch — see §1.4

Eleven query types returned zero for a casing defect, not missing data. The fix is verified and open
as **PR #49**.

### 8.3 `query_competency(scores)` is capped

`record_count` came back exactly 1000, so the aggregate the call returned (177 students, 21
competencies, 328 scored rows, mean growth +0.24, median 0.0) covers a truncated set. Not filed as a
figure. **Reconfirmed 2026-08-12: still exactly 1000.** Unlike §1 and §8.1, no fix is in flight — the
tool needs a `total_matching` / `truncated` pair of the kind PR #49 adds to `query_finances`.

---

## 9. Fixes in flight

| Branch | State (2026-08-12) | Closes |
|---|---|---|
| `fix/mcp-finance-tab-mapping` | **PR #49 open** against `master`. Verified: build clean, typecheck clean across 13 packages, 49/49 tests | §1.1, §1.2, §8.2 — finance tab matching, `budget_actuals` tabs, `sheet_fund_balances`, funds-snapshot dedup, honest `record_count`, plus the `query_finances` / `get_finance_brief` spec corrections |
| `fix/query-enrollment-filter-application` | **PR #50 open** against `master`. Verified: typecheck clean, 56/56 tests | §8.1 — all five non-date filters applied on all eight query types, plus the `filters_applied` / `filters_ignored` echo |
| `fix/google-drive-discovery` | not merged, not reviewed | the Grants corpus connector (`find_grant_documents`), which is the rung-3 prior-filings source the gap-fill ladder depends on |

Neither PR is merged or deployed, so **the live tools still show the broken behaviour**. Re-run the
figure checks after they ship; the §1 finance figures should then be re-sourced rather than filed as
gaps.

**How the finance gaps came to be misdiagnosed, and a near-repeat.** The 2026-08-11 run read "no such
data" off an empty envelope that was actually a mapping defect. The same shape of error nearly recurred
on 2026-08-12 in the opposite direction: a stale local `packages/db/dist/` from 2026-08-03 exported
`Prisma` as a type where `packages/db/src/index.ts:3` exports it as a value, producing 8 × TS1362 in
`query-certifications.ts` that looked exactly like a defect #47 had landed on `master`. It was reported
as such and withdrawn once `pnpm --filter @lp-ai/lib-db build` cleared it — **`master` was never
broken.** Two habits follow: rebuild workspace packages before believing a type error, and probe with
`tab_name` before believing an empty result.

---

## 10. Where each gap would be closed

| Gap | Fix | Owner |
|---|---|---|
| Finance totals and phase costs (§1.1, §1.2) | **merge PR #49**, then re-source. The rows are confirmed present, so treat these as answerable, not missing | eng |
| Inc. bookings (§1.3) | new finance tool or staff sourcing | eng / staff |
| Website, registered address, phone, determination year, legal name (§2) | fill `kb.profile.identity` and contacts from a person | staff |
| Low-income / FRL shares (§2) | source from the enrollment workbook | staff |
| Staff headcount and bios (§2) | org-chart source or staff | staff |
| Definitional conflicts (§3) | a person picks the population; sentence names its denominator | staff |
| Unverifiable claims (§4) | cohort-scoped reporting tool, or staff confirmation | eng / staff |
| Application-specific values (§5) | a person, always | staff |
| Lightspeed (§6.1) | programme copy in Launchpad's voice | staff |
| Thin slots (§6.2) | deliberate expansion, reviewed | staff |
| Routing defects (§7) | bank wording edits + parity regeneration. Reconfirmed 2026-08-12: 92 questions, still no `cover.website` and no determination-year canonical, and `cover.address`'s FFTC variant literally contains "Organization web address" — so "Website" scores 1.00 there by construction | eng |
| `query_enrollment` filters (§8.1) | **merge PR #50** | eng |
| `query_competency` cap (§8.3) | `total_matching` / `truncated` on that tool, as PR #49 adds to `query_finances` | eng |

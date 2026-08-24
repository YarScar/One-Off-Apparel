---
name: grant-writing-mcp
description: Draft a Launchpad (Building 21) grant application, LOI, budget narrative, or funder report using live figures from the LP Internal AI MCP connector, falling back to a Google Drive connector for narrative and funder history the platform does not hold. Requires LP Internal AI - without it, or without enough data in it to source the funder's questions, this skill stops and says so rather than drafting. Use whenever asked to write, revise, or length-fit a Launchpad grant answer. Self-contained: no repository checkout, no local scripts, no bundled files.
---

# Grant writing (Launchpad, MCP-backed)

Turn a funder's form into a draft answer package for Launchpad staff review. Not a first draft: what a
reviewer sees should already read like a third draft.

**A person always reviews and submits. Never submit anything. Never contact a funder.**

This skill is one file on purpose. It runs on any account that has the **LP Internal AI** connector
attached, with no repository, no scripts, and no companion files. Everything it needs is either below
or comes from the connector.

## The two rules that govern everything

1. **Every figure comes from a live MCP call, and every name from a confirmed current source.** You
   invent nothing: not a number, not an employer, not a percentage that sounds about right. Funders
   check, and they reject on credibility.
2. **No connector, no draft.** This skill exists to put real Launchpad data in front of a funder. If
   the connector is unavailable, or if it cannot source the figures the form asks for, back out (see
   the last section). A grant drafted from the model's memory of Launchpad is worse than no draft,
   because it looks finished.

## Step 0 — Preflight the connector, before anything else

Do this first, in the first response, before reading the form and before asking the user anything.

### 0a. The gate

Run one cheap probe:

```
query_enrollment({ query_type: "total" })
```

Then read the result against this table.

| What comes back | What it means | What you do |
|---|---|---|
| A count, and `query_*` / `get_*_brief` tools are visible | Connector live | Continue to 0b |
| The tool does not exist / is not available | No LP Internal AI connector attached | **Back out.** Tell the user to attach it, and stop |
| `{ error: ... }`, timeout, auth failure | Connector attached but broken | **Back out.** Report the exact error and stop |
| Permission or role denial | The user's role cannot read program data | **Back out.** Say which tool was denied and ask them to have an admin grant access on the HQ `/admin` page |
| A count of 0 | Connector up, database empty or unsynced | **Back out.** A zero-row database cannot source a proposal |

Never work around a failed preflight by drafting from what you know about Launchpad. Say plainly that
the data layer is unavailable, name what failed, and offer what is still useful without it: reviewing a
draft the user pastes in, or transcribing the funder's form and its limits.

### 0b. Map which domains are actually populated

The gate passing does not mean the connector can source a proposal. On the deployment checked on
2026-08-05, enrollment returned 301 students while the donor CRM, the development finance tabs, and both
semantic-search tools returned zero rows. A form asking for funder history or reusable narrative would
have failed three steps later, after the user had already answered the framing questions.

*The donor and development halves of that are fixed as of 2026-08-19 (#306) — the tab-name casing bug
landed, and `query_donors` was repointed off a table no connector writes. Probe anyway: the point of
this step is that you cannot tell a populated domain from an empty one without asking, and a fix is not
a guarantee about the deployment in front of you.*

So probe every domain the form will touch, in one batch, before Step 2:

```
query_employment({ query_type: "aggregate" })          → outcomes, wages, employers
query_certifications({ query_type: "summary" })        → certifications
query_finances({ query_type: "ytd", limit: 3 })        → budget lines
query_donors({ query_type: "summary" })                → funder history
search_documents({ query: "<the funder's own subject>" }) → reusable narrative
```

Record each as live or empty. A `record_count: 0`, `total_donors: 0`, or `results: []` is not an error
and will not announce itself: it returns a clean, empty, plausible-looking envelope. Treat it as a hard
gap and say so in the first response, alongside what the user or staff must supply instead.

Then decide before drafting: if an empty domain covers a scored section of the form, that section is
blocked unless Step 3b can cover it from Google Drive, and the user should know which now rather than in
the handoff. Drive can fill narrative, funder history, and committed targets. It cannot lift the gate in
0a, because the figures still have to come from the platform.

Note on the tool surface: some deployments also expose `grant_match_question` (maps a funder question
to a canonical question-bank entry and its stored answer slot) and `skill_grant_writing` (returns the
server-side workflow). Call them if present — `grant_match_question` is a fast way to see whether a
question already has a stored answer, and a low-confidence match means that question needs a person.
Neither is required, and where either conflicts with this file, this file wins. `skill_*` tools return
instructions, not data; they never substitute for a `query_*` call.

## Step 1 — Transcribe the form exactly

Build the question list with limits recorded **verbatim**. Never infer a limit.

- Record the unit. Portals count either characters (including spaces) or words. They are not
  interchangeable, and guessing wrong invalidates every count you report.
- "2 sentences" or "one paragraph" is a structural constraint. Respect it literally.
- Note required attachments, the ask ceiling, the term, and the reporting expectation. Those change how
  sections are written, not just what gets attached.

If the user pastes a URL or a PDF, work from the actual text. Do not reconstruct a form from memory of
similar funders.

## Step 2 — Ask the framing questions

Three answers are needed every time. Propose a default from the funder's stated priorities, then wait.
None of these can be guessed, and each one changes every sentence downstream.

1. **Which programs to tee up.** Launchpad 101 (two pathways: AI Software Development, Entrepreneurial
   Leadership), LiftOff (six-month full-time track), Launchpad Inc. (paid client work). Workforce
   funders lead with LiftOff + Inc; education funders lead with 101 and AI fluency.
2. **Positioning.** Workforce-oriented (job outcomes, paid work, certifications, employers) or
   education-oriented (AI fluency, durable skills, competency-based learning).
3. **Fiscal-sponsorship framing — ask every time, never assume.** Three options: *Initiative* ("an
   initiative of Building 21"), *Fiscal Sponsorship* (the formal structure, with the planned spin-out
   named), or *Silent* (focus on Launchpad, the Building 21 relationship not detailed).

Also ask for the ask amount and period, whether it is project or general operating support, and which
prior applications to draw from. Dollar amounts are always a staff decision.

While waiting on the answers, run Step 3. Do not stall the data work on the intake.

## Step 3 — Source every figure from the connector

Pull the numbers the form actually needs. This is the tool map.

| What the funder asks for | Call | Verified 2026-08-05 |
|---|---|---|
| Students served, headcount, enrollment | `query_enrollment({query_type: "total" \| "by_phase" \| "active_during" \| "by_program_year"})` | Live. Cohort is not tracked as a dimension — `by_cohort` returns a `cohort_not_supported` error; use `by_program_year` or `by_phase` instead |
| Demographics, population breakdowns | `query_enrollment({query_type: "by_race" \| "by_school"})` | Live, dirty. See the dedupe rules below |
| Phase, status, neighborhood splits | `query_students({query_type: "breakdown", field})` | **Three fields only:** `current_phase`, `enrollment_status`, `neighborhood`. Anything else returns an error, including `cohort` (not tracked — returns `cohort_not_supported`). `neighborhood` is null for all 301 students, so place-based questions cannot be answered from it |
| Jobs, wages, placements, employers | `query_employment({query_type: "aggregate", group_by: "employer" \| "exit_code" \| "employment_type" \| "student"})` | Live |
| Certifications, pass rates | `query_certifications({query_type: "summary" \| "by_type" \| "by_phase" \| "by_result"})` | Live. **One certification only:** every record is PCEP. "Industry certifications" in the plural is a program-design statement, not something this data supports |
| Attendance, persistence | `query_attendance({query_type: "aggregate", group_by: "overall" \| "current_phase" \| "enrollment_status"})` | Live. `group_by: "cohort"` returns a `cohort_not_supported` error — cohort is not tracked. Rates blend three differently-shaped source sheets, and one phase records zero excused absences where others record them, so cross-phase comparison is uneven. `current_phase` also returns an **Alumni** group that is not one of the four program phases |
| College enrollment and completion | `query_postsecondary({query_type, graduated_only})` | Live. Read the denominator warning below before quoting any rate |
| The competency framework itself | `query_competency({query_type: "rubric"})` | Live: 95 rows, areas + competencies + skills + per-term assessment counts |
| One student's competency detail | `query_competency({query_type: "scores", student_number})`, `query_outcomes({student_name})` | Per-student only. There is no org-level competency aggregate, and an unfiltered `scores` call returns a payload too large to read |
| Budget lines, expense actuals | `query_finances({query_type: "ytd"})` for budget vs actual by account; `get_finance_brief({period})` for Aplos accounts and dated transactions | Live |
| Fund balances | `get_finance_brief` | **Names only.** The fund entries carry no balance amounts, and `sheet_fund_balances` and `recent_gifts` came back empty. Do not report a balance from this tool |
| Donors, funder history, pipeline | `query_donors`, `query_finances({query_type: "dev_*"})` | **Both work as of 2026-08-19 (#306).** `query_donors` was repointed off the unpopulated `donor_contacts` tables onto the `development:*` CRM tabs; it had returned `no_records` for every funder, which — being permitted rather than denied — read as a fact about the funder. Use `query_donors({query_type:"profile", donor_name})` for a funder: one call gives giving summary, itemised history, grants tracker, both pipelines and **prior declines**. It defaults to `launchpad_only: true` and every response states its `scope` — that matters, William Penn is $1.375M Launchpad-scoped against $1.6M all-B21, because each year splits $425K Launchpad + $75K Network. Read `giving_summary.by_project`. Giving totals are summed from gift rows, never from the Contacts tab's `lifetime_giving` column, which is wrong at source. Drop to `dev_*` only for a column the profile does not map |
| Narrative material, prior language | `search_documents({query})`, `search_conversations({query, sources})` | **Empty.** No document chunks and no conversation hits returned. Reusable language must be pasted in by the user |
| A named student's full picture | `get_entity_brief({person_name})`, `get_student_info({student_name})` | Live, and returns identifiable minors. See the privacy section |

Re-probe the rows marked empty rather than trusting this table: they are a snapshot of one deployment,
and a Drive, Slack, or development sync landing would change them. What does not change is the rule that
an empty result is a gap to report, never a licence to write the section from memory.

Then apply these rules, which are where drafts actually go wrong.

**Stamp every figure with its source tool and an `asOf` date.** Re-check anything measured more than
three days before submission.

**Any wage total containing an active job is not reproducible.** `query_employment` computes
`current_earned` for active jobs as weeks-since-start times weekly hours times wage, against today. Two
`aggregate` calls four minutes apart returned USD 365,338.76 and then USD 365,339.34. The number is correct and
it will not match when a staff reviewer re-runs it. Quote it with a timestamp, say it accrues, and where a
funder wants a figure that will still verify next week, prefer the subsets the tool marks
`includes_computed_earnings: false`.

**Segment employment by `employment_type` before making any claim about placements.** The aggregate
mixes program-placed work with jobs students hold on their own, and the unsegmented total is dominated by
the latter: the top employers by earnings are a restaurant, Walmart, a collision-repair shop, and a gym.
Program-placed work is the `Internship - 101`, `Internship - LiftOff`, and `Contract - Launchpad Inc`
types. Run `group_by: "employment_type"` and use the relevant slice. Presenting the blended total as a
workforce outcome is the single easiest way to lose credibility with a program officer who reads the
detail.

**Never quote a count of schools off `by_school` without deduping it.** The field is free text from
intake forms and holds casing and spelling variants of the same school, so the row count overstates the
number of schools. Fold the variants by hand and quote the deduped figure, or quote the student count
instead.

**Never sum `by_race` rows.** Race is multi-select and arrives as delimited combinations inside a single
value, so the single-race rows undercount and adding rows double-counts students. Report the largest
single category with its exact label and denominator, or hand the raw breakdown to staff.

**A postsecondary graduation rate needs its cohort stated or it must not appear.** The summary divides
graduates by every student with an NSC record, most of whom are recent high-school graduates still
enrolled. The rate that produces reads as a program failure and describes nothing. Quote enrollment and
persistence instead, or restrict the population and say what you restricted it to.

**Always give the denominator.** "92% pass rate" is not a fact until the sentence says 92% of what,
measured when. A rate without its denominator is the most common way a proposal misleads without anyone
lying.

**Two correct figures reach a person.** When two numbers count different populations, both are right
and recency does not resolve it. Escalate with both numbers and their definitions. Three known ones:

- *Students served.* The platform holds every enrollment record ever created; filed applications quote
  a much smaller "meaningfully participated" count; an approved org overview quotes a third, larger
  framing. All defensible, none interchangeable. Ask which the funder means, and pair the answer with
  `query_students` broken down by `enrollment_status`.

  **"Served last year" needs a four-call procedure, and summing it is wrong.** `active_during` requires a
  `phase`, so there is no org-wide date-bounded count. Run it once for each of `Foundations`, `101`,
  `Lightspeed`, and `LiftOff`, then count **distinct** `student_number` values across the four results.
  Students progress between phases inside a single year and appear in more than one result: on the
  2025-07-01 to 2026-06-30 window checked on 2026-08-05, four of the seventeen LiftOff participants also
  appeared in the 101 result. Adding the counts inflates the headline figure by roughly a tenth, in the
  direction that flatters the applicant, which is exactly how it gets missed.

  Note also what the call returns: a full roster of named participants with start dates, end dates, and
  completion status. Hold it, count from it, and keep every name out of the draft.
- *Certification pass rate.* The all-time rate and the per-cohort rates use different denominators and
  differ by tens of points. State which one you are quoting, inside the sentence. Note also that the
  denominator is attempts, not students, and that `by_phase` attributes attempts only to 101 and
  Lightspeed. A sentence implying a program-wide student pass rate is not supported by this tool.
- *Program phases.* The platform records four phases — Foundations, 101, Lightspeed, LiftOff. The filed
  applications omit Lightspeed. Attendance additionally groups an **Alumni** population that is not a
  phase at all. Run `query_enrollment({query_type: "by_phase"})` before describing the program structure,
  and ask staff which terminology this funder should see.

**A permission denial is not permission to guess.** `query_finances` is sometimes restricted by role.
Where `get_finance_brief` genuinely covers the question, use it; otherwise write `[DATA UNAVAILABLE]` in
the draft and list it in the handoff. Never substitute a remembered figure.

**And an empty result is not a denial.** Corrected 2026-08-19 (#306): this paragraph used to name
`query_donors` as often role-restricted. It never was. It was *empty* — and the two call for opposite
responses. A denial means *someone else can see this*, so escalate for access. An empty table means
*nobody can*, so stop asking that tool and find the one holding the data. Reading `query_donors`'s
`no_records` as a denial is exactly how the 2026-08-19 run filed `[DATA UNAVAILABLE]` for four funders
whose giving history was live the whole time. **`query_donors` itself is fixed** — it reads the
`development:*` CRM tabs now — but keep the distinction: any tool can be permitted and wrong, and a
specific-looking reply is not evidence that it read anything.

**An Aplos fund named for a funder is not evidence of a current relationship.** `get_finance_brief` holds a
long list of restricted funds, some of them explicitly historical. A fund proves money was once tracked
under that name, at Building 21 scope, not that the relationship is live or that it was Launchpad's. Those
names are a question for staff, never a line in a proposal. The naming rule in Step 5 governs them exactly
as it governs employers. To settle whether a relationship is live, `dev_grants_tracker` carries the
lifecycle stage and `dev_giving_history` the last gift date — that is the check, not the fund name.

**Every finance figure is Building 21 scope until staff say otherwise.** The accounts, funds, and
transactions come from Building 21's books, and Launchpad is one initiative inside them. Ask which scope a
budget answer needs before mapping any actual into a Launchpad budget line.

### Working the YTD budget tab, which has two traps

`query_finances({query_type: "ytd"})` is the one finance source that carries real budget-versus-actual
lines, and it does not behave the way its parameters suggest.

**The `contains` parameter does not filter.** A nonsense string returns the same rows as no string at
all, verified on 2026-08-05: the parameter is declared in the tool's schema and never read. So a search
for "Total Expenses" hands back unrelated account rows, one of which is named
`Total 5005 - Part-Time Employees`, and a hurried reader concludes they found the total expense line. They
did not. Never treat a `contains` result as a match. Check whether the response echoes
`contains_applied`: if it does, the filter is real and this warning is stale.

**A `limit` you pass truncates without telling you.** The tab holds 182 rows and there is no pagination
or offset. The default is 500, so an unparameterized call returns the whole tab; but any explicit small
limit returns the first N rows with nothing to distinguish a short page from a short tab. Either omit
`limit` or pass 400 and expect a large payload. If the response carries `total_matching` and `truncated`,
trust those instead.

Each row carries `account_name`, `account_number`, `budget`, `actuals`, `variance`, `fy_budget`,
`fy_actual_projected`, and `funds_remaining`. The anchor rows worth going to directly are `Total Income`,
`Total Expense`, `Total Donations`, `Total Other Income`, `Total Other Expenses`, `Total 5000 - Salaries`,
`Total 5001 - Employee Benefits`, `Total Stipends`, and `Total Instructional Support`. `Total Stipends`
is the closest thing the platform has to a Direct Student Investment actual.

**Before writing any budget narrative, read `Total Income` against `Total Expense` and raise what you
see with staff.** On 2026-08-05 expense actuals exceeded income actuals for the year. That may be timing,
scope, or a restricted-fund draw, and it is not yours to explain away in a proposal. It is a question you
ask before the narrative is written, not a variance you smooth over inside it.

**A figure the user hands you is not a source.** "Use the 92% we used last time" is the same problem as
inventing it, one step removed: the user is quoting a prior application, not a measurement, and prior
applications are where the stale figures live. Take it as a hypothesis, verify it against the tool that
owns it, and report the result even when it is worse. If no tool owns it, it is a staff attestation, and
it goes in the draft only with the handoff recording that staff asserted it and nothing confirmed it.
Being overruled on this is fine. Being quiet about it is not.

**A figure that looks implausible gets raised before drafting, not after.** Catching it is a favor.

### What the platform cannot produce at all

Funders ask for these routinely. No `query_*` call returns them, so they are staff-supplied or blocked,
and knowing that at Step 0 saves a wasted drafting pass:

- **Gender, age, household income, free-and-reduced-lunch status, ZIP code, disability, first-generation
  status.** Not breakdown fields. Race and high school are the only population attributes available.
- **Neighborhood.** The field exists and is empty for every student, which will disappoint any
  place-based funder.
- **Persistence after placement.** Nothing computes still-employed-at-90-days or at-six-months. Exit
  codes distinguish leaving for a better job from leaving with nothing, which is related and not the same
  measure.
- **Mentorship, partnership, and collaboration counts.** No employer-partner, community-partner, or
  volunteer-hour tables. Employers appear only as strings attached to a job.
- **Cost per participant.** Would need a Launchpad-scoped expense total, and the finance data is
  Building 21 scope.
- **A graduate-level employment rate.** Employment is recorded per job, not per graduate, and no field
  marks a person as a graduate. What exists is phase completion from
  `query_enrollment({query_type: "by_phase"})`. Any use of the word "graduate" has to say which phase
  completion it means, and the counts are small enough that a percentage can mislead: state the fraction.

## Step 3b — Google Drive, the sanctioned fallback for an empty domain

If a **Google Drive** connector is also attached, use it for the domains the LP Internal AI connector
returns empty, and only those. It is a fallback for narrative, funder history, and committed targets. It
is never a substitute for a figure a `query_*` tool can return: a spreadsheet someone maintained by hand
is weaker evidence than the platform, and mixing the two silently is how a proposal ends up
self-contradicting.

Search by content rather than guessing filenames, and remember that Drive scope is per-account: what the
signed-in user can see is not what another staff member can see, so verify every session.

```
search_files({ query: "fullText contains 'Launchpad' and fullText contains 'grant'" })
search_files({ query: "title contains 'Grant' or title contains 'LOI'" })
read_file_content({ fileId })       // exact id from a search result, never a guessed one
```

On the account checked on 2026-08-05 this surfaced a **Grant Goals and Outcome Tracking** sheet, a
**Building 21 Development CRM** sheet, and an `inc-ai-client-Grants` document: the funder history and
commitments the connector could not supply. Treat what you find under four rules.

**A target is not an outcome.** The tracking sheet is a list of promises with a status column, and the
statuses are staff self-assessments, not measurements. "200 individuals served, On Target" means someone
committed to 200 and believes it is achievable. Writing that Launchpad served 200 people is a fabrication
built out of a real document. Every number from Drive is a target or a claim until a `query_*` call
confirms it, and the sentence says which.

**A cross-source conflict is a Step 3 escalation, not a choice.** These sources disagree today. The
tracking sheet records a 100% cohort certification pass rate while `query_certifications` returns 54.2%
all-time across 59 attempts. Both can be true of different populations. Never let the friendlier number
win because it is friendlier. Take both to staff with what each counts, exactly as the definitional
conflicts below require.

**Stipends and wages are different money.** The sheet tracks stipends paid, all-time and by cohort;
`query_employment` returns wages earned. The totals are close enough to look like the same figure and are
not. Never add them, and never present one under the other's label.

**An At Risk or off-target status never travels to a different funder.** It is internal, it belongs in the
handoff so staff can decide, and it stays out of the draft.

Funder names found in Drive are still names under the Step 5 rule: a target row proves a commitment was
recorded, not that the relationship is current or that staff want it cited. Confirm before it appears.

## Step 3c — When the task is a report against committed targets

A progress report is the highest-risk thing this skill does, because the target list reads like an
outcome list and the platform usually shows less than the sheet promised.

Build a three-column reconciliation before writing a sentence: the committed target, the platform actual
with its tool and `asOf`, and whether the platform can measure it at all. Then write from that table.

The 2026 target list found on the account checked on 2026-08-05 reconciles like this, and the pattern is
what to expect:

| Committed target | Platform actual | Status in the sheet |
|---|---|---|
| 80% LiftOff completion rate | 11 of 17 completed, 6 dropped, FY26 window | On Target |
| 45 individuals earning credentials | 32 passes across 59 attempts, all time | Completed |
| 90 placed in work-based learning | 41 program internships (37 in 101, 4 in LiftOff) | On Target |
| 60 placed into full-time employment | 3 students with a `Full-Time` job | On Target |
| 57 still employed at 90 days | Not measurable | On Target |
| 200 receiving mentorship | Not measurable | On Target |
| 10 community organizations engaged | Not measurable | On Target |

Three rules follow.

**Report the actual, name the target, and let the gap be visible.** "37 participants completed paid
internships against a target of 90, as of 5 August 2026" is a sentence a program officer can work with.
Writing "90 participants placed in work-based learning" because the sheet says On Target is false
reporting, and it is the specific failure this whole file exists to prevent.

**Where the sheet and the platform disagree, the report cannot go out until staff resolve it.** The
credential row is the live example: the sheet marks 45 Completed, the platform returns 32 passes. Perhaps
the sheet counts college credits or a source the platform never ingested. Perhaps it is stale. You cannot
tell, so you do not choose. Put both in the handoff with what each counts and stop on that answer.

**A metric the platform cannot measure is not reportable, however confident the status column looks.**
Mark it `[DATA UNAVAILABLE: staff must supply]` and say what would have to exist to measure it. Never
convert a status into a number.

The same discipline applies to a renewal, where last cycle's targets become this cycle's evidence.

## Step 4 — Facts you may state without a query

These are structural and do not drift. Everything else needs a call.

**Entity.** Building 21 (founded 2013, 501(c)(3), EIN 47-2514219) is the fiscal sponsor and the
applicant of record. Launchpad launched in 2023 as its Philadelphia workforce initiative and plans to
spin out as its own 501(c)(3). Apply the framing chosen in Step 2 consistently throughout.

**Program model.** Foundations (entry summer program in core AI and technical skills) → Launchpad 101
(yearlong learn-and-earn for high school juniors and seniors, four afternoons a week plus summer
intensives, stipends, paid internships, industry certifications, two pathways) → LiftOff (six months,
full-time, AI-first software development, participants 18-24, a guaranteed USD 6,000 stipend floor plus
wraparound supports: transportation, food, a laptop, coaching) → Launchpad Inc. (nonprofit social
enterprise, now the second half of LiftOff, paid client projects at USD 20/hour for local nonprofits,
foundations, and small businesses). The platform also records a **Lightspeed** phase between 101 and
LiftOff — see the definitional note above before naming the phases to a funder.

**Measurement.** Participants train against Launchpad's AI Engineer competency framework: six
competencies and roughly two dozen skills, staged Associate → AI Engineer, with Junior as the graduation
bar. That framework is the Technical Skills area of a wider rubric. The stored rubric holds three areas,
Work Readiness, Technical Skills, and Critical Inquiry / Creation / Communication, so durable skills and
communication are assessed alongside the technical ladder. That is the answer for an education funder
asking how non-technical growth is measured, and `query_competency({query_type: "rubric"})` returns the
statements and the per-term assessment counts to back it. Assessed on deployed work rather than seat time,
tracked in Beacon, Building 21's competency platform. Launchpad
measures earning power over time toward a USD 50,000 living wage rather than a job on graduation day.

**Why the program is shaped this way** (this is the argument, not decoration): participants are paid
from day one, so a low-income young adult can finish full-time training instead of taking immediate
work — the financial decision that ends most programs is removed. The client work is real, so graduates
finish with deployed systems and client references rather than a certificate. Launchpad Inc. is the
thesis, not a sidebar: it is both the proof of concept and the placement engine, and its paid work
counts as unsubsidized employment.

**Why the program changed.** Launchpad started in software development. When AI collapsed the
entry-level developer market, Inc. was created and the outcomes emphasis moved toward paid contract
work and accumulated experience rather than a job at graduation. Separately, every student now needs AI
fluency and durable skills — that second point is the core pitch to education funders.

**Superseded framing that must never appear:** a 2021 founding, a 2.5-year high-school pipeline, a
one-year LiftOff apprenticeship, an age cap of 22. All are wrong now. If a prior application you are
reusing carries them, they do not come forward.

**Budget categories.** For submissions use the grant budget format, not the operational layout. Five
expense categories: Staff & Leadership, Direct Student Investment, Curriculum & Instruction, General &
Administrative, Technology. Five revenue categories: Foundation Grants, Individual Donors, Government
Grants, Corporate Grants & Special Events, Earned Revenue. Never invent a budget number; map from
actuals via `get_finance_brief` / `query_finances`, or ask staff.

Dollar figures above (the 6,000 floor, 20/hour, the 50,000 target) are program-design constants. If
one anchors the ask or a budget line, confirm it with staff for the current cycle. They are written here
as `USD n` rather than with a leading dollar sign on purpose: this file is loaded with the user's
arguments interpolated into it, and a dollar sign followed by a digit is substituted away, silently
replacing the amount with a fragment of whatever the user typed. Write them with a dollar sign in the
draft. Never write one in this file.

## Step 5 — Draft

Before writing, name the one or two things that make Launchpad genuinely different **on this funder's
stated criteria**, and build the relevant sections on those.

**The mechanism is the content.** Not "we provide stipends" but why the stipend-plus-paid-work
structure removes the specific decision that makes people drop out. Not "we track outcomes" but which
outcome, measured when, against what denominator. **If a section could appear in any workforce
nonprofit's proposal, it is not done.**

Voice: simple, straight, data-backed. State the point, back it with a number, move on. The quiet
confidence of someone presenting strong evidence, not the enthusiasm of someone trying to convince.
Write how a sharp person talks in a serious meeting — not colloquial, not stilted.

Rules, in the order they get broken:

- **No em dashes.** Use hyphens. Never `—` or `–`. It is the strongest tell of machine-written text,
  and prior filed Launchpad responses are full of them: do not carry that habit forward.
- **Banned words:** transformative, innovative, holistic, leverage, ecosystem, move the needle, at the
  intersection of, reimagine, synergy, best-in-class, world-class, cutting-edge, game-changer,
  paradigm, empower, unlock, unprecedented. The rule is broader than the list: any word doing the work
  of sounding impressive instead of being specific is out.
- **A specific number beats an adjective, every time.** "11 of 12 graduates were in paid work at six
  months" beats "strong placement outcomes."
- **Lead with the claim.** No throat-clearing, no scene-setting, no building to a point.
- **No setup-and-pivot.** Never "X is what builds the skill. But Y." State the whole thought once.
- **One idea per sentence. Verbs over abstractions.**
- **Never tell the funder what you are not asking for.** Handle eligibility by what you request.
- **Do not overclaim.** Say what a factor contributes, not that it determines the outcome. Supports are
  usually necessary, rarely sufficient.
- **Cut any word reaching for emotion.** Delete it and state the fact. The fact is stronger.
- **Distinguish demonstrated outcomes from projected ones.** Conflating them reads as spin.
- **Keep 101 metrics separate from LiftOff/Inc metrics.** 101's north star is AI fluency and a strong
  next step; LiftOff is the direct placement track. Blending them produces a number that is true of
  nothing.
- **Story-led when it earns it.** One real detail beats a paragraph of characterization.
- **Answer the question asked.** A beautiful paragraph that does not answer the prompt scores zero.
  Re-read the question after drafting and check that every part of it is addressed.

**Never name an entity you cannot trace to a confirmed, current source.** Employers, funders, placement
sites, clients, schools, partners, people. Not as a placeholder, not as an example, not in brackets. A
name in an old document is not confirmation that it is current. "Engaged with" — a site visit, a
conversation, a mentor — is not "employer partner," and the weaker relationship is never upgraded in
the writing. Pull real placements from `query_employment`, not from a prior narrative. Where you need a
name and do not have a confirmed one, write `[NEEDS: confirm employer partner names]`.

**Never put a participant's identity in a draft.** Several tools return identifiable people, most of them
minors: `query_employment` listings carry student names with wages and free-text notes,
`get_entity_brief` and `get_student_info` return a whole profile, and `query_outcomes` is per-student.
Those calls are legitimate for verifying a claim. What comes out of them does not reach the funder.

- Aggregate or de-identify. "A 2025 graduate now works as an AI intern at a Philadelphia agency" is
  publishable; the same sentence with a name and an hourly wage is not.
- A named story requires the participant's documented consent, which staff hold and you cannot check. If
  a funder wants one, write `[NEEDS: staff-approved participant story with consent on file]` and move on.
- Never reproduce a free-text `notes` field. It is internal staff commentary about a young person.
- The same rule covers the composite: a school, a cohort, an employer, and an age together identify
  someone in a program this size even with the name removed.
- **Never build an org statistic by looping over per-student calls.** `query_outcomes` and
  `query_competency({scores})` are per-student, and averaging your own sample of them produces a number
  with no defined population, presented with the authority of a measurement. If a funder wants
  competency growth in aggregate, the answer is that the platform does not compute it and staff must
  pull it from Beacon.

## Step 6 — Verify lengths, then self-edit

Counting by eye is unreliable and has repeatedly been off by 10 to 30 words. Verify in whatever
execution environment this account has:

- If code execution is available (bash, an analysis tool, any sandbox), count there. Words:
  `len(text.split())`. Characters including spaces: `len(text)`. Also search the text for `—`, `–`, and
  each banned word.
- If no execution environment is available, count deliberately: paragraph by paragraph, in groups of
  ten words, then sum. Target 90-95% of the limit so a portal's counting rule cannot push you over, and
  tell the user the count is an estimate rather than machine-verified.

Re-run after **every** revision, not just the first draft. Never tell the user an answer is "within
limits" without having counted it in that same response.

Then the self-edit pass. Never hand over a first draft; fix your own weak sentences before presenting.

1. Every answer within its limit, in the funder's unit.
2. No em dash anywhere. No banned word.
3. Each answer answers every part of the question asked.
4. No throat-clearing opener, no setup-and-pivot, no word reaching for emotion.
5. No sentence that could appear in any workforce nonprofit's proposal.
6. Every figure carries its source tool, its `asOf` date, and, for a rate, its denominator.
7. Every named entity traced to a confirmed current source.
8. 101 metrics not blended with LiftOff/Inc metrics.
9. Demonstrated outcomes distinguished from projected ones, and no target quoted as an achievement.
10. No participant identifiable: no names, no wages, no notes, no identifying composite.
11. Any placement or wage figure segmented by `employment_type`, not the blended aggregate.
12. No school count off a raw `by_school` row count, no summed `by_race` rows, no unqualified
    postsecondary graduation rate.
13. The chosen fiscal-sponsorship framing applied consistently throughout.
14. No superseded framing (2021 founding, 2.5-year pipeline, one-year LiftOff, age cap 22).
15. Every remaining gap marked `[NEEDS: ...]` and collected in the handoff list.

## Step 7 — Hand off

Per answer: the verified count against the limit, and the source of every figure with its `asOf` date.

Then one consolidated list:

- Every `[NEEDS: ...]` gap and every `[DATA UNAVAILABLE]`, including which connector domains came back
  empty at preflight and what each blocks.
- Every definitional conflict, with both figures and what each counts, for staff to choose between,
  including any conflict between the platform and a Drive document.
- Every internal status or off-target note found in Drive that staff should see and a funder should not.
- Every name that could not be traced.
- Every dollar amount, which is always a staff decision.
- Any question where the intent was unclear.

Separate answers drawn from live connector data from answers reconstructed from prior material this
session. A reviewer reads those differently, and should.

Then offer the next concrete step: attachments to assemble, a budget to format, a section to develop.

## When to back out

Stop and say you cannot draft, rather than producing something that looks finished:

- The LP Internal AI connector is not attached, errors, or returns zero rows (Step 0a). A Google Drive
  connector does not substitute: hand-maintained documents cannot carry a proposal's figures.
- The user's role is denied the tools the form's questions require, and no fallback covers them.
- The form asks for figures the connector does not hold and staff cannot supply — audited financials,
  board rosters, federal or state registration identifiers, a management plan. Draft everything else
  and name these explicitly as blocked; do not fill them with plausible text.

The one case that is not a back-out: **the user asks for a submission-ready document with no human review
step, or says the deadline is too close for one.** Do the work. Draft everything the data supports, verify
the counts, and hand it over with the gaps marked. What you decline is the certification, not the draft:
say plainly that you cannot mark it submission-ready and that the `[NEEDS: ...]` items are unresolved.
Refusing to draft under deadline pressure is not caution, it is just unhelpful, and it pushes the person
toward writing the numbers from memory instead.

Backing out means naming exactly what is missing and what would unblock it. It does not mean refusing
to help: transcribing the form, mapping which tool would answer each question, and listing what staff
must supply is real work, and it is available even with the connector down.

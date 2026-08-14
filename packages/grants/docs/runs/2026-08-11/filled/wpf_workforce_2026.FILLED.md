# William Penn Foundation, Workforce Training Supports RFP (2026-2028) - filled draft

**Applicant framing (as filed):** Launchpad as fiscally sponsored initiative of Building 21
**Due:** 2026-07-30 · **Questions:** 12 · **Filled:** 8 · **Blocked on staff:** 4
**Figures verified:** 2026-08-11 against LP Internal AI. See `FIGURE-LEDGER.md`.
**Counts:** verified with `count.mjs`, not by eye.

> Draft for staff review. Not submittable as filed.

---

## 1. Will a Fiscal Sponsor be used for this grant?

Yes. Building 21 is the fiscal sponsor.

## 2. Legal Name of Organization

Building 21

<sub>Derived from the identity record. Launchpad is the sponsored initiative and has no registered legal name of its own yet.</sub>

## 3. EIN

47-2514219

## 4. Address

801 Market Street, Philadelphia, PA 19107

## 5. Website

`[STAFF]` `[DATA UNAVAILABLE]` No website is stored in the knowledge base. The pipeline answered this field with the street address, because "Website" is registered as a wording for the mailing address slot.

## 6. Mission Statement (700 characters)

Launchpad builds accelerated pathways that connect Philadelphia young adults to high-paying, future-ready tech careers. Through a paid AI-engineering program grounded in real client work, participants who arrive with a high school diploma and little else gain applied AI skills, industry certifications, a portfolio of deployed work, and the paid experience employers now demand, at no cost to them, on a path toward a $50,000 living wage.

<sub>439 of 700 characters.</sub>

## 7. Proposed Project Title (120 characters)

Launchpad Workforce Training Supports

<sub>37 of 120 characters. `[STAFF: confirm the title WPF should see. The stored value is just "Launchpad".]`</sub>

## 8. Project description (250 characters)

Launchpad pays Philadelphia young adults 18 to 24 to train as AI engineers, then puts them on real client projects. 45 participants have earned $367,662 since 2023. This request funds the supports that let low-income participants finish.

<sub>237 of 250 characters. Written for this field rather than compressed: the stored program description is 1,403 characters, 5.6x over, and the pipeline correctly refused to squeeze it. Facts dropped from the stored version, deliberately: the 30-school recruitment footprint, the competency framework, certifications, Beacon, the Center City hub, and the $20/hour client rate. $367,662 and 45: `query_employment(aggregate)`, asOf 2026-08-11.</sub>

## 9. Anticipated Start Date for Project Funded by WPF

`[STAFF]` Application-specific. No stored answer.

## 10. Duration of Funding (months)

`[STAFF]` Application-specific. No stored answer.

## 11. Request Amount

`[STAFF]` Application-specific. No stored answer, and no budget figure could be verified today: `get_finance_brief(ytd)` returned no income or expense total and `query_finances(phase_budget_dashboard)` returned zero records.

## 12. Describe the proposed project. Include a detailed description of the proposed activities, including location of the work, frequency, and duration of interaction with proposed beneficiaries, the timeline for the entire project, and the number and demographics of beneficiaries/participants expected to be served. If the proposed project involves a partnership with other organizations, describe how the organizations will collaborate and the complementary roles each partner will play.

**Activities and location.** Launchpad trains Philadelphia young adults as AI engineers from its hub at 801 Market Street in Center City. The phase this request supports is LiftOff: six months, full time, for participants 18 to 24. The first half is classroom-intensive, five days a week, stipend-supported. The second half moves participants onto paid client projects through Launchpad Inc., a nonprofit social enterprise that builds automations, dashboards, integrations, and agents for Philadelphia nonprofits and small businesses. Participants are in the building daily for the full six months, and Career Success Coaching continues through their first year of employment after graduation.

**What participants are trained against.** Six competencies and 24 skills in the AI Engineer framework: prompting and context engineering, building automations and agents, connecting systems, structuring data, evaluating AI output, and managing cost and risk. Each skill is evidenced by a shipped artifact tracked in Beacon, Building 21's competency platform, rather than by seat time. Participants also sit for Certiport Generative AI Foundations and PCEP.

**Why the supports are the request.** The reason a low-income 20-year-old leaves a training program is rarely the curriculum. It is a missed bus fare, a shift they had to pick up, or a laptop they do not have. Paying participants from day one, at a guaranteed $6,000 floor over six months, removes the choice between finishing the program and earning this month. The paid client work in the second half then does two things at once: it pays better than the stipend and it produces the deployed work and client references that early-career technical hiring screens on.

**Beneficiaries and demographics.** 301 young people have enrolled since 2023. 18 are in LiftOff now, and 12 have completed it. Of the 301, 289 identify as a race or ethnicity other than white alone. `[STAFF: that is 96.0%; counting Black or Latino only it is 80.4%. Confirm which population WPF means.]` Participants are recruited from non-selective Philadelphia high schools across more than 30 ZIP codes, with no prior experience required.

**Evidence to date.** Launchpad has paid $367,662 directly to 45 participants across 86 jobs since 2023, averaging $15.52 an hour across all jobs and $19.28 an hour across currently active ones. Participants have held paid technical roles at Accenture, Seer Interactive, CreateAccess, Bentley Systems, HiTouch Enterprise, Hack Club, AECOM, and Nerd Street. `[STAFF VERIFY: prior filings claim 11 of 12 Cohort 1 graduates in paid work or training at six months. No connector call returns a cohort placement rate, so that claim is unconfirmed and is not asserted here.]`

**Partners.** Building 21 is the fiscal sponsor and provides the competency model, the Beacon platform, finance, and compliance. `[STAFF: the employer partner roster is not filable from platform data. The employment table holds 38 external employer names, but most are retail, food service, or community roles rather than partnerships, and the two counts the knowledge base carries, 17 and 20, reconcile with neither. A person owns this list.]`

<sub>Enrollment and phase counts: `query_enrollment(total)`, `query_enrollment(by_phase)`. Demographics: `query_enrollment(by_race)`. Earnings, wages, employers: `query_employment(aggregate)`, `query_employment(by_employer)`. All asOf 2026-08-11.</sub>

/**
 * slots.ts — the language-only storage rule, made mechanical.
 *
 * ## The rule
 *
 * **Committed artifacts store language. A figure with a live source is a named slot, filled by the
 * `query_*` call that owns it, or the answer is rejected.**
 *
 * `figures.ts` already stated the policy — "do not publish any figure until the paired `query_*` call
 * confirms it" — and that was advisory in the one way that matters: the frozen number stayed inside the
 * stored sentence. A draft that skipped verification shipped it looking finished, because a sentence
 * with a number in it reads like an answer. The measured cost is in `figures.ts`' own header: the wage
 * aggregate drifted ~$1,500 every four days, and the filed $350,268 was $362,030.26 live within a week.
 *
 * A slot cannot be published by accident. `{{wages_total}}` in a funder's portal is a visible defect,
 * not a plausible number, and `pipeline.ts` refuses to return slotted text as an `answer` at all.
 * That is the whole point: the failure mode moves from *confidently wrong* to *obviously incomplete*.
 *
 * ## Why a figure is not simply banned
 *
 * Measured against the real corpus on 2026-08-17, a blanket "no digits in stored prose" rule deletes
 * the organisation's own name. `21` appears in 15 of the 29 slots as **Building 21**, the fiscal
 * sponsor; `101` is **Launchpad 101**, a programme. `501(c)(3)`, the EIN, Form `990`, the street
 * address and the ZIP are legal identifiers. `ages 16–24` is an eligibility gate written into the
 * programme design, not a measurement of anyone.
 *
 * So the rule needs a third bucket, and {@link IMMUTABLE_FIGURES} is it — an allowlist of *phrases*,
 * each with the reason it is exempt. Phrases rather than bare tokens on purpose: `21` is exempt in
 * `Building 21` and is a staff count in `kb.staff_bios`, and an allowlist keyed on the token would
 * exempt both. {@link literalFigures} masks each allowed phrase out of the text and then scans what
 * is left, so an exemption is as narrow as the phrase that earned it.
 *
 * **This is an allowlist, not a debt register.** An entry here is a permanent claim that the figure has
 * no live source and does not drift. Adding one to silence a warning about a figure that *does* drift
 * re-opens the exact hole this module closes, and does it invisibly. The same discipline
 * `data.ts::ACKNOWLEDGED_TIES` asks for: write the reason, and make it a reason about the figure rather
 * than about the inconvenience.
 *
 * ## Two kinds of slot, because two different parties fill them
 *
 * `live` is the common case: a `query_*` call owns the number and the calling model runs it.
 *
 * `per_application` covers values belonging to *one submission* rather than to the organisation — the
 * project period, the budget for this proposal. Those cannot be fetched, because no connector holds
 * "what this funder was asked for". They route to `staff` rather than to the model, because a model
 * handed an empty budget slot and told to fill it will fill it.
 *
 * The corpus already marked these, as bracketed prose: "[Supply the per-project budget for each specific
 * ask.]" A bracket enforces nothing — it renders as text, and the draft reports the answer finished with
 * the bracket still in it. Converting them to slots is what turns the instruction into a gate.
 */

import { FIGURE_CHECKS, type FigureCheck } from './figures.js';

// --------------------------------------------------------------------------- slot syntax

/**
 * A slot token in stored text: `{{slot_id}}`.
 *
 * `{{` appears nowhere in the corpus — asserted by `slots.test.ts` against the real seed, so the
 * syntax cannot start colliding with prose without a test failing. Ids are `[a-z0-9_]` only, which
 * keeps a malformed token (`{{ wages total }}`) from silently reading as a valid one; it falls through
 * to {@link malformedSlotTokens} instead of being ignored.
 */
const SLOT_TOKEN = /\{\{([a-z0-9_]+)\}\}/g;

/** Anything brace-delimited that is NOT a well-formed slot token. */
const MALFORMED_TOKEN = /\{\{(?![a-z0-9_]+\}\})[^}]*\}?\}?/g;

export type SlotKind = 'live' | 'per_application';

export interface FigureSlot {
  readonly kind: SlotKind;
  /** What the number means, in the caller's words. Rendered into the fill instruction. */
  readonly describes: string;
  /**
   * The {@link FIGURE_CHECKS} key that owns this figure, on a `live` slot. The check carries the tool,
   * the args, and whether the conflict is definitional — so the slot never restates any of that and
   * the two cannot drift apart.
   */
  readonly check?: string;
  /** On a `per_application` slot: what a person has to decide or look up. */
  readonly staff_note?: string;
}

/**
 * Every slot the corpus uses, and what fills it.
 *
 * Grouped by the {@link FIGURE_CHECKS} entry that owns them, because that is the unit a caller runs:
 * one `query_*` call fills every slot pointing at it. `kb.metrics` alone needs eleven slots from five
 * calls, and a caller that ran one call per slot would make eleven where five do.
 *
 * A slot with `check: undefined` on `kind: 'live'` is a defect, caught by
 * `data.ts::figure_slot_unresolved` — it means a number was slotted with no way to fill it, which is
 * strictly worse than leaving it literal: the draft is now blocked *and* nobody knows what to run.
 */
export const FIGURE_SLOTS: Readonly<Record<string, FigureSlot>> = {
  // -- employment aggregate: query_employment(aggregate) ------------------------------------
  wages_total: {
    kind: 'live',
    check: 'employment_earnings_total',
    describes: 'total wages paid to participants, all time',
  },
  wage_participants: {
    kind: 'live',
    check: 'employment_earnings_total',
    describes: 'number of participants those wages were paid to',
  },
  wage_jobs: {
    kind: 'live',
    check: 'employment_earnings_total',
    describes: 'number of jobs those wages span',
  },
  alumni_wages: {
    kind: 'live',
    check: 'employment_earnings_total',
    describes: 'documented alumni wages — a restatement of the same aggregate',
  },
  avg_hourly_wage: {
    kind: 'live',
    check: 'employment_wage_range',
    describes: 'average hourly wage on client work',
  },
  earnings_6mo: {
    kind: 'live',
    check: 'employment_wage_range',
    describes: 'average annualized earnings at six months',
  },
  earnings_9mo: {
    kind: 'live',
    check: 'employment_wage_range',
    describes: 'projected average annualized earnings at nine months',
  },
  employer_partners: {
    kind: 'live',
    check: 'top_employers',
    describes: 'count of employer partners',
  },

  // -- placement: query_employment + query_enrollment for the denominator -------------------
  // Every one of these carries the `unknown` conflict kind from `placement_rate`: no tool returns a
  // cohort placement rate, so the caller assembles it and the as-of date is part of the answer.
  placement_numerator: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'cohort members in paid work or training at six months',
  },
  placement_denominator: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'cohort size — the denominator for the placement rate',
  },
  placement_rate_6mo: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'share of the cohort in paid work or training at six months',
  },
  placement_rate_now: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'share in paid work as of the date you run the call — state that date',
  },
  lp101_completion_rate: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'Launchpad 101 completion rate, most recent year',
  },
  lp101_transition_rate: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'share of Launchpad 101 graduates going to college, training or work',
  },
  lp101_internships: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'paid internships in a recent Launchpad 101 cohort',
  },
  placement_via_inc: {
    kind: 'live',
    check: 'placement_rate',
    describes: 'share of those placements that are Launchpad Inc. contract work',
  },

  // -- enrollment counts: query_enrollment(total) — DEFINITIONAL ----------------------------
  // Both of these resolve to a check whose `conflict_kind` is `definitional`, so filling them is not
  // a lookup: "145 served", "200+ came through programming" and "301 records" are three populations.
  // The check's note carries the reasoning; the slot does not restate it.
  students_served: {
    kind: 'live',
    check: 'students_served_total',
    describes: 'young people served — CONFIRM WHICH POPULATION with staff before writing it',
  },

  // -- certifications: query_certifications(summary) — DEFINITIONAL -------------------------
  cert_pass_rate_range: {
    kind: 'live',
    check: 'cert_pass_rate',
    describes: 'PCEP pass rate range across cohorts — say per-cohort or all-time in the sentence',
  },
  cert_pass_rate_recent: {
    kind: 'live',
    check: 'cert_pass_rate',
    describes: 'PCEP pass rate for the most recent cohort',
  },

  // -- demographics: query_enrollment(by_race) ----------------------------------------------
  demographics_black_brown: {
    kind: 'live',
    check: 'demographics_race',
    describes: 'share of participants who are Black or Brown',
  },
  demographics_low_income: {
    kind: 'live',
    check: 'demographics_race',
    describes: 'share of participants who are low-income',
  },
  demographics_frl: {
    kind: 'live',
    check: 'demographics_race',
    describes: 'share qualifying for free or reduced-price lunch',
  },

  // -- organisational finance: get_finance_brief(ytd) ---------------------------------------
  fy_expenses: {
    kind: 'live',
    check: 'annual_budget',
    describes: 'total expenses for the most recent closed fiscal year',
  },
  fy_projected_revenue: {
    kind: 'live',
    check: 'annual_budget',
    describes: 'projected revenue for the current fiscal year',
  },
  revenue_share_grants: {
    kind: 'live',
    check: 'revenue_mix',
    describes: 'share of revenue from grants',
  },
  // The four the corpus actually states, in kb.sustainability: foundation grants, individual donors,
  // government workforce funding, corporate. An earlier draft of this registry guessed "earned" and
  // "other" — Launchpad Inc. earned revenue is described there as a *growing* stream rather than a
  // numbered share, so a slot for it would have been a hole nothing fills.
  revenue_share_individual: {
    kind: 'live',
    check: 'revenue_mix',
    describes: 'share of revenue from individual donors',
  },
  revenue_share_government: {
    kind: 'live',
    check: 'revenue_mix',
    describes: 'share of revenue from government workforce funding',
  },
  revenue_share_corporate: {
    kind: 'live',
    check: 'revenue_mix',
    describes: 'share of revenue from corporate giving',
  },

  // -- Launchpad Inc.: get_finance_brief, with the gap the check records --------------------
  // `inc_client_work_booked` states plainly that no `query_*` returns Inc. bookings directly. These
  // slots therefore fail to fill more often than the others, and that is the correct outcome: an
  // unfillable slot rejects the answer instead of publishing a July figure in December.
  // Two slots, not one. The corpus states the ramp as two readings — first two months, then about
  // 3.5 months — and the ramp IS the claim: a single figure with the second dropped turns evidence of
  // growth into a static number. Collapsing them was a real content loss caught on review.
  inc_receivables_2mo: {
    kind: 'live',
    check: 'inc_client_work_booked',
    describes: 'Launchpad Inc. receivables in its first two months of booking',
  },
  inc_receivables_3_5mo: {
    kind: 'live',
    check: 'inc_client_work_booked',
    describes: 'Launchpad Inc. receivables at about 3.5 months — the second point on the ramp',
  },
  inc_pipeline: {
    kind: 'live',
    check: 'inc_client_work_booked',
    describes: 'Launchpad Inc. contracted pipeline',
  },

  client_work_hours: {
    kind: 'live',
    check: 'employment_wage_range',
    describes: 'hours of paid client work a participant completes — the aggregate returns weekly hours',
  },
  inc_participant_wages: {
    kind: 'live',
    check: 'inc_client_work_booked',
    describes: 'annual participant wages for Launchpad Inc. client work, covered by client revenue',
  },

  // -- programme budget: query_finances(phase_budget_dashboard) -----------------------------
  // Named for what kb.financials actually breaks out, which is not what the check's claim string says.
  // The claim reads "$519K / $455K / $362K per phase"; the prose reads $519,000 for Launchpad 101,
  // $455,000 for LiftOff, and $362,000 in *shared administrative cost* — not a phase at all. A slot
  // called `phase_cost_foundations` would have quietly relabelled overhead as programme delivery.
  phase_cost_101: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'annual cost of the Launchpad 101 phase',
  },
  phase_cost_liftoff: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'annual cost of the LiftOff phase',
  },
  cost_shared_admin: {
    kind: 'live',
    check: 'phase_costs',
    describes:
      'shared administrative cost — overhead, NOT a programme phase, and NOT a column: derive it as ' +
      'total_launchpad minus hs minus liftoff, and say that you derived it',
  },
  stipend_floor: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'guaranteed minimum stipend a LiftOff participant earns over the phase',
  },
  spend_stipends: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'direct participant stipends and wages',
  },
  spend_stipends_share: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'stipends and wages as a share of programme spending',
  },
  spend_personnel: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'personnel cost — coaches, instructors, placement staff, Inc. delivery leads',
  },
  spend_personnel_share: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'personnel as a share of programme spending',
  },
  spend_facilities: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'Center City facilities cost',
  },
  spend_facilities_share: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'facilities as a share of programme spending',
  },
  spend_other_share: {
    kind: 'live',
    check: 'phase_costs',
    describes: 'the remaining share across technology, hardware, food, transport, certifications',
  },

  // -- staff -------------------------------------------------------------------------------
  // `staff_count` is the check whose note says the KB states two different numbers and no `query_*`
  // covers headcount. The slot inherits that: it routes to `search_documents` and often will not fill.
  // Two slots, because the corpus states two numbers: "9 full-time and 1 part-time staff (all W-2)".
  // Both are single digits, which the literal-figure detector deliberately ignores — so these are
  // slotted on the strength of reading the prose, not because the checker flagged them. Worth knowing:
  // the detector's blind spot for single digits means a small count can only be caught by eye.
  staff_count_ft: {
    kind: 'live',
    check: 'staff_count',
    describes: 'full-time staff headcount',
  },
  staff_count_pt: {
    kind: 'live',
    check: 'staff_count',
    describes: 'part-time staff headcount',
  },

  // -- prior funding -----------------------------------------------------------------------
  wpf_grant_total: {
    kind: 'live',
    check: 'prior_funding_wpf',
    describes: 'total of the multi-year William Penn Foundation grant',
  },
  wpf_initial_grant: {
    kind: 'live',
    check: 'prior_funding_wpf',
    describes: 'the initial William Penn Foundation grant that preceded it',
  },

  // -- per-application: no connector holds these -------------------------------------------
  // Values belonging to one submission rather than to the organisation. No connector holds "what this
  // funder was asked for", so a model must not fill them and they route to staff.
  //
  // **These replace bracketed instructions, which is the point.** The corpus marked per-application
  // values as prose — "[Supply the per-project budget for each specific ask.]" — and a bracket enforces
  // nothing: it renders as text, a model can read past it, and the draft reports the answer as finished.
  // As slots they are machine-visible and the gate refuses to return the answer without them.
  //
  // An earlier draft of this registry also carried `request_amount`, on the reading that the `$50,000`
  // repeated across nine slots was a funder ask inherited from a filed application. It is not — it is
  // Launchpad's living-wage target, and it is in IMMUTABLE_FIGURES. The slot was removed rather than
  // left unused; `slots.test.ts` fails on an unused slot, which is what caught it.
  project_budget_total: {
    kind: 'per_application',
    describes: 'total project budget for THIS proposal',
    staff_note: 'Comes from the budget built for this submission, not from a filed one.',
  },
  project_period: {
    kind: 'per_application',
    describes: 'the grant period THIS proposal covers',
    staff_note: 'Confirm against the funder’s stated term before writing it.',
  },
};

/**
 * Phrases whose digits are exempt from the language-only rule, each with the reason.
 *
 * Read the module header before adding to this. Every entry is a claim that the figure has no live
 * source **and** does not drift; an entry added to silence a warning about a drifting figure defeats
 * the whole module and leaves no trace that it did.
 *
 * Ordering matters only in that longer, more specific patterns should precede shorter ones that would
 * also match — {@link literalFigures} masks in array order.
 */
export const IMMUTABLE_FIGURES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  // -- names that contain digits ----------------------------------------------------------
  {
    pattern: /\bBuilding 21\b/g,
    reason: 'The fiscal sponsor’s name. Appears in 15 of 29 slots; not a measurement of anything.',
  },
  {
    // Bare `101` as well as the full name. Measured against the whole corpus on 2026-08-17, every
    // occurrence of `101` is this programme — including the abbreviated `101:` form the structured
    // values use ("101: 16–18; LiftOff/Inc: 18–24"), which the full-name pattern alone missed. Exempting
    // a bare three-digit token is a real widening, and it is recorded here rather than assumed: if a
    // figure that happens to equal 101 ever enters the corpus, this hides it.
    pattern: /\bLaunchpad 101\b|\b101\b/g,
    reason: 'A programme name. Every `101` in this corpus is Launchpad 101, abbreviated form included.',
  },
  {
    pattern: /\bLaunchpad Inc\.?/g,
    reason: 'The subsidiary’s name. Listed here so the trailing period cannot start a false decimal.',
  },
  {
    pattern: /\bCohort 1\b/g,
    reason: 'An ordinal naming a specific cohort, not a count of cohorts.',
  },

  // -- legal and postal identifiers -------------------------------------------------------
  {
    pattern: /\b501\(c\)\(3\)/g,
    reason: 'A section of the tax code.',
  },
  {
    pattern: /\b47-?2514219\b/g,
    reason: 'The EIN. A permanent identifier.',
  },
  {
    pattern: /\bForm 990\b|\b990\b/g,
    reason:
      'An IRS form number. Bare `990` is exempted too, since kb.docs and kb.financials both refer to ' +
      '"Form 990" and to "the 990" — and no figure in this corpus is the number 990.',
  },
  {
    pattern: /\b801 Market Street\b/g,
    reason:
      'The street address of the Center City hub. A location, not a quantity — nothing a connector ' +
      'returns is shaped like a house number.',
  },
  {
    pattern: /\bPhiladelphia,? PA 19107\b|\b19107\b/g,
    reason:
      'The hub’s ZIP code. Note the separate `30+ ZIP codes` recruitment-footprint figure is NOT this ' +
      'and is not exempt — it drifts, and it is in FIGURE_DEBT.',
  },

  // -- programme design constants ---------------------------------------------------------
  // Not measurements: these are decisions about how the programme is built. They change by a staff
  // decision that rewrites the sentence, never by a sync.
  {
    // All three bands, not just the outer one: the corpus states `ages 16–24` overall, `16–18` for
    // Launchpad 101 and `18–24` for LiftOff/Inc, and a pattern covering only `16–24` left the other two
    // reported. En dash and hyphen both, because the corpus uses the en dash and a funder form will
    // not.
    pattern: /\bages? (?:16|18)[–-](?:18|24)\b|\b(?:16|18)[–-](?:18|24)\b/g,
    reason:
      'The eligibility age bands — a programme design gate, not a measured population. No query_* ' +
      'returns "who we are allowed to enroll".',
  },
  // Two exemptions for programme durations were here — `7-week` (Lightspeed) and a `12|18|24-month`
  // alternation — and both were removed on 2026-08-17 for matching nothing. They were written from the
  // `enrollment_by_phase` NOTE in figures.ts rather than from the corpus, which spells these out
  // ("a six-month, full-time track", "twelve-month retention"). Spelled-out numbers are not figures to
  // this detector, so the durations needed no exemption at all. `slots.test.ts` fails on a dead pattern
  // now, which is how these were found.
  {
    pattern: /\bsix competencies\b|\b24 skills\b/g,
    reason:
      'The AI Engineer competency framework’s structure — a design decision, not a count of anything ' +
      'measured. Changing it means rewriting the framework, which rewrites the sentence.',
  },
  // No leading `\b` before `\$`. A word boundary requires a word character on one side, and `$` is not
  // one — `/\b\$50,000/` therefore never matches "a $50,000 living wage", which is how every currency
  // exemption in this list silently failed until 2026-08-17. Caught because `$50,000` was still being
  // reported in all nine slots that state it. `slots.test.ts` now asserts each pattern matches the
  // phrase it was written for, so a dead exemption fails a test instead of quietly widening the check.
  {
    pattern: /\$50,000 living[- ]wage|living[- ]wage[^.]{0,20}\$50,000|target \$50,000/g,
    reason:
      'The living-wage target Launchpad sets for itself. An organisational goal, not an outcome ' +
      'measurement — no query_* returns it, and it moves only when leadership moves it.',
  },

  // -- externally sourced benchmarks ------------------------------------------------------
  // Cited from outside Launchpad. A live connector cannot confirm them and must not be asked to; the
  // verification path for these is the citation, which is a documentation question rather than a
  // figure question.
  {
    pattern: /\$12,500\b/g,
    reason:
      'Median earnings for a Philadelphia high-school graduate without college — an external ' +
      'benchmark. Not ours to measure. Needs a citation, not a query_* call.',
  },
  {
    pattern: /\b40[–-]60% administrative time savings\b/g,
    reason: 'Reported by Launchpad Inc. clients, not measured by any connector.',
  },
  {
    pattern: /\b8,000 students a year\b/g,
    reason:
      'Annual graduates of Philadelphia’s non-selective high schools — School District figure, ' +
      'describing the need rather than Launchpad. External; needs a citation, not a call.',
  },
  {
    pattern: /\bacross 20 states\b|\b10,000\+? students\b/g,
    reason:
      'Building 21’s national history as a school-design organisation, quoted in kb.history and ' +
      'kb.capacity to establish the sponsor’s track record. No Launchpad connector holds Building 21’s ' +
      'own reach, and it is not a Launchpad outcome.',
  },
  {
    pattern: /\bup to a 90% state tax credit\b/g,
    reason:
      'The Pennsylvania EITC credit rate — set by statute, not by Launchpad. The 90% here is a tax ' +
      'credit and has nothing to do with the ~90% low-income share two sentences earlier, which is a ' +
      'live demographic. Three different 90%s appear in this corpus and this is why exemptions are ' +
      'keyed on phrases.',
  },
  {
    pattern: /\b15\+ years in education and workforce development\b|\b15\+ years\b/g,
    reason:
      'The Executive Director’s years of experience — biographical. **This is also the source of a ' +
      'wrong claim now corrected:** the `staff_count` check said the KB states "15 staff / 9 staff" and ' +
      'sent a reviewer to reconcile two headcounts. There is only one headcount (9 full-time, 1 ' +
      'part-time); the 15 was always years of experience.',
  },
  {
    pattern: /\bweeks 1[–-]~?12\b/g,
    reason: 'The designed length of the classroom-intensive phase. A schedule, not a measurement.',
  },
  {
    pattern: /\bwithin about 3\.5 months\b|\bfirst two months of booking\b/g,
    reason:
      'Elapsed time on the Launchpad Inc. revenue ramp — the *when* of a reading, not the reading. The ' +
      'figures themselves are slots (inc_receivables_2mo, inc_receivables_3_5mo); this is the label on ' +
      'the x-axis.',
  },
  {
    // The line items of one submitted proposal, quoted in kb.budget_narrative as an example of how
    // Launchpad's budgets are shaped. A filed budget is a closed historical fact — the request was made
    // for those amounts and always will have been — so these do not drift the way an actual does.
    pattern:
      /\$568,498|\$122,729|\$385,681|\$40,500|\$2,700|\$11,262|\$5,625/g,
    reason:
      'Line items of one filed request (William Penn, supportive services), quoted as an illustration ' +
      'of budget shape. A submitted budget does not change after submission. Note these are the ASK, ' +
      'not spending — do not read them as actuals, and do not reuse them as this application’s budget: ' +
      'the sentence itself ends by telling staff to supply the per-project budget for each specific ask.',
  },
  {
    pattern: /\b200\+? applicants\b/g,
    reason:
      'The applicant pool one employer screened for one hiring round in 2025. A closed historical ' +
      'fact about a specific placement, not a recurring measurement.',
  },

  // -- calendar years ---------------------------------------------------------------------
  // A year is a date, and a date is language. Kept last and deliberately broad: masking `2013` in
  // "founded in 2013" is right, and there is no figure shaped like a bare year that a connector owns.
  {
    pattern: /\b(?:19|20)\d{2}\b/g,
    reason: 'A calendar year is a date, not a quantity.',
  },
];

/**
 * Figures that drift and have no live source — the case neither {@link FIGURE_SLOTS} nor
 * {@link IMMUTABLE_FIGURES} can honestly hold.
 *
 * The clean story is that every figure is either fetchable or fixed. The corpus does not cooperate.
 * `1,000+ young people reached through info sessions and outreach` moves with every recruitment season,
 * and no connector holds outreach contacts. `30+ ZIP codes` and `more than 30 non-selective high
 * schools` are the same shape. Each of these *should* be a slot and cannot be one yet, because the
 * number it would be filled from does not exist anywhere the platform can reach.
 *
 * **Both alternatives to this register are worse.** Slotting them makes every draft that touches
 * kb.history or kb.program_desc permanently unfillable, which trains a reader to ignore unfilled slots —
 * and once slots are ignorable the mechanism is gone. Putting them in {@link IMMUTABLE_FIGURES} asserts
 * they do not drift, which is false, and buries that falsehood in an allowlist nobody re-reads.
 *
 * So they stay literal and stay **reported**: `data.ts::stored_figure_unsourced` raises them at
 * `medium`, separately from the `high` violation, with what would settle each one. A figure here is a
 * known hole with a named fix, which is the most this layer can honestly say about it.
 *
 * Retiring an entry means one of two things happened: a connector started holding the figure (make it a
 * slot), or someone established that it is fixed (move it to {@link IMMUTABLE_FIGURES} with the
 * evidence). Deleting an entry to quiet the warning is the one move that is not allowed.
 */
export const FIGURE_DEBT: readonly {
  readonly pattern: RegExp;
  readonly why_not_a_slot: string;
  readonly would_settle_it: string;
}[] = [
  {
    pattern:
      /\breached more than 1,000 young people\b|\b1,000\+ reached through outreach\b|\breached 1,000\+/g,
    why_not_a_slot:
      'Outreach and info-session contacts. No connector holds them — enrollment records start at ' +
      'enrollment, and this population never enrolled.',
    would_settle_it:
      'Either a connector over whatever tracks outreach (a sheet, a CRM), or a staff decision to stop ' +
      'making the claim.',
  },
  {
    pattern:
      /\bmore than 30 (?:non-selective )?(?:Philadelphia )?high schools\b|\bmore than 30 non-selective Philadelphia high schools\b|\b30\+ ZIP codes\b/g,
    why_not_a_slot:
      'Recruitment footprint. `students` holds no school or ZIP column, so the count cannot be derived ' +
      'from what is stored. Note `query_enrollment {query_type:"by_school"}` exists — it breaks down ' +
      'enrolled participants by school, which is a different population from the schools recruited FROM.',
    would_settle_it:
      'A school/ZIP field on the student record, which would make both a query_students breakdown. ' +
      'Or a decision that the by_school breakdown is close enough, which is a staff call, not a ' +
      'mechanical one.',
  },
  {
    pattern: /\broughly 30 volunteers\b/g,
    why_not_a_slot:
      'Volunteers are not in any connector. `staff` covers paid staff; there is no volunteer record ' +
      'anywhere in the schema.',
    would_settle_it: 'A volunteer roster the platform can read, or dropping the count from the prose.',
  },
  {
    // No trailing `\b` after `%`: a word boundary needs a word character on one side, and `%` followed
    // by a space is not one. The same class of bug that made every `\b\$` currency exemption dead.
    pattern: /\bfewer than 10% of recruited students|\bthe other ~90%/g,
    why_not_a_slot:
      'The split between students initially drawn to software engineering and those who are not — ' +
      'recruitment interest, captured in no connector. It is load-bearing for the argument (it is the ' +
      'stated reason the Entrepreneurial Leadership pathway exists), which makes leaving it unverified ' +
      'worse than for a decorative figure, not better.',
    would_settle_it:
      'Whatever instrument produces it at recruitment — an intake survey — being read by a connector.',
  },
  {
    // Not a Launchpad figure at all: this is commentary about two *drafts* that rounded the wage total
    // differently, sitting inside answer prose. It is here rather than in IMMUTABLE_FIGURES because it
    // is not exempt — it should not be in a stored answer in the first place.
    pattern: /'\$5[05]0,000\+'/g,
    why_not_a_slot:
      'Draft-reconciliation commentary that leaked into answer text — "the GSK Aug-7 draft rounds this ' +
      'to \'$500,000+\'". It is a note about which filing said what, not a claim about Launchpad, and a ' +
      'funder reading the answer should never see it.',
    would_settle_it:
      'Moving the reconciliation note out of `answers[].text` and into `meta`, where the rest of the ' +
      'source-precedence record already lives. That is a content edit needing staff sign-off on the ' +
      'resulting prose, not a mechanical one.',
  },
];

/**
 * Whether `text` states a {@link FIGURE_DEBT} figure, and which.
 *
 * `.match()` rather than `.test()`, and that is not a style choice. Every pattern in these registers is
 * a module-level `/g` regex, and `RegExp.test` on a global regex advances `lastIndex` — so a second call
 * with the same text resumes past the match and returns `false`. Two identical calls giving different
 * answers, in a checker whose entire job is to be trustworthy about what the corpus contains.
 * `String.match` with `/g` resets, so it is the only safe form here.
 */
export function unsourcedFigures(text: string): readonly (typeof FIGURE_DEBT)[number][] {
  return FIGURE_DEBT.filter((d) => text.match(d.pattern) !== null);
}

// --------------------------------------------------------------------------- extraction

/** Slot ids referenced in `text`, in order of first appearance, deduplicated. */
export function slotsIn(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT_TOKEN)].map((m) => m[1] ?? ''))].filter((s) => s !== '');
}

/** Brace-delimited tokens that do not parse as a slot id — a typo, not a slot. */
export function malformedSlotTokens(text: string): string[] {
  return [...new Set(text.match(MALFORMED_TOKEN) ?? [])];
}

/** Slot ids referenced in `text` with no {@link FIGURE_SLOTS} entry. */
export function unknownSlots(text: string): string[] {
  return slotsIn(text).filter((id) => !(id in FIGURE_SLOTS));
}

/**
 * A literal figure in stored text: currency, a percentage, a comma-grouped number, a decimal, or a
 * bare run of two or more digits.
 *
 * Bare single digits are out, and spelled-out numbers ("six months", "twelve-month") are out. Both
 * are language rather than figures in the sense that matters here — nothing a connector returns is
 * shaped like the word "six", and a rule that flagged it would fire on most of the corpus while
 * catching nothing that drifts. Recorded so the gap is known rather than assumed away: a single-digit
 * count that *does* drift (`3 campuses`) escapes this check, and the `figure_claim_uncovered` check in
 * `data.ts` is what covers a figure restated somewhere unexpected.
 */
const LITERAL_FIGURE =
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[MKB](?![A-Za-z]))?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\d+\.\d+|\b\d{2,}\b/g;

/** A slot token, so masking it cannot leave digits behind for {@link LITERAL_FIGURE} to find. */
const MASK = ' ';

/**
 * Literal figures in `text` that are neither inside a slot token nor covered by
 * {@link IMMUTABLE_FIGURES}.
 *
 * Anything this returns is a violation of the language-only rule: a number stored as text, with no
 * live source declared and no recorded reason for being exempt.
 */
export function literalFigures(text: string): string[] {
  let masked = text.replace(SLOT_TOKEN, MASK).replace(MALFORMED_TOKEN, MASK);
  for (const { pattern } of IMMUTABLE_FIGURES) {
    masked = masked.replace(pattern, MASK);
  }
  // FIGURE_DEBT is masked here too, so its figures are reported once — as `medium` debt by
  // `stored_figure_unsourced` — rather than twice, as a `high` violation as well. Reporting them as
  // violations would be wrong in substance, not just noisy: the register's whole claim is that there is
  // no slot to move them to, and a `high` warning says "fix this now" about something nobody can fix.
  for (const { pattern } of FIGURE_DEBT) {
    masked = masked.replace(pattern, MASK);
  }
  return [...new Set(masked.match(LITERAL_FIGURE) ?? [])];
}

/**
 * Does `text` state a figure that no live call will confirm, so a person has to check it by hand?
 *
 * The replacement for `containsNumericClaim` as the trigger for the "⚠ carries figures — verify live"
 * warning, and the change is from a coarse trigger to a meaningful one. `containsNumericClaim` matches
 * any run of two or more digits, which after the scrub means it fires on **`Yes — Building 21 is the
 * fiscal sponsor`**: a five-word structured value with no figure in it at all, flagged for live
 * verification. A warning that fires on almost everything is a warning nobody reads, which is worse than
 * not having it — the same argument `extractCurrencyClaims` makes for excluding percentages.
 *
 * What this returns instead is the set of figures the mechanism genuinely cannot help with:
 *
 * - a **literal** figure with no slot and no exemption — a rule violation, and `data.ts` raises it as
 *   one; if it reaches here the corpus is already known-broken;
 * - a **{@link FIGURE_DEBT}** figure — drifting, with nothing to fill it from. This is the real
 *   population, and it is exactly what "verify this by hand" should point at.
 *
 * A slot is deliberately NOT a trigger. An unfilled slot is not a figure needing verification; it is a
 * hole, and the gate in `pipeline.ts` already refuses to return the text as an answer. Warning about it
 * as well would attach a soft caution to something already hard-blocked.
 */
export function needsManualFigureCheck(text: string): boolean {
  return literalFigures(text).length > 0 || unsourcedFigures(text).length > 0;
}

// --------------------------------------------------------------------------- resolution

/** One slot resolved to the work of filling it. */
export interface SlotRequirement {
  readonly slot: string;
  readonly kind: SlotKind;
  readonly describes: string;
  /** The call to run, on a `live` slot whose check resolves. */
  readonly tool?: string;
  readonly args?: Readonly<Record<string, string | number | boolean>>;
  /**
   * What {@link SlotRequirement.args} actually returns, from the check's `population`.
   *
   * The field that makes a wrong cut visible. Filling `{{students_served}}` from
   * `query_enrollment(total)` yields a live, correctly-dated, all-time count — and if the funder asked
   * about the past twelve months it is wrong, with nothing else in the result saying so. See
   * `FigureCheck.population` for the reasoning and `FILL_FIGURE_RULES` for the rule it carries.
   */
  readonly population?: string;
  /**
   * True when the underlying check's conflict is `definitional` — the number depends on which
   * population the funder means, so running the call is necessary and not sufficient.
   */
  readonly needs_staff_decision: boolean;
  /** The check's note, or the slot's `staff_note`. What the filler needs to know before writing it. */
  readonly note: string;
}

function checkFor(key: string | undefined): FigureCheck | undefined {
  if (key === undefined) return undefined;
  return FIGURE_CHECKS.find((c) => c.key === key);
}

/**
 * Resolve the slots in `text` to what it takes to fill them.
 *
 * Unknown slot ids are dropped rather than guessed at — `data.ts::figure_slot_unknown` is what reports
 * them, at load time, where the corpus can be fixed. Silently inventing a requirement for one here
 * would tell a caller to run a call that does not exist.
 */
export function resolveSlots(text: string): SlotRequirement[] {
  return slotsIn(text)
    .map((id) => ({ id, slot: FIGURE_SLOTS[id] }))
    .filter((e): e is { id: string; slot: FigureSlot } => e.slot !== undefined)
    .map(({ id, slot }) => {
      const check = checkFor(slot.check);
      const definitional = check?.conflict_kind === 'definitional';
      return {
        slot: id,
        kind: slot.kind,
        describes: slot.describes,
        ...(check === undefined
          ? {}
          : { tool: check.tool, args: check.args, population: check.population }),
        needs_staff_decision: slot.kind === 'per_application' || definitional,
        note: slot.staff_note ?? check?.note ?? 'No verification note recorded for this slot.',
      };
    });
}

/**
 * The distinct `query_*` calls that fill every `live` slot in `text`.
 *
 * Deduplicated by tool and args, because one call fills many slots: `kb.metrics` needs eleven slots
 * from five calls, and a caller driving off the slot list rather than this would make eleven.
 */
export function figureCallsFor(text: string): { tool: string; args: Readonly<Record<string, string | number | boolean>> }[] {
  const seen = new Map<string, { tool: string; args: Readonly<Record<string, string | number | boolean>> }>();
  for (const req of resolveSlots(text)) {
    if (req.tool === undefined) continue;
    const args = req.args ?? {};
    seen.set(`${req.tool}|${JSON.stringify(args)}`, { tool: req.tool, args });
  }
  return [...seen.values()];
}

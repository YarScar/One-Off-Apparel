# Voice, style, and the non-negotiables

Condensed from `packages/grants/docs/PLAYBOOK.md`, which wins on any conflict.

Canonical program-language/messaging source as of 2026-08-24: the "Launchpad Programming MASTER" doc
(Doc `1YYEsi0PWm0oCtKAG_8jyQuP2PFEOhovnFroxkVeJ-WI`), reconciled into `kb_launchpad.json`'s
`meta.source_recency`. It wins on wording and terminology; it does NOT win on numeric claims — those
still come from a live `query_*` call or a filed application, per the rules below.

## The standard

Simple, straight, data-backed. State the point, back it with a number, move on. Impact through
clarity and evidence, not through clever phrasing. Write with the quiet confidence of someone
presenting strong evidence, not the enthusiasm of someone trying to convince.

The recurring complaint about AI-written content here is that it sounds generic and artificial.
**If a sentence could appear in any nonprofit's proposal, rewrite it.**

## Rules

- **A specific number beats an adjective, every time.** "11 of 12 graduates were in paid work at six
  months," not "strong placement outcomes." "$300,000 paid directly to participants," not
  "significant investment in students." If a claim can carry a figure, it should. Pull it from LP
  Internal AI or a sourced doc; never estimate to fill the slot.
- **Lead with the claim.** No throat-clearing. Not "We track two outcomes because either alone
  misleads" — make the point.
- **No setup-and-pivot.** Never "X is what builds the skill. But Y." State the whole thought once.
- **Never tell the funder what you are NOT asking for.** Handle eligibility by what you request.
- **Do not overclaim.** Supports are necessary, not the sole cause of success. Say what a factor
  contributes, not that it determines the outcome.
- **Cut any word reaching for emotion.** "Survivable," "transformative," "vanished on-ramp." Delete
  it and state the fact.
- **Plain, not colloquial, not stilted.** Not "a job that pays this week." Not "sits inside an
  organization with." Write how a sharp person talks in a serious meeting.
- **One idea per sentence. Verbs over abstractions.**
- **Story-led when it earns it.** When a concrete student example lands harder than an abstraction,
  use it. Do not default to abstraction. `packages/grants/seed/testimonials.json` is the quotes bank
  — 23 student/employer/other quotes, filtered by role/school/cohort. Student rows are de-identified
  (no name); quote a de-identified one by role and school ("a student at Furness"), never invent a
  name to attach. Employer/client rows carry a real attribution — those are professional attributions,
  not student PII, and can be quoted by name.
- **No defensive or apologetic framing.**
- **Honest about evidence weight.** Distinguish demonstrated outcomes from projected ones.

## No em dashes

Use hyphens. Never an em dash (—) or en dash (–) in any output. `count.mjs` checks this. Note that
prior filed Launchpad responses are full of them; do not copy that habit forward when reusing text.

## Banned jargon

transformative, innovative, holistic, leverage, ecosystem, move the needle, at the intersection of,
reimagine.

If you catch yourself reaching for one, find the specific and honest way to say it. `count.mjs`
checks these too, but it only catches the listed words — the rule is broader than the list.

## The two non-negotiables

### Never name an unverified entity

The highest rule. Employer partners, funders, placement sites, client names, schools, partner
organizations, and people. If you cannot point to exactly where a name came from and confirm it is a
real, current relationship, **the name does not go in the draft** — not as a placeholder, not as an
example.

Naming a fake or unverified employer partner to a funder is a credibility catastrophe and is never
acceptable. A name appearing in an old Drive doc is not confirmation it is a current partner.
"Engaged with" — a site visit, a conversation, a mentor — is **not** "employer partner" or
"placement," and the weaker relationship must never be upgraded in the writing. Pull real placements
from LP Internal AI employment data, not from memory or an old narrative.

When uncertain: name only what is verified, and ask staff to confirm the rest.

### Every number sourced

Tie each figure to the workbook, employment data, or a confirmed grant narrative. Never invent or
misattribute. Reconcile conflicting figures **before** drafting, not after — see
`references/figures.md`. Where a figure is not available, say so.

## Program facts that get mixed up

- **101 and LiftOff/Inc are measured differently.** 101's north star is AI fluency and a strong next
  step. LiftOff is the direct job-placement track. Keep their metrics separate.
- **Launchpad Inc. is the thesis, not a sidebar.** It is both proof of concept and the placement
  engine, and its paid work counts as unsubsidized employment. Keep it in the placement frame.
- **Why the program changed.** Launchpad started in software development. When AI arrived,
  entry-level developer roles got much harder to find, so Inc. was created and the outcomes emphasis
  shifted toward paid contract work and building experience — not only getting a job. Separately, all
  students now need AI skills, and durable skills matter more. That second point is the core pitch to
  education funders.
- **Old framing must never leak in.** A 2021 founding, a 2.5-year high-school pipeline, and a 1-year
  LiftOff apprenticeship capped at age 22 are all superseded. See `kb_launchpad.json` `meta`.

## Budget rules

Never invent a budget number. Pull from actuals or the operational budgets and map into the grant
format categories. For submissions use the grant budget format, not the operational layout.

Five expense categories: Staff & Leadership, Direct Student Investment, Curriculum & Instruction,
General & Administrative, Technology. Five revenue categories: Foundation Grants, Individual Donors,
Government Grants, Corporate Grants & Special Events, Earned Revenue.

## Self-edit checklist

Run before presenting anything. Never hand over a first draft.

1. `count.mjs` passes — every answer within limit, no em dashes, no banned jargon.
2. No throat-clearing opener in any answer.
3. No setup-and-pivot sentence.
4. No emotional-reach word.
5. No sentence that could appear in any nonprofit's proposal.
6. Every figure carries a source and an `asOf` date.
7. Every named entity traced to a confirmed current source.
8. 101 metrics not blended with LiftOff/Inc metrics.
9. Demonstrated outcomes distinguished from projected ones.
10. The requested fiscal-sponsorship framing applied consistently throughout.

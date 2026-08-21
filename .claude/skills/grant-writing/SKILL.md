---
name: grant-writing
description: Draft a Launchpad grant application, LOI, or funder report. Runs the funder's form through the deterministic layer in packages/grants (question matching, KB answer routing, figure verification, programmatic length checks), then drafts in Launchpad's voice with live figures from LP Internal AI. Use whenever asked to draft, revise, or length-fit a grant answer, an LOI, a budget narrative, or a progress report for a funder.
---

# Grant writing

Turn a funder's form into a draft answer package for staff review. Never a first draft — the version
Chip, Iman, or Dannyelle sees should already read like a third draft.

**A person always reviews and submits. Never submit. Never send anything to a funder.**

The craft rules are `packages/grants/docs/PLAYBOOK.md`; this skill operationalizes them. Where they
disagree, the PLAYBOOK wins and this file is a bug.

## Do not skip the deterministic layer

`packages/grants` already answers, in code, three questions you would otherwise guess at: which
question-bank entry a funder question maps to, whether the stored answer fits the funder's limit, and
which figures in that answer have drifted. Guessing at any of these is how a wrong number reaches a
funder.

Requires `packages/grants/dist` — run `pnpm --filter @lp-ai/lib-grants build` if the import fails.

## Step 0 — Get the form into JSON

Write `{ "meta": { "funder", "program", "due" }, "questions": [{ "text", "limit": { "unit", "max" } }] }`
to the scratchpad. `unit` is `"words"` or `"characters"`. Record limits **verbatim** from the funder;
never infer one. Seven real fixtures live in `packages/grants/seed/forms/` and can be passed by id.

Prior filed responses are reachable through the **Drive MCP → `search_documents` chain**
(`source` filter scoped to the grants corpus once ingested), never through a local mirror — the
server has no `data/Grants` tree and none of its 1,234 files are in git. Many filings hold the real
filed response alongside the questions — read the prior response for reusable material, but re-verify
every figure in it.

## Step 1 — Run the work order

```bash
node .claude/skills/grant-writing/scripts/prep.mjs <form-id-or-path>
```

It refuses to run if the seed integrity report is non-empty. It reports per question: the matched
bank entry and confidence, the KB slot, whether the stored answer fits, and a `GAPS` block. Then the
figure work order: the exact `query_*` calls to make before drafting.

Read the gaps as instructions:

| Gap | What it means |
|---|---|
| `unmatched` / `low_confidence` | The matcher is not confident. Confirm the mapping by hand before using the answer. |
| `no_kb_answer` | Nothing stored. Research and draft it — see step 1b. |
| `kb_unverified` | `verified:false` is a **true unknown**. Never present it as confirmed. Research and draft it. |
| `over_limit` | `compression_infeasible` means a purpose-written short answer, not a squeeze. Check whether the question wants a structured value rather than prose. |
| `needs_live_figures` | **Yours to resolve.** The stored answer holds `{{token}}` figure placeholders. Run each token's cut (step 3), substitute, then continue. |
| `needs_application_figures` | Staff, not you. The figure is specific to this application: a request amount, a target, a grant period. |

**Committed artifacts store language, not figures.** Every figure with a live source is a `{{token}}`
in the KB prose, and `grant_build_draft` will not return slotted text as an `answer` at all. It comes
back as `figure_template`, which is deliberately not called `answer` because a caller who treats it as
one pastes `{{wages_total}}` into a funder's portal. Expect far more outstanding model work than the
tool used to report: 12 of 17 questions on one real form.

**Fill before you fit.** The figure gate precedes every length branch, so the resize and expand paths
are largely unreachable from `grant_build_draft` directly. Fill the tokens first, then pass the filled
text to `grant_resize_answer`. Measuring a template's length measures the wrong text, since a token is
not the length of the number that replaces it.

**Expect the matcher to do badly on a funder it has never seen.** The bank's wordings come from 24
forms. On a form from one of them, matches land at 1.00; on a new funder, most fall below the 0.42
threshold. Treat `prep.mjs` output for a new funder as a triage list, not a routing decision. One known
defect: "Explain the issue that your program is seeking to address" routes to `cover.address` — the
*mailing address* slot — because the verb collides with the noun. Always read the confidence.

## Step 1b — Fill the gaps by research, do not stall

A gap is not a reason to stop and ask. Research it and draft a candidate answer now. Full procedure in
`references/gap-fill.md`; the short form:

```bash
node .claude/skills/grant-writing/scripts/gapfill.mjs <form> --out candidates.json
# ... research and fill `answer`, `sources`, `needs_staff` in each record ...
node .claude/skills/grant-writing/scripts/gapfill.mjs --validate candidates.json
```

Work the source ladder in order, stopping when a rung settles it: live platform data → internal docs
and conversations → **prior filed applications** → the Notion research wiki → the funder's own
material → ask staff. Rung 3 is the highest-yield and the most often skipped, because for most
questions someone has already written a good answer for another funder. Reach it through the same
MCP chain as rung 2 — `search_documents` scoped to the grants corpus — not a local grep. The
`corpus_search.py` script is a dev-only fallback for when the Drive corpus is not yet ingested:

```bash
python3 .claude/skills/grant-writing/scripts/corpus_search.py "current/recent funders"
```

Three rules on gap-fill:

- **A candidate needs at least one source.** An answer with no source is a guess, not a candidate.
  Prior filed text is a lead: every figure in it is stale until re-verified, every name unconfirmed
  until traced.
- **Research never licenses a name.** An old document will happily supply an employer or client name.
  That is not confirmation. See `references/style.md`.
- **Candidates are `verified:false` and stay out of the KB.** Nothing here writes to
  `seed/kb_launchpad.json`. Promotion is a deliberate human edit, or every researched guess becomes
  apparent fact next cycle.

Still goes to a person regardless of research: dollar amounts, the three framing choices, unconfirmed
entity names, and definitional figure conflicts.

## Step 2 — Intake: ask before writing

**Gate: wait for Iman's Criteria + Positioning section.** Before intake questions, check whether Iman
has already built the "Criteria + Positioning" bullet section (Grant Criteria/Hot Buttons +
Positioning/Main sell) in the Grant Overview Template — she builds it from her own research, Step 1's
research, and funder history. If it exists, intake answers come from it, not from a fresh ask. If it
doesn't exist yet, say so explicitly rather than drafting a positioning stance from scratch — this
section is what keeps drafting from drifting off the strategic angle, and skipping it just means
redoing the work once Iman produces it.

Research what you can, then ask. Do not guess at funder priorities, program scope, framing, or dollar
amounts. Three answers are needed every time, and the third is mandatory:

1. **Positioning** — workforce-oriented (job outcomes, paid work, certifications, employers) or
   education-oriented (AI fluency, durable skills, competency-based learning). Any specific angle the
   funder's priorities call for? This is the same question Criteria + Positioning answers — work
   through feasibility with Iman if the section is still open.
2. **Which programs to tee up** — 101 (two pathways: AI Software Development, Entrepreneurial
   Leadership), LiftOff (six-month learn-and-earn), Launchpad Inc. (paid client work). Workforce
   funders lead with LiftOff + Inc; education funders with 101 + AI fluency. Propose a default from
   the funder's priorities, then wait.
3. **Fiscal-sponsorship framing — ASK EVERY TIME, never assume.** Initiative (an initiative of
   Building 21) / Fiscal Sponsorship (the formal structure, with planned spin-out) / Silent (focus on
   Launchpad, B21 relationship not detailed).

Also ask which prior applications to build from, and propose candidates by matching orientation.

**Essential before drafting starts:** Dannyelle, Iman, and Chip have an upfront strategic conversation
about positioning, letters of support, and narrative framing before drafting begins.

## Step 3 — Fetch every figure live, then cut it the way the question asks

**Participant and program figures are always fetched live. There is no version of this step where a
number comes from stored text.** Not from the KB, not from a prior filing, not from the work order's
claim strings, not from an example in a reference file. If an answer carries a count, a rate, a wage,
or a dollar figure, a `query_*` call in this session produced it.

The work order is not the whole list of calls to make. It reports which *stored claims* have drifted,
which fires off the KB rather than off the funder's question. A question can need a live figure the
work order never mentions.

So work both lists:

1. **The question list.** For every question that asks for a number, look up the cut in
   `references/figure-cuts.md` and run it. That file maps question shape to tool, `query_type`, and
   filters for enrollment, employment, certifications, postsecondary, finance, and competency.
2. **The work order list.** Run what `prep.mjs` named, to catch stale figures inside stored prose you
   are reusing.

**Getting a figure should be quick. Deciding the cut is the actual work.** If you are agonizing over
whether a number is current, you have skipped the call. If you are agonizing over which population it
counts, you are in the right place: that judgment is the job.

Three failures to watch for, each of which produces a wrong number that reads as sourced:

- **Scope mismatch.** The question asked for the last 12 months and you ran the all-time cut. Live
  does not make it right. A count is only correct against the window and population asked for.
- **Unstated denominator.** "92% pass rate" or "301 participants" with no population attached. The cut
  goes in the same sentence as the figure.
- **Summing phase counts.** Participants appear in every phase they touch, so the phase totals sum
  above the unduplicated count. Union on `student_number`.

Then, per `references/figures.md`:

- **The claim strings in the work order are snapshots, not current facts.** They quote what the KB
  held on its snapshot date, and the live connector has moved past them — that is why the check
  exists. Never copy a claim string into a draft.
- **Live data beats a filed figure.** On a drift conflict, the connector wins.
- **A definitional conflict never resolves by recency.** Two figures counting different populations
  both being correct is an escalation, not a choice. Ask which population the funder means.
- **A scoping question is not a definitional conflict.** If the question names a year, a program, or a
  phase, it has already told you the definition. Run that cut. Escalating it wastes a staff decision on
  something the funder settled. Only escalate when two *correct* measurements count different
  populations and the question does not say which it wants.
- **Stamp every confirmed figure** with its source tool and `asOf` date. Re-check anything measured
  more than three days before submission.
- **ACL denial is not permission to quote the frozen figure.** Write `[DATA UNAVAILABLE]`. Neither is a
  tool that returns something other than what you asked for: `get_finance_brief` carries no income or
  expense totals, so it cannot answer a budget question no matter how successfully it returns.

## Step 4 — Draft

Before writing, name the one or two things that make Launchpad genuinely different on **this
funder's** criteria, and build the relevant sections on those. The mechanism is the content: not "we
provide stipends" but why the stipend-plus-paid-work structure removes the dropout decision.

**If a section could appear in any workforce nonprofit's proposal, it is not done.**

Read `references/style.md` before writing the first sentence. The rules that get broken most:
no em dashes, no banned jargon, lead with the claim, one idea per sentence, a number instead of an
adjective, and never tell the funder what you are *not* asking for.

Then the two hard limits on content, in full in `references/style.md`:

- **Never name an entity you cannot trace to a confirmed, current source.** Employers, funders,
  placement sites, clients, schools, partners, people. Not as a placeholder, not as an example. A
  name in an old Drive doc is not confirmation. "Engaged with" is not "employer partner".
- **Every number sourced.** Never invent, round, or misattribute. Where a figure is unavailable, say
  so.

## Step 5 — Verify counts programmatically, then self-edit

Counting by eye is banned. It has repeatedly been 10-30 words off.

```bash
node .claude/skills/grant-writing/scripts/count.mjs drafts.json
```

`drafts.json` is `[{ "label", "text", "unit", "max" }]`. It exits non-zero on any over-limit answer,
em dash, or banned-jargon hit. Re-run after **every** revision, not just the first draft. Never say
an answer is "within limits" without having run this in the same response.

Then the mandatory self-edit pass. Read the whole thing back against `references/style.md` and fix
your own weak sentences **before** presenting: throat-clearing openers, setup-and-pivot
constructions, emotional-reach words, stilted phrasing, and any sentence that could appear in any
nonprofit's proposal.

## Step 6 — Hand off

Present the draft with, per answer: the count against the limit, the source of every figure with its
`asOf` date, and an explicit list of what needs staff confirmation — unverified figures, definitional
conflicts, and any name that could not be traced. Flag uncertainty rather than filling it in with
something plausible.

**List the researched candidates separately from the KB-backed answers**, each with its sources and its
`needs_staff` note. A reviewer reads an answer written this session from research differently from one
drawn from established filed material, and should.

**What happens after hand-off, so a status question can be answered accurately:** Iman does a first
pass (word count, canonical and content facts) and tags Dannyelle (program content) and Chip (budgets,
budget narratives, financial reports) on what needs their input. After the second round, Iman
pressure-tests the draft with a neutral LLM (e.g. ChatGPT) about a week out from deadline — Claude
cannot fill that role for itself, being biased toward its own output. Dannyelle, Iman, and Chip edit
from that feedback; the third-round draft goes back to Iman for a Claude clarity/consistency/alignment
pass, then Iman uploads the final draft for Chip and Dannyelle's submission review.

## References

- `references/style.md` — voice, banned words, the non-negotiables, the self-edit checklist
- `references/figure-cuts.md` — **the cut catalogue: question shape to tool, `query_type` and filters.**
  Read this whenever a question asks for a number
- `references/figures.md` — drift in stored claims, conflict resolution, ACL denial
- `references/gap-fill.md` — the gap classes, the source ladder, the candidate record
- `packages/grants/docs/PLAYBOOK.md` — the source of the craft rules
- `packages/grants/README.md` — the rules you cannot break; the deterministic layer's shape

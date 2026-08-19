# Figure verification

Every number in a draft is a claim to a funder. This is how each one gets confirmed.

`packages/grants/src/figures.ts` holds 17 checks with the exact tool and arguments for each. Do not
retype them from here — `prep.mjs` prints the ones your draft actually needs, scoped to the KB slots
it uses. This file explains how to act on them.

## Read `figure-cuts.md` first

This file covers **stored claims that have drifted**. It fires off the knowledge base: a check exists
because a KB slot carries a number that has moved.

That is the wrong trigger for participant and program figures. A funder asking "how many participants
did you serve last year" needs a live call whether or not the KB happens to mention a number, and the
answer depends on a cut nothing in the KB specifies.

So participant and program figures are **always fetched live, with no snapshot comparison**, and the
only work is choosing the cut that matches the question.
[`figure-cuts.md`](./figure-cuts.md) is that mapping: question shape to tool, `query_type`, and
filters, for enrollment, employment, certifications, postsecondary, finance, and competency. Go there
whenever a question asks for a count, a rate, a wage, or a dollar figure. Come back here to act on
what `prep.mjs` reports about stored text.

Neither file is a source of figures. Both name calls. You run them.

## The claims in the checks are snapshots, not facts

Each check's `claim` string quotes what the **KB snapshot** held on its `kb_snapshot_date`. It is the
*stale side by design*: the whole point of the check is that the live connector has moved past it.
Do not treat the claim string as current, and do not edit the checks to chase filed material (H2
reports, an application that landed this week) — the numbers update faster than static storage can
hold them. The work order exists to force the live `query_*` call, and the live call wins on any
conflict. If you find yourself wanting to "fix a stale claim" in `figures.ts`, that is the drift
working as intended; quote the live figure instead.

## The four rules

1. **Live data beats a filed figure.** Newer wins on conflict. The LP Internal AI connector supersedes
   the knowledge base by recency.
2. **Some figures move every day.** Stamp every confirmed figure with its source tool and `asOf` date.
   Re-check anything measured more than three days before submission. Total wages moved $360,487 →
   $362,030 in four days.
3. **Two correct figures reach a person.** Numbers counting different populations do not resolve by
   recency. Escalate with both numbers and their definitions. Never choose silently.
4. **`verified:false` is a true unknown.** Never present it as confirmed. In the KB these are
   `kb.docs`, `kb.profile.federal`, `kb.profile.state_pa`, and `kb.management_plan`.

## Conflict kinds

`prep.mjs` labels each check. The label tells you what to do.

| Kind | Meaning | Action |
|---|---|---|
| `drift` | Same population, the number has moved. | Quote the live figure. The connector wins. |
| `definitional` | Two numbers count different populations. Both correct. | **Escalate.** Ask which population the funder means. Do not resolve it. |
| `content_gap` | The KB omits something the platform records. | Query it and add it. A draft built only from the KB is missing this. |
| `unknown` | No authoritative source wired up. | Ask staff. Do not estimate. |

## The definitional conflicts, in full

These three are the ones that will bite. All are `high` severity.

**`students_served_total` / `program_size_reach` — reclassified 2026-08-17. This is a scoping
question, not a definitional conflict, and it should not be escalated as one.** The three numbers
answer three different questions:

| Number | Counts | Source |
|---|---|---|
| 301 | Every enrollment record, all phases, all statuses, all time | `query_enrollment {query_type:"total"}`, live |
| ~145 | Unduplicated participants across all programs in **calendar 2025** | KB claim string; restated by staff in the 8/13 Upwork correspondence |
| 200+ | "Came through programming to date" | Barra Jul 2026 approved org overview |

The 200+ is most likely not a third population. The 8/13 Upwork correspondence gives the 2025 phase
breakdown as Foundations 91, 101 68, Lightspeed 8, LiftOff 40, and states that participants are
counted in every level they touched. Those sum to **207**. So 200+ reads as the duplicated phase-level
sum of the same population the 145 describes unduplicated. Confirm with whoever wrote the overview.

What to do: identify the scope the question asked for and run that cut, per
[`figure-cuts.md`](./figure-cuts.md). Do not send a scoping question to staff as though they have a
definition to choose; they have already told us the definition by asking for a year or a program.

**The blocker, and it is real.** A date-scoped served count cannot currently be produced.
`query_enrollment active_during` matches only records with a non-null `end_date`, so it drops every
In Progress record: LiftOff returns 22 for calendar 2025 and still 22 for a window through 2026,
against 40 records of which 18 are In Progress. OpenProject **#278**. Until that lands, write
`[DATA UNAVAILABLE]` for a served-in-period question, say the tool undercounts and by roughly how
much, and never substitute the all-time count.

**`cert_pass_rate`.** All-time PCEP is 32/59 = 54.2%. The applications quote per-cohort rates — 92%,
and 100% in the most recent cohort. Different denominators, both true. **State which one you are
quoting, in the sentence itself.** "92% pass rate" with no denominator named is the failure mode.

## Content gaps to watch

**`enrollment_by_phase`.** The platform records four phases — Foundations, 101, Lightspeed, LiftOff.
The KB program descriptions omit Lightspeed entirely. A program description written from the KB alone
will be missing a phase. Always run `query_enrollment({query_type: "by_phase"})` before describing the
program structure.

**`postsecondary_rate`** and **`attendance_rate`** have no KB coverage at all. If the funder asks,
query them; there is nothing stored to fall back on.

## ACL denial

`query_finances` (sensitive finance data) may be refused by your role.

**Corrected 2026-08-19 (#306): `query_donors` is not ACL-denied, and it works now.** This section used
to name it as refusable for donor PII. It is permitted — and until #306 it was *empty*, returning
`no_records` for every funder because nothing populated the tables behind it. That reply reads like
"this funder is not a donor" when the truth was that no donor was recorded at all, which is how a
drafting run came to file `[DATA UNAVAILABLE]` for four funders with real giving history.

#306 repointed `query_donors`, `get_finance_brief.recent_gifts` and `get_entity_brief`'s donor arm at
the `development:*` CRM tabs. Use `query_donors {query_type:"profile"}` for funder history — one call
covers giving, grants tracker, both pipelines and prior declines. **It defaults to Launchpad scope, and
the scope changes the figure by six figures**; see
[`figure-cuts.md`](./figure-cuts.md#funder-history) for the worked William Penn case and the
`dev_contacts` caveat.

**Corrected 2026-08-17: `get_finance_brief` is not a fallback for budget questions.** It returns fund
and account metadata, an account count summary, a recent-transaction sample, and sheet fund balances.
It carries **no income or expense totals**. This file previously said it was preferred for
`annual_budget`, which was wrong, and three checks in `figures.ts` still name it for `annual_budget`,
`revenue_mix` and `inc_client_work_booked`. It cannot answer any of the three. That correction is
being made in `src/figures.ts` under OpenProject #275.

For income, expense, or any budget line by fiscal year, use
`query_finances {query_type:"annual", contains:"<line>"}`. See
[`figure-cuts.md`](./figure-cuts.md#finance).

**A denial is not permission to quote the frozen KB figure as if confirmed**, and neither is a tool
that returns something other than what you asked for. Write `[DATA UNAVAILABLE]` and flag it for
staff.

Note `query_finances({query_type: "phase_budget_dashboard"})` — `phase_budget_dashboard` is the real
enum value.

**Updated 2026-08-17.** `phase_budget_summary` was still present in three shipped MCP prompt files
(`grant-writing.ts`, `board-reporting.ts`, `finance-audit.ts`, five occurrences). All five are now
`phase_budget_dashboard`. The previously documented failure mode was also wrong: the call does not
silently return zero rows, it fails validation with `invalid_enum_value` and lists the 29 valid
options. Loud rather than silent, which is better, but it meant a board report or finance audit
following those prompts hit an error at the phase-cost step.

## Presenting a verified figure

State the number, the population it counts, and when it was measured. A figure without its
denominator or its date is not sourced, even if you looked it up.

> $362,030 in wages paid to 45 participants across 86 jobs (`query_employment`, aggregate, asOf
> 2026-07-27).

## What this layer does not do

The deterministic layer **lists** data calls and never makes one. That is a security control, not a
style choice — the calls run under the caller's own permissions. `buildFigureWorkOrder()` returns a
work order; you execute it through the MCP tools.

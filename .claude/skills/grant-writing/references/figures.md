# Figure verification

Every number in a draft is a claim to a funder. This is how each one gets confirmed.

`packages/grants/src/figures.ts` holds 17 checks with the exact tool and arguments for each. Do not
retype them from here — `prep.mjs` prints the ones your draft actually needs, scoped to the KB slots
it uses. This file explains how to act on them.

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

**`students_served_total` / `program_size_reach`.** The connector holds 301 enrollment records; the
applications say ~145 served; an approved Jul 2026 Barra overview claims 200+. These are "every
record" vs "meaningfully participated" vs a third framing. All defensible, none interchangeable. Ask
which the funder is asking about, and pair with `query_students` broken down by `enrollment_status`.

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

`query_finances` (sensitive finance data) and `query_donors` (donor PII) may be refused by your role.
`get_finance_brief` is the fallback and is preferred for `annual_budget` regardless.

**A denial is not permission to quote the frozen KB figure as if confirmed.** Write
`[DATA UNAVAILABLE]` and flag it for staff.

Note `query_finances({query_type: "phase_budget_dashboard"})` — `phase_budget_dashboard` is the real
enum value. Three shipped prompt files still say `phase_budget_summary`, which is not in the enum and
silently returns zero rows.

## Presenting a verified figure

State the number, the population it counts, and when it was measured. A figure without its
denominator or its date is not sourced, even if you looked it up.

> $362,030 in wages paid to 45 participants across 86 jobs (`query_employment`, aggregate, asOf
> 2026-07-27).

## What this layer does not do

The deterministic layer **lists** data calls and never makes one. That is a security control, not a
style choice — the calls run under the caller's own permissions. `buildFigureWorkOrder()` returns a
work order; you execute it through the MCP tools.

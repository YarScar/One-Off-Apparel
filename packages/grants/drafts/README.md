# `packages/grants/drafts` — drafted answer packages awaiting review

Working output of the grant writing skill: one folder per stage of the pipeline, for grants a
person has not yet reviewed or submitted. Nothing here has been sent to a funder.

**This directory is gitignored**, for the same reason `packages/grants/data/` is: the filenames name
funders and the contents carry live financial figures and participant employment aggregates. See
[Why this is not tracked](#why-this-is-not-tracked).

## Layout

```
drafts/
  README.md                you are here
  figures-verified.md      the figure ledger for the most recent drafting session
  forms/                   funder forms transcribed to the pipeline's JSON shape
  answers/                 drafted answers, in count.mjs shape: [{ label, text, unit, max }]
  work-orders/             prep.mjs output, dated, so a draft can be traced to the work order
```

`forms/<id>.json` and `answers/<id>.json` share an id. Where a form already exists as a fixture in
`../seed/forms/`, the answers file reuses that fixture's id and no form file is added here.

## The 2026-08-17 session

Five grants, drafted blind to their existing filed answers, against live LP Internal AI figures.

| Answers file | Funder | Questions | Form source |
|---|---|---|---|
| `philadelphia_foundation_2026.json` | Philadelphia Foundation, Pathways to Opportunity | 29 | `forms/` |
| `tdjf_wells_fargo_t7_2026.json` | T.D. Jakes Foundation with Wells Fargo, T7 Social Impact | 22 | `forms/` |
| `aug7_truist.json` | Truist Foundation Inspire Awards | 17 | `../seed/forms/aug7_truist.json` |
| `wpf_workforce_2026.json` | William Penn Foundation, Workforce Training Supports | 12 | `../seed/forms/wpf_workforce_2026.json` |
| `upwork_followup_2026.json` | Upwork Foundation, post-submission diligence questions | 4 | `forms/` |

`count.mjs` passes on all five: every answer within its limit, no em dashes, no banned jargon.

```bash
for f in packages/grants/drafts/answers/*.json; do
  node .claude/skills/grant-writing/scripts/count.mjs "$f" || echo "FAILED: $f"
done
```

## How to read a draft

Read `figures-verified.md` first. It records what the connector actually returned, with the tool and
the `asOf` date for every figure, and it separates three things a reviewer needs kept apart:

- figures confirmed live against the connector,
- figures marked `[DATA UNAVAILABLE]`, which no tool could answer,
- definitional conflicts, which are escalated rather than resolved.

Then read the answers. Two markers appear inline and both are deliberate:

- `[STAFF CONFIRM]` — a person has to decide or verify this. Dollar amounts, entity names, targets,
  and anything the platform does not hold. A draft never guesses at these.
- `[DATA UNAVAILABLE]` — asked for and not returned. Written as-is rather than backfilled from a
  frozen knowledge-base figure.

The `max` values on questions where the funder states no limit are the drafter's own working caps,
not funder limits. They exist so `count.mjs` has something to check.

## Why this is not tracked

`packages/grants/data/` is gitignored because the folder paths themselves name funders. The material
here is more sensitive than that: it pairs funder names with Launchpad's operating deficits by
fiscal year, participant wage aggregates, and per-employer placement counts. A drafted answer is
also pre-review by construction, and a reviewer should never find one in git history and mistake it
for approved language.

Durability here means on disk in the working tree, not in version control. If the team decides these
should be tracked, that is a deliberate call: remove the ignore rule, and expect the disclosure
question to be answered first.

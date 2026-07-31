# `packages/grants` — `@lp-ai/lib-grants` (work in progress)

The grant writing layer for the LP Internal AI platform. It changes a funder's application form into a draft answer package for staff review: connect each funder question to a question in our question bank, get the stored answer, and measure it against the funder's length limit. A person always reviews and submits.

A working prototype proves the method and runs today. This package moves that method onto the platform in TypeScript.

**Scope: grant writing only.** Funder eligibility and fit scoring belong to the Data and Prospecting team and are not in this package.

**Status.** Release gates G1 and G2 are complete — see [`admin/SPEC.md`](./admin/SPEC.md) section 1. The seed data and seven modules are landed with 43 passing tests, and `grant_match_question` is registered in the MCP server. G2 was the parity risk gate and it passed exactly: 28,690 of 28,690 `difflib` ratios and all 337 recorded matcher results reproduce. `grant_build_draft` (G3) and `grant_resize_answer` (G4) are next. The package is a pnpm workspace member, so it takes part in the build.

## Start here

| If you want | Read |
|---|---|
| The pitch, the scope, the deliverables, the timeline | [`admin/PROPOSAL.md`](./admin/PROPOSAL.md) |
| The architecture, the security and compliance model, the data rules | [`admin/TAD.md`](./admin/TAD.md) |
| The build detail and the release gates | [`admin/SPEC.md`](./admin/SPEC.md) |
| A one-page orientation and where the flags are | [`admin/HANDOFF.md`](./admin/HANDOFF.md) |
| Where the project stands, and the OpenProject work packages | [`admin/OPENPROJECT-TASKS.md`](./admin/OPENPROJECT-TASKS.md) |
| What to pick up next, and the three open items | [`admin/NEXT-SESSION.md`](./admin/NEXT-SESSION.md) |
| How we actually draft: the intake steps, the style rules, the non-negotiables | [`docs/PLAYBOOK.md`](./docs/PLAYBOOK.md) |

Each document has one job. `PROPOSAL.md` is the only one written for readers outside engineering. Where `PROPOSAL.md` and `SPEC.md` touch on the same thing, `TAD.md` is the authority on architecture and data rules, and `PROPOSAL.md` is the authority on scope. `PLAYBOOK.md` is different in kind from the other four: they describe the build, it describes the craft. It is the source the grant writing skill is authored from — refer to `TAD.md` section 4.2 for why the guidance lives here rather than being fetched per draft.

## Layout

```
packages/grants/
  README.md            ← you are here: the index
  admin/               ← the review set (build documents)
    PROPOSAL.md            scope, deliverables, timeline, decisions
    TAD.md                 architecture, security, compliance, data governance
    SPEC.md                build detail and release gates G1–G5
    HANDOFF.md             cover note: where to look, what to flag
  docs/
    PLAYBOOK.md        ← the drafting craft; the source the skill is authored from
  package.json         ← @lp-ai/lib-grants
  tsconfig.json        ← extends ../../tsconfig.base.json
  src/
    index.ts               the package entrypoint (named re-exports)
    schemas.ts             zod schemas + types for each seed file
    py.ts                  counting primitives with Python semantics
    data.ts                seed loader + load-time integrity report
    limits.ts              length measurement against a stated limit
    figures.ts             the 15-check figure verification work order
    seq-ratio.ts           difflib.SequenceMatcher.ratio() port (G2)
    matcher.ts             funder question → question bank entry (G2)
  seed/                ← staged seed data (file-based; DB models deferred)
    questions.json         the question bank (82 questions / 11 categories / 29 answer slots / 211 wordings)
    QUESTIONS-SCHEMA.md    the schema and the growth rules for questions.json
    kb_launchpad.json      the knowledge base — 29 approved answers
    forms/                 form fixtures (two real funder forms + two generic samples)
```

## Where each file came from

| File | Origin in the prototype (`~/Projects/Grants`) |
|---|---|
| `seed/questions.json`, `seed/QUESTIONS-SCHEMA.md` | `question-bank/{questions.json,SCHEMA.md}` |
| `seed/kb_launchpad.json` | `pipeline/kb_launchpad.json` |
| `seed/forms/*.json` | `pipeline/sample_forms/` |
| `src/*.ts` | Rewritten from `pipeline/`. Not copied. |

## The rules you cannot break

`TAD.md` section 3 holds the reasoning and the evidence for all of these. The short form:

1. **Live data beats a filed figure.** Newer wins on conflict. `verified:false` is a true unknown — never present it as confirmed.
2. **Some figures move every day.** Stamp every confirmed figure with its source tool and `asOf` date. Re-check anything measured more than three days before submission.
3. **Two correct figures reach a person.** Numbers that count different populations do not resolve by recency. Escalate; never choose silently.
4. **A person always reviews.** Never submit. Never send anything to a funder.
5. **The layer lists data calls and never makes one.** This is a security control, not a style choice — `TAD.md` section 2.3.
6. **No sensitive data in this repository.** Do not add the prototype's `sources/` folder: ~5.6 MB of real customer records, transactions, student personal data, and transcripts. The platform serves it live under each person's own permissions. The form fixtures here hold questions and limits only.

# Question Bank Schema

`questions.json` is the canonical, normalized set of grant-application questions the pipeline matches against. It was synthesized from real funder forms held in the prototype's `sources/` folder, which is deliberately **not** in this repository — refer to `admin/TAD.md` section 2.5. `meta.sources` inside `questions.json` names all 19 of them, and each `variants[].source` records which form a wording came from, so provenance travels with the data.

## Top-level structure

```
{
  "meta":        { ... },   // versioning + provenance + enums
  "categories":  [ ... ],   // the 11 question groupings
  "kb_entries":  [ ... ],   // catalog of Knowledge Base answer slots
  "questions":   [ ... ]    // the canonical questions (the core asset)
}
```

## A canonical question

```json
{
  "id": "outcomes.results_committed",
  "category": "outcomes",
  "canonical": "What results are you committed to achieving during the grant period, and how will you know if you succeed?",
  "answer_type": "narrative",
  "kb_ref": "kb.outcomes",
  "frequency": "very_high",
  "limits": [ { "unit": "words", "max": 300, "source": "FFTC" } ],
  "variants": [
    { "text": "What results are you committed to achieving...? (300 words max.)", "source": "FFTC" },
    { "text": "State clearly what you will accomplish with awarded funds...", "source": "NewAlliance" }
  ]
}
```

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Stable `category.slug` identifier. |
| `category` | yes | One of the `categories[].id` values. |
| `canonical` | yes | The normalized phrasing the matcher scores against. |
| `answer_type` | yes | One of `meta.answer_types` (field, number, boolean, single_select, multi_select, demographic, narrative, attachment). Drives how the pipeline treats the answer. |
| `kb_ref` | yes (nullable) | The Knowledge Base entry that answers this. `null` = application-specific value (e.g. request amount, certification). |
| `frequency` | yes | How often this appears across funders (`meta.frequency_scale`). Prioritizes KB-building. |
| `limits` | optional | Real length caps observed in sources; each `{unit, max, source}`. Units: `words`, `characters`, `sentences`. |
| `variants` | optional | Real-world phrasings that map to this canonical, each with a `source`. **These feed the matcher** — more variants = better matching. |

## The `kb_ref` contract

`kb_ref` links a question to an answer slot. Slots prefixed `kb.profile.*` are structured org-profile fields. The rest are narrative/answer entries. The Knowledge Base ([`./kb_launchpad.json`](./kb_launchpad.json)) uses these same ids as keys, so a question routes straight to its answer.

## How to extend the bank

The bank grows from real forms. When the pipeline flags a question as `needs_review` (no confident match):

1. **If it's a genuinely new question:** add a new object to `questions[]` with a fresh `id`, the right `category`, a clean `canonical` phrasing, an `answer_type`, and a `kb_ref` (or `null`). Add the real wording as the first `variant`.
2. **If it's a new phrasing of an existing question:** just append it to that question's `variants[]`. This immediately improves matching with no other changes.
3. **If it needs a new answer slot:** add an entry to `kb_entries[]`. Then create the matching answer in the Knowledge Base.

Keep `canonical` phrasings funder-neutral (no funder name, no specific limit). Limits live in `limits[]`; funder wording lives in `variants[]`.

## Current coverage

**v0.4.3** — 11 categories · 92 canonical questions · 29 KB answer slots · 265 recorded funder wordings, synthesized from **27 sources**. `meta.version` in `questions.json` is authoritative; if this section and that field disagree, this section is stale.

The source count moved 25 → 27 on 2026-08-11 with no new wordings. `GSK-STEM-2026` and
`Truist-Inspire-2026` were carrying 31 recorded wordings between them and had never been declared in
`meta.sources` — added at v0.3, cited ever since, untraceable the whole time. Nothing detected it
until the `variant_source_undeclared` check landed; that check now enforces the invariant, and
`data.test.ts` pins the count at 27. **No `canonical` or `variants[]` text changed**, so matcher
output is untouched and the parity fixtures did not need regenerating — the full suite confirms it.

v0.4.3 closed board `grant-h32` by splitting two canonicals. **The wording count is unchanged at 265
on purpose** — this release moved three recorded variants rather than adding any, and `data.test.ts`
asserts that, so a "split" that quietly invents a funder source fails the suite:

- `program.population_impact` (narrative → `kb.target_population`) — takes the Truist "Who does your
  solution serve, and in what ways will the solution impact their lives?" and the JFF "Early-Career
  Impact…" wordings off `program.target_population`. Both ask a two-part who-and-how question against
  a narrative field; the canonical they left is genuinely `demographic` and keeps that type.
- `financials.budget_allocation` (narrative → `kb.budget_narrative`) — takes Truist's "How is your
  current budget allocated?" off `financials.operating_budget`, which is genuinely a `number` and
  keeps that type. A 150-word allocation narrative is not a figure.

Why growth rule 1 and not a retype: `answer_type` belongs to the ENTRY, not the variant, so retyping
either canonical to fix its guest wording would have broken the wording that belongs there. Both
parity fixtures were regenerated, control pass first; **exactly 5 of 406 matcher cases changed and
all 5 were the intended ones**.

v0.4.1 fixed the confident-wrong-shape match under B6 (`cover.funder_connection`) and left the
coverage story below unchanged.

v0.4.0 added the first three fixtures transcribed from the Google Drive Grants archive export held
in `packages/grants/data/` (the archive itself is not committed — `README.md` rule 6, `TAD.md` §2.5):

- **`forms/jevs_c2l_2024.json`** — JEVS Human Services C2L-PHL youth provider RFP (filed 2024-07-15). 16 questions, 2 with word limits (250 / 500).
- **`forms/wpf_workforce_2026.json`** — William Penn Foundation Workforce Training Supports RFP (drafting, due 2026-07-30). 12 questions, 3 with character limits (700 / 120 / 250).
- **`forms/hamilton_loi_2025.json`** — Hamilton Family Charitable Trust LOI (filed 2025-05-09). 9 questions, 6 with character limits.

35 new funder wordings were appended to existing canonicals, and **five new canonical questions**
were added under growth rule 1, each with real sourced wordings:

- `cover.fiscal_sponsor` (boolean → `kb.eligibility`) — "Will a fiscal sponsor be used?" Recurring for a fiscally sponsored applicant; answers the Step-3 framing decision.
- `cover.grant_period` (field → `null`) — start/end dates and duration in months. Application specific.
- `cover.multi_year` (boolean → `null`) — is this a multi-year request; often gated by a prior-relationship rule.
- `eligibility.minority_owned` (single_select → `kb.eligibility`) — MBE/WBE gate common in government RFPs.
- `eligibility.debarment` (boolean → `kb.eligibility`) — barred/suspended/debarred from government contracting.

One variant was deliberately placed to avoid a matcher tie: the WPF "Project description" wording
and its 250-character cap live on `program.description` (not `cover.project_summary`), because
"Project Description." otherwise ties at 1.0 between the two and bank order would flip a recorded
match. **Changing the bank obliges you to regenerate `src/__fixtures__/matcher-parity.json`** — `matcher.test.ts` asserts the fixture's `bank_version` equals `meta.version`, so the suite fails until you do. Run `python3 scripts/regenerate-matcher-parity.py --prototype ~/Projects/Grants/pipeline src/__fixtures__/matcher-parity.json` after copying the updated bank to the prototype; see `../CHANGELOG.md` under 2026-08-03 for the full procedure.

v0.4.2 transcribed three more real forms from the Grants archive and added their wordings to the
bank, under growth rules 1 and 2:

- **`forms/allen_hiles_2024.json`** — Allen Hiles Fund grant application (blank template, 11 questions, no printed limits).
- **`forms/jff_ai_pathways_2026.json`** — JFF & Google Advancing AI Resilient Early Career Pathways RFP (8 questions, no stated limits).
- **`forms/dolfinger_mcmahon_2023.json`** — Dolfinger-McMahon Foundation application (4 questions, no printed limits).

15 wordings appended to existing canonicals and **two new canonical questions** added:

- `organization.community_voice` (narrative → `kb.dei`) — "How does your organization include the people it serves in its decision-making process?" Allen Hiles asks it verbatim; it previously fell to `attachments.org_chart` at 0.37, a confident-shape trap of the same class B6 pinned.
- `program.operations` (narrative → `kb.program_desc`) — "Describe how the project will operate, including hours of operation, staffing, and volunteers." Allen Hiles asks it verbatim; it previously landed on `program.team_qualifications` at 0.20, which answers only the staffing half.

Both parity fixtures were regenerated (matcher + seq-ratio), the prototype bank was synced, and all
previously recorded shared cases came back byte-identical — the JFF form, which had **every one of
its 8 questions below the 0.42 floor**, now matches all 8 at 1.00.

v0.1 covered the four generic common-application sources (NNG, FFTC, NewAlliance, Instrumentl). v0.2 added the Philadelphia/regional, corporate, federal, and PA-state forms (CGA, Seybert, Barra, Patricia Kind, Lindback, BofA, Comcast, Truist, SF-424, ED 34 CFR 75.210, GEPA-427, YouthBuild, DCED, PAsmart, Philadelphia Works).

Three categories are new since v0.1:
- **`eligibility`** — hard pass/fail funder-fit gates (org type incl. the recurring "school" exclusion, geography, budget size, population thresholds, prior funding, support type). These map to `kb.eligibility`. They feed the prospecting/fit-scoring path (C1), not just form-filling.
- **`innovation`** — new/different, why-now, and significance/scale (Barra, Seybert, ED).
- **`risk`** — anticipated risks/challenges and mitigation (Barra, CGA).

v0.2 also added federal/state structured-field questions under `cover`/`financials` (UEI/SAM, congressional & PA legislative districts, NAICS/vendor number, object-class budget, indirect rate/NICRA, match). New `kb.profile.federal` and `kb.profile.state_pa` slots back these questions.

The convergence across sources still holds. The same core blocks recur everywhere, and that makes a shared bank viable.

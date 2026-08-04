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

**v0.4.1** — 11 categories · 88 canonical questions · 29 KB answer slots · 248 recorded funder wordings, synthesized from 22 sources. `meta.version` in `questions.json` is authoritative; if this section and that field disagree, this section is stale.

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

v0.1 covered the four generic common-application sources (NNG, FFTC, NewAlliance, Instrumentl). v0.2 added the Philadelphia/regional, corporate, federal, and PA-state forms (CGA, Seybert, Barra, Patricia Kind, Lindback, BofA, Comcast, Truist, SF-424, ED 34 CFR 75.210, GEPA-427, YouthBuild, DCED, PAsmart, Philadelphia Works).

Three categories are new since v0.1:
- **`eligibility`** — hard pass/fail funder-fit gates (org type incl. the recurring "school" exclusion, geography, budget size, population thresholds, prior funding, support type). These map to `kb.eligibility`. They feed the prospecting/fit-scoring path (C1), not just form-filling.
- **`innovation`** — new/different, why-now, and significance/scale (Barra, Seybert, ED).
- **`risk`** — anticipated risks/challenges and mitigation (Barra, CGA).

v0.2 also added federal/state structured-field questions under `cover`/`financials` (UEI/SAM, congressional & PA legislative districts, NAICS/vendor number, object-class budget, indirect rate/NICRA, match). New `kb.profile.federal` and `kb.profile.state_pa` slots back these questions.

The convergence across sources still holds. The same core blocks recur everywhere, and that makes a shared bank viable.

# Grant Data Triage — `data/Grants`

| Field | Value |
|---|---|
| Written | 2026-08-11 |
| Author | triage session (opencode) |
| Scope | `data/Grants/` — what is useful to the grant layer, what is already in the system, what must not be ingested |
| Status | Triage complete; **all five H2 extraction tasks delivered 2026-08-11** (H2.1–H2.5, reports in `docs/grant-data-triage/`). **`grant-19o.6` closed** (framing replacement spec: `H2.6-siegel-framing-fix.md`; staff applies the edit). **`grant-19o.7` redaction half complete** (63 redacted copies in `/tmp/opencode/redacted/`, 0 credential hits on re-scan; `H2.5-redaction-execution.md`); **password rotation at the portals remains the open staff half**. Staff approval pending for H2.1 structured-value candidates and the kb.docs reference text. |
| Related | Phase H (`grant-kmi`), KB content gap (`grant-miy`), D1a/D1b structured KB values + `fetch_figure` |

## 1. What this is

`data/Grants/` is a local mirror of the Launchpad **Grants** Google Drive tree — 1,234 files, ~1.6 GB,
organized by funder. Each funder folder follows the same shape: `Grant Application / Responses /
Finances / Attachments / Reporting / Grant Agreement / Meetings`. It is the same tree Phase H
enumerated through the Drive discovery connector (1,257 files across 617 folders, `driveId
0AAj6r5Nb_TnNUk9PVA`); the local mirror is missing ~23 files (largely media) and is untracked by git.

### File census

| Type | Count | Notes |
|---|---|---|
| docx | 528 | applications, responses, reports, agreements |
| pdf | 416 | submitted PDFs, budgets, 990s, RFPs |
| xlsx | 165 | budgets, metrics, demographics, staff lists |
| pptx / ppt | 26 + 4 | site-visit and EIR decks |
| mp4 / m4a | 20 + 10 | student interviews, demos, storytelling videos |
| HEIC / jpg / png | 9 + 8 + 8 | student photos (reports) |
| vtt / csv / gdoc / gsheet / doc / misc | ~50 | transcripts, school data, misc |

**~938 MB of the 1.6 GB is media** (interviews, demos, photos). Path-segment counts: 473 under
`Grant Application`, 163 under `Responses`, 117 under `Finances`, 81 `Attachments`, 75 `Reporting`,
49 `Interviews`, 40 `Grant Agreement`, 38 `Reference`, 9 `Site Visit`.

### Buckets at a glance

| Bucket | Volume (approx) | Verdict |
|---|---|---|
| Already covered by KB / live connectors | ~150 narrative responses + spreadsheets | do not re-ingest |
| High-value gap-fill | ~60 files across reporting, agreements, compliance, program descriptions | extract selectively |
| Do-not-ingest (PII, creds, media, third-party, old framing, drafts, dupes) | ~1 GB incl. media | exclude / redact |

## 2. Already in there — do not re-ingest

**KB narrative is distilled from this exact tree.** `packages/grants/seed/kb_launchpad.json`
`source_recency` names the funders below; their 2026 filed responses here are the source material for
the 29 KB answers:

| KB source (newest → oldest) | Present in `data/Grants` | Key file |
|---|---|---|
| Barra (Jul 2026, Inc overview) | ✅ | `Current and Past/Barra/Launchpad Inc 2026/Launchpad_Inc_Barra_Foundation_Overview.docx` |
| GSK (Aug-7 pilot) | ✅ | `Prospects and Proposals/GSK/2026/.../8_7_2026 GSK Grant.docx` |
| Truist (Aug-10) | ✅ | `Prospects and Proposals/Truist Foundation/2026/.../8_10_2026 Truist Application.docx` |
| William Penn (Jul 2026) | ✅ | `Current and Past/William Penn Foundation/2025 Workforce Development Grant/7_25_25 William Penn Foundation Grant Response.docx` |
| Arbor Rising (Jun 2026) | ✅ | `Prospects and Proposals/Arbor Rising/2024/Arbor Rising Information Session Slides - June 2024.pdf` |
| Philadelphia Foundation (Jun 2026) | ✅ | `Prospects and Proposals/Philadelphia Foundation/2026/.../8_17_2026 - Philadelphia Foundation.docx` |
| Seybert (May 2026) | ✅ | `Prospects and Proposals/Seybert Foundation/2026/.../5_15_25 - Seybert Foundation.docx` |
| Connelly (May 2026) | ✅ | `Current and Past/Connelly Foundation/2026 Grant/.../2_2026 Connelly Foundation Grant Response - General Operating.docx` |
| Upwork (FY2027) | ✅ | `Prospects and Proposals/Upwork Foundation/2026 .../8.10.26 Upwork Extension Question.docx` |

**Structured data is live in Postgres via connectors** — students/race_ethnicity, employment,
postsecondary, certifications, finances (Aplos + sheets), donor/grants CRM. Root spreadsheets
(`Launchpad Demographics.xlsx`, `Launchpad Outcomes Data - Reference Stats.xlsx`, `race_ethnicity.csv`)
are largely redundant with the live connector, which is the preferred source on conflict. Note:
`race_ethnicity.csv` (Philly 342 / Allentown 467) is **Lab School** data, not Launchpad program data.

**Templates** (`Grant Response Template`, `Grant Report Template`, `Grant Rejection Letter Response
Template`, LOS templates) mirror process assets the playbook already encodes. They also carry
`User Name / Password` fields — see §4 redaction.

## 3. High-value gap-fill

Selective extraction only, each item mapped to a KB slot or board task. All candidate values must be
grounded in **filed/submitted** material and pass the redaction gate (§4); nothing here overrides the
live connector on conflict.

### 3.1 Short structured KB values — D1 content (board task `grant-miy`, D1a/D1b)

The remaining ~14 structured values for the field / single_select / boolean / number / demographic
bank questions. Sources in-tree:

- `Prospects and Proposals/GSK/2025/.../2025 Building 21 Staff.xlsx` (and `2023/.../Building 21 Staff.xlsx`) — staff/board structure for org-type, demographic, and count questions.
- Funder budgets (Truist, Connelly, Upwork finance folders) — budget-total / multi-year / financial-number questions.
- `Current and Past/William Penn Foundation/2024-2026 Grant/Reporting/7-31-25 Report/7_31_25 William Penn Report.docx` — org history / prior-grant-results narrative.
- `Current and Past/Connelly Foundation/2026 Grant/.../Launchpad Advisory Building 21 BOD.pdf` — board-list question.

Extraction must respect the in-progress `kb_launchpad.json` working-tree edits (structured values
already landed for `cover.project_title`, `program.geographic_area`, `program.target_population`,
`cover.ein_taxstatus`, `cover.address`, `cover.contact_and_ed`). Produce candidate sheets for staff
approval rather than editing the file directly.

### 3.2 Compliance-docs file references — `kb.docs` (currently `verified:false`)

`kb.docs` is a placeholder. The tree holds the real artifacts; the gap-fill is a **file-reference
inventory**, not text ingestion:

- 990s / audits: `Current and Past/William Penn Foundation/2024-2026 Grant/.../6-2022 Audit Building 21 - FINAL.pdf`, `6-2021 Audit Building 21 - FINAL.PDF`, `Current and Past/Siegel Family Endowment/2023 Grant/.../2020 990 FINAL client copy.PDF`.
- Board list: `Current and Past/William Penn Foundation/.../2022 Building 21 Board Officer List and Roles (8_1_22).pdf`, `Connelly .../Launchpad Advisory Building 21 BOD.pdf`.
- Org chart: `Current and Past/Catalyze Challenge/2024 Grant Application (Round 4)/Attachments/Launchpad Org Chart November 2024.pdf` (most recent: `Prospects and Proposals/New Profit/2025/.../Launchpad Org Chart July 2025.pdf`).
- Leadership bios: `Current and Past/Philadelphia Foundation/2024 Fund for Children/.../2024 02 Building 21 Leadership Bios.pdf` (personal-history PII — reference only, do not embed raw).
- Determination letter: **found in-tree** — `Current and Past/Philadelphia Foundation/2024 Fund for Children/Grant Application/Finances/Building 21 Determination Letter.pdf` (H2.2 inventory; date needs one staff eyeball). Full inventory: `docs/grant-data-triage/H2.2-kb-docs-inventory.md`.

### 3.3 Federal / PA identifiers — `kb.profile.federal`, `kb.profile.state_pa` (both `verified:false`)

Targeted search candidates:

- `Current and Past/Dept of L&I /NOO/` — contract number `594-24-001`, PA workforce grant docs; likely hold PA SAP/Vendor and EIN references.
- `Current and Past/Dept of L&I /Application 1.26/` — `PA 2025 Jobs List.pdf`, L&I grant notice.
- `Prospects and Proposals/Department of Education - EIR/` — federal grant context (UEI/SAM references).
- EIN `47-2514219` confirmed in KB; UEI, SAM.gov status, PA SAP number, NAICS, and congressional districts remain to source.

### 3.4 Outcome / impact evidence — `kb.outcomes`, `kb.metrics`, `kb.capacity`

- `7_31_25 William Penn Report.docx` — rich 2024-25 results narrative (hiring, enrollment, employer engagement).
- `Current and Past/Catalyze Challenge/Year 2 Final Report/Launchpad_Building 21 - Narrative Report.docx` — historical cohort data (⚠ old framing, see §4).
- `Current and Past/Siegel Family Endowment/Reporting/` — annual report and check-ins.
- `Current and Past/Chappell Culpeper/2024 Grant/Reporting/7.31.26 Final Report /` — LiftOff outcomes (photos are PII; text only).
- `Current and Past/Connelly Foundation/2026 Grant/Reporting/Connelly_Foundation_Update_May2026.docx`.
- `Submitted Goals _ Outcomes.xlsx` — goals/outcomes mapping.

### 3.5 Citable reference stats — `kb.need`, `kb.eligibility`

`Launchpad Outcomes Data - Reference Stats.xlsx` holds sourced local/national statistics (Pew State of
the City 2023, CompTIA State of the Workforce 2024) usable in statements of need with citations. Low
risk; keep source + publication date.

### 3.6 Reusable program descriptions & media coverage

- `Launchpad Program Descriptions/Launchpad AI Enterprise Description.docx`, `Launchpad 101 Description.docx` — alternative framing of the two flagship phases.
- `Connelly .../12_2025 Launchpad Media Coverage.pdf`, `Citizens Bank/2024 Grant/Post Award Marketing/DA Press Release Quote.docx` — third-party proof points for impact stories.

### 3.7 Funder RFPs / guidelines — prospecting reference, not KB

`William Penn Foundation/2025 Workforce Development Grant/WPF_Workforce_Training_RFP_2025_FINAL.pdf`,
EIR NOFO/guidance, and funder call-for-ideas docs (e.g. Philadelphia Dept of Commerce). Value is in
funder-fit and bank question-matching, not narrative. Catalogue as reference; do not embed.

## 4. Do-not-ingest

| Category | Evidence in-tree | Reason |
|---|---|---|
| **Portal credentials** | **Systemic (H2.5):** 60 docx carry filled username/password in the template's `Application Site / User Name / Password / Google Drive Folder` header — 52 live passwords, ~30 distinct, one shared default reused ~19× (seed: `8_17_2026 - Philadelphia Foundation.docx`, `7_31_25 William Penn Report.docx`). Full list: `H2.5-pii-redaction-sweep.md` | credential exposure; **rotate passwords (bead `grant-19o.7`)** + strip the login block before any ingest |
| **Student PII media** | Cambiar Empathy Interviews (49 files), `Telling the Full Story.mp4`, Chappell Culpeper LiftOff student photos (HEIC) | student faces/voices; ~938 MB; storage cost |
| **Donor PII** | `Philadelphia Foundation/DAF/` (2 DAF forms, incl. 31 MB `2025.11.10 Launchpad DAF Form`) | donor-advised-fund personal/financial details |
| **Signed letters of support** | `*LOS*`, `*Letters of Support*` folders | personal signatures; process artifacts, not reusable content |
| **Personal staff bios** | `2024 02 Building 21 Leadership Bios.pdf` (personal histories, education) | PII; already covered by `kb.staff_bios` (approved text) |
| **W-9 / SSN / financial disclosure** | 34 files matching W-9/SSN patterns (Bank of America, Yass Prize, Foot Locker responses) | tax/financial PII |
| **Third-party / federal reference** | `Prospects and Proposals/Department of Education - EIR/.../Reference/` — US DoE guidance and **other orgs'** federal narratives (First Hand `S411C210055`, CommonLit `S411C220171`) | not Launchpad's material; copyright; stale guidance |
| **Old framing (2022–2024)** | Catalyze Y1/Y2 reports (41-student inaugural cohort, ASU course), pre-2024 applications | "old framing must never leak into new drafts" (KB meta); gap-fill only with recency flags, never primary |
| **Draft / unsubmitted prospects** | `Prospects and Proposals/` draft responses, `*.docx` in `Working/`, `Copy of ...` | not filed/verified; cannot feed the KB |
| **Internal finance** | budgets, invoices, `fw9.pdf`, monthly invoicing manuals, `Revised Budget` workbooks | sensitive internal finance; connector serves finance under permissions |
| **Duplicates** | ~30 `Copy of`/`(1)` files (`Copy of 2023 GSK Grant Response_.docx`, `q2.mp4` ×2, LOS template copies) | dedupe, keep newest |
| **Empty folders** | `Prospects and Proposals/{Catalyze Challenge Rd 4, Carnegie Foundation, Advancing AI Resilient Early Career Pathways (JFF)}` | no content |

## 5. Ingestion gate (apply to every future ingest)

1. **Filer status** — only filed/submitted content may feed the KB; drafts need an explicit decision.
2. **Redaction sweep** — portal credentials, SSN/W-9, donor and student PII must be stripped before any document reaches a chunk or KB slot (§4 list is the seed set; re-run the scan).
3. **Framing check** — 2022–2024 material carries old framing; tag recency, use for gap-fill only.
4. **Recency rule** — live connector > newest filed application > older material (KB meta).
5. **File references over text** — compliance docs (`kb.docs`) reference file paths, do not embed.
6. **Never commit the tree** — `data/` stays untracked; ingest selected documents into Postgres/`document_chunks`/KB, not files into git.

## 6. Open questions for staff

- Served-count reconciliation: newest filed is **220+ served / ~3,000 reached** (Truist Aug-2026), superseding the KB's ~145; the live connector holds 301 all-time student records. Pick one staff-approved definition. See `H2.1-structured-kb-values.md` §(b).
- **Fiscal year start — RESOLVED:** fiscal year ends June 30 (GSK, WPF, Connelly filed agree); closes the `kb.profile.identity` open item.
- **Framing decisions needed (H2.1 §(e)):** (i) budget framing — Launchpad program (~$2.06M FY27) vs Building 21 consolidated (~$4.2M) for `financials.operating_budget` / `cover.budget_totals` / `eligibility.budget_size`; (ii) registered address — 600 W. Germantown Pike (fiscal-sponsor filings) vs 801 Market St hub — for `cover.address`; (iii) EIN exemption date FY2014-15 to add to `cover.ein_taxstatus`.
- PCEP framing: connector aggregate 32/59 = 54.2%; the only report datapoint (~half of 30+ seniors, Siegel 2025) supports the aggregate over the KB's "70–100% per cohort, 100% most recent" — see `H2.4-outcome-reconciliation.md` (conflict #2).
- 9-month earnings projection: KB "~$35,000" conflicts with Siegel End-of-Grant final "$22,800" (notes draft ~$30,000) — see H2.4 conflict #1.
- Competency framework count: 6 (Siegel EOG) vs 7 (Connelly May 2026; likely a 7th "Work as a professional" durable-skill competency) — see H2.4 conflict #3.
- **Old-framing in a new doc:** the 2026–27 Siegel Launchpad Inc. proposal uses "2.5-year learn-and-earn pathway" — retired framing in a NEW doc (bead `grant-19o.6`).
- **PA identifiers — partially FOUND (H2.3):** SAP/Vendor `836156` / `0000836156`; NOO `594-24-001` (100% state-funded, CFDA 00.001); 10% de-minimis indirect rate, no NICRA; PA sales-tax exemption `75621523` (exp 06/30/2027); EITC participation (EIO). **Still needs staff:** UEI + SAM.gov registration (PA NOO field blank by design), NAICS, and PA/US congressional districts (official lookups; `data/` has none). See `H2.3-federal-pa-identifiers.md`.
- Whether `Launchpad Inc.` programmatic phase terminology should be aligned in the KB (Lightspeed vs. Inc naming).
- Board/staff race-ethnicity-gender breakdown source (KB `kb.profile.demographics` gap) — the tree's `Demographics.xlsx` Board tab appears empty (H2.2 confirmed; `Internal` and `Launchpad` tabs hold leadership-ethnicity and cohort-gender data).
- Determination letter issue-date confirmation (file found in-tree; open it once to record date + EIN coverage).
- Determination letter location for `kb.docs`.

## 7. Board tasks

Filled as epic **Phase H2 — Grants tree content extraction / KB gap-fill** (children):

- H2.1 Short structured KB value candidates (D1 content, `grant-miy` dependency)
- H2.2 Compliance-docs file-reference inventory (`kb.docs`)
- H2.3 Federal + PA identifier discovery (`kb.profile.federal` / `kb.profile.state_pa`)
- H2.4 Outcome-report evidence reconciliation (`kb.outcomes` / `kb.metrics`)
- H2.5 PII / credential redaction sweep (ingestion gate)

Discovered follow-up:
- Siegel 2026–27 Launchpad Inc proposal carries retired 2.5-year framing (`grant-19o.6` ✅ closed — replacement spec in `H2.6-siegel-framing-fix.md`, staff applies edit)
- Rotate exposed funder-portal credentials + apply redaction plan (`grant-19o.7` — P1 security; redaction done, **rotation + tree swap is the open staff half**)

---
name: grant-report-draft
description: Drafts grant reports for Launchpad by pulling together the grant application, grant agreement, prior reports, and grant tracking data from Google Drive, cross-checking the application against the agreement, and writing a literal, fact-only narrative draft (no spin) with an embedded inconsistency log and source citations. Use whenever the user asks to draft, write, start, or work on a grant report or funder report — for any funder, including quarterly progress reports (QPRs), mid-year reports, and final reports. Also use when the user asks to check a report for inconsistencies with the grant agreement, trace where a stat came from, or pull together grant data before writing. This is the general-purpose version that adapts to any report template; funder-specific skills (William Penn, JPMorgan, etc.) exist with pre-loaded templates — use this one for any funder without a dedicated skill, or to compare against the funder-specific version.
---

# Grant Report Drafting (General)

Launchpad produces 8–15 grant reports a year, and the most time-consuming part is not the writing — it's
digging through the grant application, the signed agreement, prior reports, and the tracking
spreadsheet to assemble facts that are actually correct. This skill exists to do that assembly work and
hand back a literal, checkable first draft, so a human only has to review and edit rather than start
from a blank page. Two things matter more than anything else here: the data must be right, and the
language must not spin a result to look better than it is. When in doubt, lean toward flagging
uncertainty rather than smoothing it over.

## Before drafting: figure out which funder and which report

Ask (or infer from context) which funder this report is for, what type of report it is (final, mid-year,
quarterly/QPR), and its due date if known. If a dedicated skill exists for this funder (check the
available skills list for something like `grant-report-<funder-name>`), prefer that one — it already
has the funder's exact template and narrative questions loaded in and will save a search step. Use this
general skill when no funder-specific skill exists yet, or when the user explicitly wants this flexible
version.

## Step 1: Gather the source documents

Search Google Drive for each of the following. Search broadly by funder name plus a document-type
keyword (e.g., "William Penn grant agreement", "William Penn application") rather than assuming a fixed
folder path — Launchpad's Drive is organized by funder with a "Grant > Reporting" pattern, but exact
structure varies enough that keyword search is more reliable than hardcoded paths.

1. **The original grant application** (the proposal Launchpad submitted for this grant).
2. **The grant agreement / contract** (the signed document from the funder).
3. **Prior reports for this funder**, if this is a repeating grant. For repeating funders (currently
   William Penn is the clearest example, spanning multiple years of reports), pull *every* past report,
   not just the most recent one — patterns, commitments, and prior framing carry forward across years,
   and a mid-year report from two years ago may contain context a "most recent report only" search would
   miss.
4. **The grant tracking data** for this grant: due date (both the actual deadline and Launchpad's
   internal deadline, which is typically 5 days earlier), funder, contact, applicable initiative, funding
   amount, whether the grant is on target and why/why not, report submission site, and login credentials
   if the report needs to be submitted through a portal.
5. **Any source documentation for specific stats** — PDFs, screenshots, or backing files for numbers
   like completion rates or headcounts, if they exist in Drive.
6. **A report template or outline**, if one exists as a separate doc, or the narrative question list
   from the most recent report for this funder if no separate template exists.

If any of these can't be found, say so explicitly rather than proceeding as if the gap doesn't exist —
list what's missing at the top of your draft under a **Missing Source Materials** note, since a human
may know exactly where to find it even if a Drive search didn't surface it.

### Handling a brand-new grant (no reporting history yet)

Not every gap is a problem. If this is the first report for a brand-new funder relationship, or a new
grant program from an existing funder, there will genuinely be no prior reports and no established
narrative-question format to match — that's expected, not a missing-source issue, so don't list "no
prior reports found" under Missing Source Materials as if something was lost. Note it plainly instead:
"This is Launchpad's first report for this grant; no prior reports exist to reference."

What still applies in full: the application-vs-agreement cross-check (Step 2) and the literal,
sourced-fact standard (Step 3) — a first report needs these exactly as much as a tenth one does. For the
report's structure, use whichever of these is available, in order of preference: (1) an explicit report
template or question list the funder provided (check the grant agreement itself, the funder's portal, or
any communication from the contact — funders often specify reporting requirements directly in the
agreement even for a first grant), (2) if nothing from the funder is available, structure the draft
around Launchpad's three core elements (what happened, outcomes, lessons learned) and say plainly in a
note at the top that no funder-specific template was found, so the format can be adjusted once one
surfaces. Don't invent a template that looks official — an honestly plain structure is better than a
guessed one dressed up to look authoritative.

If this new grant is with a funder likely to become a repeating relationship, it's worth flagging to the
user once the draft is done that a dedicated funder-specific skill could be built from this report going
forward, the same way the William Penn, JPMorgan, and other funder skills were built from their existing
report history.

## Step 2: Cross-check the application against the agreement

Read `references/inconsistency-and-citations.md` for the full process. In short: compare funding amount,
dates, deliverables, and any conditions between the application and the signed agreement, and produce an
**Inconsistencies Found** section — even if the answer is "none found." This goes at the very top of the
draft, before any narrative.

## Step 3: Extract literal facts and draft the narrative

Read `references/literal-style-guide.md` before writing a single sentence of narrative — it's the
constraint that makes this skill worth using instead of a generic writing assistant, and it includes
concrete before/after examples.

Regardless of how the specific funder phrases its questions, ground the narrative in Launchpad's three
core reporting elements:

1. **What happened** — a literal, dated account of activities during the grant period (what was run,
   how many people participated, what was delivered).
2. **Outcomes** — what measurable results came from the grant, backed by a specific figure and its
   source wherever possible.
3. **Lessons learned** — what Launchpad learned about implementation, including genuine challenges and
   what helped overcome them, not just a highlight reel.

Map these three elements onto whatever specific questions the funder's template actually asks (a
narrative Q&A format, financial commentary fields, a single long-form narrative, etc.) — the underlying
content is the same even when the wording differs. If the report template includes financial/spend
tables, populate them from the grant tracking data and financial reports found in Drive, and flag any
number you can't source rather than leaving it blank without comment.

## Step 4: Build the source citation log

Read `references/inconsistency-and-citations.md` for the format. Every specific number or outcome claim
in the narrative needs a row in a **Sources** table showing exactly which document (and where in it) the
figure came from. This is what lets Launchpad answer "where did this come from?" later without
re-digging through Drive, and it's what makes a stat fast to double-check before submission.

## Step 5: Assemble and deliver one draft document

Produce a single Google Doc (via the Drive connector) containing, in this order:

1. Missing Source Materials (if any)
2. Inconsistencies Found
3. Narrative draft, structured to match the funder's actual report questions/template
4. Sources table

Title the doc clearly, e.g. "[Funder] [Report Type] Draft — [Due Date]", and place it in the same Drive
folder as the funder's other reporting documents if one is identifiable. This is a first draft for a
human to review and edit before submission — say so in a short note at the top of the doc, and don't
try to make it submission-ready by, e.g., inventing polish the source data doesn't support.

## Handling gaps

If a narrative question can't be answered from the available source documents (no data found, or found
data doesn't clearly answer what's being asked), write the question with a placeholder like `[NEEDS
INPUT: ...]` describing exactly what's missing, rather than guessing or writing around it. A visible gap
is far more useful to a reviewer than a plausible-sounding sentence with nothing behind it.

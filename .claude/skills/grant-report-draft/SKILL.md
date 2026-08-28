---
name: grant-report-draft
description: Drafts grant reports for Launchpad by pulling the grant application, agreement, prior reports, and tracking data from Google Drive, confirming the grant's actual funded scope, cross-checking application vs. agreement, and writing a literal, fact-only narrative (no spin) — delivered as a native Google Doc with an inconsistency log and every fact cited via an inline hyperlink next to where it appears (no separate Sources table). Use whenever the user asks to draft, write, start, or work on a grant or funder report — any funder, including QPRs, mid-year, and final reports. Also use to check a report for inconsistencies with the agreement, trace where a stat came from, or pull grant data before writing. General-purpose version for any funder without a dedicated skill (William Penn, JPMorgan, etc. have pre-loaded ones), or to compare against a funder-specific version.
---

# Grant Report Drafting (General)

Launchpad produces 8–15 grant reports a year, and the most time-consuming part is not the writing — it's
digging through the grant application, the signed agreement, prior reports, and the tracking
spreadsheet to assemble facts that are actually correct. This skill exists to do that assembly work and
hand back a literal, checkable first draft, so a human only has to review and edit rather than start
from a blank page. Two things matter more than anything else here: the data must be right, and the
language must not spin a result to look better than it is. When in doubt, lean toward flagging
uncertainty rather than smoothing it over.

## Keep it concise — length is part of quality here

A draft that takes ten minutes to read defeats the point of this skill, which is to save a human time.
Long is not the same as thorough: the value here comes from correctness and traceability, not from
volume. Treat brevity as a real constraint, on the same footing as accuracy — a shorter, precise draft a
reviewer can skim in a couple of minutes and trust is a better outcome than an exhaustive one that buries
the handful of things that actually need a human decision under a pile of things that don't.

Concretely:

- **Narrative answers** should be as long as the funder's own question calls for, not as long as
  everything the source documents happen to say. Default to roughly 100–200 words per funder question (a
  short paragraph or two) even when the sources could support much more; only go longer if the funder's
  own template asks for it (e.g., a field with a 3,000-word limit). Cite the one or two figures that most
  directly answer the question rather than every related figure you found — a secondary stat or anecdote
  that isn't needed to answer what's asked simply doesn't need to appear in the narrative at all.
- **Missing Source Materials and Inconsistencies Found** should give routine or low-stakes items one
  line each, or group several into a single bullet, and save multi-sentence write-ups for the few items
  that genuinely need a human decision. See the length guidance in
  `references/inconsistency-and-citations.md` for specifics.
- **The whole document** — narrative excluded — a finished draft's QA sections (Missing Source Materials
  plus Inconsistencies Found) should usually fit in well under a page. If they're running longer, that's
  a sign to group and compress, not a sign the report needs more rigor.
- If a draft is running long, stop before delivering it and cut: merge similar bullets and drop secondary
  detail that isn't strictly needed to answer the funder's question rather than including it just because
  it's sourced.

This doesn't relax the standards elsewhere in this skill — every fact still needs a source, every real
inconsistency still gets flagged, and every gap still gets an honest `[NEEDS INPUT]`. It just means each
of those gets stated once, plainly, and briefly, rather than explained at length.

## Run to completion in one pass — don't stop to ask

Produce one complete rough draft per request, start to finish, without pausing mid-task to ask the user
clarifying questions — including for a funder or grant with no reporting history yet. The whole point of
this skill is to hand back a finished (if imperfect) draft that speeds up the human's work; a skill that
stops partway through to ask a question makes the human do the work of answering before they even have a
draft to react to, which defeats the purpose. Pull everything you can from Google Drive (or whatever
connector is available) and make the most reasonable, best-supported call on anything genuinely
ambiguous, then say so in the draft itself.

Every mechanism you need to handle uncertainty without asking already exists in this skill: `[NEEDS
INPUT: ...]` and `[NEEDS VERIFICATION: ...]` placeholders (see "Handling gaps" below), the **Missing
Source Materials** note, and the **Inconsistencies Found** section. Use those instead of a question. A
reviewer reading a finished draft with five honestly-marked gaps is in a better position than a reviewer
who got interrupted five times before any draft existed. The only exception is a standing policy decision
that would change how *every future report* gets built (the kind of thing that belongs in this SKILL.md
file itself, not a one-off in-conversation question) — that's worth surfacing once so it can be written
down here permanently, rather than re-asked on every run.

## Before drafting: figure out which funder and which report

Infer from context which funder this report is for, what type of report it is (final, mid-year,
quarterly/QPR), and its due date if known — the user's request plus a quick Drive search (tracking data,
recent report titles) is almost always enough. Only ask if genuinely nothing indicates which grant is
meant. If a dedicated skill exists for this funder (check the
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
   from the most recent report for this funder if no separate template exists. Prefer the *literal*
   question numbers and text from the funder's actual form (the portal, or the exact Q&A structure a
   prior report used) over any summary or outline of it — see "Match the funder's real question numbers"
   under Step 3.
7. **Any direct communication from the funder about this specific report** (an email, a portal message,
   a note from the contact) — search for it explicitly. When a due date, a scope question, or anything
   else conflicts between an internal tracking sheet and a dated communication from the funder, the
   funder's own communication is the more authoritative source; say so when you use it.

### Two fixed references — open these by link every time, not by search

Unlike the documents above, these two aren't something to search for — they're fixed, actively-maintained
references the Launchpad team keeps current, and every draft should check them regardless of funder:

- **Launchpad Programming MASTER** (Google Doc):
  `https://docs.google.com/document/d/1YYEsi0PWm0oCtKAG_8jyQuP2PFEOhovnFroxkVeJ-WI/edit` — the current,
  actively-updated language for how Launchpad's programs should be described. The Launchpad team revises
  this doc as program language changes, so it is more current than however a prior report happened to
  phrase things. Open it before drafting the narrative and align program names and descriptions to what's
  currently there — see "Match Launchpad's current program language" in
  `references/literal-style-guide.md`.
- **Quote Bank** (Google Sheet):
  `https://docs.google.com/spreadsheets/d/1Yuj3jvp0095TvmRLU61-W6ChdcFuM2DWHDwnVT0X3uc/edit` — a running
  collection of quotes from students, clients, and employers. Check it when a narrative question calls for
  a direct quote or qualitative voice — see "Using the Quote Bank" in `references/literal-style-guide.md`.

Before declaring anything missing, verify it properly: open the folder a tracking record or prior report
points to and actually list what's inside it, rather than trusting a folder title or a quick glance at
its metadata. A folder named, say, "2024–2026 Grant Agreement" can still contain the signed document even
when a first pass suggests it's empty — don't report a folder as containing no files without having
actually listed its contents. If a document search comes up empty, do at least one broader pass (funder
name alone, parent and sibling folders, a prior year's naming convention) before concluding it isn't in
Drive at all.

If, after a real search, something still can't be found, say so explicitly rather than proceeding as if
the gap doesn't exist — list what's missing at the top of your draft under a **Missing Source Materials**
note, since a human may know exactly where to find it even if a Drive search didn't surface it. Word this
plainly rather than alarmingly: a document like a signed agreement may simply not have been created or
filed yet by whoever internally owns that step, rather than implying something was lost — name the likely
internal owner if the tracking data or org context makes it obvious, but don't stop the draft to ask who
that is (see "Run to completion in one pass" above). Don't manufacture urgency the evidence doesn't
support.

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

Read `references/inconsistency-and-citations.md` for the full process, including how to keep this section
short. In short: compare funding amount, dates, deliverables, and any conditions between the application
and the signed agreement, and produce an **Inconsistencies Found** section — even if the answer is "none
found." This goes at the very top of the draft, before any narrative. Keep it to one line per item by
default (see the reference file for exactly when a longer write-up is warranted), and roll every clean
check into a single "no inconsistency found on: ..." line rather than one paragraph per thing that checked
out fine.

### Confirm what the grant actually funds — don't assume it's general operating support

Read the agreement's own scope and restriction language before drafting anything. Some grants fund
Launchpad broadly, but plenty are restricted to one specific program or initiative — for example, a
Lenfest grant that funds Northten specifically, not Launchpad's programming as a whole. Check both the
application and the signed agreement for scope language, and treat the agreement's wording as authoritative
if the two differ on scope, the same way you would for funding amount or dates.

Record the confirmed scope in the **Applicable Initiative** field of the Grant Report Overview table
(Step 5), cited to the specific line in the agreement that establishes it — not just copied from whatever
label the tracking sheet happens to use. Then carry that scope forward into Step 3: every fact, figure,
and outcome pulled into the narrative has to actually belong to the funded program, not to Launchpad's
programming generally. If the agreement's scope language is genuinely ambiguous — it doesn't clearly say
whether a given program or cohort is covered — resolve it with the most literal reading available and flag
your reading as a row in Inconsistencies Found, rather than guessing silently or pausing to ask.

Not every mismatch is a genuine open question. Some drift between the application and later records is
routine and expected rather than a discrepancy a human needs to resolve — the clearest example is grant
period dates: the application's proposed start date is essentially never the date the signed agreement
actually starts on, since timelines shift during negotiation. Report the agreement's dates as the
authoritative grant period, sourced to the agreement, without presenting the application's original date
as an unresolved conflict. The same applies to portal login credentials that changed because of normal
staff turnover — use the current, currently-active credentials from the tracking record as the answer, and
don't carry a stale username forward as an open "Inconsistencies Found" row when a current record already
exists. Read `references/inconsistency-and-citations.md`'s "Expected drift vs. genuine inconsistency"
section for more on where to draw this line.

## Step 3: Extract literal facts and draft the narrative

Read `references/literal-style-guide.md` before writing a single sentence of narrative — it's the
constraint that makes this skill worth using instead of a generic writing assistant, and it includes
concrete before/after examples, including for length. Literal and long are not the same thing: a single
well-sourced sentence beats three sentences that restate the same fact from different angles.

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

### Stay inside the grant's funded scope

Before pulling any figure into the narrative, confirm it belongs to the program or initiative this grant
actually funds (see "Confirm what the grant actually funds" under Step 2) — not to Launchpad's programming
generally. A grant restricted to one specific program should never be reported using Launchpad-wide
enrollment, outcome, or activity figures just because they were easier to find or more flattering; if
you're not sure a figure is in scope, don't use it, and note the gap instead.

### Match Launchpad's current program language

Before drafting, open the **Launchpad Programming MASTER** doc (see the "Two fixed references" list under
Step 1) and use it as the authority on how to name and describe Launchpad's programs. This doc is actively
revised by the Launchpad team, so its terminology can be more current than the language used in a prior
report or even in the grant agreement itself — when a prior report's program name or description conflicts
with what's currently in the MASTER doc, use the current MASTER doc language in the narrative and don't
silently carry forward outdated phrasing just because that's what an earlier report used.

### Using the Quote Bank

When a narrative question calls for qualitative voice — a lessons-learned answer, a specific participant
experience, anything that would benefit from a direct quote rather than a statistic — check the **Quote
Bank** spreadsheet (see Step 1) for a relevant quote from a student, client, or employer before deciding
none exists. Cite any quote used the same way you'd cite a figure (see Step 4). Never invent or
paraphrase a quote that isn't actually in the Quote Bank or another source document.

### Match the funder's real question numbers — don't invent your own

The three core elements above are a guide to *what content to cover*, not a numbering scheme to lay on
top of the funder's actual questions. Use the literal question numbers and text from the funder's real
report form (the submission portal, a template doc, or the exact Q&A structure a prior submitted report
used) as section headers, verbatim. A draft that invents its own sequence — splitting one of the funder's
questions into "Questions 2–3," or relabeling a later question as "Question 4" or "Question 5" because
that's where it happened to fall in Launchpad's three-element outline — misrepresents the actual form and
is confusing to a reviewer trying to check it against what's actually being asked. If several of
Launchpad's core elements belong under a single funder question, keep them under that one question number
— don't split it into a range or invent a step in between. If you can't find the funder's literal
numbered question list, say so plainly and use a clearly-labeled generic structure instead (see "Handling
a brand-new grant" above) rather than guessing at numbers that look official.

### Answer only what's asked — don't paste in internal tracking tables

The funder's questions are narrative questions, not a request for Launchpad's internal tracking data.
Launchpad's own feedback on early drafts of this skill was direct: a full per-cohort enrollment
breakdown table (phase, cohort start date, enrolled, completed, completion %) got marked "do not
include" — not because any specific phase was out of scope, but because it's internal tracking detail the
funder didn't ask for and that "the formatting on websites is weird... just give data they are asking,
not extra." Treat this as a general rule, not a one-off: don't drop a full tracking-spreadsheet-style
table into the submittable narrative. Instead, answer the actual question in prose, citing the specific
figures that answer it (e.g., "142 unique young people enrolled across the grant term, with the Launchpad
101 shortfall concentrated in three cohorts of 27, 35, and 11 students") rather than reproducing the whole
underlying table the figure was pulled from. The full breakdown still belongs somewhere — put it in a
clearly-marked internal-only appendix (see Step 4), still cited inline the same way as everything else, so
it stays traceable without cluttering what actually goes to the funder.

This also resolves most apparent "which phase counts" ambiguity: since you're citing only the specific
figures that answer the funder's actual question (usually tied to a specific milestone or result-statement
line), you rarely need to decide in the abstract which of Launchpad's program phases (Foundations,
Launchpad 101, Lightspeed, LiftOff, etc.) are "in scope" — the milestone or question being answered tells
you which figure is relevant. If a genuine scope question remains (the milestone's own wording doesn't
say which phase it covers), resolve it with the most literal reading of the milestone/result-statement
language and flag your reading in Inconsistencies Found rather than pausing to ask.

### Handling multiple drafting passes left in the same working document

Launchpad's working narrative docs sometimes contain more than one labeled drafting pass of the same
answer left in the document (e.g. a "Version 1" and "Version 2" of the same section). Don't stop to ask
which to use: default to the most recently edited passage as the primary source for that section, and
check the earlier passage for any figure that materially conflicts with it. A real conflict (not just
different phrasing of the same fact) gets a row in Inconsistencies Found, same as any other numbers-that-
don't-match case (see `references/literal-style-guide.md`) — but the earlier passage is not itself
grounds to pause the draft.

### Verify time-sensitive details before presenting them as current

Staff rosters, team headcounts, and similar "as of today" facts go stale between report cycles — a
document in Drive may not reflect a role added or changed since it was last updated. When a narrative
answer states current staffing, partner counts, or similar point-in-time facts, note the source and its
date so a reviewer can judge whether it's still accurate — don't present a Drive document's staff list as
necessarily reflecting who's on the team today, but don't hold up the draft over it either.

## Step 4: Cite every fact inline, as you write

Read `references/inconsistency-and-citations.md` for the exact format. There is no separate Sources table
at the end of the document — every specific number, percentage, quote, or outcome claim gets its citation
as a hyperlink attached right where the fact appears (an Overview table cell, an Inconsistencies Found
line, a sentence in the narrative), pointing directly to the source document. A reviewer should never have
to leave the sentence they're reading and scan a separate table to find out where a number came from.

If a detailed backing table exists (e.g., the full per-cohort enrollment breakdown behind an aggregate
figure used in the narrative — see "Answer only what's asked" under Step 3), it belongs in a clearly-marked
internal-only appendix, itself cited inline from wherever the aggregate figure is used — not reproduced in
the submittable narrative and not collected into a lookup table.

## Step 5: Assemble and deliver one draft document

Produce a single **native Google Doc**, created directly through the Drive connector — never a PDF, never
a `.md`/plain-text file, and never markdown table syntax (`| like | this |`) pasted in as text. Every table
in the doc (the Grant Report Overview table, and any other tabular section) must be an actual native
Google Docs table, inserted as a table, not typed out as pipe-delimited text — this is what makes every
draft look and behave the same regardless of who ran the skill or which funder it's for. Contents, in this
order:

1. **Grant Report Overview** — a single reference table (see field list below), each Detail cell carrying
   its own inline source link
2. Missing Source Materials (if any)
3. Inconsistencies Found, each item's source(s) linked inline
4. Narrative draft, structured to match the funder's actual report questions/template (see "Match the
   funder's real question numbers" under Step 3), in prose — not internal tracking tables (see "Answer
   only what's asked" under Step 3) — with every cited fact linked inline to its source as it appears
5. Internal-only appendix, if a detailed backing table is needed (see Step 4) — clearly marked as not
   part of the submittable report

### Grant Report Overview table fields

Build this from the grant tracking data (Step 1, item 4) plus the agreement. Every field's Detail cell
should carry its own inline hyperlink to the specific document it was pulled from (see Step 4) — the table
itself is the reference point a reviewer starts from, so it can't depend on a separate citation section to
be trustworthy.

- Due Date, Funder, Contact, Funding Amount, Report Submission Site, User Name, Password, Submitted
  Proposal — straightforward pulls from the tracking record.
- **Applicable Initiative** — the specific program or initiative this grant actually funds, confirmed
  against the agreement's scope language, not just copied from a tracking-sheet label (see "Confirm what
  the grant actually funds" under Step 2). Link to the specific clause in the agreement that establishes
  it.
- **Reporting Requirements / Contract** — sourced from the signed agreement. If it can't be located, see
  the missing-document guidance in Step 1 (it may just not be filed yet).
- **Summary of funder's strategic priorities and how this report addresses them** — source this from the
  grant agreement first, not a generic page of the funder's published priorities. The agreement is what
  lists the outcomes Launchpad actually committed to and is the more direct answer to "how does this
  report address the funder's priorities" — a link to the agreement is sufficient citation here.
- **Context on prior communications with the funder** — a single field covering both any dated record of
  past conversations and anything more recent/informal (don't split this into a separate "Recent
  Conversations" row; fold it in here). Launchpad doesn't yet have a firm internal practice for logging
  funder communications, so it's expected this will sometimes come up empty — note that plainly ("no
  standardized record of funder communications exists yet") rather than treating it as a hard blocking
  gap the way a missing financial figure would be.
- **Plans for ongoing engagement and future asks** — e.g., a follow-on application already submitted.
- **Other** — anything else relevant (e.g., which numbered report this is in the sequence for this grant).

When login credentials differ from a prior report (e.g., after a staff transition), use the current,
active credentials from the tracking record as the answer rather than flagging the change as an
unresolved inconsistency — see Step 2.

Title the doc clearly, e.g. "[Funder] [Report Type] Draft — [Due Date]", and place it in the same Drive
folder as the funder's other reporting documents if one is identifiable. This is a first draft for a
human to review and edit before submission — say so in a short note at the top of the doc, and don't
try to make it submission-ready by, e.g., inventing polish the source data doesn't support.

As a rough sanity check before delivering: the narrative draft (item 4 above) typically runs 800–1,500
words for a full final report, less for a quarterly update, and the combined Missing Source Materials +
Inconsistencies Found sections (items 2–3) usually fit on well under a page. If your draft is running
noticeably longer than that, revisit "Keep it concise" above before sending it — look for restated
figures, one-paragraph write-ups of things that checked out fine, or narrative detail the funder's
question didn't actually ask for.

## Handling gaps

If a narrative question can't be answered from the available source documents (no data found, or found
data doesn't clearly answer what's being asked), write the question with a placeholder like `[NEEDS
INPUT: ...]` describing exactly what's missing, rather than guessing or writing around it. A visible gap
is far more useful to a reviewer than a plausible-sounding sentence with nothing behind it.
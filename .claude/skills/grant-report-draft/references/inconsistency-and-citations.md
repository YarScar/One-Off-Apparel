# Cross-Checking and Source Citations

Two of Launchpad's explicit requirements live here: catching mismatches between what was promised and
what was signed, and making every stat traceable back to where it came from. The cross-check gets built
into the top of the draft doc, before the narrative — the human reviewer should see it first, since it may
change what gets written below. Citations, by contrast, travel with each fact wherever it appears in the
doc — there is no separate citations section to build.

The **Inconsistencies Found** section covers more than just the application-vs-agreement check below —
it's the single place for *any* conflict you notice between source documents while assembling this
report: a figure that differs between a prior report and the current tracking sheet, a target in the
application that doesn't match what was actually enrolled/delivered, two financial documents that don't
reconcile, and so on. The application-vs-agreement check is required on every report because it's the
most consequential mismatch (it can affect what's owed or promised), but don't treat it as the only kind
of inconsistency worth flagging — anything that doesn't line up between two sources belongs here.

## 1. Application vs. agreement cross-check

The grant application (the pitch/proposal Launchpad submitted) and the grant agreement (the signed
contract from the funder) sometimes drift apart — the funder may have approved a different amount,
timeline, or set of deliverables than what was originally proposed. Reports need to reflect what was
actually agreed to, not what was originally pitched, so this mismatch has to surface before anyone
drafts outcome language.

For every report, read both documents side by side and check at minimum:

- Funding amount (does the agreement match the application's ask?)
- Grant period / dates (start, end, reporting deadlines)
- Stated deliverables, milestones, or metrics the grant is meant to produce
- Any conditions or restrictions on how funds can be used
- Named contacts or reporting requirements
- **Program/initiative scope** — does the agreement restrict funding to one specific Launchpad program
  (e.g., Northten) rather than Launchpad's programming generally, and does that match what the application
  proposed and what the tracking record's Applicable Initiative field says? A scope narrowing between
  application and agreement (or an ambiguous scope in either) is exactly the kind of thing this section
  exists to catch — see "Confirm what the grant actually funds" in SKILL.md's Step 2.

Build an **Inconsistencies Found** section at the top of the draft. For each mismatch that's genuinely
open — a real conflict with no obvious explanation, the kind covered under "Genuine inconsistencies"
below — default to one line:

> **[Field]:** App says "[X]" ([source]); Agreement says "[Y]" ([source]). Using [X/Y] because [reason].

Reserve a longer, multi-sentence write-up for the rare item where a one-liner genuinely isn't enough for
a human to act on — e.g., a funding mismatch with several plausible explanations that each imply a
different fix. Most items don't need that; resist explaining a finding at length just because you have
the context to do so. A reviewer scanning ten items should be able to tell in a few seconds which ones
actually need a decision from them.

If there are zero inconsistencies, say so plainly in one line ("No inconsistencies found between the
application and agreement on funding amount, dates, or deliverables") rather than omitting the section —
a reviewer should be able to tell the check was actually done, not skipped. The same one-line treatment
applies to every individual item that checks out clean: a "no inconsistency found" result doesn't need
its own paragraph. If several checks all came back clean, fold them into a single line ("No
inconsistency found on: funding amount, special conditions, [etc.] — consistent across application,
agreement, and tracking record") instead of one write-up per item.

### Expected drift vs. genuine inconsistency

Not everything that differs between two documents is an open question for a human to resolve. Two
patterns come up often enough at Launchpad to call out specifically:

- **Grant period dates.** The application's proposed start date and the signed agreement's actual start
  date routinely differ — timelines shift during negotiation, and the application's date is essentially
  never the date the agreement actually begins on. Treat the agreement's dates as authoritative and cite
  them; don't present the application-vs-agreement date gap the way you would a funding-amount mismatch
  (which does need a human decision, since it can affect what's owed).
- **Login credentials / portal usernames.** These sometimes change between reporting cycles because of
  ordinary staff turnover (e.g., a role transitioning from one person to another). As long as the current
  tracking record has an accurate, currently-active username and password, use that as the answer. Don't
  carry a prior report's now-superseded username forward as an "Inconsistencies Found" row — that turns a
  routine handoff into a flag that reads as a real problem. Only raise it if the tracking record itself is
  ambiguous about which credential is current.

Genuine inconsistencies — a funding amount that doesn't match, a deliverable or condition that changed, a
figure that conflicts across independent sources with no clear authoritative answer — still get a row in
this section and are left to the human to resolve. The distinction is whether the difference has an
ordinary, known explanation that resolves it outright (state that explanation in one line and move on)
versus whether resolving it actually requires a judgment call only a human can make (which may warrant
more than one line — see "Keep this section short" below).

An expected-drift item (date shift, credential turnover, or similar) is informational, not a decision the
human needs to make — say what changed and which value you used, in one line, and don't spend a sentence
justifying why it's not a problem. If several expected-drift items come up in the same report, a single
grouped bullet ("Routine, no action needed: [grant-period start date shifted a month during negotiation;
portal username changed after a staff transition]") reads faster than a separate paragraph for each.

### Keep this section short

The point of Inconsistencies Found is to tell a reviewer exactly which few things need their attention —
not to document every check performed. A section with two or three substantive items and a couple of
one-line "checked, no issue" notes is doing its job; a section with a dozen multi-sentence entries, most
of them explaining why something isn't actually a problem, is burying the signal. When you notice the
list growing long, look for entries that can merge (several clean checks into one line) or shrink
(an explained-and-resolved item down to its one-liner) before finalizing the draft.

### Due dates: prefer a direct funder communication over an internal tracker

When a due date (or any other detail) conflicts between an internal tracking sheet and a dated
communication directly from the funder (an email, a portal message, a note from the contact), search for
that direct communication explicitly and treat it as the more authoritative source if you find it — an
internal tracker can go stale between updates in a way a dated message from the funder itself usually
doesn't. Cite the specific communication when you rely on it ("per WPF's [date] email confirming the
report is due August 31").

## 2. Inline source citations — no separate Sources table

Every specific number, percentage, quote, or outcome claim in the draft needs a traceable source, both so
it can be double-checked before submission and so that if someone asks "where did this come from?" six
months from now, the answer is one click away. That last part is the point: "one click away" means an
actual hyperlink sitting right next to the fact, not a text description of a document that a reviewer has
to go find. This applies everywhere a fact appears — the Grant Report Overview table, an Inconsistencies
Found item, and every sentence of the narrative — not just to figures in the narrative body.

**Do not build a Sources table at the end of the document.** Earlier versions of this skill collected
citations into a lookup table separate from the facts they supported; that produced drafts where a
reviewer had to leave the sentence they were reading and scan a different section to find out where a
number came from, and it was also the section most likely to drift out of sync or get skipped entirely
depending on how a given run interpreted the instruction. Citations now travel with the fact itself.

**How to attach a citation inline:**

- State the fact in plain language, then insert a hyperlink on a short cue immediately after it — e.g.,
  `26 of 32 students completed Cohort 3 (81%) [source]`, where `[source]` is a real hyperlink to the exact
  document (and, where the document format supports it, the specific tab, page, or heading — e.g., a
  Google Sheet link with the relevant tab's `gid`, or a Google Doc link to a specific heading).
- In the Grant Report Overview table, the hyperlink lives inside the Detail cell, right after the value it
  supports — not in a separate column.
- In Inconsistencies Found, link each side of a comparison to its own source inline, in the same line as
  the comparison itself (see the `[Field]: App says "[X]" ([source]); Agreement says "[Y]" ([source])`
  format above) — the linked source *is* the citation; there's no additional row to build elsewhere.
- If a stat came from a PDF, screenshot, or other backing document without a shareable link, name the file
  precisely as the link text instead of leaving the citation bare.
- If no source document exists for a number the report needs, do not invent one and do not invent a link —
  use a `[NEEDS VERIFICATION: what's missing]` placeholder in place of the citation, right where the fact
  would have gone.
- If a detailed backing table needs to live somewhere (see "Answer only what's asked" in SKILL.md's Step
  3), put it in a clearly-marked internal-only appendix and link to it inline from the aggregate figure in
  the narrative — the appendix is itself just another cited source, not a return to a central lookup table.

## Why this order matters

Put the Inconsistencies Found section before the narrative draft. A reviewer scanning the doc should see
"here's what doesn't match" before they read the story being told about the grant — and because every fact
in that story carries its own source link as they read it, there's nothing left to verify separately
afterward. That's what makes the draft fast to trust and fast to edit, rather than something that has to
be re-verified from scratch.
# Filling a gap

What to do when the bank has no answer for a funder's question, or the answer it has cannot be
trusted. **Research and draft it now.** Do not stall the draft on a question a person has to answer,
and do not hand back a package with holes in it where research would have closed them.

The one thing you may never do is invent. Filling a gap is a research task with a provenance
requirement, not a licence to write something plausible.

## The four gap classes

`prep.mjs` reports these. Each has a different fix.

| Class | What it means | Fix |
|---|---|---|
| `no_kb_answer` | The matched bank entry has no `kb_ref`, or the slot is absent from the KB. | Research and draft a candidate. |
| `kb_unverified` | The slot exists with `verified:false`. It is a **true unknown**, not a weak answer. | Research and draft a candidate. Never present the stored text as confirmed. |
| `low_confidence` | The matcher scored below 0.42. The routing is a guess. | **Re-route first.** Confirm the mapping by hand before you research — you may already have a good answer under a different slot. Only research once you have confirmed nothing fits. |
| `unmatched` | No bank entry at all. | Research and draft a candidate. |

`low_confidence` is the one that gets mishandled. Researching a fresh answer for a question the KB
already covers wastes the work and risks contradicting filed material. Check the routing first.

## The source ladder

Work down it. Stop when a rung settles the question. Rung 3 is the highest-yield and the most often
skipped: for most questions, someone at Launchpad has already written a good answer for another funder.

1. **Live platform data** — the `query_*` and `get_*` MCP tools. Authoritative for anything
   operational or financial. Any figure in the answer must come from here or be flagged.
2. **Internal documents and conversations** — `search_documents`, `search_conversations` (Drive docs
   and Notion meeting transcripts in pgvector).
3. **Prior filed applications** — the grant corpus. Someone has probably answered this question.
   The production path is `find_grant_documents` to locate the file, then
   `get_grant_document_text` to read it:
   ```bash
   find_grant_documents({ doc_kind: "application_response", ... })
   get_grant_document_text({ drive_file_id: "<from the row above>" })
   ```
   `get_grant_document_text` extracts Google Docs/Slides and .docx/.dotx today; other text-bearing
   types come back `not_yet_implemented`. On a dev machine with the local mirror present,
   `corpus_search.py` can grep it directly, but it is a dev-only fallback, not the source of
   truth — the server has no `data/Grants` tree:
   ```bash
   python3 .claude/skills/grant-writing/scripts/corpus_search.py "current/recent funders"
   ```
   Prior filed material is treated as real per staff direction, but **every figure in it is stale
   until re-verified** and every named entity is unconfirmed until traced. Prefer the newest source;
   see the recency order in `kb_launchpad.json` `meta.source_recency`.
4. **The Notion research wiki** — labor-market and sector evidence for need statements. Database
   `33779abd-443f-8075-8a47-000b973f8eba`. Cite specific data points.
5. **The funder's own material** — their site, 990s, recent grantees, guidelines. Use for alignment
   and eligibility questions, which are funder-specific by nature and will never be in the KB.
6. **Ask staff** — the last rung, for what research genuinely cannot settle.

## What still goes to a person

Research does not resolve these, and a candidate must not paper over them:

- **Dollar amounts.** The request amount, the total project cost, the match. Always ask.
- **Framing choices.** Which programs to tee up, workforce vs education positioning, and the
  fiscal-sponsorship framing. Ask every time.
- **Unconfirmed entity names.** If research surfaces an employer, client, or partner you cannot trace
  to a confirmed current relationship, the name does not go in. See `style.md`. This is the rule that
  gap-fill research is most likely to break, because an old document will happily supply a name.
- **Definitional figure conflicts.** Two correct numbers counting different populations. Escalate with
  both.

## The candidate record

A researched answer is a **candidate**, not knowledge. It never gets written into
`seed/kb_launchpad.json`, because `verified:true` there means grounded in filed material and a
candidate is not. Candidates live in their own worksheet:

```bash
# Generate the worksheet from a form's gaps
node .claude/skills/grant-writing/scripts/gapfill.mjs <form-id-or-path> --out candidates.json

# Validate once you have filled in `answer` and `sources`
node .claude/skills/grant-writing/scripts/gapfill.mjs --validate candidates.json
```

Every record carries:

| Field | Requirement |
|---|---|
| `answer` | The drafted text. Must satisfy `style.md` and fit the funder's limit. |
| `sources` | **At least one.** Each is a ladder rung plus the specific artifact: a tool call and its `asOf` date, a corpus file path, a wiki entry, a URL. An answer with no source is not a candidate; it is a guess. |
| `verified` | Always `false` on creation. Only a person reviewing it can change that. |
| `needs_staff` | What a person still has to confirm, in words. Empty only if genuinely nothing. |
| `gap_class` | Carried through from `prep.mjs`, so a reviewer knows why this was written. |

`--validate` enforces the mechanical parts: non-empty answer, at least one source, `verified:false`,
within limit, no em dashes, no banned jargon.

## Promotion is a human action

A candidate becomes a KB answer only when a person reviews it and edits
`seed/kb_launchpad.json` deliberately. Nothing in this skill writes to that file. The reason is the
rule in `README.md`: `verified:false` is a true unknown, and an automated promotion path would turn
every researched guess into apparent confirmed fact one cycle later.

## Present the gaps, do not bury them

When handing off, list every candidate separately from the KB-backed answers, with its sources and its
`needs_staff` note. A reviewer needs to know which answers came from established material and which
were written this session from research. Those get read differently, and should.

# Playbook change proposal

| Field | Value |
|---|---|
| Subject | Reconciling `docs/PLAYBOOK.md` against `TAD.md` now that the draft pipeline (G1–G4) is built |
| Prepared for | Iman |
| Date | 2026-08-25 |
| Status | For review |
| Covers | WP #66 (C2), folding in WP #65 (C1, superseded) and WP #63 (B7, superseded) |

**What this is.** Three places where `docs/PLAYBOOK.md` and `TAD.md` disagree or are incomplete,
each proposed as a correction, an addition, or a promotion. `HANDOFF.md`'s 2026-07-28 flag 4
deliberately deferred all three ("build the pipeline first, then assess") — the pipeline is now
built (G1–G4 passed, three tools registered), so the deferral is over and each needs a call.

Also folds in the 2026-07-29 feedback on the earlier playbook draft: *"Likes non-negotiables. Not
enough information per step."* — addressed in item 3.

---

## 1 — Promotion: two Playbook rules move up into `TAD.md` §3

**Both are correct and already followed.** `HANDOFF.md` flag 4 named these as stronger than
anything in `TAD.md` §3 and recommended promoting rather than weakening either. Recommend doing
that now rather than leaving them Playbook-only, since `TAD.md` §3 is what the platform's data
governance rules are audited against — a rule that lives only in the Playbook has no equivalent
of `data.test.ts` holding it in place.

**1a. Never name an entity that cannot be traced to a confirmed current source.**
Source: `docs/PLAYBOOK.md` non-negotiables, first bullet. Add as `TAD.md` §3.7. This is stricter
than anything currently in §3 — none of 3.1–3.6 addresses named entities (employers, placement
sites, partner orgs, people) at all, only figures.

**1b. Ask the fiscal-sponsorship framing every time — never assume.**
Source: `docs/PLAYBOOK.md` Step 3 ("Also settled here...") and the CLAUDE-skill section
("ASK EVERY TIME"). Add as `TAD.md` §3.8. Note `cover.fiscal_sponsor` already carries
`initiative`/`fiscal_sponsorship` variants since WP #320 (2026-08-21) — the rule is enforced in
code at the KB-slot level; this promotion makes it a documented data-governance rule too, not just
an implementation detail.

**Action:** add §3.7 and §3.8 to `TAD.md`, each citing `docs/PLAYBOOK.md` as source, matching the
format of 3.1–3.6. No change to the Playbook text itself — it already states both correctly.

---

## 2 — Correction: resolve the write-path conflict (closes C1 / WP #65)

**The conflict.** `docs/PLAYBOOK.md` "How to start" has Claude *create* a Grant Applications
record (status Researching); "When done" has Claude *update* it (amount, framing, draft link).
That's a write path. It runs against `TAD.md` control 6 (§2.2 — "no send path... the layer
produces drafts only") and against `readOnlyHint: true` on all three registered tools
(`grant_match_question`, `grant_build_draft`, `grant_resize_answer`). **No write tool exists in
the platform today** — nothing in `apps/mcp-server/src/tools/` writes to Notion.

**Recommendation: drop the create/update steps from the automated flow.** Do not sanction a write
tool. Reasons:
- The pipeline now built (G1–G4) proves the whole draft path works with zero write capability —
  nothing about `grant_build_draft` or `grant_resize_answer` needed one.
- A Notion-write tool would need its own `tool_permissions` row, its own audit line, and
  `readOnlyHint: false` — a materially bigger surface than "record-keeping," and outward-facing
  (it changes Notion state a person didn't directly initiate).
- Record-keeping (create on start, update on completion) is a two-minute manual step for whoever
  is running the session (Iman, Chip, or Dannyelle) and does not benefit from automation the way
  drafting itself does.

**Correction to `docs/PLAYBOOK.md`:**
- "How to start" — reword from *"Claude creates a record..."* to *"Claude prompts staff to open a
  new record in the Grant Applications database with status Researching, then works the steps in
  order."*
- "When done" — reword from an implicit Claude action to *"Staff update the Grant Applications
  record: amount requested, type, deadline, framing, themes, pathway, and the draft link. Move
  status from Researching to Drafting."*

**Acceptance for C1, closed by this correction:** a decision is recorded (`TAD.md` §5 gets a new
decision row — see below), and `HANDOFF.md` flag 4's write-path half is closed.

**`TAD.md` §5 addition:**

| # | Decision | Rationale | Revisit when |
|---|---|---|---|
| 8 | No Notion write path. The Playbook's create/update steps are staff actions, not a Claude tool call. | The built pipeline (G1–G4) needed no write capability; a write tool would need its own ACL row, audit line, and `readOnlyHint: false` — a bigger, outward-facing surface for a two-minute manual step. | If record-keeping becomes a real bottleneck across many concurrent applications. |

---

## 3 — Correction: reconcile the wage-figure conflict (closes B7 / WP #63)

**The conflict.** `docs/PLAYBOOK.md`'s non-negotiables cite *"the stale $550K vs. current $300K
wages"* as a worked example. `TAD.md` §3.2 documents the same claim with different, since-updated
numbers ($350,268 filed vs. $362,361.82 live as of 2026-07-28) — and states plainly that the
figure changes daily. Both documents are now stale relative to each other and to today's live
number, which is exactly the trap §3.2 warns about.

**Recommendation: remove the fixed dollar figures from the Playbook example entirely.** Don't
replace $550K/$300K with a fresher pair of numbers — any fixed pair will be stale again within
days, per §3.2's own math ($331.56/day). State the rule, not a snapshot:

**Correction to `docs/PLAYBOOK.md` non-negotiables**, replacing the parenthetical:
> Reconcile conflicting figures across docs BEFORE drafting — a stored wage total is never
> current (it moves daily as jobs accrue earnings; see `TAD.md` §3.2) — and use the live
> `query_*` result, not a figure quoted in any reference file, prior filing, or this Playbook.

This is consistent with the Playbook's own stronger rule two bullets below it ("Participant and
program figures are always fetched live, every time... no staleness threshold") — the worked
example was contradicting the rule it was meant to illustrate.

**Acceptance for B7, closed by this correction:** one sourced statement of the rule replaces two
conflicting snapshots; `docs/PLAYBOOK.md` and `TAD.md` §3.2 no longer disagree, because neither
states a number to disagree about.

---

## 4 — Addition: more information per step (2026-07-29 feedback)

Feedback on the earlier playbook draft: *"Likes non-negotiables. Not enough information per
step."* The non-negotiables section is dense and specific (good); Steps 1–4 are comparatively
thin. Proposed additions, each a short procedural note appended to the existing step — not a
rewrite:

- **Step 1 (Research):** name the two platform tools that do this automatically once the pipeline
  is used — `search_documents` (scoped to Notion/Drive) for prior history, `find_grant_documents`
  for prior filed material — so "research" isn't read as manual browsing when a tool call is
  faster and logged.
- **Step 2 (Positioning):** note explicitly that this step happens *before* Claude drafts anything
  structured — Iman's Criteria + Positioning section is an input to `grant_build_draft`'s
  `program`/`framing` fields (enforced since WP #320: drafting is now gated on both being set,
  not optional).
- **Step 3 (Program + framing):** cross-reference the fiscal-sponsorship promotion in item 1b
  above, so the "ask every time" rule and the step that asks it live in both documents
  consistently.
- **Step 4 (Prior grants):** note that `grant_build_draft`'s figure work order names the exact
  `query_*` tool and arguments for each figure claim — Step 4 selects which *prior applications*
  to draw from, not which *live figures*; that split was implicit and is worth stating so a
  drafter doesn't try to pull a number from a prior application instead of the work order.

---

## Summary for Iman

| # | Type | What changes | Where |
|---|---|---|---|
| 1a | Promotion | Entity-naming rule moves into `TAD.md` | `TAD.md` §3 (new §3.7) |
| 1b | Promotion | Fiscal-sponsor framing rule moves into `TAD.md` | `TAD.md` §3 (new §3.8) |
| 2 | Correction | Drop Claude-as-writer for the Grant Applications record; staff do it | `docs/PLAYBOOK.md` "How to start" / "When done"; `TAD.md` §5 (new decision 8) |
| 3 | Correction | Remove stale wage-figure example; state the live-precedence rule instead | `docs/PLAYBOOK.md` non-negotiables |
| 4 | Addition | Short procedural notes on Steps 1–4, cross-referencing the built tools | `docs/PLAYBOOK.md` Steps 1–4 |

Once approved, `TAD.md` and `docs/PLAYBOOK.md` are edited together in one change (per the
platform's documentation rule — a correction to one document must reconcile every other document
it falsifies), `HANDOFF.md` flag 4 is marked closed with a pointer to this document, and
`CHANGELOG.md` gets an entry.

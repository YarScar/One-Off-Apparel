◆ FINDING — Structural code-quality regressions

1. ✅ DONE (WP #330, 2026-08-24) — A safety-critical figure-verification check is silently broken by a magnitude-suffix blind spot. packages/grants/src/verify.ts:59-67 re-normalizes drafted figures through figures.ts's extractNumericClaims, whose regex has no [MKB] suffix arm — "$1.34M" → ["1.34"]. It then checks whether the live finance query (which will contain 1340000, never 1.34) contains that token. It essentially always fails on exactly the shape of figure (annual_budget, the KB's own worst-drift example) it exists to catch. A verification check that reliably false-alarms on correct figures is worse than no check — it trains reviewers to ignore it. Fixed via `expandMagnitudeSuffix` in `figures.ts` + a fallback comparison in `verify.ts`; 2 regression tests added.

2. data.ts ↔ figures.ts/slots.ts/matcher.ts have an import-evaluation-order invariant enforced only by a comment, not the type system (data.ts:21-25). buildFigureWorkOrder (figures.ts:626) loads the KB itself instead of taking it as a parameter — the one inconsistency with the otherwise-correct computeIntegrityReport(bank, kb) pattern. Fix is mechanical: make it take kb as a param.

3. ✅ DONE (WP #330, 2026-08-24) — Two philosophically opposed "grant writing" tools are both live with no runtime signal for which is canonical. skill_grant_writing (freehand query_* + prose-guarded drafting) and the deterministic grant_build_draft/grant_match_question/grant_resize_answer/grant_verify_figure pipeline coexist. packages/grants/CHANGELOG.md documents they're intentionally distinct, but nothing in the tool description or make-server.ts tells a caller the deterministic path is the one meant to prevent fabrication — the exact risk the pipeline was built to close is one tool-call away. Fixed: both tool descriptions now state precedence explicitly (`skill-grant-writing.ts`, `grant-build-draft.ts`).

4. find-grant-documents.ts bypasses the two shared conventions that exist specifically to prevent its own defect class. No clampLimit() (its limit has no lower bound/finiteness guard — 0, negative, or NaN reach Prisma raw), and no resultEnvelope() ({ total_matching, returned } instead of the platform's record_count/truncated/limit shape). result-envelope.ts's own docstring cites this exact bug class by work-package number.

5. ✅ DONE (WP #330, 2026-08-24) — The local (grant-writing) skill's Step 0 points at a dead data path. It tells the reader to use search_documents → document_chunks for prior filings, but document_chunks is empty for every source in production — and the skill's own references/gap-fill.md, one step later, already has the correct find_grant_documents → get_grant_document_text chain. A session following the skill top-to-bottom hits the dead path first. Fixed: Step 0 and the Step 1b rung-3 pointer in `.claude/skills/grant-writing/SKILL.md` now both point at `find_grant_documents` → `get_grant_document_text`.

◆ FINDING — Missed code-judo simplifications

6. ✅ DONE (WP #330, 2026-08-24) — buildAnswer in pipeline.ts:449-691 duplicates ~140 lines of state-machine logic between its structured-value and narrative-value branches (same gate → measure → needs_expand/fits/needs_resize sequence, twice). A single resolveTextAnswer(candidateText, {...}) helper called twice would collapse it — and would have prevented the documented incident where a guard (underfillsProseField) was fixed on one branch and had to be separately re-added to the other. Fixed: extracted `resolveTextAnswer()`; this also surfaced and fixed a real bug — the structured branch was silently dropping the compression-infeasible warning (see #7, #25). New structured-value `compression_infeasible` test added to `pipeline.test.ts`.

7. ✅ DONE (WP #330, 2026-08-24) — The same "compression infeasible" warning sentence is hand-duplicated in pipeline.ts:681-685 and resize.ts:510-516 (resize.ts already has it correctly factored as infeasibleRule) — exactly the kind of cross-tool guardrail text the module's own philosophy says must never drift between tools. Fixed: exported `infeasibleRule` from `resize.ts`; `pipeline.ts` now calls it via `resolveTextAnswer()` (#6).

8. FIGURE_CHECKS (figures.ts:108-463, 350 lines) is a hand-edited content registry living as TS source, unlike every other content asset in the package (kb_launchpad.json, questions.json are schema-validated seed JSON). Every figure correction shows up as a code diff instead of a data diff, and it's invisible to the integrity-report discipline the rest of the package follows.

9. computeIntegrityReport (data.ts:234-671) is one 438-line function running 13 fully independent checks with identical boilerplate. Should be 13 named functions reduced over with .flatMap — independently testable, no longer straining a 661-line test file to exercise every path.

10. ~900 lines of pure prose live inside TS template literals in prompts/grant-prospecting.ts (552 lines) and prompts/grant-writing.ts (422 lines) — content that never benefits from type-checking but must round-trip through tsc/ESLint on every build. The skill directory already proves the fix pattern exists (.claude/skills/grant-writing/references/*.md).

11. Three skill-tool wrappers (skill-grant-writing.ts, -prospecting.ts, -sourcing-evaluation.ts) hand-duplicate identical prompt-message-flattening boilerplate — a single registerPromptAsTool() helper would collapse ~194 combined lines to near zero bespoke code.

◆ FINDING — Spaghetti / branching complexity

12. catalog.ts's classify() doc-kind override (:318-336) reverses its own stated "folder wins" precedence rule, but only for one specific folder-derived value ('application_response') and only for two specific filename kinds — reads as a patch for one observed case, not a designed rule.

13. buildAnswer's branch-ordering contract is asserted three times in prose ("branch order is load-bearing") but enforced by nothing but sequential if/return statements — a reorder would silently break it, catchable only if a test happens to cover that exact interaction.

14. prep.mjs and gapfill.mjs classify grant-answer gaps with incompatible logic — prep.mjs builds overlapping filter sets (a question can be both low_confidence and kb_unverified), gapfill.mjs uses an if/else chain assigning exactly one class. gap-fill.md's own docs describe the classes as a clean partition, which only one of the two scripts actually produces.

◆ FINDING — Boundary / type-contract problems

15. figureGate in pipeline.ts:262 builds its return value via as unknown as AnswerPlan, routing through an untyped Record<string, unknown> — exactly the invariant ("every llm result carries exactly one of handback/figure_call") the module brags about, held open only by an external test rather than the compiler.

16. AnswerPlan is a 15-field interface with ~9 optional fields whose valid combinations are documented in prose, not types — a discriminated union keyed on status would let the compiler enforce what a comment currently promises.

17. grant-verify-figure.ts:62 casts raw['figure_call'] as FigureCall instead of .parse()-ing it, unlike its sibling grant-resize-answer.ts:91 which does re-parse at the handler boundary — an avoidable type-safety hole in a family that's otherwise careful about this.

18. catalog.ts has three independent path-normalization functions (looseKey, scopedNameKey, normalizePath) that are all typed identically ((path: string) => string), so nothing stops a caller from picking the wrong looseness level.

◆ FINDING — File-size / decomposition

19. ✅ DONE (WP #330, 2026-08-24) — pipeline.ts is 1033 lines — over the threshold. Cleanest extraction: the pure-presentation block (renderMarkdown, STATUS_NOTE, handbackLabel, provenance, ~215 lines, :812-1027) has zero coupling back into resolution logic and can move to render-markdown.ts today with no behavior change, dropping the file under 850 lines before even touching finding #6's buildAnswer dedup. Fixed: moved verbatim to `packages/grants/src/render-markdown.ts`; `pipeline.ts` re-exports `renderMarkdown`/`STATUS_NOTE` so no other import needed to change.

20. figures.ts (678 lines) and data.ts (678 lines) are both dominated by non-logic — figures.ts by the FIGURE_CHECKS table (finding #8), data.ts by the single 438-line function (finding #9). Extracting both fixes the size problem as a side effect.

◆ FINDING — Modularity / abstraction issues

21. ✅ DONE (WP #330, 2026-08-24) — grant-verify-figure.ts and both skills don't mention each other — the newest MCP tool (grant_verify_figure, landed WP #323) is instructed by pipeline.ts:437's own output ("call grant_verify_figure with this answer text...") but appears in neither SKILL.md. Fixed: added a `grant_verify_figure` mention to both `.claude/skills/grant-writing/SKILL.md` and `.claude/skills/grant-writing-mcp/SKILL.md`'s figure-handling steps.

22. Banned-jargon lists disagree across four places, two of which are enforcement scripts (count.mjs checks 9 words including 'survivable', which style.md only lists as a soft emotional-reach word, not hard jargon; gapfill.mjs checks a different 8; grant-writing-mcp/SKILL.md documents a 17-word list matching neither).

23. catalog.ts maintains four separately hand-kept file-extension registries that have already drifted: .gslides classifies as text via MIME lookup but unknown via extension lookup — the exact "two callers disagree" defect the file's own header says it exists to prevent.

24. Annotation blocks (readOnlyHint/destructiveHint/etc.) are copy-pasted verbatim across 8 of 9 grant tool registrations, making the one legitimate outlier (get-grant-document-text.ts, openWorldHint: true) easy to miss.

◆ FINDING — Bugs / inconsistencies (concrete, not structural)

25. ✅ DONE (WP #330, 2026-08-24) — pipeline.ts:583/586 computes measureAgainst(text, limit, match.kb_ref) twice with identical arguments in the same branch — pure today, but a duplication trap the moment measure() gains any side effect. Fixed: hoisted to a single `const measurement` inside `resolveTextAnswer()` (#6).

26. packages/grants/README.md:25 claims "two scripts drive this package"; there are four (prep.mjs, gapfill.mjs, count.mjs, corpus_search.py).

27. grant-writing/SKILL.md:33 cites a stale file count ("1,234 files") against the current 1253/1248 in CLAUDE.md/STATE.md.

▲ CAUTION — One agent's assumption about py.ts was wrong going in (asked to check for subprocess/injection risk) and it corrected itself: py.ts is pure TypeScript, no shell-out, no injection surface, and is flagged as the strongest-quality file in the whole set (rigorous IEEE-754 half-to-even rounding port, self-correcting comment trail). Similarly, several classic "bug hunt" candidates (a RegExp.test global-flag footgun in slots.ts, a truncatePreview mismatch) turned out to be already-fixed, documented defects referencing their own work-package numbers — a genuine strength of this codebase's commenting discipline, not an absence of findings.

▲ CAUTION — None of the four agents found a live, unambiguous outright bug beyond #1 (the figure-verification blind spot) and #23 (the .gslides classification mismatch). Everything else is either duplication risk, boundary looseness, or documentation drift — this package's craft level is generally high; the findings above are demanding by the standard the skill sets, not evidence of a fragile codebase.

---
■ RESULT — 27 findings across structural/simplification/spaghetti/boundary/file-size/modularity/bugs, from 4 parallel deep reads of packages/grants/src (10 files), the MCP grant tool + prompt layer (12 files), and both grant-writing skills + scripts. Highest-conviction fixes, in order: #1 (verify.ts's figure check false-alarms on $1.34M-style figures — undermines the one safety-critical guardrail in the package), #6+#19 (dedup buildAnswer's branches and extract renderMarkdown — collapses pipeline.ts under 1000 lines as a side effect), #3 (make skill_grant_writing vs the deterministic pipeline's precedence explicit at the tool-description level), and #5+#21 (fix the skill docs' dead search_documents pointer and add grant_verify_figure to both SKILL.mds — cheap, and currently a live footgun for anyone following the skill as written). No file crossed the 1000-line line without a clear, low-risk extraction path already available.

■ UPDATE (2026-08-24, WP #330) — The 8 findings in the priority list above (#1, #3, #5, #6, #7, #19, #21, #25) are landed and verified: `pnpm test` 580/580, `pnpm -r typecheck` clean, `pnpm --filter @lp-ai/mcp-server build` + its tool tests 37/37. See `packages/grants/CHANGELOG.md`'s 2026-08-24 entries for detail. The remaining 19 findings (#2, #4, #8-18, #20, #22-24, #26-27) are untouched — out of scope for this batch.

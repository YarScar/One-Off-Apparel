import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetSeedCacheForTesting,
  computeIntegrityReport,
  loadBank,
  loadForm,
  loadIntegrityReport,
  loadKnowledgeBase,
  listFormIds,
  type IntegrityWarning,
} from './data.js';
import {
  extractCurrencyClaims,
  statesFigure,
  FIGURE_CHECKS,
  QUESTION_FIGURE_CHECKS,
} from './figures.js';
import type { KbAnswer, KnowledgeBase, QuestionBank } from './schemas.js';

beforeEach(() => {
  __resetSeedCacheForTesting();
});

describe('seed loader', () => {
  it('loads the question bank at the counts the documents claim', () => {
    const bank = loadBank();
    expect(bank.categories).toHaveLength(11);
    expect(bank.questions).toHaveLength(92);
    expect(bank.kb_entries).toHaveLength(29);
    const variants = bank.questions.reduce((n, q) => n + q.variants.length, 0);
    // 212 at bank v0.3.1; v0.4.0 added 35 recorded funder wordings across three new forms;
    // v0.4.1 added cover.funder_connection with one JEVS wording, under board B6;
    // v0.4.2 added 15 JFF/Allen Hiles/Dolfinger-McMahon wordings and two new canonicals.
    // v0.4.3 split two canonicals under board grant-h32 and MOVED three wordings onto them —
    // the count is unchanged on purpose, and that is the check: a split must not invent a wording.
    expect(variants).toBe(265);
    // 25 until 2026-08-11, when the audit found 31 wordings citing GSK-STEM-2026 and
    // Truist-Inspire-2026 — the two Aug-7 pilot forms, added as variants at v0.3 and never
    // declared. `variant_source_undeclared` now enforces this; the count is here so a source
    // dropped from meta.sources fails loudly rather than as a provenance warning.
    expect(bank.meta.sources).toHaveLength(27);
  });

  it('loads the knowledge base with 29 answers, 4 of them unverified', () => {
    const kb = loadKnowledgeBase();
    const keys = Object.keys(kb.answers);
    expect(keys).toHaveLength(29);
    const unverified = keys.filter((k) => kb.answers[k]?.verified === false).sort();
    expect(unverified).toEqual([
      'kb.docs',
      'kb.management_plan',
      'kb.profile.federal',
      'kb.profile.state_pa',
    ]);
  });

  it('discovers every form fixture from disk', () => {
    expect(listFormIds()).toEqual([
      'allen_hiles_2024',
      'aug7_gsk',
      'aug7_truist',
      'dolfinger_mcmahon_2023',
      'hamilton_loi_2025',
      'jevs_c2l_2024',
      'jff_ai_pathways_2026',
      'sample_incoming',
      'sample_philly_innovation',
      'wpf_workforce_2026',
    ]);
  });

  it('loads a fixture by id', () => {
    const form = loadForm('aug7_truist');
    expect(form.questions).toHaveLength(17);
    // Truist is the fixture where every question carries a stated limit.
    expect(form.questions.every((q) => q.limit !== undefined)).toBe(true);
  });

  it('memoises — two loads return the same object', () => {
    expect(loadBank()).toBe(loadBank());
  });

  it('throws a prefixed error for a form that does not exist', () => {
    expect(() => loadForm('no_such_fixture')).toThrow(/grant seed:/);
  });
});

describe('integrity report', () => {
  // G1 cleared both warnings that fired on the 2026-07-28 seed: `kb_ref_dangling_in_prose`
  // (meta named a `kb.serve` slot that never existed) and `attachment_questions_route_to_prose`
  // (the check flagged correct routings to the attachment checklist slots). This asserts the
  // clean state so neither can regress silently — SPEC.md gate G1 requires zero warnings.
  it('carries no violation on the current seed', () => {
    const report = loadIntegrityReport();
    // No `high` at all. That is the language-only guarantee: every figure in a stored answer either has
    // a slot that fills it live or has a recorded reason for being literal.
    expect(report.filter((w) => w.severity === 'high')).toEqual([]);
    // As of 2026-08-21 the FIGURE_DEBT register is empty too (its five claims were removed from the
    // corpus rather than settled — see CHANGELOG.md), so the report is fully clean.
    expect(report.map((w) => w.code)).toEqual([]);
  });

  it('memoises', () => {
    expect(loadIntegrityReport()).toBe(loadIntegrityReport());
  });

  it('every question kb_ref resolves to a stored answer', () => {
    const kb = loadKnowledgeBase();
    const dangling = loadBank()
      .questions.map((q) => q.kb_ref)
      .filter((ref): ref is string => ref !== null && !(ref in kb.answers));
    expect(dangling).toEqual([]);
  });

  it('kb_entries and answers stay 1:1', () => {
    const entryIds = loadBank().kb_entries.map((e) => e.id).sort();
    expect(Object.keys(loadKnowledgeBase().answers).sort()).toEqual(entryIds);
  });

  // A FIGURE_CHECKS slot that stops resolving is invisible at runtime: buildFigureWorkOrder()
  // intersects appears_in with the caller's kb_refs, so the check just stops appearing and the
  // frozen figure publishes unverified. Nothing else in the report covers these ids.
  it('every FIGURE_CHECKS appears_in slot resolves to a stored answer', () => {
    const answers = loadKnowledgeBase().answers;
    const dangling = FIGURE_CHECKS.flatMap((c) => c.appears_in).filter((ref) => !(ref in answers));
    expect(dangling).toEqual([]);
  });
});

// --------------------------------------------------------------------------- the checker itself
// The assertions above prove the seed is clean. That is not the same as proving the checks work, and
// the two failures look identical from outside: a check that has stopped firing also reports an empty
// report on a clean seed. Every check below is therefore run against a corpus that has the defect,
// on a mutated copy of the real seed rather than a hand-built stub, so a check whose predicate stops
// matching the real shape of the data still fails here.

function corpus(): { bank: QuestionBank; kb: KnowledgeBase } {
  return { bank: structuredClone(loadBank()), kb: structuredClone(loadKnowledgeBase()) };
}

/**
 * The codes the unmodified seed reports, which every mutated corpus reports too.
 *
 * Empty as of 2026-08-21: the `stored_figure_unsourced` warning that used to sit here came from the
 * five `FIGURE_DEBT` entries — figures that drifted with no live source to fill them from — and those
 * were removed from the corpus rather than settled. See `slots.ts::FIGURE_DEBT`.
 */
const BASELINE_CODES: readonly string[] = [];

/**
 * A report with {@link BASELINE_CODES} removed — the warnings a mutation INTRODUCED.
 *
 * Subtracting rather than listing the baseline in every expectation, because these cases are each about
 * one check, and a baseline code repeated across 30 expectations is 30 places to edit the next time the
 * register changes.
 *
 * Returns warnings rather than codes because most cases assert on `severity` and `message` too, and a
 * codes-only helper would leave those reaching back into the unfiltered report and indexing `report[0]`
 * at whatever the baseline happened to sort into.
 *
 * **The caveat, since it is a real one:** a mutation that adds a *second* instance of a baseline code is
 * invisible here. No case targets a baseline code today; one that did would have to assert on
 * `computeIntegrityReport` directly.
 */
function introduced(report: readonly IntegrityWarning[]): IntegrityWarning[] {
  return report.filter((w) => !BASELINE_CODES.includes(w.code));
}

function codesFor(bank: QuestionBank, kb: KnowledgeBase): string[] {
  return introduced(computeIntegrityReport(bank, kb))
    .map((w) => w.code)
    .sort();
}

/** The first question, asserted rather than `!`-asserted — the bank schema requires `.min(1)`. */
function firstQuestion(bank: QuestionBank): QuestionBank['questions'][number] {
  const q = bank.questions[0];
  if (q === undefined) throw new Error('bank has no questions');
  return q;
}

function anAnswer(kb: KnowledgeBase): KbAnswer {
  const a = Object.values(kb.answers)[0];
  if (a === undefined) throw new Error('kb has no answers');
  return a;
}

// The coverage check is only as good as its two primitives, and both failed silently rather than
// loudly when they were wrong: a mis-tokenised claim matches nothing and simply stops being checked.
describe('currency claim tokens', () => {
  it('does not absorb a following capitalised word into the magnitude suffix', () => {
    expect(extractCurrencyClaims('$500,000 Kresge grant')).toEqual(['$500,000']);
    expect(extractCurrencyClaims('a $250,000 Match commitment')).toEqual(['$250,000']);
  });

  it('keeps the magnitude suffix when it really is one', () => {
    expect(extractCurrencyClaims('$1.34M FY2025 expenses')).toEqual(['$1.34M']);
    expect(extractCurrencyClaims('$1.68 M projected')).toEqual(['$1.68 M']);
    expect(extractCurrencyClaims('booked at $50K-$80K')).toEqual(['$50K', '$80K']);
  });
});

describe('statesFigure', () => {
  it('rejects every way a figure continues to the right', () => {
    expect(statesFigure('$20,000 raised', '$20')).toBe(false);
    expect(statesFigure('about $20.50 per hour', '$20')).toBe(false);
    expect(statesFigure('budget is $1.34M total', '$1.34')).toBe(false);
    expect(statesFigure('budget is $1.34 M total', '$1.34')).toBe(false);
  });

  it('still matches the figure it was given', () => {
    expect(statesFigure('~$20/hr starting wage', '$20')).toBe(true);
    expect(statesFigure('$1.34M FY2025 expenses', '$1.34M')).toBe(true);
    // Sentence-final: the decimal arm is `\.\d`, so a trailing period is not a continuation.
    expect(statesFigure('client work booked at $50K.', '$50K')).toBe(true);
    // `$50 Kresge` is fifty dollars, not fifty thousand — the same anchor as the extractor.
    expect(statesFigure('a $50 Kresge filing fee', '$50')).toBe(true);
  });
});

describe('computeIntegrityReport', () => {
  it('reports nothing on the unmodified seed beyond the known debt register', () => {
    const { bank, kb } = corpus();
    expect(codesFor(bank, kb)).toEqual([]);
    // And the baseline is what it claims to be, rather than a growing pile something got added to.
    expect(computeIntegrityReport(bank, kb).map((w) => w.code).sort()).toEqual([...BASELINE_CODES]);
  });

  it('fires kb_entry_without_answer for a declared slot with no answer', () => {
    const { bank, kb } = corpus();
    bank.kb_entries.push({ id: 'kb.declared_only', label: 'declared but never written' });
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['kb_entry_without_answer']);
    expect(report[0]?.severity).toBe('high');
    expect(report[0]?.message).toContain('kb.declared_only');
  });

  it('fires kb_answer_without_entry for an answer no entry declares', () => {
    const { bank, kb } = corpus();
    kb.answers['kb.orphan'] = anAnswer(kb);
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['kb_answer_without_entry']);
    // Informational on purpose: an extra answer is dead weight, not a broken retrieval path.
    expect(report[0]?.severity).toBe('info');
    expect(report[0]?.message).toContain('kb.orphan');
  });

  it('fires question_kb_ref_dangling for a question pointing at a missing slot', () => {
    const { bank, kb } = corpus();
    firstQuestion(bank).kb_ref = 'kb.renamed_away';
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['question_kb_ref_dangling']);
    expect(report[0]?.message).toContain('kb.renamed_away');
  });

  it('does not fire question_kb_ref_dangling on a null kb_ref', () => {
    // `null` means application-specific, not missing — flagging it would make the report noise.
    const { bank, kb } = corpus();
    firstQuestion(bank).kb_ref = null;
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('fires kb_ref_dangling_in_prose for a slot named only in meta, trailing period and all', () => {
    const { bank, kb } = corpus();
    kb.meta.note += ' Cross-checked against kb.gone_slot.';
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['kb_ref_dangling_in_prose']);
    // The sentence-final period must be stripped before the lookup, or a prose reference at the end
    // of a sentence is looked up with the period attached. Unstripped, the id reported back reads
    // `kb.gone_slot..` — the message adds its own period after the list.
    expect(report[0]?.message).toContain('kb.gone_slot');
    expect(report[0]?.message).not.toContain('kb.gone_slot..');
  });

  it('does not fire on a prose reference to a slot that exists', () => {
    const { bank, kb } = corpus();
    const existing = Object.keys(kb.answers)[0];
    kb.meta.note += ` See ${String(existing)}.`;
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('fires figure_check_ref_dangling, naming the checks that would go silent', () => {
    const { bank, kb } = corpus();
    const slot = FIGURE_CHECKS.flatMap((c) => c.appears_in)[0];
    expect(slot).toBeDefined();
    const target = String(slot);
    // Rename the slot the way a real edit would: the answer moves, so the entry and any question
    // routed to it follow. Only figures.ts is left pointing at the old id.
    kb.answers = Object.fromEntries(
      Object.entries(kb.answers).map(([id, a]) => [
        id === target ? 'kb.figure_slot_renamed' : id,
        a,
      ]),
    );
    bank.kb_entries = bank.kb_entries.map((e) =>
      e.id === target ? { ...e, id: 'kb.figure_slot_renamed' } : e,
    );
    for (const q of bank.questions) {
      if (q.kb_ref === target) q.kb_ref = 'kb.figure_slot_renamed';
    }

    const report = introduced(computeIntegrityReport(bank, kb));
    // One code, not two. This asserted `figure_claim_uncovered` alongside it until 2026-08-17, on the
    // reasoning that the slot's text moves with the rename and so states a claim `appears_in` no longer
    // names. That reasoning was right and its premise is gone: the corpus stores language now, so the
    // moved text carries `{{slots}}` rather than currency, and there is no literal claim left to be
    // uncovered. **`figure_claim_uncovered` is largely superseded by the slot mechanism** — it still
    // guards against a figure creeping back in as a literal, which is a real regression to catch, but on
    // the scrubbed corpus it has almost nothing to find. Work package #275.
    expect(report.map((w) => w.code).sort()).toEqual(['figure_check_ref_dangling']);
    const dangling = report.find((w) => w.code === 'figure_check_ref_dangling');
    expect(dangling?.message).toContain(target);
    // The affected check keys are the actionable part — without them the warning names a slot but
    // not what stopped being verified.
    const affected = FIGURE_CHECKS.filter((c) => c.appears_in.includes(target));
    expect(affected.length).toBeGreaterThan(0);
    for (const c of affected) expect(dangling?.message).toContain(c.key);
  });

  it('fires attachment_questions_route_to_prose for an attachment question on a narrative slot', () => {
    const { bank, kb } = corpus();
    const prose = Object.keys(kb.answers).find(
      (k) => k !== 'kb.docs' && k !== 'kb.budget_narrative',
    );
    expect(prose).toBeDefined();
    const q = firstQuestion(bank);
    q.answer_type = 'attachment';
    q.kb_ref = String(prose);
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['attachment_questions_route_to_prose']);
    expect(report[0]?.severity).toBe('medium');
    expect(report[0]?.message).toContain(q.id);
  });

  it('accepts an attachment question routed to an attachment checklist slot', () => {
    // The distinction the check exists to draw. `kb.docs` is a list of what to upload, so routing
    // there is correct — an earlier revision flagged it and had to be corrected.
    const { bank, kb } = corpus();
    expect(Object.keys(kb.answers)).toContain('kb.docs');
    const q = firstQuestion(bank);
    q.answer_type = 'attachment';
    q.kb_ref = 'kb.docs';
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('fires structured_key_dangling for a value keyed to a question id that does not exist', () => {
    const { bank, kb } = corpus();
    const a = anAnswer(kb);
    a.structured = { 'cover.question_renamed_away': { value: 'X', verified: true } };
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['structured_key_dangling']);
    expect(report[0]?.severity).toBe('high');
    expect(report[0]?.message).toContain('cover.question_renamed_away');
  });

  it('accepts a structured value keyed to a question that exists', () => {
    const { bank, kb } = corpus();
    const real = bank.questions[0]?.id;
    expect(real).toBeDefined();
    const a = anAnswer(kb);
    a.structured = { [String(real)]: { value: 'X', verified: true } };
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('reports structured_key_dangling alongside other independent defects', () => {
    const { bank, kb } = corpus();
    bank.kb_entries.push({ id: 'kb.declared_only', label: 'x' });
    const a = anAnswer(kb);
    a.structured = { 'cover.gone': { value: 'X', verified: true } };
    expect(codesFor(bank, kb)).toEqual([
      'kb_entry_without_answer',
      'structured_key_dangling',
    ]);
  });

  // -- figure_claim_uncovered ---------------------------------------------------------------

  it('fires figure_claim_uncovered when a slot states a figure its check does not declare', () => {
    const { bank, kb } = corpus();
    const check = FIGURE_CHECKS.find((c) => c.key === 'annual_budget');
    expect(check).toBeDefined();
    // Restate the figure in a slot the check does not name — the commonest real edit, and the one
    // that leaves the figure with no verification item in a draft scoped to that slot.
    const target = Object.keys(kb.answers).find((k) => !check?.appears_in.includes(k));
    expect(target).toBeDefined();
    const answer = kb.answers[String(target)];
    expect(answer).toBeDefined();
    if (answer !== undefined) answer.text += ' FY2025 expenses were $1.34M.';

    const report = introduced(computeIntegrityReport(bank, kb));
    // Two codes now, and the second is the point of the language-only rule: appending a bare `$1.34M`
    // to a stored answer is BOTH an undeclared restatement and a figure stored as text. Before #275 only
    // the first was catchable, which is why a figure could sit in approved prose indefinitely as long as
    // some check happened to name its slot.
    expect(report.map((w) => w.code).sort()).toEqual([
      'figure_claim_uncovered',
      'stored_literal_figure',
    ]);
    const uncovered = report.find((w) => w.code === 'figure_claim_uncovered');
    expect(uncovered?.severity).toBe('high');
    expect(uncovered?.message).toContain('annual_budget');
    expect(uncovered?.message).toContain(String(target));
  });

  it('does not fire figure_claim_uncovered on a longer number that merely contains the token', () => {
    // The precision the check depends on. `$1.5M` is a declared prior_funding_wpf figure; a slot
    // saying `$1.55M` states a DIFFERENT figure and a substring match would call it covered. The
    // same boundary rule is what keeps `$50` out of `$50,000` — without it the check produced five
    // times as many findings as there are defects, and would have been ignored.
    const { bank, kb } = corpus();
    const answer = kb.answers['kb.mission'];
    expect(answer).toBeDefined();
    if (answer !== undefined) answer.text += ' Unrelated: $1.55M and $350,2680.';
    // `stored_literal_figure` and nothing else: the coverage check correctly declines to match, while
    // the language-only check correctly objects to a currency figure sitting in a stored answer at all.
    // That the two disagree about this text is the design — they answer different questions.
    expect(codesFor(bank, kb)).toEqual(['stored_literal_figure']);
  });

  it('does not fire figure_claim_uncovered on a percentage — currency tokens only', () => {
    // Deliberate scope limit, measured rather than assumed: `100%` means the certification rate in
    // one slot, free-and-reduced-lunch eligibility in another, and the current paid-work rate in a
    // third. Scanning percentages would flag all three against every check that quotes one.
    const { bank, kb } = corpus();
    const answer = kb.answers['kb.mission'];
    expect(answer).toBeDefined();
    if (answer !== undefined) answer.text += ' About 85% and 90% and 100% and 60%.';
    // The percentage scope limit still holds for the coverage check. `stored_literal_figure` does fire,
    // and that is the gap the language-only rule closes: percentages were never coverage-checkable
    // precisely because they are ambiguous, so they used to be unguarded entirely.
    expect(codesFor(bank, kb)).toEqual(['stored_literal_figure']);
  });

  it('fires figure_claim_uncovered on a figure restated only in a structured value', () => {
    // A structured value IS the answer to its question — `eligibility.budget_size` hands a funder a
    // one-line budget figure with no prose around it. Scanning only `text` left those unchecked, and
    // the motivating real case (kb.eligibility) was caught by luck because its prose quotes the
    // figure too.
    const { bank, kb } = corpus();
    const check = FIGURE_CHECKS.find((c) => c.key === 'annual_budget');
    expect(check).toBeDefined();
    const target = Object.keys(kb.answers).find((k) => !check?.appears_in.includes(k));
    const answer = kb.answers[String(target)];
    expect(answer).toBeDefined();
    if (answer !== undefined) {
      answer.structured = { 'q.invented': { value: 'FY2025 expenses ~$1.34M' } };
    }
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toContain('figure_claim_uncovered');
    expect(report.find((w) => w.code === 'figure_claim_uncovered')?.message).toContain(
      String(target),
    );
  });

  it('does not fire figure_claim_uncovered when a capitalised word follows a currency figure', () => {
    // The token extractor's suffix is optional and may be preceded by a space, so an unanchored
    // `[MKB]?` read `$500,000 Kresge` as the token `$500,000 K` — present in no KB text, which
    // silently retired the coverage check for that claim rather than reporting anything.
    const { bank, kb } = corpus();
    const answer = kb.answers['kb.mission'];
    expect(answer).toBeDefined();
    // $1.34M is a declared annual_budget figure; stated here as `$1.34M Kresge` it must still be
    // recognised, and the undeclared slot must still be reported.
    if (answer !== undefined) answer.text += ' A $1.34M Kresge award.';
    expect(codesFor(bank, kb)).toEqual(['figure_claim_uncovered', 'stored_literal_figure']);
  });

  it('does not fire figure_claim_uncovered on a decimal continuation of a declared token', () => {
    // `$20` is the employment_wage_range token. A slot quoting a different rate — `$20.50/hr` — is
    // not restating it, and reporting it as such tells the maintainer to declare an unrelated slot.
    const { bank, kb } = corpus();
    const answer = kb.answers['kb.mission'];
    expect(answer).toBeDefined();
    if (answer !== undefined) answer.text += ' Unrelated: $20.50 per hour and $20,500 in fees.';
    expect(codesFor(bank, kb)).toEqual(['stored_literal_figure']);
  });

  // -- question_figure_check_dangling ---------------------------------------------------------

  it('fires question_figure_check_dangling when a mapped question id no longer exists', () => {
    const { bank, kb } = corpus();
    const mapped = Object.keys(QUESTION_FIGURE_CHECKS)[0];
    expect(mapped).toBeDefined();
    bank.questions = bank.questions.filter((q) => q.id !== mapped);
    const report = introduced(computeIntegrityReport(bank, kb));
    // Deleting the question also strands anything else keyed to it; the figure warning is the one
    // under test and must be present.
    const warning = report.find((w) => w.code === 'question_figure_check_dangling');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('high');
    expect(warning?.message).toContain(String(mapped));
    expect(warning?.message).toContain('fetch_figure');
  });

  it('accepts QUESTION_FIGURE_CHECKS as it stands — both sides resolve', () => {
    // The live assertion behind the check: every mapped question is in the bank and every mapped
    // value is a real check key. A rename on either side is silent at runtime.
    const bank = loadBank();
    const questionIds = new Set(bank.questions.map((q) => q.id));
    const checkKeys = new Set(FIGURE_CHECKS.map((c) => c.key));
    for (const [qid, key] of Object.entries(QUESTION_FIGURE_CHECKS)) {
      expect(questionIds.has(qid)).toBe(true);
      expect(checkKeys.has(key)).toBe(true);
    }
  });

  // -- variant_shared_across_questions --------------------------------------------------------

  it('fires variant_shared_across_questions for a wording recorded on two canonicals', () => {
    const { bank, kb } = corpus();
    const [a, b] = bank.questions;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      a.variants.push({ text: 'Describe your widget.', source: 'FFTC' });
      b.variants.push({ text: 'Describe your widget!', source: 'FFTC' });
    }
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['variant_shared_across_questions']);
    expect(report[0]?.severity).toBe('medium');
    // Punctuation and case are normalised away, because a tie survives both.
    expect(report[0]?.message).toContain(String(a?.id));
    expect(report[0]?.message).toContain(String(b?.id));
  });

  it('stays silent on the three ties recorded in ACKNOWLEDGED_TIES', () => {
    // The register is load-bearing: all three are live in the seed today, so a check without it
    // would put the report permanently non-empty and retire the G1 gate by attrition.
    const { bank, kb } = corpus();
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('fires variant_shared_across_questions when a wording differs only in a stripped separator', () => {
    // The key must be `matcher.normalize()`, not an approximation. A local `[^a-z0-9 ] -> ''`
    // collapsed "Program/project" to `programproject` while the matcher splits it into two tokens —
    // so the matcher tied these at 1.0 and the check, which exists to catch exactly that, stayed
    // silent.
    const { bank, kb } = corpus();
    const [a, b] = bank.questions;
    if (a === undefined || b === undefined) throw new Error('bank too small');
    a.variants.push({ text: 'Program/project widget description', source: 'FFTC' });
    b.variants.push({ text: 'Program project widget description', source: 'FFTC' });
    expect(codesFor(bank, kb)).toEqual(['variant_shared_across_questions']);
  });

  it('fires variant_shared_across_questions when a wording equals another question canonical', () => {
    // `candidatesFor()` scores the canonical as a candidate too, so a variant matching a different
    // question's canonical text ties at 1.0 the same way a variant-variant collision does.
    const { bank, kb } = corpus();
    const [a, b] = bank.questions;
    if (a === undefined || b === undefined) throw new Error('bank too small');
    a.variants.push({ text: b.canonical, source: 'FFTC' });
    expect(codesFor(bank, kb)).toEqual(['variant_shared_across_questions']);
  });

  it('does not fire variant_shared_across_questions for the same wording twice on ONE question', () => {
    const { bank, kb } = corpus();
    const q = firstQuestion(bank);
    q.variants.push({ text: 'Describe your widget.', source: 'FFTC' });
    q.variants.push({ text: 'Describe your widget.', source: 'NNG' });
    // Two funders wording a question identically is provenance, not ambiguity — it resolves to one
    // canonical either way.
    expect(codesFor(bank, kb)).toEqual([]);
  });

  // -- variant_source_undeclared --------------------------------------------------------------

  it('fires variant_source_undeclared for a wording citing an undeclared source', () => {
    const { bank, kb } = corpus();
    firstQuestion(bank).variants.push({ text: 'Some funder wording.', source: 'NotAForm-2099' });
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['variant_source_undeclared']);
    expect(report[0]?.message).toContain('NotAForm-2099');
  });

  it('fires variant_source_undeclared for a LIMIT citing an undeclared source', () => {
    // Limits carry provenance too, and the earlier version of this check only looked at variants.
    const { bank, kb } = corpus();
    const q = firstQuestion(bank);
    q.limits = [...(q.limits ?? []), { unit: 'words', max: 250, source: 'NotAForm-2099' }];
    expect(codesFor(bank, kb)).toEqual(['variant_source_undeclared']);
  });

  // -- structured_value_missing ---------------------------------------------------------------

  it('fires structured_value_missing for a short-value question its slot does not disambiguate', () => {
    const { bank, kb } = corpus();
    // kb.eligibility carries per-question structured values; point a single_select at it that it
    // does not disambiguate. Not `firstQuestion` — that is `cover.legal_name`, which is registered
    // in STRUCTURED_VALUE_DEBT and would be filtered out before the check ran.
    const q = bank.questions.find((x) => x.id === 'cover.ein_taxstatus');
    if (q === undefined) throw new Error('cover.ein_taxstatus not in bank');
    q.answer_type = 'single_select';
    q.kb_ref = 'kb.eligibility';
    expect(kb.answers['kb.eligibility']?.structured).toBeDefined();
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['structured_value_missing']);
    expect(report[0]?.severity).toBe('medium');
    expect(report[0]?.message).toContain(q.id);
  });

  it('does not fire structured_value_missing on a slot with no structured values at all', () => {
    // The distinction the check draws. A slot that disambiguates nobody is the designed narrative
    // fallback, not a gap — flagging it would fire on every attachment question in the bank.
    const { bank, kb } = corpus();
    expect(kb.answers['kb.docs']?.structured).toBeUndefined();
    const q = firstQuestion(bank);
    q.answer_type = 'field';
    q.kb_ref = 'kb.docs';
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('does not fire structured_value_missing on a slot whose structured map is empty', () => {
    // `structured: {}` disambiguates nobody, so it is the same designed fallback as an absent map.
    // Reading it as "carries structured values" flagged every short-value question on a slot the
    // moment its last value was removed.
    const { bank, kb } = corpus();
    const answer = kb.answers['kb.docs'];
    expect(answer).toBeDefined();
    if (answer !== undefined) answer.structured = {};
    const q = firstQuestion(bank);
    q.answer_type = 'field';
    q.kb_ref = 'kb.docs';
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('does not fire structured_value_missing for an id in STRUCTURED_VALUE_DEBT', () => {
    // cover.legal_name is a live instance: it returns the whole kb.profile.identity paragraph. It
    // is registered rather than fixed because the value is not ours to invent — the slot's own text
    // says the registered legal name is still to be confirmed.
    const { bank, kb } = corpus();
    const debt = bank.questions.find((q) => q.id === 'cover.legal_name');
    expect(debt?.kb_ref).toBe('kb.profile.identity');
    expect(kb.answers['kb.profile.identity']?.structured).toBeDefined();
    expect(Object.keys(kb.answers['kb.profile.identity']?.structured ?? {})).not.toContain(
      'cover.legal_name',
    );
    expect(codesFor(bank, kb)).toEqual([]);
  });

  it('fires unknown_question_category for a category id not in categories[]', () => {
    const { bank, kb } = corpus();
    firstQuestion(bank).category = 'not_a_category';
    const report = introduced(computeIntegrityReport(bank, kb));
    expect(report.map((w) => w.code)).toEqual(['unknown_question_category']);
    expect(report[0]?.message).toContain('not_a_category');
  });

  it('reports every independent defect at once, not just the first', () => {
    const { bank, kb } = corpus();
    bank.kb_entries.push({ id: 'kb.declared_only', label: 'x' });
    kb.answers['kb.orphan'] = anAnswer(kb);
    firstQuestion(bank).category = 'not_a_category';
    expect(codesFor(bank, kb)).toEqual([
      'kb_answer_without_entry',
      'kb_entry_without_answer',
      'unknown_question_category',
    ]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetSeedCacheForTesting,
  computeIntegrityReport,
  loadBank,
  loadForm,
  loadIntegrityReport,
  loadKnowledgeBase,
  listFormIds,
} from './data.js';
import { FIGURE_CHECKS } from './figures.js';
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
  it('is empty on the current seed', () => {
    expect(loadIntegrityReport()).toEqual([]);
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

function codesFor(bank: QuestionBank, kb: KnowledgeBase): string[] {
  return computeIntegrityReport(bank, kb)
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

describe('computeIntegrityReport', () => {
  it('reports nothing on the unmodified seed', () => {
    const { bank, kb } = corpus();
    expect(computeIntegrityReport(bank, kb)).toEqual([]);
  });

  it('fires kb_entry_without_answer for a declared slot with no answer', () => {
    const { bank, kb } = corpus();
    bank.kb_entries.push({ id: 'kb.declared_only', label: 'declared but never written' });
    const report = computeIntegrityReport(bank, kb);
    expect(report.map((w) => w.code)).toEqual(['kb_entry_without_answer']);
    expect(report[0]?.severity).toBe('high');
    expect(report[0]?.message).toContain('kb.declared_only');
  });

  it('fires kb_answer_without_entry for an answer no entry declares', () => {
    const { bank, kb } = corpus();
    kb.answers['kb.orphan'] = anAnswer(kb);
    const report = computeIntegrityReport(bank, kb);
    expect(report.map((w) => w.code)).toEqual(['kb_answer_without_entry']);
    // Informational on purpose: an extra answer is dead weight, not a broken retrieval path.
    expect(report[0]?.severity).toBe('info');
    expect(report[0]?.message).toContain('kb.orphan');
  });

  it('fires question_kb_ref_dangling for a question pointing at a missing slot', () => {
    const { bank, kb } = corpus();
    firstQuestion(bank).kb_ref = 'kb.renamed_away';
    const report = computeIntegrityReport(bank, kb);
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
    kb.meta.connector_reconciliation += ' Cross-checked against kb.gone_slot.';
    const report = computeIntegrityReport(bank, kb);
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

    const report = computeIntegrityReport(bank, kb);
    expect(report.map((w) => w.code)).toEqual(['figure_check_ref_dangling']);
    expect(report[0]?.message).toContain(target);
    // The affected check keys are the actionable part — without them the warning names a slot but
    // not what stopped being verified.
    const affected = FIGURE_CHECKS.filter((c) => c.appears_in.includes(target));
    expect(affected.length).toBeGreaterThan(0);
    for (const c of affected) expect(report[0]?.message).toContain(c.key);
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
    const report = computeIntegrityReport(bank, kb);
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
    const report = computeIntegrityReport(bank, kb);
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

  it('fires unknown_question_category for a category id not in categories[]', () => {
    const { bank, kb } = corpus();
    firstQuestion(bank).category = 'not_a_category';
    const report = computeIntegrityReport(bank, kb);
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

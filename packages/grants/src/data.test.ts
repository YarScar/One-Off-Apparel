import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetSeedCacheForTesting,
  loadBank,
  loadForm,
  loadIntegrityReport,
  loadKnowledgeBase,
  listFormIds,
} from './data.js';

beforeEach(() => {
  __resetSeedCacheForTesting();
});

describe('seed loader', () => {
  it('loads the question bank at the counts the documents claim', () => {
    const bank = loadBank();
    expect(bank.categories).toHaveLength(11);
    expect(bank.questions).toHaveLength(82);
    expect(bank.kb_entries).toHaveLength(29);
    const variants = bank.questions.reduce((n, q) => n + q.variants.length, 0);
    expect(variants).toBe(211);
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
      'aug7_gsk',
      'aug7_truist',
      'sample_incoming',
      'sample_philly_innovation',
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
});

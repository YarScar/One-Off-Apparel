import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { __resetSeedCacheForTesting, loadBank } from './data.js';
import {
  DEFAULT_THRESHOLD,
  matchForm,
  matchQuestion,
  normalize,
  weightedJaccard,
  type MatchResult,
} from './matcher.js';
import type { QuestionBank } from './schemas.js';

let bank: QuestionBank;

beforeAll(() => {
  __resetSeedCacheForTesting();
  bank = loadBank();
});

// --------------------------------------------------------------------------- ported unit tests
// The 13 cases from the prototype's tests/test_matcher.py, re-expressed. These are behavioural
// invariants that must hold for any healthy bank; the exact-score parity block below is the
// stronger bar that G2 actually turns on.

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('Mission, Budget!')).toEqual(['mission', 'budget']);
  });

  it('drops stopwords', () => {
    expect(normalize('What is your the mission')).toEqual(['mission']);
  });

  it('is empty when every token is a stopword', () => {
    expect(normalize('What is your')).toEqual([]);
  });
});

describe('weightedJaccard', () => {
  it('scores identical token sets as 1', () => {
    const toks = ['mission', 'budget'];
    expect(weightedJaccard(toks, toks)).toBeCloseTo(1.0, 12);
  });

  it('scores no overlap as 0', () => {
    expect(weightedJaccard(['mission'], ['timeline'])).toBe(0.0);
  });

  it('scores an empty side as 0', () => {
    expect(weightedJaccard([], ['mission'])).toBe(0.0);
  });

  it('weighs a shared signal word above a shared ordinary word', () => {
    const strong = weightedJaccard(['mission', 'x'], ['mission', 'y']);
    const weak = weightedJaccard(['apple', 'x'], ['apple', 'y']);
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('matchQuestion', () => {
  it('matches every canonical phrasing back to itself, confidently', () => {
    const failures: string[] = [];
    for (const q of bank.questions) {
      const r = matchQuestion(q.canonical, bank);
      if (!r.is_confident || r.matched_id === null) {
        failures.push(`${q.id} scored only ${String(r.confidence)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('matches every recorded funder variant confidently', () => {
    const failures: string[] = [];
    for (const q of bank.questions) {
      for (const v of q.variants ?? []) {
        const r = matchQuestion(v.text, bank);
        if (!r.is_confident) {
          failures.push(`variant of ${q.id} scored only ${String(r.confidence)}: ${v.text.slice(0, 40)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('does not confidently match an off-topic question', () => {
    expect(matchQuestion('What is your refund policy for merchandise?', bank).is_confident).toBe(
      false,
    );
  });

  it('lets the threshold control the confidence flag', () => {
    const text = 'What is your refund policy for merchandise?';
    expect(matchQuestion(text, bank, 0.0).is_confident).toBe(true);
    expect(matchQuestion(text, bank, 0.99).is_confident).toBe(false);
  });

  it('carries the matched entry’s category and kb_ref through', () => {
    const q = bank.questions[0];
    expect(q).toBeDefined();
    const r = matchQuestion((q as (typeof bank.questions)[number]).canonical, bank);
    expect(r.category).toBe((q as (typeof bank.questions)[number]).category);
    expect(r.kb_ref).toBe((q as (typeof bank.questions)[number]).kb_ref);
  });
});

describe('matchForm', () => {
  it('returns one result per question, in order', () => {
    const qs = ['What is your mission?', 'What is your annual budget?', 'zzz nonsense'];
    const results = matchForm(qs, bank);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.incoming)).toEqual(qs);
  });
});

// --------------------------------------------------------------------------- exact-score parity

interface MatcherFixture {
  readonly note: string;
  readonly bank_version: string;
  readonly cases: readonly { readonly incoming: string; readonly expected: MatchResult }[];
  readonly threshold_cases: readonly {
    readonly incoming: string;
    readonly threshold: number;
    readonly is_confident: boolean;
  }[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(HERE, '__fixtures__', 'matcher-parity.json'), 'utf8'),
) as MatcherFixture;

describe('matchQuestion — prototype parity', () => {
  it('was generated against the bank version in the repo', () => {
    expect(fixture.bank_version).toBe(bank.meta.version);
    expect(fixture.cases.length).toBeGreaterThan(330);
  });

  it('reproduces every recorded MatchResult field for field', () => {
    const mismatches: { incoming: string; want: MatchResult; got: MatchResult }[] = [];
    for (const c of fixture.cases) {
      const got = matchQuestion(c.incoming, bank);
      // Whole-object equality: the matched id, the winning variant source, the rounded confidence,
      // and the confidence flag all have to agree. A drift in the sequence ratio would surface as a
      // changed matched_id or matched_via, not just a changed number.
      if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
        mismatches.push({ incoming: c.incoming, want: c.expected, got });
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });

  it('reproduces the confidence flag across thresholds', () => {
    for (const c of fixture.threshold_cases) {
      expect(matchQuestion(c.incoming, bank, c.threshold).is_confident).toBe(c.is_confident);
    }
  });

  it('uses the prototype threshold', () => {
    expect(DEFAULT_THRESHOLD).toBe(0.42);
  });

  it('returns an all-null result when nothing scores above zero', () => {
    const r = matchQuestion('', bank);
    expect(r.matched_id).toBeNull();
    expect(r.matched_via).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.is_confident).toBe(false);
  });
});

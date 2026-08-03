import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { __resetSeedCacheForTesting, listFormIds, loadBank, loadForm } from './data.js';
import {
  DEFAULT_THRESHOLD,
  matchForm,
  matchQuestion,
  normalize,
  scoreUpperBound,
  weightedJaccard,
  type MatchResult,
} from './matcher.js';
import type { QuestionBank } from './schemas.js';
import { sequenceRatio } from './seq-ratio.js';

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
      for (const v of q.variants) {
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

// --------------------------------------------------------------------------- bounded-skip exactness
// matchQuestion() skips the difflib call for any candidate whose `0.7 * J + 0.3` upper bound cannot
// beat the incumbent. That is meant to be an exact optimization, not a heuristic, so it is pinned
// against a reference that computes every score in full — including the ones the real path proves it
// does not need. The prototype fixture would also catch a divergence, but only where the prototype
// happened to record a case; this covers whatever is on disk.

/** Every (incoming, candidate) pair where the skip bound came in below the score it must bound. */
const unsoundBounds: { incoming: string; candidate: string; bound: number; score: number }[] = [];
/** Pairs the ledger above actually saw, so an empty ledger cannot pass for a clean one. */
let boundsChecked = 0;

/** The unoptimized matcher: every candidate scored in full, same order and tie-breaks. */
function referenceMatch(text: string, b: QuestionBank): { id: string | null; via: string | null } {
  const tokens = normalize(text);
  const joined = tokens.join(' ');
  const blend = (candidate: string): number => {
    const c = normalize(candidate);
    const jaccard = weightedJaccard(tokens, c);
    const score = 0.7 * jaccard + 0.3 * sequenceRatio(joined, c.join(' '));
    // Checked here because this is the one place every score is computed in full. A full-scan
    // comparison alone cannot catch a tightened bound: it only diverges if the bank happens to hold a
    // candidate the tighter bound wrongly skips, so the guarantee is asserted directly.
    const bound = scoreUpperBound(jaccard);
    boundsChecked += 1;
    if (bound < score) unsoundBounds.push({ incoming: text, candidate, bound, score });
    return score;
  };

  let bestId: string | null = null;
  let bestVia: string | null = null;
  let bestScore = 0.0;
  for (const q of b.questions) {
    let s = blend(q.canonical);
    let via = 'canonical';
    for (const v of q.variants) {
      const vs = blend(v.text);
      if (vs > s) {
        s = vs;
        via = v.source;
      }
    }
    if (s > bestScore) {
      bestScore = s;
      bestId = q.id;
      bestVia = via;
    }
  }
  return { id: bestId, via: bestVia };
}

describe('matchQuestion — bounded skip is exact', () => {
  it('picks the same entry and variant as a full-scan reference on every captured form question', () => {
    // Real funder wordings, which is where the incumbent climbs high enough for skips to happen.
    // Scoped to the form fixtures rather than the whole bank to keep the naive side under a second.
    const incoming = listFormIds().flatMap((id) => loadForm(id).questions.map((q) => q.text));
    expect(incoming.length).toBeGreaterThan(80);

    const divergences = incoming
      .map((text) => ({ text, fast: matchQuestion(text, bank), slow: referenceMatch(text, bank) }))
      .filter(({ fast, slow }) => fast.matched_id !== slow.id || fast.matched_via !== slow.via);
    expect(divergences).toEqual([]);
  });

  it('never bounds a real score below its own value', () => {
    // Runs the reference over the same corpus so `blend` populates the ledger; the full scan above
    // does not run first in isolation.
    for (const id of listFormIds()) {
      for (const q of loadForm(id).questions) referenceMatch(q.text, bank);
    }
    // ~35,400 pairs per reference pass over the fixtures: every form question against every
    // candidate. A collapsed loop would still report zero unsound bounds, so the count is the guard.
    expect(boundsChecked).toBeGreaterThan(30_000);
    expect(unsoundBounds.slice(0, 3)).toEqual([]);
    expect(unsoundBounds).toHaveLength(0);
  });

  it('agrees on the long autojunk-crossing candidates, where the ratio term dominates', () => {
    const long = bank.questions.flatMap((q) =>
      q.variants.map((v) => v.text).filter((t) => normalize(t).join(' ').length >= 200),
    );
    expect(long.length).toBeGreaterThan(0);
    for (const text of long) {
      const fast = matchQuestion(text, bank);
      const slow = referenceMatch(text, bank);
      expect({ id: fast.matched_id, via: fast.matched_via }).toEqual(slow);
    }
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

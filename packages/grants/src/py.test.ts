import { describe, expect, it } from 'vitest';

import { pyCountSentences, pyLen, pyRound, pyRstrip, pySplit, pySplitSentences } from './py.js';

// These primitives exist because the natural JS translation is wrong in ways that surface as a word
// count off by one against a hard funder cap. Each case below is a divergence a naive port has.
// Control characters are written as escapes on purpose — they are invisible in an editor otherwise.

describe('pySplit', () => {
  it('returns [] for empty and all-whitespace input', () => {
    expect(pySplit('')).toEqual([]);
    expect(pySplit('   \t\n ')).toEqual([]);
  });

  it('collapses runs and strips both ends', () => {
    expect(pySplit('  a   b  ')).toEqual(['a', 'b']);
  });

  // U+0085 (NEL) and U+001C–U+001F are whitespace to Python and not to JS `\s`. U+0085 is the
  // realistic one: it arrives on text pasted out of Word or Google Docs.
  it('splits on the whitespace Python recognises and JS does not', () => {
    expect(pySplit('a\u0085b')).toEqual(['a', 'b']);
    expect(pySplit('a\u001cb\u001fc')).toEqual(['a', 'b', 'c']);
    expect(pySplit('\u0085leading\u001e')).toEqual(['leading']);
  });

  // The divergence in the other direction: JS `\s` matches the BOM, Python does not, so a pasted
  // answer with a leading BOM is one word in Python and would have been zero in a naive port.
  it('does not treat U+FEFF as whitespace', () => {
    expect(pySplit('\ufeffword')).toEqual(['\ufeffword']);
  });

  it('treats the Unicode spaces Python does', () => {
    expect(pySplit('a\u00a0b\u2003c\u3000d')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('pyLen', () => {
  // Only characters outside the BMP separate the two counts — `—`, `≥`, `⚠` and `✅` are all one
  // code unit each, so a case built from those passes under `.length` too and proves nothing.
  it('counts code points, not UTF-16 code units', () => {
    expect(pyLen('🚀')).toBe(1);
    expect(pyLen('LaunchPad 🚀 2026')).toBe(16);
  });
});

describe('pyRstrip', () => {
  it('strips the trailing side only', () => {
    expect(pyRstrip('  kept  ')).toBe('  kept');
  });

  it('strips Python-only whitespace', () => {
    expect(pyRstrip('kept\u0085\u001e')).toBe('kept');
  });

  it('leaves a trailing BOM, as Python does', () => {
    expect(pyRstrip('kept\ufeff')).toBe('kept\ufeff');
  });
});

describe('pyCountSentences', () => {
  it('counts non-blank pieces between terminal punctuation runs', () => {
    expect(pyCountSentences('One. Two! Three?')).toBe(3);
    expect(pyCountSentences('One... Two.')).toBe(2);
    expect(pyCountSentences('')).toBe(0);
    expect(pyCountSentences('   ')).toBe(0);
  });

  it('counts a decimal figure as a sentence break — the prototype rule, kept deliberately', () => {
    expect(pyCountSentences('Our budget is $1.34M.')).toBe(2);
  });
});

describe('pySplitSentences', () => {
  it('keeps terminal punctuation attached', () => {
    expect(pySplitSentences('One. Two!')).toEqual(['One.', 'Two!']);
  });

  it('does not break on punctuation with no following whitespace', () => {
    expect(pySplitSentences('Our budget is $1.34M.')).toEqual(['Our budget is $1.34M.']);
  });

  it('breaks on Python-only whitespace after a terminator', () => {
    expect(pySplitSentences('One.\u0085Two.')).toEqual(['One.', 'Two.']);
  });
});

describe('pyRound', () => {
  // Verified against CPython 3.14.6: round(1.005, 2) == 1.0 and round(0.4235, 3) == 0.423, because
  // both round the exact binary value of the double rather than its shortest decimal form.
  it('rounds the exact binary value, as Python does', () => {
    expect(pyRound(1.005, 2)).toBe(1);
    expect(pyRound(0.4235, 3)).toBe(0.423);
    expect(pyRound(0.4236, 3)).toBe(0.424);
  });

  it('guards the ndigits range its half-even argument holds for', () => {
    expect(() => pyRound(1.5, 0)).toThrow(/ndigits/);
    expect(() => pyRound(1.5, 16)).toThrow(/ndigits/);
    expect(() => pyRound(1.5, 1.5)).toThrow(/ndigits/);
  });
});

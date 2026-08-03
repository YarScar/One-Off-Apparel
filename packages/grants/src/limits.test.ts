import { describe, expect, it } from 'vitest';

import {
  MAX_COMPRESSION_RATIO,
  countUnits,
  measure,
  measureAll,
  truncatePreview,
} from './limits.js';
import { pyCountSentences } from './py.js';

// A funder cap is a submittable constraint: a measurement that is wrong in the permissive direction
// puts an over-length answer in front of a funder, and one that is wrong in the strict direction
// sends staff to rewrite text that already fit. Everything here is arithmetic, so it is all pinned.

describe('countUnits', () => {
  it('counts words as Python str.split() does', () => {
    expect(countUnits('  two   words  ', 'words')).toBe(2);
    expect(countUnits('   ', 'words')).toBe(0);
  });

  it('counts characters as code points', () => {
    expect(countUnits('abc', 'characters')).toBe(3);
    expect(countUnits('abc', 'chars')).toBe(3);
    expect(countUnits('🚀', 'characters')).toBe(1);
  });

  it('counts sentences by terminal punctuation', () => {
    expect(countUnits('One. Two! Three?', 'sentences')).toBe(3);
    expect(countUnits('No terminator', 'sentences')).toBe(1);
    expect(countUnits('', 'sentences')).toBe(0);
  });
});

describe('measure', () => {
  it('reports a fitting text with no preview', () => {
    const m = measure({ text: 'four little words here', unit: 'words', max: 10 });
    expect(m).toMatchObject({ count: 4, fits: true, over_by: 0, ratio: 0.4, verdict: 'fits' });
    expect(m.truncated_preview).toBeUndefined();
  });

  it('echoes the label, or nulls it', () => {
    expect(measure({ label: 'q3', text: 'x', unit: 'words', max: 1 }).label).toBe('q3');
    expect(measure({ text: 'x', unit: 'words', max: 1 }).label).toBeNull();
  });

  it('reports over_by and a preview past the cap', () => {
    const m = measure({ text: 'one two three four five', unit: 'words', max: 3 });
    expect(m).toMatchObject({ count: 5, fits: false, over_by: 2, verdict: 'over_limit' });
    expect(m.truncated_preview).toBe('one two three …');
  });

  // The bug this pins: the verdict used to be read off the 1-decimal display ratio, so 4.04x
  // rounded to 4.0, compared false against MAX_COMPRESSION_RATIO, and came back as an ordinary
  // `over_limit` with "cut the least-essential supporting detail" guidance.
  it('takes the verdict from the exact ratio, not the rounded display value', () => {
    const words = Array.from({ length: 101 }, (_, i) => `w${String(i)}`).join(' ');
    const m = measure({ text: words, unit: 'words', max: 25 });
    expect(m.count / m.max).toBeGreaterThan(MAX_COMPRESSION_RATIO);
    expect(m.ratio).toBe(4); // display still rounds
    expect(m.verdict).toBe('compression_infeasible');
  });

  it('calls exactly 4.0x compressible', () => {
    const m = measure({ text: Array.from({ length: 100 }, () => 'w').join(' '), unit: 'words', max: 25 });
    expect(m.ratio).toBe(4);
    expect(m.verdict).toBe('over_limit');
  });

  it('rejects a non-positive or fractional max rather than reporting Infinity', () => {
    expect(() => measure({ text: 'x', unit: 'words', max: 0 })).toThrow(/positive integer/);
    expect(() => measure({ text: 'x', unit: 'words', max: -3 })).toThrow(/positive integer/);
    expect(() => measure({ text: 'x', unit: 'words', max: 2.5 })).toThrow(/positive integer/);
  });

  it('never returns a sentence preview over the limit, except where no prefix can fit', () => {
    // Splitting and counting use different rules, so a naive slice(0, max) of the chunks can
    // re-measure as more sentences than the cap allows. A decimal figure is all it takes: the
    // counter sees a sentence break inside '$1.34M' and the splitter does not, so this text is
    // three chunks and five counted sentences.
    const text = 'Our FY2025 budget is $1.34M. We serve 145 young people. Ages 18-24.';
    const firstChunk = pyCountSentences('Our FY2025 budget is $1.34M.');
    expect(firstChunk).toBe(2);

    for (const max of [2, 3, 4]) {
      const m = measure({ text, unit: 'sentences', max });
      if (m.truncated_preview === undefined) continue;
      const content = m.truncated_preview.replace(/ …$/, '');
      expect(pyCountSentences(content)).toBeLessThanOrEqual(max);
    }

    // max = 1: not even the first chunk fits, so no prefix of chunks satisfies the cap. The first
    // chunk is kept anyway — an empty preview tells a reviewer nothing, and cutting inside the chunk
    // would mangle the figure, which is the one thing this layer must never do.
    const tight = measure({ text, unit: 'sentences', max: 1 });
    expect(tight.truncated_preview).toBe('Our FY2025 budget is $1.34M. …');
  });

  it('marks every truncated preview as cut', () => {
    const cases = [
      measure({ text: 'one two three', unit: 'words', max: 1 }),
      measure({ text: 'abcdefgh', unit: 'characters', max: 4 }),
      measure({ text: 'One. Two. Three.', unit: 'sentences', max: 1 }),
    ];
    for (const m of cases) {
      expect(m.fits).toBe(false);
      expect(m.truncated_preview).toMatch(/…$/);
    }
  });
});

describe('truncatePreview', () => {
  it('reserves a character slot for the marker', () => {
    expect(truncatePreview('abcdefgh', 'characters', 4)).toBe('abc…');
  });

  it('keeps the first chunk even when it alone exceeds the sentence cap', () => {
    // One chunk to the splitter, two sentences to the counter. Dropping it would leave an empty
    // preview, which tells a reviewer nothing.
    const preview = truncatePreview('Our budget is $1.34M. We serve youth.', 'sentences', 1);
    expect(preview.startsWith('Our budget is $1.34M.')).toBe(true);
    expect(preview).toMatch(/…$/);
  });

  it('does not mark text that was not cut', () => {
    expect(truncatePreview('One. Two.', 'sentences', 5)).toBe('One. Two.');
  });
});

describe('measureAll', () => {
  it('rolls up the batch', () => {
    const batch = measureAll([
      { label: 'a', text: 'fits fine', unit: 'words', max: 5 },
      { label: 'b', text: 'one two three four', unit: 'words', max: 3 },
      { label: 'c', text: Array.from({ length: 50 }, () => 'w').join(' '), unit: 'words', max: 5 },
    ]);
    expect(batch.items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
    expect(batch).toMatchObject({ all_fit: false, over_count: 2, infeasible_count: 1 });
  });

  it('reports all_fit on an empty batch', () => {
    expect(measureAll([])).toMatchObject({ all_fit: true, over_count: 0, infeasible_count: 0 });
  });
});

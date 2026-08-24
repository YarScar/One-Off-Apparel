import { describe, expect, it } from 'vitest';

import { formatDomain, unmatchableFilterError } from '../filter-domain.js';

/**
 * The pure half of the unmatchable-filter fix. Both directions are asserted here and
 * again against a live database in `query-enrollment-filters.test.ts`:
 *
 * - a value absent from its column errors, naming the field and the values present;
 * - a set of values that are each present returns `undefined`, whatever combination
 *   they form. This helper never sees row counts, so it cannot turn a real zero into an
 *   error — that property is the reason the check is shaped as a per-column domain
 *   lookup rather than "the result was empty, so complain".
 */
describe('unmatchableFilterError', () => {
  const ENROLLMENT = {
    field: 'enrollment_status',
    column: 'students.enrollment_status',
    domain: ['E', 'N'],
  } as const;

  it('errors on the value that shipped the defect, and says what to send instead', () => {
    const err = unmatchableFilterError([{ ...ENROLLMENT, value: 'Active' }]);
    expect(err?.error.code).toBe('no_records');
    expect(err?.error.message).toContain("enrollment_status='Active'");
    expect(err?.error.message).toContain('students.enrollment_status');
    expect(err?.error.message).toContain("'E', 'N'");
    expect(err?.error.suggestions?.[0]).toContain("Retry enrollment_status with one of: 'E', 'N'");
  });

  it('passes a value the column holds', () => {
    expect(unmatchableFilterError([{ ...ENROLLMENT, value: 'E' }])).toBeUndefined();
  });

  // The distinction the whole change turns on. Both values exist; whether any student
  // has both is a question about rows, which this helper deliberately cannot see.
  it('passes a combination of present values that may well match nothing', () => {
    expect(
      unmatchableFilterError([
        { field: 'current_phase', column: 'students.current_phase', value: 'LiftOff', domain: ['LiftOff', '101'] },
        { ...ENROLLMENT, value: 'N' },
      ]),
    ).toBeUndefined();
  });

  it('matches literally — case and padding are not near enough', () => {
    expect(unmatchableFilterError([{ ...ENROLLMENT, value: 'e' }])?.error.code).toBe('no_records');
  });

  // Deterministic reporting: the caller sees the same first failure whatever order they
  // happened to send the keys in, because the checks are built in a fixed order.
  it('reports the first failing check only', () => {
    const err = unmatchableFilterError([
      { field: 'current_phase', column: 'students.current_phase', value: 'Nope', domain: ['101'] },
      { ...ENROLLMENT, value: 'Active' },
    ]);
    expect(err?.error.message).toContain('current_phase');
    expect(err?.error.message).not.toContain('enrollment_status');
  });

  it('diagnoses an unpopulated column differently from a wrong value', () => {
    const err = unmatchableFilterError([{ ...ENROLLMENT, domain: [], value: 'E' }]);
    expect(err?.error.code).toBe('no_records');
    expect(err?.error.message).toContain('is null in every row');
    expect(err?.error.suggestions?.some((s) => s.includes('/sync'))).toBe(true);
  });

  it('reports a numeric value unquoted and passes a zero the column holds', () => {
    // Field name is illustrative only — this tests the generic pure function, not any
    // real domain-checked column. (Cohort itself is rejected outright, never
    // domain-checked — see errors.ts cohortNotSupported.)
    const example = { field: 'shoe_size', column: 'students.shoe_size', domain: [0, 3] } as const;
    expect(unmatchableFilterError([{ ...example, value: 0 }])).toBeUndefined();
    const err = unmatchableFilterError([{ ...example, value: 99 }]);
    expect(err?.error.message).toContain('shoe_size=99');
    expect(err?.error.message).not.toContain("'99'");
  });
});

describe('formatDomain', () => {
  it('sorts numbers numerically rather than as strings', () => {
    expect(formatDomain([10, 2, 9])).toBe('2, 9, 10');
  });

  it('sorts and quotes strings', () => {
    expect(formatDomain(['N', 'E'])).toBe("'E', 'N'");
  });

  // A domain check pointed at a free-text column must not return a response larger
  // than the answer would have been.
  it('caps the list and says how many it withheld', () => {
    expect(formatDomain(['a', 'b', 'c'], 2)).toBe("'a', 'b' (+1 more)");
  });
});

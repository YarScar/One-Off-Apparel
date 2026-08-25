import { describe, expect, it } from 'vitest';

import { verifyFigureAnswer, type FigureCall } from './verify.js';

const FIGURE_CALL: FigureCall = {
  tool: 'query_employment',
  args: { query_type: 'aggregate' },
};

describe('verifyFigureAnswer', () => {
  it('passes a drafted figure that appears in the live result', () => {
    const verdict = verifyFigureAnswer(
      'Participants earned $362,030.26 in total wages.',
      FIGURE_CALL,
      { wages_total: 362030.26, wage_participants: 45 },
    );

    expect(verdict.matched).toBe(true);
    expect(verdict.unmatched).toEqual([]);
    expect(verdict.drafted_figures).toEqual(['$362,030.26']);
  });

  it('flags a drafted figure that does not appear anywhere in the live result', () => {
    const verdict = verifyFigureAnswer(
      'Participants earned $350,268 in total wages.',
      FIGURE_CALL,
      { wages_total: 362030.26, wage_participants: 45 },
    );

    expect(verdict.matched).toBe(false);
    expect(verdict.unmatched).toEqual(['$350,268']);
    expect(verdict.live_values).toContain('362030.26');
  });

  it('matches a figure nested inside an array/object result, in string or number form', () => {
    const verdict = verifyFigureAnswer(
      '17 employer partners across the portfolio.',
      { tool: 'query_employment', args: { query_type: 'by_employer' } },
      { by_employer: [{ employer: 'Comcast', placements: 3 }], summary: 'total: 17 employers' },
    );

    expect(verdict.matched).toBe(true);
  });

  it('matches vacuously when the draft carries no literal figure — nothing to check', () => {
    const verdict = verifyFigureAnswer(
      'Building 21 is the fiscal sponsor.',
      FIGURE_CALL,
      { wages_total: 362030.26 },
    );

    expect(verdict.matched).toBe(true);
    expect(verdict.drafted_figures).toEqual([]);
  });

  it('reports every unmatched figure, not just the first, when several are wrong', () => {
    const verdict = verifyFigureAnswer(
      '$999,999 across 12345 records.',
      FIGURE_CALL,
      { wages_total: 362030.26 },
    );

    expect(verdict.matched).toBe(false);
    expect(verdict.unmatched).toEqual(['$999,999', '12345']);
  });

  it('matches a magnitude-suffixed figure against the live raw number it abbreviates', () => {
    const verdict = verifyFigureAnswer(
      'Total annual budget was $1.34M this year.',
      { tool: 'query_finances', args: { query_type: 'annual_budget' } },
      { actuals: 1_340_000 },
    );

    expect(verdict.matched).toBe(true);
    expect(verdict.unmatched).toEqual([]);
  });

  it('still flags a magnitude-suffixed figure whose magnitude is wrong', () => {
    const verdict = verifyFigureAnswer(
      'Total annual budget was $1.34M this year.',
      { tool: 'query_finances', args: { query_type: 'annual_budget' } },
      { actuals: 134_000 },
    );

    expect(verdict.matched).toBe(false);
    expect(verdict.unmatched).toEqual(['$1.34M']);
  });
});

import { describe, expect, it } from 'vitest';

import { DERIVE_RULES, EXPAND_RULES, RESIZE_RULES, buildHandback, type Handback } from './handback.js';
import { measure } from './limits.js';

// This module is the contract between the deterministic layer and the model that calls it, and
// `grant_resize_answer` (G4) will emit the same payload. The rules are the guardrail that makes a
// generated grant answer safe to put in front of a funder, so they are pinned by content, not by
// count — a future edit that drops the no-invention clause has to fail here.

describe('the guardrail rules', () => {
  it('forbids inventing anything, in the resize rules', () => {
    const joined = RESIZE_RULES.join(' ');
    expect(joined).toContain('NEVER invent, add, infer, or embellish');
    expect(joined).toContain('Use ONLY what appears in the source answer');
    // Dropping detail is allowed; altering a figure that stays is not.
    expect(joined).toContain('DROP the least-essential supporting detail');
    expect(joined).toContain('Do not alter, round, or approximate any figure you keep');
    // No preamble, so the reply is usable as the answer text itself.
    expect(joined).toContain('Return ONLY the rewritten answer text');
  });

  it('forbids inventing a value the source does not hold, in the derive rules', () => {
    const joined = DERIVE_RULES.join(' ');
    expect(joined).toContain('Take the value ONLY from the source material');
    expect(joined).toContain('do not guess at a plausible value');
    // The load-bearing rule: an unanswered field beats a fabricated one.
    expect(joined).toContain('An invented value is worse than an unanswered field');
  });

  it('keeps the two rule sets distinct', () => {
    // Resizing compresses prose that already answers the question; deriving extracts one value from
    // prose that answers a broader one. Collapsing them would licence narrative in a Yes/No field.
    expect(RESIZE_RULES).not.toEqual(DERIVE_RULES);
  });
});

describe('buildHandback', () => {
  const context = { funder: 'ACME Fund', emphasis: 'workforce', answers: 'Our mission' };
  const limit = { unit: 'words', max: 3 } as const;
  const measurement = measure({ text: 'one two three four five six', unit: 'words', max: 3 });

  it('assembles a resize handback with everything needed to do the work', () => {
    const h = buildHandback({
      task: 'resize',
      sourceText: 'one two three four five six',
      limit,
      measurement,
      context,
    });
    expect(h.task).toBe('resize');
    expect(h.instruction).toContain('3 words');
    expect(h.source_text).toBe('one two three four five six');
    expect(h.measurement?.count).toBe(6);
    expect(h.rules).toEqual(RESIZE_RULES);
    expect(h.context).toEqual(context);
    expect(h.verify_with).toContain('Re-measure');
  });

  it('names only a registered tool for the re-measure step', () => {
    const h = buildHandback({ task: 'resize', sourceText: 'x', limit, measurement, context });
    // The rule is registration, not intent: pointing a caller at a tool absent from tools/list
    // produces a failed call and a model that improvises around it. Before G4 this named
    // grant_build_draft for exactly that reason. G4 registered grant_resize_answer, which is the tool
    // shaped like the work — one answer, one limit, and a `rewrite` parameter to check.
    expect(h.verify_with).toContain('grant_resize_answer');
    expect(h.verify_with).toContain('rewrite');
    // grant_build_draft has no parameter that accepts a rewritten answer, so naming it here asked for
    // something it could not do.
    expect(h.verify_with).not.toContain('grant_build_draft');
  });

  it('prepends extra rules without displacing the standard guardrail', () => {
    const h = buildHandback({
      task: 'resize',
      sourceText: 'x',
      limit,
      measurement,
      context,
      extraRules: ['Facts WILL have to be dropped.'],
    });
    expect(h.rules[0]).toBe('Facts WILL have to be dropped.');
    expect(h.rules).toEqual(expect.arrayContaining([...RESIZE_RULES]));
    expect(h.rules).toHaveLength(RESIZE_RULES.length + 1);
  });

  it('handles a derive task with no stated limit', () => {
    const h = buildHandback({
      task: 'derive_short_value',
      sourceText: 'long prose',
      limit: null,
      measurement: null,
      context,
    });
    expect(h.rules).toEqual(DERIVE_RULES);
    expect(h.limit).toBeNull();
    expect(h.measurement).toBeNull();
    // With no limit there is nothing to state, so the instruction must not invent one.
    expect(h.instruction).not.toContain('within');
  });

  it('states the limit on a derive task that has one', () => {
    const h = buildHandback({
      task: 'derive_short_value',
      sourceText: 'long prose',
      limit: { unit: 'characters', max: 30 },
      measurement: measure({ text: 'long prose', unit: 'characters', max: 30 }),
      context,
    });
    expect(h.instruction).toContain('30 characters');
  });
});

/**
 * The `expand` task (board `grant-h32`, DECISIONS.md D1e). This is the riskiest handback in the
 * layer: it hands a model a short confirmed fact and a large empty field, which is the exact
 * situation that produces invented grant content. The rules are pinned by CONTENT, like the others,
 * so an edit that softens either load-bearing clause fails here rather than on a funder's desk.
 */
describe('the expand task', () => {
  const context = { funder: 'ACME Fund', emphasis: 'workforce', answers: 'Who we serve' };

  const built = (): Handback =>
    buildHandback({
      task: 'expand',
      sourceText: 'Launchpad serves Philadelphia young people ages 16-24, recruited from more than 30 schools.',
      limit: { unit: 'words', max: 200 },
      measurement: measure({ text: 'Philadelphia young people ages 16-24', unit: 'words', max: 200 }),
      context,
      anchorValue: 'Philadelphia young people ages 16-24',
    });

  it('forbids padding to the limit, which is the failure this task invites', () => {
    // Without this rule the guard would trade a silent under-answer for a padded, invented one —
    // strictly worse, because the first is visible to a reviewer and the second reads as finished.
    expect(EXPAND_RULES.join(' ')).toMatch(/CEILING, NOT A TARGET/);
    expect(EXPAND_RULES.join(' ')).toMatch(/Do not pad/i);
  });

  it('forbids inventing, like every other task', () => {
    expect(EXPAND_RULES.join(' ')).toMatch(/NEVER invent/);
  });

  it('requires the confirmed value to survive verbatim', () => {
    // The anchor is the one part already checked against filed material. A paraphrase silently
    // swaps a verified fact for an unverified one while looking like it did the work.
    expect(EXPAND_RULES.join(' ')).toMatch(/MUST appear in your answer unchanged/);
  });

  it('carries the anchor separately from the source material', () => {
    const h = built();
    // Two different kinds of material: one must be preserved, the other may be drawn on. A caller
    // that concatenated them would lose the distinction every rule above depends on.
    expect(h.anchor_value).toBe('Philadelphia young people ages 16-24');
    expect(h.source_text).toContain('more than 30 schools');
    expect(h.source_text).not.toBe(h.anchor_value);
    expect(h.rules).toEqual(EXPAND_RULES);
  });

  it('names the value and the ceiling in the instruction, and says less is allowed', () => {
    const h = built();
    expect(h.instruction).toContain('Philadelphia young people ages 16-24');
    expect(h.instruction).toContain('200 words');
    expect(h.instruction).toMatch(/Use less/);
  });

  it('carries no anchor on the other two tasks', () => {
    const resize = buildHandback({
      task: 'resize',
      sourceText: 'some prose',
      limit: { unit: 'words', max: 3 },
      measurement: measure({ text: 'some prose', unit: 'words', max: 3 }),
      context,
      anchorValue: 'ignored',
    });
    expect(resize.anchor_value).toBeUndefined();
    expect(resize.rules).toEqual(RESIZE_RULES);
  });
});

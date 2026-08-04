import { describe, expect, it } from 'vitest';

import { loadKnowledgeBase } from './data.js';
import { RESIZE_RULES } from './handback.js';
import { countUnits } from './limits.js';
import { checkFigures, resizeAnswer, type ResizeNote } from './resize.js';
import { FIGURES_SUFFIX, UNVERIFIED_SUFFIX } from './warnings.js';

/**
 * Gate G4. The bar is **12 cases**, and the arithmetic behind that number matters more than the
 * number, because both halves of it were restated rather than met as written.
 *
 * ## Half 1 — the 5 cases moved off G3
 *
 * `admin/SPEC.md` §1 originally set G3 at 25 `test_pipeline.py` cases. Five of them are
 * `ResizeHookTests` cases that inject a `ClaudeResizer` into `build_answer`, and §2.2 says
 * `ClaudeResizer` does not port at all. They were deferred to this gate on 2026-08-04 and land here.
 *
 * | Prototype case | Here |
 * |---|---|
 * | `test_resizer_produces_fitting_draft` | `accepts a rewrite that fits` |
 * | `test_resizer_still_over_is_flagged` | `flags a rewrite that is still over` |
 * | `test_resizer_error_degrades_to_resize_failed` | `degrades without losing the source` |
 * | `test_resizer_receives_context` | `carries the funder, the hat, and the slot to the caller` |
 * | `test_resized_answer_keeps_unverified_warning` | `keeps the unverified warning through a resize` |
 *
 * The injected callable becomes the tool's own call/response boundary: the "resizer" is the model that
 * called the tool, so what the prototype asserted about a callable's arguments is asserted here about
 * the handback, and what it asserted about a callable's return value is asserted about the verify call.
 *
 * ## Half 2 — what `test_resize.py`'s 7 cases actually port to
 *
 * G4's stated bar was "7 resize parity tests pass, with no network". Read against the prototype that
 * bar cannot be met as literal parity, for the same reason G3's could not: **6 of those 7 cases test
 * the code `SPEC.md` §2.2 says does not port.** Five are `ClaudeResizerTests` and one is
 * `MakeResizerTests`. Restated per case:
 *
 * | Prototype case | Status here |
 * |---|---|
 * | `CountUnitsParityTests.test_matches_pipeline` | **Ports** — `count_units is one implementation` |
 * | `test_single_pass_when_fits` | **Ports** — `accepts a rewrite that fits` (shared with half 1) |
 * | `test_retries_when_still_over_then_fits` | **Ports** — `feeds the overflow back on a second pass` |
 * | `test_prompt_includes_limit_and_source` | **Ports** — `assembles the limit, the source, and the funder` |
 * | `test_gives_best_effort_after_max_attempts` | **No analogue.** `MAX_ATTEMPTS` does not port; the loop is the caller's, so this layer has no attempt ceiling to give up at. Recorded, not stubbed. |
 * | `test_uses_latest_model_by_default` | **No analogue.** There is no model and no `DEFAULT_MODEL`. |
 * | `MakeResizerTests.test_unknown_backend_raises` | **No analogue.** `make_resizer` does not port. |
 *
 * So half 2 is **4 cases, not 7**, and the three with no analogue are recorded above rather than
 * written as stand-ins that would pass without testing anything. 5 + 4 = **9 parity cases**. The
 * remaining 3 of the 12 are the beyond-the-prototype group below, which the prototype cannot have a
 * counterpart for because it does not check figure fidelity at all.
 */

// --------------------------------------------------------------------------- helpers

const WORDS_3 = { unit: 'words', max: 3 } as const;

/** The prototype's `_over_limit_match_kb` fixture: 6 words against a 3-word cap. */
const OVER = 'one two three four five six';

// --------------------------------------------------------------------------- half 1: moved off G3

describe('resizeAnswer — the five cases moved off G3', () => {
  it('accepts a rewrite that fits', () => {
    // `test_resizer_produces_fitting_draft` and `test_single_pass_when_fits` collapse into one case
    // here, because a fitting rewrite arriving from the caller is the only way this layer sees one.
    const out = resizeAnswer({ text: OVER, limit: WORDS_3, rewrite: 'one two three' });
    expect(out.notes).toBe<ResizeNote>('fits');
    expect(out.accepted).toBe(true);
    expect(out.text).toBe('one two three');
    expect(out.fits_after_resize).toBe(true);
    expect(out.units_before).toBe(6);
    expect(out.units_after).toBe(3);
    expect(out.answer_full).toBe(OVER);
    // The prototype's `resized_by` named the model. There is none, and the field says so rather than
    // being dropped — a reader of resize.py should find it and find it empty.
    expect(out.model).toBeNull();
    // Nothing is owed once a rewrite is accepted, so there is no handback to act on.
    expect(out.handback).toBeNull();
  });

  it('flags a rewrite that is still over', () => {
    const out = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'still too many words here',
    });
    expect(out.notes).toBe<ResizeNote>('still_over_limit');
    expect(out.fits_after_resize).toBe(false);
    expect(out.accepted).toBe(false);
    // `test_resizer_still_over_is_flagged` asserts the action says so. It must not read as done.
    expect(out.action).toContain('still over');
    // And the rewrite is not offered as an answer, which is the part that matters.
    expect(out.text).toBeNull();
  });

  it('degrades without losing the source', () => {
    // `test_resizer_error_degrades_to_resize_failed`: the prototype's resizer could raise, and the
    // requirement was that `answer_full` and `answer_truncated_preview` survive it. There is no call
    // to raise here, so the analogue is the failure this layer actually has — a rewrite it rejects.
    // The requirement is the same: the source text and its preview must still be there afterwards.
    const rejected = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'one two three four',
    });
    expect(rejected.answer_full).toBe(OVER);
    expect(rejected.answer_truncated_preview).toBe('one two three …');
    // Same on the first call, before any rewrite exists.
    const first = resizeAnswer({ text: OVER, limit: WORDS_3 });
    expect(first.answer_full).toBe(OVER);
    expect(first.answer_truncated_preview).toBe('one two three …');
    expect(first.answer_truncated_preview).not.toBe(first.text);
  });

  it('carries the funder, the hat, and the slot to the caller', () => {
    // `test_resizer_receives_context` spied on the callable's `ctx`. The callable is the calling model
    // now, so the assertion moves to what reaches it: the handback context, plus `kb_ref` on the
    // result. `kb.mission` is a real slot, so the label comes from the knowledge base itself.
    const out = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      context: { funder: 'ACME Fund', emphasis: 'workforce', kbRef: 'kb.mission' },
    });
    expect(out.handback?.context.funder).toBe('ACME Fund');
    expect(out.handback?.context.emphasis).toBe('workforce');
    expect(out.kb_ref).toBe('kb.mission');
    expect(out.handback?.context.answers).not.toBeNull();
  });

  it('keeps the unverified warning through a resize', () => {
    // `test_resized_answer_keeps_unverified_warning`. The flag is read from the slot rather than taken
    // from the caller, so this asserts against whichever real slot is unverified — and asserts the
    // mechanism directly rather than hard-coding a slot name that a seed edit could flip.
    const entries = Object.entries(loadKnowledgeBase().answers);
    const unverified = entries.find(([, e]) => !e.verified);
    const verifiedSlot = entries.find(([, e]) => e.verified);
    expect(unverified).toBeDefined();
    expect(verifiedSlot).toBeDefined();

    const flagged = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'one two three',
      context: { kbRef: unverified?.[0] },
    });
    expect(flagged.verified).toBe(false);
    expect(flagged.action).toContain(UNVERIFIED_SUFFIX.trim());

    const clean = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'one two three',
      context: { kbRef: verifiedSlot?.[0] },
    });
    expect(clean.verified).toBe(true);
    expect(clean.action).not.toContain(UNVERIFIED_SUFFIX.trim());
  });
});

// --------------------------------------------------------------------------- half 2: test_resize.py

describe('resizeAnswer — what test_resize.py ports to', () => {
  it('count_units is one implementation, so the twins cannot drift', () => {
    // `CountUnitsParityTests` existed because resize.py kept its own copy of count_units to avoid
    // importing pipeline.py. Here `limits.ts` holds the only copy and `resize.ts` calls it, so the
    // drift that test guarded against is structurally impossible. Asserted anyway: this is the case
    // that fails if someone reintroduces a second counter.
    for (const [text, unit] of [
      ['a b c', 'words'],
      ['abcde', 'characters'],
      ['One. Two! Three?', 'sentences'],
    ] as const) {
      const viaResize = resizeAnswer({ text, limit: { unit, max: 1 } }).units_before;
      expect(viaResize).toBe(countUnits(text, unit));
    }
  });

  it('feeds the overflow back on a second pass', () => {
    // `test_retries_when_still_over_then_fits`: the prototype's retry carried the overflow into the
    // next prompt. That feedback is now a handback rule, so the caller's next rewrite sees it.
    const second = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'one two three four',
      attempt: 2,
    });
    expect(second.notes).toBe<ResizeNote>('still_over_limit');
    const rules = second.handback?.rules ?? [];
    expect(rules[0]).toContain('still over the 3 words limit');
    expect(rules[0]).toContain('Do not alter any figure you keep');
    // The guardrail is not displaced by the feedback.
    expect(rules).toEqual(expect.arrayContaining([...RESIZE_RULES]));
    // The trace records both measurements, so a reviewer can see the compression that happened.
    expect(second.trace.join(' | ')).toContain('attempt 2: 4/3 words');

    // Then a fitting third pass closes it.
    const third = resizeAnswer({
      text: OVER,
      limit: WORDS_3,
      rewrite: 'one two three',
      attempt: 3,
    });
    expect(third.accepted).toBe(true);
    expect(third.attempts).toBe(3);
  });

  it('assembles the limit, the source, and the funder', () => {
    // `test_prompt_includes_limit_and_source` asserted on the assembled user prompt. There is no
    // prompt; the handback is what the caller reads, so it must carry the same three things.
    const out = resizeAnswer({
      text: 'the original source answer text',
      limit: { unit: 'characters', max: 20 },
      context: { funder: 'ACME Foundation', answers: 'Mission' },
    });
    const h = out.handback;
    expect(h?.instruction).toContain('20 characters');
    expect(h?.source_text).toBe('the original source answer text');
    expect(h?.context.funder).toBe('ACME Foundation');
    expect(h?.context.answers).toBe('Mission');
    expect(h?.limit).toEqual({ unit: 'characters', max: 20 });
  });

  it('hands back rather than refusing, and says a rewrite is owed', () => {
    const out = resizeAnswer({ text: OVER, limit: WORDS_3 });
    expect(out.notes).toBe<ResizeNote>('rewrite_owed');
    expect(out.accepted).toBe(false);
    expect(out.text).toBeNull();
    expect(out.units_after).toBeNull();
    expect(out.fits_after_resize).toBeNull();
    expect(out.figure_check).toBeNull();
    expect(out.handback?.task).toBe('resize');
    expect(out.handback?.rules).toEqual(RESIZE_RULES);
  });
});

// --------------------------------------------------------------------------- beyond the prototype

describe('resizeAnswer — figure fidelity, which the prototype does not check', () => {
  it('rejects a rewrite stating a figure the source does not', () => {
    const out = resizeAnswer({
      text: 'We served 145 young people across two campuses.',
      limit: { unit: 'words', max: 5 },
      rewrite: 'We served 180 young people.',
    });
    // It fits on length. That is precisely the case the prototype marks `fits` and passes through.
    expect(out.fits_after_resize).toBe(true);
    expect(out.notes).toBe<ResizeNote>('figures_altered');
    expect(out.accepted).toBe(false);
    expect(out.text).toBeNull();
    expect(out.figure_check?.invented).toContain('180');
    expect(out.action).toContain('REJECTED');
    // And the caller is sent back to the source, not to its own rewrite.
    expect(out.handback?.source_text).toBe('We served 145 young people across two campuses.');
    expect(out.handback?.rules[0]).toContain('180');
  });

  it('allows a rewrite that drops a figure, because dropping detail is in the rules', () => {
    const out = resizeAnswer({
      text: 'We served 145 young people and placed 92 in jobs.',
      limit: { unit: 'words', max: 5 },
      rewrite: 'We served 145 young people.',
    });
    expect(out.accepted).toBe(true);
    expect(out.figure_check?.ok).toBe(true);
    expect(out.figure_check?.dropped).toContain('92');
    expect(out.figure_check?.invented).toEqual([]);
  });

  it('refuses to call a 46x overrun a resize job', () => {
    // The real case from `limits.ts`: `cover.project_title` is a 30-character field pointed at a
    // 1403-character program description. Past MAX_COMPRESSION_RATIO this is not compression, and the
    // handback has to say facts will be dropped rather than implying a tighter draft exists.
    const out = resizeAnswer({
      text: 'w '.repeat(60).trim(),
      limit: { unit: 'words', max: 3 },
    });
    expect(out.notes).toBe<ResizeNote>('compression_infeasible');
    expect(out.handback?.rules[0]).toContain('Facts WILL have to be dropped');
    expect(out.handback?.rules[0]).toContain('short structured value');
    expect(out.action).toContain('state which facts you dropped');
  });
});

describe('checkFigures', () => {
  it('compares on value rather than formatting', () => {
    // A rewrite may reformat what it keeps; rule 2 forbids altering a figure, not re-punctuating it.
    const c = checkFigures('Our budget is $1,200 and 45% of it is program spend.', 'Budget 1200, 45%.');
    expect(c.ok).toBe(true);
    expect(c.invented).toEqual([]);
  });

  it('spans a thousands comma, so 8,000 becoming 9,000 is caught', () => {
    // The case that motivated a separate extraction pattern. `\b\d{2,}\b` stops at the comma, so both
    // texts tokenised as `000` and compared equal — and comma-grouped counts are most of what grant
    // prose states. Measured against the real knowledge base on 2026-08-04: with the dedicated
    // pattern, every one of the 29 slots that states a figure has a tampered digit detected, and
    // neither an identity rewrite nor a genuine sentence-level trim reports a false positive.
    const c = checkFigures('Roughly 8,000 students a year graduate.', 'Roughly 9,000 students graduate.');
    expect(c.ok).toBe(false);
    expect(c.invented).toEqual(['9000']);
    expect(c.dropped).toEqual(['8000']);
  });

  it('reports a repeated figure the source states once', () => {
    // Two claims, not one restated — so it is caught rather than matched against the same source token.
    const c = checkFigures('We ran 12 sessions.', 'We ran 12 sessions across 12 sites.');
    expect(c.ok).toBe(false);
    expect(c.invented).toEqual(['12']);
  });

  it('is silent on text with no figures at all', () => {
    const c = checkFigures('Our mission is plain prose.', 'Plain prose.');
    expect(c.ok).toBe(true);
    expect(c.source_figures).toEqual([]);
    expect(c.rewrite_figures).toEqual([]);
  });
});

// --------------------------------------------------------------------------- warnings

describe('resizeAnswer — the data-honesty warnings', () => {
  it('warns that a source carrying figures needs live verification', () => {
    const out = resizeAnswer({
      text: 'We served 145 young people and placed 92 in jobs this year.',
      limit: WORDS_3,
    });
    expect(out.carries_figures).toBe(true);
    expect(out.action).toContain(FIGURES_SUFFIX.trim());
  });

  it('says nothing about grounding when no slot was named', () => {
    // `verified: null` is not a clean bill of health, so the action line must not read as one.
    const out = resizeAnswer({ text: OVER, limit: WORDS_3 });
    expect(out.verified).toBeNull();
    expect(out.action).not.toContain(UNVERIFIED_SUFFIX.trim());
    expect(out.action).not.toContain('grounded');
  });
});

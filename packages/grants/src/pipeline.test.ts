import { describe, expect, it } from 'vitest';

import { listFormIds, loadBank, loadForm, loadKnowledgeBase } from './data.js';
import { DERIVE_RULES, RESIZE_RULES } from './handback.js';
import {
  STATUS_ACTOR,
  STATUS_NOTE,
  buildAnswer,
  renderMarkdown,
  runPipeline,
  type AnswerPlan,
  type AnswerStatus,
} from './pipeline.js';
import type { AnswerType, FormLimit, KnowledgeBase } from './schemas.js';
import type { MatchResult } from './matcher.js';

/**
 * Parity with the prototype's `tests/test_pipeline.py`, which has 25 cases across five classes.
 *
 * | Prototype class | Cases | Where they live now |
 * |---|---|---|
 * | `CountUnitsTests` | 5 | `limits.test.ts` — `count_units` ported into `limits.ts`, not here |
 * | `TruncatePreviewTests` | 3 | `limits.test.ts` — same reason |
 * | `BuildAnswerTests` | 9 | here, one-for-one |
 * | `ResizeHookTests` | 6 | 1 here (`resizer absent` ≡ resize off); 5 are gate G4 |
 * | `RunTests` | 2 | here, one-for-one |
 *
 * So 20 of the 25 are covered at G3 and 5 are deferred with the resize tool they test. The five
 * deferred cases exercise `ClaudeResizer`, which `admin/SPEC.md` §2.2 says does not port at all — an
 * MCP tool is invoked *by* Claude, so there is no in-process resizer to inject. They cannot pass
 * before `grant_resize_answer` exists, and writing stand-ins that pass without it would make the
 * gate report coverage it does not have.
 *
 * Everything below `--- beyond the prototype ---` has no prototype counterpart. Those branches exist
 * because the prototype is wrong on real seed data; see the `pipeline.ts` module comment.
 */

// --------------------------------------------------------------------------- helpers

/** Stand-in for a matcher result, so `buildAnswer` branches can be driven without the live bank. */
function match(over: Partial<MatchResult> = {}): MatchResult {
  return {
    incoming: 'Q?',
    matched_id: 'q.x',
    canonical: 'Q?',
    category: 'org',
    kb_ref: 'kb.mission',
    answer_type: 'narrative',
    confidence: 0.9,
    matched_via: 'canonical',
    is_confident: true,
    ...over,
  };
}

function kbWith(ref: string, text: string, verified = false): KnowledgeBase {
  return {
    meta: {
      org: 'LaunchPad',
      updated: '2026-07-23',
      note: '',
      source_recency: '',
      connector_reconciliation: '',
    },
    answers: { [ref]: { label: 'L', verified, text } },
  };
}

const WORDS = (max: number): FormLimit => ({ unit: 'words', max });

// --------------------------------------------------------------------------- BuildAnswerTests

describe('buildAnswer — prototype BuildAnswerTests', () => {
  it('routes a low-confidence match to needs_review', () => {
    const out = buildAnswer(match({ is_confident: false, confidence: 0.2 }), null, kbWith('kb.mission', 'text'));
    expect(out.status).toBe<AnswerStatus>('needs_review');
    expect(out.actor).toBe('staff');
    // The whole point of the branch: it must not hand back the answer it nearly matched.
    expect(out.answer).toBeUndefined();
    expect(out.handback).toBeUndefined();
  });

  it('treats a null kb_ref as per_application', () => {
    const out = buildAnswer(match({ kb_ref: null }), null, kbWith('kb.mission', 'text'));
    expect(out.status).toBe<AnswerStatus>('per_application');
    expect(out.actor).toBe('staff');
  });

  it('reports a kb_ref with no entry as kb_gap', () => {
    const out = buildAnswer(match({ kb_ref: 'kb.absent' }), null, kbWith('kb.mission', 'text'));
    expect(out.status).toBe<AnswerStatus>('kb_gap');
    expect(out.action).toContain('kb.absent');
  });

  it('flags a placeholder entry', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', '[PLACEHOLDER] fill me'));
    expect(out.status).toBe<AnswerStatus>('kb_placeholder');
    expect(out.actor).toBe('staff');
    // Never hand a placeholder marker to the model to compress.
    expect(out.handback).toBeUndefined();
  });

  it('accepts an answer inside the limit', () => {
    const out = buildAnswer(match(), WORDS(5), kbWith('kb.mission', 'three word answer', true));
    expect(out.status).toBe<AnswerStatus>('fits');
    expect(out.answer).toBe('three word answer');
    expect(out.measurement).toMatchObject({ count: 3, max: 5, fits: true });
    expect(out.actor).toBe('none');
  });

  it('reports an over-limit answer with a truncation preview and no drafted answer', () => {
    const out = buildAnswer(match(), WORDS(3), kbWith('kb.mission', 'one two three four five six', true));
    expect(out.status).toBe<AnswerStatus>('needs_resize');
    expect(out.handback?.source_text).toBe('one two three four five six');
    expect(out.measurement?.truncated_preview).toBeDefined();
    // An over-limit answer must never present as a usable draft.
    expect(out.answer).toBeUndefined();
  });

  it('marks an answer with no stated limit as ready', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'text', true));
    expect(out.status).toBe<AnswerStatus>('ready');
    expect(out.measurement).toBeUndefined();
    expect(out.actor).toBe('none');
  });

  it('appends the unverified-figures warning', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'text', false));
    expect(out.action).toContain('unverified');
    expect(out.verified).toBe(false);
  });

  it('leaves a verified answer without that warning', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'text', true));
    expect(out.action).not.toContain('unverified');
    expect(out.verified).toBe(true);
  });
});

// --------------------------------------------------------------------------- ResizeHookTests

describe('buildAnswer — resize is off at this gate, so it hands back instead', () => {
  // The prototype's `test_resizer_absent_still_reports_needs_resize`. The other five cases in that
  // class inject a resizer, which does not exist at G3 and does not port at all — see the header.
  it('does not rewrite, and does not claim a post-rewrite measurement', () => {
    const out = buildAnswer(match(), WORDS(3), kbWith('kb.mission', 'one two three four five six', true));
    expect(out.status).toBe<AnswerStatus>('needs_resize');
    // The measurement is of the SOURCE, not of any rewrite. Nothing was rewritten.
    expect(out.measurement?.count).toBe(6);
    expect(out.handback?.measurement?.count).toBe(6);
  });
});

// --------------------------------------------------------------------------- RunTests

describe('runPipeline — prototype RunTests', () => {
  const bank = loadBank();
  const kb = loadKnowledgeBase();

  it('produces a report whose status counts sum to the question count', () => {
    const pkg = runPipeline(
      {
        meta: { funder: 'Test', program: 'P' },
        questions: [{ text: 'What is your mission?' }, { text: 'What is your refund policy for merchandise?' }],
      },
      bank,
      kb,
    );
    expect(pkg.summary.total).toBe(2);
    expect(pkg.results).toHaveLength(2);
    const summed = Object.values(pkg.summary.by_status).reduce((a, b) => a + b, 0);
    expect(summed).toBe(2);
  });

  it('carries every incoming question text through, in form order', () => {
    const pkg = runPipeline({ meta: { funder: 'F' }, questions: [{ text: 'What is your mission?' }] }, bank, kb);
    expect(pkg.results[0]?.incoming).toBe('What is your mission?');
  });
});

// --------------------------------------------------------------------------- the handback contract

describe('the handback — outstanding text work goes to the calling model, not to a person', () => {
  // This is what the layer is for: the knowledge base assists the model so it does not regenerate
  // answers LaunchPad already approved. When a stored answer does not drop straight in, the material
  // goes back to the model with the rules. Nothing here is a dead end.
  const over = (): AnswerPlan =>
    buildAnswer(match(), WORDS(3), kbWith('kb.mission', 'one two three four five six', true));

  it('routes every llm-actor status through a handback, and no staff status through one', () => {
    const pkg = runPipeline(loadForm('aug7_truist'));
    for (const r of pkg.results) {
      expect(r.actor).toBe(STATUS_ACTOR[r.status]);
      if (r.actor === 'llm') expect(r.handback).toBeDefined();
      else expect(r.handback).toBeUndefined();
    }
    // Both kinds of outstanding work exist in this fixture, or the assertion above proves nothing.
    expect(pkg.summary.by_actor.llm).toBeGreaterThan(0);
    expect(pkg.summary.by_actor.staff).toBeGreaterThan(0);
  });

  it('carries the source text, the limit, the measurement, and the no-invention rule', () => {
    const h = over().handback;
    expect(h?.task).toBe('resize');
    expect(h?.source_text).toBe('one two three four five six');
    expect(h?.limit).toEqual({ unit: 'words', max: 3 });
    expect(h?.measurement?.count).toBe(6);
    expect(h?.rules).toEqual(RESIZE_RULES);
    // The guardrail that makes a generated grant answer safe to show a funder at all.
    expect(h?.rules.join(' ')).toContain('NEVER invent, add, infer, or embellish');
  });

  it('passes the funder and the framing through as context, not as licence to add', () => {
    const pkg = runPipeline(loadForm('aug7_truist'));
    const h = pkg.results.find((r) => r.handback !== undefined)?.handback;
    expect(h?.context.funder).toContain('Truist');
    expect(h?.context.emphasis).toContain('Building 21');
    expect(h?.context.answers).toBeTruthy();
  });

  it('tells the caller to re-measure rather than counting words itself', () => {
    expect(over().handback?.verify_with).toContain('Re-measure');
  });
});

// --------------------------------------------------------------------------- beyond the prototype

describe('derive_from_reference — a short field gets the prose as source, not as the answer', () => {
  // Why this branch exists: every one of the 42 non-narrative questions in the v0.4.0 bank routes to
  // a narrative KB slot, the shortest being 30 words. The prototype returns that prose as the answer.
  // Pasting 124 words of kb.eligibility into "Are you a 501(c)(3)? Yes/No" is wrong — but the model
  // can derive the answer from it, so it is handed over rather than withheld.
  const DERIVABLE: readonly AnswerType[] = [
    'field',
    'number',
    'boolean',
    'single_select',
    'multi_select',
    'demographic',
  ];

  it.each(DERIVABLE)('hands %s prose back for the model to derive from', (type) => {
    const out = buildAnswer(match({ answer_type: type }), null, kbWith('kb.mission', 'long narrative prose', true));
    expect(out.status).toBe<AnswerStatus>('derive_from_reference');
    expect(out.actor).toBe('llm');
    expect(out.handback?.task).toBe('derive_short_value');
    expect(out.handback?.source_text).toBe('long narrative prose');
    expect(out.handback?.rules).toEqual(DERIVE_RULES);
    // The rule that stops a derived value being invented when the source lacks it.
    expect(out.handback?.rules.join(' ')).toContain('does not contain the value');
    // The prose is source material, never the answer.
    expect(out.answer).toBeUndefined();
  });

  it('sends an attachment question to staff instead, because an upload is not text', () => {
    const out = buildAnswer(
      match({ answer_type: 'attachment', kb_ref: 'kb.docs' }),
      null,
      kbWith('kb.docs', 'checklist', true),
    );
    expect(out.status).toBe<AnswerStatus>('needs_attachment');
    expect(out.actor).toBe('staff');
    expect(out.handback).toBeUndefined();
    // The checklist is shown, since it is what the person needs.
    expect(out.answer).toBe('checklist');
  });

  it('still drafts a narrative question', () => {
    const out = buildAnswer(match({ answer_type: 'narrative' }), null, kbWith('kb.mission', 'prose', true));
    expect(out.status).toBe<AnswerStatus>('ready');
    expect(out.answer).toBe('prose');
  });

  it('takes precedence over the length check, so a 46x overrun is not mistaken for a resize job', () => {
    // Truist's 30-character "name of your solution" field routes to a 199-word slot. Handing that to
    // a resizer asks for a shorter narrative; the field wants a name. The measurement is still
    // reported, because a reviewer should see the scale of the mismatch.
    const out = buildAnswer(match({ answer_type: 'field' }), { unit: 'characters', max: 30 }, kbWith('kb.mission', 'a'.repeat(1400), true));
    expect(out.status).toBe<AnswerStatus>('derive_from_reference');
    expect(out.handback?.task).toBe('derive_short_value');
    expect(out.measurement?.count).toBe(1400);
  });
});

describe('compression_infeasible — still handed back, with the fact-dropping named', () => {
  it('separates a far overrun from an ordinary one without dead-ending either', () => {
    const ordinary = buildAnswer(match(), WORDS(5), kbWith('kb.mission', 'one two three four five six', true));
    expect(ordinary.status).toBe<AnswerStatus>('needs_resize');
    expect(ordinary.handback?.rules).toEqual(RESIZE_RULES);

    const far = buildAnswer(match(), WORDS(1), kbWith('kb.mission', 'one two three four five six', true));
    expect(far.status).toBe<AnswerStatus>('compression_infeasible');
    // The point of the correction: this is llm work with a warning, not a refusal.
    expect(far.actor).toBe('llm');
    expect(far.handback?.task).toBe('resize');
    expect(far.action).toContain('which facts you dropped');
    // The extra rule is prepended to, not substituted for, the standard guardrail.
    expect(far.handback?.rules.length).toBeGreaterThan(RESIZE_RULES.length);
    expect(far.handback?.rules[0]).toContain('Facts WILL have to be dropped');
    expect(far.handback?.rules).toEqual(expect.arrayContaining([...RESIZE_RULES]));
  });
});

describe('carries_figures — independent of the KB verified flag', () => {
  it('flags figures in a verified answer', () => {
    // The dangerous case: verified:true means "grounded in a filed application", which says nothing
    // about whether the figures are current. kb.metrics is verified and its wage figure drifts.
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'We paid $350,268 to 45 participants.', true));
    expect(out.carries_figures).toBe(true);
    expect(out.action).toContain('verify every one against live data');
    expect(out.action).not.toContain('unverified');
  });

  it('does not flag prose with no figures', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'We serve young people in Philadelphia.', true));
    expect(out.carries_figures).toBe(false);
  });

  it('carries both warnings when both apply', () => {
    const out = buildAnswer(match(), null, kbWith('kb.mission', 'We paid $350,268.', false));
    expect(out.action).toContain('unverified');
    expect(out.action).toContain('verify every one against live data');
  });
});

describe('the draft package', () => {
  it('returns a figure work order scoped to the slots it used, and calls no connector', () => {
    const pkg = runPipeline(loadForm('aug7_truist'));
    expect(pkg.kb_refs_used.length).toBeGreaterThan(0);
    expect(pkg.figure_work_order.items.length).toBeGreaterThan(0);
    // Scoped, not the whole map: every returned check must touch a slot this draft actually used.
    for (const item of pkg.figure_work_order.items) {
      expect(item.appears_in.some((ref) => pkg.kb_refs_used.includes(ref))).toBe(true);
    }
    // The work order names calls for the caller to make. It must never contain results.
    for (const item of pkg.figure_work_order.items) {
      expect(item.tool).toMatch(/^(query_|get_|search_)/);
      expect(item.args).toBeDefined();
    }
  });

  it('counts every question against exactly one actor', () => {
    const pkg = runPipeline(loadForm('aug7_truist'));
    const { none, llm, staff } = pkg.summary.by_actor;
    expect(none + llm + staff).toBe(pkg.summary.total);
  });

  it('reports all_fit only when nothing overran a stated limit', () => {
    const over = runPipeline(loadForm('aug7_truist'));
    expect(over.summary.all_fit).toBe(false);

    const fitting = runPipeline({
      meta: { funder: 'F' },
      questions: [{ text: 'What is your mission?', limit: { unit: 'words', max: 5000 } }],
    });
    expect(fitting.summary.all_fit).toBe(true);
  });

  it('resolves every seeded form fixture without throwing', () => {
    for (const id of listFormIds()) {
      const pkg = runPipeline(loadForm(id));
      expect(pkg.summary.total).toBe(pkg.results.length);
      const summed = Object.values(pkg.summary.by_status).reduce((a, b) => a + b, 0);
      expect(summed).toBe(pkg.summary.total);
      for (const r of pkg.results) {
        // Every result carries an action a reviewer can act on. An empty one is a silent dead end.
        expect(r.action.length).toBeGreaterThan(0);
        // And every one names who acts, consistently with the exported mapping.
        expect(r.actor).toBe(STATUS_ACTOR[r.status]);
      }
    }
  });
});

describe('renderMarkdown', () => {
  const pkg = runPipeline(loadForm('aug7_truist'));
  const md = renderMarkdown(pkg);

  it('leads with the not-submittable banner', () => {
    expect(md).toContain('not submittable as-is');
    // The banner must precede any answer text, so it cannot be scrolled past unread.
    expect(md.indexOf('not submittable')).toBeLessThan(md.indexOf('## 1.'));
  });

  it('splits the outstanding count by who owes the work', () => {
    expect(md).toContain(`${String(pkg.summary.by_actor.llm)} awaiting a rewrite`);
    expect(md).toContain(`${String(pkg.summary.by_actor.staff)} awaiting staff`);
  });

  it('renders one numbered section per question, in form order', () => {
    for (const [i, r] of pkg.results.entries()) {
      expect(md).toContain(`## ${String(i + 1)}. ${r.incoming}`);
    }
  });

  it('emits a provenance footline with the canonical id, KB slot, and measurement', () => {
    const fits = pkg.results.find((r) => r.status === 'fits');
    expect(fits).toBeDefined();
    expect(md).toContain(`canonical \`${String(fits?.matched_id)}\``);
    expect(md).toContain(`KB \`${String(fits?.kb_ref)}\``);
    expect(md).toContain(`length ${String(fits?.measurement?.count)} / ${String(fits?.measurement?.max)}`);
  });

  it('collapses handback source text instead of blockquoting it as the answer', () => {
    const owed = pkg.results.map((r, i) => ({ r, i })).filter(({ r }) => r.handback !== undefined);
    expect(owed.length).toBeGreaterThan(0);
    for (const { r, i } of owed) {
      const section = sectionFor(md, i);
      expect(section).toContain('<details>');
      // The source must not appear as a blockquote, which is how a finished answer renders.
      expect(section).not.toContain(`> ${String(r.handback?.source_text)}`);
      // The status note has to precede the source, not follow it.
      expect(section.indexOf(STATUS_NOTE[r.status])).toBeLessThan(section.indexOf('<details>'));
    }
  });

  it('marks a truncation preview as not a resize', () => {
    expect(pkg.results.some((r) => r.measurement?.truncated_preview !== undefined)).toBe(true);
    expect(md).toContain('NOT a resize');
  });

  it('labels every over-limit section OVER LIMIT in its own section', () => {
    const over = pkg.results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'needs_resize' || r.status === 'compression_infeasible');
    expect(over.length).toBeGreaterThan(0);
    for (const { r, i } of over) {
      expect(sectionFor(md, i)).toContain('OVER LIMIT');
      // The full text is shown for shaping, but never as a finished answer.
      expect(r.answer).toBeUndefined();
    }
  });

  it('renders the module’s own status note for every status it emits', () => {
    for (const [i, r] of pkg.results.entries()) {
      expect(sectionFor(md, i)).toContain(STATUS_NOTE[r.status]);
    }
  });
});

/** The rendered section for question `index`, from its heading to the next one. */
function sectionFor(md: string, index: number): string {
  const start = md.indexOf(`## ${String(index + 1)}. `);
  expect(start).toBeGreaterThan(-1);
  const next = md.indexOf(`## ${String(index + 2)}. `, start);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

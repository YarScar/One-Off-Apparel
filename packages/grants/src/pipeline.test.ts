import { describe, expect, it } from 'vitest';

import { listFormIds, loadBank, loadForm, loadKnowledgeBase } from './data.js';
import {
  DERIVE_RULES,
  EXPAND_RULES,
  EXPAND_RULES_NO_ANCHOR,
  RESIZE_RULES,
} from './handback.js';
import { buildFigureWorkOrder } from './figures.js';
import {
  STATUS_ACTOR,
  STATUS_NOTE,
  buildAnswer,
  renderMarkdown,
  runPipeline,
  type AnswerPlan,
  type AnswerStatus,
  type DraftPackage,
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

  it('routes every llm-actor status through a handback or a figure_call, and no staff status through one', () => {
    const pkg = runPipeline(loadForm('aug7_truist'));
    for (const r of pkg.results) {
      expect(r.actor).toBe(STATUS_ACTOR[r.status]);
      if (r.actor === 'llm') {
        // A live-figure question has no prose to shape — the work is the query_* call instead.
        if (r.status === 'fetch_figure') expect(r.figure_call).toBeDefined();
        else expect(r.handback).toBeDefined();
      } else {
        expect(r.handback).toBeUndefined();
        // A definitional figure is staff work, but the query call still travels with it so staff
        // knows what to run before deciding which population the funder means.
        if (r.status === 'figure_definitional') expect(r.figure_call).toBeDefined();
        else expect(r.figure_call).toBeUndefined();
      }
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
    expect(h?.context.emphasis).toBe('fiscal_sponsorship');
    expect(h?.context.answers).toBeTruthy();
  });

  it('tells the caller to re-measure rather than counting words itself', () => {
    expect(over().handback?.verify_with).toContain('Re-measure');
  });
});

// --------------------------------------------------------------------------- beyond the prototype

describe('derive_from_reference — a short field gets the prose as source, not as the answer', () => {
  // Why this branch exists: 35 of the 43 non-narrative questions in the v0.4.1 bank route to
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

// The module comment on `buildAnswer` calls its branch order "load-bearing": confidence, then
// kb_ref, then whether it resolves, then whether it is real content, and only then length/type.
// Most adjacent branches are already pinned by a test elsewhere in this file (structured-vs-
// derive_from_reference, derive_from_reference-vs-length, figure-gate-vs-resolveTextAnswer). These
// four fixtures cover the ones that were not: each satisfies two branches' predicates at once and
// asserts the earlier branch — the one prose says must win — actually does. #13, WP #333.
describe('buildAnswer branch order — pairs no other test exercises together', () => {
  it('confidence beats a null kb_ref: needs_review, not per_application', () => {
    const out = buildAnswer(match({ is_confident: false, confidence: 0.2, kb_ref: null }), null, kbWith('kb.mission', 'text'));
    expect(out.status).toBe<AnswerStatus>('needs_review');
    expect(out.actor).toBe('staff');
  });

  it('confidence beats a placeholder entry: needs_review, not kb_placeholder', () => {
    const out = buildAnswer(
      match({ is_confident: false, confidence: 0.2 }),
      null,
      kbWith('kb.mission', '[PLACEHOLDER] fill me'),
    );
    expect(out.status).toBe<AnswerStatus>('needs_review');
  });

  it('a placeholder beats attachment routing: kb_placeholder, not needs_attachment', () => {
    // Reordering these would hand a person "gather and upload the files" for a KB slot that was
    // never written, instead of telling them the slot itself is the problem.
    const out = buildAnswer(
      match({ answer_type: 'attachment', kb_ref: 'kb.docs' }),
      null,
      kbWith('kb.docs', '[PLACEHOLDER] checklist tbd'),
    );
    expect(out.status).toBe<AnswerStatus>('kb_placeholder');
  });

  it('a placeholder beats fetch_figure: kb_placeholder, not a live-figure instruction', () => {
    // The concrete failure the module comment warns about: swap this pair and a number question on
    // an unwritten KB slot would silently tell the caller to run query_finances and write the
    // returned figure, never surfacing that the slot itself has no real content.
    const out = buildAnswer(
      match({ answer_type: 'number', kb_ref: 'kb.financials', matched_id: 'financials.operating_budget' }),
      null,
      kbWith('kb.financials', '[PLACEHOLDER] figure tbd'),
    );
    expect(out.status).toBe<AnswerStatus>('kb_placeholder');
    expect(out.figure_call).toBeUndefined();
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

// --------------------------------------------------------------------------- D1: structured values and live figures

describe('structured values — a stored short value is the answer, keyed by question id', () => {
  it('returns the value as a real answer, ahead of derive_from_reference', () => {
    const out = buildAnswer(
      match({ answer_type: 'field', kb_ref: 'kb.program_desc', matched_id: 'cover.project_title' }),
      null,
      { ...kbWith('kb.program_desc', 'long narrative', true), answers: { 'kb.program_desc': { label: 'L', verified: true, text: 'long narrative', structured: { 'cover.project_title': { value: 'Launchpad', verified: true } } } } },
    );
    expect(out.status).toBe<AnswerStatus>('ready');
    expect(out.actor).toBe('none');
    expect(out.answer).toBe('Launchpad');
    expect(out.handback).toBeUndefined();
    // The provenance must mark it as structured, so a reviewer can tell it apart from a derived one.
    expect(out.from_structured).toBe(true);
  });

  it('measures a structured value against the funder limit', () => {
    const out = buildAnswer(
      match({ answer_type: 'field', kb_ref: 'kb.program_desc', matched_id: 'cover.project_title' }),
      { unit: 'characters', max: 30 },
      { ...kbWith('kb.program_desc', 'long narrative', true), answers: { 'kb.program_desc': { label: 'L', verified: true, text: 'long narrative', structured: { 'cover.project_title': { value: 'Launchpad', verified: true } } } } },
    );
    expect(out.status).toBe<AnswerStatus>('fits');
    expect(out.answer).toBe('Launchpad');
    expect(out.measurement?.count).toBe(9);
  });

  it('does not fire for a question with no structured value on the same slot', () => {
    // kb.eligibility answers eight questions; the one without a value must still derive.
    const out = buildAnswer(
      match({ answer_type: 'single_select', kb_ref: 'kb.eligibility', matched_id: 'eligibility.minority_owned' }),
      null,
      { ...kbWith('kb.eligibility', 'narrative', true), answers: { 'kb.eligibility': { label: 'L', verified: true, text: 'narrative', structured: { 'cover.fiscal_sponsor': { value: 'yes', verified: true } } } } },
    );
    expect(out.status).toBe<AnswerStatus>('derive_from_reference');
    expect(out.actor).toBe('llm');
  });

  it('picks a structured value by framing when the slot carries by_framing variants, and falls back without one', () => {
    const kbFor = (): KnowledgeBase => ({
      ...kbWith('kb.eligibility', 'narrative', true),
      answers: {
        'kb.eligibility': {
          label: 'L',
          verified: true,
          text: 'narrative',
          structured: {
            'cover.fiscal_sponsor': {
              value: 'default value',
              verified: true,
              by_framing: { initiative: 'initiative value', fiscal_sponsorship: 'sponsorship value' },
            },
          },
        },
      },
    });
    const m = match({ answer_type: 'boolean', kb_ref: 'kb.eligibility', matched_id: 'cover.fiscal_sponsor' });

    const initiative = buildAnswer(m, null, kbFor(), { funder: null, emphasis: 'initiative' });
    expect(initiative.answer).toBe('initiative value');

    const sponsorship = buildAnswer(m, null, kbFor(), { funder: null, emphasis: 'fiscal_sponsorship' });
    expect(sponsorship.answer).toBe('sponsorship value');

    // 'silent' has no listed variant on this slot, and no framing at all is the same as none supplied
    // — both fall back to the base `value` rather than throwing or returning undefined.
    const silent = buildAnswer(m, null, kbFor(), { funder: null, emphasis: 'silent' });
    expect(silent.answer).toBe('default value');
    const none = buildAnswer(m, null, kbFor());
    expect(none.answer).toBe('default value');
  });

  it('attaches the compression-infeasible warning to a structured value too, not just narrative text', () => {
    // Before resolveTextAnswer unified the two branches, only the narrative branch attached
    // infeasibleRule's warning to handback.extraRules — the structured branch dropped it silently.
    const out = buildAnswer(
      match({ answer_type: 'field', kb_ref: 'kb.program_desc', matched_id: 'cover.project_title' }),
      WORDS(1),
      {
        ...kbWith('kb.program_desc', 'long narrative', true),
        answers: {
          'kb.program_desc': {
            label: 'L',
            verified: true,
            text: 'long narrative',
            structured: { 'cover.project_title': { value: 'one two three four five six', verified: true } },
          },
        },
      },
    );
    expect(out.status).toBe<AnswerStatus>('compression_infeasible');
    expect(out.actor).toBe('llm');
    expect(out.action).toContain('which facts you dropped');
    expect(out.handback?.rules.length).toBeGreaterThan(RESIZE_RULES.length);
    expect(out.handback?.rules[0]).toContain('Facts WILL have to be dropped');
    expect(out.handback?.rules).toEqual(expect.arrayContaining([...RESIZE_RULES]));
  });

  it('lets a per-value verified flag override the entry-level one', () => {
    const out = buildAnswer(
      match({ answer_type: 'field', kb_ref: 'kb.profile.identity', matched_id: 'cover.fiscal_year' }),
      null,
      { ...kbWith('kb.profile.identity', 'narrative', true), answers: { 'kb.profile.identity': { label: 'L', verified: true, text: 'narrative', structured: { 'cover.fiscal_year': { value: 'July', verified: false } } } } },
    );
    expect(out.verified).toBe(false);
  });
});

describe('fetch_figure — a number question whose answer is a live figure, never a frozen one', () => {
  it('returns the exact query_* call for a drifting number', () => {
    const out = buildAnswer(
      match({ answer_type: 'number', kb_ref: 'kb.financials', matched_id: 'financials.operating_budget' }),
      null,
      kbWith('kb.financials', 'FY2025 expenses were about $1.34M', true),
    );
    expect(out.status).toBe<AnswerStatus>('fetch_figure');
    expect(out.actor).toBe('llm');
    // query_finances(annual), not get_finance_brief(ytd). Corrected 2026-08-17 under #275: the check
    // preferred get_finance_brief because query_finances can be ACL-denied, which traded a tool that
    // might be refused for one that cannot answer — get_finance_brief carries no income or expense
    // total at all. See the annual_budget note in figures.ts.
    expect(out.figure_call).toEqual({ tool: 'query_finances', args: { query_type: 'annual' } });
    expect(out.answer).toBeUndefined();
    expect(out.handback).toBeUndefined();
  });

  it('escalates a definitional number check to staff, keeping the query call', () => {
    // jobs_and_participants -> students_served_total is definitional: 145 served vs 301 records are
    // both true of different populations. The number is only written after a person confirms which
    // one the funder means, so the actor must be staff — not the model.
    const out = buildAnswer(
      match({ answer_type: 'number', kb_ref: 'kb.metrics', matched_id: 'program.jobs_and_participants' }),
      null,
      kbWith('kb.metrics', 'Served ~145 students', true),
    );
    expect(out.status).toBe<AnswerStatus>('figure_definitional');
    expect(out.actor).toBe('staff');
    expect(out.figure_call?.tool).toBe('query_enrollment');
  });

  it('leaves an unmapped number question on the derive path', () => {
    const out = buildAnswer(
      match({ answer_type: 'number', kb_ref: 'kb.financials', matched_id: 'cover.request_amount' }),
      null,
      kbWith('kb.financials', 'narrative', true),
    );
    expect(out.status).toBe<AnswerStatus>('derive_from_reference');
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

  // Was `expect(over.length).toBeGreaterThan(0)` on this fixture. It cannot be, and the reason is the
  // whole shape of the change: the figure gate runs BEFORE the length branches, because filling a slot
  // changes the length and resizing first measures the wrong text. So a stored answer that is both
  // slotted and over-limit reports `needs_live_figures`, not `needs_resize` — and after the scrub nearly
  // every slot is slotted. The resize path is now reached by passing FILLED text to
  // `grant_resize_answer`, which is what the fill handback's `verify_with` tells the caller to do.
  //
  // What is asserted instead: the over-limit fact is not lost on the way through. A gated result still
  // carries its measurement, so `all_fit` stays honest and the caller is told a shortening is coming.
  it('reports the over-limit measurement on a gated section rather than dropping it', () => {
    const gated = pkg.results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'needs_live_figures' && r.measurement?.fits === false);
    expect(gated.length).toBeGreaterThan(0);
    for (const { r, i } of gated) {
      // Never a finished answer: it still has holes in it.
      expect(r.answer).toBeUndefined();
      expect(r.figure_template).toBeDefined();
      expect(sectionFor(md, i)).toContain('FIGURES NOT FILLED');
      // The rule that keeps a model from trimming while it fills.
      expect(r.handback?.rules.some((x) => x.includes('do NOT shorten as you go'))).toBe(true);
    }
    expect(pkg.summary.all_fit).toBe(false);
  });

  it('still labels a genuinely over-limit unslotted section OVER LIMIT', () => {
    const over = pkg.results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'needs_resize' || r.status === 'compression_infeasible');
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

// --------------------------------------------------------------------------- D1e: the needs_expand guard

/**
 * Board `grant-h32` / DECISIONS.md D1e. The `structured` branch above fixed one defect and created
 * another: a stored value can measure *inside* a funder's cap and still not answer the field, and the
 * layer returned that as `fits` with `actor: none` — no work owed. The outstanding-work count went
 * down while the draft got worse, which is the worst shape a defect can take in a tool whose entire
 * job is telling a caller what is left to do.
 *
 * These cases are deliberately weighted toward what the guard must NOT do. Over-firing here tells a
 * model to pad a grant answer to fill a box, and padding is how invented facts reach a funder — so a
 * guard that over-fires is worse than the bug it replaced.
 */
describe('needs_expand — a stored value that fits a field but does not answer it', () => {
  const SHORT = 'Philadelphia young people ages 16-24';

  const kbStructured = (slot: string, prose: string, qid: string, value: string): KnowledgeBase => ({
    ...kbWith(slot, prose, true),
    answers: {
      [slot]: {
        label: 'L',
        verified: true,
        text: prose,
        structured: { [qid]: { value, verified: true } },
      },
    },
  });

  const run = (answerType: AnswerType, limit: FormLimit): AnswerPlan =>
    buildAnswer(
      match({ matched_id: 'program.target_population', kb_ref: 'kb.target_population', answer_type: answerType }),
      limit,
      kbStructured('kb.target_population', 'Launchpad recruits from more than 30 schools.', 'program.target_population', SHORT),
    );

  it('routes to the calling model instead of reporting the field done', () => {
    const out = run('demographic', WORDS(200));
    expect(out.status).toBe('needs_expand');
    expect(out.actor).toBe('llm');
    expect(out.actor).toBe(STATUS_ACTOR.needs_expand);
  });

  it('withholds the value as `answer`, because it is not one yet', () => {
    // THE LOAD-BEARING ASSERTION. Present as `answer`, the value renders as a finished answer in the
    // Markdown package and in anything else walking `results` — which is precisely the appearance
    // that let the original defect through. It travels as the handback's anchor instead.
    const out = run('demographic', WORDS(200));
    expect(out.answer).toBeUndefined();
    expect(out.handback?.anchor_value).toBe(SHORT);
  });

  it('hands back the confirmed value AND the slot prose, under the expand rules', () => {
    const out = run('demographic', WORDS(200));
    expect(out.handback?.task).toBe('expand');
    expect(out.handback?.rules).toEqual(EXPAND_RULES);
    expect(out.handback?.source_text).toContain('more than 30 schools');
    // The measurement travels too, so the model knows the room it has without recounting.
    expect(out.measurement?.max).toBe(200);
  });

  it('still marks it as coming from a structured value', () => {
    expect(run('demographic', WORDS(200)).from_structured).toBe(true);
  });

  it('names the shortfall in the action, in the funder’s own units', () => {
    const out = run('narrative', WORDS(200));
    expect(out.action).toContain('/200 words');
    expect(out.action).toMatch(/verbatim/);
  });

  // ---- what it must NOT do ------------------------------------------------------------------

  it('leaves a title field alone however generous the box', () => {
    // The real false positive this guard shipped with for about ten minutes: Hamilton's LOI asks
    // "Project/ Program/ Campaign Name" in a 250-CHARACTER box. `Launchpad` is the complete answer.
    const out = buildAnswer(
      match({ matched_id: 'cover.project_title', kb_ref: 'kb.program_desc', answer_type: 'field' }),
      { unit: 'characters', max: 250 },
      kbStructured('kb.program_desc', 'long narrative', 'cover.project_title', 'Launchpad'),
    );
    expect(out.status).toBe('fits');
    expect(out.actor).toBe('none');
    expect(out.answer).toBe('Launchpad');
  });

  it('leaves a field below the prose floor alone even when the type could want prose', () => {
    // 36 characters into a 200-character box: the type test passes and the RATIO test passes
    // (0.18, under 0.25), so the floor is the only thing holding this back. 200 < PROSE_LIMIT_FLOOR
    // .characters, and a box that small is a roomy input rather than a request for narrative.
    const out = run('narrative', { unit: 'characters', max: 200 });
    expect(out.status).toBe('fits');
    expect(out.answer).toBe(SHORT);
    const m = out.measurement;
    if (m === undefined) throw new Error('expected a measurement');
    expect(m.count / m.max).toBeLessThan(0.25);
  });

  it('leaves a value that already fills the field alone', () => {
    const out = buildAnswer(
      match({ matched_id: 'program.target_population', kb_ref: 'kb.target_population', answer_type: 'narrative' }),
      WORDS(6),
      kbStructured('kb.target_population', 'prose', 'program.target_population', SHORT),
    );
    expect(out.status).toBe('fits');
  });

  it('does not touch the no-limit path, where there is no evidence either way', () => {
    // With no stated limit the layer cannot know the field is big, and saying so would be inventing.
    // Recorded as a known gap rather than papered over — see DECISIONS.md D1e.
    const out = buildAnswer(
      match({ matched_id: 'program.target_population', kb_ref: 'kb.target_population', answer_type: 'demographic' }),
      null,
      kbStructured('kb.target_population', 'prose', 'program.target_population', SHORT),
    );
    expect(out.status).toBe('ready');
    expect(out.answer).toBe(SHORT);
  });

  it('leaves an over-limit value on the resize path', () => {
    const long = Array.from({ length: 300 }, () => 'word').join(' ');
    const out = buildAnswer(
      match({ matched_id: 'program.target_population', kb_ref: 'kb.target_population', answer_type: 'narrative' }),
      WORDS(200),
      kbStructured('kb.target_population', 'prose', 'program.target_population', long),
    );
    expect(out.status).toBe('needs_resize');
    expect(out.handback?.task).toBe('resize');
  });
});

// ------------------------------------------------- the same guard on the narrative path (WP #254/#252)

/**
 * The `needs_expand` guard landed on the structured branch only, which left unguarded the case it was
 * actually written about.
 *
 * The knowledge base's own note says its answers are "the LONGEST canonical version" and this module
 * resizes *down* — so a thin slot against a roomy field is the common shape, not the exotic one.
 * Measured against the real seed on 2026-08-17: `kb.staff_bios` 110/600 words, `kb.history` 119/500,
 * `kb.target_population` 86/600, `kb.dei` 122/600, `kb.evaluation` 116/600. Every one reported `fits` /
 * `actor: none` while `underfillsProseField` returned `true`, and `packages/grants/CLAUDE.md` §4 item 8
 * claimed the guard already made exactly this visible. It did not. Work package #252.
 *
 * The difference from the structured path is the anchor, and it is not cosmetic: there is no separately
 * confirmed short value here, so `EXPAND_RULES`' "the confirmed value MUST appear unchanged" rule has no
 * referent. Stating it anyway would ask a model to preserve verbatim something it would have to invent
 * first, on the one task in this layer most likely to produce invented statistics.
 */
describe('needs_expand — a narrative slot that fits a field but barely fills it', () => {
  const THIN = 'Launchpad recruits from more than 30 Philadelphia high schools.';

  const run = (answerType: AnswerType, limit: FormLimit, text = THIN): AnswerPlan =>
    buildAnswer(
      match({ matched_id: 'program.history', kb_ref: 'kb.history', answer_type: answerType }),
      limit,
      kbWith('kb.history', text, true),
    );

  it('routes to the calling model instead of reporting the field done', () => {
    const out = run('narrative', WORDS(500));
    expect(out.status).toBe<AnswerStatus>('needs_expand');
    expect(out.actor).toBe('llm');
    expect(out.actor).toBe(STATUS_ACTOR.needs_expand);
  });

  it('withholds the thin text as `answer`, for the same reason the structured branch does', () => {
    const out = run('narrative', WORDS(500));
    expect(out.answer).toBeUndefined();
    expect(out.handback?.task).toBe('expand');
    expect(out.handback?.source_text).toBe(THIN);
  });

  it('carries no anchor, and drops the rule that would have no referent', () => {
    const out = run('narrative', WORDS(500));
    expect(out.handback?.anchor_value).toBeUndefined();
    expect(out.handback?.rules).toEqual(EXPAND_RULES_NO_ANCHOR);
    expect(out.handback?.rules.join(' ')).not.toContain('MUST appear in your answer unchanged');
    // The rules that DO matter here are still every one of them — most of all the ceiling rule, which
    // is what stops this branch from trading a silent under-answer for a padded invented one.
    expect(out.handback?.rules.join(' ')).toMatch(/CEILING, NOT A TARGET/);
    expect(out.handback?.rules.join(' ')).toMatch(/NEVER invent/);
    expect(out.handback?.instruction).not.toContain('confirmed value');
  });

  it('names the shortfall in the funder’s own units and refuses to license padding', () => {
    const out = run('narrative', WORDS(500));
    expect(out.action).toContain('/500 words');
    expect(out.action).toMatch(/no further than that material supports/);
  });

  // ---- what it must NOT do, mirroring the structured cases ------------------------------------

  it('leaves a slot that already fills the field alone', () => {
    const out = run('narrative', WORDS(10));
    expect(out.status).toBe<AnswerStatus>('fits');
    expect(out.answer).toBe(THIN);
  });

  it('leaves a non-expandable type alone however generous the box', () => {
    // `field` is not in EXPANDABLE_ANSWER_TYPES, so this reaches derive_from_reference instead —
    // the field wants a short value and the slot holds prose, which is a different kind of work.
    const out = run('field', WORDS(500));
    expect(out.status).toBe<AnswerStatus>('derive_from_reference');
  });

  it('leaves a field below the prose floor alone', () => {
    const out = run('narrative', { unit: 'characters', max: 200 });
    expect(out.status).toBe<AnswerStatus>('fits');
  });

  it('leaves an over-limit slot on the resize path', () => {
    const long = Array.from({ length: 700 }, () => 'word').join(' ');
    const out = run('narrative', WORDS(500), long);
    expect(out.status).toBe<AnswerStatus>('needs_resize');
    expect(out.handback?.task).toBe('resize');
  });

  // This asserted `needs_expand` fires on a stored fixture, so the guard was covered by real seed data
  // rather than only by constructed cases. After #275 it usually does not: the figure gate runs first,
  // and a thin slot that underfills a roomy field is also, nearly always, a slot with figures in it. The
  // expand path is now reached on the FILLED text.
  //
  // The coverage intent is kept by asserting the sequencing on real data instead — the fixture reaches
  // the gate, and the same slot's text reaches `needs_expand` once its slots are filled. If the gate
  // ever stopped preempting, the first assertion fails; if the expand guard rotted, the second does.
  it('routes stored fixtures to the gate first, and to expand once the figures are filled', () => {
    const kb = loadKnowledgeBase();
    const gated = listFormIds().flatMap((id) =>
      runPipeline(loadForm(id), loadBank(), kb).results.filter(
        (r) => r.status === 'needs_live_figures' || r.status === 'needs_application_figures',
      ),
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const r of gated) {
      expect(r.answer).toBeUndefined();
      expect(r.figure_slots?.length).toBeGreaterThan(0);
    }

    // Now the same material with its slots filled, to prove the expand guard still fires on real prose
    // and not only on the constructed cases above. A filled figure is a short token, so the underfill
    // arithmetic is essentially unchanged by the substitution.
    const thin = kb.answers['kb.evaluation'];
    expect(thin).toBeDefined();
    const filled = String(thin?.text).replace(/\{\{[a-z0-9_]+\}\}/g, '42');
    const out = run('narrative', WORDS(600), filled);
    expect(out.status).toBe<AnswerStatus>('needs_expand');
    expect(out.answer).toBeUndefined();
    expect(out.handback?.task).toBe('expand');
    expect(out.measurement?.fits).toBe(true);
  });
});

// --------------------------------------------------------------- renderMarkdown on an expand handback

/**
 * `renderMarkdown` keyed its collapsed-block heading on `task === 'resize'` and let everything else
 * fall through to the `derive_short_value` wording, so an `expand` handback rendered as "Source material
 * to derive the value from — NOT the answer to this field": the opposite instruction.
 *
 * And `anchor_value` was emitted nowhere. Since a `needs_expand` result deliberately withholds the value
 * from `answer`, the rendered artifact told the reviewer to keep a value verbatim while that value
 * appeared nowhere in the document. Work package #253.
 */
describe('renderMarkdown — an expand handback', () => {
  const ANCHOR = 'Philadelphia young people ages 16-24';
  const PROSE = 'Launchpad recruits from more than 30 schools.';

  /**
   * Wraps one `AnswerPlan` as a package, so the render can be driven off a single branch without
   * hand-authoring a seed bank. The literals a synthetic bank and knowledge base need are zod-inferred
   * and passthrough-typed, and getting them wrong compiles in vitest and fails `tsc` — which is exactly
   * the trap `packages/grants/CLAUDE.md` §3 records. `buildAnswer` is already the unit under test
   * everywhere else in this file, so it is the right seam here too.
   */
  const packageOf = (plan: AnswerPlan): DraftPackage => ({
    form: { funder: 'ACME Fund' },
    summary: {
      total: 1,
      by_status: { [plan.status]: 1 },
      by_actor: { none: 0, llm: 0, staff: 0, [plan.actor]: 1 },
      all_fit: plan.measurement?.fits ?? true,
    },
    results: [plan],
    kb_refs_used: plan.kb_ref === null ? [] : [plan.kb_ref],
    figure_work_order: buildFigureWorkOrder([], kbWith('kb.target_population', PROSE, true)),
    integrity_warnings: [],
  });

  const anchoredPlan = (): AnswerPlan => {
    const kb: KnowledgeBase = {
      ...kbWith('kb.target_population', PROSE, true),
      answers: {
        'kb.target_population': {
          label: 'L',
          verified: true,
          text: PROSE,
          structured: { 'program.target_population': { value: ANCHOR, verified: true } },
        },
      },
    };
    return buildAnswer(
      match({
        matched_id: 'program.target_population',
        kb_ref: 'kb.target_population',
        answer_type: 'demographic',
      }),
      WORDS(200),
      kb,
    );
  };

  it('renders the confirmed value, which appears nowhere else in the document', () => {
    const plan = anchoredPlan();
    expect(plan.status).toBe<AnswerStatus>('needs_expand');
    expect(plan.handback?.anchor_value).toBe(ANCHOR);
    // The precondition that makes this matter: the value is withheld from `answer`, so if the render
    // drops it the reviewer never sees the thing they are told to preserve verbatim.
    expect(plan.answer).toBeUndefined();

    const md = renderMarkdown(packageOf(plan));
    expect(md).toContain('Confirmed value');
    expect(md).toContain(ANCHOR);
    expect(md).toMatch(/must survive verbatim/);
  });

  it('labels the source block as material to write from, not to derive a value from', () => {
    const md = renderMarkdown(packageOf(anchoredPlan()));
    expect(md).toContain('Source material to write the fuller answer from');
    expect(md).not.toContain('Source material to derive the value from');
  });

  it('still labels a resize handback as text to shorten', () => {
    const long = Array.from({ length: 40 }, () => 'word').join(' ');
    const plan = buildAnswer(match(), WORDS(20), kbWith('kb.mission', long));
    expect(plan.status).toBe<AnswerStatus>('needs_resize');
    expect(renderMarkdown(packageOf(plan))).toContain('Source text to shorten');
  });

  it('still labels a derive handback as material to derive a value from', () => {
    const plan = buildAnswer(
      match({ answer_type: 'field' }),
      WORDS(20),
      kbWith('kb.mission', 'Launchpad prepares Philadelphia young people for careers in technology.'),
    );
    expect(plan.status).toBe<AnswerStatus>('derive_from_reference');
    const md = renderMarkdown(packageOf(plan));
    expect(md).toContain('Source material to derive the value from');
    expect(md).not.toContain('Confirmed value');
  });
});

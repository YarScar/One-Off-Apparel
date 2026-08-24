import { describe, expect, it } from 'vitest';

import { loadKnowledgeBase } from './data.js';
import { FIGURE_CHECKS } from './figures.js';
import {
  figureCallsFor,
  literalFigures,
  malformedSlotTokens,
  resolveSlots,
  slotsIn,
  unknownSlots,
  unsourcedFigures,
  FIGURE_DEBT,
  FIGURE_SLOTS,
  IMMUTABLE_FIGURES,
} from './slots.js';

/** Every stored string a draft can surface: slot prose and the per-question structured values. */
function storedTexts(): { where: string; text: string }[] {
  const kb = loadKnowledgeBase();
  return Object.entries(kb.answers).flatMap(([slot, a]) => [
    { where: `${slot}.text`, text: a.text },
    ...Object.entries(a.structured ?? {}).map(([qid, s]) => ({
      where: `${slot}.structured.${qid}`,
      text: s.value,
    })),
  ]);
}

// --------------------------------------------------------------------------- the registers

// A pattern in either register is a claim about the corpus. A pattern that matches NOTHING is not a
// harmless leftover — it is a claim that has silently stopped being true, and the two registers fail in
// opposite directions when that happens. A dead IMMUTABLE_FIGURES entry stops exempting, which at least
// surfaces as a `high` warning; a dead FIGURE_DEBT entry stops reporting, which surfaces as nothing at
// all and quietly promotes a known-unverifiable figure to "clean".
//
// This is not hypothetical. Every currency exemption in IMMUTABLE_FIGURES was dead on arrival: they were
// written as `/\b\$50,000 living wage/`, and `\b` between a space and `$` is not a word boundary because
// `$` is not a word character, so none of them could ever match. The same bug then recurred in
// FIGURE_DEBT with a trailing `\b` after `%`. Both were found by reading warning output and guessing.
// These two cases find them in a second.
describe('IMMUTABLE_FIGURES', () => {
  it('has no dead pattern — every exemption matches somewhere in the corpus', () => {
    const corpus = storedTexts()
      .map((t) => t.text)
      .join('\n');
    const dead = IMMUTABLE_FIGURES.filter((e) => corpus.match(e.pattern) === null).map(
      (e) => e.pattern.source,
    );
    expect(dead).toEqual([]);
  });

  it('records a reason for every exemption, since an unexplained one is indistinguishable from a mistake', () => {
    for (const e of IMMUTABLE_FIGURES) {
      expect(e.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('FIGURE_DEBT', () => {
  it('has no dead pattern — every recorded debt still appears in the corpus', () => {
    const corpus = storedTexts()
      .map((t) => t.text)
      .join('\n');
    const dead = FIGURE_DEBT.filter((e) => corpus.match(e.pattern) === null).map(
      (e) => e.pattern.source,
    );
    expect(dead).toEqual([]);
  });

  it('says what would settle each entry, so the register is a work list and not a shrug', () => {
    for (const e of FIGURE_DEBT) {
      expect(e.why_not_a_slot.length).toBeGreaterThan(20);
      expect(e.would_settle_it.length).toBeGreaterThan(20);
    }
  });

  // Every pattern in both registers is a module-level `/g` regex, and `RegExp.test` on one advances
  // `lastIndex` — so the second identical call resumes past the match and returns false. A checker whose
  // answer depends on how many times it has been called is worse than no checker. `unsourcedFigures`
  // uses `String.match`, which resets; this is what pins that. FIGURE_DEBT is empty as of 2026-08-21
  // (its five entries were removed along with the corpus claims they covered), so there is nothing to
  // match today — this only proves the empty register is stable across repeated calls. The real leak
  // regression is re-armed the moment a new entry lands here.
  it('gives the same answer on repeated calls — no leaked /g regex state', () => {
    const text = 'Launchpad reached more than 1,000 young people through outreach.';
    const first = unsourcedFigures(text);
    expect(first.length).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      expect(unsourcedFigures(text).length).toBe(first.length);
    }
  });
});

// --------------------------------------------------------------------------- the registry

describe('FIGURE_SLOTS', () => {
  it('resolves every live slot to a real check', () => {
    const keys = new Set(FIGURE_CHECKS.map((c) => c.key));
    const broken = Object.entries(FIGURE_SLOTS)
      .filter(([, s]) => s.kind === 'live')
      .filter(([, s]) => s.check === undefined || !keys.has(s.check))
      .map(([id]) => id);
    expect(broken).toEqual([]);
  });

  // The field that makes a wrong cut visible rather than invisible. A live slot without it fills with a
  // number whose population nobody stated, which is the failure mode that prompted it.
  it('gives every live slot a population, via its check', () => {
    const missing = Object.entries(FIGURE_SLOTS)
      .filter(([, s]) => s.kind === 'live')
      .filter(([id]) => {
        const [req] = resolveSlots(`{{${id}}}`);
        return req?.population === undefined || req.population === '';
      })
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it('routes every per_application slot to staff, with a note saying what a person supplies', () => {
    for (const [id, slot] of Object.entries(FIGURE_SLOTS)) {
      if (slot.kind !== 'per_application') continue;
      const [req] = resolveSlots(`{{${id}}}`);
      expect(req?.needs_staff_decision).toBe(true);
      expect(slot.staff_note?.length ?? 0).toBeGreaterThan(20);
    }
  });

  // Unused slots are not free. Each one is a name a maintainer can reach for and a claim that the corpus
  // needs that figure; a registry that has drifted ahead of the prose makes both untrue.
  it('defines no slot the corpus never uses', () => {
    const used = new Set(storedTexts().flatMap((t) => slotsIn(t.text)));
    const unused = Object.keys(FIGURE_SLOTS).filter((id) => !used.has(id));
    expect(unused).toEqual([]);
  });
});

// --------------------------------------------------------------------------- the corpus

describe('the stored corpus', () => {
  it('stores no literal figure without a slot or a recorded exemption', () => {
    const offenders = storedTexts()
      .map((t) => ({ where: t.where, found: literalFigures(t.text) }))
      .filter((t) => t.found.length > 0);
    expect(offenders).toEqual([]);
  });

  it('references no slot the registry does not define', () => {
    const bad = storedTexts()
      .map((t) => ({ where: t.where, bad: unknownSlots(t.text) }))
      .filter((t) => t.bad.length > 0);
    expect(bad).toEqual([]);
  });

  // A malformed token is the worst failure this mechanism has: `resolveSlots` drops it, so the gate does
  // not fire, so the text is returned as a finished answer with the raw braces still in it.
  it('contains no malformed slot token', () => {
    const bad = storedTexts()
      .map((t) => ({ where: t.where, bad: malformedSlotTokens(t.text) }))
      .filter((t) => t.bad.length > 0);
    expect(bad).toEqual([]);
  });

  it('uses `{{` for nothing but slot tokens, so the syntax cannot collide with prose', () => {
    for (const { where, text } of storedTexts()) {
      const braces = (text.match(/\{\{/g) ?? []).length;
      expect({ where, braces }).toEqual({ where, braces: slotsInWithRepeats(text).length });
    }
  });
});

/** Slot tokens including repeats — `slotsIn` deduplicates, and the brace count does not. */
function slotsInWithRepeats(text: string): string[] {
  return [...text.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1] ?? '');
}

// --------------------------------------------------------------------------- resolution

describe('resolveSlots / figureCallsFor', () => {
  it('deduplicates the calls, because one call fills many slots', () => {
    // Three slots, all on employment_earnings_total, which is one query_employment(aggregate) call.
    const text = '{{wages_total}} to {{wage_participants}} across {{wage_jobs}} jobs';
    expect(resolveSlots(text)).toHaveLength(3);
    expect(figureCallsFor(text)).toEqual([
      { tool: 'query_employment', args: { query_type: 'aggregate' } },
    ]);
  });

  it('flags a definitional slot as needing a staff decision, not just a call', () => {
    const [req] = resolveSlots('{{students_served}}');
    expect(req?.tool).toBe('query_enrollment');
    expect(req?.needs_staff_decision).toBe(true);
    // The note is the check's own, so the reasoning lives in one place.
    expect(req?.note).toContain('301');
  });

  it('drops an unknown slot rather than inventing a requirement for it', () => {
    // Reported by `data.ts::figure_slot_unknown` at load, where the corpus can be fixed. Guessing a
    // requirement here would send a caller to run a call that does not exist.
    expect(resolveSlots('{{not_a_real_slot}}')).toEqual([]);
    expect(unknownSlots('{{not_a_real_slot}}')).toEqual(['not_a_real_slot']);
  });

  it('finds nothing in text that has no slots', () => {
    expect(resolveSlots('Launchpad serves Philadelphia young people.')).toEqual([]);
    expect(figureCallsFor('Launchpad serves Philadelphia young people.')).toEqual([]);
  });
});

// --------------------------------------------------------------------------- the detector

describe('literalFigures', () => {
  it('finds currency, percentages, comma-grouped numbers and decimals', () => {
    expect(literalFigures('We paid $362,030.26')).toEqual(['$362,030.26']);
    expect(literalFigures('about 92% of them')).toEqual(['92%']);
    expect(literalFigures('1,000 people')).toEqual(['1,000']);
    expect(literalFigures('3.5 months')).toEqual(['3.5']);
  });

  it('ignores what is inside a slot token', () => {
    expect(literalFigures('{{wages_total}} paid out')).toEqual([]);
  });

  // Documented blind spots, asserted so they stay known rather than becoming assumptions. A single-digit
  // count that drifts escapes this check entirely — which is why kb.staff_bios' "9 full-time and 1
  // part-time" had to be slotted by reading the prose rather than by the checker pointing at it.
  it('ignores single digits and spelled-out numbers, as documented', () => {
    expect(literalFigures('3 campuses')).toEqual([]);
    expect(literalFigures('six competencies and four pathways')).toEqual([]);
  });
});

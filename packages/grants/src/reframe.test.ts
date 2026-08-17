import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { measure } from './limits.js';
import {
  FUNDER_HATS,
  REFRAME_RULES,
  buildReframeHandback,
  type FunderHat,
} from './reframe.js';

// The reframe seam is the one module in this package that is built and deliberately NOT connected —
// `admin/SPEC.md` §8 and `admin/TAD.md` §5 decision 7. So this file has two jobs, and the second one
// is the acceptance criterion: prove the seam behaves, and prove nothing can reach it.

const SOURCE =
  'Launchpad trains young adults in Philadelphia for careers in technology. In 2025, 118 ' +
  'participants completed the program and 84 were placed into roles paying an average of $52,000.';

describe('the reframe guardrail rules', () => {
  it('carries the no-invention clause word for word, as the resize rules state it', () => {
    // Not paraphrased on purpose. A model that gets a softer guardrail from one tool than another
    // will use the softer one, so the wording is pinned rather than the meaning.
    expect(REFRAME_RULES[0]).toContain('NEVER invent, add, infer, or embellish');
    expect(REFRAME_RULES[0]).toContain('Use ONLY what appears in the source answer');
  });

  it('names reordering as the task and forbids adding material', () => {
    const joined = REFRAME_RULES.join(' ');
    expect(joined).toContain('REORDERING and RE-WEIGHTING');
    expect(joined).toContain('It does not mean adding material');
  });

  it('requires a mismatch to be reported rather than papered over', () => {
    // The load-bearing rule. Reframing fails by manufacturing the emphasis the funder wants, which
    // no length check would ever catch.
    const joined = REFRAME_RULES.join(' ');
    expect(joined).toContain('SAY SO and return the answer unchanged');
    expect(joined).toContain('Do not supply the emphasis yourself');
  });

  it('forbids altering any figure, since reframing has no reason to touch one', () => {
    const joined = REFRAME_RULES.join(' ');
    expect(joined).toContain('Do not alter, round, or approximate any figure, name, or date');
    expect(joined).toContain('Return ONLY the reframed answer text');
  });
});

describe('buildReframeHandback', () => {
  it('returns the source text unchanged — the seam shapes instructions, never prose', () => {
    const out = buildReframeHandback({ sourceText: SOURCE, hat: 'workforce' });
    expect(out.source_text).toBe(SOURCE);
    expect(out.task).toBe('reframe');
    expect(out.rules).toEqual(REFRAME_RULES);
  });

  it('spells out the emphasis rather than passing the bare hat label through', () => {
    const out = buildReframeHandback({ sourceText: SOURCE, hat: 'place_based' });
    expect(out.emphasis).toContain('Philadelphia');
    expect(out.instruction).toContain('Philadelphia');
    expect(out.context.hat).toBe('place_based');
  });

  it('names the funder in the instruction, and degrades to a neutral phrase without one', () => {
    const named = buildReframeHandback({ sourceText: SOURCE, hat: 'youth', funder: 'Hummingbird' });
    expect(named.instruction).toContain('Hummingbird');
    expect(named.context.funder).toBe('Hummingbird');

    const anon = buildReframeHandback({ sourceText: SOURCE, hat: 'youth' });
    expect(anon.instruction).toContain('this funder');
    expect(anon.context.funder).toBeNull();
  });

  it('carries a stated limit into the instruction, because reframing must not lengthen', () => {
    const limit = { unit: 'words', max: 40 } as const;
    const out = buildReframeHandback({
      sourceText: SOURCE,
      hat: 'economic_mobility',
      limit,
      measurement: measure({ text: SOURCE, unit: 'words', max: 40 }),
    });
    expect(out.instruction).toContain('still within 40 words');
    expect(out.limit).toEqual(limit);
    expect(out.measurement?.count).toBeGreaterThan(0);
  });

  it('omits the length clause when the field states no limit', () => {
    const out = buildReframeHandback({ sourceText: SOURCE, hat: 'dei' });
    expect(out.instruction).not.toContain('within');
    expect(out.limit).toBeNull();
    expect(out.measurement).toBeNull();
  });

  it('sends the result back through grant_resize_answer for the figure check', () => {
    const out = buildReframeHandback({ sourceText: SOURCE, hat: 'tech_equity' });
    expect(out.verify_with).toContain('grant_resize_answer');
    // Reframing changes emphasis, not arithmetic — so a figure rejection means a broken rule.
    expect(out.verify_with).toContain('a rule was broken');
  });

  it('builds for every hat in the closed vocabulary, with a distinct emphasis for each', () => {
    const emphases = FUNDER_HATS.map(
      (hat) => buildReframeHandback({ sourceText: SOURCE, hat }).emphasis,
    );
    expect(emphases).toHaveLength(7);
    expect(new Set(emphases).size).toBe(7);
  });

  it('throws on an unrecognised hat instead of passing it into a prompt', () => {
    // A typo'd hat would otherwise read to the model as an instruction somebody meant to give.
    expect(() =>
      buildReframeHandback({ sourceText: SOURCE, hat: 'sustainability' as FunderHat }),
    ).toThrow(/unknown funder hat/);
  });
});

// --------------------------------------------------------------------------- the seam is a seam

/**
 * `admin/SPEC.md` §8's acceptance criterion: "the seam exists and is unreachable from any registered
 * tool. A test asserts it is not called."
 *
 * Asserted structurally rather than by spying, because a spy only proves the paths a test happens to
 * exercise. Unreachability is a property of the import graph: `@lp-ai/lib-grants`' barrel is the only
 * door into this package, and the MCP server is the only thing with registered tools.
 */
describe('the seam is unreachable from any registered tool', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = join(here, '..', '..', '..');

  it('is not re-exported from the package barrel', () => {
    const barrel = readFileSync(join(here, 'index.ts'), 'utf8');
    // Every other module in src/ has an `export * from` line here. This one must not.
    expect(barrel).toContain("export * from './resize.js'");
    expect(barrel).not.toContain('reframe');
  });

  it('is imported by nothing in the MCP server', () => {
    const serverSrc = join(repoRoot, 'apps', 'mcp-server', 'src');
    const offenders = walk(serverSrc).filter((file) =>
      /\breframe\b|buildReframeHandback|REFRAME_RULES/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((f) => f.slice(repoRoot.length + 1))).toEqual([]);
  });

  it('is imported by nothing else in this package either', () => {
    const offenders = walk(join(here))
      .filter((file) => !file.endsWith('reframe.ts') && !file.endsWith('reframe.test.ts'))
      .filter((file) => /from '\.\/reframe\.js'/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => f.slice(repoRoot.length + 1))).toEqual([]);
  });
});

/** Every `.ts` file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

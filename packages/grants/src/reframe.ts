/**
 * reframe.ts — the funder-angle seam. Built, tested, and **deliberately not connected**.
 *
 * ## What a reframe is, and what it is not
 *
 * LaunchPad answers the same question for funders who care about different things. A workforce
 * funder and a tech-equity funder both ask "describe your program", and the same stored answer
 * serves both — but each wants a different part of it in the first sentence. Reframing
 * re-emphasises material the answer already contains. It is a *reordering and re-weighting* task.
 *
 * It is not a rewrite, not a compression, and above all not an invitation to add what the funder
 * wants to hear. That last one is the whole risk. A resize prompt asks a model to say less, which
 * fails safe; a reframe prompt asks it to lean into a theme, which fails by *manufacturing* the
 * theme when the source does not support it. {@link REFRAME_RULES} is written around that single
 * failure mode, and {@link REFRAME_RULES}[2] — say so rather than supply it — is the load-bearing
 * one.
 *
 * ## Why it exists here but is not wired
 *
 * `admin/SPEC.md` §8 and `admin/TAD.md` §5 decision 7 both say the same thing: port the seam, do not
 * wire it. The prototype never wired it either — `pipeline/pipeline.py` threads a `hat` through its
 * `context` dict and marks the transform TODO, and `resize.py::_build_user_prompt` carries a comment
 * calling the real hook "a separate, richer transform". So there is no prototype implementation to
 * port and no parity fixture to check against. What ports is the *interface*: the hat vocabulary,
 * the context assembly, and the guardrail.
 *
 * Connecting it now would put an unproven language transform on the path to a funder, before G5 has
 * established that the drafting quality is good enough to judge anything against. The deferral is
 * until after release.
 *
 * ## How it stays unconnected, mechanically
 *
 * This module is **not re-exported from `index.ts`**. `@lp-ai/lib-grants` is the only way the MCP
 * tools reach this package, so leaving it off that barrel is what makes the seam unreachable rather
 * than merely unused. `reframe.test.ts` asserts both halves of that: the barrel does not export it,
 * and nothing under `apps/mcp-server/src/` imports it.
 *
 * **To wire it later:** add the `export * from './reframe.js'` line to `index.ts`, register a tool
 * that calls {@link buildReframeHandback}, and delete the unreachability test — in that order, and
 * with `admin/TAD.md` decision 7 revisited first, because the decision is what is holding it, not
 * the code.
 */

import type { Measurement } from './limits.js';
import type { FormLimit } from './schemas.js';

/**
 * The funder "hats" — the lens a funder reads through. A closed vocabulary, taken from the
 * prototype's roadmap entry for this hook, where `research/LaunchPad-Philly-Application.md` records
 * that the hats are concretely about *which program and phase you pitch* rather than about tone.
 *
 * Closed rather than free-text for the same reason the document-kind vocabulary is closed: an
 * unrecognised value must fail loudly at the seam instead of travelling into a prompt as an
 * instruction nobody wrote.
 */
export const FUNDER_HATS = [
  'workforce',
  'youth',
  'tech_equity',
  'economic_mobility',
  'dei',
  'education_innovation',
  'place_based',
] as const;

export type FunderHat = (typeof FUNDER_HATS)[number];

/** Human-readable gloss for each hat, so a rendered handback reads as a sentence. */
const HAT_EMPHASIS: Readonly<Record<FunderHat, string>> = {
  workforce: 'employment outcomes, employer partnerships, and job placement',
  youth: 'young people served, their age range, and youth development',
  tech_equity: 'access to technology careers for people shut out of them',
  economic_mobility: 'wage gains and the economic change in a participant’s life',
  dei: 'who is served and the barriers they face',
  education_innovation: 'the learning model and what makes it different',
  place_based: 'Philadelphia, the neighbourhoods served, and local partnerships',
};

/**
 * The absolute rules for re-emphasising a stored answer.
 *
 * Rules 1, 4 and 5 are {@link RESIZE_RULES}' guardrail restated for this task — the no-invention
 * clause is deliberately word-for-word, because a model that gets a softer version here than from
 * `grant_resize_answer` will produce inconsistent drafts, and the softer one always wins.
 *
 * Rules 2 and 3 are what this task adds. They exist because the reframe failure mode is the
 * opposite of the resize one: the pressure is to *supply* the emphasis the funder wants rather than
 * to drop detail. An answer that does not support the hat is a real and useful finding — it means
 * this funder needs different source material, which is a knowledge-base gap a person should see.
 */
export const REFRAME_RULES: readonly string[] = [
  'NEVER invent, add, infer, or embellish any fact, figure, statistic, name, date, program detail, ' +
    'or outcome. Use ONLY what appears in the source answer.',
  'Reframing means REORDERING and RE-WEIGHTING what is already there — leading with the material ' +
    'this funder cares about and giving it more room. It does not mean adding material.',
  'If the source answer does not contain anything supporting this funder’s emphasis, SAY SO and ' +
    'return the answer unchanged. Do not supply the emphasis yourself. A mismatch is a finding ' +
    'about the knowledge base, not a writing problem to solve.',
  'Do not alter, round, or approximate any figure, name, or date. Every one that appears in the ' +
    'result must appear in the source, stated identically.',
  'Do not add a preamble, a title, quotation marks, meta-commentary, or a word/character count. ' +
    'Return ONLY the reframed answer text, nothing else.',
];

/** Context that shapes the emphasis without licensing new content. */
export interface ReframeContext {
  readonly funder: string | null;
  readonly hat: FunderHat;
  /** What the funder's field asks for, so emphasis never displaces the actual question. */
  readonly answers: string | null;
}

/**
 * Everything the calling model needs to reframe one answer, and nothing else.
 *
 * Shaped to match `handback.ts`'s {@link Handback} field for field, so a caller renders both the
 * same way — but declared here rather than by widening `HandbackTask`. Widening that union would
 * put a `'reframe'` value into a module three registered tools import, which is precisely the
 * wiring `admin/TAD.md` decision 7 defers. The seam pays a small duplication to stay a seam.
 */
export interface ReframeHandback {
  readonly task: 'reframe';
  readonly instruction: string;
  readonly source_text: string;
  /** A funder's length cap still binds after reframing. `null` when the field states none. */
  readonly limit: FormLimit | null;
  readonly measurement: Measurement | null;
  readonly context: ReframeContext;
  /** The emphasis this hat asks for, spelled out so the model is not guessing at the label. */
  readonly emphasis: string;
  readonly rules: readonly string[];
  readonly verify_with: string;
}

/**
 * Reframing cannot lengthen an answer past a limit that already bound it, and a reader has no way
 * to tell a reordered answer from a subtly extended one by eye. So the result goes back through the
 * same arithmetic every other shaped text does — which also runs the figure-fidelity check, the one
 * thing that catches rule 4 being broken.
 */
const VERIFY =
  'Re-measure the result before using it — pass the reframed text back to grant_resize_answer as ' +
  '`rewrite`, with the same `text` and `limit`. That call checks the length and checks every figure ' +
  'in the result against the source, rejecting one the source does not state. Reframing must not ' +
  'change a single figure, so a rejection here means a rule was broken, not that the answer is long.';

export interface BuildReframeInput {
  readonly sourceText: string;
  readonly hat: FunderHat;
  readonly funder?: string | null;
  readonly answers?: string | null;
  readonly limit?: FormLimit | null;
  readonly measurement?: Measurement | null;
}

/**
 * Assemble the reframe handback. Pure: no I/O, no model call, no clock.
 *
 * Throws on an unrecognised hat rather than passing it through. A typo'd hat that reached a prompt
 * would read to the model as an instruction someone meant to give, which is the quiet failure this
 * closed vocabulary exists to prevent.
 */
export function buildReframeHandback(input: BuildReframeInput): ReframeHandback {
  const { sourceText, hat } = input;
  const emphasis = HAT_EMPHASIS[hat] as string | undefined;
  if (emphasis === undefined) {
    throw new Error(`unknown funder hat: ${hat} (expected one of ${FUNDER_HATS.join(', ')})`);
  }

  const funder = input.funder ?? null;
  const limit = input.limit ?? null;

  return {
    task: 'reframe',
    instruction:
      `Reframe the source text below for ${funder ?? 'this funder'}, leading with ${emphasis}` +
      `${limit === null ? '' : `, still within ${String(limit.max)} ${limit.unit}`}. ` +
      'Follow every rule.',
    source_text: sourceText,
    limit,
    measurement: input.measurement ?? null,
    context: { funder, hat, answers: input.answers ?? null },
    emphasis,
    rules: REFRAME_RULES,
    verify_with: VERIFY,
  };
}

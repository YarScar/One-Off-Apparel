/**
 * matcher.ts — connect a funder's question to an entry in the question bank.
 *
 * A re-expression of the prototype's `pipeline/matcher.py`. Pure and deterministic: no network, no
 * model, no database. Scoring blends a keyword-weighted Jaccard over token sets (0.7) with an
 * order-sensitive sequence ratio (0.3), and anything under {@link DEFAULT_THRESHOLD} comes back
 * flagged for human review rather than silently routed to the wrong stored answer.
 *
 * The sequence-ratio half is a port of CPython `difflib` and carries the parity risk for the whole
 * layer — see `seq-ratio.ts` and `admin/SPEC.md` section 5.
 */

import { loadBank } from './data.js';
import { pyRound, pySplit } from './py.js';
import type { AnswerType, Question, QuestionBank } from './schemas.js';
import { sequenceRatio } from './seq-ratio.js';

/** Words too common to carry matching signal. Kept small on purpose. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'describe',
  'do', 'does', 'for', 'from', 'has', 'have', 'how', 'if', 'in', 'is', 'it', 'its', 'list',
  'may', 'of', 'on', 'or', 'our', 'please', 'provide', 'should', 'that', 'the', 'their', 'these',
  'they', 'this', 'those', 'to', 'we', 'what', 'which', 'who', 'will', 'with', 'would', 'you',
  'your',
]);

/**
 * Signal words that strongly indicate a category or topic. Overlap on these weighs more than
 * ordinary token overlap.
 *
 * Every weight is a multiple of 0.5, so it is exactly representable as a double and the sums in
 * {@link weightedJaccard} are exact regardless of iteration order. That matters for parity: Python
 * iterates a `set` in hash order, which is not our insertion order, and float addition is otherwise
 * order-dependent. Keep new weights on the 0.5 grid or that guarantee is gone.
 */
const KEYWORD_WEIGHTS: ReadonlyMap<string, number> = new Map([
  ['mission', 3.0], ['history', 2.5], ['budget', 2.5], ['audit', 3.0], ['board', 2.5],
  ['evaluation', 3.0], ['evaluate', 2.5], ['outcomes', 3.0], ['sustainability', 3.0],
  ['sustain', 2.0], ['population', 2.0], ['demographic', 2.5], ['partner', 2.5],
  ['timeline', 2.0], ['501', 3.0], ['ein', 3.0], ['diversity', 2.5], ['inclusion', 2.0],
  ['goals', 2.0], ['need', 2.0], ['problem', 2.0], ['success', 2.0], ['funding', 2.0],
  ['geographic', 2.5], ['volunteers', 2.5], ['solvency', 3.0], ['results', 2.0],
  ['certify', 3.0], ['fiscal', 2.5], ['founded', 2.5], ['address', 2.0], ['contact', 2.0],
  ['eligibility', 3.0], ['eligible', 2.5], ['innovation', 3.0], ['innovative', 2.5],
  ['different', 2.0], ['significance', 2.5], ['scale', 2.0], ['risk', 3.0], ['risks', 2.5],
  ['challenges', 2.0], ['capacity', 2.5], ['milestones', 2.5], ['milestone', 2.5],
  ['logic', 2.5], ['model', 1.5], ['barriers', 2.5], ['barrier', 2.5], ['equitable', 2.5],
  ['jobs', 2.0], ['congressional', 3.0], ['uei', 3.0], ['sam', 2.0], ['naics', 3.0],
  ['indirect', 3.0], ['match', 2.0], ['apprenticeship', 3.0], ['employer', 2.5],
  ['theory', 2.5], ['leadership', 2.0], ['participants', 2.0], ['credentials', 2.5],
  ['occupations', 2.5], ['lived', 2.5], ['successes', 2.0], ['authorized', 2.5],
]);

/** Below this blended score a match is not trusted, and the question routes to human review. */
export const DEFAULT_THRESHOLD = 0.42;

/** How the winning score was reached: the canonical phrasing, or the source of a recorded variant. */
export type MatchedVia = string;

/** One question's match outcome. Shaped for JSON — nulls rather than absent keys. */
export interface MatchResult {
  readonly incoming: string;
  readonly matched_id: string | null;
  readonly canonical: string | null;
  readonly category: string | null;
  readonly kb_ref: string | null;
  readonly answer_type: AnswerType | null;
  readonly confidence: number;
  readonly matched_via: MatchedVia | null;
  readonly is_confident: boolean;
}

/**
 * Lowercase, replace every run of non-`[a-z0-9 ]` with a space, split on whitespace, drop stopwords.
 *
 * `toLowerCase()` and Python's `str.lower()` can differ on exotic Unicode, but the regex strips
 * everything outside `[a-z0-9 ]` immediately afterwards, so any divergence is erased before it can
 * reach a token.
 */
export function normalize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  return pySplit(cleaned).filter((t) => t !== '' && !STOPWORDS.has(t));
}

/** Jaccard over token sets, with {@link KEYWORD_WEIGHTS} boosting shared signal words. */
export function weightedJaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0.0;

  let interW = 0;
  let unionW = 0;
  for (const t of sa) {
    const w = KEYWORD_WEIGHTS.get(t) ?? 1.0;
    unionW += w;
    if (sb.has(t)) interW += w;
  }
  for (const t of sb) {
    if (!sa.has(t)) unionW += KEYWORD_WEIGHTS.get(t) ?? 1.0;
  }
  return unionW === 0 ? 0.0 : interW / unionW;
}

/** A candidate string with its normalization already done. See {@link candidatesFor}. */
interface Candidate {
  readonly tokens: readonly string[];
  readonly joined: string;
}

interface PreparedQuestion {
  readonly question: Question;
  readonly canonical: Candidate;
  readonly variants: readonly { readonly source: string; readonly candidate: Candidate }[];
}

/**
 * Normalized candidates for a bank, computed once.
 *
 * `normalize()` plus the join is pure and the bank is immutable, so re-running it per incoming
 * question was pure waste — and not a rounding error: the v0.4.1 bank has 336 candidate strings, and
 * `grant_match_question` accepts up to 200 questions per call. At ~8.6 ms per question that is ~1.7 s
 * of synchronous CPU in a single-threaded HTTP server, blocking every other request and `/health`
 * for the duration. Keyed weakly so a caller passing an ad-hoc bank cannot leak it.
 *
 * This changes no arithmetic. The tokens and joined strings are byte-identical to what the per-call
 * path produced, so prototype parity is untouched — `matcher.test.ts` asserts that field for field.
 */
const candidateCache = new WeakMap<QuestionBank, readonly PreparedQuestion[]>();

function prepare(text: string): Candidate {
  const tokens = normalize(text);
  return { tokens, joined: tokens.join(' ') };
}

function candidatesFor(bank: QuestionBank): readonly PreparedQuestion[] {
  let prepared = candidateCache.get(bank);
  if (prepared === undefined) {
    prepared = bank.questions.map((q) => ({
      question: q,
      canonical: prepare(q.canonical),
      variants: q.variants.map((v) => ({ source: v.source, candidate: prepare(v.text) })),
    }));
    candidateCache.set(bank, prepared);
  }
  return prepared;
}


/** Sentinel for a candidate proven unable to beat the incumbent. Below every real score. */
const CANNOT_WIN = -1;

/**
 * The blend of weighted token overlap (0.7) and sequence similarity (0.3) — unless the candidate
 * provably cannot beat `incumbent`, in which case a sentinel, with no difflib call made.
 *
 * Argument order into {@link sequenceRatio} is load-bearing: the incoming question is `a` and the
 * candidate is `b`, because `difflib`'s autojunk heuristic is computed over `b` alone.
 *
 * `sequenceRatio` is quadratic-ish and dominates the cost of a match; the weighted Jaccard is a set
 * intersection. Since `sequenceRatio` is bounded by 1, `0.7 * J + 0.3` is an upper bound on the
 * blended score, and IEEE multiplication and addition are both monotone, so the bound is never below
 * the exact value. A candidate whose bound does not exceed the incumbent cannot displace it — a
 * candidate only ever wins on a *strictly* greater score — so the difflib call is pure waste.
 *
 * This is an exact optimization, not a heuristic: every score that decides an outcome is still
 * computed in full. The skipped ones cannot be the eventual winner, because `incumbent` only grows,
 * so any skipped score stays at or below the final winner's. Ties still break to the earlier entry.
 * `matcher.test.ts` asserts prototype parity field for field over the whole bank, which is what
 * proves this claim rather than the argument above.
 */
function scoreOrSkip(incoming: Candidate, cand: Candidate, incumbent: number): number {
  const jaccard = weightedJaccard(incoming.tokens, cand.tokens);
  if (scoreUpperBound(jaccard) <= incumbent) return CANNOT_WIN;
  return 0.7 * jaccard + 0.3 * sequenceRatio(incoming.joined, cand.joined);
}

/**
 * The skip test's upper bound on the blended score, given the candidate's weighted Jaccard.
 *
 * Exported, and the single place the constant lives, so the soundness of the skip is asserted rather
 * than only argued: `matcher.test.ts` checks this against every blended score it computes in full.
 * Tightening it below `0.7 * J + 0.3` would skip candidates that can still win, and the effect is
 * input-dependent — a bank where no such candidate happens to exist today keeps a full-scan
 * comparison green while the optimization has stopped being exact.
 */
export function scoreUpperBound(jaccard: number): number {
  return 0.7 * jaccard + 0.3;
}

const NO_MATCH = (text: string): MatchResult => ({
  incoming: text,
  matched_id: null,
  canonical: null,
  category: null,
  kb_ref: null,
  answer_type: null,
  confidence: 0.0,
  matched_via: null,
  is_confident: false,
});

/**
 * Best canonical match for one incoming question string.
 *
 * Scores the incoming text against each canonical phrasing **and** each recorded funder variant,
 * keeping the highest. Ties break to the earlier entry: a question only displaces the incumbent on
 * a strictly greater score, and within a question a variant only displaces the canonical phrasing
 * on a strictly greater score. That ordering is part of the parity contract, not an implementation
 * detail — the bank's order determines the winner when two entries score identically.
 *
 * Returns an all-null result when nothing scores above zero, which is what an empty or
 * all-stopword input produces.
 */
export function matchQuestion(
  text: string,
  bank: QuestionBank = loadBank(),
  threshold: number = DEFAULT_THRESHOLD,
): MatchResult {
  const incoming = prepare(text);
  let best: Question | undefined;
  let bestScore = 0.0;
  let bestVia: MatchedVia | null = null;

  for (const q of candidatesFor(bank)) {
    // CANNOT_WIN stands in for a score proven to be at or below the incumbent without computing it.
    // Any candidate that is computed necessarily scores above the incumbent, hence above this, so it
    // displaces — which is the same outcome the exact comparison would produce (see scoreOrSkip).
    let s = scoreOrSkip(incoming, q.canonical, bestScore);
    let via: MatchedVia = 'canonical';
    for (const v of q.variants) {
      const vs = scoreOrSkip(incoming, v.candidate, bestScore);
      if (vs > s) {
        s = vs;
        via = v.source;
      }
    }
    if (s > bestScore) {
      best = q.question;
      bestScore = s;
      bestVia = via;
    }
  }

  if (best === undefined) return NO_MATCH(text);

  return {
    incoming: text,
    matched_id: best.id,
    canonical: best.canonical,
    category: best.category,
    kb_ref: best.kb_ref,
    answer_type: best.answer_type,
    confidence: pyRound(bestScore, 3),
    matched_via: bestVia,
    // Compared against the unrounded score, as in the prototype.
    is_confident: bestScore >= threshold,
  };
}

/** {@link matchQuestion} across a whole captured form, in order. */
export function matchForm(
  questions: readonly string[],
  bank: QuestionBank = loadBank(),
  threshold: number = DEFAULT_THRESHOLD,
): MatchResult[] {
  return questions.map((q) => matchQuestion(q, bank, threshold));
}

#!/usr/bin/env node
/**
 * Gap-fill worksheet: turn a form's gaps into candidate records to research and draft, and validate
 * them once filled.
 *
 *   node gapfill.mjs <form-id-or-path> [--out candidates.json]
 *   node gapfill.mjs --validate candidates.json
 *
 * See references/gap-fill.md. A candidate is never written into seed/kb_launchpad.json — promotion is
 * a human action, because `verified:true` there means grounded in filed material.
 */

import { argv, exit } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

const GRANTS = new URL('../../../../packages/grants/dist/index.js', import.meta.url).href;
const {
  loadForm, loadKnowledgeBase, matchForm, measure, DEFAULT_THRESHOLD,
} = await import(GRANTS);

const args = argv.slice(2);

/** Ladder rungs to suggest per gap class. references/gap-fill.md holds the reasoning. */
const LADDER = {
  no_kb_answer: [
    'live platform data (query_*/get_* MCP tools) for any figure',
    'prior filed applications: corpus_search.py "<question keywords>"',
    "the funder's own guidelines, site, and 990 for alignment questions",
  ],
  kb_unverified: [
    'live platform data — the stored text is a true unknown, not a weak answer',
    'search_documents / search_conversations for internal confirmation',
    'prior filed applications: corpus_search.py "<question keywords>"',
  ],
  low_confidence: [
    'RE-ROUTE FIRST: confirm the bank mapping by hand; a good answer may already exist elsewhere',
    'only research once you have confirmed no KB slot fits',
  ],
  unmatched: [
    'prior filed applications: corpus_search.py "<question keywords>"',
    'Notion research wiki 33779abd-443f-8075-8a47-000b973f8eba for evidence questions',
    'ask staff if the question is funder-specific judgement',
  ],
};

const BANNED = [
  'transformative', 'innovative', 'holistic', 'leverage', 'ecosystem',
  'move the needle', 'at the intersection of', 'reimagine',
];

function validate(path) {
  const records = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(records)) {
    console.error('candidates file must be an array of records');
    return 2;
  }
  let bad = 0;
  for (const r of records) {
    const problems = [];
    const answer = (r.answer ?? '').trim();
    if (!answer) problems.push('answer is empty — nothing to review');
    if (!Array.isArray(r.sources) || r.sources.filter((s) => String(s ?? '').trim()).length === 0) {
      problems.push('no sources — an answer with no source is a guess, not a candidate');
    }
    if (r.verified !== false) problems.push('verified must be false on creation');
    if (r.needs_staff === undefined) problems.push('needs_staff missing (use "" only if genuinely nothing)');
    if (answer && /[—–]/.test(answer)) problems.push('em dash or en dash — use a hyphen');
    const jargon = BANNED.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(answer));
    if (jargon.length) problems.push(`banned jargon: ${jargon.join(', ')}`);
    if (answer && r.limit?.unit && r.limit?.max) {
      const m = measure({ text: answer, unit: r.limit.unit, max: r.limit.max });
      if (!m.fits) problems.push(`over limit: ${m.count}/${m.max} ${m.unit} (${m.ratio}x)`);
    }

    const label = `Q${r.n ?? '?'} ${String(r.question ?? '').slice(0, 60)}`;
    if (problems.length === 0) {
      console.log(`OK   ${label}`);
    } else {
      bad += 1;
      console.log(`BAD  ${label}`);
      for (const p of problems) console.log(`       - ${p}`);
    }
  }
  console.log(`\n${records.length} candidate(s), ${bad} needing work`);
  if (bad === 0) {
    console.log('Mechanical checks pass. A person still has to review every candidate before it is');
    console.log('used, and only a person may promote one into seed/kb_launchpad.json.');
  }
  return bad === 0 ? 0 : 1;
}

if (args[0] === '--validate') {
  const p = args[1];
  if (!p) { console.error('usage: gapfill.mjs --validate <candidates.json>'); exit(2); }
  exit(validate(p));
}

const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: gapfill.mjs <form-id-or-path> [--out candidates.json]');
  console.error('       gapfill.mjs --validate <candidates.json>');
  exit(2);
}

const form = loadForm(target);
const kb = loadKnowledgeBase();
const matches = matchForm(form.questions.map((q) => q.text));

const candidates = [];
for (const [i, q] of form.questions.entries()) {
  const m = matches[i];
  const stored = m?.kb_ref ? kb.answers?.[m.kb_ref] : undefined;

  let gapClass = null;
  if (!m?.matched_id) gapClass = 'unmatched';
  else if (!m.kb_ref || !stored) gapClass = 'no_kb_answer';
  else if (stored.verified === false) gapClass = 'kb_unverified';
  else if (!m.is_confident) gapClass = 'low_confidence';
  if (!gapClass) continue;

  candidates.push({
    n: i + 1,
    question: q.text,
    limit: q.limit ?? null,
    gap_class: gapClass,
    matched_id: m?.matched_id ?? null,
    matched_confidence: m?.confidence ?? 0,
    kb_ref: m?.kb_ref ?? null,
    research_ladder: LADDER[gapClass],
    answer: '',
    sources: [],
    verified: false,
    needs_staff: '',
  });
}

const outFlag = args.indexOf('--out');
const outPath = outFlag !== -1 ? args[outFlag + 1] : null;
const json = JSON.stringify(candidates, null, 2);

if (outPath) {
  writeFileSync(outPath, `${json}\n`);
  console.log(`${candidates.length} candidate(s) written to ${outPath}`);
  const byClass = candidates.reduce((a, c) => ({ ...a, [c.gap_class]: (a[c.gap_class] ?? 0) + 1 }), {});
  for (const [k, v] of Object.entries(byClass)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\nMatcher threshold is ${DEFAULT_THRESHOLD}. Work the ladder in each record, fill`);
  console.log('`answer`, `sources`, and `needs_staff`, then re-run with --validate.');
} else {
  console.log(json);
}

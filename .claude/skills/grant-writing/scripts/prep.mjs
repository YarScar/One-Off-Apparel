#!/usr/bin/env node
/**
 * Stage 1 of the grant drafting pipeline: turn a funder form into a work order.
 *
 * For every question on the form it reports the matched question-bank entry, the KB answer slot
 * that satisfies it, whether the stored answer fits the funder's limit, and which figures in that
 * answer must be re-verified against live data before drafting.
 *
 * It reads only. It never calls a connector and never writes a draft.
 *
 *   node .claude/skills/grant-writing/scripts/prep.mjs <form-id-or-path> [--json]
 *
 * <form-id-or-path> is a fixture id from packages/grants/seed/forms (e.g. `hamilton_loi_2025`)
 * or a path to a form JSON with the same shape: { meta, questions: [{ text, limit? }] }.
 */

import { argv, exit } from 'node:process';

const GRANTS = new URL(
  '../../../../packages/grants/dist/index.js',
  import.meta.url,
).href;

const {
  loadForm,
  loadKnowledgeBase,
  loadIntegrityReport,
  matchForm,
  measure,
  buildFigureWorkOrder,
  NON_NARRATIVE_ANSWER_TYPES,
} = await import(GRANTS);

const args = argv.slice(2);
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('usage: prep.mjs <form-id-or-path> [--json]');
  exit(2);
}

// Gate on `high` only. Since #275 a correctly maintained seed carries exactly one `medium`
// (`stored_figure_unsourced`, the FIGURE_DEBT register), and packages/grants/CLAUDE.md §4 item 17
// names the guarantee as "zero `high`". Gating on any warning refused on that baseline, making step 1
// of the documented workflow unrunnable — OpenProject #307. Mediums are reported, not blocked on.
const integrity = loadIntegrityReport();
const highWarnings = integrity.filter((w) => w.severity === 'high');
const otherWarnings = integrity.filter((w) => w.severity !== 'high');
if (highWarnings.length > 0) {
  console.error(`REFUSING: seed integrity report carries ${highWarnings.length} high-severity warning(s).`);
  console.error('Fix the seed before drafting — a defect here propagates into a funder-facing draft.');
  for (const w of highWarnings) console.error(`  [${w.severity}] ${w.code ?? ''} ${w.message ?? JSON.stringify(w)}`);
  exit(1);
}

const form = loadForm(target);
const kb = loadKnowledgeBase();
const matches = matchForm(form.questions.map((q) => q.text));
const nonNarrative = new Set(NON_NARRATIVE_ANSWER_TYPES ?? []);

const rows = form.questions.map((q, i) => {
  const m = matches[i];
  const kbRef = m?.kb_ref ?? null;
  const stored = kbRef ? kb.answers?.[kbRef] : undefined;

  let fit = null;
  if (stored?.text && q.limit) {
    const measured = measure({ text: stored.text, unit: q.limit.unit, max: q.limit.max });
    fit = {
      unit: q.limit.unit,
      max: q.limit.max,
      stored_count: measured.count,
      over_by: measured.over_by,
      ratio: measured.ratio,
      verdict: measured.verdict,
      guidance: measured.guidance,
    };
  }

  return {
    n: i + 1,
    question: q.text,
    limit: q.limit ?? null,
    matched_id: m?.matched_id ?? null,
    canonical: m?.canonical ?? null,
    category: m?.category ?? null,
    answer_type: m?.answer_type ?? null,
    confidence: m?.confidence ?? 0,
    is_confident: m?.is_confident ?? false,
    matched_via: m?.matched_via ?? null,
    kb_ref: kbRef,
    kb_verified: stored?.verified ?? null,
    kb_missing: Boolean(kbRef) && !stored,
    narrative: !nonNarrative.has(m?.answer_type),
    fit,
  };
});

const kbRefs = [...new Set(rows.map((r) => r.kb_ref).filter(Boolean))];
const figures = buildFigureWorkOrder(kbRefs);

const report = {
  form: { funder: form.meta?.funder, program: form.meta?.program, due: form.meta?.due, framing: form.meta?.framing },
  // Surfaced 2026-08-19 (#307). The gate passes on non-`high` warnings now, so a --json consumer that
  // inferred "prep exited 0, therefore the report was empty" would be wrong. Report it explicitly.
  seed_integrity: { high: highWarnings, non_blocking: otherWarnings },
  questions: rows,
  figure_work_order: figures,
  gaps: {
    unmatched: rows.filter((r) => !r.matched_id).map((r) => r.n),
    low_confidence: rows.filter((r) => r.matched_id && !r.is_confident).map((r) => r.n),
    no_kb_answer: rows.filter((r) => !r.kb_ref).map((r) => r.n),
    kb_unverified: rows.filter((r) => r.kb_verified === false).map((r) => r.n),
    over_limit: rows.filter((r) => r.fit && r.fit.verdict !== 'fits').map((r) => r.n),
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  exit(0);
}

const { funder, program, due, framing } = report.form;
console.log(`FORM   ${funder ?? '(unknown funder)'}${program ? ` — ${program}` : ''}`);
if (due) console.log(`DUE    ${due}`);
if (framing) console.log(`FRAMING (as filed) ${framing}`);
// Never say "clean" unconditionally — that was a false statement whenever the register was
// non-empty, and the register is non-empty on a correct seed. Name what was actually seen.
const seedState =
  otherWarnings.length === 0
    ? 'no warnings'
    : `zero high, ${otherWarnings.length} non-blocking (${otherWarnings.map((w) => w.code).join(', ')})`;
console.log(`SEED   integrity ${seedState}; ${rows.length} questions`);
// The register's message concatenates every debt entry, so it runs to thousands of characters.
// Printed in full it buries the work order below it. One truncated line each, and a pointer.
for (const w of otherWarnings) {
  const msg = String(w.message ?? '').replace(/\s+/g, ' ');
  console.log(`  [${w.severity}] ${w.code}: ${msg.length > 150 ? `${msg.slice(0, 150)}…` : msg}`);
}
if (otherWarnings.length > 0) {
  console.log('  ^ expected on a correct seed (the FIGURE_DEBT register, #280). Not a reason to stop;');
  console.log('    do verify by hand any figure it names that this form actually asks for.');
}
console.log('');

for (const r of rows) {
  const lim = r.limit ? `${r.limit.max} ${r.limit.unit}` : 'no limit';
  const conf = r.matched_id ? `${r.matched_id} @ ${r.confidence.toFixed(2)} via ${r.matched_via}` : 'NO MATCH';
  console.log(`${String(r.n).padStart(2)}. ${r.question.slice(0, 96)}`);
  console.log(`    limit: ${lim}   match: ${conf}${r.is_confident ? '' : '  <-- LOW CONFIDENCE, confirm by hand'}`);
  if (r.kb_ref) {
    const v = r.kb_verified === false ? ' UNVERIFIED — do not present as confirmed' : '';
    const f = r.fit
      ? `  stored=${r.fit.stored_count}/${r.fit.max} ${r.fit.unit} (${r.fit.ratio}x) -> ${r.fit.verdict}`
      : '';
    console.log(`    kb: ${r.kb_ref}${v}${f}${r.kb_missing ? '  MISSING FROM KB' : ''}`);
    if (r.fit && r.fit.verdict !== 'fits') console.log(`    -> ${r.fit.guidance}`);
  } else {
    console.log('    kb: none — this answer must be written from live data or asked about');
  }
}

console.log('\nGAPS');
for (const [k, v] of Object.entries(report.gaps)) {
  console.log(`  ${k.padEnd(16)} ${v.length ? v.join(', ') : '-'}`);
}

console.log(`\nFIGURES TO RE-VERIFY BEFORE DRAFTING (${figures.items.length})`);
console.log(`  KB snapshot: ${figures.kb_snapshot_date}`);
for (const c of figures.items) {
  console.log(`  [${c.severity}/${c.conflict_kind}] ${c.key}`);
  console.log(`     claim: ${c.claim}`);
  console.log(`     call:  ${c.tool}(${JSON.stringify(c.args)})`);
  console.log(`     note:  ${c.note}`);
  if (c.conflict_kind === 'definitional') {
    console.log('     ESCALATE: both numbers are true of different populations. Ask which one this');
    console.log('     funder means. Never resolve it silently.');
  }
}
if (figures.blocked.length > 0) {
  // Was "TOOLS THAT MAY BE ACL-DENIED". Retitled 2026-08-19 (#306): the list now also carries a
  // permitted-but-unpopulated tool and a reachable tab with wrong columns. Labelling those as ACL
  // denials told the drafter to expect a permission error and to treat the tool as unavailable-to-them
  // rather than wrong-for-everyone, which is a different, and wrong, next action.
  console.log('\nTOOL CAVEATS — read the reason; not all of these are ACL denials');
  for (const b of figures.blocked) console.log(`  ${b.tool}: ${b.reason}`);
}
console.log(`\nPOLICY\n  ${figures.policy}`);

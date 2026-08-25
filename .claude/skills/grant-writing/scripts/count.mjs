#!/usr/bin/env node
/**
 * Stage 3 of the grant drafting pipeline: verify every drafted answer against its funder limit.
 *
 * Counting by eye is banned — see references/style.md. This uses the same `measure()` the platform
 * uses, so a count here is the count the layer reports.
 *
 *   node .claude/skills/grant-writing/scripts/count.mjs drafts.json
 *
 * drafts.json: [{ "label": "Q4 Statement of Need", "text": "...", "unit": "characters", "max": 2500 }]
 * `unit` is "words" or "characters". Exit code is 1 if anything is over, so it fails loudly.
 */

import { argv, exit } from 'node:process';
import { readFileSync } from 'node:fs';

const GRANTS = new URL('../../../../packages/grants/dist/index.js', import.meta.url).href;
const { measureAll, BANNED_JARGON } = await import(GRANTS);

const path = argv[2];
if (!path) {
  console.error('usage: count.mjs <drafts.json>');
  exit(2);
}

const drafts = JSON.parse(readFileSync(path, 'utf8'));
if (!Array.isArray(drafts)) {
  console.error('drafts.json must be an array of { label, text, unit, max }');
  exit(2);
}

const batch = measureAll(drafts);

let failed = 0;
for (const m of batch.items) {
  const flag = m.fits ? 'OK  ' : 'OVER';
  if (!m.fits) failed += 1;
  console.log(`${flag} ${String(m.count).padStart(5)}/${m.max} ${m.unit.padEnd(10)} ${m.label ?? '(unlabeled)'}`);
  if (!m.fits) console.log(`       over by ${m.over_by} (${m.ratio}x) — ${m.guidance}`);
}

// The style rules ban em dashes outright, and a stray one is the single most common tell in an
// AI-written draft. Catch it here rather than letting a reviewer find it.
const emDash = drafts.filter((d) => /[—–]/.test(d.text ?? ''));
if (emDash.length > 0) {
  failed += 1;
  console.log('\nEM DASH / EN DASH FOUND — replace with a hyphen or restructure the sentence:');
  for (const d of emDash) {
    const hits = (d.text.match(/[^.!?]*[—–][^.!?]*/g) ?? []).slice(0, 3);
    console.log(`  ${d.label ?? '(unlabeled)'}`);
    for (const h of hits) console.log(`    ...${h.trim().slice(0, 110)}...`);
  }
}

const jargon = drafts
  .map((d) => ({
    label: d.label,
    hits: BANNED_JARGON.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(d.text ?? '')),
  }))
  .filter((x) => x.hits.length > 0);
if (jargon.length > 0) {
  failed += 1;
  console.log('\nBANNED JARGON FOUND — say the specific thing instead:');
  for (const j of jargon) console.log(`  ${j.label ?? '(unlabeled)'}: ${j.hits.join(', ')}`);
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK GROUP(S) FAILED — fix before presenting`}`);
exit(failed === 0 ? 0 : 1);

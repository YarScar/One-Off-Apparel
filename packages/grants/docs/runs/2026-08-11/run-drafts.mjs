// Drive the deterministic grants pipeline over several form fixtures and write each
// rendered draft package to Markdown, plus a JSON dump of the structured result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

// ../../../dist/index.js — packages/grants/dist, from packages/grants/docs/runs/<date>/.
const GRANTS = new URL('../../../dist/index.js', import.meta.url).href;

const { loadForm, runPipeline, renderMarkdown, loadIntegrityReport } = await import(GRANTS);

const outDir = argv[2];
const forms = argv.slice(3);
mkdirSync(outDir, { recursive: true });

const integrity = loadIntegrityReport();
console.log(`integrity warnings: ${integrity.length}`);
for (const w of integrity) console.log(`  [${w.severity}] ${w.code ?? ''} ${w.message ?? ''}`);

for (const id of forms) {
  const form = loadForm(id);
  const pkg = runPipeline(form);
  const md = renderMarkdown(pkg);
  writeFileSync(`${outDir}/${id}.md`, md, 'utf8');
  writeFileSync(`${outDir}/${id}.json`, JSON.stringify(pkg, null, 2), 'utf8');
  const s = pkg.summary;
  console.log(
    `\n${id}  (${form.meta.funder})\n` +
      `  questions ${s.total}  all_fit=${s.all_fit}  ` +
      `actors: none ${s.by_actor.none} / llm ${s.by_actor.llm} / staff ${s.by_actor.staff}\n` +
      `  statuses: ${Object.entries(s.by_status).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
      `  kb slots used: ${pkg.kb_refs_used.length}  figure checks: ${pkg.figure_work_order.items.length}\n` +
      `  -> ${outDir}/${id}.md (${md.length} chars)`,
  );
}

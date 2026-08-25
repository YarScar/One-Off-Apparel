/**
 * render-markdown.ts — the pure-presentation half of `pipeline.ts`.
 *
 * Extracted verbatim from `pipeline.ts` (no behaviour change) because it had zero coupling back into
 * resolution logic — everything here reads `AnswerPlan`/`AnswerStatus`/`DraftPackage` as data, never
 * calls into `buildAnswer` or `resolveTextAnswer`. Keeping it in `pipeline.ts` was the reason that file
 * crossed 1000 lines with no logic gained from the extra length.
 */

import type { AnswerPlan, AnswerStatus, DraftPackage } from './pipeline.js';

/**
 * The reviewer-facing note per status. Deliberately blunt: this is the line a grant lead skims to
 * decide whether a section is done or still owes work, and to whom.
 */
export const STATUS_NOTE: Readonly<Record<AnswerStatus, string>> = {
  fits: 'Ready to review — within the funder’s limit.',
  ready: 'Ready to review — no stated limit.',
  needs_resize: 'OVER LIMIT — hand back for shortening.',
  needs_expand:
    'UNDER-ANSWERED — the stored value fits the field but does not fill it. Keep the value verbatim and write the answer around it from the source material, no further than that material supports.',
  compression_infeasible:
    'OVER LIMIT by more than compression can cover — shortening this means dropping facts, and the rewrite must say which.',
  derive_from_reference:
    'NEEDS A SHORT VALUE — the stored answer is narrative; derive the value from it rather than pasting it.',
  needs_live_figures:
    'FIGURES NOT FILLED — the stored answer is language with its figures removed. Run the named calls and fill each {{slot}}. The text below is a template, not an answer.',
  needs_application_figures:
    'STAFF — the stored answer needs a value belonging to THIS application (an amount, a period). No connector holds it. The text below is a template, not an answer.',
  fetch_figure:
    'NEEDS A LIVE FIGURE — run the named query_* call and write its result; a frozen KB number is not an acceptable answer.',
  figure_definitional:
    'NEEDS A LIVE FIGURE + STAFF — the check is definitional; run the named query_* call, then staff confirm which population the funder means before the number is written.',
  needs_attachment: 'STAFF — this field wants a document upload. The text below is the checklist.',
  per_application: 'STAFF — application-specific value. No stored answer exists.',
  needs_review: 'STAFF — low match confidence. Confirm the question or add a variant.',
  kb_gap: 'STAFF — no knowledge base entry. Write one.',
  kb_placeholder: 'STAFF — the knowledge base entry is not real content yet. Supply it.',
};

const BANNER =
  '> **Draft for staff review — not submittable as-is.** Answers come from LaunchPad’s knowledge ' +
  'base, which stores **language only**: every figure with a live source is a `{{slot}}` filled from ' +
  'the connector, never a stored number. A section still showing a `{{slot}}` is a template and is not ' +
  'an answer — do not paste it anywhere. Sections marked **OVER LIMIT**, **UNDER-ANSWERED**, **NEEDS A ' +
  'SHORT VALUE** or **FIGURES NOT FILLED** still owe work from the calling model; sections marked ' +
  '**STAFF** need a person.';

/**
 * Render one draft package as Markdown: question, answer, provenance footline, outstanding work.
 *
 * This is the artifact a grant lead edits and pastes into the funder's portal. It is never
 * auto-submitted, and the banner says so at the top of every render.
 */
export function renderMarkdown(pkg: DraftPackage): string {
  const meta = pkg.form;
  const L: string[] = [];

  L.push(`# Grant draft — ${meta.funder}`);
  L.push('');
  if (meta.program !== undefined) L.push(`**Program:** ${meta.program}  `);
  if (meta.due !== undefined) L.push(`**Due:** ${meta.due}  `);
  if (meta.framing !== undefined) L.push(`**Framing:** ${meta.framing}  `);
  L.push(`**Questions:** ${String(pkg.summary.total)}  `);
  L.push(
    `**Outstanding:** ${String(pkg.summary.by_actor.llm)} awaiting a rewrite · ` +
      `${String(pkg.summary.by_actor.staff)} awaiting staff  `,
  );
  L.push(
    '**Status counts:** ' +
      Object.entries(pkg.summary.by_status)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(' · '),
  );
  L.push('');
  L.push(BANNER);
  L.push('');
  L.push('---');
  L.push('');

  pkg.results.forEach((r, i) => {
    L.push(`## ${String(i + 1)}. ${r.incoming}`);
    L.push('');
    L.push(`*${STATUS_NOTE[r.status]}*`);
    L.push('');

    if (r.answer !== undefined) {
      L.push(`> ${r.answer.replace(/\n/g, '\n> ')}`);
      L.push('');
    }

    // Source material for an owed rewrite is collapsed, not blockquoted. A `derive_from_reference`
    // field wants a short value — `cover.project_title` is a 30-character "name of your solution"
    // routed to a 199-word program description — and rendering that at full width reads as the
    // answer to anyone skimming.
    if (r.handback !== undefined) {
      // The confirmed value first, and outside the collapsed block. On a `needs_expand` result the
      // value is deliberately withheld from `answer` — see the branch above — so if it is not rendered
      // here it appears nowhere at all, and the reviewer reads "keep this verbatim" about a value the
      // document does not contain. Work package #253.
      if (r.handback.anchor_value !== undefined) {
        L.push(
          `**Confirmed value — must survive verbatim:** ${r.handback.anchor_value}  \n` +
            `The answer is written *around* this, from the source material below.`,
        );
        L.push('');
      }
      L.push(`<details><summary>${handbackLabel(r)}</summary>\n\n${r.handback.source_text}\n\n</details>`);
      L.push('');
    }

    // A gated result withheld `answer`, so on the staff path — which carries no handback — the template
    // appears nowhere unless it is rendered here. Rendered as a fenced block rather than a blockquote:
    // a blockquote is how this document renders finished answers, and a template must not look like one.
    if (r.figure_template !== undefined && r.handback === undefined) {
      L.push(
        `<details><summary>Template — NOT an answer, ${String(r.figure_slots?.length ?? 0)} slot(s) ` +
          `unfilled</summary>\n\n\`\`\`\n${r.figure_template}\n\`\`\`\n\n</details>`,
      );
      L.push('');
    }

    // What each unfilled slot needs, on either gated path. The call is per slot rather than
    // deduplicated here: a reviewer reads this to check a specific number, not to plan the calls.
    if (r.figure_slots !== undefined && r.figure_slots.length > 0) {
      // `population` gets its own column rather than being folded into the call. A reviewer checking a
      // figure is checking whether it answers the question, and the cut is the part that decides that —
      // buried inside a call signature it reads as configuration.
      L.push('| Slot | Needs | Fill from | Population that call returns |');
      L.push('|---|---|---|---|');
      for (const s of r.figure_slots) {
        const from =
          s.kind === 'per_application'
            ? '**a person — this application’s own value**'
            : s.tool === undefined
              ? '**no call recorded — staff**'
              : `\`${s.tool}\`(${Object.entries(s.args ?? {})
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(', ')})${s.needs_staff_decision ? ' **+ staff decision**' : ''}`;
        L.push(`| \`{{${s.slot}}}\` | ${s.describes} | ${from} | ${s.population ?? '—'} |`);
      }
      L.push('');
      L.push(
        '**If a question asked about a different population than the one shown, the stored sentence ' +
          'does not answer it.** Filling it anyway produces a false sentence containing a true number.',
      );
      L.push('');
    }

    // A live-figure field has no stored answer to show; the work is the named call.
    if (r.figure_call !== undefined) {
      const args = Object.entries(r.figure_call.args)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(', ');
      L.push(
        `Run \`${r.figure_call.tool}\` with (${args}) and write the returned figure. ` +
          `Do NOT quote a frozen KB number. Then call \`grant_verify_figure\` with this answer, this ` +
          `figure_call, and the result before finalizing.`,
      );
      L.push('');
    }

    const preview = r.measurement?.truncated_preview;
    if (preview !== undefined) {
      L.push(
        `<details><summary>Truncation preview — NOT a resize, and not submittable</summary>\n\n` +
          `${preview}\n\n</details>`,
      );
      L.push('');
    }

    const footline = provenance(r);
    if (footline !== '') {
      L.push(`<sub>${footline}</sub>`);
      L.push('');
    }
    L.push('---');
    L.push('');
  });

  return L.join('\n');
}

/**
 * The collapsed-block heading for an owed rewrite, per handback task.
 *
 * One arm per `HandbackTask`, because a `switch` on the union is what makes the compiler catch
 * the next task added. This was a two-arm ternary keyed on `'resize'`, which rendered an `expand`
 * handback under the `derive_short_value` wording — "Source material to derive the value from" told a
 * reviewer to extract a short value from a field that wanted the opposite. Work package #253.
 */
function handbackLabel(r: AnswerPlan): string {
  switch (r.handback?.task) {
    case 'resize':
      return (
        `Source text to shorten — ${String(r.measurement?.count)} ` +
        `${String(r.measurement?.unit)}, NOT submittable at this length`
      );
    case 'expand':
      return (
        `Source material to write the fuller answer from — ${String(r.measurement?.count)} of ` +
        `${String(r.measurement?.max)} ${String(r.measurement?.unit)} used, NOT the finished answer`
      );
    case 'fill_figures':
      return 'Approved language with its figures removed — a TEMPLATE, not an answer. Fill every {{slot}} below';
    case 'derive_short_value':
    case undefined:
      return 'Source material to derive the value from — NOT the answer to this field';
  }
}

/** The provenance and measurement footline for one answer: where it came from and how it measures. */
function provenance(r: AnswerPlan): string {
  const bits: string[] = [];
  if (r.matched_id !== null) bits.push(`canonical \`${r.matched_id}\``);
  if (r.kb_ref !== null) bits.push(`KB \`${r.kb_ref}\``);
  if (r.matched_via !== null) bits.push(`via ${r.matched_via}`);
  if (r.from_structured === true) bits.push('from structured value');
  bits.push(`match ${r.confidence.toFixed(2)}`);
  if (r.measurement !== undefined) {
    const m = r.measurement;
    bits.push(`length ${String(m.count)} / ${String(m.max)} ${m.unit}`);
    if (!m.fits) bits.push(`**${String(m.ratio)}x over**`);
  }
  if (r.kb_ref !== null && r.verified !== undefined) {
    bits.push(r.verified ? 'grounded in a filed application' : '⚠ not grounded in a filed application');
  }
  if (r.carries_figures === true) bits.push('⚠ carries figures — verify live');
  return bits.join(' · ');
}

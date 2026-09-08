'use client';

import { useState, type ChangeEvent, type JSX } from 'react';
import {
  screenPrint,
  embroideryFlat,
  finishing as finishingEstimate,
  detectFinishingKind,
  type OpEstimate,
  type PrintClass,
} from './estimate';

// ---------- CSV parsing ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        cur.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field);
        field = '';
        if (cur.some((v) => v.trim() !== '')) rows.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    if (cur.some((v) => v.trim() !== '')) rows.push(cur);
  }
  return rows;
}

// ---------- Domain types ----------

type LineKind = 'garment' | 'decoration' | 'finishing' | 'ignored' | 'unknown';

interface RawRow {
  index: number;
  raw: Record<string, string>;
}

interface GarmentLine {
  index: number;
  code: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  garmentKey: string;
}

interface GarmentTotal {
  key: string;
  code: string;
  name: string;
  color: string;
  totalQty: number;
  klass: 'Thin' | 'Poly' | 'Bulky' | 'Unknown';
  klassReason: string;
}

interface DecorationLine {
  index: number;
  type: string;
  position: string;
  quantity: number;
  colors: number | null;
  stitches: number | null;
  threadColors: number | null;
  printStyle: string | null;
  rawName: string;
}

interface FinishingLine {
  index: number;
  type: string;
  quantity: number;
  rawName: string;
}

interface UnmappedLine {
  index: number;
  rawName: string;
  quantity: number;
}

interface Issue {
  index: number;
  severity: 'error' | 'warn';
  message: string;
}

interface Extraction {
  headers: string[];
  garmentLines: GarmentLine[];
  garmentTotals: GarmentTotal[];
  decorations: DecorationLine[];
  finishing: FinishingLine[];
  unmapped: UnmappedLine[];
  ignored: RawRow[];
  issues: Issue[];
}

// ---------- Column matchers ----------

const COL_ALIASES: Record<string, string[]> = {
  type: ['type', 'item type', 'line type', 'category', 'kind'],
  code: ['code', 'sku', 'item code', 'style', 'style code', 'product code'],
  name: ['name', 'item', 'item name', 'description', 'name description', 'product', 'product name'],
  color: ['color', 'colour', 'colors', 'colours', 'garment color'],
  size: ['size'],
  quantity: ['quantity', 'qty', 'total qty', 'total'],
  position: ['position', 'location', 'placement'],
  colors: ['color count', 'ink colors', 'num colors', 'num_colors'],
  stitches: ['stitches', 'stitch count'],
  threads: ['thread colors', 'thread count', 'threads'],
  printStyle: ['print style', 'style print'],
  jobNumber: ['job', 'job number', 'job_number', 'job#'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
}

function pickColumn(headers: string[], key: keyof typeof COL_ALIASES): string | null {
  const norm = headers.map(normalizeHeader);
  for (const alias of COL_ALIASES[key] ?? []) {
    const idx = norm.indexOf(alias);
    if (idx >= 0) return headers[idx] ?? null;
  }
  return null;
}

// ---------- Classification helpers ----------

function classifyGarment(name: string): { klass: GarmentTotal['klass']; reason: string } {
  const n = name.toLowerCase();
  if (/(sweatshirt|crewneck|hoodie|fleece|jacket|heavyweight)/.test(n))
    return { klass: 'Bulky', reason: 'matched bulky keyword' };
  if (/(polo|performance|moisture[- ]?wicking|athletic tee)/.test(n))
    return { klass: 'Poly', reason: 'matched poly keyword' };
  if (/(tri[- ]?tee|t[- ]?shirt|\btee\b|tank|jersey)/.test(n))
    return { klass: 'Thin', reason: 'matched thin keyword' };
  return { klass: 'Unknown', reason: 'no keyword matched — needs manual classification' };
}

const FINISHING_KEYWORDS = [
  'printed relabel',
  'relabel',
  'fold & bag',
  'fold and bag',
  'matte finish',
  'hang tag',
  'woven label',
];

const DECORATION_KEYWORDS = ['screen print', 'embroider', 'embroidery', 'dtf', 'dtg', 'heat transfer', 'vinyl'];

const IGNORED_KEYWORDS = ['shipping', 'discount', 'tax', 'setup fee'];

const ITEM_TYPE_MAP: Record<string, LineKind> = {
  garment: 'garment',
  apparel: 'garment',
  blank: 'garment',
  screen_print: 'decoration',
  'screen print': 'decoration',
  screenprint: 'decoration',
  embroidery: 'decoration',
  embroider: 'decoration',
  dtf: 'decoration',
  dtg: 'decoration',
  heat_transfer: 'decoration',
  vinyl: 'decoration',
  woven_label: 'finishing',
  'woven label': 'finishing',
  printed_relabel: 'finishing',
  relabel: 'finishing',
  fold_and_bag: 'finishing',
  'fold & bag': 'finishing',
  matte_finish: 'finishing',
  hang_tag: 'finishing',
  hang_tags: 'finishing',
  shipping: 'ignored',
  discount: 'ignored',
  tax: 'ignored',
  setup_fee: 'ignored',
};

function classifyLine(row: Record<string, string>, headers: string[]): LineKind {
  const typeCol = pickColumn(headers, 'type');
  const nameCol = pickColumn(headers, 'name');
  const typeVal = (typeCol ? row[typeCol] : '')?.toLowerCase().trim() ?? '';
  const nameVal = (nameCol ? row[nameCol] : '')?.toLowerCase() ?? '';

  if (typeVal) {
    const mapped = ITEM_TYPE_MAP[typeVal] ?? ITEM_TYPE_MAP[typeVal.replace(/\s+/g, '_')];
    if (mapped) return mapped;
  }

  const blob = `${typeVal} ${nameVal}`;
  if (IGNORED_KEYWORDS.some((k) => blob.includes(k))) return 'ignored';
  if (FINISHING_KEYWORDS.some((k) => blob.includes(k))) return 'finishing';
  if (DECORATION_KEYWORDS.some((k) => blob.includes(k))) return 'decoration';

  const sizeCol = pickColumn(headers, 'size');
  const codeCol = pickColumn(headers, 'code');
  const hasSize = sizeCol && (row[sizeCol] ?? '').trim() !== '';
  const hasCode = codeCol && (row[codeCol] ?? '').trim() !== '';
  if (hasSize || hasCode) return 'garment';
  return 'unknown';
}

function parseIntSafe(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function parseColorsFromName(name: string): number | null {
  const m = /(\d+)\s*color/i.exec(name);
  return m && m[1] ? parseIntSafe(m[1]) : null;
}

function parseStitchesFromName(name: string): number | null {
  const m = /([\d,]+)\s*stitch/i.exec(name);
  return m && m[1] ? parseIntSafe(m[1]) : null;
}

// ---------- Extraction ----------

function extract(text: string): Extraction {
  const grid = parseCsv(text);
  if (grid.length === 0) {
    return {
      headers: [],
      garmentLines: [],
      garmentTotals: [],
      decorations: [],
      finishing: [],
      unmapped: [],
      ignored: [],
      issues: [{ index: 0, severity: 'error', message: 'CSV appears empty.' }],
    };
  }
  const headers = grid[0] ?? [];
  const rows: RawRow[] = grid.slice(1).map((cells, i) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, hi) => {
      obj[h] = (cells[hi] ?? '').trim();
    });
    return { index: i + 2, raw: obj };
  });

  const issues: Issue[] = [];
  const garmentLines: GarmentLine[] = [];
  const decorations: DecorationLine[] = [];
  const finishing: FinishingLine[] = [];
  const unmapped: UnmappedLine[] = [];
  const ignored: RawRow[] = [];

  const codeCol = pickColumn(headers, 'code');
  const nameCol = pickColumn(headers, 'name');
  const colorCol = pickColumn(headers, 'color');
  const sizeCol = pickColumn(headers, 'size');
  const qtyCol = pickColumn(headers, 'quantity');
  const posCol = pickColumn(headers, 'position');
  const colorsCol = pickColumn(headers, 'colors');
  const stitchesCol = pickColumn(headers, 'stitches');
  const threadsCol = pickColumn(headers, 'threads');
  const typeCol = pickColumn(headers, 'type');

  if (!nameCol) issues.push({ index: 1, severity: 'error', message: 'Missing a name/description column.' });
  if (!qtyCol) issues.push({ index: 1, severity: 'error', message: 'Missing a quantity column.' });

  for (const r of rows) {
    const kind = classifyLine(r.raw, headers);
    const name = nameCol ? r.raw[nameCol] ?? '' : '';
    const qty = parseIntSafe(qtyCol ? r.raw[qtyCol] : '');

    if (kind === 'ignored') {
      ignored.push(r);
      continue;
    }

    if (kind === 'unknown') {
      unmapped.push({ index: r.index, rawName: name || JSON.stringify(r.raw), quantity: qty ?? 0 });
      issues.push({
        index: r.index,
        severity: 'warn',
        message: `Row ${String(r.index)}: could not classify as garment / decoration / finishing.`,
      });
      continue;
    }

    if (kind === 'garment') {
      const code = codeCol ? r.raw[codeCol] ?? '' : '';
      const color = colorCol ? r.raw[colorCol] ?? '' : '';
      const size = sizeCol ? r.raw[sizeCol] ?? '' : '';
      if (!code) issues.push({ index: r.index, severity: 'warn', message: `Row ${String(r.index)}: garment missing code/SKU.` });
      if (!color) issues.push({ index: r.index, severity: 'warn', message: `Row ${String(r.index)}: garment missing color (needed for steaming trigger).` });
      if (qty == null || qty <= 0) issues.push({ index: r.index, severity: 'error', message: `Row ${String(r.index)}: garment quantity invalid.` });
      garmentLines.push({
        index: r.index,
        code,
        name,
        color,
        size,
        quantity: qty ?? 0,
        garmentKey: `${code}|${color}`,
      });
      continue;
    }

    if (kind === 'decoration') {
      const typeVal = typeCol ? r.raw[typeCol] ?? '' : name;
      const position = posCol ? r.raw[posCol] ?? '' : '';
      const colors = parseIntSafe(colorsCol ? r.raw[colorsCol] : '') ?? parseColorsFromName(name);
      const stitches = parseIntSafe(stitchesCol ? r.raw[stitchesCol] : '') ?? parseStitchesFromName(name);
      const threadColors = parseIntSafe(threadsCol ? r.raw[threadsCol] : '');
      const printStyleCol = pickColumn(headers, 'printStyle');
      const printStyleRaw = printStyleCol ? (r.raw[printStyleCol] ?? '').trim() : '';
      const isScreen = /screen/i.test(`${typeVal} ${name}`);
      const isEmbroidery = /embroider/i.test(`${typeVal} ${name}`);

      if (!position) issues.push({ index: r.index, severity: 'warn', message: `Row ${String(r.index)}: decoration missing position.` });
      if (qty == null || qty <= 0) issues.push({ index: r.index, severity: 'error', message: `Row ${String(r.index)}: decoration quantity invalid.` });
      if (isScreen && colors == null) issues.push({ index: r.index, severity: 'error', message: `Row ${String(r.index)}: screen print missing color count (e.g. "2 Color Screen Print").` });
      if (isEmbroidery && stitches == null) issues.push({ index: r.index, severity: 'error', message: `Row ${String(r.index)}: embroidery missing stitch count.` });
      if (isEmbroidery && threadColors == null) issues.push({ index: r.index, severity: 'warn', message: `Row ${String(r.index)}: embroidery missing thread color count — will default to 1.` });

      decorations.push({
        index: r.index,
        type: typeVal || name,
        position,
        quantity: qty ?? 0,
        colors,
        stitches,
        threadColors,
        printStyle: printStyleRaw || null,
        rawName: name,
      });
      continue;
    }

    // finishing
    finishing.push({
      index: r.index,
      type: (typeCol ? r.raw[typeCol] ?? '' : '') || name,
      quantity: qty ?? 0,
      rawName: name,
    });
    if (qty == null || qty <= 0) issues.push({ index: r.index, severity: 'error', message: `Row ${String(r.index)}: finishing quantity invalid.` });
  }

  // Roll up garment totals per (code, color)
  const totalsMap = new Map<string, GarmentTotal>();
  for (const g of garmentLines) {
    const existing = totalsMap.get(g.garmentKey);
    if (existing) {
      existing.totalQty += g.quantity;
    } else {
      const c = classifyGarment(g.name);
      totalsMap.set(g.garmentKey, {
        key: g.garmentKey,
        code: g.code,
        name: g.name,
        color: g.color,
        totalQty: g.quantity,
        klass: c.klass,
        klassReason: c.reason,
      });
    }
  }
  const garmentTotals = Array.from(totalsMap.values());

  // Quantity-mismatch check: decoration quantity should equal SOME garment total,
  // or the overall total. Flag if it matches neither.
  const overallTotal = garmentTotals.reduce((s, g) => s + g.totalQty, 0);
  const totalsSet = new Set(garmentTotals.map((g) => g.totalQty));
  for (const d of decorations) {
    if (d.quantity > 0 && d.quantity !== overallTotal && !totalsSet.has(d.quantity)) {
      issues.push({
        index: d.index,
        severity: 'warn',
        message: `Row ${String(d.index)}: decoration qty ${String(d.quantity)} matches neither any single garment total nor the overall total (${String(overallTotal)}).`,
      });
    }
  }
  for (const g of garmentTotals) {
    if (g.klass === 'Unknown') {
      issues.push({
        index: 0,
        severity: 'warn',
        message: `Garment "${g.name}" (${g.code}) could not be classified as Thin/Poly/Bulky — manual assumption required.`,
      });
    }
  }

  return {
    headers,
    garmentLines,
    garmentTotals,
    decorations,
    finishing,
    unmapped,
    ignored,
    issues,
  };
}

// ---------- UI ----------

// ---------- Estimate assembly ----------

const DARK_COLOR_RE = /pigment|black|navy|charcoal|^dark /i;

function normalizeClass(s: string | null | undefined): PrintClass | null {
  const n = s?.trim().toLowerCase();
  if (n === 'thin') return 'Thin';
  if (n === 'poly') return 'Poly';
  if (n === 'bulky') return 'Bulky';
  return null;
}

function dominantGarmentClass(totals: GarmentTotal[]): PrintClass | null {
  const known = totals
    .map((t) => t.klass)
    .filter((k): k is PrintClass => k === 'Thin' || k === 'Poly' || k === 'Bulky');
  const set = new Set(known);
  if (set.size === 1 && known.length > 0) return known[0] ?? null;
  return null;
}

function resolveDecoClass(d: DecorationLine, totals: GarmentTotal[]): PrintClass | null {
  return normalizeClass(d.printStyle) ?? dominantGarmentClass(totals);
}

interface BuiltEstimate {
  lines: OpEstimate[];
  totalMinutes: number;
  scenarios: { klass: PrintClass; totalHours: number }[] | null;
  ambiguousLineIndexes: number[];
}

function buildEstimate(e: Extraction, assumed: PrintClass): BuiltEstimate {
  const lines: OpEstimate[] = [];
  const anyDark = e.garmentTotals.some((g) => DARK_COLOR_RE.test(g.color));
  const ambiguous: number[] = [];

  for (const d of e.decorations) {
    const resolved = resolveDecoClass(d, e.garmentTotals);
    const klass = resolved ?? assumed;
    if (!resolved) ambiguous.push(d.index);
    const t = `${d.type} ${d.rawName}`.toLowerCase();
    if (/screen/.test(t) && d.colors != null && d.quantity > 0) {
      lines.push(screenPrint(d.quantity, d.colors, klass, d.position));
    } else if (/embroider/.test(t) && d.stitches != null && d.quantity > 0) {
      lines.push(
        embroideryFlat(d.quantity, d.stitches, d.threadColors ?? 1, klass, d.position, anyDark),
      );
    }
  }

  for (const f of e.finishing) {
    const kind = detectFinishingKind(`${f.type} ${f.rawName}`);
    if (!kind || f.quantity <= 0) continue;
    const resolved = dominantGarmentClass(e.garmentTotals);
    const klass = resolved ?? assumed;
    if (!resolved) ambiguous.push(f.index);
    lines.push(finishingEstimate(kind, f.quantity, klass, f.type));
  }

  const totalMinutes = lines.reduce((s, l) => s + l.subtotalMinutes, 0);

  let scenarios: BuiltEstimate['scenarios'] = null;
  if (ambiguous.length > 0) {
    const classes: PrintClass[] = ['Thin', 'Poly', 'Bulky'];
    scenarios = classes.map((k) => {
      const b = buildEstimateInner(e, k, anyDark);
      return { klass: k, totalHours: b / 60 };
    });
  }

  return { lines, totalMinutes, scenarios, ambiguousLineIndexes: ambiguous };
}

// Inner version used only to compute scenario totals; skips ambiguity tracking.
function buildEstimateInner(e: Extraction, assumed: PrintClass, anyDark: boolean): number {
  let total = 0;
  for (const d of e.decorations) {
    const klass = resolveDecoClass(d, e.garmentTotals) ?? assumed;
    const t = `${d.type} ${d.rawName}`.toLowerCase();
    if (/screen/.test(t) && d.colors != null && d.quantity > 0) {
      total += screenPrint(d.quantity, d.colors, klass, d.position).subtotalMinutes;
    } else if (/embroider/.test(t) && d.stitches != null && d.quantity > 0) {
      total += embroideryFlat(d.quantity, d.stitches, d.threadColors ?? 1, klass, d.position, anyDark).subtotalMinutes;
    }
  }
  for (const f of e.finishing) {
    const kind = detectFinishingKind(`${f.type} ${f.rawName}`);
    if (!kind || f.quantity <= 0) continue;
    const klass = dominantGarmentClass(e.garmentTotals) ?? assumed;
    total += finishingEstimate(kind, f.quantity, klass, f.type).subtotalMinutes;
  }
  return total;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export function OrderUpload(): JSX.Element {
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setError(null);
    const reader = new FileReader();
    reader.onerror = (): void => setError('Failed to read file.');
    reader.onload = (): void => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      try {
        setResult(extract(text));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV.');
      }
    };
    reader.readAsText(f);
  }

  const errCount = result?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnCount = result?.issues.filter((i) => i.severity === 'warn').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-6">
        <label className="flex cursor-pointer flex-col items-center gap-2 text-sm text-muted">
          <span className="font-medium text-ink">Upload an order CSV</span>
          <span className="text-xs">
            Expected columns: line_item_id, job_number, item_type, position, name_description,
            colors, size, quantity, color_count, print_style, stitch_count, thread_count
          </span>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="mt-2 text-xs" />
          {fileName && <span className="mt-1 text-xs text-ink">Loaded: {fileName}</span>}
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Garment SKUs" value={result.garmentTotals.length.toString()} />
            <StatCard
              label="Total units"
              value={result.garmentTotals.reduce((s, g) => s + g.totalQty, 0).toLocaleString()}
            />
            <StatCard label="Decorations" value={result.decorations.length.toString()} />
            <StatCard
              label="Issues"
              value={`${errCount.toString()} err · ${warnCount.toString()} warn`}
              tone={errCount > 0 ? 'red' : warnCount > 0 ? 'amber' : 'green'}
            />
          </div>

          <Section title="Validation issues">
            {result.issues.length === 0 ? (
              <p className="text-sm text-muted">No issues found. Ready to estimate.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {result.issues.map((i, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span
                      className={`inline-flex h-5 shrink-0 items-center rounded px-2 text-xs font-medium ${
                        i.severity === 'error'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {i.severity}
                    </span>
                    <span className="text-ink">{i.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Garments (rolled up per SKU + color)">
            <SimpleTable
              headers={['Code', 'Name', 'Color', 'Qty', 'Class', 'Reason']}
              rows={result.garmentTotals.map((g) => [
                g.code || '—',
                g.name,
                g.color || '—',
                g.totalQty.toString(),
                g.klass,
                g.klassReason,
              ])}
            />
          </Section>

          <Section title="Decorations">
            <SimpleTable
              headers={['Row', 'Type', 'Position', 'Qty', 'Colors', 'Stitches', 'Threads']}
              rows={result.decorations.map((d) => [
                d.index.toString(),
                d.type,
                d.position || '—',
                d.quantity.toString(),
                d.colors?.toString() ?? '—',
                d.stitches?.toLocaleString() ?? '—',
                d.threadColors?.toString() ?? '—',
              ])}
            />
          </Section>

          <Section title="Finishing operations">
            {result.finishing.length === 0 ? (
              <p className="text-sm text-muted">None.</p>
            ) : (
              <SimpleTable
                headers={['Row', 'Type', 'Qty']}
                rows={result.finishing.map((f) => [f.index.toString(), f.type, f.quantity.toString()])}
              />
            )}
          </Section>

          {result.unmapped.length > 0 && (
            <Section title="Unmapped lines (need manual review)">
              <SimpleTable
                headers={['Row', 'Description', 'Qty']}
                rows={result.unmapped.map((u) => [u.index.toString(), u.rawName, u.quantity.toString()])}
              />
            </Section>
          )}

          <EstimateSection extraction={result} />
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'red' | 'amber' | 'green';
}): JSX.Element {
  const toneClass =
    tone === 'red'
      ? 'text-red-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'green'
          ? 'text-green-700'
          : 'text-ink';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-ink">{title}</h2>
      <div className="rounded-lg border bg-white p-4 shadow-sm">{children}</div>
    </section>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-4 text-center text-muted" colSpan={headers.length}>
                None.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2 align-top text-ink">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EstimateSection({ extraction }: { extraction: Extraction }): JSX.Element {
  const built = buildEstimate(extraction, 'Thin');
  const totalHours = built.totalMinutes / 60;

  if (built.lines.length === 0) {
    return (
      <Section title="Estimate">
        <p className="text-sm text-muted">
          No estimable operations found. Add screen print / embroidery / finishing lines to get a
          time estimate.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Estimate">
      {built.scenarios && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-900">Garment class ambiguous</div>
          <p className="mt-1 text-xs text-amber-800">
            No garment class could be determined for one or more lines (rows{' '}
            {built.ambiguousLineIndexes.join(', ')}). The breakdown below assumes <b>Thin</b>. Totals
            under each interpretation:
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {built.scenarios.map((s) => (
              <li key={s.klass} className="tabular-nums">
                If <b>{s.klass}</b>: <b>{fmt(s.totalHours)} hr</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 font-mono text-xs">
        {built.lines.map((line, i) => (
          <div key={i}>
            <div className="font-sans text-sm font-semibold text-ink">{line.title}</div>
            <table className="mt-1 w-full">
              <tbody>
                {line.components.map((c, j) => (
                  <tr key={j}>
                    <td className="py-0.5 pr-4 text-muted">{c.label}</td>
                    <td className="py-0.5 pr-4 tabular-nums text-ink">= {c.formula}</td>
                    <td className="py-0.5 text-right tabular-nums text-ink">
                      = {fmt(c.minutes)} min
                    </td>
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="pt-1"></td>
                  <td className="pt-1 text-right text-muted">subtotal</td>
                  <td className="pt-1 text-right font-semibold tabular-nums text-ink">
                    {fmt(line.subtotalMinutes)} min = {fmt(line.subtotalMinutes / 60)} hr
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t pt-3">
        <div className="text-sm font-medium text-ink">TOTAL</div>
        <div className="text-lg font-semibold tabular-nums text-ink">{fmt(totalHours)} hr</div>
      </div>
    </Section>
  );
}

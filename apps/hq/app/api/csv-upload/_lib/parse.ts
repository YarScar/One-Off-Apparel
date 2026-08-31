import { parse } from 'csv-parse/sync';

/**
 * Parses Anthropic's Team-plan spend-report CSV. Column names are unverified against a
 * real export (nobody in this org has downloaded one yet — see
 * docs/setup/22-anthropic-usage-connector.md) — they're built from the support article's
 * prose description of the fields, not a real header row. So header matching here is
 * loose (case/spacing/punctuation-insensitive, several aliases per field) rather than an
 * exact string match, and every raw row is kept in full in `rowData` regardless of which
 * columns were recognized — a wrong guess here loses nothing, it's just fixable later
 * without needing the file re-uploaded.
 */

export interface ParsedCsvRow {
  userEmail: string | null;
  accountUuid: string | null;
  productType: string | null;
  model: string | null;
  requestCount: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  grossSpendUsd: number | null;
  rowData: Record<string, string>;
}

/** Normalizes a header to lowercase/underscore form for alias matching. */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Each canonical field's accepted normalized header spellings, most-likely-first. The first
 * alias in each list is the header confirmed against a real Team-plan spend-report export
 * (`total_requests`, `total_prompt_tokens`, `total_completion_tokens`, `total_net_spend_usd`,
 * `total_gross_spend_usd`); the rest are the original pre-verification guesses, kept as a
 * fallback in case a different plan tier or a future export renames columns.
 */
const FIELD_ALIASES: Record<keyof Omit<ParsedCsvRow, 'rowData'>, string[]> = {
  userEmail: ['user_email', 'email', 'user'],
  accountUuid: ['account_uuid', 'account_id', 'user_uuid', 'uuid'],
  productType: ['product', 'product_type', 'surface'],
  model: ['model'],
  requestCount: ['total_requests', 'request_count', 'requests', 'num_requests'],
  promptTokens: ['total_prompt_tokens', 'prompt_tokens', 'input_tokens'],
  completionTokens: ['total_completion_tokens', 'completion_tokens', 'output_tokens'],
  costUsd: [
    'total_net_spend_usd',
    'cost_usd',
    'your_cost_usd',
    'your_cost',
    'cost_after_discount',
    'net_cost',
    'cost',
  ],
  grossSpendUsd: ['total_gross_spend_usd', 'gross_spend_usd', 'gross_spend', 'gross_cost_usd', 'gross_cost'],
};

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim().replace(/[$,]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseSpendReportCsv(csvText: string): ParsedCsvRow[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return records.map((raw) => {
    const normalized = new Map<string, string>();
    for (const [header, value] of Object.entries(raw)) {
      normalized.set(normalizeHeader(header), value);
    }

    function pick(field: keyof Omit<ParsedCsvRow, 'rowData'>): string | undefined {
      for (const alias of FIELD_ALIASES[field]) {
        const v = normalized.get(alias);
        if (v !== undefined && v !== '') return v;
      }
      return undefined;
    }

    return {
      userEmail: pick('userEmail') ?? null,
      accountUuid: pick('accountUuid') ?? null,
      productType: pick('productType') ?? null,
      model: pick('model') ?? null,
      requestCount: parseNum(pick('requestCount')),
      promptTokens: parseNum(pick('promptTokens')),
      completionTokens: parseNum(pick('completionTokens')),
      costUsd: parseNum(pick('costUsd')),
      grossSpendUsd: parseNum(pick('grossSpendUsd')),
      rowData: raw,
    };
  });
}

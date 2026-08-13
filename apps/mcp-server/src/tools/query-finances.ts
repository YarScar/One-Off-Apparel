import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'query_finances';

const DESCRIPTION =
  'Look up financial data from finance_snapshots. Each query_type maps to a data source tab (Google Sheets or Aplos accounting). Returns the raw rowData JSON so the caller can read whichever columns matter for the question. Every response carries tab_names_matched (the tabs the filter matched, independent of limit), total_matching and truncated, so a small limit is never mistaken for an empty tab. When contains is used on a large tab the search may stop early: total_matching_is_lower_bound and scan_incomplete then say so, and the count must not be quoted as a total. Rows carry their own tab_name — budget_actuals spans two tabs, so split on tab_name before summing or comparing.';

/**
 * Exported so the map-consistency test can assert every value resolves to a real
 * tab, a tab prefix, or an explicit "unbacked" explanation. Before this list was
 * checked, `budget_actuals` fell through to a tab_name that no connector writes
 * and returned an empty result set that read as "no financial data".
 */
export const FINANCE_QUERY_TYPES = [
  'prior_month',
    'ytd',
    'forecast',
    'monthly',
    'fund_balances',
    'annual',
    'budget_actuals',
    'phase_budget_dashboard',
    'phase_budget_monthly_liftoff',
    'phase_budget_monthly_hs',
    'q3_2026_actuals_global_pct',
    'q3_2026_actuals_hc_pct',
    'q3_2026_actuals',
    'phase_actuals_2025_global_pct',
    'phase_actuals_2025_hc_pct',
    'phase_actuals_2025_actuals',
    'rapid_dashboard',
    'rapid_transactions',
    'pex_dashboard',
    'pex_transactions',
    'dev_giving_history',
    'dev_prospect_pipeline',
    'dev_denied',
    'dev_launchpad_pipeline',
    'dev_grants_tracker',
    'dev_contacts',
    'aplos_accounts',
    'aplos_funds',
    'aplos_transactions',
] as const;

const inputSchema = {
  query_type: z.enum(FINANCE_QUERY_TYPES),
  tab_name: z.string().optional().describe('Override tab_name match (advanced).'),
  period: z.string().optional(),
  contains: z.string().optional().describe('Substring match against the JSON-serialized rowData.'),
  limit: z.number().optional(),
};

/**
 * Each query_type maps to the tab_name(s) a connector actually writes into
 * finance_snapshots. The sheet syncs and the seed disagree on casing:
 * sync-development-crm writes `development:grants tracker` while earlier
 * revisions of this map used Title Case, and Postgres string equality is case
 * sensitive, so every development and phase_dashboard tab silently returned
 * zero rows. Every name below is copied from the connector that writes it;
 * seed-only names (`ytd`, `fund_balances`) are kept alongside so seeded
 * databases stay reachable.
 *
 * Matching is exact rather than case-insensitive on purpose. Prisma compiles
 * `mode: 'insensitive'` to `ILIKE` and passes the value through unescaped, so
 * the `%` in `q3_2026_actuals:global %` becomes a wildcard and the tab claims
 * rows from any neighbour sharing that prefix. `finance-tab-map.test.ts` locks
 * the casing instead.
 */
const QUERY_TYPE_TO_TABS: Record<string, string[]> = {
  prior_month: ['Prior Month Budget vs Actual'],
  ytd: ['YTD Budget vs Actual', 'ytd'],
  forecast: ['Rolling Forecast'],
  monthly: ['Monthly'],
  fund_balances: ['Combined Funds', 'fund_balances'],
  annual: ['Annual'],
  // docs/mcp-server-spec.md documents this as "Prior month + YTD combined". Two
  // tabs means the same account line appears twice, once per period, so anything
  // summing or differencing this result MUST split on `tab_name` first — the
  // response's `tab_names_matched` names the tabs it drew from. `'ytd'` is carried
  // for the same reason as on `ytd` itself: it is the seed's name, and without it
  // this query_type — which four shipped prompts call — returns nothing on a
  // seeded or CI database.
  budget_actuals: ['Prior Month Budget vs Actual', 'YTD Budget vs Actual', 'ytd'],
  phase_budget_dashboard: ['phase_dashboard:2025 actuals'],
  phase_budget_monthly_liftoff: ['phase_dashboard:monthly liftoff only'],
  phase_budget_monthly_hs: ['phase_dashboard:monthly hs only'],
  q3_2026_actuals_global_pct: ['q3_2026_actuals:global %'],
  q3_2026_actuals_hc_pct: ['q3_2026_actuals:Human capital %'],
  q3_2026_actuals: ['q3_2026_actuals:actuals by phase'],
  phase_actuals_2025_global_pct: ['phase_actuals_2025:global %'],
  phase_actuals_2025_hc_pct: ['phase_actuals_2025:Human capital %'],
  phase_actuals_2025_actuals: ['phase_actuals_2025:actuals by phase'],
  rapid_dashboard: ['rapid:Dashboard'],
  pex_dashboard: ['pex:Dashboard'],
  dev_giving_history: ['development:giving history'],
  dev_prospect_pipeline: ['development:prospect pipeline'],
  dev_denied: ['development:denied'],
  dev_launchpad_pipeline: ['development:launchpad pipeline'],
  dev_grants_tracker: ['development:grants tracker'],
  dev_contacts: ['development:contacts'],
  aplos_accounts: ['aplos:accounts'],
  aplos_funds: ['aplos:funds'],
  aplos_transactions: ['aplos:transactions'],
};

const QUERY_TYPE_TO_TAB_PREFIX: Record<string, string> = {
  rapid_transactions: 'rapid:FY',
  pex_transactions: 'pex:FY',
};

/**
 * query_types kept in the enum that no connector writes a tab for. Empty today —
 * every query_type resolves to a real tab. When a source goes away, list the
 * query_type here with the alternative to use, so the tool says so instead of
 * returning an empty result set that reads as "the organization has no data".
 */
const UNBACKED_QUERY_TYPES: Record<string, string> = {};

/** Exported for the map-consistency test in __tests__. */
export const FINANCE_TAB_MAP = { QUERY_TYPE_TO_TABS, QUERY_TYPE_TO_TAB_PREFIX, UNBACKED_QUERY_TYPES };

/** Hard ceiling on rows pulled before `contains` filtering, to bound memory. */
const SCAN_CAP = 5000;

/**
 * Page size for the `contains` scan.
 *
 * The scan used to pull `SCAN_CAP` rows in one query and `JSON.stringify` every
 * one of them, so `contains` with `limit: 1` serialized 5000 JSON blobs to return
 * a single row. Paging lets it stop as soon as it has enough matches to answer,
 * and caps the pathological case at `SCAN_CAP / PAGE` queries.
 */
const SCAN_PAGE = 500;

interface ScanResult {
  readonly matched: { sourceId: string; tabName: string; period: string | null; rowData: unknown }[];
  readonly scanned: number;
  /** True when rows matching `where` were left unscanned. */
  readonly incomplete: boolean;
}

/**
 * Scan a tab for rows whose serialized `rowData` contains `needle`.
 *
 * Prisma cannot express a substring match over a Json column, so this reads rows
 * and filters in memory. It stops at the first of: enough matches to fill `limit`
 * and prove truncation, `SCAN_CAP` rows scanned, or the result set exhausted.
 *
 * `incomplete` is the honest part. When it is true the caller has been handed a
 * *lower bound* on the match count, not the count — and the two fields this tool
 * added so a small result set could be trusted (`total_matching`, `truncated`)
 * must say so rather than report the partial number as final.
 */
async function scanForContains(
  where: Prisma.FinanceSnapshotWhereInput,
  needle: string,
  limit: number,
  total: number,
): Promise<ScanResult> {
  const matched: ScanResult['matched'] = [];
  const ceiling = Math.min(total, SCAN_CAP);
  let scanned = 0;

  // `matched.length <= limit` rather than `< limit`: one match past the limit is
  // what proves `truncated`, and stopping there is what keeps a `limit: 1` query
  // from serializing the whole tab.
  while (scanned < ceiling && matched.length <= limit) {
    const page = await prisma.financeSnapshot.findMany({
      where,
      orderBy: [{ period: 'desc' }, { sourceId: 'asc' }],
      skip: scanned,
      take: Math.min(SCAN_PAGE, ceiling - scanned),
    });
    if (page.length === 0) break; // rows disappeared mid-scan; treat as exhausted
    scanned += page.length;
    for (const r of page) {
      if (JSON.stringify(r.rowData).toLowerCase().includes(needle)) {
        matched.push({ sourceId: r.sourceId, tabName: r.tabName, period: r.period, rowData: r.rowData });
      }
    }
  }

  return { matched, scanned, incomplete: scanned < total };
}

/**
 * Escape LIKE metacharacters. Prisma compiles `mode: 'insensitive'` to `ILIKE`
 * and passes the value through verbatim, so an unescaped `%` matches every tab
 * in the table. Postgres uses backslash as the default LIKE escape character.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Resolve a query_type (or a caller's `tab_name` override) to a tab_name filter.
 * Exported so `finance-tab-map.test.ts` can prove the match is exact and not a
 * LIKE pattern that bleeds into neighbouring tabs.
 */
export function buildTabNameWhere(
  queryType: string,
  tabOverride?: string,
): Prisma.FinanceSnapshotWhereInput {
  // The override is caller-supplied, so it stays case-insensitive for
  // convenience but gets escaped first.
  if (tabOverride) return { tabName: { equals: escapeLike(tabOverride), mode: 'insensitive' } };

  const mappedTabs = QUERY_TYPE_TO_TABS[queryType];
  if (mappedTabs) return { tabName: { in: mappedTabs } };

  const mappedPrefix = QUERY_TYPE_TO_TAB_PREFIX[queryType];
  if (mappedPrefix) return { tabName: { startsWith: mappedPrefix } };

  return { tabName: queryType };
}

export function registerQueryFinances(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? '';
      const tabOverride = parseStr(raw, 'tab_name');
      const periodFilter = parseStr(raw, 'period');
      const containsFilter = parseStr(raw, 'contains');
      const limit = Math.min(parseNum(raw, 'limit') ?? 500, 1000);

      const unbacked = UNBACKED_QUERY_TYPES[queryType];
      if (unbacked && !tabOverride) {
        return toolError('no_records', unbacked);
      }

      const where: Prisma.FinanceSnapshotWhereInput = buildTabNameWhere(queryType, tabOverride);
      if (periodFilter) where.period = periodFilter;

      const totalMatching = await prisma.financeSnapshot.count({ where });

      // Which tabs the filter matched, computed over `where` rather than over the
      // rows returned. Derived from the returned rows it lies whenever `limit`
      // bites: `budget_actuals` spans two tabs whose rows sort by different
      // `period` values, so one tab lands entirely ahead of the other and a small
      // limit reported the second as absent — read as "that tab is empty", which is
      // the inference this tool exists to prevent.
      const matchedTabGroups = await prisma.financeSnapshot.groupBy({
        by: ['tabName'],
        where,
      });
      const tabNamesMatched = matchedTabGroups.map((g) => g.tabName).sort();

      const needle = containsFilter?.toLowerCase();
      const scan = needle ? await scanForContains(where, needle, limit, totalMatching) : undefined;
      const rows: ScanResult['matched'] = scan
        ? scan.matched.slice(0, limit)
        : (
            await prisma.financeSnapshot.findMany({
              where,
              orderBy: [{ period: 'desc' }, { sourceId: 'asc' }],
              take: limit,
            })
          ).map((r) => ({ sourceId: r.sourceId, tabName: r.tabName, period: r.period, rowData: r.rowData }));

      const scanIncomplete = scan?.incomplete ?? false;
      // A partial scan yields a lower bound, never a total. Reporting it as
      // `total_matching: 3, truncated: false` — as this did over a 16K-row tab —
      // tells the caller the opposite of the truth about a result set they were
      // given these two fields specifically in order to trust.
      const matchCount = scan ? scan.matched.length : totalMatching;

      return {
        query_type: queryType,
        tab_names_matched: tabNamesMatched,
        tab_names_returned: [...new Set(rows.map((r) => r.tabName))].sort(),
        record_count: rows.length,
        total_matching: matchCount,
        ...(scanIncomplete ? { total_matching_is_lower_bound: true } : {}),
        truncated: scanIncomplete || matchCount > rows.length,
        ...(containsFilter ? { contains_applied: containsFilter } : {}),
        ...(scanIncomplete
          ? {
              scan_incomplete:
                `Searched ${scan?.scanned ?? 0} of ${totalMatching} rows for "${containsFilter}" ` +
                `(page size ${SCAN_PAGE}, cap ${SCAN_CAP}, stopped once ${rows.length} rows could be returned). ` +
                `total_matching is a lower bound; raise limit or narrow the query_type to search further.`,
            }
          : {}),
        records: rows.map((r) => ({
          source_id: r.sourceId,
          tab_name: r.tabName,
          period: r.period,
          row_data: r.rowData,
        })),
        sources: ['google_sheets', 'aplos'],
      };
    }),
  );
}

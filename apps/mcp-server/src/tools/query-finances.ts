import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'query_finances';

const DESCRIPTION =
  'Look up financial data from finance_snapshots. Each query_type maps to a data source tab (Google Sheets or Aplos accounting). Returns the raw rowData JSON so the caller can read whichever columns matter for the question. Every response carries total_matching and truncated, so a small limit is never mistaken for an empty tab.';

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
  // docs/mcp-server-spec.md documents this as "Prior month + YTD combined".
  // Rows carry their own tab_name, so the caller can tell the two apart.
  budget_actuals: ['Prior Month Budget vs Actual', 'YTD Budget vs Actual'],
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

      // `contains` is a substring match over the serialized rowData, which Prisma
      // cannot express on a Json column, so scan the tab and filter in memory.
      // Tabs run to a few hundred rows; SCAN_CAP bounds the pathological case.
      const scanned = await prisma.financeSnapshot.findMany({
        where,
        orderBy: [{ period: 'desc' }, { sourceId: 'asc' }],
        take: containsFilter ? SCAN_CAP : limit,
      });

      const needle = containsFilter?.toLowerCase();
      const matched = needle
        ? scanned.filter((r) => JSON.stringify(r.rowData).toLowerCase().includes(needle))
        : scanned;
      const rows = matched.slice(0, limit);

      const scanIncomplete = Boolean(containsFilter) && totalMatching > SCAN_CAP;

      return {
        query_type: queryType,
        tab_names_matched: [...new Set(rows.map((r) => r.tabName))],
        record_count: rows.length,
        total_matching: needle ? matched.length : totalMatching,
        truncated: needle ? matched.length > rows.length : totalMatching > rows.length,
        ...(containsFilter ? { contains_applied: containsFilter } : {}),
        ...(scanIncomplete
          ? { scan_incomplete: `Only the first ${SCAN_CAP} rows of ${totalMatching} were searched for "${containsFilter}".` }
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

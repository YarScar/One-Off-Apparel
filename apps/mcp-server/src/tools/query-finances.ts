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
 * finance_snapshots. Names are matched case-insensitively, because the sheet
 * syncs and the seed disagree on casing: sync-development-crm writes
 * `development:grants tracker` while the seed and earlier revisions of this map
 * used Title Case. A case-sensitive exact match silently returned zero rows for
 * every development and phase_dashboard tab. Keep the legacy aliases so seeded
 * databases and older snapshots stay reachable.
 */
const QUERY_TYPE_TO_TABS: Record<string, string[]> = {
  prior_month: ['Prior Month Budget vs Actual'],
  ytd: ['YTD Budget vs Actual', 'ytd'],
  forecast: ['Rolling Forecast'],
  monthly: ['Monthly'],
  fund_balances: ['Combined Funds', 'fund_balances'],
  annual: ['Annual'],
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

/** query_types kept in the enum for compatibility that no connector writes a tab for. */
const UNBACKED_QUERY_TYPES: Record<string, string> = {
  budget_actuals: 'No connector writes a "budget_actuals" tab. Use query_type "ytd" for year-to-date budget vs actual, or "prior_month" for the prior month.',
};

/** Exported for the map-consistency test in __tests__. */
export const FINANCE_TAB_MAP = { QUERY_TYPE_TO_TABS, QUERY_TYPE_TO_TAB_PREFIX, UNBACKED_QUERY_TYPES };

/** Hard ceiling on rows pulled before `contains` filtering, to bound memory. */
const SCAN_CAP = 5000;

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

      const where: Prisma.FinanceSnapshotWhereInput = {};
      const mappedTabs = QUERY_TYPE_TO_TABS[queryType];
      const mappedPrefix = QUERY_TYPE_TO_TAB_PREFIX[queryType];
      if (tabOverride) {
        where.tabName = { equals: tabOverride, mode: 'insensitive' };
      } else if (mappedTabs) {
        where.OR = mappedTabs.map((tab) => ({ tabName: { equals: tab, mode: 'insensitive' as const } }));
      } else if (mappedPrefix) {
        where.tabName = { startsWith: mappedPrefix, mode: 'insensitive' };
      } else {
        where.tabName = { equals: queryType, mode: 'insensitive' };
      }
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

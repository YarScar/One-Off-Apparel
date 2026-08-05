import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@lp-ai/lib-db';

import {
  buildTabNameWhere,
  FINANCE_QUERY_TYPES,
  FINANCE_TAB_MAP,
} from '../tools/query-finances.js';

const { QUERY_TYPE_TO_TABS, QUERY_TYPE_TO_TAB_PREFIX, UNBACKED_QUERY_TYPES } = FINANCE_TAB_MAP;

/**
 * These tests exist because query_finances failed silently for eleven of its
 * query types: the tab names in the lookup map were Title Case while the sheet
 * connectors write them lower case, and Postgres string equality is case
 * sensitive. Every affected call returned `record_count: 0` and read as "the
 * organization has no data for this", which is the worst possible failure mode
 * for a tool whose output ends up in grant applications.
 */
describe('query_finances tab map', () => {
  it('resolves every query_type to a tab, a prefix, or an explicit explanation', () => {
    const unresolved = FINANCE_QUERY_TYPES.filter(
      (qt) =>
        !QUERY_TYPE_TO_TABS[qt] && !QUERY_TYPE_TO_TAB_PREFIX[qt] && !UNBACKED_QUERY_TYPES[qt],
    );
    expect(unresolved).toEqual([]);
  });

  it('gives every query_type a tab name that is not just the query_type echoed back', () => {
    // Resolving only to `tabName === queryType` is the shape the budget_actuals bug
    // had: no connector writes such a tab, so the result is always empty. Seed
    // aliases like 'ytd' and 'fund_balances' are allowed alongside a real tab name.
    for (const [queryType, tabs] of Object.entries(QUERY_TYPE_TO_TABS)) {
      expect(
        tabs.some((tab) => tab !== queryType),
        `${queryType} resolves only to its own name`,
      ).toBe(true);
    }
  });

  it('keeps development tab names lower case, matching sync-development-crm', () => {
    // connectors/google-sheets/src/sync-development-crm.ts writes
    // `development:grants tracker`, `development:giving history`, and so on.
    const devTabs = Object.entries(QUERY_TYPE_TO_TABS)
      .filter(([queryType]) => queryType.startsWith('dev_'))
      .flatMap(([, tabs]) => tabs);

    expect(devTabs.length).toBeGreaterThan(0);
    for (const tab of devTabs) {
      expect(tab).toBe(tab.toLowerCase());
      expect(tab.startsWith('development:')).toBe(true);
    }
  });

  it('keeps phase_dashboard tab names lower case, matching sync-phase-budget-dashboard', () => {
    const phaseTabs = Object.entries(QUERY_TYPE_TO_TABS)
      .filter(([queryType]) => queryType.startsWith('phase_budget_'))
      .flatMap(([, tabs]) => tabs);

    expect(phaseTabs.length).toBeGreaterThan(0);
    for (const tab of phaseTabs) {
      expect(tab).toBe(tab.toLowerCase());
    }
  });

  it('maps fund_balances to the dashboard sync tab, not only the seed alias', () => {
    // sync-dashboard.ts writes 'Combined Funds'; 'fund_balances' is what seed.ts uses.
    expect(QUERY_TYPE_TO_TABS['fund_balances']).toContain('Combined Funds');
  });

  it('maps budget_actuals to both budget-vs-actual tabs, as the spec documents', () => {
    // docs/mcp-server-spec.md: "budget_actuals | Prior Month + YTD | Prior month
    // + YTD combined". Sharing those two tabs with prior_month and ytd is the
    // point, so this map deliberately claims a tab more than once.
    expect(QUERY_TYPE_TO_TABS['budget_actuals']).toEqual([
      'Prior Month Budget vs Actual',
      'YTD Budget vs Actual',
    ]);
  });

  it('declares no query_type twice and no tab twice within a query_type', () => {
    const seen = new Map<string, string>();
    for (const [queryType, tabs] of Object.entries(QUERY_TYPE_TO_TABS)) {
      expect(new Set(tabs).size, `${queryType} lists a tab twice`).toBe(tabs.length);
      const key = tabs.map((t) => t.toLowerCase()).sort().join('|');
      const prior = seen.get(key);
      expect(prior, `${queryType} resolves to the same tabs as ${prior}`).toBeUndefined();
      seen.set(key, queryType);
    }
  });
});

/**
 * The tab map is matched exactly, not with `mode: 'insensitive'`: Prisma
 * compiles that to `ILIKE` and passes the value through unescaped, so the `%` in
 * `q3_2026_actuals:global %` becomes a wildcard and the query claims rows from
 * any tab sharing that prefix. These tests plant such a neighbour and prove it
 * stays out of the result set.
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

describeLocal('query_finances tab matching (live DB)', () => {
  const REAL = 'q3_2026_actuals:global %';
  const NEIGHBOUR = 'q3_2026_actuals:global %-other';
  const ids = ['tabmatch-real', 'tabmatch-neighbour'];

  beforeAll(async () => {
    await prisma.financeSnapshot.createMany({
      data: [
        { id: ids[0]!, sourceId: `${ids[0]!}:1`, tabName: REAL, rowData: { pct: '12' } },
        { id: ids[1]!, sourceId: `${ids[1]!}:1`, tabName: NEIGHBOUR, rowData: { pct: '99' } },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.financeSnapshot.deleteMany({ where: { id: { in: ids } } });
  });

  it('does not let a % in a mapped tab name match a neighbouring tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: buildTabNameWhere('q3_2026_actuals_global_pct'),
      select: { tabName: true },
    });
    expect(rows.map((r) => r.tabName)).toEqual([REAL]);
  });

  it('does not let a tab_name override of "%" match every tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: buildTabNameWhere('ytd', '%'),
      select: { tabName: true },
    });
    expect(rows).toEqual([]);
  });

  it('still resolves a tab_name override whose casing differs from the stored tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: buildTabNameWhere('ytd', 'Q3_2026_ACTUALS:GLOBAL %'),
      select: { tabName: true },
    });
    expect(rows.map((r) => r.tabName)).toEqual([REAL]);
  });
});

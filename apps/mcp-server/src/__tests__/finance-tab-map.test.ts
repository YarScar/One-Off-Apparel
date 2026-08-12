import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { McpStdioClient } from './mcp-client.js';

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
      'ytd',
    ]);
  });

  it('carries the seed alias on every query_type whose real tabs are seed-absent', () => {
    // The map's stated rationale is that seeded databases stay reachable, and
    // budget_actuals — which four shipped prompts call — was the one query_type the
    // rationale was not applied to: it returned zero rows on a seeded or CI database.
    expect(QUERY_TYPE_TO_TABS['budget_actuals']).toContain('ytd');
    expect(QUERY_TYPE_TO_TABS['ytd']).toContain('ytd');
    expect(QUERY_TYPE_TO_TABS['fund_balances']).toContain('fund_balances');
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

  /**
   * Every assertion below is scoped to the two planted rows.
   *
   * Unscoped, they assert over the whole table against tab names that real synced
   * data also uses, so they pass only on a database holding seed data alone — any
   * developer who has run `pnpm sync:sheets` locally would see them fail on rows
   * that are not the fixture's and are not a defect.
   */
  const onlyFixtureRows = (
    where: Prisma.FinanceSnapshotWhereInput,
  ): Prisma.FinanceSnapshotWhereInput => ({ AND: [where, { id: { in: ids } }] });

  it('does not let a % in a mapped tab name match a neighbouring tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: onlyFixtureRows(buildTabNameWhere('q3_2026_actuals_global_pct')),
      select: { tabName: true },
    });
    expect(rows.map((r) => r.tabName)).toEqual([REAL]);
  });

  it('does not let a tab_name override of "%" match every tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: onlyFixtureRows(buildTabNameWhere('ytd', '%')),
      select: { tabName: true },
    });
    expect(rows).toEqual([]);
  });

  it('still resolves a tab_name override whose casing differs from the stored tab', async () => {
    const rows = await prisma.financeSnapshot.findMany({
      where: onlyFixtureRows(buildTabNameWhere('ytd', 'Q3_2026_ACTUALS:GLOBAL %')),
      select: { tabName: true },
    });
    expect(rows.map((r) => r.tabName)).toEqual([REAL]);
  });
});

/**
 * The two fields `query_finances` added so a caller could trust a small result set
 * — `total_matching` and `truncated` — plus the tab list. Each of these went
 * through the real MCP server, because the failure mode is what the *envelope*
 * says, not what the SQL matches.
 */
describeLocal('query_finances result envelope (live DB)', () => {
  const PREFIX = 'envelope-';
  const NEEDLE = 'zzqqneedle';
  /**
   * Deliberately past `SCAN_PAGE` (500). The early-stopping scan only becomes
   * partial on a tab bigger than one page, and the whole point of these cases is
   * what the envelope says when the scan *is* partial — a fixture that fits in one
   * page would assert the easy path and call it covered.
   */
  const PM_ROWS = 600;
  const YTD_ROWS = 3;
  let client: McpStdioClient;

  beforeAll(async () => {
    await prisma.financeSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } });
    // Both budget_actuals tabs, with the YTD tab's period sorting below the
    // prior-month tab's, so a small limit cannot reach it.
    await prisma.financeSnapshot.createMany({
      data: [
        ...Array.from({ length: PM_ROWS }, (_, i) => ({
          id: `${PREFIX}pm-${i}`,
          sourceId: `${PREFIX}pm-${i}:1`,
          tabName: 'Prior Month Budget vs Actual',
          period: '2026-07',
          rowData: { account: `PM ${i}`, note: NEEDLE },
        })),
        ...Array.from({ length: YTD_ROWS }, (_, i) => ({
          id: `${PREFIX}ytd-${i}`,
          sourceId: `${PREFIX}ytd-${i}:1`,
          tabName: 'YTD Budget vs Actual',
          period: '2026-01',
          rowData: { account: `YTD ${i}`, note: NEEDLE },
        })),
      ],
      skipDuplicates: true,
    });
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await prisma.financeSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  it('names every tab the filter matched, not only the tabs the page reached', async () => {
    const res = (await client.callTool('query_finances', {
      query_type: 'budget_actuals',
      limit: 1,
    })) as { tab_names_matched: string[]; tab_names_returned: string[]; record_count: number };

    expect(res.record_count).toBe(1);
    // The page cannot contain the YTD tab; the matched list must still name it, or
    // the caller reads a limit as "that tab is empty".
    expect(res.tab_names_returned).toHaveLength(1);
    expect(res.tab_names_matched).toContain('Prior Month Budget vs Actual');
    expect(res.tab_names_matched).toContain('YTD Budget vs Actual');
  });

  it('reports a partial contains scan as a lower bound rather than as a total', async () => {
    const res = (await client.callTool('query_finances', {
      query_type: 'budget_actuals',
      contains: NEEDLE,
      limit: 1,
    })) as {
      record_count: number;
      total_matching: number;
      total_matching_is_lower_bound?: boolean;
      truncated: boolean;
      scan_incomplete?: string;
    };

    expect(res.record_count).toBe(1);
    expect(res.truncated).toBe(true);
    // The scan stops as soon as it can answer, so the number it reports is a floor
    // and must be labelled as one. Reporting `truncated: false` with a partial count
    // was the defect: it told the caller a partial count was the whole answer.
    expect(res.total_matching_is_lower_bound).toBe(true);
    expect(res.total_matching).toBeLessThan(PM_ROWS + YTD_ROWS);
    expect(res.scan_incomplete).toContain('lower bound');
  });

  it('reports an exhausted contains scan as a total, with no lower-bound flag', async () => {
    const res = (await client.callTool('query_finances', {
      query_type: 'budget_actuals',
      contains: NEEDLE,
      limit: 1000,
    })) as {
      total_matching: number;
      total_matching_is_lower_bound?: boolean;
      truncated: boolean;
      scan_incomplete?: string;
    };

    expect(res.total_matching).toBe(PM_ROWS + YTD_ROWS);
    expect(res.total_matching_is_lower_bound).toBeUndefined();
    expect(res.truncated).toBe(false);
    expect(res.scan_incomplete).toBeUndefined();
  });
});

/**
 * `get_finance_brief` pins `aplos:funds` to its newest snapshot. `period` is
 * nullable and Postgres sorts DESC as NULLS FIRST, so one null-period row used to
 * win the pin query and silently disable the pin.
 */
describeLocal('get_finance_brief fund snapshot pinning (live DB)', () => {
  const PREFIX = 'fundpin-';
  let client: McpStdioClient;

  beforeAll(async () => {
    await prisma.financeSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.financeSnapshot.createMany({
      data: [
        { id: `${PREFIX}null`, sourceId: `${PREFIX}null:1`, tabName: 'aplos:funds', period: null, rowData: { fund: 'nulled' } },
        { id: `${PREFIX}old`, sourceId: `${PREFIX}old:1`, tabName: 'aplos:funds', period: '2026-07-01', rowData: { fund: 'stale' } },
        { id: `${PREFIX}new`, sourceId: `${PREFIX}new:1`, tabName: 'aplos:funds', period: '2026-08-01', rowData: { fund: 'current' } },
      ],
      skipDuplicates: true,
    });
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await prisma.financeSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  it('pins to the newest dated snapshot even when a null-period row exists', async () => {
    const res = (await client.callTool('get_finance_brief', {})) as {
      aplos_funds: Array<{ period: string | null }>;
    };

    expect(res.aplos_funds.length).toBeGreaterThan(0);
    const periods = [...new Set(res.aplos_funds.map((f) => f.period))];
    expect(periods).toEqual(['2026-08-01']);
  });
});

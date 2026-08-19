import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';
import { DEV_TABS, cell, donorNameOf, parseMoney, readDevTab } from '../dev-crm.js';

const NAME = 'get_finance_brief';

const DESCRIPTION =
  'Get a high-level financial overview of the organization: Aplos fund balances, chart-of-accounts summary, recent Aplos transactions, and recent donor gifts. Use this as a starting point for any general finance question.';

const inputSchema = {
  period: z
    .enum(['ytd', 'last_30_days', 'last_quarter'])
    .optional()
    .describe('Time period for income/expense summary. Defaults to ytd.'),
};

export function registerGetFinanceBrief(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const period = parseStr(raw, 'period') ?? 'ytd';

      // aplos:funds is snapshotted daily, so an unbounded "latest 50" mixes two
      // snapshot dates and truncates the newest one. Pin to the newest period.
      //
      // `period` is nullable and Postgres sorts DESC as NULLS FIRST, so without the
      // `not: null` a single null-period row wins this query, the pin below spreads
      // to nothing, and the tool silently reverts to the multi-date behaviour this
      // is here to fix.
      const latestFundPeriod = await prisma.financeSnapshot.findFirst({
        where: { tabName: 'aplos:funds', period: { not: null } },
        orderBy: { period: 'desc' },
        select: { period: true },
      });

      const SHEET_FUND_TABS = ['Combined Funds', 'fund_balances'];
      /** Rows in those tabs, whether or not the page below reaches them. */
      const sheetFundTotal = await prisma.financeSnapshot.count({
        where: { tabName: { in: SHEET_FUND_TABS } },
      });

      const [aplosFunds, aplosAccounts, recentTransactions, sheetFundBalances, recentGifts] = await Promise.all([
        prisma.financeSnapshot.findMany({
          where: {
            tabName: 'aplos:funds',
            ...(latestFundPeriod?.period ? { period: latestFundPeriod.period } : {}),
          },
          orderBy: { sourceId: 'asc' },
          take: 200,
        }),
        prisma.financeSnapshot.findMany({
          where: { tabName: 'aplos:accounts' },
          take: 300,
        }),
        prisma.financeSnapshot.findMany({
          where: { tabName: 'aplos:transactions' },
          orderBy: { period: 'desc' },
          take: 20,
        }),
        // The dashboard sync writes this tab as 'Combined Funds'; 'fund_balances'
        // is the seed's name. Match either, exactly — `mode: 'insensitive'`
        // compiles to an unescaped ILIKE, which would make the `_` a wildcard.
        //
        // Ordered by `sourceId`, not `period`: for dashboard tabs `period` is a
        // selector-cell string shared by every row in the tab
        // (`sync-dashboard.ts:235`), so ordering by it is arbitrary. It used to be
        // an arbitrary 50 rows with nothing saying so, while the spec points
        // callers at `Combined Funds` for an annual budget total — a silently
        // partial sum. The cap is now well past the real tab size, and
        // `sheet_fund_balances_truncated` reports the case where it still bites.
        prisma.financeSnapshot.findMany({
          where: { tabName: { in: SHEET_FUND_TABS } },
          orderBy: [{ tabName: 'asc' }, { sourceId: 'asc' }],
          take: 500,
        }),
        // Repointed at development:giving history, #306. This read `donor_gifts`, a table no
        // connector writes, so `recent_gifts` was always an empty array while the tool's
        // description promised recent gifts — and figures.ts named this field as the fallback for
        // funder history, which made the fallback as dead as the tool it backed up.
        readDevTab(DEV_TABS.givingHistory),
      ]);

      const mapSnapshot = (f: typeof aplosFunds[number]): { source_id: string; period: string | null; row_data: unknown } => ({
        source_id: f.sourceId,
        period: f.period,
        row_data: f.rowData,
      });

      return {
        period,
        aplos_funds: aplosFunds.map(mapSnapshot),
        aplos_accounts_summary: {
          total: aplosAccounts.length,
          by_category: aplosAccounts.reduce<Record<string, number>>((acc, a) => {
            const data = a.rowData as Record<string, unknown> | null;
            const cat = (typeof data?.category === 'string' ? data.category : 'unknown');
            acc[cat] = (acc[cat] ?? 0) + 1;
            return acc;
          }, {}),
        },
        recent_transactions: recentTransactions.map(mapSnapshot),
        sheet_fund_balances: sheetFundBalances.map(mapSnapshot),
        sheet_fund_balances_total: sheetFundTotal,
        ...(sheetFundBalances.length < sheetFundTotal
          ? {
              sheet_fund_balances_truncated:
                `Returned ${sheetFundBalances.length} of ${sheetFundTotal} rows. Do not sum this ` +
                `field; use query_finances(fund_balances) with a limit for the full tab.`,
            }
          : {}),
        // The sheet's `date` is a display string ("Aug 2025"), not a sortable date, so these are the
        // LAST ten rows in sheet order rather than a computed top-ten-by-date. Sheet order is
        // append-chronological in the observed data, which makes them the most recent in practice —
        // but that is a property of how the tab is maintained, not a guarantee, so the note says so.
        recent_gifts: recentGifts
          .slice(-10)
          .reverse()
          .map((g) => ({
            amount: parseMoney(g.data['gross_amount']),
            gift_date: cell(g, 'date'),
            fiscal_year: cell(g, 'fiscal_year'),
            fund: cell(g, 'fund_name'),
            project: cell(g, 'project'),
            donor: donorNameOf(g),
          })),
        recent_gifts_note:
          'Repointed to development:giving history (#306); previously read the unpopulated donor_gifts ' +
          'table and was always empty. These are the last ten rows in SHEET ORDER, not a computed ' +
          'top-ten-by-date — the tab’s date cell is a display string ("Aug 2025") and is not sortable. ' +
          'All-Building-21 scope; use query_donors for a Launchpad-scoped view.',
        sources_active: ['aplos', 'google_sheets'],
      };
    }),
  );
}

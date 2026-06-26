import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';

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

      const [aplosFunds, aplosAccounts, recentTransactions, sheetFundBalances, recentGifts] = await Promise.all([
        prisma.financeSnapshot.findMany({
          where: { tabName: 'aplos:funds' },
          orderBy: { period: 'desc' },
          take: 50,
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
        prisma.financeSnapshot.findMany({
          where: { tabName: 'fund_balances' },
          orderBy: { period: 'desc' },
          take: 50,
        }),
        prisma.donorGift.findMany({
          orderBy: { giftDate: 'desc' },
          take: 10,
          include: { donorContact: true },
        }),
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
        recent_gifts: recentGifts.map((g) => ({
          amount: g.amount,
          gift_date: g.giftDate,
          campaign_name: g.campaignName,
          fund: g.fund,
          donor:
            g.donorContact?.organizationName ??
            ([g.donorContact?.firstName, g.donorContact?.lastName]
              .filter(Boolean)
              .join(' ') ||
              null),
        })),
        sources_active: ['aplos', 'google_sheets'],
      };
    }),
  );
}

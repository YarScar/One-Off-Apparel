import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';

const NAME = 'query_hours';

const DESCRIPTION =
  "Query the team's hour logs from the shared Hours spreadsheet (North10AI and LP Internal AI tabs, synced into hour_logs). Use for totals, per-person / per-project / per-day breakdowns, or raw entry drill-downs over a date range. hours are stored as decimals; task is the free-text description from the sheet.";

const inputSchema = {
  person: z.string().optional().describe('Partial name match (case-insensitive), e.g. "mili".'),
  project: z
    .enum(['North10AI', 'LP Internal AI'])
    .optional()
    .describe('Engagement tab to filter to.'),
  start_date: z.string().optional().describe('Inclusive start (YYYY-MM-DD).'),
  end_date: z.string().optional().describe('Inclusive end (YYYY-MM-DD).'),
  group_by: z
    .enum(['project', 'person', 'day'])
    .optional()
    .describe('Group entries and sum hours per value. Omit to return raw entries.'),
  limit: z.number().optional().describe('Max raw entries returned (default 200, capped at 500).'),
};

function buildWhere(raw: Record<string, unknown>): Prisma.HourLogWhereInput {
  const where: Prisma.HourLogWhereInput = {};
  const person = parseStr(raw, 'person');
  const project = parseStr(raw, 'project');
  const startDate = parseStr(raw, 'start_date');
  const endDate = parseStr(raw, 'end_date');

  if (person) where.personName = { contains: person, mode: 'insensitive' };
  if (project) where.project = project;
  if (startDate || endDate) {
    where.logDate = {};
    if (startDate) where.logDate.gte = new Date(startDate);
    if (endDate) where.logDate.lte = new Date(endDate);
  }
  return where;
}

function toHours(v: Prisma.Decimal | null): number | null {
  return v === null ? null : Number(v);
}

export function registerQueryHours(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const where = buildWhere(raw);

      const [totalMatched, agg] = await Promise.all([
        prisma.hourLog.count({ where }),
        prisma.hourLog.aggregate({ where, _sum: { hours: true } }),
      ]);
      const totalHours = agg._sum.hours === null ? 0 : Number(agg._sum.hours);

      const groupBy = parseStr(raw, 'group_by');

      if (!groupBy) {
        const limit = Math.min(parseNum(raw, 'limit') ?? 200, 500);
        const rows = await prisma.hourLog.findMany({
          where,
          orderBy: [{ logDate: 'desc' }, { project: 'asc' }],
          take: limit,
        });
        return {
          total_records_matched: totalMatched,
          total_hours: totalHours,
          records_returned: rows.length,
          truncated: rows.length < totalMatched,
          records: rows.map((r) => ({
            id: r.id,
            project: r.project,
            source_tab: r.sourceTab,
            log_date: r.logDate,
            person_name: r.personName,
            hours: toHours(r.hours),
            task: r.task,
            row_data: r.rowData,
          })),
        };
      }

      const rows = await prisma.hourLog.findMany({
        where,
        select: { project: true, personName: true, logDate: true, hours: true },
      });
      const groups = new Map<string, { count: number; hours: number }>();
      for (const r of rows) {
        const key =
          groupBy === 'person'
            ? (r.personName ?? 'unknown')
            : groupBy === 'day'
              ? (r.logDate?.toISOString().slice(0, 10) ?? 'unknown')
              : r.project;
        let entry = groups.get(key);
        if (!entry) {
          entry = { count: 0, hours: 0 };
          groups.set(key, entry);
        }
        entry.count += 1;
        entry.hours += r.hours === null ? 0 : Number(r.hours);
      }

      const breakdown = Array.from(groups.entries())
        .map(([group, e]) => ({
          group,
          records: e.count,
          hours: Math.round(e.hours * 100) / 100,
        }))
        .sort((a, b) => b.hours - a.hours);

      return {
        total_records_matched: totalMatched,
        total_hours: Math.round(totalHours * 100) / 100,
        group_by: groupBy,
        groups: breakdown,
      };
    }),
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { resultEnvelope, clampLimit, MAX_LIMIT } from '../result-envelope.js';

const NAME = 'query_competency';

const DESCRIPTION =
  'Per-student competency analytics (baseline, performance level, growth, progress, ER counts), the rubric structure stored as finance_snapshots row data, or an org-wide growth aggregate. Row-returning query_types are paged: every response carries total_matching (a real count over the whole filter, independent of limit) and truncated, so a page is never mistaken for the population. Do not average growth from the rows of a truncated response — use query_type "growth_aggregate", which computes the figure in the database over every matching row and is the only growth number safe to quote.';

const inputSchema = {
  query_type: z.enum(['scores', 'rubric', 'growth_aggregate']),
  student_number: z.string().optional(),
  competency: z.string().optional().describe('Partial match.'),
  limit: z
    .number()
    .optional()
    .describe(`Max rows returned by 'scores' and 'rubric'; default 500, capped at ${MAX_LIMIT}. Ignored by 'growth_aggregate', which reads every matching row.`),
};

/**
 * Prisma returns `Decimal` for the five `@db.Decimal(5,2)` columns, and
 * `JSON.stringify` renders a Decimal as an object rather than a number. Every
 * numeric field leaving this tool goes through here so the response carries JSON
 * numbers a caller can arithmetic on.
 */
function num(value: Prisma.Decimal | number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deterministic, unique row order.
 *
 * `findMany({ take })` with no `orderBy` returns whatever Postgres hands back, so a
 * truncated page is an arbitrary subset that can differ between two identical calls —
 * which makes a partial answer not merely incomplete but irreproducible. `sourceId` is
 * `@unique`, so it is the tie-break that guarantees a total order.
 */
const SCORES_ORDER: Prisma.StudentCompetencyOrderByWithRelationInput[] = [
  { studentNumber: 'asc' },
  { competency: 'asc' },
  { sourceId: 'asc' },
];

export function registerQueryCompetency(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? 'scores';
      const studentNumber = parseStr(raw, 'student_number');
      const competency = parseStr(raw, 'competency');
      const limit = clampLimit(parseNum(raw, 'limit'));

      if (queryType === 'rubric') {
        const rubricWhere: Prisma.FinanceSnapshotWhereInput = { tabName: 'student_competency:rubric' };
        const [total, rubric] = await Promise.all([
          prisma.financeSnapshot.count({ where: rubricWhere }),
          prisma.financeSnapshot.findMany({
            where: rubricWhere,
            orderBy: [{ sourceId: 'asc' }],
            take: limit,
          }),
        ]);
        return {
          query_type: 'rubric',
          ...resultEnvelope(rubric.length, total, limit),
          records: rubric.map((r) => ({ source_id: r.sourceId, row_data: r.rowData })),
        };
      }

      const where: Prisma.StudentCompetencyWhereInput = {};
      if (studentNumber) where.studentNumber = studentNumber;
      if (competency) where.competency = { contains: competency, mode: 'insensitive' };

      const filtersApplied = {
        ...(studentNumber ? { student_number: studentNumber } : {}),
        ...(competency ? { competency } : {}),
      };

      if (queryType === 'growth_aggregate') {
        // The point of this branch (#276): growth over the whole matching population,
        // computed in the database. Assembling it from `scores` pages gave a figure
        // describing an arbitrary 1000 of ~2346 rows, so no org-wide competency growth
        // number could be quoted in a grant at all.
        //
        // `_count` is per-field on the Decimal columns deliberately: Postgres `AVG`
        // skips NULLs, so the denominator behind `avg_growth` is the number of rows
        // that *have* a growth value, not the number of rows matched. Reporting only
        // the latter would overstate coverage. Both are returned.
        const [agg, students, byCompetency] = await Promise.all([
          prisma.studentCompetency.aggregate({
            where,
            _count: { _all: true, growth: true, baseline: true, performanceLevel: true, progress: true },
            _avg: { growth: true, baseline: true, performanceLevel: true, progress: true },
            _min: { growth: true },
            _max: { growth: true },
            _sum: { totalEr: true, completedEr: true, missedEr: true, totalOpportunities: true },
          }),
          prisma.studentCompetency.groupBy({ by: ['studentNumber'], where }),
          prisma.studentCompetency.groupBy({
            by: ['competency'],
            where,
            _count: { _all: true, growth: true },
            _avg: { growth: true, baseline: true, performanceLevel: true },
            orderBy: { competency: 'asc' },
          }),
        ]);

        return {
          query_type: 'growth_aggregate',
          // No `truncated` key here on purpose: this branch reads every matching row,
          // so there is no page to distinguish from a population and nothing to flag.
          computed_over: 'all matching rows (no limit applied)',
          row_count: agg._count._all,
          student_count: students.length,
          growth_row_count: agg._count.growth,
          avg_growth: num(agg._avg.growth),
          min_growth: num(agg._min.growth),
          max_growth: num(agg._max.growth),
          avg_baseline: num(agg._avg.baseline),
          avg_performance_level: num(agg._avg.performanceLevel),
          avg_progress: num(agg._avg.progress),
          baseline_row_count: agg._count.baseline,
          performance_level_row_count: agg._count.performanceLevel,
          progress_row_count: agg._count.progress,
          total_er: agg._sum.totalEr,
          completed_er: agg._sum.completedEr,
          missed_er: agg._sum.missedEr,
          total_opportunities: agg._sum.totalOpportunities,
          by_competency: byCompetency.map((c) => ({
            competency: c.competency,
            row_count: c._count._all,
            growth_row_count: c._count.growth,
            avg_growth: num(c._avg.growth),
            avg_baseline: num(c._avg.baseline),
            avg_performance_level: num(c._avg.performanceLevel),
          })),
          filters_applied: filtersApplied,
        };
      }

      // Counted over `where`, not inferred from the page. This is the #276 defect
      // itself: 1000 rows came back out of ~2346 and `record_count` was the only
      // number in the envelope, so the slice read as the population.
      const [total, rows] = await Promise.all([
        prisma.studentCompetency.count({ where }),
        prisma.studentCompetency.findMany({ where, orderBy: SCORES_ORDER, take: limit }),
      ]);

      const studentMap = await loadStudentNames(rows.map((r) => r.studentNumber));
      const envelope = resultEnvelope(rows.length, total, limit);

      return {
        query_type: 'scores',
        ...envelope,
        ...(envelope.truncated
          ? {
              truncation_note:
                `Returned ${envelope.record_count} of ${envelope.total_matching} matching rows (limit ${limit}, max ${MAX_LIMIT}). ` +
                `These rows are a sample: do not average growth or any other column from them. ` +
                `Call query_type "growth_aggregate" with the same filters for a figure computed over all ${envelope.total_matching} rows.`,
            }
          : {}),
        ...(Object.keys(filtersApplied).length > 0 ? { filters_applied: filtersApplied } : {}),
        records: rows.map((r) => ({
          student_number: r.studentNumber,
          student_name: studentMap.get(r.studentNumber) ?? null,
          competency: r.competency,
          portfolio: r.portfolio,
          baseline: num(r.baseline),
          performance_level: num(r.performanceLevel),
          growth: num(r.growth),
          progress: num(r.progress),
          total_er: r.totalEr,
          completed_er: r.completedEr,
          missed_er: r.missedEr,
          total_opportunities: r.totalOpportunities,
        })),
      };
    }),
  );
}

async function loadStudentNames(numbers: string[]): Promise<Map<string, string>> {
  if (numbers.length === 0) return new Map();
  const uniq = [...new Set(numbers)];
  const students = await prisma.student.findMany({
    where: { studentNumber: { in: uniq } },
    select: { studentNumber: true, canonicalName: true },
  });
  const map = new Map<string, string>();
  for (const s of students) {
    if (s.studentNumber) map.set(s.studentNumber, s.canonicalName);
  }
  return map;
}

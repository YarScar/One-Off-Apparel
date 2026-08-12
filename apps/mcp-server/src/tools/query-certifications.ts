import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma, Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';

const NAME = 'query_certifications';

const DESCRIPTION =
  'Certification data (PCEP, future certs) — pass/fail rates, scores, and breakdowns by cert type, LP phase, date range, or student zip code.';

const inputSchema = {
  query_type: z.enum(['summary', 'by_type', 'by_phase', 'by_result', 'by_zip', 'scores']),
  type: z.string().optional(),
  phase: z.string().optional(),
  result: z.enum(['Pass', 'Fail']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
};

export function registerQueryCertifications(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? '';
      const typeFilter = parseStr(raw, 'type');
      const phaseFilter = parseStr(raw, 'phase');
      const resultFilter = parseStr(raw, 'result');
      const startDate = parseStr(raw, 'start_date');
      const endDate = parseStr(raw, 'end_date');

      const where: Prisma.StudentCertificationWhereInput = {};
      if (typeFilter) where.type = { contains: typeFilter, mode: 'insensitive' };
      if (phaseFilter) where.phase = phaseFilter;
      if (resultFilter) where.result = resultFilter;
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = startDate;
        if (endDate) where.date.lte = endDate;
      }

      switch (queryType) {
        case 'scores': {
          const rows = await prisma.studentCertification.findMany({
            where,
            include: {
              student: { select: { canonicalName: true, studentNumber: true } },
            },
            orderBy: [{ date: 'desc' }],
            take: 500,
          });
          return {
            query_type: 'scores',
            record_count: rows.length,
            records: rows.map((r) => ({
              type: r.type,
              phase: r.phase,
              result: r.result,
              score: r.score,
              date: r.date,
              student_name: r.student.canonicalName,
              student_number: r.student.studentNumber,
            })),
          };
        }
        case 'by_type': {
          const grouped = await prisma.studentCertification.groupBy({
            by: ['type'],
            where,
            _count: { _all: true },
            _avg: { score: true },
          });
          return {
            query_type: 'by_type',
            breakdown: grouped.map((g) => ({
              type: g.type,
              count: g._count?._all ?? 0,
              avg_score: g._avg?.score ?? null,
            })),
          };
        }
        case 'by_phase': {
          const grouped = await prisma.studentCertification.groupBy({
            by: ['phase'],
            where,
            _count: { _all: true },
          });
          return {
            query_type: 'by_phase',
            breakdown: grouped.map((g) => ({
              phase: g.phase,
              count: g._count?._all ?? 0,
            })),
          };
        }
        case 'by_result': {
          const grouped = await prisma.studentCertification.groupBy({
            by: ['result'],
            where,
            _count: { _all: true },
          });
          return {
            query_type: 'by_result',
            breakdown: grouped.map((g) => ({
              result: g.result,
              count: g._count?._all ?? 0,
            })),
          };
        }
        case 'by_zip': {
          // Zip lives on Student, not StudentCertification, so this needs a join —
          // Prisma.groupBy can't aggregate across a relation.
          const conditions: Prisma.Sql[] = [Prisma.sql`s.zip IS NOT NULL`];
          if (typeFilter) conditions.push(Prisma.sql`sc.type ILIKE ${'%' + typeFilter + '%'}`);
          if (phaseFilter) conditions.push(Prisma.sql`sc.phase = ${phaseFilter}`);
          if (resultFilter) conditions.push(Prisma.sql`sc.result = ${resultFilter}`);
          if (startDate) conditions.push(Prisma.sql`sc.date >= ${startDate}`);
          if (endDate) conditions.push(Prisma.sql`sc.date <= ${endDate}`);

          const rows = await prisma.$queryRaw<
            Array<{ zip: string; n: bigint; avg_score: number | null }>
          >(Prisma.sql`
            SELECT s.zip AS zip, COUNT(*) AS n, AVG(sc.score)::float8 AS avg_score
            FROM student_certifications sc
            JOIN students s ON s.id = sc.student_id
            WHERE ${Prisma.join(conditions, ' AND ')}
            GROUP BY s.zip
            ORDER BY s.zip
          `);
          return {
            query_type: 'by_zip',
            breakdown: rows.map((r) => ({
              zip: r.zip,
              count: Number(r.n),
              avg_score: r.avg_score,
            })),
          };
        }
        case 'summary':
        default: {
          const total = await prisma.studentCertification.count({ where });
          const passed = await prisma.studentCertification.count({
            where: { ...where, result: 'Pass' },
          });
          return {
            query_type: 'summary',
            total,
            passed,
            failed: total - passed,
            pass_rate_pct:
              total === 0 ? null : Math.round((passed / total) * 1000) / 10,
          };
        }
      }
    }),
  );
}

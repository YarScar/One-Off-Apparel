import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { cohortNotSupported } from '../errors.js';

const NAME = 'query_students';

const DESCRIPTION =
  'Population-level analytics on the students table. Supports numeric stats (avg/min/max/quartiles), categorical breakdowns, and filtered list pulls. Filters cover every queryable column on the students table. Cohort is not tracked — filter by current_phase and a date range instead.';

const inputSchema = {
  query_type: z.enum(['numeric_stats', 'breakdown', 'list']),
  field: z.string().optional(),
  enrollment_status: z.string().optional(),
  current_phase: z.string().optional(),
  cohort: z
    .number()
    .optional()
    .describe('Deprecated — cohort is no longer tracked. Use current_phase instead.'),
  filter_field: z.string().optional(),
  filter_min: z.number().optional(),
  filter_max: z.number().optional(),
  limit: z.number().optional(),
};

const BREAKDOWN_FIELDS = new Set([
  'current_phase',
  'enrollment_status',
  'neighborhood',
]);

const NUMERIC_FIELDS = new Set(['distance_to_office']);

const FIELD_TO_COLUMN: Record<string, string> = {
  distance_to_office: 'distance_to_office',
};

export function registerQueryStudents(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? 'list';
      const field = parseStr(raw, 'field');
      const enrollmentStatus = parseStr(raw, 'enrollment_status');
      const currentPhase = parseStr(raw, 'current_phase');
      const cohort = parseNum(raw, 'cohort');
      if (cohort !== undefined) return cohortNotSupported();
      const filterField = parseStr(raw, 'filter_field');
      const filterMin = parseNum(raw, 'filter_min');
      const filterMax = parseNum(raw, 'filter_max');
      const limit = Math.min(parseNum(raw, 'limit') ?? 500, 1000);

      const where: Prisma.StudentWhereInput = {
        ...(enrollmentStatus ? { enrollmentStatus } : {}),
        ...(currentPhase ? { currentPhase } : {}),
      };
      if (filterField === 'distance_to_office' && (filterMin !== undefined || filterMax !== undefined)) {
        where.distanceToOffice = {};
        if (filterMin !== undefined) where.distanceToOffice.gte = filterMin;
        if (filterMax !== undefined) where.distanceToOffice.lte = filterMax;
      }

      if (queryType === 'numeric_stats') {
        if (!field || !NUMERIC_FIELDS.has(field)) {
          return {
            query_type: 'numeric_stats',
            error: `field must be one of ${Array.from(NUMERIC_FIELDS).join(', ')}`,
          };
        }
        const column = FIELD_TO_COLUMN[field];
        if (!column) {
          return {
            query_type: 'numeric_stats',
            error: `No column mapping for field '${field}'.`,
          };
        }
        const rows = await prisma.$queryRawUnsafe<
          Array<{
            n: number | bigint;
            avg: number | null;
            min: number | null;
            max: number | null;
            p25: number | null;
            p50: number | null;
            p75: number | null;
          }>
        >(
          `SELECT COUNT(*) AS n, AVG(${column}) AS avg, MIN(${column}) AS min, MAX(${column}) AS max,
                  percentile_cont(0.25) WITHIN GROUP (ORDER BY ${column}) AS p25,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY ${column}) AS p50,
                  percentile_cont(0.75) WITHIN GROUP (ORDER BY ${column}) AS p75
           FROM students
           WHERE ${column} IS NOT NULL`,
        );
        const r = rows[0];
        return {
          query_type: 'numeric_stats',
          field,
          n: r ? Number(r.n) : 0,
          avg: r?.avg ?? null,
          min: r?.min ?? null,
          max: r?.max ?? null,
          p25: r?.p25 ?? null,
          p50: r?.p50 ?? null,
          p75: r?.p75 ?? null,
        };
      }

      if (queryType === 'breakdown') {
        if (!field || !BREAKDOWN_FIELDS.has(field)) {
          return {
            query_type: 'breakdown',
            error: `field must be one of ${Array.from(BREAKDOWN_FIELDS).join(', ')}`,
          };
        }
        const camel = field
          .split('_')
          .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
          .join('') as 'currentPhase' | 'enrollmentStatus' | 'neighborhood';
        const grouped = await prisma.student.groupBy({
          by: [camel],
          where,
          _count: { _all: true },
        });
        return {
          query_type: 'breakdown',
          field,
          breakdown: grouped.map((g) => ({
            value: (g as Record<string, unknown>)[camel] ?? null,
            count: g._count._all,
          })),
        };
      }

      const rows = await prisma.student.findMany({
        where,
        orderBy: [{ canonicalName: 'asc' }],
        take: limit,
      });
      return {
        query_type: 'list',
        student_count: rows.length,
        students: rows.map((s) => ({
          id: s.id,
          student_number: s.studentNumber,
          canonical_name: s.canonicalName,
          email: s.email,
          launchpad_email: s.launchpadEmail,
          alt_school_email: s.altSchoolEmail,
          current_phase: s.currentPhase,
          enrollment_status: s.enrollmentStatus,
          neighborhood: s.neighborhood,
          distance_to_office: s.distanceToOffice,
          graduation_date: s.graduationDate,
        })),
      };
    }),
  );
}

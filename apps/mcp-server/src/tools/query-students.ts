import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum, filterStr } from '../tool-helpers.js';
import { resultEnvelope, clampLimit } from '../result-envelope.js';
import { unmatchableFilterError, type FilterDomainCheck } from '../filter-domain.js';
import {
  studentCurrentPhaseDomain,
  studentEnrollmentStatusDomain,
  studentCohortDomain,
  studentWithdrawalCodeDomain,
  studentHsGraduationYearDomain,
} from '../filter-domain-loaders.js';

const NAME = 'query_students';

const DESCRIPTION =
  'Population-level analytics on the students table. Supports numeric stats (avg/min/max/quartiles), categorical breakdowns, and filtered list pulls. Filters cover every queryable column on the students table. enrollment_status, current_phase, cohort, hs_graduation_year and withdrawal_code are matched literally against the source values, which are short codes rather than words — enrollment_status held only E and N in production, so enrollment_status:"Active" is not a small result but a value that cannot match. A value absent from its column returns a no_records error listing the values that column does hold, instead of an empty answer; a combination of real values that no student happens to have still returns an honest empty result. school is a substring match and is not checked this way. Row-returning query_types are paged: every response carries record_count (rows returned), total_matching (a real count over the whole filter, independent of limit), truncated and limit. Quote total_matching, never record_count, and treat truncated:true as "these rows are a sample".';

const inputSchema = {
  query_type: z.enum(['numeric_stats', 'breakdown', 'list']),
  field: z.string().optional(),
  enrollment_status: z.string().optional(),
  current_phase: z.string().optional(),
  cohort: z.number().optional(),
  school: z.string().optional().describe('High school name, partial match.'),
  hs_graduation_year: z.number().optional(),
  dob_start: z.string().optional().describe('ISO date; students born on or after this date.'),
  dob_end: z.string().optional().describe('ISO date; students born on or before this date.'),
  withdrawal_code: z.string().optional().describe('Exact match.'),
  withdrawal_date_start: z.string().optional().describe('ISO date; withdrew on or after this date.'),
  withdrawal_date_end: z.string().optional().describe('ISO date; withdrew on or before this date.'),
  filter_field: z.string().optional(),
  filter_min: z.number().optional(),
  filter_max: z.number().optional(),
  limit: z.number().optional(),
};

const BREAKDOWN_FIELDS = new Set([
  'current_phase',
  'enrollment_status',
  'cohort',
  'neighborhood',
  'zip',
  'school_name',
  'hs_graduation_year',
  'withdrawal_code',
]);

type BreakdownColumn =
  | 'currentPhase'
  | 'enrollmentStatus'
  | 'cohort'
  | 'neighborhood'
  | 'zip'
  | 'schoolName'
  | 'hsGraduationYear'
  | 'withdrawalCode';

const NUMERIC_FIELDS = new Set(['distance_to_office']);

const FIELD_TO_COLUMN: Record<string, string> = {
  distance_to_office: 'distance_to_office',
};

// Fields filterable by range via filter_field + filter_min/filter_max.
const NUMERIC_RANGE_FIELDS: Record<string, 'distanceToOffice' | 'hsGraduationYear'> = {
  distance_to_office: 'distanceToOffice',
  hs_graduation_year: 'hsGraduationYear',
};

/**
 * The exact-match filters, checked against the distinct values their own column holds
 * before any counting (#210, extending #207 from `query_enrollment` to here).
 *
 * This tool is the sharp one: it filters the *same* `students.enrollment_status` and
 * `students.current_phase` columns as `query_enrollment`, with the same short source
 * codes, so the identical `enrollment_status: 'Active'` → confident zero was reachable
 * through it after #207 closed the other door into those columns.
 *
 * Built in a fixed order so which failure is reported first is deterministic rather than
 * payload-order dependent, and only for the filters a caller actually supplied — an
 * unfiltered call loads no domains at all.
 *
 * **What is deliberately absent.** `school` is a `contains` match: a substring matching
 * no value is not the same fact as a value absent from a column, and enumerating a
 * free-text school column's distinct values is not a usable error message. The date
 * bounds (`dob_*`, `withdrawal_date_*`) and the `filter_min`/`filter_max` range are
 * windows rather than values drawn from a column, so a window outside the data is a real
 * zero. `field` and `filter_field` are validated against their own allow-lists.
 */
async function buildDomainChecks(f: {
  enrollmentStatus: string | undefined;
  currentPhase: string | undefined;
  cohort: number | undefined;
  hsGraduationYear: number | undefined;
  withdrawalCode: string | undefined;
}): Promise<FilterDomainCheck[]> {
  const checks: FilterDomainCheck[] = [];
  if (f.enrollmentStatus !== undefined) {
    checks.push({
      field: 'enrollment_status',
      column: 'students.enrollment_status',
      value: f.enrollmentStatus,
      domain: await studentEnrollmentStatusDomain(),
    });
  }
  if (f.currentPhase !== undefined) {
    checks.push({
      field: 'current_phase',
      column: 'students.current_phase',
      value: f.currentPhase,
      domain: await studentCurrentPhaseDomain(),
    });
  }
  if (f.cohort !== undefined) {
    checks.push({
      field: 'cohort',
      column: 'students.cohort',
      value: f.cohort,
      domain: await studentCohortDomain(),
    });
  }
  if (f.hsGraduationYear !== undefined) {
    checks.push({
      field: 'hs_graduation_year',
      column: 'students.hs_graduation_year',
      value: f.hsGraduationYear,
      domain: await studentHsGraduationYearDomain(),
    });
  }
  if (f.withdrawalCode !== undefined) {
    checks.push({
      field: 'withdrawal_code',
      column: 'students.withdrawal_code',
      value: f.withdrawalCode,
      domain: await studentWithdrawalCodeDomain(),
    });
  }
  return checks;
}

export function registerQueryStudents(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? 'list';
      const field = parseStr(raw, 'field');
      // `filterStr`, not `parseStr`: a blank filter present in the payload must mean "no
      // filter" both in the `where` below and in the domain check, or the check errors on
      // the empty string — a value the caller never asked to match.
      const enrollmentStatus = filterStr(raw, 'enrollment_status');
      const currentPhase = filterStr(raw, 'current_phase');
      const cohort = parseNum(raw, 'cohort');
      const school = filterStr(raw, 'school');
      const hsGraduationYear = parseNum(raw, 'hs_graduation_year');
      const dobStart = filterStr(raw, 'dob_start');
      const dobEnd = filterStr(raw, 'dob_end');
      const withdrawalCode = filterStr(raw, 'withdrawal_code');
      const withdrawalDateStart = filterStr(raw, 'withdrawal_date_start');
      const withdrawalDateEnd = filterStr(raw, 'withdrawal_date_end');
      const filterField = filterStr(raw, 'filter_field');
      const filterMin = parseNum(raw, 'filter_min');
      const filterMax = parseNum(raw, 'filter_max');
      const limit = clampLimit(parseNum(raw, 'limit'));

      // Before any counting. A value its column does not contain makes every branch below
      // return an empty answer that reads as a fact about the program.
      const domainError = unmatchableFilterError(
        await buildDomainChecks({
          enrollmentStatus,
          currentPhase,
          cohort,
          hsGraduationYear,
          withdrawalCode,
        }),
      );
      if (domainError) return domainError;

      // Presence, not truthiness. `cohort ? ...` and `hsGraduationYear ? ...` dropped a
      // zero-valued filter, which is the same silent unscoping one value wide: the query
      // ran over everyone while the caller believed it was narrowed. Neither zero occurs
      // in the data, so this changes no existing answer — it stops the two from
      // disagreeing with the domain check above, which keys off presence.
      const where: Prisma.StudentWhereInput = {
        ...(enrollmentStatus !== undefined ? { enrollmentStatus } : {}),
        ...(currentPhase !== undefined ? { currentPhase } : {}),
        ...(cohort !== undefined ? { cohort } : {}),
        ...(school !== undefined ? { schoolName: { contains: school, mode: 'insensitive' } } : {}),
        ...(hsGraduationYear !== undefined ? { hsGraduationYear } : {}),
        ...(dobStart || dobEnd
          ? {
              dob: {
                ...(dobStart ? { gte: new Date(dobStart) } : {}),
                ...(dobEnd ? { lte: new Date(dobEnd) } : {}),
              },
            }
          : {}),
        ...(withdrawalCode !== undefined ? { withdrawalCode } : {}),
        ...(withdrawalDateStart || withdrawalDateEnd
          ? {
              withdrawalDate: {
                ...(withdrawalDateStart ? { gte: new Date(withdrawalDateStart) } : {}),
                ...(withdrawalDateEnd ? { lte: new Date(withdrawalDateEnd) } : {}),
              },
            }
          : {}),
      };
      if (filterField && filterField in NUMERIC_RANGE_FIELDS && (filterMin !== undefined || filterMax !== undefined)) {
        const column = NUMERIC_RANGE_FIELDS[filterField]!;
        where[column] = {
          ...(filterMin !== undefined ? { gte: filterMin } : {}),
          ...(filterMax !== undefined ? { lte: filterMax } : {}),
        };
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
          .join('') as BreakdownColumn;
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

      // Counted over `where`, independent of `limit`. `student_count: rows.length` was a
      // page size wearing the name that `query_enrollment`'s `total` path uses for a real
      // `prisma.count()` (#195) — the same field name meaning a total on one tool and
      // `min(actual, 500)` here, with nothing in the response telling them apart. The
      // shared envelope (`record_count` / `total_matching` / `truncated` / `limit`) is now
      // the thing to read; `student_count` is kept for existing callers and, from here on,
      // carries the true total like everywhere else.
      const [total, rows] = await Promise.all([
        prisma.student.count({ where }),
        prisma.student.findMany({
          where,
          // `canonicalName` alone is not unique, so duplicate names tied and reordered
          // between identical calls, making a truncated page an irreproducible subset.
          // `id` is the `@id`, so it is the tie-break that guarantees a total order.
          orderBy: [{ canonicalName: 'asc' }, { id: 'asc' }],
          take: limit,
        }),
      ]);
      const envelope = resultEnvelope(rows.length, total, limit);
      return {
        query_type: 'list',
        student_count: total,
        ...envelope,
        students: rows.map((s) => ({
          id: s.id,
          student_number: s.studentNumber,
          canonical_name: s.canonicalName,
          email: s.email,
          launchpad_email: s.launchpadEmail,
          alt_school_email: s.altSchoolEmail,
          current_phase: s.currentPhase,
          enrollment_status: s.enrollmentStatus,
          cohort: s.cohort,
          neighborhood: s.neighborhood,
          zip: s.zip,
          school_name: s.schoolName,
          hs_graduation_year: s.hsGraduationYear,
          dob: s.dob,
          withdrawal_code: s.withdrawalCode,
          withdrawal_date: s.withdrawalDate,
          distance_to_office: s.distanceToOffice,
          graduation_date: s.graduationDate,
        })),
      };
    }),
  );
}

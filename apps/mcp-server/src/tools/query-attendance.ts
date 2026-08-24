import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseNum, filterStr } from '../tool-helpers.js';
import { cohortNotSupported } from '../errors.js';
import { unmatchableFilterError, type FilterDomainCheck } from '../filter-domain.js';
import { attendanceCurrentPhaseIndex } from '../filter-domain-loaders.js';

const NAME = 'query_attendance';

const DESCRIPTION =
  'Query Launchpad student attendance records. Use for per-student attendance rates, aggregate rates by phase / race / school / etc., or raw event drill-downs over a date range. Excused absences are excluded from rate calculations. Cohort is not tracked — filter/group by current_phase and a date range instead. Every response echoes filters_applied, and filters_ignored when an input does not apply to the query_type, so a rate is never silently unscoped. current_phase is matched literally against the values that column holds; a value absent from it returns a no_records error listing the values present, rather than an answer covering everyone.';

const inputSchema = {
  query_type: z.enum(['by_student', 'aggregate', 'events']),
  student_number: z
    .string()
    .optional()
    .describe('LP#### (joins students.student_number).'),
  cohort: z
    .number()
    .optional()
    .describe('Deprecated — cohort is no longer tracked. Use current_phase and a date range instead.'),
  current_phase: z
    .string()
    .optional()
    .describe(
      'Restrict to students whose students.current_phase is this value, joined on student_number. Distinct from group_by:"current_phase", which breaks the whole result down by phase instead of narrowing it.',
    ),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  group_by: z
    .enum(['cohort', 'current_phase', 'enrollment_status', 'overall'])
    .optional(),
  limit: z.number().optional(),
};

/**
 * Inputs echoed back, in a fixed order so the envelope reads the same way whatever order
 * a caller sent the keys in. `group_by` is not here: it selects a breakdown rather than
 * narrowing the population, so it is never "ignored" in the sense this echo reports.
 * `cohort` is also not here — it is rejected outright (see `cohortNotSupported`) rather
 * than applied or ignored, so it never reaches this echo either way.
 */
const FILTERS = [
  'student_number',
  'current_phase',
  'start_date',
  'end_date',
  'limit',
] as const;

type FilterName = (typeof FILTERS)[number];

/**
 * `limit` pages the rows returned, so only the query types that return rows honour it.
 * `aggregate` returns one row per group and reports `limit` ignored rather than
 * pretending to have applied it.
 */
const ROW_FILTERS = FILTERS;
const AGGREGATE_FILTERS = FILTERS.filter((f) => f !== 'limit');

/**
 * Names the filters present in the payload as strings but blank after trimming.
 *
 * `filterStr` drops these, so they reach neither the query nor `provided`. Naming them
 * is the difference between "blank means no filter" and silently unscoping a query the
 * caller believes they narrowed — the same failure as the ignored `current_phase`, from
 * the other direction. `limit` is absent because it is numeric and has no blank form.
 */
function blankFilters(raw: Record<string, unknown>): FilterName[] {
  return FILTERS.filter((name) => {
    const v = raw[name];
    return typeof v === 'string' && v.trim() === '';
  });
}

function filterEcho(
  provided: Record<string, string | number>,
  honoured: readonly FilterName[],
  blanked: readonly FilterName[] = [],
): { filters_applied: Record<string, string | number>; filters_ignored?: string[] } {
  const applied: Record<string, string | number> = {};
  const ignored: string[] = [];
  for (const name of FILTERS) {
    if (name in provided) {
      if (honoured.includes(name)) applied[name] = provided[name]!;
      else ignored.push(name);
    } else if (blanked.includes(name)) {
      ignored.push(name);
    }
  }
  return { filters_applied: applied, ...(ignored.length > 0 ? { filters_ignored: ignored } : {}) };
}

/**
 * `current_phase` arrives as a list of student numbers rather than a column predicate.
 *
 * `attendance_records` has no relation to `students` — see `attendanceCurrentPhaseIndex`
 * — so the phase is resolved to its students first and matched on `student_number`.
 *
 * It goes in through `AND` rather than onto `where.studentNumber`, because
 * `student_number` and `current_phase` can both be supplied and assigning the same key
 * twice would silently keep only the second. `AND` makes the two conjunctive, so
 * `student_number` for a student outside the phase returns zero — a truthful zero about
 * a real pair of values, which is the boundary this whole check is built around.
 */
function buildWhere(
  raw: Record<string, unknown>,
  phaseStudentNumbers: readonly string[] | undefined,
): Prisma.AttendanceRecordWhereInput {
  const where: Prisma.AttendanceRecordWhereInput = {};
  const studentNumber = filterStr(raw, 'student_number');
  const startDate = filterStr(raw, 'start_date');
  const endDate = filterStr(raw, 'end_date');

  if (studentNumber) where.studentNumber = studentNumber;
  if (phaseStudentNumbers !== undefined) {
    where.AND = [{ studentNumber: { in: [...phaseStudentNumbers] } }];
  }
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }
  return where;
}

interface AttendanceTotals {
  present: number;
  absent: number;
  excused: number;
  pctSum: number;
  pctCount: number;
}

function emptyTotals(): AttendanceTotals {
  return { present: 0, absent: 0, excused: 0, pctSum: 0, pctCount: 0 };
}

// `sourceFormat` is an internal signal for which of the 3 source spreadsheets
// a row came from (1 = weekly aggregate %, 2/3 = daily/weekly P/A/E codes) —
// never expose this to callers, see AttendanceRecord.sourceFormat in schema.prisma.
function addRow(
  totals: AttendanceTotals,
  sourceFormat: number,
  code: string | null,
  percentage: number | null,
): void {
  if (sourceFormat === 1 && percentage !== null) {
    totals.pctSum += percentage;
    totals.pctCount += 1;
    return;
  }
  if (code === 'P') totals.present += 1;
  else if (code === 'A') totals.absent += 1;
  else if (code === 'E') totals.excused += 1;
}

function rate(totals: AttendanceTotals): number | null {
  const codeDenom = totals.present + totals.absent;
  if (codeDenom === 0 && totals.pctCount === 0) return null;
  const codeRate = codeDenom > 0 ? (totals.present / codeDenom) * 100 : null;
  const pctRate = totals.pctCount > 0 ? totals.pctSum / totals.pctCount : null;
  const parts = [codeRate, pctRate].filter((p): p is number => p !== null);
  if (parts.length === 0) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  return Math.round((sum / parts.length) * 10) / 10;
}

export function registerQueryAttendance(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = filterStr(raw, 'query_type') ?? 'aggregate';
      const cohort = parseNum(raw, 'cohort');
      const groupByInput = filterStr(raw, 'group_by');
      if (cohort !== undefined || groupByInput === 'cohort') return cohortNotSupported();

      const currentPhase = filterStr(raw, 'current_phase');

      /**
       * The fix this tool needed (#209): `current_phase` was declared here and read
       * nowhere, so a caller scoping attendance to one phase got every phase back in a
       * response that named the filter as applied. Not a silent zero but a silent
       * *superset* — any phase-scoped attendance rate ever quoted from this tool was the
       * org-wide rate.
       *
       * Resolved before the branches so all three query types scope identically, and
       * domain-checked in the same pass: a phase no attendance-carrying student holds
       * would otherwise return an empty answer that reads as "this phase does not
       * attend".
       */
      const phaseIndex = currentPhase !== undefined ? await attendanceCurrentPhaseIndex() : undefined;
      const checks: FilterDomainCheck[] = [];
      if (currentPhase !== undefined && phaseIndex !== undefined) {
        checks.push({
          field: 'current_phase',
          column: 'students.current_phase (over students with attendance rows)',
          value: currentPhase,
          domain: [...phaseIndex.keys()],
        });
      }
      const domainError = unmatchableFilterError(checks);
      if (domainError) return domainError;

      const provided: Record<string, string | number> = {};
      for (const name of FILTERS) {
        const v = name === 'limit' ? parseNum(raw, name) : filterStr(raw, name);
        if (v !== undefined) provided[name] = v;
      }
      const blanked = blankFilters(raw);

      // `phaseIndex.get` is non-undefined past the domain check above — an absent phase
      // has already returned. Kept as a lookup rather than a `!` so a future reordering
      // that moves the check degrades to "no phase predicate" rather than to a crash.
      const where = buildWhere(raw, currentPhase !== undefined ? (phaseIndex?.get(currentPhase) ?? []) : undefined);

      if (queryType === 'events') {
        const limit = Math.min(parseNum(raw, 'limit') ?? 200, 500);
        // Echo the clamp, not the ask. `provided` is built from the raw input, so a caller who
        // sent `limit: 5000` was told `filters_applied.limit: 5000` while 500 rows came back —
        // `truncated` said otherwise in the same envelope. Only overwritten when the caller
        // actually sent one, so an absent `limit` still reads as absent rather than as the default.
        if ('limit' in provided) provided['limit'] = limit;
        const [totalMatched, rows] = await Promise.all([
          prisma.attendanceRecord.count({ where }),
          prisma.attendanceRecord.findMany({
            where,
            orderBy: [{ date: 'desc' }],
            take: limit,
          }),
        ]);
        const students = await loadStudents(rows.map((r) => r.studentNumber));
        return {
          query_type: 'events',
          ...filterEcho(provided, ROW_FILTERS, blanked),
          total_rows_matched: totalMatched,
          records_returned: rows.length,
          truncated: rows.length < totalMatched,
          records: rows.map((r) => ({
            id: r.id,
            student_number: r.studentNumber,
            student_name: students.get(r.studentNumber)?.canonicalName ?? null,
            current_phase: students.get(r.studentNumber)?.currentPhase ?? null,
            date: r.date,
            code: r.code,
            percentage: r.percentage,
            row_data: r.rowData,
          })),
        };
      }

      const rows = await prisma.attendanceRecord.findMany({
        where,
        select: {
          sourceFormat: true,
          code: true,
          percentage: true,
          studentNumber: true,
        },
      });
      const students = await loadStudents(rows.map((r) => r.studentNumber));

      if (queryType === 'by_student') {
        const perStudent = new Map<string, { totals: AttendanceTotals }>();
        for (const r of rows) {
          let entry = perStudent.get(r.studentNumber);
          if (!entry) {
            entry = { totals: emptyTotals() };
            perStudent.set(r.studentNumber, entry);
          }
          addRow(entry.totals, r.sourceFormat, r.code, r.percentage ? Number(r.percentage) : null);
        }
        /**
         * `limit` was declared and read only by the `events` branch, so a caller who
         * asked for ten students got every student — the same declared-and-ignored input
         * as `current_phase`, one branch over. Applied here as a page over the
         * aggregated students, with the matched total kept separate from the page size
         * so the two can never be confused (the `student_count` trap in #195).
         *
         * Sorted by student number first: the rows arrive in whatever order Postgres
         * returns, so an unsorted page is an arbitrary subset that can differ between
         * identical calls.
         */
        const limit = Math.min(parseNum(raw, 'limit') ?? perStudent.size, 1000);
        // Clamped echo, as in the `events` branch above — the ceiling here is 1000.
        if ('limit' in provided) provided['limit'] = limit;
        const ordered = Array.from(perStudent.entries()).sort(([a], [b]) => a.localeCompare(b));
        const page = ordered.slice(0, limit);
        return {
          query_type: 'by_student',
          ...filterEcho(provided, ROW_FILTERS, blanked),
          total_students: perStudent.size,
          students_returned: page.length,
          truncated: page.length < ordered.length,
          students: page.map(([sn, e]) => ({
            student_number: sn,
            canonical_name: students.get(sn)?.canonicalName ?? null,
            current_phase: students.get(sn)?.currentPhase ?? null,
            attendance_rate_pct: rate(e.totals),
            rows_counted:
              e.totals.present + e.totals.absent + e.totals.excused + e.totals.pctCount,
            present: e.totals.present,
            absent: e.totals.absent,
            excused: e.totals.excused,
          })),
        };
      }

      const groupBy = groupByInput ?? 'current_phase';
      const groups = new Map<
        string,
        { totals: AttendanceTotals; students: Set<string> }
      >();
      for (const r of rows) {
        const student = students.get(r.studentNumber);
        const key =
          groupBy === 'current_phase'
            ? (student?.currentPhase ?? 'unknown')
            : groupBy === 'enrollment_status'
              ? (student?.enrollmentStatus ?? 'unknown')
              : 'overall';
        let entry = groups.get(key);
        if (!entry) {
          entry = { totals: emptyTotals(), students: new Set() };
          groups.set(key, entry);
        }
        addRow(entry.totals, r.sourceFormat, r.code, r.percentage ? Number(r.percentage) : null);
        entry.students.add(r.studentNumber);
      }

      const overallTotals = emptyTotals();
      const overallStudents = new Set<string>();
      for (const r of rows) {
        addRow(overallTotals, r.sourceFormat, r.code, r.percentage ? Number(r.percentage) : null);
        overallStudents.add(r.studentNumber);
      }

      return {
        query_type: 'aggregate',
        group_by: groupBy,
        ...filterEcho(provided, AGGREGATE_FILTERS, blanked),
        overall: {
          student_count: overallStudents.size,
          attendance_rate_pct: rate(overallTotals),
          rows_counted:
            overallTotals.present +
            overallTotals.absent +
            overallTotals.excused +
            overallTotals.pctCount,
        },
        breakdown: Array.from(groups.entries()).map(([group, e]) => ({
          group,
          student_count: e.students.size,
          attendance_rate_pct: rate(e.totals),
          rows_counted:
            e.totals.present + e.totals.absent + e.totals.excused + e.totals.pctCount,
          present: e.totals.present,
          absent: e.totals.absent,
          excused: e.totals.excused,
        })),
      };
    }),
  );
}

async function loadStudents(
  numbers: string[],
): Promise<Map<string, { canonicalName: string; currentPhase: string | null; enrollmentStatus: string | null }>> {
  if (numbers.length === 0) return new Map();
  const uniq = [...new Set(numbers)];
  const students = await prisma.student.findMany({
    where: { studentNumber: { in: uniq } },
    select: {
      studentNumber: true,
      canonicalName: true,
      currentPhase: true,
      enrollmentStatus: true,
    },
  });
  const map = new Map<string, { canonicalName: string; currentPhase: string | null; enrollmentStatus: string | null }>();
  for (const s of students) {
    if (s.studentNumber) {
      map.set(s.studentNumber, {
        canonicalName: s.canonicalName,
        currentPhase: s.currentPhase,
        enrollmentStatus: s.enrollmentStatus,
      });
    }
  }
  return map;
}

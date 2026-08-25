import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseNum, filterStr } from '../tool-helpers.js';
import { unmatchableFilterError, type FilterDomainCheck } from '../filter-domain.js';
import { attendanceCurrentPhaseIndex } from '../filter-domain-loaders.js';

const NAME = 'query_attendance';

const DESCRIPTION =
  'Query Launchpad student attendance from the four cohort sheets (Cohort 1 / 2 / 3 / 4). Use for per-student attendance rates, aggregate rates by phase / race / cohort / school / etc., or raw event drill-downs over a date range. Cohorts are loose Launchpad groupings; rates blend cohort 1 (already-aggregated weekly %, where present) with the daily P/A/E codes cohorts 1-4 otherwise carry. Excused absences are excluded from rate calculations. Every response echoes filters_applied, and filters_ignored when an input does not apply to the query_type, so a rate is never silently unscoped. current_phase and cohort are matched literally against the values those columns hold; a value absent from its column returns a no_records error listing the values present, rather than an answer covering everyone.';

const inputSchema = {
  query_type: z.enum(['by_student', 'aggregate', 'events']),
  student_number: z
    .string()
    .optional()
    .describe('LP#### (joins students.student_number).'),
  cohort: z.number().optional().describe('1, 2, 3, or 4.'),
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
 */
const FILTERS = [
  'student_number',
  'cohort',
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
 * the other direction. `cohort` and `limit` are absent because they are numeric and have
 * no blank form.
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
  const cohort = parseNum(raw, 'cohort');
  const startDate = filterStr(raw, 'start_date');
  const endDate = filterStr(raw, 'end_date');

  if (studentNumber) where.studentNumber = studentNumber;
  if (cohort !== undefined) where.cohort = cohort;
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

/** The distinct non-null cohorts present in `attendance_records`, unscoped. */
async function attendanceCohortDomain(): Promise<number[]> {
  const rows = await prisma.attendanceRecord.groupBy({ by: ['cohort'] });
  return rows.map((r) => r.cohort);
}

interface AttendanceTotals {
  present: number;
  absent: number;
  excused: number;
  cohort1Sum: number;
  cohort1Count: number;
}

function emptyTotals(): AttendanceTotals {
  return { present: 0, absent: 0, excused: 0, cohort1Sum: 0, cohort1Count: 0 };
}

function addRow(
  totals: AttendanceTotals,
  cohort: number,
  code: string | null,
  percentage: number | null,
): void {
  if (cohort === 1 && percentage !== null) {
    totals.cohort1Sum += percentage;
    totals.cohort1Count += 1;
    return;
  }
  // NCNS ("no call, no show") is an unexcused absence with no notice — counts
  // as absent, same as 'A'. 'MU' ("made up") never reaches here — it's
  // resolved beforehand by applyMakeups() into a cancelled prior absence.
  if (code === 'P') totals.present += 1;
  else if (code === 'A' || code === 'NCNS') totals.absent += 1;
  else if (code === 'E') totals.excused += 1;
}

interface MakeupRow {
  studentNumber: string;
  cohort: number;
  code: string | null;
  percentage: Prisma.Decimal | number | null;
  date: Date | null;
  rowData: Prisma.JsonValue;
}

function mondayOfWeek(date: Date): string {
  const d = new Date(date);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sun=0..Sat=6 -> days since most recent Monday
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

// The Tuesday-required / Thursday-makeup rule is specific to the Foundations
// phase. `learning_exp` (from the sheet's "LearningExp" column) is F1/F2 for
// Foundations terms, O1/O2 for 101, L1 for LiftOff — see docs/data-sources.
function isFoundationsRow(rowData: Prisma.JsonValue): boolean {
  if (typeof rowData !== 'object' || rowData === null || Array.isArray(rowData)) return false;
  const learningExp = (rowData as Record<string, unknown>)['learning_exp'];
  return typeof learningExp === 'string' && learningExp.trim().toUpperCase().startsWith('F');
}

// 'MU' ("made up") means a Foundations student attended office hours to make
// up a missed Tuesday earlier that same week, and should not count as an
// absence. This cancels the single most recent unresolved 'A'/'NCNS' for that
// student in the same Mon-Sun week (converting it to present), but only
// between Foundations rows — an 'MU' with no prior Foundations absence that
// week is a no-op, and 'MU' rows themselves are never counted as a separate
// attendance day. Multiple absences before one 'MU' are only resolved one at
// a time, oldest-unresolved-first — confirmed default pending a firmer answer
// on how make-ups spanning multiple missed days work.
function applyMakeups<T extends MakeupRow>(rows: T[]): T[] {
  const byStudent = new Map<string, T[]>();
  for (const r of rows) {
    const list = byStudent.get(r.studentNumber);
    if (list) list.push(r);
    else byStudent.set(r.studentNumber, [r]);
  }

  const result: T[] = [];
  for (const studentRows of byStudent.values()) {
    const dated = studentRows.filter((r) => r.date !== null);
    const undated = studentRows.filter((r) => r.date === null);
    dated.sort((a, b) => a.date!.getTime() - b.date!.getTime());

    const pendingAbsenceByWeek = new Map<string, T>();
    for (const row of dated) {
      const code = row.code?.trim().toUpperCase() ?? null;
      const week = mondayOfWeek(row.date!);
      if (code === 'MU') {
        if (isFoundationsRow(row.rowData)) {
          const pending = pendingAbsenceByWeek.get(week);
          if (pending) {
            pending.code = 'P';
            pendingAbsenceByWeek.delete(week);
          }
        }
        continue; // 'MU' is a correction, not its own attendance day
      }
      if ((code === 'A' || code === 'NCNS') && isFoundationsRow(row.rowData)) {
        pendingAbsenceByWeek.set(week, row);
      }
      result.push(row);
    }
    result.push(...undated);
  }
  return result;
}

function rate(totals: AttendanceTotals): number | null {
  const codeDenom = totals.present + totals.absent;
  if (codeDenom === 0 && totals.cohort1Count === 0) return null;
  const codeRate = codeDenom > 0 ? (totals.present / codeDenom) * 100 : null;
  const cohort1Rate =
    totals.cohort1Count > 0 ? totals.cohort1Sum / totals.cohort1Count : null;
  const parts = [codeRate, cohort1Rate].filter((p): p is number => p !== null);
  if (parts.length === 0) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  return Math.round((sum / parts.length) * 10) / 10;
}

export function registerQueryAttendance(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = filterStr(raw, 'query_type') ?? 'aggregate';
      const currentPhase = filterStr(raw, 'current_phase');
      const cohort = parseNum(raw, 'cohort');

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
      if (cohort !== undefined) {
        checks.push({
          field: 'cohort',
          column: 'attendance_records.cohort',
          value: cohort,
          domain: await attendanceCohortDomain(),
        });
      }
      const domainError = unmatchableFilterError(checks);
      if (domainError) return domainError;

      const provided: Record<string, string | number> = {};
      for (const name of FILTERS) {
        const v = name === 'cohort' || name === 'limit' ? parseNum(raw, name) : filterStr(raw, name);
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
            cohort: r.cohort,
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

      const fetchedRows = await prisma.attendanceRecord.findMany({
        where,
        select: {
          cohort: true,
          code: true,
          percentage: true,
          studentNumber: true,
          date: true,
          rowData: true,
        },
      });
      const rows = applyMakeups(fetchedRows);
      const students = await loadStudents(rows.map((r) => r.studentNumber));

      if (queryType === 'by_student') {
        const perStudent = new Map<
          string,
          { totals: AttendanceTotals; cohorts: Set<number> }
        >();
        for (const r of rows) {
          let entry = perStudent.get(r.studentNumber);
          if (!entry) {
            entry = { totals: emptyTotals(), cohorts: new Set() };
            perStudent.set(r.studentNumber, entry);
          }
          addRow(entry.totals, r.cohort, r.code, r.percentage ? Number(r.percentage) : null);
          entry.cohorts.add(r.cohort);
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
            cohorts: Array.from(e.cohorts).sort(),
            attendance_rate_pct: rate(e.totals),
            rows_counted:
              e.totals.present + e.totals.absent + e.totals.excused + e.totals.cohort1Count,
            present: e.totals.present,
            absent: e.totals.absent,
            excused: e.totals.excused,
          })),
        };
      }

      const groupBy = filterStr(raw, 'group_by') ?? 'cohort';
      const groups = new Map<
        string,
        { totals: AttendanceTotals; students: Set<string> }
      >();
      for (const r of rows) {
        const student = students.get(r.studentNumber);
        const key =
          groupBy === 'cohort'
            ? `cohort_${r.cohort}`
            : groupBy === 'current_phase'
              ? (student?.currentPhase ?? 'unknown')
              : groupBy === 'enrollment_status'
                ? (student?.enrollmentStatus ?? 'unknown')
                : 'overall';
        let entry = groups.get(key);
        if (!entry) {
          entry = { totals: emptyTotals(), students: new Set() };
          groups.set(key, entry);
        }
        addRow(entry.totals, r.cohort, r.code, r.percentage ? Number(r.percentage) : null);
        entry.students.add(r.studentNumber);
      }

      const overallTotals = emptyTotals();
      const overallStudents = new Set<string>();
      for (const r of rows) {
        addRow(overallTotals, r.cohort, r.code, r.percentage ? Number(r.percentage) : null);
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
            overallTotals.cohort1Count,
        },
        breakdown: Array.from(groups.entries()).map(([group, e]) => ({
          group,
          student_count: e.students.size,
          attendance_rate_pct: rate(e.totals),
          rows_counted:
            e.totals.present + e.totals.absent + e.totals.excused + e.totals.cohort1Count,
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

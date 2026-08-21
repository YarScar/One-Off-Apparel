import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { cohortNotSupported } from '../errors.js';

const NAME = 'query_attendance';

const DESCRIPTION =
  'Query Launchpad student attendance records. Use for per-student attendance rates, aggregate rates by phase / race / school / etc., or raw event drill-downs over a date range. Excused absences are excluded from rate calculations. Cohort is not tracked — filter/group by current_phase and a date range instead.';

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
  current_phase: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  group_by: z
    .enum(['cohort', 'current_phase', 'enrollment_status', 'overall'])
    .optional(),
  limit: z.number().optional(),
};

function buildWhere(raw: Record<string, unknown>): Prisma.AttendanceRecordWhereInput {
  const where: Prisma.AttendanceRecordWhereInput = {};
  const studentNumber = parseStr(raw, 'student_number');
  const startDate = parseStr(raw, 'start_date');
  const endDate = parseStr(raw, 'end_date');

  if (studentNumber) where.studentNumber = studentNumber;
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
      const queryType = parseStr(raw, 'query_type') ?? 'aggregate';
      const cohort = parseNum(raw, 'cohort');
      const groupByInput = parseStr(raw, 'group_by');
      if (cohort !== undefined || groupByInput === 'cohort') return cohortNotSupported();
      const where = buildWhere(raw);

      if (queryType === 'events') {
        const limit = Math.min(parseNum(raw, 'limit') ?? 200, 500);
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
        return {
          query_type: 'by_student',
          total_students: perStudent.size,
          students: Array.from(perStudent.entries()).map(([sn, e]) => ({
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

      const groupBy = parseStr(raw, 'group_by') ?? 'current_phase';
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

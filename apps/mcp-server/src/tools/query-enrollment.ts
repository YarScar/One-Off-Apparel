import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum, filterStr } from '../tool-helpers.js';
import { unmatchableFilterError, type FilterDomainCheck } from '../filter-domain.js';
import {
  studentCurrentPhaseDomain,
  studentEnrollmentStatusDomain,
  studentCohortDomain,
} from '../filter-domain-loaders.js';

const NAME = 'query_enrollment';

const DESCRIPTION =
  'Aggregate student enrollment data. Supports total headcount, phase status breakdowns, date-range active queries, cohort breakdowns, and per-student rows. Every response echoes filters_applied, and filters_ignored when a filter does not apply to the query_type, so a count is never silently unscoped. enrollment_status, current_phase, cohort and status are matched literally against the source values, which are short codes rather than words — enrollment_status held only E and N in production, so enrollment_status:"Active" is not a small result but a value that cannot match. A value absent from its column now returns a no_records error listing the values that column does hold, instead of an empty answer; a combination of real values that no student happens to have still returns an honest empty result.';

const inputSchema = {
  query_type: z.enum([
    'total',
    'by_phase',
    'active_during',
    'by_school',
    'by_cohort',
    'by_race',
    'by_student',
    'by_program_year',
  ]),
  phase: z.enum(['Foundations', '101', 'Lightspeed', 'LiftOff']).optional(),
  status: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  current_phase: z.string().optional(),
  enrollment_status: z.string().optional(),
  cohort: z.number().optional(),
  limit: z.number().optional(),
};

const PHASE_FIELDS = {
  Foundations: { status: 'foundationsStatus', start: 'foundationsStartDate', end: 'foundationsEndDate' },
  '101': { status: 'phase101Status', start: 'phase101StartDate', end: 'phase101EndDate' },
  Lightspeed: { status: 'lightspeedStatus', start: 'lightspeedStartDate', end: 'lightspeedEndDate' },
  LiftOff: { status: 'liftoffStatus', start: 'liftoffStartDate', end: 'liftoffEndDate' },
} as const;

type PhaseName = keyof typeof PHASE_FIELDS;

const PHASE_NAMES = Object.keys(PHASE_FIELDS) as PhaseName[];

/**
 * Filters that live on the `students` table. Applied directly on student-level
 * query types, and through the `student` relation on phase-outcome ones.
 */
const STUDENT_FILTERS = ['current_phase', 'enrollment_status', 'cohort'] as const;

/** Filters that live on `student_phase_outcomes` columns. */
const OUTCOME_FILTERS = ['phase', 'status'] as const;

/** Only `active_during` reads these. Every other query_type reports them ignored. */
const DATE_FILTERS = ['start_date', 'end_date'] as const;

/**
 * Exported so the filter-application tests bind to the constant the handler actually
 * passes to `filterEcho`, rather than to a copy. A test with its own array cannot fail
 * when a name is dropped from here, which is the one thing those tests exist to catch.
 */
export const NON_DATE_FILTERS = [...STUDENT_FILTERS, ...OUTCOME_FILTERS] as const;
export const ALL_FILTERS = [...NON_DATE_FILTERS, ...DATE_FILTERS] as const;

/** Every filter name the tool accepts. Typing `honoured` to this makes a typo a compile error. */
export type FilterName = (typeof ALL_FILTERS)[number];

/**
 * Translate `phase` / `status` into a predicate over a phase-outcome row.
 *
 * `phase` without `status` means "this phase has an outcome at all", matching the
 * `{ not: null }` the by_phase breakdown has always used. `status` without
 * `phase` means "any phase carries this status", which is why it fans out over
 * all four columns rather than picking one.
 */
function outcomePredicate(
  phase: PhaseName | undefined,
  status: string | undefined,
): Prisma.StudentPhaseOutcomeWhereInput | undefined {
  if (phase !== undefined) {
    return { [PHASE_FIELDS[phase].status]: status ?? { not: null } } as Prisma.StudentPhaseOutcomeWhereInput;
  }
  if (status !== undefined) {
    return {
      OR: PHASE_NAMES.map(
        (p) => ({ [PHASE_FIELDS[p].status]: status }) as Prisma.StudentPhaseOutcomeWhereInput,
      ),
    };
  }
  return undefined;
}

/**
 * Why every filter below is presence-tested rather than truthiness-tested: so that
 * `cohort: 0` reaches the query and the echo. That makes `""` the one remaining hazard,
 * which is what `filterStr` handles — see its doc comment in `tool-helpers.ts`, where it
 * now lives because `query_students`, `query_postsecondary` and `query_certifications`
 * domain-check filters the same way and need the same blank semantics.
 */

/**
 * Names the filters present in the payload as strings but blank after trimming.
 *
 * `filterStr` drops these, so they never reach `provided` and `filterEcho` cannot see
 * them. Without this, `{ query_type: 'total', status: '   ' }` returned a full
 * unscoped count with `filters_applied: {}` and no `filters_ignored` — a caller who
 * believes they scoped a query, an envelope that mentions no filter at all, and a
 * denominator quietly covering everyone. Blank reaches no query, so it is ignored, so
 * it is named. `cohort` is absent here because it is numeric and has no blank form.
 */
export function blankFilters(raw: Record<string, unknown>): FilterName[] {
  return ALL_FILTERS.filter((name) => {
    const v = raw[name];
    return typeof v === 'string' && v.trim() === '';
  });
}

/**
 * Exported for the filter-application test. Given the filters a caller supplied, the
 * subset a branch honours, and any supplied blank, returns the echo block. A filter
 * that reaches no query is named in `filters_ignored` rather than dropped — the
 * previous behaviour returned every student to a caller who asked for the Lightspeed
 * completers, with nothing in the envelope to say so.
 *
 * `honoured` is typed to `FilterName` rather than `string`, so a name that is not a
 * filter — a typo, or a filter renamed on one side only — fails to compile instead of
 * silently meaning "never honoured".
 */
export function filterEcho(
  provided: Record<string, string | number>,
  honoured: readonly FilterName[],
  blanked: readonly FilterName[] = [],
): { filters_applied: Record<string, string | number>; filters_ignored?: string[] } {
  const applied: Record<string, string | number> = {};
  const ignored: string[] = [];
  for (const name of ALL_FILTERS) {
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
 * The three `students` column domains this tool checks live in
 * `filter-domain-loaders.ts`, shared with `query_students`, which filters the same
 * columns with the same codes. The unscoped-read reasoning that governs all of them is
 * documented there and in the header of `filter-domain.ts`.
 *
 * `phaseStatusDomain` stays here because it is this tool's own: no other tool has a
 * `status` filter that fans out over four columns.
 */

/**
 * The union of the four phase status columns.
 *
 * `status` without `phase` fans out over all four (see `outcomePredicate`), so the
 * union is the set of values that could match *something*. With `phase` supplied it is
 * wider than that one column — deliberately: `phase: 'LiftOff', status: 'Completed'`
 * where `Completed` appears only in Foundations is a real value in a combination no row
 * satisfies, so it returns an empty result rather than an error. Narrowing this domain
 * per phase would reclassify that as a bad input, which it is not.
 */
async function phaseStatusDomain(): Promise<string[]> {
  const [foundations, phase101, lightspeed, liftoff] = await Promise.all([
    prisma.studentPhaseOutcome.groupBy({
      by: ['foundationsStatus'],
      where: { foundationsStatus: { not: null } },
    }),
    prisma.studentPhaseOutcome.groupBy({
      by: ['phase101Status'],
      where: { phase101Status: { not: null } },
    }),
    prisma.studentPhaseOutcome.groupBy({
      by: ['lightspeedStatus'],
      where: { lightspeedStatus: { not: null } },
    }),
    prisma.studentPhaseOutcome.groupBy({
      by: ['liftoffStatus'],
      where: { liftoffStatus: { not: null } },
    }),
  ]);
  const values = new Set<string>();
  for (const r of foundations) if (r.foundationsStatus !== null) values.add(r.foundationsStatus);
  for (const r of phase101) if (r.phase101Status !== null) values.add(r.phase101Status);
  for (const r of lightspeed) if (r.lightspeedStatus !== null) values.add(r.lightspeedStatus);
  for (const r of liftoff) if (r.liftoffStatus !== null) values.add(r.liftoffStatus);
  return [...values];
}

/**
 * Build the domain checks for the filters a caller actually supplied, in
 * `NON_DATE_FILTERS` order so which failure is reported first is deterministic rather
 * than payload-order dependent. An unfiltered call loads no domains at all.
 *
 * `phase` is absent because it is a `z.enum` in the input schema — the four phase names
 * are validated before the handler runs, so it has no unmatchable form to catch. The
 * date filters are absent because a date outside the data's range is a real window
 * returning a real zero, not a value drawn from a column's domain.
 */
async function buildDomainChecks(f: {
  currentPhase: string | undefined;
  enrollmentStatus: string | undefined;
  cohort: number | undefined;
  status: string | undefined;
}): Promise<FilterDomainCheck[]> {
  const checks: FilterDomainCheck[] = [];
  if (f.currentPhase !== undefined) {
    checks.push({
      field: 'current_phase',
      column: 'students.current_phase',
      value: f.currentPhase,
      domain: await studentCurrentPhaseDomain(),
    });
  }
  if (f.enrollmentStatus !== undefined) {
    checks.push({
      field: 'enrollment_status',
      column: 'students.enrollment_status',
      value: f.enrollmentStatus,
      domain: await studentEnrollmentStatusDomain(),
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
  if (f.status !== undefined) {
    checks.push({
      field: 'status',
      column: 'student_phase_outcomes phase status columns',
      value: f.status,
      domain: await phaseStatusDomain(),
    });
  }
  return checks;
}

export function registerQueryEnrollment(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? 'total';
      const phaseFilter = filterStr(raw, 'phase') as PhaseName | undefined;
      const statusFilter = filterStr(raw, 'status');
      const currentPhase = filterStr(raw, 'current_phase');
      const enrollmentStatus = filterStr(raw, 'enrollment_status');
      const cohort = parseNum(raw, 'cohort');
      const startDate = filterStr(raw, 'start_date');
      const endDate = filterStr(raw, 'end_date');
      const limit = Math.min(parseNum(raw, 'limit') ?? 500, 1000);

      // Presence, not truthiness, everywhere below — `cohort: 0` is a filter, and a
      // filter dropped for being falsy is the defect this tool is being fixed for.
      const provided: Record<string, string | number> = {
        ...(phaseFilter !== undefined ? { phase: phaseFilter } : {}),
        ...(statusFilter !== undefined ? { status: statusFilter } : {}),
        ...(currentPhase !== undefined ? { current_phase: currentPhase } : {}),
        ...(enrollmentStatus !== undefined ? { enrollment_status: enrollmentStatus } : {}),
        ...(cohort !== undefined ? { cohort } : {}),
        ...(startDate !== undefined ? { start_date: startDate } : {}),
        ...(endDate !== undefined ? { end_date: endDate } : {}),
      };
      const blanked = blankFilters(raw);

      // Before any counting. A value its column does not contain makes every branch
      // below return an empty answer that reads as a fact — `by_phase` with
      // `enrollment_status: 'Active'` gave `breakdown: []` beside an echo naming the
      // filter, and nothing said the codes are `E` and `N`. Checked here, once, so all
      // eight query_types answer the same way; blank filters have already been dropped
      // by `filterStr`, so "no filter" never reaches this as a value to look up.
      const domainError = unmatchableFilterError(
        await buildDomainChecks({
          currentPhase,
          enrollmentStatus,
          cohort,
          status: statusFilter,
        }),
      );
      if (domainError) return domainError;

      const studentWhere: Prisma.StudentWhereInput = {
        ...(currentPhase !== undefined ? { currentPhase } : {}),
        ...(enrollmentStatus !== undefined ? { enrollmentStatus } : {}),
        ...(cohort !== undefined ? { cohort } : {}),
      };
      const hasStudentFilters = Object.keys(studentWhere).length > 0;

      const outcome = outcomePredicate(phaseFilter, statusFilter);

      /** Student-level queries: student columns plus the phase/status predicate. */
      const scopedStudentWhere: Prisma.StudentWhereInput = {
        ...studentWhere,
        ...(outcome ? { phaseOutcomes: { some: outcome } } : {}),
      };

      /** Phase-outcome queries: reach the student columns through the relation. */
      const studentScope: Prisma.StudentPhaseOutcomeWhereInput = hasStudentFilters
        ? { student: studentWhere }
        : {};

      switch (queryType) {
        case 'total': {
          const count = await prisma.student.count({ where: scopedStudentWhere });
          return { query_type: 'total', student_count: count, ...filterEcho(provided, NON_DATE_FILTERS, blanked) };
        }
        case 'by_phase': {
          const phases = phaseFilter ? [phaseFilter] : PHASE_NAMES;
          const breakdown: Array<{ phase: string; status: string | null; count: number }> = [];
          for (const p of phases) {
            const f = PHASE_FIELDS[p];
            const where: Prisma.StudentPhaseOutcomeWhereInput = {
              ...(outcomePredicate(p, statusFilter) ?? {}),
              ...studentScope,
            };
            const rows = await prisma.studentPhaseOutcome.findMany({ where, select: { [f.status]: true } as Prisma.StudentPhaseOutcomeSelect });
            const counts = new Map<string | null, number>();
            for (const r of rows) {
              const s = (r as unknown as Record<string, string | null>)[f.status] ?? null;
              counts.set(s, (counts.get(s) ?? 0) + 1);
            }
            for (const [status, count] of counts) {
              breakdown.push({ phase: p, status, count });
            }
          }
          return { query_type: 'by_phase', breakdown, ...filterEcho(provided, NON_DATE_FILTERS, blanked) };
        }
        case 'active_during': {
          if (!phaseFilter) {
            return {
              query_type: 'active_during',
              error: 'phase is required for active_during',
            };
          }
          const f = PHASE_FIELDS[phaseFilter];
          // `phase` is a predicate here, not just a column selector. It used to be the
          // latter only: `PHASE_FIELDS[phaseFilter]` chose which columns `status` and the
          // dates were written against, and `phase` itself never entered `where`. With
          // dates supplied the non-null date columns enforced phase existence by accident,
          // so the hole opened on any dateless call — legal, since only `phase` is
          // required. `active_during, phase: 'LiftOff'` then returned every outcome row in
          // scope, including students with no LiftOff data at all, beside a
          // `filters_applied` naming the phase. Composing `outcomePredicate` is what makes
          // one filter mean one thing across all eight branches.
          const where: Prisma.StudentPhaseOutcomeWhereInput = {
            ...(outcomePredicate(phaseFilter, statusFilter) ?? {}),
            ...studentScope,
          };
          if (endDate) (where as Record<string, unknown>)[f.start] = { lte: new Date(endDate) };
          if (startDate) (where as Record<string, unknown>)[f.end] = { gte: new Date(startDate) };
          const rows = await prisma.studentPhaseOutcome.findMany({
            where,
            include: { student: { select: { canonicalName: true, studentNumber: true } } },
            take: limit,
          });
          // Counted, not inferred from `rows.length`. Under `take: limit` a wide window
          // returns a page, and reporting its length as the count hands back a
          // truncated denominator with `filters_applied` echoed beside it — the same
          // wrong-denominator failure as a dropped filter, from the other direction.
          const matched = await prisma.studentPhaseOutcome.count({ where });
          return {
            query_type: 'active_during',
            phase: phaseFilter,
            student_count: matched,
            ...(rows.length < matched ? { truncated: true, returned: rows.length, limit } : {}),
            students: rows.map((r) => ({
              student_number: r.student.studentNumber,
              canonical_name: r.student.canonicalName,
              start_date: (r as unknown as Record<string, Date | null>)[f.start],
              end_date: (r as unknown as Record<string, Date | null>)[f.end],
              status: (r as unknown as Record<string, string | null>)[f.status],
            })),
            ...filterEcho(provided, ALL_FILTERS),
          };
        }
        case 'by_cohort': {
          const grouped = await prisma.student.groupBy({
            by: ['cohort'],
            where: scopedStudentWhere,
            _count: { _all: true },
          });
          return {
            query_type: 'by_cohort',
            breakdown: grouped.map((g) => ({
              cohort: g.cohort,
              count: g._count?._all ?? 0,
            })),
            ...filterEcho(provided, NON_DATE_FILTERS, blanked),
          };
        }
        case 'by_school': {
          const grouped = await prisma.student.groupBy({
            by: ['schoolName'],
            where: scopedStudentWhere,
            _count: { _all: true },
          });
          return {
            query_type: 'by_school',
            breakdown: grouped.map((g) => ({
              school: g.schoolName,
              count: g._count?._all ?? 0,
            })),
            ...filterEcho(provided, NON_DATE_FILTERS, blanked),
          };
        }
        case 'by_race': {
          const grouped = await prisma.student.groupBy({
            by: ['raceEthnicity'],
            where: scopedStudentWhere,
            _count: { _all: true },
          });
          return {
            query_type: 'by_race',
            breakdown: grouped.map((g) => ({
              race_ethnicity: g.raceEthnicity,
              count: g._count?._all ?? 0,
            })),
            ...filterEcho(provided, NON_DATE_FILTERS, blanked),
          };
        }
        case 'by_program_year': {
          const grouped = await prisma.student.groupBy({
            by: ['hsGraduationYear'],
            where: scopedStudentWhere,
            _count: { _all: true },
          });
          return {
            query_type: 'by_program_year',
            breakdown: grouped.map((g) => ({
              hs_graduation_year: g.hsGraduationYear,
              count: g._count?._all ?? 0,
            })),
            ...filterEcho(provided, NON_DATE_FILTERS, blanked),
          };
        }
        case 'by_student': {
          const rows = await prisma.student.findMany({
            where: scopedStudentWhere,
            include: { phaseOutcomes: true },
            take: limit,
          });
          // Counted, for the same reason as `active_during` above: under `take: limit`
          // (default 500) `rows.length` is a page size, and returning it as
          // `student_count` beside an echoed `filters_applied` is a truncated
          // denominator that reads as a total. board-reporting.ts derives retention
          // from this branch.
          const matched = await prisma.student.count({ where: scopedStudentWhere });
          return {
            query_type: 'by_student',
            student_count: matched,
            ...(rows.length < matched ? { truncated: true, returned: rows.length, limit } : {}),
            students: rows.map((s) => ({
              id: s.id,
              student_number: s.studentNumber,
              canonical_name: s.canonicalName,
              current_phase: s.currentPhase,
              enrollment_status: s.enrollmentStatus,
              cohort: s.cohort,
              phase_outcomes: s.phaseOutcomes.flatMap((po) => unpackPhases(po)),
            })),
            ...filterEcho(provided, NON_DATE_FILTERS, blanked),
          };
        }
        default: {
          return { query_type: queryType, note: 'Unsupported query_type' };
        }
      }
    }),
  );
}

function unpackPhases(po: {
  foundationsStatus: string | null;
  foundationsStartDate: Date | null;
  foundationsEndDate: Date | null;
  phase101Status: string | null;
  phase101StartDate: Date | null;
  phase101EndDate: Date | null;
  lightspeedStatus: string | null;
  lightspeedStartDate: Date | null;
  lightspeedEndDate: Date | null;
  liftoffStatus: string | null;
  liftoffStartDate: Date | null;
  liftoffEndDate: Date | null;
}): Array<{ phase: string; status: string | null; start_date: Date | null; end_date: Date | null }> {
  return [
    { phase: 'Foundations', status: po.foundationsStatus, start_date: po.foundationsStartDate, end_date: po.foundationsEndDate },
    { phase: '101', status: po.phase101Status, start_date: po.phase101StartDate, end_date: po.phase101EndDate },
    { phase: 'Lightspeed', status: po.lightspeedStatus, start_date: po.lightspeedStartDate, end_date: po.lightspeedEndDate },
    { phase: 'LiftOff', status: po.liftoffStatus, start_date: po.liftoffStartDate, end_date: po.liftoffEndDate },
  ].filter((p) => p.status !== null || p.start_date !== null);
}

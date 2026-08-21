import { prisma } from '@lp-ai/lib-db';
import { AttendanceTrendChart, type AttendanceTrendPoint } from './charts/AttendanceTrendChart';
import { ProgramCompletionChart, type ProgramCompletionPoint } from './charts/ProgramCompletionChart';
import { CompetencyAttendanceHeatmap, type HeatmapCell } from './charts/CompetencyAttendanceHeatmap';
import { CompetencyScatterChart, type CompetencyScatterPoint } from './charts/CompetencyScatterChart';

export const dynamic = 'force-dynamic';

interface CompletionRow {
  program_year: string;
  student_count: string;
  foundations_started: string;
  foundations_complete: string;
  phase_101_started: string;
  phase_101_complete: string;
  lightspeed_started: string;
  lightspeed_complete: string;
  liftoff_started: string;
  liftoff_complete: string;
}

interface AttendanceMonthRow {
  month: string;
  avg_attendance: string;
}

interface CompetencyAvgRow {
  competency: string;
  avg_performance: string;
  avg_growth: string;
  avg_progress: string;
  student_count: string;
}

interface HeadlineRow {
  total_students: string;
  active_students: string;
  attendance_record_count: string;
}

interface CompetencyScatterRow {
  student_number: string;
  student_name: string;
  competency: string;
  growth: string;
  progress: string;
}

interface HeatmapRow {
  competency: string;
  bucket: string;
  avg_growth: string | null;
  student_count: string;
}

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: string | null };

async function safeQuery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<QueryResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not exist')) return { data: null, error: null };
    console.error(`Dashboard [${label}]:`, msg);
    return { data: null, error: msg };
  }
}

function pct(complete: string, started: string): string {
  const c = parseInt(complete, 10);
  const s = parseInt(started, 10);
  if (!s) return '—';
  return `${Math.round((c / s) * 100).toString()}%`;
}

function pctNum(complete: string, started: string): number | null {
  const c = parseInt(complete, 10);
  const s = parseInt(started, 10);
  if (!s) return null;
  return Math.round((c / s) * 100);
}

function SectionError({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span className="font-medium">Query error:</span> {message}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const headlineSql = `
  SELECT
    (SELECT COUNT(*)::text FROM students) AS total_students,
    (SELECT COUNT(*)::text FROM students WHERE UPPER(COALESCE(enrollment_status, '')) = 'E') AS active_students,
    (SELECT COUNT(*)::text FROM attendance_records) AS attendance_record_count
`;

const completionSql = `
  WITH base AS (
    SELECT
      COALESCE(EXTRACT(YEAR FROM spo.foundations_start_date)::text, 'Unknown') AS program_year,
      s.id,
      spo.foundations_start_date, LOWER(TRIM(spo.foundations_status)) AS foundations_status,
      spo.phase_101_start_date,   LOWER(TRIM(spo.phase_101_status))   AS phase_101_status,
      spo.lightspeed_start_date,  LOWER(TRIM(spo.lightspeed_status))  AS lightspeed_status,
      spo.liftoff_start_date,     LOWER(TRIM(spo.liftoff_status))     AS liftoff_status
    FROM students s
    INNER JOIN student_phase_outcomes spo ON s.id = spo.student_id
  ),
  by_year AS (
    SELECT
      program_year,
      COUNT(DISTINCT id)::text AS student_count,
      COUNT(DISTINCT CASE WHEN foundations_start_date IS NOT NULL THEN id END)::text AS foundations_started,
      COUNT(DISTINCT CASE WHEN foundations_status = 'completed' THEN id END)::text AS foundations_complete,
      COUNT(DISTINCT CASE WHEN phase_101_start_date   IS NOT NULL THEN id END)::text AS phase_101_started,
      COUNT(DISTINCT CASE WHEN phase_101_status   = 'completed' THEN id END)::text AS phase_101_complete,
      COUNT(DISTINCT CASE WHEN lightspeed_start_date  IS NOT NULL THEN id END)::text AS lightspeed_started,
      COUNT(DISTINCT CASE WHEN lightspeed_status  = 'completed' THEN id END)::text AS lightspeed_complete,
      COUNT(DISTINCT CASE WHEN liftoff_start_date     IS NOT NULL THEN id END)::text AS liftoff_started,
      COUNT(DISTINCT CASE WHEN liftoff_status     = 'completed' THEN id END)::text AS liftoff_complete
    FROM base
    GROUP BY program_year
  ),
  totals AS (
    SELECT
      'All Time' AS program_year,
      COUNT(DISTINCT id)::text AS student_count,
      COUNT(DISTINCT CASE WHEN foundations_start_date IS NOT NULL THEN id END)::text AS foundations_started,
      COUNT(DISTINCT CASE WHEN foundations_status = 'completed' THEN id END)::text AS foundations_complete,
      COUNT(DISTINCT CASE WHEN phase_101_start_date   IS NOT NULL THEN id END)::text AS phase_101_started,
      COUNT(DISTINCT CASE WHEN phase_101_status   = 'completed' THEN id END)::text AS phase_101_complete,
      COUNT(DISTINCT CASE WHEN lightspeed_start_date  IS NOT NULL THEN id END)::text AS lightspeed_started,
      COUNT(DISTINCT CASE WHEN lightspeed_status  = 'completed' THEN id END)::text AS lightspeed_complete,
      COUNT(DISTINCT CASE WHEN liftoff_start_date     IS NOT NULL THEN id END)::text AS liftoff_started,
      COUNT(DISTINCT CASE WHEN liftoff_status     = 'completed' THEN id END)::text AS liftoff_complete
    FROM base
  )
  SELECT * FROM (
    SELECT *, 0 AS sort_order FROM by_year
    UNION ALL
    SELECT *, 1 AS sort_order FROM totals
  ) combined
  ORDER BY sort_order, program_year DESC NULLS LAST
`;

const attendanceMonthlySql = `
  WITH per_student_month AS (
    SELECT
      TO_CHAR(date, 'YYYY-MM') AS month,
      student_number,
      ROUND(
        COUNT(CASE WHEN UPPER(code) IN ('P', 'L') THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
      ) AS student_rate
    FROM attendance_records
    WHERE code IS NOT NULL AND date IS NOT NULL
    GROUP BY TO_CHAR(date, 'YYYY-MM'), student_number
  )
  SELECT month, ROUND(AVG(student_rate), 1)::text AS avg_attendance
  FROM per_student_month
  GROUP BY month
  ORDER BY month
`;

const competencyAvgsSql = `
  SELECT
    competency,
    ROUND(AVG(performance_level), 2)::text AS avg_performance,
    ROUND(AVG(growth), 2)::text AS avg_growth,
    ROUND(AVG(progress), 2)::text AS avg_progress,
    COUNT(*)::text AS student_count
  FROM student_competencies
  WHERE performance_level IS NOT NULL
  GROUP BY competency
  ORDER BY competency
`;

const competencyScatterSql = `
  SELECT
    sc.student_number,
    COALESCE(s.canonical_name, sc.student_number) AS student_name,
    sc.competency,
    sc.growth::text AS growth,
    sc.progress::text AS progress
  FROM student_competencies sc
  LEFT JOIN students s ON s.student_number = sc.student_number
  WHERE sc.growth IS NOT NULL AND sc.progress IS NOT NULL
  ORDER BY sc.competency, sc.student_number
`;

const heatmapSql = `
  WITH student_attendance AS (
    SELECT
      student_number,
      ROUND(
        COUNT(CASE WHEN UPPER(code) IN ('P', 'L') THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
      ) AS att_rate
    FROM attendance_records
    WHERE code IS NOT NULL
    GROUP BY student_number
    HAVING COUNT(*) >= 5
  ),
  bucketed AS (
    SELECT
      student_number,
      CASE
        WHEN att_rate < 70 THEN '<70%'
        WHEN att_rate < 80 THEN '70–80%'
        WHEN att_rate < 90 THEN '80–90%'
        ELSE '90%+'
      END AS bucket
    FROM student_attendance
  ),
  joined AS (
    SELECT
      sc.competency,
      b.bucket,
      sc.growth
    FROM student_competencies sc
    INNER JOIN bucketed b ON b.student_number = sc.student_number
    WHERE sc.growth IS NOT NULL
  )
  SELECT
    competency,
    bucket,
    ROUND(AVG(growth), 2)::text AS avg_growth,
    COUNT(*)::text AS student_count
  FROM joined
  GROUP BY competency, bucket
  ORDER BY competency, bucket
`;

export default async function DashboardPage(): Promise<JSX.Element> {
  const [
    headline,
    completion,
    attendanceMonthly,
    competencyAvgs,
    competencyScatter,
    heatmap,
  ] = await Promise.all([
    safeQuery('headline', () => prisma.$queryRawUnsafe<HeadlineRow[]>(headlineSql)),
    safeQuery('completion', () =>
      prisma.$queryRawUnsafe<Array<CompletionRow & { sort_order: number }>>(completionSql),
    ),
    safeQuery('attendance-monthly', () =>
      prisma.$queryRawUnsafe<AttendanceMonthRow[]>(attendanceMonthlySql),
    ),
    safeQuery('competency-avgs', () =>
      prisma.$queryRawUnsafe<CompetencyAvgRow[]>(competencyAvgsSql),
    ),
    safeQuery('competency-scatter', () =>
      prisma.$queryRawUnsafe<CompetencyScatterRow[]>(competencyScatterSql),
    ),
    safeQuery('heatmap', () =>
      prisma.$queryRawUnsafe<HeatmapRow[]>(heatmapSql),
    ),
  ]);

  const headlineRow = headline.data?.[0];
  const completionRows = completion.data ?? [];
  const monthlyRows = attendanceMonthly.data ?? [];
  const competencyRows = competencyAvgs.data ?? [];
  const scatterRows = competencyScatter.data ?? [];
  const heatmapRows = heatmap.data ?? [];

  // Program completion → bar chart points (exclude "All Time" totals)
  const completionChartData: ProgramCompletionPoint[] = completionRows
    .filter((r) => r.program_year !== 'All Time')
    .map((r) => ({
      program_year: r.program_year,
      Foundations: pctNum(r.foundations_complete, r.foundations_started),
      '101': pctNum(r.phase_101_complete, r.phase_101_started),
      Lightspeed: pctNum(r.lightspeed_complete, r.lightspeed_started),
      LiftOff: pctNum(r.liftoff_complete, r.liftoff_started),
    }))
    .reverse(); // ascending year order for chart

  // Attendance → line chart points
  const sortedMonthlyRows = [...monthlyRows].sort((a, b) => a.month.localeCompare(b.month));
  const attendanceChartData: AttendanceTrendPoint[] = sortedMonthlyRows.map((row) => ({
    month: row.month,
    rate: parseFloat(row.avg_attendance),
  }));

  // Competency scatter
  const scatterChartData: CompetencyScatterPoint[] = scatterRows
    .map((r) => ({
      student: r.student_name,
      competency: r.competency,
      growth: parseFloat(r.growth),
      progress: parseFloat(r.progress),
    }))
    .filter((p) => !isNaN(p.growth) && !isNaN(p.progress));

  // Heatmap
  const heatmapChartData: HeatmapCell[] = heatmapRows.map((r) => ({
    competency: r.competency,
    bucket: r.bucket,
    avg_growth: r.avg_growth == null ? null : parseFloat(r.avg_growth),
    student_count: parseInt(r.student_count, 10),
  }));

  return (
    <div className="space-y-12">
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Launchpad Dashboard</h1>
        <p className="mt-2 text-sm text-muted">
          Program completion, attendance trends, and competency outcomes across the program.
        </p>
      </header>

      {/* Headline KPIs */}
      {headlineRow && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total Students" value={headlineRow.total_students} />
          <StatCard label="Active Students" value={headlineRow.active_students} hint="Currently enrolled" />
          <StatCard label="Attendance Records" value={headlineRow.attendance_record_count} hint="Synced from source sheets" />
        </section>
      )}

      {/* Program Completion */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Program Completion</h2>
          <span className="text-xs text-muted">Completion % by phase, grouped by program year</span>
        </div>
        {completion.error ? (
          <SectionError message={completion.error} />
        ) : completionRows.length === 0 ? (
          <p className="text-sm text-muted">No phase outcome data synced yet.</p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <ProgramCompletionChart data={completionChartData} />
            </div>
            <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink hover:bg-slate-50">
                Show underlying table
              </summary>
              <div className="overflow-x-auto border-t border-slate-200">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200">Year</th>
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200">Students</th>
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center" colSpan={2}>Foundations</th>
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center" colSpan={2}>101</th>
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center" colSpan={2}>Lightspeed</th>
                      <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center" colSpan={2}>LiftOff</th>
                    </tr>
                    <tr className="bg-slate-50 text-xs text-muted">
                      <th className="px-4 py-1 border border-slate-200" colSpan={2} />
                      <th className="px-4 py-1 border border-slate-200">Started</th>
                      <th className="px-4 py-1 border border-slate-200">Completed</th>
                      <th className="px-4 py-1 border border-slate-200">Started</th>
                      <th className="px-4 py-1 border border-slate-200">Completed</th>
                      <th className="px-4 py-1 border border-slate-200">Started</th>
                      <th className="px-4 py-1 border border-slate-200">Completed</th>
                      <th className="px-4 py-1 border border-slate-200">Started</th>
                      <th className="px-4 py-1 border border-slate-200">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completionRows.map((row) => {
                      const isTotal = row.program_year === 'All Time';
                      const rowClass = isTotal
                        ? 'border-t-2 border-slate-400 bg-slate-50 font-semibold'
                        : 'hover:bg-slate-50';
                      const cellClass = `px-4 py-2 border border-slate-200${isTotal ? ' text-ink' : ''}`;
                      return (
                        <tr key={row.program_year} className={rowClass}>
                          <td className={`${cellClass} font-medium`}>{row.program_year}</td>
                          <td className={cellClass}>{row.student_count}</td>
                          <td className={cellClass}>{row.foundations_started}</td>
                          <td className={cellClass}>
                            {row.foundations_complete}{' '}
                            <span className="text-muted text-xs">
                              ({pct(row.foundations_complete, row.foundations_started)})
                            </span>
                          </td>
                          <td className={cellClass}>{row.phase_101_started}</td>
                          <td className={cellClass}>
                            {row.phase_101_complete}{' '}
                            <span className="text-muted text-xs">
                              ({pct(row.phase_101_complete, row.phase_101_started)})
                            </span>
                          </td>
                          <td className={cellClass}>{row.lightspeed_started}</td>
                          <td className={cellClass}>
                            {row.lightspeed_complete}{' '}
                            <span className="text-muted text-xs">
                              ({pct(row.lightspeed_complete, row.lightspeed_started)})
                            </span>
                          </td>
                          <td className={cellClass}>{row.liftoff_started}</td>
                          <td className={cellClass}>
                            {row.liftoff_complete}{' '}
                            <span className="text-muted text-xs">
                              ({pct(row.liftoff_complete, row.liftoff_started)})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Attendance */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Attendance</h2>
          <span className="text-xs text-muted">Monthly trend · 80% threshold marked</span>
        </div>
        {attendanceMonthly.error ? (
          <SectionError message={attendanceMonthly.error} />
        ) : monthlyRows.length === 0 ? (
          <p className="text-sm text-muted">No attendance data synced yet.</p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <AttendanceTrendChart data={attendanceChartData} />
              <p className="mt-3 text-xs text-amber-700">
                <span className="font-medium">Caveat:</span> One data source may be missing Jan–Aug 2023.
                Late (L) days count as present.
              </p>
            </div>
            <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink hover:bg-slate-50">
                Show monthly table
              </summary>
              <div className="overflow-x-auto border-t border-slate-200 p-4">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {sortedMonthlyRows.map((r) => (
                        <th
                          key={r.month}
                          className="px-3 py-2 font-medium text-muted border border-slate-200 text-center min-w-[80px]"
                        >
                          {r.month}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {sortedMonthlyRows.map((r) => {
                        const val = parseFloat(r.avg_attendance);
                        const flagged = val < 80;
                        return (
                          <td
                            key={r.month}
                            className={`px-3 py-2 border border-slate-200 text-center ${
                              flagged ? 'bg-red-50 text-red-700 font-semibold' : 'text-ink'
                            }`}
                          >
                            {r.avg_attendance}%
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Competency */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Competency</h2>
          <span className="text-xs text-muted">Per-student growth vs. progress · top-right = best</span>
        </div>
        {competencyScatter.error ? (
          <SectionError message={competencyScatter.error} />
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <CompetencyScatterChart data={scatterChartData} />
            </div>
            {competencyAvgs.error ? (
              <SectionError message={competencyAvgs.error} />
            ) : competencyRows.length === 0 ? null : (
              <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink hover:bg-slate-50">
                  Show competency averages table
                </summary>
                <div className="overflow-x-auto border-t border-slate-200">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="px-4 py-2 font-medium text-muted border border-slate-200">Competency</th>
                        <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center">Students</th>
                        <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center">Avg Performance</th>
                        <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center">Avg Growth</th>
                        <th className="px-4 py-2 font-medium text-muted border border-slate-200 text-center">Avg Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competencyRows.map((row) => {
                        const growth = parseFloat(row.avg_growth);
                        const progress = parseFloat(row.avg_progress);
                        const flagGrowth = !isNaN(growth) && growth < 0;
                        const flagProgress = !isNaN(progress) && progress < 75;
                        const rowFlag = flagGrowth || flagProgress;
                        return (
                          <tr key={row.competency} className={rowFlag ? 'bg-red-50' : 'hover:bg-slate-50'}>
                            <td className="px-4 py-2 border border-slate-200 font-medium">{row.competency}</td>
                            <td className="px-4 py-2 border border-slate-200 text-center text-muted">{row.student_count}</td>
                            <td className="px-4 py-2 border border-slate-200 text-center">{row.avg_performance}</td>
                            <td className={`px-4 py-2 border border-slate-200 text-center ${flagGrowth ? 'text-red-600 font-semibold' : 'text-ink'}`}>
                              {row.avg_growth}{flagGrowth ? ' ↓' : ''}
                            </td>
                            <td className={`px-4 py-2 border border-slate-200 text-center ${flagProgress ? 'text-red-600 font-semibold' : 'text-ink'}`}>
                              {row.avg_progress}%{flagProgress ? ' ⚠' : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Competency × Attendance Heatmap */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Competency Growth by Attendance Band</h2>
          <span className="text-xs text-muted">Does attendance predict growth? Greener = stronger growth</span>
        </div>
        {heatmap.error ? (
          <SectionError message={heatmap.error} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <CompetencyAttendanceHeatmap data={heatmapChartData} />
          </div>
        )}
      </section>
    </div>
  );
}

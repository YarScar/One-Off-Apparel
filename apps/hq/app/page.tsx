import { prisma } from '@lp-ai/lib-db';
import { ClaudeUsageCard, type ClaudeUsageBreakdownRow } from './components/ClaudeUsageCard';
import { fmtInt } from './lib/format';

export const dynamic = 'force-dynamic';

/** The spend-report CSV is a weekly manual upload (no API on our plan) — flag it once it's
 * more than a week and a few days stale, rather than silently showing old numbers forever. */
const STALE_AFTER_DAYS = 10;

interface SourceFreshness {
  source: string;
  table: string;
  rowCount: number;
  lastSyncedAt: Date | null;
}

interface CsvUsageRow {
  user_email: string | null;
  request_count: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
  cost_usd: string | null;
}

interface CsvUsageSummary {
  total_requests: string;
  total_prompt_tokens: string | null;
  total_completion_tokens: string | null;
  total_cost_usd: string | null;
  distinct_users: string;
}

interface CsvUsageBreakdownDbRow {
  user_email: string | null;
  product_type: string | null;
  model: string | null;
  request_count: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  cost_usd: string | null;
}

async function fetchFreshness(): Promise<SourceFreshness[]> {
  const [students, info, certifications, competencies, attendance, finance, donors, chunks, outcomes] =
    await Promise.all([
      latest('students', 'updated_at'),
      latest('student_info', 'synced_at'),
      latest('student_certifications', 'last_synced_at'),
      latest('student_competencies', 'last_synced_at'),
      latest('attendance_records', 'last_synced_at'),
      latest('finance_snapshots', 'last_synced_at'),
      latest('donor_contacts', 'synced_at'),
      latest('document_chunks', 'synced_at'),
      latest('student_phase_outcomes', 'last_synced_at'),
    ]);

  return [
    { source: 'Students roster', table: 'students', ...students },
    { source: 'Phase outcomes', table: 'student_phase_outcomes', ...outcomes },
    { source: 'Certifications (PCEP)', table: 'student_certifications', ...certifications },
    { source: 'Competencies', table: 'student_competencies', ...competencies },
    { source: 'Attendance', table: 'attendance_records', ...attendance },
    { source: 'Finance (Sheets)', table: 'finance_snapshots', ...finance },
    { source: 'Drive student notes', table: 'student_info', ...info },
    { source: 'Donors (B21 CRM)', table: 'donor_contacts', ...donors },
    { source: 'Vector chunks', table: 'document_chunks', ...chunks },
  ];
}

const ALLOWED_TABLES = new Set([
  'students', 'student_info', 'student_certifications', 'student_competencies',
  'attendance_records', 'finance_snapshots', 'donor_contacts', 'document_chunks',
  'student_phase_outcomes',
]);
const ALLOWED_COLUMNS = new Set([
  'updated_at', 'synced_at', 'last_synced_at',
]);

async function latest(
  table: string,
  column: string,
): Promise<{ rowCount: number; lastSyncedAt: Date | null }> {
  if (!ALLOWED_TABLES.has(table) || !ALLOWED_COLUMNS.has(column)) {
    throw new Error(`Disallowed table/column: ${table}.${column}`);
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{ count: bigint; last_at: Date | null }>
  >(
    `SELECT COUNT(*)::bigint AS count, MAX("${column}") AS last_at FROM "${table}"`,
  );
  const r = rows[0];
  return {
    rowCount: r ? Number(r.count) : 0,
    lastSyncedAt: r?.last_at ?? null,
  };
}

async function fetchRecentUsage(): Promise<
  Array<{ id: string; toolName: string; durationMs: number | null; error: string | null; calledAt: Date }>
> {
  const rows = await prisma.usageLog.findMany({
    orderBy: { calledAt: 'desc' },
    take: 10,
  });
  return rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    durationMs: r.durationMs,
    error: r.error,
    calledAt: r.calledAt,
  }));
}

/**
 * Reads the *latest* CSV upload only (see apps/hq/app/csv-upload) — a snapshot, not a
 * date-range query, since the export itself already covers whatever range was selected
 * when it was downloaded. This is server-tracked by Anthropic and sees every Claude
 * surface (chat, Claude Code, Cowork, Office Agents) for every person in the org — the
 * whole team, not a subset.
 */
async function fetchCsvUsage(): Promise<{
  upload: { id: string; uploadedAt: Date; coveredFrom: Date | null; coveredTo: Date | null } | null;
  perUser: CsvUsageRow[];
  summary: CsvUsageSummary | null;
  breakdownByUser: Map<string, ClaudeUsageBreakdownRow[]>;
}> {
  const upload = await prisma.claudeCsvUpload.findFirst({
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, uploadedAt: true, coveredFrom: true, coveredTo: true },
  });
  if (!upload) return { upload: null, perUser: [], summary: null, breakdownByUser: new Map() };

  const perUser = await prisma.$queryRawUnsafe<CsvUsageRow[]>(
    `
    SELECT
      user_email,
      SUM(COALESCE(request_count, 0))::text AS request_count,
      SUM(COALESCE(prompt_tokens, 0))::text AS prompt_tokens,
      SUM(COALESCE(completion_tokens, 0))::text AS completion_tokens,
      SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))::text AS total_tokens,
      SUM(COALESCE(cost_usd, 0))::text AS cost_usd
    FROM claude_csv_usage_rows
    WHERE upload_id = $1
    GROUP BY user_email
    ORDER BY SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) DESC NULLS LAST
    LIMIT 50
    `,
    upload.id,
  );

  const summaryRows = await prisma.$queryRawUnsafe<CsvUsageSummary[]>(
    `
    SELECT
      SUM(COALESCE(request_count, 0))::text AS total_requests,
      SUM(COALESCE(prompt_tokens, 0))::text AS total_prompt_tokens,
      SUM(COALESCE(completion_tokens, 0))::text AS total_completion_tokens,
      SUM(COALESCE(cost_usd, 0))::text AS total_cost_usd,
      COUNT(DISTINCT user_email)::text AS distinct_users
    FROM claude_csv_usage_rows
    WHERE upload_id = $1
    `,
    upload.id,
  );

  const breakdownRows = await prisma.$queryRawUnsafe<CsvUsageBreakdownDbRow[]>(
    `
    SELECT
      user_email,
      product_type,
      model,
      SUM(COALESCE(request_count, 0))::text AS request_count,
      SUM(COALESCE(prompt_tokens, 0))::text AS prompt_tokens,
      SUM(COALESCE(completion_tokens, 0))::text AS completion_tokens,
      SUM(COALESCE(cost_usd, 0))::text AS cost_usd
    FROM claude_csv_usage_rows
    WHERE upload_id = $1
    GROUP BY user_email, product_type, model
    ORDER BY user_email, SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) DESC
    `,
    upload.id,
  );

  const breakdownByUser = new Map<string, ClaudeUsageBreakdownRow[]>();
  for (const r of breakdownRows) {
    const key = r.user_email ?? '';
    const entry = breakdownByUser.get(key) ?? [];
    entry.push({
      productType: r.product_type,
      model: r.model,
      requestCount: r.request_count,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      costUsd: r.cost_usd,
    });
    breakdownByUser.set(key, entry);
  }

  return { upload, perUser, summary: summaryRows[0] ?? null, breakdownByUser };
}

function TokenStatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function HomePage(): Promise<JSX.Element> {
  const [freshness, usage, csv] = await Promise.all([
    fetchFreshness(),
    fetchRecentUsage(),
    fetchCsvUsage(),
  ]);

  const csvTotalTokens =
    (parseInt(csv.summary?.total_prompt_tokens ?? '0', 10) || 0) +
    (parseInt(csv.summary?.total_completion_tokens ?? '0', 10) || 0);
  const csvTotalCostUsd = Number(csv.summary?.total_cost_usd ?? '0') || 0;
  const csvStaleDays = csv.upload
    ? Math.floor(
        (Date.now() - (csv.upload.coveredTo ?? csv.upload.uploadedAt).getTime()) / (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-2xl font-semibold text-ink">Data freshness</h1>
        <p className="mt-1 text-sm text-muted">
          Row count + most recent sync timestamp per backing table.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {freshness.map((f) => (
            <div key={f.table} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="text-sm font-medium text-ink">{f.source}</div>
              <div className="mt-1 text-xs text-muted">{f.table}</div>
              <div className="mt-3 text-2xl font-semibold tabular-nums">
                {f.rowCount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-muted">
                {f.lastSyncedAt
                  ? `last synced ${f.lastSyncedAt.toISOString().slice(0, 16)}Z`
                  : 'no data yet'}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="token-usage" className="scroll-mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">Claude token usage</h2>
            <p className="mt-1 text-sm text-muted">
              Token consumption by user, across every Claude surface (chat, Claude Code, Cowork, Office
              Agents).
            </p>
          </div>
          <a
            href="/csv-upload"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-slate-50"
          >
            Upload new export
          </a>
        </div>

        {csv.upload === null ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="font-medium">No spend report uploaded yet</div>
            <p className="mt-1 text-xs">
              This is populated from Anthropic&apos;s Team-plan CSV export (Owner/Primary Owner only) — see{' '}
              <a href="/csv-upload" className="underline">
                Upload Claude spend report
              </a>
              .
            </p>
          </div>
        ) : csvStaleDays !== null && csvStaleDays > STALE_AFTER_DAYS ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="font-medium">
              Stale — last upload covers data through{' '}
              {csv.upload.coveredTo?.toISOString().slice(0, 10) ?? csv.upload.uploadedAt.toISOString().slice(0, 10)}{' '}
              ({csvStaleDays} days ago)
            </div>
            <p className="mt-1 text-xs">
              This is a weekly manual export (no API on our plan) — someone with Owner/Primary Owner access needs
              to{' '}
              <a href="/csv-upload" className="underline">
                upload a fresh one
              </a>
              .
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            As of upload on {csv.upload.uploadedAt.toISOString().slice(0, 10)}
            {csv.upload.coveredFrom && csv.upload.coveredTo
              ? ` — covers ${csv.upload.coveredFrom.toISOString().slice(0, 10)} → ${csv.upload.coveredTo.toISOString().slice(0, 10)}`
              : ''}
            . Re-upload periodically to keep this current.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TokenStatCard label="Total tokens" value={fmtInt(csvTotalTokens.toString())} hint="Prompt + completion" />
          <TokenStatCard label="Prompt tokens" value={fmtInt(csv.summary?.total_prompt_tokens ?? '0')} />
          <TokenStatCard label="Completion tokens" value={fmtInt(csv.summary?.total_completion_tokens ?? '0')} />
          <TokenStatCard
            label="Cost"
            value={`$${csvTotalCostUsd.toFixed(2)}`}
            hint={`${fmtInt(csv.summary?.distinct_users ?? '0')} people`}
          />
        </div>

        <div className="mt-4 space-y-2">
          {csv.perUser.length === 0 ? (
            <div className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted shadow-sm">
              No usage rows in the latest upload.
            </div>
          ) : (
            csv.perUser.map((r) => (
              <ClaudeUsageCard
                key={r.user_email ?? ''}
                userEmail={r.user_email}
                requestCount={r.request_count}
                totalTokens={r.total_tokens}
                costUsd={r.cost_usd}
                breakdown={csv.breakdownByUser.get(r.user_email ?? '') ?? []}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-ink">Recent tool calls</h2>
        <p className="mt-1 text-sm text-muted">
          Most recent 10 MCP tool invocations from <code>usage_logs</code>.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Tool</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Called at</th>
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={4}>
                    No tool calls yet.
                  </td>
                </tr>
              ) : (
                usage.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-2 font-mono text-xs">{u.toolName}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {u.durationMs !== null ? `${u.durationMs.toString()} ms` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {u.error ? (
                        <span className="inline-flex rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          error
                        </span>
                      ) : (
                        <span className="inline-flex rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">
                          ok
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {u.calledAt.toISOString().slice(0, 19)}Z
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

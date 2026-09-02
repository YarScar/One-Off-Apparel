import { prisma } from '@lp-ai/lib-db';
import { TokenUsageDateFilter } from './components/TokenUsageDateFilter';

export const dynamic = 'force-dynamic';

interface SourceFreshness {
  source: string;
  table: string;
  rowCount: number;
  lastSyncedAt: Date | null;
}

interface TokenUsageRow {
  user_id: string | null;
  user_email: string | null;
  call_count: string;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  cache_creation_tokens: string | null;
  last_seen: Date | null;
}

interface TokenSummary {
  total_calls: string;
  total_input: string | null;
  total_output: string | null;
  total_cache_read: string | null;
  total_cache_creation: string | null;
  distinct_users: string;
  calls_with_tokens: string;
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

function resolveDateRange(searchParams: { [k: string]: string | string[] | undefined }): {
  from: Date | null;
  to: Date | null;
  label: string;
} {
  const preset = typeof searchParams['tokens_preset'] === 'string'
    ? searchParams['tokens_preset']
    : '30d';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (preset === 'all') {
    return { from: null, to: null, label: 'All time' };
  }
  if (preset === 'custom') {
    const fromStr = typeof searchParams['tokens_from'] === 'string' ? searchParams['tokens_from'] : null;
    const toStr = typeof searchParams['tokens_to'] === 'string' ? searchParams['tokens_to'] : null;
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : null;
    const to = toStr ? new Date(`${toStr}T23:59:59`) : null;
    const label = `${fromStr ?? '—'} → ${toStr ?? '—'}`;
    return { from, to, label };
  }

  const map: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  const days = map[preset] ?? 30;
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  from.setHours(0, 0, 0, 0);
  return { from, to: today, label: `Last ${String(days)} days` };
}

async function fetchTokenUsage(from: Date | null, to: Date | null): Promise<{
  perUser: TokenUsageRow[];
  summary: TokenSummary | null;
}> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    clauses.push(`called_at >= $${String(params.length)}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`called_at <= $${String(params.length)}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const perUser = await prisma.$queryRawUnsafe<TokenUsageRow[]>(
    `
    SELECT
      anthropic_user_id        AS user_id,
      anthropic_user_email     AS user_email,
      COUNT(*)::text           AS call_count,
      SUM(input_tokens)::text  AS input_tokens,
      SUM(output_tokens)::text AS output_tokens,
      SUM(cache_read_tokens)::text     AS cache_read_tokens,
      SUM(cache_creation_tokens)::text AS cache_creation_tokens,
      MAX(called_at) AS last_seen
    FROM usage_logs
    ${where}
    GROUP BY anthropic_user_id, anthropic_user_email
    ORDER BY SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) DESC NULLS LAST,
             COUNT(*) DESC
    LIMIT 50
    `,
    ...params,
  );

  const summaryRows = await prisma.$queryRawUnsafe<TokenSummary[]>(
    `
    SELECT
      COUNT(*)::text                                              AS total_calls,
      SUM(input_tokens)::text                                     AS total_input,
      SUM(output_tokens)::text                                    AS total_output,
      SUM(cache_read_tokens)::text                                AS total_cache_read,
      SUM(cache_creation_tokens)::text                            AS total_cache_creation,
      COUNT(DISTINCT COALESCE(anthropic_user_id, anthropic_user_email))::text AS distinct_users,
      SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL THEN 1 ELSE 0 END)::text AS calls_with_tokens
    FROM usage_logs
    ${where}
    `,
    ...params,
  );

  return { perUser, summary: summaryRows[0] ?? null };
}

function fmtInt(s: string | null | undefined): string {
  if (s == null) return '—';
  const n = Number(s);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
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

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function HomePage({ searchParams }: PageProps): Promise<JSX.Element> {
  const range = resolveDateRange(searchParams);

  const [freshness, usage, tokens] = await Promise.all([
    fetchFreshness(),
    fetchRecentUsage(),
    fetchTokenUsage(range.from, range.to),
  ]);

  const totalTokens = (() => {
    const i = parseInt(tokens.summary?.total_input ?? '0', 10) || 0;
    const o = parseInt(tokens.summary?.total_output ?? '0', 10) || 0;
    return i + o;
  })();
  const callsWithTokens = parseInt(tokens.summary?.calls_with_tokens ?? '0', 10) || 0;
  const totalCalls = parseInt(tokens.summary?.total_calls ?? '0', 10) || 0;
  const noTokenData = totalCalls > 0 && callsWithTokens === 0;

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
              Token consumption by user · <span className="text-ink">{range.label}</span>
            </p>
          </div>
          <TokenUsageDateFilter />
        </div>

        {noTokenData && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="font-medium">Waiting on data source</div>
            <p className="mt-1 text-xs">
              The schema is ready, but no usage rows have token counts yet. Token data is populated by the
              Anthropic Admin API connector — see{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5">docs/setup/22-anthropic-usage-connector.md</code>
              . Until then, the table below shows tool-call activity only.
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TokenStatCard
            label="Total tokens"
            value={fmtInt(totalTokens.toString())}
            hint="Input + output"
          />
          <TokenStatCard
            label="Input tokens"
            value={fmtInt(tokens.summary?.total_input ?? '0')}
          />
          <TokenStatCard
            label="Output tokens"
            value={fmtInt(tokens.summary?.total_output ?? '0')}
          />
          <TokenStatCard
            label="Distinct users"
            value={fmtInt(tokens.summary?.distinct_users ?? '0')}
            hint={`${fmtInt(tokens.summary?.total_calls ?? '0')} total calls`}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2 text-right">Calls</th>
                <th className="px-4 py-2 text-right">Input</th>
                <th className="px-4 py-2 text-right">Output</th>
                <th className="px-4 py-2 text-right">Cache read</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {tokens.perUser.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={7}>
                    No tool calls recorded in this range.
                  </td>
                </tr>
              ) : (
                tokens.perUser.map((r) => {
                  const input = parseInt(r.input_tokens ?? '0', 10) || 0;
                  const output = parseInt(r.output_tokens ?? '0', 10) || 0;
                  const total = input + output;
                  const label = r.user_email ?? r.user_id ?? '— unknown —';
                  const unknown = !r.user_email && !r.user_id;
                  return (
                    <tr key={`${r.user_id ?? ''}|${r.user_email ?? ''}`} className="border-t">
                      <td className={`px-4 py-2 ${unknown ? 'italic text-muted' : 'text-ink'}`}>
                        {label}
                        {r.user_email && r.user_id && (
                          <span className="ml-2 text-xs text-muted">({r.user_id.slice(0, 8)}…)</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.call_count)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.input_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.output_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.cache_read_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-ink">
                        {total > 0 ? total.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">
                        {r.last_seen ? r.last_seen.toISOString().slice(0, 19).replace('T', ' ') + 'Z' : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

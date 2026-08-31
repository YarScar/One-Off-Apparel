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
  session_count: string;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  total_tokens: string | null;
  cost_usd: string | null;
  last_seen: Date | null;
}

interface TokenSummary {
  total_input: string | null;
  total_output: string | null;
  total_tokens: string | null;
  total_cost_usd: string | null;
  distinct_users: string;
  distinct_sessions: string;
}

interface ActivityRow {
  user_id: string | null;
  user_email: string | null;
  event_count: string;
  session_count: string;
  last_seen: Date | null;
}

interface ActivitySummary {
  total_events: string;
  distinct_users: string;
  distinct_sessions: string;
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

/**
 * Reads `claude_telemetry_metrics` (fed by Claude Code's OpenTelemetry exporter — see
 * apps/hq/app/api/telemetry) rather than `usage_logs`. `usage_logs` only ever covers calls
 * to *our own* MCP tools; this covers all Claude Code activity, which is what the token
 * total on this page is actually supposed to mean. The `type` attribute on
 * `claude_code.token.usage` data points is assumed to carry 'input' / 'output' /
 * 'cacheRead' — unverified against a real export (see the comment in
 * app/api/telemetry/_lib/otlp.ts); `total_tokens` doesn't depend on that assumption, only
 * the input/output/cache breakdown columns do.
 */
async function fetchTokenUsage(from: Date | null, to: Date | null): Promise<{
  perUser: TokenUsageRow[];
  summary: TokenSummary | null;
}> {
  const clauses: string[] = [`metric_name IN ('claude_code.token.usage', 'claude_code.cost.usage')`];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    clauses.push(`recorded_at >= $${String(params.length)}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`recorded_at <= $${String(params.length)}`);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const perUser = await prisma.$queryRawUnsafe<TokenUsageRow[]>(
    `
    SELECT
      user_id,
      user_email,
      COUNT(DISTINCT session_id)::text AS session_count,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' AND attributes->>'type' = 'input' THEN value ELSE 0 END)::text AS input_tokens,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' AND attributes->>'type' = 'output' THEN value ELSE 0 END)::text AS output_tokens,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' AND attributes->>'type' IN ('cacheRead', 'cache_read') THEN value ELSE 0 END)::text AS cache_read_tokens,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' THEN value ELSE 0 END)::text AS total_tokens,
      SUM(CASE WHEN metric_name = 'claude_code.cost.usage' THEN value ELSE 0 END)::text AS cost_usd,
      MAX(recorded_at) AS last_seen
    FROM claude_telemetry_metrics
    ${where}
    GROUP BY user_id, user_email
    ORDER BY SUM(CASE WHEN metric_name = 'claude_code.token.usage' THEN value ELSE 0 END) DESC NULLS LAST
    LIMIT 50
    `,
    ...params,
  );

  const summaryRows = await prisma.$queryRawUnsafe<TokenSummary[]>(
    `
    SELECT
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' AND attributes->>'type' = 'input' THEN value ELSE 0 END)::text AS total_input,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' AND attributes->>'type' = 'output' THEN value ELSE 0 END)::text AS total_output,
      SUM(CASE WHEN metric_name = 'claude_code.token.usage' THEN value ELSE 0 END)::text AS total_tokens,
      SUM(CASE WHEN metric_name = 'claude_code.cost.usage' THEN value ELSE 0 END)::text AS total_cost_usd,
      COUNT(DISTINCT COALESCE(user_id, user_email))::text AS distinct_users,
      COUNT(DISTINCT session_id)::text AS distinct_sessions
    FROM claude_telemetry_metrics
    ${where}
    `,
    ...params,
  );

  return { perUser, summary: summaryRows[0] ?? null };
}

/** Same shape of query as `fetchTokenUsage`, over `claude_telemetry_events` instead — the
 * per-tool-call/session activity detail token totals alone don't carry. */
async function fetchClaudeActivity(from: Date | null, to: Date | null): Promise<{
  perUser: ActivityRow[];
  summary: ActivitySummary | null;
}> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    clauses.push(`occurred_at >= $${String(params.length)}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`occurred_at <= $${String(params.length)}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const perUser = await prisma.$queryRawUnsafe<ActivityRow[]>(
    `
    SELECT
      user_id,
      user_email,
      COUNT(*)::text AS event_count,
      COUNT(DISTINCT session_id)::text AS session_count,
      MAX(occurred_at) AS last_seen
    FROM claude_telemetry_events
    ${where}
    GROUP BY user_id, user_email
    ORDER BY COUNT(*) DESC
    LIMIT 50
    `,
    ...params,
  );

  const summaryRows = await prisma.$queryRawUnsafe<ActivitySummary[]>(
    `
    SELECT
      COUNT(*)::text AS total_events,
      COUNT(DISTINCT COALESCE(user_id, user_email))::text AS distinct_users,
      COUNT(DISTINCT session_id)::text AS distinct_sessions
    FROM claude_telemetry_events
    ${where}
    `,
    ...params,
  );

  return { perUser, summary: summaryRows[0] ?? null };
}

/** Mirrors `/api/telemetry/status`'s logic directly against the DB, rather than the page
 * making an HTTP call to its own API route. */
async function fetchTelemetryHealth(): Promise<{ status: 'healthy' | 'stale' | 'no_data_yet'; lastReceivedAt: Date | null }> {
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  const [lastMetric, lastEvent] = await Promise.all([
    prisma.claudeTelemetryMetric.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
    prisma.claudeTelemetryEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
  ]);
  const lastReceivedAt = [lastMetric?.receivedAt, lastEvent?.receivedAt]
    .filter((d): d is Date => d !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  if (lastReceivedAt === null) return { status: 'no_data_yet', lastReceivedAt: null };
  const stale = Date.now() - lastReceivedAt.getTime() > STALE_AFTER_MS;
  return { status: stale ? 'stale' : 'healthy', lastReceivedAt };
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

function TelemetryHealthBadge({
  health,
}: {
  health: { status: 'healthy' | 'stale' | 'no_data_yet'; lastReceivedAt: Date | null };
}): JSX.Element {
  const styles: Record<typeof health.status, string> = {
    healthy: 'bg-green-50 text-green-700',
    stale: 'bg-amber-50 text-amber-800',
    no_data_yet: 'bg-slate-100 text-muted',
  };
  const labels: Record<typeof health.status, string> = {
    healthy: 'Receiving data',
    stale: 'No data in 24h+',
    no_data_yet: 'Not connected yet',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[health.status]}`}
      title={health.lastReceivedAt ? `Last received ${health.lastReceivedAt.toISOString()}` : undefined}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          health.status === 'healthy' ? 'bg-green-500' : health.status === 'stale' ? 'bg-amber-500' : 'bg-slate-400'
        }`}
      />
      {labels[health.status]}
    </span>
  );
}

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function HomePage({ searchParams }: PageProps): Promise<JSX.Element> {
  const range = resolveDateRange(searchParams);

  const [freshness, usage, tokens, activity, health] = await Promise.all([
    fetchFreshness(),
    fetchRecentUsage(),
    fetchTokenUsage(range.from, range.to),
    fetchClaudeActivity(range.from, range.to),
    fetchTelemetryHealth(),
  ]);

  const totalTokens = parseInt(tokens.summary?.total_tokens ?? '0', 10) || 0;
  const totalCostUsd = Number(tokens.summary?.total_cost_usd ?? '0') || 0;
  const noTokenData = health.status === 'no_data_yet';

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
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-ink">Claude token usage</h2>
              <TelemetryHealthBadge health={health} />
            </div>
            <p className="mt-1 text-sm text-muted">
              Token consumption by user, from Claude Code · <span className="text-ink">{range.label}</span>
            </p>
          </div>
          <TokenUsageDateFilter />
        </div>

        {noTokenData && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="font-medium">Waiting on data source</div>
            <p className="mt-1 text-xs">
              No telemetry has arrived at <code className="rounded bg-amber-100 px-1 py-0.5">/api/telemetry</code> yet.
              This fills in once Claude Code&apos;s OpenTelemetry export is pointed at it — see{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5">docs/setup/22-anthropic-usage-connector.md</code>.
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TokenStatCard
            label="Total tokens"
            value={fmtInt(totalTokens.toString())}
            hint="Input + output + cache"
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
            label="Estimated cost"
            value={`$${totalCostUsd.toFixed(2)}`}
            hint={`${fmtInt(tokens.summary?.distinct_users ?? '0')} people`}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2 text-right">Sessions</th>
                <th className="px-4 py-2 text-right">Input</th>
                <th className="px-4 py-2 text-right">Output</th>
                <th className="px-4 py-2 text-right">Cache read</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Cost</th>
                <th className="px-4 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {tokens.perUser.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={8}>
                    No Claude Code usage recorded in this range.
                  </td>
                </tr>
              ) : (
                tokens.perUser.map((r) => {
                  const total = parseInt(r.total_tokens ?? '0', 10) || 0;
                  const cost = Number(r.cost_usd ?? '0') || 0;
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
                      <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.session_count)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.input_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.output_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.cache_read_tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-ink">
                        {total > 0 ? total.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">${cost.toFixed(2)}</td>
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

      <section id="claude-activity" className="scroll-mt-6">
        <h2 className="text-xl font-semibold text-ink">Claude Code activity</h2>
        <p className="mt-1 text-sm text-muted">
          Tool calls, prompts, and other session activity per person ·{' '}
          <span className="text-ink">{range.label}</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <TokenStatCard label="Total events" value={fmtInt(activity.summary?.total_events ?? '0')} />
          <TokenStatCard label="Distinct sessions" value={fmtInt(activity.summary?.distinct_sessions ?? '0')} />
          <TokenStatCard label="Distinct users" value={fmtInt(activity.summary?.distinct_users ?? '0')} />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2 text-right">Events</th>
                <th className="px-4 py-2 text-right">Sessions</th>
                <th className="px-4 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {activity.perUser.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={4}>
                    No Claude Code activity recorded in this range.
                  </td>
                </tr>
              ) : (
                activity.perUser.map((r) => {
                  const label = r.user_email ?? r.user_id ?? '— unknown —';
                  const unknown = !r.user_email && !r.user_id;
                  return (
                    <tr key={`${r.user_id ?? ''}|${r.user_email ?? ''}`} className="border-t">
                      <td className={`px-4 py-2 ${unknown ? 'italic text-muted' : 'text-ink'}`}>{label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.event_count)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtInt(r.session_count)}</td>
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

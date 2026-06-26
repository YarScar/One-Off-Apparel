import { prisma } from '@lp-ai/lib-db';

export const dynamic = 'force-dynamic';

const CONNECTORS = [
  'google-sheets',
  'google-drive',
  'aplos',
  'notion',
  'slack',
] as const;

interface ConnectorRow {
  connector: string;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRecordsUpserted: number | null;
  recent: Array<{
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    recordsUpserted: number;
    error: string | null;
    durationMs: number | null;
  }>;
}

async function fetchConnectorStatus(): Promise<ConnectorRow[]> {
  return Promise.all(
    CONNECTORS.map(async (connector) => {
      const recent = await prisma.syncRun.findMany({
        where: { connector },
        orderBy: { startedAt: 'desc' },
        take: 5,
      });
      const latest = recent[0];
      return {
        connector,
        lastStartedAt: latest?.startedAt ?? null,
        lastFinishedAt: latest?.finishedAt ?? null,
        lastStatus: latest?.status ?? null,
        lastError: latest?.error ?? null,
        lastRecordsUpserted: latest?.recordsUpserted ?? null,
        recent: recent.map((r) => ({
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          status: r.status,
          recordsUpserted: r.recordsUpserted,
          error: r.error,
          durationMs:
            r.finishedAt && r.startedAt
              ? r.finishedAt.getTime() - r.startedAt.getTime()
              : null,
        })),
      };
    }),
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted">never run</span>;
  const cls =
    status === 'ok'
      ? 'bg-green-50 text-green-700'
      : status === 'running'
        ? 'bg-blue-50 text-blue-700'
        : status === 'noop'
          ? 'bg-slate-100 text-slate-700'
          : 'bg-red-50 text-red-700';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>
  );
}

export default async function SyncPage() {
  const rows = await fetchConnectorStatus();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Sync status</h1>
        <p className="mt-1 text-sm text-muted">
          Last and recent runs for each connector, from <code>sync_runs</code>.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Connector</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last run</th>
              <th className="px-4 py-2">Records</th>
              <th className="px-4 py-2">Recent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.connector} className="border-t align-top">
                <td className="px-4 py-3 font-medium">{r.connector}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.lastStatus} />
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {r.lastStartedAt
                    ? r.lastStartedAt.toISOString().slice(0, 19) + 'Z'
                    : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.lastRecordsUpserted ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.recent.map((run, i) => (
                      <span
                        key={i}
                        title={`${run.startedAt.toISOString()} · ${run.status}${
                          run.error ? ' · ' + run.error : ''
                        }`}
                        className={`inline-block h-2 w-6 rounded ${
                          run.status === 'ok'
                            ? 'bg-green-400'
                            : run.status === 'noop'
                              ? 'bg-slate-300'
                              : run.status === 'running'
                                ? 'bg-blue-400'
                                : 'bg-red-400'
                        }`}
                      />
                    ))}
                    {r.recent.length === 0 && (
                      <span className="text-xs text-muted">no runs</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

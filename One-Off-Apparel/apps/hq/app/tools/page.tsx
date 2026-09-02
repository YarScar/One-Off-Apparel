import Link from 'next/link';
import { prisma } from '@lp-ai/lib-db';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { tool?: string; status?: string };
}

export default async function ToolsPage({
  searchParams,
}: PageProps) {
  const toolFilter = searchParams.tool;
  const statusFilter = searchParams.status;

  const where = {
    ...(toolFilter ? { toolName: toolFilter } : {}),
    ...(statusFilter === 'error' ? { error: { not: null } } : {}),
    ...(statusFilter === 'ok' ? { error: null } : {}),
  };

  const [rows, distinctTools] = await Promise.all([
    prisma.usageLog.findMany({
      where,
      orderBy: { calledAt: 'desc' },
      take: 100,
    }),
    prisma.usageLog.groupBy({
      by: ['toolName'],
      _count: { _all: true },
      orderBy: { _count: { toolName: 'desc' } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Tool call log</h1>
        <p className="mt-1 text-sm text-muted">
          Most recent 100 MCP tool invocations. Click a tool to filter.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Filter:</span>
        <Link
          href="/tools"
          className={`rounded border px-2 py-1 ${!toolFilter && !statusFilter ? 'bg-ink text-white' : 'bg-white'}`}
        >
          all
        </Link>
        <Link
          href="/tools?status=error"
          className={`rounded border px-2 py-1 ${statusFilter === 'error' ? 'bg-ink text-white' : 'bg-white'}`}
        >
          errors only
        </Link>
        {distinctTools.map((t) => (
          <Link
            key={t.toolName}
            href={`/tools?tool=${encodeURIComponent(t.toolName)}`}
            className={`rounded border px-2 py-1 ${toolFilter === t.toolName ? 'bg-ink text-white' : 'bg-white'}`}
          >
            {t.toolName} · {t._count._all.toString()}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Tool</th>
              <th className="px-4 py-2">Duration</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Called at</th>
              <th className="px-4 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-muted" colSpan={5}>
                  No matching tool calls.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2 font-mono text-xs">{r.toolName}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.durationMs !== null ? `${r.durationMs.toString()} ms` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {r.error ? (
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
                    {r.calledAt.toISOString().slice(0, 19)}Z
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <details>
                      <summary className="cursor-pointer text-muted hover:text-ink">
                        view
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-tight">
                        {JSON.stringify({ input: r.inputJson, output: r.outputJson }, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

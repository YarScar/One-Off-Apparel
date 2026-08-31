import { prisma } from '@lp-ai/lib-db';
import { CsvUploadForm } from './CsvUploadForm';

export const dynamic = 'force-dynamic';

async function fetchRecentUploads(): Promise<
  Array<{
    id: string;
    uploadedAt: Date;
    uploadedByEmail: string | null;
    originalFilename: string | null;
    coveredFrom: Date | null;
    coveredTo: Date | null;
    rowCount: number;
  }>
> {
  return prisma.claudeCsvUpload.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: 10,
  });
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—';
}

export default async function CsvUploadPage(): Promise<JSX.Element> {
  const uploads = await fetchRecentUploads();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Upload Claude spend report</h1>
        <p className="mt-1 text-sm text-muted">
          Manual import of Anthropic&apos;s Team-plan CSV export — the source of the &quot;Claude token usage&quot;
          numbers on the <a href="/#token-usage" className="underline">home page</a>, since our plan has no API
          for this. Re-upload periodically (weekly is reasonable) to keep it current.
        </p>
      </div>

      <CsvUploadForm />

      <section>
        <h2 className="text-lg font-semibold text-ink">Recent uploads</h2>
        <div className="mt-3 overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Uploaded</th>
                <th className="px-4 py-2">By</th>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Covers</th>
                <th className="px-4 py-2 text-right">Rows</th>
              </tr>
            </thead>
            <tbody>
              {uploads.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={5}>
                    No uploads yet.
                  </td>
                </tr>
              ) : (
                uploads.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-2 text-xs text-muted">
                      {u.uploadedAt.toISOString().slice(0, 19).replace('T', ' ')}Z
                    </td>
                    <td className="px-4 py-2 text-ink">{u.uploadedByEmail ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{u.originalFilename ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {fmtDate(u.coveredFrom)} → {fmtDate(u.coveredTo)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.rowCount.toLocaleString()}</td>
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

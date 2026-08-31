'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface UploadResult {
  status?: string;
  uploadId?: string;
  rowCount?: number;
  error?: string;
  message?: string;
}

export function CsvUploadForm(): JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch('/api/csv-upload', { method: 'POST', body: formData });
      const body = (await res.json()) as UploadResult;
      setResult(body);
      if (res.ok) {
        form.reset();
        router.refresh();
      }
    } catch (err) {
      setResult({ error: 'network_error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      <div>
        <label htmlFor="file" className="block text-sm font-medium text-ink">
          Spend report CSV
        </label>
        <p className="mt-1 text-xs text-muted">
          From claude.ai → Settings → Analytics → &quot;Export spend report&quot; (Owner/Primary Owner only).
        </p>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="mt-2 block w-full text-sm text-ink file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="covered_from" className="block text-sm font-medium text-ink">
            Range start (as exported)
          </label>
          <input
            id="covered_from"
            name="covered_from"
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="covered_to" className="block text-sm font-medium text-ink">
            Range end (as exported)
          </label>
          <input
            id="covered_to"
            name="covered_to"
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        Optional — whatever date range you selected on claude.ai before exporting. Used only to show how current
        the numbers are, not to filter anything.
      </p>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {submitting ? 'Uploading…' : 'Upload'}
      </button>

      {result && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}
        >
          {result.error
            ? `Failed: ${result.error}${result.message ? ` — ${result.message}` : ''}`
            : `Uploaded ${result.rowCount ?? 0} rows.`}
        </div>
      )}
    </form>
  );
}

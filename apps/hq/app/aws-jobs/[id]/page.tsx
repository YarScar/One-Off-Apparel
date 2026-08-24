'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';

/**
 * The job shape, as a schema rather than a bare interface.
 *
 * This page previously read `await res.json()` — an `any` — straight into `setJob`, so
 * every field below was an assumption the code never checked. A response missing
 * `parameters` rendered `job.parameters.terraformCode` and crashed the page with no
 * indication that the API was at fault. Parsing at the boundary is the convention in this
 * repo for external data (CLAUDE.md: "Zod schemas for all external data"), and it is what
 * lets the `any`-propagation lint errors go away by being *fixed* rather than silenced.
 */
const AwsJobSchema = z.object({
  id: z.string(),
  developer: z.string(),
  actionType: z.string(),
  resourceType: z.string(),
  parameters: z.object({ terraformCode: z.string() }),
  planOutput: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  approver: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type AwsJob = z.infer<typeof AwsJobSchema>;

/** The API's own error envelope, for the non-ok path. */
const ErrorEnvelopeSchema = z.object({ error: z.string() });

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function AwsJobReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<AwsJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/aws-jobs/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load job');
        return AwsJobSchema.parse(await res.json());
      })
      .then((data) => {
        setJob(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(messageOf(err, 'Failed to load job'));
        setLoading(false);
      });
  }, [id]);

  const handleAction = async (action: 'approve' | 'reject'): Promise<void> => {
    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/aws-jobs/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, approver: 'security-admin@launchpadphilly.org' }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        // The API's message when it supplies one, the generic when it does not — the old
        // `data.error ?? 'Action failed'` read a field off an unvalidated `any`.
        const envelope = ErrorEnvelopeSchema.safeParse(body);
        throw new Error(envelope.success ? envelope.data.error : 'Action failed');
      }
      setJob(AwsJobSchema.parse(body));
      setMessage(`Job successfully ${action === 'approve' ? 'approved' : 'rejected'}!`);
    } catch (err: unknown) {
      setError(messageOf(err, 'Action failed'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="rounded-lg bg-red-50 p-6 border border-red-200 text-center">
        <h2 className="text-xl font-bold text-red-700">Error Loading Job</h2>
        <p className="mt-2 text-red-600">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-500">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  if (!job) return null;

  const isDestructive =
    job.actionType === 'DELETE' ||
    job.planOutput?.toLowerCase().includes('destroy') ||
    job.planOutput?.toLowerCase().includes('delete');

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header and Breadcrumbs */}
      <div>
        <div className="text-sm font-medium text-gray-500">
          <Link href="/tools" className="hover:text-indigo-600">Tools</Link> / <span className="text-gray-900">AWS Cloud Governance</span>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">
          AWS Resource Job Review
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Inspect, audit, and approve agentic infrastructure mutations.
        </p>
      </div>

      {/* Main Review Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Metadata & Controls */}
        <div className="space-y-6 lg:col-span-1">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Job Metadata</h2>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              <div>
                <span className="block font-medium text-gray-500">Job ID</span>
                <span className="font-mono text-gray-900 break-all">{job.id}</span>
              </div>
              <div>
                <span className="block font-medium text-gray-500">Developer (Agent Owner)</span>
                <span className="text-gray-900 font-semibold">{job.developer}</span>
              </div>
              <div>
                <span className="block font-medium text-gray-500">Resource Type</span>
                <span className="inline-flex rounded-md bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold font-mono text-indigo-700">
                  {job.resourceType}
                </span>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="block font-medium text-gray-500">Action</span>
                  <span className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                    job.actionType === 'DELETE' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {job.actionType}
                  </span>
                </div>
                <div className="flex-1">
                  <span className="block font-medium text-gray-500">Status</span>
                  <span className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-bold ${
                    job.status === 'PENDING_APPROVAL' ? 'bg-yellow-100 text-yellow-800 animate-pulse' :
                    job.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                    job.status === 'SUCCEEDED' ? 'bg-indigo-100 text-indigo-800' :
                    job.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {job.status}
                  </span>
                </div>
              </div>
              <div>
                <span className="block font-medium text-gray-500">Created At</span>
                <span className="text-gray-900">{new Date(job.createdAt).toLocaleString()}</span>
              </div>
              {job.approver && (
                <div>
                  <span className="block font-medium text-gray-500">Authorized By</span>
                  <span className="text-gray-900 font-semibold">{job.approver}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Box */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-md font-bold text-gray-900">Governance Controls</h3>
            {message && (
              <div className="rounded-md bg-green-50 p-4 border border-green-200 text-sm font-medium text-green-800">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 p-4 border border-red-200 text-sm font-medium text-red-800">
                {error}
              </div>
            )}

            {job.status === 'PENDING_APPROVAL' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Review the plan output on the right. Once approved, the developer agent will be authorized to apply this change.
                </p>
                <div className="flex gap-3">
                  <button
                    disabled={actionLoading}
                    onClick={() => { void handleAction('approve'); }}
                    className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50 transition"
                  >
                    {actionLoading ? 'Processing...' : 'Approve Plan'}
                  </button>
                  <button
                    disabled={actionLoading}
                    onClick={() => { void handleAction('reject'); }}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 transition"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-gray-50 p-4 border border-gray-100 text-center text-sm text-gray-600">
                This job is in <span className="font-bold text-gray-900">{job.status}</span> state. No further approvals are pending.
              </div>
            )}

            {/* Optional Slack integration banner */}
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 text-xs text-indigo-800">
              <span className="font-bold block">Slack Integration</span>
              Slack integration configured. Approved jobs notify `#ops-approvals` channel.
            </div>
          </div>
        </div>

        {/* Right Column: Code & Plan Execution details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Destructive Warning Alert */}
          {isDestructive && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-6 flex items-start space-x-3">
              <div className="flex-shrink-0 text-red-500 text-2xl mt-0.5">⚠️</div>
              <div>
                <h3 className="text-lg font-bold text-red-800">Destructive Actions Detected</h3>
                <p className="mt-1 text-sm text-red-700">
                  This execution plan contains operations that will **destroy, delete, or replace** active resources. Please proceed with extreme caution and verify that all data backup strategies are in place.
                </p>
              </div>
            </div>
          )}

          {/* Terraform Code Card */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Terraform Source Configuration</h2>
            </div>
            <div className="bg-gray-900 p-6 font-mono text-xs text-gray-300 overflow-x-auto max-h-[300px] overflow-y-auto">
              <pre>{job.parameters.terraformCode}</pre>
            </div>
          </div>

          {/* Terraform Plan Output Card */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Terraform Plan Execution Output</h2>
            </div>
            <div className="bg-slate-950 p-6 font-mono text-xs text-green-400 overflow-x-auto max-h-[400px] overflow-y-auto border-t border-slate-800 shadow-inner">
              <pre>{job.planOutput || 'No plan output generated.'}</pre>
            </div>
          </div>

          {/* Error Details Card (if applicable) */}
          {job.error && (
            <div className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
              <div className="border-b border-red-200 bg-red-50 px-6 py-4">
                <h2 className="text-lg font-semibold text-red-800">Apply Execution Error</h2>
              </div>
              <div className="bg-red-950 p-6 font-mono text-xs text-red-400 overflow-x-auto">
                <pre>{job.error}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

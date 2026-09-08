import Link from 'next/link';
import type { JSX } from 'react';

export const dynamic = 'force-dynamic';

export default function HomePage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">One Off Apparel</h1>
        <p className="mt-1 text-sm text-muted">
          Internal tooling for order intake, estimation, and production planning.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/orders"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <div className="text-lg font-semibold text-ink">Order estimator</div>
          <div className="mt-1 text-sm text-muted">
            Upload an order CSV to extract garments, decorations, and finishing lines and validate
            them for time estimation.
          </div>
        </Link>
      </div>
    </div>
  );
}

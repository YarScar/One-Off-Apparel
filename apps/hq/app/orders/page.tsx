import type { JSX } from 'react';
import { OrderUpload } from './OrderUpload';

export const dynamic = 'force-dynamic';

export default function OrdersPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Order estimator</h1>
        <p className="mt-1 text-sm text-muted">
          Upload an order CSV. The parser extracts garment, decoration, and finishing lines,
          classifies each garment (Thin/Poly/Bulky), and flags anything missing that the estimator
          would need.
        </p>
      </div>
      <OrderUpload />
    </div>
  );
}

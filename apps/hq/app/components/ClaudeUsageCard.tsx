'use client';

import { useState } from 'react';
import { fmtInt } from '../lib/format';

export interface ClaudeUsageBreakdownRow {
  productType: string | null;
  model: string | null;
  requestCount: string;
  promptTokens: string | null;
  completionTokens: string | null;
  costUsd: string | null;
}

export function ClaudeUsageCard({
  userEmail,
  requestCount,
  totalTokens,
  costUsd,
  breakdown,
}: {
  userEmail: string | null;
  requestCount: string;
  totalTokens: string | null;
  costUsd: string | null;
  breakdown: ClaudeUsageBreakdownRow[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const total = parseInt(totalTokens ?? '0', 10) || 0;
  const cost = Number(costUsd ?? '0') || 0;
  const canExpand = breakdown.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); }}
        disabled={!canExpand}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 disabled:hover:bg-white"
      >
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${userEmail ? 'text-ink' : 'italic text-muted'}`}>
            {userEmail ?? '— unknown —'}
          </div>
          {breakdown.length > 1 && (
            <div className="mt-0.5 text-xs text-muted">
              across {breakdown.length} surface/model combinations
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-5 text-right text-sm tabular-nums">
          <div>
            <div className="text-xs text-muted">Requests</div>
            <div className="text-ink">{fmtInt(requestCount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Total tokens</div>
            <div className="font-medium text-ink">{total > 0 ? total.toLocaleString() : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Cost</div>
            <div className="text-ink">${cost.toFixed(2)}</div>
          </div>
          {canExpand && (
            <svg
              className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
      </button>

      {open && canExpand && (
        <div className="overflow-x-auto border-t bg-slate-50 px-4 py-3">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-4">Surface</th>
                <th className="py-1 pr-4">Model</th>
                <th className="py-1 pr-4 text-right">Requests</th>
                <th className="py-1 pr-4 text-right">Prompt</th>
                <th className="py-1 pr-4 text-right">Completion</th>
                <th className="py-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b, i) => (
                <tr key={`${b.productType ?? ''}-${b.model ?? ''}-${String(i)}`} className="border-t border-slate-200">
                  <td className="py-1.5 pr-4 text-ink">{b.productType ?? '—'}</td>
                  <td className="py-1.5 pr-4 font-mono text-ink">{b.model ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-muted">{fmtInt(b.requestCount)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-muted">{fmtInt(b.promptTokens)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-muted">{fmtInt(b.completionTokens)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">
                    ${(Number(b.costUsd ?? '0') || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

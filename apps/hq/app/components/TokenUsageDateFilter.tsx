'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const PRESETS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
] as const;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function TokenUsageDateFilter(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const fromParam = searchParams.get('tokens_from');
  const toParam = searchParams.get('tokens_to');
  const presetParam = searchParams.get('tokens_preset') ?? '30d';

  const applyPreset = (id: string): void => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tokens_preset', id);
    params.delete('tokens_from');
    params.delete('tokens_to');
    startTransition(() => {
      router.push(`/?${params.toString()}#token-usage`);
    });
  };

  const applyCustom = (from: string, to: string): void => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tokens_preset', 'custom');
    if (from) params.set('tokens_from', from);
    else params.delete('tokens_from');
    if (to) params.set('tokens_to', to);
    else params.delete('tokens_to');
    startTransition(() => {
      router.push(`/?${params.toString()}#token-usage`);
    });
  };

  const today = isoDate(new Date());
  const defaultFrom = fromParam ?? isoDate(new Date(Date.now() - 29 * 86_400_000));
  const defaultTo = toParam ?? today;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {PRESETS.map((p) => {
          const active = presetParam === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { applyPreset(p.id); }}
              disabled={isPending}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-muted hover:bg-slate-100 hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <form
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fromInput = form.elements.namedItem('from') as HTMLInputElement;
          const toInput = form.elements.namedItem('to') as HTMLInputElement;
          applyCustom(fromInput.value, toInput.value);
        }}
      >
        <input
          name="from"
          type="date"
          defaultValue={defaultFrom}
          max={today}
          className="rounded px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <span className="text-xs text-muted">→</span>
        <input
          name="to"
          type="date"
          defaultValue={defaultTo}
          max={today}
          className="rounded px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <button
          type="submit"
          disabled={isPending}
          className="ml-1 rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Apply
        </button>
      </form>
      {isPending && <span className="text-xs text-muted">Loading…</span>}
    </div>
  );
}

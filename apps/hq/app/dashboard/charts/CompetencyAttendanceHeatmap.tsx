'use client';

export interface HeatmapCell {
  competency: string;
  bucket: string;
  avg_growth: number | null;
  student_count: number;
}

interface Props {
  data: HeatmapCell[];
}

const BUCKETS = ['<70%', '70–80%', '80–90%', '90%+'] as const;

function colorFor(value: number | null, min: number, max: number): string {
  if (value == null) return '#f1f5f9'; // slate-100 for empty
  if (max === min) return '#cbd5e1';
  const t = (value - min) / (max - min); // 0..1
  // Diverging-ish: low → red (#fee2e2), mid → yellow (#fef9c3), high → green (#bbf7d0 → #16a34a)
  if (value < 0) {
    // negative growth — red gradient
    const intensity = Math.min(1, Math.abs(value) / Math.max(0.5, Math.abs(min)));
    const lightness = 95 - intensity * 25; // 95 → 70
    return `hsl(0, 80%, ${String(lightness)}%)`;
  }
  // positive growth — green gradient
  const lightness = 92 - t * 35; // 92 → 57
  return `hsl(142, 70%, ${String(lightness)}%)`;
}

function textColorFor(value: number | null): string {
  if (value == null) return '#94a3b8';
  if (Math.abs(value) > 2) return '#ffffff';
  return '#0f172a';
}

export function CompetencyAttendanceHeatmap({ data }: Props): JSX.Element {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No data to chart (need overlapping attendance + competency records).</p>;
  }

  const competencies = [...new Set(data.map((d) => d.competency))].sort();

  // Build a lookup: competency → bucket → cell
  const lookup = new Map<string, Map<string, HeatmapCell>>();
  for (const cell of data) {
    const existing = lookup.get(cell.competency);
    if (existing) existing.set(cell.bucket, cell);
    else lookup.set(cell.competency, new Map([[cell.bucket, cell]]));
  }

  const values = data.map((d) => d.avg_growth).filter((v): v is number => v != null);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted">Competency</th>
              {BUCKETS.map((b) => (
                <th key={b} className="px-3 py-2 text-center text-xs font-medium text-muted min-w-[110px]">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competencies.map((c) => (
              <tr key={c}>
                <td className="px-3 py-2 text-sm font-medium text-ink whitespace-nowrap pr-6">{c}</td>
                {BUCKETS.map((b) => {
                  const cell = lookup.get(c)?.get(b);
                  const v = cell?.avg_growth ?? null;
                  const count = cell?.student_count ?? 0;
                  return (
                    <td key={b} className="p-1">
                      <div
                        className="rounded-md px-3 py-3 text-center"
                        style={{
                          backgroundColor: colorFor(v, min, max),
                          color: textColorFor(v),
                        }}
                        title={
                          v == null
                            ? 'No data'
                            : `Avg growth: ${String(v)} · ${String(count)} student${count === 1 ? '' : 's'}`
                        }
                      >
                        <div className="text-base font-semibold">
                          {v == null ? '—' : v.toFixed(2)}
                        </div>
                        <div className="text-[10px] opacity-75">
                          {count > 0 ? `n=${String(count)}` : ''}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Lower growth</span>
        <div className="flex h-3 w-32 overflow-hidden rounded">
          <div className="flex-1" style={{ background: 'hsl(0, 80%, 75%)' }} />
          <div className="flex-1" style={{ background: 'hsl(0, 80%, 90%)' }} />
          <div className="flex-1" style={{ background: 'hsl(142, 70%, 88%)' }} />
          <div className="flex-1" style={{ background: 'hsl(142, 70%, 62%)' }} />
        </div>
        <span>Higher growth</span>
      </div>
    </div>
  );
}

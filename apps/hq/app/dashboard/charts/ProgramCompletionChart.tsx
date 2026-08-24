'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ProgramCompletionPoint {
  program_year: string;
  Foundations: number | null;
  '101': number | null;
  Lightspeed: number | null;
  LiftOff: number | null;
}

const COLORS = {
  Foundations: '#2563eb', // blue-600
  '101': '#16a34a', // green-600
  Lightspeed: '#d97706', // amber-600
  LiftOff: '#9333ea', // purple-600
} as const;

interface Props {
  data: ProgramCompletionPoint[];
}

export function ProgramCompletionChart({ data }: Props): JSX.Element {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No completion data to chart.</p>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="program_year" stroke="#64748b" fontSize={12} />
          <YAxis
            stroke="#64748b"
            fontSize={12}
            domain={[0, 100]}
            tickFormatter={(v) => `${String(v)}%`}
          />
          <Tooltip
            // Narrowed rather than String()-ed: an object reached this as `[object Object]%`.
            formatter={(value: unknown) =>
              typeof value === 'number' || typeof value === 'string' ? `${String(value)}%` : '—'
            }
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <Bar dataKey="Foundations" fill={COLORS.Foundations} radius={[4, 4, 0, 0]} />
          <Bar dataKey="101" fill={COLORS['101']} radius={[4, 4, 0, 0]} />
          <Bar dataKey="Lightspeed" fill={COLORS.Lightspeed} radius={[4, 4, 0, 0]} />
          <Bar dataKey="LiftOff" fill={COLORS.LiftOff} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

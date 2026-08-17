'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface AttendanceTrendPoint {
  month: string;
  Cohort1?: number;
  Cohort2?: number;
  Cohort3?: number;
}

const COLORS = {
  Cohort1: '#2563eb',
  Cohort2: '#16a34a',
  Cohort3: '#d97706',
} as const;

interface Props {
  data: AttendanceTrendPoint[];
}

export function AttendanceTrendChart({ data }: Props): JSX.Element {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No attendance data to chart.</p>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
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
          <ReferenceLine
            y={80}
            stroke="#dc2626"
            strokeDasharray="4 4"
            label={{ value: '80% threshold', fill: '#dc2626', fontSize: 10, position: 'insideTopRight' }}
          />
          <Line
            type="monotone"
            dataKey="Cohort1"
            stroke={COLORS.Cohort1}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="Cohort2"
            stroke={COLORS.Cohort2}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="Cohort3"
            stroke={COLORS.Cohort3}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

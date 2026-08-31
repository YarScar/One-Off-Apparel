'use client';

import { useState } from 'react';
import { ClaudeUsageCard, type ClaudeUsageBreakdownRow } from './ClaudeUsageCard';

export interface ClaudeUsagePerUser {
  userEmail: string | null;
  requestCount: string;
  totalTokens: string | null;
  costUsd: string | null;
  breakdown: ClaudeUsageBreakdownRow[];
}

const COLLAPSED_COUNT = 8;

export function ClaudeUsageList({ users }: { users: ClaudeUsagePerUser[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = users.length > COLLAPSED_COUNT;
  const visible = expanded || !canCollapse ? users : users.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-2">
      {canCollapse && expanded && (
        <button
          type="button"
          onClick={() => { setExpanded(false); }}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-2 text-xs font-medium text-muted hover:bg-slate-50"
        >
          Show fewer
        </button>
      )}
      {visible.map((u) => (
        <ClaudeUsageCard
          key={u.userEmail ?? ''}
          userEmail={u.userEmail}
          requestCount={u.requestCount}
          totalTokens={u.totalTokens}
          costUsd={u.costUsd}
          breakdown={u.breakdown}
        />
      ))}
      {canCollapse && (
        <button
          type="button"
          onClick={() => { setExpanded((v) => !v); }}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-2 text-xs font-medium text-muted hover:bg-slate-50"
        >
          {expanded
            ? 'Show fewer'
            : `Show all ${String(users.length)} people (${String(users.length - COLLAPSED_COUNT)} more)`}
        </button>
      )}
    </div>
  );
}

---
name: implement-connector
description: Implement or modify a data connector in connectors/* for lp-internal-ai. Covers the sync() + runSync() wrapper shape, the noop-when-key-missing pattern, and declaring tables for the 5% integrity guard. Use when writing a new connector or changing an existing sync. The critical never-TRUNCATE sync safety rule lives in the root CLAUDE.md and applies regardless.
---

# Implementing a connector

All connectors follow the same pattern:

```ts
export async function sync(): Promise<SyncRunRecord> {
  return runSync('connector-name', async () => {
    const env = await loadEnv();
    if (!env.REQUIRED_KEY) return { status: 'noop', notes: 'key not set' };
    // ... upsert records into Prisma ...
    return { status: 'ok', recordsUpserted: n };
  });
}
```

The `runSync` wrapper creates the `sync_runs` row, captures errors, records duration, and runs a **5% integrity guard** — if any declared table drops more than 5% in row count during a sync, an `INTEGRITY WARNING` is appended to the `sync_runs.notes` field.

Pass the `tables` option to declare which tables a connector writes to:
```ts
return runSync('connector-name', async () => { ... }, {
  tables: ['students', 'student_phase_outcomes'],
});
```

The **critical sync safety rule** (never `deleteMany({})` / `TRUNCATE`; upsert by stable
`sourceId`, then delete only unseen rows) is stated in the root `CLAUDE.md` — follow it here.
See `connectors/google-sheets/src/sync-employment.ts` as the reference implementation.

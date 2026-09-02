import { sync } from './index.js';

const result = await sync();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

// `runSync` records a failure in `sync_runs` and returns normally, so without this
// the process exits 0 and a failed one-off Fargate task reports success — nothing
// for ECS, EventBridge or a human to notice. The row is the detail; the exit code is
// the signal.
if (result.status === 'error') process.exitCode = 1;

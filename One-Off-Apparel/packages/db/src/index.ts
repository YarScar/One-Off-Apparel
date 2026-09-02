export { prisma } from './client.js';

export { PrismaClient, Prisma } from '../generated/prisma/index.js';
export type { StudentEmployment } from '../generated/prisma/index.js';

export { runSync } from './sync-runs.js';
export type { SyncRunResult, SyncRunRecord, SyncRunOptions } from './sync-runs.js';

import { PrismaClient } from '../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { loadEnv } from '@lp-ai/lib-config';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

let prismaClient: PrismaClient;

if (globalForPrisma.prisma) {
  prismaClient = globalForPrisma.prisma;
} else {
  const env = await loadEnv();
  const dbUrl = env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({
    adapter,
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

  if (process.env['NODE_ENV'] !== 'production') {
    globalForPrisma.prisma = prismaClient;
    globalForPrisma.pool = pool;
  }
}

export const prisma = prismaClient;

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'connectors/**/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    testTimeout: 15000,
    setupFiles: ['./test/setup-env.ts'],
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
  },
});

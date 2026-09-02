// Mirror of apps/mcp-server/src/permissions.ts ROLES. Keep in sync.
// A shared package would be cleaner; deferred.
export const ROLES = [
  'pending',
  'program_staff',
  'development',
  'sales',
  'finance',
  'software_dev',
  'leadership',
  'admin',
] as const;

export type Role = (typeof ROLES)[number];

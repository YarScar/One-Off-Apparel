/**
 * MCP role + tool-level ACL registry (Phase 23).
 *
 * The role list is fixed in code (8 roles). The tool → roles mapping lives in
 * the `tool_permissions` table and is editable from HQ /admin. The MCP server
 * caches it in memory for CACHE_TTL_MS to keep tool-call latency low; UI
 * changes therefore take effect within ~60 seconds.
 *
 * The original static map shipped in PR #16 has been moved to the DB seed
 * migration `20260610180000_add_tool_permissions`. If the seed migration ever
 * needs to run again, the values there are the canonical defaults.
 */

import { prisma } from '@lp-ai/lib-db';

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

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  rolesByTool: Map<string, Set<string>>;
  loadedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

async function loadFromDb(): Promise<CacheEntry> {
  const rows = await prisma.toolPermission.findMany();
  const rolesByTool = new Map<string, Set<string>>();
  for (const r of rows) rolesByTool.set(r.toolName, new Set(r.allowedRoles));
  return { rolesByTool, loadedAt: Date.now() };
}

async function getCached(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  // Coalesce concurrent refreshes
  if (!inflight) {
    inflight = loadFromDb().then((c) => {
      cache = c;
      inflight = null;
      return c;
    });
  }
  return inflight;
}

/**
 * Test-only override: lets unit tests stub the registry without touching the DB.
 * Production code MUST NOT call this.
 */
export function __setPermissionsForTesting(map: Record<string, readonly string[]>): void {
  const rolesByTool = new Map<string, Set<string>>();
  for (const [tool, roles] of Object.entries(map)) {
    rolesByTool.set(tool, new Set(roles));
  }
  cache = { rolesByTool, loadedAt: Date.now() };
}

export function __clearPermissionsCacheForTesting(): void {
  cache = null;
  inflight = null;
}

export async function canCallTool(
  toolName: string,
  userRoles: readonly string[],
): Promise<boolean> {
  if (userRoles.length === 0) return false;
  const c = await getCached();
  const allowed = c.rolesByTool.get(toolName);
  if (!allowed) return false;
  return userRoles.some((r) => allowed.has(r));
}

export function permissionDeniedError(toolName: string): {
  code: 'permission_denied';
  message: string;
} {
  return {
    code: 'permission_denied',
    message: `Tool '${toolName}' is not permitted for your role. Contact an LP Internal AI admin.`,
  };
}

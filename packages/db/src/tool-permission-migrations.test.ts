import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `ON CONFLICT ("tool_name") DO NOTHING` makes a permission insert a silent no-op whenever a row
 * for that tool already exists. The declared roles never land, the migration is still recorded as
 * applied, and the registry fails closed (`apps/mcp-server/src/permissions.ts`), so the symptom is
 * `permission_denied` for a caller the migration says is allowed — with no signal anywhere. That is
 * the defect behind work packages #204 and #262; this test exists so a new migration cannot
 * reintroduce it. Work package #294.
 *
 * The migrations below predate the rule and are exempt **by name**. They are not corrected in place
 * because Prisma checksums applied migrations — editing one breaks `migrate deploy` and
 * `migrate status` on every environment that already ran it. Diverged rows those files left behind
 * are fixed by a new migration, or on HQ `/admin`.
 */
const LEGACY_DO_NOTHING = [
  '20260610190000_add_query_postsecondary_permission',
  '20260611000000_add_query_employment_permission',
  '20260616000000_add_skill_tool_permissions',
  '20260729000000_add_grant_tool_permissions',
  '20260806000100_add_find_grant_documents_permission',
  '20260812000000_add_grant_sourcing_evaluation_permission',
] as const;

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);

function readMigration(name: string): string | null {
  const sqlPath = path.join(MIGRATIONS_DIR, name, 'migration.sql');
  return existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : null;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Strip `--` line comments before matching.
 *
 * Without this, a migration that *explains* the `ON CONFLICT ... DO NOTHING` defect in its
 * header — which the correcting migrations are exactly the ones that need to — is reported
 * as committing it. The check is about executable SQL, so the prose is removed first.
 * Block comments are not stripped because no migration here uses them; a false positive
 * from one would still fail loudly rather than pass silently.
 */
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const writesToolPermissions = (sql: string): boolean =>
  /INSERT\s+INTO\s+"?tool_permissions"?/i.test(stripComments(sql));

const usesDoNothing = (sql: string): boolean =>
  /ON\s+CONFLICT[^;]*?DO\s+NOTHING/is.test(stripComments(sql));

describe('tool_permissions migrations', () => {
  it('finds the migrations directory and at least one permission migration', () => {
    const writers = migrationNames().filter((name) => {
      const sql = readMigration(name);
      return sql !== null && writesToolPermissions(sql);
    });
    // Guards against the whole suite passing vacuously on a bad path or a moved directory.
    // One more than the exemption list: 20260610180000_add_tool_permissions creates the table and
    // seeds it in the same file, so it needs no conflict clause at all and is not exempted.
    expect(writers.length).toBeGreaterThanOrEqual(LEGACY_DO_NOTHING.length + 1);
  });

  it('no new migration writes tool_permissions with DO NOTHING', () => {
    const exempt = new Set<string>(LEGACY_DO_NOTHING);
    const offenders = migrationNames().filter((name) => {
      if (exempt.has(name)) return false;
      const sql = readMigration(name);
      return sql !== null && writesToolPermissions(sql) && usesDoNothing(sql);
    });

    expect(
      offenders,
      'Use `ON CONFLICT ("tool_name") DO UPDATE SET "allowed_roles" = EXCLUDED."allowed_roles", ' +
        '"category" = EXCLUDED."category", "description" = EXCLUDED."description", ' +
        '"updated_at" = NOW()`. `DO NOTHING` cannot correct or widen an existing row — see root ' +
        'CLAUDE.md step 6 of "Adding a new MCP tool".',
    ).toEqual([]);
  });

  it('reads executable SQL rather than prose, and still catches a real DO NOTHING', () => {
    // The correcting migration for #204 documents the defect it supersedes in its header,
    // so it contains the words `ON CONFLICT ... DO NOTHING` in a comment while its statement
    // uses `DO UPDATE`. Before comments were stripped, that alone made it an offender —
    // which would have pushed the next author to delete the explanation rather than the bug.
    const corrector = readMigration('20260818000000_reconcile_grant_sourcing_evaluation_permission');
    expect(corrector).not.toBeNull();
    expect(writesToolPermissions(corrector as string)).toBe(true);
    expect(usesDoNothing(corrector as string)).toBe(false);

    // And the stripping must not have neutered the check itself.
    expect(
      usesDoNothing('-- fine\nINSERT INTO "tool_permissions" VALUES (1) ON CONFLICT ("tool_name") DO NOTHING;'),
    ).toBe(true);
  });

  it('every exempted migration still exists and still needs its exemption', () => {
    for (const name of LEGACY_DO_NOTHING) {
      const sql = readMigration(name);
      // A stale exemption is worse than none: it would silently cover a file created later
      // under the same name.
      expect(sql, `exempted migration ${name} no longer exists — drop it from the list`).not.toBeNull();
      expect(
        usesDoNothing(sql as string),
        `${name} no longer uses DO NOTHING — drop it from the exemption list`,
      ).toBe(true);
    }
  });
});

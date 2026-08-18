---
name: add-mcp-tool
description: Add a new tool to the lp-internal-ai MCP server. Covers the registerTool call and required annotations, wiring into make-server.ts, updating the tool-count test, and the tool_permissions migration + admin-page category step needed before the tool is reachable by any role. Use whenever adding, renaming, or removing an MCP tool in apps/mcp-server.
---

# Adding a new MCP tool

1. Create `apps/mcp-server/src/tools/<tool-name>.ts` — export `registerXxx(server: McpServer): void`
2. Inside, call `server.registerTool(NAME, { description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) => runTool(NAME, input, async () => { ... }))` — annotations are required on all tools to avoid per-call approval prompts in Claude
3. Use `toolError(code, message)` or `notImplemented(NAME)` for structured error returns
4. Import and call `registerXxx(server)` in `apps/mcp-server/src/make-server.ts`
5. Update the count in `apps/mcp-server/src/__tests__/tools.test.ts` and add the tool name to the expected list
6. **Add a `tool_permissions` migration** so the tool is accessible to users. Without this, the tool will be blocked for all roles. Create a migration at `packages/db/prisma/migrations/<timestamp>_add_<name>_permission/migration.sql`:
   ```sql
   INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
   VALUES (
     '<tool_name>',
     ARRAY['<role1>', '<role2>', 'leadership', 'admin'],
     '<category>',
     '<human-readable description>',
     NOW()
   )
   ON CONFLICT ("tool_name") DO UPDATE SET
     "allowed_roles" = EXCLUDED."allowed_roles",
     "category"      = EXCLUDED."category",
     "description"   = EXCLUDED."description",
     "updated_at"    = NOW();
   ```
   Categories: `students`, `donor_finance`, `search`, `skills`, `future`. Roles: `pending`, `program_staff`, `development`, `sales`, `finance`, `software_dev`, `leadership`, `admin`. The tool will appear on the HQ `/admin` page where admins can adjust role access without code changes.

   **`DO UPDATE`, never `DO NOTHING`.** `DO NOTHING` makes the insert a silent no-op whenever a row
   for that tool already exists, so the migration's declared roles are never written and the two
   never reconcile — the registry fails closed (`apps/mcp-server/src/permissions.ts:87`), so the
   symptom is `permission_denied` for a caller the migration says is allowed, with no signal
   anywhere. That is the defect behind #204 and #262. `DO UPDATE` costs one thing, knowingly: it
   overwrites a role change an admin made on HQ `/admin` in the window between the merge and the
   deploy that applies the migration. A migration applies exactly once, so an admin edit made after
   it applied is never touched. `packages/db/src/tool-permission-migrations.test.ts` fails the build
   on a new `DO NOTHING`; the six pre-existing `DO NOTHING` migrations are exempt by name, because Prisma
   checksums applied migrations and editing one breaks `migrate deploy` everywhere it already ran.
7. **If using a new category**, add it to `CATEGORY_ORDER` and `CATEGORY_LABELS` in `apps/hq/app/admin/PermissionsMatrix.tsx`. Existing categories (`students`, `donor_finance`, `search`, `skills`, `future`, `other`) don't need this step — only new ones. Without this, tools in the new category won't render on the admin page.
8. Apply the migration locally (`pnpm db:migrate`) and to production (via ECS one-off task or bastion — RDS is not publicly accessible)

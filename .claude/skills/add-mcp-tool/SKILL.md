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
   ON CONFLICT ("tool_name") DO NOTHING;
   ```
   Categories: `students`, `donor_finance`, `search`, `skills`, `future`. Roles: `pending`, `program_staff`, `development`, `sales`, `finance`, `software_dev`, `leadership`, `admin`. The tool will appear on the HQ `/admin` page where admins can adjust role access without code changes.
7. **If using a new category**, add it to `CATEGORY_ORDER` and `CATEGORY_LABELS` in `apps/hq/app/admin/PermissionsMatrix.tsx`. Existing categories (`students`, `donor_finance`, `search`, `skills`, `future`, `other`) don't need this step — only new ones. Without this, tools in the new category won't render on the admin page.
8. Apply the migration locally (`pnpm db:migrate`) and to production (via ECS one-off task or bastion — RDS is not publicly accessible)

-- WP #321: register the new grant_verify_figure tool in the editable ACL table.
--
-- The registry fails closed (apps/mcp-server/src/permissions.ts): no row means denied to everyone,
-- including admin. Same role scope as the other deterministic grants tools (leadership, admin) — see
-- 20260729000000_add_grant_tool_permissions. `DO UPDATE`, per root CLAUDE.md's add-mcp-tool rule, not
-- `DO NOTHING` — this makes the row self-healing if it's ever re-run after an admin edit diverges.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'grant_verify_figure',
  ARRAY['leadership','admin'],
  'grants',
  'Verify a drafted figure answer against the live query_* result the caller sourced it from',
  NOW()
)
ON CONFLICT ("tool_name") DO UPDATE SET
  "allowed_roles" = EXCLUDED."allowed_roles",
  "category"      = EXCLUDED."category",
  "description"   = EXCLUDED."description",
  "updated_at"    = NOW();

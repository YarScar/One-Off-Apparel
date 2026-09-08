-- Register `find_grant_documents` in the editable ACL table.
--
-- The registry fails closed: apps/mcp-server/src/permissions.ts denies any tool name it does not
-- find in this table, for every user including admin. So this migration is what makes the tool
-- reachable at all, not what restricts it.
--
-- Roles are wider than the deterministic grant tools (`grant_match_question` et al., which are
-- leadership+admin only). This one returns a catalog listing and no document text — filenames,
-- funders, years, and Drive IDs. Reading the documents themselves still requires Drive access,
-- which is enforced by Google, not by us. Development and program staff need to find past
-- applications as a routine part of their work, so they are included here.
--
-- Category 'grants' matches the existing grant tool rows, so this appears in the same group on
-- the HQ /admin page. Roles are editable there without a code change.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'find_grant_documents',
  ARRAY['program_staff','development','finance','leadership','admin'],
  'grants',
  'Find grant documents in the Drive Grants tree by funder, year, and document kind. Returns a catalog listing with Drive file IDs for fetching content; excludes archive-only and externally authored material by default.',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;

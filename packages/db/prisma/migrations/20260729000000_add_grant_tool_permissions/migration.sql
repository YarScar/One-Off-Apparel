-- Register the 3 grant writing tools in the editable ACL table.
--
-- The registry fails closed: apps/mcp-server/src/permissions.ts denies any tool name it does not
-- find in this table, for every user including admin. So this migration is what makes the tools
-- reachable at all, not what restricts them.
--
-- Roles follow the recommendation in packages/grants/admin/PROPOSAL.md section 8.2 (leadership and
-- admin). That decision is still open at the time of writing; roles are editable from the HQ
-- /admin page without a code change, so this is a starting point rather than a commitment.
--
-- Note the existing 'skill_grant_writing' row is broader (development, finance, leadership, admin).
-- These three are the deterministic tools underneath that skill, and they are deliberately tighter
-- until the layer has been piloted.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES
  (
    'grant_match_question',
    ARRAY['leadership','admin'],
    'grants',
    'Match a funder application question to a canonical question in the grant question bank',
    NOW()
  ),
  (
    'grant_build_draft',
    ARRAY['leadership','admin'],
    'grants',
    'Turn a captured funder form into a draft answer package plus a figure verification work order',
    NOW()
  ),
  (
    'grant_resize_answer',
    ARRAY['leadership','admin'],
    'grants',
    'Measure an answer against a funder length limit and return resize instructions for the caller',
    NOW()
  )
ON CONFLICT ("tool_name") DO NOTHING;

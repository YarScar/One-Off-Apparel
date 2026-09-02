-- Register the query_employment tool in the editable ACL table.
-- Defaults match the rest of the `students` category: program_staff,
-- leadership, admin.
INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'query_employment',
  ARRAY['program_staff','leadership','admin'],
  'students',
  'Student employment data — jobs, earnings, exit codes, active-job tracking',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;

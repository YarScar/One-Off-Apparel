-- Register the new query_postsecondary tool in the editable ACL table.
-- Defaults match the rest of the `students` category: program_staff,
-- leadership, admin. Admin can re-assign later via HQ /admin.
INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'query_postsecondary',
  ARRAY['program_staff','leadership','admin'],
  'students',
  'Postsecondary enrollment + graduation data from National Student Clearinghouse',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;

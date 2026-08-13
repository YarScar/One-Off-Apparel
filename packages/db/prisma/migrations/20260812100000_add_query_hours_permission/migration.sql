-- Register the query_hours tool in the editable ACL table.
-- Hours are cross-project ops data visible to every non-pending role.
INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'query_hours',
  ARRAY['program_staff','development','sales','finance','software_dev','leadership','admin'],
  'other',
  'Team hour logs across engagements (North10AI, LP Internal AI) — totals, per-person/per-project/per-day breakdowns, raw entries',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;

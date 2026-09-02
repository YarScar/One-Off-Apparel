-- Register the new skill_grant_sourcing_evaluation tool in the editable ACL table.
-- Same role scope as skill_grant_prospecting — both are development/fundraising workflows.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'skill_grant_sourcing_evaluation',
  ARRAY['development','leadership','admin'],
  'skills',
  'Skill: source and score grant opportunities against a fixed weighted rubric',
  NOW()
)
ON CONFLICT ("tool_name") DO NOTHING;

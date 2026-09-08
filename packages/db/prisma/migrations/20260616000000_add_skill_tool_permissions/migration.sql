-- Register the 4 skill tools in the editable ACL table.
-- Skills are high-level workflows that call multiple data tools internally,
-- so they need broad role access. Leadership and admin always; other roles
-- based on the skill's domain.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES
  (
    'skill_grant_writing',
    ARRAY['development','finance','leadership','admin'],
    'skills',
    'Skill: assemble grant proposals or funder reports from live org data',
    NOW()
  ),
  (
    'skill_grant_prospecting',
    ARRAY['development','leadership','admin'],
    'skills',
    'Skill: find funders whose giving history matches the organization',
    NOW()
  ),
  (
    'skill_finance_audit',
    ARRAY['finance','leadership','admin'],
    'skills',
    'Skill: generate multi-view financial reports and audit-ready documentation',
    NOW()
  ),
  (
    'skill_board_reporting',
    ARRAY['finance','development','leadership','admin'],
    'skills',
    'Skill: generate board packets, KPI dashboards, and presentation-ready reports',
    NOW()
  )
ON CONFLICT ("tool_name") DO NOTHING;

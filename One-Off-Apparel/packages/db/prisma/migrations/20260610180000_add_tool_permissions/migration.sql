-- CreateTable
CREATE TABLE "tool_permissions" (
    "tool_name" TEXT NOT NULL,
    "allowed_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_permissions_pkey" PRIMARY KEY ("tool_name")
);

-- Seed the table from the original static registry in
-- apps/mcp-server/src/permissions.ts. The MCP server caches this for ~60s.
INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at") VALUES
  ('get_student_info',        ARRAY['program_staff','leadership','admin'],                                 'students',       'Detailed profile for a single student',                NOW()),
  ('query_students',          ARRAY['program_staff','leadership','admin'],                                 'students',       'Filtered student lists',                               NOW()),
  ('query_outcomes',          ARRAY['program_staff','leadership','admin'],                                 'students',       'Phase outcomes and graduation tracking',               NOW()),
  ('query_enrollment',        ARRAY['program_staff','leadership','admin'],                                 'students',       'Enrollment snapshots over time',                       NOW()),
  ('query_certifications',    ARRAY['program_staff','leadership','admin'],                                 'students',       'Certification attempts and passes',                    NOW()),
  ('query_competency',        ARRAY['program_staff','leadership','admin'],                                 'students',       'Competency scores per phase',                          NOW()),
  ('query_attendance',        ARRAY['program_staff','leadership','admin'],                                 'students',       'Daily attendance per cohort',                          NOW()),

  ('query_donors',            ARRAY['development','sales','finance','leadership','admin'],                 'donor_finance',  'Donor contacts and gift records',                      NOW()),
  ('query_finances',          ARRAY['finance','leadership','admin'],                                       'donor_finance',  'Finance line items and accounts',                      NOW()),
  ('get_finance_brief',       ARRAY['finance','leadership','admin'],                                       'donor_finance',  'High-level finance summary',                           NOW()),
  ('get_entity_brief',        ARRAY['development','sales','leadership','admin'],                           'donor_finance',  'Brief on a donor or business contact',                 NOW()),

  ('search_by_person',        ARRAY['program_staff','development','leadership','admin'],                   'search',         'Cross-source search keyed on a person',                NOW()),
  ('search_conversations',    ARRAY['program_staff','software_dev','leadership','admin'],                  'search',         'Search Slack/Roam conversations',                      NOW()),
  ('search_documents',        ARRAY['program_staff','development','sales','software_dev','leadership','admin'], 'search', 'Search Drive/Notion documents (semantic)',          NOW()),

  ('query_hubspot_contacts',  ARRAY['sales','leadership','admin'],                                         'future',         'HubSpot contacts (not yet implemented)',               NOW()),
  ('query_hubspot_deals',     ARRAY['sales','leadership','admin'],                                         'future',         'HubSpot deals (not yet implemented)',                  NOW()),
  ('query_github_issues',     ARRAY['software_dev','leadership','admin'],                                  'future',         'GitHub issues (not yet implemented)',                  NOW()),
  ('query_github_prs',        ARRAY['software_dev','leadership','admin'],                                  'future',         'GitHub PRs (not yet implemented)',                     NOW()),
  ('query_policy',            ARRAY['program_staff','software_dev','leadership','admin'],                  'future',         'Notion policy docs (not yet implemented)',             NOW()),
  ('query_clients',           ARRAY['software_dev','sales','leadership','admin'],                          'future',         'Notion client records (not yet implemented)',          NOW());

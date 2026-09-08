-- Work package #204: skill_grant_sourcing_evaluation returned permission_denied in production.
--
-- Root cause is #295 (the deploy `migrate` job runs the PREVIOUS release's image, so
-- 20260812000000 was not applied to RDS when the denial was observed on 2026-08-13; it lagged
-- one deploy and applied on 2026-08-17). The row was MISSING, not narrower — see the analysis
-- on #204: the tool name appears in exactly one migration, and HQ /admin's toggleToolRole does
-- findUnique + update and throws `unknown_tool` rather than inserting, so no row for this tool
-- could have pre-existed for 20260812000000's `ON CONFLICT DO NOTHING` to decline to widen.
--
-- 20260812000000 is nonetheless a `DO NOTHING` insert, and it cannot be corrected in place:
-- Prisma checksums applied migrations, so editing it breaks `migrate deploy` on every
-- environment that already ran it. This migration supersedes it with the `DO UPDATE` form the
-- root CLAUDE.md mandates, making the declared role scope self-healing — it reconciles the row
-- to the declaration wherever the two have diverged, and is a no-op where they already agree.
--
-- Known, accepted cost (root CLAUDE.md step 6): this overwrites a role change an admin made on
-- HQ /admin before it applied. A migration applies exactly once, so admin edits made after it
-- applied are never touched.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'skill_grant_sourcing_evaluation',
  ARRAY['development','leadership','admin'],
  'skills',
  'Skill: source and score grant opportunities against a fixed weighted rubric',
  NOW()
)
ON CONFLICT ("tool_name") DO UPDATE SET
  "allowed_roles" = EXCLUDED."allowed_roles",
  "category"      = EXCLUDED."category",
  "description"   = EXCLUDED."description",
  "updated_at"    = NOW();

-- Backfill entity_aliases for all students that were synced from Google Sheets
-- but never had aliases created. This is a one-time fix; going forward,
-- sync-students.ts creates aliases on every upsert.

-- Alias by canonical_name
INSERT INTO "entity_aliases" ("id", "alias", "entity_type", "student_id", "source", "confidence", "created_at")
SELECT
  gen_random_uuid(),
  s."canonical_name",
  'student',
  s."id",
  'google_sheets',
  1.0,
  NOW()
FROM "students" s
WHERE s."canonical_name" IS NOT NULL
  AND s."canonical_name" != ''
ON CONFLICT ("alias", "entity_type") DO NOTHING;

-- Alias by student_number (LP####)
INSERT INTO "entity_aliases" ("id", "alias", "entity_type", "student_id", "source", "confidence", "created_at")
SELECT
  gen_random_uuid(),
  s."student_number",
  'student',
  s."id",
  'google_sheets',
  1.0,
  NOW()
FROM "students" s
WHERE s."student_number" IS NOT NULL
  AND s."student_number" != ''
ON CONFLICT ("alias", "entity_type") DO NOTHING;

-- Add V2 Student Information sheet columns to students.
-- All nullable; populated by sync-students on next run from the V2 sheet.
ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "dob"                       date,
  ADD COLUMN IF NOT EXISTS "suffix"                    text,
  ADD COLUMN IF NOT EXISTS "alt_school_email"          text,
  ADD COLUMN IF NOT EXISTS "asurite_user_id"           text,
  ADD COLUMN IF NOT EXISTS "rapid_account_number"      text,
  ADD COLUMN IF NOT EXISTS "alt_contact"               text,
  ADD COLUMN IF NOT EXISTS "id_card_number"            text,
  ADD COLUMN IF NOT EXISTS "doc_folder_url"            text,
  ADD COLUMN IF NOT EXISTS "t_shirt_size"              text,
  ADD COLUMN IF NOT EXISTS "algebra_keystone_score"    numeric(6, 2),
  ADD COLUMN IF NOT EXISTS "works_outside_launchpad"   boolean,
  ADD COLUMN IF NOT EXISTS "hours_outside_committed"   numeric(5, 2),
  ADD COLUMN IF NOT EXISTS "permission_slip"           boolean,
  ADD COLUMN IF NOT EXISTS "extra_time"                boolean,
  ADD COLUMN IF NOT EXISTS "work_ready_q1"             text,
  ADD COLUMN IF NOT EXISTS "ell"                       boolean;

-- cohort: was text (legacy V1 state), V0 source-of-truth is integer.
-- Existing data is downstream of the source sheet and will be repopulated on
-- the next sync-students run; safest to drop + re-add as integer.
ALTER TABLE "students" DROP COLUMN IF EXISTS "cohort";
ALTER TABLE "students" ADD COLUMN "cohort" integer;

CREATE INDEX IF NOT EXISTS "students_cohort_idx" ON "students" ("cohort");

-- Employment: one row per (student × job). source_id = "employment:<sheet_row>".
CREATE TABLE IF NOT EXISTS "student_employment" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id"       text NOT NULL UNIQUE,
  "student_number"  text NOT NULL,
  "student_name"    text,
  "employer_name"   text,
  "employment_type" text,
  "job_title"       text,
  "start_date"      date,
  "end_date"        date,
  "hourly_wage"     numeric(8, 2),
  "weekly_hours"    numeric(5, 2),
  "total_earned"    numeric(12, 2),
  "exit_code"       text,
  "notes"           text,
  "last_synced_at"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "student_employment_student_number_idx" ON "student_employment" ("student_number");
CREATE INDEX IF NOT EXISTS "student_employment_employer_name_idx"  ON "student_employment" ("employer_name");
CREATE INDEX IF NOT EXISTS "student_employment_exit_code_idx"      ON "student_employment" ("exit_code");

-- FK on student_number → students.student_number so Prisma's `.student` relation works.
-- ON DELETE SET NULL keeps employment history if a student row is ever removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_employment_student_number_fkey'
  ) THEN
    ALTER TABLE "student_employment"
      ADD CONSTRAINT "student_employment_student_number_fkey"
      FOREIGN KEY ("student_number") REFERENCES "students" ("student_number")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

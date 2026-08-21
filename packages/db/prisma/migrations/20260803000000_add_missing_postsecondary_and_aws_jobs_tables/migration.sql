-- Add the two tables that schema.prisma declares but no migration ever created.
--
-- WHY THIS EXISTS: `prisma migrate deploy` on an empty database produced a schema missing
-- `student_postsecondary` and `aws_resource_jobs`, because both tables were only ever created by
-- `prisma db push` (which diff-syncs and writes no migration file). Nothing in
-- packages/db/prisma/migrations referenced either table. Consequences on a migrate-built database:
--   * `pnpm db:seed` aborts on `prisma.studentPostsecondary.deleteMany()` - the seed cannot run at all
--   * the `query_postsecondary` tool fails at runtime, though 20260610190000 grants it permission
--   * the HQ /aws-jobs/[id] route fails at runtime
--
-- Definitions are transcribed from packages/db/prisma/schema.prisma (models StudentPostsecondary
-- and AwsResourceJob), matching the conventions of 20260527000000: native `uuid` primary keys with
-- gen_random_uuid() rather than Prisma-side text uuids, and timestamp(3) for DateTime.
--
-- SAFE TO RE-RUN AND SAFE ON PRODUCTION: every statement is guarded with IF NOT EXISTS, so on a
-- database where db push already created these tables this migration is a no-op and records itself
-- in _prisma_migrations without altering anything. It drops nothing and rewrites no column.
--
-- NOT ADDRESSED HERE, DELIBERATELY: `prisma migrate diff` also reports `student_employment.id` as
-- differing (native `uuid`/gen_random_uuid() in the database versus `String @default(uuid())` in
-- schema.prisma). That is a representational mismatch only - Prisma maps Postgres `uuid` to String
-- and the relation works - and closing it would mean dropping and recreating a live primary key.
-- Not worth the risk. Expect that one entry to persist in the diff output.

-- ---------- student_postsecondary ----------
-- National Student Clearinghouse enrollment and degree records.
CREATE TABLE IF NOT EXISTS "student_postsecondary" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id"          text NOT NULL UNIQUE,
  "student_number"     text NOT NULL,
  "first_name"         text,
  "last_name"          text,
  "institution"        text,
  "institution_length" text,
  "institution_type"   text,
  "enrollment_begin"   date,
  "enrollment_end"     date,
  -- Single-letter NSC codes: F=Full-time, Q=Three-quarter, H=Half-time, L=Less than half,
  -- A=Leave of absence, W=Withdrawn, D=Deceased
  "enrollment_status"  text,
  -- F=Freshman, S=Sophomore, J=Junior, R=Senior, C=Cert (UG), N=Unspec (UG), B=Bachelor's,
  -- M=Master's, D=Doctoral, P=Postdoc, L=First Prof, G=Unspec (Grad), A=Associate's, T=Post Bacc Cert
  "class_level"        text,
  "enrollment_major_1" text,
  "enrollment_major_2" text,
  "graduated"          boolean,
  "graduation_date"    date,
  "degree_title"       text,
  "degree_major_1"     text,
  "degree_major_2"     text,
  "degree_major_3"     text,
  "last_synced_at"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "student_postsecondary_student_number_idx"    ON "student_postsecondary" ("student_number");
CREATE INDEX IF NOT EXISTS "student_postsecondary_institution_idx"       ON "student_postsecondary" ("institution");
CREATE INDEX IF NOT EXISTS "student_postsecondary_enrollment_status_idx" ON "student_postsecondary" ("enrollment_status");

-- FK on student_number → students.student_number so Prisma's `.student` relation resolves.
-- ON DELETE SET NULL mirrors student_employment (20260527000000) for consistency across the
-- student-detail tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_postsecondary_student_number_fkey'
  ) THEN
    ALTER TABLE "student_postsecondary"
      ADD CONSTRAINT "student_postsecondary_student_number_fkey"
      FOREIGN KEY ("student_number") REFERENCES "students" ("student_number")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- aws_resource_jobs ----------
-- Backs the HQ /aws-jobs/[id] approval workflow.
CREATE TABLE IF NOT EXISTS "aws_resource_jobs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "developer"     text NOT NULL,
  -- CREATE, UPDATE, DELETE
  "action_type"   text NOT NULL,
  -- e.g. AWS::S3::Bucket, terraform
  "resource_type" text NOT NULL,
  -- Inputs / TF code / variables
  "parameters"    jsonb NOT NULL,
  -- Plan / dry-run details
  "plan_output"   text,
  -- PENDING_APPROVAL, APPROVED, REJECTED, IN_PROGRESS, SUCCEEDED, FAILED
  "status"        text NOT NULL,
  "error"         text,
  -- Approver email
  "approver"      text,
  "created_at"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Prisma maintains this via @updatedAt; the default covers direct SQL inserts.
  "updated_at"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "aws_resource_jobs_developer_idx" ON "aws_resource_jobs" ("developer");
CREATE INDEX IF NOT EXISTS "aws_resource_jobs_status_idx"    ON "aws_resource_jobs" ("status");

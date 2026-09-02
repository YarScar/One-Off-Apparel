-- Add the tables that schema.prisma declares but no migration in this branch ever created.
--
-- WHY THIS EXISTS: `prisma migrate deploy` on an empty database produced a schema missing
-- `student_postsecondary` and `aws_resource_jobs`, because both tables were only ever created by
-- `prisma db push` (which diff-syncs and writes no migration file). Consequences on a
-- migrate-built database:
--   * `pnpm db:seed` aborts on `prisma.studentPostsecondary.deleteMany()` - the seed cannot run at all
--   * the `query_postsecondary` tool fails at runtime, though 20260610190000 grants it permission
--   * the HQ /aws-jobs/[id] route fails at runtime
--
-- CORRECTED 2026-08-17, work package #254. Two things were wrong with the original of this file
-- and one thing was wrong with the claim above it:
--
--   1. It wrote native `uuid` primary keys defaulting to gen_random_uuid(), and a DB-side default on
--      `aws_resource_jobs.updated_at`. `schema.prisma` declares `String @default(uuid())` (a
--      client-side default, so: `text`, no DB default) and `@updatedAt` (no DB default at all). The
--      header used to predict ONE persistent `migrate diff` entry. The measured answer was EIGHT
--      statements across six objects. Both new tables now emit exactly what Prisma would generate,
--      so a developer running `prisma migrate dev` on a migrate-built database no longer gets a
--      drift prompt offering to reset.
--   2. The FK on `student_postsecondary.student_number` was `ON DELETE SET NULL` on a column this
--      same file declares `NOT NULL`. Deleting a `students` row with postsecondary rows raised a
--      not-null violation from inside the FK trigger rather than a clean referential error. Prisma
--      generates `ON DELETE RESTRICT` for a required relation, and that is what it is now.
--   3. "no migration ever created student_postsecondary" was true of this branch and false of
--      production. `20260610200000_create_student_postsecondary` was applied to RDS by hand via a
--      one-off ECS task (commit 129903c on feat/query-postsecondary-tool) and never merged here, so
--      RDS recorded a migration this repository did not contain. That file is now restored to this
--      branch, verbatim, ahead of this one - which makes the `student_postsecondary` half below a
--      guaranteed no-op on any database built from these migrations. It is kept, corrected, rather
--      than deleted: it costs nothing, and it is the safety net if that history ever diverges again.
--
-- SAFE TO RE-RUN AND SAFE ON PRODUCTION: every statement is guarded with IF NOT EXISTS, so on a
-- database where an earlier migration or `db push` already created these tables this migration is a
-- no-op and records itself in _prisma_migrations without altering anything. It drops nothing and
-- rewrites no column.
--
-- NOT ADDRESSED HERE, DELIBERATELY: `prisma migrate diff` still reports `student_employment` as
-- differing - native `uuid`/gen_random_uuid() in the database against `String @default(uuid())` in
-- schema.prisma, plus `ON DELETE SET NULL` where Prisma would generate `RESTRICT`. That table is
-- live in production with data, it was created by 20260527000000 which is applied there, and
-- closing either gap means editing an applied migration or dropping and recreating a live primary
-- key. Not worth the risk. Expect those entries to persist in the diff output; they are the only
-- ones that should.

-- ---------- student_postsecondary ----------
-- National Student Clearinghouse enrollment and degree records.
CREATE TABLE IF NOT EXISTS "student_postsecondary" (
  "id"                 text PRIMARY KEY,
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
-- ON DELETE RESTRICT because `student_number` is NOT NULL: it is what Prisma generates for a
-- required relation, and SET NULL on a NOT NULL column can only ever raise a not-null violation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_postsecondary_student_number_fkey'
  ) THEN
    ALTER TABLE "student_postsecondary"
      ADD CONSTRAINT "student_postsecondary_student_number_fkey"
      FOREIGN KEY ("student_number") REFERENCES "students" ("student_number")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- aws_resource_jobs ----------
-- Backs the HQ /aws-jobs/[id] approval workflow.
CREATE TABLE IF NOT EXISTS "aws_resource_jobs" (
  "id"            text PRIMARY KEY,
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
  -- No DB default: schema.prisma declares this `@updatedAt`, which Prisma maintains client-side and
  -- generates without one. A default here is drift, and a direct SQL insert that omits the column
  -- should fail loudly rather than record a fabricated update time.
  "updated_at"    timestamp(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "aws_resource_jobs_developer_idx" ON "aws_resource_jobs" ("developer");
CREATE INDEX IF NOT EXISTS "aws_resource_jobs_status_idx"    ON "aws_resource_jobs" ("status");

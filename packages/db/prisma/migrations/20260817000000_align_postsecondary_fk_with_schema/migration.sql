-- Align student_postsecondary's foreign key with what schema.prisma generates.
--
-- Work package #254. `20260610200000_create_student_postsecondary` created the constraint with
-- `ON DELETE NO ACTION`. Prisma generates `ON DELETE RESTRICT` for a required relation, and Postgres
-- records the two distinctly (pg_constraint.confdeltype 'a' vs 'r'), so `prisma migrate diff` reported
-- the FK as differing on every run and offered to drop and recreate it.
--
-- Why this is a new migration rather than an edit to 20260610200000: that file's checksum is recorded
-- in production's `_prisma_migrations` (it was applied to RDS by hand via a one-off ECS task ahead of
-- commit 129903c). Editing an applied migration is what `prisma migrate deploy` refuses on principle.
--
-- Behaviourally this is close to a no-op. Both settings reject a delete that would orphan a child row;
-- RESTRICT checks immediately, NO ACTION defers to the end of the statement, and neither can fire at
-- all on a NOT NULL column via SET NULL. What it buys is an empty diff, so the next real drift is
-- visible instead of hidden behind a permanent one.
--
-- Idempotent: guarded on the current delete action, so re-running it does nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_postsecondary_student_number_fkey'
      AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE "student_postsecondary"
      DROP CONSTRAINT "student_postsecondary_student_number_fkey";
    ALTER TABLE "student_postsecondary"
      ADD CONSTRAINT "student_postsecondary_student_number_fkey"
      FOREIGN KEY ("student_number") REFERENCES "students" ("student_number")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

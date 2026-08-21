-- Remove the explicit per-student "cohort" designation (Students tab column
-- AQ). It is no longer synced; program-phase history now comes from the
-- PhaseCompletion tab (student_phase_outcomes).
DROP INDEX IF EXISTS "students_cohort_idx";
ALTER TABLE "students" DROP COLUMN IF EXISTS "cohort";

-- attendance_records.cohort was never derived from the students-tab cohort
-- field above — it's an internal signal for which of the 3 source
-- spreadsheets a row came from (and thus which rate-calculation shape
-- applies). Rename it to make that internal-only purpose explicit; it is
-- not exposed to MCP callers (see query-attendance.ts).
ALTER TABLE "attendance_records" RENAME COLUMN "cohort" TO "source_format";

DROP INDEX IF EXISTS "attendance_records_cohort_date_idx";
CREATE INDEX "attendance_records_source_format_date_idx" ON "attendance_records"("source_format", "date");

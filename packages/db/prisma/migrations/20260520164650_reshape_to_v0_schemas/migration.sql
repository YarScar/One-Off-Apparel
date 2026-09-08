-- DropForeignKey
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_student_id_fkey";

-- DropForeignKey
ALTER TABLE "enrollment_snapshots" DROP CONSTRAINT "enrollment_snapshots_student_id_fkey";

-- DropForeignKey
ALTER TABLE "student_competencies" DROP CONSTRAINT "student_competencies_student_id_fkey";

-- DropIndex
DROP INDEX "attendance_records_cohort_idx";

-- DropIndex
DROP INDEX "finance_snapshots_tab_idx";

-- DropIndex
DROP INDEX "student_certifications_cert_name_idx";

-- DropIndex
DROP INDEX "student_competencies_competency_area_idx";

-- DropIndex
DROP INDEX "student_phase_outcomes_phase_idx";

-- AlterTable
ALTER TABLE "attendance_records" DROP COLUMN "attendance_date",
DROP COLUMN "status",
DROP COLUMN "student_id",
DROP COLUMN "synced_at",
DROP COLUMN "week_of",
ADD COLUMN     "date" DATE,
ADD COLUMN     "end_date" DATE,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "student_number" TEXT NOT NULL,
DROP COLUMN "cohort",
ADD COLUMN     "cohort" INTEGER NOT NULL,
ALTER COLUMN "percentage" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "row_data" SET NOT NULL;

-- AlterTable
ALTER TABLE "enrollment_snapshots" DROP CONSTRAINT "enrollment_snapshots_pkey",
DROP COLUMN "id",
DROP COLUMN "snapshot_date",
DROP COLUMN "status",
DROP COLUMN "student_id",
DROP COLUMN "synced_at",
ADD COLUMN     "count" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "period_month" DATE NOT NULL,
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD CONSTRAINT "enrollment_snapshots_pkey" PRIMARY KEY ("source_id");

-- AlterTable
ALTER TABLE "finance_snapshots" DROP COLUMN "amount",
DROP COLUMN "category",
DROP COLUMN "fund_or_phase",
DROP COLUMN "source",
DROP COLUMN "subcategory",
DROP COLUMN "synced_at",
DROP COLUMN "tab",
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD COLUMN     "tab_name" TEXT NOT NULL,
ALTER COLUMN "period" DROP NOT NULL,
ALTER COLUMN "row_data" SET NOT NULL;

-- AlterTable
ALTER TABLE "student_certifications" DROP COLUMN "cert_name",
DROP COLUMN "expiration_date",
DROP COLUMN "issued_date",
DROP COLUMN "status",
DROP COLUMN "synced_at",
ADD COLUMN     "date" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD COLUMN     "type" TEXT,
ALTER COLUMN "score" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "phase" SET NOT NULL;

-- AlterTable
ALTER TABLE "student_competencies" DROP COLUMN "assessed_date",
DROP COLUMN "competency_area",
DROP COLUMN "rubric_level",
DROP COLUMN "score",
DROP COLUMN "skill_name",
DROP COLUMN "student_id",
DROP COLUMN "synced_at",
DROP COLUMN "term",
ADD COLUMN     "baseline" DECIMAL(5,2),
ADD COLUMN     "competency" TEXT NOT NULL,
ADD COLUMN     "completed_er" INTEGER,
ADD COLUMN     "growth" DECIMAL(5,2),
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "missed_er" INTEGER,
ADD COLUMN     "performance_level" DECIMAL(5,2),
ADD COLUMN     "portfolio" TEXT,
ADD COLUMN     "progress" DECIMAL(5,2),
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD COLUMN     "student_number" TEXT NOT NULL,
ADD COLUMN     "total_er" INTEGER,
ADD COLUMN     "total_opportunities" INTEGER;

-- AlterTable
ALTER TABLE "student_phase_outcomes" DROP COLUMN "end_date",
DROP COLUMN "exit_reason",
DROP COLUMN "outcome",
DROP COLUMN "phase",
DROP COLUMN "start_date",
DROP COLUMN "synced_at",
ADD COLUMN     "foundations_end_date" DATE,
ADD COLUMN     "foundations_start_date" DATE,
ADD COLUMN     "foundations_status" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "liftoff_end_date" DATE,
ADD COLUMN     "liftoff_start_date" DATE,
ADD COLUMN     "liftoff_status" TEXT,
ADD COLUMN     "lightspeed_end_date" DATE,
ADD COLUMN     "lightspeed_start_date" DATE,
ADD COLUMN     "lightspeed_status" TEXT,
ADD COLUMN     "phase_101_end_date" DATE,
ADD COLUMN     "phase_101_start_date" DATE,
ADD COLUMN     "phase_101_status" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_source_id_key" ON "attendance_records"("source_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_number_idx" ON "attendance_records"("student_number");

-- CreateIndex
CREATE INDEX "attendance_records_cohort_date_idx" ON "attendance_records"("cohort", "date");

-- CreateIndex
CREATE INDEX "attendance_records_date_idx" ON "attendance_records"("date");

-- CreateIndex
CREATE INDEX "enrollment_snapshots_period_month_idx" ON "enrollment_snapshots"("period_month");

-- CreateIndex
CREATE INDEX "enrollment_snapshots_phase_idx" ON "enrollment_snapshots"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "finance_snapshots_source_id_key" ON "finance_snapshots"("source_id");

-- CreateIndex
CREATE INDEX "finance_snapshots_tab_name_idx" ON "finance_snapshots"("tab_name");

-- CreateIndex
CREATE INDEX "finance_snapshots_period_idx" ON "finance_snapshots"("period");

-- CreateIndex
CREATE UNIQUE INDEX "student_certifications_source_id_key" ON "student_certifications"("source_id");

-- CreateIndex
CREATE INDEX "student_certifications_student_id_idx" ON "student_certifications"("student_id");

-- CreateIndex
CREATE INDEX "student_certifications_type_idx" ON "student_certifications"("type");

-- CreateIndex
CREATE INDEX "student_certifications_date_idx" ON "student_certifications"("date");

-- CreateIndex
CREATE UNIQUE INDEX "student_competencies_source_id_key" ON "student_competencies"("source_id");

-- CreateIndex
CREATE INDEX "student_competencies_student_number_idx" ON "student_competencies"("student_number");

-- CreateIndex
CREATE INDEX "student_competencies_competency_idx" ON "student_competencies"("competency");

-- CreateIndex
CREATE UNIQUE INDEX "student_phase_outcomes_student_id_key" ON "student_phase_outcomes"("student_id");

-- CreateIndex
CREATE INDEX "student_phase_outcomes_student_id_idx" ON "student_phase_outcomes"("student_id");


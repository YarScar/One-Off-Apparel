/*
  Warnings:

  - The primary key for the `student_employment` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "student_employment" DROP CONSTRAINT "student_employment_student_number_fkey";

-- AlterTable
ALTER TABLE "student_employment" DROP CONSTRAINT "student_employment_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "student_employment_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "claude_telemetry_metrics" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "user_email" TEXT,
    "organization_id" TEXT,
    "session_id" TEXT,
    "attributes" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claude_telemetry_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claude_telemetry_events" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "user_email" TEXT,
    "organization_id" TEXT,
    "session_id" TEXT,
    "prompt_id" TEXT,
    "tool_use_id" TEXT,
    "attributes" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claude_telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claude_telemetry_metrics_source_id_key" ON "claude_telemetry_metrics"("source_id");

-- CreateIndex
CREATE INDEX "claude_telemetry_metrics_metric_name_idx" ON "claude_telemetry_metrics"("metric_name");

-- CreateIndex
CREATE INDEX "claude_telemetry_metrics_recorded_at_idx" ON "claude_telemetry_metrics"("recorded_at");

-- CreateIndex
CREATE INDEX "claude_telemetry_metrics_user_email_idx" ON "claude_telemetry_metrics"("user_email");

-- CreateIndex
CREATE INDEX "claude_telemetry_metrics_session_id_idx" ON "claude_telemetry_metrics"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "claude_telemetry_events_source_id_key" ON "claude_telemetry_events"("source_id");

-- CreateIndex
CREATE INDEX "claude_telemetry_events_event_name_idx" ON "claude_telemetry_events"("event_name");

-- CreateIndex
CREATE INDEX "claude_telemetry_events_occurred_at_idx" ON "claude_telemetry_events"("occurred_at");

-- CreateIndex
CREATE INDEX "claude_telemetry_events_user_email_idx" ON "claude_telemetry_events"("user_email");

-- CreateIndex
CREATE INDEX "claude_telemetry_events_session_id_idx" ON "claude_telemetry_events"("session_id");

-- AddForeignKey
ALTER TABLE "student_employment" ADD CONSTRAINT "student_employment_student_number_fkey" FOREIGN KEY ("student_number") REFERENCES "students"("student_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "student_number" TEXT,
    "canonical_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "current_phase" TEXT,
    "enrollment_status" TEXT,
    "cohort" TEXT,
    "distance_to_office" DOUBLE PRECISION,
    "neighborhood" TEXT,
    "graduation_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "student_id" TEXT,
    "staff_id" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source" TEXT,
    "context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_info" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_certifications" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "cert_name" TEXT NOT NULL,
    "issued_date" TEXT,
    "expiration_date" TEXT,
    "status" TEXT,
    "score" DOUBLE PRECISION,
    "result" TEXT,
    "phase" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_phase_outcomes" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "outcome" TEXT,
    "exit_reason" TEXT,
    "start_date" TEXT,
    "end_date" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_phase_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_competencies" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "competency_area" TEXT NOT NULL,
    "skill_name" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "rubric_level" TEXT,
    "assessed_date" TEXT,
    "term" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_snapshots" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT,
    "snapshot_date" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "week_of" TEXT,
    "attendance_date" TEXT,
    "status" TEXT,
    "code" TEXT,
    "percentage" DOUBLE PRECISION,
    "row_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_snapshots" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,
    "fund_or_phase" TEXT,
    "source" TEXT,
    "tab" TEXT,
    "row_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_contacts" (
    "id" TEXT NOT NULL,
    "givebutter_contact_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "organization_name" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_gifts" (
    "id" TEXT NOT NULL,
    "donor_contact_id" TEXT,
    "givebutter_tx_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "gift_date" TEXT NOT NULL,
    "campaign_name" TEXT,
    "fund" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donor_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_pipeline" (
    "id" TEXT NOT NULL,
    "donor_contact_id" TEXT,
    "stage" TEXT,
    "ask_amount" DOUBLE PRECISION,
    "likelihood" TEXT,
    "notes" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donor_pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_grants" (
    "id" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "status" TEXT,
    "deadline" TEXT,
    "award_date" TEXT,
    "fund" TEXT,
    "notes" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donor_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input_json" JSONB,
    "output_json" JSONB,
    "duration_ms" INTEGER,
    "error" TEXT,
    "called_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notes" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "students_student_number_key" ON "students"("student_number");

-- CreateIndex
CREATE INDEX "students_canonical_name_idx" ON "students"("canonical_name");

-- CreateIndex
CREATE INDEX "staff_canonical_name_idx" ON "staff"("canonical_name");

-- CreateIndex
CREATE INDEX "entity_aliases_entity_type_idx" ON "entity_aliases"("entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_alias_entity_type_key" ON "entity_aliases"("alias", "entity_type");

-- CreateIndex
CREATE INDEX "pending_aliases_entity_type_idx" ON "pending_aliases"("entity_type");

-- CreateIndex
CREATE INDEX "student_certifications_cert_name_idx" ON "student_certifications"("cert_name");

-- CreateIndex
CREATE INDEX "student_certifications_phase_idx" ON "student_certifications"("phase");

-- CreateIndex
CREATE INDEX "student_phase_outcomes_phase_idx" ON "student_phase_outcomes"("phase");

-- CreateIndex
CREATE INDEX "student_competencies_competency_area_idx" ON "student_competencies"("competency_area");

-- CreateIndex
CREATE INDEX "attendance_records_cohort_idx" ON "attendance_records"("cohort");

-- CreateIndex
CREATE INDEX "finance_snapshots_tab_idx" ON "finance_snapshots"("tab");

-- CreateIndex
CREATE INDEX "donor_contacts_organization_name_idx" ON "donor_contacts"("organization_name");

-- CreateIndex
CREATE INDEX "document_chunks_source_source_id_idx" ON "document_chunks"("source", "source_id");

-- CreateIndex
CREATE INDEX "usage_logs_tool_name_idx" ON "usage_logs"("tool_name");

-- CreateIndex
CREATE INDEX "usage_logs_called_at_idx" ON "usage_logs"("called_at");

-- CreateIndex
CREATE INDEX "sync_runs_connector_started_at_idx" ON "sync_runs"("connector", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- AddForeignKey
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_info" ADD CONSTRAINT "student_info_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_certifications" ADD CONSTRAINT "student_certifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_phase_outcomes" ADD CONSTRAINT "student_phase_outcomes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_competencies" ADD CONSTRAINT "student_competencies_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_snapshots" ADD CONSTRAINT "enrollment_snapshots_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_gifts" ADD CONSTRAINT "donor_gifts_donor_contact_id_fkey" FOREIGN KEY ("donor_contact_id") REFERENCES "donor_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_pipeline" ADD CONSTRAINT "donor_pipeline_donor_contact_id_fkey" FOREIGN KEY ("donor_contact_id") REFERENCES "donor_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


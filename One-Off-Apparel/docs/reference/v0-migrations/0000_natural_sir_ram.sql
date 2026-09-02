CREATE TABLE IF NOT EXISTS "entity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"alias" text NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tab_name" text NOT NULL,
	"period" text,
	"row_data" jsonb NOT NULL,
	"source_id" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_snapshots_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"email" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"phase_withdrawal_code" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_certifications_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"iep" boolean DEFAULT false,
	"ell" boolean DEFAULT false,
	"notes" text,
	"interests" text[],
	"goals" text[],
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_info_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_phase_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"foundations_status" text,
	"foundations_start_date" date,
	"foundations_end_date" date,
	"phase_101_status" text,
	"phase_101_start_date" date,
	"phase_101_end_date" date,
	"lightspeed_status" text,
	"lightspeed_start_date" date,
	"lightspeed_end_date" date,
	"liftoff_status" text,
	"liftoff_start_date" date,
	"liftoff_end_date" date,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_phase_outcomes_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"student_id" text,
	"email" text,
	"gender" text,
	"race_ethnicity" text,
	"school_name" text,
	"hs_graduation_year" integer,
	"entry_date" date,
	"withdrawal_date" date,
	"withdrawal_code" text,
	"zip" text,
	"left_before_hs_grad" boolean,
	"completed_phase" boolean,
	"interview_score" numeric(5, 2),
	"tech_interest_onboarding" integer,
	"interview_passion_score" integer,
	"interview_college_score" integer,
	"hs_gpa" numeric(4, 2),
	"algebra1_grade" text,
	"geometry_grade" text,
	"college_enroll" text,
	"university" text,
	"major" text,
	"income" text,
	"parental_ed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"records_synced" integer DEFAULT 0,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_name" text NOT NULL,
	"caller_identity" text,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_certifications" ADD CONSTRAINT "student_certifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_info" ADD CONSTRAINT "student_info_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_phase_outcomes" ADD CONSTRAINT "student_phase_outcomes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_entity_aliases_source_alias" ON "entity_aliases" ("source","alias");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_aliases_entity" ON "entity_aliases" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_snapshots_tab" ON "finance_snapshots" ("tab_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_snapshots_period" ON "finance_snapshots" ("period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_certifications_student" ON "student_certifications" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_certifications_phase" ON "student_certifications" ("phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_phase_outcomes_student" ON "student_phase_outcomes" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_students_student_id" ON "students" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_students_canonical_name" ON "students" ("canonical_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_log_connector" ON "sync_log" ("connector","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_log_tool" ON "usage_log" ("tool_name","called_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_log_caller" ON "usage_log" ("caller_identity","called_at");
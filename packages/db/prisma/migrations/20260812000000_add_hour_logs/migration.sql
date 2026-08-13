-- Hour logs: Launchpad team hours logged in the shared "Hours" spreadsheet.
-- One row per spreadsheet row in the "North10AI" and "LP Internal AI" tabs.
-- The connector reads headers dynamically (see connectors/google-sheets/src/sync-hours.ts),
-- maps well-known columns (date / person / hours / task) to typed fields, and stores the
-- full raw row in row_data. project is the source tab, so both engagements stay in one table.
CREATE TABLE IF NOT EXISTS "hour_logs" (
  "id"             text PRIMARY KEY,
  "source_id"      text NOT NULL UNIQUE,
  "project"        text NOT NULL,
  "source_tab"     text NOT NULL,
  "log_date"       date,
  "person_name"    text,
  "hours"          decimal(8,2),
  "task"           text,
  "row_data"       jsonb NOT NULL,
  "last_synced_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "hour_logs_project_idx"     ON "hour_logs" ("project");
CREATE INDEX IF NOT EXISTS "hour_logs_log_date_idx"    ON "hour_logs" ("log_date");
CREATE INDEX IF NOT EXISTS "hour_logs_person_name_idx" ON "hour_logs" ("person_name");

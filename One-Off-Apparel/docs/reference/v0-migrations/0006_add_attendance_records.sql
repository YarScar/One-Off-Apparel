-- attendance_records: unified storage for the three Launchpad cohort
-- attendance sheets. cohort + student_number + date are the high-cardinality
-- query dimensions; row_data preserves the full source row for cohort-specific
-- fields the parser doesn't promote to columns.

CREATE TABLE IF NOT EXISTS attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort          integer NOT NULL,
  student_number  text NOT NULL,
  date            date,
  start_date      date,
  end_date        date,
  code            text,
  percentage      numeric(5, 2),
  row_data        jsonb NOT NULL,
  source_id       text NOT NULL UNIQUE,
  last_synced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_student      ON attendance_records (student_number);
CREATE INDEX IF NOT EXISTS idx_attendance_cohort_date  ON attendance_records (cohort, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date         ON attendance_records (date);

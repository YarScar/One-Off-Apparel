CREATE TABLE IF NOT EXISTS student_competencies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           text NOT NULL UNIQUE,
  student_number      text NOT NULL,
  competency          text NOT NULL,
  portfolio           text,
  baseline            numeric(5, 2),
  performance_level   numeric(5, 2),
  growth              numeric(5, 2),
  progress            numeric(5, 2),
  total_er            integer,
  completed_er        integer,
  missed_er           integer,
  total_opportunities integer,
  last_synced_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competency_student ON student_competencies (student_number);
CREATE INDEX IF NOT EXISTS idx_competency_name    ON student_competencies (competency);

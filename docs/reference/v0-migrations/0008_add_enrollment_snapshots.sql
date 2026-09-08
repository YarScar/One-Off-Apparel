CREATE TABLE IF NOT EXISTS enrollment_snapshots (
  source_id      text PRIMARY KEY,
  period_month   date NOT NULL,
  phase          text NOT NULL,
  count          numeric(10, 2) NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_period ON enrollment_snapshots (period_month);
CREATE INDEX IF NOT EXISTS idx_enrollment_phase  ON enrollment_snapshots (phase);

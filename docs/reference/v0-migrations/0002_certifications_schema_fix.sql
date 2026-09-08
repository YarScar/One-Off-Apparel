ALTER TABLE student_certifications DROP COLUMN IF EXISTS status;
ALTER TABLE student_certifications DROP COLUMN IF EXISTS start_date;
ALTER TABLE student_certifications DROP COLUMN IF EXISTS end_date;
ALTER TABLE student_certifications DROP COLUMN IF EXISTS phase_withdrawal_code;
ALTER TABLE student_certifications ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE student_certifications ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE student_certifications ADD COLUMN IF NOT EXISTS result text;
ALTER TABLE student_certifications ADD COLUMN IF NOT EXISTS score numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_certifications_type ON student_certifications(type);
CREATE INDEX IF NOT EXISTS idx_certifications_date ON student_certifications(date);

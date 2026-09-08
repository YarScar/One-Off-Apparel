ALTER TABLE student_certifications ALTER COLUMN date TYPE text USING TO_CHAR(date, 'MM-YYYY');

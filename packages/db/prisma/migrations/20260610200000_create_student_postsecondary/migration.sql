-- CreateTable
CREATE TABLE "student_postsecondary" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "student_number" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "institution" TEXT,
    "institution_length" TEXT,
    "institution_type" TEXT,
    "enrollment_begin" DATE,
    "enrollment_end" DATE,
    "enrollment_status" TEXT,
    "class_level" TEXT,
    "enrollment_major_1" TEXT,
    "enrollment_major_2" TEXT,
    "graduated" BOOLEAN,
    "graduation_date" DATE,
    "degree_title" TEXT,
    "degree_major_1" TEXT,
    "degree_major_2" TEXT,
    "degree_major_3" TEXT,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_postsecondary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_postsecondary_source_id_key" ON "student_postsecondary"("source_id");

-- CreateIndex
CREATE INDEX "student_postsecondary_student_number_idx" ON "student_postsecondary"("student_number");

-- CreateIndex
CREATE INDEX "student_postsecondary_institution_idx" ON "student_postsecondary"("institution");

-- CreateIndex
CREATE INDEX "student_postsecondary_enrollment_status_idx" ON "student_postsecondary"("enrollment_status");

-- AddForeignKey
ALTER TABLE "student_postsecondary"
  ADD CONSTRAINT "student_postsecondary_student_number_fkey"
  FOREIGN KEY ("student_number") REFERENCES "students"("student_number")
  ON DELETE NO ACTION ON UPDATE CASCADE;

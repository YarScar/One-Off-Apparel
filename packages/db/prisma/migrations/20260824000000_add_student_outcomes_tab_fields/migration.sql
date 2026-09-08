-- The V2 student-info sheet's "Outcomes" tab (post-program tracking: HS diploma, college
-- credits, PCEP score, internship, initial placement, current employment) has no home in
-- `students` yet. college_enroll/university/major/workforce_program_referral/
-- workforce_referral_status/internship_status already exist from the pre-V2 legacy sheet;
-- everything below is new.

ALTER TABLE "students"
  ADD COLUMN "hs_diploma" BOOLEAN,
  ADD COLUMN "hs_final_gpa" DECIMAL(4,2),
  ADD COLUMN "college_credits_earned" DECIMAL(6,2),
  ADD COLUMN "highest_pcep_score" DECIMAL(5,2),
  ADD COLUMN "internship_hours" DECIMAL(6,2),
  ADD COLUMN "internship_pay_rate" DECIMAL(7,2),
  ADD COLUMN "internship_site" TEXT,
  ADD COLUMN "initial_placement_hourly_wage" DECIMAL(7,2),
  ADD COLUMN "initial_placement_weekly_hours" DECIMAL(6,2),
  ADD COLUMN "initial_placement_start_date" DATE,
  ADD COLUMN "initial_placement_site" TEXT,
  ADD COLUMN "status_12mo_post_placement" TEXT,
  ADD COLUMN "current_employer" TEXT,
  ADD COLUMN "current_hourly_wage" DECIMAL(7,2),
  ADD COLUMN "current_weekly_hours" DECIMAL(6,2),
  ADD COLUMN "current_employment_updated_at" DATE;

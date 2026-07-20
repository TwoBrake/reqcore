ALTER TABLE "onboarding_survey_response" ALTER COLUMN "completed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "onboarding_survey_response" ALTER COLUMN "completed_at" DROP NOT NULL;
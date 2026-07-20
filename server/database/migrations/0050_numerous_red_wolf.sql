DELETE FROM "notification_outbox" WHERE "type" = 'analysis_completed';--> statement-breakpoint
DELETE FROM "notification_preference" WHERE "type" = 'analysis_completed';--> statement-breakpoint
UPDATE "notification_preference"
SET "channel_mode" = 'digest', "updated_at" = now()
WHERE "type" = 'application_created' AND "channel_mode" = 'instant';--> statement-breakpoint
UPDATE "notification_outbox"
SET "status" = 'skipped', "updated_at" = now(), "last_error" = 'Instant new-application notifications disabled'
WHERE "type" = 'application_created' AND "cadence" = 'instant' AND "status" = 'pending';--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_preference" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."notification_type";--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('candidate_replied', 'application_created', 'interview_response');--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "type" SET DATA TYPE "public"."notification_type" USING "type"::"public"."notification_type";--> statement-breakpoint
ALTER TABLE "notification_preference" ALTER COLUMN "type" SET DATA TYPE "public"."notification_type" USING "type"::"public"."notification_type";

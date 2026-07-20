CREATE TYPE "public"."email_suppression_reason" AS ENUM('bounce', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."notification_cadence" AS ENUM('instant', 'digest');--> statement-breakpoint
CREATE TYPE "public"."notification_channel_mode" AS ENUM('instant', 'digest', 'off');--> statement-breakpoint
CREATE TYPE "public"."notification_outbox_status" AS ENUM('pending', 'sent', 'skipped', 'dead');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('candidate_replied', 'application_created', 'analysis_completed');--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"recipient_email" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"cadence" "notification_cadence" NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"digest_bucket" text,
	"provider_message_id" text,
	"sent_at" timestamp,
	"failed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"channel_mode" "notification_channel_mode" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_email_idx" ON "email_suppression" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_idx" ON "notification_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_pull_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_provider_id_idx" ON "notification_outbox" USING btree ("provider_message_id") WHERE "notification_outbox"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_outbox_organization_id_idx" ON "notification_outbox" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_digest_idx" ON "notification_outbox" USING btree ("recipient_user_id","digest_bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_user_org_type_idx" ON "notification_preference" USING btree ("user_id","organization_id","type");--> statement-breakpoint
CREATE INDEX "notification_preference_organization_id_idx" ON "notification_preference" USING btree ("organization_id");
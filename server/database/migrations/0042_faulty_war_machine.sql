CREATE TYPE "public"."candidate_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."candidate_message_status" AS ENUM('queued', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'complained');--> statement-breakpoint
CREATE TABLE "candidate_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"reply_token" text NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" "candidate_message_direction" NOT NULL,
	"status" "candidate_message_status" NOT NULL,
	"from_email" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"provider_message_id" text,
	"internet_message_id" text,
	"in_reply_to" text,
	"references" jsonb,
	"sent_by_id" text,
	"provider_status_at" timestamp,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_message_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"provider_message_id" text,
	"occurred_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_conversation" ADD CONSTRAINT "candidate_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_conversation" ADD CONSTRAINT "candidate_conversation_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD CONSTRAINT "candidate_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD CONSTRAINT "candidate_message_conversation_id_candidate_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."candidate_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD CONSTRAINT "candidate_message_sent_by_id_user_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_conversation_organization_id_idx" ON "candidate_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_conversation_application_id_idx" ON "candidate_conversation" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_conversation_reply_token_idx" ON "candidate_conversation" USING btree ("reply_token");--> statement-breakpoint
CREATE INDEX "candidate_conversation_last_message_at_idx" ON "candidate_conversation" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "candidate_message_organization_id_idx" ON "candidate_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_message_conversation_id_idx" ON "candidate_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_message_provider_id_idx" ON "candidate_message" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_message_internet_id_idx" ON "candidate_message" USING btree ("internet_message_id");--> statement-breakpoint
CREATE INDEX "candidate_message_webhook_provider_id_idx" ON "candidate_message_webhook_event" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "candidate_message_webhook_unprocessed_idx" ON "candidate_message_webhook_event" USING btree ("processed_at");
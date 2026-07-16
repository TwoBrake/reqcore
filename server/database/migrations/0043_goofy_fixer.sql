ALTER TABLE "candidate_message" ADD COLUMN "kind" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD COLUMN "interview_id" text;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD COLUMN "calendar_attachment_status" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD COLUMN "calendar_attachment_error" text;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD COLUMN "calendar_sequence" integer;--> statement-breakpoint
ALTER TABLE "interview" ADD COLUMN "personal_note" text;--> statement-breakpoint
ALTER TABLE "candidate_message" ADD CONSTRAINT "candidate_message_interview_id_interview_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_message_interview_id_idx" ON "candidate_message" USING btree ("interview_id","created_at");
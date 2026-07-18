CREATE TABLE "candidate_message_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"provider_attachment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_message_attachment_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "candidate_message_attachment_provider_attachment_id_unique" UNIQUE("provider_attachment_id")
);
--> statement-breakpoint
ALTER TABLE "candidate_message_attachment" ADD CONSTRAINT "candidate_message_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_message_attachment" ADD CONSTRAINT "candidate_message_attachment_message_id_candidate_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."candidate_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_message_attachment_organization_id_idx" ON "candidate_message_attachment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_message_attachment_message_id_idx" ON "candidate_message_attachment" USING btree ("message_id");
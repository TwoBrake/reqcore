ALTER TYPE "public"."import_source" ADD VALUE 'email_forward';--> statement-breakpoint
CREATE TABLE "candidate_forwarding_address" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_forwarding_address_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "import_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"import_job_id" text NOT NULL,
	"provider_attachment_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"parsed_content" jsonb,
	"document_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_attachment_provider_attachment_id_unique" UNIQUE("provider_attachment_id"),
	CONSTRAINT "import_attachment_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "import_job" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "import_job" ADD COLUMN "source_sender_email" text;--> statement-breakpoint
ALTER TABLE "candidate_forwarding_address" ADD CONSTRAINT "candidate_forwarding_address_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_forwarding_address" ADD CONSTRAINT "candidate_forwarding_address_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_forwarding_address" ADD CONSTRAINT "candidate_forwarding_address_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachment" ADD CONSTRAINT "import_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachment" ADD CONSTRAINT "import_attachment_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachment" ADD CONSTRAINT "import_attachment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_forwarding_address_job_id_idx" ON "candidate_forwarding_address" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "candidate_forwarding_address_organization_id_idx" ON "candidate_forwarding_address" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_attachment_organization_id_idx" ON "import_attachment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_attachment_job_id_idx" ON "import_attachment" USING btree ("import_job_id");--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_provider_message_id_unique" UNIQUE("provider_message_id");
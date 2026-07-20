CREATE TYPE "public"."import_job_status" AS ENUM('processing', 'previewing', 'committing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('ready', 'duplicate', 'duplicate_in_file', 'error', 'committed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('csv', 'xlsx', 'resume_zip');--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_job_status" DEFAULT 'processing' NOT NULL,
	"filename" text NOT NULL,
	"columns" jsonb,
	"mapping" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"committed_rows" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"normalized_data" jsonb,
	"status" "import_row_status" DEFAULT 'ready' NOT NULL,
	"dedupe_hash" text,
	"matched_candidate_id" text,
	"created_candidate_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_job_id_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_matched_candidate_id_candidate_id_fk" FOREIGN KEY ("matched_candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_created_candidate_id_candidate_id_fk" FOREIGN KEY ("created_candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_job_organization_id_idx" ON "import_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_job_status_idx" ON "import_job" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "import_row_job_id_idx" ON "import_row" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "import_row_job_status_idx" ON "import_row" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "import_row_dedupe_idx" ON "import_row" USING btree ("organization_id","dedupe_hash");
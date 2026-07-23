CREATE TYPE "public"."rule_action" AS ENUM('rejected', 'screening', 'interview');--> statement-breakpoint
CREATE TYPE "public"."rule_match_type" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TABLE "application_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"match_type" "rule_match_type" DEFAULT 'all' NOT NULL,
	"action" "rule_action" DEFAULT 'rejected' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_rule" ADD CONSTRAINT "application_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_rule" ADD CONSTRAINT "application_rule_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_rule_organization_id_idx" ON "application_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "application_rule_job_id_idx" ON "application_rule" USING btree ("job_id");
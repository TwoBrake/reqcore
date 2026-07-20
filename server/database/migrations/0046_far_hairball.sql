DROP INDEX "email_suppression_email_idx";--> statement-breakpoint
DROP INDEX "notification_outbox_pull_idx";--> statement-breakpoint
DROP INDEX "notification_outbox_digest_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_email_idx" ON "email_suppression" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "notification_outbox_pull_idx" ON "notification_outbox" USING btree ("cadence","next_attempt_at") WHERE "notification_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_outbox_digest_idx" ON "notification_outbox" USING btree ("organization_id","recipient_user_id","digest_bucket");
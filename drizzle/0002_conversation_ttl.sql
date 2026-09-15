ALTER TABLE "ai_conversations" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_conv_expires_idx" ON "ai_conversations" USING btree ("expires_at");--> statement-breakpoint
-- Existing conversations keep their own timeline: they expire 24 h after their last message, not 24 h
-- after this migration ran. Anything already older than that is due for the next purge.
UPDATE "ai_conversations" SET "expires_at" = "updated_at" + interval '24 hours';

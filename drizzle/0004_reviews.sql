CREATE TYPE "public"."review_status" AS ENUM('generated', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "review_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "review_status" DEFAULT 'generated' NOT NULL,
	"facts" jsonb NOT NULL,
	"trends" jsonb NOT NULL,
	"observations" jsonb NOT NULL,
	"ai_insights" jsonb,
	"ai_generated_at" timestamp with time zone,
	"ai_model" text,
	"user_notes" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_user_period_idx" ON "reviews" USING btree ("user_id","type","period_start","period_end");--> statement-breakpoint
CREATE INDEX "reviews_user_recent_idx" ON "reviews" USING btree ("user_id","period_end");
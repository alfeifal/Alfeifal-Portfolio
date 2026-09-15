CREATE TYPE "public"."plan_horizon" AS ENUM('day', 'week');--> statement-breakpoint
CREATE TYPE "public"."plan_item_kind" AS ENUM('event', 'task', 'note');--> statement-breakpoint
CREATE TYPE "public"."plan_item_status" AS ENUM('proposed', 'accepted', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'accepted', 'partially_accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" "plan_item_kind" DEFAULT 'task' NOT NULL,
	"status" "plan_item_status" DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"date" date,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"estimated_minutes" integer,
	"event_kind" "event_kind",
	"priority" "priority",
	"project_id" uuid,
	"goal_id" uuid,
	"link" jsonb,
	"created_task_id" uuid,
	"created_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"horizon" "plan_horizon" DEFAULT 'day' NOT NULL,
	"period_key" text NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"title" text,
	"content" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"conversation_id" uuid,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"source" "data_source" DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_created_task_id_tasks_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_created_event_id_events_id_fk" FOREIGN KEY ("created_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_plan_idx" ON "plan_items" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "plan_items_user_idx" ON "plan_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "plans_user_period_idx" ON "plans" USING btree ("user_id","horizon","period_key");--> statement-breakpoint
CREATE INDEX "plans_user_status_idx" ON "plans" USING btree ("user_id","status");
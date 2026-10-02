CREATE INDEX "events_task_idx" ON "events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "events_goal_idx" ON "events" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_milestone_idx" ON "tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "personal_records_set_idx" ON "personal_records" USING btree ("set_id");
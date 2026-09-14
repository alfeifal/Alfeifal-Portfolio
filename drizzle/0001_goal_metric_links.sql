ALTER TABLE "goals" ADD COLUMN "metric_source" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "metric_kind" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "metric_ref" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "metric_period" text;--> statement-breakpoint
-- Legacy German time goals (category "german", unit "min", a target) were fed by a stored counter from the
-- German bridge. They become linked goals whose progress is computed from study_sessions on the German subject.
UPDATE "goals" SET "metric_source" = 'german', "metric_kind" = 'minutes', "metric_period" = 'total'
WHERE "metric_source" IS NULL AND "category" = 'german' AND "metric_unit" = 'min' AND "metric_target" IS NOT NULL AND "metric_target" > 0;

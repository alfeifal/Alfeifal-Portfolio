CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
DROP INDEX "notifications_dedupe_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_kind_name_uniq" ON "categories" USING btree ("user_id","kind",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_symbol_uniq" ON "watchlist_items" USING btree ("watchlist_id","symbol");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_category_uniq" UNIQUE NULLS NOT DISTINCT("user_id","category_id");

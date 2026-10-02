ALTER TABLE "entries" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "entries_user_id_date_idx" ON "entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_user_id_idx" ON "tasks" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "entries" DROP CONSTRAINT "entries_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;
CREATE TABLE "report_profiles" (
  "user_id" text NOT NULL,
  "profile_id" text NOT NULL,
  "project_id" text NOT NULL,
  "display_name" text NOT NULL,
  CONSTRAINT "report_profiles_user_id_profile_id_pk" PRIMARY KEY("user_id", "profile_id"),
  CONSTRAINT "report_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_profiles_owner_project_unique" ON "report_profiles" USING btree ("user_id", "project_id");
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "profile_id" text NOT NULL,
  "month" text NOT NULL,
  "display_name" text NOT NULL,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "source" text NOT NULL,
  "schema_version" integer NOT NULL,
  "algorithm_version" text NOT NULL,
  "input_digest" text NOT NULL,
  "active_ms" bigint,
  "run_ms" bigint,
  "commit_estimate_ms" bigint,
  "estimated_cost_cents" bigint,
  "payload" jsonb NOT NULL,
  CONSTRAINT "report_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "report_snapshots_source_valid" CHECK ("source" in ('import', 'generated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_identity_unique" ON "report_snapshots" USING btree ("user_id", "profile_id", "month", "schema_version", "algorithm_version", "input_digest");
--> statement-breakpoint
CREATE INDEX "report_snapshots_owner_month_idx" ON "report_snapshots" USING btree ("user_id", "profile_id", "month", "saved_at", "id");
--> statement-breakpoint
CREATE TABLE "report_days" (
  "snapshot_id" text NOT NULL,
  "date" date NOT NULL,
  "active_ms" bigint,
  "run_ms" bigint,
  "commit_count" integer NOT NULL,
  "commit_estimate_ms" bigint,
  "payload" jsonb NOT NULL,
  CONSTRAINT "report_days_snapshot_id_date_pk" PRIMARY KEY("snapshot_id", "date"),
  CONSTRAINT "report_days_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "profile_id" text NOT NULL,
  "month" text NOT NULL,
  "instance_id" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error_code" text,
  "snapshot_id" text,
  CONSTRAINT "report_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "report_runs_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE restrict,
  CONSTRAINT "report_runs_status_valid" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT "report_runs_error_valid" CHECK ("error_code" is null or "error_code" in ('COLLECT_FAILED', 'SAVE_FAILED', 'INTERRUPTED')),
  CONSTRAINT "report_runs_result_valid" CHECK (("status" = 'succeeded' and "snapshot_id" is not null and "finished_at" is not null and "error_code" is null) or ("status" <> 'succeeded' and "snapshot_id" is null))
);
--> statement-breakpoint
CREATE INDEX "report_runs_owner_idx" ON "report_runs" USING btree ("user_id", "id");
--> statement-breakpoint
CREATE INDEX "report_runs_instance_status_idx" ON "report_runs" USING btree ("instance_id", "status");

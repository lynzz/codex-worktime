CREATE TABLE "report_collectors" (
  "user_id" text NOT NULL,
  "instance_id" text NOT NULL,
  "profiles" jsonb NOT NULL,
  "lease_expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "report_collectors_user_id_instance_id_pk" PRIMARY KEY("user_id", "instance_id"),
  CONSTRAINT "report_collectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict
);

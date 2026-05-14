CREATE TABLE "nigerian_data_bundle_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"runRef" varchar(32) NOT NULL,
	"fullName" varchar(255),
	"nin" varchar(20),
	"bvn" varchar(22),
	"phone" varchar(20),
	"dateOfBirth" varchar(20),
	"selectedSources" json NOT NULL,
	"results" json NOT NULL,
	"overallScore" integer DEFAULT 0 NOT NULL,
	"verifiedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nigerian_data_bundle_runs_runRef_unique" UNIQUE("runRef")
);
--> statement-breakpoint
ALTER TABLE "nigerian_data_bundle_runs" ADD CONSTRAINT "nigerian_data_bundle_runs_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bundle_runs_created_at_idx" ON "nigerian_data_bundle_runs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "bundle_runs_nin_idx" ON "nigerian_data_bundle_runs" USING btree ("nin");--> statement-breakpoint
CREATE INDEX "bundle_runs_bvn_idx" ON "nigerian_data_bundle_runs" USING btree ("bvn");
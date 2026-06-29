ALTER TYPE "public"."investigation_status" ADD VALUE 'thin_file';--> statement-breakpoint
CREATE TABLE "field_visit_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitRef" varchar(32) NOT NULL,
	"taskRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"agentId" varchar(64) NOT NULL,
	"agentName" varchar(255) NOT NULL,
	"checkInAt" timestamp,
	"checkInLat" real,
	"checkInLng" real,
	"checkOutAt" timestamp,
	"checkOutLat" real,
	"checkOutLng" real,
	"durationMinutes" integer,
	"subjectPresent" boolean,
	"addressConfirmed" boolean,
	"findings" text,
	"structuredFindings" json,
	"photoUrls" json DEFAULT '[]'::json,
	"dataCompleteness" real,
	"sourcesChecked" json DEFAULT '[]'::json,
	"sourcesReturned" json DEFAULT '[]'::json,
	"recommendedNextSteps" json DEFAULT '[]'::json,
	"outcome" varchar(32),
	"submittedAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_visit_reports_visitRef_unique" UNIQUE("visitRef")
);
--> statement-breakpoint
ALTER TABLE "field_visit_reports" ADD CONSTRAINT "field_visit_reports_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fvr_task_idx" ON "field_visit_reports" USING btree ("taskRef");--> statement-breakpoint
CREATE INDEX "fvr_inv_idx" ON "field_visit_reports" USING btree ("investigationId");--> statement-breakpoint
CREATE INDEX "fvr_agent_idx" ON "field_visit_reports" USING btree ("agentId");
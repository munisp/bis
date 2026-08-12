CREATE TYPE "public"."access_review_status" AS ENUM('pending', 'approved', 'revoked', 'escalated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."insider_category" AS ENUM('data_exfiltration', 'privilege_abuse', 'off_hours_access', 'peer_anomaly', 'dead_man_switch', 'failed_auth_spike', 'unusual_ip', 'bulk_download', 'policy_violation', 'access_review_overdue');--> statement-breakpoint
CREATE TYPE "public"."insider_event_status" AS ENUM('open', 'under_review', 'escalated', 'dismissed', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."insider_severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "access_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"reviewType" varchar(64) DEFAULT 'periodic' NOT NULL,
	"status" "access_review_status" DEFAULT 'pending' NOT NULL,
	"triggeredBy" varchar(64),
	"insiderEventId" integer,
	"assignedTo" integer,
	"dueAt" timestamp NOT NULL,
	"completedAt" timestamp,
	"completedBy" integer,
	"decision" text,
	"permifyChanges" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"category" "insider_category" NOT NULL,
	"severity" "insider_severity" DEFAULT 'medium' NOT NULL,
	"status" "insider_event_status" DEFAULT 'open' NOT NULL,
	"anomalyScore" real,
	"driftScore" real,
	"sourceIp" varchar(64),
	"userAgent" text,
	"resourcePath" text,
	"payloadBytes" bigint,
	"ruleId" varchar(64),
	"evidence" json,
	"assignedTo" integer,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"resolution" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ueba_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"eventCount" integer DEFAULT 0 NOT NULL,
	"anomalyScore" real DEFAULT 0 NOT NULL,
	"driftScore" real DEFAULT 0 NOT NULL,
	"riskLevel" "insider_severity" DEFAULT 'info' NOT NULL,
	"hourHistogram" json,
	"dayHistogram" json,
	"uniqueIpCount" integer DEFAULT 0 NOT NULL,
	"offHoursRatio" real DEFAULT 0 NOT NULL,
	"privChangeCount" integer DEFAULT 0 NOT NULL,
	"failedAuthCount" integer DEFAULT 0 NOT NULL,
	"baselineReady" boolean DEFAULT false NOT NULL,
	"lastScoredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ueba_profiles_subjectId_unique" UNIQUE("subjectId")
);
--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_insiderEventId_insider_events_id_fk" FOREIGN KEY ("insiderEventId") REFERENCES "public"."insider_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_completedBy_users_id_fk" FOREIGN KEY ("completedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_events" ADD CONSTRAINT "insider_events_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_events" ADD CONSTRAINT "insider_events_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ar_subject_idx" ON "access_reviews" USING btree ("subjectId");--> statement-breakpoint
CREATE INDEX "ar_status_idx" ON "access_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ar_due_idx" ON "access_reviews" USING btree ("dueAt");--> statement-breakpoint
CREATE INDEX "ie_subject_idx" ON "insider_events" USING btree ("subjectId");--> statement-breakpoint
CREATE INDEX "ie_tenant_idx" ON "insider_events" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "ie_status_idx" ON "insider_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ie_severity_idx" ON "insider_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "ie_created_idx" ON "insider_events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "up_subject_idx" ON "ueba_profiles" USING btree ("subjectId");--> statement-breakpoint
CREATE INDEX "up_tenant_idx" ON "ueba_profiles" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "up_risk_idx" ON "ueba_profiles" USING btree ("riskLevel");
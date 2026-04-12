CREATE TABLE "export_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"exportType" varchar(64) NOT NULL,
	"format" varchar(16) DEFAULT 'csv' NOT NULL,
	"filters" json,
	"cronExpression" varchar(64) DEFAULT '0 8 * * 1' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lastRunAt" timestamp,
	"nextRunAt" timestamp,
	"lastFileUrl" varchar(1024),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationId" integer NOT NULL,
	"caseId" integer NOT NULL,
	"linkedBy" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"link" varchar(512),
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"sessionToken" varchar(255) NOT NULL,
	"ipAddress" varchar(45),
	"userAgent" text,
	"deviceName" varchar(255),
	"lastActiveAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_sessionToken_unique" UNIQUE("sessionToken")
);
--> statement-breakpoint
CREATE TABLE "user_totp_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"backupCodes" json DEFAULT '[]'::json,
	"enabledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_totp_secrets_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_linkedBy_users_id_fk" FOREIGN KEY ("linkedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp_secrets" ADD CONSTRAINT "user_totp_secrets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
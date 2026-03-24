CREATE TYPE "public"."alert_rule_metric" AS ENUM('risk_score', 'sanctions_confidence', 'pep_confidence', 'adverse_media_count', 'duplicate_identity_score', 'velocity_hourly', 'velocity_daily', 'credit_score');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_operator" AS ENUM('gt', 'gte', 'lt', 'lte', 'eq', 'neq');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"metric" "alert_rule_metric" NOT NULL,
	"operator" "alert_rule_operator" DEFAULT 'gte' NOT NULL,
	"threshold" real NOT NULL,
	"severity" "severity" DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"autoEscalate" boolean DEFAULT false NOT NULL,
	"notifyOwner" boolean DEFAULT true NOT NULL,
	"createdBy" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

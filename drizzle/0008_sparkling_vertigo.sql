CREATE TABLE "rule_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruleId" integer NOT NULL,
	"subjectRef" varchar(255) NOT NULL,
	"metric" varchar(64) NOT NULL,
	"value" real NOT NULL,
	"threshold" real NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"alertCreated" boolean DEFAULT false NOT NULL,
	"context" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_ruleId_alert_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;
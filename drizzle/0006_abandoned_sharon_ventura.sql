ALTER TABLE "alerts" ADD COLUMN "resolved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "resolvedBy" integer;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "resolvedAt" timestamp;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "dismissed" boolean DEFAULT false NOT NULL;
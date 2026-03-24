CREATE TYPE "public"."api_token_scope" AS ENUM('investigations:read', 'investigations:write', 'kyc:read', 'kyc:write', 'alerts:read', 'alerts:write', 'reports:read', 'reports:write', 'screening:read', 'screening:write', 'field_agents:read', 'field_agents:write', 'audit:read', 'data_sources:read', 'admin:read', 'admin:write');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"name" varchar(255) NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"scopes" json DEFAULT '[]'::json NOT NULL,
	"rateLimit" integer DEFAULT 60 NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "token_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tokenId" integer NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"statusCode" integer,
	"latencyMs" integer,
	"ipAddress" varchar(45),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD CONSTRAINT "token_usage_log_tokenId_api_tokens_id_fk" FOREIGN KEY ("tokenId") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;
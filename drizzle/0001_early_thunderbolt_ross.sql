CREATE TYPE "public"."key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('starter', 'professional', 'enterprise', 'government');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'trial', 'churned');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('active', 'paused', 'failed');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"keyHash" varchar(128) NOT NULL,
	"keyPrefix" varchar(16) NOT NULL,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"permissions" json DEFAULT '[]'::json,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" "tenant_plan" DEFAULT 'starter' NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"contactEmail" varchar(255),
	"contactName" varchar(255),
	"country" varchar(64),
	"industry" varchar(128),
	"monthlyQuota" integer DEFAULT 100 NOT NULL,
	"usedThisMonth" integer DEFAULT 0 NOT NULL,
	"ngnBalance" real DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"url" text NOT NULL,
	"status" "webhook_status" DEFAULT 'active' NOT NULL,
	"events" json DEFAULT '[]'::json,
	"secret" varchar(64),
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastDeliveredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

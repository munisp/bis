CREATE TYPE "public"."channel_status" AS ENUM('active', 'inactive', 'error', 'pending');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('whatsapp', 'telegram', 'ussd', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."incoming_report_status" AS ENUM('new', 'processing', 'verified', 'dismissed', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."mention_sentiment" AS ENUM('positive', 'neutral', 'negative', 'critical');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('twitter', 'facebook', 'instagram', 'tiktok', 'linkedin', 'news', 'whatsapp_group', 'youtube');--> statement-breakpoint
CREATE TABLE "incoming_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"channelId" integer NOT NULL,
	"channelType" "channel_type" NOT NULL,
	"sender" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"status" "incoming_report_status" DEFAULT 'new' NOT NULL,
	"riskScore" integer DEFAULT 0 NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"attachmentCount" integer DEFAULT 0 NOT NULL,
	"linkedSubjectRef" varchar(32),
	"linkedInvestigationRef" varchar(32),
	"assignedTo" integer,
	"metadata" text,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"channelType" "channel_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"status" "channel_status" DEFAULT 'inactive' NOT NULL,
	"webhookUrl" varchar(500),
	"apiKey" varchar(255),
	"totalReports" integer DEFAULT 0 NOT NULL,
	"todayReports" integer DEFAULT 0 NOT NULL,
	"activeUsers" integer DEFAULT 0 NOT NULL,
	"lastActivityAt" timestamp,
	"config" text,
	"tenantId" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"monitorId" integer NOT NULL,
	"platform" "social_platform" NOT NULL,
	"content" text NOT NULL,
	"author" varchar(100) NOT NULL,
	"authorHandle" varchar(100),
	"externalUrl" varchar(500),
	"sentiment" "mention_sentiment" DEFAULT 'neutral' NOT NULL,
	"riskScore" integer DEFAULT 0 NOT NULL,
	"keywords" text,
	"engagementCount" integer DEFAULT 0 NOT NULL,
	"isVerified" boolean DEFAULT false NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"isAcknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgedBy" integer,
	"publishedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_monitor_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"keywords" text NOT NULL,
	"platforms" text NOT NULL,
	"subjectRef" varchar(32),
	"investigationRef" varchar(32),
	"isActive" boolean DEFAULT true NOT NULL,
	"alertThreshold" integer DEFAULT 60 NOT NULL,
	"totalMentions" integer DEFAULT 0 NOT NULL,
	"criticalMentions" integer DEFAULT 0 NOT NULL,
	"lastMentionAt" timestamp,
	"tenantId" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

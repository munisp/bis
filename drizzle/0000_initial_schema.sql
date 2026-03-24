CREATE TYPE "public"."agent_status" AS ENUM('active', 'inactive', 'suspended', 'training');--> statement-breakpoint
CREATE TYPE "public"."agent_tier" AS ENUM('junior', 'senior', 'lead', 'specialist');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('sanctions_hit', 'pep_detected', 'risk_threshold', 'velocity', 'adverse_media', 'field_report', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_category" AS ENUM('investigation', 'kyc', 'alert', 'report', 'user', 'system', 'api');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('success', 'warning', 'failure');--> statement-breakpoint
CREATE TYPE "public"."data_source_category" AS ENUM('identity', 'financial', 'legal', 'social', 'biometric', 'government', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."data_source_status" AS ENUM('active', 'degraded', 'offline', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('draft', 'pending', 'processing', 'completed', 'flagged', 'archived');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'processing', 'passed', 'failed', 'review');--> statement-breakpoint
CREATE TYPE "public"."monitor_status" AS ENUM('active', 'paused', 'triggered', 'expired');--> statement-breakpoint
CREATE TYPE "public"."monitor_type" AS ENUM('sanctions', 'pep', 'adverse_media', 'social', 'transaction', 'biometric');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."report_format" AS ENUM('pdf', 'docx', 'csv', 'json');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."screening_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'review');--> statement-breakpoint
CREATE TYPE "public"."screening_type" AS ENUM('mvr', 'drug', 'work_authorization', 'biometric', 'zero_footprint');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('individual', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'dispatched', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('address_verification', 'biometric_capture', 'document_collection', 'surveillance', 'interview');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('basic', 'standard', 'comprehensive');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'analyst', 'supervisor');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationId" integer,
	"type" "alert_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"subjectRef" varchar(64),
	"sourceService" varchar(64),
	"read" boolean DEFAULT false NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"userEmail" varchar(320),
	"category" "audit_category" NOT NULL,
	"action" varchar(255) NOT NULL,
	"targetRef" varchar(64),
	"result" "audit_result" DEFAULT 'success' NOT NULL,
	"ipAddress" varchar(45),
	"detail" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" "data_source_category" NOT NULL,
	"status" "data_source_status" DEFAULT 'active' NOT NULL,
	"provider" varchar(128),
	"baseUrl" text,
	"apiKeyRef" varchar(128),
	"description" text,
	"recordCount" integer DEFAULT 0,
	"lastSyncAt" timestamp,
	"uptimePct" real DEFAULT 100,
	"avgResponseMs" integer DEFAULT 0,
	"requestsToday" integer DEFAULT 0,
	"requestsTotal" integer DEFAULT 0,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "field_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentCode" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(20),
	"state" varchar(64),
	"lga" varchar(64),
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"tier" "agent_tier" DEFAULT 'junior' NOT NULL,
	"specializations" json DEFAULT '[]'::json,
	"tasksCompleted" integer DEFAULT 0 NOT NULL,
	"tasksActive" integer DEFAULT 0 NOT NULL,
	"rating" real DEFAULT 0,
	"gpsLat" real,
	"gpsLng" real,
	"lastSeen" timestamp,
	"notes" text,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_agents_agentCode_unique" UNIQUE("agentCode"),
	CONSTRAINT "field_agents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "field_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"taskRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"agentId" varchar(64) NOT NULL,
	"agentName" varchar(255) NOT NULL,
	"taskType" "task_type" NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"subjectName" varchar(255),
	"address" text,
	"state" varchar(64),
	"lga" varchar(64),
	"gpsLat" real,
	"gpsLng" real,
	"deadline" timestamp,
	"instructions" text,
	"result" json,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "field_tasks_taskRef_unique" UNIQUE("taskRef")
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" varchar(32) NOT NULL,
	"subjectType" "subject_type" NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"country" varchar(3) DEFAULT 'NG' NOT NULL,
	"tier" "tier" DEFAULT 'standard' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "investigation_status" DEFAULT 'pending' NOT NULL,
	"riskScore" real,
	"riskTier" "risk_tier",
	"nin" varchar(11),
	"bvn" varchar(11),
	"rcNumber" varchar(20),
	"phone" varchar(20),
	"email" varchar(320),
	"address" text,
	"purpose" text,
	"assignedTo" integer,
	"createdBy" integer NOT NULL,
	"dataSources" json,
	"gatewayResults" json,
	"riskFactors" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "investigations_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationId" integer,
	"subjectName" varchar(255) NOT NULL,
	"nin" varchar(11),
	"bvn" varchar(11),
	"dob" varchar(10),
	"phone" varchar(20),
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"riskScore" real,
	"ninResult" json,
	"bvnResult" json,
	"sanctionsResult" json,
	"pepResult" json,
	"creditResult" json,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"monitorRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"subjectName" varchar(255) NOT NULL,
	"subjectRef" varchar(64),
	"type" "monitor_type" NOT NULL,
	"status" "monitor_status" DEFAULT 'active' NOT NULL,
	"frequency" varchar(32) DEFAULT 'daily' NOT NULL,
	"lastCheckedAt" timestamp,
	"nextCheckAt" timestamp,
	"alertCount" integer DEFAULT 0 NOT NULL,
	"lastAlertAt" timestamp,
	"expiresAt" timestamp,
	"config" json,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitors_monitorRef_unique" UNIQUE("monitorRef")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reportRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"template" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"format" "report_format" DEFAULT 'pdf' NOT NULL,
	"status" "report_status" DEFAULT 'generating' NOT NULL,
	"fileUrl" text,
	"sections" json,
	"generatedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reportRef_unique" UNIQUE("reportRef")
);
--> statement-breakpoint
CREATE TABLE "screening_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"type" "screening_type" NOT NULL,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"subjectType" "subject_type" DEFAULT 'individual' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"requestData" json,
	"result" json,
	"resultSummary" text,
	"riskScore" real,
	"processedBy" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "screening_requests_requestRef_unique" UNIQUE("requestRef")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'analyst' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);

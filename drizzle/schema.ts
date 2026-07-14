import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  date,
  varchar,
  real,
  boolean,
  json,
  jsonb,
  serial,
  index,
  uniqueIndex,
  bigint,
  uuid,
  inet,
  check,
  pgView,
  pgMaterializedView,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "analyst", "supervisor", "auditor", "readonly"]);
export const subjectTypeEnum = pgEnum("subject_type", ["individual", "corporate"]);
export const tierEnum = pgEnum("tier", ["basic", "standard", "comprehensive"]);
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const investigationStatusEnum = pgEnum("investigation_status", ["draft", "pending", "processing", "completed", "flagged", "archived", "thin_file"]);
export const riskTierEnum = pgEnum("risk_tier", ["low", "medium", "high", "critical"]);
export const alertTypeEnum = pgEnum("alert_type", ["sanctions_hit", "pep_detected", "risk_threshold", "velocity", "adverse_media", "field_report", "system"]);
export const severityEnum = pgEnum("severity", ["info", "low", "medium", "high", "critical"]);
export const kycStatusEnum = pgEnum("kyc_status", ["pending", "processing", "passed", "failed", "review"]);
export const auditCategoryEnum = pgEnum("audit_category", ["investigation", "kyc", "alert", "report", "user", "system", "api"]);
export const auditResultEnum = pgEnum("audit_result", ["success", "warning", "failure"]);
export const taskTypeEnum = pgEnum("task_type", ["address_verification", "biometric_capture", "document_collection", "surveillance", "interview"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "dispatched", "in_progress", "completed", "failed", "cancelled"]);
export const reportFormatEnum = pgEnum("report_format", ["pdf", "docx", "csv", "json"]);
export const reportStatusEnum = pgEnum("report_status", ["generating", "ready", "failed"]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),  // null for platform admins
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("analyst").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  pushToken: varchar("pushToken", { length: 512 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Investigations ───────────────────────────────────────────────────────────

export const investigations = pgTable("investigations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  ref: varchar("ref", { length: 32 }).notNull().unique(),
  subjectType: subjectTypeEnum("subjectType").notNull(),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  country: varchar("country", { length: 3 }).notNull().default("NG"),
  tier: tierEnum("tier").notNull().default("standard"),
  priority: priorityEnum("priority").notNull().default("medium"),
  status: investigationStatusEnum("status").notNull().default("pending"),
  riskScore: real("riskScore"),
  riskTier: riskTierEnum("riskTier"),
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  rcNumber: varchar("rcNumber", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  purpose: text("purpose"),
  assignedTo: integer("assignedTo"),
  createdBy: integer("createdBy").notNull(),
  dataSources: jsonb("dataSources"),
  gatewayResults: jsonb("gatewayResults"),
  riskFactors: jsonb("riskFactors"),
  dueAt: timestamp("dueAt"),
  // Link to NG Screening candidate profile — set when a background check is initiated from this investigation
  candidateProfileId: integer("candidateProfileId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
},
  (table) => ({
    investigations_status_idx: index("investigations_status_idx").on(table.status),
    investigations_created_at_idx: index("investigations_created_at_idx").on(table.createdAt),
    investigations_updated_at_idx: index("investigations_updated_at_idx").on(table.updatedAt),
    investigations_assigned_to_idx: index("investigations_assigned_to_idx").on(table.assignedTo),
    investigations_created_by_idx: index("investigations_created_by_idx").on(table.createdBy),
    investigations_risk_score_idx: index("investigations_risk_score_idx").on(table.riskScore),
    investigations_subject_name_idx: index("investigations_subject_name_idx").on(table.subjectName),
    investigations_nin_idx: index("investigations_nin_idx").on(table.nin),
    investigations_bvn_idx: index("investigations_bvn_idx").on(table.bvn),
    investigations_tenant_status_idx: uniqueIndex("investigations_tenant_status_idx").on(table.tenantId, table.ref),
    investigations_deleted_at_idx: index("investigations_deleted_at_idx").on(table.deletedAt),
    investigations_risk_score_check: check("investigations_risk_score_check", sql`"riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100)`),
    investigations_search_idx: index("investigations_search_idx").using("gin", sql`to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", ''))`),
  }));

export type Investigation = typeof investigations.$inferSelect;
export type InsertInvestigation = typeof investigations.$inferInsert;

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  investigationId: integer("investigationId"),
  type: alertTypeEnum("type").notNull(),
  severity: severityEnum("severity").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  subjectRef: varchar("subjectRef", { length: 64 }),
  sourceService: varchar("sourceService", { length: 64 }),
  read: boolean("read").notNull().default(false),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: integer("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  dismissed: boolean("dismissed").notNull().default(false),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    alerts_created_at_idx: index("alerts_created_at_idx").on(table.createdAt),
    alerts_read_idx: index("alerts_read_idx").on(table.read),
    alerts_acknowledged_idx: index("alerts_acknowledged_idx").on(table.acknowledged),
    alerts_severity_idx: index("alerts_severity_idx").on(table.severity),
    alerts_investigation_id_idx: index("alerts_investigation_id_idx").on(table.investigationId),
    alerts_subject_ref_idx: index("alerts_subject_ref_idx").on(table.subjectRef),
  }));

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ─── KYC Records ─────────────────────────────────────────────────────────────

export const kycRecords = pgTable("kyc_records", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  investigationId: integer("investigationId"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  dob: varchar("dob", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  status: kycStatusEnum("status").notNull().default("pending"),
  riskScore: real("riskScore"),
  ninResult: jsonb("ninResult"),
  bvnResult: jsonb("bvnResult"),
  sanctionsResult: jsonb("sanctionsResult"),
  pepResult: jsonb("pepResult"),
  creditResult: jsonb("creditResult"),
  subjectRef: varchar("subjectRef", { length: 64 }),
  onboardingApplicationId: integer("onboardingApplicationId"),
  biometricStatus: varchar("biometricStatus", { length: 32 }).default("not_enrolled"),
  biometricFaceId: varchar("biometricFaceId", { length: 128 }),
  documentOcrData: jsonb("documentOcrData"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    kyc_records_status_idx: index("kyc_records_status_idx").on(table.status),
    kyc_records_created_at_idx: index("kyc_records_created_at_idx").on(table.createdAt),
    kyc_records_created_by_idx: index("kyc_records_created_by_idx").on(table.createdBy),
    kyc_records_investigation_id_idx: index("kyc_records_investigation_id_idx").on(table.investigationId),
    kyc_records_nin_idx: index("kyc_records_nin_idx").on(table.nin),
    kyc_records_bvn_idx: index("kyc_records_bvn_idx").on(table.bvn),
    kyc_records_onboarding_app_idx: index("kyc_records_onboarding_app_idx").on(table.onboardingApplicationId),
    kyc_records_risk_score_check: check("kyc_records_risk_score_check", sql`"riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100)`),
    kyc_records_search_idx: index("kyc_records_search_idx").using("gin", sql`to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", ''))`),
  }));
export type KycRecord = typeof kycRecords.$inferSelect;
export type InsertKycRecord = typeof kycRecords.$inferInsert;

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  userId: integer("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  category: auditCategoryEnum("category").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  targetRef: varchar("targetRef", { length: 64 }),
  result: auditResultEnum("result").notNull().default("success"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  detail: jsonb("detail"),
  // HMAC-SHA256 integrity hash for tamper detection
  // Computed as: HMAC-SHA256(AUDIT_HMAC_SECRET, userId|category|action|targetRef|result|createdAt)
  integrityHash: varchar("integrityHash", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    audit_log_created_at_idx: index("audit_log_created_at_idx").on(table.createdAt),
    audit_log_user_id_idx: index("audit_log_user_id_idx").on(table.userId),
    audit_log_category_idx: index("audit_log_category_idx").on(table.category),
    audit_log_target_ref_idx: index("audit_log_target_ref_idx").on(table.targetRef),
  }));

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

// ─── Field Tasks ──────────────────────────────────────────────────────────────

export const fieldTasks = pgTable("field_tasks", {
  id: serial("id").primaryKey(),
  taskRef: varchar("taskRef", { length: 32 }).notNull().unique(),
  investigationId: integer("investigationId"),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  taskType: taskTypeEnum("taskType").notNull(),
  priority: priorityEnum("priority").notNull().default("medium"),
  status: taskStatusEnum("status").notNull().default("pending"),
  subjectName: varchar("subjectName", { length: 255 }),
  address: text("address"),
  state: varchar("state", { length: 64 }),
  lga: varchar("lga", { length: 64 }),
  gpsLat: real("gpsLat"),
  gpsLng: real("gpsLng"),
  deadline: timestamp("deadline"),
  instructions: text("instructions"),
  result: jsonb("result"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
},
  (table) => ({
    field_tasks_status_idx: index("field_tasks_status_idx").on(table.status),
    field_tasks_created_at_idx: index("field_tasks_created_at_idx").on(table.createdAt),
    field_tasks_investigation_id_idx: index("field_tasks_investigation_id_idx").on(table.investigationId),
    field_tasks_agent_id_idx: index("field_tasks_agent_id_idx").on(table.agentId),
    field_tasks_priority_idx: index("field_tasks_priority_idx").on(table.priority),
  }));

export type FieldTask = typeof fieldTasks.$inferSelect;
export type InsertFieldTask = typeof fieldTasks.$inferInsert;

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reportRef: varchar("reportRef", { length: 32 }).notNull().unique(),
  investigationId: integer("investigationId"),
  template: varchar("template", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  format: reportFormatEnum("format").notNull().default("pdf"),
  status: reportStatusEnum("status").notNull().default("generating"),
  fileUrl: text("fileUrl"),
  sections: jsonb("sections"),
  generatedBy: integer("generatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    reports_status_idx: index("reports_status_idx").on(table.status),
    reports_created_at_idx: index("reports_created_at_idx").on(table.createdAt),
    reports_generated_by_idx: index("reports_generated_by_idx").on(table.generatedBy),
    reports_investigation_id_idx: index("reports_investigation_id_idx").on(table.investigationId),
  }));

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

// ─── Additional Enums ─────────────────────────────────────────────────────────

export const agentStatusEnum = pgEnum("agent_status", ["active", "inactive", "suspended", "training"]);
export const agentTierEnum = pgEnum("agent_tier", ["junior", "senior", "lead", "specialist"]);
export const dataSourceStatusEnum = pgEnum("data_source_status", ["active", "degraded", "offline", "maintenance"]);
export const dataSourceCategoryEnum = pgEnum("data_source_category", ["identity", "financial", "legal", "social", "biometric", "government", "commercial"]);
export const monitorStatusEnum = pgEnum("monitor_status", ["active", "paused", "triggered", "expired"]);
export const monitorTypeEnum = pgEnum("monitor_type", ["sanctions", "pep", "adverse_media", "social", "transaction", "biometric"]);
export const screeningTypeEnum = pgEnum("screening_type", [
  // Legacy types
  "mvr", "drug", "work_authorization", "biometric", "zero_footprint",
  // Nigerian Identity
  "nin_trace", "bvn_fraud_check", "nin_address_history",
  // Criminal & Watchlist
  "npf_criminal", "efcc_watchlist", "icpc_debarment", "ndlea_drug",
  "state_court", "federal_court", "pep_check", "adverse_media_ng",
  // Driving & Transport
  "frsc_mvr", "frsc_commercial_driver",
  // Education
  "waec_education", "neco_education", "nabteb_education",
  // Employment & Pension
  "employment_verification", "pencom_history", "nysc_discharge",
  // Professional Licences
  "professional_licence",
  // Corporate
  "cac_directorship",
  "cac_full_profile",
  "firs_tax_clearance",
  "beneficial_owner",
  "corporate_sanctions",
  // Healthcare
  "mdcn_licence",
  // Work Permits
  "nis_work_permit",
  // International
  "international_criminal", "international_education", "international_employment",
  // Continuous
  "continuous_check"
]);
export const screeningStatusEnum = pgEnum("screening_status", ["pending", "processing", "completed", "failed", "review"]);

// ─── Field Agents ─────────────────────────────────────────────────────────────

export const fieldAgents = pgTable("field_agents", {
  id: serial("id").primaryKey(),
  agentCode: varchar("agentCode", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  state: varchar("state", { length: 64 }),
  lga: varchar("lga", { length: 64 }),
  status: agentStatusEnum("status").notNull().default("active"),
  tier: agentTierEnum("tier").notNull().default("junior"),
  specializations: jsonb("specializations").$type<string[]>().default([]),
  tasksCompleted: integer("tasksCompleted").notNull().default(0),
  tasksActive: integer("tasksActive").notNull().default(0),
  rating: real("rating").default(0),
  gpsLat: real("gpsLat"),
  gpsLng: real("gpsLng"),
  lastSeen: timestamp("lastSeen"),
  notes: text("notes"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    field_agents_status_idx: index("field_agents_status_idx").on(table.status),
    field_agents_state_idx: index("field_agents_state_idx").on(table.state),
    field_agents_created_at_idx: index("field_agents_created_at_idx").on(table.createdAt),
  }));
export type FieldAgent = typeof fieldAgents.$inferSelect;
export type InsertFieldAgent = typeof fieldAgents.$inferInsert;

// ─── Data Sources ─────────────────────────────────────────────────────────────

export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: dataSourceCategoryEnum("category").notNull(),
  status: dataSourceStatusEnum("status").notNull().default("active"),
  provider: varchar("provider", { length: 128 }),
  baseUrl: text("baseUrl"),
  apiKeyRef: varchar("apiKeyRef", { length: 128 }),
  description: text("description"),
  recordCount: integer("recordCount").default(0),
  lastSyncAt: timestamp("lastSyncAt"),
  uptimePct: real("uptimePct").default(100),
  avgResponseMs: integer("avgResponseMs").default(0),
  requestsToday: integer("requestsToday").default(0),
  requestsTotal: integer("requestsTotal").default(0),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config"),
  lastCheckedAt: timestamp("lastCheckedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = typeof dataSources.$inferInsert;

// ─── Monitors ─────────────────────────────────────────────────────────────────

export const monitors = pgTable("monitors", {
  id: serial("id").primaryKey(),
  monitorRef: varchar("monitorRef", { length: 32 }).notNull().unique(),
  investigationId: integer("investigationId"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  subjectRef: varchar("subjectRef", { length: 64 }),
  type: monitorTypeEnum("type").notNull(),
  status: monitorStatusEnum("status").notNull().default("active"),
  frequency: varchar("frequency", { length: 32 }).notNull().default("daily"),
  lastCheckedAt: timestamp("lastCheckedAt"),
  nextCheckAt: timestamp("nextCheckAt"),
  alertCount: integer("alertCount").notNull().default(0),
  lastAlertAt: timestamp("lastAlertAt"),
  expiresAt: timestamp("expiresAt"),
  config: jsonb("config"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    monitors_status_idx: index("monitors_status_idx").on(table.status),
    monitors_created_at_idx: index("monitors_created_at_idx").on(table.createdAt),
    monitors_created_by_idx: index("monitors_created_by_idx").on(table.createdBy),
  }));
export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = typeof monitors.$inferInsert;

// ─── Screening Requests ───────────────────────────────────────────────────────

export const screeningRequests = pgTable("screening_requests", {
  id: serial("id").primaryKey(),
  requestRef: varchar("requestRef", { length: 32 }).notNull().unique(),
  investigationId: integer("investigationId"),
  type: screeningTypeEnum("type").notNull(),
  status: screeningStatusEnum("status").notNull().default("pending"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  subjectType: subjectTypeEnum("subjectType").notNull().default("individual"),
  priority: priorityEnum("priority").notNull().default("medium"),
  requestData: jsonb("requestData"),
  result: jsonb("result"),
  resultSummary: text("resultSummary"),
  riskScore: real("riskScore"),
  processedBy: integer("processedBy"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
},
  (table) => ({
    screening_requests_status_idx: index("screening_requests_status_idx").on(table.status),
    screening_requests_created_at_idx: index("screening_requests_created_at_idx").on(table.createdAt),
    screening_requests_created_by_idx: index("screening_requests_created_by_idx").on(table.createdBy),
  }));
export type ScreeningRequest = typeof screeningRequests.$inferSelect;
export type InsertScreeningRequest = typeof screeningRequests.$inferInsert;

// ─── Tenants ──────────────────────────────────────────────────────────────────

export const tenantPlanEnum = pgEnum("tenant_plan", ["starter", "professional", "enterprise", "government"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "trial", "churned"]);
export const keyStatusEnum = pgEnum("key_status", ["active", "revoked", "expired"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["active", "paused", "failed"]);

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  plan: tenantPlanEnum("plan").notNull().default("starter"),
  status: tenantStatusEnum("status").notNull().default("trial"),
  contactEmail: varchar("contactEmail", { length: 255 }),
  contactName: varchar("contactName", { length: 255 }),
  country: varchar("country", { length: 64 }),
  industry: varchar("industry", { length: 128 }),
  monthlyQuota: integer("monthlyQuota").notNull().default(100),
  usedThisMonth: integer("usedThisMonth").notNull().default(0),
  ngnBalance: real("ngnBalance").notNull().default(0),
  logoUrl: text("logoUrl"),
  primaryColor: varchar("primaryColor", { length: 32 }),
  reportFooter: text("reportFooter"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  keyHash: varchar("keyHash", { length: 128 }).notNull().unique(),
  keyPrefix: varchar("keyPrefix", { length: 16 }).notNull(),
  status: keyStatusEnum("status").notNull().default("active"),
  permissions: jsonb("permissions").$type<string[]>().default([]),
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").notNull(),
  url: text("url").notNull(),
  status: webhookStatusEnum("status").notNull().default("active"),
  events: jsonb("events").$type<string[]>().default([]),
  secret: varchar("secret", { length: 64 }),
  failureCount: integer("failureCount").notNull().default(0),
  lastDeliveredAt: timestamp("lastDeliveredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;

// ─── Platform Settings ────────────────────────────────────────────────────────
export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  namespace: varchar("namespace", { length: 64 }).notNull().default("default"),
  key: varchar("key", { length: 128 }).notNull(),
  value: jsonb("value"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  updatedBy: varchar("updatedBy", { length: 255 }),
});
export type PlatformSetting = typeof platformSettings.$inferSelect;
export type InsertPlatformSetting = typeof platformSettings.$inferInsert;

// ─── Onboarding Applications ──────────────────────────────────────────────────
export const onboardingApplicationStatusEnum = pgEnum("onboarding_application_status", [
  "draft", "submitted", "awaiting_documents", "under_review", "approved", "rejected",
]);
export const onboardingApplications = pgTable("onboarding_applications", {
  id: serial("id").primaryKey(),
  referenceId: varchar("referenceId", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 32 }).notNull(),
  legalName: varchar("legalName", { length: 255 }).notNull(),
  tradingName: varchar("tradingName", { length: 255 }),
  countryCode: varchar("countryCode", { length: 8 }),
  stateProvince: varchar("stateProvince", { length: 128 }),
  city: varchar("city", { length: 128 }),
  address: text("address"),
  website: varchar("website", { length: 255 }),
  businessCategory: varchar("businessCategory", { length: 128 }),
  contactName: varchar("contactName", { length: 255 }),
  contactEmail: varchar("contactEmail", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 64 }),
  contactTitle: varchar("contactTitle", { length: 128 }),
  useCase: text("useCase"),
  pepDeclaration: boolean("pepDeclaration").default(false),
  agreedToTerms: boolean("agreedToTerms").default(false),
  status: onboardingApplicationStatusEnum("status").notNull().default("draft"),
  stakeholders: jsonb("stakeholders").$type<any[]>().default([]),
  documentUrls: jsonb("documentUrls").$type<{ name: string; url: string; key: string; uploadedAt: string }[]>().default([]),
  createdBy: varchar("createdBy", { length: 255 }),
  adminNotes: text("adminNotes"),
  reviewerLog: jsonb("reviewerLog").$type<Array<{ authorId: number; authorName: string; note: string; createdAt: string }>>().default([]),
  slaDeadline: timestamp("slaDeadline"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    onboarding_apps_status_idx: index("onboarding_apps_status_idx").on(table.status),
    onboarding_apps_created_at_idx: index("onboarding_apps_created_at_idx").on(table.createdAt),
    onboarding_apps_created_by_idx: index("onboarding_apps_created_by_idx").on(table.createdBy),
  }));
export type OnboardingApplication = typeof onboardingApplications.$inferSelect;
export type InsertOnboardingApplication = typeof onboardingApplications.$inferInsert;

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export const alertRuleMetricEnum = pgEnum("alert_rule_metric", [
  "risk_score",
  "sanctions_confidence",
  "pep_confidence",
  "adverse_media_count",
  "duplicate_identity_score",
  "velocity_hourly",
  "velocity_daily",
  "credit_score",
]);

export const alertRuleOperatorEnum = pgEnum("alert_rule_operator", [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
]);

export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  metric: alertRuleMetricEnum("metric").notNull(),
  operator: alertRuleOperatorEnum("operator").notNull().default("gte"),
  threshold: real("threshold").notNull(),
  severity: severityEnum("severity").notNull().default("high"),
  enabled: boolean("enabled").notNull().default(true),
  autoEscalate: boolean("autoEscalate").notNull().default(false),
  notifyOwner: boolean("notifyOwner").notNull().default(true),
  createdBy: varchar("createdBy", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AlertRule = typeof alertRules.$inferSelect;
export type InsertAlertRule = typeof alertRules.$inferInsert;

// ─── Alert Rule Evaluations ───────────────────────────────────────────────────
export const ruleEvaluations = pgTable("rule_evaluations", {
  id: serial("id").primaryKey(),
  ruleId: integer("ruleId").notNull().references(() => alertRules.id, { onDelete: "cascade" }),
  subjectRef: varchar("subjectRef", { length: 255 }).notNull(),
  metric: varchar("metric", { length: 64 }).notNull(),
  value: real("value").notNull(),
  threshold: real("threshold").notNull(),
  triggered: boolean("triggered").notNull().default(false),
  alertCreated: boolean("alertCreated").notNull().default(false),
  context: text("context"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    rule_evaluations_created_at_idx: index("rule_evaluations_created_at_idx").on(table.createdAt),
    rule_evaluations_rule_id_idx: index("rule_evaluations_rule_id_idx").on(table.ruleId),
    rule_evaluations_triggered_idx: index("rule_evaluations_triggered_idx").on(table.triggered),
  }));
export type RuleEvaluation = typeof ruleEvaluations.$inferSelect;
export type InsertRuleEvaluation = typeof ruleEvaluations.$inferInsert;

// ─── Developer API Tokens ─────────────────────────────────────────────────────

export const apiTokenScopeEnum = pgEnum("api_token_scope", [
  "investigations:read",
  "investigations:write",
  "kyc:read",
  "kyc:write",
  "alerts:read",
  "alerts:write",
  "reports:read",
  "reports:write",
  "screening:read",
  "screening:write",
  "field_agents:read",
  "field_agents:write",
  "audit:read",
  "data_sources:read",
  "admin:read",
  "admin:write",
]);

export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  name: varchar("name", { length: 255 }).notNull(),
  /** Displayed prefix only — e.g. "bisk_live_AbCd" */
  prefix: varchar("prefix", { length: 20 }).notNull(),
  /** SHA-256 hash of the full token — never store plaintext */
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  /** Requests per minute limit */
  rateLimit: integer("rateLimit").notNull().default(60),
  usageCount: integer("usageCount").notNull().default(0),
  tokensConsumed: integer("tokensConsumed").notNull().default(0),
  /** Maximum tokens allowed per billing period; null = unlimited */
  tokenQuota: integer("tokenQuota"),
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = typeof apiTokens.$inferInsert;

// ─── Token Usage Log ──────────────────────────────────────────────────────────

export const tokenUsageLog = pgTable("token_usage_log", {
  id: serial("id").primaryKey(),
  tokenId: integer("tokenId").notNull().references(() => apiTokens.id, { onDelete: "cascade" }),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull().default("GET"),
  statusCode: integer("statusCode"),
  latencyMs: integer("latencyMs"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TokenUsageLog = typeof tokenUsageLog.$inferSelect;
export type InsertTokenUsageLog = typeof tokenUsageLog.$inferInsert;

// ─── goAML STR Filings ────────────────────────────────────────────────────────

export const strStatusEnum = pgEnum("str_status", ["draft", "submitted", "accepted", "rejected", "pending_review"]);

export const goamlFilings = pgTable("goaml_filings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  filingRef: varchar("filingRef", { length: 32 }).notNull().unique(),
  investigationRef: varchar("investigationRef", { length: 32 }),
  status: strStatusEnum("status").notNull().default("draft"),
  reportType: varchar("reportType", { length: 32 }).notNull().default("STR"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  subjectBvn: varchar("subjectBvn", { length: 20 }),
  subjectNin: varchar("subjectNin", { length: 20 }),
  subjectAccountNumber: varchar("subjectAccountNumber", { length: 30 }),
  subjectBank: varchar("subjectBank", { length: 100 }),
  transactionDate: timestamp("transactionDate"),
  transactionAmount: real("transactionAmount"),
  transactionCurrency: varchar("transactionCurrency", { length: 3 }).default("NGN"),
  suspiciousActivity: text("suspiciousActivity").notNull(),
  narrativeDetails: text("narrativeDetails"),
  goamlXml: text("goamlXml"),
  goamlReferenceNumber: varchar("goamlReferenceNumber", { length: 64 }),
  submittedAt: timestamp("submittedAt"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    goaml_filings_status_idx: index("goaml_filings_status_idx").on(table.status),
    goaml_filings_created_at_idx: index("goaml_filings_created_at_idx").on(table.createdAt),
  }));

export type GoamlFiling = typeof goamlFilings.$inferSelect;
export type InsertGoamlFiling = typeof goamlFilings.$inferInsert;

// ─── Messaging Channels ───────────────────────────────────────────────────────
export const channelTypeEnum = pgEnum("channel_type", ["whatsapp", "telegram", "ussd", "sms", "email"]);
export const channelStatusEnum = pgEnum("channel_status", ["active", "inactive", "error", "pending"]);
export const incomingReportStatusEnum = pgEnum("incoming_report_status", ["new", "processing", "verified", "dismissed", "escalated"]);

export const messagingChannels = pgTable("messaging_channels", {
  id: serial("id").primaryKey(),
  channelType: channelTypeEnum("channelType").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  identifier: varchar("identifier", { length: 100 }).notNull(),
  status: channelStatusEnum("status").notNull().default("inactive"),
  webhookUrl: varchar("webhookUrl", { length: 500 }),
  apiKey: varchar("apiKey", { length: 255 }),
  totalReports: integer("totalReports").notNull().default(0),
  todayReports: integer("todayReports").notNull().default(0),
  activeUsers: integer("activeUsers").notNull().default(0),
  lastActivityAt: timestamp("lastActivityAt"),
  config: text("config"),
  tenantId: integer("tenantId"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const incomingReports = pgTable("incoming_reports", {
  id: serial("id").primaryKey(),
  channelId: integer("channelId").notNull(),
  channelType: channelTypeEnum("channelType").notNull(),
  sender: varchar("sender", { length: 100 }).notNull(),
  content: text("content").notNull(),
  status: incomingReportStatusEnum("status").notNull().default("new"),
  riskScore: integer("riskScore").notNull().default(0),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  attachmentCount: integer("attachmentCount").notNull().default(0),
  linkedSubjectRef: varchar("linkedSubjectRef", { length: 32 }),
  linkedInvestigationRef: varchar("linkedInvestigationRef", { length: 32 }),
  assignedTo: integer("assignedTo"),
  metadata: text("metadata"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type MessagingChannel = typeof messagingChannels.$inferSelect;
export type InsertMessagingChannel = typeof messagingChannels.$inferInsert;
export type IncomingReport = typeof incomingReports.$inferSelect;
export type InsertIncomingReport = typeof incomingReports.$inferInsert;

// ─── Social Monitoring ────────────────────────────────────────────────────────
export const socialPlatformEnum = pgEnum("social_platform", ["twitter", "facebook", "instagram", "tiktok", "linkedin", "news", "whatsapp_group", "youtube"]);
export const mentionSentimentEnum = pgEnum("mention_sentiment", ["positive", "neutral", "negative", "critical"]);

export const socialMonitorConfigs = pgTable("social_monitor_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  keywords: text("keywords").notNull(),
  platforms: text("platforms").notNull(),
  subjectRef: varchar("subjectRef", { length: 32 }),
  investigationRef: varchar("investigationRef", { length: 32 }),
  isActive: boolean("isActive").notNull().default(true),
  alertThreshold: integer("alertThreshold").notNull().default(60),
  totalMentions: integer("totalMentions").notNull().default(0),
  criticalMentions: integer("criticalMentions").notNull().default(0),
  lastMentionAt: timestamp("lastMentionAt"),
  tenantId: integer("tenantId"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const socialMentions = pgTable("social_mentions", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitorId").notNull(),
  platform: socialPlatformEnum("platform").notNull(),
  content: text("content").notNull(),
  author: varchar("author", { length: 100 }).notNull(),
  authorHandle: varchar("authorHandle", { length: 100 }),
  externalUrl: varchar("externalUrl", { length: 500 }),
  sentiment: mentionSentimentEnum("sentiment").notNull().default("neutral"),
  riskScore: integer("riskScore").notNull().default(0),
  keywords: text("keywords"),
  engagementCount: integer("engagementCount").notNull().default(0),
  isVerified: boolean("isVerified").notNull().default(false),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  isAcknowledged: boolean("isAcknowledged").notNull().default(false),
  acknowledgedBy: integer("acknowledgedBy"),
  publishedAt: timestamp("publishedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    social_mentions_created_at_idx: index("social_mentions_created_at_idx").on(table.createdAt),
    social_mentions_monitor_id_idx: index("social_mentions_monitor_id_idx").on(table.monitorId),
    social_mentions_sentiment_idx: index("social_mentions_sentiment_idx").on(table.sentiment),
  }));

export type SocialMonitorConfig = typeof socialMonitorConfigs.$inferSelect;
export type InsertSocialMonitorConfig = typeof socialMonitorConfigs.$inferInsert;
export type SocialMention = typeof socialMentions.$inferSelect;
export type InsertSocialMention = typeof socialMentions.$inferInsert;

// ── Field Agent Playbooks ─────────────────────────────────────────────────────
export const playbookCategoryEnum = pgEnum("playbook_category", [
  "kyc_physical", "kyb_premises", "asset_verification", "surveillance",
  "address_verification", "interview", "evidence_collection", "emergency",
]);

export const fieldAgentPlaybooks = pgTable("field_agent_playbooks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  category: playbookCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  estimatedHours: integer("estimatedHours").notNull().default(4),
  requiredTier: agentTierEnum("requiredTier").notNull().default("junior"),
  steps: text("steps").notNull(),
  dataToCollect: text("dataToCollect").notNull(),
  safetyNotes: text("safetyNotes"),
  legalNotes: text("legalNotes"),
  nigeriaContext: text("nigeriaContext"),
  isActive: boolean("isActive").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FieldAgentPlaybook = typeof fieldAgentPlaybooks.$inferSelect;
export type InsertFieldAgentPlaybook = typeof fieldAgentPlaybooks.$inferInsert;

// ── Duplicate Identity Checks ─────────────────────────────────────────────────
export const duplicateCheckStatusEnum = pgEnum("duplicate_check_status", ["pending", "no_match", "possible_match", "confirmed_duplicate"]);

export const duplicateIdentityChecks = pgTable("duplicate_identity_checks", {
  id: serial("id").primaryKey(),
  investigationRef: varchar("investigationRef", { length: 50 }),
  subjectName: varchar("subjectName", { length: 200 }).notNull(),
  faceImageUrl: varchar("faceImageUrl", { length: 500 }),
  nin: varchar("nin", { length: 20 }),
  bvn: varchar("bvn", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  status: duplicateCheckStatusEnum("status").notNull().default("pending"),
  matchCount: integer("matchCount").notNull().default(0),
  matchDetails: text("matchDetails"),
  confidenceScore: integer("confidenceScore").notNull().default(0),
  requestedBy: integer("requestedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
},
  (table) => ({
    duplicate_checks_status_idx: index("duplicate_checks_status_idx").on(table.status),
    duplicate_checks_created_at_idx: index("duplicate_checks_created_at_idx").on(table.createdAt),
  }));
export type DuplicateIdentityCheck = typeof duplicateIdentityChecks.$inferSelect;

// ── Hosted Verification Links ─────────────────────────────────────────────────
export const hostedLinkStatusEnum = pgEnum("hosted_link_status", ["active", "completed", "expired", "revoked"]);

export const hostedVerificationLinks = pgTable("hosted_verification_links", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  tenantId: integer("tenantId"),
  investigationRef: varchar("investigationRef", { length: 50 }),
  subjectName: varchar("subjectName", { length: 200 }),
  requiredChecks: text("requiredChecks").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  status: hostedLinkStatusEnum("status").notNull().default("active"),
  completedAt: timestamp("completedAt"),
  resultRef: varchar("resultRef", { length: 50 }),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    hosted_links_status_idx: index("hosted_links_status_idx").on(table.status),
    hosted_links_expires_at_idx: index("hosted_links_expires_at_idx").on(table.expiresAt),
  }));
export type HostedVerificationLink = typeof hostedVerificationLinks.$inferSelect;

// ─── Case Management ──────────────────────────────────────────────────────────

export const caseStatusEnum = pgEnum("case_status", [
  "draft", "open", "under_review", "pending_decision", "closed", "archived",
]);
export const casePriorityEnum = pgEnum("case_priority", ["low", "medium", "high", "critical"]);
export const caseTypeEnum = pgEnum("case_type", [
  "fraud", "aml", "kyc_failure", "sanctions", "corruption", "cyber", "regulatory", "other",
]);
export const casePartyRoleEnum = pgEnum("case_party_role", [
  "subject", "witness", "associate", "victim", "entity",
]);
export const caseStakeholderRoleEnum = pgEnum("case_stakeholder_role", [
  "lead_analyst", "reviewer", "external_counsel", "regulator", "compliance_officer", "subject_representative",
]);

export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  ref: varchar("ref", { length: 30 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  type: caseTypeEnum("type").notNull().default("other"),
  status: caseStatusEnum("status").notNull().default("draft"),
  priority: casePriorityEnum("priority").notNull().default("medium"),
  summary: text("summary"),
  legalBasis: text("legalBasis"),
  jurisdiction: varchar("jurisdiction", { length: 100 }),
  regulatoryFramework: varchar("regulatoryFramework", { length: 200 }),
  leadAnalystId: integer("leadAnalystId"),
  tenantId: integer("tenantId"),
  investigationRefs: jsonb("investigationRefs").$type<string[]>().default([]),
  tags: jsonb("tags").$type<string[]>().default([]),
  dueAt: timestamp("dueAt"),
  closedAt: timestamp("closedAt"),
  closureReason: text("closureReason"),
  riskScore: integer("riskScore"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    cases_status_idx: index("cases_status_idx").on(table.status),
    cases_created_at_idx: index("cases_created_at_idx").on(table.createdAt),
    cases_lead_analyst_id_idx: index("cases_lead_analyst_id_idx").on(table.leadAnalystId),
    cases_priority_idx: index("cases_priority_idx").on(table.priority),
    cases_created_by_idx: index("cases_created_by_idx").on(table.createdBy),
    cases_tenant_idx: index("cases_tenant_idx").on(table.tenantId),
    cases_deleted_at_idx: index("cases_deleted_at_idx").on(table.deletedAt),
    cases_search_idx: index("cases_search_idx").using("gin", sql`to_tsvector('english', coalesce("title", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("summary", ''))`),
    cases_risk_score_check: check("cases_risk_score_check", sql`"riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100)`),
  }));
export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;

export const caseParties = pgTable("case_parties", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  role: casePartyRoleEnum("role").notNull().default("subject"),
  name: varchar("name", { length: 200 }).notNull(),
  nin: varchar("nin", { length: 20 }),
  bvn: varchar("bvn", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 200 }),
  address: text("address"),
  entityType: varchar("entityType", { length: 50 }),
  notes: text("notes"),
  investigationRef: varchar("investigationRef", { length: 50 }),
  addedBy: integer("addedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CaseParty = typeof caseParties.$inferSelect;

export const caseDocuments = pgTable("case_documents", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 300 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  url: text("url").notNull(),
  sizeBytes: integer("sizeBytes"),
  category: varchar("category", { length: 100 }),
  description: text("description"),
  confidential: boolean("confidential").notNull().default(false),
  uploadedBy: integer("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CaseDocument = typeof caseDocuments.$inferSelect;

export const caseTimelineEventTypeEnum = pgEnum("case_timeline_event_type", [
  "case_created", "status_changed", "party_added", "document_uploaded", "document_deleted",
  "comment_added", "investigation_linked", "stakeholder_invited",
  "field_task_dispatched", "alert_triggered", "decision_recorded", "case_closed",
]);

export const caseTimeline = pgTable("case_timeline", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  eventType: caseTimelineEventTypeEnum("eventType").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  detail: jsonb("detail"),
  actorId: integer("actorId"),
  actorName: varchar("actorName", { length: 200 }),
  actorRole: varchar("actorRole", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CaseTimelineEvent = typeof caseTimeline.$inferSelect;

export const caseStakeholders = pgTable("case_stakeholders", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  role: caseStakeholderRoleEnum("role").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  organisation: varchar("organisation", { length: 200 }),
  /** Secure token for portal access (no login required) */
  accessToken: varchar("accessToken", { length: 64 }).unique(),
  accessExpiresAt: timestamp("accessExpiresAt"),
  canComment: boolean("canComment").notNull().default(false),
  canViewDocuments: boolean("canViewDocuments").notNull().default(true),
  lastAccessedAt: timestamp("lastAccessedAt"),
  invitedBy: integer("invitedBy"),
  lastNotifiedAt: timestamp("lastNotifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CaseStakeholder = typeof caseStakeholders.$inferSelect;

export const caseComments = pgTable("case_comments", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  authorId: integer("authorId"),
  authorName: varchar("authorName", { length: 200 }),
  authorRole: varchar("authorRole", { length: 100 }),
  /** If set, this comment was posted by a stakeholder (not a logged-in user) */
  stakeholderId: integer("stakeholderId"),
  confidential: boolean("confidential").notNull().default(false),
  editedAt: timestamp("editedAt"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type CaseComment = typeof caseComments.$inferSelect;

// ─── Ollama / LLM Config ──────────────────────────────────────────────────────

export const ollamaModels = pgTable("ollama_models", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 200 }),
  family: varchar("family", { length: 50 }),
  parameterSize: varchar("parameterSize", { length: 20 }),
  quantization: varchar("quantization", { length: 20 }),
  sizeBytes: integer("sizeBytes"),
  status: varchar("status", { length: 20 }).notNull().default("available"),
  useCase: jsonb("useCase").$type<string[]>().default([]),
  isDefault: boolean("isDefault").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OllamaModel = typeof ollamaModels.$inferSelect;

// ─── Token Quota (OpenClaw) ───────────────────────────────────────────────────
// tokenQuota column added to apiTokens above via migration

// ─── LEX — Law Enforcement Extension ─────────────────────────────────────────

export const nigerianStateEnum = pgEnum("nigerian_state", [
  "AB", "AD", "AK", "AN", "BA", "BY", "BE", "BO", "CR", "DE",
  "EB", "ED", "EK", "EN", "GO", "IM", "JI", "KD", "KN", "KT",
  "KE", "KO", "KW", "LA", "NA", "NI", "OG", "ON", "OS", "OY",
  "PL", "RI", "SO", "TA", "YO", "ZA", "FC",
]);

export const lexAgencyTypeEnum = pgEnum("lex_agency_type", [
  "npf", "efcc", "icpc", "dss", "nscdc", "customs", "immigration", "other",
]);

export const lexAgencyStatusEnum = pgEnum("lex_agency_status", [
  "active", "suspended", "retired",
]);

export const lexSubmitterStatusEnum = pgEnum("lex_submitter_status", [
  "active", "suspended", "revoked",
]);

export const lexSubmissionStatusEnum = pgEnum("lex_submission_status", [
  "pending", "under_review", "validated", "rejected", "escalated", "expunged",
]);

export const lexIncidentTypeEnum = pgEnum("lex_incident_type", [
  "arrest", "seizure", "witness_statement", "court_order", "intel_tip",
  "missing_person", "homicide", "fraud", "cybercrime", "other",
]);

export const lexChannelEnum = pgEnum("lex_channel", ["web", "sms", "physical"]);

export const lexAgencies = pgTable("lex_agencies", {
  id: serial("id").primaryKey(),
  agencyCode: varchar("agencyCode", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: lexAgencyTypeEnum("type").notNull(),
  state: nigerianStateEnum("state").notNull(),
  lga: varchar("lga", { length: 100 }),
  commandUnit: varchar("commandUnit", { length: 255 }),
  contactName: varchar("contactName", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 20 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  status: lexAgencyStatusEnum("status").notNull().default("active"),
  registeredBy: integer("registeredBy"),
  registeredAt: timestamp("registeredAt").defaultNow().notNull(),
  suspendedAt: timestamp("suspendedAt"),
  suspendedReason: text("suspendedReason"),
  notes: text("notes"),
  flagged: boolean("flagged").notNull().default(false),
  flagReason: text("flagReason"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type LexAgency = typeof lexAgencies.$inferSelect;

export const lexSubmitters = pgTable("lex_submitters", {
  id: serial("id").primaryKey(),
  submitterId: varchar("submitterId", { length: 64 }).notNull().unique(),
  agencyId: integer("agencyId").notNull().references(() => lexAgencies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  rank: varchar("rank", { length: 100 }),
  phone: varchar("phone", { length: 20 }).notNull(),
  pinHash: varchar("pinHash", { length: 255 }).notNull(),
  reputationScore: integer("reputationScore").notNull().default(50),
  status: lexSubmitterStatusEnum("status").notNull().default("active"),
  lastSubmissionAt: timestamp("lastSubmissionAt"),
  totalSubmissions: integer("totalSubmissions").notNull().default(0),
  validatedSubmissions: integer("validatedSubmissions").notNull().default(0),
  rejectedSubmissions: integer("rejectedSubmissions").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
});
export type LexSubmitter = typeof lexSubmitters.$inferSelect;

export const lexSubmissions = pgTable("lex_submissions", {
  id: serial("id").primaryKey(),
  submissionRef: varchar("submissionRef", { length: 32 }).notNull().unique(),
  agencyId: integer("agencyId").notNull().references(() => lexAgencies.id),
  submitterId: integer("submitterId").references(() => lexSubmitters.id),
  channel: lexChannelEnum("channel").notNull().default("web"),
  incidentType: lexIncidentTypeEnum("incidentType").notNull(),
  incidentState: nigerianStateEnum("incidentState").notNull(),
  incidentLga: varchar("incidentLga", { length: 100 }),
  incidentAddress: text("incidentAddress"),
  gpsLat: real("gpsLat"),
  gpsLng: real("gpsLng"),
  incidentDate: timestamp("incidentDate"),
  subjectName: varchar("subjectName", { length: 255 }),
  subjectNin: varchar("subjectNin", { length: 11 }),
  subjectPhone: varchar("subjectPhone", { length: 20 }),
  subjectAddress: text("subjectAddress"),
  narrative: text("narrative").notNull(),
  documents: jsonb("documents").$type<string[]>().default([]),
  status: lexSubmissionStatusEnum("status").notNull().default("pending"),
  validationScore: integer("validationScore"),
  validationNotes: jsonb("validationNotes"),
  reviewedBy: integer("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  linkedCaseId: integer("linkedCaseId").references(() => cases.id),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    lex_submissions_status_idx: index("lex_submissions_status_idx").on(table.status),
    lex_submissions_created_at_idx: index("lex_submissions_created_at_idx").on(table.createdAt),
    lex_submissions_agency_id_idx: index("lex_submissions_agency_id_idx").on(table.agencyId),
  }));
export type LexSubmission = typeof lexSubmissions.$inferSelect;

// ─── User Sessions ────────────────────────────────────────────────────────────
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionToken: varchar("sessionToken", { length: 255 }).notNull().unique(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  deviceName: varchar("deviceName", { length: 255 }),
  lastActiveAt: timestamp("lastActiveAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    user_sessions_user_id_idx: index("user_sessions_user_id_idx").on(table.userId),
    user_sessions_expires_at_idx: index("user_sessions_expires_at_idx").on(table.expiresAt),
  }));
export type UserSession = typeof userSessions.$inferSelect;

// ─── TOTP / 2FA ───────────────────────────────────────────────────────────────
export const userTotpSecrets = pgTable("user_totp_secrets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  secret: varchar("secret", { length: 64 }).notNull(),
  verified: boolean("verified").notNull().default(false),
  backupCodes: jsonb("backupCodes").$type<string[]>().default([]),
  enabledAt: timestamp("enabledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type UserTotpSecret = typeof userTotpSecrets.$inferSelect;

// ─── In-App Notifications ─────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  link: varchar("link", { length: 512 }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    notifications_user_id_idx: index("notifications_user_id_idx").on(table.userId),
    notifications_read_idx: index("notifications_read_idx").on(table.read),
    notifications_created_at_idx: index("notifications_created_at_idx").on(table.createdAt),
  }));
export type Notification = typeof notifications.$inferSelect;

// ─── Investigation-Case Links ─────────────────────────────────────────────────
export const investigationCaseLinks = pgTable("investigation_case_links", {
  id: serial("id").primaryKey(),
  investigationId: integer("investigationId").notNull().references(() => investigations.id, { onDelete: "cascade" }),
  caseId: integer("caseId").notNull().references(() => cases.id, { onDelete: "cascade" }),
  linkedBy: integer("linkedBy").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type InvestigationCaseLink = typeof investigationCaseLinks.$inferSelect;

// ─── Export Schedules ─────────────────────────────────────────────────────────
export const exportSchedules = pgTable("export_schedules", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  exportType: varchar("exportType", { length: 64 }).notNull(),
  format: varchar("format", { length: 16 }).notNull().default("csv"),
  filters: jsonb("filters"),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull().default("0 8 * * 1"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  lastFileUrl: varchar("lastFileUrl", { length: 1024 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ExportSchedule = typeof exportSchedules.$inferSelect;

// ─── AML Transaction Monitoring ───────────────────────────────────────────────
export const transactionTypeEnum = pgEnum("transaction_type", [
  "wire_transfer", "cash_deposit", "cash_withdrawal", "cheque", "rtgs", "nip",
  "swift_mt103", "swift_mt202", "sepa_credit", "sepa_debit", "internal_transfer",
  "trade_settlement", "fx_conversion", "card_payment", "mobile_money",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending", "completed", "failed", "reversed", "flagged", "blocked", "under_review",
]);
export const amlRiskLevelEnum = pgEnum("aml_risk_level", ["low", "medium", "high", "critical"]);

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  txRef: varchar("txRef", { length: 64 }).notNull().unique(),
  // Idempotency key (1B payments lesson): prevents double-posting on retries.
  // Clients MUST send X-Idempotency-Key header; server stores it here for deduplication.
  idempotencyKey: varchar("idempotencyKey", { length: 256 }).unique(),
  // TigerBeetle transfer ID (hot-tier ledger). Derived deterministically from idempotencyKey.
  tigerBeetleId: varchar("tigerBeetleId", { length: 32 }),
  type: transactionTypeEnum("type").notNull(),
  status: transactionStatusEnum("status").notNull().default("pending"),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  amountUsd: real("amountUsd"),
  originatorName: varchar("originatorName", { length: 255 }).notNull(),
  originatorAccount: varchar("originatorAccount", { length: 64 }),
  originatorBank: varchar("originatorBank", { length: 128 }),
  originatorCountry: varchar("originatorCountry", { length: 2 }).default("NG"),
  beneficiaryName: varchar("beneficiaryName", { length: 255 }).notNull(),
  beneficiaryAccount: varchar("beneficiaryAccount", { length: 64 }),
  beneficiaryBank: varchar("beneficiaryBank", { length: 128 }),
  beneficiaryCountry: varchar("beneficiaryCountry", { length: 2 }).default("NG"),
  purposeCode: varchar("purposeCode", { length: 16 }),
  narration: text("narration"),
  amlRiskLevel: amlRiskLevelEnum("amlRiskLevel").default("low"),
  amlScore: real("amlScore").default(0),
  amlFlags: jsonb("amlFlags"),
  flaggedAt: timestamp("flaggedAt"),
  flaggedBy: integer("flaggedBy").references(() => users.id),
  investigationId: integer("investigationId").references(() => investigations.id),
  goamlFilingId: integer("goamlFilingId").references(() => goamlFilings.id),
  valueDate: timestamp("valueDate"),
  // Archival tier tracking — prevents double-archival in hot→warm→cold pipeline
  archivedTier: varchar("archivedTier", { length: 8 }),  // 'warm' | 'cold' | null
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    transactions_created_at_idx: index("transactions_created_at_idx").on(table.createdAt),
    transactions_status_idx: index("transactions_status_idx").on(table.status),
    transactions_originator_account_idx: index("transactions_originator_account_idx").on(table.originatorAccount),
    transactions_amount_idx: index("transactions_amount_idx").on(table.amount),
    transactions_idempotency_idx: index("transactions_idempotency_idx").on(table.idempotencyKey),
    transactions_tb_id_idx: index("transactions_tb_id_idx").on(table.tigerBeetleId),
  }));
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

export const amlRuleTypeEnum = pgEnum("aml_rule_type", [
  "threshold", "velocity", "structuring", "round_trip", "layering",
  "high_risk_country", "pep_transaction", "sanctions_match", "unusual_pattern",
]);

export const amlRules = pgTable("aml_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  ruleType: amlRuleTypeEnum("ruleType").notNull(),
  threshold: real("threshold"),
  currency: varchar("currency", { length: 3 }).default("NGN"),
  windowHours: integer("windowHours").default(24),
  enabled: boolean("enabled").notNull().default(true),
  riskLevel: amlRiskLevelEnum("riskLevel").notNull().default("medium"),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AmlRule = typeof amlRules.$inferSelect;

export const amlAlertStatusEnum = pgEnum("aml_alert_status", [
  "open", "under_review", "escalated", "cleared", "filed", "false_positive",
]);

export const amlAlerts = pgTable("aml_alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  alertRef: varchar("alertRef", { length: 32 }).notNull().unique(),
  transactionId: integer("transactionId").references(() => transactions.id),
  ruleId: integer("ruleId").references(() => amlRules.id),
  status: amlAlertStatusEnum("status").notNull().default("open"),
  riskLevel: amlRiskLevelEnum("riskLevel").notNull().default("medium"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  triggeredValue: real("triggeredValue"),
  assignedTo: integer("assignedTo").references(() => users.id),
  reviewedBy: integer("reviewedBy").references(() => users.id),
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"),
  investigationId: integer("investigationId").references(() => investigations.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    aml_alerts_created_at_idx: index("aml_alerts_created_at_idx").on(table.createdAt),
    aml_alerts_status_idx: index("aml_alerts_status_idx").on(table.status),
    aml_alerts_rule_id_idx: index("aml_alerts_rule_id_idx").on(table.ruleId),
  }));
export type AmlAlert = typeof amlAlerts.$inferSelect;

// ─── SWIFT Messages ───────────────────────────────────────────────────────────
export const swiftMessageTypeEnum = pgEnum("swift_message_type", [
  "MT103", "MT202", "MT202COV", "MT199", "MT299", "MT900", "MT910", "MT940", "MT950",
]);
export const swiftMessageStatusEnum = pgEnum("swift_message_status", [
  "received", "processing", "completed", "failed", "rejected", "pending_compliance",
]);

export const swiftMessages = pgTable("swift_messages", {
  id: serial("id").primaryKey(),
  uetr: varchar("uetr", { length: 64 }).notNull().unique(),
  messageType: swiftMessageTypeEnum("messageType").notNull(),
  status: swiftMessageStatusEnum("status").notNull().default("received"),
  senderBic: varchar("senderBic", { length: 11 }).notNull(),
  receiverBic: varchar("receiverBic", { length: 11 }).notNull(),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  valueDate: timestamp("valueDate"),
  orderingCustomer: varchar("orderingCustomer", { length: 255 }),
  beneficiaryCustomer: varchar("beneficiaryCustomer", { length: 255 }),
  remittanceInfo: text("remittanceInfo"),
  rawMessage: text("rawMessage"),
  parsedFields: jsonb("parsedFields"),
  complianceStatus: varchar("complianceStatus", { length: 32 }).default("pending"),
  complianceNotes: text("complianceNotes"),
  transactionId: integer("transactionId").references(() => transactions.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type SwiftMessage = typeof swiftMessages.$inferSelect;

// ─── SEPA Payments ────────────────────────────────────────────────────────────
export const sepaPaymentTypeEnum = pgEnum("sepa_payment_type", ["credit_transfer", "direct_debit", "instant_credit"]);
export const sepaPaymentStatusEnum = pgEnum("sepa_payment_status", [
  "pending", "accepted", "rejected", "returned", "settled",
]);

export const sepaPayments = pgTable("sepa_payments", {
  id: serial("id").primaryKey(),
  endToEndId: varchar("endToEndId", { length: 64 }).notNull().unique(),
  paymentType: sepaPaymentTypeEnum("paymentType").notNull(),
  status: sepaPaymentStatusEnum("status").notNull().default("pending"),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  debtorName: varchar("debtorName", { length: 255 }).notNull(),
  debtorIban: varchar("debtorIban", { length: 34 }).notNull(),
  debtorBic: varchar("debtorBic", { length: 11 }),
  creditorName: varchar("creditorName", { length: 255 }).notNull(),
  creditorIban: varchar("creditorIban", { length: 34 }).notNull(),
  creditorBic: varchar("creditorBic", { length: 11 }),
  remittanceInfo: text("remittanceInfo"),
  executionDate: timestamp("executionDate"),
  settlementDate: timestamp("settlementDate"),
  rejectReason: varchar("rejectReason", { length: 255 }),
  transactionId: integer("transactionId").references(() => transactions.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SepaPayment = typeof sepaPayments.$inferSelect;

// ─── FATF Travel Rule ─────────────────────────────────────────────────────────
export const travelRuleStatusEnum = pgEnum("travel_rule_status", [
  "pending", "sent", "acknowledged", "rejected", "exempted",
]);

export const travelRuleRecords = pgTable("travel_rule_records", {
  id: serial("id").primaryKey(),
  recordRef: varchar("recordRef", { length: 64 }).notNull().unique(),
  transactionId: integer("transactionId").references(() => transactions.id),
  status: travelRuleStatusEnum("status").notNull().default("pending"),
  thresholdAmount: real("thresholdAmount").notNull().default(1000),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  originatorName: varchar("originatorName", { length: 255 }).notNull(),
  originatorAccount: varchar("originatorAccount", { length: 64 }),
  originatorAddress: text("originatorAddress"),
  originatorCountry: varchar("originatorCountry", { length: 2 }),
  originatorDob: varchar("originatorDob", { length: 10 }),
  originatorId: varchar("originatorId", { length: 64 }),
  beneficiaryName: varchar("beneficiaryName", { length: 255 }).notNull(),
  beneficiaryAccount: varchar("beneficiaryAccount", { length: 64 }),
  beneficiaryAddress: text("beneficiaryAddress"),
  beneficiaryCountry: varchar("beneficiaryCountry", { length: 2 }),
  vasp: varchar("vasp", { length: 128 }),
  sentAt: timestamp("sentAt"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TravelRuleRecord = typeof travelRuleRecords.$inferSelect;

// ─── SAR (Suspicious Activity Reports) ───────────────────────────────────────
export const sarStatusEnum = pgEnum("sar_status", [
  "draft", "under_review", "approved", "rejected", "filed", "acknowledged", "withdrawn",
]);
export const sarCategoryEnum = pgEnum("sar_category", [
  "money_laundering", "terrorist_financing", "fraud", "corruption", "tax_evasion",
  "sanctions_evasion", "human_trafficking", "drug_trafficking", "cybercrime", "other",
]);

export const sarFilings = pgTable("sar_filings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId"),
  sarRef: varchar("sarRef", { length: 32 }).notNull().unique(),
  status: sarStatusEnum("status").notNull().default("draft"),
  category: sarCategoryEnum("category").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  narrative: text("narrative").notNull(),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  subjectNin: varchar("subjectNin", { length: 11 }),
  subjectBvn: varchar("subjectBvn", { length: 11 }),
  subjectDob: varchar("subjectDob", { length: 10 }),
  subjectAddress: text("subjectAddress"),
  subjectOccupation: varchar("subjectOccupation", { length: 128 }),
  suspiciousAmount: real("suspiciousAmount"),
  suspiciousCurrency: varchar("suspiciousCurrency", { length: 3 }).default("NGN"),
  activityStartDate: timestamp("activityStartDate"),
  activityEndDate: timestamp("activityEndDate"),
  relatedTransactions: jsonb("relatedTransactions"),
  relatedInvestigationId: integer("relatedInvestigationId").references(() => investigations.id),
  relatedGoamlFilingId: integer("relatedGoamlFilingId").references(() => goamlFilings.id),
  createdBy: integer("createdBy").references(() => users.id),
  reviewedBy: integer("reviewedBy").references(() => users.id),
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"),
  approvedBy: integer("approvedBy").references(() => users.id),
  approvedAt: timestamp("approvedAt"),
  filedAt: timestamp("filedAt"),
  filedWith: varchar("filedWith", { length: 64 }).default("NFIU"),
  filingReference: varchar("filingReference", { length: 64 }),
  acknowledgedAt: timestamp("acknowledgedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedBy: integer("deletedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    sar_filings_status_idx: index("sar_filings_status_idx").on(table.status),
    sar_filings_created_at_idx: index("sar_filings_created_at_idx").on(table.createdAt),
    sar_filings_created_by_idx: index("sar_filings_created_by_idx").on(table.createdBy),
  }));
export type SarFiling = typeof sarFilings.$inferSelect;
export type InsertSarFiling = typeof sarFilings.$inferInsert;

// ─── Trade Finance ────────────────────────────────────────────────────────────
export const lcTypeEnum = pgEnum("lc_type", ["sight", "usance", "deferred", "revolving", "standby"]);
export const lcStatusEnum = pgEnum("lc_status", [
  "draft", "issued", "advised", "confirmed", "amended", "presented",
  "accepted", "paid", "discrepant", "rejected", "expired", "cancelled",
]);

export const lettersOfCredit = pgTable("letters_of_credit", {
  id: serial("id").primaryKey(),
  lcRef: varchar("lcRef", { length: 32 }).notNull().unique(),
  type: lcTypeEnum("type").notNull().default("sight"),
  status: lcStatusEnum("status").notNull().default("draft"),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  applicantName: varchar("applicantName", { length: 255 }).notNull(),
  applicantBank: varchar("applicantBank", { length: 128 }).notNull(),
  applicantCountry: varchar("applicantCountry", { length: 2 }).default("NG"),
  beneficiaryName: varchar("beneficiaryName", { length: 255 }).notNull(),
  beneficiaryBank: varchar("beneficiaryBank", { length: 128 }),
  beneficiaryCountry: varchar("beneficiaryCountry", { length: 2 }),
  issuingBank: varchar("issuingBank", { length: 128 }).notNull(),
  advisingBank: varchar("advisingBank", { length: 128 }),
  confirmingBank: varchar("confirmingBank", { length: 128 }),
  goodsDescription: text("goodsDescription"),
  portOfLoading: varchar("portOfLoading", { length: 128 }),
  portOfDischarge: varchar("portOfDischarge", { length: 128 }),
  latestShipmentDate: timestamp("latestShipmentDate"),
  expiryDate: timestamp("expiryDate"),
  presentationPeriod: integer("presentationPeriod").default(21),
  documents: jsonb("documents"),
  amendments: jsonb("amendments"),
  discrepancies: jsonb("discrepancies"),
  investigationId: integer("investigationId").references(() => investigations.id),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type LetterOfCredit = typeof lettersOfCredit.$inferSelect;

// ─── Correspondent Banks ──────────────────────────────────────────────────────
export const correspondentBankStatusEnum = pgEnum("correspondent_bank_status", [
  "active", "suspended", "terminated", "under_review",
]);

export const correspondentBanks = pgTable("correspondent_banks", {
  id: serial("id").primaryKey(),
  bankName: varchar("bankName", { length: 255 }).notNull(),
  bic: varchar("bic", { length: 11 }).notNull().unique(),
  country: varchar("country", { length: 2 }).notNull(),
  city: varchar("city", { length: 128 }),
  status: correspondentBankStatusEnum("status").notNull().default("active"),
  riskRating: varchar("riskRating", { length: 16 }).default("medium"),
  relationshipSince: timestamp("relationshipSince"),
  lastReviewDate: timestamp("lastReviewDate"),
  nextReviewDate: timestamp("nextReviewDate"),
  services: jsonb("services"),
  currencies: jsonb("currencies"),
  nostroAccountCount: integer("nostroAccountCount").default(0),
  annualVolume: real("annualVolume"),
  amlPolicyUrl: text("amlPolicyUrl"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type CorrespondentBank = typeof correspondentBanks.$inferSelect;

export const nostroAccounts = pgTable("nostro_accounts", {
  id: serial("id").primaryKey(),
  accountNumber: varchar("accountNumber", { length: 64 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  correspondentBankId: integer("correspondentBankId").references(() => correspondentBanks.id),
  balance: real("balance").default(0),
  lastReconciled: timestamp("lastReconciled"),
  status: varchar("status", { length: 32 }).default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type NostroAccount = typeof nostroAccounts.$inferSelect;

// ─── Evidence Chain of Custody ────────────────────────────────────────────────
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "document", "photo", "video", "audio", "digital_artifact", "physical",
  "witness_statement", "financial_record", "communication_log", "other",
]);
export const evidenceStatusEnum = pgEnum("evidence_status", [
  "collected", "in_transit", "secured", "analyzed", "submitted", "returned", "destroyed",
]);

export const evidenceItems = pgTable("evidence_items", {
  id: serial("id").primaryKey(),
  evidenceRef: varchar("evidenceRef", { length: 32 }).notNull().unique(),
  caseId: integer("caseId").references(() => cases.id),
  investigationId: integer("investigationId").references(() => investigations.id),
  type: evidenceTypeEnum("type").notNull(),
  status: evidenceStatusEnum("status").notNull().default("collected"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  fileUrl: text("fileUrl"),
  fileHash: varchar("fileHash", { length: 64 }),
  fileSize: integer("fileSize"),
  mimeType: varchar("mimeType", { length: 64 }),
  collectedBy: integer("collectedBy").references(() => users.id),
  collectedAt: timestamp("collectedAt").defaultNow(),
  collectionLocation: text("collectionLocation"),
  chainOfCustody: jsonb("chainOfCustody"),
  integrityVerified: boolean("integrityVerified").default(false),
  integrityVerifiedAt: timestamp("integrityVerifiedAt"),
  integrityVerifiedBy: integer("integrityVerifiedBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type InsertEvidenceItem = typeof evidenceItems.$inferInsert;

// ─── Regulatory Reports ───────────────────────────────────────────────────────
export const regulatoryReportTypeEnum = pgEnum("regulatory_report_type", [
  "CTR", "STR", "goAML_XML", "NFIU_monthly", "CBN_quarterly", "FATF_travel_rule",
  "PEP_disclosure", "sanctions_screening", "annual_AML_report",
]);
export const regulatoryReportStatusEnum = pgEnum("regulatory_report_status", [
  "draft", "generated", "reviewed", "submitted", "acknowledged", "rejected",
]);

export const regulatoryReports = pgTable("regulatory_reports", {
  id: serial("id").primaryKey(),
  reportRef: varchar("reportRef", { length: 32 }).notNull().unique(),
  type: regulatoryReportTypeEnum("type").notNull(),
  status: regulatoryReportStatusEnum("status").notNull().default("draft"),
  title: varchar("title", { length: 255 }).notNull(),
  periodStart: timestamp("periodStart"),
  periodEnd: timestamp("periodEnd"),
  regulatorName: varchar("regulatorName", { length: 128 }).default("NFIU"),
  submissionDeadline: timestamp("submissionDeadline"),
  fileUrl: text("fileUrl"),
  submittedAt: timestamp("submittedAt"),
  submittedBy: integer("submittedBy").references(() => users.id),
  acknowledgementRef: varchar("acknowledgementRef", { length: 64 }),
  rejectionReason: text("rejectionReason"),
  metadata: jsonb("metadata"),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    regulatory_reports_status_idx: index("regulatory_reports_status_idx").on(table.status),
    regulatory_reports_created_at_idx: index("regulatory_reports_created_at_idx").on(table.createdAt),
    regulatory_reports_type_idx: index("regulatory_reports_type_idx").on(table.type),
  }));
export type RegulatoryReport = typeof regulatoryReports.$inferSelect;

// ── Frozen Accounts (Payment Rails — Freeze Audit Log) ─────────────────────────
export const frozenAccounts = pgTable("frozen_accounts", {
  id: serial("id").primaryKey(),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  accountName: varchar("accountName", { length: 255 }),
  reason: text("reason").notNull(),
  frozenBy: integer("frozenBy").references(() => users.id),
  frozenByName: varchar("frozenByName", { length: 255 }),
  affectedTransactions: integer("affectedTransactions").notNull().default(0),
  frozenAt: timestamp("frozenAt").defaultNow().notNull(),
  unfrozenAt: timestamp("unfrozenAt"),
  unfrozenBy: integer("unfrozenBy").references(() => users.id),
  unfrozenByName: varchar("unfrozenByName", { length: 255 }),
  notes: text("notes"),
},
  (table) => ({
    frozen_accounts_account_idx: index("frozen_accounts_account_idx").on(table.accountId),
    frozen_accounts_frozen_at_idx: index("frozen_accounts_frozen_at_idx").on(table.frozenAt),
  }));
export type FrozenAccount = typeof frozenAccounts.$inferSelect;
export type InsertFrozenAccount = typeof frozenAccounts.$inferInsert;

// ── Nigerian Data Bundle Runs (Lookup History) ─────────────────────────────────
export const nigerianDataBundleRuns = pgTable("nigerian_data_bundle_runs", {
  id: serial("id").primaryKey(),
  runRef: varchar("runRef", { length: 32 }).notNull().unique(),
  fullName: varchar("fullName", { length: 255 }),
  nin: varchar("nin", { length: 20 }),
  bvn: varchar("bvn", { length: 22 }),
  phone: varchar("phone", { length: 20 }),
  dateOfBirth: varchar("dateOfBirth", { length: 20 }),
  selectedSources: jsonb("selectedSources").$type<string[]>().notNull(),
  results: jsonb("results").$type<Record<string, unknown>[]>().notNull(),
  overallScore: integer("overallScore").notNull().default(0),
  verifiedCount: integer("verifiedCount").notNull().default(0),
  errorCount: integer("errorCount").notNull().default(0),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    bundle_runs_created_at_idx: index("bundle_runs_created_at_idx").on(table.createdAt),
    bundle_runs_nin_idx: index("bundle_runs_nin_idx").on(table.nin),
    bundle_runs_bvn_idx: index("bundle_runs_bvn_idx").on(table.bvn),
  }));
export type NigerianDataBundleRun = typeof nigerianDataBundleRuns.$inferSelect;

// ── Data Source Health Logs ────────────────────────────────────────────────────
export const dataSourceHealthLogs = pgTable("data_source_health_logs", {
  id: serial("id").primaryKey(),
  dataSourceId: integer("dataSourceId").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  status: dataSourceStatusEnum("status").notNull(),
  responseMs: integer("responseMs").notNull().default(0),
  httpStatus: integer("httpStatus"),
  error: text("error"),
  checkedAt: timestamp("checkedAt").defaultNow().notNull(),
},
  (table) => ({
    health_logs_ds_idx: index("health_logs_ds_idx").on(table.dataSourceId),
    health_logs_checked_at_idx: index("health_logs_checked_at_idx").on(table.checkedAt),
  }));
export type DataSourceHealthLog = typeof dataSourceHealthLogs.$inferSelect;
export type InsertDataSourceHealthLog = typeof dataSourceHealthLogs.$inferInsert;

// ── KYC Scheduled Re-runs ─────────────────────────────────────────────────────
export const kycScheduledReruns = pgTable("kyc_scheduled_reruns", {
  id: serial("id").primaryKey(),
  kycRecordId: integer("kycRecordId").notNull().references(() => kycRecords.id, { onDelete: "cascade" }),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  nin: varchar("nin", { length: 20 }),
  bvn: varchar("bvn", { length: 22 }),
  dob: varchar("dob", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  scheduledAt: timestamp("scheduledAt").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"), // pending | running | completed | failed
  resultKycRecordId: integer("resultKycRecordId"),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    kyc_reruns_status_idx: index("kyc_reruns_status_idx").on(table.status),
    kyc_reruns_scheduled_at_idx: index("kyc_reruns_scheduled_at_idx").on(table.scheduledAt),
    kyc_reruns_kyc_record_idx: index("kyc_reruns_kyc_record_idx").on(table.kycRecordId),
  }));
export type KycScheduledRerun = typeof kycScheduledReruns.$inferSelect;
export type InsertKycScheduledRerun = typeof kycScheduledReruns.$inferInsert;

// ── Biometric Session Logs ────────────────────────────────────────────────────
export const spoofTypeEnum = pgEnum("spoof_type", [
  "genuine",
  "printed_photo",
  "screen_replay",
  "paper_mask",
  "three_d_mask",
  "deepfake",
  "high_quality_photo",
  "unknown",
]);

export const biometricSessionLogs = pgTable("biometric_session_logs", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  subjectRef: varchar("subject_ref", { length: 128 }),
  kycRecordId: integer("kyc_record_id"),
  // Passive liveness
  livenessScore: real("liveness_score"),
  livenessLive: boolean("liveness_live"),
  livenessReason: varchar("liveness_reason", { length: 128 }),
  livenessLandmarksFound: boolean("liveness_landmarks_found"),
  livenessEar: real("liveness_ear"),
  livenessTextureScore: real("liveness_texture_score"),
  livenessFaceAreaRatio: real("liveness_face_area_ratio"),
  livenessLandmarkVariance: real("liveness_landmark_variance"),
  // Active liveness
  activeLivenessScore: real("active_liveness_score"),
  activeLivenessLive: boolean("active_liveness_live"),
  activeLivenessChallenge: varchar("active_liveness_challenge", { length: 32 }),
  activeLivenessChallengeCompleted: boolean("active_liveness_challenge_completed"),
  activeLivenessFramesAnalysed: integer("active_liveness_frames_analysed"),
  // Face detection
  faceDetected: boolean("face_detected"),
  faceCount: integer("face_count"),
  faceQualityScore: real("face_quality_score"),
  faceBboxX: real("face_bbox_x"),
  faceBboxY: real("face_bbox_y"),
  faceBboxW: real("face_bbox_w"),
  faceBboxH: real("face_bbox_h"),
  // 68-point landmarks (JSON array of {x,y,z})
  landmarks68: text("landmarks_68"),
  // Face feature extraction
  embeddingDimension: integer("embedding_dimension"),
  embeddingModel: varchar("embedding_model", { length: 64 }),
  // Face matching
  matchScore: real("match_score"),
  matchCosineSimilarity: real("match_cosine_similarity"),
  matchDecision: boolean("match_decision"),
  matchThreshold: real("match_threshold"),
  // Anti-spoofing — binary + 6-class spoof taxonomy
  antiSpoofScore: real("anti_spoof_score"),
  antiSpoofGenuine: boolean("anti_spoof_genuine"),
  antiSpoofType: spoofTypeEnum("anti_spoof_type").default("unknown"),
  antiSpoofModel: varchar("anti_spoof_model", { length: 64 }),
  antiSpoofSharpness: real("anti_spoof_sharpness"),
  antiSpoofColourDepth: real("anti_spoof_colour_depth"),
  antiSpoofHfScore: real("anti_spoof_hf_score"),
  antiSpoofFreqAnomalyScore: real("anti_spoof_freq_anomaly_score"),
  antiSpoofReflectionScore: real("anti_spoof_reflection_score"),
  antiSpoofDepthScore: real("anti_spoof_depth_score"),
  // Overall composite
  overallScore: real("overall_score"),
  overallVerified: boolean("overall_verified"),
  failureReasons: text("failure_reasons"),
  // Metadata
  requestId: varchar("request_id", { length: 64 }),
  latencyMs: real("latency_ms"),
  engineVersion: varchar("engine_version", { length: 32 }),
  kafkaPublished: boolean("kafka_published").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
  (table) => ({
    bio_session_subject_idx: index("bio_session_subject_idx").on(table.subjectRef),
    bio_session_created_at_idx: index("bio_session_created_at_idx").on(table.createdAt),
    bio_session_spoof_type_idx: index("bio_session_spoof_type_idx").on(table.antiSpoofType),
    bio_session_kyc_record_idx: index("bio_session_kyc_record_idx").on(table.kycRecordId),
  }));
export type BiometricSessionLog = typeof biometricSessionLogs.$inferSelect;
export type InsertBiometricSessionLog = typeof biometricSessionLogs.$inferInsert;

// ─── Biometric Liveness Nonces (replay protection) ───────────────────────────
// Stores a SHA-256 hash of the frames payload for each active-liveness session.
// Any duplicate submission within 5 minutes is rejected to prevent replay attacks.
export const biometricLivenessNonces = pgTable("biometric_liveness_nonces", {
  id: serial("id").primaryKey(),
  framesHash: varchar("frames_hash", { length: 64 }).notNull().unique(),
  subjectRef: varchar("subject_ref", { length: 128 }),
  challenge: varchar("challenge", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
},
  (table) => ({
    bio_nonce_hash_idx: index("bio_nonce_hash_idx").on(table.framesHash),
    bio_nonce_expires_idx: index("bio_nonce_expires_idx").on(table.expiresAt),
  }));
export type BiometricLivenessNonce = typeof biometricLivenessNonces.$inferSelect;
export type InsertBiometricLivenessNonce = typeof biometricLivenessNonces.$inferInsert;

// ─── KYC Uploaded Documents ───────────────────────────────────────────────────
// Stores metadata for documents uploaded via the mobile KYCDocumentCaptureScreen.
// File bytes live in S3; only the URL and key are stored here.
export const kycDocumentReviewStatusEnum = pgEnum("kyc_document_review_status", [
  "pending",
  "approved",
  "rejected",
  "reupload_requested",
]);

export const kycDocuments = pgTable("kyc_documents", {
  id: serial("id").primaryKey(),
  kycRecordId: integer("kycRecordId").notNull().references(() => kycRecords.id, { onDelete: "cascade" }),
  tenantId: integer("tenantId"),
  documentType: varchar("documentType", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSizeBytes: integer("fileSizeBytes"),
  mimeType: varchar("mimeType", { length: 64 }),
  reviewStatus: kycDocumentReviewStatusEnum("reviewStatus").notNull().default("pending"),
  reviewedBy: integer("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  uploadedBy: integer("uploadedBy").notNull(),
  capturedAt: timestamp("capturedAt"),
  // previousOcrData: snapshot of documentOcrData taken before the most recent re-run,
  // used to render a before/after diff view in the DocumentReviewQueue ReviewDialog.
  previousOcrData: jsonb("previousOcrData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    kyc_docs_record_idx: index("kyc_docs_record_idx").on(table.kycRecordId),
    kyc_docs_status_idx: index("kyc_docs_status_idx").on(table.reviewStatus),
    kyc_docs_tenant_idx: index("kyc_docs_tenant_idx").on(table.tenantId),
    kyc_docs_created_at_idx: index("kyc_docs_created_at_idx").on(table.createdAt),
  }));
export type KycDocument = typeof kycDocuments.$inferSelect;
export type InsertKycDocument = typeof kycDocuments.$inferInsert;

// ─── Push Subscriptions (FCM / Web Push) ─────────────────────────────────────
// Stores FCM registration tokens and Web Push subscription endpoints for
// mobile and browser push notification delivery.
// A user may have multiple devices/browsers, each with its own token.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  // FCM registration token (mobile) or Web Push endpoint URL (browser)
  token: text("token").notNull(),
  // 'fcm' | 'webpush'
  platform: varchar("platform", { length: 16 }).notNull().default("fcm"),
  // Device / browser label for display in settings
  deviceLabel: varchar("device_label", { length: 128 }),
  // Web Push keys (only for webpush platform)
  p256dh: text("p256dh"),
  auth: text("auth"),
  // Whether this subscription is still active
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
  (table) => ({
    push_sub_user_idx:   index("push_sub_user_idx").on(table.userId),
    push_sub_token_idx:  index("push_sub_token_idx").on(table.token),
    push_sub_active_idx: index("push_sub_active_idx").on(table.active),
  }));
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// ─── Push Broadcasts ──────────────────────────────────────────────────────────
// Audit log for admin-initiated platform-wide push broadcasts.
// Each row represents one call to push.broadcastToAll.
export const pushBroadcasts = pgTable("push_broadcasts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 128 }).notNull(),
  body: varchar("body", { length: 512 }).notNull(),
  url: text("url"),
  tag: varchar("tag", { length: 64 }),
  sentCount: integer("sentCount").notNull().default(0),
  failedCount: integer("failedCount").notNull().default(0),
  deactivatedCount: integer("deactivatedCount").notNull().default(0),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
},
  (table) => ({
    push_bc_sent_at_idx:    index("push_bc_sent_at_idx").on(table.sentAt),
    push_bc_created_by_idx: index("push_bc_created_by_idx").on(table.createdBy),
  }));
export type PushBroadcast = typeof pushBroadcasts.$inferSelect;
export type InsertPushBroadcast = typeof pushBroadcasts.$inferInsert;

// ─── Push Broadcast Status Enum ───────────────────────────────────────────────
export const pushBroadcastStatusEnum = pgEnum("push_broadcast_status", [
  "scheduled",
  "sent",
  "cancelled",
]);

// ─── Scheduled Broadcasts ─────────────────────────────────────────────────────
// Stores broadcasts queued for future delivery.
// The heartbeat scheduler dispatches rows where scheduledAt <= now() and status = 'scheduled'.
export const scheduledBroadcasts = pgTable("scheduled_broadcasts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 128 }).notNull(),
  body: varchar("body", { length: 512 }).notNull(),
  url: text("url"),
  tag: varchar("tag", { length: 64 }),
  scheduledAt: bigint("scheduledAt", { mode: "number" }).notNull(),
  status: pushBroadcastStatusEnum("status").notNull().default("scheduled"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  dispatchedAt: bigint("dispatchedAt", { mode: "number" }),
  broadcastId: integer("broadcastId").references(() => pushBroadcasts.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    sched_bc_status_idx:     index("sched_bc_status_idx").on(table.status),
    sched_bc_scheduled_idx:  index("sched_bc_scheduled_idx").on(table.scheduledAt),
    sched_bc_created_by_idx: index("sched_bc_created_by_idx").on(table.createdBy),
  }));
export type ScheduledBroadcast = typeof scheduledBroadcasts.$inferSelect;
export type InsertScheduledBroadcast = typeof scheduledBroadcasts.$inferInsert;

// ─── KYC OCR History ─────────────────────────────────────────────────────────
// Audit trail for every field-level OCR re-extraction via kyc.reextractField.
export const kycOcrHistory = pgTable("kyc_ocr_history", {
  id: serial("id").primaryKey(),
  documentId: integer("documentId").notNull().references(() => kycDocuments.id, { onDelete: "cascade" }),
  fieldName: varchar("fieldName", { length: 64 }).notNull(),
  oldValue: text("oldValue"),
  oldConfidence: real("oldConfidence"),
  newValue: text("newValue"),
  newConfidence: real("newConfidence"),
  triggeredBy: integer("triggeredBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    kyc_ocr_hist_doc_idx:   index("kyc_ocr_hist_doc_idx").on(table.documentId),
    kyc_ocr_hist_field_idx: index("kyc_ocr_hist_field_idx").on(table.fieldName),
    kyc_ocr_hist_by_idx:    index("kyc_ocr_hist_by_idx").on(table.triggeredBy),
  }));
export type KycOcrHistory = typeof kycOcrHistory.$inferSelect;
export type InsertKycOcrHistory = typeof kycOcrHistory.$inferInsert;

// ─── Billing Top-ups (idempotency guard) ──────────────────────────────────────
// One row per verified Paystack reference. UNIQUE(reference) prevents double-credit.
export const billingTopups = pgTable("billing_topups", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  reference: varchar("reference", { length: 256 }).notNull().unique(),
  amountKobo: integer("amountKobo").notNull(),
  channel: varchar("channel", { length: 64 }).notNull().default("unknown"),
  tbTransferId: varchar("tbTransferId", { length: 64 }),
  verifiedAt: timestamp("verifiedAt").defaultNow().notNull(),
},
  (table) => ({
    billing_topups_ref_idx: index("billing_topups_ref_idx").on(table.reference),
    billing_topups_tenant_idx: index("billing_topups_tenant_idx").on(table.tenantId),
  }));
export type BillingTopup = typeof billingTopups.$inferSelect;
export type InsertBillingTopup = typeof billingTopups.$inferInsert;

// ─── Velocity Blocks (Fluvio sliding-window audit) ────────────────────────────
// One row per blocked transfer attempt. Compliance officers review these in the
// AML dashboard alongside SAR filings.
export const velocityBlocks = pgTable("velocity_blocks", {
  id: serial("id").primaryKey(),
  accountId: varchar("accountId", { length: 128 }).notNull(),
  tenantId: varchar("tenantId", { length: 64 }),
  txRef: varchar("txRef", { length: 128 }),
  amountKobo: bigint("amountKobo", { mode: "number" }).notNull(),
  windowCount: integer("windowCount").notNull(),
  windowSeconds: integer("windowSeconds").notNull(),
  threshold: integer("threshold").notNull(),
  decision: varchar("decision", { length: 32 }).notNull().default("block"),
  reason: text("reason"),
  reviewedAt: timestamp("reviewedAt"),
  reviewedBy: integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
},
  (table) => ({
    velocity_blocks_account_idx: index("velocity_blocks_account_idx").on(table.accountId),
    velocity_blocks_tenant_idx:  index("velocity_blocks_tenant_idx").on(table.tenantId),
    velocity_blocks_created_idx: index("velocity_blocks_created_idx").on(table.createdAt),
  }));
export type VelocityBlock = typeof velocityBlocks.$inferSelect;
export type InsertVelocityBlock = typeof velocityBlocks.$inferInsert;

// ─── Insider Threat ───────────────────────────────────────────────────────────

// Severity levels for insider-threat events
export const insiderSeverityEnum = pgEnum("insider_severity", [
  "info", "low", "medium", "high", "critical",
]);

// Category of insider-threat signal
export const insiderCategoryEnum = pgEnum("insider_category", [
  "data_exfiltration",
  "privilege_abuse",
  "off_hours_access",
  "peer_anomaly",
  "dead_man_switch",
  "failed_auth_spike",
  "unusual_ip",
  "bulk_download",
  "policy_violation",
  "access_review_overdue",
]);

// Status of an insider-threat event
export const insiderEventStatusEnum = pgEnum("insider_event_status", [
  "open", "under_review", "escalated", "dismissed", "resolved",
]);

// Status of an access-review task
export const accessReviewStatusEnum = pgEnum("access_review_status", [
  "pending", "approved", "revoked", "escalated", "expired",
]);

/**
 * insider_events — one row per detected insider-threat signal.
 * Populated by: Go gateway middleware, Rust event processor, TypeScript BFF.
 */
export const insiderEvents = pgTable("insider_events", {
  id:           serial("id").primaryKey(),
  subjectId:    varchar("subjectId", { length: 128 }).notNull(),
  tenantId:     varchar("tenantId", { length: 64 }),
  category:     insiderCategoryEnum("category").notNull(),
  severity:     insiderSeverityEnum("severity").notNull().default("medium"),
  status:       insiderEventStatusEnum("status").notNull().default("open"),
  anomalyScore: real("anomalyScore"),
  driftScore:   real("driftScore"),
  sourceIp:     varchar("sourceIp", { length: 64 }),
  userAgent:    text("userAgent"),
  resourcePath: text("resourcePath"),
  payloadBytes: bigint("payloadBytes", { mode: "number" }),
  ruleId:       varchar("ruleId", { length: 64 }),
  evidence:     jsonb("evidence"),
  assignedTo:   integer("assignedTo").references(() => users.id, { onDelete: "set null" }),
  resolvedAt:   timestamp("resolvedAt"),
  resolvedBy:   integer("resolvedBy").references(() => users.id, { onDelete: "set null" }),
  resolution:   text("resolution"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  ie_subject_idx:  index("ie_subject_idx").on(t.subjectId),
  ie_tenant_idx:   index("ie_tenant_idx").on(t.tenantId),
  ie_status_idx:   index("ie_status_idx").on(t.status),
  ie_severity_idx: index("ie_severity_idx").on(t.severity),
  ie_created_idx:  index("ie_created_idx").on(t.createdAt),
}));
export type InsiderEvent       = typeof insiderEvents.$inferSelect;
export type InsertInsiderEvent = typeof insiderEvents.$inferInsert;

/**
 * ueba_profiles — persisted snapshot of each user's UEBA behaviour profile.
 * The Python ML engine is the authoritative source; this table caches the
 * latest snapshot for fast dashboard queries.
 */
export const uebaProfiles = pgTable("ueba_profiles", {
  id:              serial("id").primaryKey(),
  subjectId:       varchar("subjectId", { length: 128 }).notNull().unique(),
  tenantId:        varchar("tenantId", { length: 64 }),
  eventCount:      integer("eventCount").notNull().default(0),
  anomalyScore:    real("anomalyScore").notNull().default(0),
  driftScore:      real("driftScore").notNull().default(0),
  riskLevel:       insiderSeverityEnum("riskLevel").notNull().default("info"),
  hourHistogram:   jsonb("hourHistogram"),
  dayHistogram:    jsonb("dayHistogram"),
  uniqueIpCount:   integer("uniqueIpCount").notNull().default(0),
  offHoursRatio:   real("offHoursRatio").notNull().default(0),
  privChangeCount: integer("privChangeCount").notNull().default(0),
  failedAuthCount: integer("failedAuthCount").notNull().default(0),
  baselineReady:   boolean("baselineReady").notNull().default(false),
  lastScoredAt:    timestamp("lastScoredAt"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  up_subject_idx: index("up_subject_idx").on(t.subjectId),
  up_tenant_idx:  index("up_tenant_idx").on(t.tenantId),
  up_risk_idx:    index("up_risk_idx").on(t.riskLevel),
}));
export type UebaProfile       = typeof uebaProfiles.$inferSelect;
export type InsertUebaProfile = typeof uebaProfiles.$inferInsert;

/**
 * access_reviews — periodic least-privilege review tasks.
 * Created by the Temporal scheduler; resolved by supervisors via the dashboard.
 */
export const accessReviews = pgTable("access_reviews", {
  id:             serial("id").primaryKey(),
  subjectId:      varchar("subjectId", { length: 128 }).notNull(),
  tenantId:       varchar("tenantId", { length: 64 }),
  reviewType:     varchar("reviewType", { length: 64 }).notNull().default("periodic"),
  status:         accessReviewStatusEnum("status").notNull().default("pending"),
  triggeredBy:    varchar("triggeredBy", { length: 64 }),
  insiderEventId: integer("insiderEventId").references(() => insiderEvents.id, { onDelete: "set null" }),
  assignedTo:     integer("assignedTo").references(() => users.id, { onDelete: "set null" }),
  dueAt:          timestamp("dueAt").notNull(),
  completedAt:    timestamp("completedAt"),
  completedBy:    integer("completedBy").references(() => users.id, { onDelete: "set null" }),
  decision:       text("decision"),
  permifyChanges: jsonb("permifyChanges"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  ar_subject_idx: index("ar_subject_idx").on(t.subjectId),
  ar_status_idx:  index("ar_status_idx").on(t.status),
  ar_due_idx:     index("ar_due_idx").on(t.dueAt),
}));
export type AccessReview       = typeof accessReviews.$inferSelect;
export type InsertAccessReview = typeof accessReviews.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// NIGERIAN BACKGROUND SCREENING PLATFORM — Checkr.com Equivalent
// Regulatory basis: NDPR 2019, CBN AML/CFT, EFCC Act, ICPC Act, CAC Act 2020,
//                   Labour Act, Immigration Act, NIMC Act, NIBSS Standards
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Enums ────────────────────────────────────────────────────────────────────

export const candidateStatusEnum = pgEnum("candidate_status", [
  "invited", "applying", "submitted", "processing", "completed", "withdrawn", "expired"
]);

export const adverseActionStatusEnum = pgEnum("adverse_action_status", [
  "pending_pre_adverse", "pre_adverse_sent", "dispute_received",
  "dispute_resolved", "final_adverse_sent", "withdrawn", "cleared"
]);

export const consentPurposeEnum = pgEnum("consent_purpose", [
  "pre_employment", "employment", "contractor", "volunteer",
  "tenancy", "financial_services", "healthcare", "government"
]);

export const workPermitTypeEnum = pgEnum("work_permit_type", [
  "expatriate_quota", "combined_expatriate_residence_permit",
  "temporary_work_permit", "subject_to_regularisation", "business_visa"
]);

export const professionalBodyEnum = pgEnum("professional_body", [
  "COREN", "NBA", "MDCN", "ICAN", "CIBN", "NIM", "NSE", "NIPR",
  "TOPREC", "ARCON", "ICSAN", "ACCA", "CIS", "CIPD", "HRCI"
]);

export const assessmentOutcomeEnum = pgEnum("assessment_outcome", [
  "clear", "consider", "suspended_licence", "revoked_licence",
  "adverse", "pending", "unverified"
]);

export const courtTypeEnum = pgEnum("court_type", [
  "magistrate", "high_court", "federal_high_court", "court_of_appeal",
  "supreme_court", "national_industrial_court", "sharia_court", "customary_court"
]);

export const packageTierEnum = pgEnum("package_tier", [
  "basic", "standard", "executive", "transport", "healthcare", "financial", "custom"
]);

// ─── Candidate Profiles ───────────────────────────────────────────────────────

export const candidateProfiles = pgTable("candidate_profiles", {
  id:                serial("id").primaryKey(),
  candidateRef:      varchar("candidateRef", { length: 32 }).notNull().unique(),
  tenantId:          integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  firstName:         varchar("firstName", { length: 128 }).notNull(),
  middleName:        varchar("middleName", { length: 128 }),
  lastName:          varchar("lastName", { length: 128 }).notNull(),
  email:             varchar("email", { length: 320 }).notNull(),
  phone:             varchar("phone", { length: 20 }),
  nin:               varchar("nin", { length: 11 }),          // NIMC NIN (masked at rest)
  bvn:               varchar("bvn", { length: 11 }),          // NIBSS BVN (masked at rest)
  dob:               date("dob"),
  gender:            varchar("gender", { length: 16 }),
  nationality:       varchar("nationality", { length: 64 }).default("Nigerian"),
  stateOfOrigin:     varchar("stateOfOrigin", { length: 64 }),
  lgaOfOrigin:       varchar("lgaOfOrigin", { length: 64 }),
  currentAddress:    text("currentAddress"),
  currentState:      varchar("currentState", { length: 64 }),
  currentLga:        varchar("currentLga", { length: 64 }),
  addressHistory:    jsonb("addressHistory").$type<Array<{
    address: string; state: string; lga: string; from: string; to?: string;
  }>>().default([]),
  passportNumber:    varchar("passportNumber", { length: 20 }),
  passportExpiry:    date("passportExpiry"),
  consentStatus:     candidateStatusEnum("consentStatus").notNull().default("invited"),
  ndprConsentAt:     timestamp("ndprConsentAt"),
  ndprConsentIp:     varchar("ndprConsentIp", { length: 45 }),
  inviteToken:       varchar("inviteToken", { length: 128 }).unique(),
  inviteExpiresAt:   timestamp("inviteExpiresAt"),
  invitedBy:         integer("invitedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  cp_tenant_idx:  index("cp_tenant_idx").on(t.tenantId),
  cp_email_idx:   index("cp_email_idx").on(t.email),
  cp_nin_idx:     index("cp_nin_idx").on(t.nin),
  cp_bvn_idx:     index("cp_bvn_idx").on(t.bvn),
}));
export type CandidateProfile       = typeof candidateProfiles.$inferSelect;
export type InsertCandidateProfile = typeof candidateProfiles.$inferInsert;

// ─── Screening Packages ───────────────────────────────────────────────────────

export const screeningPackages = pgTable("screening_packages", {
  id:              serial("id").primaryKey(),
  packageRef:      varchar("packageRef", { length: 32 }).notNull().unique(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  name:            varchar("name", { length: 128 }).notNull(),
  description:     text("description"),
  tier:            packageTierEnum("tier").notNull().default("standard"),
  screeningTypes:  jsonb("screeningTypes").$type<string[]>().notNull().default([]),
  priceNgn:        integer("priceNgn").notNull().default(0),   // kobo
  etaHours:        integer("etaHours").notNull().default(48),
  isPublic:        boolean("isPublic").notNull().default(false),
  isActive:        boolean("isActive").notNull().default(true),
  config:          jsonb("config"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sp_tenant_idx: index("sp_tenant_idx").on(t.tenantId),
  sp_tier_idx:   index("sp_tier_idx").on(t.tier),
}));
export type ScreeningPackage       = typeof screeningPackages.$inferSelect;
export type InsertScreeningPackage = typeof screeningPackages.$inferInsert;

// ─── Screening Programs ───────────────────────────────────────────────────────

export const screeningPrograms = pgTable("screening_programs", {
  id:           serial("id").primaryKey(),
  programRef:   varchar("programRef", { length: 32 }).notNull().unique(),
  tenantId:     integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name:         varchar("name", { length: 128 }).notNull(),
  description:  text("description"),
  packageId:    integer("packageId").references(() => screeningPackages.id, { onDelete: "set null" }),
  geoRules:     jsonb("geoRules"),   // state-level compliance overrides
  assessRules:  jsonb("assessRules"), // auto-assess thresholds
  isActive:     boolean("isActive").notNull().default(true),
  createdBy:    integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sprog_tenant_idx: index("sprog_tenant_idx").on(t.tenantId),
}));
export type ScreeningProgram       = typeof screeningPrograms.$inferSelect;
export type InsertScreeningProgram = typeof screeningPrograms.$inferInsert;

// ─── Screening Orders ─────────────────────────────────────────────────────────

export const screeningOrders = pgTable("screening_orders", {
  id:              serial("id").primaryKey(),
  orderRef:        varchar("orderRef", { length: 32 }).notNull().unique(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  candidateId:     integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  packageId:       integer("packageId").references(() => screeningPackages.id, { onDelete: "set null" }),
  programId:       integer("programId").references(() => screeningPrograms.id, { onDelete: "set null" }),
  status:          screeningStatusEnum("status").notNull().default("pending"),
  overallOutcome:  assessmentOutcomeEnum("overallOutcome"),
  screeningTypes:  jsonb("screeningTypes").$type<string[]>().notNull().default([]),
  etaAt:           timestamp("etaAt"),
  completedAt:     timestamp("completedAt"),
  tags:            jsonb("tags").$type<string[]>().default([]),
  temporalRunId:   varchar("temporalRunId", { length: 128 }),
  tigerBeetleRef:  varchar("tigerBeetleRef", { length: 64 }),
  // Link back to BIS investigation — set when order is created from investigation context
  investigationRef: varchar("investigationRef", { length: 32 }),
  priceNgn:        integer("priceNgn").default(0),
  notes:           text("notes"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  deletedAt:       timestamp("deletedAt"),
  deletedBy:       integer("deletedBy"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  so_tenant_idx:    index("so_tenant_idx").on(t.tenantId),
  so_candidate_idx: index("so_candidate_idx").on(t.candidateId),
  so_status_idx:    index("so_status_idx").on(t.status),
  so_created_idx:   index("so_created_idx").on(t.createdAt),
}));
export type ScreeningOrder       = typeof screeningOrders.$inferSelect;
export type InsertScreeningOrder = typeof screeningOrders.$inferInsert;

// ─── Screening Results ────────────────────────────────────────────────────────

export const screeningResults = pgTable("screening_results", {
  id:              serial("id").primaryKey(),
  orderId:         integer("orderId").references(() => screeningOrders.id, { onDelete: "cascade" }).notNull(),
  screeningType:   screeningTypeEnum("screeningType").notNull(),
  status:          screeningStatusEnum("status").notNull().default("pending"),
  outcome:         assessmentOutcomeEnum("outcome"),
  rawResult:       jsonb("rawResult"),
  summary:         text("summary"),
  riskScore:       real("riskScore"),
  dataSourceRef:   varchar("dataSourceRef", { length: 64 }),
  externalRef:     varchar("externalRef", { length: 128 }),
  completedAt:     timestamp("completedAt"),
  expiresAt:       timestamp("expiresAt"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sr_order_idx:  index("sr_order_idx").on(t.orderId),
  sr_type_idx:   index("sr_type_idx").on(t.screeningType),
  sr_status_idx: index("sr_status_idx").on(t.status),
}));
export type ScreeningResult       = typeof screeningResults.$inferSelect;
export type InsertScreeningResult = typeof screeningResults.$inferInsert;

// ─── Adverse Actions ──────────────────────────────────────────────────────────

export const adverseActions = pgTable("adverse_actions", {
  id:                  serial("id").primaryKey(),
  adverseRef:          varchar("adverseRef", { length: 32 }).notNull().unique(),
  orderId:             integer("orderId").references(() => screeningOrders.id, { onDelete: "cascade" }).notNull(),
  candidateId:         integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  status:              adverseActionStatusEnum("status").notNull().default("pending_pre_adverse"),
  preAdverseSentAt:    timestamp("preAdverseSentAt"),
  preAdverseDeadline:  timestamp("preAdverseDeadline"),  // NDPR: 5 business days
  disputeReceivedAt:   timestamp("disputeReceivedAt"),
  disputeResolvedAt:   timestamp("disputeResolvedAt"),
  finalAdverseSentAt:  timestamp("finalAdverseSentAt"),
  candidateEmail:      varchar("candidateEmail", { length: 320 }),
  preAdversePdfUrl:    text("preAdversePdfUrl"),
  finalAdversePdfUrl:  text("finalAdversePdfUrl"),
  reason:              text("reason"),
  createdBy:           integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  aa_order_idx:     index("aa_order_idx").on(t.orderId),
  aa_candidate_idx: index("aa_candidate_idx").on(t.candidateId),
  aa_status_idx:    index("aa_status_idx").on(t.status),
}));
export type AdverseAction       = typeof adverseActions.$inferSelect;
export type InsertAdverseAction = typeof adverseActions.$inferInsert;

// ─── Adverse Items ────────────────────────────────────────────────────────────

export const adverseItems = pgTable("adverse_items", {
  id:              serial("id").primaryKey(),
  adverseActionId: integer("adverseActionId").references(() => adverseActions.id, { onDelete: "cascade" }).notNull(),
  resultId:        integer("resultId").references(() => screeningResults.id, { onDelete: "set null" }),
  screeningType:   screeningTypeEnum("screeningType").notNull(),
  description:     text("description").notNull(),
  source:          varchar("source", { length: 128 }),
  date:            date("date"),
  jurisdiction:    varchar("jurisdiction", { length: 128 }),
  disputed:        boolean("disputed").notNull().default(false),
  disputeNote:     text("disputeNote"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  ai_adverse_idx: index("ai_adverse_idx").on(t.adverseActionId),
}));
export type AdverseItem       = typeof adverseItems.$inferSelect;
export type InsertAdverseItem = typeof adverseItems.$inferInsert;

// ─── Candidate Consents (NDPR Art. 2.2) ──────────────────────────────────────

export const candidateConsents = pgTable("candidate_consents", {
  id:             serial("id").primaryKey(),
  consentRef:     varchar("consentRef", { length: 32 }).notNull().unique(),
  candidateId:    integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  orderId:        integer("orderId").references(() => screeningOrders.id, { onDelete: "set null" }),
  purpose:        consentPurposeEnum("purpose").notNull().default("pre_employment"),
  consentText:    text("consentText").notNull(),
  signatureData:  text("signatureData"),   // base64 eSignature PNG
  signedAt:       timestamp("signedAt"),
  signerIp:       varchar("signerIp", { length: 45 }),
  signerUserAgent: text("signerUserAgent"),
  pdfUrl:         text("pdfUrl"),          // S3 URL of consent PDF
  revokedAt:      timestamp("revokedAt"),
  revokeReason:   text("revokeReason"),
  ndprVersion:    varchar("ndprVersion", { length: 16 }).default("2019"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  cc_candidate_idx: index("cc_candidate_idx").on(t.candidateId),
  cc_order_idx:     index("cc_order_idx").on(t.orderId),
}));
export type CandidateConsent       = typeof candidateConsents.$inferSelect;
export type InsertCandidateConsent = typeof candidateConsents.$inferInsert;

// ─── Work Permits (NIS) ───────────────────────────────────────────────────────

export const workPermits = pgTable("work_permits", {
  id:              serial("id").primaryKey(),
  permitRef:       varchar("permitRef", { length: 32 }).notNull().unique(),
  candidateId:     integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  orderId:         integer("orderId").references(() => screeningOrders.id, { onDelete: "set null" }),
  permitType:      workPermitTypeEnum("permitType").notNull(),
  permitNumber:    varchar("permitNumber", { length: 64 }),
  issueDate:       date("issueDate"),
  expiryDate:      date("expiryDate"),
  issuingAuthority: varchar("issuingAuthority", { length: 128 }).default("Nigerian Immigration Service"),
  employerName:    varchar("employerName", { length: 255 }),
  worksiteId:      integer("worksiteId"),
  verificationStatus: assessmentOutcomeEnum("verificationStatus").default("pending"),
  verificationData:   jsonb("verificationData"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  wp_candidate_idx: index("wp_candidate_idx").on(t.candidateId),
}));
export type WorkPermit       = typeof workPermits.$inferSelect;
export type InsertWorkPermit = typeof workPermits.$inferInsert;

// ─── Worksites ────────────────────────────────────────────────────────────────

export const worksites = pgTable("worksites", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name:         varchar("name", { length: 255 }).notNull(),
  address:      text("address"),
  state:        varchar("state", { length: 64 }),
  lga:          varchar("lga", { length: 64 }),
  rcNumber:     varchar("rcNumber", { length: 32 }),   // CAC RC number
  isActive:     boolean("isActive").notNull().default(true),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  ws_tenant_idx: index("ws_tenant_idx").on(t.tenantId),
}));
export type Worksite       = typeof worksites.$inferSelect;
export type InsertWorksite = typeof worksites.$inferInsert;

// ─── Screening Geo Rules (36 states + FCT) ────────────────────────────────────

export const screeningGeos = pgTable("screening_geos", {
  id:                serial("id").primaryKey(),
  tenantId:          integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  state:             varchar("state", { length: 64 }).notNull(),
  screeningType:     screeningTypeEnum("screeningType").notNull(),
  lookbackYears:     integer("lookbackYears"),          // null = no limit
  excludedOffences:  jsonb("excludedOffences").$type<string[]>().default([]),
  requiresConsent:   boolean("requiresConsent").notNull().default(true),
  disclosureText:    text("disclosureText"),
  isActive:          boolean("isActive").notNull().default(true),
  notes:             text("notes"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sg_state_type_idx: index("sg_state_type_idx").on(t.state, t.screeningType),
}));
export type ScreeningGeo       = typeof screeningGeos.$inferSelect;
export type InsertScreeningGeo = typeof screeningGeos.$inferInsert;

// ─── Candidate Stories (NDPR right to explanation) ────────────────────────────

export const candidateStories = pgTable("candidate_stories", {
  id:              serial("id").primaryKey(),
  orderId:         integer("orderId").references(() => screeningOrders.id, { onDelete: "cascade" }).notNull(),
  candidateId:     integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  screeningType:   screeningTypeEnum("screeningType").notNull(),
  story:           text("story").notNull(),
  attachmentUrls:  jsonb("attachmentUrls").$type<string[]>().default([]),
  reviewedBy:      integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  reviewNote:      text("reviewNote"),
  reviewedAt:      timestamp("reviewedAt"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  cs_order_idx:     index("cs_order_idx").on(t.orderId),
  cs_candidate_idx: index("cs_candidate_idx").on(t.candidateId),
}));
export type CandidateStory       = typeof candidateStories.$inferSelect;
export type InsertCandidateStory = typeof candidateStories.$inferInsert;

// ─── Report Tags ──────────────────────────────────────────────────────────────

export const reportTags = pgTable("report_tags", {
  id:        serial("id").primaryKey(),
  tenantId:  integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name:      varchar("name", { length: 64 }).notNull(),
  color:     varchar("color", { length: 16 }).default("#6B7280"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  rt_tenant_idx: index("rt_tenant_idx").on(t.tenantId),
}));
export type ReportTag       = typeof reportTags.$inferSelect;
export type InsertReportTag = typeof reportTags.$inferInsert;

// ─── Screening Assessments (Auto-assess rules) ────────────────────────────────

export const screeningAssessments = pgTable("screening_assessments", {
  id:              serial("id").primaryKey(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  packageId:       integer("packageId").references(() => screeningPackages.id, { onDelete: "set null" }),
  screeningType:   screeningTypeEnum("screeningType").notNull(),
  clearConditions: jsonb("clearConditions"),   // conditions that auto-clear
  considerConditions: jsonb("considerConditions"), // conditions that require manual review
  adverseConditions:  jsonb("adverseConditions"),  // conditions that auto-adverse
  isActive:        boolean("isActive").notNull().default(true),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sa_tenant_type_idx: index("sa_tenant_type_idx").on(t.tenantId, t.screeningType),
}));
export type ScreeningAssessment       = typeof screeningAssessments.$inferSelect;
export type InsertScreeningAssessment = typeof screeningAssessments.$inferInsert;

// ─── NG Court Records ─────────────────────────────────────────────────────────

export const ngCourtRecords = pgTable("ng_court_records", {
  id:              serial("id").primaryKey(),
  resultId:        integer("resultId").references(() => screeningResults.id, { onDelete: "cascade" }).notNull(),
  candidateId:     integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  courtType:       courtTypeEnum("courtType").notNull(),
  courtName:       varchar("courtName", { length: 255 }),
  state:           varchar("state", { length: 64 }),
  caseNumber:      varchar("caseNumber", { length: 128 }),
  offence:         text("offence"),
  verdict:         varchar("verdict", { length: 128 }),
  sentence:        text("sentence"),
  hearingDate:     date("hearingDate"),
  dispositionDate: date("dispositionDate"),
  isAppeal:        boolean("isAppeal").default(false),
  rawData:         jsonb("rawData"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  ncr_result_idx:    index("ncr_result_idx").on(t.resultId),
  ncr_candidate_idx: index("ncr_candidate_idx").on(t.candidateId),
  ncr_state_idx:     index("ncr_state_idx").on(t.state),
}));
export type NgCourtRecord       = typeof ngCourtRecords.$inferSelect;
export type InsertNgCourtRecord = typeof ngCourtRecords.$inferInsert;

// ─── NG Professional Licences ─────────────────────────────────────────────────

export const ngProfessionalLicences = pgTable("ng_professional_licences", {
  id:                serial("id").primaryKey(),
  resultId:          integer("resultId").references(() => screeningResults.id, { onDelete: "cascade" }).notNull(),
  candidateId:       integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  professionalBody:  professionalBodyEnum("professionalBody").notNull(),
  licenceNumber:     varchar("licenceNumber", { length: 128 }),
  membershipGrade:   varchar("membershipGrade", { length: 64 }),
  issueDate:         date("issueDate"),
  expiryDate:        date("expiryDate"),
  status:            assessmentOutcomeEnum("status").notNull().default("pending"),
  suspensionReason:  text("suspensionReason"),
  verificationDate:  date("verificationDate"),
  rawData:           jsonb("rawData"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  npl_result_idx:    index("npl_result_idx").on(t.resultId),
  npl_candidate_idx: index("npl_candidate_idx").on(t.candidateId),
  npl_body_idx:      index("npl_body_idx").on(t.professionalBody),
}));
export type NgProfessionalLicence       = typeof ngProfessionalLicences.$inferSelect;
export type InsertNgProfessionalLicence = typeof ngProfessionalLicences.$inferInsert;

// ─── Continuous Checks (Post-hire monitoring subscriptions) ───────────────────

export const continuousChecks = pgTable("continuous_checks", {
  id:              serial("id").primaryKey(),
  checkRef:        varchar("checkRef", { length: 32 }).notNull().unique(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  candidateId:     integer("candidateId").references(() => candidateProfiles.id, { onDelete: "restrict" }).notNull(),
  screeningTypes:  jsonb("screeningTypes").$type<string[]>().notNull().default([]),
  frequency:       varchar("frequency", { length: 32 }).notNull().default("monthly"),
  status:          monitorStatusEnum("status").notNull().default("active"),
  lastCheckedAt:   timestamp("lastCheckedAt"),
  nextCheckAt:     timestamp("nextCheckAt"),
  alertCount:      integer("alertCount").notNull().default(0),
  lastAlertAt:     timestamp("lastAlertAt"),
  expiresAt:       timestamp("expiresAt"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  cont_tenant_idx:    index("cont_tenant_idx").on(t.tenantId),
  cont_candidate_idx: index("cont_candidate_idx").on(t.candidateId),
  cont_status_idx:    index("cont_status_idx").on(t.status),
}));
export type ContinuousCheck       = typeof continuousChecks.$inferSelect;
export type InsertContinuousCheck = typeof continuousChecks.$inferInsert;

// ─── Screening AI Summaries ──────────────────────────────────────────────────
export const screeningAiSummaries = pgTable("screening_ai_summaries", {
  id:              serial("id").primaryKey(),
  summaryRef:      varchar("summaryRef", { length: 32 }).notNull().unique(),
  investigationRef: varchar("investigationRef", { length: 32 }).notNull(),
  orderRefs:       jsonb("orderRefs").$type<string[]>().notNull().default([]),
  overallRisk:     varchar("overallRisk", { length: 16 }).notNull(),
  headline:        text("headline").notNull(),
  keyFindings:     jsonb("keyFindings").$type<string[]>().notNull().default([]),
  redFlags:        jsonb("redFlags").$type<string[]>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  fullNarrative:   text("fullNarrative").notNull(),
  compositeScore:  real("compositeScore"),
  modelVersion:    varchar("modelVersion", { length: 32 }).default("gpt-4o"),
  generatedBy:     integer("generatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sas_inv_idx: index("sas_inv_idx").on(t.investigationRef),
}));
export type ScreeningAiSummary       = typeof screeningAiSummaries.$inferSelect;
export type InsertScreeningAiSummary = typeof screeningAiSummaries.$inferInsert;

// ─── Corporate Screening Profiles ────────────────────────────────────────────
export const corporateScreeningProfiles = pgTable("corporate_screening_profiles", {
  id:              serial("id").primaryKey(),
  profileRef:      varchar("profileRef", { length: 32 }).notNull().unique(),
  investigationRef: varchar("investigationRef", { length: 32 }),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  companyName:     varchar("companyName", { length: 255 }).notNull(),
  rcNumber:        varchar("rcNumber", { length: 20 }).notNull(),
  tinNumber:       varchar("tinNumber", { length: 20 }),
  incorporationDate: timestamp("incorporationDate"),
  companyType:     varchar("companyType", { length: 64 }),
  registeredAddress: text("registeredAddress"),
  status:          screeningStatusEnum("status").notNull().default("pending"),
  overallOutcome:  assessmentOutcomeEnum("overallOutcome"),
  cacResult:       jsonb("cacResult"),
  firsResult:      jsonb("firsResult"),
  directorsResult: jsonb("directorsResult"),
  sanctionsResult: jsonb("sanctionsResult"),
  riskScore:       real("riskScore"),
  notes:           text("notes"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  csp_inv_idx:    index("csp_inv_idx").on(t.investigationRef),
  csp_tenant_idx: index("csp_tenant_idx").on(t.tenantId),
  csp_rc_idx:     index("csp_rc_idx").on(t.rcNumber),
}));
export type CorporateScreeningProfile       = typeof corporateScreeningProfiles.$inferSelect;
export type InsertCorporateScreeningProfile = typeof corporateScreeningProfiles.$inferInsert;

// ─── Field Visit Reports ──────────────────────────────────────────────────────

export const fieldVisitReports = pgTable("field_visit_reports", {
  id:                serial("id").primaryKey(),
  visitRef:          varchar("visitRef", { length: 32 }).notNull().unique(),
  taskRef:           varchar("taskRef", { length: 32 }).notNull(),
  investigationId:   integer("investigationId"),
  agentId:           varchar("agentId", { length: 64 }).notNull(),
  agentName:         varchar("agentName", { length: 255 }).notNull(),
  // GPS trail
  checkInAt:         timestamp("checkInAt"),
  checkInLat:        real("checkInLat"),
  checkInLng:        real("checkInLng"),
  checkOutAt:        timestamp("checkOutAt"),
  checkOutLat:       real("checkOutLat"),
  checkOutLng:       real("checkOutLng"),
  durationMinutes:   integer("durationMinutes"),
  // Findings
  subjectPresent:    boolean("subjectPresent"),
  addressConfirmed:  boolean("addressConfirmed"),
  findings:          text("findings"),
  structuredFindings: jsonb("structuredFindings"),
  photoUrls:         jsonb("photoUrls").$type<string[]>().default([]),
  // Data completeness
  dataCompleteness:  real("dataCompleteness"),           // 0–100 coverage score
  sourcesChecked:    jsonb("sourcesChecked").$type<string[]>().default([]),
  sourcesReturned:   jsonb("sourcesReturned").$type<string[]>().default([]),
  recommendedNextSteps: jsonb("recommendedNextSteps").$type<string[]>().default([]),
  // Status
  outcome:           varchar("outcome", { length: 32 }),  // confirmed / unconfirmed / inconclusive
  submittedAt:       timestamp("submittedAt"),
  createdBy:         integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  fvr_task_idx:  index("fvr_task_idx").on(t.taskRef),
  fvr_inv_idx:   index("fvr_inv_idx").on(t.investigationId),
  fvr_agent_idx: index("fvr_agent_idx").on(t.agentId),
}));
export type FieldVisitReport       = typeof fieldVisitReports.$inferSelect;
export type InsertFieldVisitReport = typeof fieldVisitReports.$inferInsert;

// ─── Nigerian Law Enforcement Criminal Records ────────────────────────────────

export const lawEnforcementAgencyEnum = pgEnum("law_enforcement_agency", [
  "npf",          // Nigeria Police Force (federal)
  "efcc",         // Economic and Financial Crimes Commission
  "icpc",         // Independent Corrupt Practices Commission
  "dss",          // Department of State Services
  "ndlea",        // National Drug Law Enforcement Agency
  "nscdc",        // Nigeria Security and Civil Defence Corps
  "frsc",         // Federal Road Safety Corps
  "custom_state", // State-level police command (specify in stateCommand field)
]);

export const criminalRequestStatusEnum = pgEnum("criminal_request_status", [
  "draft",
  "submitted",
  "acknowledged",
  "processing",
  "completed",
  "rejected",
  "expired",
]);

export const offenceCategoryEnum = pgEnum("offence_category", [
  "violent",       // murder, assault, armed robbery
  "financial",     // fraud, money laundering, advance fee
  "drug",          // trafficking, possession, cultivation
  "cybercrime",    // hacking, identity theft, online fraud
  "terrorism",     // terrorism, insurgency, extremism
  "corruption",    // bribery, embezzlement, abuse of office
  "traffic",       // dangerous driving, DUI, vehicular manslaughter
  "sexual",        // rape, sexual assault, trafficking
  "property",      // theft, burglary, arson
  "other",
]);

export const criminalVerdictEnum = pgEnum("criminal_verdict", [
  "convicted",
  "acquitted",
  "discharged",
  "pending",
  "nolle_prosequi",
  "unknown",
]);

// ── criminal_record_requests ──────────────────────────────────────────────────
// One request per agency per subject — tracks the lifecycle of a data request
// sent to a Nigerian law enforcement agency.

export const criminalRecordRequests = pgTable("criminal_record_requests", {
  id:               serial("id").primaryKey(),
  requestRef:       varchar("requestRef", { length: 32 }).notNull().unique(),
  tenantId:         integer("tenantId"),
  investigationRef: varchar("investigationRef", { length: 32 }),
  // Subject identifiers
  subjectName:      text("subjectName").notNull(),
  subjectType:      subjectTypeEnum("subjectType").default("individual").notNull(),
  nin:              varchar("nin", { length: 20 }),
  bvn:              varchar("bvn", { length: 20 }),
  dob:              date("dob"),
  gender:           varchar("gender", { length: 16 }),
  nationality:      varchar("nationality", { length: 64 }).default("Nigerian"),
  // Agency details
  agency:           lawEnforcementAgencyEnum("agency").notNull(),
  stateCommand:     varchar("stateCommand", { length: 64 }),   // e.g. "Lagos State Police Command"
  agencyRefNumber:  varchar("agencyRefNumber", { length: 64 }), // agency's own reference
  contactOfficer:   text("contactOfficer"),
  contactEmail:     varchar("contactEmail", { length: 320 }),
  contactPhone:     varchar("contactPhone", { length: 32 }),
  // Request metadata
  priority:         priorityEnum("priority").default("medium").notNull(),
  status:           criminalRequestStatusEnum("status").default("draft").notNull(),
  purpose:          text("purpose"),                           // reason for request
  requestedChecks:  jsonb("requestedChecks").$type<string[]>().default([]), // e.g. ["arrest", "conviction", "warrant"]
  // Timestamps
  submittedAt:      timestamp("submittedAt"),
  acknowledgedAt:   timestamp("acknowledgedAt"),
  processingAt:     timestamp("processingAt"),
  completedAt:      timestamp("completedAt"),
  rejectedAt:       timestamp("rejectedAt"),
  rejectedReason:   text("rejectedReason"),
  expiresAt:        timestamp("expiresAt"),
  // Tracking
  requestedBy:      integer("requestedBy").references(() => users.id, { onDelete: "set null" }),
  assignedTo:       integer("assignedTo").references(() => users.id, { onDelete: "set null" }),
  notes:            text("notes"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  crr_ref_idx:  index("crr_ref_idx").on(t.requestRef),
  crr_inv_idx:  index("crr_inv_idx").on(t.investigationRef),
  crr_nin_idx:  index("crr_nin_idx").on(t.nin),
  crr_stat_idx: index("crr_stat_idx").on(t.status),
  crr_agcy_idx: index("crr_agcy_idx").on(t.agency),
}));
export type CriminalRecordRequest       = typeof criminalRecordRequests.$inferSelect;
export type InsertCriminalRecordRequest = typeof criminalRecordRequests.$inferInsert;

// ── criminal_records ──────────────────────────────────────────────────────────
// Individual criminal record entries returned by an agency in response to a
// criminal_record_requests entry, or ingested manually by an analyst.

export const criminalRecords = pgTable("criminal_records", {
  id:                serial("id").primaryKey(),
  recordRef:         varchar("recordRef", { length: 32 }).notNull().unique(),
  requestRef:        varchar("requestRef", { length: 32 }),    // FK to criminalRecordRequests
  investigationRef:  varchar("investigationRef", { length: 32 }),
  tenantId:          integer("tenantId"),
  // Agency
  agency:            lawEnforcementAgencyEnum("agency").notNull(),
  agencyRef:         varchar("agencyRef", { length: 64 }),      // agency's internal case/file ref
  stateCommand:      varchar("stateCommand", { length: 64 }),
  // Subject
  subjectName:       text("subjectName").notNull(),
  nin:               varchar("nin", { length: 20 }),
  dob:               date("dob"),
  gender:            varchar("gender", { length: 16 }),
  nationality:       varchar("nationality", { length: 64 }),
  aliases:           jsonb("aliases").$type<string[]>().default([]),
  // Offence
  offenceCategory:   offenceCategoryEnum("offenceCategory").notNull(),
  offenceCode:       varchar("offenceCode", { length: 32 }),    // e.g. "S.319 CC"
  offenceDescription: text("offenceDescription").notNull(),
  offenceDate:       date("offenceDate"),
  offenceLocation:   text("offenceLocation"),
  offenceState:      varchar("offenceState", { length: 64 }),
  // Arrest & charge
  dateArrested:      date("dateArrested"),
  arrestingStation:  text("arrestingStation"),
  dateCharged:       date("dateCharged"),
  chargingAuthority: text("chargingAuthority"),
  // Court
  courtName:         text("courtName"),
  caseNumber:        varchar("caseNumber", { length: 64 }),
  verdict:           criminalVerdictEnum("verdict").default("unknown"),
  dateConvicted:     date("dateConvicted"),
  sentence:          text("sentence"),                          // e.g. "5 years IHL"
  dateReleased:      date("dateReleased"),
  // Warrant
  outstandingWarrant: boolean("outstandingWarrant").default(false),
  warrantDetails:    text("warrantDetails"),
  warrantIssuedBy:   text("warrantIssuedBy"),
  warrantIssuedAt:   date("warrantIssuedAt"),
  // Data quality
  dataSource:        varchar("dataSource", { length: 64 }).default("agency_response"), // agency_response | manual_entry | api_integration
  confidence:        real("confidence"),                        // 0–1 confidence score
  verifiedBy:        integer("verifiedBy").references(() => users.id, { onDelete: "set null" }),
  verifiedAt:        timestamp("verifiedAt"),
  rawPayload:        jsonb("rawPayload"),                        // original API/form payload
  // Tracking
  recordedBy:        integer("recordedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  cr_ref_idx:   index("cr_ref_idx").on(t.recordRef),
  cr_req_idx:   index("cr_req_idx").on(t.requestRef),
  cr_inv_idx:   index("cr_inv_idx").on(t.investigationRef),
  cr_nin_idx:   index("cr_nin_idx").on(t.nin),
  cr_agcy_idx:  index("cr_agcy_idx").on(t.agency),
  cr_cat_idx:   index("cr_cat_idx").on(t.offenceCategory),
  cr_warr_idx:  index("cr_warr_idx").on(t.outstandingWarrant),
}));
export type CriminalRecord       = typeof criminalRecords.$inferSelect;
export type InsertCriminalRecord = typeof criminalRecords.$inferInsert;

// ── criminal_record_attachments ───────────────────────────────────────────────
// Documents attached to a criminal record or request (police extracts, court
// judgements, warrant copies, agency letters).

export const criminalRecordAttachments = pgTable("criminal_record_attachments", {
  id:           serial("id").primaryKey(),
  attachmentRef: varchar("attachmentRef", { length: 32 }).notNull().unique(),
  recordRef:    varchar("recordRef", { length: 32 }),
  requestRef:   varchar("requestRef", { length: 32 }),
  tenantId:     integer("tenantId"),
  fileName:     text("fileName").notNull(),
  fileUrl:      text("fileUrl").notNull(),
  fileKey:      text("fileKey").notNull(),
  mimeType:     varchar("mimeType", { length: 128 }),
  fileSize:     integer("fileSize"),
  documentType: varchar("documentType", { length: 64 }), // police_extract | court_judgement | warrant | agency_letter | other
  description:  text("description"),
  uploadedBy:   integer("uploadedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  cra_rec_idx: index("cra_rec_idx").on(t.recordRef),
  cra_req_idx: index("cra_req_idx").on(t.requestRef),
}));
export type CriminalRecordAttachment       = typeof criminalRecordAttachments.$inferSelect;
export type InsertCriminalRecordAttachment = typeof criminalRecordAttachments.$inferInsert;

// ── criminal_record_audit ─────────────────────────────────────────────────────
// Immutable audit trail for every status change and action on requests/records.

export const criminalRecordAudit = pgTable("criminal_record_audit", {
  id:         serial("id").primaryKey(),
  auditRef:   varchar("auditRef", { length: 32 }).notNull().unique(),
  requestRef: varchar("requestRef", { length: 32 }),
  recordRef:  varchar("recordRef", { length: 32 }),
  tenantId:   integer("tenantId"),
  action:     varchar("action", { length: 64 }).notNull(),  // submitted | acknowledged | record_ingested | status_changed | attachment_uploaded | verified
  actorId:    integer("actorId").references(() => users.id, { onDelete: "set null" }),
  actorName:  text("actorName"),
  details:    jsonb("details"),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  cra2_req_idx: index("cra2_req_idx").on(t.requestRef),
  cra2_rec_idx: index("cra2_rec_idx").on(t.recordRef),
}));
export type CriminalRecordAuditEntry       = typeof criminalRecordAudit.$inferSelect;
export type InsertCriminalRecordAuditEntry = typeof criminalRecordAudit.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE TABLES — Added during schema audit (2026-07)
// ═══════════════════════════════════════════════════════════════════════════════

// ── tigerbeetle_accounts ──────────────────────────────────────────────────────
export const tigerbeetleAccounts = pgTable("tigerbeetle_accounts", {
  id:              serial("id").primaryKey(),
  accountId:       varchar("accountId", { length: 64 }).notNull().unique(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  ledger:          integer("ledger").notNull().default(1),
  code:            integer("code").notNull().default(700),
  creditsPending:  bigint("creditsPending", { mode: "number" }).default(0),
  creditsPosted:   bigint("creditsPosted", { mode: "number" }).default(0),
  debitsPending:   bigint("debitsPending", { mode: "number" }).default(0),
  debitsPosted:    bigint("debitsPosted", { mode: "number" }).default(0),
  flags:           integer("flags").default(0),
  lastReconciledAt: timestamp("lastReconciledAt"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  tb_tenant_idx: index("tb_tenant_idx").on(t.tenantId),
  tb_account_idx: index("tb_account_idx").on(t.accountId),
}));
export type TigerBeetleAccount = typeof tigerbeetleAccounts.$inferSelect;
export type InsertTigerBeetleAccount = typeof tigerbeetleAccounts.$inferInsert;

// ── tigerbeetle_transfers ─────────────────────────────────────────────────────
export const tigerbeetleTransfers = pgTable("tigerbeetle_transfers", {
  id:              serial("id").primaryKey(),
  transferId:      varchar("transferId", { length: 64 }).notNull().unique(),
  debitAccountId:  varchar("debitAccountId", { length: 64 }).notNull(),
  creditAccountId: varchar("creditAccountId", { length: 64 }).notNull(),
  amount:          bigint("amount", { mode: "number" }).notNull(),
  ledger:          integer("ledger").notNull().default(1),
  code:            integer("code").notNull().default(1),
  flags:           integer("flags").default(0),
  userData:        jsonb("userData"),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  txRef:           varchar("txRef", { length: 128 }),
  reconciledAt:    timestamp("reconciledAt"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tbt_debit_idx:  index("tbt_debit_idx").on(t.debitAccountId),
  tbt_credit_idx: index("tbt_credit_idx").on(t.creditAccountId),
  tbt_tenant_idx: index("tbt_tenant_idx").on(t.tenantId),
  tbt_txref_idx:  index("tbt_txref_idx").on(t.txRef),
}));
export type TigerBeetleTransfer = typeof tigerbeetleTransfers.$inferSelect;
export type InsertTigerBeetleTransfer = typeof tigerbeetleTransfers.$inferInsert;

// ── temporal_workflow_state ───────────────────────────────────────────────────
export const temporalWorkflowStates = pgTable("temporal_workflow_state", {
  id:             serial("id").primaryKey(),
  workflowId:     varchar("workflowId", { length: 256 }).notNull().unique(),
  runId:          varchar("runId", { length: 256 }),
  workflowType:   varchar("workflowType", { length: 128 }).notNull(),
  namespace:      varchar("namespace", { length: 128 }).notNull().default("bis"),
  status:         varchar("status", { length: 32 }).notNull().default("running"),
  input:          jsonb("input"),
  result:         jsonb("result"),
  errorMessage:   text("errorMessage"),
  tenantId:       integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  initiatedBy:    integer("initiatedBy").references(() => users.id, { onDelete: "set null" }),
  entityRef:      varchar("entityRef", { length: 128 }),
  entityType:     varchar("entityType", { length: 64 }),
  startedAt:      timestamp("startedAt").defaultNow().notNull(),
  completedAt:    timestamp("completedAt"),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  tws_entity_idx:  index("tws_entity_idx").on(t.entityRef, t.entityType),
  tws_status_idx:  index("tws_status_idx").on(t.status),
  tws_tenant_idx:  index("tws_tenant_idx").on(t.tenantId),
  tws_type_idx:    index("tws_type_idx").on(t.workflowType),
}));
export type TemporalWorkflowState = typeof temporalWorkflowStates.$inferSelect;
export type InsertTemporalWorkflowState = typeof temporalWorkflowStates.$inferInsert;

// ── dapr_event_log ────────────────────────────────────────────────────────────
export const daprSubscriptionStates = pgTable("dapr_event_log", {
  id:          serial("id").primaryKey(),
  topic:       varchar("topic", { length: 128 }).notNull(),
  pubsubName:  varchar("pubsubName", { length: 64 }).notNull().default("bis-pubsub"),
  payload:     jsonb("payload").notNull(),
  status:      varchar("status", { length: 32 }).notNull().default("published"),
  tenantId:    integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  entityRef:   varchar("entityRef", { length: 128 }),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
  failReason:  text("failReason"),
}, (t) => ({
  del_topic_idx:  index("del_topic_idx").on(t.topic),
  del_entity_idx: index("del_entity_idx").on(t.entityRef),
  del_tenant_idx: index("del_tenant_idx").on(t.tenantId),
  del_ts_idx:     index("del_ts_idx").on(t.publishedAt),
}));
export type DaprEventLog = typeof daprSubscriptionStates.$inferSelect;
export type InsertDaprEventLog = typeof daprSubscriptionStates.$inferInsert;

// ── apisix_audit_log ─────────────────────────────────────────────────────────
export const apisixAuditLogs = pgTable("apisix_audit_log", {
  id:           serial("id").primaryKey(),
  requestId:    varchar("requestId", { length: 64 }),
  routeId:      varchar("routeId", { length: 64 }),
  clientIp:     varchar("clientIp", { length: 45 }),
  method:       varchar("method", { length: 10 }),
  uri:          text("uri"),
  statusCode:   integer("statusCode"),
  latencyMs:    integer("latencyMs"),
  wafStatus:    varchar("wafStatus", { length: 32 }),
  wafAttackType: varchar("wafAttackType", { length: 64 }),
  tenantId:     integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  userId:       integer("userId").references(() => users.id, { onDelete: "set null" }),
  rawLog:       jsonb("rawLog"),
  loggedAt:     timestamp("loggedAt").defaultNow().notNull(),
}, (t) => ({
  aal_ip_idx:     index("aal_ip_idx").on(t.clientIp),
  aal_route_idx:  index("aal_route_idx").on(t.routeId),
  aal_status_idx: index("aal_status_idx").on(t.statusCode),
  aal_ts_idx:     index("aal_ts_idx").on(t.loggedAt),
  aal_tenant_idx: index("aal_tenant_idx").on(t.tenantId),
}));
export type ApisixAuditLog = typeof apisixAuditLogs.$inferSelect;
export type InsertApisixAuditLog = typeof apisixAuditLogs.$inferInsert;

// ── permify_relationship_log ──────────────────────────────────────────────────
export const permifyRelationshipLog = pgTable("permify_relationship_log", {
  id:         serial("id").primaryKey(),
  entity:     varchar("entity", { length: 64 }).notNull(),
  entityId:   varchar("entityId", { length: 128 }).notNull(),
  relation:   varchar("relation", { length: 64 }).notNull(),
  subject:    varchar("subject", { length: 64 }).notNull(),
  subjectId:  varchar("subjectId", { length: 128 }).notNull(),
  operation:  varchar("operation", { length: 16 }).notNull().default("write"),
  tenantId:   integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  actorId:    integer("actorId").references(() => users.id, { onDelete: "set null" }),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  prl_entity_idx:  index("prl_entity_idx").on(t.entity, t.entityId),
  prl_subject_idx: index("prl_subject_idx").on(t.subject, t.subjectId),
  prl_tenant_idx:  index("prl_tenant_idx").on(t.tenantId),
}));
export type PermifyRelationshipLog = typeof permifyRelationshipLog.$inferSelect;
export type InsertPermifyRelationshipLog = typeof permifyRelationshipLog.$inferInsert;

// ── service_health_history ────────────────────────────────────────────────────
export const serviceHealthHistory = pgTable("service_health_history", {
  id:        serial("id").primaryKey(),
  service:   varchar("service", { length: 64 }).notNull(),
  status:    varchar("status", { length: 16 }).notNull(),
  latencyMs: integer("latencyMs"),
  detail:    jsonb("detail"),
  checkedAt: timestamp("checkedAt").defaultNow().notNull(),
}, (t) => ({
  shh_service_idx: index("shh_service_idx").on(t.service),
  shh_ts_idx:      index("shh_ts_idx").on(t.checkedAt),
  shh_status_idx:  index("shh_status_idx").on(t.status),
}));
export type ServiceHealthHistory = typeof serviceHealthHistory.$inferSelect;
export type InsertServiceHealthHistory = typeof serviceHealthHistory.$inferInsert;

// ── fluvio_topic_registry ─────────────────────────────────────────────────────
export const fluvioTopicRegistry = pgTable("fluvio_topic_registry", {
  id:           serial("id").primaryKey(),
  topicName:    varchar("topicName", { length: 128 }).notNull().unique(),
  description:  text("description"),
  partitions:   integer("partitions").default(1),
  replication:  integer("replication").default(1),
  retentionMs:  bigint("retentionMs", { mode: "number" }).default(604800000),
  isActive:     boolean("isActive").default(true),
  lastMessageAt: timestamp("lastMessageAt"),
  messageCount: bigint("messageCount", { mode: "number" }).default(0),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  ftr_topic_idx: index("ftr_topic_idx").on(t.topicName),
}));
export type FluvioTopicRegistry = typeof fluvioTopicRegistry.$inferSelect;
export type InsertFluvioTopicRegistry = typeof fluvioTopicRegistry.$inferInsert;

// ── keycloak_sync_log ─────────────────────────────────────────────────────────
export const keycloakSyncLog = pgTable("keycloak_sync_log", {
  id:          serial("id").primaryKey(),
  keycloakId:  varchar("keycloakId", { length: 128 }),
  bisUserId:   integer("bisUserId").references(() => users.id, { onDelete: "set null" }),
  operation:   varchar("operation", { length: 32 }).notNull(),
  status:      varchar("status", { length: 16 }).notNull(),
  detail:      jsonb("detail"),
  errorMessage: text("errorMessage"),
  syncedAt:    timestamp("syncedAt").defaultNow().notNull(),
}, (t) => ({
  ksl_keycloak_idx: index("ksl_keycloak_idx").on(t.keycloakId),
  ksl_user_idx:     index("ksl_user_idx").on(t.bisUserId),
  ksl_op_idx:       index("ksl_op_idx").on(t.operation),
}));
export type KeycloakSyncLog = typeof keycloakSyncLog.$inferSelect;
export type InsertKeycloakSyncLog = typeof keycloakSyncLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// MISSING DOMAIN TABLES — Added in polyglot integration pass
// ═══════════════════════════════════════════════════════════════════════════════

// ── risk_profiles ─────────────────────────────────────────────────────────────
export const riskProfileStatusEnum = pgEnum("risk_profile_status", [
  "active", "under_review", "escalated", "archived",
]);
export const riskProfiles = pgTable("risk_profiles", {
  id:              serial("id").primaryKey(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  subjectRef:      varchar("subjectRef", { length: 128 }).notNull(),
  subjectName:     varchar("subjectName", { length: 255 }),
  subjectType:     varchar("subjectType", { length: 32 }).notNull().default("individual"),
  overallScore:    real("overallScore"),
  amlScore:        real("amlScore"),
  kycScore:        real("kycScore"),
  sanctionsScore:  real("sanctionsScore"),
  fraudScore:      real("fraudScore"),
  pepExposure:     boolean("pepExposure").default(false),
  sanctionsHit:    boolean("sanctionsHit").default(false),
  adverseMedia:    boolean("adverseMedia").default(false),
  riskBand:        varchar("riskBand", { length: 16 }).notNull().default("medium"),
  status:          riskProfileStatusEnum("status").notNull().default("active"),
  mlModelVersion:  varchar("mlModelVersion", { length: 64 }),
  factors:         jsonb("factors"),
  lastScoredAt:    timestamp("lastScoredAt"),
  nextReviewAt:    timestamp("nextReviewAt"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  rp_subject_idx:  index("rp_subject_idx").on(t.subjectRef),
  rp_tenant_idx:   index("rp_tenant_idx").on(t.tenantId),
  rp_band_idx:     index("rp_band_idx").on(t.riskBand),
  rp_score_idx:    index("rp_score_idx").on(t.overallScore),
  rp_subject_uniq: uniqueIndex("rp_subject_uniq").on(t.tenantId, t.subjectRef),
  rp_score_check:  check("rp_score_check", sql`"overallScore" IS NULL OR ("overallScore" >= 0 AND "overallScore" <= 100)`),
}));
export type RiskProfile = typeof riskProfiles.$inferSelect;
export type InsertRiskProfile = typeof riskProfiles.$inferInsert;

// ── compliance_reports ────────────────────────────────────────────────────────
export const complianceReportTypeEnum = pgEnum("compliance_report_type", [
  "sar_xml", "goaml_str", "goaml_ctr", "cbn_monthly", "cbn_quarterly",
  "fatf_risk", "nfiu_annual", "custom",
]);
export const complianceReportStatusEnum = pgEnum("compliance_report_status", [
  "generating", "ready", "submitted", "failed",
]);
export const complianceReports = pgTable("compliance_reports", {
  id:            serial("id").primaryKey(),
  tenantId:      integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  reportType:    complianceReportTypeEnum("reportType").notNull(),
  status:        complianceReportStatusEnum("status").notNull().default("generating"),
  title:         varchar("title", { length: 255 }).notNull(),
  periodStart:   timestamp("periodStart"),
  periodEnd:     timestamp("periodEnd"),
  xmlPayload:    text("xmlPayload"),
  pdfUrl:        varchar("pdfUrl", { length: 512 }),
  submittedTo:   varchar("submittedTo", { length: 64 }),
  submittedAt:   timestamp("submittedAt"),
  referenceNumber: varchar("referenceNumber", { length: 128 }),
  errorMessage:  text("errorMessage"),
  metadata:      jsonb("metadata"),
  generatedBy:   integer("generatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  cr_tenant_idx:  index("cr_tenant_idx").on(t.tenantId),
  cr_type_idx:    index("cr_type_idx").on(t.reportType),
  cr_status_idx:  index("cr_status_idx").on(t.status),
}));
export type ComplianceReport = typeof complianceReports.$inferSelect;
export type InsertComplianceReport = typeof complianceReports.$inferInsert;

// ── waf_incidents ─────────────────────────────────────────────────────────────
export const wafSeverityEnum = pgEnum("waf_severity", ["low", "medium", "high", "critical"]);
export const wafIncidents = pgTable("waf_incidents", {
  id:             serial("id").primaryKey(),
  tenantId:       integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  sourceIp:       varchar("sourceIp", { length: 45 }),
  method:         varchar("method", { length: 10 }),
  uri:            text("uri"),
  attackType:     varchar("attackType", { length: 64 }),
  severity:       wafSeverityEnum("severity").notNull().default("medium"),
  blocked:        boolean("blocked").notNull().default(true),
  ruleId:         varchar("ruleId", { length: 64 }),
  userAgent:      text("userAgent"),
  requestBody:    text("requestBody"),
  responseCode:   integer("responseCode"),
  country:        varchar("country", { length: 3 }),
  apisixRouteId:  varchar("apisixRouteId", { length: 128 }),
  openappsecEventId: varchar("openappsecEventId", { length: 128 }),
  metadata:       jsonb("metadata"),
  resolvedAt:     timestamp("resolvedAt"),
  resolvedBy:     integer("resolvedBy").references(() => users.id, { onDelete: "set null" }),
  occurredAt:     timestamp("occurredAt").defaultNow().notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  waf_ip_idx:     index("waf_ip_idx").on(t.sourceIp),
  waf_sev_idx:    index("waf_sev_idx").on(t.severity),
  waf_time_idx:   index("waf_time_idx").on(t.occurredAt),
  waf_tenant_idx: index("waf_tenant_idx").on(t.tenantId),
}));
export type WafIncident = typeof wafIncidents.$inferSelect;
export type InsertWafIncident = typeof wafIncidents.$inferInsert;

// ── mojaloop_transfers ────────────────────────────────────────────────────────
export const mojaloopStatusEnum = pgEnum("mojaloop_status", [
  "initiated", "pending", "completed", "failed", "reversed", "expired",
]);
export const mojaloopTransfers = pgTable("mojaloop_transfers", {
  id:                  serial("id").primaryKey(),
  tenantId:            integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  txRef:               varchar("txRef", { length: 128 }).notNull().unique(),
  externalRef:         varchar("externalRef", { length: 128 }),
  rail:                varchar("rail", { length: 32 }).notNull().default("mojaloop"),
  originatorAccount:   varchar("originatorAccount", { length: 64 }).notNull(),
  originatorName:      varchar("originatorName", { length: 255 }),
  beneficiaryAccount:  varchar("beneficiaryAccount", { length: 64 }).notNull(),
  beneficiaryName:     varchar("beneficiaryName", { length: 255 }),
  beneficiaryBankCode: varchar("beneficiaryBankCode", { length: 16 }),
  amountKobo:          bigint("amountKobo", { mode: "number" }).notNull(),
  currency:            varchar("currency", { length: 3 }).notNull().default("NGN"),
  narration:           text("narration"),
  status:              mojaloopStatusEnum("status").notNull().default("initiated"),
  failureReason:       text("failureReason"),
  metadata:            jsonb("metadata"),
  completedAt:         timestamp("completedAt"),
  initiatedBy:         integer("initiatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  mjl_txref_idx:   index("mjl_txref_idx").on(t.txRef),
  mjl_tenant_idx:  index("mjl_tenant_idx").on(t.tenantId),
  mjl_status_idx:  index("mjl_status_idx").on(t.status),
  mjl_amount_check: check("mjl_amount_check", sql`"amountKobo" > 0`),
}));
export type MojaloopTransfer = typeof mojaloopTransfers.$inferSelect;
export type InsertMojaloopTransfer = typeof mojaloopTransfers.$inferInsert;

// ── stablecoin_transactions ───────────────────────────────────────────────────
export const stablecoinStatusEnum = pgEnum("stablecoin_status", [
  "pending", "confirmed", "failed", "reversed",
]);
export const stablecoinTransactions = pgTable("stablecoin_transactions", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  txRef:        varchar("txRef", { length: 128 }).notNull().unique(),
  txHash:       varchar("txHash", { length: 128 }),
  network:      varchar("network", { length: 32 }).notNull(),
  currency:     varchar("currency", { length: 16 }).notNull(),
  fromAddress:  varchar("fromAddress", { length: 128 }),
  toAddress:    varchar("toAddress", { length: 128 }),
  amountUnits:  varchar("amountUnits", { length: 64 }).notNull(),
  status:       stablecoinStatusEnum("status").notNull().default("pending"),
  blockNumber:  bigint("blockNumber", { mode: "number" }),
  gasUsed:      varchar("gasUsed", { length: 64 }),
  sandbox:      boolean("sandbox").default(false),
  metadata:     jsonb("metadata"),
  confirmedAt:  timestamp("confirmedAt"),
  initiatedBy:  integer("initiatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sc_txref_idx:  index("sc_txref_idx").on(t.txRef),
  sc_txhash_idx: index("sc_txhash_idx").on(t.txHash),
  sc_tenant_idx: index("sc_tenant_idx").on(t.tenantId),
  sc_status_idx: index("sc_status_idx").on(t.status),
}));
export type StablecoinTransaction = typeof stablecoinTransactions.$inferSelect;
export type InsertStablecoinTransaction = typeof stablecoinTransactions.$inferInsert;

// ── sanctions_lists ───────────────────────────────────────────────────────────
export const sanctionsListTypeEnum = pgEnum("sanctions_list_type", [
  "un_sc", "ofac_sdn", "eu_consolidated", "uk_hmt", "cbn_watchlist",
  "nfiu_watchlist", "interpol_red", "custom",
]);
export const sanctionsLists = pgTable("sanctions_lists", {
  id:          serial("id").primaryKey(),
  listType:    sanctionsListTypeEnum("listType").notNull(),
  listName:    varchar("listName", { length: 128 }).notNull(),
  source:      varchar("source", { length: 255 }),
  version:     varchar("version", { length: 32 }),
  entryCount:  integer("entryCount").default(0),
  isActive:    boolean("isActive").default(true),
  lastSyncAt:  timestamp("lastSyncAt"),
  nextSyncAt:  timestamp("nextSyncAt"),
  metadata:    jsonb("metadata"),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
  updatedAt:   timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sl_type_idx:  index("sl_type_idx").on(t.listType),
  sl_active_idx: index("sl_active_idx").on(t.isActive),
}));
export type SanctionsList = typeof sanctionsLists.$inferSelect;
export type InsertSanctionsList = typeof sanctionsLists.$inferInsert;

// ── sanctions_matches ─────────────────────────────────────────────────────────
export const sanctionsMatchStatusEnum = pgEnum("sanctions_match_status", [
  "pending_review", "confirmed_hit", "false_positive", "escalated",
]);
export const sanctionsMatches = pgTable("sanctions_matches", {
  id:            serial("id").primaryKey(),
  tenantId:      integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  listId:        integer("listId").references(() => sanctionsLists.id, { onDelete: "set null" }),
  subjectRef:    varchar("subjectRef", { length: 128 }).notNull(),
  subjectName:   varchar("subjectName", { length: 255 }),
  matchedName:   varchar("matchedName", { length: 255 }),
  matchScore:    real("matchScore"),
  matchType:     varchar("matchType", { length: 32 }),
  status:        sanctionsMatchStatusEnum("status").notNull().default("pending_review"),
  reviewedBy:    integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:    timestamp("reviewedAt"),
  reviewNotes:   text("reviewNotes"),
  linkedAlertId: integer("linkedAlertId"),
  metadata:      jsonb("metadata"),
  detectedAt:    timestamp("detectedAt").defaultNow().notNull(),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  sm_subject_idx: index("sm_subject_idx").on(t.subjectRef),
  sm_tenant_idx:  index("sm_tenant_idx").on(t.tenantId),
  sm_status_idx:  index("sm_status_idx").on(t.status),
  sm_score_idx:   index("sm_score_idx").on(t.matchScore),
  sm_score_check: check("sm_score_check", sql`"matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 100)`),
}));
export type SanctionsMatch = typeof sanctionsMatches.$inferSelect;
export type InsertSanctionsMatch = typeof sanctionsMatches.$inferInsert;

// ── document_vault ────────────────────────────────────────────────────────────
export const documentVaultStatusEnum = pgEnum("document_vault_status", [
  "pending", "verified", "rejected", "expired",
]);
export const documentVault = pgTable("document_vault", {
  id:            serial("id").primaryKey(),
  tenantId:      integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  ownerId:       integer("ownerId").references(() => users.id, { onDelete: "set null" }),
  ownerRef:      varchar("ownerRef", { length: 128 }),
  documentType:  varchar("documentType", { length: 64 }).notNull(),
  documentName:  varchar("documentName", { length: 255 }).notNull(),
  storageKey:    varchar("storageKey", { length: 512 }).notNull(),
  mimeType:      varchar("mimeType", { length: 128 }),
  sizeBytes:     bigint("sizeBytes", { mode: "number" }),
  checksum:      varchar("checksum", { length: 128 }),
  status:        documentVaultStatusEnum("status").notNull().default("pending"),
  expiresAt:     timestamp("expiresAt"),
  verifiedBy:    integer("verifiedBy").references(() => users.id, { onDelete: "set null" }),
  verifiedAt:    timestamp("verifiedAt"),
  tags:          jsonb("tags"),
  metadata:      jsonb("metadata"),
  deletedAt:     timestamp("deletedAt"),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  dv_owner_idx:  index("dv_owner_idx").on(t.ownerId),
  dv_ref_idx:    index("dv_ref_idx").on(t.ownerRef),
  dv_tenant_idx: index("dv_tenant_idx").on(t.tenantId),
  dv_type_idx:   index("dv_type_idx").on(t.documentType),
  dv_deleted_idx: index("dv_deleted_idx").on(t.deletedAt),
}));
export type DocumentVault = typeof documentVault.$inferSelect;
export type InsertDocumentVault = typeof documentVault.$inferInsert;

// ── field_visit_schedules ─────────────────────────────────────────────────────
export const fieldVisitScheduleStatusEnum = pgEnum("field_visit_schedule_status", [
  "scheduled", "confirmed", "in_progress", "completed", "cancelled", "rescheduled",
]);
export const fieldVisitSchedules = pgTable("field_visit_schedules", {
  id:              serial("id").primaryKey(),
  tenantId:        integer("tenantId").references(() => tenants.id, { onDelete: "cascade" }),
  investigationId: integer("investigationId").references(() => investigations.id, { onDelete: "set null" }),
  caseId:          integer("caseId").references(() => cases.id, { onDelete: "set null" }),
  agentId:         integer("agentId").references(() => fieldAgents.id, { onDelete: "set null" }),
  subjectName:     varchar("subjectName", { length: 255 }),
  subjectAddress:  text("subjectAddress"),
  visitType:       varchar("visitType", { length: 64 }).notNull().default("residential"),
  status:          fieldVisitScheduleStatusEnum("status").notNull().default("scheduled"),
  scheduledAt:     timestamp("scheduledAt").notNull(),
  confirmedAt:     timestamp("confirmedAt"),
  completedAt:     timestamp("completedAt"),
  cancelledAt:     timestamp("cancelledAt"),
  cancellationReason: text("cancellationReason"),
  notes:           text("notes"),
  coordinates:     jsonb("coordinates"),
  metadata:        jsonb("metadata"),
  createdBy:       integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  fvs_agent_idx:  index("fvs_agent_idx").on(t.agentId),
  fvs_inv_idx:    index("fvs_inv_idx").on(t.investigationId),
  fvs_sched_idx:  index("fvs_sched_idx").on(t.scheduledAt),
  fvs_status_idx: index("fvs_status_idx").on(t.status),
}));
export type FieldVisitSchedule = typeof fieldVisitSchedules.$inferSelect;
export type InsertFieldVisitSchedule = typeof fieldVisitSchedules.$inferInsert;

// ── ml_model_versions ─────────────────────────────────────────────────────────
export const mlModelStatusEnum = pgEnum("ml_model_status", [
  "training", "staging", "production", "deprecated", "failed",
]);
export const mlModelVersions = pgTable("ml_model_versions", {
  id:            serial("id").primaryKey(),
  modelName:     varchar("modelName", { length: 128 }).notNull(),
  version:       varchar("version", { length: 32 }).notNull(),
  modelType:     varchar("modelType", { length: 64 }).notNull(),
  status:        mlModelStatusEnum("status").notNull().default("staging"),
  artifactPath:  varchar("artifactPath", { length: 512 }),
  metrics:       jsonb("metrics"),
  hyperparams:   jsonb("hyperparams"),
  trainedOn:     timestamp("trainedOn"),
  promotedAt:    timestamp("promotedAt"),
  deprecatedAt:  timestamp("deprecatedAt"),
  promotedBy:    integer("promotedBy").references(() => users.id, { onDelete: "set null" }),
  description:   text("description"),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  mlm_name_idx:    index("mlm_name_idx").on(t.modelName),
  mlm_status_idx:  index("mlm_status_idx").on(t.status),
  mlm_version_uniq: uniqueIndex("mlm_version_uniq").on(t.modelName, t.version),
}));
export type MlModelVersion = typeof mlModelVersions.$inferSelect;
export type InsertMlModelVersion = typeof mlModelVersions.$inferInsert;

// ── tenant_billing_accounts ───────────────────────────────────────────────────
export const tenantBillingAccounts = pgTable("tenant_billing_accounts", {
  id:                  serial("id").primaryKey(),
  tenantId:            integer("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  tigerbeetleAccountId: varchar("tigerbeetleAccountId", { length: 64 }),
  currency:            varchar("currency", { length: 3 }).notNull().default("NGN"),
  balanceKobo:         bigint("balanceKobo", { mode: "number" }).notNull().default(0),
  creditLimitKobo:     bigint("creditLimitKobo", { mode: "number" }).default(0),
  billingEmail:        varchar("billingEmail", { length: 255 }),
  billingCycle:        varchar("billingCycle", { length: 16 }).notNull().default("monthly"),
  nextBillingAt:       timestamp("nextBillingAt"),
  lastBilledAt:        timestamp("lastBilledAt"),
  metadata:            jsonb("metadata"),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  tba_tenant_idx:  index("tba_tenant_idx").on(t.tenantId),
  tba_balance_check: check("tba_balance_check", sql`"balanceKobo" >= 0`),
}));
export type TenantBillingAccount = typeof tenantBillingAccounts.$inferSelect;
export type InsertTenantBillingAccount = typeof tenantBillingAccounts.$inferInsert;

// ── payment_rails_log ─────────────────────────────────────────────────────────
export const paymentRailsLog = pgTable("payment_rails_log", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenantId").references(() => tenants.id, { onDelete: "set null" }),
  txRef:        varchar("txRef", { length: 128 }).notNull(),
  rail:         varchar("rail", { length: 32 }).notNull(),
  direction:    varchar("direction", { length: 8 }).notNull().default("outbound"),
  amountKobo:   bigint("amountKobo", { mode: "number" }),
  currency:     varchar("currency", { length: 3 }).default("NGN"),
  status:       varchar("status", { length: 32 }).notNull(),
  requestBody:  jsonb("requestBody"),
  responseBody: jsonb("responseBody"),
  errorMessage: text("errorMessage"),
  latencyMs:    integer("latencyMs"),
  initiatedBy:  integer("initiatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  prl_txref_idx:  index("prl_txref_idx").on(t.txRef),
  prl_tenant_idx: index("prl_tenant_idx").on(t.tenantId),
  prl_rail_idx:   index("prl_rail_idx").on(t.rail),
  prl_time_idx:   index("prl_time_idx").on(t.createdAt),
}));
export type PaymentRailsLog = typeof paymentRailsLog.$inferSelect;
export type InsertPaymentRailsLog = typeof paymentRailsLog.$inferInsert;

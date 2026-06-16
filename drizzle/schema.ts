import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  real,
  boolean,
  json,
  serial,
  index,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "analyst", "supervisor", "auditor", "readonly"]);
export const subjectTypeEnum = pgEnum("subject_type", ["individual", "corporate"]);
export const tierEnum = pgEnum("tier", ["basic", "standard", "comprehensive"]);
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const investigationStatusEnum = pgEnum("investigation_status", ["draft", "pending", "processing", "completed", "flagged", "archived"]);
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
  dataSources: json("dataSources"),
  gatewayResults: json("gatewayResults"),
  riskFactors: json("riskFactors"),
  dueAt: timestamp("dueAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  }));

export type Investigation = typeof investigations.$inferSelect;
export type InsertInvestigation = typeof investigations.$inferInsert;

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
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
  investigationId: integer("investigationId"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  dob: varchar("dob", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  status: kycStatusEnum("status").notNull().default("pending"),
  riskScore: real("riskScore"),
  ninResult: json("ninResult"),
  bvnResult: json("bvnResult"),
  sanctionsResult: json("sanctionsResult"),
  pepResult: json("pepResult"),
  creditResult: json("creditResult"),
  subjectRef: varchar("subjectRef", { length: 64 }),
  onboardingApplicationId: integer("onboardingApplicationId"),
  biometricStatus: varchar("biometricStatus", { length: 32 }).default("not_enrolled"),
  biometricFaceId: varchar("biometricFaceId", { length: 128 }),
  documentOcrData: json("documentOcrData"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  }));
export type KycRecord = typeof kycRecords.$inferSelect;
export type InsertKycRecord = typeof kycRecords.$inferInsert;

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  category: auditCategoryEnum("category").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  targetRef: varchar("targetRef", { length: 64 }),
  result: auditResultEnum("result").notNull().default("success"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  detail: json("detail"),
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
  result: json("result"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  sections: json("sections"),
  generatedBy: integer("generatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const screeningTypeEnum = pgEnum("screening_type", ["mvr", "drug", "work_authorization", "biometric", "zero_footprint"]);
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
  specializations: json("specializations").$type<string[]>().default([]),
  tasksCompleted: integer("tasksCompleted").notNull().default(0),
  tasksActive: integer("tasksActive").notNull().default(0),
  rating: real("rating").default(0),
  gpsLat: real("gpsLat"),
  gpsLng: real("gpsLng"),
  lastSeen: timestamp("lastSeen"),
  notes: text("notes"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  config: json("config"),
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
  config: json("config"),
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
  requestData: json("requestData"),
  result: json("result"),
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
  permissions: json("permissions").$type<string[]>().default([]),
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
  events: json("events").$type<string[]>().default([]),
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
  value: json("value"),
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
  stakeholders: json("stakeholders").$type<any[]>().default([]),
  documentUrls: json("documentUrls").$type<{ name: string; url: string; key: string; uploadedAt: string }[]>().default([]),
  createdBy: varchar("createdBy", { length: 255 }),
  adminNotes: text("adminNotes"),
  reviewerLog: json("reviewerLog").$type<Array<{ authorId: number; authorName: string; note: string; createdAt: string }>>().default([]),
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
  scopes: json("scopes").$type<string[]>().notNull().default([]),
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
  investigationRefs: json("investigationRefs").$type<string[]>().default([]),
  tags: json("tags").$type<string[]>().default([]),
  dueAt: timestamp("dueAt"),
  closedAt: timestamp("closedAt"),
  closureReason: text("closureReason"),
  riskScore: integer("riskScore"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
},
  (table) => ({
    cases_status_idx: index("cases_status_idx").on(table.status),
    cases_created_at_idx: index("cases_created_at_idx").on(table.createdAt),
    cases_lead_analyst_id_idx: index("cases_lead_analyst_id_idx").on(table.leadAnalystId),
    cases_priority_idx: index("cases_priority_idx").on(table.priority),
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
  detail: json("detail"),
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
  useCase: json("useCase").$type<string[]>().default([]),
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
  documents: json("documents").$type<string[]>().default([]),
  status: lexSubmissionStatusEnum("status").notNull().default("pending"),
  validationScore: integer("validationScore"),
  validationNotes: json("validationNotes"),
  reviewedBy: integer("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  linkedCaseId: integer("linkedCaseId").references(() => cases.id),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  backupCodes: json("backupCodes").$type<string[]>().default([]),
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
  filters: json("filters"),
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
  amlFlags: json("amlFlags"),
  flaggedAt: timestamp("flaggedAt"),
  flaggedBy: integer("flaggedBy").references(() => users.id),
  investigationId: integer("investigationId").references(() => investigations.id),
  goamlFilingId: integer("goamlFilingId").references(() => goamlFilings.id),
  valueDate: timestamp("valueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  parsedFields: json("parsedFields"),
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
  relatedTransactions: json("relatedTransactions"),
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
  documents: json("documents"),
  amendments: json("amendments"),
  discrepancies: json("discrepancies"),
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
  services: json("services"),
  currencies: json("currencies"),
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
  chainOfCustody: json("chainOfCustody"),
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
  metadata: json("metadata"),
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
  selectedSources: json("selectedSources").$type<string[]>().notNull(),
  results: json("results").$type<Record<string, unknown>[]>().notNull(),
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

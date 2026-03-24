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
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "analyst", "supervisor"]);
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
});

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
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

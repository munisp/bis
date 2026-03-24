import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "analyst", "supervisor"]).default("analyst").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Investigations ───────────────────────────────────────────────────────────

export const investigations = mysqlTable("investigations", {
  id: int("id").autoincrement().primaryKey(),
  ref: varchar("ref", { length: 32 }).notNull().unique(),
  subjectType: mysqlEnum("subjectType", ["individual", "corporate"]).notNull(),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  country: varchar("country", { length: 3 }).notNull().default("NG"),
  tier: mysqlEnum("tier", ["basic", "standard", "comprehensive"]).notNull().default("standard"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).notNull().default("medium"),
  status: mysqlEnum("status", ["draft", "pending", "processing", "completed", "flagged", "archived"]).notNull().default("pending"),
  riskScore: float("riskScore"),
  riskTier: mysqlEnum("riskTier", ["low", "medium", "high", "critical"]),
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  rcNumber: varchar("rcNumber", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  purpose: text("purpose"),
  assignedTo: int("assignedTo"),
  createdBy: int("createdBy").notNull(),
  dataSources: json("dataSources"),
  gatewayResults: json("gatewayResults"),
  riskFactors: json("riskFactors"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type Investigation = typeof investigations.$inferSelect;
export type InsertInvestigation = typeof investigations.$inferInsert;

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  investigationId: int("investigationId"),
  type: mysqlEnum("type", ["sanctions_hit", "pep_detected", "risk_threshold", "velocity", "adverse_media", "field_report", "system"]).notNull(),
  severity: mysqlEnum("severity", ["info", "low", "medium", "high", "critical"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  subjectRef: varchar("subjectRef", { length: 64 }),
  sourceService: varchar("sourceService", { length: 64 }),
  read: boolean("read").notNull().default(false),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedBy: int("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ─── KYC Records ─────────────────────────────────────────────────────────────

export const kycRecords = mysqlTable("kyc_records", {
  id: int("id").autoincrement().primaryKey(),
  investigationId: int("investigationId"),
  subjectName: varchar("subjectName", { length: 255 }).notNull(),
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  dob: varchar("dob", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  status: mysqlEnum("status", ["pending", "processing", "passed", "failed", "review"]).notNull().default("pending"),
  riskScore: float("riskScore"),
  ninResult: json("ninResult"),
  bvnResult: json("bvnResult"),
  sanctionsResult: json("sanctionsResult"),
  pepResult: json("pepResult"),
  creditResult: json("creditResult"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KycRecord = typeof kycRecords.$inferSelect;
export type InsertKycRecord = typeof kycRecords.$inferInsert;

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  category: mysqlEnum("category", ["investigation", "kyc", "alert", "report", "user", "system", "api"]).notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  targetRef: varchar("targetRef", { length: 64 }),
  result: mysqlEnum("result", ["success", "warning", "failure"]).notNull().default("success"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  detail: json("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

// ─── Field Tasks ──────────────────────────────────────────────────────────────

export const fieldTasks = mysqlTable("field_tasks", {
  id: int("id").autoincrement().primaryKey(),
  taskRef: varchar("taskRef", { length: 32 }).notNull().unique(),
  investigationId: int("investigationId"),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  taskType: mysqlEnum("taskType", ["address_verification", "biometric_capture", "document_collection", "surveillance", "interview"]).notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).notNull().default("medium"),
  status: mysqlEnum("status", ["pending", "dispatched", "in_progress", "completed", "failed", "cancelled"]).notNull().default("pending"),
  subjectName: varchar("subjectName", { length: 255 }),
  address: text("address"),
  state: varchar("state", { length: 64 }),
  lga: varchar("lga", { length: 64 }),
  gpsLat: float("gpsLat"),
  gpsLng: float("gpsLng"),
  deadline: timestamp("deadline"),
  instructions: text("instructions"),
  result: json("result"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type FieldTask = typeof fieldTasks.$inferSelect;
export type InsertFieldTask = typeof fieldTasks.$inferInsert;

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  reportRef: varchar("reportRef", { length: 32 }).notNull().unique(),
  investigationId: int("investigationId"),
  template: varchar("template", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  format: mysqlEnum("format", ["pdf", "docx", "csv", "json"]).notNull().default("pdf"),
  status: mysqlEnum("status", ["generating", "ready", "failed"]).notNull().default("generating"),
  fileUrl: text("fileUrl"),
  sections: json("sections"),
  generatedBy: int("generatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

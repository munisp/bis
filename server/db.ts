import { eq, desc, and, gte, lte, ilike, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  InsertUser, users,
  InsertInvestigation, investigations,
  InsertAlert, alerts,
  InsertKycRecord, kycRecords,
  InsertAuditLog, auditLog,
  InsertFieldTask, fieldTasks,
  InsertReport, reports,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values)
      .onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Investigations ───────────────────────────────────────────────────────────

export async function createInvestigation(data: InsertInvestigation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(investigations).values(data).returning();
  return row;
}

export async function getInvestigations(filters?: {
  status?: string; tier?: string; country?: string;
  minRisk?: number; maxRisk?: number; search?: string;
  limit?: number; offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(investigations).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(investigations.status, filters.status as any));
  if (filters?.tier) conditions.push(eq(investigations.tier, filters.tier as any));
  if (filters?.country) conditions.push(eq(investigations.country, filters.country));
  if (filters?.minRisk != null) conditions.push(gte(investigations.riskScore, filters.minRisk));
  if (filters?.maxRisk != null) conditions.push(lte(investigations.riskScore, filters.maxRisk));
  if (filters?.search) {
    conditions.push(or(
      ilike(investigations.subjectName, `%${filters.search}%`),
      ilike(investigations.ref, `%${filters.search}%`),
    )!);
  }
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(investigations.updatedAt));
  if (filters?.limit) q = q.limit(filters.limit);
  if (filters?.offset) q = q.offset(filters.offset);
  return q;
}

export async function getInvestigationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(investigations).where(eq(investigations.id, id)).limit(1);
  return row;
}

export async function updateInvestigation(id: number, data: Partial<InsertInvestigation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(investigations).set({ ...data, updatedAt: new Date() }).where(eq(investigations.id, id)).returning();
  return row;
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function createAlert(data: InsertAlert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(alerts).values(data).returning();
  return row;
}

export async function getAlerts(filters?: { severity?: string; read?: boolean; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(alerts).$dynamic();
  const conditions = [];
  if (filters?.severity) conditions.push(eq(alerts.severity, filters.severity as any));
  if (filters?.read != null) conditions.push(eq(alerts.read, filters.read));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(alerts.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  return q;
}

export async function markAlertRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(alerts).set({ read: true }).where(eq(alerts.id, id)).returning();
  return row;
}

// ─── KYC Records ─────────────────────────────────────────────────────────────

export async function createKycRecord(data: InsertKycRecord) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(kycRecords).values(data).returning();
  return row;
}

export async function getKycRecords(filters?: { status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(kycRecords).$dynamic();
  if (filters?.status) q = q.where(eq(kycRecords.status, filters.status as any));
  q = q.orderBy(desc(kycRecords.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  return q;
}

export async function updateKycRecord(id: number, data: Partial<InsertKycRecord>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(kycRecords).set({ ...data, updatedAt: new Date() }).where(eq(kycRecords.id, id)).returning();
  return row;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export async function appendAuditLog(data: InsertAuditLog) {
  const db = await getDb();
  if (!db) { console.warn("[Audit] DB unavailable, skipping audit log"); return; }
  const [row] = await db.insert(auditLog).values(data).returning();
  return row;
}

export async function getAuditLog(filters?: { category?: string; result?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(auditLog).$dynamic();
  const conditions = [];
  if (filters?.category) conditions.push(eq(auditLog.category, filters.category as any));
  if (filters?.result) conditions.push(eq(auditLog.result, filters.result as any));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(auditLog.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  if (filters?.offset) q = q.offset(filters.offset);
  return q;
}

// ─── Field Tasks ──────────────────────────────────────────────────────────────

export async function createFieldTask(data: InsertFieldTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(fieldTasks).values(data).returning();
  return row;
}

export async function getFieldTasks(filters?: { status?: string; agentId?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(fieldTasks).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(fieldTasks.status, filters.status as any));
  if (filters?.agentId) conditions.push(eq(fieldTasks.agentId, filters.agentId));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(fieldTasks.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  return q;
}

export async function updateFieldTask(id: number, data: Partial<InsertFieldTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(fieldTasks).set({ ...data, updatedAt: new Date() }).where(eq(fieldTasks.id, id)).returning();
  return row;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function createReport(data: InsertReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(reports).values(data).returning();
  return row;
}

export async function getReports(filters?: { status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(reports).$dynamic();
  if (filters?.status) q = q.where(eq(reports.status, filters.status as any));
  q = q.orderBy(desc(reports.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  return q;
}

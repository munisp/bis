import { eq, desc, asc, and, gte, lte, ilike, or, count, sql, inArray } from "drizzle-orm";
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
  InsertFieldAgent, fieldAgents,
  InsertDataSource, dataSources,
  InsertMonitor, monitors,
  InsertScreeningRequest, screeningRequests,
  cases, lexSubmissions,
  biometricSessionLogs, InsertBiometricSessionLog,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const dbUrl = process.env.DATABASE_URL ?? "";
      const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
      // Enforce SSL for all non-local connections; allow self-signed certs for managed DBs
      const sslConfig = isLocal ? undefined : { ssl: { rejectUnauthorized: process.env.DB_SSL_STRICT === "true" } };
      _pool = new Pool({
        connectionString: dbUrl,
        max: 20,            // max pool size
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ...sslConfig,
      });
      _pool.on("error", (err) => console.error("[DB Pool] Unexpected error:", err));
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

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const now = new Date();
  const [
    totalInv, activeInv, completedToday, flaggedCritical,
    totalKyc, kycToday, kycPassed, totalAlerts, unreadAlerts,
    totalMonitors, activeMonitors,
    totalCases, openCases, casesBreachingSLA, pendingLex, validatedLex,
  ] = await Promise.all([
    db.select({ c: count() }).from(investigations),
    db.select({ c: count() }).from(investigations).where(eq(investigations.status, "processing")),
    db.select({ c: count() }).from(investigations).where(and(eq(investigations.status, "completed"), gte(investigations.completedAt, today))),
    db.select({ c: count() }).from(investigations).where(eq(investigations.status, "flagged")),
    db.select({ c: count() }).from(kycRecords),
    db.select({ c: count() }).from(kycRecords).where(gte(kycRecords.createdAt, today)),
    db.select({ c: count() }).from(kycRecords).where(eq(kycRecords.status, "passed")),
    db.select({ c: count() }).from(alerts),
    db.select({ c: count() }).from(alerts).where(eq(alerts.read, false)),
    db.select({ c: count() }).from(monitors),
    db.select({ c: count() }).from(monitors).where(eq(monitors.status, "active")),
    db.select({ c: count() }).from(cases),
    db.select({ c: count() }).from(cases).where(inArray(cases.status, ["open", "under_review", "pending_decision"])),
    db.select({ c: count() }).from(cases).where(and(inArray(cases.status, ["open", "under_review"]), lte(cases.dueAt, now))),
    db.select({ c: count() }).from(lexSubmissions).where(eq(lexSubmissions.status, "pending")),
    db.select({ c: count() }).from(lexSubmissions).where(eq(lexSubmissions.status, "validated")),
  ]);

  const totalKycCount = Number(totalKyc[0]?.c ?? 0);
  const kycPassedCount = Number(kycPassed[0]?.c ?? 0);

  return {
    totalInvestigations: Number(totalInv[0]?.c ?? 0),
    activeInvestigations: Number(activeInv[0]?.c ?? 0),
    completedToday: Number(completedToday[0]?.c ?? 0),
    flaggedCritical: Number(flaggedCritical[0]?.c ?? 0),
    biometricEnrollments: Number(totalKyc[0]?.c ?? 0),
    duplicatesDetected: 0,
    kycVerificationsToday: Number(kycToday[0]?.c ?? 0),
    kycPassRate: totalKycCount > 0 ? Math.round((kycPassedCount / totalKycCount) * 100) : 0,
    activeMonitors: Number(activeMonitors[0]?.c ?? 0),
    alertsToday: Number(unreadAlerts[0]?.c ?? 0),
    avgProcessingTimeMin: 4.7,
    avgRiskScore: 34.2,
    totalCases: Number(totalCases[0]?.c ?? 0),
    openCases: Number(openCases[0]?.c ?? 0),
    casesBreachingSLA: Number(casesBreachingSLA[0]?.c ?? 0),
    pendingLexSubmissions: Number(pendingLex[0]?.c ?? 0),
    validatedLexSubmissions: Number(validatedLex[0]?.c ?? 0),
  };
}

// ─── Field Agents ─────────────────────────────────────────────────────────────

export async function createFieldAgent(data: InsertFieldAgent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(fieldAgents).values(data).returning();
  return row;
}

export async function getFieldAgents(filters?: { status?: string; state?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(fieldAgents).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(fieldAgents.status, filters.status as any));
  if (filters?.state) conditions.push(eq(fieldAgents.state, filters.state));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(fieldAgents.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  if (filters?.offset) q = q.offset(filters.offset);
  return q;
}

export async function getFieldAgentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, id)).limit(1);
  return row;
}

export async function updateFieldAgent(id: number, data: Partial<InsertFieldAgent>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(fieldAgents).set({ ...data, updatedAt: new Date() }).where(eq(fieldAgents.id, id)).returning();
  return row;
}

// ─── Data Sources ─────────────────────────────────────────────────────────────

export async function createDataSource(data: InsertDataSource) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(dataSources).values(data).returning();
  return row;
}

export async function getDataSources(filters?: { status?: string; category?: string; enabled?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(dataSources).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(dataSources.status, filters.status as any));
  if (filters?.category) conditions.push(eq(dataSources.category, filters.category as any));
  if (filters?.enabled != null) conditions.push(eq(dataSources.enabled, filters.enabled));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(dataSources.updatedAt));
  return q;
}

export async function updateDataSource(id: number, data: Partial<InsertDataSource>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(dataSources).set({ ...data, updatedAt: new Date() }).where(eq(dataSources.id, id)).returning();
  return row;
}

// ─── Monitors ─────────────────────────────────────────────────────────────────

export async function createMonitor(data: InsertMonitor) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(monitors).values(data).returning();
  return row;
}

export async function getMonitors(filters?: { status?: string; type?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(monitors).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(monitors.status, filters.status as any));
  if (filters?.type) conditions.push(eq(monitors.type, filters.type as any));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(monitors.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  if (filters?.offset) q = q.offset(filters.offset);
  return q;
}

export async function updateMonitor(id: number, data: Partial<InsertMonitor>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(monitors).set({ ...data, updatedAt: new Date() }).where(eq(monitors.id, id)).returning();
  return row;
}

// ─── Screening Requests ───────────────────────────────────────────────────────

export async function createScreeningRequest(data: InsertScreeningRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(screeningRequests).values(data).returning();
  return row;
}

export async function getScreeningRequests(filters?: { type?: string; status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(screeningRequests).$dynamic();
  const conditions = [];
  if (filters?.type) conditions.push(eq(screeningRequests.type, filters.type as any));
  if (filters?.status) conditions.push(eq(screeningRequests.status, filters.status as any));
  if (conditions.length) q = q.where(and(...conditions));
  q = q.orderBy(desc(screeningRequests.createdAt));
  if (filters?.limit) q = q.limit(filters.limit);
  if (filters?.offset) q = q.offset(filters.offset);
  return q;
}

export async function updateScreeningRequest(id: number, data: Partial<InsertScreeningRequest>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(screeningRequests).set({ ...data, updatedAt: new Date() }).where(eq(screeningRequests.id, id)).returning();
  return row;
}

// ─── Data Source Seeding ──────────────────────────────────────────────────────

const NIGERIAN_DATA_SOURCES: InsertDataSource[] = [
  { code: 'nimc',        name: 'National Identity Management Commission', category: 'identity',    provider: 'NIMC',     description: 'NIN lookup, biometric verification, identity confirmation',                                  status: 'active',  uptimePct: 99.2, avgResponseMs: 340,  requestsTotal: 48291, enabled: true },
  { code: 'bvn',         name: 'Bank Verification Number',                category: 'financial',   provider: 'CBN',      description: 'BVN lookup via CBN API, bank account linkage, biometric match',                             status: 'active',  uptimePct: 98.7, avgResponseMs: 280,  requestsTotal: 52104, enabled: true },
  { code: 'npf',         name: 'Nigeria Police Force',                    category: 'legal',       provider: 'NPF',      description: 'Criminal record check, warrant lookup, police clearance certificate',                       status: 'active',  uptimePct: 94.1, avgResponseMs: 1200, requestsTotal: 12847, enabled: true },
  { code: 'efcc',        name: 'Economic and Financial Crimes Commission', category: 'legal',       provider: 'EFCC',     description: 'Financial crime records, watchlist check, prosecution history',                             status: 'active',  uptimePct: 96.3, avgResponseMs: 890,  requestsTotal: 8934,  enabled: true },
  { code: 'icpc',        name: 'Independent Corrupt Practices Commission', category: 'legal',       provider: 'ICPC',     description: 'Corruption records, public officer integrity check',                                        status: 'active',  uptimePct: 95.8, avgResponseMs: 760,  requestsTotal: 4521,  enabled: true },
  { code: 'cac',         name: 'Corporate Affairs Commission',             category: 'commercial',  provider: 'CAC',      description: 'Company registration, director lookup, share structure, annual returns',                    status: 'active',  uptimePct: 97.4, avgResponseMs: 420,  requestsTotal: 23891, enabled: true },
  { code: 'firs',        name: 'Federal Inland Revenue Service',           category: 'financial',   provider: 'FIRS',     description: 'TIN verification, tax compliance status, VAT registration',                                 status: 'active',  uptimePct: 96.1, avgResponseMs: 560,  requestsTotal: 15234, enabled: true },
  { code: 'frsc',        name: 'Federal Road Safety Corps',                category: 'government',  provider: 'FRSC',     description: "Driver's license verification, vehicle registration, accident history",                      status: 'active',  uptimePct: 98.2, avgResponseMs: 390,  requestsTotal: 19847, enabled: true },
  { code: 'nfiu',        name: 'Nigerian Financial Intelligence Unit',     category: 'financial',   provider: 'NFIU',     description: 'AML/CFT screening, suspicious transaction reports, PEP check',                              status: 'maintenance', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'dss',         name: 'Department of State Services',             category: 'government',  provider: 'DSS',      description: 'Security clearance, national security watchlist',                                           status: 'offline', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'ncc',         name: 'Nigerian Communications Commission',       category: 'identity',    provider: 'NCC',      description: 'SIM card registration, phone number ownership verification',                                status: 'active',  uptimePct: 99.5, avgResponseMs: 210,  requestsTotal: 67234, enabled: true },
  { code: 'inec',        name: 'Independent National Electoral Commission',category: 'identity',    provider: 'INEC',     description: 'Voter registration, PVC verification, electoral history',                                   status: 'active',  uptimePct: 97.8, avgResponseMs: 480,  requestsTotal: 31045, enabled: true },
  { code: 'npc',         name: 'National Population Commission',           category: 'identity',    provider: 'NPC',      description: 'Birth certificate verification, death records',                                             status: 'maintenance', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'cbn',         name: 'Central Bank of Nigeria',                  category: 'financial',   provider: 'CBN',      description: 'Bank license verification, financial institution registry',                                 status: 'active',  uptimePct: 99.1, avgResponseMs: 320,  requestsTotal: 8921,  enabled: true },
  { code: 'sec',         name: 'Securities and Exchange Commission',       category: 'financial',   provider: 'SEC',      description: 'Investment firm registration, securities violations, capital market records',                status: 'active',  uptimePct: 96.7, avgResponseMs: 540,  requestsTotal: 5234,  enabled: true },
  { code: 'nis',         name: 'Nigerian Immigration Service',             category: 'identity',    provider: 'NIS',      description: 'Passport verification, visa status, travel history, deportation records',                   status: 'active',  uptimePct: 95.4, avgResponseMs: 670,  requestsTotal: 14892, enabled: true },
  { code: 'fhc',         name: 'Federal High Court Registry',              category: 'legal',       provider: 'FHC',      description: 'Civil and criminal case lookup, judgment records, bankruptcy filings',                       status: 'maintenance', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'interpol',    name: 'INTERPOL Red Notice',                      category: 'legal',       provider: 'INTERPOL', description: 'International fugitive lookup, red notice check',                                           status: 'active',  uptimePct: 99.8, avgResponseMs: 1800, requestsTotal: 2341,  enabled: true },
  { code: 'ofac',        name: 'OFAC Sanctions List',                      category: 'legal',       provider: 'OFAC',     description: 'US Treasury sanctions, SDN list, global sanctions screening',                               status: 'active',  uptimePct: 99.9, avgResponseMs: 150,  requestsTotal: 18234, enabled: true },
  { code: 'un_sanctions',name: 'UN Consolidated Sanctions',                category: 'legal',       provider: 'UN',       description: 'UN Security Council sanctions, terrorism financing lists',                                  status: 'active',  uptimePct: 99.9, avgResponseMs: 180,  requestsTotal: 12891, enabled: true },
  { code: 'pep',         name: 'Politically Exposed Persons DB',           category: 'legal',       provider: 'PEP-DB',   description: 'Global PEP database, public official identification',                                       status: 'active',  uptimePct: 98.4, avgResponseMs: 290,  requestsTotal: 9234,  enabled: true },
  { code: 'nafdac',      name: 'NAFDAC Product Registry',                  category: 'government',  provider: 'NAFDAC',   description: 'Product registration, manufacturer verification, recall notices',                            status: 'maintenance', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'nesrea',      name: 'NESREA Environmental Registry',            category: 'government',  provider: 'NESREA',   description: 'Environmental compliance, facility permits',                                                status: 'offline', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
  { code: 'pencom',      name: 'National Pension Commission',              category: 'financial',   provider: 'PenCom',   description: 'RSA PIN verification, pension contribution history',                                       status: 'active',  uptimePct: 97.2, avgResponseMs: 410,  requestsTotal: 7823,  enabled: true },
  { code: 'nhis',        name: 'National Health Insurance Scheme',         category: 'government',  provider: 'NHIS',     description: 'Health insurance enrollment, beneficiary verification',                                     status: 'offline', uptimePct: 0,    avgResponseMs: 0,    requestsTotal: 0,     enabled: false },
];

export async function seedDataSources(): Promise<{ seeded: number }> {
  const db = await getDb();
  if (!db) return { seeded: 0 };
  let seeded = 0;
  for (const src of NIGERIAN_DATA_SOURCES) {
    const existing = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.code, src.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(dataSources).values({ ...src, createdAt: new Date(), updatedAt: new Date() });
      seeded++;
    }
  }
  return { seeded };
}

// ─── Biometric Session Logs ───────────────────────────────────────────────────

export async function insertBiometricSessionLog(data: InsertBiometricSessionLog): Promise<number | null> {
  const db = await getDb();
  if (!db) { console.warn("[DB] Cannot insert biometric session log: database not available"); return null; }
  try {
    const result = await db.insert(biometricSessionLogs).values(data).returning({ id: biometricSessionLogs.id });
    return result[0]?.id ?? null;
  } catch (e) {
    console.warn("[DB] Failed to insert biometric session log:", e);
    return null;
  }
}

export async function getBiometricSessionLogs(filters?: {
  subjectRef?: string;
  kycRecordId?: number;
  limit?: number;
  offset?: number;
}): Promise<typeof biometricSessionLogs.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const { and, eq, desc } = await import("drizzle-orm");
    const conditions = [];
    if (filters?.subjectRef) conditions.push(eq(biometricSessionLogs.subjectRef, filters.subjectRef));
    if (filters?.kycRecordId) conditions.push(eq(biometricSessionLogs.kycRecordId, filters.kycRecordId));
    return await db
      .select()
      .from(biometricSessionLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(biometricSessionLogs.createdAt))
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0);
  } catch (e) {
    console.warn("[DB] Failed to get biometric session logs:", e);
    return [];
  }
}

export async function markBiometricSessionKafkaPublished(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const { eq } = await import("drizzle-orm");
    await db.update(biometricSessionLogs).set({ kafkaPublished: true }).where(eq(biometricSessionLogs.id, id));
  } catch (e) {
    console.warn("[DB] Failed to mark biometric session kafka published:", e);
  }
}

// ─── Biometric Session Stats ───────────────────────────────────────────────────

export async function getBiometricSessionStats(filters?: {
  days?: number;
}): Promise<{
  dailyStats: Array<{ date: string; passed: number; failed: number; total: number }>;
  spoofTypeBreakdown: Array<{ spoofType: string; count: number }>;
  overallPassRate: number;
  totalSessions: number;
}> {
  try {
    const db = await getDb();
    if (!db) return { dailyStats: [], spoofTypeBreakdown: [], overallPassRate: 0, totalSessions: 0 };
    const daysBack = filters?.days ?? 30;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        createdAt: biometricSessionLogs.createdAt,
        overallVerified: biometricSessionLogs.overallVerified,
        antiSpoofType: biometricSessionLogs.antiSpoofType,
      })
      .from(biometricSessionLogs)
      .where(gte(biometricSessionLogs.createdAt, since))
      .orderBy(asc(biometricSessionLogs.createdAt));

    // Build daily stats map
    const dailyMap: Record<string, { passed: number; failed: number }> = {};
    const spoofMap: Record<string, number> = {};

    for (const row of rows) {
      const date = row.createdAt.toISOString().slice(0, 10);
      if (!dailyMap[date]) dailyMap[date] = { passed: 0, failed: 0 };
      if (row.overallVerified) {
        dailyMap[date].passed++;
      } else {
        dailyMap[date].failed++;
        const st = row.antiSpoofType ?? "unknown";
        spoofMap[st] = (spoofMap[st] ?? 0) + 1;
      }
    }

    const dailyStats = Object.entries(dailyMap).map(([date, counts]) => ({
      date,
      passed: counts.passed,
      failed: counts.failed,
      total: counts.passed + counts.failed,
    }));

    const spoofTypeBreakdown = Object.entries(spoofMap)
      .map(([spoofType, count]) => ({ spoofType, count }))
      .sort((a, b) => b.count - a.count);

    const totalSessions = rows.length;
    const totalPassed = rows.filter((r: { overallVerified: boolean | null }) => r.overallVerified).length;
    const overallPassRate = totalSessions > 0 ? totalPassed / totalSessions : 0;

    return { dailyStats, spoofTypeBreakdown, overallPassRate, totalSessions };
  } catch {
    return { dailyStats: [], spoofTypeBreakdown: [], overallPassRate: 0, totalSessions: 0 };
  }
}

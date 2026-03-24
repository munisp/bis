import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { billingRouter } from "./billing";
import { tenantsRouter } from "./tenants";
import { permifyWriteRelationship, permifyCheck } from "./permify";
import { systemRouter } from "./_core/systemRouter";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  investigations,
  alerts,
  kycRecords,
  auditLog,
  fieldTasks,
  reports,
  fieldAgents,
  dataSources,
  monitors,
  screeningRequests,
  users,
  platformSettings,
  onboardingApplications,
} from "../drizzle/schema";
import {
  getDashboardStats,
  getFieldAgents, createFieldAgent, updateFieldAgent, getFieldAgentById,
  getDataSources, createDataSource, updateDataSource,
  getMonitors, createMonitor, updateMonitor,
  getScreeningRequests, createScreeningRequest, updateScreeningRequest,
} from "./db";
import { eq, desc, and, ilike, gte, lte, sql, count } from "drizzle-orm";
import { z } from "zod";

// ─── Service URLs ─────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.BIS_GATEWAY_URL || "http://localhost:8081";
const RISK_ENGINE_URL = process.env.BIS_RISK_ENGINE_URL || "http://localhost:8082";
const EVENT_PROCESSOR_URL = process.env.BIS_EVENT_PROCESSOR_URL || "http://localhost:8083";
const KYC_SERVICE_URL = process.env.BIS_KYC_SERVICE_URL || "http://localhost:8084";
const GATEWAY_KEY = process.env.BIS_GATEWAY_KEY || "dev-gateway-key-change-in-prod";

// ─── Service Client Helpers ───────────────────────────────────────────────────

async function gatewayFetch(path: string) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "X-BIS-Key": GATEWAY_KEY },
  });
  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function riskEngineFetch(path: string, body: unknown) {
  const res = await fetch(`${RISK_ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Risk engine error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function publishEvent(eventType: string, subjectRef: string, severity: string, payload: unknown, source = "bis-bff") {
  try {
    await fetch(`${EVENT_PROCESSOR_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: source }),
    });
  } catch (e) {
    console.warn("[EventProcessor] Failed to publish event:", e);
  }
}

async function writeAuditLog(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, entry: {
  userId?: number;
  userEmail?: string;
  category: "investigation" | "kyc" | "alert" | "report" | "user" | "system" | "api";
  action: string;
  targetRef?: string;
  result?: "success" | "warning" | "failure";
  ipAddress?: string;
  detail?: unknown;
}) {
  try {
    await db.insert(auditLog).values({
      ...entry,
      result: entry.result ?? "success",
      detail: entry.detail as any,
    });
  } catch (e) {
    console.warn("[AuditLog] Failed to write:", e);
  }
}

function generateRef(prefix: string): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${year}-${rand}`;
}

// ─── Investigations Router ────────────────────────────────────────────────────

const investigationsRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      country: z.string().optional(),
      tier: z.string().optional(),
      minRisk: z.number().optional(),
      maxRisk: z.number().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [];
      if (input.search) conditions.push(ilike(investigations.subjectName, `%${input.search}%`));
      if (input.status) conditions.push(eq(investigations.status, input.status as any));
      if (input.country) conditions.push(eq(investigations.country, input.country));
      if (input.tier) conditions.push(eq(investigations.tier, input.tier as any));
      if (input.minRisk !== undefined) conditions.push(gte(investigations.riskScore, input.minRisk));
      if (input.maxRisk !== undefined) conditions.push(lte(investigations.riskScore, input.maxRisk));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select().from(investigations).where(where).orderBy(desc(investigations.updatedAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(investigations).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  get: protectedProcedure
    .input(z.object({ ref: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(investigations).where(eq(investigations.ref, input.ref)).limit(1);
      return result[0] ?? null;
    }),

  create: protectedProcedure
    .input(z.object({
      subjectType: z.enum(["individual", "corporate"]),
      subjectName: z.string().min(2),
      country: z.string().default("NG"),
      tier: z.enum(["basic", "standard", "comprehensive"]).default("standard"),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      rcNumber: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      purpose: z.string().optional(),
      dataSources: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const ref = generateRef("BIS");
      await db.insert(investigations).values({
        ref,
        subjectType: input.subjectType,
        subjectName: input.subjectName,
        country: input.country,
        tier: input.tier,
        priority: input.priority,
        status: "pending",
        nin: input.nin,
        bvn: input.bvn,
        rcNumber: input.rcNumber,
        phone: input.phone,
        email: input.email,
        address: input.address,
        purpose: input.purpose,
        dataSources: input.dataSources as any,
        createdBy: ctx.user!.id,
      });
      await writeAuditLog(db, { userId: ctx.user!.id, userEmail: ctx.user!.email ?? undefined, category: "investigation", action: "Investigation created", targetRef: ref });
      await publishEvent("INVESTIGATION_CREATED", ref, "info", { subjectName: input.subjectName, tier: input.tier });
      // Seed Permify: creator is both owner and assignee of the new investigation
      const userId = String(ctx.user!.id);
      await permifyWriteRelationship([
        { entity: { type: "investigation", id: ref }, relation: "owner",    subject: { type: "user", id: userId } },
        { entity: { type: "investigation", id: ref }, relation: "assignee", subject: { type: "user", id: userId } },
      ]);
      return { ref };
    }),

  assign: protectedProcedure
    .input(z.object({ ref: z.string(), assigneeId: z.number(), assigneeName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Permify: check caller can assign this investigation
      const canAssign = await permifyCheck("investigation", input.ref, "assign", String(ctx.user!.id));
      if (!canAssign) throw new Error("Forbidden: you cannot assign this investigation");
      await db.update(investigations)
        .set({ assignedTo: input.assigneeId, updatedAt: new Date() })
        .where(eq(investigations.ref, input.ref));
      // Seed Permify: new assignee relation
      await permifyWriteRelationship([
        { entity: { type: "investigation", id: input.ref }, relation: "assignee", subject: { type: "user", id: String(input.assigneeId) } },
      ]);
      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `Assigned to ${input.assigneeName}`, targetRef: input.ref });
      await publishEvent("INVESTIGATION_ASSIGNED", input.ref, "info", { assigneeId: input.assigneeId, assigneeName: input.assigneeName });
      return { success: true };
    }),

  updateStatus: protectedProcedure
    .input(z.object({ ref: z.string(), status: z.enum(["draft", "pending", "processing", "completed", "flagged", "archived"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(investigations).set({ status: input.status }).where(eq(investigations.ref, input.ref));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `Status changed to ${input.status}`, targetRef: input.ref });
      if (input.status === "flagged") {
        await publishEvent("INVESTIGATION_FLAGGED", input.ref, "high", { status: input.status });
      }
      return { success: true };
    }),

  addNote: protectedProcedure
    .input(z.object({
      ref: z.string(),
      note: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `Note: ${input.note.slice(0, 80)}`, targetRef: input.ref });
      return { success: true, timestamp: new Date().toISOString(), author: ctx.user!.name ?? ctx.user!.email ?? 'analyst' };
    }),

  score: protectedProcedure
    .input(z.object({
      ref: z.string(),
      ninVerified: z.boolean().default(false),
      bvnVerified: z.boolean().default(false),
      ninMatchScore: z.number().default(0),
      bvnMatchScore: z.number().default(0),
      ofacHit: z.boolean().default(false),
      isPep: z.boolean().default(false),
      pepTier: z.number().default(0),
      creditScore: z.number().default(700),
      defaults: z.number().default(0),
      fraudMentions: z.number().default(0),
      corruptionMentions: z.number().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const scoreResult = await riskEngineFetch("/v1/score", {
        subject_id: input.ref,
        subject_type: "individual",
        identity: { nin_verified: input.ninVerified, bvn_verified: input.bvnVerified, nin_match_score: input.ninMatchScore, bvn_match_score: input.bvnMatchScore },
        sanctions: { ofac_hit: input.ofacHit },
        pep: { is_pep: input.isPep, pep_tier: input.pepTier },
        credit: { credit_score: input.creditScore, defaults: input.defaults },
        adverse_media: { fraud_mentions: input.fraudMentions, corruption_mentions: input.corruptionMentions },
      });
      await db.update(investigations).set({
        riskScore: scoreResult.composite_score,
        riskTier: scoreResult.risk_tier,
        riskFactors: scoreResult.factors as any,
        status: scoreResult.risk_tier === "critical" ? "flagged" : "completed",
      }).where(eq(investigations.ref, input.ref));
      if (scoreResult.risk_tier === "critical" || scoreResult.risk_tier === "high") {
        await db.insert(alerts).values({
          investigationId: undefined,
          type: "risk_threshold",
          severity: scoreResult.risk_tier as any,
          title: `Risk score ${scoreResult.composite_score} for ${input.ref}`,
          body: scoreResult.recommendation,
          subjectRef: input.ref,
          sourceService: "risk-engine",
        });
        await publishEvent("INVESTIGATION_FLAGGED", input.ref, scoreResult.risk_tier, { score: scoreResult.composite_score });
      }
      return scoreResult;
    }),
});

// ─── Data Source Lookup Router ────────────────────────────────────────────────

const lookupRouter = router({
  nin: protectedProcedure
    .input(z.object({ nin: z.string().length(11) }))
    .query(async ({ input }) => gatewayFetch(`/v1/nin/${input.nin}`)),

  bvn: protectedProcedure
    .input(z.object({ bvn: z.string().length(11) }))
    .query(async ({ input }) => gatewayFetch(`/v1/bvn/${input.bvn}`)),

  cac: protectedProcedure
    .input(z.object({ rc: z.string() }))
    .query(async ({ input }) => gatewayFetch(`/v1/cac/${input.rc}`)),

  sanctions: protectedProcedure
    .input(z.object({ name: z.string().min(2) }))
    .query(async ({ input }) => gatewayFetch(`/v1/sanctions/${encodeURIComponent(input.name)}`)),

  pep: protectedProcedure
    .input(z.object({ name: z.string().min(2) }))
    .query(async ({ input }) => gatewayFetch(`/v1/pep/${encodeURIComponent(input.name)}`)),

  credit: protectedProcedure
    .input(z.object({ bvn: z.string().length(11) }))
    .query(async ({ input }) => gatewayFetch(`/v1/credit/${input.bvn}`)),

  gatewayHealth: publicProcedure.query(async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`);
      return res.ok ? await res.json() : { status: "down" };
    } catch { return { status: "unreachable" }; }
  }),

  riskEngineHealth: publicProcedure.query(async () => {
    try {
      const res = await fetch(`${RISK_ENGINE_URL}/health`);
      return res.ok ? await res.json() : { status: "down" };
    } catch { return { status: "unreachable" }; }
  }),

  eventProcessorHealth: publicProcedure.query(async () => {
    try {
      const res = await fetch(`${EVENT_PROCESSOR_URL}/health`);
      return res.ok ? await res.json() : { status: "down" };
    } catch { return { status: "unreachable" }; }
  }),

  nigerianDataBundle: protectedProcedure
    .input(z.object({
      fullName: z.string().optional(),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      phone: z.string().optional(),
      dateOfBirth: z.string().optional(),
      selectedSources: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input }) => {
      // Run checks against gateway for each selected source
      const results = await Promise.allSettled(
        input.selectedSources.map(async (sourceId) => {
          try {
            let endpoint = '';
            if (sourceId === 'nimc_nin' && input.nin) endpoint = `/v1/nin/${input.nin}`;
            else if (sourceId === 'bvn' && input.bvn) endpoint = `/v1/bvn/${input.bvn}`;
            else if (sourceId === 'cac') endpoint = `/v1/cac/search?name=${encodeURIComponent(input.fullName ?? '')}`;
            else if (sourceId === 'sanctions') endpoint = `/v1/sanctions/${encodeURIComponent(input.fullName ?? '')}`;
            else if (sourceId === 'pep') endpoint = `/v1/pep/${encodeURIComponent(input.fullName ?? '')}`;
            else if (sourceId === 'credit' && input.bvn) endpoint = `/v1/credit/${input.bvn}`;
            if (!endpoint) return { sourceId, status: 'pending', data: {}, checkedAt: new Date().toISOString() };
            const data = await gatewayFetch(endpoint);
            return { sourceId, status: 'verified', data, checkedAt: new Date().toISOString() };
          } catch (e: any) {
            return { sourceId, status: 'error', message: e.message, data: {}, checkedAt: new Date().toISOString() };
          }
        })
      );
      return {
        results: results.map(r => r.status === 'fulfilled' ? r.value : { sourceId: 'unknown', status: 'error', data: {}, checkedAt: new Date().toISOString() }),
      };
    }),
});

// ─── Alerts Router ────────────────────────────────────────────────────────────

const alertsRouter = router({
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().default(false), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = input.unreadOnly ? [eq(alerts.read, false)] : [];
      return db.select().from(alerts).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(alerts.createdAt)).limit(input.limit);
    }),

  acknowledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(alerts).set({ acknowledged: true, acknowledgedBy: ctx.user!.id, acknowledgedAt: new Date(), read: true }).where(eq(alerts.id, input.id));
      await publishEvent("ALERT_ACKNOWLEDGED", `alert-${input.id}`, "info", {}, "bis-bff");
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.update(alerts).set({ read: true });
    return { success: true };
  }),
});

// ─── KYC Router ───────────────────────────────────────────────────────────────

const kycRouter = router({
  // create: used by KYCVerificationPage to record a biometric KYC decision
  create: protectedProcedure
    .input(z.object({
      subjectName: z.string().min(1),
      subjectType: z.enum(["individual", "corporate"]).default("individual"),
      documentType: z.string(),
      documentId: z.string().optional(),
      livenessPassed: z.boolean().optional(),
      documentConfidence: z.number().optional(),
      isTampered: z.boolean().optional(),
      verificationSteps: z.array(z.object({ source: z.string(), status: z.string() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const riskScore = input.isTampered ? 85 : input.livenessPassed === false ? 75 : input.documentConfidence && input.documentConfidence < 0.5 ? 65 : 20;
      const status = riskScore >= 80 ? "failed" : riskScore >= 60 ? "review" : "passed";
      const referenceId = `KYC-${Date.now().toString(36).toUpperCase()}`;
      const [record] = await db.insert(kycRecords).values({
        subjectName: input.subjectName,
        status,
        riskScore,
        createdBy: ctx.user!.id,
      }).returning();
      await writeAuditLog(db, { userId: ctx.user!.id, category: "kyc", action: `KYC biometric ${status}`, targetRef: input.subjectName });
      await publishEvent("KYC_COMPLETED", input.subjectName, status === "failed" ? "high" : "info", { status, score: riskScore });
      return { ...record, referenceId, verifiedFields: input.livenessPassed ? ["liveness", "document"] : ["document"] };
    }),

  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      cursor: z.number().optional(), // last seen record id for cursor pagination
      status: z.enum(["pending", "processing", "passed", "failed", "review"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0, nextCursor: null };
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.cursor) conditions.push(sql`${kycRecords.id} < ${input.cursor}` as any);
      if (input.status) conditions.push(eq(kycRecords.status, input.status));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      // Count query respects status filter
      const countConditions = input.status ? [eq(kycRecords.status, input.status)] : [];
      const [items, countResult] = await Promise.all([
        db.select().from(kycRecords)
          .where(where)
          .orderBy(desc(kycRecords.id))
          .limit(input.limit + 1), // fetch one extra to detect next page
        db.select({ count: sql<number>`count(*)` }).from(kycRecords)
          .where(countConditions.length ? and(...countConditions) : undefined),
      ]);
      const hasMore = items.length > input.limit;
      const page = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? page[page.length - 1]!.id : null;
      return { items: page, total: Number(countResult[0]?.count ?? 0), nextCursor };
    }),

  // ── AI Proxy Procedures (server-side, API key never exposed to browser) ──────

  extractDocument: protectedProcedure
    .input(z.object({
      fileDataUri: z.string().min(10), // base64 data URI
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input }) => {
      try {
        const base64 = input.fileDataUri.split(",")[1] ?? input.fileDataUri;
        const buffer = Buffer.from(base64, "base64");
        const form = new FormData();
        const blob = new Blob([buffer], { type: input.mimeType });
        form.append("file", blob, "document.jpg");
        const res = await fetch(`${KYC_SERVICE_URL}/api/kyc/extract-document`, {
          method: "POST",
          headers: { "x-api-key": GATEWAY_KEY },
          body: form,
        });
        if (!res.ok) throw new Error(`KYC service error ${res.status}`);
        return await res.json();
      } catch (e) {
        // Graceful fallback: return a minimal structure so UI can continue
        return { document_type: "unknown", document_id: null, fields: {}, overall_confidence: 0, warnings: ["Service unavailable"] };
      }
    }),

  detectTampering: protectedProcedure
    .input(z.object({
      fileDataUri: z.string().min(10),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input }) => {
      try {
        const base64 = input.fileDataUri.split(",")[1] ?? input.fileDataUri;
        const buffer = Buffer.from(base64, "base64");
        const form = new FormData();
        const blob = new Blob([buffer], { type: input.mimeType });
        form.append("file", blob, "document.jpg");
        const res = await fetch(`${KYC_SERVICE_URL}/api/kyc/detect-tampering`, {
          method: "POST",
          headers: { "x-api-key": GATEWAY_KEY },
          body: form,
        });
        if (!res.ok) throw new Error(`KYC service error ${res.status}`);
        return await res.json();
      } catch {
        return { is_tampered: false, tamper_types: [] };
      }
    }),

  verifyLiveness: protectedProcedure
    .input(z.object({
      frameDataUri: z.string().min(10), // base64 data URI of last liveness frame
    }))
    .mutation(async ({ input }) => {
      try {
        const base64 = input.frameDataUri.split(",")[1] ?? input.frameDataUri;
        const buffer = Buffer.from(base64, "base64");
        const form = new FormData();
        const blob = new Blob([buffer], { type: "image/jpeg" });
        form.append("file", blob, "liveness.jpg");
        const res = await fetch(`${KYC_SERVICE_URL}/api/kyc/verify-liveness`, {
          method: "POST",
          headers: { "x-api-key": GATEWAY_KEY },
          body: form,
        });
        if (!res.ok) throw new Error(`KYC service error ${res.status}`);
        return await res.json();
      } catch {
        return { is_live: true, confidence: 0.5, spoof_type: null };
      }
    }),

  matchFace: protectedProcedure
    .input(z.object({
      selfieDataUri: z.string().min(10),
      documentDataUri: z.string().min(10),
      documentDob: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const selfieBase64 = input.selfieDataUri.split(",")[1] ?? input.selfieDataUri;
        const docBase64 = input.documentDataUri.split(",")[1] ?? input.documentDataUri;
        const form = new FormData();
        form.append("selfie", new Blob([Buffer.from(selfieBase64, "base64")], { type: "image/jpeg" }), "selfie.jpg");
        form.append("document_face", new Blob([Buffer.from(docBase64, "base64")], { type: "image/jpeg" }), "document_face.jpg");
        if (input.documentDob) form.append("document_dob", input.documentDob);
        const res = await fetch(`${KYC_SERVICE_URL}/api/kyc/match-face`, {
          method: "POST",
          headers: { "x-api-key": GATEWAY_KEY },
          body: form,
        });
        if (!res.ok) throw new Error(`KYC service error ${res.status}`);
        return await res.json();
      } catch {
        return { match: true, similarity: 0.5, threshold: 0.6 };
      }
    }),

  verify: protectedProcedure
    .input(z.object({
      subjectName: z.string().min(2),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      dob: z.string().optional(),
      phone: z.string().optional(),
      investigationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [record] = await db.insert(kycRecords).values({
        subjectName: input.subjectName,
        nin: input.nin,
        bvn: input.bvn,
        dob: input.dob,
        phone: input.phone,
        investigationId: input.investigationId,
        status: "processing",
        createdBy: ctx.user!.id,
      }).returning();
      // Run lookups in parallel
      const [ninResult, bvnResult, sanctionsResult, pepResult, creditResult] = await Promise.allSettled([
        input.nin ? gatewayFetch(`/v1/nin/${input.nin}`) : Promise.resolve(null),
        input.bvn ? gatewayFetch(`/v1/bvn/${input.bvn}`) : Promise.resolve(null),
        gatewayFetch(`/v1/sanctions/${encodeURIComponent(input.subjectName)}`),
        gatewayFetch(`/v1/pep/${encodeURIComponent(input.subjectName)}`),
        input.bvn ? gatewayFetch(`/v1/credit/${input.bvn}`) : Promise.resolve(null),
      ]);
      const nin = ninResult.status === "fulfilled" ? ninResult.value : null;
      const bvn = bvnResult.status === "fulfilled" ? bvnResult.value : null;
      const sanctions = sanctionsResult.status === "fulfilled" ? sanctionsResult.value : null;
      const pep = pepResult.status === "fulfilled" ? pepResult.value : null;
      const credit = creditResult.status === "fulfilled" ? creditResult.value : null;
      // Score
      const scoreResult = await riskEngineFetch("/v1/score", {
        subject_id: input.subjectName,
        identity: { nin_verified: !!nin?.status, bvn_verified: !!bvn?.bvn, nin_match_score: nin?.matchScore ?? 0, bvn_match_score: bvn?.matchScore ?? 0 },
        sanctions: { ofac_hit: !sanctions?.clear, bvn_watchlisted: bvn?.watchlisted ?? false },
        pep: { is_pep: pep?.isPEP ?? false },
        credit: { credit_score: credit?.score ?? 700, defaults: credit?.defaults ?? 0 },
      }).catch(() => ({ composite_score: 50, risk_tier: "medium" }));
      const status = scoreResult.risk_tier === "critical" ? "failed" : scoreResult.risk_tier === "high" ? "review" : "passed";
      await db.update(kycRecords).set({
        status,
        riskScore: scoreResult.composite_score,
        ninResult: nin as any,
        bvnResult: bvn as any,
        sanctionsResult: sanctions as any,
        pepResult: pep as any,
        creditResult: credit as any,
      }).where(eq(kycRecords.id, record!.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "kyc", action: `KYC ${status}`, targetRef: input.subjectName });
      await publishEvent("KYC_COMPLETED", input.subjectName, status === "failed" ? "high" : "info", { status, score: scoreResult.composite_score });
      return { status, riskScore: scoreResult.composite_score, nin, bvn, sanctions, pep, credit };
    }),
});

// ─── Audit Log Router ─────────────────────────────────────────────────────────

const auditRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      result: z.string().optional(),
      targetRef: z.string().optional(),
      userId: z.number().optional(), // filter by actor user id (for deep-link from admin/users)
      limit: z.number().default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [];
      if (input.category) conditions.push(eq(auditLog.category, input.category as any));
      if (input.result) conditions.push(eq(auditLog.result, input.result as any));
      if (input.targetRef) conditions.push(eq(auditLog.targetRef, input.targetRef));
      if (input.userId) conditions.push(eq(auditLog.userId, input.userId));
      const where = conditions.length ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  eventProcessorLog: protectedProcedure.query(async () => {
    try {
      const res = await fetch(`${EVENT_PROCESSOR_URL}/v1/audit`, { headers: { "X-BIS-Key": GATEWAY_KEY } });
      return res.ok ? await res.json() : [];
    } catch { return []; }
  }),
});

// ─── Field Tasks Router ───────────────────────────────────────────────────────

const fieldTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional(), agentId: z.string().optional(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input.status) conditions.push(eq(fieldTasks.status, input.status as any));
      if (input.agentId) conditions.push(eq(fieldTasks.agentId, input.agentId));
      return db.select().from(fieldTasks).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(fieldTasks.createdAt)).limit(input.limit);
    }),

  dispatch: protectedProcedure
    .input(z.object({
      agentId: z.string(),
      agentName: z.string(),
      taskType: z.enum(["address_verification", "biometric_capture", "document_collection", "surveillance", "interview"]),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      subjectName: z.string().optional(),
      address: z.string().optional(),
      state: z.string().optional(),
      lga: z.string().optional(),
      gpsLat: z.number().optional(),
      gpsLng: z.number().optional(),
      deadline: z.string().optional(),
      instructions: z.string().optional(),
      investigationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const taskRef = generateRef("FT");
      await db.insert(fieldTasks).values({
        taskRef,
        agentId: input.agentId,
        agentName: input.agentName,
        taskType: input.taskType,
        priority: input.priority,
        status: "dispatched",
        subjectName: input.subjectName,
        address: input.address,
        state: input.state,
        lga: input.lga,
        gpsLat: input.gpsLat,
        gpsLng: input.gpsLng,
        deadline: input.deadline ? new Date(input.deadline) : undefined,
        instructions: input.instructions,
        investigationId: input.investigationId,
        createdBy: ctx.user!.id,
      });
      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `Field task dispatched to ${input.agentName}`, targetRef: taskRef });
      await publishEvent("FIELD_TASK_DISPATCHED", taskRef, "info", { agentName: input.agentName, taskType: input.taskType });
      return { taskRef };
    }),
});

// ─── Reports Router ───────────────────────────────────────────────────────────

const reportsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(reports).orderBy(desc(reports.createdAt)).limit(input.limit);
    }),

  generate: protectedProcedure
    .input(z.object({
      template: z.string(),
      title: z.string(),
      format: z.enum(["pdf", "docx", "csv", "json"]).default("pdf"),
      investigationId: z.number().optional(),
      sections: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const reportRef = generateRef("RPT");
      await db.insert(reports).values({
        reportRef,
        template: input.template,
        title: input.title,
        format: input.format,
        status: "generating",
        investigationId: input.investigationId,
        sections: input.sections as any,
        generatedBy: ctx.user!.id,
      });
      // Simulate async generation — mark ready after 2s
      setTimeout(async () => {
        const db2 = await getDb();
        if (db2) {
          await db2.update(reports).set({ status: "ready", fileUrl: `https://storage.bis.ng/reports/${reportRef}.${input.format}` }).where(eq(reports.reportRef, reportRef));
          await publishEvent("REPORT_GENERATED", reportRef, "info", { template: input.template, format: input.format });
        }
      }, 2000);
      await writeAuditLog(db, { userId: ctx.user!.id, category: "report", action: `Report generated: ${input.title}`, targetRef: reportRef });
      return { reportRef };
    }),
});

// ─── Users Router ───────────────────────────────────────────────────────────

const usersRouter = router({
  list: protectedProcedure
    .input(z.object({
      role: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions: any[] = [];
      if (input?.role) conditions.push(eq(users.role, input.role as any));
      if (input?.search) {
        const s = `%${input.search}%`;
        conditions.push(sql`(${users.name} ILIKE ${s} OR ${users.email} ILIKE ${s})`);
      }
      return db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt, lastSignedIn: users.lastSignedIn })
        .from(users)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(users.name)
        .limit(input?.limit ?? 100);
    }),
  updateRole: protectedProcedure
    .input(z.object({ id: z.number(), role: z.enum(["admin", "analyst", "supervisor", "auditor", "readonly"]) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ role: input.role as any, updatedAt: new Date() }).where(eq(users.id, input.id));
      await writeAuditLog(db, { userId: ctx.user.id, category: "user", action: `Role changed to ${input.role}`, targetRef: String(input.id) });
      return { success: true };
    }),
  deactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ role: "readonly" as any, updatedAt: new Date() }).where(eq(users.id, input.id));
      await writeAuditLog(db, { userId: ctx.user.id, category: "user", action: "User deactivated", targetRef: String(input.id) });
      return { success: true };
    }),
});

// ─── Dashboard Router ────────────────────────────────────────────────────────

const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return getDashboardStats();
  }),
});

// ─── Field Agents Router ──────────────────────────────────────────────────────

const fieldAgentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      state: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getFieldAgents(input);
    }),
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getFieldAgentById(input.id);
    }),
  create: protectedProcedure
    .input(z.object({
      agentCode: z.string().min(3).max(32),
      name: z.string().min(2).max(255),
      email: z.string().email(),
      phone: z.string().optional(),
      state: z.string().optional(),
      lga: z.string().optional(),
      tier: z.enum(["junior", "senior", "lead", "specialist"]).default("junior"),
      specializations: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createFieldAgent({ ...input, createdBy: ctx.user!.id });
    }),
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      phone: z.string().optional(),
      state: z.string().optional(),
      lga: z.string().optional(),
      status: z.enum(["active", "inactive", "suspended", "training"]).optional(),
      tier: z.enum(["junior", "senior", "lead", "specialist"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateFieldAgent(id, data);
    }),
});

// ─── Data Sources Router ──────────────────────────────────────────────────────

const dataSourcesRouter = router({
  seed: protectedProcedure
    .mutation(async () => {
      const { seedDataSources } = await import('./db');
      return seedDataSources();
    }),
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      category: z.string().optional(),
      enabled: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getDataSources(input);
    }),
  create: protectedProcedure
    .input(z.object({
      code: z.string().min(2).max(64),
      name: z.string().min(2).max(255),
      category: z.enum(["identity", "financial", "legal", "social", "biometric", "government", "commercial"]),
      provider: z.string().optional(),
      baseUrl: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      return createDataSource(input);
    }),
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      status: z.enum(["active", "degraded", "offline", "maintenance"]).optional(),
      enabled: z.boolean().optional(),
      description: z.string().optional(),
      uptimePct: z.number().optional(),
      avgResponseMs: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateDataSource(id, data);
    }),
});

// ─── Monitors Router ──────────────────────────────────────────────────────────

const monitorsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getMonitors(input);
    }),
  create: protectedProcedure
    .input(z.object({
      subjectName: z.string().min(2).max(255),
      subjectRef: z.string().optional(),
      investigationId: z.number().optional(),
      type: z.enum(["sanctions", "pep", "adverse_media", "social", "transaction", "biometric"]),
      frequency: z.string().default("daily"),
      expiresAt: z.date().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const monitorRef = `MON-${Date.now().toString(36).toUpperCase()}`;
      return createMonitor({ ...input, monitorRef, createdBy: ctx.user!.id });
    }),
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active", "paused", "triggered", "expired"]).optional(),
      frequency: z.string().optional(),
      expiresAt: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateMonitor(id, data);
    }),
});

// ─── Screening Router ─────────────────────────────────────────────────────────

const screeningRouter = router({
  list: protectedProcedure
    .input(z.object({
      type: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getScreeningRequests(input);
    }),
  create: protectedProcedure
    .input(z.object({
      type: z.enum(["mvr", "drug", "work_authorization", "biometric", "zero_footprint"]),
      subjectName: z.string().min(2).max(255),
      subjectType: z.enum(["individual", "corporate"]).default("individual"),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      investigationId: z.number().optional(),
      requestData: z.record(z.string(), z.unknown()).optional(),
      result: z.record(z.string(), z.unknown()).optional(),
      resultSummary: z.string().optional(),
      riskScore: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const requestRef = `SCR-${Date.now().toString(36).toUpperCase()}`;
      const status = input.result ? "completed" : "pending";
      const completedAt = input.result ? new Date() : undefined;
      return createScreeningRequest({ ...input, requestRef, status, completedAt, processedBy: input.result ? ctx.user!.id : undefined, createdBy: ctx.user!.id });
    }),
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "processing", "completed", "failed", "review"]),
      result: z.record(z.string(), z.unknown()).optional(),
      resultSummary: z.string().optional(),
      riskScore: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const extra = data.status === "completed" ? { completedAt: new Date(), processedBy: ctx.user!.id } : {};
      return updateScreeningRequest(id, { ...data, ...extra });
    }),
});

// ─── Settings Router ─────────────────────────────────────────────────────────

const settingsRouter = router({
  get: protectedProcedure
    .input(z.object({ namespace: z.string().default("default") }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return {};
      const ns = input?.namespace ?? "default";
      const rows = await db.select().from(platformSettings).where(eq(platformSettings.namespace, ns));
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    }),

  set: protectedProcedure
    .input(z.object({
      namespace: z.string().default("default"),
      settings: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const updatedBy = ctx.user?.email ?? ctx.user?.name ?? String(ctx.user?.id ?? "unknown");
      for (const [key, value] of Object.entries(input.settings)) {
        const existing = await db.select({ id: platformSettings.id })
          .from(platformSettings)
          .where(and(eq(platformSettings.namespace, input.namespace), eq(platformSettings.key, key)))
          .limit(1);
        if (existing.length > 0) {
          await db.update(platformSettings)
            .set({ value: value as any, updatedAt: new Date(), updatedBy })
            .where(and(eq(platformSettings.namespace, input.namespace), eq(platformSettings.key, key)));
        } else {
          await db.insert(platformSettings).values({
            namespace: input.namespace,
            key,
            value: value as any,
            updatedBy,
          });
        }
      }
      await writeAuditLog(db, { userId: ctx.user?.id, category: "system", action: `Settings updated (${Object.keys(input.settings).join(", ")})`, targetRef: input.namespace });
      return { success: true, updated: Object.keys(input.settings).length };
    }),
});

// ─── Onboarding Router ──────────────────────────────────────────────────────

const onboardingRouter = router({
  create: protectedProcedure
    .input(z.object({
      entityType: z.string().min(1),
      legalName: z.string().min(2),
      tradingName: z.string().optional(),
      countryCode: z.string().optional(),
      stateProvince: z.string().optional(),
      city: z.string().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      businessCategory: z.string().optional(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactPhone: z.string().optional(),
      contactTitle: z.string().optional(),
      useCase: z.string().optional(),
      pepDeclaration: z.boolean().optional(),
      agreedToTerms: z.boolean().optional(),
      stakeholders: z.array(z.object({
        role: z.string(),
        fullName: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        ownershipPercentage: z.number().optional(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const referenceId = `OB-${Date.now().toString(36).toUpperCase()}`;
      const [record] = await db.insert(onboardingApplications).values({
        referenceId,
        entityType: input.entityType,
        legalName: input.legalName,
        tradingName: input.tradingName,
        countryCode: input.countryCode,
        stateProvince: input.stateProvince,
        city: input.city,
        address: input.address,
        website: input.website,
        businessCategory: input.businessCategory,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        contactTitle: input.contactTitle,
        useCase: input.useCase,
        pepDeclaration: input.pepDeclaration ?? false,
        agreedToTerms: input.agreedToTerms ?? false,
        status: "submitted",
        stakeholders: (input.stakeholders ?? []) as any[],
        createdBy: String(ctx.user!.id),
      }).returning();
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Onboarding application submitted`, targetRef: referenceId });
      await publishEvent("ONBOARDING_SUBMITTED", referenceId, "info", { legalName: input.legalName });
      // Notify platform owner of new application
      notifyOwner({
        title: `New Onboarding Application — ${input.legalName}`,
        content: `A new onboarding application (${referenceId}) was submitted by ${input.contactName ?? "unknown"} (${input.contactEmail ?? "no email"}) for entity type: ${input.entityType}. Use case: ${input.useCase ?? "not specified"}. Log in to review at /admin/onboarding.`,
      }).catch(e => console.warn("[Notify] onboarding.create:", e));
      return record!;
    }),

  list: adminProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const [items, countResult] = await Promise.all([
        db.select().from(onboardingApplications).orderBy(desc(onboardingApplications.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(onboardingApplications),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  get: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [record] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });
      return record;
    }),

  uploadDocument: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      fileName: z.string().min(1),
      fileDataUri: z.string().min(10), // base64 data URI
      mimeType: z.string().default("application/octet-stream"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Verify application belongs to this user or user is admin
      const [app] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.applicationId)).limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (app.createdBy !== String(ctx.user!.id) && ctx.user!.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Upload to S3
      const base64 = input.fileDataUri.split(",")[1] ?? input.fileDataUri;
      const buffer = Buffer.from(base64, "base64");
      const suffix = Math.random().toString(36).slice(2, 8);
      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `onboarding/${app.referenceId}/${suffix}-${safeFileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      // Append to documentUrls
      const existing = (app.documentUrls as any[] ?? []);
      const updated = [...existing, { name: input.fileName, url, key, uploadedAt: new Date().toISOString() }];
      await db.update(onboardingApplications)
        .set({ documentUrls: updated as any, updatedAt: new Date() })
        .where(eq(onboardingApplications.id, input.applicationId));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Document uploaded: ${input.fileName}`, targetRef: app.referenceId });
      return { url, key, name: input.fileName };
    }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.number(), status: z.enum(["draft", "submitted", "awaiting_documents", "under_review", "approved", "rejected"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Fetch application for notification context
      const [app] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.id)).limit(1);
      await db.update(onboardingApplications).set({ status: input.status, updatedAt: new Date() }).where(eq(onboardingApplications.id, input.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Onboarding status → ${input.status}`, targetRef: String(input.id) });
      // Notify owner on terminal status changes
      if (input.status === "approved" || input.status === "rejected") {
        notifyOwner({
          title: `Onboarding ${input.status === "approved" ? "Approved" : "Rejected"} — ${app?.legalName ?? `ID ${input.id}`}`,
          content: `Application ${app?.referenceId ?? input.id} for ${app?.legalName ?? "unknown entity"} has been ${input.status} by user ${ctx.user!.email ?? ctx.user!.id}. Contact: ${app?.contactEmail ?? "n/a"}.`,
        }).catch(e => console.warn("[Notify] onboarding.updateStatus:", e));
      }
      return { success: true };
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  investigations: investigationsRouter,
  lookup: lookupRouter,
  alerts: alertsRouter,
  kyc: kycRouter,
  audit: auditRouter,
  fieldTasks: fieldTasksRouter,
  reports: reportsRouter,
  billing: billingRouter,
  users: usersRouter,
  dashboard: dashboardRouter,
  fieldAgents: fieldAgentsRouter,
  dataSources: dataSourcesRouter,
  monitors: monitorsRouter,
  screening: screeningRouter,
  tenants: tenantsRouter,
  settings: settingsRouter,
  onboarding: onboardingRouter,
});

export type AppRouter = typeof appRouter;

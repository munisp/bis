import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { billingRouter } from "./billing";
import { permifyWriteRelationship, permifyCheck } from "./permify";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  investigations,
  alerts,
  kycRecords,
  auditLog,
  fieldTasks,
  reports,
} from "../drizzle/schema";
import { eq, desc, and, ilike, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

// ─── Service URLs ─────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.BIS_GATEWAY_URL || "http://localhost:8081";
const RISK_ENGINE_URL = process.env.BIS_RISK_ENGINE_URL || "http://localhost:8082";
const EVENT_PROCESSOR_URL = process.env.BIS_EVENT_PROCESSOR_URL || "http://localhost:8083";
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
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const [items, countResult] = await Promise.all([
        db.select().from(kycRecords).orderBy(desc(kycRecords.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(kycRecords),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
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
      limit: z.number().default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [];
      if (input.category) conditions.push(eq(auditLog.category, input.category as any));
      if (input.result) conditions.push(eq(auditLog.result, input.result as any));
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
});

export type AppRouter = typeof appRouter;

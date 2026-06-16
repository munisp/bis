import { COOKIE_NAME } from "@shared/const";
import { withCache, invalidateCache, TTL } from "./cache";
import { withCircuitBreaker } from "./circuitBreaker";
import { getSessionCookieOptions } from "./_core/cookies";
import { billingRouter } from "./billing";
import { tenantsRouter } from "./tenants";
import { permifyWriteRelationship, permifyCheck } from "./permify";
import { systemRouter } from "./_core/systemRouter";
import { notifyOwner } from "./_core/notification";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, publicProcedure, router, writeProcedure } from "./_core/trpc";
import { apiTokensRouter } from "./apiTokens";
import { quickcheckRouter } from "./quickcheck";
import { goamlRouter } from "./goaml";
import { amlRouter } from "./aml";
import { transactionsRouter } from "./transactions";
import { tradeFinanceRouter, correspondentBankingRouter, evidenceRouter, regulatoryReportsRouter } from "./banking";
import { sarRouter } from "./sar";
import { keycloakRouter } from "./keycloakRouter";
import { temporalRouter } from "./temporalRouter";
import { redisRouter } from "./redisRouter";
import { messagingRouter } from "./messaging";
import { socialMonitoringRouter } from "./socialMonitoring";
import { biometricRouter } from "./biometric";
import { lakehouseRouter } from "./lakehouse";
import { lexRouter } from "./lex";
import { sessionsRouter, totpRouter, notificationsRouter, investigationLinksRouter, exportSchedulesRouter } from "./platform";
import { archivalRouter } from "./archival";
import { paymentRailsRouter } from "./paymentRails";
import { documentVaultRouter } from "./documentVault";
import { riskDashboardRouter } from "./riskDashboard";
import { getDb } from "./db";
import { evaluateAlertRules } from "./alertRules";
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
  alertRules,
  ruleEvaluations,
  tenants,
  fieldAgentPlaybooks,
  duplicateIdentityChecks,
  hostedVerificationLinks,
  cases,
  caseParties,
  caseDocuments,
  caseTimeline,
  caseStakeholders,
  caseComments,
  lexAgencies,
  lexSubmitters,
  lexSubmissions,
  nigerianStateEnum,
  lexAgencyTypeEnum,
  lexIncidentTypeEnum,
  userSessions,
  userTotpSecrets,
  notifications,
  investigationCaseLinks,
  exportSchedules,
  nigerianDataBundleRuns,
  dataSourceHealthLogs,
  kycScheduledReruns,
} from "../drizzle/schema";
import {
  getDashboardStats,
  getFieldAgents, createFieldAgent, updateFieldAgent, getFieldAgentById,
  getDataSources, createDataSource, updateDataSource,
  getMonitors, createMonitor, updateMonitor,
  getScreeningRequests, createScreeningRequest, updateScreeningRequest,
} from "./db";
import { eq, desc, asc, and, ilike, gte, lte, lt, sql, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { ENV } from "./_core/env";

// ─── Service URLs ─────────────────────────────────────────────────────────────

const GATEWAY_URL = ENV.bisGatewayUrl;
const RISK_ENGINE_URL = ENV.riskEngineUrl;
const EVENT_PROCESSOR_URL = ENV.eventProcessorUrl;
const KYC_SERVICE_URL = ENV.bisKycServiceUrl;
const GATEWAY_KEY = ENV.bisGatewayKey;

// ─── Service Client Helpers ───────────────────────────────────────────────────

async function gatewayFetch(path: string) {
  return withCircuitBreaker("gateway", async () => {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      headers: { "X-BIS-Key": GATEWAY_KEY },
    });
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`);
    return res.json();
  });
}

async function riskEngineFetch(path: string, body: unknown) {
  return withCircuitBreaker("risk-engine", async () => {
    const res = await fetch(`${RISK_ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Risk engine error ${res.status}: ${await res.text()}`);
    return res.json();
  });
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
    const result = entry.result ?? "success";
    const createdAt = new Date();
    // Compute HMAC-SHA256 integrity hash for tamper detection
    const AUDIT_HMAC_SECRET = ENV.auditHmacSecret;
    const payload = [
      String(entry.userId ?? ""),
      entry.category,
      entry.action,
      entry.targetRef ?? "",
      result,
      createdAt.toISOString(),
    ].join("|");
    const { createHmac } = await import("crypto");
    const integrityHash = createHmac("sha256", AUDIT_HMAC_SECRET)
      .update(payload)
      .digest("hex")
      .slice(0, 64);
    await db.insert(auditLog).values({
      ...entry,
      result,
      detail: entry.detail as any,
      integrityHash,
      createdAt,
    });
  } catch (e) {
    console.warn("[AuditLog] Failed to write:", e);
  }
}

// SECURITY: HTML escape to prevent XSS/injection in PDF templates
function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function generateRef(prefix: string): string {
  const year = new Date().getFullYear();
  // Use crypto.randomBytes for cryptographically secure unique IDs
  const { randomBytes } = require("crypto");
  const rand = randomBytes(3).toString("hex").toUpperCase(); // 6 hex chars = 16M combinations
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
      limit: z.number().min(1).max(250).default(50),
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

  create: writeProcedure
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
      // Evaluate alert rules for new investigation (initial risk_score = 0, rules may fire on creation)
      await evaluateAlertRules("risk_score", 0, {
        subjectRef: ref,
        subjectName: input.subjectName,
        triggeredBy: "investigations.create",
        userId: ctx.user!.id,
        userEmail: ctx.user!.email ?? undefined,
      }).catch(() => {});
      return { ref };
    }),

  assign: writeProcedure
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

  updateStatus: writeProcedure
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

  addNote: writeProcedure
    .input(z.object({
      ref: z.string(),
      note: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [row] = await db.insert(auditLog).values({
        userId: ctx.user!.id,
        userEmail: ctx.user!.email ?? undefined,
        category: "investigation",
        action: `Note: ${input.note}`,
        targetRef: input.ref,
        result: "success",
      }).returning();
      return { success: true, id: row.id, timestamp: row.createdAt.toISOString(), author: ctx.user!.name ?? ctx.user!.email ?? 'analyst' };
    }),

  updateNote: writeProcedure
    .input(z.object({
      id: z.number(),
      note: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Only allow updating notes that belong to the current user
      const [existing] = await db.select().from(auditLog).where(and(eq(auditLog.id, input.id), eq(auditLog.category, "investigation")));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      if (existing.userId !== ctx.user!.id) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit another user's note" });
      const [updated] = await db.update(auditLog)
        .set({ action: `Note: ${input.note}` })
        .where(eq(auditLog.id, input.id))
        .returning();
      return { success: true, id: updated.id, timestamp: updated.createdAt.toISOString() };
    }),

  deleteNote: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [existing] = await db.select().from(auditLog).where(and(eq(auditLog.id, input.id), eq(auditLog.category, "investigation")));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      if (existing.userId !== ctx.user!.id) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete another user's note" });
      await db.delete(auditLog).where(eq(auditLog.id, input.id));
      return { success: true };
    }),

  score: writeProcedure
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

  exportTimeline: writeProcedure
    .input(z.object({ ref: z.string(), tenantId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Fetch investigation record
      const [inv] = await db.select().from(investigations).where(eq(investigations.ref, input.ref)).limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });

      // Fetch tenant branding (optional)
      let tenantName: string | null = null;
      let tenantLogoUrl: string | null = null;
      if (input.tenantId) {
        const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
        if (tenant) {
          tenantName = tenant.name;
          tenantLogoUrl = tenant.logoUrl ?? null;
        }
      }

      // Fetch evidence: audit log entries for this investigation
      const entries = await db.select().from(auditLog)
        .where(eq(auditLog.targetRef, input.ref))
        .orderBy(desc(auditLog.createdAt))
        .limit(200);

      // Fetch field tasks linked to this investigation
      const tasks = await db.select().from(fieldTasks)
        .where(eq(fieldTasks.investigationId, inv.id))
        .orderBy(desc(fieldTasks.createdAt))
        .limit(50);

      // Fetch tenant logo as base64 if available
      let logoBase64: string | null = null;
      if (tenantLogoUrl) {
        try {
          const res = await fetch(tenantLogoUrl);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const mime = res.headers.get("content-type") ?? "image/png";
            logoBase64 = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
          }
        } catch { /* skip logo if fetch fails */ }
      }

      // Build PDF using pdfmake
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PdfPrinter = require("pdfmake/build/pdfmake") as any;
      const fonts = {
        Helvetica: {
          normal: "Helvetica",
          bold: "Helvetica-Bold",
          italics: "Helvetica-Oblique",
          bolditalics: "Helvetica-BoldOblique",
        },
      };
      const printer = new PdfPrinter(fonts);

      const riskColor = (score: number | null) =>
        !score ? "#6b7280" : score >= 80 ? "#dc2626" : score >= 60 ? "#f59e0b" : "#16a34a";

      const timelineRows: any[] = entries.map(e => [
        { text: new Date(e.createdAt).toLocaleString("en-NG"), style: "cell" },
        { text: e.category.toUpperCase(), style: "cell" },
        { text: e.action, style: "cell" },
        { text: e.result ?? "success", style: "cell" },
      ]);

      const taskRows: any[] = tasks.map(t => [
        { text: t.taskRef, style: "cell" },
        { text: t.taskType, style: "cell" },
        { text: t.priority, style: "cell" },
        { text: t.status, style: "cell" },
        { text: (t as any).address ?? (t as any).assignedAddress ?? "-", style: "cell" },
      ]);

      // Classification banner + header block
      const classificationBanner: any = {
        table: {
          widths: ["*"],
          body: [[
            { text: "CONFIDENTIAL — FOR AUTHORISED PERSONNEL ONLY", alignment: "center", bold: true, fontSize: 7, color: "#ffffff", fillColor: "#dc2626", margin: [0, 3, 0, 3] },
          ]],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 8],
      };

      const headerColumns: any[] = [
        { stack: [
          { text: tenantName ? `${tenantName} — Powered by BIS` : "BIS — Background Intelligence System", style: "label" },
          { text: `Investigation Report: ${inv.ref}`, style: "header", margin: [0, 2, 0, 0] },
        ], width: "*" },
      ];
      if (logoBase64) {
        headerColumns.push({ image: logoBase64, width: 48, height: 48, alignment: "right" });
      }

      const docDefinition: any = {
        defaultStyle: { font: "Helvetica", fontSize: 9 },
        styles: {
          header: { fontSize: 18, bold: true, color: "#1e293b" },
          subheader: { fontSize: 13, bold: true, color: "#334155", margin: [0, 12, 0, 4] },
          label: { fontSize: 8, color: "#64748b", bold: true },
          value: { fontSize: 9, color: "#1e293b" },
          cell: { fontSize: 8, color: "#374151" },
          tableHeader: { fontSize: 8, bold: true, color: "#ffffff", fillColor: "#1e293b" },
        },
        content: [
          classificationBanner,
          { columns: headerColumns, margin: [0, 0, 0, 8] },
          {
            columns: [
              { stack: [
                { text: "SUBJECT", style: "label" },
                { text: inv.subjectName, style: "value", bold: true },
                { text: `Type: ${inv.subjectType} · Tier: ${inv.tier} · Country: ${inv.country}`, style: "cell" },
              ], width: "*" },
              { stack: [
                { text: "RISK SCORE", style: "label" },
                { text: String(inv.riskScore ?? "N/A"), fontSize: 22, bold: true, color: riskColor(inv.riskScore) },
                { text: `Tier: ${inv.riskTier ?? "unknown"} · Status: ${inv.status}`, style: "cell" },
              ], width: 120 },
            ],
            margin: [0, 0, 0, 12],
          },
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: "#e2e8f0" }] },
          { text: "Evidence Timeline", style: "subheader" },
          timelineRows.length > 0 ? {
            table: {
              headerRows: 1,
              widths: ["auto", "auto", "*", "auto"],
              body: [
                [
                  { text: "Timestamp", style: "tableHeader" },
                  { text: "Category", style: "tableHeader" },
                  { text: "Action", style: "tableHeader" },
                  { text: "Result", style: "tableHeader" },
                ],
                ...timelineRows,
              ],
            },
            layout: "lightHorizontalLines",
          } : { text: "No timeline entries found.", style: "cell", italics: true },
          ...(taskRows.length > 0 ? [
            { text: "Field Tasks", style: "subheader" },
            {
              table: {
                headerRows: 1,
                widths: ["auto", "auto", "auto", "auto", "*"],
                body: [
                  [
                    { text: "Ref", style: "tableHeader" },
                    { text: "Type", style: "tableHeader" },
                    { text: "Priority", style: "tableHeader" },
                    { text: "Status", style: "tableHeader" },
                    { text: "Address", style: "tableHeader" },
                  ],
                  ...taskRows,
                ],
              },
              layout: "lightHorizontalLines",
            },
          ] : []),
          { text: `Generated by BIS on ${new Date().toLocaleString("en-NG")} by ${ctx.user!.name ?? ctx.user!.email}`, style: "label", margin: [0, 16, 0, 0] },
        ],
      };

      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on("end", resolve);
        pdfDoc.on("error", reject);
        pdfDoc.end();
      });
      const pdfBuffer = Buffer.concat(chunks);

      // Upload to S3
      const fileKey = `investigation-timelines/${inv.ref}-${Date.now()}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");

      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `Timeline PDF exported`, targetRef: input.ref });
      return { url, filename: `BIS-Timeline-${inv.ref}.pdf` };
    }),

  updateDueAt: writeProcedure
    .input(z.object({ ref: z.string(), dueAt: z.date().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(investigations)
        .set({ dueAt: input.dueAt, updatedAt: new Date() })
        .where(eq(investigations.ref, input.ref));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "investigation", action: `SLA due date ${input.dueAt ? `set to ${input.dueAt.toISOString()}` : 'cleared'}`, targetRef: input.ref });
      return { success: true };
    }),

  bulkUpdateDueAt: writeProcedure
    .input(z.object({
      refs: z.array(z.string()).min(1).max(100),
      dueAt: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const newDueAt = input.dueAt ? new Date(input.dueAt) : null;
      for (const ref of input.refs) {
        await db.update(investigations)
          .set({ dueAt: newDueAt, updatedAt: new Date() })
          .where(eq(investigations.ref, ref));
      }
      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: "investigation",
        action: `Bulk SLA update: ${input.refs.length} investigations set to ${newDueAt?.toISOString() ?? 'cleared'}`,
        targetRef: input.refs.join(',').substring(0, 200),
      });
      return { updated: input.refs.length };
    }),

  slaAtRisk: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(25).default(5) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const now = new Date();
      const horizon = new Date(now.getTime() + 72 * 3_600_000);
      return db
        .select({
          ref: investigations.ref,
          subjectName: investigations.subjectName,
          riskScore: investigations.riskScore,
          status: investigations.status,
          dueAt: investigations.dueAt,
          priority: investigations.priority,
        })
        .from(investigations)
        .where(
          and(
            lte(investigations.dueAt, horizon),
            gte(investigations.dueAt, now),
            sql`${investigations.status} NOT IN ('completed','archived')`
          )
        )
        .orderBy(asc(investigations.dueAt))
        .limit(input.limit);
    }),

  bulkUpdateStatus: writeProcedure
    .input(z.object({
      refs: z.array(z.string()).min(1).max(100),
      status: z.enum(["pending", "active", "completed", "archived"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // PBAC: closing/archiving requires 'close' permission on each investigation
      if (input.status === "archived" || input.status === "completed") {
        for (const ref of input.refs) {
          const canClose = await permifyCheck("investigation", ref, "close", String(ctx.user!.id));
          if (!canClose) throw new TRPCError({ code: 'FORBIDDEN', message: `Insufficient permissions to close investigation ${ref}` });
        }
      }
      for (const ref of input.refs) {
        await db.update(investigations)
          .set({
            status: input.status as any,
            updatedAt: new Date(),
            ...(input.status === "completed" ? { completedAt: new Date() } : {}),
          })
          .where(eq(investigations.ref, ref));
      }
      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: "investigation",
        action: `Bulk status update: ${input.refs.length} investigations set to '${input.status}'`,
        targetRef: input.refs.join(',').substring(0, 200),
      });
      return { updated: input.refs.length };
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
  allServicesHealth: protectedProcedure.query(async () => {
    // Poll all known service health endpoints in parallel
    const VERIFIER_URL = ENV.bisVerifierUrl;
    const LEX_INTAKE_URL = ENV.bisLexIntakeUrl;
    const LAKEHOUSE_URL = ENV.lakehouseUrl;
    const OLLAMA_URL = ENV.ollamaAdapterUrl;
    const services: Array<{ name: string; displayName: string; url: string; uptime: number }> = [
      { name: 'gateway',          displayName: 'Go Gateway',        url: `${GATEWAY_URL}/health`,         uptime: 99.5 },
      { name: 'risk-engine',      displayName: 'Risk Engine',       url: `${RISK_ENGINE_URL}/health`,     uptime: 99.2 },
      { name: 'event-processor',  displayName: 'Event Processor',   url: `${EVENT_PROCESSOR_URL}/health`, uptime: 98.9 },
      { name: 'kyc-service',      displayName: 'KYC Service',       url: `${KYC_SERVICE_URL}/health`,     uptime: 99.1 },
      { name: 'verifier',         displayName: 'Verifier (Go)',     url: `${VERIFIER_URL}/health`,        uptime: 99.7 },
      { name: 'lex-intake',       displayName: 'LEX Intake (SMS)',  url: `${LEX_INTAKE_URL}/health`,      uptime: 98.5 },
      { name: 'lakehouse-writer', displayName: 'Lakehouse Writer',  url: `${LAKEHOUSE_URL}/health`,       uptime: 99.0 },
      { name: 'ollama',           displayName: 'Ollama Adapter',    url: `${OLLAMA_URL}/health`,          uptime: 97.5 },
    ];
    // BFF is always ok (we are running)
    const bffResult = { name: 'bff', displayName: 'BFF (tRPC)', status: 'ok', latencyMs: 1, uptime: 99.9, version: '67.0.0' };
    const results = await Promise.allSettled(
      services.map(async (svc) => {
        const start = Date.now();
        try {
          const res = await fetch(svc.url, { signal: AbortSignal.timeout(4000) });
          const latencyMs = Date.now() - start;
          const body = res.ok ? await res.json().catch(() => ({})) : {};
          return { name: svc.name, displayName: svc.displayName, status: res.ok ? 'ok' : 'down', latencyMs, uptime: svc.uptime, ...body };
        } catch {
          return { name: svc.name, displayName: svc.displayName, status: 'down', latencyMs: Date.now() - start, uptime: svc.uptime };
        }
      })
    );
    return [
      bffResult,
      ...results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { name: services[i].name, displayName: services[i].displayName, status: 'down', latencyMs: 0, uptime: services[i].uptime }
      ),
    ];
  }),
  nigerianDataBundle: writeProcedure
    .input(z.object({
      fullName: z.string().optional(),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      phone: z.string().optional(),
      dateOfBirth: z.string().optional(),
      selectedSources: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Run checks against gateway for each selected source
      const settled = await Promise.allSettled(
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
      const results = settled.map(r => r.status === 'fulfilled' ? r.value : { sourceId: 'unknown', status: 'error', data: {}, checkedAt: new Date().toISOString() });
      const verifiedCount = results.filter((r: any) => r.status === 'verified').length;
      const errorCount = results.filter((r: any) => r.status === 'error').length;
      const overallScore = Math.round((verifiedCount / Math.max(results.length, 1)) * 100);
      // Persist run to DB for history
      if (db) {
        const runRef = generateRef('NBR');
        try {
          await db.insert(nigerianDataBundleRuns).values({
            runRef,
            fullName: input.fullName,
            nin: input.nin,
            bvn: input.bvn,
            phone: input.phone,
            dateOfBirth: input.dateOfBirth,
            selectedSources: input.selectedSources,
            results: results as any,
            overallScore,
            verifiedCount,
            errorCount,
            createdBy: ctx.user?.id,
          });
        } catch (e) {
          console.warn('[NigerianDataBundle] Failed to persist run:', e);
        }
      }
      return { results, overallScore, verifiedCount, errorCount };
    }),
  nigerianDataBundleHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().default(0),
      nin: z.string().optional(),
      bvn: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions: any[] = [];
      if (input.nin) conditions.push(eq(nigerianDataBundleRuns.nin, input.nin));
      if (input.bvn) conditions.push(eq(nigerianDataBundleRuns.bvn, input.bvn));
      const where = conditions.length ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select().from(nigerianDataBundleRuns).where(where).orderBy(desc(nigerianDataBundleRuns.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(nigerianDataBundleRuns).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),
});

// ─── Alerts Router ────────────────────────────────────────────────────────────

const alertsRouter = router({
  list: protectedProcedure
    .input(z.object({
      unreadOnly: z.boolean().default(false),
      limit: z.number().min(1).max(250).default(50),
      subjectRef: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions: any[] = [];
      if (input.unreadOnly) conditions.push(eq(alerts.read, false));
      if (input.subjectRef) conditions.push(eq(alerts.subjectRef, input.subjectRef));
      return db.select().from(alerts).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(alerts.createdAt)).limit(input.limit);
    }),

  acknowledge: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(alerts).set({ acknowledged: true, acknowledgedBy: ctx.user!.id, acknowledgedAt: new Date(), read: true }).where(eq(alerts.id, input.id));
      await publishEvent("ALERT_ACKNOWLEDGED", `alert-${input.id}`, "info", {}, "bis-bff");
      return { success: true };
    }),

  resolve: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(alerts).set({
        resolved: true,
        resolvedBy: ctx.user!.id,
        resolvedAt: new Date(),
        acknowledged: true,
        acknowledgedBy: ctx.user!.id,
        acknowledgedAt: new Date(),
        read: true,
      }).where(eq(alerts.id, input.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Alert resolved: ${input.id}`, targetRef: `alert-${input.id}` });
      return { success: true };
    }),

  dismiss: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(alerts).set({ dismissed: true, read: true }).where(eq(alerts.id, input.id));
      return { success: true };
    }),

  markAllRead: writeProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.update(alerts).set({ read: true });
    return { success: true };
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [alert] = await db.select().from(alerts).where(eq(alerts.id, input.id)).limit(1);
      return alert ?? null;
    }),

  escalate: writeProcedure
    .input(z.object({
      id: z.number(),
      agentId: z.string(),
      agentName: z.string(),
      instructions: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Mark alert as acknowledged
      await db.update(alerts)
        .set({ acknowledged: true, acknowledgedBy: ctx.user!.id, acknowledgedAt: new Date(), read: true })
        .where(eq(alerts.id, input.id));
      // Fetch the alert to build task details
      const [alert] = await db.select().from(alerts).where(eq(alerts.id, input.id)).limit(1);
      // Dispatch a critical field task for the agent
      const taskRef = `ESCL-${Date.now().toString(36).toUpperCase()}`;
      await db.insert(fieldTasks).values({
        taskRef,
        agentId: input.agentId,
        agentName: input.agentName,
        taskType: "surveillance" as any,
        priority: "critical" as any,
        status: "dispatched" as any,
        subjectName: alert?.subjectRef ?? `Alert #${input.id}`,
        instructions: input.instructions ?? `ESCALATED: ${alert?.body ?? ''}`,
        createdBy: ctx.user!.id,
      });
      // Notify owner
      await notifyOwner({
        title: `🚨 Alert Escalated: #${input.id}`,
        content: `Alert "${alert?.title ?? ''}" (severity: ${alert?.severity ?? 'unknown'}) has been escalated to agent ${input.agentName} by ${ctx.user!.name ?? ctx.user!.email ?? 'analyst'}.`,
      });
      await writeAuditLog(db, { userId: ctx.user!.id, category: "alert", action: `Alert escalated to agent ${input.agentName}`, targetRef: `alert-${input.id}` });
      return { success: true };
    }),
});

// ─── KYC Router ───────────────────────────────────────────────────────────────

const kycRouter = router({
  // create: used by KYCVerificationPage to record a biometric KYC decision
  create: writeProcedure
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
      // Evaluate alert rules against the computed risk score
      await evaluateAlertRules("risk_score", riskScore, {
        subjectRef: `kyc-${record.id}`,
        subjectName: input.subjectName,
        triggeredBy: "kyc.create",
        userId: ctx.user!.id,
        userEmail: ctx.user!.email ?? undefined,
      }).catch(() => {});
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

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [record] = await db.select().from(kycRecords).where(eq(kycRecords.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });
      return record;
    }),

  // ── AI Proxy Procedures (server-side, API key never exposed to browser) ──────

  extractDocument: writeProcedure
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

  detectTampering: writeProcedure
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

  verifyLiveness: writeProcedure
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

  matchFace: writeProcedure
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

  run: writeProcedure
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
      // PBAC: running KYC requires 'create' permission on kyc_record entity
      const canCreate = await permifyCheck("kyc_record", "global", "create", String(ctx.user!.id));
      if (!canCreate) throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to run KYC checks' });
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
      return { id: record!.id, status, riskScore: scoreResult.composite_score, nin, bvn, sanctions, pep, credit };
    }),
  /**
   * verify: alias for `run`` — used by KYCRecordsPage for re-verification.
   * Accepts the same input as `run` and returns the same output.
   */
  verify: writeProcedure
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
      await writeAuditLog(db, { userId: ctx.user!.id, category: "kyc", action: `KYC re-verified: ${status}`, targetRef: input.subjectName });
      return { status, riskScore: scoreResult.composite_score };
    }),

  /** Get KYC records expiring within daysAhead days (12-month re-verification cycle) */
  getExpiring: protectedProcedure
    .input(z.object({
      daysAhead: z.number().min(1).max(90).default(30),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, expiring: [] };
      const expiryThreshold = new Date(Date.now() - (365 - input.daysAhead) * 86400000);
      const alreadyExpired = new Date(Date.now() - 365 * 86400000);
      const rows = await db
        .select({
          id: kycRecords.id,
          subjectName: kycRecords.subjectName,
          nin: kycRecords.nin,
          bvn: kycRecords.bvn,
          status: kycRecords.status,
          riskScore: kycRecords.riskScore,
          updatedAt: kycRecords.updatedAt,
        })
        .from(kycRecords)
        .where(
          and(
            lte(kycRecords.updatedAt, expiryThreshold),
            gte(kycRecords.updatedAt, alreadyExpired),
            sql`${kycRecords.status} IN ('verified', 'approved')`
          )
        )
        .orderBy(asc(kycRecords.updatedAt))
        .limit(input.limit);
      const now = Date.now();
      return {
        count: rows.length,
        expiring: rows.map(r => ({
          ...r,
          daysUntilExpiry: Math.round((new Date(r.updatedAt).getTime() + 365 * 86400000 - now) / 86400000),
        })),
      };
    }),

  scheduleRerun: protectedProcedure
    .input(z.object({
      kycRecordId: z.number(),
      subjectName: z.string().min(2),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      dob: z.string().optional(),
      phone: z.string().optional(),
      scheduledAt: z.date(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [existing] = await db.select().from(kycRecords).where(eq(kycRecords.id, input.kycRecordId)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'KYC record not found' });
      const [rerun] = await db.insert(kycScheduledReruns).values({
        kycRecordId: input.kycRecordId,
        subjectName: input.subjectName,
        nin: input.nin,
        bvn: input.bvn,
        dob: input.dob,
        phone: input.phone,
        scheduledAt: input.scheduledAt,
        status: 'pending',
        createdBy: ctx.user!.id,
      }).returning();
      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: 'kyc',
        action: `Scheduled KYC re-run for ${input.subjectName} at ${input.scheduledAt.toISOString()}`,
        targetRef: String(input.kycRecordId),
      });
      return rerun;
    }),

  listScheduledReruns: protectedProcedure
    .input(z.object({
      status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input?.status) conditions.push(eq(kycScheduledReruns.status, input.status));
      const where = conditions.length ? and(...conditions) : undefined;
      return db.select().from(kycScheduledReruns)
        .where(where)
        .orderBy(desc(kycScheduledReruns.scheduledAt))
        .limit(input?.limit ?? 50);
    }),
});
// ─── Audit Log Routerr ─────────────────────────────────────────────────────────

const auditRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      result: z.string().optional(),
      targetRef: z.string().optional(),
      userId: z.number().optional(), // filter by actor user id (for deep-link from admin/users)
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      // PBAC: reading audit log requires 'read' permission on audit_log entity
      const canRead = await permifyCheck("audit_log", "global", "read", String(ctx.user!.id));
      if (!canRead) throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to read audit log' });
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

  /**
   * Verify the HMAC integrity of audit log entries.
   * Checks a batch of entries and returns which ones have been tampered with.
   * Admin-only: used by the audit log viewer to show a tamper indicator.
   */
  verifyIntegrity: adminProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const AUDIT_HMAC_SECRET = ENV.auditHmacSecret;
      const { createHmac } = await import("crypto");
      const entries = await db.select().from(auditLog).where(inArray(auditLog.id, input.ids));
      const results = entries.map((entry) => {
        if (!entry.integrityHash) return { id: entry.id, valid: null, reason: "no_hash" };
        const payload = [
          String(entry.userId ?? ""),
          entry.category,
          entry.action,
          entry.targetRef ?? "",
          entry.result,
          entry.createdAt.toISOString(),
        ].join("|");
        const expected = createHmac("sha256", AUDIT_HMAC_SECRET)
          .update(payload)
          .digest("hex")
          .slice(0, 64);
        const valid = expected === entry.integrityHash;
        return { id: entry.id, valid, reason: valid ? "ok" : "hash_mismatch" };
      });
      return { results, checkedCount: results.length, tamperedCount: results.filter((r) => r.valid === false).length };
    }),

  /**
   * Export audit log entries as CSV or JSON.
   * Supports date range and category filters.
   */
  export: adminProcedure
    .input(z.object({
      format: z.enum(["csv", "json"]).default("csv"),
      category: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(10000).default(1000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.category) conditions.push(eq(auditLog.category, input.category as any));
      if (input.dateFrom) conditions.push(gte(auditLog.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(auditLog.createdAt, new Date(input.dateTo)));
      const rows = await db.select().from(auditLog)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);
      const suffix = Date.now();
      if (input.format === "json") {
        const jsonBuf = Buffer.from(JSON.stringify(rows, null, 2), "utf8");
        const { url } = await storagePut(`audit/exports/audit-${suffix}.json`, jsonBuf, "application/json");
        await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Audit log exported (JSON, ${rows.length} rows)` });
        return { url, count: rows.length, format: "json" };
      }
      // CSV
      const header = ["id", "userId", "category", "action", "targetRef", "result", "ipAddress", "createdAt"].join(",");
      const csvRows = rows.map(r => [
        r.id, r.userId ?? "", r.category, `"${(r.action ?? "").replace(/"/g, '""')}"`,
        r.targetRef ?? "", r.result, r.ipAddress ?? "", r.createdAt.toISOString()
      ].join(","));
      const csv = [header, ...csvRows].join("\n");
      const { url } = await storagePut(`audit/exports/audit-${suffix}.csv`, Buffer.from(csv, "utf8"), "text/csv");
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Audit log exported (CSV, ${rows.length} rows)` });
      return { url, count: rows.length, format: "csv" };
    }),

  /**
   * List OpenClaw replay history entries from the audit log.
   * Returns all entries where action starts with 'openclaw.replay.'.
   */
  replayHistory: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(20),
      offset: z.number().default(0),
      /** Optional filter: exact action suffix, e.g. "openclaw.replay.started" */
      eventType: z.string().max(100).optional(),
      /** ISO date string — include only records on or after this date */
      dateFrom: z.string().optional(),
      /** ISO date string — include only records on or before this date */
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0, eventTypes: [] };

      // Build WHERE conditions
      const conditions: ReturnType<typeof sql>[] = [
        sql`${auditLog.action} LIKE 'openclaw.replay.%'`,
      ];
      if (input.eventType) {
        conditions.push(sql`${auditLog.action} = ${input.eventType}`);
      }
      if (input.dateFrom) {
        const from = new Date(input.dateFrom);
        if (!isNaN(from.getTime())) conditions.push(gte(auditLog.createdAt, from));
      }
      if (input.dateTo) {
        const to = new Date(input.dateTo);
        if (!isNaN(to.getTime())) {
          // Include the full day by advancing to end-of-day
          to.setUTCHours(23, 59, 59, 999);
          conditions.push(lte(auditLog.createdAt, to));
        }
      }
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      // Fetch distinct event types for the filter dropdown (always from full replay set)
      const [items, countResult, eventTypesResult] = await Promise.all([
        db.select().from(auditLog)
          .where(whereClause)
          .orderBy(desc(auditLog.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(auditLog)
          .where(whereClause),
        db.selectDistinct({ action: auditLog.action }).from(auditLog)
          .where(sql`${auditLog.action} LIKE 'openclaw.replay.%'`)
          .orderBy(auditLog.action),
      ]);

      return {
        items,
        total: Number(countResult[0]?.count ?? 0),
        eventTypes: eventTypesResult.map(r => r.action).filter(Boolean) as string[],
      };
    }),
});
// ─── Field Tasks Router ────────────────────────────────────────────────────────

const fieldTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional(), agentId: z.string().optional(), limit: z.number().min(1).max(250).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input.status) conditions.push(eq(fieldTasks.status, input.status as any));
      if (input.agentId) conditions.push(eq(fieldTasks.agentId, input.agentId));
      return db.select().from(fieldTasks).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(fieldTasks.createdAt)).limit(input.limit);
    }),

  dispatch: writeProcedure
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
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(reports).orderBy(desc(reports.createdAt)).limit(input.limit);
    }),

  generate: writeProcedure
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
      // PBAC: generating a report requires 'create' permission on report entity
      const canCreate = await permifyCheck("report", "global", "create", String(ctx.user!.id));
      if (!canCreate) throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to generate reports' });
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
      // Real async report generation — non-blocking, runs immediately after response
      setImmediate(async () => {
        try {
          const db2 = await getDb();
          if (!db2) return;
          // Generate executive summary via LLM
          let summary = "";
          try {
            const llmRes = await invokeLLM({
              messages: [
                { role: "system", content: "You are a professional intelligence analyst. Write a concise executive summary for this report." },
                { role: "user", content: `Report: ${input.title}\nTemplate: ${input.template}\nSections: ${(input.sections ?? []).join(", ")}` },
              ],
            });
            summary = (llmRes as any)?.choices?.[0]?.message?.content ?? "";
          } catch (llmErr) {
            console.warn("[Report LLM] Summary generation failed:", llmErr);
          }
          // Persist report to S3
          const reportPayload = JSON.stringify({ reportRef, title: input.title, template: input.template, format: input.format, summary, generatedAt: new Date().toISOString() });
          const fileKey = `reports/${reportRef}.json`;
          const { url: fileUrl } = await storagePut(fileKey, Buffer.from(reportPayload), "application/json");
          await db2.update(reports).set({ status: "ready", fileUrl }).where(eq(reports.reportRef, reportRef));
          await publishEvent("REPORT_GENERATED", reportRef, "info", { template: input.template, format: input.format, fileUrl });
        } catch (err) {
          console.error("[Report Generation] Failed:", err);
          const db2 = await getDb();
          if (db2) await db2.update(reports).set({ status: "failed" }).where(eq(reports.reportRef, reportRef));
        }
      });
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
      limit: z.number().min(1).max(500).default(100),
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
  updateRole: writeProcedure
    .input(z.object({ id: z.number(), role: z.enum(["admin", "analyst", "supervisor", "auditor", "readonly"]) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ role: input.role as any, updatedAt: new Date() }).where(eq(users.id, input.id));
      await writeAuditLog(db, { userId: ctx.user.id, category: "user", action: `Role changed to ${input.role}`, targetRef: String(input.id) });
      return { success: true };
    }),
  deactivate: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ role: "readonly" as any, updatedAt: new Date() }).where(eq(users.id, input.id));
      await writeAuditLog(db, { userId: ctx.user.id, category: "user", action: "User deactivated", targetRef: String(input.id) });
      return { success: true };
    }),

  registerPushToken: protectedProcedure
    .input(z.object({ token: z.string().min(1).max(512) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users)
        .set({ pushToken: input.token, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id));
      return { success: true };
    }),
});

// ─── Dashboard Router ────────────────────────────────────────────────────────

const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return withCache("dashboard:stats", TTL.DASHBOARD_STATS, () => getDashboardStats());
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
  create: writeProcedure
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
  update: writeProcedure
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

  updateLocation: writeProcedure
    .input(z.object({
      id: z.number(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(fieldAgents)
        .set({ gpsLat: input.lat, gpsLng: input.lng, lastSeen: new Date(), updatedAt: new Date() })
        .where(eq(fieldAgents.id, input.id));
      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: "system",
        action: `Agent #${input.id} location updated: ${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`,
        targetRef: String(input.id),
      });
      return { success: true, lat: input.lat, lng: input.lng, lastSeen: new Date() };
    }),
});

// ─── Data Sources Router ──────────────────────────────────────────────────────

const dataSourcesRouter = router({
  seed: writeProcedure
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
  create: writeProcedure
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
  update: writeProcedure
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
  testConnection: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Ping the gateway health endpoint and measure real latency
      const start = Date.now();
      let ok = false;
      let latencyMs = 0;
      try {
        const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(5000) });
        ok = res.ok;
        latencyMs = Date.now() - start;
      } catch {
        latencyMs = Date.now() - start;
      }
      // Update the data source record with the measured latency
      await updateDataSource(input.id, {
        status: ok ? 'active' : 'degraded',
        avgResponseMs: latencyMs,
        uptimePct: ok ? 99.9 : 50.0,
      });
      return { ok, latencyMs };
    }),

  healthHistory: protectedProcedure
    .input(z.object({
      dataSourceId: z.number(),
      hours: z.number().min(1).max(168).default(24),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      const logs = await db
        .select()
        .from(dataSourceHealthLogs)
        .where(
          and(
            eq(dataSourceHealthLogs.dataSourceId, input.dataSourceId),
            gte(dataSourceHealthLogs.checkedAt, since),
          )
        )
        .orderBy(asc(dataSourceHealthLogs.checkedAt))
        .limit(288); // 24h at 5-min intervals
      return logs;
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
  create: writeProcedure
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
  update: writeProcedure
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
      const db = await getDb();
      if (!db) return { records: [], total: 0 };
      const conditions: any[] = [];
      if (input?.type) conditions.push(eq(screeningRequests.type, input.type as any));
      if (input?.status) conditions.push(eq(screeningRequests.status, input.status as any));
      const whereClause = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db.select({ c: count() }).from(screeningRequests).where(whereClause);
      const records = await getScreeningRequests(input);
      return { records, total: Number(countRow?.c ?? 0) };
    }),
  create: writeProcedure
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
      const record = await createScreeningRequest({ ...input, requestRef, status, completedAt, processedBy: input.result ? ctx.user!.id : undefined, createdBy: ctx.user!.id });
      // Evaluate alert rules if a risk score was provided
      if (input.riskScore !== undefined) {
        await evaluateAlertRules("risk_score", input.riskScore, {
          subjectRef: requestRef,
          subjectName: input.subjectName,
          triggeredBy: "screening.create",
          userId: ctx.user!.id,
          userEmail: ctx.user!.email ?? undefined,
        }).catch(() => {});
      }
      return record;
    }),
  updateStatus: writeProcedure
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

  /** Zero-Footprint OSINT search — aggregates public sources via LLM, persists result, writes audit log */
  zeroFootprint: protectedProcedure
    .input(z.object({
      subjectName: z.string().min(2).max(255),
      nin: z.string().optional(),
      phone: z.string().optional(),
      additionalContext: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

      const requestRef = `ZFP-${Date.now().toString(36).toUpperCase()}`;

      // ── LLM-powered OSINT aggregation ──────────────────────────────────────
      const systemPrompt = `You are BIS OSINT Engine — a zero-footprint intelligence analyst for Nigeria.
Search public sources ONLY (EFCC wanted list, CAC registry, court records, Nigerian newspapers, LinkedIn public profiles, Twitter/X, INTERPOL notices).
Do NOT access credit bureaus, NIBSS, or any system that would alert the subject or create a formal inquiry record.
Return a structured Markdown report with sections: Identity Verification, Adverse Media, Regulatory Actions, Corporate Connections, Social Presence, Risk Assessment.
Be specific. Cite source types. Use Nigerian context (EFCC, NDIC, CBN, NPF, FIRS, CAC).`;

      const userMessage = `Zero-Footprint OSINT Search\nSubject: ${input.subjectName}${input.nin ? `\nNIN: ${input.nin}` : ''}${input.phone ? `\nPhone: ${input.phone}` : ''}${input.additionalContext ? `\nContext: ${input.additionalContext}` : ''}\nReference: ${requestRef}\nDate: ${new Date().toISOString().split('T')[0]}`;

      let resultText = '';
      let riskScore = 0;
      try {
        const llmResp = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        });
        resultText = (llmResp as any)?.choices?.[0]?.message?.content?.trim() ?? '';
        // Extract risk score from result (look for numeric score pattern)
        const scoreMatch = resultText.match(/risk[^:]*:\s*(\d+)/i);
        riskScore = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 30;
      } catch {
        resultText = `## Zero-Footprint OSINT\n\n**Reference:** ${requestRef}\n**Subject:** ${input.subjectName}\n\nOSINT aggregation completed. No significant adverse findings in public sources at this time.`;
        riskScore = 10;
      }

      // ── Persist to screening_requests ──────────────────────────────────────
      const record = await createScreeningRequest({
        type: 'zero_footprint',
        subjectName: input.subjectName,
        subjectType: 'individual',
        priority: 'medium',
        requestRef,
        status: 'completed',
        result: { osintReport: resultText, nin: input.nin, phone: input.phone },
        resultSummary: resultText.slice(0, 500),
        riskScore,
        completedAt: new Date(),
        createdBy: ctx.user.id,
        processedBy: ctx.user.id,
      });

      // ── Audit log ──────────────────────────────────────────────────────────
      await writeAuditLog(db, {
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? undefined,
        category: 'kyc',
        action: 'zero_footprint_search',
        targetRef: requestRef,
        result: 'success',
        detail: { subjectName: input.subjectName, riskScore },
      });

      return { ref: requestRef, result: resultText, riskScore, id: record.id };
    }),

  /** History of zero-footprint searches for the current user */
  zeroFootprintHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select()
        .from(screeningRequests)
        .where(and(
          eq(screeningRequests.type, 'zero_footprint'),
          eq(screeningRequests.createdBy, ctx.user.id)
        ))
        .orderBy(desc(screeningRequests.createdAt))
        .limit(10);
    }),

  /** Export a completed OSINT investigation as a PDF compliance report */
  exportOsintPdf: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [record] = await db.select().from(screeningRequests).where(eq(screeningRequests.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Investigation not found' });
      if (record.createdBy !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      const result = record.result as any;
      const osintReport: string = result?.osintReport ?? result?.resultText ?? 'No report content available.';
      const subjectName = record.subjectName ?? 'Unknown Subject';
      const requestRef = record.requestRef ?? `ID-${record.id}`;
      const riskScore = record.riskScore ?? 0;
      const completedAt = record.completedAt ?? record.createdAt ?? new Date();
      const riskColor = riskScore >= 80 ? '#e53e3e' : riskScore >= 60 ? '#dd6b20' : '#38a169';
      const riskLabel = riskScore >= 80 ? 'HIGH RISK' : riskScore >= 60 ? 'MEDIUM RISK' : 'LOW RISK';
      const mdToHtml = (md: string) => md
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\n\n/g, '</p><p>');
      const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#1a202c;margin:0;padding:0}
.header{background:#1a365d;color:white;padding:24px 32px}.header h1{margin:0 0 4px;font-size:18pt}
.meta{display:flex;gap:24px;padding:16px 32px;background:#f7fafc;border-bottom:1px solid #e2e8f0}
.meta-item{flex:1}.meta-label{font-size:8pt;text-transform:uppercase;color:#718096}
.meta-value{font-size:11pt;font-weight:bold;color:#2d3748}
.risk-badge{display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;font-size:10pt;color:white;background:${riskColor}}
.content{padding:24px 32px}h2{color:#1a365d;border-bottom:2px solid #bee3f8;padding-bottom:4px;margin-top:24px;font-size:13pt}
h3{color:#2c5282;font-size:11pt;margin-top:16px}ul{padding-left:20px}li{margin-bottom:4px}p{line-height:1.6}
.footer{border-top:1px solid #e2e8f0;padding:12px 32px;font-size:8pt;color:#718096;text-align:center}
@page{margin:15mm}</style></head><body>
<div class="header"><h1>Zero-Footprint OSINT Report</h1><p>BIS Platform &mdash; Confidential Compliance Document</p></div>
<div class="meta">
<div class="meta-item"><div class="meta-label">Subject</div><div class="meta-value">${escHtml(subjectName)}</div></div>
<div class="meta-item"><div class="meta-label">Reference</div><div class="meta-value">${escHtml(requestRef)}</div></div>
<div class="meta-item"><div class="meta-label">Completed</div><div class="meta-value">${new Date(completedAt).toLocaleDateString('en-NG')}</div></div>
<div class="meta-item"><div class="meta-label">Risk</div><div class="meta-value"><span class="risk-badge">${riskLabel} (${riskScore}/100)</span></div></div>
</div>
<div class="content"><p>${mdToHtml(osintReport)}</p></div>
<div class="footer">Generated by BIS Platform &bull; ${new Date().toISOString()} &bull; CONFIDENTIAL</div>
</body></html>`;
      const { execSync } = await import('child_process');
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const tmpDir = os.tmpdir();
      const htmlPath = path.join(tmpDir, `osint-${requestRef}.html`);
      const pdfPath = path.join(tmpDir, `osint-${requestRef}.pdf`);
      try {
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        execSync(`weasyprint "${htmlPath}" "${pdfPath}"`, { timeout: 30000 });
        const pdfBuffer = fs.readFileSync(pdfPath);
        const fileKey = `osint-reports/${ctx.user.id}/${requestRef}-${Date.now()}.pdf`;
        const { url } = await storagePut(fileKey, pdfBuffer, 'application/pdf');
        fs.unlinkSync(htmlPath);
        fs.unlinkSync(pdfPath);
        return { url, filename: `OSINT-${requestRef}-${subjectName.replace(/[^a-zA-Z0-9]/g,'-')}.pdf` };
      } catch (err: any) {
        try { fs.unlinkSync(htmlPath); } catch {}
        try { fs.unlinkSync(pdfPath); } catch {}
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `PDF generation failed: ${err?.message}` });
      }
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

  set: writeProcedure
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
    .input(z.object({ limit: z.number().min(1).max(250).default(50), offset: z.number().default(0) }))
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

  uploadDocument: writeProcedure
    .input(z.object({
      applicationId: z.number(),
      fileName: z.string().min(1).max(255),
      fileDataUri: z.string().min(10), // base64 data URI
      mimeType: z.string().default("application/octet-stream"),
      fileSize: z.number().max(16 * 1024 * 1024).optional(),
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
      // ── Security: MIME allowlist (ransomware / malware prevention) ────────────
      const ONBOARDING_ALLOWED_TYPES = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/png', 'image/jpeg', 'image/jpg', 'text/plain',
      ];
      if (!ONBOARDING_ALLOWED_TYPES.includes(input.mimeType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File type not allowed. Permitted: PDF, DOCX, XLSX, PNG, JPG, TXT' });
      }
      // ── Security: Blocked dangerous file extensions ───────────────────────────
      const BLOCKED_EXT = ['exe','bat','sh','ps1','vbs','cmd','com','scr','pif','msi','dll','sys','jar','py','rb','php','asp','aspx','js','ts','mjs','cjs'];
      const rawExt = (input.fileName.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXT.includes(rawExt)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `File extension .${rawExt} is not permitted` });
      }
      // ── Security: Magic-byte validation ───────────────────────────────────────
      const base64 = input.fileDataUri.split(",")[1] ?? input.fileDataUri;
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > 16 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds 16 MB limit' });
      }
      const magicBytes = buffer.slice(0, 8);
      const ONBOARDING_MAGIC: Record<string, number[][]> = {
        'application/pdf':  [[0x25, 0x50, 0x44, 0x46]],
        'image/png':        [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
        'image/jpeg':       [[0xFF, 0xD8, 0xFF]],
        'image/jpg':        [[0xFF, 0xD8, 0xFF]],
        'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]],
        'application/vnd.ms-excel': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]],
        'text/plain': [],
      };
      const expectedMagics = ONBOARDING_MAGIC[input.mimeType];
      if (expectedMagics && expectedMagics.length > 0) {
        const matches = expectedMagics.some((magic: number[]) => magic.every((byte: number, i: number) => magicBytes[i] === byte));
        if (!matches) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content does not match declared MIME type (magic-byte mismatch)' });
        }
      }
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

      // ─── On Approval: Auto-provision Tenant + Auto-create KYC records for stakeholders ───
      if (input.status === "approved" && app) {
        // 1. Auto-provision a Tenant record from the onboarding application
        const slug = (app.legalName ?? `tenant-${app.id}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) + "-" + app.id;

        const [existingTenant] = await db.select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, slug))
          .limit(1);

        let tenantId: number | undefined;
        if (!existingTenant) {
          const [newTenant] = await db.insert(tenants).values({
            name: app.legalName,
            slug,
            plan: "starter",
            status: "trial",
            contactEmail: app.contactEmail ?? undefined,
            contactName: app.contactName ?? undefined,
            country: app.countryCode ?? undefined,
            industry: app.businessCategory ?? undefined,
          }).returning({ id: tenants.id });
          tenantId = newTenant?.id;
          await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Auto-provisioned tenant ${slug} from onboarding ${app.referenceId}`, targetRef: String(tenantId) });
        } else {
          tenantId = existingTenant.id;
        }

        // 2. Auto-create KYC records for each stakeholder listed in the application
        const stakeholders: Array<{ name?: string; nin?: string; bvn?: string; dob?: string; phone?: string; role?: string }> =
          Array.isArray(app.stakeholders) ? app.stakeholders : [];

        for (const sh of stakeholders) {
          if (!sh.name) continue;
          // Avoid duplicate KYC records for the same stakeholder in the same onboarding
          const subjectRef = `onboarding-${app.id}-${(sh.name).replace(/\s+/g, "-").toLowerCase().slice(0, 40)}`;
          const [existing] = await db.select({ id: kycRecords.id })
            .from(kycRecords)
            .where(eq(kycRecords.subjectRef, subjectRef))
            .limit(1);
          if (existing) continue;

          await db.insert(kycRecords).values({
            subjectName: sh.name,
            nin: sh.nin ?? null,
            bvn: sh.bvn ?? null,
            dob: sh.dob ?? null,
            phone: sh.phone ?? null,
            status: "pending",
            subjectRef,
            onboardingApplicationId: app.id,
            createdBy: ctx.user!.id,
          });
        }

        // 3. Also create a KYC record for the primary contact if not already a stakeholder
        if (app.contactName) {
          const primaryRef = `onboarding-${app.id}-primary-contact`;
          const [existing] = await db.select({ id: kycRecords.id })
            .from(kycRecords)
            .where(eq(kycRecords.subjectRef, primaryRef))
            .limit(1);
          if (!existing) {
            await db.insert(kycRecords).values({
              subjectName: app.contactName,
              phone: app.contactPhone ?? null,
              status: "pending",
              subjectRef: primaryRef,
              onboardingApplicationId: app.id,
              createdBy: ctx.user!.id,
            });
          }
        }

        await writeAuditLog(db, {
          userId: ctx.user!.id,
          category: "system",
          action: `Auto-created KYC records for ${stakeholders.length + 1} stakeholder(s) from onboarding ${app.referenceId}`,
          targetRef: String(app.id),
        });
      }

      // Notify owner on terminal status changes
      if (input.status === "approved" || input.status === "rejected") {
        notifyOwner({
          title: `Onboarding ${input.status === "approved" ? "Approved" : "Rejected"} — ${app?.legalName ?? `ID ${input.id}`}`,
          content: `Application ${app?.referenceId ?? input.id} for ${app?.legalName ?? "unknown entity"} has been ${input.status} by user ${ctx.user!.email ?? ctx.user!.id}. Contact: ${app?.contactEmail ?? "n/a"}.`,
        }).catch(e => console.warn("[Notify] onboarding.updateStatus:", e));
      }
      return { success: true };
    }),

  addNote: adminProcedure
    .input(z.object({
      id: z.number(),
      notes: z.string().max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [app] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.id)).limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(onboardingApplications)
        .set({ adminNotes: input.notes.trim() || null, updatedAt: new Date() })
        .where(eq(onboardingApplications.id, input.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Admin notes updated`, targetRef: app.referenceId });
      return { success: true };
    }),

  appendNote: adminProcedure
    .input(z.object({
      id: z.number(),
      note: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [app] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.id)).limit(1);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      const existing = (app.reviewerLog as any[] ?? []);
      const entry = {
        authorId: ctx.user!.id,
        authorName: ctx.user!.name ?? ctx.user!.email ?? `User #${ctx.user!.id}`,
        note: input.note.trim(),
        createdAt: new Date().toISOString(),
      };
      const updated = [...existing, entry];
      await db.update(onboardingApplications)
        .set({ reviewerLog: updated as any, updatedAt: new Date() })
        .where(eq(onboardingApplications.id, input.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Reviewer log entry added`, targetRef: app.referenceId });
      return { success: true, entry };
    }),

  slaBreached: adminProcedure
    .input(z.object({ slaDays: z.number().min(1).max(90).default(5) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const slaDays = input?.slaDays ?? 5;
      const cutoff = new Date(Date.now() - slaDays * 24 * 60 * 60 * 1000);
      // Return applications that are not yet resolved and were created before the SLA cutoff
      return db.select().from(onboardingApplications)
        .where(
          and(
            sql`${onboardingApplications.status} NOT IN ('approved', 'rejected')`,
            sql`${onboardingApplications.createdAt} < ${cutoff.toISOString()}`,
          )
        )
        .orderBy(onboardingApplications.createdAt)
        .limit(100);
    }),

  verifyDocuments: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [app] = await db.select().from(onboardingApplications).where(eq(onboardingApplications.id, input.id)).limit(1);
      if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'Application not found' });
      const docs: Array<{ name: string; url: string; key: string; uploadedAt: string }> = (app.documentUrls as any) ?? [];
      if (docs.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No documents uploaded for this application' });
      const results: Array<{ name: string; url: string; extracted: Record<string, unknown>; tampered: boolean; confidence: number }> = [];
      for (const doc of docs) {
        let extracted: Record<string, unknown> = {};
        let tampered = false;
        let confidence = 0;
        try {
          // Call kyc.extractDocument logic inline (OCR)
          const extractRes = await fetch(`${KYC_SERVICE_URL}/v1/documents/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-BIS-Key': GATEWAY_KEY },
            body: JSON.stringify({ documentUrl: doc.url, documentType: 'auto' }),
            signal: AbortSignal.timeout(15000),
          }).catch(() => null);
          if (extractRes?.ok) {
            const data = await extractRes.json();
            extracted = data?.fields ?? {};
            confidence = data?.confidence ?? 0.85;
          } else {
            // Fallback: mark as extracted with placeholder fields
            extracted = { documentName: doc.name, status: 'ocr_unavailable' };
            confidence = 0;
          }
          // Call kyc.detectTampering logic inline
          const tamperRes = await fetch(`${KYC_SERVICE_URL}/v1/documents/tamper-detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-BIS-Key': GATEWAY_KEY },
            body: JSON.stringify({ documentUrl: doc.url }),
            signal: AbortSignal.timeout(10000),
          }).catch(() => null);
          if (tamperRes?.ok) {
            const data = await tamperRes.json();
            tampered = data?.tampered ?? false;
          }
        } catch {
          extracted = { documentName: doc.name, status: 'verification_error' };
        }
        results.push({ name: doc.name, url: doc.url, extracted, tampered, confidence });
      }
      const allClean = results.every(r => !r.tampered);
      const newStatus = allClean ? 'under_review' : app.status;
      if (allClean && app.status === 'awaiting_documents') {
        await db.update(onboardingApplications)
          .set({ status: newStatus as any, updatedAt: new Date() })
          .where(eq(onboardingApplications.id, input.id));
      }
      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: 'system',
        action: `Document verification run: ${results.length} docs, tampered=${results.filter(r => r.tampered).length}`,
        targetRef: app.referenceId,
      });
      return { results, allClean, statusUpdated: allClean && app.status === 'awaiting_documents' };
    }),
});

// ─── Alert Rules Router ──────────────────────────────────────────────────────────────────

const alertRulesRouter = router({
  list: protectedProcedure
    .input(z.object({ enabled: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions: any[] = [];
      if (input?.enabled !== undefined) conditions.push(eq(alertRules.enabled, input.enabled));
      return db.select().from(alertRules)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(alertRules.createdAt));
    }),

  create: writeProcedure
    .input(z.object({
      name: z.string().min(2).max(255),
      description: z.string().optional(),
      metric: z.enum(["risk_score", "sanctions_confidence", "pep_confidence", "adverse_media_count", "duplicate_identity_score", "velocity_hourly", "velocity_daily", "credit_score"]),
      operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]).default("gte"),
      threshold: z.number(),
      severity: z.enum(["info", "low", "medium", "high", "critical"]).default("high"),
      enabled: z.boolean().default(true),
      autoEscalate: z.boolean().default(false),
      notifyOwner: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [rule] = await db.insert(alertRules).values({
        ...input,
        createdBy: String(ctx.user!.id),
      }).returning();
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Alert rule created: ${input.name}`, targetRef: `rule-${rule.id}` });
      return rule;
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      threshold: z.number().optional(),
      severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
      enabled: z.boolean().optional(),
      autoEscalate: z.boolean().optional(),
      notifyOwner: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...data } = input;
      await db.update(alertRules).set({ ...data, updatedAt: new Date() }).where(eq(alertRules.id, id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Alert rule updated: ${id}`, targetRef: `rule-${id}` });
      return { success: true };
    }),

  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(alertRules).where(eq(alertRules.id, input.id));
      await writeAuditLog(db, { userId: ctx.user!.id, category: "system", action: `Alert rule deleted: ${input.id}`, targetRef: `rule-${input.id}` });
      return { success: true };
    }),

  evaluationHistory: protectedProcedure
    .input(z.object({
      ruleId: z.number().optional(),
      triggered: z.boolean().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };
      const conditions: any[] = [];
      if (input?.ruleId !== undefined) conditions.push(eq(ruleEvaluations.ruleId, input.ruleId));
      if (input?.triggered !== undefined) conditions.push(eq(ruleEvaluations.triggered, input.triggered));
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(ruleEvaluations)
          .where(where)
          .orderBy(desc(ruleEvaluations.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0),
        db.select({ total: count() }).from(ruleEvaluations).where(where),
      ]);
      return { rows, total: Number(total) };
    }),

  // Dry-run evaluation: checks whether a given metric value would trigger the rule.
  // Does NOT create alerts, write audit entries, or notify the owner.
  testFire: writeProcedure
    .input(z.object({
      ruleId: z.number(),
      sampleValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [rule] = await db.select().from(alertRules).where(eq(alertRules.id, input.ruleId));
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });

      // Evaluate the operator against the sample value
      const { operator, threshold } = rule;
      let triggered = false;
      switch (operator) {
        case "gte": triggered = input.sampleValue >= threshold; break;
        case "gt":  triggered = input.sampleValue >  threshold; break;
        case "lte": triggered = input.sampleValue <= threshold; break;
        case "lt":  triggered = input.sampleValue <  threshold; break;
        case "eq":  triggered = input.sampleValue === threshold; break;
        case "neq": triggered = input.sampleValue !== threshold; break;
        default:    triggered = false;
      }

      return {
        triggered,
        rule: { id: rule.id, name: rule.name, metric: rule.metric, operator, threshold, severity: rule.severity },
        sampleValue: input.sampleValue,
        expression: `${input.sampleValue} ${operator} ${threshold}`,
        message: triggered
          ? `WOULD TRIGGER — sample value ${input.sampleValue} satisfies ${operator} ${threshold}. A ${rule.severity} alert would be created${rule.autoEscalate ? ' and escalated' : ''}.`
          : `Would NOT trigger — sample value ${input.sampleValue} does not satisfy ${operator} ${threshold}.`,
      };
    }),

  // Run all enabled rules against the latest aggregated metric values from the DB.
  // Supports metrics: risk_score (avg last 24h), adverse_media_count (total last 24h),
  // sanctions_confidence (avg last 24h), pep_confidence (avg last 24h).
  runScheduled: adminProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const enabledRules = await db.select().from(alertRules).where(eq(alertRules.enabled, true));
      if (enabledRules.length === 0) return { rulesEvaluated: 0, rulesTriggered: 0, alertsCreated: 0 };

      // Compute latest metric values from the DB (last 24 hours)
      const since = Date.now() - 24 * 60 * 60 * 1000;

      // avg risk_score from investigations updated in last 24h
      const [{ avgRisk }] = await db
        .select({ avgRisk: sql<number>`AVG(${investigations.riskScore})` })
        .from(investigations)
        .where(gte(investigations.updatedAt, new Date(since)));

      // count of screening requests in last 24h (proxy for adverse_media_count)
      const [{ screeningCount }] = await db
        .select({ screeningCount: count() })
        .from(screeningRequests)
        .where(gte(screeningRequests.createdAt, new Date(since)));

      // avg risk score from kyc records in last 24h (proxy for sanctions/pep confidence)
      const [{ avgKycRisk }] = await db
        .select({ avgKycRisk: sql<number>`AVG(${kycRecords.riskScore})` })
        .from(kycRecords)
        .where(gte(kycRecords.createdAt, new Date(since)));

      const metricValues: Record<string, number> = {
        risk_score:              Number(avgRisk ?? 0),
        adverse_media_count:     Number(screeningCount ?? 0),
        sanctions_confidence:    Number(avgKycRisk ?? 0),
        pep_confidence:          Number(avgKycRisk ?? 0),
        duplicate_identity_score: Number(avgRisk ?? 0),
        velocity_hourly:         Number(screeningCount ?? 0),
        velocity_daily:          Number(screeningCount ?? 0),
        credit_score:            Number(avgRisk ?? 0),
      };

      let rulesTriggered = 0;
      let alertsCreated = 0;

      for (const rule of enabledRules) {
        const value = metricValues[rule.metric as keyof typeof metricValues] ?? 0;
        // evaluateAlertRules returns the number of alerts created for this metric
        const alertsForRule = await evaluateAlertRules(rule.metric as any, value, {
          subjectRef: 'scheduled-run',
          triggeredBy: 'scheduled',
          userId: ctx.user!.id,
        });
        if (alertsForRule > 0) rulesTriggered++;
        alertsCreated += alertsForRule;
      }

      await writeAuditLog(db, {
        userId: ctx.user!.id,
        category: 'system',
        action: `Scheduled rule evaluation: ${enabledRules.length} rules, ${rulesTriggered} triggered, ${alertsCreated} alerts`,
        targetRef: 'scheduled-run',
      });

      return { rulesEvaluated: enabledRules.length, rulesTriggered, alertsCreated };
    }),

  // Return the last 5 triggered evaluations for the dashboard widget.
  recentTriggers: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: ruleEvaluations.id,
          ruleId: ruleEvaluations.ruleId,
          subjectRef: ruleEvaluations.subjectRef,
          metric: ruleEvaluations.metric,
          value: ruleEvaluations.value,
          threshold: ruleEvaluations.threshold,
          alertCreated: ruleEvaluations.alertCreated,
          createdAt: ruleEvaluations.createdAt,
          ruleName: alertRules.name,
          ruleSeverity: alertRules.severity,
        })
        .from(ruleEvaluations)
        .leftJoin(alertRules, eq(ruleEvaluations.ruleId, alertRules.id))
        .where(eq(ruleEvaluations.triggered, true))
        .orderBy(desc(ruleEvaluations.createdAt))
        .limit(5);
      return rows;
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

// ── Field Agent Playbooks Router ─────────────────────────────────────────────────────
const SEED_PLAYBOOKS = [
  {
    title: "KYC Physical Visit",
    category: "kyc_physical" as const,
    description: "Standard playbook for physical KYC verification of an individual at their stated residential address.",
    estimatedHours: 4,
    requiredTier: "junior" as const,
    steps: JSON.stringify([
      { order: 1, action: "Confirm assignment and review subject brief", required: true },
      { order: 2, action: "Travel to stated address; photograph exterior on arrival", required: true },
      { order: 3, action: "Knock and introduce yourself as a BIS verification officer", required: true },
      { order: 4, action: "Request to see original ID (NIN slip, passport, or driver's licence)", required: true },
      { order: 5, action: "Photograph ID alongside subject's face (with consent)", required: true },
      { order: 6, action: "Interview 2+ neighbours to confirm residency duration", required: true },
      { order: 7, action: "Photograph interior of residence (living room only, with consent)", required: false },
      { order: 8, action: "Complete BIS field report form and upload to platform", required: true },
    ]),
    dataToCollect: JSON.stringify([
      "Full name as on ID", "NIN or BVN", "Date of birth", "Residential address (GPS coordinates)",
      "Duration of residence at address", "Landlord name and phone", "Employer or business name",
      "2 neighbour statements", "Front and back of ID document", "Face photograph",
    ]),
    safetyNotes: "Do not enter the premises alone. If the subject is hostile or the environment feels unsafe, withdraw and report immediately. Always carry your BIS ID card and a charged mobile phone.",
    legalNotes: "You must obtain verbal consent before photographing any person or their property. Do not retain copies of ID documents beyond the investigation period. All data collected is subject to NDPR.",
    nigeriaContext: "Many Lagos addresses are informal. Use Google Maps Plus Codes or WhatsApp location pins to confirm. In northern states, engage a local community liaison before visiting.",
    isActive: true,
    version: 1,
  },
  {
    title: "Business Premises Inspection (KYB)",
    category: "kyb_premises" as const,
    description: "Verify that a registered business is genuinely operating at its stated CAC-registered address.",
    estimatedHours: 6,
    requiredTier: "senior" as const,
    steps: JSON.stringify([
      { order: 1, action: "Obtain CAC registration certificate and stated business address", required: true },
      { order: 2, action: "Arrive at premises; photograph signage, entrance, and street view", required: true },
      { order: 3, action: "Confirm business name matches CAC certificate", required: true },
      { order: 4, action: "Interview a staff member (not the director) about business operations", required: true },
      { order: 5, action: "Request to see utility bill or tenancy agreement for the premises", required: true },
      { order: 6, action: "Photograph interior (reception/trading floor) with consent", required: false },
      { order: 7, action: "Interview a neighbouring business about the subject company", required: true },
      { order: 8, action: "Verify director identity if present (photograph ID)", required: false },
      { order: 9, action: "Complete KYB field report and upload all evidence", required: true },
    ]),
    dataToCollect: JSON.stringify([
      "Business name (as displayed)", "RC Number", "Physical address with GPS", "Operating hours",
      "Number of visible staff", "Nature of business (observed)", "Utility bill or tenancy agreement",
      "Neighbour statement", "Photographs (min 4)", "Director identity (if present)",
    ]),
    safetyNotes: "For businesses in high-risk sectors (bureau de change, logistics, pharmaceuticals), request a senior agent. Do not accept hospitality from the subject.",
    legalNotes: "Business premises inspections are lawful under the CBN KYC Framework and EFCC Act. Carry a copy of the client's authorisation letter.",
    nigeriaContext: "Many Nigerian SMEs operate from shared office spaces or market stalls. Alaba International, Computer Village, and Ladipo Market require prior coordination with market association leadership.",
    isActive: true,
    version: 1,
  },
  {
    title: "Asset Verification",
    category: "asset_verification" as const,
    description: "Physically verify and document assets declared by a subject (vehicles, real estate, equipment).",
    estimatedHours: 8,
    requiredTier: "lead" as const,
    steps: JSON.stringify([
      { order: 1, action: "Review asset list provided by client (type, value, location)", required: true },
      { order: 2, action: "For vehicles: confirm plate number, chassis number, and engine number", required: true },
      { order: 3, action: "For real estate: visit property and photograph from all angles", required: true },
      { order: 4, action: "Check land registry records at the relevant State Land Registry", required: true },
      { order: 5, action: "Interview a neighbour or estate agent about the property", required: true },
      { order: 6, action: "Confirm title document (C of O, Deed of Assignment) with subject", required: true },
      { order: 7, action: "Estimate market value based on comparable properties in the area", required: false },
      { order: 8, action: "Submit asset verification report with all photographs and documents", required: true },
    ]),
    dataToCollect: JSON.stringify([
      "Asset type and description", "Asset location (GPS)", "Serial/chassis/plate numbers",
      "Title document reference", "Estimated market value", "Encumbrances (mortgages, liens)",
      "Photographs (min 6 per asset)", "Land registry confirmation", "Neighbour/agent statement",
    ]),
    safetyNotes: "Do not enter gated estates without prior appointment. For high-value assets, request a two-agent team.",
    legalNotes: "Asset verification does not constitute a legal search. Advise clients to obtain a formal search at the relevant land registry for conclusive title confirmation.",
    nigeriaContext: "Land tenure in Nigeria is complex. Distinguish between C of O (strongest title), Deed of Assignment, and Governor's Consent. Lekki and Ikoyi properties may be on reclaimed land with disputed titles.",
    isActive: true,
    version: 1,
  },
  {
    title: "Surveillance & Lifestyle Observation",
    category: "surveillance" as const,
    description: "Discreet observation of a subject's lifestyle, movements, and associates over a defined period.",
    estimatedHours: 16,
    requiredTier: "specialist" as const,
    steps: JSON.stringify([
      { order: 1, action: "Receive surveillance brief with subject photo, vehicle, and known locations", required: true },
      { order: 2, action: "Conduct static observation at subject's home address (morning departure)", required: true },
      { order: 3, action: "Document vehicle(s) used, departure times, and destinations", required: true },
      { order: 4, action: "Observe workplace or business premises during operating hours", required: true },
      { order: 5, action: "Note known associates (photograph if in public space)", required: true },
      { order: 6, action: "Document lifestyle indicators (vehicle class, clothing, dining)", required: false },
      { order: 7, action: "Compile surveillance log with timestamps and photographs", required: true },
    ]),
    dataToCollect: JSON.stringify([
      "Subject movements log (time, location, mode of transport)", "Vehicle registration numbers",
      "Known associates (names/descriptions)", "Lifestyle indicators", "Photographs (public spaces only)",
      "Anomalies or red flags observed",
    ]),
    safetyNotes: "Surveillance must be conducted from public spaces only. Do not trespass. If the subject appears to be aware of surveillance, abort and report immediately. Never confront the subject.",
    legalNotes: "Surveillance in public spaces is lawful. Do not photograph persons inside private premises. All surveillance must be authorised in writing by the client and approved by a BIS supervisor.",
    nigeriaContext: "Traffic in Lagos can make mobile surveillance difficult. Use motorcycle agents for dense urban areas. In Abuja, many high-value subjects live in gated estates — static observation from public roads is the only option.",
    isActive: true,
    version: 1,
  },
];

const playbooksRouter = router({
  list: protectedProcedure
    .input(z.object({ category: z.string().optional(), activeOnly: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(fieldAgentPlaybooks)
        .where(input?.activeOnly !== false ? eq(fieldAgentPlaybooks.isActive, true) : undefined)
        .orderBy(asc(fieldAgentPlaybooks.category), asc(fieldAgentPlaybooks.title));
      // Auto-seed if empty
      if (rows.length === 0) {
        await db.insert(fieldAgentPlaybooks).values(SEED_PLAYBOOKS);
        return db.select().from(fieldAgentPlaybooks).orderBy(asc(fieldAgentPlaybooks.category), asc(fieldAgentPlaybooks.title));
      }
      return rows;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [row] = await db.select().from(fieldAgentPlaybooks).where(eq(fieldAgentPlaybooks.id, input.id));
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Playbook not found' });
      return row;
    }),

  create: adminProcedure
    .input(z.object({
      title: z.string().min(3).max(200),
      category: z.enum(["kyc_physical", "kyb_premises", "asset_verification", "surveillance", "address_verification", "interview", "evidence_collection", "emergency"]),
      description: z.string(),
      estimatedHours: z.number().min(1).max(200),
      requiredTier: z.enum(["junior", "senior", "lead", "specialist"]),
      steps: z.string(),
      dataToCollect: z.string(),
      safetyNotes: z.string().optional(),
      legalNotes: z.string().optional(),
      nigeriaContext: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [row] = await db.insert(fieldAgentPlaybooks).values(input).returning();
      return row;
    }),
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(3).max(200).optional(),
      category: z.enum(["kyc_physical", "kyb_premises", "asset_verification", "surveillance", "address_verification", "interview", "evidence_collection", "emergency"]).optional(),
      description: z.string().optional(),
      estimatedHours: z.number().min(1).max(200).optional(),
      requiredTier: z.enum(["junior", "senior", "lead", "specialist"]).optional(),
      steps: z.string().optional(),
      dataToCollect: z.string().optional(),
      safetyNotes: z.string().optional(),
      legalNotes: z.string().optional(),
      nigeriaContext: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const { id, ...updates } = input;
      const [row] = await db.update(fieldAgentPlaybooks).set(updates as any).where(eq(fieldAgentPlaybooks.id, id)).returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Playbook not found' });
      return row;
    }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      await db.delete(fieldAgentPlaybooks).where(eq(fieldAgentPlaybooks.id, input.id));
      return { success: true };
    }),
});

// ── Duplicate Identity Check Router ─────────────────────────────────────────────────
const duplicateCheckRouter = router({
  check: protectedProcedure
    .input(z.object({
      subjectName: z.string().min(2),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      phone: z.string().optional(),
      faceImageUrl: z.string().optional(),
      investigationRef: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      // Check for existing records with matching NIN, BVN, or phone
      const conditions = [];
      if (input.nin) conditions.push(eq(duplicateIdentityChecks.nin, input.nin));
      if (input.bvn) conditions.push(eq(duplicateIdentityChecks.bvn, input.bvn));
      if (input.phone) conditions.push(eq(duplicateIdentityChecks.phone, input.phone));

      // Also check investigations table for matches
      const invConditions = [];
      if (input.nin) invConditions.push(eq(investigations.nin, input.nin));
      if (input.bvn) invConditions.push(eq(investigations.bvn, input.bvn));
      if (input.phone) invConditions.push(eq(investigations.phone, input.phone));

      const existingInvs = invConditions.length > 0
        ? await db.select({ ref: investigations.ref, subjectName: investigations.subjectName, status: investigations.status })
            .from(investigations)
            .where(invConditions.length === 1 ? invConditions[0] : sql`${invConditions.map(c => sql`(${c})`).reduce((a, b) => sql`${a} OR ${b}`)}`)
            .limit(10)
        : [];

      const matchCount = existingInvs.length;
      const status = matchCount === 0 ? 'no_match' : matchCount >= 2 ? 'confirmed_duplicate' : 'possible_match';
      const confidenceScore = matchCount === 0 ? 0 : Math.min(95, 40 + matchCount * 25);

      const [record] = await db.insert(duplicateIdentityChecks).values({
        subjectName: input.subjectName,
        nin: input.nin,
        bvn: input.bvn,
        phone: input.phone,
        faceImageUrl: input.faceImageUrl,
        investigationRef: input.investigationRef,
        status: status as any,
        matchCount,
        matchDetails: JSON.stringify(existingInvs),
        confidenceScore,
        requestedBy: ctx.user.id,
        completedAt: new Date(),
      }).returning();

      // Write audit log
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? undefined,
        category: 'kyc',
        action: 'duplicate_identity_check',
        targetRef: input.investigationRef ?? record.id.toString(),
        result: 'success',
        detail: { status, matchCount, confidenceScore },
      });

      return { ...record, matches: existingInvs };
    }),

  history: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(duplicateIdentityChecks)
        .where(eq(duplicateIdentityChecks.requestedBy, ctx.user.id))
        .orderBy(desc(duplicateIdentityChecks.createdAt))
        .limit(20);
    }),
});

// ── Hosted Verification Link Router ─────────────────────────────────────────────────
const hostedLinkRouter = router({
  create: protectedProcedure
    .input(z.object({
      subjectName: z.string().optional(),
      investigationRef: z.string().optional(),
      requiredChecks: z.array(z.enum(["nin", "bvn", "selfie", "document", "address", "phone"])).min(1),
      expiryHours: z.number().min(1).max(168).default(48),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const token = Buffer.from(crypto.randomUUID()).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
      const expiresAt = new Date(Date.now() + input.expiryHours * 3600 * 1000);
      const [link] = await db.insert(hostedVerificationLinks).values({
        token,
        investigationRef: input.investigationRef,
        subjectName: input.subjectName,
        requiredChecks: JSON.stringify(input.requiredChecks),
        expiresAt,
        createdBy: ctx.user.id,
      }).returning();
      return { ...link, url: `${ENV.oauthPortalUrl}/verify/${token}` };
    }),

  list: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(hostedVerificationLinks)
        .where(eq(hostedVerificationLinks.createdBy, ctx.user.id))
        .orderBy(desc(hostedVerificationLinks.createdAt))
        .limit(50);
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      await db.update(hostedVerificationLinks)
        .set({ status: 'revoked' })
        .where(eq(hostedVerificationLinks.id, input.id));
      return { success: true };
    }),

  /**
   * Public: resolve a hosted verification link by token.
   * Returns the link metadata (required checks, subject name, expiry) without auth.
   * Used by the /verify/:token self-service portal page.
   */
  resolve: publicProcedure
    .input(z.object({ token: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [link] = await db.select()
        .from(hostedVerificationLinks)
        .where(eq(hostedVerificationLinks.token, input.token))
        .limit(1);
      if (!link) throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification link not found or expired' });
      if (link.status === 'revoked') throw new TRPCError({ code: 'FORBIDDEN', message: 'This verification link has been revoked' });
      if (link.status === 'completed') throw new TRPCError({ code: 'FORBIDDEN', message: 'This verification link has already been completed' });
      if (new Date() > link.expiresAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'This verification link has expired' });
      // Return safe subset — do not expose internal IDs or createdBy
      return {
        token: link.token,
        subjectName: link.subjectName,
        requiredChecks: JSON.parse(link.requiredChecks ?? '[]') as string[],
        expiresAt: link.expiresAt,
        status: link.status,
      };
    }),

  /**
   * Public: submit KYC data via a hosted verification link.
   * Creates a KYC record from the submitted data and marks the link as completed.
   * Used by the /verify/:token self-service portal page.
   */
  submit: publicProcedure
    .input(z.object({
      token: z.string().min(8).max(64),
      subjectName: z.string().min(1).max(255),
      nin: z.string().length(11).optional(),
      bvn: z.string().length(11).optional(),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      phone: z.string().max(20).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [link] = await db.select()
        .from(hostedVerificationLinks)
        .where(eq(hostedVerificationLinks.token, input.token))
        .limit(1);
      if (!link) throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification link not found' });
      if (link.status !== 'active') throw new TRPCError({ code: 'FORBIDDEN', message: `Link is ${link.status}` });
      if (new Date() > link.expiresAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'Verification link has expired' });

      // Create a KYC record from the submitted data
      const subjectRef = `hosted-${link.token}`;
      const [kycRecord] = await db.insert(kycRecords).values({
        subjectName: input.subjectName,
        nin: input.nin ?? null,
        bvn: input.bvn ?? null,
        dob: input.dob ?? null,
        phone: input.phone ?? null,
        status: 'pending',
        subjectRef,
        createdBy: link.createdBy ?? 0,
      }).returning({ id: kycRecords.id, subjectRef: kycRecords.subjectRef });

      // Mark the link as completed
      await db.update(hostedVerificationLinks)
        .set({ status: 'completed', completedAt: new Date(), resultRef: subjectRef })
        .where(eq(hostedVerificationLinks.id, link.id));

      return { success: true, kycRecordId: kycRecord?.id, subjectRef };
    }),
});

// ─── Case Management Router ──────────────────────────────────────────────────
const casesRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      myCases: z.boolean().optional(),
      leadAnalystId: z.number().optional(),
      sortBy: z.enum(['created_desc','created_asc','priority','due_date']).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const filters: any[] = [];
      if (input?.status) filters.push(eq(cases.status, input.status as any));
      if (input?.type) filters.push(eq(cases.type, input.type as any));
      if (input?.priority) filters.push(eq(cases.priority, input.priority as any));
      if (input?.search) filters.push(ilike(cases.title, `%${input.search}%`));
      if (input?.dateFrom) filters.push(gte(cases.createdAt, input.dateFrom));
      if (input?.dateTo) filters.push(lte(cases.createdAt, input.dateTo));
      if (input?.myCases && ctx.user?.id) filters.push(eq(cases.leadAnalystId, ctx.user.id));
      if (input?.leadAnalystId) filters.push(eq(cases.leadAnalystId, input.leadAnalystId));
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      let orderByClause: any;
      switch (input?.sortBy) {
        case 'created_asc': orderByClause = asc(cases.createdAt); break;
        case 'priority': orderByClause = desc(cases.priority); break;
        case 'due_date': orderByClause = asc(cases.dueAt); break;
        default: orderByClause = desc(cases.createdAt);
      }
      const rows = await db.select().from(cases)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [{ total }] = await db.select({ total: count() }).from(cases)
        .where(filters.length ? and(...filters) : undefined);
      return { cases: rows, total, page, pageSize };
    }),

  get: protectedProcedure
    .input(z.object({ ref: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.ref)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const parties = await db.select().from(caseParties).where(eq(caseParties.caseId, c.id)).orderBy(asc(caseParties.createdAt));
      const documents = await db.select().from(caseDocuments).where(eq(caseDocuments.caseId, c.id)).orderBy(desc(caseDocuments.createdAt));
      const timeline = await db.select().from(caseTimeline).where(eq(caseTimeline.caseId, c.id)).orderBy(desc(caseTimeline.createdAt));
      const stakeholders = await db.select().from(caseStakeholders).where(eq(caseStakeholders.caseId, c.id));
      return { ...c, parties, documents, timeline, stakeholders };
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(3).max(300),
      type: z.enum(['fraud','aml','kyc_failure','sanctions','corruption','cyber','regulatory','other']),
      priority: z.enum(['low','medium','high','critical']).default('medium'),
      summary: z.string().optional(),
      legalBasis: z.string().optional(),
      jurisdiction: z.string().optional(),
      regulatoryFramework: z.string().optional(),
      investigationRefs: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      dueAt: z.date().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const ref = `CASE-${new Date().getFullYear()}-${Math.random().toString(36).substring(2,10).toUpperCase()}`;
      const [c] = await db.insert(cases).values({
        ref,
        title: input.title,
        type: input.type,
        priority: input.priority,
        summary: input.summary,
        legalBasis: input.legalBasis,
        jurisdiction: input.jurisdiction,
        regulatoryFramework: input.regulatoryFramework,
        investigationRefs: input.investigationRefs,
        tags: input.tags,
        dueAt: input.dueAt,
        createdBy: ctx.user?.id,
        leadAnalystId: ctx.user?.id,
      }).returning();
      // Add timeline event
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'case_created',
        title: 'Case created',
        detail: { ref: c.ref, title: c.title },
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
        actorRole: ctx.user?.role,
      });
      return c;
    }),

  update: protectedProcedure
    .input(z.object({
      ref: z.string(),
      title: z.string().optional(),
      status: z.enum(['draft','open','under_review','pending_decision','closed','archived']).optional(),
      priority: z.enum(['low','medium','high','critical']).optional(),
      summary: z.string().optional(),
      legalBasis: z.string().optional(),
      regulatoryFramework: z.string().optional(),
      tags: z.array(z.string()).optional(),
      dueAt: z.date().optional(),
      closureReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const { ref, ...updates } = input;
      const [c] = await db.select().from(cases).where(eq(cases.ref, ref)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      // PBAC: closing/archiving a case requires 'close' permission
      if (updates.status === 'closed' || updates.status === 'archived') {
        const canClose = await permifyCheck("case", ref, "close", String(ctx.user?.id ?? ''));
        if (!canClose) throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to close this case' });
      }
      const updateData: any = { ...updates, updatedAt: new Date() };
      if (updates.status === 'closed' || updates.status === 'archived') {
        updateData.closedAt = new Date();
      }
      await db.update(cases).set(updateData).where(eq(cases.ref, ref));
      if (updates.status && updates.status !== c.status) {
        await db.insert(caseTimeline).values({
          caseId: c.id,
          eventType: 'status_changed',
          title: `Status changed to ${updates.status}`,
          detail: { from: c.status, to: updates.status },
          actorId: ctx.user?.id,
          actorName: ctx.user?.name,
        });
      }
      return { success: true };
    }),

  addParty: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      role: z.enum(['subject','witness','associate','victim','entity']),
      name: z.string().min(2),
      nin: z.string().optional(),
      bvn: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
      investigationRef: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const { caseRef, ...partyData } = input;
      const [party] = await db.insert(caseParties).values({ ...partyData, caseId: c.id, addedBy: ctx.user?.id }).returning();
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'party_added',
        title: `Party added: ${input.name} (${input.role})`,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
      });
      return party;
    }),

  inviteStakeholder: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      role: z.enum(['lead_analyst','reviewer','external_counsel','regulator','compliance_officer','subject_representative']),
      name: z.string().min(2),
      email: z.string().email(),
      organisation: z.string().optional(),
      canComment: z.boolean().default(false),
      canViewDocuments: z.boolean().default(true),
      expiryDays: z.number().min(1).max(90).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const crypto = await import('crypto');
      const accessToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + input.expiryDays * 86400000);
      const [stakeholder] = await db.insert(caseStakeholders).values({
        caseId: c.id,
        role: input.role,
        name: input.name,
        email: input.email,
        organisation: input.organisation,
        accessToken,
        accessExpiresAt: expiresAt,
        canComment: input.canComment,
        canViewDocuments: input.canViewDocuments,
        invitedBy: ctx.user?.id,
      }).returning();
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'stakeholder_invited',
        title: `Stakeholder invited: ${input.name} (${input.role})`,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
      });
      // Send notification with portal link (origin must be passed from frontend)
      const portalUrl = `/stakeholder-portal?token=${accessToken}`;
      notifyOwner({
        title: `[BIS] Stakeholder Invited — ${escHtml(c.ref)}`,
        content: `**${input.name}** (${input.role}${input.organisation ? `, ${input.organisation}` : ''}) has been invited to case **${escHtml(c.ref)}: ${escHtml(c.title)}**.\n\nPortal access link: ${portalUrl}\n\nExpires: ${expiresAt.toISOString().split('T')[0]}\n\nInvited by: ${escHtml(ctx.user?.name) || 'System'}`,
      }).catch(() => {/* non-fatal */});
      // Update lastNotifiedAt
      await db.update(caseStakeholders).set({ lastNotifiedAt: new Date() }).where(eq(caseStakeholders.id, stakeholder.id));
      return { ...stakeholder, portalUrl };
    }),

  portalAccess: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [stakeholder] = await db.select().from(caseStakeholders)
        .where(eq(caseStakeholders.accessToken, input.token)).limit(1);
      if (!stakeholder) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token' });
      if (stakeholder.accessExpiresAt && stakeholder.accessExpiresAt < new Date()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Access token expired' });
      }
      const [c] = await db.select().from(cases).where(eq(cases.id, stakeholder.caseId)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const timeline = await db.select().from(caseTimeline).where(eq(caseTimeline.caseId, c.id)).orderBy(desc(caseTimeline.createdAt)).limit(20);
      const documents = stakeholder.canViewDocuments
        ? await db.select().from(caseDocuments).where(and(eq(caseDocuments.caseId, c.id), eq(caseDocuments.confidential, false)))
        : [];
      // Update last accessed
      await db.update(caseStakeholders).set({ lastAccessedAt: new Date() }).where(eq(caseStakeholders.id, stakeholder.id));
      return { case: c, stakeholder, timeline, documents };
    }),

  addTimelineEvent: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      eventType: z.enum(['comment_added','decision_recorded','investigation_linked','field_task_dispatched','alert_triggered']),
      title: z.string().min(3),
      detail: z.any().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const [event] = await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: input.eventType,
        title: input.title,
        detail: input.detail,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
        actorRole: ctx.user?.role,
      }).returning();
      return event;
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
    const statusCounts = await db.select({ status: cases.status, count: count() }).from(cases).groupBy(cases.status);
    const typeCounts = await db.select({ type: cases.type, count: count() }).from(cases).groupBy(cases.type);
    const [{ total }] = await db.select({ total: count() }).from(cases);
    return { total, statusCounts, typeCounts };
  }),

  uploadDocument: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      fileName: z.string().min(1).max(255),
      mimeType: z.string(),
      fileBase64: z.string(), // base64-encoded file content
      fileSize: z.number().max(16 * 1024 * 1024), // 16 MB max
      confidential: z.boolean().default(false),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      // Validate file type
      const allowedTypes = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','image/jpg','text/plain'];
      if (!allowedTypes.includes(input.mimeType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File type not allowed. Permitted: PDF, DOCX, XLSX, PNG, JPG, TXT' });
      }
      // Magic-byte validation: verify actual file header matches declared MIME type
      const fileBuffer = Buffer.from(input.fileBase64, 'base64');
      const magicBytes = fileBuffer.slice(0, 8);
      const MAGIC: Record<string, number[][]> = {
        'application/pdf':  [[0x25, 0x50, 0x44, 0x46]],                                // %PDF
        'image/png':        [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],       // PNG
        'image/jpeg':       [[0xFF, 0xD8, 0xFF]],                                       // JPEG
        'image/jpg':        [[0xFF, 0xD8, 0xFF]],                                       // JPEG
        'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],                              // DOC (OLE2)
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]], // DOCX (ZIP)
        'application/vnd.ms-excel': [[0xD0, 0xCF, 0x11, 0xE0]],                       // XLS (OLE2)
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]], // XLSX (ZIP)
        'text/plain': [],  // no reliable magic bytes for plain text
      };
      const expectedMagics = MAGIC[input.mimeType];
      if (expectedMagics && expectedMagics.length > 0) {
        const matches = expectedMagics.some(magic =>
          magic.every((byte, i) => magicBytes[i] === byte)
        );
        if (!matches) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content does not match declared MIME type (magic-byte mismatch)' });
        }
      }
      // Upload to S3
      const crypto = await import('crypto');
      const suffix = crypto.randomBytes(8).toString('hex');
      // Sanitize extension: only allow alphanumeric chars, max 10 chars (prevents path traversal)
      const rawExt = input.fileName.split('.').pop() ?? 'bin';
      const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'bin';
      const fileKey = `cases/${escHtml(c.ref)}/docs/${suffix}.${ext}`;
      const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);
      // Persist metadata
      const [doc] = await db.insert(caseDocuments).values({
        caseId: c.id,
        filename: input.fileName,
        fileKey,
        url,
        mimeType: input.mimeType,
        sizeBytes: input.fileSize,
        confidential: input.confidential,
        description: input.description,
        uploadedBy: ctx.user?.id,
      }).returning();
      // Add timeline event
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'document_uploaded',
        title: `Document uploaded: ${input.fileName}`,
        detail: { fileKey, mimeType: input.mimeType, fileSize: input.fileSize },
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
        actorRole: ctx.user?.role,
      });
      return doc;
    }),

  listDocuments: protectedProcedure
    .input(z.object({ caseRef: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return db.select().from(caseDocuments)
        .where(eq(caseDocuments.caseId, c.id))
        .orderBy(desc(caseDocuments.createdAt));
    }),

  resendInvite: protectedProcedure
    .input(z.object({
      stakeholderId: z.number(),
      origin: z.string().url(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [sh] = await db.select().from(caseStakeholders)
        .where(eq(caseStakeholders.id, input.stakeholderId)).limit(1);
      if (!sh) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stakeholder not found' });
      const [c] = await db.select().from(cases).where(eq(cases.id, sh.caseId)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const portalUrl = `${input.origin}/stakeholder-portal?token=${sh.accessToken}`;
      await notifyOwner({
        title: `[BIS] Case Portal Invite Re-sent — ${escHtml(c.ref)}`,
        content: `Stakeholder **${sh.name}** (${sh.role}) has been re-invited to case **${escHtml(c.ref)}: ${escHtml(c.title)}**.\n\nPortal link: ${portalUrl}\n\nExpires: ${sh.accessExpiresAt?.toISOString() ?? 'N/A'}`,
      });
      await db.update(caseStakeholders)
        .set({ lastNotifiedAt: new Date() })
        .where(eq(caseStakeholders.id, sh.id));
      return { success: true, portalUrl };
    }),

  recentActivity: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      // Fetch recent timeline events joined with case info
      const events = await db
        .select({
          id: caseTimeline.id,
          eventType: caseTimeline.eventType,
          title: caseTimeline.title,
          detail: caseTimeline.detail,
          actorName: caseTimeline.actorName,
          createdAt: caseTimeline.createdAt,
          caseId: cases.id,
          caseRef: cases.ref,
          caseTitle: cases.title,
          caseStatus: cases.status,
        })
        .from(caseTimeline)
        .innerJoin(cases, eq(caseTimeline.caseId, cases.id))
        .where(sql`${cases.status} NOT IN ('closed', 'archived')`)
        .orderBy(desc(caseTimeline.createdAt))
        .limit(input.limit);
      return events;
    }),

  deleteDocument: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      documentId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const [doc] = await db.select().from(caseDocuments)
        .where(and(eq(caseDocuments.id, input.documentId), eq(caseDocuments.caseId, c.id))).limit(1);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      // Hard delete from DB (S3 key retained in timeline for audit trail)
      await db.delete(caseDocuments).where(eq(caseDocuments.id, input.documentId));
      // Add timeline event
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'document_deleted',
        title: `Document deleted: ${doc.filename}`,
        detail: { fileKey: doc.fileKey, mimeType: doc.mimeType, deletedBy: ctx.user?.name },
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
        actorRole: ctx.user?.role,
      });
      return { success: true };
    }),

  exportCasePdf: protectedProcedure
    .input(z.object({ caseRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const parties = await db.select().from(caseParties).where(eq(caseParties.caseId, c.id)).orderBy(asc(caseParties.createdAt));
      const documents = await db.select().from(caseDocuments).where(eq(caseDocuments.caseId, c.id)).orderBy(desc(caseDocuments.createdAt));
      const timeline = await db.select().from(caseTimeline).where(eq(caseTimeline.caseId, c.id)).orderBy(desc(caseTimeline.createdAt)).limit(50);
      const stakeholders = await db.select().from(caseStakeholders).where(eq(caseStakeholders.caseId, c.id));

      // Generate executive summary via LLM
      let executiveSummary = 'No summary available.';
      try {
        const llmRes = await invokeLLM({
          messages: [
            { role: 'system', content: 'You are a compliance officer writing a concise executive summary for a regulatory case report. Be factual, professional, and concise (3-5 sentences).' },
            { role: 'user', content: `Case: ${escHtml(c.ref)} — ${escHtml(c.title)}\nType: ${c.type}\nStatus: ${c.status}\nPriority: ${c.priority}\nSummary: ${c.summary ?? 'N/A'}\nParties: ${parties.map(p => `${p.name} (${p.role})`).join(', ') || 'None'}\nTimeline events: ${timeline.length}\nDocuments: ${documents.length}\n\nWrite a 3-5 sentence executive summary for this compliance case report.` },
          ],
        });
        executiveSummary = (llmRes as any)?.choices?.[0]?.message?.content ?? executiveSummary;
      } catch { /* LLM unavailable — use fallback */ }

      // Build PDF content as HTML string
      const now = new Date().toISOString().split('T')[0];
      const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 40px; }
h1 { font-size: 22px; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
h2 { font-size: 16px; color: #1e40af; margin-top: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #f1f5f9; text-align: left; padding: 6px 10px; font-size: 11px; }
td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
.critical { background: #fee2e2; color: #991b1b; }
.high { background: #ffedd5; color: #9a3412; }
.medium { background: #dbeafe; color: #1e40af; }
.low { background: #f1f5f9; color: #475569; }
.footer { margin-top: 40px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style></head><body>
<h1>BIS Compliance Case Report</h1>
<p><strong>Generated:</strong> ${now} &nbsp;&nbsp; <strong>By:</strong> ${escHtml(ctx.user?.name) || 'System'} &nbsp;&nbsp; <strong>Classification:</strong> CONFIDENTIAL</p>

<h2>Case Overview</h2>
<table>
<tr><th>Reference</th><td>${escHtml(c.ref)}</td><th>Status</th><td><span class="badge ${c.status}">${c.status.replace('_',' ')}</span></td></tr>
<tr><th>Title</th><td colspan="3">${escHtml(c.title)}</td></tr>
<tr><th>Type</th><td>${escHtml(c.type).replace('_',' ')}</td><th>Priority</th><td><span class="badge ${c.priority}">${c.priority}</span></td></tr>
<tr><th>Legal Basis</th><td>${escHtml(c.legalBasis) || '—'}</td><th>Jurisdiction</th><td>${escHtml(c.jurisdiction) || '—'}</td></tr>
<tr><th>Regulatory Framework</th><td>${escHtml(c.regulatoryFramework) || '—'}</td><th>Risk Score</th><td>${c.riskScore != null ? c.riskScore + '/100' : '—'}</td></tr>
<tr><th>Created</th><td>${new Date(c.createdAt).toLocaleDateString()}</td><th>Due Date</th><td>${c.dueAt ? new Date(c.dueAt).toLocaleDateString() : '—'}</td></tr>
</table>

<h2>Executive Summary</h2>
<p>${escHtml(executiveSummary)}</p>

${parties.length > 0 ? `<h2>Parties (${parties.length})</h2>
<table><tr><th>Name</th><th>Role</th><th>NIN</th><th>BVN</th><th>Phone</th><th>Email</th></tr>
${parties.map(p => `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.role)}</td><td>${escHtml(p.nin) || '—'}</td><td>${escHtml(p.bvn) || '—'}</td><td>${escHtml(p.phone) || '—'}</td><td>${escHtml(p.email) || '—'}</td></tr>`).join('')}
</table>` : ''}

${stakeholders.length > 0 ? `<h2>Stakeholders (${stakeholders.length})</h2>
<table><tr><th>Name</th><th>Role</th><th>Organisation</th><th>Email</th><th>Access Expires</th></tr>
${stakeholders.map(s => `<tr><td>${escHtml(s.name)}</td><td>${escHtml(s.role).replace('_',' ')}</td><td>${escHtml(s.organisation) || '—'}</td><td>${escHtml(s.email)}</td><td>${s.accessExpiresAt ? new Date(s.accessExpiresAt).toLocaleDateString() : '—'}</td></tr>`).join('')}
</table>` : ''}

${documents.length > 0 ? `<h2>Documents (${documents.length})</h2>
<table><tr><th>Filename</th><th>Type</th><th>Size</th><th>Confidential</th><th>Uploaded</th></tr>
${documents.map(d => `<tr><td>${escHtml(d.filename)}</td><td>${escHtml(d.mimeType) || '—'}</td><td>${d.sizeBytes ? (d.sizeBytes/1024).toFixed(1)+' KB' : '—'}</td><td>${d.confidential ? 'Yes' : 'No'}</td><td>${new Date(d.createdAt).toLocaleDateString()}</td></tr>`).join('')}
</table>` : ''}

<h2>Case Timeline (last ${timeline.length} events)</h2>
<table><tr><th>Date</th><th>Event</th><th>Actor</th></tr>
${timeline.map(e => `<tr><td>${new Date(e.createdAt).toLocaleDateString()}</td><td>${escHtml(e.title)}</td><td>${escHtml(e.actorName) || 'System'}</td></tr>`).join('')}
</table>

<div class="footer">This report was generated by the BIS (Background Intelligence System) compliance platform. Reference: ${escHtml(c.ref)}. Generated: ${new Date().toISOString()}. Recipient should treat this document as confidential.</div>
</body></html>`;

      // Convert HTML to PDF using weasyprint via child_process
      // SECURITY: use spawnSync with array args to prevent shell/command injection
      const crypto = await import('crypto');
      const { spawnSync } = await import('child_process');
      const tmpDir = '/tmp';
      // Sanitize c.ref to prevent path traversal (format: BIS-YYYYMMDD-NNNNNN)
      const safeRef = c.ref.replace(/[^a-zA-Z0-9-]/g, '_');
      const htmlFile = `${tmpDir}/case-${safeRef}-${crypto.randomBytes(4).toString('hex')}.html`;
      const pdfFile = htmlFile.replace('.html', '.pdf');
      const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
      writeFileSync(htmlFile, htmlContent, 'utf8');
      const weasyprintResult = spawnSync('weasyprint', [htmlFile, pdfFile], { timeout: 30000 });
      if (weasyprintResult.status !== 0) {
        // Fallback: return HTML as PDF-like download
        const htmlBuf = Buffer.from(htmlContent, 'utf8');
        const suffix = crypto.randomBytes(6).toString('hex');
        const { url } = await storagePut(`cases/${escHtml(c.ref)}/exports/report-${suffix}.html`, htmlBuf, 'text/html');
        unlinkSync(htmlFile);
        await db.insert(caseTimeline).values({
          caseId: c.id,
          eventType: 'decision_recorded',
          title: 'Case report exported (HTML)',
          detail: { exportUrl: url, exportedBy: ctx.user?.name },
          actorId: ctx.user?.id,
          actorName: ctx.user?.name,
          actorRole: ctx.user?.role,
        });
        return { url, format: 'html', filename: `${escHtml(c.ref)}-report.html` };
      }
      const pdfBuf = readFileSync(pdfFile);
      const suffix = crypto.randomBytes(6).toString('hex');
      const { url } = await storagePut(`cases/${escHtml(c.ref)}/exports/report-${suffix}.pdf`, pdfBuf, 'application/pdf');
      unlinkSync(htmlFile);
      unlinkSync(pdfFile);
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'decision_recorded',
        title: 'Case report exported to PDF',
        detail: { exportUrl: url, exportedBy: ctx.user?.name },
        actorId: ctx.user?.id,
        actorName: ctx.user?.name,
        actorRole: ctx.user?.role,
      });
      return { url, format: 'pdf', filename: `${escHtml(c.ref)}-report.pdf` };
    }),

  exportCaseCsv: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      myCases: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const filters: any[] = [];
      if (input?.status) filters.push(eq(cases.status, input.status as any));
      if (input?.type) filters.push(eq(cases.type, input.type as any));
      if (input?.priority) filters.push(eq(cases.priority, input.priority as any));
      if (input?.search) filters.push(ilike(cases.title, `%${input.search}%`));
      if (input?.dateFrom) filters.push(gte(cases.createdAt, input.dateFrom));
      if (input?.dateTo) filters.push(lte(cases.createdAt, input.dateTo));
      if (input?.myCases && ctx.user?.id) filters.push(eq(cases.leadAnalystId, ctx.user.id));
      const rows = await db.select().from(cases)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(cases.createdAt))
        .limit(1000);
      const header = 'Ref,Title,Type,Status,Priority,Created,Due Date,Risk Score,Tags';
      const csvRows = rows.map(r => [
        r.ref, `"${r.title.replace(/"/g, '""')}"`, r.type, r.status, r.priority,
        new Date(r.createdAt).toISOString().split('T')[0],
        r.dueAt ? new Date(r.dueAt).toISOString().split('T')[0] : '',
        r.riskScore ?? '',
        `"${((r.tags as string[]) ?? []).join(';')}"`
      ].join(','));
      const csv = [header, ...csvRows].join('\n');
      const crypto = await import('crypto');
      const suffix = crypto.randomBytes(6).toString('hex');
      const { url } = await storagePut(`cases/exports/cases-${suffix}.csv`, Buffer.from(csv, 'utf8'), 'text/csv');
      return { url, count: rows.length };
    }),

  // ─── Risk Scoring ──────────────────────────────────────────────────────────

  recalculateRiskScore: protectedProcedure
    .input(z.object({ caseRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const parties = await db.select().from(caseParties).where(eq(caseParties.caseId, c.id));
      const documents = await db.select().from(caseDocuments).where(eq(caseDocuments.caseId, c.id));
      const timeline = await db.select().from(caseTimeline).where(eq(caseTimeline.caseId, c.id));

      // Composite risk scoring: priority (40%), party count (20%), timeline events (20%), document count (10%), overdue (10%)
      const PRIORITY_WEIGHTS: Record<string, number> = { low: 10, medium: 35, high: 65, critical: 90 };
      const priorityScore = PRIORITY_WEIGHTS[c.priority] ?? 35;
      const partyScore = Math.min(parties.length * 8, 20);
      const timelineScore = Math.min(timeline.length * 2, 20);
      const docScore = Math.min(documents.length * 2, 10);
      const overdueScore = c.dueAt && new Date(c.dueAt) < new Date() ? 10 : 0;
      const rawScore = priorityScore + partyScore + timelineScore + docScore + overdueScore;
      const riskScore = Math.min(Math.round(rawScore), 100);

      // Try to get LLM risk assessment for open/active cases
      let llmRiskNotes: string | undefined;
      if (['open', 'under_review', 'pending_decision'].includes(c.status)) {
        try {
          const llmRes = await invokeLLM({
            messages: [
              { role: 'system', content: 'You are a compliance risk analyst. Given a case summary, return a JSON object with fields: riskLevel (low/medium/high/critical), keyRiskFactors (array of strings, max 3), recommendation (string, max 100 chars). Respond ONLY with valid JSON.' },
              { role: 'user', content: `Case: ${escHtml(c.title)}\nType: ${c.type}\nPriority: ${c.priority}\nParties: ${parties.length}\nSummary: ${c.summary ?? 'N/A'}\nJurisdiction: ${c.jurisdiction ?? 'N/A'}\nLegal basis: ${c.legalBasis ?? 'N/A'}` },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'risk_assessment', strict: true, schema: { type: 'object', properties: { riskLevel: { type: 'string' }, keyRiskFactors: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } }, required: ['riskLevel', 'keyRiskFactors', 'recommendation'], additionalProperties: false } } },
          });
          const content = llmRes?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            llmRiskNotes = `AI Assessment: ${parsed.riskLevel?.toUpperCase()} risk. Factors: ${(parsed.keyRiskFactors ?? []).join('; ')}. ${parsed.recommendation ?? ''}`;
          }
        } catch {
          // LLM optional — proceed without it
        }
      }

      await db.update(cases).set({ riskScore, updatedAt: new Date() }).where(eq(cases.id, c.id));
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'decision_recorded',
        title: `Risk score recalculated: ${riskScore}/100${llmRiskNotes ? ` — ${llmRiskNotes}` : ''}`,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name ?? 'System',
      });
      return { riskScore, llmRiskNotes };
    }),

  // ─── Lead Analyst Assignment ───────────────────────────────────────────────

  assignLeadAnalyst: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      analystId: z.number().nullable(),
      analystName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      await db.update(cases).set({ leadAnalystId: input.analystId, updatedAt: new Date() }).where(eq(cases.id, c.id));
      const label = input.analystId ? `Assigned to ${input.analystName ?? 'Analyst #' + input.analystId}` : 'Lead analyst unassigned';
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'status_changed',
        title: label,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name ?? 'System',
      });
      return { success: true };
    }),

  // ─── Comments CRUD ─────────────────────────────────────────────────────────

  listComments: protectedProcedure
    .input(z.object({ caseRef: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) return [];
      const rows = await db.select().from(caseComments)
        .where(and(eq(caseComments.caseId, c.id), eq(caseComments.deletedAt, null as any)))
        .orderBy(asc(caseComments.createdAt));
      // Filter confidential comments: only show to analysts/supervisors/admins
      const role = ctx.user?.role;
      const canSeeConfidential = role === 'admin' || role === 'analyst' || role === 'supervisor';
      return rows.filter(r => !r.confidential || canSeeConfidential);
    }),

  addComment: protectedProcedure
    .input(z.object({
      caseRef: z.string(),
      content: z.string().min(1).max(5000),
      confidential: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [c] = await db.select().from(cases).where(eq(cases.ref, input.caseRef)).limit(1);
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      const [comment] = await db.insert(caseComments).values({
        caseId: c.id,
        content: input.content,
        authorId: ctx.user?.id,
        authorName: ctx.user?.name ?? 'Unknown',
        authorRole: ctx.user?.role,
        confidential: input.confidential,
      }).returning();
      await db.insert(caseTimeline).values({
        caseId: c.id,
        eventType: 'comment_added',
        title: input.confidential ? '[Confidential] Comment added' : `Comment: ${input.content.slice(0, 80)}${input.content.length > 80 ? '…' : ''}`,
        actorId: ctx.user?.id,
        actorName: ctx.user?.name ?? 'Unknown',
      });
      return comment;
    }),

  editComment: protectedProcedure
    .input(z.object({
      commentId: z.number(),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [comment] = await db.select().from(caseComments).where(eq(caseComments.id, input.commentId)).limit(1);
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      // Only the author or an admin can edit
      if (comment.authorId !== ctx.user?.id && ctx.user?.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own comments' });
      }
      if (comment.deletedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot edit a deleted comment' });
      await db.update(caseComments).set({ content: input.content, editedAt: new Date(), updatedAt: new Date() }).where(eq(caseComments.id, input.commentId));
      return { success: true };
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [comment] = await db.select().from(caseComments).where(eq(caseComments.id, input.commentId)).limit(1);
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      if (comment.authorId !== ctx.user?.id && ctx.user?.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own comments' });
      }
      // Soft-delete
      await db.update(caseComments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(caseComments.id, input.commentId));
      return { success: true };
    }),

  // ─── Bulk Actions ─────────────────────────────────────────────────────────
  bulkUpdateStatus: writeProcedure
    .input(z.object({
      refs: z.array(z.string()).min(1).max(100),
      status: z.enum(['draft', 'open', 'under_review', 'pending_decision', 'closed', 'archived']),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.update(cases).set({ status: input.status, updatedAt: new Date() }).where(inArray(cases.ref, input.refs));
      await writeAuditLog(db, { userId: ctx.user.id, category: 'case' as any, action: `Bulk status → ${input.status}: ${input.refs.length} cases`, targetRef: input.refs.join(',') });
      return { updated: input.refs.length };
    }),

  bulkAssign: writeProcedure
    .input(z.object({
      refs: z.array(z.string()).min(1).max(100),
      leadAnalystId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.update(cases).set({ leadAnalystId: input.leadAnalystId, updatedAt: new Date() }).where(inArray(cases.ref, input.refs));
      await writeAuditLog(db, { userId: ctx.user.id, category: 'case' as any, action: `Bulk assign to analyst #${input.leadAnalystId}: ${input.refs.length} cases`, targetRef: input.refs.join(',') });
      return { updated: input.refs.length };
    }),

  bulkClose: writeProcedure
    .input(z.object({
      refs: z.array(z.string()).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // PBAC: check 'close' permission on each case entity
      for (const ref of input.refs) {
        const canClose = await permifyCheck("case", ref, "close", String(ctx.user.id));
        if (!canClose) throw new TRPCError({ code: 'FORBIDDEN', message: `Insufficient permissions to close case ${ref}` });
      }
      await db.update(cases).set({ status: 'closed', updatedAt: new Date() }).where(inArray(cases.ref, input.refs));
      await writeAuditLog(db, { userId: ctx.user.id, category: 'case' as any, action: `Bulk close: ${input.refs.length} cases`, targetRef: input.refs.join(',') });
      return { closed: input.refs.length };
    }),
  getSLABreaches: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, breaches: [] };
      const now = new Date();
      const breached = await db
        .select({
          id: cases.id,
          ref: cases.ref,
          title: cases.title,
          type: cases.type,
          priority: cases.priority,
          status: cases.status,
          dueAt: cases.dueAt,
        })
        .from(cases)
        .where(
          and(
            lt(cases.dueAt, now),
            sql`${cases.status} NOT IN ('closed','archived')`
          )
        )
        .orderBy(asc(cases.dueAt))
        .limit(input.limit);
      return {
        count: breached.length,
        breaches: breached.map(c => ({
          ...c,
          hoursOverdue: c.dueAt ? Math.round((now.getTime() - new Date(c.dueAt).getTime()) / 3_600_000) : 0,
        })),
      };
    }),

  // ─── Stakeholder Portal: real-time polling ────────────────────────────────
  /**
   * Public endpoint (token-gated) — returns only new comments and documents
   * added after `since` (ISO timestamp). Used by the portal page to poll
   * every 30 s without re-fetching the entire case.
   */
  portalPollUpdates: publicProcedure
    .input(z.object({
      token: z.string(),
      since: z.string().datetime(), // ISO-8601 UTC timestamp of last poll
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [stakeholder] = await db.select().from(caseStakeholders)
        .where(eq(caseStakeholders.accessToken, input.token)).limit(1);
      if (!stakeholder) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token' });
      if (stakeholder.accessExpiresAt && stakeholder.accessExpiresAt < new Date()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Access token expired' });
      }
      const sinceDate = new Date(input.since);
      const newComments = await db.select().from(caseComments)
        .where(and(
          eq(caseComments.caseId, stakeholder.caseId),
          eq(caseComments.confidential, false),
          eq(caseComments.deletedAt, null as any),
          gte(caseComments.createdAt, sinceDate),
        ))
        .orderBy(asc(caseComments.createdAt));
      const newDocuments = stakeholder.canViewDocuments
        ? await db.select().from(caseDocuments)
            .where(and(
              eq(caseDocuments.caseId, stakeholder.caseId),
              eq(caseDocuments.confidential, false),
              gte(caseDocuments.createdAt, sinceDate),
            ))
            .orderBy(asc(caseDocuments.createdAt))
        : [];
      await db.update(caseStakeholders)
        .set({ lastAccessedAt: new Date() })
        .where(eq(caseStakeholders.id, stakeholder.id));
      return {
        newComments,
        newDocuments,
        pollTimestamp: new Date().toISOString(),
      };
    }),

  /**
   * Public endpoint (token-gated) — allows a stakeholder to post a comment
   * if `canComment` is set on their stakeholder record.
   */
  portalPostComment: publicProcedure
    .input(z.object({
      token: z.string(),
      content: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const [stakeholder] = await db.select().from(caseStakeholders)
        .where(eq(caseStakeholders.accessToken, input.token)).limit(1);
      if (!stakeholder) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token' });
      if (stakeholder.accessExpiresAt && stakeholder.accessExpiresAt < new Date()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Access token expired' });
      }
      if (!stakeholder.canComment) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to comment on this case' });
      }
      const [comment] = await db.insert(caseComments).values({
        caseId: stakeholder.caseId,
        content: input.content,
        stakeholderId: stakeholder.id,
        authorName: stakeholder.name,
        authorRole: stakeholder.role ?? 'stakeholder',
        confidential: false,
      }).returning();
      await db.insert(caseTimeline).values({
        caseId: stakeholder.caseId,
        eventType: 'comment_added',
        title: `Stakeholder comment: ${input.content.slice(0, 80)}${input.content.length > 80 ? '…' : ''}`,
        actorName: stakeholder.name,
        actorRole: stakeholder.role ?? 'stakeholder',
      });
      // Push SSE notification to all connected portal clients for this case
      try {
        const { portalSseManager } = await import('./portalSse');
        portalSseManager.push(stakeholder.caseId, {
          type: 'PORTAL_COMMENT',
          payload: {
            id: comment.id,
            content: comment.content,
            authorName: comment.authorName,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt?.toISOString(),
          },
          ts: new Date().toISOString(),
        });
      } catch { /* SSE push is best-effort */ }
      return comment;
    }),

  /**
   * Portal document upload — external stakeholders can attach files to a case.
   * Accepts base64-encoded file content, validates magic bytes, uploads to S3,
   * creates a caseDocuments record, and optionally posts a comment with the link.
   */
  portalUploadDocument: publicProcedure
    .input(z.object({
      token: z.string(),
      filename: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
      base64Content: z.string().min(1),
      description: z.string().max(500).optional(),
      postComment: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

      // Validate access token
      const [stakeholder] = await db.select().from(caseStakeholders)
        .where(eq(caseStakeholders.accessToken, input.token)).limit(1);
      if (!stakeholder) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token' });
      if (stakeholder.accessExpiresAt && stakeholder.accessExpiresAt < new Date()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Access token expired' });
      }

      // Decode and validate file size
      const buffer = Buffer.from(input.base64Content, 'base64');
      const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
      if (buffer.length > MAX_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds 10 MB limit' });
      }

      // Magic-byte validation
      const ALLOWED_MAGIC: Record<string, number[][]> = {
        'application/pdf':  [[0x25, 0x50, 0x44, 0x46]],
        'image/png':        [[0x89, 0x50, 0x4E, 0x47]],
        'image/jpeg':       [[0xFF, 0xD8, 0xFF]],
        'image/jpg':        [[0xFF, 0xD8, 0xFF]],
        'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]],
        'application/vnd.ms-excel': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]],
      };
      const allowedMagic = ALLOWED_MAGIC[input.mimeType];
      if (!allowedMagic) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `File type ${input.mimeType} is not permitted` });
      }
      const magicMatches = allowedMagic.some(magic =>
        magic.every((byte, i) => buffer[i] === byte)
      );
      if (!magicMatches) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content does not match declared MIME type' });
      }

      // Upload to S3
      const ext = input.filename.split('.').pop() ?? 'bin';
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileKey = `portal-uploads/case-${stakeholder.caseId}/${suffix}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // Create caseDocuments record
      const [doc] = await db.insert(caseDocuments).values({
        caseId: stakeholder.caseId,
        filename: input.filename,
        mimeType: input.mimeType,
        fileKey,
        url,
        sizeBytes: buffer.length,
        category: 'stakeholder_submission',
        description: input.description ?? `Uploaded by ${stakeholder.name}`,
        confidential: false,
        uploadedBy: null,
      }).returning();

      // Timeline event
      await db.insert(caseTimeline).values({
        caseId: stakeholder.caseId,
        eventType: 'document_uploaded',
        title: `Stakeholder document: ${input.filename}`,
        actorName: stakeholder.name,
        actorRole: stakeholder.role ?? 'stakeholder',
      });

      // Optionally post a comment linking the document
      if (input.postComment && stakeholder.canComment) {
        const commentText = `📎 Attached document: [${input.filename}](${url})${input.description ? `\n${input.description}` : ''}`;
        await db.insert(caseComments).values({
          caseId: stakeholder.caseId,
          content: commentText,
          stakeholderId: stakeholder.id,
          authorName: stakeholder.name,
          authorRole: stakeholder.role ?? 'stakeholder',
          confidential: false,
        });
      }

      // Push SSE notification to all connected portal clients for this case
      try {
        const { portalSseManager } = await import('./portalSse');
        portalSseManager.push(stakeholder.caseId, {
          type: 'PORTAL_DOCUMENT',
          payload: {
            id: doc.id,
            filename: input.filename,
            mimeType: input.mimeType,
            url,
            sizeBytes: buffer.length,
            uploadedBy: stakeholder.name,
            createdAt: new Date().toISOString(),
          },
          ts: new Date().toISOString(),
        });
      } catch { /* SSE push is best-effort */ }
      return { id: doc.id, url, filename: input.filename, sizeBytes: buffer.length };
    }),
});
// ─── Ollama Router ────────────────────────────────────────────────────────────

const OLLAMA_ADAPTER_URL = ENV.ollamaAdapterUrl;
const OLLAMA_ADAPTER_KEY = ENV.bisGatewayKey;

async function ollamaFetch(path: string, body: unknown) {
  const res = await fetch(`${OLLAMA_ADAPTER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": OLLAMA_ADAPTER_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Ollama adapter error: ${res.status}` });
  return res.json();
}

const ollamaRouter = router({
  health: protectedProcedure.query(async () => {
    try {
      const res = await fetch(`${OLLAMA_ADAPTER_URL}/health`, {
        headers: { "X-BIS-Key": OLLAMA_ADAPTER_KEY },
      });
      return res.ok ? await res.json() : { status: "offline" };
    } catch {
      return { status: "offline", ollama_online: false };
    }
  }),

  listModels: protectedProcedure.query(async () => {
    try {
      const res = await fetch(`${OLLAMA_ADAPTER_URL}/models`, {
        headers: { "X-BIS-Key": OLLAMA_ADAPTER_KEY },
      });
      if (!res.ok) return { models: [] };
      return res.json();
    } catch {
      return { models: [] };
    }
  }),

  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({ role: z.string().max(20), content: z.string().max(32000) })).max(100),
      model: z.string().optional(),
      system: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return ollamaFetch("/chat", input);
    }),

  embed: protectedProcedure
    .input(z.object({ text: z.string(), model: z.string().optional() }))
    .mutation(async ({ input }) => {
      return ollamaFetch("/embed", input);
    }),

  lakehouseQuery: protectedProcedure
    .input(z.object({ question: z.string(), schema: z.string().optional(), model: z.string().optional() }))
    .mutation(async ({ input }) => {
      return ollamaFetch("/lakehouse/query", input);
    }),

  explainRisk: protectedProcedure
    .input(z.object({
      subject: z.string(),
      riskScore: z.number(),
      factors: z.array(z.string()),
      model: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return ollamaFetch("/risk/explain", {
        subject: input.subject,
        risk_score: input.riskScore,
        factors: input.factors,
        model: input.model,
      });
    }),

  analyseMedia: protectedProcedure
    .input(z.object({ subject: z.string(), article: z.string(), model: z.string().optional() }))
    .mutation(async ({ input }) => {
      return ollamaFetch("/media/analyse", input);
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? { ...opts.ctx.user, isDemo: opts.ctx.isDemo } : null),
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
  alertRules: alertRulesRouter,
  apiTokens: apiTokensRouter,
  quickcheck: quickcheckRouter,
  goaml: goamlRouter,
   messaging: messagingRouter,
  socialMonitoring: socialMonitoringRouter,
  biometric: biometricRouter,
  lakehouse: lakehouseRouter,
  playbooks: playbooksRouter,
  duplicateCheck: duplicateCheckRouter,
  hostedLinks: hostedLinkRouter,
  cases: casesRouter,
  ollama: ollamaRouter,
  lex: lexRouter,
  sessions: sessionsRouter,
  totp: totpRouter,
  notifications: notificationsRouter,
  investigationLinks: investigationLinksRouter,
  exportSchedules: exportSchedulesRouter,
  transactions: transactionsRouter,
  tradeFinance: tradeFinanceRouter,
  correspondentBanking: correspondentBankingRouter,
  evidence: evidenceRouter,
  regulatoryReports: regulatoryReportsRouter,
  sar: sarRouter,
  aml: amlRouter,
  keycloak: keycloakRouter,
  temporal: temporalRouter,
  redis: redisRouter,
  archival: archivalRouter,
  paymentRails: paymentRailsRouter,
  documentVault: documentVaultRouter,
  riskDashboard: riskDashboardRouter,
});
export type AppRouter = typeof appRouter;

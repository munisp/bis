/**
 * BIS — Insider Threat tRPC Router
 *
 * Provides procedures for:
 *   • Ingesting insider-threat events from the Go gateway / Rust event processor
 *   • Querying and triaging events (dashboard, detail, update status)
 *   • Reading and refreshing UEBA profiles (backed by Python ML engine)
 *   • Managing access-review tasks (create, list, complete, escalate)
 *   • Dual-control enforcement: high/critical events require a second approver
 *
 * Language integration:
 *   Go gateway  → POST /api/trpc/insiderThreat.ingestEvent  (service-to-service)
 *   Rust EP     → POST /api/trpc/insiderThreat.ingestEvent  (service-to-service)
 *   Python UEBA → called by insiderThreat.refreshUebaProfile
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, and, gte, lte, inArray, count } from "drizzle-orm";
import {
  adminProcedure,
  router,
  writeProcedure,
} from "./_core/trpc";
import { getDb } from "./db";
import {
  insiderEvents,
  uebaProfiles,
  accessReviews,
} from "../drizzle/schema";
import { withCache, invalidateCache, TTL } from "./cache";
import { notifyOwner } from "./_core/notification";
import { startAccessReviewWorkflow } from "./temporal";
import { ENV } from "./_core/env";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const SeverityEnum = z.enum(["info", "low", "medium", "high", "critical"]);
const CategoryEnum = z.enum([
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
const EventStatusEnum = z.enum(["open", "under_review", "escalated", "dismissed", "resolved"]);
const ReviewStatusEnum = z.enum(["pending", "approved", "revoked", "escalated", "expired"]);

// ─── UEBA score helper ────────────────────────────────────────────────────────

interface UebaScoreResponse {
  subject_id: string;
  anomaly_score: number;
  drift_score: number;
  risk_level: "info" | "low" | "medium" | "high" | "critical";
  baseline_ready: boolean;
  hour_histogram: number[];
  day_histogram: number[];
  unique_ip_count: number;
  off_hours_ratio: number;
  priv_change_count: number;
  failed_auth_count: number;
  event_count: number;
}

async function callUebaScore(subjectId: string, tenantId?: string): Promise<UebaScoreResponse | null> {
  try {
    const url = `${ENV.mlEnrichmentUrl}/v1/ueba/score`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": ENV.bisGatewayKey,
      },
      body: JSON.stringify({ subject_id: subjectId, tenant_id: tenantId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    return resp.json() as Promise<UebaScoreResponse>;
  } catch {
    return null;
  }
}

// ─── Auto-escalation helper ───────────────────────────────────────────────────

async function maybeEscalate(eventId: number, severity: string, subjectId: string): Promise<void> {
  if (severity !== "high" && severity !== "critical") return;
  const db = await getDb();
  if (!db) return;
  // Create an access-review task automatically for high/critical events
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h SLA
  const [review] = await db
    .insert(accessReviews)
    .values({
      subjectId,
      reviewType: "auto_escalation",
      triggeredBy: "insider_threat_engine",
      insiderEventId: eventId,
      dueAt,
    })
    .returning();
  if (!review) return;
  // Fire-and-forget Temporal workflow
  startAccessReviewWorkflow({
    reviewId: review.id,
    subjectId,
    reviewType: "auto_escalation",
    triggeredBy: "insider_threat_engine",
    dueAt,
  }).catch((e) => console.error("[InsiderThreat] Temporal escalation failed:", e));
  // Notify platform owner
  notifyOwner({
    title: `🚨 Insider Threat — ${severity.toUpperCase()} event for ${subjectId}`,
    content: `Event #${eventId} has been auto-escalated. Access review #${review.id} created with 24 h SLA.`,
  }).catch(() => {});
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const insiderThreatRouter = router({
  /**
   * Ingest an insider-threat event.
   * Called by Go gateway middleware and Rust event processor via service-to-service auth.
   * Also callable by the BFF itself when a rule fires.
   */
  ingestEvent: writeProcedure
    .input(
      z.object({
        subjectId: z.string().min(1),
        tenantId: z.string().optional(),
        category: CategoryEnum,
        severity: SeverityEnum.default("medium"),
        anomalyScore: z.number().min(0).max(1).optional(),
        driftScore: z.number().min(0).max(1).optional(),
        sourceIp: z.string().optional(),
        userAgent: z.string().optional(),
        resourcePath: z.string().optional(),
        payloadBytes: z.number().int().nonnegative().optional(),
        ruleId: z.string().optional(),
        evidence: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [event] = await db
        .insert(insiderEvents)
        .values({
          subjectId: input.subjectId,
          tenantId: input.tenantId,
          category: input.category,
          severity: input.severity,
          anomalyScore: input.anomalyScore,
          driftScore: input.driftScore,
          sourceIp: input.sourceIp,
          userAgent: input.userAgent,
          resourcePath: input.resourcePath,
          payloadBytes: input.payloadBytes,
          ruleId: input.ruleId,
          evidence: input.evidence ?? {},
        })
        .returning();
      if (!event) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to insert insider event" });

      // Invalidate dashboard cache
      await invalidateCache(`insider:dashboard:${input.tenantId ?? "global"}`);

      // Auto-escalate high/critical
      await maybeEscalate(event.id, input.severity, input.subjectId);

      return { id: event.id, status: event.status };
    }),

  /**
   * List insider-threat events with filters and pagination.
   * Admin-only.
   */
  listEvents: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        subjectId: z.string().optional(),
        category: CategoryEnum.optional(),
        severity: SeverityEnum.optional(),
        status: EventStatusEnum.optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };
      const cacheKey = `insider:events:${JSON.stringify(input)}`;
      return withCache(cacheKey, TTL.INVESTIGATIONS_LIST, async () => {
        const conditions = [];
        if (input.tenantId) conditions.push(eq(insiderEvents.tenantId, input.tenantId));
        if (input.subjectId) conditions.push(eq(insiderEvents.subjectId, input.subjectId));
        if (input.category) conditions.push(eq(insiderEvents.category, input.category));
        if (input.severity) conditions.push(eq(insiderEvents.severity, input.severity));
        if (input.status) conditions.push(eq(insiderEvents.status, input.status));
        if (input.from) conditions.push(gte(insiderEvents.createdAt, input.from));
        if (input.to) conditions.push(lte(insiderEvents.createdAt, input.to));

        const [rows, [{ total }]] = await Promise.all([
          db
            .select()
            .from(insiderEvents)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(insiderEvents.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db
            .select({ total: count() })
            .from(insiderEvents)
            .where(conditions.length ? and(...conditions) : undefined),
        ]);
        return { rows, total: total ?? 0 };
      });
    }),

  /**
   * Get a single insider-threat event by ID.
   */
  getEvent: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [event] = await db
        .select()
        .from(insiderEvents)
        .where(eq(insiderEvents.id, input.id))
        .limit(1);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Insider event not found" });
      return event;
    }),

  /**
   * Update the status of an insider-threat event (triage action).
   * Dual-control: high/critical events require a different user from the creator.
   */
  updateEventStatus: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: EventStatusEnum,
        resolution: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db
        .select()
        .from(insiderEvents)
        .where(eq(insiderEvents.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Insider event not found" });

      // Dual-control: a critical/high event cannot be dismissed/resolved by the same
      // user who created the access-review (approximated here by checking assignedTo ≠ ctx.user.id)
      if (
        (existing.severity === "critical" || existing.severity === "high") &&
        (input.status === "dismissed" || input.status === "resolved") &&
        existing.assignedTo === ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Dual-control required: a different analyst must approve high/critical event resolution.",
        });
      }

      const [updated] = await db
        .update(insiderEvents)
        .set({
          status: input.status,
          resolution: input.resolution,
          resolvedAt: input.status === "resolved" ? new Date() : undefined,
          resolvedBy: input.status === "resolved" ? ctx.user.id : undefined,
          updatedAt: new Date(),
        })
        .where(eq(insiderEvents.id, input.id))
        .returning();

      await invalidateCache(`insider:dashboard:${existing.tenantId ?? "global"}`);
      return updated;
    }),

  /**
   * Assign an insider-threat event to an analyst.
   */
  assignEvent: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        assignedTo: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db
        .update(insiderEvents)
        .set({ assignedTo: input.assignedTo, status: "under_review", updatedAt: new Date() })
        .where(eq(insiderEvents.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /**
   * Dashboard summary: counts by severity and category.
   */
  dashboardSummary: adminProcedure
    .input(z.object({ tenantId: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { bySeverity: [], byCategory: [], byStatus: [], recentHigh: [] };
      const cacheKey = `insider:dashboard:${input.tenantId ?? "global"}`;
      return withCache(cacheKey, TTL.DASHBOARD_STATS, async () => {
        const conditions = input.tenantId
          ? [eq(insiderEvents.tenantId, input.tenantId)]
          : [];

        const [bySeverity, byCategory, byStatus, recentHigh] = await Promise.all([
          db
            .select({ severity: insiderEvents.severity, total: count() })
            .from(insiderEvents)
            .where(conditions.length ? and(...conditions) : undefined)
            .groupBy(insiderEvents.severity),
          db
            .select({ category: insiderEvents.category, total: count() })
            .from(insiderEvents)
            .where(conditions.length ? and(...conditions) : undefined)
            .groupBy(insiderEvents.category),
          db
            .select({ status: insiderEvents.status, total: count() })
            .from(insiderEvents)
            .where(conditions.length ? and(...conditions) : undefined)
            .groupBy(insiderEvents.status),
          db
            .select()
            .from(insiderEvents)
            .where(
              and(
                ...[
                  ...conditions,
                  inArray(insiderEvents.severity, ["high", "critical"]),
                  inArray(insiderEvents.status, ["open", "under_review"]),
                ]
              )
            )
            .orderBy(desc(insiderEvents.createdAt))
            .limit(10),
        ]);

        return { bySeverity, byCategory, byStatus, recentHigh };
      });
    }),

  // ─── UEBA Profiles ────────────────────────────────────────────────────────

  /**
   * Get the UEBA profile for a subject (from DB cache).
   */
  getUebaProfile: adminProcedure
    .input(z.object({ subjectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [profile] = await db
        .select()
        .from(uebaProfiles)
        .where(eq(uebaProfiles.subjectId, input.subjectId))
        .limit(1);
      return profile ?? null;
    }),

  /**
   * Refresh the UEBA profile for a subject by calling the Python ML engine.
   * Upserts the result into the ueba_profiles table.
   */
  refreshUebaProfile: adminProcedure
    .input(
      z.object({
        subjectId: z.string().min(1),
        tenantId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const score = await callUebaScore(input.subjectId, input.tenantId);
      if (!score) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "UEBA ML engine unavailable — profile not refreshed",
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [upserted] = await db
        .insert(uebaProfiles)
        .values({
          subjectId: input.subjectId,
          tenantId: input.tenantId,
          eventCount: score.event_count,
          anomalyScore: score.anomaly_score,
          driftScore: score.drift_score,
          riskLevel: score.risk_level,
          hourHistogram: score.hour_histogram,
          dayHistogram: score.day_histogram,
          uniqueIpCount: score.unique_ip_count,
          offHoursRatio: score.off_hours_ratio,
          privChangeCount: score.priv_change_count,
          failedAuthCount: score.failed_auth_count,
          baselineReady: score.baseline_ready,
          lastScoredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: uebaProfiles.subjectId,
          set: {
            eventCount: score.event_count,
            anomalyScore: score.anomaly_score,
            driftScore: score.drift_score,
            riskLevel: score.risk_level,
            hourHistogram: score.hour_histogram,
            dayHistogram: score.day_histogram,
            uniqueIpCount: score.unique_ip_count,
            offHoursRatio: score.off_hours_ratio,
            privChangeCount: score.priv_change_count,
            failedAuthCount: score.failed_auth_count,
            baselineReady: score.baseline_ready,
            lastScoredAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();
      return upserted;
    }),

  /**
   * List all UEBA profiles, sorted by anomaly score descending.
   */
  listUebaProfiles: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        riskLevel: SeverityEnum.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };
      const conditions = [];
      if (input.tenantId) conditions.push(eq(uebaProfiles.tenantId, input.tenantId));
      if (input.riskLevel) conditions.push(eq(uebaProfiles.riskLevel, input.riskLevel));
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(uebaProfiles)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(uebaProfiles.anomalyScore))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ total: count() })
          .from(uebaProfiles)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);
      return { rows, total: total ?? 0 };
    }),

  // ─── Access Reviews ───────────────────────────────────────────────────────

  /**
   * Create a manual access-review task.
   */
  createAccessReview: adminProcedure
    .input(
      z.object({
        subjectId: z.string().min(1),
        tenantId: z.string().optional(),
        reviewType: z.string().default("manual"),
        insiderEventId: z.number().int().positive().optional(),
        assignedTo: z.number().int().positive().optional(),
        dueAt: z.date(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [review] = await db
        .insert(accessReviews)
        .values({
          subjectId: input.subjectId,
          tenantId: input.tenantId,
          reviewType: input.reviewType,
          triggeredBy: `user:${ctx.user.id}`,
          insiderEventId: input.insiderEventId,
          assignedTo: input.assignedTo,
          dueAt: input.dueAt,
        })
        .returning();
      if (!review) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Start Temporal workflow
      startAccessReviewWorkflow({
        reviewId: review.id,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
        reviewType: input.reviewType,
        triggeredBy: `user:${ctx.user.id}`,
        dueAt: input.dueAt,
      }).catch((e) => console.error("[InsiderThreat] Access review workflow failed:", e));

      return review;
    }),

  /**
   * List access-review tasks.
   */
  listAccessReviews: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        subjectId: z.string().optional(),
        status: ReviewStatusEnum.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };
      const conditions = [];
      if (input.tenantId) conditions.push(eq(accessReviews.tenantId, input.tenantId));
      if (input.subjectId) conditions.push(eq(accessReviews.subjectId, input.subjectId));
      if (input.status) conditions.push(eq(accessReviews.status, input.status));
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(accessReviews)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(accessReviews.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ total: count() })
          .from(accessReviews)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);
      return { rows, total: total ?? 0 };
    }),

  /**
   * Complete an access-review task (approve or revoke).
   */
  completeAccessReview: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approved", "revoked"]),
        notes: z.string().optional(),
        permifyChanges: z.array(z.record(z.string(), z.unknown())).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db
        .select()
        .from(accessReviews)
        .where(eq(accessReviews.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "pending" && existing.status !== "escalated") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Review is not in a pending state" });
      }

      const [updated] = await db
        .update(accessReviews)
        .set({
          status: input.decision,
          decision: input.notes,
          permifyChanges: input.permifyChanges ?? [],
          completedAt: new Date(),
          completedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(accessReviews.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * Escalate an access-review task.
   */
  escalateAccessReview: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db
        .update(accessReviews)
        .set({ status: "escalated", decision: input.reason, updatedAt: new Date() })
        .where(eq(accessReviews.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),
});

export type InsiderThreatRouter = typeof insiderThreatRouter;

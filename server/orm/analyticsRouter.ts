/**
 * server/orm/analyticsRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Analytics tRPC Router
 *
 * Exposes all analytics query layer functions as tRPC procedures.
 * All procedures require authentication and tenant scoping.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  getDashboardStats,
  getInvestigationFunnel,
  getAmlTrends,
  getKycComplianceRate,
  getScreeningThroughput,
  getTenantUsageMetrics,
  refreshMaterializedViews,
} from "./analytics";
import { getRelationalDb } from "./index";

export const analyticsRouter = router({
  /**
   * Dashboard statistics — served from materialized view for speed.
   * Falls back to live query if view is not yet populated.
   */
  dashboardStats: protectedProcedure
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getDashboardStats(db, input.tenantId);
    }),

  /**
   * Investigation status funnel over time.
   */
  investigationFunnel: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      weeks: z.number().int().min(1).max(52).default(12),
    }))
    .query(async ({ input }) => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getInvestigationFunnel(db, input.tenantId, input.weeks);
    }),

  /**
   * AML alert trends over time.
   */
  amlTrends: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      days: z.number().int().min(7).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getAmlTrends(db, input.tenantId, input.days);
    }),

  /**
   * KYC compliance rate by month.
   */
  kycComplianceRate: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      months: z.number().int().min(1).max(24).default(12),
    }))
    .query(async ({ input }) => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getKycComplianceRate(db, input.tenantId, input.months);
    }),

  /**
   * Screening throughput metrics.
   */
  screeningThroughput: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      weeks: z.number().int().min(1).max(52).default(12),
    }))
    .query(async ({ input }) => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getScreeningThroughput(db, input.tenantId, input.weeks);
    }),

  /**
   * Platform-wide tenant usage metrics — admin only.
   */
  tenantUsageMetrics: adminProcedure
    .query(async () => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return getTenantUsageMetrics(db);
    }),

  /**
   * Manually trigger a refresh of all materialized views — admin only.
   * Normally this runs on a schedule (every 5 minutes via Temporal).
   */
  refreshViews: adminProcedure
    .mutation(async () => {
      const db = await getRelationalDb();
      if (!db) throw new Error("Database not available");
      return refreshMaterializedViews(db);
    }),
});

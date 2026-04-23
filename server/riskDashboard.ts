/**
 * Risk Dashboard Router
 *
 * Provides aggregated risk scoring data for the entity risk heatmap:
 * - Risk score distribution by entity type and sector
 * - Top high-risk entities
 * - Risk trend over time
 * - Sector-level risk aggregation
 */
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { investigations, kycRecords } from "../drizzle/schema";
import { desc, sql, gte, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const riskDashboardRouter = router({
  /**
   * Get aggregated risk data for the heatmap bubble chart.
   * Returns entities grouped by sector and risk score bucket.
   */
  getHeatmapData: protectedProcedure
    .input(z.object({
      days: z.number().min(7).max(365).default(90),
      minScore: z.number().min(0).max(100).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      // Get investigations with risk scores
      const invRows = await db.select({
        subjectName: investigations.subjectName,
        subjectType: investigations.subjectType,
        riskScore: investigations.riskScore,
        country: investigations.country,
        status: investigations.status,
        priority: investigations.priority,
        ref: investigations.ref,
        createdAt: investigations.createdAt,
      })
      .from(investigations)
      .where(and(
        gte(investigations.createdAt, since),
        sql`${investigations.riskScore} >= ${input.minScore}`
      ))
      .orderBy(desc(investigations.riskScore))
      .limit(500);

      // Get KYC records with risk scores
      const kycRows = await db.select({
        subjectName: kycRecords.subjectName,
        riskScore: kycRecords.riskScore,
        status: kycRecords.status,
        createdAt: kycRecords.createdAt,
      })
      .from(kycRecords)
      .where(and(
        gte(kycRecords.createdAt, since),
        sql`${kycRecords.riskScore} >= ${input.minScore}`
      ))
      .orderBy(desc(kycRecords.riskScore))
      .limit(500);

      // Sector mapping based on subject type / tier
      const getSector = (row: { subjectType?: string | null; tier?: string | null }) => {
        if (row.subjectType === "corporate") return "Corporate";
        if (row.tier === "comprehensive") return "High-Value Individual";
        if (row.tier === "standard") return "Standard Individual";
        return "Basic Individual";
      };

      // Build bubble chart data: group by sector x risk bucket
      const buckets: Record<string, {
        sector: string;
        riskBucket: string;
        count: number;
        avgScore: number;
        totalScore: number;
        entities: string[];
      }> = {};

      const addToBucket = (sector: string, score: number, name: string) => {
        const riskBucket =
          score >= 80 ? "Critical (80-100)" :
          score >= 60 ? "High (60-79)" :
          score >= 40 ? "Medium (40-59)" :
          "Low (0-39)";
        const key = `${sector}__${riskBucket}`;
        if (!buckets[key]) {
          buckets[key] = { sector, riskBucket, count: 0, avgScore: 0, totalScore: 0, entities: [] };
        }
        buckets[key].count += 1;
        buckets[key].totalScore += score ?? 0;
        buckets[key].entities.push(name);
      };

      for (const row of invRows) {
        addToBucket(getSector({ subjectType: row.subjectType }), row.riskScore ?? 0, row.subjectName);
      }
      for (const row of kycRows) {
        addToBucket("KYC Subject", row.riskScore ?? 0, row.subjectName);
      }

      const bubbles = Object.values(buckets).map(b => ({
        ...b,
        avgScore: b.count > 0 ? Math.round(b.totalScore / b.count) : 0,
        entities: b.entities.slice(0, 5), // top 5 entity names for tooltip
      }));

      // Top high-risk entities (combined)
      const topRisk = [
        ...invRows.slice(0, 10).map(r => ({
          name: r.subjectName,
          score: r.riskScore ?? 0,
          type: "investigation" as const,
          ref: r.ref,
          status: r.status,
          country: r.country,
        })),
        ...kycRows.slice(0, 10).map(r => ({
          name: r.subjectName,
          score: r.riskScore ?? 0,
          type: "kyc" as const,
          ref: null as string | null,
          status: r.status,
          country: null as string | null,
        })),
      ]
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

      // Risk distribution histogram (0-9, 10-19, ..., 90-100)
      const histogram = Array.from({ length: 10 }, (_, i) => ({
        bucket: `${i * 10}-${i * 10 + 9}`,
        count: 0,
      }));

      for (const row of invRows) {
        const idx = Math.min(9, Math.floor((row.riskScore ?? 0) / 10));
        histogram[idx].count += 1;
      }
      for (const row of kycRows) {
        const idx = Math.min(9, Math.floor((row.riskScore ?? 0) / 10));
        histogram[idx].count += 1;
      }

      // Summary stats
      const allScores = [
        ...invRows.map(r => r.riskScore ?? 0),
        ...kycRows.map(r => r.riskScore ?? 0),
      ];
      const totalEntities = allScores.length;
      const avgScore = totalEntities > 0
        ? Math.round(allScores.reduce((s, v) => s + v, 0) / totalEntities)
        : 0;
      const criticalCount = allScores.filter(s => s >= 80).length;
      const highCount = allScores.filter(s => s >= 60 && s < 80).length;

      return {
        bubbles,
        topRisk,
        histogram,
        summary: {
          totalEntities,
          avgScore,
          criticalCount,
          highCount,
          investigationCount: invRows.length,
          kycCount: kycRows.length,
        },
      };
    }),

  /**
   * Get risk trend over time (daily avg risk score).
   */
  getRiskTrend: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(180).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const rows = await db.select({
        date: sql<string>`DATE(${investigations.createdAt})`,
        avgScore: sql<number>`AVG(${investigations.riskScore})`,
        count: sql<number>`COUNT(*)`,
        criticalCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} >= 80 THEN 1 ELSE 0 END)`,
      })
      .from(investigations)
      .where(gte(investigations.createdAt, since))
      .groupBy(sql`DATE(${investigations.createdAt})`)
      .orderBy(sql`DATE(${investigations.createdAt})`);

      return rows.map(r => ({
        date: r.date,
        avgScore: Math.round(Number(r.avgScore ?? 0)),
        count: Number(r.count),
        criticalCount: Number(r.criticalCount ?? 0),
      }));
    }),

  /**
   * Get country-level risk aggregation.
   */
  getCountryRisk: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const rows = await db.select({
      country: investigations.country,
      count: sql<number>`COUNT(*)`,
      avgScore: sql<number>`AVG(${investigations.riskScore})`,
      criticalCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} >= 80 THEN 1 ELSE 0 END)`,
    })
    .from(investigations)
    .groupBy(investigations.country)
    .orderBy(desc(sql`AVG(${investigations.riskScore})`))
    .limit(20);

    return rows.map(r => ({
      country: r.country ?? "Unknown",
      count: Number(r.count),
      avgScore: Math.round(Number(r.avgScore ?? 0)),
      criticalCount: Number(r.criticalCount ?? 0),
    }));
  }),
});

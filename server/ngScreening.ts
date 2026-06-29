/**
 * Nigerian Background Screening Router
 * ─────────────────────────────────────
 * Checkr.com-equivalent for the Nigerian market.
 * Regulatory basis: NDPR 2019, CBN AML/CFT, EFCC Act, ICPC Act,
 *                   CAC Act 2020, Labour Act, Immigration Act, NIMC Act.
 *
 * Data sources:
 *   Identity   — NIMC NIN, NIBSS BVN
 *   Criminal   — NPF, EFCC watchlist, ICPC debarment list, state/federal courts
 *   Education  — WAEC, NECO, NABTEB
 *   Employment — Employer verification, PenCom pension history, NYSC discharge
 *   Licences   — COREN, NBA, MDCN, ICAN, CIBN, NSE, NIPR, TOPREC, ARCON
 *   Corporate  — CAC RC/BN directorship search
 *   Transport  — FRSC driver licence + commercial vehicle records
 *   Immigration— NIS work permit verification
 *   Watchlist  — PEP/sanctions, adverse media (NG)
 */

import { router, protectedProcedure, adminProcedure, writeProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, ilike, sql, count, inArray, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import {
  candidateProfiles,
  screeningPackages,
  screeningPrograms,
  screeningOrders,
  screeningResults,
  adverseActions,
  adverseItems,
  candidateConsents,
  workPermits,
  worksites,
  screeningGeos,
  candidateStories,
  reportTags,
  screeningAssessments,
  ngCourtRecords,
  ngProfessionalLicences,
  continuousChecks,
  auditLog,
  users,
} from "../drizzle/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRef(prefix: string): string {
  const { randomBytes } = require("crypto");
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${new Date().getFullYear()}-${rand}`;
}

function maskNin(nin: string): string {
  return nin.replace(/^(\d{3})\d{5}(\d{3})$/, "$1*****$2");
}

function maskBvn(bvn: string): string {
  return bvn.replace(/^(\d{3})\d{5}(\d{3})$/, "$1*****$2");
}

async function publishScreeningEvent(
  orderRef: string,
  eventType: string,
  payload: unknown
) {
  try {
    const GATEWAY_URL = ENV.bisGatewayUrl;
    const GATEWAY_KEY = ENV.bisGatewayKey;
    await fetch(`${GATEWAY_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
      body: JSON.stringify({
        event_type: eventType,
        subject_ref: orderRef,
        subject_id: orderRef,
        severity: "info",
        payload,
        source_service: "bis-ng-screening",
      }),
    });
  } catch {
    // non-fatal
  }
}

async function callVerifyApi(
  url: string | undefined,
  key: string | undefined,
  body: unknown
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (!url || !key) return { success: false, error: "API not configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data?.message ?? `HTTP ${res.status}` };
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Candidate Router ─────────────────────────────────────────────────────────

const candidateRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [];
      if (ctx.tenantId !== null) conditions.push(eq(candidateProfiles.tenantId, ctx.tenantId!));
      if (input.search) {
        conditions.push(
          sql`(${ilike(candidateProfiles.firstName, `%${input.search}%`)} OR
               ${ilike(candidateProfiles.lastName, `%${input.search}%`)} OR
               ${ilike(candidateProfiles.email, `%${input.search}%`)})`
        );
      }
      if (input.status) conditions.push(eq(candidateProfiles.consentStatus, input.status as any));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select().from(candidateProfiles).where(where)
          .orderBy(desc(candidateProfiles.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(candidateProfiles).where(where),
      ]);
      // Mask sensitive fields before returning
      return {
        items: items.map(c => ({
          ...c,
          nin: c.nin ? maskNin(c.nin) : null,
          bvn: c.bvn ? maskBvn(c.bvn) : null,
        })),
        total: Number(countResult[0]?.count ?? 0),
      };
    }),

  get: protectedProcedure
    .input(z.object({ ref: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const conditions = [eq(candidateProfiles.candidateRef, input.ref)];
      if (ctx.tenantId !== null) conditions.push(eq(candidateProfiles.tenantId, ctx.tenantId!));
      const result = await db.select().from(candidateProfiles).where(and(...conditions)).limit(1);
      const c = result[0];
      if (!c) return null;
      return {
        ...c,
        nin: c.nin ? maskNin(c.nin) : null,
        bvn: c.bvn ? maskBvn(c.bvn) : null,
      };
    }),

  invite: writeProcedure
    .input(z.object({
      firstName: z.string().min(1),
      middleName: z.string().optional(),
      lastName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      nationality: z.string().default("Nigerian"),
      packageId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const candidateRef = generateRef("CAND");
      const { randomBytes } = require("crypto");
      const inviteToken = randomBytes(32).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await db.insert(candidateProfiles).values({
        candidateRef,
        tenantId: ctx.tenantId!,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        nationality: input.nationality,
        consentStatus: "invited",
        inviteToken,
        inviteExpiresAt,
        invitedBy: ctx.user!.id,
      });
      // Publish Kafka event
      await publishScreeningEvent(candidateRef, "CANDIDATE_INVITED", {
        candidateRef, email: input.email, tenantId: ctx.tenantId,
      });
      return { candidateRef, inviteToken };
    }),

  update: writeProcedure
    .input(z.object({
      ref: z.string(),
      phone: z.string().optional(),
      currentAddress: z.string().optional(),
      currentState: z.string().optional(),
      currentLga: z.string().optional(),
      stateOfOrigin: z.string().optional(),
      lgaOfOrigin: z.string().optional(),
      dob: z.string().optional(),
      gender: z.string().optional(),
      passportNumber: z.string().optional(),
      passportExpiry: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { ref, ...fields } = input;
      await db.update(candidateProfiles)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(
          eq(candidateProfiles.candidateRef, ref),
          eq(candidateProfiles.tenantId, ctx.tenantId!)
        ));
      return { success: true };
    }),
});

// ─── Packages Router ──────────────────────────────────────────────────────────

const packagesRouter = router({
  list: protectedProcedure
    .input(z.object({
      includePublic: z.boolean().default(true),
      tier: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input.includePublic) {
        conditions.push(
          sql`(${eq(screeningPackages.tenantId, ctx.tenantId!)} OR ${eq(screeningPackages.isPublic, true)})`
        );
      } else {
        conditions.push(eq(screeningPackages.tenantId, ctx.tenantId!));
      }
      if (input.tier) conditions.push(eq(screeningPackages.tier, input.tier as any));
      return db.select().from(screeningPackages)
        .where(and(...conditions))
        .orderBy(screeningPackages.tier, screeningPackages.name);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(screeningPackages).where(eq(screeningPackages.id, input.id)).limit(1);
      return result[0] ?? null;
    }),

  create: writeProcedure
    .input(z.object({
      name: z.string().min(2),
      description: z.string().optional(),
      tier: z.enum(["basic", "standard", "executive", "transport", "healthcare", "financial", "custom"]).default("standard"),
      screeningTypes: z.array(z.string()).min(1),
      priceNgn: z.number().min(0).default(0),
      etaHours: z.number().min(1).default(48),
      isPublic: z.boolean().default(false),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const packageRef = generateRef("PKG");
      await db.insert(screeningPackages).values({
        packageRef,
        tenantId: ctx.tenantId!,
        ...input,
        config: input.config as any,
        createdBy: ctx.user!.id,
      });
      return { packageRef };
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      screeningTypes: z.array(z.string()).optional(),
      priceNgn: z.number().optional(),
      etaHours: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...fields } = input;
      await db.update(screeningPackages)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(screeningPackages.id, id), eq(screeningPackages.tenantId, ctx.tenantId!)));
      return { success: true };
    }),
});

// ─── Orders Router ────────────────────────────────────────────────────────────

const ordersRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      outcome: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [eq(screeningOrders.tenantId, ctx.tenantId!)];
      if (input.status) conditions.push(eq(screeningOrders.status, input.status as any));
      if (input.outcome) conditions.push(eq(screeningOrders.overallOutcome, input.outcome as any));
      const where = and(...conditions);
      const [items, countResult] = await Promise.all([
        db.select({
          order: screeningOrders,
          candidateFirstName: candidateProfiles.firstName,
          candidateLastName: candidateProfiles.lastName,
          candidateEmail: candidateProfiles.email,
        })
          .from(screeningOrders)
          .leftJoin(candidateProfiles, eq(screeningOrders.candidateId, candidateProfiles.id))
          .where(where)
          .orderBy(desc(screeningOrders.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  get: protectedProcedure
    .input(z.object({ ref: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const [orderRow] = await db.select().from(screeningOrders)
        .where(and(
          eq(screeningOrders.orderRef, input.ref),
          eq(screeningOrders.tenantId, ctx.tenantId!)
        )).limit(1);
      if (!orderRow) return null;
      const results = await db.select().from(screeningResults)
        .where(eq(screeningResults.orderId, orderRow.id))
        .orderBy(screeningResults.screeningType);
      return { order: orderRow, results };
    }),

  create: writeProcedure
    .input(z.object({
      candidateRef: z.string(),
      packageId: z.number().optional(),
      screeningTypes: z.array(z.string()).min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Resolve candidate
      const [candidate] = await db.select().from(candidateProfiles)
        .where(and(
          eq(candidateProfiles.candidateRef, input.candidateRef),
          eq(candidateProfiles.tenantId, ctx.tenantId!)
        )).limit(1);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });

      // Check NDPR consent
      const [consent] = await db.select().from(candidateConsents)
        .where(and(
          eq(candidateConsents.candidateId, candidate.id),
          sql`${candidateConsents.revokedAt} IS NULL`
        )).limit(1);
      if (!consent) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NDPR consent required before screening" });

      const orderRef = generateRef("ORD");
      const etaAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(screeningOrders).values({
          orderRef,
          tenantId: ctx.tenantId!,
          candidateId: candidate.id,
          packageId: input.packageId,
          status: "pending",
          screeningTypes: input.screeningTypes as any,
          etaAt,
          notes: input.notes,
          createdBy: ctx.user!.id,
        }).returning({ id: screeningOrders.id });

        // Create one result row per screening type
        const resultRows = input.screeningTypes.map(st => ({
          orderId: inserted.id,
          screeningType: st as any,
          status: "pending" as const,
        }));
        if (resultRows.length > 0) await tx.insert(screeningResults).values(resultRows);
      });

      // Publish Kafka event for each screening type
      await publishScreeningEvent(orderRef, "SCREENING_ORDER_CREATED", {
        orderRef,
        candidateRef: input.candidateRef,
        screeningTypes: input.screeningTypes,
        tenantId: ctx.tenantId,
      });

      return { orderRef, etaAt };
    }),

  cancel: writeProcedure
    .input(z.object({ ref: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(screeningOrders)
        .set({ status: "failed", notes: input.reason, updatedAt: new Date() })
        .where(and(
          eq(screeningOrders.orderRef, input.ref),
          eq(screeningOrders.tenantId, ctx.tenantId!)
        ));
      return { success: true };
    }),
});

// ─── Screening Execution Router ───────────────────────────────────────────────

const executeRouter = router({
  /**
   * NIN Trace — NIMC identity + address history
   */
  ninTrace: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      nin: z.string().length(11),
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      // Call NIMC/YouVerify API
      const apiResult = await callVerifyApi(
        ENV.bisVerifyNimcUrl,
        ENV.bisVerifyNimcKey,
        { nin: input.nin, firstName: input.firstName, lastName: input.lastName, dob: input.dob }
      );

      const outcome = apiResult.success ? "clear" : "consider";
      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: apiResult.success
            ? `NIN verified: ${input.nin.slice(0, 3)}***${input.nin.slice(-3)}`
            : `NIN verification failed: ${apiResult.error}`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(screeningResults.orderId, order.id),
          eq(screeningResults.screeningType, "nin_trace")
        ));

      await publishScreeningEvent(input.orderRef, "SCREENING_RESULT_UPDATED", {
        orderRef: input.orderRef, type: "nin_trace", outcome,
      });
      return { outcome, success: apiResult.success };
    }),

  /**
   * BVN Fraud Check — NIBSS BVN verification
   */
  bvnCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      bvn: z.string().length(11),
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        { bvn: input.bvn, firstName: input.firstName, lastName: input.lastName }
      );

      const outcome = apiResult.success ? "clear" : "consider";
      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: apiResult.success ? "BVN verified with NIBSS" : `BVN check failed: ${apiResult.error}`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "bvn_fraud_check")));

      return { outcome, success: apiResult.success };
    }),

  /**
   * Criminal Record Check — NPF, EFCC watchlist, ICPC debarment
   */
  criminalCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      type: z.enum(["npf_criminal", "efcc_watchlist", "icpc_debarment", "ndlea_drug"]),
      firstName: z.string(),
      lastName: z.string(),
      nin: z.string().optional(),
      dob: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      // Call YouVerify/CAC API for criminal check
      const apiResult = await callVerifyApi(
        ENV.bisVerifyCacUrl,
        ENV.bisVerifyCacKey,
        {
          check_type: input.type,
          first_name: input.firstName,
          last_name: input.lastName,
          nin: input.nin,
          dob: input.dob,
        }
      );

      const hasHit = (apiResult.data as any)?.hit === true;
      const outcome = hasHit ? "adverse" : "clear";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: hasHit
            ? `Record found in ${input.type.replace(/_/g, " ").toUpperCase()}`
            : `No record found in ${input.type.replace(/_/g, " ").toUpperCase()}`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, input.type)));

      return { outcome, hasHit };
    }),

  /**
   * Court Record Check — state and federal courts
   */
  courtCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      type: z.enum(["state_court", "federal_court"]),
      firstName: z.string(),
      lastName: z.string(),
      state: z.string().optional(),
      nin: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyCacUrl,
        ENV.bisVerifyCacKey,
        {
          check_type: input.type,
          first_name: input.firstName,
          last_name: input.lastName,
          state: input.state,
          nin: input.nin,
        }
      );

      const records = (apiResult.data as any)?.records ?? [];
      const outcome = records.length > 0 ? "consider" : "clear";

      const [result] = await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: records.length > 0
            ? `${records.length} court record(s) found`
            : "No court records found",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, input.type)))
        .returning({ id: screeningResults.id });

      // Persist individual court records
      if (records.length > 0 && result) {
        const [candidate] = await db.select().from(candidateProfiles)
          .where(eq(candidateProfiles.id, order.candidateId)).limit(1);
        const courtRows = records.map((r: any) => ({
          resultId: result.id,
          candidateId: order.candidateId,
          courtType: (r.court_type ?? "high_court") as any,
          courtName: r.court_name,
          state: r.state ?? input.state,
          caseNumber: r.case_number,
          offence: r.offence,
          verdict: r.verdict,
          sentence: r.sentence,
          hearingDate: r.hearing_date,
          dispositionDate: r.disposition_date,
          rawData: r,
        }));
        await db.insert(ngCourtRecords).values(courtRows);
      }

      return { outcome, recordCount: records.length };
    }),

  /**
   * Education Verification — WAEC, NECO, NABTEB
   */
  educationCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      type: z.enum(["waec_education", "neco_education", "nabteb_education"]),
      examNumber: z.string(),
      year: z.number().int().min(1980).max(new Date().getFullYear()),
      candidateName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: input.type,
          exam_number: input.examNumber,
          year: input.year,
          candidate_name: input.candidateName,
        }
      );

      const verified = (apiResult.data as any)?.verified === true;
      const outcome = verified ? "clear" : apiResult.success ? "unverified" : "consider";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: verified
            ? `${input.type.replace(/_/g, " ").toUpperCase()} certificate verified for ${input.year}`
            : `Certificate not verified`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, input.type)));

      return { outcome, verified };
    }),

  /**
   * Employment Verification
   */
  employmentCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      employerName: z.string(),
      employerRcNumber: z.string().optional(),
      candidateName: z.string(),
      jobTitle: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      employerPhone: z.string().optional(),
      employerEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      // Employment verification is primarily manual/phone-based in Nigeria
      // We record the attempt and mark as pending for manual follow-up
      await db.update(screeningResults)
        .set({
          status: "processing",
          rawResult: { employerName: input.employerName, rcNumber: input.employerRcNumber, candidateName: input.candidateName } as any,
          summary: `Employment verification initiated with ${input.employerName}`,
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "employment_verification")));

      return { status: "processing", message: "Employment verification initiated — awaiting employer response" };
    }),

  /**
   * NYSC Discharge Certificate Verification
   */
  nyscCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      callUpNumber: z.string(),
      stateCode: z.string(),
          year: z.number().int().min(1973).max(new Date().getFullYear()),
      candidateName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: "nysc_discharge",
          call_up_number: input.callUpNumber,
          state_code: input.stateCode,
          year: input.year,
          candidate_name: input.candidateName,
        }
      );

      const verified = (apiResult.data as any)?.verified === true;
      const outcome = verified ? "clear" : "unverified";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: verified
            ? `NYSC discharge certificate verified (${input.year})`
            : "NYSC discharge certificate not verified",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "nysc_discharge")));

      return { outcome, verified };
    }),

  /**
   * Professional Licence Verification — COREN, NBA, MDCN, ICAN, etc.
   */
  professionalLicenceCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      professionalBody: z.enum([
        "COREN", "NBA", "MDCN", "ICAN", "CIBN", "NIM", "NSE", "NIPR",
        "TOPREC", "ARCON", "ICSAN", "ACCA", "CIS", "CIPD", "HRCI"
      ]),
      licenceNumber: z.string(),
      candidateName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyCacUrl,
        ENV.bisVerifyCacKey,
        {
          check_type: "professional_licence",
          professional_body: input.professionalBody,
          licence_number: input.licenceNumber,
          candidate_name: input.candidateName,
        }
      );

      const data = apiResult.data as any;
      const status = data?.status ?? (apiResult.success ? "clear" : "unverified");
      const outcome = status === "active" ? "clear"
        : status === "suspended" ? "suspended_licence"
        : status === "revoked" ? "revoked_licence"
        : "unverified";

      const [result] = await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: `${input.professionalBody} licence ${outcome === "clear" ? "verified and active" : outcome}`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "professional_licence")))
        .returning({ id: screeningResults.id });

      // Persist licence record
      if (result) {
        await db.insert(ngProfessionalLicences).values({
          resultId: result.id,
          candidateId: order.candidateId,
          professionalBody: input.professionalBody as any,
          licenceNumber: input.licenceNumber,
          membershipGrade: data?.grade,
          issueDate: data?.issue_date,
          expiryDate: data?.expiry_date,
          status: outcome as any,
          suspensionReason: data?.suspension_reason,
          verificationDate: new Date().toISOString().split("T")[0] as any,
          rawData: apiResult.data as any,
        });
      }

      return { outcome };
    }),

  /**
   * CAC Directorship Search
   */
  cacDirectorship: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      candidateName: z.string(),
      nin: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyCacUrl,
        ENV.bisVerifyCacKey,
        { check_type: "cac_directorship", candidate_name: input.candidateName, nin: input.nin }
      );

      const companies = (apiResult.data as any)?.companies ?? [];
      const outcome = "clear"; // Directorship itself is not adverse; context matters

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: companies.length > 0
            ? `Director/shareholder in ${companies.length} company(ies)`
            : "No CAC directorship records found",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "cac_directorship")));

      return { outcome, companyCount: companies.length, companies };
    }),

  /**
   * PEP & Sanctions Check
   */
  pepCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      candidateName: z.string(),
      dob: z.string().optional(),
      nationality: z.string().default("NG"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: "pep_sanctions",
          name: input.candidateName,
          dob: input.dob,
          nationality: input.nationality,
        }
      );

      const isPep = (apiResult.data as any)?.is_pep === true;
      const isSanctioned = (apiResult.data as any)?.is_sanctioned === true;
      const outcome = isSanctioned ? "adverse" : isPep ? "consider" : "clear";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: isSanctioned
            ? "SANCTIONED — on active sanctions list"
            : isPep
            ? "PEP — politically exposed person"
            : "No PEP or sanctions match",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "pep_check")));

      return { outcome, isPep, isSanctioned };
    }),

  /**
   * FRSC Driver Licence Verification
   */
  frscCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      type: z.enum(["frsc_mvr", "frsc_commercial_driver"]),
      licenceNumber: z.string(),
      candidateName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: input.type,
          licence_number: input.licenceNumber,
          candidate_name: input.candidateName,
        }
      );

      const data = apiResult.data as any;
      const isValid = data?.valid === true;
      const isSuspended = data?.suspended === true;
      const outcome = isSuspended ? "suspended_licence" : isValid ? "clear" : "unverified";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: isSuspended
            ? "FRSC licence suspended"
            : isValid
            ? `FRSC licence valid — expires ${data?.expiry ?? "unknown"}`
            : "FRSC licence not verified",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, input.type)));

      return { outcome, isValid, isSuspended };
    }),

  /**
   * Adverse Media Check (Nigeria-focused)
   */
  adverseMediaCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      candidateName: z.string(),
      aliases: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: "adverse_media",
          name: input.candidateName,
          aliases: input.aliases ?? [],
          country: "NG",
        }
      );

      const hits = (apiResult.data as any)?.hits ?? [];
      const outcome = hits.length > 0 ? "consider" : "clear";

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: hits.length > 0
            ? `${hits.length} adverse media mention(s) found`
            : "No adverse media found",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "adverse_media_ng")));

      return { outcome, hitCount: hits.length };
    }),

  /**
   * Work Permit Verification (NIS)
   */
  workPermitCheck: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      permitNumber: z.string(),
      permitType: z.enum(["expatriate_quota", "combined_expatriate_residence_permit", "temporary_work_permit", "subject_to_regularisation", "business_visa"]),
      candidateName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      const apiResult = await callVerifyApi(
        ENV.bisVerifyNimcUrl,
        ENV.bisVerifyNimcKey,
        {
          check_type: "nis_work_permit",
          permit_number: input.permitNumber,
          permit_type: input.permitType,
          candidate_name: input.candidateName,
        }
      );

      const data = apiResult.data as any;
      const isValid = data?.valid === true;
      const isExpired = data?.expired === true;
      const outcome = isExpired ? "adverse" : isValid ? "clear" : "unverified";

      // Persist work permit record
      await db.insert(workPermits).values({
        permitRef: generateRef("WP"),
        candidateId: order.candidateId,
        orderId: order.id,
        permitType: input.permitType as any,
        permitNumber: input.permitNumber,
        issueDate: data?.issue_date,
        expiryDate: data?.expiry_date,
        verificationStatus: outcome as any,
        verificationData: apiResult.data as any,
      });

      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: isExpired
            ? `Work permit EXPIRED — ${data?.expiry_date}`
            : isValid
            ? `Work permit valid — expires ${data?.expiry_date}`
            : "Work permit not verified",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, "nis_work_permit")));

      return { outcome, isValid, isExpired };
    }),

  /**
   * FRSC Quick Check — one-shot MVR check that creates a candidate, consent, order,
   * and result row internally, then calls the FRSC API.
   * Returns the full MVRResult shape expected by MVRCheckPage.
   */
  frscQuickCheck: writeProcedure
    .input(z.object({
      licenceNumber: z.string().min(3),
      candidateName: z.string().min(2),
      type: z.enum(["frsc_mvr", "frsc_commercial_driver"]).default("frsc_mvr"),
      subjectId: z.string().optional(),
      country: z.string().default("NG"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Create a transient candidate profile
      const candidateRef = generateRef("CAND");
      const [nameParts] = [input.candidateName.trim().split(/\s+/)];
      const firstName = nameParts[0] ?? input.candidateName;
      const lastName = nameParts.slice(1).join(" ") || firstName;
      const { randomBytes } = require("crypto");
      const inviteToken = randomBytes(32).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [candidate] = await db.insert(candidateProfiles).values({
        candidateRef,
        tenantId: ctx.tenantId!,
        firstName,
        lastName,
        email: `${candidateRef.toLowerCase()}@frsc-check.internal`,
        nationality: "Nigerian",
        consentStatus: "submitted",
        inviteToken,
        inviteExpiresAt,
        ndprConsentAt: new Date(),
        invitedBy: ctx.user!.id,
      }).returning({ id: candidateProfiles.id });

      // 2. Record NDPR consent
      const consentRef = generateRef("CON");
      await db.insert(candidateConsents).values({
        consentRef,
        candidateId: candidate.id,
        purpose: "pre_employment",
        consentText: "Automated FRSC licence verification consent recorded by BIS platform.",
        signedAt: new Date(),
      });

      // 3. Create a screening order
      const orderRef = generateRef("ORD");
      const etaAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const [order] = await db.insert(screeningOrders).values({
        orderRef,
        tenantId: ctx.tenantId!,
        candidateId: candidate.id,
        status: "pending",
        screeningTypes: [input.type] as any,
        etaAt,
        createdBy: ctx.user!.id,
      }).returning({ id: screeningOrders.id });

      // 4. Create a screening result row
      await db.insert(screeningResults).values({
        orderId: order.id,
        screeningType: input.type as any,
        status: "pending",
      });

      // 5. Call FRSC API
      const apiResult = await callVerifyApi(
        ENV.bisVerifyNibssUrl,
        ENV.bisVerifyNibssKey,
        {
          check_type: input.type,
          licence_number: input.licenceNumber,
          candidate_name: input.candidateName,
        }
      );

      const data = apiResult.data as any;
      const isValid = data?.valid === true;
      const isSuspended = data?.suspended === true;
      const isRevoked = data?.revoked === true;
      const outcome = isRevoked ? "revoked_licence"
        : isSuspended ? "suspended_licence"
        : isValid ? "clear"
        : "unverified";

      // 6. Update the result row
      await db.update(screeningResults)
        .set({
          status: "completed",
          outcome: outcome as any,
          rawResult: apiResult.data as any,
          summary: isRevoked
            ? "FRSC licence revoked"
            : isSuspended
            ? "FRSC licence suspended"
            : isValid
            ? `FRSC licence valid — expires ${data?.expiry ?? "unknown"}`
            : "FRSC licence not verified",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(screeningResults.orderId, order.id), eq(screeningResults.screeningType, input.type)));

      // 7. Update order status
      await db.update(screeningOrders)
        .set({
          status: "completed",
          overallOutcome: outcome as any,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(screeningOrders.id, order.id));

      // 8. Build MVRResult shape
      const violations: Array<{
        date: string;
        description: string;
        severity: "minor" | "moderate" | "major" | "fatal";
        points: number;
        disposition: string;
        state: string;
      }> = (data?.violations ?? []).map((v: any) => ({
        date: v.date ?? new Date().toISOString().split("T")[0],
        description: v.description ?? v.offence ?? "Traffic violation",
        severity: (v.severity ?? "minor") as "minor" | "moderate" | "major" | "fatal",
        points: Number(v.points ?? 1),
        disposition: v.disposition ?? "Convicted",
        state: v.state ?? "Unknown",
      }));

      const totalPoints = violations.reduce((s, v) => s + v.points, 0);
      const accidentsCount = Number(data?.accidents_count ?? 0);
      const duiCount = Number(data?.dui_count ?? 0);
      const suspensionsCount = isSuspended ? 1 : 0;
      const riskScore = Math.min(100,
        (violations.length * 5) + (accidentsCount * 10) + (duiCount * 20) + (suspensionsCount * 25) + (isRevoked ? 50 : 0)
      );
      const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
      const recommendation = isRevoked
        ? "REJECT. Licence revoked."
        : isSuspended
        ? "REJECT. Licence currently suspended."
        : riskLevel === "high"
        ? "CONSIDER. Significant driving violations on record."
        : riskLevel === "medium"
        ? "REVIEW. Some violations on record — manual review recommended."
        : "APPROVE. Clean or low-risk driving record.";

      const licenseStatus: "valid" | "expired" | "suspended" | "revoked" | "not_found" =
        isRevoked ? "revoked"
        : isSuspended ? "suspended"
        : isValid ? "valid"
        : data?.expired === true ? "expired"
        : "not_found";

      return {
        orderRef,
        subjectId: input.subjectId ?? candidateRef,
        country: input.country,
        licenseNumber: input.licenceNumber,
        licenseStatus,
        licenseClass: data?.licence_class ?? data?.class ?? "B",
        licenseExpiry: data?.expiry ?? data?.expiry_date ?? "",
        totalPoints,
        violations,
        accidentsCount,
        duiCount,
        suspensionsCount,
        riskScore,
        riskLevel,
        recommendation,
        dataSource: "FRSC (Federal Road Safety Corps)",
        verifiedAt: new Date().toISOString(),
      };
    }),

  /**
   * Mark result for manual review / update outcome
   */
  updateResult: writeProcedure
    .input(z.object({
      resultId: z.number(),
      outcome: z.enum(["clear", "consider", "suspended_licence", "revoked_licence", "adverse", "pending", "unverified"]),
      summary: z.string().optional(),
      reviewNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(screeningResults)
        .set({
          outcome: input.outcome as any,
          summary: input.summary,
          status: "completed",
          updatedAt: new Date(),
        })
        .where(eq(screeningResults.id, input.resultId));
      return { success: true };
    }),
});

// ─── Adverse Action Router ────────────────────────────────────────────────────

const adverseActionRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [];
      // Filter by tenant via order join
      const [items, countResult] = await Promise.all([
        db.select({
          adverse: adverseActions,
          orderRef: screeningOrders.orderRef,
          candidateFirstName: candidateProfiles.firstName,
          candidateLastName: candidateProfiles.lastName,
          candidateEmail: candidateProfiles.email,
        })
          .from(adverseActions)
          .leftJoin(screeningOrders, eq(adverseActions.orderId, screeningOrders.id))
          .leftJoin(candidateProfiles, eq(adverseActions.candidateId, candidateProfiles.id))
          .where(eq(screeningOrders.tenantId, ctx.tenantId!))
          .orderBy(desc(adverseActions.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(adverseActions)
          .leftJoin(screeningOrders, eq(adverseActions.orderId, screeningOrders.id))
          .where(eq(screeningOrders.tenantId, ctx.tenantId!)),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  initiate: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      reason: z.string().min(10),
      adverseItemIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      const [candidate] = await db.select().from(candidateProfiles)
        .where(eq(candidateProfiles.id, order.candidateId)).limit(1);

      const adverseRef = generateRef("ADV");
      // NDPR: 5 business days for candidate to respond
      const preAdverseDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

      await db.insert(adverseActions).values({
        adverseRef,
        orderId: order.id,
        candidateId: order.candidateId,
        status: "pre_adverse_sent",
        preAdverseSentAt: new Date(),
        preAdverseDeadline,
        candidateEmail: candidate?.email,
        reason: input.reason,
        createdBy: ctx.user!.id,
      });

      await publishScreeningEvent(input.orderRef, "ADVERSE_ACTION_INITIATED", {
        adverseRef, orderRef: input.orderRef, candidateEmail: candidate?.email,
      });

      return { adverseRef, preAdverseDeadline };
    }),

  dispute: writeProcedure
    .input(z.object({
      adverseRef: z.string(),
      disputeNote: z.string().min(10),
      itemIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(adverseActions)
        .set({
          status: "dispute_received",
          disputeReceivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(adverseActions.adverseRef, input.adverseRef));

      if (input.itemIds?.length) {
        await db.update(adverseItems)
          .set({ disputed: true, disputeNote: input.disputeNote })
          .where(inArray(adverseItems.id, input.itemIds));
      }

      return { success: true };
    }),

  resolve: writeProcedure
    .input(z.object({
      adverseRef: z.string(),
      outcome: z.enum(["final_adverse_sent", "withdrawn", "cleared"]),
      reviewNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(adverseActions)
        .set({
          status: input.outcome as any,
          disputeResolvedAt: new Date(),
          finalAdverseSentAt: input.outcome === "final_adverse_sent" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(adverseActions.adverseRef, input.adverseRef));

      await publishScreeningEvent(input.adverseRef, "ADVERSE_ACTION_RESOLVED", {
        adverseRef: input.adverseRef, outcome: input.outcome,
      });

      return { success: true };
    }),
});

// ─── Consent Router ───────────────────────────────────────────────────────────

const consentRouter = router({
  record: writeProcedure
    .input(z.object({
      candidateRef: z.string(),
      purpose: z.enum(["pre_employment", "employment", "contractor", "volunteer", "tenancy", "financial_services", "healthcare", "government"]),
      consentText: z.string().min(50),
      signatureData: z.string().optional(),
      signerIp: z.string().optional(),
      signerUserAgent: z.string().optional(),
      orderId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [candidate] = await db.select().from(candidateProfiles)
        .where(and(
          eq(candidateProfiles.candidateRef, input.candidateRef),
          eq(candidateProfiles.tenantId, ctx.tenantId!)
        )).limit(1);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND" });

      const consentRef = generateRef("CON");
      await db.insert(candidateConsents).values({
        consentRef,
        candidateId: candidate.id,
        orderId: input.orderId,
        purpose: input.purpose as any,
        consentText: input.consentText,
        signatureData: input.signatureData,
        signedAt: new Date(),
        signerIp: input.signerIp,
        signerUserAgent: input.signerUserAgent,
      });

      // Update candidate consent status
      await db.update(candidateProfiles)
        .set({ ndprConsentAt: new Date(), ndprConsentIp: input.signerIp, consentStatus: "submitted", updatedAt: new Date() })
        .where(eq(candidateProfiles.id, candidate.id));

      return { consentRef };
    }),

  revoke: writeProcedure
    .input(z.object({
      consentRef: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(candidateConsents)
        .set({ revokedAt: new Date(), revokeReason: input.reason })
        .where(eq(candidateConsents.consentRef, input.consentRef));
      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ candidateRef: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [candidate] = await db.select().from(candidateProfiles)
        .where(and(
          eq(candidateProfiles.candidateRef, input.candidateRef),
          eq(candidateProfiles.tenantId, ctx.tenantId!)
        )).limit(1);
      if (!candidate) return [];
      return db.select().from(candidateConsents)
        .where(eq(candidateConsents.candidateId, candidate.id))
        .orderBy(desc(candidateConsents.createdAt));
    }),
});

// ─── Continuous Checks Router ─────────────────────────────────────────────────

const continuousRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [eq(continuousChecks.tenantId, ctx.tenantId!)];
      if (input.status) conditions.push(eq(continuousChecks.status, input.status as any));
      const where = and(...conditions);
      const [items, countResult] = await Promise.all([
        db.select({
          check: continuousChecks,
          candidateFirstName: candidateProfiles.firstName,
          candidateLastName: candidateProfiles.lastName,
          candidateEmail: candidateProfiles.email,
        })
          .from(continuousChecks)
          .leftJoin(candidateProfiles, eq(continuousChecks.candidateId, candidateProfiles.id))
          .where(where)
          .orderBy(desc(continuousChecks.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(continuousChecks).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  subscribe: writeProcedure
    .input(z.object({
      candidateRef: z.string(),
      screeningTypes: z.array(z.string()).min(1),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly"]).default("monthly"),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [candidate] = await db.select().from(candidateProfiles)
        .where(and(
          eq(candidateProfiles.candidateRef, input.candidateRef),
          eq(candidateProfiles.tenantId, ctx.tenantId!)
        )).limit(1);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND" });

      const checkRef = generateRef("MON");
      const nextCheckAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.insert(continuousChecks).values({
        checkRef,
        tenantId: ctx.tenantId!,
        candidateId: candidate.id,
        screeningTypes: input.screeningTypes as any,
        frequency: input.frequency,
        status: "active",
        nextCheckAt,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        createdBy: ctx.user!.id,
      });

      return { checkRef, nextCheckAt };
    }),

  pause: writeProcedure
    .input(z.object({ checkRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(continuousChecks)
        .set({ status: "paused", updatedAt: new Date() })
        .where(and(eq(continuousChecks.checkRef, input.checkRef), eq(continuousChecks.tenantId, ctx.tenantId!)));
      return { success: true };
    }),

  cancel: writeProcedure
    .input(z.object({ checkRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(continuousChecks)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(continuousChecks.checkRef, input.checkRef), eq(continuousChecks.tenantId, ctx.tenantId!)));
      return { success: true };
    }),
});

// ─── Candidate Stories Router ─────────────────────────────────────────────────

const storiesRouter = router({
  submit: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      screeningType: z.string(),
      story: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      await db.insert(candidateStories).values({
        orderId: order.id,
        candidateId: order.candidateId,
        screeningType: input.screeningType as any,
        story: input.story,
      });

      return { success: true };
    }),

  review: writeProcedure
    .input(z.object({
      storyId: z.number(),
      reviewNote: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(candidateStories)
        .set({ reviewedBy: ctx.user!.id, reviewNote: input.reviewNote, reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(candidateStories.id, input.storyId));
      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ orderRef: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) return [];
      return db.select().from(candidateStories)
        .where(eq(candidateStories.orderId, order.id))
        .orderBy(desc(candidateStories.createdAt));
    }),
});

// ─── Geo Rules Router ─────────────────────────────────────────────────────────

const geoRouter = router({
  list: protectedProcedure
    .input(z.object({ state: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [
        sql`(${eq(screeningGeos.tenantId, ctx.tenantId!)} OR ${sql`${screeningGeos.tenantId} IS NULL`})`
      ];
      if (input.state) conditions.push(eq(screeningGeos.state, input.state));
      return db.select().from(screeningGeos).where(and(...conditions));
    }),

  upsert: adminProcedure
    .input(z.object({
      state: z.string(),
      screeningType: z.string(),
      lookbackYears: z.number().optional(),
      excludedOffences: z.array(z.string()).optional(),
      requiresConsent: z.boolean().default(true),
      disclosureText: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(screeningGeos)
        .where(and(
          eq(screeningGeos.state, input.state),
          eq(screeningGeos.screeningType, input.screeningType as any),
          eq(screeningGeos.tenantId, ctx.tenantId!)
        )).limit(1);

      if (existing.length > 0) {
        await db.update(screeningGeos)
          .set({ lookbackYears: input.lookbackYears, excludedOffences: input.excludedOffences as any, requiresConsent: input.requiresConsent, disclosureText: input.disclosureText, notes: input.notes, updatedAt: new Date() })
          .where(eq(screeningGeos.id, existing[0].id));
      } else {
        await db.insert(screeningGeos).values({
          state: input.state,
          screeningType: input.screeningType as any,
          tenantId: ctx.tenantId!,
          lookbackYears: input.lookbackYears,
          excludedOffences: input.excludedOffences as any,
          requiresConsent: input.requiresConsent,
          disclosureText: input.disclosureText,
          notes: input.notes,
        });
      }
      return { success: true };
    }),
});

// ─── Analytics Router ─────────────────────────────────────────────────────────

const analyticsRouter = router({
  summary: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const tenantFilter = eq(screeningOrders.tenantId, ctx.tenantId!);
      const [
        totalOrders,
        pendingOrders,
        completedOrders,
        clearCount,
        considerCount,
        adverseCount,
        totalCandidates,
        activeContinuous,
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(tenantFilter),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(and(tenantFilter, eq(screeningOrders.status, "pending"))),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(and(tenantFilter, eq(screeningOrders.status, "completed"))),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(and(tenantFilter, sql`${screeningOrders.overallOutcome} = 'clear'`)),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(and(tenantFilter, sql`${screeningOrders.overallOutcome} = 'consider'`)),
        db.select({ count: sql<number>`count(*)` }).from(screeningOrders).where(and(tenantFilter, sql`${screeningOrders.overallOutcome} = 'adverse'`)),
        db.select({ count: sql<number>`count(*)` }).from(candidateProfiles).where(eq(candidateProfiles.tenantId, ctx.tenantId!)),
        db.select({ count: sql<number>`count(*)` }).from(continuousChecks).where(and(eq(continuousChecks.tenantId, ctx.tenantId!), eq(continuousChecks.status, "active"))),
      ]);
      return {
        totalOrders: Number(totalOrders[0]?.count ?? 0),
        pendingOrders: Number(pendingOrders[0]?.count ?? 0),
        completedOrders: Number(completedOrders[0]?.count ?? 0),
        clearCount: Number(clearCount[0]?.count ?? 0),
        considerCount: Number(considerCount[0]?.count ?? 0),
        adverseCount: Number(adverseCount[0]?.count ?? 0),
        totalCandidates: Number(totalCandidates[0]?.count ?? 0),
        activeContinuousMonitors: Number(activeContinuous[0]?.count ?? 0),
      };
    }),
});

// ─── Root ngScreening Router ──────────────────────────────────────────────────

export const ngScreeningRouter = router({
  candidates:    candidateRouter,
  packages:      packagesRouter,
  orders:        ordersRouter,
  execute:       executeRouter,
  adverseAction: adverseActionRouter,
  consent:       consentRouter,
  continuous:    continuousRouter,
  stories:       storiesRouter,
  geo:           geoRouter,
  analytics:     analyticsRouter,
});

/**
 * LEX — Law Enforcement Extension Router
 * State-scoped criminal/incident reporting from third-party agencies.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lexAgencies, lexSubmissions, lexSubmitters, cases, caseParties, caseTimeline } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { protectedProcedure, publicProcedure, router, writeProcedure } from "./_core/trpc";

export const NIGERIAN_STATES: Record<string, string> = {
  AB: "Abia", AD: "Adamawa", AK: "Akwa Ibom", AN: "Anambra", BA: "Bauchi",
  BY: "Bayelsa", BE: "Benue", BO: "Borno", CR: "Cross River", DE: "Delta",
  EB: "Ebonyi", ED: "Edo", EK: "Ekiti", EN: "Enugu", GO: "Gombe",
  IM: "Imo", JI: "Jigawa", KD: "Kaduna", KN: "Kano", KT: "Katsina",
  KE: "Kebbi", KO: "Kogi", KW: "Kwara", LA: "Lagos", NA: "Nasarawa",
  NI: "Niger", OG: "Ogun", ON: "Ondo", OS: "Osun", OY: "Oyo",
  PL: "Plateau", RI: "Rivers", SO: "Sokoto", TA: "Taraba", YO: "Yobe",
  ZA: "Zamfara", FC: "FCT Abuja",
};

export const lexRouter = router({
  // ── Agency Management ──────────────────────────────────────────────────────

  listAgencies: protectedProcedure
    .input(z.object({
      state: z.string().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { agencies: [], total: 0 };
      const conditions: any[] = [];
      if (input?.state) conditions.push(eq(lexAgencies.state, input.state as any));
      if (input?.type) conditions.push(eq(lexAgencies.type, input.type as any));
      if (input?.status) conditions.push(eq(lexAgencies.status, input.status as any));
      if (input?.search) {
        const s = `%${input.search}%`;
        conditions.push(sql`(${lexAgencies.name} ILIKE ${s} OR ${lexAgencies.agencyCode} ILIKE ${s} OR ${lexAgencies.commandUnit} ILIKE ${s})`);
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, countRows] = await Promise.all([
        db.select().from(lexAgencies).where(where).orderBy(lexAgencies.state, lexAgencies.name).limit(input?.limit ?? 50).offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(lexAgencies).where(where),
      ]);
      return { agencies: rows, total: countRows[0]?.count ?? 0 };
    }),

  getAgency: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "NOT_FOUND" });
      const [agency] = await db.select().from(lexAgencies).where(eq(lexAgencies.id, input.id));
      if (!agency) throw new TRPCError({ code: "NOT_FOUND", message: "Agency not found" });
      const submitters = await db.select().from(lexSubmitters).where(eq(lexSubmitters.agencyId, input.id)).orderBy(lexSubmitters.name);
      return { agency, submitters };
    }),

  createAgency: writeProcedure
    .input(z.object({
      name: z.string().min(3),
      type: z.enum(["npf", "efcc", "icpc", "dss", "nscdc", "customs", "immigration", "other"]),
      state: z.string().length(2),
      lga: z.string().optional(),
      commandUnit: z.string().optional(),
      contactName: z.string().optional(),
      contactPhone: z.string().optional(),
      contactEmail: z.string().email().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Generate agency code: {TYPE}-{STATE}-{UNIT}-{SEQ}
      const unitSlug = (input.commandUnit ?? input.lga ?? "HQ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(lexAgencies).where(and(eq(lexAgencies.state, input.state as any), eq(lexAgencies.type, input.type as any)));
      const seq = String((countRows[0]?.count ?? 0) + 1).padStart(3, "0");
      const agencyCode = `${input.type.toUpperCase()}-${input.state}-${unitSlug}-${seq}`;
      const [agency] = await db.insert(lexAgencies).values({
        agencyCode,
        name: input.name,
        type: input.type as any,
        state: input.state as any,
        lga: input.lga,
        commandUnit: input.commandUnit,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        notes: input.notes,
        registeredBy: ctx.user.id,
      }).returning();
      try { const { auditLog } = await import("../drizzle/schema"); await db.insert(auditLog).values({ userId: ctx.user.id, category: "system" as any, action: `Registered LEX agency ${agencyCode}`, targetRef: String(agency.id), result: "success" }); } catch(e) { console.warn("[LEX Audit]", e); }
      return agency;
    }),

  updateAgencyStatus: writeProcedure
    .input(z.object({ id: z.number(), status: z.enum(["active", "suspended", "retired"]), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(lexAgencies).set({
        status: input.status as any,
        suspendedAt: input.status === "suspended" ? new Date() : null,
        suspendedReason: input.reason,
      }).where(eq(lexAgencies.id, input.id));
      try { const { auditLog } = await import("../drizzle/schema"); await db.insert(auditLog).values({ userId: ctx.user.id, category: "system" as any, action: `Agency status changed to ${input.status}`, targetRef: String(input.id), result: "success" }); } catch(e) { console.warn("[LEX Audit]", e); }
      return { success: true };
    }),

  // ── Submitter Management ───────────────────────────────────────────────────

  createSubmitter: writeProcedure
    .input(z.object({
      agencyId: z.number(),
      name: z.string().min(2),
      rank: z.string().optional(),
      phone: z.string().min(7),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { randomUUID, createHash } = await import("crypto");
      const submitterId = randomUUID();
      // Generate a 6-digit PIN and hash it (SHA-256 with submitterId as salt)
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const pinHash = createHash("sha256").update(pin + submitterId).digest("hex");
      const [submitter] = await db.insert(lexSubmitters).values({
        submitterId,
        agencyId: input.agencyId,
        name: input.name,
        rank: input.rank,
        phone: input.phone,
        pinHash,
      }).returning();
      try { const { auditLog } = await import("../drizzle/schema"); await db.insert(auditLog).values({ userId: ctx.user.id, category: "system" as any, action: `Created LEX submitter ${input.name}`, targetRef: String(submitter.id), result: "success" }); } catch(e) { console.warn("[LEX Audit]", e); }
      // Return the plain PIN once — it is never stored
      return { submitter, pin, submitterId };
    }),

  revokeSubmitter: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(lexSubmitters).set({ status: "revoked", revokedAt: new Date() }).where(eq(lexSubmitters.id, input.id));
      try { const { auditLog } = await import("../drizzle/schema"); await db.insert(auditLog).values({ userId: ctx.user.id, category: "system" as any, action: "Revoked LEX submitter", targetRef: String(input.id), result: "success" }); } catch(e) { console.warn("[LEX Audit]", e); }
      return { success: true };
    }),

  // ── Submission Management ──────────────────────────────────────────────────

  listSubmissions: protectedProcedure
    .input(z.object({
      state: z.string().optional(),
      status: z.string().optional(),
      incidentType: z.string().optional(),
      agencyId: z.number().optional(),
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { submissions: [], total: 0 };
      const conditions: any[] = [];
      if (input?.state) conditions.push(eq(lexSubmissions.incidentState, input.state as any));
      if (input?.status) conditions.push(eq(lexSubmissions.status, input.status as any));
      if (input?.incidentType) conditions.push(eq(lexSubmissions.incidentType, input.incidentType as any));
      if (input?.agencyId) conditions.push(eq(lexSubmissions.agencyId, input.agencyId));
      if (input?.search) {
        const s = `%${input.search}%`;
        conditions.push(sql`(${lexSubmissions.subjectName} ILIKE ${s} OR ${lexSubmissions.submissionRef} ILIKE ${s} OR ${lexSubmissions.subjectNin} ILIKE ${s})`);
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, countRows] = await Promise.all([
        db.select({
          id: lexSubmissions.id,
          submissionRef: lexSubmissions.submissionRef,
          incidentType: lexSubmissions.incidentType,
          incidentState: lexSubmissions.incidentState,
          subjectName: lexSubmissions.subjectName,
          status: lexSubmissions.status,
          validationScore: lexSubmissions.validationScore,
          channel: lexSubmissions.channel,
          incidentDate: lexSubmissions.incidentDate,
          createdAt: lexSubmissions.createdAt,
          agencyId: lexSubmissions.agencyId,
          agencyCode: lexAgencies.agencyCode,
          agencyName: lexAgencies.name,
        })
        .from(lexSubmissions)
        .leftJoin(lexAgencies, eq(lexSubmissions.agencyId, lexAgencies.id))
        .where(where)
        .orderBy(desc(lexSubmissions.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(lexSubmissions).where(where),
      ]);
      return { submissions: rows, total: countRows[0]?.count ?? 0 };
    }),

  getSubmission: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "NOT_FOUND" });
      const [row] = await db.select({
        submission: lexSubmissions,
        agency: lexAgencies,
      })
      .from(lexSubmissions)
      .leftJoin(lexAgencies, eq(lexSubmissions.agencyId, lexAgencies.id))
      .where(eq(lexSubmissions.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found" });
      return row;
    }),

  // Public submission endpoint — authenticated via submitterId + PIN
  submitIncident: publicProcedure
    .input(z.object({
      submitterId: z.string().uuid(),
      pin: z.string().length(6),
      incidentType: z.enum(["arrest", "seizure", "witness_statement", "court_order", "intel_tip", "missing_person", "homicide", "fraud", "cybercrime", "other"]),
      incidentLga: z.string().optional(),
      incidentAddress: z.string().optional(),
      gpsLat: z.number().optional(),
      gpsLng: z.number().optional(),
      incidentDate: z.date().optional(),
      subjectName: z.string().optional(),
      subjectNin: z.string().max(11).optional(),
      subjectPhone: z.string().optional(),
      subjectAddress: z.string().optional(),
      narrative: z.string().min(50),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Authenticate submitter
      const [submitter] = await db.select().from(lexSubmitters).where(and(eq(lexSubmitters.submitterId, input.submitterId), eq(lexSubmitters.status, "active")));
      if (!submitter) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid submitter credentials" });

      const { createHash } = await import("crypto");
      const expectedHash = createHash("sha256").update(input.pin + input.submitterId).digest("hex");
      if (submitter.pinHash !== expectedHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid PIN" });

      // Get agency to determine state (jurisdiction is always the agency's registered state)
      const [agency] = await db.select().from(lexAgencies).where(and(eq(lexAgencies.id, submitter.agencyId), eq(lexAgencies.status, "active")));
      if (!agency) throw new TRPCError({ code: "FORBIDDEN", message: "Agency is not active" });

      // Velocity check: max 5 submissions per submitter per 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [velocityRow] = await db.select({ count: sql<number>`count(*)::int` }).from(lexSubmissions).where(and(eq(lexSubmissions.submitterId, submitter.id), sql`${lexSubmissions.createdAt} > ${oneDayAgo}`));
      if ((velocityRow?.count ?? 0) >= 5) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Daily submission limit reached (5 per 24h)" });

      // Generate submission ref: LEX-{YEAR}-{STATE}-{SEQ}
      const year = new Date().getFullYear();
      const [seqRow] = await db.select({ count: sql<number>`count(*)::int` }).from(lexSubmissions).where(eq(lexSubmissions.incidentState, agency.state));
      const seq = String((seqRow?.count ?? 0) + 1).padStart(4, "0");
      const submissionRef = `LEX-${year}-${agency.state}-${seq}`;

      // Compute initial validation score
      let validationScore = 20; // structural pass
      const validationNotes: Record<string, any> = { structural: "pass", velocityCheck: "pass" };

      if (input.subjectNin || input.subjectPhone) { validationScore += 10; validationNotes.identityFields = "present"; }
      if (input.gpsLat && input.gpsLng) {
        validationScore += 10;
        // Geospatial jurisdiction check (Nigeria bounding box)
        const inNigeria = input.gpsLat >= 4.0 && input.gpsLat <= 14.0 && input.gpsLng >= 2.7 && input.gpsLng <= 15.0;
        if (!inNigeria) { validationScore -= 15; validationNotes.geospatial = "outside_nigeria"; }
        else validationNotes.geospatial = "pass";
      }
      // Reputation bonus
      if (submitter.reputationScore >= 50) { validationScore += 5; validationNotes.reputation = "good"; }

      const [submission] = await db.insert(lexSubmissions).values({
        submissionRef,
        agencyId: agency.id,
        submitterId: submitter.id,
        channel: "web",
        incidentType: input.incidentType as any,
        incidentState: agency.state, // Always use agency's registered state — jurisdiction enforcement
        incidentLga: input.incidentLga,
        incidentAddress: input.incidentAddress,
        gpsLat: input.gpsLat,
        gpsLng: input.gpsLng,
        incidentDate: input.incidentDate,
        subjectName: input.subjectName,
        subjectNin: input.subjectNin,
        subjectPhone: input.subjectPhone,
        subjectAddress: input.subjectAddress,
        narrative: input.narrative,
        validationScore,
        validationNotes,
      }).returning();

      // Update submitter stats
      await db.update(lexSubmitters).set({
        totalSubmissions: sql`${lexSubmitters.totalSubmissions} + 1`,
        lastSubmissionAt: new Date(),
      }).where(eq(lexSubmitters.id, submitter.id));

      return { submissionRef: submission.submissionRef, validationScore };
    }),

  reviewSubmission: writeProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["validate", "reject", "escalate"]),
      rejectionReason: z.string().optional(),
      linkedCaseId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const statusMap = { validate: "validated", reject: "rejected", escalate: "escalated" } as const;
      const [sub] = await db.select({ submitterId: lexSubmissions.submitterId }).from(lexSubmissions).where(eq(lexSubmissions.id, input.id));
      await db.update(lexSubmissions).set({
        status: statusMap[input.action] as any,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        linkedCaseId: input.linkedCaseId,
        rejectionReason: input.rejectionReason,
        updatedAt: new Date(),
      }).where(eq(lexSubmissions.id, input.id));
      // Update submitter reputation
      if (sub?.submitterId) {
        const delta = input.action === "validate" ? 10 : input.action === "reject" ? -15 : 0;
        if (delta !== 0) {
          await db.update(lexSubmitters).set({
            reputationScore: sql`${lexSubmitters.reputationScore} + ${delta}`,
            validatedSubmissions: input.action === "validate" ? sql`${lexSubmitters.validatedSubmissions} + 1` : lexSubmitters.validatedSubmissions,
            rejectedSubmissions: input.action === "reject" ? sql`${lexSubmitters.rejectedSubmissions} + 1` : lexSubmitters.rejectedSubmissions,
          }).where(eq(lexSubmitters.id, sub.submitterId));
        }
      }
      try { const { auditLog } = await import("../drizzle/schema"); await db.insert(auditLog).values({ userId: ctx.user.id, category: "system" as any, action: `Submission ${input.action}d`, targetRef: String(input.id), result: "success" }); } catch(e) { console.warn("[LEX Audit]", e); }
      return { success: true };
    }),

  // State-level statistics for the analytics panel
  stateStats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({
        state: lexSubmissions.incidentState,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'pending')::int`,
        validated: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'validated')::int`,
        rejected: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'rejected')::int`,
      }).from(lexSubmissions).groupBy(lexSubmissions.incidentState).orderBy(sql`count(*) desc`);
      return rows.map(r => ({ ...r, stateName: NIGERIAN_STATES[r.state] ?? r.state }));
    }),

  nigerianStates: publicProcedure
    .query(() => Object.entries(NIGERIAN_STATES).map(([code, name]) => ({ code, name }))),

  // Top agencies by submission volume
  agencyStats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({
        agencyId: lexSubmissions.agencyId,
        agencyCode: lexAgencies.agencyCode,
        agencyName: lexAgencies.name,
        state: lexAgencies.state,
        total: sql<number>`count(*)::int`,
        validated: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'validated')::int`,
        rejected: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'rejected')::int`,
        pending: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'pending')::int`,
      })
      .from(lexSubmissions)
      .leftJoin(lexAgencies, eq(lexSubmissions.agencyId, lexAgencies.id))
      .groupBy(lexSubmissions.agencyId, lexAgencies.agencyCode, lexAgencies.name, lexAgencies.state)
      .orderBy(sql`count(*) desc`)
      .limit(20);
      return rows.map(r => ({ ...r, stateName: NIGERIAN_STATES[r.state ?? ""] ?? r.state }));
    }),

  // Incident type breakdown across all submissions
  incidentTypeStats: protectedProcedure
    .input(z.object({ state: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions: any[] = [];
      if (input?.state) conditions.push(eq(lexSubmissions.incidentState, input.state as any));
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db.select({
        incidentType: lexSubmissions.incidentType,
        total: sql<number>`count(*)::int`,
        validated: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'validated')::int`,
      })
      .from(lexSubmissions)
      .where(where)
      .groupBy(lexSubmissions.incidentType)
      .orderBy(sql`count(*) desc`);
      return rows;
    }),

  // Monthly trend (last 12 months)
  monthlyTrend: protectedProcedure
    .input(z.object({ state: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions: any[] = [
        sql`${lexSubmissions.createdAt} >= now() - interval '12 months'`,
      ];
      if (input?.state) conditions.push(eq(lexSubmissions.incidentState, input.state as any));
      const rows = await db.select({
        month: sql<string>`to_char(date_trunc('month', ${lexSubmissions.createdAt}), 'YYYY-MM')`,
        total: sql<number>`count(*)::int`,
        validated: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'validated')::int`,
        rejected: sql<number>`count(*) filter (where ${lexSubmissions.status} = 'rejected')::int`,
      })
      .from(lexSubmissions)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('month', ${lexSubmissions.createdAt})`)
      .orderBy(sql`date_trunc('month', ${lexSubmissions.createdAt})`);
      return rows;
    }),

  // ── Form LEX-01 PDF generation ──
  generateLex01Pdf: protectedProcedure
    .input(z.object({ submissionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [sub] = await db.select().from(lexSubmissions).where(eq(lexSubmissions.id, input.submissionId)).limit(1);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND" });
      const [agency] = await db.select().from(lexAgencies).where(eq(lexAgencies.id, sub.agencyId)).limit(1);

      // Generate QR code as base64 data URL
      const qrcode = await import("qrcode");
      const qrDataUrl = await qrcode.toDataURL(`LEX:${sub.submissionRef}`, { width: 120, margin: 1 });

      const stateName = NIGERIAN_STATES[sub.incidentState] ?? sub.incidentState;
      const agencyStateName = NIGERIAN_STATES[agency?.state ?? ""] ?? agency?.state ?? "";
      const incidentDate = sub.incidentDate ? new Date(sub.incidentDate).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" }) : "Not specified";
      const submittedAt = new Date(sub.createdAt).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

      const validationBadge = sub.status === "validated" ? `<span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;">VALIDATED</span>`
        : sub.status === "rejected" ? `<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;">REJECTED</span>`
        : `<span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;">PENDING REVIEW</span>`;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 0; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 16px; }
  .header-left h1 { font-size: 18px; font-weight: bold; color: #1e3a5f; margin: 0 0 2px; }
  .header-left p { font-size: 10px; color: #666; margin: 0; }
  .ref-box { background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 8px 12px; text-align: center; }
  .ref-box .ref { font-size: 14px; font-weight: bold; color: #1e3a5f; letter-spacing: 1px; }
  .ref-box .label { font-size: 9px; color: #666; text-transform: uppercase; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #1e3a5f; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; margin-bottom: 8px; letter-spacing: 0.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  .field label { font-size: 9px; color: #888; text-transform: uppercase; display: block; }
  .field span { font-size: 11px; font-weight: 500; }
  .narrative { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 10px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; }
  .footer { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: flex; justify-content: space-between; font-size: 9px; color: #888; }
  .sig-box { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 16px; min-width: 160px; text-align: center; }
  .sig-box .sig-label { font-size: 9px; color: #888; margin-top: 24px; border-top: 1px solid #d1d5db; padding-top: 4px; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 72px; color: rgba(30,58,95,0.04); font-weight: bold; pointer-events: none; white-space: nowrap; }
</style>
</head>
<body>
<div class="watermark">OFFICIAL USE ONLY</div>
<div class="header">
  <div class="header-left">
    <h1>FORM LEX-01 — INCIDENT SUBMISSION REPORT</h1>
    <p>Law Enforcement Extension (LEX) — Background Intelligence System (BIS) — Federal Republic of Nigeria</p>
    <p style="margin-top:4px">Status: ${validationBadge} &nbsp; Submitted: ${submittedAt}</p>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
    <img src="${qrDataUrl}" width="80" height="80" alt="QR" />
    <div class="ref-box">
      <div class="label">Submission Ref</div>
      <div class="ref">${sub.submissionRef}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">1. Reporting Agency</div>
  <div class="grid">
    <div class="field"><label>Agency Name</label><span>${agency?.name ?? "—"}</span></div>
    <div class="field"><label>Agency Code</label><span>${agency?.agencyCode ?? "—"}</span></di    <div class="field"><label>Agency Type</label><span>${(agency?.type ?? "\u2014").toUpperCase()}</span></div>   <div class="field"><label>Registered State</label><span>${agencyStateName}</span></div>
    <div class="field"><label>Command Unit / LGA</label><span>${agency?.commandUnit ?? agency?.lga ?? "—"}</span></div>
    <div class="field"><label>Submission Channel</label><span>${sub.channel.toUpperCase()}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">2. Incident Details</div>
  <div class="grid">
    <div class="field"><label>Incident Type</label><span>${sub.incidentType.replace(/_/g, " ").toUpperCase()}</span></div>
    <div class="field"><label>Incident Date</label><span>${incidentDate}</span></div>
    <div class="field"><label>State</label><span>${stateName}</span></div>
    <div class="field"><label>LGA</label><span>${sub.incidentLga ?? "—"}</span></div>
    <div class="field" style="grid-column:span 2"><label>Address</label><span>${sub.incidentAddress ?? "—"}</span></div>
    ${sub.gpsLat ? `<div class="field"><label>GPS Coordinates</label><span>${sub.gpsLat.toFixed(6)}, ${sub.gpsLng?.toFixed(6)}</span></div>` : ""}
  </div>
</div>

<div class="section">
  <div class="section-title">3. Subject Information</div>
  <div class="grid">
    <div class="field"><label>Full Name</label><span>${sub.subjectName ?? "Not provided"}</span></div>
    <div class="field"><label>NIN</label><span>${sub.subjectNin ?? "Not provided"}</span></div>
    <div class="field"><label>Phone</label><span>${sub.subjectPhone ?? "Not provided"}</span></div>
    <div class="field" style="grid-column:span 2"><label>Address</label><span>${sub.subjectAddress ?? "—"}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">4. Incident Narrative</div>
  <div class="narrative">${sub.narrative}</div>
</div>

${sub.validationScore != null ? `
<div class="section">
  <div class="section-title">5. Validation</div>
  <div class="grid">
    <div class="field"><label>Validation Score</label><span>${sub.validationScore}/100</span></div>
    <div class="field"><label>Review Status</label><span>${sub.status.toUpperCase()}</span></div>
    ${sub.rejectionReason ? `<div class="field" style="grid-column:span 2"><label>Rejection Reason</label><span>${sub.rejectionReason}</span></div>` : ""}
  </div>
</div>` : ""}

<div class="footer">
  <div>
    <div class="sig-box"><div class="sig-label">Submitting Officer Signature</div></div>
  </div>
  <div>
    <div class="sig-box"><div class="sig-label">Supervisor Countersignature</div></div>
  </div>
  <div style="text-align:right">
    <p>Form LEX-01 — Generated by BIS LEX Module</p>
    <p>For official use only. Unauthorised disclosure is an offence.</p>
    <p>Ref: ${sub.submissionRef} — ${new Date().toISOString()}</p>
  </div>
</div>
</body></html>`;

      // Convert HTML to PDF using weasyprint
      const { execSync } = await import("child_process");
      const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
      const { storagePut } = await import("./storage");
      const tmpHtml = `/tmp/lex01_${sub.submissionRef}.html`;
      const tmpPdf = `/tmp/lex01_${sub.submissionRef}.pdf`;
      writeFileSync(tmpHtml, html);
      execSync(`weasyprint "${tmpHtml}" "${tmpPdf}"`, { timeout: 30000 });
      const pdfBuffer = readFileSync(tmpPdf);
      unlinkSync(tmpHtml);
      unlinkSync(tmpPdf);

      const { url } = await storagePut(`lex/forms/${sub.submissionRef}-LEX01.pdf`, pdfBuffer, "application/pdf");
      return { url, filename: `LEX-01_${sub.submissionRef}.pdf` };
    }),

  // ── Auto-linking: find matching cases by NIN, phone, or LLM name similarity ──
  findMatchingCases: protectedProcedure
    .input(z.object({ submissionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [sub] = await db.select().from(lexSubmissions).where(eq(lexSubmissions.id, input.submissionId)).limit(1);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND" });

      const matches: Array<{
        caseId: number; caseRef: string; caseTitle: string;
        matchType: "nin" | "phone" | "name_similarity"; confidence: number; matchedParty: string;
      }> = [];

      // 1. Exact NIN match
      if (sub.subjectNin) {
        const ninMatches = await db.select({
          caseId: caseParties.caseId,
          caseRef: cases.ref,
          caseTitle: cases.title,
          partyName: caseParties.name,
        })
        .from(caseParties)
        .innerJoin(cases, eq(caseParties.caseId, cases.id))
        .where(eq(caseParties.nin, sub.subjectNin))
        .limit(10);
        for (const m of ninMatches) {
          matches.push({ caseId: m.caseId, caseRef: m.caseRef, caseTitle: m.caseTitle, matchType: "nin", confidence: 100, matchedParty: m.partyName });
        }
      }

      // 2. Exact phone match
      if (sub.subjectPhone) {
        const phoneMatches = await db.select({
          caseId: caseParties.caseId,
          caseRef: cases.ref,
          caseTitle: cases.title,
          partyName: caseParties.name,
        })
        .from(caseParties)
        .innerJoin(cases, eq(caseParties.caseId, cases.id))
        .where(eq(caseParties.phone, sub.subjectPhone))
        .limit(10);
        for (const m of phoneMatches) {
          if (!matches.find(x => x.caseId === m.caseId)) {
            matches.push({ caseId: m.caseId, caseRef: m.caseRef, caseTitle: m.caseTitle, matchType: "phone", confidence: 95, matchedParty: m.partyName });
          }
        }
      }

      // 3. LLM name similarity (only if subject name provided and no exact matches yet)
      if (sub.subjectName && matches.length === 0) {
        // Fetch recent case parties with names
        const recentParties = await db.select({
          caseId: caseParties.caseId,
          caseRef: cases.ref,
          caseTitle: cases.title,
          partyName: caseParties.name,
        })
        .from(caseParties)
        .innerJoin(cases, eq(caseParties.caseId, cases.id))
        .orderBy(desc(caseParties.createdAt))
        .limit(100);

        if (recentParties.length > 0) {
          const partyList = recentParties.map(p => `[${p.caseRef}] ${p.partyName} (Case: ${p.caseTitle})`).join("\n");
          try {
            const llmResult = await invokeLLM({
              messages: [
                { role: "system" as const, content: "You are a name-matching assistant. Given a subject name and a list of case parties, identify which parties are likely the same person (accounting for spelling variations, aliases, and transliterations). Return JSON only." },
                { role: "user" as const, content: `Subject name: "${sub.subjectName}"\n\nCase parties:\n${partyList}\n\nReturn JSON: { "matches": [{ "caseRef": string, "partyName": string, "confidence": number (0-100), "reason": string }] }` },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "name_matches",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      matches: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            caseRef: { type: "string" },
                            partyName: { type: "string" },
                            confidence: { type: "number" },
                            reason: { type: "string" },
                          },
                          required: ["caseRef", "partyName", "confidence", "reason"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["matches"],
                    additionalProperties: false,
                  },
                },
              },
            });
            const rawContent = llmResult?.choices?.[0]?.message?.content;
            const content = typeof rawContent === "string" ? rawContent : null;
            if (content) {
              const parsed = JSON.parse(content) as { matches: Array<{ caseRef: string; partyName: string; confidence: number; reason: string }> };
              for (const m of parsed.matches.filter(x => x.confidence >= 60)) {
                const party = recentParties.find(p => p.caseRef === m.caseRef);
                if (party && !matches.find(x => x.caseId === party.caseId)) {
                  matches.push({ caseId: party.caseId, caseRef: party.caseRef, caseTitle: party.caseTitle, matchType: "name_similarity", confidence: m.confidence, matchedParty: m.partyName });
                }
              }
            }
          } catch { /* LLM failure is non-fatal */ }
        }
      }

      return { submissionRef: sub.submissionRef, subjectName: sub.subjectName, matches };
    }),

  // Link a validated submission to an existing case
  linkToCase: protectedProcedure
    .input(z.object({ submissionId: z.number(), caseId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [sub] = await db.select().from(lexSubmissions).where(eq(lexSubmissions.id, input.submissionId)).limit(1);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND" });
      const [targetCase] = await db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
      if (!targetCase) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      await db.update(lexSubmissions).set({ linkedCaseId: input.caseId, updatedAt: new Date() }).where(eq(lexSubmissions.id, input.submissionId));

      // Add timeline entry to the case
      await db.insert(caseTimeline).values({
        caseId: input.caseId,
        eventType: "note_added" as any,
        title: "LEX Submission Linked",
        detail: { submissionRef: sub.submissionRef, subjectName: sub.subjectName ?? "Unknown", incidentType: sub.incidentType },
        actorId: ctx.user.id,
        actorName: ctx.user.name ?? "Analyst",
        createdAt: new Date(),
      });

      return { ok: true, caseRef: targetCase.ref };
    }),
});

/**
 * LEX — Law Enforcement Extension Router
 * State-scoped criminal/incident reporting from third-party agencies.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lexAgencies, lexSubmissions, lexSubmitters } from "../drizzle/schema";
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
});

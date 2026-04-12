/**
 * platform.ts — Production-readiness routers:
 * - sessionsRouter: list/revoke active user sessions
 * - totpRouter: TOTP/2FA setup, verify, disable
 * - notificationsRouter: in-app notification centre
 * - investigationLinksRouter: investigation ↔ case linking
 * - exportSchedulesRouter: scheduled data export management
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  userSessions,
  userTotpSecrets,
  notifications,
  investigationCaseLinks,
  exportSchedules,
  investigations,
  cases,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { adminProcedure, protectedProcedure, router, writeProcedure } from "./_core/trpc";
import * as crypto from "crypto";

// ─── Sessions Router ──────────────────────────────────────────────────────────
export const sessionsRouter = router({
  /** List all active sessions for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const now = new Date();
    const rows = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, ctx.user.id),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
        )
      )
      .orderBy(desc(userSessions.lastActiveAt));
    return rows;
  }),

  /** Revoke a specific session */
  revoke: writeProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [session] = await db
        .select()
        .from(userSessions)
        .where(and(eq(userSessions.id, input.sessionId), eq(userSessions.userId, ctx.user.id)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, input.sessionId));
      return { ok: true };
    }),

  /** Revoke all sessions except the current one */
  revokeAll: writeProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const result = await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, ctx.user.id), isNull(userSessions.revokedAt)));
    return { ok: true, revoked: result.rowCount ?? 0 };
  }),

  /** Admin: list all sessions across all users */
  adminList: adminProcedure
    .input(z.object({ userId: z.number().optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const where = input.userId ? eq(userSessions.userId, input.userId) : undefined;
      const [rows, [{ count }]] = await Promise.all([
        db.select().from(userSessions).where(where).orderBy(desc(userSessions.lastActiveAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(userSessions).where(where),
      ]);
      return { sessions: rows, total: Number(count) };
    }),
});

// ─── TOTP / 2FA Router ────────────────────────────────────────────────────────
export const totpRouter = router({
  /** Get current 2FA status for the logged-in user */
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [record] = await db
      .select({ verified: userTotpSecrets.verified, enabledAt: userTotpSecrets.enabledAt })
      .from(userTotpSecrets)
      .where(eq(userTotpSecrets.userId, ctx.user.id))
      .limit(1);
    return { enabled: !!record?.verified, enabledAt: record?.enabledAt ?? null };
  }),

  /** Generate a new TOTP secret and return the otpauth URI for QR code display */
  setup: writeProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    // Generate a random 20-byte base32 secret
    const secretBytes = crypto.randomBytes(20);
    const secret = secretBytes.toString("base64").replace(/[^A-Z2-7]/gi, "").toUpperCase().slice(0, 32);
    // Generate 10 backup codes
    const backupCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );
    // Upsert the TOTP record (unverified)
    await db
      .insert(userTotpSecrets)
      .values({ userId: ctx.user.id, secret, verified: false, backupCodes, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userTotpSecrets.userId,
        set: { secret, verified: false, backupCodes, updatedAt: new Date() },
      });
    const issuer = "BIS%20Platform";
    const account = encodeURIComponent(ctx.user.email ?? ctx.user.openId ?? "user");
    const otpauthUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUri, backupCodes };
  }),

  /** Verify a TOTP code to complete 2FA enrollment */
  verify: writeProcedure
    .input(z.object({ code: z.string().length(6).regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [record] = await db
        .select()
        .from(userTotpSecrets)
        .where(eq(userTotpSecrets.userId, ctx.user.id))
        .limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "TOTP setup not initiated" });
      // Validate TOTP code using time-based algorithm
      const isValid = validateTotp(record.secret, input.code);
      if (!isValid) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid TOTP code" });
      await db
        .update(userTotpSecrets)
        .set({ verified: true, enabledAt: new Date(), updatedAt: new Date() })
        .where(eq(userTotpSecrets.userId, ctx.user.id));
      return { ok: true };
    }),

  /** Disable 2FA */
  disable: writeProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await db.delete(userTotpSecrets).where(eq(userTotpSecrets.userId, ctx.user.id));
    return { ok: true };
  }),
});

/** Simple TOTP validation (RFC 6238, SHA1, 6 digits, 30s window) */
function validateTotp(secret: string, code: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor((now + offset * 30) / 30);
    const expected = generateHotp(secret, counter);
    if (expected === code) return true;
  }
  return false;
}

function generateHotp(secret: string, counter: number): string {
  // Decode base32 secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase()) {
    const idx = base32Chars.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  // Counter as 8-byte big-endian
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", bytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return code.toString().padStart(6, "0");
}

// ─── Notifications Router ─────────────────────────────────────────────────────
export const notificationsRouter = router({
  /** List notifications for the current user */
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const where = input.unreadOnly
        ? and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false))
        : eq(notifications.userId, ctx.user.id);
      const [rows, [{ count }]] = await Promise.all([
        db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(notifications).where(where),
      ]);
      return { notifications: rows, total: Number(count), unread: rows.filter(n => !n.read).length };
    }),

  /** Mark a notification as read */
  markRead: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { ok: true };
    }),

  /** Mark all notifications as read */
  markAllRead: writeProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const result = await db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
    return { ok: true, marked: result.rowCount ?? 0 };
  }),

  /** Unread count for badge */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
    return { count: Number(count) };
  }),

  /** Create a notification (admin/system use) */
  create: adminProcedure
    .input(z.object({ userId: z.number(), type: z.string().max(64), title: z.string().max(255), body: z.string().optional(), link: z.string().max(512).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.insert(notifications).values({ ...input }).returning();
      return row;
    }),

  /** Broadcast a notification to all users (admin only) */
  broadcast: adminProcedure
    .input(z.object({ type: z.string().max(64), title: z.string().max(255), body: z.string().optional(), link: z.string().max(512).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const allUsers = await db.select({ id: users.id }).from(users);
      if (allUsers.length === 0) return { ok: true, sent: 0 };
      await db.insert(notifications).values(allUsers.map(u => ({ userId: u.id, ...input })));
      return { ok: true, sent: allUsers.length };
    }),

  /** Delete a notification */
  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(notifications).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { ok: true };
    }),
});

// ─── Investigation-Case Links Router ─────────────────────────────────────────
export const investigationLinksRouter = router({
  /** List all cases linked to an investigation */
  listForInvestigation: protectedProcedure
    .input(z.object({ investigationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db
        .select({
          id: investigationCaseLinks.id,
          caseId: investigationCaseLinks.caseId,
          notes: investigationCaseLinks.notes,
          createdAt: investigationCaseLinks.createdAt,
          linkedBy: investigationCaseLinks.linkedBy,
          caseRef: cases.ref,
          caseTitle: cases.title,
          caseStatus: cases.status,
          casePriority: cases.priority,
        })
        .from(investigationCaseLinks)
        .innerJoin(cases, eq(cases.id, investigationCaseLinks.caseId))
        .where(eq(investigationCaseLinks.investigationId, input.investigationId))
        .orderBy(desc(investigationCaseLinks.createdAt));
      return rows;
    }),

  /** List all investigations linked to a case */
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db
        .select({
          id: investigationCaseLinks.id,
          investigationId: investigationCaseLinks.investigationId,
          notes: investigationCaseLinks.notes,
          createdAt: investigationCaseLinks.createdAt,
          linkedBy: investigationCaseLinks.linkedBy,
          invRef: investigations.ref,
          invSubjectName: investigations.subjectName,
          invStatus: investigations.status,
          invRiskScore: investigations.riskScore,
        })
        .from(investigationCaseLinks)
        .innerJoin(investigations, eq(investigations.id, investigationCaseLinks.investigationId))
        .where(eq(investigationCaseLinks.caseId, input.caseId))
        .orderBy(desc(investigationCaseLinks.createdAt));
      return rows;
    }),

  /** Link an investigation to a case */
  link: writeProcedure
    .input(z.object({ investigationId: z.number(), caseId: z.number(), notes: z.string().max(1000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Check both exist
      const [inv] = await db.select({ id: investigations.id }).from(investigations).where(eq(investigations.id, input.investigationId)).limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
      const [cas] = await db.select({ id: cases.id }).from(cases).where(eq(cases.id, input.caseId)).limit(1);
      if (!cas) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      const [link] = await db
        .insert(investigationCaseLinks)
        .values({ investigationId: input.investigationId, caseId: input.caseId, linkedBy: ctx.user.id, notes: input.notes ?? null })
        .onConflictDoNothing()
        .returning();
      return link ?? { ok: true, alreadyLinked: true };
    }),

  /** Unlink an investigation from a case */
  unlink: writeProcedure
    .input(z.object({ linkId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(investigationCaseLinks).where(eq(investigationCaseLinks.id, input.linkId));
      return { ok: true };
    }),
});

// ─── Export Schedules Router ──────────────────────────────────────────────────
export const exportSchedulesRouter = router({
  /** List all export schedules for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(exportSchedules).where(eq(exportSchedules.userId, ctx.user.id)).orderBy(desc(exportSchedules.createdAt));
  }),

  /** Create a new export schedule */
  create: writeProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      exportType: z.enum(["cases", "investigations", "lex_submissions", "audit_log"]),
      format: z.enum(["csv", "json"]).default("csv"),
      filters: z.record(z.string(), z.unknown()).optional(),
      cronExpression: z.string().max(64).default("0 8 * * 1"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Calculate next run from cron expression (simplified: next Monday 8am)
      const nextRunAt = getNextCronRun(input.cronExpression);
      const [row] = await db
        .insert(exportSchedules)
        .values({ ...input, userId: ctx.user.id, nextRunAt, updatedAt: new Date() })
        .returning();
      return row;
    }),

  /** Update an export schedule */
  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      cronExpression: z.string().max(64).optional(),
      enabled: z.boolean().optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [schedule] = await db.select().from(exportSchedules).where(and(eq(exportSchedules.id, input.id), eq(exportSchedules.userId, ctx.user.id))).limit(1);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, ...updates } = input;
      const nextRunAt = updates.cronExpression ? getNextCronRun(updates.cronExpression) : undefined;
      const [updated] = await db
        .update(exportSchedules)
        .set({ ...updates, ...(nextRunAt ? { nextRunAt } : {}), updatedAt: new Date() })
        .where(eq(exportSchedules.id, id))
        .returning();
      return updated;
    }),

  /** Delete an export schedule */
  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(exportSchedules).where(and(eq(exportSchedules.id, input.id), eq(exportSchedules.userId, ctx.user.id)));
      return { ok: true };
    }),

  /** Run an export now (returns download URL) */
  runNow: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [schedule] = await db.select().from(exportSchedules).where(and(eq(exportSchedules.id, input.id), eq(exportSchedules.userId, ctx.user.id))).limit(1);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
      // Generate CSV/JSON export based on type
      let content = "";
      const now = new Date();
      if (schedule.exportType === "cases") {
        const { cases: casesTable } = await import("../drizzle/schema");
        const rows = await db.select().from(casesTable).limit(1000);
        content = schedule.format === "json"
          ? JSON.stringify(rows, null, 2)
          : [Object.keys(rows[0] ?? {}).join(","), ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      } else if (schedule.exportType === "investigations") {
        const { investigations: invTable } = await import("../drizzle/schema");
        const rows = await db.select().from(invTable).limit(1000);
        content = schedule.format === "json"
          ? JSON.stringify(rows, null, 2)
          : [Object.keys(rows[0] ?? {}).join(","), ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      } else if (schedule.exportType === "lex_submissions") {
        const { lexSubmissions: lexTable } = await import("../drizzle/schema");
        const rows = await db.select().from(lexTable).limit(1000);
        content = schedule.format === "json"
          ? JSON.stringify(rows, null, 2)
          : [Object.keys(rows[0] ?? {}).join(","), ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      } else if (schedule.exportType === "audit_log") {
        const { auditLog } = await import("../drizzle/schema");
        const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(1000);
        content = schedule.format === "json"
          ? JSON.stringify(rows, null, 2)
          : [Object.keys(rows[0] ?? {}).join(","), ...rows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      }
      // Upload to S3
      const { storagePut } = await import("./storage");
      const ext = schedule.format;
      const fileKey = `exports/${ctx.user.id}/${schedule.exportType}-${now.toISOString().slice(0, 10)}-${Date.now()}.${ext}`;
      const { url } = await storagePut(fileKey, Buffer.from(content, "utf-8"), schedule.format === "json" ? "application/json" : "text/csv");
      await db.update(exportSchedules).set({ lastRunAt: now, lastFileUrl: url, updatedAt: now }).where(eq(exportSchedules.id, input.id));
      return { ok: true, url, filename: `${schedule.name}-${now.toISOString().slice(0, 10)}.${ext}` };
    }),
});

/** Simple next-run calculator — returns next occurrence of the cron schedule (approximation) */
function getNextCronRun(cron: string): Date {
  // Parse "minute hour dayOfMonth month dayOfWeek"
  const parts = cron.trim().split(/\s+/);
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  try {
    const minute = parts[0] === "*" ? 0 : parseInt(parts[0]);
    const hour = parts[1] === "*" ? now.getHours() : parseInt(parts[1]);
    next.setMinutes(isNaN(minute) ? 0 : minute);
    next.setHours(isNaN(hour) ? 8 : hour);
    if (next <= now) next.setDate(next.getDate() + 1);
  } catch {
    next.setDate(next.getDate() + 7);
  }
  return next;
}

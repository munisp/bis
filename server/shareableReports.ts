/**
 * server/shareableReports.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shareable investigation reports (Intelius-style instant-report analog).
 *
 * An operator creates a time-boxed share link for an investigation that belongs
 * to their tenant. The link token (`bis_sl_<random>`) is shown exactly once;
 * only its SHA-256 hex digest is persisted (same scheme as server/apiTokens.ts
 * and the OpenClaw bearer validation in server/openclawEndpoints.ts).
 *
 * Token holders receive a REDACTED one-pager: subject name, investigation ref,
 * an overall risk BAND (never a raw component score), per-source screening
 * outcomes reduced to pass/consider/fail, the field-visit outcome, a thin-file
 * flag, generation time, and the tenant display name. Referee identities, raw
 * sanctions payloads, internal notes, and user identifiers are never selected
 * and never serialised.
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";
import { ENV } from "./_core/env";

const TOKEN_PREFIX = "bis_sl_";
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

function requireTenant(ctx: { tenantId: number | null; user: { id: number } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}

async function poolOrFail(): Promise<Queryable> {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Share-link storage is unavailable" });
  return pool;
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function writeAuditLog(client: Queryable, entry: {
  tenantId: number; userId: number; action: string; targetRef?: string; result?: "success" | "warning" | "failure"; detail?: unknown;
}) {
  const createdAt = new Date();
  const result = entry.result ?? "success";
  const payload = [String(entry.userId), "report", entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|");
  const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
  await client.query(
    `INSERT INTO audit_log ("tenantId", "userId", category, action, "targetRef", result, detail, "integrityHash", "createdAt")
     VALUES ($1, $2, 'report', $3, $4, $5, $6::jsonb, $7, $8)`,
    [entry.tenantId, entry.userId, entry.action, entry.targetRef ?? null, result, JSON.stringify(entry.detail ?? {}), integrityHash, createdAt],
  ).catch(() => undefined);
}

async function publishEvent(eventType: string, subjectRef: string, severity: string, payload: unknown) {
  try {
    await fetch(`${ENV.eventProcessorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: "bis-bff" }),
    });
  } catch (e) {
    console.warn("[EventProcessor] Failed to publish event:", e);
  }
}

/** Map an assessment_outcome enum value to a public pass/consider/fail band. */
function outcomeBand(outcome: string | null): "pass" | "consider" | "fail" {
  switch (outcome) {
    case "clear": return "pass";
    case "adverse":
    case "suspended_licence":
    case "revoked_licence": return "fail";
    default: return "consider"; // consider / pending / unverified / null
  }
}

/** Reduce an overall risk signal to a band; raw scores never leave this function. */
function riskBand(riskTier: string | null, riskScore: number | null): "low" | "medium" | "high" | "critical" | "unrated" {
  if (riskTier === "low" || riskTier === "medium" || riskTier === "high" || riskTier === "critical") return riskTier;
  if (riskScore === null || !Number.isFinite(riskScore)) return "unrated";
  if (riskScore < 25) return "low";
  if (riskScore < 50) return "medium";
  if (riskScore < 75) return "high";
  return "critical";
}

export const shareableReportsRouter = router({
  createShareLink: writeProcedure
    .input(z.object({
      investigationRef: z.string().min(4).max(64),
      expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).default(DEFAULT_EXPIRY_DAYS),
    }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await (pool as any).connect();
      try {
        await client.query("BEGIN");
        const investigation = await client.query(
          `SELECT id FROM investigations WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL FOR SHARE`,
          [input.investigationRef, tenantId],
        );
        if (investigation.rowCount !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation was not found in this tenant" });
        }
        const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
        const inserted = await client.query(
          `INSERT INTO report_share_links (id, tenant_id, investigation_ref, token_hash, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, expires_at, created_at`,
          [id, tenantId, input.investigationRef, hashShareToken(token), userId, expiresAt],
        );
        await writeAuditLog(client, {
          tenantId, userId, action: "Report share link created", targetRef: input.investigationRef,
          detail: { shareLinkId: id, expiresAt: expiresAt.toISOString() },
        });
        await client.query("COMMIT");
        await publishEvent("REPORT_SHARE_CREATED", input.investigationRef, "info", { shareLinkId: id, expiresAt: expiresAt.toISOString(), tenantId });
        // The plaintext token is returned exactly once and is never persisted.
        return {
          shareLinkId: inserted.rows[0].id,
          token,
          investigationRef: input.investigationRef,
          expiresAt: new Date(inserted.rows[0].expires_at).toISOString(),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  getSharedReport: publicProcedure
    .input(z.object({ token: z.string().regex(/^bis_sl_[A-Za-z0-9_-]{32}$/) }))
    .query(async ({ input }) => {
      const pool = await poolOrFail();
      // Atomic validity check + view accounting in a single statement: an
      // expired or revoked link cannot be raced into an extra view.
      const claimed = await pool.query(
        `UPDATE report_share_links
         SET view_count = view_count + 1, last_viewed_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         RETURNING id, tenant_id, investigation_ref`,
        [hashShareToken(input.token)],
      );
      if ((claimed.rowCount ?? 0) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This shared report link is invalid, expired, or revoked" });
      }
      const link = claimed.rows[0] as { id: string; tenant_id: number; investigation_ref: string };

      const investigation = await pool.query(
        `SELECT id, "subjectName", ref, status, "riskTier", "riskScore", "completedAt"
         FROM investigations
         WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
        [link.investigation_ref, link.tenant_id],
      );
      if ((investigation.rowCount ?? 0) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The investigation backing this shared report is unavailable" });
      }
      const inv = investigation.rows[0] as {
        id: number; subjectName: string; ref: string; status: string;
        riskTier: string | null; riskScore: number | null; completedAt: Date | null;
      };

      const screening = await pool.query(
        `SELECT sr."screeningType" AS source, sr.outcome
         FROM screening_results sr
         JOIN screening_orders so ON so.id = sr."orderId"
         WHERE so."investigationRef" = $1 AND so."tenantId" = $2 AND so."deletedAt" IS NULL
           AND sr.status = 'completed'
         ORDER BY sr."screeningType" ASC`,
        [link.investigation_ref, link.tenant_id],
      );
      const fieldVisit = await pool.query(
        `SELECT outcome, "subjectPresent", "addressConfirmed", "submittedAt"
         FROM field_visit_reports
         WHERE "investigationId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [inv.id],
      );
      const tenant = await pool.query(`SELECT name FROM tenants WHERE id = $1`, [link.tenant_id]);

      const screeningSummary = (screening.rows as Array<{ source: string; outcome: string | null }>)
        .map((row) => ({ source: row.source, outcome: outcomeBand(row.outcome) }));
      const visit = fieldVisit.rows[0] as { outcome: string | null; subjectPresent: boolean | null; addressConfirmed: boolean | null; submittedAt: Date | null } | undefined;

      // Whitelisted redacted one-pager. No referee identities, no raw provider
      // payloads, no internal notes, and no user identifiers are ever selected.
      return {
        subjectName: inv.subjectName,
        investigationRef: inv.ref,
        riskBand: riskBand(inv.riskTier, inv.riskScore === null ? null : Number(inv.riskScore)),
        screening: screeningSummary,
        fieldVisit: visit
          ? {
              outcome: visit.outcome === "confirmed" || visit.outcome === "unconfirmed" || visit.outcome === "inconclusive" ? visit.outcome : "inconclusive",
              conductedAt: visit.submittedAt ? new Date(visit.submittedAt).toISOString() : null,
            }
          : null,
        thinFile: inv.status === "thin_file" || screeningSummary.length === 0,
        generatedAt: new Date().toISOString(),
        completedAt: inv.completedAt ? new Date(inv.completedAt).toISOString() : null,
        tenantName: tenant.rows[0] ? String(tenant.rows[0].name) : "BIS tenant",
      };
    }),

  revokeShareLink: writeProcedure
    .input(z.object({ shareLinkId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const revoked = await pool.query(
        `UPDATE report_share_links SET revoked_at = now()
         WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
         RETURNING id, investigation_ref`,
        [input.shareLinkId, tenantId],
      );
      if ((revoked.rowCount ?? 0) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Share link was not found in this tenant or is already revoked" });
      }
      await writeAuditLog(pool, {
        tenantId, userId, action: "Report share link revoked", targetRef: revoked.rows[0].investigation_ref,
        detail: { shareLinkId: input.shareLinkId },
      });
      await publishEvent("REPORT_SHARE_REVOKED", revoked.rows[0].investigation_ref, "info", { shareLinkId: input.shareLinkId, tenantId });
      return { shareLinkId: input.shareLinkId, revoked: true as const };
    }),

  listShareLinks: protectedProcedure
    .input(z.object({ investigationRef: z.string().min(4).max(64).optional() }))
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const result = input.investigationRef
        ? await pool.query(
            `SELECT id, investigation_ref, expires_at, revoked_at, view_count, last_viewed_at, created_at
             FROM report_share_links
             WHERE tenant_id = $1 AND investigation_ref = $2
             ORDER BY created_at DESC LIMIT 100`,
            [tenantId, input.investigationRef],
          )
        : await pool.query(
            `SELECT id, investigation_ref, expires_at, revoked_at, view_count, last_viewed_at, created_at
             FROM report_share_links
             WHERE tenant_id = $1
             ORDER BY created_at DESC LIMIT 100`,
            [tenantId],
          );
      // token_hash is deliberately never selected here.
      return result.rows.map((row: any) => ({
        shareLinkId: row.id as string,
        investigationRef: row.investigation_ref as string,
        expiresAt: new Date(row.expires_at).toISOString(),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        viewCount: Number(row.view_count),
        lastViewedAt: row.last_viewed_at ? new Date(row.last_viewed_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        active: row.revoked_at === null && new Date(row.expires_at).getTime() > Date.now(),
      }));
    }),
});

export const __shareableReportsInternals = { hashShareToken, outcomeBand, riskBand, TOKEN_PREFIX };

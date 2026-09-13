/**
 * server/subjectPortal.ts
 *
 * WP3 — subject-facing portal (Checkr candidate-portal / Intelius self-check analog):
 *   - requestSelfCheck  : consumer self-check intake (public, consent-gated, rate-limited)
 *   - getMyStatus       : token-authed, minimal-disclosure status view
 *   - submitDispute     : token-authed dispute intake, wired into informalVerification
 *   - resolveDispute    : operator (admin/supervisor) resolution, tenant-scoped
 *
 * Security model:
 *   - Portal tokens are `bis_sp_<random>` and are stored ONLY as SHA-256 hex hashes
 *     (subject_access_tokens.token_hash) — the same hash-lookup scheme PR #151
 *     established for apiTokens.tokenHash in server/openclawEndpoints.ts.
 *   - Tenant identity ALWAYS comes from the token row, never from client input.
 *   - Disclosure is minimal: provenance LABELS only, never referee names/contacts.
 *   - Everything fails closed: DB down, token unknown/expired/revoked, or PII
 *     encryption unavailable all reject rather than degrade.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb, getPgPool } from "./db";
import { auditLog } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { computeDataCompleteness } from "./dataCompleteness";
import { encryptPiiEnvelope, piiAad } from "./piiEnvelopeCrypto";
import { activeTenantEncryptionRegistry } from "./piiKeyRegistry";

const TOKEN_PREFIX = "bis_sp_";
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72h self-check window

/** System actor recorded as investigations.createdBy for subject-initiated self-checks
 *  (no operator session exists at intake; investigations.createdBy has no FK). */
const SYSTEM_ACTOR_ID = 0;

// ─── Rate limiting ────────────────────────────────────────────────────────────
// The Express layer already applies a global express-rate-limit (server/_core/index.ts),
// but this router issues credentials, so it gets a stricter dedicated per-IP
// fixed-window limiter. This store is per-process; if the BFF is scaled
// horizontally, back it with the shared Redis client (server/redis.ts) instead.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(ip: string): void {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX_REQUESTS) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many subject-portal requests from this network. Try again later." });
  }
}

function clientIp(ctx: { req?: { ip?: string; headers?: Record<string, unknown> } }): string {
  const fwd = ctx.req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : typeof fwd === "string" ? fwd.split(",")[0] : undefined;
  return (first ?? ctx.req?.ip ?? "unknown").trim() || "unknown";
}

// ─── Token helpers (hash-only storage — see openclawEndpoints.ts precedent) ───

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type SubjectTokenRow = {
  id: string;
  tenant_id: number;
  candidate_id: number;
  purpose: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

/**
 * Resolve a presented portal token via SHA-256 hash lookup. Fails CLOSED:
 * unknown prefix, unknown hash, revocation, expiry, or wrong purpose all reject.
 */
async function resolveSubjectToken(
  client: { query: Function },
  rawToken: string,
  allowedPurposes: ReadonlyArray<string>,
): Promise<SubjectTokenRow> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid subject access token" });
  }
  const result = await client.query(
    `SELECT id, tenant_id, candidate_id, purpose, expires_at, revoked_at
       FROM subject_access_tokens WHERE token_hash = $1`,
    [hashToken(rawToken)],
  );
  if (result.rowCount !== 1) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid subject access token" });
  }
  const row = result.rows[0] as SubjectTokenRow;
  if (row.revoked_at) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Subject access token has been revoked" });
  }
  if (new Date(row.expires_at) <= new Date()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Subject access token has expired" });
  }
  if (!allowedPurposes.includes(row.purpose)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Subject access token is not valid for this operation" });
  }
  return row;
}

// ─── Audit + event helpers ────────────────────────────────────────────────────
// These mirror the local writeAuditLog / publishEvent helpers in server/routers.ts
// (identical HMAC integrity format and event envelope). They are duplicated here
// rather than imported to avoid a circular module dependency with routers.ts;
// keep the formats in sync if routers.ts changes.

async function writeAuditLog(entry: {
  userId?: number;
  userEmail?: string;
  tenantId?: number;
  category: "investigation" | "kyc" | "alert" | "report" | "user" | "system" | "api";
  action: string;
  targetRef?: string;
  result?: "success" | "warning" | "failure";
  ipAddress?: string;
  detail?: unknown;
}) {
  try {
    const db = await getDb();
    if (!db) return;
    const result = entry.result ?? "success";
    const createdAt = new Date();
    const integrityHash = createHmac("sha256", ENV.auditHmacSecret)
      .update([String(entry.userId ?? ""), entry.category, entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|"))
      .digest("hex")
      .slice(0, 64);
    await db.insert(auditLog).values({
      userId: entry.userId, userEmail: entry.userEmail, tenantId: entry.tenantId, category: entry.category,
      action: entry.action, targetRef: entry.targetRef, result,
      ipAddress: entry.ipAddress, detail: entry.detail as any, integrityHash, createdAt,
    });
  } catch (e) {
    console.warn("[AuditLog] Failed to write:", e);
  }
}

async function publishEvent(eventType: string, subjectRef: string, severity: string, payload: unknown, source = "bis-bff") {
  try {
    await fetch(`${ENV.eventProcessorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: source }),
    });
  } catch (e) {
    console.warn("[EventProcessor] Failed to publish event:", e);
  }
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function generateRef(prefix: string): string {
  const year = new Date().getFullYear();
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${year}-${rand}`;
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Subject portal storage is unavailable" });
  return pool;
}

/** Mirrors informalVerification.ts digest() so case events stay cross-correlatable. */
function eventDigest(caseId: string, type: string, detail: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ caseId, type, detail })).digest("hex");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const subjectPortalRouter = router({

  /**
   * Consumer self-check intake. PUBLIC (no operator session) but consent-gated:
   * a signed consent text is mandatory and persisted (unrevoked) before any
   * investigation or token is created. All writes happen in ONE transaction.
   */
  requestSelfCheck: publicProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      fullName: z.string().min(2).max(255),
      ninOrBvn: z.string().regex(/^\d{11}$/, "NIN or BVN must be exactly 11 digits"),
      idType: z.enum(["nin", "bvn"]).default("nin"),
      phone: z.string().min(7).max(20),
      consentText: z.string().min(40).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const ip = clientIp(ctx);
      enforceRateLimit(ip);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tenant = await client.query(`SELECT id FROM tenants WHERE id = $1`, [input.tenantId]);
        if (tenant.rowCount !== 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown tenant for self-check intake" });
        }

        // Upsert candidate profile: match on NIN/BVN within the tenant.
        const existing = await client.query(
          `SELECT id FROM candidate_profiles
            WHERE "tenantId" = $1 AND (nin = $2 OR bvn = $2)
            ORDER BY id LIMIT 1 FOR UPDATE`,
          [input.tenantId, input.ninOrBvn],
        );
        let candidateId: number;
        if (existing.rowCount === 1) {
          candidateId = existing.rows[0].id;
        } else {
          const candidateRef = generateRef("CAND");
          const parts = input.fullName.trim().split(/\s+/);
          const firstName = parts[0] ?? input.fullName.trim();
          const lastName = parts.slice(1).join(" ") || firstName;
          // Placeholder mailbox (frscQuickCheck precedent): the subject portal
          // does not collect email at intake.
          const inserted = await client.query(
            `INSERT INTO candidate_profiles
               ("candidateRef", "tenantId", "firstName", "lastName", email, phone, nin, bvn,
                "consentStatus", "ndprConsentAt", "ndprConsentIp")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', now(), $9)
             RETURNING id`,
            [
              candidateRef, input.tenantId, firstName, lastName,
              `${candidateRef.toLowerCase()}@self-check.bis.internal`, input.phone,
              input.idType === "nin" ? input.ninOrBvn : null,
              input.idType === "bvn" ? input.ninOrBvn : null,
              ip,
            ],
          );
          candidateId = inserted.rows[0].id;
        }

        // Mandatory signed consent — the portal never proceeds without it.
        const consentRef = generateRef("CON");
        await client.query(
          `INSERT INTO candidate_consents
             ("consentRef", "candidateId", purpose, "consentText", "signedAt", "signerIp")
           VALUES ($1, $2, 'consumer_self_check', $3, now(), $4)`,
          [consentRef, candidateId, input.consentText, ip],
        );

        // Self-check investigation (consumer_self_check purpose).
        const investigationRef = generateRef("BIS");
        await client.query(
          `INSERT INTO investigations
             (ref, "subjectType", "subjectName", country, tier, priority, status,
              phone, purpose, "tenantId", "createdBy", "candidateProfileId")
           VALUES ($1, 'individual', $2, 'NG', 'basic', 'medium', 'pending',
                   $3, 'consumer_self_check', $4, $5, $6)`,
          [investigationRef, input.fullName.trim(), input.phone, input.tenantId, SYSTEM_ACTOR_ID, candidateId],
        );

        // Issue the portal token; ONLY its SHA-256 hash is persisted.
        const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        await client.query(
          `INSERT INTO subject_access_tokens
             (id, tenant_id, candidate_id, token_hash, purpose, expires_at)
           VALUES ($1, $2, $3, $4, 'self_check', $5)`,
          [randomUUID(), input.tenantId, candidateId, hashToken(token), expiresAt],
        );

        await client.query("COMMIT");
        await publishEvent("SUBJECT_SELF_CHECK_REQUESTED", investigationRef, "info", {
          tenantId: input.tenantId, consentRef,
        }).catch(() => {});
        return { token, investigationRef, expiresAt };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  /**
   * Minimal-disclosure status view for the token holder. Tenant and candidate
   * identity come from the TOKEN ROW ONLY. Returns provenance LABELS — never
   * referee names, contacts, or claim text.
   */
  getMyStatus: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      enforceRateLimit(clientIp(ctx));
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        const tokenRow = await resolveSubjectToken(client, input.token, ["self_check", "status"]);

        const inv = await client.query(
          `SELECT ref, status FROM investigations
            WHERE "candidateProfileId" = $1 AND "tenantId" = $2
            ORDER BY "createdAt" DESC LIMIT 1`,
          [tokenRow.candidate_id, tokenRow.tenant_id],
        );
        if (inv.rowCount !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No self-check investigation found for this token" });
        }
        const investigationRef = inv.rows[0].ref as string;

        // Same scoring as investigations.getDataCompleteness (shared module).
        const db = await getDb();
        const completeness = db
          ? await computeDataCompleteness(db, investigationRef)
          : { score: 0, sourcesChecked: 0, sourcesTotal: 0, thinFile: true, coverage: [], missingCritical: [] };

        const refs = await client.query(
          `SELECT r.provenance_status
             FROM informal_references r
             JOIN informal_verification_cases c ON c.id = r.case_id
            WHERE c.candidate_id = $1 AND c.tenant_id = $2 AND r.withdrawn_at IS NULL`,
          [tokenRow.candidate_id, tokenRow.tenant_id],
        );

        // Minimal-disclosure shape: no subject PII, no referee identity/contact,
        // no source-claim text — only status, score, thin-file flag, and labels.
        return {
          investigationRef,
          investigationStatus: inv.rows[0].status as string,
          dataCompleteness: {
            score: completeness.score,
            sourcesChecked: completeness.sourcesTotal > 0 ? completeness.sourcesChecked : 0,
            sourcesTotal: completeness.sourcesTotal,
            thinFile: completeness.thinFile,
          },
          thinFile: completeness.thinFile,
          referenceProvenance: refs.rows.map((r: { provenance_status: string }) => r.provenance_status),
        };
      } finally {
        client.release();
      }
    }),

  /**
   * Subject dispute intake. Statement PII is encrypted with the tenant's active
   * Vault Transit key (piiEnvelopeCrypto); if encryption is unavailable the
   * dispute is REJECTED (fail closed) rather than stored in plaintext.
   */
  submitDispute: publicProcedure
    .input(z.object({
      token: z.string().min(1),
      statement: z.string().min(10).max(4096),
      caseId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(clientIp(ctx));
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        const tokenRow = await resolveSubjectToken(client, input.token, ["self_check", "dispute"]);
        const disputeId = randomUUID();
        const statementSha256 = createHash("sha256").update(input.statement).digest("hex");

        // Encrypt the statement under the tenant's active Transit key. Fail
        // closed: without an active key the statement is never persisted.
        let statementEnc: string;
        try {
          const key = await activeTenantEncryptionRegistry(client, tokenRow.tenant_id);
          const envelope = await encryptPiiEnvelope(
            key,
            piiAad(tokenRow.tenant_id, "candidate_profile", tokenRow.candidate_id, `subject-dispute:${disputeId}`),
            { statement: input.statement },
          );
          statementEnc = JSON.stringify({
            ciphertext: envelope.ciphertext.toString("utf8"),
            keyVersion: envelope.keyVersion,
            providerKeyVersion: envelope.providerKeyVersion,
            cryptoProvider: envelope.cryptoProvider,
          });
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Dispute statement encryption is unavailable; dispute was not recorded" });
        }

        await client.query("BEGIN");
        await client.query(
          `INSERT INTO subject_disputes
             (id, tenant_id, candidate_id, case_id, statement_sha256, statement_enc, status)
           VALUES ($1, $2, $3, NULL, $4, $5, 'received')`,
          [disputeId, tokenRow.tenant_id, tokenRow.candidate_id, statementSha256, statementEnc],
        );

        // Wire into the informal-verification flow: transition the candidate's
        // current case to 'disputed' using the SAME semantics as
        // informalVerification.submitCorrection (status guard + immutable case
        // event with statement digest). Mirrored here because the subject is
        // token-authenticated, not an operator session that procedure requires.
        const caseResult = await client.query(
          `SELECT id FROM informal_verification_cases
            WHERE tenant_id = $1 AND candidate_id = $2
              AND status IN ('collecting', 'under_review', 'completed')
              ${input.caseId ? "AND id = $3" : ""}
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          input.caseId ? [tokenRow.tenant_id, tokenRow.candidate_id, input.caseId] : [tokenRow.tenant_id, tokenRow.candidate_id],
        );
        let caseDisputed = false;
        if (caseResult.rowCount === 1) {
          const caseId = caseResult.rows[0].id as string;
          const transitioned = await client.query(
            `UPDATE informal_verification_cases SET status = 'disputed', updated_at = now()
              WHERE id = $1 AND tenant_id = $2 AND status IN ('collecting', 'under_review', 'completed')`,
            [caseId, tokenRow.tenant_id],
          );
          if (transitioned.rowCount === 1) {
            const detail = { statementSha256, disputeId };
            await client.query(
              `INSERT INTO informal_reference_events (id, case_id, reference_id, tenant_id, event_type, actor_user_id, event_sha256, metadata)
               VALUES ($1, $2, NULL, $3, 'subject_correction_submitted', NULL, $4, $5::jsonb)`,
              [randomUUID(), caseId, tokenRow.tenant_id, eventDigest(caseId, "subject_correction_submitted", detail), JSON.stringify(detail)],
            );
            await client.query(`UPDATE subject_disputes SET case_id = $1 WHERE id = $2`, [caseId, disputeId]);
            caseDisputed = true;
          }
        }
        await client.query("COMMIT");

        await writeAuditLog({
          tenantId: tokenRow.tenant_id, category: "investigation",
          action: "Subject dispute submitted", targetRef: disputeId,
          ipAddress: clientIp(ctx),
          detail: { candidateId: tokenRow.candidate_id, caseDisputed, statementSha256 },
        });
        await publishEvent("SUBJECT_DISPUTE_SUBMITTED", disputeId, "warning", {
          tenantId: tokenRow.tenant_id, candidateId: tokenRow.candidate_id, caseDisputed,
        }).catch(() => {});
        return { disputeId, status: "received" as const, caseDisputed };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  /**
   * Operator resolution of a subject dispute. Admin/supervisor only, strictly
   * scoped to the operator's tenant context.
   */
  resolveDispute: protectedProcedure
    .input(z.object({
      disputeId: z.string().uuid(),
      resolution: z.string().min(10).max(2048),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
      if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
        throw new TRPCError({ code: "FORBIDDEN", message: "A designated reviewer is required to resolve subject disputes" });
      }
      if (!ctx.tenantId || ctx.tenantId <= 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
      }
      const tenantId = ctx.tenantId;
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE subject_disputes
              SET status = 'resolved', resolution = $1, updated_at = now()
            WHERE id = $2 AND tenant_id = $3 AND status <> 'resolved'
            RETURNING id`,
          [input.resolution.trim(), input.disputeId, tenantId],
        );
        if (result.rowCount !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "Subject dispute is unavailable or already resolved in this tenant" });
        }
        await client.query("COMMIT");
        await writeAuditLog({
          userId: ctx.user.id, userEmail: ctx.user.email ?? undefined, tenantId,
          category: "investigation", action: "Subject dispute resolved", targetRef: input.disputeId,
        });
        await publishEvent("SUBJECT_DISPUTE_RESOLVED", input.disputeId, "info", {
          tenantId, resolvedBy: ctx.user.id,
        }).catch(() => {});
        return { disputeId: input.disputeId, status: "resolved" as const };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),
});

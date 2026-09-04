import { createCipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPgPool } from "./db";
import { protectedProcedure, router } from "./_core/trpc";

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const EVIDENCE_TTL_SECONDS = 15 * 60;
const APPROVED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export type EvidenceKeyring = { activeVersion: string; keys: Map<string, Buffer> };

export function serviceUnavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

export function loadEvidenceKeyring(): EvidenceKeyring {
  const activeVersion = (process.env.BIS_EVIDENCE_ACTIVE_KEY_VERSION ?? "").trim();
  const encoded = (process.env.BIS_EVIDENCE_KEYRING ?? "").trim();
  if (!activeVersion || !encoded) serviceUnavailable("Evidence encryption keyring is not configured");
  const keys = new Map<string, Buffer>();
  for (const entry of encoded.split(",")) {
    const [version, material] = entry.trim().split(":", 2);
    if (!version || !material || keys.has(version)) serviceUnavailable("Evidence encryption keyring is invalid");
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) serviceUnavailable("Evidence encryption keys must be 32-byte base64 values");
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) serviceUnavailable("Active evidence encryption key is unavailable");
  return { activeVersion, keys };
}

export function encryptEvidenceDescription(keyring: EvidenceKeyring, description: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.keys.get(keyring.activeVersion)!, nonce);
  const ciphertext = Buffer.concat([cipher.update(description, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: keyring.activeVersion };
}

export function evidenceStorage() {
  const endpoint = (process.env.BIS_EVIDENCE_S3_ENDPOINT ?? "").trim();
  const region = (process.env.BIS_EVIDENCE_S3_REGION ?? "").trim();
  const bucket = (process.env.BIS_EVIDENCE_S3_BUCKET ?? "").trim();
  const accessKeyId = (process.env.BIS_EVIDENCE_S3_ACCESS_KEY ?? "").trim();
  const secretAccessKey = (process.env.BIS_EVIDENCE_S3_SECRET_KEY ?? "").trim();
  const kmsKeyId = (process.env.BIS_EVIDENCE_S3_KMS_KEY_ID ?? "").trim();
  if (!endpoint.startsWith("https://") || !region || !bucket || !accessKeyId || !secretAccessKey || !kmsKeyId) {
    serviceUnavailable("Secure evidence object storage is not configured");
  }
  return {
    bucket,
    kmsKeyId,
    client: new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: process.env.BIS_EVIDENCE_S3_FORCE_PATH_STYLE === "true" }),
  };
}

export async function evidencePoolOrThrow() {
  const pool = await getPgPool();
  if (!pool) serviceUnavailable("PostgreSQL is unavailable");
  return pool;
}

export function custodyDigest(uploadId: string, eventType: string, metadata: Record<string, unknown>) {
  return createHash("sha256").update(`${uploadId}|${eventType}|${JSON.stringify(metadata)}`).digest("hex");
}

/** Converts the API's canonical lower-case hexadecimal SHA-256 digest to the
 * base64 representation required by S3's x-amz-checksum-sha256 header. */
export function s3ChecksumSha256FromHex(sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A canonical SHA-256 digest is required." });
  }
  return Buffer.from(sha256Hex, "hex").toString("base64");
}

/** Compares a stored hexadecimal content hash to the object store's base64
 * SHA-256 checksum without exposing either value in an error response. */
export function s3ChecksumMatchesSha256Hex(expectedHex: string, observedBase64: string | undefined): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHex) || !observedBase64) return false;
  const expected = Buffer.from(expectedHex, "hex");
  let observed: Buffer;
  try {
    observed = Buffer.from(observedBase64, "base64");
  } catch {
    return false;
  }
  return expected.length === observed.length && timingSafeEqual(expected, observed);
}

const initiateSchema = z.object({
  investigationId: z.number().int().positive(),
  contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  contentLength: z.number().int().min(1).max(MAX_EVIDENCE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  description: z.string().trim().min(3).max(2000),
  idempotencyKey: z.string().uuid(),
});

const completeSchema = z.object({ uploadId: z.string().uuid() });

export const fieldEvidenceRouter = router({
  initiate: protectedProcedure.input(initiateSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required for evidence upload" });
    if (!APPROVED_CONTENT_TYPES.has(input.contentType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence content type is not allowed" });
    const pool = await evidencePoolOrThrow();
    const keyring = loadEvidenceKeyring();
    const storage = evidenceStorage();
    const existing = await pool.query<{ id: string; object_key: string; expires_at: string }>(
      `SELECT id, object_key, expires_at FROM field_evidence_uploads WHERE tenant_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
      [ctx.tenantId, ctx.user.id, input.idempotencyKey],
    );
    let uploadId: string;
    let objectKey: string;
    let expiresAt: Date;
    if (existing.rows[0]) {
      uploadId = existing.rows[0].id;
      objectKey = existing.rows[0].object_key;
      expiresAt = new Date(existing.rows[0].expires_at);
      if (expiresAt <= new Date()) throw new TRPCError({ code: "CONFLICT", message: "Existing evidence upload authorization expired; submit a new idempotency key" });
    } else {
      uploadId = randomUUID();
      objectKey = `evidence/${ctx.tenantId}/${input.investigationId}/${uploadId}`;
      expiresAt = new Date(Date.now() + EVIDENCE_TTL_SECONDS * 1000);
      const encrypted = encryptEvidenceDescription(keyring, input.description);
      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO field_evidence_uploads
           (id, tenant_id, investigation_id, actor_user_id, idempotency_key, object_key, expected_sha256, content_type, content_length, description_ciphertext, description_nonce, description_key_version, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [uploadId, ctx.tenantId, input.investigationId, ctx.user.id, input.idempotencyKey, objectKey, input.sha256, input.contentType, input.contentLength, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, expiresAt],
        );
        const metadata = { expectedSha256: input.sha256, contentLength: input.contentLength, contentType: input.contentType, keyVersion: encrypted.keyVersion };
        await pool.query(
          `INSERT INTO field_evidence_custody_events (id, evidence_upload_id, actor_user_id, event_type, event_sha256, metadata) VALUES ($1,$2,$3,'upload_initiated',$4,$5::jsonb)`,
          [randomUUID(), uploadId, ctx.user.id, custodyDigest(uploadId, "upload_initiated", metadata), JSON.stringify(metadata)],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }
    const objectChecksum = s3ChecksumSha256FromHex(input.sha256);
    const command = new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, ContentType: input.contentType, ContentLength: input.contentLength, Metadata: { "evidence-id": uploadId, "sha256": input.sha256 }, ChecksumAlgorithm: "SHA256", ChecksumSHA256: objectChecksum, ServerSideEncryption: "aws:kms", SSEKMSKeyId: storage.kmsKeyId });
    const uploadUrl = await getSignedUrl(storage.client, command, { expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
    return {
      uploadId,
      objectKey,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: {
        "content-type": input.contentType,
        "x-amz-meta-evidence-id": uploadId,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-checksum-sha256": objectChecksum,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": storage.kmsKeyId,
      },
    };
  }),

  complete: protectedProcedure.input(completeSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required for evidence upload" });
    const pool = await evidencePoolOrThrow();
    const storage = evidenceStorage();
    const upload = await pool.query<{ object_key: string; expected_sha256: string; content_type: string; content_length: string; status: string; expires_at: string }>(
      `SELECT object_key, expected_sha256, content_type, content_length, status, expires_at FROM field_evidence_uploads WHERE id = $1 AND tenant_id = $2 AND actor_user_id = $3 FOR UPDATE`,
      [input.uploadId, ctx.tenantId, ctx.user.id],
    );
    const row = upload.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence upload authorization was not found" });
    if (row.status === "verified") return { uploadId: input.uploadId, status: "verified" as const };
    if (new Date(row.expires_at) <= new Date()) throw new TRPCError({ code: "CONFLICT", message: "Evidence upload authorization expired" });
    const object = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.object_key, ChecksumMode: "ENABLED" }));
    const observedSha256 = object.Metadata?.sha256 ?? "";
    const checksumValid = s3ChecksumMatchesSha256Hex(row.expected_sha256, object.ChecksumSHA256);
    const expected = Buffer.from(row.expected_sha256, "utf8");
    const observed = Buffer.from(observedSha256, "utf8");
    const valid = checksumValid && expected.length === observed.length && timingSafeEqual(expected, observed) && object.ContentType === row.content_type && Number(object.ContentLength) === Number(row.content_length) && object.ServerSideEncryption === "aws:kms" && object.SSEKMSKeyId === storage.kmsKeyId;
    if (!valid) {
      const metadata = { reason: "object_integrity_or_encryption_validation_failed" };
      await pool.query(`UPDATE field_evidence_uploads SET status = 'rejected', observed_sha256 = $2, updated_at = NOW() WHERE id = $1`, [input.uploadId, observedSha256 || null]);
      await pool.query(`INSERT INTO field_evidence_custody_events (id, evidence_upload_id, actor_user_id, event_type, event_sha256, metadata) VALUES ($1,$2,$3,'upload_rejected',$4,$5::jsonb)`, [randomUUID(), input.uploadId, ctx.user.id, custodyDigest(input.uploadId, "upload_rejected", metadata), JSON.stringify(metadata)]);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence object integrity verification failed" });
    }
    const metadata = { sha256: observedSha256, contentLength: Number(object.ContentLength), contentType: object.ContentType, objectVersionId: object.VersionId ?? null, kmsKeyId: object.SSEKMSKeyId ?? null };
    await pool.query("BEGIN");
    try {
      await pool.query(`UPDATE field_evidence_uploads SET status = 'verified', observed_sha256 = $2, object_version_id = $3, completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.uploadId, observedSha256, object.VersionId ?? null]);
      await pool.query(`INSERT INTO field_evidence_custody_events (id, evidence_upload_id, actor_user_id, event_type, event_sha256, metadata) VALUES ($1,$2,$3,'upload_verified',$4,$5::jsonb)`, [randomUUID(), input.uploadId, ctx.user.id, custodyDigest(input.uploadId, "upload_verified", metadata), JSON.stringify(metadata)]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    return { uploadId: input.uploadId, status: "verified" as const, objectVersionId: object.VersionId ?? null };
  }),
});

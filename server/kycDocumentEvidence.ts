import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  custodyDigest,
  encryptEvidenceDescription,
  evidencePoolOrThrow,
  evidenceStorage,
  loadEvidenceKeyring,
  s3ChecksumMatchesSha256Hex,
  s3ChecksumSha256FromHex,
} from "./fieldEvidence";
import { protectedProcedure, router } from "./_core/trpc";

const MAX_KYC_DOCUMENT_BYTES = 5 * 1024 * 1024;
const KYC_UPLOAD_TTL_SECONDS = 15 * 60;
const KYC_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const KYC_DOCUMENT_TYPES = [
  "nin_slip",
  "passport",
  "drivers_license",
  "voters_card",
  "utility_bill",
  "bank_statement",
  "cac_certificate",
  "other",
] as const;

const initiateSchema = z.object({
  kycRecordId: z.number().int().positive(),
  documentType: z.enum(KYC_DOCUMENT_TYPES),
  contentType: z.enum(["image/jpeg", "image/png"]),
  contentLength: z.number().int().min(1).max(MAX_KYC_DOCUMENT_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  description: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});

const completeSchema = z.object({ uploadId: z.string().uuid() });

function invalidUpload(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export const kycDocumentEvidenceRouter = router({
  initiate: protectedProcedure.input(initiateSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required for KYC document upload" });
    }
    if (!KYC_CONTENT_TYPES.has(input.contentType)) {
      invalidUpload("KYC document content type is not allowed");
    }

    const pool = await evidencePoolOrThrow();
    const owner = await pool.query<{ id: number }>(
      `SELECT id FROM kyc_records WHERE id = $1 AND "tenantId" = $2`,
      [input.kycRecordId, ctx.tenantId],
    );
    if (!owner.rows[0]) {
      throw new TRPCError({ code: "NOT_FOUND", message: "KYC record was not found in the current tenant" });
    }

    const keyring = loadEvidenceKeyring();
    const storage = evidenceStorage();
    const existing = await pool.query<{ id: string; object_key: string; expires_at: string }>(
      `SELECT id, object_key, expires_at
       FROM kyc_document_uploads
       WHERE tenant_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
      [ctx.tenantId, ctx.user.id, input.idempotencyKey],
    );

    let uploadId: string;
    let objectKey: string;
    let expiresAt: Date;
    if (existing.rows[0]) {
      uploadId = existing.rows[0].id;
      objectKey = existing.rows[0].object_key;
      expiresAt = new Date(existing.rows[0].expires_at);
      if (expiresAt <= new Date()) {
        throw new TRPCError({ code: "CONFLICT", message: "Existing KYC upload authorization expired; submit a new idempotency key" });
      }
    } else {
      uploadId = randomUUID();
      objectKey = `kyc/${ctx.tenantId}/${input.kycRecordId}/${uploadId}`;
      expiresAt = new Date(Date.now() + KYC_UPLOAD_TTL_SECONDS * 1000);
      const encrypted = encryptEvidenceDescription(keyring, input.description);
      const metadata = {
        documentType: input.documentType,
        expectedSha256: input.sha256,
        contentLength: input.contentLength,
        contentType: input.contentType,
        keyVersion: encrypted.keyVersion,
      };

      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO kyc_document_uploads
           (id, tenant_id, kyc_record_id, actor_user_id, document_type, idempotency_key, object_key, expected_sha256, content_type, content_length, description_ciphertext, description_nonce, description_key_version, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            uploadId,
            ctx.tenantId,
            input.kycRecordId,
            ctx.user.id,
            input.documentType,
            input.idempotencyKey,
            objectKey,
            input.sha256,
            input.contentType,
            input.contentLength,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.keyVersion,
            expiresAt,
          ],
        );
        await pool.query(
          `INSERT INTO kyc_document_custody_events
           (id, kyc_document_upload_id, actor_user_id, event_type, event_sha256, metadata)
           VALUES ($1,$2,$3,'upload_initiated',$4,$5::jsonb)`,
          [
            randomUUID(),
            uploadId,
            ctx.user.id,
            custodyDigest(uploadId, "upload_initiated", metadata),
            JSON.stringify(metadata),
          ],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }

    const objectChecksum = s3ChecksumSha256FromHex(input.sha256);
    const command = new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      Metadata: { "kyc-upload-id": uploadId, sha256: input.sha256 },
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: objectChecksum,
      ServerSideEncryption: storage.sseAlgorithm,
      SSEKMSKeyId: storage.kmsKeyId,
    });
    const uploadUrl = await getSignedUrl(storage.client, command, {
      expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    });
    return {
      uploadId,
      objectKey,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: {
        "content-type": input.contentType,
        "x-amz-meta-kyc-upload-id": uploadId,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-checksum-sha256": objectChecksum,
        "x-amz-server-side-encryption": storage.sseAlgorithm,
        "x-amz-server-side-encryption-aws-kms-key-id": storage.kmsKeyId,
      },
    };
  }),

  complete: protectedProcedure.input(completeSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required for KYC document upload" });
    }
    const pool = await evidencePoolOrThrow();
    const storage = evidenceStorage();
    const result = await pool.query<{
      object_key: string;
      expected_sha256: string;
      content_type: string;
      content_length: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT object_key, expected_sha256, content_type, content_length, status, expires_at
       FROM kyc_document_uploads
       WHERE id = $1 AND tenant_id = $2 AND actor_user_id = $3
       FOR UPDATE`,
      [input.uploadId, ctx.tenantId, ctx.user.id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "KYC document upload authorization was not found" });
    }
    if (row.status === "verified") {
      return { uploadId: input.uploadId, status: "verified" as const };
    }
    if (new Date(row.expires_at) <= new Date()) {
      throw new TRPCError({ code: "CONFLICT", message: "KYC document upload authorization expired" });
    }

    const object = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.object_key, ChecksumMode: "ENABLED" }));
    const observedSha256 = object.Metadata?.sha256 ?? "";
    const checksumValid = s3ChecksumMatchesSha256Hex(row.expected_sha256, object.ChecksumSHA256);
    const expected = Buffer.from(row.expected_sha256, "utf8");
    const observed = Buffer.from(observedSha256, "utf8");
    const valid =
      checksumValid &&
      expected.length === observed.length &&
      timingSafeEqual(expected, observed) &&
      object.ContentType === row.content_type &&
      Number(object.ContentLength) === Number(row.content_length) &&
      object.ServerSideEncryption === storage.sseAlgorithm &&
      object.SSEKMSKeyId === storage.kmsKeyId;

    if (!valid) {
      const metadata = { reason: "object_integrity_or_encryption_validation_failed" };
      await pool.query(
        `UPDATE kyc_document_uploads
         SET status = 'rejected', observed_sha256 = $2, updated_at = NOW()
         WHERE id = $1`,
        [input.uploadId, observedSha256 || null],
      );
      await pool.query(
        `INSERT INTO kyc_document_custody_events
         (id, kyc_document_upload_id, actor_user_id, event_type, event_sha256, metadata)
         VALUES ($1,$2,$3,'upload_rejected',$4,$5::jsonb)`,
        [
          randomUUID(),
          input.uploadId,
          ctx.user.id,
          custodyDigest(input.uploadId, "upload_rejected", metadata),
          JSON.stringify(metadata),
        ],
      );
      invalidUpload("KYC document integrity verification failed");
    }

    const metadata = {
      sha256: observedSha256,
      contentLength: Number(object.ContentLength),
      contentType: object.ContentType,
      objectVersionId: object.VersionId ?? null,
      kmsKeyId: object.SSEKMSKeyId ?? null,
    };
    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE kyc_document_uploads
         SET status = 'verified', observed_sha256 = $2, object_version_id = $3, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [input.uploadId, observedSha256, object.VersionId ?? null],
      );
      await pool.query(
        `INSERT INTO kyc_document_custody_events
         (id, kyc_document_upload_id, actor_user_id, event_type, event_sha256, metadata)
         VALUES ($1,$2,$3,'upload_verified',$4,$5::jsonb)`,
        [
          randomUUID(),
          input.uploadId,
          ctx.user.id,
          custodyDigest(input.uploadId, "upload_verified", metadata),
          JSON.stringify(metadata),
        ],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    return { uploadId: input.uploadId, status: "verified" as const, objectVersionId: object.VersionId ?? null };
  }),
});

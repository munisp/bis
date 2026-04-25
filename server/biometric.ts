/**
 * BIS Biometric Router
 * Provides tRPC procedures for:
 *   - Passive liveness detection (anti-spoofing)
 *   - Active challenge-response liveness (blink, turn head, smile)
 *   - ArcFace facial enrollment and 1:1 matching
 *   - Document OCR with face extraction
 *
 * Routes all calls through the Go gateway → Python biometric engine.
 * Falls back to a deterministic sandbox response when the engine is unavailable.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router, writeProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { kycRecords } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";

const GATEWAY_URL = process.env.BIS_GATEWAY_URL || "http://localhost:8081";
const BIOMETRIC_ENGINE_URL = process.env.BIOMETRIC_ENGINE_URL || "http://localhost:8084";
const GATEWAY_KEY = process.env.BIS_GATEWAY_KEY || "dev-gateway-key-change-in-prod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function biometricFetch(path: string, body: unknown, contentType = "application/json") {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/biometric${path}`, {
      signal: AbortSignal.timeout(30000),
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-BIS-Key": GATEWAY_KEY,
      },
      body: contentType === "application/json" ? JSON.stringify(body) : (body as BodyInit),
    });
    if (!res.ok) throw new Error(`Biometric gateway error ${res.status}`);
    return await res.json();
  } catch (e) {
    // Return sandbox response when engine unavailable
    return null;
  }
}

function sandboxLiveness(challenge: string) {
  return {
    liveness: true,
    score: 0.97,
    challenge,
    passed: true,
    antiSpoofScore: 0.98,
    faceDetected: true,
    faceCount: 1,
    quality: 0.94,
    sandbox: true,
  };
}

function sandboxEnroll(subjectRef: string) {
  return {
    enrolled: true,
    faceId: `face-${subjectRef}-${Date.now()}`,
    quality: 0.94,
    embedding: null, // not exposed to client
    sandbox: true,
  };
}

function sandboxVerify(faceId: string) {
  return {
    match: true,
    similarity: 0.96,
    threshold: 0.80,
    faceId,
    sandbox: true,
  };
}

function sandboxOCR() {
  return {
    documentType: "NIN_SLIP",
    nin: "12345678901",
    firstName: "ADAEZE",
    lastName: "OKONKWO",
    middleName: "CHIOMA",
    dob: "1990-05-15",
    gender: "F",
    address: "12 Adeola Odeku Street, Victoria Island, Lagos",
    issueDate: "2018-03-20",
    faceExtracted: true,
    faceImageUrl: null,
    confidence: 0.91,
    sandbox: true,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const biometricRouter = router({
  /**
   * GET /biometric/challenges — returns available liveness challenges
   */
  getChallenges: publicProcedure.query(() => {
    return {
      challenges: [
        { id: "blink", label: "Blink your eyes", icon: "eye", durationMs: 3000 },
        { id: "turn_left", label: "Turn head left", icon: "arrow-left", durationMs: 3000 },
        { id: "turn_right", label: "Turn head right", icon: "arrow-right", durationMs: 3000 },
        { id: "smile", label: "Smile naturally", icon: "smile", durationMs: 3000 },
        { id: "nod", label: "Nod your head", icon: "arrow-down", durationMs: 3000 },
      ],
    };
  }),

  /**
   * POST /biometric/checkLiveness — passive + active liveness detection
   * Accepts a base64-encoded frame and challenge type.
   */
  checkLiveness: writeProcedure
    .input(
      z.object({
        // SECURITY: max 4MB base64 image (~3MB binary) to prevent DoS
        imageBase64: z.string().max(5_500_000).describe("Base64-encoded JPEG/PNG frame from webcam"),
        challenge: z.enum(["blink", "turn_left", "turn_right", "smile", "nod"]).default("blink"),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Maps to Go gateway /v1/biometric/liveness → Python engine /verify/liveness
      const result = await biometricFetch("/liveness", {
        image: input.imageBase64,
        challenge: input.challenge,
        subject_ref: input.subjectRef,
      });
      return result ?? sandboxLiveness(input.challenge);
    }),

  /**
   * POST /biometric/enroll — enroll a face embedding for a subject
   */
  enroll: writeProcedure
    .input(
      z.object({
        // SECURITY: max 4MB base64 image (~3MB binary) to prevent DoS
        imageBase64: z.string().max(5_500_000),
        subjectRef: z.string().max(128),
        kycRecordId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Maps to Go gateway /v1/biometric/enroll → Python engine /verify/match (enroll stores embedding)
      const result = await biometricFetch("/enroll", {
        image: input.imageBase64,
        subject_ref: input.subjectRef,
      });
      const enrollResult = result ?? sandboxEnroll(input.subjectRef);

      // If a KYC record ID is provided, update the biometric status
      if (input.kycRecordId && enrollResult.enrolled) {
        try {
          const db = await getDb();
          if (db) {
            await db
              .update(kycRecords)
              .set({
                biometricStatus: "enrolled",
                biometricFaceId: enrollResult.faceId,
              })
              .where(eq(kycRecords.id, input.kycRecordId));
          }
        } catch (e) {
          console.warn("[Biometric] Failed to update KYC record:", e);
        }
      }

      return enrollResult;
    }),

  /**
   * POST /biometric/verify — 1:1 face matching against enrolled embedding
   */
  verify: writeProcedure
    .input(
      z.object({
        // SECURITY: max 4MB base64 image (~3MB binary) to prevent DoS
        imageBase64: z.string().max(5_500_000),
        faceId: z.string().max(256),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Maps to Go gateway /v1/biometric/verify → Python engine /verify/match
      const result = await biometricFetch("/verify", {
        image: input.imageBase64,
        face_id: input.faceId,
        subject_ref: input.subjectRef,
      });
      return result ?? sandboxVerify(input.faceId);
    }),

  /**
   * POST /biometric/ocrDocument — extract text and face from ID document
   */
  ocrDocument: writeProcedure
    .input(
      z.object({
        // SECURITY: max 4MB base64 image (~3MB binary) to prevent DoS
        imageBase64: z.string().max(5_500_000),
        documentType: z.enum(["NIN_SLIP", "PASSPORT", "DRIVERS_LICENSE", "VOTERS_CARD", "NIN_CARD"]).default("NIN_SLIP"),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Maps to Go gateway /v1/biometric/ocr → Python engine /ocr/document
      const result = await biometricFetch("/ocr", {
        image: input.imageBase64,
        document_type: input.documentType,
        subject_ref: input.subjectRef,
      });
      if (result) return result;

      // LLM-based OCR fallback when biometric engine is unavailable
      try {
        const llmResult = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a Nigerian identity document OCR engine. Extract structured data from the provided base64-encoded document image. Return JSON only.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract all visible fields from this ${input.documentType} document. Return JSON with fields: documentType, nin (if NIN), firstName, lastName, middleName, dob (YYYY-MM-DD), gender (M/F), address, issueDate (YYYY-MM-DD), faceExtracted (boolean), confidence (0-1).`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${input.imageBase64}`,
                    detail: "high",
                  },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "ocr_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  documentType: { type: "string" },
                  nin: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  middleName: { type: "string" },
                  dob: { type: "string" },
                  gender: { type: "string" },
                  address: { type: "string" },
                  issueDate: { type: "string" },
                  faceExtracted: { type: "boolean" },
                  confidence: { type: "number" },
                },
                required: ["documentType", "firstName", "lastName", "faceExtracted", "confidence"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = llmResult?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = typeof content === "string" ? JSON.parse(content) : content;
          return { ...parsed, sandbox: false, llmFallback: true };
        }
      } catch (e) {
        console.warn("[Biometric OCR] LLM fallback failed:", e);
      }

      return sandboxOCR();
    }),

  /**
   * POST /biometric/fullEnrollment — complete enrollment flow:
   * 1. Liveness check
   * 2. Face enrollment
   * 3. Document OCR (optional)
   * 4. Face-to-document matching (optional)
   */
  fullEnrollment: writeProcedure
    .input(
      z.object({
        // SECURITY: max 4MB base64 image (~3MB binary) to prevent DoS
        livenessImageBase64: z.string().max(5_500_000),
        enrollImageBase64: z.string().max(5_500_000),
        documentImageBase64: z.string().max(5_500_000).optional(),
        challenge: z.enum(["blink", "turn_left", "turn_right", "smile", "nod"]).default("blink"),
        subjectRef: z.string().max(128),
        kycRecordId: z.number().optional(),
        documentType: z.enum(["NIN_SLIP", "PASSPORT", "DRIVERS_LICENSE", "VOTERS_CARD", "NIN_CARD"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Step 1: Liveness check
      const livenessResult = await biometricFetch("/liveness", {
        image: input.livenessImageBase64,
        challenge: input.challenge,
        subject_ref: input.subjectRef,
      }) ?? sandboxLiveness(input.challenge);

      if (!livenessResult.passed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Liveness check failed. Please ensure you are a real person and follow the on-screen instructions.",
        });
      }

      // Step 2: Face enrollment
      const enrollResult = await biometricFetch("/enroll", {
        image: input.enrollImageBase64,
        subject_ref: input.subjectRef,
      }) ?? sandboxEnroll(input.subjectRef);

      // Step 3: Document OCR (optional)
      let ocrResult = null;
      if (input.documentImageBase64 && input.documentType) {
        ocrResult = await biometricFetch("/ocr", {
          image: input.documentImageBase64,
          document_type: input.documentType,
          subject_ref: input.subjectRef,
        }) ?? sandboxOCR();
      }

      // Step 4: Update KYC record
      if (input.kycRecordId && enrollResult.enrolled) {
        try {
          const db = await getDb();
          if (db) {
            await db
              .update(kycRecords)
              .set({
                biometricStatus: "enrolled",
                biometricFaceId: enrollResult.faceId,
                ...(ocrResult ? { documentOcrData: ocrResult } : {}),
              })
              .where(eq(kycRecords.id, input.kycRecordId));
          }
        } catch (e) {
          console.warn("[Biometric] Failed to update KYC record:", e);
        }
      }

      return {
        success: true,
        liveness: livenessResult,
        enrollment: enrollResult,
        ocr: ocrResult,
        faceId: enrollResult.faceId,
        sandbox: livenessResult.sandbox || enrollResult.sandbox,
      };
    }),

  /**
   * GET /biometric/list — paginated list of enrolled biometric records (from kyc_records)
   */
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { data: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const rows = await db
          .select({
            id: kycRecords.id,
            subjectId: kycRecords.subjectRef,
            subjectName: kycRecords.subjectName,
            modality: kycRecords.biometricFaceId,
            status: kycRecords.biometricStatus,
            qualityScore: kycRecords.riskScore,
            enrolledAt: kycRecords.createdAt,
          })
          .from(kycRecords)
          .where(eq(kycRecords.biometricStatus, "enrolled"))
          .limit(input.limit)
          .offset(offset);
        const countResult = await db
          .select({ count: kycRecords.id })
          .from(kycRecords)
          .where(eq(kycRecords.biometricStatus, "enrolled"));
        return {
          data: rows.map(r => ({ ...r, modality: "face" })),
          total: countResult.length,
        };
      } catch (e) {
        return { data: [], total: 0 };
      }
    }),

  /**
   * DELETE /biometric/:id — revoke a biometric enrollment
   */
  delete: writeProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { success: false };
        await db
          .update(kycRecords)
          .set({ biometricStatus: "revoked", biometricFaceId: null })
          .where(eq(kycRecords.id, input.id));
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to revoke biometric enrollment" });
      }
    }),

  getStatus: protectedProcedure
    .input(z.object({ subjectRef: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { enrolled: false, faceId: null, status: "not_enrolled" };
        const record = await db
          .select({
            id: kycRecords.id,
            biometricStatus: kycRecords.biometricStatus,
            biometricFaceId: kycRecords.biometricFaceId,
          })
          .from(kycRecords)
          .where(eq(kycRecords.subjectRef, input.subjectRef))
          .limit(1);

        if (record.length === 0) {
          return { enrolled: false, faceId: null, status: "not_enrolled" };
        }

        return {
          enrolled: record[0].biometricStatus === "enrolled",
          faceId: record[0].biometricFaceId,
          status: record[0].biometricStatus ?? "not_enrolled",
        };
      } catch (e) {
        return { enrolled: false, faceId: null, status: "not_enrolled" };
      }
    }),
});

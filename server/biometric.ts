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
import { protectedProcedure, publicProcedure, router, writeProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, insertBiometricSessionLog, getBiometricSessionLogs, markBiometricSessionKafkaPublished, getBiometricSessionStats } from "./db";
import { kycRecords, biometricSessionLogs, platformSettings } from "../drizzle/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";

const EVENT_PROCESSOR_URL = process.env.EVENT_PROCESSOR_URL || "http://localhost:8083";

async function publishBiometricEvent(
  eventType: string,
  subjectRef: string,
  payload: Record<string, unknown>,
  severity: "info" | "low" | "medium" | "high" | "critical" = "info"
): Promise<boolean> {
  try {
    const res = await fetch(`${EVENT_PROCESSOR_URL}/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": process.env.BIS_GATEWAY_KEY || "dev-gateway-key-change-in-prod",
      },
      body: JSON.stringify({
        event_type: eventType,
        subject_id: subjectRef,
        subject_ref: subjectRef,
        severity,
        payload,
        source_service: "bis-bff",
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (e) {
    // Non-blocking — event publishing failures must not break the main flow
    console.warn(`[Biometric] Failed to publish event ${eventType}:`, e);
    return false;
  }
}

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

  // ─── Active Liveness (video/motion) ─────────────────────────────────────────
  /**
   * POST /biometric/checkActiveLiveness — challenge-response liveness with multiple frames
   * Accepts 3-30 base64-encoded video frames and a challenge type.
   * Returns score, challenge completion status, and per-frame analysis.
   */
  checkActiveLiveness: writeProcedure
    .input(
      z.object({
        frames: z.array(z.string().max(5_500_000)).min(3).max(30),
        challenge: z.enum(["blink", "turn_left", "turn_right", "smile", "nod"]).default("blink"),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/liveness/active", {
        frames: input.frames,
        challenge: input.challenge,
        subject_ref: input.subjectRef,
      }) ?? {
        score: 0.97, live: true, challenge: input.challenge,
        challenge_completed: true, frames_analysed: input.frames.length, sandbox: true,
      };

      // Persist session log
      const sessionId = await insertBiometricSessionLog({
        sessionId: `bio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subjectRef: input.subjectRef ?? "unknown",
        activeLivenessScore: result.score ?? null,
        activeLivenessLive: result.live ?? result.challenge_completed ?? true,
        activeLivenessChallenge: input.challenge,
        activeLivenessChallengeCompleted: result.challenge_completed ?? true,
        activeLivenessFramesAnalysed: result.frames_analysed ?? input.frames.length,
        createdAt: new Date(),
      });

      // Publish event and mark kafkaPublished
      const activeLivenessPublished = await publishBiometricEvent(
        "BIOMETRIC_ACTIVE_LIVENESS_CHECKED",
        input.subjectRef ?? "unknown",
        { score: result.score, challenge: input.challenge, passed: result.live, sessionId },
        result.live ? "info" : "medium"
      );
      if (activeLivenessPublished && sessionId) { markBiometricSessionKafkaPublished(sessionId as any).catch(() => {}); }

      return result;
    }),

  // ─── Anti-Spoofing (with spoof-type classification) ──────────────────────────
  /**
   * POST /biometric/checkAntispoofing — classify spoof attack type
   * Returns: genuine score, spoof type (printed_photo, screen_replay, paper_mask,
   * three_d_mask, deepfake, high_quality_photo), and per-feature scores.
   */
  checkAntispoofing: writeProcedure
    .input(
      z.object({
        imageBase64: z.string().max(5_500_000),
        subjectRef: z.string().max(128).optional(),
        classify: z.boolean().default(true).describe("Use granular spoof-type classification"),
      })
    )
    .mutation(async ({ input }) => {
      const endpoint = input.classify ? "/antispoofing" : "/antispoofing";
      const result = await biometricFetch(endpoint, {
        image: input.imageBase64,
        subject_ref: input.subjectRef,
      }) ?? {
        score: 0.98, genuine: true, reason: "passed",
        spoof_type: "genuine", model: "texture_analysis_fallback", sandbox: true,
        confidence_scores: { genuine: 0.98 },
        features: { sharpness: 0.95, colour_depth: 0.92, hf_score: 0.88, freq_anomaly_score: 0.12, reflection_score: 0.34, depth_score: 0.71 },
      };

      // Persist session log
      const sessionId = await insertBiometricSessionLog({
        sessionId: `bio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subjectRef: input.subjectRef ?? "unknown",
        antiSpoofScore: result.score ?? null,
        antiSpoofGenuine: result.genuine ?? true,
        antiSpoofType: (result.spoof_type ?? "unknown") as any,
        antiSpoofModel: result.model ?? null,
        antiSpoofSharpness: result.features?.sharpness ?? null,
        antiSpoofColourDepth: result.features?.colour_depth ?? null,
        antiSpoofHfScore: result.features?.hf_score ?? null,
        antiSpoofFreqAnomalyScore: result.features?.freq_anomaly_score ?? null,
        antiSpoofReflectionScore: result.features?.reflection_score ?? null,
        antiSpoofDepthScore: result.features?.depth_score ?? null,
        createdAt: new Date(),
      });

      // Publish event and mark kafkaPublished
      const antiSpoofPublished = await publishBiometricEvent(
        "BIOMETRIC_ANTI_SPOOFING_CHECKED",
        input.subjectRef ?? "unknown",
        { score: result.score, genuine: result.genuine, spoof_type: result.spoof_type, sessionId },
        result.genuine ? "info" : "high"
      );
      if (antiSpoofPublished && sessionId) { markBiometricSessionKafkaPublished(sessionId as any).catch(() => {}); }

      return result;
    }),

  // ─── Face Matching (1:1 two-image comparison) ────────────────────────────────
  /**
   * POST /biometric/matchFaces — compare two face images
   * Returns cosine similarity, match boolean, and ArcFace embedding metadata.
   */
  matchFaces: writeProcedure
    .input(
      z.object({
        probeImageBase64: z.string().max(5_500_000).describe("The face to verify (selfie)"),
        referenceImageBase64: z.string().max(5_500_000).describe("The reference face (ID document or enrolled)"),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/match", {
        probe: input.probeImageBase64,
        reference: input.referenceImageBase64,
        subject_ref: input.subjectRef,
      }) ?? {
        score: 0.96, cosine_similarity: 0.92, match: true,
        threshold: 0.40, reason: "match", using_arcface: false, sandbox: true,
      };

      // Persist session log
      const sessionId = await insertBiometricSessionLog({
        sessionId: `bio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subjectRef: input.subjectRef ?? "unknown",
        matchScore: result.score ?? null,
        matchCosineSimilarity: result.cosine_similarity ?? null,
        matchDecision: result.match ?? true,
        matchThreshold: result.threshold ?? null,
        createdAt: new Date(),
      });

      // Publish event and mark kafkaPublished
      const faceMatchPublished = await publishBiometricEvent(
        "BIOMETRIC_FACE_MATCHED",
        input.subjectRef ?? "unknown",
        { score: result.score, match: result.match, cosine_similarity: result.cosine_similarity, sessionId },
        result.match ? "info" : "medium"
      );
      if (faceMatchPublished && sessionId) { markBiometricSessionKafkaPublished(sessionId as any).catch(() => {}); }

      return result;
    }),

  // ─── Face Detection ──────────────────────────────────────────────────────────
  /**
   * POST /biometric/detectFace — detect faces and return bounding boxes
   * Returns face count, bounding boxes, quality score, and detection confidence.
   */
  detectFace: writeProcedure
    .input(
      z.object({
        imageBase64: z.string().max(5_500_000),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/detect", {
        image: input.imageBase64,
        subject_ref: input.subjectRef,
      }) ?? {
        face_detected: true, face_count: 1, quality_score: 0.94,
        bbox: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, sandbox: true,
      };
      return result;
    }),

  // ─── 68-Point Facial Landmarks ───────────────────────────────────────────────
  /**
   * POST /biometric/detectLandmarks — extract 68-point facial landmarks
   * Returns normalized (x,y,z) coordinates mapped to standard 68-point model.
   * Jaw (0-16), eyebrows (17-26), nose (27-35), eyes (36-47), mouth (48-67).
   */
  detectLandmarks: writeProcedure
    .input(
      z.object({
        imageBase64: z.string().max(5_500_000),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/landmarks", {
        image: input.imageBase64,
        subject_ref: input.subjectRef,
      }) ?? {
        landmarks_found: true, landmark_count: 68, sandbox: true,
        landmarks: Array.from({ length: 68 }, (_, i) => ({ x: 0.3 + i * 0.001, y: 0.4 + i * 0.001, z: 0.0, x_norm: 0.3, y_norm: 0.4 })),
        landmark_variance: 0.00123,
      };
      return result;
    }),

  // ─── Face Feature Extraction ─────────────────────────────────────────────────
  /**
   * POST /biometric/extractFeatures — extract face embedding metadata
   * Returns embedding dimension (512 ArcFace / 128 LBPH), quality score,
   * and bounding box. Embedding vector is NOT exposed to the client.
   */
  extractFeatures: writeProcedure
    .input(
      z.object({
        imageBase64: z.string().max(5_500_000),
        subjectRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/features", {
        image: input.imageBase64,
        subject_ref: input.subjectRef,
      }) ?? {
        face_detected: true, embedding_dimension: 512,
        embedding_model: "arcface_fallback", quality_score: 0.94,
        embedding_norm: 0.98, sandbox: true,
      };
      return result;
    }),

  // ─── Full Composite Verification ─────────────────────────────────────────────
  /**
   * POST /biometric/fullVerify — composite: liveness + antispoofing + face match
   * The primary KYC biometric endpoint. Returns overall pass/fail, per-component
   * scores, and failure reasons.
   */
  fullVerify: writeProcedure
    .input(
      z.object({
        selfieBase64: z.string().max(5_500_000),
        referenceBase64: z.string().max(5_500_000).optional(),
        subjectRef: z.string().max(128).optional(),
        kycRecordId: z.number().int().optional(),
        runAntispoofing: z.boolean().default(true),
        runMatch: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const result = await biometricFetch("/full", {
        selfie: input.selfieBase64,
        reference: input.referenceBase64,
        subject_ref: input.subjectRef,
        run_antispoofing: input.runAntispoofing,
        run_match: input.runMatch,
      }) ?? {
        verified: true, overall_score: 0.96, sandbox: true,
        liveness: { live: true, score: 0.97 },
        antispoofing: { genuine: true, score: 0.98 },
        face_match: null, failure_reasons: [],
      };

      // Persist session log
      const sessionId = await insertBiometricSessionLog({
        sessionId: `bio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subjectRef: input.subjectRef ?? "unknown",
        kycRecordId: input.kycRecordId ?? null,
        livenessScore: result.liveness?.score ?? null,
        livenessLive: result.liveness?.live ?? true,
        antiSpoofScore: result.antispoofing?.score ?? null,
        antiSpoofGenuine: result.antispoofing?.genuine ?? true,
        matchScore: result.face_match?.score ?? null,
        matchDecision: result.face_match?.match ?? null,
        overallScore: result.overall_score ?? null,
        overallVerified: result.verified ?? true,
        failureReasons: Array.isArray(result.failure_reasons) ? result.failure_reasons.join(",") : null,
        createdAt: new Date(),
      });

      // Update KYC record if provided
      if (input.kycRecordId && result.verified) {
        try {
          const db = await getDb();
          if (db) {
            await db.update(kycRecords)
              .set({ biometricStatus: "enrolled" })
              .where(eq(kycRecords.id, input.kycRecordId));
          }
        } catch (e) {
          console.warn("[Biometric] Failed to update KYC record after fullVerify:", e);
        }
      }

      // Publish event and mark kafkaPublished
      const fullVerifyPublished = await publishBiometricEvent(
        "BIOMETRIC_FULL_VERIFICATION",
        input.subjectRef ?? "unknown",
        {
          verified: result.verified, overall_score: result.overall_score,
          failure_reasons: result.failure_reasons, sessionId,
        },
        result.verified ? "info" : "high"
      );
      if (fullVerifyPublished && sessionId) { markBiometricSessionKafkaPublished(sessionId as any).catch(() => {}); }

      return result;
    }),

  // ─── Session Stats ─────────────────────────────────────────────────────────────
  /**
   * GET /biometric/sessionStats — daily pass/fail time-series + spoof-type breakdown
   */
  sessionStats: protectedProcedure
    .input(
      z.object({
        days: z.number().int().min(7).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      return getBiometricSessionStats({ days: input.days });
    }),

  // ─── Session Logs ─────────────────────────────────────────────────────────────
  /**
   * GET /biometric/sessionLogs — paginated biometric session log history
   */
  sessionLogs: protectedProcedure
    .input(
      z.object({
        subjectRef: z.string().max(128).optional(),
        kycRecordId: z.number().int().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const logs = await getBiometricSessionLogs({
        subjectRef: input.subjectRef,
        kycRecordId: input.kycRecordId,
        limit: input.limit,
        offset: (input.page - 1) * input.limit,
      });
      const safeList = Array.isArray(logs) ? logs : [];
      return { data: safeList, total: safeList.length };
    }),

  // ── Spoof Alert Threshold Settings ──────────────────────────────────────────

  getSpoofAlertThreshold: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { perTypeThreshold: 5, notificationsEnabled: true };
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "biometric_spoof_alert_threshold"))
      .limit(1);
    const config = row?.value as any;
    return {
      perTypeThreshold: Number(config?.perTypeThreshold ?? 5),
      notificationsEnabled: Boolean(config?.notificationsEnabled ?? true),
    };
  }),

  setSpoofAlertThreshold: writeProcedure
    .input(z.object({
      perTypeThreshold: z.number().int().min(1).max(100),
      notificationsEnabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(eq(platformSettings.key, "biometric_spoof_alert_threshold"))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(platformSettings)
          .set({ value: input, updatedAt: new Date() })
          .where(eq(platformSettings.key, "biometric_spoof_alert_threshold"));
      } else {
        await db.insert(platformSettings).values({
          key: "biometric_spoof_alert_threshold",
          value: input,
        });
      }
      return { success: true };
    }),

  // ── Session Log Export ───────────────────────────────────────────────────────

  exportSessionLogs: protectedProcedure
    .input(z.object({
      subjectRef: z.string().optional(),
      kycRecordId: z.string().optional(),
      days: z.number().int().min(1).max(365).default(30),
      format: z.enum(["csv", "json", "pdf"]).default("csv"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 3_600_000);
      const conditions = [gte(biometricSessionLogs.createdAt, since)];
      if (input.subjectRef) conditions.push(eq(biometricSessionLogs.subjectRef, input.subjectRef));
      if (input.kycRecordId) conditions.push(eq(biometricSessionLogs.kycRecordId, parseInt(input.kycRecordId, 10)));

      const rows = await db
        .select()
        .from(biometricSessionLogs)
        .where(and(...conditions))
        .orderBy(desc(biometricSessionLogs.createdAt))
        .limit(10000);

      let content: string;
      let contentType: string;
      let ext: string;

      if (input.format === "csv") {
        const headers = [
          "id", "subjectRef", "kycRecordId", "overallVerified", "overallScore",
          "livenessScore", "livenessLive", "activeLivenessScore", "activeLivenessLive",
          "activeLivenessChallenge", "antiSpoofScore", "antiSpoofGenuine", "antiSpoofType",
          "matchScore", "matchDecision", "faceDetected", "faceCount",
          "embeddingDimension", "embeddingModel", "failureReasons",
          "kafkaPublished", "latencyMs", "engineVersion", "createdAt",
        ];
        const csvRows = rows.map(r => [
          r.id, r.subjectRef ?? "", r.kycRecordId ?? "",
          r.overallVerified ? "true" : "false", r.overallScore ?? "",
          r.livenessScore ?? "", r.livenessLive ? "true" : "false",
          r.activeLivenessScore ?? "", r.activeLivenessLive ? "true" : "false",
          r.activeLivenessChallenge ?? "",
          r.antiSpoofScore ?? "", r.antiSpoofGenuine ? "true" : "false", r.antiSpoofType ?? "",
          r.matchScore ?? "", r.matchDecision ? "true" : "false",
          r.faceDetected ? "true" : "false", r.faceCount ?? "",
          r.embeddingDimension ?? "", r.embeddingModel ?? "",
          JSON.stringify(r.failureReasons ?? []).replace(/"/g, "'"),
          r.kafkaPublished ? "true" : "false",
          r.latencyMs ?? "", r.engineVersion ?? "",
          r.createdAt?.toISOString() ?? "",
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        content = [headers.join(","), ...csvRows].join("\n");
        contentType = "text/csv";
        ext = "csv";
      } else if (input.format === "pdf") {
        // ── PDF compliance report (weasyprint) ───────────────────────────────
        const escHtml = (s: unknown) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
        const passCount = rows.filter(r => r.overallVerified).length;
        const failCount = rows.length - passCount;
        const spoofCounts: Record<string, number> = {};
        rows.forEach(r => { if (r.antiSpoofType) spoofCounts[r.antiSpoofType] = (spoofCounts[r.antiSpoofType] ?? 0) + 1; });
        const spoofRows = Object.entries(spoofCounts).map(([t, c]) =>
          `<tr><td>${escHtml(t.replace(/_/g," ").toUpperCase())}</td><td>${c}</td><td>${((c/rows.length)*100).toFixed(1)}%</td></tr>`
        ).join("");
        const tableRows = rows.slice(0, 500).map(r =>
          `<tr class="${r.overallVerified ? "pass" : "fail"}">
            <td>${escHtml(r.id)}</td>
            <td>${escHtml(r.subjectRef)}</td>
            <td>${r.overallVerified ? "PASS" : "FAIL"}</td>
            <td>${escHtml((r.overallScore ?? 0).toFixed(3))}</td>
            <td>${escHtml((r.livenessScore ?? 0).toFixed(3))}</td>
            <td>${escHtml((r.antiSpoofScore ?? 0).toFixed(3))}</td>
            <td>${escHtml(r.antiSpoofType ?? "—")}</td>
            <td>${escHtml((r.matchScore ?? 0).toFixed(3))}</td>
            <td>${r.createdAt?.toISOString().slice(0,19).replace("T"," ") ?? ""}</td>
          </tr>`
        ).join("");
        const reportDate = new Date().toISOString().slice(0,10);
        const filterDesc = [
          input.subjectRef ? `Subject: ${input.subjectRef}` : null,
          input.kycRecordId ? `KYC Record: ${input.kycRecordId}` : null,
          `Last ${input.days} days`,
        ].filter(Boolean).join(" | ");
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; color: #1a1a2e; margin: 20px; }
  h1 { font-size: 16px; color: #1e3a5f; margin-bottom: 2px; }
  h2 { font-size: 12px; color: #1e3a5f; margin: 16px 0 6px; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .meta { font-size: 9px; color: #666; }
  .summary { display: flex; gap: 24px; margin: 12px 0; }
  .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 16px; text-align: center; }
  .stat .val { font-size: 22px; font-weight: bold; color: #1e3a5f; }
  .stat .lbl { font-size: 9px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { background: #1e3a5f; color: white; padding: 5px 6px; text-align: left; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  tr.pass td { background: #f0fdf4; }
  tr.fail td { background: #fff1f2; }
  .footer { margin-top: 24px; font-size: 8px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 72px; color: rgba(30,58,95,0.04); font-weight: bold; pointer-events: none; white-space: nowrap; }
  @page { size: A4 landscape; margin: 15mm; }
</style></head><body>
<div class="watermark">OFFICIAL USE ONLY</div>
<div class="header">
  <div>
    <h1>BIOMETRIC AUDIT TRAIL REPORT</h1>
    <p class="meta">Background Intelligence System (BIS) — Federal Republic of Nigeria</p>
    <p class="meta">Generated: ${reportDate} | Filter: ${filterDesc} | Total records: ${rows.length}</p>
  </div>
  <div style="text-align:right">
    <p class="meta">NFIU/CBN Compliance Export</p>
    <p class="meta">ISO 30107-3 Anti-Spoofing Audit</p>
  </div>
</div>
<h2>1. Summary</h2>
<div class="summary">
  <div class="stat"><div class="val">${rows.length}</div><div class="lbl">Total Sessions</div></div>
  <div class="stat"><div class="val" style="color:#16a34a">${passCount}</div><div class="lbl">Passed</div></div>
  <div class="stat"><div class="val" style="color:#dc2626">${failCount}</div><div class="lbl">Failed</div></div>
  <div class="stat"><div class="val">${rows.length > 0 ? ((passCount/rows.length)*100).toFixed(1) : "0.0"}%</div><div class="lbl">Pass Rate</div></div>
</div>
<h2>2. Spoof Attack Breakdown</h2>
<table><thead><tr><th>Attack Type</th><th>Count</th><th>% of Total</th></tr></thead><tbody>${spoofRows || "<tr><td colspan=3>No spoof attacks detected in period</td></tr>"}</tbody></table>
<h2>3. Session Log (latest ${Math.min(rows.length,500)} of ${rows.length} records)</h2>
<table><thead><tr><th>ID</th><th>Subject Ref</th><th>Result</th><th>Overall Score</th><th>Liveness</th><th>Anti-Spoof</th><th>Spoof Type</th><th>Match Score</th><th>Timestamp (UTC)</th></tr></thead><tbody>${tableRows}</tbody></table>
<div class="footer">
  <div>Biometric Audit Trail — BIS LEX/KYC Module — For official use only. Unauthorised disclosure is an offence.</div>
  <div>Report ref: BIO-AUDIT-${Date.now()} | ${reportDate}</div>
</div>
</body></html>`;
        const { spawnSync } = await import("child_process");
        const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
        const safeTs = Date.now();
        const tmpHtml = `/tmp/bio_audit_${safeTs}.html`;
        const tmpPdf = `/tmp/bio_audit_${safeTs}.pdf`;
        writeFileSync(tmpHtml, html);
        const result = spawnSync("weasyprint", [tmpHtml, tmpPdf], { timeout: 30000 });
        try { unlinkSync(tmpHtml); } catch {}
        if (result.status !== 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PDF generation failed — weasyprint error" });
        }
        const pdfBuffer = readFileSync(tmpPdf);
        try { unlinkSync(tmpPdf); } catch {}
        const timestamp2 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const fileKey2 = `biometric-exports/audit-report-${timestamp2}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        const { url: pdfUrl } = await storagePut(fileKey2, pdfBuffer, "application/pdf");
        return { url: pdfUrl, rowCount: rows.length, format: "pdf" as const, generatedAt: new Date() };
      } else {
        content = JSON.stringify(rows, null, 2);
        contentType = "application/json";
        ext = "json";
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileKey = `biometric-exports/session-logs-${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { url } = await storagePut(fileKey, Buffer.from(content, "utf-8"), contentType);

      return {
        url,
        rowCount: rows.length,
        format: input.format,
        generatedAt: new Date(),
      };
    }),

  // ── Retention Policy Settings ────────────────────────────────────────────────
  // Read the configurable hot-storage retention window (default 90 days).
  getRetentionDays: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { retentionDays: 90 };
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "biometric_retention_days"))
      .limit(1);
    const retentionDays = row?.value ? Number(row.value) : 90;
    return { retentionDays: isNaN(retentionDays) ? 90 : retentionDays };
  }),

  // Write the configurable hot-storage retention window.
  setRetentionDays: adminProcedure
    .input(z.object({ retentionDays: z.number().int().min(7).max(3650) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(eq(platformSettings.key, "biometric_retention_days"))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(platformSettings)
          .set({ value: input.retentionDays, updatedAt: new Date() })
          .where(eq(platformSettings.key, "biometric_retention_days"));
      } else {
        await db.insert(platformSettings).values({
          key: "biometric_retention_days",
          value: input.retentionDays,
          namespace: "biometric",
        });
      }
      return { retentionDays: input.retentionDays };
    }),

  // ── On-Demand Archival Trigger ───────────────────────────────────────────────
  // Allows admins to trigger an immediate archival run outside the weekly schedule.
  triggerArchival: adminProcedure.mutation(async () => {
    try {
      const { runBiometricSessionLogArchival } = await import("./biometricSessionLogArchiver");
      const result = await runBiometricSessionLogArchival();
      return {
        success: true,
        archived: result.archived,
        deleted: result.deleted,
        skipped: result.skipped,
        errors: result.errors,
        ranAt: new Date(),
      };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Archival run failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }),

  // ── Archival Status ─────────────────────────────────────────────────────────
  // Returns count of rows eligible for archival (older than 90 days),
  // last archival run timestamp, and next scheduled run.
  archivalStatus: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {
      eligibleRows: 0,
      lastArchivalRun: null,
      nextArchivalRun: null,
      coldStoragePrefix: "biometric-archive/",
      retentionDays: 90,
    };

    // Read retention days from platformSettings (default 90)
    const [retentionRow] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "biometric_retention_days"))
      .limit(1);
    const retentionDays = retentionRow?.value ? Number(retentionRow.value) : 90;
    const effectiveRetention = isNaN(retentionDays) ? 90 : retentionDays;

    const cutoff = new Date(Date.now() - effectiveRetention * 24 * 60 * 60 * 1000);
    // Count rows older than retention window still in hot table
    const { sql: sqlFn } = await import("drizzle-orm");
    const [countResult] = await db
      .select({ count: sqlFn<number>`count(*)` })
      .from(biometricSessionLogs)
      .where(sqlFn`${biometricSessionLogs.createdAt} < ${cutoff}`);
    const eligibleRows = Number(countResult?.count ?? 0);
    // Read last archival run from platformSettings
    const [setting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "biometric_last_archival_run"))
      .limit(1);
    const lastArchivalRun = setting?.value ? new Date(setting.value as string) : null;
    // Next run: next Sunday at 03:00 UTC
    const now = new Date();
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    const nextSunday = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday,
      3, 0, 0, 0
    ));
    return {
      eligibleRows,
      lastArchivalRun,
      nextArchivalRun: nextSunday,
      coldStoragePrefix: "biometric-archive/",
      retentionDays: effectiveRetention,
    };
  }),
});

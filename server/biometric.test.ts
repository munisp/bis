/**
 * BIS Biometric Router — Vitest Test Suite
 * ==========================================
 * Tests 5 critical flows:
 *   1. getChallenges — returns challenge list
 *   2. checkLiveness — sandbox fallback when engine unavailable
 *   3. enroll — sandbox fallback + KYC record update
 *   4. ocrDocument — LLM fallback when engine unavailable
 *   5. fullEnrollment — end-to-end chain (liveness → enroll → OCR)
 *   6. getStatus — queries KYC record biometric status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock getDb ────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null), // DB unavailable by default
  getDashboardStats: vi.fn(),
  getFieldAgents: vi.fn(),
  createFieldAgent: vi.fn(),
  updateFieldAgent: vi.fn(),
  getFieldAgentById: vi.fn(),
  getDataSources: vi.fn(),
  createDataSource: vi.fn(),
  updateDataSource: vi.fn(),
  getMonitors: vi.fn(),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  getScreeningRequests: vi.fn(),
  createScreeningRequest: vi.fn(),
  updateScreeningRequest: vi.fn(),
}));

// ─── Mock LLM ─────────────────────────────────────────────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          documentType: "NIN_SLIP",
          firstName: "Adebayo",
          lastName: "Okafor",
          nin: "12345678901",
          dateOfBirth: "1990-01-15",
          nationality: "Nigerian",
          confidence: 0.88,
          rawText: "NATIONAL IDENTITY NUMBER\nADEBAYO OKAFOR\n12345678901",
        }),
      },
    }],
  }),
}));

// ─── Import router after mocks ─────────────────────────────────────────────────

import { biometricRouter } from "./biometric";

// ─── Helper: create caller context ────────────────────────────────────────────

function makeCtx(userId = 1, role: "admin" | "user" = "user") {
  return {
    user: {
      id: userId,
      email: "test@bis.ng",
      name: "Test User",
      role,
      openId: "test-open-id",
    },
    req: {} as any,
    res: {} as any,
  };
}

function makeCaller(ctx = makeCtx()) {
  return biometricRouter.createCaller(ctx as any);
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe("biometricRouter", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: gateway is unavailable (network error)
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Flow 1: getChallenges ──────────────────────────────────────────────────

  describe("getChallenges", () => {
    it("returns a list of challenge types", async () => {
      const caller = makeCaller();
      const result = await caller.getChallenges();

      expect(result).toHaveProperty("challenges");
      expect(Array.isArray(result.challenges)).toBe(true);
      expect(result.challenges.length).toBeGreaterThan(0);

      const challenge = result.challenges[0];
      expect(challenge).toHaveProperty("id");
      expect(challenge).toHaveProperty("label");
      expect(challenge).toHaveProperty("durationMs");
    });

    it("includes blink as a challenge", async () => {
      const caller = makeCaller();
      const result = await caller.getChallenges();
      const ids = result.challenges.map((c: { id: string }) => c.id);
      expect(ids).toContain("blink");
    });

    it("includes turn_left and turn_right challenges", async () => {
      const caller = makeCaller();
      const result = await caller.getChallenges();
      const ids = result.challenges.map((c: { id: string }) => c.id);
      expect(ids).toContain("turn_left");
      expect(ids).toContain("turn_right");
    });
  });

  // ── Flow 2: checkLiveness ─────────────────────────────────────────────────

  describe("checkLiveness", () => {
    it("returns sandbox result when gateway is unavailable", async () => {
      const caller = makeCaller();
      const result = await caller.checkLiveness({
        imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        challenge: "blink",
        subjectRef: "TEST-001",
      });

      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("sandbox");
      expect(result.sandbox).toBe(true);
      expect(typeof result.score).toBe("number");
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("passes liveness when gateway returns success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ passed: true, score: 0.95, live: true, sandbox: false }),
      });

      const caller = makeCaller();
      const result = await caller.checkLiveness({
        imageBase64: "base64data",
        challenge: "turn_left",
      });

      expect(result.passed).toBe(true);
      expect(result.score).toBe(0.95);
    });

    it("handles all challenge types", async () => {
      const caller = makeCaller();
      const challenges = ["blink", "turn_left", "turn_right", "smile", "nod"] as const;

      for (const challenge of challenges) {
        const result = await caller.checkLiveness({
          imageBase64: "base64data",
          challenge,
        });
        expect(result).toHaveProperty("passed");
        expect(result).toHaveProperty("score");
      }
    });
  });

  // ── Flow 3: enroll ────────────────────────────────────────────────────────

  describe("enroll", () => {
    it("returns sandbox enrollment when gateway is unavailable", async () => {
      const caller = makeCaller();
      const result = await caller.enroll({
        imageBase64: "base64faceimage",
        subjectRef: "NIN-12345678901",
      });

      expect(result).toHaveProperty("enrolled");
      expect(result).toHaveProperty("faceId");
      expect(result.enrolled).toBe(true);
      expect(typeof result.faceId).toBe("string");
      expect(result.faceId!.length).toBeGreaterThan(0);
    });

    it("returns faceId from gateway when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enrolled: true,
          face_id: "face:NIN-12345678901",
          subject_ref: "NIN-12345678901",
          using_arcface: true,
        }),
      });

      const caller = makeCaller();
      const result = await caller.enroll({
        imageBase64: "base64faceimage",
        subjectRef: "NIN-12345678901",
      });

      expect(result.enrolled).toBe(true);
      // faceId may be face_id from gateway or mapped faceId
      expect(result.faceId ?? (result as any).face_id).toBeTruthy();
    });

    it("does not throw when kycRecordId is provided but DB is unavailable", async () => {
      const caller = makeCaller();
      // Should not throw — just logs warning
      await expect(
        caller.enroll({
          imageBase64: "base64faceimage",
          subjectRef: "NIN-12345678901",
          kycRecordId: 999,
        })
      ).resolves.toHaveProperty("enrolled", true);
    });
  });

  // ── Flow 4: ocrDocument ───────────────────────────────────────────────────

  describe("ocrDocument", () => {
    it("falls back to LLM OCR when gateway is unavailable", async () => {
      const caller = makeCaller();
      const result = await caller.ocrDocument({
        imageBase64: "base64documentimage",
        documentType: "NIN_SLIP",
        subjectRef: "TEST-002",
      });

      expect(result).toHaveProperty("documentType");
      expect(result).toHaveProperty("confidence");
      // LLM fallback returns these fields
      expect(result.documentType).toBe("NIN_SLIP");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("returns OCR data from gateway when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documentType: "NIN_SLIP",
          firstName: "Chukwuemeka",
          lastName: "Nwosu",
          nin: "98765432101",
          confidence: 0.94,
        }),
      });

      const caller = makeCaller();
      const result = await caller.ocrDocument({
        imageBase64: "base64documentimage",
        documentType: "NIN_SLIP",
      });

      expect(result.firstName).toBe("Chukwuemeka");
      expect(result.nin).toBe("98765432101");
    });

    it("handles PASSPORT document type", async () => {
      const caller = makeCaller();
      const result = await caller.ocrDocument({
        imageBase64: "base64passportimage",
        documentType: "PASSPORT",
      });
      expect(result).toHaveProperty("confidence");
    });
  });

  // ── Flow 5: fullEnrollment ────────────────────────────────────────────────

  describe("fullEnrollment", () => {
    it("chains liveness + enroll and returns success with sandbox fallback", async () => {
      const caller = makeCaller();
      const result = await caller.fullEnrollment({
        livenessImageBase64: "base64liveness",
        enrollImageBase64: "base64enroll",
        challenge: "blink",
        subjectRef: "BVN-12345678901",
      });

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("liveness");
      expect(result).toHaveProperty("enrollment");
      expect(result.success).toBe(true);
      expect(result.liveness).toHaveProperty("passed");
      expect(result.enrollment).toHaveProperty("enrolled");
    });

    it("includes OCR data when document image is provided", async () => {
      const caller = makeCaller();
      const result = await caller.fullEnrollment({
        livenessImageBase64: "base64liveness",
        enrollImageBase64: "base64enroll",
        documentImageBase64: "base64document",
        challenge: "smile",
        subjectRef: "NIN-11111111111",
        documentType: "NIN_SLIP",
      });

      expect(result.success).toBe(true);
      expect(result.ocr).toBeDefined();
    });

    it("returns faceId from enrollment step", async () => {
      const caller = makeCaller();
      const result = await caller.fullEnrollment({
        livenessImageBase64: "base64liveness",
        enrollImageBase64: "base64enroll",
        challenge: "nod",
        subjectRef: "PHONE-08012345678",
      });

      expect(result.faceId).toBeDefined();
      expect(typeof result.faceId).toBe("string");
    });

    it("marks sandbox flag when running in fallback mode", async () => {
      const caller = makeCaller();
      const result = await caller.fullEnrollment({
        livenessImageBase64: "base64liveness",
        enrollImageBase64: "base64enroll",
        challenge: "blink",
        subjectRef: "TEST-SANDBOX",
      });

      expect(result.sandbox).toBe(true);
    });
  });

  // ── Flow 6: getStatus ─────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns not_enrolled when DB is unavailable", async () => {
      const caller = makeCaller();
      const result = await caller.getStatus({ subjectRef: "NIN-99999999999" });

      expect(result).toHaveProperty("enrolled");
      expect(result).toHaveProperty("status");
      expect(result.enrolled).toBe(false);
      expect(result.status).toBe("not_enrolled");
    });

    it("returns enrolled status when DB has record", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValueOnce({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{
          id: 1,
          biometricStatus: "enrolled",
          biometricFaceId: "face:NIN-12345678901",
        }]),
      } as any);

      const caller = makeCaller();
      const result = await caller.getStatus({ subjectRef: "NIN-12345678901" });

      expect(result.enrolled).toBe(true);
      expect(result.status).toBe("enrolled");
      expect(result.faceId).toBe("face:NIN-12345678901");
    });

    it("returns not_enrolled when subject has no record", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValueOnce({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      } as any);

      const caller = makeCaller();
      const result = await caller.getStatus({ subjectRef: "UNKNOWN-REF" });

      expect(result.enrolled).toBe(false);
      expect(result.status).toBe("not_enrolled");
    });
  });

  // ── Security: protected procedures require auth ───────────────────────────

  describe("authentication", () => {
    it("checkLiveness requires authentication", async () => {
      const caller = biometricRouter.createCaller({ user: null } as any);
      await expect(
        caller.checkLiveness({ imageBase64: "data", challenge: "blink" })
      ).rejects.toThrow();
    });

    it("enroll requires authentication", async () => {
      const caller = biometricRouter.createCaller({ user: null } as any);
      await expect(
        caller.enroll({ imageBase64: "data", subjectRef: "TEST" })
      ).rejects.toThrow();
    });

    it("fullEnrollment requires authentication", async () => {
      const caller = biometricRouter.createCaller({ user: null } as any);
      await expect(
        caller.fullEnrollment({
          livenessImageBase64: "data",
          enrollImageBase64: "data",
          challenge: "blink",
          subjectRef: "TEST",
        })
      ).rejects.toThrow();
    });
  });
});

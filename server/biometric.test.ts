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
  insertBiometricSessionLog: vi.fn().mockResolvedValue(42),
  getBiometricSessionLogs: vi.fn().mockResolvedValue([]),
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

// ─── New Biometric Procedure Tests ────────────────────────────────────────────

describe("checkActiveLiveness", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox response when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkActiveLiveness({
      frames: ["frame1", "frame2", "frame3"],
      challenge: "blink",
      subjectRef: "TEST-001",
    });
    expect(result.live).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.sandbox).toBe(true);
  });

  it("returns engine response when available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 0.95, live: true, challenge: "blink",
        challenge_completed: true, frames_analysed: 5,
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkActiveLiveness({
      frames: ["f1", "f2", "f3", "f4", "f5"],
      challenge: "blink",
      subjectRef: "TEST-002",
    });
    expect(result.live).toBe(true);
    expect(result.challenge_completed).toBe(true);
    expect(result.sandbox).toBeUndefined();
  });

  it("rejects fewer than 3 frames", async () => {
    const caller = biometricRouter.createCaller(makeCtx());
    await expect(
      caller.checkActiveLiveness({ frames: ["f1", "f2"], challenge: "smile" })
    ).rejects.toThrow();
  });

  it("rejects more than 30 frames", async () => {
    const caller = biometricRouter.createCaller(makeCtx());
    const frames = Array.from({ length: 31 }, (_, i) => `frame${i}`);
    await expect(
      caller.checkActiveLiveness({ frames, challenge: "nod" })
    ).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(
      caller.checkActiveLiveness({ frames: ["f1", "f2", "f3"], challenge: "blink" })
    ).rejects.toThrow();
  });

  it("allows first submission with unique frames (no DB — sandbox fallback)", async () => {
    // getDb returns null (mocked) → replay protection skipped → sandbox response
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkActiveLiveness({
      frames: ["unique-frame-A", "unique-frame-B", "unique-frame-C"],
      challenge: "smile",
      subjectRef: "REPLAY-TEST-001",
    });
    expect(result.live).toBe(true);
    expect(result.sandbox).toBe(true);
  });

  it("replay protection: rejects duplicate frame hash when DB is available", async () => {
    // Simulate DB returning an existing nonce for the same frame hash
    const { getDb: mockGetDb } = await import("./db");
    const mockSelect = vi.fn().mockResolvedValue([{ id: 99 }]);
    const mockDbInstance = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 99 }]),
          }),
        }),
      }),
      insert: vi.fn(),
    };
    (mockGetDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockDbInstance);

    const caller = biometricRouter.createCaller(makeCtx());
    await expect(
      caller.checkActiveLiveness({
        frames: ["dup-frame-1", "dup-frame-2", "dup-frame-3"],
        challenge: "blink",
        subjectRef: "REPLAY-TEST-002",
      })
    ).rejects.toThrow("Duplicate liveness submission detected");
  });

  it("replay protection: stores nonce on first submission when DB is available", async () => {
    const { getDb: mockGetDb } = await import("./db");
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockReturnValue({ catch: vi.fn().mockResolvedValue(undefined) }) });
    const mockDbInstance = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // no existing nonce
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    (mockGetDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockDbInstance);
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkActiveLiveness({
      frames: ["new-frame-X", "new-frame-Y", "new-frame-Z"],
      challenge: "nod",
      subjectRef: "REPLAY-TEST-003",
    });
    expect(result.live).toBe(true);
    // Verify insert was called to store the nonce
    expect(mockDbInstance.insert).toHaveBeenCalled();
  });
});

describe("checkAntispoofing", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox genuine response when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkAntispoofing({
      imageBase64: "data:image/jpeg;base64,/9j/test",
      subjectRef: "TEST-003",
    });
    expect(result.genuine).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.sandbox).toBe(true);
  });

  it("returns spoof type classification from engine", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 0.15, genuine: false, reason: "spoof_detected_printed_photo",
        spoof_type: "printed_photo",
        confidence_scores: { printed_photo: 0.82, screen_replay: 0.11 },
        features: { sharpness: 0.3, colour_depth: 0.2, hf_score: 0.25,
          freq_anomaly_score: 0.08, reflection_score: 0.05, depth_score: 0.1 },
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkAntispoofing({
      imageBase64: "data:image/jpeg;base64,/9j/test",
      subjectRef: "TEST-004",
    });
    expect(result.genuine).toBe(false);
    expect(result.spoof_type).toBe("printed_photo");
    expect(result.confidence_scores.printed_photo).toBeGreaterThan(0.5);
  });

  it("handles deepfake classification", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 0.22, genuine: false, spoof_type: "deepfake",
        confidence_scores: { deepfake: 0.78 },
        features: { sharpness: 0.95, colour_depth: 0.91, hf_score: 0.88,
          freq_anomaly_score: 0.05, reflection_score: 0.12, depth_score: 0.15 },
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.checkAntispoofing({ imageBase64: "data" });
    expect(result.spoof_type).toBe("deepfake");
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(
      caller.checkAntispoofing({ imageBase64: "data" })
    ).rejects.toThrow();
  });
});

describe("matchFaces", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox match when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.matchFaces({
      probeImageBase64: "probe-data",
      referenceImageBase64: "ref-data",
      subjectRef: "TEST-005",
    });
    expect(result.match).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.sandbox).toBe(true);
  });

  it("returns match result from engine", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 0.94, cosine_similarity: 0.91, match: true,
        threshold: 0.40, reason: "match", using_arcface: true,
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.matchFaces({
      probeImageBase64: "probe",
      referenceImageBase64: "ref",
    });
    expect(result.match).toBe(true);
    expect(result.cosine_similarity).toBeCloseTo(0.91, 2);
    expect(result.using_arcface).toBe(true);
  });

  it("returns no-match result from engine", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 0.12, cosine_similarity: 0.18, match: false,
        threshold: 0.40, reason: "no_match", using_arcface: true,
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.matchFaces({
      probeImageBase64: "probe",
      referenceImageBase64: "ref",
    });
    expect(result.match).toBe(false);
    expect(result.reason).toBe("no_match");
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(
      caller.matchFaces({ probeImageBase64: "p", referenceImageBase64: "r" })
    ).rejects.toThrow();
  });
});

describe("detectFace", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox detection when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectFace({ imageBase64: "data" });
    expect(result.face_detected).toBe(true);
    expect(result.face_count).toBeGreaterThan(0);
    expect(result.sandbox).toBe(true);
  });

  it("returns engine detection with bounding box", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        face_detected: true, face_count: 1, quality_score: 0.92,
        bbox: { x: 0.15, y: 0.1, w: 0.65, h: 0.75 },
        faces: [{ det_score: 0.92, bbox: { x: 0.15, y: 0.1, w: 0.65, h: 0.75 } }],
        using_insightface: true,
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectFace({ imageBase64: "data" });
    expect(result.face_detected).toBe(true);
    expect(result.bbox).toBeDefined();
    expect(result.quality_score).toBeGreaterThan(0.8);
  });

  it("handles no-face image", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ face_detected: false, face_count: 0, quality_score: 0.0 }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectFace({ imageBase64: "data" });
    expect(result.face_detected).toBe(false);
    expect(result.face_count).toBe(0);
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(caller.detectFace({ imageBase64: "data" })).rejects.toThrow();
  });
});

describe("detectLandmarks", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns 68 sandbox landmarks when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectLandmarks({ imageBase64: "data" });
    expect(result.landmarks_found).toBe(true);
    expect(result.landmark_count).toBe(68);
    expect(result.landmarks).toHaveLength(68);
    expect(result.sandbox).toBe(true);
  });

  it("returns engine 68-point landmarks", async () => {
    const landmarks = Array.from({ length: 68 }, (_, i) => ({
      x: i * 3.2, y: i * 2.1, z: 0.001 * i, x_norm: i * 0.01, y_norm: i * 0.008,
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        landmarks_found: true, landmark_count: 68,
        landmarks, landmark_variance: 0.00089,
        mediapipe_total_landmarks: 478,
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectLandmarks({ imageBase64: "data" });
    expect(result.landmarks_found).toBe(true);
    expect(result.landmark_count).toBe(68);
    expect(result.landmarks).toHaveLength(68);
    expect(result.landmark_variance).toBeCloseTo(0.00089, 5);
  });

  it("handles no-face image gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ landmarks_found: false, reason: "no_face_detected" }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.detectLandmarks({ imageBase64: "data" });
    expect(result.landmarks_found).toBe(false);
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(caller.detectLandmarks({ imageBase64: "data" })).rejects.toThrow();
  });
});

describe("extractFeatures", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox feature metadata when engine unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.extractFeatures({ imageBase64: "data" });
    expect(result.face_detected).toBe(true);
    expect(result.embedding_dimension).toBe(512);
    expect(result.sandbox).toBe(true);
  });

  it("returns ArcFace 512-d embedding metadata from engine", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        face_detected: true, embedding_dimension: 512,
        embedding_model: "insightface_arcface_buffalo_l",
        quality_score: 0.96, embedding_norm: 0.99,
        bbox: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.extractFeatures({ imageBase64: "data" });
    expect(result.face_detected).toBe(true);
    expect(result.embedding_dimension).toBe(512);
    expect(result.embedding_model).toContain("arcface");
    expect(result.quality_score).toBeGreaterThan(0.9);
  });

  it("handles no-face image", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ face_detected: false, reason: "no_face_detected" }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.extractFeatures({ imageBase64: "data" });
    expect(result.face_detected).toBe(false);
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(caller.extractFeatures({ imageBase64: "data" })).rejects.toThrow();
  });
});

describe("fullVerify", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns sandbox verified response when engine unavailable", async () => {
    // fullVerify calls biometricFetch which calls fetch; mock it to reject
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.fullVerify({
      selfieBase64: "selfie-data",
      subjectRef: "TEST-006",
    });
    expect(result.verified).toBe(true);
    expect(result.overall_score).toBeGreaterThan(0.9);
    expect(result.sandbox).toBe(true);
  });

  it("returns composite verification from engine", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verified: true, overall_score: 0.95,
        liveness: { live: true, score: 0.97 },
        antispoofing: { genuine: true, score: 0.98 },
        face_match: { match: true, score: 0.94 },
        failure_reasons: [],
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.fullVerify({
      selfieBase64: "selfie",
      referenceBase64: "ref",
      subjectRef: "TEST-007",
    });
    expect(result.verified).toBe(true);
    expect(result.liveness.live).toBe(true);
    expect(result.antispoofing.genuine).toBe(true);
    expect(result.failure_reasons).toHaveLength(0);
  });

  it("returns failure reasons when verification fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verified: false, overall_score: 0.31,
        liveness: { live: false, score: 0.22 },
        antispoofing: { genuine: false, score: 0.15, spoof_type: "printed_photo" },
        face_match: null,
        failure_reasons: ["liveness_failed", "spoof_detected"],
      }),
    });
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.fullVerify({ selfieBase64: "data" });
    expect(result.verified).toBe(false);
    expect(result.failure_reasons).toContain("liveness_failed");
    expect(result.failure_reasons).toContain("spoof_detected");
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(caller.fullVerify({ selfieBase64: "data" })).rejects.toThrow();
  });
});

describe("sessionLogs", () => {
  it("returns empty list when no logs", async () => {
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.sessionLogs({ page: 1, limit: 10 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by subjectRef", async () => {
    const { getBiometricSessionLogs } = await import("./db");
    (getBiometricSessionLogs as any).mockResolvedValueOnce([
      { id: 1, sessionId: "bio-123", subjectRef: "SUBJ-001", overallVerified: true },
    ]);
    const caller = biometricRouter.createCaller(makeCtx());
    const result = await caller.sessionLogs({ subjectRef: "SUBJ-001" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subjectRef).toBe("SUBJ-001");
  });

  it("requires authentication", async () => {
    const caller = biometricRouter.createCaller({ user: null } as any);
    await expect(caller.sessionLogs({})).rejects.toThrow();
  });
});

describe("Anti-spoofing attack type coverage", () => {
  const SPOOF_TYPES = [
    "printed_photo",
    "screen_replay",
    "paper_mask",
    "three_d_mask",
    "deepfake",
    "high_quality_photo",
  ] as const;

  beforeEach(() => mockFetch.mockReset());

  for (const spoofType of SPOOF_TYPES) {
    it(`correctly handles ${spoofType} attack classification`, async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          score: 0.1, genuine: false,
          spoof_type: spoofType,
          confidence_scores: { [spoofType]: 0.85 },
          reason: `spoof_detected_${spoofType}`,
          features: { sharpness: 0.3, colour_depth: 0.3, hf_score: 0.3,
            freq_anomaly_score: 0.2, reflection_score: 0.1, depth_score: 0.2 },
        }),
      });
      const caller = biometricRouter.createCaller(makeCtx());
      const result = await caller.checkAntispoofing({ imageBase64: "data" });
      expect(result.genuine).toBe(false);
      expect(result.spoof_type).toBe(spoofType);
      expect(result.confidence_scores[spoofType]).toBeGreaterThan(0.5);
    });
  }
});

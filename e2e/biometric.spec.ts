/**
 * BIS Platform — Biometric Engine Smoke Tests
 *
 * Tests the full biometric stack end-to-end:
 *   - Passive liveness (single image)
 *   - Active liveness (multi-frame video)
 *   - Anti-spoofing with spoof-type classification
 *   - Face matching (1:1 two-image comparison)
 *   - Face detection
 *   - Full composite verification
 *   - Session log persistence and query
 *
 * These tests run against the live tRPC API and require an authenticated session.
 * They use the sandbox fallback responses when the biometric engine is not running.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// Minimal 1×1 white JPEG in base64 (valid image for engine input)
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
  "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA" +
  "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA" +
  "/9oADAMBAAIRAxEAPwCwABmX/9k=";

// Minimal 3-frame "video" — just 3 copies of the same JPEG for smoke testing
const FRAMES_B64 = [TINY_JPEG_B64, TINY_JPEG_B64, TINY_JPEG_B64];

// ─── Helper: call a tRPC procedure via the HTTP batch endpoint ─────────────────

async function trpcCall(
  procedure: string,
  input: unknown,
  cookie: string
): Promise<{ result?: { data?: unknown }; error?: unknown }> {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }
  const body = await res.json();
  // tRPC batch response is an array
  const item = Array.isArray(body) ? body[0] : body;
  return item;
}

// ─── Shared auth cookie ────────────────────────────────────────────────────────

let authCookie = "";

test.beforeAll(async ({ browser }) => {
  // Reuse the session cookie set up by setup-auth.ts (if available)
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/user.json",
  });
  const cookies = await ctx.cookies();
  authCookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await ctx.close();
});

// ─── 1. Passive Liveness ──────────────────────────────────────────────────────

test("biometric: passive liveness returns a valid response", async () => {
  const result = await trpcCall(
    "biometric.checkLiveness",
    { imageBase64: TINY_JPEG_B64, subjectRef: "e2e-smoke-passive" },
    authCookie
  );

  // Either a real engine result or the sandbox fallback — both are valid
  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.live).toBe("boolean");
  expect(typeof data.score).toBe("number");
  expect(data.score).toBeGreaterThanOrEqual(0);
  expect(data.score).toBeLessThanOrEqual(1);
});

// ─── 2. Active Liveness ───────────────────────────────────────────────────────

test("biometric: active liveness returns a valid response", async () => {
  const result = await trpcCall(
    "biometric.checkActiveLiveness",
    {
      framesBase64: FRAMES_B64,
      challenge: "blink",
      subjectRef: "e2e-smoke-active",
    },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.live).toBe("boolean");
  expect(typeof data.score).toBe("number");
  expect(data.score).toBeGreaterThanOrEqual(0);
  expect(data.score).toBeLessThanOrEqual(1);
  expect(typeof data.challenge_completed).toBe("boolean");
  expect(typeof data.frames_analysed).toBe("number");
});

// ─── 3. Anti-Spoofing ─────────────────────────────────────────────────────────

test("biometric: antispoofing returns spoof_type classification", async () => {
  const result = await trpcCall(
    "biometric.checkAntispoofing",
    { imageBase64: TINY_JPEG_B64, subjectRef: "e2e-smoke-spoof" },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.genuine).toBe("boolean");
  expect(typeof data.score).toBe("number");
  expect(data.score).toBeGreaterThanOrEqual(0);
  expect(data.score).toBeLessThanOrEqual(1);
  // spoof_type must be one of the 7 valid values
  const VALID_SPOOF_TYPES = [
    "genuine",
    "printed_photo",
    "screen_replay",
    "paper_mask",
    "3d_mask",
    "deepfake",
    "high_quality_photo",
  ];
  expect(VALID_SPOOF_TYPES).toContain(data.spoof_type);
});

// ─── 4. Face Matching (1:1) ───────────────────────────────────────────────────

test("biometric: face match returns similarity score and decision", async () => {
  const result = await trpcCall(
    "biometric.matchFaces",
    {
      probeImageBase64: TINY_JPEG_B64,
      referenceImageBase64: TINY_JPEG_B64,
      subjectRef: "e2e-smoke-match",
    },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.match).toBe("boolean");
  expect(typeof data.similarity).toBe("number");
  expect(data.similarity).toBeGreaterThanOrEqual(0);
  expect(data.similarity).toBeLessThanOrEqual(1);
  expect(typeof data.threshold).toBe("number");
});

// ─── 5. Face Detection ────────────────────────────────────────────────────────

test("biometric: face detection returns bbox and quality score", async () => {
  const result = await trpcCall(
    "biometric.detectFace",
    { imageBase64: TINY_JPEG_B64 },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.face_detected).toBe("boolean");
  expect(typeof data.face_count).toBe("number");
  expect(typeof data.quality_score).toBe("number");
  // bbox is present when a face is detected
  if (data.face_detected) {
    expect(data.bbox).toBeDefined();
    expect(typeof data.bbox.x).toBe("number");
    expect(typeof data.bbox.y).toBe("number");
    expect(typeof data.bbox.w).toBe("number");
    expect(typeof data.bbox.h).toBe("number");
  }
});

// ─── 6. Full Composite Verification ──────────────────────────────────────────

test("biometric: full verify returns composite result with all sub-checks", async () => {
  const result = await trpcCall(
    "biometric.fullVerify",
    {
      imageBase64: TINY_JPEG_B64,
      referenceImageBase64: TINY_JPEG_B64,
      subjectRef: "e2e-smoke-fullverify",
    },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(typeof data.verified).toBe("boolean");
  expect(typeof data.score).toBe("number");
  // Sub-check fields must be present
  expect(data.liveness).toBeDefined();
  expect(data.antispoofing).toBeDefined();
  expect(data.face_match).toBeDefined();
  expect(typeof data.liveness.live).toBe("boolean");
  expect(typeof data.antispoofing.genuine).toBe("boolean");
  expect(typeof data.face_match.match).toBe("boolean");
});

// ─── 7. Session Log Persistence ───────────────────────────────────────────────

test("biometric: session logs are queryable after a liveness check", async () => {
  // First, create a liveness record
  await trpcCall(
    "biometric.checkLiveness",
    { imageBase64: TINY_JPEG_B64, subjectRef: "e2e-smoke-log-query" },
    authCookie
  );

  // Then query session logs for this subject
  const result = await trpcCall(
    "biometric.sessionLogs",
    { subjectRef: "e2e-smoke-log-query", page: 1, pageSize: 10 },
    authCookie
  );

  const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
  expect(data).toBeDefined();
  expect(Array.isArray(data.logs)).toBe(true);
  expect(typeof data.total).toBe("number");
  // At least one log should exist for this subject
  expect(data.logs.length).toBeGreaterThanOrEqual(1);
  const log = data.logs[0];
  expect(log.sessionId).toBeDefined();
  expect(log.subjectRef).toBe("e2e-smoke-log-query");
});

// ─── 8. Confidence Score Range Validation ────────────────────────────────────

test("biometric: all confidence scores are in [0, 1] range", async () => {
  const checks = await Promise.all([
    trpcCall("biometric.checkLiveness", { imageBase64: TINY_JPEG_B64, subjectRef: "e2e-range-check" }, authCookie),
    trpcCall("biometric.checkAntispoofing", { imageBase64: TINY_JPEG_B64, subjectRef: "e2e-range-check" }, authCookie),
    trpcCall("biometric.matchFaces", { probeImageBase64: TINY_JPEG_B64, referenceImageBase64: TINY_JPEG_B64, subjectRef: "e2e-range-check" }, authCookie),
  ]);

  for (const result of checks) {
    const data = (result as any)?.result?.data?.json ?? (result as any)?.result?.data;
    if (data && typeof data.score === "number") {
      expect(data.score).toBeGreaterThanOrEqual(0);
      expect(data.score).toBeLessThanOrEqual(1);
    }
  }
});

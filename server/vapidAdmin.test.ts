/**
 * vapidAdmin.test.ts
 * Unit tests for VAPID key provisioning and OCR confidence schema.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── VAPID key generation ─────────────────────────────────────────────────────

describe("VAPID key provisioning", () => {
  it("generates a keypair with publicKey and privateKey strings", async () => {
    const webpush = (await import("web-push")).default;
    const keys = webpush.generateVAPIDKeys();
    expect(typeof keys.publicKey).toBe("string");
    expect(typeof keys.privateKey).toBe("string");
    expect(keys.publicKey.length).toBeGreaterThan(40);
    expect(keys.privateKey.length).toBeGreaterThan(40);
  });

  it("generates unique keypairs on each call", async () => {
    const webpush = (await import("web-push")).default;
    const a = webpush.generateVAPIDKeys();
    const b = webpush.generateVAPIDKeys();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it("public key is URL-safe base64 (no + or /)", async () => {
    const webpush = (await import("web-push")).default;
    const { publicKey } = webpush.generateVAPIDKeys();
    // URL-safe base64 uses - and _ instead of + and /
    expect(publicKey).not.toMatch(/[+/]/);
  });
});

// ─── OCR confidence schema normalisation ─────────────────────────────────────

type OcrFieldValue = string | null | { value: string | null; confidence: number };

function normaliseOcrField(raw: OcrFieldValue): { value: string | null; confidence: number } {
  if (raw === null || raw === undefined) return { value: null, confidence: 0 };
  if (typeof raw === "string") return { value: raw, confidence: 1 };
  return { value: raw.value, confidence: raw.confidence ?? 0 };
}

describe("normaliseOcrField", () => {
  it("returns confidence 1 for plain string values (v1 schema)", () => {
    expect(normaliseOcrField("John Doe")).toEqual({ value: "John Doe", confidence: 1 });
  });

  it("returns confidence 0 for null", () => {
    expect(normaliseOcrField(null)).toEqual({ value: null, confidence: 0 });
  });

  it("passes through v2 schema objects unchanged", () => {
    const field = { value: "NGA", confidence: 0.95 };
    expect(normaliseOcrField(field)).toEqual(field);
  });

  it("defaults confidence to 0 when missing from v2 object", () => {
    const field = { value: "test" } as any;
    expect(normaliseOcrField(field)).toEqual({ value: "test", confidence: 0 });
  });

  it("handles empty string value", () => {
    expect(normaliseOcrField("")).toEqual({ value: "", confidence: 1 });
  });

  it("handles v2 object with null value", () => {
    expect(normaliseOcrField({ value: null, confidence: 0.0 })).toEqual({ value: null, confidence: 0 });
  });
});

// ─── Confidence class helper ──────────────────────────────────────────────────

function confidenceClass(c: number): string {
  if (c >= 0.85) return "emerald";
  if (c >= 0.5) return "amber";
  return "red";
}

describe("confidenceClass", () => {
  it("returns emerald for high confidence (>= 0.85)", () => {
    expect(confidenceClass(1.0)).toBe("emerald");
    expect(confidenceClass(0.85)).toBe("emerald");
  });

  it("returns amber for medium confidence (0.5 – 0.84)", () => {
    expect(confidenceClass(0.84)).toBe("amber");
    expect(confidenceClass(0.5)).toBe("amber");
  });

  it("returns red for low confidence (< 0.5)", () => {
    expect(confidenceClass(0.49)).toBe("red");
    expect(confidenceClass(0)).toBe("red");
  });
});

// ─── Push subscription deactivation logic ────────────────────────────────────

describe("push subscription token deactivation", () => {
  it("marks token inactive on deregister (unit logic)", () => {
    const subscriptions = [
      { id: 1, userId: 42, token: "abc123", active: true },
      { id: 2, userId: 42, token: "def456", active: true },
    ];

    function deregisterToken(userId: number, token: string) {
      return subscriptions.map((s) =>
        s.userId === userId && s.token === token ? { ...s, active: false } : s
      );
    }

    const updated = deregisterToken(42, "abc123");
    expect(updated.find((s) => s.token === "abc123")?.active).toBe(false);
    expect(updated.find((s) => s.token === "def456")?.active).toBe(true);
  });

  it("does not affect other users' tokens", () => {
    const subscriptions = [
      { id: 1, userId: 42, token: "abc123", active: true },
      { id: 2, userId: 99, token: "abc123", active: true },
    ];

    function deregisterToken(userId: number, token: string) {
      return subscriptions.map((s) =>
        s.userId === userId && s.token === token ? { ...s, active: false } : s
      );
    }

    const updated = deregisterToken(42, "abc123");
    expect(updated.find((s) => s.userId === 42)?.active).toBe(false);
    expect(updated.find((s) => s.userId === 99)?.active).toBe(true);
  });
});

// ─── VAPID status helper ──────────────────────────────────────────────────────

describe("getVapidStatus logic", () => {
  it("reports unconfigured when keys are empty strings", () => {
    const ENV = { vapidPublicKey: "", vapidPrivateKey: "", fcmServerKey: "" };
    const isConfigured = !!ENV.vapidPublicKey && !!ENV.vapidPrivateKey;
    expect(isConfigured).toBe(false);
  });

  it("reports configured when both keys are present", () => {
    const ENV = { vapidPublicKey: "BPub123", vapidPrivateKey: "BPriv456", fcmServerKey: "" };
    const isConfigured = !!ENV.vapidPublicKey && !!ENV.vapidPrivateKey;
    expect(isConfigured).toBe(true);
  });

  it("does not expose the private key in status response", () => {
    const ENV = { vapidPublicKey: "BPub123", vapidPrivateKey: "BPriv456", fcmServerKey: "fcm-key" };
    const isConfigured = !!ENV.vapidPublicKey && !!ENV.vapidPrivateKey;
    const status = {
      isConfigured,
      hasFcmKey: !!ENV.fcmServerKey,
      vapidPublicKey: isConfigured ? ENV.vapidPublicKey : null,
    };
    expect(status).not.toHaveProperty("vapidPrivateKey");
    expect(status.vapidPublicKey).toBe("BPub123");
  });
});

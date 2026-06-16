/**
 * pushNotify.test.ts — Unit tests for push notification delivery helpers
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock web-push ─────────────────────────────────────────────────────────────
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    fcmServerKey: "test-fcm-key",
    fcmProjectId: "test-project",
    vapidPublicKey: "BPublicKey",
    vapidPrivateKey: "privateKey",
    vapidSubject: "mailto:test@example.com",
  },
}));

// ── Mock database ─────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  selectDistinct: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../drizzle/schema", () => ({
  pushSubscriptions: { id: "id", userId: "userId", active: "active", platform: "platform", token: "token", p256dh: "p256dh", auth: "auth", updatedAt: "updatedAt" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((col, val) => ({ eq: [col, val] })),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no active subscriptions
    mockDb.where.mockResolvedValue([]);
  });

  it("returns zero counts when user has no active subscriptions", async () => {
    const { sendPushToUser } = await import("./pushNotify");
    const result = await sendPushToUser(42, { title: "Test", body: "Hello" });
    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 0 });
  });

  it("returns zero counts when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const { sendPushToUser } = await import("./pushNotify");
    const result = await sendPushToUser(1, { title: "T", body: "B" });
    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 0 });
  });

  it("attempts FCM delivery for fcm platform subscriptions", async () => {
    // Mock a single FCM subscription
    mockDb.where.mockResolvedValueOnce([{
      id: 1,
      userId: 42,
      platform: "fcm",
      token: "fcm-token-abc",
      p256dh: null,
      auth: null,
      active: true,
    }]);

    // Mock fetch for FCM API
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: 1, failure: 0, results: [{}] }),
    } as any);

    const { sendPushToUser } = await import("./pushNotify");
    const result = await sendPushToUser(42, { title: "Alert", body: "Critical risk detected" });
    expect(result.sent + result.failed).toBe(1);
  });

  it("deactivates token on FCM NotRegistered error", async () => {
    mockDb.where.mockResolvedValueOnce([{
      id: 5,
      userId: 10,
      platform: "fcm",
      token: "expired-token",
      p256dh: null,
      auth: null,
      active: true,
    }]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: 0, failure: 1, results: [{ error: "NotRegistered" }] }),
    } as any);

    const { sendPushToUser } = await import("./pushNotify");
    const result = await sendPushToUser(10, { title: "T", body: "B" });
    expect(result.deactivated).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe("broadcastPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.where.mockResolvedValue([]);
  });

  it("aggregates results across multiple users", async () => {
    const { broadcastPush } = await import("./pushNotify");
    const result = await broadcastPush([1, 2, 3], { title: "Broadcast", body: "System update" });
    // All users have no subscriptions → all zeros
    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 0 });
  });

  it("handles empty user list gracefully", async () => {
    const { broadcastPush } = await import("./pushNotify");
    const result = await broadcastPush([], { title: "T", body: "B" });
    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 0 });
  });
});

describe("PushPayload validation", () => {
  it("accepts minimal payload with title and body", async () => {
    mockDb.where.mockResolvedValue([]);
    const { sendPushToUser } = await import("./pushNotify");
    await expect(sendPushToUser(1, { title: "T", body: "B" })).resolves.toBeDefined();
  });

  it("accepts full payload with all optional fields", async () => {
    mockDb.where.mockResolvedValue([]);
    const { sendPushToUser } = await import("./pushNotify");
    await expect(
      sendPushToUser(1, {
        title: "Full Alert",
        body: "Details here",
        url: "/alerts/42",
        icon: "/favicon.ico",
        badge: 3,
        tag: "alert-42",
      })
    ).resolves.toBeDefined();
  });
});

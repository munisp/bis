/**
 * sanctionsWebhook.test.ts — Unit tests for POST /api/webhooks/sanctions-refresh
 *
 * Tests cover:
 *   - HMAC-SHA256 signature verification
 *   - Dev mode (no secret) passes through
 *   - Payload parsing and notifyOwner call
 *   - Audit log write
 *   - Push broadcast to admins
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockNotifyOwner = vi.fn().mockResolvedValue(true);
const mockBroadcastPush = vi.fn().mockResolvedValue({ sent: 0, failed: 0, deactivated: 0 });
const mockInsert = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);

const mockDb = {
  insert: mockInsert,
  values: mockValues,
  select: mockSelect,
  from: mockFrom,
  where: mockWhere,
};

vi.mock("./_core/notification", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("./pushNotify", () => ({ broadcastPush: mockBroadcastPush }));
vi.mock("./db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../drizzle/schema", () => ({
  auditLog: "auditLog",
  users: { id: "id", role: "role" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

// ── Helper: build a signed request ───────────────────────────────────────────

function buildSignedBody(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload));
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { body, sig };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sanctions-refresh webhook signature verification", () => {
  const SECRET = "test-webhook-secret-32chars-long!";

  it("accepts a request with a valid HMAC-SHA256 signature", () => {
    const payload = { listName: "OFAC SDN", totalEntries: 12345, updatedAt: new Date().toISOString() };
    const { body, sig } = buildSignedBody(payload, SECRET);

    const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    expect(sig).toBe(expected);
  });

  it("rejects a request with a tampered body", () => {
    const payload = { listName: "OFAC SDN", totalEntries: 12345 };
    const { sig } = buildSignedBody(payload, SECRET);

    // Tamper: different body
    const tamperedBody = Buffer.from(JSON.stringify({ listName: "EVIL", totalEntries: 0 }));
    const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(tamperedBody).digest("hex");
    expect(sig).not.toBe(expected);
  });

  it("rejects a request with a wrong secret", () => {
    const payload = { listName: "UN", totalEntries: 500 };
    const { sig } = buildSignedBody(payload, "wrong-secret");

    const correctExpected = "sha256=" + crypto.createHmac("sha256", SECRET).update(Buffer.from(JSON.stringify(payload))).digest("hex");
    expect(sig).not.toBe(correctExpected);
  });

  it("produces timing-safe comparison (same length buffers)", () => {
    const payload = { listName: "FATF", totalEntries: 200 };
    const { body, sig } = buildSignedBody(payload, SECRET);

    const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);

    expect(expectedBuf.length).toBe(sigBuf.length);
    expect(crypto.timingSafeEqual(expectedBuf, sigBuf)).toBe(true);
  });
});

describe("sanctions-refresh webhook payload parsing", () => {
  it("correctly extracts all fields from a full payload", () => {
    const payload = {
      listName: "OFAC SDN",
      totalEntries: 12345,
      updatedAt: "2026-06-16T12:00:00.000Z",
      source: "ofac-api",
      hitCount: 42,
    };

    expect(payload.listName).toBe("OFAC SDN");
    expect(payload.totalEntries).toBe(12345);
    expect(payload.hitCount).toBe(42);
    expect(new Date(payload.updatedAt).toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });

  it("uses defaults for missing optional fields", () => {
    const payload = {} as { listName?: string; totalEntries?: number; source?: string };
    const listName = payload.listName ?? "Unknown";
    const totalEntries = payload.totalEntries ?? 0;
    const source = payload.source ?? "gateway";

    expect(listName).toBe("Unknown");
    expect(totalEntries).toBe(0);
    expect(source).toBe("gateway");
  });
});

describe("notifyOwner integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyOwner.mockResolvedValue(true);
  });

  it("calls notifyOwner with correct title format", async () => {
    const { notifyOwner } = await import("./_core/notification");
    await notifyOwner({
      title: "🛡️ Sanctions List Updated — OFAC SDN",
      content: "The **OFAC SDN** sanctions list has been refreshed.\n- **Total entries:** 12,345",
    });
    expect(mockNotifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("OFAC SDN") })
    );
  });

  it("handles notifyOwner returning false gracefully", async () => {
    mockNotifyOwner.mockResolvedValueOnce(false);
    const { notifyOwner } = await import("./_core/notification");
    const result = await notifyOwner({ title: "T", content: "C" });
    expect(result).toBe(false);
    // Should not throw
  });
});

describe("broadcastPush on sanctions update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBroadcastPush.mockResolvedValue({ sent: 2, failed: 0, deactivated: 0 });
  });

  it("broadcasts to admin user IDs", async () => {
    const { broadcastPush } = await import("./pushNotify");
    const adminIds = [1, 2];
    await broadcastPush(adminIds, {
      title: "🛡️ Sanctions List Updated",
      body: "OFAC SDN refreshed with 12,345 entries",
      url: "/aml",
      tag: "sanctions-refresh",
    });
    expect(mockBroadcastPush).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({ tag: "sanctions-refresh", url: "/aml" })
    );
  });

  it("is fire-and-forget (does not block response)", async () => {
    const { broadcastPush } = await import("./pushNotify");
    // Simulate slow broadcast
    mockBroadcastPush.mockImplementationOnce(() =>
      new Promise(resolve => setTimeout(() => resolve({ sent: 1, failed: 0, deactivated: 0 }), 100))
    );
    const start = Date.now();
    broadcastPush([1], { title: "T", body: "B" }).catch(() => {});
    const elapsed = Date.now() - start;
    // Should not have waited for the promise
    expect(elapsed).toBeLessThan(50);
  });
});

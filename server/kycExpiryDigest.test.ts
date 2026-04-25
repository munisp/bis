/**
 * KYC Expiry Digest — Vitest
 *
 * Tests runKycExpiryDigest() with a mocked database that returns
 * controlled stale KYC records, and verifies:
 *   1. Correct staleHighRisk / staleLowRisk counts
 *   2. alertsCreated = 1 when stale records exist
 *   3. notified = true when notifyOwner succeeds
 *   4. No-op (all zeros) when DB is unavailable
 *   5. No-op when no stale records exist
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { KycExpiryDigestResult } from "./kycExpiryDigest";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: () => ({ values: mockInsert }),
};

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKycRecord(overrides: Partial<{
  id: string; subjectName: string; subjectRef: string;
  riskScore: number; status: string; updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "kyc-001",
    subjectName: overrides.subjectName ?? "ADEBAYO OLUWASEUN",
    subjectRef: overrides.subjectRef ?? "REF-001",
    riskScore: overrides.riskScore ?? 80,
    status: overrides.status ?? "verified",
    updatedAt: overrides.updatedAt ?? new Date(Date.now() - 400 * 24 * 3_600_000), // 400 days ago
  };
}

function makeHighRiskStale() {
  // Updated 400 days ago, riskScore=80 → stale for high-risk (>365 days)
  return makeKycRecord({ riskScore: 80, updatedAt: new Date(Date.now() - 400 * 24 * 3_600_000) });
}

function makeLowRiskStale() {
  // Updated 1200 days ago, riskScore=30 → stale for low-risk (>1095 days)
  return makeKycRecord({ id: "kyc-002", subjectName: "IBRAHIM FATIMA", riskScore: 30, updatedAt: new Date(Date.now() - 1200 * 24 * 3_600_000) });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runKycExpiryDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all-zeros when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result: KycExpiryDigestResult = await runKycExpiryDigest();

    expect(result).toEqual({
      checked: 0,
      staleHighRisk: 0,
      staleLowRisk: 0,
      alertsCreated: 0,
      notified: false,
    });
  });

  it("returns all-zeros when no stale records exist", async () => {
    const { getDb } = await import("./db");

    // Mock: both queries return empty arrays, and no recent alert exists
    let callCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
          limit: () => Promise.resolve([]),
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.checked).toBe(0);
    expect(result.staleHighRisk).toBe(0);
    expect(result.staleLowRisk).toBe(0);
    expect(result.alertsCreated).toBe(0);
    expect(result.notified).toBe(false);
  });

  it("counts staleHighRisk and staleLowRisk correctly", async () => {
    const { getDb } = await import("./db");
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockResolvedValue(true);

    const highRiskRecord = makeHighRiskStale();
    const lowRiskRecord = makeLowRiskStale();

    let queryCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: (condition: any) => ({
          orderBy: () => ({
            limit: () => {
              queryCallCount++;
              if (queryCallCount === 1) return Promise.resolve([highRiskRecord]); // high-risk stale
              if (queryCallCount === 2) return Promise.resolve([lowRiskRecord]);  // low-risk stale
              return Promise.resolve([]);
            },
          }),
          limit: () => {
            queryCallCount++;
            return Promise.resolve([]); // no recent alert
          },
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.staleHighRisk).toBe(1);
    expect(result.staleLowRisk).toBe(1);
    expect(result.checked).toBe(2);
  });

  it("creates exactly 1 alert when stale records exist and no alert today", async () => {
    const { getDb } = await import("./db");
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockResolvedValue(true);

    const highRiskRecord = makeHighRiskStale();

    let queryCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => {
              queryCallCount++;
              if (queryCallCount === 1) return Promise.resolve([highRiskRecord]);
              return Promise.resolve([]);
            },
          }),
          limit: () => {
            queryCallCount++;
            return Promise.resolve([]); // no recent alert today
          },
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.alertsCreated).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate alert if one already exists today", async () => {
    const { getDb } = await import("./db");
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockResolvedValue(true);

    const highRiskRecord = makeHighRiskStale();

    let queryCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => {
              queryCallCount++;
              if (queryCallCount === 1) return Promise.resolve([highRiskRecord]);
              return Promise.resolve([]);
            },
          }),
          limit: () => {
            queryCallCount++;
            return Promise.resolve([{ id: "existing-alert-today" }]); // alert already exists
          },
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.alertsCreated).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("sets notified=true when notifyOwner returns true", async () => {
    const { getDb } = await import("./db");
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockResolvedValue(true);

    const highRiskRecord = makeHighRiskStale();

    let queryCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => {
              queryCallCount++;
              if (queryCallCount === 1) return Promise.resolve([highRiskRecord]);
              return Promise.resolve([]);
            },
          }),
          limit: () => {
            queryCallCount++;
            return Promise.resolve([]);
          },
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.notified).toBe(true);
    expect(notifyOwner).toHaveBeenCalledOnce();
  });

  it("sets notified=false when notifyOwner returns false", async () => {
    const { getDb } = await import("./db");
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockResolvedValue(false);

    const highRiskRecord = makeHighRiskStale();

    let queryCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => {
              queryCallCount++;
              if (queryCallCount === 1) return Promise.resolve([highRiskRecord]);
              return Promise.resolve([]);
            },
          }),
          limit: () => {
            queryCallCount++;
            return Promise.resolve([]);
          },
        }),
      }),
    }));
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { runKycExpiryDigest } = await import("./kycExpiryDigest");
    const result = await runKycExpiryDigest();

    expect(result.notified).toBe(false);
  });
});

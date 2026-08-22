import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, creditTenantAccountMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  creditTenantAccountMock: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: getDbMock }));
vi.mock("./billing", () => ({ creditTenantAccount: creditTenantAccountMock }));

import { enqueueFailedWebhook, processRetryQueue } from "./webhookRetry";

describe("webhook retry flow-of-funds guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when a failed payment cannot be durably enqueued", async () => {
    getDbMock.mockResolvedValue(null);

    await expect(enqueueFailedWebhook({
      reference: "PAY-UNPERSISTED",
      tenantId: "tenant-a",
      amountKobo: 10_000,
      error: "TigerBeetle unavailable",
    })).rejects.toThrow("Cannot durably enqueue");
  });

  it("uses exactly one parameterized persistence operation to enqueue a failed payment", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    getDbMock.mockResolvedValue({ execute });

    await enqueueFailedWebhook({
      reference: "PAY-QUEUED",
      tenantId: "tenant-a",
      amountKobo: 10_000,
      error: "TigerBeetle unavailable",
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not issue a ledger credit when another worker already owns the retry lease", async () => {
    const dueItem = {
      id: 42,
      reference: "PAY-CONCURRENT",
      tenantId: "tenant-a",
      amountKobo: 10_000,
      attempts: 0,
    };
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [dueItem] })
      .mockResolvedValueOnce({ rows: [] });
    getDbMock.mockResolvedValue({ execute });

    const result = await processRetryQueue();

    expect(result).toEqual({ processed: 0, succeeded: 0, deadLettered: 0 });
    expect(creditTenantAccountMock).not.toHaveBeenCalled();
  });
});

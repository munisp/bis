/**
 * server/paymentTransferWorkflow.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for the PaymentTransferWorkflow Temporal saga.
 *
 * These tests exercise the four payment activities directly (without a live
 * Temporal cluster) to verify:
 *   1. Happy path: submitToRail → pollRailStatus → markTransferPosted
 *   2. Compensation path: submitToRail throws → compensateTransfer fires
 *   3. Timeout escalation: pollRailStatus never finalises → escalateToReview fires
 *   4. Idempotency: duplicate workflow start returns existing workflowId
 *   5. cancelPaymentTransferWorkflow signals the gateway correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  submitToRail,
  pollRailStatus,
  escalateToReview,
  compensateTransfer,
} from "./temporalWorker";
import {
  startPaymentTransferWorkflow,
  cancelPaymentTransferWorkflow,
  getPaymentWorkflowStatus,
} from "./temporal";

// ── Mock fetch globally ───────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE_INPUT = {
  txRef: "TXN-SAGA-001",
  transactionId: 42,
  originatorAccountId: "ACC-001",
  beneficiaryAccountId: "ACC-002",
  beneficiaryName: "Test Beneficiary",
  amountKobo: 500_000,
  currency: "NGN",
  rail: "nip" as const,
  narration: "Test payment",
};

const ACTIVITY_INPUT = {
  ...BASE_INPUT,
  gatewayUrl: "http://gateway:8080",
  gatewayKey: "test-key",
  externalRef: "EXT-REF-001",
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Activity: submitToRail ────────────────────────────────────────────────────

describe("submitToRail activity", () => {
  it("happy path: returns externalRef and status on 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ external_ref: "EXT-001", status: "submitted" }),
    });

    const result = await submitToRail(ACTIVITY_INPUT);

    expect(result.externalRef).toBe("EXT-001");
    expect(result.status).toBe("submitted");
    expect(mockFetch).toHaveBeenCalledOnce();
    // Verify idempotency key header is sent
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers as Record<string, string>)
      .toMatchObject({ "X-Idempotency-Key": "TXN-SAGA-001" });
  });

  it("compensation path: throws on non-2xx so workflow can trigger compensateTransfer", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "Insufficient funds",
    });

    await expect(submitToRail(ACTIVITY_INPUT)).rejects.toThrow(
      /Rail submission failed for TXN-SAGA-001/
    );
  });

  it("routes to mojaloop endpoint when rail=mojaloop", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ external_ref: "MJL-001", status: "submitted" }),
    });

    await submitToRail({ ...ACTIVITY_INPUT, rail: "mojaloop" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/mojaloop/transfer");
  });

  it("routes to NIP endpoint when rail=nip", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ external_ref: "NIP-001", status: "submitted" }),
    });

    await submitToRail({ ...ACTIVITY_INPUT, rail: "nip" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/nip/transfer");
  });
});

// ── Activity: pollRailStatus ──────────────────────────────────────────────────

describe("pollRailStatus activity", () => {
  it("returns finalised=true when status is completed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "completed" }),
    });

    const result = await pollRailStatus(ACTIVITY_INPUT);

    expect(result.status).toBe("completed");
    expect(result.finalised).toBe(true);
  });

  it("returns finalised=true when status is failed (triggers compensation)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "failed" }),
    });

    const result = await pollRailStatus(ACTIVITY_INPUT);

    expect(result.status).toBe("failed");
    expect(result.finalised).toBe(true);
  });

  it("returns finalised=false when status is pending (workflow continues polling)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "pending" }),
    });

    const result = await pollRailStatus(ACTIVITY_INPUT);

    expect(result.finalised).toBe(false);
  });

  it("returns unknown/not-finalised on non-2xx (non-fatal — keeps polling)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await pollRailStatus(ACTIVITY_INPUT);

    expect(result.status).toBe("unknown");
    expect(result.finalised).toBe(false);
  });
});

// ── Activity: escalateToReview ────────────────────────────────────────────────

describe("escalateToReview activity", () => {
  it("posts to /v1/payment/escalate with txRef and reason", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await escalateToReview({
      ...ACTIVITY_INPUT,
      reason: "Timeout after 5 minutes",
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/payment/escalate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tx_ref).toBe("TXN-SAGA-001");
    expect(body.reason).toBe("Timeout after 5 minutes");
  });

  it("does NOT throw on non-2xx (escalation failure is non-fatal)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    // Should resolve without throwing
    await expect(
      escalateToReview({ ...ACTIVITY_INPUT, reason: "Timeout" })
    ).resolves.toBeUndefined();
  });
});

// ── Activity: compensateTransfer ──────────────────────────────────────────────

describe("compensateTransfer activity", () => {
  it("posts to /v1/payment/compensate with txRef and reason", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await compensateTransfer({
      ...ACTIVITY_INPUT,
      reason: "Rail returned hard failure",
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/payment/compensate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tx_ref).toBe("TXN-SAGA-001");
    expect(body.reason).toBe("Rail returned hard failure");
  });

  it("THROWS on non-2xx (compensation failure is fatal — must not swallow)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "DB error",
    });

    await expect(
      compensateTransfer({ ...ACTIVITY_INPUT, reason: "Hard failure" })
    ).rejects.toThrow(/Compensation failed for TXN-SAGA-001/);
  });
});

// ── Saga orchestration: dev-mode startPaymentTransferWorkflow ─────────────────

describe("startPaymentTransferWorkflow", () => {
  it("returns a deterministic workflowId when Temporal gateway responds 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workflow_id: "payment-TXN-SAGA-001", run_id: "run-abc" }),
    });

    const result = await startPaymentTransferWorkflow(BASE_INPUT);

    expect(result.workflowId).toBe("payment-TXN-SAGA-001");
    expect(result.mode).toBe("temporal");
  });

  it("workflowId is idempotent — same txRef always produces same workflow_id", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow_id: "payment-TXN-SAGA-001", run_id: "run-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow_id: "payment-TXN-SAGA-001", run_id: "run-2" }),
      });

    const r1 = await startPaymentTransferWorkflow(BASE_INPUT);
    const r2 = await startPaymentTransferWorkflow(BASE_INPUT);

    expect(r1.workflowId).toBe(r2.workflowId);
  });

  it("throws when Temporal gateway returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(startPaymentTransferWorkflow(BASE_INPUT)).rejects.toThrow(
      /PaymentTransferWorkflow start failed/
    );
  });
});

// ── cancelPaymentTransferWorkflow ─────────────────────────────────────────────

describe("cancelPaymentTransferWorkflow", () => {
  it("resolves without error when gateway returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await expect(cancelPaymentTransferWorkflow("TXN-SAGA-001")).resolves.toBeUndefined();
  });

  it("resolves without error (non-fatal) when gateway returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "workflow not found",
    });
    // Non-fatal: should not throw
    await expect(cancelPaymentTransferWorkflow("TXN-SAGA-001")).resolves.toBeUndefined();
  });
});

// ── getPaymentWorkflowStatus ──────────────────────────────────────────────────

describe("getPaymentWorkflowStatus", () => {
  it("returns status from gateway on 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "RUNNING", result: null }),
    });

    const result = await getPaymentWorkflowStatus("TXN-SAGA-001");

    expect(result.status).toBe("RUNNING");
  });

  it("returns unknown status on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await getPaymentWorkflowStatus("TXN-SAGA-001");

    expect(result.status).toBe("unknown");
  });
});

// ── Compensation path integration ────────────────────────────────────────────
// Simulates the full saga compensation flow:
// submitToRail throws → compensateTransfer is called → DB is updated

describe("Compensation path integration", () => {
  it("compensation fires when submitToRail throws a hard failure", async () => {
    // Step 1: submitToRail fails with a hard error
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => "Account frozen",
      })
      // Step 2: compensateTransfer succeeds
      .mockResolvedValueOnce({ ok: true });

    // Simulate the saga: try submitToRail, catch, call compensateTransfer
    let compensationCalled = false;
    try {
      await submitToRail(ACTIVITY_INPUT);
    } catch {
      compensationCalled = true;
      await compensateTransfer({
        ...ACTIVITY_INPUT,
        reason: "Rail returned hard failure: 422 Account frozen",
      });
    }

    expect(compensationCalled).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Verify second call was to the compensate endpoint
    const [compensateUrl] = mockFetch.mock.calls[1];
    expect(compensateUrl).toContain("/v1/payment/compensate");
  });

  it("escalation fires when pollRailStatus never finalises (timeout path)", async () => {
    // All poll attempts return pending
    mockFetch
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "pending" }),
      });

    // Simulate 3 poll attempts without finalisation → escalate
    let escalated = false;
    for (let i = 0; i < 3; i++) {
      const { finalised } = await pollRailStatus(ACTIVITY_INPUT);
      if (!finalised && i === 2) {
        escalated = true;
        mockFetch.mockResolvedValueOnce({ ok: true });
        await escalateToReview({
          ...ACTIVITY_INPUT,
          reason: "Transfer still pending after 3 poll attempts",
        });
        break;
      }
    }

    expect(escalated).toBe(true);
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(lastCall[0]).toContain("/v1/payment/escalate");
  });
});

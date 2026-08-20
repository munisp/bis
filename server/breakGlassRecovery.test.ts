import { describe, expect, it, vi } from "vitest";
import { reconcileQueuedBreakGlassExecutions } from "./breakGlassRecovery";

describe("break-glass recovery reconciliation", () => {
  it("creates a single immutable recovery-required event for each stale queued execution without completion evidence", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ aggregateId: "audit-1", actorId: 7, payload: { path: "/v1/admin/delete" }, createdAt: new Date("2026-08-20T16:00:00Z") }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });
    await expect(reconcileQueuedBreakGlassExecutions({ execute } as any)).resolves.toEqual({ scanned: 1, recoveryRequired: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate a recovery record when a concurrent reconciler already created it", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ aggregateId: "audit-1", actorId: 7, payload: {}, createdAt: new Date("2026-08-20T16:00:00Z") }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(reconcileQueuedBreakGlassExecutions({ execute } as any)).resolves.toEqual({ scanned: 1, recoveryRequired: 0 });
  });
});

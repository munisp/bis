import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const connect = vi.fn(async () => ({ query, release: vi.fn() }));

vi.mock("./db", () => ({ getPgPool: vi.fn(async () => ({ connect })) }));
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true) }));
vi.mock("./_core/env", () => ({
  ENV: { isProduction: false, auditHmacSecret: "test-audit-hmac-key", databaseUrl: "postgresql://test" },
}));

import { consumerDisputesRouter } from "./consumerDisputes";

const CASE_ROW = {
  id: "41", case_ref: "BIS-DR-0123456789ABCDEF01", tenant_id: 7, requester_user_id: 17,
  subject_binding_id: "31", framework: "fcra", jurisdiction_code: "US", case_type: "accuracy",
  status: "investigating", received_at: "2026-01-01T00:00:00.000Z", reinvestigation_due_at: "2026-01-31T00:00:00.000Z",
  extension_due_at: null, result_notice_due_at: "2026-02-05T00:00:00.000Z", completed_at: null,
};

const SUPERVISOR_CTX = {
  user: { id: 99, role: "supervisor" }, tenantId: 7, isDemo: false,
} as any;

function mockAcknowledgeOpen(): void {
  query.mockImplementation(async (statement: string) => {
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
    if (statement.includes("FROM consumer_dispute_cases")) return { rows: [CASE_ROW] };
    if (statement.includes("FROM consumer_dispute_deadline_escalations")) {
      return { rows: [{ id: "501", escalation_type: "reinvestigation_due", due_at: "2026-01-31T00:00:00.000Z", status: "open", acknowledged_at: null, acknowledged_by_user_id: null }] };
    }
    if (statement.includes("UPDATE consumer_dispute_deadline_escalations")) return { rows: [] };
    if (statement.includes("INSERT INTO consumer_dispute_events")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${statement}`);
  });
}

function mockResolveAcknowledged(): void {
  query.mockImplementation(async (statement: string) => {
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
    if (statement.includes("FROM consumer_dispute_cases")) return { rows: [CASE_ROW] };
    if (statement.includes("FROM consumer_dispute_deadline_escalations")) {
      return { rows: [{ id: "501", escalation_type: "reinvestigation_due", due_at: "2026-01-31T00:00:00.000Z", status: "acknowledged", resolution_note: null }] };
    }
    if (statement.includes("UPDATE consumer_dispute_deadline_escalations")) return { rows: [] };
    if (statement.includes("INSERT INTO consumer_dispute_events")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${statement}`);
  });
}

beforeEach(() => {
  query.mockReset();
  connect.mockClear();
});

describe("consumer dispute deadline escalation supervisor procedures", () => {
  it("acknowledges an open escalation under the supervisor tenant and emits an immutable event", async () => {
    mockAcknowledgeOpen();
    const caller = consumerDisputesRouter.createCaller(SUPERVISOR_CTX);
    await expect(caller.acknowledgeDeadlineEscalation({ caseRef: CASE_ROW.case_ref, escalationId: 501 }))
      .resolves.toEqual({ escalationId: "501", status: "acknowledged" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1 AND case_id = $2"), [501, "41"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'acknowledged'"), [99, "501"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO consumer_dispute_events"), expect.any(Array));
  });

  it("requires a substantive resolution note and records resolution under the supervisor identity", async () => {
    mockResolveAcknowledged();
    const caller = consumerDisputesRouter.createCaller(SUPERVISOR_CTX);
    await expect(caller.resolveDeadlineEscalation({ caseRef: CASE_ROW.case_ref, escalationId: 501, resolutionNote: "Source response reviewed and consumer notice confirmed." }))
      .resolves.toMatchObject({ escalationId: "501", status: "resolved" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'resolved'"), [99, "Source response reviewed and consumer notice confirmed.", "501"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO consumer_dispute_events"), expect.any(Array));
  });

  it("rejects an insufficient resolution rationale before touching PostgreSQL", async () => {
    const caller = consumerDisputesRouter.createCaller(SUPERVISOR_CTX);
    await expect(caller.resolveDeadlineEscalation({ caseRef: CASE_ROW.case_ref, escalationId: 501, resolutionNote: "short" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("denies analyst accounts the supervisor-only escalation controls", async () => {
    const caller = consumerDisputesRouter.createCaller({ ...SUPERVISOR_CTX, user: { id: 41, role: "analyst" } } as any);
    await expect(caller.acknowledgeDeadlineEscalation({ caseRef: CASE_ROW.case_ref, escalationId: 501 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(connect).not.toHaveBeenCalled();
  });
});

/**
 * Phase 22 — Production Hardening Test Suite
 *
 * Covers:
 * 1. Auth — demo user context and real user context
 * 2. Role-based access — adminProcedure blocks non-admin callers
 * 3. Investigations — list, get, create procedures
 * 4. Alerts — list, acknowledge procedures
 * 5. KYC — create (biometric path), list
 * 6. Field tasks — list, dispatch
 * 7. Alert rules — list, create, update (enable/disable)
 * 8. Dashboard stats — returns numeric fields
 * 9. Audit log — list returns items + total
 * 10. Data sources — list returns catalog
 * 11. Monitors — list
 * 12. Screening — list
 * 13. Field Agents — list
 * 14. Onboarding — admin can list, non-admin is blocked
 * 15. Tenants — list returns rows + total
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Context factories ────────────────────────────────────────────────────────

function makeMockRes() {
  return {
    clearCookie: (_name: string) => {},
    cookie: (_name: string, _val: unknown) => {},
  } as unknown as TrpcContext["res"];
}

function makeCtx(role: "admin" | "analyst" | "supervisor" | "auditor" | "readonly" | "user" = "analyst", id = 1): TrpcContext {
  return {
    user: {
      id,
      openId: `test-${role}-${id}`,
      name: `Test ${role}`,
      email: `${role}@test.bis`,
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: makeMockRes(),
  };
}

const adminCtx    = makeCtx("admin",    1);
const analystCtx  = makeCtx("analyst",  2);
const auditorCtx  = makeCtx("auditor",  3);
const readonlyCtx = makeCtx("readonly", 4);

function makeDemoCtx(): TrpcContext {
  return {
    user: {
      id: 0,
      openId: "demo-admin",
      name: "Demo Admin",
      email: "demo@bis-platform.dev",
      loginMethod: "demo",
      role: "admin",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: makeMockRes(),
  };
}

// ─── 1. Auth ──────────────────────────────────────────────────────────────────

describe("auth.me", () => {
  it("returns the demo user when called with demo context", async () => {
    const caller = appRouter.createCaller(makeDemoCtx());
    const me = await caller.auth.me();
    expect(me).not.toBeNull();
    expect(me?.openId).toBe("demo-admin");
    expect(me?.role).toBe("admin");
  });

  it("returns the authenticated user when a real session is present", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const me = await caller.auth.me();
    expect(me?.role).toBe("analyst");
    expect(me?.id).toBe(2);
  });

  it("returns null for a null-user context", async () => {
    const nullCtx: TrpcContext = {
      user: null as unknown as TrpcContext["user"],
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: makeMockRes(),
    };
    const caller = appRouter.createCaller(nullCtx);
    const me = await caller.auth.me();
    expect(me).toBeNull();
  });
});

// ─── 2. Role-based access ─────────────────────────────────────────────────────

describe("adminProcedure guard", () => {
  // onboarding.list is adminProcedure
  it("allows admin to call onboarding.list", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.onboarding.list({ limit: 10, offset: 0 });
    expect(typeof result.total).toBe("number");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("blocks analyst from calling onboarding.list", async () => {
    const caller = appRouter.createCaller(analystCtx);
    await expect(caller.onboarding.list({ limit: 10, offset: 0 }))
      .rejects.toThrow(TRPCError);
  });

  it("blocks auditor from calling onboarding.list", async () => {
    const caller = appRouter.createCaller(auditorCtx);
    await expect(caller.onboarding.list({ limit: 10, offset: 0 }))
      .rejects.toThrow(TRPCError);
  });

  it("blocks readonly from calling onboarding.list", async () => {
    const caller = appRouter.createCaller(readonlyCtx);
    await expect(caller.onboarding.list({ limit: 10, offset: 0 }))
      .rejects.toThrow(TRPCError);
  });

  // alertRules.runScheduled is adminProcedure
  it("blocks analyst from calling alertRules.runScheduled", async () => {
    const caller = appRouter.createCaller(analystCtx);
    await expect(caller.alertRules.runScheduled())
      .rejects.toThrow(TRPCError);
  });
});

// ─── 3. Investigations ────────────────────────────────────────────────────────

describe("investigations", () => {
  it("list returns items array and total", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.investigations.list({
      search: "",
      limit: 10,
      offset: 0,
    });
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("list accepts status filter and returns only matching items", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.investigations.list({
      status: "completed",
      limit: 10,
      offset: 0,
    });
    for (const inv of result.items) {
      expect(inv.status).toBe("completed");
    }
  });

  it("get returns null for a non-existent ref", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.investigations.get({ ref: "INV-DOES-NOT-EXIST" });
    expect(result).toBeNull();
  });

  it("create returns a new investigation with a BIS- ref", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.investigations.create({
      subjectType: "individual",
      subjectName: "Test Subject Vitest",
      tier: "basic",
      priority: "low",
      purpose: "Automated test",
    });
    // create returns { ref } only
    expect(result.ref).toMatch(/^BIS-/);
  });
});

// ─── 4. Alerts ────────────────────────────────────────────────────────────────

describe("alerts", () => {
  it("list returns an array", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.alerts.list({ unreadOnly: false, limit: 20 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("list with unreadOnly=true returns only unread (read=false) alerts", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.alerts.list({ unreadOnly: true, limit: 50 });
    for (const a of result) {
      expect(a.read).toBe(false);
    }
  });

  it("acknowledge sets acknowledged=true", async () => {
    const caller = appRouter.createCaller(adminCtx);
    // Get an unacknowledged alert
    const all = await caller.alerts.list({ unreadOnly: false, limit: 50 });
    const unacked = all.find(a => !a.acknowledged);
    if (!unacked) return; // no data, skip gracefully
    const res = await caller.alerts.acknowledge({ id: unacked.id });
    expect(res).toMatchObject({ success: true });
    // Verify it's now acknowledged
    const after = await caller.alerts.list({ unreadOnly: false, limit: 50 });
    const updated = after.find(a => a.id === unacked.id);
    expect(updated?.acknowledged).toBe(true);
  });
});

// ─── 5. KYC ───────────────────────────────────────────────────────────────────

describe("kyc", () => {
  it("list returns items array and total", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.kyc.list({ limit: 10 });
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("list accepts status filter", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.kyc.list({ limit: 20, status: "passed" });
    for (const rec of result.items) {
      expect(rec.status).toBe("passed");
    }
  });

  it("create (biometric path) returns a new KYC record with status", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.kyc.create({
      subjectName: "Vitest KYC Subject",
      documentType: "national_id",
      livenessPassed: true,
      documentConfidence: 0.95,
      isTampered: false,
    });
    expect(result.id).toBeGreaterThan(0);
    expect(["passed", "review", "failed"]).toContain(result.status);
  });
});

// ─── 6. Field Tasks ───────────────────────────────────────────────────────────

describe("fieldTasks", () => {
  it("list returns an array", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.fieldTasks.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("list with status filter returns only matching tasks", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.fieldTasks.list({ status: "dispatched", limit: 20 });
    for (const t of result) {
      expect(t.status).toBe("dispatched");
    }
  });

  it("dispatch returns a new task with a FT- ref", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.fieldTasks.dispatch({
      agentId: "FA-001",
      agentName: "Test Agent",
      taskType: "address_verification",
      priority: "low",
      subjectName: "Vitest Field Subject",
      address: "1 Test Street, Lagos",
      state: "Lagos",
      lga: "Ikeja",
      instructions: "Automated test task",
    });
    expect(result.taskRef).toMatch(/^FT-/);
  });
});

// ─── 7. Alert Rules ───────────────────────────────────────────────────────────

describe("alertRules", () => {
  it("list returns an array (accessible to any authenticated user)", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.alertRules.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create returns a new rule", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.alertRules.create({
      name: "Vitest Rule",
      metric: "risk_score",
      operator: "gte",
      threshold: 80,
      severity: "high",
      description: "Automated test rule",
      autoEscalate: false,
      notifyOwner: false,
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.name).toBe("Vitest Rule");
  });

  it("update (enable/disable) succeeds", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const rules = await caller.alertRules.list();
    if (rules.length === 0) return;
    const rule = rules[0];
    const res = await caller.alertRules.update({ id: rule.id, enabled: !rule.enabled });
    expect(res).toMatchObject({ success: true });
  });

  it("runScheduled is blocked for analyst", async () => {
    const caller = appRouter.createCaller(analystCtx);
    await expect(caller.alertRules.runScheduled())
      .rejects.toThrow(TRPCError);
  });

  it("runScheduled succeeds for admin and returns summary fields", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.alertRules.runScheduled();
    // returns { rulesEvaluated, rulesTriggered, alertsCreated }
    expect(typeof result.rulesEvaluated).toBe("number");
    expect(typeof result.rulesTriggered).toBe("number");
    expect(typeof result.alertsCreated).toBe("number");
  });
});

// ─── 8. Dashboard stats ───────────────────────────────────────────────────────

describe("dashboard.stats", () => {
  it("returns required numeric fields", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const stats = await caller.dashboard.stats();
    expect(typeof stats.totalInvestigations).toBe("number");
    expect(typeof stats.activeInvestigations).toBe("number");
    expect(typeof stats.alertsToday).toBe("number");
    expect(typeof stats.kycPassRate).toBe("number");
  });

  it("kycPassRate is between 0 and 100", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const stats = await caller.dashboard.stats();
    expect(stats.kycPassRate).toBeGreaterThanOrEqual(0);
    expect(stats.kycPassRate).toBeLessThanOrEqual(100);
  });
});

// ─── 9. Audit log ─────────────────────────────────────────────────────────────

describe("audit", () => {
  it("list returns items array and total", async () => {
    const caller = appRouter.createCaller(auditorCtx);
    const result = await caller.audit.list({ limit: 10, offset: 0 });
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("list items have required fields", async () => {
    const caller = appRouter.createCaller(auditorCtx);
    const result = await caller.audit.list({ limit: 10, offset: 0 });
    if (result.items.length > 0) {
      const entry = result.items[0];
      expect(typeof entry.action).toBe("string");
      expect(typeof entry.category).toBe("string");
      expect(entry.createdAt).toBeInstanceOf(Date);
    }
  });
});

// ─── 10. Data sources ─────────────────────────────────────────────────────────

describe("dataSources", () => {
  it("list returns at least 20 data sources", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.dataSources.list();
    expect(result.length).toBeGreaterThanOrEqual(20);
  });

  it("each source has required fields", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.dataSources.list();
    for (const ds of result.slice(0, 5)) {
      expect(typeof ds.code).toBe("string");
      expect(typeof ds.name).toBe("string");
      expect(typeof ds.status).toBe("string");
    }
  });
});

// ─── 11. Monitors ─────────────────────────────────────────────────────────────

describe("monitors", () => {
  it("list returns an array", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.monitors.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 12. Screening ────────────────────────────────────────────────────────────

describe("screening", () => {
  it("list returns { records, total }", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.screening.list();
    expect(Array.isArray(result.records)).toBe(true);
    expect(typeof result.total).toBe("number");
  });
});

// ─── 13. Field Agents ─────────────────────────────────────────────────────────

describe("fieldAgents", () => {
  it("list returns at least 10 agents", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.fieldAgents.list();
    expect(result.length).toBeGreaterThanOrEqual(10);
  });

  it("each agent has required fields", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.fieldAgents.list();
    for (const agent of result.slice(0, 3)) {
      expect(typeof agent.agentCode).toBe("string");
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.status).toBe("string");
    }
  });
});

// ─── 14. Onboarding ───────────────────────────────────────────────────────────

describe("onboarding", () => {
  it("admin can list applications", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.onboarding.list({ limit: 10, offset: 0 });
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("analyst cannot list applications", async () => {
    const caller = appRouter.createCaller(analystCtx);
    await expect(caller.onboarding.list({ limit: 10, offset: 0 }))
      .rejects.toThrow(TRPCError);
  });
});

// ─── 15. Tenants ──────────────────────────────────────────────────────────────

describe("tenants", () => {
  it("list returns rows array and total", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.tenants.list();
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("list returns at least 5 seeded tenants", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.tenants.list();
    expect(result.total).toBeGreaterThanOrEqual(5);
  });
});

// ─── 16. Reports ──────────────────────────────────────────────────────────────

describe("reports", () => {
  it("list returns an array", async () => {
    const caller = appRouter.createCaller(analystCtx);
    const result = await caller.reports.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

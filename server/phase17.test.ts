// phase17.test.ts — Tests for Phase 17 features
// Covers: alertRules CRUD (create, list, update, delete) and alerts.escalate input validation

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "analyst@bis.ng",
    name: "Test Analyst",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── alertRules router ────────────────────────────────────────────────────────

describe("alertRules router", () => {
  it("is registered in the appRouter", () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.alertRules.list).toBe("function");
    expect(typeof caller.alertRules.create).toBe("function");
    expect(typeof caller.alertRules.update).toBe("function");
    expect(typeof caller.alertRules.delete).toBe("function");
  });

  it("alertRules.create validates required fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Should throw when name is too short
    await expect(
      caller.alertRules.create({
        name: "X", // min 2 chars
        metric: "risk_score",
        threshold: 70,
      } as any)
    ).rejects.toThrow();
  });

  it("alertRules.create validates metric enum", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alertRules.create({
        name: "Bad Metric Rule",
        metric: "invalid_metric" as any,
        threshold: 50,
      })
    ).rejects.toThrow();
  });

  it("alertRules.update requires id", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alertRules.update({ id: undefined as any })
    ).rejects.toThrow();
  });

  it("alertRules.delete requires id", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alertRules.delete({ id: undefined as any })
    ).rejects.toThrow();
  });
});

// ─── alerts.escalate router ───────────────────────────────────────────────────

describe("alerts.escalate", () => {
  it("is registered in the appRouter", () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.alerts.escalate).toBe("function");
  });

  it("escalate requires agentId", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alerts.escalate({
        id: 1,
        agentId: undefined as any,
        agentName: "Agent Smith",
      })
    ).rejects.toThrow();
  });

  it("escalate requires agentName", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alerts.escalate({
        id: 1,
        agentId: "BIS-LOS-001",
        agentName: undefined as any,
      })
    ).rejects.toThrow();
  });

  it("escalate requires numeric alert id", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.alerts.escalate({
        id: "not-a-number" as any,
        agentId: "BIS-LOS-001",
        agentName: "Agent Smith",
      })
    ).rejects.toThrow();
  });
});

// ─── fieldAgents.create router ────────────────────────────────────────────────

describe("fieldAgents.create", () => {
  it("is registered in the appRouter", () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.fieldAgents.create).toBe("function");
  });

  it("create validates required agentCode and name", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.fieldAgents.create({
        agentCode: "",
        name: "",
        email: "test@example.com",
      } as any)
    ).rejects.toThrow();
  });
});

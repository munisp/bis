/**
 * Tenant webhooks — IDOR + SSRF regression tests.
 *
 * - createWebhook pins non-admins to their own tenant (input.tenantId is
 *   validated, never trusted).
 * - updateWebhook / deleteWebhook / testWebhook verify the webhook row's
 *   tenantId against the caller before operating.
 * - assertSafeWebhookUrl blocks loopback, link-local, private ranges and
 *   internal hostnames, and requires https in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createFakeDb, type FakeDb } from "./test-utils/fakeDb";
import { ENV } from "./_core/env";

const dbHolder = vi.hoisted(() => ({ current: null as unknown as FakeDb }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbHolder.current),
}));

import { tenantsRouter, assertSafeWebhookUrl } from "./tenants";

const savedIsProduction = ENV.isProduction;

afterEach(() => {
  (ENV as { isProduction: boolean }).isProduction = savedIsProduction;
});

beforeEach(() => {
  (ENV as { isProduction }).isProduction = false;
  dbHolder.current = createFakeDb({
    webhooks: [
      { id: 101, tenantId: 7, url: "https://hooks.t7.example/notify", status: "active", events: [], secret: "s7", failureCount: 0 },
      { id: 102, tenantId: 8, url: "https://hooks.t8.example/notify", status: "active", events: [], secret: "s8", failureCount: 0 },
    ] as any,
  });
});

function ctxFor(user: { id: number; role: string; tenantId: number | null }): TrpcContext {
  return {
    user: { name: "Test User", email: "user@test.dev", ...user } as TrpcContext["user"],
    tenantId: user.tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const tenant7User = { id: 11, role: "analyst", tenantId: 7 };
const admin = { id: 1, role: "admin", tenantId: null };

describe("tenant webhook IDOR guards", () => {
  it("createWebhook rejects a non-admin targeting another tenant", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(
      caller.createWebhook({ tenantId: 8, url: "https://hooks.example.com/x", events: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createWebhook stores the caller's tenant for non-admins", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    const row = await caller.createWebhook({ tenantId: 7, url: "https://hooks.example.com/x", events: [] });
    expect(row.tenantId).toBe(7);
  });

  it("createWebhook lets admins target any tenant", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(admin));
    const row = await caller.createWebhook({ tenantId: 8, url: "https://hooks.example.com/x", events: [] });
    expect(row.tenantId).toBe(8);
  });

  it("updateWebhook rejects cross-tenant modification", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(
      caller.updateWebhook({ id: 102, status: "paused" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updateWebhook allows same-tenant modification", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    const row = await caller.updateWebhook({ id: 101, status: "paused" });
    expect(row.status).toBe("paused");
  });

  it("deleteWebhook rejects cross-tenant deletion", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(caller.deleteWebhook({ id: 102 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deleteWebhook returns NOT_FOUND for unknown ids", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(caller.deleteWebhook({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("testWebhook rejects cross-tenant pings before any network call", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(caller.testWebhook({ id: 102 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("listWebhooks cannot enumerate another tenant's webhooks", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(caller.listWebhooks({ tenantId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rows = await caller.listWebhooks({ tenantId: 7 });
    expect(rows.map((r: any) => r.id)).toEqual([101]);
  });
});

describe("assertSafeWebhookUrl (SSRF guard)", () => {
  it("accepts a public https URL", () => {
    expect(() => assertSafeWebhookUrl("https://hooks.example.com/notify")).not.toThrow();
  });

  it.each([
    "https://localhost/hook",
    "https://localhost.localdomain/hook",
    "https://127.0.0.1/hook",
    "https://127.0.0.53/hook",
    "https://10.0.0.5/hook",
    "https://172.16.0.1/hook",
    "https://172.31.255.255/hook",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/hook",
    "https://0.0.0.0/hook",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://[fe80::1]/hook",
    "https://service.internal/hook",
    "https://caddy/hook",
    "https://permify/hook",
    "https://metadata.google.internal/hook",
  ])("blocks internal target %s", (url) => {
    expect(() => assertSafeWebhookUrl(url)).toThrowError(/not allowed|must use https/i);
  });

  it("requires https in production", () => {
    (ENV as { isProduction: boolean }).isProduction = true;
    expect(() => assertSafeWebhookUrl("http://hooks.example.com/notify")).toThrowError(/https/i);
    expect(() => assertSafeWebhookUrl("https://hooks.example.com/notify")).not.toThrow();
  });

  it("tolerates http for public hosts in development", () => {
    (ENV as { isProduction: boolean }).isProduction = false;
    expect(() => assertSafeWebhookUrl("http://hooks.example.com/notify")).not.toThrow();
  });

  it("rejects unparseable URLs", () => {
    expect(() => assertSafeWebhookUrl("not a url")).toThrowError(/invalid webhook url/i);
  });

  it("createWebhook rejects SSRF targets before insert", async () => {
    const caller = tenantsRouter.createCaller(ctxFor(tenant7User));
    await expect(
      caller.createWebhook({ tenantId: 7, url: "http://169.254.169.254/latest/meta-data", events: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

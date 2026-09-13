// server/tenants.ts — tRPC router for Tenants, API Keys, and Webhooks
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, writeProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  tenants, apiKeys, webhooks,
  type InsertTenant,
  type Webhook,
} from "../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import crypto from "crypto";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";

// ─── Webhook Retry Helper ──────────────────────────────────────────────────────
async function deliverWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  maxAttempts = 4,
): Promise<{ ok: boolean; status: number; attempts: number }> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      lastStatus = res.status;
      if (res.status >= 400 && res.status < 500) break;
    } catch {
      lastStatus = 0;
    }
    if (attempt < maxAttempts) {
      const baseMs = (2 ** (attempt - 1)) * 1_000;
      const jitter = 0 // deterministic: no jitter in production;
      await new Promise(r => setTimeout(r, Math.max(100, baseMs + jitter)));
    }
  }
  return { ok: false, status: lastStatus, attempts: maxAttempts };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `bisk_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, prefix, hash };
}

// ─── Webhook SSRF Guard ───────────────────────────────────────────────────────
// Webhook URLs are fetched server-side, so they must never point at loopback,
// link-local, or private network addresses, nor at internal service hostnames
// (cloud metadata endpoints, docker-compose service names, etc.).

const BLOCKED_WEBHOOK_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  // Internal docker-compose / cluster service names
  "caddy",
  "permify",
  "kafka",
  "redis",
  "postgres",
  "postgresql",
  "temporal",
  "ollama",
  "gateway",
  "risk-engine",
  "opensearch",
  "minio",
  "vault",
  "consul",
]);

const BLOCKED_WEBHOOK_HOST_SUFFIXES = [
  ".internal",
  ".localhost",
  ".local",
  ".lan",
  ".corp",
  ".home.arpa",
];

/** Parse an IPv4 literal (dotted-quad only) into octets, or null. */
function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every(o => o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 ||                       // 0.0.0.0/8 "this host"
    a === 10 ||                      // 10.0.0.0/8 private
    a === 127 ||                     // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) ||      // 192.168.0.0/16 private
    (a === 169 && b === 254) ||      // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a >= 224                         // multicast + reserved
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "::1" ||        // loopback
    h === "::" ||         // unspecified
    h.startsWith("fc") || // fc00::/7 unique-local
    h.startsWith("fd") ||
    h.startsWith("fe80")  // fe80::/10 link-local
  );
}

/**
 * Assert that a webhook URL is safe to fetch server-side (SSRF guard).
 * - Requires https:// in production (http:// is tolerated in dev only).
 * - Blocks loopback, link-local, private and CGNAT IP literals.
 * - Blocks internal hostnames and internal DNS suffixes.
 * Throws TRPCError(BAD_REQUEST) on any violation.
 */
export function assertSafeWebhookUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid webhook URL" });
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !ENV.isProduction)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: ENV.isProduction
        ? "Webhook URL must use https://"
        : "Webhook URL must use http:// or https://",
    });
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL must include a hostname" });
  }
  if (BLOCKED_WEBHOOK_HOSTNAMES.has(host)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL targets an internal hostname and is not allowed" });
  }
  if (BLOCKED_WEBHOOK_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL targets an internal hostname and is not allowed" });
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL targets a private, loopback, or link-local address and is not allowed" });
    }
  } else if (host.includes(":") || host.startsWith("[")) {
    if (isPrivateIpv6(host)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL targets a private, loopback, or link-local address and is not allowed" });
    }
  }
}

/**
 * Resolve the tenant a webhook operation is allowed to target.
 * Admins may manage any tenant's webhooks; everyone else is pinned to their
 * own tenant (input.tenantId is validated, never trusted).
 */
function resolveWebhookTenant(ctxUser: { role: string; tenantId: number | null }, requestedTenantId: number): number {
  if (ctxUser.role === "admin") return requestedTenantId;
  if (ctxUser.tenantId == null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A tenant assignment is required to manage webhooks" });
  }
  if (requestedTenantId !== ctxUser.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage webhooks for another tenant" });
  }
  return ctxUser.tenantId;
}

/** Verify an existing webhook row belongs to the caller's tenant (admins exempt). */
function assertWebhookTenantAccess(webhook: Pick<Webhook, "tenantId">, ctxUser: { role: string; tenantId: number | null }): void {
  if (ctxUser.role === "admin") return;
  if (ctxUser.tenantId == null || webhook.tenantId !== ctxUser.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage webhooks for another tenant" });
  }
}

// ─── Tenants Router ───────────────────────────────────────────────────────────

export const tenantsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      plan: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };
      const rows = await db.select().from(tenants)
        .orderBy(desc(tenants.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      const [{ c }] = await db.select({ c: count() }).from(tenants);
      return { rows, total: Number(c) };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(tenants).where(eq(tenants.id, input.id));
      return row ?? null;
    }),

  create: writeProcedure
    .input(z.object({
      name: z.string().min(2).max(255),
      slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
      plan: z.enum(["starter", "professional", "enterprise", "government"]).default("starter"),
      contactEmail: z.string().email().optional(),
      contactName: z.string().optional(),
      country: z.string().optional(),
      industry: z.string().optional(),
      monthlyQuota: z.number().min(1).default(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [row] = await db.insert(tenants).values({
        ...input,
        status: "trial",
        usedThisMonth: 0,
        ngnBalance: 0,
      } as InsertTenant).returning();
      return row;
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(2).max(255).optional(),
      plan: z.enum(["starter", "professional", "enterprise", "government"]).optional(),
      status: z.enum(["active", "suspended", "trial", "churned"]).optional(),
      contactEmail: z.string().email().optional(),
      contactName: z.string().optional(),
      country: z.string().optional(),
      industry: z.string().optional(),
      monthlyQuota: z.number().min(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...data } = input;
      const [row] = await db.update(tenants)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return row;
    }),

  suspend: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(tenants)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(tenants.id, input.id));
      return { success: true };
    }),

  reactivate: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(tenants)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(tenants.id, input.id));
      return { success: true };
    }),

  updateLogo: writeProcedure
    .input(z.object({
      id: z.number(),
      // Base64-encoded image data URI, e.g. "data:image/png;base64,..."
      dataUri: z.string().min(10).max(5_000_000),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]).default("image/png"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Strip the data URI prefix to get raw base64
      const base64 = input.dataUri.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      const ext = input.mimeType.split("/")[1].replace("svg+xml", "svg");
      const fileKey = `tenant-logos/${input.id}-${Date.now()}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      const [row] = await db.update(tenants)
        .set({ logoUrl: url, updatedAt: new Date() })
        .where(eq(tenants.id, input.id))
        .returning();
      return { logoUrl: url, tenant: row };
    }),

  // ── API Keys ────────────────────────────────────────────────────────────────

  listKeys: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(apiKeys)
        .where(eq(apiKeys.tenantId, input.tenantId))
        .orderBy(desc(apiKeys.createdAt));
    }),

  createKey: writeProcedure
    .input(z.object({
      tenantId: z.number(),
      name: z.string().min(2).max(128),
      permissions: z.array(z.string()).default([]),
      expiresAt: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { raw, prefix, hash } = generateApiKey();
      const [row] = await db.insert(apiKeys).values({
        tenantId: input.tenantId,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        status: "active",
        permissions: input.permissions,
        expiresAt: input.expiresAt,
      }).returning();
      // Return the raw key ONCE — it will never be shown again
      return { ...row, rawKey: raw };
    }),

  revokeKey: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(apiKeys)
        .set({ status: "revoked" })
        .where(eq(apiKeys.id, input.id));
      return { success: true };
    }),

  rotateKey: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { raw, prefix, hash } = generateApiKey();
      const [row] = await db.update(apiKeys)
        .set({ keyHash: hash, keyPrefix: prefix, status: "active" })
        .where(eq(apiKeys.id, input.id))
        .returning();
      return { ...row, rawKey: raw };
    }),

  // ── Webhooks ────────────────────────────────────────────────────────────────

  listWebhooks: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      // IDOR guard: non-admins may only list their own tenant's webhooks
      const tenantId = resolveWebhookTenant(ctx.user!, input.tenantId);
      return db.select().from(webhooks)
        .where(eq(webhooks.tenantId, tenantId))
        .orderBy(desc(webhooks.createdAt));
    }),

  createWebhook: writeProcedure
    .input(z.object({
      tenantId: z.number(),
      url: z.string().url(),
      events: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // IDOR guard: non-admins are pinned to their own tenant
      const tenantId = resolveWebhookTenant(ctx.user!, input.tenantId);
      // SSRF guard: webhook URLs are fetched server-side
      assertSafeWebhookUrl(input.url);
      const secret = crypto.randomBytes(20).toString("hex");
      const [row] = await db.insert(webhooks).values({
        tenantId,
        url: input.url,
        events: input.events,
        secret,
        status: "active",
        failureCount: 0,
      }).returning();
      return row;
    }),

  updateWebhook: writeProcedure
    .input(z.object({
      id: z.number(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      status: z.enum(["active", "paused", "failed"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...data } = input;
      const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      assertWebhookTenantAccess(existing, ctx.user!);
      if (data.url !== undefined) assertSafeWebhookUrl(data.url);
      const [row] = await db.update(webhooks)
        .set(data)
        .where(eq(webhooks.id, id))
        .returning();
      return row;
    }),

  deleteWebhook: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      assertWebhookTenantAccess(existing, ctx.user!);
      await db.delete(webhooks).where(eq(webhooks.id, input.id));
      return { success: true };
    }),

  testWebhook: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, input.id));
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      assertWebhookTenantAccess(wh, ctx.user!);
      assertSafeWebhookUrl(wh.url);
      const body = JSON.stringify({ event: "ping", timestamp: new Date().toISOString() });
      const sig = `sha256=${crypto.createHmac("sha256", wh.secret ?? "").update(body).digest("hex")}`;
      const result = await deliverWithRetry(
        wh.url,
        { "X-BIS-Signature": sig, "X-BIS-Event": "ping" },
        body,
        3, // 3 attempts for manual test pings
      );
      if (result.ok) {
        await db.update(webhooks).set({ lastDeliveredAt: new Date(), failureCount: 0 }).where(eq(webhooks.id, input.id));
      } else {
        await db.update(webhooks).set({ failureCount: (wh.failureCount ?? 0) + result.attempts }).where(eq(webhooks.id, input.id));
      }
      return { success: result.ok, status: result.status, attempts: result.attempts };
    }),

  // ── Branding Settings ───────────────────────────────────────────────────────

  updateBranding: writeProcedure
    .input(z.object({
      id: z.number(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      reportFooter: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...data } = input;
      const [row] = await db.update(tenants)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return row;
    }),
});

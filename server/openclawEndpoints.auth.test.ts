/**
 * OpenClaw endpoints — bearer-token authentication regression tests.
 *
 * validateBearerToken used to accept any token starting with "bis_". These
 * tests verify that every OpenClaw endpoint now validates the token against
 * the apiTokens table (SHA-256 hash lookup + active + expiresAt) and fails
 * CLOSED (503) when the database is unavailable. In production the API docs
 * routes require the same authentication.
 */
import crypto from "crypto";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";

// ─── Controllable apiTokens store ────────────────────────────────────────────

interface TokenRow {
  id: number;
  tenantId: number | null;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: string[];
  rateLimit: number;
  usageCount: number;
  tokensConsumed: number;
  tokenQuota: number | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  active: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const state = vi.hoisted(() => ({
  dbAvailable: true,
  tokens: [] as TokenRow[],
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => {
    if (!state.dbAvailable) return null;
    const chain: any = {
      from: () => chain,
      where: (cond: unknown) => {
        // Extract the looked-up tokenHash from the eq() condition
        const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks ?? [];
        const param = chunks.find(
          (c: unknown) => typeof c === "object" && c !== null && "value" in (c as object) && "encoder" in (c as object),
        ) as { value?: unknown } | undefined;
        const hash = param?.value;
        chain.__rows = state.tokens.filter(t => t.tokenHash === hash);
        return chain;
      },
      limit: () => chain,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(chain.__rows ?? []).then(res, rej),
    };
    return {
      select: () => chain,
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({ values: () => Promise.resolve([]) }),
    };
  }),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({
    choices: [{ message: { content: "## Report\nDeterministic test report." } }],
  })),
}));

import { createOpenClawRouter } from "./openclawEndpoints";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeTokenRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: 1,
    tenantId: 7,
    name: "test token",
    prefix: "bisk_live_ab12",
    tokenHash: "",
    scopes: [],
    rateLimit: 60,
    usageCount: 0,
    tokensConsumed: 0,
    tokenQuota: null,
    lastUsedAt: null,
    expiresAt: null,
    active: true,
    createdBy: 11,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const VALID_TOKEN = "bisk_live_ab12_cd34ef56";

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
const savedIsProduction = ENV.isProduction;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(createOpenClawRouter());
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  (ENV as { isProduction: boolean }).isProduction = savedIsProduction;
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  state.dbAvailable = true;
  state.tokens = [makeTokenRow({ tokenHash: hashToken(VALID_TOKEN) })];
  (ENV as { isProduction: boolean }).isProduction = false;
});

function post(path: string, body: unknown, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("openclaw execute authentication", () => {
  it("rejects a syntactically valid but unknown token (Bearer bis_fake)", async () => {
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, "bis_fake");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with no Authorization header", async () => {
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" });
    expect(res.status).toBe(401);
  });

  it("fast-rejects tokens without a bis_/bisk_ prefix", async () => {
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, "not-a-bis-token");
    expect(res.status).toBe(401);
  });

  it("fails closed with 503 when the database is unavailable", async () => {
    state.dbAvailable = false;
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, VALID_TOKEN);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("DB_UNAVAILABLE");
  });

  it("rejects revoked tokens", async () => {
    state.tokens = [makeTokenRow({ tokenHash: hashToken(VALID_TOKEN), active: false })];
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, VALID_TOKEN);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("TOKEN_REVOKED");
  });

  it("rejects expired tokens", async () => {
    state.tokens = [makeTokenRow({ tokenHash: hashToken(VALID_TOKEN), expiresAt: new Date(Date.now() - 60_000) })];
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, VALID_TOKEN);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("TOKEN_EXPIRED");
  });

  it("accepts a valid active token", async () => {
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "recent alerts" }, VALID_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("list_alerts");
    expect(typeof body.result).toBe("string");
  });

  it("enforces token quota from the authenticated record", async () => {
    state.tokens = [makeTokenRow({ tokenHash: hashToken(VALID_TOKEN), tokenQuota: 10, tokensConsumed: 10 })];
    const res = await post("/api/v1/openclaw/execute", { action: "list_alerts", prompt: "x" }, VALID_TOKEN);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("QUOTA_EXCEEDED");
  });
});

describe("openclaw webhook authentication", () => {
  it("rejects unknown bearer tokens", async () => {
    const res = await post("/api/v1/openclaw/webhook", { event: "alert.triggered" }, "bis_fake");
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and a known event", async () => {
    const res = await post("/api/v1/openclaw/webhook", { event: "alert.triggered", data: { title: "t" } }, VALID_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);
  });
});

describe("openclaw replay authentication", () => {
  it("rejects unknown bearer tokens (tokenHash is never compared to the raw token)", async () => {
    const res = await post("/api/v1/openclaw/replay/1", {}, "bis_fake");
    expect(res.status).toBe(401);
  });

  it("rejects replay when the database is unavailable", async () => {
    state.dbAvailable = false;
    const res = await post("/api/v1/openclaw/replay/1", {}, VALID_TOKEN);
    expect(res.status).toBe(503);
  });
});

describe("API docs protection", () => {
  it("serves /api/docs.json without auth in development", async () => {
    const res = await fetch(`${baseUrl}/api/docs.json`);
    expect(res.status).toBe(200);
  });

  it("requires a valid bearer token for /api/docs.json in production", async () => {
    (ENV as { isProduction: boolean }).isProduction = true;
    const unauth = await fetch(`${baseUrl}/api/docs.json`);
    expect(unauth.status).toBe(401);
    const fake = await fetch(`${baseUrl}/api/docs.json`, { headers: { Authorization: "Bearer bis_fake" } });
    expect(fake.status).toBe(401);
    const ok = await fetch(`${baseUrl}/api/docs.json`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    expect(ok.status).toBe(200);
  });

  it("requires auth for /api/docs.yaml and /api/docs in production", async () => {
    (ENV as { isProduction: boolean }).isProduction = true;
    expect((await fetch(`${baseUrl}/api/docs.yaml`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/docs`)).status).toBe(401);
  });
});

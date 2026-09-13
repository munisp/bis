import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const savedFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", { value: savedFetch, writable: true, configurable: true });
});

function createContext(user: AuthenticatedUser | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

const authUser: AuthenticatedUser = {
  id: 1,
  openId: "phone-lookup-user",
  email: "analyst@example.com",
  name: "Analyst",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function stubGatewayFetch() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(
      JSON.stringify({
        number: "08031234567",
        e164: "+2348031234567",
        carrier: "MTN Nigeria",
        lineType: "mobile",
        country: "NG",
        source: "hlr",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

describe("lookup.phone", () => {
  it("proxies a valid number to the gateway /v1/phone path with the service credential", async () => {
    const calls = stubGatewayFetch();
    const caller = appRouter.createCaller(createContext(authUser));

    const result = await caller.lookup.phone({ number: "08031234567" });

    expect(result).toMatchObject({ e164: "+2348031234567", lineType: "mobile", source: "hlr" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/v1\/phone\/08031234567$/);
    expect(calls[0]!.headers["X-BIS-Key"]).toBeTruthy();
  });

  it("URL-encodes the number in the proxy path", async () => {
    const calls = stubGatewayFetch();
    const caller = appRouter.createCaller(createContext(authUser));

    await caller.lookup.phone({ number: "+234 803 123 4567" });

    expect(calls[0]!.url).toMatch(/\/v1\/phone\/%2B234%20803%20123%204567$/);
  });

  it("rejects invalid numbers before touching the gateway", async () => {
    const calls = stubGatewayFetch();
    const caller = appRouter.createCaller(createContext(authUser));

    for (const number of ["", "12", "not-a-phone-number", "+2348031234567;DROP TABLE", "9".repeat(21)]) {
      await expect(caller.lookup.phone({ number })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(calls).toHaveLength(0);
  });

  it("requires an authenticated user", async () => {
    const calls = stubGatewayFetch();
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.lookup.phone({ number: "08031234567" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls).toHaveLength(0);
  });
});

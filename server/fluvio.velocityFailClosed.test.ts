import { afterEach, describe, expect, it, vi } from "vitest";

const savedVelocityUrl = process.env.FLUVIO_VELOCITY_URL;
const savedFetch = globalThis.fetch;

async function loadVelocityCheck(url: string | undefined) {
  if (url === undefined) delete process.env.FLUVIO_VELOCITY_URL;
  else process.env.FLUVIO_VELOCITY_URL = url;
  vi.resetModules();
  return import("./fluvio");
}

afterEach(() => {
  if (savedVelocityUrl === undefined) delete process.env.FLUVIO_VELOCITY_URL;
  else process.env.FLUVIO_VELOCITY_URL = savedVelocityUrl;
  Object.defineProperty(globalThis, "fetch", { value: savedFetch, writable: true, configurable: true });
  vi.resetModules();
});

const request = {
  account_id: "account-001",
  amount_kobo: 100,
  currency: "NGN",
  tenant_id: "42",
};

describe("Fluvio velocity payment preflight", () => {
  it("blocks when the velocity endpoint is absent", async () => {
    const { fluvioCheckVelocity } = await loadVelocityCheck(undefined);
    await expect(fluvioCheckVelocity(request)).resolves.toMatchObject({
      decision: "block",
      service_available: false,
      reason: "Velocity-control service is not securely configured",
    });
  });

  it("blocks plaintext endpoints before making a network call", async () => {
    const fetchMock = vi.fn();
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, writable: true, configurable: true });
    const { fluvioCheckVelocity } = await loadVelocityCheck("http://velocity.example.test");
    await expect(fluvioCheckVelocity(request)).resolves.toMatchObject({ decision: "block", service_available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks an unreachable HTTPS endpoint", async () => {
    Object.defineProperty(globalThis, "fetch", { value: vi.fn(async () => { throw new Error("network unavailable"); }), writable: true, configurable: true });
    const { fluvioCheckVelocity } = await loadVelocityCheck("https://velocity.example.test");
    await expect(fluvioCheckVelocity(request)).resolves.toMatchObject({ decision: "block", service_available: false });
  });
});

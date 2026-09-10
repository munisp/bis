import { afterEach, describe, expect, it, vi } from "vitest";

const savedMojaloopUrl = process.env.MOJALOOP_HUB_URL;
const savedNipUrl = process.env.NIBSS_NIP_URL;
const savedNipKey = process.env.NIBSS_NIP_KEY;
const savedFetch = globalThis.fetch;

function restorePaymentRailEnvironment() {
  if (savedMojaloopUrl === undefined) delete process.env.MOJALOOP_HUB_URL;
  else process.env.MOJALOOP_HUB_URL = savedMojaloopUrl;
  if (savedNipUrl === undefined) delete process.env.NIBSS_NIP_URL;
  else process.env.NIBSS_NIP_URL = savedNipUrl;
  if (savedNipKey === undefined) delete process.env.NIBSS_NIP_KEY;
  else process.env.NIBSS_NIP_KEY = savedNipKey;
}

afterEach(() => {
  restorePaymentRailEnvironment();
  Object.defineProperty(globalThis, "fetch", { value: savedFetch, writable: true, configurable: true });
});

describe("configured live payment rails", () => {
  it("rejects transfer initiation when no credentialed payment rail is configured", async () => {
    delete process.env.MOJALOOP_HUB_URL;
    delete process.env.NIBSS_NIP_URL;
    delete process.env.NIBSS_NIP_KEY;
    const { initiateInterBankTransfer, requireActivePaymentRail } = await import("./mojaloop");

    expect(() => requireActivePaymentRail()).toThrow("No credentialed live payment rail is configured");
    await expect(
      initiateInterBankTransfer({
        txRef: "LIVE-RAIL-REQUIRED-001",
        originatorAccount: "1000000001",
        originatorName: "Originator",
        beneficiaryAccount: "2000000002",
        beneficiaryName: "Beneficiary",
        beneficiaryBankCode: "058",
        amountKobo: 100,
      }),
    ).rejects.toThrow("No credentialed live payment rail is configured");
  });

  it("rejects NIP configuration that lacks its credential", async () => {
    delete process.env.MOJALOOP_HUB_URL;
    process.env.NIBSS_NIP_URL = "https://nip.example.test";
    delete process.env.NIBSS_NIP_KEY;
    const { requireActivePaymentRail } = await import("./mojaloop");

    expect(() => requireActivePaymentRail()).toThrow("No credentialed live payment rail is configured");
  });

  it("uses the configured NIP rail and preserves the caller transfer reference", async () => {
    delete process.env.MOJALOOP_HUB_URL;
    process.env.NIBSS_NIP_URL = "https://nip.example.test";
    process.env.NIBSS_NIP_KEY = "test-nip-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ SessionID: "LIVE-RAIL-REQUIRED-003", ResponseCode: "00", ResponseMessage: "accepted" }), { status: 200 })),
    );
    const { initiateInterBankTransfer } = await import("./mojaloop");

    await expect(
      initiateInterBankTransfer({
        txRef: "LIVE-RAIL-REQUIRED-003",
        originatorAccount: "1000000001",
        originatorName: "Originator",
        beneficiaryAccount: "2000000002",
        beneficiaryName: "Beneficiary",
        beneficiaryBankCode: "058",
        amountKobo: 100,
      }),
    ).resolves.toMatchObject({
      txRef: "LIVE-RAIL-REQUIRED-003",
      externalRef: "LIVE-RAIL-REQUIRED-003",
      status: "completed",
      mode: "nip",
    });
  });
});

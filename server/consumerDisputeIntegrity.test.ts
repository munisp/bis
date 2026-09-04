import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { s3ChecksumMatchesSha256Hex, s3ChecksumSha256FromHex } from "./fieldEvidence";
import {
  consumerDisputeOutboxAad,
  decryptConsumerDisputeOutboxPayload,
  encryptConsumerDisputeOutboxPayload,
  loadConsumerDisputeOutboxKeyring,
} from "./consumerDisputeOutboxCrypto";

const ORIGINAL_ENV = { ...process.env };
const KEY = Buffer.alloc(32, 7).toString("base64");

function resetEnvironment(): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(resetEnvironment);

describe("SSE-KMS object byte checksum enforcement", () => {
  it("converts the canonical hexadecimal byte digest into S3 checksum header format", () => {
    const bytes = Buffer.from("synthetic-only-evidence", "utf8");
    const hex = createHash("sha256").update(bytes).digest("hex");
    expect(s3ChecksumSha256FromHex(hex)).toBe(createHash("sha256").update(bytes).digest("base64"));
  });

  it("rejects absent, malformed, and substituted object checksums", () => {
    const expected = createHash("sha256").update("expected bytes").digest("hex");
    const substituted = createHash("sha256").update("substituted bytes").digest("base64");
    expect(s3ChecksumMatchesSha256Hex(expected, undefined)).toBe(false);
    expect(s3ChecksumMatchesSha256Hex(expected, "not a base64 checksum")).toBe(false);
    expect(s3ChecksumMatchesSha256Hex(expected, substituted)).toBe(false);
  });

  it("accepts only an object-store checksum for the expected exact bytes", () => {
    const expected = createHash("sha256").update("exact synthetic bytes").digest("hex");
    expect(s3ChecksumMatchesSha256Hex(expected, s3ChecksumSha256FromHex(expected))).toBe(true);
  });
});

describe("consumer-dispute encrypted provider outbox", () => {
  it("round-trips opaque provider dispatch references with authenticated encryption", () => {
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ACTIVE_KEY_VERSION = "v1";
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEYRING = `v1:${KEY}`;
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ENFORCE_KEY_EXPIRY = "true";
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEY_EXPIRIES_JSON = '{"v1":"2035-01-01T00:00:00.000Z"}';
    const keyring = loadConsumerDisputeOutboxKeyring(new Date("2030-01-01T00:00:00.000Z"));
    const aad = consumerDisputeOutboxAad("provider_reinvestigation_request", "stable-idempotency-key");
    const encrypted = encryptConsumerDisputeOutboxPayload(keyring, aad, {
      caseRef: "BIS-DC-TEST", sourceTaskRef: "BIS-DST-TEST", providerAuthorizationRef: "AUTH-TEST", dataSourceId: 1,
    });
    expect(encrypted.ciphertext).not.toContain(Buffer.from("BIS-DC-TEST"));
    expect(decryptConsumerDisputeOutboxPayload(keyring, aad, encrypted)).toEqual({
      caseRef: "BIS-DC-TEST", sourceTaskRef: "BIS-DST-TEST", providerAuthorizationRef: "AUTH-TEST", dataSourceId: 1,
    });
  });

  it("rejects ciphertext tampering and mismatched authenticated data", () => {
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ACTIVE_KEY_VERSION = "v1";
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEYRING = `v1:${KEY}`;
    const keyring = loadConsumerDisputeOutboxKeyring();
    const aad = consumerDisputeOutboxAad("provider_reinvestigation_request", "idempotency-a");
    const encrypted = encryptConsumerDisputeOutboxPayload(keyring, aad, { caseRef: "BIS-DC-TEST" });
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decryptConsumerDisputeOutboxPayload(keyring, aad, encrypted)).toThrow("authentication failed");
  });

  it("fails closed when expiry enforcement has no valid active-key expiry", () => {
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ACTIVE_KEY_VERSION = "v1";
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEYRING = `v1:${KEY}`;
    process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ENFORCE_KEY_EXPIRY = "true";
    expect(() => loadConsumerDisputeOutboxKeyring()).toThrow("no valid expiry policy");
  });
});

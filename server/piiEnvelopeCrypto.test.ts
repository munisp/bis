import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptPiiEnvelope, encryptPiiEnvelope, loadPiiEnvelopeKeyring, piiAad, piiBlindIndex } from "./piiEnvelopeCrypto";

const tracked = [
  "BIS_PII_ACTIVE_KEY_VERSION", "BIS_PII_KEYRING", "BIS_PII_BLIND_INDEX_ACTIVE_KEY_VERSION",
  "BIS_PII_BLIND_INDEX_KEYRING", "BIS_PII_KEY_EXPIRIES_JSON", "BIS_PII_ENFORCE_KEY_EXPIRY",
] as const;
const original = new Map(tracked.map((key) => [key, process.env[key]]));

function configure(expiry = "2035-01-01T00:00:00.000Z"): void {
  const dataKey = randomBytes(32).toString("base64");
  const blindKey = randomBytes(32).toString("base64");
  process.env.BIS_PII_ACTIVE_KEY_VERSION = "pii-2026-01";
  process.env.BIS_PII_KEYRING = `pii-2026-01:${dataKey}`;
  process.env.BIS_PII_BLIND_INDEX_ACTIVE_KEY_VERSION = "blind-2026-01";
  process.env.BIS_PII_BLIND_INDEX_KEYRING = `blind-2026-01:${blindKey}`;
  process.env.BIS_PII_KEY_EXPIRIES_JSON = JSON.stringify({ "pii-2026-01": expiry, "blind-2026-01": expiry });
  process.env.BIS_PII_ENFORCE_KEY_EXPIRY = "true";
}

afterEach(() => {
  for (const key of tracked) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe("tenant-bound PII envelopes", () => {
  it("encrypts with AES-256-GCM and decrypts only using the exact tenant-bound AAD", () => {
    configure();
    const keyring = loadPiiEnvelopeKeyring(new Date("2026-01-01T00:00:00.000Z"));
    const aad = piiAad(17, "candidate_profile", 42, "identity");
    const payload = { nin: "12345678901", dob: "1990-01-01" };
    const encrypted = encryptPiiEnvelope(keyring, aad, payload);

    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.ciphertext.length).toBeGreaterThan(16);
    expect(encrypted.plaintextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptPiiEnvelope(keyring, aad, encrypted)).toEqual(payload);
    expect(() => decryptPiiEnvelope(keyring, piiAad(18, "candidate_profile", 42, "identity"), encrypted)).toThrow("PII envelope authentication failed");
  });

  it("rejects ciphertext tampering and produces fresh nonces", () => {
    configure();
    const keyring = loadPiiEnvelopeKeyring(new Date("2026-01-01T00:00:00.000Z"));
    const aad = piiAad(17, "criminal_record", 9, "criminal_record");
    const first = encryptPiiEnvelope(keyring, aad, { offense: "fraud" });
    const second = encryptPiiEnvelope(keyring, aad, { offense: "fraud" });
    const tampered = { ...first, ciphertext: Buffer.from(first.ciphertext) };
    tampered.ciphertext[0] ^= 0x01;

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(() => decryptPiiEnvelope(keyring, aad, tampered)).toThrow("PII envelope authentication failed");
  });

  it("fails closed for expired encryption or blind-index key material", () => {
    configure("2025-12-31T23:59:59.000Z");
    expect(() => loadPiiEnvelopeKeyring(new Date("2026-01-01T00:00:00.000Z"))).toThrow("lacks a valid future expiry");
  });

  it("uses a separate keyed deterministic blind index", () => {
    configure();
    const keyring = loadPiiEnvelopeKeyring(new Date("2026-01-01T00:00:00.000Z"));
    const first = piiBlindIndex(keyring, "12345678901");
    const second = piiBlindIndex(keyring, "12345678901");
    const different = piiBlindIndex(keyring, "12345678902");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });
});

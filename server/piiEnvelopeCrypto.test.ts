import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertTransitKeyReference, decryptPiiEnvelope, encryptPiiEnvelope, piiAad, piiBlindIndex } from "./piiEnvelopeCrypto";
import { VaultTransitClient, type VaultTransitConfig } from "./vaultTransit";

const config: VaultTransitConfig = { address: new URL("https://vault.internal.example"), token: "test-token", mount: "transit", timeoutMs: 1000 };
const encryptionKey = { keyVersion: "pii-2026-01", externalKeyRef: "vault-transit://transit/tenant-17-pii", providerKeyVersion: 7 };
const blindKey = { keyVersion: "blind-2026-01", externalKeyRef: "vault-transit://transit/tenant-17-blind", providerKeyVersion: 5 };

function client(metadataOverrides: Record<string, unknown> = {}): VaultTransitClient {
  const values = new Map<string, { plaintext: string; context: string }>();
  let counter = 0;
  const fakeFetch = async (raw: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = typeof raw === "string" ? new URL(raw) : raw instanceof URL ? raw : new URL(raw.url);
    const path = url.pathname;
    if (init?.method === "GET" && path.includes("/keys/")) {
      const name = decodeURIComponent(path.split("/").at(-1)!);
      const isBlind = name.includes("blind");
      return Response.json({ data: { name, type: isBlind ? "hmac" : "aes256-gcm96", derived: true, exportable: false, allow_plaintext_backup: false, latest_version: isBlind ? 5 : 7, min_decryption_version: 1, supports_encryption: !isBlind, supports_decryption: !isBlind, supports_derivation: true, ...metadataOverrides } });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { plaintext?: string; ciphertext?: string; context?: string; input?: string };
    if (path.includes("/encrypt/")) {
      const ciphertext = `vault:v7:${Buffer.from(`cipher-${++counter}`).toString("base64")}`;
      values.set(ciphertext, { plaintext: body.plaintext!, context: body.context! });
      return Response.json({ data: { ciphertext, key_version: 7 } });
    }
    if (path.includes("/decrypt/")) {
      const stored = values.get(body.ciphertext ?? "");
      if (!stored || stored.context !== body.context) return Response.json({ errors: ["invalid ciphertext or context"] }, { status: 400 });
      return Response.json({ data: { plaintext: stored.plaintext } });
    }
    if (path.includes("/hmac/")) {
      const digest = createHash("sha256").update(`${body.context}|${body.input}`).digest("base64");
      return Response.json({ data: { hmac: `vault:v5:hmac:${digest}` } });
    }
    if (path.includes("/rewrap/")) return Response.json({ data: { ciphertext: body.ciphertext, key_version: 7 } });
    return Response.json({ errors: ["unexpected path"] }, { status: 404 });
  };
  return new VaultTransitClient(config, fakeFetch as typeof fetch);
}

describe("tenant-aware Vault Transit PII envelopes", () => {
  it("encrypts through Transit and decrypts only with the exact tenant-bound derivation context", async () => {
    const transit = client();
    const aad = piiAad(17, "candidate_profile", 42, "identity");
    const payload = { nin: "12345678901", dob: "1990-01-01" };
    const encrypted = await encryptPiiEnvelope(encryptionKey, aad, payload, transit);

    expect(encrypted.cryptoProvider).toBe("vault_transit");
    expect(encrypted.nonce).toBeNull();
    expect(encrypted.providerKeyVersion).toBe(7);
    expect(encrypted.plaintextSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(decryptPiiEnvelope(encryptionKey, aad, encrypted, transit)).resolves.toEqual(payload);
    await expect(decryptPiiEnvelope(encryptionKey, piiAad(18, "candidate_profile", 42, "identity"), encrypted, transit)).rejects.toThrow("Vault Transit cryptographic operation was rejected or unavailable");
  });

  it("fails closed when ciphertext is altered or the live provider version drifts from the tenant registry", async () => {
    const transit = client();
    const encrypted = await encryptPiiEnvelope(encryptionKey, piiAad(17, "criminal_record", 9, "criminal_record"), { offense: "fraud" }, transit);
    await expect(decryptPiiEnvelope(encryptionKey, piiAad(17, "criminal_record", 9, "criminal_record"), { ...encrypted, ciphertext: Buffer.from("vault:v7:YWx0ZXJlZA==") }, transit)).rejects.toThrow();
    await expect(encryptPiiEnvelope({ ...encryptionKey, providerKeyVersion: 6 }, piiAad(17, "criminal_record", 9, "criminal_record"), { offense: "fraud" }, transit)).rejects.toThrow("differs from the approved tenant registry version");
  });

  it("rejects Vault metadata that permits plaintext export or lacks required derivation", async () => {
    await expect(assertTransitKeyReference(client({ exportable: true }), encryptionKey, "encryption")).rejects.toThrow("non-exportable derived aes256-gcm96");
    await expect(assertTransitKeyReference(client({ derived: false }), blindKey, "blind_index")).rejects.toThrow("non-exportable derived HMAC");
  });

  it("uses a tenant- and attribute-bound Vault HMAC blind index without local HMAC key material", async () => {
    const transit = client();
    const first = await piiBlindIndex(blindKey, 17, "nin", "12345678901", transit);
    const second = await piiBlindIndex(blindKey, 17, "nin", "12345678901", transit);
    const otherTenant = await piiBlindIndex(blindKey, 18, "nin", "12345678901", transit);
    const otherAttribute = await piiBlindIndex(blindKey, 17, "bvn", "12345678901", transit);

    expect(first.cryptoProvider).toBe("vault_transit");
    expect(first.normalizedHmac).toMatch(/^vault:v5:hmac:/);
    expect(first.normalizedHmac).toBe(second.normalizedHmac);
    expect(first.normalizedHmac).not.toBe(otherTenant.normalizedHmac);
    expect(first.normalizedHmac).not.toBe(otherAttribute.normalizedHmac);
  });
});

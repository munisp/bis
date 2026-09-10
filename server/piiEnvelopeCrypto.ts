import { createHash, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { loadVaultTransitClient, parseVaultTransitRef, VaultTransitClient } from "./vaultTransit";

export type SubjectKind = "candidate_profile" | "criminal_record";
export type BlindAttribute = "nin" | "bvn" | "passport_number" | "email" | "phone";
export type TransitKeyReference = { keyVersion: string; externalKeyRef: string; providerKeyVersion: number };
export type PiiEnvelope = {
  ciphertext: Buffer;
  nonce: null;
  keyVersion: string;
  providerKeyVersion: number;
  plaintextSha256: string;
  cryptoProvider: "vault_transit";
};
export type PiiBlindIndex = { normalizedHmac: string; keyVersion: string; providerKeyVersion: number; cryptoProvider: "vault_transit" };

function unavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function encodedJson(value: Record<string, unknown>): Buffer {
  const encoded = Buffer.from(JSON.stringify(value));
  if (!encoded.length || encoded.length > 1_000_000) unavailable("PII envelope plaintext is invalid or exceeds the approved size limit.");
  return encoded;
}

function parsePlaintext(value: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("PII envelope plaintext is invalid.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    unavailable("PII envelope plaintext is invalid.");
  }
}

function vaultKey(client: VaultTransitClient, key: TransitKeyReference): string {
  if (!key.keyVersion.trim() || !key.externalKeyRef.trim()) unavailable("PII Transit key reference is invalid.");
  return parseVaultTransitRef(key.externalKeyRef, client.mount).keyName;
}

export function piiAad(tenantId: number, subjectKind: SubjectKind, subjectId: number, purpose: string): string {
  if (!Number.isInteger(tenantId) || tenantId < 1 || !Number.isInteger(subjectId) || subjectId < 1 || !/^[a-z0-9:_-]{1,128}$/i.test(purpose)) {
    unavailable("PII authenticated-data binding is invalid.");
  }
  return `bis-pii-envelope:v2|${tenantId}|${subjectKind}|${subjectId}|${purpose}`;
}

export function piiBlindIndexContext(tenantId: number, attribute: BlindAttribute): string {
  if (!Number.isInteger(tenantId) || tenantId < 1) unavailable("PII blind-index context is invalid.");
  return `bis-pii-blind-index:v1|${tenantId}|${attribute}`;
}

export async function assertTransitKeyReference(client: VaultTransitClient, key: TransitKeyReference, kind: "encryption" | "blind_index"): Promise<void> {
  const name = vaultKey(client, key);
  const metadata = kind === "encryption" ? await client.assertDerivedAes256Gcm(name) : await client.assertDerivedHmac(name);
  if (metadata.latestVersion !== key.providerKeyVersion) unavailable("Vault Transit key metadata differs from the approved tenant registry version.");
}

export async function encryptPiiEnvelope(key: TransitKeyReference, aad: string, plaintext: Record<string, unknown>, client = loadVaultTransitClient()): Promise<PiiEnvelope> {
  const encoded = encodedJson(plaintext);
  const keyName = vaultKey(client, key);
  const encrypted = await client.encrypt(keyName, aad, encoded);
  if (encrypted.keyVersion !== key.providerKeyVersion) unavailable("Vault Transit encryption key version differs from the approved tenant registry version.");
  return {
    ciphertext: Buffer.from(encrypted.ciphertext, "utf8"),
    nonce: null,
    keyVersion: key.keyVersion,
    providerKeyVersion: encrypted.keyVersion,
    plaintextSha256: createHash("sha256").update(encoded).digest("hex"),
    cryptoProvider: "vault_transit",
  };
}

export async function decryptPiiEnvelope(key: TransitKeyReference, aad: string, encrypted: { ciphertext: Buffer; keyVersion: string; cryptoProvider?: string }, client = loadVaultTransitClient()): Promise<Record<string, unknown>> {
  if (encrypted.cryptoProvider && encrypted.cryptoProvider !== "vault_transit") unavailable("PII envelope does not use the configured Vault Transit provider.");
  if (encrypted.keyVersion !== key.keyVersion) unavailable("PII envelope key version does not match its registry reference.");
  const ciphertext = encrypted.ciphertext.toString("utf8");
  const decoded = await client.decrypt(vaultKey(client, key), aad, ciphertext);
  return parsePlaintext(decoded);
}

export async function piiBlindIndex(key: TransitKeyReference, tenantId: number, attribute: BlindAttribute, normalizedValue: string, client = loadVaultTransitClient()): Promise<PiiBlindIndex> {
  if (!normalizedValue || normalizedValue.length > 512) unavailable("PII blind-index input is invalid.");
  const result = await client.hmac(vaultKey(client, key), piiBlindIndexContext(tenantId, attribute), normalizedValue);
  if (result.keyVersion !== key.providerKeyVersion) unavailable("Vault Transit blind-index key version differs from the approved tenant registry version.");
  return { normalizedHmac: result.hmac, keyVersion: key.keyVersion, providerKeyVersion: result.keyVersion, cryptoProvider: "vault_transit" };
}

export function constantTimeDigestMatches(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

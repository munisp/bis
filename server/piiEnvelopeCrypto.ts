import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type PiiEnvelopeKeyring = { activeVersion: string; blindIndexVersion: string; keys: Map<string, Buffer>; expiries: Map<string, Date>; blindIndexKeys: Map<string, Buffer> };
export type PiiEnvelope = { ciphertext: Buffer; nonce: Buffer; keyVersion: string; plaintextSha256: string };

function unavailable(message: string): never { throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message }); }
function parseKeyring(raw: string, label: string): Map<string, Buffer> {
  const values = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const [version, material, ...rest] = entry.trim().split(":");
    if (!version || !material || rest.length || values.has(version)) unavailable(`${label} keyring is invalid.`);
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) unavailable(`${label} keys must be 32-byte base64 values.`);
    values.set(version, key);
  }
  return values;
}

export function loadPiiEnvelopeKeyring(now = new Date()): PiiEnvelopeKeyring {
  const activeVersion = (process.env.BIS_PII_ACTIVE_KEY_VERSION ?? "").trim();
  const keyringRaw = (process.env.BIS_PII_KEYRING ?? "").trim();
  const blindIndexVersion = (process.env.BIS_PII_BLIND_INDEX_ACTIVE_KEY_VERSION ?? "").trim();
  const blindIndexRaw = (process.env.BIS_PII_BLIND_INDEX_KEYRING ?? "").trim();
  const expiryRaw = (process.env.BIS_PII_KEY_EXPIRIES_JSON ?? "").trim();
  if (!activeVersion || !keyringRaw || !blindIndexVersion || !blindIndexRaw) unavailable("PII envelope encryption keyrings are not configured.");
  const keys = parseKeyring(keyringRaw, "PII envelope");
  const blindIndexKeys = parseKeyring(blindIndexRaw, "PII blind-index");
  if (!keys.has(activeVersion) || !blindIndexKeys.has(blindIndexVersion)) unavailable("Active PII key version is absent from its keyring.");
  let parsed: unknown;
  try { parsed = JSON.parse(expiryRaw); } catch { unavailable("PII key expiry policy is invalid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("PII key expiry policy must be an object.");
  const expiries = new Map<string, Date>();
  for (const [version, value] of Object.entries(parsed)) {
    if (typeof value !== "string") unavailable("PII key expiry must be ISO-8601.");
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) unavailable("PII key expiry is invalid.");
    expiries.set(version, expiry);
  }
  if (ENV.isProduction || process.env.BIS_PII_ENFORCE_KEY_EXPIRY === "true") {
    keys.forEach((_key, version) => { const expiry = expiries.get(version); if (!expiry || expiry <= now) unavailable(`PII encryption key '${version}' lacks a valid future expiry.`); });
    blindIndexKeys.forEach((_key, version) => { const expiry = expiries.get(version); if (!expiry || expiry <= now) unavailable(`PII blind-index key '${version}' lacks a valid future expiry.`); });
  }
  return { activeVersion, blindIndexVersion, keys, expiries, blindIndexKeys };
}

export function piiAad(tenantId: number, subjectKind: "candidate_profile" | "criminal_record", subjectId: number, purpose: string): string {
  return `bis-pii-envelope:v1|${tenantId}|${subjectKind}|${subjectId}|${purpose}`;
}
export function encryptPiiEnvelope(keyring: PiiEnvelopeKeyring, aad: string, plaintext: Record<string, unknown>): PiiEnvelope {
  const nonce = randomBytes(NONCE_BYTES); const cipher = createCipheriv(ALGORITHM, keyring.keys.get(keyring.activeVersion)!, nonce);
  cipher.setAAD(Buffer.from(aad)); const encoded = Buffer.from(JSON.stringify(plaintext));
  const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: keyring.activeVersion, plaintextSha256: createHash("sha256").update(encoded).digest("hex") };
}
export function decryptPiiEnvelope(keyring: PiiEnvelopeKeyring, aad: string, encrypted: { ciphertext: Buffer; nonce: Buffer; keyVersion: string }): Record<string, unknown> {
  if (encrypted.nonce.length !== NONCE_BYTES || encrypted.ciphertext.length <= AUTH_TAG_BYTES) unavailable("PII envelope metadata is invalid.");
  const key = keyring.keys.get(encrypted.keyVersion); if (!key) unavailable("PII decryption key is unavailable.");
  try { const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(encrypted.ciphertext.subarray(-AUTH_TAG_BYTES)); const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(encrypted.ciphertext.subarray(0, -AUTH_TAG_BYTES)), decipher.final()]).toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("PII envelope plaintext is invalid."); return parsed as Record<string, unknown>; } catch (error) { if (error instanceof TRPCError) throw error; unavailable("PII envelope authentication failed."); }
}
export function piiBlindIndex(keyring: PiiEnvelopeKeyring, normalizedValue: string): string { return createHmac("sha256", keyring.blindIndexKeys.get(keyring.blindIndexVersion)!).update(normalizedValue).digest("hex"); }
export function constantTimeDigestMatches(a: string, b: string): boolean { if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false; return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }

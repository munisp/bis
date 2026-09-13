import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type InstitutionalOutboxKeyring = { activeVersion: string; keys: Map<string, Buffer>; expiries: Map<string, Date> };
export type EncryptedInstitutionalPayload = { ciphertext: Buffer; nonce: Buffer; keyVersion: string; algorithm: typeof ALGORITHM };

function unavailable(message: string): never { throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message }); }

export function loadInstitutionalOutboxKeyring(now = new Date()): InstitutionalOutboxKeyring {
  const activeVersion = (process.env.BIS_INSTITUTIONAL_OUTBOX_ACTIVE_KEY_VERSION ?? "").trim();
  const rawKeyring = (process.env.BIS_INSTITUTIONAL_OUTBOX_KEYRING ?? "").trim();
  const rawExpiries = (process.env.BIS_INSTITUTIONAL_OUTBOX_KEY_EXPIRIES_JSON ?? "").trim();
  const enforceExpiry = ENV.isProduction || process.env.BIS_INSTITUTIONAL_OUTBOX_ENFORCE_KEY_EXPIRY === "true";
  if (!activeVersion || !rawKeyring) unavailable("Institutional request outbox keyring is not configured");
  const keys = new Map<string, Buffer>();
  for (const entry of rawKeyring.split(",")) {
    const [version, material, ...rest] = entry.trim().split(":");
    if (!version || !material || rest.length || keys.has(version)) unavailable("Institutional request outbox keyring is invalid");
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) unavailable("Institutional request outbox keys must be 32-byte base64 values");
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) unavailable("Active institutional request outbox key is unavailable");
  const expiries = new Map<string, Date>();
  if (rawExpiries) {
    let decoded: unknown;
    try { decoded = JSON.parse(rawExpiries); } catch { unavailable("Institutional request outbox key expiry policy is invalid JSON"); }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) unavailable("Institutional request outbox key expiry policy is invalid");
    for (const [version, rawExpiry] of Object.entries(decoded)) {
      if (typeof rawExpiry !== "string") unavailable("Institutional request outbox key expiry is invalid");
      const expiry = new Date(rawExpiry);
      if (Number.isNaN(expiry.getTime())) unavailable("Institutional request outbox key expiry is invalid");
      expiries.set(version, expiry);
    }
  }
  if (enforceExpiry) {
    keys.forEach((_key, version) => {
      const expiry = expiries.get(version);
      if (!expiry || expiry <= now) unavailable(`Institutional request outbox key '${version}' has no active expiry policy`);
    });
  }
  return { activeVersion, keys, expiries };
}

export function institutionalOutboxAad(eventType: string, idempotencyKey: string): string {
  return `institutional-request-outbox:v1|${eventType}|${idempotencyKey}`;
}

export function encryptInstitutionalPayload(keyring: InstitutionalOutboxKeyring, aad: string, payload: Record<string, unknown>): EncryptedInstitutionalPayload {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.keys.get(keyring.activeVersion)!, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: keyring.activeVersion, algorithm: ALGORITHM };
}

export function decryptInstitutionalPayload(keyring: InstitutionalOutboxKeyring, aad: string, payload: EncryptedInstitutionalPayload): Record<string, unknown> {
  if (payload.algorithm !== ALGORITHM || payload.nonce.length !== NONCE_BYTES || payload.ciphertext.length <= AUTH_TAG_BYTES) unavailable("Institutional request outbox ciphertext is invalid");
  const key = keyring.keys.get(payload.keyVersion);
  if (!key) unavailable("Institutional request outbox decryption key is unavailable");
  try {
    const body = payload.ciphertext.subarray(0, -AUTH_TAG_BYTES);
    const authTag = payload.ciphertext.subarray(-AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, payload.nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("Institutional request outbox plaintext is invalid");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    unavailable("Institutional request outbox payload authentication failed");
  }
}

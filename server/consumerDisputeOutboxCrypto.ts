import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type ConsumerDisputeOutboxKeyring = {
  activeVersion: string;
  keys: Map<string, Buffer>;
  expiries: Map<string, Date>;
};

export type EncryptedOutboxPayload = {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: string;
  algorithm: typeof ALGORITHM;
};

function unavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function requireCanonicalKeyExpiry(version: string, expiry: Date | undefined, now: Date): void {
  if (!expiry || Number.isNaN(expiry.getTime())) unavailable(`Consumer-dispute outbox key '${version}' has no valid expiry policy.`);
  if (expiry <= now) unavailable(`Consumer-dispute outbox key '${version}' is expired.`);
}

export function loadConsumerDisputeOutboxKeyring(now = new Date()): ConsumerDisputeOutboxKeyring {
  const activeVersion = (process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ACTIVE_KEY_VERSION ?? "").trim();
  const encoded = (process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEYRING ?? "").trim();
  const expiryJson = (process.env.BIS_CONSUMER_DISPUTE_OUTBOX_KEY_EXPIRIES_JSON ?? "").trim();
  const enforceExpiry = ENV.isProduction || process.env.BIS_CONSUMER_DISPUTE_OUTBOX_ENFORCE_KEY_EXPIRY === "true";
  if (!activeVersion || !encoded) unavailable("Consumer-dispute outbox keyring is not configured.");

  const keys = new Map<string, Buffer>();
  for (const entry of encoded.split(",")) {
    const [version, material, ...extra] = entry.trim().split(":");
    if (!version || !material || extra.length > 0 || keys.has(version)) unavailable("Consumer-dispute outbox keyring is invalid.");
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) unavailable("Consumer-dispute outbox keys must be 32-byte base64 values.");
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) unavailable("Active consumer-dispute outbox key is absent from the keyring.");

  const expiries = new Map<string, Date>();
  if (expiryJson) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(expiryJson);
    } catch {
      unavailable("Consumer-dispute outbox key expiry policy is invalid JSON.");
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) unavailable("Consumer-dispute outbox key expiry policy must be an object.");
    for (const [version, rawExpiry] of Object.entries(decoded)) {
      if (typeof rawExpiry !== "string") unavailable("Consumer-dispute outbox key expiry values must be ISO-8601 strings.");
      const expiry = new Date(rawExpiry);
      if (Number.isNaN(expiry.getTime())) unavailable("Consumer-dispute outbox key expiry is invalid.");
      expiries.set(version, expiry);
    }
  }
  if (enforceExpiry) {
    keys.forEach((_key, version) => requireCanonicalKeyExpiry(version, expiries.get(version), now));
  }
  return { activeVersion, keys, expiries };
}

export function encryptConsumerDisputeOutboxPayload(keyring: ConsumerDisputeOutboxKeyring, aad: string, payload: Record<string, unknown>): EncryptedOutboxPayload {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.keys.get(keyring.activeVersion)!, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: keyring.activeVersion, algorithm: ALGORITHM };
}

export function decryptConsumerDisputeOutboxPayload(keyring: ConsumerDisputeOutboxKeyring, aad: string, encrypted: EncryptedOutboxPayload): Record<string, unknown> {
  if (encrypted.algorithm !== ALGORITHM || encrypted.nonce.length !== NONCE_BYTES || encrypted.ciphertext.length <= AUTH_TAG_BYTES) {
    unavailable("Consumer-dispute outbox ciphertext metadata is invalid.");
  }
  const key = keyring.keys.get(encrypted.keyVersion);
  if (!key) unavailable("Consumer-dispute outbox decryption key is unavailable.");
  const ciphertext = encrypted.ciphertext.subarray(0, -AUTH_TAG_BYTES);
  const authTag = encrypted.ciphertext.subarray(-AUTH_TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("Consumer-dispute outbox payload is invalid.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    unavailable("Consumer-dispute outbox payload authentication failed.");
  }
}

export function consumerDisputeOutboxAad(eventType: string, idempotencyKey: string): string {
  return `consumer-dispute-outbox:v1|${eventType}|${idempotencyKey}`;
}

import { createDecipheriv } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { SubjectKind } from "./piiEnvelopeCrypto";

const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;

type LegacyKey = { version: string; material: Buffer };

function unavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function legacyKeys(): Map<string, Buffer> {
  if (process.env.BIS_PII_LEGACY_CUTOVER_CONFIRM !== "MIGRATE_LEGACY_PII_TO_VAULT_TRANSIT") {
    unavailable("Legacy PII decrypt is disabled without the explicit Vault Transit cutover confirmation.");
  }
  const raw = (process.env.BIS_PII_LEGACY_CUTOVER_KEYRING ?? "").trim();
  if (!raw) unavailable("Legacy PII cutover keyring is unavailable.");
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const [version, material, ...rest] = entry.trim().split(":");
    const key = Buffer.from(material ?? "", "base64");
    if (!version || rest.length || key.length !== 32 || keys.has(version)) unavailable("Legacy PII cutover keyring is invalid.");
    keys.set(version, key);
  }
  return keys;
}

function aad(tenantId: number, subjectKind: SubjectKind, subjectId: number, purpose: string): string {
  return `bis-pii-envelope:v1|${tenantId}|${subjectKind}|${subjectId}|${purpose}`;
}

export function decryptLegacyPiiEnvelope(input: { tenantId: number; subjectKind: SubjectKind; subjectId: number; purpose: string; keyVersion: string; ciphertext: Buffer; nonce: Buffer | null }): Record<string, unknown> {
  const key = legacyKeys().get(input.keyVersion);
  if (!key || !input.nonce || input.nonce.length !== NONCE_BYTES || input.ciphertext.length <= AUTH_TAG_BYTES) unavailable("Legacy PII envelope metadata or key is unavailable.");
  try {
    const body = input.ciphertext.subarray(0, -AUTH_TAG_BYTES);
    const tag = input.ciphertext.subarray(-AUTH_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, input.nonce);
    decipher.setAAD(Buffer.from(aad(input.tenantId, input.subjectKind, input.subjectId, input.purpose)));
    decipher.setAuthTag(tag);
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable("Legacy PII envelope plaintext is invalid.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    unavailable("Legacy PII envelope authentication failed during approved cutover.");
  }
}

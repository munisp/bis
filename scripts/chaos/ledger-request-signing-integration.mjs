#!/usr/bin/env node
import { createHmac, createHash } from "node:crypto";

const mode = process.argv[2];
if (!new Set(["baseline", "expect-replay-store-unavailable", "expect-replay-conflict"]).has(mode)) {
  throw new Error("usage: ledger-request-signing-integration.mjs <baseline|expect-replay-store-unavailable|expect-replay-conflict>");
}

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const url = required("BIS_CHAOS_LEDGER_URL");
const key = required("BIS_LEDGER_KEY");
const keyId = required("BIS_LEDGER_KEY_ID");
const tenantId = required("BIS_CHAOS_TENANT_ID");
const actorId = required("BIS_CHAOS_ACTOR_ID");
const path = `/ledger/balance/${tenantId}`;
const nonce = mode === "expect-replay-conflict"
  ? required("BIS_CHAOS_ACCEPTED_NONCE")
  : required("BIS_CHAOS_FRESH_NONCE");
const timestamp = Math.floor(Date.now() / 1000);
const body = "";
const bodyHash = createHash("sha256").update(body).digest("hex");
const canonical = [
  "BIS-LEDGER-HMAC-V2", "GET", path, keyId, tenantId, actorId, String(timestamp), nonce, bodyHash,
].join("\n");
const signature = createHmac("sha256", key).update(canonical).digest("hex");
const response = await fetch(new URL(path, url), {
  method: "GET",
  headers: {
    "x-bis-key-id": keyId,
    "x-bis-tenant-id": tenantId,
    "x-bis-actor-id": actorId,
    "x-bis-timestamp": String(timestamp),
    "x-bis-nonce": nonce,
    "x-bis-signature": signature,
  },
  signal: AbortSignal.timeout(5_000),
});

const expected = mode === "baseline" ? 200 : mode === "expect-replay-store-unavailable" ? 503 : 409;
if (response.status !== expected) {
  throw new Error(`expected HTTP ${expected} for ${mode}; received ${response.status}`);
}
if (mode === "baseline") {
  process.stdout.write(`BIS_CHAOS_ACCEPTED_NONCE=${nonce}\n`);
}

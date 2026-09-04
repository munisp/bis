#!/usr/bin/env node
/**
 * Verifies that an externally injected KES/Vault availability failure prevents
 * MinIO SSE-KMS evidence custody. This script never administers Vault, KES, or
 * MinIO; the fault is injected and reverted by an approved operator.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CONFIRMATION = "I_APPROVE_SYNTHETIC_ONPREM_KMS_FAULT_VERIFICATION";
const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1jAAAAABJRU5ErkJggg==",
  "base64",
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stagingUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("STAGING_BFF_URL must be a valid HTTPS URL"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host.includes("production") || host.startsWith("prod.") || host.endsWith(".prod")) {
    throw new Error("STAGING_BFF_URL must be an explicit non-production HTTPS endpoint");
  }
  return url;
}

function endpoint(baseUrl, path) {
  return new URL(path, `${baseUrl.origin}/`).toString();
}

async function json(response, operation) {
  const text = await response.text();
  if (!text) return { status: response.status, ok: response.ok, body: null };
  try { return { status: response.status, ok: response.ok, body: JSON.parse(text) }; }
  catch { throw new Error(`${operation} returned non-JSON HTTP ${response.status}`); }
}

async function saveReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const environment = required("BIS_ENV");
  const confirmation = required("BIS_ONPREM_KMS_FAULT_VERIFICATION_CONFIRMATION");
  const scenario = required("BIS_ONPREM_KMS_FAULT_SCENARIO");
  const injected = required("BIS_ONPREM_KMS_FAULT_INJECTED");
  const baseUrl = stagingUrl(required("STAGING_BFF_URL"));
  const token = required("STAGING_MOBILE_ACCESS_TOKEN");
  const kycRecordId = Number(required("STAGING_KYC_RECORD_ID"));
  const expectedKmsKeyId = required("STAGING_EXPECTED_KMS_KEY_ID");
  const retention = required("STAGING_DATA_RETENTION_CONFIRMED");

  if (environment !== "staging") throw new Error("BIS_ENV must equal staging");
  if (confirmation !== CONFIRMATION) throw new Error("explicit synthetic on-premises KMS fault-verification confirmation is required");
  if (scenario !== "vault-sealed" && scenario !== "kes-unreachable") throw new Error("BIS_ONPREM_KMS_FAULT_SCENARIO must be vault-sealed or kes-unreachable");
  if (injected !== scenario) throw new Error("BIS_ONPREM_KMS_FAULT_INJECTED must exactly match the selected externally injected scenario");
  if (!Number.isSafeInteger(kycRecordId) || kycRecordId <= 0) throw new Error("STAGING_KYC_RECORD_ID must be a positive integer");
  if (token.length < 16) throw new Error("STAGING_MOBILE_ACCESS_TOKEN is implausibly short");
  if (retention !== "synthetic-only-approved") throw new Error("STAGING_DATA_RETENTION_CONFIRMED must equal synthetic-only-approved");

  const reportPath = resolve(process.env.BIS_ONPREM_KMS_FAULT_REPORT_PATH ?? `artifacts/onprem-kms-fault/${randomUUID()}.json`);
  const sha256 = createHash("sha256").update(SYNTHETIC_PNG).digest("hex");
  const checksum = createHash("sha256").update(SYNTHETIC_PNG).digest("base64");
  const report = {
    environment: "staging",
    scenario,
    runId: randomUUID(),
    syntheticByteLength: SYNTHETIC_PNG.length,
    configurationBound: false,
    directPutRejected: false,
    custodyCompletionRejected: false,
    verifiedStatusObserved: false,
    completedAt: null,
  };

  try {
    // The BFF creates a short-lived presigned request. It must bind integrity
    // and key identity even during an availability-failure test.
    const initiated = await fetch(endpoint(baseUrl, "/api/kyc/documents/initiate"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        kycRecordId,
        documentType: "other",
        contentType: "image/png",
        contentLength: SYNTHETIC_PNG.length,
        sha256,
        description: "Synthetic on-premises KES/Vault fail-closed fixture",
        idempotencyKey: randomUUID(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const authorization = await json(initiated, "KYC upload initiation");
    if (!authorization.ok || !authorization.body?.uploadId || !authorization.body?.uploadUrl || !authorization.body?.headers) {
      throw new Error(`KYC upload initiation failed with HTTP ${authorization.status}`);
    }
    const headers = authorization.body.headers;
    if (
      headers["x-amz-checksum-sha256"] !== checksum
      || headers["x-amz-server-side-encryption"] !== "aws:kms"
      || headers["x-amz-server-side-encryption-aws-kms-key-id"] !== expectedKmsKeyId
      || new URL(authorization.body.uploadUrl).protocol !== "https:"
    ) throw new Error("BFF did not bind HTTPS SHA-256 and the expected SSE-KMS key to the fault-verification upload");
    report.configurationBound = true;

    const directPut = await fetch(authorization.body.uploadUrl, {
      method: "PUT",
      headers,
      body: SYNTHETIC_PNG,
      signal: AbortSignal.timeout(30_000),
    });
    if (directPut.ok) throw new Error(`FAIL-OPEN: MinIO accepted an SSE-KMS upload while ${scenario} was injected (HTTP ${directPut.status})`);
    report.directPutRejected = true;

    const completion = await fetch(endpoint(baseUrl, `/api/kyc/documents/${encodeURIComponent(authorization.body.uploadId)}/complete`), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    const custody = await json(completion, "KYC custody completion");
    if (custody.ok || custody.body?.status === "verified") {
      report.verifiedStatusObserved = custody.body?.status === "verified";
      throw new Error(`FAIL-OPEN: custody completion accepted the unavailable-KMS upload with HTTP ${custody.status}`);
    }
    report.custodyCompletionRejected = true;
    report.completedAt = new Date().toISOString();
    await saveReport(reportPath, report);
    process.stdout.write(`PASS MinIO/KES fail-closed verification for ${scenario}; report=${reportPath}\n`);
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.failure = error instanceof Error ? error.message : "unknown failure";
    await saveReport(reportPath, report).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL MinIO/KES fail-closed verification: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Staging-only direct-upload acceptance test.
 *
 * The runner makes no object-store API call with static credentials. It uses the
 * BFF's authenticated presigned KYC upload authorization, tests that the signed
 * SHA-256 checksum rejects substituted bytes, then verifies a correct synthetic
 * upload through the BFF custody completion API.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CONFIRMATION = "I_APPROVE_NON_PRODUCTION_SSE_KMS_ACCEPTANCE";
const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1jAAAAABJRU5ErkJggg==",
  "base64",
);

function fail(message) {
  throw new Error(message);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function stagingUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("STAGING_BFF_URL must be a valid HTTPS URL");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https" || host.includes("production") || host.startsWith("prod.") || host.endsWith(".prod")) {
    fail("STAGING_BFF_URL must be an explicit non-production HTTPS endpoint");
  }
  return url;
}

function endpoint(baseUrl, path) {
  return new URL(path, `${baseUrl.origin}/`).toString();
}

async function responseJson(response, operation) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      fail(`${operation} returned non-JSON HTTP ${response.status}`);
    }
  }
  return { ok: response.ok, status: response.status, body };
}

async function initiate(baseUrl, token, kycRecordId, idempotencyKey, sha256) {
  const response = await fetch(endpoint(baseUrl, "/api/kyc/documents/initiate"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      kycRecordId,
      documentType: "other",
      contentType: "image/png",
      contentLength: SYNTHETIC_PNG.length,
      sha256,
      description: "Synthetic non-PII SSE-KMS checksum acceptance fixture",
      idempotencyKey,
    }),
  });
  const result = await responseJson(response, "KYC upload initiation");
  if (result.status !== 201 || !result.body || typeof result.body.uploadId !== "string" || typeof result.body.uploadUrl !== "string" || !result.body.headers) {
    fail(`KYC upload initiation failed with HTTP ${result.status}`);
  }
  return result.body;
}

function assertSignedHeaders(authorization, sha256, expectedKmsKeyId) {
  const expectedChecksum = createHash("sha256").update(SYNTHETIC_PNG).digest("base64");
  const headers = authorization.headers;
  if (
    headers["content-type"] !== "image/png"
    || headers["x-amz-meta-kyc-upload-id"] !== authorization.uploadId
    || headers["x-amz-meta-sha256"] !== sha256
    || headers["x-amz-checksum-sha256"] !== expectedChecksum
    || headers["x-amz-server-side-encryption"] !== "aws:kms"
    || headers["x-amz-server-side-encryption-aws-kms-key-id"] !== expectedKmsKeyId
  ) {
    fail("The BFF upload authorization did not bind checksum, identity metadata, SSE-KMS, and the expected KMS key");
  }
  const uploadUrl = new URL(authorization.uploadUrl);
  if (uploadUrl.protocol !== "https:") fail("The signed object upload URL must use HTTPS");
}

async function complete(baseUrl, token, uploadId) {
  const response = await fetch(endpoint(baseUrl, `/api/kyc/documents/${encodeURIComponent(uploadId)}/complete`), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  return responseJson(response, "KYC custody completion");
}

async function saveReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const values = {
    environment: required("BIS_ENV"),
    confirmation: required("BIS_STAGING_CONFIRMATION"),
    bffUrl: required("STAGING_BFF_URL"),
    token: required("STAGING_MOBILE_ACCESS_TOKEN"),
    kycRecordId: required("STAGING_KYC_RECORD_ID"),
    expectedKmsKeyId: required("STAGING_EXPECTED_KMS_KEY_ID"),
    retention: required("STAGING_DATA_RETENTION_CONFIRMED"),
  };
  if (values.environment !== "staging") fail("BIS_ENV must equal staging");
  if (values.confirmation !== CONFIRMATION) fail("BIS_STAGING_CONFIRMATION does not authorize this non-production acceptance test");
  if (values.retention !== "synthetic-only-approved") fail("STAGING_DATA_RETENTION_CONFIRMED must equal synthetic-only-approved");
  if (values.token.length < 16) fail("STAGING_MOBILE_ACCESS_TOKEN is implausibly short");
  const kycRecordId = Number(values.kycRecordId);
  if (!Number.isSafeInteger(kycRecordId) || kycRecordId <= 0) fail("STAGING_KYC_RECORD_ID must be a positive integer");
  const baseUrl = stagingUrl(values.bffUrl);
  const reportPath = resolve(process.env.BIS_STAGING_REPORT_PATH ?? `artifacts/staging-sse-kms/${randomUUID()}.json`);
  const digest = createHash("sha256").update(SYNTHETIC_PNG).digest("hex");
  const report = {
    environment: "staging",
    runId: randomUUID(),
    syntheticByteLength: SYNTHETIC_PNG.length,
    checksumHeaderBound: false,
    unauthenticatedInitiationDenied: false,
    substitutedBytesRejected: false,
    substitutedCompletionRejected: false,
    correctBytesUploaded: false,
    sseKmsCustodyVerified: false,
    completedAt: null,
  };

  try {
    // The negative authorization call intentionally carries no token.
    const anonymous = await fetch(endpoint(baseUrl, "/api/kyc/documents/initiate"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kycRecordId, documentType: "other", contentType: "image/png", contentLength: SYNTHETIC_PNG.length, sha256: digest, description: "Synthetic non-PII test fixture", idempotencyKey: randomUUID() }),
    });
    if (anonymous.status !== 401 && anonymous.status !== 403) fail(`Unauthenticated KYC initiation returned HTTP ${anonymous.status}, expected 401 or 403`);
    report.unauthenticatedInitiationDenied = true;

    // First authorization: same length, deliberately different bytes. A strict
    // S3-compatible implementation must reject the signed checksum mismatch.
    const negative = await initiate(baseUrl, values.token, kycRecordId, randomUUID(), digest);
    assertSignedHeaders(negative, digest, values.expectedKmsKeyId);
    report.checksumHeaderBound = true;
    const substituted = Buffer.from(SYNTHETIC_PNG);
    substituted[0] ^= 0x01;
    const negativePut = await fetch(negative.uploadUrl, { method: "PUT", headers: negative.headers, body: substituted });
    if (negativePut.ok) {
      const rejected = await complete(baseUrl, values.token, negative.uploadId);
      report.substitutedCompletionRejected = !rejected.ok;
      fail("The object store accepted substituted bytes under the signed SHA-256 checksum header");
    }
    report.substitutedBytesRejected = true;

    // Second authorization: correct bytes. Completion requests HeadObject with
    // ChecksumMode=ENABLED and verifies the returned S3 checksum plus SSE-KMS.
    const positive = await initiate(baseUrl, values.token, kycRecordId, randomUUID(), digest);
    assertSignedHeaders(positive, digest, values.expectedKmsKeyId);
    const positivePut = await fetch(positive.uploadUrl, { method: "PUT", headers: positive.headers, body: SYNTHETIC_PNG });
    if (!positivePut.ok) fail(`Correct synthetic direct upload failed with HTTP ${positivePut.status}`);
    report.correctBytesUploaded = true;
    const completed = await complete(baseUrl, values.token, positive.uploadId);
    if (!completed.ok || completed.body?.status !== "verified") fail(`BFF custody completion did not verify the SSE-KMS object (HTTP ${completed.status})`);
    report.sseKmsCustodyVerified = true;
    report.completedAt = new Date().toISOString();
    await saveReport(reportPath, report);
    process.stdout.write(`PASS staging SSE-KMS checksum acceptance; report=${reportPath}\n`);
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.failure = error instanceof Error ? error.message : "unknown failure";
    await saveReport(reportPath, report).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL staging SSE-KMS checksum acceptance: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
});

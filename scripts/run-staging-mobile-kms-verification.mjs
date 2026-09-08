#!/usr/bin/env node
/**
 * Non-production physical-device and SSE-KMS acceptance gate.
 *
 * The device-lab test runner must execute runSecureSessionDeviceProbe() in an
 * isolated Android/iOS staging profile and save its returned JSON to
 * STAGING_DEVICE_ATTESTATION_FILE. This script validates that artifact before
 * performing a synthetic direct KYC upload. It deliberately refuses to run
 * without explicit approval and a staging-only HTTPS endpoint.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const confirmation = 'I_APPROVE_NON_PRODUCTION_MOBILE_KMS_TESTS';
const maxAttestationAgeMs = 30 * 60 * 1000;
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1jAAAAABJRU5ErkJggg==',
  'base64',
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exitCode = 2;
  throw new Error(message);
}

function parseHttpsStagingUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('STAGING_BFF_URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') fail('STAGING_BFF_URL must use HTTPS');
  const hostname = url.hostname.toLowerCase();
  if (hostname.includes('production') || hostname.startsWith('prod.') || hostname.endsWith('.prod')) {
    fail('STAGING_BFF_URL appears to reference production');
  }
  return url;
}

function apiUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.origin}/`).toString();
}

function assertDeviceAttestation(attestation) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    fail('STAGING_DEVICE_ATTESTATION_FILE must contain a JSON object');
  }
  if (attestation.platform !== 'android' && attestation.platform !== 'ios') {
    fail('The device attestation platform must be android or ios');
  }
  const generatedAt = Date.parse(String(attestation.generatedAt ?? ''));
  if (!Number.isFinite(generatedAt) || Math.abs(Date.now() - generatedAt) > maxAttestationAgeMs) {
    fail('The device attestation must be generated within the last 30 minutes');
  }
  const session = attestation.session;
  const requiredFlags = [
    'writeSucceeded',
    'survivedProcessRestart',
    'hardwareBacked',
    'deviceOnlyPolicyConfigured',
    'legacyServiceIsolated',
    'logoutCleared',
  ];
  if (!session || typeof session !== 'object' || requiredFlags.some((name) => session[name] !== true)) {
    fail('The physical-device Keychain/Keystore attestation did not satisfy every required session control');
  }
  if (JSON.stringify(attestation).match(/token|password|credential/i)) {
    fail('The device attestation must not contain credentials or session material');
  }
  return attestation.platform;
}

async function parseJsonResponse(response, operation) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${operation} returned non-JSON HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message.slice(0, 160) : 'no safe message supplied';
    throw new Error(`${operation} failed with HTTP ${response.status}: ${message}`);
  }
  return body;
}

function writeReport(reportPath, report) {
  return mkdir(dirname(reportPath), { recursive: true })
    .then(() => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }));
}

async function assertNegativeAuthorization(baseUrl, initiationPayload) {
  const response = await fetch(apiUrl(baseUrl, '/api/kyc/documents/initiate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(initiationPayload),
  });
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`unauthenticated KYC initiation must be denied with HTTP 401 or 403, received ${response.status}`);
  }
}

async function main() {
  const requiredEnv = [
    'BIS_ENV',
    'BIS_STAGING_CONFIRMATION',
    'STAGING_BFF_URL',
    'STAGING_MOBILE_ACCESS_TOKEN',
    'STAGING_KYC_RECORD_ID',
    'STAGING_DEVICE_ATTESTATION_FILE',
    'STAGING_EXPECTED_KMS_KEY_ID',
    'STAGING_DATA_RETENTION_CONFIRMED',
  ];
  let values;
  try {
    values = Object.fromEntries(requiredEnv.map((name) => [name, required(name)]));
  } catch (error) {
    fail(error.message);
  }
  if (values.BIS_ENV !== 'staging') fail('BIS_ENV must be staging');
  if (values.BIS_STAGING_CONFIRMATION !== confirmation) fail('explicit non-production native-client/KMS confirmation is required');
  if (values.STAGING_DATA_RETENTION_CONFIRMED !== 'synthetic-only-approved') {
    fail('STAGING_DATA_RETENTION_CONFIRMED must be synthetic-only-approved');
  }
  const kycRecordId = Number(values.STAGING_KYC_RECORD_ID);
  if (!Number.isSafeInteger(kycRecordId) || kycRecordId <= 0) fail('STAGING_KYC_RECORD_ID must be a positive integer');
  if (values.STAGING_MOBILE_ACCESS_TOKEN.length < 16) fail('STAGING_MOBILE_ACCESS_TOKEN is implausibly short');

  const baseUrl = parseHttpsStagingUrl(values.STAGING_BFF_URL);
  let attestation;
  try {
    attestation = JSON.parse(await readFile(resolve(values.STAGING_DEVICE_ATTESTATION_FILE), 'utf8'));
  } catch {
    fail('STAGING_DEVICE_ATTESTATION_FILE cannot be read as JSON');
  }
  const platform = assertDeviceAttestation(attestation);

  const runId = randomUUID();
  const reportPath = resolve(process.env.BIS_STAGING_REPORT_PATH ?? `artifacts/mobile-kms-staging/${runId}.json`);
  const workDir = await mkdtemp(join(tmpdir(), 'bis-staging-kyc-'));
  const fixturePath = join(workDir, 'synthetic-staging-document.png');
  const sha256 = createHash('sha256').update(transparentPng).digest('hex');
  const initiationPayload = {
    kycRecordId,
    documentType: 'other',
    contentType: 'image/png',
    contentLength: transparentPng.length,
    sha256,
    description: 'Synthetic non-PII staging KYC encryption verification fixture',
    idempotencyKey: runId,
  };
  const report = {
    runId,
    completedAt: null,
    environment: 'staging',
    platform,
    deviceSessionPersistence: 'passed',
    unauthenticatedInitiationDenied: false,
    directSseKmsUpload: false,
    serverCustodyVerification: false,
  };

  try {
    await assertNegativeAuthorization(baseUrl, initiationPayload);
    report.unauthenticatedInitiationDenied = true;

    const initiatedResponse = await fetch(apiUrl(baseUrl, '/api/kyc/documents/initiate'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${values.STAGING_MOBILE_ACCESS_TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(initiationPayload),
    });
    if (initiatedResponse.status !== 201) {
      await parseJsonResponse(initiatedResponse, 'authenticated KYC initiation');
      throw new Error(`authenticated KYC initiation returned HTTP ${initiatedResponse.status}`);
    }
    const initiated = await parseJsonResponse(initiatedResponse, 'authenticated KYC initiation');
    if (typeof initiated.uploadId !== 'string' || typeof initiated.uploadUrl !== 'string' || !initiated.headers || typeof initiated.headers !== 'object') {
      throw new Error('KYC initiation response omitted the required upload authorization');
    }
    const uploadUrl = new URL(initiated.uploadUrl);
    if (uploadUrl.protocol !== 'https:') throw new Error('The direct object upload URL must use HTTPS');
    const headers = initiated.headers;
    if (
      headers['content-type'] !== 'image/png' ||
      headers['x-amz-meta-kyc-upload-id'] !== initiated.uploadId ||
      headers['x-amz-meta-sha256'] !== sha256 ||
      headers['x-amz-server-side-encryption'] !== 'aws:kms' ||
      headers['x-amz-server-side-encryption-aws-kms-key-id'] !== values.STAGING_EXPECTED_KMS_KEY_ID
    ) {
      throw new Error('The direct upload authorization does not bind the expected SSE-KMS metadata and KMS key');
    }

    await writeFile(fixturePath, transparentPng, { mode: 0o600 });
    const uploaded = await fetch(uploadUrl, { method: 'PUT', headers, body: await readFile(fixturePath) });
    if (!uploaded.ok) throw new Error(`direct SSE-KMS object upload failed with HTTP ${uploaded.status}`);
    report.directSseKmsUpload = true;

    const completedResponse = await fetch(apiUrl(baseUrl, `/api/kyc/documents/${encodeURIComponent(initiated.uploadId)}/complete`), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${values.STAGING_MOBILE_ACCESS_TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
    });
    const completed = await parseJsonResponse(completedResponse, 'KYC custody completion');
    if (completed.status !== 'verified') throw new Error('KYC custody completion did not return verified status');
    report.serverCustodyVerification = true;
    report.completedAt = new Date().toISOString();
    await writeReport(reportPath, report);
    process.stdout.write(`PASS staging native-client Keychain/Keystore and SSE-KMS verification; report=${reportPath}\n`);
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.failure = error instanceof Error ? error.message : 'unknown failure';
    await writeReport(reportPath, report).catch(() => undefined);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL staging native-client/KMS verification: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = process.exitCode || 1;
});

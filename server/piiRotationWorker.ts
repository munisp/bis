import { getPgPool } from "./db";
import { decryptPiiEnvelope, encryptPiiEnvelope, piiAad, piiBlindIndex, type BlindAttribute, type SubjectKind } from "./piiEnvelopeCrypto";
import { decryptLegacyPiiEnvelope } from "./piiLegacyCutover";
import { appendPiiForensicAuditEvent } from "./piiForensicAudit";
import { tenantBlindIndexRegistryById, tenantEncryptionRegistryById } from "./piiKeyRegistry";
import { loadVaultTransitClient } from "./vaultTransit";
import { beginTenantTransaction } from "./tenantRls";
import { piiRotationDispatchQueueAgeSeconds, piiRotationDispatchTotal, piiRotationTenantScopeMismatchTotal, piiRotationWorkerFailuresTotal, recordRlsPolicyDenial } from "./piiRlsMetrics";

const LEASE_SECONDS = 300;
const WORKER_VERSION = "pii-rotation-v1";

const DISPATCH_MAX_ATTEMPTS = 12;
const DISPATCH_ATTEMPTS_EXHAUSTED = "PII_ROTATION_ATTEMPTS_EXHAUSTED";

type RotationJob = {
  id: string;
  rotation_ref: string;
  tenant_id: number;
  source_encryption_key_registry_id: number;
  target_encryption_key_registry_id: number;
  source_blind_index_key_registry_id: number | null;
  target_blind_index_key_registry_id: number | null;
  compromise_incident_id: string | null;
  mode: "transit_rewrap" | "transit_reencrypt" | "legacy_cutover";
  dry_run: boolean;
  max_batch_size: number;
  requested_by: number;
};
type PlannedItem = {
  id: number;
  envelope_id: string;
  tenant_id: number;
  subject_kind: SubjectKind;
  subject_id: number;
  purpose: string;
  ciphertext: Buffer;
  nonce: Buffer | null;
  key_version: string;
  crypto_provider: "legacy_local_aes" | "vault_transit";
  provider_key_version: number | null;
};
type SourceRegistry = { id: number; tenant_id: number; key_version: string; external_key_ref: string; provider: "legacy_local_aes" | "vault_transit"; provider_key_name: string | null; provider_key_version: number | null; status: string };

export type PiiRotationWorkerResult = { leased: number; planned: number; rotated: number; skipped: number; failed: number; dryRuns: number };
export type PiiRotationTimingStage = "pool_checkout" | "tenant_context_setup";
export type PiiRotationTimingSample = { poolWaitingCount?: number; poolTotalCount?: number; poolIdleCount?: number };
export type PiiRotationTimingObserver = (stage: PiiRotationTimingStage, elapsedMs: number, sample?: PiiRotationTimingSample) => void;

function fail(message: string): never { throw new Error(message); }
export function checkoutFailureOutcome(error: unknown): "checkout_timeout" | "checkout_failed" {
  const message = error instanceof Error ? error.message : "";
  return /timeout|timed out/i.test(message) ? "checkout_timeout" : "checkout_failed";
}
async function observeLatency<T>(stage: PiiRotationTimingStage, observer: PiiRotationTimingObserver | undefined, work: () => Promise<T>, sample?: PiiRotationTimingSample): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    return await work();
  } finally {
    observer?.(stage, Number(process.hrtime.bigint() - started) / 1_000_000, sample);
  }
}
async function checkoutClient(pool: import("pg").Pool, observer?: PiiRotationTimingObserver): Promise<import("pg").PoolClient> {
  const sample: PiiRotationTimingSample = { poolWaitingCount: pool.waitingCount, poolTotalCount: pool.totalCount, poolIdleCount: pool.idleCount };
  try {
    return await observeLatency("pool_checkout", observer, () => pool.connect(), sample);
  } catch (error) {
    piiRotationDispatchTotal.inc({ outcome: checkoutFailureOutcome(error), component: "pii_rotation_worker" });
    throw error;
  }
}
async function beginScopedTenantTransaction(client: import("pg").PoolClient, tenantId: number, observer?: PiiRotationTimingObserver): Promise<void> {
  await observeLatency("tenant_context_setup", observer, () => beginTenantTransaction(client, tenantId));
}
function isProduction(): boolean { return process.env.NODE_ENV === "production" || process.env.BIS_ENV === "production"; }
function normalize(value: unknown): string | null { if (typeof value !== "string") return null; const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9@.+-]/g, ""); return normalized || null; }
function itemValue(payload: Record<string, unknown>, attribute: BlindAttribute): unknown {
  if (attribute === "passport_number") return payload.passportNumber;
  return payload[attribute];
}

async function poolOrThrow() { const pool = await getPgPool(); if (!pool) fail("PII rotation worker requires PostgreSQL."); return pool; }

type DispatchRecord = { rotation_job_id: string; rotation_ref: string; tenant_id: number; state: "queued" | "terminalizing"; attempt_count: number };

async function terminalizeDispatch(pool: import("pg").Pool, dispatch: DispatchRecord, observer?: PiiRotationTimingObserver): Promise<void> {
  const tenantClient = await checkoutClient(pool, observer);
  try {
    await beginScopedTenantTransaction(tenantClient, dispatch.tenant_id, observer);
    const job = await tenantClient.query<{ id: string; compromise_incident_id: string | null }>(
      `SELECT id,compromise_incident_id FROM pii_rotation_jobs
       WHERE id=$1 AND tenant_id=$2 AND state IN ('queued','leased') FOR UPDATE`,
      [dispatch.rotation_job_id, dispatch.tenant_id],
    );
    const row = job.rows[0];
    if (row) {
      await tenantClient.query(
        `UPDATE pii_rotation_jobs
         SET state='failed',failed_count=failed_count+1,last_error_code=$2,leased_at=NULL,updated_at=NOW()
         WHERE id=$1 AND state IN ('queued','leased')`,
        [row.id, DISPATCH_ATTEMPTS_EXHAUSTED],
      );
      await appendPiiForensicAuditEvent(tenantClient, {
        incidentId: row.compromise_incident_id,
        tenantId: dispatch.tenant_id,
        rotationJobId: row.id,
        eventType: "rotation_failed",
        detail: { error_code: DISPATCH_ATTEMPTS_EXHAUSTED, worker_version: WORKER_VERSION },
      });
    }
    await tenantClient.query("COMMIT");
  } catch (error) {
    await tenantClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tenantClient.release();
  }

  const dispatchClient = await checkoutClient(pool, observer);
  try {
    await dispatchClient.query(
      `UPDATE pii_rotation_dispatch_queue
       SET state='dead_letter',leased_at=NULL,dead_lettered_at=NOW(),updated_at=NOW()
       WHERE rotation_job_id=$1 AND state='terminalizing' AND dead_letter_reason=$2`,
      [dispatch.rotation_job_id, DISPATCH_ATTEMPTS_EXHAUSTED],
    );
    piiRotationDispatchTotal.inc({ outcome: "dead_lettered", component: "pii_rotation_worker" });
  } finally {
    dispatchClient.release();
  }
}

async function leaseJob(rotationRef?: string, observer?: PiiRotationTimingObserver): Promise<RotationJob | null> {
  const pool = await poolOrThrow();
  const dispatchClient = await checkoutClient(pool, observer);
  let dispatch: DispatchRecord | null = null;
  try {
    await dispatchClient.query("BEGIN");
    const recovered = await dispatchClient.query(`UPDATE pii_rotation_dispatch_queue SET state='queued',leased_at=NULL,updated_at=NOW() WHERE state='leased' AND leased_at < NOW()-make_interval(secs=>$1)`, [LEASE_SECONDS]);
    if (recovered.rowCount) piiRotationDispatchTotal.inc({ outcome: "lease_recovered", component: "pii_rotation_worker" }, recovered.rowCount);
    const age = await dispatchClient.query<{ age_seconds: string | null }>(`SELECT EXTRACT(EPOCH FROM NOW()-MIN(created_at))::text AS age_seconds FROM pii_rotation_dispatch_queue WHERE state='queued'`);
    piiRotationDispatchQueueAgeSeconds.set({ component: "pii_rotation_worker" }, Number(age.rows[0]?.age_seconds ?? 0));
    const selected = await dispatchClient.query<DispatchRecord>(`SELECT rotation_job_id,rotation_ref,tenant_id,state,attempt_count FROM pii_rotation_dispatch_queue WHERE ((state='terminalizing' AND leased_at < NOW()-make_interval(secs=>$2) AND ($1::text IS NULL OR rotation_ref=$1)) OR (state='queued' AND ($1::text IS NULL OR rotation_ref=$1))) ORDER BY (state='terminalizing') DESC,created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [rotationRef ?? null, LEASE_SECONDS]);
    dispatch = selected.rows[0] ?? null;
    if (dispatch?.state === "terminalizing") {
      await dispatchClient.query(`UPDATE pii_rotation_dispatch_queue SET leased_at=NOW(),updated_at=NOW() WHERE rotation_job_id=$1 AND state='terminalizing' AND dead_letter_reason=$2`, [dispatch.rotation_job_id, DISPATCH_ATTEMPTS_EXHAUSTED]);
      piiRotationDispatchTotal.inc({ outcome: "terminalization_recovered", component: "pii_rotation_worker" });
    } else if (dispatch && dispatch.attempt_count >= DISPATCH_MAX_ATTEMPTS) {
      await dispatchClient.query(`UPDATE pii_rotation_dispatch_queue SET state='terminalizing',leased_at=NOW(),dead_letter_reason=$2,updated_at=NOW() WHERE rotation_job_id=$1 AND state='queued' AND attempt_count >= $3`, [dispatch.rotation_job_id, DISPATCH_ATTEMPTS_EXHAUSTED, DISPATCH_MAX_ATTEMPTS]);
      dispatch = { ...dispatch, state: "terminalizing" };
      piiRotationDispatchTotal.inc({ outcome: "terminalizing", component: "pii_rotation_worker" });
    } else if (dispatch) {
      await dispatchClient.query(`UPDATE pii_rotation_dispatch_queue SET state='leased',leased_at=NOW(),attempt_count=attempt_count+1,updated_at=NOW() WHERE rotation_job_id=$1 AND state='queued' AND attempt_count < $2`, [dispatch.rotation_job_id, DISPATCH_MAX_ATTEMPTS]);
      dispatch = { ...dispatch, state: "queued", attempt_count: dispatch.attempt_count + 1 };
      piiRotationDispatchTotal.inc({ outcome: "leased", component: "pii_rotation_worker" });
    } else {
      piiRotationDispatchTotal.inc({ outcome: "empty", component: "pii_rotation_worker" });
    }
    await dispatchClient.query("COMMIT");
  } catch (error) { await dispatchClient.query("ROLLBACK").catch(() => undefined); throw error; } finally { dispatchClient.release(); }
  if (!dispatch) return null;
  if (dispatch.state === "terminalizing") {
    await terminalizeDispatch(pool, dispatch, observer);
    return null;
  }

  const tenantClient = await checkoutClient(pool, observer);
  try {
    await beginScopedTenantTransaction(tenantClient, dispatch.tenant_id, observer);
    await tenantClient.query(`UPDATE pii_rotation_jobs SET state='queued',leased_at=NULL,updated_at=NOW(),last_error_code=COALESCE(last_error_code,'PII_ROTATION_LEASE_EXPIRED') WHERE id=$1 AND tenant_id=$2 AND state='leased' AND leased_at < NOW()-make_interval(secs=>$3)`, [dispatch.rotation_job_id, dispatch.tenant_id, LEASE_SECONDS]);
    const selected = await tenantClient.query<RotationJob>(`SELECT id,rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,source_blind_index_key_registry_id,target_blind_index_key_registry_id,compromise_incident_id,mode,dry_run,max_batch_size,requested_by FROM pii_rotation_jobs WHERE id=$1 AND rotation_ref=$2 AND tenant_id=$3 AND state='queued' FOR UPDATE`, [dispatch.rotation_job_id, dispatch.rotation_ref, dispatch.tenant_id]);
    const job = selected.rows[0] ?? null;
    if (!job) piiRotationDispatchTotal.inc({ outcome: "tenant_job_missing", component: "pii_rotation_worker" });
    if (job) await tenantClient.query(`UPDATE pii_rotation_jobs SET state='leased',leased_at=NOW(),attempt_count=attempt_count+1,updated_at=NOW() WHERE id=$1`, [job.id]);
    await tenantClient.query("COMMIT");
    return job;
  } catch (error) {
    recordRlsPolicyDenial("tenant_dispatch_handoff", "pii_rotation_worker", error);
    await tenantClient.query("ROLLBACK").catch(() => undefined);
    const restoreClient = await checkoutClient(pool, observer);
    try { await restoreClient.query(`UPDATE pii_rotation_dispatch_queue SET state='queued',leased_at=NULL,updated_at=NOW() WHERE rotation_job_id=$1 AND state='leased'`, [dispatch.rotation_job_id]); }
    finally { restoreClient.release(); }
    throw error;
  } finally { tenantClient.release(); }
}

async function materializeItems(client: import("pg").PoolClient, job: RotationJob): Promise<number> {
  await client.query(
    `INSERT INTO pii_rotation_job_items (rotation_job_id,envelope_id,tenant_id,subject_kind,subject_id,purpose,state)
     SELECT $1,e.id,e.tenant_id,e.subject_kind,e.subject_id,e.purpose,'planned'
       FROM pii_envelope_records e
      WHERE e.tenant_id=$2 AND e.key_registry_id=$3 AND e.retired_at IS NULL
     ON CONFLICT (rotation_job_id,envelope_id) DO NOTHING`,
    [job.id, job.tenant_id, job.source_encryption_key_registry_id],
  );
  const count = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pii_rotation_job_items WHERE rotation_job_id=$1`, [job.id]);
  const expected = Number(count.rows[0]?.count ?? 0);
  await client.query(`UPDATE pii_rotation_jobs SET expected_count=$2,updated_at=NOW() WHERE id=$1`, [job.id, expected]);
  return expected;
}

async function sourceRegistry(client: import("pg").PoolClient, job: RotationJob): Promise<SourceRegistry> {
  const result = await client.query<SourceRegistry>(`SELECT id,tenant_id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status FROM pii_encryption_key_registry WHERE id=$1 FOR SHARE`, [job.source_encryption_key_registry_id]);
  const row = result.rows[0];
  if (!row || row.tenant_id !== job.tenant_id || !["legacy_local_aes", "vault_transit"].includes(row.provider) || !["active", "retiring", "compromised"].includes(row.status)) {
    if (!row || row.tenant_id !== job.tenant_id) piiRotationTenantScopeMismatchTotal.inc({ component: "pii_rotation_worker" });
    fail("PII rotation source registry is invalid.");
  }
  return row;
}

async function nextItems(client: import("pg").PoolClient, job: RotationJob): Promise<PlannedItem[]> {
  const rows = await client.query<PlannedItem>(
    `SELECT i.id,i.envelope_id,i.tenant_id,i.subject_kind,i.subject_id,i.purpose,e.ciphertext,e.nonce,e.key_version,e.crypto_provider,e.provider_key_version
       FROM pii_rotation_job_items i JOIN pii_envelope_records e ON e.id=i.envelope_id
      WHERE i.rotation_job_id=$1 AND i.state='planned' AND e.retired_at IS NULL
      ORDER BY i.id ASC FOR UPDATE OF i,e SKIP LOCKED LIMIT $2`,
    [job.id, job.max_batch_size],
  );
  return rows.rows;
}

async function sourceBlindAttributes(client: import("pg").PoolClient, job: RotationJob, item: PlannedItem): Promise<BlindAttribute[]> {
  if (!job.source_blind_index_key_registry_id) return [];
  const rows = await client.query<{ attribute_name: BlindAttribute }>(
    `SELECT attribute_name FROM pii_blind_indexes WHERE tenant_id=$1 AND subject_kind=$2 AND subject_id=$3 AND key_registry_id=$4`,
    [item.tenant_id, item.subject_kind, item.subject_id, job.source_blind_index_key_registry_id],
  );
  return Array.from(new Set(rows.rows.map((row) => row.attribute_name)));
}

async function decryptForRotation(job: RotationJob, source: SourceRegistry, item: PlannedItem): Promise<Record<string, unknown>> {
  if (source.provider === "legacy_local_aes") {
    if (job.mode !== "legacy_cutover" || item.crypto_provider !== "legacy_local_aes") fail("Legacy PII envelope can only be handled by an explicit legacy cutover job.");
    return decryptLegacyPiiEnvelope({ tenantId: item.tenant_id, subjectKind: item.subject_kind, subjectId: item.subject_id, purpose: item.purpose, keyVersion: item.key_version, ciphertext: item.ciphertext, nonce: item.nonce });
  }
  if (item.crypto_provider !== "vault_transit") fail("Transit PII rotation source envelope metadata is invalid.");
  const client = loadVaultTransitClient();
  if (!source.provider_key_version) fail("Transit PII rotation source registry is missing its provider key version.");
  const key = { keyVersion: source.key_version, externalKeyRef: source.external_key_ref, providerKeyVersion: source.provider_key_version };
  return decryptPiiEnvelope(key, piiAad(item.tenant_id, item.subject_kind, item.subject_id, item.purpose), { ciphertext: item.ciphertext, keyVersion: item.key_version, cryptoProvider: item.crypto_provider }, client);
}

async function rotateOne(job: RotationJob, item: PlannedItem, observer?: PiiRotationTimingObserver): Promise<"rotated" | "skipped"> {
  const pool = await poolOrThrow(); const client = await checkoutClient(pool, observer);
  try {
    await beginScopedTenantTransaction(client, job.tenant_id, observer);
    const current = await client.query<PlannedItem>(`SELECT i.id,i.envelope_id,i.tenant_id,i.subject_kind,i.subject_id,i.purpose,e.ciphertext,e.nonce,e.key_version,e.crypto_provider,e.provider_key_version FROM pii_rotation_job_items i JOIN pii_envelope_records e ON e.id=i.envelope_id WHERE i.id=$1 AND i.rotation_job_id=$2 AND i.state='planned' FOR UPDATE OF i,e`, [item.id, job.id]);
    const fresh = current.rows[0];
    if (!fresh || fresh.crypto_provider !== item.crypto_provider || fresh.key_version !== item.key_version) { await client.query(`UPDATE pii_rotation_job_items SET state='skipped',error_code='PII_ROTATION_SOURCE_CHANGED',completed_at=NOW() WHERE id=$1 AND state='planned'`, [item.id]); await client.query("COMMIT"); return "skipped"; }
    const source = await sourceRegistry(client, job);
    const target = await tenantEncryptionRegistryById(client, job.tenant_id, job.target_encryption_key_registry_id, ["active"]);
    const transit = loadVaultTransitClient();
    const attributes = await sourceBlindAttributes(client, job, fresh);
    const mustDecrypt = job.mode !== "transit_rewrap" || attributes.length > 0 || source.external_key_ref !== target.externalKeyRef;
    let ciphertext: Buffer; let providerKeyVersion: number; let payload: Record<string, unknown> | null = null;
    if (!mustDecrypt && source.provider === "vault_transit" && fresh.crypto_provider === "vault_transit") {
      const rewrapped = await transit.rewrap(target.providerKeyName, piiAad(fresh.tenant_id, fresh.subject_kind, fresh.subject_id, fresh.purpose), fresh.ciphertext.toString("utf8"));
      ciphertext = Buffer.from(rewrapped.ciphertext, "utf8"); providerKeyVersion = rewrapped.keyVersion;
    } else {
      payload = await decryptForRotation(job, source, fresh);
      const encrypted = await encryptPiiEnvelope(target, piiAad(fresh.tenant_id, fresh.subject_kind, fresh.subject_id, fresh.purpose), payload, transit);
      ciphertext = encrypted.ciphertext; providerKeyVersion = encrypted.providerKeyVersion;
    }
    if (job.target_blind_index_key_registry_id) {
      if (!payload) payload = await decryptForRotation(job, source, fresh);
      const blindTarget = await tenantBlindIndexRegistryById(client, job.tenant_id, job.target_blind_index_key_registry_id, ["active"]);
      for (const attribute of attributes) {
        const value = normalize(itemValue(payload, attribute));
        if (!value) continue;
        const index = await piiBlindIndex(blindTarget, fresh.tenant_id, attribute, value, transit);
        await client.query(
          `INSERT INTO pii_blind_indexes (tenant_id,subject_kind,subject_id,attribute_name,key_version,key_registry_id,normalized_hmac,crypto_provider,provider_key_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'vault_transit',$8) ON CONFLICT DO NOTHING`,
          [fresh.tenant_id, fresh.subject_kind, fresh.subject_id, attribute, index.keyVersion, blindTarget.id, index.normalizedHmac, index.providerKeyVersion],
        );
      }
    }
    await client.query(`UPDATE pii_envelope_records SET retired_at=NOW() WHERE id=$1 AND retired_at IS NULL`, [fresh.envelope_id]);
    await client.query(
      `INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'vault_transit',$8)`,
      [fresh.tenant_id, fresh.subject_kind, fresh.subject_id, fresh.purpose, ciphertext, target.id, target.keyVersion, providerKeyVersion],
    );
    await client.query(`UPDATE pii_rotation_job_items SET state='rotated',completed_at=NOW(),error_code=NULL WHERE id=$1`, [fresh.id]);
    await client.query(`UPDATE pii_rotation_jobs SET processed_count=processed_count+1,rotated_count=rotated_count+1,updated_at=NOW() WHERE id=$1`, [job.id]);
    await appendPiiForensicAuditEvent(client, { incidentId: job.compromise_incident_id, tenantId: job.tenant_id, rotationJobId: job.id, eventType: "rotation_progress", detail: { source_registry_id: source.id, target_registry_id: target.id, source_key_version: source.key_version, target_key_version: target.keyVersion, provider_key_version: providerKeyVersion, worker_version: WORKER_VERSION } });
    await client.query("COMMIT"); return "rotated";
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

async function markJobFailed(job: RotationJob, code: string, observer?: PiiRotationTimingObserver): Promise<void> {
  piiRotationWorkerFailuresTotal.inc({ reason_code: code, component: "pii_rotation_worker" });
  const pool = await poolOrThrow(); const client = await checkoutClient(pool, observer);
  try { await beginScopedTenantTransaction(client, job.tenant_id, observer); await client.query(`UPDATE pii_rotation_jobs SET state='failed',failed_count=failed_count+1,last_error_code=$2,updated_at=NOW() WHERE id=$1 AND state='leased'`, [job.id, code]); await appendPiiForensicAuditEvent(client, { incidentId: job.compromise_incident_id, tenantId: job.tenant_id, rotationJobId: job.id, eventType: "rotation_failed", detail: { error_code: code, worker_version: WORKER_VERSION } }); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

async function finishJob(job: RotationJob, eventType: "rotation_dry_run_completed" | "rotation_completed", state: "dry_run_complete" | "completed", expected: number, observer?: PiiRotationTimingObserver): Promise<void> {
  const pool = await poolOrThrow(); const client = await checkoutClient(pool, observer);
  try { await beginScopedTenantTransaction(client, job.tenant_id, observer); await client.query(`UPDATE pii_rotation_jobs SET state=$2,processed_count=CASE WHEN $2='dry_run_complete' THEN $3 ELSE processed_count END,completed_at=NOW(),leased_at=NULL,updated_at=NOW() WHERE id=$1 AND state='leased'`, [job.id, state, expected]); await appendPiiForensicAuditEvent(client, { incidentId: job.compromise_incident_id, tenantId: job.tenant_id, rotationJobId: job.id, eventType, detail: { record_count: expected, dry_run: state === "dry_run_complete", state, worker_version: WORKER_VERSION } }); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function runPiiRotationWorker(rotationRef?: string, observer?: PiiRotationTimingObserver): Promise<PiiRotationWorkerResult> {
  const result: PiiRotationWorkerResult = { leased: 0, planned: 0, rotated: 0, skipped: 0, failed: 0, dryRuns: 0 };
  const job = await leaseJob(rotationRef, observer);
  if (!job) return result;
  result.leased = 1;
  const pool = await poolOrThrow(); const planningClient = await checkoutClient(pool, observer);
  let expected: number;
  try { await beginScopedTenantTransaction(planningClient, job.tenant_id, observer); expected = await materializeItems(planningClient, job); await appendPiiForensicAuditEvent(planningClient, { incidentId: job.compromise_incident_id, tenantId: job.tenant_id, rotationJobId: job.id, actorUserId: job.requested_by, eventType: "rotation_created", detail: { record_count: expected, source_registry_id: job.source_encryption_key_registry_id, target_registry_id: job.target_encryption_key_registry_id, dry_run: job.dry_run, worker_version: WORKER_VERSION } }); await planningClient.query("COMMIT"); }
  catch (error) { await planningClient.query("ROLLBACK").catch(() => undefined); await markJobFailed(job, "PII_ROTATION_PLAN_FAILURE", observer); throw error; } finally { planningClient.release(); }
  result.planned = expected!;
  if (job.dry_run) { await finishJob(job, "rotation_dry_run_completed", "dry_run_complete", expected!, observer); result.dryRuns = 1; return result; }
  if (process.env.BIS_PII_ROTATION_CONFIRM !== "ROTATE_PII_ENVELOPES" || (isProduction() && process.env.BIS_PII_PRODUCTION_ROTATION_APPROVED !== "true")) { await markJobFailed(job, "PII_ROTATION_CONFIRMATION_MISSING", observer); fail("Refusing PII rotation without explicit cutover confirmation and production approval."); }
  for (;;) {
    const claimPool = await poolOrThrow(); const claimClient = await checkoutClient(claimPool, observer); let items: PlannedItem[];
    try { await beginScopedTenantTransaction(claimClient, job.tenant_id, observer); items = await nextItems(claimClient, job); await claimClient.query("COMMIT"); }
    catch (error) { await claimClient.query("ROLLBACK").catch(() => undefined); throw error; } finally { claimClient.release(); }
    if (!items!.length) break;
    for (const item of items!) {
      try { const state = await rotateOne(job, item, observer); result[state] += 1; }
      catch { result.failed += 1; await markJobFailed(job, "PII_ROTATION_ITEM_FAILURE", observer); return result; }
    }
  }
  await finishJob(job, "rotation_completed", "completed", expected!, observer);
  return result;
}

if (process.argv[1]?.endsWith("piiRotationWorker.ts") || process.argv[1]?.endsWith("piiRotationWorker.js")) {
  runPiiRotationWorker(process.env.BIS_PII_ROTATION_JOB_REF?.trim() || undefined).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`), (error: unknown) => { process.stderr.write(`PII rotation worker failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });
}

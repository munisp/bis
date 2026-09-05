import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPgPool } from "../server/db";
import { runPiiRotationWorker, type PiiRotationTimingObserver } from "../server/piiRotationWorker";
import {
  piiForensicAppendTotal,
  piiRlsPoolContextResidualTotal,
  piiRlsTenantContextSetupTotal,
  piiRotationDispatchTotal,
  piiRotationTenantScopeMismatchTotal,
  piiRotationWorkerFailuresTotal,
} from "../server/piiRlsMetrics";

const TENANT_COUNT = Number.parseInt(process.env.BIS_RLS_STRESS_TENANTS ?? "48", 10);
const WORKER_CONCURRENCY = Number.parseInt(process.env.BIS_RLS_STRESS_WORKERS ?? "64", 10);
const CONTAMINANT_TENANT_ID = "2147483000";

function assertPositiveInteger(value: number, label: string, max: number): void {
  if (!Number.isSafeInteger(value) || value < 2 || value > max) throw new Error(`${label} must be an integer between 2 and ${max}.`);
}
function suffix(): string { return randomUUID().replace(/-/g, "").slice(0, 12); }
function rotationRef(): string { return `BIS-PR-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`; }

type LatencySummary = { count: number; minMs: number; meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
function latencySummary(samples: readonly number[]): LatencySummary {
  assert.ok(samples.length > 0, "latency samples must not be empty");
  const sorted = [...samples].sort((left, right) => left - right);
  const nearestRank = (quantile: number) => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
  const rounded = (value: number) => Number(value.toFixed(3));
  return {
    count: sorted.length,
    minMs: rounded(sorted[0]!),
    meanMs: rounded(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    p50Ms: rounded(nearestRank(0.50)),
    p95Ms: rounded(nearestRank(0.95)),
    p99Ms: rounded(nearestRank(0.99)),
    maxMs: rounded(sorted.at(-1)!),
  };
}
async function setLocalTenant(client: import("pg").PoolClient, tenantId: number): Promise<void> {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  const state = await client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  assert.equal(state.rows[0]?.tenant_id, String(tenantId));
}

async function seedSyntheticJob(pool: import("pg").Pool, n: number, runSuffix: string): Promise<{ tenantId: number; jobId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query<{ id: number }>(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`RLS stress tenant ${n}`, `rls-stress-${runSuffix}-${n}`]);
    const tenantId = tenant.rows[0]!.id;
    const user = await client.query<{ id: number }>(`INSERT INTO users ("openId","tenantId",name,email,role) VALUES ($1,$2,$3,$4,'supervisor') RETURNING id`, [`rls-stress-${runSuffix}-${n}`, tenantId, `RLS Stress ${n}`, `stress-${runSuffix}-${n}@example.invalid`]);
    const candidate = await client.query<{ id: number }>(`INSERT INTO candidate_profiles ("candidateRef","tenantId","firstName","lastName",email) VALUES ($1,$2,'Synthetic','Stress',$3) RETURNING id`, [`CAN-RLS-STRESS-${runSuffix}-${n}`, tenantId, `candidate-${runSuffix}-${n}@example.invalid`]);

    await setLocalTenant(client, tenantId);
    const source = await client.query<{ id: number; key_version: string; provider_key_version: number }>(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,$2,$3,'VAULT-TRANSIT-AES256-GCM96','active',$4,'vault_transit',$5,1) RETURNING id,key_version,provider_key_version`, [tenantId, `stress-source-${runSuffix}-${n}`, `vault-transit://transit/stress-${runSuffix}-${n}-source`, user.rows[0]!.id, `stress-${runSuffix}-${n}-source`]);
    await client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version) VALUES ($1,'candidate_profile',$2,'identity',$3,NULL,$4,$5,'vault_transit',$6)`, [tenantId, candidate.rows[0]!.id, Buffer.from(`vault:v1:stress-${runSuffix}-${n}`), source.rows[0]!.id, source.rows[0]!.key_version, source.rows[0]!.provider_key_version]);
    await client.query(`UPDATE pii_encryption_key_registry SET status='retiring' WHERE id=$1`, [source.rows[0]!.id]);
    const target = await client.query<{ id: number }>(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,$2,$3,'VAULT-TRANSIT-AES256-GCM96','active',$4,'vault_transit',$5,2) RETURNING id`, [tenantId, `stress-target-${runSuffix}-${n}`, `vault-transit://transit/stress-${runSuffix}-${n}-target`, user.rows[0]!.id, `stress-${runSuffix}-${n}-target`]);
    const job = await client.query<{ id: string }>(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by,max_batch_size) VALUES ($1,$2,$3,$4,'transit_reencrypt',true,$5,1) RETURNING id`, [rotationRef(), tenantId, source.rows[0]!.id, target.rows[0]!.id, user.rows[0]!.id]);
    await client.query("COMMIT");
    return { tenantId, jobId: job.rows[0]!.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function acquirePoolClients(pool: import("pg").Pool, count: number): Promise<import("pg").PoolClient[]> {
  const clients: import("pg").PoolClient[] = [];
  try {
    for (let index = 0; index < count; index += 1) clients.push(await pool.connect());
    return clients;
  } catch (error) {
    clients.forEach((client) => client.release());
    throw error;
  }
}

async function poisonSharedPool(pool: import("pg").Pool): Promise<number> {
  const clients = await acquirePoolClients(pool, 20);
  try {
    await Promise.all(clients.map((client) => client.query("SELECT set_config('bis.tenant_id', $1, false)", [CONTAMINANT_TENANT_ID])));
    const checks = await Promise.all(clients.map((client) => client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id")));
    assert.equal(checks.filter((result) => result.rows[0]?.tenant_id === CONTAMINANT_TENANT_ID).length, clients.length, "all shared-pool connections must be deliberately contaminated before the test");
    return clients.length;
  } finally { clients.forEach((client) => client.release()); }
}

async function verifyNoPooledSessionLeak(pool: import("pg").Pool): Promise<number> {
  const clients = await acquirePoolClients(pool, 20);
  try {
    const states = await Promise.all(clients.map((client) => client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id")));
    const contaminated = states.filter((result) => Boolean(result.rows[0]?.tenant_id)).length;
    assert.equal(contaminated, 0, "no pooled connection may retain a tenant setting after stress dispatch");
    return clients.length;
  } finally { clients.forEach((client) => client.release()); }
}

async function main(): Promise<void> {
  assertPositiveInteger(TENANT_COUNT, "BIS_RLS_STRESS_TENANTS", 200);
  assertPositiveInteger(WORKER_CONCURRENCY, "BIS_RLS_STRESS_WORKERS", 256);
  if (!process.env.AUDIT_HMAC_SECRET) throw new Error("AUDIT_HMAC_SECRET is required for synthetic forensic audit events.");
  const pool = await getPgPool();
  if (!pool) throw new Error("PostgreSQL is unavailable.");
  assert.equal(pool.options.max, 20, "the RLS stress rehearsal must use the production-constrained 20-connection pool");
  try {
    const runSuffix = suffix();
    const jobs: Array<{ tenantId: number; jobId: string }> = [];
    for (let index = 1; index <= TENANT_COUNT; index += 1) jobs.push(await seedSyntheticJob(pool, index, runSuffix));
    const contaminatedConnections = await poisonSharedPool(pool);

    const poolCheckoutSamplesMs: number[] = [];
    const tenantContextSetupSamplesMs: number[] = [];
    const workerEndToEndSamplesMs: number[] = [];
    const observer: PiiRotationTimingObserver = (stage, elapsedMs) => {
      if (stage === "pool_checkout") poolCheckoutSamplesMs.push(elapsedMs);
      else tenantContextSetupSamplesMs.push(elapsedMs);
    };
    const started = process.hrtime.bigint();
    const settled = await Promise.allSettled(Array.from({ length: WORKER_CONCURRENCY }, async () => {
      const workerStarted = process.hrtime.bigint();
      try {
        return await runPiiRotationWorker(undefined, observer);
      } finally {
        workerEndToEndSamplesMs.push(Number(process.hrtime.bigint() - workerStarted) / 1_000_000);
      }
    }));
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(rejected.length, 0, "all concurrent workers must settle successfully before aggregate assertions");
    const results = settled.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof runPiiRotationWorker>>>).value);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const leaseCount = results.reduce((total, item) => total + item.leased, 0);
  const plannedCount = results.reduce((total, item) => total + item.planned, 0);
  const dryRunCount = results.reduce((total, item) => total + item.dryRuns, 0);
  const failureCount = results.reduce((total, item) => total + item.failed, 0);
  assert.equal(leaseCount, TENANT_COUNT, "each queued job must be leased exactly once");
  assert.equal(plannedCount, TENANT_COUNT, "each job must materialize exactly one item");
  assert.equal(dryRunCount, TENANT_COUNT, "each job must complete its dry run");
  assert.equal(failureCount, 0, "stress dispatch must have no worker failures");

  let completedJobs = 0;
  let plannedItems = 0;
  let forensicEvents = 0;
  for (const job of jobs) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setLocalTenant(client, job.tenantId);
      const status = await client.query<{ state: string; processed_count: number; failed_count: number }>(`SELECT state,processed_count,failed_count FROM pii_rotation_jobs WHERE id=$1`, [job.jobId]);
      assert.equal(status.rowCount, 1, "tenant must be able to read only its own job");
      assert.equal(status.rows[0]!.state, "dry_run_complete");
      assert.equal(status.rows[0]!.processed_count, 1);
      assert.equal(status.rows[0]!.failed_count, 0);
      completedJobs += 1;
      const items = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pii_rotation_job_items WHERE rotation_job_id=$1 AND state='planned'`, [job.jobId]);
      plannedItems += Number(items.rows[0]!.count);
      const events = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pii_forensic_audit_events WHERE rotation_job_id=$1 AND event_type IN ('rotation_created','rotation_dry_run_completed')`, [job.jobId]);
      assert.equal(Number(events.rows[0]!.count), 2, "each job must have exactly two non-PII forensic events");
      forensicEvents += Number(events.rows[0]!.count);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
  assert.equal(completedJobs, TENANT_COUNT);
  assert.equal(plannedItems, TENANT_COUNT);
  assert.equal(forensicEvents, TENANT_COUNT * 2);
    const checkedConnections = await verifyNoPooledSessionLeak(pool);

    const metricSnapshot = {
      tenantContextSetup: (await piiRlsTenantContextSetupTotal.get()).values,
      pooledSessionResidual: (await piiRlsPoolContextResidualTotal.get()).values,
      dispatch: (await piiRotationDispatchTotal.get()).values,
      workerFailures: (await piiRotationWorkerFailuresTotal.get()).values,
      tenantScopeMismatch: (await piiRotationTenantScopeMismatchTotal.get()).values,
      forensicAppend: (await piiForensicAppendTotal.get()).values,
    };

    process.stdout.write(`${JSON.stringify({
      status: "pass",
      synthetic: true,
      tenantCount: TENANT_COUNT,
      workerConcurrency: WORKER_CONCURRENCY,
      deliberatelyContaminatedConnections: contaminatedConnections,
      checkedPooledConnections: checkedConnections,
      jobLeases: leaseCount,
      plannedItems: plannedCount,
      dryRuns: dryRunCount,
      workerFailures: failureCount,
      completedJobs,
      forensicEvents,
      elapsedMs: Math.round(elapsedMs),
      jobsPerSecond: Number((TENANT_COUNT / (elapsedMs / 1000)).toFixed(2)),
      latency: {
        percentileMethod: "nearest_rank",
        poolCheckoutWaitMs: latencySummary(poolCheckoutSamplesMs),
        tenantContextSetupMs: latencySummary(tenantContextSetupSamplesMs),
        workerEndToEndMs: latencySummary(workerEndToEndSamplesMs),
      },
      metricSnapshot,
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`PII RLS dispatch stress test failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

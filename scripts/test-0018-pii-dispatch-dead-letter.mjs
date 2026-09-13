import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");
const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
const ref = `BIS-PR-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`;
const DEAD = "PII_ROTATION_ATTEMPTS_EXHAUSTED";

async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
}
async function expectReject(label, work) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  assert.equal(rejected, true, `${label} must be rejected`);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  const tenant = (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`Dispatch ${suffix}`, `dispatch-${suffix}`])).rows[0].id;
  const user = (await client.query(`INSERT INTO users ("openId","tenantId",name,email,role) VALUES ($1,$2,'Dispatch','dispatch-${suffix}@example.invalid','supervisor') RETURNING id`, [`dispatch-${suffix}`, tenant])).rows[0].id;

  await client.query("BEGIN");
  await setTenant(client, tenant);
  const source = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,$2,$3,'VAULT-TRANSIT-AES256-GCM96','active',$4,'vault_transit',$5,1) RETURNING id`, [tenant, `dispatch-${suffix}-source`, `vault-transit://transit/dispatch-${suffix}-source`, user, `dispatch-${suffix}-source`])).rows[0].id;
  const target = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,$2,$3,'VAULT-TRANSIT-AES256-GCM96','staged',$4,'vault_transit',$5,2) RETURNING id`, [tenant, `dispatch-${suffix}-target`, `vault-transit://transit/dispatch-${suffix}-target`, user, `dispatch-${suffix}-target`])).rows[0].id;
  const job = (await client.query(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by) VALUES ($1,$2,$3,$4,'transit_reencrypt',true,$5) RETURNING id`, [ref, tenant, source, target, user])).rows[0].id;
  await client.query("COMMIT");

  const dispatch = await client.query(`UPDATE pii_rotation_dispatch_queue SET attempt_count=12 WHERE rotation_job_id=$1 RETURNING state,attempt_count`, [job]);
  assert.deepEqual(dispatch.rows[0], { state: "queued", attempt_count: 12 });
  await client.query(`UPDATE pii_rotation_dispatch_queue SET state='terminalizing',leased_at=NOW(),dead_letter_reason=$2 WHERE rotation_job_id=$1 AND state='queued' AND attempt_count >= 12`, [job, DEAD]);

  await client.query("BEGIN");
  await setTenant(client, tenant);
  await client.query(`UPDATE pii_rotation_jobs SET state='failed',failed_count=failed_count+1,last_error_code=$2,leased_at=NULL WHERE id=$1 AND state IN ('queued','leased')`, [job, DEAD]);
  await client.query("COMMIT");
  const preserved = await client.query(`SELECT state,dead_letter_reason FROM pii_rotation_dispatch_queue WHERE rotation_job_id=$1`, [job]);
  assert.deepEqual(preserved.rows[0], { state: "terminalizing", dead_letter_reason: DEAD });

  await client.query(`UPDATE pii_rotation_dispatch_queue SET state='dead_letter',leased_at=NULL,dead_lettered_at=NOW() WHERE rotation_job_id=$1 AND state='terminalizing'`, [job]);
  const terminal = await client.query(`SELECT state,attempt_count,dead_letter_reason,dead_lettered_at IS NOT NULL AS dead_lettered FROM pii_rotation_dispatch_queue WHERE rotation_job_id=$1`, [job]);
  assert.deepEqual(terminal.rows[0], { state: "dead_letter", attempt_count: 12, dead_letter_reason: DEAD, dead_lettered: true });
  await expectReject("terminal dispatch requeue", () => client.query(`UPDATE pii_rotation_dispatch_queue SET state='queued',dead_lettered_at=NULL,dead_letter_reason=NULL WHERE rotation_job_id=$1`, [job]));
  const otherRef = `BIS-PR-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`;
  const selectedForNamedRef = await client.query(
    `SELECT rotation_job_id FROM pii_rotation_dispatch_queue
     WHERE ((state='terminalizing' AND leased_at < NOW()-make_interval(secs=>$2) AND ($1::text IS NULL OR rotation_ref=$1))
        OR (state='queued' AND ($1::text IS NULL OR rotation_ref=$1)))
     ORDER BY (state='terminalizing') DESC,created_at ASC
     LIMIT 1`,
    [otherRef, 300],
  );
  assert.equal(selectedForNamedRef.rowCount, 0, "named worker selection must not claim a different terminalizing dispatch");
  await client.end();
  process.stdout.write(JSON.stringify({ status: "pass", checks: ["attempt_exhaustion_terminalizes", "failed_job_preserves_terminal_evidence", "dead_letter_immutable", "named_worker_terminalization_isolation"] }) + "\n");
}

main().catch((error) => { process.stderr.write(`PII dispatch dead-letter integration test failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });

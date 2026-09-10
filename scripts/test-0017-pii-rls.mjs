import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client, Pool } = pg;
const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");

function ref(prefix) { return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`; }
async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  const value = await client.query("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  assert.equal(value.rows[0]?.tenant_id, String(tenantId));
}
async function expectReject(label, work) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  assert.equal(rejected, true, `${label} must be rejected`);
}
async function insertTenant(client, slug) {
  return (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`RLS ${slug}`, slug])).rows[0].id;
}
async function insertUser(client, tenantId, suffix) {
  return (await client.query(`INSERT INTO users ("openId","tenantId",name,email,role) VALUES ($1,$2,$3,$4,'supervisor') RETURNING id`, [`rls-${suffix}`, tenantId, `RLS ${suffix}`, `rls-${suffix}@example.invalid`])).rows[0].id;
}
async function insertCandidate(client, tenantId, suffix) {
  return (await client.query(`INSERT INTO candidate_profiles ("candidateRef","tenantId","firstName","lastName",email) VALUES ($1,$2,'Synthetic','RLS',$3) RETURNING id`, [`CAN-RLS-${suffix}`, tenantId, `candidate-${suffix}@example.invalid`])).rows[0].id;
}
async function insertEncryptionRegistry(client, tenantId, userId, suffix, status, providerVersion) {
  return (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,$2,$3,'VAULT-TRANSIT-AES256-GCM96',$4,$5,'vault_transit',$6,$7) RETURNING id`, [tenantId, `rls-${suffix}-v${providerVersion}`, `vault-transit://transit/rls-${suffix}-${providerVersion}`, status, userId, `rls-${suffix}-${providerVersion}`, providerVersion])).rows[0].id;
}

async function main() {
  const setup = new Client({ connectionString });
  await setup.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const tenant1 = await insertTenant(setup, `rls-one-${suffix}`);
  const tenant2 = await insertTenant(setup, `rls-two-${suffix}`);
  const user1 = await insertUser(setup, tenant1, `one-${suffix}`);
  const user2 = await insertUser(setup, tenant2, `two-${suffix}`);
  const candidate1 = await insertCandidate(setup, tenant1, `one-${suffix}`);

  await setup.query("BEGIN");
  await setTenant(setup, tenant1);
  const source1 = await insertEncryptionRegistry(setup, tenant1, user1, `one-${suffix}`, "active", 1);
  const target1 = await insertEncryptionRegistry(setup, tenant1, user1, `one-target-${suffix}`, "staged", 2);
  const envelope1 = (await setup.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version) SELECT $1,'candidate_profile',$2,'identity',$3,NULL,key_version_id,key_version,'vault_transit',provider_key_version FROM (SELECT id AS key_version_id,key_version,provider_key_version FROM pii_encryption_key_registry WHERE id=$4) k RETURNING id`, [tenant1, candidate1, Buffer.from("vault:v1:synthetic-rls"), source1])).rows[0].id;
  await setup.query("COMMIT");

  await setup.query("BEGIN");
  await setTenant(setup, tenant2);
  await insertEncryptionRegistry(setup, tenant2, user2, `two-${suffix}`, "active", 1);
  await setup.query("COMMIT");

  await setup.query("BEGIN");
  const absent = await setup.query("SELECT COUNT(*)::text AS count FROM pii_envelope_records");
  assert.equal(absent.rows[0].count, "0");
  await setup.query("COMMIT");

  await setup.query("BEGIN");
  await setTenant(setup, tenant2);
  const foreignRead = await setup.query("SELECT COUNT(*)::text AS count FROM pii_envelope_records WHERE id=$1", [envelope1]);
  assert.equal(foreignRead.rows[0].count, "0");
  await expectReject("cross-tenant envelope insert", () => setup.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version) VALUES ($1,'candidate_profile',$2,'contact',$3,NULL,$4,$5,'vault_transit',1)`, [tenant1, candidate1, Buffer.from("vault:v1:foreign"), source1, `rls-one-${suffix}-v1`]));
  await setup.query("ROLLBACK");

  await setup.query("BEGIN");
  await setTenant(setup, tenant1);
  const job = (await setup.query(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by) VALUES ($1,$2,$3,$4,'transit_reencrypt',true,$5) RETURNING id`, [ref("BIS-PR"), tenant1, source1, target1, user1])).rows[0].id;
  await setup.query("COMMIT");

  const dispatch = await setup.query(`SELECT rotation_job_id,rotation_ref,tenant_id,state FROM pii_rotation_dispatch_queue WHERE rotation_job_id=$1`, [job]);
  assert.equal(dispatch.rowCount, 1);
  assert.equal(dispatch.rows[0].tenant_id, tenant1);
  assert.equal(Object.hasOwn(dispatch.rows[0], "ciphertext"), false);
  await setup.end();

  const pool = new Pool({ connectionString, max: 1 });
  const first = await pool.connect();
  await first.query("BEGIN");
  await setTenant(first, tenant1);
  const own = await first.query("SELECT COUNT(*)::text AS count FROM pii_envelope_records WHERE id=$1", [envelope1]);
  assert.equal(own.rows[0].count, "1");
  await first.query("COMMIT");
  first.release();

  const second = await pool.connect();
  const leaked = await second.query("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  assert.equal(leaked.rows[0].tenant_id, "");
  await second.query("BEGIN");
  const absentAfterReuse = await second.query("SELECT COUNT(*)::text AS count FROM pii_envelope_records");
  assert.equal(absentAfterReuse.rows[0].count, "0");
  await setTenant(second, tenant2);
  const foreignAfterReuse = await second.query("SELECT COUNT(*)::text AS count FROM pii_envelope_records WHERE id=$1", [envelope1]);
  assert.equal(foreignAfterReuse.rows[0].count, "0");
  await second.query("COMMIT");
  second.release();
  await pool.end();

  process.stdout.write(JSON.stringify({ status: "pass", checks: ["absent_context_denied", "cross_tenant_read_denied", "cross_tenant_write_denied", "dispatch_queue_non_pii", "pool_context_cleared", "worker_dispatch_handoff"] }) + "\n");
}

main().catch((error) => { process.stderr.write(`PII RLS integration test failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");
const client = new Client({ connectionString });

async function expectReject(label, work) {
  try { await work(); throw new Error(`${label} unexpectedly succeeded`); }
  catch (error) { if (error instanceof Error && error.message.endsWith("unexpectedly succeeded")) throw error; }
}

async function main() {
  await client.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const tenant1 = (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`Transit tenant one ${suffix}`, `tr1-${suffix}`])).rows[0].id;
  const tenant2 = (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`Transit tenant two ${suffix}`, `tr2-${suffix}`])).rows[0].id;
  const user = (await client.query(`INSERT INTO users ("openId","tenantId",name,email,role) VALUES ($1,$2,'Key Custodian',$3,'admin') RETURNING id`, [`transit-operator-${suffix}`, tenant1, `transit-${suffix}@example.invalid`])).rows[0].id;
  const candidate = (await client.query(`INSERT INTO candidate_profiles ("candidateRef","tenantId","firstName","lastName",email) VALUES ($1,$2,'Chidi','Transit',$3) RETURNING id`, [`CAN-TR-${suffix}`, tenant1, `candidate-${suffix}@example.invalid`])).rows[0].id;

  const source = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,'pii-old','vault-transit://transit/tenant-one-pii','VAULT-TRANSIT-AES256-GCM96','active',$2,'vault_transit','tenant-one-pii',1) RETURNING id`, [tenant1, user])).rows[0].id;
  await client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version) VALUES ($1,'candidate_profile',$2,'identity',$3,NULL,$4,'pii-old','vault_transit',1)`, [tenant1, candidate, Buffer.from("vault:v1:YWJjZA=="), source]);
  await client.query(`UPDATE pii_encryption_key_registry SET status='retiring' WHERE id=$1`, [source]);
  const target = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,'pii-new','vault-transit://transit/tenant-one-pii','VAULT-TRANSIT-AES256-GCM96','active',$2,'vault_transit','tenant-one-pii',2) RETURNING id`, [tenant1, user])).rows[0].id;
  const foreignTarget = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,'pii-foreign','vault-transit://transit/tenant-two-pii','VAULT-TRANSIT-AES256-GCM96','active',$2,'vault_transit','tenant-two-pii',1) RETURNING id`, [tenant2, user])).rows[0].id;
  const transitBlind = (await client.query(`INSERT INTO pii_blind_index_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version) VALUES ($1,'blind-new','vault-transit://transit/tenant-one-blind','VAULT-TRANSIT-HMAC-SHA256','active',$2,'vault_transit','tenant-one-blind',2) RETURNING id`, [tenant1, user])).rows[0].id;
  assert.ok(transitBlind > 0);

  const job = (await client.query(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by) VALUES ($1,$2,$3,$4,'transit_reencrypt',true,$5) RETURNING id`, [`BIS-PR-${suffix.toUpperCase()}`, tenant1, source, target, user])).rows[0].id;
  const envelope = (await client.query(`SELECT id FROM pii_envelope_records WHERE tenant_id=$1 AND key_registry_id=$2`, [tenant1, source])).rows[0].id;
  await expectReject("existing envelope key-registry mutation", () => client.query(`UPDATE pii_envelope_records SET key_registry_id=$1 WHERE id=$2`, [target, envelope]));
  await expectReject("existing envelope provider-key-version mutation", () => client.query(`UPDATE pii_envelope_records SET provider_key_version=2 WHERE id=$1`, [envelope]));
  await client.query(`INSERT INTO pii_rotation_job_items (rotation_job_id,envelope_id,tenant_id,subject_kind,subject_id,purpose,state) VALUES ($1,$2,$3,'candidate_profile',$4,'identity','planned')`, [job, envelope, tenant1, candidate]);
  await expectReject("cross-tenant rotation target", () => client.query(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by) VALUES ($1,$2,$3,$4,'transit_reencrypt',true,$5)`, [`BIS-PR-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`, tenant1, source, foreignTarget, user]));
  await expectReject("non-Transit target", () => client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider) VALUES ($1,'legacy-target','legacy://target','AES-256-GCM','staged',$2,'legacy_local_aes') RETURNING id`, [tenant1, user]).then(({ rows }) => client.query(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,mode,dry_run,requested_by) VALUES ($1,$2,$3,$4,'legacy_cutover',true,$5)`, [`BIS-PR-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`, tenant1, source, rows[0].id, user])));

  const incident = (await client.query(`INSERT INTO pii_key_compromise_incidents (incident_ref,tenant_id,severity,reported_by,commander_user_id,evidence_reference) VALUES ($1,$2,'high',$3,$3,$4) RETURNING id`, [`BIS-KC-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`, tenant1, user, `evidence-${suffix}`])).rows[0].id;
  const audit = (await client.query(`INSERT INTO pii_forensic_audit_events (incident_id,tenant_id,rotation_job_id,actor_user_id,event_type,detail,integrity_hash) VALUES ($1,$2,$3,$4,'rotation_created',$5,$6) RETURNING id`, [incident, tenant1, job, user, JSON.stringify({ record_count: 1, dry_run: true, state: "queued" }), "a".repeat(64)])).rows[0].id;
  await expectReject("forensic event PII field", () => client.query(`INSERT INTO pii_forensic_audit_events (tenant_id,event_type,detail,integrity_hash) VALUES ($1,'incident_created',$2,$3)`, [tenant1, JSON.stringify({ nin: "12345678901" }), "b".repeat(64)]));
  await expectReject("forensic audit mutation", () => client.query(`UPDATE pii_forensic_audit_events SET detail='{}' WHERE id=$1`, [audit]));
  await expectReject("rotation item identity mutation", () => client.query(`UPDATE pii_rotation_job_items SET purpose='contact' WHERE rotation_job_id=$1`, [job]));

  const state = (await client.query(`SELECT state,dry_run FROM pii_rotation_jobs WHERE id=$1`, [job])).rows[0];
  assert.equal(state.state, "queued");
  assert.equal(state.dry_run, true);
  process.stdout.write("PASS migration 0016 Transit rotation and forensic integrity tests\n");
}

main().finally(() => client.end());

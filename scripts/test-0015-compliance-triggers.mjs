#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");
const client = new Client({ connectionString });

async function expectReject(label, work) {
  try {
    await work();
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("unexpectedly succeeded")) throw error;
  }
}

async function main() {
  await client.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const tenant1 = (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`Compliance test one ${suffix}`, `ct1-${suffix}`])).rows[0].id;
  const tenant2 = (await client.query(`INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`, [`Compliance test two ${suffix}`, `ct2-${suffix}`])).rows[0].id;
  const user1 = (await client.query(`INSERT INTO users ("openId","tenantId",name,email,role) VALUES ($1,$2,'Test Operator',$3,'admin') RETURNING id`, [`test-operator-${suffix}`, tenant1, `operator-${suffix}@example.invalid`])).rows[0].id;
  const candidate = (await client.query(`INSERT INTO candidate_profiles ("candidateRef","tenantId","firstName","lastName",email) VALUES ($1,$2,'Amina','Test',$3) RETURNING id`, [`CAN-${suffix}`, tenant1, `candidate-${suffix}@example.invalid`])).rows[0].id;

  const key1 = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,created_by) VALUES ($1,'pii-test','vault://tenant-1/pii-test',$2) RETURNING id`, [tenant1, user1])).rows[0].id;
  const key2 = (await client.query(`INSERT INTO pii_encryption_key_registry (tenant_id,key_version,external_key_ref,created_by) VALUES ($1,'pii-test','vault://tenant-2/pii-test',$2) RETURNING id`, [tenant2, user1])).rows[0].id;
  const blind1 = (await client.query(`INSERT INTO pii_blind_index_key_registry (tenant_id,key_version,external_key_ref,created_by) VALUES ($1,'blind-test','vault://tenant-1/blind-test',$2) RETURNING id`, [tenant1, user1])).rows[0].id;
  const blind2 = (await client.query(`INSERT INTO pii_blind_index_key_registry (tenant_id,key_version,external_key_ref,created_by) VALUES ($1,'blind-test','vault://tenant-2/blind-test',$2) RETURNING id`, [tenant2, user1])).rows[0].id;
  const ciphertext = Buffer.alloc(32, 7); const nonce = Buffer.alloc(12, 1);

  await client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version) VALUES ($1,'candidate_profile',$2,'identity',$3,$4,$5,'pii-test')`, [tenant1, candidate, ciphertext, nonce, key1]);
  await expectReject("cross-tenant envelope key registry", () => client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version) VALUES ($1,'candidate_profile',$2,'contact',$3,$4,$5,'pii-test')`, [tenant1, candidate, ciphertext, nonce, key2]));
  await expectReject("envelope key-version mismatch", () => client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version) VALUES ($1,'candidate_profile',$2,'document',$3,$4,$5,'other')`, [tenant1, candidate, ciphertext, nonce, key1]));
  await client.query(`INSERT INTO pii_blind_indexes (tenant_id,subject_kind,subject_id,attribute_name,key_version,key_registry_id,normalized_hmac) VALUES ($1,'candidate_profile',$2,'nin','blind-test',$3,$4)`, [tenant1, candidate, blind1, "a".repeat(64)]);
  await expectReject("cross-tenant blind-index key registry", () => client.query(`INSERT INTO pii_blind_indexes (tenant_id,subject_kind,subject_id,attribute_name,key_version,key_registry_id,normalized_hmac) VALUES ($1,'candidate_profile',$2,'bvn','blind-test',$3,$4)`, [tenant1, candidate, blind2, "b".repeat(64)]));

  const order = (await client.query(`INSERT INTO screening_orders ("orderRef","tenantId","candidateId",status) VALUES ($1,$2,$3,'completed') RETURNING id`, [`ORD-${suffix}`, tenant1, candidate])).rows[0].id;
  const snapshot = (await client.query(`INSERT INTO consumer_report_snapshots (snapshot_ref,tenant_id,candidate_id,screening_order_id,jurisdiction_code,report_purpose,content_sha256,manifest) VALUES ($1,$2,$3,$4,'NG','pre_employment',$5,'{"items":[]}') RETURNING id`, [`BIS-RPT-${suffix.slice(0, 18).toUpperCase()}`, tenant1, candidate, order, "c".repeat(64)])).rows[0].id;
  const actionCase = (await client.query(`INSERT INTO compliance_adverse_action_cases (case_ref,tenant_id,screening_order_id,candidate_id,report_snapshot_id,jurisdiction_code,status,waiting_period_days,initiated_by,employer_attestation_at,employer_attestation_text) VALUES ($1,$2,$3,$4,$5,'NG','pre_notice_queued',5,$6,NOW(),$7) RETURNING id`, [`BIS-AA-${suffix.slice(0, 18).toUpperCase()}`, tenant1, order, candidate, snapshot, user1, "a".repeat(40)])).rows[0].id;
  const template = (await client.query(`INSERT INTO compliance_notice_templates (tenant_id,template_key,jurisdiction_code,version,body_ciphertext,body_nonce,body_key_version,content_sha256,approved_by,counsel_approval_reference) VALUES ($1,'pre_adverse','NG','v1',$2,$3,'pii-test',$4,$5,$6) RETURNING id`, [tenant1, ciphertext, nonce, "d".repeat(64), user1, `counsel-${suffix}`])).rows[0].id;
  const delivery = randomUUID();
  await client.query(`INSERT INTO compliance_notice_deliveries (id,adverse_action_case_id,template_id,notice_type,channel,content_sha256) VALUES ($1,$2,$3,'pre_adverse','portal',$4)`, [delivery, actionCase, template, "e".repeat(64)]);
  await client.query(`INSERT INTO compliance_notice_delivery_outbox (id,tenant_id,adverse_action_case_id,delivery_id,payload_ciphertext,payload_nonce,payload_key_version,payload_sha256,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,'pii-test',$7,$8)`, [randomUUID(), tenant1, actionCase, delivery, ciphertext, nonce, "f".repeat(64), randomUUID()]);
  await expectReject("cross-tenant notice delivery outbox", () => client.query(`INSERT INTO compliance_notice_delivery_outbox (id,tenant_id,adverse_action_case_id,delivery_id,payload_ciphertext,payload_nonce,payload_key_version,payload_sha256,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,'pii-test',$7,$8)`, [randomUUID(), tenant2, actionCase, delivery, ciphertext, nonce, "1".repeat(64), randomUUID()]));
  await client.query(`INSERT INTO compliance_adverse_action_events (adverse_action_case_id,actor_user_id,event_type,detail,integrity_hash) VALUES ($1,$2,'created','{}',$3)`, [actionCase, user1, "2".repeat(64)]);
  await expectReject("adverse-action audit event mutation", () => client.query(`UPDATE compliance_adverse_action_events SET detail='{"changed":true}' WHERE adverse_action_case_id=$1`, [actionCase]));
  await expectReject("approved template content mutation", () => client.query(`UPDATE compliance_notice_templates SET version='v2' WHERE id=$1`, [template]));
  await expectReject("paused case missing pause timestamp", () => client.query(`UPDATE compliance_adverse_action_cases SET status='paused_for_dispute' WHERE id=$1`, [actionCase]));

  process.stdout.write("PASS migration 0015 compliance trigger and integrity tests\n");
}

main().finally(() => client.end());

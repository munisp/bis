import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");

const { Client } = pg;
let activeClient;

async function mustReject(client, label, work) {
  await client.query("SAVEPOINT expected_rejection");
  let rejected = false;
  try {
    await work();
  } catch {
    rejected = true;
    await client.query("ROLLBACK TO SAVEPOINT expected_rejection");
  }
  await client.query("RELEASE SAVEPOINT expected_rejection");
  assert.equal(rejected, true, `${label} must be rejected`);
}

async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  const value = await client.query("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  assert.equal(value.rows[0]?.tenant_id, String(tenantId));
}

async function insertTenant(client, suffix) {
  return (await client.query(
    "INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
    [`Payment reconciliation ${suffix}`, `payment-recon-${suffix}`]
  )).rows[0].id;
}

async function insertUser(client, tenantId, suffix) {
  return (await client.query(
    `INSERT INTO users ("openId", "tenantId", name, email, role)
     VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
    [`payment-recon-${suffix}`, tenantId, `Payment reviewer ${suffix}`, `payment-recon-${suffix}@example.invalid`]
  )).rows[0].id;
}

async function insertTransactionAndOutbox(client, tenantId, suffix) {
  const transactionId = (await client.query(
    `INSERT INTO transactions
      ("tenantId", "txRef", "idempotencyKey", type, status, amount, currency, "originatorName", "beneficiaryName")
     VALUES ($1, $2, $3, 'nip', 'under_review', 1000, 'NGN', 'Synthetic Originator', 'Synthetic Beneficiary')
     RETURNING id`,
    [tenantId, `PAY-RECON-${suffix}`, `payment-recon-${suffix}`]
  )).rows[0].id;
  const outboxId = (await client.query(
    `INSERT INTO payment_intent_outbox
      (transaction_id, tenant_id, idempotency_key, rail, status, attempts, last_error_code)
     VALUES ($1, $2, $3, 'nip', 'dead_letter', 10, 'TEMPORAL_WORKFLOW_START_FAILED')
     RETURNING id`,
    [transactionId, tenantId, `payment-recon-outbox-${suffix}`]
  )).rows[0].id;
  return { transactionId, outboxId };
}

async function main() {
  const client = new Client({ connectionString });
  activeClient = client;
  await client.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const tenantOne = await insertTenant(client, `one-${suffix}`);
  const tenantTwo = await insertTenant(client, `two-${suffix}`);
  const requester = await insertUser(client, tenantOne, `requester-${suffix}`);
  const reviewer = await insertUser(client, tenantOne, `reviewer-${suffix}`);
  const foreignUser = await insertUser(client, tenantTwo, `foreign-${suffix}`);
  const { transactionId, outboxId } = await insertTransactionAndOutbox(client, tenantOne, suffix);
  const caseId = randomUUID();
  const digest = "a".repeat(64);

  await client.query("BEGIN");
  await setTenant(client, tenantOne);
  await client.query(
    `INSERT INTO payment_reconciliation_cases
      (id, transaction_id, outbox_id, tenant_id, status, last_error_code)
     VALUES ($1, $2, $3, $4, 'open', 'TEMPORAL_WORKFLOW_START_FAILED')`,
    [caseId, transactionId, outboxId, tenantOne]
  );
  await client.query(
    `INSERT INTO payment_reconciliation_events
      (id, reconciliation_case_id, tenant_id, event_type, to_status, reason_code)
     VALUES ($1, $2, $3, 'case_opened', 'open', 'TEMPORAL_WORKFLOW_START_FAILED')`,
    [randomUUID(), caseId, tenantOne]
  );
  await client.query("COMMIT");

  await client.query("BEGIN");
  await setTenant(client, tenantTwo);
  const foreignRead = await client.query("SELECT count(*)::text AS count FROM payment_reconciliation_cases WHERE id = $1", [caseId]);
  assert.equal(foreignRead.rows[0]?.count, "0", "RLS must hide another tenant's reconciliation case");
  await mustReject(client, "cross-tenant payment reconciliation insert", () => client.query(
    `INSERT INTO payment_reconciliation_cases
      (id, transaction_id, outbox_id, tenant_id, status, last_error_code)
     VALUES ($1, $2, $3, $4, 'open', 'CROSS_TENANT')`,
    [randomUUID(), transactionId, outboxId, tenantOne]
  ));
  await client.query("ROLLBACK");

  await client.query("BEGIN");
  await setTenant(client, tenantOne);
  await client.query(
    `UPDATE payment_reconciliation_cases
     SET status = 'under_review', claimed_by = $2, claimed_at = NOW()
     WHERE id = $1`,
    [caseId, requester]
  );
  await mustReject(client, "same reviewer cannot resolve four-eyes case", () => client.query(
    `UPDATE payment_reconciliation_cases
     SET status = 'confirmed_not_settled', resolved_by = $2, resolved_at = NOW(), closed_at = NOW(),
         resolution_rationale = 'Independent evidence confirmed no settlement was submitted.',
         ledger_evidence_ref = 'ledger:synthetic:no-effect', ledger_evidence_sha256 = $3,
         provider_evidence_ref = 'provider:synthetic:no-effect', provider_evidence_sha256 = $3
     WHERE id = $1`,
    [caseId, requester, digest]
  ));
  await mustReject(client, "terminal reconciliation result cannot omit independent evidence", () => client.query(
    `UPDATE payment_reconciliation_cases
     SET status = 'confirmed_not_settled', resolved_by = $2, resolved_at = NOW(), closed_at = NOW(),
         resolution_rationale = 'Independent evidence confirmed no settlement was submitted.'
     WHERE id = $1`,
    [caseId, reviewer]
  ));
  await client.query(
    `UPDATE payment_reconciliation_cases
     SET status = 'confirmed_not_settled', resolved_by = $2, resolved_at = NOW(), closed_at = NOW(),
         resolution_rationale = 'Independent evidence confirmed no settlement was submitted.',
         ledger_evidence_ref = 'ledger:synthetic:no-effect', ledger_evidence_sha256 = $3,
         provider_evidence_ref = 'provider:synthetic:no-effect', provider_evidence_sha256 = $3
     WHERE id = $1`,
    [caseId, reviewer, digest]
  );
  await mustReject(client, "payment reconciliation events are immutable", () => client.query(
    "UPDATE payment_reconciliation_events SET reason_code = 'ALTERED' WHERE reconciliation_case_id = $1",
    [caseId]
  ));
  const closed = await client.query("SELECT status, claimed_by, resolved_by FROM payment_reconciliation_cases WHERE id = $1", [caseId]);
  assert.deepEqual(closed.rows[0], { status: "confirmed_not_settled", claimed_by: requester, resolved_by: reviewer });
  await client.query("COMMIT");

  assert.notEqual(foreignUser, requester);
  await client.end();
  activeClient = undefined;
  process.stdout.write(JSON.stringify({
    status: "pass",
    checks: [
      "tenant_rls_read_denied",
      "tenant_rls_write_denied",
      "four_eyes_same_actor_denied",
      "evidence_required_for_terminal_state",
      "append_only_event_log",
      "independent_reviewer_terminal_resolution",
    ],
  }) + "\n");
}

main().catch(async error => {
  if (activeClient) await activeClient.end().catch(() => {});
  process.stderr.write(`Payment reconciliation integration test failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");

const { Client } = pg;
const digest = "b".repeat(64);

async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  const value = await client.query("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  assert.equal(value.rows[0]?.tenant_id, String(tenantId));
}

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

async function createFixture(client) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const tenantId = (await client.query(
    "INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
    [`Payment reconciliation race ${suffix}`, `payment-recon-race-${suffix}`]
  )).rows[0].id;
  const users = [];
  for (const role of ["claimant", "resolver-one", "resolver-two"]) {
    users.push((await client.query(
      `INSERT INTO users ("openId", "tenantId", name, email, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
      [`payment-recon-race-${role}-${suffix}`, tenantId, `Payment ${role}`, `payment-${role}-${suffix}@example.invalid`]
    )).rows[0].id);
  }
  const [claimantId, resolverOneId, resolverTwoId] = users;
  const transactionId = (await client.query(
    `INSERT INTO transactions
      ("tenantId", "txRef", "idempotencyKey", type, status, amount, currency, "originatorName", "beneficiaryName")
     VALUES ($1, $2, $3, 'nip', 'under_review', 1000, 'NGN', 'Synthetic Originator', 'Synthetic Beneficiary')
     RETURNING id`,
    [tenantId, `PAY-RECON-RACE-${suffix}`, `payment-recon-race-${suffix}`]
  )).rows[0].id;
  const outboxId = (await client.query(
    `INSERT INTO payment_intent_outbox
      (transaction_id, tenant_id, idempotency_key, rail, status, attempts, last_error_code)
     VALUES ($1, $2, $3, 'nip', 'dead_letter', 10, 'TEMPORAL_WORKFLOW_START_FAILED')
     RETURNING id`,
    [transactionId, tenantId, `payment-recon-race-outbox-${suffix}`]
  )).rows[0].id;
  const reconciliationCaseId = randomUUID();

  await client.query("BEGIN");
  await setTenant(client, tenantId);
  await client.query(
    `INSERT INTO payment_reconciliation_cases
      (id, transaction_id, outbox_id, tenant_id, status, last_error_code, claimed_by, claimed_at)
     VALUES ($1, $2, $3, $4, 'under_review', 'TEMPORAL_WORKFLOW_START_FAILED', $5, NOW())`,
    [reconciliationCaseId, transactionId, outboxId, tenantId, claimantId]
  );
  await client.query(
    `INSERT INTO payment_reconciliation_events
      (id, reconciliation_case_id, tenant_id, event_type, actor_user_id, to_status, reason_code)
     VALUES ($1, $2, $3, 'case_opened', NULL, 'open', 'TEMPORAL_WORKFLOW_START_FAILED'),
            ($4, $2, $3, 'case_claimed', $5, 'under_review', 'INDEPENDENT_REVIEW_CLAIMED')`,
    [randomUUID(), reconciliationCaseId, tenantId, randomUUID(), claimantId]
  );
  await client.query("COMMIT");

  return { tenantId, claimantId, resolverOneId, resolverTwoId, transactionId, reconciliationCaseId };
}

async function attemptResolution(client, fixture, resolverId) {
  await client.query("BEGIN");
  try {
    await setTenant(client, fixture.tenantId);
    const resolved = await client.query(
      `UPDATE payment_reconciliation_cases
       SET status = 'confirmed_not_settled', resolved_by = $2, resolved_at = NOW(), closed_at = NOW(),
           resolution_rationale = 'Independent concurrent evidence confirms no external payment effect.',
           ledger_evidence_ref = 'ledger:synthetic:concurrent-no-effect', ledger_evidence_sha256 = $3,
           provider_evidence_ref = 'provider:synthetic:concurrent-no-effect', provider_evidence_sha256 = $3
       WHERE id = $1 AND tenant_id = $4 AND status = 'under_review' AND claimed_by <> $2
       RETURNING id`,
      [fixture.reconciliationCaseId, resolverId, digest, fixture.tenantId]
    );
    if (resolved.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { resolved: false, resolverId };
    }
    await client.query(
      `UPDATE transactions SET status = 'failed', "updatedAt" = NOW()
       WHERE id = $1 AND "tenantId" = $2 AND status = 'under_review'
       RETURNING id`,
      [fixture.transactionId, fixture.tenantId]
    );
    await client.query(
      `INSERT INTO payment_reconciliation_events
        (id, reconciliation_case_id, tenant_id, event_type, actor_user_id, from_status, to_status,
         reason_code, ledger_evidence_sha256, provider_evidence_sha256)
       VALUES ($1, $2, $3, 'not_settled_confirmed', $4, 'under_review', 'confirmed_not_settled',
               'NO_SETTLEMENT_CONFIRMED', $5, $5)`,
      [randomUUID(), fixture.reconciliationCaseId, fixture.tenantId, resolverId, digest]
    );
    await client.query("COMMIT");
    return { resolved: true, resolverId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const setup = new Client({ connectionString });
  const resolverOne = new Client({ connectionString });
  const resolverTwo = new Client({ connectionString });
  await Promise.all([setup.connect(), resolverOne.connect(), resolverTwo.connect()]);
  try {
    const fixture = await createFixture(setup);
    const outcomes = await Promise.all([
      attemptResolution(resolverOne, fixture, fixture.resolverOneId),
      attemptResolution(resolverTwo, fixture, fixture.resolverTwoId),
    ]);

    assert.equal(outcomes.filter(outcome => outcome.resolved).length, 1, "exactly one independent resolver may record a terminal decision");
    assert.equal(outcomes.filter(outcome => !outcome.resolved).length, 1, "the concurrent losing resolver must observe the durable state transition");

    await setup.query("BEGIN");
    await setTenant(setup, fixture.tenantId);
    const resolvedCase = await setup.query(
      "SELECT status, claimed_by, resolved_by FROM payment_reconciliation_cases WHERE id = $1",
      [fixture.reconciliationCaseId]
    );
    assert.equal(resolvedCase.rows.length, 1);
    assert.equal(resolvedCase.rows[0].status, "confirmed_not_settled");
    assert.notEqual(resolvedCase.rows[0].claimed_by, resolvedCase.rows[0].resolved_by, "resolver must remain independent from claimant");

    const events = await setup.query(
      "SELECT event_type, to_status FROM payment_reconciliation_events WHERE reconciliation_case_id = $1 ORDER BY created_at, id",
      [fixture.reconciliationCaseId]
    );
    assert.equal(events.rows.length, 3, "a concurrent resolution must append exactly one terminal event");
    assert.deepEqual(
      events.rows.map(event => `${event.event_type}:${event.to_status}`).sort(),
      [
        "case_claimed:under_review",
        "case_opened:open",
        "not_settled_confirmed:confirmed_not_settled",
      ]
    );
    await mustReject(setup, "append-only payment reconciliation event update", () => setup.query(
      "UPDATE payment_reconciliation_events SET reason_code = 'ALTERED' WHERE reconciliation_case_id = $1",
      [fixture.reconciliationCaseId]
    ));
    await mustReject(setup, "append-only payment reconciliation event delete", () => setup.query(
      "DELETE FROM payment_reconciliation_events WHERE reconciliation_case_id = $1",
      [fixture.reconciliationCaseId]
    ));
    await setup.query("COMMIT");

    process.stdout.write(JSON.stringify({
      status: "pass",
      checks: [
        "concurrent_independent_resolution_single_winner",
        "concurrent_loser_cannot_overwrite_terminal_state",
        "claimant_resolver_separation_preserved",
        "append_only_event_update_denied",
        "append_only_event_delete_denied",
      ],
    }) + "\n");
  } finally {
    await Promise.all([setup.end(), resolverOne.end(), resolverTwo.end()]);
  }
}

main().catch(error => {
  process.stderr.write(`Payment reconciliation concurrency test failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

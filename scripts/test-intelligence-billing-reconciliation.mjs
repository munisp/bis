#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.BIS_RECONCILIATION_TEST_DATABASE_URL ?? "";
if (process.env.BIS_ALLOW_ISOLATED_RECONCILIATION_TEST !== "1") throw new Error("BIS_ALLOW_ISOLATED_RECONCILIATION_TEST=1 is required");
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl) || process.env.NODE_ENV === "production" || /(?:prod|production)/i.test(databaseUrl)) throw new Error("An explicit non-production PostgreSQL URL is required");

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
const outcome = { migration13: false, selfApprovalDenied: false, confirmedSettlement: false, deterministicRetry: false, rowsCleaned: false };
const id = { tenant: 0, requester: 0, reviewer: 0, candidate: 0, scorePolicy: randomUUID(), assessment: randomUUID(), meter: randomUUID(), eventSettled: randomUUID(), eventRetry: randomUUID(), reconciliationSettled: randomUUID(), reconciliationRetry: randomUUID() };
const transferSettled = "a".repeat(32);
const transferRetry = "b".repeat(32);

async function q(text, values) { return client.query(text, values); }
async function cleanup() {
  await q("DELETE FROM intelligence_assessment_billing_reconciliations WHERE tenant_id = $1", [id.tenant]).catch(() => undefined);
  await q("DELETE FROM intelligence_assessment_billing_events WHERE tenant_id = $1", [id.tenant]).catch(() => undefined);
  await q("DELETE FROM intelligence_assessment_metering_policies WHERE tenant_id = $1", [id.tenant]).catch(() => undefined);
  await q("DELETE FROM investigation_score_assessments WHERE tenant_id = $1", [id.tenant]).catch(() => undefined);
  await q("DELETE FROM investigation_score_policies WHERE tenant_id = $1", [id.tenant]).catch(() => undefined);
  await q("DELETE FROM candidate_profiles WHERE id = $1", [id.candidate]).catch(() => undefined);
  await q("DELETE FROM users WHERE id IN ($1,$2)", [id.requester, id.reviewer]).catch(() => undefined);
  await q("DELETE FROM tenants WHERE id = $1", [id.tenant]).catch(() => undefined);
}

try {
  await client.connect();
  const migration = await q("SELECT 1 FROM bis_migrations.schema_migrations WHERE migration_index = 13 AND tag = '0013_intelligence_billing_reconciliation'");
  if (migration.rowCount !== 1) throw new Error("Migration 0013 is required");
  outcome.migration13 = true;
  const suffix = randomUUID().replace(/-/g, "");
  id.tenant = (await q("INSERT INTO tenants (name,slug,\"contactEmail\") VALUES ($1,$2,$3) RETURNING id", [`Reconciliation ${suffix}`, `reconcile-${suffix.slice(0, 40)}`, `reconcile-${suffix}@invalid.example`])).rows[0].id;
  id.requester = (await q("INSERT INTO users (\"tenantId\",\"openId\",name,email,role) VALUES ($1,$2,'Requester',$3,'admin') RETURNING id", [id.tenant, `recon-requester-${suffix}`, `requester-${suffix}@invalid.example`])).rows[0].id;
  id.reviewer = (await q("INSERT INTO users (\"tenantId\",\"openId\",name,email,role) VALUES ($1,$2,'Reviewer',$3,'admin') RETURNING id", [id.tenant, `recon-reviewer-${suffix}`, `reviewer-${suffix}@invalid.example`])).rows[0].id;
  id.candidate = (await q("INSERT INTO candidate_profiles (\"candidateRef\",\"tenantId\",\"firstName\",\"lastName\",email) VALUES ($1,$2,'Synthetic','Reconciliation',$3) RETURNING id", [`CAND-${suffix.slice(0, 20)}`, id.tenant, `candidate-${suffix}@invalid.example`])).rows[0].id;
  await q("INSERT INTO investigation_score_policies (id,tenant_id,policy_code,version,status,methodology,approved_by,approved_at,effective_from,created_by) VALUES ($1,$2,'reconcile_score',1,'active','{}'::jsonb,$3,now(),now(),$3)", [id.scorePolicy, id.tenant, id.requester]);
  await q("INSERT INTO investigation_score_assessments (id,tenant_id,candidate_id,policy_id,score,confidence,coverage,freshness,decision_support_status,reason_codes,input_sha256,expires_at,created_by) VALUES ($1,$2,$3,$4,70,0.9,0.9,0.9,'decision_support_only',ARRAY['adequate_evidence'],$5,now()+interval '1 day',$6)", [id.assessment, id.tenant, id.candidate, id.scorePolicy, "c".repeat(64), id.requester]);
  await q("INSERT INTO intelligence_assessment_metering_policies (id,tenant_id,policy_code,enabled,prepaid_price_kobo,approved_by,approved_at,created_by) VALUES ($1,$2,'reconcile_score',true,5000,$3,now(),$3)", [id.meter, id.tenant, id.requester]);
  for (const [eventId, transfer] of [[id.eventSettled, transferSettled], [id.eventRetry, transferRetry]]) {
    const assessmentId = eventId === id.eventSettled ? id.assessment : randomUUID();
    if (assessmentId !== id.assessment) await q("INSERT INTO investigation_score_assessments (id,tenant_id,candidate_id,policy_id,score,confidence,coverage,freshness,decision_support_status,reason_codes,input_sha256,expires_at,created_by) VALUES ($1,$2,$3,$4,70,0.9,0.9,0.9,'decision_support_only',ARRAY['adequate_evidence'],$5,now()+interval '1 day',$6)", [assessmentId, id.tenant, id.candidate, id.scorePolicy, "d".repeat(64), id.requester]);
    await q("INSERT INTO intelligence_assessment_billing_events (id,tenant_id,assessment_id,metering_policy_id,requested_by,amount_kobo,status,idempotency_key,tigerbeetle_transfer_id,attempt_count) VALUES ($1,$2,$3,$4,$5,5000,'awaiting_reconciliation',$6,$7,10)", [eventId,id.tenant,assessmentId,id.meter,id.requester,assessmentId,transfer]);
  }
  await q("INSERT INTO intelligence_assessment_billing_reconciliations (id,billing_event_id,tenant_id,deterministic_transfer_id,status,last_error_code,requested_by) VALUES ($1,$2,$3,$4,'open','ledger_unavailable',$5),($6,$7,$3,$8,'open','ledger_unavailable',$5)", [id.reconciliationSettled,id.eventSettled,id.tenant,transferSettled,id.requester,id.reconciliationRetry,id.eventRetry,transferRetry]);

  const selfClaim = await q("UPDATE intelligence_assessment_billing_reconciliations SET status='under_review',reviewed_by=$2,reviewed_at=now() WHERE billing_event_id=$1 AND status='open' AND requested_by <> $2 RETURNING id", [id.eventSettled,id.requester]);
  if (selfClaim.rowCount !== 0) throw new Error("Requester self-claim unexpectedly succeeded");
  outcome.selfApprovalDenied = true;

  const claim = await q("UPDATE intelligence_assessment_billing_reconciliations SET status='under_review',reviewed_by=$2,reviewed_at=now() WHERE billing_event_id=$1 AND status='open' AND requested_by <> $2 RETURNING id", [id.eventSettled,id.reviewer]);
  if (claim.rowCount !== 1) throw new Error("Independent reviewer could not claim reconciliation");
  const confirm = await q("UPDATE intelligence_assessment_billing_reconciliations SET status='confirmed_settled',reviewed_by=$2,reviewed_at=now(),closed_at=now(),resolution_rationale=$3,ledger_evidence_ref=$4,ledger_evidence_sha256=$5 WHERE billing_event_id=$1 AND status='under_review' AND requested_by <> $2 RETURNING id", [id.eventSettled,id.reviewer,"Independent ledger export confirms the deterministic transfer completed.","vault://isolated/ledger-proof","e".repeat(64)]);
  if (confirm.rowCount !== 1) throw new Error("Independent reviewer could not confirm settlement");
  await q("UPDATE intelligence_assessment_billing_events SET status='settled',settled_at=now(),last_error_code=NULL WHERE id=$1 AND status='awaiting_reconciliation'", [id.eventSettled]);
  const settled = await q("SELECT e.status event_status,r.status reconciliation_status FROM intelligence_assessment_billing_events e JOIN intelligence_assessment_billing_reconciliations r ON r.billing_event_id=e.id WHERE e.id=$1", [id.eventSettled]);
  if (settled.rows[0].event_status !== "settled" || settled.rows[0].reconciliation_status !== "confirmed_settled") throw new Error("Confirmed settlement state mismatch");
  outcome.confirmedSettlement = true;

  const retryApproval = await q("UPDATE intelligence_assessment_billing_reconciliations SET status='approved_retry',reviewed_by=$2,reviewed_at=now(),requeued_at=now(),closed_at=now(),resolution_rationale=$3 WHERE billing_event_id=$1 AND status='open' AND requested_by <> $2 RETURNING id", [id.eventRetry,id.reviewer,"Ledger query was inconclusive and deterministic retry is independently approved."]);
  if (retryApproval.rowCount !== 1) throw new Error("Independent reviewer could not approve deterministic retry");
  await q("UPDATE intelligence_assessment_billing_events SET status='retryable_failure',attempt_count=0,available_at=now(),leased_at=NULL,lease_owner=NULL,last_error_code='human_approved_deterministic_retry' WHERE id=$1 AND status='awaiting_reconciliation'", [id.eventRetry]);
  const retry = await q("SELECT status,attempt_count,tigerbeetle_transfer_id FROM intelligence_assessment_billing_events WHERE id=$1", [id.eventRetry]);
  if (retry.rows[0].status !== "retryable_failure" || Number(retry.rows[0].attempt_count) !== 0 || retry.rows[0].tigerbeetle_transfer_id !== transferRetry) throw new Error("Deterministic retry did not preserve transfer identity or reset durable attempt state");
  outcome.deterministicRetry = true;
  await cleanup(); outcome.rowsCleaned = true;
  process.stdout.write(`${JSON.stringify({ event:"intelligence_billing_reconciliation_test_passed", ...outcome })}\n`);
} catch (error) {
  await cleanup().catch(() => undefined);
  process.stderr.write(`${JSON.stringify({ event:"intelligence_billing_reconciliation_test_failed", error:error instanceof Error ? error.message : "unknown", ...outcome })}\n`);
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }

#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.BIS_BILLING_TEST_DATABASE_URL ?? "";
if (process.env.BIS_ALLOW_ISOLATED_BILLING_TEST !== "1") throw new Error("BIS_ALLOW_ISOLATED_BILLING_TEST=1 is required");
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error("BIS_BILLING_TEST_DATABASE_URL must be an explicit PostgreSQL URL");
if (process.env.NODE_ENV === "production" || /(?:prod|production)/i.test(databaseUrl)) throw new Error("This disposable test must never target a production database");

const { Client } = pg;
const primary = new Client({ connectionString: databaseUrl });
const result = { migration12: false, duplicateEventPrevented: false, entitlementExhaustionPrevented: false, settledReservations: 0 };
const ids = { policy: randomUUID(), assessment: randomUUID(), meteringPolicy: randomUUID(), entitlement: randomUUID(), tenantId: 0, userId: 0, candidateId: 0 };

async function query(sql, values) { return primary.query(sql, values); }
async function cleanup() {
  await query("DELETE FROM intelligence_assessment_billing_events WHERE assessment_id = $1", [ids.assessment]).catch(() => undefined);
  await query("DELETE FROM billing_check_reservations WHERE entitlement_id = $1", [ids.entitlement]).catch(() => undefined);
  await query("DELETE FROM billing_entitlements WHERE id = $1", [ids.entitlement]).catch(() => undefined);
  await query("DELETE FROM intelligence_assessment_metering_policies WHERE id = $1", [ids.meteringPolicy]).catch(() => undefined);
  await query("DELETE FROM investigation_score_assessments WHERE id = $1", [ids.assessment]).catch(() => undefined);
  await query("DELETE FROM investigation_score_policies WHERE id = $1", [ids.policy]).catch(() => undefined);
  await query("DELETE FROM candidate_profiles WHERE id = $1", [ids.candidateId]).catch(() => undefined);
  await query("DELETE FROM users WHERE id = $1", [ids.userId]).catch(() => undefined);
  await query("DELETE FROM tenants WHERE id = $1", [ids.tenantId]).catch(() => undefined);
}

try {
  await primary.connect();
  const migration = await query("SELECT 1 FROM bis_migrations.schema_migrations WHERE migration_index = 12 AND tag = '0012_investigation_intelligence_billing_events'");
  if (migration.rowCount !== 1) throw new Error("Migration 0012 must be applied before the billing concurrency test");
  result.migration12 = true;
  const suffix = randomUUID().replace(/-/g, "");
  const tenant = await query("INSERT INTO tenants (name, slug, \"contactEmail\") VALUES ($1,$2,$3) RETURNING id", [`Billing Race ${suffix}`, `billing-${suffix.slice(0, 42)}`, `billing-${suffix}@invalid.example`]);
  ids.tenantId = tenant.rows[0].id;
  const user = await query("INSERT INTO users (\"tenantId\", \"openId\", name, email, role) VALUES ($1,$2,'Billing Race Operator',$3,'admin') RETURNING id", [ids.tenantId, `billing-user-${suffix}`, `billing-user-${suffix}@invalid.example`]);
  ids.userId = user.rows[0].id;
  const candidate = await query("INSERT INTO candidate_profiles (\"candidateRef\",\"tenantId\",\"firstName\",\"lastName\",email) VALUES ($1,$2,'Synthetic','Billing',$3) RETURNING id", [`CAND-${suffix.slice(0, 20)}`, ids.tenantId, `billing-candidate-${suffix}@invalid.example`]);
  ids.candidateId = candidate.rows[0].id;
  await query("INSERT INTO investigation_score_policies (id,tenant_id,policy_code,version,status,methodology,approved_by,approved_at,effective_from,created_by) VALUES ($1,$2,'metered_score',1,'active','{}'::jsonb,$3,now(),now(),$3)", [ids.policy, ids.tenantId, ids.userId]);
  await query("INSERT INTO investigation_score_assessments (id,tenant_id,candidate_id,policy_id,score,confidence,coverage,freshness,decision_support_status,reason_codes,input_sha256,expires_at,created_by) VALUES ($1,$2,$3,$4,65,0.9,0.9,0.9,'decision_support_only',ARRAY['adequate_evidence'],$5,now()+interval '1 day',$6)", [ids.assessment, ids.tenantId, ids.candidateId, ids.policy, "c".repeat(64), ids.userId]);
  await query("INSERT INTO intelligence_assessment_metering_policies (id,tenant_id,policy_code,enabled,prepaid_price_kobo,approved_by,approved_at,created_by) VALUES ($1,$2,'metered_score',true,5000,$3,now(),$3)", [ids.meteringPolicy, ids.tenantId, ids.userId]);

  const eventWriterA = new Client({ connectionString: databaseUrl });
  const eventWriterB = new Client({ connectionString: databaseUrl });
  await Promise.all([eventWriterA.connect(), eventWriterB.connect()]);
  try {
    const eventInsert = (writer) => writer.query(
      "INSERT INTO intelligence_assessment_billing_events (id,tenant_id,assessment_id,metering_policy_id,requested_by,amount_kobo,idempotency_key) VALUES ($1,$2,$3,$4,$5,5000,$3) ON CONFLICT (assessment_id) DO NOTHING RETURNING id",
      [randomUUID(), ids.tenantId, ids.assessment, ids.meteringPolicy, ids.userId],
    );
    await Promise.all([eventInsert(eventWriterA), eventInsert(eventWriterB)]);
  } finally {
    await Promise.all([eventWriterA.end(), eventWriterB.end()]);
  }
  const events = await query("SELECT count(*)::int AS count FROM intelligence_assessment_billing_events WHERE assessment_id = $1", [ids.assessment]);
  if (events.rows[0].count !== 1) throw new Error(`Expected exactly one billing event; found ${events.rows[0].count}`);
  result.duplicateEventPrevented = true;

  await query("INSERT INTO billing_entitlements (id,tenant_id,entitlement_kind,total_units,period_start,period_end,status,source_reference) VALUES ($1,$2,'manual_contract_check',1,now()-interval '1 minute',now()+interval '1 day','active',$3)", [ids.entitlement, ids.tenantId, `billing-race:${suffix}`]);
  const workerA = new Client({ connectionString: databaseUrl });
  const workerB = new Client({ connectionString: databaseUrl });
  await Promise.all([workerA.connect(), workerB.connect()]);
  try {
    await workerA.query("BEGIN");
    const claimedA = await workerA.query("SELECT id FROM billing_entitlements WHERE id = $1 AND total_units > consumed_units + reserved_units FOR UPDATE SKIP LOCKED", [ids.entitlement]);
    if (claimedA.rowCount !== 1) throw new Error("Worker A failed to lock the available entitlement");
    await workerA.query("UPDATE billing_entitlements SET reserved_units = reserved_units + 1 WHERE id = $1", [ids.entitlement]);
    await workerB.query("BEGIN");
    const claimedB = await workerB.query("SELECT id FROM billing_entitlements WHERE id = $1 AND total_units > consumed_units + reserved_units FOR UPDATE SKIP LOCKED", [ids.entitlement]);
    if (claimedB.rowCount !== 0) throw new Error("Worker B obtained an entitlement unit already leased by worker A");
    await workerB.query("COMMIT");
    await workerA.query("UPDATE billing_entitlements SET reserved_units = reserved_units - 1, consumed_units = consumed_units + 1 WHERE id = $1", [ids.entitlement]);
    await workerA.query("COMMIT");
  } finally {
    await workerA.query("ROLLBACK").catch(() => undefined);
    await workerB.query("ROLLBACK").catch(() => undefined);
    await Promise.all([workerA.end(), workerB.end()]);
  }
  const entitlement = await query("SELECT consumed_units, reserved_units FROM billing_entitlements WHERE id = $1", [ids.entitlement]);
  if (Number(entitlement.rows[0].consumed_units) !== 1 || Number(entitlement.rows[0].reserved_units) !== 0) throw new Error("Entitlement counters do not prove exactly one consumed unit");
  result.entitlementExhaustionPrevented = true;
  result.settledReservations = 1;
  await cleanup();
  process.stdout.write(`${JSON.stringify({ event: "intelligence_billing_concurrency_test_passed", ...result })}\n`);
} catch (error) {
  await cleanup().catch(() => undefined);
  process.stderr.write(`${JSON.stringify({ event: "intelligence_billing_concurrency_test_failed", error: error instanceof Error ? error.message : "unknown", ...result })}\n`);
  process.exitCode = 1;
} finally { await primary.end().catch(() => undefined); }

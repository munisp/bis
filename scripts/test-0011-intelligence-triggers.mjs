#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.BIS_TRIGGER_TEST_DATABASE_URL ?? "";
if (process.env.BIS_ALLOW_ISOLATED_TRIGGER_TEST !== "1") {
  throw new Error("BIS_ALLOW_ISOLATED_TRIGGER_TEST=1 is required; this test refuses implicit database access");
}
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
  throw new Error("BIS_TRIGGER_TEST_DATABASE_URL must be an explicit PostgreSQL URL");
}
if (process.env.NODE_ENV === "production" || /(?:prod|production)/i.test(databaseUrl)) {
  throw new Error("This disposable trigger test must never target a production database");
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
const outcome = { protectedFactorRejected: false, auditUpdateRejected: false, auditDeleteRejected: false, triggerCount: 0 };

async function expectRejected(label, query, expectedMessage) {
  const savepoint = `trigger_expect_${randomUUID().replace(/-/g, "")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
    if (error instanceof Error && error.message.includes("unexpectedly succeeded")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) throw new Error(`${label} failed with an unexpected database error: ${message}`);
    return true;
  } finally {
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
  }
}

try {
  await client.connect();
  const migration = await client.query("SELECT checksum FROM bis_migrations.schema_migrations WHERE migration_index = 11 AND tag = '0011_investigation_intelligence_controls'");
  if (migration.rowCount !== 1) throw new Error("Migration 0011 is not applied; run pnpm db:migrate before this test");
  const triggers = await client.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('intelligence_source_provider_authorization_guard','intelligence_monitoring_authorization_guard','intelligence_evidence_tenant_guard','intelligence_conflict_tenant_guard','intelligence_audit_events_immutable_update','intelligence_audit_events_immutable_delete')");
  outcome.triggerCount = triggers.rowCount ?? 0;
  if (outcome.triggerCount !== 6) throw new Error(`Expected six 0011 enforcement triggers; found ${outcome.triggerCount}`);

  const suffix = randomUUID().replace(/-/g, "");
  await client.query("BEGIN");
  const tenant = await client.query("INSERT INTO tenants (name, slug, \"contactEmail\") VALUES ($1,$2,$3) RETURNING id", [`Trigger Test ${suffix}`, `trigger-${suffix.slice(0, 42)}`, `trigger-${suffix}@invalid.example`]);
  const tenantId = tenant.rows[0].id;
  const user = await client.query("INSERT INTO users (\"tenantId\", \"openId\", name, email, role) VALUES ($1,$2,$3,$4,'admin') RETURNING id", [tenantId, `trigger-user-${suffix}`, "Trigger Test Operator", `operator-${suffix}@invalid.example`]);
  const userId = user.rows[0].id;
  const candidate = await client.query("INSERT INTO candidate_profiles (\"candidateRef\", \"tenantId\", \"firstName\", \"lastName\", email) VALUES ($1,$2,'Synthetic','Trigger',$3) RETURNING id", [`CAND-${suffix.slice(0, 20)}`, tenantId, `candidate-${suffix}@invalid.example`]);
  const candidateId = candidate.rows[0].id;
  const sourceId = randomUUID();
  await client.query("INSERT INTO intelligence_source_catalog (id, tenant_id, source_code, source_class, authority_level, jurisdiction, permitted_purposes, retention_days, created_by) VALUES ($1,$2,'test_source','subject_provided','declared','NG',ARRAY['employment_check'],30,$3)", [sourceId, tenantId, userId]);

  outcome.protectedFactorRejected = await expectRejected("protected factor", {
    text: "INSERT INTO intelligence_evidence_records (id, tenant_id, candidate_id, source_id, purpose_code, factor_code, assertion_direction, confidence, observed_at, expires_at, evidence_sha256, provenance_status, created_by) VALUES ($1,$2,$3,$4,'employment_check','biometric',1,0.9,now(),now()+interval '1 day',$5,'independently_confirmed',$6)",
    values: [randomUUID(), tenantId, candidateId, sourceId, "a".repeat(64), userId],
  }, "sensitive and biometric factors cannot be scored");

  const auditId = randomUUID();
  await client.query("INSERT INTO intelligence_audit_events (id, tenant_id, event_type, actor_user_id, subject_candidate_id, resource_type, resource_id, event_sha256, metadata) VALUES ($1,$2,'trigger_test',$3,$4,'test',$5,$6,'{}'::jsonb)", [auditId, tenantId, userId, candidateId, randomUUID(), "b".repeat(64)]);
  outcome.auditUpdateRejected = await expectRejected("audit update", { text: "UPDATE intelligence_audit_events SET event_type = 'tampered' WHERE id = $1", values: [auditId] }, "intelligence audit events are append-only");
  outcome.auditDeleteRejected = await expectRejected("audit delete", { text: "DELETE FROM intelligence_audit_events WHERE id = $1", values: [auditId] }, "intelligence audit events are append-only");
  await client.query("ROLLBACK");
  process.stdout.write(`${JSON.stringify({ event: "0011_trigger_test_passed", ...outcome })}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${JSON.stringify({ event: "0011_trigger_test_failed", error: error instanceof Error ? error.message : "unknown", ...outcome })}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

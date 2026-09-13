#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.BIS_RECONCILIATION_BENCHMARK_DATABASE_URL ?? "";
const eventCount = Number(process.env.BIS_RECONCILIATION_BENCHMARK_EVENTS ?? 1000);
const workerCount = Number(process.env.BIS_RECONCILIATION_BENCHMARK_WORKERS ?? 8);
if (process.env.BIS_ALLOW_ISOLATED_RECONCILIATION_BENCHMARK !== "1") throw new Error("BIS_ALLOW_ISOLATED_RECONCILIATION_BENCHMARK=1 is required");
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl) || process.env.NODE_ENV === "production" || /(?:prod|production)/i.test(databaseUrl)) throw new Error("An explicit non-production PostgreSQL URL is required");
if (!Number.isInteger(eventCount) || eventCount < 100 || eventCount > 20000) throw new Error("BIS_RECONCILIATION_BENCHMARK_EVENTS must be an integer from 100 to 20000");
if (!Number.isInteger(workerCount) || workerCount < 2 || workerCount > 64) throw new Error("BIS_RECONCILIATION_BENCHMARK_WORKERS must be an integer from 2 to 64");

const { Client } = pg;
const control = new Client({ connectionString: databaseUrl });
const ids = { tenant: 0, requester: 0, reviewer: 0, candidate: 0, policy: randomUUID(), meter: randomUUID() };
const summary = { migration13: false, eventCount, workerCount, claimed: 0, duplicateClaims: 0, unclaimed: 0, elapsedMs: 0, claimsPerSecond: 0, p50ClaimMs: 0, p95ClaimMs: 0, p99ClaimMs: 0, cleaned: false };
const nowNs = () => process.hrtime.bigint();
const elapsedMs = (start) => Number(nowNs() - start) / 1e6;
function percentile(values, p) { if (!values.length) return 0; const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1); return values.slice().sort((a, b) => a - b)[index]; }
async function q(text, values) { return control.query(text, values); }
async function cleanup() {
  if (!ids.tenant) return;
  await q("DELETE FROM intelligence_assessment_billing_reconciliations WHERE tenant_id=$1", [ids.tenant]).catch(() => undefined);
  await q("DELETE FROM intelligence_assessment_billing_events WHERE tenant_id=$1", [ids.tenant]).catch(() => undefined);
  await q("DELETE FROM intelligence_assessment_metering_policies WHERE tenant_id=$1", [ids.tenant]).catch(() => undefined);
  await q("DELETE FROM investigation_score_assessments WHERE tenant_id=$1", [ids.tenant]).catch(() => undefined);
  await q("DELETE FROM investigation_score_policies WHERE tenant_id=$1", [ids.tenant]).catch(() => undefined);
  await q("DELETE FROM candidate_profiles WHERE id=$1", [ids.candidate]).catch(() => undefined);
  await q("DELETE FROM users WHERE id IN ($1,$2)", [ids.requester,ids.reviewer]).catch(() => undefined);
  await q("DELETE FROM tenants WHERE id=$1", [ids.tenant]).catch(() => undefined);
}

try {
  await control.connect();
  const migration = await q("SELECT 1 FROM bis_migrations.schema_migrations WHERE migration_index=13 AND tag='0013_intelligence_billing_reconciliation'");
  if (migration.rowCount !== 1) throw new Error("Migration 0013 is required");
  summary.migration13 = true;
  const suffix = randomUUID().replace(/-/g, "");
  ids.tenant = (await q("INSERT INTO tenants (name,slug,\"contactEmail\") VALUES ($1,$2,$3) RETURNING id", [`Reconciliation Benchmark ${suffix}`,`recon-bench-${suffix.slice(0,38)}`,`bench-${suffix}@invalid.example`])).rows[0].id;
  ids.requester = (await q("INSERT INTO users (\"tenantId\",\"openId\",name,email,role) VALUES ($1,$2,'Requester',$3,'admin') RETURNING id",[ids.tenant,`requester-${suffix}`,`requester-${suffix}@invalid.example`])).rows[0].id;
  ids.reviewer = (await q("INSERT INTO users (\"tenantId\",\"openId\",name,email,role) VALUES ($1,$2,'Reviewer',$3,'admin') RETURNING id",[ids.tenant,`reviewer-${suffix}`,`reviewer-${suffix}@invalid.example`])).rows[0].id;
  ids.candidate = (await q("INSERT INTO candidate_profiles (\"candidateRef\",\"tenantId\",\"firstName\",\"lastName\",email) VALUES ($1,$2,'Synthetic','Benchmark',$3) RETURNING id",[`CAND-${suffix.slice(0,20)}`,ids.tenant,`candidate-${suffix}@invalid.example`])).rows[0].id;
  await q("INSERT INTO investigation_score_policies (id,tenant_id,policy_code,version,status,methodology,approved_by,approved_at,effective_from,created_by) VALUES ($1,$2,'bench',1,'active','{}'::jsonb,$3,now(),now(),$3)",[ids.policy,ids.tenant,ids.requester]);
  await q("INSERT INTO intelligence_assessment_metering_policies (id,tenant_id,policy_code,enabled,prepaid_price_kobo,approved_by,approved_at,created_by) VALUES ($1,$2,'bench',true,0,$3,now(),$3)",[ids.meter,ids.tenant,ids.requester]);
  await q(`WITH inserted AS (
    INSERT INTO investigation_score_assessments (id,tenant_id,candidate_id,policy_id,score,confidence,coverage,freshness,decision_support_status,reason_codes,input_sha256,expires_at,created_by)
    SELECT gen_random_uuid(),$1,$2,$3,70,0.9,0.9,0.9,'decision_support_only',ARRAY['adequate_evidence'],repeat(md5(g::text),2),now()+interval '1 day',$4 FROM generate_series(1,$5) g RETURNING id
  ), events AS (
    INSERT INTO intelligence_assessment_billing_events (id,tenant_id,assessment_id,metering_policy_id,requested_by,amount_kobo,status,idempotency_key,tigerbeetle_transfer_id,attempt_count)
    SELECT gen_random_uuid(),$1,id,$6,$4,0,'awaiting_reconciliation',id,substr(md5(id::text),1,32),10 FROM inserted RETURNING id,tenant_id,tigerbeetle_transfer_id
  ) INSERT INTO intelligence_assessment_billing_reconciliations (id,billing_event_id,tenant_id,deterministic_transfer_id,status,last_error_code,requested_by)
  SELECT gen_random_uuid(),id,tenant_id,tigerbeetle_transfer_id,'open','benchmark',$4 FROM events`, [ids.tenant,ids.candidate,ids.policy,ids.requester,eventCount,ids.meter]);

  const workers = Array.from({ length: workerCount }, async () => {
    const worker = new Client({ connectionString: databaseUrl }); const latencies=[]; let localClaims=0;
    await worker.connect();
    try {
      while (true) {
        const started=nowNs(); await worker.query("BEGIN");
        const claimed=await worker.query(`WITH next_case AS (
          SELECT id FROM intelligence_assessment_billing_reconciliations
          WHERE tenant_id=$1 AND status='open' ORDER BY requested_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE intelligence_assessment_billing_reconciliations r
          SET status='under_review',reviewed_by=$2,reviewed_at=now(),updated_at=now()
          FROM next_case WHERE r.id=next_case.id AND r.requested_by<>$2 RETURNING r.id`,[ids.tenant,ids.reviewer]);
        await worker.query("COMMIT");
        if (claimed.rowCount === 0) break;
        localClaims++; latencies.push(elapsedMs(started));
      }
    } finally { await worker.query("ROLLBACK").catch(() => undefined); await worker.end(); }
    return { localClaims, latencies };
  });
  const started=nowNs(); const workerResults=await Promise.all(workers); summary.elapsedMs=elapsedMs(started);
  const latencies=workerResults.flatMap((entry)=>entry.latencies); summary.claimed=workerResults.reduce((total,entry)=>total+entry.localClaims,0);
  summary.claimsPerSecond=Number((summary.claimed/(summary.elapsedMs/1000)).toFixed(2)); summary.p50ClaimMs=Number(percentile(latencies,0.5).toFixed(3)); summary.p95ClaimMs=Number(percentile(latencies,0.95).toFixed(3)); summary.p99ClaimMs=Number(percentile(latencies,0.99).toFixed(3));
  const state=await q("SELECT status,count(*)::int count FROM intelligence_assessment_billing_reconciliations WHERE tenant_id=$1 GROUP BY status",[ids.tenant]);
  const underReview=Number(state.rows.find((row)=>row.status==="under_review")?.count??0); const open=Number(state.rows.find((row)=>row.status==="open")?.count??0);
  summary.unclaimed=open; summary.duplicateClaims=Math.max(0,summary.claimed-underReview);
  if (summary.claimed !== eventCount || underReview !== eventCount || open !== 0 || summary.duplicateClaims !== 0) throw new Error(`Claim invariant failed: claimed=${summary.claimed} under_review=${underReview} open=${open} duplicates=${summary.duplicateClaims}`);
  await cleanup(); summary.cleaned=true;
  process.stdout.write(`${JSON.stringify({ event:"intelligence_reconciliation_benchmark_passed", ...summary })}\n`);
} catch(error) { await cleanup().catch(()=>undefined); process.stderr.write(`${JSON.stringify({ event:"intelligence_reconciliation_benchmark_failed", error:error instanceof Error?error.message:"unknown", ...summary })}\n`); process.exitCode=1; }
finally { await control.end().catch(()=>undefined); }

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL ?? process.env.BIS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BIS_DATABASE_URL is required");
const ROW_COUNT = 10_000;
const PAGE_SIZE = 100;
const INDEX_NAME = "pii_forensic_audit_events_tenant_created_id_desc_idx";

async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
}

function planSummary(document) {
  const plan = document[0]?.Plan;
  if (!plan) throw new Error("EXPLAIN JSON did not include a root plan");
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(plan);
  const index = nodes.find((node) => node["Index Name"] === INDEX_NAME);
  assert.ok(index, `expected ${INDEX_NAME} in the plan`);
  return {
    rootNode: plan["Node Type"],
    indexNode: index["Node Type"],
    indexName: index["Index Name"],
    actualRows: index["Actual Rows"],
    actualLoops: index["Actual Loops"],
    planningMs: document[0]?.["Planning Time"],
    executionMs: document[0]?.["Execution Time"],
    sharedHitBlocks: index["Shared Hit Blocks"] ?? 0,
    sharedReadBlocks: index["Shared Read Blocks"] ?? 0,
  };
}

async function explain(client, params) {
  const result = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT e.id,e.created_at,e.event_type,e.detail,e.integrity_hash,e.integrity_scheme
         FROM pii_forensic_audit_events e
        WHERE e.tenant_id=$1
          AND ($2::timestamptz IS NULL OR (e.created_at,e.id) < ($2::timestamptz,$3::bigint))
        ORDER BY e.created_at DESC,e.id DESC
        LIMIT $4`,
    params,
  );
  return planSummary(result.rows[0]?.["QUERY PLAN"]);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  try {
    const tenant = (await client.query(
      `INSERT INTO tenants (name,slug,status) VALUES ($1,$2,'active') RETURNING id`,
      [`Forensic explain ${suffix}`, `forensic-explain-${suffix}`],
    )).rows[0].id;

    await client.query("BEGIN");
    await setTenant(client, tenant);
    await client.query(
      `INSERT INTO pii_forensic_audit_events (tenant_id,event_type,detail,integrity_hash,integrity_scheme,created_at)
       SELECT $1,'rotation_progress','{"worker_version":"synthetic-explain"}'::jsonb,repeat('a',64),'legacy_json_v1',NOW() - make_interval(secs => series)
         FROM generate_series(1,$2) AS series`,
      [tenant, ROW_COUNT],
    );
    await client.query("COMMIT");
    await client.query("ANALYZE pii_forensic_audit_events");

    await client.query("BEGIN");
    await setTenant(client, tenant);
    const cursor = (await client.query(
      `SELECT id,created_at FROM pii_forensic_audit_events WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC OFFSET 5000 LIMIT 1`,
      [tenant],
    )).rows[0];
    assert.ok(cursor, "synthetic cursor row must exist");
    const initialPage = await explain(client, [tenant, null, null, PAGE_SIZE + 1]);
    const deepPage = await explain(client, [tenant, cursor.created_at, cursor.id, PAGE_SIZE + 1]);
    await client.query("COMMIT");

    process.stdout.write(`${JSON.stringify({
      status: "pass",
      rowCount: ROW_COUNT,
      pageSize: PAGE_SIZE,
      cursorOffset: 5000,
      indexName: INDEX_NAME,
      initialPage,
      deepPage,
    })}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`PII forensic keyset EXPLAIN test failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

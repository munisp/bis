import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const CONFIRMATION = "RUN_READ_ONLY_PII_POST_CUTOVER_SMOKE";
const expectedDatabase = (process.env.BIS_PII_SMOKE_EXPECTED_DATABASE ?? "").trim();
const tenantIdRaw = (process.env.BIS_PII_SMOKE_TENANT_ID ?? "").trim();
const rotationRef = (process.env.BIS_PII_SMOKE_ROTATION_REF ?? "").trim();
const databaseUrl = (process.env.BIS_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();

function fail(message: string): never { throw new Error(message); }
function positiveInteger(value: string, name: string): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) fail(`${name} must be a positive integer.`);
  return Number(value);
}
function expectedMigrationChecksum(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return createHash("sha256").update(readFileSync(resolve(root, "drizzle", "0016_pii_transit_rotation_and_forensics.sql"), "utf8")).digest("hex");
}

if (process.env.BIS_PII_POST_CUTOVER_SMOKE_CONFIRM !== CONFIRMATION) {
  fail(`Refusing post-cutover smoke test: set BIS_PII_POST_CUTOVER_SMOKE_CONFIRM=${CONFIRMATION}.`);
}
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) fail("BIS_DATABASE_URL or DATABASE_URL must be a PostgreSQL connection URL.");
if (!expectedDatabase) fail("BIS_PII_SMOKE_EXPECTED_DATABASE is required to bind the read-only check to an approved database name.");
if (rotationRef && !/^BIS-PR-[A-Z0-9]{18}$/.test(rotationRef)) fail("BIS_PII_SMOKE_ROTATION_REF must be a valid rotation reference.");
const tenantId = positiveInteger(tenantIdRaw, "BIS_PII_SMOKE_TENANT_ID");

async function scalar(client: Client, query: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(query, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl, statement_timeout: 5_000, query_timeout: 7_500 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const identity = await client.query<{ database_name: string; read_only: string }>("SELECT current_database() AS database_name, current_setting('transaction_read_only') AS read_only");
    const databaseName = identity.rows[0]?.database_name ?? "";
    if (databaseName !== expectedDatabase || identity.rows[0]?.read_only !== "on") fail("Refusing smoke result: connection did not resolve to the expected database in a read-only transaction.");

    const migration = await client.query<{ checksum: string }>("SELECT checksum FROM bis_migrations.schema_migrations WHERE migration_index=16 AND tag='0016_pii_transit_rotation_and_forensics'");
    if (migration.rows[0]?.checksum !== expectedMigrationChecksum()) fail("Migration 0016 is missing or its recorded checksum differs from the reviewed source.");

    const requiredTables = ["pii_rotation_jobs", "pii_rotation_job_items", "pii_forensic_audit_events", "pii_key_compromise_incidents", "pii_key_compromise_impacts"];
    const tableCount = await scalar(client, "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [requiredTables]);
    if (tableCount !== requiredTables.length) fail("Migration 0016 required PII rotation or forensic tables are missing.");
    const triggerCount = await scalar(client, "SELECT COUNT(*)::text AS count FROM pg_trigger WHERE tgrelid IN ('pii_envelope_records'::regclass,'pii_blind_indexes'::regclass,'pii_rotation_jobs'::regclass,'pii_rotation_job_items'::regclass,'pii_forensic_audit_events'::regclass) AND NOT tgisinternal");
    if (triggerCount < 7) fail("Expected PII tenancy, rotation, and forensic integrity triggers are missing.");

    const providerShapeViolations = await scalar(client, `SELECT COUNT(*)::text AS count FROM pii_envelope_records WHERE NOT (
      (crypto_provider='legacy_local_aes' AND nonce IS NOT NULL AND provider_key_version IS NULL)
      OR (crypto_provider='vault_transit' AND nonce IS NULL AND provider_key_version IS NOT NULL AND provider_key_version > 0)
    )`);
    const registrySubjectViolations = await scalar(client, `SELECT COUNT(*)::text AS count FROM (
      SELECT e.id FROM pii_envelope_records e JOIN candidate_profiles c ON e.subject_kind='candidate_profile' AND c.id=e.subject_id JOIN pii_encryption_key_registry k ON k.id=e.key_registry_id WHERE e.tenant_id <> c."tenantId" OR e.tenant_id <> k.tenant_id OR e.key_version <> k.key_version OR e.crypto_provider <> k.provider
      UNION ALL
      SELECT e.id FROM pii_envelope_records e JOIN criminal_records c ON e.subject_kind='criminal_record' AND c.id=e.subject_id JOIN pii_encryption_key_registry k ON k.id=e.key_registry_id WHERE e.tenant_id <> c."tenantId" OR e.tenant_id <> k.tenant_id OR e.key_version <> k.key_version OR e.crypto_provider <> k.provider
    ) violations`);
    const forensicDetailViolations = await scalar(client, `SELECT COUNT(*)::text AS count FROM pii_forensic_audit_events e CROSS JOIN LATERAL jsonb_object_keys(e.detail) key WHERE key NOT IN ('record_count','registry_id','source_registry_id','target_registry_id','rotation_job_id','reason_code','error_code','actor_role','source_key_version','target_key_version','provider_key_version','evidence_ref','channel','dry_run','checkpoint','state','worker_version','incident_ref')`);
    if (providerShapeViolations || registrySubjectViolations || forensicDetailViolations) fail("PII Transit integrity verification found a provider, tenant, registry, or forensic-detail violation.");

    let tenantActiveEncryptionKeys: number | null = null;
    let tenantActiveBlindIndexKeys: number | null = null;
    let tenantOpenRotationJobs: number | null = null;
    if (tenantId !== null) {
      tenantActiveEncryptionKeys = await scalar(client, "SELECT COUNT(*)::text AS count FROM pii_encryption_key_registry WHERE tenant_id=$1 AND status='active' AND provider='vault_transit'", [tenantId]);
      tenantActiveBlindIndexKeys = await scalar(client, "SELECT COUNT(*)::text AS count FROM pii_blind_index_key_registry WHERE tenant_id=$1 AND status='active' AND provider='vault_transit'", [tenantId]);
      tenantOpenRotationJobs = await scalar(client, "SELECT COUNT(*)::text AS count FROM pii_rotation_jobs WHERE tenant_id=$1 AND state IN ('queued','leased','failed')", [tenantId]);
      if (tenantActiveEncryptionKeys !== 1 || tenantActiveBlindIndexKeys !== 1 || tenantOpenRotationJobs !== 0) fail("Tenant post-cutover state requires exactly one active Transit key per class and no queued, leased, or failed rotation job.");
    }

    let rotation: Record<string, unknown> | null = null;
    if (rotationRef) {
      const result = await client.query<{ state: string; expected_count: number | null; rotated_count: number; failed_count: number; planned_count: string; rotated_items: string; failed_items: string; audit_events: string }>(
        `SELECT j.state,j.expected_count,j.rotated_count,j.failed_count,
                (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='planned') AS planned_count,
                (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='rotated') AS rotated_items,
                (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='failed') AS failed_items,
                (SELECT COUNT(*)::text FROM pii_forensic_audit_events f WHERE f.rotation_job_id=j.id) AS audit_events
           FROM pii_rotation_jobs j WHERE j.rotation_ref=$1${tenantId === null ? "" : " AND j.tenant_id=$2"}`,
        tenantId === null ? [rotationRef] : [rotationRef, tenantId],
      );
      const row = result.rows[0];
      if (!row || row.state !== "completed" || row.expected_count === null || row.expected_count !== row.rotated_count || row.failed_count !== 0 || row.planned_count !== "0" || row.failed_items !== "0" || row.rotated_items !== String(row.expected_count) || Number(row.audit_events) < 2) fail("Named rotation did not reach a complete, reconciled, failure-free state.");
      rotation = { rotationRef, state: row.state, expectedCount: row.expected_count, rotatedCount: row.rotated_count, plannedItems: Number(row.planned_count), rotatedItems: Number(row.rotated_items), failedItems: Number(row.failed_items), auditEvents: Number(row.audit_events) };
    }

    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({ status: "pass", databaseName, migration: "0016_pii_transit_rotation_and_forensics", triggerCount, providerShapeViolations, registrySubjectViolations, forensicDetailViolations, tenantId, tenantActiveEncryptionKeys, tenantActiveBlindIndexKeys, tenantOpenRotationJobs, rotation })}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`PII post-cutover smoke verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

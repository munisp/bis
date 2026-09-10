import { getPgPool } from "../server/db";
import { runPiiRotationWorker } from "../server/piiRotationWorker";

const rotationRef = (process.env.BIS_PII_ROTATION_JOB_REF ?? "").trim();
if (process.env.BIS_PII_ROTATION_DRY_RUN_CONFIRM !== "VALIDATE_PII_ROTATION_PLAN") {
  throw new Error("Refusing PII rotation dry run: set BIS_PII_ROTATION_DRY_RUN_CONFIRM=VALIDATE_PII_ROTATION_PLAN after backup and review.");
}
if (!/^BIS-PR-[A-Z0-9]{18}$/.test(rotationRef)) {
  throw new Error("Refusing PII rotation dry run: BIS_PII_ROTATION_JOB_REF must be an explicit rotation reference.");
}

async function run(): Promise<void> {
  const pool = await getPgPool();
  if (!pool) throw new Error("PostgreSQL is unavailable.");
  try {
    const before = await pool.query<{ id: string; dry_run: boolean; state: string; tenant_id: number; active_envelopes: string }>(
      `SELECT j.id,j.dry_run,j.state,j.tenant_id,COUNT(e.id)::text AS active_envelopes
         FROM pii_rotation_jobs j
         LEFT JOIN pii_envelope_records e ON e.tenant_id=j.tenant_id AND e.retired_at IS NULL
        WHERE j.rotation_ref=$1
        GROUP BY j.id,j.dry_run,j.state,j.tenant_id`,
      [rotationRef],
    );
    const job = before.rows[0];
    if (!job || !job.dry_run || job.state !== "queued") throw new Error("Dry-run job must exist, be queued, and have dry_run=true.");
    const result = await runPiiRotationWorker(rotationRef);
    if (result.leased !== 1 || result.dryRuns !== 1 || result.rotated !== 0 || result.failed !== 0) throw new Error("PII rotation dry-run result violated no-write invariants.");
    const after = await pool.query<{ state: string; dry_run: boolean; active_envelopes: string; planned: string; rotated: string; failed: string }>(
      `SELECT j.state,j.dry_run,
              (SELECT COUNT(*)::text FROM pii_envelope_records e WHERE e.tenant_id=j.tenant_id AND e.retired_at IS NULL) AS active_envelopes,
              (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='planned') AS planned,
              (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='rotated') AS rotated,
              (SELECT COUNT(*)::text FROM pii_rotation_job_items i WHERE i.rotation_job_id=j.id AND i.state='failed') AS failed
         FROM pii_rotation_jobs j
        WHERE j.rotation_ref=$1`,
      [rotationRef],
    );
    const evidence = after.rows[0];
    if (!evidence || evidence.state !== "dry_run_complete" || !evidence.dry_run || evidence.active_envelopes !== job.active_envelopes || evidence.rotated !== "0" || evidence.failed !== "0") {
      throw new Error("PII rotation dry run changed active data or did not preserve dry-run state.");
    }
    process.stdout.write(`${JSON.stringify({ rotationRef, tenantId: job.tenant_id, expectedActiveEnvelopes: Number(job.active_envelopes), plannedItems: Number(evidence.planned), result })}\n`);
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`PII rotation dry-run validation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});

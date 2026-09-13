import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { getPgPool } from "./db";

const BATCH_SIZE = 200;

function eventHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function runInvestigationIntelligenceMaintenance() {
  const pool = await getPgPool();
  if (!pool) throw new Error("Investigation intelligence maintenance requires PostgreSQL");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expiredAssessments = await client.query(
      "UPDATE investigation_score_assessments SET superseded_at = COALESCE(superseded_at, now()) WHERE superseded_at IS NULL AND expires_at <= now() RETURNING id, tenant_id, candidate_id",
    );
    const expiredMonitoring = await client.query(
      "UPDATE intelligence_monitoring_registrations SET status = 'expired', updated_at = now() WHERE status IN ('active','paused') AND expires_at <= now() RETURNING id, tenant_id, candidate_id",
    );
    const staleEvidence = await client.query(
      "SELECT id, tenant_id, candidate_id FROM intelligence_evidence_records WHERE expires_at <= now() AND provenance_status NOT IN ('withdrawn','contradicted') ORDER BY expires_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED",
      [BATCH_SIZE],
    );
    let reviewsCreated = 0;
    for (const evidence of staleEvidence.rows) {
      const duplicate = await client.query(
        "SELECT id FROM intelligence_review_cases WHERE tenant_id = $1 AND candidate_id = $2 AND review_type = 'freshness' AND status IN ('open','assigned','in_review') LIMIT 1",
        [evidence.tenant_id, evidence.candidate_id],
      );
      if (duplicate.rowCount) continue;
      const reviewId = randomUUID();
      await client.query(
        "INSERT INTO intelligence_review_cases (id, tenant_id, candidate_id, review_type, priority, status, due_at, created_by) VALUES ($1,$2,$3,'freshness','normal','open',now() + interval '48 hours',1)",
        [reviewId, evidence.tenant_id, evidence.candidate_id],
      );
      await client.query(
        "INSERT INTO intelligence_audit_events (id, tenant_id, event_type, actor_user_id, subject_candidate_id, resource_type, resource_id, event_sha256, metadata) VALUES ($1,$2,'evidence_freshness_review_created',NULL,$3,'review_case',$4,$5,$6::jsonb)",
        [randomUUID(), evidence.tenant_id, evidence.candidate_id, reviewId, eventHash({ type: "evidence_freshness_review_created", tenantId: evidence.tenant_id, candidateId: evidence.candidate_id, evidenceId: evidence.id }), JSON.stringify({ evidenceId: evidence.id, reason: "evidence_expired" })],
      );
      reviewsCreated += 1;
    }
    await client.query("COMMIT");
    return { expiredAssessments: expiredAssessments.rowCount ?? 0, expiredMonitoring: expiredMonitoring.rowCount ?? 0, staleEvidenceReviewed: staleEvidence.rowCount ?? 0, reviewsCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInvestigationIntelligenceMaintenance()
    .then((result) => process.stdout.write(`${JSON.stringify({ event: "investigation_intelligence_maintenance_complete", ...result })}\n`))
    .catch((error) => { process.stderr.write(`${JSON.stringify({ event: "investigation_intelligence_maintenance_failed", error: error instanceof Error ? error.message : "unknown" })}\n`); process.exitCode = 1; });
}

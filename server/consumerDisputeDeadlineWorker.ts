import { createHash, randomUUID } from "node:crypto";
import { getPgPool } from "./db";
import { appendConsumerDisputeEvent } from "./consumerDisputes";

const MAX_ESCALATIONS_PER_RUN = 200;

type DeadlineKind = "source_notice_due" | "reinvestigation_due" | "result_notice_due" | "method_description_due";

type DueCase = {
  case_id: string;
  case_ref: string;
  tenant_id: number;
  assigned_to_user_id: number | null;
  escalation_type: DeadlineKind;
  due_at: string;
};

export type ConsumerDisputeDeadlineWorkerResult = {
  scanned: number;
  escalationsCreated: number;
  alertsCreated: number;
  noticesQueued: number;
  skippedDuplicate: number;
};

function deadlineLabel(type: DeadlineKind): string {
  switch (type) {
    case "source_notice_due": return "source-notice";
    case "reinvestigation_due": return "reinvestigation";
    case "result_notice_due": return "result-notice";
    case "method_description_due": return "method-description";
  }
}

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new Error("consumer-dispute deadline worker requires PostgreSQL");
  return pool;
}

/**
 * Claims elapsed case deadlines with SKIP LOCKED and creates one escalation per
 * case/deadline. It performs no network I/O: an external alert/notifier must
 * consume the durable alert/notice rows and acknowledge its own delivery.
 */
export async function runConsumerDisputeDeadlineWorker(now = new Date()): Promise<ConsumerDisputeDeadlineWorkerResult> {
  const pool = await poolOrThrow();
  const client = await pool.connect();
  const result: ConsumerDisputeDeadlineWorkerResult = {
    scanned: 0, escalationsCreated: 0, alertsCreated: 0, noticesQueued: 0, skippedDuplicate: 0,
  };
  try {
    await client.query("BEGIN");
    const candidates = await client.query<DueCase>(
      `SELECT c.id AS case_id, c.case_ref, c.tenant_id, c.assigned_to_user_id, due.escalation_type, due.due_at
         FROM consumer_dispute_cases c
         CROSS JOIN LATERAL (VALUES
           ('source_notice_due'::text, c.source_notice_due_at),
           ('reinvestigation_due'::text, COALESCE(c.extension_due_at, c.reinvestigation_due_at)),
           ('result_notice_due'::text, c.result_notice_due_at),
           ('method_description_due'::text, c.method_description_due_at)
         ) AS due(escalation_type, due_at)
        WHERE c.status NOT IN ('resolved', 'withdrawn')
          AND due.due_at IS NOT NULL
          AND due.due_at <= $1::timestamptz
        ORDER BY due.due_at ASC, c.id ASC
        FOR UPDATE OF c SKIP LOCKED
        LIMIT $2`,
      [now.toISOString(), MAX_ESCALATIONS_PER_RUN],
    );
    result.scanned = candidates.rows.length;

    for (const candidate of candidates.rows) {
      const escalation = await client.query<{ id: string }>(
        `INSERT INTO consumer_dispute_deadline_escalations (case_id, escalation_type, due_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (case_id, escalation_type, due_at) DO NOTHING
         RETURNING id`,
        [candidate.case_id, candidate.escalation_type, candidate.due_at],
      );
      if (!escalation.rows[0]) {
        result.skippedDuplicate += 1;
        continue;
      }
      result.escalationsCreated += 1;
      const label = deadlineLabel(candidate.escalation_type);
      const subjectRef = `${candidate.case_ref}:${label}:${new Date(candidate.due_at).toISOString()}`;
      const alert = await client.query(
        `INSERT INTO alerts
           ("tenantId", "type", "severity", "title", "body", "subjectRef", "sourceService", "read", "acknowledged", "resolved", "dismissed")
         SELECT $1, 'system', 'high', $2, $3, $4, 'consumer-dispute-deadline-worker', FALSE, FALSE, FALSE, FALSE
         WHERE NOT EXISTS (
           SELECT 1 FROM alerts WHERE "sourceService" = 'consumer-dispute-deadline-worker' AND "subjectRef" = $4 AND "resolved" = FALSE
         )`,
        [
          candidate.tenant_id,
          `Consumer dispute ${label} deadline elapsed`,
          `Case ${candidate.case_ref} requires immediate assigned-caseworker and supervisor review.`,
          subjectRef,
        ],
      );
      result.alertsCreated += alert.rowCount ?? 0;
      const noticeRef = `BIS-NOT-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;
      const noticeDigest = createHash("sha256")
        .update(`${noticeRef}|${candidate.case_id}|${candidate.escalation_type}`)
        .digest("hex");
      const notice = await client.query(
        `INSERT INTO consumer_dispute_notices
           (notice_ref, case_id, notice_type, template_version, delivery_channel, recipient_kind, delivery_status, content_sha256)
         SELECT $1, $2, 'extension', 'consumer-dispute-deadline-escalation-v1', 'portal', 'institution', 'queued', $3
         WHERE NOT EXISTS (
           SELECT 1 FROM consumer_dispute_notices
            WHERE case_id = $2 AND notice_type = 'extension' AND template_version = 'consumer-dispute-deadline-escalation-v1'
              AND delivery_status IN ('queued', 'sent', 'delivered')
         )`,
        [noticeRef, candidate.case_id, noticeDigest],
      );
      result.noticesQueued += notice.rowCount ?? 0;
      await appendConsumerDisputeEvent(client, {
        caseId: candidate.case_id,
        caseRef: candidate.case_ref,
        actorUserId: null,
        actorKind: "system",
        eventType: "deadline_escalated",
        detail: {
          escalationId: escalation.rows[0].id,
          escalationType: candidate.escalation_type,
          dueAt: candidate.due_at,
          assignedToUserId: candidate.assigned_to_user_id,
        },
      });
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("consumerDisputeDeadlineWorker.ts") || process.argv[1]?.endsWith("consumerDisputeDeadlineWorker.js")) {
  runConsumerDisputeDeadlineWorker().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error: unknown) => {
      process.stderr.write(`consumer-dispute deadline worker failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    },
  );
}

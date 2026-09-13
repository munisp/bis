import { createHash } from "node:crypto";
import { getPgPool } from "./db";
import { decryptPiiEnvelope, piiAad } from "./piiEnvelopeCrypto";
import { tenantEncryptionRegistryById } from "./piiKeyRegistry";
import { beginTenantTransaction } from "./tenantRls";

const DISPATCH_BATCH_SIZE = 25;
const MAX_DISPATCH_ATTEMPTS = 12;

type LeasedNotice = {
  id: string;
  tenant_id: number;
  case_id: string;
  case_ref: string;
  case_status: string;
  delivery_id: string;
  notice_type: "pre_adverse" | "final_adverse" | "undeliverable" | "dispute_hold" | "dispute_result";
  channel: "portal" | "email" | "postal" | "manual";
  delivery_status: string;
  candidate_id: number;
  payload_ciphertext: Buffer;
  payload_nonce: Buffer | null;
  payload_key_version: string;
  payload_crypto_provider: "legacy_local_aes" | "vault_transit";
  payload_provider_key_version: number | null;
  payload_key_registry_id: number | null;
  payload_sha256: string;
  attempt_count: number;
};

export type ComplianceNoticeDeliveryResult = { leased: number; delivered: number; retried: number; deadLettered: number; cancelled: number };

class NoticeDeliveryAdapterNotInstalledError extends Error {
  constructor(readonly channel: string) { super(`No approved notice-delivery adapter is installed for ${channel}.`); }
}

function boundedBackoff(attempt: number): string {
  return `${Math.min(300, 2 ** Math.min(attempt, 8))} seconds`;
}

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new Error("compliance notice delivery worker requires PostgreSQL");
  return pool;
}

async function appendSystemEvent(client: import("pg").PoolClient, input: { caseId: string; eventType: string; detail: Record<string, unknown> }): Promise<void> {
  const auditHmac = process.env.AUDIT_HMAC_SECRET;
  if (!auditHmac) throw new Error("AUDIT_HMAC_SECRET is required for compliance notice worker");
  const createdAt = new Date().toISOString();
  const canonical = JSON.stringify({ adverseActionCaseId: input.caseId, actorUserId: null, eventType: input.eventType, detail: input.detail, createdAt });
  const integrityHash = (await import("node:crypto")).createHmac("sha256", auditHmac).update(canonical).digest("hex");
  await client.query(
    `INSERT INTO compliance_adverse_action_events (adverse_action_case_id, actor_user_id, event_type, detail, integrity_hash, created_at)
     VALUES ($1,NULL,$2,$3::jsonb,$4,$5::timestamptz)`,
    [input.caseId, input.eventType, JSON.stringify(input.detail), integrityHash, createdAt],
  );
}

async function leaseNotices(): Promise<LeasedNotice[]> {
  const pool = await poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE compliance_notice_delivery_outbox
          SET state = 'pending', leased_at = NULL, available_at = NOW(), updated_at = NOW(),
              last_error_code = COALESCE(last_error_code, 'COMPLIANCE_NOTICE_LEASE_EXPIRED')
        WHERE state = 'leased' AND leased_at < NOW() - INTERVAL '5 minutes'`,
    );
    const rows = await client.query<LeasedNotice>(
      `SELECT o.id, o.tenant_id, o.adverse_action_case_id AS case_id, c.case_ref, c.status AS case_status,
              o.delivery_id, d.notice_type, d.channel, d.status AS delivery_status, c.candidate_id,
              o.payload_ciphertext, o.payload_nonce, o.payload_key_version, o.payload_crypto_provider, o.payload_provider_key_version, o.payload_key_registry_id, o.payload_sha256, o.attempt_count
         FROM compliance_notice_delivery_outbox o
         JOIN compliance_adverse_action_cases c ON c.id = o.adverse_action_case_id
         JOIN compliance_notice_deliveries d ON d.id = o.delivery_id
        WHERE o.state = 'pending' AND o.available_at <= NOW()
        ORDER BY o.available_at ASC, o.created_at ASC
        FOR UPDATE OF o SKIP LOCKED
        LIMIT $1`,
      [DISPATCH_BATCH_SIZE],
    );
    for (const row of rows.rows) {
      await client.query(
        `UPDATE compliance_notice_delivery_outbox SET state = 'leased', leased_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND state = 'pending'`,
        [row.id],
      );
    }
    await client.query("COMMIT");
    return rows.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cancelLeased(event: LeasedNotice, code: string): Promise<void> {
  const pool = await poolOrThrow(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE compliance_notice_delivery_outbox SET state='cancelled',last_error_code=$2,updated_at=NOW() WHERE id=$1 AND state='leased'`, [event.id, code]);
    await client.query(`UPDATE compliance_notice_deliveries SET status='canceled' WHERE id=$1 AND status='queued'`, [event.delivery_id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

async function restoreOrDeadLetter(event: LeasedNotice, code: string, retryable: boolean): Promise<"retried" | "dead_letter"> {
  const pool = await poolOrThrow(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nextAttempt = event.attempt_count + 1;
    const terminal = !retryable || nextAttempt >= MAX_DISPATCH_ATTEMPTS;
    await client.query(
      `UPDATE compliance_notice_delivery_outbox
          SET state=$2,attempt_count=$3,last_error_code=$4,
              available_at=CASE WHEN $2='pending' THEN NOW()+$5::interval ELSE available_at END,
              updated_at=NOW()
        WHERE id=$1 AND state='leased'`,
      [event.id, terminal ? "dead_letter" : "pending", nextAttempt, code, boundedBackoff(nextAttempt)],
    );
    if (terminal) {
      await client.query(`UPDATE compliance_notice_deliveries SET status='manual_required' WHERE id=$1 AND status IN ('queued','sent')`, [event.delivery_id]);
      await client.query(`UPDATE compliance_adverse_action_cases SET status='manual_delivery',updated_at=NOW() WHERE id=$1 AND status NOT IN ('completed','canceled')`, [event.case_id]);
      await appendSystemEvent(client, { caseId: event.case_id, eventType: "manual_delivery_required", detail: { outboxId: event.id, deliveryId: event.delivery_id, failureCode: code, terminal: true } });
    }
    await client.query("COMMIT");
    return terminal ? "dead_letter" : "retried";
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

async function dispatchWithApprovedAdapter(event: LeasedNotice, payload: Record<string, unknown>): Promise<{ providerMessageRef: string }> {
  void event; void payload;
  throw new NoticeDeliveryAdapterNotInstalledError(event.channel);
}

async function markDelivered(event: LeasedNotice, providerMessageRef: string): Promise<void> {
  const pool = await poolOrThrow(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fresh = await client.query<{ status: string; delivery_status: string }>(
      `SELECT c.status,d.status AS delivery_status FROM compliance_adverse_action_cases c
       JOIN compliance_notice_deliveries d ON d.adverse_action_case_id=c.id
       WHERE c.id=$1 AND d.id=$2 FOR UPDATE`, [event.case_id, event.delivery_id],
    );
    const current = fresh.rows[0];
    if (!current || current.delivery_status !== "queued" || ["canceled", "paused_for_dispute", "undeliverable", "manual_delivery"].includes(current.status)) {
      await client.query(`UPDATE compliance_notice_delivery_outbox SET state='cancelled',last_error_code='COMPLIANCE_NOTICE_STATE_CHANGED',updated_at=NOW() WHERE id=$1 AND state='leased'`, [event.id]);
      await client.query("COMMIT"); return;
    }
    await client.query(`UPDATE compliance_notice_delivery_outbox SET state='delivered',delivered_at=NOW(),updated_at=NOW() WHERE id=$1 AND state='leased'`, [event.id]);
    await client.query(`UPDATE compliance_notice_deliveries SET status='delivered',sent_at=NOW(),delivered_at=NOW(),provider_message_ref=$2 WHERE id=$1`, [event.delivery_id, providerMessageRef]);
    if (event.notice_type === "pre_adverse") {
      await client.query(`UPDATE compliance_adverse_action_cases SET status='waiting',pre_notice_due_at=NOW(),final_notice_eligible_at=NOW()+make_interval(days=>waiting_period_days),updated_at=NOW() WHERE id=$1`, [event.case_id]);
      await appendSystemEvent(client, { caseId: event.case_id, eventType: "pre_notice_delivered", detail: { deliveryId: event.delivery_id } });
    } else if (event.notice_type === "final_adverse") {
      await client.query(`UPDATE compliance_adverse_action_cases SET status='completed',final_notice_sent_at=NOW(),updated_at=NOW() WHERE id=$1`, [event.case_id]);
      await appendSystemEvent(client, { caseId: event.case_id, eventType: "final_notice_delivered", detail: { deliveryId: event.delivery_id } });
      await appendSystemEvent(client, { caseId: event.case_id, eventType: "completed", detail: { deliveryId: event.delivery_id } });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

async function deliveryKey(event: LeasedNotice) {
  if (event.payload_crypto_provider !== "vault_transit" || !event.payload_key_registry_id || !event.payload_provider_key_version) {
    throw new Error("COMPLIANCE_NOTICE_VAULT_TRANSIT_METADATA_INVALID");
  }
  const pool = await poolOrThrow();
  const client = await pool.connect();
  try {
    await beginTenantTransaction(client, event.tenant_id);
    const key = await tenantEncryptionRegistryById(client, event.tenant_id, event.payload_key_registry_id);
    await client.query("COMMIT");
    return key;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function runComplianceNoticeDeliveryWorker(): Promise<ComplianceNoticeDeliveryResult> {
  const events = await leaseNotices();
  const result: ComplianceNoticeDeliveryResult = { leased: events.length, delivered: 0, retried: 0, deadLettered: 0, cancelled: 0 };
  for (const event of events) {
    try {
      if (event.delivery_status !== "queued" || ["canceled", "paused_for_dispute", "undeliverable", "manual_delivery", "completed"].includes(event.case_status)) {
        await cancelLeased(event, "COMPLIANCE_NOTICE_CASE_OR_DELIVERY_NOT_DISPATCHABLE"); result.cancelled += 1; continue;
      }
      const key = await deliveryKey(event);
      const payload = await decryptPiiEnvelope(key, piiAad(event.tenant_id, "candidate_profile", event.candidate_id, `compliance-notice-outbox:${event.id}`), { ciphertext: event.payload_ciphertext, keyVersion: event.payload_key_version, cryptoProvider: event.payload_crypto_provider });
      const calculated = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      if (calculated !== event.payload_sha256) throw new Error("COMPLIANCE_NOTICE_PAYLOAD_DIGEST_INVALID");
      const delivery = await dispatchWithApprovedAdapter(event, payload);
      await markDelivered(event, delivery.providerMessageRef);
      result.delivered += 1;
    } catch (error) {
      const code = error instanceof NoticeDeliveryAdapterNotInstalledError ? "COMPLIANCE_NOTICE_ADAPTER_NOT_INSTALLED" : error instanceof Error && error.message === "COMPLIANCE_NOTICE_PAYLOAD_DIGEST_INVALID" ? error.message : "COMPLIANCE_NOTICE_DISPATCH_FAILURE";
      const state = await restoreOrDeadLetter(event, code, code === "COMPLIANCE_NOTICE_DISPATCH_FAILURE");
      result[state === "dead_letter" ? "deadLettered" : "retried"] += 1;
    }
  }
  return result;
}

if (process.argv[1]?.endsWith("complianceNoticeDeliveryWorker.ts") || process.argv[1]?.endsWith("complianceNoticeDeliveryWorker.js")) {
  runComplianceNoticeDeliveryWorker().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error: unknown) => { process.stderr.write(`compliance notice delivery worker failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; },
  );
}

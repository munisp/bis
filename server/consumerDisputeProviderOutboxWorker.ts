import { createHash } from "node:crypto";
import { getPgPool } from "./db";
import { appendConsumerDisputeEvent } from "./consumerDisputes";
import {
  consumerDisputeOutboxAad,
  decryptConsumerDisputeOutboxPayload,
  type EncryptedOutboxPayload,
  loadConsumerDisputeOutboxKeyring,
} from "./consumerDisputeOutboxCrypto";
import { ENV } from "./_core/env";

const DISPATCH_BATCH_SIZE = 25;
const MAX_DISPATCH_ATTEMPTS = 12;

type LeasedOutboxEvent = {
  id: string;
  case_id: string;
  case_ref: string;
  source_task_id: string;
  task_ref: string;
  authorization_ref: string;
  provider_code: string;
  contract_version: string;
  authorization_tenant_id: number | null;
  case_tenant_id: number;
  data_source_id: number;
  payload_ciphertext: Buffer;
  payload_nonce: Buffer;
  payload_key_version: string;
  payload_algorithm: "aes-256-gcm";
  payload_sha256: string;
  idempotency_key: string;
  attempt_count: number;
};

export type ConsumerDisputeProviderOutboxResult = {
  leased: number;
  delivered: number;
  retried: number;
  deadLettered: number;
};

class ProviderAdapterNotInstalledError extends Error {
  constructor(readonly providerCode: string, readonly contractVersion: string) {
    super(`No signed ${providerCode} adapter is installed for contract version ${contractVersion}.`);
  }
}

function deploymentEnvironment(): "sandbox" | "staging" | "production" {
  const value = (process.env.BIS_DEPLOYMENT_ENV ?? (ENV.isProduction ? "production" : "staging")).trim();
  if (value !== "sandbox" && value !== "staging" && value !== "production") {
    throw new Error("BIS_DEPLOYMENT_ENV must be sandbox, staging, or production for provider dispatch.");
  }
  return value;
}

function boundedBackoff(attempt: number): string {
  const seconds = Math.min(300, 2 ** Math.min(attempt, 8));
  return `${seconds} seconds`;
}

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new Error("consumer-dispute provider outbox worker requires PostgreSQL");
  return pool;
}

async function leaseEvents(): Promise<LeasedOutboxEvent[]> {
  const pool = await poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE consumer_dispute_provider_outbox
          SET state = 'pending', leased_at = NULL, available_at = NOW(), updated_at = NOW(),
              last_error_code = COALESCE(last_error_code, 'PROVIDER_OUTBOX_LEASE_EXPIRED')
        WHERE state = 'leased' AND leased_at < NOW() - INTERVAL '5 minutes'`,
    );
    const rows = await client.query<LeasedOutboxEvent>(
      `SELECT o.id, o.case_id, c.case_ref, o.source_task_id, t.task_ref, a.authorization_ref,
              a.provider_code, a.contract_version, a.tenant_id AS authorization_tenant_id,
              c.tenant_id AS case_tenant_id, t.data_source_id, o.payload_ciphertext, o.payload_nonce,
              o.payload_key_version, o.payload_algorithm, o.payload_sha256, o.idempotency_key, o.attempt_count
         FROM consumer_dispute_provider_outbox o
         JOIN consumer_dispute_cases c ON c.id = o.case_id
         JOIN consumer_dispute_source_tasks t ON t.id = o.source_task_id
         JOIN data_provider_authorizations a ON a.id = t.provider_authorization_id
        WHERE o.state = 'pending' AND o.available_at <= NOW()
        ORDER BY o.available_at ASC, o.created_at ASC
        FOR UPDATE OF o SKIP LOCKED
        LIMIT $1`,
      [DISPATCH_BATCH_SIZE],
    );
    for (const row of rows.rows) {
      await client.query(
        `UPDATE consumer_dispute_provider_outbox
            SET state = 'leased', leased_at = NOW(), updated_at = NOW()
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

async function restoreOrFail(event: LeasedOutboxEvent, code: string, retryable: boolean): Promise<"retried" | "dead_letter"> {
  const pool = await poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nextAttempt = event.attempt_count + 1;
    const deadLetter = !retryable || nextAttempt >= MAX_DISPATCH_ATTEMPTS;
    await client.query(
      `UPDATE consumer_dispute_provider_outbox
          SET state = $2, attempt_count = $3, last_error_code = $4,
              available_at = CASE WHEN $2 = 'pending' THEN NOW() + $5::interval ELSE available_at END,
              updated_at = NOW()
        WHERE id = $1 AND state = 'leased'`,
      [event.id, deadLetter ? "dead_letter" : "pending", nextAttempt, code, boundedBackoff(nextAttempt)],
    );
    if (deadLetter) {
      await client.query(
        `UPDATE consumer_dispute_source_tasks SET status = 'failed', updated_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'dispatched', 'acknowledged')`,
        [event.source_task_id],
      );
    }
    await appendConsumerDisputeEvent(client, {
      caseId: event.case_id,
      caseRef: event.case_ref,
      actorUserId: null,
      actorKind: "system",
      eventType: "provider_outbox_failed",
      detail: { outboxId: event.id, taskRef: event.task_ref, failureCode: code, terminal: deadLetter },
    });
    await client.query("COMMIT");
    return deadLetter ? "dead_letter" : "retried";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * This dispatch boundary is intentionally closed until a signed NIBSS or NIMC
 * contract package is integrated. Contract-only endpoints, schemas, mTLS
 * material, and response semantics are not guessed or reverse engineered.
 */
async function dispatchWithContractAdapter(event: LeasedOutboxEvent, payload: Record<string, unknown>): Promise<{ providerTransactionRef: string }> {
  void payload;
  throw new ProviderAdapterNotInstalledError(event.provider_code, event.contract_version);
}

export async function runConsumerDisputeProviderOutboxWorker(): Promise<ConsumerDisputeProviderOutboxResult> {
  const environment = deploymentEnvironment();
  const keyring = loadConsumerDisputeOutboxKeyring();
  const events = await leaseEvents();
  const result: ConsumerDisputeProviderOutboxResult = { leased: events.length, delivered: 0, retried: 0, deadLettered: 0 };

  for (const event of events) {
    try {
      const payload = decryptConsumerDisputeOutboxPayload(keyring, consumerDisputeOutboxAad("provider_reinvestigation_request", event.idempotency_key), {
        ciphertext: event.payload_ciphertext,
        nonce: event.payload_nonce,
        keyVersion: event.payload_key_version,
        algorithm: event.payload_algorithm,
      } satisfies EncryptedOutboxPayload);
      const calculated = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      if (calculated !== event.payload_sha256) throw new Error("PROVIDER_OUTBOX_PAYLOAD_DIGEST_INVALID");
      const pool = await poolOrThrow();
      const authorization = await pool.query<{ permitted: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM data_provider_authorizations a
            WHERE a.authorization_ref = $1
              AND a.data_source_id = $2
              AND a.status = 'active'
              AND a.environment = $3
              AND a.effective_at <= NOW() AND a.expires_at > NOW()
              AND (a.tenant_id IS NULL OR a.tenant_id = $4)
         ) AS permitted`,
        [event.authorization_ref, event.data_source_id, environment, event.case_tenant_id],
      );
      if (!authorization.rows[0]?.permitted) {
        const state = await restoreOrFail(event, "PROVIDER_AUTHORIZATION_OUT_OF_SCOPE", false);
        result[state === "dead_letter" ? "deadLettered" : "retried"] += 1;
        continue;
      }
      await dispatchWithContractAdapter(event, payload);
    } catch (error) {
      const code = error instanceof ProviderAdapterNotInstalledError
        ? "PROVIDER_CONTRACT_ADAPTER_NOT_INSTALLED"
        : error instanceof Error && error.message === "PROVIDER_OUTBOX_PAYLOAD_DIGEST_INVALID"
          ? "PROVIDER_OUTBOX_PAYLOAD_DIGEST_INVALID"
          : "PROVIDER_OUTBOX_PAYLOAD_OR_DISPATCH_FAILURE";
      const terminal = code !== "PROVIDER_OUTBOX_PAYLOAD_OR_DISPATCH_FAILURE";
      const state = await restoreOrFail(event, code, !terminal);
      result[state === "dead_letter" ? "deadLettered" : "retried"] += 1;
    }
  }
  return result;
}

if (process.argv[1]?.endsWith("consumerDisputeProviderOutboxWorker.ts") || process.argv[1]?.endsWith("consumerDisputeProviderOutboxWorker.js")) {
  runConsumerDisputeProviderOutboxWorker().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error: unknown) => {
      process.stderr.write(`consumer-dispute provider outbox worker failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    },
  );
}

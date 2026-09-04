import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";
import { getPgPool } from "./db";
import { withCircuitBreaker } from "./circuitBreaker";

const LEDGER_NGN = 566;
const ACCOUNT_REVENUE = "1";
const ACCOUNT_TENANT_PREFIX = "10000";
const PAYSTACK_BASE_URL = "https://api.paystack.co";
const TOPUP_MINIMUM_KOBO = 10_000;
const INTENT_TTL_MS = 30 * 60 * 1000;
const MAX_WEBHOOK_ATTEMPTS = 10;

export type PaystackTransaction = {
  status: string;
  amount: number;
  currency?: string;
  channel?: string;
  reference: string;
  metadata?: Record<string, unknown>;
};

type PaystackEnvelope<T> = { status: boolean; message?: string; data?: T };

type PaymentIntent = {
  id: string;
  tenant_id: number;
  provider_reference: string;
  amount_kobo: string | number;
  currency: string;
  purpose: "prepaid_credit" | "subscription_invoice";
  status: string;
  expires_at: Date;
};

export type PaymentIntentStart = {
  tenantId: number;
  initiatedBy: number;
  amountKobo: number;
  email: string;
  callbackUrl?: string;
  purpose?: "prepaid_credit" | "subscription_invoice";
};

export type StoredWebhook = { accepted: boolean; duplicate: boolean; eventHash: string };

function serviceUnavailable(message: string): TRPCError {
  return new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function providerFailure(message: string): TRPCError {
  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}

function paystackKey(): string {
  const key = ENV.paystackSecretKey;
  if (!key) throw serviceUnavailable("Paystack settlement is not configured");
  return key;
}

function tigerBeetleUrl(): string {
  if (!ENV.tigerBeetleUrl) throw serviceUnavailable("TigerBeetle settlement is not configured");
  return ENV.tigerBeetleUrl.replace(/\/$/, "");
}

function paymentReference(): string {
  return `BIS-TOP-${randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
}

function topupTransferId(reference: string): string {
  return createHash("sha256").update(`bis:paystack-topup:v2:${reference}`).digest("hex").slice(0, 32);
}

function webhookHash(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function parseProviderEnvelope<T>(body: unknown, operation: string): T {
  if (!body || typeof body !== "object") throw providerFailure(`Paystack ${operation} returned an invalid response`);
  const envelope = body as PaystackEnvelope<T>;
  if (envelope.status !== true || !envelope.data) {
    throw providerFailure(`Paystack ${operation} did not confirm the request`);
  }
  return envelope.data;
}

async function paystackRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const secret = paystackKey();
  let response: Response;
  try {
    response = await withCircuitBreaker("paystack", () => fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    }));
  } catch {
    throw serviceUnavailable("Paystack is unavailable; payment settlement was not attempted");
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      throw serviceUnavailable("Paystack is temporarily unavailable; retry through reconciliation");
    }
    throw providerFailure("Paystack rejected the payment operation");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw providerFailure("Paystack returned a non-JSON response");
  }
  return parseProviderEnvelope<T>(body, path);
}

async function tigerBeetlePost(path: string, payload: unknown): Promise<void> {
  const baseUrl = tigerBeetleUrl();
  let response: Response;
  try {
    response = await withCircuitBreaker("tigerbeetle", () => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    }));
  } catch {
    throw serviceUnavailable("TigerBeetle is unavailable; no settlement decision was finalized");
  }
  if (!response.ok) {
    throw serviceUnavailable("TigerBeetle rejected the settlement request; reconciliation is required");
  }
}

async function ensureLedgerAccounts(tenantId: number): Promise<void> {
  await tigerBeetlePost("/accounts/create", [
    { id: ACCOUNT_REVENUE, ledger: LEDGER_NGN, code: 2, flags: 0 },
    { id: `${ACCOUNT_TENANT_PREFIX}${tenantId}`, ledger: LEDGER_NGN, code: 1, flags: 0, user_data_128: String(tenantId) },
  ]);
}

function asAmount(value: string | number): number {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("stored payment amount is invalid");
  return amount;
}

export async function startPaystackTopup(input: PaymentIntentStart): Promise<{ authorizationUrl: string; accessCode: string; reference: string; expiresAt: string }> {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A valid tenant is required" });
  if (!Number.isInteger(input.initiatedBy) || input.initiatedBy <= 0) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated payer is required" });
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo < TOPUP_MINIMUM_KOBO) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Top-up amount is below the approved minimum" });
  }

  const pool = await getPgPool();
  if (!pool) throw serviceUnavailable("Durable payment-intent storage is unavailable");
  const id = randomUUID();
  const reference = paymentReference();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const purpose = input.purpose ?? "prepaid_credit";

  await pool.query(
    `INSERT INTO billing_payment_intents
      (id, tenant_id, initiated_by, provider, provider_reference, amount_kobo, currency, customer_email, purpose, status, expires_at)
     VALUES ($1, $2, $3, 'paystack', $4, $5, 'NGN', $6, $7, 'initializing', $8)`,
    [id, input.tenantId, input.initiatedBy, reference, input.amountKobo, input.email.toLowerCase(), purpose, expiresAt],
  );

  try {
    const result = await paystackRequest<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email.toLowerCase(),
        amount: input.amountKobo,
        currency: "NGN",
        reference,
        callback_url: input.callbackUrl,
        metadata: { bis_payment_intent_id: id, payment_purpose: purpose },
        channels: ["card", "bank", "ussd", "bank_transfer"],
      }),
    });
    if (result.reference !== reference || !result.authorization_url || !result.access_code) {
      throw providerFailure("Paystack initialization did not preserve the server-created payment reference");
    }
    await pool.query(
      `UPDATE billing_payment_intents
       SET status = 'pending', paystack_access_code = $2, initialized_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'initializing'`,
      [id, result.access_code],
    );
    return { authorizationUrl: result.authorization_url, accessCode: result.access_code, reference, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    await pool.query(
      `UPDATE billing_payment_intents SET status = 'failed', updated_at = now()
       WHERE id = $1 AND status = 'initializing'`, [id],
    ).catch(() => undefined);
    throw error;
  }
}

export async function recordPaystackWebhook(rawBody: Buffer, event: unknown): Promise<StoredWebhook> {
  const pool = await getPgPool();
  if (!pool) throw serviceUnavailable("Durable webhook storage is unavailable; webhook was not accepted");
  if (!event || typeof event !== "object") throw new TRPCError({ code: "BAD_REQUEST", message: "Paystack webhook payload is invalid" });
  const payload = event as { event?: unknown; data?: { reference?: unknown } };
  const eventType = typeof payload.event === "string" && payload.event.length <= 80 ? payload.event : null;
  const reference = typeof payload.data?.reference === "string" && payload.data.reference.length <= 160 ? payload.data.reference : null;
  if (!eventType) throw new TRPCError({ code: "BAD_REQUEST", message: "Paystack webhook event type is invalid" });
  const eventHash = webhookHash(rawBody);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insert = await client.query(
      `INSERT INTO payment_webhook_events (id, provider, event_type, provider_reference, payload_sha256, status, payload)
       VALUES ($1, 'paystack', $2, $3, $4, 'received', $5::jsonb)
       ON CONFLICT (provider, payload_sha256) DO NOTHING
       RETURNING id`,
      [randomUUID(), eventType, reference, eventHash, JSON.stringify(event)],
    );
    if (insert.rowCount === 0) {
      await client.query("COMMIT");
      return { accepted: true, duplicate: true, eventHash };
    }
    // `payment_webhook_events` is the durable, leaseable delivery queue. The
    // webhook payload is minimised before persistence because settlement always
    // re-verifies the provider transaction; no client-supplied amount, email,
    // or metadata is trusted or needed after intake.
    await client.query(
      `UPDATE payment_webhook_events
       SET payload = jsonb_build_object('event', $2, 'reference', $3)
       WHERE id = $1`,
      [String(insert.rows[0].id), eventType, reference],
    );
    await client.query("COMMIT");
    return { accepted: true, duplicate: false, eventHash };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verifiedPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  const transaction = await paystackRequest<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!transaction || typeof transaction !== "object" || transaction.status !== "success" || transaction.reference !== reference) {
    throw providerFailure("Paystack did not confirm a successful transaction for the expected reference");
  }
  if (!Number.isSafeInteger(transaction.amount) || transaction.amount <= 0 || transaction.currency !== "NGN") {
    throw providerFailure("Paystack transaction amount or currency is invalid");
  }
  return transaction;
}

export async function settlePaystackPayment(reference: string): Promise<{ transferId: string; idempotent: boolean; tenantId: number; amountKobo: number }> {
  const pool = await getPgPool();
  if (!pool) throw serviceUnavailable("Durable payment settlement storage is unavailable");
  const client = await pool.connect();
  let intent: PaymentIntent;
  try {
    await client.query("BEGIN");
    const found = await client.query<PaymentIntent>(
      `SELECT id, tenant_id, provider_reference, amount_kobo, currency, purpose, status, expires_at
       FROM billing_payment_intents
       WHERE provider = 'paystack' AND provider_reference = $1
       FOR UPDATE`, [reference],
    );
    if (found.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "No server-created payment intent exists for this reference" });
    intent = found.rows[0];
    if (intent.status === "credited") {
      await client.query("COMMIT");
      return { transferId: topupTransferId(reference), idempotent: true, tenantId: intent.tenant_id, amountKobo: asAmount(intent.amount_kobo) };
    }
    if (intent.status !== "pending" && intent.status !== "verified") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment intent is not eligible for settlement" });
    if (new Date(intent.expires_at).getTime() < Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment intent has expired" });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const transaction = await verifiedPaystackTransaction(reference);
  const expectedAmount = asAmount(intent!.amount_kobo);
  if (transaction.amount !== expectedAmount || transaction.currency !== intent!.currency) {
    throw providerFailure("Paystack transaction does not match the server-created amount and currency");
  }

  const transferId = topupTransferId(reference);
  await ensureLedgerAccounts(intent!.tenant_id);
  await tigerBeetlePost("/transfers/create", [{
    id: transferId,
    debit_account_id: ACCOUNT_REVENUE,
    credit_account_id: `${ACCOUNT_TENANT_PREFIX}${intent!.tenant_id}`,
    amount: expectedAmount,
    ledger: LEDGER_NGN,
    code: 2,
    flags: 0,
    user_data_128: reference,
  }]);

  const complete = await pool.query(
    `UPDATE billing_payment_intents
     SET status = 'credited', verified_at = COALESCE(verified_at, now()), credited_at = now(), updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'verified')
     RETURNING id`, [intent!.id],
  );
  if (complete.rowCount !== 1) {
    throw serviceUnavailable("Ledger transfer was accepted but payment settlement state requires reconciliation");
  }
  await pool.query(
    `INSERT INTO billing_topups ("tenantId", reference, "amountKobo", channel, "tbTransferId", "verifiedAt")
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (reference) DO UPDATE SET "tbTransferId" = EXCLUDED."tbTransferId"`,
    [String(intent!.tenant_id), reference, expectedAmount, transaction.channel ?? "paystack", transferId],
  );
  return { transferId, idempotent: false, tenantId: intent!.tenant_id, amountKobo: expectedAmount };
}

export async function processPaystackWebhookEvent(webhookEventId: string): Promise<void> {
  const pool = await getPgPool();
  if (!pool) throw serviceUnavailable("Durable webhook processing storage is unavailable");
  const client = await pool.connect();
  let eventType: string | undefined;
  let reference: string | undefined;
  try {
    await client.query("BEGIN");
    const eventResult = await client.query<{ event_type: string; provider_reference: string | null; status: string; attempt_count: number }>(
      `SELECT event_type, provider_reference, status, attempt_count
       FROM payment_webhook_events WHERE id = $1 FOR UPDATE`, [webhookEventId],
    );
    if (eventResult.rowCount !== 1) throw new Error("stored payment webhook is missing");
    const event = eventResult.rows[0];
    if (event.status === "processed") {
      await client.query("COMMIT");
      return;
    }
    if (event.attempt_count >= MAX_WEBHOOK_ATTEMPTS) {
      await client.query(`UPDATE payment_webhook_events SET status = 'terminal_failure', last_error_code = 'max_attempts', last_error_at = now() WHERE id = $1`, [webhookEventId]);
      await client.query("COMMIT");
      return;
    }
    await client.query(`UPDATE payment_webhook_events SET status = 'processing', attempt_count = attempt_count + 1 WHERE id = $1`, [webhookEventId]);
    await client.query("COMMIT");
    eventType = event.event_type;
    reference = event.provider_reference ?? undefined;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  try {
    if (eventType === "charge.success" && reference) await settlePaystackPayment(reference);
    await pool.query(`UPDATE payment_webhook_events SET status = 'processed', processed_at = now(), last_error_code = NULL WHERE id = $1`, [webhookEventId]);
  } catch (error) {
    const retryable = error instanceof TRPCError && error.code === "SERVICE_UNAVAILABLE";
    const code = error instanceof TRPCError ? error.code : "internal_error";
    await pool.query(
      `UPDATE payment_webhook_events
       SET status = $2,
           next_attempt_at = CASE WHEN $2 = 'retryable_failure' THEN now() + interval '5 minutes' ELSE NULL END,
           last_error_code = $3,
           last_error_at = now()
       WHERE id = $1`,
      [webhookEventId, retryable ? "retryable_failure" : "terminal_failure", code],
    );
    if (retryable) throw error;
  }
}

export async function processDuePaystackWebhooks(limit = 50): Promise<number> {
  const pool = await getPgPool();
  if (!pool) throw serviceUnavailable("Durable webhook processing storage is unavailable");
  const claimed = await pool.query<{ id: string }>(
    `SELECT id FROM payment_webhook_events
     WHERE status IN ('received', 'retryable_failure')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY received_at ASC
     FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.max(1, Math.min(limit, 100))],
  );
  for (const row of claimed.rows) await processPaystackWebhookEvent(row.id);
  return claimed.rowCount ?? 0;
}

export const __billingSettlementInternals = { webhookHash, topupTransferId, parseProviderEnvelope };

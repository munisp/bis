/**
 * server/selfServiceBilling.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-service subscription signup (self-serve pricing-page analog).
 *
 * Money NEVER moves here. A paid signup reuses the existing hardened billing
 * internals:
 *   - the plan catalogue comes from `billing_plans` (server/billingCommercial.ts),
 *   - payment is settled exclusively through `settlePaystackPayment`
 *     (server/billingSettlement.ts), which re-verifies the provider transaction
 *     against a server-created `billing_payment_intents` row and posts the
 *     deterministic TigerBeetle transfer before any state changes,
 *   - the subscription + included-check entitlement are written into the
 *     existing `tenant_subscriptions` / `billing_entitlements` tables.
 *
 * Fail-closed: any payment or ledger failure raises a typed TRPCError and NO
 * subscription or entitlement is created; the attempt is durably recorded as a
 * plan_signups row with status 'payment_failed' so replays of the same
 * idempotency key return that original failure result.
 *
 * Idempotent: the client-supplied idempotency key is backed by a per-tenant
 * UNIQUE constraint on plan_signups.(tenant_id, idempotency_key); a replay
 * returns the original result without re-settling payment. Keys are
 * tenant-namespaced — one tenant's key is never visible to another tenant and
 * is treated as a new key there, so replays can never leak a foreign signup
 * or billing reference.
 */

import { createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";
import { ENV } from "./_core/env";
import { settlePaystackPayment } from "./billingSettlement";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const PLAN_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const PAYMENT_REFERENCE = /^BIS-TOP-[A-Z0-9]{24}$/;

function requireTenant(ctx: { tenantId: number | null; user: { id: number } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}

async function poolOrFail(): Promise<Queryable> {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Self-service billing storage is unavailable" });
  return pool;
}

async function writeAuditLog(client: Queryable, entry: {
  tenantId: number; userId: number; action: string; targetRef?: string; result?: "success" | "warning" | "failure"; detail?: unknown;
}) {
  const createdAt = new Date();
  const result = entry.result ?? "success";
  const payload = [String(entry.userId), "system", entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|");
  const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
  await client.query(
    `INSERT INTO audit_log ("tenantId", "userId", category, action, "targetRef", result, detail, "integrityHash", "createdAt")
     VALUES ($1, $2, 'system', $3, $4, $5, $6::jsonb, $7, $8)`,
    [entry.tenantId, entry.userId, entry.action, entry.targetRef ?? null, result, JSON.stringify(entry.detail ?? {}), integrityHash, createdAt],
  ).catch(() => undefined);
}

async function publishEvent(eventType: string, subjectRef: string, severity: string, payload: unknown) {
  try {
    await fetch(`${ENV.eventProcessorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: "bis-bff" }),
    });
  } catch (e) {
    console.warn("[EventProcessor] Failed to publish event:", e);
  }
}

function periodEndFor(interval: "monthly" | "annual", start: Date): Date {
  const end = new Date(start);
  if (interval === "annual") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export const selfServiceBillingRouter = router({
  /**
   * Public plan catalogue. Read-only projection of billing_plans; contains no
   * tenant data, so it is safe to expose without tenant context.
   */
  listPublicPlans: publicProcedure.query(async () => {
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `SELECT plan_code, display_name, billing_interval, price_kobo, included_completed_checks, overage_price_kobo, version
       FROM billing_plans WHERE active = true ORDER BY price_kobo ASC, plan_code ASC`,
    );
    return rows.map((row) => ({
      planCode: row.plan_code as string,
      displayName: row.display_name as string,
      billingInterval: row.billing_interval as "monthly" | "annual",
      priceKobo: Number(row.price_kobo),
      priceNGN: Number(row.price_kobo) / 100,
      includedCompletedChecks: Number(row.included_completed_checks),
      overagePriceKobo: Number(row.overage_price_kobo),
      currency: "NGN" as const,
      version: Number(row.version),
    }));
  }),

  signup: writeProcedure
    .input(z.object({
      planCode: z.string().regex(PLAN_CODE),
      idempotencyKey: z.string().min(8).max(128),
      paymentReference: z.string().regex(PAYMENT_REFERENCE).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();

      // Idempotency replay, tenant-scoped: the (tenant_id, idempotency_key)
      // unique pair is the durable record of the first attempt; a replay
      // returns that original result without touching money. A key created by
      // ANOTHER tenant is not visible here — it behaves as a brand-new key for
      // this tenant and can never leak the other tenant's signup or billing
      // reference.
      const prior = await pool.query(
        `SELECT id, plan_code, status, billing_ref FROM plan_signups
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, input.idempotencyKey],
      );
      if ((prior.rowCount ?? 0) === 1) {
        const row = prior.rows[0];
        let subscriptionId: string | null = null;
        if (row.status === "active" && row.billing_ref) {
          const sub = await pool.query(
            `SELECT id FROM tenant_subscriptions WHERE tenant_id = $1 AND provider_subscription_ref = $2 LIMIT 1`,
            [tenantId, row.billing_ref],
          );
          subscriptionId = sub.rows[0]?.id ?? null;
        }
        return {
          signupId: row.id as string,
          subscriptionId,
          planCode: row.plan_code as string,
          status: row.status as string,
          billingRef: (row.billing_ref ?? null) as string | null,
          idempotent: true as const,
        };
      }

      // Resolve and validate the plan from the existing commercial catalogue.
      const planResult = await pool.query(
        `SELECT id, plan_code, billing_interval, price_kobo, included_completed_checks
         FROM billing_plans WHERE plan_code = $1 AND active = true`,
        [input.planCode],
      );
      if ((planResult.rowCount ?? 0) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The requested active plan does not exist" });
      }
      const plan = planResult.rows[0] as {
        id: string; plan_code: string; billing_interval: "monthly" | "annual";
        price_kobo: string | number; included_completed_checks: string | number;
      };
      const priceKobo = Number(plan.price_kobo);
      const includedChecks = Number(plan.included_completed_checks);

      // Paid plans settle through the existing hardened payment path only.
      let billingRef: string | null = null;
      if (priceKobo > 0) {
        if (!input.paymentReference) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A server-created subscription payment reference is required for a paid plan" });
        }
        // Bind the payment to this tenant and purpose before settling; the
        // intent row is server-created (payment_intent outbox hardening).
        const intent = await pool.query(
          `SELECT tenant_id, purpose, amount_kobo FROM billing_payment_intents
           WHERE provider = 'paystack' AND provider_reference = $1`,
          [input.paymentReference],
        );
        if ((intent.rowCount ?? 0) !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No server-created payment intent exists for this reference" });
        }
        const intentRow = intent.rows[0];
        if (Number(intentRow.tenant_id) !== tenantId || intentRow.purpose !== "subscription_invoice") {
          throw new TRPCError({ code: "FORBIDDEN", message: "The payment intent is not bound to this tenant subscription" });
        }
        if (Number(intentRow.amount_kobo) !== priceKobo) {
          throw new TRPCError({ code: "CONFLICT", message: "The payment intent amount does not match the plan price" });
        }

        try {
          // Existing billing internals: provider re-verification + deterministic
          // TigerBeetle transfer. Any failure throws and nothing is activated.
          await settlePaystackPayment(input.paymentReference);
        } catch (error) {
          // Durable failed-attempt record: a replay of this idempotency key
          // returns this original failure result instead of re-settling. The
          // row is best-effort; a concurrent attempt wins on the UNIQUE key.
          await pool.query(
            `INSERT INTO plan_signups (id, tenant_id, plan_code, status, billing_ref, idempotency_key, created_by)
             VALUES ($1, $2, $3, 'payment_failed', $4, $5, $6)
             ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
            [randomUUID(), tenantId, input.planCode, input.paymentReference, input.idempotencyKey, userId],
          ).catch(() => undefined);
          await writeAuditLog(pool, {
            tenantId, userId, action: `Self-service signup payment failed for plan ${input.planCode}`,
            targetRef: input.paymentReference, result: "failure",
            detail: { idempotencyKey: input.idempotencyKey, error: error instanceof Error ? error.message : String(error) },
          });
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Subscription payment could not be settled; no subscription was activated" });
        }
        billingRef = input.paymentReference;
      }

      // Activation is transactional: cancel any current subscription, create the
      // new one, grant the included-check entitlement, and record the durable
      // idempotency row atomically. A concurrent replay loses on the UNIQUE
      // idempotency key and is re-read as the original result.
      const client = await (pool as any).connect();
      const signupId = randomUUID();
      const subscriptionId = randomUUID();
      const periodStart = new Date();
      const periodEnd = periodEndFor(plan.billing_interval, periodStart);
      // tenant_subscriptions enforces a GLOBAL UNIQUE(provider,
      // provider_subscription_ref) and billing_entitlements a global
      // UNIQUE(source_reference): both synthetic references are therefore
      // tenant-namespaced so the same idempotency key in another tenant can
      // never collide (key squatting) or 500 on a duplicate key.
      const providerRef = billingRef ?? `self-serve-free:${tenantId}:${input.idempotencyKey}`;
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE tenant_subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND status IN ('pending', 'active', 'past_due', 'cancelling')`,
          [tenantId],
        );
        await client.query(
          `INSERT INTO tenant_subscriptions
            (id, tenant_id, plan_id, provider, provider_subscription_ref, status, current_period_start, current_period_end, created_by)
           VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
          [subscriptionId, tenantId, plan.id, priceKobo > 0 ? "paystack" : "manual_contract", providerRef, periodStart, periodEnd, userId],
        );
        if (includedChecks > 0) {
          await client.query(
            `INSERT INTO billing_entitlements
              (id, tenant_id, subscription_id, entitlement_kind, total_units, period_start, period_end, status, source_reference)
             VALUES ($1, $2, $3, 'subscription_included_check', $4, $5, $6, 'active', $7)`,
            [randomUUID(), tenantId, subscriptionId, includedChecks, periodStart, periodEnd, `self-serve-signup:${tenantId}:${input.idempotencyKey}`],
          );
        }
        await client.query(
          `INSERT INTO plan_signups (id, tenant_id, plan_code, status, billing_ref, idempotency_key, created_by)
           VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
          [signupId, tenantId, input.planCode, providerRef, input.idempotencyKey, userId],
        );
        await writeAuditLog(client, {
          tenantId, userId, action: `Self-service plan signup activated: ${input.planCode}`,
          targetRef: providerRef,
          detail: { signupId, subscriptionId, idempotencyKey: input.idempotencyKey, priceKobo },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (isUniqueViolation(error)) {
          // Lost the same-tenant idempotency race: re-read THIS tenant's row
          // and return the original committed result.
          const winner = await pool.query(
            `SELECT id, plan_code, status, billing_ref FROM plan_signups
             WHERE tenant_id = $1 AND idempotency_key = $2`,
            [tenantId, input.idempotencyKey],
          );
          if ((winner.rowCount ?? 0) === 1) {
            const row = winner.rows[0];
            return {
              signupId: row.id as string,
              subscriptionId: null,
              planCode: row.plan_code as string,
              status: row.status as string,
              billingRef: (row.billing_ref ?? null) as string | null,
              idempotent: true as const,
            };
          }
        }
        throw error;
      } finally {
        client.release();
      }

      await publishEvent("PLAN_SIGNUP_ACTIVATED", String(tenantId), "info", {
        signupId, subscriptionId, planCode: input.planCode, tenantId, priceKobo, billingRef: providerRef,
      });
      return {
        signupId,
        subscriptionId,
        planCode: input.planCode,
        status: "active" as const,
        billingRef: providerRef,
        idempotent: false as const,
      };
    }),

  mySubscription: protectedProcedure.query(async ({ ctx }) => {
    const { tenantId } = requireTenant(ctx);
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end,
              p.plan_code, p.display_name, p.billing_interval, p.price_kobo, p.included_completed_checks
       FROM tenant_subscriptions s
       JOIN billing_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.status IN ('pending', 'active', 'past_due', 'cancelling')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [tenantId],
    );
    if (rows.length !== 1) return { subscription: null };
    const row = rows[0];
    return {
      subscription: {
        subscriptionId: row.id as string,
        status: row.status as string,
        planCode: row.plan_code as string,
        displayName: row.display_name as string,
        billingInterval: row.billing_interval as string,
        priceKobo: Number(row.price_kobo),
        includedCompletedChecks: Number(row.included_completed_checks),
        currentPeriodStart: new Date(row.current_period_start).toISOString(),
        currentPeriodEnd: new Date(row.current_period_end).toISOString(),
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        currency: "NGN" as const,
      },
    };
  }),

  usageSummary: protectedProcedure.query(async ({ ctx }) => {
    const { tenantId } = requireTenant(ctx);
    const pool = await poolOrFail();
    const entitlements = await pool.query(
      `SELECT COALESCE(SUM(total_units), 0) AS total_units,
              COALESCE(SUM(consumed_units), 0) AS consumed_units,
              COALESCE(SUM(reserved_units), 0) AS reserved_units
       FROM billing_entitlements
       WHERE tenant_id = $1 AND status = 'active' AND period_start <= now() AND period_end > now()`,
      [tenantId],
    );
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS completed_checks
       FROM billing_usage_events
       WHERE tenant_id = $1 AND usage_type = 'completed_authorized_check'
         AND occurred_at > now() - interval '30 days'`,
      [tenantId],
    );
    const totals = entitlements.rows[0] ?? { total_units: 0, consumed_units: 0, reserved_units: 0 };
    const total = Number(totals.total_units);
    const consumed = Number(totals.consumed_units);
    const reserved = Number(totals.reserved_units);
    return {
      tenantId,
      includedChecks: total,
      consumedChecks: consumed,
      reservedChecks: reserved,
      remainingChecks: Math.max(0, total - consumed - reserved),
      completedChecksLast30Days: Number(recent.rows[0]?.completed_checks ?? 0),
    };
  }),
});

export const __selfServiceBillingInternals = { periodEndFor, isUniqueViolation };

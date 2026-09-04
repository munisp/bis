import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";

const reservationTtlMs = 20 * 60 * 1000;

function requireTenantScope(contextTenantId: number | null, tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A valid tenant is required" });
  if (contextTenantId !== null && contextTenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cross-tenant commercial access is denied" });
  }
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Commercial billing storage is unavailable" });
  return pool;
}

const planInput = z.object({
  planCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  displayName: z.string().min(3).max(160),
  billingInterval: z.enum(["monthly", "annual"]),
  priceKobo: z.number().int().min(0),
  includedCompletedChecks: z.number().int().min(0).max(100_000),
  overagePriceKobo: z.number().int().min(0),
});

export const commercialBillingRouter = router({
  listPlans: protectedProcedure.query(async () => {
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `SELECT plan_code, display_name, billing_interval, price_kobo, included_completed_checks, overage_price_kobo, version
       FROM billing_plans WHERE active = true ORDER BY price_kobo ASC, plan_code ASC`,
    );
    return rows.map((row) => ({
      planCode: row.plan_code,
      displayName: row.display_name,
      billingInterval: row.billing_interval,
      priceKobo: Number(row.price_kobo),
      includedCompletedChecks: Number(row.included_completed_checks),
      overagePriceKobo: Number(row.overage_price_kobo),
      version: Number(row.version),
      currency: "NGN" as const,
    }));
  }),

  upsertPlan: adminProcedure.input(planInput).mutation(async ({ input }) => {
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `INSERT INTO billing_plans
        (plan_code, display_name, billing_interval, price_kobo, included_completed_checks, overage_price_kobo, active, version)
       VALUES ($1, $2, $3, $4, $5, $6, true, 1)
       ON CONFLICT (plan_code) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         billing_interval = EXCLUDED.billing_interval,
         price_kobo = EXCLUDED.price_kobo,
         included_completed_checks = EXCLUDED.included_completed_checks,
         overage_price_kobo = EXCLUDED.overage_price_kobo,
         active = true,
         version = billing_plans.version + 1,
         updated_at = now()
       RETURNING id, plan_code, version`,
      [input.planCode, input.displayName, input.billingInterval, input.priceKobo, input.includedCompletedChecks, input.overagePriceKobo],
    );
    return { planId: String(rows[0].id), planCode: rows[0].plan_code, version: Number(rows[0].version) };
  }),

  activateManualContract: adminProcedure.input(z.object({
    tenantId: z.number().int().positive(),
    planCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    authorityReference: z.string().min(8).max(160),
  })).mutation(async ({ input, ctx }) => {
    if (input.periodEnd <= input.periodStart) throw new TRPCError({ code: "BAD_REQUEST", message: "Contract period end must be later than its start" });
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const plan = await client.query<{ id: string; included_completed_checks: string }>(
        `SELECT id, included_completed_checks FROM billing_plans WHERE plan_code = $1 AND active = true FOR SHARE`, [input.planCode],
      );
      if (plan.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "The requested active commercial plan does not exist" });
      const subscriptionId = randomUUID();
      await client.query(
        `UPDATE tenant_subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND status IN ('pending', 'active', 'past_due', 'cancelling')`, [input.tenantId],
      );
      await client.query(
        `INSERT INTO tenant_subscriptions
          (id, tenant_id, plan_id, provider, provider_subscription_ref, status, current_period_start, current_period_end, created_by)
         VALUES ($1, $2, $3, 'manual_contract', $4, 'active', $5, $6, $7)`,
        [subscriptionId, input.tenantId, plan.rows[0].id, input.authorityReference, input.periodStart, input.periodEnd, ctx.user!.id],
      );
      const included = Number(plan.rows[0].included_completed_checks);
      if (included > 0) {
        await client.query(
          `INSERT INTO billing_entitlements
            (id, tenant_id, subscription_id, entitlement_kind, total_units, period_start, period_end, status, source_reference)
           VALUES ($1, $2, $3, 'subscription_included_check', $4, $5, $6, 'active', $7)`,
          [randomUUID(), input.tenantId, subscriptionId, included, input.periodStart, input.periodEnd, `manual-contract:${input.authorityReference}:${input.periodStart.toISOString()}`],
        );
      }
      await client.query("COMMIT");
      return { subscriptionId, includedCompletedChecks: included, status: "active" as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }),

  reserveCompletedCheck: writeProcedure.input(z.object({
    tenantId: z.number().int().positive(),
    investigationRef: z.string().min(1).max(128),
    tier: z.enum(["basic", "standard", "premium"]),
    idempotencyKey: z.string().uuid(),
  })).mutation(async ({ input, ctx }) => {
    requireTenantScope(ctx.tenantId, input.tenantId);
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string; status: string; expires_at: Date }>(
        `SELECT id, status, expires_at FROM billing_check_reservations
         WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`, [input.tenantId, input.idempotencyKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        await client.query("COMMIT");
        if (row.status === "reserved" && new Date(row.expires_at).getTime() > Date.now()) return { reservationId: row.id, expiresAt: row.expires_at.toISOString(), idempotent: true };
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The idempotency key is bound to an unavailable commercial reservation" });
      }
      const entitlement = await client.query<{ id: string }>(
        `SELECT id FROM billing_entitlements
         WHERE tenant_id = $1 AND status = 'active' AND period_start <= now() AND period_end > now()
           AND total_units > consumed_units + reserved_units
         ORDER BY period_end ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [input.tenantId],
      );
      if (entitlement.rowCount !== 1) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "No active commercial entitlement is available for this completed check" });
      const reservationId = randomUUID();
      const expiresAt = new Date(Date.now() + reservationTtlMs);
      await client.query(`UPDATE billing_entitlements SET reserved_units = reserved_units + 1, updated_at = now() WHERE id = $1`, [entitlement.rows[0].id]);
      await client.query(
        `INSERT INTO billing_check_reservations
          (id, tenant_id, entitlement_id, investigation_ref, requested_tier, status, idempotency_key, reserved_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'reserved', $6, $7, $8)`,
        [reservationId, input.tenantId, entitlement.rows[0].id, input.investigationRef, input.tier, input.idempotencyKey, ctx.user!.id, expiresAt],
      );
      await client.query("COMMIT");
      return { reservationId, expiresAt: expiresAt.toISOString(), idempotent: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }),

  consumeReservedCheck: writeProcedure.input(z.object({ tenantId: z.number().int().positive(), reservationId: z.string().uuid(), investigationRef: z.string().min(1).max(128) }))
    .mutation(async ({ input, ctx }) => {
      requireTenantScope(ctx.tenantId, input.tenantId);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const reservation = await client.query<{ entitlement_id: string; status: string; expires_at: Date }>(
          `SELECT entitlement_id, status, expires_at FROM billing_check_reservations
           WHERE id = $1 AND tenant_id = $2 AND investigation_ref = $3 FOR UPDATE`, [input.reservationId, input.tenantId, input.investigationRef],
        );
        if (reservation.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Commercial reservation was not found" });
        const row = reservation.rows[0];
        if (row.status === "consumed") { await client.query("COMMIT"); return { consumed: true, idempotent: true }; }
        if (row.status !== "reserved" || new Date(row.expires_at).getTime() <= Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Commercial reservation is no longer valid" });
        await client.query(`UPDATE billing_check_reservations SET status = 'consumed', consumed_at = now(), updated_at = now() WHERE id = $1`, [input.reservationId]);
        await client.query(`UPDATE billing_entitlements SET reserved_units = reserved_units - 1, consumed_units = consumed_units + 1, updated_at = now() WHERE id = $1`, [row.entitlement_id]);
        await client.query(
          `INSERT INTO billing_usage_events (id, tenant_id, reservation_id, usage_type, units, investigation_ref, recorded_by)
           VALUES ($1, $2, $3, 'completed_authorized_check', 1, $4, $5)`,
          [randomUUID(), input.tenantId, input.reservationId, input.investigationRef, ctx.user!.id],
        );
        await client.query("COMMIT");
        return { consumed: true, idempotent: false };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }),

  requestRefund: writeProcedure.input(z.object({ tenantId: z.number().int().positive(), paymentReference: z.string().min(8).max(160), amountKobo: z.number().int().positive(), reason: z.string().min(10).max(1024) }))
    .mutation(async ({ input, ctx }) => {
      requireTenantScope(ctx.tenantId, input.tenantId);
      const pool = await poolOrFail();
      const { rows } = await pool.query(
        `INSERT INTO billing_refunds (id, tenant_id, payment_reference, amount_kobo, reason, status, requested_by)
         VALUES ($1, $2, $3, $4, $5, 'requested', $6)
         RETURNING id, status, requested_at`,
        [randomUUID(), input.tenantId, input.paymentReference, input.amountKobo, input.reason.trim(), ctx.user!.id],
      );
      return { refundId: rows[0].id, status: rows[0].status, requestedAt: rows[0].requested_at.toISOString() };
    }),

  approveRefund: adminProcedure.input(z.object({ refundId: z.string().uuid(), decision: z.enum(["approve", "reject"]), rationale: z.string().min(10).max(1024) }))
    .mutation(async ({ input, ctx }) => {
      const pool = await poolOrFail();
      const status = input.decision === "approve" ? "approved" : "rejected";
      const { rows } = await pool.query(
        `UPDATE billing_refunds SET status = $2, approved_by = $3, approved_at = now(), updated_at = now(),
          reason = reason || E'\nReviewer: ' || $4
         WHERE id = $1 AND status = 'requested' AND requested_by <> $3
         RETURNING id, status`,
        [input.refundId, status, ctx.user!.id, input.rationale.trim()],
      );
      if (rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Refund cannot be approved by the requester or is no longer pending" });
      return { refundId: rows[0].id, status: rows[0].status };
    }),
});

export const __commercialBillingInternals = { requireTenantScope, reservationTtlMs };

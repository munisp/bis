/**
 * server/alertRules.ts
 * Alert rule evaluation engine — evaluates all enabled alert rules against a
 * metric value and auto-creates alerts + optional owner notifications when
 * thresholds are breached.
 */

import { getDb } from "./db";
import { alertRules, alerts, auditLog } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

export type AlertMetric =
  | "risk_score"
  | "sanctions_confidence"
  | "pep_confidence"
  | "adverse_media_count"
  | "duplicate_identity_score"
  | "velocity_hourly"
  | "velocity_daily"
  | "credit_score";

export interface EvaluationContext {
  subjectRef: string;
  subjectName?: string;
  triggeredBy?: string; // procedure name e.g. "screening.create"
  userId?: number;
  userEmail?: string;
  investigationId?: number;
}

/** Evaluate a single operator against a value and threshold. */
function evaluate(operator: string, value: number, threshold: number): boolean {
  switch (operator) {
    case "gt":  return value > threshold;
    case "gte": return value >= threshold;
    case "lt":  return value < threshold;
    case "lte": return value <= threshold;
    case "eq":  return value === threshold;
    case "neq": return value !== threshold;
    default:    return false;
  }
}

/**
 * Evaluate all enabled alert rules for a given metric value.
 * Creates an alert row for each matching rule and optionally notifies the owner.
 * Returns the number of alerts created.
 */
export async function evaluateAlertRules(
  metric: AlertMetric,
  value: number,
  ctx: EvaluationContext
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Fetch all enabled rules for this metric
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.metric, metric), eq(alertRules.enabled, true)));

  if (rules.length === 0) return 0;

  let created = 0;

  for (const rule of rules) {
    if (!evaluate(rule.operator, value, rule.threshold)) continue;

    const body =
      `Rule "${rule.name}" triggered: ${metric} = ${value} ` +
      `(${rule.operator} ${rule.threshold}) for subject ${ctx.subjectRef}` +
      (ctx.subjectName ? ` (${ctx.subjectName})` : "") +
      (ctx.triggeredBy ? `. Source: ${ctx.triggeredBy}` : "");

    try {
      const title = `${rule.name}: ${metric} ${rule.operator} ${rule.threshold}`;
      const [alert] = await db
        .insert(alerts)
        .values({
          type: "risk_threshold",
          severity: rule.severity,
          title,
          body,
          subjectRef: ctx.subjectRef,
          investigationId: ctx.investigationId,
          sourceService: ctx.triggeredBy ?? "alert-rules-engine",
          resolved: false,
          dismissed: false,
        })
        .returning();

      created++;

      // Write audit entry
      await db.insert(auditLog).values({
        userId: ctx.userId,
        userEmail: ctx.userEmail,
        category: "alert",
        action: `Alert rule "${rule.name}" triggered (${metric}=${value})`,
        targetRef: ctx.subjectRef,
        result: "success",
        detail: { ruleId: rule.id, metric, value, threshold: rule.threshold, alertId: alert.id } as any,
      }).catch(() => {});

      // Optionally notify owner
      if (rule.notifyOwner) {
        notifyOwner({
          title: `[BIS Alert] ${rule.name} — ${rule.severity.toUpperCase()}`,
          content: body,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("[AlertRules] Failed to create alert for rule", rule.id, e);
    }
  }

  return created;
}

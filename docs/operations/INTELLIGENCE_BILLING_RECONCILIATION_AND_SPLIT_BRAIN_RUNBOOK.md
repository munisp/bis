# Intelligence Billing Reconciliation and Split-Brain Runbook

## Scope and safety boundary

This runbook governs the scheduled `intelligence:bill-assessments` worker, the `intelligence_assessment_billing_events` ledger, and `intelligence_assessment_billing_reconciliations`. It applies to the PostgreSQL-only, cloud-agnostic BIS deployment. It does not authorize an operator to create a new TigerBeetle transfer ID, alter an assessment score, or infer a ledger settlement from a timeout.

> **Fail-closed rule:** A timeout, connection loss, non-OK response, or database update ambiguity means **settlement unknown**. It is never evidence that the charge failed or succeeded.

## Worker states and ten-attempt terminal path

| Event state | Meaning | Worker action | Human action |
|---|---|---|---|
| `pending` | Assessment is eligible for billing. | Lease with guarded update. | None. |
| `leased` | A worker has exclusive processing ownership. | Consume one entitlement or submit exactly the deterministic transfer ID. | Investigate only if lease becomes stale. |
| `retryable_failure` | Ledger/network/reconciliation uncertainty before attempt limit. | Retry no earlier than five minutes with the same deterministic transfer ID. | Monitor. |
| `awaiting_reconciliation` | Tenth retryable failure; a durable reconciliation case was inserted. | Do not retry automatically. | A different administrator must claim and resolve. |
| `settled` | Entitlement consumed or independent ledger evidence confirms transfer. | No action. | Review only through audit controls. |
| `payment_required` | No active entitlement and no approved prepaid path, or non-retryable integrity/payment failure. | Do not retry automatically. | Correct commercial state; do not modify the assessment. |
| `dead_letter` | Legacy or manually quarantined state. | Do not retry automatically. | Migrate into a reconciliation case before any replay. |

At attempt ten, `processIntelligenceAssessmentBillingEvent()` updates the event from `leased` to `awaiting_reconciliation`, stores the deterministic transfer ID if necessary, and inserts one `open` row in `intelligence_assessment_billing_reconciliations`. `UNIQUE (billing_event_id)` prevents duplicate reconciliation cases.

## Reconciliation workflow

1. **Freeze automated replay.** Verify the event remains `awaiting_reconciliation`; do not edit the transfer ID or score.
2. **Collect independent evidence.** Query the TigerBeetle cluster by the exact deterministic ID:

   ```text
   sha256("bis:intelligence-assessment:v1:" + billingEventId).slice(0, 32)
   ```

   Preserve the signed/exported ledger response in the approved evidence vault and calculate its SHA-256.
3. **Separate requester and reviewer.** The original requestor cannot claim or resolve the reconciliation. A tenant-scoped administrator claims it via `intelligenceBillingReconciliation.claim`.
4. **Select exactly one outcome.** Use `confirmSettled` only with an evidence reference and a 64-character evidence SHA-256. Use `confirmNotSettled` only after independent proof that the transfer ID is absent. Use `approveDeterministicRetry` only when ledger evidence is inconclusive, all nodes are healthy, and the reviewer approves a rationale of at least 20 characters.
5. **Never generate a new transfer identifier.** The approved retry resets the durable event to `retryable_failure`, preserving the event UUID. The next worker attempt derives the same ID.
6. **Evidence and audit.** Retain reviewer identity, timestamps, rationale, evidence reference, evidence digest, and the database/audit export under the applicable financial retention policy.

## Stale-lease monitoring and recovery

A lease is stale only after **300 seconds**. The worker’s recovery query changes only stale `leased` rows to `retryable_failure`, clears `lease_owner`/`leased_at`, and makes the row immediately eligible. The release should scrape the following PostgreSQL queries or expose equivalent metrics:

```sql
-- Active workers that may be stuck.
SELECT id, tenant_id, lease_owner, leased_at, attempt_count, last_error_code
FROM intelligence_assessment_billing_events
WHERE status = 'leased'
  AND leased_at < now() - interval '300 seconds'
ORDER BY leased_at;

-- Reconciliation queue requiring human action.
SELECT r.id, r.billing_event_id, r.deterministic_transfer_id, r.status,
       r.requested_at, r.last_error_code, e.attempt_count, e.amount_kobo
FROM intelligence_assessment_billing_reconciliations r
JOIN intelligence_assessment_billing_events e ON e.id = r.billing_event_id
WHERE r.status IN ('open','under_review')
ORDER BY r.requested_at;

-- Invariant: there must be no event with more than one reconciliation case.
SELECT billing_event_id, count(*)
FROM intelligence_assessment_billing_reconciliations
GROUP BY billing_event_id HAVING count(*) > 1;
```

Alert at warning when one stale lease exists for ten minutes or an event reaches attempt eight; alert critical when any `awaiting_reconciliation` case remains open for 30 minutes or a stale lease is older than 15 minutes. Page the database/ledger on-call only after confirming PostgreSQL time and worker clocks are synchronized.

## Split-brain containment

A split brain is suspected when two workers from different nodes report the same event or transfer at overlapping times, when different configuration fingerprints process the same stream, or when isolation causes both sides to reconnect concurrently.

| Step | Required control |
|---|---|
| 1. Contain | Pause the `intelligence:bill-assessments` schedule on all but one elected recovery node. Do not delete events or release all leases blindly. |
| 2. Preserve | Capture worker IDs, deployment digests, database timestamps, PostgreSQL replication health, and all TigerBeetle transfer lookups. |
| 3. Establish authority | PostgreSQL primary is the only lease authority. A standby/partitioned node must not have write credentials to the primary after fencing. |
| 4. Reconcile | For each contested event, query TigerBeetle by deterministic transfer ID and create/use exactly one reconciliation case. |
| 5. Recover | After fencing and clock/replication checks, let stale leases expire or explicitly wait five minutes; resume one node, then restore replicas one at a time. |
| 6. Verify | Confirm no duplicate events, no duplicate transfer IDs, no stale leases, and exact entitlement counter invariants before scaling out. |

Do not solve a split brain by clearing `leased_at`, resetting every `attempt_count`, changing a `tigerbeetle_transfer_id`, or creating compensating transfers without four-eyes financial approval.

## Release acceptance drill

In an isolated database and dedicated non-production TigerBeetle ledger, inject a network timeout after transfer submission but before PostgreSQL completion. Verify the event becomes retryable, then reconciliation-bound after its configured attempt limit; query the ledger by the deterministic ID; have a different administrator confirm the real result; and prove no second transfer exists. Retain the full worker logs, query output, reviewer approval, and audit evidence before production promotion.

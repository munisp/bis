# Payment Reconciliation Under-Review Runbook

## Scope and non-negotiable safety boundary

This runbook governs `payment_intent_outbox`, `payment_reconciliation_cases`, and `payment_reconciliation_events` in a PostgreSQL-only BIS deployment. It applies only after a durable payment intent reaches terminal handoff failure and is changed to `under_review` by the outbox escalation transaction.

> **Do not infer a payment outcome from a timeout, connection error, worker crash, or missing callback.** Such events mean that the external effect is unknown. They do not prove that a payment failed, succeeded, or should be retried.

No operator may use ad hoc SQL to alter a reconciliation case, directly edit the append-only event ledger, create a new transfer identifier, bulk-requeue dead-letter records, or create a compensating transfer outside an approved four-eyes financial-control process.

## Durable states and ownership

| Durable state                                 | Automated behavior                                                                               | Required human behavior                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `queued`                                      | A PostgreSQL-leased dispatcher may start the deterministic Temporal workflow.                    | None.                                                                                               |
| `leased`                                      | The lease holder starts the existing workflow and clears the lease after recording the result.   | Investigate only after the 300-second stale lease threshold.                                        |
| `workflow_started`                            | Temporal is the workflow owner. The API does not submit a rail directly.                         | Monitor provider and workflow completion.                                                           |
| `dead_letter` plus transaction `under_review` | Automated replay stops. The trigger creates exactly one tenant-bound `open` reconciliation case. | A different authorized reviewer claims, verifies, and resolves the case.                            |
| case `open`                                   | No payment action is permitted.                                                                  | Assign an independent tenant-scoped reviewer within 30 minutes.                                     |
| case `under_review`                           | No automated retry or reversal is permitted.                                                     | Collect independent provider and ledger evidence.                                                   |
| terminal case state                           | The state machine has recorded a decision.                                                       | Retain evidence and audit records; initiate compensation only through separately approved controls. |

## Metrics and thresholds

The server exposes only aggregate count/age/status metrics. It does not label metrics with tenant, payment reference, account, provider evidence, or other sensitive identifiers.

| Signal                                                       |  Threshold | Severity | Required response                                                                                                                                                           |
| ------------------------------------------------------------ | ---------: | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bis_payment_reconciliation_metrics_collection_healthy == 0` |  5 minutes | Critical | Freeze outbox scale-out; restore PostgreSQL connectivity and metric collection. Do not assume queues are healthy while observability is blind.                              |
| `bis_payment_intent_outbox_stale_leases > 0`                 | 10 minutes | Warning  | Check worker fencing, PostgreSQL time/replication health, and Temporal availability. Permit only the existing stale-lease recovery path after the 300-second lease timeout. |
| `sum(bis_payment_reconciliation_open_cases) > 25`            | 15 minutes | Warning  | Declare reconciliation surge. Allocate independent reviewers, investigate common provider/workflow error codes, and preserve automatic replay freeze.                       |
| `bis_payment_reconciliation_open_cases{state="open"} > 0`    | 30 minutes | Critical | Assign an authorized reviewer; isolate the affected rail if a systemic provider or workflow fault is evident.                                                               |
| `bis_payment_reconciliation_oldest_open_age_seconds > 14400` | 15 minutes | Critical | Trigger incident command. Fence competing workers, preserve evidence, and perform four-eyes disposition.                                                                    |
| `bis_payment_intent_outbox_events{state="dead_letter"} > 0`  |  5 minutes | Critical | Verify that every dead letter has one case/event generated by the database trigger. Do not create a new intent or transfer ID.                                              |

## Case triage

1. Verify PostgreSQL time and worker clocks are synchronized, then identify the aggregate alert class. Obtain a case through the guarded `paymentReconciliation.listOpen` procedure in the correct tenant context. Do not rely on client-supplied tenant identifiers.
2. Confirm the transaction is still `under_review`, the linked outbox is `dead_letter`, and the case is `open` or `under_review`. Any inconsistent combination is an incident; freeze automatic replay for that rail and preserve the current rows and worker deployment metadata.
3. A tenant-scoped administrator who did not initiate the original payment and is not the eventual resolver claims the case with `paymentReconciliation.claim`. The database records an append-only `case_claimed` event.
4. Retrieve provider and TigerBeetle evidence using the existing durable transaction reference and deterministic transfer identifier. Save raw records only in the approved evidence repository. Supply only opaque evidence references plus SHA-256 digests to the reconciliation procedure.

## Four-eyes resolution

A second authorized tenant-scoped administrator—different from the claimant—must use exactly one guarded terminal procedure. Each records immutable event metadata and requires both provider and ledger evidence references/digests.

| Evidence conclusion                                                    | Procedure                                         | Consequence                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Both systems prove the payment settled                                 | `paymentReconciliation.confirmSettled`            | Transaction becomes `completed`; case becomes `confirmed_settled`.                                                                     |
| Both systems prove no external effect                                  | `paymentReconciliation.confirmNotSettled`         | Transaction becomes `failed`; case becomes `confirmed_not_settled`.                                                                    |
| No external effect is proven and the existing intent is safe to replay | `paymentReconciliation.approveDeterministicRetry` | The **same** outbox row is queued with attempts reset; transaction returns to `pending`; no new intent or transfer identifier is made. |
| Evidence proves an external effect requiring a corrective action       | `paymentReconciliation.requireCompensation`       | Case becomes `compensation_required`; transaction stays `under_review`; no automated reversal occurs.                                  |

The PWA and mobile client must show the case as unresolved until a terminal state is returned by the guarded backend. A cancellation action is not a payment reversal and must not be represented as one.

## High-volume backlog and split-brain containment

When the warning backlog threshold is exceeded, do not expand worker concurrency first. Assign additional independent reviewers, group cases by non-sensitive error code and rail, and inspect PostgreSQL, Temporal, TigerBeetle, and provider health. A provider or workflow outage should retain the durable outbox/reconciliation state; it must not create synthetic success or failure states.

When a split brain is suspected—overlapping worker ownership, inconsistent deployment/configuration identity, concurrent provider responses, or a database partition—fence all but one elected dispatcher owner. PostgreSQL is the sole lease authority. Preserve worker IDs, deployment digests, database timestamps, outbox/case/event exports, and ledger/provider evidence. Allow stale leases to expire through the configured 300-second rule; never clear all leases manually. Resume one dispatcher only after fencing and evidence review, then add replicas incrementally while verifying no duplicate outbox cases or transfer identifiers exist.

## Release acceptance drill

In an isolated non-production PostgreSQL, Temporal, TigerBeetle, and provider environment, force a timeout after externally submitting a deterministic transfer but before workflow status persistence. Confirm that retry uses the existing identifiers only, terminal handoff failure opens one reconciliation case, two concurrent reviewers produce one terminal winner, an event update/delete is rejected, and a second administrator can resolve only with independent evidence. Retain the signed provider/ledger results, PostgreSQL query output, worker logs, reviewer decisions, and alert timeline before enabling a rail in production.

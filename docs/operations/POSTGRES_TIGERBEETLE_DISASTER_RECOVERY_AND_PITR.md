# PostgreSQL and TigerBeetle Disaster Recovery and PITR

## Scope and non-negotiable boundary

BIS treats PostgreSQL and TigerBeetle as separate systems of record. **PostgreSQL supports time-targeted recovery through a continuous base-backup and WAL archive chain. TigerBeetle recovery is replica/cluster recovery, not an application-level rewind of individual transfers.** Never restore one store while continuing writes in the other. First enter the application into maintenance mode, suspend all scheduled workers and payment ingress, and preserve the incident evidence.

> No operator may "correct" an uncertain ledger event by creating a replacement transfer. The existing deterministic transfer ID is the reconciliation key.

PostgreSQL continuous archiving requires a complete sequence of archived WAL files following a base backup. [1] TigerBeetle recovery must follow the replica-recovery procedure for the exact deployed TigerBeetle release. [2]

## Recovery objectives and prerequisites

| System | RPO objective | RTO objective | Mandatory recovery material |
|---|---:|---:|---|
| PostgreSQL operational cluster | <= 5 minutes of verified WAL archival lag | <= 4 hours | Encrypted base backup, continuous WAL archive, recovery credentials, PostgreSQL version/extension manifest, immutable migration checksums. |
| TigerBeetle ledger cluster | Cluster replication objective; assess actual committed state through surviving replicas | <= 4 hours for replica replacement; longer after all-replica loss | Version-matched binary, cluster/replica configuration, data-file backups, surviving replicas, deterministic transfer-ID reconciliation export. |
| Evidence/archive object store | Per configured versioning/retention policy | <= 8 hours | Versioned encrypted objects, KMS/KES/Vault recovery access, evidence manifests and custody metadata. |

Before an incident, run a monthly restore drill on an isolated network and retain the signed output under the incident evidence prefix. Required continuous checks include successful base backup, WAL archive freshness, restore-test completion, and a TigerBeetle replica health assessment.

## PostgreSQL continuous backup configuration

Use a dedicated non-superuser backup identity, TLS, and a private immutable backup repository. Example PostgreSQL settings, rendered by the database operator—not committed with credentials—are:

```conf
archive_mode = on
archive_timeout = '300s'
archive_command = 'pgbackrest --stanza=bis archive-push %p'
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
```

Use a version-matched `pgBackRest` deployment whose repository is separate from the primary cluster. Its storage credentials must be restricted to the `bis-postgres-pitr/` prefix and it must use the approved server-side encryption/KMS capability. Run a full backup weekly and differential backup daily, with WAL archiving continuously enabled:

```bash
pgbackrest --stanza=bis check
pgbackrest --stanza=bis --type=full backup
pgbackrest --stanza=bis --type=diff backup
pgbackrest --stanza=bis info --output=json
```

A failed `check`, backup, or archive freshness SLO is a release-blocking incident; do not accept a backup merely because a scheduled command returned success.

## PostgreSQL PITR execution

1. Incident commander records an immutable UTC target time `RECOVERY_TARGET_UTC` and approved change record. Stop BFF, gateway, all CronJobs, payment webhooks, provider dispatch, and object delete jobs. Preserve source volumes read-only.
2. Provision an **isolated, no-egress** PostgreSQL cluster running the identical major version and required extensions. Do not restore over a running primary.
3. Verify the source backup chain and select the most recent base backup before the target.

```bash
export RECOVERY_TARGET_UTC='2026-09-05 15:30:00+00'
pgbackrest --stanza=bis info
pgbackrest --stanza=bis --type=time --target="$RECOVERY_TARGET_UTC" --target-action=promote restore
```

4. Configure recovery before starting the restored PostgreSQL instance. With pgBackRest, the generated `postgresql.auto.conf` must contain a restore command and target. Verify, then start the cluster once:

```conf
restore_command = 'pgbackrest --stanza=bis archive-get %f "%p"'
recovery_target_time = '2026-09-05 15:30:00+00'
recovery_target_action = 'promote'
```

5. Confirm the server reached recovery target and promoted, then run read-only integrity checks:

```sql
SELECT pg_is_in_recovery();
SELECT max(migration_index), count(*) FROM bis_migrations.schema_migrations;
SELECT status, count(*) FROM intelligence_assessment_billing_events GROUP BY status;
SELECT status, count(*) FROM intelligence_assessment_billing_reconciliations GROUP BY status;
```

6. Compare migration ledger checksums against the release source and run `pnpm db:migrate` in verification mode only. A checksum mismatch is a hard stop. Verify tenant counts, immutable audit row counts, evidence manifests, and pending/reconciled billing-event IDs against the incident snapshot.
7. Restore a second verification clone from the same backup before authorizing service cutover. Security, data owner, and incident commander must sign the reconciliation report. Only then direct controlled traffic to the recovered cluster and re-enable workers one class at a time.

## TigerBeetle recovery

### Surviving replica recovery

If at least one authoritative replica survives, do not restore application data first. Quarantine failed nodes, keep the surviving cluster members running under the documented quorum rules, and recover the failed replica using the **version-matched TigerBeetle recovery command sequence**. TigerBeetle documents reformatting a permanently lost replica data file and joining it to recover from the live cluster. [2]

```bash
# Operator values must exactly match the existing cluster configuration.
tigerbeetle format --cluster=<cluster_id> --replica=<replacement_replica_id> --replica-count=<replica_count> /var/lib/tigerbeetle/data.tigerbeetle
tigerbeetle start --addresses=<ordered_cluster_addresses> /var/lib/tigerbeetle/data.tigerbeetle
```

Do not invent cluster IDs, addresses, replica counts, or data-file formats during an incident. Obtain them from the version-controlled secure cluster inventory and confirm with two operators. Keep the replacement node fenced from client traffic until it is caught up and the cluster reports healthy.

### All-replica loss

If all TigerBeetle replicas are lost or corrupt, declare a financial-record recovery incident. Build a new, isolated cluster from the most recent tested TigerBeetle data-file backup using the documented procedure for the exact binary version. PostgreSQL billing events are **not** authority to replay ledger transfers automatically. For each `intelligence_assessment_billing_events` row, locate the deterministic `tigerbeetle_transfer_id` in the recovered ledger/export. Classify as settled, not settled, or uncertain; route uncertain events to the four-eyes reconciliation queue. Only an independent, approved reconciliation decision may authorize a deterministic retry.

## Verification and evidence

| Gate | Required evidence | Fail-closed condition |
|---|---|---|
| PostgreSQL PITR | Target time, backup/WAL identity, `pg_is_in_recovery() = false`, checksum ledger, integrity SQL output | Missing WAL, unexpected promotion point, checksum mismatch, or unverified extension/version. |
| Ledger recovery | Replica health/export, data-file version/identity, deterministic-ID reconciliation report | No quorum, mismatched version/configuration, or unresolved transfer uncertainty. |
| Cross-store reconciliation | Counts and IDs of `settled`, `awaiting_reconciliation`, and `payment_required` billing records | Any automatic replay, changed deterministic ID, or unsigned approval. |
| Return to service | Two-person approval, SRE monitoring dashboard, no critical recovery alerts | Any stale lease, unresolved critical reconciliation, or failed evidence/KMS verification. |

## References

[1]: https://www.postgresql.org/docs/current/continuous-archiving.html "PostgreSQL: Continuous Archiving and Point-in-Time Recovery"
[2]: https://docs.tigerbeetle.com/operating/recovering/ "TigerBeetle: Recovering"

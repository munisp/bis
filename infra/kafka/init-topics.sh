#!/usr/bin/env bash
# infra/kafka/init-topics.sh
# Creates all BIS Platform Kafka topics with correct partition counts,
# replication factors, and retention policies.
# Safe to run multiple times — uses --if-not-exists.
#
# Usage (CI/CD):  ./infra/kafka/init-topics.sh
# Usage (Docker): Runs automatically via the kafka-init service in docker-compose.yml
set -euo pipefail

KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka:9092}"
REPLICATION="${KAFKA_REPLICATION:-1}"   # 1 for local dev; 3 for production
WAIT_SECS="${KAFKA_WAIT_SECS:-30}"

echo "[kafka-init] Waiting up to ${WAIT_SECS}s for Kafka broker at ${KAFKA_BOOTSTRAP}…"
deadline=$((SECONDS + WAIT_SECS))
until kafka-topics.sh --bootstrap-server "${KAFKA_BOOTSTRAP}" --list >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    echo "[kafka-init] ERROR: Kafka not ready after ${WAIT_SECS}s. Aborting."
    exit 1
  fi
  sleep 2
done
echo "[kafka-init] Kafka is ready."

# ─── Topic definitions ────────────────────────────────────────────────────────
# Format: "topic-name:partitions:retention-ms"
# retention-ms: -1 = infinite, 604800000 = 7 days, 2592000000 = 30 days
declare -a TOPICS=(
  # Core payment & transaction events
  "bis.payments.initiated:12:604800000"
  "bis.payments.completed:12:604800000"
  "bis.payments.failed:12:604800000"
  "bis.payments.dlq:3:2592000000"

  # AML & fraud
  "bis.aml.alerts:6:2592000000"
  "bis.aml.cases:6:2592000000"
  "bis.fraud.velocity:12:86400000"
  "bis.fraud.alerts:6:2592000000"

  # Insider threat & UEBA
  "bis.insider.events:6:2592000000"
  "bis.insider.alerts:6:2592000000"
  "bis.ueba.scores:6:2592000000"
  "bis.ueba.alerts:6:2592000000"

  # KYC / identity
  "bis.kyc.submitted:6:2592000000"
  "bis.kyc.verified:6:2592000000"
  "bis.kyc.rejected:6:2592000000"

  # Biometric
  "bis.biometric.enrolled:3:2592000000"
  "bis.biometric.verified:6:604800000"
  "bis.biometric.spoofs:3:2592000000"

  # Stablecoin / CBDC
  "bis.stablecoin.transfers:6:604800000"
  "bis.stablecoin.settlements:6:2592000000"
  "bis.cbdc.issuance:3:2592000000"

  # Mojaloop / NIP
  "bis.mojaloop.transfers:12:604800000"
  "bis.nip.transfers:12:604800000"

  # Compliance & audit
  "bis.audit.log:12:-1"
  "bis.compliance.reports:3:2592000000"
  "bis.sanctions.hits:3:2592000000"

  # Case management
  "bis.cases.created:3:2592000000"
  "bis.cases.updated:3:2592000000"
  "bis.cases.escalated:3:2592000000"

  # System
  "bis.system.heartbeat:3:86400000"
  "bis.system.dlq:3:2592000000"
  "bis.notifications.push:6:86400000"
)

created=0
skipped=0
failed=0

for entry in "${TOPICS[@]}"; do
  IFS=':' read -r topic partitions retention <<< "${entry}"
  if kafka-topics.sh \
      --bootstrap-server "${KAFKA_BOOTSTRAP}" \
      --create \
      --if-not-exists \
      --topic "${topic}" \
      --partitions "${partitions}" \
      --replication-factor "${REPLICATION}" \
      --config "retention.ms=${retention}" \
      2>&1 | grep -q "Created topic"; then
    echo "[kafka-init] ✓ Created: ${topic} (${partitions}p, retention=${retention}ms)"
    ((created++))
  else
    # Topic already exists — verify config is up to date
    kafka-configs.sh \
      --bootstrap-server "${KAFKA_BOOTSTRAP}" \
      --entity-type topics \
      --entity-name "${topic}" \
      --alter \
      --add-config "retention.ms=${retention}" \
      >/dev/null 2>&1 || true
    echo "[kafka-init] ↷ Exists:  ${topic}"
    ((skipped++))
  fi
done

echo ""
echo "[kafka-init] Done. Created=${created}, Skipped=${skipped}, Failed=${failed}"

# List all BIS topics for verification
echo ""
echo "[kafka-init] Current BIS topics:"
kafka-topics.sh --bootstrap-server "${KAFKA_BOOTSTRAP}" --list | grep "^bis\." | sort

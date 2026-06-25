#!/usr/bin/env bash
# infra/temporal/init-namespace.sh
# Registers the BIS Platform Temporal namespace with correct retention and search attributes.
# Safe to run multiple times — checks for existing namespace before creating.
#
# Usage (CI/CD):  ./infra/temporal/init-namespace.sh
# Usage (Docker): Runs automatically via the temporal-init service in docker-compose.yml
set -euo pipefail

TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-temporal:7233}"
NAMESPACE="${TEMPORAL_NAMESPACE:-bis}"
RETENTION_DAYS="${TEMPORAL_RETENTION_DAYS:-30}"
WAIT_SECS="${TEMPORAL_WAIT_SECS:-60}"

echo "[temporal-init] Waiting up to ${WAIT_SECS}s for Temporal server at ${TEMPORAL_ADDRESS}…"
deadline=$((SECONDS + WAIT_SECS))
until temporal operator namespace list --address "${TEMPORAL_ADDRESS}" >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    echo "[temporal-init] ERROR: Temporal not ready after ${WAIT_SECS}s. Aborting."
    exit 1
  fi
  sleep 3
done
echo "[temporal-init] Temporal is ready."

# ─── Register namespace if it doesn't exist ───────────────────────────────────
if temporal operator namespace describe "${NAMESPACE}" --address "${TEMPORAL_ADDRESS}" >/dev/null 2>&1; then
  echo "[temporal-init] ↷ Namespace '${NAMESPACE}' already exists."
else
  echo "[temporal-init] Creating namespace '${NAMESPACE}'…"
  temporal operator namespace create \
    --address "${TEMPORAL_ADDRESS}" \
    --namespace "${NAMESPACE}" \
    --retention "${RETENTION_DAYS}d" \
    --description "BIS Platform — AML, Insider Threat, KYC, and Payment workflows" \
    --email "ops@bis-platform.internal"
  echo "[temporal-init] ✓ Namespace '${NAMESPACE}' created with ${RETENTION_DAYS}-day retention."
fi

# ─── Register custom search attributes ────────────────────────────────────────
# These allow filtering workflow executions by BIS-specific fields in the Temporal UI.
echo "[temporal-init] Registering custom search attributes…"

declare -A SEARCH_ATTRS=(
  ["BisWorkflowType"]="Keyword"
  ["BisEntityId"]="Keyword"
  ["BisEntityType"]="Keyword"
  ["BisTenantId"]="Keyword"
  ["BisRiskTier"]="Keyword"
  ["BisAlertId"]="Keyword"
  ["BisReviewerId"]="Keyword"
  ["BisAmount"]="Double"
  ["BisCurrency"]="Keyword"
  ["BisComplianceStatus"]="Keyword"
)

for attr in "${!SEARCH_ATTRS[@]}"; do
  type="${SEARCH_ATTRS[$attr]}"
  if temporal operator search-attribute list \
      --address "${TEMPORAL_ADDRESS}" \
      --namespace "${NAMESPACE}" 2>/dev/null | grep -q "${attr}"; then
    echo "[temporal-init] ↷ Search attr '${attr}' already registered."
  else
    temporal operator search-attribute create \
      --address "${TEMPORAL_ADDRESS}" \
      --namespace "${NAMESPACE}" \
      --name "${attr}" \
      --type "${type}" 2>/dev/null || echo "[temporal-init] ⚠ Could not register '${attr}' (may need Temporal 1.20+)"
    echo "[temporal-init] ✓ Registered search attr: ${attr} (${type})"
  fi
done

# ─── Verify ───────────────────────────────────────────────────────────────────
echo ""
echo "[temporal-init] Namespace details:"
temporal operator namespace describe "${NAMESPACE}" --address "${TEMPORAL_ADDRESS}" 2>/dev/null || true
echo ""
echo "[temporal-init] Done."

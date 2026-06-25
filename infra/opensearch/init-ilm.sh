#!/usr/bin/env bash
# infra/opensearch/init-ilm.sh
# Creates OpenSearch ISM (Index State Management) policies, index templates,
# and initial indices for the BIS Platform.
#
# OpenSearch uses ISM (Index State Management), not Elasticsearch ILM.
# This script is equivalent to ILM but uses the OpenSearch ISM API.
#
# Usage (CI/CD):  OPENSEARCH_URL=http://localhost:9200 ./infra/opensearch/init-ilm.sh
# Usage (Docker): Runs automatically via the opensearch-init service in docker-compose.yml
set -euo pipefail

OS_URL="${OPENSEARCH_URL:-http://opensearch:9200}"
OS_USER="${OPENSEARCH_USER:-admin}"
OS_PASS="${OPENSEARCH_PASSWORD:-BisOpenSearch@2025!}"
WAIT_SECS="${OPENSEARCH_WAIT_SECS:-120}"

AUTH="-u ${OS_USER}:${OS_PASS}"

echo "[opensearch-init] Waiting up to ${WAIT_SECS}s for OpenSearch at ${OS_URL}…"
deadline=$((SECONDS + WAIT_SECS))
until curl -sf ${AUTH} "${OS_URL}/_cluster/health" | grep -q '"status":"green"\|"status":"yellow"'; do
  if [[ $SECONDS -ge $deadline ]]; then
    echo "[opensearch-init] ERROR: OpenSearch not ready after ${WAIT_SECS}s. Aborting."
    exit 1
  fi
  sleep 5
done
echo "[opensearch-init] OpenSearch is ready."

# ─── Helper functions ─────────────────────────────────────────────────────────

put_ism_policy() {
  local name="$1"
  local body="$2"
  echo "[opensearch-init] Creating ISM policy: ${name}"
  curl -sf ${AUTH} -X PUT "${OS_URL}/_plugins/_ism/policies/${name}" \
    -H "Content-Type: application/json" \
    -d "${body}" | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓' if '_id' in r else '  ⚠ ' + str(r))" 2>/dev/null || echo "  ↷ Already exists or updated."
}

put_index_template() {
  local name="$1"
  local body="$2"
  echo "[opensearch-init] Creating index template: ${name}"
  curl -sf ${AUTH} -X PUT "${OS_URL}/_index_template/${name}" \
    -H "Content-Type: application/json" \
    -d "${body}" | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓' if r.get('acknowledged') else '  ⚠ ' + str(r))" 2>/dev/null || echo "  ↷ Already exists or updated."
}

create_index_if_missing() {
  local name="$1"
  local body="$2"
  if curl -sf ${AUTH} -o /dev/null -w "%{http_code}" "${OS_URL}/${name}" | grep -q "200"; then
    echo "[opensearch-init] ↷ Index '${name}' already exists."
  else
    echo "[opensearch-init] Creating index: ${name}"
    curl -sf ${AUTH} -X PUT "${OS_URL}/${name}" \
      -H "Content-Type: application/json" \
      -d "${body}" | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓' if r.get('acknowledged') else '  ⚠ ' + str(r))" 2>/dev/null
  fi
}

# ─── ISM Policies ─────────────────────────────────────────────────────────────

# Hot-Warm-Cold-Delete policy for audit logs (high volume, long retention)
put_ism_policy "bis-audit-log-policy" '{
  "policy": {
    "description": "BIS audit log lifecycle: hot 7d → warm 23d → cold 60d → delete 90d",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [{ "rollover": { "min_size": "5gb", "min_index_age": "7d" } }],
        "transitions": [{ "state_name": "warm", "conditions": { "min_index_age": "7d" } }]
      },
      {
        "name": "warm",
        "actions": [{ "replica_count": { "number_of_replicas": 0 } }],
        "transitions": [{ "state_name": "cold", "conditions": { "min_index_age": "30d" } }]
      },
      {
        "name": "cold",
        "actions": [{ "read_only": {} }],
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "90d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }],
        "transitions": []
      }
    ],
    "ism_template": [{ "index_patterns": ["bis-audit-log-*"], "priority": 100 }]
  }
}'

# 30-day retention for alerts and insider events
put_ism_policy "bis-alerts-policy" '{
  "policy": {
    "description": "BIS alerts lifecycle: hot 7d → warm 23d → delete 30d",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [{ "rollover": { "min_size": "2gb", "min_index_age": "7d" } }],
        "transitions": [{ "state_name": "warm", "conditions": { "min_index_age": "7d" } }]
      },
      {
        "name": "warm",
        "actions": [{ "replica_count": { "number_of_replicas": 0 } }],
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "30d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }],
        "transitions": []
      }
    ],
    "ism_template": [
      { "index_patterns": ["bis-insider-events-*"], "priority": 100 },
      { "index_patterns": ["bis-aml-alerts-*"], "priority": 100 },
      { "index_patterns": ["bis-fraud-alerts-*"], "priority": 100 },
      { "index_patterns": ["bis-ueba-scores-*"], "priority": 100 }
    ]
  }
}'

# 365-day retention for KYC and compliance documents
put_ism_policy "bis-compliance-policy" '{
  "policy": {
    "description": "BIS compliance docs lifecycle: hot 30d → warm 335d → delete 365d",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [{ "rollover": { "min_size": "10gb", "min_index_age": "30d" } }],
        "transitions": [{ "state_name": "warm", "conditions": { "min_index_age": "30d" } }]
      },
      {
        "name": "warm",
        "actions": [{ "replica_count": { "number_of_replicas": 0 }, "read_only": {} }],
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "365d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }],
        "transitions": []
      }
    ],
    "ism_template": [
      { "index_patterns": ["bis-kyc-*"], "priority": 100 },
      { "index_patterns": ["bis-compliance-*"], "priority": 100 },
      { "index_patterns": ["bis-sanctions-*"], "priority": 100 }
    ]
  }
}'

# ─── Index Templates ──────────────────────────────────────────────────────────

put_index_template "bis-audit-log-template" '{
  "index_patterns": ["bis-audit-log-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.refresh_interval": "10s",
      "plugins.index_state_management.policy_id": "bis-audit-log-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp":    { "type": "date" },
        "userId":        { "type": "keyword" },
        "tenantId":      { "type": "keyword" },
        "action":        { "type": "keyword" },
        "resource":      { "type": "keyword" },
        "resourceId":    { "type": "keyword" },
        "ipAddress":     { "type": "ip" },
        "userAgent":     { "type": "text", "index": false },
        "outcome":       { "type": "keyword" },
        "riskScore":     { "type": "float" },
        "metadata":      { "type": "object", "dynamic": true }
      }
    }
  }
}'

put_index_template "bis-insider-events-template" '{
  "index_patterns": ["bis-insider-events-*"],
  "template": {
    "settings": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "plugins.index_state_management.policy_id": "bis-alerts-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp":    { "type": "date" },
        "userId":        { "type": "keyword" },
        "tenantId":      { "type": "keyword" },
        "eventType":     { "type": "keyword" },
        "severity":      { "type": "keyword" },
        "deviationScore":{ "type": "float" },
        "riskTier":      { "type": "keyword" },
        "description":   { "type": "text" },
        "metadata":      { "type": "object", "dynamic": true }
      }
    }
  }
}'

put_index_template "bis-kyc-template" '{
  "index_patterns": ["bis-kyc-*"],
  "template": {
    "settings": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "plugins.index_state_management.policy_id": "bis-compliance-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp":    { "type": "date" },
        "customerId":    { "type": "keyword" },
        "tenantId":      { "type": "keyword" },
        "verificationType": { "type": "keyword" },
        "status":        { "type": "keyword" },
        "provider":      { "type": "keyword" },
        "riskLevel":     { "type": "keyword" },
        "fullName":      { "type": "text" },
        "nationalId":    { "type": "keyword" },
        "metadata":      { "type": "object", "dynamic": true }
      }
    }
  }
}'

# ─── Create initial write indices ─────────────────────────────────────────────

TODAY=$(date +%Y.%m.%d)

create_index_if_missing "bis-audit-log-${TODAY}-000001" '{
  "aliases": { "bis-audit-log-write": { "is_write_index": true } }
}'

create_index_if_missing "bis-insider-events-${TODAY}-000001" '{
  "aliases": { "bis-insider-events-write": { "is_write_index": true } }
}'

create_index_if_missing "bis-kyc-${TODAY}-000001" '{
  "aliases": { "bis-kyc-write": { "is_write_index": true } }
}'

create_index_if_missing "bis-aml-alerts-${TODAY}-000001" '{
  "aliases": { "bis-aml-alerts-write": { "is_write_index": true } }
}'

echo ""
echo "[opensearch-init] Verifying ISM policies:"
curl -sf ${AUTH} "${OS_URL}/_plugins/_ism/policies" | python3 -c "
import sys, json
r = json.load(sys.stdin)
policies = r.get('policies', [])
for p in policies:
    print(f\"  ✓ {p['_id']}\")
print(f'  Total: {len(policies)} policies')
" 2>/dev/null || echo "  (could not list policies)"

echo ""
echo "[opensearch-init] Done."

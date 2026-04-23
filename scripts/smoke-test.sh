#!/usr/bin/env bash
# ─── BIS Platform Smoke Tests ─────────────────────────────────────────────────
# Tests all service health endpoints and critical API paths.
# Usage: bash scripts/smoke-test.sh [BFF_URL]
# Default BFF_URL: http://localhost:3001

set -euo pipefail

BFF_URL="${BFF_URL:-http://localhost:3001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8081}"
PAYMENT_RAILS_URL="${PAYMENT_RAILS_URL:-http://localhost:8094}"
AML_ENGINE_URL="${AML_ENGINE_URL:-http://localhost:8095}"
RISK_SCORING_URL="${RISK_SCORING_URL:-http://localhost:8096}"
RISK_ENGINE_URL="${RISK_ENGINE_URL:-http://localhost:8082}"
CASE_MANAGER_URL="${CASE_MANAGER_URL:-http://localhost:8092}"
LEX_INTAKE_URL="${LEX_INTAKE_URL:-http://localhost:8087}"
LEX_VALIDATOR_URL="${LEX_VALIDATOR_URL:-http://localhost:8089}"
BIOMETRIC_ENGINE_URL="${BIOMETRIC_ENGINE_URL:-http://localhost:8084}"
LAKEHOUSE_WRITER_URL="${LAKEHOUSE_WRITER_URL:-http://localhost:8085}"
ML_ENRICHMENT_URL="${ML_ENRICHMENT_URL:-http://localhost:8086}"
EVENT_EMITTER_URL="${EVENT_EMITTER_URL:-http://localhost:8091}"
EVENT_PROCESSOR_URL="${EVENT_PROCESSOR_URL:-http://localhost:8090}"

PASS=0
FAIL=0
SKIP=0

# ─── Helpers ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}  ✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ✗${NC} $1: $2"; FAIL=$((FAIL+1)); }
skip() { echo -e "${YELLOW}  ⊘${NC} $1 (skipped)"; SKIP=$((SKIP+1)); }
section() { echo -e "\n${BLUE}▸ $1${NC}"; }

check_health() {
  local name="$1"
  local url="$2"
  local timeout="${3:-5}"
  
  if response=$(curl -sf --max-time "$timeout" "$url" 2>/dev/null); then
    pass "$name health: $url"
    return 0
  else
    fail "$name health" "$url returned non-2xx or timed out"
    return 1
  fi
}

check_json_field() {
  local name="$1"
  local url="$2"
  local field="$3"
  local expected="$4"
  
  if response=$(curl -sf --max-time 5 "$url" 2>/dev/null); then
    actual=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || echo "")
    if [ "$actual" = "$expected" ]; then
      pass "$name: $field=$expected"
    else
      fail "$name" "expected $field=$expected, got $field=$actual"
    fi
  else
    fail "$name" "$url unreachable"
  fi
}

# ─── BFF / tRPC ───────────────────────────────────────────────────────────────
section "BFF (Node.js tRPC)"
check_health "BFF" "$BFF_URL/api/trpc/auth.me" || true

# ─── Go Services ──────────────────────────────────────────────────────────────
section "Go Services"
check_health "Gateway" "$GATEWAY_URL/health" || true
check_health "Case Manager" "$CASE_MANAGER_URL/health" || true
check_health "LEX Intake" "$LEX_INTAKE_URL/health" || true
check_health "Payment Rails" "$PAYMENT_RAILS_URL/health" || true

# ─── Rust Services ────────────────────────────────────────────────────────────
section "Rust Services"
check_health "AML Engine" "$AML_ENGINE_URL/health" || true
# ─── Python Services ─────────────────────────────────────────────────────────────────────
section "Python Services"
check_health "Risk Engine" "$RISK_ENGINE_URL/health" || true
check_health "LEX Validator" "$LEX_VALIDATOR_URL/health" || true
check_health "Risk Scoring" "$RISK_SCORING_URL/health" || true
check_health "Biometric Engine" "$BIOMETRIC_ENGINE_URL/health" || true
check_health "Lakehouse Writer" "$LAKEHOUSE_WRITER_URL/health" || true
check_health "ML Enrichment" "$ML_ENRICHMENT_URL/health" || true

# ─── Rust Services (additional) ─────────────────────────────────────────────────────────────────────
section "Rust Services (additional)"
check_health "Event Emitter" "$EVENT_EMITTER_URL/health" || true
check_health "Event Processor" "$EVENT_PROCESSOR_URL/health" || true

# ─── Biometric Engine API ─────────────────────────────────────────────────────────────────────
section "Biometric Engine API"
if curl -sf --max-time 5 "$BIOMETRIC_ENGINE_URL/health" > /dev/null 2>&1; then
  enroll_resp=$(curl -sf --max-time 10 -X GET "$BIOMETRIC_ENGINE_URL/enrollments" 2>/dev/null || echo '{}')
  if echo "$enroll_resp" | grep -q "enrolled"; then
    pass "Biometric enrollments list endpoint"
  else
    fail "Biometric enrollments list" "unexpected response"
  fi
else
  skip "Biometric Engine API tests (service not running)"
fi

# ─── Lakehouse Writer API ─────────────────────────────────────────────────────────────────────
section "Lakehouse Writer API"
if curl -sf --max-time 5 "$LAKEHOUSE_WRITER_URL/health" > /dev/null 2>&1; then
  stats_resp=$(curl -sf --max-time 10 "$LAKEHOUSE_WRITER_URL/stats" 2>/dev/null || echo '{}')
  if echo "$stats_resp" | grep -q "stats"; then
    pass "Lakehouse stats endpoint"
  else
    fail "Lakehouse stats" "unexpected response"
  fi
else
  skip "Lakehouse Writer API tests (service not running)"
fi

# ─── Payment Rails API ─────────────────────────────────────────────────────────────────────
section "Payment Rails API"
if curl -sf --max-time 5 "$PAYMENT_RAILS_URL/health" > /dev/null 2>&1; then
  # Test SWIFT validation
  swift_resp=$(curl -sf --max-time 5 -X POST "$PAYMENT_RAILS_URL/api/swift/validate" \
    -H "Content-Type: application/json" \
    -d '{"bic":"BARCGB22","amount":50000,"currency":"USD","debtorAccount":"GB29NWBK60161331926819","creditorAccount":"DE89370400440532013000","creditorBic":"DEUTDEDB","remittanceInfo":"Invoice INV-2024-001"}' 2>/dev/null || echo '{}')
  if echo "$swift_resp" | grep -q "valid\|status"; then
    pass "SWIFT MT103 validation endpoint"
  else
    fail "SWIFT MT103 validation" "unexpected response"
  fi
  
  # Test SEPA validation
  sepa_resp=$(curl -sf --max-time 5 -X POST "$PAYMENT_RAILS_URL/api/sepa/validate" \
    -H "Content-Type: application/json" \
    -d '{"amount":1500,"currency":"EUR","debtorIban":"DE89370400440532013000","creditorIban":"FR7630006000011234567890189","creditorName":"Test Corp","remittanceInfo":"Test payment"}' 2>/dev/null || echo '{}')
  if echo "$sepa_resp" | grep -q "valid\|status"; then
    pass "SEPA SCT validation endpoint"
  else
    fail "SEPA SCT validation" "unexpected response"
  fi
else
  skip "Payment Rails API tests (service not running)"
fi

# ─── AML Engine API ───────────────────────────────────────────────────────────
section "AML Engine API"
if curl -sf --max-time 5 "$AML_ENGINE_URL/health" > /dev/null 2>&1; then
  score_resp=$(curl -sf --max-time 10 -X POST "$AML_ENGINE_URL/api/score" \
    -H "Content-Type: application/json" \
    -d '{"transaction_id":"TXN-SMOKE-001","amount":75000,"currency":"USD","sender_country":"NG","receiver_country":"US","transaction_type":"wire","sender_id":"CUST-001","receiver_id":"CUST-002"}' 2>/dev/null || echo '{}')
  if echo "$score_resp" | grep -q "risk_score\|score"; then
    pass "AML risk scoring endpoint"
  else
    fail "AML risk scoring" "unexpected response"
  fi
else
  skip "AML Engine API tests (service not running)"
fi

# ─── Risk Scoring API ─────────────────────────────────────────────────────────
section "Risk Scoring API"
if curl -sf --max-time 5 "$RISK_SCORING_URL/health" > /dev/null 2>&1; then
  risk_resp=$(curl -sf --max-time 10 -X POST "$RISK_SCORING_URL/api/score" \
    -H "Content-Type: application/json" \
    -d '{"entity_id":"ENT-001","entity_type":"individual","country":"NG","transaction_amount":50000,"transaction_count":12,"pep_flag":false,"sanctions_flag":false,"adverse_media_flag":false}' 2>/dev/null || echo '{}')
  if echo "$risk_resp" | grep -q "risk_score\|score"; then
    pass "ML risk scoring endpoint"
  else
    fail "ML risk scoring" "unexpected response"
  fi
else
  skip "Risk Scoring API tests (service not running)"
fi

# ─── LEX Intake API ───────────────────────────────────────────────────────────
section "LEX Intake API"
if curl -sf --max-time 5 "$LEX_INTAKE_URL/health" > /dev/null 2>&1; then
  # Test PIN issue
  pin_resp=$(curl -sf --max-time 5 -X POST "$LEX_INTAKE_URL/pin/issue" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+2348012345678"}' 2>/dev/null || echo '{}')
  if echo "$pin_resp" | grep -q "issued\|success\|pin"; then
    pass "LEX PIN issue endpoint"
  else
    fail "LEX PIN issue" "unexpected response: $pin_resp"
  fi
else
  skip "LEX Intake API tests (service not running)"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────────────────"
echo -e "Smoke Test Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "─────────────────────────────────────────────────────"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}✗ Smoke tests FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}✓ All smoke tests PASSED${NC}"
  exit 0
fi

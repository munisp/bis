#!/usr/bin/env bash
# =============================================================================
# BIS Platform — Infrastructure Bootstrap
# Mirrors the Devin/OpenHands pattern: spin up all middleware via Docker socket
# before starting any application code.
#
# Usage:
#   ./infra/bootstrap.sh              # full stack
#   ./infra/bootstrap.sh --core-only  # postgres + redis + kafka + keycloak only
#   ./infra/bootstrap.sh --reset      # tear down + clean volumes + re-bootstrap
#
# Requirements:
#   - Docker Engine 24+ with /var/run/docker.sock
#   - docker compose v2 plugin
#   - 8 GB RAM, 20 GB disk
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
LOG_DIR="$PROJECT_ROOT/.infra-logs"
TIMEOUT_SECS="${BOOTSTRAP_TIMEOUT:-300}"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
banner()  { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${RESET}"; echo -e "${BOLD}${CYAN}  $*${RESET}"; echo -e "${BOLD}${CYAN}══════════════════════════════════════════${RESET}\n"; }

# ── Parse flags ───────────────────────────────────────────────────────────────
CORE_ONLY=false
RESET=false
for arg in "$@"; do
  case "$arg" in
    --core-only) CORE_ONLY=true ;;
    --reset)     RESET=true ;;
    --help|-h)
      echo "Usage: $0 [--core-only] [--reset] [--help]"
      echo "  --core-only  Start only postgres, redis, kafka, keycloak, permify"
      echo "  --reset      Tear down all containers + volumes, then re-bootstrap"
      exit 0
      ;;
  esac
done

# ── Preflight checks ──────────────────────────────────────────────────────────
banner "BIS Infrastructure Bootstrap"

info "Checking Docker socket..."
if ! docker info &>/dev/null && ! sudo docker info &>/dev/null; then
  error "Docker daemon is not running. Start it with: sudo systemctl start docker"
  exit 1
fi

# Use sudo if current user is not in docker group
DOCKER_CMD="docker"
if ! docker info &>/dev/null 2>&1; then
  DOCKER_CMD="sudo docker"
  warn "Using sudo docker (add yourself to the docker group to avoid this)"
fi

COMPOSE="$DOCKER_CMD compose -f $COMPOSE_FILE"

info "Docker version: $($DOCKER_CMD version --format '{{.Server.Version}}')"
info "Compose version: $($DOCKER_CMD compose version --short)"
info "Project root: $PROJECT_ROOT"

mkdir -p "$LOG_DIR"

# ── Reset if requested ────────────────────────────────────────────────────────
if $RESET; then
  banner "Resetting all containers and volumes"
  warn "This will DELETE all data in all volumes!"
  read -r -p "Are you sure? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    $COMPOSE down --volumes --remove-orphans 2>&1 | tee "$LOG_DIR/reset.log"
    success "All containers and volumes removed"
  else
    info "Reset cancelled"
    exit 0
  fi
fi

# ── Health-gate helper ────────────────────────────────────────────────────────
wait_for_container() {
  local service="$1"
  local check_cmd="$2"
  local label="${3:-$service}"
  local deadline=$(( $(date +%s) + TIMEOUT_SECS ))

  info "Waiting for $label to become healthy..."
  while true; do
    if eval "$check_cmd" &>/dev/null; then
      success "$label is healthy"
      return 0
    fi
    if (( $(date +%s) > deadline )); then
      error "$label did not become healthy within ${TIMEOUT_SECS}s"
      $COMPOSE logs --tail=50 "$service" 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

# ── Stage 1: Core data stores ─────────────────────────────────────────────────
banner "Stage 1 — Core Data Stores (PostgreSQL, Redis)"

$COMPOSE up -d postgres redis 2>&1 | tee "$LOG_DIR/stage1.log"

wait_for_container "postgres" \
  "$DOCKER_CMD exec \$(cd $PROJECT_ROOT && $DOCKER_CMD compose ps -q postgres) pg_isready -U bis_user -d bis_db" \
  "PostgreSQL"

wait_for_container "redis" \
  "$DOCKER_CMD exec \$(cd $PROJECT_ROOT && $DOCKER_CMD compose ps -q redis) redis-cli ping | grep -q PONG" \
  "Redis"

success "Stage 1 complete"

# ── Stage 2: Kafka + Zookeeper ────────────────────────────────────────────────
banner "Stage 2 — Message Broker (Zookeeper, Kafka)"

$COMPOSE up -d zookeeper kafka 2>&1 | tee "$LOG_DIR/stage2.log"

wait_for_container "kafka" \
  "$DOCKER_CMD exec \$(cd $PROJECT_ROOT && $DOCKER_CMD compose ps -q kafka) kafka-broker-api-versions.sh --bootstrap-server localhost:9092" \
  "Kafka"

success "Stage 2 complete"

# ── Stage 3: Kafka topic init ─────────────────────────────────────────────────
banner "Stage 3 — Kafka Topic Initialisation"

$COMPOSE up kafka-init 2>&1 | tee "$LOG_DIR/stage3.log"
# kafka-init is a one-shot container; wait for it to exit 0
KAFKA_INIT_ID=$($COMPOSE ps -q kafka-init 2>/dev/null || true)
if [[ -n "$KAFKA_INIT_ID" ]]; then
  EXIT_CODE=$($DOCKER_CMD wait "$KAFKA_INIT_ID" 2>/dev/null || echo "0")
  if [[ "$EXIT_CODE" != "0" ]]; then
    warn "kafka-init exited with code $EXIT_CODE — topics may already exist (OK)"
  else
    success "All 32 Kafka topics created"
  fi
fi

# ── Stage 4: Identity & Access (Keycloak, Permify) ───────────────────────────
banner "Stage 4 — Identity & Access (Keycloak, Permify)"

$COMPOSE up -d keycloak permify 2>&1 | tee "$LOG_DIR/stage4.log"

wait_for_container "keycloak" \
  "curl -sf http://localhost:8080/health/ready" \
  "Keycloak"

wait_for_container "permify" \
  "curl -sf http://localhost:3476/healthz" \
  "Permify"

success "Stage 4 complete"

# ── Stage 5: Temporal ─────────────────────────────────────────────────────────
banner "Stage 5 — Workflow Engine (Temporal)"

$COMPOSE up -d temporal 2>&1 | tee "$LOG_DIR/stage5.log"

wait_for_container "temporal" \
  "curl -sf http://localhost:7233/api/v1/namespaces" \
  "Temporal"

# Register namespace
$COMPOSE up temporal-init 2>&1 | tee -a "$LOG_DIR/stage5.log"
success "Stage 5 complete"

if $CORE_ONLY; then
  banner "Core-only mode — skipping remaining stages"
  print_status
  exit 0
fi

# ── Stage 6: Observability ────────────────────────────────────────────────────
banner "Stage 6 — Observability (Prometheus, Grafana, InfluxDB)"

$COMPOSE up -d prometheus influxdb grafana 2>&1 | tee "$LOG_DIR/stage6.log"

wait_for_container "prometheus" \
  "curl -sf http://localhost:9090/-/healthy" \
  "Prometheus"

success "Stage 6 complete"

# ── Stage 7: Search & Analytics (OpenSearch) ──────────────────────────────────
banner "Stage 7 — Search & Analytics (OpenSearch)"

$COMPOSE up -d opensearch opensearch-dashboards 2>&1 | tee "$LOG_DIR/stage7.log"

wait_for_container "opensearch" \
  "curl -sf http://localhost:9200/_cluster/health | grep -E '\"status\":\"(green|yellow)\"'" \
  "OpenSearch"

# Apply ISM policies and index templates
$COMPOSE up opensearch-init 2>&1 | tee -a "$LOG_DIR/stage7.log"
success "Stage 7 complete"

# ── Stage 8: API Gateway & Security (APISix, open-appsec) ────────────────────
banner "Stage 8 — API Gateway (APISix, open-appsec)"

$COMPOSE up -d apisix open-appsec 2>&1 | tee "$LOG_DIR/stage8.log"

wait_for_container "apisix" \
  "curl -sf http://localhost:9080/apisix/admin/routes -H 'X-API-KEY: edd1c9f034335f136f87ad84b625c8f1'" \
  "APISix"

success "Stage 8 complete"

# ── Stage 9: Ledger (TigerBeetle) ────────────────────────────────────────────
banner "Stage 9 — Ledger (TigerBeetle)"

$COMPOSE up tigerbeetle-init 2>&1 | tee "$LOG_DIR/stage9.log"
$COMPOSE up -d tigerbeetle tigerbeetle-http 2>&1 | tee -a "$LOG_DIR/stage9.log"

wait_for_container "tigerbeetle-http" \
  "curl -sf http://localhost:3001/health" \
  "TigerBeetle HTTP"

success "Stage 9 complete"

# ── Stage 10: AI/ML (Ollama) ──────────────────────────────────────────────────
banner "Stage 10 — AI/ML (Ollama)"

$COMPOSE up -d ollama 2>&1 | tee "$LOG_DIR/stage10.log"

wait_for_container "ollama" \
  "curl -sf http://localhost:11434/api/tags" \
  "Ollama"

success "Stage 10 complete"

# ── Stage 11: Application services ───────────────────────────────────────────
banner "Stage 11 — Application Services"

$COMPOSE up -d \
  gateway risk-engine event-processor biometric-engine bff \
  ml-enrichment case-manager event-emitter \
  lex-intake lex-validator lex-matcher verifier \
  payment-rails aml-engine risk-scoring \
  opensearch-indexer fluvio-velocity kafka-schema-registry \
  ollama-adapter lakehouse-writer 2>&1 | tee "$LOG_DIR/stage11.log"

wait_for_container "gateway" \
  "curl -sf http://localhost:8081/health" \
  "Go API Gateway"

wait_for_container "bff" \
  "curl -sf http://localhost:3000/api/health" \
  "Node.js BFF"

success "Stage 11 complete"

# ── Final status ──────────────────────────────────────────────────────────────
print_status() {
  banner "Infrastructure Status"
  $COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
  $COMPOSE ps 2>/dev/null
}

print_status

echo ""
echo -e "${BOLD}${GREEN}✓ BIS infrastructure is fully operational${RESET}"
echo ""
echo -e "  ${CYAN}PostgreSQL${RESET}         → localhost:5432  (bis_user / bis_secure_2026 / bis_db)"
echo -e "  ${CYAN}Redis${RESET}              → localhost:6379"
echo -e "  ${CYAN}Kafka${RESET}              → localhost:9092"
echo -e "  ${CYAN}Keycloak${RESET}           → http://localhost:8080  (admin / admin)"
echo -e "  ${CYAN}Permify${RESET}            → localhost:3476"
echo -e "  ${CYAN}Temporal${RESET}           → localhost:7233  (UI: http://localhost:8088)"
echo -e "  ${CYAN}Prometheus${RESET}         → http://localhost:9090"
echo -e "  ${CYAN}Grafana${RESET}            → http://localhost:3000  (admin / admin)"
echo -e "  ${CYAN}OpenSearch${RESET}         → http://localhost:9200"
echo -e "  ${CYAN}OpenSearch Dashboards${RESET} → http://localhost:5601"
echo -e "  ${CYAN}APISix${RESET}             → http://localhost:9080"
echo -e "  ${CYAN}TigerBeetle HTTP${RESET}   → http://localhost:3001"
echo -e "  ${CYAN}Ollama${RESET}             → http://localhost:11434"
echo -e "  ${CYAN}Go API Gateway${RESET}     → http://localhost:8081"
echo -e "  ${CYAN}Node.js BFF${RESET}        → http://localhost:3000"
echo ""
echo -e "  Logs: ${LOG_DIR}/"
echo ""

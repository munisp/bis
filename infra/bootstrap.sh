#!/usr/bin/env bash
# =============================================================================
# BIS Platform — Infrastructure Bootstrap
# Mirrors the Devin/OpenHands pattern: spin up all middleware via Docker socket
# before starting any application code.
#
# Usage:
#   ./infra/bootstrap.sh              # full stack
#   ./infra/bootstrap.sh --core-only  # postgres + redis + kafka + keycloak + temporal
#   ./infra/bootstrap.sh --wait       # full stack + block until ALL services healthy
#   ./infra/bootstrap.sh --reset      # tear down + clean volumes + re-bootstrap
#   ./infra/bootstrap.sh --status     # show current container health
#
# Requirements:
#   - Docker Engine 24+ with /var/run/docker.sock
#   - docker compose v2 plugin
#   - 4 GB RAM minimum (--core-only), 8 GB for full stack
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
LOG_DIR="$PROJECT_ROOT/.infra-logs"
TIMEOUT_SECS="${BOOTSTRAP_TIMEOUT:-300}"
HEALTH_POLL_INTERVAL=5   # seconds between health watch polls

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
banner()  {
  echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${CYAN}  $*${RESET}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════${RESET}\n"
}

# ── Parse flags ───────────────────────────────────────────────────────────────
CORE_ONLY=false
RESET=false
WAIT=false
STATUS_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --core-only)  CORE_ONLY=true ;;
    --reset)      RESET=true ;;
    --wait)       WAIT=true ;;
    --status)     STATUS_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--core-only] [--wait] [--reset] [--status] [--help]"
      echo ""
      echo "  (no flags)   Start full stack (all 20+ services)"
      echo "  --core-only  Start core tier: postgres, redis, zookeeper, kafka,"
      echo "               keycloak, permify, temporal (4 GB RAM minimum)"
      echo "  --wait       Block until ALL started services report healthy"
      echo "               (polls every ${HEALTH_POLL_INTERVAL}s, exits 0 when all green)"
      echo "  --reset      Tear down all containers + volumes, then re-bootstrap"
      echo "  --status     Show current container health and exit"
      echo ""
      echo "Environment variables:"
      echo "  BOOTSTRAP_TIMEOUT   Max seconds to wait for each service (default: 300)"
      exit 0
      ;;
  esac
done

# ── Docker command detection ──────────────────────────────────────────────────
DOCKER_CMD="docker"
if ! docker info &>/dev/null 2>&1; then
  if sudo docker info &>/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
  else
    error "Docker daemon is not running or not accessible."
    error "Start it with: sudo systemctl start docker"
    error "Or add yourself to the docker group: sudo usermod -aG docker \$USER"
    exit 1
  fi
fi

COMPOSE="$DOCKER_CMD compose -f $COMPOSE_FILE"
mkdir -p "$LOG_DIR"

# ── Status-only mode ──────────────────────────────────────────────────────────
if $STATUS_ONLY; then
  banner "BIS Infrastructure Status"
  $COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    $COMPOSE ps 2>/dev/null
  exit 0
fi

# ── Preflight checks ──────────────────────────────────────────────────────────
banner "BIS Infrastructure Bootstrap"

info "Docker version: $($DOCKER_CMD version --format '{{.Server.Version}}')"
info "Compose version: $($DOCKER_CMD compose version --short)"
info "Project root: $PROJECT_ROOT"

# Memory guard — warn if available RAM is below threshold
AVAIL_MB=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
if $CORE_ONLY; then
  if (( AVAIL_MB < 2048 )); then
    warn "Available RAM: ${AVAIL_MB}MB — core-only mode requires ~2 GB. Continuing anyway."
  else
    info "Available RAM: ${AVAIL_MB}MB — sufficient for core-only mode"
  fi
else
  if (( AVAIL_MB < 6144 )); then
    warn "Available RAM: ${AVAIL_MB}MB — full stack recommends 8 GB. Consider --core-only."
    warn "Continuing in 5 seconds... (Ctrl+C to abort)"
    sleep 5
  else
    info "Available RAM: ${AVAIL_MB}MB — sufficient for full stack"
  fi
fi

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
# wait_for_container SERVICE CHECK_CMD [LABEL]
# Polls CHECK_CMD every 3s until it exits 0 or TIMEOUT_SECS is exceeded.
wait_for_container() {
  local service="$1"
  local check_cmd="$2"
  local label="${3:-$service}"
  local deadline=$(( $(date +%s) + TIMEOUT_SECS ))

  info "Waiting for $label..."
  while true; do
    if eval "$check_cmd" &>/dev/null 2>&1; then
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

# ── wait_for_all_healthy ──────────────────────────────────────────────────────
# Polls all running containers every HEALTH_POLL_INTERVAL seconds.
# Exits 0 only when every container reports "healthy" or "running" (no healthcheck).
# This is the --wait mode entry point and can also be called from CI.
wait_for_all_healthy() {
  local poll_interval="${1:-$HEALTH_POLL_INTERVAL}"
  local deadline=$(( $(date +%s) + TIMEOUT_SECS ))

  banner "Health Watch — polling every ${poll_interval}s until all services healthy"

  while true; do
    local all_healthy=true
    local unhealthy_list=()

    # Get all container names and their health status
    while IFS= read -r line; do
      local name status
      name=$(echo "$line" | awk '{print $1}')
      status=$(echo "$line" | awk '{print $2}')

      case "$status" in
        "healthy"|"running")
          # OK — either has healthcheck and passed, or has no healthcheck
          ;;
        "starting"|"health: starting")
          all_healthy=false
          unhealthy_list+=("$name (starting)")
          ;;
        "unhealthy")
          all_healthy=false
          unhealthy_list+=("$name (unhealthy)")
          ;;
        *)
          # exited, dead, etc.
          all_healthy=false
          unhealthy_list+=("$name ($status)")
          ;;
      esac
    done < <($COMPOSE ps --format "{{.Name}} {{.State}}" 2>/dev/null || true)

    if $all_healthy; then
      success "All services are healthy!"
      $COMPOSE ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
      return 0
    fi

    if (( $(date +%s) > deadline )); then
      error "Timed out waiting for all services to become healthy"
      error "Still unhealthy: ${unhealthy_list[*]}"
      $COMPOSE ps 2>/dev/null || true
      return 1
    fi

    info "Waiting for: ${unhealthy_list[*]}"
    sleep "$poll_interval"
  done
}

# ── Stage 1: Core data stores ─────────────────────────────────────────────────
banner "Stage 1 — Core Data Stores (PostgreSQL, Redis)"

$COMPOSE up -d postgres redis 2>&1 | tee "$LOG_DIR/stage1.log"

wait_for_container "postgres" \
  "$COMPOSE exec -T postgres pg_isready -U bis -d bis" \
  "PostgreSQL"

wait_for_container "redis" \
  "$COMPOSE exec -T redis redis-cli -a \${REDIS_PASSWORD:-bis_redis_dev} ping | grep -q PONG" \
  "Redis"

success "Stage 1 complete"

# ── Stage 2: Kafka + Zookeeper ────────────────────────────────────────────────
banner "Stage 2 — Message Broker (Zookeeper, Kafka)"

$COMPOSE up -d zookeeper 2>&1 | tee "$LOG_DIR/stage2.log"

wait_for_container "zookeeper" \
  "$COMPOSE exec -T zookeeper bash -c 'echo srvr | nc localhost 2181 | grep -q Zookeeper'" \
  "Zookeeper"

$COMPOSE up -d kafka 2>&1 | tee -a "$LOG_DIR/stage2.log"

wait_for_container "kafka" \
  "$COMPOSE exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092" \
  "Kafka"

success "Stage 2 complete"

# ── Stage 3: Kafka topic init ─────────────────────────────────────────────────
banner "Stage 3 — Kafka Topic Initialisation (32 topics)"

$COMPOSE up --no-recreate kafka-init 2>&1 | tee "$LOG_DIR/stage3.log" || \
  warn "kafka-init may have already run (topics exist)"

success "Stage 3 complete"

# ── Stage 4: Identity & Access (Keycloak, Permify) ───────────────────────────
banner "Stage 4 — Identity & Access (Keycloak, Permify)"

$COMPOSE up -d keycloak permify 2>&1 | tee "$LOG_DIR/stage4.log"

wait_for_container "keycloak" \
  "curl -sf http://localhost:8080/health/ready | grep -q UP" \
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
  "Temporal gRPC"

$COMPOSE up --no-recreate temporal-init 2>&1 | tee -a "$LOG_DIR/stage5.log" || \
  warn "temporal-init may have already run (namespace exists)"

$COMPOSE up -d temporal-ui 2>&1 | tee -a "$LOG_DIR/stage5.log"

success "Stage 5 complete"

# ── Core-only exit point ──────────────────────────────────────────────────────
if $CORE_ONLY; then
  banner "Core-only mode — infrastructure ready"
  $COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    $COMPOSE ps 2>/dev/null

  if $WAIT; then
    wait_for_all_healthy "$HEALTH_POLL_INTERVAL"
  fi

  echo ""
  success "BIS core infrastructure is operational"
  echo ""
  echo -e "  ${CYAN}PostgreSQL${RESET}  → localhost:5432  (bis / bis_dev_password / bis)"
  echo -e "  ${CYAN}Redis${RESET}       → localhost:6379"
  echo -e "  ${CYAN}Kafka${RESET}       → localhost:9092  (external: 9093)"
  echo -e "  ${CYAN}Keycloak${RESET}    → http://localhost:8080  (admin / admin_dev_password)"
  echo -e "  ${CYAN}Permify${RESET}     → localhost:3476"
  echo -e "  ${CYAN}Temporal${RESET}    → localhost:7233  (UI: http://localhost:8088)"
  echo ""
  echo -e "  Logs: ${LOG_DIR}/"
  echo ""
  exit 0
fi

# ── Stage 6: Observability ────────────────────────────────────────────────────
banner "Stage 6 — Observability (Prometheus, Grafana)"

$COMPOSE up -d prometheus grafana 2>&1 | tee "$LOG_DIR/stage6.log"

wait_for_container "prometheus" \
  "curl -sf http://localhost:9090/-/healthy" \
  "Prometheus"

success "Stage 6 complete"

# ── Stage 7: Search & Analytics (OpenSearch) ──────────────────────────────────
banner "Stage 7 — Search & Analytics (OpenSearch)"

$COMPOSE up -d opensearch 2>&1 | tee "$LOG_DIR/stage7.log"

wait_for_container "opensearch" \
  "curl -sf http://localhost:9200/_cluster/health | grep -E '\"status\":\"(green|yellow)\"'" \
  "OpenSearch"

$COMPOSE up --no-recreate opensearch-init 2>&1 | tee -a "$LOG_DIR/stage7.log" || \
  warn "opensearch-init may have already run"

$COMPOSE up -d opensearch-dashboards 2>&1 | tee -a "$LOG_DIR/stage7.log"

success "Stage 7 complete"

# ── Stage 8: API Gateway & Security (APISix) ─────────────────────────────────
banner "Stage 8 — API Gateway (APISix)"

$COMPOSE up -d apisix 2>&1 | tee "$LOG_DIR/stage8.log"

wait_for_container "apisix" \
  "curl -sf http://localhost:9080/health" \
  "APISix"

success "Stage 8 complete"

# ── Stage 9: Ledger (TigerBeetle) ────────────────────────────────────────────
banner "Stage 9 — Ledger (TigerBeetle)"

$COMPOSE up --no-recreate tigerbeetle-init 2>&1 | tee "$LOG_DIR/stage9.log" || \
  warn "tigerbeetle-init may have already run (data file exists)"

$COMPOSE up -d tigerbeetle tigerbeetle-http 2>&1 | tee -a "$LOG_DIR/stage9.log"

wait_for_container "tigerbeetle-http" \
  "curl -sf http://localhost:4000/health" \
  "TigerBeetle HTTP"

success "Stage 9 complete"

# ── Stage 10: Application services ───────────────────────────────────────────
banner "Stage 10 — Application Services"

$COMPOSE up -d \
  gateway risk-engine event-processor biometric-engine bff \
  ml-enrichment aml-engine \
  opensearch-indexer fluvio-velocity 2>&1 | tee "$LOG_DIR/stage10.log"

wait_for_container "gateway" \
  "curl -sf http://localhost:8081/health" \
  "Go API Gateway"

wait_for_container "bff" \
  "curl -sf http://localhost:3001/api/health" \
  "Node.js BFF"

success "Stage 10 complete"

# ── Final status ──────────────────────────────────────────────────────────────
banner "Infrastructure Status"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
  $COMPOSE ps 2>/dev/null

# Optional: block until all services report healthy (--wait flag)
if $WAIT; then
  wait_for_all_healthy "$HEALTH_POLL_INTERVAL"
fi

echo ""
success "BIS infrastructure is fully operational"
echo ""
echo -e "  ${CYAN}PostgreSQL${RESET}            → localhost:5432"
echo -e "  ${CYAN}Redis${RESET}                 → localhost:6379"
echo -e "  ${CYAN}Kafka${RESET}                 → localhost:9092"
echo -e "  ${CYAN}Keycloak${RESET}              → http://localhost:8080"
echo -e "  ${CYAN}Permify${RESET}               → localhost:3476"
echo -e "  ${CYAN}Temporal${RESET}              → localhost:7233 (UI: http://localhost:8088)"
echo -e "  ${CYAN}Prometheus${RESET}            → http://localhost:9090"
echo -e "  ${CYAN}Grafana${RESET}               → http://localhost:3000"
echo -e "  ${CYAN}OpenSearch${RESET}            → http://localhost:9200"
echo -e "  ${CYAN}OpenSearch Dashboards${RESET} → http://localhost:5601"
echo -e "  ${CYAN}APISix${RESET}                → http://localhost:9080"
echo -e "  ${CYAN}TigerBeetle HTTP${RESET}      → http://localhost:4000"
echo -e "  ${CYAN}Go API Gateway${RESET}        → http://localhost:8081"
echo -e "  ${CYAN}Node.js BFF${RESET}           → http://localhost:3001"
echo ""
echo -e "  Logs: ${LOG_DIR}/"
echo ""

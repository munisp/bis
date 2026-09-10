#!/usr/bin/env bash
# Runs only in an isolated Docker Compose environment. It requires an explicit
# acknowledgement and does not target arbitrary hosts or production networks.
set -euo pipefail

if [[ "${BIS_CHAOS_ALLOW:-}" != "I_ACKNOWLEDGE_ISOLATED_ENVIRONMENT" ]]; then
  echo "Refusing chaos test: set BIS_CHAOS_ALLOW=I_ACKNOWLEDGE_ISOLATED_ENVIRONMENT" >&2
  exit 64
fi
: "${BIS_CHAOS_LEDGER_CONTAINER:?required}"
: "${BIS_CHAOS_POSTGRES_CONTAINER:?required}"
: "${BIS_CHAOS_NETWORK:?required}"
: "${BIS_CHAOS_LEDGER_URL:?required}"
: "${BIS_LEDGER_KEY:?required}"
: "${BIS_LEDGER_KEY_ID:?required}"
: "${BIS_CHAOS_TENANT_ID:?required}"
: "${BIS_CHAOS_ACTOR_ID:?required}"

case "${BIS_CHAOS_LEDGER_URL}" in
  http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*) ;;
  *) echo "Refusing non-loopback ledger URL" >&2; exit 64 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
signer="${repo_root}/scripts/chaos/ledger-request-signing-integration.mjs"
cleanup() {
  docker network connect "${BIS_CHAOS_NETWORK}" "${BIS_CHAOS_POSTGRES_CONTAINER}" 2>/dev/null || true
}
trap cleanup EXIT

# Baseline proves the fixture can reach the ledger before partition injection.
node "$signer" baseline

# Break only ledger-to-PostgreSQL reachability in the isolated network. A ledger
# request with a fresh valid signature must receive 503 before any handler runs.
docker network disconnect "${BIS_CHAOS_NETWORK}" "${BIS_CHAOS_POSTGRES_CONTAINER}"
node "$signer" expect-replay-store-unavailable

# Restore PostgreSQL, then prove that a previously accepted nonce is rejected.
docker network connect "${BIS_CHAOS_NETWORK}" "${BIS_CHAOS_POSTGRES_CONTAINER}"
node "$signer" expect-replay-conflict

echo "PASS: replay protection blocked the partitioned request and preserved nonce uniqueness"

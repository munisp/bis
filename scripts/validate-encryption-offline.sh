#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${BIS_ENCRYPTION_VALIDATION_OUT:-/tmp/bis-encryption-validation}"
DB_NAME="bis_encryption_validation"
DB_ROLE="bis_encryption_validation"
# The harness always creates a fresh, hexadecimal-only local credential; no inherited secret is reused.
DB_PASSWORD="$(od -An -N 24 -tx1 /dev/urandom | tr -d '[:space:]')"
DB_URL="postgresql://${DB_ROLE}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
mkdir -p "$OUT"

run() {
  local name="$1"; shift
  printf '== %s ==\n' "$name" | tee "$OUT/$name.log"
  if "$@" >> "$OUT/$name.log" 2>&1; then
    printf 'PASS\t%s\n' "$name" | tee -a "$OUT/summary.tsv"
  else
    printf 'FAIL\t%s\n' "$name" | tee -a "$OUT/summary.tsv"
  fi
}
: > "$OUT/summary.tsv"

sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DB_NAME};" > "$OUT/postgres-setup.log" 2>&1
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS ${DB_ROLE};" >> "$OUT/postgres-setup.log" 2>&1
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${DB_PASSWORD}';" >> "$OUT/postgres-setup.log" 2>&1
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_ROLE};" >> "$OUT/postgres-setup.log" 2>&1
export DATABASE_URL="$DB_URL"
export BIS_DATABASE_URL="$DB_URL"
export PGPASSWORD="$DB_PASSWORD"
export BIS_PLATFORM_ENV="test"
export BIS_OUTBOX_KEYRING="v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=,v2:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
export BIS_OUTBOX_ACTIVE_KEY_VERSION="v2"
export BIS_ARCHIVE_S3_KMS_KEY_ID="alias/bis-archive-test"

cd "$ROOT"
run postgres_connection node scripts/assert-postgres-connection.mjs
run postgres_migration pnpm db:migrate
run compliance_workflow_integrity node scripts/test-0015-compliance-triggers.mjs
run pii_transit_rotation_forensics_integrity node scripts/test-0016-pii-transit-triggers.mjs
run pii_tenant_rls_and_dispatch_integrity node scripts/test-0017-pii-rls.mjs
run pii_rotation_dispatch_dead_letter_integrity node scripts/test-0018-pii-dispatch-dead-letter.mjs
run pii_forensic_keyset_pagination_explain node scripts/test-0020-pii-forensic-keyset-explain.mjs
run node_tests pnpm test
run typescript pnpm check
run pwa_build pnpm build
run gateway_race bash -lc 'cd services/gateway && go test -race ./...'
run archive_worker bash -lc 'cd services/cold-archive-writer && go vet ./... && go test -race ./...'
run mobile_typecheck bash -lc 'cd mobile && pnpm type-check'

printf '\nSummary:\n'
cat "$OUT/summary.tsv"
if grep -q '^FAIL' "$OUT/summary.tsv"; then exit 1; fi

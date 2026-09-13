#!/usr/bin/env bash
# Runs all locally available BIS validation suites. It performs no remote provider,
# settlement, object-storage, or staging action.
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${BIS_INTEGRATION_OUT:-/home/ubuntu/bis-evidence/full-local-integration}"
DB_URL="${DATABASE_URL:-postgresql://bis_user:bis_archive_local_test_2026@127.0.0.1:5432/bis_db}"
mkdir -p "$OUT/go" "$OUT/rust" "$OUT/python"

status=0
run() {
  local name="$1"; shift
  printf '\n== %s ==\n' "$name" | tee "$OUT/summary.log"
  if "$@" >"$OUT/${name}.log" 2>&1; then
    printf 'PASS %s\n' "$name" | tee -a "$OUT/summary.log"
  else
    printf 'FAIL %s\n' "$name" | tee -a "$OUT/summary.log"
    status=1
  fi
}

cd "$ROOT"
: > "$OUT/summary.log"
run "typescript-check" env DATABASE_URL="$DB_URL" BIS_DATABASE_URL="$DB_URL" pnpm check
run "node-tests" env DATABASE_URL="$DB_URL" BIS_DATABASE_URL="$DB_URL" pnpm test
run "node-build" env DATABASE_URL="$DB_URL" BIS_DATABASE_URL="$DB_URL" pnpm build
run "postgres-migrations" env DATABASE_URL="$DB_URL" BIS_DATABASE_URL="$DB_URL" pnpm exec tsx scripts/migrate-postgres.ts

while IFS= read -r -d '' mod; do
  dir="$(dirname "$mod")"
  key="$(echo "$dir" | sed "s#^$ROOT/##; s#[^A-Za-z0-9]#_#g")"
  printf '\n== go:%s ==\n' "$dir" | tee -a "$OUT/summary.log"
  if (cd "$dir" && go test -race ./...) >"$OUT/go/${key}.log" 2>&1; then
    printf 'PASS go:%s\n' "$dir" | tee -a "$OUT/summary.log"
  else
    printf 'FAIL go:%s\n' "$dir" | tee -a "$OUT/summary.log"
    status=1
  fi
done < <(find "$ROOT/services" -name go.mod -print0 | sort -z)

while IFS= read -r -d '' manifest; do
  dir="$(dirname "$manifest")"
  key="$(echo "$dir" | sed "s#^$ROOT/##; s#[^A-Za-z0-9]#_#g")"
  printf '\n== rust:%s ==\n' "$dir" | tee -a "$OUT/summary.log"
  if (cd "$dir" && cargo test) >"$OUT/rust/${key}.log" 2>&1; then
    printf 'PASS rust:%s\n' "$dir" | tee -a "$OUT/summary.log"
  else
    printf 'FAIL rust:%s\n' "$dir" | tee -a "$OUT/summary.log"
    status=1
  fi
done < <(find "$ROOT/services" -name Cargo.toml -print0 | sort -z)

while IFS= read -r -d '' test_file; do
  dir="$(dirname "$test_file")"
  case "$dir" in
    */tests) dir="$(dirname "$dir")" ;;
  esac
  service="$(echo "$dir" | sed "s#^$ROOT/##; s#[^A-Za-z0-9]#_#g")"
  log="$OUT/python/${service}.log"
  if [[ -f "$log" ]]; then continue; fi
  printf '\n== python:%s ==\n' "$dir" | tee -a "$OUT/summary.log"
  if (cd "$dir" && DATABASE_URL="$DB_URL" pytest -q) >"$log" 2>&1; then
    printf 'PASS python:%s\n' "$dir" | tee -a "$OUT/summary.log"
  else
    printf 'FAIL python:%s\n' "$dir" | tee -a "$OUT/summary.log"
    status=1
  fi
done < <(find "$ROOT/services" \( -name 'test_*.py' -o -name '*_test.py' \) -print0 | sort -z)

printf '\nFinal status: %d\n' "$status" | tee -a "$OUT/summary.log"
exit "$status"

#!/usr/bin/env bash
# Executes on a pre-provisioned staging or production deployment host. The host
# retains its secret env-file outside the repository; this script never accepts
# secret values over SSH or writes them to logs.
set -euo pipefail

required_env=(
  BIS_DEPLOY_ENV_FILE
  BIS_DEPLOY_ROOT
  BIS_PROMOTION_ENV
  BIS_RELEASE_SHA
)
for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    printf 'ERROR: %s is required\n' "$key" >&2
    exit 2
  fi
done

if [[ "$BIS_PROMOTION_ENV" != "staging" && "$BIS_PROMOTION_ENV" != "production" ]]; then
  printf 'ERROR: BIS_PROMOTION_ENV must be staging or production\n' >&2
  exit 2
fi
if [[ ! "$BIS_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'ERROR: BIS_RELEASE_SHA must be a 40-character lowercase Git SHA\n' >&2
  exit 2
fi
if [[ ! -r "$BIS_DEPLOY_ENV_FILE" ]]; then
  printf 'ERROR: deployment environment file is unreadable\n' >&2
  exit 2
fi
if [[ "$(basename "$BIS_DEPLOY_ENV_FILE")" != *.env ]]; then
  printf 'ERROR: deployment environment file must have an .env suffix\n' >&2
  exit 2
fi

release_dir="$(pwd -P)"
case "$release_dir" in
  "$BIS_DEPLOY_ROOT"/releases/"$BIS_RELEASE_SHA") ;;
  *) printf 'ERROR: promotion must run from the immutable checked-out release directory\n' >&2; exit 2 ;;
esac

for executable in docker gzip sha256sum; do
  command -v "$executable" >/dev/null 2>&1 || {
    printf 'ERROR: required executable %s is unavailable\n' "$executable" >&2
    exit 2
  }
done

deploy_env_name="$(basename "$BIS_DEPLOY_ENV_FILE")"
release_env="$release_dir/release.env"
[[ -r "$release_env" ]] || { printf 'ERROR: release.env is missing\n' >&2; exit 2; }

# The compose invocation reads secrets only from the host-controlled env file and
# images only from the release-specific digest file written by the CI workflow.
compose=(
  docker compose
  --project-name bis
  --env-file "$BIS_DEPLOY_ENV_FILE"
  --env-file "$release_env"
  -f "$release_dir/docker-compose.yml"
  -f "$release_dir/docker-compose.prod.yml"
  -f "$release_dir/docker-compose.release.yml"
)

validate_digest_reference() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$release_env" | cut -d= -f2- || true)"
  if [[ ! "$value" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
    printf 'ERROR: %s must be a lower-case GHCR SHA-256 digest reference\n' "$key" >&2
    exit 2
  fi
}
for key in BIS_BFF_IMAGE BIS_BFF_MIGRATIONS_IMAGE BIS_GATEWAY_IMAGE BIS_COLD_ARCHIVE_WRITER_IMAGE; do
  validate_digest_reference "$key"
done

# Verify the exact compose model before changing any production state. This
# catches missing mandatory encryption, archive, or database environment values.
"${compose[@]}" config --quiet

current_link="$BIS_DEPLOY_ROOT/current"
previous_release=""
if [[ -L "$current_link" ]]; then
  previous_release="$(readlink -f "$current_link")"
fi

rollback() {
  local reason="$1"
  printf 'ERROR: promotion failed: %s\n' "$reason" >&2
  if [[ -n "$previous_release" && -d "$previous_release" && "$previous_release" != "$release_dir" ]]; then
    printf 'Rolling back to the previous immutable release.\n' >&2
    ln -sfn "$previous_release" "$current_link"
    local previous_compose=(
      docker compose
      --project-name bis
      --env-file "$BIS_DEPLOY_ENV_FILE"
      --env-file "$previous_release/release.env"
      -f "$previous_release/docker-compose.yml"
      -f "$previous_release/docker-compose.prod.yml"
      -f "$previous_release/docker-compose.release.yml"
    )
    "${previous_compose[@]}" up -d --no-build --remove-orphans gateway bff prometheus || true
  fi
}
trap 'rollback "line ${LINENO}"' ERR

# Pull all release-pinned images before backup/migration, preventing a database
# change when the deployment artifact cannot be obtained.
"${compose[@]}" pull gateway bff bff-migrations cold-archive-writer

backup_dir="$BIS_DEPLOY_ROOT/backups/postgres"
mkdir -p "$backup_dir"
backup_file="$backup_dir/${BIS_PROMOTION_ENV}-${BIS_RELEASE_SHA}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
# pg_dump runs inside the existing private Postgres container so no database
# password is expanded into the shell. Keep a checksum beside every backup.
"${compose[@]}" exec -T postgres pg_dump -U bis -d bis --format=plain --no-owner --no-privileges | gzip -9 > "$backup_file"
test -s "$backup_file"
sha256sum "$backup_file" > "${backup_file}.sha256"

# The canonical migration runner enforces PostgreSQL-only URLs, checksums, and
# advisory locking. It cannot race with another promotion.
"${compose[@]}" --profile release run --rm --no-deps bff-migrations

# Apply only digest-pinned application images. Infrastructure and secrets remain
# host-managed; Docker is forbidden from building source on the deployment host.
"${compose[@]}" up -d --no-build --remove-orphans gateway bff prometheus

# Compose service health is required before edge health checks. The BFF endpoint
# verifies PostgreSQL and reports an explicit down state when database access is
# unavailable; a degraded optional integration does not mask a database failure.
for attempt in $(seq 1 30); do
  gateway_health="$("${compose[@]}" exec -T gateway wget -qO- http://localhost:8081/health || true)"
  bff_health="$("${compose[@]}" exec -T bff wget -qO- http://localhost:3000/api/health || true)"
  if [[ "$gateway_health" == *'"status":"ok"'* ]] && [[ "$bff_health" == *'"db":{"status":"ok"'* ]]; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    printf 'ERROR: gateway or BFF health verification did not converge\n' >&2
    exit 1
  fi
  sleep 10
done

ln -sfn "$release_dir" "$current_link"
# Keep the 10 most recent database backups. Every retained backup has a detached
# SHA-256 file created above; removal never touches the current backup.
find "$backup_dir" -type f -name '*.sql.gz' -printf '%T@ %p\n' | sort -nr | awk 'NR>10 {print $2}' | while IFS= read -r expired; do
  rm -f -- "$expired" "${expired}.sha256"
done

printf 'PASS: %s promotion deployed immutable release %s using %s\n' "$BIS_PROMOTION_ENV" "$BIS_RELEASE_SHA" "$deploy_env_name"

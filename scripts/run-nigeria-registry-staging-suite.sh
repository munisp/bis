#!/usr/bin/env bash
# Executes only against an explicitly approved non-production gateway and provider test subject.
# It never logs supplied identifiers, API keys, or responses containing identity attributes.
set -euo pipefail

required_env=(
  BIS_ENV
  BIS_STAGING_CONFIRMATION
  STAGING_GATEWAY_URL
  BIS_GATEWAY_KEY
  STAGING_TEST_SUBJECT_CONSENT
  STAGING_TEST_NIN
  STAGING_TEST_BVN
  STAGING_TEST_CAC_RC
)
for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    printf 'ERROR: %s is required for the staging Nigerian-registry suite\n' "$key" >&2
    exit 2
  fi
done

if [[ "${BIS_ENV}" != "staging" ]]; then
  printf 'ERROR: BIS_ENV must be staging; refusing registry calls\n' >&2
  exit 2
fi
if [[ "${BIS_STAGING_CONFIRMATION}" != "I_APPROVE_NON_PRODUCTION_REGISTRY_TESTS" ]]; then
  printf 'ERROR: explicit non-production registry-test confirmation is required\n' >&2
  exit 2
fi
if [[ "${STAGING_TEST_SUBJECT_CONSENT}" != "documented" ]]; then
  printf 'ERROR: use a provider-approved test subject with documented consent\n' >&2
  exit 2
fi
case "${STAGING_GATEWAY_URL}" in
  https://*) ;;
  *) printf 'ERROR: STAGING_GATEWAY_URL must use HTTPS\n' >&2; exit 2 ;;
esac
if [[ "${STAGING_GATEWAY_URL}" == *"production"* || "${STAGING_GATEWAY_URL}" == *"prod."* ]]; then
  printf 'ERROR: gateway URL appears to be production; refusing registry calls\n' >&2
  exit 2
fi

out_dir="${BIS_STAGING_REPORT_DIR:-./artifacts/nigeria-registry-staging}"
mkdir -p "$out_dir"
report="$out_dir/summary.txt"
: > "$report"
status=0

call() {
  local name="$1"
  local path="$2"
  local expected="$3"
  local code
  code="$(curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 45 \
    --output /dev/null --write-out '%{http_code}' \
    -H "X-BIS-Key: ${BIS_GATEWAY_KEY}" \
    -H 'Accept: application/json' \
    "${STAGING_GATEWAY_URL%/}${path}" 2>>"$out_dir/curl-errors.log")" || code="000"
  if [[ "$code" == "$expected" ]]; then
    printf 'PASS %s http=%s\n' "$name" "$code" | tee -a "$report"
  else
    printf 'FAIL %s expected_http=%s actual_http=%s\n' "$name" "$expected" "$code" | tee -a "$report" >&2
    status=1
  fi
}

call 'gateway-health' '/health' '200'
call 'nin-registry-test-subject' "/v1/nin/${STAGING_TEST_NIN}" '200'
call 'bvn-registry-test-subject' "/v1/bvn/${STAGING_TEST_BVN}" '200'
call 'cac-registry-test-subject' "/v1/cac/${STAGING_TEST_CAC_RC}" '200'

# Mandatory negative authorization checks: no identifier or identity response is persisted.
unauthorized="$(curl --silent --show-error --connect-timeout 10 --max-time 20 --output /dev/null --write-out '%{http_code}' "${STAGING_GATEWAY_URL%/}/v1/nin/${STAGING_TEST_NIN}" 2>>"$out_dir/curl-errors.log")" || unauthorized="000"
if [[ "$unauthorized" == '401' ]]; then
  printf 'PASS nin-without-gateway-key http=401\n' | tee -a "$report"
else
  printf 'FAIL nin-without-gateway-key expected_http=401 actual_http=%s\n' "$unauthorized" | tee -a "$report" >&2
  status=1
fi

printf 'Completed at %s UTC. Identifiers, bodies, and credentials were intentionally not logged.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$report"
exit "$status"

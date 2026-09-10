#!/usr/bin/env sh
set -eu

required() {
  eval "value=\${$1:-}"
  if [ -z "${value}" ]; then
    printf 'FAIL: %s is required\n' "$1" >&2
    exit 1
  fi
}

[ "${BIS_ENV:-}" = "staging" ] || { printf 'FAIL: BIS_ENV must be staging\n' >&2; exit 1; }
[ "${BIS_ONPREM_MINIO_BOOTSTRAP_CONFIRMATION:-}" = "I_APPROVE_SYNTHETIC_STAGING_BUCKET_BOOTSTRAP" ] || {
  printf 'FAIL: explicit synthetic staging bucket bootstrap confirmation is required\n' >&2
  exit 1
}
required MINIO_ENDPOINT
required MINIO_ROOT_USER
required MINIO_ROOT_PASSWORD
required BIS_EVIDENCE_S3_BUCKET
required BIS_EVIDENCE_S3_KMS_KEY_ID
required MINIO_SYNTHETIC_RETENTION_DAYS

case "${MINIO_ENDPOINT}" in https://*) ;; *) printf 'FAIL: MINIO_ENDPOINT must use HTTPS\n' >&2; exit 1;; esac
case "${BIS_EVIDENCE_S3_BUCKET}" in *production*|*prod*) printf 'FAIL: synthetic bootstrap refuses a production-named bucket\n' >&2; exit 1;; esac
case "${MINIO_SYNTHETIC_RETENTION_DAYS}" in ''|*[!0-9]*|0) printf 'FAIL: retention days must be a positive integer\n' >&2; exit 1;; esac

attempt=1
while ! mc alias set bis-onprem "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" --api S3v4; do
  if [ "${attempt}" -ge 40 ]; then
    printf 'FAIL: MinIO HTTPS endpoint did not become ready within 120 seconds\n' >&2
    exit 1
  fi
  printf 'Waiting for MinIO HTTPS endpoint (%s/40)...\n' "${attempt}" >&2
  attempt=$((attempt + 1))
  sleep 3
done

mc mb --ignore-existing "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc version enable "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc encrypt set sse-kms "${BIS_EVIDENCE_S3_KMS_KEY_ID}" "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc anonymous set none "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc ilm rule add --expire-days "${MINIO_SYNTHETIC_RETENTION_DAYS}" --prefix "kyc/" "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc ilm rule add --expire-days "${MINIO_SYNTHETIC_RETENTION_DAYS}" --prefix "consumer-disputes/" "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"
mc ilm rule add --expire-days "${MINIO_SYNTHETIC_RETENTION_DAYS}" --prefix "field-evidence/" "bis-onprem/${BIS_EVIDENCE_S3_BUCKET}"

printf 'PASS: synthetic-only staging evidence bucket is versioned, private, SSE-KMS-defaulted, and lifecycle limited\n'

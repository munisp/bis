#!/usr/bin/env bash
# ollama-entrypoint.sh
# Starts the Ollama server and pulls configured models on first boot.
# Used as the Docker ENTRYPOINT for the ollama service.
#
# Environment variables:
#   OLLAMA_MODELS   — comma-separated list of models to pull (default: llama3.2,nomic-embed-text)
#   OLLAMA_HOST     — bind address (default: 0.0.0.0:11434)
#   SKIP_PULL       — set to "true" to skip model pulling (useful in CI)

set -euo pipefail

OLLAMA_MODELS="${OLLAMA_MODELS:-llama3.2,nomic-embed-text}"
OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"
SKIP_PULL="${SKIP_PULL:-false}"
MARKER_FILE="/root/.ollama/.models_pulled"

log() { echo "[ollama-entrypoint] $*"; }

# ── Start the Ollama server in the background ─────────────────────────────────
log "Starting Ollama server on ${OLLAMA_HOST} ..."
OLLAMA_HOST="${OLLAMA_HOST}" ollama serve &
SERVER_PID=$!

# ── Wait for the server to become ready ──────────────────────────────────────
log "Waiting for Ollama server to be ready ..."
MAX_WAIT=60
WAITED=0
until curl -sf "http://localhost:11434/api/tags" > /dev/null 2>&1; do
  if [ "${WAITED}" -ge "${MAX_WAIT}" ]; then
    log "ERROR: Ollama server did not start within ${MAX_WAIT}s. Exiting."
    kill "${SERVER_PID}" 2>/dev/null || true
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
log "Ollama server is ready."

# ── Pull models (skip if already pulled or SKIP_PULL=true) ───────────────────
if [ "${SKIP_PULL}" = "true" ]; then
  log "SKIP_PULL=true — skipping model pull."
elif [ -f "${MARKER_FILE}" ]; then
  log "Models already pulled (marker file found). Skipping."
else
  log "Pulling models: ${OLLAMA_MODELS}"
  IFS=',' read -ra MODEL_LIST <<< "${OLLAMA_MODELS}"
  FAILED=()
  for MODEL in "${MODEL_LIST[@]}"; do
    MODEL="$(echo "${MODEL}" | xargs)"  # trim whitespace
    log "  Pulling ${MODEL} ..."
    if ollama pull "${MODEL}"; then
      log "  ✓ ${MODEL} pulled successfully."
    else
      log "  ✗ Failed to pull ${MODEL} — will retry on next startup."
      FAILED+=("${MODEL}")
    fi
  done

  if [ "${#FAILED[@]}" -eq 0 ]; then
    # Only write marker if all models pulled successfully
    mkdir -p "$(dirname "${MARKER_FILE}")"
    echo "Pulled at $(date -u +%Y-%m-%dT%H:%M:%SZ): ${OLLAMA_MODELS}" > "${MARKER_FILE}"
    log "All models pulled. Marker file written."
  else
    log "WARNING: Some models failed to pull: ${FAILED[*]}"
    log "They will be retried on the next container restart."
  fi
fi

# ── Hand off to the Ollama server process ────────────────────────────────────
log "Handing off to Ollama server (PID ${SERVER_PID}) ..."
wait "${SERVER_PID}"

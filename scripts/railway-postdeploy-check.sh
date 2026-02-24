#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WORKER_URL="${WORKER_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
CURL_TIMEOUT_SEC="${CURL_TIMEOUT_SEC:-12}"

if [[ -z "$API_URL" ]]; then
  echo "Error: API_URL is required (example: https://opencawt-production.up.railway.app)" >&2
  exit 1
fi

API_URL="${API_URL%/}"
if [[ -n "$WORKER_URL" ]]; then
  WORKER_URL="${WORKER_URL%/}"
fi

curl_json() {
  local url="$1"
  local extra_header="${2:-}"
  local args=("-sS" "--max-time" "$CURL_TIMEOUT_SEC")
  if [[ -n "$extra_header" ]]; then
    args+=("-H" "$extra_header")
  fi
  curl "${args[@]}" "$url"
}

echo "[postdeploy] API health"
curl_json "$API_URL/api/health" | jq -e '.ok == true' >/dev/null

echo "[postdeploy] API readiness"
curl_json "$API_URL/api/ready" | jq -e '.ok == true' >/dev/null

echo "[postdeploy] Schedule canary"
curl_json "$API_URL/api/schedule" | jq -e 'has("scheduled") and has("active")' >/dev/null

echo "[postdeploy] Decisions canary"
curl_json "$API_URL/api/decisions" | jq -e 'type == "array"' >/dev/null

if [[ -n "$WORKER_URL" ]]; then
  echo "[postdeploy] Worker liveness"
  curl_json "$WORKER_URL/api/health" | jq -e '.ok == true' >/dev/null
  if [[ -n "$WORKER_TOKEN" ]]; then
    echo "[postdeploy] Worker readiness"
    curl_json "$WORKER_URL/health" "X-Worker-Token: $WORKER_TOKEN" | jq -e '.ok == true' >/dev/null
  fi
fi

if [[ -n "$SYSTEM_API_KEY" ]]; then
  echo "[postdeploy] Internal credential status"
  curl_json "$API_URL/api/internal/credential-status" "X-System-Key: $SYSTEM_API_KEY" | jq -e '
    has("dbPath") and
    has("dbPathIsDurable") and
    has("resolvedCourtMode") and
    has("judgeAvailable") and
    has("workerReady")
  ' >/dev/null

  echo "[postdeploy] Storage durability"
  API_URL="$API_URL" SYSTEM_API_KEY="$SYSTEM_API_KEY" bash scripts/railway-verify-storage.sh >/dev/null
fi

echo "[postdeploy] OK"

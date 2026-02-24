#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WORKER_URL="${WORKER_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"
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

echo "[postdeploy] Schedule canary"
curl_json "$API_URL/api/schedule" | jq -e 'has("scheduled") and has("active")' >/dev/null

echo "[postdeploy] Decisions canary"
curl_json "$API_URL/api/decisions" | jq -e 'type == "array"' >/dev/null

if [[ -n "$WORKER_URL" ]]; then
  echo "[postdeploy] Worker health"
  curl_json "$WORKER_URL/health" | jq -e '.ok == true' >/dev/null
fi

if [[ -n "$SYSTEM_API_KEY" ]]; then
  echo "[postdeploy] Internal admin status"
  curl_json "$API_URL/api/internal/admin-status" "X-System-Key: $SYSTEM_API_KEY" | jq -e '
    has("queue") and has("clock")
  ' >/dev/null

  echo "[postdeploy] Internal credential status"
  curl_json "$API_URL/api/internal/credential-status" "X-System-Key: $SYSTEM_API_KEY" | jq -e '
    has("dbPath") and has("dbPathIsDurable")
  ' >/dev/null

  echo "[postdeploy] Storage durability"
  API_URL="$API_URL" SYSTEM_API_KEY="$SYSTEM_API_KEY" bash scripts/railway-verify-storage.sh >/dev/null
fi

echo "[postdeploy] OK"

#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WORKER_URL="${WORKER_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
CURL_TIMEOUT_SEC="${CURL_TIMEOUT_SEC:-12}"
CURL_RETRY_ATTEMPTS="${CURL_RETRY_ATTEMPTS:-4}"
CURL_RETRY_BASE_SEC="${CURL_RETRY_BASE_SEC:-2}"

if [[ -z "$API_URL" ]]; then
  echo "Error: API_URL is required (example: https://opencawt-production.up.railway.app)" >&2
  exit 1
fi

API_URL="${API_URL%/}"
if [[ -n "$WORKER_URL" ]]; then
  WORKER_URL="${WORKER_URL%/}"
fi

classify_curl_error() {
  local curl_rc="$1"
  case "$curl_rc" in
    6) echo "ENDPOINT_DNS_FAIL" ;;
    7|28) echo "ENDPOINT_TIMEOUT" ;;
    *) echo "ENDPOINT_NETWORK_FAIL" ;;
  esac
}

curl_json_once() {
  local url="$1"
  local extra_header="${2:-}"
  local args=("-sS" "--max-time" "$CURL_TIMEOUT_SEC")
  if [[ -n "$extra_header" ]]; then
    args+=("-H" "$extra_header")
  fi
  curl "${args[@]}" -w $'\n__HTTP_STATUS__:%{http_code}\n' "$url"
}

curl_json_retry() {
  local url="$1"
  local extra_header="${2:-}"
  local label="${3:-endpoint}"
  local last_rc=0
  local response_text=""
  local body=""
  local http_status=""
  for ((attempt=1; attempt<=CURL_RETRY_ATTEMPTS; attempt++)); do
    set +e
    response_text="$(curl_json_once "$url" "$extra_header" 2>&1)"
    last_rc=$?
    set -e
    if [[ $last_rc -eq 0 ]]; then
      http_status="$(printf "%s" "$response_text" | awk -F: '/__HTTP_STATUS__/{print $2}' | tail -n1 | tr -d '\r')"
      body="$(printf "%s" "$response_text" | sed '/__HTTP_STATUS__:/d')"
      if [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
        printf "%s\n" "$body"
        return 0
      fi
      if [[ "$http_status" =~ ^5[0-9][0-9]$ ]]; then
        echo "[postdeploy] ENDPOINT_5XX ${label} status=${http_status} attempt=${attempt}/${CURL_RETRY_ATTEMPTS}" >&2
      else
        echo "[postdeploy] ENDPOINT_HTTP_FAIL ${label} status=${http_status} attempt=${attempt}/${CURL_RETRY_ATTEMPTS}" >&2
      fi
      echo "$body" >&2
    else
      local reason
      reason="$(classify_curl_error "$last_rc")"
      echo "[postdeploy] ${reason} ${label} attempt=${attempt}/${CURL_RETRY_ATTEMPTS}" >&2
      echo "$response_text" >&2
    fi
    if [[ $attempt -lt CURL_RETRY_ATTEMPTS ]]; then
      sleep $((CURL_RETRY_BASE_SEC * attempt))
    fi
  done
  if [[ -n "$http_status" && "$http_status" =~ ^5[0-9][0-9]$ ]]; then
    echo "[postdeploy] ENDPOINT_5XX ${label} retries_exhausted=1 status=${http_status}" >&2
    return 1
  fi
  local final_reason
  final_reason="$(classify_curl_error "$last_rc")"
  echo "[postdeploy] ${final_reason} ${label} retries_exhausted=1" >&2
  return 1
}

echo "[postdeploy] API health"
curl_json_retry "$API_URL/api/health" "" "api_liveness" | jq -e '.ok == true' >/dev/null

echo "[postdeploy] API readiness"
if ! curl_json_retry "$API_URL/api/ready" "" "api_readiness" | jq -e '.ok == true' >/dev/null; then
  echo "[postdeploy] READY_FAIL_DEPENDENCY api_readiness" >&2
  exit 1
fi

echo "[postdeploy] Schedule canary"
curl_json_retry "$API_URL/api/schedule" "" "schedule_canary" | jq -e 'has("scheduled") and has("active")' >/dev/null

echo "[postdeploy] Decisions canary"
curl_json_retry "$API_URL/api/decisions" "" "decisions_canary" | jq -e 'type == "array"' >/dev/null

if [[ -n "$WORKER_URL" ]]; then
  echo "[postdeploy] Worker liveness"
  curl_json_retry "$WORKER_URL/api/health" "" "worker_liveness" | jq -e '.ok == true' >/dev/null
  if [[ -n "$WORKER_TOKEN" ]]; then
    echo "[postdeploy] Worker readiness"
    if ! curl_json_retry "$WORKER_URL/health" "X-Worker-Token: $WORKER_TOKEN" "worker_readiness" | jq -e '.ok == true' >/dev/null; then
      echo "[postdeploy] READY_FAIL_DEPENDENCY worker_readiness" >&2
      exit 1
    fi
  fi
fi

if [[ -n "$SYSTEM_API_KEY" ]]; then
  echo "[postdeploy] Internal credential status"
  curl_json_retry "$API_URL/api/internal/credential-status" "X-System-Key: $SYSTEM_API_KEY" "internal_credential_status" | jq -e '
    has("dbPath") and
    has("dbPathIsDurable") and
    has("resolvedCourtMode") and
    has("judgeAvailable") and
    has("workerReady") and
    has("lastExternalDnsFailureAtIso") and
    has("lastExternalTimeoutAtIso")
  ' >/dev/null

  echo "[postdeploy] Storage durability"
  API_URL="$API_URL" SYSTEM_API_KEY="$SYSTEM_API_KEY" bash scripts/railway-verify-storage.sh >/dev/null
fi

echo "[postdeploy] OK"

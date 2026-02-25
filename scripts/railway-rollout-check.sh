#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WORKER_URL="${WORKER_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
FALLBACK_REASON=""

if ! command -v railway >/dev/null 2>&1; then
  echo "Error: railway CLI is required for rollout checks." >&2
  exit 1
fi

if [[ -z "$API_URL" ]]; then
  echo "Error: API_URL is required." >&2
  exit 1
fi

preflight_output="$(API_URL="$API_URL" WORKER_URL="$WORKER_URL" bash scripts/network-preflight.sh 2>&1 || true)"
printf "%s\n" "$preflight_output"
if grep -q "RAILWAY_DNS_OK=0" <<<"$preflight_output"; then
  FALLBACK_REASON="LOCAL_RAILWAY_CLI_DNS_UNAVAILABLE_FALLBACK_ENDPOINT_ONLY"
  echo "[rollout] DNS_FAIL_LOCAL backboard.railway.com" >&2
fi

echo "[rollout] Railway deployment status"
status_json=""
if [[ -z "$FALLBACK_REASON" ]] && status_json="$(bash scripts/railway-cli-retry.sh status --json 2>/tmp/railway-status.err)"; then
  echo "$status_json" | jq -e '
    (.environments.edges | length) > 0
  ' >/dev/null

  bad_services="$(echo "$status_json" | jq -r '
    .environments.edges[0].node.serviceInstances.edges[]
    | select(.node.latestDeployment.status != "SUCCESS")
    | .node.serviceName + ":" + (.node.latestDeployment.status // "UNKNOWN")
  ')"

  if [[ -n "$bad_services" ]]; then
    echo "Error: some Railway services are not healthy deploys:" >&2
    echo "$bad_services" >&2
    exit 1
  fi
else
  FALLBACK_REASON="${FALLBACK_REASON:-LOCAL_RAILWAY_CLI_DNS_UNAVAILABLE_FALLBACK_ENDPOINT_ONLY}"
  echo "[rollout] warning: Railway status unavailable, falling back to endpoint-only checks" >&2
  cat /tmp/railway-status.err >&2 || true
fi

if [[ -n "$FALLBACK_REASON" ]]; then
  echo "[rollout] ${FALLBACK_REASON}" >&2
fi

echo "[rollout] Endpoint checks"
API_URL="$API_URL" WORKER_URL="$WORKER_URL" SYSTEM_API_KEY="$SYSTEM_API_KEY" WORKER_TOKEN="$WORKER_TOKEN" \
  bash scripts/railway-postdeploy-check.sh

echo "[rollout] Ready for promotion/hold decision"

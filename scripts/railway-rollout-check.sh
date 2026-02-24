#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WORKER_URL="${WORKER_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"

if ! command -v railway >/dev/null 2>&1; then
  echo "Error: railway CLI is required for rollout checks." >&2
  exit 1
fi

if [[ -z "$API_URL" ]]; then
  echo "Error: API_URL is required." >&2
  exit 1
fi

echo "[rollout] Railway deployment status"
status_json="$(railway status --json)"

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

echo "[rollout] Endpoint checks"
API_URL="$API_URL" WORKER_URL="$WORKER_URL" SYSTEM_API_KEY="$SYSTEM_API_KEY" \
  bash scripts/railway-postdeploy-check.sh

echo "[rollout] Ready for promotion/hold decision"

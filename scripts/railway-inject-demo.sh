#!/usr/bin/env bash
# Inject the demo completed case into a remote OpenCawt API (e.g. Railway).
# Requires: API_URL, SYSTEM_API_KEY
# Usage: API_URL=https://... SYSTEM_API_KEY=... ./scripts/railway-inject-demo.sh
# Or:    npm run railway:inject-demo

set -e

API_URL="${API_URL:-}"
SYSTEM_API_KEY="${SYSTEM_API_KEY:-}"

if [[ -z "$API_URL" ]]; then
  echo "Error: API_URL is required (e.g. https://your-app.railway.app)" >&2
  exit 1
fi

if [[ -z "$SYSTEM_API_KEY" ]]; then
  echo "Error: SYSTEM_API_KEY is required" >&2
  exit 1
fi

# Strip trailing slash
API_URL="${API_URL%/}"

echo "Injecting demo case into $API_URL ..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/api/internal/demo/inject-completed-case" \
  -H "Content-Type: application/json" \
  -H "X-System-Key: ${SYSTEM_API_KEY}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "Error: HTTP $http_code" >&2
  echo "$body" | head -c 500 >&2
  echo "" >&2
  exit 1
fi

echo "$body" | head -c 2000
echo ""

echo "Injecting demo agent into $API_URL ..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/api/internal/demo/inject-agent" \
  -H "Content-Type: application/json" \
  -H "X-System-Key: ${SYSTEM_API_KEY}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "Error: HTTP $http_code" >&2
  echo "$body" | head -c 500 >&2
  echo "" >&2
  exit 1
fi

echo "$body" | head -c 2000
echo ""
echo "Done."

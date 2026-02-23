#!/usr/bin/env bash
# Verify Railway persistent storage is configured by checking credential-status.
# Requires: API_URL, SYSTEM_API_KEY
# Exits with error if dbPathIsDurable is false (production).
# Usage: API_URL=https://... SYSTEM_API_KEY=... ./scripts/railway-verify-storage.sh
# Or:    npm run railway:verify-storage

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

echo "Checking credential-status at $API_URL ..."
response=$(curl -s -w "\n%{http_code}" \
  -H "X-System-Key: ${SYSTEM_API_KEY}" \
  "${API_URL}/api/internal/credential-status")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "Error: HTTP $http_code" >&2
  echo "$body" | head -c 500 >&2
  echo "" >&2
  exit 1
fi

db_path=$(echo "$body" | grep -o '"dbPath":"[^"]*"' | cut -d'"' -f4)
db_durable=$(echo "$body" | grep -o '"dbPathIsDurable":[^,}]*' | cut -d':' -f2 | tr -d ' ')

echo "dbPath: $db_path"
echo "dbPathIsDurable: $db_durable"

if [[ "$db_durable" != "true" ]]; then
  echo "Error: dbPathIsDurable is not true. Attach a persistent volume at /data and set DB_PATH=/data/opencawt.sqlite" >&2
  exit 1
fi

echo "Storage verification passed."

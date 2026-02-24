#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/railway-cli-retry.sh <railway ...args>" >&2
  exit 2
fi

attempts="${RAILWAY_CLI_RETRY_ATTEMPTS:-5}"
base_delay="${RAILWAY_CLI_RETRY_BASE_SEC:-2}"

last_error=""
for ((i=1; i<=attempts; i++)); do
  output="$(railway "$@" 2>&1)"
  rc=$?
  if [[ $rc -eq 0 ]] && ! grep -qi "Failed to fetch" <<<"$output"; then
    printf '%s\n' "$output"
    exit 0
  fi
  printf '%s\n' "$output" >&2
  last_error="railway command failed with exit $rc"
  if [[ $i -lt $attempts ]]; then
    sleep_for=$((base_delay * i))
    echo "[railway-cli-retry] attempt $i/$attempts failed, retrying in ${sleep_for}s..." >&2
    sleep "$sleep_for"
  fi
done

echo "[railway-cli-retry] exhausted retries: $last_error" >&2
exit 1

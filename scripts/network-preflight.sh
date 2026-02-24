#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

if [[ -n "${API_URL:-}" ]]; then
  echo "[network-preflight] checking API_URL reachability"
  curl -sS --max-time 8 "${API_URL%/}/api/health" | jq -e '.ok == true' >/dev/null
fi

echo "[network-preflight] checking Railway GraphQL DNS"
if ! curl -sS --max-time 8 https://backboard.railway.com >/dev/null; then
  echo "[network-preflight] warning: unable to resolve backboard.railway.com" >&2
  exit 2
fi

echo "[network-preflight] ok"

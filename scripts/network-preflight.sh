#!/usr/bin/env bash
set -euo pipefail

DNS_PREFLIGHT_RESOLVER_MODE="${DNS_PREFLIGHT_RESOLVER_MODE:-system}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

probe_system_http() {
  local url="$1"
  curl -sS --max-time 8 "$url" >/dev/null
}

probe_doh_name() {
  local host="$1"
  local response
  response="$(curl -sS --max-time 8 \
    -H "accept: application/dns-json" \
    "https://cloudflare-dns.com/dns-query?name=${host}&type=A")"
  echo "$response" | jq -e '.Answer | type == "array" and length > 0' >/dev/null
}

probe_url() {
  local url="$1"
  local host
  host="$(echo "$url" | sed -E 's#^https?://([^/:]+).*$#\1#')"
  if [[ "$DNS_PREFLIGHT_RESOLVER_MODE" == "doh" ]]; then
    probe_doh_name "$host"
  else
    probe_system_http "$url"
  fi
}

if [[ -n "${API_URL:-}" ]]; then
  echo "[network-preflight] checking API_URL reachability (${DNS_PREFLIGHT_RESOLVER_MODE})"
  if probe_url "${API_URL%/}/api/health"; then
    echo "API_DNS_OK=1"
  else
    echo "API_DNS_OK=0"
    echo "[network-preflight] warning: unable to resolve/reach API_URL" >&2
  fi
fi

if [[ -n "${WORKER_URL:-}" ]]; then
  echo "[network-preflight] checking WORKER_URL reachability (${DNS_PREFLIGHT_RESOLVER_MODE})"
  if probe_url "${WORKER_URL%/}/api/health"; then
    echo "WORKER_DNS_OK=1"
  else
    echo "WORKER_DNS_OK=0"
    echo "[network-preflight] warning: unable to resolve/reach WORKER_URL" >&2
  fi
fi

echo "[network-preflight] checking Railway GraphQL DNS (${DNS_PREFLIGHT_RESOLVER_MODE})"
if ! probe_url "https://backboard.railway.com"; then
  echo "RAILWAY_DNS_OK=0"
  echo "[network-preflight] warning: unable to resolve backboard.railway.com" >&2
else
  echo "RAILWAY_DNS_OK=1"
fi

echo "[network-preflight] ok"

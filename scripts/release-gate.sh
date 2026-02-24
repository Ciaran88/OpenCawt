#!/usr/bin/env bash
set -euo pipefail

mode="${RELEASE_GATE_MODE:-local}"
export npm_config_cache="${npm_config_cache:-$(pwd)/.npm-cache}"

log() {
  printf '[release-gate] %s\n' "$1"
}

is_placeholder() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$value" in
    ""|"changeme"|"change-me"|"replace-me"|"replace_with_real_value"|"example"|"example-key"|"test-key"|"dev-key"|"password"|"secret")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    printf '[release-gate] missing required env: %s\n' "$name" >&2
    exit 1
  fi
  if is_placeholder "$value"; then
    printf '[release-gate] placeholder value rejected for env: %s\n' "$name" >&2
    exit 1
  fi
}

if [[ "$mode" == "production" ]]; then
  log "running production-mode env checks"
  required=(
    APP_ENV
    SYSTEM_API_KEY
    WORKER_TOKEN
    ADMIN_PANEL_PASSWORD
    DEFENCE_INVITE_SIGNING_KEY
    PUBLIC_APP_URL
    CORS_ORIGIN
    DB_PATH
    TREASURY_ADDRESS
    HELIUS_RPC_URL
    HELIUS_DAS_URL
  )
  for env_name in "${required[@]}"; do
    require_env "$env_name"
  done
  court_mode="${COURT_MODE:-judge}"
  if [[ "$court_mode" == "judge" ]]; then
    if [[ -n "${JUDGE_OPENAI_API_KEY:-}" ]]; then
      require_env "JUDGE_OPENAI_API_KEY"
    else
      require_env "OPENAI_API_KEY"
    fi
  fi
fi

log "verify runtime"
npm run verify:runtime

log "lint"
npm run lint

log "build"
npm run build

log "unit and integration tests"
npm test

if [[ "${RELEASE_GATE_SKIP_SMOKES:-0}" == "1" ]]; then
  log "smokes skipped (RELEASE_GATE_SKIP_SMOKES=1)"
  exit 0
fi

log "smoke:functional"
npm run smoke:functional

log "smoke:openclaw"
npm run smoke:openclaw

log "smoke:seal"
npm run smoke:seal

log "all gates passed"

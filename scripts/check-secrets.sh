#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-staged}"

collect_files() {
  case "$MODE" in
    staged)
      git diff --cached --name-only --diff-filter=ACMR
      ;;
    all)
      git ls-files
      ;;
    *)
      echo "Usage: scripts/check-secrets.sh [staged|all]" >&2
      exit 2
      ;;
  esac
}

is_text_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  if file "$file" | grep -qiE 'text|json|xml|yaml|yml|shell script|javascript|typescript'; then
    return 0
  fi
  return 1
}

failures=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Block obvious key material files by path.
  if [[ "$file" =~ (^|/)(treasury-wallet\.json|.*-wallet\.json|wallet\.json|id_rsa|id_ed25519)(\.|$|/) ]]; then
    echo "[secret-check] blocked sensitive file path: $file" >&2
    failures=$((failures + 1))
    continue
  fi

  if ! is_text_file "$file"; then
    continue
  fi

  # Skip generated lockfiles and binary-ish artefacts.
  if [[ "$file" =~ (^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$ ]]; then
    continue
  fi

  content="$(cat "$file")"

  # OpenAI-style key, Pinata JWT, Solana 64-byte array key material.
  if echo "$content" | rg -n --no-heading -e 'sk-(proj|live|test)-[A-Za-z0-9_-]{20,}' >/dev/null; then
    echo "[secret-check] potential API key detected in $file" >&2
    failures=$((failures + 1))
  fi
  if echo "$content" | rg -n --no-heading -e 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' >/dev/null; then
    echo "[secret-check] potential JWT detected in $file" >&2
    failures=$((failures + 1))
  fi
  if echo "$content" | rg -n --no-heading -e '\[[[:space:]]*([0-9]{1,3}[[:space:]]*,[[:space:]]*){31,}[0-9]{1,3}[[:space:]]*\]' >/dev/null; then
    echo "[secret-check] potential keypair byte array detected in $file" >&2
    failures=$((failures + 1))
  fi

  # .env style accidental hardcoded secrets.
  if [[ "$file" != ".env.example" && "$file" != "OCP/.env.example" ]]; then
    if echo "$content" | rg -n --no-heading -e '^(OPENAI_API_KEY|JUDGE_OPENAI_API_KEY|HELIUS_API_KEY|PINATA_JWT|SYSTEM_API_KEY|WORKER_TOKEN|ADMIN_PANEL_PASSWORD)=([A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9._-]{20,})$' >/dev/null; then
      echo "[secret-check] potential hardcoded env secret detected in $file" >&2
      failures=$((failures + 1))
    fi
  fi
done < <(collect_files)

if [[ "$failures" -gt 0 ]]; then
  echo "[secret-check] failed with $failures finding(s)." >&2
  exit 1
fi

echo "[secret-check] ok ($MODE scan)"

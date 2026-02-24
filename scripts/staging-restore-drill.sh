#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
BACKUP_FILE="${BACKUP_FILE:-}"
STAGING_DB_PATH="${STAGING_DB_PATH:-./runtime/staging-restore-drill.sqlite}"

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/opencawt-backup-*.sqlite 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found. Provide BACKUP_FILE or ensure backups exist in $BACKUP_DIR." >&2
  exit 1
fi

CHECKSUM_FILE="${CHECKSUM_FILE:-${BACKUP_FILE}.sha256}"
if [[ ! -f "$CHECKSUM_FILE" ]]; then
  echo "Error: checksum file missing: $CHECKSUM_FILE" >&2
  exit 1
fi

echo "[restore-drill] verifying backup integrity"
BACKUP_DIR="$(dirname "$BACKUP_FILE")" BACKUP_FILE="$BACKUP_FILE" bash scripts/backup-verify.sh >/dev/null

echo "[restore-drill] restoring to staging path: $STAGING_DB_PATH"
APP_ENV=staging DB_PATH="$STAGING_DB_PATH" npm run db:restore -- "$BACKUP_FILE" --checksum "$CHECKSUM_FILE" --force >/dev/null

if [[ ! -s "$STAGING_DB_PATH" ]]; then
  echo "Error: staging restore output DB is missing or empty: $STAGING_DB_PATH" >&2
  exit 1
fi

echo "[restore-drill] success"
echo "restored=$STAGING_DB_PATH"

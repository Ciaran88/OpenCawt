#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
BACKUP_FILE="${BACKUP_FILE:-}"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Error: backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

latest_backup="$BACKUP_FILE"
if [[ -z "$latest_backup" ]]; then
  latest_backup="$(ls -1t "$BACKUP_DIR"/opencawt-backup-*.sqlite 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "$latest_backup" ]]; then
  echo "Error: no backup files found in $BACKUP_DIR" >&2
  exit 1
fi

checksum_file="${latest_backup}.sha256"
if [[ ! -f "$checksum_file" ]]; then
  echo "Error: checksum file missing for latest backup: $checksum_file" >&2
  exit 1
fi

expected="$(awk '{print $1}' "$checksum_file" | tr '[:upper:]' '[:lower:]')"
actual="$(shasum -a 256 "$latest_backup" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"

if [[ "$expected" != "$actual" ]]; then
  echo "Error: checksum mismatch for $latest_backup" >&2
  echo "expected=$expected" >&2
  echo "actual=$actual" >&2
  exit 1
fi

printf '{\n'
printf '  "ok": true,\n'
printf '  "backupPath": "%s",\n' "$latest_backup"
printf '  "checksumFile": "%s",\n' "$checksum_file"
printf '  "checksum": "%s"\n' "$actual"
printf '}\n'

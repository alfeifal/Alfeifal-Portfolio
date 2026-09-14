#!/usr/bin/env bash
# Database backup with pg_dump. Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT="${1:-backups}"
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/personal-os-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$FILE"
echo "Backup written to $FILE ($(du -h "$FILE" | cut -f1))"
# Keep the last 30 local backups
ls -1t "$OUT"/personal-os-*.dump 2>/dev/null | tail -n +31 | xargs -r rm -f
# Restore: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/personal-os-<stamp>.dump

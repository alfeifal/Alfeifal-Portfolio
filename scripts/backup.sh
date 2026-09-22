#!/usr/bin/env bash
# Database backup with pg_dump. Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
#
# The dump is written to a temporary file, checked, and only then moved into place. A shell
# redirect (`pg_dump ... > "$FILE"`) creates the file before pg_dump runs, so a dump that died
# halfway — a dropped connection, a full disk, a cancelled job — left a truncated file sitting
# there with a backup's name. This script only ever names a file that it has read back.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"

OUT="${1:-backups}"
# A dump of an empty database is around 1 kB of header and TOC, so anything under this never
# held data. Override for a deliberately tiny database.
MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"

mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/personal-os-$STAMP.dump"

TMP="$(mktemp "${TMPDIR:-/tmp}/personal-os-backup.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

# --file rather than a redirect, so pg_dump owns the file and a failure leaves nothing behind
# that could be mistaken for a backup.
pg_dump --format=custom --no-owner --no-privileges --file="$TMP" "$DATABASE_URL"

SIZE=$(wc -c < "$TMP")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "Backup is $SIZE bytes, under the $MIN_BYTES minimum: refusing to keep it" >&2
  exit 1
fi

# Integrity, appropriate to the format: read the archive's table of contents back out of it.
# A truncated or corrupt custom-format dump fails here, which is the whole point — a backup
# nobody has ever read is a guess, not a backup.
if ! pg_restore --list "$TMP" >/dev/null 2>&1; then
  echo "Backup failed its integrity check: pg_restore could not read the archive" >&2
  exit 1
fi

# Count the tables that actually carry data, so an empty or half-dumped database is visible in
# the log rather than passing as a healthy backup on size alone.
TABLES=$(pg_restore --list "$TMP" | grep -c 'TABLE DATA' || true)
if [ "$TABLES" -eq 0 ]; then
  echo "Backup contains no table data: refusing to keep it" >&2
  exit 1
fi

mv "$TMP" "$FILE"
echo "Backup written to $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables with data, integrity verified)"

# Keep the last 30 local backups
ls -1t "$OUT"/personal-os-*.dump 2>/dev/null | tail -n +31 | xargs -r rm -f
# Restore: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/personal-os-<stamp>.dump

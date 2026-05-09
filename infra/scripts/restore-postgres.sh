#!/usr/bin/env bash
#
# Восстановление Postgres БД z_main из шифрованного бэкапа в S3.
#
# Usage:
#   S3_KEY=postgres/2026/05/09/z-20260509-0300.sql.gz.enc \
#   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=z_main_restore \
#   BACKUP_KEY=... S3_ENDPOINT=... BACKUP_BUCKET=... \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#   ./restore-postgres.sh
#
# ВАЖНО:
#   - Восстановление НИКОГДА не идёт в production-БД напрямую.
#     Целевую БД создаём отдельно (DB_NAME=z_main_restore), проверяем,
#     потом — переключение через ALTER DATABASE / pg_restore --clean --create.
#   - Если БД ещё не существует — создаём заранее (`createdb`).
#
# См. инструкцию: docs/runbook/restore-from-backup.md.

set -euo pipefail

: "${S3_KEY:?S3_KEY не задан (например: postgres/2026/05/09/z-20260509-0300.sql.gz.enc)}"
: "${DB_HOST:?DB_HOST не задан}"
: "${DB_USER:?DB_USER не задан}"
: "${DB_PASSWORD:?DB_PASSWORD не задан}"
: "${DB_NAME:?DB_NAME не задан}"
: "${BACKUP_KEY:?BACKUP_KEY не задан}"
: "${S3_ENDPOINT:?S3_ENDPOINT не задан}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET не задан}"

TS="$(date +%Y%m%d-%H%M%S)"
ENCRYPTED="/tmp/restore-${TS}.sql.gz.enc"
DUMP_FILE="/tmp/restore-${TS}.sql.gz"

trap 'rm -f "${ENCRYPTED}" "${DUMP_FILE}"' EXIT

echo "[$(date -Iseconds)] restore-postgres: download s3://${BACKUP_BUCKET}/${S3_KEY}"
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "s3://${BACKUP_BUCKET}/${S3_KEY}" "${ENCRYPTED}"

echo "[$(date -Iseconds)] decrypt → ${DUMP_FILE}"
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "${ENCRYPTED}" \
  -out "${DUMP_FILE}" \
  -pass pass:"${BACKUP_KEY}"

echo "[$(date -Iseconds)] pg_restore → ${DB_NAME}"
PGPASSWORD="${DB_PASSWORD}" pg_restore \
  -h "${DB_HOST}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-owner \
  --no-acl \
  --jobs=4 \
  "${DUMP_FILE}"

echo "[$(date -Iseconds)] restore-postgres: OK"

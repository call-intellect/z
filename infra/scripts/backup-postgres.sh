#!/usr/bin/env bash
#
# Ежедневный бэкап Postgres БД z_main → S3 (Selectel db-backups bucket).
# Запускается из cron на vm-system-b каждый день в 03:00 (см. infra/cron/backup-postgres.cron).
#
# ENV (передаём через cron-shell или systemd-environment-file):
#   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME — учётка PG (read-only роль с pg_dump).
#   BACKUP_KEY                              — passphrase для AES-256-CBC.
#   S3_ENDPOINT, BACKUP_BUCKET              — например, https://s3.ru-7.storage.selcloud.ru / db-backups.
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — креды Selectel (signature-v4).
#
# Эффект:
#   - pg_dump --format=custom --compress=9 → /tmp/z-YYYYMMDD-HHMM.sql.gz
#   - openssl aes-256-cbc → +.enc
#   - aws s3 cp → s3://${BACKUP_BUCKET}/postgres/YYYY/MM/DD/...
#   - cleanup /tmp.
#
# Restore: см. `restore-postgres.sh` и `docs/runbook/restore-from-backup.md`.

set -euo pipefail

: "${DB_HOST:?DB_HOST не задан}"
: "${DB_USER:?DB_USER не задан}"
: "${DB_PASSWORD:?DB_PASSWORD не задан}"
: "${DB_NAME:?DB_NAME не задан}"
: "${BACKUP_KEY:?BACKUP_KEY не задан}"
: "${S3_ENDPOINT:?S3_ENDPOINT не задан}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET не задан}"

TS="$(date +%Y%m%d-%H%M)"
DATE_PATH="$(date +%Y/%m/%d)"
DUMP_FILE="/tmp/z-${TS}.sql.gz"
ENCRYPTED="${DUMP_FILE}.enc"

trap 'rm -f "${DUMP_FILE}" "${ENCRYPTED}"' EXIT

echo "[$(date -Iseconds)] backup-postgres: start (db=${DB_NAME}, host=${DB_HOST})"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --compress=9 \
  -f "${DUMP_FILE}"

DUMP_SIZE="$(stat -c '%s' "${DUMP_FILE}")"
echo "[$(date -Iseconds)] dump created: ${DUMP_FILE} (${DUMP_SIZE} bytes)"

openssl enc -aes-256-cbc -salt -pbkdf2 \
  -in "${DUMP_FILE}" \
  -out "${ENCRYPTED}" \
  -pass pass:"${BACKUP_KEY}"

S3_KEY="postgres/${DATE_PATH}/$(basename "${ENCRYPTED}")"
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${ENCRYPTED}" "s3://${BACKUP_BUCKET}/${S3_KEY}"

echo "[$(date -Iseconds)] backup-postgres: OK → s3://${BACKUP_BUCKET}/${S3_KEY}"

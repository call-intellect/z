# Runbook: восстановление Postgres из S3-бэкапа

## Когда применять

- БД повреждена (`pg_dump` падает, `pg_isready` возвращает ошибку, диск переполнен и т.п.).
- Нужно поднять копию prod-БД на staging для отладки.
- Точечно «откатить» данные на N часов назад.

## Предусловия

- Доступ по SSH на `vm-system-b` (там лежат `backup-postgres.sh` / `restore-postgres.sh`).
- Selectel S3 креды и `BACKUP_KEY` — в `/etc/z/backup.env` (mode 0600, owner z_app).
- Правильно сконфигурированный `aws` CLI с `--endpoint-url`.

## Шаги (test restore на staging)

```bash
ssh z_app@vm-system-b
source /etc/z/backup.env

# 1. Найти последний бэкап.
aws --endpoint-url $S3_ENDPOINT s3 ls s3://$BACKUP_BUCKET/postgres/ --recursive | tail -5

# 2. Создать целевую БД на staging-Postgres.
PGPASSWORD=$DB_PASSWORD psql -h staging-postgres -U postgres -c \
  "CREATE DATABASE z_main_restore_test OWNER z_app;"

# 3. Запустить восстановление.
S3_KEY=postgres/2026/05/09/z-20260509-0300.sql.gz.enc \
DB_HOST=staging-postgres \
DB_NAME=z_main_restore_test \
/usr/local/bin/restore-postgres.sh

# 4. Smoke check.
PGPASSWORD=$DB_PASSWORD psql -h staging-postgres -U z_app z_main_restore_test \
  -c "SELECT count(*) FROM \"User\";"
```

## Шаги (prod restore — БД полностью потеряна)

> ВНИМАНИЕ: эта процедура — крайний случай. Перед её запуском убедиться,
> что нет шанса восстановить БД иначе (replicaset, WAL, и т.п.).

```bash
# 1. Остановить backend (он не должен писать в новую БД, пока она не готова).
ssh root@vm-backend systemctl stop z-backend z-workers

# 2. На vm-postgres — переименовать старую БД (если она ещё доступна).
PGPASSWORD=$PG_ADMIN_PASS psql -h prod-postgres -U postgres -c \
  "ALTER DATABASE z_main RENAME TO z_main_broken_$(date +%s);"
PGPASSWORD=$PG_ADMIN_PASS psql -h prod-postgres -U postgres -c \
  "CREATE DATABASE z_main OWNER z_app;"

# 3. Восстановление.
S3_KEY=<последний-бэкап> \
DB_HOST=prod-postgres DB_NAME=z_main \
/usr/local/bin/restore-postgres.sh

# 4. Запустить backend.
ssh root@vm-backend systemctl start z-backend z-workers

# 5. Smoke test.
curl https://z.crossmark.ru/health/ready
```

## Проверка целостности после восстановления

```sql
-- Контрольные count'ы (сверить с метриками за последние сутки).
SELECT count(*) FROM "Meeting";
SELECT count(*) FROM "User";
SELECT count(*) FROM "IntegrationKey" WHERE "revokedAt" IS NULL;

-- Самая свежая встреча — её id и created_at должны быть свежими.
SELECT id, "createdAt" FROM "Meeting" ORDER BY "createdAt" DESC LIMIT 1;
```

Расхождение в количестве встреч больше 1 часа — нормально (бэкап не realtime).
Если есть транзакции, которые НЕ должны были потеряться — поднимать вопрос
о PITR/WAL-archiving (V1.1).

## Что делать после

- Записать инцидент в `second-brain/05_история/`.
- Обновить `second-brain/02_architecture/code-pitfalls.md` если выяснился
  системный пробел в backups.

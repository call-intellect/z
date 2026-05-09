# infra/scripts — операционные скрипты

Скрипты для прода. Все принимают параметры через ENV (нет позиционных argv —
проще пробрасывать из cron / systemd).

## Состав

| Скрипт                        | Назначение                                                                  |
|-------------------------------|-----------------------------------------------------------------------------|
| `backup-postgres.sh`          | Дамп `z_main` → AES-256-CBC → S3 (Selectel, bucket `db-backups`).           |
| `restore-postgres.sh`         | Скачать + расшифровать + `pg_restore` в указанную БД.                       |

## Развёртывание

```bash
sudo install -m 0755 backup-postgres.sh /usr/local/bin/backup-postgres.sh
sudo install -m 0755 restore-postgres.sh /usr/local/bin/restore-postgres.sh
sudo install -m 0644 ../cron/backup-postgres.cron /etc/cron.d/z-backup-postgres
sudo mkdir -p /var/log/z
sudo chown z_app:z_app /var/log/z
```

ENV-файл (`/etc/z/backup.env`, mode 0600, owner z_app):

```bash
export DB_HOST=postgres.crossmark.ru
export DB_USER=z_backup
export DB_PASSWORD=...
export DB_NAME=z_main
export BACKUP_KEY='...32+ случайных байт...'
export S3_ENDPOINT=https://s3.ru-7.storage.selcloud.ru
export BACKUP_BUCKET=z-db-backups
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

## Retention

14 дней — управляется политикой бакета (`infra/selectel/lifecycle-policy.json`).

## Тест восстановления

Раз в неделю на staging выполнить:

```bash
S3_KEY=$(aws --endpoint-url $S3_ENDPOINT s3 ls s3://$BACKUP_BUCKET/postgres/ --recursive | tail -1 | awk '{print $4}')
DB_NAME=z_main_restore_test ./restore-postgres.sh
```

После этого — `psql z_main_restore_test -c "SELECT count(*) FROM \"User\";"` для smoke-проверки.

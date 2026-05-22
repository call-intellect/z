# Runbook: Backup

## Что бэкапим

| Компонент | Как | Частота | Ретеншн |
|---|---|---|---|
| PostgreSQL | WAL archiving + pg_basebackup | Continuous + 1×/день | 30 ежедн + 12 мес + 5 лет |
| FalkorDB | RDB snapshot + AOF + Restic | Каждый час | 7 дней + 4 недели |
| MinIO | Mirror replication + Restic | Continuous + 1×/день | 30 дней |
| OpenBao | Snapshot | 1×/день | 30 дней |
| Конфигурация | git push в backup-repo | При изменении | бессрочно |

## Запуск ручного backup

```bash
cd /opt/secondbrain
sudo ./scripts/backup.sh --all
```

Параметры:
- `--all` — всё.
- `--postgres` — только БД.
- `--minio` — только объекты.
- `--falkordb` — только граф.

## Проверка

```bash
./scripts/list-backups.sh

# Пример вывода:
# postgres-base  2026-05-10 03:00  size: 12 GB
# postgres-wal   2026-05-10 12:00  size: 100 MB
# falkordb       2026-05-10 12:00  size: 500 MB
# minio          2026-05-10 03:00  size: 25 GB
```

## Verification

Раз в неделю (через cron):

```bash
./scripts/verify-backup.sh latest
```

Скрипт:
1. Скачивает последний backup в /tmp.
2. Восстанавливает на тестовый стенд (отдельный compose `test-restore.yml`).
3. Проверяет integrity (`pg_dump --schema-only` сравнение).
4. Если всё ОК — алерт «Backup OK», иначе — SEV-2.

## Encryption

Все backups шифруются Restic-ом своим ключом. Ключ хранится в OpenBao как `secret/backup/restic-key`.

Доступ к ключу — только у админа + у сервиса бэкапов.

## Off-site backup

Для production обязательно — repository в другом дата-центре:

```bash
restic init --repo s3:https://backup.example.ru/secondbrain-${TENANT_ID}
```

Альтернативы:
- Yandex.Cloud Object Storage (s3-compat).
- VK Cloud / Cloud.ru / Selectol Object Storage.

## Disaster Recovery drill

Раз в квартал — полное восстановление на отдельный сервер:

```bash
./scripts/dr-drill.sh \
    --target-host=dr-server.example.ru \
    --target-time="2026-05-09 12:00:00 UTC"
```

Скрипт:
1. Развернёт пустой стек на dr-server.
2. Восстановит PostgreSQL до точки T.
3. Восстановит FalkorDB до точки T (через time-travel запрос).
4. Восстановит MinIO.
5. Запустит smoke tests.
6. Сравнит чексумм 100 случайных raw_events с источником.
7. Сообщит результат.

После drill — dr-server можно остановить (но не удалять — пригодится для следующего drill).

## Что если backup не прошёл

Алерты Alertmanager → Telegram админа.

Diagnosis:
```bash
docker compose logs backup-service --tail 200
```

Fix:
- Disk full → освободить + перезапустить.
- Repository unreachable → проверить network.
- Wrong credentials → обновить через OpenBao.

Если backup не работает 24+ часов — SEV-1.

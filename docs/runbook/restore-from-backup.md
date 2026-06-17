# Runbook: восстановление Postgres из бэкапа

## Когда применять

- БД повреждена (`pg_dump` падает, `pg_isready` возвращает ошибку, диск переполнен и т.п.).
- Нужно поднять копию prod-БД на staging для отладки.
- Точечно «откатить» данные на N часов назад.
- Откатить неудачную миграцию схемы (для этого есть отдельный авто-бэкап, см. ниже).

## Топология

Прод Z целиком в едином docker-compose (корневой `docker-compose.yml`): сервисы
`postgres`, `redis`, `migrate`, `backend`, `frontend` в одной сети `z-internal`.
**Воркеры BullMQ работают in-process внутри контейнера `backend`** — отдельного
процесса/юнита воркеров нет. Все prod-команды выполняются через
`docker compose exec backend ...` (или `docker compose run --rm backend ...` для
сценариев до старта стека). Медиа-стек (LiveKit/Egress/TURN) — отдельный compose
в `infra/livekit/`. На managed-проде (Yandex Managed PostgreSQL) сервис `postgres`
из compose не используется — БД внешняя, координаты в `DATABASE_URL` (`.env`).

## Два источника бэкапа

| Источник | Где | Когда создаётся | Назначение |
|---|---|---|---|
| **Авто-бэкап перед миграцией** | docker-volume `z-backups` (`/app/backups/pre-deploy-*.dump`) | автоматически на каждом `docker compose up -d` (шаг `autoBackup()` в `apply-prod-deploy.ts --with-schema`, перед `migrate deploy`) | мгновенный откат неудачного выката схемы |
| **Ежедневный S3-бэкап** | S3 (Selectel, bucket `db-backups`, ключи `postgres/YYYY/MM/DD/...sql.gz.enc`) | cron 03:00 через `infra/scripts/backup-postgres.sh` | потеря БД, restore на staging, откат на часы назад |

## Предусловия

- Доступ на хост прода, где поднят корневой `docker compose` (там же docker-volume `z-backups`).
- Для S3-restore: Selectel S3 креды, `BACKUP_KEY`, `S3_ENDPOINT`, `BACKUP_BUCKET`
  (те же значения, что у `infra/scripts/backup-postgres.sh`; в проде передаются
  через `.env` / окружение хоста).
- `DATABASE_URL` доступен внутри контейнера `backend` (из `.env`); `pg_dump`/
  `pg_restore`/`psql`/`aws`/`openssl` присутствуют в образе `z-backend`
  (`postgresql16-client`).

## Откат неудачной миграции (авто-бэкап из `z-backups`)

`apply-prod-deploy.ts --with-schema` снимает `pg_dump -Fc` в `z-backups` ПЕРЕД
любым `migrate deploy` / `--accept-data-loss`. Если выкат схемы прошёл плохо:

```bash
# 1. Найти свежий авто-бэкап в volume z-backups.
docker compose run --rm --no-deps backend ls -lt /app/backups/

# 2. Восстановить из него (--clean --if-exists перезаписывает существующие объекты).
docker compose run --rm --no-deps backend \
  pg_restore --clean --if-exists -d "$DATABASE_URL" /app/backups/pre-deploy-<ts>.dump
```

(`apply-prod-deploy.ts` после успешного бэкапа сам печатает в лог точную
restore-команду с актуальным именем файла — см. `docker compose logs migrate`.)

## Шаги (test restore на staging из S3)

`infra/scripts/restore-postgres.sh` (скачать → расшифровать → `pg_restore`)
запускаем внутри контейнера `backend` — там есть `pg_restore`, `aws`, `openssl`.
Скрипт принимает все параметры через ENV.

```bash
# 1. Найти последний бэкап в S3.
docker compose exec backend \
  aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$BACKUP_BUCKET/postgres/" --recursive | tail -5

# 2. Создать целевую БД (отдельную, не prod).
docker compose exec backend \
  psql "$DATABASE_URL" -c 'CREATE DATABASE z_main_restore_test OWNER z_app;'

# 3. Запустить восстановление в неё.
docker compose exec \
  -e S3_KEY=postgres/2026/05/09/z-20260509-0300.sql.gz.enc \
  -e DB_NAME=z_main_restore_test \
  backend bash infra/scripts/restore-postgres.sh

# 4. Smoke check.
docker compose exec backend \
  psql "$DATABASE_URL" -d z_main_restore_test -c 'SELECT count(*) FROM "User";'
```

> `restore-postgres.sh` требует `S3_KEY`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
> `DB_NAME`, `BACKUP_KEY`, `S3_ENDPOINT`, `BACKUP_BUCKET`,
> `AWS_ACCESS_KEY_ID/SECRET`. Если в образе `backend` его нет (скрипт лежит в
> `infra/scripts/`, не в backend-контексте) — выполнить эти три шага вручную:
> `aws s3 cp` → `openssl enc -d -aes-256-cbc -pbkdf2` → `pg_restore --no-owner
> --no-acl --jobs=4`, как описано в самом `infra/scripts/restore-postgres.sh`.

## Шаги (prod restore — БД полностью потеряна)

> ВНИМАНИЕ: эта процедура — крайний случай. Перед её запуском убедиться,
> что нет шанса восстановить БД иначе (managed-снапшот, replica, WAL, и т.п.).

```bash
# 1. Остановить backend (он не должен писать в БД, пока она не готова).
#    Воркеры BullMQ живут в этом же контейнере — останавливаются вместе с ним.
docker compose stop backend

# 2. Переименовать старую БД (если она ещё доступна) и создать пустую.
docker compose run --rm --no-deps backend \
  psql "$DATABASE_URL" -c "ALTER DATABASE z_main RENAME TO z_main_broken_$(date +%s);"
docker compose run --rm --no-deps backend \
  psql "$DATABASE_URL" -c 'CREATE DATABASE z_main OWNER z_app;'

# 3. Восстановление (из S3 — см. блок выше; или из z-backups авто-бэкапа).
docker compose run --rm --no-deps \
  -e S3_KEY=<последний-бэкап> \
  -e DB_NAME=z_main \
  backend bash infra/scripts/restore-postgres.sh

# 4. Поднять backend (вместе с in-process воркерами).
docker compose up -d backend

# 5. Smoke test.
docker compose exec backend wget -qO- http://127.0.0.1:3000/health
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

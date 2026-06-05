# ТЗ: переход с `prisma db push` на версионируемые миграции Prisma

**Дата:** 2026-06-05
**Статус:** в работе (ветка `videofix`)
**Триггер:** требование владельца после прод-инцидента «осиротевший enum».

## Проблема / почему

Прод применял схему через `apply-prod-deploy.ts --with-schema` → `prisma db push --accept-data-loss`. `db push` неатомарен и не версионируется: при сбое посреди прогона БД остаётся в частичном состоянии. Инцидент 2026-06-05: коммит `158a33d8` (Ф0 identity-фундамент участника) добавил enum `ParticipantInvitationStatus` + колонки `Participant.{invitationStatus,inviteToken,invitedAt,deviceCount}`. На проде применилось частично: enum создан («осиротевший»), колонки — нет. Следствия:
- `POST /meetings` → 500 (`type "public.ParticipantInvitationStatus" does not exist` при вставке host-участника, `meetings.service.ts:328`);
- `GET /meetings/:id/result` → 500 (`include: participants`, `meetings.service.ts:913` — SELECT несуществующих колонок) → страница результата висит, **видео-плеер «бесконечно грузит»** (исходный симптом, с которого началась задача — оказался следствием, а не проблемой S3);
- повторный `db push` падает на `CreateEnum ... already exists` и не может сам выкрутиться.

## Решение

Перейти на версионируемые файловые миграции Prisma. На прод — `prisma migrate deploy`. Каждое изменение схемы фиксируется файлом в `backend/prisma/migrations/`. `db push` — только для черновых локальных проб (не коммитятся). Workflow гибридный (подтверждён владельцем).

Стек: Prisma 7.8.0, driver adapter (PrismaPg), CLI берёт URL из `backend/prisma.config.ts`. pgvector через `extensions=[pgvector]` + preview `postgresqlExtensions`. HNSW/GIN-индексы — отдельно в `scripts/postgres-init.sql` (остаются отдельным шагом).

Prisma 7 флаги migrate diff: `--from-empty`, `--from-schema`/`--to-schema` (путь к schema), `--from-config-datasource`/`--to-config-datasource` (живая БД из config).

## Фазы

- [x] **Ф1. Init-миграция** — `backend/prisma/migrations/0_init/migration.sql` из `migrate diff --from-empty --to-schema prisma/schema.prisma --script` (8005 строк, содержит `CREATE EXTENSION vector`, vector-колонки, enum+колонки Participant) + `migration_lock.toml` (provider=postgresql).
- [x] **Ф2. Деплой-пайплайн** — `apply-prod-deploy.ts` `runSchemaPhase`: `db push --accept-data-loss` → `prisma migrate deploy`; обновлены docstrings/help/autoBackup-формулировки.
- [x] **Ф2b. Авто-baseline (hands-free деплой)** — `ensureBaseline()` в schema-фазе: определяет состояние БД (`_prisma_migrations` есть? таблицы есть?) и ОДНОРАЗОВО переводит db-push'нутую базу под миграции — reconcile-дифф (аддитивно, с DROP-гейтом) + `migrate resolve --applied 0_init`. Деплой = `docker compose up -d`, без ручных шагов.
- [x] **Ф3. package.json** — добавлены `prisma:migrate` (migrate dev), `prisma:migrate:deploy`, `prisma:migrate:status`; `prisma:push` оставлен.
- [x] **Ф4. Документация** — `schema.prisma` header, skill `prisma-db-push-rules` (переписан), `CLAUDE.md`, `docs/operations/prod-deploy-log.md` (migrate-контейнер + baseline-блок).
- [x] **Ф5. second-brain** — `02_architecture/data-model.md` + `tech-stack.md` баннеры; рефлексия в `05_история/`; строка в `04_не-сделано`.
- [ ] **Ф6. Прод-выкат (владелец)** — обычный `docker compose up -d` (авто-baseline отработает сам). У агента нет прод-доступа.
- [ ] **Ф7. Локальный baseline + проверка migrate dev на dev-БД** — после поднятия локальной БД.

## Прод-выкат (Ф6 — автоматический)

Полностью hands-free. Команд для baseline руками НЕ нужно — `ensureBaseline()` отработает на первом выкате. Блок: `docs/operations/prod-deploy-log.md` → «🆕 2026-06-05 — Переход на миграции».

```bash
cd /home/docker/z && git pull origin dev
docker compose build backend frontend
docker compose up -d
docker compose logs -f migrate   # увидишь ">>> [schema] АВТО-BASELINE ..." на первом прогоне
```

Фолбэк (только если авто-baseline остановится на DROP-гейте) — ручной reconnect, см. тот же блок в prod-deploy-log.

## Риски

- **migrate diff + pgvector** — проверено: `0_init` содержит `CREATE EXTENSION IF NOT EXISTS "vector"`.
- **Shadow DB для `migrate dev`** (локально, pgvector) — Prisma создаёт временную shadow-БД; pgvector в dev-образе доступен. Если у роли нет `CREATE DATABASE` — задать `shadowDatabaseUrl`. Проверить тестовым `migrate dev` (Ф7).
- **Ручной review reconcile.sql** обязателен перед apply (Ф6.A).
- **Откат** — авто-бэкап `pre-deploy-*.dump`.

## Итог

Реализовано в коде/доках (Ф1–Ф5). Осталось: прод-выполнение baseline (Ф6, владелец) и локальная проверка `migrate dev` (Ф7).

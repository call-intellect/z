---
date: 2026-06-05
tags: [recordings, video, prisma, migrations, prod-incident, db-schema, deploy]
distilled: false
---

# Видео-плеер «бесконечно грузит» → корень = дрейф схемы от db push → переход на миграции Prisma

Ветка: `videofix`. ТЗ: [`plans/tz/2026-06-05-prisma-migrations-switch.md`](../../plans/tz/2026-06-05-prisma-migrations-switch.md).

## Что было поставлено

Жалоба: запись встречи пишется на S3, но на странице результата плеер «бесконечно грузит», видео не играет. Гипотеза владельца — потерялась ссылка на S3 в БД.

## Как диагностировал

1. **Прошёл всю цепочку видео** (не трогая прод): egress → `recordings.service` (`mainVideoUrl`, status=ready) → `presignComposite` (presigned URL, `response-content-type=video/mp4&inline`) → фронт `MeetingResultPageReal` тянет `downloadUrl` при `hasRecording` → `MeetingPlayer` (Vidstack). Всё в коде корректно; плеер уже развязан от `failed` (коммит `daff5f50`). faststart-worker (moov→начало) включён, ffmpeg в prod-образе, воркеры in-process.
2. **Улика из прод-диагностики 4 июня:** видео на S3 готово (status=ready, 616МБ, faststart) — значит обрыв на последнем звене.
3. **Владелец дал прод-факты:** `POST /meetings` → 500 `type "public.ParticipantInvitationStatus" does not exist`; в списке встреч нет входа в результат.
4. **Корень:** прод-БД отстала от кода. Коммит `158a33d8` (Ф0 identity) добавил enum + колонки `Participant`, но `db push` на проде применился **частично** (enum создан-«осиротел», колонки нет). → `POST /meetings` падает (вставка участника с enum), `GET /result` падает (`include: participants` тянет несуществующие колонки) → result-эндпоинт 500 → плеер висит вечно. Список встреч жив (без participant-колонок). **Исходный «баг видео» — следствие дрейфа схемы, а не проблема S3.**
5. Попытка `db push` на проде упала на `CreateEnum already exists` (осиротевший enum) — db push не смог сам выкрутиться.

## Решение (по требованию владельца)

Уйти от `db push` к версионируемым миграциям Prisma. Сделал в коде/доках:
- **init-миграция** `backend/prisma/migrations/0_init/` из `migrate diff --from-empty --to-schema` (8005 строк, есть `CREATE EXTENSION vector`) + `migration_lock.toml`.
- **деплой:** `apply-prod-deploy.ts` `runSchemaPhase` — `db push --accept-data-loss` → `prisma migrate deploy` (бэкап/dedupe/postgres-init сохранены).
- **package.json:** `prisma:migrate`(dev)/`:deploy`/`:status`; `prisma:push` оставлен для черновиков.
- **доки:** `schema.prisma` header, skill `prisma-db-push-rules` (полностью переписан под миграции, гибрид), `CLAUDE.md`, `prod-deploy-log.md` (migrate-контейнер + одноразовый baseline-блок), second-brain `data-model`/`tech-stack`.
- **авто-baseline (hands-free):** `ensureBaseline()` в schema-фазе сам определяет состояние БД и одноразово переводит db-push'нутую базу под миграции (reconcile аддитивно + `resolve --applied 0_init`, DROP-гейт + авто-бэкап). Прод-выкат = обычный `docker compose up -d`, ручных шагов нет (по требованию владельца «деплой без заморочек»).

## Что вышло

- Код+доки готовы. Прод-baseline и локальный `migrate dev` (shadow DB + pgvector) — за владельцем/после поднятия dev-БД (зафиксировано в `04_не-сделано`).
- Сборку/typecheck гонять локально без БД ограниченно; верификация — `migrate status` после baseline на проде.

## Чему научился

- **`db push --accept-data-loss` неатомарен** → при сбое оставляет частичное состояние (осиротевший enum + нет колонок). Это и есть аргумент за миграции. Prisma `db push` для уже существующего, но неиспользуемого enum-типа повторно генерит `CreateEnum` → «already exists» → тупик.
- **«Бесконечная загрузка» плеера ≠ проблема плеера/S3.** 500 на result-эндпоинте (схема-дрейф) выглядит как зависший плеер. Симптом видео был на 3 уровня глубже.
- **Prisma 7 migrate diff флаги изменились:** `--from-empty`, `--from-schema`/`--to-schema` (путь к schema-файлу), `--from-config-datasource`/`--to-config-datasource` (живая БД из `prisma.config.ts`). Старый `--to-schema-datamodel`/`--from-url` — не из 7.x.
- **Reconcile дрейфа без db push:** `migrate diff --from-config-datasource --to-schema` диффит реальную БД к схеме → аддитивный SQL, использующий существующий enum (обходит CreateEnum-тупик).

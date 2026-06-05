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

## Итог по выкату

После фикса `ag_catalog → public` + forced search_path выкат **прошёл успешно**: `migrate deploy` применил reconcile, postgres-init и все 116 seed/patch отработали идемпотентно, backend поднялся. Видео/создание встреч починены. Затем — чистка лога: `apply-prod-deploy.ts` переведён в тихий режим (1 строка-итог на шаг, полный вывод только у упавших; `--verbose`/`APPLY_PROD_DEPLOY_VERBOSE=1` для подробностей) — раньше идемпотентный выкат сыпал 600+ строк (один `seed-llm-default-primary-deepseek-pro` давал ~80 строк skip).

## НАСТОЯЩИЙ корень видео (финал)

После починки схемы/миграций видео всё равно не игралось — «вечная крутилка». Решающая улика от владельца: **в Network НЕТ запроса `composite.mp4` вообще**, хотя бэкенд логирует `S3 presignGet OK`. Значит плеер получил URL, но не пошёл за файлом. Причина — **Vidstack не определяет тип источника из presigned-URL**: строка `.../composite.mp4?X-Amz-...` — query-строка ломает определение провайдера по расширению → `<video>` не создаётся → крутилка без сетевого запроса. Фикс: передавать явный тип — `src={{ src: videoUrl, type: 'video/mp4' }}` (вместо `src={videoUrl}`) во всех трёх плеерах (`MeetingPlayer`, `ShareMeetingClient`, `ShareClipClient`). Подтверждено доку Vidstack (Src = `{src, type}`, explicit provider selection). **Это и был исходный баг с первого сообщения** — всё остальное (дрейф схемы → 500 на result) маскировало его, не давая дойти до плеера.

## Чему научился

- **`db push --accept-data-loss` неатомарен** → при сбое оставляет частичное состояние (осиротевший enum + нет колонок). Это и есть аргумент за миграции. Prisma `db push` для уже существующего, но неиспользуемого enum-типа повторно генерит `CreateEnum` → «already exists» → тупик.
- **«Бесконечная загрузка» плеера ≠ проблема плеера/S3.** 500 на result-эндпоинте (схема-дрейф) выглядит как зависший плеер. Симптом видео был на 3 уровня глубже.
- **Prisma 7 migrate diff флаги изменились:** `--from-empty`, `--from-schema`/`--to-schema` (путь к schema-файлу), `--from-config-datasource`/`--to-config-datasource` (живая БД из `prisma.config.ts`). Старый `--to-schema-datamodel`/`--from-url` — не из 7.x.
- **Reconcile дрейфа без db push:** `migrate diff --from-config-datasource --to-schema` диффит реальную БД к схеме → аддитивный SQL. НО в Z схема разделена (schema.prisma + postgres-init.sql) → diff хочет дропнуть GIN/HNSW/tsvector (false-positives). Поэтому авто-reconcile через diff здесь НЕЛЬЗЯ; реальный дрейф выправляется явной идемпотентной миграцией.
- **Имя миграции сортируется лексикографически.** `0001_reconcile` сортируется ДО `0_init` (символ `_` = 0x5F больше всех цифр 0x30-0x39!), из-за чего Prisma считала первой миграцией reconcile, а 0_init — второй → P3005 «database schema is not empty» на migrate deploy. Фикс: timestamp-префикс (`20260605075900_*`) сортируется ПОСЛЕ `0_init`. Урок: имена миграций — всегда timestamp-префикс (как делает `migrate dev`), `0_init` — единственное исключение-baseline.
- **P3005 на migrate deploy** = БД непустая, но первая (по порядку имён) миграция не отмечена applied. Лечится правильным порядком + baseline первой миграции.
- **AGE ломает детекцию `_prisma_migrations`.** Роль приложения имеет `search_path = ag_catalog, "$user", public` → Prisma создаёт служебную таблицу `_prisma_migrations` НЕ в `public` → `to_regclass('public._prisma_migrations')` = NULL (ложно «нет»). Детектить надо schema-агностично: `SELECT count(*) FROM pg_class WHERE relname='_prisma_migrations'`. Та же ловушка возможна для любых проверок «есть ли таблица X» через `public.` на этом проекте.
- **P3008** = `migrate resolve --applied <name>` для уже-applied миграции. Делать resolve идемпотентным (ловить P3008 как успех), чтобы повторный/перестраховочный baseline не валил деплой.
- **Корень всей серии P3005/P3008 = AGE search_path.** `_prisma_migrations` физически создавалась в `ag_catalog` (первая схема в `ag_catalog, "$user", public`), а `migrate deploy` ищет её в `public` (datasource schema) → вечный P3005. Диагностировано `\dt *._prisma_migrations` (показал схему `ag_catalog`). **Окончательный фикс:** (1) `ALTER TABLE "ag_catalog"._prisma_migrations SET SCHEMA public` (перенос, qualified — не зависит от search_path), (2) форсировать `search_path=public` для prisma-команд миграций через URL-параметр `?options=-c search_path=public` (Prisma 7 его принимает — проверено: P1001, а не parse-error). Урок: на проектах с AGE/кастомным search_path Prisma migrate надо ЯВНО прибивать к public, иначе служебная таблица «уезжает».

---
date: 2026-06-28
title: Локальный запуск Коры на macOS + фикс партиционной миграции
tags: [dev-ops, local-setup, prisma, migrations, ioredis, macos]
distilled: false
---

# Локальный запуск Коры (dev) на macOS + найденный фикс миграции

## Что было поставлено
Изучить возможность, подготовить план и **запустить проект локально** на машине разработчика (macOS),
чтобы можно было создавать пользователей, ходить по кабинету и тестировать. Создать
документ-инструкцию (живой, с журналом ошибок), т.к. ожидались проблемы. В конечном итоге — Docker.

Решения владельца (через AskUserQuestion): **кабинет без видеовстреч** · **реальные AI-ключи** из прод-`.env` ·
**чистая БД + сиды** · режим **гибрид сейчас, Docker целиком — фаза B**.

## Как решал

### Артефакты (мои, новые)
- [docs/operations/local-dev-setup.md](../../docs/operations/local-dev-setup.md) — runbook + журнал ошибок (главный deliverable).
- `scripts/make-local-env.ts` — генерит `backend/.env` из прод-`/.env` с патчем инфры на `127.0.0.1` (+ `NODE_ENV=development`, MinIO, MAIL_DRY_RUN). AI-ключи/секреты переносит как есть.
- `scripts/dev-local.ts` — лаунчер backend+frontend, НЕ тянет прод-`/.env` (см. ключевой урок ниже).
- `package.json` → `dev:local`, `make-local-env`.
- `frontend/.env.local`, `backend/.env` (gitignored).

### Порядок
1. Зависимости: `docker compose -f docker-compose.dev.yml up -d postgres redis minio` (образ PG16+pgvector+AGE собирается ~3.5 мин первый раз).
2. Схема: `bunx prisma migrate deploy` (0_init = полный снимок → 90 миграций на пустую БД) → `apply-postgres-init` (HNSW/GIN/AGE) → `prisma:generate`.
3. Сиды: `apply-prod-deploy.ts --mode bootstrap` (118 шагов OK, включая bootstrap-admin и эталонную Demo-Org «ТехноСтрим»).
4. Запуск: `bun run dev:local`. Проверка: `/health` ok, Swagger `/api/docs`, frontend 200.
5. Приёмка: завёл `test@kora.local` через `POST /register` → временный пароль из логов (MAIL_DRY_RUN) → вход → смена пароля → онбординг «Кто вы в компании? Шаг 1 из 6». Playwright-скрин подтверждает рендер.

## Что вышло (6 реальных багов, все вскрылись при запуске)

1. **Партиционная миграция `20260627120000` падала** на чистой БД: `relation "IdeaBlock_pkey" already exists`.
   Причина: `ALTER TABLE … RENAME TO …_old` в Postgres НЕ переименовывает индекс pkey → имя занято при
   `ADD CONSTRAINT` новой партиц-таблицы. **Это упало бы и на проде.** Фикс: `DROP CONSTRAINT IF EXISTS *_pkey`
   на `*_old` после ренейма (входящие FK уже сняты в ШАГ2). + `migrate resolve --rolled-back` → повторный deploy.
   После фикса — 90 миграций + 3 последующие применились, backend читает партиц-таблицы. **Нужно применить на прод.**
2. **`apply-prod-deploy.ts` требует `psql`** в PATH (ledger-таблица) — на macOS нет. Решение: `brew install libpq`.
3. **ioredis `Connection is closed`** хотя контейнеры healthy. Причина: `localhost` на macOS → IPv6 `::1`,
   Docker публикует только IPv4 `127.0.0.1`. Фикс: инфра-URL → `127.0.0.1` (Prisma migrate проходил по localhost
   через Rust-движок, а рантайм ioredis/pg/S3 — нет).
4. **`bun run dev:local` тащил прод-`/.env`**: bun авто-грузит `.env` из cwd (корень) в `process.env` родителя,
   лаунчер отдавал `env: process.env` детям → прод `REDIS_URL=redis://redis:6379` перебивал `backend/.env`.
   Фикс: лаунчер берёт из `backend/.env`/`frontend/.env.local` только **имена ключей** и удаляет их из
   наследуемого env — значения подставляет сам Bun из локального файла (корректно срезая кавычки/комментарии).
5. **Frontend бил в `https://korateam.ru/api/...`** (ПРОД) — тот же механизм: корневой `/.env` содержит
   `NEXT_PUBLIC_API_BASE_URL=https://korateam.ru`, через `process.env` перебивал `frontend/.env.local`.
   Тот же фикс (удаление ключей из наследуемого env frontend-ребёнку).
6. **`EADDRINUSE` 3000/3001** — осиротевшие `next-server` (PPID→launchd, переживают Ctrl+C лаунчера),
   плюс порт 3000 держал соседний проект `sitekora/web`. Лечится явным `kill` orphan-процессов перед рестартом.

Итог: стек поднят, кабинет работает end-to-end (логин → онбординг), документ-инструкция с журналом готова.

## Чему научился
- **Корневой `/.env` в этом репо = ПРОД** (NODE_ENV=production, хосты `postgres`/`redis`, прод-секреты,
  `NEXT_PUBLIC_*=korateam.ru`). Любой инструмент, запущенный из корня под bun, авто-подхватывает его в
  `process.env` — это главная ловушка локального запуска. Локальный конфиг изолируется в `backend/.env`/
  `frontend/.env.local`, а лаунчер обязан **вычистить** прод-ключи из наследуемого env, а не просто отдать `process.env`.
- **macOS + Docker: всегда `127.0.0.1`, не `localhost`** в connection-строках (ioredis/pg/AWS-SDK пробуют IPv6 первым).
- **Логин по http localhost требует `NODE_ENV=development`** (`secure: !isDevelopment` у session-cookie).
- **Миграции «AUTHORED WITHOUT LOCAL DB» опасны**: партиц-миграция содержала баг, который виден только на реальном
  прогоне. Локальный запуск окупился сразу — поймали прод-блокер до выката.
- `prisma migrate deploy` на чистой БД корректно создаёт всё из `0_init` (полный снимок), последующие миграции
  накатываются поверх; `apply-prod-deploy.ts --mode bootstrap` без `--with-schema` даёт сиды без pg_dump-зависимости.

# Z Backend (NestJS)

Backend для AI-видеовстреч на LiveKit. См. карту проекта в `../CLAUDE.md` и архитектуру в `../plans/architecture/2026-05-08-z-architecture.md`.

## Стек

NestJS 10 + Prisma 5 + PostgreSQL + Redis + BullMQ + LiveKit Server SDK + S3 + Anthropic SDK. Рантайм — Bun (для dev/build), node 20 (для prod-runner).

## Локальный запуск

1. Скопируй `.env.example` в `.env` и заполни значения.
2. Подними локальные зависимости (Postgres, Redis, MinIO) из корня:
   ```
   docker compose -f docker-compose.dev.yml up -d
   ```
3. Накати схему БД и сгенерируй Prisma Client:
   ```
   bun install
   bun run prisma:push
   bun run prisma:generate
   ```
4. (Опционально) создай первого админа из `ADMIN_BOOTSTRAP_EMAIL`:
   ```
   bun run prisma:seed
   ```
5. Запусти dev-сервер:
   ```
   bun run dev
   ```
   Сервис слушает `http://localhost:${PORT}` (по умолчанию 3000). Swagger: `/api/docs`. Health: `/health`. Метрики: `/metrics`.

## Полезные команды

| Команда                    | Что делает                                       |
| -------------------------- | ------------------------------------------------ |
| `bun run dev`              | Dev-сервер с авто-перезагрузкой                  |
| `bun run typecheck`        | `tsc --noEmit`                                   |
| `bun run lint`             | ESLint                                           |
| `bun run build`            | Prod-сборка в `dist/`                            |
| `bun run start`            | Запуск собранного `dist/main.js`                 |
| `bun run prisma:push`      | Накатить `schema.prisma` в БД (db push)          |
| `bun run prisma:generate`  | Сгенерировать Prisma Client                      |
| `bun run prisma:studio`    | UI для инспекции БД                              |
| `bun run prisma:seed`      | Создать первого админа из ENV                    |
| `bun run worker:dev`       | Воркер BullMQ (dev)                              |
| `bun run test:unit`        | Unit-тесты (vitest)                              |
| `bun run test:integration` | Интеграционные тесты                             |
| `bun run test:e2e`         | E2E-тесты                                        |

## ENV / Конфигурация

Все ENV-переменные описаны в `src/common/config/env.schema.ts` (Zod-схема) и читаются через `TypedConfigService`. Шаблон значений — в `../​.env.example` (корневой) и `.env.example` (этот каталог).

Tracker-модуль (Sprint 1):

| Переменная | Default | Назначение |
|---|---|---|
| `WEBHOOK_HMAC_PREFIX` | `kora_wh_` | Префикс для secret webhook'ов трекера (для ротации). |
| `TRACKER_INGEST_QUEUE` | `core.raw-events` | Имя BullMQ-очереди ingest'а tracker → knowledge-core. |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | `86400` | TTL Idempotency-Key (24ч) в Redis для POST /api/v1/tracker/*. |
| `TRACKER_WEBHOOK_MAX_RETRIES` | `5` | Макс. попыток доставки tracker webhook'а. |
| `TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS` | `60000` | Начальная задержка retry, ms (далее — экспоненциально). |

## Правила

- Только `prisma db push`, никогда `prisma migrate*` — см. `.claude/skills/prisma-db-push-rules`.
- Все ENV — через `TypedConfigService`, никаких `process.env.*` вне `env.schema.ts`.
- LiveKit-токены генерирует только backend.

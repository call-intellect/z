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

## Правила

- Только `prisma db push`, никогда `prisma migrate*` — см. `.claude/skills/prisma-db-push-rules`.
- Все ENV — через `TypedConfigService`, никаких `process.env.*` вне `env.schema.ts`.
- LiveKit-токены генерирует только backend.

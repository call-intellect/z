---
type: project
status: in_progress
phase: 8
---

# CronManagerService + UI управления кронами

> Управление 25+ `@Cron`-джобами Z без редеплоя: включить / отключить / поменять расписание / запустить вручную. Часть редизайна админки (Фаза 8). См. [admin-z-global.md](admin-z-global.md).

## Зачем

Каждый `@Cron('expr')` в коде — это «гвоздь», который нельзя сдвинуть без выкатки. Когда оператор хочет временно отключить `email-fetch` (упал SMTP) или поменять расписание `theme-clusterer` (хочется раз в 4 часа вместо раз в час) — это должно делаться через UI с audit и rollback на дефолт.

## Модели

[backend/prisma/schema.prisma](backend/prisma/schema.prisma):

```prisma
model CronSchedule {
  name              String   @id        // "email-fetch", "theme-clusterer", ...
  expression        String              // "*/5 * * * *"
  defaultExpression String              // bootstrap-дефолт из @Cron(...)
  enabled           Boolean  @default(true)
  description       String?
  lastRunAt         DateTime?
  lastRunDurationMs Int?
  lastRunError      String?
  updatedBy         String?
  updatedAt         DateTime @updatedAt
}

model CronRunHistory {
  id          String   @id @default(cuid())
  cronName    String
  startedAt   DateTime @default(now())
  durationMs  Int?
  status      String                 // "success" | "failed" | "running"
  error       String?
  triggeredBy String?                // null = scheduled, userId = manual
  @@index([cronName, startedAt])
}
```

## Сервис

[backend/src/modules/admin/crons/cron-manager.service.ts](backend/src/modules/admin/crons/cron-manager.service.ts):

- `onModuleInit()` — после bootstrap читает все `@Cron`-декораторы через `SchedulerRegistry.getCronJobs()`, синхронизирует с `CronSchedule` (upsert по `name`):
  - Если БД-запись есть → если `expression != defaultExpression` → переподписывает джобу с новым выражением, иначе оставляет дефолт.
  - Если `enabled === false` → удаляет джобу из `SchedulerRegistry`.
- `updateSchedule(name, { expression?, enabled? }, ctx)` — пишет в БД, переподписывает джобу в SchedulerRegistry, пишет в audit.
- `triggerNow(name, ctx)` — запускает джобу немедленно (через найденный handler), пишет в `CronRunHistory` с `triggeredBy=userId`.
- Все `@Cron`-handler'ы обёрнуты `runWithHistory()` — пишут start/finish/error в `CronRunHistory`.

При ошибке БД (упала во время `onModuleInit`) — fallback на дефолтные `@Cron(...)`, ERROR-лог, продолжаем работу. Дефолты всегда работают — это даёт устойчивость к деградации БД.

## Контроллер

[backend/src/modules/admin/crons/admin-crons.controller.ts](backend/src/modules/admin/crons/admin-crons.controller.ts):

```
GET    /api/v1/admin/crons              список всех + статус
PATCH  /api/v1/admin/crons/:name        { expression?, enabled? }
POST   /api/v1/admin/crons/:name/run    ручной запуск
```

Severity `high` для `enabled=false` критичных кронов (`email-fetch`, `theme-clusterer`, `card-rollup-v2`, `retention-purger`) — `reason` обязателен.

## Управление через UI

[frontend/app/(admin)/admin/platform/crons/](frontend/app/(admin)/admin/platform/crons/):

- Таблица всех CronSchedule с колонками: имя, выражение (cron expr), defaultExpression, enabled toggle, lastRunAt, lastRunDurationMs, lastRunError.
- Колонка «Действия»: «Запустить сейчас», «Изменить расписание» (модалка с валидацией cron-expr), «Откатить на дефолт».
- Внутри карточки крона — вкладки `AdminTabs`:
  - **Расписание** — текущее выражение + дефолт + кнопка rollback.
  - **История** — список из `CronRunHistory` (последние 100 запусков, статус, длительность, error).
  - **Превью** — следующие 5 запусков по текущему выражению (через `cron-parser`).
  - **Audit** — кто и когда менял.

## Список кронов (≥25 на Фазу 9)

Реестр — [workers-queues.md](workers-queues.md). Среди наиболее «трогаемых» оператором:

- `email-fetch` (IMAP polling) — отключают при проблемах с SMTP.
- `theme-clusterer` — раз в час, можно отжать до раз в 4 часа на staging.
- `card-rollup-v2` — раз в 60s (debounce), не трогать без причины.
- `reframing` — 3:00 ночи, decay связей.
- `entity-graph-builder` — раз в час.
- `daily-checkin-prompt` — рассылка чек-инов.
- `operations-weekly-digest` — понедельник 09:00.
- `retention-purger` — ночной purge старых записей.
- `idea-clusterer` — раз в 4 часа.
- `cron-history-cleanup` — чистка собственной истории (>30 дней).

## Риски

1. **Сломанное cron-выражение → джоба не запускается.** UI валидирует через `cron-parser` на save (Zod).
2. **БД недоступна → onModuleInit упал.** Fallback на `@Cron(...)`-дефолты.
3. **Race: два super_admin одновременно правят.** Optimistic concurrency через `updatedAt`.

## Связанные

- [admin-z-global.md](admin-z-global.md) — каркас.
- [admin-workers.md](admin-workers.md) — BullMQ-инспектор (отдельная история — там очереди, тут расписание).
- [admin-settings.md](admin-settings.md) — AdminSetting для тюнинга параметров внутри кронов (например `THEME_COSINE_THRESHOLD`).
- [workers-queues.md](workers-queues.md) — полный реестр @Cron / BullMQ-очередей.

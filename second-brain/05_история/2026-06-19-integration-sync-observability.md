---
date: 2026-06-19
title: Observability Bitrix/ChatBox — таблица прогонов + именованные cron + admin-страница
tags: [bitrix, chatbox, observability, admin]
distilled: false
---

# Рефлексия: Observability Bitrix/ChatBox

## Что было поставлено

Пользователь попросил проверить работу синхронизации Bitrix/ChatBox на проде.  
Диагностика через prod API показала: синк работает (lastSyncAt обновились в полночь), но в логах **полная тишина** — ни одного `CronRunHistory`-запись не было, очереди `bitrix.*`/`chatbox.*` отсутствовали в admin-панели.

Задача: сделать информативные логи в БД — видеть каждый прогон синка/анализа, его статус, длительность, счётчики, ошибку.

## Как решал

### Ф1 — Prisma-модель
Добавил `IntegrationSyncRun` в `schema.prisma` (10 полей: tenantId, provider, kind, scope, refId, startedAt, finishedAt, durationMs, status, counts, error). Ручная миграция `20260619130000_integration_sync_run/migration.sql`. `prisma:generate`.

### Ф2 — IntegrationSyncLogService
Новый модуль `integrations-observability/` с сервисом `IntegrationSyncLogService`:
- `begin(meta)` → upsert row с `status='running'`, возвращает handle `{id}`
- `succeed(handle, counts?)` → update `status='success'`, `finishedAt`, `durationMs`
- `fail(handle, error)` → update `status='failed'`, `error`
- `skip(handle, reason?)` → update `status='skipped'`

Все методы **best-effort**: перехватывают ошибки Prisma, пишут `logger.warn`, никогда не бросают. Модуль подключён в `workers.module.ts` (импорт в алфавитном порядке).

### Ф3 — Врезка в 4 воркера
- `bitrix-sync.worker.ts` — `@Optional() IntegrationSyncLogService`, begin/succeed/fail вокруг `syncByScope`
- `chatbox-sync.worker.ts` — аналогично; возврат типизирован как `| undefined` вместо `| void`
- `bitrix-analyze.worker.ts` — skip при `ingestSession→null`, succeed/fail по результату
- `chatbox-analyze.worker.ts` — аналогично; fail перед `updateMany(analysisStatus='failed')`

Инжект через `@Optional()` — модуль мог бы отсутствовать, сервис тихо игнорируется.

### Ф4 — Именованные @Cron
Добавил `{ name: '...' }` к 4 cron-декораторам (BitrixSyncCron.runDaily, ChatboxSyncCron.runDaily, BitrixAnalyzeCron.sweep, ChatboxAnalyzeCron.sweep). Теперь `CronManager.runWrapped()` умеет заменять безымянный шедулер именованным и писать `CronRunHistory`.

Новый `seed-integration-crons.ts` — создаёт 5 `CronSchedule`-строк (create-if-missing). Зарегистрирован в `apply-prod-deploy.ts STEPS` (`phase:'seed-base'`). Добавил `IntegrationSyncLogPruneCron.run` (ежесуточная чистка старше 90 дней).

### Ф5 — Очереди в реестре
`queues.ts` для bitrix/chatbox (`BITRIX_QUEUE_NAMES`, `CHATBOX_QUEUE_NAMES`). Импорт в `workers-admin.service.ts → getKnownQueueNames()`. Теперь 4 очереди видны в `/admin/platform/workers`.

### Ф6 — Admin API
`AdminIntegrationsController` под `/api/v1/admin/integrations/sources`:
- `GET /overview` — по всем BitrixIntegration + ChatboxIntegration с groupBy `IntegrationSyncRun` за 24ч (статистика success/failed/running/skipped)
- `GET /runs` — cursor-пагинация по `IntegrationSyncRun` с фильтрами provider/kind/status/tenantId

DTO: `SyncRunsQuerySchema` (Zod), интерфейсы `SourceOverviewItem` / `SyncRunItem`. Добавлены в `IntegrationsAdminModule`.

### Ф7 — Prune cron
`IntegrationSyncLogPruneCron` (`@Cron('0 4 * * *', {name:'...'})`): DELETE WHERE `startedAt < now()-90days`. Экспортируется из `IntegrationObservabilityModule`.

### Ф8 — Frontend-страница
- `src/api/admin-integration-sources.api.ts` — API-слой
- `src/domain/admin-integration-source.ts` — маппер + `healthStatus`
- `app/(admin)/admin/integrations/sources/page.tsx` + `SourcesClient.tsx` — раскрывающийся список org × provider, статс 24ч, inline таблица прогонов с cursor-пагинацией
- Навигация: добавлен пункт «Bitrix / ChatBox» (иконка `DatabaseZap`) под `/admin/integrations/sources`

## Что вышло

- Backend: typecheck ✓, lint 0 ошибок, build ✓
- Frontend: typecheck ✓ (pre-existing feed/page.js ошибка не от нас), lint 0 ошибок

## Чему научился

1. **`@Optional()` — правильный паттерн** для best-effort cross-cutting сервисов (observability, metrics) в воркерах. Воркер не сломается при отсутствии сервиса.
2. **`result | void` vs `| undefined`** — в TypeScript только `| undefined` типизируется корректно; `void` допустим для Promise но не для assignment.
3. **Именование @Cron** — без `{name:'...'}` cron невидим для `CronManager`. Нужно явное имя чтобы попасть в `CronSchedule`/`CronRunHistory`.
4. **Badge variant** — в этом проекте `danger`, не `destructive` (как в shadcn-дефолте).

# ТЗ: Информативные логи состояния источников Bitrix / ChatBox

Дата: 2026-06-19 · Автор: сессия Claude · Статус: в работе

## Проблема (что вскрыто на проде korateam.ru)

Суточная синхра Bitrix/ChatBox **работает** (метки `lastSyncAt` интеграций = 2026-06-19T00:00:0X, ошибок нет),
но наблюдаемость в БД почти нулевая — три дыры:

1. Краны `BitrixSyncCron.runDaily`, `ChatboxSyncCron.runDaily`, `BitrixAnalyzeCron.sweep`,
   `ChatboxAnalyzeCron.sweep` **не трекаются** в `CronRunHistory` (нет строки в `CronSchedule` →
   `applyOverridesFromDb` их не оборачивает) → в админке кронов `lastRunAt = null`, хотя они реально работают.
2. Очереди `bitrix.sync/analyze`, `chatbox.sync/analyze` **не зарегистрированы** в
   `WorkersAdminService.getKnownQueueNames()` → невидимы в админ-панели воркеров.
3. Детальный результат прогона (что/сколько забрано по scope, длительность, ошибка) воркеры пишут
   только в pino-stdout — в БД оседает лишь `lastSyncAt`/`lastError` интеграции.

## Решение (выбрано владельцем)

Полный объём · покрытие **sync + analyze** · просмотр **Admin API + страница в кабинете**.

### Контракт A — новая модель `IntegrationSyncRun`

Зеркалит стиль `CronRunHistory` (String-поля + `///`-комменты Prisma, без enum-миграций).

```prisma
model IntegrationSyncRun {
  id         String    @id @default(cuid())
  tenantId   String
  /// "bitrix" | "chatbox"
  provider   String
  /// "sync" | "analyze"
  kind       String
  /// sync: all/users/dialogs/crm/incremental/customers/managers/chats ; analyze: null
  scope      String?
  /// sync: jobId ; analyze: sessionId
  refId      String?
  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  durationMs Int?
  /// "running" | "success" | "failed" | "skipped"
  status     String
  /// counts забранного: { users: 2, dialogs: 5, ... } | analyze: { rawEventId, tasks }
  counts     Json?
  error      String?

  @@index([tenantId, provider, startedAt])
  @@index([provider, kind, status, startedAt])
}
```

### Контракт B — сервис записи `IntegrationSyncLogService`

Новый лёгкий модуль `backend/src/modules/integrations-observability/`:
- `integration-sync-log.service.ts` — `begin(meta) → runId`, `succeed(runId, counts?)`, `fail(runId, error)`,
  `skip(runId)`; всё **best-effort** (любая ошибка записи логируется в pino и НЕ роняет синк).
- `integration-sync-log.module.ts` — экспортирует сервис; импортируется в `BitrixModule` и `ChatboxModule`.
- Зависит от `PrismaService` (global PrismaModule).

Точки записи (оборачиваем `process()` воркеров, не ломая существующую логику):
- `bitrix-sync.worker.ts` → kind=`sync`, scope из job, counts = результат `syncByScope`.
- `chatbox-sync.worker.ts` → kind=`sync`, scope (`incremental`/scope), counts = результат.
- `bitrix-analyze.worker.ts` → kind=`analyze`, refId=sessionId, counts = `{ rawEventId }`; `skipped` если сессия ещё открыта.
- `chatbox-analyze.worker.ts` → kind=`analyze`, refId=sessionId.

### Контракт C — включить трекинг существующих кронов (закрыть дыру №1)

**Критично:** добавить явный `{ name: '<ClassName.method>' }` в 4 декоратора `@Cron`
(`bitrix-sync.cron.ts`, `chatbox-sync.cron.ts`, `bitrix-analyze.cron.ts`, `chatbox-analyze.cron.ts`),
имя = текущему fallback (`BitrixSyncCron.runDaily` и т.д.). Без этого `applyToScheduler.deleteCronJob(name)`
промахивается по безымянному джобу → обёрнутая копия крутится **в дополнение** к оригиналу → двойной синк.

Затем seed-скрипт `backend/scripts/seed-integration-crons.ts` — upsert строк в `CronSchedule`
для этих 4 имён (expression `0 0 * * *`, enabled true, description). После деплоя (рестарт) `applyOverridesFromDb`
оборачивает их в `runWrapped` → пишется `CronRunHistory` + `lastRunAt`. Регистрируется в `apply-prod-deploy.ts STEPS` (phase=update, skipBootstrap=false).

### Контракт D — зарегистрировать очереди (закрыть дыру №2)

Экспортировать `BITRIX_QUEUE_NAMES` / `CHATBOX_QUEUE_NAMES` (index `queues.ts` в каждом модуле)
и добавить их в `WorkersAdminService.getKnownQueueNames()`. Очереди `bitrix.*`/`chatbox.*` появятся в текущей админ-панели воркеров (counts + failed/completed).

### Контракт E — Admin API

Новый `modules/admin/integrations/admin-integrations.controller.ts` под `CookieAuthGuard + SuperAdminGuard`,
префикс `/api/v1/admin/integrations`:
- `GET /overview` → агрегат по всем org: provider, status, lastFullSyncAt/lastIncrementalSyncAt, lastError,
  счётчики прогонов за сегодня (success/failed/running) по kind. Это «Состояние источников».
- `GET /sync-runs?provider=&tenantId=&kind=&status=&limit=&cursor=` → пагинированная история `IntegrationSyncRun`.
Сервис `AdminIntegrationsService` + Zod-DTO + `SuperAdminAuditInterceptor`.

### Контракт F — Retention

Daily-cron `IntegrationSyncLogPruneCron.run` (`0 4 * * *`, явный `name`), удаляет `IntegrationSyncRun`
старше 90 дней. Seed строки в `CronSchedule` (тем же скриптом C) → тоже трекается.

### Контракт G — Frontend

Admin-страница «Состояние источников» в route-группе `(admin)`:
слой `api/admin-integrations.api.ts` → `domain/admin-integration.ts` → UI-таблица (org × provider: статус,
последний синк, результат последнего прогона, ошибки; разворот — последние N прогонов). SWR.

## Фазы

- [ ] Ф1. Prisma-модель `IntegrationSyncRun` + миграция + `prisma:generate`.
- [ ] Ф2. `IntegrationSyncLogService` + модуль; подключить в Bitrix/Chatbox модули.
- [ ] Ф3. Врезать запись в 4 воркера (sync×2, analyze×2).
- [ ] Ф4. Явные `name` в 4 `@Cron` + seed-скрипт `seed-integration-crons.ts` + регистрация в `apply-prod-deploy.ts`.
- [ ] Ф5. `getKnownQueueNames()` += bitrix/chatbox очереди.
- [ ] Ф6. Admin API `/admin/integrations` (overview + sync-runs) + DTO + сервис.
- [ ] Ф7. Retention prune-cron + seed-строка.
- [ ] Ф8. Frontend-страница «Состояние источников».
- [ ] Ф9. typecheck/lint/build back+front; обновить second-brain + prod-deploy-log + рефлексия.

## Итог
(заполнить по завершении)

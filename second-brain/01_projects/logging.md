# Технические логи в БД (LoggingModule)

> Статус: **работает** (2026-06-01; расширен 2026-06-03 — процессные контуры + мост Nest Logger + вид «Цепочка»).
> Планы: [2026-06-01-logging-module.md](../../plans/tz/2026-06-01-logging-module.md), [2026-06-03-logging-pipelines-coverage.md](../../plans/tz/2026-06-03-logging-pipelines-coverage.md).

## Что это
Централизованное **операционное** логирование приложения в Postgres (модель `SystemLog`),
управляемое в реальном времени без рестарта, с админ-UI (`/admin/logs`, только super_admin).

**Это НЕ audit trail.** Бизнес-аудит действий super_admin — отдельная вечная сущность
`SuperAdminAccessLog` (см. [[admin]] / журнал). `SystemLog` — диагностика с ретеншеном (автоудаление),
намеренно без FK: `userId`/`orgId` — «мягкие» строки-ссылки.

## Ключевые принципы
- **Best-effort**: `LogService.write()` обёрнут в try/catch — никогда не ломает бизнес-операцию.
- **Не на горячем пути БД**: записи копятся в in-memory буфере и пишутся пачками (`createMany`).
  Настройки читаются синхронно из кэша (без обращения к БД на каждый лог).
- **Маскирование**: секреты (password/token/cookie/authorization/cvv/passport/snils/jwt/livekit/hmac…)
  рекурсивно → `[REDACTED]`; payload усекается (`capPayloadSize`, лимит ~16KB).
- **Runtime-управление**: env-дефолты `LOG_DB_*` при старте → переопределяются super-админом через PATCH;
  подхват с других инстансов — перечит из БД каждые 30с.
- **Multi-instance**: cleanup защищён `pg_try_advisory_lock` (single-flight на флот); у каждой записи `instanceId = host:pid`.

## Backend (`backend/src/modules/logging/`)
- `log.constants.ts` — типы, `LOG_LEVEL_ORDER`, `normalizeLoggingSettings`, `WriteLogInput`.
- `log-sanitizer.ts` — `sanitizePayload` + `capPayloadSize`.
- `log-settings.service.ts` — кэш настроек (`PlatformSetting[logging_settings]`) + reload(30с) + `applyUpdate`.
- `log-buffer.service.ts` — буфер; overflow дропает наименее важные (DEBUG/INFO/WARN), ERROR/FATAL выживают;
  flush по таймеру/`batchSize`/shutdown; re-buffer при ошибке БД.
- `log.service.ts` — `write/debug/info/warn/error/fatal/business/security` + чтение (`list/getById/aggregates`)
  + чистые `buildLogWhere`/`expandLevelAtLeast`.
- `request-context.service.ts` (+ `request-context.middleware.ts`) — `AsyncLocalStorage` (ленивые геттеры
  userId/orgId по `req`, т.к. guard'ы заполняют их позже middleware).
- `db-logger.bridge.ts` (2026-06-03) — **мост Nest `Logger` → БД**. Подключается в `main.ts`
  через `app.useLogger(app.get(DbLoggerBridge))` (+ `bufferLogs:true`). Любой `this.logger.*` по
  всему бэкенду (включая воркеры/кроны) дублируется в `SystemLog` (контекст логгера → `module`,
  `pipeline`/`traceId` подмешиваются из ALS). Нормализует pino-стиль `(obj, 'msg')`. Анти-петля:
  игнорирует внутренние логгеры LoggingModule + фреймворковые контексты Nest.
- `log-pipeline.ts` (2026-06-03) — `traceFor*` (mtg/org/user/doc/...), `deriveTraceFromJob`,
  `withPipelineJob`/`withPipeline` и инъектируемый **`PipelineRunner`** (методы `run`/`meeting`/`job`/`with`).
  Воркеры одной строкой оборачивают handler в pipeline-контекст (property-injection `@Inject(PipelineRunner)`).
- `log-stream.gateway.ts` (2026-06-03) — **`LogStreamGateway`**, Socket.IO namespace `/ws/platform-logs`
  (только super_admin: JWT-handshake + сессия + `User.isSuperAdmin`, как у REST). После flush'а буфера
  пушит пачку записей событием `logs` в room `platform-logs`. `LogBufferService` дергает `stream.broadcast(batch)`
  (property-injection, best-effort). Чтобы стрим совпадал с БД, `LogService.write` проставляет явные `id`+`createdAt`.
- `request-logging.interceptor.ts` — **отключён 2026-06-03** (D3: HTTP-логи «не нужны»). Код оставлен,
  но НЕ регистрируется в `LoggingModule`. **4xx/5xx пишет `AllExceptionsFilter`** (через `@Optional() LogService`).
- `log-cleanup.service.ts` — ретеншен: `setInterval` 1ч + ручной; advisory-lock; удаление батчами по 5000.
- `dto/system-logs.dto.ts` — Zod (не class-validator); boolean — `zFlexBool`.
- `system-logs.controller.ts` — `/api/v1/platform/logs[/aggregates|/settings|/cleanup|/:id]`, `@UseGuards(CookieAuthGuard, SuperAdminGuard)`.
- `logging.module.ts` — `@Global`.

Подключение: `AppModule.imports += LoggingModule`; `RequestContextMiddleware` — после `RequestIdMiddleware`, до `TenantMiddleware`.

## Два измерения контуров
- **`contour`** — зона доступа/роль (адаптация домена Коры): `GUEST / MEMBER / ORG_ADMIN / SUPERADMIN / PLATFORM / PUBLIC / SYSTEM`.
- **`pipeline`** (enum `SystemLogPipeline`, 2026-06-03) — **процессная цепочка** сквозь модули:
  `MEETING_LIFECYCLE / RECORDING / TRANSCRIPTION / AI_ANALYSIS / KNOWLEDGE_GRAPH / NOTIFICATIONS /
  AUTH / BILLING / INTEGRATIONS / ONBOARDING / ADMIN / SCHEDULER / SYSTEM`.
- **`traceId`** — корреляция одной цепочки. Для встречи `mtg_<meetingId>` на всех стадиях
  (webhook → запись/S3 → транскрипция → AI → KC-отчёты) → вся цепочка одного действия видна разом.
  Для прочих воркеров `deriveTraceFromJob` берёт якорь из payload (block/card/entity/person/...).

Инструментованы: livekit-вебхуки (старт цепочки) + 14 воркеров meeting-конвейера (ai + kc) с `mtg_`-traceId,
+ 34 воркера прочих контуров (knowledge-graph / notifications / integrations / ...) через `PipelineRunner.job`.
Остальные `this.logger.*` по приложению попадают в БД через мост (без pipeline/traceId, но с module/level/message).

## Frontend
- `src/domain/system-logs.ts` (ApiDto + mappers), `src/api/admin-logs.api.ts` (`logsApi`).
- `app/(admin)/admin/logs/` (`page.tsx` + `LogsClient.tsx`): период (Segmented) + stat-карточки +
  топ модулей + **разрез «по контурам»** + фильтры (включая «Контур (процесс)») + серверная таблица
  (колонки Контур/Цепочка) + Drawer деталей + **Drawer «Цепочка»** (timeline по `traceId`) + Drawer настроек.
- Эндпоинт цепочки: `GET /api/v1/platform/logs/chain?traceId=` (все записи по времени asc).
- **Live-режим (2026-06-03):** тумблер «● Live» → хук `useLogStream` (`src/hooks/admin/useLogStream.ts`)
  подключается к `/ws/platform-logs`; входящие логи фильтруются клиентски (`matchesFilters`) и
  префиксуются в таблицу (дедуп по id, cap 300). Поллинг не используется.
- Footgun: `dateFrom` мемоизирован по `period` (иначе беск. рефетч → 429).

См. также: [[../02_architecture/data-model|data-model]], [[../02_architecture/module-map|module-map]], [[api-layer]], [[frontend-pages]].

[[../index|← index]]

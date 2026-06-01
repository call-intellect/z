# Технические логи в БД (LoggingModule)

> Статус: **работает** (2026-06-01). План: [plans/tz/2026-06-01-logging-module.md](../../plans/tz/2026-06-01-logging-module.md).

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
- `request-logging.interceptor.ts` — глобальный (APP_INTERCEPTOR): пишет успешные/медленные запросы.
  **4xx/5xx пишет `AllExceptionsFilter`** (через `@Optional() LogService`) — нет двойной записи.
- `log-cleanup.service.ts` — ретеншен: `setInterval` 1ч + ручной; advisory-lock; удаление батчами по 5000.
- `dto/system-logs.dto.ts` — Zod (не class-validator); boolean — `zFlexBool`.
- `system-logs.controller.ts` — `/api/v1/platform/logs[/aggregates|/settings|/cleanup|/:id]`, `@UseGuards(CookieAuthGuard, SuperAdminGuard)`.
- `logging.module.ts` — `@Global`.

Подключение: `AppModule.imports += LoggingModule`; `RequestContextMiddleware` — после `RequestIdMiddleware`, до `TenantMiddleware`.

## Контуры (адаптация домена Коры)
`GUEST / MEMBER / ORG_ADMIN / SUPERADMIN / PLATFORM / PUBLIC / SYSTEM`. Soft-ref: `orgId` (= tenantId).

## Frontend
- `src/domain/system-logs.ts` (ApiDto + mappers), `src/api/admin-logs.api.ts` (`logsApi`).
- `app/(admin)/admin/logs/` (`page.tsx` + `LogsClient.tsx`): период (Segmented) + 4 stat-карточки +
  топ модулей/endpoint'ов + фильтры + серверная таблица + Drawer деталей + Drawer настроек.
- Footgun: `dateFrom` мемоизирован по `period` (иначе беск. рефетч → 429).

См. также: [[../02_architecture/data-model|data-model]], [[../02_architecture/module-map|module-map]], [[api-layer]], [[frontend-pages]].

[[../index|← index]]

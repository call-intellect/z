# ТЗ: Модуль технического логирования в БД (LoggingModule)

Дата: 2026-06-01. Ветка: `logSystem`.

## Цель
Централизованный модуль логирования приложения: пишет технические логи в Postgres,
управляется в реальном времени (вкл/выкл и параметры — без рестарта), имеет админ-UI
с поиском/фильтрацией/агрегатами/настройками. Только SUPER_ADMIN.

## Адаптация спецификации под Кору (расхождения с исходным ТЗ)
- **Валидация**: проект на **Zod-DTO (nestjs-zod)** + `GlobalZodValidationPipe`, НЕ class-validator.
  Все DTO — на Zod (boolean-footgun решается кастомной `zBool`-схемой, как в `env.schema.ts`).
- **Prisma**: только `bun run prisma:push`, НЕ `prisma migrate*` (правило репо).
- **Домен**: не клубы/игроки, а orgs/tenancy. Контуры: `GUEST/MEMBER/ORG_ADMIN/SUPERADMIN/PLATFORM/PUBLIC/SYSTEM`.
  Soft-ref: `userId` + `orgId` (вместо `clubId/playerId`).
- **Фронт**: Next.js App Router + Radix + Tailwind + **SWR** (НЕ Ant Design/React Query).
  Слой `logs.api.ts → domain → page` в `app/(admin)/admin/logs`.
- **Request-context**: переиспользуем `req.id` (`RequestIdMiddleware`); добавляем лёгкий
  `RequestContextService` на `AsyncLocalStorage` для чтения userId/requestId/route на горячем пути.
- **Impersonation**: механизма в проекте нет — пункт «заблокировать в impersonation» неприменим (фиксируется).

## Фазы
- [x] Ф0. Разведка конвенций (guards, фильтр, env, DTO, фронт).
- [x] Ф1. Prisma: enum'ы `SystemLogLevel/Category/Contour` + `SystemLog` + `PlatformSetting`; `prisma:push` + `generate`.
- [x] Ф2. ENV: `LoggingSchema` в `env.schema.ts` + getter `cfg.logging` в `TypedConfigService`.
- [x] Ф3. `log.constants.ts` + `log-sanitizer.ts`.
- [x] Ф4. `request-context.service.ts` (ALS) + `request-context.middleware.ts`.
- [x] Ф5. `log-settings.service.ts` + `log-buffer.service.ts` + `log.service.ts`.
- [x] Ф6. `request-logging.interceptor.ts` + `log-cleanup.service.ts` + `dto/system-logs.dto.ts` + `system-logs.controller.ts` + `logging.module.ts`.
- [x] Ф7. Интеграция: `AllExceptionsFilter` (`@Optional() LogService`) + подключение в `AppModule` (+ `RequestContextMiddleware`).
- [x] Ф8. Фронт: `admin-logs.api.ts` + `domain/system-logs.ts` + страница `app/(admin)/admin/logs` + пункт навигации.
- [x] Ф9. Юнит-тесты: 28 проходят (normalize, sanitizer, buffer overflow/flush/re-buffer, buildLogWhere/expandLevelAtLeast).
- [x] Ф10. backend tsc/lint (0 errors) + frontend tsc/lint чисто; second-brain обновлён.

## Итог
**Реализовано целиком.** Бэкенд-модуль `backend/src/modules/logging/` (10 файлов + dto + 4 spec),
интеграция в `AllExceptionsFilter` и `AppModule`, фронт-страница `/admin/logs`.
Проверки: `bunx tsc --noEmit` (back+front) чисто, eslint 0 errors, `vitest run src/modules/logging` — 28/28.

### Отклонения от исходного ТЗ (адаптация под Кору)
- DTO на **Zod** (а не class-validator); boolean — кастомный `zFlexBool`.
- Prisma — **`db push`** (а не `migrate dev`).
- Домен: контуры `GUEST/MEMBER/ORG_ADMIN/SUPERADMIN/PLATFORM/PUBLIC/SYSTEM`; soft-ref `orgId` (не clubId/playerId).
- Фронт — **SWR-подобный `useAdminQuery` + Radix/Tailwind/shadcn** (не Ant Design/React Query).
- Impersonation-блокировка не реализована — механизма impersonation в проекте нет.

### Prod-операции при выкате
- **ENV (Шаг 1)**: новые `LOG_DB_*` (все имеют дефолты — не обязательны).
- **Схема (Шаг 4)**: `bun run prisma:push` создаёт `SystemLog` + `PlatformSetting` + enum'ы + 9 индексов.
- Seed/patch/backfill — **нет**. Cleanup-ретеншен — внутренний `setInterval` (не cron-процесс).

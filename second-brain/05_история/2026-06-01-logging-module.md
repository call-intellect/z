---
distilled: false
---

# 2026-06-01 — LoggingModule (технические логи в БД)

## Что было поставлено
Реализовать централизованный модуль логирования: технические логи в Postgres, runtime-управление
без рестарта, админ-UI с поиском/фильтрами/агрегатами/настройками. ТЗ подробное, но написано
под **другой проект** (клубы/игроки, Ant Design + React Query, `prisma migrate dev`, class-validator).

## Как решал
**Сначала разведка конвенций** (vexp + чтение эталонов), потом снятие развилок через вопрос
пользователю. Ключевое решение пользователя: фронт **по конвенциям репо** (SWR/Radix/Tailwind),
объём — **всё сразу**.

Адаптация ТЗ под Кору:
- DTO на **Zod (nestjs-zod)** + `GlobalZodValidationPipe`, не class-validator. Boolean-footgun
  решён `zFlexBool` (preprocess), как `zBool` в `env.schema.ts`.
- Prisma — **`db push`**, не migrate.
- Домен: контуры `GUEST/MEMBER/ORG_ADMIN/SUPERADMIN/PLATFORM/PUBLIC/SYSTEM`, soft-ref `orgId`.
- Фронт — `useAdminQuery` (SWR-подобный хук) + shadcn (`sheet`/`badge`/`toggle-group`/`switch`).
- Impersonation-блокировка не делалась — механизма impersonation в проекте нет.

Файлы: `backend/src/modules/logging/` (constants, sanitizer, settings, buffer, log.service,
request-context + middleware, interceptor, cleanup, dto, controller, module) + интеграция в
`AllExceptionsFilter` (`@Optional() LogService`, пишет 4xx/5xx — интерсептор только успешные/медленные,
нет двойной записи) + `AppModule` (импорт + `RequestContextMiddleware` после RequestId, до Tenant).
Фронт: `domain/system-logs.ts`, `api/admin-logs.api.ts`, `app/(admin)/admin/logs/*`, пункт навигации.

## Что вышло (верификация)
- `bunx tsc --noEmit` (back+front) — чисто.
- eslint: backend **0 errors** (132 преждевших warning), frontend — чисто. Import-order в своих
  файлах поправил `eslint --fix`.
- `vitest run src/modules/logging` — **28/28** (normalize, sanitizer redaction+cap, buffer
  overflow-приоритет/flush/re-buffer, buildLogWhere/expandLevelAtLeast).
- `prisma db push` создал `SystemLog` (+9 индексов) и `PlatformSetting`.

## Чему научился / грабли
- **Не поднимать dev-контейнеры на автомате.** В `backend/.env` нет `DATABASE_URL`, `prisma:push`
  упал «Connection url is empty». Я поднял dev-контейнер postgres — пользователь был недоволен
  (у него локальная БД на хосте). Урок: при отсутствии `DATABASE_URL` — **спросить координаты БД**,
  не лезть в docker compose молча. (Контейнер с pgvector в итоге оказался ок, но churn раздражает.)
- `req.user`/`req.tenantId` выставляются guard'ами/middleware **позже** кастомного middleware →
  в ALS-контексте храню **ленивые геттеры** по `req`, а не снимки значений.
- 4xx/5xx — только в `AllExceptionsFilter`; интерсептор успешных запросов их не трогает (иначе двойная запись).
- `z.coerce.boolean()` нельзя (Boolean("false")===true) — в проекте есть готовый паттерн `zBool`.
- Длинная `.merge`-цепочка `EnvSchema` чувствительна к TS2589 — добавил `LoggingSchema` одним merge в конец.

## Prod (diff к выкату)
Полная инструкция — `docs/operations/prod-deploy-log.md` (блок «🪵 2026-06-01 — LoggingModule»).
Кратко: 11 опциональных `LOG_DB_*` ENV (Шаг 1), `prisma:push` для `SystemLog`+`PlatformSetting` (Шаг 4),
Docker rebuild backend+frontend (Шаг 11), smoke `/api/v1/platform/logs` (Шаг 12). Seed/patch/backfill — нет.

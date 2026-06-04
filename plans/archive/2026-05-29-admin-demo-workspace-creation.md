# ТЗ: создание демо-кабинета из админки (Z-Admin)

**Дата:** 2026-05-29
**Статус:** реализовано (Фазы 1–3), docs/second-brain — частично

## Зачем

Сейчас демо-кабинет «ТехноСтрим» создаётся только: (а) owner'ом через `/onboarding/demo-choice`, (б) CLI `seed-demo-workspace.ts`, (в) API `POST /orgs/:orgId/demo-workspace` с cookie owner'а. Нужна возможность super-admin'у создавать/сбрасывать демо для **любой** Org прямо из Z-Admin, без логина под owner'ом и без CLI.

## Что уже есть (переиспользуем)

- `OnboardingService.seedDemoWorkspace(tenantId, ownerUserId)` и `resetDemoWorkspace` — вся логика заливки/сброса (см. `backend/src/modules/onboarding/onboarding.service.ts`, билдеры `demo-data/*`).
- Флаг `Org.demoWorkspaceSeededAt` — идемпотентность.
- Admin-модуль с super-admin guard и audit-interceptor (`backend/src/modules/admin/*`).

## Фазы

### Фаза 1 — Backend: admin-эндпоинты `[x]`
Готово: `AdminDemoController` (`backend/src/modules/admin/controllers/admin-demo.controller.ts`) — `GET /api/v1/admin/demo/orgs`, `POST .../:orgId/seed`, `POST .../:orgId/reset`, под `CookieAuthGuard + SuperAdminGuard + SuperAdminAuditInterceptor`. `OnboardingModule` добавлен в imports admin.module. seed берёт ownerId Org автоматически.
- Новый контроллер `admin/demo` (или метод в существующем admin-контроллере), под super-admin guard + `SuperAdminAuditInterceptor`.
- `GET  /api/v1/admin/demo/orgs` — список Org с полями `{ id, name, demoWorkspaceSeededAt, ownerUserId }` для выпадашки.
- `POST /api/v1/admin/demo/orgs/:orgId/seed` — вызвать `OnboardingService.seedDemoWorkspace(orgId, ownerUserId)`. ownerUserId берём из owner'а Org (а не из текущего admin'а).
- `POST /api/v1/admin/demo/orgs/:orgId/reset` — `resetDemoWorkspace`.
- Zod-DTO + Swagger-теги, как требует nestjs-rules.

### Фаза 2 — Frontend: api-слой `[x]`
Готово: `frontend/src/api/admin-demo.api.ts` (`adminDemoApi.listOrgs/seed/reset`) через единый `apiClient`. Отдельный маппер в DomainModel не нужен (плоский ответ).

### Фаза 3 — Frontend: страница `/admin/demo` `[x]`
Готово: `app/(authenticated)/admin/demo/{page,DemoClient}.tsx` — список Org с бейджем «демо залито» (по `demoSeededAt`), кнопки «Создать/Перезалить демо» и «Сбросить» (с confirm), loading/toast. Пункт «Демо-кабинеты» добавлен в `navigation.ts` (раздел «Тенанты»).

### Фаза 4 — Проверка + docs `[x]` (частично)
- `bunx tsc --noEmit` (backend 0 ошибок) и `bun run typecheck` (frontend — мои файлы чисты; 2 пре-существующие ошибки Paywall не связаны).
- `docs/guides/demo-workspace.md` уже упоминает Способ Б.
- ОСТАЛОСЬ: `second-brain/01_projects/admin.md` + `api-layer.md` — обновить при push (триггер рефлексии).

## Открытые решения

1. **Кто может создавать** — только super-admin (`isSuperAdmin`)? (предлагаю да).
2. **ownerUserId для seed** — owner Org автоматически, или выбор из участников? (предлагаю owner автоматически).

## Итог

Реализовано: backend (super-admin эндпоинты) + frontend (`/admin/demo`). Осталось: обновить second-brain (`admin.md`, `api-layer.md`) и ручная проверка на проде. Решения 1–2 — приняты дефолты (super-admin only; ownerId Org автоматически).

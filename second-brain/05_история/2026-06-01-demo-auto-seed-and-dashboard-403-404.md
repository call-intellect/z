---
title: Авто-сидинг демо при регистрации + авто-cleanup при оплате + фикс 403/404 дашборда
date: 2026-06-01
type: reflection
distilled: false
references:
  - plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md
---

# Авто-сидинг демо + фикс 403/404 дашборда

## Что было поставлено

Баг-репорт с прода: после регистрации должен включаться демо-режим с синтетическими данными «ТехноСтрим», после оплаты тарифа кабинет должен очищаться. На проде не работает + куча ошибок в консоли (403 на `/dashboard/*`, 404 на `/me/commitments` и `/settings/templates`, WS-таймауты `tracker-ws`).

## Диагностика (4 независимые проблемы)

1. **403 на дашборде** — корень не в RBAC и не в entitlement, а в **порядке guard'ов**: глобальные `SubscriptionGuard`/`EntitlementGuard` бегут ДО контроллерного `TenantGuard`. `req.tenantId` им ставит `TenantMiddleware`, который читает tenant **только** из `X-Org-Id`/`:orgId`/body. Эндпоинты `/api/v1/dashboard/*` не имеют `:orgId` в пути, а `dashboard.api.ts` **не слал `X-Org-Id`** (в отличие от goals/tracker/privacy, использующих `orgHeaders(orgId)`). → `EntitlementGuard` падал с 403 `tenant_required`. Single-org fallback в `TenantGuard` недостижим, т.к. он позже по цепочке.
2. **404** — мёртвые ссылки: KPI «Обещания» вёл на несуществующий `/me/commitments` (есть `/me/promises`); сайдбар «Шаблоны» на `/settings/templates` (есть `/team-templates`).
3. **Демо не заливается/не чистится** — ТЗ `2026-05-31-demo-auto-seed-and-cleanup` был `status: draft`, **не реализован**: воркеров/listener нет, `completeWelcome` не ставит job, `welcome/complete` отсутствует, осиротевший `demo-choice` ещё на месте (хотя step-6 уже редиректил мимо него на `/dashboard`).
4. **tracker-ws timeout** — наш socket.io-клиент (`useTrackerWebSocket.ts`) не достукивается до WS-gateway на проде. Инфра (nginx не проксирует WS), не код. **Отложено по решению владельца.**

## Как решал

**A (403):** `dashboard.api.ts` — каждый метод принимает `orgId` и шлёт `orgHeaders(orgId)`. 4 консьюмера (`DirectorDashboardClient`, `TeamsListClient`, `TeamDetailClient`, `TeamHealthGrid`) берут `currentOrgId` из `useAuth()` и гардят запрос до его готовности.

**B (404):** правка href в `DirectorDashboardClient.tsx`, `Sidebar.tsx`, `nav-help.ts`.

**C (демо):** реализовал ТЗ Фазы 1–5 по паттерну `feedback-digest.queue/worker` (`new Queue/Worker` в `OnModuleInit`):
- `workers/demo-seed.{queue,worker}.ts` (concurrency 2, precondition `Subscription.status==='DEMO'`), `workers/demo-cleanup.{queue,worker}.ts` (concurrency 1, `no_demo_to_reset`=success-skip).
- `listeners/subscription-activated.listener.ts` (`@OnEvent` на `_PAID`/`_BONUS`, фильтр `demoWorkspaceSeededAt`).
- `OnboardingService.completeWelcome` ставит seed-job + `redirectTo='/onboarding/welcome/complete'`; `getDemoSeedStatus` + `GET /orgs/:orgId/demo-seed-status`.
- `OnboardingModule` импортирует `BillingModule`, регистрирует 4 провайдера + listener.
- Frontend: удалён `demo-choice`, добавлен loading-экран `welcome/complete` (polling 700 мс, таймаут 60 с), `onboardingApi.getDemoSeedStatus`.

## Что вышло (верификация)

- backend + frontend: `typecheck` / `lint` (0 errors) / `build` — зелёные.
- Unit: `subscription-activated.listener.spec` (5) + `onboarding.service.spec` (3) — зелёные.
- E2E на живом стенде — не выполнен локально (нет поднятых Postgres+Redis+LiveKit), уйдёт на прод по smoke-чек-листу.

## Чему научился

1. **403 `tenant_required` на эндпоинте без `:orgId` ⇒ почти всегда фронт забыл `X-Org-Id`.** Глобальные guard'ы видят tenant только из `TenantMiddleware`, а тот — только из header/url/body. Контроллерный `TenantGuard` (с single-org fallback) бежит ПОЗЖЕ и не спасает. Правило: любой tenant-scoped API без `:orgId` в пути обязан слать `orgHeaders(orgId)`.
2. **`bun install` + `prisma generate` — обязательны после чистого чекаута**: typecheck падал «Cannot find module react/jsx-runtime» и «@prisma/client has no exported member» — это отсутствующие node_modules / несгенерированный клиент, а не реальные ошибки.
3. **vitest forks-pool роняется на импорте `bullmq`** в этом WSL2-окружении — baseline `recognition-formulate.worker.spec` падает так же. Решение для своих спеков: `vi.mock('bullmq', () => ({ Queue: class {}, Worker: class {} }))`.
4. **В Z нет отдельного worker-процесса** — `src/workers/main.ts` из CLAUDE.md не существует, всё бутстрапится из `src/main.ts`. Воркеры (`@Injectable` + `new Worker()` в `OnModuleInit`) поднимаются вместе с HTTP. Значит queue+worker провайдеры одного модуля работают в одном процессе.

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

## Добивка: fallback пустого DEMO-кабинета (тот же день)

Запрос владельца после первого пуша: «если кабинет в DEMO, а синтетики нет — заполнять». Это закрывает старые DEMO-Org (до выката авто-сидинга, которые по ТЗ решили не бэкфилить) и неудавшийся seed.

- Backend: `POST /orgs/:orgId/demo-workspace/ensure` + `OnboardingService.ensureDemoSeed` (инжектнул `SubscriptionService`). Идемпотентно: enqueue только при `status==='DEMO' && !demoWorkspaceSeededAt && нет активного job'а`. `DemoSeedQueue.ensure` снимает `completed`/`failed` job перед повторной постановкой — иначе `queue.add` с тем же jobId = no-op (BullMQ не перезапускает завершённый job).
- Frontend: триггер в `SubscriptionContext` (знает `status`, грузится на каждой авторизованной странице) — один раз за монтирование при DEMO; при `enqueued=true` поллит статус и один раз `window.location.reload()` с готовыми данными.

**Урок:** `queue.add(name, data, {jobId})` на существующий (даже `completed`/`failed`) job — **no-op**, не перезапуск. Для повторной постановки нужно сначала `job.remove()`. Это ловушка идемпотентности BullMQ: jobId защищает от дублей, но и блокирует ретрай вручную.

## Продолжение сессии: дашборды, устойчивый сидинг, nginx, патч-скрипты

**1. «Пропавшие дашборды» начальника — были на невлитой ветке.** Начальник жаловался, что свежие дашборды «исчезли». На деле работа (ТЗ `2026-06-01-dashboards-wow-polish`, owner sergrv80) целиком жила на `origin/feature/dashboards-wow-polish` и **никогда не вливалась в dev**. **Урок:** на «X пропал/его нет» — первым делом `git branch -a` + `git log --all --oneline`, а не поиск удаления в мерже. Влил ветку (49 файлов: cinema-режим DirectorDashboard, библиотека `charts/`, полировка всех виджетов, dead-routes). Конфликт только в `DirectorDashboardClient` — разрешил через `git checkout --theirs` + повторное наложение моих 3 фиксов (X-Org-Id ×2 + /me/promises). **Урок:** при тяжёлом конфликте в одном файле, где «их» версия — крупная переработка, надёжнее взять theirs целиком и заново наложить свои точечные правки, чем руками склеивать hunk'и.

**2. Устойчивый демо-сидинг (не зависит от BullMQ).** 500 на `/demo-workspace/ensure` я не смог доroot-causить без прод-лога (локально Prisma-поля, DI-цикл, Redis-конфиг, tenantId@unique — всё чисто). Решение: `triggerDemoSeed` — очередь, при сбое **fallback на прямой фоновый `seedDemoWorkspace`** (in-process `Set`-лок от дублей; прод = один backend-контейнер). Бонус: если падает не очередь, а сам seed — теперь видно в логе `demo-seed inline: упал` + stack. **Урок:** когда корень не виден без прод-доступа — делай фикс, устойчивый ко всем гипотезам сразу, и заодно выводящий настоящую ошибку в лог.

**3. Легаси патч-скрипты отстали от схемы и валили `apply-prod-deploy`.** `patch-clones-role-versioning` джойнил `"Role"`, а таблица замаплена в `"roles"` (@@map); `patch-clones-dataclass-update` использовал удалённую `ExecutablePersona.dataClass`; `patch-backfill-dataclass-audit` падал на `insight` без колонки `dataClassAudit`. Починил самопроверкой через `_lib/schema-guards.ts` (`tableExists`/`columnExists`) + try/catch per-model. **Урок:** одноразовые backfill-скрипты, оставшиеся в агрегаторе выката, надо защищать guard'ами — схема уезжает вперёд, а они гоняются на каждом `--mode update`.

**4. nginx + socket.io namespace.** `wss://.../socket.io/` падал, потому что попадал в `location /` → frontend (3001). Gateways используют socket.io **namespaces** (`/ws/tracker`, `/ws/voice`, `/ws/feed`), но это часть socket.io-протокола, **не URL** — транспортный путь для всех один: `/socket.io/`. Добавил `location /socket.io/` → backend + `map $connection_upgrade`. **Урок:** socket.io namespace ≠ path; nginx проксирует один `/socket.io/`, namespace-роутинг — внутри.

**5. `/me/pulse` — последняя дыра pulse-full.** Собрал переиспользованием `PersonPulseClient` (резолв своего personId через `/me/profile`; backend уже авторизует self-view) + пункт меню. `/me/privacy` оказался не дырой (подстраницы access-log + consents готовы).

**Сводный итог дня:** демо-флоу (seed+cleanup+fallback), фикс 403/404, мерж дашбордов начальника, устойчивый сидинг, 3 патч-скрипта, nginx WS, /me/pulse. Всё в `dev`, ждёт одного передеплоя. Открытый хвост: настоящая причина 500 на `ensure` (нужен прод-лог `ensureDemoSeed: fallback`/`demo-seed inline: упал`).

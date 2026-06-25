---
title: Wizard «Знакомство с компанией»
phase: 0c
status: done
date: 2026-05-21
references:
  - plans/archive/2026-05-21-phase-0c-onboarding-wizard-frontend.md
  - plans/analysis/2026-05-21-user-cabinet-design.md §8, §13
---

# Wizard «Знакомство с компанией»

## Что это
Онбординг делится на два независимых блока (оба в проде):
- **Блок A — «Знакомство», 6 шагов.** URL `/onboarding/welcome/step-{1..6}` — первый вход любого пользователя (редирект из `AuthenticatedShell` при `profileCompletedAt = null`). Шаг 6 → `POST /api/v1/orgs/:orgId/welcome/complete` → создаёт документ «Знакомство», ставит `welcomeCompletedAt`/`profileCompletedAt`, возвращает `{ redirectTo: '/dashboard' }`. Подробности — в hub-секции про shared-demo-org-model ниже.
- **Блок B — wizard «Знакомство с компанией», 5 шагов** (этот документ ниже). URL `/onboarding/company/step-{1..5}`, owner-only, открывается позже с дашборда; завершается `POST /api/v1/orgs/:orgId/setup/complete`.

Ниже описан Блок B — 5-шаговый wizard owner'а по структуре компании. AppShell скрыт (см. `AuthenticatedShell.tsx`).

## Шаги
1. **Отделы** — POST /api/v1/departments по одному или /batch.
2. **Должности** — POST /api/v1/roles (с departmentId).
3. **Сотрудники** — POST /api/v1/persons (с roleId, primaryDepartmentId). userId=null до accept'а приглашения.
4. **Должностные инструкции** — для каждой Role drag-drop файл → POST /api/v1/documents (attachedRoleId=roleId). Опционально.
5. **Готово** — GET /api/v1/structure/summary, переход на /dashboard.

## Состояния
- Гард: только owner. Если `Department.count > 0` — redirect /dashboard.
- Прерывание: кнопка в layout, возвращает на /dashboard с баннером «Незавершённое знакомство».
- Однократность: после прохождения wizard'а доступ к нему запрещён (Department.count > 0).

## Edge cases
- Wizard падает посреди step-3 (7 сотрудников создано из 10) → возвращается, видит 7 в форме, продолжает.
- Owner создал отделы, не дошёл до шага 4 → виджет «Незавершённое знакомство» на дашборде, ведёт на актуальный шаг.

## Не входит в Фазу 0
- CSV-импорт сотрудников (γ).
- Шаблоны индустрий.
- Прохождение admin'ом без owner'а.

## Shared эталонная демо-Org «Демо: ТехноСтрим» (ТЗ 2026-06-01)

Источник: [`plans/archive/2026-06-01-demo-shared-org-model.md`](../../plans/archive/2026-06-01-demo-shared-org-model.md), анализ [`plans/analysis/2026-06-01-demo-shared-org-architecture.md`](../../plans/analysis/2026-06-01-demo-shared-org-architecture.md). **Полностью заменяет** старую модель «копия ТехноСтрим в каждую Org» (ТЗ 2026-05-31-demo-auto-seed-and-cleanup отменён).

**Идея.** Демо — это не операция (seed), это **состояние** (membership). Эталонная Org «ТехноСтрим» (`isReferenceDemo=true`) живёт **одна** в БД, новые пользователи получают `OrgMember(role='demo_observer')` к ней автоматически — без копирования, без ожидания, без тоста «Готовим…».

**Поток регистрации (новый):**
1. Signup → `AccountsService.register` создаёт User + свою пустую Org + `Membership(owner)` к своей + `Membership(demo_observer)` к эталону (из ENV `ZDEMO_ORG_ID`) в одной `$transaction`. Идемпотентно через UNIQUE `(orgId, userId)`.
2. Welcome 6 шагов → `POST /orgs/:orgId/welcome/complete` создаёт документ «Знакомство», ставит `welcomeCompletedAt`, возвращает `{ redirectTo: '/dashboard' }` сразу (никаких очередей).
3. `AccountsService.getMe` выбирает `currentOrgId/Role` как `firstOwnedMembership ?? demoMembership` — **по умолчанию своя Org**; эталон доступен через `OrgSwitcher`. ⚠️ **Исправлено 2026-06-25 (коммит `40ce79bd`):** раньше было `demoMembership ?? firstOwnedMembership` («видеть эталон первым», задумано в `plans/archive/2026-06-01-demo-shared-org-model.md`), но это делало `currentOrgId` = read-only эталон → опросник Блока A (`PATCH /orgs/:currentOrgId/welcome`) и любая запись в кабинете ловили **403** (`requireOwnerOrAdmin`/`DemoObserverGuard`) → онбординг зацикливался, в кабинет не пускало (2 реальных юзера застряли). Демо-приоритет несовместим с тем, что welcome-мастер пишет в `currentOrg`. См. [[../05_история/2026-06-25-onboarding-demo-org-403-fix]].
4. В шапке/sidebar — `OrgSwitcher` показывает обе Org (эталон с бейджем «Демо», своя пустая).

**Поток первой оплаты (DEMO→ACTIVE):**
- `manual-billing` / Tochka webhook → `billing.subscription.activated_paid|_bonus`.
- `SubscriptionActivatedListener` → `prisma.membership.deleteMany({ userId: Org.ownerId, orgId: ZDEMO_ORG_ID, role: 'demo_observer' })`. Эталонная Org **не тронута**. Своя Org становится ACTIVE.
- `OrgSwitcher` после SWR-refetch показывает только свою Org.

**Read-only enforcement в эталоне:**
- `DemoObserverGuard` (глобальный APP_GUARD) режет POST/PUT/PATCH/DELETE для роли `demo_observer` с 403 `demo_observer_readonly`.
- super_admin bypass + GET/HEAD/OPTIONS пропускаются + BYPASS-пути `/billing`, `/auth`, `/me/*`, `/accounts/me` + `@PublicDemo()` декоратор для исключений (concierge LLM-чат).
- В эталоне `Subscription.status=ACTIVE, paymentMode='reference'` — пользователь видит работающий продукт без paywall'а. `BillingOverviewService` исключает `reference` из метрик paid/bonus.

**Удалено (по сравнению с прошлой моделью):**
- `OnboardingService.triggerDemoSeed` / `getDemoSeedStatus` / `ensureDemoSeed` + endpoint'ы `GET /orgs/:orgId/demo-seed-status` и `POST /orgs/:orgId/demo-workspace/ensure`.
- Воркеры `demo-seed.queue.ts` / `demo-seed.worker.ts` (но `demo-cleanup.queue/worker` остались для force-update эталона через `/admin/demo`).
- Frontend loading-страница `/onboarding/welcome/complete` (теперь redirect сразу `/dashboard`).
- Старая `/onboarding/demo-choice` (была удалена ещё раньше).
- `SubscriptionContext` fallback polling demo-seed.

**Доставка контента в эталон:**
- CLI: `docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts` — создаёт эталон один раз, печатает `ZDEMO_ORG_ID=<cuid>` для записи в `.env`.
- Миграция существующих копий: `docker compose exec backend bun run scripts/patch-migrate-old-demo-orgs.ts` — чистит копии с external='demo', прикрепляет owner'ов наблюдателями.
- Force-update эталона (`/admin/demo` super-admin): `DemoCleanupWorker` с guard'ом `isReferenceDemo=true` → `resetDemoWorkspace` → re-seed.

Полная prod-инструкция: [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md) → блок «🌟 2026-06-01 — Shared demo Org».

Очереди — см. [[workers-queues]].

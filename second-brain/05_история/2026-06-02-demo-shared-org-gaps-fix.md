---
title: Закрытие gap'ов ТЗ shared demo Org — 23 модуля, фильтры, защита эталона
date: 2026-06-02
type: reflection
distilled: false
references:
  - plans/tz/2026-06-01-demo-shared-org-model.md
  - plans/analysis/2026-06-01-demo-shared-org-architecture.md
---

# Закрытие gap'ов ТЗ shared demo Org

## Что было поставлено

Владелец попросил проаудитировать реализацию ТЗ `2026-06-01-demo-shared-org-model.md` (агент-код сделал её ранее) и довести до состояния «всё зелёное, никаких приоритетов 1-3».

## Диагностика — 5 gap'ов

1. **Critical: эталон собирался полупустым.** `OnboardingService.seedDemoWorkspace` вызывал 23 seed-модуля (новый контент по ТЗ `2026-05-31-demo-content-expansion-pulse`), а `patch-create-reference-demo-org.ts` и `seed-demo-workspace.ts` — только 8. Эталон без регламентов, идей, документов, календаря, фидбека, рефералки, Pulse-снапшотов, helpfulness, vendors, process-templates, experiments, brand-voice, probe-events, users. Главная Pulse у любого нового user'а была бы пустой (виджеты читают snapshot-таблицы; cron-агенты их потом досчитают, но первое впечатление — сломано).
2. **High: ProactiveWatcherService.runOnce шёл по всем Org включая эталон.** Cron генерил бы `ProactiveNotification` для demo-Person'ов / попутно doходящих до `demo_observer`-наблюдателей — несвязный шум.
3. **High: ProactiveNotificationsService.listMine не имел защиты для demo_observer.** Если уведомление как-то попало в эталон — наблюдатель бы его увидел.
4. **Medium: нет endpoint'а POST /admin/demo/orgs/:id/mark-reference.** ТЗ §5.5 предписывал — отсутствовал. Эталон можно было создать только через patch-скрипт.
5. **Medium: AdminOrgsService.deleteOrg + updateOrg(freeze) не защищали эталон.** Удаление/заморозка эталона → orphan-memberships → `getMe` возвращает `currentOrgId=null` → новый user видит только свою пустую Org.

## Как решал

1. **Единый источник правды по сидингу.** Новый `backend/src/modules/onboarding/demo-data/index.ts`: `DEMO_SEED_STEPS` (ReadonlyArray из 23 шагов с key/label/fn) + `runAllSeedSteps(ctx, ids, onStep?)`. Все три точки сидинга (HTTP / patch / CLI) переведены на него. Добавление нового seed-модуля = одна строка в массиве.
2. **ProactiveWatcherService.runOnce** — `findMany Org` теперь с `isReferenceDemo: false`. Cron больше не трогает эталон.
3. **ProactiveNotificationsService.listMine** — defence-in-depth: один `membership.findFirst` per вызов, если роль `demo_observer` → пустой массив без обращения к ProactiveNotification.
4. **AdminDemoController.markReference** — `POST /admin/demo/orgs/:orgId/mark-reference`, идемпотентен, 409 `reference_already_exists` если эталон уже есть в другой Org.
5. **AdminOrgsService.assertNotReferenceDemo** — общий helper, вызывается из `deleteOrg` и `updateOrg(freeze=true)`. 400 `cannot_delete_reference`.

## Что вышло (верификация)

- `bun run typecheck` (backend) — **0 errors**.
- `bun run lint` (backend) — **0 errors, 132 pre-existing warnings**.
- Tests: `onboarding.service`, `subscription-activated.listener`, `demo-observer.guard`, `accounts.service`, `rbac.service`, `proactive` модуль — **194/194 passed**.
- Ветка `feature/demo-shared-org-gaps-fix` от `dev`. Коммит `f0b28bd`, 8 файлов, +250/-128. Запушена в origin.

## Чему научился

1. **Несколько точек, делающих «одно и то же» — это всегда gap-генератор.** Три точки вызывали seed-модули руками: HTTP-сервис (23), patch (8), CLI (8). Расхождение никто не заметил, пока я не проверил по диффам. Урок: при появлении третьего callsite — сразу выносить единый рантайм (`runAllSeedSteps`), не «копировать пока работает».
2. **«Эталон сидится один раз» концептуально звучит безопасно, но если контент-список drift'ит между точками — гарантированно один из них зальёт меньше.** Защита: списочный `as const` массив + один `await step.fn(ctx, ids)` в цикле. Дальше TypeScript следит, чтобы тип `SeedFn` не разошёлся.
3. **Cron-агенты, обходящие `Org.findMany({ deletedAt: null })`, по умолчанию НЕ знают про эталон.** При появлении новой «специальной» Org (shared demo, sandbox, archive) — обязан пройтись grep'ом по `prisma.org.findMany` и расширить фильтр явно, иначе они начинают «жить» внутри эталона и создавать ложные сигналы.
4. **Defence-in-depth в read-эндпоинтах для demo_observer.** Даже когда источник отключён (watcher не пишет в эталон), read-эндпоинт всё равно должен помнить про `demo_observer`-role и фильтровать на выходе. Стоимость — один findFirst, выгода — отсутствие утечек через окольные пути.
5. **Безопасность эталона — это не только `isReferenceDemo=true`, но и невозможность его удалить.** Membership(demo_observer) к удалённой Org становится orphan'ом, и `getMe` возвращает `currentOrgId=null`. Гард в `deleteOrg`/`updateOrg(freeze)` — обязателен.

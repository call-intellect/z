---
date: 2026-05-28
task: "SubscriptionGuard — Фаза 1 paywall без trial"
status: done
commits:
  - "6ba2e8f"
tags: [billing, guard, paywall, backend]
---

## Что было поставлено

Реализовать SubscriptionGuard — backend-часть paywall без trial (ТЗ 2026-05-28-paywall-no-trial.md, Фаза 1).

## Как решал

### 1. Изучил архитектуру
- Прочитал существующие guards (TenantGuard, EntitlementGuard) — взял паттерн
- Изучил SubscriptionService.getByTenant() — уже есть нужный API
- Нашёл модуль billing — всё в одном месте

### 2. Создал guard и декоратор
- `guards/require-subscription.decorator.ts` — SetMetadata с REQUIRE_SUBSCRIPTION_KEY
- `guards/subscription.guard.ts` — проверяет Reflector.getAllAndOverride, если нет декоратора — прозрачен, иначе проверяет Subscription.status === 'ACTIVE'

### 3. Зарегистрировал
- BillingModule: добавил в providers + exports
- AppModule: APP_GUARD (цепочка: CookieAuth → Tenant → Subscription → Entitlement → Rbac)

### 4. Применил через 3 агента параллельно
- Агент 1: 17 tracker controllers (projects/issues/sprints/cycles/boards/checklists/comments/labels/relations/attachments/documents/holidays/intake/imports/webhooks)
- Агент 2: 12 controllers (meetings/participants/room-messages/recordings/reports/highlights/decisions/clones/chat/chat-v2/concierge)
- Агент 3: 4 controllers (orgs/retention/goals/sprint-review)
- Итого: ~126 декораторов в 31 файле

### 5. Написал тесты
14 unit-тестов: transparent без декоратора, ACTIVE пропускает, DEMO/SUSPENDED/CANCELED/EXPIRED/PAST_DUE блокирует, null → DEMO, структура ошибки, edge cases (нет tenantId, non-http)

## Что вышло

- Typecheck ✅ (0 ошибок)
- Lint ✅ (0 ошибок, 3 pre-existing варнинга)
- Тесты 14/14 ✅
- Коммит: 6ba2e8f feat(billing): SubscriptionGuard — paywall без trial (Фаза 1)
- ТЗ обновлено: Фаза 1 отмечена ✅

## Чему научился

1. **Паттерн transparent guard** — если метаданных нет, return true. Это позволяет постепенно применять guard к эндпоинтам.
2. **Цепочка guard'ов** — порядок важен: SubscriptionGuard должен быть после TenantGuard (нужен tenantId), но до EntitlementGuard (entitlement проверяет фичи tier'а, а subscription — базовый доступ).
3. **Параллельные агенты** — 3 агента на 31 контроллер = ~5 минут вместо ~15 последовательно. Каждый агент сам проверяет typecheck после своих изменений.
4. **@RequireSubscription на класс vs метод** — декоратор можно ставить на класс (все методы) или на отдельные методы. В моём случае ставил на отдельные методы для точного контроля.

## Связанные файлы

- `backend/src/modules/billing/guards/subscription.guard.ts`
- `backend/src/modules/billing/guards/require-subscription.decorator.ts`
- `backend/src/modules/billing/guards/subscription.guard.spec.ts`
- `plans/tz/2026-05-28-paywall-no-trial.md`
- `.agent-prompts/phase2-paywall-frontend.md` — промпт для следующего агента (frontend)

## Что дальше

Фаза 2: Paywall UI на frontend (PaywallBanner + PaywallModal + interceptor для 403).

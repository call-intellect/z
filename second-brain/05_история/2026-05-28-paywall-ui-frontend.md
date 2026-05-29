---
title: "Paywall UI + SubscriptionClient (Фазы 2-3)"
date: 2026-05-28
tags: [paywall, frontend, billing, subscription]
---

# Paywall UI + SubscriptionClient (Фазы 2-3)

## Задача

Реализовать Фазы 2-3 ТЗ `2026-05-28-paywall-no-trial.md`:
- Фаза 2: PaywallBanner + PaywallModal + interceptor
- Фаза 3: Улучшения страницы `/settings/subscription` (DEMO hero, выбор периода, slider мест)

## Как решал

**Фаза 2:**
- Создал `SubscriptionContext` — аналог `EntitlementContext`, тянет `billingApi.getSubscription()`, слушает `subscription:required` event
- `PaywallBanner` — sticky-плашка при `status === 'DEMO'`, кнопка → `/settings/subscription`
- `PaywallModal` — Radix Dialog со списком фич, ценой, CTA-кнопками
- Изменил `api-client.ts`: на 403 парсит тело, при `code === 'subscription_required'` dispatch CustomEvent
- Интеграция: `<SubscriptionProvider>` в `AuthenticatedShell`, `<PaywallBanner>` + `<PaywallModal>` в `AppShell`

**Фаза 3:**
- Переписал `SubscriptionClient.tsx`:
  - DEMO hero с крупным CTA + конфигуратор
  - BlockedHero для SUSPENDED/EXPIRED/CANCELED
  - PricingConfigurator: toggle месяц/год, slider 31-100, live-расчёт через `billingApi.getQuote()`
  - useQuote hook с debounce 300ms
- Установил `@radix-ui/react-slider`, создал `ui/shadcn/slider.tsx`
- Добавил алиас `@app` в `vitest.config.ts`

**Тесты:** 21 тест (14 Фаза 2 + 7 Фаза 3), все ✅

## Верификация

- `typecheck` — 0 ошибок
- `lint` — 0 ошибок
- `test:unit` — все мои тесты ✅ (9 пред-существующих fail'ов не связаны)

## Коммит

`39039a8 feat(paywall): Paywall UI + SubscriptionClient (Фазы 2-3)`

16 файлов, +2876/−1634

## Что осталось по ТЗ

- Фаза 4: Демо-режим (read-only) — визуальные индикаторы disabled buttons/tooltips
- Фаза 5: Миграция (скрипт, уведомления, мониторинг)

## Уроки

- `useRef<T>()` в React 19 требует начальное значение → `useRef<T | null>(null)`
- Vitest по умолчанию не резолвит `@app` алиас — нужен явный alias в vitest.config
- Тесты компонентов из `app/` лучше класть в `src/__tests__/` или рядом с компонентом

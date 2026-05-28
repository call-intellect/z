---
date: 2026-05-28
type: session-reflection
distilled: false
commits:
  - 4097475 — feat(tracker,billing): исправить пустой проект после создания + ТЗ paywall без trial
---

# Рефлексия: исправление бага трекера + ТЗ paywall

## Что было поставлено

Пользователь попросил:
1. Посмотреть следующие ТЗ после демо-кабинета
2. Обсудить модель монетизации (без trial, демо → оплата)
3. Написать ТЗ на paywall
4. Закоммитить и запушить

## Как решал

### 1. Анализ ТЗ

Изучил структуру plans/tz/ и plans/analysis/:
- Нашёл 75+ ТЗ файлов
- Определил приоритеты (демо-кабинет выполняется, paywall следующий)
- Обновил roadmap с учётом реальности (60-70% готово)

### 2. Обсуждение модели монетизации

Пользователь дал чёткие решения:
- **Нет trial** — продукт генерирует дорогие ресурсы (видео, LLM-токены)
- **Демо-режим** — read-only просмотр заполненного кабинета
- **Один тариф** — 60 000 ₽/мес (или 576 000 ₽/год, скидка 20%)
- **Масштабирование** — 31 место + доп. места по 1 000 ₽/мес
- **Перерасход встреч** — блокировка создания до следующего месяца (вариант A)
- **Grace period** — 0 дней, сразу SUSPENDED (вариант A)
- **Downgrade** — данные сохраняются indefinitely в read-only (вариант B)

### 3. Написание ТЗ paywall

Создал `plans/tz/2026-05-28-paywall-no-trial.md`:
- SubscriptionGuard (проверка status === 'ACTIVE' для мутаций)
- Декоратор @RequireSubscription()
- PaywallBanner (sticky top, показ в DEMO)
- PaywallModal (при попытке создать → 403 → показать модалку)
- Страница оплаты с выбором периода (месяц/год)
- Управление местами (slider 31-100, +1 000 ₽ за доп.)
- Cron проверки подписки (ACTIVE → SUSPENDED при просрочке)

Обновил анализ `plans/analysis/2026-05-28-billing-paywall-demo-cabinet.md`:
- Убрал trial-модель
- Заменил на "демо → оплата"
- Обновил FSM переходы
- Обновил лимиты по тарифу
- Обновили приоритеты

### 4. Коммит и пуш

Добавил только свои файлы (не трогал untracked файлы из других сессий):
- backend/src/modules/tracker/controllers/projects.controller.ts
- backend/src/modules/tracker/services/projects.service.ts
- frontend/app/(authenticated)/projects/[slug]/ProjectViewShell.tsx
- frontend/app/(authenticated)/projects/new/FromTemplateWizard.tsx
- frontend/app/(authenticated)/projects/new/NewProjectClient.tsx
- frontend/src/api/tracker/projects.api.ts
- frontend/src/hooks/tracker/useProjectBySlug.ts
- plans/analysis/2026-05-28-billing-paywall-demo-cabinet.md
- plans/tz/2026-05-28-paywall-no-trial.md

Коммит: `4097475` — feat(tracker,billing): исправить пустой проект после создания + ТЗ paywall без trial

Push: успешен в dev

## Что вышло

✅ **Баг трекера исправлен** (в предыдущей сессии, но закоммичен сейчас):
- findBySlug endpoint работает
- useProjectBySlug переписан на прямой SWR-запрос
- SWR cache invalidation добавлен
- ProjectViewShell guard добавлен

✅ **ТЗ paywall написано**:
- Чёткая модель монетизации (без trial)
- SubscriptionGuard + Paywall UI
- Решения по перерасходу/grace/downgrade

✅ **Анализ обновлён**:
- Убран trial
- Обновлены приоритеты
- Обновлены метрики

## Чему научился

1. **Модель "демо → оплата" без trial** — защищает от злоупотребления дорогими ресурсами (видео, LLM)
2. **Один тариф + масштабирование по местам** — проще, чем 5 тарифов с разными фичами
3. **Read-only downgrade** — данные не удаляются, пользователь может вернуться
4. **Grace period = 0** — жёсткая политика, но защищает от неплательщиков

## Следующие шаги

1. **Демо-кабинет** (выполняется отдельно) — Фаза 1: org-структура + трекер + 3 встречи
2. **SubscriptionGuard** (следующий) — блокировать POST/PATCH/DELETE в DEMO
3. **Paywall UI** — Banner + Modal
4. **Страница оплаты** — выбор периода + управление местами
5. **Pricing-страница** (публичная) — для привлечения
6. **Cron + миграция** — проверка подписки + перевод старых пользователей

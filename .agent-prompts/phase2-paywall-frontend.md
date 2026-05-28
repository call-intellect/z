# Промпт для агента: Фаза 2 — Paywall UI (frontend)

## Контекст

Реализуем paywall без trial для платформы "Кора" (память компании). 

**Что уже сделано:**
- Backend: `SubscriptionGuard` + декоратор `@RequireSubscription()` применён ко всем мутирующим эндпоинтам (POST/PATCH/DELETE)
- Guard возвращает 403 с телом:
  ```json
  {
    "ok": false,
    "error": {
      "code": "subscription_required",
      "message": "Оплатите подписку, чтобы начать работу",
      "currentStatus": "DEMO",
      "price": 60000,
      "currency": "RUB",
      "paymentUrl": "/settings/subscription"
    }
  }
  ```
- Статусы подписки: `DEMO` (read-only), `ACTIVE` (полный доступ), `SUSPENDED`, `CANCELED`, `EXPIRED`

**Твоя задача:** реализовать frontend-часть paywall (Фаза 2 из ТЗ).

## ТЗ

**Полное ТЗ:** `c:\work\z\plans\tz\2026-05-28-paywall-no-trial.md`  
**Раздел:** §4 "Paywall UI (frontend)"  
**Фаза 2:** строки 325-334 (этапы реализации)

## Задачи

### 2.1 PaywallBanner (sticky top)
Показывается на всех страницах в демо-режиме.

**Компонент:** `frontend/src/components/paywall-banner.tsx`

**Логика:**
- Получить статус подписки через `useSubscriptionStatus()` (или создать этот hook)
- Если `status !== 'DEMO'` — вернуть `null`
- Sticky top, желтый фон, кнопка "Оплатить 60 000 ₽/мес" → `/settings/subscription`

**Дизайн:** см. ТЗ §4.1 (пример кода на строках 131-155)

### 2.2 PaywallModal
Показывается при попытке создать данные в демо-режиме (когда бэкенд вернул 403).

**Компонент:** `frontend/src/components/paywall-modal.tsx`

**Контент:**
- Заголовок "Оплатите подписку"
- Список "Что включено" (150 встреч, 31 место, безлимит проектов, AI, клоны, интеграции)
- Цена 60 000 ₽/мес (или 576 000 ₽/год со скидкой 20%)
- Две кнопки: "Оплатить картой" и "Безналичный расчёт" → `/settings/subscription`
- Подпись: "Доп. места: +1 000 ₽/мес за каждого пользователя сверх 31"

**Дизайн:** см. ТЗ §4.2 (пример кода на строках 157-215)

### 2.3 Interceptor для 403 `subscription_required`
Глобальный перехватчик в `api-client.ts`.

**Файл:** `frontend/src/lib/api-client.ts` (или где находится axios-клиент)

**Логика:**
```typescript
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403 &&
        error.response?.data?.error?.code === 'subscription_required') {
      // Показать PaywallModal
      showPaywallModal()
    }
    return Promise.reject(error)
  }
)
```

**Важно:** нужно реализовать глобальный способ показа модалки (React Context или Zustand store для управления состоянием модалки).

### 2.4 Тесты
- PaywallBanner: показывается в DEMO, скрывается в ACTIVE
- PaywallModal: корректный рендер, кнопки ведут на `/settings/subscription`
- Interceptor: перехватывает 403 `subscription_required`

## Технические детали

**Где смотреть существующий код:**
- API-клиент: `frontend/src/lib/api-client.ts` (или `frontend/src/api/client.ts` — найди сам)
- Существующие модалки: поищи `Modal` в `frontend/src/components/`
- Hooks: `frontend/src/hooks/` или `frontend/src/api/` (SWR-хуки)
- Auth context: `frontend/src/contexts/auth.tsx` (аналог для subscription status)

**Стек:**
- React + Next.js (App Router)
- Tailwind CSS
- Radix UI (для модалок, кнопок)
- SWR (для data-fetching)
- TypeScript (строгая типизация)

**Требования:**
- Следуй conventions проекта (изучи существующие компоненты)
- Импорты через алиасы (`@/components/`, `@/lib/`, `@/api/`)
- Компоненты в `frontend/src/components/`
- Hooks в `frontend/src/hooks/` или `frontend/src/api/`
- Тесты рядом с компонентами (`.test.tsx` или `.spec.tsx`)

## Верификация

После реализации:
1. `cd frontend && bun run typecheck` — без ошибок
2. `cd frontend && bun run lint` — без ошибок
3. `cd frontend && bun run test` — все тесты проходят
4. Ручная проверка: в dev-режиме с `status: 'DEMO'` виден баннер, при попытке POST — модалка

## Дополнительные ресурсы

- Анализ billing-paywall: `c:\work\z\plans\analysis\2026-05-28-billing-paywall-demo-cabinet.md`
- ТЗ демо-кабинета: `c:\work\z\plans\tz\2026-05-28-demo-workspace.md` (для понимания контекста)

## Вопросы?

Если что-то непонятно:
1. Изучи существующие компоненты в `frontend/src/components/`
2. Посмотри как реализован auth (контекст, hooks,拦截器ы)
3. Прочитай ТЗ полностью (ссылка выше)
4. Если вопрос не решён — задай в чат

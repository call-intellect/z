# ТЗ: Paywall — демо-режим без trial

**Дата:** 2026-05-28  
**Статус:** `[x]` Фазы 1-5 ✅ (5.2 email + 5.3 метрики конверсии — вне scope MVP)  
**Связан:** [2026-05-28-demo-workspace.md](2026-05-28-demo-workspace.md), [2026-05-28-billing-paywall-demo-cabinet.md](../analysis/2026-05-28-billing-paywall-demo-cabinet.md)

---

## 1. Модель монетизации

### 1.1. Принципы

- **Нет trial-периода** — продукт генерирует дорогие ресурсы (видео, LLM-токены, транскрипты)
- **Демо-режим** — read-only просмотр заполненного кабинета (12 сотрудников, 3 проекта, 7 встреч)
- **Один тариф** — 60 000 ₽/мес (или 576 000 ₽/год, скидка 20%)
- **Масштабирование по местам** — 31 место включено, +1 000 ₽/мес за каждого доп. пользователя
- **Всё включено** — нет feature-gating по тарифам (все фичи доступны после оплаты)

### 1.2. User Journey

```
Регистрация
  ↓
Онбординг (6 шагов)
  ↓
Выбор: "Посмотреть демо" или "Оплатить сразу"
  ↓
[Демо] Read-only просмотр (можно кликать, нельзя создавать)
  ↓
Banner: "Чтобы начать работу, оплатите подписку"
  ↓
[Оплата] Карта или безнал
  ↓
Полный доступ (создание данных, встречи, LLM)
```

---

## 2. Демо-режим (read-only)

### 2.1. Что можно делать

- ✅ Просматривать демо-данные (проекты, задачи, встречи, граф знаний)
- ✅ Открывать AI-отчёты, транскрипты, записи встреч
- ✅ Читать комментарии, чек-листы, документы
- ✅ Смотреть граф знаний (темы, сущности, связи)
- ✅ Открывать клоны сотрудников (но не чатиться с ними)
- ✅ Просматривать дашборды, отчёты COO, цели

### 2.2. Что нельзя делать

- ❌ Создавать проекты, задачи, циклы, спринты
- ❌ Создавать встречи (даже тестовые)
- ❌ Писать комментарии, создавать документы
- ❌ Чатиться с AI-ассистентом или клонами (тратит LLM-токены)
- ❌ Приглашать пользователей
- ❌ Менять настройки организации
- ❌ Создавать свои данные (любые POST/PATCH/DELETE запросы)

### 2.3. Как отличить демо-пользователя

**Backend:** проверка `Subscription.status === 'DEMO'` в `SubscriptionGuard`

**Frontend:** `useSubscriptionStatus()` → `{ status: 'DEMO' }`

---

## 3. SubscriptionGuard (backend)

### 3.1. Логика

Новый глобальный guard (`SubscriptionGuard`), который проверяет статус подписки перед мутирующими операциями.

**Пропускает запрос, если:**
- `Subscription.status === 'ACTIVE'` — полная оплата
- Запрос на read-only операцию (GET)
- Запрос на оплату/просмотр подписки (`/billing/*`, `/subscription/*`)

**Блокирует запрос (403), если:**
- `Subscription.status === 'DEMO'` — нет оплаты
- `Subscription.status === 'SUSPENDED'` — подписка приостановлена (просрочка платежа)
- `Subscription.status === 'CANCELED'` — подписка отменена

**Ответ при блокировке:**
```json
{
  "error": "subscription_required",
  "message": "Оплатите подписку, чтобы начать работу",
  "details": {
    "currentStatus": "DEMO",
    "price": 60000,
    "currency": "RUB",
    "paymentUrl": "/settings/subscription"
  }
}
```

### 3.2. Применение

**Где применять:**
- Все POST/PATCH/DELETE запросы в трекере (проекты, задачи, встречи)
- Создание клонов, чат с AI
- Приглашение пользователей
- Изменение настроек организации

**Где НЕ применять:**
- GET-запросы (чтение данных)
- Аутентификация (`/auth/*`)
- Оплата подписки (`/billing/pay/*`)
- Просмотр статуса подписки (`/billing/subscription`)

### 3.3. Декоратор `@RequireSubscription`

Для гибкости — декоратор на отдельные методы контроллеров:

```typescript
@Post()
@RequireSubscription() // Блокирует если status !== 'ACTIVE'
async createProject(@Body() dto: CreateProjectDto) {
  // ...
}
```

---

## 4. Paywall UI (frontend)

### 4.1. PaywallBanner

Показывается на всех страницах в демо-режиме (sticky top):

```typescript
// components/paywall-banner.tsx
export function PaywallBanner() {
  const { status } = useSubscriptionStatus()
  
  if (status !== 'DEMO') return null
  
  return (
    <div className="sticky top-0 z-50 bg-yellow-50 border-b border-yellow-200 p-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LockIcon className="w-5 h-5 text-yellow-600" />
          <p className="text-sm text-yellow-900">
            <strong>Демо-режим:</strong> просмотр данных без возможности создания.
          </p>
        </div>
        <Link href="/settings/subscription">
          <Button variant="default" size="sm">
            Оплатить 60 000 ₽/мес
          </Button>
        </Link>
      </div>
    </div>
  )
}
```

### 4.2. PaywallModal

Показывается при попытке создать данные в демо-режиме:

```typescript
// components/paywall-modal.tsx
export function PaywallModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader>
        <LockIcon className="w-6 h-6" />
        <h2>Оплатите подписку</h2>
      </ModalHeader>
      <ModalBody>
        <p className="text-gray-600 mb-4">
          Чтобы начать работу и создавать свои данные, оплатите подписку.
        </p>
        
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Что включено:</h3>
          <ul className="space-y-1 text-sm">
            <li>✅ 150 видеовстреч в месяц</li>
            <li>✅ 31 место для пользователей</li>
            <li>✅ Безлимитные проекты и задачи</li>
            <li>✅ AI-отчёты и граф знаний</li>
            <li>✅ Клоны сотрудников</li>
            <li>✅ Все интеграции</li>
          </ul>
        </div>
        
        <div className="text-2xl font-bold mb-2">
          60 000 ₽/мес
        </div>
        <div className="text-sm text-gray-500 mb-4">
          или 576 000 ₽/год (скидка 20%)
        </div>
        
        <div className="space-y-2">
          <Link href="/settings/subscription">
            <Button className="w-full" size="lg">
              Оплатить картой
            </Button>
          </Link>
          <Link href="/settings/subscription">
            <Button variant="outline" className="w-full" size="lg">
              Безналичный расчёт
            </Button>
          </Link>
        </div>
        
        <p className="text-xs text-gray-400 mt-4 text-center">
          Доп. места: +1 000 ₽/мес за каждого пользователя сверх 31
        </p>
      </ModalBody>
    </Modal>
  )
}
```

### 4.3. Перехват 403 ошибок

В `api-client.ts` — глобальный interceptor для 403 `subscription_required`:

```typescript
// lib/api-client.ts
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403 && 
        error.response?.data?.error === 'subscription_required') {
      // Показать PaywallModal
      showPaywallModal()
    }
    return Promise.reject(error)
  }
)
```

---

## 5. Страница оплаты

### 5.1. `/settings/subscription`

Текущая страница (`SubscriptionClient.tsx`) уже работает. Улучшения:

- **Для DEMO:** крупный заголовок "Оплатите подписку, чтобы начать работу"
- **Для ACTIVE:** "Ваша подписка активна" + управление местами
- **Для SUSPENDED:** "Подписка приостановлена. Оплатите для возобновления"

### 5.2. Выбор периода

```typescript
const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')

const price = period === 'monthly' ? 60000 : 576000
const discount = period === 'yearly' ? 'Скидка 20%' : null
```

### 5.3. Управление местами

После оплаты — возможность добавлять места:

```typescript
const [seats, setSeats] = useState(31) // базовое кол-во
const extraSeats = Math.max(0, seats - 31)
const totalExtra = extraSeats * 1000

return (
  <div>
    <p>Пользователей: {seats}</p>
    <Slider min={31} max={100} value={seats} onChange={setSeats} />
    {extraSeats > 0 && (
      <p className="text-sm text-gray-600">
        Доп. места: {extraSeats} × 1 000 ₽ = {totalExtra} ₽/мес
      </p>
    )}
  </div>
)
```

---

## 6. Миграция существующих пользователей

### 6.1. Текущие пользователи с `DEMO`

Если у пользователя уже `status === 'DEMO'`:
- Оставляем в демо-режиме
- Показываем PaywallBanner
- При попытке создать данные — PaywallModal

### 6.2. Текущие пользователи с `ACTIVE`

Ничего не меняется, полный доступ.

### 6.3. Grandfather clause

Если пользователь создал данные **до** внедрения paywall:
- Оставляем доступ к его данным
- Но для создания **новых** данных — требуется оплата

---

## 7. Метрики успеха

| Метрика | Цель |
|---|---|
| Конверсия демо → оплата | 5-10% |
| Среднее время от регистрации до оплаты | 3-7 дней |
| Отток после показа paywall | < 80% |
| ARPU (средний чек) | 65 000 ₽/мес (с учётом доп. мест) |

---

## 8. Этапы реализации

### Фаза 1: SubscriptionGuard (backend) ✅

- [x] **1.1** Создать `SubscriptionGuard` (проверка `status === 'ACTIVE'`)
- [x] **1.2** Добавить декоратор `@RequireSubscription()`
- [x] **1.3** Применить guard ко всем мутирующим эндпоинтам трекера (141 декоратор, 32 файла — покрытие 100%+)
- [x] **1.4** Тесты: блокировка DEMO, пропуск ACTIVE (21 unit-тест: 14 базовых + 7 для GET/HEAD/OPTIONS/path bypass, все ✅)
- [x] **1.5** Рефакторинг: bypass GET/HEAD/OPTIONS + path `/api/v1/{billing,subscription,auth}/*` (ТЗ §3.2)
- [x] **1.6** `ensureDemo()` подключён в `OrgsService.createForOwner` — у каждой новой Org сразу есть запись Subscription

### Фаза 2: PaywallBanner + PaywallModal (frontend) ✅

- [x] **2.1** Создать `PaywallBanner` (sticky top, семантические токены `warning/*`)
- [x] **2.2** Создать `PaywallModal` (Radix Dialog, открывается на `subscription:required`)
- [x] **2.3** Добавить interceptor в `api-client.ts` для 403 `subscription_required` → `CustomEvent`
- [x] **2.4** Тесты: 5 + 5 + 3 = 13 ✅ (PaywallBanner, PaywallModal, api-client interceptor)

### Фаза 3: Страница оплаты (улучшения) ✅

- [x] **3.1** Обновить `/settings/subscription` для DEMO (DemoHero, крупный CTA)
- [x] **3.2** Добавить выбор периода (месяц 60K / год 576K, скидка 20%)
- [x] **3.3** Добавить управление местами (slider 31–100, live Quote API с debounce 300мс)
- [x] **3.4** Тесты: 7 ✅ (DEMO hero, period toggle, slider, расчёт цены, ACTIVE card, payCard, payBankInvoice)
- [x] **3.5** `BlockedHero` для SUSPENDED/EXPIRED/CANCELED/PAST_DUE
- [x] **3.6** Фикс: `SubscriptionCard` показывал `seatsBase + 1` (off-by-one), теперь `seatsBase`

### Фаза 4: Демо-режим (read-only) ✅

- [x] **4.1** `SubscriptionGuard` применён ко всем POST/PATCH/DELETE (см. 1.3, 141 декоратор)
- [x] **4.2** Визуальные индикаторы read-only: хук `useCanCreate()` + компонент `<PaywallGuardButton>` (приглушённый стиль + tooltip + открывает PaywallModal вместо `onClick` в DEMO). Базовый UI — `PaywallBanner` (sticky на всех страницах через AppShell) + 403-interceptor → PaywallModal на любой попытке POST. 6 тестов ✅
- [x] **4.3** Тесты блокировки в DEMO покрыты в `subscription.guard.spec.ts` (DEMO/SUSPENDED/EXPIRED/CANCELED/PAST_DUE)

### Фаза 5: Миграция ✅ (5.2 email + 5.3 — вне scope MVP)

- [x] **5.1** Скрипт миграции `backend/scripts/backfill-demo-subscriptions.ts` — для каждой Org без подписки создаёт `Subscription{status=DEMO}` + `SubscriptionEvent{CREATED}`. Зарегистрирован в `apply-prod-deploy.ts` (phase: backfill, skipBootstrap: true).
- [~] **5.2** Уведомления: in-app покрыт (`PaywallBanner` на всех страницах + `PaywallModal` при попытке create). Email-уведомления — вне scope MVP, отдельным ТЗ.
- [~] **5.3** Мониторинг конверсии DEMO → ACTIVE — вне scope MVP. Источник данных уже есть: `SubscriptionEvent` (CREATED/ACTIVATED/...) + `Subscription.status` — отдельным ТЗ добавить Prometheus-counter в `SubscriptionGuard` и Grafana-дашборд.

---

## 9. Решения

### 9.1. Перерасход встреч

**Решение:** Блокировка создания встреч до следующего месяца

**Реализация:**
- `SubscriptionGuard` проверяет `balance.remaining` перед созданием встречи
- Если `remaining === 0` → 403 `meetings_limit_reached`
- Frontend: `PaywallModal` с сообщением "Лимит встреч исчерпан. Дождитесь следующего месяца"
- Сброс баланса: `@Cron('0 0 1 * *')` — первое число каждого месяца

### 9.2. Grace period при просрочке платежа

**Решение:** 0 дней — сразу SUSPENDED

**Реализация:**
- `subscription-expiration.cron.ts` — ежедневная проверка в 00:00
- Если `status === 'ACTIVE'` и `currentPeriodEnd < now()` → переход в `SUSPENDED`
- Уведомление: email + in-app "Подписка приостановлена. Оплатите для возобновления"
- В `SUSPENDED` режиме: read-only (как в DEMO)

### 9.3. Downgrade при отмене

**Решение:** Данные сохраняются indefinitely (read-only)

**Реализация:**
- При отмене подписки → `status = 'CANCELED'` (с `cancelAtPeriodEnd: true`)
- После окончания периода → `status = 'EXPIRED'`
- В `EXPIRED` режиме: полный read-only доступ к своим данным
- Данные **не удаляются** — пользователь может вернуться в любой момент
- При повторной оплате → `status = 'ACTIVE'`, доступ восстанавливается

---

## 10. Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Низкая конверсия демо → оплата | Средняя | Высокое | Улучшить демо-данные, добавить видео-тур |
| Пользователи уходят без оплаты | Высокая | Среднее | Показать ценность в демо, CTA на каждой странице |
| Злоупотребление демо (конкуренты) | Низкая | Низкое | Rate-limit на просмотр демо (1 раз в сутки) |
| Негатив от "нет trial" | Средняя | Среднее | Объяснить в FAQ: "защищаем от злоупотребления LLM" |

---

## 11. Что дальше

1. **Демо-кабинет** — ТЗ: [2026-05-28-demo-workspace.md](2026-05-28-demo-workspace.md)
2. **Paywall** — это ТЗ (2026-05-28-paywall-no-trial.md)
3. **Лендинг** — ТЗ: [2026-05-28-kora-landing-as-main-page.md](2026-05-28-kora-landing-as-main-page.md)

**Порядок реализации:**
1. Демо-кабинет (Фаза 1: org-структура + трекер + 3 встречи)
2. Paywall (Фаза 1: SubscriptionGuard)
3. Демо-кабинет (Фаза 2-4: граф, клоны, отчёты)
4. Paywall (Фаза 2-4: UI, оплата, миграция)
5. Лендинг

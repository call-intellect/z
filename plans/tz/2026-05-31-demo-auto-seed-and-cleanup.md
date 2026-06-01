---
type: tz
status: draft
date: 2026-05-31
feature: Авто-заливка демо-кабинета при регистрации новой Org + авто-стирание демо-данных при первой оплате (DEMO → ACTIVE).
relates_to:
  - plans/tz/2026-05-28-demo-workspace.md
  - plans/analysis/2026-05-28-billing-paywall-demo-cabinet.md
  - plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md
  - plans/tz/2026-05-29-admin-demo-workspace-creation.md
  - plans/tz/2026-05-25-demo-mode-tz.md
supersedes_partial:
  - plans/tz/2026-05-25-demo-mode-tz.md  # часть «авто-сидинг + авто-cleanup» реализуется новым ТЗ, остальное (isDemo-флаг на 26 моделях) НЕ берём — у нас уже работает externalSource='demo'
---

# ТЗ: авто-сидинг демо-кабинета и авто-cleanup при оплате

> Эволюция уже работающей фичи [`2026-05-28-demo-workspace.md`](./2026-05-28-demo-workspace.md). Не переписываем её, а убираем **выбор** пользователя «демо или с нуля» и добавляем **авто-стирание** при первой оплате.

---

## 1. Цель

Сейчас новый пользователь после welcome-онбординга попадает на экран `/onboarding/demo-choice` и **сам решает**, заливать ли демо. Это лишний клик и потеря «вау»-эффекта для тех, кто проскакивает выбор.

Целевой UX (подтверждён владельцем 2026-05-31):

1. **Бесплатного тарифа не существует** — это уже так, `SubscriptionGuard` блокирует все мутации при `status === 'DEMO'`. Не трогаем.
2. **После регистрации** пользователь проходит онбординг (welcome 6 шагов, как сейчас), затем **сразу** попадает в кабинет, **заполненный демо-данными** «ТехноСтрим». Бейдж «Демо-режим» (`PaywallBanner`) сверху, кнопки реальных операций блокирует существующий `SubscriptionGuard`.
3. **Может ходить, смотреть графики/таблицы/встречи/клонов** — все GET'ы проходят.
4. **Не может ничего создавать** — `PaywallModal` открывается при первой попытке мутации, ведёт на оплату.
5. **При первой оплате** (FSM `DEMO → ACTIVE`, режим `paid` или `bonus`) — демо-данные **автоматически стираются в фоне**, бейдж и paywall исчезают (это уже работает по статусу), кабинет становится чистым. Пользователь начинает с нуля для своих данных.

---

## 2. Что меняем (точечно)

| # | Действие | Файл / точка |
|---|---|---|
| 1 | Удалить экран выбора «демо/с нуля» | [`frontend/app/(authenticated)/onboarding/demo-choice/page.tsx`](../../frontend/app/(authenticated)/onboarding/demo-choice/page.tsx) — удалить файл; убрать упоминания в навигации онбординга |
| 2 | После `completeWelcome` поставить job в очередь `demo.seed` | [`OnboardingService.completeWelcome`](../../backend/src/modules/onboarding/onboarding.service.ts#L62) — в конце транзакции `await queue.add('seed', { orgId, ownerUserId })` |
| 3 | Создать BullMQ-очередь `demo.seed` + worker | новый `backend/src/modules/onboarding/workers/demo-seed.worker.ts` — переиспользует `OnboardingService.seedDemoWorkspace` |
| 4 | Создать listener на `billing.subscription.activated_paid` + `billing.subscription.activated_bonus` | новый `backend/src/modules/onboarding/listeners/subscription-activated.listener.ts` |
| 5 | Создать BullMQ-очередь `demo.cleanup` + worker | новый `backend/src/modules/onboarding/workers/demo-cleanup.worker.ts` — переиспользует `OnboardingService.resetDemoWorkspace` |
| 6 | Frontend: пока seed не завершён — экран «Готовим демо-кабинет…» с polling | новый `frontend/app/(authenticated)/onboarding/welcome/complete/page.tsx` (или inline в существующий step-6) + новый endpoint `GET /orgs/:orgId/demo-seed-status` |

**Что НЕ меняем:**

- Не трогаем `SubscriptionGuard`, `PaywallBanner`, `PaywallModal`, `SubscriptionContext`, FSM подписки — работают как нужно.
- Не трогаем `seedDemoWorkspace` / `resetDemoWorkspace` / `markAllDemoEntitiesForTenant` — переиспользуем как есть.
- Не трогаем admin-страницу `/admin/demo` — остаётся как страховка для super-admin'а.
- Не делаем `isDemo`-флаг на 26 моделях (как предлагал старый draft `2026-05-25-demo-mode-tz.md`) — `externalSource='demo'` через `markAllDemoEntitiesForTenant` нас уже устраивает.

---

## 3. Архитектура

### 3.1. Поток регистрации (новый)

```
Регистрация (email/password)
  → смена пароля
  → Welcome 6 шагов (роль / размер / отрасль / боли / стек / фичи)
  → POST /api/v1/orgs/:orgId/welcome/complete
       ├─ Org.welcomeCompletedAt = now()
       ├─ Document «Знакомство» создан
       └─ Queue 'demo.seed' enqueue { orgId, ownerUserId }   ◄─ НОВОЕ
  → Redirect /onboarding/welcome/complete  (loading-экран с polling)  ◄─ НОВОЕ
       ↓ (polling GET /demo-seed-status каждые 700 ms)
       seedDemoWorkspace в фоне (3-8 секунд):
         seedOrgStructure → seedTracker → seedMeetings → … → markAllDemoEntitiesForTenant
         Org.demoWorkspaceSeededAt = now()
       ↓
  → Redirect /dashboard (демо-данные видны, PaywallBanner сверху)
```

### 3.2. Поток оплаты (новый)

```
DEMO → ACTIVE (paid через Точку / bonus от super-admin'а)
  → ManualBillingService.activate() OR TochkaWebhookHandler
       → SubscriptionService.transition(to: 'ACTIVE', ...)
       → emit BillingEvent.SUBSCRIPTION_ACTIVATED_PAID | _BONUS
  
  @OnEvent('billing.subscription.activated_paid'),    ◄─ НОВОЕ
  @OnEvent('billing.subscription.activated_bonus')    ◄─ НОВОЕ
  └─ subscription-activated.listener.ts
       └─ Если Org.demoWorkspaceSeededAt != null:
            Queue 'demo.cleanup' enqueue { orgId, actorUserId: 'system' }
  
  demo-cleanup.worker (concurrency=1):
       OnboardingService.resetDemoWorkspace в транзакции 30 сек
       Удаляет всё с externalSource='demo' по 35 таблицам
       Org.demoWorkspaceSeededAt = null
  
  Фронт по тику SWR-refetch subscription → видит ACTIVE → PaywallBanner исчезает
  Через 5-10 секунд кабинет пустой
```

### 3.3. Почему очереди, а не sync

`seedDemoWorkspace` — это ~1500 INSERT'ов через 8 модулей (`seedOrgStructure`, `seedTracker`, `seedMeetings`, `seedKnowledgeGraph`, `seedGoalsClones`, `seedOperations`, `seedChatNotifications`, `seedPolish`), занимает 3-8 секунд на dev. Делать sync = блокировать HTTP-ответ `/welcome/complete` на эти секунды. Worker + loading-экран — стандартный UX.

`resetDemoWorkspace` — единая транзакция на 30 секунд по 35 таблицам, в проде может быть долго (накопится много IdeaBlock'ов через background-агентов, которые что-то писали в DEMO-Org через cron'ы). Через очередь:
- получаем retry при ошибке;
- не блокируем ответ оплаты (важно для Точки: webhook должен 200 OK быстро);
- видим в `/admin/platform/workers` дашборде;
- избегаем гонки если оплата приходит дважды (concurrency=1 + idempotency через `if (!demoWorkspaceSeededAt) return`).

### 3.4. Контракт событий

`BillingEvent.SUBSCRIPTION_ACTIVATED_PAID` (`'billing.subscription.activated_paid'`) и `BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS` (`'billing.subscription.activated_bonus'`) уже определены в [`billing.events.ts`](../../backend/src/modules/billing/events/billing.events.ts). Эмитятся из [`ManualBillingService.activate`](../../backend/src/modules/billing/services/manual-billing.service.ts) и из webhook-handler'а Точки (`TochkaWebhookController` → тот же `ManualBillingService`).

Payload — `SubscriptionActivatedPayload { tenantId, subscriptionId, paymentMode, billingPeriod, periodStart, periodEnd, seatsBase, seatsExtra }`. Нам достаточно `tenantId`.

**Важно про fromStatus.** Сейчас события `_PAID`/`_BONUS` эмитятся при любой активации (DEMO→ACTIVE, EXPIRED→ACTIVE, SUSPENDED→ACTIVE, PAST_DUE→ACTIVE). Для cleanup нам нужны ТОЛЬКО переходы из `DEMO`. Listener должен сам проверять `Org.demoWorkspaceSeededAt != null` — если демо никогда не лили, cleanup нечего делать, выходим. Это исключает ложные срабатывания при продлении/восстановлении.

---

## 4. Backend изменения

### 4.1. `OnboardingModule`

- Импортировать `BullModule.registerQueue({ name: 'demo.seed' })` и `{ name: 'demo.cleanup' }`.
- Зарегистрировать новые провайдеры: `DemoSeedWorker`, `DemoCleanupWorker`, `SubscriptionActivatedListener`.
- Экспортировать новый `DemoSeedStatusService` (для контроллера).

### 4.2. `OnboardingService.completeWelcome` — точка вызова seed

После транзакции `welcomeCompletedAt` + создания Document:

```ts
// audit 2026-05-31: автозаливка демо для каждой новой Org (вместо
// выбора /onboarding/demo-choice). См. ТЗ 2026-05-31.
const org = await this.prisma.org.findUnique({
  where: { id: orgId },
  select: { demoWorkspaceSeededAt: true },
});
if (!org?.demoWorkspaceSeededAt) {
  await this.demoSeedQueue.add(
    'seed',
    { orgId, ownerUserId: userId },
    { jobId: `demo-seed:${orgId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  );
}
```

Идемпотентность через `jobId` — повторный вызов `welcome/complete` (если пользователь refresh'нёт) не запустит второй seed.

### 4.3. Новый эндпоинт `GET /api/v1/orgs/:orgId/demo-seed-status`

- Доступ: `CookieAuthGuard + TenantGuard` (для своего orgId).
- Ответ: `{ status: 'pending' | 'in_progress' | 'completed' | 'failed', stats?: Record<string, number>, error?: string }`.
- Логика:
  - Если `Org.demoWorkspaceSeededAt != null` → `completed`.
  - Иначе спросить статус job'а из BullMQ по `jobId = 'demo-seed:${orgId}'`:
    - waiting/delayed → `pending`;
    - active → `in_progress`;
    - failed → `failed` + `error`;
    - completed но без `demoWorkspaceSeededAt` — рассинхрон, повторно enqueue с пометкой в лог.

### 4.4. Worker `demo-seed.worker.ts`

```ts
@Processor('demo.seed')
export class DemoSeedWorker {
  constructor(private readonly onboarding: OnboardingService) {}
  
  @Process('seed')
  async process(job: Job<{ orgId: string; ownerUserId: string }>): Promise<void> {
    await this.onboarding.seedDemoWorkspace({
      orgId: job.data.orgId,
      userId: job.data.ownerUserId,
    });
  }
}
```

Concurrency=2 (можно параллелить разные Org). Existing `seedDemoWorkspace` уже бросает `demo_already_seeded` если `demoWorkspaceSeededAt` стоит — это становится естественной idempotency.

### 4.5. Listener `subscription-activated.listener.ts`

```ts
@Injectable()
export class SubscriptionActivatedListener {
  constructor(
    @InjectQueue('demo.cleanup') private readonly cleanupQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID)
  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS)
  async onActivated(payload: SubscriptionActivatedPayload): Promise<void> {
    const org = await this.prisma.org.findUnique({
      where: { id: payload.tenantId },
      select: { demoWorkspaceSeededAt: true },
    });
    if (!org?.demoWorkspaceSeededAt) return;  // не лили демо → нечего стирать

    await this.cleanupQueue.add(
      'cleanup',
      { orgId: payload.tenantId, actorUserId: 'system:subscription-activated' },
      { jobId: `demo-cleanup:${payload.tenantId}`, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    );
  }
}
```

### 4.6. Worker `demo-cleanup.worker.ts`

```ts
@Processor('demo.cleanup')
export class DemoCleanupWorker {
  constructor(private readonly onboarding: OnboardingService) {}

  @Process('cleanup')
  async process(job: Job<{ orgId: string; actorUserId: string }>): Promise<void> {
    await this.onboarding.resetDemoWorkspace({
      orgId: job.data.orgId,
      actorUserId: job.data.actorUserId,
    });
  }
}
```

Concurrency=**1** — внутри одной Org гонок не должно быть, а параллелить разные Org через одну очередь смысла нет (PostgreSQL и так держит нагрузку). Если `no_demo_to_reset` (т.е. cleanup уже отработал) — это нормальный путь, worker логирует и завершает success.

### 4.7. Метрики (Prometheus)

| Метрика | Тип | Labels | Что считает |
|---|---|---|---|
| `demo_seed_jobs_total` | Counter | `status='completed'\|'failed'` | сколько раз отрабатывал seed-worker |
| `demo_seed_duration_seconds` | Histogram | — | время выполнения `seedDemoWorkspace` |
| `demo_cleanup_jobs_total` | Counter | `status='completed'\|'failed'\|'skipped'` | сколько раз отрабатывал cleanup-worker; `skipped` = `no_demo_to_reset` |
| `demo_cleanup_duration_seconds` | Histogram | — | время выполнения `resetDemoWorkspace` |
| `demo_seed_pending_total` | Gauge | — | сколько Org сейчас в `welcomeCompletedAt != null && demoWorkspaceSeededAt == null` (должно стремиться к 0) |

---

## 5. Frontend изменения

### 5.1. Удалить `/onboarding/demo-choice`

- Удалить `frontend/app/(authenticated)/onboarding/demo-choice/page.tsx`.
- Найти упоминания (через grep) и почистить: куда раньше redirect'ило после welcome step-6, сейчас будет на `/onboarding/welcome/complete`.

### 5.2. Loading-экран `/onboarding/welcome/complete`

Новая страница (или inline на последнем шаге welcome), показывает:
- Spinner + текст «Готовим ваш демо-кабинет — это пример компании "ТехноСтрим"…».
- Каждые 700 ms polling `GET /orgs/:orgId/demo-seed-status`.
- Когда `status === 'completed'` → `router.push('/dashboard')`.
- Если `failed` → toast «Не удалось загрузить демо-данные» + кнопка «Перейти в кабинет» (`/dashboard` без демо — пользователь увидит пустой кабинет + paywall; super-admin потом может вручную залить из `/admin/demo`).
- Таймаут polling — 60 секунд. Если за минуту не закончили — переходим в `/dashboard` с тостом «Демо-данные загрузятся в фоне».

### 5.3. SWR-refetch подписки

Существующий `SubscriptionContext` уже делает refetch на window.focus. Чтобы при первой оплате `PaywallBanner` исчез без F5, добавить эмит локального события `subscription:refresh` после успешного редиректа из payment-flow (если ещё нет). Это микро-правка, можно отдельно — на core-логику не влияет.

---

## 6. Edge-cases

| Кейс | Решение |
|---|---|
| Seed упал посередине (один из `seedXxx`) | Транзакции внутри `seedDemoWorkspace` НЕТ — модули вызываются последовательно. Это уже существующее ограничение, не худшее: частично залитые данные всё равно помечены `externalSource='demo'` через `markAllDemoEntitiesForTenant` (если до него дошли). Если упало до `markAllDemoEntitiesForTenant` — `externalSource=null`, при cleanup не удалится. **Митигация:** перед retry заворачивать в idempotency: проверить `Org.demoWorkspaceSeededAt`, если ещё `null` — сначала ручной cleanup (admin) или полагаемся на retry job'а. **Лучшая митигация (не в этом ТЗ):** обернуть `seedDemoWorkspace` в `$transaction({ timeout: 60_000 })` — отдельная фаза, не блокирует основную задачу. |
| Cleanup упал посередине | Транзакция 30 сек уже есть. При откате `Org.demoWorkspaceSeededAt` НЕ сбрасывается → retry job'а заберёт снова. |
| Пользователь успел сгенерить реальные данные в DEMO через cron/webhook (минуя `SubscriptionGuard`) | `resetDemoWorkspace` фильтрует по `externalSource='demo'` — реальные данные с `externalSource=null` или другим значением не удаляются. ✅ Уже работает. |
| Параллельные регистрации | seed на разные `tenantId` через BullMQ concurrency=2 — гонки нет (разные транзакции в PostgreSQL). |
| Оплата прошла, но cleanup-worker умер до завершения | `Org.demoWorkspaceSeededAt` всё ещё стоит → последующий retry заберёт. Если retry не помог (5 попыток × exponential backoff = ~3 минуты), job уходит в DLQ → видно в `/admin/platform/workers`. Пользователь в это время видит ACTIVE-статус, paywall снят, но демо-данные ещё в кабинете — некрасиво, но не разрушительно. |
| Оплата → `ACTIVE` → возврат → `EXPIRED` → новая оплата → `ACTIVE` второй раз | Между первым `ACTIVE` и `EXPIRED` cleanup отработал (`demoWorkspaceSeededAt = null`). Второй `_ACTIVATED_PAID` сработает, listener увидит `demoWorkspaceSeededAt = null`, выйдет (skipped). ✅ |
| Super-admin вручную грантнул `ACTIVE (bonus)` ещё до того, как пользователь дошёл до welcome/complete | `Org.demoWorkspaceSeededAt` ещё `null` → cleanup-listener выйдет (skipped). Но welcome/complete теперь enqueue'ит seed → seed работает с `externalSource='demo'`-маркером, и пользователь увидит «ТехноСтрим» поверх своей пустой ACTIVE-Org. Cleanup не сработает автоматически (нет события `ACTIVATED` после seed'а). **Митигация:** в seed-worker'е добавить precondition — `Subscription.status === 'DEMO'`, иначе skip + log. Это исключит ложные сидинги в активные Org. |
| Старые DEMO-Org (зарегистрированы до выкатки ТЗ) | По решению владельца (2026-05-31) — **оставляем как есть**. Не делаем backfill. Старые DEMO-Org останутся пустыми; super-admin может вручную залить из `/admin/demo` (кнопка уже работает). Новое поведение — только для регистраций после деплоя. |
| Пользователь refresh'нул `/onboarding/welcome/complete` | `jobId = 'demo-seed:${orgId}'` гарантирует, что повторного seed не будет (BullMQ не примет job с тем же `jobId` пока старый в работе). Polling продолжит работать. |

---

## 7. Фазы

### Фаза 1 — Backend: BullMQ-очереди и workers
- [ ] **1.1** Регистрация очередей `demo.seed` и `demo.cleanup` в `OnboardingModule` через `BullModule.registerQueue`.
- [ ] **1.2** Создать `workers/demo-seed.worker.ts` — `@Processor` + delegate в `OnboardingService.seedDemoWorkspace`.
- [ ] **1.3** Создать `workers/demo-cleanup.worker.ts` — `@Processor` + delegate в `OnboardingService.resetDemoWorkspace`.
- [ ] **1.4** В seed-worker: precondition `Subscription.status === 'DEMO'`, иначе skip + log (защита от случая «admin грантнул ACTIVE до welcome/complete»).
- [ ] **1.5** Добавить Prometheus-метрики (`demo_seed_*`, `demo_cleanup_*`).
- [ ] **1.6** Зарегистрировать workers в `backend/src/workers/main.ts`.
- [ ] **1.7** Smoke: `bun run worker:dev` поднимается без ошибок, очереди подключены к Redis.

### Фаза 2 — Backend: listener на оплату
- [ ] **2.1** Создать `listeners/subscription-activated.listener.ts` с `@OnEvent` на `SUBSCRIPTION_ACTIVATED_PAID` + `_BONUS`.
- [ ] **2.2** В listener: проверка `Org.demoWorkspaceSeededAt != null` → enqueue в `demo.cleanup`.
- [ ] **2.3** Unit-тест listener'а: эмитим оба события, проверяем enqueue с правильным `jobId`.
- [ ] **2.4** Integration-test (БД): создать DEMO-Org, сделать seed, эмитить `_ACTIVATED_PAID` → дождаться cleanup → проверить `Org.demoWorkspaceSeededAt === null` и `prisma.ideaBlock.count({ where: { tenantId, externalSource: 'demo' } }) === 0`.

### Фаза 3 — Backend: интеграция в welcome flow
- [ ] **3.1** В `OnboardingService.completeWelcome` после `welcomeCompletedAt` — enqueue в `demo.seed` с `jobId = 'demo-seed:${orgId}'`.
- [ ] **3.2** Новый эндпоинт `GET /api/v1/orgs/:orgId/demo-seed-status` (`CookieAuthGuard + TenantGuard`).
- [ ] **3.3** Unit-тесты обоих изменений (мок BullMQ-очереди + Prisma).
- [ ] **3.4** Swagger-теги: `Onboarding` для нового эндпоинта, описание ответов.

### Фаза 4 — Frontend: удалить выбор + добавить loading-экран
- [ ] **4.1** Удалить `frontend/app/(authenticated)/onboarding/demo-choice/page.tsx`.
- [ ] **4.2** Grep по `demo-choice` и `seedDemoWorkspace` — почистить упоминания в навигации онбординга. (`onboardingApi.seedDemoWorkspace` остаётся, он используется в admin-flow.)
- [ ] **4.3** Создать `frontend/app/(authenticated)/onboarding/welcome/complete/page.tsx` — loading-экран с polling `demo-seed-status` (700 ms, таймаут 60 сек).
- [ ] **4.4** В welcome-flow последний шаг (`step-6/finish-button`) — после успешного POST `/welcome/complete` редиректить на `/onboarding/welcome/complete`, не на `/dashboard` и не на `/onboarding/demo-choice`.
- [ ] **4.5** Добавить в `frontend/src/api/onboarding.api.ts` метод `getDemoSeedStatus(orgId)`.

### Фаза 5 — Сверка с второй мозг + Prod-deploy-log
- [ ] **5.1** `second-brain/01_projects/onboarding-wizard.md` — обновить (убрать упоминание `demo-choice`, добавить авто-сидинг).
- [ ] **5.2** `second-brain/01_projects/workers-queues.md` — добавить `demo.seed` и `demo.cleanup`.
- [ ] **5.3** `second-brain/01_projects/api-layer.md` — добавить `GET /orgs/:orgId/demo-seed-status`.
- [ ] **5.4** `docs/operations/prod-deploy-log.md` Шаг 12 — smoke-grep на новые очереди (`demo.seed`, `demo.cleanup`) и на новый Swagger-эндпоинт.

### Фаза 6 — E2E проверка на dev
- [ ] **6.1** Зарегистрировать новую Org → пройти welcome → дойти до `/onboarding/welcome/complete` → дождаться completed → проверить `/dashboard` заполнен «ТехноСтрим» + бейдж `PaywallBanner` сверху.
- [ ] **6.2** Попробовать создать задачу/проект/встречу → должна сработать `PaywallModal`.
- [ ] **6.3** В Z-Admin `/admin/billing/orgs/:tenantId/activate` (manual bonus) → подождать 30 секунд → refresh `/dashboard` → бейдж исчез, кабинет пустой.
- [ ] **6.4** Создать задачу → теперь должна создаться.

---

## 8. Что НЕ делаем

- ❌ **Не добавляем `isDemo`-флаг на 26 моделей** (как предлагал старый draft `2026-05-25-demo-mode-tz.md`). У нас уже работает `externalSource='demo'` через `markAllDemoEntitiesForTenant` + `resetDemoWorkspace` по этому фильтру.
- ❌ **Не делаем backfill для старых DEMO-Org** (решение владельца 2026-05-31). Старые остаются пустыми.
- ❌ **Не делаем «выйти из демо без оплаты»** — демо-кабинет существует, пока пользователь не оплатил. Это сознательно: cleanup триггерится только по `ACTIVATED_PAID/BONUS`.
- ❌ **Не трогаем `SubscriptionGuard`, `PaywallBanner`, `PaywallModal`** — работают как нужно.
- ❌ **Не делаем kill-switch через `AdminSetting`** — авто-сидинг важно держать включённым постоянно (это часть нового onboarding-flow). Если когда-нибудь понадобится отключить — это будет отдельным ТЗ.
- ❌ **Не объединяем seed+welcome в одну транзакцию** — сейчас seed идёт без транзакции, это уже работает в проде через ручной `/onboarding/demo-choice`. Менять масштаб транзакции — отдельная задача.

---

## 9. Связь с существующими ТЗ

| Документ | Роль |
|---|---|
| [`2026-05-28-demo-workspace.md`](./2026-05-28-demo-workspace.md) ✅ реализован | Источник `seedDemoWorkspace` / `resetDemoWorkspace` / демо-данных «ТехноСтрим». **Переиспользуем как есть.** |
| [`2026-05-28-billing-paywall-demo-cabinet.md`](../analysis/2026-05-28-billing-paywall-demo-cabinet.md) | Анализ-источник продуктовой модели (paywall без trial, демо-кабинет). |
| [`2026-05-27-billing-tochka-referral-dadata-z.md`](./2026-05-27-billing-tochka-referral-dadata-z.md) ✅ реализован (backend) | Источник FSM подписки и события `SUBSCRIPTION_ACTIVATED_PAID/BONUS`. Слушаем их. |
| [`2026-05-29-admin-demo-workspace-creation.md`](./2026-05-29-admin-demo-workspace-creation.md) ✅ реализован | `/admin/demo` остаётся как страховка для super-admin'а. Не трогаем. |
| [`2026-05-25-demo-mode-tz.md`](./2026-05-25-demo-mode-tz.md) draft | **Частично superseded:** идея авто-сидинг + авто-cleanup перенесена сюда. Идея `isDemo` на 26 моделях НЕ берётся (у нас уже `externalSource='demo'`). |

---

## 10. DoD

- [ ] Новый пользователь после welcome-онбординга **автоматически** видит кабинет «ТехноСтрим» с `PaywallBanner` сверху.
- [ ] Нет страницы `/onboarding/demo-choice`.
- [ ] Очереди `demo.seed` и `demo.cleanup` видны в `/admin/platform/workers`.
- [ ] При первой оплате (FSM `DEMO → ACTIVE`) — демо-данные **автоматически стираются в фоне** ≤30 секунд.
- [ ] Existing demo для уже зарегистрированных DEMO-Org НЕ автозаливается (старые остаются пустыми).
- [ ] `bun run typecheck` (backend + frontend) зелёный.
- [ ] `bun run worker:dev` поднимается без ошибок.
- [ ] Smoke E2E из §7 Фаза 6 пройден на dev.
- [ ] `docs/operations/prod-deploy-log.md` обновлён (Шаг 12 — smoke новых очередей и эндпоинта).
- [ ] Второй мозг обновлён: `01_projects/onboarding-wizard.md`, `workers-queues.md`, `api-layer.md`.
- [ ] Рефлексия записана в `second-brain/05_история/`.

---

## 11. Итог

_Заполняется по факту реализации._

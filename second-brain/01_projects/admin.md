---
title: Z-Admin — карта страниц
updated: 2026-05-26
---

# Z-Admin (super_admin)

Список фактически работающих страниц админки. Полная карта сайдбара — в
[frontend/app/(authenticated)/admin/navigation.ts](../../frontend/app/(authenticated)/admin/navigation.ts).

## AI и модели

### `/admin/llm-routes` — Управление роутами LLM

Страница для super_admin: таблица всех ~80 `taskType` (типов задач LLM) с
цепочкой моделей primary → secondary → tertiary. Позволяет менять провайдера
и модель для любого taskType без правки seed-скриптов.

- **API:** `GET / PUT /api/v1/admin/llm-routes` —
  `backend/src/modules/admin/llm-routes/llm-routes.controller.ts`.
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`. Не-super_admin получает
  403 → UI показывает `AdminForbidden`.
- **Фронт:**
  - `frontend/app/(authenticated)/admin/llm-routes/page.tsx`
  - `frontend/app/(authenticated)/admin/llm-routes/LlmRoutesClient.tsx`
  - `frontend/app/(authenticated)/admin/llm-routes/EditRouteDialog.tsx`
  - `frontend/src/api/admin-llm-routes.api.ts`
  - `frontend/src/domain/admin-llm-route.ts`
  - `frontend/src/hooks/useLlmRoutes.ts`
- **Особенности:**
  - Поддерживается оба формата записи `LlmTaskRoute`: нормализованный
    (по `tier`) и legacy (`providers` JSON-массив).
  - После сохранения роут получает `editedByAdmin=true` — seed-скрипты его
    больше не перезатирают (см. `safe-seed-rules`).
  - Для DeepSeek-Pro в модалке предупреждение про автоконвертацию
    `json_schema → tools` (ТЗ `deepseek-pro-output-format-fix`).
- **ТЗ:** [plans/tz/2026-05-25-admin-llm-routes-frontend.md](../../plans/tz/2026-05-25-admin-llm-routes-frontend.md).

### `/admin/clones` — Доступы к клонам (2026-05-26)

Страница для `owner` / `admin` Org: управление гранатами `CloneAccessGrant` (выдача, soft-revoke, продление срока действия). Создана 2026-05-26 в рамках Фазы 7 §9 clone-respond v2.

- **API:** 5 endpoints под `/api/v1/admin/clones/access-grants` (см. [api-layer.md](api-layer.md) §Clones admin), guard `OrgAdminGuard` + `AdminAuditInterceptor` (severity `high` — `reason` обязателен для grant/revoke/extend).
- **Защита:** `CookieAuthGuard` + `OrgAdminGuard`. Permission-gate во фронте через `useAuth` (поверх backend).
- **Фронт:**
  - `frontend/app/(authenticated)/admin/clones/page.tsx`
  - `frontend/app/(authenticated)/admin/clones/ClonesAccessClient.tsx`
  - `frontend/app/(authenticated)/admin/clones/CreateGrantDialog.tsx` — поиск member'а через `orgMembersApi.search` (debounce 250 мс), выбор role-клона из `useClones`, опц. `expiresAt` под кнопкой «Дополнительно».
  - `frontend/app/(authenticated)/admin/clones/RevokeGrantDialog.tsx` — подтверждение soft-revoke с danger-кнопкой.
  - `frontend/app/(authenticated)/admin/clones/ExtendGrantDialog.tsx` — `datetime-local` + чекбокс «бессрочно».
  - `frontend/src/api/admin-clones.api.ts` — 5 методов (list / create / revoke / extend / listByClone).
  - `frontend/src/domain/admin-clone-access-grant.ts` — типы + мапперы + русские лейблы для статус-chip («Активен» / «Отозван» / «Истёк»).
- **Навигация:** новый пункт «Доступы к клонам» (иконка `ShieldCheck`) в разделе «AI и модели» admin-навигации (`frontend/app/(authenticated)/admin/navigation.ts`).
- **Особенности:**
  - Фильтры — `cloneType` select, поиск по имени получателя, toggle «только активные».
  - Таблица с enriched-полями: `cloneLabel`, `userName` / `userEmail`, `grantedBy`, статус, `expiresAt` или «бессрочно».
  - Server-side pagination (`page` + `pageSize=50`).
  - Re-grant поверх revoked — физическое удаление старой записи в транзакции (audit остаётся в `AdminAuditLog`).
  - При `grant` уведомление получателя — `eventType=clone.access_granted` (in-app + Telegram через `ConversationalService`). Notification-failure не откатывает grant (warn-log).
- **ТЗ:** [plans/tz/2026-05-26-clone-access-grant-admin-api.md](../../plans/tz/2026-05-26-clone-access-grant-admin-api.md) + frontend часть в [plans/tz/2026-05-26-clones-marketplace-frontend.md](../../plans/tz/2026-05-26-clones-marketplace-frontend.md) §2-§3.

## Тенанты (Org)

### `/admin/orgs/[id]` — Карточка организации (табы)

Глобальный обзор тенанта для super_admin. Активная вкладка через `?tab=`.
Каждый таб — отдельный запрос (lazy), карточка открывается быстро.

**Табы (по порядку):**
- `overview` — обзор Org (тарифные плитки, расход за 30 дней, доход).
- `billing` — **Тариф и лимиты** (entitlements: tier, featureOverrides,
  quotaOverrides, notes, reason). Рендерит `BillingAdminClient`.
- `subscription` — **Подписка и счета** (subscription + invoices + events).
  Рендерит `AdminSubscriptionClient`.
- `members`, `sources`, `economics`, `audit`, `danger`.

**Унификация навигации (2026-05-29, ТЗ admin-subscription-ui-v2):**
- Standalone-страницы `/admin/orgs/[id]/billing/page.tsx` и
  `/admin/orgs/[id]/subscription/page.tsx` → `redirect()` на соответствующий
  `?tab=`. Закладки super-admin продолжают работать через 307.
- Из списка Org (`OrgsClient`) кнопка «Тариф» ведёт сразу на `?tab=billing`
  (без редиректа).
- `BillingAdminClient` и `AdminSubscriptionClient` — pure tab-content,
  без собственного `<h1>` и линка «К списку Org» (заголовок даёт
  `OrgDetailClient` через breadcrumbs).

**Что доступно в табе «Подписка и счета»:**
- Карточка «Текущая подписка»: статус, paymentMode, период, цена, места,
  autoRenew, всего оплачено. При `paymentMode === 'bonus'` показывается
  отдельный жёлтый Badge «Бонус».
- Кнопки «Изменить места» и «Принудительно сменить статус» (см. диалоги
  ниже).
- Форма ручной активации (paid / bonus + reason ≥3).
- Таблица последних 10 счетов с inline-кнопками действий
  (`InvoiceRowActions`):
  - **mark-paid** — только для статуса `issued`; модал с обязательным
    `externalRef` (номер платёжки) + `reason ≥3`. Идемпотентен на бэке.
  - **void** — для `draft` / `issued`; модал с `reason ≥3`. Для `paid` /
    `bonus` кнопка не показывается.
- Таймлайн `SubscriptionEvent` (последние 100 от бэкенда) с цветными
  бейджами по типу события, инициатором, причиной, accordion с
  JSON-payload.

**Диалоги:**
- `AdjustSeatsDialog` — изменение числа доп. мест. Поля: `newSeatsExtra`,
  `reason ≥3`. Pro-rata-подсказка для monthly (`daysLeftInMonthlyPeriod`)
  и yearly (`monthsLeftInYearlyPeriod`) — рассчитывается на фронте, доплата
  считается на бэке (`ManualBillingService.adjustSeats`).
- `ForceStatusDialog` — обход FSM подписки. Двойное подтверждение —
  `reason ≥3` + чекбокс «Я понимаю, что обхожу FSM». Submit активен только
  при изменённом статусе. Действие пишется в `AdminAuditLog`.

**Файлы фронта:**
- `frontend/app/(authenticated)/admin/orgs/[id]/OrgDetailClient.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdminSubscriptionClient.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/subscription/InvoiceRowActions.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdjustSeatsDialog.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/subscription/ForceStatusDialog.tsx`
- `frontend/app/(authenticated)/admin/orgs/[id]/subscription/SubscriptionEventsTimeline.tsx`

**API:** все методы готовы в `frontend/src/api/billing.api.ts` —
`adminGetOrgBilling`, `adminActivate`, `adminAdjustSeats`,
`adminForceStatus`, `adminGetEvents`, `adminMarkInvoicePaid`,
`adminVoidInvoice`. Бэкенд — `backend/src/modules/billing/admin-billing.controller.ts`.

**Защита:** `CookieAuthGuard` + `SuperAdminGuard`.

**Pages (sidebar/menu):** в `navigation.ts` раздел «Тенанты» добавлен
пункт «Биллинг — обзор» → `/admin/billing-overview` (агрегированные
метрики MRR/ARR/subs/refs/invoices по всем Org).

**ТЗ:** [plans/tz/2026-05-29-admin-subscription-ui-v2.md](../../plans/tz/2026-05-29-admin-subscription-ui-v2.md).

### `/admin/demo` — Демо-кабинеты «ТехноСтрим» (2026-05-29)

Super-admin создаёт/сбрасывает демо-кабинет для **любой** Org из UI — без CLI и без логина под owner'ом. Переиспользует `OnboardingService.seedDemoWorkspace/resetDemoWorkspace` (та же логика, что `/onboarding/demo-choice` и CLI `seed-demo-workspace.ts`).

- **API:** `GET /api/v1/admin/demo/orgs`, `POST .../:orgId/seed`, `POST .../:orgId/reset` — `backend/src/modules/admin/controllers/admin-demo.controller.ts`.
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard` + `SuperAdminAuditInterceptor`. `OnboardingModule` подключён в `admin.module.ts`.
- **Фронт:**
  - `frontend/app/(authenticated)/admin/demo/page.tsx` + `DemoClient.tsx` — список Org с бейджем «демо залито» (по `Org.demoWorkspaceSeededAt`), кнопки «Создать/Перезалить демо» и «Сбросить» (confirm).
  - `frontend/src/api/admin-demo.api.ts`.
- **Навигация:** пункт «Демо-кабинеты» (иконка `Sparkles`) в разделе «Тенанты» (`navigation.ts`).
- **Особенности:** seed берёт `ownerId` Org автоматически. Демо помечается `externalSource='demo'`, reset не трогает боевые данные.
- **ТЗ:** [plans/tz/2026-05-29-admin-demo-workspace-creation.md](../../plans/tz/2026-05-29-admin-demo-workspace-creation.md). Инструкция — [docs/guides/demo-workspace.md](../../docs/guides/demo-workspace.md).

## Обратная связь

### `/admin/feedback` — Канал обратной связи + AI-кластеризация

Дашборд блоков (`FeedbackTopic`) с процентами по объёму items. Только для super_admin Z (фича глобальная — фидбэк адресован команде Z, а не Org'е).

- **API:** `GET /api/v1/admin/feedback/topics` + items + actions + `POST /admin/feedback/digest/run` (см. [api-layer.md](api-layer.md)).
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`.
- **Фронт:**
  - `frontend/app/(authenticated)/admin/feedback/page.tsx`
  - `frontend/app/(authenticated)/admin/feedback/FeedbackDashboardClient.tsx`
  - `frontend/app/(authenticated)/admin/feedback/[topicId]/` — детальная карточка блока + items + действия
  - `frontend/app/(authenticated)/admin/feedback/components/` — диалоги rename / merge / archive (Phase 8)
  - `frontend/src/api/admin-feedback.api.ts`
  - `frontend/src/domain/admin-feedback.ts`
- **Особенности:**
  - Дашборд показывает блоки в порядке убывания % от общего числа items.
  - Действия: rename / merge (склейка с другим topic) / archive / unarchive.
  - Отдельная страница «Failed-сообщения» (`GET /admin/feedback/messages/failed`) — сообщения, на которых AI 3+ раза падал.
  - Ручной запуск ночного прогона — `POST /admin/feedback/digest/run` (BullMQ-job в очередь `core.feedback-digest`).
- **ТЗ:** [plans/tz/2026-05-25-user-feedback-with-ai-clustering.md](../../plans/tz/2026-05-25-user-feedback-with-ai-clustering.md). Полная заметка фичи — [[feedback]].

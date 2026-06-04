---
type: tz
status: draft
feature: admin-subscription-ui-v2
date: 2026-05-29
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Все пункты Scope (A навигация, B рефакторинг заголовков, C новые UI-блоки InvoiceRowActions/AdjustSeatsDialog/ForceStatusDialog/SubscriptionEventsTimeline, D бейдж «Бонус») и DoD подтверждены в коде; четыре фазы закоммич
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Admin Subscription UI v2 — табы «Тариф и лимиты» + «Подписка и счета»

> Связанные:
> - [plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md](plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md) §11.4 — backend уже реализован
> - [plans/tz/2026-05-25-admin-redesign-tz.md](plans/tz/2026-05-25-admin-redesign-tz.md) — общий каркас Z-Admin
> - [second-brain/01_projects/admin.md](second-brain/01_projects/admin.md)
> - [second-brain/03_processes/billing-cycle-tochka.md](second-brain/03_processes/billing-cycle-tochka.md)

## Цель

В одном месте — карточке `/admin/orgs/[id]` — super-admin видит и меняет **всё про деньги** одной Org: уровень тарифа с лимитами **и** статус подписки со счетами и историей событий. Ничего не спрятано, ничего не дублируется. Закрыты оставшиеся пробелы UI (mark-paid, void, adjust-seats, history), чтобы саппорт мог работать с банковским флоу без `psql`.

## Контекст и факты после перепроверки кода

**Backend готов на 100%** ([admin-billing.controller.ts](backend/src/modules/billing/admin-billing.controller.ts)):

| Endpoint | На бэке | В `billingApi` фронта | UI |
|---|---|---|---|
| `POST /admin/orgs/:id/billing/activate` (paid/bonus) | ✅ | `adminActivate` ✅ | ✅ есть |
| `POST /admin/orgs/:id/billing/adjust-seats` | ✅ | `adminAdjustSeats` ✅ | ❌ нет |
| `POST /admin/orgs/:id/billing/force-status` | ✅ | `adminForceStatus` ✅ | ❌ нет |
| `GET /admin/orgs/:id/billing/events` | ✅ | `adminGetEvents` ✅ | ❌ нет |
| `POST /admin/billing/invoices/:id/mark-paid` | ✅ | `adminMarkInvoicePaid` ✅ | ❌ нет |
| `POST /admin/billing/invoices/:id/void` | ✅ | `adminVoidInvoice` ✅ | ❌ нет |
| `GET /admin/billing/overview` | ✅ | `adminGetOverview` ✅ | ✅ есть `/admin/billing-overview/`, но **нет ссылки из меню** |

**Защита от дубликата реф-выплаты — двойная** (подтверждено перечтением кода):
- `InvoiceService.markPaid` идемпотентен: если `inv.status === 'paid'` уже — return без `INVOICE_PAID` event ([invoice.service.ts:178-181](backend/src/modules/billing/services/invoice.service.ts#L178-L181)).
- `ReferralPayoutService.onInvoicePaid` проверяет existing payout по `triggerInvoiceId` ([referral-payout.service.spec.ts:118-129](backend/src/modules/referrals/services/referral-payout.service.spec.ts#L118-L129)).

**Защита от опасных переходов** (подтверждено):
- `InvoiceService.void` для `paid`/`bonus` → `ForbiddenException` ([invoice.service.ts:215-218](backend/src/modules/billing/services/invoice.service.ts#L215-L218)).
- `ManualBillingService.activate` для повторного `paymentMode` → `ConflictException`.
- `force-status` обходит FSM, но требует `reason ≥3` + пишется в `AdminAuditLog`.

**Что реально сломано в текущем UX (4 находки):**

1. **Навигационная дыра**: страница [/admin/orgs/[id]/subscription](frontend/app/(authenticated)/admin/orgs/[id]/subscription/page.tsx) — orphan, ссылки из карточки Org нет; super-admin найдёт её только зная URL. При этом таб «Тариф и лимиты» в [OrgDetailClient.tsx:41](frontend/app/(authenticated)/admin/orgs/[id]/OrgDetailClient.tsx#L41) показывает **entitlements**, а не subscription — название путает.
2. **Банковский флоу не закрыт**: счёт выпущен автоматом → клиент платит банком → у админа нет кнопки `mark-paid`. Делать `activate` повторно нельзя — это создаст второй инвойс, поломает бухгалтерию.
3. **Саппорт слеп**: история переходов подписки + история `SubscriptionEvent` / `AdminAuditLog` есть в БД, но не видна в UI. Жалоба клиента «когда и почему вы списали?» отвечается через `psql`.
4. **Мусор в метриках**: ошибочно выпущенные `issued`-инвойсы висят в `invoices.totalIssued` без возможности `void`.
5. **Рост команды клиента ломается**: клиент вырос с 30 до 50 чел. → нужно `adjust-seats` с pro-rata. Сейчас — только пересоздание подписки.
6. **Дублирующие пути к BillingAdminClient**: рендерится одновременно как (а) **таб** `?tab=billing` в карточке Org и (б) **standalone-страница** `/admin/orgs/[id]/billing` (из неё же); из списка Org ([OrgsClient.tsx:276](frontend/app/(authenticated)/admin/orgs/OrgsClient.tsx#L276)) кнопка ведёт на standalone, а из [EntitlementsOverviewClient.tsx:226](frontend/app/(authenticated)/admin/orgs/entitlements/EntitlementsOverviewClient.tsx#L226) — в таб. **Внутри `BillingAdminClient` есть собственный `<Link>` «К списку Org»** ([BillingAdminClient.tsx:181-185](frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx#L181-L185)), который в таб-контексте создаёт двойную навигацию.
7. **Отсутствует ссылка в меню на `/admin/billing-overview`** — пользоваться можно только зная URL.

## Scope

**Входит:**

### A. Унификация навигации (всё через табы карточки Org)

- На карточке `/admin/orgs/[id]` оставляем существующий таб **«Тариф и лимиты»** (он про `entitlements`), добавляем рядом новый таб **«Подписка и счета»** (subscription + invoices + events).
- Standalone-страницы превращаем в редиректы (Next.js `redirect()`):
  - `/admin/orgs/[id]/billing/page.tsx` → `/admin/orgs/[id]?tab=billing`
  - `/admin/orgs/[id]/subscription/page.tsx` → `/admin/orgs/[id]?tab=subscription`
- В [OrgsClient.tsx:276](frontend/app/(authenticated)/admin/orgs/OrgsClient.tsx#L276) меняем `href` со standalone на `?tab=billing` (короче, без редиректа).
- В [navigation.ts](frontend/app/(authenticated)/admin/navigation.ts) добавляем в раздел «Тенанты» пункт **«Биллинг — обзор»** → `/admin/billing-overview`.

### B. Рефакторинг внутренней навигации обоих клиентов

Чтобы убрать двойные заголовки и линки при встраивании в таб:

- Из [BillingAdminClient.tsx:178-195](frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx#L178-L195) убрать собственный `<h1>Тариф организации</h1>`, ссылку «К списку Org» и tenantId-плашку — всё это уже даёт `OrgDetailClient` через breadcrumbs + title. Остаётся чистый контент: блок «Тариф», `FeatureOverridesSection`, `QuotaOverridesSection`, заметка, reason, кнопка Save.
- В [AdminSubscriptionClient.tsx:72-78](frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdminSubscriptionClient.tsx#L72-L78) убрать собственный `<h1>Подписка Org</h1>`. Остаётся чистый контент: `<CurrentSubscriptionCard>`, `<ActivateForm>`, `<RecentInvoicesTable>`, новый `<SubscriptionEventsTimeline>`.

### C. Новые UI-блоки в табе «Подписка и счета»

- **Inline-кнопки в `RecentInvoicesTable`** — новый компонент `InvoiceRowActions.tsx`:
  - `mark-paid` — доступна **только для статуса `issued`**, открывает модал с обязательным полем `externalRef` (номер платёжки) + `reason`. После успеха — `void load()`.
  - `void` — доступна для `draft` и `issued`, модал подтверждения с `reason ≥3`. Для `paid`/`bonus` кнопка **не показывается** (бэк всё равно вернёт 403).
- **`AdjustSeatsDialog.tsx`** — диалог изменения числа доп. мест. Поля: `newSeatsExtra`, `reason`. Предпросмотр pro-rata (опционально — если `daysLeftInMonthlyPeriod` / `monthsLeftInYearlyPeriod` уже известны из `currentSubscription`). Открывается из карточки «Текущая подписка».
- **`ForceStatusDialog.tsx`** — диалог принудительной смены статуса. Поля: `newStatus` (Select), `reason`, **чекбокс «Я понимаю, что обхожу FSM, и это может оставить подписку в неконсистентном состоянии»**. Кнопка submit активна только при чекбоксе + `reason ≥3`. Открывается из карточки «Текущая подписка».
- **`SubscriptionEventsTimeline.tsx`** — таймлайн под таблицей инвойсов: последние 100 `SubscriptionEvent` (`adminGetEvents`). Столбцы: тип (с цветным бейджем по `eventType`), дата, кто (`byUserId`), причина (`reason`), payload (раскрывающийся accordion с JSON).

### D. Визуальный hint про `bonus`

- В `CurrentSubscriptionCard` ([AdminSubscriptionClient.tsx:118-163](frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdminSubscriptionClient.tsx#L118-L163)) при `paymentMode === 'bonus'` показывать **отдельный жёлтый Badge «Бонус»** рядом со статусом — чтобы визуально не путать с платными клиентами в списке.

**Не входит:**

- Любые изменения бэкенда (всё уже реализовано и покрыто 47 unit-тестами — проверено локально 2026-05-29).
- Любые новые методы в `billingApi` (все есть).
- Новая модель Prisma или миграции.
- Создание `/admin/billing-overview` — она уже есть.
- Сложные фильтры / пагинация / поиск по инвойсам — MVP показывает 10 последних. Пагинация — позже.
- Экспорт CSV из таблицы инвойсов / событий — вынесен в общий `AdminCsvDownloadButton`, делаем отдельным мини-ТЗ.
- Web-Push админу при крупных платежах — отдельно.
- Refund-флоу (возврат уже оплаченного) — отдельная задача, отдельные API.

## Технические изменения

### Backend

Изменений **не требуется**. Все endpoint'ы готовы и покрыты unit-тестами:

- `manual-billing.service.spec.ts` — 9 тестов ✓
- `referral-payout.service.spec.ts` — 11 тестов ✓
- `subscription-fsm.spec.ts` — 27 тестов ✓

**Прогон 2026-05-29: 47/47 зелёные за 2.79s.**

### База данных

Изменений нет.

### Frontend

**Новые компоненты:**

| Файл | Назначение |
|---|---|
| `frontend/app/(authenticated)/admin/orgs/[id]/subscription/InvoiceRowActions.tsx` | Inline-кнопки `mark-paid` / `void` на строке инвойса с модалом |
| `frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdjustSeatsDialog.tsx` | Диалог `adjust-seats` с pro-rata-предпросмотром |
| `frontend/app/(authenticated)/admin/orgs/[id]/subscription/ForceStatusDialog.tsx` | Диалог `force-status` с двойным подтверждением |
| `frontend/app/(authenticated)/admin/orgs/[id]/subscription/SubscriptionEventsTimeline.tsx` | Таймлайн событий подписки |

**Изменения в существующих:**

- [OrgDetailClient.tsx](frontend/app/(authenticated)/admin/orgs/[id]/OrgDetailClient.tsx) — расширить массив `TABS` после `'billing'`:
  ```ts
  { value: 'subscription', label: 'Подписка и счета', icon: Receipt },
  ```
  И ветка `active === 'subscription'` → `<AdminSubscriptionClient tenantId={orgId} />` (import из `./subscription/AdminSubscriptionClient`).

- [AdminSubscriptionClient.tsx](frontend/app/(authenticated)/admin/orgs/[id]/subscription/AdminSubscriptionClient.tsx) — рефакторить:
  - убрать собственный `<h1>` + tenantId-плашку (строки 72-78) — заголовок даёт `OrgDetailClient`;
  - в `<CurrentSubscriptionCard>` добавить две кнопки «Изменить места» / «Принудительно сменить статус», открывающие диалоги;
  - в `<CurrentSubscriptionCard>` при `paymentMode === 'bonus'` добавить желтый Badge «Бонус»;
  - в `<RecentInvoicesTable>` добавить колонку «Действия» с `<InvoiceRowActions inv={inv} onChanged={onReload} />`;
  - после `<RecentInvoicesTable>` добавить `<SubscriptionEventsTimeline tenantId={tenantId} />`.

- [BillingAdminClient.tsx](frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx) — убрать строки 178-195 (собственный заголовок «Тариф организации» + `<Link>К списку Org` + tenantId-плашка). Остаётся чистый контент. Это **обратно-совместимо**: компонент становится pure tab-content, рендерится корректно и в табе, и (через редирект) при прямом URL.

- [/admin/orgs/[id]/subscription/page.tsx](frontend/app/(authenticated)/admin/orgs/[id]/subscription/page.tsx) — заменить тело на:
  ```ts
  import { redirect } from 'next/navigation';
  export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/admin/orgs/${encodeURIComponent(id)}?tab=subscription`);
  }
  ```

- [/admin/orgs/[id]/billing/page.tsx](frontend/app/(authenticated)/admin/orgs/[id]/billing/page.tsx) — то же самое, на `?tab=billing`.

- [OrgsClient.tsx:276](frontend/app/(authenticated)/admin/orgs/OrgsClient.tsx#L276) — поменять `href`:
  ```diff
  - href={`/admin/orgs/${encodeURIComponent(org.id)}/billing`}
  + href={`/admin/orgs/${encodeURIComponent(org.id)}?tab=billing`}
  ```

- [navigation.ts](frontend/app/(authenticated)/admin/navigation.ts) — в раздел «Тенанты» (после «Entitlements (overrides)») добавить:
  ```ts
  {
    href: '/admin/billing-overview',
    label: 'Биллинг — обзор',
    icon: Wallet, // или TrendingUp — что уже в импортах
    matchPrefix: '/admin/billing-overview',
  },
  ```

- [src/domain/billing.ts](frontend/src/domain/billing.ts) — добавить лейблы для `SubscriptionEventType` (`activated_paid` → «Активирована (paid)», `activated_bonus` → «Активирована (bonus)», `seats_changed`, `status_forced`, `renewed`, и т.д.) + функцию `eventTypeColor()` для цвета бейджа.

**API-слой**: изменений не требуется — все методы готовы в [billing.api.ts](frontend/src/api/billing.api.ts).

### Интеграции

Нет.

## Критерии готовности (DoD)

- [ ] На `/admin/orgs/[id]` видны два таба: «Тариф и лимиты» (entitlements) и «Подписка и счета» (subscription).
- [ ] Двойных заголовков и двойных «К списку» нет ни в одном табе.
- [ ] Старый URL `/admin/orgs/[id]/subscription` редиректит на `?tab=subscription`.
- [ ] Старый URL `/admin/orgs/[id]/billing` редиректит на `?tab=billing`.
- [ ] Кнопка «Биллинг» из списка Org ([OrgsClient.tsx](frontend/app/(authenticated)/admin/orgs/OrgsClient.tsx)) ведёт сразу на `?tab=billing`.
- [ ] В левом меню админки видна ссылка «Биллинг — обзор» → `/admin/billing-overview`.
- [ ] В табе «Подписка и счета» работают:
  - активация paid/bonus (как сейчас),
  - `adjust-seats` (+pro-rata),
  - `force-status` (с подтверждением + чекбокс),
  - таймлайн событий (последние 100).
- [ ] На каждом инвойсе в таблице:
  - `mark-paid` доступен только для `issued` (требует `externalRef`);
  - `void` доступен для `draft` / `issued`;
  - для `paid` / `bonus` кнопки **не показываются**;
  - после действия таблица обновляется (`onChanged`).
- [ ] При `paymentMode === 'bonus'` рядом со статусом подписки виден жёлтый Badge «Бонус».
- [ ] Все мутирующие операции требуют `reason ≥3` (frontend-валидация дублирует бэк).
- [ ] Unit-тесты на новые диалоги: happy path + API-ошибка + валидация reason.
- [ ] Ручная проверка: создать тестовую Org с referral, прогнать `activate(paid)` → проверить payout, прогнать `activate(bonus)` → проверить отсутствие payout, прогнать `mark-paid` для `issued` → проверить payout, прогнать `mark-paid` повторно → проверить **отсутствие** второго payout (двойная идемпотентность).
- [ ] Second Brain обновлён: [01_projects/admin.md](second-brain/01_projects/admin.md), [03_processes/billing-cycle-tochka.md](second-brain/03_processes/billing-cycle-tochka.md) (sync статуса UI).
- [ ] Рефлексия в [05_история/](second-brain/05_история/) после push.

## Риски и митигация

| Риск | Митигация |
|---|---|
| Рефакторинг `BillingAdminClient` (удаление собственного заголовка) сломает его рендер на standalone-URL | После рефакторинга standalone-URL **редиректит** на `?tab=billing`, прямого рендера без `OrgDetailClient` (= без хедера) больше не будет. Если кто-то откроет через `<BillingAdminClient/>` напрямую в Storybook — увидит контент без хедера, но это допустимо для preview. |
| Двойная эмиссия `INVOICE_PAID` при повторном `mark-paid` создаст дубль реф-выплаты | **Не создаст**, защита двойная: `InvoiceService.markPaid` идемпотентен по статусу (строки 178-181) + `ReferralPayoutService` идемпотентен по `triggerInvoiceId`. Тест `referral-payout.service.spec.ts:118-129` зелёный. |
| `force-status` в руках уставшего админа = развал FSM | Двойное подтверждение в диалоге: textarea с `reason ≥3` + чекбокс «обхожу FSM». Всё пишется в `AdminAuditLog`. |
| `void` оплаченного инвойса = потеря выручки | Бэк блокирует (`InvoiceService.void` → 403 для `paid`/`bonus`). Фронт прячет кнопку условно по статусу. |
| Старый URL `/subscription` в закладках super-admin | Редирект 307 — закладки продолжают работать. |
| Два таба про деньги путают разных админов | Короткий тултип в хедере каждого: «Тариф = что разрешено», «Подписка = платит/не платит, счета». |
| Метаданные страницы (тайтл «Z-Admin — Подписка») потеряются после редиректа | После редиректа тайтл будет от `OrgDetailClient` → «Z-Admin — Карточка организации». Это допустимо, поскольку контент таба уже даёт смысл. Если критично — обновим тайтл в карточке Org по активному табу (отдельным enhancement'ом). |
| Команда роста MVP полагается на DOM-локаторы в `BillingAdminClient` | `data-testid` ключевых элементов сохраняются. Если они есть и используются — список селекторов проверим в Фазе 1 до коммита. |

## Фазы реализации

- [ ] **Фаза 1 — Унификация навигации + Badge «Бонус» (≈2 часа)**
  - Расширить `TABS` в `OrgDetailClient.tsx`, добавить ветку рендера `subscription`.
  - Превратить оба standalone-`page.tsx` в `redirect()`.
  - Убрать собственные заголовки/линки из `BillingAdminClient` и `AdminSubscriptionClient`.
  - Поправить `href` в `OrgsClient.tsx`.
  - Добавить пункт «Биллинг — обзор» в `navigation.ts`.
  - Badge «Бонус» в `CurrentSubscriptionCard`.
  - `bun run typecheck` + `bun run lint` + ручная проверка в браузере (5 точек: список Org, карточка Org, два таба, переход по старому URL, левое меню).

- [ ] **Фаза 2 — Действия с инвойсами (≈1.5 часа)**
  - `InvoiceRowActions.tsx`: модалы `mark-paid` (с `externalRef`) и `void` (с `reason`).
  - Колонка «Действия» в `RecentInvoicesTable`.
  - Unit-тесты на компонент (4 теста: рендер per status, успешный mark-paid, отказ при void paid-инвойса, валидация externalRef).

- [ ] **Фаза 3 — Adjust seats + Force status + Events (≈2.5 часа)**
  - `AdjustSeatsDialog.tsx` + интеграция в `CurrentSubscriptionCard`.
  - `ForceStatusDialog.tsx` + двойное подтверждение.
  - `SubscriptionEventsTimeline.tsx` под таблицей счетов.
  - Лейблы и цвета в `src/domain/billing.ts`.
  - Unit-тесты на диалоги (валидация reason, чекбокс force-status, успех/ошибка).

- [ ] **Фаза 4 — Финиш (≈30 мин)**
  - Обновить Second Brain (`01_projects/admin.md`, `03_processes/billing-cycle-tochka.md`).
  - End-to-end ручная проверка по DoD (включая повторный `mark-paid` → нет дубля payout).
  - Рефлексия в `05_история/`.

**Итого: ~6.5 часов.**

## Итог

_Заполняется по факту реализации._

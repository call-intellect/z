---
name: billing-cycle-tochka
title: Подписка через Точку — оплата, активация, продление
trigger_type: user_action
status_overall: partial
last_audited: 2026-05-30
owners_human:
  - продакт биллинга
  - финансовый директор (для legal-реквизитов и канарейки на 1 ₽)
related_plans:
  - plans/archive/2026-05-27-billing-tochka-referral-dadata-z.md
  - plans/analysis/2026-05-25-billing-and-referrals.md
  - plans/archive/2026-05-28-paywall-no-trial.md
related_projects:
  - 01_projects/billing.md
  - 01_projects/inn-lookup.md
  - 01_projects/meetings-balance.md
---

# Подписка через Точку — оплата, активация, продление

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Когда у компании заканчивается демо или владелец хочет перейти на полноценный тариф, он открывает страницу подписки и выбирает один из двух способов оплаты: банковской картой с автопродлением или безналичным счётом на оплату (юрлица любят второй вариант — у бухгалтера есть привычный документ от банка с печатью).

Перед оплатой платформа автоматически подставляет реквизиты компании по ИНН — достаточно ввести десять или двенадцать цифр, и название, КПП, адрес, директор подтягиваются из публичных источников. Если в проде подключён банк-партнёр Точка, реквизиты сначала ищутся у него; если нет — идём в DaData (платный реестр налоговой). В разработческом окружении вместо реальных источников используется встроенный «справочник на 5 известных компаний».

Оплата идёт через банк Точка. Картой — это привычная страница банка с поддержкой автопродления (рекуррент). Безналичным счётом — банк формирует PDF-документ и отправляет его на почту компании; когда платёжка дойдёт до банковского счёта, банк присылает нам уведомление-вебхук, и подписка активируется автоматически. Если по какой-то причине вебхук не дошёл, отдельная служба «синхронизатор статусов» раз в пятнадцать минут перепроверяет открытые счета напрямую.

Каждый месяц специальная служба проверяет, не пора ли продлить подписку с автоплатежом. За три дня до окончания периода она пытается списать с привязанной карты. Если не получилось — подписка переходит в «грейс-период» на семь дней, владельцу приходит напоминание. После грейса — приостановка. Цена считается просто: базовый тариф 60 000 ₽ в месяц за 31 место (один владелец + тридцать сотрудников + 150 встреч), +1 000 ₽ за каждое дополнительное место с +5 встречами. Годовая оплата — со скидкой 20%.

## 2. Что запускает (триггер)

- **Тип:** действие пользователя + расписание (для продления) + вебхук (для финализации).
- **Кто инициирует:** владелец компании на странице подписки. Дальше — автоматика.
- **Технический источник:** `POST /api/v1/billing/pay/card` или `POST /api/v1/billing/pay/bank-invoice`; finalize — `POST /api/v1/internal/billing/provider-events` (вебхук Точки); продление — `@Cron('0 * * * *')` `TochkaRecurringChargeCron` + `@Cron('0 3 * * *')` `BillingCycleCron`.

## 3. Шаги процесса (общий список)

1. **Владелец открывает страницу подписки** (`/settings/billing` или админская `/admin/orgs/[id]/subscription`), видит текущий статус (`DEMO` / `ACTIVE` / `PAST_DUE` / ...).
2. **Заполняет реквизиты компании по ИНН** — платформа автоматически подтягивает название, КПП, адрес, директора, банковские реквизиты через `InnLookupService`.
3. **Выбирает способ оплаты:** карта с автопродлением, единоразовая карта, или безналичный счёт. Считает цену (60 000 ₽ × месяцев + 1 000 ₽ × доп.места × месяцев, минус 20% для года).
4. **Платформа создаёт счёт** (`Invoice` со статусом `draft`) с автоматическим номером вида «Z-2026-000123», передаёт его в Точку через `BillingProviderPort.createPayment` / `createRecurringSubscription` / `createBankInvoice`.
5. **Точка возвращает платёжную ссылку** (для карты) или PDF-документ (для безнала); счёт переходит в статус `issued`, ссылка/PDF возвращаются клиенту.
6. **Владелец оплачивает** на стороне Точки (карта — на странице банка; безнал — переводит платёжку с расчётного счёта компании).
7. **Точка присылает вебхук** на `/internal/billing/provider-events` с подписанной JWT-строкой; платформа проверяет JWT через JWK банка, дедуплицирует событие по `externalEventId`, и при статусе `APPROVED` или `payment_paid` атомарно: помечает `Invoice` как `paid`, переводит `Subscription` в `ACTIVE` с правильными периодами, начисляет места и встречи (`MeetingsBalanceService.grant`), и эмитит событие `billing.invoice.paid` для реф-программы.
8. **Если вебхук не дошёл**, страховочный cron `InvoiceStatusSyncCron` раз в 15 минут перепроверяет статусы открытых счетов напрямую через API Точки.
9. **Каждый час** `TochkaRecurringChargeCron` ищет подписки с `autoRenew=true` и истекающим периодом (через ≤3 дня), пытается списать с карты через `provider.chargeRecurringSubscription`. Финализация — снова через вебхук.
10. **Каждую ночь в 03:00 МСК** `BillingCycleCron` переводит просроченные подписки: `PAST_DUE → SUSPENDED` (если grace кончился), `CANCELED → EXPIRED`, `ACTIVE+bonus → EXPIRED` (если бонусный период истёк), `ACTIVE+paid+autoRenew → PAST_DUE` (если автоплатёж не сработал, ставится grace 7 дней).

## 4. Что получается на выходе

- **Запись в БД:** `Subscription(status='ACTIVE', paymentMode='paid', currentPeriodStart/End, totalPaidKopecks)`, `Invoice(status='paid', paidAt, externalRef)`, `SubscriptionEvent('renewed')`, `BillingEventLog('invoice.paid')`, `MeetingsBalance` (грант +150 встреч за базовый seat + 5 за каждое доп.место).
- **Платёжный документ:** ссылка на оплату (карта) или PDF-счёт (безнал) — отправляется на почту компании по запросу.
- **Событие в шине:** `billing.invoice.paid` (для [[referral-program]]).
- **Где это видно пользователю:** `/settings/billing` (статус, лимиты), список счетов с PDF-кнопкой; админу — `/admin/orgs/[id]/subscription` (статус, история событий, кнопки активации/отмены), `/admin/billing-overview` (MRR/ARR/активные/churn).

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Просмотр подписки | `GET /billing/subscription` под `CookieAuthGuard + TenantGuard`; маппинг `Subscription → SubscriptionViewDto`; на странице — список счетов через `GET /billing/invoices` | `backend/src/modules/billing/billing.controller.ts:74..83,85..105`, `frontend/app/(authenticated)/admin/orgs/[id]/subscription/page.tsx` + `AdminSubscriptionClient.tsx` | `GET /api/v1/billing/subscription` | — (read) | ⚠️ частично — owner-страница `/settings/billing` показывает старые entitlements, не новый biling (см. раздел 8) |
| 2 | Lookup по ИНН | `POST /api/v1/inn-lookup/:inn` через `InnLookupService.lookup`; маршрут по `INN_LOOKUP_PROVIDER` — `mock|dadata|tochka_then_dadata`; Redis-кэш `inn-lookup:<source>:<inn>` TTL 30 дней + lock против cache stampede (`SET NX EX 8` + polling 100мс×15); валидация regex `^(\d{10}\|\d{12})$` | `backend/src/modules/inn-lookup/inn-lookup.service.ts:50..end`, `backend/src/modules/inn-lookup/adapters/{mock,dadata,tochka}.adapter.ts`, `backend/src/modules/inn-lookup/inn-lookup.controller.ts` | `POST /api/v1/inn-lookup/:inn` (throttle 30/min/IP) | — (Redis cache) | ✅ |
| 3 | Расчёт цены | `GET /billing/quote?billingPeriod&seatsExtra` через `SeatService.calculatePricing` — базовая ставка `6_000_000` коп/мес × месяцев + `100_000` коп × seatsExtra × месяцев − 20% для `yearly`; `calculateMeetingsGrant` = `150 + 5 × seatsExtra` | `backend/src/modules/billing/services/seat.service.ts`, `backend/src/modules/billing/billing.controller.ts:149..168` | `GET /api/v1/billing/quote` | — | ✅ |
| 4 | Создание Invoice | `BillingService.createCardPayment` / `createBankInvoicePayment`: `assertFeature('card_recurring'\|'bank_invoice')` → `subscriptions.getByTenantOrFail` → `seats.calculatePricing` → `invoices.create({status='draft', items[BASE\|SEATS\|YEARLY_DISCOUNT]})` — номер `invoiceNumber` через `InvoiceNumberService` (формат `Z-YYYY-NNNNNN` поверх `Invoice.billingNumber Int @unique @default(autoincrement())`) | `backend/src/modules/billing/services/billing.service.ts:119..217` (card) `+229..321` (bank), `backend/src/modules/billing/services/invoice.service.ts`, `backend/src/modules/billing/services/invoice-number.service.ts` | inline | `Invoice(status='draft')` | ✅ |
| 5 | Передача в Точку + paymentUrl/PDF | Карта: `provider.createRecurringSubscription({saveCard:true, recurring:true, paymentLinkId=invoice.id})` или `createPayment({paymentMode:['card','sbp']})`. Безнал: `provider.createBankInvoice({payer:{legalName,inn,kpp,legalAddress,...}})` — требует `org.inn + legalAddress + contactEmail + directorName` иначе 400; опц. `sendBankInvoiceToEmail` (fire-and-forget). В обоих случаях Invoice → `status='issued'`, `providerInvoiceId`, `paymentUrl`, `providerName='tochka'` | `backend/src/modules/billing/providers/tochka/tochka-billing.provider.ts`, `backend/src/modules/billing/services/billing.service.ts:182..217,288..321`; фабрика провайдера — `billing.module.ts:86..98` (`tochka` vs `manual` по `cfg.billing.provider`) | `POST /api/v1/billing/pay/card`, `POST /api/v1/billing/pay/bank-invoice` | `Invoice.providerInvoiceId`, `paymentUrl`, `externalStatus`, `status='issued'`, `Subscription.providerSubscriptionId` (если autoRenew) | ✅ |
| 6 | Оплата клиентом | На стороне Точки (страница банка для карты; перевод платёжки с расчётного счёта для безнала) | — внешняя система | — | — | ✅ |
| 7 | Webhook → finalize | `POST /internal/billing/provider-events` (public, **express.text raw-body** для `application/jose`): `BillingService.handleProviderWebhook` → `provider.verifyWebhookSignature` (JWT через `crypto.createPublicKey({format:'jwk'})` + `jsonwebtoken.verify`) → `parseWebhook` → дедуп по `BillingEventLog.externalEventId` (формат `<eventType>:<operationId>:<status>`) → найти Invoice по `providerInvoiceId` или `id` (paymentLinkId) → при `APPROVED\|payment_paid` → `finalizePaidInvoice`. В `finalizePaidInvoice`: `$transaction { invoices.markPaid + subscriptions.transition(to:ACTIVE, dataPatch:{currentPeriodStart/End, totalPaidKopecks:+invoice.totalKopecks}) + BillingEventLog('invoice.paid') }`; ПОСЛЕ tx — fire-and-forget `events.emitAsync(BillingEvent.INVOICE_PAID, {invoiceId, tenantId, subscriptionId, amountKopecks, paymentMode:'paid', paidAt})` | `backend/src/modules/billing/billing-webhook.controller.ts:60..72`, `backend/src/modules/billing/services/billing.service.ts:328..390` (handle), `:403..469` (finalize), `backend/src/modules/billing/providers/tochka/tochka-webhook-verifier.service.ts` | `POST /api/v1/internal/billing/provider-events` (public, raw body) | `BillingEventLog('provider.webhook' + 'invoice.paid')`, `Invoice(status='paid', paidAt, externalRef)`, `Subscription(status='ACTIVE', currentPeriodStart/End, totalPaidKopecks+=)`, `SubscriptionEvent('renewed')`, `MeetingsBalance.balance+=grant` (через subscription transition events) | ✅ |
| 8 | Safety-net синк статусов | `InvoiceStatusSyncCron @Cron('*/15 * * * *')`: с Redis-локом `billing:invoice-status-sync:lock` (TTL 600с) идёт по `Invoice {status:'issued', providerName:'tochka', providerInvoiceId IS NOT NULL, paymentMethod IN (card_recurring,bank_invoice)}`; для `bank_invoice` — `provider.getBankInvoiceStatus`, для `card_recurring` — `provider.getPaymentStatus`; при `payment_paid|succeeded` → `billing.finalizePaidInvoice` (тот же путь что и вебхук, идемпотентно через `if status='paid' → no-op`) | `backend/src/modules/billing/services/invoice-status-sync.cron.ts` | cron `*/15 * * * *`, kill-switch `cfg.billing.features.tochka` | (см. шаг 7) | ✅ |
| 9 | Recurring charge | `TochkaRecurringChargeCron @Cron('0 * * * *')`: Redis-лок `billing:tochka-recurring-charge:lock` (TTL 900с); фильтр `Subscription {status:'ACTIVE', autoRenew:true, renewalMethod:'card_recurring', providerSubscriptionId NOT NULL, currentPeriodEnd < now+3d, lastRenewalAttemptAt < now-6h}`; `provider.chargeRecurringSubscription({providerSubscriptionId, amountKopecks: yearly? monthly*12*0.8 : monthly})`; обновляет `Subscription.lastRenewalAttemptAt=now`. Финализация — через webhook (см. шаг 7) | `backend/src/modules/billing/services/tochka-recurring-charge.cron.ts` | cron `0 * * * *`, kill-switch `cfg.billing.features.cardRecurring` + `provider.providerName === 'tochka'` | `Subscription.lastRenewalAttemptAt` | ✅ |
| 10 | Дневной cycle | `BillingCycleCron @Cron('0 3 * * *', tz='Europe/Moscow')`: Redis-лок `billing:cycle-cron:lock` (TTL 600с). 4 шага: (а) `PAST_DUE → SUSPENDED` если `pastDueUntil < now`; (б) `CANCELED → EXPIRED` если `currentPeriodEnd < now`; (в) `ACTIVE+bonus → EXPIRED` если bonus-период истёк; (г) `ACTIVE+paid+autoRenew → PAST_DUE` с `pastDueUntil = now+7d`. Все переходы через `SubscriptionService.transition` (FSM-валидация + `SubscriptionEvent`) | `backend/src/modules/billing/services/billing-cycle.cron.ts:56..97`, `subscription-fsm.ts` (таблица переходов) | cron `0 3 * * *` Europe/Moscow | `Subscription.status` + `SubscriptionEvent` | ✅ |

### 5.1 Структура данных, через которые проходит процесс

```
POST /billing/pay/card | /pay/bank-invoice
  ↓ BillingService.createCardPayment | createBankInvoicePayment
Invoice(status=draft, items[BASE, SEATS?, YEARLY_DISCOUNT?])
  ↓ provider.createPayment | createRecurringSubscription | createBankInvoice
Invoice(status=issued, providerInvoiceId, paymentUrl, providerName=tochka)
  ↓ (внешняя оплата клиентом в Точке)
POST /internal/billing/provider-events (JWT-строка, raw body)
  ↓ verifyJWT + dedup BillingEventLog.externalEventId
  ↓ finalizePaidInvoice $transaction
Invoice(status=paid, paidAt, externalRef)
  + Subscription(status=ACTIVE, currentPeriodStart/End, totalPaidKopecks+=)
  + SubscriptionEvent(renewed)
  + BillingEventLog(invoice.paid, processed)
  ↓ fire-and-forget emit
billing.invoice.paid (EventEmitter2) → ReferralPayoutService.onInvoicePaid
  ↓ subscription transition events
MeetingsBalance.balance += seats.calculateMeetingsGrant(seatsExtra)
  ⋮ (асинхронно, cron)
TochkaRecurringChargeCron 0 * * * * → provider.chargeRecurringSubscription
InvoiceStatusSyncCron */15 * * * * → safety net
BillingCycleCron 0 3 * * * Europe/Moscow → FSM transitions PAST_DUE/SUSPENDED/EXPIRED
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| — | — | — | — | LLM в биллинге не используется |

(Биллинг — чистая транзакционная логика без AI-вызовов.)

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (с 2026-05-30, Фаза 4 commercial-reliability pack):**
- `billing_invoice_created_total{tenant_top,kind}` — Invoice создан.
- `billing_invoice_paid_total{tenant_top,kind}` — Invoice оплачен (инкрементируется в `BillingService.finalizePaidInvoice`).
- `billing_subscription_renewed_total{tenant_top,tier}` — Subscription продлена (там же).
- `billing_subscription_cancelled_total{tenant_top,reason}` — Subscription отменена (метрика зарегистрирована, inc-вызов добавляется по мере появления отмен в коде).
- `billing_webhook_received_total{provider,status}` — webhook от провайдера (метрика зарегистрирована; status: ok|sig_fail|replay|invalid_payload).
- `billing_provider_request_duration_seconds{provider,method,status}` — гистограмма исходящих HTTP-запросов в Точку (зарегистрирована).
- Алёрты/Grafana-дашборд биллинга (`BillingNoPaymentsLong`, `BillingWebhookSignatureFailures`, 4 панели) — in-repo конфиг `infra/prometheus/`+`infra/grafana/` удалён 2026-06-17 (метрики в `/metrics` остались; восстановим из git при поднятии мониторинга).
- Общие cron-метрики `nestjs_schedule_*` (если включены) — частично.

**BullMQ очереди:** биллинг не использует очереди — всё inline в cron + webhook.

**Тумблеры / kill-switch (ENV → `cfg.billing.*`):**
- `BILLING_PROVIDER='tochka'|'manual'` — фабрика провайдера в `BillingModule:86`.
- `FEATURE_BILLING_TOCHKA=false` → `assertFeature` бросает 403 на все pay-эндпоинты; OAuth и webhook auto-register пропускаются в `BillingModule.onApplicationBootstrap`.
- `FEATURE_BILLING_CARD_RECURRING`, `FEATURE_BILLING_BANK_INVOICE` — узкие kill-switch по способам.
- `TOCHKA_MODE='sandbox'|'production'` — `TochkaOAuthService.ensureOAuthReady` пропускается в sandbox; используется статичный bearer-токен.
- `TOCHKA_WEBHOOK_AUTO_REGISTER` — если true, при старте через 1500мс делается `TochkaWebhookRegistrarService.registerOnce`.

**Redis-локи (защита от двойного запуска):**
- `billing:cycle-cron:lock` TTL 600с (BillingCycleCron)
- `billing:tochka-recurring-charge:lock` TTL 900с (TochkaRecurringChargeCron)
- `billing:invoice-status-sync:lock` TTL 600с (InvoiceStatusSyncCron)

**Логи:** `BillingService`, `SubscriptionService`, `BillingCycleCron`, `TochkaRecurringChargeCron`, `InvoiceStatusSyncCron`, `TochkaOAuthService`, `TochkaWebhookRegistrarService`.

**Известные грабли:**
- **Webhook ВСЕГДА отвечает 200** (`handleProviderWebhook` никогда не throws) — даже на invalid signature / duplicate / unknown invoice. Это обязательно для Точки (она ретраит на не-200), но скрывает баги; смотреть надо в логи (`Provider webhook: ...`) и `BillingEventLog`.
- **Денежные суммы — в копейках** (`Int`), при отправке в Точку делятся на 100 через `Math.round(amountKopecks/100)`. Парсинг входа — обратное умножение. Расхождение в копейках при rounding — известная грабля.
- **Webhook body — JWT-строка**, не JSON. Маршрут `/internal/billing/provider-events` требует `express.text({type:'*/*'})` middleware ДО глобального JSON-парсера (см. `main.ts`).
- **`paymentLinkId = Invoice.id`** обязательно передаётся в `createPayment/createBankInvoice/createRecurringSubscription`, иначе webhook не найдёт инвойс. Fallback при поиске — `OR: [{providerInvoiceId}, {id}]` (`billing.service.ts:362`).
- **OAuth state TTL 15 мин** — если админ открыл authorize URL и тянет дольше — callback вернёт 400.
- **Refresh-token обновляется за 5 мин до expires_at** (TOCHKA_TOKEN_REFRESH_MARGIN_MS).
- **TochkaRecurringChargeCron не списывает на manual-провайдере** — early return на `provider.providerName !== 'tochka'`.

**Кнопки админки (UI-поверхность саппорта, 2026-05-29 admin-subscription-ui-v2):**
- `/admin/orgs/[id]?tab=billing` — Тариф и лимиты (entitlements: tier,
  features, quotas с overrides) — `BillingAdminClient`.
- `/admin/orgs/[id]?tab=subscription` — **Подписка и счета** —
  `AdminSubscriptionClient`:
  - **Ручная активация** (paid/bonus + reason ≥3) — обходит провайдера,
    через `ManualBillingService.activate`. Бонусный режим помечен
    отдельным жёлтым Badge «Бонус» в карточке текущей подписки.
  - **Изменить места** — диалог `AdjustSeatsDialog` для `adjust-seats`
    с pro-rata-подсказкой (для monthly — daysLeftInMonthlyPeriod, для
    yearly — monthsLeftInYearlyPeriod). Доплата считается на бэке.
  - **Принудительно сменить статус** — диалог `ForceStatusDialog`
    (`force-status`). Обход FSM подписки: двойное подтверждение
    (reason ≥3 + чекбокс «Я понимаю, что обхожу FSM»). Действие пишется
    в `AdminAuditLog`.
  - **Inline-кнопки на каждом инвойсе** (`InvoiceRowActions`):
    - `mark-paid` (видна для `issued`) — модал с обязательным
      `externalRef` (номер платёжки) + `reason ≥3`. Идемпотентно —
      `InvoiceService.markPaid` + `ReferralPayoutService.onInvoicePaid`
      защищают от дубля реф-выплаты.
    - `void` (видна для `draft` / `issued`) — модал с `reason ≥3`. Для
      `paid`/`bonus` кнопка скрыта (бэк всё равно вернёт 403).
  - **Таймлайн событий** (`SubscriptionEventsTimeline`) — последние 100
    `SubscriptionEvent` (`adminGetEvents`): цветной бейдж по типу
    события, дата, инициатор (`byUserId`), reason, accordion с
    payload (JSON).
- Старые URL `/admin/orgs/[id]/billing` и `/admin/orgs/[id]/subscription`
  редиректят на соответствующий `?tab=`. Из списка Org кнопка «Тариф»
  ведёт сразу на `?tab=billing` без редиректа.
- `/admin/billing-overview` — MRR/ARR/активные/churn (агрегированные
  метрики по всем Org). В sidebar — раздел «Тенанты» → «Биллинг — обзор».
- `/admin/integrations/tochka` — статус OAuth (есть ли токены), кнопка
  «Подключить» (получить authorize URL), кнопка «Зарегистрировать webhook».
- `POST /admin/billing/tochka/webhook/register` — принудительная
  регистрация webhook'а.
- `POST /admin/billing/tochka/oauth/authorize-url` — выдать URL для
  авторизации (super_admin).

## 7. Связанные процессы

- [[signup-and-onboarding-wizard]] — создаёт `Subscription(status='DEMO')` для новой Org; владелец потом может оплатить тариф через этот процесс. Связь через `Org.id` (tenantId) — биллинг-страница доступна только когда владелец завершил онбординг.
- [[referral-program]] — подписывается на `billing.invoice.paid` через `@OnEvent`; при `paymentMode='paid'` создаёт `ReferralPayout(pending, 2 000 000 kopecks)`. Сюда от нас идёт fire-and-forget эмит из `finalizePaidInvoice`.
- [[notification-dispatch]] — общий dispatcher для отправки PDF-счёта на email (через `provider.sendBankInvoiceToEmail`), напоминаний о грядущем продлении, уведомлений о неуспешной попытке списания (`PAST_DUE`-grace).

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, НЕ реализовано:**
- **Фаза 7 — Tochka production OAuth + webhook**: код провайдера, OAuth-сервиса, webhook-верификатора и `BillingModule.onApplicationBootstrap` готовы и протестированы юнитами, но **реальная авторизация в проде — операция владельца, ещё не выполнена**: `BillingProviderConfig['tochka.production.oauth_tokens']` в production-БД пуст; админ должен открыть authorize URL в браузере, пройти консент, и принять callback. Без этого `getAccessToken()` падает, и pay-эндпоинты с `provider='tochka'` вернут 500. См. `plans/archive/2026-05-27-billing-tochka-referral-dadata-z.md` §14 Фаза 7.
- **Фаза 9 — Frontend (~6 страниц)** реализован **частично**:
  - ✅ `/admin/orgs/[id]/subscription`, `/admin/billing-overview`, `/admin/integrations/tochka` — есть.
  - ❌ Полноценная owner-страница `/settings/billing` с формами оплаты «картой / счётом», pricing-калькулятором, выбором тарифа — **нет**: текущий `BillingClient.tsx` показывает старые entitlements (`entitlement.tier`, `quotas`, `features` через `entitlementsApi`), не новый billing с `Subscription(tier_standard)` и `SeatService.calculatePricing`. Это legacy от Фазы 12 paywall, не обновлено.
  - ✅ `/admin/orgs/[id]/billing` (карточка биллинга Org в админке) — реализовано как таб `?tab=billing` карточки Org (`OrgDetailClient.tsx`), рендерит `BillingAdminClient` (entitlements). Standalone-URL делает 307-redirect (2026-05-29 admin-subscription-ui-v2).
  - ❌ `/referrals` есть, но это отдельный процесс (см. [[referral-program]]).
- ~~**Метрики Prometheus для биллинга** — ни одной не зарегистрировано~~ — **закрыто 2026-05-30 (Фаза 4 commercial-reliability pack)**: зарегистрировано 6 метрик (5 counter + 1 histogram) с префиксом `billing_*`, 3 алёрта в `infra/prometheus/alerts/billing-referrals.rules.yml`, Grafana-дашборд `infra/grafana/dashboards/billing-referrals.json`. Inc-вызовы `incBillingInvoicePaid` и `incBillingSubscriptionRenewed` подключены в `BillingService.finalizePaidInvoice`. Остальные `incBilling*` методы зарегистрированы (метрики появятся в `/metrics`), inc-вызовы добавятся вместе с прохождением соответствующих кодовых путей (cancelled, webhook received status, provider request duration).
- **`/billing/billing-details` PATCH с optimistic-lock `version`** (ТЗ §11.1) — реализация по факту не верифицирована точечно (поле `Org.billingDetailsVersion` есть в схеме, но endpoint не найден поиском в `billing.controller.ts`).
- **Renewal-reminder cron** (письма за 7/3/1 день до продления) — упомянут в ТЗ §7.1 как `RenewalReminderCron`, в `BillingModule.providers` НЕ зарегистрирован и файл не найден.

**Реализовано иначе:**
- **InvoiceNumber через `Int @unique @default(autoincrement())` + строковая обёртка `Z-YYYY-NNNNNN`** в `InvoiceNumberService` — выбран вариант 2 из ТЗ §16.14 (вместо Postgres SEQUENCE).
- **`Subscription.providerCustomerCode` / `providerConsumerId`** — поля есть в схеме, но в `billing.service.ts:151` используется ENV `TOCHKA_CUSTOMER_CODE` (`cfg.billing.tochka.customerCode ?? 'manual'`), per-Org customer code не передаётся в Точку. Это упрощение MVP.
- **Старая страница `/settings/billing`** показывает legacy entitlements (Фаза 12 paywall, `entitlementFromApi`, `FEATURE_GROUPS`, `ALL_QUOTAS`) и кнопку «Связаться с нами», а не новый flow оплаты картой/счётом. Создаёт UX-путаницу: пользователь видит «лимиты» и tier, но не видит, как оплатить подписку через Точку.

**Реализовано, НЕ описано в ТЗ:**
- **`SubscriptionGuard` (paywall без trial)** в `backend/src/modules/billing/guards/subscription.guard.ts` + декоратор `@RequireSubscription` — отдельный механизм гейтинга платных фич (по событиям `Subscription.status`). Это сделано отдельным ТЗ `2026-05-28-paywall-no-trial.md` (Фаза β-Paywall), но логически близко к биллингу.
- **`ManualBillingService.activate(paid|bonus)`** для админской активации без провайдера — путь обхода Точки на канарейке/спецклиентов; обязательный `reason` пишется в `SubscriptionEvent.reason` и `AdminAuditLog`.
- **`BillingEventService.log({externalEventId})`** с дедупом по `BillingEventLog.externalEventId` — генеральная защита от дубликатов вебхуков и retry'ев.

**Связи с другими процессами:**
- `MeetingsBalance.grant` происходит не в этом процессе напрямую, а в `SubscriptionService.transition` через event-bus при `to:'ACTIVE'`. Это значит, что баланс встреч пополняется каждый раз при активации/продлении, независимо от того, какой провайдер (Точка/manual/bonus) триггерит транзишен.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-30 | Закрыт observability-gap: 6 метрик `billing_*` + 3 алёрта + Grafana-дашборд. `incBillingInvoicePaid`/`incBillingSubscriptionRenewed` подключены в `finalizePaidInvoice`. | plans/tz/2026-05-29-commercial-reliability-package.md Фаза 4 |
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-29 | Paywall Фазы 4-5 завершены | `b8b57d6 feat(paywall): рефакторинг Фаз 1-3 + завершение Фаз 4-5` |
| 2026-05-29 | UI-поверхность саппорта закрыта: табы Org-карточки, mark-paid / void / adjust-seats / force-status / events timeline, Badge «Бонус», пункт «Биллинг — обзор» в sidebar | `plans/archive/2026-05-29-admin-subscription-ui-v2.md` |
| 2026-05-27 | ТЗ объединённого биллинга + InnLookup + рефералов | `plans/archive/2026-05-27-billing-tochka-referral-dadata-z.md` |
| ≥2026-05-27 | Фазы 1-6 реализованы (Prisma, ENV, inn-lookup, meetings-balance, ядро биллинга + ManualBillingProvider, Tochka sandbox + recurring/sync/cycle cron, рефералы), 139 unit-тестов pass | по фазам ТЗ |

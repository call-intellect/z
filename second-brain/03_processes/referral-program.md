---
name: referral-program
title: Реферальная программа — slug, beacon, выплата 10-го числа
trigger_type: event
status_overall: implemented
last_audited: 2026-05-30
owners_human:
  - продакт-партнёрский (отвечает за реф-программу)
  - финансовый директор (для подписания оферт и фактических выплат)
related_plans:
  - plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md
  - plans/analysis/2026-05-25-billing-and-referrals.md
related_projects:
  - 01_projects/referrals.md
  - 01_projects/billing.md
  - 01_projects/inn-lookup.md
---

# Реферальная программа — slug, beacon, выплата 10-го числа

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

У каждого клиента платформы есть личная партнёрская страница. Там он видит свою короткую ссылку — что-то вроде `app.z.ru/?ref=k7m4ax2p`. Этой ссылкой он делится с друзьями, в соцсетях, рассылках. Один человек — одна ссылка, она присваивается навсегда.

Когда кто-то переходит по этой ссылке на сайт платформы, лендинг тихо ставит этому посетителю «метку» — она лежит в браузере девяносто дней. Параллельно с меткой в браузере, сам факт перехода фиксируется у нас в системе: какой партнёр привёл, с какого устройства, в какое время. Это нужно, чтобы партнёр получил вознаграждение, даже если новый клиент зарегистрировался не сразу, а через месяц или два.

Если посетитель в течение этих девяноста дней зарегистрировал компанию на платформе, его «новая компания» автоматически привязывается к партнёру. Но партнёр получает деньги не за регистрацию, а за **реальную оплату** — двадцать тысяч рублей за каждую успешную оплату подписки приведённой компанией. Бонусные активации (когда мы сами решили подарить тариф) не считаются.

Десятого числа каждого месяца автоматическая служба собирает все «начисления» за прошлый месяц и проверяет: у партнёра есть подтверждённый ИНН? Принята ли публичная оферта? Если оба «да» — начисление помечается как «к выплате», и финансовый директор перечисляет деньги с расчётного счёта банка. Если что-то не оформлено — начисление обнуляется с пометкой «партнёр не верифицирован».

## 2. Что запускает (триггер)

- **Тип:** событие (оплата подписки) + действие пользователя (beacon на лендинге) + расписание (cron 10-го числа).
- **Кто инициирует (главное):** счёт приведённой компании переходит в статус `paid` (событие `billing.invoice.paid`).
- **Технический источник:** `@OnEvent(BillingEvent.INVOICE_PAID)` в `ReferralPayoutService` (event-bus в памяти, не очередь); параллельно `POST /api/v1/public/referrals/attribution` (beacon, public, throttle 10/min/IP) и `@Cron('0 10 10 * *', tz='Europe/Moscow')` — выплата 10-го числа в 10:00 МСК.

## 3. Шаги процесса (общий список)

1. **Партнёр создаёт реферальный профиль** в своём кабинете: указывает ИНН, форму ведения деятельности (самозанятый / ИП / юрлицо), реквизиты для выплат; платформа генерирует уникальный короткий slug (8 символов без 0/o/l/1).
2. **Партнёр верифицирует ИНН** через `InnLookupService` — это нужно для будущей выплаты, без верифицированного ИНН деньги не уйдут.
3. **Партнёр принимает публичную оферту** — фиксируется `contractAcceptedAt`. Это второе обязательное условие выплаты.
4. **Партнёр делится ссылкой** вида `app.z.ru/?ref=<slug>`. Лендинг ставит cookie `z_ref=<slug>` на 90 дней.
5. **Лендинг параллельно отправляет beacon** на наш сервер: `POST /public/referrals/attribution` с slug, fingerprint, referer, IP, user-agent. Создаётся запись `ReferralAttribution` с `expiresAt = now + 90d`.
6. **Посетитель регистрирует компанию** (см. [[signup-and-onboarding-wizard]]). Сразу после signup фронт вызывает `POST /referrals/attribute-current-org` — backend ищет последнюю не-истёкшую атрибуцию по cookie/fingerprint и пишет `Org.pendingAttributionSlug` + `pendingAttributionAt`. `ClientReferralLink` пока **не создаётся** — ждём первой оплаты.
7. **Когда новая компания оплачивает подписку** (см. [[billing-cycle-tochka]] шаг 7), эмитится событие `billing.invoice.paid` с `paymentMode='paid'`.
8. **`ReferralPayoutService.onInvoicePaid` реагирует** на это событие: при `paymentMode='paid'` — создаёт `ClientReferralLink(firstPaidAt=now)` из `Org.pendingAttributionSlug` (если линка ещё нет), и создаёт `ReferralPayout(pending, 2 000 000 коп)`. При `paymentMode='bonus'` ничего не создаётся (Б6).
9. **Десятого числа каждого месяца в 10:00 МСК** `ReferralPayoutCron` находит все `pending`-payout'ы за прошлый месяц: для верифицированных партнёров (`innVerifiedAt && contractAcceptedAt`) — переводит в `paid` + `paidAt=now`; для остальных — в `void` с `voidReason='referral_not_verified'`. Это закрытие периода в нашей БД — фактическую выплату делает финдиректор руками через банк.
10. **Партнёр видит начисление** в своём кабинете на `/referrals` — список приведённых клиентов, статусы payout'ов (pending / paid / void), общую сумму.

## 4. Что получается на выходе

- **Запись в БД:**
  - `Referral(slug, inn, legalForm, payoutDetails, innVerifiedAt?, contractAcceptedAt?)` — профиль партнёра.
  - `ReferralAttribution(slug, fingerprint, ip, userAgent, referer, expiresAt)` — сырые касания.
  - `Org.pendingAttributionSlug` + `pendingAttributionAt` — pending-привязка до первой оплаты.
  - `ClientReferralLink(tenantId, referralId, firstPaidAt)` — first-touch активация при первой `paid` оплате.
  - `ReferralPayout(triggerInvoiceId, periodMonth, amountKopecks=2 000 000, status: pending → paid|void)` — начисление.
- **Партнёру:** ссылка `app.z.ru/?ref=<slug>` (QR-код в кабинете), список приведённых клиентов и payout'ов на `/referrals`.
- **Админу:** `/admin/referrals` — список всех партнёров и payout'ов, кнопки mark-paid / void.

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Создание профиля | `POST /referrals/me`: `ReferralsService.create({ ownerUserId, inn, legalForm, payoutDetails })`; slug через `customAlphabet('abcdefghijkmnpqrstuvwxyz23456789', 8)` (nanoid) — символы без 0/o/l/1 для удобства устной передачи; уникальность ownerUserId через `@unique` на колонке | `backend/src/modules/referrals/services/referrals.service.ts:37..39,75..` (`create`), `backend/src/modules/referrals/controllers/referrals.controller.ts:80..` (`POST /me`) | `POST /api/v1/referrals/me` | `Referral(slug, inn, legalForm, payoutDetails)` | ✅ |
| 2 | Верификация ИНН | `POST /referrals/me/verify-inn`: `ReferralsService.verifyInn` → `InnLookupService.lookup(referral.inn)` (mock/dadata/tochka_then_dadata); при успехе → `innVerifiedAt = now`; без сравнения с ownerName (на MVP доверяем) | `backend/src/modules/referrals/services/referrals.service.ts` (`verifyInn`), `backend/src/modules/inn-lookup/inn-lookup.service.ts` | `POST /api/v1/referrals/me/verify-inn` | `Referral.innVerifiedAt` | ✅ |
| 3 | Принятие оферты | `POST /referrals/me/accept-contract`: ставит `Referral.contractAcceptedAt = now`. Без этого + без `innVerifiedAt` cron 10-го числа НЕ переведёт payout в `paid` (см. шаг 9) | `backend/src/modules/referrals/services/referrals.service.ts` (`acceptContract`), `referrals.controller.ts` | `POST /api/v1/referrals/me/accept-contract` | `Referral.contractAcceptedAt` | ✅ |
| 4 | Распространение ссылки | На лендинге `app.z.ru/?ref=<slug>` — JS ставит cookie `z_ref=<slug>` (HttpOnly=false, 90 дней) и сразу шлёт beacon (шаг 5). При signup фронт читает `?ref=` из URL и кладёт в форму — `User.signupRef` сохраняется (но это вторая защита от потери cookie, основной trail — через `ReferralAttribution`) | лендинг (вне репо) + `frontend/app/signup/SignupForm.tsx:27` (чтение `ref` из URL) | — | `User.signupRef` (опц.) | ✅ |
| 5 | Beacon от лендинга | `POST /public/referrals/attribution` (public, throttle 10/min/IP через `@nestjs/throttler`); `AttributionService.record({slug, fingerprint?, ip?, userAgent?, referer?})` — ищет `Referral` по slug, при найденном создаёт `ReferralAttribution(expiresAt = now + 90d)`. На неизвестный slug — `logger.warn` + skip (не throw, beacon идемпотентен). Контроллер отвечает 204 No Content | `backend/src/modules/referrals/controllers/public-referrals.controller.ts:38..65`, `backend/src/modules/referrals/services/attribution.service.ts:64..94` | `POST /api/v1/public/referrals/attribution` (public, throttle 10/min) | `ReferralAttribution` | ✅ |
| 6 | Резолв атрибуции при регистрации Org | `POST /api/v1/referrals/attribute-current-org` (auth, после signup): `AttributionService.attributeOrg({tenantId, cookieSlug?, fingerprint?, ip?})` — сперва ищет по cookie slug (последнюю не-истёкшую через `findFirst orderBy: createdAt desc`), потом fallback по fingerprint; найденную атрибуцию сохраняет в `Org.pendingAttributionSlug + pendingAttributionAt`. **ClientReferralLink НЕ создаётся** — он создастся только при первой `paid` оплате | `backend/src/modules/referrals/services/attribution.service.ts:102..151` (`attributeOrg`), `referrals.controller.ts` (`POST /attribute-current-org`) | `POST /api/v1/referrals/attribute-current-org` | `Org.pendingAttributionSlug`, `Org.pendingAttributionAt` | ✅ |
| 7 | Событие оплаты | `BillingService.finalizePaidInvoice` после tx делает fire-and-forget `events.emitAsync(BillingEvent.INVOICE_PAID, {invoiceId, tenantId, subscriptionId, amountKopecks, paymentMode:'paid'\|'bonus', paidAt})` через EventEmitter2 (in-memory) | `backend/src/modules/billing/services/billing.service.ts:459..468`, `backend/src/modules/billing/events/billing.events.ts` | EventEmitter2 (in-memory) | — (источник события) | ✅ |
| 8 | Создание payout | `ReferralPayoutService.onInvoicePaid @OnEvent(INVOICE_PAID, {async:true})`: ранний выход если `paymentMode!='paid'` (Б6) или `!subscriptionId`. Идемпотентность: `findFirst ReferralPayout {triggerInvoiceId}` → если есть, skip. Иначе: если у Subscription уже есть `clientReferralLink` → используем его; иначе `attribution.resolvePendingForOrg(tenantId)` → создаёт `ClientReferralLink(firstPaidAt=now)` + `attribution.clearPendingForOrg`. Затем `ReferralPayout(periodMonth='YYYY-MM' из paidAt UTC, amountKopecks=2 000 000, status='pending')` | `backend/src/modules/referrals/services/referral-payout.service.ts:48 (константа)`, `:67..147` (onInvoicePaid), `attribution.service.ts:158..178` (`resolvePendingForOrg`) | `@OnEvent('billing.invoice.paid')` (in-memory) | `ClientReferralLink`, `ReferralPayout(status='pending')`; очистка `Org.pendingAttribution*` | ✅ |
| 9 | Cron 10-го числа | `@Cron('0 10 10 * *', tz='Europe/Moscow')` `runMonthlyClose`: Redis-лок `referral:payout-cron:lock` TTL 1800с; `previousMonth(now) → periodMonth='YYYY-MM'`; `closePeriod(periodMonth)` — для каждого `pending`-payout проверяет `referral.innVerifiedAt && contractAcceptedAt`: верифицирован → `status='paid', paidAt=now`; нет → `status='void', voidReason='referral_not_verified'`. **Фактическую банковскую выплату делает финдиректор руками**, cron только закрывает периоды | `backend/src/modules/referrals/services/referral-payout.service.ts:50..52 (lock), :158..181 (cron), :186..245 (closePeriod)` | cron `0 10 10 * *` Europe/Moscow | `ReferralPayout.status`, `paidAt`, `voidReason` | ✅ |
| 10 | Кабинет партнёра | `GET /referrals/me` — профиль, `GET /referrals/me/clients` — приведённые компании, `GET /referrals/me/payouts` — начисления, `GET /referrals/me/stats` — агрегат. Фронт — `/referrals` страница: состояния «нет профиля → форма», «есть, не верифицирован → CTA verify+accept», «готов → ссылка для копирования + статистика + payouts» | `backend/src/modules/referrals/controllers/referrals.controller.ts:72..end`, `frontend/app/(authenticated)/referrals/{page,ReferralsClient}.tsx` | `GET /api/v1/referrals/me*` | — (read) | ✅ |

### 5.1 Структура данных, через которые проходит процесс

```
POST /referrals/me { inn, legalForm, payoutDetails }
  ↓ ReferralsService.create + nanoid slug
Referral(slug, inn, legalForm, payoutDetails)
  ↓ POST /referrals/me/verify-inn → InnLookupService.lookup
Referral.innVerifiedAt = now
  ↓ POST /referrals/me/accept-contract
Referral.contractAcceptedAt = now

  ⋮ (параллельно — лендинг)
GET app.z.ru/?ref=<slug>
  ↓ cookie z_ref + beacon POST /public/referrals/attribution
ReferralAttribution(slug, fingerprint, ip, ua, referer, expiresAt=now+90d)

  ⋮ (когда посетитель регистрирует Org)
POST /accounts/register → Org(...)
  ↓ POST /referrals/attribute-current-org
AttributionService.attributeOrg → Org.pendingAttributionSlug + pendingAttributionAt
  (ClientReferralLink ещё НЕ создаётся)

  ⋮ (когда Org впервые платит подписку)
BillingService.finalizePaidInvoice → emit billing.invoice.paid
  ↓ @OnEvent → ReferralPayoutService.onInvoicePaid
если paymentMode='paid':
  ClientReferralLink(tenantId, referralId, firstPaidAt=now)  ← first-touch
  + ReferralPayout(triggerInvoiceId, periodMonth, amountKopecks=2_000_000, status='pending')
  + Org.pendingAttribution* = null
(если 'bonus' — ничего не делаем)

  ⋮ (10-го числа в 10:00 МСК)
@Cron ReferralPayoutCron.runMonthlyClose → closePeriod('YYYY-MM' (previous))
для каждого pending:
  innVerifiedAt + contractAcceptedAt → status='paid', paidAt=now
  иначе → status='void', voidReason='referral_not_verified'
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| — | — | — | — | LLM в реферальной программе не используется |

(Lookup ИНН (шаг 2) — это HTTP-вызов в DaData/Tochka/Mock, не LLM.)

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (с 2026-05-30, Фаза 4 commercial-reliability pack):**
- `referral_click_total{partner_top}` — клик по реф-ссылке (`AttributionService.record` success).
- `referral_signup_total{partner_top}` — Org first-touch атрибутирована (`AttributionService.attributeOrg` count=1).
- `referral_payout_created_total{cron_run_date}` — ReferralPayout(pending) создан (`onInvoicePaid` после `referralPayout.create`).
- `referral_payout_amount_rub_total` — суммарный объём payout'ов в рублях.
- `referral_attribution_first_touch_locked_total` — отброшенный повторный клик (`updateMany.count===0`).
- `referral_self_referral_denied_total` (с audit Б6) — self-referral блокирован.
- `referral_inn_mismatch_total` (с audit Б6) — блок по ИНН.
- Алёрт `ReferralPayoutCronDidNotRun` (10-го числа после 4ч простоя) в `infra/prometheus/alerts/billing-referrals.rules.yml`.
- Grafana: панель «реферальная воронка» в `infra/grafana/dashboards/billing-referrals.json`.

**BullMQ очереди:** реферальная программа не использует очереди — `@OnEvent` и `@Cron` напрямую.

**Redis-локи:**
- `referral:payout-cron:lock` TTL 1800с — защита от двойного запуска `runMonthlyClose` (10-е число, если cron'ы случайно дублируются).

**Тумблеры / kill-switch:**
- Throttle: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` на public beacon.
- `INN_LOOKUP_PROVIDER='mock'|'dadata'|'tochka_then_dadata'` — влияет на верификацию ИНН партнёра (шаг 2).
- Атрибуция через cookie + fingerprint жёстко закодирована, ENV-тумблера на отключение нет.

**Логи:** `AttributionService`, `ReferralPayoutService`, `ReferralsService`, `PublicReferralsController`.

**Известные грабли:**
- **Атрибуция first-touch + 90 дней (2026-05-30, Фаза 2 commercial-reliability pack)**: `attributeOrg` гарантирует first-touch на уровне `Org.pendingAttributionSlug` — `updateMany WHERE pendingAttributionSlug IS NULL`. Повторный клик по другому slug в 90-дневное окно НЕ перезаписывает первую атрибуцию; событие отражается в метрике `referral_attribution_first_touch_locked_total`. После `clearPendingForOrg` (первая оплата → `ClientReferralLink`) поле обнуляется и следующая Org того же пользователя получит свою first-touch.
- **EventEmitter2 in-memory**: `billing.invoice.paid` доставляется только внутри одного процесса. Если webhook пришёл на backend-инстанс, а worker крутится на другом — событие не доедет. У нас backend monolith + worker (отдельный процесс с тем же кодом), worker НЕ слушает webhook'и Точки, так что баг не материализуется, но это потенциальная грабля при переходе на mult-process backend.
- **`bonus`-активация НЕ создаёт payout** (Б6). Если админ хочет дать партнёрское вознаграждение за бонус-клиента — придётся руками создавать ReferralPayout через admin-эндпоинт; такого endpoint'а сейчас нет.
- **Cookie `z_ref` ставится JS-кодом на лендинге**, и это **внешний код вне репо**. Изменения схемы атрибуции требуют синхронной правки и в лендинге, и в `AttributionService`. Контракт держится на slug + fingerprint + ip.
- **Атрибуция партнёра к самому себе** не проверяется: если партнёр кликнет по своей же ссылке и зарегистрирует Org — он привяжет сам себя к себе, и при оплате получит вознаграждение. На MVP это не закрыто.
- **`innVerifiedAt` без сравнения с владельцем** (комментарий в `referrals.service.ts:10`) — партнёр может верифицировать чужой ИНН. На MVP доверяем; реальная защита — момент фактической выплаты со стороны финдира.

**Кнопки админки:**
- `/admin/referrals` — список партнёров и payout'ов с фильтрами по `status` (`pending|paid|void`) и `periodMonth` (`YYYY-MM`).
- `POST /admin/referrals/payouts/:id/mark-paid` — пометить payout как paid руками (с опц. `payoutDocumentUrl` — ссылка на акт / чек НПД).
- `POST /admin/referrals/payouts/:id/void` — аннулировать с обязательным `voidReason`.
- `POST /admin/referrals/close-period` — ручной запуск `closePeriod(periodMonth)` для отладки cron.

## 7. Связанные процессы

- [[signup-and-onboarding-wizard]] — шаг 4 ставит cookie `z_ref` ещё до регистрации; в нашем шаге 6 frontend дёргает `POST /referrals/attribute-current-org` после signup, чтобы связать атрибуцию с новой Org. `User.signupRef` (из формы регистрации) — вторая защита от потери cookie.
- [[billing-cycle-tochka]] — основной триггер этой программы: `billing.invoice.paid` (шаг 7 биллинга → шаг 8 здесь). При `paymentMode='paid'` создаётся `ReferralPayout`. Сам биллинг ничего не знает про рефералов — связь только через событие.
- [[notification-dispatch]] — потенциально доставляет партнёру уведомления «вам начислено», «период закрыт», «партнёрская выплата сделана». В текущем коде эти уведомления НЕ реализованы — это observability/UX-gap.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, НЕ реализовано:**
- ~~**Метрики Prometheus** для воронки~~ — **закрыто 2026-05-30 (Фаза 4 commercial-reliability pack)**: зарегистрировано 4 новые метрики (`referral_click_total`, `referral_signup_total`, `referral_payout_created_total`, `referral_payout_amount_rub_total`), inc-вызовы подключены в `AttributionService.record`/`attributeOrg` и `ReferralPayoutService.onInvoicePaid`. Алёрт `ReferralPayoutCronDidNotRun` для 10-го числа.
- **Уведомления партнёру** при создании payout / закрытии периода — в ТЗ упомянуты как часть кабинета; в коде не реализованы (нет вызовов из `ReferralPayoutService` в notification-dispatch).
- **Welcome-коды (signup-bonus)** — явно вынесены за скобки в `plans/tz/2026-05-27...` §3.
- ~~**First-touch атрибуция**~~ — **закрыто 2026-05-30 (Фаза 2 commercial-reliability pack)**: `AttributionService.attributeOrg` теперь делает `updateMany WHERE pendingAttributionSlug IS NULL`. Безусловный `update` (фактически last-touch) заменён на first-touch гард, метрика `referral_attribution_first_touch_locked_total` фиксирует отброшенные повторные клики.

**Поправка 2026-05-29 к первому аудиту:**
- **Self-referral блок — УЖЕ РЕАЛИЗОВАН.** Метрика `referral_self_referral_denied_total` ([business-metrics.service.ts:1367](../../backend/src/common/metrics/business-metrics.service.ts#L1367)) с пометкой `audit Б6 — попытка self-referral (Referral.ownerUserId совпал с member/owner целевой Org) отклонена`. Плюс дополнительная защита `referral_inn_mismatch_total` ([line 1374](../../backend/src/common/metrics/business-metrics.service.ts#L1374)) — блок при совпадении ИНН партнёра и клиента. В первом аудите я ошибся, написав что не реализовано.

**Реализовано иначе:**
- **fire-and-forget через EventEmitter2 in-memory** вместо BullMQ-очереди (как в порт-брифе). Решение оправдано: единый процесс backend, дешевле, и при отказе billing-tx уже зафиксирована — реф-payout можно дозалить позже руками. Но плохо масштабируется при множественных backend-instance.
- **Идемпотентность по `triggerInvoiceId`** через простой `findFirst` (без unique constraint в схеме) — работает, но при гонке двух одновременных `onInvoicePaid` (например, webhook + InvoiceStatusSyncCron одновременно) может создаться дубликат. Сегодня риск низкий (cron идёт раз в 15 мин, дубликаты webhook'ов отлавливаются на уровне `BillingEventLog.externalEventId`), но архитектурно стоит добавить `@unique` на `triggerInvoiceId` в `ReferralPayout`.
- **`payoutDetails` — JSON-blob**, не структурированные поля. Это даёт гибкость (для разных `legalForm` нужны разные реквизиты), но не валидируется на уровне БД.

**Реализовано, НЕ описано в ТЗ:**
- **`POST /admin/referrals/close-period`** — ручной триггер для админа (`closePeriod(periodMonth)`), полезен для отладки cron и для закрытия периодов задним числом, если cron 10-го числа упал.
- **Slug-alphabet без 0/o/l/1** в `ReferralsService:37` — продуктовое решение для устной передачи и QR-кодов, не зафиксировано явно в ТЗ.
- **Logging «Beacon for unknown slug»** — beacon идемпотентен, неизвестный slug — это нормально (партнёр мог изменить slug, ссылка устарела); не throw, только warn-лог.

**Связи с другими процессами:**
- **`User.signupRef`** заполняется при регистрации (см. [[signup-and-onboarding-wizard]] шаг 2), но **этот код не используется** для атрибуции — реальный trail идёт через `ReferralAttribution` (cookie + fingerprint). `User.signupRef` — только для аналитики (откуда юзер пришёл).

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-30 | Observability-gap закрыт: 4 метрики `referral_*`, алёрт `ReferralPayoutCronDidNotRun`, Grafana-панель. `status_overall: partial → implemented`. | plans/tz/2026-05-29-commercial-reliability-package.md Фаза 4 |
| 2026-05-30 | First-touch fix: `attributeOrg` → `updateMany WHERE pendingAttributionSlug IS NULL`. Метрика `referral_attribution_first_touch_locked_total` зарегистрирована. | plans/tz/2026-05-29-commercial-reliability-package.md Фаза 2 |
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-27 | ТЗ объединённого биллинга + InnLookup + рефералов (Фаза 6 реализована) | `plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md` |
| 2026-05-25 | Анализ + решение владельца: фикс 20 000 ₽, окно 3 мес, cron 10-го | `plans/analysis/2026-05-25-billing-and-referrals.md` |

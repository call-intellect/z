---
type: reflection
date: 2026-05-27
distilled: false
commits:
  - 52cde75 # фаза 1 — Prisma + ENV + tier_standard
  - 600d794 # фаза 2 — inn-lookup (Mock + DaData)
  - 6c3a21b # фаза 3 — meetings-balance
  - 96b9edc # фаза 4a — pure-фундамент биллинга
  - 6b7421b # фаза 4b — БД-сервисы + admin + cron
  - 4fcba52 # фаза 5 — Tochka Bank
  - efe1660 # фаза 6 — реферальная программа
  - 4416801 # фаза 8 — Tochka OpenBanking lookup
---

# 2026-05-27 — Billing (Tochka) + Referrals + DaData полная реализация

## Постановка

Внедрить из port-brief'a (`plans/2026-05-27-billing-referral-dadata-tochka-port-brief.md`) три большие подсистемы:

1. **Биллинг** — подписка по тарифу `tier_standard` (60 000 ₽/мес + 1 000 ₽/доп.место), годовая со скидкой 20%, оплата через **Точку Банк** (карта recurring + безналичный счёт), ручная активация админом в режимах paid/bonus.
2. **Реферальная программа** — фикс 20 000 ₽ комиссии за каждый paid-инвойс, окно атрибуции 90 дней, выплата 10-го числа.
3. **DaData lookup по ИНН** + Tochka OpenBanking fallback.

ТЗ: [`plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md`](../../plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md). 10 фаз, гибрид архитектуры port-brief'а (provider port, OAuth, JWT-webhooks) с бизнес-правилами Z (один тариф, реф 20k, копейки во всех суммах, `Org`/`tenantId` вместо `Company`/`companyId`).

## Что сделал

Реализованы фазы 1–6 и 8 (фронтенд Фаза 9 отложен, прод-Tochka Фаза 7 — операция владельца).

**Ветка:** `feature/billing-tochka-referral-dadata` (8 коммитов, 5 backend модулей).

### Фаза 1 (52cde75) — Prisma + ENV + tier_standard
- 10 новых Prisma-моделей + 7 enum (Subscription, Invoice, BillingEventLog, BillingProviderConfig, MeetingsBalance, Referral, ReferralAttribution, ClientReferralLink, ReferralPayout, SubscriptionEvent)
- Расширены `Org` (реквизиты + pending-атрибуция + billingDetailsVersion) и `User` (relation на Referral)
- `BillingSchema` в [env.schema.ts](../../backend/src/common/config/env.schema.ts) — 36 ENV одной группой (Billing+Tochka+DaData+InnLookup) во избежание TS2589
- `cfg.billing.*` геттер в TypedConfigService с под-объектами features/legalEntity/tochka/dadata/innLookup
- `tier_standard` добавлен **параллельно** с legacy `tier_basic/pro/enterprise` (минимально-инвазивно — старые tier'ы не ломаются), fail-safe в EntitlementService → `tier_standard`
- Patch-script `migrate-entitlements-to-standard.ts` + регистрация в STEPS `apply-prod-deploy.ts`

### Фаза 2 (600d794) — inn-lookup
- Модуль [`backend/src/modules/inn-lookup/`](../../backend/src/modules/inn-lookup/) с адаптерами Mock + DaData
- `InnLookupService` с Redis-кэшем (TTL по ENV, default 30 дней) + cache-stampede lock (SET NX EX 8s + polling 15×100мс)
- Эндпоинты: `POST /api/v1/inn-lookup` (auth, throttle 30/min) + `/admin/inn-lookup/invalidate`
- 23 unit-теста (mock + dadata + service)

### Фаза 3 (6c3a21b) — meetings-balance
- Накопительный баланс встреч заменил квоту `meetings_per_month`
- `MeetingsBalanceService.consume()` через атомарный `$executeRaw UPDATE ... WHERE balance >= amount`
- Хук в `MeetingsService.createForUser` (fail-open на инфра-сбоях сохранён)
- Удалены упоминания `meetings_per_month` из `tier-config.ts` / `QuotaKey` / тестов
- Patch `backfill-meetings-balance.ts` — стартовый `balance=150` для всех Org
- 14 unit-тестов

### Фаза 4a (96b9edc) — pure-фундамент биллинга
- `SubscriptionFSM` — таблица переходов DEMO/ACTIVE/PAST_DUE/SUSPENDED/CANCELED/EXPIRED
- `SeatService` — формулы: 60k+extra*1k, годовая ×0.8, pro-rata по дням/месяцам, calculateMeetingsGrant
- `InvoiceNumberService` — формат `Z-YYYY-NNNNNN`, UTC-год, padding=6
- `BillingProviderPort` интерфейс + `ManualBillingProvider` заглушка
- Типы событий `EventEmitter2`: `billing.invoice.paid`, `subscription.activated_paid/bonus/expired`
- 41 unit-тест (FSM полное покрытие 6×6 переходов + SeatService 8+ кейсов)

### Фаза 4b (6b7421b) — БД-сервисы + admin + cron
- `SubscriptionService.transition()` — единственный путь смены статуса, через FSM + SubscriptionEvent в одной транзакции
- `InvoiceService` — двухшаговая транзакция для invoiceNumber, markPaid/void
- `ManualBillingService.activate(paid/bonus)` — Subscription+Invoice+SubscriptionEvent+AdminAuditLog в tx, грант MeetingsBalance после tx
- `BillingCycleCron` — `0 3 * * *` Europe/Moscow, 4 шага FSM, Redis-lock
- `BillingController` + `AdminBillingController` (12 эндпоинтов)
- 13 unit-тестов на ManualBillingService

### Фаза 5 (4fcba52) — Tochka Bank
- `TochkaBillingProvider` — реализация `BillingProviderPort`, 13 методов (acquiring + bank-invoice + recurring + webhook). Денежки `Math.round(kopecks/100)` для отправки в Точку
- `TochkaOAuthService` — client_credentials → service token → consent → state(15min TTL) → authorize URL → callback → access+refresh, auto-refresh за 5 мин до expiry
- `TochkaWebhookVerifierService` — JWT verify через нативный `crypto.createPublicKey({format:'jwk'})` + `jsonwebtoken` (без новой зависимости `jose`)
- `TochkaWebhookRegistrarService` — auto-register webhook через `setTimeout(1500мс)` при `onApplicationBootstrap`
- `BillingService` (фасад): `handleProviderWebhook` (verify→parse→dedup→finalize) + `finalizePaidInvoice` + `createCardPayment` + `createBankInvoicePayment`
- 2 cron'а: `TochkaRecurringChargeCron` (`0 * * * *`) + `InvoiceStatusSyncCron` (`*/15 * * * *`)
- `BillingWebhookController` (public, всегда 200) + `BillingTochkaOAuthController` (public callback + admin authorize-url)
- [main.ts](../../backend/src/main.ts): `express.text({type:'*/*'})` middleware **только** для `/api/v1/internal/billing/provider-events` (Точка шлёт JWT-строку, не JSON)
- 14 unit-тестов webhook-verifier

### Фаза 6 (efe1660) — реферальная программа
- `ReferralsService` — CRUD профиля + slug nanoid 8 chars (alphabet без `0/o/l/1`) + verifyInn через InnLookup + acceptContract
- `AttributionService` — record() для beacon (TTL 90 дней) + attributeOrg (резолв cookie/fingerprint → Org.pendingAttribution*)
- `ReferralPayoutService` — `@OnEvent('billing.invoice.paid')`: paid→создать payout 2_000_000 копеек, bonus→no-op, идемпотентно по triggerInvoiceId. Cron `0 10 10 * *` MSK закрывает прошлый месяц
- 3 контроллера: public beacon (throttle 10/min) + кабинет реферала + admin
- 13 unit-тестов на PayoutService

### Фаза 8 (4416801) — Tochka OpenBanking lookup
- `TochkaOpenBankingAdapter` — `GET /open-banking/v1.0/customers` → match по info.inn → `InnLookupResult{source='tochka', bankBik, bankAccount}`
- `InnLookupService.tochka_then_dadata` — реальный fallback (раньше эквивалентен dadata)
- Sandbox/!features → null + graceful (даём DaData fallback'у шанс)
- 12 unit-тестов

## Что вышло

- **8 коммитов, 5 backend модулей, 139 unit-тестов pass**
- `bun run typecheck` + `lint` чистые на каждом коммите
- `prisma:push` — все 10 моделей синхронизированы с dev-БД
- Patch-script `migrate-entitlements-to-standard.ts` идемпотентен (повторный запуск scanned=0)
- Backfill `backfill-meetings-balance.ts` отработал на dev: 2 Org → granted=2
- `docs/operations/prod-deploy-log.md` обновлён разделом «💳 ТЗ 2026-05-27» (см. §«Накоплено к выкату»)

**НЕ сделано:**
- Фаза 7 (Tochka production OAuth-подключение) — операция владельца, не код
- Фаза 9 (Frontend ~6 страниц) — отдельный объёмный пласт, делаем в следующей сессии
- Канарейка с реальной оплатой 1 ₽ — после Фазы 7

## Чему научился

1. **TS2589 на длинной `.merge` цепочке EnvSchema** — нельзя дробить новые ENV на 4 отдельные схемы (Billing+Tochka+DaData+InnLookup). Сложил в одну `BillingSchema` (36 полей) — typecheck зелёный. Урок: если в Z схема Env уже 45 .merge'ов — новый раздел = одна схема, не несколько.

2. **JSDoc + `'*/*'` в комментариях** — преждевременно закрывает блок-комментарий. Файл с описанием «middleware `express.text({type: '*/*'})`» сразу падает с массой TS-ошибок. Чиню — переписать как `application/jose или text/plain` без слэш-звёздочки. Внёс в копилку грабель.

3. **Auto-`require-await` lint при `async + throw`** — eslint считает `// eslint-disable-next-line @typescript-eslint/require-await` лишним в случаях `async fn(){ throw ... }` без await (потому что throw делает функцию не-возвращающей). Disable-коммент становится «Unused directive» (warning). Урок: НЕ нужно глушить require-await на чисто throw'ящих async — eslint не ругается на них.

4. **Z не имеет общего KV-таблицы PipelineConfig** — в port-brief'е OAuth-токены/state/webhook-registration хранятся в общей KV-таблице `PipelineConfig`. Сделал узкоспециализированную `BillingProviderConfig` — лучше явный контракт, чем общий ведро. Урок: при портировании из чужого проекта не тащить «KV для всего», лучше per-feature таблица.

5. **InvoiceNumber через autoincrement + двухшаговая транзакция** — `Invoice.invoiceNumber String @unique` нельзя создать без значения. Решение: вставка с placeholder → чтение `billingNumber` (Prisma autoincrement Int) → update. Всё в одной транзакции, без race. Альтернатива — Postgres SEQUENCE напрямую — отвергнута как менее переносимая.

6. **TochkaWebhookVerifier без зависимости `jose`** — port-brief использует `jose` для JWT-verify. В Z уже есть `jsonwebtoken@9` + Node 20 умеет `crypto.createPublicKey({key: jwk, format:'jwk'})` нативно. Сэкономил установку библиотеки. Связка `crypto.createPublicKey + jwt.verify` — работает с RS256 как `jose`.

7. **express.text middleware для одного пути** — webhook Точки приходит JWT-строкой, глобальный `express.json({type:['application/json','application/webhook+json']})` его не парсит, и `@Body()` будет undefined. Решение: `app.use('/api/v1/internal/billing/provider-events', express.text({type:'*/*'}))` ДО общего парсера, ТОЛЬКО для этого пути. Урок: per-path middleware в Express совместим с NestJS `bodyParser:false` + кастомные парсеры.

8. **`@OnEvent` подписчик в отдельном модуле работает без явного импорта**, если оба модуля используют **один** глобальный `EventEmitterModule.forRoot()`. ReferralPayoutService в `referrals` подписан на событие из `billing` — работает потому что оба модуля используют тот же EventEmitter2 (зарегистрирован глобально в AppModule). Урок: events — это decoupled-связь, **порядок imports** в AppModule важен только если один модуль DI-injects сервис другого.

9. **Linter авто-фиксит чужие файлы при `--fix`** — `bun run lint --fix` ушёл редактировать `telegram-proxy-health.cron.ts` (убирал лишний eslint-disable). Я каждый раз перед коммитом откатывал: `git checkout -- src/modules/conversational/...`. Урок: после `lint --fix` проверять `git status` и откатывать changes в не-моих файлах.

10. **Idempotency реф-payout по triggerInvoiceId** — повторный `invoice.paid` (через webhook retry или manual re-emit) не должен создавать второй payout. Решение: `findFirst({where:{triggerInvoiceId}})` перед create. Тест покрывает.

## TODO (для следующих фаз и сессий)

- **Фаза 7** — Tochka production: получить client_id/secret в кабинете Точки, прописать `.env`, открыть authorize URL в браузере, проверить webhook на тестовой Org → канарейка с 1 ₽ (потребуется stage с пониженным BASE_MONTHLY_PRICE_KOPECKS либо в production с возвратом).
- **Фаза 9** — Frontend: ~6 страниц (`/settings/billing`, `/referrals`, `/admin/orgs/[id]/billing`, `/admin/billing-overview`, `/admin/referrals`, `/admin/integrations/tochka`). Слои ApiDto→DomainModel→UiModel по `frontend-rules`.
- **Удаление legacy `tier_basic/pro/enterprise`** из TierKey — после стабилизации продакшена и убеждения что нигде не остался hardcode (отдельный коммит в `tier-config.ts`).
- **PDF-генерация инвойсов на нашей стороне** — для bonus/manual инвойсов (без Tochka). Пока поле `Invoice.pdfUrl=null`, фронт показывает «PDF не доступен». Возможно через `pdfkit` + handlebars-шаблон.
- **Renewal-reminder cron** — email/notification за 7/3/1 день до конца периода. Не сделано в Фазе 4b.
- **Welcome-codes (signup-бонусы)** — заложено в брифе, отложено владельцем. Отдельным ТЗ позже.

## Связанные файлы

- ТЗ: [`plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md`](../../plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md)
- Port-brief: [`plans/2026-05-27-billing-referral-dadata-tochka-port-brief.md`](../../plans/2026-05-27-billing-referral-dadata-tochka-port-brief.md)
- Prod-deploy: [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md) §«💳 ТЗ 2026-05-27»

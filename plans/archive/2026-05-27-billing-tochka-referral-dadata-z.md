---
type: tz
status: draft
feature: Биллинг (Точка Банк: card-recurring + bank-invoice + webhook), реферальная программа (фикс 20 000 ₽ / invoice), DaData lookup по ИНН — единая интеграция в Z
date: 2026-05-27
owner: tozixwot@gmail.com
relates_to:
  - plans/2026-05-27-billing-referral-dadata-tochka-port-brief.md      # порт-бриф из исходного проекта (источник архитектурных решений)
  - plans/analysis/2026-05-25-billing-and-referrals.md                  # продуктовый анализ Z (источник бизнес-правил)
  - plans/tz/2026-05-25-billing-and-referrals-tz.md                     # предыдущий draft (заменяется этим ТЗ)
  - plans/tz/2026-05-25-inn-lookup-tz.md                                # предыдущий draft inn-lookup (объединяется сюда)
  - backend/prisma/schema.prisma
  - backend/src/modules/entitlements/tier-config.ts
  - backend/src/modules/orgs/orgs.module.ts
  - backend/src/common/config/env.schema.ts
---

# ТЗ: Биллинг (Точка) + Реферальная программа + DaData в Z

## 0. Контекст

В порт-брифе [`plans/2026-05-27-billing-referral-dadata-tochka-port-brief.md`](../2026-05-27-billing-referral-dadata-tochka-port-brief.md) описан полный код биллинга + реф-программы + интеграции с Точкой и DaData из соседнего проекта (Crossmark-стек: NestJS 11 + Prisma 7, как у нас). Параллельно в Z уже лежат **3 draft-ТЗ от 2026-05-25** с продуктовыми решениями владельца (один тариф, реф 20 000 ₽, оффлайн-счёт). Они **не реализованы** — этим ТЗ они заменяются и объединяются.

Гибрид:
- **Бизнес-правила** — из принятых решений владельца в [`plans/analysis/2026-05-25-billing-and-referrals.md`](../analysis/2026-05-25-billing-and-referrals.md) (один `tier_standard`, реф фикс 20 000 ₽ с реального платежа, окно атрибуции 3 мес, выплата 10-го числа, накопительный баланс встреч).
- **Архитектура** — из порт-брифа: `BillingProviderPort` с двумя реализациями (`TochkaBillingProvider` + `ManualBillingProvider`), OAuth2-флоу Точки с persisted refresh-token, JWT-webhook с JWK-верификацией, fire-and-forget реф-комиссии, DaData fallback для lookup по ИНН.
- **Адаптация под стек Z** — `Org` вместо `Company` (всё через `tenantId`), DTO через `nestjs-zod`, конфиги через `TypedConfigService`, cron через `@nestjs/schedule`, событийная шина через `@nestjs/event-emitter`, RBAC через Casbin (`policies/policy.csv`).

## 1. Цель

После реализации:
1. Клиент может оплатить подписку картой (recurring через Точку) **или** запросить безналичный счёт на оплату (PDF от Точки), и оплата засчитывается автоматически по webhook.
2. Админ может вручную включить подписку в одном из двух режимов: `paid` (учитывается в выручке, идёт реф-выплата) или `bonus` (не учитывается).
3. При регистрации Org заполняет реквизиты через автоподстановку по ИНН (Точка OpenBanking → DaData fallback → ручной ввод).
4. Партнёр получает фикс 20 000 ₽ за каждый реально оплаченный (paid) платёж приведённой компании в окне атрибуции 3 мес.
5. Накопительный баланс встреч заменяет квоту `meetings_per_month`.

## 2. Scope

**Входит:**

| Модуль | Файлы | Кратко |
|---|---|---|
| `backend/src/modules/billing/` | ~25 файлов | Subscription FSM, Invoice, PDF, BillingCycleCron, `BillingProviderPort`, `TochkaBillingProvider`, `ManualBillingProvider`, `TochkaOAuthService`, `BillingEventService`, webhook-контроллер |
| `backend/src/modules/inn-lookup/` | ~8 файлов | `InnLookupService` + `DadataAdapter` + `TochkaOpenBankingAdapter` (опц.) + `MockAdapter` + Redis-кэш |
| `backend/src/modules/referrals/` | ~12 файлов | `Referral` профиль, `ReferralAttribution` (cookie + сервер), `ClientReferralLink` (first-touch), `ReferralPayoutService`, `ReferralPayoutCron` (10-го числа) |
| `backend/src/modules/meetings-balance/` | ~5 файлов | Накопительный счётчик встреч |
| Расширение `entitlements` | `tier-config.ts` | Схлопывание трёх tier'ов в один `tier_standard` + patch-script |
| Public endpoint | `referrals.public.controller.ts` | beacon для landing'а — фиксация cookie `z_ref` |
| Frontend | ~12 страниц | `/settings/billing`, `/referrals`, `/admin/orgs/[id]/billing`, `/admin/billing-overview`, `/admin/referrals`, OAuth-callback страница |
| ENV | `env.schema.ts` | 18 новых переменных (Точка + DaData + Billing public URLs + feature-flags) |

**Не входит (отдельные ТЗ):**
- Демо-кабинет (фикстуры/seed/UI бейдж) — [`plans/tz/2026-05-25-demo-mode-tz.md`](2026-05-25-demo-mode-tz.md). Здесь используется только статус `DEMO` в FSM.
- ЮKassa/CloudPayments — рассматривается как альтернативный провайдер позже, через тот же `BillingProviderPort`.
- Контур.Фокус как fallback к DaData — пока выбран один платный источник (DaData) + Точка OpenBanking когда настроен OAuth.

## 3. Расхождения с порт-брифом и почему

| Поле / решение | Порт-бриф | Z (это ТЗ) | Причина |
|---|---|---|---|
| Сущность владельца подписки | `Company` (`companyId`) | `Org` (`tenantId`) | Z — multi-tenant поверх `Membership`, `Company` нет |
| Тарифы (`Plan`) | `free`/`pro`/`pro_plus`/`premium`, цена в БД | один `tier_standard`, цена в коде (`SeatService`) | Решение владельца 2026-05-25 (Б1/Б2/Б3) |
| Сумма комиссии | 6 500 ₽ / 10 000 ₽ (tier по `paidCount≥10`) | фикс **20 000 ₽** с каждого реального paid-инвойса в окне 3 мес | Решение владельца 2026-05-25 (Р1) |
| Окно атрибуции | first-touch, без явного TTL в реф-таблице | first-touch + TTL 3 мес от createdAt атрибуции, активируется только при первой оплате | Анализ 2026-05-25 §2.2 |
| Welcome-коды (signup-бонусы) | полный модуль `signup-referral` | **не входит** в первую волну (откладывается) | Не было в решениях владельца; добавим отдельным ТЗ после запуска базовой реф-программы |
| Денежные суммы | `Int` рубли (`amountRub`) | `Int` **копейки** (`amountKopecks`) | Уже принято в Z для `Invoice.totalKopecks` (анализ §3.3) — единый формат во всём проекте |
| DTO | `class-validator` + `class-transformer` | `nestjs-zod` (`@nestjs-zod/zod` ZodDto) | Стандарт Z (skill `nestjs-rules`) — единообразно с остальным backend'ом |
| OAuth state storage | модель `PipelineConfig` (KV-таблица) | новая модель `BillingProviderConfig` (та же роль, чтобы не плодить общий KV) | KV-таблицы в Z нет; делаем узкоспециализированную модель — она же хранит зарегистрированный webhook ID |
| `Subscription.providerName` | `provider_name` строка | enum `BillingProviderName { tochka, manual }` | type-safety; миграция между провайдерами в будущем будет явной |
| Lookup по ИНН | внутри `CompanyBillingDetailsService` (Точка → DaData) | отдельный модуль `inn-lookup` с тем же двойным fallback'ом | Z уже имеет draft inn-lookup-tz; lookup нужен не только биллингу — ещё и в форме регистрации Org и реферала |

## 4. Принятые решения владельца (унаследованные от 2026-05-25)

(Полный список — в [`plans/analysis/2026-05-25-billing-and-referrals.md`](../analysis/2026-05-25-billing-and-referrals.md). Здесь — выжимка для разработчика.)

| # | Решение | Детали |
|---|---|---|
| Б1 | Один тариф `tier_standard` | все фичи `true` |
| Б2 | Базовая цена | 60 000 ₽/мес без НДС, 31 место (1 главный + 30), 150 встреч/мес |
| Б3 | Доп. место | +1 000 ₽/мес, +5 встреч/мес (pro-rata по дням текущего месяца) |
| Б4 | Годовая подписка | скидка 20% → 576 000 ₽ за 12 мес |
| Б5 | Накопительный баланс встреч | без потолка, без сгорания, отдельная модель `MeetingsBalance` |
| Б6 | Два режима админ-активации | `paid` (в выручке, реф идёт) / `bonus` (вне выручки) — обязательный `reason` |
| Б7 | Платёжный провайдер MVP | **Точка Банк** через `BillingProviderPort` + ManualBillingProvider как заглушка/админский путь |
| Р1 | Реф-комиссия | фикс 20 000 ₽ с каждого реального paid-инвойса |
| Р2 | Атрибуция | first-touch, окно 3 месяца от первого касания (cookie `z_ref` + ip+UA fingerprint) |
| Р3 | Выплата | cron 10-го числа за прошлый месяц; `ReferralPayout.status: pending → paid` |
| Р4 | ИНН реферала | обязательная верификация через `InnLookupService` до первой выплаты |

## 5. ENV (env.schema.ts)

Все добавляемые переменные **обязаны** ходить через [`backend/src/common/config/env.schema.ts`](../../backend/src/common/config/env.schema.ts) + `TypedConfigService` (правило skill `core-engineering-standards`).

```typescript
// Billing — общее
BILLING_PROVIDER: z.enum(['tochka', 'manual']).default('manual'),
FEATURE_BILLING_TOCHKA: zBool.default(false),
FEATURE_BILLING_CARD_RECURRING: zBool.default(false),
FEATURE_BILLING_BANK_INVOICE: zBool.default(false),
BILLING_PUBLIC_API_URL: z.string().url().optional(),
BILLING_SUCCESS_REDIRECT_URL: z.string().url().optional(),
BILLING_FAIL_REDIRECT_URL: z.string().url().optional(),

// Юридические реквизиты Z (для шапки PDF-счёта)
BILLING_LEGAL_ENTITY_NAME: z.string(),
BILLING_LEGAL_ENTITY_INN: z.string().regex(/^\d{10}(\d{2})?$/),
BILLING_LEGAL_ENTITY_KPP: z.string().regex(/^\d{9}$/).optional(),
BILLING_LEGAL_ENTITY_ADDRESS: z.string(),
BILLING_LEGAL_ENTITY_BIK: z.string().regex(/^\d{9}$/),
BILLING_LEGAL_ENTITY_ACCOUNT: z.string().regex(/^\d{20}$/),

// Точка Банк
TOCHKA_MODE: z.enum(['sandbox', 'production']).default('sandbox'),
TOCHKA_API_VERSION: z.string().default('v1.0'),
TOCHKA_API_BASE_URL: z.string().url().optional(),
TOCHKA_CUSTOMER_CODE: z.string().optional(),
TOCHKA_ACCOUNT_ID: z.string().optional(),
TOCHKA_MERCHANT_ID: z.string().optional(),
TOCHKA_CLIENT_ID: z.string().optional(),
TOCHKA_CLIENT_SECRET: z.string().optional(),
TOCHKA_REDIRECT_URI: z.string().url().optional(),
TOCHKA_JWT_TOKEN: z.string().optional(),          // явный токен в обход OAuth
TOCHKA_OAUTH_SCOPES: z.string().default('accounts balances customers statements sbp payments acquiring'),
TOCHKA_OAUTH_PERMISSIONS: z.string().default('ReadAccountsBasic,ReadAccountsDetail,ReadCustomerData,MakeAcquiringOperation,ReadAcquiringData,ManageWebhookData,ManageInvoiceData'),
TOCHKA_WEBHOOK_URL: z.string().url().optional(),
TOCHKA_WEBHOOK_EVENT_TYPES: z.string().default('acquiringInternetPayment'),
TOCHKA_WEBHOOK_AUTO_REGISTER: zBool.default(false),
TOCHKA_WEBHOOK_PUBLIC_KEY_URL: z.string().url().default('https://enter.tochka.com/doc/openapi/static/keys/public'),

// DaData (lookup ИНН)
DADATA_API_KEY: z.string().optional(),
INN_LOOKUP_CACHE_TTL_DAYS: z.coerce.number().int().default(30),
INN_LOOKUP_PROVIDER: z.enum(['mock', 'dadata', 'tochka_then_dadata']).default('mock'),
```

`zBool` — существующий helper в env.schema.ts (парсит `'true'/'1'` → `true`).

В `TypedConfigService` добавляются методы-обёртки: `getBillingProvider()`, `getTochkaMode()`, `isTochkaProduction()`, `getDadataApiKey()`, и `getBillingFeatureFlags(): { tochka, cardRecurring, bankInvoice }`.

**Kill-switch на проде** — `FEATURE_BILLING_TOCHKA=false` отключает попытки сходить в Точку при старте сервиса (OAuth + webhook регистрация); `BILLING_PROVIDER=manual` — фабрика выбирает `ManualBillingProvider`, и весь cabinet-флоу платежа возвращает 503 с текстом «оплата картой временно недоступна».

## 6. Prisma-модели

```prisma
// ════════════════════════════════════════════════════════════════════════════
// BILLING
// ════════════════════════════════════════════════════════════════════════════

enum BillingProviderName {
  tochka
  manual
}

enum BillingPeriod {
  monthly
  yearly
}

enum SubscriptionStatus {
  DEMO        // см. demo-mode-tz
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELED
  EXPIRED
}

enum PaymentMode {
  paid    // реальная оплата (через провайдера или ручная отметка платёжки)
  bonus   // бонусная активация админом
}

enum InvoiceStatus {
  draft
  issued
  paid
  bonus
  void
}

enum BillingPaymentMethod {
  card_recurring       // Точка subscription (card)
  bank_invoice         // безнал через Точку (PDF)
  manual_admin         // ручная отметка администратором
  bonus                // бонусная активация (без оплаты)
}

model Subscription {
  id                       String              @id @default(cuid())
  tenantId                 String              @unique
  org                      Org                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  status                   SubscriptionStatus  @default(DEMO)
  paymentMode              PaymentMode?
  billingPeriod            BillingPeriod?

  startedAt                DateTime?
  currentPeriodStart       DateTime?
  currentPeriodEnd         DateTime?
  pastDueUntil             DateTime?

  seatsBase                Int                 @default(30)
  seatsExtra               Int                 @default(0)
  monthlyPriceKopecks      Int                 @default(6_000_000)   // 60 000 ₽ в копейках
  totalPaidKopecks         Int                 @default(0)

  autoRenew                Boolean             @default(false)
  /// Способ возобновления при autoRenew=true: card_recurring | bank_invoice | manual_admin.
  renewalMethod            BillingPaymentMethod?

  // Связь с провайдером (Точка / другие)
  providerName             BillingProviderName?
  providerSubscriptionId   String?             // Точка subscriptionId (для recurring)
  providerCustomerCode     String?
  providerConsumerId       String?
  lastRenewalAttemptAt     DateTime?

  createdAt                DateTime            @default(now())
  updatedAt                DateTime            @updatedAt

  events                   SubscriptionEvent[]
  invoices                 Invoice[]
  clientReferralLink       ClientReferralLink?

  @@index([status])
  @@index([currentPeriodEnd])
  @@index([renewalMethod, autoRenew, currentPeriodEnd])
  @@map("subscriptions")
}

model SubscriptionEvent {
  id              String       @id @default(cuid())
  subscriptionId  String
  subscription    Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  eventType       String       // 'created' | 'activated_paid' | 'activated_bonus' | 'renewed' | 'past_due' | 'suspended' | 'canceled' | 'expired' | 'seats_changed' | 'status_forced' | 'provider_recurring_canceled'
  payload         Json
  byUserId        String?
  reason          String?      @db.Text
  createdAt       DateTime     @default(now())

  @@index([subscriptionId, createdAt])
  @@map("subscription_events")
}

model Invoice {
  id                       String              @id @default(cuid())
  tenantId                 String
  org                      Org                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptionId           String?
  subscription             Subscription?       @relation(fields: [subscriptionId], references: [id])

  invoiceNumber            String              @unique          // Z-2026-000123
  periodStart              DateTime
  periodEnd                DateTime
  items                    Json                                  // [{ kind: 'base'|'seats'|'seats_prorata'|'yearly_discount', qty, unitKopecks, totalKopecks, note }]
  totalKopecks             Int
  status                   InvoiceStatus       @default(draft)
  paymentMethod            BillingPaymentMethod?

  // PDF — наша генерация (для bonus/manual) ИЛИ от Точки (для bank_invoice)
  pdfUrl                   String?
  pdfSource                String?                              // 'z' | 'tochka'
  pdfFetchedAt             DateTime?

  // Привязка к провайдеру
  providerName             BillingProviderName?
  providerInvoiceId        String?                               // operationId/documentId
  paymentUrl               String?                               // ссылка на платёжную страницу
  externalStatus           String?                               // последний статус от провайдера

  // Метаданные
  issuedAt                 DateTime?
  paidAt                   DateTime?
  voidedAt                 DateTime?
  externalRef              String?                               // банк/платёжка от клиента (manual)
  markedByUserId           String?                               // кто проставил paid/bonus вручную
  dueAt                    DateTime?

  createdAt                DateTime            @default(now())
  updatedAt                DateTime            @updatedAt

  billingEventLogs         BillingEventLog[]
  referralPayouts          ReferralPayout[]

  @@index([tenantId, status])
  @@index([status, paidAt])
  @@index([providerInvoiceId])
  @@map("invoices")
}

model BillingEventLog {
  id              String              @id @default(cuid())
  tenantId        String?
  subscriptionId  String?
  invoiceId       String?
  invoice         Invoice?            @relation(fields: [invoiceId], references: [id])
  eventType       String              // 'invoice.paid' | 'provider.webhook' | 'subscription.activated_bonus' | ...
  providerName    BillingProviderName?
  externalEventId String?             // для дедупа webhook'ов; формат: <eventType>:<operationId>:<status>
  payload         Json
  status          String              @default("received")  // received | processed | failed
  processedAt     DateTime?
  createdAt       DateTime            @default(now())

  @@index([eventType])
  @@index([externalEventId])
  @@index([tenantId])
  @@map("billing_event_log")
}

/// Узкая KV-таблица для биллинга: OAuth-токены, OAuth-state, регистрация webhook'а.
/// Не размениваем общий PipelineConfig — она у нас не существует.
model BillingProviderConfig {
  key             String   @id     // 'tochka.production.oauth_tokens' | 'tochka.production.oauth_state' | 'tochka.webhook_registration'
  valueJson       Json
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("billing_provider_config")
}

// ════════════════════════════════════════════════════════════════════════════
// MEETINGS BALANCE
// ════════════════════════════════════════════════════════════════════════════

model MeetingsBalance {
  id              String   @id @default(cuid())
  tenantId        String   @unique
  org             Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  balance         Int      @default(0)
  totalGranted    Int      @default(0)
  totalConsumed   Int      @default(0)
  lastGrantedAt   DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("meetings_balance")
}

// ════════════════════════════════════════════════════════════════════════════
// REFERRALS
// ════════════════════════════════════════════════════════════════════════════

enum ReferralLegalForm {
  self_employed
  individual_entrepreneur
  legal_entity
}

enum ReferralPayoutStatus {
  pending
  paid
  void
}

model Referral {
  id                  String   @id @default(cuid())
  ownerUserId         String   @unique
  owner               User     @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  slug                String   @unique
  inn                 String   @db.VarChar(20)
  innVerifiedAt       DateTime?
  legalForm           ReferralLegalForm
  payoutDetails       Json
  contractAcceptedAt  DateTime?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  attributions        ReferralAttribution[]
  clientLinks         ClientReferralLink[]
  payouts             ReferralPayout[]

  @@index([slug])
  @@map("referrals")
}

model ReferralAttribution {
  id              String   @id @default(cuid())
  referralId      String
  referral        Referral @relation(fields: [referralId], references: [id], onDelete: Cascade)

  slug            String
  fingerprint     String?  @db.VarChar(64)
  ip              String?  @db.VarChar(45)
  userAgent       String?  @db.Text
  referer         String?  @db.Text

  createdAt       DateTime @default(now())
  expiresAt       DateTime                            // createdAt + 90 days

  @@index([slug, createdAt])
  @@index([fingerprint])
  @@index([expiresAt])
  @@map("referral_attributions")
}

model ClientReferralLink {
  id                   String        @id @default(cuid())
  tenantId             String        @unique
  org                  Org           @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  referralId           String
  referral             Referral      @relation(fields: [referralId], references: [id])

  attachedAt           DateTime      @default(now())
  firstPaidAt          DateTime?
  sourceAttributionId  String?

  subscriptionId       String?       @unique
  subscription         Subscription? @relation(fields: [subscriptionId], references: [id])

  payouts              ReferralPayout[]

  @@index([referralId])
  @@map("client_referral_links")
}

model ReferralPayout {
  id                    String               @id @default(cuid())
  referralId            String
  referral              Referral             @relation(fields: [referralId], references: [id], onDelete: Cascade)
  clientReferralLinkId  String
  clientReferralLink    ClientReferralLink   @relation(fields: [clientReferralLinkId], references: [id], onDelete: Cascade)

  triggerInvoiceId      String?
  triggerInvoice        Invoice?             @relation(fields: [triggerInvoiceId], references: [id])

  periodMonth           String               @db.VarChar(7)     // 'YYYY-MM'
  amountKopecks         Int                  @default(2_000_000)  // 20 000 ₽
  status                ReferralPayoutStatus @default(pending)

  payoutDocumentUrl     String?
  paidAt                DateTime?
  voidReason            String?              @db.Text

  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt

  @@index([referralId, periodMonth])
  @@index([status])
  @@map("referral_payouts")
}

// ════════════════════════════════════════════════════════════════════════════
// Изменения существующих моделей
// ════════════════════════════════════════════════════════════════════════════

model Org {
  // ... существующие поля
  // Реквизиты (заполняются InnLookupService или вручную)
  inn                 String?  @db.VarChar(20)
  ogrn                String?  @db.VarChar(20)
  kpp                 String?  @db.VarChar(20)
  directorName        String?  @db.VarChar(255)
  legalAddress        String?  @db.Text
  bankBik             String?  @db.VarChar(9)
  bankAccount         String?  @db.VarChar(20)
  bankCorrAccount     String?  @db.VarChar(20)
  bankName            String?
  contactEmail        String?
  contactPhone        String?
  // Версия для optimistic-lock'а реквизитов (port-brief §8)
  billingDetailsVersion Int    @default(1)

  subscription        Subscription?
  meetingsBalance     MeetingsBalance?
  clientReferralLink  ClientReferralLink?
  invoices            Invoice[]
}

model User {
  // ... существующие поля
  referral            Referral?
}
```

**ВАЖНО (skill `prisma-db-push-rules`):** все правки применяются строго через `bun run prisma:push` + `bun run prisma:generate`. Никаких `prisma migrate*`. После — `bun run typecheck`.

## 7. Архитектура модуля `billing`

### 7.1 Структура

```
backend/src/modules/billing/
├── billing.module.ts
├── billing.types.ts                     # enum-константы (InvoiceStatus и т.п.) + типы
├── services/
│   ├── billing.service.ts               # фасад (createCardPayment, createBankInvoice, finalizePaidInvoice, ...)
│   ├── subscription.service.ts          # FSM + CRUD
│   ├── subscription-fsm.ts              # таблица переходов (pure-функция)
│   ├── seat.service.ts                  # формулы цены / pro-rata / грант встреч
│   ├── invoice.service.ts               # CRUD инвойсов + номер Z-YYYY-NNNNNN
│   ├── invoice-pdf.service.ts           # генерация PDF (PDFKit + handlebars-шаблон)
│   ├── billing-cycle.service.ts         # переходы PAST_DUE/SUSPENDED/EXPIRED, продление
│   ├── manual-billing.service.ts        # admin activate(paid/bonus), adjust-seats, force-status
│   ├── billing-event.service.ts         # запись BillingEventLog + дедуп
│   └── billing-pricing.service.ts       # обёртка над SeatService для quote-эндпоинта
├── providers/
│   ├── billing-provider.port.ts         # интерфейс + типы запросов/ответов + ошибки
│   ├── manual-billing.provider.ts       # заглушка (throw 'manual provider — use admin path')
│   ├── tochka/
│   │   ├── tochka-billing.provider.ts   # createPayment / createBankInvoice / chargeRecurring / verifyWebhook / parseWebhook
│   │   ├── tochka-oauth.service.ts      # ensureOAuthReady / getAccessToken / handleCallback (state в BillingProviderConfig)
│   │   ├── tochka-webhook-registrar.service.ts  # GET → DELETE → PUT при старте, флаг TOCHKA_WEBHOOK_AUTO_REGISTER
│   │   └── tochka.types.ts              # внутренние типы конвертов Data/Links/Meta
├── controllers/
│   ├── billing.controller.ts            # клиент: /billing/* (subscription, invoices, pay/card, pay/bank-invoice, auto-renew)
│   ├── admin-billing.controller.ts      # super_admin: /admin/billing/*
│   ├── billing-webhook.controller.ts    # /internal/billing/provider-events (public, raw body)
│   └── billing-tochka-oauth.controller.ts # /internal/billing/tochka/oauth/callback (public)
├── crons/
│   ├── billing-cycle.cron.ts            # @Cron('0 3 * * *', Europe/Moscow) — переходы статусов
│   ├── tochka-recurring-charge.cron.ts  # @Cron('0 * * * *') — попытки списания у card_recurring подписок
│   ├── invoice-status-sync.cron.ts      # @Cron('*/15 * * * *') — синк статусов открытых инвойсов с Точкой
│   └── renewal-reminder.cron.ts         # @Cron('0 9 * * *', Europe/Moscow) — письма за 7/3/1 день
├── dto/
│   ├── start-card-payment.dto.ts        # ZodDto (nestjs-zod)
│   ├── start-bank-invoice.dto.ts
│   ├── update-auto-renew.dto.ts
│   ├── admin-activate.dto.ts
│   ├── admin-adjust-seats.dto.ts
│   ├── admin-force-status.dto.ts
│   ├── admin-mark-paid.dto.ts
│   └── subscription-quote.dto.ts
├── events/
│   └── billing.events.ts                # 'invoice.paid', 'subscription.activated_paid', 'subscription.expired'
└── tests/
    ├── seat.service.spec.ts
    ├── subscription-fsm.spec.ts
    ├── tochka-billing.provider.spec.ts  # моки fetch
    └── webhook.e2e.spec.ts              # синтетический JWT + JWK fixture
```

### 7.2 `BillingProviderPort` (порт)

Интерфейс из порт-брифа §5 переносится «один в один», с двумя адаптациями:

1. Денежные поля переименовываются: `amountRub` → `amountKopecks`. Это меняет сигнатуру `createPayment / createBankInvoice / chargeRecurringSubscription`. В `TochkaBillingProvider` копейки делятся на 100 при отправке в Точку (она принимает рубли числом) — `Math.round(amountKopecks / 100)`.
2. Метод `lookupCompanyByInn` **исключается из порта** — он живёт в отдельном модуле `inn-lookup`. Точка-адаптер просто экспортирует свой `TochkaOpenBankingAdapter` в `inn-lookup` через DI.

Все ошибки от Точки парсятся в общий `BillingProviderResourceNotFoundError` (404/410/424 + тело с «не существует» / «not found»).

### 7.3 OAuth Точки

Скопировать `TochkaOAuthService` из порт-брифа §7 один-в-один, **поменяв только**:
- `PrismaService` инжектится по-стандарту Z.
- Ключи `OAUTH_STATE_KEY` / `OAUTH_TOKENS_KEY` → `'tochka.production.oauth_state'` / `'tochka.production.oauth_tokens'`.
- Таблица — `BillingProviderConfig` вместо `PipelineConfig`.
- Конфиг — через `TypedConfigService` (геттеры `getTochkaClientId()` и т.п.), не напрямую `ConfigService.get`.
- Все логирующие `Logger` → существующий `pino`-логгер Z.
- При `ensureOAuthReady` в production-режиме URL для авторизации выводится не только в `logger.warn`, но и в новый эндпоинт `GET /admin/billing/tochka/oauth/authorize-url` (super_admin) — чтобы админ мог получить URL через UI без захода в логи.

### 7.4 Webhook

`POST /internal/billing/provider-events` — **public** (без `CookieAuthGuard`). Это требует:
- Добавить путь в whitelist `cookieAuthGlobalGuard` (или метки `@Public()` если такая уже есть).
- Подключить `body-parser raw` для маршрута: Точка шлёт JWT-строку `application/jose` или `text/plain`. В Nest это делается локальным middleware либо `@Body() body: unknown` + кастомный parser. В Z уже используется `helmet` + `cookie-parser` — добавляем raw-парсер только для `/internal/billing/provider-events` через `app.use('/api/v1/internal/billing/provider-events', express.raw({type: '*/*'}))` в `main.ts`.
- `BillingService.handleProviderWebhook(headers, body)` — копия из порт-брифа §13, с одним отличием: ищем invoice не только по `providerInvoiceId`, но и fallback'ом по `paymentLinkId === BillingInvoice.id` (этот id мы передаём Точке как `paymentLinkId` при создании).

Webhook-эндпоинт **должен отвечать 200** даже на дубликаты и `no_invoice` — Точка ретраит при не-200.

### 7.5 BillingModule — фабрика провайдера

```typescript
@Module({
  imports: [PrismaModule, RedisModule, EventEmitterModule.forRoot(), ... ],
  controllers: [
    BillingController,
    AdminBillingController,
    BillingWebhookController,
    BillingTochkaOAuthController,
  ],
  providers: [
    BillingService, SubscriptionService, SeatService, InvoiceService, InvoicePdfService,
    BillingCycleService, ManualBillingService, BillingEventService, BillingPricingService,
    ManualBillingProvider, TochkaBillingProvider, TochkaOAuthService, TochkaWebhookRegistrarService,
    {
      provide: BILLING_PROVIDER,
      inject: [TypedConfigService, ManualBillingProvider, TochkaBillingProvider],
      useFactory: (cfg, manual, tochka) =>
        cfg.getBillingProvider() === 'tochka' && cfg.isFeatureEnabled('billing.tochka')
          ? tochka : manual,
    },
    BillingCycleCron, TochkaRecurringChargeCron, InvoiceStatusSyncCron, RenewalReminderCron,
  ],
  exports: [BillingService, SubscriptionService, BILLING_PROVIDER],
})
export class BillingModule implements OnApplicationBootstrap {
  constructor(
    private readonly oauth: TochkaOAuthService,
    private readonly webhookRegistrar: TochkaWebhookRegistrarService,
    private readonly cfg: TypedConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (this.cfg.isFeatureEnabled('billing.tochka')) {
      await this.oauth.ensureOAuthReady().catch(e => /* log */);
      if (this.cfg.get('TOCHKA_WEBHOOK_AUTO_REGISTER')) {
        // 1.5 сек отсрочка чтобы http-сервер успел подняться (см. порт-бриф §20.15)
        setTimeout(() => this.webhookRegistrar.registerOnce().catch(e => /* log */), 1500);
      }
    }
  }
}
```

## 8. Архитектура модуля `inn-lookup`

```
backend/src/modules/inn-lookup/
├── inn-lookup.module.ts
├── inn-lookup.service.ts        # маршрут провайдеров + кэш Redis (TTL = INN_LOOKUP_CACHE_TTL_DAYS, lock от cache stampede)
├── inn-lookup.controller.ts     # POST /inn-lookup/:inn (auth+throttle 30/min/IP), POST /admin/inn-lookup/invalidate/:inn
├── adapters/
│   ├── inn-lookup.adapter.ts    # интерфейс LookupAdapter
│   ├── mock.adapter.ts          # фиксированные данные (Сбер 7707083893 и др.)
│   ├── dadata.adapter.ts        # POST https://suggestions.dadata.ru/.../findById/party
│   └── tochka.adapter.ts        # GET /open-banking/v1.0/customers + customer-info (импорт TochkaBillingProvider через DI)
├── dto/
│   ├── inn-lookup-response.dto.ts
│   └── inn-lookup-request.dto.ts
└── tests/
    ├── dadata.adapter.spec.ts
    ├── mock.adapter.spec.ts
    └── inn-lookup.service.spec.ts
```

Маршрут (`INN_LOOKUP_PROVIDER`):
- `mock` — только Mock (dev/sandbox).
- `dadata` — только DaData.
- `tochka_then_dadata` — сначала Tochka OpenBanking (только в prod-режиме Точки), затем DaData fallback.

Контракт `LookupResult` (адаптация brief §5):

```typescript
export interface InnLookupResult {
  source: 'mock' | 'dadata' | 'tochka';
  payerType: 'legal_entity' | 'individual_entrepreneur' | 'self_employed';
  legalName: string;
  inn: string;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  directorName?: string | null;
  bankBik?: string | null;
  bankAccount?: string | null;
}
```

DaData возвращает `type: 'INDIVIDUAL' | 'LEGAL'`. Поле `self_employed` отдельным признаком не приходит — детектится по `opf.code='65/4 НПД'` (или просто маппится в `individual_entrepreneur` с пометкой в UI «уточните вручную»). На MVP: `INDIVIDUAL → individual_entrepreneur`, `LEGAL → legal_entity`. Пользователь может переключить на `self_employed` руками в форме реферала.

**Кэш и rate-limit:**
- Redis-ключ `inn-lookup:<provider>:<inn>` с TTL.
- Cache stampede: `SET NX EX 30` для lock'а, остальные ждут результат через `BRPOPLPUSH` либо просто ретраят через 1 с (skill `nestjs-rules`).
- Throttle: `@Throttle({ default: { limit: 30, ttl: 60_000 } })` на эндпоинт (через `@nestjs/throttler`, уже подключён в Z).

## 9. Архитектура модуля `referrals`

```
backend/src/modules/referrals/
├── referrals.module.ts
├── services/
│   ├── referrals.service.ts            # CRUD профиля + генерация slug
│   ├── attribution.service.ts          # запись ReferralAttribution + резолв при регистрации
│   ├── client-link.service.ts          # first-touch привязка → ClientReferralLink
│   ├── referral-payout.service.ts      # начисление при invoice.paid, расчёт за месяц
│   └── referral-payout-cron.ts         # @Cron('0 10 10 * *', Europe/Moscow) — 10-го числа в 10:00 МСК
├── controllers/
│   ├── referrals.controller.ts         # /referrals/* — кабинет реферала
│   ├── admin-referrals.controller.ts   # /admin/referrals/*
│   └── public-referrals.controller.ts  # /public/referrals/attribution (beacon, без auth, rate-limit)
├── dto/...
└── tests/...
```

Поток:

1. Лендинг ставит cookie `z_ref=<slug>` (HttpOnly=false, 90 дней) + бьёт `POST /public/referrals/attribution { slug, fingerprint, referer }`. Возвращает 204. Сервер пишет `ReferralAttribution` с `expiresAt = now + 90d`.
2. Юзер регистрирует Org. `RegisterOrgService` (или `OrgsService.create`) дёргает `AttributionService.resolveForUser(req)` — ищет последнюю не-истёкшую атрибуцию по cookie/fingerprint/IP. Если есть — **сохраняет ссылку в Subscription, но `ClientReferralLink` НЕ создаётся**. ClientReferralLink создаётся только когда `Subscription.paymentMode='paid'` (см. шаг 4).
3. На `invoice.paid` (события из `EventEmitter2`) подписан `ReferralPayoutService.onInvoicePaid`:
   - Если у Subscription есть `clientReferralLink` — создаёт `ReferralPayout(amountKopecks=2_000_000, status=pending, periodMonth=YYYY-MM)`.
   - Если нет — пытается резолвить атрибуцию по `Org` (через сохранённый `Org.attribution_*` — добавляем 2 поля на Org или храним в Subscription.metadata Json), если нашли валидную → создаёт `ClientReferralLink(firstPaidAt=now, sourceAttributionId)` → создаёт payout.
   - Если `Subscription.paymentMode='bonus'` — payout НЕ создаётся.
4. Cron 10-го числа: переводит все `pending`-payout'ы прошлого месяца в `paid` **только** для рефералов с `innVerifiedAt != null` и `contractAcceptedAt != null`. Остальные — в `void` с `voidReason='referral_not_verified'`. (Реальная выплата делается админом через банковский интерфейс — кнопка `mark-paid` в админ-UI; cron только закрывает периоды.)

Эндпоинты — копия §16 порт-брифа, но без welcome-кодов (signup-bonus откладывается). Все `companyId` → `tenantId`.

## 10. Модуль `meetings-balance`

```
backend/src/modules/meetings-balance/
├── meetings-balance.module.ts
├── meetings-balance.service.ts      # grant(tenantId, amount), consume(tenantId, amount=1), getBalance(tenantId)
├── meetings-balance.controller.ts   # GET /billing/meetings-balance (внутри billing) — переэкспорт
└── tests/
```

Интеграция:
- Хук в `MeetingsController.create` (или `MeetingsService.start`): `await balance.consume(tenantId, 1)`. Если `balance ≤ 0` — `ForbiddenException('Закончились встречи. Доплатите или ждите следующего периода')`.
- Хук в `SubscriptionService` при `activated_paid` / `activated_bonus` / `renewed` / `seats_changed` — `balance.grant(tenantId, calculateMeetingsGrant(seatsBase, seatsExtra))`.
- В `tier-config.ts` — удалить `'meetings_per_month'` из `QuotaKey`, `ALL_QUOTAS`, `TIER_CONFIG[*].quotas`. Все упоминания в коде заменить на `MeetingsBalanceService`.

## 11. Endpoint'ы — полный список

### 11.1 Клиентский кабинет

Префикс `/api/v1/`, guards `CookieAuthGuard, TenantGuard`. Owner-only через `@RequireRole('owner')`.

| Метод | Путь | Guards | Назначение |
|---|---|---|---|
| GET | `/billing/subscription` | auth+tenant | Текущая подписка |
| GET | `/billing/meetings-balance` | auth+tenant | Баланс встреч |
| GET | `/billing/invoices` | auth+tenant, owner | Список счетов |
| GET | `/billing/invoices/:id/pdf` | auth+tenant, owner | Скачать PDF (для bank_invoice — фетчит у Точки) |
| GET | `/billing/quote` | auth+tenant, owner | Расчёт цены за seats/period (`?billingPeriod&seatsExtra`) |
| GET | `/billing/seats/preview` | auth+tenant, owner | Pro-rata расчёт добавления мест |
| POST | `/billing/pay/card` | auth+tenant, owner | Старт оплаты картой через Точку (recurring) |
| POST | `/billing/pay/bank-invoice` | auth+tenant, owner | Выставить счёт через Точку (PDF на email) |
| POST | `/billing/auto-renew` | auth+tenant, owner | Включить/выключить autoRenew + renewalMethod |
| POST | `/billing/provider/recurring/cancel` | auth+tenant, owner | Отменить card-recurring у Точки |
| GET | `/billing/billing-details` | auth+tenant, owner | Реквизиты Org для счёта |
| PATCH | `/billing/billing-details` | auth+tenant, owner | Обновить реквизиты (optimistic lock через `version`) |
| POST | `/billing/billing-details/lookup-by-inn` | auth+tenant | Lookup через `inn-lookup` (если нужно отдельно от регистрации) |
| GET | `/billing/payment-return/success` | public | Redirect после оплаты в Точке |
| GET | `/billing/payment-return/fail` | public | То же для неуспеха |

### 11.2 Кабинет реферала

| Метод | Путь | Guards | Назначение |
|---|---|---|---|
| GET | `/referrals/me` | auth | Профиль реферала (создать если нет) |
| POST | `/referrals/me` | auth | Создать профиль (slug + ИНН + payoutDetails) |
| PATCH | `/referrals/me` | auth | Обновить payoutDetails |
| POST | `/referrals/me/verify-inn` | auth | Запустить `InnLookupService.verifyInn` |
| POST | `/referrals/me/accept-contract` | auth | Принять оферту (фикс `contractAcceptedAt`) |
| GET | `/referrals/me/clients` | auth | Список приведённых клиентов |
| GET | `/referrals/me/payouts` | auth | Все начисления + статусы |
| GET | `/referrals/me/stats` | auth | Метрики: всего привлечено / в работе / выплачено |

### 11.3 Public

| Метод | Путь | Guards | Назначение |
|---|---|---|---|
| POST | `/public/referrals/attribution` | rate-limit 10/min/IP, no auth | Beacon от лендинга |
| POST | `/internal/billing/provider-events` | no auth, raw body | Webhook от Точки |
| GET/HEAD | `/internal/billing/provider-events` | no auth | Probe для регистрации webhook |
| GET | `/internal/billing/tochka/oauth/callback` | no auth | OAuth callback |

### 11.4 Админский

Префикс `/api/v1/admin/`, guards `CookieAuthGuard, RbacGuard` (`super_admin`).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/orgs/:tenantId/billing` | Карточка биллинга Org |
| POST | `/admin/orgs/:tenantId/billing/activate` | `{ billingPeriod, seatsBase?, seatsExtra, startedAt, paymentMode, reason }` |
| POST | `/admin/orgs/:tenantId/billing/adjust-seats` | `{ newSeatsExtra, reason }` |
| POST | `/admin/orgs/:tenantId/billing/force-status` | `{ newStatus, reason }` |
| POST | `/admin/orgs/:tenantId/billing/invoices/:id/mark-paid` | `{ externalRef?, reason }` |
| POST | `/admin/orgs/:tenantId/billing/invoices/:id/void` | `{ reason }` |
| POST | `/admin/orgs/:tenantId/billing/cancel-provider-recurring` | Отменить card-recurring у Точки |
| GET | `/admin/orgs/:tenantId/billing/events` | История BillingEventLog |
| GET | `/admin/billing/tochka/oauth/authorize-url` | URL для авторизации в Точке (если не настроено) |
| POST | `/admin/billing/tochka/webhook/register` | Принудительная регистрация webhook |
| GET | `/admin/billing-overview` | MRR / ARR / активные / churn / реф-выплаты |
| GET | `/admin/referrals` | Список рефералов |
| GET | `/admin/referrals/:id` | Карточка реферала + клиенты + payouts |
| POST | `/admin/referrals/payouts/:id/mark-paid` | `{ payoutDocumentUrl?, reason }` |
| POST | `/admin/referrals/payouts/:id/void` | `{ reason }` |

Каждое админ-действие пишет в **существующий** `AdminAuditLog` (см. [backend/src/modules/audit/](../../backend/src/modules/audit/)).

## 12. RBAC

Новые `ResourceType` в `policies/policy.csv`:

```
# Биллинг (per-Org)
p, owner,       billing,             read,   *
p, owner,       billing,             write,  self
p, admin,       billing,             read,   self
p, super_admin, billing,             *,      *

# Реферальный профиль (per-User)
p, *,           referral,            read,   self
p, *,           referral,            write,  self
p, super_admin, referral,            *,      *

# Public webhook / OAuth callback — без RBAC, через @Public()
```

## 13. Frontend

`frontend/src/app/(authenticated)/`:
- `/settings/billing/page.tsx` — карточка подписки, баланс встреч, формы «оплатить картой» / «выставить счёт», список инвойсов с PDF-кнопкой.
- `/referrals/page.tsx` — мой профиль реферала (создание/верификация ИНН), список ссылок (на MVP — одна личная ссылка `https://app.z.ru/?ref=<slug>`), QR, статистика, баланс выплат.

`frontend/src/app/(admin)/`:
- `/admin/orgs/[id]/billing/page.tsx` — ручная активация (выбор paid/bonus + обязательный `reason`), просмотр инвойсов, кнопка mark-paid.
- `/admin/billing-overview/page.tsx` — MRR/ARR/активные/churn/реф-выплаты.
- `/admin/referrals/page.tsx` — список рефералов и payouts с фильтрами по периоду.
- `/admin/referrals/[id]/page.tsx` — карточка с действиями mark-paid/void.

Архитектура слоёв (skill `frontend-rules`): `src/api/billing.api.ts` (ApiDto) → `src/domain/billing.ts` (DomainModel) → `src/ui` (UiModel). SWR для data-fetching.

OAuth-страница админу — `/admin/integrations/tochka/page.tsx` с кнопкой «Подключить» (открывает authorizeUrl), статусом текущих токенов и кнопкой «Зарегистрировать webhook».

## 14. Фазы реализации

Все фазы — последовательные. Внутри каждой можно параллелить, но переход на следующую только после DoD текущей. После закрытия каждой фазы — рефлексия в `second-brain/05_история/`.

### Фаза 1. Prisma-схема, ENV, упрощение entitlements

- 1.1 Добавить в [schema.prisma](../../backend/prisma/schema.prisma) все enum'ы и модели (раздел 6). `bun run prisma:push` + `prisma:generate` + `typecheck`.
- 1.2 Добавить ENV-переменные в [env.schema.ts](../../backend/src/common/config/env.schema.ts) и геттеры в `TypedConfigService`.
- 1.3 Упростить [tier-config.ts](../../backend/src/modules/entitlements/tier-config.ts) до `tier_standard`. Удалить `meetings_per_month`.
- 1.4 Patch-скрипт `backend/scripts/migrate-entitlements-to-standard.ts` + регистрация в `apply-prod-deploy.ts` (`STEPS`, `skipBootstrap: true`).
- 1.5 Зарегистрировать новые ENV в `docs/operations/prod-deploy-log.md` Шаг 1.

**DoD:**
- [ ] `bun run prisma:push && bun run prisma:generate && bun run typecheck` зелёные.
- [ ] `grep -rn "tier_basic\|tier_pro\|tier_enterprise" backend/src` пуст (или только в фолбэке fail-safe + комментариях миграции).
- [ ] Patch-script идемпотентен (повтор не падает).
- [ ] `BillingProviderConfig` таблица создана.

### Фаза 2. Inn-lookup (отдельный модуль)

Делается **первым** после Prisma — нужен для регистрации Org и реферала.

- 2.1 `MockAdapter` + сервис с Redis-кэшем + контроллер + DTO + throttler.
- 2.2 `DadataAdapter` с обработкой `INDIVIDUAL/LEGAL/НПД`, ошибок 4xx, таймаута 5 с.
- 2.3 (отложенно до Фазы 4) `TochkaOpenBankingAdapter` — подключается только когда `INN_LOOKUP_PROVIDER='tochka_then_dadata'`.
- 2.4 Юнит-тесты адаптеров с фикстурами реальных ответов (анонимизированных).

**DoD:**
- [ ] `POST /api/v1/inn-lookup/7707083893` (Сбер) на dev отдаёт корректный результат с `source='mock'` или `'dadata'` (в зависимости от ENV).
- [ ] Повторный запрос в течение TTL → `cached: true` в meta, время отклика < 50 мс.
- [ ] Throttle отбивает 31-й запрос за минуту с одного IP.

### Фаза 3. `meetings-balance`

- 3.1 Модель и сервис (раздел 10).
- 3.2 Хук в `MeetingsController.create` / `MeetingsService`.
- 3.3 Удалить квоту `meetings_per_month` из `tier-config.ts` и `QuotaService` вызовов.
- 3.4 Patch-script `backend/scripts/backfill-meetings-balance.ts` — для каждой существующей Org создать `MeetingsBalance(balance=150)` (стартовый грант). Регистрация в `apply-prod-deploy.ts`.

**DoD:**
- [ ] Создание встречи списывает 1 единицу баланса; при `balance ≤ 0` возвращается 403.
- [ ] Все существующие Org получили стартовый грант после patch'а.

### Фаза 4. Биллинг — ядро без провайдера (`ManualBillingProvider`)

Цель — рабочий FSM + PDF-инвойсы + админская активация. Без Точки.

- 4.1 Структура модуля (раздел 7.1) + `BillingProviderPort` + `ManualBillingProvider` (заглушка).
- 4.2 `SubscriptionService` + `SubscriptionFsm` (таблица переходов из анализа §4.3).
- 4.3 `SeatService` — формулы (раздел 4 принятых решений) + юнит-тесты на 8+ кейсов.
- 4.4 `InvoiceService` + номер `Z-YYYY-NNNNNN` (последовательность через Postgres `SEQUENCE` либо `UNIQUE billingNumber` + retry; см. порт-бриф `billingNumber`).
- 4.5 `InvoicePdfService` — PDFKit + handlebars-шаблон (использовать существующий `handlebars` из `package.json`).
- 4.6 `BillingCycleCron` (раздел 7.1) — все переходы + идемпотентность через Redis lock.
- 4.7 `ManualBillingService.activate({paymentMode})` + интеграция с `MeetingsBalanceService.grant`.
- 4.8 Клиентские эндпоинты (без `pay/card` и `pay/bank-invoice`) + админские.
- 4.9 События `EventEmitter2`: `invoice.paid`, `subscription.activated_paid`, `subscription.expired`, ...

**DoD:**
- [ ] FSM-тесты: 100% покрытие валидных и невалидных переходов.
- [ ] `bun run test:unit` зелёный, в т.ч. SeatService.
- [ ] e2e: админ активирует Org в paid-режиме, в БД создаётся Subscription+Invoice+SubscriptionEvent+AdminAuditLog, грантуются 150 встреч.
- [ ] Cron-job 2 раза подряд → одинаковое состояние БД.
- [ ] PDF доступен по `pdfUrl`, открывается, содержит ИНН/КПП клиента и реквизиты Z.

### Фаза 5. Точка — sandbox

- 5.1 Скопировать `TochkaBillingProvider` (порт-бриф §6) с заменой `amountRub` → `amountKopecks/100`. Все import'ы — на структуру Z.
- 5.2 `TochkaOAuthService` + контроллер `BillingTochkaOAuthController` (порт-бриф §7 и §12.4).
- 5.3 `TochkaWebhookRegistrarService` (`registerOnce()`) + `BillingWebhookController` (порт-бриф §13). **Public-роут** + raw-body parser в `main.ts`.
- 5.4 Подключить sandbox-режим (статичный bearer token).
- 5.5 `BillingService.createCardSubscriptionPayment` + `createBankInvoicePayment` (порт-бриф §19 сценарий 1 и 2). С нашими формулами цены через `SeatService`.
- 5.6 `BillingService.handleProviderWebhook` + `finalizePaidInvoice` (порт-бриф §13) + интеграция с `EventEmitter2`.
- 5.7 `TochkaRecurringChargeCron` — раз в час идёт по `Subscription { autoRenew, renewalMethod='card_recurring', currentPeriodEnd < now+3d }` → `provider.chargeRecurringSubscription`.
- 5.8 `InvoiceStatusSyncCron` — `/15 минут` идёт по `Invoice { status='issued', providerInvoiceId, paymentMethod IN (card_recurring, bank_invoice) }` → `provider.getPaymentStatus` / `getBankInvoiceStatus`.

**DoD:**
- [ ] `TOCHKA_MODE=sandbox` → `POST /billing/pay/card` возвращает `paymentUrl` от Точки.
- [ ] Smoke-тест: POST `/billing/pay/bank-invoice` → создаёт invoice в Точке, скачивает PDF, отправляет на email.
- [ ] `curl -X POST /api/v1/internal/billing/provider-events -d '<тестовый JWT>'` — записывает `BillingEventLog`, дубликат игнорируется, при `status='APPROVED'` инвойс переходит в `paid` и Subscription активируется.
- [ ] `BillingEventLog.externalEventId` дедуп работает.

### Фаза 6. Реферальная программа

- 6.1 Модель + миграция Prisma уже сделана в Фазе 1. Создать модуль (раздел 9).
- 6.2 `AttributionService` + `PublicReferralsController` (beacon).
- 6.3 Хук в `OrgsService.create` / `AuthService.register` — резолв атрибуции и сохранение в Subscription.
- 6.4 `ReferralPayoutService.onInvoicePaid(@OnEvent('invoice.paid'))` — создание `ClientReferralLink` (first-touch) и `ReferralPayout`.
- 6.5 `ReferralPayoutCron` (10-го числа).
- 6.6 Эндпоинты кабинета и админа.
- 6.7 Принять оферту → `contractAcceptedAt`.

**DoD:**
- [ ] e2e: фейк-реферал → cookie → регистрация Org → активация paid → `ReferralPayout(pending, 2_000_000)` создан.
- [ ] Активация `bonus` НЕ создаёт payout.
- [ ] Атрибуция старше 90 дней — игнорируется.
- [ ] Cron 10-го числа на dev (форсированный запуск) переводит pending → paid только при `innVerifiedAt && contractAcceptedAt`.

### Фаза 7. Точка — production (OAuth + Webhook реальный)

- 7.1 Зарегистрировать приложение в кабинете Точки (по чек-листу порт-брифа §21 «Регистрация в Точке»).
- 7.2 `TOCHKA_MODE=production`, `FEATURE_BILLING_TOCHKA=true`, `BILLING_PROVIDER=tochka` в prod-env.
- 7.3 При старте бэка — `TochkaOAuthService.ensureOAuthReady` логирует authorizeUrl. Открыть в браузере, авторизоваться → callback пишет токены в `BillingProviderConfig`.
- 7.4 Включить `TOCHKA_WEBHOOK_AUTO_REGISTER=true`, проверить регистрацию webhook в админке Точки.
- 7.5 Канарейка: один тестовый Org, оплата 1₽ картой → проверить весь flow.

**DoD:**
- [ ] Тестовая оплата 1 ₽ картой → Subscription активируется автоматически по webhook'у.
- [ ] Refresh-token обновляется автоматически (проверка: вручную поставить `expiresAt = now + 1min` в `BillingProviderConfig` → сделать API-вызов через 2 мин → новый токен в БД).

### Фаза 8. DaData и `INN_LOOKUP_PROVIDER=tochka_then_dadata`

- 8.1 Получить ключ DaData, прописать `DADATA_API_KEY`.
- 8.2 `INN_LOOKUP_PROVIDER=tochka_then_dadata`.
- 8.3 Smoke: ИНН Сбера (`7707083893`) — должен вернуться из Tochka (если customer создан) или из DaData.

**DoD:**
- [ ] Lookup без авторизации в Точке (sandbox) → DaData ответ.
- [ ] Lookup в prod с авторизованной Точкой → Tochka ответ, DaData fallback.

### Фаза 9. Frontend

- 9.1 Реализовать API-слой `src/api/billing.api.ts`, `referrals.api.ts`, `inn-lookup.api.ts` (skill `frontend-rules`).
- 9.2 Domain-mappers `src/domain/billing.ts` (`Kopecks → string` ₽-форматирование, `BillingPeriod → label`).
- 9.3 Страницы кабинета: `/settings/billing`, `/referrals`.
- 9.4 Админ-страницы: `/admin/orgs/[id]/billing`, `/admin/billing-overview`, `/admin/referrals`, `/admin/integrations/tochka`.
- 9.5 Регистрационная форма Org: вызов `useInnLookup(inn)` → автозаполнение `legalName/kpp/ogrn/legalAddress`.

**DoD:**
- [ ] `bun run typecheck && bun run lint && bun run build` зелёные.
- [ ] Demo-видео: владелец проходит полный путь оплаты картой → видит активную подписку и баланс встреч.

### Фаза 10. Продовый выкат + рефлексия

- 10.1 Обновить `docs/operations/prod-deploy-log.md`: ENV (Шаг 1), patch-скрипты (Шаг 6), новые seed (Шаг 7), новые крон/webhook (Шаг 12 smoke).
- 10.2 Все patch-скрипты — в `backend/scripts/apply-prod-deploy.ts` STEPS.
- 10.3 Рефлексия в `second-brain/05_история/2026-MM-DD-billing-tochka-launch.md`.
- 10.4 Обновить `second-brain/index.md` ссылками на новые `01_projects/billing.md`, `01_projects/referrals.md`, `01_projects/inn-lookup.md`, `01_projects/meetings-balance.md` (создать).
- 10.5 Обновить `01_projects/api-layer.md`, `01_projects/frontend-pages.md`, `01_projects/workers-queues.md` (новые крон/очереди).

## 15. Зависимости и порядок

```
Ф.1 (Prisma + ENV + entitlements) → Ф.2 (inn-lookup) ──┐
                                                       ├→ Ф.4 (биллинг ядро) → Ф.5 (Tочка sandbox) → Ф.6 (рефералы) → Ф.7 (Tочка prod) → Ф.8 (DaData fallback) → Ф.9 (frontend) → Ф.10 (выкат)
                                  → Ф.3 (meetings-balance) ┘
```

Параллелить можно: Ф.2 и Ф.3 после Ф.1. Ф.6 не зависит от Ф.5 (можно делать на `ManualBillingProvider` — event `invoice.paid` всё равно эмитится).

## 16. Грабли — что не забыть (выжимка из §20 порт-брифа + Z-специфика)

1. **Webhook body — JWT-строка**, не JSON. Подключить `express.raw({type:'*/*'})` на маршрут `/internal/billing/provider-events` в `main.ts` ДО глобального JSON-парсера.
2. **Webhook public-доступ**: текущий `CookieAuthGuard` Z по умолчанию глобальный. Добавить `@Public()` метку на webhook + OAuth-callback + public-referrals/attribution + payment-return/*.
3. **`paymentLinkId` = наш `Invoice.id`**: при `createPayment/createBankInvoice/createRecurringSubscription` обязательно передавать его, чтобы webhook нашёл инвойс.
4. **Денежные суммы в Z — копейки** (`Int`). При отправке в Точку — `Math.round(amountKopecks/100)`. При парсинге webhook'а от Точки (`amount: 100` = 100₽) — `* 100`.
5. **HTTP 424** от Точки = «ресурс не существует» (вместе с 404, 410). Парсится через `isTochkaResourceMissingResponse` (порт-бриф §6).
6. **OAuth state TTL 15 мин** — если админ открывает authorize URL и тянет > 15 мин — callback вернёт 400 «state истёк».
7. **Refresh token обновляется за 5 мин до `expires_at`** (`TOKEN_REFRESH_MARGIN_MS`).
8. **Recurring=true ≠ Options** в Точке: нельзя одновременно. См. `createRecurringSubscription` в порт-брифе §6.
9. **`bill.number` ограничен 32 символами** — используем `invoiceNumber` (Z-2026-000123 = 12 символов).
10. **PrismaClient в скриптах** — только `createPrismaClient()` из `backend/scripts/_lib/prisma.ts` (CLAUDE.md правило для Prisma 7).
11. **Идемпотентность webhook** — по `externalEventId = eventType:operationId:status`. Дубликаты → 200 + skip.
12. **fire-and-forget реф-комиссии**: транзакция = инвойс + подписка + операция; реф-payout и signup-бонус — после транзакции, без `await` в основной цепочке. Если упадёт — оплата всё равно зафиксирована.
13. **Optimistic lock на `Org.billingDetailsVersion`** — клиент шлёт `version`, при mismatch → 409.
14. **InvoiceNumber sequence**: Postgres `CREATE SEQUENCE invoice_number_seq` через `backend/scripts/postgres-init.sql` (Шаг 5 prod-deploy) или через `Invoice.billingNumber Int @unique @default(autoincrement())`. Выбираем второй вариант — он переносим.
15. **При смене `TOCHKA_CUSTOMER_CODE`** — consent привязан к старому customer'у, webhook'и могут перестать работать. Перерегистрировать OAuth.
16. **Sandbox Tochka не возвращает customers через OpenBanking** → в `INN_LOOKUP_PROVIDER=tochka_then_dadata` лукап в sandbox всегда идёт в DaData.
17. **Rate-limit `/public/referrals/attribution`** — 10 req/min/IP через `@nestjs/throttler` с Redis-backend (не in-memory как в порт-брифе — у нас multi-instance prod).
18. **TenantGuard в Z** требует `X-Org-Id` либо `:orgId` в пути. Биллинг-эндпоинты `/billing/*` — это per-current-tenant: смотрим `req.user.currentTenantId` (из cookie/JWT) либо явный `X-Org-Id` header. Webhook'и и public-эндпоинты НЕ под `TenantGuard`.
19. **Skill `safe-seed-rules`**: все seed-скрипты для биллинга — **defensive**, не затирают admin-edited данные (например, `BillingProviderConfig` при повторных запусках не перезаписывается).
20. **EventEmitter2** в Z уже подключён глобально (см. probe-agent модуль). Используем тот же бус для `invoice.paid` / `subscription.*` — не плодим второй.

## 17. DoD всего ТЗ

- [ ] Все 10 фаз закрыты с DoD каждой.
- [ ] `bun run typecheck && bun run lint && bun run build` зелёные на backend и frontend.
- [ ] `bun run test:unit` и `bun run test:integration` зелёные для модулей `billing`, `referrals`, `inn-lookup`, `meetings-balance`.
- [ ] Тестовая канарейка в проде: реальная оплата 1 ₽ картой через Точку проходит весь цикл.
- [ ] Реф-выплата фейк-сценария проходит в admin-UI.
- [ ] `docs/operations/prod-deploy-log.md` содержит все ENV, patch-скрипты, seed, и smoke-проверки.
- [ ] Рефлексия в `second-brain/05_история/` записана.
- [ ] `second-brain/index.md` обновлён, добавлены `01_projects/billing.md`, `01_projects/referrals.md`, `01_projects/inn-lookup.md`, `01_projects/meetings-balance.md`.

## 18. Что НЕ переносим из порт-брифа

- Сущность `Company` — у нас `Org`.
- Tier-схема комиссий (6500/10000 ₽) — у нас фикс 20 000 ₽.
- Несколько планов (`free/pro/pro_plus/premium`) — у нас один `tier_standard`.
- `PlanPrepayDiscount` — у нас годовая скидка фиксированно 20%, в коде.
- `SignupReferralCode` / `SignupReferralRedemption` (welcome-коды) — откладываются.
- `Promotion`, `PlanOffer`, `Tier2 override`, `PartnerCandidate`, `InteractionLog`, `PartnerLifecycleHistory`, `PartnerLinkClick` — Crossmark-specific.
- `PartnerMonthlyStat`, `PartnerCommission`, `PartnerCommissionItem`, `ReferralBalanceLedger` — у нас простая `Referral` + `ReferralPayout` модель.
- Эндпоинт `/billing/pay-from-referral-balance` — у нас не накапливается баланс реферала на стороне Z (выплата идёт прямой выплатой).

## 19. Открытые вопросы (до начала Ф.1)

1. **Брать ли в первую волну bank-invoice (безнал) или только card-recurring?** — Текущий план: брать оба, т.к. оба есть в Точке и code в брифе готов. Если хочется ускорить — можно отложить bank-invoice до Ф.7+ (оставить только `ManualBillingService` для оффлайн-счёта).
2. **InvoiceNumber: sequence или autoincrement?** — Плановое решение: `Int @unique @default(autoincrement())` + строковая обёртка `Z-YYYY-NNNNNN` в InvoiceService (генерится из `billingNumber` + года `createdAt`). Это переносимо между БД.
3. **Где хранить `attributionToken` Org до первой оплаты?** — Решение: добавить два поля на `Org` — `pendingAttributionSlug` и `pendingAttributionAttributedAt` (либо JSON-поле `attributionSnapshot`). Если не хочется добавлять — хранить в `Subscription.metadata Json`. По умолчанию — на `Org` (2 поля, явный контракт).
4. **Запускать ли welcome-коды в первой волне?** — Нет (см. §3). Они откладываются до отдельного ТЗ после запуска базовой реф-программы.
5. **Где хранить юр.реквизиты Z (для шапки PDF)?** — В ENV (как описано в §5). Альтернатива — `BillingProviderConfig['z.legal_entity']`. ENV проще и переживает рестарты без БД. Решение — ENV.

---

**Готово.** ТЗ заменяет драфты `2026-05-25-billing-and-referrals-tz.md` и `2026-05-25-inn-lookup-tz.md`. После апрува владельцем — переводим status в `approved`, старые два — в `superseded` и переносим в `plans/archive/`.

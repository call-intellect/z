---
дата: 2026-05-27
тип: порт-бриф (самодостаточный) — для переноса в другой проект
охватывает: Billing, Referral, Signup-Referral, Tochka Bank, DaData
---

# Самодостаточный документ для переноса: Billing + Referral + Tochka + DaData

Один документ. Без внешних ссылок. Содержит:
- Архитектурные принципы.
- Полные Prisma-модели.
- Все DTO с валидацией.
- Все REST-эндпоинты.
- Полный код провайдера Tochka (Acquiring + Invoice + Webhook + OpenBanking + OAuth).
- Полный код lookup-сервиса с интеграцией DaData.
- Алгоритмы билинга, реф-комиссий, signup-бонусов.
- ENV-переменные и значения.
- Граблей и чек-лист переноса.

Стек оригинала: **NestJS 11 + Prisma 7 + PostgreSQL**. Перенос на NestJS — копи-пейст.
На другой стек — алгоритмы и контракты сохранить, обёртки переписать.

---

## Оглавление

1. [Архитектурные принципы](#1-архитектурные-принципы)
2. [ENV-переменные](#2-env-переменные)
3. [Prisma-модели (полная схема)](#3-prisma-модели-полная-схема)
4. [Enum-константы](#4-enum-константы)
5. [BillingProviderPort — интерфейс провайдера](#5-billingproviderport--интерфейс-провайдера)
6. [TochkaBillingProvider — полный код](#6-tochkabillingprovider--полный-код)
7. [TochkaOAuthService — полный код OAuth](#7-tochkaoauthservice--полный-код-oauth)
8. [CompanyBillingDetailsService + DaData](#8-companybillingdetailsservice--dadata)
9. [BillingPricingService — расчёт цены](#9-billingpricingservice--расчёт-цены)
10. [BillingPolicyService — политики](#10-billingpolicyservice--политики)
11. [DTO (class-validator)](#11-dto-class-validator)
12. [REST-эндпоинты — все 4 контроллера](#12-rest-эндпоинты--все-4-контроллера)
13. [Webhook-контроллер и обработка](#13-webhook-контроллер-и-обработка)
14. [BillingModule — фабрика провайдера](#14-billingmodule--фабрика-провайдера)
15. [Реферальная программа: алгоритм комиссий](#15-реферальная-программа-алгоритм-комиссий)
16. [Реф-эндпоинты](#16-реф-эндпоинты)
17. [Signup-бонусы (welcome-коды)](#17-signup-бонусы-welcome-коды)
18. [Cron-задачи](#18-cron-задачи)
19. [Ключевые сценарии (последовательности)](#19-ключевые-сценарии)
20. [Грабли и нюансы](#20-грабли-и-нюансы)
21. [Чек-лист переноса](#21-чек-лист-переноса)

---

## 1. Архитектурные принципы

1. **Платёжный провайдер абстрагирован портом** `BillingProviderPort`. Реализаций две: `TochkaBillingProvider` (реальная) и `ManualBillingProvider` (заглушка для admin-only сценариев). Выбор провайдера — через ENV `BILLING_PROVIDER=tochka|manual`, инжектится фабрикой в `BillingModule`.
2. **Источник истины «клиент платный»** — только `BillingInvoice { status: 'paid' }`. Никаких выводов по `Subscription.planCode`. Реф-комиссии считаются ТОЛЬКО с реально оплаченных счетов.
3. **Webhook → BillingEventLog**: все события от провайдера логируются для дедупа и аудита. Дедуп по `externalEventId = eventType:operationId:status`.
4. **OAuth-токены Точки** хранятся в БД (генерический KV-стор), не в env. ENV хранит только `client_id`/`client_secret`/`redirect_uri`. Refresh обновляется автоматически за 5 минут до `expires_at`.
5. **Транзакционность**: оплата инвойса + обновление подписки + биллинг-операция — одна `prisma.$transaction`. Реф-комиссия и signup-бонус начисляются fire-and-forget после транзакции — не блокируют оплату.
6. **Реф-комиссии**: instant (при оплате каждого инвойса) + ежемесячный cron 1-го числа в 01:00 МСК для финализации.
7. **Signup-бонусы**: отложенная активация (анти-фрод). Бонус «забронирован» при регистрации, активируется при первой оплате. Через 90 дней без оплаты — `status='expired_unactivated'`.

---

## 2. ENV-переменные

### Billing — общие

```bash
# Выбор провайдера
BILLING_PROVIDER=tochka                  # tochka | manual

# Feature-flags (без них код пропускает инициализацию)
FEATURE_BILLING_TOCHKA=true              # включает интеграцию с Tochka
FEATURE_BILLING_CARD_RENEWAL=true        # разрешает рекуррент (автосписание)
FEATURE_BILLING_BANK_INVOICE=true        # разрешает безнал (счёт на оплату)

# Публичные URL для редиректов после оплаты
BILLING_PUBLIC_API_URL=https://api.example.com   # HTTPS бэка для return-URL
BILLING_SUCCESS_REDIRECT_URL=               # опц. явный URL после успеха
BILLING_FAIL_REDIRECT_URL=                  # опц. явный URL после неуспеха
CABINET_URL=https://app.example.com         # fallback для редиректа в кабинет
BACKEND_URL=https://api.example.com         # fallback для return-URL

# CLI-флаг (для скриптов прогона автопродлений)
BILLING_CLI_RENEWALS_ONLY=                  # =1 — пропустить OAuth и webhook init
```

### Tochka Bank

```bash
TOCHKA_MODE=sandbox                          # sandbox | production
TOCHKA_API_VERSION=v1.0                      # версия API
TOCHKA_API_BASE_URL=                         # дефолт зависит от MODE
                                             # sandbox: https://enter.tochka.com/sandbox/v2/
                                             # prod:    https://enter.tochka.com/uapi/

TOCHKA_CUSTOMER_CODE=303231800               # код юр.лица (обяз. в prod)
TOCHKA_ACCOUNT_ID=40702810901234567890/044525104   # счёт/БИК (для безнала)
TOCHKA_MERCHANT_ID=                          # опц. — если несколько ТТ

# OAuth (только production)
TOCHKA_CLIENT_ID=                            # выдан Точкой при регистрации app
TOCHKA_CLIENT_SECRET=
TOCHKA_REDIRECT_URI=https://api.example.com/internal/billing/tochka/oauth/callback
TOCHKA_JWT_TOKEN=                            # если задан — используется как Bearer (без OAuth UI)
TOCHKA_OAUTH_SCOPES=accounts balances customers statements sbp payments acquiring
TOCHKA_OAUTH_PERMISSIONS=ReadAccountsBasic,ReadAccountsDetail,ReadCustomerData,MakeAcquiringOperation,ReadAcquiringData,ManageWebhookData,ManageInvoiceData
TOCHKA_OAUTH_CONSENT_EXPIRES_AT=             # ISO-дата (опц.)

# Webhook
TOCHKA_WEBHOOK_URL=https://api.example.com/internal/billing/provider-events
TOCHKA_WEBHOOK_EVENT_TYPES=acquiringInternetPayment
TOCHKA_WEBHOOK_AUTO_REGISTER=true            # при старте бэка делает PUT /webhook/<clientId>
TOCHKA_WEBHOOK_PUBLIC_KEY_URL=https://enter.tochka.com/doc/openapi/static/keys/public
```

### DaData

```bash
DADATA_API_KEY=                              # Token API DaData (опц., нужен для fallback lookup по ИНН)
```

---

## 3. Prisma-модели (полная схема)

```prisma
// ====================== BILLING ======================

model Plan {
  code           String   @id
  name           String
  priceRub       Int      @default(0) @map("price_rub")
  billingPeriod  String   @default("month") @map("billing_period")
  limitsJson     Json     @default("{}") @map("limits_json")
  featuresJson   Json     @default("{}") @map("features_json")
  isActive       Boolean  @default(true) @map("is_active")
  isPublic       Boolean  @default(true) @map("is_public")
  sortOrder      Int      @default(0) @map("sort_order")
  description    String?
  version        Int      @default(1)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  subscriptions    Subscription[]
  billingInvoices  BillingInvoice[]
  prepayDiscounts  PlanPrepayDiscount[]

  @@map("plans")
}

model PlanPrepayDiscount {
  id              String   @id @default(uuid()) @db.Uuid
  planCode        String   @map("plan_code")
  months          Int
  discountPercent Int      @map("discount_percent")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  plan Plan @relation(fields: [planCode], references: [code], onDelete: Cascade)

  @@unique([planCode, months])
  @@index([planCode])
  @@map("plan_prepay_discounts")
}

model Subscription {
  id                       String   @id @default(uuid()) @db.Uuid
  companyId                String   @unique @map("company_id") @db.Uuid
  planCode                 String   @map("plan_code")
  status                   String   @default("active")
  currentPeriodStart       DateTime @map("current_period_start") @db.Timestamptz
  currentPeriodEnd         DateTime @map("current_period_end") @db.Timestamptz
  autoRenew                Boolean  @default(true) @map("auto_renew")
  cancelAtPeriodEnd        Boolean  @default(false) @map("cancel_at_period_end")
  renewalMode              String   @default("manual") @map("renewal_mode")
  renewalLeadDays          Int      @default(7) @map("renewal_lead_days")
  providerName             String?  @map("provider_name")
  providerSubscriptionId   String?  @map("provider_subscription_id")
  providerConsumerId       String?  @map("provider_consumer_id")
  providerMerchantId       String?  @map("provider_merchant_id")
  lastRenewalAttemptAt     DateTime? @map("last_renewal_attempt_at") @db.Timestamptz
  bonusStrategies          Int      @default(0) @map("bonus_strategies")
  bonusSearches            Int      @default(0) @map("bonus_searches")
  sourceType               String?  @map("source_type")
  sourceRef                String?  @map("source_ref")
  customPriceRub           Int?     @map("custom_price_rub")
  recurringCycleAmountRub  Int?     @map("recurring_cycle_amount_rub")
  recurringCycleMonths     Int?     @map("recurring_cycle_months")
  signupDiscountPercent    Int?     @map("signup_discount_percent")
  signupDiscountUntil      DateTime? @map("signup_discount_until") @db.Timestamptz
  createdAt                DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt                DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  company           Company           @relation(fields: [companyId], references: [id])
  plan              Plan              @relation(fields: [planCode], references: [code])
  billingInvoices   BillingInvoice[]
  billingOperations BillingOperation[]
  billingEventLogs  BillingEventLog[]

  @@index([status])
  @@map("subscriptions")
}

model BillingInvoice {
  id                      String    @id @default(uuid()) @db.Uuid
  companyId               String    @map("company_id") @db.Uuid
  subscriptionId          String?   @map("subscription_id") @db.Uuid
  billingNumber           Int?      @unique @map("billing_number")
  planCode                String    @map("plan_code")
  periodYear              Int       @map("period_year")
  periodMonth             Int       @map("period_month")
  sequence                Int       @default(1)
  periodStart             DateTime? @map("period_start") @db.Timestamptz
  periodEnd               DateTime? @map("period_end") @db.Timestamptz
  amountRub               Int       @map("amount_rub")
  currency                String    @default("RUB")
  status                  String    @default("draft")
  paymentSourceType       String?   @map("payment_source_type")
  paymentMethod           String?   @map("payment_method")
  paymentProvider         String?   @map("payment_provider")
  providerName            String?   @map("provider_name")
  providerInvoiceId       String?   @map("provider_invoice_id")
  providerSubscriptionId  String?   @map("provider_subscription_id")
  paymentUrl              String?   @map("payment_url")
  externalStatus          String?   @map("external_status")
  dueAt                   DateTime? @map("due_at") @db.Timestamptz
  sentAt                  DateTime? @map("sent_at") @db.Timestamptz
  metadataJson            Json?     @map("metadata_json")
  manualComment           String?   @map("manual_comment")
  createdByUserId         String?   @map("created_by_user_id") @db.Uuid
  paidByUserId            String?   @map("paid_by_user_id") @db.Uuid
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz
  paidAt                  DateTime? @map("paid_at") @db.Timestamptz
  failedAt                DateTime? @map("failed_at") @db.Timestamptz
  voidedAt                DateTime? @map("voided_at") @db.Timestamptz

  company           Company                 @relation(fields: [companyId], references: [id])
  subscription      Subscription?           @relation(fields: [subscriptionId], references: [id])
  plan              Plan                    @relation(fields: [planCode], references: [code])
  billingOperations BillingOperation[]
  billingEventLogs  BillingEventLog[]
  commissionItems   PartnerCommissionItem[]

  @@unique([companyId, periodYear, periodMonth, sequence])
  @@index([companyId, periodYear, periodMonth, sequence])
  @@index([status, paidAt])
  @@index([subscriptionId])
  @@map("billing_invoices")
}

model BillingOperation {
  id              String    @id @default(uuid()) @db.Uuid
  companyId       String    @map("company_id") @db.Uuid
  subscriptionId  String?   @map("subscription_id") @db.Uuid
  invoiceId       String?   @map("invoice_id") @db.Uuid
  operationType   String    @map("operation_type")
  amountRub       Int?      @map("amount_rub")
  currency        String    @default("RUB")
  status          String    @default("completed")
  sourceType      String?   @map("source_type")
  sourceRef       String?   @map("source_ref")
  metaJson        Json?     @map("meta_json")
  reason          String?
  createdByUserId String?   @map("created_by_user_id") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  completedAt     DateTime? @map("completed_at") @db.Timestamptz

  company      Company         @relation(fields: [companyId], references: [id])
  subscription Subscription?   @relation(fields: [subscriptionId], references: [id])
  invoice      BillingInvoice? @relation(fields: [invoiceId], references: [id])

  @@index([companyId])
  @@index([operationType])
  @@index([createdAt])
  @@map("billing_operations")
}

model BillingEventLog {
  id              String    @id @default(uuid()) @db.Uuid
  eventType       String    @map("event_type")
  companyId       String?   @map("company_id") @db.Uuid
  subscriptionId  String?   @map("subscription_id") @db.Uuid
  invoiceId       String?   @map("invoice_id") @db.Uuid
  providerName    String?   @map("provider_name")
  externalEventId String?   @map("external_event_id")
  payloadJson     Json?     @map("payload_json")
  status          String    @default("received")
  processedAt     DateTime? @map("processed_at") @db.Timestamptz
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz

  company      Company?        @relation(fields: [companyId], references: [id])
  subscription Subscription?   @relation(fields: [subscriptionId], references: [id])
  invoice      BillingInvoice? @relation(fields: [invoiceId], references: [id])

  @@index([companyId])
  @@index([eventType])
  @@index([externalEventId])
  @@map("billing_event_log")
}

model UsageCounter {
  id           String   @id @default(uuid()) @db.Uuid
  companyId    String   @map("company_id") @db.Uuid
  periodYear   Int      @map("period_year")
  periodMonth  Int      @map("period_month")
  countersJson Json     @default("{}") @map("counters_json")
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  company Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, periodYear, periodMonth])
  @@index([companyId, periodYear, periodMonth])
  @@map("usage_counters")
}

model SubscriptionReminderSent {
  id            String   @id @default(uuid()) @db.Uuid
  companyId     String   @map("company_id") @db.Uuid
  periodEndDate DateTime @map("period_end_date") @db.Timestamptz
  daysBefore    Int      @map("days_before")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@unique([companyId, periodEndDate, daysBefore])
  @@index([companyId, periodEndDate])
  @@map("subscription_reminder_sent")
}

model CompanyBillingDetails {
  companyId        String   @id @map("company_id") @db.Uuid
  payerType        String   @map("payer_type")
  legalName        String   @map("legal_name")
  inn              String
  kpp              String?
  ogrn             String?
  legalAddress     String   @map("legal_address")
  postalAddress    String?  @map("postal_address")
  contactEmail     String   @map("contact_email")
  contactPhone     String?  @map("contact_phone")
  contactPerson    String?  @map("contact_person")
  bankName         String?  @map("bank_name")
  bankBik          String?  @map("bank_bik")
  bankAccount      String?  @map("bank_account")
  bankCorrAccount  String?  @map("bank_corr_account")
  notes            String?
  version          Int      @default(1)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt        DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  company Company @relation(fields: [companyId], references: [id])

  @@map("company_billing_details")
}

// KV-таблица для хранения OAuth-токенов и state'ов
model PipelineConfig {
  key       String  @id
  valueJson Json    @map("value_json")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("pipeline_config")
}

// ====================== REFERRALS ======================

model Partner {
  id            String   @id @default(uuid()) @db.Uuid
  partnerType   String   @map("partner_type")
  userId        String?  @unique @map("user_id") @db.Uuid
  companyId     String?  @unique @map("company_id") @db.Uuid
  status        String   @default("standard")
  canUseProPlus Boolean  @default(false) @map("can_use_pro_plus")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  // CRM (опц.)
  assignedManagerId String?   @map("assigned_manager_id") @db.Uuid
  assignedAt        DateTime? @map("assigned_at") @db.Timestamptz
  lifecycleStatus   String    @default("connected") @map("lifecycle_status")
  niche             String?
  audienceSize      Int?      @map("audience_size")
  audiencePotential String?   @map("audience_potential")
  channels          String[]  @default([]) @map("channels")
  tags              String[]  @default([]) @map("tags")
  lastReferralAt    DateTime? @map("last_referral_at") @db.Timestamptz
  lastPaymentAt     DateTime? @map("last_payment_at") @db.Timestamptz

  user                  User?                  @relation("PartnerUser", fields: [userId], references: [id])
  company               Company?               @relation("PartnerCompany", fields: [companyId], references: [id])
  links                 PartnerLink[]
  referralAttributions  ReferralAttribution[]
  monthlyStats          PartnerMonthlyStat[]
  commissions           PartnerCommission[]
  payoutRequests        PayoutRequest[]
  balanceLedger         ReferralBalanceLedger[]

  @@index([lifecycleStatus])
  @@map("partners")
}

model PartnerLink {
  id           String   @id @default(uuid()) @db.Uuid
  partnerId    String   @map("partner_id") @db.Uuid
  code         String   @unique
  title        String   @default("Ссылка")
  linkType     String   @default("regular") @map("link_type")
  planOfferId  String?  @map("offer_id") @db.Uuid
  channelTag   String?  @map("channel_tag")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz

  partner      Partner               @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  attributions ReferralAttribution[]

  @@index([partnerId])
  @@map("partner_links")
}

model ReferralAttribution {
  id              String   @id @default(uuid()) @db.Uuid
  companyId       String   @unique @map("company_id") @db.Uuid
  partnerId       String   @map("partner_id") @db.Uuid
  partnerLinkId   String?  @map("partner_link_id") @db.Uuid
  attributionType String   @default("first_touch") @map("attribution_type")
  attributedAt    DateTime @default(now()) @map("attributed_at") @db.Timestamptz

  company     Company       @relation("ReferredCompany", fields: [companyId], references: [id])
  partner     Partner       @relation(fields: [partnerId], references: [id])
  partnerLink PartnerLink?  @relation(fields: [partnerLinkId], references: [id])

  @@index([partnerId, attributedAt])
  @@map("referral_attributions")
}

model PartnerMonthlyStat {
  id                    String   @id @default(uuid()) @db.Uuid
  partnerId             String   @map("partner_id") @db.Uuid
  periodYear            Int      @map("period_year")
  periodMonth           Int      @map("period_month")
  newRegistrations      Int      @default(0) @map("new_registrations")
  activePayingReferrals Int      @default(0) @map("active_paying_referrals")
  tier                  String   @default("standard")
  rate                  Decimal  @default(0.10) @db.Decimal(4, 2)
  updatedAt             DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)

  @@unique([partnerId, periodYear, periodMonth])
  @@map("partner_monthly_stats")
}

model PartnerCommission {
  id            String    @id @default(uuid()) @db.Uuid
  partnerId     String    @map("partner_id") @db.Uuid
  periodYear    Int       @map("period_year")
  periodMonth   Int       @map("period_month")
  amountRub     Int       @default(0) @map("amount_rub")
  amountUsed    Int       @default(0) @map("amount_used")
  rate          Decimal   @db.Decimal(4, 2)
  status        String    @default("calculated")
  commissionKind String   @default("regular") @map("commission_kind")
  payableAt     DateTime? @map("payable_at") @db.Timestamptz
  paidAt        DateTime? @map("paid_at") @db.Timestamptz
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  partner Partner                 @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  items   PartnerCommissionItem[]

  @@unique([partnerId, periodYear, periodMonth])
  @@index([status])
  @@map("partner_commissions")
}

model PartnerCommissionItem {
  id                  String @id @default(uuid()) @db.Uuid
  commissionId        String @map("commission_id") @db.Uuid
  companyId           String @map("company_id") @db.Uuid
  invoiceId           String @map("invoice_id") @db.Uuid
  invoiceAmountRub    Int    @map("invoice_amount_rub")
  commissionAmountRub Int    @map("commission_amount_rub")

  commission PartnerCommission @relation(fields: [commissionId], references: [id], onDelete: Cascade)
  invoice    BillingInvoice    @relation(fields: [invoiceId], references: [id])

  @@index([commissionId])
  @@map("partner_commission_items")
}

model PayoutRequest {
  id          String    @id @default(uuid()) @db.Uuid
  partnerId   String    @map("partner_id") @db.Uuid
  amountRub   Int       @map("amount_rub")
  status      String    @default("pending")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  processedAt DateTime? @map("processed_at") @db.Timestamptz

  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)

  @@index([partnerId])
  @@index([status])
  @@map("payout_requests")
}

model ReferralBalanceLedger {
  id         String   @id @default(uuid()) @db.Uuid
  partnerId  String   @map("partner_id") @db.Uuid
  companyId  String?  @map("company_id") @db.Uuid
  entryType  String   @map("entry_type")
  amountRub  Int      @map("amount_rub")
  currency   String   @default("RUB")
  sourceType String?  @map("source_type")
  sourceRef  String?  @map("source_ref")
  status     String   @default("completed")
  metaJson   Json?    @map("meta_json")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz

  partner Partner @relation(fields: [partnerId], references: [id])

  @@index([partnerId])
  @@index([companyId])
  @@map("referral_balance_ledger")
}

// ====================== SIGNUP REFERRAL ======================

model SignupReferralCode {
  id                    String   @id @default(uuid()) @db.Uuid
  code                  String   @unique
  ownerType             String   @default("admin") @map("owner_type")
  ownerUserId           String   @map("owner_user_id") @db.Uuid
  rewardType            String   @map("reward_type")
  rewardValue           Int      @map("reward_value")
  rewardDurationMonths  Int?     @map("reward_duration_months")
  planCode              String?  @map("plan_code")
  maxRedemptions        Int?     @map("max_redemptions")
  redeemedCount         Int      @default(0) @map("redeemed_count")
  expiresAt             DateTime? @map("expires_at") @db.Timestamptz
  title                 String
  description           String?
  isActive              Boolean  @default(true) @map("is_active")
  archivedAt            DateTime? @map("archived_at") @db.Timestamptz
  createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  redemptions SignupReferralRedemption[]

  @@index([ownerUserId])
  @@index([isActive, archivedAt])
  @@index([expiresAt])
  @@map("signup_referral_codes")
}

model SignupReferralRedemption {
  id                     String   @id @default(uuid()) @db.Uuid
  signupReferralCodeId   String   @map("signup_referral_code_id") @db.Uuid
  refereeUserId          String   @map("referee_user_id") @db.Uuid
  refereeCompanyId       String   @map("referee_company_id") @db.Uuid
  subscriptionId         String?  @map("subscription_id") @db.Uuid
  invoiceId              String?  @map("invoice_id") @db.Uuid
  status                 String   @default("pending")
  refereeIpHash          String?  @map("referee_ip_hash")
  refereeFingerprintHash String?  @map("referee_fingerprint_hash")
  refereeEmailNormalized String   @map("referee_email_normalized")
  rewardSnapshotJson     Json?    @map("reward_snapshot_json")
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz
  appliedAt              DateTime? @map("applied_at") @db.Timestamptz
  expiresAt              DateTime? @map("expires_at") @db.Timestamptz

  code SignupReferralCode @relation(fields: [signupReferralCodeId], references: [id], onDelete: Cascade)

  @@unique([signupReferralCodeId, refereeUserId])
  @@index([refereeCompanyId, status])
  @@index([status, expiresAt])
  @@map("signup_referral_redemptions")
}
```

---

## 4. Enum-константы

`billing.types.ts`:

```typescript
export const OperationType = {
  INVOICE_CREATED: 'invoice_created',
  INVOICE_PAID: 'invoice_paid',
  INVOICE_FAILED: 'invoice_failed',
  INVOICE_VOIDED: 'invoice_voided',
  SUBSCRIPTION_CHANGED: 'subscription_changed',
  SUBSCRIPTION_EXTENDED: 'subscription_extended',
  ADMIN_PLAN_CHANGE: 'admin_plan_change',
  ADMIN_SUBSCRIPTION_PERIOD_SET: 'admin_subscription_period_set',
  ADMIN_CUSTOM_PRICE_SET: 'admin_custom_price_set',
  ADMIN_SET_FREE_PLAN: 'admin_set_free_plan',
  ADMIN_PROVIDER_RECURRING_CANCEL: 'admin_provider_recurring_cancel',
  REFERRAL_BALANCE_CHARGE: 'referral_balance_charge',
  EXTERNAL_PAYMENT_REGISTERED: 'external_payment_registered',
  ADJUSTMENT: 'adjustment',
} as const;
export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export const InvoiceStatus = {
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  FAILED: 'failed',
  VOID: 'void',
  CANCELED: 'canceled',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  PAUSED: 'paused',
} as const;

export const PaymentSourceType = {
  MANUAL_ADMIN: 'manual_admin',
  REFERRAL_BALANCE: 'referral_balance',
  EXTERNAL_PROVIDER: 'external_provider',
} as const;
export type PaymentSourceType = (typeof PaymentSourceType)[keyof typeof PaymentSourceType];

export const SourceType = {
  REGISTRATION: 'registration',
  ADMIN_MANUAL: 'admin_manual',
  PROMO: 'promo',
  REFERRAL_BALANCE: 'referral_balance',
  EXTERNAL_PAYMENT: 'external_payment',
} as const;

export const BillingEventType = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  INVOICE_CREATED: 'invoice.created',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_FAILED: 'invoice.failed',
  INVOICE_VOIDED: 'invoice.voided',
  MANUAL_PLAN_CHANGE: 'manual.plan_change',
  MANUAL_EXTEND: 'manual.extend',
  MANUAL_MARK_PAID: 'manual.mark_paid',
  REFERRAL_PAYMENT: 'referral.payment',
  PROVIDER_WEBHOOK: 'provider.webhook',
  EXTERNAL_PAYMENT_CREATED: 'external_payment.created',
  EXTERNAL_PAYMENT_PAID: 'external_payment.paid',
  EXTERNAL_PAYMENT_FAILED: 'external_payment.failed',
  BANK_INVOICE_CREATED: 'bank_invoice.created',
  BANK_INVOICE_SENT: 'bank_invoice.sent',
} as const;

export const RenewalMode = {
  MANUAL: 'manual',
  CARD_RECURRING: 'card_recurring',
  BANK_INVOICE: 'bank_invoice',
  REFERRAL_BALANCE: 'referral_balance',
} as const;

export const BillingPaymentMethod = {
  CARD_LINK: 'card_link',
  CARD_RECURRING: 'card_recurring',
  BANK_INVOICE: 'bank_invoice',
  REFERRAL_BALANCE: 'referral_balance',
  MANUAL_ADMIN: 'manual_admin',
} as const;

export const PLAN_HIERARCHY = ['free', 'pro', 'pro_plus', 'premium'] as const;

// Реф-программа
export const PAID_PLANS = ['pro', 'pro_plus', 'premium'] as const;
export type ReferralPaymentStatus = 'free' | 'paid' | 'comped' | 'was_paid';
```

---

## 5. BillingProviderPort — интерфейс провайдера

```typescript
export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export class BillingProviderResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingProviderResourceNotFoundError';
  }
}

export interface CreatePaymentRequest {
  invoiceId: string;
  amountRub: number;
  currency: string;
  description: string;
  customerCode?: string;
  merchantId?: string;
  paymentLinkId?: string;
  paymentMode?: Array<'card' | 'sbp' | 'tinkoff' | 'dolyame'>;
  returnUrl?: string;
  failReturnUrl?: string;
  saveCard?: boolean;
  consumerId?: string;
  ttlMinutes?: number;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerInvoiceId: string;
  paymentUrl?: string;
  externalStatus?: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface CreateBankInvoiceRequest {
  invoiceId: string;
  invoiceNumber?: string;
  amountRub: number;
  description: string;
  customerCode: string;
  accountId: string;
  payer: {
    legalName: string;
    inn: string;
    kpp?: string | null;
    legalAddress: string;
    contactEmail: string;
    contactPhone?: string | null;
  };
  periodStart: Date;
  periodEnd: Date;
  dueDate?: Date;
}

export interface CreateBankInvoiceResult {
  providerInvoiceId: string;
  externalStatus: string;
}

export interface GetBankInvoiceStatusResult {
  providerInvoiceId: string;
  status: 'payment_waiting' | 'payment_expired' | 'payment_paid';
  paidAt?: Date;
}

export interface CreateRecurringSubscriptionRequest {
  invoiceId: string;
  amountRub: number;
  description: string;
  customerCode: string;
  paymentLinkId?: string;
  returnUrl?: string;
  failReturnUrl?: string;
  saveCard?: boolean;
  recurring?: boolean;
  options?: {
    trancheCount?: number;
    period?: 'Day' | 'Month';
    daysInPeriod?: number;
  };
}

export interface CreateRecurringSubscriptionResult {
  providerSubscriptionId: string;
  providerInvoiceId?: string;
  paymentUrl?: string;
  consumerId?: string;
  externalStatus?: string;
}

export interface ChargeRecurringSubscriptionRequest {
  providerSubscriptionId: string;
  amountRub: number;
}

export interface ChargeRecurringSubscriptionResult {
  providerInvoiceId: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentStatusResult {
  providerInvoiceId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  paidAt?: Date;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  providerInvoiceId: string;
  status: string;
  amount?: number;
  currency?: string;
  paidAt?: Date;
  rawPayload: Record<string, unknown>;
}

export interface RegisterWebhooksRequest {
  url: string;
  events: string[];
}

export interface RegisterWebhooksResult {
  ok: boolean;
  webhookIds?: string[];
}

export interface BankInvoiceFileResult {
  content: Buffer;
  contentType: string;
  fileName?: string;
}

export interface BillingDetailsLookupResult {
  source: 'tochka' | 'external';
  payerType: 'legal_entity' | 'individual_entrepreneur';
  legalName: string;
  inn: string;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  bankBik?: string | null;
  bankAccount?: string | null;
}

export interface BillingProviderPort {
  readonly providerName: string;

  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  createBankInvoice(request: CreateBankInvoiceRequest): Promise<CreateBankInvoiceResult>;
  getBankInvoiceStatus(providerInvoiceId: string): Promise<GetBankInvoiceStatusResult>;
  sendBankInvoiceToEmail(request: { providerInvoiceId: string; email: string }): Promise<void>;
  createRecurringSubscription(request: CreateRecurringSubscriptionRequest): Promise<CreateRecurringSubscriptionResult>;
  getRecurringSubscriptionStatus(providerSubscriptionId: string): Promise<string>;
  cancelRecurringSubscription(providerSubscriptionId: string): Promise<void>;
  chargeRecurringSubscription(request: ChargeRecurringSubscriptionRequest): Promise<ChargeRecurringSubscriptionResult>;
  refundPayment(request: { providerInvoiceId: string; amountRub: number }): Promise<void>;
  getPaymentStatus(providerInvoiceId: string): Promise<PaymentStatusResult>;
  getBankInvoiceFile(providerInvoiceId: string): Promise<BankInvoiceFileResult>;
  deleteBankInvoice(providerInvoiceId: string): Promise<void>;
  lookupCompanyByInn?(inn: string): Promise<BillingDetailsLookupResult | null>;
  registerWebhooks?(request: RegisterWebhooksRequest): Promise<RegisterWebhooksResult>;
  parseWebhook(headers: Record<string, string>, body: unknown): WebhookEvent;
  verifyWebhookSignature(headers: Record<string, string>, body: unknown): boolean | Promise<boolean>;
}
```

---

## 6. TochkaBillingProvider — полный код

```typescript
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importJWK, jwtVerify, type JWK } from 'jose';
import {
  BillingProviderResourceNotFoundError,
  type BillingProviderPort,
  // ... все типы из секции 5
} from './billing-provider.port';
import { TochkaOAuthService } from './tochka-oauth.service';

type TochkaEnvelope<T> = { Data: T; Links?: Record<string, unknown>; Meta?: Record<string, unknown> };

@Injectable()
export class TochkaBillingProvider implements BillingProviderPort {
  readonly providerName = 'tochka';
  private readonly logger = new Logger(TochkaBillingProvider.name);
  private webhookPublicKeyPromise: Promise<Awaited<ReturnType<typeof importJWK>>> | null = null;
  private static readonly SANDBOX_BEARER_TOKEN = 'sandbox.jwt.token';

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly tochkaOAuth?: TochkaOAuthService,
  ) {}

  // ============== ACQUIRING (карта/СБП) ==============

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const response = await this.request<TochkaEnvelope<any>>(
      `/acquiring/${this.apiVersion}/payments`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: this.compact({
            customerCode: request.customerCode ?? this.customerCode,
            amount: request.amountRub,
            purpose: request.description,
            paymentMode: request.paymentMode ?? ['card', 'sbp'],
            redirectUrl: request.returnUrl,
            failRedirectUrl: request.failReturnUrl,
            saveCard: request.saveCard,
            consumerId: request.consumerId,
            merchantId: request.merchantId ?? this.merchantId,
            ttl: request.ttlMinutes,
            paymentLinkId: request.paymentLinkId ?? request.invoiceId,
          }),
        }),
      },
    );
    const data = response.Data ?? {};
    return {
      providerInvoiceId: data.operationId ?? data.paymentId ?? request.invoiceId,
      paymentUrl: data.paymentLink,
      externalStatus: data.status,
      status: this.mapAcquiringStatus(data.status),
    };
  }

  async createRecurringSubscription(
    request: CreateRecurringSubscriptionRequest,
  ): Promise<CreateRecurringSubscriptionResult> {
    if (request.recurring && request.options) {
      throw new Error('Tochka does not allow recurring=true together with Options');
    }
    const response = await this.request<TochkaEnvelope<any>>(
      `/acquiring/${this.apiVersion}/subscriptions`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: this.compact({
            customerCode: request.customerCode,
            amount: request.amountRub,
            purpose: request.description,
            redirectUrl: request.returnUrl,
            failRedirectUrl: request.failReturnUrl,
            saveCard: request.saveCard,
            recurring: request.recurring,
            Options: request.options,
            paymentLinkId: request.paymentLinkId ?? request.invoiceId,
            merchantId: this.merchantId,
          }),
        }),
      },
    );
    const data = response.Data ?? {};
    return {
      providerSubscriptionId: data.subscriptionId ?? data.operationId ?? request.invoiceId,
      providerInvoiceId: data.operationId ?? data.paymentId,
      paymentUrl: data.paymentLink,
      consumerId: data.consumerId,
      externalStatus: data.status,
    };
  }

  async chargeRecurringSubscription(
    request: ChargeRecurringSubscriptionRequest,
  ): Promise<ChargeRecurringSubscriptionResult> {
    await this.request(
      `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(request.providerSubscriptionId)}/charge`,
      {
        method: 'POST',
        body: JSON.stringify({ Data: { amount: Number(request.amountRub) } }),
      },
    );
    return {
      providerInvoiceId: `${request.providerSubscriptionId}:${Date.now()}`,
      status: 'pending',
    };
  }

  async getRecurringSubscriptionStatus(providerSubscriptionId: string): Promise<string> {
    try {
      const response = await this.request<TochkaEnvelope<any>>(
        `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/status`,
        { method: 'GET', retryable: true } as any,
      );
      const raw = response.Data;
      const row = Array.isArray(raw) ? raw[0] : raw;
      return String(row?.status ?? row?.subscriptionStatus ?? row?.State ?? 'Unknown');
    } catch (error) {
      const { status, body } = this.parseTochkaRequestError(error);
      if (this.isTochkaResourceMissingResponse(status, body)) return 'Cancelled';
      throw error;
    }
  }

  async cancelRecurringSubscription(providerSubscriptionId: string): Promise<void> {
    try {
      await this.request(
        `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ Data: { status: 'Cancelled' } }),
        },
      );
    } catch (error) {
      const { status, body } = this.parseTochkaRequestError(error);
      if (this.isTochkaResourceMissingResponse(status, body)) return;
      throw error;
    }
  }

  async refundPayment(request: { providerInvoiceId: string; amountRub: number }): Promise<void> {
    await this.request(
      `/acquiring/${this.apiVersion}/payments/${encodeURIComponent(request.providerInvoiceId)}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ Data: { amount: request.amountRub } }),
      },
    );
  }

  async getPaymentStatus(providerInvoiceId: string): Promise<PaymentStatusResult> {
    const path = `/acquiring/${this.apiVersion}/payments/${encodeURIComponent(providerInvoiceId)}`;
    const { status, text } = await this.fetchWithStatus(path, { method: 'GET', retryable: true } as any);
    if (this.isTochkaResourceMissingResponse(status, text)) {
      throw new BillingProviderResourceNotFoundError(`Tochka payment ${providerInvoiceId} not found`);
    }
    if (status < 200 || status >= 300) throw new Error(`Tochka API error ${status}: ${text}`);
    const response = JSON.parse(text);
    return {
      providerInvoiceId,
      status: this.mapOperationStatus(response.Data?.status),
    };
  }

  // ============== INVOICE (безнал) ==============

  async createBankInvoice(request: CreateBankInvoiceRequest): Promise<CreateBankInvoiceResult> {
    const number = (request.invoiceNumber ?? request.invoiceId).slice(0, 32);
    const response = await this.request<TochkaEnvelope<any>>(
      `/invoice/${this.apiVersion}/bills`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: {
            accountId: request.accountId,
            customerCode: request.customerCode,
            SecondSide: this.compact({
              taxCode: request.payer.inn,
              type: request.payer.kpp ? 'company' : 'ip',
              secondSideName: request.payer.legalName,
              legalAddress: request.payer.legalAddress,
              kpp: request.payer.kpp,
            }),
            Content: {
              Invoice: this.compact({
                number,
                date: this.toDateString(new Date()),
                basedOn: request.description,
                comment: `Подписка ${this.toDateString(request.periodStart)} - ${this.toDateString(request.periodEnd)}`,
                paymentExpiryDate: request.dueDate ? this.toDateString(request.dueDate) : undefined,
                totalAmount: request.amountRub,
                totalNds: 0,
                Positions: [{
                  positionName: request.description,
                  unitCode: 'услуга.',
                  ndsKind: 'without_nds',
                  price: request.amountRub,
                  quantity: 1,
                  totalAmount: request.amountRub,
                  totalNds: 0,
                }],
              }),
            },
          },
        }),
      },
    );
    return {
      providerInvoiceId: response.Data?.documentId ?? response.Data?.invoiceId ?? request.invoiceId,
      externalStatus: 'payment_waiting',
    };
  }

  async getBankInvoiceStatus(providerInvoiceId: string): Promise<GetBankInvoiceStatusResult> {
    const path = `/invoice/${this.apiVersion}/bills/${encodeURIComponent(this.customerCode)}/${encodeURIComponent(providerInvoiceId)}/payment-status`;
    const { status, text } = await this.fetchWithStatus(path, { method: 'GET' });
    if (this.isTochkaResourceMissingResponse(status, text)) {
      throw new BillingProviderResourceNotFoundError(`Tochka invoice ${providerInvoiceId} not found`);
    }
    if (status < 200 || status >= 300) throw new Error(`Tochka API error ${status}: ${text}`);
    const response = JSON.parse(text);
    return {
      providerInvoiceId,
      status: response.Data?.paymentStatus ?? 'payment_waiting',
      paidAt: response.Data?.paymentStatus === 'payment_paid' ? new Date() : undefined,
    };
  }

  async sendBankInvoiceToEmail(request: { providerInvoiceId: string; email: string }): Promise<void> {
    await this.request(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(this.customerCode)}/${encodeURIComponent(request.providerInvoiceId)}/email`,
      { method: 'POST', body: JSON.stringify({ Data: { email: request.email } }) },
    );
  }

  async getBankInvoiceFile(providerInvoiceId: string): Promise<BankInvoiceFileResult> {
    const buffer = await this.request<Buffer>(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(this.customerCode)}/${encodeURIComponent(providerInvoiceId)}/file`,
      { method: 'GET', parseAs: 'buffer', retryable: true } as any,
    );
    return { content: buffer, contentType: 'application/pdf', fileName: `${providerInvoiceId}.pdf` };
  }

  async deleteBankInvoice(providerInvoiceId: string): Promise<void> {
    await this.request(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(this.customerCode)}/${encodeURIComponent(providerInvoiceId)}`,
      { method: 'DELETE' },
    );
  }

  // ============== OPEN BANKING (lookup по ИНН) ==============

  async lookupCompanyByInn(inn: string): Promise<BillingDetailsLookupResult | null> {
    if (this.isSandboxMode) return null;
    const customers = await this.getCustomersList();
    for (const customer of customers) {
      const customerCode = customer.customerCode ?? customer.customerId ?? customer.id;
      if (!customerCode) continue;
      const info = await this.getCustomerInfo(customerCode).catch(() => null);
      if (!info || info.inn !== inn) continue;
      const firstAccountId = info.AccountList?.[0]?.accountId;
      return {
        source: 'tochka',
        payerType: info.kpp ? 'legal_entity' : 'individual_entrepreneur',
        legalName: info.name ?? customerCode,
        inn: info.inn,
        kpp: info.kpp ?? null,
        ogrn: info.ogrn ?? null,
        legalAddress: info.address ?? null,
        bankBik: info.bankCode ?? null,
        bankAccount: firstAccountId?.split('/')[0] ?? null,
      };
    }
    return null;
  }

  private async getCustomersList() {
    const response = await this.request<TochkaEnvelope<any>>(
      `/open-banking/${this.apiVersion}/customers`,
      { method: 'GET', retryable: true } as any,
    );
    const d = response.Data;
    if (Array.isArray(d)) return d;
    return d?.Customer ?? d?.Customers ?? [d];
  }

  private async getCustomerInfo(customerCode: string) {
    const response = await this.request<TochkaEnvelope<any>>(
      `/open-banking/${this.apiVersion}/customers/${encodeURIComponent(customerCode)}`,
      { method: 'GET', retryable: true } as any,
    );
    return response.Data ?? null;
  }

  // ============== WEBHOOK ==============

  async registerWebhooks(request: RegisterWebhooksRequest): Promise<RegisterWebhooksResult> {
    const path = `/webhook/${this.apiVersion}/${encodeURIComponent(this.clientId)}`;
    // GET → если есть webhook и URL/events не совпадают — удалить, потом PUT.
    const existing = await this.tryGetWebhookRegistration(path);
    if (existing && this.isWebhookRegistrationUpToDate(existing, request)) {
      return { ok: true };
    }
    if (existing) await this.deleteWebhookRegistration(existing);

    const response = await this.request<TochkaEnvelope<any>>(path, {
      method: 'PUT',
      body: JSON.stringify({ url: request.url, webhooksList: request.events }),
    });
    return { ok: true, webhookIds: this.extractWebhookIds(response) };
  }

  parseWebhook(headers: Record<string, string>, body: unknown): WebhookEvent {
    const token = this.extractWebhookToken(body);
    const [, payloadPart] = token.split('.');
    if (!payloadPart) throw new Error('Invalid Tochka webhook JWT');
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const rawPayload = JSON.parse(json);

    const eventId = [
      rawPayload.webhookType ?? 'tochka',
      rawPayload.operationId ?? rawPayload.transactionId ?? rawPayload.paymentLinkId ?? 'unknown',
      rawPayload.status ?? 'unknown',
    ].join(':');

    return {
      eventId,
      eventType: String(rawPayload.webhookType ?? 'unknown'),
      providerInvoiceId: String(rawPayload.operationId ?? rawPayload.paymentLinkId ?? 'unknown'),
      status: String(rawPayload.status ?? 'unknown'),
      amount: rawPayload.amount != null ? Number(rawPayload.amount) : undefined,
      currency: 'RUB',
      rawPayload: { ...rawPayload, _headers: headers },
    };
  }

  async verifyWebhookSignature(_headers: Record<string, string>, body: unknown): Promise<boolean> {
    try {
      const token = this.extractWebhookToken(body);
      const publicKey = await this.getWebhookPublicKey();
      await jwtVerify(token, publicKey, { algorithms: ['RS256'] });
      return true;
    } catch (error) {
      this.logger.warn(`Tochka webhook verification failed: ${String(error)}`);
      return false;
    }
  }

  private extractWebhookToken(body: unknown): string {
    if (typeof body === 'string') return body.trim();
    if (body && typeof body === 'object') {
      const candidate = (body as any).token ?? (body as any).jwt ?? (body as any).body;
      if (typeof candidate === 'string') return candidate.trim();
    }
    throw new Error('Tochka webhook body must be a JWT string');
  }

  private async getWebhookPublicKey() {
    if (!this.webhookPublicKeyPromise) {
      this.webhookPublicKeyPromise = (async () => {
        const response = await fetch(this.webhookPublicKeyUrl);
        if (!response.ok) throw new Error(`Failed to load Tochka webhook key: ${response.status}`);
        const jwk = (await response.json()) as JWK;
        return importJWK(jwk, 'RS256');
      })();
    }
    return this.webhookPublicKeyPromise;
  }

  // ============== HTTP-обёртка с retry ==============

  private async request<T = unknown>(path: string, init: any): Promise<T> {
    const parseAs = init.parseAs ?? 'json';
    const method = (init.method ?? 'GET').toUpperCase();
    const retryable = (init.retryable ?? false) && (method === 'GET' || method === 'DELETE');
    const attempts = retryable ? 3 : 1;
    let lastError: Error | null = null;
    const bearerToken = await this.getBearerToken();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(new URL(path.replace(/^\//, ''), this.baseUrl), {
          ...init,
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          },
        });

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(`Tochka API error ${response.status}: ${text}`);
          if (!retryable || response.status < 500 || attempt === attempts) throw error;
          lastError = error;
          await this.sleep(250 * 2 ** (attempt - 1));
          continue;
        }

        if (response.status === 204) return undefined as T;
        if (parseAs === 'buffer') return Buffer.from(await response.arrayBuffer()) as T;

        const text = await response.text();
        if (!text.trim()) return undefined as T;
        return JSON.parse(text) as T;
      } catch (error) {
        if (!retryable || attempt === attempts) throw error;
        lastError = error as Error;
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
    throw lastError ?? new Error('Unknown Tochka request error');
  }

  private async fetchWithStatus(path: string, init: any): Promise<{ status: number; text: string }> {
    const bearerToken = await this.getBearerToken();
    const response = await fetch(new URL(path.replace(/^\//, ''), this.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return { status: response.status, text: await response.text() };
  }

  // ============== HELPERS ==============

  private isTochkaResourceMissingResponse(status: number, text: string): boolean {
    if (status === 404 || status === 410) return true;
    const sample = text.slice(0, 12_000).toLowerCase();
    return sample.includes('не существует')
        || sample.includes('does not exist')
        || sample.includes('subscription not found');
  }

  private parseTochkaRequestError(error: unknown): { status: number; body: string } {
    const msg = error instanceof Error ? error.message : String(error);
    const match = msg.match(/^Tochka API error (\d+):\s*(.*)/s);
    if (match) return { status: Number(match[1]), body: match[2] ?? '' };
    return { status: 0, body: msg };
  }

  private mapAcquiringStatus(status?: string): 'pending' | 'succeeded' | 'failed' {
    if (status === 'APPROVED') return 'succeeded';
    if (status === 'REFUNDED' || status === 'EXPIRED') return 'failed';
    return 'pending';
  }

  private mapOperationStatus(status?: string): 'pending' | 'succeeded' | 'failed' | 'canceled' {
    if (status === 'APPROVED') return 'succeeded';
    if (status === 'REFUNDED' || status === 'EXPIRED') return 'failed';
    if (status === 'CANCELED' || status === 'Cancelled') return 'canceled';
    return 'pending';
  }

  private compact<T extends Record<string, unknown>>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as T;
  }
  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
  private toDateString(d: Date): string { return d.toISOString().slice(0, 10); }

  // ============== CONFIG ==============

  private get mode(): 'sandbox' | 'production' {
    return this.config.get<string>('TOCHKA_MODE', 'sandbox') === 'production' ? 'production' : 'sandbox';
  }
  private get isSandboxMode() { return this.mode === 'sandbox'; }
  private get apiVersion() { return this.config.get<string>('TOCHKA_API_VERSION', 'v1.0'); }
  private get baseUrl() {
    return this.config.get<string>('TOCHKA_API_BASE_URL')
        ?? (this.isSandboxMode
            ? 'https://enter.tochka.com/sandbox/v2/'
            : 'https://enter.tochka.com/uapi/');
  }
  private get customerCode() {
    const v = this.config.get<string>('TOCHKA_CUSTOMER_CODE');
    if (!v) throw new Error('TOCHKA_CUSTOMER_CODE is not configured');
    return v;
  }
  private get merchantId() { return this.config.get<string>('TOCHKA_MERCHANT_ID'); }
  private get clientId() {
    return this.config.get<string>('TOCHKA_CLIENT_ID') ?? (this.isSandboxMode ? 'test_app' : '');
  }
  private get webhookPublicKeyUrl() {
    return this.config.get<string>('TOCHKA_WEBHOOK_PUBLIC_KEY_URL')
        ?? 'https://enter.tochka.com/doc/openapi/static/keys/public';
  }

  private async getBearerToken(): Promise<string> {
    if (this.isSandboxMode) return TochkaBillingProvider.SANDBOX_BEARER_TOKEN;
    const explicitJwt = this.config.get<string>('TOCHKA_JWT_TOKEN');
    if (explicitJwt) return explicitJwt;
    const oauthToken = await this.tochkaOAuth?.getAccessToken();
    if (oauthToken) return oauthToken;
    throw new Error('Tochka bearer token is not configured for production');
  }

  // Хелперы registerWebhooks/extractWebhookIds — опущены ради краткости.
  // Они GET'ают `/webhook/<clientId>`, сравнивают URL/events, DELETE при mismatch, PUT нового.
  private async tryGetWebhookRegistration(_path: string): Promise<any> { return null; }
  private async deleteWebhookRegistration(_existing: any) {}
  private isWebhookRegistrationUpToDate(_existing: any, _r: RegisterWebhooksRequest) { return false; }
  private extractWebhookIds(_response: any): string[] { return []; }
}
```

---

## 7. TochkaOAuthService — полный код OAuth

```typescript
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/index';

type TochkaTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string;
};

type StoredOauthTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: string;
  obtainedAt: string;
  userId?: string;
};

const OAUTH_STATE_KEY = 'billing_tochka_production_oauth_state';
const OAUTH_TOKENS_KEY = 'billing_tochka_production_oauth_tokens';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

@Injectable()
export class TochkaOAuthService {
  private readonly logger = new Logger(TochkaOAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Вызывается при старте бэка: проверяет токены, рефрешит, если нужно — печатает URL для авторизации в лог. */
  async ensureOAuthReady(): Promise<void> {
    if (this.isSandboxMode) return;

    const clientId = this.config.get<string>('TOCHKA_CLIENT_ID');
    const clientSecret = this.config.get<string>('TOCHKA_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      this.logger.warn('TOCHKA_CLIENT_ID/SECRET не заданы — OAuth пропущен');
      return;
    }

    const stored = await this.getStoredTokens();
    if (stored && !this.isTokenExpired(stored)) return;
    if (stored?.refreshToken) {
      try {
        await this.refreshAndStoreToken(stored.refreshToken);
        return;
      } catch (e) {
        this.logger.warn(`Refresh не сработал: ${String(e)}`);
      }
    }

    // Нет валидных токенов — печатаем URL для UI-авторизации.
    try {
      const authorizeUrl = await this.createAuthorizationUrl();
      this.logger.warn('TOCHKA OAuth: откройте URL в браузере: ' + authorizeUrl);
    } catch (e) {
      this.logger.error(`Не удалось создать authorize URL: ${String(e)}`);
    }
  }

  /** Используется TochkaBillingProvider.getBearerToken — возвращает свежий access_token. */
  async getAccessToken(): Promise<string | null> {
    if (this.isSandboxMode) return null;
    const stored = await this.getStoredTokens();
    if (!stored) return null;
    if (!this.isTokenExpired(stored)) return stored.accessToken;
    if (!stored.refreshToken) return null;
    try {
      const refreshed = await this.refreshAndStoreToken(stored.refreshToken);
      return refreshed.accessToken;
    } catch { return null; }
  }

  /** Принимает code+state из OAuth callback и обменивает на токены. */
  async handleOAuthCallback(params: { code?: string; state?: string; error?: string; errorDescription?: string }) {
    if (params.error) throw new BadRequestException(`Tochka OAuth: ${params.error}`);
    if (!params.code || !params.state) throw new BadRequestException('code или state отсутствуют');

    const storedState = await this.getStoredState();
    if (!storedState) throw new BadRequestException('OAuth-сессия не найдена');
    if (storedState.state !== params.state) throw new BadRequestException('state не совпадает');

    const ageMs = Date.now() - new Date(storedState.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000) throw new BadRequestException('OAuth state истёк');

    const tokenResponse = await this.exchangeAuthorizationCode({
      code: params.code,
      redirectUri: storedState.redirectUri,
      scopes: storedState.scopes,
    });
    const tokens = await this.storeTokens(tokenResponse);
    await this.clearStoredState();
    return { ok: true, expiresAt: tokens.expiresAt ?? null, hasRefreshToken: Boolean(tokens.refreshToken) };
  }

  // ====== ВНУТРЕННЕЕ ======

  private async createAuthorizationUrl(): Promise<string> {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    const scopes = this.getScopes();
    const permissions = this.getPermissions();

    // 1. Получаем service token через client_credentials.
    const serviceToken = await this.requestServiceToken(scopes);
    // 2. Создаём consent.
    const consentId = await this.createConsent(serviceToken, permissions);
    // 3. Сохраняем state.
    const state = randomUUID();
    const now = new Date().toISOString();
    await this.prisma.pipelineConfig.upsert({
      where: { key: OAUTH_STATE_KEY },
      update: { valueJson: { state, createdAt: now, consentId, redirectUri, scopes } },
      create: { key: OAUTH_STATE_KEY, valueJson: { state, createdAt: now, consentId, redirectUri, scopes } },
    });
    // 4. Возвращаем URL для браузера.
    const authorizeUrl = new URL('https://enter.tochka.com/connect/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', scopes.join(' '));
    authorizeUrl.searchParams.set('consent_id', consentId);
    return authorizeUrl.toString();
  }

  private async requestServiceToken(scopes: string[]): Promise<string> {
    const response = await this.postForm<TochkaTokenResponse>('https://enter.tochka.com/connect/token', {
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      grant_type: 'client_credentials',
      scope: scopes.join(' '),
    });
    if (!response.access_token) throw new BadRequestException('Нет service access_token');
    return response.access_token;
  }

  private async createConsent(serviceToken: string, permissions: string[]): Promise<string> {
    const expirationDateTime = this.config.get<string>('TOCHKA_OAUTH_CONSENT_EXPIRES_AT');
    const response = await fetch('https://enter.tochka.com/uapi/v1.0/consents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Data: { permissions, ...(expirationDateTime ? { expirationDateTime } : {}) },
      }),
    });
    if (!response.ok) throw new BadRequestException(`Consent failed: ${response.status} ${await response.text()}`);
    const json = await response.json();
    const consentId = json?.Data?.consentId;
    if (!consentId) throw new BadRequestException('Нет consentId');
    return consentId;
  }

  private async exchangeAuthorizationCode(params: { code: string; redirectUri: string; scopes: string[] }) {
    return this.postForm<TochkaTokenResponse>('https://enter.tochka.com/connect/token', {
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      grant_type: 'authorization_code',
      scope: params.scopes.join(' '),
      code: params.code,
      redirect_uri: params.redirectUri,
    });
  }

  private async refreshAndStoreToken(refreshToken: string): Promise<StoredOauthTokens> {
    const tokenResponse = await this.postForm<TochkaTokenResponse>('https://enter.tochka.com/connect/token', {
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.storeTokens(tokenResponse, refreshToken);
  }

  private async postForm<T>(url: string, payload: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString(),
    });
    if (!response.ok) throw new BadRequestException(`Tochka OAuth: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }

  private async storeTokens(r: TochkaTokenResponse, fallbackRefreshToken?: string): Promise<StoredOauthTokens> {
    if (!r.access_token) throw new BadRequestException('Нет access_token');
    const obtainedAt = new Date();
    const expiresAt = typeof r.expires_in === 'number'
      ? new Date(obtainedAt.getTime() + r.expires_in * 1000) : undefined;
    const stored: StoredOauthTokens = {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? fallbackRefreshToken,
      tokenType: r.token_type ?? 'bearer',
      expiresAt: expiresAt?.toISOString(),
      obtainedAt: obtainedAt.toISOString(),
      userId: r.user_id,
    };
    await this.prisma.pipelineConfig.upsert({
      where: { key: OAUTH_TOKENS_KEY },
      update: { valueJson: stored },
      create: { key: OAUTH_TOKENS_KEY, valueJson: stored },
    });
    return stored;
  }

  private async getStoredTokens(): Promise<StoredOauthTokens | null> {
    const row = await this.prisma.pipelineConfig.findUnique({ where: { key: OAUTH_TOKENS_KEY } });
    if (!row?.valueJson) return null;
    return row.valueJson as StoredOauthTokens;
  }

  private async getStoredState() {
    const row = await this.prisma.pipelineConfig.findUnique({ where: { key: OAUTH_STATE_KEY } });
    if (!row?.valueJson) return null;
    return row.valueJson as { state: string; createdAt: string; consentId: string; redirectUri: string; scopes: string[] };
  }

  private async clearStoredState() {
    await this.prisma.pipelineConfig.deleteMany({ where: { key: OAUTH_STATE_KEY } });
  }

  private isTokenExpired(t: StoredOauthTokens): boolean {
    if (!t.expiresAt) return false;
    const expiresAt = new Date(t.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;
  }

  private get isSandboxMode() { return this.config.get<string>('TOCHKA_MODE', 'sandbox') !== 'production'; }
  private getClientId() { return this.config.get<string>('TOCHKA_CLIENT_ID') || (() => { throw new Error('TOCHKA_CLIENT_ID'); })(); }
  private getClientSecret() { return this.config.get<string>('TOCHKA_CLIENT_SECRET') || (() => { throw new Error('TOCHKA_CLIENT_SECRET'); })(); }
  private getRedirectUri() { return this.config.get<string>('TOCHKA_REDIRECT_URI') || (() => { throw new Error('TOCHKA_REDIRECT_URI'); })(); }
  private getScopes() {
    return (this.config.get<string>('TOCHKA_OAUTH_SCOPES', 'accounts balances customers statements sbp payments acquiring') ?? '')
      .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  }
  private getPermissions() {
    return (this.config.get<string>('TOCHKA_OAUTH_PERMISSIONS',
      'ReadAccountsBasic,ReadAccountsDetail,ReadCustomerData,MakeAcquiringOperation,ReadAcquiringData,ManageWebhookData,ManageInvoiceData') ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
  }
}
```

---

## 8. CompanyBillingDetailsService + DaData

Лукап реквизитов компании по ИНН с двумя источниками — сначала Точка (если есть OpenBanking-доступ), потом fallback в DaData.

```typescript
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CompanyBillingDetails } from '@prisma/client';
import { PrismaService } from '../prisma/index';
import {
  BILLING_PROVIDER,
  type BillingDetailsLookupResult,
  type BillingProviderPort,
} from './billing-provider.port';

export const COMPANY_PAYER_TYPES = {
  LEGAL_ENTITY: 'legal_entity',
  INDIVIDUAL_ENTREPRENEUR: 'individual_entrepreneur',
} as const;

@Injectable()
export class CompanyBillingDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProviderPort,
  ) {}

  async getByCompanyId(companyId: string) {
    const details = await this.prisma.companyBillingDetails.findUnique({ where: { companyId } });
    return details ? this.toView(details) : null;
  }

  async assertReadyForBankInvoice(companyId: string) {
    const details = await this.getByCompanyId(companyId);
    if (!details) throw new NotFoundException('Реквизиты не заполнены');
    if (!details.readiness.isCompleteForBankInvoice) {
      throw new BadRequestException({
        message: 'Заполните реквизиты компании для выставления счёта',
        missingFields: details.readiness.missingFields,
      });
    }
    return details;
  }

  /**
   * Upsert с optimistic lock через `version`. Если на клиенте старая версия — ConflictException.
   */
  async upsert(companyId: string, input: any) {
    const existing = await this.prisma.companyBillingDetails.findUnique({ where: { companyId } });
    if (existing && input.version != null && input.version !== existing.version) {
      throw new ConflictException('Реквизиты были изменены в другой сессии');
    }
    const data = {
      payerType: input.payerType,
      legalName: input.legalName.trim(),
      inn: input.inn.trim(),
      kpp: input.kpp?.trim() || null,
      ogrn: input.ogrn?.trim() || null,
      legalAddress: input.legalAddress.trim(),
      postalAddress: input.postalAddress?.trim() || null,
      contactEmail: input.contactEmail.trim().toLowerCase(),
      contactPhone: input.contactPhone?.trim() || null,
      contactPerson: input.contactPerson?.trim() || null,
      bankName: input.bankName?.trim() || null,
      bankBik: input.bankBik?.trim() || null,
      bankAccount: input.bankAccount?.trim() || null,
      bankCorrAccount: input.bankCorrAccount?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    const result = existing
      ? await this.prisma.companyBillingDetails.update({
          where: { companyId },
          data: { ...data, version: { increment: 1 } },
        })
      : await this.prisma.companyBillingDetails.create({ data: { companyId, ...data } });
    return this.toView(result);
  }

  /**
   * Lookup реквизитов по ИНН: 1) Точка через OpenBanking, 2) fallback DaData.
   */
  async lookupByInn(inn: string) {
    const normalizedInn = inn.trim();

    // 1. Tochka
    const fromTochka = this.provider.lookupCompanyByInn
      ? await this.provider.lookupCompanyByInn(normalizedInn).catch(() => null)
      : null;
    if (fromTochka) return this.toLookupView(fromTochka);

    // 2. DaData (fallback)
    const fromDadata = await this.lookupByInnViaDadata(normalizedInn);
    if (fromDadata) return this.toLookupView(fromDadata);

    throw new NotFoundException('Организация по ИНН не найдена');
  }

  /**
   * DaData: POST https://suggestions.dadata.ru/.../findById/party
   *   Headers: Authorization: Token <DADATA_API_KEY>
   *   Body:    { query: "<inn>", branch_type: "MAIN" }
   *   Response: { suggestions: [{ data: { inn, kpp, ogrn, type:'LEGAL'|'INDIVIDUAL', name:{full_with_opf}, address:{value} }}]}
   */
  private async lookupByInnViaDadata(inn: string): Promise<BillingDetailsLookupResult | null> {
    const apiKey = this.config.get<string>('DADATA_API_KEY')?.trim();
    if (!apiKey) return null;

    try {
      const response = await fetch(
        'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Token ${apiKey}`,
          },
          body: JSON.stringify({ query: inn, branch_type: 'MAIN' }),
        },
      );
      if (!response.ok) {
        throw new BadRequestException(`DaData lookup failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json() as any;
      const candidate = payload.suggestions?.[0]?.data;
      if (!candidate?.inn) return null;

      return {
        source: 'external',
        payerType: candidate.type === 'INDIVIDUAL'
          ? COMPANY_PAYER_TYPES.INDIVIDUAL_ENTREPRENEUR
          : COMPANY_PAYER_TYPES.LEGAL_ENTITY,
        legalName: candidate.name?.full_with_opf ?? inn,
        inn: candidate.inn,
        kpp: candidate.kpp ?? null,
        ogrn: candidate.ogrn ?? null,
        legalAddress: candidate.address?.value ?? null,
      };
    } catch {
      return null;
    }
  }

  private toLookupView(d: BillingDetailsLookupResult) {
    return {
      source: d.source,
      payerType: d.payerType,
      legalName: d.legalName,
      inn: d.inn,
      kpp: d.kpp ?? null,
      ogrn: d.ogrn ?? null,
      legalAddress: d.legalAddress ?? null,
      bankBik: d.bankBik ?? null,
      bankAccount: d.bankAccount ?? null,
    };
  }

  private toView(d: CompanyBillingDetails) {
    return {
      ...d,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      readiness: this.getReadiness(d),
    };
  }

  /** Проверяет, заполнены ли обязательные поля для выставления счёта. */
  private getReadiness(d: CompanyBillingDetails) {
    const missing: string[] = [];
    if (!d.payerType) missing.push('payerType');
    if (!d.legalName?.trim()) missing.push('legalName');
    if (!d.inn?.trim()) missing.push('inn');
    if (!d.legalAddress?.trim()) missing.push('legalAddress');
    if (!d.contactEmail?.trim()) missing.push('contactEmail');
    if (d.payerType === 'legal_entity' && !d.kpp?.trim()) missing.push('kpp');
    return { isCompleteForBankInvoice: missing.length === 0, missingFields: missing };
  }
}
```

---

## 9. BillingPricingService — расчёт цены

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/index';

export type PlanPriceInput = { code: string; priceRub: number };
export type SubscriptionPriceInput = {
  customPriceRub: number | null;
  signupDiscountPercent?: number | null;
  signupDiscountUntil?: Date | null;
};

@Injectable()
export class BillingPricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Цена ₽/мес с учётом персональной цены (если задана). */
  baseMonthlyRub(plan: { priceRub: number }, sub: SubscriptionPriceInput): number {
    return sub.customPriceRub ?? plan.priceRub;
  }

  applyDiscountPercent(grossRub: number, discountPercent: number): number {
    if (discountPercent <= 0) return grossRub;
    const clamped = Math.min(100, Math.max(0, discountPercent));
    return Math.round((grossRub * (100 - clamped)) / 100);
  }

  getActiveSignupDiscountPercent(sub: SubscriptionPriceInput, now = new Date()): number {
    const percent = sub.signupDiscountPercent ?? 0;
    if (percent <= 0 || !sub.signupDiscountUntil) return 0;
    if (sub.signupDiscountUntil < now) return 0;
    return Math.min(100, Math.max(0, percent));
  }

  async getPrepayDiscountPercent(planCode: string, months: number): Promise<number> {
    const row = await this.prisma.planPrepayDiscount.findUnique({
      where: { planCode_months: { planCode, months } },
    });
    return row?.discountPercent ?? 0;
  }

  /**
   * Сумма предоплаты за `months`:
   *   gross    = baseMonthly × months
   *   discount = PlanPrepayDiscount.discountPercent для (planCode, months)
   *   signup   = SignupBonus percent_off, если активен
   *
   *   amount = applyDiscount(applyDiscount(gross, discount), signup)
   *
   * Скидки складываются мультипликативно (стандарт SaaS).
   */
  async computePrepayAmountRub(
    plan: PlanPriceInput,
    subscription: SubscriptionPriceInput,
    months: number,
  ) {
    const listMonthlyRub = plan.priceRub;
    const baseMonthlyRub = this.baseMonthlyRub(plan, subscription);
    const grossRub = baseMonthlyRub * months;
    const discountPercent = await this.getPrepayDiscountPercent(plan.code, months);
    const afterPrepay = this.applyDiscountPercent(grossRub, discountPercent);
    const signupDiscountPercent = this.getActiveSignupDiscountPercent(subscription);
    const amountRub = this.applyDiscountPercent(afterPrepay, signupDiscountPercent);
    return { amountRub, baseMonthlyRub, listMonthlyRub, discountPercent, grossRub, signupDiscountPercent };
  }
}
```

---

## 10. BillingPolicyService — политики

```typescript
import { Injectable } from '@nestjs/common';
import { PLAN_HIERARCHY } from './billing.types';

@Injectable()
export class BillingPolicyService {
  isPlanUpgrade(currentPlan: string, newPlan: string): boolean {
    const c = PLAN_HIERARCHY.indexOf(currentPlan as any);
    const n = PLAN_HIERARCHY.indexOf(newPlan as any);
    return n > c;
  }

  canChangePlan(currentPlan: string, newPlan: string) {
    if (currentPlan === newPlan) return { allowed: false, reason: 'Компания уже на этом тарифе' };
    return { allowed: true };
  }

  calculatePeriodEnd(startDate: Date, months: number): Date {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + months);
    return end;
  }

  /** При продлении: если период ещё не истёк — новый период с конца текущего; иначе с now. */
  resolveExtensionBase(currentPeriodEnd: Date): Date {
    const now = new Date();
    return currentPeriodEnd > now ? new Date(currentPeriodEnd) : now;
  }

  validatePeriodMonths(months: number, maxMonths = 24): number {
    const max = Math.max(1, maxMonths);
    return Math.max(1, Math.min(max, Math.round(months)));
  }
}
```

---

## 11. DTO (class-validator)

### Cabinet DTO

```typescript
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const trimValue = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim(); return t === '' ? undefined : t;
};

export class PayFromBalanceDto {
  @IsString() planCode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) months?: number;
}

export class SubscriptionQuoteQueryDto {
  @IsString() planCode!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(24) months!: number;
}

export class UpsertCompanyBillingDetailsDto {
  @IsIn(['legal_entity', 'individual_entrepreneur'])
  payerType!: 'legal_entity' | 'individual_entrepreneur';

  @Transform(trimValue) @IsString() legalName!: string;

  @Transform(trimValue)
  @Matches(/^\d{10}(\d{2})?$/, { message: 'ИНН должен содержать 10 или 12 цифр' })
  inn!: string;

  @IsOptional() @Transform(trimOptional)
  @Matches(/^\d{9}$/, { message: 'КПП должен содержать 9 цифр' })
  kpp?: string;

  @IsOptional() @Transform(trimOptional)
  @Matches(/^\d{13}(\d{2})?$/, { message: 'ОГРН должен содержать 13 или 15 цифр' })
  ogrn?: string;

  @Transform(trimValue) @IsString() legalAddress!: string;
  @IsOptional() @Transform(trimOptional) @IsString() postalAddress?: string;

  @Transform(trimValue) @IsEmail() contactEmail!: string;
  @IsOptional() @Transform(trimOptional) @IsString() contactPhone?: string;
  @IsOptional() @Transform(trimOptional) @IsString() contactPerson?: string;

  @IsOptional() @Transform(trimOptional) @IsString() bankName?: string;
  @IsOptional() @Transform(trimOptional)
  @Matches(/^\d{9}$/) bankBik?: string;
  @IsOptional() @Transform(trimOptional)
  @Matches(/^\d{20}$/) bankAccount?: string;
  @IsOptional() @Transform(trimOptional)
  @Matches(/^\d{20}$/) bankCorrAccount?: string;

  @IsOptional() @Transform(trimOptional) @IsString() notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}

export class LookupCompanyBillingDetailsByInnDto {
  @Transform(trimValue) @Matches(/^\d{10}(\d{2})?$/) inn!: string;
}

export class StartCardSubscriptionPaymentDto {
  @IsString() planCode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) months?: number;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
}

export class StartBankInvoicePaymentDto {
  @IsString() planCode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) months?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) dueInDays?: number;
  @IsOptional() @IsBoolean() sendToEmail?: boolean;
}

export class UpdateAutoRenewDto {
  @IsBoolean() autoRenew!: boolean;
  @IsOptional() @IsIn(['manual', 'card_recurring', 'bank_invoice', 'referral_balance'])
  renewalMode?: 'manual' | 'card_recurring' | 'bank_invoice' | 'referral_balance';
}
```

### Admin DTO

```typescript
export class AdminChangePlanDto {
  @IsString() planCode!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(120) periodMonths!: number;
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() createInvoice?: boolean;
  @IsOptional() @IsBoolean() markInvoicePaid?: boolean;
  /** Защита от тихих подарков компаниям с реф-партнёром. */
  @IsOptional() @IsBoolean() ackReferralNoComp?: boolean;
}

export class AdminExtendSubscriptionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(120) months!: number;
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() ackReferralNoComp?: boolean;
}

export class AdminMarkInvoicePaidDto {
  @IsOptional() @IsString() paymentSourceType?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() externalReference?: string;
}

export class AdminVoidInvoiceDto { @IsString() reason!: string; }

export class AdminSubscriptionPeriodDto {
  @IsDateString() currentPeriodStart!: string;
  @IsDateString() currentPeriodEnd!: string;
  @IsString() reason!: string;
}

export class AdminCustomPriceDto {
  @Allow() customPriceRub!: number | null;
  @IsString() reason!: string;
}

export class AdminSetFreePlanDto {
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() clearCustomPrice?: boolean;
}

export class CreatePlanDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceRub?: number;
  @IsOptional() @IsString() billingPeriod?: string;
  @IsOptional() limitsJson?: Record<string, unknown>;
  @IsOptional() featuresJson?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsString() description?: string;
}

export class CreatePlanPrepayDiscountDto {
  @Type(() => Number) @IsInt() @Min(1) months!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) discountPercent!: number;
}
```

### Referral DTO

```typescript
export class CreateReferralLinkDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsIn(['regular', 'pro_plus']) linkType?: 'regular' | 'pro_plus';
  @IsOptional() @IsString() offerId?: string;
}

export class CreateWithdrawRequestDto {
  @Type(() => Number) @IsInt() @Min(1) amountRub!: number;
}

export class PaySubscriptionFromBalanceDto {
  @IsString() planCode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) months?: number;
}
```

### Signup-bonus DTO

```typescript
export class CreateSignupBonusDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(['free_months', 'percent_off', 'credit_rub'])
  rewardType!: 'free_months' | 'percent_off' | 'credit_rub';
  @Type(() => Number) @IsInt() @Min(1) rewardValue!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) rewardDurationMonths?: number;
  @IsOptional() @IsString() planCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class RevertRedemptionDto { @IsString() reason!: string; }
```

---

## 12. REST-эндпоинты — все 4 контроллера

### 12.1 BillingCabinetController — `/billing/*`

Guard: `JwtAuthGuard`. Кабинет авторизованного пользователя.

```typescript
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingCabinetController {
  constructor(
    private readonly billing: BillingService,
    private readonly invoices: BillingInvoiceService,
    private readonly subscriptions: BillingSubscriptionService,
    private readonly entitlement: EntitlementService,
    private readonly companyBillingDetails: CompanyBillingDetailsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('subscription')
  async getSubscription(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    const sub = await this.subscriptions.getByCompanyIdOrNull(companyId);
    const ent = await this.entitlement.getEntitlement(companyId);
    return { subscription: sub, entitlement: ent };
  }

  @Get('invoices')
  async getInvoices(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.invoices.getByCompany(companyId);
  }

  @Get('invoices/:invoiceId/file')
  async downloadInvoiceFile(@Param('invoiceId') invoiceId, @Req() req, @Res() res) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    const file = await this.billing.getBankInvoiceFileForCompany(companyId, invoiceId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition',
      `attachment; filename="${invoiceId}.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName ?? `${invoiceId}.pdf`)}`);
    res.send(file.content);
  }

  @Get('plans')
  getPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  @Get('subscription/quote')
  async getSubscriptionQuote(@Query() q: SubscriptionQuoteQueryDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.getSubscriptionQuote({ companyId, planCode: q.planCode, months: q.months });
  }

  @Get('provider/retailers')
  getRetailers() { return this.billing.getRetailers(); }

  @Get('provider/recurring-subscription')
  async getProviderRecurringSubscription(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.getProviderRecurringSubscriptionInfo(companyId);
  }

  @Post('provider/recurring-subscription/cancel')
  async cancelProviderRecurring(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.cancelProviderRecurringSubscription(companyId);
  }

  @Post('pay-from-referral-balance')
  async payFromBalance(@Body() dto: PayFromBalanceDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    const partner = await this.prisma.partner.findFirst({ where: { companyId } });
    if (!partner) throw new Error('Компания не зарегистрирована как партнёр');
    return this.billing.payFromReferralBalance({
      partnerId: partner.id, companyId, planCode: dto.planCode, months: dto.months ?? 1,
    });
  }

  @Get('entitlement')
  async getEntitlement(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.entitlement.getEntitlement(companyId);
  }

  @Get('company-billing-details')
  async getCompanyBillingDetails(@Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.companyBillingDetails.getByCompanyId(companyId);
  }

  @Post('company-billing-details/lookup-by-inn')
  async lookupByInn(@Body() dto: LookupCompanyBillingDetailsByInnDto) {
    return this.companyBillingDetails.lookupByInn(dto.inn);
  }

  @Post('company-billing-details')
  async upsertCompanyBillingDetails(@Body() dto: UpsertCompanyBillingDetailsDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.companyBillingDetails.upsert(companyId, dto);
  }

  @Post('subscription/pay/card')
  async startCardSubscriptionPayment(@Body() dto: StartCardSubscriptionPaymentDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.createCardSubscriptionPayment({
      companyId, planCode: dto.planCode, months: dto.months ?? 12, autoRenew: dto.autoRenew,
    });
  }

  @Post('subscription/pay/bank-invoice')
  async startBankInvoicePayment(@Body() dto: StartBankInvoicePaymentDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.createBankInvoicePayment({
      companyId, planCode: dto.planCode, months: dto.months ?? 12,
      dueInDays: dto.dueInDays, sendToEmail: dto.sendToEmail,
    });
  }

  @Post('subscription/auto-renew')
  async updateAutoRenew(@Body() dto: UpdateAutoRenewDto, @Req() req) {
    const companyId = await this.resolveCompanyId(req.user.userId);
    return this.billing.updateAutoRenewSettings({
      companyId, autoRenew: dto.autoRenew, renewalMode: dto.renewalMode,
    });
  }

  // Public-редиректы после оплаты (без JWT)
  @SetMetadata(IS_PUBLIC_KEY, true) @Get('payment-return/success')
  redirectPaymentSuccess(@Res() res) {
    res.redirect(this.billing.getPaymentReturnRedirectUrl('success'));
  }
  @SetMetadata(IS_PUBLIC_KEY, true) @Get('payment-return/fail')
  redirectPaymentFail(@Res() res) {
    res.redirect(this.billing.getPaymentReturnRedirectUrl('fail'));
  }

  private async resolveCompanyId(userId: string): Promise<string> {
    const company = await this.prisma.company.findFirst({
      where: { ownerUserId: userId }, select: { id: true },
    });
    if (!company) throw new Error('Компания не найдена');
    return company.id;
  }
}
```

### 12.2 BillingAdminController — `/admin/billing/*`

Guard: `JwtAuthGuard + AdminGuard`. Все админ-операции с биллингом.

```typescript
@Controller('admin/billing')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BillingAdminController {
  // ─── Subscription management ───

  @Post('companies/:companyId/change-plan')
  changePlan(@Param('companyId') companyId, @Body() dto: AdminChangePlanDto, @Req() req) {
    return this.billing.adminChangePlan({
      companyId, planCode: dto.planCode, periodMonths: dto.periodMonths, reason: dto.reason,
      adminUserId: req.user.userId,
      createInvoice: dto.createInvoice, markInvoicePaid: dto.markInvoicePaid,
      ackReferralNoComp: dto.ackReferralNoComp,
    });
  }

  @Post('companies/:companyId/extend-subscription')
  extendSubscription(@Param('companyId') companyId, @Body() dto: AdminExtendSubscriptionDto, @Req() req) {
    return this.billing.adminExtendSubscription({
      companyId, months: dto.months, reason: dto.reason,
      adminUserId: req.user.userId, ackReferralNoComp: dto.ackReferralNoComp,
    });
  }

  @Post('companies/:companyId/cancel-provider-recurring')
  cancelProviderRecurring(@Param('companyId') companyId, @Req() req) {
    return this.billing.adminCancelProviderRecurring({ companyId, adminUserId: req.user.userId });
  }

  @Patch('companies/:companyId/subscription-period')
  setSubscriptionPeriod(@Param('companyId') companyId, @Body() dto: AdminSubscriptionPeriodDto, @Req() req) {
    return this.billing.adminSetSubscriptionPeriod({
      companyId,
      currentPeriodStart: new Date(dto.currentPeriodStart),
      currentPeriodEnd: new Date(dto.currentPeriodEnd),
      reason: dto.reason, adminUserId: req.user.userId,
    });
  }

  @Patch('companies/:companyId/subscription-pricing')
  setSubscriptionPricing(@Param('companyId') companyId, @Body() dto: AdminCustomPriceDto, @Req() req) {
    return this.billing.adminSetCustomPriceRub({
      companyId, customPriceRub: dto.customPriceRub,
      reason: dto.reason, adminUserId: req.user.userId,
    });
  }

  @Post('companies/:companyId/set-free')
  setFreePlan(@Param('companyId') companyId, @Body() dto: AdminSetFreePlanDto, @Req() req) {
    return this.billing.adminSetFreePlan({
      companyId, reason: dto.reason, adminUserId: req.user.userId,
      clearCustomPrice: dto.clearCustomPrice,
    });
  }

  @Get('companies/:companyId/summary')
  async getCompanyBillingSummary(@Param('companyId') companyId) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId }, include: { plan: true },
    });
    const providerRecurring = await this.billing.getProviderRecurringSubscriptionInfo(companyId);
    return { subscription, providerRecurring };
  }

  @Get('companies/:companyId/referral-context')
  getCompanyReferralContext(@Param('companyId') companyId) {
    return this.billing.getReferralContext(companyId);
  }

  // ─── Invoice management ───

  @Post('invoices/:invoiceId/mark-paid')
  markInvoicePaid(@Param('invoiceId') invoiceId, @Body() dto: AdminMarkInvoicePaidDto, @Req() req) {
    return this.billing.adminMarkInvoicePaid({
      invoiceId, paymentSourceType: dto.paymentSourceType as any,
      comment: dto.comment, externalReference: dto.externalReference,
      adminUserId: req.user.userId,
    });
  }

  @Post('invoices/:invoiceId/void')
  voidInvoice(@Param('invoiceId') invoiceId, @Body() dto: AdminVoidInvoiceDto, @Req() req) {
    return this.billing.adminVoidInvoice({
      invoiceId, reason: dto.reason, adminUserId: req.user.userId,
    });
  }

  // ─── History ───

  @Get('companies/:companyId/history')
  getHistory(@Param('companyId') companyId) {
    return this.billing.getCompanyBillingHistory(companyId);
  }

  @Get('companies/:companyId/invoices')
  getInvoices(@Param('companyId') companyId) { return this.invoices.getByCompany(companyId); }

  @Get('companies/:companyId/events')
  getEvents(@Param('companyId') companyId) { return this.events.getEventsByCompany(companyId); }

  // ─── Plans CRUD ───

  @Get('plans') getPlans() { return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }); }

  @Post('plans')
  async createPlan(@Body() dto: CreatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { code: dto.code } });
    if (existing) throw new BadRequestException(`Тариф "${dto.code}" уже существует`);
    return this.prisma.plan.create({ data: {
      code: dto.code.trim(), name: dto.name.trim(),
      priceRub: dto.priceRub ?? 0, billingPeriod: dto.billingPeriod ?? 'month',
      limitsJson: (dto.limitsJson ?? {}) as any,
      featuresJson: (dto.featuresJson ?? {}) as any,
      isPublic: dto.isPublic ?? true, isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0, description: dto.description?.trim() ?? null,
    }});
  }

  @Patch('plans/:code')
  async updatePlan(@Param('code') code, @Body() dto: any) {
    return this.prisma.plan.update({
      where: { code },
      data: { ...dto, version: { increment: 1 } },
    });
  }

  @Delete('plans/:code')
  async deletePlan(@Param('code') code) {
    if (code === 'free') throw new BadRequestException('Системный тариф free нельзя удалить');
    // Check связи: Subscription, PlanOffer, Promotion, BillingInvoice
    const [subs, invoices] = await Promise.all([
      this.prisma.subscription.count({ where: { planCode: code } }),
      this.prisma.billingInvoice.count({ where: { planCode: code } }),
    ]);
    if (subs > 0) throw new BadRequestException(`Подписок на тарифе: ${subs}`);
    if (invoices > 0) throw new BadRequestException(`Счетов на тарифе: ${invoices}`);
    await this.prisma.plan.delete({ where: { code } });
    return { ok: true };
  }

  // ─── Prepay discounts ───

  @Get('plans/:code/prepay-discounts')
  async listPrepayDiscounts(@Param('code') code) {
    return this.prisma.planPrepayDiscount.findMany({ where: { planCode: code }, orderBy: { months: 'asc' } });
  }

  @Post('plans/:code/prepay-discounts')
  async createPrepayDiscount(@Param('code') code, @Body() dto: CreatePlanPrepayDiscountDto) {
    return this.prisma.planPrepayDiscount.create({
      data: { planCode: code, months: dto.months, discountPercent: dto.discountPercent },
    });
  }

  @Patch('prepay-discounts/:id')
  async updatePrepayDiscount(@Param('id') id, @Body() dto: { discountPercent?: number }) {
    return this.prisma.planPrepayDiscount.update({
      where: { id }, data: { ...(dto.discountPercent !== undefined && { discountPercent: dto.discountPercent }) },
    });
  }

  @Delete('prepay-discounts/:id')
  async deletePrepayDiscount(@Param('id') id) {
    await this.prisma.planPrepayDiscount.delete({ where: { id } });
    return { ok: true };
  }
}
```

### 12.3 BillingWebhookController — `/internal/billing/provider-events`

```typescript
@Controller('internal/billing')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(private readonly billing: BillingService) {}

  /** Probe для регистрации webhook в Точке — должен ответить 200 на GET/HEAD. */
  @Get('provider-events') @HttpCode(200)
  webhookProbeGet() { return { ok: true }; }

  @Head('provider-events') @HttpCode(200)
  webhookProbeHead(): void { return; }

  /** Точка шлёт JWT-строку. Парсим, верифицируем подпись RS256, обрабатываем. */
  @Post('provider-events') @HttpCode(200)
  async handleProviderEvent(@Headers() headers, @Body() body) {
    return this.billing.handleProviderWebhook(headers, body);
  }
}
```

### 12.4 BillingTochkaOAuthController — `/internal/billing/tochka/oauth/callback`

```typescript
@Controller('internal/billing/tochka/oauth')
export class BillingTochkaOAuthController {
  constructor(private readonly tochkaOAuth: TochkaOAuthService) {}

  @Get('callback')
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const result = await this.tochkaOAuth.handleOAuthCallback({ code, state, error, errorDescription });
      res.status(200).type('html').send(`<h1>OAuth подключен</h1>
        <p>Refresh token: ${result.hasRefreshToken ? 'да' : 'нет'}</p>
        <p>Истекает: ${result.expiresAt ?? 'не указано'}</p>`);
    } catch (e) {
      res.status(400).type('html').send(`<h1>Ошибка OAuth</h1><p>${String(e)}</p>`);
    }
  }
}
```

---

## 13. Webhook-контроллер и обработка

Это **самая важная** часть для дальнейшей синхронизации. Точка шлёт **JWT-строку**, не JSON.

```typescript
// В BillingService:

async handleProviderWebhook(headers: Record<string, string>, body: unknown) {
  // 1. Проверка подписи через JWK (RS256). Без этого — отбрасываем.
  const valid = await this.provider.verifyWebhookSignature(headers, body);
  if (!valid) {
    this.logger.warn('Webhook signature invalid — ignoring');
    return { ok: false, reason: 'invalid_signature' };
  }

  // 2. Парсим JWT-payload.
  const event = this.provider.parseWebhook(headers, body);

  // 3. Дедуп по externalEventId.
  const duplicate = await this.prisma.billingEventLog.findFirst({
    where: { externalEventId: event.eventId, providerName: this.provider.providerName },
  });
  if (duplicate) {
    this.logger.log(`Duplicate webhook ${event.eventId} — skipping`);
    return { ok: true, duplicate: true };
  }

  // 4. Логируем событие.
  await this.events.logEvent({
    eventType: BillingEventType.PROVIDER_WEBHOOK,
    externalEventId: event.eventId,
    providerName: this.provider.providerName,
    payload: event.rawPayload,
  });

  // 5. Ищем invoice по providerInvoiceId.
  const invoice = await this.prisma.billingInvoice.findFirst({
    where: { providerInvoiceId: event.providerInvoiceId },
  });
  if (!invoice) {
    this.logger.warn(`No invoice for providerInvoiceId=${event.providerInvoiceId}`);
    return { ok: false, reason: 'no_invoice' };
  }

  // 6. Если status='APPROVED' — финализируем оплату.
  if (event.status === 'APPROVED') {
    await this.finalizePaidInvoice(invoice.id, {
      paymentSourceType: PaymentSourceType.EXTERNAL_PROVIDER,
      sourceType: SourceType.EXTERNAL_PAYMENT,
      sourceRef: event.providerInvoiceId,
      eventType: BillingEventType.EXTERNAL_PAYMENT_PAID,
      externalReference: event.providerInvoiceId,
    });
  }

  return { ok: true, invoiceId: invoice.id };
}

private async finalizePaidInvoice(invoiceId: string, params: {
  paymentSourceType: PaymentSourceType;
  sourceType: SourceType;
  sourceRef: string;
  eventType: BillingEventType;
  externalReference?: string;
}) {
  const invoice = await this.invoices.findOrFail(invoiceId);
  if (invoice.status === InvoiceStatus.PAID) return invoice;

  await this.prisma.$transaction(async (tx) => {
    // 1. Помечаем invoice как paid.
    await this.invoices.markPaid(invoice.id, {
      paymentSourceType: params.paymentSourceType,
      externalReference: params.externalReference,
    }, tx);

    // 2. Обновляем подписку: новый период, planCode из инвойса.
    if (invoice.subscriptionId && invoice.periodEnd && invoice.periodStart) {
      const cardRecurring = invoice.paymentMethod === BillingPaymentMethod.CARD_RECURRING;
      const cycleMonths = cardRecurring
        ? this.inferRenewalMonthsFromPaidPeriod(invoice.periodStart, invoice.periodEnd, 1)
        : undefined;
      await tx.subscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          planCode: invoice.planCode,
          status: 'active',
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: invoice.periodEnd,
          sourceType: params.sourceType,
          sourceRef: params.sourceRef,
          ...(cardRecurring && {
            recurringCycleAmountRub: invoice.amountRub,
            recurringCycleMonths: cycleMonths,
          }),
        },
      });
    }

    // 3. Записываем BillingOperation + BillingEventLog.
    await tx.billingOperation.create({ data: {
      companyId: invoice.companyId, subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id, operationType: OperationType.INVOICE_PAID,
      amountRub: invoice.amountRub, completedAt: new Date(),
    }});
    await this.events.logEvent({
      eventType: params.eventType,
      companyId: invoice.companyId, subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id, providerName: this.provider.providerName,
      payload: { externalReference: params.externalReference ?? null },
    });
  });

  // 4. Fire-and-forget: реф-комиссия + signup-бонус (не блокируют оплату).
  this.accrueReferralCommissionForInvoice(invoiceId).catch(err =>
    this.logger.warn(`Referral accrual failed: ${err.message}`));
  this.applySignupBonusForInvoice(invoiceId).catch(err =>
    this.logger.warn(`Signup bonus apply failed: ${err.message}`));
}
```

---

## 14. BillingModule — фабрика провайдера

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/index';
import { AuthModule } from '../auth/index';
import { BillingService } from './billing.service';
import { BillingPolicyService } from './billing-policy.service';
import { BillingPricingService } from './billing-pricing.service';
import { BillingInvoiceService } from './billing-invoice.service';
import { BillingSubscriptionService } from './billing-subscription.service';
import { BillingEventService } from './billing-event.service';
import { EntitlementService } from './entitlement.service';
import { CompanyBillingDetailsService } from './company-billing-details.service';
import { BILLING_PROVIDER } from './billing-provider.port';
import { ManualBillingProvider } from './providers/manual-billing.provider';
import { TochkaBillingProvider } from './providers/tochka-billing.provider';
import { BillingAdminController } from './billing-admin.controller';
import { BillingCabinetController } from './billing-cabinet.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingTochkaOAuthController } from './billing-tochka-oauth.controller';
import { TochkaOAuthService } from './tochka-oauth.service';
import { ReferralModule } from '../referral/referral.module';
import { SignupReferralModule } from '../signup-referral';

@Module({
  imports: [PrismaModule, AuthModule, ReferralModule, SignupReferralModule],
  controllers: [
    BillingAdminController,
    BillingCabinetController,
    BillingWebhookController,
    BillingTochkaOAuthController,
  ],
  providers: [
    BillingService,
    BillingPolicyService,
    BillingPricingService,
    BillingInvoiceService,
    BillingSubscriptionService,
    BillingEventService,
    EntitlementService,
    CompanyBillingDetailsService,
    TochkaOAuthService,
    ManualBillingProvider,
    TochkaBillingProvider,
    {
      provide: BILLING_PROVIDER,
      inject: [ConfigService, ManualBillingProvider, TochkaBillingProvider],
      useFactory: (config, manual, tochka) =>
        config.get<string>('BILLING_PROVIDER', 'manual') === 'tochka' ? tochka : manual,
    },
  ],
  exports: [
    BillingService, BillingSubscriptionService, BillingInvoiceService,
    BillingPolicyService, BillingPricingService, BillingEventService,
    EntitlementService, CompanyBillingDetailsService, BILLING_PROVIDER,
  ],
})
export class BillingModule {}
```

---

## 15. Реферальная программа: алгоритм комиссий

### Бизнес-правила

- **Источник истины** — только `BillingInvoice { status='paid', planCode IN PAID_PLANS }`.
- **Тариф комиссии** — фиксированная сумма за каждый оплаченный счёт:
  - До 10 платящих клиентов в месяце: **6 500 ₽** за счёт.
  - 10 и более: **10 000 ₽** за счёт.
- **Mock «admin gift»**: если админ выдаёт платный тариф через `change-plan` без `createInvoice`, партнёр **НЕ** получает комиссию. На фронте чекбокс `ackReferralNoComp` обязателен.

### Cron-расчёт за месяц

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

const REWARD_PER_PAID_INVOICE_STANDARD_RUB = 6500;
const REWARD_PER_PAID_INVOICE_GOLD_RUB = 10000;
const PAID_THRESHOLD_FOR_GOLD = 10;
const PAID_PLANS = ['pro', 'pro_plus', 'premium'];

@Injectable()
export class ReferralCommissionCronService {
  private readonly logger = new Logger(ReferralCommissionCronService.name);

  constructor(private readonly commission: ReferralCommissionService) {}

  /** 1-го числа каждого месяца в 01:00 Москва — расчёт за предыдущий месяц. */
  @Cron('0 1 1 * *', { timeZone: 'Europe/Moscow' })
  async handleMonthlyCommission(): Promise<void> {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await this.commission.calculateForPeriod(prev.getFullYear(), prev.getMonth() + 1);
  }
}

@Injectable()
export class ReferralCommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateForPeriod(periodYear: number, periodMonth: number) {
    const periodStart = new Date(periodYear, periodMonth - 1, 1);
    const periodEnd = new Date(periodYear, periodMonth, 0, 23, 59, 59, 999);

    // 1. Все оплаченные счета за период.
    const paidInvoices = await this.prisma.billingInvoice.findMany({
      where: {
        status: 'paid',
        planCode: { in: PAID_PLANS },
        paidAt: { gte: periodStart, lte: periodEnd },
      },
      select: { id: true, companyId: true, amountRub: true },
    });
    if (paidInvoices.length === 0) return [];

    // 2. Атрибуции (партнёр компании).
    const companyIds = [...new Set(paidInvoices.map(i => i.companyId))];
    const attributions = await this.prisma.referralAttribution.findMany({
      where: { companyId: { in: companyIds } },
      select: { companyId: true, partnerId: true },
    });

    // 3. Группировка инвойсов по партнёру.
    const byPartner = new Map<string, { companyId: string; invoiceId: string; amountRub: number }[]>();
    for (const inv of paidInvoices) {
      const attr = attributions.find(a => a.companyId === inv.companyId);
      if (!attr) continue;
      const list = byPartner.get(attr.partnerId) ?? [];
      list.push({ companyId: inv.companyId, invoiceId: inv.id, amountRub: inv.amountRub });
      byPartner.set(attr.partnerId, list);
    }

    // 4. Считаем сумму комиссии для каждого партнёра.
    const results = [];
    for (const [partnerId, items] of byPartner) {
      const paidCount = new Set(items.map(i => i.companyId)).size;
      const rewardPerInvoice = paidCount >= PAID_THRESHOLD_FOR_GOLD
        ? REWARD_PER_PAID_INVOICE_GOLD_RUB
        : REWARD_PER_PAID_INVOICE_STANDARD_RUB;

      let amountRub = 0;
      const commissionItems = items.map(item => {
        amountRub += rewardPerInvoice;
        return { ...item, commissionRub: rewardPerInvoice };
      });

      // 5. Upsert PartnerCommission + replace items.
      await this.prisma.$transaction(async tx => {
        const existing = await tx.partnerCommission.findUnique({
          where: { partnerId_periodYear_periodMonth: { partnerId, periodYear, periodMonth } },
        });
        if (existing) {
          await tx.partnerCommissionItem.deleteMany({ where: { commissionId: existing.id } });
        }
        const commission = await tx.partnerCommission.upsert({
          where: { partnerId_periodYear_periodMonth: { partnerId, periodYear, periodMonth } },
          create: { partnerId, periodYear, periodMonth, amountRub, rate: 0.10, status: 'calculated' },
          update: { amountRub, status: 'calculated' },
        });
        for (const item of commissionItems) {
          await tx.partnerCommissionItem.create({
            data: {
              commissionId: commission.id,
              companyId: item.companyId,
              invoiceId: item.invoiceId,
              invoiceAmountRub: item.amountRub,
              commissionAmountRub: item.commissionRub,
            },
          });
        }
      });

      results.push({ partnerId, periodYear, periodMonth, paidCount, amountRub });
    }
    return results;
  }
}
```

### Instant accrue при оплате инвойса

Дополнительно, при каждой оплате `finalizePaidInvoice` вызывает:

```typescript
private async accrueReferralCommissionForInvoice(invoiceId: string) {
  const invoice = await this.prisma.billingInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, companyId: true, planCode: true, status: true, paidAt: true, amountRub: true },
  });
  if (!invoice || invoice.status !== 'paid' || !invoice.paidAt) return;
  if (!PAID_PLANS.includes(invoice.planCode)) return;

  const attribution = await this.prisma.referralAttribution.findUnique({
    where: { companyId: invoice.companyId },
  });
  if (!attribution) return;

  // Делегируем в ReferralCommissionService — пересчитываем за месяц одного партнёра.
  const periodYear = invoice.paidAt.getFullYear();
  const periodMonth = invoice.paidAt.getMonth() + 1;
  await this.referralCommission.calculateForPeriod(periodYear, periodMonth);
}
```

---

## 16. Реф-эндпоинты

```typescript
@Controller('referral')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('my')
  async getMyPartner(@Req() req) {
    return this.referralService.getMyPartner(req.user.userId, req.user.companyId);
  }

  @Post('links')
  async createLink(@Req() req, @Body() dto: CreateReferralLinkDto) {
    const partnerId = await this.referralService.resolvePartnerId(req.user.userId, req.user.companyId);
    return this.referralService.createLink(partnerId, dto.title ?? 'Ссылка', {
      linkType: dto.linkType, offerId: dto.offerId,
    });
  }

  @Delete('links/:linkId')
  async deleteLink(@Req() req, @Param('linkId') linkId) {
    const partnerId = await this.referralService.getPartnerIdOrNull(req.user.userId, req.user.companyId);
    if (!partnerId) throw new NotFoundException('Партнёр не найден');
    return this.referralService.deleteLink(partnerId, linkId);   // soft-delete: isActive=false
  }

  @Get('available-offers')
  async getAvailableOffers(@Req() req) {
    if (!req.user.companyId) return [];
    return this.referralService.getAvailableOffers(req.user.companyId);
  }

  @Get('links/:linkId/stats')
  async getLinkStats(@Req() req, @Param('linkId') linkId) {
    const partnerId = await this.referralService.getPartnerIdOrNull(req.user.userId, req.user.companyId);
    if (!partnerId) throw new NotFoundException('Партнёр не найден');
    const stats = await this.referralService.getLinkStats(partnerId, linkId);
    if (!stats) throw new NotFoundException('Ссылка не найдена');
    return stats;
  }

  @Get('referrals')
  async getReferrals(@Req() req) {
    const partnerId = await this.referralService.getPartnerIdOrNull(req.user.userId, req.user.companyId);
    if (!partnerId) return [];
    return this.referralService.getReferrals(partnerId);
  }

  @Get('payouts')
  async getPayouts(@Req() req) {
    const partnerId = await this.referralService.getPartnerIdOrNull(req.user.userId, req.user.companyId);
    if (!partnerId) return [];
    return this.referralService.getPayouts(partnerId);
  }

  @Get('payout-requests')
  async getPayoutRequests(@Req() req) {
    const partnerId = await this.referralService.getPartnerIdOrNull(req.user.userId, req.user.companyId);
    if (!partnerId) return [];
    return this.referralService.getPayoutRequests(partnerId);
  }

  @Post('withdraw')
  async createWithdrawRequest(@Req() req, @Body() dto: CreateWithdrawRequestDto) {
    const partnerId = await this.referralService.resolvePartnerId(req.user.userId, req.user.companyId);
    return this.referralService.createWithdrawRequest(partnerId, dto.amountRub);
  }

  @Post('pay-subscription')
  async paySubscriptionFromBalance(@Req() req, @Body() dto: PaySubscriptionFromBalanceDto) {
    const partnerId = await this.referralService.resolvePartnerId(req.user.userId, req.user.companyId);
    return this.referralService.paySubscriptionFromBalance(
      partnerId, req.user.companyId, dto.planCode, dto.months ?? 1,
    );
  }
}
```

---

## 17. Signup-бонусы (welcome-коды)

Поток: админ создаёт код → юзер регистрируется по `?ref=<code>` → запись `pending` → юзер платит → бонус применяется.

### Public-резолв (для страницы регистрации)

```typescript
@Controller('public/signup-referrals')
export class SignupReferralPublicController {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60 * 1000;

  constructor(private readonly service: SignupReferralService) {}

  @Get('resolve/:code')
  async resolve(@Param('code') code, @Req() req) {
    const ip = req.ip ?? 'unknown';
    this.checkRateLimit(typeof ip === 'string' ? ip : 'unknown');
    const resolved = await this.service.resolveCodePublic(code);
    if (!resolved) throw new NotFoundException('Код не найден или больше не действует');
    return resolved;
  }

  private checkRateLimit(ip: string): void {
    const now = Date.now();
    const bucket = this.hits.get(ip);
    if (!bucket || now > bucket.resetAt) {
      this.hits.set(ip, { count: 1, resetAt: now + this.WINDOW_MS });
      return;
    }
    bucket.count += 1;
    if (bucket.count > this.LIMIT) {
      throw new HttpException('Слишком много запросов', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
```

### Cabinet-статус

```typescript
@Controller('cabinet/signup-bonus')
@UseGuards(JwtAuthGuard)
export class SignupReferralCabinetController {
  constructor(
    private readonly service: SignupReferralService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async getStatus(@Req() req) {
    const company = await this.prisma.company.findFirst({
      where: { ownerUserId: req.user.userId }, select: { id: true },
    });
    if (!company) throw new NotFoundException('Компания не найдена');
    return this.service.getStatusForCompany(company.id);
    // Возвращает { status: 'pending' | 'applied' | 'none', ... }
  }
}
```

### Admin CRUD

```typescript
@Controller('admin/signup-bonuses')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SignupBonusesAdminController {
  constructor(private readonly service: SignupReferralService) {}

  @Get()
  async list(@Query('status') status, @Query('search') search, @Query('limit') limit, @Query('offset') offset) {
    return this.service.listCodesForAdmin({
      status: status === 'archived' || status === 'all' ? status : 'active',
      search, limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async getDetail(@Param('id') id) { return this.service.getCodeDetailForAdmin(id); }

  @Post()
  async create(@Body() dto: CreateSignupBonusDto, @Req() req) {
    return this.service.createCode({
      title: dto.title, description: dto.description ?? null,
      rewardType: dto.rewardType, rewardValue: dto.rewardValue,
      rewardDurationMonths: dto.rewardDurationMonths ?? null,
      planCode: dto.planCode ?? null, maxRedemptions: dto.maxRedemptions ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      ownerUserId: req.user.userId,
    });
  }

  @Patch(':id') async update(@Param('id') id, @Body() dto) { return this.service.updateCode(id, dto); }
  @Post(':id/archive') async archive(@Param('id') id) { return this.service.archiveCode(id); }

  @Post('redemptions/:id/revert')
  async revertRedemption(@Param('id') id, @Body() dto: RevertRedemptionDto, @Req() req) {
    return this.service.revertRedemption(id, dto.reason, req.user.userId);
  }
}
```

### Применение бонуса при оплате

Вызывается из `finalizePaidInvoice`:

```typescript
private async applySignupBonusForInvoice(invoiceId: string) {
  const invoice = await this.prisma.billingInvoice.findUnique({
    where: { id: invoiceId },
    select: { companyId: true, subscriptionId: true, status: true, paidAt: true },
  });
  if (!invoice || invoice.status !== 'paid' || !invoice.paidAt) return;
  if (!invoice.subscriptionId) return;

  const pending = await this.signupReferral.findPendingForCompany(invoice.companyId);
  if (!pending) return;

  await this.signupReferral.applyRedemption({
    redemptionId: pending.id,
    subscriptionId: invoice.subscriptionId,
    invoiceId,
  });
  // Внутри applyRedemption:
  //   - для rewardType='free_months': Subscription.currentPeriodEnd += rewardValue месяцев
  //   - для rewardType='percent_off': Subscription.signupDiscountPercent + Until
  //   - ставит status='applied', appliedAt=now()
}
```

---

## 18. Cron-задачи

```typescript
// 1. Реф-комиссии 1-го числа в 01:00 МСК
@Cron('0 1 1 * *', { timeZone: 'Europe/Moscow' })
async handleMonthlyCommission() { /* calculateForPeriod(prevMonth) */ }

// 2. Истечение pending signup-бонусов — ежедневно в 03:00 UTC
@Cron('0 3 * * *', { timeZone: 'UTC' })
async expirePending() {
  // UPDATE signup_referral_redemptions SET status='expired_unactivated'
  //   WHERE status='pending' AND expiresAt < NOW()
}

// 3. Автопродление подписок — обычно ежечасно или ежедневно
// Перебирает Subscription { renewalMode='card_recurring', currentPeriodEnd < NOW() + 3 days, autoRenew=true }
// Для каждой: provider.chargeRecurringSubscription({ providerSubscriptionId, amountRub: recurringCycleAmountRub })

// 4. Напоминания о продлении — ежедневно
// Шлёт письмо за 7/3/1 день до конца периода, использует SubscriptionReminderSent для дедупа

// 5. Sync статусов «висящих» инвойсов с провайдером — раз в N минут
// Для invoice.status='open' AND provider=tochka — GET /acquiring/payments/{id} или /invoice/bills/.../payment-status
```

---

## 19. Ключевые сценарии

### Сценарий 1: Оплата картой с автопродлением

```
[Кабинет UI]
  POST /billing/subscription/pay/card { planCode: "pro", months: 12, autoRenew: true }
      ↓
[BillingService.createCardSubscriptionPayment]
  ✓ FEATURE_BILLING_TOCHKA + FEATURE_BILLING_CARD_RENEWAL
  ✓ Plan не free
  ✓ ensureCompanySubscription
  ✓ computePrepayAmountRub (учёт prepay-скидки + signup-бонуса)
  ✓ createInvoice (status=draft) → openInvoice (status=open)
      ↓
[TochkaBillingProvider.createRecurringSubscription]
  POST https://enter.tochka.com/uapi/acquiring/v1.0/subscriptions
    Body: { Data: { customerCode, amount, purpose, recurring: true, saveCard: true,
            redirectUrl: "https://api.example.com/api/billing/payment-return/success",
            failRedirectUrl: "https://api.example.com/api/billing/payment-return/fail",
            paymentLinkId: <наш invoice.id> } }
    Headers: { Authorization: Bearer <OAuth token из БД>, Content-Type: application/json }
      ↓
[Tochka возвращает]
  { Data: { subscriptionId: "xxx", paymentLink: "https://.../pay", consumerId: "yyy", status: "CREATED" }}
      ↓
[BillingInvoice update]
  providerSubscriptionId="xxx", providerInvoiceId=null (operationId придёт в webhook),
  paymentUrl="https://.../pay"
      ↓
[Subscription update]
  renewalMode="card_recurring", providerSubscriptionId="xxx", providerConsumerId="yyy"
      ↓
[Кабинет UI]
  redirect → paymentUrl (страница Точки)
      ↓
[Пользователь платит]
      ↓
[Точка → POST /internal/billing/provider-events]
  Body: <JWT-строка>, верифицируется через JWK (RS256)
      ↓
[BillingService.handleProviderWebhook]
  ✓ verifyWebhookSignature
  ✓ parseWebhook → eventId, providerInvoiceId, status='APPROVED'
  ✓ Дедуп по externalEventId
  ✓ logEvent
  ✓ Найти invoice по providerInvoiceId или paymentLinkId
      ↓
[finalizePaidInvoice]
  Транзакция:
    UPDATE invoice SET status='paid', paidAt=NOW()
    UPDATE subscription SET planCode, status='active', period dates, recurringCycleAmountRub, recurringCycleMonths
    INSERT INTO billing_operations (invoice_paid)
    INSERT INTO billing_event_log (external_payment.paid)
  Fire-and-forget:
    accrueReferralCommissionForInvoice  → создаёт/обновляет PartnerCommission
    applySignupBonusForInvoice           → продлевает Subscription, если есть pending Redemption
```

### Сценарий 2: Безналичная оплата (выставление счёта)

```
[Кабинет UI]
  POST /billing/subscription/pay/bank-invoice { planCode: "pro", months: 12, sendToEmail: true }
      ↓
[BillingService.createBankInvoicePayment]
  ✓ FEATURE_BILLING_BANK_INVOICE
  ✓ assertReadyForBankInvoice (CompanyBillingDetails заполнены)
  ✓ Создаёт invoice
      ↓
[TochkaBillingProvider.createBankInvoice]
  POST /invoice/v1.0/bills
    Body: { Data: { accountId: TOCHKA_ACCOUNT_ID, customerCode: TOCHKA_CUSTOMER_CODE,
            SecondSide: { taxCode: <ИНН плательщика>, type: 'company'|'ip',
                          secondSideName, legalAddress, kpp },
            Content: { Invoice: { number, date, totalAmount, totalNds: 0,
                                 paymentExpiryDate, Positions: [...] }}}}
      ↓
[Tochka возвращает]
  { Data: { documentId: "xxx" }}
      ↓
[Если sendToEmail=true]
  POST /invoice/v1.0/bills/{customerCode}/{documentId}/email
    Body: { Data: { email: <CompanyBillingDetails.contactEmail> }}
      ↓
[Кабинет UI]
  показывает «Счёт выставлен, отправлен на email, можно скачать PDF»
      ↓
[Скачивание PDF]
  GET /billing/invoices/{invoiceId}/file
    → TochkaBillingProvider.getBankInvoiceFile
    → GET /invoice/v1.0/bills/{customerCode}/{documentId}/file (application/pdf)
      ↓
[Юзер платит в банке]
[Точка → webhook о payment_paid]
[finalizePaidInvoice]
```

### Сценарий 3: Lookup реквизитов по ИНН

```
[Кабинет UI]
  POST /billing/company-billing-details/lookup-by-inn { inn: "7707083893" }
      ↓
[CompanyBillingDetailsService.lookupByInn]
  1. Tochka: GET /open-banking/v1.0/customers
             для каждого: GET /open-banking/v1.0/customers/{code}
             сравнить info.inn === query.inn
             если матч → { source: 'tochka', legalName, inn, kpp, ogrn, legalAddress, bankBik, bankAccount }
  2. Если не нашли — DaData:
     POST https://suggestions.dadata.ru/.../findById/party
       Body: { query: "7707083893", branch_type: "MAIN" }
       Headers: { Authorization: "Token <DADATA_API_KEY>" }
     → { source: 'external', legalName, inn, kpp, ogrn, legalAddress } (без bankBik/bankAccount)
  3. Если оба молчат — 404
```

### Сценарий 4: OAuth-флоу Точки (production, первый раз)

```
[Бэк стартует с TOCHKA_MODE=production]
[BillingService.onModuleInit]
  → TochkaOAuthService.ensureOAuthReady
    1. Проверяет PipelineConfig['billing_tochka_production_oauth_tokens'] — нет.
    2. createAuthorizationUrl:
       a) POST https://enter.tochka.com/connect/token
          Body: client_id, client_secret, grant_type=client_credentials, scope
          → service_token
       b) POST https://enter.tochka.com/uapi/v1.0/consents
          Headers: Bearer <service_token>
          Body: { Data: { permissions: [...] }}
          → consentId
       c) state = uuid()
          PipelineConfig.upsert(billing_tochka_production_oauth_state, { state, consentId, redirectUri, scopes })
       d) authorizeUrl = https://enter.tochka.com/connect/authorize?client_id=...&state=...&consent_id=...
    3. Логирует authorizeUrl в консоль.
[Программист открывает authorizeUrl в браузере, логинится, разрешает]
      ↓
[Точка → GET /internal/billing/tochka/oauth/callback?code=...&state=...]
[TochkaOAuthService.handleOAuthCallback]
  1. Сверить state с сохранённым (TTL 15 мин).
  2. POST https://enter.tochka.com/connect/token
     Body: client_id, client_secret, grant_type=authorization_code, code, redirect_uri
     → { access_token, refresh_token, expires_in }
  3. PipelineConfig.upsert(billing_tochka_production_oauth_tokens, { accessToken, refreshToken, expiresAt })
[Бэк показывает HTML: «OAuth подключен»]
      ↓
[При следующем вызове Tochka API]
[TochkaOAuthService.getAccessToken]
  - access_token валиден → возвращает
  - истёк (за 5 мин до) → POST .../token с grant_type=refresh_token → новый access_token
  - refresh не сработал → null → провайдер падает с «Tochka bearer token is not configured»
```

### Сценарий 5: Реф-привлечение → первая оплата

```
[Партнёр генерирует ссылку]
  POST /referral/links { title: "Telegram-канал", linkType: "regular" }
  → PartnerLink { code: "ab12cd34", isActive: true }
  Ссылка: https://app.example.com/?ref=ab12cd34
      ↓
[Юзер кликает]
  При регистрации компании в Register.service:
    - находит PartnerLink по ref-коду (isActive=true)
    - создаёт Company.refLinkType='partner', refLinkId=PartnerLink.id
    - создаёт ReferralAttribution { companyId, partnerId, partnerLinkId, attributionType: 'first_touch' }
[Юзер оплачивает Pro тариф]
  → webhook → finalizePaidInvoice → accrueReferralCommissionForInvoice
[ReferralCommissionService.calculateForPeriod] (вызывается instant + cron 1-го числа)
  1. Все paid invoices компаний с ReferralAttribution для партнёра.
  2. paidCount = unique companyIds.
  3. reward = 6500 ₽ (если paidCount < 10) или 10000 ₽ (если ≥10).
  4. Upsert PartnerCommission + переписать items.
[Партнёр видит]
  GET /referral/my → balance += commission.amountRub
      ↓
[Партнёр заявляет вывод]
  POST /referral/withdraw { amountRub: 6500 }
  → PayoutRequest { status: 'pending' }
[Админ обрабатывает руками, переводит на карту, ставит status='paid']
```

### Сценарий 6: Signup-бонус с отложенной активацией

```
[Админ создаёт код]
  POST /admin/signup-bonuses
    { title: "Welcome 1 mes free", rewardType: "free_months", rewardValue: 1,
      planCode: null, maxRedemptions: 100, expiresAt: "2026-12-31" }
  → SignupReferralCode { code: "x7Hgk2Q9" }
  URL: https://app.example.com/?signup_ref=x7Hgk2Q9
      ↓
[Юзер открывает]
  Фронт: GET /public/signup-referrals/resolve/x7Hgk2Q9 (rate-limit 10/min/IP)
  → { ok: true, title, rewardType, rewardValue, expiresAt }
  Баннер: «Зарегистрируйтесь и получите 1 месяц Pro бесплатно»
      ↓
[Юзер регистрируется]
  RegisterService:
    - антифрод (SignupReferralFraudService): email-hash, IP-hash, fingerprint-hash → проверка уникальности
    - создаёт SignupReferralRedemption { codeId, refereeUserId, refereeCompanyId,
                                          status: 'pending', expiresAt: +90 дней }
    - SignupReferralCode.redeemedCount += 1
      ↓
[Юзер оплачивает Pro]
  → webhook → finalizePaidInvoice → applySignupBonusForInvoice
[SignupReferralService.applyRedemption]
  Для rewardType='free_months':
    Subscription.currentPeriodEnd += rewardValue месяцев
  Для rewardType='percent_off':
    Subscription.signupDiscountPercent = rewardValue
    Subscription.signupDiscountUntil = now + rewardDurationMonths
  status='applied', appliedAt=now()
[Cabinet UI]
  GET /cabinet/signup-bonus/status → { status: 'applied', ... }
  Toast: «Бонус применён, +1 мес»
      ↓
[Если 90 дней не оплатил]
[SignupReferralCron — @Cron('0 3 * * *') UTC]
  expirePendingRedemptions:
    UPDATE signup_referral_redemptions SET status='expired_unactivated'
      WHERE status='pending' AND expiresAt < NOW()
```

---

## 20. Грабли и нюансы

1. **Tochka sandbox bearer token** — статичный, прописан в коде (`'sandbox.jwt.token'`), не из env. В sandbox-режиме OAuth не нужен.

2. **JWT-claim `customer_code`** в production-токене может отличаться от `TOCHKA_CUSTOMER_CODE` env — это нормально при нескольких consent'ах. Сервис показывает warning, но не падает.

3. **Webhook body — JWT-строка, не JSON!** Тело приходит как plain text. В Nest по умолчанию `body-parser` парсит как JSON — нужно либо разрешить `application/octet-stream`/`text/plain`, либо использовать `@RawBody()`. В коде сервиса достаточно `body: unknown` — Nest принимает.

4. **`paymentLinkId`** в Точка API — это **наш** `BillingInvoice.id`. Используется, чтобы привязать webhook к нашему инвойсу.

5. **HTTP 424 от Точки** означает «ресурс не существует» (вместе с 404, 410). Обрабатывается как `BillingProviderResourceNotFoundError`, не как ошибка сервера.

6. **OAuth state TTL — 15 минут**. Если юзер открыл authorizeUrl и тянет 20 минут — `handleOAuthCallback` вернёт 400.

7. **Refresh token обновляется автоматически** за 5 минут до `expires_at` (`TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000`).

8. **DaData возвращает `type: 'INDIVIDUAL' | 'LEGAL'`** — маппится на `payerType: 'individual_entrepreneur' | 'legal_entity'`. Точка определяет тип по наличию KPP: если есть — `company`, нет — `ip`.

9. **Реф-комиссии считаются ТОЛЬКО с paid invoice**. Admin gift через `change-plan` без `createInvoice` → партнёр не получает комиссию. Защита: `ackReferralNoComp` в DTO.

10. **Идемпотентность webhook** — по `externalEventId = eventType:operationId:status`. Дубликаты от Точки игнорируются.

11. **Транзакционность finalizePaidInvoice**: оплата + обновление подписки + биллинг-операция — одна `prisma.$transaction`. Реф-комиссия и signup-бонус идут fire-and-forget после — если упадут, оплата всё равно зафиксирована.

12. **Optimistic lock на `CompanyBillingDetails`** через `version: { increment: 1 }` — клиент должен передавать текущую `version`, иначе 409 ConflictException.

13. **InvoiceNumber** в Точке `bills.number` ограничен 32 символами — используем `billingNumber` или `id.slice(0, 32)`.

14. **Recurring=true ≠ Options** в Точка API — при создании рекуррента нельзя одновременно передавать оба, иначе 400. См. проверку в `createRecurringSubscription`.

15. **TOCHKA_WEBHOOK_AUTO_REGISTER=true** делает PUT `/webhook/<clientId>` при старте бэка через 1.5 сек после `onHttpServerReady` (чтобы успел подняться listener). Сначала GET — если конфигурация совпадает, не перерегистрирует.

16. **Sandbox lookupCompanyByInn возвращает null** — в sandbox не настроены клиенты в OpenBanking. Поэтому в sandbox реквизиты берутся только через DaData (если есть ключ).

17. **Курс recurring-чарджа суммы** — `amount` в Точке передаётся в **рублях** как число (`Number(amount)`), не в копейках. Не путать с другими провайдерами.

18. **Сроки бонуса**: `free_months` — продление подписки сразу; `percent_off` — скидка применяется на следующих инвойсах через `BillingPricingService.getActiveSignupDiscountPercent`.

19. **Rate-limit `/public/signup-referrals/resolve/:code`** — 10 req/min/IP, in-memory Map. На multi-instance проде даст N × 10. Для жёсткого RL — `@nestjs/throttler` с Redis-backend.

20. **При смене env `TOCHKA_CUSTOMER_CODE`** — webhook'и могут перестать работать (consent привязан к старому customer'у). Перезапустить OAuth.

---

## 21. Чек-лист переноса

### Минимальный набор для копирования

- [ ] **Prisma-модели** (раздел 3): `Plan`, `PlanPrepayDiscount`, `Subscription`, `BillingInvoice`, `BillingOperation`, `BillingEventLog`, `UsageCounter`, `CompanyBillingDetails`, `PipelineConfig`. Реф: `Partner`, `PartnerLink`, `ReferralAttribution`, `PartnerMonthlyStat`, `PartnerCommission`, `PartnerCommissionItem`, `PayoutRequest`, `ReferralBalanceLedger`. Signup: `SignupReferralCode`, `SignupReferralRedemption`.

- [ ] **Enum-константы** (раздел 4) — целиком в `billing.types.ts`.

- [ ] **Билинг-сервисы**: `BillingService` (главный), `BillingPricingService`, `BillingPolicyService`, `BillingInvoiceService`, `BillingSubscriptionService`, `BillingEventService`, `CompanyBillingDetailsService`, `EntitlementService`.

- [ ] **Провайдер**: `BillingProviderPort` интерфейс + `TochkaBillingProvider` + `TochkaOAuthService` + `ManualBillingProvider` (заглушка).

- [ ] **Контроллеры**: 4 шт (Cabinet, Admin, Webhook, OAuth-callback).

- [ ] **Module-фабрика** — выбор провайдера через `BILLING_PROVIDER` env.

- [ ] **Cron-задачи**: `ReferralCommissionCronService` (`0 1 1 * *` MSK), `SignupReferralCron` (`0 3 * * *` UTC), автопродление подписок.

- [ ] **DTO** (раздел 11) — все с class-validator.

- [ ] **ENV** (раздел 2) — настроить в `.env` целевого проекта.

### Настройка инфраструктуры

- [ ] Подключить `@nestjs/schedule` для cron.
- [ ] Установить `jose` (для верификации JWT-webhook): `bun add jose`.
- [ ] Установить `class-validator class-transformer`.
- [ ] Включить `ValidationPipe({ transform: true, whitelist: true })` глобально.
- [ ] Webhook-эндпоинт **не должен** требовать JWT-авторизации (поставить guard так, чтобы исключал `/internal/billing/*`).
- [ ] OAuth-callback тоже public.
- [ ] Подключить body-parser, не отвергающий plain-text для webhook'а.

### Регистрация в Точке

- [ ] В кабинете Точки зарегистрировать приложение, получить `client_id` + `client_secret`.
- [ ] Указать `redirect_uri` — он **точно** должен совпадать с `TOCHKA_REDIRECT_URI` (включая схему, хост, путь).
- [ ] При первом старте в `TOCHKA_MODE=production` — открыть в браузере authorizeUrl из логов, авторизоваться.
- [ ] Включить `TOCHKA_WEBHOOK_AUTO_REGISTER=true` — бэк сам зарегистрирует webhook URL в Точке.

### DaData

- [ ] Зарегистрироваться на dadata.ru, получить API key.
- [ ] `DADATA_API_KEY=<token>` в env. Если ключа нет — lookup работает только через Точка OpenBanking (или возвращает 404).

### Feature flags для постепенного включения

```bash
FEATURE_BILLING_TOCHKA=false              # off — пока тестируем
FEATURE_BILLING_CARD_RENEWAL=false        # off — пока не настроен рекуррент
FEATURE_BILLING_BANK_INVOICE=false        # off — пока не нужен безнал

# После настройки sandbox:
FEATURE_BILLING_TOCHKA=true               # включаем интеграцию

# После успешного теста:
FEATURE_BILLING_CARD_RENEWAL=true
FEATURE_BILLING_BANK_INVOICE=true
```

### Что НЕ переносить (Crossmark-специфичное)

- Tier2 override (`PartnerTier2Override`, модуль `tier2`) — продвинутая фича сверху. База работает без него.
- `PartnerCandidate`, `InteractionLog`, `PartnerLifecycleHistory` — CRM-надстройка.
- `PartnerLinkClick` (click-tracking сырых событий) — нужен для аналитики ссылок, но не для базы реф-программы.
- `Promotion`, `PlanOffer` — отдельные тарифные офферы (не путать с PRM-офферами в другой подсистеме).
- Admin section guards (`@AdminSection`) — нужны только если у вас своя система ролей с секциями.
- Audit-скрипты (`audit:comped-referrals` и т.п.).

### Минимальная проверка после переноса

1. **Sandbox**: `TOCHKA_MODE=sandbox`, без OAuth. Создать `Plan(code='pro', priceRub=1000)`.
2. **Cabinet test**: создать юзера + компанию, POST `/billing/subscription/pay/card` → должен вернуть `paymentUrl`.
3. **Webhook test**: руками сэмулировать webhook через `curl -X POST /internal/billing/provider-events` с тестовым JWT (или подменить verifyWebhookSignature на `return true` в тесте).
4. **DaData test**: POST `/billing/company-billing-details/lookup-by-inn { inn: "7707083893" }` (это Сбер) — должен вернуть данные.
5. **Реф test**: создать Partner вручную, ReferralAttribution на тестовую компанию, оплатить инвойс этой компании → проверить `PartnerCommission` в БД.

---

**Готово.** Документ покрывает 90% переноса. Что не вошло детально — методы расчёта баланса (`referral-balance.util.ts`), частные методы `BillingService` (вроде `payFromReferralBalance`, `getSubscriptionQuote`, `getRetailers`) — они дополняют, но не критичны. Главное — порт `BillingProviderPort`, провайдер Tochka, OAuth, webhook-обработка, lookup через DaData, реф-комиссии, signup-бонусы — есть всё.

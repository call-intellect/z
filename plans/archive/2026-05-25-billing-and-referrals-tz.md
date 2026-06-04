---
type: tz
status: draft
feature: Биллинг (единый тариф tier_standard, per-seat доплата, годовая со скидкой 20%, ручное управление подпиской), реферальная программа (фикс 20 000 ₽ с платежа, окно атрибуции 3 мес), накопительный баланс встреч, упрощение entitlements
date: 2026-05-25
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-05-25-billing-and-referrals.md
  - plans/tz/2026-05-25-demo-mode-tz.md
  - plans/tz/2026-05-25-inn-lookup-tz.md
  - second-brain/01_projects/tariffs-and-entitlements.md
  - backend/src/modules/entitlements/tier-config.ts
  - backend/src/modules/entitlements/entitlement.service.ts
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Реализовано практически целиком и подтверждено кодом: все 8 Prisma-моделей + 6 enum, три модуля (billing/referrals/meetings-balance) зарегистрированы в AppModule, FSM подписки, формулы seat, генерация PDF-счетов, атомарн
> ⚠️ Хвосты (см. реестр приоритетов): Email-уведомление рефералу в кроне выплат — допускался TODO-комментарий если MailService отсутствует (фаза 4.5)
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Биллинг, реферальная программа, накопительный баланс встреч

> Источник правды по продуктовым решениям: [`plans/analysis/2026-05-25-billing-and-referrals.md`](../analysis/2026-05-25-billing-and-referrals.md). Все цены, формулы и FSM (Finite State Machine — конечный автомат) подписки взяты оттуда без изменений.

## Цель

После реализации в Z работает полный платный путь клиента: единая подписка `tier_standard` (60 000 ₽/мес + 1 000 ₽/доп. место, годовая со скидкой 20%) с FSM подписки, накопительным балансом встреч, оффлайн-оплатой по счёту, ручным включением подписки super-админом (в двух режимах — paid/bonus) и работающей реферальной программой (фикс 20 000 ₽ за каждый месячный платёж клиента, окно атрибуции 3 месяца, выплата 10-го числа).

## Scope

**Входит:**
- Новый модуль `backend/src/modules/billing/` — Subscription, FSM, биллинг-цикл, генерация счетов (PDF), SeatService, ManualBillingService для админских действий (две опции: paid / bonus + audit).
- Новый модуль `backend/src/modules/referrals/` — Referral, ReferralAttribution (cookie + сервер, TTL 90 дней), ClientReferralLink (first-touch attribution), ReferralPayout (cron 10-го числа).
- Новый модуль `backend/src/modules/meetings-balance/` — накопительный счётчик встреч без потолка.
- Упрощение `backend/src/modules/entitlements/tier-config.ts` — схлопывание трёх тарифов (`tier_basic`, `tier_pro`, `tier_enterprise`) в один `tier_standard`. Patch-скрипт миграции значений `tier` в `OrgEntitlement`.
- Новые Prisma-модели: `Subscription`, `SubscriptionEvent`, `Invoice`, `MeetingsBalance`, `Referral`, `ReferralAttribution`, `ClientReferralLink`, `ReferralPayout`. Поля `Org`: `inn`, `ogrn`, `kpp`, `directorName`, `legalAddress`.
- Frontend клиентский: переделать `/settings/billing` (текущая подписка, баланс встреч, кнопка «Выставить счёт» → PDF), новая `/referrals` (создание ссылки + QR + статистика + баланс выплат).
- Frontend админский: переделать `/admin/orgs/[id]/billing` (ручное включение подписки с выбором paid/bonus + reason), новая `/admin/referrals` (список рефералов, начисления, ручные корректировки), новая `/admin/billing-overview` (MVP-дашборд: MRR (Monthly Recurring Revenue — ежемесячная подписная выручка), ARR (Annual Recurring Revenue — годовая повторяющаяся выручка), число активных / бонусных / демо-подписок, ARPU (Average Revenue Per User — средняя выручка на клиента), churn, реф-выплаты).
- Landing-интеграция: cookie `z_ref` + beacon на `POST /api/v1/public/referral/attribution` (публичный эндпоинт без авторизации).

**Не входит (отдельные ТЗ):**
- Содержимое демо-кабинета, фикстуры, генератор seed'а, бейдж «Режим демокабинета» в UI shell, disabled-кнопки real-операций при `Subscription.status='DEMO'` — это **ТЗ #2** [`plans/tz/2026-05-25-demo-mode-tz.md`](2026-05-25-demo-mode-tz.md). В этом ТЗ используется только статус `DEMO` в FSM подписки и факт его установки при регистрации Org.
- Интеграция с API (Application Programming Interface — программный интерфейс) по ИНН (Dadata / Контур.Фокус) — это **ТЗ #3** [`plans/tz/2026-05-25-inn-lookup-tz.md`](2026-05-25-inn-lookup-tz.md). В этом ТЗ только добавляем поля `inn/ogrn/kpp/directorName/legalAddress` в `Org` и потребляем контракт `InnLookupService.lookupByInn(inn)` без реализации.
- Платёжный провайдер (ЮKassa / CloudPayments) — отдельное ТЗ позже (**ТЗ #4** `plans/tz/2026-XX-XX-payment-provider-tz.md`). В этом ТЗ — только оффлайн-оплата по счёту (PDF) и ручное включение подписки super-админом.

## Принятые решения владельца (2026-05-25)

Источник всех решений — анализ [`plans/analysis/2026-05-25-billing-and-referrals.md`](../analysis/2026-05-25-billing-and-referrals.md). Здесь — выжимка для быстрого ориентирования.

| # | Решение | Детали |
|---|---|---|
| Б1 | Один тариф `tier_standard`, все фичи включены | Существующие `tier_basic` / `tier_pro` / `tier_enterprise` → миграция в `tier_standard` |
| Б2 | Базовая цена | 60 000 ₽/мес без НДС, главный + 30 сотрудников = 31 место, 150 встреч/мес |
| Б3 | Доп. место | +1 000 ₽/мес, +5 встреч/мес |
| Б4 | Годовая подписка | скидка 20% → 720 000 × 0.80 = 576 000 ₽ за 12 месяцев |
| Б5 | Доплата за seats в годовой | до конца оплаченного периода, со скидкой 20%. Формула: `seats_added × 1_000 × месяцев_осталось × 0.80` |
| Б6 | Pro-rata в месячной | при добавлении сотрудника в середине цикла — «кусочек» до конца месяца + 1 полный месяц вперёд |
| Б7 | Снижение мест | применяется только со следующего биллинг-цикла |
| Б8 | Баланс встреч | накопительный, без потолка. При создании `−1`, при отмене до старта `+1` |
| Б9 | Реферал — обязателен ИНН | для получения реф-ссылки. Самореферал разрешён |
| Б10 | Выплата рефералу | 20 000 ₽ за каждый месячный платёж клиента / 192 000 ₽ единоразово за годовой |
| Б11 | Окно атрибуции | 3 месяца с первого захода по ссылке. Cookie TTL 90 дней. First-touch навсегда |
| Б12 | Бонусная подписка | реферал не видит такого клиента, выплат за бонусные месяцы нет |
| Б13 | Атрибуция за доплаты seats | НЕ начисляется (выплата только за основной платёж тарифа) |
| Б14 | Цикл выплат | 10-го числа каждого месяца за платежи прошлого месяца |
| Б15 | Ручное управление подпиской | super-админ обязан выбрать `paymentMode`: `paid` (в выручку, реф-выплата) или `bonus` (не в выручку, без реф-выплаты) + `reason` (≥3 символов) |
| Б16 | Платёжный провайдер | пока нет. Оффлайн-оплата по счёту, отметка вручную в `/admin/orgs/[id]/billing` |
| Б17 | Триал | отсутствует. Только демо-кабинет (см. ТЗ #2) и оплата |

---

## Prisma-модели

Все правки схемы применяются командой `bun run prisma:push` (см. skill `prisma-db-push-rules`, **никаких** `prisma migrate*`). HNSW (Hierarchical Navigable Small World — индекс для векторного поиска) и GIN-индексы здесь не нужны.

### Новые модели

```prisma
// ════════════════════════════════════════════════════════════════════════════
// Биллинг (sub-TZ 2026-05-25-billing-and-referrals-tz.md)
// ════════════════════════════════════════════════════════════════════════════

enum BillingPeriod {
  monthly
  yearly
}

enum SubscriptionStatus {
  DEMO        // Org зарегистрирована, демо-кабинет, без оплаты (см. ТЗ #2)
  ACTIVE      // подписка оплачена (paid) или активирована бонусом (bonus)
  PAST_DUE    // платёж не прошёл, льготный период 7 дней
  SUSPENDED   // льготный период истёк, read-only
  CANCELED    // клиент отменил автопродление, активна до конца оплаченного периода
  EXPIRED     // оплаченный период закончился, не продлили (или конец бонуса)
}

enum PaymentMode {
  paid    // реальная оплата (счёт или провайдер). В выручке, реф-выплата идёт
  bonus   // бонус от Z. Не в выручке, реф-выплата НЕ идёт
}

model Subscription {
  id                  String              @id @default(cuid())
  tenantId            String              @unique
  org                 Org                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  status              SubscriptionStatus  @default(DEMO)
  /// Для ACTIVE — обязателен. Для DEMO/EXPIRED/SUSPENDED — null.
  paymentMode         PaymentMode?
  billingPeriod       BillingPeriod?      // null для DEMO

  /// Стартовая дата первой подписки (не меняется при продлениях).
  startedAt           DateTime?
  /// Текущий оплаченный/бонусный период. Для DEMO — null.
  currentPeriodStart  DateTime?
  currentPeriodEnd    DateTime?
  /// Конец grace-периода (7 дней после неуспешного платежа). Только в PAST_DUE.
  pastDueUntil        DateTime?

  /// База — всегда 30 (главный + 30 сотрудников = 31 место). Лежит как число
  /// для возможности изменить в будущем без миграции данных.
  seatsBase           Int                 @default(30)
  /// Доп. сотрудники сверх базы. Цена = seatsExtra * 1_000 ₽/мес.
  seatsExtra          Int                 @default(0)

  /// Денежные суммы храним в копейках (Int), чтобы не плавали float'ы.
  monthlyPriceKopecks Int                 @default(6_000_000)   // 60 000 ₽
  /// Сумма реально оплачена по этой подписке за всё время (для аналитики).
  totalPaidKopecks    Int                 @default(0)

  /// Автопродление. Для DEMO/CANCELED — false. Для остальных — обычно true.
  autoRenew           Boolean             @default(false)

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  events              SubscriptionEvent[]
  invoices            Invoice[]
  clientReferralLink  ClientReferralLink?

  @@index([status])
  @@index([currentPeriodEnd])
  @@map("subscriptions")
}

model SubscriptionEvent {
  id              String       @id @default(cuid())
  subscriptionId  String
  subscription    Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  /// Тип события: 'created' | 'activated_paid' | 'activated_bonus' | 'renewed'
  /// | 'past_due' | 'suspended' | 'canceled' | 'expired' | 'seats_added'
  /// | 'seats_removed' | 'status_forced'.
  eventType       String
  /// Произвольные данные: суммы, числа мест, ссылки на Invoice/AuditLog.
  payload         Json
  /// Кто инициировал (для админских действий). null для cron/системы.
  byUserId        String?
  /// Обоснование (обязательно для админских ручных действий).
  reason          String?      @db.Text
  createdAt       DateTime     @default(now())

  @@index([subscriptionId, createdAt])
  @@map("subscription_events")
}

enum InvoiceStatus {
  draft       // сформирован, но клиент не запросил PDF
  issued      // PDF выдан, ждём оплату
  paid        // отмечен оплаченным (через провайдера или вручную админом)
  bonus       // не оплата, а бонусная активация (соответствует Subscription.paymentMode=bonus)
  void        // отменён
}

model Invoice {
  id              String        @id @default(cuid())
  tenantId        String
  org             Org           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptionId  String?
  subscription    Subscription? @relation(fields: [subscriptionId], references: [id])

  /// Человекочитаемый номер счёта — Z-2026-000123. Уникален в пределах системы.
  invoiceNumber   String        @unique
  /// Период, который покрывает счёт.
  periodStart     DateTime
  periodEnd       DateTime
  /// Состав счёта: [{ kind: 'base'|'seats'|'seats_prorata'|'yearly_discount', qty, unitKopecks, totalKopecks, note }].
  items           Json
  /// Итог в копейках (для удобства запросов и аналитики).
  totalKopecks    Int
  status          InvoiceStatus @default(draft)

  /// URL PDF-документа в S3 (Simple Storage Service) — public read.
  pdfUrl          String?
  issuedAt        DateTime?
  paidAt          DateTime?
  /// Внешний референс (номер платёжки клиента, id транзакции провайдера).
  externalRef     String?
  /// Кто отметил счёт оплаченным/бонусом вручную. null для автоматики.
  markedByUserId  String?

  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([tenantId, status])
  @@index([status, paidAt])
  @@map("invoices")
}

// ════════════════════════════════════════════════════════════════════════════
// Накопительный баланс встреч
// ════════════════════════════════════════════════════════════════════════════

model MeetingsBalance {
  id              String   @id @default(cuid())
  tenantId        String   @unique
  org             Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  /// Текущий доступный остаток встреч (накопительный, без потолка).
  balance         Int      @default(0)
  /// За всё время начислено по подпискам.
  totalGranted    Int      @default(0)
  /// За всё время потрачено на встречи.
  totalConsumed   Int      @default(0)
  /// Когда в последний раз был грант (для расследования жалоб).
  lastGrantedAt   DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("meetings_balance")
}

// ════════════════════════════════════════════════════════════════════════════
// Реферальная программа
// ════════════════════════════════════════════════════════════════════════════

enum ReferralPayoutStatus {
  pending   // начислено, не выплачено
  paid      // выплачено
  void      // отменено вручную (с reason)
}

enum ReferralLegalForm {
  self_employed   // самозанятый
  individual_entrepreneur  // ИП
  legal_entity    // юрлицо
}

model Referral {
  id              String              @id @default(cuid())
  /// Профиль реферала живёт независимо от его Org. Один user → один Referral.
  ownerUserId     String              @unique
  owner           User                @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  /// Уникальный slug 6–8 символов, генерируется системой.
  slug            String              @unique
  /// ИНН (Индивидуальный Номер Налогоплательщика) реферала.
  inn             String              @db.VarChar(20)
  /// Подтверждение по API ИНН (контракт InnLookupService — см. ТЗ #3).
  innVerifiedAt   DateTime?
  legalForm       ReferralLegalForm
  /// Реквизиты для выплат: { bank, bic, account, etc. } — структура зависит от legalForm.
  payoutDetails   Json
  /// Дата принятия оферты (фиксируется при первой выплате).
  contractAcceptedAt  DateTime?

  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  attributions    ReferralAttribution[]
  clientLinks     ClientReferralLink[]
  payouts         ReferralPayout[]

  @@index([slug])
  @@map("referrals")
}

model ReferralAttribution {
  id              String   @id @default(cuid())
  referralId      String
  referral        Referral @relation(fields: [referralId], references: [id], onDelete: Cascade)

  /// Реферальный slug (дублируется для read-without-join).
  slug            String
  /// Browser fingerprint (UA + accept-language + др. — рассчитывается на клиенте).
  fingerprint     String?  @db.VarChar(64)
  ip              String?  @db.VarChar(45)
  userAgent       String?  @db.Text
  /// referer header (для отчёта по источникам трафика).
  referer         String?  @db.Text

  /// Cookie TTL = 90 дней. Атрибуция действует ровно 3 месяца от createdAt.
  createdAt       DateTime @default(now())
  expiresAt       DateTime

  @@index([slug, createdAt])
  @@index([fingerprint])
  @@index([expiresAt])
  @@map("referral_attributions")
}

model ClientReferralLink {
  id              String       @id @default(cuid())
  tenantId        String       @unique
  org             Org          @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  referralId      String
  referral        Referral     @relation(fields: [referralId], references: [id])

  /// First-touch: момент привязки (первый заход в окне 3 мес → регистрация → активация подписки).
  attachedAt      DateTime     @default(now())
  /// Дата первой РЕАЛЬНОЙ оплаты (не bonus). До этого момента реферал не видит клиента.
  firstPaidAt     DateTime?

  /// Снапшот ReferralAttribution.id, который победил при first-touch.
  sourceAttributionId String?

  subscriptionId  String?      @unique
  subscription    Subscription? @relation(fields: [subscriptionId], references: [id])

  payouts         ReferralPayout[]

  @@index([referralId])
  @@map("client_referral_links")
}

model ReferralPayout {
  id              String               @id @default(cuid())
  referralId      String
  referral        Referral             @relation(fields: [referralId], references: [id], onDelete: Cascade)
  clientReferralLinkId String
  clientReferralLink   ClientReferralLink @relation(fields: [clientReferralLinkId], references: [id], onDelete: Cascade)

  /// Какой Invoice породил начисление.
  triggerInvoiceId String?
  /// Месяц начисления — YYYY-MM (для группировки в кроне 10-го числа).
  periodMonth     String               @db.VarChar(7)

  amountKopecks   Int
  status          ReferralPayoutStatus @default(pending)
  /// URL акта самозанятого / счёта ИП в S3.
  payoutDocumentUrl String?
  paidAt          DateTime?
  /// reason для status='void'.
  voidReason      String?              @db.Text

  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([referralId, periodMonth])
  @@index([status])
  @@map("referral_payouts")
}
```

### Изменения существующих моделей

```prisma
model Org {
  // ... существующие поля
  /// Юридические реквизиты — заполняются через InnLookupService (контракт см. ТЗ #3).
  inn           String?  @db.VarChar(20)
  ogrn          String?  @db.VarChar(20)
  kpp           String?  @db.VarChar(20)
  directorName  String?  @db.VarChar(255)
  legalAddress  String?  @db.Text

  subscription      Subscription?
  meetingsBalance   MeetingsBalance?
  clientReferralLink ClientReferralLink?
  invoices          Invoice[]
}

model User {
  // ... существующие поля
  referral      Referral?
}
```

### Patch-скрипт миграции entitlements

`backend/scripts/migrate-entitlements-to-standard.ts` (one-off patch, не sync — см. skill `safe-seed-rules`):

- Найти все `OrgEntitlement` с `tier IN ('tier_basic', 'tier_pro', 'tier_enterprise')`.
- Обновить `tier='tier_standard'`.
- Затронутые `featureOverrides`/`quotaOverrides` оставить как есть (они продолжат работать на уровне per-Org).
- Залогировать каждое изменение.
- Идемпотентность: повторный запуск ничего не меняет.

После — обновить `tier-config.ts` (см. Фаза 1.2).

---

## Фазы реализации

### Фаза 1. Prisma-схема + упрощение entitlements

Цель: применить все новые модели и упростить `tier-config.ts` до одного тарифа.

#### 1.1. Применить Prisma-схему

- Добавить в [backend/prisma/schema.prisma](../../backend/prisma/schema.prisma) все enum'ы и модели из раздела «Prisma-модели» выше.
- Поправить `Org` и `User` (новые поля и обратные связи).
- Запустить `bun run prisma:push` (см. skill `prisma-db-push-rules`).
- Запустить `bun run prisma:generate`.
- Запустить `bun run typecheck` — должно быть зелёным.

#### 1.2. Упростить `tier-config.ts`

- В [backend/src/modules/entitlements/tier-config.ts](../../backend/src/modules/entitlements/tier-config.ts):
  - `type TierKey = 'tier_standard'` (только один тариф, оставшиеся ключи — удалить).
  - `ALL_TIERS = ['tier_standard']`.
  - `TIER_CONFIG.tier_standard` — все `FeatureKey` = `true`. Квоты `meetings_per_month` — выкинуть из квот (теперь её ведёт `MeetingsBalance`, см. фазу 3). Остальные квоты — оставить большие значения (5 000 / 500 000 / 3 000 / ...) для anti-abuse, либо вынести в ENV (см. п. 1.4).
  - Fail-safe в `EntitlementService.buildFailSafe` — поменять `tier_basic` → `tier_standard`.
- Удалить `BASIC_FEATURES` / `PRO_FEATURES` / `ENTERPRISE_FEATURES`, `BASIC_QUOTAS` / `PRO_QUOTAS` / `ENTERPRISE_QUOTAS`.
- Обновить `seed-entitlements.ts` — дефолт `tier='tier_standard'`.
- В `OrgEntitlement.tier @default("tier_pro")` → `@default("tier_standard")`. `bun run prisma:push`.

#### 1.3. Patch-скрипт миграции

- Реализовать `backend/scripts/migrate-entitlements-to-standard.ts` по спецификации выше.
- Запустить на dev: `bun run scripts/migrate-entitlements-to-standard.ts`.

#### 1.4. Чистка квот, которые теперь anti-abuse

- `chat_requests_per_day_per_user`, `blocks_per_org`, `sources_meeting`, `sources_other`, `ingest_bytes_per_month`, `links_per_day`, `prompt_templates_per_org`, `prompt_experiments_concurrent`, `multi_reports_limit_per_meeting` — оставить как есть, значения для `tier_standard` = максимальные (взять `ENTERPRISE_QUOTAS` как базу). Это технические anti-abuse пределы, не tier-фичи.
- `meetings_per_month` — удалить из `QuotaKey` и `ALL_QUOTAS`. Все вызовы `QuotaService.checkAndIncrementOrg({quotaName: 'meetings_per_month'})` заменить на проверку `MeetingsBalanceService.consume()` (см. Фаза 3.2).

**DoD фазы 1:**
- [ ] `bun run prisma:push` применил все новые модели без ошибок.
- [ ] `bun run prisma:generate` обновил клиент.
- [ ] `bun run typecheck` зелёный.
- [ ] `tier-config.ts` содержит только `tier_standard`, все фичи `true`.
- [ ] Patch-script `migrate-entitlements-to-standard.ts` отработал на dev — все Org переведены на `tier_standard`.
- [ ] Все ссылки на `tier_basic`/`tier_pro`/`tier_enterprise` в коде удалены (`grep` пуст).

---

### Фаза 2. Модуль `billing` — Subscription FSM, биллинг-цикл, счета

Цель: рабочий FSM подписки, формула цены, генерация PDF-счёта, базовый биллинг-цикл (без платёжного провайдера).

#### 2.1. Структура модуля

`backend/src/modules/billing/`:

- `billing.module.ts` — регистрация.
- `services/subscription.service.ts` — CRUD и FSM-переходы.
- `services/subscription-fsm.ts` — pure-функция `canTransition(from, to): boolean` + таблица переходов.
- `services/seat.service.ts` — расчёт цены, pro-rata, добавление/снятие мест.
- `services/billing-cycle.service.ts` — продление, переходы PAST_DUE → SUSPENDED → EXPIRED.
- `services/invoice.service.ts` — генерация номеров (формат `Z-YYYY-NNNNNN`), формирование `items`, рендеринг PDF через существующий backend-механизм (PDFKit или puppeteer — выбор по тому, что уже стоит; если нет — PDFKit).
- `services/manual-billing.service.ts` — админские действия: `activatePaid`, `activateBonus`, `adjustSeats`, `forceStatus`.
- `controllers/billing.controller.ts` — клиентские эндпоинты.
- `controllers/admin-billing.controller.ts` — админские эндпоинты.
- `workers/billing-cycle.cron.ts` — ежедневный cron (BullMQ `@Cron('0 3 * * *')` — 03:00) по таймзоне `Europe/Moscow`.
- `dto/` — все DTO через `nestjs-zod` (см. skill `nestjs-rules`).
- `events/` — определения типизированных событий (`subscription.activated`, `invoice.paid`, ...).

#### 2.2. SubscriptionService — FSM

Реализовать переходы по таблице 4.3 из анализа. Каждое изменение статуса:
- Пишет `SubscriptionEvent`.
- Инвалидирует кэш entitlement (если статус влияет на доступ).
- Эмитит NestJS `EventEmitter2` событие (`subscription.activated_paid`, `subscription.activated_bonus`, `subscription.expired`, ...).

Внешний контракт: `SubscriptionService.transition(subscriptionId, newStatus, {byUserId, reason, paymentMode?})`. Никаких прямых `prisma.subscription.update({status})` — только через сервис.

#### 2.3. SeatService — формулы

- `calculateMonthlyPriceKopecks(seatsBase, seatsExtra)`: `60_000 * 100 + seatsExtra * 1_000 * 100`.
- `calculateYearlyPriceKopecks(seatsBase, seatsExtra)`: `calculateMonthlyPriceKopecks * 12 * 0.80`.
- `calculateAddSeatsMonthlyProrata(subscription, seatsToAdd, addedAt)`:
  - Дней до конца текущего месяца: `daysLeft`.
  - Кусочек: `seatsToAdd * 1_000 * 100 * daysLeft / 30` (30-дневный месяц для простоты).
  - Полный месяц вперёд: `seatsToAdd * 1_000 * 100`.
  - Итого: сумма.
- `calculateAddSeatsYearlyProrata(subscription, seatsToAdd, addedAt)`:
  - Полных месяцев до `currentPeriodEnd`: `monthsLeft`.
  - Доплата: `seatsToAdd * 1_000 * 100 * monthsLeft * 0.80`.
- `calculateMeetingsGrant(seatsBase, seatsExtra)`: `150 + seatsExtra * 5`.

Юнит-тесты на каждую формулу с фикстурами из таблиц 1.3 / 1.4 / 1.5 анализа.

#### 2.4. InvoiceService — генерация PDF

- `createInvoice({tenantId, subscriptionId, type, items, periodStart, periodEnd})` → `Invoice` (status=`draft`).
- `issueInvoice(invoiceId)` → формирует PDF (реквизиты Z из ENV `BILLING_LEGAL_ENTITY_*`, реквизиты клиента из `Org.inn/ogrn/kpp/directorName/legalAddress`), грузит в S3 (через существующий `S3Service`), сохраняет `pdfUrl`, переводит в `issued`.
- `markPaid(invoiceId, {byUserId, externalRef, reason})` → `status=paid`, `paidAt=now`. Эмитит событие `invoice.paid`.
- `markBonus(invoiceId, {byUserId, reason})` → `status=bonus`.

#### 2.5. BillingCycleService + cron

`workers/billing-cycle.cron.ts` (`@Cron('0 3 * * *')`, таймзона `Europe/Moscow`):

1. **PAST_DUE → SUSPENDED**: все подписки с `pastDueUntil < now` → SUSPENDED.
2. **CANCELED → EXPIRED**: все с `status=CANCELED` и `currentPeriodEnd < now` → EXPIRED.
3. **ACTIVE bonus → EXPIRED**: с `paymentMode=bonus` и `currentPeriodEnd < now` → EXPIRED.
4. **ACTIVE paid → PAST_DUE**: с `paymentMode=paid`, `autoRenew=true`, `currentPeriodEnd < now`. Платёжного провайдера нет → ставим PAST_DUE сразу (в будущем — попытка списания через провайдера).
5. **Уведомления за 3 дня до конца**: всем с `currentPeriodEnd between now and now+3d` отправить notification (`subscription.expiring_soon`).

Все cron-операции идемпотентны и работают через Redis-лок.

#### 2.6. ManualBillingService

- `activate({tenantId, billingPeriod, seatsBase, seatsExtra, startedAt, paymentMode, byUserId, reason})`:
  - Найти или создать Subscription.
  - Установить `status=ACTIVE`, `paymentMode`, период.
  - Создать `Invoice` со `status=paid` (если paymentMode=paid) или `bonus` (если paymentMode=bonus).
  - Стереть демо-данные через будущий контракт `DemoModeService.purge(tenantId)` (контракт описан в ТЗ #2; в этой фазе вызываем через DI как опциональный сервис).
  - Грантануть встречи через `MeetingsBalanceService.grant(tenantId, calculateMeetingsGrant(...))`.
  - Если `paymentMode=paid` — эмитнуть событие `invoice.paid`, на которое подписан `ReferralPayoutService.onInvoicePaid` (см. фазу 4).
  - Записать `AuditLog` `SUBSCRIPTION_MANUAL_ACTIVATED`.
- `adjustSeats({tenantId, newSeatsExtra, byUserId, reason})`:
  - Для `monthly`: создать pro-rata Invoice.
  - Для `yearly`: создать Invoice со скидкой 20%.
  - Эмитит `subscription.seats_changed`.
  - Грантануть/убрать соответствующие встречи (грант только при увеличении, при уменьшении не списываем то, что уже накоплено).

#### 2.7. Endpoint'ы — клиентские

Все под префиксом `/api/v1/`, guards `CookieAuthGuard, TenantGuard`. Owner-only (через `@RequireRole('owner')`) — выделено отдельно.

| Метод | Путь | Guards | Назначение | Request | Response |
|---|---|---|---|---|---|
| GET | `/billing/subscription` | auth+tenant | Текущая подписка Org | — | `SubscriptionDto { status, paymentMode, billingPeriod, currentPeriodStart, currentPeriodEnd, seatsBase, seatsExtra, monthlyPriceKopecks, autoRenew }` |
| GET | `/billing/meetings-balance` | auth+tenant | Баланс встреч | — | `MeetingsBalanceDto { balance, totalGranted, totalConsumed, lastGrantedAt }` |
| GET | `/billing/invoices` | auth+tenant, owner | Список счетов | `?page&pageSize&status` | `PaginatedDto<InvoiceDto>` |
| GET | `/billing/invoices/:id/pdf` | auth+tenant, owner | Скачать PDF | — | redirect на S3 signed URL |
| POST | `/billing/invoices/draft` | auth+tenant, owner | Сформировать счёт на оплату по счёту (банковский перевод) | `{ billingPeriod, seatsExtra }` | `InvoiceDto` (status=draft) |
| POST | `/billing/invoices/:id/issue` | auth+tenant, owner | Зафиксировать PDF и сделать issued | — | `InvoiceDto` (status=issued, pdfUrl) |
| POST | `/billing/seats/preview` | auth+tenant, owner | Расчёт цены добавления мест без применения | `{ seatsToAdd }` | `{ prorataKopecks, fullNextCycleKopecks, totalKopecks }` |

#### 2.8. Endpoint'ы — админские

Все под префиксом `/api/v1/admin/`, guards `CookieAuthGuard, RbacGuard` (super_admin).

| Метод | Путь | Назначение | Request | Response |
|---|---|---|---|---|
| GET | `/admin/orgs/:tenantId/billing` | Карточка подписки + последние счета + баланс встреч | — | `AdminOrgBillingDto` |
| POST | `/admin/orgs/:tenantId/billing/activate` | Включить подписку вручную | `{ billingPeriod, seatsBase?, seatsExtra, startedAt, paymentMode: 'paid'|'bonus', reason: string (≥3) }` | `SubscriptionDto` |
| POST | `/admin/orgs/:tenantId/billing/adjust-seats` | Ручное изменение seats | `{ newSeatsExtra, reason }` | `SubscriptionDto` + `InvoiceDto` (если есть доплата) |
| POST | `/admin/orgs/:tenantId/billing/force-status` | Принудительный перевод статуса (на крайний случай) | `{ newStatus, reason }` | `SubscriptionDto` |
| POST | `/admin/orgs/:tenantId/billing/invoices/:id/mark-paid` | Отметить счёт оплаченным (по банковскому переводу) | `{ externalRef?, reason }` | `InvoiceDto` |

Все админские действия пишут в `AuditLog` (см. существующий [AuditLogService](../../backend/src/modules/audit/audit-log.service.ts)).

**DoD фазы 2:**
- [ ] Модуль `billing` зарегистрирован в `AppModule`, контроллеры видны в Swagger по `/api/docs`.
- [ ] `SubscriptionService.transition` использует FSM-таблицу; запрещённые переходы кидают `BadRequestException`.
- [ ] Юнит-тесты на `SeatService` (формулы) зелёные (8+ кейсов из таблиц 1.3–1.5 анализа).
- [ ] Юнит-тесты на FSM (валидные переходы и попытки запрещённых) зелёные.
- [ ] `BillingCycleCron` идемпотентен, e2e-тест прогоняет крон 2 раза подряд и видит одинаковое состояние.
- [ ] `InvoiceService` генерирует PDF, файл доступен по `pdfUrl` (smoke-тест).
- [ ] Все 12 эндпоинтов отдают 200 на happy-path запросах.
- [ ] `AuditLog` пишется для всех админских действий.

---

### Фаза 3. Модуль `meetings-balance`

Цель: накопительный баланс встреч и блокировка `MeetingsController.create` при `balance ≤ 0`.

#### 3.1. Сервис

`backend/src/modules/meetings-balance/`:
- `services/meetings-balance.service.ts`:
  - `getBalance(tenantId): MeetingsBalance` — берёт или создаёт (init с `balance=0`).
  - `grant(tenantId, count, reason: string)` — `balance += count`, `totalGranted += count`, `lastGrantedAt=now`. Идемпотентность не нужна — вызывается из строго определённых мест (активация подписки, продление, добавление seats в месячной).
  - `consume(tenantId, meetingId)` — `balance -= 1`, `totalConsumed += 1`. Если `balance <= 0` ДО списания → бросает `ForbiddenException` (`meetings_balance_exhausted`).
  - `refund(tenantId, meetingId, reason)` — `balance += 1`, `totalConsumed -= 1` (по аналогии с возвратом — для отмены до старта).

Все операции в Prisma-транзакции с `SELECT ... FOR UPDATE` (через `prisma.$transaction` с rawQuery) для защиты от гонок.

#### 3.2. Интеграция в `MeetingsController`

- В [backend/src/modules/meetings/meetings.controller.ts](../../backend/src/modules/meetings/meetings.controller.ts) (или одноимённом сервисе):
  - Перед созданием встречи (метод create) — вызов `MeetingsBalanceService.consume(tenantId, meetingId)`. Если `Subscription.status === 'DEMO'` — НЕ списывать (демо-данные изолированы).
  - При успешном создании — лог в `SubscriptionEvent` (опционально через payload `meeting.created`).
  - При отмене встречи в статусе `scheduled` (до старта) — вызов `MeetingsBalanceService.refund(...)`.

#### 3.3. Удалить старую квоту

- Удалить из `QuotaService.checkAndIncrementOrg` все вызовы по `meetings_per_month`.
- Удалить `meetings_per_month` из `QuotaKey` и `ALL_QUOTAS`.

#### 3.4. Endpoint'ы

| Метод | Путь | Guards | Назначение |
|---|---|---|---|
| GET | `/billing/meetings-balance` | auth+tenant | Уже описан в фазе 2.7 |
| GET | `/admin/orgs/:tenantId/meetings-balance` | super_admin | Админский просмотр + ручной грант |
| POST | `/admin/orgs/:tenantId/meetings-balance/grant` | super_admin | `{ count, reason }` — ручной грант |

**DoD фазы 3:**
- [ ] `MeetingsBalance` создаётся при первой активации подписки.
- [ ] Создание встречи списывает 1, отмена до старта — возвращает 1.
- [ ] При `balance=0` `POST /meetings` отдаёт 403 с кодом `meetings_balance_exhausted`.
- [ ] Демо-Org (status=DEMO) не списывает баланс.
- [ ] Гонка двух одновременных POST на одной Org не списывает дважды (тест на параллельность).
- [ ] `meetings_per_month` удалён из QuotaService.

---

### Фаза 4. Модуль `referrals` — атрибуция и выплаты

Цель: рабочая реферальная программа с генерацией ссылок, атрибуцией, first-touch привязкой и cron-ом начислений 10-го числа.

#### 4.1. Структура модуля

`backend/src/modules/referrals/`:
- `services/referral.service.ts` — создание Referral, генерация slug.
- `services/slug-generator.service.ts` — pure-функция генерации 6–8-символьного slug. Алфавит `[a-z0-9]` без `01ilo`. Префикс `r-` (для читаемости в URL). Уникальность через retry до 10 раз.
- `services/attribution.service.ts` — запись `ReferralAttribution`, поиск по cookie/fingerprint.
- `services/client-link.service.ts` — first-touch привязка клиента к рефералу при активации подписки.
- `services/payout.service.ts` — начисление при `invoice.paid`, формирование документа на вывод.
- `controllers/referrals.controller.ts` — клиентский кабинет реферала.
- `controllers/admin-referrals.controller.ts` — админка рефералов.
- `controllers/public-attribution.controller.ts` — публичный эндпоинт для landing-beacon (без авторизации).
- `workers/referral-payout.cron.ts` — ежемесячный cron 10-го числа.

#### 4.2. AttributionService

- `recordAttribution({slug, fingerprint, ip, userAgent, referer})`:
  - Найти `Referral` по slug. Если нет → 404, не записывать ничего.
  - Создать `ReferralAttribution` с `expiresAt = now + 90 дней`.
  - Возвращает `attributionId` (чтобы landing мог записать в cookie).
- `findActiveAttribution({fingerprint?, slugFromCookie?})`:
  - Если `slugFromCookie` есть — возвращает самую раннюю `ReferralAttribution` за последние 3 месяца с этим slug.
  - Иначе если `fingerprint` есть — то же по fingerprint.
  - Возвращает null если ничего не найдено.

#### 4.3. ClientLinkService — first-touch

- Подписка на событие `subscription.activated_paid` (NestJS EventEmitter2):
  - Если у Org уже есть `ClientReferralLink` — ничего не делать (привязка навсегда).
  - Иначе — взять `cookie/fingerprint` из контекста активации (передаётся через payload события — добавить поле `attributionContext` в payload `SubscriptionService.transition` для случая ACTIVE).
  - Если контекста нет — попробовать найти через `AttributionService.findActiveAttribution({fingerprint: org.creatorFingerprint})` (нужно сохранить fingerprint при создании Org из landing).
  - При найденной активной атрибуции — создать `ClientReferralLink { tenantId, referralId, sourceAttributionId, firstPaidAt=now, subscriptionId }`.
- На событие `subscription.activated_bonus` — НЕ создавать ClientReferralLink, но сохранить атрибуцию (в фоне). При следующем `subscription.activated_paid` — попробовать заново.

#### 4.4. PayoutService — начисление

- На событие `invoice.paid` (только `paymentMode=paid`):
  - Найти `ClientReferralLink` у этой Org. Если нет — ничего.
  - Рассчитать `amountKopecks`:
    - Если `Invoice.items` содержит `kind='base'` для месячной — 20 000 ₽ = `2_000_000` копеек.
    - Если `Invoice.items` содержит годовой `kind='base'` — 192 000 ₽ = `19_200_000` копеек.
    - Если только `kind='seats'`/`seats_prorata` (доплата seats) — не начислять.
  - Создать `ReferralPayout { status=pending, periodMonth=YYYY-MM текущего месяца, triggerInvoiceId, amountKopecks }`.
  - Если `ClientReferralLink.firstPaidAt` пуст — установить.

#### 4.5. Cron 10-го числа

`workers/referral-payout.cron.ts` (`@Cron('0 10 10 * *')` — 10-го числа в 10:00 Europe/Moscow):

1. Найти все `ReferralPayout` со `status=pending` и `periodMonth=` прошлый месяц.
2. Сгруппировать по `referralId`.
3. Для каждой группы:
   - Сформировать сводный документ (акт самозанятого / счёт ИП) — PDF в S3 через тот же механизм, что и InvoiceService.
   - Записать `payoutDocumentUrl` в каждый payout группы.
   - Отправить уведомление рефералу (email — через существующий `MailService`, если есть; иначе TODO-комментарий).
4. **Выплаты status не меняет автоматически** — статус `paid` ставит админ Z вручную после реального перевода (через `/admin/referrals`).

#### 4.6. Endpoint'ы — клиентский кабинет реферала

Под `/api/v1/`, guards `CookieAuthGuard`.

| Метод | Путь | Guards | Назначение | Request | Response |
|---|---|---|---|---|---|
| GET | `/referrals/me` | auth | Профиль реферала текущего user'а (если есть) | — | `ReferralDto \| null` |
| POST | `/referrals` | auth | Создать реферала (ИНН + реквизиты выплат) | `{ inn, legalForm, payoutDetails }` | `ReferralDto` |
| PATCH | `/referrals/me` | auth | Обновить реквизиты выплат | `{ payoutDetails }` | `ReferralDto` |
| GET | `/referrals/me/link` | auth | Реф-ссылка + QR | — | `{ url, qrPngBase64, qrSvg }` |
| GET | `/referrals/me/clients` | auth | Список приведённых платных клиентов (не показывает clients на bonus-подписке) | `?page&pageSize` | `PaginatedDto<ReferredClientDto { orgName, attachedAt, status: 'paying'\|'churned' }>` |
| GET | `/referrals/me/balance` | auth | `{ pendingKopecks, paidKopecks }` |
| GET | `/referrals/me/payouts` | auth | История начислений и выплат | `?status?` | `PaginatedDto<ReferralPayoutDto>` |
| POST | `/referrals/me/payout-document` | auth | Сформировать документ на вывод (по pending payout'ам) | `{ payoutIds?: string[] }` | `{ documentUrl }` |

#### 4.7. Endpoint'ы — административный

Под `/api/v1/admin/`, guards `CookieAuthGuard, RbacGuard` (super_admin).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/referrals` | Список рефералов с метриками (число привязанных клиентов, сумма pending, paid) `?page&pageSize&search` |
| GET | `/admin/referrals/:id` | Карточка реферала: профиль, ссылка, атрибуции, клиенты, выплаты |
| POST | `/admin/referrals/:id/payouts/:payoutId/mark-paid` | Отметить выплату как `paid` (после реального перевода) `{ reason }` |
| POST | `/admin/referrals/:id/payouts/:payoutId/void` | Отменить начисление `{ reason }` |
| POST | `/admin/referrals/:id/payouts/manual` | Ручное начисление (страховка) `{ amountKopecks, reason, clientReferralLinkId }` |

#### 4.8. Публичный endpoint для landing-beacon

| Метод | Путь | Guards | Назначение |
|---|---|---|---|
| POST | `/public/referral/attribution` | (нет) — публичный, rate-limit по IP | Запись клика по реф-ссылке. Body: `{ slug, fingerprint, referer }`. Response: `{ ok: true, attributionId }`. CORS: разрешён landing-домен. |

**DoD фазы 4:**
- [ ] Slug генерируется уникальным, retry работает.
- [ ] `POST /public/referral/attribution` принимает заявку без авторизации, пишет в `ReferralAttribution`.
- [ ] First-touch привязка: создан Referral → клик по ссылке → регистрация Org → активация `paid` → создан `ClientReferralLink`.
- [ ] Атрибуция за пределами окна 3 месяца не учитывается.
- [ ] Бонусная активация (paymentMode=bonus) НЕ создаёт `ClientReferralLink`, не начисляет payout.
- [ ] При активации после бонуса (bonus → paid) — `ClientReferralLink` создаётся, начисления идут с момента paid.
- [ ] `invoice.paid` за месячный тариф создаёт `ReferralPayout` на 20 000 ₽; за годовой — 192 000 ₽.
- [ ] Доплата seats (Invoice с items only `seats`/`seats_prorata`) — НЕ создаёт payout.
- [ ] Cron 10-го числа формирует PDF и складывает в S3.
- [ ] Endpoint'ы клиентского кабинета и админки отдают 200 на happy-path.

---

### Фаза 5. Ручное управление подпиской в Z-Admin (paid/bonus + reason + audit)

Цель: super-админ может включить/продлить/изменить подписку любой Org с явным выбором режима оплаты и обязательным обоснованием.

> Эта фаза — это UI и валидация для бэкенда из фазы 2 (`ManualBillingService`). Полностью отдельная, потому что объём UI большой и зависит от готового `/admin/orgs/[id]/billing` (фаза 7).

#### 5.1. ManualBillingService — финальный аудит и страховки

- Все методы требуют `reason` (минимум 3 символа, валидация в Zod-DTO).
- Все методы пишут `AuditLog`:
  - `SUBSCRIPTION_MANUAL_ACTIVATED { paymentMode, billingPeriod, seatsBase, seatsExtra, reason }`.
  - `SUBSCRIPTION_SEATS_ADJUSTED { before, after, reason }`.
  - `SUBSCRIPTION_STATUS_CHANGED { fromStatus, toStatus, reason }`.
  - `INVOICE_MARKED_PAID { invoiceId, externalRef, reason }`.
- Запрет: super-админ не может пометить ACTIVE подписку как paid без `Invoice` со `status=paid` (или создать invoice одновременно с активацией).

#### 5.2. Уведомление клиента

- При `paymentMode=bonus` — клиент в `/settings/billing` видит запись типа «Бонус от Z — N месяцев», прозрачно.
- При `paymentMode=paid` — клиент видит «Оплачено по счёту №...».

**DoD фазы 5:**
- [ ] Любая попытка активации без `reason` (или `<3` символов) → 400.
- [ ] `AuditLog` содержит запись для каждого ручного действия.
- [ ] При активации с `paymentMode=bonus` ReferralPayoutService НЕ создаёт payout (проверяется юнит-тестом на отсутствие создаваемого payout'а при событии).
- [ ] Запись об активации видна в `SubscriptionEvent` с `byUserId` и `reason`.

---

### Фаза 6. Frontend клиентский: `/settings/billing` + `/referrals`

Цель: страница биллинга и реферальный кабинет работают согласно решениям анализа.

#### 6.1. `/settings/billing` — переделка

Файл: [frontend/app/(authenticated)/settings/billing/BillingClient.tsx](../../frontend/app/(authenticated)/settings/billing/BillingClient.tsx) (заменить содержимое; вспомогательные UI-куски — выделить в подкомпоненты).

Слои согласно skill `frontend-rules`: `ApiDto → DomainModel → UiModel`.

- API-файлы:
  - `frontend/src/api/billing.api.ts` — `getSubscription`, `getMeetingsBalance`, `listInvoices`, `getInvoicePdfUrl`, `createInvoiceDraft`, `issueInvoice`, `previewSeats`.
  - `frontend/src/api/referrals.api.ts` (вынесено в 6.2).
- Domain-файлы:
  - `frontend/src/domain/subscription.ts` — `Subscription`, `SubscriptionStatus` enum.
  - `frontend/src/domain/invoice.ts`.
  - `frontend/src/domain/meetings-balance.ts`.

Структура страницы:
1. **Карточка текущей подписки**: статус (бейдж), период, число мест (база + extra), цена (с разбивкой), `autoRenew`.
2. **Карточка баланса встреч**: `balance` (большим шрифтом), `lastGrantedAt`, лёгкая инфо «при текущем тарифе грант N встреч/мес».
3. **Кнопка «Выставить счёт»** → модалка:
   - Выбор `billingPeriod: monthly | yearly`.
   - Поле `seatsExtra` (число).
   - Превью цены через `POST /billing/seats/preview` + основной расчёт.
   - Кнопка «Сформировать PDF» → `POST /billing/invoices/draft` → `POST /billing/invoices/:id/issue` → ссылка на PDF + инструкция «Реквизиты для оплаты в счёте. После поступления денег мы активируем подписку.».
4. **Управление сотрудниками**: текущее число extra-seats, кнопки «+1», «-1». При увеличении — превью pro-rata и подтверждение «Будет выставлен счёт на X ₽».
5. **История счетов**: таблица с фильтром по статусу + ссылки на PDF.

UX-состояния: loading, empty, error, success — согласно `frontend-rules`. Тексты — только русский (см. memory `admin_ui_russian_only`).

#### 6.2. `/referrals` — новая страница

Файл: `frontend/app/(authenticated)/referrals/page.tsx` + `RefferralsClient.tsx`.

- API: `frontend/src/api/referrals.api.ts` — все 8 эндпоинтов клиентского кабинета.
- Domain: `frontend/src/domain/referral.ts`.

Сценарий пользователя:
1. Если `getReferralsMe()` вернул `null` → форма «Стать рефералом» (ИНН + юр.форма + реквизиты выплат). Кнопка «Зарегистрироваться как реферал» → `POST /referrals`.
2. Если есть профиль → дашборд:
   - **Карточка ссылки**: URL + кнопка «Скопировать», QR-код (PNG + кнопка «Скачать SVG»).
   - **Статистика**: число переходов (по `ReferralAttribution`), число регистраций, число платных клиентов.
   - **Баланс**: pending + paid.
   - **Список клиентов**: таблица с `orgName`, `attachedAt`, `status`. Только paid-клиенты (бонусные скрыты).
   - **История выплат**: таблица с PDF-документами.
   - **Кнопка «Сформировать документ на вывод»** → собирает все pending payout'ы → `POST /referrals/me/payout-document` → PDF.

**DoD фазы 6:**
- [ ] Страница `/settings/billing` рендерится для owner без ошибок.
- [ ] Кнопка «Выставить счёт» формирует PDF и показывает его URL.
- [ ] Превью pro-rata показывает корректные суммы (≥ 3 ручных сценария проверены вручную).
- [ ] Страница `/referrals` доступна по сайдбару.
- [ ] Регистрация реферала проходит, реф-ссылка создаётся.
- [ ] QR-код виден и качественно сканируется.
- [ ] `bun run typecheck` и `bun run lint` зелёные.

---

### Фаза 7. Frontend админский: `/admin/orgs/[id]/billing` + `/admin/referrals` + `/admin/billing-overview`

Цель: super-админ может всем управлять и видеть MVP-метрики.

#### 7.1. `/admin/orgs/[id]/billing` — переделка

Файл: [frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx](../../frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx).

- API: `frontend/src/api/admin-billing.api.ts`.
- Domain: переиспользует `Subscription`, `Invoice` из 6.1.

Структура:
1. **Карточка подписки**: статус, paymentMode, период, мест, баланс встреч, последняя активность.
2. **Кнопка «Включить/продлить подписку»** → модалка:
   - Выбор `billingPeriod`.
   - `seatsBase` (read-only, обычно 30).
   - `seatsExtra` (число).
   - `startedAt` (date-picker, default — now).
   - **`paymentMode` — обязательный выбор** (большой radio-group): «Оплата прошла» / «Бонус от Z». Объяснение под каждым вариантом.
   - `reason` (textarea, минимум 3 символа, валидация).
   - Кнопка «Активировать» → `POST /admin/orgs/:id/billing/activate`.
3. **Кнопка «Добавить сотрудников вручную»** → модалка `newSeatsExtra` + `reason`.
4. **Кнопка «Сменить статус»** (под защитой confirm-диалога) → `POST /admin/orgs/:id/billing/force-status`.
5. **Таблица счетов**: со статусом и кнопкой «Отметить оплаченным» (для `issued`).
6. **История событий подписки**: timeline из `SubscriptionEvent` с `byUser`, `reason`.

#### 7.2. `/admin/referrals` — новая страница

Файл: `frontend/app/(authenticated)/admin/referrals/page.tsx` + Client.

- Master-detail: слева список рефералов с поиском и метриками (число клиентов, сумма pending), справа карточка.
- Карточка: профиль + ИНН + реквизиты, список атрибуций (с фильтром по сроку), список клиентов, список выплат.
- Действия на выплате:
  - «Отметить выплаченной» (с reason) → `POST /admin/referrals/:id/payouts/:payoutId/mark-paid`.
  - «Отменить начисление» (с reason).
- Кнопка «Ручное начисление» (для страховки).

#### 7.3. `/admin/billing-overview` — новая страница

Файл: `frontend/app/(authenticated)/admin/billing-overview/page.tsx` + Client.

- API: `frontend/src/api/admin-billing-overview.api.ts` → `GET /api/v1/admin/billing-overview`.
- Backend-эндпоинт реализован в `AdminBillingController` (фаза 2.8 расширить): возвращает JSON с метриками.

| Метрика | Источник |
|---|---|
| MRR (₽/мес) | сумма `Subscription.monthlyPriceKopecks` для всех ACTIVE с `paymentMode=paid` и `billingPeriod=monthly` |
| ARR (₽/год) | MRR × 12 + сумма годовых платежей за последние 12 мес |
| Активных подписок | count ACTIVE paid |
| Бонусных подписок | count ACTIVE bonus |
| Демо-кабинетов | count DEMO |
| ARPU | MRR / count ACTIVE paid |
| Churn rate (за месяц) | count EXPIRED за последние 30 дней / (count ACTIVE paid + count EXPIRED за 30 дней) |
| Реф-выплат за месяц | сумма `ReferralPayout.amountKopecks` где `periodMonth=прошлый` |
| Реф-выплат pending | сумма pending |
| Конверсия demo → paid | count Org, ушедших из DEMO в ACTIVE paid за последние 30 дней / count DEMO 30 дней назад |

Простая визуализация — карточки + спарклайны (см. существующие dashboard-компоненты).

**DoD фазы 7:**
- [ ] `/admin/orgs/[id]/billing` корректно показывает подписку и позволяет активировать/продлить.
- [ ] При попытке активации без `paymentMode` или без `reason` — UI блокирует кнопку.
- [ ] `/admin/referrals` — master-detail работает, выплаты можно помечать paid.
- [ ] `/admin/billing-overview` отдаёт все 10 метрик, числа сходятся с прямым SQL-запросом (проверка на dev).
- [ ] `bun run typecheck`, `bun run lint`, `bun run build` зелёные.

---

### Фаза 8. Landing-beacon + finalize

Цель: реф-ссылка с landing работает, документация обновлена.

#### 8.1. JS-сниппет на landing

- Файл: `frontend/scripts/landing-referral-beacon.js` (или подходящая локация landing-проекта).
- Сниппет:
  1. На загрузке страницы: проверить `?ref=<slug>` в URL.
  2. Если есть: записать cookie `z_ref=<slug>` с `Max-Age=7776000` (90 дней), `SameSite=Lax`.
  3. Отправить POST `/api/v1/public/referral/attribution` с `{slug, fingerprint, referer}`.
  4. Если cookie уже стоит и slug совпадает — не отправлять beacon повторно (в той же сессии).
- В шапке страницы регистрации (если cookie стоит) — показать «Вас пригласил {имя реферала}» (получать по `GET /public/referrals/:slug/profile`).

#### 8.2. Сохранение fingerprint в Org при регистрации

- При создании Org из landing — передавать на backend `creatorFingerprint` (опциональный header или поле в body регистрации).
- В `OrgsService.createOrg` — сохранить fingerprint в `User.referralFingerprint` (новое поле, опциональное).
- Это используется в `ClientLinkService.handleSubscriptionActivatedPaid` для fallback-поиска атрибуции при отсутствии cookie на момент активации.

#### 8.3. Обновить `second-brain`

- Обновить [second-brain/01_projects/tariffs-and-entitlements.md](../../second-brain/01_projects/tariffs-and-entitlements.md):
  - tier_pro → tier_standard, упоминания basic/enterprise — снять.
  - Добавить раздел «Subscription / billing».
- Создать [second-brain/01_projects/billing.md](../../second-brain/01_projects/billing.md) — карта модулей billing/referrals/meetings-balance.
- Создать [second-brain/01_projects/referrals.md](../../second-brain/01_projects/referrals.md) — продуктовая логика реферальной программы.
- Обновить [second-brain/02_architecture/data-model.md](../../second-brain/02_architecture/data-model.md) — добавить 8 новых моделей.
- Обновить [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) — billing, referrals, meetings-balance.
- Обновить [second-brain/01_projects/api-layer.md](../../second-brain/01_projects/api-layer.md) — все новые эндпоинты.
- Обновить [second-brain/01_projects/admin.md](../../second-brain/01_projects/admin.md) — три новые админ-страницы.
- Обновить [second-brain/01_projects/ai-jobs.md](../../second-brain/01_projects/ai-jobs.md) и [second-brain/01_projects/workers-queues.md](../../second-brain/01_projects/workers-queues.md) — billing-cycle-cron, referral-payout-cron.

#### 8.4. Smoke-тест end-to-end

Полный сценарий на dev:
1. Создать реферала через `/referrals` (ИНН → реквизиты).
2. Открыть landing с `?ref=<slug>` — cookie стоит, beacon ушёл, ReferralAttribution создалась.
3. Регистрация новой Org — fingerprint сохраняется.
4. Через `/admin/orgs/:id/billing` super-админ активирует подписку с `paymentMode=paid`.
5. `ClientReferralLink` создан, `ReferralPayout` (pending) создан.
6. В кабинете реферала — клиент виден, баланс показывает 20 000 ₽ pending.
7. Cron 10-го числа (тестируем ручным запуском) — формируется PDF-документ.
8. Админ помечает payout `paid`.

**DoD фазы 8:**
- [ ] Cookie + beacon отрабатывают на landing.
- [ ] Smoke-сценарий end-to-end проходит без ошибок.
- [ ] Все файлы `second-brain/` обновлены.
- [ ] Ссылка на это ТЗ добавлена в [second-brain/index.md](../../second-brain/index.md).

---

## Edge-cases (из анализа, для self-check'а реализации)

| Кейс | Решение |
|---|---|
| Клиент в DEMO, ходил по реф-ссылке, потом оплатил | First-touch применяется в момент DEMO → ACTIVE paid. Реф-выплата идёт с первой реальной оплаты. |
| Клиент сначала на бонусе, потом перешёл на paid | ClientReferralLink создаётся только при первом `paymentMode=paid`. Бонусные месяцы не учитываются в выплатах. |
| Клиент оплатил год, через 3 мес добавил 5 сотрудников | Доплата = `5 × 1_000 × 9 × 0.80 = 36_000 ₽`. Реф-выплата за доплату НЕ начисляется (Invoice.items не содержит `kind='base'`). |
| Клиент оплатил месяц, добавил сотрудника 19-го | Pro-rata = `533 ₽ + 1_000 ₽ = 1_533 ₽`. В следующем цикле — 61 000 ₽. Реф-выплата 20 000 ₽ только за основной платёж следующего месяца. |
| Клиент уменьшил seats в середине месяца | `Subscription.seatsExtra` уменьшается со следующего цикла. В текущем периоде — ничего не возвращается, `MeetingsBalance` не уменьшается. |
| Клиент пропустил платёж, через 4 дня оплатил | PAST_DUE → ACTIVE paid (через `markPaid` админом). Новый Invoice → новый ReferralPayout 20 000 ₽. |
| Бонус закончился, клиент не оплатил | EXPIRED. Read-only (`feature.meeting.create` блокируется через `Subscription.status` guard). Накопленные `MeetingsBalance` НЕ сгорают (видны для расследования). |
| Реферал удалил свою Org (если была своя) | `Referral.ownerUserId` живёт на User, не на Org. Ссылки и выплаты продолжают идти. |
| Самореферал: владелец Org A создал ссылку, по ней привёл Org B | Разрешено. `ClientReferralLink { tenantId: orgB.id, referralId: refOfOrgA }` создаётся, выплаты идут. |
| Несколько Org у одного владельца | Каждая Org — своя Subscription, свой ClientReferralLink. Реферал получает с каждой Org независимо. |
| Возврат денег при недовольстве | Пропорционально неиспользованным дням текущего месяца. Доп. seats, накопленные встречи, реф-выплаты не возвращаются. Реализуется через ручной `void` Invoice + ручной refund (не в этом ТЗ — добавляем заметку в `/admin/orgs/:id/billing` позже). |
| Two concurrent `MeetingsController.create` на одной Org с `balance=1` | Защищается `SELECT ... FOR UPDATE` в `MeetingsBalanceService.consume`. Второй запрос получит 403 `meetings_balance_exhausted`. |
| Cron 10-го числа упал на полпути | Идемпотентность: cron находит payout'ы со `status=pending` без `payoutDocumentUrl`. Повторный запуск обработает только их. |
| Landing-beacon отправлен дважды | Дубликаты `ReferralAttribution` допустимы (это лог кликов). На first-touch берётся самый ранний в окне 3 мес. |
| User создал Referral, удалили User | `Referral.ownerUserId` — `onDelete: Cascade`. Реф-ссылки и атрибуции удалятся. **Открытый вопрос для будущего ТЗ**: возможно стоит делать soft-delete, чтобы не терять историю выплат. В этом ТЗ — `onDelete: Cascade`, согласовано принятым решением «реферал живёт независимо, но не переживает удаление аккаунта». |

---

## Связь с другими ТЗ

| ТЗ | Что нужно от него | Что предоставляет это ТЗ |
|---|---|---|
| **ТЗ #2 — Демо-режим** (`plans/tz/2026-05-25-demo-mode-tz.md`) | Контракт `DemoModeService.seed(tenantId)` и `DemoModeService.purge(tenantId)`. Бейдж «Режим демокабинета» в shell. Disabled-кнопки real-операций при `Subscription.status='DEMO'`. | Статус `DEMO` в `SubscriptionStatus`. Установка `Subscription { status: DEMO }` при создании Org (через `OrgsService.createOrg`). Вызов `DemoModeService.purge(tenantId)` при первом переходе в ACTIVE paid/bonus. |
| **ТЗ #3 — InnLookup** (`plans/tz/2026-05-25-inn-lookup-tz.md`) | Контракт `InnLookupService.lookupByInn(inn): Promise<{ legalName, ogrn, kpp, directorName, legalAddress }>`. Кэширование и fallback. | Поля `Org.inn/ogrn/kpp/directorName/legalAddress`. Использование `InnLookupService` при создании Org (через будущий `/onboarding` flow — не в этом ТЗ) и при создании `Referral` (валидация ИНН + автозаполнение реквизитов выплат). |
| **ТЗ #4 — Платёжный провайдер** (`plans/tz/2026-XX-XX-payment-provider-tz.md`) | Контракт `PaymentProviderService.charge({tenantId, amountKopecks, autoRenew})`, webhooks на успех/неуспех платежа. | Готовый FSM Subscription. Готовое событие `invoice.paid`, на которое подпишется будущий webhook-handler. Поле `Invoice.externalRef` для id транзакции. Готовый `BillingCycleCron`, который при наличии провайдера будет автоматически списывать. |

---

## Риски и ограничения

- **Гонки при списании баланса встреч.** Обязателен `SELECT ... FOR UPDATE` или Redis-лок per-tenant. Без этого две одновременные встречи могут уйти за `balance=0`.
- **Идемпотентность invoice.paid → ReferralPayout.** Подписчик должен проверять, что для этого `Invoice.id` payout ещё не создан. Иначе при ретраях event-bus'а получим дубли.
- **PDF в S3 для большого числа Org.** На начальном этапе нагрузка минимальна, но в перспективе нужен очередь генерации (через BullMQ). В этом ТЗ — синхронная генерация в `issueInvoice`, что приемлемо.
- **Cookie на нашем `?ref=<slug>` против блокировщиков.** Если cookie заблокирована — fallback на fingerprint. Если и его нет — атрибуция теряется, что приемлемо.
- **Аннуитет 192 000 ₽ за годовой контракт.** Большая разовая сумма. Возврат при отказе клиента в первый месяц — болезненный. Решение из анализа: «Возврат денег пропорционально неиспользованным дням». Реф-выплаты при возврате клиента НЕ списываются обратно (явно зафиксировано в анализе).
- **Округление копеек.** Все операции — целочисленные `Int` копейки. При выводе пользователю — деление на 100 и форматирование с пробелом-разделителем тысяч.

## Итог

_Заполняется по факту реализации._

---
date: 2026-06-08
type: tz
status: draft
owner: Сергей
related:
  - plans/analysis/2026-06-08-agents-roadmap-daily-reflection.md
  - plans/analysis/2026-06-08-value-stickiness-roadmap.md
  - plans/analysis/2026-06-08-dashboards-audit-per-board.md
  - docs/operations/feature-flags.md
  - docs/operations/prod-deploy-log.md
---

# ТЗ-1 «Доработка и переработка агентов и цепочек» — движок ежедневной пользы

## Цель

Превратить богатое сырьё графа в **ежедневное действие**: накопил → синтезировал → подсказал → напомнил → проверил, изменилось ли. Сейчас десятки агентов целят в руководителя, а движка ежедневного возврата для рядового почти нет; деньги/клиенты (приоритет №1) и контроль внедрения решений почти не превращены в дневной сигнал; каналы доставки физически выключены. Это ТЗ закрывает разрыв по приоритету **бизнес-ROI × дешевизна**.

## Контекст

Источники истины — два анализа (прошли по 2–3 состязательных прохода):
- [agents-roadmap-daily-reflection.md](../analysis/2026-06-08-agents-roadmap-daily-reflection.md) — 12 агентов, бизнес-приоритеты (деньги · исполнение · цели · люди · знания · фокус · улучшения), что есть/расширить/новое.
- [value-stickiness-roadmap.md](../analysis/2026-06-08-value-stickiness-roadmap.md) — эпики A/Д/B, волны W1–W4, движок A (польза команде) vs движок B (витрина владельцу), запреты на vanity-метрики.

**Ключевые код-якоря (верифицированы при написании ТЗ):**
- `conversational.service.ts:83-126` — `EVENT_TYPE_CHANNEL_POLICY` НЕ содержит `checkin.prompt` → DEFAULT `['in_app']` (чек-ины не уходят в Telegram).
- `operations-daily-digest.cron.ts:71-79` — Telegram гейтится отдельным `AdminSetting operations.daily_digest.deliver_to_telegram` (default **false**), `goals.pulse.deliver_to_telegram` — аналогично (default false, см. feature-flags.md).
- `daily-checkin-prompt.cron.ts:151-163` — `sendNotification({ eventType: 'checkin.prompt', … })` без `preferredChannelKinds`.
- `daily-digest.service.ts:346-359` — блокеры за день: `createdAt: { gte: dayStart, lte: dayEnd }` (lookback 1 день, без накопления/статусов).
- `dashboard/agents/goal-vector-tracker.cron.ts:277-305` — commitment kept/broken берёт `commitmentRecipientPersonId` (адресат), а должен `commitmentAuthorPersonId` (автор слова). `commitmentAuthorPersonId` (`schema.prisma:3133`) заполняется детерминированно по identity спикера, но **бывает NULL**.
- `schema.prisma:347` `enum SignalType` — содержит `pain · feature_request · objection · churn_risk · commitment · blocker(?) · knowledge_gap …`. **Отдельной модели `Customer` нет** — клиент = `Entity{type=customer}` (`schema.prisma:436-443`, `client` deprecated→`customer`), связь блок↔клиент через `IdeaBlockEntity` (`schema.prisma:3797`).
- `schema.prisma:7213` `ChatV2Message` — **нет** поля `helpful`; эталон фидбека — `AiResultFeedback` (`schema.prisma:6217`).
- `schema.prisma:5694` `Decision` — есть `actualOutcomes`, но агрегата «% доведённых» нигде нет.
- `schema.prisma:5951` `Idea` — `status(IdeaStatus)`, `supporters(Json)`, `goalId`, `createdByUserId`; нет `getTop`/виджета. `idea-clusterer.cron.ts`, `insight-clusterer.cron.ts` существуют.
- `schema.prisma:4514` `Person` — `riskFlagsJson`, `engagementScore`, `timezone`; `schema.prisma:4694` `Appointment.loadPercent`; `schema.prisma:6702` `KnowledgeRiskSnapshot`.

> **Чем эта работа НЕ является:** новые ML-прогнозы (хватает SQL-агрегаций), рейтинг «худших сотрудников» (этика — память НА сотрудника, не надзор), плодёж агентов ради агентов.

---

## Принятые решения (развилки уже закрыты в анализе — не переоткрывать)

| # | Решение | Обоснование (из анализа) |
|---|---|---|
| Р1 | Telegram-доставка чек-инов и дайджестов — **ON по умолчанию** (Ship-On, kill-switch ON, не OFF). | OFF нарушает CLAUDE.md §8 и убивает движок A. |
| Р2 | **Единый per-person дневной бюджет уведомлений** (cross-агент, ≤N сообщений/день суммарно по всем агентам), приоритезация, тихие часы 22–8 локального, опт-аут per-trigger. | Три источника пушей × «≤3/день» = ~9 пушей → mute/отписка. |
| Р3 | **Кампания привязки каналов** — отдельный приоритет-gate: **≥70% `Person` с verified telegram-binding** перед Ф2+. | Единая точка отказа всей зависимости: без binding — 0 доставок. |
| Р4 | `Customer` = `Entity{type=customer}` (deprecated `client` поглощён). Отдельную модель Customer не вводим. | Подтверждено по схеме. |
| Р5 | Фикс вектора `recipient→author` — **сначала измерить покрытие `commitmentAuthorPersonId` в проде**, при низком — fallback на recipient или добить identity. | Наивная замена молча выкинет обещания с NULL-автором. |
| Р6 | В витрину/recap — **только твёрдые данные.** Запрещены: часы×ставка=₽, было→стало до Коры, `medianHoursToAnswer` (эвристика), `roiScore`/`alignment` как KPI. Soft-цифры — с плашкой «оценка» + знаменателем. | Якорь честности §4 анализа. |
| Р7 | `count` решений/задач — **всегда в паре с «% доведённых до `actualOutcomes`»**; «без ответа» как колонка, не 100% при малом знаменателе. | count в одиночку = vanity. |
| Р8 | Личный экран рядового — **только self-scope**, без сравнения/рейтингов. | Этика. |
| Р9 | **Отложено** (в реестр не-сделанного): геймификация v2 (лиги/зёрна-валюта), клиентские идеи (`client_request`) closing-loop (нет `Customer.responsibleUserId`), «N знаний спасено» (CLONE_V2 выкл). | §9 анализа. |
| Р10 | Промпт/агентные правки **не гейтятся** golden/eval (реализуем→выкат→наблюдаем прод). Жёстко — typecheck + build. | MEMORY feedback. |

---

## Общие инварианты (для всех фаз)

- **Стек:** Bun + Node + TypeScript. Никакого Python в `backend/`.
- **Миграции Prisma:** только `prisma:migrate --name <…>` (файл в `prisma/migrations/`), НЕ `db push`. Все правки — **non-destructive** (только `null→value`, новые nullable-поля/таблицы, не ломать существующее).
- **Крутилки** (пороги, лимиты, бюджеты, ставки риска) — в `AdminSetting` через `TypedConfigService.getDynamic(key, ENV_FALLBACK, default)` + seed-скрипт, **не** в ENV-only и **не** хардкод в коде.
- **Флаги:** Ship-On — kill-switch ON по умолчанию; каждый новый флаг = строка в `docs/operations/feature-flags.md`.
- **DTO:** Zod (`nestjs-zod`) + Swagger на каждом эндпоинте; цепочка `ApiDto→DomainModel→UiModel` на фронте.
- **Скрипты:** `createPrismaClient()` из `backend/scripts/_lib/prisma.ts` (НЕ голый `new PrismaClient()`); seed/patch/backfill/migrate — регистрировать в `STEPS` массива `apply-prod-deploy.ts`.
- **LLM-промпты:** prompt registry + code-fallback; раздел «Совместимость с prompt caching» в каждой фазе с LLM (стабильный SYSTEM, переменные данные в конце user).
- **Метрики:** prom-client через `BusinessMetricsService`, по образцу существующих `coo_daily_digest_*`.

---

## Ф0. Базис доставки: каналы возврата + единый бюджет уведомлений + кампания привязки

> Без включённых каналов и без защиты от спама весь движок льётся в пустоту или в отписку. Это блокер для Ф1–Ф5.

### Scope
1. Включить Telegram для чек-инов (Механизм 1 — policy) и дайджестов COO/целей (Механизм 2 — AdminSetting-гейт). **Это два РАЗНЫХ механизма, не путать.**
2. Единый per-person дневной бюджет уведомлений (cross-агент) с приоритезацией, тихими часами, опт-аутом.
3. Кампания привязки каналов + метрика покрытия + gate ≥70% (как условие старта Ф2+).

### Изменения схемы (миграция `notification_budget_and_binding`)
- **`NotificationBudgetLedger`** (учёт дневного расхода per-person):
  - `id`, `tenantId`, `personId`, `dateLocal String @db.VarChar(10)`, `sentCount Int @default(0)`, `lastSentAt DateTime?`, `byTrigger Json` (`{ [eventType]: count }`), `createdAt`, `updatedAt`.
  - `@@unique([tenantId, personId, dateLocal])`, `@@index([tenantId, dateLocal])`.
- **`Person`** += `channelBindingCampaignState String? @db.VarChar(20)` (`null|invited|reminded|bound|opted_out`) + `channelBindingInvitedAt DateTime?` (non-destructive, nullable).
- **`Notification`** (`conversational`) += `priorityTier Int? @default(2)` (1=critical-business, 2=normal, 3=low) — для приоритезации внутри бюджета (nullable, default 2).

### Сервисы / воркеры / @Cron
- **`NotificationBudgetService`** (новый, в `conversational/`): метод `tryConsume({ tenantId, personId, eventType, priorityTier, critical, localTimezone }): { allowed: boolean, reason?: 'budget_exceeded'|'quiet_hours'|'opted_out' }`.
  - Лимит — `AdminSetting notifications.daily_budget.per_person` (default 5), `critical=true` (security/системные) бюджет игнорирует.
  - Тихие часы — `notifications.quiet_hours.start`/`.end` (default 22/8) по `Person.timezone`.
  - При переполнении — **не дропать молча**, а понижать в digest-очередь (дозбор в утренний дайджест следующего дня), приоритет 1 вытесняет приоритет 3.
  - Интеграция: `ConversationalService.sendNotification` вызывает `tryConsume` ПЕРЕД роутингом (после `ensureInAppForUser` — in_app остаётся всегда, бюджет режет только push-каналы).
- **`checkin.prompt` в policy:** `conversational.service.ts:83` `EVENT_TYPE_CHANNEL_POLICY` += `'checkin.prompt': ['telegram_bot','max_bot','in_app']`. `daily-checkin-prompt.cron.ts:151` — передавать `preferredChannelKinds` из настройки канала Person (если задан).
- **Дайджесты COO/целей:** seed AdminSetting `operations.daily_digest.deliver_to_telegram=true` и `goals.pulse.deliver_to_telegram=true` (Механизм 2 — гейт в самом cron, policy НЕ трогать).
- **`ChannelBindingCampaignCron`** (`@Cron('0 9 * * *')`, по `Org.timezone`-окну): находит `Person` с `userId IS NOT NULL` без verified telegram-binding → отправляет onboarding-приглашение привязать бота (через `ConversationalService`, eventType `system.message`, дедуп по `channelBindingCampaignInvitedAt`), напоминание через 3 дня, статус в `channelBindingCampaignState`. Master-flag `notifications.binding_campaign.enabled` (kill-switch ON).

### REST-эндпоинты (Zod-DTO + Swagger)
- `GET /api/v1/operations/binding-coverage` (owner/admin/coo) → `{ totalPersons, boundPersons, coveragePercent, gatePassed: boveragePercent>=70 }`. Источник `business-metrics`. Для админ-индикатора «кампания привязки».
- `PATCH /api/v1/me/notification-preferences` (self) → опт-аут per-trigger + тихие часы override. Расширение существующих preferences.

### Метрики (Prometheus)
- `notification_budget_consumed_total{trigger}` · `notification_budget_blocked_total{reason}` · `notification_deferred_to_digest_total`.
- `channel_binding_coverage_ratio{tenant_top}` (gauge) · `channel_binding_campaign_invited_total`.
- `checkin_prompt_delivered_total{channel}`.

### Флаги (строки в `docs/operations/feature-flags.md`)
- `notifications.daily_budget.enabled` — 🔴 A (kill-switch ON), бюджет уведомлений per-person.
- `notifications.binding_campaign.enabled` — 🔴 A (ON), кампания привязки каналов.
- `operations.daily_digest.deliver_to_telegram` — перевести из ⚪ Долг в 🔴 A (ON) — дайджест COO в Telegram.
- `goals.pulse.deliver_to_telegram` — перевести из ⚪ Долг в 🔴 A (ON).
- `checkin.prompt` policy — не флаг, фиксируется как изменение в conversational policy.

### DoD
- [ ] `checkin.prompt` уходит в Telegram (e2e: создать Person с verified binding → запустить `daily-checkin-prompt.cron.runOnce` в окне → проверить доставку).
- [ ] Дайджесты COO/целей доставляются в Telegram при ON-настройке.
- [ ] Бюджет режет ≤N push/день per-person, in_app не режется, critical обходит бюджет; тихие часы соблюдены по `Person.timezone`.
- [ ] `GET /binding-coverage` возвращает корректный процент; gate-флаг считается.
- [ ] typecheck + lint + build зелёные; unit на `NotificationBudgetService.tryConsume` (граница лимита, critical-bypass, quiet hours).
- [ ] Строки в feature-flags.md обновлены.

### Prod-шаги
- Миграция применится авто (`migrate deploy`).
- `seed-admin-setting-notification-budget.ts` (новый, register в STEPS phase `seed-base`): `notifications.daily_budget.per_person=5`, `notifications.quiet_hours.start=22`, `.end=8`, `notifications.daily_budget.enabled=true`, `notifications.binding_campaign.enabled=true`.
- `patch-enable-telegram-digests.ts` (новый, register STEPS phase `patch`, `skipBootstrap:true`): выставить `operations.daily_digest.deliver_to_telegram=true`, `goals.pulse.deliver_to_telegram=true` (только если не были тронуты владельцем — non-destructive upsert по `updatedByUserId IS NULL`).
- `docs/operations/prod-deploy-log.md` Шаг 1 (новые AdminSetting/флаги), Шаг 7 (новый seed), Шаг 6 (новый patch), Шаг 4 (миграция), Шаг 12 (smoke: новый cron `ChannelBindingCampaignCron`, новый эндпоинт `/binding-coverage`).

---

## Ф1. Радар клиентов и сделок под риском (деньги — высшая бизнес-ценность)

> Из продаж и чатбокса каждый день всплывают сигналы клиентов, но их никто не сводит к «кто недоволен / какая сделка горит». Самый дорогой пробел — это выручка.

### Scope
Дневной агент группирует `IdeaBlock(signalType ∈ {churn_risk, objection, pain, feature_request})` по `Entity{type=customer}` (через `IdeaBlockEntity`), накапливает по окну, ранжирует по риску денег, подсвечивает руководителю (раздел «Клиенты» в COO-дайджест) и менеджеру (по его клиенту), отслеживает динамику отток/приток.

### Изменения схемы (миграция `customer_risk_snapshot`)
- **`CustomerRiskSnapshot`** (дневной снимок риска по клиенту):
  - `id`, `tenantId`, `customerEntityId String` (FK→`Entity`), `dateLocal String @db.VarChar(10)`.
  - `signalCounts Json` (`{ churn_risk, objection, pain, feature_request }` за окно), `windowDays Int @default(14)`.
  - `riskScore Decimal @db.Decimal(8,4)` (взвешенная сумма: churn_risk×w1 + objection×w2 + …, веса из AdminSetting), `riskLevel String @db.VarChar(16)` (`critical|warning|ok`).
  - `topBlockIdsJson Json` (до 20 блоков-источников для drill-down), `responsiblePersonId String?` (если резолвится по EntityLink/сделке — иначе NULL).
  - `deliveredManagerAt DateTime?`, `snapshotAt DateTime @default(now())`.
  - `@@unique([tenantId, customerEntityId, dateLocal])`, `@@index([tenantId, riskLevel, snapshotAt(sort: Desc)])`, `@@index([tenantId, responsiblePersonId])`.

> Веса риска (`churn_risk` весомее `feature_request`), порог `critical`/`warning`, окно накопления — **AdminSetting**, не код.

### Сервисы / воркеры / @Cron
- **`CustomerRiskRadarService`**: `computeForTenant({ tenantId, dateLocal, windowDays })` — выбрать блоки нужных `signalType` за окно, сгруппировать по `customerEntityId` (через `IdeaBlockEntity`, роль `mentioned`/`subject`), посчитать `signalCounts`, `riskScore` (взвешенно), `riskLevel`; резолвить `responsiblePersonId` (по сделке/Project.customerCardId→owner или EntityLink `customer_facing`); upsert `CustomerRiskSnapshot`. Дельта к вчерашнему — для «приток/отток сигналов».
- **`CustomerRiskRadarCron`** (`@Cron('0 21 * * *')` глобально, как daily-digest): обход активных Org → `computeForTenant`; для `critical`/`warning` с `responsiblePersonId` — push менеджеру (eventType `proactive.notification`, priorityTier 1, через бюджет Ф0); агрегат — в COO-дайджест.
- **Мост в COO-дайджест:** `daily-digest.service.ts` += секция «Клиенты под риском» (топ-N по `riskScore`); рендер в `OperationsDailyDigestCron`.

### REST-эндпоинты
- `GET /api/v1/operations/customer-risk?level=&limit=` (owner/admin/coo) → список снимков с drill-down (signalCounts, topBlocks, динамика).
- `GET /api/v1/me/customer-risk` (self, для менеджера) → клиенты, где `responsiblePersonId = my Person.id`.

### LLM-промпты
- Промпт нужен **только** на финальную человекочитаемую формулировку подсказки менеджеру/руководителю (агрегация — чистый SQL/TS, без LLM). Prompt key `customer-risk-digest` (registry + code-fallback).
- **Совместимость с prompt caching:** SYSTEM стабильный («ты — операционный помощник, опиши риски клиентов кратко, без выдумок про рубли»); переменные данные (signalCounts, имена клиентов, блоки) — в конце user-сообщения. Без ₽-оценок (Р6).

### Метрики
- `customer_risk_snapshots_total{level}` · `customer_risk_radar_failed_total{reason}` · `customer_risk_manager_notified_total`.

### Флаги
- `operations.customer_risk_radar.enabled` — 🔴 A (kill-switch ON). Строка в feature-flags.md.

### DoD
- [ ] Cron строит снимки по тестовым данным (клиент с 2× churn_risk за неделю → `riskLevel=warning/critical`).
- [ ] Секция «Клиенты» появляется в COO-дайджесте; менеджер получает push по своему клиенту (через бюджет Ф0).
- [ ] Эндпоинты возвращают данные с drill-down; self-scope для менеджера не светит чужих клиентов.
- [ ] Веса/пороги читаются из AdminSetting (правка в админке меняет ранжирование без деплоя).
- [ ] typecheck + build зелёные; unit на `computeForTenant` (группировка + взвешивание + дельта).

### Prod-шаги
- Миграция (авто).
- `seed-admin-setting-customer-risk.ts` (STEPS phase `seed-base`): веса сигналов, пороги, окно, `enabled=true`.
- prod-deploy-log Шаг 4 (модель), Шаг 7 (seed), Шаг 12 (smoke: cron `CustomerRiskRadarCron`, эндпоинты `/operations/customer-risk`, `/me/customer-risk`).
- **Зависит от Ф0** (доставка + бюджет).

---

## Ф2. Движок рядового: «Твой день» + помощник «кто знает X»

> Все агенты целят в руководителя. Рядовой не получает ежедневной ценности — а это и есть источник зависимости снизу. **Стартует только после gate Ф0 ≥70% привязки (Р3).**

### Scope
1. **«Твой день»** — утренний персональный бриф: твои задачи/обещания на сегодня, открытые блокеры, что команда обещала тебе, 1 подсказка.
2. **Помощник «кто знает X»** — по блокеру/`knowledge_gap` сотрудника находит носителя через skill-профили (семантический поиск) и предлагает связаться.

### Изменения схемы (миграция `personal_daily_brief`)
- **`PersonalDailyBrief`** (идемпотентный снимок брифа per-person/день):
  - `id`, `tenantId`, `personId`, `dateLocal String @db.VarChar(10)`, `payloadJson Json` (задачи/обещания/блокеры/что-обещали-тебе/подсказка/skill-помощь), `deliveredAt DateTime?`, `openedAt DateTime?`, `createdAt`.
  - `@@unique([tenantId, personId, dateLocal])`, `@@index([tenantId, dateLocal])`.

> `openedAt` нужен и здесь, и в Д1-части (раздел Ф3) — единый паттерн «доставлено vs открыто».

### Сервисы / воркеры / @Cron
- **`PersonalDailyBriefService.buildFor({ tenantId, personId, dateLocal })`**: синтез из `Issue`/`Task` (assignee=Person.userId, due today/overdue) + `IdeaBlock(signalType=commitment, commitmentAuthorPersonId=personId, due today)` + открытые блокеры автора + `IdeaBlock(commitment, commitmentRecipientPersonId=personId)` («тебе обещали») + 1 подсказка (приоритетно — skill-помощь по открытому блокеру). Дедуп задач/обещаний при объединении источников (тот же класс, что в Ф3-фиксе).
- **`PersonalDailyBriefCron`** (`@Cron('0 * * * *')`, окно по `Person.timezone` утро): `buildFor` → push через бюджет Ф0 (eventType `proactive.notification`, priorityTier 2). Идемпотентность по `PersonalDailyBrief` unique.
- **`KnowsWhoService.findExpertsForBlocker({ tenantId, blockerText|blockId })`**: семантический поиск по skill-профилям (`Person.knowledgeProfile` / `PersonKnowledgeCategoryEmbedding`) → топ-3 носителя (исключая автора), confidence; для встраивания в бриф и для эндпоинта.
- **Событийная петля:** на `checkin.created`/новый `IdeaBlock(signalType=blocker|knowledge_gap)` автора — если найден носитель, добавить в следующий бриф «по твоему блокеру разбирается Иван» (без немедленного спама — копится в утренний бриф).

### REST-эндпоинты
- `GET /api/v1/me/daily-brief?date=` (self) → бриф (DomainModel из `payloadJson`).
- `POST /api/v1/me/daily-brief/:id/opened` (self) → проставить `openedAt`.
- `GET /api/v1/me/knows-who?blockId=|q=` (self) → носители по блокеру/вопросу.

> Снять RBAC-блок только для **self-scope** (по `Person.userId`), не открывая операционные данные рядовому (Р8).

### LLM-промпты
- Бриф — преимущественно структурный (SQL + шаблон). LLM только на «1 подсказку дня» — prompt key `personal-brief-hint` (registry + fallback).
- **Caching:** SYSTEM стабильный; переменные (список задач/блокеров) — в конце user. Семантический поиск «кто знает X» — embeddings (`text-embedding-3-small`), не chat-LLM.

### Метрики
- `personal_daily_brief_built_total` · `personal_daily_brief_delivered_total{channel}` · `personal_daily_brief_opened_total` · `knows_who_match_total{found}`.

### Флаги
- `operations.personal_daily_brief.enabled` — 🔴 A (ON). `operations.knows_who.enabled` — 🔴 A (ON). Строки в feature-flags.md.

### DoD
- [x] Бриф собирается per-person идемпотентно; задачи/обещания не задвоены при объединении источников.
- [x] Push приходит утром по `Person.timezone`, через бюджет Ф0.
- [x] `/me/knows-who` возвращает носителя по тестовому блокеру (исключая автора).
- [x] Self-scope: рядовой не видит чужих задач; RBAC не открыт лишнего.
- [x] typecheck + build зелёные; unit на `buildFor` (дедуп) и `findExpertsForBlocker` (исключение автора, порог confidence).

> **Статус (2026-06-08):** Ф2 РЕАЛИЗОВАНА. Файлы: `personal-daily-brief.{synth,service,service.spec,synth.spec}.ts`, `knows-who.{scoring,scoring.spec,service}.ts`, `personal-brief-hint.prompt.ts`, `workers/personal-daily-brief.cron.ts`, `controllers/my-daily-brief.controller.{ts,spec.ts}`, `dto/personal-daily-brief.dto.ts`; миграция `20260608150000_personal_daily_brief`; seed `seed-admin-setting-personal-brief.ts` (в STEPS); LLM triple-reg `personal-brief-hint`; 4 метрики; 2 флага в feature-flags.md; prod-deploy-log Ф2-блок. typecheck/build зелёные, 33 новых unit-теста + 212 operations без регрессий.

### Prod-шаги
- Миграция (авто). `seed-admin-setting-personal-brief.ts` (окно утра, флаги) — STEPS `seed-base`.
- prod-deploy-log Шаг 4, Шаг 7, Шаг 12 (cron `PersonalDailyBriefCron`, эндпоинты `/me/daily-brief`, `/me/knows-who`).
- **Зависит от Ф0 (gate ≥70% привязки).**

---

## Ф3. Исполнение: синтез блокеров + контролёр решений + каскад обещаний + фиксы достоверности

> Решили — внедряем или замяли? Что мешает команде с накоплением? И параллельно — три фикса достоверности, без которых цифры врут уже сейчас.

### Ф3.A — Накопительный синтез блокеров (НОВЫЙ)
**Scope:** дневной агент копит блокеры 7 дней, присваивает статус `new / recurring N days / resolved`, приоритизирует по бизнес-удару (блокер, задевающий клиента/дедлайн/деньги — выше бытового), мостит повтор в инсайт-радар.

**Схема (миграция `blocker_synthesis`):**
- **`BlockerSynthesis`**: `id`, `tenantId`, `clusterKey String` (стабильный ключ кластера блокеров), `representativeText`, `status String @db.VarChar(20)` (`new|recurring|resolved`), `firstSeenDateLocal`, `lastSeenDateLocal`, `daysOpen Int`, `businessImpactScore Decimal @db.Decimal(8,4)` (выше, если задевает customer/deadline/commitment), `relatedBlockIdsJson Json`, `linkedInsightId String?`, `responsiblePersonId String?`, `updatedAt`. `@@unique([tenantId, clusterKey])`, `@@index([tenantId, status, lastSeenDateLocal])`.

**Сервис/cron:** `BlockerSynthesisService` + `BlockerSynthesisCron` (`@Cron('0 22 * * *')`, после вечернего окна чек-инов): нормализовать `DailyCheckIn.blockersJson` + `IdeaBlock(signalType=blocker)` дня → дешёвый ratio-детект + embedding-кластеризация (как в Insight-радаре) → сопоставить с прошлыми днями (lookback 7д) → статус + `daysOpen` + `businessImpactScore`; LLM **только** на финальный абзац-сводку (prompt key `blocker-synthesis-summary`). Мост: при `recurring ≥ N days` — создать/связать `Insight` через `specialist-3-5-insights.service.ts`. Обратная петля рядовому: на `checkin.created` — «твой вчерашний блокер X всё ещё открыт» + «3 коллеги сегодня тоже уперлись» (через бюджет Ф0).

> Lookback (7д), порог `recurring`, веса бизнес-удара — AdminSetting. Заменяет 1-дневный срез `daily-digest.service.ts:346-359` (его оставить для дайджеста, но «хронические» брать из `BlockerSynthesis`).

### Ф3.B — Контролёр внедрения решений (НОВЫЙ/расширение)
**Scope:** ловить `Decision`, принятые N дней назад, под которые 0 задач / нет `actualOutcomes`; строить агрегат **«% решений, доведённых до результата»** (его НЕТ — это несущая метрика витрины Ф5, Р7).

**Схема (миграция `decision_implementation`):**
- **`Decision`** += `linkedTaskCount Int @default(0)` (денормализованный счётчик связанных задач, обновляется воркером), `implementationStatus String? @db.VarChar(24)` (`not_started|in_progress|done|stalled`), `implementationCheckedAt DateTime?` (nullable, non-destructive).
- Связь `Decision↔Task/Issue` — через существующие `sourceBlockIds`/`Entity` или новая join `DecisionTaskLink(decisionId, issueId, linkType, createdAt)` если прямой связи нет (проверить при картографии; предпочесть join-таблицу, чтобы не плодить массивы).

**Сервис/cron:** `DecisionImplementationCron` (`@Cron('0 6 * * *')`): для `Decision(status∈approved/implemented)` старше `decision.stale_days` (AdminSetting, default 21) с `linkedTaskCount=0 AND actualOutcomes IS NULL` → `implementationStatus='stalled'` + push ответственному (`decidedByPersonIds`) «решение X не двигается — создать задачи?» (eventType `proactive.notification`, priorityTier 1) + агрегат в COO-дайджест «5 решений не двигаются». Агрегатор `getDecisionThroughput(tenantId, from, to)` → `{ total, doneWithOutcomes, throughputPercent }` (для Ф5).

### Ф3.C — Каскад обещаний (расширение)
**Scope:** довести `PromiseNetworkAnalyzer` (weekly) до **дневной** подсветки критического каскада: «просроченное обещание Антона блокирует цель Маркетинга / задачу Маши».
**Реализация:** `PromiseCascadeService` поверх `PromiseNetwork`-данных; `PromiseCascadeCron` (`@Cron('0 8 * * *')`) — найти просроченные `commitment` (по `commitmentAuthorPersonId`), у которых есть исходящие зависимости (блокируют чужую задачу/цель) → дневной алерт автору («твоё обещание держит работу коллеги») + руководителю («срыв обещания X каскадит в цель Y»). Через бюджет Ф0.

### Ф3.D — Фиксы достоверности (Д1-часть, чинить ДО витрины)
1. **`goal-vector-tracker.cron.ts:277-305` recipient→author** (Р5): заменить `commitmentRecipientPersonId`/`commitmentRecipient` на `commitmentAuthorPersonId`/`commitmentAuthor`. **Под-шаг (обязательно перед заменой):** добавить во-время прогона метрику `commitment_author_coverage_ratio` (доля `commitment` с непустым `commitmentAuthorPersonId`); при покрытии < `goals.author_coverage_min` (AdminSetting, default 0.6) — **fallback на recipient** (с пометкой в логе), иначе чистый author. Не выкидывать обещания с NULL-автором молча.
2. **commitment «без ответа» / малый знаменатель** (Р7): в недельной сводке и в `reliabilityPercent` — отдельная колонка «без ответа» (`commitmentStatus='asked'` без реакции); **не показывать 100%** при `denominator < N` (AdminSetting `reliability.min_denominator`, default 3) — вместо процента «мало данных».
3. **probe/risk TODO-триггеры**: заполнить **детекцию** трёх заглушек (это TODO в `dashboard/agents/burnout-risk-detector.cron.ts` ~стр.21-25, 224, 242-246 — НЕ в `ProbeService`), точные имена флагов: `reply_latency_rise` (рост задержки ответа), `workload_overload` (`Appointment.loadPercent > порог`), `meeting_noshows` (повторные неявки). Флаги уже частично потребляются `people-at-risk.service` — фикс = заполнить логику детекции в cron, а не объявить тип. Пороги — AdminSetting.

### Изменения схемы (сводно по Ф3)
Миграции `blocker_synthesis`, `decision_implementation` (+ опц. `decision_task_link`). `goal-vector` и probe — без схемы (правка логики).

### REST-эндпоинты
- `GET /api/v1/operations/blockers/chronic?status=&limit=` (owner/coo) → хронические блокеры из `BlockerSynthesis`.
- `GET /api/v1/operations/decisions/throughput?from=&to=` (owner/coo) → `{ total, doneWithOutcomes, throughputPercent }`.
- `GET /api/v1/operations/decisions/stalled` (owner/coo) → решения без движения.

### LLM-промпты
- `blocker-synthesis-summary` (финальный абзац). Caching: стабильный SYSTEM, переменные блокеры в конце user. Контролёр решений и каскад — без LLM (SQL/граф).

### Метрики
- `blocker_synthesis_recurring_total{status}` · `decision_stalled_total` · `decision_throughput_percent` (gauge) · `promise_cascade_alert_total` · `commitment_author_coverage_ratio` (gauge) · probe-триггеры `probe_suggested_total{trigger}`.

### Флаги
- `operations.blocker_synthesis.enabled` · `operations.decision_controller.enabled` · `operations.promise_cascade.enabled` — все 🔴 A (ON). Строки в feature-flags.md.

### DoD
- [x] Блокер, упомянутый 4 дня подряд, получает `status=recurring, daysOpen=4` и мостится в Insight. (Ф3.A — `blocker-synthesis.{scoring,service}.ts`, unit-доказано)
- [x] Решение без задач старше N дней → `stalled` + push ответственному; `getDecisionThroughput` считает корректный %. (Ф3.B)
- [x] Каскад: просроченное обещание с зависимостью даёт дневной алерт автору и руководителю. (Ф3.C)
- [x] `goal-vector` использует author; `commitment_author_coverage_ratio` логируется; при низком покрытии — fallback (доказано unit-тестом с NULL-автором). **(Ф3.D — уже сделано ранее)**
- [x] Недельная сводка: колонка «без ответа», нет 100% при знаменателе < N. **(Ф3.D — уже сделано ранее)**
- [x] 3 probe-триггера срабатывают на тестовых порогах. **(Ф3.D — уже сделано ранее)**
- [x] typecheck + build зелёные.

> **Статус Ф3.A/B/C (2026-06-08):** РЕАЛИЗОВАНО. Файлы: `blocker-synthesis.{scoring,scoring.spec,service,service.spec}.ts` + `blocker-synthesis-summary.prompt.ts` + `workers/blocker-synthesis.cron.ts`; `decision-implementation.{scoring,scoring.spec,service,service.spec}.ts` + `workers/decision-implementation.cron.ts`; `promise-cascade.{scoring,scoring.spec,service,service.spec}.ts` + `workers/promise-cascade.cron.ts`; `dto/execution-agents.dto.ts`; 3 эндпоинта на `operations-dashboard.controller.ts`; мост `Specialist35Service.bridgeRecurringBlocker`. Миграции `20260608160000_blocker_synthesis` / `20260608160100_decision_implementation` / `20260608160200_decision_task_link`; backfill `backfill-decision-linked-task-count.ts` (STEPS); seed `seed-admin-setting-execution-agents.ts` расширен; LLM triple-reg `blocker-synthesis-summary`; 4 метрики; 3 флага в feature-flags.md; prod-deploy-log Ф3.A/B/C-блок. typecheck/build зелёные, 55 новых unit-тестов + 267 operations без регрессий.

### Prod-шаги
- Миграции (авто). `seed-admin-setting-execution-agents.ts` (пороги блокеров/решений/каскада/probe/author-coverage/reliability-min) — STEPS `seed-base`.
- `backfill-decision-linked-task-count.ts` (STEPS `backfill`, `skipBootstrap:true`) — заполнить `linkedTaskCount` по существующим решениям.
- prod-deploy-log Шаг 4, Шаг 7, Шаг 8 (backfill), Шаг 12 (3 cron + эндпоинты). **Зависит от Ф0; мост блокеров — в Ф4 (инсайт-радар).**

---

## Ф4. Улучшения и знания: лента идей + инсайты re-check + знание-под-риском + capacity + онбординг

### Ф4.A — Лента идей: ре-ранк + морфинг статуса + видимость владельцу (расширение)
**Scope:** `getTop` в `IdeasService` (аналог `insights.service.ts`), `/ideas/top` + виджет; авто-продвижение статуса идеи при закрытии связанной задачи (`idea.goalId`/`Task`); уведомление автору (`createdByUserId`) и supporter'ам при смене статуса, при `shipped` — recognition; idea-секция в недельный COO-дайджест.
**Реализация:** `IdeasService.getTop({ tenantId, limit })` (ре-ранк: `weight` + свежесть `lastDiscussedAt` + связь с целью `goalId`); событие закрытия `Task`/`Issue` → `IdeaStatusAutoAdvanceService` (`captured→…→shipped`); push автору (eventType `idea.status_changed`, уже в policy `['in_app']` → расширить до `['in_app','telegram_bot']` через бюджет Ф0). Виджет `IdeasTopWidget` рядом с `InsightsTopWidget`.

### Ф4.B — Инсайты-радар: re-check митигаций + «ты не один» (расширение)
**Scope:** активный re-check митигированных инсайтов по таймеру (`insight-clusterer.cron.ts`); структурировать `mitigationPlan` (steps + owner + deadline); employee-видимость «4 коллеги сегодня уперлись в то же, тема эскалирована».
**Реализация:** в `insight-clusterer.cron` — re-check `Insight(status=mitigated)` старше `insight.recheck_days` (AdminSetting): всплыл повтор → вернуть в `active`. Событие employee-видимости — добавлять в `PersonalDailyBrief` (Ф2) или push при пороге N коллег.

### Ф4.C — Знание-под-риском + уход человека (синтез двух сигналов)
**Scope:** синтез `KnowledgeRiskSnapshot(riskLevel=critical)` × `Person.riskFlagsJson`/`engagementScore`: «зона X на одном человеке, и он под риском ухода».
**Схема (миграция `knowledge_at_risk`):** `KnowledgeAtRiskSnapshot`: `id`, `tenantId`, `categoryName`, `soleExpertPersonId String?`, `busFactorLevel String`, `personRiskLevel String?` (из riskFlags), `combinedSeverity String @db.VarChar(16)`, `snapshotAt`. `@@index([tenantId, combinedSeverity, snapshotAt])`.
**Реализация:** `KnowledgeAtRiskCron` (weekly) — пересечение critical bus-factor (соло-эксперт) с активными high-severity risk-флагами носителя → подсветка руководителю «продублируй зону X / поговори». Носителю — **ничего** (этика).

### Ф4.D — Capacity-агрегат по командам (новый)
**Scope:** агрегат `Appointment.loadPercent` по командам/отделам: перегруз/недогруз, «перелить».
**Реализация:** `TeamCapacityService.aggregate({ tenantId })` (group by department, avg/max loadPercent, флаги overload/underload по AdminSetting-порогам) → COO-дайджест «команда A перегружена, B недозагружена». Зеркало meeting-ROI: к low-ROI встречам добавить «Кора зафиксировала N решений/задач».

### Ф4.E — Онбординг-рамп новичка (новый)
**Scope:** трекать нового `Person` (по `createdAt`/`relationship=employee`): дни до первого вклада/вопроса памяти; «Маша 5 дней, 0 обращений к памяти → подскажи бадди».
**Реализация:** `OnboardingRampCron` (daily) — окно онбординга по `Person.createdAt`, первые артефакты (`IdeaBlockEntity` subject) / вопросы (`ChatV2Message`) → если 0 за `onboarding.silent_days` (AdminSetting) → push руководителю «новичок не активировался» + новичку «спроси у памяти про X».

### Изменения схемы (сводно Ф4)
Миграции `knowledge_at_risk`; правки `Idea` (нет новых полей — status уже есть); `Insight.mitigationPlan` — структурировать в Json (поле есть, формализовать контракт без схемы). Виджеты — фронт.

### REST-эндпоинты
- `GET /api/v1/ideas/top?limit=` (owner/admin/coo) → топ идей.
- `GET /api/v1/operations/knowledge-at-risk` (owner/coo) → синтез bus-factor × burnout.
- `GET /api/v1/operations/team-capacity` (owner/coo) → загрузка команд.
- `GET /api/v1/operations/onboarding-ramp` (owner/coo) → активация новичков.

### LLM-промпты
- Без новых chat-LLM (агрегации SQL). Формулировки подсказок — переиспользовать digest-промпты с стабильным SYSTEM (caching сохранён).

### Метрики
- `ideas_top_served_total` · `idea_status_auto_advanced_total{to}` · `idea_status_changed_notified_total` · `insight_rechecked_total{reactivated}` · `knowledge_at_risk_total{severity}` · `team_capacity_overload_total` · `onboarding_ramp_stalled_total`.

### Флаги
- `ideas.feed.enabled` · `insights.recheck.enabled` · `operations.knowledge_at_risk.enabled` · `operations.team_capacity.enabled` · `operations.onboarding_ramp.enabled` — все 🔴 A (ON). Строки в feature-flags.md.

### DoD
- [ ] `/ideas/top` ре-ранкит; закрытие связанной задачи продвигает статус идеи; автор уведомлён; `shipped` → recognition.
- [ ] Митигированный инсайт при повторе возвращается в active; employee-видимость «ты не один» доставляется.
- [ ] Знание-под-риском синтезирует bus-factor × riskFlags; носителю ничего не уходит.
- [ ] Capacity-агрегат показывает перегруз/недогруз по командам.
- [ ] Онбординг-рамп ловит молчащего новичка.
- [ ] Поправка по коду: `whoShined` (реализован `daily-digest.service.ts:835+`, зелёный spec) и `InsightsTopWidget`/`insights.getTop` (существуют) в ЭТОМ ТЗ **не переделываются** — новый `IdeasService.getTop` (Ф4.A) делается по их образцу.
- [ ] typecheck + build зелёные.

### Prod-шаги
- Миграция (авто). `seed-admin-setting-knowledge-improvement-agents.ts` (пороги re-check/онбординга/capacity) — STEPS `seed-base`.
- prod-deploy-log Шаг 4, Шаг 7, Шаг 12 (новые cron + эндпоинты). **Зависит от Ф3 (авто-статус из закрытия задач), Ф0.**

---

## Ф5. Месячная рефлексия = value-recap (только твёрдые данные)

> Доказательство пользы владельцу (инструмент продления). Строим ПОСЛЕДНИМ — поверх наполненного и достоверного фундамента.

### Scope
Месячный агрегатор «что Кора сделала за месяц» + дельта к прошлому месяцу: **ведущая ось — «снятая рутина» (твёрдые счётчики)**, второй слой — 3–4 честных сигнала «команда работает лучше». Главный носитель — **push-first** (Telegram/email), экран — drill-down. Экспорт в слайды.

### Снятая рутина (твёрдые счётчики — из БД)
| Метрика | Источник |
|---|---|
| Встреч запротоколировано авто (с готовым AI-отчётом) | `Meeting`+`AiResult` |
| Задач/решений/договорённостей авто-извлечено | `Task`/`Decision`/`IdeaBlock(commitment)` |
| Статусов собрано дайджестом (доставлено) | `DailyCheckIn` + дайджест |
| Вопросов отвечено памятью с привязкой к источнику | `ChatV2Message` (answeredWithCitation) |
| Идей доведено до релиза | `Idea(status=shipped)` |

### «Команда лучше» (второй слой, с плашкой «оценка» + знаменателем)
`reliabilityPercent` обещаний (тренд) · helped-rate чата (палец вверх, со знаменателем) · `count` решений/задач **в паре с «% доведённых до `actualOutcomes`»** (из Ф3.B) · shipped-идеи.

**Запрещено наружу (Р6):** часы×ставка=₽ · было→стало до Коры · `medianHoursToAnswer` · `roiScore`/`alignment` как KPI · «N знаний спасено».

### Метрика чата (зависимость): поле «помог ли» на ChatV2Message
> Для honest helped-rate нужно поле оценки, которого нет (`schema.prisma:7213` — нет `helpful`). Включаем как несущую часть value-recap.
- **Схема (миграция `chat_v2_message_helpful`):** `ChatV2Message` += `helpful String?` (`'up'|'down'`), `helpfulAt DateTime?`, `helpfulComment String? @db.Text`. Эталон — `AiResultFeedback`.
- **Эндпоинты:** `POST /api/v1/chat-v2/messages/:id/feedback` (upsert по messageId+userId, проверка владения беседой), `DELETE` (снять). Сбор оценки **и в Telegram/in_app**, не только web.
- **Агрегатор `getChatUsageStats(tenantId, from, to)`:** `asked=count(role='user')`; `answeredWithCitation=count(role='assistant' AND citations IS NOT NULL AND jsonb_typeof(citations)='array' AND jsonb_array_length(citations)>0)`; `rated=count(helpful IS NOT NULL)`; `helpedUp=count(helpful='up')`; `helpedRate=helpedUp/rated` (НЕ /answered); `feedbackCoverage=rated/count(assistant)`. `answeredWithCitation` — **grounding-proxy, НЕ «дефлекция»**; при `rated<10` — скрывать % («мало данных»); дедуп ретраев <30с.

### Изменения схемы (сводно Ф5)
- Миграция `chat_v2_message_helpful` (выше).
- **`ValueRecapSnapshot`** (месячный снимок для дельты и `openedAt`): `id`, `tenantId`, `periodYm String @db.VarChar(7)`, `payloadJson Json`, `deliveredAt DateTime?`, `openedAt DateTime?`, `createdAt`. `@@unique([tenantId, periodYm])`.
- `openedAt`/клик на дайджест-моделях (digest, brief) — если ещё не добавлено в Ф2/Ф0, добить здесь.

### Сервисы / воркеры / @Cron
- **`ValueRecapService.build({ tenantId, periodYm })`** — агрегатор поверх `Decision` (+ throughput из Ф3.B), `Task/IdeaBlock(commitment)`, `CommitmentReliability`, `Idea(shipped)`, `getChatUsageStats`, `Meeting/AiResult`, снятая-рутина-счётчики; baseline = первый снимок при онбординге (без атрибуции продукту без контрольной группы).
- **`ValueRecapCron`** (`@Cron('0 7 1 * *')` — 1-е число месяца): обход Org → `build` → push-first (Telegram/email через бюджет Ф0, eventType `operations.weekly_digest`-стиль или новый `operations.monthly_recap`) → экран drill-down.

### REST-эндпоинты
- `GET /api/v1/operations/value-recap?period=YYYY-MM` (owner/coo) → recap (snapshot).
- `POST /api/v1/operations/value-recap/:id/opened` → `openedAt`.
- `GET /api/v1/operations/value-recap/:id/export?format=slides` → экспорт в слайды.
- `GET /api/v1/chat-v2/usage-stats?from=&to=` (owner/coo) → метрика чата.

### LLM-промпты
- `value-recap-narrative` (человекочитаемая сводка по твёрдым цифрам). Prompt key registry + fallback.
- **Caching:** SYSTEM стабильный («собери честную сводку, только твёрдые данные, без выдуманных рублей, soft-цифры помечай "оценка"»); переменные (счётчики месяца, дельта) — в конце user.

### Метрики
- `value_recap_built_total` · `value_recap_delivered_total{channel}` · `value_recap_opened_total` · `decision_throughput_percent` (из Ф3) · `chat_v2_feedback_total{reaction}` · `chat_v2_answered_with_citation_total{mode}`.

### Флаги
- `operations.value_recap.enabled` — 🔴 A (ON). `chat_v2.feedback.enabled` — 🔴 A (ON). Строки в feature-flags.md.

### DoD
- [ ] Recap собирается на твёрдых счётчиках; `count` решений идёт в паре с «% доведённых»; soft-цифры с «оценка» + знаменателем; никаких ₽/«до Коры».
- [ ] Палец вверх/вниз на ChatV2Message работает в web и Telegram/in_app; `getChatUsageStats` корректен (type-guard на citations-массив); % скрыт при `rated<10`.
- [ ] Push-first доставка владельцу; `openedAt` фиксируется; экспорт в слайды формируется.
- [ ] typecheck + build зелёные; unit на `getChatUsageStats` (формулы, type-guard) и `ValueRecapService.build` (дельта, отсутствие запрещённых метрик).

### Prod-шаги
- Миграции (авто). `seed-admin-setting-value-recap.ts` (флаги, окно) — STEPS `seed-base`.
- prod-deploy-log Шаг 4 (модели + поле `helpful`), Шаг 7, Шаг 12 (cron `ValueRecapCron`, эндпоинты `/value-recap`, `/chat-v2/messages/:id/feedback`, `/chat-v2/usage-stats`).
- **Зависит от Ф0, Ф1, Ф2, Ф3 (throughput), Ф4 (shipped-идеи).**

---

## Порядок реализации (волны)

| Волна | Фазы | Почему |
|---|---|---|
| W1 | **Ф0** + Ф3.D (фиксы достоверности: recipient→author, «без ответа», probe-триггеры) | Каналы + бюджет + кампания привязки — фундамент; искажения чинить до витрины. |
| W2 | **Ф1** (радар клиентов — высшая ценность, деньги) | После каналов — самый дорогой пробел. |
| W3 | **Ф2** (движок рядового) — после gate ≥70% привязки | Зависимость снизу. |
| W4 | **Ф3.A/B/C** (исполнение) | Контроль внедрения + блокеры + каскад. |
| W5 | **Ф4** (улучшения/знания) | Поверх наполненного. |
| W6 | **Ф5** (value-recap) | Витрина последней — агрегирует твёрдое из W1–W5. |

> Каждая фаза самодостаточна (tz-orchestrator берёт по одной). Межтзшные зависимости указаны явно в шапке каждой фазы.

---

## Реестр не-сделанного (добавить при старте реализации)

В `second-brain/04_не-сделано/README.md` (Р9):
- Клиентские идеи (`client_request`) closing-loop — нет `Customer.responsibleUserId`; клиент не узнаёт судьбу идеи. Кто разблокирует: владелец/модель Customer.
- Геймификация v2 (лиги/зёрна-валюта) — риск зависти/Goodhart; после валидации inflection-point.
- B4 «N знаний спасено» — до проверки CLONE_V2 на живых данных не заявлять.
- Поведенческая аналитика участников — скрыта до возврата word-timings из Vox (ТЗ-D).

---

## Итог

Реализовано целиком: **нет** (это контракт, не код). ТЗ покрывает движок ежедневной пользы по приоритету бизнес-ROI × дешевизна: Ф0 (доставка) → Ф1 (деньги) → Ф2 (рядовой) → Ф3 (исполнение + достоверность) → Ф4 (знания/улучшения) → Ф5 (витрина). **Поправка верификации по коду:** прежнее предположение анализа про «заглушки» неверно — `whoShined` и `InsightsTopWidget`/`insights.getTop` уже реализованы, в ТЗ-1 не переделываются (новый `IdeasService.getTop` — по их образцу); статус `QualityScore` проверяется в ТЗ-2 (дашборды). Развилки владельца закрыты разделом «Принятые решения». Что осталось за рамками — в реестре не-сделанного (Р9).

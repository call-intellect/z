---
type: tz
status: approved
feature: Кора v2 — финальная программистская роадмапа (24 sub-ТЗ в 4 фазах + конкретные миграции)
date: 2026-05-22
approved-date: 2026-05-23
approved-by: владелец продукта (sergrv80@gmail.com)
umbrella: true
supersedes: plans/tz/2026-05-21-second-brain-agents-umbrella.md (исторический; в архив на шаге подготовки)
parent: plans/analysis/2026-05-22-unified-product-architecture.md
related:
  - plans/analysis/2026-05-22-unified-product-architecture.md (продуктовая часть, ответы на вопросы, философия)
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md (исторический зонтичный, в архив на шаге подготовки)
  - docs/reference/llm-models-playbook.md
  - second-brain/01_projects/llm-providers-verified.md
---

# Финальная программистская роадмапа — Кора v2

> ⚠️ **REALITY CHECK (2026-05-23).** Этот документ написан **до** проверки реального состояния кода. После прогона 7 code-audit агентов оказалось, что **~60-70% заявленного уже реализовано**. Реальная оставшаяся работа — **~30% от исходного scope (≈14 sub-ТЗ вместо 24, ~22 новых Prisma-моделей вместо 37, ~12 новых frontend-страниц вместо 21)**.
>
> **Перед стартом реализации — обязательно открыть [`plans/analysis/2026-05-22-code-reality-deltas.md`](../analysis/2026-05-22-code-reality-deltas.md)** — сводная таблица фактической готовности по каждому sub-ТЗ + конкретные правки к каждому разделу этого файла + 6 критических багов (CRIT-1..CRIT-6) для исправления **в первую очередь** (включая bug-fix `ENTITY_TYPE_VALUES` в `block-ingest.prompt.ts:30-38`, без которого LLM не возвращает 7 новых Entity.type).
>
> **Что почти готово (можно вычеркнуть из активного scope):** α-1, α-6, β-2, β-3, β-4, β-5, γ-1 + 5 sub-ТЗ competitor-parity (A-E). **Готово на 90%:** α-4. **На 75%:** α-3. **На 60%:** α-7, β-1. **Целиком новое:** α-2 (доделки), α-5 (DialogService), α-8 (нормализация Role), α-9 (CompanyProfile+FunctionalDomain), α-10 (Admin LLM Economics), β-6, β-7, β-8, γ-2, γ-3, δ-1, δ-2, δ-3.
>
> **Точки конфликта с реальным кодом** (требуют решения «расширить vs переименовать vs создать рядом»): PersonRole→Appointment, Metric→KPI, Mission/Vision/Strategy→CompanyProfile, Process→ProcessTemplate, унификация двух admin-групп `(admin)/admin/*` и `(authenticated)/admin/*` **ДО** α-10. См. delta-документ для решений.
>
> **Реальная экономия:** ~30% от изначального scope. По sub-ТЗ ещё больше — 13 из 24 практически готовы.
>
> ---
>
> **Назначение.** Пошаговое инженерное ТЗ для разработчиков. Перевод продуктовой архитектуры (`2026-05-22-unified-product-architecture.md`) в фазы, sub-ТЗ, миграции, конкретные изменения схемы и кода.
>
> **Точка правды.** Если этот файл расходится с парной аналитикой — приоритет у аналитики (продуктовые решения). Если расходится с детализацией внутри sub-ТЗ — приоритет у этого файла (он зонтичный для всех sub-ТЗ Коры v2). **Если расходится с реальным кодом — приоритет у `code-reality-deltas.md`.**
>
> **Стиль.** Технически плотный, без воды. Каждое sub-ТЗ — отдельный документ; здесь — scope/входы/выходы/DoD/зависимости.
>
> **Принцип фазировки.** α/β/γ/δ — по архитектурной устойчивости и зависимостям, **не по сложности**. Каждая фаза заканчивается работающим контуром: после α продукт уже даёт ценность.

---

## Часть 1. Объём и фазы

### 1.1. Карта 24 sub-ТЗ

**Фаза α — устойчивый двигатель (10 sub-ТЗ).** После неё работает: omnichannel chat-v2 + dialog-layer + curation + 4 специалиста Слоя 3 (Project/Customer + Regulations + Role Map + Company/Department Profile) + полная админка LLM + юнит-экономика.

**Фаза β — социальные специалисты + замыкание петли + операционка (8 sub-ТЗ).** После неё работают: Telegram (zero-button), Knowledge Clone, Decisions Registry, Insights Radar, Ideas + полный Probe Agent, Experiment Tracker, Brand Voice Curator, PersonalRelation + Appointment + COO Operations Dashboard + DailyCheckIn.

**Фаза γ — мышление и единый UX (3 sub-ТЗ).** SkillProfile + ExecutablePersona + Clone API; Concierge Agent (сквозной UX); CrossFunctionalProcess + Handoff.

**Фаза δ — оркестрация и автономия (3 sub-ТЗ).** Orchestrator (для сложных research-задач); ProactiveWatcher; Voice Channel (ASR inbound + TTS outbound).

### 1.2. Что считается «полной готовностью»

После δ продукт готов к стабильному внедрению у клиента уровня enterprise. До этого момента продукт может выпускаться частями (после каждой фазы — продаваемый GA), но «единорог-готовность» — после δ-2 (ProactiveWatcher).

### 1.3. Параллелизм

Параллелизация sub-ТЗ возможна в рамках одной фазы по зависимостям из Приложения A парной аналитики. Конкретно:
- В α: α-1 (channels), α-2 (signalType), α-10 (admin LLM) — стартуют **параллельно** в день 1.
- α-3 ждёт α-2.
- α-4 ждёт α-1 и α-3.
- α-5 ждёт α-3 и α-1.
- α-6/α-7/α-8/α-9 ждут α-3 и α-4; параллельно между собой.

Граф зависимостей — Приложение C этого файла.

---

## Часть 2. Технические базовые правила (распространяется на ВСЕ sub-ТЗ)

### 2.1. Стек

- **Runtime:** Bun для dev/build, Node 20 для prod-runner. Команды — из `backend/` или `frontend/`.
- **Backend:** NestJS, PostgreSQL 16 + pgvector, Redis 7, LiveKit Server SDK, S3 SDK.
- **Frontend:** Next.js 14 App Router, React 18, LiveKit React Components, Radix UI, Tailwind, SWR.
- **Prisma:** **только `bun run prisma:push`**, никогда `prisma migrate*`.
- **AI:** см. `docs/reference/llm-models-playbook.md` для целевой карты, `second-brain/01_projects/llm-providers-verified.md` для verified-состояния.

### 2.2. Конфигурация

- Только через `TypedConfigService` + `env.schema.ts`. Никаких `process.env.*` в коде.
- Новые ENV — добавлять в `env.schema.ts` с Zod-валидацией и **defaults для dev**.
- Секреты (API keys, bot tokens) — через `TypedConfigService.getOrThrow`, не хардкодить.

### 2.3. Контракт специалиста (Слой 3) — §5 из исторического зонтичного остаётся в силе

Все 12 специалистов обязаны:
- Подписываться на конкретные signalType через очередь BullMQ `core.specialist-routing`.
- Карточка имеет `tenantId`, `entityId?`, `sourceBlockIds[]`, `confidence Decimal(4,3)`, `status`, `version`, `createdAt`, `updatedAt`.
- Проходить triage через `CurationService.triage(card)`.
- Эмитить probe-events через `ProbeService.suggest()`.
- Эмитить conflict-events через `ConflictService.report()`.
- Имплементировать `getCitations(blockIds)` для chat-v2.
- Репортить метрики `core_specialist_*`.
- Регистрироваться в RBAC `ResourceType`.
- Быть идемпотентным по `IdeaBlock.id` (jobId паттерн).
- Иметь `personSubjectIds[]` для будущей сборки SkillProfile.
- При создании нового LlmTaskType — `seed-llm-task-routes-<feature>.ts` с тремя provider'ами и ссылкой на playbook в комментарии.

### 2.4. Сквозные требования

- **Multi-tenancy:** все новые модели имеют `tenantId`; все API защищены `TenantGuard`.
- **RBAC:** каждая новая модель регистрируется в `RbacService.ResourceType`.
- **DataClass и privacy:** dataClass проставляется на карточке как `max` от блоков-источников; LlmRouter и Channels уже фильтруют.
- **Observability:** все воркеры/cron инструментированы метриками; все API логируют `tenantId`/`userId`/`requestId` через Pino.
- **Idempotency:** воркеры идемпотентны по jobId, API поддерживают `Idempotency-Key` header.
- **Retention:** новые модели подключаются к существующей retention-pipeline (Фаза 11 knowledge-core).
- **LLM provider routing:** трёхуровневая цепочка обязательна для каждого taskType (см. §3.7 исторического зонтичного, не меняется).

### 2.5. Промпты

Все промпты в коде — `// TODO(owner-product): согласовать` placeholders. Тексты — отдельный круг согласования. Хранятся в БД через `PromptRegistry` (уже реализовано в Phase A.5) с code-fallback.

### 2.6. Тестирование

- **unit:** vitest, обязательно для services / mappers.
- **integration:** vitest + testcontainers PostgreSQL, обязательно для воркеров и API.
- **e2e:** Playwright + MCP playwright уже подключён, для критичных user-flows.
- **smoke:** скрипты `backend/scripts/smoke-*.ts` для проверки внешних интеграций (LLM, S3, LiveKit, ASR).

### 2.7. Безопасность

- Никаких .env / секретов в Git (settings.local.json уже блокирует).
- Все мутирующие API под `TenantGuard` + RBAC.
- AES-256-GCM envelope-encryption для webhook-секретов (паттерн `common/crypto`).
- Argon2id для паролей пользователей.

### 2.8. UI-правила (для всех новых frontend задач)

Из UI-аудита (см. Часть 10), 12 правил-блокеров:
1. One-field-when-possible — если форма ≥3 полей, сначала пытаемся NL-поле + concierge fill-in.
2. Dropdown >20 опций → typeahead + AI top-3 suggestion.
3. Никаких confirmation-модалок для reversible (toast «Готово. [Отменить]» через Sonner).
4. Никаких `window.confirm()` / `alert()`.
5. Каждая страница имеет `<ConciergeSlot context={...}>`.
6. Каждая мутация имеет agent-equivalent через tool-use (или явное product-решение «нет»).
7. Wizards запрещены, кроме onboarding 0c.
8. Auto-suggestion вместо required field (owner/assignee/due-date pre-fill).
9. Статус-машины имеют cron-агент, предлагающий переходы.
10. `/dashboard` показывает «что важно сейчас», а не «что произошло».
11. Filters → NL-input first, structured filters под `Advanced`.
12. Каждая новая страница декларирует «что здесь автоматизировано» в JSDoc.

---

## Часть 3. Фаза α — 10 sub-ТЗ детально

### α-1. Conversational Channels Foundation (zero-button уточнение)

**Файл:** `plans/tz/2026-05-22-sba-alpha-1-channels-foundation-v2.md`

**Заменяет:** `plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md` (старый — в архив).

**Scope:**
- `ConversationalModule` как `@Global` в `backend/src/modules/conversational/`.
- Модели Prisma: `Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery`.
- Интерфейс `IChannel` (методы: `send`, `parseInbound`, `verifyConnectivity`).
- Адаптеры `InAppChannelAdapter`, `EmailSmtpChannelAdapter`, `EmailImapChannelAdapter` (опц.).
- **InboundMessage union — три типа:** `free_note` (заметка для ingest), `response` (ответ на probe), `chat_query` (вопрос chat-v2). **Тип `command` УБИРАЕТСЯ.**
- Routing-слой: per-user preferences + per-event-type policy + dataClass-фильтр.
- Universal linking flow (генерация кода в ЛК, верификация в боте через deep-link `?start=<token>` или голый код).
- API: `GET /api/v1/me/notifications`, `POST /api/v1/me/notifications/:id/respond`, `GET/PATCH /api/v1/me/channel-preferences`, `GET /api/v1/me/channels`, `POST /api/v1/me/channels/:kind/link-code`.
- UI: `/me/channels` (привязка), `/me/notifications` (центр).

**Контракты для других sub-ТЗ:**
- `ConversationalService.sendNotification(event)` (outbound).
- `ConversationalService.subscribeInbound(handler)` для слоёв 5/6.
- Событие `notification.responded` для Слоя 6.
- Событие `inbound.ingested` → новый `RawEvent`.

**DoD:**
- in_app канал работает (probe → пользователь видит → отвечает).
- email_smtp канал работает (outbound).
- email_imap опц. (если нет — фиксируем как «не входит»).
- Linking flow работает: код → deep-link `?start=` или голый код.
- **Никаких inline_keyboard / callback_query / BotCommand'ов** в outbound (готовим базу для β-1).
- Тесты: unit (адаптеры), integration (linking flow).

---

### α-2. Layer 1 — Marking Extension

**Файл:** `plans/tz/2026-05-22-sba-alpha-2-layer1-marking-extension.md`

**Заменяет:** `plans/tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md`.

**Scope:**
- Расширение enum `IdeaBlock.signalType` — добавление **25+ значений**:
  ```
  fact · idea · decision · regulation · process_step · reasoning · rationale ·
  decision_basis · expertise · experience · hypothesis · result · lesson ·
  content_artifact · brand_principle · commitment · commitment_status ·
  plan_item · done_item · blocker · team_friction · process_friction ·
  resource_gap · pain · risk · suggestion · client_request · question ·
  competence · methodology_step
  ```
- `BlockExtractionService` — JSON Schema strict обновляется, prompt template (placeholder) учитывает новые типы.
- Reasoning-подтипизация — **один проход** с расширенным prompt (cost-оптимизация, см. ответ 4.6.1).
- Patch-script для бэкфила существующих блоков (опциональный, через `--update-existing` flag).
- Новый LlmTaskType `block-ingest-v2` (старый помечается deprecated) — placeholder промпт.

**Входы:** существующий `BlockExtractionService`, `LlmRouterService`.

**Выходы:** `IdeaBlock` с расширенным `signalType`. Контракт для α-3 (axis-classifier) и α-6..α-9 (специалисты).

**DoD:**
- Все 25+ signalType работают в JSON-mode.
- Тесты на 10 показательных кейсов из реальных встреч.
- Patch-script готов, но не запущен (запуск решается на этапе α-3 миграции).

---

### α-3. Layer 2 — Ontology Extension (4 оси, RouterService, axis-classifier)

**Файл:** `plans/tz/2026-05-22-sba-alpha-3-layer2-ontology-extension-v2.md`

**Заменяет:** `plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md`.

**Scope (расширенный):**
- Расширение enum `Entity.type` до **14 значений**: `person | customer | vendor | project | product | document | goal | event | topic | location | technology | metric | market | org_unit`. Удаление `custom`.
- Patch-script: rename `client → customer` (миграция данных через `bun run`).
- Новые модели категории A: `Vendor`, `Event`, `Market`, `OrgUnit` (с `entityId` для связки в графе).
- Расширение существующих моделей категории A полем `entityId`: `Person`, `Goal`, `Document`, `Product`, `Card` (уже имеет с Фазы 4).
- Расширение `EntityResolutionService` на новые типы (доменные правила дедупа).
- **Новый `AxisClassifierService`** — отдельный LLM-step `axis-classify` (taskType, новый):
  ```ts
  interface AxisClassification {
    who: { entityId: string, role: 'author'|'subject'|'mentioned'|'beneficiary' }[]
    functional: { domainId: string, confidence: number }[]  // 1..N
    contextual: { entityId: string, type: 'customer'|'project'|'market'|'event', role: 'about'|'mentioned' }[]
    temporal: { validFrom?: Date, validUntil?: Date, eventDate?: Date }
  }
  ```
  Срабатывает после `block-ingest`, до `RouterService.dispatch`. Гибрид: дешёвая модель primary (qwen3.5:9b Ollama), DeepSeek-flash secondary.
- **Новый `RouterService`** — диспатчер атомов к специалистам Слоя 3 на основе `signalType` + axis-классификации + контекста. Гибрид: статический mapping для 90% + LLM-fallback `router-dispatch-llm` для unmatched/неоднозначных (5-10%).
- **Fan-out маршрутизация** — один IdeaBlock → 1..N специалистов (не один). Очередь BullMQ `core.specialist-routing` с per-target jobId (избегаем дублей: jobId = `${specialist}_${blockId}`).
- Применение `postgres-init.sql` (HNSW индексы для embedding'ов новых типов через generic-pattern).

**Входы:** α-2 (signalType), существующие knowledge-core модели.

**Выходы:**
- Полная онтология категорий A/B/C доступна.
- `AxisClassifierService.classify(block)` — контракт.
- `RouterService.dispatch(block, classification)` — контракт.

**DoD:**
- 14 типов Entity работают.
- Patch-script `migrate-entity-custom-to-topic.ts` готов и выполнен.
- Axis-classifier работает на тестовом наборе с precision ≥ 0.85 по каждой оси.
- RouterService fan-out работает: тестовый блок про CMO в Сбере → летит в Person/Role/Customer/FunctionalDomain специалистов.

---

### α-4. Layer 4 — Curation Foundation + ConsistencyChecker + completeness

**Файл:** `plans/tz/2026-05-22-sba-alpha-4-layer4-curation-foundation-v2.md`

**Заменяет:** `plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md` (расширяется).

**Scope (расширенный):**
- Модели: `CurationItem`, `CurationDecision`, `ConflictItem`, `CardVersion`, `CuratorAssignment` — как в исходном.
- **+ Новая модель `CompletenessSlot`** — first-class представление незаполненных обязательных слотов:
  ```
  CompletenessSlot(id, tenantId, parentCardType, parentCardId,
                   slotName, slotKind ('required'|'optional'),
                   filledAt?, filledBy?, lastProbedAt?,
                   probeAttempts Int default 0)
  ```
  Заполняется автоматически воркером `CompletenessScannerCron` при создании/изменении нормативной карточки.
- **+ Новый `ConsistencyCheckerCron`** — структурные несостыковки графа (раз в 4 часа):
  - артефакт без процесса-источника
  - шаг без выхода / без ответственной роли
  - функция в Role без привязанного процесса
  - зона ответственности без метрики
  - сквозной процесс без описания Handoff между отделами
  - CompanyProfile без слота Mission/Vision/Strategy
  - и т.д. (полный список — в sub-ТЗ)

  Эмитит probe-events.
- **+ Расширение CurationDecision** — новые типы `mark_as_misleading` (для Skill), `merge_categories` (для эмерджентных Skill-categories), `escalate` (передать другому куратору).
- `CurationService.triage(card)` — три уровня по порогам из org-config.
- `CuratorRoutingService` — выбор куратора по `CuratorAssignment`.
- Conflict resolution `evolving` — обязательно реализован, не отложен.
- Stale-detection cron + dynamicScore decay (расширение существующего `reframing.cron`).
- API:
  - `GET /api/v1/curation/queue`, `POST /api/v1/curation/items/:id/decide`.
  - `GET /api/v1/curation/conflicts`, `POST /api/v1/curation/conflicts/:id/resolve`.
  - `GET /api/v1/curation/completeness-slots` (для виджета «что нужно достроить»).
  - `GET/PATCH /api/v1/settings/curation` (per-org пороги).
- UI:
  - `/curation` (master-detail) с фильтрами level/status/resourceType + bulk-actions «принять все с confidence ≥ 0.9» (см. UI-аудит 2.12).
  - inline-виджет `<CurationBanner>` для встраивания.
  - dashboard-виджет «N pending».
- Интеграция с ConversationalModule — probe-нотификации куратору через channels.
- Метрики `curation_*`, расширение RBAC.

**Входы:** ConversationalModule из α-1.

**Выходы:** `CurationService.triage()`, UI и API для кураторской работы, completeness-механизм.

**DoD:**
- triage с порогами работает.
- evolving resolution применяется на тестовом наборе temporal-фактов.
- CompletenessSlot создаётся для тестовой Regulation/Process/CompanyProfile.
- ConsistencyChecker эмитит probe-events на тестовом графе.

---

### α-5. Layer 5 — Chat-v2 + DialogService (контекстуализация + multi-query + summarizer + classifier + evolving temporal)

**Файл:** `plans/tz/2026-05-22-sba-alpha-5-layer5-chat-v2-with-dialog.md`

**Заменяет/расширяет:** `plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md`.

**Scope (значительно расширенный):**
- Новый модуль `chat-v2/` в `backend/src/modules/chat-v2/` — `ChatV2Service` как раньше.
- **+ Новый модуль `dialog-layer/`** в `backend/src/modules/dialog-layer/` — препроцессор:
  - `DialogService.process({ userMessage, conversationId })` возвращает `{ standaloneQuestion, intent, complexity, queries[] }`.
  - `ContextualizerService` — восстанавливает standalone вопрос (taskType `dialog-contextualize`, дешёвая модель).
  - `ConfidenceEstimatorService` — мини-шаг после контекстуализации (taskType `dialog-confidence`, очень дешёвая модель).
  - `QueryClassifierService` — гибрид эвристика + LLM-fallback (taskType `dialog-classify`, эвристика first).
  - `MultiQueryExpansionService` — 3 переформулировки (taskType `dialog-multi-query`).
  - `ConversationSummarizerCron` — сжимает старые сообщения в `Conversation.summary` text (когда messages > 12), оставляет окно последних 6.
- `ChatV2Service` поверх knowledge-core: гибридный поиск (cosine + BM25) + графовый обход + чтение карточек специалистов.
- **+ Поддержка temporal queries** — фильтр `validAt: Date` в запросе. При retrieval из карточек с evolving-цепочкой — выбираем версию с `validFrom ≤ validAt ≤ validUntil`.
- Три уровня ответа: `factual`, `synthetic`, `clone-style` (последний — задел под γ).
- Provenance через `IdeaBlockEvidence` — обязательно, на каждое утверждение `[BLOCK:id]`.
- `org-scope` + `personal-scope`.
- API:
  - `POST /api/v1/chat-v2/messages` — основной.
  - `GET /api/v1/chat-v2/conversations/:id`.
  - `POST /api/v1/chat-v2/conversations/:id/reset-context`.
- Omnichannel: ChatV2 регистрируется как handler `subscribeInbound('chat_query')` в ConversationalModule. Inbound из любого канала (text/voice-after-ASR/document-summary) → DialogService → ChatV2 → ответ через тот же канал.
- UI: страница `/chat-v2` (master-detail), встроенный виджет `<ChatPanel>` для других страниц.
- Старый `chat/` помечен `@deprecated`, миграция UI в δ-фазе.
- **+ Кэширование:** `AnswerCache` (Redis, TTL 24h) на standalone-question + tenantId + userId; `RetrievalCache` (Redis, TTL 1h) на standalone-question → blockIds[]. Invalidation при изменении источников.
- LlmTaskType: `chat-v2-synthesize`, `chat-v2-cite-select`, `dialog-contextualize`, `dialog-confidence`, `dialog-classify`, `dialog-multi-query`, `dialog-summarize`.

**Входы:** knowledge-core, ConversationalModule из α-1, расширения категории A из α-3.

**Выходы:** AI-чат компании доступен через все каналы с правильной контекстуализацией.

**DoD:**
- Тест «А сколько это стоит?» после диалога про конкретный продукт → standalone-вопрос с продуктом → правильный ответ.
- Multi-query expansion даёт recall ≥ 85% на тестовом наборе.
- Temporal queries работают на evolving-цепочке.
- Cache hit rate ≥ 30% на повторных тестовых запросах.
- Все 6 dialog-layer taskType зарегистрированы с тройной цепочкой provider'ов.

---

### α-6. Specialist 3.4 — Project/Customer Context (эталонный референс §5)

**Файл:** `plans/tz/2026-05-22-sba-alpha-6-specialist-3-4-project-customer-v2.md`

**Заменяет:** `plans/tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md`.

**Scope:**
- Развитие существующего `card-rollup-v2.worker` до полного контракта специалиста (§5).
- Расширение `Card.kind` под `vendor` (новая категория A) + `market`.
- Подключение к `CurationService.triage()` для новых rollup'ов.
- 5 probe-trigger'ов: «нет account_manager», «нет deadline», «два проекта похожи — merge?», «нет owner отдела», «vendor без category».
- Conflict-events: «закрыт ↔ активен».
- Поддержка `chat-v2.getCitations()`.
- Метрики `core_specialist_*{type='card'}`.
- Patch backfill `CardVersion(v1)` для существующих карточек.
- Депрекейт `Card.kind='custom'` (миграция в `topic`).

**DoD:**
- Воркер проходит контракт §5.
- 5 probe-trigger'ов работают на тестовом наборе.
- Conflict-events эмитятся.
- Эталонный sub-ТЗ для всех последующих специалистов.

---

### α-7. Specialist 3.1 — Regulations + ProcessTemplate + Handoff (фундамент)

**Файл:** `plans/tz/2026-05-22-sba-alpha-7-specialist-3-1-regulations-v2.md`

**Заменяет/расширяет:** `plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md`.

**Scope (расширенный, включает ProcessTemplate + Handoff):**
- Расширение модели `Regulation` (из исходного sub-ТЗ): `kind ∈ ('regulation'|'policy'|'standard'|'principle'|'methodology')` — `principle/methodology` — новые из ответа 4.3.3.
- + `Regulation.methodologyType?` enum (`принцип`, `методика`, `чек-лист`, `подход`) когда `kind ∈ ('principle','methodology')`.
- + Поле `Regulation.completeness Decimal(4,3)` first-class (см. α-4 CompletenessSlot).
- **Новая модель `ProcessTemplate`** (отдельно от Regulation, см. ответ 4.2.2):
  ```
  ProcessTemplate(id, tenantId, name, ownerEntityId?,
                  regulationId? → Regulation,
                  inputs Json, outputs Json,
                  currentVersionId? → ProcessTemplateVersion,
                  completeness Decimal(4,3),
                  status, entityId?, sourceBlockIds[], confidence, ...)
  ```
- **Новая модель `ProcessTemplateVersion`** (см. ответ 4.1, ADD-3):
  ```
  ProcessTemplateVersion(id, templateId → ProcessTemplate, versionNumber,
                          steps Json (ordered),
                          changedAt, changedByPersonId?, changeReason?,
                          replacedVersionId?, validFrom, validUntil?)
  ```
- **Новая модель `ProcessStep`**:
  ```
  ProcessStep(id, templateVersionId → ProcessTemplateVersion, orderIndex,
              name, ownerRoleId?, inputArtifactIds[], outputArtifactIds[],
              decisionPointIds[] → DecisionPoint, expectedDuration?)
  ```
- **Новая модель `DecisionPoint`** (см. ответ 4.1, RES-1):
  ```
  DecisionPoint(id, processStepId? → ProcessStep, name, description,
                possibleOutcomes Json, requiredFactorIds[],
                authorityBoundaryId? → AuthorityBoundary)
  ```
- **Новая модель `ProcessHandoff`** (см. ответ 4.1, RES-4):
  ```
  ProcessHandoff(id, fromProcessId, toProcessId, payloadDescription,
                 format, frequency, ownerRoleId?, typicalFailures Json)
  ```
- Воркер `regulation-detector.worker` — consumer `core.specialist-routing` для `signalType='regulation'/'process_step'/'methodology_step'`.
- Воркер `process-detector.worker` — отдельный для process_step.
- Дедупликация регламентов: один регламент = одна каноническая карточка с версиями.
- Извлечение шагов процесса (для `kind='process'`) как структурированных полей.
- Подключение к ConversationalModule — `mark_for_owner_review`.
- 4 probe-trigger'а (missing_owner / process_no_steps / stale / scope_unclear) + 3 новых для ProcessTemplate (missing_input_artifact / missing_output_artifact / step_without_owner).
- Conflict-events через `ConflictService`.
- Поглощение каркаса 5 уровней из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md) — миграция данных через one-off patch `migrate-phase-0b-to-regulations.ts`.
- API:
  - `GET/POST /api/v1/regulations`, `GET /api/v1/regulations/:id`, `GET /api/v1/regulations/:id/history`, `POST /api/v1/regulations/:id/supersede`.
  - `GET/POST /api/v1/processes` (ProcessTemplate), `GET /api/v1/processes/:id/versions`, `GET /api/v1/processes/:id/handoffs`.
- UI:
  - `/regulations` (master-detail с фильтрами по kind/owner/scope) — расширение существующего.
  - `/processes` — новая страница (master-detail с timeline версий).
- RBAC: `regulation`, `process_template`, `process_handoff`, `decision_point` ResourceType.
- LlmTaskType: `regulation-extract`, `regulation-dedupe`, `process-steps-extract`, `process-handoff-detect`, `decision-point-identify`.

**DoD:**
- Regulation, ProcessTemplate, ProcessVersion, ProcessStep, ProcessHandoff, DecisionPoint созданы.
- Воркеры работают идемпотентно.
- Patch миграции 0b выполнен.
- UI `/regulations` и `/processes` работают.

---

### α-8. Specialist 3.8 — Role Map Builder + Phase 0 поглощение

**Файл:** `plans/tz/2026-05-22-sba-alpha-8-role-map-foundation.md`

**Новый. Поглощает Phase 0a/0d из `plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`.**

**Scope:**
- Расширение модели `Role` до полной карты должности (9+ слотов):
  ```
  Role(id, tenantId, name, missionStatement?, departmentId?,
       maturityScore Decimal(4,3), entityId?, ...)
  ```
- **Новая модель `RoleProfile`** (наблюдаемая карта роли в этой компании):
  ```
  RoleProfile(id, roleId → Role, builtAt, builderAgentVersion,
              observationCount, completeness Decimal(4,3))
  ```
- **Новая модель `ResponsibilityElement`** (см. ответ 4.1, SIM-1):
  ```
  ResponsibilityElement(id, roleId → Role, parentElementId? (self),
                         kind ('outcome'|'function'|'activity'),
                         statement, orderIndex,
                         relatedKpiIds[], relatedProcessTemplateIds[],
                         sourceBlockIds[], confidence)
  ```
  3 уровня (`outcome → function → activity`) через self-reference + kind.
- **Новая модель `AuthorityBoundary`** (см. role-map-gap §3.6):
  ```
  AuthorityBoundary(id, roleId → Role, scope, statement,
                    boundary ('decides_alone'|'consults'|'escalates'|'executes_only'),
                    thresholdJson? (например {amount: {gt: 100000}}),
                    sourceBlockIds[], confidence)
  ```
- **Новая модель `RequiredKnowledge`** (см. role-map-gap §3.8):
  ```
  RequiredKnowledge(id, roleId → Role, knowledgeAreaName,
                    importance ('critical'|'important'|'nice-to-have'),
                    sourceBlockIds[], confidence)
  ```
- **Новая модель `DecisionPolicy`** (см. ответ 4.2.7):
  ```
  DecisionPolicy(id, roleId → Role, trigger, factorsJson, heuristic,
                  typicalOutcome, sourceBlockIds[], confidence)
  ```
- **Новая модель `KPI`** (расширение существующего, если есть):
  ```
  KPI(id, tenantId, name, targetValue, unit, frequency,
      attachedToResponsibilityElementId?, attachedToRoleId?, attachedToDepartmentId?,
      currentValue?, lastMeasuredAt?)
  ```
- **Новая модель `Interaction`** (см. role-map §2 слот «Взаимодействия»):
  ```
  Interaction(id, fromRoleId → Role, toRoleId → Role,
              kind ('transfers'|'depends_on'|'coordinates'|'escalates_to'|'manages'),
              context, frequency, sourceBlockIds[])
  ```
- **Новая модель `Appointment`** (см. ответ 4.1, ADD-6):
  ```
  Appointment(id, personId → Person, roleId → Role, departmentId? → Department,
              validFrom Date, validUntil? Date,
              loadPercent Int default 100,
              status ('active'|'former'|'acting'),
              createdAt, updatedAt)
  ```
- **Воркер `role-map-builder.worker`** — consumer `core.specialist-routing` для блоков, классифицированных axis-classifier как `who.role.subject` + `signalType ∈ ('rationale','decision_basis','expertise')`. Порог N=5 наблюдений для уверенного добавления элемента.
- Cron `role-map-rebuild.cron` (каждые 4 часа) — пересборка профилей при изменениях.
- Probe-events: «карта должности X не имеет цели», «функция Y без процесса», «нет KPI на зону Z».
- Расширение `EntityLink.relationType` на 9 новых: `transfers_result_to`, `depends_on`, `coordinates_with`, `escalates_to`, `manages`, `collaborates_with`, `mentors`, `conflicted_with`, `reports_to`.
- API:
  - `GET /api/v1/roles/:id/map` — полная карта должности.
  - `GET /api/v1/roles/:id/maturity` — индикатор зрелости.
  - `GET/POST /api/v1/appointments`, `PATCH /api/v1/appointments/:id` (end).
- UI:
  - `/roles/[id]/map` — карта должности (9 слотов как карточки + maturity bar).
  - `/persons/[id]/appointments` — история назначений.
- RBAC: `role_profile`, `responsibility_element`, `authority_boundary`, `required_knowledge`, `decision_policy`, `kpi`, `interaction`, `appointment` ResourceType.
- LlmTaskType: `role-map-extract`, `responsibility-element-detect`, `authority-boundary-detect`, `decision-policy-detect`, `appointment-detect`.

**Входы:** α-2 (signalType reasoning/rationale), α-3 (axis-classifier), α-4 (Curation), α-7 (ProcessTemplate для связки с functions).

**DoD:**
- Все 8 моделей созданы.
- Воркер собирает карту должности из 50+ тестовых блоков.
- Maturity Score считается per Role.
- UI `/roles/[id]/map` показывает все 9 слотов.

---

### α-9. Specialist 3.12 — Company & Department Profile + FunctionalDomain + Maturity Indicator

**Файл:** `plans/tz/2026-05-22-sba-alpha-9-company-foundation.md`

**Новый.**

**Scope:**
- **Новая модель `CompanyProfile`** (1:1 с Org):
  ```
  CompanyProfile(id, tenantId @unique, missionStatement?, visionStatement?,
                 productsJson, marketsJson, valuesJson, strategyJson,
                 maturityScore Decimal(4,3), entityId?)
  ```
- **Новая модель `Department`**:
  ```
  Department(id, tenantId, name, parentDepartmentId? (self),
             missionStatement?, completeness Decimal(4,3),
             entityId?, sourceBlockIds[], confidence)
  ```
- **Новая модель `FunctionalDomain`** (дерево с авто-расширением):
  ```
  FunctionalDomain(id, tenantId, name, code (slug),
                   parentDomainId? (self), description?,
                   directionStatement?, status ('proposed'|'canonical'|'archived'),
                   isAutoCreated Boolean default false,
                   maturityScore Decimal(4,3),
                   sourceBlockIds[], confidence)
  ```
- **Новая модель `DepartmentDomainLink`** (m:n):
  ```
  DepartmentDomainLink(id, departmentId, domainId, isPrimary Boolean default false)
  ```
- **Seed FunctionalDomainSeed.ts** — 8 базовых функций при создании Org. + Per-industry templates (SaaS, Девелопер, Ритейл, Производство, B2B-услуги) подгружаются при выборе индустрии в onboarding.
- **Cron `domain-expander.cron`** (раз в день) — собирает блоки с `axis-classifier.functional.confidence < 0.6` или `noMatch`. Если ≥3 за неделю в семантическом кластере (KNN cosine ≥ 0.78) — LLM `domain-name-suggest`. Если confidence ≥ 0.75 — создаётся новый домен `status='proposed'`, попадает в curation light review.
- **TypeScript interface `IOrganizationalUnit`** (см. ответ 4.1, ADD-9) — `CompanyProfile`, `Department`, `Role` его реализуют:
  ```ts
  interface IOrganizationalUnit {
    id: string; tenantId: string; name: string;
    missionStatement?: string;
    completeness: number; maturityScore: number;
    getResponsibilityElements(): Promise<ResponsibilityElement[]>;
    getKpis(): Promise<KPI[]>;
    getInteractions(): Promise<Interaction[]>;
    getProcesses(): Promise<ProcessTemplate[]>;
  }
  ```
- **Воркер `company-profile-builder.worker`** — consumer для блоков с `axis-classifier.contextual.entityId === own_org_id` + signalType ∈ ('strategy','mission','value','principle').
- **Воркер `department-detector.worker`** — собирает Department из упоминаний.
- **Maturity Indicator first-class:**
  - Поле `maturityScore` на CompanyProfile / Department / FunctionalDomain / Role.
  - `MaturityScorerCron` (каждые 4 часа) — `completed slots / declared slots`.
  - Виджет в Director Dashboard.
  - Новая страница `/maturity` — разбивка по узлам с deep-links на карточки и список незаполненных слотов.
- Probe-events: «нет миссии компании», «у домена X нет направления», «у отдела Y нет цели».
- API:
  - `GET /api/v1/company-profile`, `PATCH /api/v1/company-profile`.
  - `GET/POST /api/v1/departments`, `GET /api/v1/departments/:id/tree`.
  - `GET/POST /api/v1/functional-domains`, `GET /api/v1/functional-domains/:id/tree`.
  - `GET /api/v1/maturity` — общий индикатор + разбивка.
- UI:
  - `/company` — страница профиля компании (5 слотов).
  - `/departments` — дерево отделов (drag-and-drop reorganization).
  - `/domains` — дерево функциональных доменов.
  - `/maturity` — дашборд зрелости.
- RBAC: `company_profile`, `department`, `functional_domain` ResourceType.
- LlmTaskType: `company-mission-extract`, `company-values-extract`, `department-detect`, `domain-name-suggest`, `domain-direction-extract`.

**DoD:**
- 8 базовых доменов сидируются при создании новой Org.
- Per-industry templates работают (тест на 3 индустриях).
- Domain-expander создаёт новый домен на тестовом блоке.
- Maturity Score считается и виден в Director Dashboard.

---

### α-10. Admin LLM Management + Unit Economics

**Файл:** `plans/tz/2026-05-22-sba-alpha-10-admin-llm-economics.md`

**Новый. Основан на отчёте subagent'а аудита LLM-админки.**

**Scope (значительно расширенный):**

#### Prisma — новые модели:

```
LlmProvider(id, code, displayName, baseUrl,
            apiKeyRef (encrypted), authType ('bearer'|'bearer-prefixed'|'header-x-api-key'),
            headersJson Json?, protocolType ('openai-chat'|'openai-responses'|'anthropic-messages'|'custom'),
            maxDataClass DataClass, localOnly Boolean default false,
            isActive Boolean default true, priority Int default 100,
            lastSmokeAt DateTime?, lastSmokeStatus String?, notes Text?,
            createdAt, updatedAt)

LlmModel(id, providerId → LlmProvider, code, displayName,
         contextWindowTokens Int, maxOutputTokens Int,
         supportsTools Boolean, supportsJsonMode Boolean, supportsJsonSchemaStrict Boolean,
         supportsReasoningEffort Boolean, supportsPromptCache Boolean,
         family String?, isActive Boolean, allowedDataClasses DataClass[],
         tags String[], lastVerifiedAt DateTime?, lastLatencyMs Int?, notes Text?,
         createdAt, updatedAt)

AiCostDaily(id, date Date, tenantId?, taskType?, providerId, modelId,
            calls Int, inputTokens BigInt, outputTokens BigInt, cachedTokens BigInt,
            costUsd Decimal(14,6), costRub Decimal(14,6),
            @@unique([date, tenantId, taskType, providerId, modelId]))

OrgBudgetCap(id, tenantId @unique, monthlyCapUsd Decimal?, monthlyCapRub Decimal?,
             alertThresholdPercent Int default 80,
             lastAlertSentAt DateTime?, softLimit Boolean default true)

CurrencyRate(id, fromCurrency, toCurrency, rate Decimal(12,6),
             effectiveFrom, effectiveTo?, source String? (например 'CBR'))
```

#### Prisma — расширения существующих:

```
LlmModelPrice +modelId String? FK LlmModel, +currencyRateToUsdSnapshot Decimal?,
              +inputCachedWritePerMillionTokens Decimal?, +changedByUserId String?

LlmTaskRoute +modelId String? FK LlmModel, +providerId String? FK LlmProvider
              (старые providerName/model — параллельно, для backward-compat)

AiUsageLog +modelId String? FK LlmModel, +providerId String? FK LlmProvider,
           +inputCostPerMillionTokensSnapshot Decimal?,
           +outputCostPerMillionTokensSnapshot Decimal?,
           +cachedCostPerMillionTokensSnapshot Decimal?,
           +currencyRateToUsdSnapshot Decimal?,
           +costRub Decimal(10,6)?
```

#### Backend:

- Рефакторинг `LlmRouterService` — заменить hardcoded `switch(entry.provider)` на `LlmProtocolAdapterRegistry`:
  - `OpenAiChatAdapter` (DeepSeek, OpenAI-proxy, Ollama в openai-mode, GigaChat в openai-mode).
  - `OpenAiResponsesAdapter` (GPT-5 responses API).
  - `AnthropicMessagesAdapter` (Anthropic native).
  - `OllamaNativeAdapter` (Ollama без openai-mode).
  - `CustomHttpAdapter` (для своих).
- Каждый адаптер берёт `LlmProvider.baseUrl`/`apiKey`/`headers` из БД через cache (TTL 60s, refresh on update).
- ENV остаётся для bootstrap-секретов (API keys), но baseUrl/headers — из БД.
- Snapshot-pinning цены в `AiUsageLog` (см. поля выше) — на момент вызова.
- Конверсия в рубли через `CurrencyRate` (см. cron ниже).

#### Кроны:

- `DailyCostAggregatorCron` (`0 1 * * *`) — агрегирует `AiUsageLog` за вчера в `AiCostDaily` идемпотентно.
- `OrgEconomicsCron` (`0 3 * * *`) — обновляет per-Org month-to-date агрегат.
- `BudgetAlertCron` (`@Cron(EVERY_HOUR)`) — проверяет `OrgBudgetCap`, отправляет алерт через channels при превышении threshold%.
- `CurrencyRateSyncCron` (`0 6 * * *`) — тянет курс USD→RUB с ЦБ РФ (`cbr.ru/scripts/XML_daily.asp`), обновляет `CurrencyRate`.
- `ProviderSmokeTestCron` (`0 */6 * * *`) — раз в 6 часов проверяет `verifyConnectivity()` всех активных `LlmProvider`, обновляет `lastSmokeAt/lastSmokeStatus`.

#### REST API:

- `GET/POST/PUT/DELETE /api/v1/admin/llm-providers`
- `POST /api/v1/admin/llm-providers/:id/smoke` — ручной запуск smoke-test.
- `GET/POST/PUT/DELETE /api/v1/admin/llm-models`
- `GET /api/v1/admin/llm-models/:id/usage?period=`
- `GET /api/v1/admin/llm-prices/:provider/:model/history`
- `GET/PUT /api/v1/admin/orgs/:id/budget`
- `GET /api/v1/admin/unit-economics/orgs?period=`
- `GET /api/v1/admin/unit-economics/summary?period=` — total cost / margin / forecast

#### Frontend (новые страницы):

- `/admin/llm/providers` — CRUD провайдеров + smoke-test.
- `/admin/llm/models` — CRUD моделей + inline-edit цены + usage за 30d.
- `/admin/llm/prices` — расширение существующей (история по паре provider+model).
- `/admin/llm/usage` — расширение существующего dashboard (рубли).
- `/admin/economics` — главная страница юнит-экономики:
  - Total LLM cost month-to-date (RUB + USD).
  - By Org (sortable, поиск, drill-down).
  - Margin per Org per tariff (если `TariffPlan.pricePerMonthRub` задан).
  - Top-10 expensive taskType.
  - Forecast на конец месяца.
  - Export CSV / Excel.
- `/admin/economics/orgs/[id]` — drill-down: cost by taskType, by user, by source (meeting/document/chat).

#### Frontend для Org-Admin:

- `/admin/org/llm-usage` — usage только своей Org.
- `/admin/org/economics` — мой Org: history, budget cap, alerts.

#### Метрики Prometheus (cardinality-safe):

- `ai_cost_usd_total{tenant,task_type,provider,model}` — top-100 tenant + `other`.
- `ai_cost_rub_total{tenant,task_type,provider,model}` — то же.
- `ai_calls_total{tenant,task_type,provider,model,success}`.
- `org_budget_utilization_percent{tenant}` — gauge.
- `provider_smoke_test_success{provider}` — gauge.

**DoD:**
- Можно добавить GigaChat / YandexGPT / любой OpenAI-compatible провайдер из админки **без релиза кода**.
- Можно поменять primary модель для taskType из админки без релиза.
- Можно проставить цену вручную, она применяется к новым вызовам (snapshot в AiUsageLog).
- Дашборд `/admin/economics` показывает «cost per Org per month» в рублях.
- Алерт срабатывает при превышении budget cap.
- Margin per Org виден (где задан TariffPlan).
- A/B по моделям работает.
- Smoke-test работает по кнопке + по cron'у.

---

## Часть 4. Фаза β — 8 sub-ТЗ детально

### β-1. Channels — Telegram + MAX (ZERO-BUTTON)

**Файл:** `plans/tz/2026-05-22-sba-beta-1-channels-telegram-max-v2.md`

**Заменяет:** `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md` (старый — в архив).

**Scope (полностью переписан под zero-button):**

#### Что разрешено
- **Один BotCommand `/start <linkCode>`** — только для линковки аккаунта.
- Никаких других BotCommand'ов в `setMyCommands` (либо пустой, либо только `/start`).
- Никаких `reply_markup` (inline_keyboard, reply_keyboard).
- Никаких `callback_data` / `callback_query`.
- `allowed_updates: ['message', 'edited_message']` (без `callback_query`).

#### Inbound (три типа)
- `message.text` (включая caption к файлу) → DialogService classifier → `free_note` / `chat_query` / `response`.
- `message.voice` → `getFile` → ASR pipeline → текст → как text.
- `message.document` (PDF / DOCX / TXT / image OCR) → `IngestService.ingest({kind:'document'})`.

#### Outbound
- `sendMessage` plain markdown/HTML, без `reply_markup`.
- Если в `notification.payload.options` есть варианты — рендерим как пронумерованный список в тексте.
- (γ+) `sendVoice` через TTS — для proactive-сообщений.

#### Onboarding
- Deep-link `https://t.me/<bot>?start=<token>` из ЛК → `/start <token>` → `linkCode.consume` → ChannelBinding.
- Голый код (`^[A-Z0-9]{6,8}$`) тоже принимается → попытка `linkCode.consume`.
- Для непривязанных — мягкое сообщение «попросите администратора прислать ссылку для привязки».

#### Удалить полностью

- `c:\work\z\backend\src\modules\conversational\command-handler.service.ts` (или сильно ужать до natural-intent helper).
- `PROBE_CALLBACK_PREFIX`, `handleCallbackQuery`, `renderInlineKeyboard`, `parseSlashCommand` в обоих адаптерах (telegram-bot, max-bot).
- Типы `TelegramInlineKeyboardButton`, `TelegramInlineKeyboardMarkup`, `TelegramAnswerCallbackQueryRequest`, `TelegramBotCommand`, `MaxInlineKeyboardCallbackButton`, `MaxInlineKeyboardAttachment`, `MaxCallback`.
- Поля `reply_markup` из `TelegramSendMessageRequest`, `attachments` из `MaxSendMessageRequest`.
- Поля `callback_query` / `callback` из update-типов.
- Методы `answerCallbackQuery`, `setMyCommands` (или setMyCommands оставляем только для `[]`/`[/start]`).
- Ветка `'command'` из `InboundMessage` union.
- Массив `COMMANDS` в `setup-telegram-bot.ts` и `setup-max-bot.ts`.
- Тесты на callback_query / status / myideas / help / ask / note / idea / link / unlink.

#### Добавить

- В обоих адаптерах: handler для `message.voice` (getFile → ASR → free_note/chat_query).
- В обоих адаптерах: handler для `message.document` (getFile → document.adapter).
- В обоих адаптерах: распознавание deep-link `/start <token>` и голого 6-знач кода.
- В `conversational.service.ts`: LLM-классификатор intent (`dialog-classify` taskType — тот же что в α-5) для свободного текста.

#### Синхронизировать ТЗ-файлы

- `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md` → archived.
- `plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md` § β-5.19 → переписать («понимание запроса "покажи мои идеи" через DialogService»).
- `plans/tz/2026-05-21-telegram-employee-channel.md` → пересмотр (зачёркиваем `/unlink`).
- `second-brain/01_projects/conversational-channels.md` → переписать секцию «CommandHandlerService» как «Natural-language intent handler»; убрать строки про callback_query.
- `second-brain/01_projects/ideas.md` → переписать § Telegram.

**Контракт:** все probe Слоя 6 и AI-чат Слоя 5 доступны через Telegram + MAX — **без единой кнопки**.

**DoD:**
- `setMyCommands([])` или `[{command:'start',...}]` — выпадающее меню пустое или только start.
- Тест: голосовое сообщение → ASR → ответ через chat-v2.
- Тест: документ PDF → document-ingest → агенты разобрали.
- Тест: probe с тремя вариантами → выводится текстом с нумерацией → юзер пишет «второй» → LLM-арбитр сопоставляет с option 2.
- Старые inline-кнопки в задеплоенных сообщениях не reagируют (webhook отключён от callback_query).
- ТЗ-файлы синхронизированы.

---

### β-2. Specialist 3.2 — Knowledge Clone

**Файл:** `plans/tz/2026-05-22-sba-beta-2-specialist-3-2-knowledge-clone.md`

**Заменяет:** `plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md`.

**Scope:** как в исходном sub-ТЗ (см. зонтичное §6.β-2). Без значительных изменений — фундамент готов в α-3/α-8 (Person.entityId, RoleProfile).

**Деталь:** расширение `Person`: `knowledgeProfile Json?`, `lastProfileBuildAt`, `profileBuildVersion`. Воркер `knowledge-clone.worker`. Cron rebuild. UI на `/me/knowledge-profile` и `/persons/[id]/knowledge-profile`.

---

### β-3. Specialist 3.3 — Decisions Registry (+ DecisionPolicy связь)

**Файл:** `plans/tz/2026-05-22-sba-beta-3-specialist-3-3-decisions.md`

**Заменяет:** `plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md`.

**Scope:** как в исходном + поле `Decision.appliedPolicyId?` → `DecisionPolicy` (FK на α-8) для связки «решение принято по такому-то паттерну рассуждения роли».

---

### β-4. Specialist 3.5 — Insights Radar + Insight↔Experiment↔Decision FSM

**Файл:** `plans/tz/2026-05-22-sba-beta-4-specialist-3-5-insights.md`

**Заменяет:** `plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md`.

**Scope:** как в исходном +:
- LLM-классификатор `insight-categorize-cause` ставит `causeCategory` ∈ (`process`, `people`, `resources`, `task_formulation`). Если confidence < 0.7 → curation light review.
- `EntityTransitionCron` (раз в день) проверяет переходы Experiment ↔ Insight ↔ Decision (см. ответ 4.3.5).
- Расширение Director Dashboard: виджет «Топ-5 повторяющихся проблем» (как было) + категория причины.

---

### β-5. Specialist 3.6 — Ideas Collector + Layer 6 Probe Agent (пара)

**Файл:** `plans/tz/2026-05-22-sba-beta-5-specialist-3-6-ideas-and-probe.md`

**Заменяет:** `plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md`.

**Scope:** как в исходном, но:
- Probe-Agent — pluggable per-channel rendering (для Telegram/MAX — пронумерованный список, не inline-кнопки; для in_app — может быть кнопки в UI, но **не в боте**).
- Slash-commands `/myideas`, `/status` УБИРАЮТСЯ — заменяются на natural-language через DialogService.
- LLM `probe-formulate` остаётся, но output — `text` + `options[]` (для рендеринга в нумерованный список).

---

### β-6. Specialist 3.9 — Experiment Tracker

**Файл:** `plans/tz/2026-05-22-sba-beta-6-specialist-3-9-experiment-tracker.md`

**Новый.**

**Scope:**
- **Новая модель `Experiment`:**
  ```
  Experiment(id, tenantId, hypothesis Text, action Text,
             startedAt, completedAt?, result Text?,
             lesson Text?, status ('hypothesis'|'in_progress'|'completed'|'abandoned'),
             outcome ('positive'|'negative'|'neutral'|'unclear')?,
             relatedDomainIds[] → FunctionalDomain,
             relatedProjectIds[] → Project, relatedDecisionIds[] → Decision,
             affectsEntityIds[], sourceBlockIds[], personSubjectIds[],
             confidence, embedding vector(1536),
             entityId?, status, currentVersionId?)
  ```
- Воркер `experiment-detector.worker` — consumer для signalType `experiment`/`hypothesis`/`result`/`lesson`.
- Cron `experiment-status-resolver` (раз в день) — детектит переход:
  - hypothesis → in_progress (если есть action и нет результата 7+ дней).
  - in_progress → completed (если есть result-блок).
  - completed positive → автоматическое предложение DecisionPolicy (через curation).
  - completed negative → автоматическое предложение Insight (риск) (через curation).
- Probe-events: «эксперимент X без вывода», «эксперимент Y без результата спустя N дней».
- Связь с Insights: `Insight.relatedExperimentIds[]` (расширение β-4).
- API: `GET/POST /api/v1/experiments`, `PATCH /api/v1/experiments/:id`.
- UI: `/experiments` (master-detail с фильтрами по status/outcome/domain).
- RBAC: `experiment` ResourceType.
- LlmTaskType: `experiment-extract`, `experiment-result-detect`, `experiment-lesson-extract`.

**DoD:**
- Все 4 статуса работают.
- FSM переходы тестируются.
- UI работает.

---

### β-7. Specialist 3.10 — Brand Voice Curator + Asset (расширение Document)

**Файл:** `plans/tz/2026-05-22-sba-beta-7-specialist-3-10-brand-voice.md`

**Новый.**

**Scope:**
- Расширение существующей модели `Document` (см. ответ 4.3.6):
  ```
  Document +useCases String[] (multi-value: 'reference'|'use_in_process'|'use_for_generation')
            +extractedBrandVoiceProfileId? FK BrandVoiceProfile
            +contentEmbedding vector(1536)?
  ```
- **Новая модель `BrandVoiceProfile`** (derived, см. ответ 4.1, RES-3):
  ```
  BrandVoiceProfile(id, tenantId, departmentId? → Department,
                     functionalDomainId? → FunctionalDomain,
                     tone Text, structurePatterns Json,
                     vocabularyLexicon Json, taboos Json,
                     sourceDocumentIds[] → Document,
                     builtAt, builderVersion, sampleCount Int,
                     confidence Decimal(4,3))
  ```
- **Воркер `brand-voice-extractor.cron`** (раз в неделю) — берёт Document'ы с `useCases ∋ 'use_for_generation'`, кластеризует по departmentId/domainId, для каждого кластера ≥ 5 документов — LLM `brand-voice-extract` → создаёт/обновляет BrandVoiceProfile.
- Curator подтверждает / помечает части корпуса как `excludeFromBrandVoice=true`.
- Использование в chat-v2 (clone_style для компании): при `synthesis.mode='clone_style'` + `scope='company'` — инжектится `BrandVoiceProfile.tone + vocabulary` в промпт.
- API: `GET /api/v1/brand-voice-profiles`, `GET /api/v1/brand-voice-profiles/:id`, `POST /api/v1/documents/:id/exclude-from-brand`.
- UI:
  - `/brand-voice` — список профилей (по departmentId/domainId).
  - На странице каждого Document — toggle «учитывать в стиле бренда».
- RBAC: `brand_voice_profile` ResourceType.
- LlmTaskType: `brand-voice-extract`, `brand-voice-merge`.

---

### β-8. Specialist 3.11 — Personal Relation Graph + Appointment (UI) + COO Operations Dashboard + DailyCheckIn

**Файл:** `plans/tz/2026-05-22-sba-beta-8-personal-relations-coo-checkins.md`

**Новый (синтез из coo-dashboard analysis + ответы 4.5).**

**Scope:**
- **PersonalRelation** — реализация через `EntityLink` (новые `relationType` уже добавлены в α-8). Воркер `personal-relation-builder.worker` — собирает рёбра из:
  - блоков, где упомянуты два Person с `axis-classifier.who.role ∈ ('subject','mentioned')`.
  - ежедневных чек-инов «с кем работал».
  - встреч (через `IdeaBlockEntity` с role='participant').
- **DailyCheckIn модель:**
  ```
  DailyCheckIn(id, tenantId, userId, date Date, kind ('morning'|'evening'),
               planText?, doneText?, notDoneText?, blockersText?, insightsText?,
               channelBindingId?, rawEventId?,
               createdAt, @@unique([userId, date, kind]))
  ```
- **`DailyCheckInCron`** (запускается дважды: 9:00 и 18:00 локального времени Org — учёт TZ Org) — отправляет напоминание через привычный канал. **Факультативно** (см. ответ 4.5.1) — пользователь может игнорировать. После 3 дней молчания — мягкий probe от Probe-Agent.
- **Расширение `Goal`** новыми полями: `parentGoalId? (self)`, `decomposedAt?`, `decomposedByUserId?`, `attachedToDepartmentId?`, `attachedToRoleId?`, `targetKpiId? → KPI`. UI — дерево целей с draggable rearrange (см. ответ 4.5.2).
- **Новый сервис `OperationsDashboardService`** — отдельный от `DirectorDashboardService` (тот же паттерн Promise.all + cache 60s).
- **Виджеты дашборда COO:**
  1. Пульс дня (кто прислал чек-ин, кто молчит N дней).
  2. Топ блокеров недели (кластеры signalType='blocker').
  3. Закрытие обещаний (commitment без commitment_status старше N дней).
  4. Каскад целей.
  5. Карта коммуникаций (PersonalRelation, опционально включается через `OrgSettings.communicationGraphIncludeTelegram`).
  6. Причины сбоев (Insights с causeCategory).
  7. Решения в работе (Decision.status='active' без исполнения).
  8. Maturity Indicator виджет (агрегат от α-9).
- **AI-чат «спросите про операционку»** — встроен в дашборд COO (через chat-v2 с `scope='operations'`).
- **Appointment UI** (если не закрыто в α-8) — `/persons/[id]/appointments` страница с историей.
- API:
  - `POST /api/v1/me/check-in` (manual submit).
  - `GET /api/v1/me/check-ins?from=&to=`.
  - `GET /api/v1/operations-dashboard?period=`.
  - `GET/POST /api/v1/goals` с расширенными полями (parentGoalId).
- UI:
  - `/dashboard/operations` — дашборд COO (отдельная страница, в боковой панели под группой «Оперативка»).
  - `/me/check-ins` — история своих чек-инов.
  - `/goals` — расширение существующей с поддержкой каскада.
- RBAC:
  - Новая роль `coo` (опц., назначается из админки) — read+write для `operations_dashboard`, `daily_check_in`, `personal_relation`, `insight.mitigation`.
  - `daily_check_in` ResourceType — read self, owner/admin/coo видят всё, direct_manager видит подчинённых.
  - `operations_dashboard` ResourceType.
- LlmTaskType: `personal-relation-detect`, `check-in-summarize`, `insight-categorize-cause` (уже в β-4).

**DoD:**
- Чек-ины работают (морnовый/вечерний, мягкий probe после 3 дней).
- Дашборд COO с 8 виджетами работает.
- Каскад целей с draggable работает.
- Карта коммуникаций (если включена) работает на тестовой Org.

---

## Часть 5. Фаза γ — 3 sub-ТЗ

### γ-1. Specialist 3.7 — SkillProfile + ExecutablePersona + Clone API

**Файл:** `plans/tz/2026-05-22-sba-gamma-1-specialist-3-7-skill-and-clone.md`

**Заменяет:** `plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md`.

**Scope:** как в исходном sub-ТЗ. Доп. решения из этой сессии:
- **`SkillTraitCategory` — отдельная модель** (ответ 4.6.4) для merge/rename + KNN-кластеризация.
- **`ExecutablePersona` версионирование** — гибрид (ответ 4.6.6): еженедельный snapshot + внеочередной при ≥3 новых traits с confidence high или ≥1 mark_as_misleading critical.
- Обязательная UI `/me/clone` (как и было).

---

### γ-2. Concierge Agent (сквозной UX-слой, command palette, floating, /assistant)

**Файл:** `plans/tz/2026-05-22-sba-gamma-2-concierge-agent.md`

**Новый. Главный UX-сдвиг продукта (по требованию владельца + UI-аудит §3).**

**Scope:**

#### Backend модуль `concierge/`

```
backend/src/modules/concierge/
├── concierge.controller.ts
├── concierge.service.ts
├── tool-router.service.ts
├── service-map.service.ts
├── concierge-context-builder.service.ts
└── tools/
    ├── navigation.tool.ts
    ├── read.tool.ts
    ├── write.tool.ts
    └── orchestration.tool.ts
```

- `ConciergeService.ask({ userId, tenantId, query, contextPage, contextSelection, conversationId? })`.
- Tool-use схема (см. парный аналитический документ Часть 5.4) — REST-эндпоинты как tools.
- Распознавание режима: navigation / action / research.
- Three-mode flow:
  - **Navigation** → ServiceMapService.findRelevantPages(query) → ответ с deep-link.
  - **Action** → LLM `concierge-plan` → выбор tools → выполнение → ответ с подтверждением. Undo через `ConciergeUndoLog` (5 минут TTL).
  - **Research** → проверка quota → spawn OrchestratorService (δ-1) если есть; иначе informative answer «исследовательский режим в δ-1».
- Source de-duplication с chat-v2: если intent = «question about content» → проксирует в chat-v2 → возвращает ответ.

#### ServiceMap

- `ServiceMap` генерируется при build:
  - Парсинг роутов из `frontend/app/(authenticated)/`.
  - Карта агентов из `CardSpecialistRegistry` + `OrgKnowledgeIndex`.
  - RBAC ResourceType list.
  - Глоссарий из `delivery/13-glossary.md`.
- Обновляется при изменении страниц / агентов / RBAC.

#### Tool-use whitelist (для action режима)

Из UI-аудита §3.4 + расширение:

**Read:**
- `search.hybrid({query, filters})`
- `cards.list({...}), cards.get(id)`
- `decisions.list({...}), decisions.get(id), decisions.getSupersedeChain(id)`
- `regulations.list({kind?, status?}), regulations.get(id)`
- `insights.list({status?, severity?}), insights.get(id)`
- `ideas.list({status?, kind?}), ideas.get(id)`
- `processes.list({...}), processes.get(id)`
- `experiments.list({...}), experiments.get(id)`
- `persons.list({role?, department?}), persons.get(id), persons.getKnowledgeProfile(id)`
- `skill_profile.get(personId)` — RBAC-restricted.
- `meetings.list({date?, type?}), meetings.get(id)`
- `documents.list({tag?}), documents.get(id)`
- `me.notifications(), me.probeHistory(), me.checkInHistory()`
- `maturity.summary({scope})`
- `economics.summary({period})` — owner/admin only.

**Write (с явным undo для destructive reversible):**
- `cards.create({...}), cards.update(id, {...}), cards.archive(id)` (не delete — soft).
- `decisions.create({...}), decisions.update_status(id, status)`.
- `ideas.update_status(id, status, reason?)`.
- `meetings.create({...}), meetings.link_to_card(meetingId, cardId)`.
- `regulations.create({...}), regulations.confirm_actuality(id)`.
- `me.respond_to_probe(notificationId, text)`.
- `me.send_check_in({plan?, done?, blockers?, insights?})`.
- `tasks.create({...}), tasks.send_to_destination(taskId, channel)`.
- `goals.create({...}), goals.decompose(id, {subgoals[]})`.
- `reports.generate({type, params})`.

**Orchestration (RBAC + quota):**
- `orchestrator.run({task, scope})` — для сложных research.

**Запрещено (всегда):**
- delete Org, delete API key, billing.*, apiKeys.create.

#### Frontend (три точки входа)

1. **Расширение `CommandPalette.tsx`** (`Ctrl+K` / `Cmd+K`):
   - Два режима: «Search» (текущее поведение) и «Command» (concierge).
   - Определение режима по эвристике (длина query, наличие глагола).
   - Streaming ответа через WS.
   - История последних запросов в Redis (per-user).

2. **Floating bubble** в правом нижнем углу `AppShell`:
   - Иконка-шарик, mint-accent.
   - Клик — открывает `<ConciergeSidebar>` (sheet).
   - Скрыт на `/onboarding/*` и `/meetings/[id]/live`.

3. **Страница `/assistant`** — full-screen chat:
   - История conversations.
   - Streaming с placeholder'ами «думаю…», «вызываю tool…», «готово».
   - Поддержка voice input (через MediaRecorder + ASR).

4. **Контекстный slot `<ConciergeSlot context={{ page, resourceId }}>`** — компонент-обёртка для каждой страницы (chip «Спросить про эту карточку», открывает sidebar с pre-filled контекстом).

#### REST API

- `POST /api/v1/concierge/ask` (streaming через SSE).
- `GET /api/v1/concierge/conversations`, `GET /:id`, `POST /:id/clear`.
- `POST /api/v1/concierge/undo/:undoId`.

#### Метрики

- `concierge_queries_total{intent, success}`.
- `concierge_tool_use_total{tool, success}`.
- `concierge_quota_blocked_total{userId}`.
- `concierge_query_duration_seconds{intent}` (histogram).
- `concierge_undo_total{tool}` — индикатор плохих авто-действий.
- `concierge_proxied_to_chatv2_total` — сколько запросов передали в chat-v2.

#### Quota

- `OrgConciergeQuota(tenantId, dailyResearchLimit Int default 5 для member, ∞ для owner/admin/coo)`.
- Reset кроном в полночь по TZ Org.

**DoD:**
- Concierge доступен из всех 3 entry points на всех страницах ЛК.
- Тестовые сценарии:
  - «создай карточку Сбера, контакт Иванов» → создаётся карточка с pre-filled полями.
  - «покажи мне регламент по продажам» → переход на `/regulations/:id`.
  - «изучи как мы работаем с enterprise и сделай отчёт» → spawn research → notification через 5-15 минут.
  - «сколько у нас рисков?» → проксирует в chat-v2 → возвращает ответ.
- Undo работает (TTL 5 минут).
- Тесты на quota.

---

### γ-3. CrossFunctionalProcess + Handoff Tracker

**Файл:** `plans/tz/2026-05-22-sba-gamma-3-cross-functional-process.md`

**Новый.**

**Scope:**
- **Новая модель `CrossFunctionalProcess`** (расширяет ProcessTemplate из α-7):
  ```
  CrossFunctionalProcess(id, tenantId, baseTemplateId → ProcessTemplate,
                          ownerChainJson (cepочка владельцев по отделам),
                          crossDepartmentMetricId? → KPI,
                          handoffIds[] → ProcessHandoff,
                          completenessTrace Decimal(4,3))
  ```
- Воркер `cross-functional-detector.worker` — детектит, что процесс задевает >1 отдела.
- Probe-events: «передача между маркетингом и продажами не описана», «у сквозного процесса X нет сквозной метрики».
- API: `GET/POST /api/v1/cross-functional-processes`.
- UI: расширение `/processes` — табы «Локальные» / «Сквозные».

---

## Часть 6. Фаза δ — 3 sub-ТЗ

### δ-1. Orchestrator Agent + Org Knowledge Index

**Файл:** `plans/tz/2026-05-22-sba-delta-1-orchestrator.md`

**Новый. Для сложных research-запросов от concierge и chat-v2.**

**Scope:**

#### Карта базы

- **`OrgKnowledgeIndex`** — sub-структура:
  - Статика-схема (генерируется при build из Prisma): таблицы, поля, RBAC.
  - Динамические агрегаты (cron раз в день): «активных проектов N», «клиентов M», «тем за квартал K», «открытых решений с дедлайнами L».
  - Состояние Curation: «X open conflicts, Y stale, Z evolving».
  - Подаётся оркестратору сжатым (≤ 2k токенов).

#### Оркестратор

- **`OrchestratorService.run({task, userId, tenantId, scope})`** — запускает фоновую BullMQ-job.
- 4 шага:
  1. **Plan** — LLM `orch-plan` (capable модель, Claude-4.6 / GPT-5.4) превращает task в дерево 3-5 параллельных подзадач (depth=1, hard limit).
  2. **Spawn subagents** — для каждой подзадачи запускается BullMQ-job с изолированным контекстом + одним из специалистов Слоя 3 как tool. Субагент возвращает СЖАТЫЙ артефакт (5-10 строк + ссылки на блоки).
  3. **Synthesize** — LLM `orch-synthesize` объединяет артефакты + добавляет uncertaintyNote при конфликтах.
  4. **Verify** — LLM `orch-verify` проверяет покрытие источниками + correctness.
- **Гарантии:**
  - Depth ≤ 1 (hard). Opt-in depth=2 через `OrgSettings.orchestratorMaxDepth` только для owner.
  - Бюджет per query: `OrgConciergeQuota.maxTokensPerResearchQuery` (default 50k).
  - Recursive subagents запрещены (subagent не может вызвать другого subagent'а).
  - Конфликты артефактов не сглаживаются — поднимаются в `uncertaintyNote`.
- **Status**: `running` → `synthesizing` → `verifying` → `completed` / `failed` / `cancelled`.
- Результат → `OrchestrationReport` запись + notification в `/me/notifications` через каналы.

#### REST API

- `POST /api/v1/orchestrator/runs` (создать).
- `GET /api/v1/orchestrator/runs/:id` (статус).
- `GET /api/v1/orchestrator/runs` (мои + Org-wide для admin).
- `DELETE /api/v1/orchestrator/runs/:id` (cancel).

#### UI

- `/orchestrator` — список моих research-задач + статусы.
- `/orchestrator/runs/:id` — детальный отчёт с раскрытием дерева подзадач + источники.

**Метрики:**
- `orchestrator_runs_total{status, depth, tenant}`.
- `orchestrator_tokens_per_run` (histogram).
- `orchestrator_run_duration_seconds` (histogram).
- `orchestrator_subagent_failure_rate{specialist}` (gauge).

**LlmTaskType:** `orch-plan`, `orch-synthesize`, `orch-verify`, `subagent-{specialist}`.

**DoD:**
- Тестовый research «подготовь сводку по всем срывам сроков за квартал» возвращает отчёт за 5-15 минут с источниками.
- Depth=1 hard, depth=2 opt-in.
- Quota соблюдается.

---

### δ-2. ProactiveWatcher Agent

**Файл:** `plans/tz/2026-05-22-sba-delta-2-proactive-watcher.md`

**Новый. Автономный агент, эмитит инициативные сообщения.**

**Scope:**
- Cron `proactive-watcher.cron` (каждые 6 часов).
- Проходит по графу, ищет «о чём поговорить с пользователем»:
  - Совмещение Insight.dynamic='growing' + нет mitigationPlan → сообщение owner'у.
  - Decision.deadline ≤ +7 дней + status='active' + нет implementation-сигнала → сообщение decided_by.
  - Карточка карты должности с completeness < 0.5 + maturityScore падает → сообщение носителю.
  - Новый Experiment без status update 14+ дней → сообщение автору.
  - Maturity Score Org упал > 10% за неделю → сообщение owner.
- Использует `ProbeService.suggest(probeEvent)` с типом `proactive` — отличает от reactive probe.
- Анти-спам: max 1 proactive-сообщение на user в день (через Redis lock).
- A/B тестирование сообщений: разные формулировки → метрика response rate.

**LlmTaskType:** `proactive-pattern-detect`, `proactive-message-formulate`.

**DoD:**
- Тестовая Org с искусственным паттерном (Insight.dynamic='growing' без mitigation) — сообщение отправлено owner'у в течение 6 часов.
- Anti-spam соблюдается.

---

### δ-3. Voice Channel (ASR inbound + TTS outbound)

**Файл:** `plans/tz/2026-05-22-sba-delta-3-voice-channel.md`

**Новый.**

**Scope:**
- **`VoiceChannelAdapter`** — `IChannel` имплементация для voice:
  - Inbound: voice-сообщение (Telegram/MAX/web) → ASR (Vox/GigaAM, тот же что для встреч) → текст → DialogService → ChatV2.
  - Outbound: ответ → TTS (опц. провайдер) → mp3 → отправляется через тот же канал.
- Поддержка в существующих channel-адаптерах:
  - Telegram: `message.voice` уже добавлен в β-1, расширяется TTS-ответом.
  - MAX: то же.
  - InApp web-UI: MediaRecorder + WebRTC streaming в backend.
- Concierge поддерживает voice (`Cmd+K` → microphone icon → hold to talk).
- LlmTaskType: `asr-transcribe` (уже есть для встреч), `tts-synthesize` (новый).

**DoD:**
- Voice→Text→ChatV2→Text→Voice loop работает в Telegram и in_app.

---

## Часть 7. Cross-cutting миграции

### 7.1. Очерёдность миграций Prisma

Все миграции — через `bun run prisma:push`, **никогда** `prisma migrate*`.

1. **α-2:** расширение enum `IdeaBlock.signalType` (+25 значений). Backward-compat: старые блоки остаются работать.
2. **α-3:** расширение `Entity.type` enum (+7 значений), новые модели `Vendor`, `Event`, `Market`, `OrgUnit`, добавление `entityId?` на существующих категории A. **Patch-скрипт `migrate-entity-custom-to-topic.ts`** запускается отдельно.
3. **α-4:** новые модели Curation + `CompletenessSlot`.
4. **α-5:** расширение `Conversation` (новое поле `summary`).
5. **α-6:** депрекейт `Card.kind='custom'` — patch `migrate-card-custom-to-topic.ts`.
6. **α-7:** Regulation расширение + новые ProcessTemplate, ProcessTemplateVersion, ProcessStep, DecisionPoint, ProcessHandoff. **Patch `migrate-phase-0b-to-regulations.ts`**.
7. **α-8:** Role расширение + RoleProfile, ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, KPI, Interaction, Appointment. + расширение EntityLink.relationType.
8. **α-9:** CompanyProfile, Department, FunctionalDomain, DepartmentDomainLink. **Seed `FunctionalDomainSeed.ts`** при создании Org.
9. **α-10:** LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate + расширения LlmModelPrice/LlmTaskRoute/AiUsageLog.
10. **β-3:** Decision +appliedPolicyId FK.
11. **β-4:** Insight +causeCategory, +relatedExperimentIds.
12. **β-6:** Experiment модель.
13. **β-7:** Document +useCases[], +extractedBrandVoiceProfileId; BrandVoiceProfile модель.
14. **β-8:** DailyCheckIn модель + Goal +parentGoalId/+attachedTo*.
15. **γ-1:** SkillProfile + SkillTrait + SkillTraitCategory + ExecutablePersona.
16. **γ-2:** Conversation (concierge), ServiceMap (на disk, не в БД), ConciergeUndoLog, OrgConciergeQuota.
17. **γ-3:** CrossFunctionalProcess.
18. **δ-1:** OrgKnowledgeIndex (cached), OrchestrationReport.

После **каждого** изменения схемы — `bun run prisma:generate` + `bun run apply-postgres-init` (для HNSW индексов).

### 7.2. Депрекейты

| Что | Когда депрекейтим | Когда удаляем |
|---|---|---|
| `chat/` модуль (старый) | α-5 (когда chat-v2 готов) | δ (декомиссия legacy) |
| `MeetingTranscriptChunk` chunk-RAG | α-5 | δ |
| `Theme.branch` enum | α-9 (когда FunctionalDomain готов) | γ |
| `Card.kind='custom'` | α-6 | β-1 |
| `Entity.type='custom'` | α-3 | α-6 |
| `phase-0b` extraction (как параллельная сущность) | α-7 (миграция в Regulation) | β |
| Все BotCommand'ы кроме `/start` | β-1 | β-1 (сразу удаляем) |
| Все inline_keyboard в Telegram/MAX | β-1 | β-1 |
| `MODEL_PRICES` hardcoded fallback | α-10 (когда LlmModel в БД) | γ |
| `LlmProviderName` TS-union в коде | α-10 | γ |
| `PROVIDER_CAPABILITY` hardcoded | α-10 (миграция в LlmProvider.maxDataClass) | γ |

### 7.3. Backfill-скрипты

Все one-off скрипты — в `backend/scripts/`, запускаются вручную `bun run scripts/<name>.ts`, идемпотентны.

- `migrate-entity-custom-to-topic.ts` — α-3.
- `migrate-card-custom-to-topic.ts` — α-6.
- `migrate-phase-0b-to-regulations.ts` — α-7.
- `backfill-card-version-v1.ts` — α-6 (уже есть в исходном).
- `seed-functional-domains.ts` — α-9 (по умолчанию + per-industry).
- `seed-llm-providers.ts` — α-10 (из текущих 5 + ENV).
- `seed-llm-models.ts` — α-10 (из `MODEL_PRICES`).
- `seed-llm-task-routes-<feature>.ts` — для каждого нового taskType (паттерн уже есть).
- `seed-rbac-policy-extensions.ts` — для каждой новой ResourceType.

---

## Часть 8. Telegram zero-button — деталь rip-out

См. отчёт Telegram-audit агента, инкорпорирован в β-1. Ключевые правки в коде (полный список — в `plans/tz/2026-05-22-sba-beta-1-channels-telegram-max-v2.md`):

**Файлы на удаление полностью:**
- `backend/src/modules/conversational/command-handler.service.ts` (или сильно ужать).

**Файлы на правку (удалить части):**
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` — все handlers callback_query, renderInlineKeyboard, parseSlashCommand.
- `backend/src/modules/conversational/adapters/telegram-bot/telegram.types.ts` — типы InlineKeyboard/CallbackQuery.
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-api-client.ts` — `answerCallbackQuery`, `setMyCommands` (или оставить только для [/start]).
- `backend/src/modules/conversational/adapters/max-bot/*` — все аналоги.
- `backend/src/modules/conversational/types/channel.types.ts` — ветка `'command'` из union.
- `backend/scripts/setup-telegram-bot.ts` — COMMANDS массив, setMyCommands(empty), allowed_updates без callback_query.
- `backend/scripts/setup-max-bot.ts` — то же.

**Файлы на правку (добавить части):**
- `telegram-bot.adapter.ts`: handlers voice/document, deep-link `/start <token>`, голый код.
- `conversational.service.ts`: LLM-классификатор intent для свободного текста.

**Файлы тестов на переписку:**
- `telegram-bot.adapter.spec.ts` — удалить тесты callback_query/status/myideas/help/ask/note/idea/link, добавить тесты voice/document/deep-link/голого кода/intent-classifier.

**ТЗ-документы на синхронизацию (в одном коммите с кодом):**
- `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md` → archived (новый: `2026-05-22-sba-beta-1-...-v2.md`).
- `plans/tz/2026-05-21-sba-beta-5-...` → переписать β-5.19.
- `plans/tz/2026-05-21-telegram-employee-channel.md` → пересмотр.
- `second-brain/01_projects/conversational-channels.md` → переписать секции про команды.
- `second-brain/01_projects/ideas.md` → переписать § Telegram.

---

## Часть 9. LLM Admin + Unit Economics — детали

См. отчёт LLM-audit агента, инкорпорирован в α-10. Дополнения:

### 9.1. Безопасность секретов

- `LlmProvider.apiKeyRef` — не plain. Использовать `common/crypto` (AES-256-GCM, уже есть). Или ссылка на ENV-имя секрета (для bootstrap).
- Фронт-форма для apiKey: write-only (никогда не возвращать через `GET`), masked в UI.

### 9.2. Backward-compat миграция

- На переходный период (α-10 → γ) `LlmTaskRoute.providerName`/`model` строки и `LlmTaskRoute.providerId`/`modelId` FK работают параллельно.
- `MODEL_PRICES` в коде — fallback ещё на 2-3 фазы.
- `PROVIDER_CAPABILITY` hardcoded — мигрирует в `LlmProvider.maxDataClass`, но не удаляется до полной декомиссии TS-union.

### 9.3. Метрики Prometheus — cardinality

- `tenant` label — top-100 по обороту + `other` (через `BusinessMetricsService.canonicalizeTenant`).
- `task_type` label — известные taskType + `other` для unknown.

### 9.4. Биллинговая интеграция (vNext)

- Полная биллинговая интеграция (Stripe / CloudPayments / ЮKassa) — vNext, отдельный проект.
- В scope α-10: только показ «себестоимость X — тариф Y — маржа Z%», без выставления счетов.

### 9.5. Не вошло (vNext)

- Real-time push дашбордов (SSE/WebSocket).
- Авто-выбор «дешёвой модели сегодня по latency/cost ratio».
- Per-user budget limits (только Org-level в α-10).
- ML-прогноз расхода («ваш расход к концу месяца — $X»).

### 9.6. Кодовый каталог моделей и цен — единая точка правды (уточнение владельца 2026-05-23)

Владелец зафиксировал: прайс моделей не должен жить только в админ-странице. Должна быть **отдельная кодовая точка правды**, из которой данные **поставляются** (seed/sync) в БД, а админка лишь отображает текущий снимок и допускает manual override.

**Реализация (расширение α-10):**

- **Новый модуль/файл** `backend/src/modules/ai/catalog/llm-models-catalog.ts` — single source of truth:
  ```ts
  export const LLM_PROVIDERS_CATALOG: ProviderEntry[] = [...]   // DeepSeek, OpenAI-proxy, Ollama, GigaChat, Anthropic-placeholder
  export const LLM_MODELS_CATALOG: ModelEntry[] = [...]          // полный список моделей с capabilities
  export const LLM_PRICES_CATALOG: PriceEntry[] = [...]          // цены RUB/USD с validFrom, источник, ссылка
  ```
- **Sync-команда** `bun run scripts/sync-llm-catalog.ts` — идемпотентно подтягивает каталог в БД (`LlmProvider`, `LlmModel`, `LlmModelPrice`); upsert по натуральному ключу (provider.code, model.code, price.validFrom). Запускается:
  - вручную после правок каталога,
  - автоматически на каждом `prod-deploy` (через release-hook).
- **Manual override в админке** — admin может вручную сделать `priceOverride` через `/admin/llm/prices`, эта правка не теряется при sync (поле `overriddenAt` + флаг `overrideOf` в `LlmModelPrice`).
- **Публичная страница для админа** `/admin/llm/catalog` (новая, в дополнение к `/admin/llm/providers`/`/admin/llm/models`/`/admin/llm/prices`) — единый экран «все модели × цены × verified-статус × последний smoke». Просмотр + ссылка на исходный файл каталога в git (read-only витрина).
- **Связка с verified-картой** — каждая модель в каталоге имеет поле `verifiedRef` со ссылкой на `second-brain/01_projects/llm-providers-verified.md`. Кнопка «Прогнать smoke» из админки обновляет `lastSmokeAt/lastSmokeStatus` (уже в плане α-10).
- **Fallback при пустой БД** — `LlmRouterService` при cache miss и пустой `LlmModelPrice` читает напрямую из `LLM_PRICES_CATALOG` (страховка от падения при свежем деплое до первого sync).

**Деприкейт:** старый hardcoded `MODEL_PRICES` (см. §7.2 «MODEL_PRICES hardcoded fallback») заменяется этим каталогом. Поведение fallback такое же, но теперь файл имеет явную структуру и интерфейсы.

**DoD (дополнение к α-10):**
- Каталог `llm-models-catalog.ts` существует, типизирован.
- `sync-llm-catalog.ts` идемпотентен (повторный запуск не дублирует).
- Manual override в админке переживает sync.
- Страница `/admin/llm/catalog` показывает единую витрину.

---

## Часть 10. Concierge Agent — детали (γ-2)

См. отчёт UI-audit агента, инкорпорирован в γ-2. Дополнения:

### 10.1. Tool-use protocol

- Использует Anthropic Claude `tool_use` или OpenAI function calling (через `LlmProtocolAdapter`).
- Тулы декларируются в `ConciergeToolRegistry` с JSON Schema.
- LLM выбирает tool сам; если несколько — параллельный вызов.
- Результат tool → input для следующего LLM-шага → финальный ответ.

### 10.2. Conversation context

- `ConciergeConversation` модель — отдельная от `ChatV2Conversation`.
- Persisted в БД (не Redis) — могут быть длинными.
- Summarized крон'ом (тот же что в chat-v2).

### 10.3. Streaming UI

- SSE (Server-Sent Events) для streaming ответа.
- Placeholder'ы: «думаю…», «вызываю tool X…», «готово».

### 10.4. Voice-input

- MediaRecorder API в браузере.
- Streaming через WebSocket в backend → ASR → текст → DialogService → ConciergeService.
- В γ-3 deferred — реализуется в δ-3.

---

## Часть 11. Testing & rollout strategy

### 11.1. Тестовая среда

- Отдельный staging-Org для каждой фазы с realistic данными (несколько встреч, документов, чек-инов).
- Smoke-тесты после каждого деплоя: `backend/scripts/smoke-*.ts`.

### 11.2. Feature flags

- Каждое крупное расширение — за feature flag в `OrgSettings.experimentalFeatures[]`.
- Концьерж — флаг `feature_concierge` (можно выключить для конкретной Org).
- Voice — флаг `feature_voice`.
- Orchestrator — флаг `feature_orchestrator`.

### 11.3. Gradual rollout

- Phase α — выкатить на 1-2 пилотных Org → собрать метрики → доработать → ремут.
- Phase β — выкатить на 5-10 Org.
- Phase γ/δ — на всех + публичный launch.

### 11.4. Откат стратегия

- Все миграции Prisma — backward-compatible (старые поля остаются, новые опциональные).
- ENV-флаги для отключения новых модулей (`CONCIERGE_ENABLED=false`).
- Прайс-карта в коде fallback — если БД пуста, system не падает.

---

## Часть 12. DoD финальный (продукт готов к enterprise-внедрению)

См. Приложение C парной аналитики. Здесь — расширенный программистский DoD:

- [ ] Все 24 sub-ТЗ имеют статус `done`.
- [ ] Все 4 фазы (α/β/γ/δ) прошли rollout на пилотных Org.
- [ ] Maturity Score ≥ 0.5 на тестовой Org через 30 дней использования.
- [ ] Probe response rate ≥ 50% на тестовой Org.
- [ ] Cache hit rate ≥ 30% для повторных chat-v2 запросов.
- [ ] LLM fallback rate ≤ 5% в secondary, ≤ 0.5% в tertiary.
- [ ] Все taskType имеют тройную цепочку primary/secondary/tertiary с tertiary=local Ollama.
- [ ] Юнит-экономика дашборд показывает cost per Org per month с margin в рублях.
- [ ] Все каналы (in-app, email, telegram, max) — zero-button.
- [ ] Concierge доступен из Cmd+K на любой странице ЛК + floating + `/assistant`.
- [ ] Tool-use whitelist concierge'а покрывает ≥ 80% действий пользователя в ЛК (метрика adoption).
- [ ] Orchestrator работает с depth=1 hard limit.
- [ ] ProactiveWatcher шлёт ≥ 1 useful proactive-сообщение в неделю на активный Org.
- [ ] Voice loop работает (Telegram + in_app).
- [ ] LiveKit pipeline не сломан, все 9 типов встреч работают.
- [ ] Все competitor-parity фичи (A-E из 2026-05-21) интегрированы.
- [ ] Тесты: ≥ 80% покрытие services и mappers; integration для каждого воркера.
- [ ] User wiki (`docs/user-guide/`) — пользователь без подготовки находит «что делать» за ≤ 60 секунд.

---

## Приложение A. Полный список новых Prisma-моделей

| # | Модель | Sub-ТЗ |
|---|---|---|
| 1 | Vendor | α-3 |
| 2 | Event | α-3 |
| 3 | Market | α-3 |
| 4 | OrgUnit | α-3 |
| 5 | CompletenessSlot | α-4 |
| 6 | ProcessTemplate | α-7 |
| 7 | ProcessTemplateVersion | α-7 |
| 8 | ProcessStep | α-7 |
| 9 | DecisionPoint | α-7 |
| 10 | ProcessHandoff | α-7 |
| 11 | RoleProfile | α-8 |
| 12 | ResponsibilityElement | α-8 |
| 13 | AuthorityBoundary | α-8 |
| 14 | RequiredKnowledge | α-8 |
| 15 | DecisionPolicy | α-8 |
| 16 | KPI | α-8 (если ещё нет) |
| 17 | Interaction | α-8 |
| 18 | Appointment | α-8 |
| 19 | CompanyProfile | α-9 |
| 20 | Department | α-9 |
| 21 | FunctionalDomain | α-9 |
| 22 | DepartmentDomainLink | α-9 |
| 23 | LlmProvider | α-10 |
| 24 | LlmModel | α-10 |
| 25 | AiCostDaily | α-10 |
| 26 | OrgBudgetCap | α-10 |
| 27 | CurrencyRate | α-10 |
| 28 | Experiment | β-6 |
| 29 | BrandVoiceProfile | β-7 |
| 30 | DailyCheckIn | β-8 |
| 31 | SkillTraitCategory | γ-1 |
| 32 | ConciergeConversation | γ-2 |
| 33 | ConciergeUndoLog | γ-2 |
| 34 | OrgConciergeQuota | γ-2 |
| 35 | CrossFunctionalProcess | γ-3 |
| 36 | OrchestrationReport | δ-1 |
| 37 | OrgKnowledgeIndex | δ-1 |

Итого — 37 новых моделей за весь roadmap.

---

## Приложение B. Полный список новых страниц frontend

| # | Route | Фаза |
|---|---|---|
| 1 | `/chat-v2` (расширение существующей) | α-5 |
| 2 | `/processes` | α-7 |
| 3 | `/roles/[id]/map` | α-8 |
| 4 | `/persons/[id]/appointments` | α-8 |
| 5 | `/company` | α-9 |
| 6 | `/departments` | α-9 |
| 7 | `/domains` | α-9 |
| 8 | `/maturity` | α-9 |
| 9 | `/admin/llm/providers` | α-10 |
| 10 | `/admin/llm/models` | α-10 |
| 11 | `/admin/llm/catalog` (единая витрина каталога, см. §9.6) | α-10 |
| 12 | `/admin/economics` | α-10 |
| 13 | `/admin/economics/orgs/[id]` | α-10 |
| 14 | `/admin/org/llm-usage` | α-10 |
| 15 | `/admin/org/economics` | α-10 |
| 16 | `/experiments` | β-6 |
| 17 | `/brand-voice` | β-7 |
| 18 | `/dashboard/operations` | β-8 |
| 19 | `/me/check-ins` | β-8 |
| 20 | `/assistant` | γ-2 |
| 21 | `/orchestrator` | δ-1 |
| 22 | `/orchestrator/runs/[id]` | δ-1 |

Итого — 22 новые страницы (+1 после уточнения 2026-05-23 по каталогу моделей).

---

## Приложение C. Граф зависимостей sub-ТЗ

```
α-1 (channels) ────┬─────► α-4 (curation) ────┬─► α-6, α-7, α-8, α-9
                   │                          │
α-2 (signalType) ──┴► α-3 (ontology+router) ──┘
                                                 
α-10 (admin LLM) — параллельно (нужно для seed-LLM-task-routes каждого специалиста)

β-1 ──► требует α-1
β-2..β-7 ──► требуют α (полная)
β-8 (PersonalRelation + COO + CheckIn) ──► требует α + β-5 (Probe)

γ-1 (SkillProfile) ──► требует β (полная)
γ-2 (Concierge) ──► требует α + β-1 (voice/document inbound) + (опц.) δ-1 для research-режима
γ-3 (CrossFunctional) ──► требует α-7 + α-9 + γ-1

δ-1 (Orchestrator) ──► требует γ-2 (Concierge spawns)
δ-2 (Proactive) ──► требует γ-1 + δ-1
δ-3 (Voice) ──► требует β-1 (voice inbound)
```

---

_Создан: 2026-05-22. Программистская роадмапа для Коры v2. Парный документ к `plans/analysis/2026-05-22-unified-product-architecture.md`. Заменяет зонтичное ТЗ от 2026-05-21 после согласования._

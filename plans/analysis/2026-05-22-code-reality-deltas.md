---
type: analysis
status: draft
feature: Code-reality deltas — что РЕАЛЬНО в коде vs unified-product-architecture v2 + final-roadmap v2
date: 2026-05-22 (audit-проход 2026-05-23)
author: claude (по запросу владельца «сопоставь план с реальным кодом»)
related:
  - plans/analysis/2026-05-22-unified-product-architecture.md (продуктовый план)
  - plans/tz/2026-05-22-final-roadmap.md (программистская роадмапа)
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md (исторический зонтичный)
sources:
  - frontend-audit (a3a200132a7c0db45)
  - backend-knowledge-core-audit (aac8d3031ef6e1e6e)
  - backend-curation-channels-ai-audit (a5a81725d5cbe89b3)
  - backend-phase0-rbac-livekit-audit (aeccbbb99ad528b60)
  - предшествующие: Telegram-audit (a29664bd01670073c), LLM-admin-audit (a82a31fbbdeafd0f3), UI-density-audit (aeec87b43cf501c6a)
---

# Code-reality deltas — реальное состояние кода vs план Коры v2

> **Назначение.** Сводный отчёт 4 code-audit агентов: сопоставление `final-roadmap.md` с реальным состоянием кода. После создания v2-документов выяснилось, что **реальный код впереди плана на ~60-70%**. Этот документ исправляет масштаб оставшейся работы.
>
> **Принцип:** не переписываю основные документы целиком. Делаю reality-check блок в начало `final-roadmap.md` со ссылкой сюда + правки по каждому sub-ТЗ.
>
> **Главный вывод:** оставшаяся работа — **~25-30% от заявленного объёма**. Не 24 «новых» sub-ТЗ, а ~14 (плюс мелкие правки в готовых).

---

## TL;DR

### Что реально готово (можно использовать как фундамент)

**Целиком готово (вычеркнуть из роадмапы):**
- **α-1 Conversational Channels Foundation** — Channel/ChannelBinding/Notification/NotificationDelivery + ConversationalService + 4 канала (in_app, email_smtp, telegram_bot, max_bot) + universal linking + dataClass-фильтр.
- **α-6 Specialist 3.4 (Project/Customer)** — эталон §5 контракта `card-rollup-v2.service.ts` + `specialist-3-4-*` — полностью реализован.
- **β-2 Knowledge Clone (Specialist 3.2)** — модель Person.knowledgeProfile + worker + cron `*/6h` + probe-service + card-handler + 2 LlmTaskType.
- **β-3 Decisions Registry (Specialist 3.3)** — модель Decision (расширенная) + worker + 5 probe-trigger'ов + 2 LlmTaskType + supersede chains.
- **β-4 Insights Radar (Specialist 3.5)** — модель Insight + worker + insight-clusterer.cron + 4 probe-trigger'а + 2 LlmTaskType + Director Dashboard виджет.
- **β-5 Ideas + Probe-Agent** — Idea + IdeaCluster + ProbeEvent + probe-dispatcher.worker + probe-priority.cron + 7 специалистов подключены к ProbeService.suggest().
- **γ-1 SkillProfile + ExecutablePersona** — SkillProfile + SkillTrait + ExecutablePersona + worker + skill-profile-recalibrate.cron + executable-persona-build.cron + skill-manager-digest.cron + ClonesService + clone-respond API.
- **5 competitor-parity (A-E)** — Prompt Registry, Behavior Metrics, Quality Score, Transcript Cleaning, Multi Reports — все 5 реализованы.

**Готово на 90%, нужны мелкие добавления:**
- **α-3 Layer 2 Ontology+Routing** — `RouterService` + fan-out + `core.specialist-routing` очередь работают. Vendor/Event есть. Из 14 Entity.type 13 в Prisma. Не хватает: Market, OrgUnit модели + AxisClassifierService + LLM-fallback router + критичный bug-fix `ENTITY_TYPE_VALUES` в промпте.
- **α-4 Layer 4 Curation** — все 5 основных моделей + triage + evolving + stale-detection — работают. Не хватает: CompletenessSlot + ConsistencyCheckerCron + расширение CurationDecisionType.
- **α-7 Specialist 3.1 (Regulations)** — Regulation/Process/Policy расширены §5-полями. Не хватает: ProcessTemplate, ProcessTemplateVersion, DecisionPoint, ProcessHandoff (4 новые модели).

**Реально новое (создавать с нуля):**
- **α-2 Layer 1 Marking Extension** — 11 оставшихся signalType + bug-fix ENTITY_TYPE_VALUES + опц. отдельный reasoning-detect (если решим).
- **α-5 DialogService** — целиком новый модуль (Contextualizer, MultiQueryExpansion, QueryClassifier, Summarizer, ConfidenceEstimator) + AnswerCache/RetrievalCache + temporal `validAt` + mode-specific prompts.
- **α-8 Role Map** — нормализованные таблицы (ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction) вместо текущего `RoleProfile.summaryCache Json`. Plus Appointment (миграция PersonRole). Plus KPI (расширение/переименование Metric).
- **α-9 Company/Department/Domain** — Department уже есть; CompanyProfile (миграция Mission/Vision/Strategy), FunctionalDomain (дерево с авто-расширением), DepartmentDomainLink, MaturityScorerCron, IOrganizationalUnit interface, domain-expander.cron — новые.
- **α-10 Admin LLM + Unit Economics** — LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate — целиком новые. Plus унификация двух admin-групп `(admin)/admin/*` и `(authenticated)/admin/*` ДО создания `/admin/llm/{providers,models}`.
- **β-1 zero-button Telegram/MAX rip-out** — удалить command-handler, slash-команды, callback_query, inline_keyboard; добавить voice→ASR и document-ingest.
- **β-6 Experiment Tracker** — целиком новое.
- **β-7 Brand Voice Curator** — целиком новое.
- **β-8 PersonalRelation + COO + DailyCheckIn** — PersonalRelation базис (EntityLink) есть, остальное новое.
- **γ-2 Concierge Agent** — целиком новое (расширяет существующий CommandPalette, не заменяет).
- **γ-3 CrossFunctionalProcess + Handoff** — целиком новое.
- **δ-1 Orchestrator + OrgKnowledgeIndex** — целиком новое.
- **δ-2 ProactiveWatcher** — паттерн уже есть (`skill-manager-digest.cron`), расширить.
- **δ-3 Voice Channel** — ASR есть (Vox/GigaAM для встреч), TTS нет.

### Цифры

| Метрика | Заявлено в plan v2 | Реально нужно сделать |
|---|---|---|
| Sub-ТЗ к выпуску | 24 | ~14 (10 целиком новых + 4 с большими доделками) |
| Новых Prisma-моделей | 37 | ~22 (15 уже есть в коде) |
| Новых страниц frontend | 21 | ~12 (6 уже есть, 3 — переименование existing) |
| Новых LlmTaskType | ~25 | ~12 (большинство уже зарегистрированы) |
| Новых ResourceType RBAC | ~32 | ~17 (33 уже есть в `policy.csv`) |

**Реальная оценка трудоёмкости: ~30% от первоначальной.**

---

## Часть 1. Сводная таблица 24 sub-ТЗ — фактическая готовность

| Sub-ТЗ | Статус | Готовность % | Что осталось |
|---|---|---|---|
| **α-1** Channels Foundation | done | 100% | (только zero-button rip-out — переезжает в β-1) |
| **α-2** Layer 1 Marking | partial | 65% | 11 signalType + bug-fix `ENTITY_TYPE_VALUES` |
| **α-3** Layer 2 Ontology + Routing | partial | 75% | Market, OrgUnit модели + AxisClassifierService + LLM-fallback router |
| **α-4** Layer 4 Curation | partial | 90% | CompletenessSlot + ConsistencyCheckerCron + расширение CurationDecisionType |
| **α-5** Chat-v2 + DialogService | partial | 30% | Весь dialog-layer/ + cache + temporal `validAt` + mode prompts |
| **α-6** Specialist 3.4 Project/Customer | done | 100% | (только Card.kind='market' + миграция 'custom') |
| **α-7** Regulations + Process | partial | 60% | ProcessTemplate/Version/DecisionPoint/Handoff (4 модели) |
| **α-8** Role Map Builder | partial | 35% | Нормализованные таблицы вместо JSON + Appointment + KPI=Metric+ |
| **α-9** Company Foundation | partial | 25% | CompanyProfile (миграция Mission/Vision/Strategy) + FunctionalDomain + DepartmentDomainLink + Maturity |
| **α-10** Admin LLM + Economics | new | 5% | Целиком новое + унификация admin-групп ДО старта |
| **β-1** Channels Telegram/MAX zero-button | partial | 60% | rip-out command-handler + добавить voice/document |
| **β-2** Knowledge Clone | done | 100% | — |
| **β-3** Decisions Registry | done | 95% | `Decision.appliedPolicyId` после α-8 |
| **β-4** Insights Radar | done | 90% | `causeCategory` поле + EntityTransitionCron |
| **β-5** Ideas + Probe Agent | done | 90% | closing-loop (RawEvent от ответа) + удаление slash-команд |
| **β-6** Experiment Tracker | new | 0% | Целиком новое |
| **β-7** Brand Voice Curator | new | 0% | Целиком новое |
| **β-8** PersonalRelation + COO + CheckIn | partial | 15% | EntityLink базис есть; всё остальное новое |
| **γ-1** SkillProfile + Persona | done | 95% | SkillTraitCategory + гибрид-версионирование |
| **γ-2** Concierge Agent | new | 0% | Целиком новое (расширяет CommandPalette) |
| **γ-3** CrossFunctional Process | new | 0% | Целиком новое (зависит от α-7) |
| **δ-1** Orchestrator | new | 0% | Целиком новое |
| **δ-2** ProactiveWatcher | partial | 10% | skill-manager-digest.cron как паттерн |
| **δ-3** Voice Channel | partial | 30% | ASR есть для встреч, нет для conversational; TTS нет |

**Done или почти done (≥ 90%): α-1, α-4, α-6, β-2, β-3, β-4, β-5, γ-1 + 5 competitor-parity** — это **13 крупных блоков, реально готовых**. Это огромная экономия времени.

---

## Часть 2. Критические баги и риски в существующем коде

Найдено в ходе аудита, должно быть исправлено независимо от Коры v2:

### CRIT-1. `ENTITY_TYPE_VALUES` в block-ingest.prompt.ts не синхронизирован

- **Где:** `c:\work\z\backend\src\modules\knowledge-core\prompts\block-ingest.prompt.ts:30-38`
- **Что:** массив значений только 7 (`client, person, project, product, topic, location, custom`), а в Prisma `EntityType` enum уже 14 (включая `customer, vendor, event, document, goal, technology, metric`).
- **Последствия:** LLM **никогда не вернёт** новые типы в `mentionedEntities`. Они извлекаются только через специализированные пайплайны.
- **Действие:** добавить в α-2 (приоритет P0) — синхронизировать `ENTITY_TYPE_VALUES` с актуальным Prisma enum.

### CRIT-2. `MeetingType.review` и `MeetingType.retrospective` без промпт-шаблонов

- **Где:** `schema.prisma:37-51` (enum), `c:\work\z\backend\src\modules\ai\services\prompts\` (нет файлов `type-review.ts`, `type-retrospective.ts`).
- **Последствия:** при создании встречи этих типов AI-pipeline использует fallback (неясно какой). Возможно падение `analyze.worker.ts`.
- **Действие:** добавить в Часть 8 (что не ломаем) новый пункт — «прежде чем расширять MeetingType, проверить наличие type-promt'а для всех значений enum».

### CRIT-3. `Meeting.tenantId` пока nullable

- **Где:** `schema.prisma:782` с комментарием «NOT NULL после backfill».
- **Последствия:** любая логика, предполагающая `tenantId` всегда непустым, упадёт на legacy-данных.
- **Действие:** провести backfill + миграция на NOT NULL в одной из ближайших фаз. До этого — везде проверять `if (!meeting.tenantId)`.

### CRIT-4. `MEMORY.md` про Anthropic расходится с реальным кодом

- **Где:** memory `project_z_infra_and_ai.md` говорит «Anthropic НЕ используем (нет ключа, не закупаем)». Реально в коде: `anthropic.service.ts` + `LlmProviderName.anthropic` + `PROVIDER_CAPABILITY.anthropic = sensitive`.
- **Последствия:** не блокер (Anthropic НЕ в `DEFAULT_FALLBACK_CHAIN`), но MEMORY вводит в заблуждение.
- **Действие:** обновить MEMORY или явно зафиксировать как «доступен в коде, не активирован в default chain».

### CRIT-5. Telegram — две точки интеграции

- `ingest/adapters/telegram/` (legacy, для **источников знаний**) и `conversational/adapters/telegram-bot/` (β-1, для **conversational reply**) — два разных пути с разным RBAC и разными Source.
- **Действие:** в δ-3 (voice channel) и δ-2 (proactive watcher) явно указать, через какой путь.

### CRIT-6. Apache AGE требует `CREATE EXTENSION age`

- **Где:** `c:\work\z\backend\src\common\graph\graph.service.ts` — использует `cypher('z_graph', $$...$$)`.
- **Последствия:** на любом deployment без расширения AGE — всё развалится при первом обращении к графу.
- **Действие:** проверить `second-brain/02_architecture/age-deployment-decision.md` + add to deploy checklist.

---

## Часть 3. Конкретные правки по каждому sub-ТЗ

### α-1. Channels Foundation → **DONE, переместить в "Готовое"**

**Удалить из scope:**
- Создание моделей Channel/ChannelBinding/Notification/NotificationDelivery — уже есть (`schema.prisma:3884-4002`).
- Интерфейс IChannel — уже есть.
- Адаптеры InAppChannelAdapter, EmailSmtpChannelAdapter — уже работают.
- Универсальный linking flow — уже работает (`link-code.service.ts`, Redis 6-hex TTL).
- API `/me/channels`, `/me/notifications`, `/me/channel-preferences` — уже есть.

**Перенести в β-1 (zero-button):**
- Удалить тип `'command'` из `InboundMessage` union (`conversational/types/channel.types.ts:65-72`).
- Удалить `CommandHandlerService` (`conversational/command-handler.service.ts`).
- Удалить подписку в `conversational.module.ts:62-63`.

**Оставить как опц. в δ:**
- email_imap inbound adapter (если в скоупе).

---

### α-2. Layer 1 Marking → **65% done**

**Уже есть:**
- 19 signalType в Prisma enum (`schema.prisma:228-254`).
- 5 новых из α-2 (`reasoning`, `rationale`, `decision_basis`, `regulation`, `process_step`) — есть.
- block-ingest **один проход** с multi-target extraction (блоки + processes/decisions/regulations/policies/metrics/tools) — реализован.
- TODO «согласовать описания» в `prompt.ts:318`.

**Что осталось:**
1. **P0: bug-fix** — синхронизировать `ENTITY_TYPE_VALUES` (`block-ingest.prompt.ts:30-38`) с актуальным `EntityType` enum в Prisma.
2. Добавить 11 оставшихся signalType (для β-6/β-7/β-8): `expertise, experience, hypothesis, result, lesson, content_artifact, brand_principle, commitment_status, plan_item, done_item, blocker, team_friction, process_friction, resource_gap, suggestion, client_request, question, competence, methodology_step`.
3. Снести TODO «согласовать описания».
4. **Не трогать** multi-target extraction — это уже работает и не должно ломаться при добавлении новых signalType.

---

### α-3. Layer 2 Ontology + Routing → **75% done**

**Уже есть:**
- 13 из 14 Entity.type (нет только `market`, `org_unit`).
- Vendor, Event модели категории A.
- entityId на всех ключевых моделях категории A.
- RouterService + fan-out + статический mapping + per-block priority trim.
- Очередь `core.specialist-routing`.
- 5 EntityLink.relationType уже добавлены из 9 заявленных (`manages`, `collaborates_with` есть).

**Что осталось:**
1. Создать `Market` и `OrgUnit` модели (категория A).
2. Создать `AxisClassifierService` (отдельный новый модуль) — fan-out по 4 осям (WHO × FUNCTIONAL × CONTEXTUAL × TEMPORAL).
3. Расширить `RouterService` LLM-fallback для unmatched signalType (сейчас только статика).
4. Добавить 5 оставшихся EntityLink.relationType: `transfers_result_to`, `escalates_to`, `mentors`, `conflicted_with`, `reports_to`.
5. Patch-script `migrate-entity-custom-to-topic.ts` + удаление `Entity.type='client'/'custom'`.

---

### α-4. Layer 4 Curation → **90% done**

**Уже есть:**
- CurationItem (`schema.prisma:2160-2190`), CurationDecision (`:2199-2213`), ConflictItem (`:2228-2257`), CardVersion (`:2270-2312`), CuratorAssignment (`:2325-2338`) — все 5 моделей.
- evolving resolution — полностью реализован (`schema.prisma:375-380` + `conflict.service.ts:174-197`).
- CurationService.triage с 3 уровнями.
- CardStaleDetectorCron (`@Cron('0 4 * * *')`).
- API `/curation/queue`, `/items/:id/decide`, `/conflicts`, `/conflicts/:id/resolve`, `/settings/curation`.
- Probe-нотификации куратору через channels (policy `curation.pending`).

**Что осталось:**
1. Создать `CompletenessSlot` модель + `CompletenessScannerCron` + endpoint `GET /api/v1/curation/completeness-slots`.
2. Создать `ConsistencyCheckerCron` (раз в 4 часа, 6 структурных правил, эмитит probe-events).
3. Расширить `CurationDecisionType` enum: добавить `merge_categories`, `escalate` (для γ-1 SkillTraitCategory + curation routing).
4. UI `/curation` master-detail — backend API готов, нужен frontend (вне backend audit).
5. **Уточнить ТЗ:** stale-detection живёт в `curation/workers/card-stale-detector.cron.ts`, не в `reframing.cron` — оригинальное ТЗ ошибочно ссылалось на reframing.

---

### α-5. Chat-v2 + DialogService → **30% done (большой остаток)**

**Уже есть:**
- Модуль `chat-v2/` (1354 строк) — оркестрация.
- Ядро retrieval живёт в `knowledge-core/services/chat-v2.service.ts` + `chat-v2-retrieval.service.ts` (918 строк) — гибрид cosine+BM25+1-hop graph.
- ChatV2OrchestrationService + ChatV2ConversationsService + SynthesisService + CardSpecialistRegistry.
- 3 уровня ответа (factual / synthetic / clone_style) — модели и enum есть, но **mode-specific prompts отсутствуют** (один `BASE_SYSTEM_PROMPT`).
- Conversation history (6 последних сообщений в systemPrompt).
- ChatV2CleanupCron (auto-archive `updatedAt < now-90d` + `pinnedAt IS NULL`).
- Omnichannel bridge через `ChatV2OmnichannelBridge` (subscribeInbound `chat_query`).
- 3 LlmTaskType: `chat-v2`, `chat-v2-cite-select`, `chat-v2-conversation-title`.

**Что осталось:**
1. **Целиком новый модуль `dialog-layer/`:**
   - ContextualizerService (standalone question).
   - ConfidenceEstimatorService (mini-step).
   - QueryClassifierService (гибрид эвристика + LLM-fallback).
   - MultiQueryExpansionService (3 переформулировки).
   - ConversationSummarizerCron (сжатие старых сообщений).
2. AnswerCache (Redis TTL 24h) + RetrievalCache (Redis TTL 1h).
3. Temporal фильтр `validAt` — поле в DTO есть (бросает 501), реализовать фильтрацию по `card.currentVersion.validFrom/validUntil`.
4. Mode-specific system prompts (factual / synthetic / clone_style).
5. Расширить `ChatV2Conversation` полем `summary String? @db.Text`.
6. 5 новых LlmTaskType: `dialog-contextualize`, `dialog-confidence`, `dialog-classify`, `dialog-multi-query`, `dialog-summarize`.
7. **Решить:** «архитектурно `dialog-layer` — препроцессор между `ChatV2OrchestrationService.ask()` и `KnowledgeCoreChatV2Service.ask()`. Менять только оркестрацию, не ядро retrieval.»

---

### α-6. Specialist 3.4 Project/Customer → **DONE**

**Уже есть полностью (эталон §5):**
- `card-rollup-v2.service.ts` + `specialist-3-4-card-handler.service.ts` + `specialist-3-4-probe.service.ts` + `specialist-3-4-project-customer.worker.ts`.
- Card расширен `sourceBlockIds, confidence, currentVersionId, personSubjectIds, lastConfirmedAt`.
- CurationService.triage + ConflictService.report + getCitations.
- Метрики `core_specialist_*{type='card'}`.
- Card.kind='vendor' уже добавлен.

**Что осталось:**
1. Card.kind='market' (по аналогии с vendor).
2. **Миграция `Card.kind='custom'` → `topic`** + frontend (5 файлов: `cards/dto/card-kind.ts`, `frontend/src/domain/card.ts`, `cards.api.ts`, `CreateCardDialog.tsx`, `CreateMeetingFormV2.tsx`). Отдельный sub-ТЗ риска.

---

### α-7. Specialist 3.1 Regulations + Process → **60% done**

**Уже есть:**
- Regulation/Process/Policy/Tool/Metric расширены с `entityId/scope/currentVersionId/sourceBlockIds[]/personSubjectIds[]/dataClass/embedding/lastConfirmedAt`.
- specialist-3-1-regulations + worker + probe-service (4 probe-trigger'а).
- 3 LlmTaskType: regulation-extract, regulation-dedupe, process-steps-extract.
- UI `/regulations`.
- API `/api/v1/regulations`.
- ProcessStep как плоская модель с FK на `processId` (`schema.prisma:3094`).

**Что осталось:**
1. **Создать 4 новые модели:**
   - `ProcessTemplate` (заявленный → решить: переименовать существующий `Process` или создать рядом).
   - `ProcessTemplateVersion` (новая).
   - `DecisionPoint` (новая).
   - `ProcessHandoff` (новая).
2. **Решить:** ProcessStep сейчас имеет FK на `processId` — переключить на `templateVersionId` или сохранить совместимость?
3. Добавить 3 новых probe-trigger'а: missing_input_artifact / missing_output_artifact / step_without_owner.

---

### α-8. Role Map Builder → **35% done (большой остаток)**

**Уже есть:**
- `Role` (`schema.prisma:2755-2781`) — базовая модель с 7 полями.
- `RoleProfile` (`schema.prisma:2952-2972`) — с `summaryCache Json` по 5-полевой схеме.
- `RoleProfileAgent` (Phase 0d) — `role-profile.worker.ts` + `role-profile.cron.ts` + промпт.
- `PersonRole` (`schema.prisma:2845-2863`) — с `validFrom/validTo`, без departmentId/loadPercent/status.
- `Metric` модель (близкая к KPI) — без полей `attachedToResponsibilityElementId, attachedToRoleId, attachedToDepartmentId, currentValue, lastMeasuredAt, frequency`.

**Что осталось:**
1. **Расширить Role:** `missionStatement?`, `maturityScore Decimal(4,3)`, `entityId?` (+ relation Entity).
2. **Расширить RoleProfile:** `builtAt`, `builderAgentVersion`, `observationCount`, `completeness Decimal(4,3)`. **Решить судьбу `summaryCache`** — кеш + нормализованные таблицы, или дроп.
3. **Создать 5 новых моделей:**
   - `ResponsibilityElement` (с `kind ∈ outcome|function|activity` через self-reference).
   - `AuthorityBoundary`.
   - `RequiredKnowledge`.
   - `DecisionPolicy`.
   - `Interaction`.
4. **`Metric → KPI` решение:** либо переименовать (миграция) либо `KPI` рядом с расширением полей.
5. **`PersonRole → Appointment` решение:** переименовать с добавлением `departmentId, loadPercent, status('active'|'former'|'acting')`, либо создать `Appointment` рядом и дропнуть `PersonRole`. **PersonRole используется в `PersonsService` (`modules/persons/services/persons.service.ts:30-35`)** + EntityLink `executes_role` — миграция требует синхронных правок.
6. **Перенастроить `RoleProfileAgent`:** сменить промпт + Zod-схему в `knowledge-core/prompts/role-profile-build.prompt.ts` под новые 9 слотов (текущая схема 5-полевая).

---

### α-9. Company Foundation → **25% done (большой остаток)**

**Уже есть:**
- `Department` (`schema.prisma:2730-2750`) — базовая модель.
- `Mission`, `Vision`, `Strategy` — 3 отдельные модели (`schema.prisma:2979, 2997, 3013`) без UI.
- `Theme.branch` enum (12 веток) — частичная функциональная классификация (deprecated в γ).

**Что осталось:**
1. **Расширить Department:** `missionStatement?`, `completeness Decimal(4,3)`, `entityId?`, `sourceBlockIds[]`, `confidence`.
2. **Создать `CompanyProfile`** (1:1 с Org) + миграция данных из `Mission/Vision/Strategy` в JSON-поля.
3. **Решить судьбу Mission/Vision/Strategy:** deprecated или удалить после миграции.
4. **Создать `FunctionalDomain`** (дерево с `parentDomainId`, авто-расширение через cron).
5. **Создать `DepartmentDomainLink`** (m:n).
6. **TypeScript interface `IOrganizationalUnit`** — Role/Department/CompanyProfile его реализуют.
7. **`MaturityScorerCron`** + виджет в Director Dashboard + страница `/maturity`.
8. **`domain-expander.cron`** — авто-создание новых доменов по unmatched блокам.
9. **Seed `FunctionalDomainSeed.ts`** — 8 базовых + per-industry templates (SaaS, Девелопер, Ритейл, Производство, B2B-услуги).
10. UI: `/company`, `/domains`, `/maturity` (3 новые страницы); `/departments` — **решить, расширить `/structure` или создать отдельный URL**.

---

### α-10. Admin LLM + Unit Economics → **5% done (целиком новое + предварительная работа)**

**Уже есть (база):**
- `LlmTaskRoute` + tier-fallback в `LlmRouterService.call()` (primary→secondary→tertiary).
- `LlmModelExperiment` (per-agent A/B).
- `LlmModelPrice` (версионируемая прайс-карта).
- `AiUsageLog` с `tier`, `fallbackReason`, `costUsd` (но без snapshot цены).
- `PromptTemplate` + `PromptResolverService` (Phase A.1) — registry промптов в БД, редактируемых из админки.
- `LlmModelExperiment` + UI `(authenticated)/admin/experiments/`.
- Admin pages: `(admin)/admin/ai-models/` + `(authenticated)/admin/llm-prices/` + `(authenticated)/admin/usage/users` + `(authenticated)/admin/usage/functions/[taskType]/` + `(authenticated)/admin/orgs/[id]/billing/`.

**Что осталось:**
1. **P0 ДО ВСЕГО ОСТАЛЬНОГО:** унифицировать две admin-группы (`(admin)/admin/*` super_admin login и `(authenticated)/admin/*` Z-Admin через основной auth). Решить, какая остаётся как канонический Z-Admin.
2. **Создать модели:** `LlmProvider`, `LlmModel`, `AiCostDaily`, `OrgBudgetCap`, `CurrencyRate`.
3. **Расширить `LlmModelPrice`:** `modelId? FK LlmModel`, `currencyRateToUsdSnapshot`, `inputCachedWritePerMillionTokens?`, `changedByUserId?`.
4. **Расширить `LlmTaskRoute`:** `modelId? FK`, `providerId? FK` (старые providerName/model — параллельно для backward-compat).
5. **Расширить `AiUsageLog`:** snapshot полей цены (`inputCostPerMillionTokensSnapshot, outputCostPerMillionTokensSnapshot, cachedCostPerMillionTokensSnapshot, currencyRateToUsdSnapshot, costRub`).
6. **Рефакторинг `LlmRouterService`:** заменить hardcoded `switch(entry.provider)` на `LlmProtocolAdapterRegistry` (5 адаптеров — OpenAi-chat/Responses/Anthropic-messages/Ollama-native/Custom-http).
7. **4 cron'а:** DailyCostAggregatorCron, OrgEconomicsCron, BudgetAlertCron, CurrencyRateSyncCron (ЦБ РФ), ProviderSmokeTestCron.
8. **REST API:** /api/v1/admin/llm-providers/* + /llm-models/* + /llm-prices/:provider/:model/history + /orgs/:id/budget + /unit-economics/*.
9. **Frontend страницы:** `/admin/llm/providers`, `/admin/llm/models`, `/admin/economics`, `/admin/economics/orgs/[id]` (новые); `/admin/org/llm-usage` — **решить: расширить `/settings/admin/usage` или создать новую**; `/admin/org/economics` (новая).
10. **Метрики Prometheus:** `ai_cost_usd_total{tenant,task_type,provider,model}`, `ai_cost_rub_total{...}`, `ai_calls_total{...,success}`, `org_budget_utilization_percent{tenant}`, `provider_smoke_test_success{provider}` (cardinality top-100 tenant + other).

---

### β-1. Telegram + MAX zero-button → **60% done**

**Уже есть:**
- `telegram-bot/telegram-bot.adapter.ts` (704 строки) — bidirectional adapter с inline_keyboard и callback_query.
- `max-bot/max-bot.adapter.ts` (545 строк) — то же.
- `CommandHandlerService` (`conversational/command-handler.service.ts`) — реализованы `/status`, `/myideas` (stub), `/help`.
- Linking через `linkCode.service.ts`.

**Что осталось (rip-out по списку Telegram-audit subagent'а):**
1. **Удалить:**
   - `command-handler.service.ts` целиком.
   - `PROBE_CALLBACK_PREFIX`, `handleCallbackQuery`, `renderInlineKeyboard`, `parseSlashCommand` в telegram-bot и max-bot.
   - Типы `TelegramInlineKeyboardButton/Markup/CallbackQuery/BotCommand` + `MaxInlineKeyboardCallbackButton/Attachment/Callback`.
   - Поле `reply_markup` из `TelegramSendMessageRequest`, `attachments` из `MaxSendMessageRequest`.
   - Поле `callback_query` / `callback` из update-типов.
   - Методы `answerCallbackQuery`, `setMyCommands` (или оставить `setMyCommands([])`).
   - Ветка `'command'` из `InboundMessage` union.
   - Массив `COMMANDS` в setup-скриптах.
   - Тесты на callback_query/status/myideas/help/ask/note/idea/link.
2. **Добавить:**
   - Handler для `message.voice` (getFile → ASR → free_note/chat_query).
   - Handler для `message.document` (getFile → document.adapter).
   - Распознавание deep-link `/start <token>` и голого 6-знач кода.
   - LLM-классификатор intent (через DialogService — зависит от α-5).
3. **Синхронизировать ТЗ-файлы:**
   - `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md` → archived.
   - `plans/tz/2026-05-21-sba-beta-5-...` § β-5.19 → переписать.
   - `plans/tz/2026-05-21-telegram-employee-channel.md` → пересмотр.
   - `second-brain/01_projects/conversational-channels.md` → переписать.
   - `second-brain/01_projects/ideas.md` → переписать § Telegram.

---

### β-2, β-3, β-4, β-5, γ-1 → **DONE или почти DONE**

| Sub-ТЗ | Готовность | Что осталось |
|---|---|---|
| **β-2 Knowledge Clone** | 100% | — |
| **β-3 Decisions** | 95% | `Decision.appliedPolicyId` FK на `DecisionPolicy` после α-8 |
| **β-4 Insights Radar** | 90% | `causeCategory` поле (LLM ставит, curator подтверждает) + `EntityTransitionCron` (зависит от β-6) |
| **β-5 Ideas + Probe** | 90% | closing-loop (создание RawEvent от ответа на probe — маленькая правка в `ConversationalIngestAdapter` или `probe-response.handler.ts`) + удаление slash-команд (зависит от β-1) |
| **γ-1 SkillProfile + Persona** | 95% | `SkillTraitCategory` отдельная модель + гибрид-версионирование `ExecutablePersona` (еженедельный snapshot + внеочередной по триггерам) |

**Действие:** в final-roadmap переименовать эти 5 sub-ТЗ из «к выпуску» в «доделать мелочи».

---

### β-6, β-7, β-8 → **целиком новые**

Без изменений в плане. Все три действительно новые, как и заявлено.

**Уточнение для β-8:**
- PersonalRelation базис частично есть (4 EntityLink.relationType из 9 — `manages`, `collaborates_with` есть). Нужно ещё 5 + воркер `personal-relation-builder.worker`.
- `Appointment` — миграция `PersonRole` (см. α-8).
- `Goal.parentGoalId` каскад — расширение существующей `Goal` модели.

---

### γ-1, γ-2, γ-3, δ-1, δ-2, δ-3 → **без изменений**

- γ-1 — почти done, см. выше.
- γ-2 — целиком новое (расширяет `CommandPalette.tsx`, не заменяет; расширяет `ToastContext` или мигрирует на Sonner).
- γ-3 — целиком новое (зависит от α-7 ProcessTemplate).
- δ-1 — целиком новое.
- δ-2 — паттерн `skill-manager-digest.cron` уже есть.
- δ-3 — ASR Vox/GigaAM есть для встреч, нет для conversational. TTS нет.

---

## Часть 4. Что есть в коде, но НЕ упомянуто в плане v2 (риски)

При переписывании можем сломать важное:

1. **`block-ingest` уже умеет multi-target extraction** (block + processes + decisions + regulations + policies + metrics + tools в одном проходе). План α-2 говорит только о signalType. Не сломать при добавлении reasoning-only варианта.

2. **Phase 0a/0b/0d артефакты** в коде (`role-profile.cron.ts`, `role-profile.worker.ts`, `BlockExtractionService` с `roleRelevant: bool`) — план α-7 предполагает «миграцию phase-0b в Regulation». Эти артефакты широко используются — миграция должна сохранить backward-compat.

3. **`MeetingTranscriptChunk` chunk-RAG** упомянут как «депрекейт в α-5». Чанк-индекс с pgvector активно используется в `chat/` модуле, переход на chat-v2 нужен **поэтапный**.

4. **`PromptTemplate` + `PromptResolverService` + `PromptExperiment`** (`schema.prisma:3587-3722`) — мощный prompt registry уже работает (Phase A.1). План v2 не описывает это подробно — но это та же категория задач, что и α-10 (DB-managed AI-config). Возможно стоит объединить.

5. **`MeetingReport`, `MeetingBehaviorMetrics`, `MeetingQualityScore`** (`schema.prisma:3764+`) — competitor-parity B/C/E. Активные. Не упомянуты в v2 — нужно явно «не ломаем».

6. **`GoalAlignmentSnapshot`, `GoalTheme`** — Goal-tracking уже частично работает (`strategic-alignment.cron.ts`). План β-8 расширяет Goal новыми полями — проверить совместимость.

7. **`OrgRetentionPolicy`, `OrgEntitlement`, `workersEnabled Json`** — план v2 не упоминает retention/entitlement интеграции с новыми моделями. Каждая новая фича должна заводить entitlement-ключ + проверять `workersEnabled`.

8. **knowledge-core `ChatV2Service`** (`backend/src/modules/knowledge-core/services/chat-v2.service.ts`, 918 строк) — реальный retrieval + LLM call. Модуль `chat-v2/` (1354 строк) — оркестрация поверх. При создании `dialog-layer/` нужно решить, вставлять между `ChatV2OrchestrationService.ask()` и `KnowledgeCoreChatV2Service.ask()`, либо переписать ядро.

9. **Legacy `chat/` модуль + `MeetingChatMessage`** (1607 строк + модель) — активно используется UI `/chat`, `/meetings/:id/chat`, `/cards/:id/chat`. Декомиссия — отдельный sub-ТЗ в δ.

10. **`chat-v2 CardSpecialistRegistry`** — реестр готов, но финальный prompt не получает результаты. В δ-1 Orchestrator может стать tool-реестром для subagent'ов.

11. **`maxDataClass()` helper в LlmRouter** — «строжайший» dataClass из набора. Используется в chat-v2 для guard. Не упомянуто как существующее.

12. **`StructureModule`** (`backend/src/modules/structure/structure.controller.ts`) — единая страница «структура компании» (Org/Department/Role/Person + JD/документы). План v2 не упоминает — нужно решить: расширять или заменить новыми `/processes`, `/roles/[id]/map`, `/persons/[id]/appointments`.

13. **8 типов SourceType** включая `conversational`, `external`, `web_form`, `phone_call`, `bot` — есть инфраструктура для ingest. План упоминает в основном `meeting`, `chat`, `email`, `document`.

14. **Telegram — два пути:** `ingest/adapters/telegram/` (legacy, источники знаний) и `conversational/adapters/telegram-bot/` (β-1, conversational). Не разъяснено в плане — в δ-3 и δ-2 явно указать.

15. **`SuperAdminAccessLog`** — аудит super_admin доступа. План не упоминает.

16. **`Document.inline` (≤10 MiB)** — оптимизация (`inlineContent Bytes?`), не упомянута в плане для миграций.

---

## Часть 5. Сводка для владельца — экономия

**Изначально заявлено в `final-roadmap.md`:**
- 24 sub-ТЗ.
- 37 новых Prisma-моделей.
- 21 новая frontend-страница.
- 25+ новых LlmTaskType.
- ~32 новых RBAC ResourceType.

**Реально нужно сделать:**
- ~14 sub-ТЗ (10 целиком новых + 4 с большими доделками).
- ~22 новых Prisma-моделей (15 уже есть).
- ~12 новых frontend-страниц (6 уже есть, 3 — переименование).
- ~12 новых LlmTaskType (13 уже зарегистрированы).
- ~17 новых RBAC ResourceType (15 уже есть).

**Экономия: ~30% от изначального объёма** (по моделям и страницам), **по sub-ТЗ ещё больше — 13 из 24 практически готовы**.

**Где особенно сильно меняется план:**
- α-1, α-6, β-2, β-3, β-4, β-5, γ-1 — переходят в «доделать мелочи».
- α-3, α-4, α-7 — большая часть уже сделана.
- α-10 (Admin LLM + Economics) — целиком новое, но в Z уже есть PromptTemplate registry (паттерн, который можно скопировать).
- α-5 (Chat-v2 + DialogService) — много новой работы, но не «начинать с нуля» (есть оркестрация).
- α-8, α-9 — много новых моделей, но **миграции** (PersonRole→Appointment, Metric→KPI, Mission/Vision/Strategy→CompanyProfile, Process→ProcessTemplate) — требуют осторожности.

---

## Часть 6. Рекомендация следующих шагов

1. **Принять этот delta как точку правды** — добавить ссылку в начало `final-roadmap.md` + `unified-product-architecture.md`.
2. **Закрыть P0 баги** в течение текущей недели:
   - CRIT-1: синхронизация `ENTITY_TYPE_VALUES` (1 файл, 5 минут).
   - CRIT-2: проверить fallback для `MeetingType.review/retrospective`.
   - CRIT-3: backfill `Meeting.tenantId`.
3. **Унификация admin-групп** — ДО старта α-10, иначе плодим третью группу `/admin/llm/*`.
4. **Старт реальной работы:**
   - α-2 (баг-фикс + 11 signalType).
   - α-5 (DialogService — самый большой scope).
   - α-10 (Admin LLM + Economics после унификации).
   - β-1 (zero-button rip-out — небольшая, но критичная).
   - α-8/α-9 (миграции существующих моделей — требуют осторожности).
5. **Постепенно** — β-6, β-7, β-8, γ-2, γ-3, δ-1, δ-2, δ-3.

---

## Приложение A. Источники аудитов

| Audit | Когда | Что покрыл |
|---|---|---|
| Telegram zero-buttons | 2026-05-22 | telegram-bot + max-bot + command-handler + linking flow |
| Admin LLM + Unit Economics | 2026-05-22 | llm-router + LlmModelPrice + LlmTaskRoute + admin-страницы |
| UI density | 2026-05-22 | 28 frontend страниц + CommandPalette + Sidebar + AppShell |
| Frontend pages real-mapping | 2026-05-23 | 21 заявленная страница vs реальная карта frontend |
| Backend knowledge-core | 2026-05-23 | Слои 1+2+3 — block-ingest, RouterService, 12 специалистов |
| Backend curation/channels/chat-v2/probe/AI | 2026-05-23 | Слои 4+5+6 + Conversational + AI/LLM infrastructure |
| Backend Phase 0 + RBAC + LiveKit | 2026-05-23 | Role/Department/Process/CompanyProfile + 33 ResourceType + LiveKit pipeline |

Все 7 аудитов — read-only research, без правок кода. Конкретные file:line ссылки доступны в каждом отчёте.

---

_Создан: 2026-05-22 (audit-проход 2026-05-23). Точка правды о реальном состоянии кода до старта реализации Коры v2. Снимает риск двойной работы._

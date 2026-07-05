---
title: SBA α-5 — Chat-v2 Omnichannel
status: living
phase: production
covers: AI-чат компании поверх knowledge-core, omnichannel inbound/outbound
parent_tz: plans/archive/2026-05-21-sba-alpha-5-layer5-chat-v2.md
---

# Chat-v2 — AI-чат компании (Layer 5)

«Помощник компании» поверх единого индекса knowledge-core. Доступен через web, in-app, Telegram, MAX, email (через α-1 каналы). Каждый ответ AI подкреплён цитатами из источников.

## Концепция (3 уровня ответа)

| Mode (русск.) | Когда подходит | Что делает AI |
|---|---|---|
| **Факты (`factual`)** | «Что конкретно решено по проекту X?» | Отвечает только тем, что прямо есть в источниках. Если данных нет — честно «не нашёл в памяти компании». Каждое утверждение помечено [BLOCK:id]. |
| **Синтез (`synthetic`)** | «Каковы наши взгляды на X?» | Обобщает 2+ блока. Маркирует уверенность: «по нескольким источникам», «однажды было сказано», «возможно устарело». При открытых `ConflictItem` в Org — добавляет `uncertaintyNote`. |
| **Клон сотрудника (`clone_style`)** | «Как бы ответил Иван?» (γ-1) | На α-5 — fallback на synthetic + пометка «(будет в γ-1)». В γ-1 подключатся Persona-промпты. |

## Retrieval pipeline (через knowledge-core)

```
question + scope → ChatV2RetrievalService (knowledge-core)
                 → ranked blockIds (cosine 0.7 + BM25 0.3 + 1-hop graph)
                 → ChatV2Service.ask (knowledge-core) — собирает prompt + LLM call
                 → парсит [BLOCK:id] из ответа → citations с timestamp'ами
```

Модуль `chat-v2/` **переиспользует** `ChatV2Service` из knowledge-core — не дублирует retrieval/LLM-логику. SynthesisService — тонкая обёртка, добавляющая mode и `uncertaintyNote`.

## Conversation history

- 1 user message → синхронный LLM-вызов → 1 assistant message (с citations и meta).
- В prompt подмешиваются последние 6 сообщений (`cfg.chatV2.historyMessages`).
- После первого user-сообщения — async LLM-вызов `chat-v2-conversation-title` для генерации title (3-7 слов). Fire-and-forget; ошибка не валит основной ответ.
- TTL 90 дней по `updatedAt`. Cron `chat-v2-cleanup.cron` (воскресенье 03:00) переводит активные → archived. `pinnedAt` исключает диалог из auto-archive.

## Omnichannel (через α-1 ConversationalModule)

```
User → channel adapter (telegram_bot/email_smtp/web) → парсит как InboundMessage{type:'chat_query', userId, tenantId, question, conversationId?, originChannelBindingId?}
     → ConversationalService.dispatchInbound(msg)
     → подписанный handler в ChatV2OmnichannelBridge
     → ChatV2OrchestrationService.ask(...)
     → ConversationalService.sendChatReply(...)
       → если originChannelBindingId задан — preferredChannelKinds=[binding.channel.kind]
       → иначе по policy: in_app → telegram_bot → max_bot → email_smtp
     → Notification(eventType='chat.answer') → outbound worker → доставка через тот же канал
```

На α-5 mode для chat-ответа всегда `synthetic` (или из `cfg.chatV2.defaultMode`). На β+ можно расширить парсер: `/ask --factual <вопрос>`.

## ChatV2Scope (2026-05-25, расширено T6b)

Enum `ChatV2Scope` (Prisma + DTO):
- `org` — общеоргвопрос (default).
- `card` — карточка (Card/Client/Deal/Project).
- `project` — проект трекера (специалист ProjectCardHandler).
- `issue` — конкретная задача трекера (добавлено T6b 2026-05-25). До T6b `IssueChat.tsx` использовал workaround `scope='card', scopeRefId=issueId` — теперь нативно через `'issue'`. Маппинг в `SynthesisService.mapScope` подключает IssueCardHandler + ProjectCardHandler.

## CardSpecialistRegistry (заготовка для α-6+)

Push-pattern: каждый специалист в `onModuleInit` зовёт `registry.register(name, handler)`. На α-5 — пустой реестр с готовым интерфейсом `CardSpecialistHandler.getCardsForQuery(...)`. Первая регистрация — в α-6 (Card-специалист), затем α-7 (Regulation), β-3 (Decision).

В α-5 выдача registry **НЕ** попадает в финальный prompt (knowledge-core ChatV2Service ещё не принимает «extra cards»). После α-6+ ChatV2Service эволюционирует, чтобы принимать карточки и mixing'ом отдавать на LLM.

## Метрики

- `chat_v2_queries_total{mode, channel_origin}` — сколько запросов.
- `chat_v2_retrieval_blocks{mode}` (histogram) — сколько блоков использовано в ответе.
- `chat_v2_synthesis_duration_seconds{mode}` (histogram) — длительность ответа.
- `chat_v2_no_evidence_total{mode}` — ответы без цитат (плохой UX).
- `chat_v2_uncertainty_marked_total{mode}` — ответы с uncertaintyNote.
- `chat_v2_conversations_archived_total{reason}` — авто-архив (`reason='ttl'`).

## API (см. controller)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/v1/chat-v2/messages` | Задать вопрос. Создаёт диалог при отсутствии conversationId. |
| GET | `/api/v1/chat-v2/conversations` | Список диалогов (фильтр status/scope, page/limit, pinned вверху). |
| GET | `/api/v1/chat-v2/conversations/:id` | Диалог с сообщениями. |
| POST | `/api/v1/chat-v2/conversations/:id/pin` | Закрепить/открепить. |
| POST | `/api/v1/chat-v2/conversations/:id/archive` | Архивировать. |

## Связь с legacy chat

Старый модуль `backend/src/modules/chat/` помечен `@deprecated`. Endpoint'ы `/api/v1/chat`, `/api/v1/chat/v2`, `/api/v1/meetings/:id/chat`, `/api/v1/cards/:id/chat` остаются для обратной совместимости с фронтом `/chat` и API-клиентами. Удаление — отдельный sub-TZ в β/γ. Switching между legacy/v2 в старых endpoint'ах — через `CHAT_V2_ENABLED` (см. `cfg.knowledgeCore.chatV2Enabled`).

Единый вход — `/chat` («Помощник компании», концьерж). Отдельного master-detail UI `/chat-v2` больше нет: `frontend/app/(authenticated)/chat-v2/page.tsx` — это `redirect('/chat')` (проброс `conversationId`); `/assistant` тоже редиректит на `/chat`. RAG-движок chat-v2 жив в production (расширен Query Understanding 2026-06-10 и Пакетом B 2026-07-02).

## Query Understanding Волна 1 (понимание структуры запроса) — 2026-06-10

**Источник:** [`plans/tz/2026-06-10-query-understanding-tier0-tier1.md`](../../plans/tz/2026-06-10-query-understanding-tier0-tier1.md) (Tier 0 + Tier 1, 5 фаз, без миграций БД). Архитектура retrieval — [[../02_architecture/knowledge-core]] §«Структурный фильтр retrieval»; taskType — [[ai-jobs]].

До этой волны chat-v2 retrieval ранжировал только по смысловому сходству (cosine + BM25 + 1-hop граф), а dialog-layer извлекал лишь `intent`. Запрос с периодом/типом/отделом («что мы решали по маркетингу на этой неделе?») молча деградировал: слова уходили в эмбеддинг, фильтра не было — мог вернуться ответ трёхмесячной давности по другому отделу. Теперь чат **понимает структуру** вопроса и применяет её как **recall-safe структурный фильтр** поверх графа.

### Tier 0 — извлечение плана запроса
- Новый сервис `QueryPlanExtractorService` (`backend/src/modules/dialog-layer/services/query-plan-extractor.service.ts`) — **один** LLM-вызов (taskType `dialog-extract-plan`, primary `deepseek-v4-flash`) извлекает `QueryPlanFilters`: период (как символический токен) + `signalTypes` + `themeBranches` (отдел/тема из enum `ThemeBranch`) + `entityHints` (имена сущностей как написаны) + `personScope` («я/мой/мне») + `aggregation` + `needsAction` + `activeNow` («сейчас/действующие»).
- Период резолвится **детерминированно**, не LLM: `period-resolver.ts` переводит токен (`this_week`/`last_week`/`yesterday`/`today`/`this_month`/`last_month`/`last_n_days`/`none`) в пару `[dateFrom, dateTo]` в поясе Europe/Moscow (фиксированный UTC+3, без перехода на летнее время; иные пояса — задача следующего этапа). Без date-библиотек — голый `Date.UTC`.
- **FAIL-OPEN на каждом шаге:** ошибка LLM / невалидный JSON / низкая уверенность (`QUERY_PLAN_MIN_CONFIDENCE=0.6`) → пустой план `applied=false` → поиск работает как раньше, без фильтра. Лучше «не сузить», чем «потерять релевантное».
- `entityHints` резолвятся в `Entity.id` (по `canonicalName`/`aliases`, **не мутирующе**), `personScope` («я») → `Person.entityId` спрашивающего из сессии (userId, не из текста) и сворачивается в тот же entity-фильтр.

### Tier 1 — recall-safe структурный фильтр
- `DialogProcessResult.structuralFilters` (`StructuralRetrievalFilters`: dateFrom/dateTo/signalTypes/entityIds/themeBranches/bitemporalActiveOnly) пробрасывается `SynthesisInput → ChatV2Input → RetrievalInput`.
- В `ChatV2RetrievalService` — новый метод `rankByStructuralFilter`: при наличии хотя бы одного фильтра делает **полный точный скан** WHERE-фильтрованного пула с `ORDER BY score DESC` (вычисляемый алиас cosine), а **не** HNSW-пробу `embedding<=>qvec LIMIT` (которая роняет recall на узком окне). Предикаты: дата по `IdeaBlockEvidence.sourceTimestamp`, `signalType`, entity (EXISTS по `IdeaBlockEntity`), тема (`ThemeIdeaBlock`+`Theme.branch`), bitemporal `validUntil IS NULL`. 1-hop graph-расширение при фильтрации пропускается. Без фильтров путь байт-в-байт прежний (без регрессии).
- **Честный пустой ответ:** применён фильтр, но пул пуст → «По заданным условиям (…) в памяти ничего не нашлось» **без** LLM-синтеза (хелпер `describeStructuralFilters`). Не выдумывает ответ, когда под условия ничего не подошло.
- **Пакет B (H3, 2026-07-02, коммит `2913f1cf`):** structural-агрегация распространена на классы `fact`/`topic` (раньше только `list`) — `query-plan-extractor` резолвит `personIds` для `fact`/`topic`, а chat-v2 включает `forceStructuralFallback` в режиме `bothWays` (не только на `isStructuralClass`). Честный фолбэк по субъекту: «По {Михаил / компании X} ничего не нашлось» вместо тихого молчания. Метрика `z_structural_fallback_used_total`.

### Флаг и метрики
- `QUERY_PLAN_EXTRACTION_ENABLED` — kill-switch (ON по умолчанию, Ship-On; строка в `docs/operations/feature-flags.md`).
- `z_query_plan_extraction_total{result}`, `z_query_plan_retrieval_filtered_total{filtered}`, `z_query_plan_empty_pool_total{result}`.

> **Дальнейшие волны (НЕ входят):** оркестратор в горячем чате, grounded-специалист-аналитик, text-to-SQL агрегации — отдельные ТЗ.

## Что отложено

- **Streaming SSE** — на α-5 синхронный ответ (1-3 сек обычно). Перенесено в β.
- **Temporal queries (`asOf`)** — поле в API заведено, но возвращает HTTP 501 до завершения α-4 evolving (нужно «historical view» по карточкам).
- **Mode-specific system prompts** — на α-5 LLM-вызов идёт через knowledge-core с встроенным `BASE_SYSTEM_PROMPT`. Mode влияет только на post-processing (uncertaintyNote, clone_style suffix). Полноценные mode-prompts — в γ-1.
- **clone_style** — реализация Persona-промптов в γ-1.

## Файлы

**Backend:**
- `backend/src/modules/chat-v2/` — модуль:
  - `chat-v2.service.ts` (orchestration), `chat-v2.controller.ts`, `chat-v2.module.ts`, `dto/chat-v2.dto.ts`.
  - `services/conversations.service.ts`, `services/synthesis.service.ts`, `services/card-specialist-registry.service.ts`.
  - `workers/chat-v2-cleanup.cron.ts`.
  - `prompts/chat-v2-synthesize.prompt.ts`, `prompts/chat-v2-conversation-title.prompt.ts`.
- `backend/scripts/seed-llm-task-routes-chat-v2.ts` — seed для двух новых taskType'ов.
- `backend/src/modules/conversational/conversational.service.ts` — добавлен `sendChatReply`.
- `backend/src/modules/conversational/types/channel.types.ts` — `chat_query` получил `originChannelBindingId?`.
- `backend/src/modules/conversational/types/event-payload.registry.ts` — `chat.answer` payload schema.
- `backend/prisma/schema.prisma` — `ChatV2Conversation`, `ChatV2Message` + 4 enum'а.
- `backend/src/modules/rbac/policies/policy.csv` — `chat_v2_conversation` секция.
- `backend/src/common/config/env.schema.ts`, `typed-config.service.ts` — `cfg.chatV2.*`.
- `backend/src/common/metrics/business-metrics.service.ts` — 6 новых метрик.

**Frontend:**
- `frontend/app/(authenticated)/chat-v2/page.tsx` — **только `redirect('/chat')`** (отдельного UI больше нет; единый дом Мастера — `/chat`).
- `frontend/src/api/chat-v2.api.ts`, `frontend/src/domain/chat-v2.ts`.
- `frontend/src/ui/components/chat-v2/ChatPanel.tsx` — компонент для встраивания.

[[../index|← index]]

---
title: SBA α-5 — Chat-v2 Omnichannel
status: in-progress
phase: alpha
covers: AI-чат компании поверх knowledge-core, omnichannel inbound/outbound
parent_tz: plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md
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

UI `/chat` показывает баннер с приглашением попробовать `/chat-v2`.

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
- `frontend/app/(authenticated)/chat-v2/` — master-detail UI.
- `frontend/src/api/chat-v2.api.ts`, `frontend/src/domain/chat-v2.ts`.
- `frontend/src/ui/components/chat-v2/ChatPanel.tsx` — компонент для встраивания.

[[../index|← index]]

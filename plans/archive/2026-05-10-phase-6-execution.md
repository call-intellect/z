---
type: execution-plan
phase: 6
feature: knowledge-core — единый AI-чат поверх IdeaBlock'ов (5 scope: org/meeting/card/theme/entity)
status: completed
date: 2026-05-10
---

# Фаза 6 — backend + frontend закрыты.

## Принципиальное решение оркестратора

**Legacy `chat.service` НЕ удаляется в этой фазе.** Точно так же, как Фаза 5 не удалила legacy task/chapter extractor'ы. Причины:
- A/B бенчмарк качества: без legacy сравнивать не с чем.
- Риск регрессии UX: новый retrieval может оказаться слабее на части кейсов.
- Удаление legacy — отдельная фаза после ручного решения владельца.

Поведение через ENV `CHAT_V2_ENABLED` (boolean, default `false`). Когда `false` — все легаси-эндпоинты работают через старый `ChatService`. Когда `true` — те же эндпоинты внутри контроллера switch'атся на новые методы `askXV2()` (тот же контракт ответа: `{message, citations, modelUsed}`). История чата общая (`MeetingChatMessage`), формат citations совместим.

Новый эндпоинт `POST /api/v1/chat/v2` (unified, 5 scope) работает ТОЛЬКО когда `CHAT_V2_ENABLED=true`, иначе 503 `chat_v2_disabled`. Frontend делает graceful fallback на legacy.

**SSE/streaming в этой фазе не реализуется** — это vNext (см. decisions-log).

## Backend

- [x] **Шаг 1 — ENV + конфиг.**
  - `CHAT_V2_ENABLED` (default `false`).
  - `CHAT_V2_TOP_BLOCKS` (default `12`).
  - `CHAT_V2_GRAPH_HOPS` (default `1`).
  - Геттер `cfg.knowledgeCore.{chatV2Enabled, chatV2TopBlocks, chatV2GraphHops}`.

- [x] **Шаг 2 — `ChatV2RetrievalService` + `ChatV2Service`.**
  - `ChatV2RetrievalService.fetchCandidates({tenantId, scope, scopeId, query, limit, graphHops})` — собирает blockId-кандидатов под scope, ранжирует через cosine (`embedding<=>qvec`), расширяет 1-hop через `IdeaBlockLink`. Pool по scope:
    - `org` — все canonical блоки тенанта (limit pool=5000).
    - `meeting` — RawEvent(sourceType='meeting', sourceExternalId=meetingId) → IdeaBlockEvidence.rawEventId → blockId.
    - `card` — meetings (Meeting.cardId) ∪ entities (Card.entityId, Card.relatedEntityIds).
    - `theme` — `ThemeIdeaBlock.themeId=scopeId` (theme.tenantId match).
    - `entity` — `IdeaBlockEntity.entityId=scopeId` (block.tenantId match).
  - `ChatV2Service.ask(input)` — собирает контекст блоков (id+name+signalType+trustedAnswer+первая meeting evidence+meeting title), формирует system prompt (базовый + scope-зависимый addon с meeting/card/theme/entity name) + user message (`Контекст:\n[BLOCK:<id>] name (signalType): trustedAnswer\n  Из встречи "<title>" [mm:ss]: "<quote>"\n...` + Вопрос). Подмешивает последние 6 сообщений диалога в system prompt как Q/A блок (роутер Z не поддерживает messages-array нативно — это упрощённый вариант). Парсит `[BLOCK:<id>]` regex'ом для citations и usedBlockIds.

- [x] **Шаг 3 — Switching в `ChatController`.**
  - Существующие endpoints (`POST /meetings/:id/chat`, `POST /chat`, `POST /cards/:id/chat`) при `chatV2Enabled=true` делегируют в `ChatService.askSingleMeetingV2/askCrossMeetingV2/askCardV2`. Те же auth/quota/persist через `ChatRepository`, но retrieval+LLM через `ChatV2Service`. Контракт ответа не меняется.

- [x] **Шаг 4 — Новый unified endpoint `POST /api/v1/chat/v2`.**
  - Body — `ChatV2AskSchema` (scope + scopeId? + query). Реализован в `ChatService.askUnifiedV2`. RBAC под scope:
    - `meeting` — owner-проверка через `meeting.ownerId===userId`.
    - `card` — `cards.getById(cardId, userId)` (owner-проверка).
    - `theme` — `theme.tenantId===tenantId` + `RbacService.canRead(userId, tenantId, 'theme')`.
    - `entity` — `entity.tenantId===tenantId` + `RbacService.canRead(userId, tenantId, 'entity')`.
    - `org` — `RbacService.canRead(userId, tenantId, 'block')`.
  - Quota — `chat_requests_per_day` через `QuotaService` (как в legacy).
  - Persist в `MeetingChatMessage`: для meeting/card — в attached поля; для org/theme/entity — в cross-history (meetingId=null, cardId=null).
  - Возвращает `{message, citations, modelUsed, usedBlockIds}`.
  - При `chatV2Enabled=false` — 503 `chat_v2_disabled`.

- [x] **Шаг 5 — DTO `chat-v2.dto.ts`.**
  - Zod схема с `.refine()` проверкой scopeId для не-org scope.

- [x] **Шаг 6 — регистрация в `KnowledgeCoreModule`.**
  - `ChatV2RetrievalService` + `ChatV2Service` в providers + exports.
  - KnowledgeCoreModule уже `@Global()` — `ChatService` инжектит без отдельного import.
  - `ChatService` дополнительно инжектит `RbacService` (тоже Global).

## Frontend

- [x] **Шаг 7 — `/chat` страница.**
  - `frontend/app/(authenticated)/chat/page.tsx` — server-обёртка с metadata.
  - `frontend/app/(authenticated)/chat/ChatClient.tsx` — `'use client'`. История через `GET /api/v1/chat/history` (legacy, общий с v2 — пишет тот же `MeetingChatMessage`). Отправка через `POST /api/v1/chat/v2 {scope:'org', query}`; при `503 chat_v2_disabled` — fallback на legacy `POST /api/v1/chat` (graceful degradation, фронт не знает про флаг).
  - Citations — pill'ы внизу assistant-сообщения (как в `CardChat`), ссылки на `/meetings/:id/result`.

- [x] **API-клиент `chat.api.ts`.**
  - Добавлены типы `ChatV2Scope`, `ChatV2AskBody`, `ChatV2ResponseApi`.
  - Метод `chatApi.askV2({scope, scopeId?, query})` → `POST /api/v1/chat/v2`.
  - Существующие методы (`sendMeeting/historyMeeting/sendGlobal/historyGlobal`) сохранены без изменений.

- [x] **Sidebar.**
  - Пункт «AI-чат» (`MessageCircle` icon, lucide-react) между «AI-темы» и «Мои встречи».

## Verification

- [x] `bun run typecheck` (backend) — зелёный.
- [x] `bun run typecheck` (frontend) — зелёный.
- [x] БД не меняется в этой фазе (используется существующий `MeetingChatMessage`).

## Что НЕ сделано (вне Фазы 6)

- SSE/streaming для chat — vNext.
- Удаление legacy `chat.service` (single/cross/card paths) — отдельная фаза после A/B.
- UI для scope=theme/entity (страница `/themes/:id/chat`, sidebar entity-deep-link) — vNext.
- Новый CardChat/single-meeting-chat UI с переключением на v2 — пока не нужен (контракт ответа совместим, легаси-UI работает поверх обоих провайдеров).
- Scope-aware history для v2 (отдельная история для theme/entity) — пока используется cross-history (meetingId=null, cardId=null).

## Затронутые файлы

### Backend / config
- `backend/src/common/config/env.schema.ts` — `CHAT_V2_ENABLED`, `CHAT_V2_TOP_BLOCKS`, `CHAT_V2_GRAPH_HOPS`.
- `backend/src/common/config/typed-config.service.ts` — геттеры `cfg.knowledgeCore.chatV2*`.

### Backend / knowledge-core
- `backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts` — новый.
- `backend/src/modules/knowledge-core/services/chat-v2.service.ts` — новый.
- `backend/src/modules/knowledge-core/knowledge-core.module.ts` — providers + exports.

### Backend / chat
- `backend/src/modules/chat/dto/chat-v2.dto.ts` — новый.
- `backend/src/modules/chat/chat.service.ts` — добавлены `askSingleMeetingV2`, `askCrossMeetingV2`, `askCardV2`, `askUnifiedV2`, `resolveScopeAuth`, `toV2History`. Инжект `ChatV2Service`, `RbacService`.
- `backend/src/modules/chat/chat.controller.ts` — switching legacy↔V2 + новый `POST /api/v1/chat/v2`. Инжект `TypedConfigService`.

### Frontend
- `frontend/app/(authenticated)/chat/page.tsx` — новый.
- `frontend/app/(authenticated)/chat/ChatClient.tsx` — новый.
- `frontend/src/api/chat.api.ts` — `askV2` метод + типы.
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункт «AI-чат».

## DoD

- [x] ChatV2Service реализован, поддерживает 5 scope.
- [x] Контроллер switching при ENV ON.
- [x] POST /api/v1/chat/v2 — новый unified endpoint.
- [x] Frontend `/chat` страница работает (org-scope, fallback на legacy).
- [x] Sidebar обновлён.
- [x] backend и frontend typecheck зелёные.
- [x] План phase-6-execution.md и decisions-log дополнены.

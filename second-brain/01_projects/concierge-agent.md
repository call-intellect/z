# Concierge Agent (γ-2)

Главный AI-агент в кабинете компании на главной странице. Tool-use loop с действиями: создать встречу/событие, найти свободный слот, спросить клон роли, поиск по графу и др.

## REST API

- `POST /api/v1/concierge/messages` — SSE-стрим ответа (`started → thinking → tool_call → tool_result → message → done`).
- `POST /api/v1/concierge/messages/once` — polling fallback, один JSON.
- `GET /api/v1/concierge/conversations` / `:id` — история диалогов пользователя.
- `POST /api/v1/concierge/undo/:logId` — откат мутирующего tool-call'а.
- `GET /api/v1/concierge/quota` — текущая квота.

## Pipeline (после ТЗ 2026-05-27 dialog-layer integration)

При `CONCIERGE_DIALOG_LAYER_ENABLED=true` (production, default false):

1. **Quota check** (`OrgConciergeQuota`, Redis token-bucket).
2. **Conversation** — создать/найти `ConciergeConversation`, записать user-message.
3. **Summary в контекст** — `ConciergeConversation.summary` (если есть, пишется cron'ом `concierge-conversation-summarizer.cron` каждые 30 мин для диалогов >20 сообщений и старше часа) подмешивается в user-блок ПЕРЕД историей.
4. **Dialog-layer препроцессинг** — `DialogService.process({ scope: 'concierge', scopeRefId: conv.id })`:
   - **Contextualize**: «а почему?» → standalone-вопрос с учётом истории.
   - **Confidence**: оценка качества standalone (≥ threshold → используем; иначе fallback на raw).
   - **Classify intent**: `factual` | `exploratory` | `analytical` | `clone_roleplay`.
   - **Multi-query expansion**: для `exploratory`/`analytical` — 3 переформулировки. Для `factual` — оригинал.
   - **Answer cache lookup** (Redis): если hit — short-circuit. yield `thinking → message → done` без LLM.
5. **Pre-retrieval** — параллельно по `queries[]` (до 3) через `ToolRouter.execute('search_knowledge')`. Per-query timeout 3000ms (`CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS`), top-K cumulative 12 (`CONCIERGE_PRE_RETRIEVAL_TOP_K`). Skip для `intent='clone_roleplay'`. Дедуп по id. Результаты подаются в system-prompt блоком `=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===` перед whitelist tools.
6. **Tool-use loop** (до 5 итераций):
   - LLM `taskType='concierge-respond'` получает system (контекст + summary + preHits + tool whitelist) + user (effectiveQuestion + история 6 последних + tool results).
   - Парсер ищет JSON `{"tool_call":{"name":"...","arguments":{...}}}`. Если найден — `ToolRouterService.execute()` с RBAC от userId (не bypass), результат идёт обратно в LLM. Если нет — финальный текст.
7. **Persist** — assistant-message с `toolCallsJson` debug-блоком `{ dialogLayer: {...}, preRetrieval: {...} }`. Bump `lastMessageAt`.

При `CONCIERGE_DIALOG_LAYER_ENABLED=false` — legacy путь: только шаги 1, 2, 6, 7. Summary НЕ читается (только в новой ветке), pre-retrieval не запускается, dialog-layer не вызывается.

## Whitelist инструментов (13 шт.)

Static в `backend/src/modules/concierge/services/service-map-generator.service.ts`:

- **Встречи**: `list_meetings`, `create_meeting`, `cancel_meeting` (LiveKit-комнаты).
- **Календарь**: `create_event`, `list_my_events`, `list_user_events`, `find_free_slot`, `delete_event`.
- **Знания**: `search_knowledge` (используется pre-retrieval'ом), `ask_chat_v2`.
- **Задачи**: `list_tasks`.
- **Клоны**: `ask_role_clone`, `list_clones`.

RBAC проверяется внутри `ToolRouterService` от `userId` — concierge **не** bypassit permissions. Мутирующие tool-call'ы фиксируются в `ConciergeUndoLog`, откат через `POST /undo/:logId`.

## Метрики (Prometheus)

- `concierge_messages_total{tenant_top}` — счётчик сообщений.
- `concierge_tool_calls_total{tenant_top, tool, status}` — tool-вызовы.
- `concierge_dialog_layer_used_total{intent}` — сработал dialog-layer препроцессинг (ТЗ 2026-05-27).
- `concierge_cache_hit_total` — short-circuit на AnswerCache (ТЗ 2026-05-27).
- `concierge_pre_retrieval_hits_count` (histogram) — суммарное число hits после dedup, buckets `[0,1,3,5,10,15,25,50]` (ТЗ 2026-05-27).

## ENV

- `CONCIERGE_ENABLED` — мастер-флаг (default true). False → REST возвращает 503.
- `CONCIERGE_DAILY_MESSAGES_LIMIT` — default per-org дневной лимит (default 100).
- `CONCIERGE_MONTHLY_MESSAGES_LIMIT` — месячный (default 3000).
- `CONCIERGE_SSE_HEARTBEAT_SECONDS` — keep-alive interval SSE (default 15).
- `CONCIERGE_DIALOG_LAYER_ENABLED` — фича-флаг pipeline (ТЗ 2026-05-27, default **false**).
- `CONCIERGE_PRE_RETRIEVAL_TOP_K` — cap items после dedup (default 12).
- `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS` — per-query timeout (default 3000).

Все читаются через `process.env` в `TypedConfigService.concierge` (не в `EnvSchema` — `.merge` chain depth, см. комментарий в `typed-config.service.ts`).

## Связанные модули

- `backend/src/modules/dialog-layer/` — препроцессор (см. [knowledge-core.md](../02_architecture/knowledge-core.md)).
- `backend/src/modules/ai/services/llm-router.service.ts` — `taskType='concierge-respond'`.
- `backend/src/modules/rbac/` — `ToolRouter.execute` проверяет permissions от userId.
- Cron `concierge-conversation-summarizer.cron` — пишет `ConciergeConversation.summary`.
- Cron `concierge-quota-reset.cron` — daily/monthly reset.

## Источники

- ТЗ ввода в строй: `plans/tz/2026-05-23-sba-gamma-2-concierge-agent.md`.
- ТЗ dialog-layer integration: `plans/tz/2026-05-27-concierge-dialog-layer-integration.md` (2026-05-27).
- Код: `backend/src/modules/concierge/`.

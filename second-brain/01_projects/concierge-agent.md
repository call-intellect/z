# Concierge Agent (γ-2)

Главный AI-агент в кабинете компании на главной странице. Tool-use loop с действиями: создать встречу/событие, найти свободный слот, спросить клон роли, поиск по графу и др.

## REST API

- `POST /api/v1/concierge/messages` — SSE-стрим ответа (`started → thinking → tool_call → tool_result → message → done`). Body (`PostConciergeMessageBodySchema`) с 2026-06-28 принимает опц. `scope?` / `scopeRefId?` / `asOf?` — Мастер протаскивает их в `chatV2.askEphemeral` (оба пути: `dispatchAskChatV2` и `resumeClarify`), питая scoped-чат (issue/org/…) и снимок «на дату».
- `POST /api/v1/concierge/messages/once` — polling fallback, один JSON. Те же `scope?/scopeRefId?/asOf?`.
- `GET /api/v1/concierge/conversations` — история диалогов пользователя; с 2026-06-28 каждая запись несёт `titlePreview` (первое user-сообщение, обрезано до 80 симв., хелпер `backend/src/modules/concierge/concierge-title-preview.ts`) — фронт берёт его для названия диалога вместо «Новый диалог». `:id` — конкретный диалог.
- `POST /api/v1/concierge/undo/:logId` — откат мутирующего tool-call'а.
- `GET /api/v1/concierge/quota` — текущая квота.

**SSE-эвент `message`** несёт (фронт `ConciergeStreamEvent`, 2026-06-28): текст + `citations` (passthrough из chat-v2) + `needsClarification`; добавлен эвент `confirm_required` (preview подтверждения мутации). Эти поля питают единый дом Мастера `/chat` (`MasterChatHome`) и scoped-чат `MasterScopedChat` — см. [[frontend-pages]] §`/chat`.

## Квоты — две ступени (ТЗ 2026-05-31)

Concierge участвует в **единой per-user дневной квоте AI-общения** вместе с клонами. Квота двухступенчатая:

1. **Per-user (главная, ТЗ 2026-05-31)** — `AiChatQuotaService` (модуль `ai-chat-quota`, глобальный): один счётчик `ai_chat_messages_per_day` на пользователя, считает Concierge + клоны вместе. Лимит зависит от роли в Org: admin (owner/admin/coo) → `AI_CHAT_DAILY_LIMIT_ADMIN=50`, остальные → `AI_CHAT_DAILY_LIMIT_MEMBER=20`. UI читает через `GET /api/v1/me/ai-chat/quota`. На превышении — 429 + `QuotaExceededError`.
2. **Per-Org safety-net (остаётся)** — `ConciergeQuotaService` (`OrgConciergeQuota`, Redis token-bucket) с дневным `CONCIERGE_DAILY_MESSAGES_LIMIT` и месячным `CONCIERGE_MONTHLY_MESSAGES_LIMIT`. Защищает Org от abuse в сумме по всем пользователям; ловит SSE-эвент `quota_exceeded`.

Порядок проверки в pipeline: per-user сначала (через `AiChatQuotaService.tryConsume`), затем per-Org safety-net.

## Pipeline — single-pass (после ТЗ 2026-06-25 «Единый помощник» Ф2, заменил ReAct-петлю)

> ТЗ [`plans/tz/2026-06-25-edinyy-pomoshnik-arhitektura.md`](../../plans/tz/2026-06-25-edinyy-pomoshnik-arhitektura.md) (Ф2, коммиты `6a430537`/`e5fb42d6`/`01bb3958`). **ReAct-петля `for i<maxSteps` убрана** (корень прод-бага с сырым JSON-дампом). Удалены: loop-guard (`concierge/utils/loop-guard.ts`), `buildPartialAnswer`, `passthrough` как частный случай, обёртка-инструмент `ask_chat_v2`, мёртвый `clarifyMinConfidence`-gate, крутилки `concierge.max_steps` / `rag.loop_guard_threshold`. Понимание/синтез по-прежнему считаются **один раз внутри chat-v2** (помощник не владеет пониманием запроса).

1. **Quota check** — per-user (`AiChatQuotaService.tryConsume`) + per-Org safety-net (`OrgConciergeQuota`, Redis token-bucket).
2. **Conversation** — создать/найти `ConciergeConversation`, записать user-message; `summary` пишется cron'ом `concierge-conversation-summarizer.cron`.
3. **Слой 1 — детерминированный перехват ДО LLM** (`isClarifyPending(history)` и др.): открытый probe → probe-handler; pending confirm → выполнить/отменить; **pending clarify → реплика возвращается в исходный вопрос chat-v2** (`resumeClarify` → `chatV2.askEphemeral`); ждём чек-ин → handler. Канальный перехват — Redis-ключ `concierge:clarify:<bindingId>` (`assistant-channel.bridge` ставит/снимает; telegram+max адаптеры читают первым → форсят `assistant_turn`).
4. **Слой 2 — один LLM-вызов `concierge-respond`** (диспетчер): system (контекст + «Сейчас»+TZ + tool whitelist + company-about tail) + user (вопрос + история + summary). Возврат: `answer | action{tool,args} | note | checkin_self`. Native function-calling (прод-дефолт ON, `concierge.native_tools_enabled`); legacy regex-парсер `{"tool_call":{...}}` — fallback.
5. **Слой 3 — один проход, ≤1 инструмент:**
   - `answer` → `chatV2.askEphemeral({history,summary,intent,scope?,scopeRefId?})` **в процессе** (memoryless — без своей `ChatV2Conversation`); ответ (текст + цитаты) отдаётся **слово-в-слово** (passthrough — правило для всего `answer`-пути: не порвать `[BLOCK:id]`, не вернуть выдумку, не просадить качество вторым проходом).
   - `action` → один инструмент через `ToolRouterService.execute()` (RBAC от userId, не bypass; мутация → confirm) + один **render-вызов** статуса (отдельный `CONCIERGE_RENDER_SYSTEM_PROMPT`, без JSON-утечки).
   - `note` → ingest (короткий статус), `checkin_self` → DailyCheckIn.
6. **Persist** — assistant-message с `toolCallsJson`. Bump `lastMessageAt`. Confirm-hold (канал) / inline (кабинет), undo (`ConciergeUndoLog`), quota, события — сохранены.

**Модель Мастера** — `concierge-respond`→`gpt-5.4-mini` через `LlmTaskRoute` (Ф6, сид `seed-llm-task-routes-edinyy-pomoshnik.ts`). Цепочка chat-v2 (4 вызова) — [[chat-v2]] / [[../02_architecture/knowledge-core]] §«Единый помощник».

**«Сейчас» + таймзона в контексте (ТЗ 2026-06-18 assistant-calendar, Ф2).** `ConciergeContextBuilderService.build` первой строкой системного контекста кладёт «Сейчас: дата (день недели), время по таймзоне (IANA)…», чтобы помощник правильно понимал «сегодня»/«на этой неделе» и считал окно дня для `find_free_slot`. Таймзона человека резолвится по цепочке **`Person.timezone → Org.timezone → Europe/Moscow`** (у `User` поля `timezone` НЕТ). Утилиты локального времени — `operations/utils/local-date.ts`. Когда `Person.timezone` пуст — добавляется контекст-подсказка, и помощник проактивно спрашивает таймзону (инструмент `set_my_work_profile`).

## Whitelist инструментов

Static в `backend/src/modules/concierge/services/service-map-generator.service.ts`:

- **Встречи**: `list_meetings` (журнал встреч **без фильтра даты**), `create_meeting`, `cancel_meeting` (LiveKit-комнаты).
- **Календарь**: `create_event`, `list_my_events` (события **календаря/сегодня в TZ человека** — отличие от `list_meetings` прописано в описаниях, ТЗ 2026-06-18 Ф7), `list_user_events`, `find_free_slot`, `delete_event`, `make_event_online` (сделать событие онлайн → видеокомната LiveKit, ТЗ 2026-06-18 Ф6).
- **Знания**: `ask_chat_v2` — единственный терминальный путь к памяти компании (прежний `search_knowledge` удалён). Его ответ (текст + цитаты) отдаётся пользователю как есть.
- **Задачи трекера**: `create_task` (поставить задачу себе в «Входящие»), `assign_task` (поставить задачу ДРУГОМУ сотруднику по имени — отдельный от `create_task`, `POST /api/v1/me/tasks/assign`, обязательны `title`+`assigneeName`, в whitelist self, мутация → требует подтверждения; **с 2026-06-22 зовётся даже при неясном исполнителе** — задача создаётся ВСЕГДА, при нерезолве поднимается probe `task.assignee_unresolved` и ответ `needsAssignee`+candidates, не 404, см. [[tracker]] / [[probe-agent]]), `search_tasks` (мои задачи трекера); `ingest_note` (занести мысль/факт в память). `list_tasks` — legacy действия-задачи из встреч.
- **Клоны**: `ask_role_clone`, `list_clones`.
- **Pulse/директор**: `get_person_pulse`, `list_overdue_promises`, `get_sprint_status`, `get_team_health`, `list_ignored_probe_questions`.
- **Smart-tables**: `infer_table_schema` (превью схемы таблицы, без создания).
- **Профиль**: `set_my_work_profile` — выставить свой рабочий профиль (таймзона/часы/дни на `Person`, ТЗ 2026-06-18 Ф4); помощник проактивно спрашивает таймзону, когда `Person.timezone` пуст.

RBAC проверяется внутри `ToolRouterService` от `userId` — concierge **не** bypassit permissions. Мутирующие tool-call'ы фиксируются в `ConciergeUndoLog`, откат через `POST /undo/:logId`.

## Человекочитаемый preview подтверждения (2026-06-20)

Перед мутацией помощник показывает текст подтверждения на русском без сырых англ. ключей. `buildConfirmPreview` (`concierge.service.ts`) переводит имя инструмента через `CONFIRM_TOOL_RU_NAMES` и параметры через `PARAM_RU_LABELS`; даты прогоняются через util `backend/src/common/utils/format-ru-date.ts` (`formatRuDate`: `2026-06-20`→«20 июня»). Например, `assign_task` показывает «Поставить задачу …, исполнитель …, срок 20 июня» вместо `title`/`assigneeName`/`dueDate`.

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

## Голосовой ввод (Voice Streaming WebSocket, T4 δ-3)

**Архитектурное правило:** Concierge отвечает **только текстом**. Голосовой ВВОД — да (микрофон → ASR), голосового ВЫВОДА нет (никакой кнопки «Слушать», `voiceMode toggle`). TTS-эндпоинт `/api/v1/voice/synthesize` существует как примитив, но в Concierge-flow НЕ интегрируется (см. memory `feedback_concierge_text_only_output.md`).

- **Backend `backend/src/modules/voice/gateways/voice-stream.gateway.ts`** — namespace `/ws/voice`. Auth — тот же JWT-flow, что у `/ws/tracker` (`handshake.auth.token` / cookie `z_session` / `Authorization: Bearer` + jti revocation + membership в tenant). События client→server: `voice:start {sampleRate, mimeType}` → ack `{ok, sessionId, ttlSec}`, `voice:chunk {data}`, `voice:end`, `voice:cancel`. Server→client: `voice:transcribed {text, durationMs, latencyMs}`, `voice:error {code, message}`. Лимит 1 сессия на пользователя (новый коннект отменяет старую), buffer cap, ASR через `VoiceChannelAdapter` (Vox submit+poll, p50 ≥ 2 сек — streaming-ASR в TODO).
- **Frontend** — хук `frontend/src/hooks/concierge/useVoiceStream.ts` (`open`/`sendChunk`/`end`/`cancel`, graceful REST-fallback на `POST /api/v1/voice/transcribe` при WS-проблемах) и компонент `frontend/src/ui/concierge/ConciergeVoice.tsx` (кнопка-микрофон, MediaRecorder → chunks, транскрипт дописывается в текстовое поле Concierge для правки перед отправкой).

## Источники

- ТЗ ввода в строй: `plans/archive/2026-05-23-sba-gamma-2-concierge-agent.md`.
- ТЗ dialog-layer integration: `plans/archive/2026-05-27-concierge-dialog-layer-integration.md` (2026-05-27).
- ТЗ assistant-router-dedup: `plans/archive/2026-06-14-assistant-router-dedup-and-prompt.md` (понимание/синтез только в chat-v2).
- Код: `backend/src/modules/concierge/`, `backend/src/modules/voice/`.

# Аудит: единый ли роутер приёма каналов → задачи/решения/идеи/граф (2026-06-22)

> Вопрос владельца: «есть ли общий роутер, в который со всех каналов (помощник веб/Telegram, видеовстреча, аудио, Bitrix, ChatBox, в будущем API) поступает контент, и оттуда достаются задачи/решения/идеи/граф? Насколько это реализовано — каналов может стать 20-30».
>
> Метод: read-only картография кода (6 параллельных агентов, vexp + чтение). Это АНАЛИЗ, не ТЗ.

## 0. TL;DR

| Слой | Единый роутер? | Готовность к 20-30 каналам |
|---|---|---|
| **Граф знаний** (решения/идеи/инсайты/цели/сущности) | ✅ **ДА** — `IngestService.ingest()` → `RawEvent` → специалисты по `signalType` | **высокая** — новый канал = 1 адаптер или generic API, без правок ядра |
| **Задачи** | ⚠️ **НЕТ** — 5 разных путей, 2 модели (`Issue`/`Task`), 4 резолвера | **низкая** — каждый канал тянет задачи отдельно |
| **Помощник** (веб + Telegram/MAX) | ✅ **ДА** — один `ConciergeService.process()` (intent→tool-call), но это командный слой ПОВЕРХ, не приём в граф | n/a |

Твоя модель «общий роутер, куда всё сходится» — **верна для графа знаний** и **не выполняется для задач**. Помощник — отдельный (но внутренне единый) командный роутер, и это правильно.

## 1. Единый спайн графа — РЕАЛЬНО ЕСТЬ (`RawEvent`)

Все каналы сходятся в **один метод** [`IngestService.ingest()`](../../backend/src/modules/ingest/ingest.service.ts#L40): резолв `Source` → checksum + `idempotencyKey` → `RawEvent(processingStatus='received')` → `enqueueRawReceived` в очередь `core.raw-events`. Это **единственное** место в коде, где вызываются `rawEvent.create` и `enqueueRawReceived` (verified grep). Параллельного пути в граф нет ни у одного канала.

```
[любой канал] → Source(type) → IngestService.ingest() → RawEvent → core.raw-events
   → block-ingest.worker (LLM extract) → IdeaBlock + Evidence + сущности графа
   → block-distill.worker (KNN-дедуп, канонизация)
   → RouterService.dispatch(signalType) → core.specialist-routing
   → специалисты слоя 3 (decisions/ideas/insights/goals/...)
```

### Инвентаризация каналов (14 `SourceType`, [schema.prisma:251](../../backend/prisma/schema.prisma#L251))

| Канал | Точка входа | sourceType |
|---|---|---|
| Видеовстреча LiveKit | analyze.worker → [meeting.adapter](../../backend/src/modules/ingest/adapters/meeting.adapter.ts#L107) | meeting |
| **Загруженное аудио/видео** | [POST /meetings/upload](../../backend/src/modules/meeting-uploads/meeting-uploads.controller.ts#L49) → Meeting(upload) → тот же meeting.adapter | meeting |
| Bitrix24 (IM-диалоги + CRM-дайджест) | [bitrix-ingest.service](../../backend/src/modules/bitrix/bitrix-ingest.service.ts#L304) | bitrix |
| ChatBox (клиентский чат) | [chatbox-ingest.service](../../backend/src/modules/chatbox/chatbox-ingest.service.ts#L328) | chatbox |
| Telegram-группа (источник) | [POST /ingest/telegram/:id](../../backend/src/modules/ingest/adapters/telegram/telegram.controller.ts#L105) | chat/bot |
| Telegram/MAX-бот (free_note) | [conversational-ingest.adapter](../../backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts#L37) | conversational |
| Веб-кабинет (свободная заметка) | [POST /conversational/notifications/free-note](../../backend/src/modules/conversational/conversational.controller.ts#L239) | conversational |
| Документы (PDF/DOCX/импорт ZIP/Confluence) | [documents.controller](../../backend/src/modules/documents/documents.controller.ts#L79) → document.adapter | external |
| Почта (IMAP) | [email-fetch.service](../../backend/src/modules/ingest/adapters/email/email-fetch.service.ts#L144) | email |
| Телефония (Mango, ASR через Vox) | [mango.controller](../../backend/src/modules/ingest/adapters/phone-call/mango.controller.ts#L17) | phone_call |
| Внутренний трекер (события задач) | [tracker.adapter](../../backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts#L149) `@OnEvent` | tracker_event |
| Ежедневные чек-ины | [checkin-ingest.service](../../backend/src/modules/operations/services/checkin-ingest.service.ts#L188) | daily_checkin |
| Отчёт встречи (вторичный) | [report.adapter](../../backend/src/modules/ingest/adapters/report.adapter.ts#L85) | meeting_report |
| **Внешний API (generic)** | [POST /api/v1/ingest](../../backend/src/modules/ingest/ingest.controller.ts#L32) (любой JSON) | external |

> «Аудио-сообщение» как отдельного канала нет — загруженное аудио = upload-встреча, идёт по конвейеру встреч.

## 2. Решения/идеи/инсайты/цели — извлекаются ЕДИНО, по `signalType` (канал-агностично)

Специалисты ([specialist-3-3-decisions.worker:32](../../backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts#L27) и др.) работают **поверх `IdeaBlock` по `blockId`** и про источник ничего не знают. Маршрутизация — статический `switch(signalType)` в [router.service:251](../../backend/src/modules/knowledge-core/services/router.service.ts#L251) (`decision/rationale→3-3`, `idea/feature_request→3-6`, `pain/risk→3-5`, `commitment/plan_item→3-14`), **не по каналу**. У ChatBox/Bitrix своего экстрактора решений НЕТ — они зовут тот же `IngestService.ingest()`.

Единственная асимметрия: **combined-fast-path** (1 LLM-вызов на 9 сущностей) — meeting-only ([specialists-combined.worker:80](../../backend/src/modules/knowledge-core/workers/specialists-combined.worker.ts#L80) требует `meetingId`). Для не-meeting каналов работает поштучный `router.dispatch`. Итог тот же (те же Decision/Idea/Insight/Goal) — различается лишь форма (батч vs N точечных), это перф-деталь, не отдельный путь.

## 3. ЗАДАЧИ — фрагментировано (исключение из единства)

Здесь твоя модель «всё из общего роутера» **не выполняется**. Задачи извлекаются **не** из общего спайна (`IdeaBlock` используется лишь как `sourceBlockIds`-provenance), а **каждым каналом отдельно**:

| # | Путь | Источник | Куда | Резолвер |
|---|---|---|---|---|
| 1 | [meeting-extract-actions](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L120) | транскрипт встречи | `IntakeIssue` | TaskAssigneeResolver (участники) |
| 2 | [meeting-report-fast.worker:416](../../backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L416) | тот же транскрипт | legacy `Task` (за флагом) | свой |
| 3 | [chatbox-analyze.worker](../../backend/src/modules/chatbox/chatbox-analyze.worker.ts#L156) | chatbox-сессия | legacy `Task` | свой (responsibleExternalId) |
| 4 | [telegram-task-parser](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-task-parser.service.ts#L95) | текст бота | `IntakeIssue` | свой (substring по имени) |
| 5 | [me-tasks.service](../../backend/src/modules/tracker/services/me-tasks.service.ts#L67) (помощник) | фраза помощнику | `Issue` напрямую | AssigneeResolver (строгий, 404/409) |

**Проблемы:** 2 несведённые модели (`Issue` vs `Task`), **4+ разных резолвера исполнителя** с разным поведением при промахе, **2 почти идентичных дедуп-сервиса** ([cross-source](../../backend/src/modules/chatbox/cross-source-task-dedupe.service.ts#L73) и [meeting-task-dedupe](../../backend/src/modules/meetings/meeting-task-dedupe.service.ts#L36) — копипаст), дедуп чатов не видит трекерные `Issue`. `intake-auto-triage` — общий **хвост** лишь 2 из 5 путей, не общий вход. Это ровно то, что частично лечил unified-fix-ТЗ (A2 и др.), но глубокая унификация (единое извлечение задач со спайна, один резолвер, один дедуп, одна модель) **не сделана**.

## 4. Помощник (Concierge) — отдельный, но внутренне единый командный роутер

Веб и Telegram/MAX доходят до **одного** [`ConciergeService.process()`](../../backend/src/modules/concierge/services/concierge.service.ts#L151) (LLM intent→tool-call, до 5 итераций). Разница только в транспорте: веб зовёт синхронно в HTTP, Telegram кладёт в очередь `assistant.inbound` → фоновый воркер → [тот же роутер](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L90). Это **realtime-командный слой ПОВЕРХ графа**, он сам в граф **не пишет** (только `ConciergeMessage`-память). Действия исполняет HTTP-loopback'ом на свои REST-эндпоинты ([tool-router](../../backend/src/modules/concierge/services/tool-router.service.ts#L49)). В граф попадает только tool `ingest_note` → free-note; остальные (assign_task/create_meeting) — как побочный продукт своих доменов. То есть помощник — **не канал приёма**, а оркестратор действий.

## 5. Новый канал #20 — насколько готово

**Чтобы попасть в ГРАФ — нужен 1 адаптер, ядро не трогается:**
- Завести `Source` через готовый [POST /api/v1/sources](../../backend/src/modules/sources/sources.controller.ts#L41) (тип `external` → без миграции enum).
- Слать в готовый generic [POST /api/v1/ingest](../../backend/src/modules/ingest/ingest.controller.ts#L32) (`payload: z.unknown` — любой JSON) с per-Org ключом `zik_*` ([ingest-token.guard](../../backend/src/modules/ingest/guards/ingest-token.guard.ts#L35)), ИЛИ написать тонкий in-process адаптер ~100 строк по образцу `TrackerAdapter`.
- `block-ingest` **генерик по sourceType** (нет `switch`); [SegmentBuilder](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L81) имеет catch-all fallback (`JSON.stringify`) → канал работает даже без правок; для чистоты — 1 ветка парсинга payload.
- **Внешняя система может начать слать события сегодня без единой строки нового бэкенд-кода** (нужны лишь Source + ключ).

**Чтобы пошли ЗАДАЧИ — ⚠️ ПОПРАВКА (red-team опроверг по коду, 2026-06-22):** ранее тут утверждалось «канал кладёт `signalTypeHint` → `RouterService` сам диспатчит задачи в specialist». **Это НЕВЕРНО.** В `router.service.ts` `commitment`/`plan_item` маршрутизируются в **`3-14-goals` (ЦЕЛИ), не задачи**; task-sink в диспетчере **нет** — задачи извлекаются 5 кустарными путями МИМО спайна signalType (только completion-сигнал `done_item` частично интегрирован через `TaskCompletionHandler`). Значит «задачи из нового канала» сегодня **не идут автоматически** — это требует достройки спайна (новый task-`signalType` + case в router + task-specialist). Полный разбор и решение → [unified-extraction-spine-and-modular-extractors](2026-06-22-unified-extraction-spine-and-modular-extractors.md).

**Оговорки роста (не блокеры расширения):**
- Авто-захват «выполнено» из СВОБОДНОГО текста (без явного `signalTypeHint`) сейчас ненадёжен — общий незакрытый класс для всех каналов (см. `plans/tz/2026-06-22-task-resolution-loop-and-cross-channel-completion.md`).
- Тарифный гейт `featureForType` покрывает только bot/email/phone_call/web_form — для новых типов гейтинг добавлять осознанно, если нужен.
- Новое значение `SourceType` (если не переиспользовать `external`) = миграция Prisma + prod-deploy Шаг 4.

## 6. Вывод и рекомендация

- **Граф знаний** — архитектурно зрелый single-funnel, **готов к 20-30 каналам** уже сейчас. Точка расширения ровно одна (`IngestService.ingest`), generic API + ключи + Source CRUD уже есть.
- **Задачи** — главный долг: их извлечение **не** живёт на общем спайне, оно размазано по 5 каналам с дублированием резолверов/дедупа и двумя моделями. Это не мешает добавить канал в граф, но означает, что «задачи из нового канала» придётся подключать точечно, пока не унифицируем.
- **Рекомендация (кандидат на отдельное ТЗ):** свести извлечение задач на общий спайн — единый `TaskExtraction` поверх `IdeaBlock`/`signalType` (как у решений/идей), один резолвер исполнителя, один дедуп-слой, схлопнуть `Task`→`Issue`. Тогда «единый роутер» станет правдой и для задач, и новый канал #20 будет давать задачи бесплатно, как уже даёт решения/идеи.

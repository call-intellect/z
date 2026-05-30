---
name: meeting-post-processing
title: Пост-обработка видеовстречи (от завершения до памяти компании)
trigger_type: webhook
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт встреч
  - инженер AI-pipeline
related_plans:
  - plans/tz/2026-05-08-mvp-fullstack-tz.md
  - plans/tz/2026-05-10-knowledge-core-tz.md
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
related_projects:
  - 01_projects/meeting-types.md
  - 01_projects/recording.md
  - 01_projects/meeting-report-pipeline.md
  - 01_projects/ai-analysis-by-type.md
  - 01_projects/ingest-and-sources.md
---

# Пост-обработка видеовстречи

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Когда видеовстреча в Z заканчивается, начинается невидимая для пользователя работа. Платформа сама делает всё, что обычно делает «секретарь» — сохраняет запись, расшифровывает речь, размечает кто что сказал, пишет отчёт под тип встречи (продажа, планёрка, ретроспектива и так далее) и **складывает извлечённые факты в память компании** — в общий граф знаний, где живут решения, идеи, регламенты, инсайты, проекты и клиенты.

Главная идея: **встреча не заканчивается, когда участники нажали «Покинуть».** Она заканчивается, когда из её содержимого вытащено всё полезное — кто что пообещал, какие решения приняли, какие проблемы всплыли, какие идеи прозвучали — и этим обогащены клон должности (что знает этот сотрудник), карточка клиента (на каком этапе сделка), реестр решений компании, радар проблем и список идей сотрудников. Только тогда встреча становится частью второго мозга компании.

Сейчас часть этой цепочки **полностью работает в проде** (запись, расшифровка, отчёт хосту, попадание фактов в граф). Часть — **работает частично или по половинной схеме** (специалисты Слоя 3 обрабатывают факты через общий ingest, но не через выделенную маршрутизацию; клон должности пересобирается не по событию «встреча кончилась», а по своему расписанию). Этот документ честно фиксирует — где как именно.

## 2. Что запускает (триггер)

- **Тип:** внешний вебхук от LiveKit.
- **Что инициирует:** в комнате LiveKit все участники ушли и/или записывающий процесс (egress) завершил выгрузку файлов. LiveKit-сервер шлёт нам HTTP-запрос «вот, всё кончилось».
- **Технический источник:** `POST /api/v1/webhooks/livekit` (контроллер `LivekitWebhooksController`).

## 3. Шаги процесса (общий список)

1. **LiveKit сообщает «встреча закончилась».** Платформа сохраняет событие, проверяет подпись, дедуплицирует, переводит встречу в статус «завершена».
2. **Записи сохраняются в облако.** Общая видеозапись (composite) и отдельные аудиодорожки каждого участника скачиваются из LiveKit и кладутся в S3.
3. **Каждая аудиодорожка распознаётся отдельно** (ASR), реплики собираются в единый транскрипт с метками «кто-когда-что сказал».
4. **Платформа определяет, кто из говоривших — какой участник** (зарегистрированный сотрудник или гость), и привязывает реплики к ролям.
5. **Создаётся AI-отчёт под тип встречи** — главы, список задач (action items), оценка качества встречи, текстовое саммари.
6. **Содержимое встречи превращается в сырое событие** (RawEvent) и попадает на конвейер графа знаний.
7. **Специалисты Слоя 3 разбирают факты** — решения попадают в реестр решений, идеи — в реестр идей, инсайты — на радар проблем, регламенты — в библиотеку процессов компании, проекты и клиенты обновляются.
8. **Карточки клиента/проекта пересчитываются** — у каждой задетой карточки обновляется саммари и при необходимости создаётся версия для подтверждения куратором.
9. **Хосту приходит уведомление**, что отчёт готов — он открывает встречу и видит готовую страницу результата.

## 4. Что получается на выходе

- **Хосту встречи:** уведомление + страница встречи `/meetings/[id]` с записью, транскриптом, AI-отчётом, главами, задачами.
- **Графу знаний компании:** новые `IdeaBlock`-и (атомарные факты), `Entity`-связи, новые/обновлённые `Decision`, `Insight`, `Idea`, `Regulation`.
- **Карточкам клиентов/проектов:** обновлённое саммари в `Card`, новые версии `CardVersion` (если нужна валидация).
- **Клону должности** (γ-1): источник новых наблюдений (через те же RawEvent), пересборка идёт по своему расписанию, не сразу.
- **Видно пользователю:** страница встречи `/meetings/[id]`, дашборд `/dashboard`, реестры `/decisions`, `/insights`, `/ideas`, `/regulations`.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | LiveKit прислал webhook | Проверка подписи, дедуп по `eventId`, FSM `active → completed → recording_processing` | `backend/src/modules/webhooks/livekit-webhooks.controller.ts:39`, `livekit-webhooks.service.ts:77`, `livekit-events.handler.ts:148` | `POST /api/v1/webhooks/livekit` | `WebhookSeenEvent`, `MeetingEvent`, `Meeting.status` | ✅ |
| 2 | Сохранение записи | На `room_started` — старт composite egress (если `recordByDefault`); на `track_published` — отдельный egress на каждую аудиодорожку; на `egress_ended` — скачивание файлов из LiveKit в S3 | `backend/src/modules/webhooks/livekit-events.handler.ts:132,240,264,286,355` | webhook events (`room_started`, `track_published`, `egress_started`, `egress_ended`) | `Recording`, `AudioTrack`, `Meeting.status (recording_ready)` | ✅ |
| 3 | Транскрибация | На `recording_ready` ставится job в `ai.transcribe`; воркер тянет каждую `.ogg`-дорожку из S3, шлёт в Vox/GigaAM (через `proxy.agent-lia.ru`), пуллит результаты, складывает в `TranscriptTrack`; затем `ai.merge` собирает единый транскрипт | `backend/src/modules/ai/workers/transcribe.worker.ts:35`, `vox.service.ts:101`, `merge.worker.ts` | `ai.transcribe`, `ai.merge` | `TranscriptTrack`, `Transcript`, `Meeting.status (transcription_ready)` | ✅ |
| 4 | Идентификация участников | Каждый `AudioTrack.livekitIdentity` матчится с `Participant`, заполняется `AudioTrack.participantId`, оттуда берётся имя и роль (host/guest) | `backend/src/modules/recordings/recordings.service.ts` | inline в `transcribe.worker` + `merge.worker` | `AudioTrack.participantId`, `Participant` | ✅ |
| 5 | AI-отчёт по типу встречи | На `transcription_ready` стартует `ai.analyze`: общий промпт + type-specific (через `getPromptForType()` или `PromptResolver` из БД-реестра); параллельные стадии `ai.chapters`, `ai.tasks`, `ai.embeddings`, `ai.behavior-metrics`, `ai.quality-score`; параллельно — `core.meeting-report-fast` (chapters+tasks+quality за один LLM-вызов) | `backend/src/modules/ai/workers/analyze.worker.ts:150,210,287,302`, `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts` | `ai.analyze`, `ai.chapters`, `ai.tasks`, `ai.embeddings`, `ai.behavior-metrics`, `ai.quality-score`, `core.meeting-report-fast` | `AiResult`, `MeetingChapter`, `Task`, `MeetingQualityScore`, `Meeting.status (ai_ready)` | ✅ (fast-репорт частично — автоэнкью в Фазе 4) |
| 6 | Создание RawEvent для графа знаний | В блоке `catch` `AnalyzeWorker` (best-effort, не блокирующий) вызывается `MeetingIngestAdapter.ingestMeeting(meetingId)` → создаёт `RawEvent(sourceType='meeting', payload=транскрипт+метаданные)` и ставит в `core.raw-events` | `backend/src/modules/ai/workers/analyze.worker.ts:328`, `backend/src/modules/ingest/adapters/meeting.adapter.ts` | `core.raw-events` | `RawEvent`, `Source` | ✅ |
| 7а | Извлечение фактов (block-ingest) | Consumer `core.raw-events` → `BlockIngestWorker`: сегментирование транскрипта, LLM `block-ingest` → `IdeaBlock` + `IdeaBlockEvidence` + `IdeaBlockEntity` (с propertySpans для таймкодов) + эмбеддинги; затем `core.block-distill` и `core.block-linker` | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:1,70,87`, `block-linker.worker.ts` | `core.raw-events`, `core.block-distill`, `core.block-linker` | `IdeaBlock`, `IdeaBlockEvidence`, `IdeaBlockEntity`, `IdeaBlockLink` | ✅ |
| 7б | Специалисты Слоя 3 (3-1 регламенты / 3-3 решения / 3-4 проект-клиент / 3-5 инсайты / 3-6 идеи) | По signalType блока должен запускаться выделенный consumer в `core.specialist-routing` (jobName=`3-1-regulations` и т.д.) | `backend/src/modules/knowledge-core/workers/<specialist>-*.worker.ts` | `core.specialist-routing` | `Decision`, `Regulation`, `Insight`, `Idea`, `Card` (как client/project) | ⚠️ частично — routing работает для части специалистов, ряд `signalType` пока обрабатывается только базовым ingest |
| 8 | Card-rollup карточек клиентов и проектов | `BlockLinker` находит затронутые карточки → `core.card-rollup-v2` (debounce 60s) → `CardRollupV2Worker` собирает все блоки карточки, LLM пересчитывает саммари, `CurationService.triage` решает auto-apply vs пендинг конфликт-резолюции | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts`, `card-rollup-v2.worker.ts:83`, `block-linker.worker.ts` | `core.block-linker`, `core.card-rollup-v2` | `Card.summary`, `CardVersion`, `CurationItem` | ✅ |
| 9 | Уведомление хосту | `MeetingEvent.ai_notified` + (в идеале) `NotificationDispatcher.sendNotification(eventType='meeting.report_ready')` → in-app + Telegram + email по предпочтению канала | `backend/src/modules/ai/workers/notify.worker.ts`, `backend/src/modules/conversational/conversational.service.ts` | `ai.notify`, `conversational.send` | `MeetingEvent`, `Notification` | ⚠️ MVP-режим: `MeetingEvent.ai_notified` пишется всегда, в Telegram/email уходит не во всех конфигурациях |

### 5.1 Структура данных, через которую проходит процесс

```
Meeting (FSM)
  ↓ webhook room_finished
  ↓ webhook egress_ended
Recording (composite mp4) + AudioTrack[] (per-participant ogg)
  ↓ ai.transcribe / ai.merge
TranscriptTrack[]  →  Transcript (unified turns)
  ↓ ai.analyze (+ parallel: chapters/tasks/embeddings/behavior/quality)
AiResult + MeetingChapter[] + Task[] + MeetingQualityScore
  ↓ MeetingIngestAdapter.ingestMeeting (best-effort)
RawEvent (sourceType='meeting')
  ↓ core.raw-events / BlockIngestWorker
IdeaBlock[] + IdeaBlockEvidence[] + IdeaBlockEntity[]
  ↓ core.block-linker / core.card-rollup-v2
Card.summary + CardVersion (если конфликт-резолюция)
  ↓ core.specialist-routing (по signalType)
Decision | Regulation | Insight | Idea | (обновление Card.kind=client/project)
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 5 (общий отчёт) | `meeting-analyze` + type-specific (`sales`, `planning`, `retro`, …) | DeepSeek V4 Flash / Pro | OpenAI gpt-5.4-mini → Ollama qwen3.5:9b | `backend/src/modules/ai/services/prompts/index.ts` + БД-реестр через `PromptResolver` |
| 5 (fast) | `meeting-report-fast` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3.5:9b | `backend/src/modules/ai/services/prompts/meeting-report-fast.prompt.ts` |
| 7а | `block-ingest` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama | `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts` |
| 7б | `regulation-extract`, `decision-extract`, `decision-supersede-detect`, `insight-extract`, `insight-link-to-decisions`, `knowledge-clone-extract`, … | DeepSeek V4 Flash / Pro | OpenAI mini/nano → Ollama qwen3:30b/qwen3.5:9b | модули специалистов в `backend/src/modules/knowledge-core/prompts/` |
| 8 | `card-rollup-summary` (kind-specific × 5 видов карточек) | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama | `backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompt.ts` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `livekit_webhook_events_total{type, dedup}` — приём вебхуков LiveKit
- `meetings_finished_total{type}` — встречи по типу
- `ai_pipeline_duration_seconds{stage, type, model}` — длительность каждого воркера
- `core_block_ingest_total{tenant_top, status}` — извлечение блоков
- `core_specialist_routing_total{job_name, status}` — маршрутизация в специалисты
- `core_card_rollup_v2_total{kind, status}` — пересборка карточек

**BullMQ очереди** (видно в `/admin/platform/workers`):
- Медиа: `ai.transcribe`, `ai.merge`
- AI-отчёт: `ai.analyze`, `ai.chapters`, `ai.tasks`, `ai.embeddings`, `ai.behavior-metrics`, `ai.quality-score`, `ai.notify`, `core.meeting-report-fast`
- Граф: `core.raw-events`, `core.block-distill`, `core.block-linker`, `core.card-rollup-v2`, `core.specialist-routing`, `core.entity-resolver`
- Доставка: `conversational.send`

**Логи:** контекст `trace`, имена логгеров `LivekitEventsHandler`, `TranscribeWorker`, `AnalyzeWorker`, `BlockIngestWorker`, `CardRollupV2Worker`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- LiveKit webhook'и приходят дублями — поэтому `WebhookSeenEvent` обязателен.
- ASR-биллинг — длительность по дорожке считается отдельно, общая длительность встречи = сумма не делает.
- Egress per-track ставится **на каждое `track_published`**, не одной командой при `room_finished`.

**Кнопки админки:** `/admin/platform/workers` — повторить упавший job, `/admin/meetings/[id]/debug` (если есть) — посмотреть FSM, артефакты.

## 7. Связанные процессы

- [[meeting-create-and-invite]] — создание встречи и приглашение гостя (предшествует этому процессу).
- [[meeting-in-progress]] — что происходит во время встречи (порождает данные, которые здесь обрабатываются).
- [[meeting-end-and-recording]] — частично пересекается со Шагом 2 (детали записи и egress).
- [[raw-event-to-graph]] — Шаг 6-7а здесь, описан подробно отдельно.
- [[specialist-3-1-regulations]], [[specialist-3-3-decisions]], [[specialist-3-4-project-customer]], [[specialist-3-5-insights]], [[specialist-3-6-ideas]] — Шаг 7б, каждый — отдельный процесс.
- [[card-rollup-v2]] — Шаг 8, описан подробно отдельно.
- [[specialist-gamma-1-skill-clone]] — клон должности обновляется по своему расписанию, не синхронно с этим процессом.
- [[notification-dispatch]] — Шаг 9, описан подробно отдельно.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, но реализовано частично:**
- **Специалист 3-1 (Регламенты), 3-3 (Решения), 3-5 (Инсайты), 3-6 (Идеи) через `core.specialist-routing`** — routing есть в архитектуре, для части `signalType` обрабатывается базовым `block-ingest` с decision-fallback. Полная маршрутизация по jobName-у — Фаза 4 умбреллы `2026-05-22-final-roadmap.md`.
- **Авто-доставка отчёта в Telegram/email** — `MeetingEvent.ai_notified` ставится всегда, но отправка через `NotificationDispatcher` не во всех контурах. См. `notify.worker.ts`.

**Заложено в ТЗ, не реализовано:**
- **Skill-profile rebuild по событию «встреча закончилась» (γ-1)** — пересборка идёт по своему cron (`weekly persona snapshot person+role`), не реактивно. Реактивный режим заявлен в `2026-05-25-clone-reliability-hardening.md` (Фаза 5), частично — кнопка ручного rebuild.

**Реализовано, но не описано в ТЗ:**
- **Best-effort `try/catch` ingest в `AnalyzeWorker`** — если ingest упадёт, AI-отчёт всё равно отдастся пользователю, только warning в логи.
- **Debounce 60s в `core.card-rollup-v2`** — сглаживает серии быстрых встреч про одного клиента в один rollup.
- **Параллельный `core.meeting-report-fast`** — fast-репорт работает параллельно с `ai.analyze`, переключение «fast по умолчанию» — Фаза 4-5.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | Параллельный `meeting-report-fast` | [[01_projects/meeting-report-pipeline]] |
| 2026-05-25 | `core.specialist-routing` запущен | [[05_история/2026-05-25-kc-temporal-and-clones-roles-implementation]] |
| 2026-05-10 | `core.raw-events` + meeting-adapter + block-ingest | [[01_projects/ingest-and-sources]] |

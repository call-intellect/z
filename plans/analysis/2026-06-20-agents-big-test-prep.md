---
title: Подготовка к большому тестированию системы агентов Коры («комета») — структура, данные, синтетика, методология
date: 2026-06-20
status: analysis (готово к согласованию владельцем; реализация инструментов — после «go»)
author: Claude (по запросу владельца Сергея)
covers: каталог агентов · недавняя петля закрытия задач + ответ «двигается ли карточка сама» · где лежат сырые данные (встречи + chatbox + Bitrix) · как делать синтетику · итеративная методология теста на реальных LLM-вызовах · бриф-роль агента-тестировщика
verified_by_code: да (6-агентный fan-out по dev, 167 обращений к коду, 2026-06-20)
related:
  - plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md   # каталог агентов по реальному звонку
  - plans/analysis/2026-06-06-agents-brain-clones-test-plan.md      # предыдущий ПРЕДВАРИТЕЛЬНЫЙ план (этот его финализирует)
  - plans/tz/2026-06-16-knowledge-core-MASTER.md                    # волны 0-6, где появилась петля закрытия
  - plans/tz/2026-06-16-task-dedup-and-tracker-reconcile.md         # Ф2/Ф3/Ф4 петли закрытия задач
  - second-brain/02_architecture/ai-agents-map.md                   # главная карта агентов
  - second-brain/02_architecture/knowledge-core.md                  # ядро графа
  - second-brain/01_projects/ai-jobs.md                             # реестр taskType
  - second-brain/01_projects/workers-queues.md                      # реестр очередей/cron
---

# Подготовка к большому тестированию агентов Коры

> **Зачем документ.** Владелец готовит большой прогон системы агентов: понять, что у нас за модуль («комета»), что в нём недавно поменялось, где лежат сырые данные за последнюю неделю (встречи кабинета `svmazur@mail.ru` + переписки из чат-бокса/Bitrix), как прогнать всех агентов на реальных и на синтетических данных через **реальные LLM-вызовы**, итеративно правя промпты до идеала. Этот файл — **структура и аналитика**, которую дальше отдаём отдельному **агенту-тестировщику** (бриф-роль — §11). Всё ниже **сверено по коду** (ветка `dev`, 2026-06-20), а не по памяти.
>
> **Статус:** готово к согласованию. Развилки для владельца — §10. После «go» по ним финализируем бриф §11 и строим недостающие инструменты §9.

---

## 1. Что такое «комета» — модуль агентов

«Комета» из формулировки задачи («модуль, где ~30-40 агентов, достаются задачи и решения») — это связка двух backend-модулей:

- **`knowledge-core`** — ядро продукта (граф знаний). Pipeline: `RawEvent → IdeaBlock(draft→canonical) → специалисты Слоя-3 → граф (связи/темы) → клоны`.
- **`ai/` + `operations/`** — конвейер встречи (запись→ASR→отчёт) и слой «операционного директора» (пульс, обещания, доведение решений).

По факту кода это **~106 самостоятельных агентов** (каждое место, где код сам вызывает LLM или по cron/событию извлекает/материализует сущности). «Ядро ~30-40» из формулировки = **pipeline ingest + 14 специалистов Слоя-3 + клоны** — именно оно извлекает задачи и решения. Полный счёт больше, потому что в один реестр сведены ещё медиа, COO-операции, probe/курация и диалог с человеком.

### 1.1. Карта по слоям (счётчик)

| Слой | Кол-во | Что делает | Где описан |
|---|---|---|---|
| Медиа (запись/ASR/merge/upload/клипы) | ~10 | звук→текст, склейка дорожек, нормализация | `workers-queues.md` |
| Отчёт встречи | 5 | summary, главы, **задачи**, оценка качества | `ai-analysis-by-type.md` |
| Pipeline ingest + cron-граф | ~16 | блоки-идеи, дедуп, связи (7 типов), сущности, темы, ночное переосмысление | `knowledge-core.md` |
| **Специалисты Слоя-3** (14 handler'ов) | 14 (+probe/clusterer ≈25) | типизация блоков в **решения/идеи/инсайты/регламенты/навыки/цели/задачи** | `ai-agents-map.md` |
| Клоны и персоны | 14 | навыки роли → профиль знаний → исполняемая персона клона | `skill-and-clone.md`, `knowledge-clone.md` |
| COO-операции | ~23 | пульс, обещания, доведение решений, дайджесты, риски | (нет единого файла — пробел) |
| Probe / курация / конфликты | ~6 | уточняющие вопросы, лестница доверия, арбитраж конфликтов | `probe`/`curation` |
| Диалог с человеком | 5 | помощник (concierge), AI-чат компании (chat-v2), orchestrator | `frontend-contexts-hooks.md`, `api-layer.md` |

> Полная пронумерованная таблица всех ~106 агентов (класс · описание · `файл:строка` · `taskType` · триггер · что пишет) собрана в приложении к этой сессии (вывод разведки) — переносится в §А ниже по согласованию. Источник правды о составе специалистов — `specialist-routing-dispatcher.worker.ts:87-100` (ровно **14 handler'ов**, а не «9» как в части документации — см. §1.4).

### 1.2. Кто извлекает ЗАДАЧИ (Task / Issue)

- `AnalyzeWorker` (legacy v2-отчёт, taskType `tasks`) — [analyze.worker.ts](backend/src/modules/ai/workers/analyze.worker.ts)
- `TaskExtractionService` (taskType `tasks`) — [task-extraction.service.ts](backend/src/modules/ai/services/task-extraction.service.ts)
- `MeetingReportFastWorker` (taskType `meeting-report-fast`, **основной путь**) — [meeting-report-fast.worker.ts](backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts)
- `MeetingExtractActionsService` (taskType `meeting-extract-actions`, голос→трекер) — [meeting-extract-actions.service.ts](backend/src/modules/tracker/services/meeting-extract-actions.service.ts)
- `IntakeAutoTriageWorker` (taskType `intake-auto-triage`/`issue-infer-fields`) — авто-приём задач из всех каналов
- `TaskReconcileCron` + `TaskCompletionHandler` (taskType `task-closure-verify`) — **петля закрытия** (см. §3)

### 1.3. Кто извлекает РЕШЕНИЯ (Decision)

- **Единственный профильный экстрактор — Specialist 3-3** `Specialist33DecisionsWorker` — [specialist-3-3-decisions.service.ts:73](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L73), taskType `decision-extract` + `decision-supersede-detect`. Пишет `Decision` + supersede-цепочку, эскалирует в конфликты, всегда идёт через deep-review.
- Сопутствующие (обслуживают, не извлекают): `SpecialistsCombinedWorker` (8 типов одним вызовом, флаг OFF), `Specialist33ProbeService` (probe по решениям overdue/outcome_unknown), `DecisionImplementationCron` (доведение решений до внедрения), `MultiAgentDebateService`/`ConflictArbiterCron` (арбитраж supersede).

### 1.4. Расхождения «документация ↔ код» (учесть при тесте)

1. **14, а не 9 специалистов.** `ai-agents-map.md` пишет «девять». Источник правды — `specialist-routing-dispatcher.worker.ts:87-100`. Не описаны в «девятке»: `personal-relation`, `role-map`, `process-detector`, `3-14-goals`, `3-13-sprint-helper`, `3-8-helpfulness`.
2. **`meeting-analyze-v2.worker/.cron` в коде нет** — отчёт идёт через `merge.worker → meeting-report-fast.worker` (+ legacy `analyze.worker`). Не искать v2-cron.
3. **«Специалист 3-9» = `ExperimentDetectorWorker`** (`SPECIALIST_NAME = EXPERIMENT_TRACKER`); имя 3-9 живёт только в сервисе/probe.
4. **Пласт COO-агентов** (~23) карта `ai-agents-map.md` недосчитывает.
5. **`SpecialistsCombinedWorker` за флагом OFF** — по умолчанию работают 14 раздельных специалистов.

> **Действие для second-brain (после теста):** актуализировать `ai-agents-map.md` под 14 специалистов и дописать недостающий файл-каталог COO-агентов. Это пробел документации, вскрытый разведкой.

---

## 2. Документы, где это лежит (раздел «ссылки на описание агентов»)

| Что | Файл |
|---|---|
| **Главная карта агентов** (модули, цепочки vs одиночки, probe) | [second-brain/02_architecture/ai-agents-map.md](second-brain/02_architecture/ai-agents-map.md) |
| Функциональная «лупа» M1-M9 (~127 taskType по способностям) | [second-brain/02_architecture/agent-modules.md](second-brain/02_architecture/agent-modules.md) |
| Ядро графа: pipeline, mapping signalType→специалист | [second-brain/02_architecture/knowledge-core.md](second-brain/02_architecture/knowledge-core.md) |
| Реестр taskType и LLM-цепочек | [second-brain/01_projects/ai-jobs.md](second-brain/01_projects/ai-jobs.md) |
| Реестр BullMQ-очередей, воркеров, @Cron | [second-brain/01_projects/workers-queues.md](second-brain/01_projects/workers-queues.md) |
| Шаблоны отчёта по 14 типам встреч | [second-brain/01_projects/ai-analysis-by-type.md](second-brain/01_projects/ai-analysis-by-type.md) |
| Клоны ролей | [second-brain/01_projects/skill-and-clone.md](second-brain/01_projects/skill-and-clone.md), [knowledge-clone.md](second-brain/01_projects/knowledge-clone.md) |
| Разбор реального звонка + оценка каждого агента | [plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md](plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md) |
| Предыдущий (предварительный) тест-план | [plans/analysis/2026-06-06-agents-brain-clones-test-plan.md](plans/analysis/2026-06-06-agents-brain-clones-test-plan.md) |
| Методология промптов (анатомия SYSTEM, эталоны) | [docs/methodology/prompts/README.md](docs/methodology/prompts/README.md) + `examples/` |

---

## 3. Что недавно поменялось: петля закрытия задач + ответ про карточку трекера

Главное нововведение, про которое спрашивал владелец («зациклили процесс, чтобы находить решение») — это **Волна 4 «task-dedup»** мастер-релиза knowledge-core (17-06, ТЗ `2026-06-16-task-dedup-and-tracker-reconcile.md`). Добавлена **петля «разговор → кандидат закрытия задачи»** (зеркало уже работавшей петли обещаний).

### 3.1. Полный путь петли (по коду)

1. Разговор (встреча/чат/Bitrix) → конвейер усвоения создаёт canonical-`IdeaBlock` с `signalType ∈ {task_completed, task_status_changed, done_item}` ([signal-type-label.ts:57,66,68](backend/src/modules/knowledge-core/prompts/signal-type-label.ts#L57)).
2. Router эмитит событие `task.completion_signalled` ([router.service.ts:379-399](backend/src/modules/knowledge-core/services/router.service.ts#L379)). Раньше эти сигналы были no-op — «сделал» никуда не шёл.
3. Handler ловит ([task-completion.handler.ts:93](backend/src/modules/operations/services/task-completion.handler.ts#L93)):
   - **гард от зацикливания**: если сигнал пришёл из самого трекера (`sourceType==='tracker_event'`) → стоп (чтобы ручное закрытие не порождало новый кандидат);
   - kill-switch `taskClosure.enabled` (ON);
   - синхронный embed текста блока (таймаут 2500 мс);
   - **семантический KNN среди ОТКРЫТЫХ задач**; матч ниже порога `taskClosure.matchThreshold` (default **0.85**) → стоп;
   - **LLM-верификатор `task-closure-verify`** «правда ли выполнена» (с анти-инъекцией); `done=false/null` → стоп;
   - создаётся `TaskClosureCandidate(status='pending')` идемпотентно. **Issue при этом НЕ трогается.**
4. Кандидат попадает в очередь «ждёт человека» (`TaskClosurePendingProvider`), видят owner/admin.
5. **Человек подтверждает → только тогда карточка переходит в «Готово».**
6. `TaskReconcileCron` (ежедневно 03:00) добирает потерянное через event-bus и протухает старые кандидаты; считает `task_closure_reopen_rate`; **никогда сам не закрывает Issue.**

«Loop» здесь — в смысле «замкнули контур память↔исполнение», а **не** бесконечный цикл (от него стоит явный гард).

### 3.2. ❓ ВОПРОС ВЛАДЕЛЬЦА: карточка двигается сама?

**Однозначный ответ: НЕТ. Карточка трекера сама не передвигается.** Автоматически создаётся только обратимый «кандидат на закрытие» (`TaskClosureCandidate`, статус `pending`). Перевод карточки в категорию `completed` происходит **исключительно по подтверждению человека**.

- Единственное место, где из этого контура реально вызывается переход в `completed` — [pending-actions.service.ts:524](backend/src/modules/pending-actions/services/pending-actions.service.ts#L524) (`transitionState(... completed ...)`), и оно лежит внутри `confirmTaskClosure`, который вызывается **только** из пользовательского `confirm()`.
- В самом `TaskCompletionHandler` вызовов `transitionState`/`issue.update` нет — это зафиксированный инвариант (`task-completion.handler.ts:54-56`).
- **Флага авто-перехода нет.** Близкий по имени `taskClosure.autoConfirmThreshold` (0.95) — это НЕ авто-движение: он лишь помечает кандидат `canQuickConfirm=true` («один клик»), но клик делает человек (`task-closure.provider.ts:120`).

**Авто-движение карточки есть только на ВХОДЕ:** задача из встречи создаётся автоматически как `Issue` при уверенности ≥ `tracker.autoAcceptConfidenceThreshold` (**default 0.75**, [intake-auto-triage.worker.ts:278](backend/src/modules/tracker/workers/intake-auto-triage.worker.ts#L278)) и отсутствии подозрения на дубль; иначе уходит человеку в `/intake`. Это **создание**, а не закрытие.

### 3.3. FSM задачи (Issue)

Статус задачи — FK на `IssueState`, категория `IssueState.category ∈ {backlog | unstarted | started | completed | cancelled}` ([schema.prisma:9020](backend/prisma/schema.prisma#L9020)). Отдельная ось — review-пометка `Issue.closureReviewState` (`null` | `superseded_decision`, миграция `20260617002427`). Категорию двигает только `transitionState`/`transitionToCategory`; каждый авто-источник либо требует human-confirm, либо ставит только review-флаг (не закрывает).

---

## 4. Корень бага «на 2 встречах задачи не создаются»

**Это не «строгий промпт», а детерминированный гейт качества в коде** ([task-quality-gate.util.ts:111](backend/src/modules/tracker/services/task-quality-gate.util.ts#L111), `shouldMaterializeTask`). Для источника `meeting` задача материализуется, только если **(форма НЕ вопрос/намерение) И (есть исполнитель ИЛИ срок)**. Без исполнителя и без срока → `reason: 'no_owner_no_due'`, задача молча отбрасывается ([meeting-extract-actions.service.ts:340-354](backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L340)).

Дополнительно: исполнитель резолвится **только среди реальных участников встречи по identity** — если в синтетической встрече нет `Participant` с совпадающим именем, hint не станет `suggestedAssigneeId`, и спасает только явный срок в тексте.

**Следствие для тестирования:** чтобы агент «обязан был» создать задачу, реплика-поручение должна содержать **и исполнителя** (имя реального участника), **и срок** («Ольга, подготовь 50 заданий **до пятницы**»). Это ключ к дизайну синтетики (§7) и к интерпретации реальных встреч.

---

## 5. Где лежат сырые данные + рецепт выгрузки за неделю

### 5.1. Карта хранения

| Тип данных | Где | Поле с сырым содержимым | Доступно через |
|---|---|---|---|
| Транскрипт встречи (склеенный) | `Transcript` (one-to-one к `Meeting`) | `turns` (JSON: `{speaker,text,startSec,endSec}`) | **только БД** (diag/API отдают лишь «turns=да/нет, слов=N») |
| Транскрипт по дорожкам (до merge) | `TranscriptTrack` | `transcriptText`, `words`, `segments` | только БД |
| Запись/аудиодорожки (S3) | `Recording`, `AudioTrack` | `mainVideoUrl`, `audioUrl` (S3-ключи) | только БД (URL) → S3-клиент |
| Отчёт встречи (AI) | `AiResult` (+ `MeetingReport`) | `summary`, `structuredData`, `summaryFast`, `followUpEmail` | **`diag report --meeting <id>`** ✅ |
| Мост в граф (любой источник) | `RawEvent` | `payload.fullText` / `payload.transcript.turns` (или `payloadS3Key`) | только БД |
| Диалоги chatbox | `ChatboxChat` (+ `ChatboxChatSession` посуточно) | `rollingSummary`, `raw`; session `summary` | **REST `GET /api/v1/chatbox/chats`** ✅ |
| Сообщения chatbox | `ChatboxMessage` | `text` (сырой) | **REST `/chatbox/chats/:id/messages`** ✅ |
| Диалоги Bitrix (IM) | `BitrixDialog` (+ `BitrixDialogSession`) | `rollingSummary`, `raw`; session `summary` | только БД |
| Сообщения Bitrix (IM) | `BitrixMessage` | `text` (сырой) | только БД |
| CRM Bitrix (контакты/сделки/лиды) | `BitrixContact/Company/Deal/Lead`, `BitrixCrmNote` | `name/title/text`, `raw` | только БД |

**Узкое место:** сырой текст транскрипта встреч и сообщений Bitrix **не отдаётся ни diag, ни Admin API** — живёт только в БД. Для офлайн-анализа нужен новый read-only export-скрипт (§9).

### 5.2. Как сырьё попадает в граф

Все источники нормализуются в `RawEvent` единым payload-контрактом `{ fullText, transcript: { turns: [{speaker, text, authorPersonId}] } }`. Chatbox/Bitrix режут сквозной чат на посуточные `*Session` (одна сессия = один LLM-вызов `generateDayRollup` = один `RawEvent`). Поэтому «диалог за период» в графе = набор сессий за эти дни.

Ручная подтяжка за период (если надо дотянуть свежее):
- Bitrix: `POST /api/v1/bitrix/integration/sync?scope=dialogs&since=<ISO>`
- ChatBox: `POST /api/v1/chatbox/integration/sync` body `{scope:'chats', since}`

### 5.3. РЕЦЕПТ: выгрузить всё по `svmazur@mail.ru` за 7 дней

> ⚠️ Тестовый кабинет — на домене **`korateam.ru`** (не `meet.crossmark.ru`, на который diag смотрит по умолчанию). Задать `DIAG_API_BASE=https://korateam.ru`. Прод-доступ — **только с явным «да» владельца в сессии** (`feedback_prod_diagnostic_access_requires_confirmation`).

1. **Найти tenantId:** `diag.ts orgs --search svmazur --json` → `id` = `tenantId`, `ownerId`.
2. **Встречи + отчёты (готово из коробки):** `diag.ts meetings --owner <ownerId> --json` (фильтр по дате локально); по каждой — `diag.ts report --meeting <id> --json`, при нужде `diag.ts trace/llm-calls --meeting <id>`.
3. **Chatbox (готово из коробки):** REST `GET /chatbox/chats` → по каждому `GET /chatbox/chats/:id/messages` (cookie `z_session` + `x-org-id: TENANT`).
4. **Сырой транскрипт встреч + Bitrix-диалоги + RawEvent.payload (нужен новый скрипт):** `backend/scripts/export-tenant-corpus.ts` (§9) — прямой read-only доступ к БД за окно `[now-7d, now]`, по `tenantId`, в файлы `meetings.json` / `raw-events.json` / `bitrix-dialogs.json` / `chatbox.json`.

---

## 6. Промпты: где лежат и как менять (это решает весь способ итерации)

В Коре **два разных хранилища промптов**:

| Класс | Где промпт | Правка для теста | Реальный прогон |
|---|---|---|---|
| **Отчёт по типу встречи** (`summary`/`tasks`/`chapters`/`follow-up`/custom — 13 типов) | БД `PromptTemplate`+`PromptTemplateVersion` (+ code-fallback `prompts/type-*.ts`) | через админку `/admin/prompt-templates` без деплоя | встроенный **preview-эндпоинт** `POST /admin/prompt-templates/:id/preview` (реальный вызов на demo-транскрипте; rate-limit 10/час, cost-cap $0.2, зашит `taskType:'summary'`) |
| **Все остальные ~120 агентов** (специалисты, probe, dialog, clone, tracker, COO…) | **константы `*_SYSTEM_PROMPT` в коде** (`*.prompt.ts`), в БД их нет | правка файла → пересборка (либо вероятностный GEPA-кандидат `PromptCandidate`) | **готового «прогнать 1 агента» скрипта НЕТ** — пробел, см. §9 (`agent-replay.ts`) |

Маршрутизация провайдеров — единая для обоих классов через `LlmRouterService.call({ taskType })` ([llm-router.service.ts:1478](backend/src/modules/ai/services/llm-router.service.ts#L1478)). Список всех taskType — `ALL_LLM_TASK_TYPES` (runtime-массив, **168 элементов**, `llm-router.service.ts:664`). Маршруты `taskType→провайдер` смотреть `diag-routes.ts`.

**Как увидеть фактический промпт+ответ+провайдера+цену реального прогона:** каждый вызов пишется в `AiUsageLog` (`requestPreview`/`responsePreview`, до 8KB; `provider/model/tier/costUsd/tokens`). Читать: `diag.ts llm-calls --meeting <id>` → `diag.ts call <aiUsageLogId>`.

**Провайдеры/ключи** (через `TypedConfigService`/`env.schema.ts`, не `process.env`): DeepSeek (primary), OpenAI-proxy `proxy.agent-lia.ru` (secondary), KIE/Gemini (tertiary в дефолт-цепочке), Ollama (private/localOnly), MiniMax, Anthropic (sensitive). dataClass-фильтр отсекает провайдеров по классу данных.

---

## 7. Синтетические данные: подход + фикстуры по агентам

### 7.1. Два пути создания данных (ключевая развилка)

- **Демо-сид «ТехноСтрим»** ([seed-demo-workspace.ts](backend/scripts/seed-demo-workspace.ts)) кладёт результат **прямо в БД, минуя конвейер** (готовые `ai_ready`-встречи, готовый граф). Годится для UI-витрины, **НЕ для проверки агентов**.
- **Combat/agent-quality harness** ([agent-quality-harness.ts](backend/scripts/agent-quality-harness.ts) + [combat-harness.ts](backend/scripts/_lib/combat-harness.ts)) **прогоняет реальный конвейер**: создаёт синтетический тенант, кладёт `Meeting`+`Transcript` и job в очередь `ai.analyze`/вбрасывает `RawEvent` (`injectRawEventDirect`), ждёт результат, читает извлечённые сущности. Защита `assertNotProd`. **Это и есть готовая платформа для синтетики.**
- **Точечные `scripts/eval/smoke-*.ts`** (~30 шт.) — вызывают один промпт/агент изолированно (без БД/очередей), импортируя боевой промпт. Самый дешёвый способ проверить «сработал ли конкретный агент на конкретном тексте».

### 7.2. Формат входа

**Транскрипт встречи** (`Transcript.turns`, формат harness-фикстуры):
```jsonc
{
  "id": "team-planning", "variant": "clean",   // clean | asr_garbled
  "title": "Планёрка команды", "meetingType": "team",
  "transcript": { "turns": [ {"speaker":"Дмитрий Козлов","text":"…","startSec":0,"endSec":11}, … ] },
  "golden": { "tasks": [ {"title":"Нанять 2 разработчиков","keyFacts":["2"]} ], "decisions": ["Переходим на 2-недельные спринты"] }
}
```
Внимание: harness использует `startSec/endSec`, demo-data — `startMs/endMs`. Для синтетики под harness — `startSec/endSec`.

**Диалог chatbox** — те же turns, спикеры `Клиент [Имя]` / `Менеджер [Имя]`; впрыск через `injectRawEventDirect` с `sourceType='chatbox'`, `dataClass='sensitive'`.

### 7.3. Фикстуры «по одной на агента» (что обязан содержать текст)

Конвейер: сегмент → `signalType` → специалист по signalType. **Чтобы агент обязан был сработать, текст должен порождать блок нужного signalType с явными атрибутами.**

| Агент | signalType | Что ОБЯЗАН содержать текст | Критерий успеха |
|---|---|---|---|
| `meeting-extract-actions` (задачи) | — (по транскрипту) | поручение: действие + **исполнитель = имя участника** + **срок**; НЕ вопрос/«надо бы» | создан `IntakeIssue(source='meeting')` с `suggestedAssigneeId`/`suggestedDueDate` |
| `specialist-3-3-decisions` | `decision` (+`rationale`) | принятое решение + обоснование/альтернатива, прош. время | `Decision` с `statement`+`rationale` |
| `specialist-3-1-regulations` | `regulation`/`process_step` | норма компании «как делаем всегда» + шаги/роли/срок, `isOrgNorm` | `Regulation` с `kind`+`statement`, confidence≥0.9 |
| `specialist-3-5-insights` | `pain`/`risk`/`churn_risk` | боль/риск с причиной и следствием | `Insight` с `severity`+`causeCategory`+`mitigation` |
| `specialist-3-7-skills` | `reasoning` (≥3 у 1 человека) | ≥3 реплики одного названного сотрудника с ходом мысли/методом | `SkillTrait` по этому Person, гипотезная формулировка |
| `specialist-3-14-goals` | `goal` | измеримая цель с метрикой/горизонтом | `Goal`-запись |
| `task-closure-verify` | `task_completed`/`done_item` + **открытая задача** | двухходовка: (1) встреча создаёт задачу; (2) разговор с явным завершением, близким по смыслу (KNN 0.85) | `TaskClosureCandidate(pending)`, `done=true` (задача НЕ закрывается авто) |
| `idea-extract` (3-6) | `idea`/`feature_request` | конкретное предложение/запрос с источником | `Idea` с `kind`+`statement`+`rationale` |
| `entity-resolver` | `person` + алиасы | один человек разными формами в разных репликах/встречах | одна `Entity(person)` с алиасами, без дублей |

Общее для любой фикстуры: ≥3-4 содержательных turn с именами; для агентов «по человеку» — имена спикеров = создаваемые `Person`/`Participant`; числа/сроки писать словами-и-цифрами; делать пару `clean` + `asr_garbled`.

### 7.4. Чем генерировать и как помечать

- **LLM-генерация транскриптов под каждый кейс** — допустима и рекомендуется (генерим диалог 4-8 реплик с гарантированным целевым сигналом + параллельно `golden`-ожидание).
- Хранить в `backend/scripts/fixtures/agent-golden/<agent>.<variant>.json` — harness подхватит сам.
- **Маркировка/чистка** (три согласованные схемы): (1) изолированный синтетический тенант harness (`teardownTenant` чистит всё) — **самый чистый**; (2) поле `externalSource='qa-test'` (тривиальная `deleteMany`); (3) префикс `[QA-test]` в `title`/`roomName`/`Org.name`.

---

## 8. Методология теста: итеративный цикл на реальных вызовах

Цель владельца — **рабочий инструмент исследователя промпта** (не блокирующий CI-гейт; по политике проекта golden не блокирует выкат — `feedback_no_golden_ship_and_observe_prod`). Цикл: **прогон агента (реальный LLM) → оценка выхода → правка промпта → повторный прогон → diff → пока не идеал.**

### 8.1. Что уже есть (3 слоя, все делают реальные вызовы)

- **Слой A — e2e через конвейер:** `agent-quality-harness.ts` гонит фикстуру через очередь `ai.analyze`, читает `Task`/`Decision`, считает рубрику `scoreExtraction` (completeness/precision/dupeRate) + **baseline-diff Δ ДО→ПОСЛЕ** (`agent-scoring.ts:138`). Покрывает только задачи и решения.
- **Слой B — прямой вызов одного агента (БЕЗ БД):** ~30 `scripts/eval/*` импортируют боевые промпты, дёргают модель, проверяют JSON. Подвиды: smoke (жив ли), **golden+инварианты** (`run-skill-trait-detect-golden.ts` — эталон: 25 фикстур, `checkInvariants`, passRate valid/reject, стоимость), **A/B + LLM-judge** (`run-specialists.ts` + `judge-specialists.ts` с рандом-маскировкой вариантов). **Это лучшая база для итерации.**
- **Слой C — LLM-judge как паттерн** (`judge*.ts`: строгий system + tool `submit_judgement` 1-5 по критериям + маскировка). Переиспользуем для авто-оценки «мягких» выходов.
- **GEPA** (`infra/gepa/`, Python-контейнер) — авто-эволюция промптов от прод-feedback, **НЕ ручной инструмент тестировщика** (подсмотреть только формат судьи/датасета).
- **Учёт стоимости:** runtime — `AiUsageLog`/`LlmModelPrice`; eval — локально в отчёте (`computeCost` с учётом кэша; кэш-хит DeepSeek ≈ в 120× дешевле).

### 8.2. Чего не хватает (дописать — §9)

1. Нет «промпта как переменной» — слой B импортирует промпт статически; нет «прогони с этим кандидатом, не трогая код».
2. Нет сквозного diff между двумя прогонами одного агента (есть только в слое A для tasks/decisions).
3. Нет общего раннера «1 агент × набор входов × произвольный промпт» (каждый агент — копипаста ~120 строк).
4. Нет единого оценщика «рубрика ∪ судья → число + объяснение».
5. Нет фиксации «дошли до идеала» (порог + история «версия промпта → скор»).

### 8.3. Дизайн итеративного харнесса (поверх слоя B)

- **Вход** — immutable-фикстуры в git (`test/eval/<agent>/fixtures/*.json`), 5-15 на агента (smoke + краевые reject/garbled). Единственная меняющаяся переменная — промпт.
- **Версии промпта** — отдельные файлы `test/eval/<agent>/prompts/vNN.system.txt` (НЕ редактируем `.prompt.ts` до победы); хэш = id версии.
- **Прогоны** — `test/eval/<agent>/runs/<promptHash>-<ts>.json` (вход, промпт-хэш, выход, скор, токены, стоимость).
- **Оценка (3 уровня по агенту):** детерминированная рубрика (`scoreExtraction`/`checkInvariants`, $0) для извлечения с известным ожиданием; LLM-judge для «мягких» выходов; глазами (отчёт печатает `responsePreview`).
- **Diff** — `Δ passRate / Δ avgScore / Δ cost / Δ ms` + список FAIL→PASS и PASS→FAIL (регрессии сразу видны).
- **«Идеал»** — порог на агента (напр. `valid passRate=1.0 && reject passRate=1.0`, или `avg judge ≥4.5/5 && 0 регрессий`), держащийся стабильно при **N=3 прогонах** (LLM недетерминирован).
- **Победивший промпт** — переносим из `vNN.system.txt` в боевой `.prompt.ts` (через `z-ai-agent-rules`: реестр + code-fallback + patch-скрипт), обычный ship-and-observe.

---

## 9. Инструменты к доработке (что построить до прогона)

| # | Инструмент | Зачем | На чём строить |
|---|---|---|---|
| И-1 | `backend/scripts/export-tenant-corpus.ts` (read-only) | выгрузить сырой транскрипт встреч + Bitrix-диалоги + RawEvent.payload за период (нет в diag/API) | прямой Prisma (`createPrismaClient()`), образец — diag-скрипты |
| И-2 | `backend/scripts/agent-replay.ts` | прогнать ОДИН `taskType` на заданном транскрипте с реальным LLM, показать вход+выход+цену | поверх `router.call` + `_smoke-shared.ts` |
| И-3 | M1: override промпта файлом (`--prompt-file`) | менять промпт-кандидат, не трогая `.prompt.ts` | расширение `_smoke-shared.ts` |
| И-4 | M2: единый табличный раннер агентов | свернуть 30 копипаст-скриптов в строки таблицы `{taskType→{system,userTemplate,schema,fixtures}}` | `_smoke-shared.ts` |
| И-5 | M3: run-store + `diff <runA> <runB>` | сравнивать прогоны по-агентно/по-фикстурно | формат `SmokeReport`/golden-report |
| И-6 | M4: единый оценщик `score(output,expected)` | рубрика ∪ judge → `{score, perCriterion, explain, cost}` | `agent-scoring.ts` + `judge-*.ts` |
| И-7 | (опц.) расширение `diag` «снимок графа» | counts блоков/связей/тем/сущностей/специалистов/клонов per-Org (из предыдущего плана Ф0) | бьёт в `/knowledge/*`, `/org-admin/knowledge/*` |

> Все скрипты в `backend/scripts/` — `createPrismaClient()` из `_lib/prisma.ts` (Prisma 7 ломает голый `new PrismaClient()`); ключи — корневой `.env` (`--env-file=c:/work/z/.env`); на проде — через `docker compose exec backend bun run scripts/...`.

---

## 10. Развилки для владельца (на согласование)

| # | Развилка | Рекомендация (первая — рекомендую) | Почему |
|---|---|---|---|
| Р-1 | **Окружение прогона** | Гибрид: итеративный цикл (слой B) + e2e (harness) — на **dev/локально в изолированном синтетическом тенанте** (реальные LLM-вызовы, без БД-прода, авто-чистка); прод-кабинет `korateam.ru` — только read-only забор реальных данных и финальная визуальная приёмка | мусор синтетики не летит в боевой граф; `assertNotProd` защищает; дёшево и воспроизводимо |
| Р-2 | **Объём инструментов** | Построить И-1…И-6 (export + replay + харнесс M1-M4); И-7 (diag-снимок графа) — опционально позже | без replay/override нельзя итеративно крутить ~120 промптов; export нужен для реальных данных |
| Р-3 | **Прод-доступ к `korateam.ru`** для забора реальных встреч/переписок за неделю | Нужно явное «да» на read-only diag в эту сессию (токены/куки не в чат) | правило `feedback_prod_diagnostic_access_requires_confirmation` — подтверждение не переносится между сессиями |
| Р-4 | **Приоритет агентов** | Начать с тех, что извлекают **задачи и решения** (прямой запрос): `meeting-extract-actions`, `tasks`/`meeting-report-fast`, `specialist-3-3-decisions`, `task-closure-verify`, `entity-resolver`; дальше — остальные специалисты | это «ядро кометы» и фокус владельца; на них же проверяем баг §4 |
| Р-5 | **Формат хэндоффа** | Standalone orchestrator-prompt + роль тестировщика (§11 финализируем после Р-1…Р-4) | другой агент берёт в работу без переспросов |

### ✅ Решения владельца (2026-06-20)

- **Р-1 → Гибрид:** dev-стенд + изолированный синтетический тенант для прогонов; прод-кабинет `korateam.ru` — только read-only забор реальных данных и финальная визуальная приёмка.
- **Р-2 → Строим всё:** И-1…И-6 (export + replay + харнесс M1-M4). И-7 (diag-снимок графа) — опционально позже.
- **Р-3 → Да:** read-only доступ к `korateam.ru` разрешён **на эту сессию** (забор корпуса `svmazur@mail.ru` за неделю). Подтверждение НЕ переносится на сессию агента-тестировщика — он переспрашивает заново.
- **Р-4 → Приоритет:** агенты задач и решений первыми (`meeting-extract-actions`, `tasks`/`meeting-report-fast`, `specialist-3-3-decisions`, `task-closure-verify`, `entity-resolver`).
- **Р-5 → Хэндофф:** standalone-бриф `plans/analysis/2026-06-20-agents-big-test-TESTER-BRIEF.md`; **инструменты И-1…И-6 строит сам агент-тестировщик** (не этот агент).

---

## 11. Бриф-роль агента-тестировщика

> **Финал — отдельный self-contained файл** `plans/analysis/2026-06-20-agents-big-test-TESTER-BRIEF.md` (копипастится как стартовый промпт сессии тестировщика). Ниже — краткий каркас для контекста этого документа.

**Роль:** агент-тестировщик системы AI-агентов Коры. Не пишет фичи — гоняет агентов на реальных и синтетических данных через реальные LLM-вызовы, оценивает качество извлечения, итеративно правит промпты до заданного порога, фиксирует находки.

**Что делает (фазы):**
- **Ф0 (инструменты):** построить И-1…И-6 (§9); поднять dev-стенд (`docker compose -f docker-compose.dev.yml up -d` + backend + ключи `.env`); проверить `assertNotProd`.
- **Ф1 (реальные данные):** по рецепту §5.3 выгрузить корпус `svmazur@mail.ru` за 7 дней (встречи + chatbox + Bitrix); зафиксировать, что реально извлеклось (задачи/решения/…), сверить с §4 (почему задачи не создались).
- **Ф2 (синтетика):** сгенерировать пары `clean`/`asr_garbled` фикстур по таблице §7.3 (приоритет — Р-4), с `golden`-ожиданием; прогнать через harness в изолированном тенанте.
- **Ф3 (итерации):** по каждому приоритетному агенту — цикл §8.3 (прогон → оценка → правка промпта-кандидата → повторный прогон → diff), пока порог не держится при N=3.
- **Ф4 (находки):** по единому формату (как в `2026-06-06-...test-plan.md` §9) → результирующий файл `plans/analysis/2026-06-20-agents-big-test-RESULTS.md`.

**Где данные:** §5 (реальные), §7 (синтетика). **Где промпты:** §6. **Чем смотреть:** `diag` (§5.3/§6), harness/eval (§8). **Что считать успехом:** §7.3 (критерии) + §8.3 (пороги).

**Жёсткие правила:** реальные вызовы (ключи есть); прод — только read-only и с подтверждением (Р-3); синтетика — только изолированный тенант/`externalSource='qa-test'`/`[QA-test]`; победивший промпт — в боевой `.prompt.ts` через `z-ai-agent-rules` (ship-and-observe, без golden-гейта); промпты cache-friendly (стабильный SYSTEM, переменные в конце USER).

---

## 12. Гигиена и безопасность

- Прод-доступ `diag`/корпус-export — **только с явным «да» владельца в текущей сессии**; токены/куки в чат не вставлять.
- `diag` и export — строго **read-only**. Мутации (синтетические встречи/диалоги) — только в изолированном dev-тенанте.
- Снижение порогов графа (`LINKER_MIN_BLOCKS` и т.п. из предыдущего плана §7) — **только на стенде**, с фиксацией исходных значений.
- Тестовые данные: `externalSource='qa-test'` + префикс `[QA-test]`; в конце — чистка (`teardownTenant` / `deleteMany`).
- Демо «ТехноСтрим» (мимо конвейера) не путать с живым наполнением через агентов.

---

## Итог

Структура к большому тесту собрана и сверена по коду: что за «комета» (§1), ссылки на описания (§2), что поменялось и однозначный ответ про карточку — **сама не двигается, нужен человек** (§3), корень «нет задач» — гейт качества (§4), где сырые данные + рецепт выгрузки (§5), два хранилища промптов (§6), как делать синтетику (§7), итеративная методология на реальных вызовах (§8), что дописать (§9). Открыты развилки §10 — после согласования финализируем бриф §11 и отдаём агенту-тестировщику.

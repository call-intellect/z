---
type: tz
status: ready-to-implement
feature: extraction-layer-rewrite
date: 2026-06-30
owner: владелец
relates_to:
  - plans/architecture/2026-06-30-extraction-layer-rewrite.md
  - plans/analysis/2026-06-30-extraction-change-map-pre-tz.md
  - plans/analysis/2026-06-30-extraction-best-architecture-FINAL-technical.md
  - plans/tz/2026-06-29-task-extraction-pipeline-unification.md
  - plans/architecture/2026-06-30-employee-clone-build-hardening.md
  - plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md
  - plans/tz/2026-06-30-employee-clone-binding-resolution.md
---

> Архитектура (одобрена владельцем 2026-06-30, вариант А): `plans/architecture/2026-06-30-extraction-layer-rewrite.md` (status: approved) · Карта изменений по коду (TZ-ready, `файл:строка` перепроверены): `plans/analysis/2026-06-30-extraction-change-map-pre-tz.md` · Доказательство архитектуры: `…FINAL-technical.md`.
> **Каждая фаза = пакет работ (WP-X) карты изменений** — там полная картография `файл:строка`; здесь — контракт + приёмка + порядок. Не дублировать: за деталями кода — карта изменений.
>
> **⚠️ AMENDMENT Opus (владелец, 2026-06-30, Вариант A):** постановка Claude Opus primary на `block-ingest` (исходные Б7/Ф1/блюпринт §3.8) **ОТМЕНЕНА**. Движок остаётся `deepseek-v4-pro` — инфра-стандарт «DeepSeek primary везде, НЕ anthropic» (memory `project_z_infra_and_ai`); `anthropic.maxDataClass='sensitive'`(2) < `private`(3) → на private-данных Opus молча отфильтровывается ([llm-router.service.ts:1567](../../backend/src/modules/ai/services/llm-router.service.ts#L1567)), а block-ingest — самый частый LLM-вызов (дорого). Качество извлечения даёт модель-агностичная связка **Ф4** (реестр типов) + **Ф5** (overlap/gleaning) + **Ф6** (скелет-карта). Ф1 движок block-ingest НЕ трогает; маршрут `meeting-skeleton` сидится на дешёвую модель по стандарту (deepseek-flash/gpt-nano), НЕ anthropic.

# ТЗ: Переписывание извлекающего слоя (связный общий разборщик + сшивка нити)

**Принцип.** Тонкая «приёмная» (нарезка по репликам + сшивка нити) → **один связный общий разборщик** достаёт массу сущностей графа **И задачи/обещания** одним проходом из уже разобранного полного разговора → несколько глубоких узких дериверов на самых ответственных темах → у каждого из 57 типов понятное определение. **Строим всё сразу; старое выключаем только после доказанного паритета (build-then-delete), откат — рубильник в админке.**

**Вне scope / отложено владельцем:**
- **Кросс-карточный анализ по типу** (pull-обход графа `KnowledgeBlockResolver.getActive`) — отложен, в [реестре «не-сделано»](../../second-brain/04_не-сделано/README.md) (строка 2026-06-30).
- **Авто-`handoffs`/`decisionPoints`** процессов — осознанно ручной слой (строим только `steps[]`).
- **Хроносверка рёбер графа** по времени — нет (рёбра остаются на семантике пар).
- **Трекер-сторона задач** (материализация чек-листа, `TaskDraftMaterializerService`, дедуп, входящие, снос per-block спайна) — владеет [ТЗ задач](2026-06-29-task-extraction-pipeline-unification.md) (Ф1-Ф4, Ф7); здесь — только что общий агент **выдаёт** task-черновики в его контракте.

## Цель + Зачем

**Болезненное состояние (по факту кода).**
- 43 из 57 `signalType` в промпте без единого правила/примера ([block-ingest.prompt.ts:328-452](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L328-L452)) → модель ставит их наугад, трения (`team_friction`/`process_friction`) почти не размечает → граф-детектор конфликтов голодает, висит костыль-регэксп.
- Окна режутся встык, обрабатываются вслепую друг к другу ([block-extraction.service.ts:407-447](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L407-L447)); номер окна считается, но в промпт не идёт ([:416](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L416)); gleaning нет → факты на стыке/в середине теряются, кореференции не разрешаются.
- Комбо-разборщик **meeting-only** ([block-distill.worker.ts:242-256](../../backend/src/modules/knowledge-core/workers/block-distill.worker.ts#L242-L256)) → главный канал (чат) обслуживают слабые поблочные пути.
- Комбо при ON молча не пересобирает профиль клона ([specialists-combined.service.ts:793-903](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L793-L903) — нет `enqueueRebuild*`), не строит ProcessTemplate, не гоняет гигиену решений → клон/навыки/процедуры **застывают**.
- 🔴 Рубильник `SPECIALISTS_COMBINED_ENABLED` не выключается через ENV (`z.coerce.boolean('false')→true`, [env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404)); в `.env`=`false`, а по факту ВКЛ → отката нет.

**Что решение даёт:** каждый тип размечается осознанно; нить разговора держится оглавлением+нахлёстом (факт на стыке не теряется); чат разбирается так же связно, как встреча; клон/навыки/процедуры/гигиена обновляются сразу; рубильник реально выключается; задачи и обещания рождаются тем же проходом, что граф.

## REALITY-CHECK (живой код на 2026-06-30, перепроверено 18 агентами)

- **Комбо уже основной путь, ВКЛ по дефолту** ([env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404) default true; baг `z.coerce` глушит `.env=false`). При ON роутер вырезает 9 `COMBINED_COVERED` из per-block dispatch ([router.service.ts:88-98,190-192](../../backend/src/modules/knowledge-core/services/router.service.ts#L88-L98)).
- **Два слоя нарезки:** сегменты — `SegmentBuilderService` (overlap только внутри speaker-группы [:301-356](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L301-L356)); окна — `BlockExtractionService.extractFull` (шаг=`windowSize`, без overlap; комментарий [:340](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L340) «Без overlap»). `windowIndex=Math.floor(i/windowSize)` [:416], в промпт не доходит; `totalWindows` нет.
- **57 типов** ([block-ingest.prompt.ts:10-68](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L10-L68)), прозой объяснены **14**, единственный few-shot `renderRuleForBlockIngest()` ([task-decision-examples.ts:79-89](../../backend/src/modules/knowledge-core/prompts/task-decision-examples.ts#L79-L89)) — 3 типа.
- **`MeetingSkeletonService` нет**, первого прохода-скелета нет; `ChunkContextService` идёт только в эмбеддинги после извлечения ([block-ingest.worker.ts:282-303](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L282-L303)). Маршрута `taskType:'meeting-skeleton'` в `llm-router` нет.
- **Один писатель на ось (подтверждено):** факт — `FactSupersedeService.applySupersedes` ([fact-supersede.service.ts:404-449](../../backend/src/modules/knowledge-core/services/fact-supersede.service.ts#L404-L449)); решение — `Specialist33Service` ([specialist-3-3-decisions.service.ts:368-393](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L368-L393)) + ручной `decisions.service.ts:261-298`; рёбра — `TemporalConflictService`. Канал вердикта — `ConflictService.report` (`evolvingMeta` кладётся в поле `evidence`, не параметром).
- **ProcessTemplate-строитель есть** ([process-extraction.service.ts:181-308](../../backend/src/modules/processes/services/process-extraction.service.ts#L181-L308)): строит `steps[]`, `handoffs`/`decisionPoints` пусты. В combo-режиме `process-detector` подавлен (`PROCESS_DETECTOR` ∈ COMBINED_COVERED [router:95]).
- **Профиль клона:** rebuild дёргают раздельные [3-2:109](../../backend/src/modules/knowledge-core/workers/specialist-3-2-knowledge-clone.worker.ts#L109)/[3-7:126](../../backend/src/modules/knowledge-core/workers/specialist-3-7-skill.worker.ts#L126); cron-страховка [knowledge-clone-rebuild.cron.ts:21](../../backend/src/modules/knowledge-core/workers/knowledge-clone-rebuild.cron.ts#L21) (0 */6). В combo DI нет `CoreQueueService`.
- **Гигиена решений:** [dashboard-queue.service.ts:71](../../backend/src/modules/dashboard/services/dashboard-queue.service.ts#L71) `enqueueDecisionHygiene`, дёргает раздельный [3-3.worker:108-126](../../backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts#L108-L126).
- **Конфликты — два детектора** ([personal-relation-builder.worker.ts](../../backend/src/modules/operations/workers/personal-relation-builder.worker.ts)): граф (:43-206, гейт `isFriction` :96-107, conf 0.65 :110) + регэксп-крон (:209-476, `@Cron('0 4 * * *')` :232, conf 0.55, 7 паттернов по сырому `DailyCheckIn`). Оба пишут `EntityLinkType.conflicted_with` (дедуп на ребре). friction в промпте не обучен.
- **Движок из БД `LlmTaskRoute` (стандарт, НЕ менять):** block-ingest = 3 тира deepseek-v4-pro/gpt-5.4/gemini-3.1-pro ([seed-llm-task-routes-default.ts:122-131](../../backend/scripts/seed-llm-task-routes-default.ts#L122-L131)) — инфра-стандарт «DeepSeek primary везде, НЕ anthropic». Провайдер `anthropic` `maxDataClass='sensitive'`(2) < `private`(3) ([llm-router.service.ts:1003,1567](../../backend/src/modules/ai/services/llm-router.service.ts#L1567)) → на private-данных Opus отфильтровывается, едет DeepSeek. **Opus отменён (Вариант A, см. AMENDMENT Opus).**
- **Крутилки нарезки:** `blockIngest*` читаются `this.get(ENV)` без `resolveSync` ([typed-config.service.ts:652-653](../../backend/src/common/config/typed-config.service.ts#L652-L653)) → админка для них мертва; сид `seed-admin-settings.ts:424-435` (max-tokens=1500 ≠ env 2000). `segmentMaxTokens`/`segmentOverlapRatio` — правильно через `resolveSync` ([:654-655]). Эталон kill-switch: `getDynamic('knowledge.contextual_header_enabled', undefined, true)` ([chunk-context.service.ts:94-99](../../backend/src/modules/knowledge-core/services/chunk-context.service.ts#L94-L99)).
- **derive-by-signalType примитив есть, не подключён:** `KnowledgeBlockResolver.getActive` ([block-fetch.service.ts:146-164](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L146-L164)) — `Inject(KnowledgeBlockResolver)`=0. (Отложен.)

## Принятые решения владельца (не пересматривать)

| # | Решение |
|---|---|
| ВР1 | Строим всё сразу; старое выключаем не «в тот же миг», а когда новое на месте; **проверка — разовая (глазами+метрики), НЕ параллельное A/B** (см. ВР8); откат — рубильник |
| ВР2 | ProcessTemplate в combo → **Вариант A** (вернуть `process-detector` в раздельный dispatch); авто-handoffs/decisionPoints НЕ строим |
| ВР3 | Хроносверка — **факты И решения**; рёбра графа не трогаем |
| ВР4 | Рубильник комбо → в AdminSetting, чинить `zBool`, **дефолт ON** (Ship-On) |
| ВР5 | Размер куска — **мелко** (нить сшиваем оглавлением/графом, не размером) |
| ВР6 | Кросс-анализ по типу (WP-H) — **отложен** (реестр «не-сделано») |
| ВР7 | **Задачи — внутри общего агента (вариант А):** общий разборщик достаёт задачи/обещания из разобранного полного разговора → в `TaskDraftMaterializerService`; отдельного движка/крона нет |
| ВР8 | **Владелец НЕ может проводить A/B-сравнение → снос старого БЕЗ параллельного A/B.** Страховка = рубильник + метрики + разовая проверка глазами. Для задач: `meeting-extract` + спайн `3-15` убираются СРАЗУ после Ф7, combo — единственный движок задач (после сноса фолбэка задач нет — принято) |

## Принятые технические решения (Б — с обоснованием)

| # | Решение | Почему |
|---|---|---|
| Б1 | Enum `SignalType` в БД НЕ менять; 43 немых типа лечим few-shot-реестром в промпте | Смена enum→строку ломает `Record<SignalType,…>` и снапшоты (R10); расширяемость не нужна сейчас |
| Б2 | Скелет встречи держать **in-memory** на время одного `extractFull` (не в БД) | Нужен только в рамках разбора одного RawEvent; БД-поле — vNext |
| Б3 | Все новые пороги/флаги (overlap, gleaning, skeleton, header-map) — **AdminSetting** через `getDynamic`/`resolveSync` + registry + seed | Правило §9; эталон `contextual_header_enabled` |
| Б4 | Хроносверка — **поставщик вердикта**, не писатель оси | Второй писатель `validUntil` = гонка (R7) |
| Б5 | Снос (раздельные специалисты / regex-крон / per-block task-спайн) — **каждый отдельным коммитом, без A/B** (ВР8), не бандлить | R9; «нет склада выключенного»; порядок-гейты (обучить/восстановить ДО сноса) — корректность, не тест |
| Б6 | Общий агент эмитит `tasks[]` из тех же canonical-блоков (вариант А), отдаёт в `TaskDraftMaterializerService` | Один мозг, два выхода (граф+трекер); машинерия трекера — ТЗ задач |
| Б7 | ~~Opus на block-ingest~~ **ОТМЕНЕНО (владелец, 2026-06-30, Вариант A):** оставляем `deepseek-v4-pro` primary (стандарт «DeepSeek везде, НЕ anthropic») | Opus cap=`sensitive`<`private` → молча отфильтровывается на private; block-ingest — самый частый вызов (дорого); качество даёт Ф4/Ф5/Ф6 (модель-агностично) |

## Scope

**Входит:** рубильник комбо в AdminSetting + `zBool` + крутилки нарезки на `resolveSync` + новые крутилки (движок block-ingest НЕ трогаем — Вариант A); канало-агностичный комбо (chat); восстановление 4 побочек комбо (rebuild профиля, гигиена, ProcessTemplate через Вариант A); few-shot реестр 57 типов (вкл. friction); сшивка нити слой 0 (overlap+позиция+gleaning); скелет→шапка-карта (слой 1); общий агент эмитит `tasks[]`; **привязка регламентов/инструкций в combo (scope роли + владелец, из C1)**; хроносверка-вердикт (факты+решения); усиление граф-детектора конфликтов; me-tasks дедуп-guard; **снос** обходчиков (без A/B, ВР8); метрики/тесты/прод-шаги/second-brain.

**Не входит:** кросс-анализ по типу (WP-H, отложен); авто-handoffs/decisionPoints; хроносверка рёбер; трекер-сторона задач — материализатор/чек-лист/дедуп/intake (ТЗ задач Ф1-Ф4,Ф7); смена enum `SignalType`; чтение `RawEvent.payload` в read-path. **NB:** вывод `meeting-extract-actions` — **здесь** (Ф11г), т.к. его caller живёт в `analyze.worker`/tracker, а не в трекер-машинерии ТЗ задач (иначе owner сноса бесхозный).

## Граничные контракты с другими подсистемами

- **Сырой текст `RawEvent.payload`** — НЕ вводить в read-path. Дословный фрагмент — `IdeaBlockEvidence.quote`. Провенанс-инвариант «нет цитаты — нет блока» сохраняется.
- **`ConflictService.report`** — единственный канал вердикта; `evolvingMeta`/`suggestedResolution` — внутри поля `evidence`, не параметры. Не менять контракт.
- **`router.service.ts`** — общий файл с [ТЗ задач](2026-06-29-task-extraction-pipeline-unification.md) (оно убирает `action_item→TASKS` :430; мы убираем `PROCESS_DETECTOR` из COMBINED_COVERED :95). Любая чистка роутера — атомарно с регистрацией воркера (R9).
- **`commitment`→GOALS** ([router.service.ts:426](../../backend/src/modules/knowledge-core/services/router.service.ts#L426)) — не трогаем; обещание-как-задачу общий агент ловит из текста.
- **`TaskDraftMaterializerService`** (ТЗ задач Ф4) — общий агент вызывает как есть, контракт черновика — оттуда.

## Контракт-first (канон)

### Рубильник комбо → AdminSetting + zBool (Ф1)
```ts
// env.schema.ts:404 — было z.coerce.boolean().default(true):
SPECIALISTS_COMBINED_ENABLED: zBool(true),          // off-строки честно выключают
// typed-config.service.ts:1012-1017 — было this.get(...):
get specialistsCombined() { return {
  enabled: this.resolveSync<boolean>('knowledge.specialistsCombinedEnabled', 'SPECIALISTS_COMBINED_ENABLED', true),
  delayMs: this.resolveSync<number>('knowledge.specialistsCombinedDelayMs', 'SPECIALISTS_COMBINED_DELAY_MS', 90_000) }; }
// admin-setting-schema-registry.ts: + knowledge.specialistsCombinedEnabled z.boolean()
// seed: value=true (Ship-On). .env=false — легаси, перебиваем дефолтом ON.
```

### Крутилки нарезки на resolveSync (Ф1)
```ts
// typed-config.service.ts:652-653 — было this.get(ENV):
blockIngestWindowSegments:      this.resolveSync('knowledge.blockIngestWindowSegments','BLOCK_INGEST_WINDOW_SEGMENTS',5),
blockIngestMaxTokensPerSegment: this.resolveSync('knowledge.blockIngestMaxTokensPerSegment','BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT',2000),
// выровнять сид seed-admin-settings.ts:424-435 (1500 → 2000); envFallbackKey обязателен (паритет с текущим прод-ENV)
```

### Новые крутилки (registry + seed + UI), все default-ON / разумный дефолт
```
knowledge.blockIngestWindowOverlapSegments  NON_NEGATIVE_INT  default 1   (валидатор: < windowSize)
knowledge.blockIngestGleaningRounds         INT [0..3]        default 1
knowledge.skeletonPassEnabled               bool              default true (kill-switch)
knowledge.headerMapEnabled                  bool              default true
knowledge.skeletonMinSegments               INT               default = windowSize+1 (короче — скелет не нужен)
```

### Позиция окна + нахлёст + gleaning (Ф5 = WP-D)
```ts
// block-extraction.service.ts extractFull: монотонный счётчик окон (НЕ Math.floor при overlap-шаге)
const step = Math.max(1, windowSize - windowOverlap); let windowIdx = 0;
for (let i = 0; i < segments.length; i += step) { ... processWindow({ windowIndex: windowIdx++, totalWindows, ... }); }
// block-ingest.prompt.ts BuildArgs += { windowIndex?, totalWindows? }; в header строка «Фрагмент N из M…» (только totalWindows>1)
// processWindow: после 1-го извлечения gleaning N раундов (тот же taskType) «найди ТОЛЬКО пропущенное, не повторяй [name/signalType]», merge с дедупом по (signalType+evidenceQuote)
// дедуп на стыке окон: после extractFull по (signalType+evidenceStartMs/quote)
```

### Скелет → шапка-карта (Ф6 = WP-E)
```ts
// new MeetingSkeletonService.buildSkeleton({segments, meetingTitle, ...}): 1 LLM-вызов taskType:'meeting-skeleton'
//   вход — сжатый (index + ~80 симв text), выход — {agenda, milestones[], keyNames[]}, maxTokens ~800, fail-open → null
// llm-router: зарегистрировать 'meeting-skeleton' (union LlmTaskType + ALL_LLM_TASK_TYPES + seed дешёвой модели) — ДО выката
// extractFull: skeleton = enabled && segments.length>skeletonMinSegments ? buildSkeleton(...) : null; держать in-memory
// buildBlockIngestPrompt: секция «Карта встречи» после «Контекст эпизода»; скелет как user-data (wrapUserData), пометка «справочный контекст, истина — сегменты ниже»
```

### Few-shot реестр типов (Ф4 = WP-C)
```ts
// new signal-type-registry.ts: renderSignalTypeRegistry() — на каждый из 57 SIGNAL_TYPE_VALUES: определение(5-7 слов)+пример+анти-паттерн
//   для idea/decision/action_item переиспользует TASK_VS_DECISION_PAIRS (task-decision-examples.ts:8-27)
//   friction: team_friction (между людьми) vs process_friction (между функциями), контраст с pain/objection/blocker
// block-ingest.prompt.ts:433-434 — renderRuleForBlockIngest() → renderSignalTypeRegistry() (в system, кэшируется)
// тест-страж: каждый SIGNAL_TYPE_VALUES имеет строку реестра (enum↔реестр)
// перенести (не выкинуть) 7 правил различий (:345-352) + 9 примеров (:382-431) в реестр; обновить снапшоты осознанно
```

### Общий агент эмитит tasks[] (Ф7 = WP-tasks, вариант А)
```ts
// specialists-combined.prompt.ts (combo-промпт СЕЙЧАС задачи НЕ умеет: tool submit_all_8_entities = 8 массивов, секции tasks[] нет, action_item пропускается :521):
//   + массив tasks[] в SUBMIT_ALL_8_ENTITIES_TOOL.input_schema.properties + в required + SpecialistsCombinedOutputSchema; переименовать tool (8→9 выходов)
//   ФОРМА элемента tasks[] = КАНОН `TaskItemSchema` (common.ts:247-258) + subtasks?:[{title}] (ТЗ задач Ф1) + sourceBlockId (как у сущностей combo). НЕ плодить вторую схему (assignee/dueDate/suggested* — оттуда, НЕ выдумывать assigneeHint/dueHint/description)
//   в system-промпт combo: строка маршрутизации «поручение / обещание-как-задача → tasks[]» + правило «обещание=задача» (перенос SELF_ASSIGNMENT_RULE + BASE_SYSTEM:184 из tasks-unified.ts) + SUBTASKS_BLOCK (ТЗ задач :104)
//   КЛЮЧ СХОДИМОСТИ ПОДЗАДАЧ: combo видит ВСЕ canonical-блоки разговора сразу (не по одному) → правило ГРУППИРОВКИ: несколько action_item-блоков одного автора, близких по времени/смыслу = шаги ОДНОГО дела → ОДНА задача + subtasks[], НЕ N карточек. Это и собирает обратно то, что нарезчик разрезал по окнам (проверяется приёмкой Ф7: «лендинг + 3 шага» → 1 задача + 3 пункта)
// specialists-combined.service.ts: persistTasks(drafts) → TaskDraftMaterializerService.materialize({tenantId, channel, sourceRef, drafts, participants, orgContext}) — ТЗ задач Ф4; инжект сервиса
// combo читает блоки ВСТРЕЧИ И ЧАТА → задачи из ОБОИХ каналов = ЕДИНСТВЕННЫЙ движок задач. meeting-extract и спайн 3-15 убираем СРАЗУ (Ф11), без A/B — combo их заменяет
// commitment→GOALS (router:426) НЕ трогаем — обещание-как-задачу агент ловит из текста, не через роут
```

### Восстановление 4 побочек комбо (Ф3 = WP-B)
```ts
// specialists-combined.service.ts: инжект CoreQueueService; после persist собрать Set<personId> →
//   enqueueRebuildKnowledgeProfile + enqueueRebuildSkillProfile (как 3-2:109 / 3-7:126), 1 раз на person
// persistDecisions: после upsert (reversibility=null) → DashboardQueueService.enqueueDecisionHygiene (@Optional inject)
// ProcessTemplate (Вариант A): убрать PROCESS_DETECTOR из COMBINED_COVERED (router:95) — детектор батчит параллельно
// persistKnowledgeCategories: не писать embedding с текущей version (мёртвый груз) — положиться на rebuildForPerson
```

### Хроносверка-вердикт (Ф8 = WP-F, факты+решения)
```ts
// НЕ писать validUntil/status. Влиять на вердикт существующего владельца оси:
//   факт — сигнал хронологии sourceTimestamp в FactSupersedeService.callLlm / пред-фильтр KNN
//   решение — порядок decidedAt/sourceTimestamp в supersedeDetect (specialist-3-3:740-931)
//   доставка конфликта — ConflictService.report (evolvingMeta в evidence). sourceTimestamp=null → ранний evidence asc, fallback createdAt; для решений decidedAt первичен
```

### Граф-детектор конфликтов (Ф9 = WP-G) и крутилки порогов
```ts
// friction обучается в Ф4 (реестр). Усилить PersonalRelationBuilder: вторая сторона = IdeaBlockEvidence.authorPersonId; узкое определение (не клик на 5 человек)
// вынести MIN_CONFIDENCE(:18)/graph 0.65(:110)/regex 0.55(:213) в AdminSetting getDynamic
// CheckInConflictDetectorCron (:209-476) сносим СРАЗУ после Ф9 (модель размечает friction → граф строит conflicted_with сам); без A/B (ВР8). Обязателен порядок Ф4→Ф9→снос (иначе конфликты из чек-инов пропадут)
```

## Границы фичи
- ✅ **Always:** все выборки/создания с `tenantId`; idempotency; метрики prom-client + логи pino; новые пороги/флаги — через AdminSetting; скелет/чат-текст как user-data (injection-guard); fail-open у скелета/gleaning.
- ⚠️ **Ask first:** менять контракт `ConflictService.report`/`TaskDraftMaterializerService`/`FactSupersedeService.applySupersedes`; менять enum `SignalType`; поднимать потолок размера окна.
- 🚫 **Never:** `process.env.*` мимо `TypedConfigService`; `new PrismaClient()` в скриптах; `migrate`-обход; второй писатель оси (validUntil/status); снос обходчика до зелёного A/B; чтение `RawEvent.payload` в read-path; авто-merge дублей.

## Фазы

Граф зависимостей: **Ф1 → всё** (рубильник — фундамент отката). **Ф4 → Ф9** (friction обучается до усиления детектора). **Ф2 → Ф7** (чат-агностичность → задачи из чата). **Ф3** независима после Ф1. **Ф5/Ф6** независимы после Ф1. **Ф8** последней из build. **Ф11 (снос) → задачные (в/г) сразу после Ф7; (а) после Ф3; (б) сразу после Ф9. Без A/B/watch — порядок-гейты (обучить friction / восстановить побочки ДО сноса) = корректность; откат — рубильник (ВР8)**.

### [x] Ф1 — Рубильник в AdminSetting + zBool + крутилки нарезки на resolveSync + новые крутилки (WP-I) 🔴 первым
**Ценность:** как оператор, могу мгновенно откатить комбо из админки при инциденте, и правки порогов нарезки реально влияют на рантайм.
Картография: карта изменений §WP-I; контракт-first выше.
Что входит: `zBool` для SPECIALISTS_COMBINED_ENABLED; перенос его + `blockIngest*` (+ `specialistsCombined.delayMs`) на `resolveSync` (envFallbackKey обязателен); выравнивание сида 1500→2000; registry+seed для нового рубильника и 5 новых крутилок; **движок block-ingest НЕ трогаем — остаётся `deepseek-v4-pro` (Вариант A, Б7);** регистрация `taskType:'meeting-skeleton'` (union + ALL_LLM_TASK_TYPES) + сид-маршрут на дешёвую модель по стандарту (deepseek-flash/gpt-nano, НЕ anthropic) — заготовка под Ф6.
Что НЕ входит: потребление новых крутилок (Ф5/Ф6).
Acceptance: тест «`SPECIALISTS_COMBINED_ENABLED=false` → enabled=false»; правка `knowledge.blockIngestWindowSegments` в AdminSetting меняет рантайм (без передеплоя); маршрут block-ingest БЕЗ изменений (grep `LlmTaskRoute` block-ingest = deepseek-v4-pro primary, Opus НЕ добавлен); `taskType:'meeting-skeleton'` зарегистрирован в обоих местах llm-router + сид-маршрут есть; `typecheck/lint/build` зелёные. ⚠️ Разработчику: подтвердить прод-значение ENV и что выключение было легаси.
Закрывает: 🔧4 (рубильник), §9-нарушения нарезки.

### [x] Ф2 — Канало-агностичный комбо (chat/Telegram/Bitrix/chatbox) (WP-A)
**Ценность:** как компания, решения/идеи/навыки из чата попадают в память так же связно, как со встречи.
Картография: карта изменений §WP-A.
Что входит: резолвинг любого источника в `block-distill.worker` (не `sourceType:'meeting'`); `getCanonicalBlocksForSource` в `block-fetch`; `specialists-combined.worker` принимает source-дескриптор; `channelKind` в промпт; ключ группировки чата + delayMs (AdminSetting).
Что НЕ входит: задачи из чата (Ф7, поверх этого).
Acceptance: e2e на чат-RawEvent — извлекаются сущности; нет дублей чат×встреча (опора на KNN-merge block-distill); `dataClass` чат-источника верный; `typecheck/lint/build` зелёные.
Закрывает: R2.

### [x] Ф3 — Комбо восстанавливает 4 побочки (rebuild профиля · гигиена · ProcessTemplate) (WP-B) 🔴
**Ценность:** как пользователь клона, получаю свежий профиль/навыки/процедуры сразу после разбора, а не через 6 часов.
Картография: карта изменений §WP-B; контракт-first.
Что входит: инжект `CoreQueueService` + `enqueueRebuild*` по `Set<personId>`; `enqueueDecisionHygiene` per-decision; убрать `PROCESS_DETECTOR` из COMBINED_COVERED (Вариант A); не писать мёртвые embedding-версии; инвариант-тест «деривер с side-effect не в COMBINED_COVERED».
Acceptance: после combo у Person `profileBuildVersion++` и `lastProfileBuildAt` обновился; `DecisionHygiene.reversibility` заполняется для решений со встреч; ProcessTemplate `steps[]` пополняется при ON; rebuild дедуплицируется по personId; `typecheck/lint/build` зелёные.
Закрывает: R1, R6.

### [x] Ф4 — Few-shot реестр 57 типов (вкл. friction) (WP-C)
**Ценность:** как система, размечаю каждый тип осознанно (включая трение/возражения), а не наугад.
Картография: карта изменений §WP-C; контракт-first.
Что входит: `signal-type-registry.ts` + `renderSignalTypeRegistry()`; врезка вместо `renderRuleForBlockIngest()`; перенос 7 правил + 9 примеров; few-shot friction; тест-страж enum↔реестр; baseline распределения signalType ДО.
Что НЕ входит: смена enum БД.
Acceptance: все 57 типов имеют определение (тест-страж); ответ LLM проходит схему; распределение типов не «съехало» катастрофически (diff к baseline); снапшоты обновлены и зелёные.
Закрывает: R10, R11; готовит Ф9.

### [x] Ф5 — Сшивка нити, слой 0: нахлёст окон + позиция + gleaning (WP-D)
**Ценность:** как система, не теряю факт на стыке окон и взвешиваю финал выше черновиков.
Картография: карта изменений §WP-D; контракт-first.
Что входит: overlap-шаг + монотонный `windowIdx` + `totalWindows`; позиция в header; gleaning N раундов с дедупом; дедуп на стыке; порог min-длины для gleaning.
Acceptance: needle-in-the-middle (позиции 1/5/10/15/20) — факт на стыке ловится; число дублей блоков не выросло; gleaning даёт прирост сигналов > стоимости; `overlap>=windowSize` склампано; `typecheck/lint/build` зелёные; снапшоты промпта обновлены.
Закрывает: §3.4 blueprint, часть R-нити.

### [ ] Ф6 — Скелет → шапка-карта, слой 1 (WP-E)
**Ценность:** как система, разрешаю «он/этот клиент/проект» и не дроблю тему, потому что каждое окно видит оглавление разговора.
Картография: карта изменений §WP-E; контракт-first.
Что входит: `MeetingSkeletonService` (1 дешёвый проход, fail-open); маршрут `meeting-skeleton` (из Ф1); инжект в `extractFull`, in-memory; секция «Карта встречи» в шапку; kill-switch + порог коротких.
Acceptance: на длинной встрече кореференции разрешаются (golden); падение ложных «обрывается на полуслове»; при `skeleton=null` окна работают как сейчас; на встрече ≤ порога скелет не зовётся; `typecheck/lint/build` зелёные.
Закрывает: §3.5 blueprint.

### [ ] Ф7 — Общий агент эмитит tasks[] → TaskDraftMaterializer (WP-tasks, вариант А)
**Ценность:** как руководитель, мои поручения и обещания из любого разговора становятся задачами (с подзадачами) тем же проходом, что память.
Картография: карта изменений §WP-tasks; контракт-first; трекер-сторона — [ТЗ задач](2026-06-29-task-extraction-pipeline-unification.md) Ф1-Ф4.
Что входит: секция `tasks[]` в combo-tool (форма = `TaskItemSchema` common.ts:247-258 + `subtasks`); правило «обещание=задача» + `SUBTASKS_BLOCK` в **combo-промпт** (`specialists-combined.prompt.ts` — сейчас задач не умеет, не tasks-unified.ts); `persistTasks` → `TaskDraftMaterializerService` (инжект); combo достаёт задачи из блоков **встречи И чата** (поверх Ф2).
Что НЕ входит: трекер-машинерия (материализатор/чек-лист/дедуп/intake — ТЗ задач Ф1-Ф4); снос per-block спайна 3-15 и вывод meeting-extract (Ф11в/г — сразу после этой фазы, combo их заменяет, без A/B).
Acceptance: e2e — «я докручу лендинг к пятнице + 3 шага» → 1 IntakeIssue, assignee=автор, due=пятница, `checklistJson`=3; повтор дела → `verdict='same'` (suggest, не дубль); на чате работает; `typecheck/lint/build` зелёные.
Закрывает: R-tasks (чат-задачи), ВР7; зависит от ТЗ задач Ф1-Ф4 (трекер-машинерия).

### [ ] Ф7б — Привязка регламентов/инструкций в combo: scope роли + владелец (из C1) 🔴
**Ценность:** как клон должности, получаю свои регламенты в ответах, потому что combo пишет `scope=role:<Role.id>` (совпадает с уже задеплоенной читающей стороной «Способ C»), а не теряет привязку целиком.
**Почему здесь:** combo — живой путь записи регламентов (`COMBINED_COVERED` включает REGULATIONS, `router.service.ts:90,191` → 3-1 обойдён). `specialists-combined.persistRegulations` (:668-731) **НЕ пишет `scope`/`ownerPersonId` вообще**; `persistInstructions` (:733-791) пишет `forRole`=сырое имя, без `scope`. → На боевом пути привязка регламент↔роль не «сломана нормализацией», а **отсутствует**. Исходный C1 ТЗ целился в обойдённый `specialist-3-1` — перенесено сюда (владелец, 2026-06-30).
Картография: `specialists-combined.prompt.ts` (combo-tool/`SpecialistsCombinedOutputSchema`.regulations[] — сейчас БЕЗ scope/ownerHint), `specialists-combined.service.ts:668-791`. Контракт резолва — [ТЗ C1](2026-06-30-employee-clone-binding-resolution.md) §Контракт-first (`resolveScope`: `EntityResolutionService.resolveRoleByHint`, идемпотентность по `Role.id`, unresolved→сырьём+counter; владелец — `resolvePersonByHint` fail-closed).
Что входит:
- `scope?: string` + `ownerHint?: string` в combo regulations[]-схему (tool `SUBMIT_ALL_*` + `SpecialistsCombinedOutputSchema`) + строку извлечения в combo-промпт (LLM даёт `role:<имя>`/`org`, как `regulation-extract.prompt.ts:69`).
- `persistRegulations`/`persistInstructions`: нормализация `scope` через общий `resolveScope` (имя→`Role.id`); `ownerPersonId` через `resolvePersonByHint`; запись `scope`+`ownerPersonId` в upsert; для instruction — заполнять `scope` (не только `forRole`); counters `regulation_scope_role_unresolved_total`/`regulation_owner_hint_unresolved_total`.
- Backfill `backfill-regulation-scope-normalize.ts` (legacy `role:*` от старого 3-1 + переноса 23 июня), STEPS `phase:'backfill'` — из C1 ТЗ Ф2.
Что НЕ входит: department-scope (отложено); Person↔Entity lazy-резолв и `attributeSubject` (отдельное ТЗ `2026-06-30-clone-entity-link-and-authorship.md`); читающая сторона retrieval (корректна, не трогаем).
Зависит от: координировать с Ф7 (общий combo-tool/схема — добавляем поля в ту же схему); единый `resolveScope` переиспользовать из C1 (не копировать). Снос `specialist-3-1` (Ф11) — только после паритета: combo пишет scope/owner ≥ legacy.
Acceptance: e2e — норма «для менеджера» с роли-scope → клон роли её подтягивает (был «не нашёл»); combo пишет `scope=role:<cuid>`; идемпотентность backfill (повтор=0 изменений); `ownerPersonId` fail-closed (тёзки→null+counter); instruction.scope заполнен; `typecheck/lint/build` зелёные.
Закрывает: C1-#1, C1-#2 (на боевом combo-пути); biggestConcern анализа клонов.

### [ ] Ф8 — Хроносверка-вердикт: факты И решения (WP-F)
**Ценность:** как память, на «вначале X — в конце Y» показываю актуальное Y, а старое помечаю отменённым.
Картография: карта изменений §WP-F; контракт-first.
Что входит: сигнал хронологии в `FactSupersedeService` (вход, не писатель) и в `supersedeDetect` (3-3); доставка через `ConflictService.report`; обработка `sourceTimestamp=null`.
Что НЕ входит: рёбра графа по времени (ВР3 — нет); второй писатель оси (запрещено).
Acceptance: сценарий разворота — активна Y, X superseded ровно одним писателем; нет дублей `ConflictItem`; `decision_supersede_chain_length`/`kc_fact_supersede_verdict` без аномалий; `typecheck/lint/build` зелёные.
Закрывает: R7 (как вердикт-провайдер).

### [ ] Ф9 — Усилить граф-детектор конфликтов + крутилки порогов (WP-G шаги 1-2)
**Ценность:** как компания, вижу конфликты из графа (любой источник), а не только костылём по чек-инам.
Картография: карта изменений §WP-G; контракт-first. Зависит от Ф4 (friction обучен).
Что входит: вторая сторона = `authorPersonId`; узкое определение friction; вынос порогов в AdminSetting; метрики разметки источника (граф vs regex).
Что НЕ входит: снос regex-крона (Ф11б — сразу после этой фазы, без A/B); рёбра process_friction-отчётов сверх текущего.
Acceptance: на friction-блоках рождаются `conflicted_with` из графа; precision на многолюдных блоках приемлем; пороги читаются из AdminSetting; `typecheck/lint/build` зелёные.
Закрывает: R5 (часть); готовит снос regex.

### [ ] Ф10 — me-tasks дедуп-guard + разовая проверка перед сносом (WP-J)
**Ценность:** как система, не плодлю дубли задач; перед сносом старого глазами убеждаюсь, что combo работает (параллельное A/B-сравнение владельцу недоступно).
Картография: карта изменений §WP-J, §6.
Что входит: единый дедуп-guard по `sourceBlockId`/контенту в `me-tasks.service.ts` (быстрый путь сохраняется); **разовая проверка глазами** на нескольких реальных разговорах (встреча+чат), что combo достаёт задачи/решения/конфликты не хуже старого; метрики `temporal_edges_invalidated_total`, `kc_fact_supersede_verdict`, `risk_edge`, число задач/конфликтов из combo — для наблюдения в проде (не для параллельного A/B).
Что НЕ входит: параллельное A/B (старый+новый бок о бок) — недоступно владельцу; страховка = рубильник + метрики + разовая проверка.
Acceptance: дедуп-guard покрыт тестом; разовая проверка проведена и зафиксирована; `typecheck/lint/build` зелёные.
Закрывает: R8.

### [ ] Ф11 — Снос обходчиков (каждый отдельным коммитом; без A/B) Б5/ВР8
**Ценность:** как система, имею один путь без дублирующих обходчиков, без склада выключенного.
Картография: карта изменений §3, §5; FINAL §6.
Что входит (каждый — отдельный коммит, атомарно роутер+регистрация+воркер, R9): (а) снос раздельных COMBINED_COVERED-специалистов 3-2/3-7/3-3 и пр. — **после Ф3** (побочки восстановлены); (в) снос per-block спайна `specialist-3-15-tasks` + `action_item→TASKS` (router:430) и (г) вывод `MeetingExtractActionsService` (`analyze.worker.ts:399-404`) — **сразу после Ф7** (combo стал единственным движком задач), без A/B, после разовой проверки (Ф10); (в) координировать с [ТЗ задач](2026-06-29-task-extraction-pipeline-unification.md) Ф7; (б) снос `CheckInConflictDetectorCron` — **сразу после Ф9** (модель обучена размечать `team_friction`/`process_friction` → граф-детектор строит `conflicted_with` сам), без watch/A-B. Обязателен порядок Ф4→Ф9→Ф11б — иначе конфликты из чек-инов пропадут.
Что НЕ входит: бандл нескольких сносов в один коммит.
Acceptance: после каждого сноса — целевой путь покрывает функцию (e2e/grep: 0 ссылок на удалённое); единственный создатель задач = combo; `day-report-collector` по-прежнему читает `action_item` из графа; **рубильник combo — единственный откат задач** (после сноса meeting-extract+спайна фолбэка задач нет — принято владельцем, ВР8); `typecheck/lint/build` зелёные.
Закрывает: R4 (через Ф11г), R9.

### [ ] Ф12 — Observability · прод-шаги · second-brain
**Ценность:** как оператор, вижу метрики/логи нового пути и уверен в выкате.
Что входит: метрики (скелет-проход, gleaning-раунды/прирост, дубли-стыки, tasks из combo, friction-рёбра граф/regex) + логи pino; обновить `second-brain/02_architecture/knowledge-core.md` (исправить «combined не включён» :838), `01_projects/ai-jobs.md`/`workers-queues.md` (новый `meeting-skeleton`, ProcessDetector назад в dispatch), `module-map.md`; `docs/operations/prod-deploy-log.md` (Шаг 1 ENV/крутилки/маршруты, Шаг 7 сиды, Шаг 12 smoke `meeting-skeleton`/combo); `docs/operations/feature-flags.md` (рубильник комбо тип + новые kill-switch); закрыть/обновить строки `04_не-сделано` (конфликты-через-граф, derive-by-type остаётся).
Acceptance: метрики на `/metrics`; second-brain/prod-deploy-log/flags обновлены; e2e по каналам зелёные.

## Сквозные аспекты
- **RBAC/tenant:** все запросы с `tenantId`. **Observability:** Ф12 (метрики+логи), новый воркер/проход без метрик — нарушение. **Errors+idempotency:** скелет/gleaning fail-open; хроносверка идемпотентна (`updateMany WHERE validUntil IS NULL`); дедуп best-effort. **Миграция данных:** новых таблиц нет (enum не трогаем, скелет in-memory); только AdminSetting-сиды + LlmTaskRoute. **Rollout:** всё под Ship-On ON; откат — рубильник комбо + per-этап kill-switch (skeleton/header/gleaning). **Тесты:** golden промпта (Ф4/Ф6/Ф7), needle-in-the-middle (Ф5), e2e каналов (Ф2/Ф7), инвариант COMBINED_COVERED (Ф3).

## Pre-mortem / Риски (из карты изменений §WP, перепроверено)
- **Рубильник чинится, а в проде `.env=false`** → после фикса комбо выключится. Митигейт: дефолт ON в AdminSetting перебивает; подтвердить с разработчиком (Ф1).
- **Overlap плодит дубли блоков** → дедуп после extractFull (Ф5).
- **Реестр 57 типов раздувает промпт** → компактный формат, в system (кэш); замер дельты токенов (Ф4).
- **Few-shot сдвигает распределение типов** → baseline ДО / diff ПОСЛЕ (Ф4).
- **Второй писатель оси (хроносверка)** → только вердикт-провайдер (Ф8, запрещено иначе).
- **Снос regex до обучения friction** → порядок-гейт Ф4→Ф9→Ф11б (обучить friction ДО сноса — корректность, не тест; без watch, ВР8).
- **Заморозка клона при ON** → rebuild-enqueue из combo (Ф3) — критичный фикс.
- **Движок block-ingest** → остаётся `deepseek-v4-pro` (Вариант A); Opus НЕ ставим (стандарт «НЕ anthropic» + cap `sensitive`<`private` + стоимость на самом частом вызове); качество — Ф4/Ф5/Ф6.
- **Скелет — инъекция/галлюцинация** → user-data + wrapUserData + fail-open (Ф6).
- **Снос спайна задач рассинхрон с ТЗ задач** → координировать Ф11(в) с ТЗ задач Ф7 (общий `router.service.ts`).

## Idempotency / feature-flag / prod-deploy
- **Idempotency:** хроносверка — `updateMany WHERE validUntil IS NULL`; combined jobId per-meeting/conversation; задачи — externalId (ТЗ задач). Повтор = no-op.
- **Флаги (реестр `feature-flags.md`):** `knowledge.specialistsCombinedEnabled` (kill-switch, ON); `knowledge.skeletonPassEnabled`/`headerMapEnabled` (kill-switch, ON); `blockIngestGleaningRounds`/`blockIngestWindowOverlapSegments` (knob); пороги конфликтов (knob).
- **prod-deploy-log:** Шаг 1 (ENV `zBool` + перенос крутилок + новые), Шаг 7 (сиды AdminSetting + LlmTaskRoute `meeting-skeleton`), Шаг 12 (smoke `meeting-skeleton`-маршрут + combo на чате + grep ProcessDetector в dispatch). Миграций БД нет.

## DoD
- `bun run typecheck`/`lint`/`build` зелёные; `bunx vitest run` затронутых — зелёные; needle-in-the-middle и golden-фикстуры зелёные.
- Разовая проверка combo на реальных разговорах проведена (Ф10); снос старых движков (Ф11) выполнен (без A/B — недоступно владельцу; страховка — рубильник+метрики).
- second-brain (knowledge-core/ai-jobs/workers-queues/module-map) + prod-deploy-log + feature-flags обновлены; `04_не-сделано` актуализирован.
- Рефлексия после push.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_

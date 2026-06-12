---
title: "Фаза 2 «отчёт встречи → граф» (вариант Б: summaryFast + структурные extract_*)"
date: 2026-06-11
status: ready
type: tz
phase: 2
feature: report-to-graph
owner-decisions:
  - "Р1 = вариант Б (summaryFast + структурные выводы по типу встречи) — ЗАФИКСИРОВАН"
related-modules:
  - backend/src/modules/ingest
  - backend/src/modules/ingest/adapters
  - backend/src/modules/knowledge-core/workers/block-ingest.worker.ts
  - backend/src/modules/knowledge-core/workers/block-distill.worker.ts
  - backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts
  - backend/src/modules/knowledge-core/services/segment-builder.service.ts
  - backend/src/modules/knowledge-core/services/block-merge.service.ts
  - backend/src/modules/knowledge-core/services/block-extraction.service.ts
  - backend/src/modules/knowledge-core/prompts/block-distill.prompt.ts
  - backend/prisma/schema.prisma
related-docs:
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/data-model.md
  - second-brain/01_projects/ai-jobs.md
  - second-brain/01_projects/workers-queues.md
  - docs/operations/feature-flags.md
  - docs/operations/prod-deploy-log.md
---

# Фаза 2 «отчёт встречи → граф» (вариант Б)

## §0. Кратко + зафиксированное решение владельца

**Задача.** Сейчас в граф знаний (knowledge-core) попадает только транскрипт встречи. Готовый AI-отчёт (быстрый `summaryFast` + структурные выводы `decisions/risks/pains/tasks` по типу встречи) в граф НЕ заносится — значит решения, риски и боли, которые AI уже извлёк в отчёт, не становятся узлами графа и не доступны для поиска/клонов/дашборда. Фаза 2 закрывает этот разрыв: после готовности fast-отчёта формируем отдельное событие ingest (приём данных) `meeting_report` и проводим его через штатный pipeline `RawEvent → IdeaBlock → IdeaBlockLink → Theme`.

**Зафиксировано (Р1 = Б).** Реализуем именно **вариант Б**: в граф идут И `summaryFast` (быстрое саммари + главы), И **структурные выводы по типу встречи** — каждый как отдельный гранулярный блок с правильным `signalType` (тип сигнала: решение / риск / боль / задача). Вариант А (только плоский текст саммари) отклонён владельцем — он теряет структуру и тип сигнала.

**Категорически НЕ заносим** клиентский протокол `client_protocol_md` — это граница конфиденциальности D6 (нейтральный документ для клиента без внутренней аналитики). См. §2.4.

**Ключевой риск задачи — безопасность графа (hallucination guard, §3).** Отчёт — **вторичный** источник относительно транскрипта (первичный, дословный). Нельзя допустить, чтобы:
- **(а)** блок из отчёта «перехватил» статус `canonical` (канонический, главный экземпляр факта) у транскриптного блока;
- **(б)** факт, существующий ТОЛЬКО в отчёте, стал `canonical` без подтверждения транскриптом;
- при этом нельзя сломать дедупликацию (устранение дублей) транскрипт-vs-транскрипт.

**Миграция: ДА** (новое значение enum `SourceType='meeting_report'` + новое поле `IdeaBlock.primarySource`). **Обоснование (1 строка):** безопасный путь — детерминированный machine-guard на источник блока, а не soft-признак (тег + порог уверенности), который рушится при первой же правке порога админом; два из трёх судей за миграцию именно по критерию машинной надёжности провенанса.

---

## §1. Проверенные факты-якоря (path:line)

Все факты ниже подтверждены чтением кода; ТЗ опирается ТОЛЬКО на них.

### 1.1. Ingest (приём событий) — контракт

- `IngestService.ingest(input: IngestEventInput): Promise<IngestResult>` — `ingest.service.ts:34-46` (сигнатура), `:81-135` (тело), `:188-204` (запись `RawEvent`).
  - Вход: `tenantId` (обяз.), `sourceId` (обяз.), `sourceExternalId?: string|null`, `occurredAt: Date` (обяз.), `payload: unknown` (сериализуемый JSON), `dataClass?: DataClass` (деф. из source или `'internal'`).
  - Выход: `{ rawEvent: RawEvent, idempotent: boolean }`.
  - `idempotencyKey = sha256(sourceId + ':' + (sourceExternalId ?? payloadChecksum) + ':' + occurredAtIso)` — `ingest.service.ts:34-46`. **Детерминирован**: одна встреча с тем же `sourceExternalId` + `occurredAt` всегда даёт один `RawEvent`.
  - `RawEvent.sourceType = source.type as SourceType` — каст PostgreSQL-enum, `ingest.service.ts:188-204` (каст на :192). **Передать «строку нового типа» нельзя — нужна миграция enum.**
- `MeetingIngestAdapter.ingestMeeting(meetingId): Promise<IngestResult>` — `meeting.adapter.ts:64-163`.
  - lazy-upsert дефолтного `Source(tenantId, type='meeting', name='Встречи Z')` через unique `(tenantId,type,name)` — `meeting.adapter.ts:169-205` (метод `upsertDefaultMeetingSource`).
  - Вызывает `ingest` с `sourceExternalId = meetingId`, `dataClass='internal'`.

### 1.2. Схема БД (enum, модели)

- `enum SourceType` — `schema.prisma:251-277`. Текущие значения: `meeting, chat, phone_call, bot, email, web_form, external, conversational, tracker_event, chatbox, daily_checkin`. **`meeting_report` отсутствует.**
- `enum DataClass`: `public, internal, sensitive, private`.
- `enum RawEventPayloadStorage`: `inline` (деф.), `s3`. `enum RawEventProcessingStatus`: `received` (деф.), `ingested`, `failed`.
- `model RawEvent` — `schema.prisma:3234-3250`: `sourceType: SourceType` (enum!), `tenantId, sourceId, sourceExternalId?, idempotencyKey (unique), occurredAt, payload Json?, payloadStorage`.
- `model Source` — `schema.prisma:3254-3285`: `type: SourceType` (enum!), unique `(tenantId,type,name)`, `dataClass DataClass @default(internal)`, `isActive Boolean @default(true)`.
- `model IdeaBlock` — `schema.prisma:3303-3417`: `status IdeaBlockStatus ('draft'|'canonical'|'merged_into'|'archived')`, `mergedIntoId String?`, `signalType SignalType`, `confidence Decimal`, `dynamicScore` (влияет на ранжирование поиска), `tags String[]`, `evidence IdeaBlockEvidence[]`. **Поля `sourceType`/`primarySource` НА БЛОКЕ НЕТ.**
- `model IdeaBlockEvidence` — `schema.prisma:3452-3468`: `sourceType: SourceType` (привязан к evidence, НЕ к блоку), `blockId FK`.
- Прецеденты миграции enum (idempotent): `migrations/20260605120000_chatbox_integration/migration.sql:23` (ALTER TYPE ADD VALUE), `migrations/20260610140000_source_type_daily_checkin/migration.sql:7` (ALTER TYPE ADD VALUE **IF NOT EXISTS** — повторный прогон безопасен).

### 1.3. RawEvent.payload → Segment → IdeaBlock

- `block-ingest.worker.ts:267`: `const segments = this.segments.buildSegments(payload)`.
- `SegmentBuilderService.buildSegments(payload)` — `segment-builder.service.ts:79-108`. Выбор пути: meeting (`payload.transcript.turns`) → `fullText` → `freeNoteText` → fallback `JSON.stringify`.
  - `:129-131`: `if (!p.transcript || !Array.isArray(p.transcript.turns)) return null` — meeting-ветка требует именно `transcript.turns`.
  - `:88-97`: ветка `fullText` (TrackerAdapter) — берёт весь текст ОДНИМ сегментом без парсинга.
  - `:175-177`: identity сегмента из `speakerParticipantId`.
  - SegmentBuilder только строит сегменты из полей payload; синтетику он НЕ создаёт.
- `block-extraction.service.ts:200`: Zod-схема `confidence: z.number().min(0).max(1)`. `:499`: `confidence: b.confidence` (маппинг из ответа LLM 1:1). `:378,:449`: `dataClass` пробрасывается в LLM как контекст, на confidence НЕ влияет.
- `block-ingest.worker.ts:1088`: `confidence: new Prisma.Decimal(block.confidence.toFixed(3))` — confidence записывается ДОСЛОВНО из ExtractedBlock. (`persistBlock`, create блока — `:1080-1101`.)
- `block-ingest.worker.ts:1114`: `IdeaBlockEvidence.sourceType` пишется ДОСЛОВНО из `event.sourceType`.
- Синтетический блок (`signalTypeHint`) — `block-ingest.worker.ts:289-303` (применяется если LLM не вернул блоков И есть hint), `:1013-1043` (`buildSyntheticBlock`), `:1036`: confidence синтетика ВСЕГДА `0.95` жёстко.
- Ветвления confidence по sourceType при ingest **НЕТ**. `sourceType==='meeting'` используется только для `sourceMeetingId` в Decision-сущности (`:590,:639`) и для доступа в `BlockAccessDeriverService` (`:824-826`), на confidence не влияет.

### 1.4. BlockDistill — выбор canonical при дедупе (КОРЕНЬ §2.2)

- `block-distill.worker.ts:116-166` — `process(job)`: получен draft-блок.
  - `:137-142`: KNN-запрос (k ближайших соседей по cosine-сходству эмбеддингов) **только среди `status='canonical' AND mergedIntoId IS NULL`**.
  - `:144-146`: нет кандидатов выше порога → `markCanonical(block)` (АВТО-canonical).
  - `:149-154`: иначе → `judgeMerge` (LLM-арбитр).
  - `:156-159`: LLM вернул `'distinct'` → `markCanonical(block)` (АВТО-canonical).
  - `:161-165`: иначе → `mergeInto(block, verdict.canonicalId)`.
- `markCanonical(block)` — `:170-233`: `UPDATE status='canonical'` (`:171-174`) → enqueue block-linker (`:175-181`) → `router.dispatch` специалистов (`:188-202`).
- `mergeInto(args:{block,canonicalId,explanation})` — `:235-339`: проверяет `canonical.status==='canonical'` (`:256-272`, иначе error/fallback; целевой блок обязан быть canonical — `:265`); обновляет canonical: `evidenceCount += weighted`, `confidence = weighted-avg`, `tags = union` (`:318-337`).
- `BlockMergeService.knnCandidates({tenantId,blockId,topK,threshold})` — `block-merge.service.ts:101-147`. `:113-131`: `ORDER BY embedding <=> (...)` (по cosine-distance), `similarity = 1 - distance` (`:119-121`), фильтр `if (sim <= threshold) continue` (`:141`). **Фильтр кандидатов: `status='canonical' AND mergedIntoId IS NULL` (`:124,:127`).**
- `judgeMerge(...)` — `block-merge.service.ts:150-212`. `summariseBlock(b)` — `:248-257` — передаёт LLM **только** `{id, name, criticalQuestion, trustedAnswer, signalType, tags}`. **НЕ передаёт: confidence, evidenceCount, createdAt, sourceType, dataClass, источник.**
- `parseVerdict(text, candidates)` — `:216-246`. `:234`: защита — `canonicalId` обязан быть из переданных кандидатов, иначе трактуется как `'distinct'`. **Защищает от галлюцинации ИМЕНИ, но НЕ от неверного выбора среди реальных кандидатов при равном similarity.**
- `BLOCK_DISTILL_SYSTEM_PROMPT` — `block-distill.prompt.ts:41-54`. Содержит строку «при противоречии источников бери более позднее / актуальное знание», но LLM **источник не получает** (`summariseBlock` его не включает) — правило висит впустую.

**КРИТИЧЕСКИЙ ФАКТ механики (вскрыт всеми судьями).** `knnCandidates` фильтрует только `status='canonical'`. Значит идея «оставить report-only блок в `draft`, его подтвердит транскрипт» **не работает сама по себе**: пришедший позже транскриптный блок при своём distill НЕ увидит report-draft через KNN. Подтверждение должен инициировать **сам report-блок** (повторный KNN против актуальных canonical-транскриптов) — см. §3 ГАРД C.

### 1.5. AiResult и fast-отчёт (вход данных для адаптера)

- `model AiResult.structuredData Json?` — `schema.prisma:1554` (в блоке `1548-1588`). **ЕДИНАЯ колонка, но shape ПОЛИМОРФЕН по `meeting.type`.** Записывается в `analyze.worker.ts:303` как `data.json` после `safeParse`.
- `client_protocol_md` мержится в `structuredData` отдельным агентом — `analyze.worker.ts:348` (блок 5a, best-effort, `:328-369`). Это free-text Markdown без JSON-схемы; `client-meeting-split.prompt.ts:14,:33` — «FREE-TEXT, без внутренней аналитики (нет интереса/температуры сделки, нет ярлыков боль/возражение)». Типы с протоколом: `CLIENT_PROTOCOL_TYPES = {sales, customer_success, partner, custdev}`.
- Zod-схемы структурных выводов по типу (источник реальных ключей):
  - **sales** — `type-sales.ts:19-35`: `pain` (nullable), `interest_level`, `objections[]`, `budget`, `decision_maker`, `urgency`, `next_step`, `competitors[]`, `decision_criteria[]`, `what_hooked`, `main_blocker`, `data_quality`.
  - **team** — `type-team.ts:18-36`: `discussed[]`, `decisions[]` (объекты `{text, speaker, changes_what}`), `tasks[]`, `blockers[]`, `next_step`, `ideas[]`, `data_quality`.
  - **standup** — `type-standup.ts:17-30`: `priorities[]`, `who_does_what[]`, `new_tasks[]`, `blockers[]`, `decisions_needed[]`, `next_checkpoint`, `proposals[]`, `data_quality`.
  - **review** — `type-review.ts:28-47`: `subject`, `went_well[]`, `to_improve[]`, `risks[]`, `next_steps[]`, `verdict`, `decisions[]`, `data_quality`.
  - **МИФ о едином shape разоблачён:** `risks ⊂ {review}`, `pains(pain) ⊂ {sales}`, `decisions` есть у `{team, review}` (разные формы) и `decisions_needed` у `{standup}`. Единого `{decisions,risks,pains}` НЕТ — читать по типу через нужную Zod-схему.
- Триггер: `meeting-report-fast.worker.ts:400-407` — запись `reportFastStatus` (`'ready'|'partial'|'failed'`), `reportFastError`, `reportFastGeneratedAt`. Вычисление статуса — `:392-399` (`allFailed = failures.length === 3`; три writer'а: chapters, tasks, summary). Worker завершает `process()` на `:436`; никаких enqueue после записи статуса сейчас нет.
- Паттерн best-effort enqueue после события: `analyze.worker.ts:539-546` (dashboardQueue в try/catch — сбой НЕ откатывает основной результат) и `analyze.worker.ts:412` (событие `MEETING_AI_READY` через EventEmitter2).

---

## §2. Дизайн

### 2.1. Формат входа в block-ingest

**Новый адаптер** `backend/src/modules/ingest/adapters/report.adapter.ts` — `ReportIngestAdapter.ingestReport(meetingId): Promise<IngestResult>` (по образцу `meeting.adapter.ts:64-205`). Создаёт **отдельный** `RawEvent`, НЕ дописывает к meeting-RawEvent.

1. **Source.** lazy-upsert `Source(tenantId, type='meeting_report', name='Отчёты встреч Z')` через unique `(tenantId,type,name)` — паттерн `upsertDefaultMeetingSource` (`meeting.adapter.ts:169-205`). **Отдельный Source** (не переиспользуем `meeting`) — так `IdeaBlockEvidence.sourceType` бесплатно получает `'meeting_report'` из `event.sourceType` (`block-ingest.worker.ts:1114`), и источник машинно различим на уровне evidence.
2. **Per-type нормализация в гранулярные факты.** Адаптер читает `Meeting` + `AiResult.structuredData` + fast-блок (chapters/tasks/summary) и через **`report-fact-mapper.ts`** (новый, ~120 строк) раскладывает `switch(meeting.type)` ТОЛЬКО реально присутствующие по Zod-схеме типа поля в плоский массив:
   ```
   reportFacts: Array<{
     reportKind: 'decision' | 'risk' | 'pain' | 'task' | 'next_step' | 'blocker' | 'summary_point',
     text: string,
     speaker?: string,
   }>
   ```
   - sales → `pain`→pain, `objections[]`→risk, `competitors[]`→summary_point, `next_step`→next_step, `main_blocker`→blocker.
   - team → `decisions[]{text,speaker,changes_what}`→decision (speaker сохраняем), `blockers[]`→blocker, `tasks[]`→task, `next_step`→next_step.
   - standup → `decisions_needed[]`→decision, `blockers[]`→blocker, `new_tasks[]`→task, `priorities[]`→summary_point.
   - review → `risks[]`→risk, `decisions[]`→decision, `to_improve[]`→summary_point, `next_steps[]`→next_step.
   - `summaryFast` (summary_markdown) и каждая chapter → отдельные `summary_point`-факты.
   - **Неизвестный / невалидный type** (`safeParse` fail или нет `structuredData`) → graceful: кладём только `summaryFast` + chapters; listener НЕ падает. Если и тех нет (пустой reportFacts И пустое summary) → RawEvent НЕ создаём.
3. **Payload** (Json, без enum-ограничений):
   ```
   { kind: 'meeting_report', meetingId, meetingType, reportSummaryMarkdown, chapters: [...], reportFacts: [...] }
   ```
4. **Ingest-вызов.** `ingest.ingest({ tenantId, sourceId, sourceExternalId: 'report_' + meetingId, occurredAt: meeting.endedAt, payload, dataClass: 'internal' })`.
   - `sourceExternalId = 'report_' + meetingId` — суффикс ОБЯЗАТЕЛЕН: иначе `idempotencyKey` совпадёт с транскриптным RawEvent.
   - `occurredAt = meeting.endedAt` (СТАБИЛЕН) — НЕ `reportFastGeneratedAt`: иначе регенерация отчёта меняет ключ и плодит дубли.

**Гранулярность (ветка SegmentBuilder).** В `SegmentBuilderService.buildSegments` (`segment-builder.service.ts:79-108`) добавить ветку ПОСЛЕ meeting/fullText/freeNote и ДО fallback: если `payload.kind==='meeting_report'` и `Array.isArray(payload.reportFacts)` — строить **по одному сегменту на каждый факт** (`text` + `meta.reportKind`), плюс отдельные сегменты на `reportSummaryMarkdown` и каждую chapter. Так block-ingest получает гранулярные блоки (по факту), а не один склеенный fullText. `signalTypeHint` per `reportKind` (decision→decision, risk→risk, pain→pain) пробрасывается как ПОДСКАЗКА типа в block-ingest, **но синтетику для report НЕ форсим** (см. §3 — пусть LLM извлекает; на report-пути `signalTypeHint`-ветку синтетики НЕ включаем).

### 2.2. Провенанс / trust

Три слоя:
- **Evidence:** `IdeaBlockEvidence.sourceType='meeting_report'` — пишется бесплатно из `event.sourceType` (`block-ingest.worker.ts:1114`). Правок воркера здесь не требуется.
- **Блок (НОВОЕ поле):** `IdeaBlock.primarySource String? @db.VarChar(16)` — значения `'transcript'|'report'`, `null` = исторические трактуем как `'transcript'`. Источник нужен НА уровне блока, потому что `summariseBlock` слеп к источнику, а evidence может быть мульти-source. Это детерминированный признак для merge/distill-гардов (не soft tag).
- **Вес:** report-блоки получают cap уверенности (ГАРД A) + заниженный стартовый `dynamicScore` (≈0.7 vs 1.0) — report виден в поиске, но ниже транскриптного primary.

### 2.3. Миграция — ДА, и почему именно ДА

**Решение: миграция нужна.** Безопасный путь — детерминированный machine-guard на источник, а не soft-признак. Soft-вариант (tag `src:report` + cap confidence) рушится, если админ через AdminSetting поднимет cap уверенности — гарантия §2.2 утекает. Явное поле `primarySource` + enum-значение делают провенанс машинно-надёжным независимо от крутилок.

**Состав миграции (ДВА файла — обязательно):**
- Файл 1: `ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'meeting_report';` (паттерн `daily_checkin migration.sql:7`; `IF NOT EXISTS` → повторный прогон безопасен).
- Файл 2: `ALTER TABLE "IdeaBlock" ADD COLUMN "primarySource" VARCHAR(16);` (+ опц. индекс).

**Почему ДВА файла, а не один (проверено).** PostgreSQL не позволяет использовать новое значение enum в той же транзакции, где оно добавлено через `ALTER TYPE ... ADD VALUE`. Prisma оборачивает каждый файл миграции в одну транзакцию. Хотя `ADD VALUE` + `ADD COLUMN` сами по себе значение НЕ используют (мы его применяем только в рантайме через адаптер), в части версий PG `ALTER TYPE ADD VALUE` вообще не выполняется в транзакционном блоке вместе с другим DDL. **Безопасное правило: `ADD VALUE` — отдельным файлом ПЕРЕД файлом с `ADD COLUMN`.** Прецеденты daily_checkin/chatbox держат `ADD VALUE` изолированно. Подтверждено: Context7 прямого опровержения не дал, опыт PG однозначен — разделяем.

Команда: `bun run prisma:migrate -- --name source_type_meeting_report` (файл 1), затем `bun run prisma:migrate -- --name idea_block_primary_source` (файл 2). НЕ `db push`. Поле nullable, backfill НЕ нужен (`null`=`transcript` в коде).

### 2.4. Граница конфиденциальности D6

`client_protocol_md` — в **blacklist** маппера: НИКОГДА не попадает в payload. Mapper строит payload по **whitelist** именно внутренних полей structuredData. Машинный гард: unit-тест проверяет отсутствие подстроки протокола в собранном payload (см. §5 Ф2). Обоснование: `client-meeting-split.prompt.ts:33` — протокол не содержит внутренней аналитики и предназначен клиенту; его факты не должны попасть в граф как внутренние блоки.

---

## §3. Защита от галлюцинаций (hallucination guard, §2.2 — точные места)

Линза — НЕ доверять LLM-арбитру в вопросе провенанса. `parseVerdict` (`block-merge.service.ts:234`) защищает только от галлюцинации ИМЕНИ кандидата, но НЕ от неверного выбора при равном similarity. Любая защита «transcript побеждает» только промптом статистически течёт. Поэтому каждый инвариант §2.2 закрыт **детерминированным** гардом.

### ГАРД A — пониженный trust report на входе

**Место:** `block-ingest.worker.ts:1088` (внутри `persistBlock`, create блока `:1080-1101`).
```ts
const isReport = event.sourceType === 'meeting_report';
const conf = isReport
  ? Math.min(block.confidence, REPORT_CONFIDENCE_CEILING)
  : block.confidence;
// в ideaBlock.create:
//   confidence: new Prisma.Decimal(conf.toFixed(3)),
//   primarySource: isReport ? 'report' : 'transcript',
```
- `REPORT_CONFIDENCE_CEILING` — крутилка `AdminSetting` (`cfg.getDynamic('knowledge.reportBlockConfidenceCap')`), code-fallback `0.6`. **НЕ ENV, НЕ хардкод** (правило: крутилки идут в AdminSetting).
- На report-пути синтетику НЕ создаём (`signalTypeHint`-ветка синтетики `:289-303` не активируется для report).
- **Транскриптная ветка не затронута** (`isReport=false` → поведение побитово прежнее, `primarySource='transcript'`).

### ГАРД B — транскрипт ПОБЕЖДАЕТ при дедупе (детерминированно, §2.2.а)

Три уровня, главный — третий (machine-guard):
1. **`summariseBlock` (`block-merge.service.ts:248-257`)** += поле `primarySource: b.primarySource ?? 'transcript'`. Теперь LLM видит источник кандидата.
2. **`block-distill.prompt.ts:41-54`** += ОДНА стабильная строка в SYSTEM (cache-friendly: правим SYSTEM единожды, переменные данные остаются в user): «report — вторичный источник; при выборе canonical между report и transcript canonical ВСЕГДА transcript, report только сливается в него».
3. **ГЛАВНОЕ — детерминированный пост-гард в `block-distill.worker.ts` `process()` между `judgeMerge` (`:149`) и `mergeInto` (`:161`):**
   - Опасный случай: `verdict='merge'`, НОВЫЙ блок `primarySource='transcript'`, а выбранный `canonical.primarySource='report'`. → Вызвать **`swapDirection(transcriptBlock, reportCanonicalId)`**: транскрипт становится canonical-носителем, report помечается `merged_into`.
   - `swapDirection` — отдельный метод ПОВЕРХ транзакции `mergeInto` (`:255-338`): роли canonical/merged меняются местами, переносятся evidence/entities/tags/evidenceCount; **confidence нового canonical = `max(transcript.confidence, …)`, НЕ слепое усреднение** (иначе высокоуверенный транскрипт просел бы в низкоуверенном report).
   - **Включается СТРОГО при `new.primarySource='transcript' && canonical.primarySource='report'`.** Случаи transcript↔transcript и report↔report **НЕ затронуты** — это обязательный регресс-тест (§5 Ф4 а,б).
   - Обычный merge report(new)→transcript(canonical) идёт штатным `mergeInto`; cap≤0.6 и evidenceCount=1 слабо тянут weighted-avg (`:318-337`), транскриптный canonical вес не теряет.

### ГАРД C — report-only факт = вторичный по весу, не «высокий вес» (§2.2.б)

> **РЕШЕНИЕ ОРКЕСТРАТОРА (упрощение vs первичный синтез workflow, 2026-06-11).**
> Первый синтез предлагал ИСКЛЮЧАТЬ report-only факт из графа (draft → не
> линкуется → `ReportClaimReconcileCron` + TTL→archived). Это (1) во многом
> обнуляет вариант Б (владелец выбрал Б именно чтобы обогатить граф чистыми
> структурными выводами отчёта — а самые уникальные из них как раз отсутствуют
> отдельным блоком в шумном транскрипте), (2) тащит новый cron + TTL + draft-лимбо.
> §2.2.б требует НЕ «исключить», а «не давать **высокий вес/canonical без
> подтверждения**». Это точнее и проще: report-only блок СТАНОВИТСЯ canonical
> (обогащает граф per Б), но остаётся **вторичным по весу** — этого достаточно.

**Место:** не требует правок `block-distill` авто-canonical путей (`:144-146`, `:156-159`) — report-only идёт штатным `markCanonical`. «Не высокий вес» обеспечивается на входе (ГАРД A) и уже примененным `primarySource`:
- **Cap confidence ≤ 0.6** (ГАРД A) — report-блок никогда не получает высокую уверенность.
- **Пониженный `dynamicScore`** (≈0.7 vs 1.0 у транскрипта) — report ранжируется НИЖЕ транскриптного primary в поиске/клонах/дашборде.
- **`primarySource='report'`** — провенанс машинно виден; «вторичность» фиксирована полем, а не только числом.
- При появлении транскрипта-дубля позже → **ГАРД B** (swapDirection) делает canonical-носителем транскрипт. Report-only без дубля живёт в графе как вторичный низковесный узел (что и есть цель Б).

**`ReportClaimReconcileCron` и TTL-archival НЕ реализуются** (удалены из scope как over-engineering).

**Итог §3:** (а) закрыт ГАРДОМ B (machine swap при пересечении с транскриптом); (б) закрыт ГАРДОМ A (report-only = capped confidence + низкий dynamicScore + видимый `primarySource='report'` → вторичный по весу, не «высокий вес/canonical без подтверждения»); regress транскрипт-vs-транскрипт защищён строгим условием срабатывания ГАРДА B (`primarySource`-проверка) + обязательными тестами Ф4.

---

## §4. Trigger + идемпотентность

### 4.1. Trigger

- **Где:** после записи `reportFastStatus` (`meeting-report-fast.worker.ts:400-407`), ТОЛЬКО при `status ∈ {'ready','partial'}` (НЕ `'failed'` — `:393` allFailed, класть нечего).
- **Как:** эмитим EventEmitter2-событие `'meeting.report-fast-ready'` `{meetingId, tenantId, status}` сразу после `prisma.meeting.update` (~`:407`), в **try/catch best-effort** (паттерн dashboardQueue `analyze.worker.ts:539-546` — сбой эмита НЕ откатывает `reportFastStatus`, нет race).
- **Listener:** `ReportIngestListener` (`@OnEvent` async, в ingest/knowledge-core) → `ReportIngestAdapter.ingestReport(meetingId)` → `IngestService.ingest` → `RawEvent(received)` → штатный enqueue block-ingest.
- **Почему событие, а не прямой enqueue:** разрывает зависимость report-fast-воркера от ingest/knowledge-core (паттерн `MEETING_AI_READY` `analyze.worker.ts:412`).
- **Порядок на проде:** транскрипт-ingest должен идти раньше report-ingest (снижает шанс, что report-only уйдёт в гейт до прихода транскрипта).
- **Kill-switch** `REPORT_INGEST_ENABLED` — Ship-On: фича выкатывается ВКЛЮЧЁННОЙ (ON), рубильник нужен только для экстренного отключения при инциденте. Строка в `docs/operations/feature-flags.md`.

### 4.2. Идемпотентность (3 уровня, опираемся на существующие гарды)

1. **ingest:** `idempotencyKey = sha256(sourceId + ':report_' + meetingId + ':' + endedAtIso)` детерминирован (`ingest.service.ts:34-46`); `occurredAt=meeting.endedAt` стабилен → повторный `'ready'`/BullMQ-retry/ре-эмит → `idempotent=true`, второй RawEvent НЕ создаётся. `sourceExternalId='report_'+meetingId` ≠ транскриптного `meetingId` → ключи не конфликтуют (+ разные Source).
2. **block-ingest:** скип RawEvent с `processingStatus≠'received'` (`block-ingest.worker.ts:252-258`).
3. **block-distill:** скип блока с `status≠'draft'` (`:126-132`), `jobId=block_distill_<blockId>` — дедуп BullMQ.

**Ограничение (→ реестр не-сделано).** Регенерация отчёта (новый `reportFastGeneratedAt`, тот же `endedAt`) → тот же ключ → обновлённые факты НЕ попадут. Для MVP приемлемо (отчёт завершённой встречи стабилен). Строка в `second-brain/04_не-сделано/README.md` (что · почему · `report.adapter.ts:occurredAt` · кто разблокирует). При необходимости — reprocess через существующий механизм пере-извлечения, НЕ меняя `occurredAt`.

---

## §5. Фазы реализации с acceptance

### Ф1 — Миграция + схема
- **Файлы:** `schema.prisma` (enum `SourceType` += `meeting_report` на `:251-277`; `IdeaBlock.primarySource String? @db.VarChar(16)` в `:3303-3417`; опц. `@@index([tenantId, signalType, primarySource])`); ДВА файла миграции (см. §2.3); `prisma:generate`.
- **Acceptance:**
  - `bun run prisma:migrate` проходит локально (оба файла), `prisma:generate` ок, `bun run typecheck` зелёный.
  - Повторный `prisma migrate deploy` idempotent (`IF NOT EXISTS` на ADD VALUE).
  - В БД: `SourceType` содержит `meeting_report`; `IdeaBlock.primarySource` существует, nullable.
- **prod:** обновить `prod-deploy-log.md` Шаг 4 (enum + поле).

### Ф2 — Адаптер + per-type mapper + ветка SegmentBuilder
- **Файлы:** `ingest/adapters/report.adapter.ts` (~120, образец `meeting.adapter.ts:64-163`), `report-fact-mapper.ts` (~120), ветка `reportFacts` в `segment-builder.service.ts` (после meeting/fullText/freeNote, до fallback).
- **Acceptance (тесты):**
  - **Позитив:** unit на mapper по 4 типам (sales/team/standup/review) — каждый структурный ключ → правильный `reportKind`; `team.decisions[].speaker` сохранён.
  - **Позитив (гранулярность):** unit SegmentBuilder — `reportFacts[N]` → N сегментов с `meta.reportKind`; `summaryFast` и каждая chapter — отдельные сегменты (НЕ 1 склеенный).
  - **Негатив (graceful):** неизвестный/невалидный `meeting.type` → mapper кладёт только summaryFast+chapters, не бросает; пустой reportFacts И пустой summary → адаптер НЕ создаёт RawEvent.
  - **Негатив (D6):** unit — `client_protocol_md` (и его подстрока) отсутствует в собранном payload при `type='sales'`.

### Ф3 — Триггер + listener + kill-switch
- **Файлы:** эмит события `meeting-report-fast.worker.ts:~407` (try/catch), `ReportIngestListener`, kill-switch `REPORT_INGEST_ENABLED`.
- **Acceptance (тесты):**
  - **Позитив:** e2e — `reportFastStatus='ready'` (и `'partial'`) → создаётся РОВНО ОДИН `RawEvent` с `sourceType='meeting_report'`, `sourceExternalId='report_<id>'`, `primarySource`-блоки `'report'`.
  - **Негатив:** `'failed'` → событие НЕ эмитится → 0 RawEvent.
  - **Негатив (изоляция):** искусственный throw в `ingestReport` НЕ откатывает `reportFastStatus` (try/catch best-effort).
  - **Идемпотентность:** повторный эмит/тот же meetingId → `idempotent=true`, RawEvent всё ещё один.
- **prod:** `prod-deploy-log.md` Шаг 12 (smoke-grep нового события/listener), `ai-jobs.md`, `workers-queues.md`, `feature-flags.md` (kill-switch).

### Ф4 — Гарды A/B + swapDirection (САМАЯ РИСКОВАЯ)
- **Файлы:** `block-ingest.worker.ts:1088` (ГАРД A: cap confidence + `primarySource` + пониженный `dynamicScore`), `block-merge.service.ts:248` (`summariseBlock`+primarySource), `block-distill.prompt.ts:41-54` (+1 строка SYSTEM), `block-distill.worker.ts` `process()` (ГАРД B пост-гард + `swapDirection` между `judgeMerge` и `mergeInto`), AdminSetting `knowledge.reportBlockConfidenceCap` (fallback 0.6). **ГАРД C — без отдельного кода** (report-only идёт штатным `markCanonical`, вторичность обеспечена ГАРДОМ A).
- **Acceptance (ОБЯЗАТЕЛЬНЫЕ, блокирующие):**
  - **(а) Регресс:** transcript↔transcript merge — направление НЕ развёрнуто, поведение побитово прежнее.
  - **(б) Регресс:** report↔report merge — как раньше.
  - **(в) Позитив:** report-vs-transcript (`new=transcript`, `canonical=report`) → swap: canonical=transcript, report→`merged_into`, **confidence транскрипта НЕ просел** (max, не усреднение).
  - **(г) Позитив:** report-only без KNN-транскрипта → штатный `markCanonical`, НО блок имеет `primarySource='report'`, `confidence ≤ 0.6`, пониженный `dynamicScore` (вторичный по весу).
  - **(д) Позитив (ГАРД A):** report-блок persist с `confidence ≤ 0.6` (cap) и `primarySource='report'` + сниженный `dynamicScore`; транскриптный блок (`isReport=false`) — побитово без изменений (`primarySource='transcript'`).
  - **(е) Идемпотентность:** повторный `report-fast-ready` не плодит блоки/RawEvent.

### Ф5 — Документация
- `knowledge-core.md` (новый вторичный источник + trust через `primarySource`/cap/dynamicScore + гарды A/B + правило «любой будущий вторичный источник ОБЯЗАН ставить primarySource»); `data-model.md` (новое поле + enum-значение, Шаг 4); `feature-flags.md` (`REPORT_INGEST_ENABLED` kill-switch ON + `knowledge.reportBlockConfidenceCap` как AdminSetting-крутилка); `04_не-сделано/README.md` (regen-reingest отложен); `ai-jobs.md`/`workers-queues.md` (listener `ReportIngestListener`).

---

## §6. Анти-регрессия (граф / трекер / дедуп)

1. **`block-distill` и `SegmentBuilder` — ГЛОБАЛЬНЫЕ пути** (дедуп всего графа + ingest всех источников). Транскриптная ветка обязана остаться **побитово прежней**: `primarySource=NULL→'transcript'` сохраняет авто-canonical и текущее merge-направление. После КАЖДОЙ правки — grep-факт-чек реальных строк (`markCanonical:144-146/156-159`, условие swap, поле `primarySource` в `summariseBlock`/`persistBlock`) + `git status`; после каждого Edit суб-агента — re-Read (агенты помечают [x] без реальных правок).
2. **Любой БУДУЩИЙ вторичный источник ДОЛЖЕН явно ставить `primarySource`** — иначе дефолт `'transcript'` пропустит его через авто-canonical. Задокументировать в `knowledge-core.md`.
3. **Гонка fast-vs-structured-vs-transcript-ingest:** report-ingest может обогнать транскрипт → оба факта станут canonical-дублями; при distill транскрипта `judgeMerge` найдёт report-canonical → ГАРД B (swapDirection) делает canonical транскрипт. Порядок enqueue на проде — транскрипт раньше report (снижает окно).
4. **Prompt-cache `block-distill`:** правим SYSTEM единожды (одна строка), переменные данные только в user — иначе ломаем кэш и теряем экономию.
5. **НЕ трогать:** `entity-merge` (свой LLM-арбитр сущностей) и `analyze.worker` (только читаем его выход `structuredData`); `parseVerdict`-защиту имени кандидата (`:234`) сохраняем.
6. **Трекер/задачи:** report-`task`-факты идут как блоки в граф (signalType task) — это НЕ создаёт записей в трекере задач; убедиться, что block-ingest report-пути не вызывает трекер-side-effect (нет ветки `sourceType` для трекера в report-пути — проверить грепом перед merge).

---

## §7. Риски

| # | Риск | Митигация |
|---|---|---|
| Р-1 | `ALTER TYPE ADD VALUE` падает в одной транзакции с другим DDL (часть версий PG) | ДВА файла миграции, `ADD VALUE` изолированно ПЕРЕД `ADD COLUMN` (§2.3, прецеденты daily_checkin/chatbox) |
| Р-2 | `swapDirection` ломает merge транскрипт-vs-транскрипт (горячий путь) | Строгое условие `new=transcript && canonical=report`; блокирующие регресс-тесты Ф4 (а)+(б); grep-факт-чек |
| Р-3 | report-only факт-галлюцинация попал в граф как высоковесный | ГАРД A: cap confidence ≤0.6 + пониженный dynamicScore + `primarySource='report'` → вторичный по весу, ранжируется ниже транскрипта (не «высокий вес») |
| Р-4 | Гонка: report-ingest обогнал транскрипт, оба стали canonical-дублями | При distill транскрипта `judgeMerge` найдёт report-canonical → ГАРД B swapDirection (транскрипт побеждает); порядок enqueue транскрипт→report на проде снижает шанс |
| Р-5 | Регенерация отчёта не обновляет граф (тот же idempotencyKey) | Осознанное ограничение MVP → строка в `04_не-сделано`; reprocess вручную при необходимости |
| Р-6 | Утечка `client_protocol_md` в граф (нарушение D6) | Whitelist внутренних полей + blacklist протокола + unit-тест отсутствия подстроки (Ф2) |
| Р-7 | Высокоуверенный транскрипт просел в низкоуверенном report при swap | confidence нового canonical = `max(...)`, НЕ усреднение (ГАРД B) |
| Р-8 | Future-источник без `primarySource` проскочит авто-canonical | Дефолт `transcript` задокументирован как «опасен для вторичных»; правило в knowledge-core.md |

---

## §8. Prod-операции

**Есть миграция → затрагивается Шаг 4 `prod-deploy-log.md`.**

- **Шаг 4 (схема БД):** новое значение enum `SourceType='meeting_report'` + новая колонка `IdeaBlock.primarySource VARCHAR(16) NULL`. Применяется автоматически `prisma migrate deploy` на каждом `docker compose up -d` (зашит в `apply-prod-deploy.ts --with-schema`, migrate-контейнер). Backfill НЕ нужен (поле nullable, `null`=`transcript`). ДВА файла миграции (порядок: `meeting_report` enum → потом `primarySource` column).
- **Шаг 1 (ENV/флаги):** добавить kill-switch `REPORT_INGEST_ENABLED` (тип «аварийный рубильник», состояние ON) → строка в `docs/operations/feature-flags.md`. AdminSetting `knowledge.reportBlockConfidenceCap` (fallback 0.6) — крутилка, НЕ ENV (правится из админки, не требует prod-команды).
- **Шаг 12 (smoke):** grep нового события `meeting.report-fast-ready` и listener `ReportIngestListener`.
- **Новые seed/patch/backfill/migrate-скрипты:** НЕТ (поле nullable, дефолтов в данных не требуется). Регистрация в `apply-prod-deploy.ts STEPS` не нужна — только schema-миграция.
- **second-brain:** `knowledge-core.md`, `data-model.md` (Шаг 4), `ai-jobs.md`, `workers-queues.md`, `04_не-сделано/README.md`.

**Prod-инструкция-diff для программиста (после выката):** `docker compose up -d --build backend` применит обе миграции автоматически (migrate-контейнер). Дополнительно: добавить `REPORT_INGEST_ENABLED=true` в прод-`.env`; проверить, что AdminSetting `knowledge.reportBlockConfidenceCap` доступна из админки (иначе работает code-fallback 0.6). Полная актуальная инструкция — `docs/operations/prod-deploy-log.md`.

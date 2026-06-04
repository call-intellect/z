# МТЗ №1 — Разблокировка конвейера «встреча → граф → задачи»

> **Тип:** мастер-ТЗ (МТЗ) на фикс блокеров критического пути.
> **Дата:** 2026-06-04 · **Ветка-база:** `dev@1c0214e4` (после git pull).
> **Цель:** чтобы сквозная цепочка **видео-встреча → транскрипт → AI-отчёт → мост в knowledge-core → IdeaBlock + типизированные сущности + граф → проекции → задачи/обещания/цели** реально отработала end-to-end на тестовом тенанте с единицами блоков.
> **Это документ, не код.** К реализации переходить только по явному «начни реализацию / погнали делать Фазу N».
>
> **Источники (аудит, read-only):**
> - Первый прогон — 7 корневых причин + pipelineMap из 15 узлов (`wdaqbq9lk.output`).
> - Большой аудит — 38 подтверждённых багов / 10 областей (`wot5mzbdj.output`).
> - Поправки после git pull учтены (см. ниже).

## Зачем это МТЗ (главный обрыв)

По pipelineMap цепочка как ЗАДУМАНА: `egress_ended → recording_ready → enqueueTranscribe → TranscribeWorker(Vox) → MergeWorker → transcription_ready → AnalyzeWorker (ai_ready) → ШАГ 11 MeetingIngestAdapter.ingestMeeting → IngestService.ingest → RawEvent → BlockIngestWorker → IdeaBlock + Entity (двойная запись Postgres+AGE) + router.dispatch + axis-classify → block-distill → block-linker → projection-rebuild`. На хвосте — задачи/обещания/цели.

Цепочка рвётся в нескольких независимых местах. Критический путь блокируют:
1. **Транскрибация зациклена** (Ф1) — Vox poll 120с потолок, retry-storm с дорожки №1, ничего не доходит до merge → весь верхний тракт мёртв, `ingestMeeting` никогда не вызывается.
2. **specialist-routing теряет ~13/14 блоков** (Ф2) — 14 воркеров на одной очереди, jobName не маршрутизирует.
3. **Специалисты диспатчатся на `draft`, обрабатывают только `canonical`** (Ф3) — первая проекция (Goal/Decision/Insight) не рождается.
4. **projection-rebuilder падает целиком** (Ф4) — `skillTrait.findMany({where:{tenantId}})` роняет `Promise.all` всех 10 проекций.
5. **Граф (AGE) откатывает Postgres-строки** (Ф5) — `cypher()` не резолвится на рантайм-пуле + двойная запись в одной транзакции.
6. **Пороги графа на малом тенанте** (Ф6) — блокируют block-linker / theme / entity-graph, при этом AdminSetting-крутилки мертвы.
7. **Мост `ingestMeeting` молча возвращает `null`** (Ф7) — провал невидим, нет reingest-fallback.
8. **Код ↔ схема** (Ф8) — `dataClassAudit` у Insight/Decision, нужен дешёвый db push + машинный гард класса.
9. **Владелец без Person** (Ф9) — `me/promises` 403, dump legacy, потеря атрибуции.
10. **free_note деградирует** (Ф10) — SegmentBuilder не распознаёт `kind='free_note'`.

## Поправки после git pull (учтены в фазах)

- Merge **не трогал** блокеры критпути (vox/transcribe, specialist-routing, draft→canonical, projection skillTrait, graph/AGE, пороги) — они актуальны.
- **Ф9 (no_person):** merge добавил РУЧНУЮ привязку Person через раздел «Команда» (`persons.service.ts` `linkUserId`), но корневые потребители (commitments 403, dump legacy, `createForOwner` без Person) **не изменены** — автолинковки нет, баг открыт.
- **Ф5 (AGE) корень ГЛУБЖЕ «не установлен»:** рантайм-пул Prisma не делает `LOAD age` / `search_path=ag_catalog` → `cypher()` не резолвится **даже при установленном AGE**. Фикс — `ALTER ROLE app SET search_path=ag_catalog,...` (+опц. квалификация `ag_catalog.cypher` / kill-switch `GRAPH_AGE_ENABLED`).
- **Машинный гард (Ф8):** `tsc` СТРУКТУРНО слеп к лишним ключам вложенного `where`/`data` Prisma (generic `Subset<T,Args>`) — поэтому `skillTrait.tenantId` и `insight.create({dataClassAudit})` проходят typecheck, но падают в рантайме. Эмпирически: свежий `prisma generate` + `tsc --noEmit` = 0 ошибок. «Добавить typecheck» **не помогает** — гард = интеграционные тесты против реального Postgres + конвенция аннотировать литералы `Prisma.XxxWhereInput/CreateInput`.

## Сводка по фазам

| Фаза | Тема | severity | Блокирует | prisma db push | ENV | prod-deploy шаг |
|---|---|---|---|---|---|---|
| Ф1 | Vox/транскрибация (таймаут, per-track идемпотентность) | critical | весь верхний тракт | **да** (@@unique) | да (VOX_POLL_*) | Шаг 1 + Шаг 4 |
| Ф2 | specialist-routing: 14 воркеров на 1 очереди | critical | проекции/задачи | нет | нет | Шаг 12 (smoke) |
| Ф3 | специалисты на draft вместо canonical | critical | первая проекция | нет | нет | Шаг 12 (smoke) |
| Ф4 | projection-rebuilder skillTrait.tenantId | high | все 10 проекций | нет | нет | — |
| Ф5 | AGE/граф: search_path + tx + классификация ошибок | high/critical | граф/группа Б | нет | да (GRAPH_AGE_ENABLED опц.) | **Шаг 5** + Шаг 1 |
| Ф6 | пороги графа на малом тенанте (+мёртвые крутилки) | high | граф/связи | нет | да | Шаг 1 |
| Ф7 | мост ingestMeeting: видимый провал + reingest | high | мост встреча→core | нет | нет | Шаг 12 (Swagger/cron) |
| Ф8 | код↔схема: dataClassAudit + машинный гард класса | medium | observability/enforce | **да** | нет | Шаг 4 |
| Ф9 | владелец без Person (ensurePersonForUser + backfill) | high | me/promises, dump | нет | нет | **Шаг 8** (backfill) |
| Ф10 | free_note SegmentBuilder | medium | канал «мысли» | нет | нет | — |

---

## Ф1 — Vox/транскрибация: разорвать зацикленность ASR `[x]`

**Корень (pipelineMap «TranscribeWorker + VoxService», finding `transcribe-loop`, баг #2):** `transcribe.worker.ts:311` вызывает `this.vox.poll(submitted.taskId)` БЕЗ опций → дефолты `vox.service.ts:20-21` (`DEFAULT_POLL_INTERVAL_MS=2000`, `DEFAULT_POLL_MAX_ATTEMPTS=60`) = жёсткий потолок **120с**. Аудио ~27 мин (durationSeconds=1617) Vox `v3_rnnt` не успевает за 120с, честно держит `PROCESSING` → `vox.service.ts:246-251` throw `VoxError('Vox poll timeout')` → `transcribe.worker.ts:322-324` rethrow, job падает. `TranscriptTrack` создаётся ТОЛЬКО после успешного poll (`transcribe.worker.ts:350-362`), а poll всегда падает → для дорожки №1 строка не пишется никогда. Очередь `ai.transcribe` берёт `DEFAULT_JOB_OPTIONS` attempts=5 (`queues.ts:67-72`) → BullMQ ретраит С НАЧАЛА: `transcribe.worker.ts:174` итерирует `audioTracks` с idx=0 (host), `transcribe.worker.ts:306` делает новый `vox.submit` → новый taskId каждый retry. Идемпотентность `transcribe.worker.ts:139-143` (по `tracks.length>0`) не срабатывает (треков 0). Итог: 5 заходов, 5 taskId, дальше дорожки №1 не уходит.

**Правки:**
- [ ] Поднять бюджет опроса Vox: в `backend/src/modules/ai/workers/transcribe.worker.ts:311` заменить `this.vox.poll(submitted.taskId)` на `this.vox.poll(submitted.taskId, { intervalMs: cfg, maxAttempts: cfg })` с ориентиром **180×5с = 900с** (15 мин, перекрывает 27-мин аудио при RNNT 3-10x realtime).
- [ ] Вынести интервал/попытки в ENV `VOX_POLL_INTERVAL_MS` (default 5000) и `VOX_POLL_MAX_ATTEMPTS` (default 180) в `backend/src/common/config/env.schema.ts`, читать через `TypedConfigService` и пробрасывать в вызов — крутить без деплоя. **Дефолты сервиса `vox.service.ts:20-21` НЕ трогать** (короткие голосовые в conversational/voice адаптерах должны остаться 120с).
- [ ] Сохранять `submitted.taskId` ДО poll (на `AudioTrack`/`Transcript`) и при ретрае джоба для трека с уже известным taskId **не делать новый submit**, а сразу `poll` по старому taskId (`transcribe.worker.ts:306`) — иначе каждый retry плодит дубль-задачу в Vox.
- [ ] Per-track идемпотентность ВНУТРИ попытки: перед `transcribeOneTrack` пропускать трек, для которого уже есть `TranscriptTrack` по `(transcriptId, livekitIdentity)`; заменить `create` на `upsert` (`transcribe.worker.ts:350`). Требует `@@unique([transcriptId, livekitIdentity])` на `TranscriptTrack` — сейчас в `backend/prisma/schema.prisma:1291-1306` есть только `@@index([transcriptId])`. **prisma db push.**
- [ ] НЕ уводить в merge (`transcribe.worker.ts:229` `enqueueMerge`) при неполном наборе дорожек — оставить условие «все треки транскрибированы», но добавить guard: при стабильном Vox `PROCESSING`/таймауте пометить встречу понятной `failureReason` и не зацикливать ретраи с трека №1 (после исправления бюджета это уже не первопричина, но защита от вечного цикла).

**Критерий приёмки Ф1:**
- `grep -n "vox.poll(submitted.taskId" transcribe.worker.ts` показывает вызов С опциями (intervalMs/maxAttempts), не голый.
- В `schema.prisma` у `TranscriptTrack` есть `@@unique([transcriptId, livekitIdentity])`; `bun run prisma:generate` без ошибок.
- Интеграционный/мини-e2e тест: трёхдорожечная встреча с медленным Vox-моком (PROCESSING N итераций, потом COMPLETED) → создаются 3 `TranscriptTrack`, повторный заход джоба НЕ создаёт дублей (upsert) и НЕ делает повторный submit для уже известного taskId; после всех 3 треков — `enqueueMerge` вызван ровно один раз.
- `bun run typecheck` · `bun run build` зелёные.

**Разблокирует:** весь верхний тракт (merge → transcription_ready → analyze → ai_ready → ingestMeeting). Без Ф1 встреча НЕ доходит до knowledge-core.

**prisma db push:** да (`@@unique`). **ENV:** да (`VOX_POLL_*`). **prod-deploy-log:** Шаг 1 (новые ENV) + Шаг 4 (новый `@@unique` — обратносовместим, без data-loss).

---

## Ф2 — specialist-routing: 14 воркеров на одной очереди `[x]`

**Корень (баг #14, critical):** на очереди `core.specialist-routing` создаётся **14 конкурирующих** `new Worker(CORE_QUEUE_NAMES.SPECIALIST_ROUTING, ...)` (`specialist-3-14-goals.worker.ts:60-67`, `specialist-3-1-regulations.worker.ts:67-74`, `process-detector.worker.ts:74-84`, `experiment-detector.worker.ts:68-69`, `sprint-helper.worker.ts:44-45`, +role-map-builder/personal-relation-builder/helpfulness). `enqueueSpecialistRouting` делает `q.add(args.specialistName, payload, {jobId})` (`core-queue.service.ts:443-462`) — jobName=specialistName используется как (несуществующий) ключ маршрутизации. По модели BullMQ **один job → один воркер** (конкурирующие consumer'ы): job достаётся случайному воркеру, а каждый воркер делает `if (job.name !== SPECIALIST_NAME) return;` (`specialist-3-14-goals.worker.ts:91-95`) — **silent return без throw** → job помечается completed → ретрая нет (`queues.ts:192-197` attempts=5/removeOnFail не помогают, т.к. return, а не throw). Итог: ~13/14 блоков попадают «чужому» воркеру и молча теряются. Комментарий `queues.ts:87-94` «Multi-consumer: каждый специалист подписывается на свой jobName» фиксирует ошибочную (нереализуемую в BullMQ) посылку.

**Правки (вариант (а) — диспетчер, меньший diff, переиспользует сервисы):**
- [ ] Заменить 14 Worker-инстансов на **ОДИН** Worker на `core.specialist-routing` с реестром `Map<jobName, handler>` и `switch(job.name)` (документированный BullMQ named-processor паттерн). Специалист-сервисы уже выделены (`Specialist31Service`, `Specialist314GoalsService`, `ProcessExtractionService` и т.д.) — диспетчер по `job.name` синхронно вызывает нужный сервис.
- [ ] Каждый специалист-воркер свести к чистому `Injectable`-handler'у без собственного `new Worker`.
- [ ] **Неизвестный `job.name` → `throw`** (а не silent return) — чтобы попадал в `failed` и был виден; зарегистрированный, но «не-canonical»/«signalType вне области» — это уже логика Ф3/наблюдаемости (см. ниже), не теряем как success молча.
- [ ] Пройти **ВЕСЬ класс** (правило «чини весь КЛАСС, не кейс»): все 14 файлов на этой очереди, включая `role-map-builder`, `personal-relation-builder`, `helpfulness` в других модулях. Зарегистрированы как провайдеры в одном процессе (`ai/workers.module.ts:151-264`) → все поднимают свой Worker на старте.
- [ ] **Машинный гард:** ассерт «на `core.specialist-routing` зарегистрирован ровно ОДИН Worker» (тест или runtime-проверка на старте).

> Альтернатива (б) — отдельная BullMQ-очередь на каждого специалиста (`core.specialist-3-14` и т.д.) + enqueue в конкретную очередь. Чище семантически, но требует правок `enqueueSpecialistRouting`/`queues.ts` и регистрации N очередей. Рекомендуется (а).

**Критерий приёмки Ф2:**
- `grep -rn "new Worker(CORE_QUEUE_NAMES.SPECIALIST_ROUTING" backend/src` → ровно **одно** вхождение (диспетчер).
- Интеграционный тест: на `core.specialist-routing` ставится job c `jobName='specialist-3-14-goals'` для canonical-блока с goal-сигналом → Goal реально создаётся (не теряется); job с неизвестным jobName → попадает в `failed`, а не в `completed`.
- Гард-тест «один Worker на очередь» зелёный.
- `bun run typecheck` · `bun run test:integration` зелёные.

**Разблокирует:** доставку блоков всем специалистам Слоя 3 → проекции (Goal/Decision/Insight/...) и задачи. **prisma db push:** нет. **ENV:** нет. **prod-deploy-log:** Шаг 12 (smoke grep на «один Worker на SPECIALIST_ROUTING»).

---

## Ф3 — специалисты Слоя 3: диспатч на `draft`, обработка `canonical` `[x]`

**Корень (баг #15 + #23, critical):** `block-ingest.worker.ts:750` создаёт IdeaBlock со `status='draft'`, затем `block-ingest.worker.ts:559-573` сразу вызывает `router.dispatch` на этом draft-блоке. `enqueueSpecialistRouting` (`core-queue.service.ts:443-461`) добавляет job **БЕЗ delay**, тогда как `enqueueBlockDistill` (`core-queue.service.ts:145-156`) — с `delay=distillDebounceMs` (`env.schema.ts:495` default 30000мс). То есть специалист стартует ~сразу, а канонизация (`block-distill.worker.ts:164-206` `markCanonical`) только через ~30с. Специалисты делают `if (block.status !== 'canonical') return` (`specialist-3-14-goals.worker.ts:116-122`, `specialist-3-3-decisions.worker.ts:131-137`) — **без throw** → job completed, ретрая нет. `markCanonical`/`mergeInto` (`block-distill.worker.ts:164-206`, ~307-328) **не вызывают** `router.dispatch` (re-dispatch отсутствует). `ProjectionRebuilderService` (`projection-rebuilder.service.ts:183-258`) ищет проекции по `sourceBlockIds has blockId` — пересобирает только **существующие**, новую первую проекцию не создаёт. Combined-путь (`specialists-combined.worker.ts`) под `SPECIALISTS_COMBINED_ENABLED` + `KNOWLEDGE_CORE_V2_AGENTS_ENABLED` (оба default false) — OFF в проде, живёт только сломанный per-block путь.

**Правки:**
- [x] Перенести диспатч специалистов на переход в `canonical`: убрал `this.router.dispatch` из `block-ingest.worker.ts` (RouterService больше не инжектится в ingest) и вызываю `router.dispatch` внутри `markCanonical` (best-effort `.catch`) и внутри `mergeInto` для `canonicalId` (signalType захвачен из `canonical` внутри транзакции → `canonicalSignalType`). RouterService инжектирован в block-distill (доступен из @Global KnowledgeCoreModule). Специалист всегда видит `status='canonical'`.
- [x] `AxisClassifier` оставлен на draft в block-ingest — идемпотентен по `@@unique(tenantId,blockId,axis,label)`; цикл сохранён только под classify.
- [x] НЕ даём специалистам обрабатывать `draft` — диспатч теперь только на canonical; внутренний guard `status!=='canonical'` оставлен как защита.
- [x] **Наблюдаемость (баг #18):** добавлен Counter `core_specialist_skipped_total{specialist,reason}` + метод `incCoreSpecialistSkipped` в `BusinessMetricsService`. Инкрементится на КАЖДОЙ skip-ветке во всех 14 handler'ах (reason: block_not_found / tenant_mismatch / not_canonical / signal_out_of_scope). duration-метрика в `finally` остаётся, skip теперь отличим от success.

> Альтернатива меньшего радиуса: добавить опциональный `delayMs` в `enqueueSpecialistRouting` и диспатчить с `delay>=distillDebounceMs`. Хрупко (distill может задержаться из-за LLM judgeMerge) — предпочтителен перенос на canonical-переход.

**Критерий приёмки Ф3:**
- [x] `grep -n "router.dispatch" block-ingest.worker.ts` → пусто (диспатча из ingest нет); `grep -n "router.dispatch\|this.router" block-distill.worker.ts` → есть в `markCanonical` и `mergeInto`.
- [x] Unit-тест `block-distill.worker.spec.ts`: markCanonical → `router.dispatch({id:block.id, signalType:block.signalType})`; mergeInto → `router.dispatch({id:canonicalId, signalType:канонического})`; dispatch best-effort (бросает → markCanonical/mergeInto не падают). Все зелёные.
- [x] `block-ingest.worker.spec.ts`: конструктор обновлён (RouterService убран, 13 аргументов) — подтверждает, что ingest больше не зависит от router.
- [~] Интеграционный тест против реального Postgres «первая проекция рождается / дубль после merge не создаётся» — НЕ прогнан (Docker недоступен в среде). Логика покрыта unit-тестами; требует прод/CI-прогона.
- [x] `bun run typecheck` · `bun run lint` (0 errors) · `bun run build` зелёные; затронутые vitest-specs (5 файлов, 17 тестов + 30 файлов / 185 тестов по модулям) зелёные.

**Разблокирует:** рождение первой проекции (Goal/Decision/Insight/Idea/задачи) из живого потока встреч. Зависит от Ф2 (доставка до специалиста). **prisma db push:** нет. **ENV:** нет. **prod-deploy-log:** Шаг 12 (smoke).

---

## Ф4 — projection-rebuilder: невалидный `skillTrait.tenantId` `[x]`

**Корень (баг #16/#20/#24/#28/#37, finding `projection-tenantid`, high):** `projection-rebuilder.service.ts:204-210` фильтрует `prisma.skillTrait.findMany({ where: { tenantId: event.tenantId, sourceBlockIds: { has } } })`, но у модели `SkillTrait` (`schema.prisma:7087-7137`) **нет** колонки `tenantId` — только `profileId` (FK на `SkillProfile`), `categoryId`, `conceptId`; тенант на родителе `SkillProfile.tenantId` (`schema.prisma:7058`). Prisma бросает `PrismaClientValidationError`. Запрос — в общем `Promise.all` на 10 проекций (`projection-rebuilder.service.ts:154`); reject одного реджектит **весь** `Promise.all` → внешний catch (`projection-rebuilder.service.ts:282-290`) глушит warn'ом → НИ ОДНА из 10 проекций (decision/insight/idea/card/regulation/process/policy/skill_trait/processTemplate/experiment) не пересобирается. Падение детерминированное на КАЖДОМ `idea_block.updated`.

**Правки:**
- [ ] В `projection-rebuilder.service.ts:204-210` заменить `where:{ tenantId: event.tenantId, sourceBlockIds:{ has } }` на `where:{ profile:{ tenantId: event.tenantId }, sourceBlockIds:{ has: event.blockId } }, select:{ id: true }`. Канонический паттерн уже в кодбейзе: `skill-trait-categories.service.ts:412` и `onboarding.service.ts:467`.
- [ ] Остальные 9 запросов (`decision/insight/idea/card/regulation/process/policy/processTemplate/experiment`) **НЕ трогать** — у них `tenantId` реально есть.
- [ ] Опц. устойчивость: вынести `skillTrait` в отдельный `Promise.allSettled` (или заменить `Promise.all` на `Promise.allSettled` на строке 154), чтобы один битый запрос не ронял остальные 9. (Enqueue на строке 258 уже использует `allSettled` — там менять не нужно.)

**Критерий приёмки Ф4:**
- `grep -n "skillTrait.findMany" projection-rebuilder.service.ts` → `where` через `profile:{ tenantId }`, без прямого `tenantId`.
- Интеграционный тест против реального Postgres: эмит `idea_block.updated` с непустым tenantId → не падает; rebuild-job ставится для существующих проекций (проверяется через Ф8-гард).
- `bun run typecheck` · `bun run build` зелёные (схема не меняется, db push не нужен).

**Разблокирует:** пересборку ВСЕХ 10 проекций при `markCanonical`/`merge_into`/entity-merge (recovery-путь). **prisma db push:** нет. **ENV:** нет. **prod-deploy-log:** —.

---

## Ф5 — AGE/граф: search_path + развязка транзакции + видимость отказа `[x]`

**Корень (finding `cypher-age`, баги #10/#11/#12/#13/#21/#31/#32, high→critical):** графовая запись AGE идёт через **неквалифицированный** `cypher('z_graph', ...)` (`graph.service.ts:551`, `:573`, `:580`; `Z_GRAPH='z_graph'` в `cypher-builder.ts:60`) в рантайм-пуле, у которого **нет `ag_catalog` в `search_path`**. `LOAD 'age'` / `SET search_path=ag_catalog` есть ТОЛЬКО в `postgres-init.sql:16-18`, прогоняемом отдельным короткоживущим `pg.Client` (`apply-postgres-init.ts:32-39`), который закрывается — настройки session-local. Рантайм-пул Prisma (`prisma.service.ts:43` `new PrismaPg({ connectionString: cfg.db.url })`) НИКОГДА не делает `LOAD age`/`SET search_path`; `DATABASE_URL` не содержит `options=-c search_path`. Дефолтный `search_path` = `"$user",public` → `cypher()` не резолвится → Postgres `42883 function cypher does not exist` **даже при установленном AGE** (поправка после pull). Двойная запись усугубляет: `upsertEntity` (`graph.service.ts:497-516`) и `upsertDecision` (`:911-945`) держат Postgres-INSERT и `runCypherMergeNode` в **ОДНОЙ** `prisma.$transaction` → падение `cypher()` откатывает и бизнес-строку (Process/Regulation/Policy/Tool/Metric/Decision). В worker всё проглатывается: `block-ingest.worker.ts:304-306/338-340/.../524-526 → warnTypedFail (:1081-1090)` только `logger.warn`, RawEvent безусловно `processingStatus='ingested'` (`:529-536`) — тихая потеря.

**Правки (а) search_path:**
- [ ] Закрепить `ag_catalog` на уровне роли приложения: добавить в `backend/scripts/postgres-init.sql` (и в bootstrap-шаг прод-деплоя) `ALTER ROLE app SET search_path = ag_catalog, "$user", public;` (`app` — пользователь из `DATABASE_URL`). Любое НОВОЕ соединение пула стартует с `ag_catalog` → `cypher()`/`agtype` резолвятся. Достаточно при `shared_preload_libraries='age'`; если AGE не предзагружен — дополнительно нужен `LOAD 'age'` на каждом соединении (afterConnect-хук драйвера).
- [ ] Проверка установки AGE на проде (Шаг 5 prod-deploy): `SELECT extname FROM pg_extension WHERE extname='age'` и `SELECT name FROM ag_catalog.ag_graph WHERE name='z_graph'`; pre-up smoke `SELECT * FROM cypher('z_graph', $$ RETURN 1 $$) AS (v agtype)` на роли `app`. На managed PG — `shared_preload_libraries='age'` + рестарт.

**Правки (б) развязать транзакцию:**
- [ ] Вынести `runCypherMergeNode` (и MERGE рёбер) из `prisma.$transaction` в `upsertEntity` (`graph.service.ts:497-516`), `upsertDecision` (`:911-945`) и `addEdge` (`:194-266`) — делать best-effort **post-commit** (`this.prisma` вне транзакции, `try/catch+warn`), чтобы отказ AGE НЕ откатывал бизнес-строку/`EntityLink`. Прецедент изоляции — `addNode` (`graph.service.ts:102`), симметрично `persistBlock` (`worker.ts:739`, отдельная tx без AGE). EntityLink в `addEdge` коммитить первым как источник правды.

**Правки (в) классификация ошибок + метрика + не помечать ingested при отказе:**
- [ ] В `warnTypedFail` (`block-ingest.worker.ts:1081`) / каждом catch различать: ожидаемая идемпотентность (Prisma `P2002` при гонке concurrency=2 → skip, норма) vs **системный отказ графа** (ошибка содержит `'cypher'`/`'z_graph'`/`'function cypher ... does not exist'`).
- [ ] Завести локальный `systemFailures` в `process()`; при `reason='age_unavailable'` — перед `update` на `:529` НЕ ставить `'ingested'`, а бросить ошибку (или `'failed'`), чтобы сработал внешний catch (`:591`) и BullMQ retry. Тихая потеря → наблюдаемый failed + авто-ретрай после восстановления AGE.
- [ ] Добавить метрику `kc_typed_entity_failed_total{type,reason}` в `BusinessMetricsService` (рядом с `incExtractionEntity` `business-metrics.service.ts:3736`) и инкрементить во всех catch'ах группы Б (включая decision и decision-fallback). Оставить даже после развязки транзакции — ловит будущие отказы.

**Правки (г) опц. kill-switch:**
- [ ] Ввести `GRAPH_AGE_ENABLED` (env.schema.ts/`TypedConfigService`, **через AdminSetting-крутилку**, см. правило «крутилки в AdminSetting, не ENV/код»): при `false` `runRawCypher`/`runCypherMergeNode` — no-op, Postgres-часть работает. Чинит весь класс (addEdge/upsertEntity/removeNode/removeEdge/addNode) одним рычагом. Флага сейчас в коде НЕТ (grep пуст).

**Критерий приёмки Ф5:**
- На проде `SHOW search_path` под ролью `app` содержит `ag_catalog`; smoke `cypher('z_graph', $$ RETURN 1 $$)` проходит.
- Интеграционный тест: при недоступном AGE (мок/no-op) бизнес-строка группы Б (Process/Decision) **сохраняется** в Postgres (транзакция развязана), а `kc_typed_entity_failed_total` инкрементится; RawEvent при системном отказе НЕ помечается `'ingested'` (попадает в failed → ретрай).
- `grep -n "ag_catalog\|GRAPH_AGE_ENABLED\|systemFailures" backend/src` → правки на месте.
- `bun run typecheck` · `bun run build` · `bun run test:integration` зелёные.

**Разблокирует:** запись типизированных сущностей группы Б и графа AGE; устраняет тихую потерю бизнес-строк. **prisma db push:** нет. **ENV:** да (`GRAPH_AGE_ENABLED` опц. — лучше AdminSetting). **prod-deploy-log:** **Шаг 5** (postgres-init `ALTER ROLE`, проверка AGE/z_graph) + Шаг 1 (если вводится `GRAPH_AGE_ENABLED`).

---

## Ф6 — пороги графа на малом тенанте + мёртвые крутилки `[x]`

**Корень (баги #17/#22/#33/#34/#35/#36, finding `block-linker-threshold`, high):**
- **block-linker:** `block-linker.worker.ts:122-133` skip при `canonicalCount < minBlocks`; `minBlocks=this.cfg.knowledgeCore.linkerMinBlocks` (`:123`), резолвится синхронным `this.get('LINKER_MIN_BLOCKS')` (`typed-config.service.ts:71-73,729`) = статичный ENV. `env.schema.ts:515` default **50**, `.env` нет → эффективный порог 50. AdminSetting `knowledge.linkerMinBlocks` зарегистрирован (`admin-setting-schema-registry.ts:61`) и засеян **3** (`seed-admin-settings.ts:228`), но воркер его НЕ читает через `getDynamic`/`resolveSync` — **крутилка мёртвая**, и дефолты рассинхронизированы (ENV 50 vs seed 3).
- **Корень класса (баг #33):** getter `knowledgeCore` (`typed-config.service.ts:716-757`) читает ВСЕ поля через `this.get(ENV_KEY)` (минует `cacheMap` с admin-оверрайдами). AdminSetting живёт только в `resolveSync(adminKey, envFallbackKey, default)` (`:2199-2227`); `hydrateSync`/`applySync` (`:2273-2291`) пишут только в `cacheMap`, никогда в `this.raw.set` → `this.get` физически не видит admin. Затрагивает `linkerMinBlocks`, `themeClusteringMinBlocks`, `entityGraphMinComentions`, `themeClusterMinSize`, `v2AgentsEnabled`, `linkMinConfidence`.
- **theme-clusterer (#35):** `theme-clusterer.cron.ts:151` `if (candidateCount < minBlocks) return 0` (`THEME_CLUSTERING_MIN_BLOCKS` default **100**, `env.schema.ts:557`); `:180` `minClusterSize` (`THEME_CLUSTER_MIN_SIZE` default 3, `env.schema.ts:562`). Admin-ключи `knowledge.themeCluster*` объявлены (`admin-setting-schema-registry.ts:72-73`), но никем не потребляются.
- **entity-graph-builder (#36):** `entity-graph.service.ts:211` `HAVING COUNT(*) >= $2` (`ENTITY_GRAPH_MIN_COMENTIONS` default **3**, `env.schema.ts:543`) + `entity-graph-builder.cron.ts:102` `if (verdict.confidence < minConfidence) continue` (`LINK_MIN_CONFIDENCE` default **0.75**, `env.schema.ts:510`). Доп. усилитель пустоты: `entity-graph.service.ts:209` `AND blk.status='canonical'` — на свежем тенанте блоки часто ещё не canonical.

**Правки (системный фикс «крутилки в AdminSetting», правило `feedback_admin_settings_not_env_or_code`):**
- [ ] Перевести каждое поле getter `knowledgeCore` (`typed-config.service.ts:716-757`) с `this.get('LINKER_MIN_BLOCKS')` на `this.resolveSync<number>('knowledge.linkerMinBlocks','LINKER_MIN_BLOCKS', 3)` и т.д. (паттерн уже отлажен для emailFetch/argon/retention/embeddings в этом же файле). Аналогично `themeClusteringMinBlocks`, `themeClusterMinSize`, `entityGraphMinComentions`, `linkMinConfidence`, `v2AgentsEnabled`.
- [ ] Понизить ENV-дефолты (совпасть с seed, разблокировать малый тенант): `env.schema.ts` `LINKER_MIN_BLOCKS` 50→**3**, `THEME_CLUSTERING_MIN_BLOCKS` 100→разумный малый (напр. **5**), `THEME_CLUSTER_MIN_SIZE` 3→**2**, `ENTITY_GRAPH_MIN_COMENTIONS` 3→**1**. `LINK_MIN_CONFIDENCE` — **отдельным шагом** (она ОБЩАЯ для block-linker и entity-graph, `typed-config.service.ts:728`; понижение шумит обоим путям).
- [ ] Выровнять дефолты `seed-admin-settings.ts` с `env.schema` (оператор в админке не должен видеть расходящиеся значения).
- [ ] block-linker (`block-linker.worker.ts:123`) и theme/entity cron'ы читают порог через динамический getter (после перевода getter на `resolveSync` правка минимальна).
- [ ] Замечание по `status='canonical'` фильтру (`entity-graph.service.ts:209`): на свежем тенанте сам по себе обнуляет co-mention, пока блоки не canonical — снижение порога не поможет, если блоки ещё не canonical (зависит от Ф3). Учесть при приёмке.

**Критерий приёмки Ф6:**
- `grep -n "resolveSync\|this.get(" typed-config.service.ts` в getter `knowledgeCore` → пороги через `resolveSync`, не `this.get`.
- Тест: правка AdminSetting `knowledge.linkerMinBlocks` через `applySync` → воркер видит новое значение (крутилка живая).
- На тестовом тенанте с ~3 canonical-блоками block-linker НЕ скипает (строит `IdeaBlockLink`); theme/entity-graph пороги настраиваемы.
- `bun run typecheck` зелёный.

**Разблокирует:** наполнение графа связей/тем/сущностей на малом тенанте; делает крутилки реальными. Зависит от Ф3 (canonical). **prisma db push:** нет. **ENV:** да (понижение дефолтов). **prod-deploy-log:** Шаг 1 (дефолты ENV / при желании оперативно — те же значения в AdminSetting).

---

## Ф7 — мост ingestMeeting: видимый провал + reingest-fallback `[x]`

**Корень (баг #1/#8, pipelineMap «МОСТ встреча→второй мозг», high):** `ingestMeeting` — ЕДИНСТВЕННЫЙ вход результата встречи в knowledge-core, вызывается только из `analyze.worker.ts:378` (после ai_ready) и обёрнут в `.catch((err)=>{ logger.warn(...); return null; })` (`:378-388`). Т.к. catch возвращает resolved-`null`, `Promise.allSettled` на индексе 'ingest' НИКОГДА не попадает в `rejected` (`:389-391`) → `meeting.failureReason` не пишется (`:392-415`), статус остаётся `ai_ready` (`:318`). Оператор видит «зелёную» встречу, хотя RawEvent не создан. Все режимы провала реальны (throw до `.catch`): `meeting_no_merged_transcript` (`meeting.adapter.ts:87-95`), `meeting_without_tenant` (`:79-86`), `source_inactive` (`ingest.service.ts:101-106`), `QuotaExceededError` (`ingest.service.ts:163-164`, HTTP 429). Комментарий `analyze.worker.ts:384-386` «consumer в core.raw-events ещё не подписан» неверен — `BlockIngestWorker` создаёт живой Worker в `onModuleInit` (`block-ingest.worker.ts:126-146`).

**Правки:**
- [ ] Сделать провал видимым: убрать молчаливый `return null` из `.catch` (`analyze.worker.ts:378-388`), чтобы reject `ingest` попадал в существующую ветку `failed` и писал `meeting.failureReason='post-analyze enqueue: ingest=...'` (`:389-415`). Поднять лог до `error`, инкрементить бизнес-метрику `ingest_failed{tenantId,reason}` перед re-throw. `failureReason` НЕ меняет общий `status` (остаётся `ai_ready` — саммари доступно), как уже сделано для chapters/tasks (комментарий `:357-358`).
- [ ] Обновить устаревший комментарий `analyze.worker.ts:384-386`.
- [ ] **reingest-fallback (идемпотентный):** добавить `@Cron`/эндпоинт, который для встреч с готовым `Transcript.turns`, но без `RawEvent(meeting)` (sourceExternalId=meetingId) переигрывает `ingestMeeting`. Идемпотентность уже есть на стороне `IngestService` (`idempotencyKey`, `ingest.service.ts:133`). Это закрывает «провал застрял» и даёт ретрай при transient (429/таймауты).
- [ ] (Идеальный, опц.) вынести `ingestMeeting` в отдельный ретраемый BullMQ-job по образцу `enqueueChapters`/`enqueueTasksExtract` — устранит и отсутствие ретрая, и невидимость.

**Критерий приёмки Ф7:**
- `grep -n "ingestMeeting" analyze.worker.ts` → нет `return null` в catch; провал пишет `failureReason` + метрику.
- Тест: `ingestMeeting` бросает `source_inactive` → встреча получает `failureReason` (видна оператору), `ingest_failed` метрика инкрементится.
- Тест reingest-fallback: встреча с `Transcript.turns` без `RawEvent(meeting)` → cron/эндпоинт создаёт RawEvent (идемпотентно, повторный запуск дублей не плодит).
- `bun run typecheck` · `bun run test:integration` зелёные.

**Разблокирует:** видимость обрыва моста + восстановление встреч, не доехавших в граф. **prisma db push:** нет. **ENV:** нет. **prod-deploy-log:** Шаг 12 (новый cron/эндпоинт reingest — smoke/Swagger).

---

## Ф8 — код ↔ схема: `dataClassAudit` + машинный гард класса `[ ]`

**Корень (баги #29/#30, finding `schema-drift`, medium):** поле `dataClassAudit Json?` есть в схеме только у 6 моделей — `AiUsageLog` (`schema.prisma:1398`), `Card` (2121), `ConflictItem` (3420), `ProbeEvent` (5778), `SkillProfile` (7068), `ExecutablePersona` (7386). У `Insight` (model:5544, `@@map("insights")`:5622) и `Decision` (5428, `@@map("decisions")`:5533) поля НЕТ. При этом `specialist-3-5-insights.service.ts:806` делает `insight.create({...,dataClassAudit})`, `specialist-3-3-decisions.service.ts:837` — `decision.create({...,dataClassAudit})`, а `dataclass-audit-snapshot.cron.ts:113-126` raw-SQL читает `FROM insights ... dataClassAudit` / `FROM decisions` → Postgres `42703 column "dataClassAudit" does not exist`. **tsc СТРУКТУРНО слеп** к лишнему `dataClassAudit` в `create({data:...})` (generic `Subset<T,Args>`) — typecheck проходит, рантайм падает. Доп.: cron PROJECTIONS (`dataclass-audit-snapshot.cron.ts:27-41`) перечисляет 13 kind'ов, у 7 нет колонки → `count({where:{dataClassAudit:{not:null}}})` бросает ValidationError, метрика молча skip (`:83-97`).

**Правки (дешёвый db push, корневой фикс класса):**
- [ ] Добавить `dataClassAudit Json?` в модели `Insight` и `Decision` в `backend/prisma/schema.prisma` (консистентно с остальными 6 моделями W4.2) → `bun run prisma:generate` → на проде `docker compose exec backend bunx prisma db push` (nullable, обратносовместимо, без `--accept-data-loss`). Разом чинит cron `42703` и оба `create`.
- [ ] (Альтернатива, если поле не задумано — НЕ выбираем: усложняет cron) убрать `dataClassAudit` из обоих `create` + сократить PROJECTIONS до 6 валидных моделей. **Рекомендуется добавить поле** — дешевле и консистентнее.
- [ ] Починить `snapshotVersionDrift` (`dataclass-audit-snapshot.cron.ts:113-126`): после добавления поля raw-SQL заработает; обернуть в `to_regclass`/try-catch на случай дрейфа (как `patch-backfill-dataclass-audit.ts:96-99`).

**Правки (машинный гард КЛАССА — «добавить typecheck» не ловит):**
- [ ] Интеграционные тесты против **реального** Postgres на критпуть: `ingest → projection` и `insight.create`/`decision.create` (а также `skillTrait.findMany` из Ф4) — именно они ловят лишние/несуществующие ключи Prisma, невидимые для tsc.
- [ ] **Конвенция (документировать в `02_architecture/code-pitfalls.md`):** аннотировать литералы Prisma как `Prisma.XxxWhereInput` / `Prisma.XxxCreateInput` (`const data: Prisma.InsightCreateInput = {...}`) — тогда лишний ключ верхнего уровня ловится tsc (помогает частично; вложенный where/data всё равно требует интеграционного теста).
- [ ] Эмпирическая база: свежий `prisma generate` + `tsc --noEmit` = 0 ошибок на этих кейсах — подтвердить в приёмке, что гард ловит регресс именно тестом, а не typecheck.

**Критерий приёмки Ф8:**
- В `schema.prisma` у `Insight` и `Decision` есть `dataClassAudit Json?`; `bun run prisma:generate` без ошибок.
- Интеграционный тест против Postgres: `insight.create({dataClassAudit})` и `decision.create({dataClassAudit})` проходят; `dataclass-audit-snapshot.cron` не падает на `insights`/`decisions`.
- Гард-тест демонстрирует, что лишний несуществующий ключ в `where`/`data` ловится тестом (а одного tsc — нет).
- `bun run typecheck` · `bun run test:integration` зелёные.

**Разблокирует:** observability dataClass + enforce-режим специалистов 3.3/3.5; вводит гард против класса «код↔схема». **prisma db push:** **да** (`Insight`/`Decision` `dataClassAudit Json?`). **ENV:** нет. **prod-deploy-log:** Шаг 4.

---

## Ф9 — владелец без Person: ensurePersonForUser + backfill `[ ]`

**Корень (баг #7/#26, finding `room-messages-person`, high; учтена поправка после pull):** `Person.userId` линкуется ТОЛЬКО при accept приглашения с `personId` (`org-invitations.service.ts:742-757`). `Person.create` везде ставит `userId:null` (`persons.service.ts:197-200`, `:619-622`). `OrgsService.createForOwner` (`orgs.service.ts:74-117`) создаёт Org + Membership(owner, без personId) + Source + Subscription, но **Person владельца не создаёт**. Следствия: `CommitmentsService.resolveSelfPerson` (`commitments.service.ts:44-62`) бросает `ForbiddenException code='no_person'`, а `MyPromisesController.list` (`my-promises.controller.ts:58-63`) вызывает его безусловно → `GET /me/promises` отдаёт hard-403; `DumpService` уходит в legacy-ветку (`dump.service.ts:80-83 person==null → :114-147`) — без Document и без provenance (`block-ingest.worker.ts:1064-1067,1110` `derived_from` к Document не строится). **Поправка после pull:** merge добавил РУЧНУЮ привязку через раздел «Команда» (`persons.service.ts` `linkUserId`), но `createForOwner`/commitments/dump **не изменены** — автолинковки нет.

**Правки:**
- [ ] Единый хелпер `ensurePersonForUser(tenantId, userId)` в `PersonsService`: найти Person по `(tenantId,userId)`; если нет — слинковать осиротевшую Person из `membership.personId`; иначе создать минимальную Person с `userId` (учесть `Person.email` non-null, fallback `''`, `persons.service.ts:203`).
- [ ] В `OrgsService.createForOwner` (`orgs.service.ts:74-117`) после `membership.create` создавать Person владельца и проставлять `Membership.personId` (подтянуть `name`/`email` из `User` в той же транзакции — `tx.user.findUnique` или расширить сигнатуру; сейчас на входе только `{name, ownerId}`). Идемпотентно (`register` оборачивает в `if(!existingOwned)`; person.create устойчивым к ретраю — findFirst-or-create по `(tenantId,userId)`).
- [ ] `CommitmentsService.resolveSelfPerson` / `MyPromisesController.list`: ленивая привязка через `ensurePersonForUser` ИЛИ graceful — в `list()` ловить `no_person` и возвращать `{items:[]}` (недоступность Person ≠ запрет на просмотр кабинета). `mark()` оставить с 403 (нужен реальный subject).
- [ ] `DumpService` (`dump.service.ts:80-84`): через `ensurePersonForUser` — дамп всегда идёт через Document-путь с `uploaderPersonId`, не legacy.
- [ ] **backfill** для существующих Org: `backend/scripts/backfill-owner-person.ts` — создать Person для owner-Membership без `personId`. Использовать `createPrismaClient()` из `scripts/_lib/prisma.ts` (НЕ голый `new PrismaClient()`), импорты из `../src`. Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` (`STEPS`, `skipBootstrap`).
- [ ] (Класс) тот же `no_person` есть в `daily-checkin.service.ts:56-78` и `ideas.service.ts:191-203` — там 403 уместен (нужен subject), свериться по UX, но не уводить в graceful.

**Критерий приёмки Ф9:**
- Новый owner после `register`/`createForOwner` имеет Person с его `userId` (`grep`/тест).
- `GET /me/promises` для члена Org без линкованной Person → `{items:[]}` (200), не 403.
- Дамп мысли владельца идёт через Document-путь (`uploaderPersonId` проставлен, `derived_from`-ребро строится).
- backfill-скрипт идемпотентен (повторный прогон не плодит дублей), зарегистрирован в `apply-prod-deploy.ts STEPS`.
- `bun run typecheck` · `bun run test:integration` зелёные.

**Разблокирует:** `me/promises`, provenance дампа, атрибуцию встречи к человеку. **prisma db push:** нет (`Participant.userId`/`Person.userId` уже nullable). **ENV:** нет. **prod-deploy-log:** **Шаг 8** (новый `backfill-owner-person.ts` + регистрация в `apply-prod-deploy.ts`).

---

## Ф10 — free_note: SegmentBuilder распознаёт `kind='free_note'` `[x]`

**Корень (баг #4, medium):** payload free_note = `{ kind:'free_note', userId, text, metadata }` (`conversational-ingest.adapter.ts:49-54`) — полей `fullText`/`transcript` нет. `SegmentBuilderService`: `tryAsMeeting` требует `transcript.turns` (`segment-builder.service.ts:89-94`) → null; `tryGetFullText` читает СТРОГО `payload.fullText` (`:81-85`) → null; падает в `buildFallback` (`:78,159-173`), который делает `JSON.stringify(payload)` и кладёт всю обёртку `kind/userId/metadata` в `Segment.text`. Дальше `buildBlockIngestPrompt` (`block-ingest.prompt.ts:542-552`) подставляет `s.text` дословно в LLM → извлечение деградирует на JSON-шуме. Канал «записи мыслей» работает хуже, чем должен.

**Правки:**
- [ ] В `SegmentBuilderService.buildSegments` добавить ветку ПЕРЕД `return buildFallback(payload)`: если `payload.kind === 'free_note'` и `typeof payload.text === 'string' && payload.text.trim()` → вернуть `[{ startMs:0, endMs:0, speakers:[], text: payload.text }]`. Реализовать отдельным приватным `tryGetFreeNoteText` по образцу `tryGetFullText` (`segment-builder.service.ts:81-85`). Альтернатива (та же стоимость): расширить `tryGetFullText`, чтобы при `kind==='free_note'` отдавал `payload.text`.
- [ ] **НЕ менять** payload-форму в `conversational-ingest.adapter.ts` — это сломает дедуп по `payloadChecksum` (идемпотентность существующих RawEvent).
- [ ] Покрыть golden/unit-кейсом free_note.

**Критерий приёмки Ф10:**
- `grep -n "free_note\|tryGetFreeNoteText" segment-builder.service.ts` → ветка распознавания на месте.
- Unit/golden тест: payload `{kind:'free_note', text:'...'}` → `Segment.text` = чистый текст (без `JSON.stringify`-обёртки), `kind/userId/metadata` в текст не попадают.
- Дедуп существующих RawEvent не ломается (payload-форма адаптера не менялась).
- `bun run typecheck` · `bun run test:unit` зелёные.

**Разблокирует:** качество извлечения из канала «записи мыслей» (Telegram/web free_note). **prisma db push:** нет. **ENV:** нет. **prod-deploy-log:** —.

---

## Порядок реализации (что разблокирует что)

1. **Ф1 (Vox/транскрибация)** — критический корень; без него встреча не доходит до core. Разблокирует весь верхний тракт → merge → analyze → ai_ready → `ingestMeeting`.
2. **Ф5 (AGE/граф)** — параллельно Ф1 (инфра-зависимость, prod Шаг 5 + код). Разблокирует запись группы Б и граф; без неё block-ingest молча теряет сущности.
3. **Ф2 (specialist-routing)** — после/параллельно Ф1. Разблокирует доставку блоков специалистам.
4. **Ф3 (draft→canonical)** — **после Ф2** (диспатч имеет смысл, когда доставка работает). Разблокирует первую проекцию.
5. **Ф4 (projection-rebuilder)** — независимая one-line правка; разблокирует пересборку всех 10 проекций (recovery-путь). Можно делать рано.
6. **Ф6 (пороги + крутилки)** — **после Ф3** (нужен canonical для co-mention/связей). Разблокирует граф связей/тем на малом тенанте.
7. **Ф7 (мост ingestMeeting)** — после Ф1 (без транскрипта мост и так не вызывается); делает обрыв видимым + reingest.
8. **Ф9 (владелец без Person)** — независима; чинит me/promises, dump, атрибуцию. Backfill — на проде.
9. **Ф8 (код↔схема + гард)** — независима; дешёвый db push + гард класса. Желательно до прод-выката (enforce-режим).
10. **Ф10 (free_note)** — независима, низкий радиус; качество канала «мысли».

**Минимальный набор для «цепочка ожила end-to-end на тестовом тенанте»:** Ф1 + Ф2 + Ф3 + Ф4 + Ф5 + Ф6 (+ Ф7 для видимости). Ф8/Ф9/Ф10 — параллельно, не блокируют сам конвейер, но закрывают наблюдаемость/атрибуцию/качество.

## Какие фазы требуют prisma db push / ENV / prod-deploy-log

- **prisma db push:** Ф1 (`@@unique([transcriptId, livekitIdentity])` на `TranscriptTrack`), Ф8 (`dataClassAudit Json?` в `Insight`/`Decision`). Оба обратносовместимы, без `--accept-data-loss`.
- **ENV:** Ф1 (`VOX_POLL_INTERVAL_MS`, `VOX_POLL_MAX_ATTEMPTS`), Ф5 (`GRAPH_AGE_ENABLED` опц. — лучше AdminSetting), Ф6 (понижение дефолтов `LINKER_MIN_BLOCKS`/`THEME_CLUSTERING_MIN_BLOCKS`/`THEME_CLUSTER_MIN_SIZE`/`ENTITY_GRAPH_MIN_COMENTIONS`; `LINK_MIN_CONFIDENCE` — отдельным шагом).
- **prod-deploy-log:**
  - Шаг 1 (новые ENV): Ф1, Ф5 (опц.), Ф6.
  - Шаг 4 (схема, db push): Ф1, Ф8.
  - **Шаг 5 (postgres-init/AGE):** Ф5 — `ALTER ROLE app SET search_path=ag_catalog,...`, проверка `pg_extension`/`ag_graph`, smoke `cypher('z_graph', $$ RETURN 1 $$)`.
  - **Шаг 8 (backfill):** Ф9 — `backfill-owner-person.ts` + регистрация в `apply-prod-deploy.ts STEPS`.
  - Шаг 12 (smoke): Ф2 (grep «один Worker на SPECIALIST_ROUTING»), Ф3 (canonical-диспатч), Ф7 (новый cron/эндпоинт reingest).

## Совместимость с prompt caching

**N/A.** Ни одна фаза не редактирует SYSTEM/USER LLM-промпты (`block-ingest.prompt.ts` и др. читаются как есть; Ф10 меняет только сборку `Segment.text` на стороне SegmentBuilder, текст промпта не трогает). Cache-friendly инвариант не затрагивается.

## Итог: не реализовано

Документ-контракт на блокеры критического пути. Код НЕ менялся (read-only аудит + ТЗ). К реализации переходить пофазно по явному «начни реализацию / погнали делать Фазу N»; верификация каждой фазы — по своему «Критерию приёмки» (греп-маркеры + интеграционные тесты против реального Postgres + `bun run typecheck`/`build`/`test:*`), коммит по фазам, push с подтверждением.

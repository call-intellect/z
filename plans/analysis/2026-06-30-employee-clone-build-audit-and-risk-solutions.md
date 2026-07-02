---
type: analysis
status: research-complete
feature: employee-clone-build-audit-and-risk-solutions
date: 2026-06-30
snapshot_date: 2026-06-30
owner: Сергей (владелец продукта Кора)
related:
  - plans/analysis/2026-06-29-extraction-agents-inventory-and-modular-standardization.md
  - plans/analysis/2026-06-29-block-ingest-extractor-design-audit.md
  - plans/analysis/2026-06-30-extraction-best-architecture-FINAL-plain.md
  - second-brain/02_architecture/knowledge-core.md
method: >
  vexp дневной лимит исчерпан → Read + Bash(find/ls) по коду. Два многоагентных
  fan-out (Workflow): (1) 8 ридеров подсистем + критик рисков + синтез; (2) 6 ридеров
  дочтения + 6 проектировщиков решений по кластерам + 6 состязательных скептиков + синтез.
  Все технические утверждения [verified по коду] с file:line; где источник дал
  «не найдено в прочитанном» — помечено.
---

> Вопрос владельца (2026-06-29 → 2026-06-30): «Ещё раз понять, как создаются клоны сотрудников: сколько агентов их собирают, откуда берут вход, от какого агента. У нас есть нарезчик — все агенты берут оттуда, но информация кажется урезанной кусочками и может не показывать всю картину. Какие скиллы делаются, методология. Должна быть привязка: у регламента/инструкции есть название → оно добавляется к сотруднику, кто отвечает / от кого появился → подтягивается как индекс. Дай полный разбор простым языком поэтапно + риски, что инфа не соберётся или соберётся плохо. Потом: дочитай открытое, предложи минимально-рисковые решения по каждому риску и докажи.»

# Сборка клонов сотрудников: полный разбор, риски и доказанные решения

## 0. Главный вывод

Два корня обесценивают клон именно там, где он ценнее всего:

1. **Связка регламент↔роль РАЗОРВАНА.** LLM пишет `scope='role:<ИМЯ>'` (кириллица), а retrieval клона роли матчит exact против `role:<cuid>`. Нормализации имя→`Role.id` нет нигде (write/consolidator/backfill/migration). Итог: **role-scoped регламенты практически не доходят до клона роли** — работает end-to-end только `scope='org'`.
2. **Нарезка молча теряет фрагменты.** При частичном провале LLM-окна (`failedWindows>0` и ≥1 сохранённом блоке) `RawEvent` помечается `ingested`, выпавшие окна не переигрываются (recovery-крон ловит только `received`). Плюс между окнами по 5 сегментов **нет overlap** → разрыв смысла на границе.

Всё остальное — наблюдаемость (тихие фейлы вместо метрик) и крутилки в коде/ENV мимо AdminSetting.

---

## 1. Что такое «клон сотрудника» — ДВА артефакта

Их легко спутать, и часть ожиданий упирается в эту развилку.

- **(1) `knowledgeProfile`** — JSON «кто в чём разбирается» (категории компетенций + опыт), пишется в поле `Person.knowledgeProfile`. Отвечает на вопрос «кто знает X».
- **(2) `ExecutablePersona`** — отдельная таблица с текстовым «persona-prompt» («думай и говори как X / как эта должность»). Версионируемый снимок; отдельной таблицы `Clone` в схеме нет.

**Ключ:** это **два независимых конвейера**. Персона компилируется из `SkillTrait`/`RolePrinciple`/`PracticeSkill` — **НЕ** из `knowledgeProfile` (`executable-persona-build.service.ts:113,175-202`). В ответе клона (`clone-respond`) `knowledgeProfile` подаётся скудно: одна строка «name (confidence)», максимум 8 категорий, без цитат, только для person-scope; для role-scope он жёстко `null` (`clones.service.ts:2360,2399-2413`). Grounding держится на `reasoningBlocks`+`decisions`. **knowledgeProfile — не основной носитель знаний клона.**

---

## 2. Инвентарь агентов

Под «агентом» — отдельный воркер/сервис/cron/промпт, делающий шаг сборки. **Итого ~32 компонента**, из них **13 делают chat-LLM-вызов**.

| # | Имя | Файл | Что делает | Запуск | LLM |
|---|---|---|---|---|---|
| 1 | Specialist32KnowledgeCloneWorker | specialist-3-2-knowledge-clone.worker.ts | фан-аут: на canonical-блок ставит rebuild профиля каждому Person | BullMQ `core.specialist-routing` | нет |
| 2 | SpecialistRoutingDispatcherWorker | specialist-routing-dispatcher.worker.ts | единый consumer routing-очереди | `core.specialist-routing` (conc=4) | нет |
| 3 | KnowledgeCloneRebuildCron | knowledge-clone-rebuild.cron.ts | каждые 6ч ставит rebuild stale-сотрудникам | `@Cron('0 */6 * * *')` | нет |
| 4 | KnowledgeCloneRebuildWorker | knowledge-clone-rebuild.worker.ts | обёртка: зовёт `rebuildForPerson` | `core.knowledge-clone-rebuild` (conc=1) | нет |
| 5 | Specialist32Service.rebuildForPerson | specialist-3-2-knowledge-clone.service.ts | ядро профиля: extract→merge→triage→запись | из #4 | **да: 2** |
| 6 | Specialist32.loadBlocksForPerson | specialist-3-2-knowledge-clone.service.ts | собирает блоки по entityId | из #5 | нет |
| 7 | rebuildCategoryEmbeddings | specialist-3-2-knowledge-clone.service.ts | вектор на категорию для «кто знает X» | из #5 при triage=auto | embedding |
| 8 | RoleClonePersonaVersioningHandler | role-clone-persona-versioning.handler.ts | версионирует персону роли при смене носителя | `@OnEvent('role.bearer_changed')` | нет |
| 9 | ExecutablePersonaBuildService.buildForRole | executable-persona-build.service.ts | persona-prompt клона РОЛИ из черт носителей | событие/cron/on-demand | **да: 1** |
| 10 | ExecutablePersonaBuildService.buildForProfile | executable-persona-build.service.ts | persona-prompt клона ЧЕЛОВЕКА | cron/on-demand | **да: 1** |
| 11 | CoreQueueService.enqueueRebuildKnowledgeProfile | core-queue.service.ts | enqueue с дедупом/дебаунсом 60с | из #1,#3,ручной | нет |
| 12 | Specialist31Service | specialist-3-1-regulations.service.ts | извлекает регламенты/процессы/политики/инструкции, дедуп-арбитр | воркер/консолидатор | **да: 2** |
| 13 | Specialist31RegulationsWorker | specialist-3-1-regulations.worker.ts | грузит блок, отсекает не-canonical, роутит | `core.specialist-routing` | нет |
| 14 | StructuredDocumentCompilerService | structured-document-compiler.service.ts | собирает `contentMd` карточки по шаблону | из #12 | **да: 1** |
| 15 | RegulationConsolidatorCronService | regulation-consolidator.cron.ts | каждые 30 мин ищет дубль-карточки (cos≥0.82) | `@Cron('*/30 * * * *')` | нет |
| 16 | RegulationConsolidatorWorker | regulation-consolidator.worker.ts | consumer консолидатора | `REGULATION_CONSOLIDATOR` (conc=1) | нет |
| 17 | RegulationConsolidatorService | regulation-consolidator.service.ts | сливает дубли, проигравшая → `deprecated` | из #15,#16 | **да** |
| 18 | RouterService | router.service.ts | диспетчер signalType → специалист | апстрим ingest | fallback only |
| 19 | SegmentBuilderService | segment-builder.service.ts | **нарезчик**: RawEvent.payload → Segment[] | синхронно из BlockIngest | нет |
| 20 | ChunkContextService | chunk-context.service.ts | контекстная шапка для эмбеддинга | синхронно из BlockIngest | **да: 1** |
| 21 | BlockExtractionService | block-extraction.service.ts | режет сегменты на окна по 5, извлекает блоки | из BlockIngest | **да** |
| 22 | KnowledgeEmbeddingService (блоки) | embedding.service.ts | эмбеддит блоки с шапкой | из BlockIngest | embedding |
| 23 | ClonesService | clones.service.ts | **движок ОТВЕТА**: персона+субграф+навыки+регламенты | REST `/clones/*/ask` | **да** |
| 24 | KnowledgeCloneService | knowledge-clone.service.ts | чтение профиля наружу, markWrong | REST `/me/knowledge-profile` | нет |
| 25 | Specialist37Service | specialist-3-7-skill.service.ts | детектор SkillTrait из reasoning-блоков | `SKILL_PROFILE_REBUILD` | **да** |
| 26 | PracticeSkillExtractorService | practice-skill-extractor.service.ts | черта-концепт → процедура PracticeSkill | `@OnEvent('skill-trait-concept.normalized')` | **да: 1** |
| 27 | PracticeSkillRetrievalService | practice-skill-retrieval.service.ts | live-подмешивание навыков в ответ (KNN) | из ClonesService | нет |
| 28 | PracticeSkillEvaluatorService | practice-skill-evaluator.service.ts | ночью промоутит shadow→active | `@Cron('0 4 * * *')` | **да** |
| 29 | RoleProfileService | role-profile.service.ts | LLM-«карта должности» (отдельно от клона) | enqueue/cron | **да: 1** |
| 30 | JobDescriptionsService | job-descriptions.service.ts | ручная должностная инструкция (markdown) | REST | нет |
| 31 | SkillsService / SkillTraitCategoryService | skills.service.ts | ручной каталог компетенций (в клон НЕ входит) | REST | нет |
| 32 | RoleRegulationRetrievalService | role-regulation-retrieval.service.ts | KNN/snapshot регламентов роли для клона | из buildForRole/ClonesService | embedding |

LLM-вызовы делают: #5, #9, #10, #12, #14, #17, #20, #21, #23, #25, #26, #28, #29.

---

## 3. Сквозной поток данных

| Шаг | Что | Откуда | Куда |
|---|---|---|---|
| 1. Источник | встреча/документ/чат/отчёт | внешний ingest | `RawEvent.payload` |
| 2. Нарезка | SegmentBuilder режет по спикерам | `RawEvent.payload` | `Segment[]` (в памяти) |
| 3. Извлечение | окна по 5 сегментов, 1 LLM на окно | `Segment[]` | `IdeaBlock` (+embedding, signalType, evidence, entities) |
| 4. Канонизация | блок → `status=canonical` | `IdeaBlock` | тот же блок |
| 5. Роутинг | по `signalType` job специалисту | `IdeaBlock` | `core.specialist-routing` |
| 6a. Регламенты | extract → dedupe → compile | `IdeaBlock`+≤6 цитат | `regulations`/`processes`/`policies`/`instructions` + версия + embedding |
| 6b. Навыки | детект `SkillTrait` → канон концепт | блоки `role=subject` | `skill_traits`, `skill_trait_concepts` |
| 6c. Процедуры | концепт → процедура | `SkillTraitConcept`+reasoning | `practice_skills` (`status=shadow`) |
| 7. Профиль (extract) | блоки сотрудника → LLM | `IdeaBlockEntity`→`IdeaBlock` по entityId | черновик (в памяти) |
| 8. Профиль (merge) | слияние со старым (decay) | старый профиль + черновик | объединённый профиль |
| 9. Триаж/запись | **только при `decision=auto`** | объединённый профиль | `Person.knowledgeProfile` + embeddings категорий |
| 10. Версия персоны | при смене носителя роли | `role.bearer_changed` | `ExecutablePersona` (новая версия) |
| 11. Сборка персоны | черты+принципы+практики → LLM | `SkillTrait`/`RolePrinciple`/`PracticeSkill` | `ExecutablePersona.personaPrompt` |
| 12. Ответ клона | персона + субграф + практики + регламенты | всё выше | ответ → `ChatV2Message`, `CloneQueryLog` |

---

## 4. Нарезчик — режется ли картина «кусочками»

Да, дробится в двух местах.

**Внутри нарезчика (`segment-builder.service.ts`):** сегмент ≤~600 токенов/~2400 символов; overlap-хвост (20%) копируется только внутри реплик одного спикера, между спикерами overlap=0 (`:325-337`); сверхдлинная реплика режется **посимвольно** (`:382-385`); неизвестный payload → `JSON.stringify` шум (`:390-405`). **Основной текст до нарезчика НЕ усекается** ни в одном адаптере (R6).

**Главная потеря — ниже (`block-extraction.service.ts`):** окна по 5 сегментов **без overlap между окнами** (`:407-408`, комментарий `:340` «overlap появится позже»); при провале LLM по окну (2 попытки) — `{blocks:[],failed:true}` (`:518-522`), все 5 сегментов выпадают; `RawEvent`→`ingested` при частичном успехе → переобработки нет (`block-ingest.worker.ts:763-783`; recovery-крон ловит только `received`).

---

## 5. Привязка регламента к сотруднику — ваша модель подтверждается частично

**Совпадает:** название есть (`name`, генерит LLM, `@@unique([tenantId,name])`, `schema.prisma:6208`); ответственный есть (`ownerPersonId` FK→Person, но заполняется наивным substring по имени, `specialist-3-1-regulations.service.ts:1762-1770`); подтягивание-индекс есть, но по полю `scope`+embedding, **не** по `ownerPersonId`.

**Не совпадает:** «от кого появился» (автор/постановщик) как поле НЕ хранится (только `sourceBlockIds[]`, `personSubjectIds[]`); «индекс» (`scope`) и «ответственный» (`ownerPersonId`) — разные поля, retrieval идёт по `scope`; **и сам `scope` разорван** (см. §7 C1-#1).

---

## 6. Навыки / методология

Две сущности: **ручной каталог `Skill`** (`skills.service.ts`) — **в клон НЕ входит**; **реальная методология** — цепочка reasoning→`SkillTrait`(3-7)→`SkillTraitConcept`→`PracticeSkill` (триггер+шаги+красные флаги), плюс `RolePrinciple` (situation→statement, входит в персону напрямую top-5). `PracticeSkill` попадает в клон двумя путями: запекается в персону (top-5 `active`) + live-retrieval по KNN. **`job-descriptions` и `role-profiles` в persona-prompt напрямую НЕ вкладываются** — загруженная вручную должностная инструкция клон не «учит».

---

## 7. Дочтено — ответы на 6 открытых вопросов

- **R1. Кто отвечает в проде:** связка персона (стиль) + граф (фактура: reasoningBlocks/decisions/ретрив). `knowledgeProfile` — скудно, для role-scope `null`. Не основной носитель.
- **R2. Curation-триаж:** профиль пишется только при `decision='auto'` (порог 0.85); human-approve в Person НЕ пишет, listener'а нет. **Риск вечного pending подтверждён** (medium-профиль ≈0.75–0.80 никогда не достигает auto).
- **R3. `role.bearer_changed`:** единственный эмиттер — `AppointmentsService.maybeEmitBearerChanged` (`:373-409`); PersonsService НЕ эмитит. `newPersonId` не гарантирован (снятие без замены = null → роль без active-персоны, rebuild не запускается, `handler.ts:229`).
- **R4. `scope`:** **разрыв подтверждён однозначно** — нормализации имя→`Role.id` нет нигде; работает только `scope='org'`.
- **R5. HNSW:** есть у IdeaBlock/instructions/~20 таблиц; **НЕТ у regulations/policies/processes** (есть колонка embedding, но seq-scan). `role='subject'` по 7 типам/флагу `subjectAttributionAllTypes` (дефолт true), а навыки извлекаются по 4 (`skill-signal-types.ts:3`) — расхождение = канал потери.
- **R6. До нарезчика/ретрай/RolePrinciple:** основной текст не усекается; **тихая частичная потеря окон подтверждена**; `RolePrinciple` — легитимный метод-слой из графа.

---

## 8. Решения по рискам (после состязательной проверки)

⚔️ = скорректировано скептиком; ✅ = подтверждено как есть.

### C1. Привязка регламент ↔ роль/сотрудник/автор
- **HIGH — разрыв `scope` роли.** ⚔️ Резолвер scope на write через **существующий** `EntityResolutionService.resolveRoleByHint` (не самописный findFirst) + backfill `backfill-regulation-scope-normalize.ts` (STEPS phase `backfill`, Шаг 8). Доказательство: резолвер уже даёт normalize→exact→fuzzy→null-при-неоднозначности, id из БД детерминированно. Открыто: `department:<имя>→id` — готового резолвера НЕТ.
- **MED — ownerPersonId substring.** ⚔️ Звать существующий `resolvePersonByHint` (fail-closed); null→метрика `ownerHint_unresolved`.
- **MED — авторство при `startMs=0`.** ⚔️ Узкий фикс multi-segment-single-author (основной кейс уже закрыт ELSE-веткой через actor).
- **MED — Person без `entityId` тихо выпадает.** ⚔️ warn-метрика + lazy-резолв + backfill; **писать ОБА поля композитного FK** (`entityId` И `entityTenantId`).
- **LOW — нет поля «от кого появился».** ✅ Строка в `04_не-сделано`, код не писать (автор вычислим из sourceBlockIds).

### C2. Целостность нарезки и извлечения
- **HIGH — нет overlap между окнами.** ⚔️ Крутилка `knowledge.blockIngestWindowOverlapSegments`=1 + почин orphan-knob; дедуп **синхронно с пересчётом baseOffset** typed-сущностей, ключ устойчив к LLM-дрейфу (evidence-диапазоны+signalType+norm.text, не exact по мс).
- **HIGH — частичный провал окна.** ⚔️ Идемпотентная **полная переигровка**: статус `partial` (+`failedWindowRanges` Json?, миграция Prisma, Шаг 4); recovery-крон на `IN('received','partial')` с уникальным суффиксом jobId; persist = idempotent-upsert по стабильному ключу; maxAge→dead-letter.
- **MED — JSON-шум.** ⚔️ 2-уровневый каскад текстовых ключей + warn + `incCorePartialLoss`; обновить unit-тесты.
- **MED — посимвольная резка.** ⚔️ По границе предложения/слова + **guard прогресса** `cut=max(i+1,foundCut)` (иначе бесконечный цикл при `textBudget=1`).
- **LOW — шапка 300 симв.** ✅ Крутилка `knowledge.contextHeaderMaxChars`=512; backfill эмбеддингов не делать.

### C3. Профиль знаний
- **MED→выше — профиль только при `auto`.** ⚔️ Материализовать на `decision∈{auto,provisional}` + listener `@OnEvent('curation.decision_recorded')` (payload из события, не дочитка CardVersion; гейт `version>=` ИЛИ источник=human, иначе human-approve тихо теряется).
- **MED — срезы к свежему хвосту.** ⚔️ Вынести **весь блок knowledgeClone** в AdminSetting (9 крутилок) + детерминированный orderBy, не точечно.
- **LOW — merge затирает при сбое.** ✅ Возвращать `args.oldProfile` + обязательная метрика `merge_kept_old`; применять не позже C3-#1.

### C4. Навыки и методология
- **HIGH — двойной гейт пуст на ~4 юзерах.** ⚔️ Перенести 8 порогов `practiceSkills.*` в AdminSetting + `evalMinRuns` 30→5 + `evalWindowHours`=720; **48ч хардкод в ДВУХ местах** (`evaluator:36` И `:88`) — оба из крутилки; delta-гейт сохранён.
- **HIGH — навык из 4 типов vs subject по 7.** ✅ AdminSetting `knowledge.skillSubjectSignalTypes` (fallback=7), единый источник для атрибутора и экстрактора.
- **MED — замкнутый круг shadow.** ⚔️ `shadowTrafficShare` 0.1→1.0 + **backfill** существующих shadow (поле материализовано в строке).
- **MED — каталог Skill/JD не питает клон.** ✅ Граница в `04_не-сделано` + UI-дисклеймер (интеграция HR-текста противоречит позиционированию «факт, не декларация»).

### C5. Регламенты: дедуп, полнота, retrieval
- **MED — `evidence.slice(0,6)`.** ⚔️ Крутилка `regulationExtractEvidenceCap`=12 на оба места + **третий хардкод** `process-extraction.service.ts:333` (`slice(0,4)`).
- **MED — dedupe fail-open + окно 7д.** ⚔️ Крутилки `cosineMin`/`lookbackDays`→30 + суточный full-sweep под kill-switch + **алерт** `rate(dedupe_fallback_new)>0`; `getDynamic` async читать ДО SQL; свой лимит для sweep.
- **MED — тихий `[]` + нет HNSW у 3 таблиц.** ⚔️ 3 HNSW `IF NOT EXISTS` (DDL как у instructions, в `DO $$ IF EXISTS table`, Шаг 5) + debug→warn + counter `retrieval_empty{reason}`; fail-к-`[]` сохранить.
- **MED — `process_step` скип.** ✅ Сначала верифицировать полноту PROCESS_DETECTOR + метрика-сверка + инвариант в docs/, поведение не менять (slepой safety-net рискует дублями ProcessTemplate).

### C6. Оркестрация
- **MED — cron хардкод.** ⚔️ **Однострочный фикс:** добавить `{ name: 'knowledge-clone-rebuild' }` в `@Cron` (`:21`). Скептик опроверг предпосылку «крутилка мёртвая»: `seed-admin-settings.ts:2050` уже потребляет ENV, дефект — name-mismatch (override промахивается). НЕ сносить рабочий сид.

---

## 9. Порядок внедрения

**Топ-приоритет: C1-#1 (scope) × C2 (потери в нарезке)** — чинить первыми.

1. **ТЗ-А «Резолв сущностей на write»** (C1-#1,#2,#4) — один `EntityResolutionService`, backfill дёшев на пустом проде.
2. **ТЗ-Б «Целостность нарезки»** (C2-#1+#2) — idempotent-upsert обязан появиться вместе с overlap (один стабильный ключ).
3. **ТЗ-В «Материализация профиля»** (C3-#1+#3, строго в этом порядке) + крутилки knowledgeClone (#2).
4. **ТЗ-Г «Оживление навыков»** (C4-#1+#3) + C4-#2; C4-#4 — doc/UI.
5. **C5** — #3 (HNSW) и #1 (cap) дёшевы; #2 с алертом; #4 верификация.
6. **C6-#1** — однострочно.

### Новые AdminSetting-ключи
`blockIngestWindowOverlapSegments`, починка `blockIngestWindowSegments`, `contextHeaderMaxChars`, весь блок `knowledge.clone*` (cloneLookbackMonths, cloneMentionsTake=200, cloneBlocksTake=60, cloneEvidenceTake=3, rebuildCron, debounceMs, minBlocksForProfile, embeddingFallbackThreshold, minMatchScore), `practiceSkills.*` (8→resolveSync) + `evalWindowHours`=720 + `baselineWindowDays` + `shadowTrafficShare`=1.0, `skillSubjectSignalTypes`=7типов, `regulationExtractEvidenceCap`=12, `regulationConsolidateCosineMin`=0.82, `regulationConsolidateLookbackDays`=30.

### Новые миграции/скрипты (для prod-deploy-log)
- Миграция Prisma: `RawEvent.failedWindowRanges Json?` + статус `partial` → Шаг 4.
- postgres-init.sql: 3 HNSW regulations/policies/processes (DDL как instructions + DO-guard) → **Шаг 5** (не Prisma).
- Backfill (STEPS phase `backfill`, skipBootstrap, `createPrismaClient`): `backfill-regulation-scope-normalize.ts`, `backfill-knowledge-clone-person-entity.ts` (оба поля FK!), `backfill-practice-skill-traffic-share.ts` → Шаг 8.
- Новый full-sweep cron (C5-#2), name для rebuild-cron (C6-#1) → Шаг 12 (smoke).
- Listener `knowledge-clone-decision.listener.ts` (C3-#1) → Шаг 12.
- Алерт-правило `rate(dedupe_fallback_new)>0` (C5-#2).

### Требует решения владельца / не закрыто
1. `department:<имя>→id` — готового резолвера НЕТ (не найдено в коде).
2. Полнота PROCESS_DETECTOR (C5-#4) — инвариант не доказан; сначала метрика-сверка.
3. Каталог Skill/JD не питает клон (C4-#4) — продуктовое ожидание; интеграция против позиционирования.
4. Provenance-автор регламента (C1-#5) — LOW, осознанная отсрочка.
5. Инвариант `entityId` на создании Person — отдельным усиливающим ТЗ.
6. 3 магические const cron (`knowledge-clone-rebuild.cron.ts:11-13`) — строкой в не-сделано.

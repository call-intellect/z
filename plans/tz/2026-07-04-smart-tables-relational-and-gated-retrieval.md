---
title: Умные таблицы — связный слой (строка↔граф) + гейтед релевантное извлечение в чат
date: 2026-07-04
type: tz
status: ready-to-implement
area: smart-tables
owner: sergrv80@gmail.com
branch: work/2026-07-02
source_analysis:
  - plans/analysis/2026-07-04-smart-tables-relational-restore.md
supersedes:
  - plans/tz/2026-07-04-chat-table-context-relevance-selection.md
relates_to:
  - plans/tz/2026-06-21-smart-tables-revive-and-autofill.md
  - second-brain/01_projects/smart-tables.md
owner_decisions:
  - "Автономно (владелец: «ко мне больше не приходишь; находить лучшие решения, доказывать, принимать, идти дальше»). Развилки решены оркестратором и зафиксированы ниже."
  - "Relation/rollup/backlinks/6-view Teamly — ОТДЕЛЬНАЯ волна (в реестр не-сделано с причиной): не двигают recall, максимальная UI-поверхность, research советует не соревноваться в ширине конструктора."
---

# ТЗ: связные умные таблицы + гейтед извлечение (2 слоя, 3 фазы, одна ветка)

## Цель (обе цели владельца — одним корнем)
1. **Связность/идентичность (паритет-дифференциатор):** строка graphSync становится узлом графа — `TableRow.entityId` проставлен (какой клиент/человек), `sourceLink` есть (из какой встречи), ключевые колонки заполнены из графа. Это исходный замысел A5.
2. **Улучшать ответ, не вредить:** таблицы подтягиваются в чат «Мастер» **только релевантно** (gating + дедуп по source-block + малый кап) → recall на структурных вопросах растёт, на остальных не падает.

Оба слоя лечит один рычаг — `entityId` + gating. Схему БД менять НЕ нужно (`TableRow.entityId String?` уже есть и проиндексирован).

## Жёсткие правила проекта
`CLAUDE.md` + `.claude/CLAUDE.md`. Без комментариев в коде. Крутилки — в `AdminSetting` через `getDynamic` (не ENV/код). Ship-On (выкатываем включённым и рабочим; kill-switch допустим). Прода не касаемся кодом (owner-gate на backfill/reconcile). Push — только с явным «да» (кроме рефлексии).

---

## Инварианты и границы (что НЕЛЬЗЯ трогать — блэк-радиус)
- **Граф read-only для таблиц.** Таблицы читают IdeaBlock/Entity/Goal/Experiment/links; НИКОГДА не пишут в граф. (Односторонность закрепить arch-тестом.)
- **`@@unique([tableId, sourceObjectType, sourceObjectId])`** — ключ идемпотентности graphSync. Не менять. `entityId` — атрибут-мост для чтения, **НЕ ключ дедупа**.
- **`entitySync`-путь 4 Entity-таблиц (`TableSyncService`)** — работает; только зеркалить паттерн (`upsertRowForEntity` ставит `entityId`), не переписывать.
- **`allSettled` + fail-safe `catch → []`** в `runTableBranch`/`fetchTableContext` — изоляция ветки сохраняется.
- **Fill-empty** — `fillExisting` не перетирает непустые ячейки; расширяем на `entityId` и на «человеческий провенанс», но не ослабляем.
- **Запрет** одновременного `entitySync` + `graphSync` на одной таблице (валидация при сохранении Table).

---

## Фаза 1 — Гейтед извлечение (data-independent, гасит регресс ПЕРВОЙ) `[ ]`
**Файлы:** `chat-v2-table-context.service.ts`, `chat-v2.service.ts` (knowledge-core), спеки. Данные не трогаем — работает на текущих строках.

### Ф1.1 — Булевый fail-closed gating табличной ветки
- В `runTableBranch` (`chat-v2.service.ts:1737`) — правило запуска ветки (иначе `return []`):
  - **entity-путь** разрешён всегда, когда `entityIds.length > 0` (точный, безопасный);
  - **topic/keyword-путь** разрешён ТОЛЬКО когда `input.queryClass ∈ STRUCTURAL_SET` (`getDynamic('chat_v2.table_structural_query_classes', ['list','overview','temporal'])` — множество, НЕ порог) **ИЛИ** `input.tableAggregation === true`.
  - Иначе (fact/broad/prose без сущности) — ветку не запускаем. Это убирает «ветка бьёт на каждом вопросе» — корень регресса.
- Kill-switch: `getDynamic('chat_v2.table_context_enabled', true)` — рубильник всей ветки (реестр флагов).

### Ф1.2 — Убрать перехват generic-именами колонок + порог + морфология
- `fetchByKeywordTables` (`:121-197`): haystack скоринга строить из `name` + `description` (топиковые), **исключив имена колонок** ИЛИ отфильтровав стоп-набор структурных токенов (`что/срок/статус/описание/дата/владелец/тип/имя/…`) — `getDynamic('chat_v2.table_generic_stopwords', [...])`.
- Порог отбора таблицы: `score ≥ 2` **И** относительный (лучший ≥ 2× второго), иначе — не выбираем (fail-closed).
- Морфология: prefix-stem матч (общий префикс ≥4 символа) → «риски»~«рисков»~«риск», «блокир\*». Калибруется вместе с gating (стемминг не должен уронить precision `decision=none` на fact/empty).

### Ф1.3 — Дедуп по source-block (таблица докрывает пробелы графа, а не дублирует)
- Расширить `TableContextRow` полями `sourceObjectType?: string; sourceObjectId?: string`; `fetchByEntityBridge`/`fetchByKeywordTables` селектят и прокидывают их.
- В `ask()` перед `buildUserMessage` (оба списка известны — `tableRows` `:995`, `contextBlocks` `:1015`): отфильтровать табличные строки, чей `sourceObjectType==='idea_block' && sourceObjectId ∈ blockId(contextBlocks)`. Так строка-дубль факта, который граф уже дал, не идёт в контекст (убирает двойной счёт).
- Метрика: `chat_table_rows_deduped_total` — сколько строк отсеяно как дубли.

### Ф1.4 — Row-level релевантность + малый кап + стабильный порядок
- `fetchByEntityBridge` (`:82`): добавить `orderBy: [{status:'asc'},{updatedAt:'desc'}]` (детерминизм вместо порядка БД).
- Cap-per-(entity,table): `getDynamic('chat_v2.table_context_max_rows_per_entity_table', 3)` — из 10 рисков про клиента идут топ-3 (свежесть+релевантность), не все.
- Row-level релевантность: ранжировать строки по совпадению токенов вопроса с содержимым ячеек (переиспользовать `tokenize`) перед капом.
- Под-бюджет на таблицу: не более `maxRows/2` строк из одной таблицы. Дефолт `chat_v2.table_context_max_rows` понизить с 20 до **8** (kill-switch на разлив).

### Приёмка Ф1 (детерминированная проба A + A/B baseline)
- **Проба A** (`scripts/_probe-table-selection.ts`, без LLM, стабильно): размеченный банк `[{question, expectedTable|null, expectedEntityId|null}]`. Ассерты: (1) precision выбора на forbidden-парах = **1.0** (0 «Обещаний» на риск-вопрос q088/q082/q083/q086/q093b); (2) `decision=none` на всех fact/broad/empty = **100%**; (3) для goals-вопросов выбирается «Цели и метрики».
- **A/B**: recall с таблицами **≥ 23.8%** (снята регрессия) — на структурном подмножестве не ниже baseline-OFF (усреднить ≥2 прогона).
- typecheck+lint+build+`chat-v2-table-context.service.spec` + `chat-v2-table-branch.spec` зелёные.
- **Коммит Ф1** — самостоятельная ценность: «таблицы перестали вредить» даже без слоя данных.

---

## Фаза 2 — Слой данных: `entityId` + reconcile (корень A5) `[ ]`
**Файлы:** `table-graph-sync.service.ts`, `system-tables.catalog.ts`, спеки, backfill/reconcile-скрипты. Ноль миграций БД.

### Ф2.1 — Детерминированный `pickPrimaryEntity`
Чистая функция `pickPrimaryEntity(links: {entityId; role; entity:{type; mentionsCount; mergedIntoId}}[], preferredEntityTypes: string[]): string | null`:
1. Кандидаты = связи, где `entity.mergedIntoId == null` (мёрженные исключить — не привязываться к мёртвой сущности).
2. Сортировать композитным ключом (по убыванию значимости):
   - (a) индекс `entity.type` в `preferredEntityTypes` (меньше = важнее; отсутствующие типы — в конец) — **type ВЫШЕ роли** (чинит «риск про клиента, subject=сотрудник»);
   - (b) ранг роли `subject=0, object=1, mentioned=2`;
   - (c) `entity.mentionsCount` DESC — честный слабый тай-брейк (глобальная популярность, НЕ about-ness);
   - (d) `entity.id` ASC — **обязательный финальный стабильный тай-брейк** (иначе `entityId` прыгает между прогонами reconcile).
3. Пустой `preferredEntityTypes` (не системная таблица) → без (a), начать с роли. `null` — валидный результат (метрика покрытия).

### Ф2.2 — Резолв `entityId` по источнику
- **`idea_block` (risk/idea):** загрузить `IdeaBlockEntity` блока (blockId → entityId, role) + `Entity{type, mentionsCount, mergedIntoId}` → `pickPrimaryEntity(links, table.graphSync.preferredEntityTypes)`.
- **`idea_block` (commitment/promises):** `entityId` = Entity автора (`commitmentAuthorPersonId` детерминирован) ИЛИ, если резолвится, Entity получателя (`commitmentRecipientPersonId` fuzzy) — предпочесть recipient если непуст-и-резолвится, иначе author, иначе `pickPrimaryEntity`.
- **`goal`:** `entityId = Goal.entityId`.
- **`experiment`:** `entityId = Experiment.ownerEntityId` (это Entity.id) иначе первая из `personSubjectIds` → Person.entityId.
- Каталог: добавить в `SystemTableGraphSync` поле `preferredEntityTypes?: string[]` — для `risks/ideas/promises` = `['customer','vendor','person','project','product']` (клиент важнее сотрудника); для `okr/hypotheses` можно опустить.
- `loadLiveObjectsPage` расширить: подгружать связи (join IdeaBlockEntity/commitment*/ownerEntityId), чтобы reconcile имел их без N+1 (батч по страницам).

### Ф2.3 — Проставление `entityId` (create + fillExisting), без клоббера
- В `syncIntoTable`/create: писать `entityId = resolved` (вместо `null`).
- `fillExisting`: если `existing.entityId == null` → проставить resolved; если `!= null` → **никогда не перетирать** (ручной перелинк уважать).
- **entityId — НЕ ключ дедупа.** Дедуп остаётся строго по `(sourceObjectType, sourceObjectId)`. Валидация: запрет `entitySync`+`graphSync` на одной таблице (иначе дубль строки одного клиента).
- Fill-empty ячеек: не заливать ячейку, если у неё есть `TableCellProvenance` с `appliedBy != 'agent'` (человеческое касание) или `rolledBackAt != null` (юзер откатил).
- Метрика `graphsync_rows_without_entity_total{table}` — покрытие резолва.

### Ф2.4 — Reconcile 99 «плоских» строк на «Стреле» (owner-gate)
- `reconcileTenant` идемпотентно добьёт `entityId` существующим строкам (null→value, fill-empty). Проверить, что backfill-скрипт `backfill-table-graphsync.ts` прогоняет reconcile после конфига.

### Приёмка Ф2
- Юнит `pickPrimaryEntity`: type>role; стабильный тай-брейк (два клиента — берётся меньший id детерминированно); мёрженные исключены; commitment author-fallback; goal/experiment резолв; `null` при 0 связях.
- **Под стенд (owner-gate):** reconcile «Стрелы» → доля строк с `entityId≠null` среди резолвимых **≥95%**; fill-empty не перетёр ручное (assert до/после).
- **Проба A**: entity-вопрос («риски по <клиент>») → entity-bridge вернул строки ТОЛЬКО с нужным entityId (0 чужих).
- typecheck+lint+build+`table-graph-sync.service.spec` зелёные.

---

## Фаза 3 — Провенанс + первичная связная ячейка `[ ]`
**Файлы:** `table-graph-sync.service.ts` (provenance sourceLink + одна ячейка), `frontend/src/domain/table.ts:554` (guard), спеки, каталог.

### Ф3.1 — `sourceLink` deep-link на исходную встречу
- Для `idea_block`-источника: взять первичное `IdeaBlockEvidence` блока (rawEventId, startMs, sourceType) → если `RawEvent.sourceType='meeting'` → `buildProvenanceDeepLink({sourceType:'meeting', externalId, startMs})` (из `provenance.service.ts:154`); иначе `sourceLink = null` (не фейкать).
- `writeProvenance`: писать `sourceLink` (сейчас `:424` `null`) + человекочитаемый `sourceLabel` (встреча + время).
- Рендер: `chat-v2-table-context.service.ts renderCells` добавить «Источник=<label>» (Markdown-KV с реальной ссылкой), чтобы «Мастер» цитировал.

### Ф3.2 — Одна первичная связная ячейка (даровая из резолва entityId)
- Раз `pickPrimaryEntity`/commitment уже дал Person/Entity — заполнить ОДНУ профильную колонку:
  - promises → «Кому» (recipient) при `Person.userId != null` как `{id:userId,name}`; иначе — тип `entityLink` `{id:entityId,name}` если колонка есть, иначе `{id:null,name}`;
  - risks/ideas → «Владелец»/«Ответственный» аналогично (только если резолвится person с userId; внешние — entityLink/{id:null,name});
  - goal → «Ответственный» из `Goal.ownerPerson`.
- **`Person.id` в person-ячейку НИКОГДА** (dangling User). Правило `resolvePersonCell`: userId→{id:userId,name}; иначе не в person-колонку.
- Frontend `table.ts:554` person-рендер: guard `if (value.id == null) → показать value.name как текст` (не строить висячий линк).
- **Мульти-person богатство (все колонки сразу) — OUT** (реестр не-сделано).

### Приёмка Ф3
- Юнит: sourceLink строится при meeting-evidence, `null` иначе; person-ячейка только при userId; entityLink/{id:null,name} для внешних.
- Frontend `apply* / person-render` спек: `{id:null,name}` рендерится текстом без краша.
- **Под стенд:** в ответе «Мастера» на риск-вопрос присутствует «Источник» со ссылкой; recall не упал.
- typecheck+lint+build+frontend test:unit зелёные.

---

## Замер и приёмка всего релиза (двухслойный, без переобучения)
- **Проба A (детерминированная, CI hard-gate):** `scripts/_probe-table-selection.ts` — precision forbidden = 1.0; `decision=none` на fact/broad/empty = 100%; entity-bridge 0 чужих entityId.
- **Проба B (A/B recall, ≥3 прогона, `scripts/_measure-gold.ts` / `_measure-tables-recall.ts`):**
  - шумовая σ по baseline-OFF (×3); лифт засчитывается только `> 2σ`;
  - попарные флипы: положительных (FAIL→CORRECT) на {risks,goals,blockers,composite,multistep} **>** отрицательных, sign-тест значим;
  - **anti-regression гейт (жёсткий):** на {fact,expertise,broad,decision,meetings,synonym} `CORRECT→FAIL ≤ 0` сверх шума — иначе НЕ выкатываем, даже при большом структурном лифте;
  - **honest_empty halluc = 0** (gating не подаёт чужую таблицу на пустой вопрос).
- **Pre-registration:** правило gating (Ф1.1) и пороги — зафиксированы В ЭТОМ ТЗ до прогона per-question. Запрет подгонки под 21 вопрос. Желательно кросс-тенант (Стрела + второй).
- **Включаем инъекцию по таблице/интенту только там, где лифт подтверждён** (Ship-On, но метрикой, а не «залить всё»).

## Прод-гейт (важно)
- Наполнение/reconcile активирует табличную ветку. **Ф1 (gating) выкатывается ПЕРВОЙ** — она делает ветку безопасной. Только после зелёной Ф1 снимать прод-гейт на `backfill-table-graphsync.ts`.
- Все прод-команды — через `docker compose exec backend ...` (см. `docs/operations/prod-deploy-log.md`). Новых миграций нет; новые крутилки — в сид AdminSettings (Шаг 7).

## Что явно OUT (в реестр не-сделано с причиной)
- **relation / rollup / backlinks** — конструктор БД, ручной у всех конкурентов, 0 вклада в recall, максимальная UI-поверхность. Отдельная волна.
- **6-view Teamly (Канбан/Календарь/Гант/Формы/Диаграммы)** — не влияет на ответ.
- **Мульти-person богатство** (все person-колонки сразу) — стоимость запросов >> эффект; вернуться, когда одна ячейка докажет ценность.
- **Векторный подбор таблицы** (сверх token-overlap+морфология) — только если Ф1 не добьёт метрику.
- **Любая запись в граф из таблиц** — запрещено (arch-тест-страж).

## Порядок и итог
**Ф1 (gating, гасит регресс) → Ф2 (entityId, связность/A5) → Ф3 (провенанс+ячейка).** Одна ветка `work/2026-07-02`, 3 коммита, push один раз в конце по «да» владельца (кроме рефлексии). Каждая фаза сама зелёная и сама поднимает метрику.

**Реализовано:** — (старт). **Осталось:** Ф1, Ф2, Ф3.

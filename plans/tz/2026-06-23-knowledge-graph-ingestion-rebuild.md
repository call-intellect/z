---
type: tz
status: ready-to-implement
feature: knowledge-graph-ingestion-rebuild
date: 2026-06-23
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/99-synthesis.md
  - plans/tz/2026-05-29-agents-v2-umbrella.md
  - plans/tz/2026-06-11-report-to-graph-phase2.md
  - second-brain/02_architecture/knowledge-core.md
---
> Анализ: `plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/` (research-complete) · Статус согласования: 2026-06-23 — владелец принял гибрид рёбер + эпизодический временной граф (инкрементальный, не GraphRAG-батч).

# Перестройка графа знаний Коры — гибридная модель рёбер + эпизод-узел + достройка проводки

## Цель
Сделать так, чтобы единая память компании (граф) **отвечала на «какая суть встречи X» связной сутью с кликабельным источником**, склеивала **одного человека между источниками** (встреча/Битрикс/чатбокс), и **использовала связи графа в основном поиске** — на годы вперёд, инкрементально по событию.

## Зачем (болезненное состояние, доказано на проде 2026-06-23)
- Запрос «суть встречи Насти и Айназ» → движок памяти дважды сгенерировал честный ответ и **выбросил**: нет узла «суть встречи», факты атомизированы и не сгруппированы по встрече (диалог-разбор, `plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/`).
- «Настя» (имя в тексте) ≠ аккаунт `chydo_002` — отчёт встречи сам пишет «спикер не идентифицирован».
- Факты из отчёта `sourceMeetingId=null` ([block-ingest.worker.ts:494](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L494)) — «висят» без источника.
- Граф спроектирован, но **рёбра в базовый поиск не проведены** (`search.service.ts` плоский) и **часть за OFF-флагами** (нарушает Ship-On).
Доказательство выбора (граф-ядро vs плоский RAG; гибрид рёбер vs LLM-всё) — в анализе §6 + per-source `07-redteam.md`. Не пересматривать.

---

## REALITY-CHECK (факт по коду на 2026-06-23)

| # | Что проверено | Факт по `schema.prisma` / коду | Следствие для scope |
|---|---|---|---|
| RC-1 | Bi-temporal блоков | `IdeaBlock.validFrom/validUntil/recordedAt/supersededAt/supersededById` УЖЕ есть (KC-Temporal W1.1), заполняются **при `BITEMPORAL_ENABLED=true`** ([schema.prisma:3429-3443](../../backend/prisma/schema.prisma#L3429)) | Не вводить заново. **Включить флаг** (Ф9, Ship-On). |
| RC-2 | Bi-temporal рёбер | `IdeaBlockLink.validFrom/validUntil` + `EntityLink.validUntil/recordedAt` УЖЕ есть, за `BI_TEMPORAL_EDGES_ENABLED` ([schema.prisma:4146-4167](../../backend/prisma/schema.prisma#L4146)) | Не вводить. Включить флаг (Ф9). |
| RC-3 | Типы смысловых рёбер | `IdeaBlockLinkType` = develops/contradicts/causes/consequences_of/shares_topic/shares_entity/question_answered_by/resolves/**supersedes** ([schema.prisma:700-714](../../backend/prisma/schema.prisma#L700)) | Enum достаточен. Новые типы НЕ вводим. |
| RC-4 | Построение рёбр факт↔факт | `block-linker.worker` = вектор-KNN кандидаты → **LLM-судья на каждого** (`IdeaBlockLink.createdBy=linker`), запуск **по гейту** (накопление canonical); `contradicts`≥0.85 → ConflictService | Уже половина гибрида. **Развести структурные (без LLM) vs смысловые (LLM)**; убрать гейт-лаг; добавить тираж-по-риску + композитный судья (Ф6). |
| RC-5 | Узел эпизода | `RawEvent` есть (sourceType/occurredAt/payload), но **нет `sourceTitle`**; «суть встречи» лежит на `aiResult.summaryFast`, в граф попадает атомизированной и `confidence≤0.6` (report.adapter) | Добавить `sourceTitle` + **retrievable summary-блок встречи** (Ф1, Ф4). |
| RC-6 | Провенанс | `IdeaBlockEvidence(blockId,rawEventId,quote,startMs)` есть и богаче Graphiti; НО отчёт-блоки `sourceMeetingId=null`, не всегда имеют evidence | Инвариант «блок без evidence запрещён» + отчёт как свой `RawEvent` (Ф2). |
| RC-7 | Идентичность | `Entity` несёт `aliases[]/mergedIntoId/embedding(1536)/strong-IDs`; `resolveSubjectPersonId` детерминир. резолвит АВТОРА; имя-упоминание — fuzzy-LLM **без alias-cache** | Добавить per-Org alias-cache + эмбеддинг-склейку имён (Ф5). |
| RC-8 | Темы | `Theme`-кластеры есть (theme-clusterer.cron, KNN+LLM-нейминг), но **нет поля `summary`/report**; пересчёт не инкрементальный по member-резюме | Добавить `Theme.summary` + инкрементальное резюме (Ф8). |
| RC-9 | Поиск | `search.service.ts` = плоский гибрид cosine+BM25 одним SQL, **без обхода рёбер и без rerank**; обход на 1-hop только в `chat-v2-retrieval.service.ts` | Провести рёбра + RRF-rerank + группировку в основной retrieval (Ф7). |
| RC-10 | AGE | `EntityLink` дублируется в AGE `z_graph` через `GraphService` за `graph.ageEnabled` | AGE на старте НЕ обязателен (рёбра в таблицах); не трогаем включение. |
| RC-11 | Контекст чанка | `block-ingest.prompt.ts` подаёт только опц. `meetingTitle`; **дата НЕ передаётся** (но промпт `:356` просит считать сроки «от даты разговора» — баг); нет участников; нет overlap; окно `BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT=2000` | Контекст-заголовок + дата + overlap + меньше окно (Ф3). |

**Вывод REALITY-CHECK:** граф готов на ~75%. ТЗ — про **достройку проводки и включение**, не про стройку с нуля. Scope пересчитан под остаток.

---

## Принятые решения владельца (2026-06-23 — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Ядро — **эпизодический временной граф** (инкрементально по событию, модель Graphiti/Zep), НЕ GraphRAG-батч | Поток встреч/чатов — батч-пересборка дорога и не нужна; анализ `03/07`. Граф кормит клонов/дашборд/чат — это продукт, не опция. |
| Р2 | Рёбра — **гибрид**: структурные детерминированно (без LLM), смысловые — вектор-KNN→LLM на спорное; тираж по риску | Дёшево + предсказуемо; модель Graphiti (RC-4). Анализ §6. |
| Р3 | `contradicts/supersedes/causes` — **высокий порог + композитный судья + bi-temporal-обратимость** | Эти рёбра прячут версии и учат клонов — цена ошибки высокая (анализ `07`). |
| Р4 | Всё **автоматически**, человек только kill-switch (не «одобри каждое ребро») | Самообучение клонов без human-gate [[feedback_no_human_in_loop_for_clone_learning]]. |
| Р5 | Стек: Postgres+pgvector сейчас; **AGE НЕ на старте**; embeddings `text-embedding-3-small` (1536); late chunking НЕ берём; Python-методы → порт в TS | §7 CLAUDE.md; анализ `02/06`. |
| Р6 | Единый `RawEvent` для встреч+Битрикс+чатбокс + `sourceTitle` | Один контракт эпизода (анализ `04`); дёшево заложить, дорого ретрофитить. |
| Р7 | alias-cache идентичности — **с самого начала** | Закрывает главный кейс «Настя↔chydo_002» дёшево (анализ `04`, LINK-KG −45%). |

---

## Scope

**Входит:** Ф1 (эпизод-узел+sourceTitle), Ф2 (провенанс-инвариант), Ф3 (контекст чанка+фикс извлечения), Ф4 (retrievable суть встречи), Ф5 (alias-cache идентичности), Ф6 (гибрид рёбер), Ф7 (поиск с обходом рёбер), Ф8 (Theme.summary инкрементально), Ф9 (включение Ship-On флагов + крутилки в AdminSetting), Ф10 (живой re-test).

**Не входит:** AGE/Cypher-обход как основной путь (рёбра в таблицах; AGE — vNext при доказанной нужде глубокого обхода); смена эмбеддера/late chunking; community-summaries в стиле GraphRAG-global (только инкрементальные Theme.summary); UI базы знаний (отдельное ТЗ при запросе); реализация Битрикс-адаптера (здесь — только готовность схемы `RawEvent` принять `sourceType` Битрикса; сам коннектор — vNext-ТЗ).

**Граничные контракты с другими ТЗ:** bi-temporal-поля и флаги — из `plans/tz/2026-05-29-agents-v2-umbrella.md` (§A1) и KC-Temporal W1.1 (НЕ переопределять, только включить); отчёт→граф — поверх `plans/tz/2026-06-11-report-to-graph-phase2.md` (расширяем, не дублируем).

---

## Требования (EARS, трассируемые)

- **R1.** Когда обрабатывается событие (встреча/отчёт/чат), система shall иметь `RawEvent.sourceTitle` (человекочитаемый заголовок эпизода), непустой для встреч/отчётов.
- **R2.** Если создаётся `IdeaBlock`, то система shall гарантировать ≥1 `IdeaBlockEvidence` с непустым `rawEventId` (инвариант, machine-guard на persist); блок без evidence не записывается.
- **R3.** Когда обрабатывается отчёт встречи, система shall создавать его как `RawEvent(sourceType='report')` со своим `rawEventId`, и блоки отчёта shall ссылаться на него (никаких `sourceMeetingId=null` у новых блоков).
- **R4.** Когда строится сегмент для извлечения, система shall передавать в промпт **дату встречи**, заголовок, тип встречи и участников; и shall клеить к тексту чанка сгенерированный контекст-заголовок ПЕРЕД эмбеддингом.
- **R5.** Когда нарезается транскрипт, система shall использовать overlap (крутилка, дефолт ~20%) и размер под-чанка (крутилка, дефолт 400–800 токенов) из AdminSetting.
- **R6.** Когда у встречи готова «суть» (summary), система shall хранить её как **retrievable** узел/блок, привязанный к эпизоду, не придушённый confidence-cap.
- **R7.** Если один человек упомянут в разных источниках (имя в тексте vs аккаунт), система shall склеивать его в одну `Person`/`Entity` каскадом (сильный ID → эмбеддинг имени → LLM-арбитр) + per-Org alias-cache.
- **R8.** Когда строятся рёбра факт↔факт: структурные (shares_entity/shares_topic по совпадению сущности; supersedes/temporal по времени) shall создаваться ДЕТЕРМИНИРОВАННО без LLM; смысловые (develops/contradicts/causes/consequences_of) shall создаваться через вектор-KNN-кандидаты → LLM-судья.
- **R9.** Если ребро `contradicts/supersedes/causes`, то система shall применять высокий порог уверенности (крутилка) + композитный судья (≥2 независимых проверки) + записывать bi-temporal-интервал (откат без удаления факта).
- **R10.** Когда выполняется основной поиск по памяти, система shall: (а) гибридный вход (HNSW + BM25 + RRF-rerank); (б) обход рёбер от точек входа (к эпизоду, к связанным фактам/сущности, к последней актуальной версии по bi-temporal); (в) сборку с группировкой по эпизоду/сущности.
- **R11.** Когда создаётся/обновляется `Theme`, система shall поддерживать `Theme.summary`, обновляемое инкрементально (без полного rebuild на каждый insert).
- **R12.** Bi-temporal флаги (`BITEMPORAL_ENABLED`, `BI_TEMPORAL_EDGES_ENABLED`) shall быть включены (Ship-On); пороги/размеры/topK shall жить в AdminSetting (не ENV/код).
- **R13.** Когда извлекается многосторонний факт (обещание/решение/договорённость с >1 участником), система shall сохранять ВСЕХ участников + их роли (автор→адресат / ответственный) + срок, и shall НЕ схлопывать факт до одного исполнителя. (Эмпирическое доказательство анти-паттерна — `08-hyperextract-test.md`: гиперребро Hyper-Extract на RU-созвоне потеряло автора «Настя» и срок «25 июня», оставив `participants: [Сергей]`; наш `IdeaBlock` с `commitmentAuthorPersonId`/`commitmentRecipientPersonId`/`commitmentDueDate` этого не допускает.)

---

## Фазы

Граф зависимостей:
```
Ф1(schema:sourceTitle,episode summary) ─┬─► Ф2(провенанс-инвариант) ─┐
                                        ├─► Ф4(retrievable суть)    ─┤
Ф3(контекст чанка+фикс извлечения) ─────┘                            ├─► Ф7(поиск:обход рёбер) ─► Ф10
Ф5(alias-cache идентичность) ───────────────────────────────────────┤
Ф6(гибрид рёбер) ───────────────────────────────────────────────────┘
Ф8(Theme.summary) ─► Ф7
Ф9(включить флаги + крутилки) ─► после Ф1–Ф8 корректны ─► Ф10
```
Параллельны: Ф3, Ф5 независимы между собой и от Ф1. Ф2/Ф4 после Ф1. Ф6 независима (рёбра), но Ф7 ждёт Ф4+Ф6+Ф8. Ф9 — предпоследняя. Ф10 — последняя (живой re-test).

---

### Ф1 — Узел эпизода: `RawEvent.sourceTitle` + модель/поле «суть встречи» `[x]`
**Цель:** дать эпизоду заголовок и место под retrievable-суть.
**Картография:** `RawEvent` [schema.prisma:3326](../../backend/prisma/schema.prisma#L3326) (якорь `model RawEvent`); адаптеры [meeting.adapter.ts:88](../../backend/src/modules/ingest/adapters/meeting.adapter.ts#L88) (payload), [report.adapter.ts:74](../../backend/src/modules/ingest/adapters/report.adapter.ts#L74).
**Что входит:**
1. Миграция: `RawEvent.sourceTitle String?` (+ `@@index` не нужен). Контракт:
```prisma
  /// Человекочитаемый заголовок эпизода (≈ Graphiti source_description):
  /// «Встреча: планёрка маркетинга, 14.06» / «Чат с клиентом Александром».
  /// Непустой для meeting/report; для чатов — резюме треда.
  sourceTitle      String?
```
2. Заполнение `sourceTitle` в `meeting.adapter`/`report.adapter` (из `meeting.title`+тип+дата).
3. Решение по «сути встречи»: переиспользовать `aiResult.summaryFast` как retrievable-блок (Ф4), **без новой тяжёлой модели** — `[ASSUMPTION: отдельная модель Episode не нужна — RawEvent уже эпизод; «суть» = выделенный IdeaBlock, см. Ф4]`.
**Что НЕ входит:** генерация summary (есть), retrievable-логика (Ф4).
**Файлы:** `schema.prisma`, `prisma/migrations/*`, `meeting.adapter.ts`, `report.adapter.ts`.
**Acceptance:** миграция `ALTER TABLE "RawEvent" ADD COLUMN "sourceTitle"`, без DROP; `bun run prisma:migrate -- --name add_rawevent_source_title` + `prisma:generate` + `typecheck` зелёные; греп `sourceTitle` в обоих адаптерах; повторный `migrate deploy` — no-op.
**Закрывает:** R1.
**Prod:** новая колонка → `prod-deploy-log.md` Шаг 4.

---

### Ф2 — Провенанс-инвариант: блок без evidence запрещён + отчёт как RawEvent `[x]`
**Цель:** убить `sourceMeetingId=null`; каждый факт кликабелен к источнику.
**Картография:** [block-ingest.worker.ts:494,548](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L494) (якорь `sourceMeetingId: event.sourceType === 'meeting'`); `IdeaBlockEvidence` [schema.prisma:3531](../../backend/prisma/schema.prisma#L3531); report-путь [report.adapter.ts:74](../../backend/src/modules/ingest/adapters/report.adapter.ts#L74) (уже создаёт `RawEvent` `sourceExternalId=report_<id>` — проверить, что блоки получают `IdeaBlockEvidence.rawEventId`).
**Что входит:**
1. Machine-guard в persist блоков: если у блока нет ни одного `IdeaBlockEvidence` с непустым `rawEventId` — блок НЕ пишется, лог WARN + метрика `incBlockWithoutEvidence`.
2. Для отчёта: блоки ссылаются на `RawEvent(sourceType='report')` (а не на встречу-родитель) — `sourceMeetingId` для них остаётся null **легитимно**, но evidence.rawEventId непустой → клик ведёт в эпизод-отчёт. Deep-link резолвит отчёт→встречу через `RawEvent.sourceExternalId`.
**Что НЕ входит:** изменение UI цитат; backfill старых null-блоков (вынести: `[ASSUMPTION: исторические блоки не бэкфиллим; гард только для новых]`).
**Файлы:** `block-ingest.worker.ts`, `block-extraction.service.ts`, профильный `*.spec.ts`.
**Acceptance:** unit: блок без evidence → не записан (предикат `prisma.ideaBlock.create` не вызван, метрика инкрементнута); блок с evidence → записан. Греп-маркер guard-функции. `bunx vitest run` затронутого spec + `typecheck` зелёные.
**Закрывает:** R2, R3.

---

### Ф3 — Контекст чанка (Contextual Retrieval) + фикс извлечения `[x]`
**Цель:** чанк перестаёт «висеть»; чинит баг даты, overlap, размер.
**Картография:** [segment-builder.service.ts:255-360](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L255) (якорь `buildFromMeeting`, `maxTokens`), [block-ingest.prompt.ts:356,442-455](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L356) (якорь `buildBlockIngestPrompt`, `meetingTitle`), [block-extraction.service.ts:404-461](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L404) (окно, `processWindow`).
**Что входит:**
1. **Передать в `buildBlockIngestPrompt`**: дату встречи (`occurredAt`), тип встречи, список участников/ролей — в шапку user-сообщения (закрывает баг `:356`).
2. **Контекст-заголовок к чанку перед эмбеддингом**: дешёвой моделью (`deepseek-v4-flash`) сгенерировать 1-2 предложения «Встреча X, тип Y, говорит Z, тема W» и склеить в начало текста, который идёт в `embedQuery`/индекс. Кэш-френдли (стабильный SYSTEM). Крутилка-рубильник `knowledge.contextual_header_enabled` (kill-switch, дефолт ON).
3. **Нарезка**: overlap из `knowledge.segment_overlap_ratio` (дефолт 0.2) + размер под-чанка `knowledge.segment_max_tokens` (дефолт 600, диапазон 400–800) — заменяет хардкод 2000 (но потолок окна `BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT` оставить как верхнюю границу).
4. **Инвариант многостороннего факта (R13):** для обещаний/решений/договорённостей с >1 участником извлечение обязано сохранять ВСЕХ участников + роли (автор→адресат / ответственный) + срок — не схлопывать до одного исполнителя. Промпт `block-ingest.prompt.ts` уже имеет `commitmentRecipientNameGuess`/`commitmentAuthorPersonId`/`commitmentDueDateGuess`; проверить и усилить, что они заполняются для ВСЕХ многосторонних фактов (не только классических `commitment`), а не теряются. Anti-pattern-репер — `plans/analysis/.../08-hyperextract-test.md`.
**Что НЕ входит:** semantic chunking (анализ `02` — не доказан); смена эмбеддера; гиперграф-движок (тест `08` — плоское гиперребро беднее нашего реифицированного факта).
**Совместимость с prompt caching:** контекст-генератор — стабильный SYSTEM, переменные (чанк+документ-хвост) в конце user.
**Файлы:** `segment-builder.service.ts`, `block-ingest.prompt.ts`, `block-extraction.service.ts`, новый контекст-генератор (сервис), `admin-setting-schema-registry.ts` + сид + UI-поле.
**Acceptance:** unit: промпт содержит дату/тип/участников (греп подстроки в собранном prompt); эмбеддируемый текст чанка начинается с контекст-заголовка; overlap/размер берутся из AdminSetting (мок `getDynamic`); **многосторонний факт «A поручил B к сроку C» извлекается с заполненными автором+адресатом+сроком (негатив: не должен схлопнуться в одного исполнителя без автора/срока).** `typecheck`+vitest зелёные.
**Закрывает:** R4, R5, R13.
**Prod:** новые крутилки → `prod-deploy-log.md` Шаг 1/7.

---

### Ф4 — «Суть встречи» как retrievable-узел `[x]`
**Цель:** «о чём встреча» имеет цельный объект для поиска.
**Картография:** report-путь `aiResult.summaryFast` → [report.adapter.ts:57](../../backend/src/modules/ingest/adapters/report.adapter.ts#L57); сегментация отчёта [segment-builder.service.ts:144-189](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L144).
**Что входит:** выделить «суть встречи» в отдельный **первоклассный retrievable IdeaBlock** (signalType — существующий подходящий, напр. `summary_point`/`fact`; `[ASSUMPTION: не вводить новый signalType — переиспользовать; если нет подходящего — обосновать в фазе]`), привязанный к эпизоду, **БЕЗ confidence-cap 0.6** (снять cap для summary-блока), с `IdeaBlockEvidence.rawEventId`. Этот блок — «родитель» для parent-document-сборки (Ф7).
**Что НЕ входит:** генерация summary (есть); community-summary GraphRAG-стиля (Ф8 — на уровне темы, не встречи).
**Файлы:** `report.adapter.ts`, `block-ingest.worker.ts` (cap-логика `:931-937`), spec.
**Acceptance:** на тестовой встрече summary-блок: (а) существует, (б) `confidence` не придушён до 0.6, (в) имеет evidence.rawEventId, (г) находится поиском по «суть встречи». vitest + живой re-test (Ф10).
**Закрывает:** R6.

---

### Ф5 — Cross-source идентичность: alias-cache + эмбеддинг-склейка `[x]`
**Цель:** «Настя» (текст) и `chydo_002` (аккаунт) — один человек.
**Картография:** `entity-resolution.service.ts` (якорь `resolveSubjectPersonId` ~`:1114`); `Entity.aliases/mergedIntoId/embedding` [schema.prisma:3560](../../backend/prisma/schema.prisma#L3560); `commitmentRecipientPersonId` (fuzzy-путь) [schema.prisma:3416](../../backend/prisma/schema.prisma#L3416).
**Что входит:**
1. **per-Org alias-cache** (новая таблица `EntityAlias` или поле — `[ASSUMPTION: новая таблица EntityAlias{tenantId, alias, personId/entityId, roleHint, createdAt, @@unique([tenantId, alias])}]`): «Настя»→Person.id+роль. Пополняется при каждом эпизоде; чтение перед fuzzy-LLM.
2. Каскад резолва имени-упоминания: (1) точный ID/email/participant (есть) → (2) alias-cache → (3) эмбеддинг имени(1536)+полнотекст по `Entity.name/aliases` → (4) LLM-арбитр с контекстом эпизода (только спорное), обновляет `aliases`.
3. Cache-friendly промпт арбитра.
**Что НЕ входит:** массовое слияние исторических дублей (vNext); смена резолвера автора (он детерминир., оставить).
**Файлы:** `entity-resolution.service.ts`, миграция (если таблица), spec, AdminSetting (порог эмбеддинг-склейки `knowledge.entity_name_resolve_threshold`, дефолт 0.9).
**Acceptance:** unit: упоминание «Настя» при наличии alias→Person резолвится в тот же `personId`, что аккаунт `chydo_002`; без alias и при cosine≥порога — склейка по эмбеддингу; manager без данных — null (fail-closed). vitest + типы.
**Закрывает:** R7.
**Prod:** новая таблица/крутилка → `prod-deploy-log.md` Шаг 4/1.

---

### Ф6 — Гибрид рёбер факт↔факт: структурные (без LLM) + смысловые (LLM) + тираж по риску `[x]`
**Цель:** связность строится дёшево и предсказуемо, риск-рёбра — под высоким барьером.
**Картография:** `block-linker.worker.ts` (якорь `findLinkCandidates`, `judgeLink`, гейт по canonical-count, `contradicts`≥0.85→Conflict); `block-link.service.ts`; `IdeaBlockLink` [schema.prisma:4129](../../backend/prisma/schema.prisma#L4129); enum [schema.prisma:700](../../backend/prisma/schema.prisma#L700).
**Что входит:**
1. **Структурные рёбра — детерминированно, без LLM, сразу при ingest:** `shares_entity` (общая `IdeaBlockEntity`), `shares_topic` (общая `Theme`), `supersedes`/temporal (та же сущность + более поздний `validFrom`, по правилу) — создаются в воркере ingest, `createdBy=system` (новый/существующий `LinkCreatedBy`), без гейта-лага.
2. **Смысловые рёбра — вектор-KNN→LLM:** оставить `block-linker` (вектор сужает → LLM судит), но **снять/ослабить гейт** (строить по мере появления canonical, не ждать порога накопления) — крутилка `knowledge.linker_min_canonical`.
3. **Тираж по риску:** для `contradicts/supersedes/causes` — порог `knowledge.edge_confidence_high` (дефолт 0.85) + **композитный судья** (≥2 независимых LLM-проверки, согласие → ребро) + запись bi-temporal (`validFrom`/`validUntil`); для `develops/refines/consequences_of` — порог `knowledge.edge_confidence_low` (дефолт 0.6).
4. Лог рёбер высокого риска для пост-проверки (метрика + structured log).
**Что НЕ входит:** изменение `EntityLink`-пайплайна (entity-graph-builder — отдельно); UI рёбер.
**Файлы:** `block-linker.worker.ts`, `block-link.service.ts`, новый детерминир. структурный линкер (в ingest-воркере), `block-ingest.worker.ts`, AdminSetting (`edge_confidence_high/low`, `linker_min_canonical`, `linker_candidate_topk`), spec.
**Acceptance:** unit: (а) два блока про одну сущность → `shares_entity` создан БЕЗ вызова LLM (мок LLM не вызван); (б) `contradicts` пишется только при согласии композитного судьи И confidence≥high-порога (негатив: один судья «да», другой «нет» → ребро НЕ создано); (в) пороги из AdminSetting. vitest + типы.
**Закрывает:** R8, R9.
**Prod:** крутилки → `prod-deploy-log.md` Шаг 1/7.
**Ревью-аспект (strict-production-review-gate):** ложное `supersedes` прячет факт — проверить bi-temporal-обратимость (факт не удалён, только `validUntil`).

---

### Ф7 — Поиск: гибридный вход + обход рёбер + группировка `[ ]`
**Цель:** рёбра графа работают в основном поиске; ответ собирается по встрече/сущности.
**Картография:** [search.service.ts:56-127](../../backend/src/modules/knowledge-core/api/search.service.ts#L56) (якорь `runHybridQuery`); 1-hop в `chat-v2-retrieval.service.ts` (якорь `expandViaGraph`) — переиспользовать.
**Что входит:**
1. **Вход** — гибрид cosine(HNSW)+BM25 (есть) + **RRF-rerank** (новый шаг слияния рангов).
2. **Обход рёбер** от точек входа: к эпизоду (parent-document: подтянуть summary-блок встречи Ф4), к связанным фактам (`IdeaBlockLink` active + `validUntil IS NULL`), к сущности и её фактам, к последней актуальной версии (bi-temporal: брать `validUntil IS NULL`, скрывать superseded). Глубина-крутилка `knowledge.search_expand_hops` (дефолт 1).
3. **Сборка с группировкой** по эпизоду/сущности (не вперемешку); в выдаче — провенанс (sourceTitle + цитата + таймкод).
**Что НЕ входит:** AGE/Cypher-обход (рёбра читаем SQL-ом из таблиц); смена эмбеддера.
**Файлы:** `search.service.ts`, переиспользовать `chat-v2-retrieval.service.ts`, AdminSetting (`search_expand_hops`, веса RRF), spec.
**Acceptance:** unit/e2e: запрос «суть встречи X» возвращает summary-блок этой встречи в топе + связанные факты сгруппированы по встрече; superseded-факт НЕ в активной выдаче; рёбра реально использованы (предикат: в результате есть блок, достижимый только через ребро, не через cosine top-N). `typecheck`+vitest. Живой re-test Ф10.
**Закрывает:** R10.

---

### Ф8 — `Theme.summary` инкрементально `[ ]`
**Цель:** «суть темы/кластера» retrievable, обновляется без полного rebuild.
**Картография:** `theme-clusterer.cron.ts`, `clustering.service.ts`, `Theme` [schema.prisma:4274](../../backend/prisma/schema.prisma#L4274) (нет `summary`).
**Что входит:** миграция `Theme.summary String? @db.Text` + `summaryUpdatedAt`; воркер `theme-summarize` (map-reduce member-блоков, инкрементально: новый блок присвоен теме → дописать/освежить резюме, без пересборки всех тем — label-propagation-приём, анализ `03`). Cache-friendly.
**Что НЕ входит:** GraphRAG-global map-reduce ответа (vNext); иерархия под-тем.
**Файлы:** `schema.prisma`, миграция, новый `theme-summarize` воркер/cron, `theme-clusterer.cron.ts`, AdminSetting (`theme_summary_enabled` kill-switch).
**Acceptance:** миграция add-column; на теме с ≥N блоков — `summary` непуст и находится поиском; добавление блока обновляет только ЕЁ summary (предикат: другие темы не пересчитаны). vitest+типы.
**Закрывает:** R11.
**Prod:** колонка+воркер → `prod-deploy-log.md` Шаг 4/12.

---

### Ф9 — Включить Ship-On флаги + крутилки в AdminSetting `[ ]`
**Цель:** убрать OFF-флаги (нарушение Ship-On), вынести пороги в AdminSetting.
**Картография:** `BITEMPORAL_ENABLED`, `BI_TEMPORAL_EDGES_ENABLED` в `env.schema.ts`; реестр `docs/operations/feature-flags.md`.
**Что входит:** перевести bi-temporal на **ON по умолчанию** (после корректности Ф1–Ф8); оформить как kill-switch (фича ON, рубильник для инцидента) + строка в `feature-flags.md`. Все введённые пороги/размеры/topK — в `admin-setting-schema-registry.ts` + сид + UI-поле (перечень: `contextual_header_enabled, segment_overlap_ratio, segment_max_tokens, entity_name_resolve_threshold, edge_confidence_high, edge_confidence_low, linker_min_canonical, linker_candidate_topk, search_expand_hops, theme_summary_enabled`).
**Что НЕ входит:** новые «на всякий случай» флаги (запрещено).
**Файлы:** `env.schema.ts`, `typed-config.service.ts`, `admin-setting-schema-registry.ts`, сид `seed-admin-setting-*.ts`, `docs/operations/feature-flags.md`, UI admin-поля.
**Acceptance:** bi-temporal флаги ON по умолчанию; все крутилки читаются `getDynamic` (admin→ENV→code-fallback); строки в `feature-flags.md` и реестре AdminSetting; `typecheck` зелёный.
**Закрывает:** R12.
**Prod:** ENV/флаги/сиды → `prod-deploy-log.md` Шаг 1/7; строки в `feature-flags.md`.

---

### Ф10 — Финальный живой re-test (после выката) `[ ]`
**Цель:** доказать на проде (qa-tester / diag.ts read-only).
**Что входит:** на тестовом кабинете svmazur (или ромашка): (1) «суть встречи X» → связная суть + кликабельный источник (не «не нашёл»); (2) человек, упомянутый в встрече и чате, — один профиль; (3) поиск возвращает блок, достижимый через ребро; (4) `sourceMeetingId=null` у новых блоков отсутствует (diag); (5) bi-temporal: устаревший факт не в активной выдаче. Скриншоты в `plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/verification/`.
**Acceptance:** 5 пунктов зелёные глазами + сетевые статусы.
**Закрывает:** приёмка R1–R12.

---

## Границы автономии (✅/⚠️/🚫)
- ✅ Always: миграции через `bun run prisma:migrate -- --name …` (версионируемые, CLAUDE.md — НЕ db push), `prisma:generate` после правок моделей, крутилки через AdminSetting, cache-friendly промпты, `createPrismaClient()` в скриптах.
- ⚠️ Ask first: новый `signalType`/`IdeaBlockLinkType`/`EntityLinkType` (сначала переиспользовать существующие); новая таблица сверх `EntityAlias`/`Theme.summary`; включение AGE.
- 🚫 Never: Python в продакшен-пути; `process.env.*` мимо `env.schema.ts`; `new PrismaClient()`; OFF-флаг «понаблюдаем»; удаление фактов вместо bi-temporal `validUntil`; human-gate «одобри каждое ребро».

## Pre-mortem / Риски
- **R-1 (Ф6, высокий):** ложное `contradicts/supersedes` прячет верный факт и отравляет обучение клонов. Митигация: высокий порог + композитный судья + bi-temporal-обратимость + лог (Р3).
- **R-2 (Ф5):** alias-cache ложно склеит разных людей. Митигация: приоритет сильного ID; LLM-арбитр только на спорное; порог эмбеддинга; fail-closed на неоднозначном.
- **R-3 (Ф3):** контекст-генератор на каждый чанк — стоимость. Митигация: `deepseek-v4-flash` + prompt caching; крутилка-рубильник.
- **R-4 (Ф7):** обход рёбер замедлит поиск. Митигация: глубина-крутилка (дефолт 1-hop); индексы на `IdeaBlockLink(fromBlockId,status)` уже есть (RC).
- **R-5 (Ф9):** включение bi-temporal изменит выдачу (скроет superseded). Митигация: это и есть цель; kill-switch на случай инцидента.
- **Ревью-аспекты (strict-production-review-gate):** tenant-изоляция (`tenantId` во всех новых выборках/рёбрах), идемпотентность ingest, отсутствие cross-tenant в alias-cache, обратимость supersede.

## Прод-операции (для prod-deploy-log.md)
- Миграции: `sourceTitle` (Ф1), `EntityAlias` (Ф5), `Theme.summary/summaryUpdatedAt` (Ф8) → Шаг 4; применяются авто на `docker compose up -d --build` (`migrate deploy`). Бэкфилла нет (nullable).
- Крутилки (Ф3/Ф5/Ф6/Ф7/Ф8) + флаги ON (Ф9) → Шаг 1/7 + `feature-flags.md`.
- Новый воркер `theme-summarize` (Ф8) → Шаг 12 (smoke).
- Контекст-генератор (Ф3) — новый LLM taskType → реестр LLM + Шаг 12.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `lint` · `build` — зелёные (backend).
- Затронутые `*.spec.ts` зелёные (`bunx vitest run`).
- second-brain обновлён: `02_architecture/knowledge-core.md` (эпизод-узел, гибрид рёбер, поиск-обход), `02_architecture/data-model.md` (новые колонки/таблица), `01_projects/ai-jobs.md`+`workers-queues.md` (theme-summarize, контекст-генератор), `docs/operations/feature-flags.md`, `prod-deploy-log.md` Шаги 1/4/7/12.
- Без нарративных комментариев в коде; крутилки в AdminSetting; bi-temporal ON (Ship-On).
- Ф10 пройдена на проде, скриншоты сохранены.

## Итог
Не реализовано (контракт-документ). REALITY-CHECK: граф готов на ~75% (bi-temporal/рёбра/AGE/Theme/evidence — в схеме, часть за OFF-флагами и не проведена в поиск). ТЗ — достройка проводки + включение по фазам Ф1→Ф10. Реализация по явному «начни реализацию» (передаётся `tz-orchestrator`).

---
type: analysis
status: research-complete
feature: sloy-istochnika-i-marshrutizator-poiska
date: 2026-06-27
snapshot_date: 2026-06-27
owner: sergrv80@gmail.com
related:
  - plans/analysis/2026-06-23-smart-staged-retrieval/99-synthesis.md
  - plans/analysis/2026-06-25-iterative-rag-method-parked.md
  - plans/tz/2026-06-23-knowledge-graph-ingestion-rebuild.md
  - plans/tz/2026-06-23-edinyy-pomoshnik-master.md
  - second-brain/02_architecture/knowledge-core.md
---
> Цель разбора: доказать, как починить поиск памяти компании для запросов «список встреч с человеком», «всё по теме X», «что решали в чате/группе Z», «итоги за неделю/месяц и почему» — за счёт маршрутизатора по классу запроса и подключения уже существующих, но не связанных с чатом слоёв (Theme-карта, operations-свёртки, Participant↔Meeting), плюс обогащения contextual-header.
> Следующий шаг → ТЗ: plans/tz/2026-06-27-sloy-istochnika-i-marshrutizator-tz.md

# Слой источника и маршрутизатор поиска по классу запроса

## Граница (что НЕ дублируем)

- **Верхний слой — оркестрация помощника (план → поэтапный поиск → достаточность → честный ответ)** уже разобран в [smart-staged-retrieval](2026-06-23-smart-staged-retrieval/99-synthesis.md) и законсервированном [iterative-rag-method-parked](2026-06-25-iterative-rag-method-parked.md). Не переоткрываем.
- **Нижний слой — качество одного поиска (retrievable «суть встречи», обход рёбер, склейка людей)** — зона [knowledge-graph-ingestion-rebuild](../tz/2026-06-23-knowledge-graph-ingestion-rebuild.md). Не переделываем.
- **Этот анализ — средний слой: МАРШРУТИЗАЦИЯ запроса по КЛАССУ и материализация источника как объекта.** Перед тем как искать — понять, *какой это вопрос* и *куда идти*: в SQL-таблицы, во временны́е свёртки, в карту тем или в векторный поиск фактов. И докрутить дешёвый contextual-header.

---

## 1. Рамка проблемы

**Симптом (слова владельца):** «умная система, но тупая». Не находятся запросы: «какие встречи были с Ивановым», «все встречи где обсуждали X», «документы про Y», «что решали в такой-то группе/чате (Битрикс)», «что за неделю/месяц привело к результату, почему сработали хорошо/плохо».

**Две конкурирующие формулировки корня:**

- **P1 — «нет маршрутизатора по классу запроса».** Чат отвечает на ЛЮБОЙ вопрос одинаково: плоский векторный top-k по дистиллированным фактам (`IdeaBlock`). Но «список встреч с X» — это `GROUP BY` по таблице, «итоги месяца» — это готовая свёртка, «что у нас по продажам» — это карта тем. Векторное сходство для этих классов архитектурно неуместно `[verified: TAG/CIDR 2025 p11-biswal; tigerdata «RAG is more than vector search»]`.
- **P2 — «слои есть, но не подключены к чату».** `Theme.summary` (карта-папки), `operations` weekly-digest / value-recap (временной слой «почему месяц такой»), `Participant.personId+meetingId` (связь человек↔встреча) — **всё построено и работает**, но retrieval чата к ним не обращается. Резюме тем для чата — мёртвый груз (0 обращений из chat-v2/dialog-layer), временной слой — отдельный мир.

**Iceberg (симптом → корень):** это НЕ «плохой векторный поиск» (его как раз чинить почти не надо — гибрид вектор+BM25 уже в проде). Корень — **отсутствие верхней развилки «что это за вопрос» и не разведённые провода между чатом и уже готовыми слоями.** P1 и P2 — две грани одного: система не умеет *выбрать маршрут*, поэтому всё льёт в один вектор.

**Кто страдает:** владелец/CEO с кросс-источниковыми и итоговыми вопросами; любой пользователь с запросом-списком или запросом-за-период.

**Метрика «решено»:**
- «встречи с Ивановым» → **полный** список встреч (100% recall, SQL), а не top-k похожих фрагментов.
- «итоги за месяц / почему хорошо» → ответ из готовой свёртки `value-recap`, а не 30 разрозненных блоков.
- «что у нас по продажам» → карта: резюме веток/тем, затем погружение.
- «обсуждали про реструктуризацию» → семантически релевантные источники с контекстом (имена/компании/дата в заголовке блока).
- «что решали в группе Битрикс Z» → фильтр по источнику-чату (когда поток чатов подключён).

---

## 2. Дерево классов запроса (MECE) — каркас фаз ТЗ

Корень: «пользователь спрашивает память компании». Ветви — по классу вопроса, без пересечений; каждый класс → свой маршрут.

| Класс запроса | Пример | Правильный маршрут | Состояние у нас |
|---|---|---|---|
| **К1. Список/агрегат по сущности** | «все встречи с Ивановым», «что решали в группе Z» | Детерминированный **SQL** по `Participant.personId`/`Source` → `Meeting`, `GROUP BY` | Каркас есть (`Participant.personId+meetingId`, `poolByMeeting`, `hasStructuralFilter`), **роута нет** |
| **К2. Семантика по теме** | «обсуждали про реструктуризацию», «документы про логистику» | Вектор + BM25 (гибрид) + **contextual-header** | Гибрид в проде; header есть, но **беден** (без компаний/полного состава) |
| **К3. Временно́й/итоговый** | «итоги недели», «почему месяц сработал» | **Periodic rollup** (operations weekly-digest/value-recap) | Свёртки построены, **мост в чат отсутствует** |
| **К4. Карта/обзор** | «что у нас вообще по продажам» | **Theme-summary** (карта папок) → погружение | `Theme.summary` + `Theme.embedding` есть, **в retrieval не читаются** |
| **К5. Точечный факт** | «что решили по бюджету Q3» | Плоский вектор по `IdeaBlock` (как сейчас) | **Работает** |

Cross-cutting (поверх всех классов): обогащение contextual-header, fuzzy-резолв имени сущности до фильтра, fallback-каскад при пустом структурном результате.

---

## 3. Ландшафт аналогов (РФ + зарубеж)

Воронка: ~21 продукт просмотрено (11 зарубеж + 10 РФ) → отобрано для teardown по силе пересечения с нашим сценарием «источник как объект + участник-сущность + метаданные в индексе».

### Зарубеж
- **Gong** `[verified]` — эталон «источник=объект»: звонок и сделка — first-class с участниками-сущностями и keyword-trackers; «список звонков с человеком X / где обсуждали competitor» — нативный SQL-подобный фильтр, не AI-надстройка. Но это вертикаль sales-ops. https://help.gong.io/docs/search-for-calls
- **Fireflies** `[verified]` — встреча как объект с фильтрами Participant/Type/Organizer; «встречи с X» достижимо. Но семантический Smart Search живёт ВНУТРИ одного транскрипта, метаданные — в другом слое → «то находит, то нет». https://fireflies.ai/blog/fireflies-topic-tracker
- **Glean** `[verified]` — человек смоделирован как сущность (People-поиск), но встреча/чат остаются документами; **дока сама признаёт over-filtering**: каждый фильтр = AND, сужает до нуля, «снимайте по одному». Прямое подтверждение боли. https://docs.glean.com/administration/search/troubleshooting
- **Hebbia (Matrix)** `[verified/claimed]` — единственный, кто «reasons over content AND metadata» (строка=документ-объект, колонки=поля). Но домен — документы M&A, без участников-сущностей. https://www.hebbia.com/product
- **Notion AI Q&A / Dust** `[verified]` — оба ровно «умные, но тупые»: RAG поверх страниц/коннекторов, источник не объект, метаданные неровные; Dust by design не видит forwarded/вложения в Slack → «что решали в канале» дырявое. https://www.notion.com/help/guides/get-answers-about-content-faster-with-q-and-a · https://docs.dust.tt/docs/what-data-do-the-agents-have-access-to
- **Supermemory / Mem0** `[verified]` — это инфраструктура памяти (metadata-фильтры, hybrid), не end-user сценарий; источник-объект и участник-по-присутствию — ответственность приложения сверху.

### РФ
- **МТС Линк** `[сильный сигнал]` — самый продвинутый в проде: ИИ-помощник отвечает кросс-встречно «что обсуждали на прошлой неделе», «какие решения». Но: требует включённой транскрибации, жёстко режется доступами, фильтр встреч — по типу, не по присутствию; объектной навигации «список встреч с Ивановым» в справке нет. https://help.mts-link.ru/article/23201
- **Контур.Толк / SaluteJazz / VK Teams / Bitrix24 CoPilot** `[verified]` — резюме+транскрипт по спикерам есть у всех, но поиск **внутри одной записи**; кросс-объектного семантического и «по человеку» нет. У VK Teams «semantic search» — пункт roadmap, не прод. CoPilot работает на одном объекте. https://habr.com/ru/articles/964942/
- **MEETRON / DBI** `[слабый сигнал — только лендинги]` — единственные позиционируются как «корпоративная память»: AI-поиск по всему архиву, RAG «что обсуждали по проекту X 3 мес назад». Независимых отзывов/демо нет — нужна отдельная адверсариальная проверка. https://meetron.ru/ · https://dbi.ru/dbi-predstavlyaet-intellektualnogo-assistenta/

**Белое пятно (подтверждено двумя контурами):** ни один горизонтальный company-memory не делает ОДНОВРЕМЕННО (а) встречу/чат/документ first-class-объектом, (б) участника сущностью по присутствию с «список встреч по человеку», (в) кросс-объектный поиск по теме без over-filtering, (г) маршрутизацию запроса на структурный/временной класс. Gong делает (а)(б) для sales; МТС Линк ближе всех в проде по (в), но без объектной навигации.

---

## 4. Teardown паттернов решения (функционально + технически, маппинг на Z)

### 4.1 Маршрутизатор по классу запроса `[router]` — ЯДРО решения
**Функционально:** прежде чем искать, система определяет тип вопроса и выбирает маршрут (как ваш личный «второй мозг»: сначала в карту-индекс → понять КУДА → нырнуть). «Список/все» → SQL; «итоги периода» → свёртка; «обзор темы» → карта; «про что» → вектор.
**Технически:** LlamaIndex RouterRetriever/SubQuestion (LLM выбирает индекс) `[claimed]`; semantic-router (kNN по эталонным фразам, без LLM, детерминированно) `[verified]`. Microsoft GraphRAG local-vs-global routing `[verified, arXiv 2404.16130]`: сущностный вопрос → local (обход рёбер), обзорный → global (резюме сообществ).
**Маппинг на Z:** `query-plan-extractor` УЖЕ извлекает `themeBranches[]`, `periodExpr`, `entityHints` — это половина роутера. Не хватает развилки «выбрать маршрут по интенту (list/aggregate/temporal/overview/fact)», которая сейчас всегда падает в вектор.

### 4.2 Structural SQL route для класса К1 `[tag-sql]` — сильнейший вывод red-team
**Функционально:** «какие встречи были с Ивановым» — это не поиск похожего, это перечисление по факту участия. Решается одним SQL, со 100% полнотой, без вектора и графа.
**Технически:** TAG/Text2SQL класс `[verified, CIDR 2025]`; современный RAG роутит счёт/список на SQL-маршрут `[milvus routing]`.
**Маппинг на Z:** `Participant(personId, meetingId, @@index)` + `Meeting` уже в схеме (`schema.prisma:1468`). Запрос `Person(name~'Иванов') → Participant.personId → Meeting GROUP BY date` исполним **сегодня**. Каркас structural-route есть: `hasStructuralFilter`, `poolByMeeting` (`chat-v2-retrieval.service.ts`).

### 4.3 Contextual Retrieval `[contextual-retrieval]`
**Функционально:** к каждому куску перед эмбеддингом дописывают 50–100 токенов «где это в источнике, о ком, когда» — пропадает потеря «о ком фрагмент».
**Технически `[verified, Anthropic 2024-09]`:** −35% промахов на эмбеддингах, −49% с BM25, −67% с reranker. Промпт: «situate this chunk within the overall document».
**Маппинг на Z:** слот `contextHeader` УЖЕ в эмбеддинге (`embedding.service.ts:14-22`), строится из title/type/date/участников (`chunk-context.service.ts`), крутилка `knowledge.contextual_header_enabled` (ON). Данные для обогащения (компании из `IdeaBlockEntity`, полный состав из `Participant`, человекочитаемое резюме из `RawEvent.sourceTitle`) уже лежат — нужно лишь **положить их в header** и сделать backfill. Цена эмбеддинга ничтожна (`text-embedding-3-small` $0.02/1M, корпус мал).

### 4.4 Temporal rollup для класса К3 `[temporal-rollup]`
**Функционально:** «итоги за период / почему хорошо-плохо» отвечают НЕ векторным top-k, а готовой свёрткой по окну.
**Технически `[claimed, arXiv 2510.13590 TG-RAG / 2510.16715]`:** multi-granularity резюме на временны́е узлы (день→неделя→месяц), incremental rebuild только новых узлов.
**Маппинг на Z:** `operations/weekly-digest.service.ts` (`WeeklyOperationsDigest`) и `value-recap.service.ts` (`ValueRecapSnapshot` per `periodYm` + сравнение месяц-к-месяцу) — **это и есть temporal rollup, уже построенный**. `period-resolver.ts` уже парсит «эта неделя/прошлый месяц». Нет только моста chat → operations.

### 4.5 Карта тем / community-summary для К4 `[map-graphrag]` + RAPTOR
**Функционально:** «оглавление базы» — резюме разделов, по которым агент решает куда нырять.
**Технически `[verified, GraphRAG 2404.16130; RAPTOR 2401.18059 +20% QuALITY]`:** иерархические резюме сообществ/кластеров; global-search = map-reduce по резюме.
**Маппинг на Z:** `Theme.summary` (инкрементальный map-reduce, cron `theme-summarize.cron.ts`) = **готовый уровень-1 community-summary**. `Theme.embedding vector(1536)` (`schema.prisma:4284`) есть, но в маршрутизации не используется. RAPTOR-дерево заново строить НЕ надо — наш граф это сеть (`IdeaBlockLink`), GraphRAG-стиль ложится лучше и уже наполовину есть.

### 4.6 Document Summary Index / Multi-Vector — для документов и source-summary `[doc-summary]`
**Функционально:** у каждого крупного источника своя карточка-резюме как индексный ключ; «найти по резюме — вернуть целое».
**Технически `[verified, LlamaIndex; LangChain MultiVector]`:** summary-вектор + hypothetical-questions-вектор на документ. Наш `criticalQuestion` = hypothetical question руками.
**Маппинг на Z:** узел «Суть встречи» (отдельный IdeaBlock из summary) УЖЕ создаётся `maybePersistMeetingSummary`, но гейт `sourceType==='meeting_report'` (`block-ingest.worker.ts:983`). **Документы вообще без AI-заголовка/summary** — реальная дыра. `RawEvent.sourceTitle` хранит резюме эпизода, но не эмбеддится.

---

## 5. Gap-таблица «лучшее у рынка × что у нас × дельта»

| Возможность | Лучший аналог (как) | Что у Z сейчас | Дельта / что строить |
|---|---|---|---|
| Список встреч по человеку | Gong (фильтр по участнику) | `Participant.personId+meetingId` есть; роута нет | **SQL-маршрут К1** (дёшево, 100% recall) |
| Поиск по теме с контекстом | Anthropic contextual (−49%) | Гибрид вектор+BM25 в проде; header беден | **Обогатить header** (компании/состав/sourceTitle) + backfill |
| Итоги за период | TG-RAG (rollup по окну) | `weekly-digest`/`value-recap` построены | **Мост chat → operations** (К3) |
| Обзор/карта темы | GraphRAG global-summary | `Theme.summary`+`Theme.embedding` есть, не читаются | **Мост chat → theme-summary** + semantic-routing (К4) |
| Документ как объект | LlamaIndex DocSummaryIndex | Документы без title/summary | **Генерить AI-title+summary документа** + расширить summary-узел |
| Чат-эпизод (Битрикс-день) | — (никто не делает) | `sourceTitle` для чатов есть, источник не объект | **Источник-чат как объект** (когда поток подключён) |
| Anti over-filtering | Glean (признаёт, не решил) | Фильтр recall-safe (полный скан), но ложное извлечение сущности обнуляет | **Fuzzy-резолв имени + fallback-каскад** при пустом результате |

---

## 6. Матрица вариантов (глубина перестройки)

Критерии = ограничения Z: единый Bun+Node+TS-стек, pgvector/Prisma (db push запрещён → файл-миграции), multi-tenancy, ранний прод (~4 юзера, корпус мал), не сломать работающий chat-v2, переиспользовать существующее.

| Критерий | **A. Маршрутизатор + провода** (минимум) | **B. A + слой источника** (средне) | **C. A+B + граф присутствия + RAPTOR** (полный) |
|---|---|---|---|
| Закрывает К1 (список с X) | ✓✓ SQL-роут по `Participant.personId` | ✓✓ | ✓✓ |
| Закрывает К3 (итоги периода) | ✓✓ мост в operations | ✓✓ | ✓✓ |
| Закрывает К4 (карта/обзор) | ✓ роут в `Theme.summary` | ✓ | ✓✓ иерархия глубже |
| Закрывает К2 (тема) | ✓ обогащённый header (−35..49%) | ✓✓ + source-summary вектор | ✓✓ |
| Документы как объект | ✗ (вне минимума) | ✓✓ AI-title+summary | ✓✓ |
| Новые тяжёлые таблицы/индексы | нет (переиспользуем) | source-summary вектор (опц., +HNSW) | +граф-рёбра присутствия, +RAPTOR-дерево |
| Риск регрессии chat-v2 | низкий | средний (A/B на source-vector) | **высокий** (red-team: засор графа +12пп, взрыв `IdeaBlockEntity`) |
| Стоимость LLM при ингесте | ~0 (header из готовых данных) | +summary на документ/чат | +summary на каждый источник + дерево |
| Соответствие Ship-On / обратимость | высокая (крутилки) | высокая | низкая (структурная миграция графа) |
| Источник оценки | red-team + feasibility (код) | feasibility | red-team (arXiv 2510.26512 шум +12пп) |

---

## 7. Рекомендация (ADR-каркас)

**Критерий пересмотрен (требование владельца):** проектируем СРАЗУ под 100–200k тенантов, надёжно и лучше-на-рынке, чтобы НЕ переписывать при росте. Цена/скорость разработки — не аргумент; но и не over-engineering ради сложности. Под этим критерием рекомендация — НЕ «минимальный A», а **правильный долговечный скелет**, разнесённый на три корзины (build-now / contract-defer / reject) по итогам scale-red-team.

**Главный архитектурный вывод (verified рынком):** лидеры НЕ выбирают «граф ИЛИ вектор ИЛИ SQL». Правильный долговечный retrieval — **многомаршрутный: детерминированный роутер класса → приоритетный маршрут + confidence-gated подстраховка (оба пути параллельно при неуверенности) → слияние RRF**, поверх трёх постоянных слоёв: *источник-объект → явные рёбра сущность↔источник → иерархические резюме (тема + время)*. Скелет аддитивен: при росте добавляются партиции и инкрементальные свёртки, контракт retrieval не меняется.

### Build now — правильный фундамент, дорого чинить потом
1. **Партиционирование векторных индексов по `tenantId`** (declarative HASH-partitioning `IdeaBlock`/`Entity`/новый source-summary, per-partition HNSW + pre-filter). `verified`: shared-HNSW+`WHERE tenantId` — самый медленный путь и REINDEX-ад на масштабе; per-partition даёт partition-pruning на plan-time. **Сделать сейчас, пока прод пуст — потом это пересоздание всех таблиц с даунтаймом.** Точка: `postgres-init.sql:72-89` (сейчас глобальные HNSW без tenant в партиции).
2. **Источник как первоклассный объект** — нормализованные `SourceParticipant(sourceId, personId, role)` и `SourceEntity(sourceId, entityId)` на уровне ИСТОЧНИКА (не блока), индекс `(tenantId, personId/entityId, occurredAt)`. Это детерминированный фундамент К1/К3/К4: «все встречи с Ивановым» = индексный скан по ребру, не вектор. Линейно по рёбрам (M на встречу), без взрыва и шума. Обобщает существующий `Participant.personId+meetingId` на любой источник (чаты/CRM).
3. **Роутер 5 классов — детерминированный (правила + tiny-classifier), НЕ LLM на каждый запрос**, с **confidence-gated both-ways**: уверен → один маршрут; не уверен → структурный ∪ семантический параллельно + RRF. Промах роутера = деградация ранга, НИКОГДА не пустая выдача. Точка: `query-plan-extractor.service.ts` (порог `0.6` уже есть, fail-open уже есть) + развести if/else `chat-v2-retrieval.service.ts:289` в параллельный `allSettled`+`fuseRankedLists` (механизм RRF готов).
4. **Гибрид dense+BM25+rerank + contextual-header** (E) — доказанный лучший baseline качества (−49% / −67% ошибок, Anthropic). BM25/RRF готов; contextual-header генерить на ingest (разово); rerank — только на финальные top-20..50 (масштабируется).
5. **Подключить к чату УЖЕ построенные слои:** temporal rollups (`weekly-digest`/`value-recap`) как маршрут К3; `Theme.summary` как карта-вход К4 (lazy query-time expansion по ветке, не предрасчитанная иерархия). Данные есть — нужен только маршрут.

### Maximum-scope (решение владельца: строим сразу, не откладываем)
Владелец выбрал максимум — всё ядро строится в этом ТЗ. То, что в scale-варианте было «отложено по цене/риску», переходит в scope, КРОМЕ ограничений корректности и реальных внешних блокеров (ниже).
- **source-episode summary+embedding для всех ЭПИЗОД-источников** (встреча, документ, дневной чат-тред) — это длинные источники, для них резюме-вектор корректен и нужен. *Ограничение корректности (не экономии):* отдельное короткое сообщение чата НЕ является эпизодом и НЕ эмбедится отдельно — эпизод = тред/день; иначе это дубль IdeaBlock и шум. Размерность модели версионируется (`embeddingModelVersion` на эпизоде) для будущей смены модели без слепого бэкфилла.
- **AI-title+summary документов** + расширение summary-узла на документы/чаты (снять гейт `block-ingest.worker.ts:983`) + передавать `sourceTitle` для документов (сейчас `document.adapter.ts:201-221` его НЕ шлёт) — закрываем дыру документов целиком.
- **Битрикс-чат как источник** — `SourceParticipant`/`SourceEntity`/эпизод-контракт и весь ingest-путь строим сразу. *Реальный внешний блокер (не отсрочка по цене):* материализация наполнится, когда подключён живой поток сообщений из Битрикса — код-способность есть сразу, данные текут по готовности интеграции.

### Reject — ложная сложность под масштаб
- **LLM-роутер на каждый запрос** → +200–500 мс латентности × каждый запрос × 100k тенантов + недетерминизм. Заменить детерминированным.
- **Полная Leiden community-иерархия (полный GraphRAG)** → индексация ×6–8, super-linear рост, summary стареет при ежедневном ingest. Microsoft сам ушёл в **LazyGraphRAG** (query-time, ~0.1% indexing cost). К4 строить на существующей `Theme.summary` + ленивое расширение.
- **Симметричный both-ways («всегда оба»)** → шум, падение precision на К2/К5. Только confidence-gated fallback.
- **Участник→Entity-линк на каждый IdeaBlock по присутствию** → взрыв `IdeaBlockEntity` ×N, шум графа. Присутствие = ребро уровня источника (`SourceParticipant`).
- **`ThemeBranch` enum как ось К4** → 12 фикс-веток прокрустово для 100–200k разнопрофильных компаний; новый маршrut К4 вязать на `Theme.embedding`-близость per-tenant, не на enum (сам enum не трогаем — это отдельное решение).

**Важно (уже сделано правильно):** команда УЖЕ обошла главный recall-killer — в `chat-v2-retrieval.service.ts:289-391` структурный фильтр идёт полным pre-filtered сканом, а HNSW-срез только для чистой семантики (комментарий «жёсткий pre-filter на HNSW роняет recall»). Фундамент изоляции частично заложен — достраиваем партиционированием, не переписываем.

**Последствия:** один вектор-класс (IdeaBlock) + структурные рёбра + ленивая карта + партиции по тенанту обслуживают все 5 классов надёжно и масштабируемо, без второго/третьего класса предрасчитанных артефактов, которые растут super-linear и стареют. Минимум движущихся частей = минимум дрейфа и инцидентов на масштабе.

---

## 8. Открытые вопросы к владельцу (каждый — с рекомендацией)

1. ~~**Глубина захода.**~~ **РЕШЕНО владельцем (2026-06-27): максимум — всё ядро в одном ТЗ** (Ф1–Ф9 части II.3), без минимально-фазового дробления. Откладывается только материализация Битрикс-чата (внешний блокер — поток данных), не код-способность.
2. **Документы — AI-заголовок и summary** + эпизод-узел. — **В scope (максимум).** Сейчас документ = имя файла (`documents.service:162`), `sourceTitle` не передаётся (`document.adapter:201-221`) — закрываем целиком.
3. ~~**К4 карта: полная иерархия vs lazy-map?**~~ **РЕШЕНО владельцем (2026-06-27): lazy-map поверх `Theme.summary` (LazyGraphRAG-стиль).** Карта строится в момент широкого вопроса из готовых сводок разделов — выше качество (Microsoft LazyGraphRAG) и всегда свежо при ежедневном ingest, без устаревающей предрасчитанной иерархии. Полную Leiden-иерархию НЕ строим.
4. ~~**Само-растущие «папки».**~~ **РЕШЕНО владельцем (2026-06-27): рост на уровне `Theme` (листья, per-tenant), 12 `ThemeBranch` остаются фиксированными.** «Новая тема → новая папка» работает как растущая тема внутри стабильного раздела. Новый К4-маршрут вязать на `Theme.embedding`-близость, НЕ на enum (enum зашит в `chat-v2:326`/`query-plan-extractor:110`/индекс — не трогаем).

---

## 9. Допущения и риски (desirability / viability / feasibility)

- `[feasibility, High]` SQL-маршрут К1 исполним на текущей схеме (`Participant.personId+meetingId` есть) — проверено по коду.
- `[feasibility, High]` Мосты К3/К4 переиспользуют готовые `operations`/`Theme.summary` — проверено по коду.
- `[feasibility, Med]` Backfill ре-эмбеддинга после обогащения header требует REINDEX HNSW (деградация при массовом UPDATE) и записи вектора сырым SQL `::vector(1536)`.
- `[feasibility, Med]` Маршрутизатор-классификатор может ошибаться в интенте (ложно увести «список» в вектор). Митигация: fallback-каскад + лог filter-suppression rate.
- `[viability, Med]` Документ-summary без структуры может галлюцинировать участников/компании → ложные сущности в фильтре. Митигация: summary только из извлечённого текста, сущности — из `IdeaBlockEntity`, не из summary.
- `[risk, High]` Граф присутствия (отклонён) дал бы +12 п.п. шума `[arXiv 2510.26512]` и взрыв `IdeaBlockEntity` — НЕ делать.

---

## 10. Ограничения и непроверенное

- `[unverified]` Context7 в окружении был недоступен — тюнинг HNSW (`m`/`ef_construction`), `halfvec`, поведение Prisma 7 driver-adapter с `Unsupported(vector)` в новых миграциях НЕ сверены. Сверить перед миграцией варианта B.
- `[unverified]` MEETRON/DBI — только лендинги, без демо/отзывов; заявка «корпоративная память с RAG по архиву» не подтверждена поведением. Нужна отдельная адверсариальная проверка, если важен прямой конкурент.
- `[claimed]` Числа TG-RAG/temporal (2510.13590, 2510.16715) — по abstract, без независимого замера.
- `[inferred]` BookRAG/A-RAG (агентное чтение оглавления) — по поисковой выдаче, первоисточники не открыты.
- `[verified — снято]` `ingest.service.ts` payload RawEvent подтверждён чтением (`:132-148`, `sourceTitle:138`).
- `[verified — баг под мультитенант]` `period-resolver.ts:18-25` возвращает жёсткий МСК +180 мин для ЛЮБОЙ tz (не читает реальную IANA-tz организации) — К3 на не-МСК тенантах будет считать период неверно; фикс — в Ф5.
- `[verified — учесть в схеме]` `Participant:1468` и `AiResult:1581` БЕЗ `tenantId` (изоляция через Meeting); `Meeting↔RawEvent` — не FK, а через `RawEvent.sourceExternalId`. Новые модели слоя источника обязаны нести `tenantId` явно.

---

## 11. Источники

- Anthropic Contextual Retrieval — https://www.anthropic.com/news/contextual-retrieval · 2024-09 · **verified** (−35/49/67%)
- GraphRAG «From Local to Global» — https://arxiv.org/abs/2404.16130 · 2024-04 (v2 2025-02) · **verified** (community-summary, local/global)
- RAPTOR — https://arxiv.org/abs/2401.18059 · 2024-01 · **verified** (+20% QuALITY)
- TAG / Text2SQL is not enough — https://vldb.org/cidrdb/papers/2025/p11-biswal.pdf · CIDR 2025 · **verified** (список/счёт — структурный класс)
- LlamaIndex Document Summary Index — https://www.llamaindex.ai/blog/a-new-document-summary-index-for-llm-powered-qa-systems-9a32ece2f9ec · **verified**
- LangChain MultiVector / Parent Document — https://reference.langchain.com/python/langchain-classic/retrievers/multi_vector/MultiVectorRetriever · **verified**
- Hybrid/RRF на Postgres — https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual · **verified**
- Over-filtering (soft/hard, coverage, fallback) — https://optyxstack.com/rag-reliability/metadata-filters-in-rag-why-good-documents-disappear-before-retrieval-starts · 2026 · **verified**
- GraphRAG vs Vector (entity linking) — https://weaviate.io/blog/graph-rag · **verified**
- Шум графа без семантического фильтра +12 п.п. — https://arxiv.org/pdf/2510.26512 (CORE-KG) · 2025 · **claimed**
- semantic-router — https://github.com/aurelio-labs/semantic-router · **verified**
- TG-RAG temporal — https://arxiv.org/abs/2510.13590 · 2025-10 · **claimed**
- Gong search — https://help.gong.io/docs/search-for-calls · 2026-06 · **verified**
- Glean over-filtering (дока) — https://docs.glean.com/administration/search/troubleshooting · 2026-06 · **verified**
- МТС Линк ИИ-помощник — https://help.mts-link.ru/article/23201 · 2025-26 · **verified**
- Fireflies / Notion / Dust / Hebbia / Supermemory — см. §3 (URL при каждом) · 2026-06
- Multi-tenant pgvector (per-partition HNSW, 37.2×/32.9×) — https://arxiv.org/html/2401.07119v1 (Curator) · **verified**
- pgvector в проде (HNSW params, relaxed_order, partition by tenant, memory-resident) — https://aws.amazon.com/blogs/database/running-pgvector-in-production-on-amazon-aurora-postgresql/ · **verified**
- Multi-tenant RAG (шардить по тенанту за ~10M, recall-collapse post-filter) — https://www.tigerdata.com/blog/building-multi-tenant-rag-applications-with-postgresql-choosing-the-right-approach · https://www.thenile.dev/blog/multi-tenant-rag · **verified**
- GraphRAG dynamic community selection (−77% cost) — https://www.microsoft.com/en-us/research/blog/graphrag-improving-global-search-via-dynamic-community-selection/ · **verified**
- LazyGraphRAG (~0.1% indexing cost, контр-аргумент полной иерархии) — https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/ · **verified**
- GraphRAG в проде (×6–8 indexing, super-linear) — https://tianpan.co/blog/2026-04-09-graphrag-production-when-vector-search-hits-ceiling · **claimed**
- Semantic-router детерминированный + LLM-fallback — https://www.deepchecks.com/glossary/semantic-router/ · Route Before Retrieve https://arxiv.org/html/2605.10235 · **verified**
- Corrective-RAG / fallback-каскад — https://neo4j.com/blog/agentic-ai/what-is-agentic-rag/ · **verified**

---

# ЧАСТЬ II — TZ-ready спецификация (максимум). Вход для tz-author

## II.1 Целевая схема (новые first-class модели слоя источника)

Все новые модели — с `tenantId` (важно: `Participant:1468` его НЕ имеет, изоляция транзитивна через Meeting — для омниканальности это недостаточно).

| Модель (новая) | Назначение / класс | Ключевые поля | Индекс |
|---|---|---|---|
| `SourceEpisode` | Эпизод-объект (встреча/документ/чат-тред) для К2/К4 семантики по источнику | `tenantId`, `rawEventId @unique`, `kind`(meeting/document/chat), `title`, `occurredAt`, `summary @db.Text`, `embedding vector(1536)?`, `embeddingModelVersion`, `branch ThemeBranch?` | HNSW(partial) + `(tenantId, occurredAt)` |
| `SourceParticipant` | Ребро person↔источник «по присутствию» для К1 list/aggregate | `@@id([rawEventId, personId])`, `tenantId`, `role`, `speakingShare?` | `(tenantId, personId, occurredAt)` |
| `SourceEntity` | Ребро упомянутая-компания↔источник (агрегат, не block-mention) для К1/К4 | `@@id([rawEventId, entityId])`, `tenantId`, `mentionsCount` | `(tenantId, entityId, occurredAt)` |
| `TemporalSummary` (опц., если иерархия времени глубже weekly) | К3 итоги по периодам выше недели | `tenantId`, `periodType`, `periodStart`, `branch?`, `summary`, `embedding?`, `computedAt` | `(tenantId, periodType, periodStart)` |

**Переиспользуем, не плодим:** `Theme.summary:4289`+`Theme.embedding:4284` = карта К4 (новой модели карты не надо); `WeeklyOperationsDigest:7714`/`DailyOperationsDigest:7764`/`ValueRecapSnapshot:7335` = К3 (мост, не новая модель); `EntityAlias:4241` = fuzzy-резолв имени; `Participant.personId:1478` = источник backfill `SourceParticipant` (через `Meeting → RawEvent` по `sourceExternalId`).

## II.2 Пять маршрутов (контракт роутера)

| Класс | Триггер (детерминированный) | Первичный маршрут (path) | Подстраховка |
|---|---|---|---|
| К1 список/агрегат | глагол-перечисление + сущность/группа | SQL по `SourceParticipant`/`SourceEntity` → эпизоды (новая ветка `runStructuralAggregate` рядом с `fetchCandidates:240`) | + семантический, если сущность не зарезолвилась |
| К2 семантика темы | свободный «про что» | vector+BM25+RRF по IdeaBlock (`runRetrieval:942`) + contextual-header | + структурный, если всплыла сущность |
| К3 временной/итог | period + итоговый интент | мост к `value-recap:46`/`weekly-digest:87` по периоду | + vector по блокам периода |
| К4 карта/обзор | широкий обзорный | `Theme.summary` top-N по `Theme.embedding`, lazy-expand по ветке | + vector по теме |
| К5 факт | точечный | vector+BM25 (как сейчас) | + структурный по сущности |

**Инвариант:** роутер выбирает приоритет, не единственность. Both-ways — `confidence < 0.6` (`QUERY_PLAN_MIN_CONFIDENCE:76`) или слабая выдача → структурный ∪ семантический параллельно (`Promise.allSettled` уже есть в `ask:688`) + RRF (`fuseRankedLists:988`). НИКОГДА не пусто. Роутер — детерминированный (правила в `query-classifier:62-99` уже есть как зачаток + tiny-classifier), НЕ LLM-на-каждый-запрос.

## II.3 Каркас фаз для ТЗ (MECE — по классам и слоям)

- **Ф1. Партиционирование HNSW по `tenantId`** (декларативный HASH-partitioning `IdeaBlock`/`Entity`, per-partition HNSW; `postgres-init.sql:72,87` сейчас глобальные, дефолт m=16/ef_construction=64). Делать первым, пока прод пуст.
- **Ф2. Слой источника** — модели `SourceEpisode`/`SourceParticipant`/`SourceEntity` + backfill из `Participant`/`IdeaBlockEntity`; врезка генерации эпизода в `block-ingest.worker.ts` (рядом с `maybePersistMeetingSummary:977`, снять гейт `:983`).
- **Ф3. Роутер 5 классов + both-ways** в `query-plan-extractor`/`dialog.service:65` + разводка маршрутов в `chat-v2.service.ask`.
- **Ф4. SQL-маршрут К1** (`runStructuralAggregate`) + ось `personIds` в `StructuralRetrievalFilters:35`.
- **Ф5. Мост К3** chat → operations-rollups (+ фикс tz-бага `period-resolver` — жёсткий МСК+180 для любой tz `:18-25`).
- **Ф6. Мост К4** chat → `Theme.summary` lazy-map (+ HNSW на `Theme.embedding` — сейчас в `postgres-init.sql` его НЕТ, только b-tree).
- **Ф7. Contextual-header v2** — обогатить `chunk-context.buildContextHeader:31` (компании, полный состав, sourceTitle) + backfill ре-эмбеддинга IdeaBlock + REINDEX.
- **Ф8. Документы как объект** — AI-title+summary в `documents.service:162`/`document.adapter:144`, передать `sourceTitle`, эпизод-узел для документа.
- **Ф9. Rerank-доводка** — `conditionalRerank:1005` уже есть (LLM-as-reranker); вынести в крутилку, проверить на финальных top-20..50.

## II.4 Граница с прошлыми ТЗ/анализами (НЕ дублировать)

- **`knowledge-graph-ingestion-rebuild.md` (нижний слой, Ф1–9 = `[x]`, Ф10 `[ ]`):** уже дал retrievable «суть встречи» (`maybePersistMeetingSummary:977`), `EntityAlias:4241`, structural-рёбра (`createStructuralEntityEdges:1742`), `Theme.summary:4289`. **Наше новое:** роутер классов, нормализованные `SourceParticipant/SourceEntity` (там participants остались в payload), SQL-маршрут К1, мост К3, партиционирование. Не переопределять bi-temporal-контракты (см. REALITY-CHECK того ТЗ).
- **`iterative-rag-method-parked.md`:** staged route→plan→sufficiency **заморожен** для будущего «Большого отчёта». **Наш роутер НЕ воскрешает staged-loop в чате** — chat-v2 остаётся single-pass.
- **`smart-staged-retrieval/99-synthesis.md`:** верхний слой оркестрации (сложность none/single/iterative) — другая ось, чем наш роутер 5 классов (намерение). Гибрид+RRF+rerank, что там был gap, уже реализован.
- **`edinyy-pomoshnik-arhitektura.md`:** UI-слияние поверхностей «Мастера» + петля уточнения — наш роутер вызывается из того же single-pass chat-v2, ядро retrieval — наша зона.

## II.5 Точки врезки (verified чтением кода, path:line)

- **Роутер/ретрив:** `chat-v2.service.ts:640` `ask` (parallel `allSettled:688`), `:942` `runRetrieval` (RRF `:988`, rerank `:1005`), `:1082` `runTableBranch`; `chat-v2-retrieval.service.ts:240` `fetchCandidates`, `:100` `buildStructuralPredicates` (entity-EXISTS `:122`/date-EXISTS `:137`/themeBranch-EXISTS `:145`), `:289` ветвление structural/cosine, `:366` `collectPool` (HNSW-срез `:401-409`), `:509` `poolByMeeting`, `:632` `poolByTheme`, `:855` `expandViaGraph`, `:770` `rankByStructuralFilter` (recall-safe полный скан).
- **Роутер-извлечение:** `query-plan-extractor.service.ts:35` `StructuralRetrievalFilters`, `:76` порог 0.6, `:360` `resolveStructuralFilters`, `:407` `resolveEntityHints`; `query-classifier.service.ts:62-99` regex-эвристика, `:120` `classify`; `dialog.service.ts:65` `process`, `:143` merged understand+resolve; `period-resolver.ts:52` `resolvePeriod` (⚠️ tz-баг `:18-25`).
- **Ingest/источник:** `ingest.service.ts:132` `rawEvent.create` (`sourceTitle:138`, enqueue `:150`); `block-ingest.worker.ts:977` `maybePersistMeetingSummary` (гейт `:983`), `:1058` block.create, `:1084-1088` запись `embedding ::vector(1536)`, `:1117` mention-линковка, `:1742` `createStructuralEntityEdges`; `embedding.service.ts:14` `embedBlocks(blocks, contextHeader)`; `chunk-context.service.ts:31` `buildContextHeader`, `:63` `buildMetaLine`.
- **Документы:** `documents.service.ts:162` `createOne` (`name`=имя файла, без summary), `document.adapter.ts:144` `process`, `:201-221` `ingest.ingest` (БЕЗ `sourceTitle`), `:274` `upsertDocumentSource` (`type:'external'`).
- **Operations (мост К3, НЕ подключён к чату — verified пусто):** `weekly-digest.service.ts:87` `generate`, `value-recap.service.ts:46` `build`.
- **Индексы:** `postgres-init.sql:72` IdeaBlock HNSW (глобальный), `:87` Entity HNSW, `:184/192` IdeaBlock tsvector+GIN; **нет** HNSW на `Theme.embedding`, **нет** партиционирования по tenantId. RRF: `utils/rank-fusion.util.ts:5,21`.
- **Схема:** `schema.prisma:3236` Source (без summary/embedding), `:3256` RawEvent (`sourceTitle:3266`, participants только в payload), `:3309` IdeaBlock (`embedding:3322`), `:4082` IdeaBlockEntity (mention-level), `:1468` Participant (БЕЗ tenantId), `:1277` Meeting (↔RawEvent не FK, через `sourceExternalId`), `:4270` Theme (`embedding:4284`,`summary:4289`), `:5160` Document (без embedding/summary), `:4241` EntityAlias.

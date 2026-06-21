---
type: analysis
status: research-input
feature: subject-memory-and-self-learning
date: 2026-06-21
snapshot_date: 2026-06-21
---

# OSS-системы памяти для AI-агентов: дедуп, обучение на исправлениях, bitemporal

Срез (snapshot_date): 2026-06-21. Фокус: (а) выученная/обновляемая память, (б) дедупликация повторяющихся вопросов/фактов, (в) preference/correction memory.
Наш стек-мишень: Bun+Node+TypeScript/NestJS, Postgres+pgvector, Redis+BullMQ, LLM DeepSeek/OpenAI-proxy, embeddings text-embedding-3-small.

Легенда статусов: `verified` (прочитан первоисточник: GitHub/docs/arxiv), `triangulated(N)` (N независимых источников), `claimed` (заявление вторички/маркетинг), `inferred` (вывод аналитика).

---

## 1. Mem0 (mem0ai) — «memory layer», эталон pipeline extract→update

- [Mem0 — это слой долгосрочной памяти для агентов: извлекает атомарные факты из диалога, хранит как текст+embedding в векторной БД (Qdrant/Pinecone/pgvector/Chroma), на запросе подмешивает top-k фактов в промпт] → [arxiv 2504.19413v1; callsphere.ai/blog 2026] → triangulated(2)
- [Архитектура памяти = ДВЕ фазы: **extraction** (LLM φ извлекает значимые факты Ω из пары сообщений m_{t-1},m_t + краткое summary S из БД + недавние сообщения) и **update** (каждый факт сверяется с существующими)] → [arxiv 2504.19413v1] → verified
- [Update-фаза: система достаёт top **s=10** семантически похожих memory через embeddings, передаёт кандидата LLM через tool-call интерфейс, LLM выбирает ОДНУ операцию из четырёх: **ADD / UPDATE / DELETE / NOOP** (т.н. цикл A.U.D.N.)] → [arxiv 2504.19413v1; arxiv 2606.01435 (описывает тот же 4-оп паттерн как индустриальный)] → triangulated(2)
- [Семантика операций: ADD — нет эквивалента; UPDATE — дополнить существующую комплементарной инфой; DELETE — удалить факт, которому новый противоречит; NOOP — ничего нового. Выделенного классификатора нет — решает reasoning LLM напрямую] → [arxiv 2504.19413v1] → verified
- [Разрешение конфликта = «**latest truth wins**»: новый факт замещает устаревший на update-фазе] → [arxiv 2504.19413v1; mem0.ai/blog] → triangulated(2)
- [Mem0^g (граф-вариант): память как направленный размеченный граф G=(V,E,L) — узлы=сущности с типами/embedding/timestamp, рёбра=связи, на Neo4j; двойной retrieval (entity-навигация + семантический triplet-матч)] → [arxiv 2504.19413v1] → verified
- [Бенчмарк LOCOMO: Mem0 single-hop J=67.13, multi-hop J=51.15, temporal J=55.51, open-domain J=72.93; Mem0^g — 65.71/47.19/58.13/75.71] → [arxiv 2504.19413v1] → verified
- [Латентность: search p95 0.200s vs 17.117s full-context (−91%); total p95 1.440s vs 17.117s (−92%); токены ≈7k (Mem0) / ≈14k (Mem0^g) / ≈26k full-context на диалог] → [arxiv 2504.19413v1] → verified
- [⚠️ РАСХОЖДЕНИЕ ДОК↔КОД: релиз v2.0.0 ввёл «ADD-only» extraction; по факту в `mem0/memory/main.py` (строки ~784-803) дедуп идёт только по **MD5-хэшу** (`if mem_hash in existing_hashes or seen_hashes` → skip), семантическое разрешение конфликта НЕ реализовано. Противоречивые факты («liguoyu» → «liguosong») оба сохраняются как отдельные ADD; «latest truth wins» из доков в коде нет] → [github.com/mem0ai/mem0 issue #4896] → verified
- [Стек/язык: Python; лицензия Apache-2.0 (mem0ai/mem0)] → [github.com/mem0ai] → triangulated(1, inferred из репо) — ⚠ требует **порт в TS**
- **Маппинг на Z:** A.U.D.N. напрямую ложится на наш стек — top-s ретрив по pgvector (cosine) перед записью, LLM-tool-call (DeepSeek) выбирает ADD/UPDATE/DELETE/NOOP, операция = BullMQ-job. Урок из issue #4896: НЕ полагаться на MD5-only дедуп — семантический matching обязателен, иначе «помнит» дубли.

---

## 2. Letta / MemGPT — self-editing memory blocks (LLM как ОС)

- [Letta (бывш. MemGPT) = парадигма «LLM-as-OS»: модель сама управляет памятью/контекстом как ОС управляет RAM/диском] → [docs.letta.com; medium piyush jhamb 2026] → triangulated(2)
- [Три яруса памяти: **Core Memory** (малый блок В контексте = RAM, агент читает/пишет напрямую), **Recall Memory** (история диалога вне контекста, поиск = дисковый кэш), **Archival Memory** (долгосрочное хранилище, запрос через tool-call = cold storage)] → [docs.letta.com; vectorize.io 2026] → triangulated(2)
- [**Memory block** технически = {label (назначение), value (строка), size limit (символы/токены, ограничивает долю контекста)}; «значения блоков — просто строки», можно хранить структуры как сериализованный текст] → [letta.com/blog/memory-blocks] → verified
- [MemGPT-канон: два in-context блока — **Human** (факты/предпочтения о пользователе) и **Persona** (само-концепт/правила поведения агента); оба редактируемы агентом, с лимитом символов] → [letta.com/blog/memory-blocks; vectorize.io] → triangulated(2)
- [Агент правит память инструментами `core_memory_append`, `core_memory_replace` (+ пример `rethink_memory` — заменяет весь value блока по label); load-bearing примитив — labeled persistent string] → [letta.com/blog/memory-blocks; vectorize.io] → triangulated(2)
- [**Sleep-time / background-агенты**: в простой период рефлексируют над историей/кодовой базой, пишут синтезированный «learned context» в persistent memory blocks; несколько агентов могут делить один блок (shared memory)] → [letta.com/blog/memory-blocks] → verified
- [Как НЕ переспрашивает: факты/предпочтения персистятся в Human-блоке → не запрашиваются повторно между сессиями] → [letta.com/blog/memory-blocks] → verified
- [Звёзды GitHub: ~13k] → [search aggregate 2026] → claimed
- [Язык: Python] → [inferred из экосистемы MemGPT] → inferred — ⚠ концепции переносимы, код **порт в TS**
- **Маппинг на Z:** «memory block» = строка-сводка по субъекту (должность/сотрудник/Org) с лимитом, редактируемая агентом через 2 операции (append/replace) — кладётся в Postgres как версионируемое поле. Sleep-time consolidation = BullMQ-cron, который офлайн пересобирает блок (наш knowledge-core уже имеет воркеры/cron — паттерн родной). Persona/Human разделение = «память о субъекте» vs «правила клона роли».

---

## 3. Zep / Graphiti — temporal knowledge graph, bitemporal supersession (лучший образец для конфликта старого/нового)

- [Graphiti = open-source движок temporal knowledge graph (ядро Zep): динамически синтезирует неструктурированный диалог + структурные бизнес-данные, сохраняя историю связей] → [neo4j.com/blog; arxiv 2501.13956] → triangulated(2)
- [**Bi-temporal модель**: трекает (1) когда событие произошло и (2) когда было загружено (ingested); каждое ребро несёт явные интервалы валидности **t_valid / t_invalid**] → [arxiv 2501.13956; emergentmind] → triangulated(2)
- [**Разрешение конфликта**: при ингесте Graphiti семантическим+keyword+graph-поиском находит, противоречит ли новое знание старому; при конфликте по temporal-метаданным **инвалидирует** (ставит t_invalid), НЕ удаляет старый факт — история сохраняется без полного пересчёта графа] → [neo4j.com/blog; github.com/getzep/graphiti] → triangulated(2)
- [«Когда информация меняется — старые факты инвалидируются, не удаляются. Можно спросить что истинно СЕЙЧАС или что было истинно в любой момент»] → [github.com/getzep/graphiti] → verified
- [Дедуп узлов/рёбер: LLM-driven schema-based extraction со строгими JSON-схемами (Structured Output: OpenAI/Anthropic/Gemini) предотвращает создание дублей сущностей/связей при ингесте] → [github.com/getzep/graphiti] → verified
- [Provenance: каждый производный факт ссылается на episode (сырой источник)] → [github.com/getzep/graphiti] → verified
- [Стек: Python (99.4%); лицензия **Apache-2.0**; бэкенды Neo4j 5.26 / FalkorDB 1.1.2 / Amazon Neptune / Kuzu 0.11.2 (deprecated); Python 3.10+] → [github.com/getzep/graphiti] → verified — ⚠ граф-движок на Python, **порт концепции в TS** (или граф поверх pgvector+рёбра-таблицы)
- [Звёзды GitHub: 27.7k] → [github.com/getzep/graphiti, snapshot] → verified
- [⚠ против Mem0: в LOCOMO-замере Mem0-команды Zep тратит ≈600k токенов на диалог (на порядки больше) — спорное, источник заинтересован] → [arxiv 2504.19413v1 (Mem0)] → claimed
- **Маппинг на Z:** bitemporal — ключевой кирпич для «память компании». В Postgres = на ребре графа (IdeaBlockLink/EntityLink уже есть) добавить `validFrom/validTo` (occurred-at) + `ingestedAt`; supersession = не DELETE, а `validTo=now()` + новое ребро. Это даёт «что мы знали о X на дату Y» — точно под клоны/решения. У нас УЖЕ граф (knowledge-core) — это самый близкий концептуально образец, не нужен Neo4j.

---

## 4. cognee (topoteretes) — add/cognify/search, контентный хэш-дедуп, есть TS-слой

- [cognee = open-source платформа памяти: ingest данных любого формата → строит self-hosted knowledge graph для персистентной памяти между сессиями] → [github.com/topoteretes/cognee] → verified
- [Пайплайн: `.add()` (ингест+подготовка) → `.cognify()` (строит граф с embeddings) → `.search()` (vector-similarity + graph traversal). Расширенный набор: Remember / Recall (auto-routing стратегии поиска) / Forget / **Improve** (обновление-уточнение памяти)] → [github.com/topoteretes/cognee; gdotv.com blog] → triangulated(2)
- [Дедуп: контент нормализуется в plain text и **хэшируется** (content hashing) при ингесте; есть встроенная dedup-логика] → [github.com/topoteretes/cognee; web search aggregate] → triangulated(2)
- [Бэкенды: графы Neo4j/FalkorDB/KuzuDB/NetworkX; векторы Redis/Qdrant/Weaviate; реляционка SQLite/**Postgres (есть pgvector)**] → [search aggregate; github.com/topoteretes/cognee] → triangulated(2)
- [Стек: Python 83.9% + **TypeScript 14.0%** + JS 1.3%; лицензия **Apache-2.0**; ~7808 коммитов] → [github.com/topoteretes/cognee] → verified
- [Звёзды GitHub: 18.3k (карточка репо) — расходится с «~12k» агрегата] → [github.com/topoteretes/cognee vs search aggregate] → conflict (см. ниже)
- **Маппинг на Z:** add/cognify/search = ровно наш ingest→граф→retrieve. Поддержка Postgres+pgvector и наличие TS-слоя делают cognee ближайшим по стеку референсом для дедупа (content-hash как первый дешёвый фильтр ДО семантики).

---

## 5. txtai (neuml) — semantic store, не «обучаемая память», но pgvector-ready

- [txtai по умолчанию работает in-memory/локальные файлы; для масштаба нужно persistent storage (индекс отдельно от приложения)] → [neuml.github.io/txtai; fast.io] → triangulated(2)
- [Бэкенды embeddings: Hnswlib (дефолт, ANN, бинарные файлы, <1M векторов); Faiss (on-disk, memory-mapping >RAM); **PostgreSQL+pgvector** (embeddings прямо в реляционке)] → [fast.io/resources/txtai-storage-solutions] → triangulated(1)
- [Это семантический поисковый движок/embeddings-store, а не система «обучаемой памяти» с extract→update/дедупом — отсутствуют A.U.D.N./supersession механизмы] → [neuml.github.io/txtai] → inferred
- [Язык: Python; лицензия Apache-2.0] → [инфра txtai] → inferred — ⚠ как «память» неполон; релевантен только как pgvector-паттерн
- **Маппинг на Z:** ценность только как подтверждение, что pgvector-бэкенд достаточен для семантического retrieval; логику обучения/дедупа брать у Mem0/Graphiti, не у txtai.

---

## 6. Сквозные механизмы (исследовательский слой, не привязан к одному репо)

### Дедуп / разрешение конфликтов
- [Индустриальная конвенция: при противоречии **most-recent-wins**; Mem0, Graphiti(Zep), MemGPT, MIRIX, Cognee, HippoRAG-v2 все явно обрабатывают «update»/«supersession» старого новым] → [arxiv 2606.01435; mem0.ai/blog] → triangulated(2)
- [4-операционная стратегия (ADD/UPDATE/DELETE/NOOP) — общий паттерн: extraction-pass находит «что запомнить», update-pass LLM-классифицирует против существующих] → [arxiv 2606.01435] → verified
- [Consolidation (периодический скан): embeddings с similarity > **0.85** → merge через усреднённый вектор + LLM-разрешение конфликта; затем дедуп кластеров с порогом **0.9**; relevance-скоры обновляются от паттернов использования] → [search aggregate (Context Engineering / Medium)] → claimed
- [Классификация отношения нового факта к похожим: **compatible / contradictory / subsumes / subsumed** (LLM-разбор семантически близких)] → [search aggregate] → claimed

### ⭐ Детерминированное разрешение конфликта (важно — анти-паттерн «спросить LLM кто свежее»)
- [LLM ПЛОХО применяет правила свежести: (1) **prior-override** — при конфликте с приором обучения выдаёт приор вопреки инструкции «новое побеждает»; (2) **serial-comparison drift** — на длинном контексте теряет, какой serial больше: baseline упал с 75% (64K) до 61% (262K)] → [arxiv 2606.01435v1] → verified
- [Рецепт: НЕ давать LLM судить свежесть. Примитив = **structured candidate extraction (LLM) + детерминированная агрегация (Python `max(serial)`)**. BM25 top-10 → LLM находит семантически совпадающие факты (без сравнения версий) → код берёт максимальный serial/timestamp] → [arxiv 2606.01435v1] → verified
- [Результат: single-hop 78.0% (gpt-4o-mini) vs 54% (HippoRAG-v2); на 262K-контексте +21 п.п. над LLM-судейством; multi-hop 30.2% vs 7% published best] → [arxiv 2606.01435v1] → verified
- **Маппинг на Z (сильный):** LLM решает ТОЛЬКО «это про тот же субъект/факт?» (matching), а КТО ПОБЕЖДАЕТ решает код по `occurredAt`/serial. На нашем стеке: matching через pgvector+LLM, выбор победителя — детерминированный SQL/TS `max(occurredAt)`. Снимает риск «модель упёрлась в свой приор».

### Preference / correction memory (память исправлений)
- [PRELUDE / **CIPHER**: интерактивное обучение агента на **правках пользователя** к выводу агента — пользователь редактирует ответ, агент выводит латентное предпочтение] → [arxiv 2404.15269; search aggregate] → triangulated(2)
- [**MemPrompt**: LLM учится на фидбеке пользователя БЕЗ дообучения — динамическая память прошлых правок/коррекций подмешивается в будущие промпты] → [search aggregate] → claimed
- [**VARS**: компактный dual-vector «состояние пользователя» из слабых скалярных reward'ов фидбека, смещает retrieval по структурированной preference-памяти] → [arxiv 2603.20939; search aggregate] → triangulated(1)
- [Паттерн post-action feedback channel: человек даёт фидбек ПОСЛЕ действия агента → агент корректирует и обновляет память; повторно ревизуемые предпочтения добавляются в будущие task-brief'ы (feedback loop)] → [cloudflare.com/blog/introducing-agent-memory; redis.io/blog] → triangulated(2)
- **Маппинг на Z:** «правка пользователя к черновику клона» = первоклассный сигнал correction-memory (у нас уже есть DIFF черновик→финал в support-desk-анализе). Хранить как preference-memory: при противоречии с существующим предпочтением — supersede по occurredAt; подмешивать в промпт клона. Это и есть само-обучение клонов без human-approve (совпадает с feedback-правилом проекта).

### Retrieve-before-ask (как НЕ переспрашивать)
- [Принцип: память даёт агенту накопленный контекст между сессиями, чтобы НЕ переспрашивать и НЕ повторять работу] → [redis.io/blog; machinelearningmastery] → triangulated(2)
- [Retrieval мета-когнитивен: агент решает что спросить у memory-store ДО того как узнает, что там есть → перед уточняющим вопросом обязателен retrieval-проход] → [blog.cloudflare.com/introducing-agent-memory] → verified
- [**Distill-before-store**: сырые транскрипты как memory-юниты дают шумный retrieval; перед записью дистиллировать в концентрированные структурные объекты (ключевые факты, явные предпочтения, исходы действий)] → [blog.cloudflare.com; towardsdatascience] → triangulated(2)
- [Memory scaling НЕ монотонен: больше памяти ≠ лучше; низкокачественные следы учат не тому, retrieval сложнее при росте] → [databricks.com/blog] → claimed
- **Маппинг на Z:** перед probe-вопросом (наша probe-система) — обязательный retrieve по субъект-памяти (pgvector); если факт уже извлечён — не спрашивать. Distill-before-store = наш knowledge-core уже извлекает IdeaBlock из встреч (а не хранит сырьё) — правильный паттерн, усилить дистилляцией предпочтений.

---

## КОНФЛИКТЫ ИСТОЧНИКОВ

- **Звёзды Mem0**: вторичный агрегат «51k+» vs первичные карточки соседних репо в том же диапазоне ~27-28k для Graphiti. Mem0 действительно лидер по звёздам, но точное число «51k» — claimed (не подтверждён прямым чтением карточки github.com/mem0ai/mem0). Graphiti 27.7k — verified (прямое чтение). Cognee: карточка репо **18.3k** (verified) vs агрегат «~12k» (claimed) — брать 18.3k.
- **Дедуп Mem0 «latest truth wins»**: доки/arxiv заявляют семантическое разрешение (verified в статье) — issue #4896 показывает, что shipped-код делает только MD5-дедуп (verified в issue). → Для нас: реализуем семантику сами, не копируем mem0-код как есть.
- **Zep ≈600k токенов/диалог**: источник — конкурент (Mem0 arxiv), claimed; не использовать как факт против Zep.

## ИТОГ ДЛЯ Z (inferred)

1. **Граф у нас уже есть** (knowledge-core, IdeaBlockLink/EntityLink, pgvector) → ближайшие образцы концептуально = Graphiti (bitemporal supersession на рёбрах) + Mem0 (A.U.D.N. extract→update), без Neo4j.
2. **Дедуп = двухступенчатый**: дешёвый content-hash (cognee-паттерн) → семантический top-s ретрив (Mem0 s=10) → LLM-matching → **детерминированный** выбор победителя по occurredAt (arxiv 2606.01435), НЕ LLM-судейство свежести.
3. **Обучение на исправлениях**: правки черновиков клонов = correction-memory (CIPHER/MemPrompt-паттерн), supersede по времени, подмешивать в промпт; авто, без human-approve (совпадает с проектным правилом).
4. **Все ядра — Python** (mem0/Letta/Graphiti/txtai; cognee частично TS) → переиспользуем КОНЦЕПЦИИ, реализуем на Bun+TS поверх Postgres+pgvector+BullMQ; готового TS-движка «под ключ» нет.

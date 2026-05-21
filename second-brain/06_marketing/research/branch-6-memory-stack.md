# Ветка 6 — Memory frameworks stack

> Технический обзор инфраструктурного слоя «второго мозга» — что использовать под капотом.
> Дата: 2026-05-20.
> Автор-агент: Branch-6 (Memory frameworks).

## 0. Краткое резюме (TL;DR)

- **Лидеры open-source в 2026:** Mem0 (~53K★, drop-in, Apache 2.0), Letta (бывший MemGPT, Apache 2.0, memory-as-OS), Zep/Graphiti (temporal graph), Cognee (local-first, Apache 2.0), Memori (SQL-native, Apache 2.0), Supermemory (MIT, заточен под coding agents).
- **Под РФ-self-host лучше всего подходят** Cognee, Memori и Letta — у них минимальные ограничения по выбору LLM/embedder, нет привязки к закрытой SaaS-инфраструктуре, явно поддерживается OpenAI-compatible API (то, что даёт прокси `proxy.agent-lia.ru` для проекта Z).
- **Не подходят без оговорок:** Supermemory (full self-host только на Enterprise-контракте, инфра привязана к Cloudflare Workers), Zep SaaS (запрещён по периметру, Community Edition deprecated).
- **Темпоральная память (temporal graph) в РФ — только через Graphiti core**, потому что Zep Community Edition закрыт (см. 6.2.4).
- **Embeddings под русский язык:** `ai-sage/Giga-Embeddings-instruct` (SOTA на ruMTEB) или `BAAI/bge-m3` как мультиязычный fallback — оба совместимы с pgvector.
- **Главный практический вывод:** для проекта Z базовый стек = **Mem0 OSS (drop-in) + Postgres/pgvector + Graphiti (temporal layer для встреч) + GigaEmbeddings/bge-m3**. Альтернатива «всё-в-одном» — **Cognee** (если нужна одна точка интеграции с минимумом инфры).

---

## 6.1. Обзорная матрица всех фреймворков

| Фреймворк | Тип памяти | Self-host? | Цена SaaS | Совместимость с RU LLM (GigaChat/YandexGPT) | Лицензия | GitHub Stars (2026-05) | Production refs | Главная слабость |
|---|---|---|---|---|---|---|---|---|
| **Mem0** (mem0ai/mem0) | Hybrid: vector (pgvector) + graph (Neo4j/Memgraph/Kuzu/Apache AGE) + KV | Да (Docker compose, 3 контейнера) | Free 10K mem → $19 Starter → $249 Pro → Enterprise | Через OpenAI-compatible (LiteLLM-прокси / GigaChat-прокси) | Apache 2.0 | ~53K | Customer.io, Lemon.io, ClickUp Brain (упоминания в reviews) | Graph и analytics только от Pro ($249); единая SaaS-точка отказа |
| **Letta** (бывш. MemGPT, letta-ai/letta) | Hierarchical: core/recall/archival (тиражируется OS-метафорой) | Да (Docker + Postgres+pgvector) | Letta Cloud (free dev tier + usage-based) | Через OpenAI-compatible (любой proxy) | Apache 2.0 | ~19K (по форумным сводкам) | Amazon Aurora ref-case, академические демо | Очень многословный системный промпт; высокая latency из-за «всё через LLM» |
| **Zep (SaaS)** | Temporal knowledge graph (Graphiti) | Только через Graphiti core (Community Edition deprecated 04/2025) | Flex $25/mo, Pro tier выше; credit-based | Только через OpenAI-compatible (default — OpenAI) | Closed (SaaS) + Graphiti Apache 2.0 | ~3K (зеркало) | TrustCall, ряд продуктов в гайдах | SaaS-only сейчас; данные за периметром |
| **Graphiti** (getzep/graphiti) | Temporal knowledge graph (bi-temporal: valid_at + invalid_at) | Да (Neo4j 5.26 / FalkorDB 1.1.2 / Kuzu 0.11.2) | Бесплатно (OSS) | Через OpenAI-compatible | Apache 2.0 | ~14K | Используется Zep Cloud под капотом | Defaults OpenAI; нужен внешний graph DB; вычислительно дороже vector |
| **Cognee** (topoteretes/cognee) | Hybrid: vector + knowledge graph (subj-rel-obj) + relational; pipeline `add → cognify → search` | Да (Docker Compose, Dokploy 1-click) | Cloud (managed) + OSS бесплатный | Через OpenAI-compatible + Ollama; явные туториалы под локальный LLM | Apache 2.0 | ~12K | Bayer (10K научных статей), Knowunity (40K студентов), Univ. of Wyoming; 70+ компаний по словам команды | Молодой API, ломающие изменения между минорами |
| **Memori** (GibsonAI/memori) | SQL-native (Postgres/MySQL/SQLite) + entity/relations + retrieval по SQL | Да (одна Python-зависимость + БД) | Бесплатно (OSS); enterprise — у Memori Labs | Через любой LLM SDK: OpenAI/Anthropic/LangChain/LiteLLM | Apache 2.0 | растущий (анонсирован 09/2025) | Внутренние сценарии GibsonAI; CRM/support по словам команды | Новый проект; нет графа знаний (плоский SQL); ставка на «без векторов вообще» спорная для RAG |
| **Supermemory** (supermemoryai/supermemory) | Hybrid: vector + user profile + connectors; «memory as API» | Self-host только на Enterprise-плане | Free 1M токенов / 10K queries; платные плагины и Pro | OpenAI-compatible API | MIT | ~21.7K | Плагины для Claude Code и OpenCode (заявленный production-fit) | Self-host нельзя без enterprise-соглашения; инфра привязана к Cloudflare Workers/DO |
| **LlamaIndex memory** | Memory primitives: `Memory`, `VectorMemory`, `ChatSummaryMemoryBuffer`, `SimpleComposableMemory` | Да (живёт в Python-приложении) | Бесплатно | Любой LLM/embedder, который понимает LlamaIndex | MIT | LlamaIndex core ~38K | Тысячи продуктов на LlamaIndex; редко используется отдельно | Это «кирпичики», не готовый сервис; ChatMemoryBuffer deprecated |
| **LangChain / LangGraph memory + LangMem SDK** | Short-term (thread state) + long-term cross-thread store; namespace per user/org | Да (Postgres/Redis/MongoDB backends) | Бесплатно (LangSmith — отдельный SaaS) | Любой LLM через LangChain provider | MIT | LangChain ~95K, LangGraph ~10K, LangMem ~1K | MongoDB и Redis-кейсы Lang* | LangMem p95 latency на LoCoMo ~59.82s — медленно vs Mem0/Zep |
| **A-MEM** (agiresearch/A-mem) | Agentic memory с Zettelkasten-эволюцией (атомные ноты + автосвязи + обновление существующих) | Да (research-код, Python) | — (research) | Любой LLM | MIT (research) | ~1.5K | NeurIPS 2025 paper, академические демо | Research-quality код, нет SLA/доков для prod |
| **MemoryBank** | Episodic + Ebbinghaus forgetting curve | Да (research-код) | — | Любой LLM | Research | малый | Используется в обзорах, прод-нет | Псевдо-биологическая модель забывания не валидирована в проде |
| **MemoryOS** (BAI-LAB/MemoryOS) | Three-tier hierarchical (short/mid/long), 4 модуля: storage/update/retrieval/generation | Да (research-репо) | — | Любой LLM | Apache 2.0 (research) | малый, ~1K | EMNLP 2025 Oral, демо в playground | Прод-зрелости нет, скорее «как делать самим» |
| **MemTree** | Hierarchical tree memory, dynamic aggregation operation | Да (research-код) | — | Любой LLM | Research | малый | ICLR 2025 | То же — research-уровень |

> Stars указаны приблизительно по состоянию на май 2026 (обзоры Atlan/Vectorize/MachineLearningMastery 2026). У growing-проектов сверяй GitHub перед закупкой решения.

---

## 6.2. Глубокий разбор по каждому

### 6.2.1. Mem0 (mem0ai/mem0)

- **Описание.** «Universal memory layer for AI Agents» — самый ходовой drop-in. Один-двумя строками подключается к OpenAI/Anthropic/LangChain/LlamaIndex SDK и добавляет долгосрочную память (semantic, episodic, procedural). Выпустила Series A на $24M (Mem0 blog).
- **Тип памяти, архитектура.** Hybrid. Под капотом OSS-дистрибутива: API-сервер (FastAPI), Postgres с pgvector для эмбеддингов, Neo4j (или альтернатива — Memgraph, Kuzu, Apache AGE) для графа. SDK v2.0.0 (16.04.2026) добавил single-pass extraction (1 LLM call на `add()`, ~50% выигрыша по latency) и гибридный retrieval = semantic + BM25 + entity-graph boosting.
- **Self-host инструкция.** Три Docker-контейнера (`api`, `pgvector`, `neo4j`). Запускается без клонирования репозитория — три файла в новой папке + `docker compose up`. По умолчанию вызывает OpenAI на каждое memory-event, но это переопределяется конфигом — можно подсунуть локальный Ollama или OpenAI-compatible прокси. Важно следить за размерностью эмбеддингов (`text-embedding-3-small` = 1536, `nomic-embed-text` = 768, mismatched dimensions ломают insert).
- **Цена.** Hobby (free, 10K memories), Starter $19/mo, Pro $249/mo (тут включается graph memory и analytics — главный шлагбаум), Enterprise — custom (on-prem, SSO, HIPAA BAA, SLA). Стартапы под $5M funding — 3 месяца Pro бесплатно.
- **Поддержка русского / GigaChat / YandexGPT.** Прямой поддержки нет, но любой OpenAI-compatible endpoint работает: подвешиваем LiteLLM-прокси (или внутренний `proxy.agent-lia.ru`), мапим GigaChat/YandexGPT. Embeddings — независимо: на стороне vector store можно держать `Giga-Embeddings-instruct` или `bge-m3`.
- **Производственные использования.** Заявленные кейсы (по отзывам и обзорам Atlan/MachineLearningMastery): персонализация в SaaS (Customer.io-подобные сценарии), coding agents, customer support. По бенчмарку LoCoMo Mem0 даёт ~66.9% accuracy при p95 latency ~1.44s (по их же отчёту 2026).
- **Подводные камни.**
  1. Graph и analytics только от Pro ($249) — в Starter получаешь по сути vector-only.
  2. Бенчмарк-войны: Zep оспаривает заявленные SOTA-цифры (см. Zep blog «Lies, Damn Lies, Statistics»).
  3. Self-host считается у команды «вторичной задачей» — поддержка в issues медленнее, чем у Mem0 Cloud.
  4. Single-pass extraction экономит latency, но плодит шумные «memories» — нужны явные правила распада/forget.

### 6.2.2. Letta (бывший MemGPT, letta-ai/letta)

- **Описание.** «Платформа для stateful-агентов». Родилась из MemGPT-paper UC Berkeley Sky Computing Lab; в 2024 ребрендировалась в Letta. Идея — память как операционная система: всё, что не в контекстном окне, лежит на «диске», а агент сам решает, что подгружать через tool-calls.
- **Тип памяти, архитектура.** Три уровня: **Core** (мини-блок в контексте, как RAM), **Recall** (поисковая история диалога, как disk cache), **Archival** (долгое хранение, агент достаёт tool-вызовом). Letta ADE — графический интерфейс для управления агентами; коннектится к локальному серверу через REST.
- **Self-host инструкция.** `docker compose` с `letta/letta:latest` + Postgres с расширением pgvector (`pgvector/pgvector:pg16`). Подключение к собственной БД через `LETTA_PG_URI`. На Railway разворачивается за один клик; продакшен — Amazon Aurora PostgreSQL (есть кейс на AWS Database blog).
- **Цена.** OSS бесплатный, Letta Cloud — usage-based. На Railway инфра ~$5-10/mo + LLM-токены.
- **Поддержка русского / GigaChat / YandexGPT.** Любой OpenAI-compatible endpoint — через свою конфигурацию модели. Letta агрессивно использует tool-calls, поэтому модель должна уметь function calling в OpenAI-формате (GigaChat-функции и YandexGPT-функции поддерживаются, но проверять контрактом).
- **Производственные использования.** AWS-blog кейс с Aurora; Letta Code — заявлен как #1 model-agnostic open-source agent на Terminal-Bench. По LoCoMo: 74.0% accuracy с GPT-4o-mini (выше Mem0 68.5% по их же замерам).
- **Подводные камни.**
  1. **Стоимость инференса.** Каждое memory-event — это LLM-call (часто несколько). Под Claude/GPT — кусается; под локальный Qwen-72B нужен жирный GPU.
  2. **Latency.** Многоступенчатый pipeline = ощутимая задержка ответа.
  3. **Сложность отладки.** Память «непрозрачная» — то, что агент решил записать в archival, не всегда совпадает с тем, что нужно бизнесу. Memory decisions inherit LLM opacity (Letta forum).
  4. Под Postgres нужен pgvector — это лимитирует выбор managed-DB (Yandex Managed Postgres pgvector умеет — ОК).

### 6.2.3. Zep (SaaS) — getzep/zep

- **Описание.** Коммерческая memory-платформа поверх собственного движка Graphiti. Позиционирует себя как «turnkey enterprise-grade temporal memory» — память с пониманием «что было правдой когда».
- **Тип памяти, архитектура.** Temporal knowledge graph: каждый факт хранится с timestamp и `valid_at`/`invalid_at`-полями. Если пользователь сказал «я переехал из Лондона в Токио» — Zep инвалидизирует «Лондон=текущий» и добавляет «Токио=текущий», а не складирует оба факта как «релевантные».
- **Self-host инструкция.** **Не поддерживается:** Zep Community Edition deprecated в апреле 2025, дополнительные ретирэйменты — февраль 2026. Альтернатива — взять Graphiti отдельно (см. 6.2.4).
- **Цена.** Flex $25/mo, выше — credit-based; все фичи доступны на всех тарифах, ограничение по объёму. Дешевле Mem0 Pro ($249) при ограниченном объёме.
- **Поддержка русского / GigaChat / YandexGPT.** В SaaS — нет прямой настройки своего LLM (default OpenAI). Под РФ не подходит как SaaS.
- **Производственные использования.** Используется в нескольких publicly-listed AI-стартапах за рубежом; LoCoMo — Zep заявляет 75.14% ± 0.17, +10% к Mem0; LongMemEval — 63.8% vs Mem0 49.0%. Сам Zep тоже подвергался ревизии (см. issue в zep-papers/#5 с альтернативной оценкой 58.44%).
- **Подводные камни.**
  1. SaaS-only сегодня. Для РФ — стоп-фактор.
  2. Документация сильно перепутывается с Graphiti (open-source ядром).
  3. По отзывам — SaaS «under development», не feel-polished.

### 6.2.4. Graphiti (getzep/graphiti) — open-source ядро Zep

- **Описание.** OSS-фреймворк для построения temporally-aware context graphs. Каждый «факт» — это ребро с двумя датами (`valid_at`, `invalid_at`); граф автоматически инвалидизирует устаревшее на основе новых high-confidence фактов.
- **Self-host инструкция.** Поддерживает Neo4j 5.26+, FalkorDB 1.1.2+, Kuzu 0.11.2+. Простейший вариант — `docker run` FalkorDB (порт 6379 — Redis-protocol, порт 3000 — web UI). **Важно:** официальный `zepai/graphiti:latest` Docker image на момент октября 2025 поддерживает только Neo4j — для FalkorDB нужен `docker-compose` со своим dockerfile или форк `FalkorDB/graphiti`.
- **Цена.** Бесплатно (Apache 2.0).
- **Поддержка русского / GigaChat / YandexGPT.** Defaults OpenAI, но `graphiti-core` принимает любой LLM-клиент через стандартный интерфейс — подкладываешь обёртку под GigaChat / YandexGPT / прокси. Для embeddings — то же самое.
- **Производственные использования.** Само ядро Zep Cloud, плюс независимые продукты с temporal-памятью; для проекта Z — отличный кандидат на «темпоральный слой для AI-встреч», потому что встречи как раз про факты с датами.
- **Подводные камни.**
  1. Vendor lock на graph DB — нужно оперировать Neo4j/FalkorDB/Kuzu в проде.
  2. Дороже vector-only по compute (каждая запись — LLM-extract + graph update).
  3. Defaults тянут OpenAI — без замены конфига будет утечка за периметр.

### 6.2.5. Cognee (topoteretes/cognee)

- **Описание.** «Memory control plane for AI Agents in 6 lines of code» — local-first knowledge engine. Pipeline `.add()` → `.cognify()` → `.search()` с автостроением knowledge graph + embeddings.
- **Тип памяти, архитектура.** Hybrid: vector store + knowledge graph (subject-relation-object) + relational metadata. Pluggable: для графа — Neo4j / FalkorDB / KuzuDB / NetworkX; для векторов — Qdrant / Weaviate / Redis; для relational — SQLite / Postgres.
- **Self-host инструкция.** Docker Compose (Dokploy 1-click) с Postgres+pgvector в production-ready конфиге. Есть туториалы под Ollama (полностью локальный LLM).
- **Цена.** OSS бесплатно; есть Cognee Cloud (managed) для тех, кто не хочет держать стек.
- **Поддержка русского / GigaChat / YandexGPT.** Через OpenAI-compatible (рекомендуется LiteLLM-прокси). Команда явно демонстрирует Ollama-setup, что хорошо коррелирует с РФ-сценариями self-host.
- **Производственные использования.** Bayer (10K научных статей в research-memory), Knowunity (40K студентов, POC за 2 дня), University of Wyoming. Сам Cognee называет «70+ компаний в проде» (требует проверки).
- **Подводные камни.**
  1. API молодой, ломающие изменения между минорами — нужно пиннить версию.
  2. `cognify` — это многоступенчатый LLM-pipeline; стоимость может прыгать при больших корпусах.
  3. Доки разбросаны: README, docs.cognee.ai, блог — иногда расходятся.

### 6.2.6. Memori (GibsonAI/memori)

- **Описание.** «SQL-native memory engine for LLMs». Запуск — `memori.enable()`, всё хранится в стандартной SQL-БД (SQLite/Postgres/MySQL).
- **Тип памяти, архитектура.** Entity extraction + relationship mapping + SQL-based retrieval. Без векторного индекса по дефолту — ставка на полную транспарентность («каждое решение memory можно объяснить SQL-запросом»).
- **Self-host инструкция.** Чистая Python-зависимость + любая SQL-БД. Подходит для air-gapped-сценариев.
- **Цена.** OSS бесплатно. Enterprise — отдельный коммерческий тенант от MemoriLabs.
- **Поддержка русского / GigaChat / YandexGPT.** Интегрируется с OpenAI, Anthropic, LiteLLM, LangChain — поэтому добавить GigaChat-обёртку нетрудно. Embedder не обязателен (для core flow).
- **Производственные использования.** CRM-агенты, e-commerce, customer support (по заявлениям команды). LoCoMo: 81.95% overall accuracy при средних 1294 токенах на query (превосходит Zep, LangMem, Mem0 в их же бенчмарках; цифру проверять).
- **Подводные камни.**
  1. Очень молодой проект (сентябрь 2025).
  2. Отказ от векторов — палка о двух концах: дёшево, но семантический поиск ограничен SQL FTS/триграммами и LLM-rerank.
  3. Нет графа знаний — для cross-entity reasoning придётся надстраивать что-то отдельно.
  4. Бенчмарки от команды — проверять.

### 6.2.7. Supermemory (supermemoryai/supermemory)

- **Описание.** «Memory API for the AI era». Сильнее всего нацелен на coding agents (Claude Code, OpenCode, OpenClaw, Hermes) — есть готовые плагины.
- **Тип памяти, архитектура.** Vector store + user profile + connectors. Инфра — Cloudflare Workers + Durable Objects + Postgres+pgvector. SSE для real-time, MCP-сервер с per-user изоляцией через URL.
- **Self-host инструкция.** **Только на Enterprise-плане** (full air-gapped) — для остальных это SaaS. Открытый репозиторий — да (MIT), но «full self-host requires enterprise agreement». Это полу-open-source.
- **Цена.** Free 1M токенов / 10K queries, дальше Pro и Enterprise.
- **Поддержка русского / GigaChat / YandexGPT.** Через OpenAI-compatible API.
- **Производственные использования.** Claude Code-плагин (context injection на старте сессии, авто-сохранение фактов через «remember»/«save this») — фактически production-пример. $2.6M seed от Google и Cloudflare execs.
- **Подводные камни.**
  1. **Self-host под коммерческий продукт в РФ — стоп-фактор:** требуется enterprise-договор с американской компанией.
  2. Инфра привязана к Cloudflare-стеку — повторить «на коленке» нетривиально.
  3. Заточен под dev-tools, для бизнес-памяти компании понадобится много обвязки.

### 6.2.8. LlamaIndex memory modules

- **Описание.** Не отдельный продукт, а набор примитивов внутри LlamaIndex (Python framework).
- **Тип памяти, архитектура.** Четыре класса: `ChatMemoryBuffer` (sliding window, deprecated в пользу `Memory`), `VectorMemory` (поиск по embeddings прошлых сообщений), `ChatSummaryMemoryBuffer` (LLM-суммаризация истории), `SimpleComposableMemory` (комбинирует первичный буфер + вторичные источники).
- **Self-host инструкция.** Это Python-библиотека — деплоится вместе с приложением. Внешний store берётся отдельно (любой LlamaIndex-совместимый).
- **Цена.** Бесплатно (MIT).
- **Поддержка русского / GigaChat / YandexGPT.** Любой LLM/embedder, у которого есть обёртка для LlamaIndex (GigaChat — через `langchain_gigachat` или прямую интеграцию).
- **Производственные использования.** LlamaIndex как ядро в тысячах продуктов; memory-модули — обычно одна из частей.
- **Подводные камни.**
  1. Это кирпичики, а не сервис — нужно собрать самим всё, что в Mem0/Letta «из коробки».
  2. `ChatMemoryBuffer` deprecated — следить за миграционным гайдом на новый `Memory`.
  3. Интеграция с Mem0 (`llama-index-memory-mem0`) есть, но это уже Mem0 под капотом — не «своё».

### 6.2.9. LangChain memory / LangGraph memory + LangMem SDK

- **Описание.** Три слоя внутри Lang*-экосистемы: устаревший `ConversationBufferMemory` (LangChain v0.x), новый LangGraph long-term memory store (cross-thread), отдельная **LangMem SDK** для извлечения и обновления long-term фактов.
- **Тип памяти, архитектура.** Short-term — состояние внутри одного thread (LangGraph state). Long-term — JSON-документы с namespace-моделью (user_id / org_id / shared); поиск по содержимому. Backends: Postgres / Redis / MongoDB.
- **Self-host инструкция.** Часть Python-приложения; store — любой из поддерживаемых backend.
- **Цена.** Бесплатно (MIT). LangSmith (наблюдаемость) — отдельный SaaS, не обязателен.
- **Поддержка русского / GigaChat / YandexGPT.** Любой LangChain LLM-провайдер (`langchain_gigachat` есть в community).
- **Производственные использования.** Все, кто на LangGraph; MongoDB-кейсы; Redis Stack — оф. интеграция.
- **Подводные камни.**
  1. **LangMem p95 latency на LoCoMo ~59.82 секунды** — для интерактивных агентов медленно. Mem0 ~200ms, Zep <200ms на их LoCoMo-сцене.
  2. Сильно завязан на Lang*-экосистему — выходить из неё дорого.
  3. Memory «правильно» работает только при явном persistent store; in-memory — теряется между сессиями.

### 6.2.10. A-MEM (agiresearch/A-mem)

- **Описание.** Research-фреймворк (NeurIPS 2025). Идея — agentic memory с Zettelkasten-эволюцией: каждая новая «нота» получает контекстное описание + ключевые слова + теги, потом находит связи с историей, и может ОБНОВЛЯТЬ существующие ноты.
- **Тип памяти, архитектура.** Episodic + semantic с dynamic linking. Без жёстких таблиц/схем.
- **Self-host.** Research-код, Python-скрипты — не production-ready.
- **Цена.** —
- **Поддержка русского / GigaChat / YandexGPT.** Любой LLM (research-код).
- **Производственные использования.** Нет (academic-baseline). Идея проникает в Mem0/A-MEM-подобные модули.
- **Подводные камни.** Это не библиотека для прода, а воспроизводимый эксперимент.

### 6.2.11. MemoryBank

- **Описание.** Research-фреймворк, использующий **кривую забывания Эббингауза** для адаптации силы памяти со временем. Rule-based updating.
- **Тип памяти, архитектура.** Episodic, с временным затуханием.
- **Self-host / цена / RU LLM.** Research-код, любой LLM.
- **Production refs.** Нет.
- **Подводные камни.** Псевдо-биологические модели забывания (Эббингауз) не имеют чёткой валидации в LLM-сценариях.

### 6.2.12. MemoryOS (BAI-LAB/MemoryOS) — EMNLP 2025 Oral

- **Описание.** «Memory operating system» для персонализированных AI-агентов: три уровня хранения (short / mid / long) + четыре функциональных модуля (storage, updating, retrieval, generation).
- **Тип памяти, архитектура.** Three-tier: short→mid через dialogue-chain FIFO, mid→long через segmented page organization.
- **Self-host.** Research-репозиторий, Apache 2.0.
- **Производственные использования.** EMNLP-oral, playground в репо. По LoCoMo с GPT-4o-mini: +49.11% F1, +46.18% BLEU-1 к baseline.
- **Подводные камни.** Прод-зрелости нет, скорее источник архитектурных идей.

### 6.2.13. MemTree (ICLR 2025)

- **Описание.** Tree-structured memory — иерархия с разными уровнями абстракции. Алгоритм «Aggregate Operation» поручает LLM сжимать и обобщать информацию при записи в parent-узел.
- **Тип памяти.** Hierarchical aggregation.
- **Self-host / Production.** Research-код, нет прод-применений.
- **Подводные камни.** Хорошая идея для архивации длинных диалогов; в чистом виде не закроет corporate memory.

---

## 6.3. Матрица применимости (тип задачи × фреймворк)

Легенда: ✓ — хорошо подходит, ◑ — частично подходит / с обвязкой, ✗ — не подходит.

| Задача / Фреймворк | Mem0 | Letta | Zep SaaS | Graphiti | Cognee | Memori | Supermemory | LlamaIndex | LangMem | A-MEM | MemoryOS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **1. Простой Q&A по корпусу** (RAG-style) | ◑ (overkill, но работает) | ✗ (тяжеловесен) | ✗ | ◑ | ✓ (с `cognify`) | ◑ (без векторов слабо) | ✓ | ✓ | ◑ | ✗ | ✗ |
| **2. Длинный диалог с историей** (long context) | ✓ | ✓✓ (родная задача — это MemGPT-paper) | ✓ | ◑ | ✓ | ✓ | ✓ | ◑ (нужен ComposableMemory) | ◑ (медленно) | ◑ | ✓ (заточен под это) |
| **3. Многосессионная память пользователя** (cross-session) | ✓✓ (родная задача) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◑ | ✓ | ✓ | ✓ |
| **4. Корпоративная память (cross-user, attribution, atribute «кто сказал»)** | ✓ (user/session/agent scopes) | ◑ (нужны кастомные tools) | ✓ (родная задача — temporal graph) | ✓✓ | ✓✓ (KG + relational) | ✓ (SQL-родное) | ◑ | ◑ | ✓ (namespace-модель) | ✗ | ✗ |
| **5. Кросс-агентная shared memory** | ◑ | ✓ (Conversations API заявлен) | ✓ | ✓ | ✓ | ✓ | ◑ | ◑ | ✓ | ✗ | ✗ |
| **6. Temporal-aware (что было правдой когда)** | ◑ (graph есть, темпоральных полей нет) | ✗ | ✓✓ | ✓✓ | ◑ | ◑ | ✗ | ✗ | ◑ | ✗ | ◑ |
| **7. Memory для coding-агентов (Claude Code)** | ◑ | ◑ | ◑ | ◑ | ◑ | ◑ | ✓✓ (есть плагины) | ◑ | ◑ | ✗ | ✗ |
| **8. Personalization при низкой latency (<300ms)** | ✓ (~200ms p95) | ✗ (медленно из-за LLM-tool-calls) | ✓ (<200ms по заявлению) | ◑ | ◑ | ✓ (SQL быстр) | ✓ | ◑ | ✗ (~60s p95 LangMem) | ✗ | ✗ |

---

## 6.4. Готовность к РФ-деплою

### Критерии под РФ-self-host (специфика проекта Z)

1. **Self-host без иностранного контракта** — у нас периметр в РФ.
2. **LLM подключается через OpenAI-compatible** — у Z есть `proxy.agent-lia.ru` под Claude Sonnet, и нужно уметь подсунуть GigaChat / YandexGPT под некритичные задачи.
3. **Embedder можно подменить на русскоязычный** (`Giga-Embeddings-instruct`, `bge-m3`) с матчингом размерности.
4. **Persdata-compliance (ФЗ-152)** — данные не уезжают; логи и аналитика — внутри контура.
5. **Хорошая поддержка Postgres** — у Z уже основной storage Postgres (через Prisma + db push).

### Топ-3 фреймворка для self-host в РФ

#### 1. Cognee — лучший «всё-в-одном» под self-host
- Apache 2.0, явно поддерживает Ollama и OpenAI-compatible.
- Pluggable storage: можно сразу взять Postgres+pgvector для всего (вектор + relational), Neo4j или Kuzu для графа.
- Pipeline `.add` / `.cognify` / `.search` хорошо ложится на бизнес-логику «AI-встреча → транскрипт → структура».
- Минус: API нестабильный (молодой проект), нужно пиннить версию.

#### 2. Mem0 OSS + кастомный LLM-провайдер — лучший drop-in под персонализацию
- Apache 2.0, три Docker-контейнера, опыт сообщества огромный.
- Совместимость с pgvector — у нас уже есть Postgres-инфра.
- Можно начать с Mem0 OSS для user-level памяти, поверх докрутить Graphiti для temporal-слоя встреч.
- Минус: graph и analytics только от Pro ($249) — но в OSS-варианте они доступны при self-host (нужен Neo4j/Memgraph/Kuzu/Apache AGE).

#### 3. Memori (GibsonAI) — лучший минимально-зависимый вариант
- Apache 2.0, чистый SQL — никаких векторов и графов под капотом по дефолту.
- Идеально, если хочется радикально упростить стек и держать ВСЁ в Postgres.
- Минус: молодой (с сентября 2025), без графа теряем cross-entity reasoning, бенчмарки от команды — проверять.

### Что НЕ подходит для РФ-периметра

- **Zep SaaS** — Community Edition deprecated, остался только Cloud за рубежом.
- **Supermemory** — full self-host только на Enterprise-контракте с американской компанией, инфра привязана к Cloudflare.
- **Mem0 Cloud** — данные за рубежом + защищать ФЗ-152 нечем.

### Letta — отдельно

Letta technically self-hostable и хорошо документирована (Docker + Postgres+pgvector), но **дорогая по LLM-токенам**: каждое memory-event — несколько LLM-call. Для проекта Z с десятками одновременных встреч это нагрузка на `proxy.agent-lia.ru` и компании-биллинг по Claude. Брать осознанно, под сценарии «сложный длинный stateful-агент» (например, AI-аналитик встреч), а не как универсальный слой.

---

## 6.5. Гибридные паттерны (vector + graph + episodic)

Реальные стеки в проде обычно комбинируют несколько подходов.

### Паттерн A. «Mem0 + Graphiti» — vector personalization + temporal graph

- **Что хранит Mem0:** semantic facts о пользователе / организации (предпочтения, имена, корпоративные термины). Быстрый вектор-retrieval.
- **Что хранит Graphiti:** временные факты бизнес-сущностей (статусы клиентов, решения встреч, изменения проектов). Bi-temporal граф.
- **Когда брать:** SaaS, где есть и личные предпочтения, и факты бизнеса со временем. Точно — кейс Z (AI-встречи).
- **Минус:** два хранилища, два LLM-pipeline. Дороже по вычислениям.

### Паттерн B. «Cognee единым стеком»

- Cognee выступает и vector store, и graph engine, и pipeline-оркестратором.
- **Когда брать:** хочется одну точку интеграции и максимально простое DevOps.
- **Минус:** меньше контроля над каждым слоем; молодой API.

### Паттерн C. «LangGraph state + LangMem + Postgres long-term» — для тех, кто уже на LangChain

- Short-term — внутри LangGraph state (thread).
- Long-term — LangMem SDK + Postgres backend.
- Опционально — Graphiti для temporal-задач.
- **Когда брать:** агенты уже написаны на LangGraph, memory — расширение, а не замена.
- **Минус:** latency LangMem на LoCoMo ~60s p95 — не для real-time.

---

## 6.6. Выводы для Z

### Что в Z уже есть

- **Postgres + Prisma** (через `db push`) — родная инфра для pgvector и для SQL-памяти.
- **Anthropic Claude Sonnet через `proxy.agent-lia.ru`** — основной LLM. Любой OpenAI-compatible framework подключается легко.
- **ASR — Vox/GigaAM (фиксировано)** — transcripts на русском с разделением спикеров.
- **AI-отчёт по типу встречи** — уже формирует структурированные артефакты, которые можно подать в memory как distilled-слой (см. wiki-pattern Карпаты в `second-brain-approach-research.md`).

### Базовый стек «второго мозга» для Z (MVP, 2-3 месяца)

1. **Mem0 OSS (Docker, 3 контейнера)** в self-host на собственной ноде:
   - Postgres+pgvector — уже есть (можно отдельная схема `mem0_*`).
   - Neo4j Community или Apache AGE — для graph layer.
   - Mem0 API — обёртка над всем.
2. **Embedder = `ai-sage/Giga-Embeddings-instruct`** (через TGI/vLLM-обёртку с OpenAI-compatible endpoint).
   - Если не получится развернуть быстро — `BAAI/bge-m3` как мультиязычный fallback (доступен на HuggingFace).
3. **LLM для memory-операций = Claude Sonnet через `proxy.agent-lia.ru`** для критичных задач (extract / summarize / contradiction-resolve); GigaChat-Lite — для дешёвых классификаций.
4. **Темпоральный слой (фаза 2):** Graphiti поверх FalkorDB (легче эксплуатировать, чем Neo4j Enterprise) — для трекинга «что обсуждали в марте» vs «что обсуждали в мае».
5. **distill-pipeline:** AI-отчёт встречи → распиливается на атомные «memories» с тегами (owner, participants, decisions, action_items) → пишется в Mem0 в соответствующих scope (`user`, `org`).

### Альтернатива «всё-в-одном» (если жалко DevOps)

**Cognee OSS** + Postgres+pgvector + локальный embedder. Один pipeline `.add → .cognify → .search`. Меньше движущихся частей, ниже порог входа, но больше зависимость от молодого проекта.

### Что точно НЕ брать

- **Zep SaaS** — закрыт для self-host.
- **Supermemory full self-host** — только enterprise-договор.
- **LangMem как primary** — latency не позволяет real-time.

### Открытые вопросы

1. Развернуть `Giga-Embeddings-instruct` через TGI/vLLM с OpenAI-compatible endpoint — есть ли готовый docker-recipe, или придётся делать самим.
2. Проверить cost-modeling Mem0 в self-host: сколько LLM-токенов уходит на 1 встречу 60 мин при single-pass extraction.
3. Решить: graph storage — Neo4j Community Edition (зрелость) или FalkorDB (легче деплой) или Apache AGE (вообще без отдельного движка, поверх Postgres).
4. Параллельно отслеживать Memori — если за полгода стабилизируется, SQL-native подход уберёт треть инфры.

---

## Источники

### Основные обзоры и сравнения
1. [Best AI Agent Memory Frameworks in 2026 — Atlan](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
2. [The 6 Best AI Agent Memory Frameworks — MachineLearningMastery](https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/)
3. [Mem0 vs Letta — Vectorize](https://vectorize.io/articles/mem0-vs-letta)
4. [Mem0 vs Zep — Vectorize](https://vectorize.io/articles/mem0-vs-zep)
5. [Zep vs Cognee — Vectorize](https://vectorize.io/articles/zep-vs-cognee)
6. [Best Mem0 Alternatives — Atlan](https://atlan.com/know/mem0-alternatives/)
7. [Best LlamaIndex Memory Alternatives — Vectorize](https://vectorize.io/articles/llamaindex-memory-alternatives)
8. [Best SuperMemory Alternatives — Vectorize](https://vectorize.io/articles/supermemory-alternatives)
9. [5 AI Agent Memory Systems Compared — DEV Community](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)
10. [Comparison of AI Agent Memory Systems 2026 — n1n.ai](https://explore.n1n.ai/blog/ai-agent-memory-comparison-2026-mem0-zep-letta-cognee-2026-04-23)
11. [Agent memory: Letta vs Mem0 vs Zep vs Cognee — Letta Forum](https://forum.letta.com/t/agent-memory-letta-vs-mem0-vs-zep-vs-cognee/88)
12. [State of AI Agent Memory 2026 — Mem0 blog](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
13. [Lies, Damn Lies, Statistics: Is Mem0 Really SOTA — Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
14. [From Beta to Battle-Tested: Letta, Mem0, Zep — Medium](https://medium.com/asymptotic-spaghetti-integration/from-beta-to-battle-tested-picking-between-letta-mem0-zep-for-ai-memory-6850ca8703d1)
15. [Agent Memory Infrastructure on GPU Cloud — Spheron Blog](https://www.spheron.network/blog/agent-memory-gpu-cloud-mem0-zep-guide/)

### Mem0
16. [GitHub — mem0ai/mem0](https://github.com/mem0ai/mem0)
17. [Mem0 Pricing](https://mem0.ai/pricing)
18. [Self-Hosting Mem0: Docker Deployment Guide](https://mem0.ai/blog/self-host-mem0-docker)
19. [Mem0 Self-Hosted Setup Docs](https://docs.mem0.ai/open-source/setup)
20. [Mem0 Changelog Highlights](https://docs.mem0.ai/changelog/highlights)
21. [Mem0 raises $24M Series A](https://mem0.ai/series-a)

### Letta / MemGPT
22. [GitHub — letta-ai/letta](https://github.com/letta-ai/letta)
23. [Deploy a Letta server with Docker](https://docs.letta.com/guides/docker)
24. [MemGPT is now part of Letta](https://www.letta.com/blog/memgpt-and-letta)
25. [How Letta builds production-ready AI agents with Aurora — AWS](https://aws.amazon.com/blogs/database/how-letta-builds-production-ready-ai-agents-with-amazon-aurora-postgresql/)
26. [Benchmarking AI Agent Memory — Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)
27. [Letta Database configuration](https://docs.letta.com/guides/docker/postgres/)

### Zep / Graphiti
28. [GitHub — getzep/graphiti](https://github.com/getzep/graphiti)
29. [Graphiti Neo4j Configuration](https://help.getzep.com/graphiti/configuration/neo-4-j-configuration)
30. [Graphiti FalkorDB Configuration](https://help.getzep.com/graphiti/configuration/falkor-db-configuration)
31. [Graphiti Open Source — Zep](https://www.getzep.com/product/open-source/)
32. [Issue: Official Docker doesn't support FalkorDB](https://github.com/getzep/graphiti/issues/749)
33. [Graphiti — FalkorDB Fork](https://github.com/FalkorDB/graphiti)

### Cognee
34. [GitHub — topoteretes/cognee](https://github.com/topoteretes/cognee)
35. [Cognee Architecture — official blog](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory)
36. [Self-Hosting Cognee with Dokploy or Docker Compose — Bitdoze](https://www.bitdoze.com/cognee-self-host/)
37. [Cognee Use Cases](https://docs.cognee.ai/use-cases)
38. [Cognee Deployment Overview](https://docs.cognee.ai/how-to-guides/cognee-sdk/deployment)
39. [Building 100% local AI memory with Cognee — DEV Community](https://dev.to/chinmay_bhosale_9ceed796b/cognee-with-ollama-3pp8)

### Memori
40. [GitHub — GibsonAI/memori](https://github.com/GibsonAI/memori)
41. [Introducing Memori — MemoriLabs blog](https://memorilabs.ai/blog/introducing-memori-the-open-source-memory-engine-for-ai-agents)
42. [Memori Release — MarkTechPost](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/)
43. [SQL Memory for AI Agents — Neurotechnus](https://neurotechnus.com/2025/09/09/sql-memory-ai-agents/)

### Supermemory
44. [GitHub — supermemoryai/supermemory](https://github.com/supermemoryai/supermemory)
45. [Supermemory Pricing](https://supermemory.ai/pricing/)
46. [Supermemory Self-Hosting docs](https://supermemory.ai/docs/deployment/self-hosting)
47. [GitHub — supermemoryai/claude-supermemory](https://github.com/supermemoryai/claude-supermemory)
48. [GitHub — supermemoryai/opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory)
49. [We added supermemory to Claude Code — Supermemory blog](https://supermemory.ai/blog/we-added-supermemory-to-claude-code-its-insanely-powerful-now/)

### LlamaIndex / LangChain memory
50. [LlamaIndex Memory Docs](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)
51. [llama-index-memory-mem0 — PyPI](https://pypi.org/project/llama-index-memory-mem0/)
52. [LangGraph Long-Term Memory Support — LangChain blog](https://www.langchain.com/blog/launching-long-term-memory-support-in-langgraph)
53. [LangMem SDK Launch — LangChain](https://www.langchain.com/blog/langmem-sdk-launch)
54. [GitHub — langchain-ai/langmem](https://github.com/langchain-ai/langmem)
55. [Long-Term Memory LangChain Agents — Atlan](https://atlan.com/know/long-term-memory-langchain-agents/)
56. [Powering Long-Term Memory For Agents With LangGraph And MongoDB](https://www.mongodb.com/company/blog/product-release-announcements/powering-long-term-memory-for-agents-langgraph)

### Research papers
57. [A-MEM: Agentic Memory for LLM Agents — arXiv 2502.12110](https://arxiv.org/abs/2502.12110)
58. [GitHub — agiresearch/A-mem](https://github.com/agiresearch/a-mem)
59. [Memory OS of AI Agent — arXiv 2506.06326](https://arxiv.org/abs/2506.06326)
60. [GitHub — BAI-LAB/MemoryOS (EMNLP 2025 Oral)](https://github.com/BAI-LAB/MemoryOS)
61. [Dynamic Tree Memory Representation for LLMs (MemTree) — arXiv 2410.14052](https://arxiv.org/abs/2410.14052)
62. [MemFactory: Unified Inference & Training Framework — arXiv](https://arxiv.org/pdf/2603.29493)

### Multilingual / Russian embeddings
63. [GigaEmbeddings — arXiv 2510.22369](https://arxiv.org/abs/2510.22369)
64. [ai-sage/Giga-Embeddings-instruct — HuggingFace](https://huggingface.co/ai-sage/Giga-Embeddings-instruct)
65. [GigaChat Family — arXiv 2506.09440](https://arxiv.org/html/2506.09440v1)
66. [ruMTEB benchmark and Russian embedding model design](https://arxiv.org/html/2408.12503v1)
67. [Multilingual E5 Text Embeddings: A Technical Report](https://arxiv.org/pdf/2402.05672)
68. [M3-Embedding (BGE-M3) — arXiv 2402.03216](https://arxiv.org/pdf/2402.03216)

### Сравнительные ноутбуки и обучающие материалы
69. [GitHub — NirDiamant/Agent_Memory_Techniques (30 notebooks)](https://github.com/NirDiamant/Agent_Memory_Techniques)
70. [LiteLLM proxy — BerriAI/litellm](https://github.com/BerriAI/litellm)
71. [LiteLLM Docker quick start](https://docs.litellm.ai/docs/proxy/docker_quick_start)

---

_Документ создан 2026-05-20 агентом Branch-6. Раздел 10 второго мозга (Memory frameworks stack) теперь заполнен. Перенос ключевых выводов в `second-brain-approach-research.md` раздел 10 — отдельной задачей синтеза._

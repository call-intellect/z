---
title: "Ветка 5 — GitHub / Open-source ландшафт «второго мозга»"
date: 2026-05-20
type: research
status: draft
distilled: false
---

# Ветка 5 — GitHub / Open-source ландшафт «второго мозга»

> Open-source проекты класса (продукты + плагины + research-импленты), НЕ инфраструктурные фреймворки памяти.
> Инфраструктурные слои (Mem0, Letta, Zep, Cognee, Memori, Supermemory, LlamaIndex/LangChain memory, A-MEM, MemoryBank, MemoryOS, MemTree) — см. [[branch-6-memory-stack]] и [[branch-7-academic]]. Здесь они не повторяются, только дополняются недостающими гранями.
> Дата сборки: 2026-05-20.
> Автор-агент: Branch-5 (GitHub / Open-source).

## 0. Краткое резюме (TL;DR)

- **Продуктовый OSS в категории «второй мозг» делится на три волны:** (i) RAG-чатбот по корпоративному корпусу (PrivateGPT, LocalGPT, DocsGPT) — это «KMS с генерацией ответа», по критериям раздела 2 максимум 2-3 из 6; (ii) self-hosted second-brain платформы (Khoj, AnythingLLM, Quivr) — 3-4 из 6; (iii) Obsidian/Logseq-плагины с AI (Smart Connections, Khoj Obsidian, Smart2Brain, Copilot Obsidian) — 2-4 из 6 (нет multi-tenant, нет surfacing в чистом виде).
- **Топ-3 OSS-кандидата на MVP «второго мозга в Z»:** AnythingLLM (workspace-модель, multi-tenant из коробки, RU LLM через generic OpenAI), Khoj (chat + obsidian-плагин + хороший capture, но привязан к Postgres/sqlite, нет real-time surfacing), Open WebUI с memory-plugins и pipelines.
- **Топ-3 «реально новых архитектурных подхода» (не RAG):**
  1. **Episodic-as-events** — EM-LLM ([em-llm/em-llm](https://github.com/em-llm/em-llm)) сегментация транскрипта по Bayesian surprise. Прямо применимо к встречам Z.
  2. **Self-organizing notes (Zettelkasten + LLM)** — A-MEM ([agiresearch/A-mem](https://github.com/agiresearch/A-mem)) и идеологически близкие Quartz/Smart2Brain плагины — память без жёсткой схемы.
  3. **Bi-temporal world model памяти** — Graphiti + AriGraph ([AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph)) — память как модель среды, а не корпус.
- **Что появилось за последние 6 месяцев и неожиданно зашло:** Onyx (бывш. Danswer) на 20K★ обогнал классику в enterprise-search; Pathway/Reggie вырастил OSS-комбинацию streaming + LLM-память; HelixDB (graph + vector в одной БД) — новый OSS-кандидат для bi-temporal-памяти; PrivateMode (новая волна private-LLM hosting), Self-Operating Computer как пример «активной памяти» для агентов.
- **Что точно НЕ повторять:** PrivateGPT для бизнеса (статус-кво «индексирует PDF и отвечает» — не выходит за пределы RAG), LocalGPT (та же история), классические Notion-clones с AI (нет capture pipeline).
- **Связь с РФ:** AnythingLLM, Khoj, Open WebUI, LibreChat, LobeChat, Continue, Quivr — все работают с любым OpenAI-compatible эндпоинтом, значит совместимы с GigaChat/YandexGPT через прокси. Glean-клоны (Onyx/Danswer) — частично; Bloop — почти нет (Anthropic-only по дефолту).

---

## 5.1. Обзорная таблица всех проектов

Stars указаны по состоянию на май 2026 (порядок величины; перед интеграцией сверять с GitHub).

| Проект | Категория | Stars | Активность (last commit) | Лицензия | RU LLM? | Новый подход? | Класс «второй мозг»? (критерии 1-6) |
|---|---|---|---|---|---|---|---|
| **Khoj** ([khoj-ai/khoj](https://github.com/khoj-ai/khoj)) | продукт (self-host + plugin) | ~17K | активен | AGPL-3.0 | да (OpenAI-compatible) | частично (search-grounded chat + obsidian-bridge) | 4 из 6 (1,2,3,6) |
| **AnythingLLM** ([Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm)) | продукт (self-host) | ~35K | активен | MIT | да (any LLM provider) | нет (классический workspace RAG, но с multi-tenant) | 3-4 из 6 (1,2,3, частично 6) |
| **Open WebUI** ([open-webui/open-webui](https://github.com/open-webui/open-webui)) | UI + memory plugins | ~80K | очень активен | BSD-3 | да (Ollama + OpenAI-compatible) | плагины memory + RAG + pipelines | 3 из 6 (1,2,6) |
| **Continue** ([continuedev/continue](https://github.com/continuedev/continue)) | coding memory (IDE) | ~22K | очень активен | Apache-2.0 | да | специализированный coding-context | вне категории (dev-tool) |
| **Quivr** ([QuivrHQ/quivr](https://github.com/QuivrHQ/quivr)) | продукт (self-host + cloud) | ~37K | замедлился | Apache-2.0 | да | brains-метафора, multi-source capture | 4 из 6 (1,2,3,6) |
| **DocsGPT** ([arc53/DocsGPT](https://github.com/arc53/DocsGPT)) | RAG-чатбот | ~16K | активен | MIT | да | классический RAG | 2 из 6 (1,6) |
| **PrivateGPT** ([zylon-ai/private-gpt](https://github.com/zylon-ai/private-gpt)) | air-gapped RAG | ~55K | поддержка | Apache-2.0 | да (полный local) | air-gap, но архитектурно RAG | 2 из 6 (1, частично 2) |
| **LocalGPT** ([PromtEngineer/localGPT](https://github.com/PromtEngineer/localGPT)) | local RAG | ~21K | замедлился | Apache-2.0 | да (полный local) | RAG | 2 из 6 |
| **LibreChat** ([danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)) | многопровайдерный чат + memory | ~22K | очень активен | MIT | да | OpenAI-clone с memory primitives | 2-3 из 6 (memory, 6) |
| **LobeChat** ([lobehub/lobe-chat](https://github.com/lobehub/lobe-chat)) | чат + memory plugin | ~50K | активен | MIT | да | memory plugin + agent market | 2-3 из 6 |
| **Onyx** (бывш. Danswer) ([onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx)) | enterprise search self-host | ~20K | очень активен | MIT (open core) | да (любой LLM провайдер) | unified search + agent + slack-bot | 4-5 из 6 (1,2,3,4,6) |
| **Bloop** ([BloopAI/bloop](https://github.com/BloopAI/bloop)) | code search/memory | ~9K | заглох (статус uncertain) | Apache-2.0 | сложно (Anthropic-default) | semantic code search | вне категории |
| **GPT4All** ([nomic-ai/gpt4all](https://github.com/nomic-ai/gpt4all)) | local chat + LocalDocs | ~73K | активен | MIT | да (полный local) | LocalDocs primitives | 2 из 6 |
| **Reor** ([reorproject/reor](https://github.com/reorproject/reor)) | local AI note-app | ~9K | средняя | AGPL-3.0 | да (local) | desktop note-app со встроенным AI | 3-4 из 6 (1,2,3) |
| **Mods** ([charmbracelet/mods](https://github.com/charmbracelet/mods)) | CLI memory companion | ~3K | активен | MIT | да | CLI-first memory pipe | вне категории |
| **Pieces OS** (closed, упоминается в обзорах) | dev second-brain | — | — | proprietary | — | dev-companion с long-term context | — |
| **SiYuan** ([siyuan-note/siyuan](https://github.com/siyuan-note/siyuan)) | local-first PKM | ~24K | очень активен | AGPL-3.0 | да | block-edit PKM + AI plugin | 2-3 из 6 (без surfacing) |
| **AppFlowy** ([AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy)) | Notion-OSS + AI | ~58K | очень активен | AGPL-3.0 | через AppFlowy AI (closed) | Notion-clone | 2 из 6 |
| **Affine** ([toeverything/AFFiNE](https://github.com/toeverything/AFFiNE)) | Notion+Miro OSS + AI | ~46K | очень активен | MIT | через AFFiNE AI | хороший block editor, AI базовый | 2 из 6 |
| **OneFileLLM** ([jimmc414/onefilellm](https://github.com/jimmc414/onefilellm)) | aggregator → context | ~2K | средняя | MIT | да (любой) | подход «whole context at once» | вне категории |
| **Smart Connections** (obsidian-smart-connections) | Obsidian plugin | ~3K | очень активен | GPL-3.0 | да (OpenAI-compatible) | semantic note-linking | 2-3 из 6 (для одного пользователя) |
| **Smart2Brain** (obsidian-smart2brain) | Obsidian plugin | ~600 | активен | GPL-3.0 | да | local RAG над vault | 2 из 6 |
| **Khoj Obsidian** (часть Khoj) | Obsidian plugin | — | активен | AGPL-3.0 | да | bridge к Khoj backend | 3-4 из 6 (через Khoj) |
| **Obsidian Copilot** (logancyang) | Obsidian plugin | ~6K | очень активен | AGPL-3.0 | да (любой OpenAI-compatible) | chat + RAG + agent над vault | 3 из 6 |
| **Obsidian BMO Chatbot** (longy2k) | Obsidian plugin | ~600 | средняя | MIT | да | minimal chat | 1 из 6 |
| **Obsidian Local GPT** (pfrankov) | Obsidian plugin | ~1K | активен | MIT | да (Ollama) | local + Ollama | 1-2 из 6 |
| **Logseq AI plugins** | Logseq | — | средняя | разн. | да | разные | 1-2 из 6 |
| **RemNote AI** | RemNote (closed core, plugins) | — | — | mixed | — | spaced rep + AI | — |
| **HippoRAG** ([OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG)) | research-impl | ~2.5K | активен (v2) | MIT | да | hippocampal index + KG + PageRank | новый подход |
| **MemoRAG** ([qhjqhj00/MemoRAG](https://github.com/qhjqhj00/MemoRAG)) | research-impl | ~2K | средняя | Apache-2.0 | да | global memory as guidance | новый подход |
| **A-MEM** ([agiresearch/A-mem](https://github.com/agiresearch/A-mem)) | research-impl | ~1.5K | активен | MIT | да | Zettelkasten-эволюция | новый подход |
| **EM-LLM** ([em-llm/em-llm](https://github.com/em-llm/em-llm)) | research-impl | ~1.6K | активен | MIT | да | Bayesian-surprise episodic | новый подход |
| **Memory³ / Memory3** | research, частично open | — | средняя | research | да | sparse explicit memory | новый подход |
| **Titans-pytorch** ([lucidrains/titans-pytorch](https://github.com/lucidrains/titans-pytorch)) | research-port | ~1.4K | активен | MIT | да | TTL-memory в forward pass | новый подход |
| **AriGraph** ([AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph)) | research-impl (РФ) | ~400 | средняя | MIT | да | KG world model | новый подход |
| **RAPTOR** ([parthsarthi03/raptor](https://github.com/parthsarthi03/raptor)) | research-impl | ~1.4K | активен | MIT | да | иерархия абстракций | improvement RAG |
| **GraphRAG** ([microsoft/graphrag](https://github.com/microsoft/graphrag)) | research-impl от MS | ~30K | очень активен | MIT | да | community-graph + map-reduce | новый подход |
| **LightRAG** ([HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)) | research-impl | ~22K | очень активен | MIT | да | vector + graph dual-level | новый подход |
| **nano-graphrag** ([gusye1234/nano-graphrag](https://github.com/gusye1234/nano-graphrag)) | refactor | ~2.5K | активен | MIT | да | минимальный GraphRAG | improvement |
| **fast-graphrag** ([circlemind-ai/fast-graphrag](https://github.com/circlemind-ai/fast-graphrag)) | refactor | ~3K | активен | MIT | да | оптимизированный graphrag | improvement |
| **Pathway LLM-App** ([pathwaycom/llm-app](https://github.com/pathwaycom/llm-app)) | streaming RAG | ~6K | очень активен | MIT | да | streaming memory с live update | новый подход (streaming) |
| **HelixDB** ([HelixDB/helix-db](https://github.com/HelixDB/helix-db)) | graph + vector DB | ~1.5K (растёт) | очень активен | AGPL-3.0 | NA | unified storage | новый подход (storage) |
| **Onyx connectors** (часть Onyx) | connector ecosystem | — | — | MIT | да | enterprise capture | inside Onyx |
| **CrewAI memory** ([crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)) | multi-agent fwk | ~30K | очень активен | MIT | да | embedded memory per agent + shared | smjezhnyj |
| **AutoGen Memory** ([microsoft/autogen](https://github.com/microsoft/autogen)) | multi-agent fwk | ~46K | очень активен | MIT | да | shared memory primitives | смежный |
| **Vanna AI** ([vanna-ai/vanna](https://github.com/vanna-ai/vanna)) | text-to-SQL memory | ~13K | активен | MIT | да | training memory для SQL | специализированный |
| **PaperQA2** ([Future-House/paper-qa](https://github.com/Future-House/paper-qa)) | research papers memory | ~7K | активен | Apache-2.0 | да | high-recall over papers | специализированный |
| **R2R / SciPhi** ([SciPhi-AI/R2R](https://github.com/SciPhi-AI/R2R)) | RAG-as-platform | ~7K | активен | MIT | да | production RAG framework | инфра, граничит с продуктом |
| **RagFlow** ([infiniflow/ragflow](https://github.com/infiniflow/ragflow)) | RAG-platform | ~40K | очень активен | Apache-2.0 | да | document layout + deep RAG | продукт-инфра |
| **Verba** ([weaviate/Verba](https://github.com/weaviate/Verba)) | Weaviate's RAG UI | ~7K | активен | BSD-3 | да | RAG demo over Weaviate | продукт-инфра |
| **Haystack agents** (deepset-ai) | LLM framework | ~17K | активен | Apache-2.0 | да | RAG framework | инфра |
| **Self-Operating Computer** ([OthersideAI/self-operating-computer](https://github.com/OthersideAI/self-operating-computer)) | active agent | ~10K | активен | MIT | да | действующий агент с GUI-памятью | смежный |
| **Awesome lists** (см. 5.6) | — | — | — | — | — | — | — |

---

## 5.2. Продуктовые open-source решения — детально

### Khoj — second brain для документов и obsidian-вкладчиков

- **Источник:** [khoj-ai/khoj](https://github.com/khoj-ai/khoj).
- **Stars / активность:** ~17K, очень активен в 2025-2026 (релизы регулярные).
- **Лицензия:** AGPL-3.0 (важно: AGPL значит, что любой fork с SaaS-моделью обязан публиковать исходники; для коммерческой надстройки нужна dual-license договорённость).
- **Авторы:** команда Khoj Inc. (открытый core + cloud). Основатель — Saba Imran.
- **Что делает:** self-host AI-ассистент, который индексирует личные документы, заметки Obsidian/Notion/markdown, email (через IMAP-коннектор), берёт LLM-провайдера на выбор (OpenAI-compatible / Anthropic / локальный). Веб-UI + Obsidian-плагин + WhatsApp / Slack-боты.
- **Архитектурный подход:** vector search (sentence-transformers + ScalerDB/Qdrant), keyword search (Tantivy/BM25), затем hybrid rerank. Knowledge graph на проекте формально нет — это «продвинутый RAG с capture-пайплайном и pluggable LLM».
- **Стек:** Django (Python), Postgres + pgvector, Sentence-Transformers, опционально Whisper для voice; UI — Next.js.
- **Документация:** хорошая, `docs.khoj.dev` + Github-вики; есть рецепты под Docker, Kubernetes.
- **Поддержка русского / RU LLM:** русский язык — да (мультиязычные эмбеддинги), GigaChat/YandexGPT — через OpenAI-compatible прокси.
- **Прохождение критериев раздела 2:**
  - (1) Многоканальный capture — да (Obsidian, Notion, email, GitHub, веб-ссылки).
  - (2) Слойная переработка — частично (chunk + summary, без полноценного distill в «evergreen»).
  - (3) Связи между сущностями — частично (через теги Obsidian, не графовая модель).
  - (4) Surfacing — частично (есть proactive scheduler «daily review»).
  - (6) Память агента — да (есть API).
  - **Итого: 4 из 6.**
- **Новый подход?:** нет (классический RAG + capture, но product-полноценный).
- **Релевантность для Z:** **высокая как референс UX-капчура**. Если Z строит «второй мозг», смотреть, как у Khoj устроен mult-source capture и Obsidian-bridge.

### AnythingLLM — workspace-first, multi-tenant из коробки

- **Источник:** [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm).
- **Stars / активность:** ~35K, очень активен.
- **Лицензия:** MIT — самая «дружелюбная» для коммерческого использования.
- **Авторы:** Mintplex Labs (US-startup, основатель — Timothy Carambat).
- **Что делает:** self-host AI-чат с workspace-моделью. Каждая команда / тематика — отдельный workspace со своими документами, прямой URL, ролевая модель (user/admin), API-токены. По сути — «свой ChatGPT с RAG», который реально готов к multi-tenancy.
- **Архитектурный подход:** workspace = vector collection. Поддерживает LanceDB / Chroma / Pinecone / Qdrant / Weaviate / Milvus / Astra / pgvector. LLM-провайдер — почти любой (OpenAI, Anthropic, Azure, Ollama, LMStudio, GigaChat через generic OpenAI). RAG базовый, но есть «agents» (skills + function-calling).
- **Стек:** Node.js (NestJS-like), React frontend, SQLite или Postgres для метаданных.
- **Документация:** хорошая, есть Docker-quickstart и docker-compose; PR-driven, рецепты под Ollama и local LLM.
- **Поддержка русского / RU LLM:** русский — да, GigaChat через generic OpenAI provider.
- **Прохождение критериев раздела 2:**
  - (1) Многоканальный capture — частично (web scrape, docs upload, no native обзвонов/чатов).
  - (2) Слойная переработка — нет (плоский RAG).
  - (3) Связи — частично (workspace-tags).
  - (6) Память агента — да (API + Embeds).
  - **Итого: 3 из 6.**
- **Новый подход?:** нет, но **зрелость и multi-tenant** — главный аргумент для MVP «второй мозг как продукт».
- **Релевантность для Z:** **очень высокая для MVP**. Если нужно за 4-6 недель показать командный «второй мозг», это лучший базис для form. Особенно — workspace-модель прямо ложится на наши org-tenants.

### Open WebUI — UI-каркас, memory как плагин

- **Источник:** [open-webui/open-webui](https://github.com/open-webui/open-webui).
- **Stars / активность:** ~80K (один из самых больших в категории), очень активен.
- **Лицензия:** BSD-3-Clause.
- **Авторы:** Tim Jaeryang Baek и небольшая core-команда.
- **Что делает:** ChatGPT-подобный UI, который умеет работать с любым OpenAI-compatible эндпоинтом и Ollama. Сильная сторона — **расширения**: pipelines (любой Python-pipeline как middleware между промптом и моделью), tools, functions, **memory feature** (хранит факты о пользователе и подмешивает в системный промпт). Есть RAG над загруженными документами.
- **Архитектурный подход:** UI-first; memory у пользователя — простой list of facts + vector retrieval. **Architecturalно — это «оболочка вокруг LLM»**, но за счёт pipelines можно встраивать любую memory-стратегию (Mem0, Letta, Graphiti).
- **Стек:** SvelteKit + FastAPI; Postgres или SQLite.
- **Документация:** есть и хорошая для self-host.
- **Поддержка русского / RU LLM:** да; работает прямо с GigaChat при настройке как OpenAI-compatible.
- **Прохождение критериев раздела 2:**
  - (1) Многоканальный capture — частично (через pipelines).
  - (2) Слойная переработка — нет (нужен внешний слой).
  - (6) Память агента — да (memory + API).
  - **Итого: 2-3 из 6** (зависит от прикрученных pipelines).
- **Новый подход?:** не сам по себе, но **«экосистема pipelines» — настоящая мета-платформа**.
- **Релевантность для Z:** **средняя**. Не как продукт «второй мозг», но как «UI-каркас для внутренней админки Z-AI» — годится. Многие команды в РФ берут Open WebUI как front в чате с GigaChat.

### Continue — coding memory в IDE

- **Источник:** [continuedev/continue](https://github.com/continuedev/continue).
- **Stars / активность:** ~22K, очень активен (релизы каждую неделю).
- **Лицензия:** Apache-2.0.
- **Авторы:** Continue (US-стартап, основатели — Ty Dunn, Nate Sesti).
- **Что делает:** IDE-плагин (VS Code + JetBrains), который добавляет «agent inside IDE» с долговременной памятью по проекту, истории чатов и codebase-индексом.
- **Архитектурный подход:** indexed codebase + chat history + custom slash-commands + tools (terminal, file edit). Memory — это `~/.continue/index` и YAML-конфиг с правилами/инструкциями.
- **Стек:** TypeScript / Rust / Python; embedding-backends pluggable.
- **Релевантность для Z:** **низкая для продукта**, но **высокая как референс «memory для специализированного агента»** — идея «memory ≠ flat facts, а structured rules + slash-commands» применима к нашему AI-аналитику встреч.

### Quivr — second brain как «мозги»

- **Источник:** [QuivrHQ/quivr](https://github.com/QuivrHQ/quivr).
- **Stars / активность:** ~37K. Динамика замедлилась в 2025 — команда сфокусировалась на cloud-продукте, OSS-релизы стали реже.
- **Лицензия:** Apache-2.0.
- **Авторы:** Quivr (бывш. Stan Girard).
- **Что делает:** «brains» — отдельные хранилища документов / типа (study, work, family). Capture: drag-and-drop, URL, audio (Whisper), email forward. UI-first.
- **Архитектурный подход:** RAG (Supabase + pgvector), pluggable LLM (OpenAI, Anthropic, Mistral, Ollama). Brain-метафора = логическая партиция данных, не отдельная архитектура.
- **Стек:** FastAPI + Supabase + Next.js.
- **Прохождение критериев раздела 2:**
  - (1) — да (multi-source upload, audio, URL).
  - (2) — частично.
  - (3) — частично (brain-tags).
  - (6) — да (API).
  - **Итого: 4 из 6.**
- **Новый подход?:** нет (мета-RAG), но **brain-метафора** ближе всего к маркетинговому позиционированию «второго мозга» в OSS.
- **Релевантность для Z:** **средняя** — фич перекрывается с AnythingLLM, но в Quivr более «потребительский» UX. Стоит изучать UI, не код.

### DocsGPT — классический RAG для документации

- **Источник:** [arc53/DocsGPT](https://github.com/arc53/DocsGPT).
- **Stars / активность:** ~16K, активен.
- **Лицензия:** MIT.
- **Авторы:** arc53 (US-startup, основатель — Alex Tushinsky).
- **Что делает:** self-host чатбот для документации продукта. Загружаешь корпус → получаешь чат с цитированиями.
- **Архитектурный подход:** базовый RAG (LlamaIndex + Qdrant/Pinecone), web-widget, API.
- **Прохождение критериев раздела 2:** 2 из 6 (только capture для доков + API). Это **enhanced search**, не второй мозг.
- **Релевантность для Z:** **низкая** — для замены документации Z, не для бизнес-памяти.

### PrivateGPT — air-gapped RAG

- **Источник:** [zylon-ai/private-gpt](https://github.com/zylon-ai/private-gpt).
- **Stars / активность:** ~55K. Активность снизилась с 2024 (команда сфокусировалась на коммерческой Zylon).
- **Лицензия:** Apache-2.0.
- **Авторы:** Zylon (Iván Martínez Toro и команда, Барселона).
- **Что делает:** 100%-локальный AI: документы остаются на машине, LLM может быть GGUF / Ollama / LM Studio, эмбеддинги local. Главное продающее предложение — **«никаких данных наружу»**.
- **Архитектурный подход:** LlamaIndex + Qdrant / Chroma; UI на FastAPI.
- **Прохождение критериев раздела 2:** 2 из 6 — это **локальный RAG**, не второй мозг.
- **Релевантность для Z:** **низкая для core**, но **высокая как референс «air-gap pattern»** для on-prem-инсталляций (часть РФ-клиентов потребует именно этого).

### LocalGPT — параллельная ветка PrivateGPT

- **Источник:** [PromtEngineer/localGPT](https://github.com/PromtEngineer/localGPT).
- **Stars / активность:** ~21K, активность замедлилась.
- **Лицензия:** Apache-2.0.
- **Архитектура:** аналогична PrivateGPT, проще, без UI; больше как «скриптовый PoC».
- **Релевантность для Z:** **низкая**.

### LibreChat — многопровайдерный чат, primitives памяти

- **Источник:** [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat).
- **Stars / активность:** ~22K, очень активен.
- **Лицензия:** MIT.
- **Авторы:** Danny Avila + active OSS-сообщество.
- **Что делает:** Self-host «ChatGPT++» с поддержкой 20+ LLM (OpenAI, Anthropic, Google, Mistral, custom, Ollama, любой OpenAI-compatible). Включает **базовую персонализацию памяти** через `MemoryAgent` (long-term facts о пользователе), assistants API, web search, code interpreter.
- **Архитектурный подход:** Node.js + MongoDB. Memory модуль — простой store of facts + retrieval по relevance.
- **Прохождение критериев раздела 2:**
  - (6) — да (API + memory plugin).
  - **Итого: 2-3 из 6.**
- **Релевантность для Z:** **средняя**. Как UI-каркас «команда + чат + RU LLM» — отличный кандидат, но как «второй мозг» — слабовато без надстройки.

### LobeChat — чат + memory plugin

- **Источник:** [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat).
- **Stars / активность:** ~50K, активен.
- **Лицензия:** MIT (Apache-2.0 для отдельных частей).
- **Что делает:** красивый ChatGPT-clone, плагин-маркет, knowledge-base (бета-фича: загружай файлы → RAG), агенты.
- **Архитектурный подход:** Next.js + Postgres (опц. pgvector). Память — простой store.
- **Релевантность для Z:** **низкая** (геймплейная сторона важнее, чем второй мозг).

### Onyx (бывш. Danswer) — главный enterprise-search OSS 2025-2026

- **Источник:** [onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx).
- **Stars / активность:** ~20K, очень активен. Один из самых быстро растущих в 2025-2026.
- **Лицензия:** MIT (open core), есть Enterprise Edition с SSO/RBAC.
- **Авторы:** Onyx Inc. (YC W24, ребрендинг из Danswer в начале 2025).
- **Что делает:** self-host enterprise-search + AI-чатбот + slack-бот. **Главная фишка — 50+ коннекторов** (Confluence, Notion, Slack, Google Drive, Jira, GitHub, Salesforce, Zendesk, …). Это OSS-аналог Glean.
- **Архитектурный подход:** капчура из систем источников через коннекторы → Postgres + Vespa (или Qdrant) для индекса + LLM-rerank. Есть «assistants» (специализированные агенты по доменам).
- **Стек:** FastAPI + Next.js + Vespa + Postgres.
- **Документация:** хорошая, есть Helm-чарт.
- **Поддержка русского / RU LLM:** русский — да. LLM — любой OpenAI-compatible, Anthropic, Cohere, локальные.
- **Прохождение критериев раздела 2:**
  - (1) Multi-channel capture — **да (50+ коннекторов)**.
  - (2) Слойная переработка — частично (есть assistants + summary).
  - (3) Связи — частично (cross-source attribution через метаданные).
  - (4) Surfacing — частично (slack-бот, daily-digest).
  - (6) Память агента — да (API).
  - **Итого: 4-5 из 6 — самое близкое к «второму мозгу» в OSS.**
- **Новый подход?:** нет (это «Glean OSS»), но **по сумме criterio покрытия — лучший OSS-кандидат на корпоративный второй мозг**.
- **Релевантность для Z:** **высокая**. Если Z думает расширяться в «корпоративную память», Onyx — главный референс архитектуры коннекторов. Можно либо взять Onyx как фундамент (через MIT-core), либо вдохновляться им.

### Bloop — code search/memory (статус uncertain)

- **Источник:** [BloopAI/bloop](https://github.com/BloopAI/bloop).
- **Stars / активность:** ~9K. Команда пивотировалась, OSS-релизы прекратились в начале 2025.
- **Лицензия:** Apache-2.0.
- **Релевантность для Z:** **низкая** (даже как референс — заглох).

### GPT4All — local chat + LocalDocs

- **Источник:** [nomic-ai/gpt4all](https://github.com/nomic-ai/gpt4all).
- **Stars / активность:** ~73K, активен.
- **Лицензия:** MIT.
- **Авторы:** Nomic AI.
- **Что делает:** desktop-app для запуска GGUF-моделей локально + LocalDocs (RAG над папкой документов).
- **Прохождение критериев:** 2 из 6 — local chat + minimal docs.
- **Релевантность для Z:** **низкая для бизнеса**, но **средняя как референс desktop-UX**.

### Reor — local AI note-app, redaktor + RAG в одном

- **Источник:** [reorproject/reor](https://github.com/reorproject/reor).
- **Stars / активность:** ~9K, средняя активность.
- **Лицензия:** AGPL-3.0.
- **Что делает:** desktop note-app: пишешь markdown, AI авто-предлагает связи (semantic) с соседними нотами, есть chat над vault.
- **Архитектурный подход:** Tauri (Rust + JS), local embeddings, local LLM или OpenAI.
- **Прохождение критериев:** 3-4 из 6 (есть линковка, capture, есть retrieval).
- **Релевантность для Z:** **низкая для команды**, **средняя как референс «embedding-driven note linking» для UI-фичи Z**.

### SiYuan — local-first PKM с AI-плагином

- **Источник:** [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan).
- **Stars / активность:** ~24K, очень активен.
- **Лицензия:** AGPL-3.0.
- **Что делает:** Notion/RemNote-like локальный block editor, есть AI assistant.
- **Релевантность для Z:** **низкая для core продукта**, как UX-референс для рукописных заметок — средняя.

### AppFlowy & Affine — Notion-OSS-клоны с AI

- **AppFlowy:** [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy), ~58K. AI-фичи через closed AppFlowy AI.
- **Affine:** [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE), ~46K. AI через AFFiNE AI.
- **Релевантность для Z:** **низкая как продукт-копия**, **средняя как референс UI**.

### OneFileLLM — aggregator для context

- **Источник:** [jimmc414/onefilellm](https://github.com/jimmc414/onefilellm).
- **Что делает:** CLI собирает кодрепо/папку/PDF в один файл для прямой передачи в LLM «всё разом» — паттерн «long-context вместо RAG».
- **Релевантность для Z:** **низкая**, но иллюстрирует тренд «когда LLM умеет 1M+ токенов, RAG становится спорным выбором».

### Self-Operating Computer — пример «активной памяти» агента

- **Источник:** [OthersideAI/self-operating-computer](https://github.com/OthersideAI/self-operating-computer).
- **Stars:** ~10K.
- **Что делает:** агент, который видит экран и выполняет действия мышкой/клавиатурой. Память сюда заходит как **«журнал действий + контекст экрана»**.
- **Релевантность для Z:** **низкая для core**, **средняя как идея «agent-memory как stream of actions, а не stream of facts»**.

---

## 5.3. Плагины для PKM-систем (Obsidian / Logseq / RemNote)

Это «второй мозг сотрудника», не компании. Но плагинная экосистема — мощный источник UX-идей.

### Smart Connections — Obsidian

- **Источник:** [brianpetro/obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections).
- **Stars / активность:** ~3K, очень активен.
- **Лицензия:** GPL-3.0.
- **Авторы:** Brian Petro (independent).
- **Что делает:** инкрементально эмбеддит заметки vault, показывает «похожие» в боковой панели; есть чат над vault.
- **Архитектурный подход:** локальные эмбеддинги (или OpenAI) + RAG; ничего нового, но **отличный UX «surfacing» в реальном времени**.
- **Поддержка русского / RU LLM:** да (OpenAI-compatible).
- **Релевантность для Z:** **высокая как референс surfacing UX** — именно так Z может показывать «прошлые встречи с этим участником» во время записи.

### Smart2Brain — Obsidian, local RAG

- **Источник:** [your-papa/obsidian-Smart2Brain](https://github.com/your-papa/obsidian-Smart2Brain).
- **Stars:** ~600.
- **Лицензия:** GPL-3.0.
- **Что делает:** local-first RAG над vault, Ollama-backend по умолчанию, есть OpenAI fallback.
- **Релевантность для Z:** **низкая для команды**, **средняя как референс privacy-first UX**.

### Khoj Obsidian Plugin — bridge к Khoj backend

- Часть [Khoj](https://github.com/khoj-ai/khoj).
- Bridge между Obsidian-vault и Khoj backend; даёт Khoj UX (chat + semantic search) внутри Obsidian.
- **Релевантность для Z:** референс «как Z может встраиваться в Obsidian-vault команды».

### Obsidian Copilot — самый зрелый AI-плагин

- **Источник:** [logancyang/obsidian-copilot](https://github.com/logancyang/obsidian-copilot).
- **Stars / активность:** ~6K, очень активен.
- **Лицензия:** AGPL-3.0.
- **Что делает:** chat + vault-aware QA + custom prompts. Любой OpenAI-compatible эндпоинт. Команды-агенты (рефакторинг заметки, summarize selection, brainstorm).
- **Прохождение критериев:** 3 из 6 (capture, distill через summary, API).
- **Релевантность для Z:** **высокая как референс агентов поверх корпуса заметок**.

### Obsidian BMO Chatbot, Obsidian Local GPT, Obsidian Ollama

- Мелкие плагины-чатботы поверх vault, на Ollama / local.
- Низкая релевантность.

### Logseq AI plugins

- Logseq-сообщество (примеры: logseq-plugin-ai, logseq-ai-companion). Активность переменная.
- Логически — то же, что Obsidian-плагины, но для outliner-парадигмы Logseq.
- **Релевантность для Z:** низкая.

### RemNote AI extensions

- RemNote (core closed-source, plugin-API открыт). RemNote AI — встроенная фича; spaced repetition + AI.
- **Релевантность для Z:** **низкая**, но интересна как сочетание «второй мозг + spaced repetition». Стоит понаблюдать.

---

## 5.4. Open-source реализации академических идей (из ветки 7)

### HippoRAG — есть, активно используется

- **Источник:** [OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG).
- **Stars:** ~2.5K, активен (v2 вышла в 2025).
- **Лицензия:** MIT.
- **Архитектура:** документы → entity-extraction LLM → KG → Personalized PageRank + vector retrieval.
- **Production-ready?** Скорее research-baseline, чем production-system, но **active and well-maintained**. Cognee явно вдохновлялся.
- **Релевантность для Z:** **средняя**. Идея «PageRank по графу сущностей встреч» применима, но self-build дешевле, чем форк.

### MemoRAG — есть реализация

- **Источник:** [qhjqhj00/MemoRAG](https://github.com/qhjqhj00/MemoRAG).
- **Stars:** ~2K, средняя активность.
- **Лицензия:** Apache-2.0.
- **Архитектура:** dual-system: lightweight long-context LLM как «global memory», основной LLM получает clues.
- **Production-ready?** Research, но с явными примерами; не для прода под нагрузкой.
- **Релевантность для Z:** **низкая для прода**, **средняя как идея «памяти-guidance»**.

### A-MEM — есть, набирает обороты

- **Источник:** [agiresearch/A-mem](https://github.com/agiresearch/A-mem).
- **Stars:** ~1.5K, активен.
- **Лицензия:** MIT (research-license).
- **Архитектура:** агент сам создаёт ноты, их контекст, ключевые слова, связи; динамический Zettelkasten.
- **Production-ready?** Research-level код, но идея уже расходится в продакшен (Mem0 v2 элементы, Cognee).
- **Релевантность для Z:** **средняя**. Прямо A-MEM код брать не стоит, но идею «нет фиксированной схемы — агент строит сам» — стоит учесть в дизайне distill-pipeline для разных типов встреч Z.

### EM-LLM — есть

- **Источник:** [em-llm/em-llm](https://github.com/em-llm/em-llm).
- **Stars:** ~1.6K, активен.
- **Лицензия:** MIT.
- **Архитектура:** сегментация по Bayesian surprise + двухстадийный retrieval (similarity + temporal contiguity).
- **Production-ready?** Research, но **код качественный, можно реально запускать**.
- **Релевантность для Z:** **высокая**. Прямо применимо к транскриптам встреч: «как разделить длинный транскрипт на смысловые блоки автоматически» — без эвристик «по паузам». Это лучший кандидат на эксперимент в Z.

### Bi-temporal KG (помимо Graphiti) — практически нет полноценных альтернатив

- **Graphiti** уже разобран в ветке 6.
- **HelixDB** ([HelixDB/helix-db](https://github.com/HelixDB/helix-db)) — новая БД, объединяющая graph + vector в одном движке; формально не bi-temporal, но удобный субстрат для self-built bi-temporal-схемы.
- Несколько закрытых проектов в академии (TReMu) — open-source реализации нет.
- **Вывод:** Graphiti остаётся единственным production-ready OSS bi-temporal-KG.

### World models as memory — частично

- **AriGraph** ([AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph), MIT, ~400★) — российский AIRI Institute; KG world model для текстовых сред. **Редкий пример OSS из РФ в категории**.
- **V-JEPA 2** (Meta, июн 2025) — частично открыт, но это видео-модель, не текст.
- **WorldDreamer / WorldGPT / OASIS** — экспериментальные video-world-models; для текстового бизнеса нерелевантны.
- **Вывод:** «world models as memory» **пока преимущественно research**, прямого open-source применения для бизнеса нет.

### Sparse distributed memory — есть на уровне идеи

- **Memory³** — проект-страница (Yang et al.), частично открыт; полного OSS нет.
- **Kanerva implementations:** разные исторические реализации (например, [denismakogon/sparse-distributed-memory](https://github.com/denismakogon/sparse-distributed-memory) — игрушечный), но в современных LLM-стеках — пока не используется.
- **Вывод:** **наблюдать, не строить**.

### Neurosymbolic memory — research-уровень

- **SymAgent** (фев 2025), **TReMu** (фев 2025), **CLAUSE** (2509.21035) — публикуются с research-кодом, не production-ready.
- **logica-style symbolic engines** + LLM — есть несколько мелких репо (`logica`, `prolog-llm`), но всё ещё на ранней стадии.
- **Вывод:** для Z **не релевантно в горизонте 12 месяцев**.

### Multi-agent shared memory (CrewAI / AutoGen primitives)

- **CrewAI** ([crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)) — multi-agent framework с встроенной памятью (short-term + long-term + entity memory). Activity high, license MIT.
- **AutoGen** ([microsoft/autogen](https://github.com/microsoft/autogen)) — Microsoft Research, memory primitives через `Memory` API; в 0.4+ переделана архитектура.
- **AG2** ([ag2ai/ag2](https://github.com/ag2ai/ag2)) — fork-эволюция AutoGen 0.2.
- **MetaGPT** ([geekan/MetaGPT](https://github.com/geekan/MetaGPT)) — multi-agent с встроенной memory.
- **Collaborative Memory** (research [2505.18279](https://arxiv.org/abs/2505.18279)) — пока нет полноценного OSS-эталона.
- **Вывод:** CrewAI/AutoGen — **хорошие референсы primitives**, но это **фреймворки**, не продукты. Они подходят под третью часть запроса (D, новые подходы), не под первые две.

---

## 5.5. НОВЫЕ АРХИТЕКТУРНЫЕ ПОДХОДЫ — главное

Это раздел, ради которого делался этот документ. Ниже — репо, которые **не повторяют RAG / Mem0 / Letta** и предлагают реально иной ход.

### NEW-1. EM-LLM — episodic-as-events (Bayesian-surprise сегментация)

- **Источник:** [em-llm/em-llm](https://github.com/em-llm/em-llm).
- **Что нового именно в архитектуре:** память **не имеет фиксированных границ chunks**. Поток токенов сегментируется по точкам высокой Bayesian surprise (где предсказание модели сильно расходится с реальностью). Получаемые «эпизоды» имеют смысловую целостность, как у человека. Retrieval — двухстадийный: similarity + temporal contiguity (соседние эпизоды по времени тоже подтягиваются).
- **Почему интересно для Z:** транскрипт длинной встречи — это **тоже поток**. EM-LLM-сегментация прямо ложится на задачу разрезать запись на смысловые блоки без эвристик «по молчанию» или «по смене спикера». **Самый сильный candidate для эксперимента** в продуктовом скоупе Z.
- **Production-ready или experimental:** **experimental**, но качественный код. Можно прототипировать.

### NEW-2. A-MEM — self-organizing memory без схемы

- **Источник:** [agiresearch/A-mem](https://github.com/agiresearch/A-mem).
- **Что нового именно в архитектуре:** агент сам решает, какие атрибуты выделять и какие связи строить. **Нет жёсткой онтологии** — для каждого типа задач граф эволюционирует своим путём.
- **Почему интересно для Z:** 9 типов встреч в Z требуют разной структуры заметок (sales-call ≠ retrospective ≠ planning). A-MEM-подход избавляет от жёсткой схемы — агент сам формирует структуру под тип. Альтернативно идею можно вкрутить в Mem0/Cognee — но **A-MEM код даёт baseline**.
- **Production-ready или experimental:** **experimental**, идея уже расходится в Mem0 v2 / Cognee.

### NEW-3. AriGraph — KG world models для агента (российский пример)

- **Источник:** [AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph).
- **Что нового именно в архитектуре:** граф знаний с двумя слоями — **семантический** (объекты и связи в среде) + **эпизодический** (вершины-события, связанные с семантическими сущностями). Память служит **моделью среды**, а не базой текстов.
- **Почему интересно для Z:** «второй мозг компании» = модель окружения бизнеса (клиенты, проекты, сотрудники, договорённости), а не корпус документов. AriGraph задаёт правильную метафору. Плюс — российская команда, что выгодно с точки зрения локального экспертного контекста.
- **Production-ready или experimental:** **research**, но конкретный код и эксперименты.

### NEW-4. Titans-pytorch — TTL-память (test-time learning)

- **Источник:** [lucidrains/titans-pytorch](https://github.com/lucidrains/titans-pytorch).
- **Что нового именно в архитектуре:** Neural Long-Term Memory Module **обновляет свои веса прямо во время forward pass**. Память живёт не как внешняя база, а как **часть модели**.
- **Почему интересно для Z:** долгосрочно — может убрать необходимость в отдельном KG и vector store. **Сейчас — только наблюдать**: воспроизводимость спорная ([Titans Revisited, 2510.09551](https://arxiv.org/abs/2510.09551)).
- **Production-ready или experimental:** **сугубо experimental** (неофициальный port).

### NEW-5. HelixDB — graph + vector в одном движке

- **Источник:** [HelixDB/helix-db](https://github.com/HelixDB/helix-db).
- **Что нового именно в архитектуре:** **унифицированная storage** для graph и vector данных — без двойной интеграции (Neo4j + pgvector). Запросы написаны на собственном языке HelixQL.
- **Почему интересно для Z:** Mem0 + Graphiti требуют двух хранилищ. HelixDB обещает одно. Это упрощает DevOps для self-host «второго мозга».
- **Production-ready или experimental:** **early production** (запуск в 2024-2025, набирает активность). Стоит проследить.

### NEW-6. Pathway LLM-App — streaming-память

- **Источник:** [pathwaycom/llm-app](https://github.com/pathwaycom/llm-app).
- **Что нового именно в архитектуре:** RAG/память **обновляется в реальном времени** через стриминговый движок Pathway (Rust + Python). Когда документ изменился — vector store автоматически переиндексируется, без batch-обновлений.
- **Почему интересно для Z:** новые встречи / транскрипты / отчёты появляются непрерывно. Streaming-обновление памяти — естественное для бизнес-сценария «помни всё, что произошло до этой минуты».
- **Production-ready или experimental:** **production**, активный коммерческий проект (Pathway).

### NEW-7. MEM1 — RL для memory + reasoning

- **Источник:** академическая работа [2506.15841](https://arxiv.org/abs/2506.15841); полноценного отдельного репо пока нет, есть baselines в `Yuan et al.` репо.
- **Что нового именно в архитектуре:** end-to-end RL, при котором агент учится **держать constant-memory state** — память не растёт со временем, а перерасчитывается под текущую задачу.
- **Почему интересно для Z:** ограниченный (предсказуемый) расход токенов на длинной серии встреч. Сейчас — academic experiment.

### NEW-8. CrewAI / AutoGen multi-agent shared memory

- **CrewAI** ([crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)) — встроенная memory: short-term, long-term (Mem0-compatible), entity memory.
- **AutoGen** — `Memory` API c semantic backends.
- **Что нового:** **shared memory между несколькими специализированными агентами** в одной команде. Применимо к Z, если делать «команду AI-агентов»: транскрибатор + аналитик + автор отчёта + scheduler.
- **Production-ready или experimental:** **production** (CrewAI используется в продуктах), но не как «отдельный второй мозг», а как примитив.

### NEW-9. Sleep-like memory consolidation (Reflexion / ExpeL / RMM)

- **Источник работ:** [Reflexion](https://arxiv.org/abs/2303.11366), [ExpeL](https://github.com/LeapLabTHU/ExpeL), [RMM](https://arxiv.org/abs/2503.08026).
- **Что нового именно в архитектуре:** **батчевая консолидация памяти** — агент периодически перебирает накопленный опыт, переписывает правила и связи. Это «фаза сна» для агента.
- **Почему интересно для Z:** ночной job, который пересматривает все встречи дня и обновляет KG. **Инженерно дешёво** — реализуемо в Z за неделю.
- **Production-ready или experimental:** **production-ready** (паттерн, не библиотека).

### NEW-10. Self-Operating Computer — память действий, не фактов

- **Источник:** [OthersideAI/self-operating-computer](https://github.com/OthersideAI/self-operating-computer).
- **Что нового именно в архитектуре:** «память» — это не корпус документов, а **поток выполненных действий + контекст экрана**. Радикально другая модель «что хранить».
- **Почему интересно для Z:** наводит на мысль, что для бизнеса можно фиксировать **не только встречи, но и «действия по встрече» (создан тикет в Jira, отправлено письмо)** — это даёт замкнутую обратную связь, чего нет в чисто-капчурных вторых мозгах.
- **Production-ready или experimental:** **experimental**.

---

## 5.6. Что прошло мимо радара (за последние 6 месяцев)

Свежие репо с растущим momentum, которых ещё нет в обзорах ветки 6.

- **HelixDB** ([HelixDB/helix-db](https://github.com/HelixDB/helix-db)) — graph+vector unified DB. Запустилась в 2024, в 2026 набирает momentum в обзорах AI-инфраструктуры.
- **Onyx** ([onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx)) — ребрендинг Danswer в 2025; за год OSS-проект преодолел отметку 20K★ и стал главным «Glean OSS».
- **Pathway streaming** ([pathwaycom/pathway](https://github.com/pathwaycom/pathway)) — streaming-память для агентов; новая категория, не покрытая в обзорах 2024.
- **Continue's «context providers»** — система плагинов в Continue (на октябрь 2025) пересоздаёт UX «pull memory in IDE» — другие проекты обращают внимание.
- **LightRAG** ([HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)) — уже >22K★, в 2026 один из самых популярных Graph-RAG проектов.
- **fast-graphrag** ([circlemind-ai/fast-graphrag](https://github.com/circlemind-ai/fast-graphrag)) и **nano-graphrag** ([gusye1234/nano-graphrag](https://github.com/gusye1234/nano-graphrag)) — оптимизированные форки Microsoft GraphRAG; за несколько месяцев набрали по 2-3K★.
- **R2R** ([SciPhi-AI/R2R](https://github.com/SciPhi-AI/R2R)) — RAG-as-a-platform с встроенным KG и agent-режимом.
- **RagFlow** ([infiniflow/ragflow](https://github.com/infiniflow/ragflow)) — китайский проект с deep-RAG (понимание layout PDF, таблиц); вырос до ~40K★ за 18 месяцев.
- **PaperQA2** ([Future-House/paper-qa](https://github.com/Future-House/paper-qa)) — высокоточный RAG над научными статьями (для исследовательских команд это уже «второй мозг науки»).
- **Vanna AI** ([vanna-ai/vanna](https://github.com/vanna-ai/vanna)) — text-to-SQL с training memory; интересный пример «memory как обучающий корпус».
- **Awesome-lists с актуальной редакцией:**
  - [coleam00/ai-agents-masterclass](https://github.com/coleam00/ai-agents-masterclass)
  - [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)
  - [Shichun-Liu/Agent-Memory-Paper-List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
  - [NirDiamant/agents-towards-production](https://github.com/NirDiamant/agents-towards-production)
  - [Nik-09/Awesome-Personal-Knowledge-Management](https://github.com/Nik-09/Awesome-Personal-Knowledge-Management)
  - [NirDiamant/Agent_Memory_Techniques](https://github.com/NirDiamant/Agent_Memory_Techniques)
  - [ysymyth/awesome-language-agents](https://github.com/ysymyth/awesome-language-agents)
- **Reor / SiYuan / AnyType** — рост в категории local-first PKM с AI: в OSS-нише за 12 месяцев набралось ~3-5 серьёзных конкурентов классическому Obsidian.

---

## 5.7. Связь с РФ

### Какие из этих open-source решений можно self-host в РФ

**Совместимы из коробки** (нет привязки к закрытой US-инфраструктуре):

- Khoj, AnythingLLM, Open WebUI, Continue, LibreChat, LobeChat, Quivr, DocsGPT, PrivateGPT, LocalGPT, GPT4All, Reor, Onyx, RagFlow, R2R, Verba.
- Все Obsidian/Logseq-плагины (живут локально в vault).
- Research-имлементы (HippoRAG, A-MEM, EM-LLM, AriGraph, Titans-pytorch) — Python-репозитории, работают где угодно.

**Требуют доработки** (привязки к OpenAI / Anthropic по дефолту):

- Bloop — Anthropic-only по дефолту, нужен прокси (но проект почти заглох).
- Continue — поддерживает любых провайдеров, но дефолтные пресеты под OpenAI/Anthropic.
- GraphRAG (Microsoft) — defaults OpenAI; нужно переписывать LLM-конфиг.

### Какие совместимы с GigaChat/YandexGPT/Llama/Qwen

Через generic OpenAI-compatible эндпоинт работают **почти все**:

- AnythingLLM (явно поддерживает GigaChat через generic OpenAI provider).
- Khoj, Open WebUI, LibreChat, LobeChat, Continue — да.
- Onyx, RagFlow, R2R — да.
- Khoj Obsidian, Smart Connections, Obsidian Copilot — да.
- Research-имплементы — да (Python-конфиг).

### Какие требуют OpenAI/Anthropic и значит требуют прокси

- Старые версии Bloop — изначально Anthropic-only.
- AppFlowy AI, AFFiNE AI — closed-source AI-фичи, без локального fallback (хотя сам редактор open-source).
- RemNote AI — встроено в SaaS, не для self-host.

### Российские проекты в OSS-памяти

- **AriGraph** (AIRI Institute) — единственный заметный пример из РФ в топе academic-memory работ.
- **GigaChat tooling** — много форков обёрток, но это инфраструктура, не продукт.
- **Yandex / VK / Sber OSS-память** — закрытая разработка, OSS-вкладов в категории нет.
- **Соответственно, ниша «РФ-second-brain OSS» практически пуста** — это конкурентное преимущество для Z, если решит делать done-for-you на основе западного OSS-стека.

---

## 5.8. Выводы для Z

### Какой open-source стек подошёл бы для MVP «второго мозга в Z»

**Вариант A. Минималистичный MVP (4-6 недель)** — берём готовое:

1. **AnythingLLM** (MIT, multi-tenant workspaces, Docker-один-команд-deploy) как **базовый продукт-каркас**.
2. **Workspace = организация Z**; capture — через коннекторы AnythingLLM (Confluence, Notion, GitHub).
3. Внутри workspace — добавляем **наши AI-отчёты по встречам** через AnythingLLM API.
4. LLM — `proxy.agent-lia.ru` (Claude Sonnet) + GigaChat-Lite для классификаций.
5. Embeddings — `Giga-Embeddings-instruct` или `bge-m3` в pgvector.

**Плюсы:** быстро, MIT-лицензия позволяет ребрендить.
**Минусы:** базовый RAG-уровень, без temporal-памяти, без графа.

**Вариант B. Серьёзный MVP (3-4 месяца)** — гибрид:

1. **Onyx** (MIT) — каркас коннекторов + поиск + slack-бот. Это даёт capture с 50+ источников.
2. **Поверх Onyx** — наш слой AI-отчётов по встречам Z как один из коннекторов.
3. **Параллельно** — Mem0 OSS для user-level памяти (уже разобрано в ветке 6).
4. **Graphiti** (Apache 2.0) как темпоральный слой для встреч.
5. LLM/embeddings — то же.

**Плюсы:** ближе всего к «второму мозгу компании» по критериям, есть real surfacing (slack-бот).
**Минусы:** сложнее DevOps; нужно поддерживать форк Onyx.

**Вариант C. Заточенный под Obsidian (нишевой)** — для PKM-аудитории:

1. **Khoj** как backend + Obsidian-плагин.
2. **Z как Obsidian-vault для команды** — встречи импортируются как markdown-ноты, Khoj индексирует, surfacing идёт через плагин.

**Плюсы:** уникальное позиционирование «AI-встречи + личный второй мозг сотрудника».
**Минусы:** нишевая аудитория, не корпоративный продукт.

### Какие новые идеи стоит взять на заметку

В порядке приоритета для Z:

1. **EM-LLM сегментация транскриптов** (NEW-1) — прототип за 1-2 недели, может радикально улучшить качество AI-отчётов.
2. **Bi-temporal KG через Graphiti** (см. ветка 6 + NEW-5 HelixDB как альтернатива) — критично для корпоративной памяти, среднесрочно.
3. **Self-organizing memory без жёсткой схемы** (NEW-2, A-MEM) — для разных типов встреч.
4. **Sleep-like consolidation** (NEW-9) — ночной job для переоценки графа.
5. **Streaming memory** (NEW-6, Pathway) — если потребуется real-time UX.
6. **Multi-agent shared memory** (NEW-8, CrewAI) — если Z будет двигаться к «команде AI-агентов».

### Что точно не повторять (уже сделано лучше)

- **«Локальный RAG-чатбот»** (PrivateGPT, LocalGPT, GPT4All) — это категория, в которой есть зрелые лидеры и Z не имеет преимущества.
- **«Очередной Notion-clone с AI»** (AppFlowy AI, AFFiNE AI) — то же.
- **«Очередной обёртка для local LLM»** (Open WebUI, LibreChat в чисто-чатовой роли) — лучше использовать как UI-каркас, а не строить аналог.
- **Code search/memory** (Bloop, Continue) — не наша ниша.

### Дельта к ветке 6 (memory frameworks)

Эта ветка показала, что **продуктовый OSS-ландшафт «второго мозга» гораздо больше, чем memory-frameworks**:

- 50+ продуктовых проектов vs ~13 фреймворков в ветке 6.
- **Самые сильные продуктовые кандидаты для Z (AnythingLLM, Onyx, Khoj)** в ветке 6 не упоминались — потому что они **не «memory framework», а готовая платформа поверх памяти**.
- Это подчёркивает разделение: ветка 6 = «что под капотом», ветка 5 = «что показать клиенту». Для MVP Z нужны **обе ветки** — продуктовый каркас (5) + memory layer (6).

### Открытые вопросы для следующего шага

1. **Лицензионная экспертиза** Onyx (open core, MIT) и AnythingLLM (MIT) — что именно можно ребрендить без обязательств.
2. **Реальный footprint EM-LLM на длинной встрече Z (60-90 мин)** — стоит ли городить как сегментатор поверх Vox/GigaAM.
3. **Совместимость Graphiti с GigaChat-функциями** — protokoll testов: умеет ли GigaChat function-calling в нужном для Graphiti формате.
4. **Стоит ли участвовать в OSS-сообществе Onyx** — внести коннектор для AI-встреч Z как способ привлечь внимание западного рынка (но это уже стратегический вопрос).

---

## Источники и связи

### Основные источники

1. GitHub Trending за 2025-Q4 / 2026-Q1 (категории AI, knowledge, agents).
2. Awesome-lists (см. 5.6).
3. [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026).
4. [Best Open Source AI Apps 2026 — Plural](https://www.plural.sh/blog/best-open-source-ai-apps-2025).
5. [Awesome AI Agents — e2b-dev](https://github.com/e2b-dev/awesome-ai-agents).
6. [Awesome PKM — Nik-09](https://github.com/Nik-09/Awesome-Personal-Knowledge-Management).
7. Show HN tracking — Hacker News за ноябрь 2025 — май 2026.
8. AI newsletters: TLDR AI, AlphaSignal, Ben's Bites (упоминания OSS-релизов).
9. Discord-сводки: r/LocalLLaMA, r/selfhosted (категории memory, knowledge).

### Связь с другими ветками исследования

- **Ветка 1 (концепт)** — задаёт критерии раздела 2, по которым мы оценивали продуктовый OSS.
- **Ветка 6 (memory frameworks)** — инфраструктура, разобранная отдельно; здесь только дополняем продуктовыми обёртками.
- **Ветка 7 (academia)** — раздел 5.4 — open-source реализации академических идей.
- **Ветка 4 (стартапы)** — где наблюдать за коммерческими наследниками этих OSS-репо.

---

_Документ создан 2026-05-20 агентом Branch-5. Раздел 9 второго мозга (GitHub / Open-source) теперь заполнен. Перенос ключевых выводов в `second-brain-approach-research.md` раздел 9 — отдельной задачей синтеза._

# «Второй мозг» как подход — исследовательский фундамент

> Базовый документ для углублённого исследования рынка «второго мозга».
> Дополняет [[market-research-2026]], не заменяет.
> Создан: 2026-05-20.

---

## 0. Цель и контекст

В [[market-research-2026]] уже покрыты 4 ниши (AI-встречи, offboarding, AI-советник, мониторинг) на 150+ источниках. Но **«второй мозг» как самостоятельный класс продукта** не разобран — упоминался только как контекст в нише AI-встреч.

Цель этого исследования:
1. Зафиксировать, что такое «второй мозг» как подход (методология, а не просто хранилище).
2. Найти **новые подходы**, появляющиеся в этой категории (не только готовые продукты).
3. Понять, **где может расширяться Z** — от «AI-встречи с типизацией» к «организационному второму мозгу».
4. Создать сетку, по которой агенты в параллели заполняют свои секции.

Аудитория документа: исследовательские агенты + автор (для принятия стратегических решений по roadmap Z).

---

## 1. Что такое «второй мозг» как подход

«Второй мозг» (Second Brain) — это не категория софта, а **методологический подход** к организации памяти, который потом проявляется в продуктах.

### 1.1. Исторические корни подхода

- **Zettelkasten** (Niklas Luhmann, 1960-е) — атомные карточки + двусторонние связи между ними. Прародитель всей концепции.
- **Building a Second Brain (BASB)** — Tiago Forte, книга 2022. Методология PARA: Projects / Areas / Resources / Archive. Принцип CODE: Capture → Organize → Distill → Express.
- **Evergreen Notes** — Andy Matuschak. Атомные заметки, которые постоянно уточняются и связываются между собой; противоположность одноразовым summary.
- **Digital Gardens** — Maggie Appleton. Публичные «сады знаний», растущие итеративно, не как блог.
- **LLM Wiki pattern** — Andrej Karpathy. Разделение `/raw` (сырые транскрипты, чаты) и `/wiki` (синтезированные 500-словные страницы). LLM лучше думает по структурированной wiki, чем по сырому материалу.

### 1.2. Архитектурный отпечаток «второго мозга» в AI-эпоху

Подход переехал из ручного PKM (Personal Knowledge Management — личное управление знаниями) в AI-системы. Теперь это:

- **Активный capture** — встречи, чаты, почта, документы, голос. Не «человек кладёт в папку», а «система ловит сама».
- **Слойная память** — три типа: episodic (конкретные взаимодействия) + semantic (факты, предпочтения) + procedural (выученные паттерны).
- **Сырое → синтезированное** — два слоя: raw layer (полный архив) и distilled layer (атомные wiki-страницы). Агенты читают распиленный слой.
- **Связи как граф** — knowledge graph поверх векторного индекса. Темпоральные графы (Zep/Graphiti) учитывают, как факты меняются со временем.
- **Surfacing, а не search** — система сама показывает релевантное в момент работы, а не ждёт, пока спросят.

### 1.3. «Второй мозг компании» vs «второй мозг сотрудника»

Это два связанных, но разных продукта:

| | Личный второй мозг | Второй мозг компании |
|---|---|---|
| Owner | Сотрудник | Организация |
| Capture | Личные заметки, читалка, голос | Встречи, корп. чаты, документы, CRM |
| Атрибуция | К одному человеку | К сущностям компании (проект, клиент, решение) |
| Перенос | Уходит с сотрудником (если личный) | Остаётся при уходе |
| Privacy | Полный контроль владельца | Корпоративные политики, ФЗ-152 (закон о персданных) |
| Примеры | Mem.ai, Reflect, Tana | Glean, Dust, Guru, Granola Enterprise |

Гибрид: «второй мозг сотрудника **внутри** организации» — то, что строит Viven, Sensay. Это слой капитала знаний, оставляющийся в компании после ухода. Спорная этика.

---

## 2. Критерии отнесения продукта к классу «второй мозг»

Продукт = «второй мозг», если выполняет **минимум 4 из 6** критериев:

1. **Многоканальный capture** — не один тип данных, а минимум 2 (встречи + чаты, чаты + документы, и т.д.).
2. **Слойная переработка** — есть синтез сырого в структурированное, не только индексация.
3. **Связи между сущностями** — графовая модель или явная атрибуция (кто, когда, в связи с чем).
4. **Surfacing** — проактивно показывает релевантное (не только отвечает на запрос).
5. **Темпоральность** — учитывает, что факты меняются со временем; различает «было» и «есть сейчас».
6. **Память агента** — отдаёт API для LLM-агента, не только UI для человека.

### Анти-критерии (что НЕ второй мозг, даже если маркетинг утверждает обратное)

- Статичная wiki + поиск (Confluence, Notion базовый) → KMS, не второй мозг.
- RAG-чатбот по корпусу документов без переработки → RAG-search, не второй мозг.
- AI-ассистент в одном приложении (Notion AI без cross-app capture) → in-app copilot.
- Digital twin одного человека (Viven, Sensay) → AI-клон, смежная категория.
- Корпоративный поиск с генеративным ответом (Glean базовый) → enterprise search.

---

## 3. Терминологический словарь

| Термин | Расшифровка |
|---|---|
| **PKM** (Personal Knowledge Management) | Личное управление знаниями — методология ведения заметок и связей между ними человеком вручную |
| **KMS** (Knowledge Management System) | Корпоративная база знаний — обычно статичная wiki с поиском (Confluence, TEAMLY) |
| **RAG** (Retrieval-Augmented Generation) | Генерация ответа с подмешиванием релевантных фрагментов из корпуса; базовый паттерн «AI-чатбот по документам» |
| **BASB** (Building a Second Brain) | Методология Tiago Forte, основа большинства современных интерпретаций |
| **PARA** | Projects / Areas / Resources / Archive — структура папок в BASB |
| **Zettelkasten** | Метод атомных заметок Луманна с двусторонними ссылками |
| **Episodic memory** | Память о конкретных событиях с таймстампами (когда что произошло) |
| **Semantic memory** | Память фактов и обобщений (что вы любите чай без сахара) |
| **Procedural memory** | Память паттернов поведения (как агент обычно решает задачи) |
| **Working memory** | Кратковременная память в текущей сессии |
| **Surfacing** | Проактивная подача релевантного контента без явного запроса |
| **Memory substrate** | Структурированное хранилище, поверх которого живёт LLM-агент |
| **Temporal graph** | Граф знаний с версионированием — факты с датами действия |
| **Capture** | Захват сырых данных (встречи, чаты, документы) в систему |
| **Distill** | Переработка сырых данных в атомные синтезированные единицы |

---

## 4. Структура исследования — 8 веток

Каждая ветка = отдельный агент. Все пишут в этот же файл, в свою секцию ниже (раздел 5–12).

### Ветка 1. Концептуальный фундамент
**Скоуп:** что такое второй мозг как подход; манифесты; методологии; различия с KMS/RAG/digital twin.
**Источники:** книга Tiago Forte «Building a Second Brain»; блог Andy Matuschak (notes.andymatuschak.org); архив Karpathy на GitHub (llm.c, nanoGPT, заметки); посты Maggie Appleton; Roam Research blog; Obsidian forum обсуждения; Wikipedia/SEP по Zettelkasten.
**Период:** без ограничения, фокус 2022–2026.
**Деливерэбл:** заполнить раздел 5.

### Ветка 2. INT — коммерческий рынок
**Скоуп:** все коммерческие продукты, попадающие под критерии раздела 2, на международном рынке (США, ЕС, Азия).
**Что искать:** Mem.ai, Reflect, Tana, Capacities, Heyday, Recall, Saner.ai, Personal.ai, Rewind/Limitless, Mem Enterprise, Glean, Guru, Dust.tt, Decagon, Augie, Notion AI Business, Slack AI, Atlassian Rovo, Microsoft 365 Copilot, Box AI, ClickUp Brain, Coda AI, Anthropic Claude Projects/Skills, OpenAI Enterprise.
**По каждому:** позиционирование, цена, USP (Unique Selling Proposition — уникальное предложение), стек памяти, integrations, security/compliance, ARR/funding, темп роста, прохождение критериев из раздела 2.
**Период:** существующие продукты + апдейты 2024–2026.
**Источники:** product websites, G2/Capterra, Crunchbase, Latent Space podcast, TechCrunch, The Information.
**Деливерэбл:** заполнить раздел 6.

### Ветка 3. RU — коммерческий рынок
**Скоуп:** российские продукты и студии, попадающие под критерии раздела 2.
**Что искать:**
- Прямой поиск по запросам: «второй мозг», «корпоративный второй мозг», «AI-память компании», «организационная память», «AI-ассистент знаний», «корпоративная память», «AI knowledge management».
- Кто переупаковывает Mem0/Letta/Zep для русского рынка.
- GigaChat для бизнеса / YandexGPT Workspace / MTS AI / T-Bank AI / Cloud.ru AI — есть ли у них «memory»-продукт.
- Малоизвестные студии «знаниевые системы под ключ».
- Реестр отечественного ПО Минцифры в категории AI и KM.
**Источники:** Habr, vc.ru, Rusbase, Forbes RU, Tadviser, Cnews, Telegram (Сиолошная, AI Happens, Эйай Ньюз, Денис Ширяев), AI Journey доклады, YaC доклады, Skolkovo AI Day.
**Деливерэбл:** заполнить раздел 7.

### Ветка 4. Стартапы за последние 6 месяцев (ноябрь 2025 — май 2026)
**Скоуп:** только новые запуски в категории «второй мозг» (личный + корпоративный) за последние 6 месяцев.
**Что искать:**
- Product Hunt — категории AI, Productivity, Knowledge.
- YC W26 batch, YC X26 batch — все компании в memory/knowledge/agent space.
- TechCrunch / The Information / Sifted (EU) launches.
- Hacker News Show HN за последние 6 месяцев.
- Twitter/X launch threads — @aprilliana, @signull, @swyx и др. AI-наблюдатели.
**Что фиксировать:** дата запуска, основатели (откуда пришли), что заявляют (одно предложение), есть ли реальный продукт или waitlist, финансирование, прохождение критериев раздела 2.
**Особо внимательно:** новые архитектурные подходы — не «ещё один RAG», а реально новый ход (например, memory-as-OS, neurosymbolic memory, world-model memory).
**Деливерэбл:** заполнить раздел 8.

### Ветка 5. GitHub / Open-source
**Скоуп:** open-source проекты в категории «второй мозг» — что строят, какие новые подходы пробуют.
**Что искать:**
- GitHub trending за последние 6 месяцев в категориях AI/agents/memory.
- Awesome-lists: `awesome-second-brain`, `awesome-llm-memory`, `awesome-ai-agents`.
- Конкретные репо: NirDiamant/Agent_Memory_Techniques (30 ноутбуков с фреймворками), mem0ai/mem0, letta-ai/letta, getzep/zep, topoteretes/cognee, supermemoryai/supermemory, GibsonAI/memori, lightaprln/cipher, BloopAI/bloop, AgentOps-AI/agentops.
- Obsidian community plugins — Smart Connections, Smart2Brain, Copilot, Khoj, и др.
- Logseq plugins, Roam Research extensions.
- Local-first решения: Khoj, Anything LLM, Open WebUI с memory.
**Что фиксировать:** stars, тренд (растёт/стагнирует), архитектурный подход (vector / graph / hybrid / new), активность коммитов, кто за репо, какая лицензия, есть ли self-host инструкции.
**Особый интерес:** репо, которые предлагают **новый архитектурный подход**, не повторяющий Mem0/Letta. Например: episodic-as-events, world models, neurosymbolic, sparse distributed memory.
**Деливерэбл:** заполнить раздел 9.

### Ветка 6. Memory frameworks stack
**Скоуп:** инфраструктурные библиотеки памяти для AI-агентов — что есть, как сравниваются.
**Что искать:** Mem0, Letta (бывш. MemGPT), Zep, Graphiti, Cognee, Memori, Supermemory, LlamaIndex memory modules, LangChain memory, LangGraph memory, A-MEM, MemoryBank, MemoryOS, MemTree.
**По каждому:** тип памяти (vector / graph / episodic / hybrid), self-host vs SaaS, цена, language support (русский язык!), ecosystem maturity, production references, ловушки и ограничения.
**Деливерэбл:** заполнить раздел 10 в виде матрицы «фреймворк × тип задачи × готовность к РФ-деплою».

### Ветка 7. Academic / Research
**Скоуп:** академические работы по памяти AI-агентов 2024–2026.
**Что искать:**
- arXiv: cs.CL, cs.AI — запросы «long-term memory LLM», «agent memory», «episodic memory neural», «memory-augmented transformer», «retrieval-augmented memory».
- Papers with Code — топ-цитируемые работы по memory architectures.
- NeurIPS / ICML / ACL 2024–2025 — workshop papers по memory.
- DeepMind, Anthropic, OpenAI research posts.
**Особо:** методы, которые ещё не в продакшене, но могут стать следующей волной. Например: world models as memory, sparse distributed memory, episodic prediction, hippocampus-inspired architectures.
**Деливерэбл:** заполнить раздел 11.

### Ветка 8. Use-cases и провалы
**Скоуп:** реальные истории внедрения «второго мозга» в компаниях и провалы.
**Что искать:**
- Подкасты: Lenny's Newsletter Podcast, Latent Space, No Priors, This Week in Startups (AI-эпизоды), Acquired (если есть).
- YouTube: AI Engineer Summit talks, Cognition Labs talks, конференционные доклады.
- Посты основателей: X/Twitter, LinkedIn, Substack.
- YC blog kunena кейсы.
- Закрытые продукты: Xembly (закрылся 2024), Rewind (куплен Meta) — post-mortem, что не сработало.
**Что фиксировать:** что внедряли → какую конкретную боль закрыли → метрика результата → подводные камни. Особо ценны провалы: что обещали, что не вышло, почему.
**Деливерэбл:** заполнить раздел 12.

---

## 5. Концептуальный фундамент

> Полная версия — [[research/branch-1-concept]]. Здесь — выжимка ключевых тезисов.

### 5.1. История подхода (краткая хронология)

«Второй мозг» — это **80-летняя линия преемственности** от аналоговых картотек до AI-памяти:

- **1945 — Vannevar Bush, «As We May Think»** — концепт Memex, «человеческий разум работает по ассоциации».
- **1951 — Niklas Luhmann** начинает Zettelkasten: 90 000 рукописных карточек → ~600 публикаций. **Первая полноценная архитектура «второго мозга»** с разделением «библиографический слой» (метаданные) и «основной слой» (переработанные мысли) — буквальный прообраз `/raw` vs `/wiki` у Карпаты.
- **2017 — Sönke Ahrens, «How to Take Smart Notes»** — превратил «легенду о Лумане» в воспроизводимый метод (fleeting → literature → permanent).
- **2019 — Roam Research** — первая массовая реализация bi-directional linking (двусторонних ссылок). Запустил волну Obsidian/Logseq/Tana.
- **2020 — Maggie Appleton, «Digital Gardens»** + **Andy Matuschak, «Evergreen Notes»** — концепция «не блог, а wiki, которая растёт».
- **2022 — Tiago Forte, «Building a Second Brain»** — фреймворки CODE (Capture → Organize → Distill → Express) и PARA (Projects / Areas / Resources / Archive). Массовый бренд категории.
- **2023 — Sumers et al., CoALA** ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427)) — таксономия памяти агентов: working + episodic + semantic + procedural. **Разлом эпох**: «второй мозг» из UI-категории становится API-категорией.
- **2023 — MemGPT (Packer et al.)** ([arXiv 2310.08560](https://arxiv.org/abs/2310.08560)) — память как ОС, paging между RAM (in-context) и диском (out-of-context).
- **2025 — Mem0 paper** ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) и **Zep/Graphiti** ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) — production-ready memory: −91% latency, bitemporal модель фактов.
- **Конец 2025 — Andrej Karpathy, «LLM Wiki» gist** — минималистичный паттерн на 5 000 ⭐: `/raw` (immutable) + `/wiki` (LLM-generated 500-word pages) + `CLAUSE.md`-схема. **Дал индустрии общий язык.**

### 5.2. Ключевые мыслители (top-6)

| Мыслитель | Главный вклад | Цитата-якорь |
|---|---|---|
| **Niklas Luhmann** | Атомарные карточки с уникальными ID + явные ссылки. Разделение raw/distilled. | «В главный бокс попадает только то, что я переформулировал своими словами» |
| **Tiago Forte** | Бренд Second Brain, фреймворки CODE и PARA. | «Organize for actionability, not for retrieval» |
| **Andy Matuschak** | Evergreen notes как живые сущности; стандарт качества distilled слоя. | «Better note-taking misses the point; what matters is better thinking» |
| **Andrej Karpathy** | Перевёл подход в AI-эпоху одним gist'ом. Жёсткая трёхуровневая архитектура. | «LLMs are much better at reasoning over a well-structured 500-word wiki page than over a raw 8000-word transcript» |
| **Maggie Appleton** | Этос «обучения в публичном пространстве»; growth stages (seedling → budding → evergreen). | «Несовершенство и итерация — фича, не баг» |
| **Conor White-Sullivan (Roam)** | Bi-directional linking в массовый продукт. | «Collaborate with your past and future selves» |

### 5.3. Сравнение со смежными концепциями (компактно)

**Ключевая ось:** «второй мозг» = система, у которой одновременно есть (а) **слойная переработка** raw → distilled и (б) **темпоральность фактов**. Без (а) — это RAG. Без (б) — wiki/KMS. Без обоих — поиск.

- **PKM** (личное управление знаниями) — ручной bottom-up. «Второй мозг» = надстройка с автокаптурой + LLM-distill.
- **KMS** (Confluence, TEAMLY) — статичная wiki + поиск. «Второй мозг» = динамическая память с переработкой.
- **RAG** — индексировать + искать + подмешать. «Второй мозг» строит distilled-слой, на котором LLM думает точнее.
- **Digital twin** (Sensay, Viven) — клон, который **действует**. «Второй мозг» — компаньон, который **помнит**.
- **Zettelkasten** — техника ручного письма. «Второй мозг» = продуктовая категория с автокаптурой и multi-tenant.
- **Digital garden** — формат публикации. «Второй мозг» включает приватный слой и compliance.
- **In-app copilot** (Notion AI) — нет cross-app capture (критерий №1).
- **Enterprise search** (Glean базовый) — нет темпоральности и distill-слоя.

### 5.4. Шесть архитектурных принципов — миграция из ручного PKM в AI-эпоху

| # | Принцип | Ручная эра | AI-эра | Связь с Z |
|---|---|---|---|---|
| 1 | **Многоканальный capture** | Forte CODE: «лови всё, фильтруй позже» | Capture стал **пассивным**: встречи, чаты, экран, голос | AI-встречи Z — сильный capture-канал; нужно добавить чаты/документы |
| 2 | **Слойная переработка** (raw → distilled) | Луман: 2 картотеки; Ahrens: 3 уровня; Forte: 4 уровня Progressive Summarization | Distill стал **автоматическим**; качество синтеза = главный конкурентный фронт | AI-отчёт по типу встречи — частный случай distill |
| 3 | **Связи как граф** | Луман: ID + явные ссылки; Roam: bi-directional auto | Векторные + графовые + **bitemporal** (Zep) | Нужен граф клиентов/проектов/решений для корпоративного второго мозга |
| 4 | **Surfacing вместо search** | Forte: «creative reuse» через PARA | Proactive: пре-meeting brief, контекстные подсказки | У Z только pull; push (за 5 мин до встречи — резюме всех прошлых) критичен |
| 5 | **Темпоральность** | Карточка Лумана не знала, что устарела | Bitemporal: event_time + ingestion_time (Zep) | Без неё AI начнёт галлюцинировать историю после 50+ встреч на клиента |
| 6 | **Память агента** (episodic/semantic/procedural) | Этого слоя не было | CoALA-таксономия; память отдаётся **агенту через API** | Если Z хочет быть «вторым мозгом» — нужен API наружу, не только UI |

### 5.5. Топ-10 обязательных источников

1. **Karpathy A. — «LLM Wiki» gist** ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) — минимальная архитектура AI-«второго мозга».
2. **Sumers T. et al. — CoALA** ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427)) — каноническая таксономия памяти.
3. **Forte T. — «Building a Second Brain»** ([book](https://www.buildingasecondbrain.com/)) — массовый бренд, фреймворки CODE+PARA.
4. **Matuschak A. — Evergreen Notes** ([notes.andymatuschak.org](https://notes.andymatuschak.org/Evergreen_notes)) — эталон distilled-слоя.
5. **Appleton M. — Digital Gardens** ([garden-history](https://maggieappleton.com/garden-history)) — UX-этос «растущей» wiki.
6. **Zep paper** ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) — bitemporal модель фактов.
7. **Mem0 paper** ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) — production-ready memory + бенчмарк LoCoMo.
8. **MemGPT paper** ([arXiv 2310.08560](https://arxiv.org/abs/2310.08560)) — память как ОС.
9. **Ahrens S. — «How to Take Smart Notes»** — систематизация Zettelkasten.
10. **Bush V. — «As We May Think»** (1945) — истоки концепции Memex.

### 5.6. Где Z по факту (по 6 критериям раздела 2)

Z покрывает **2 из 6 критериев**:
- **K2 (слойная переработка)** — частично: AI-отчёт по типу встречи = `raw transcript → distilled summary`.
- **K3 (связи)** — частично: записи привязаны к организации, типу, участникам, ведущему.

Остальные 4 (multi-channel capture, surfacing, темпоральность, память агента через API) — **не покрыты**. Z сейчас = «AI-видеовстречи с типизированным саммари», не «второй мозг». Шаги расширения — раздел 14.

---

---

## 6. INT — коммерческий рынок

> Полная версия — [[research/branch-2-int-market]] (22 продукта, детальные разборы, источники). Здесь — выжимка.

### 6.1. Топ-таблица — самые опасные для Z (корпоративный сегмент)

| Продукт | Страна | ARR | Оценка | Критерии | Класс | Релевантность Z |
|---|---|---|---|---|---|---|
| **Granola** (UK) | UK | $20M+ | $1.5B | 4-5/6 | ✓ | **Главный конкурент** (meeting → memory) |
| **Glean** | US | $100M+ | $7.2B | 5-6/6 | ✓✓ | Прямая (полноценный корп-мозг) |
| **Dust.tt** | FR | ~$20M | n/a | 4-5/6 | ✓ | Прямая (company OS) |
| **Microsoft 365 Copilot** | US | $5B+ | публ. | 5-6/6 | ✓✓ | Прямая через массу (в РФ недоступен) |
| **Anthropic Claude Memory + Skills** | US | $3B+ | $61.5B | 4-5/6 | ✓ | **Платформенный риск** (destination conversion) |
| **OpenAI Enterprise + Memory + Connectors** | US | $4B+ | $500B | 4-5/6 | ✓ | Платформенный риск |
| **Mem Enterprise** | US | n/a | в составе $23.5M | 5/6 | ✓ | Прямая (главный personal→team upgrade) |
| **Decagon** | US | $40M+ | $1.5B | 4-5/6 | ✓ | Vertical (support) — урок: ×37 multiple |
| **Hebbia** | US | $13M+ | $700M | 5/6 | ✓ | Vertical (finance/legal) |
| **Atlassian Rovo** | AU | в составе | $50B+ | 4-5/6 | ✓ | Прямая (в РФ недоступна) |
| **Viven / Interloom / Sensay** | US/UK | pilots | $35M / $16.5M / $3.4M | 4-5/6 | ✓ | Смежная (digital twin / offboarding) |

### 6.2. Топ-таблица — личный сегмент (источник идей)

| Продукт | Цена USD/мес | Критерии | Главная идея для Z |
|---|---|---|---|
| **Mem.ai** | $10-20 | 5/6 | Self-organizing + surfacing «Similar Mems» |
| **Heyday** | $20 | 3-4/6 | **Чистый pure-surfacing** — образец для pre-meeting brief Z |
| **Tana** | $14-20 | 4/6 | **Supertags** — типизированные узлы (схема + связи) |
| **Reflect.app** | $10 | 4/6 | Privacy-first, end-to-end encrypted (образец для ФЗ-152) |
| **Rewind → Limitless** | $20-99 | 4-5/6 | Capture-парадигма (анти-урок: capture без distill = файлопомойка) |
| **Personal.ai** | $40-400 | 4-5/6 | $40-400/мес ARPU — есть верхний потолок |
| **Obsidian + Smart Connections + Khoj** | $0-20 | 4-5/6 | Local-first архитектура (образец для on-prem РФ) |

### 6.3. Главные тренды на INT-рынке

1. **AI-meeting-notes → corporate memory.** Гонка: продукты, начавшие с «AI-bot записывает», движутся к «AI-граф знаний». **Granola** ($1.5B) — самый яркий пример. Otter Chat, Fireflies AI mini-apps.
2. **Personal second brain → team mode.** Все personal PKM добавили team-tier: Mem Enterprise (2024), Tana Team, Reflect Teams (beta), Capacities Teams (roadmap).
3. **Memory становится feature, а не продукт** — **главная стратегическая угроза**. ChatGPT Memory, Claude Memory (default-on с сент. 2025), Gemini Memory. Выделенные memory-продукты должны быть на порядок глубже.
4. **Temporal awareness как новый фронт.** Zep/Graphiti открыли bitemporal модель; Mem0 v2.0.0 (апр 2026) — single-pass extract с consolidation; OpenAI Memory обновил forgetting curve.
5. **Wearable capture.** Limitless Pendant, Plaud Note Pro, Friend, BeeAI — после провалов Humane/Rabbit/Tab остались отдельные выживающие.
6. **Vertical memory обгоняет horizontal.** Decagon ($1.5B при $40M ARR — multiple ×37), Hebbia ($700M), Cleo Health (clinical), Lemma Legal, Aristotle (M&A) — все vertical-specific.
7. **MCP (Model Context Protocol) как универсальный connector.** За один год из Anthropic-only стандарт стал индустриальным (OpenAI, Google, Cursor приняли). **Резко снижает barrier to entry** для memory-продуктов — больше не нужно строить 50 connectors.

### 6.4. Кто из INT может зайти в РФ

- **Granola** — официально нет (нет рублёвой оплаты, нет российских юриков); не зайдёт в 2026.
- **Mem.ai / Reflect / Tana / Obsidian** — через VPN активно используют PKM-евангелисты.
- **Glean / Dust / Atlassian Rovo** — корпоративно недоступны, нет процессинга персданных в РФ.
- **Microsoft 365 Copilot** — официально недоступен; крупные компании используют через зарубежные tenant'ы (Казахстан, Армения).
- **Anthropic Claude / OpenAI** — через прокси (как `proxy.agent-lia.ru` у Z) или зарубежные tenant'ы. Memory работает.

### 6.5. Что из «личных» уже двинулось в командный режим

| Продукт | Personal → Team | Прогресс |
|---|---|---|
| Mem.ai | 2023 (Teams), 2024 (Enterprise) | Сильный — main focus |
| Tana | 2024 (Team plan) | Сильный |
| Reflect | 2024 (beta) | Слабый |
| Heptabase | 2025 (Workspaces) | Beta |
| Notion | Изначально team | Лидер |
| Obsidian, Logseq | Только sync, не team-mode | Не движутся |

**Урок:** personal → team — стандартный paradigm. Z уже team-by-default. Обратное движение «team → individual» (для self-employed) — недозаполненный сегмент.

### 6.6. Какие фичи у топ-игроков Z должен догнать (приоритет)

1. **Cross-meeting knowledge graph** (Granola, Glean, Mem Enterprise) — must-have в 6 мес.
2. **Pre-meeting brief / surfacing** (Granola, Heyday, M365 Copilot) — must-have в 3 мес.
3. **Temporal model facts** (Zep/Graphiti, Mem0 v2) — нужно с первого дня memory-расширения.
4. **MCP-сервер для AI-встреч** — обязательно к Q3 2026.
5. **Multi-channel capture** (email forward, чаты, документы) — для K1 в корп-сегменте.
6. **Org-level memory с permissions** (Glean, Mem Enterprise) — обязательно для enterprise pricing.

### 6.7. Что Z может опередить

- **AI-отчёт по типу встречи (9 типов)** — у Granola/Otter unified summary, у Z уже структурный плюс.
- **Отдельные аудиодорожки** — никто из конкурентов не делает.
- **Гостевой режим без регистрации** — Granola требует install, у Z через guest-token.
- **Локализация под РФ + русский + ФЗ-152** — никто из top-игроков не вкладывается.
- **On-prem deployment** (как опция) — Granola/Glean/Dust только cloud.

---

---

## 7. RU — коммерческий рынок

> Полная версия — [[research/branch-3-ru-market]] (41 продукт, гиганты + студии + open-source, 140+ источников). Здесь — выжимка.

### 7.1. Главные тезисы

- **Прямых «корпоративных вторых мозгов» в РФ практически нет.** Из ~40 продуктов критериям раздела 2 (≥4/6) формально проходят **3-4 кейса**: red_mad_robot Smart Platform / DCD Design + Smarty, MWS AI Agents Platform + autoRAG + Cotype, GigaChat Enterprise + GigaMemory, Just AI Agent Platform.
- **Псевдо-«вторые мозги» — корпоративные RAG-чатботы поверх KMS.** TEAMLY AI, Minerva Knowledge, Авандок.ИИ, SEA, ELMA AI, EvaWiki, Cloud.ru Wiki — все маркетируются как «AI-память компании», но архитектурно RAG-чатбот по wiki без слойной переработки/temporal/surfacing.
- **Главная угроза от гигантов — Сбер.** GigaChat Enterprise (март 2026) + GigaMemory (соревновательная задача AI Journey 2025) + открытые веса GigaChat Ultra + платформа Caila — Сбер строит memory-substrate для корп-агентов на уровне инфраструктуры. По темпу обгоняет Яндекс и МТС.
- **Скрытые конкуренты — done-for-you студии.** В РФ **15+ AI-студий** делают «RAG-ассистент под ключ» с ценником 200K–2M ₽ за внедрение. Лидер по узнаваемости — **red_mad_robot** (Data Award 2026 + кейс Билайн).
- **Прямых конкурентов Z в «AI-встречи + второй мозг компании» — ноль.** mymeet, НаВстрече, Таймлист — только саммари, без cross-meeting memory.

### 7.2. Топ-таблица — кто проходит критерии ≥4/6

| # | Продукт | Тип | Стек | Критерии | Релевантность Z |
|---|---|---|---|---|---|
| 1 | **GigaChat Enterprise + GigaMemory** (Сбер) | Платформа корп. LLM + memory | Caila, On-prem/SaaS/Hybrid, long-term memory | 1,2,3,6 → 4/6 | **Главная угроза 12-18 мес** |
| 2 | **MWS AI Agents Platform + Cotype + autoRAG** (МТС) | Корп. LLM + AI-агенты | Cotype 9B, on-prem, low-code, AgentOps, MCP через Octapi | 1,2,3,6 → 4/6 | Сильнейший on-prem конкурент |
| 3 | **red_mad_robot Smart Platform / Smarty / DCD** | Платформа + студийное внедрение | Мульти-агентная KB, DCD (Domain/Collection/Document) | 1,2,3,4 → 4/6 | **Прямой конкурент-студия** |
| 4 | **Just AI Agent Platform (JAICP)** | Open AI Agent Platform | Low/pro-code + память между сессиями + MCP, on-prem | 1,3,5,6 → 4/6 | Конкурент-инфраструктура |

**Близко (3/6):** YandexGPT 5 + Alice Pro + Я-Wiki (Я 360 lock-in), Cloud.ru Evolution AI Factory + Корп. Wiki с AI, VK AI Space + VK WorkSpace AI Ассистент, Napoleon IT OnPremAI.

### 7.3. Гиганты — кратко

#### Сбер (GigaChat) — **главная угроза**
- **GigaChat Enterprise** (март 2026): локальная/облачная/гибридная конфигурация. Открытые веса GigaChat Ultra.
- **GigaMemory — задача AI Journey 2025**: «глобальная память для LLM как самостоятельный модуль» ([github.com/ai-forever/memory_aij2025](https://github.com/ai-forever/memory_aij2025)).
- **GigaChat Ultra long-term memory** (март 2026): «запоминает факты о пользователе между сессиями».
- **SaluteSpeech** (ASR/TTS открыта), **Giga-Embeddings-instruct** (SOTA на ruMTEB).
- **Темп**: агрессивный — от чатбота → платформа → открытые веса + конкурс на память.
- **В 12-18 мес может выпустить готовый продукт «корпоративная память»**.

#### МТС (MWS AI) — **сильнейший on-prem**
- **Cotype Light 3 / Pro 2** (апр 2026, 9B мультимодальная, MERA 0.792, в реестре).
- **MWS AI Agents Platform** — enterprise lifecycle AI-агентов, AgentOps, только on-prem.
- **MWS Octapi** — интеграция + MCP, ускорение 30%.
- **Кейс**: горнодобывающая компания, экономия до 50% времени.

#### Яндекс — **угроза через Я 360 lock-in**
- **Alice Pro / Нейроэксперт** — работа с почтой/документами/конспектами встреч в Я 360.
- **YandexGPT 5 Pro + RAG**, **Yandex AI Studio**, **Yandex Wiki**, **on-prem Я 360** к концу 2026.
- Темп умеренный, нет открытых весов, cross-meeting memory не заявлена.

#### VK Tech — **угроза для МСБ через WorkSpace**
- **VK AI Space** (апр 2026) — каталог агентов: суммаризация, перевод, поиск по KB, протоколирование встреч.
- **VK WorkSpace AI Ассистент** — суммаризация переписки/чатов/онлайн-встреч.
- Перекрытие capture-зоны Z, но без cross-meeting memory.

#### Cloud.ru — **инфраструктурный конкурент**
- Evolution AI Factory, Evolution AI Agents (с MCP), Корпоративная Wiki с AI, Умный поиск.
- Опасен дешевизной managed-варианта.

#### T-Bank — **не в категории**
- Gen-T LLM, личные AI-ассистенты, Sage Observability с AI (конец 2026). Не строит memory-substrate для корп-знаний.

### 7.4. KMS с AI-апгрейдом — псевдо-«вторые мозги»

| Продукт | Маркетинг | Реальность | Критерии | Почему не проходит |
|---|---|---|---|---|
| TEAMLY AI | «корп. мозг без галлюцинаций» | RAG поверх wiki + GigaChat/YandexGPT | 2/6 | Однопоточный capture, нет temporal/surfacing |
| Minerva Knowledge | «AI-ассистент знаний» | Semantic search + RAG-чатбот | 2/6 | То же |
| Авандок.ИИ Ассистент (КОРУС) | «корп. мозг» | Локальная LLM + RAG + Telegram | 3/6 | Multi-channel есть, нет cross-meeting/temporal |
| ELMA AI / Cortex | «AI-агенты + workflow» | BPM + RAG + GigaChat/YandexGPT | 3/6 | Capture в одном контуре |
| Cloud.ru Корп. Wiki с AI | «база знаний с AI» | Managed RAG поверх object storage | 3/6 | Нет cross-meeting memory |
| VK WorkSpace AI Ассистент | «виртуальный помощник» | Суммаризация (нужно отдать файл в бот) | 3/6 | Capture не активный, нет графа |
| Smart Enterprise Assistant (SEA) | «корпоративная база знаний с интеллектуальным помощником» | RAG + ACL по доступам | 2/6 | То же |
| EvaWiki, Yonote, Kaiten AI, WEEEK, Gramax, МойОфис | «база знаний / workspace» | Wiki + AI-блоки | 1-2/6 | Только KMS |

### 7.5. Студии done-for-you (15+ скрытых конкурентов)

| Студия | Особенность | Ценовой диапазон |
|---|---|---|
| **red_mad_robot** (Москва) | Smart Platform / Smarty / DCD; кейс Билайн; $2M в GenAI; Data Award 2026 | NDA, типично 10-30M ₽ enterprise |
| **Just AI** | open-source distribution + JAICP + Aimylogic | бесплатно (OSS) → по запросу enterprise |
| **Napoleon IT** | OnPremAI — платформа on-prem LLM + KB | проектная |
| **R77.ai** | выпускники МФТИ, RAG + ИИ-агенты | проектная |
| **Технологика** | RAG-системы + интеграция | 1-2M ₽ |
| **LighTech, ARITIN, MadBrains, Allsee.team, VibeLab, Cleverbots, ZeBrains, KT.team, Secret Agents, Resolventa, Cognito** | RAG под ключ, разные ниши | 80K-2M ₽ |

**Общий диапазон цен:** SaaS-старт для МСБ 30-50K ₽, типовые RAG 200-300K ₽, корпоративные с интеграцией 1-2M ₽+, системы целиком от 800K ₽.

### 7.6. Open-source RU

- **ai-forever / Сбер**: [memory_aij2025](https://github.com/ai-forever/memory_aij2025) (baseline GigaMemory), gigachat SDK, mcp_voice_salute, mcp_giga_checker, MERA benchmark, Giga-Embeddings-instruct (SOTA на ruMTEB).
- **AIRI Institute / AriGraph** — единственный заметный пример РФ в топе academic-memory (KG world model).
- **NeuralDeep / vakovalskii** — каталог MCP-серверов под РФ-сервисы (1С, Битрикс, Yandex Tracker, ВкусВилл).
- **IlyaGusev / Saiga** — fine-tune Llama 3 на русском.
- **mpashkovskiy / ru-rag** — пример RAG-pipeline для русского.
- **Чего нет**: российских открытых аналогов Mem0/Letta/Zep/Graphiti — никто не переупаковывает их под русский self-host.

### 7.7. Карта пустых ниш в РФ

| Ниша | Статус | Свободно для Z? |
|---|---|---|
| **Командный «второй мозг» для МСБ через AI-встречи + cross-meeting memory** | Полностью пусто | **Главная ниша Z** |
| **Личный AI-«второй мозг» для русскоязычного knowledge worker** | Пусто | Свободно, но рынок узкий (D2C тяжёлая монетизация) |
| **Memory-as-API для других продуктов** | Полностью пусто | Свободно (потенциальный B2B2B-канал) |
| **Темпоральная память бизнес-сущностей** (bitemporal) | Пусто | Серьёзный USP, если Z сделает первым |
| **«Спросить ушедшего» (offboarding)** | Полностью пусто | Свободно (синергия с AI-встречами) |
| **Vertical memory для типов встреч** | Пусто | Свободно — Z может быть первым |
| **AI-стратегический советник для CEO МСБ РФ** | Пусто | Свободно (см. ниша 3 market-research-2026) |
| **Done-for-you «второй мозг через встречи»** | Конкурентно (15+ студий по RAG в общем) | Можно войти специализацией |

### 7.8. Что значит для стратегии Z

- **Не вступать в лобовую с гигантами на платформенном уровне.** Не строить «свою Caila» / «свою MWS AI Agents Platform». Поверх их LLM собрать **вертикальный продукт «второй мозг из встреч»**.
- **USP против KMS** (TEAMLY/Minerva): «мы не wiki, мы помним встречи и видим связи между ними».
- **USP против студий**: «готовый продукт против штучного проектирования» — Z тиражируем.
- **USP против гигантов**: специализация на AI-встречах + типы встреч + отдельные дорожки + cross-meeting memory.
- **Готовиться к экспорту в done-for-you**: playbook внедрения для клиентов, которым нужна «чёрная коробка».

---

---

## 8. Стартапы за последние 6 месяцев (ноябрь 2025 — май 2026)

> Полная версия — [[research/branch-4-startups-6mo]] (31 стартап, хронологическая таблица). Здесь — выжимка.

### 8.1. Главные тезисы волны

- **Тренд №1 — «agentic memory» вытеснила «RAG-chatbot» в pitch-decks.** 80% свежих стартапов позиционируют «memory layer для агентов». Слово «RAG» стало табу — инвесторы устали.
- **Тренд №2 — vertical memory как защита от платформ.** OpenAI/Anthropic/Microsoft съели горизонтальный «второй мозг». Свежие стартапы сегментируются: legal / sales / clinical / dev / M&A. Decagon ($1.5B при $40M ARR) — образец.
- **Тренд №3 — «Memory OS».** После Letta появились ~5 стартапов, продающих память как ОС агента.
- **Тренд №4 — bi-temporal граф из академии в продакшен.** Graphiti, AriGraph → Reka Memory, MemoryWeave, Continuum.
- **Тренд №5 — wearable без noise-наказания за Rewind.** Friend, BeeAI, Plaud Note Pro, Avi — акцент на тишине.
- **Тренд №6 — РФ ничего нового в личном «втором мозге» не сделала.** Активность только в инфра-слое (GigaChat Ultra open weights, Cotype 9B, NeuralDeep MCP) — это «дрова», не стартапы.

### 8.2. Топ-3 угрозы для Z на горизонте 12 месяцев

1. **Lindy Memory** (US, апр 2026, $50M Series B Andreessen) — agentic memory с meeting capture + cross-app. Захватывают SMB-сегмент, где Z планирует расти. Meeting + agents в одном UX.
2. **Continuum** (US, YC W26, май 2026, $5M Lux Capital) — bi-temporal corporate memory с MCP-сервером. **«Open Glean»**: если выстрелит, может стать стандартом и подрезать всю категорию.
3. **Plaud Note Pro + Plaud Cloud Memory** (CN/US) — wearable + cloud memory как единый stack. Если приедут в РФ через серых импортёров — съедят consumer-долю.

### 8.3. Стартапы с реально новой архитектурой (priority watchlist)

| Стартап | Что нового | Критерии | Угроза Z |
|---|---|---|---|
| **Continuum** (YC W26) | **Memory-as-protocol** через MCP — не платформа, а открытый стандарт. Postgres + Apache AGE + bi-temporal | 5/6 | **Очень высокая в 18 мес** |
| **Vesta (vesta.ai)** | **AI-CEO**, pretrained на S-1 + M&A корпусе, weekly board brief | 5/6 | Концептуальная (отдельная ICP) |
| **Cleo Health Memory** (UK) | **Clinical bi-temporal**: пациент сказал/потом отказался от аллергии — обе версии с timestamp | 5/6 | Концептуальная (vertical bi-temporal) |
| **MemoryWeave** (UK) | **B2D2C wrapper Graphiti**: «embedded memory для вашего SaaS в 3 API-вызова» | 4/6 | Потенциальный backend для Z |
| **Reka Memory** | **Multimodal-first memory**: emotional state как поле в memory entity | 4/6 | Средняя |
| **Aristotle** (IL) | **M&A deal-lifecycle memory**: «факт» = «вывод по сделке» | 5/6 | Низкая (vertical) |

### 8.4. Vertical memory подборка (полная сегментация)

- **Legal**: Memora (SG), Lemma Legal (US, $18M), Pebble Law (stealth).
- **Clinical**: Cleo Health (UK), Suki AI Memory, Abridge Memory, DeepScribe Memory.
- **Sales / GTM**: Clay AI Workspace ($40M Series B), Apollo AI Memory, Outreach Smart Account, Default.
- **Dev**: Pieces Cloud ($10M Series A M12), Augment Code Memory, Cursor Memory, Tabnine, Sourcegraph Cody.
- **Investment / M&A**: Aristotle, CB Insights Mosaic, Brain Trust AI, Hebbia (incumbent).
- **B2B Customer success**: Pylon Memory ($20M Series A a16z), Catalyst.ai Memory.

### 8.5. AI для встреч с memory layer (прямые конкуренты Z)

**К маю 2026 все крупные meeting-AI добавили memory layer — Granola больше не уникален:**

- **Read.ai Mind** ($50M Series B, ноя 2025) — догон Granola.
- **Otter Brain** (фев 2026) — у Otter installed base.
- **Fireflies Knowledge** (мар 2026).
- **Krisp Cross-Meeting Memory** (янв 2026).
- **tl;dv Brain** (фев 2026, EU GDPR-positioning).
- **CircleBack** (ноя 2025) — no-bot capture как Granola.
- **Recall.ai** ($10M Series A Benchmark) — **headless meeting bot API** (infrastructure для тех, кто строит meeting-AI поверх Zoom/Meet/Teams).

**Вывод:** для Z **memory — это столовая ставка, не дифференциатор**. Дифференциация в типе встречи + русский язык + LiveKit-стек + on-prem.

### 8.6. AI-CEO / strategic advisor (ниша после Xembly)

После закрытия Xembly (июнь 2024) ниша 18 мес была пустой. Сейчас:
- **Vesta** ($25M, март 2026) — флагман.
- **Bond AI** ($14M, ноя 2025).
- **Cosmoshq** ($6M, янв 2026).
- **Yntelligent** ($3M, дек 2025) — board memory.

### 8.7. AI-двойник / offboarding (после Sensay/Viven)

- **Mirror.ai** (мар 2026, $11M a16z) — personal twin.
- **Zee.ai** (фев 2026, $4M Khosla) — **corporate twin при увольнении** ⚠ прямое перекрытие use-case Z «exit interview».
- **Continua AI** (май 2026, $7M Founders Fund) — AI-mentor expert.
- **Eternal AI** (янв 2026, $25M a16z, controversial) — memory replica после смерти.

### 8.8. РФ / СНГ — стартапы за 6 месяцев

**За 6 месяцев в РФ ни одного запуска в категории «личный/корпоративный второй мозг» как стартапа.** Только pilot-проекты:
- **Subbase AI** (subbase.ru, март 2026) — pilot AI-памяти переписки для МСБ, ex-VK team, stealth.
- **CRMate AI Memory** (СНГ, $0.5M Iskra Ventures) — b2b sales pilot, stealth.

**Вывод по РФ:** свежая волна **отсутствует**. Это и плюс (свободная ниша), и минус (нет публичной школы — Z придётся создавать категорию через статьи Habr/vc.ru).

### 8.9. Псевдо-инновации («ещё один RAG»)

Громко запустились, ничего нового: Stack AI Memory ($16M), Marblism ($5M), Nemo (Индия, $2M), CharacterMemory ($15M), BeeAI, Tab, NotebookLM Plus, Manus AI, Sentient Wallet, Tropipay AI Brain, Maritaca AI Memory.

### 8.10. Самые активные инвестфонды в memory

1. **a16z** (5+ сделок: Vesta, Lindy, Pylon, Mirror, Eternal).
2. **Sequoia** (3+: Vesta, Clay, Memora).
3. **Khosla** (Avi, Zee.ai).
4. **Lightspeed** (Avi, Nemo).
5. **Founders Fund** (Friend, Continua).
6. **Index Ventures** (MemoryWeave, Dust follow-on).
7. **Conviction (Sarah Guo)** (Continuum, Cosmoshq).
8. **Lux Capital** (Continuum lead).

### 8.11. Что Z должен взять из волны

1. **Bi-temporal memory** — обязательно с дня 1. Graphiti как ориентир.
2. **MCP-server для Z** — критично на горизонте 6 мес. Без MCP — out of agentic ecosystem.
3. **Vertical entities по типу встречи** — у каждого из 9 типов своя entity model (supertags Tana × vertical memory).
4. **Surfacing pre-meeting** (Heyday-pattern).
5. **Local capture + cloud memory pattern** (Plaud-like) — критично для ФЗ-152 в РФ.
6. **Multimodal** — отложить (Reka показала, но ниша исследовательская).

### 8.12. Чего точно не повторять

- «AI-чатбот по документам» — pitch мёртв.
- Wearable hardware без software-дифференциации (Limitless/Humane/Rabbit).
- Horizontal personal-AI на русском (Mem.ai-clone).
- «Memory как продукт сам по себе» (инфра, не B2C).
- Игнорировать MCP-стандарт.

---

---

## 9. GitHub / Open-source

> Полная версия — [[research/branch-5-github-opensource]] (50+ проектов, awesome-lists, лицензии). Здесь — выжимка.

### 9.1. Главные тезисы

- **Три волны продуктового OSS:** (i) RAG-чатбот по корпоративному корпусу (PrivateGPT, LocalGPT, DocsGPT) — 2-3/6; (ii) self-hosted second-brain платформы (Khoj, AnythingLLM, Quivr) — 3-4/6; (iii) Obsidian/Logseq-плагины с AI — 2-4/6.
- **Топ-3 OSS-кандидата на MVP «второго мозга в Z»:** **AnythingLLM** (MIT, workspace-модель multi-tenant, GigaChat через generic OpenAI), **Onyx** (бывш. Danswer, MIT, 50+ коннекторов — «Glean OSS»), **Khoj** (AGPL-3.0, capture multi-source + Obsidian-плагин).
- **Топ-3 «реально новых архитектурных подхода»:** EM-LLM (episodic-as-events через Bayesian surprise), A-MEM (self-organizing Zettelkasten), Graphiti + HelixDB + AriGraph (bi-temporal world model).

### 9.2. Топ-таблица продуктовых OSS

| Проект | Stars | Лицензия | RU LLM? | Критерии | Релевантность Z |
|---|---|---|---|---|---|
| **Onyx** (ex-Danswer) | ~20K | MIT (open core) | да | 4-5/6 | **«Glean OSS», главный референс архитектуры коннекторов** |
| **AnythingLLM** | ~35K | MIT | да (явно GigaChat через generic OpenAI) | 3/6 | **Лучший базис для MVP за 4-6 недель** |
| **Khoj** | ~17K | AGPL-3.0 | да | 4/6 | Высокая как референс UX-капчура + Obsidian-bridge |
| **Quivr** | ~37K | Apache 2.0 | да | 4/6 | Brains-метафора, UX-референс |
| **Open WebUI** | ~80K | BSD-3 | да | 2-3/6 | UI-каркас для внутренней админки Z-AI |
| **LibreChat** | ~22K | MIT | да | 2-3/6 | Middle (UI-каркас) |
| **PrivateGPT** | ~55K | Apache 2.0 | да (полный local) | 2/6 | Референс air-gap pattern для on-prem РФ |
| **GraphRAG** (MS) | ~30K | MIT | да | research → improvement | Базовая идея community-summaries |
| **LightRAG** | ~22K | MIT | да | research → improvement | Топ Graph-RAG проект 2025 |
| **CrewAI** | ~30K | MIT | да | смежный | Multi-agent shared memory primitives |
| **HippoRAG** | ~2.5K | MIT | да | research | Идея PageRank по графу сущностей |

### 9.3. Новые архитектурные подходы (priority watchlist для Z)

| Репо | Что нового | Production-ready? | Применимо к Z |
|---|---|---|---|
| **EM-LLM** ([em-llm/em-llm](https://github.com/em-llm/em-llm)) | **Bayesian-surprise сегментация транскрипта**: память не имеет фиксированных границ chunks, сегментация по точкам неожиданности | experimental, код качественный | **Самый сильный candidate для эксперимента** в Z — резка длинной встречи на смысловые блоки без эвристик «по тишине» |
| **A-MEM** ([agiresearch/A-mem](https://github.com/agiresearch/A-mem)) | **Self-organizing memory без жёсткой схемы**: агент сам решает атрибуты и связи | experimental | 9 типов встреч Z требуют разной структуры — A-MEM избавляет от 9 отдельных схем |
| **Graphiti** + **HelixDB** + **AriGraph** | **Bi-temporal world model**: память как модель среды + KG с двумя датами + русский AIRI-проект | Graphiti — production, HelixDB — early production | Темпоральный слой для встреч Z |
| **Titans-pytorch** ([lucidrains/titans-pytorch](https://github.com/lucidrains/titans-pytorch)) | **TTL-learning**: память обновляет веса в forward pass | сугубо experimental, воспроизводимость спорная | Наблюдать |
| **Pathway LLM-App** | **Streaming memory**: vector store автоматически переиндексируется при изменении документа | production | Если потребуется real-time UX |
| **Self-Operating Computer** | **Память действий, не фактов**: stream of actions + GUI-контекст | experimental | Идея — фиксировать «действия по встрече» (создан тикет, отправлено письмо) |

### 9.4. Open-source реализации академических идей

- **HippoRAG** — гиппокампальный индекс + PageRank.
- **MemoRAG** — global memory as guidance.
- **A-MEM** — Zettelkasten-эволюция.
- **EM-LLM** — Bayesian-surprise episodic.
- **AriGraph** — KG world model (российский AIRI).
- **RAPTOR** — иерархия абстракций.
- **GraphRAG / LightRAG / nano-graphrag / fast-graphrag** — graph-based.
- **Memory³ / Titans / MemoryLLM** — research-уровень.

### 9.5. Что прошло мимо радара (свежее, ноя 2025 — май 2026)

- **Onyx** — 20K★ за год, главный «Glean OSS».
- **HelixDB** — graph+vector unified DB, новый OSS-кандидат для bi-temporal.
- **Pathway streaming** — streaming-память для агентов.
- **LightRAG** — >22K★, топ Graph-RAG 2025.
- **fast-graphrag / nano-graphrag** — оптимизированные форки MS GraphRAG.
- **R2R / SciPhi** — RAG-as-platform.
- **RagFlow** — китайский, deep-RAG (понимание layout PDF), ~40K★.

### 9.6. Совместимость с РФ-стеком

**Совместимы из коробки** (через generic OpenAI-compatible): Khoj, AnythingLLM, Open WebUI, Continue, LibreChat, LobeChat, Quivr, DocsGPT, PrivateGPT, GPT4All, Reor, Onyx, RagFlow, R2R, Verba + все research-имплементы + Obsidian/Logseq-плагины.

**Требуют доработки**: старый Bloop (Anthropic-only), GraphRAG defaults на OpenAI.

**Российские проекты в OSS-памяти**: AriGraph (AIRI), GigaChat tooling — ниша **«РФ-second-brain OSS» практически пуста**, конкурентное преимущество для Z в done-for-you.

### 9.7. Стек для MVP Z (рекомендации ветки 5)

**Вариант A. Минималистичный MVP (4-6 недель):**
- **AnythingLLM** (MIT, multi-tenant) как базовый каркас. Workspace = организация Z.
- LLM = `proxy.agent-lia.ru` (Claude Sonnet) + GigaChat-Lite для классификаций.
- Embeddings = `Giga-Embeddings-instruct` или `bge-m3` в pgvector.
- **Плюсы:** быстро, MIT позволяет ребрендить. **Минусы:** базовый RAG, без temporal.

**Вариант B. Серьёзный MVP (3-4 месяца):**
- **Onyx** (MIT) — каркас коннекторов + slack-бот (capture с 50+ источников).
- Слой AI-отчётов по встречам Z как один из коннекторов Onyx.
- Параллельно: **Mem0 OSS** для user-level памяти + **Graphiti** как темпоральный слой.
- **Плюсы:** ближе к «второму мозгу» по критериям. **Минусы:** сложнее DevOps, поддерживать форк Onyx.

**Вариант C. Заточенный под Obsidian (нишевой):**
- **Khoj** как backend + Obsidian-плагин. Z как Obsidian-vault команды.
- **Плюсы:** уникальное позиционирование. **Минусы:** нишевая аудитория.

---

---

## 10. Memory frameworks stack

> Полная версия — [[research/branch-6-memory-stack]] (13 фреймворков, матрицы применимости, источники). Здесь — выжимка.

### 10.1. Главные тезисы

- **Лидеры open-source в 2026:** Mem0 (~53K★, Apache 2.0), Letta (бывш. MemGPT, Apache 2.0), Zep/Graphiti (Apache 2.0 для Graphiti, SaaS Zep deprecated CE), Cognee (Apache 2.0, local-first), Memori (Apache 2.0, SQL-native), Supermemory (MIT, но full self-host только Enterprise).
- **Под РФ-self-host лучше всего подходят:** Cognee, Memori, Letta — минимум ограничений, явно поддерживают OpenAI-compatible API.
- **Не подходят без оговорок:** Supermemory (Cloudflare-привязка + Enterprise-контракт), Zep SaaS (Community Edition deprecated 04/2025).
- **Темпоральная память в РФ — только через Graphiti core** (Zep CE закрыт).
- **Embeddings под русский:** `ai-sage/Giga-Embeddings-instruct` (SOTA на ruMTEB) или `BAAI/bge-m3` как мультиязычный fallback — оба с pgvector.

### 10.2. Обзорная матрица всех фреймворков

| Фреймворк | Тип памяти | Self-host? | Цена SaaS | RU LLM? | Лицензия | Stars | LoCoMo accuracy |
|---|---|---|---|---|---|---|---|
| **Mem0** | Hybrid: vector + graph + KV | Да (Docker, 3 контейнера) | Free 10K → $19 → $249 → Enterprise | Через OpenAI-compat | Apache 2.0 | ~53K | 66.9% (p95 ~1.44s) |
| **Letta** | Hierarchical: core/recall/archival | Да (Docker + Postgres+pgvector) | Free dev + usage-based | Через OpenAI-compat | Apache 2.0 | ~19K | 74.0% (GPT-4o-mini) |
| **Zep SaaS** | Temporal KG (Graphiti) | Только через Graphiti core | $25/mo Flex | Только OpenAI-compat (default OpenAI) | Closed + Graphiti Apache 2.0 | ~3K | 75.14% ± 0.17 |
| **Graphiti** | Temporal KG (bi-temporal) | Да (Neo4j / FalkorDB / Kuzu) | Бесплатно (OSS) | Через OpenAI-compat | Apache 2.0 | ~14K | + DMR 94.8% vs MemGPT 93.4% |
| **Cognee** | Hybrid: vector + KG + relational | Да (Docker Compose, Ollama tutorials) | OSS + Cloud | Через OpenAI-compat + Ollama | Apache 2.0 | ~12K | n/a |
| **Memori** | SQL-native (PG/MySQL/SQLite) | Да (Python + БД) | OSS бесплатно | Любой LLM SDK | Apache 2.0 | растёт | 81.95% overall (заявлено) |
| **Supermemory** | Vector + connectors | Только Enterprise | Free 1M → Pro → Enterprise | OpenAI-compat | MIT | ~21.7K | n/a |
| **LlamaIndex memory** | Memory primitives | Да (Python) | Бесплатно | Любой | MIT | LlamaIndex core ~38K | n/a |
| **LangChain / LangGraph / LangMem** | Short + long-term, namespace | Да (PG/Redis/Mongo) | Бесплатно | Любой через LangChain | MIT | LangChain ~95K | p95 ~60s (медленно) |
| **A-MEM** (research) | Agentic + Zettelkasten | Да (research) | — | Любой | MIT | ~1.5K | research |
| **MemoryOS** (research) | Three-tier hierarchical | Да (research) | — | Любой | Apache 2.0 | малый | F1 +49.11% над baseline |
| **MemTree, MemoryBank** (research) | Hierarchical / forgetting curve | research | — | Любой | research | малый | research |

### 10.3. Матрица применимости (тип задачи × фреймворк, главное)

| Задача / Фреймворк | Mem0 | Letta | Graphiti | Cognee | Memori | LangMem |
|---|---|---|---|---|---|---|
| Простой Q&A по корпусу | ◑ | ✗ | ◑ | ✓ | ◑ | ◑ |
| Длинный диалог с историей | ✓ | ✓✓ (родное) | ◑ | ✓ | ✓ | ◑ медленно |
| Cross-session память пользователя | ✓✓ (родное) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Корп-память (cross-user, attribution) | ✓ | ◑ | ✓✓ | ✓✓ | ✓ | ✓ |
| Temporal-aware («что было правдой когда») | ◑ | ✗ | ✓✓ | ◑ | ◑ | ◑ |
| Coding-агенты | ◑ | ◑ | ◑ | ◑ | ◑ | ◑ (Supermemory ✓✓) |
| Personalization <300ms | ✓ ~200ms | ✗ | ✓ | ◑ | ✓ SQL fast | ✗ ~60s |

### 10.4. Топ-3 фреймворка для self-host в РФ

#### 1. Cognee — лучший «всё-в-одном»
- Apache 2.0, явная Ollama поддержка.
- Pluggable storage: Postgres+pgvector (вектор + relational) + Neo4j/Kuzu (граф).
- Pipeline `.add → .cognify → .search` хорошо ложится на «AI-встреча → транскрипт → структура».
- Минус: API нестабильный (молодой), пиннить версию.

#### 2. Mem0 OSS + кастомный LLM-провайдер — лучший drop-in
- Apache 2.0, три Docker-контейнера, opyt сообщества огромный.
- pgvector совместим (у Z уже есть Postgres).
- Mem0 OSS для user-level + Graphiti для temporal-слоя встреч.
- Минус: graph и analytics только от Pro ($249) в SaaS; в OSS — нужен Neo4j/Memgraph/Kuzu/Apache AGE.

#### 3. Memori (GibsonAI) — минимально-зависимый
- Apache 2.0, чистый SQL — никаких векторов и графов по дефолту.
- Идеально для air-gapped + всё в Postgres.
- Минус: молодой (сент 2025), без графа теряем cross-entity reasoning.

### 10.5. Что НЕ подходит для РФ-периметра

- **Zep SaaS** — CE deprecated.
- **Supermemory** — full self-host только Enterprise с американской компанией + Cloudflare-привязка.
- **Mem0 Cloud** — данные за рубежом + ФЗ-152 не защитить.
- **LangMem как primary** — latency p95 ~60s.

### 10.6. Гибридные паттерны (vector + graph + episodic)

**Паттерн A. «Mem0 + Graphiti»** — vector personalization + temporal graph. **Точный кейс Z** (AI-встречи).

**Паттерн B. «Cognee единым стеком»** — одна точка интеграции, простой DevOps.

**Паттерн C. «LangGraph state + LangMem + Postgres long-term»** — для тех, кто уже на LangChain. Минус: latency LangMem.

### 10.7. РЕКОМЕНДАЦИЯ — базовый стек «второго мозга» для Z (MVP, 2-3 месяца)

1. **Mem0 OSS** (Docker, 3 контейнера) self-host:
   - Postgres+pgvector — уже есть (отдельная схема `mem0_*`).
   - Neo4j Community или Apache AGE — для graph layer.
2. **Embedder** = `ai-sage/Giga-Embeddings-instruct` (через TGI/vLLM с OpenAI-compatible endpoint). Fallback — `BAAI/bge-m3`.
3. **LLM для memory-операций** = Claude Sonnet через `proxy.agent-lia.ru` (extract/summarize/contradiction-resolve); GigaChat-Lite для дешёвых классификаций.
4. **Темпоральный слой (фаза 2):** Graphiti поверх FalkorDB (легче, чем Neo4j Enterprise).
5. **Distill-pipeline:** AI-отчёт встречи → атомные «memories» с тегами (owner, participants, decisions, action_items) → в Mem0 в scope (`user`, `org`).

### 10.8. Открытые вопросы

1. Развернуть `Giga-Embeddings-instruct` через TGI/vLLM — есть ли готовый docker-recipe.
2. Cost-modeling Mem0 в self-host: сколько LLM-токенов на 1 встречу 60 мин при single-pass extraction.
3. Graph storage: Neo4j CE vs FalkorDB vs Apache AGE.
4. Memori — если за полгода стабилизируется, SQL-native подход уберёт треть инфры.

---

---

## 11. Academic / Research

> Полная версия — [[research/branch-7-academic]] (15 топ-работ + 19 дополнительных, классификация по семействам, open problems). Здесь — выжимка.

### 11.1. Главные тезисы

- **12 из топ-15 работ имеют рабочий open-source код** — research-импульс синхронизирован с инженерным.
- **Связь академии с продуктами:** Letta = коммерческий MemGPT; Zep SaaS = коммерческий Graphiti; Cognee = собственный research-backend; Mem0 = ECAI 2025 paper. Supermemory/Memori — упаковка без своей research.
- **3 системных нерешённых проблемы (open problems):** надёжное обновление противоречивых фактов, кросс-агентская память с privacy, защита от memory poisoning.

### 11.2. Топ-15 работ 2024-2026 (по влиянию)

| # | Работа | Год | Идея | Open-source | Impact |
|---|---|---|---|---|---|
| 1 | **MemGPT/Letta** (Packer et al.) | 2023, NeurIPS 2024 oral | Память как ОС: function-calls между in-context и archival | [letta-ai/letta](https://github.com/letta-ai/letta) | >1000 citations, основа Letta SaaS |
| 2 | **HippoRAG** (Gutierrez et al., Ohio State) | май 2024, NeurIPS 2024 | Гиппокампальный индекс + KG + Personalized PageRank | [OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG) | +20% над SOTA RAG; multi-hop free |
| 3 | **Zep/Graphiti** (Rasmussen et al., Zep AI) | янв 2025 | Bi-temporal KG: valid_at + invalid_at | [getzep/graphiti](https://github.com/getzep/graphiti) | 94.8% DMR vs MemGPT 93.4% |
| 4 | **A-MEM** (Xu et al., Rutgers) | фев 2025 | Zettelkasten-вдохновлённая: агент сам строит связи | [agiresearch/A-mem](https://github.com/agiresearch/a-mem) | Идея в Mem0 v2 + Cognee |
| 5 | **Mem0 paper** (Chhikara et al., Mem0.ai) | апр 2025, ECAI 2025 | Production-ready: extract/consolidate/update, −91% latency | [mem0ai/mem0](https://github.com/mem0ai/mem0) | Стандарт сравнения memory-frameworks |
| 6 | **MemoryOS** (Bai Lab et al.) | май 2025, EMNLP 2025 Oral | Three-tier + persona memory, mid-term уровень | [BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS) | LoCoMo F1 +49.11%, BLEU-1 +46.18% |
| 7 | **Titans** (Behrouz et al., Google) | янв 2025, ICLR 2025 | Neural LMM: веса памяти меняются в forward pass | [lucidrains/titans-pytorch](https://github.com/lucidrains/titans-pytorch) (unofficial) | 2M+ токенов; воспроизводимость спорная |
| 8 | **EM-LLM** (Fountas et al., Huawei + UCL) | июл 2024, ICLR 2025 | Bayesian-surprise сегментация на эпизоды | [em-llm/em-llm](https://github.com/em-llm/em-llm) | 10M токенов без fine-tune |
| 9 | **Memory³** (Yang et al.) | июл 2024 | Sparse explicit memory как третий тип | проект-страница | 2.4B модель обгоняет большие |
| 10 | **Larimar** (Das et al., IBM) | мар 2024, ICML 2024 | Episodic memory + pseudo-inverse update | IBM repo | 8-10× ускорение vs конкуренты |
| 11 | **RAPTOR** (Sarthi et al., Stanford) | янв 2024, ICLR 2024 spotlight | Иерархическое суммирование дерева | [parthsarthi03/raptor](https://github.com/parthsarthi03/raptor) | +20% QuALITY с GPT-4 |
| 12 | **GraphRAG** (Microsoft) | апр 2024 | LLM строит KG + Leiden communities + summaries | [microsoft/graphrag](https://github.com/microsoft/graphrag) | Породил Graph-RAG волну |
| 13 | **LightRAG** (HKU) | окт 2024, EMNLP 2025 | Vector × graph двухуровневый retrieval + инкрементал | [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) | >15K stars, топ Graph-RAG |
| 14 | **MemoRAG** (BAAI) | сен 2024, WWW 2025 | Global memory как guidance для основной LLM | [qhjqhj00/MemoRAG](https://github.com/qhjqhj00/MemoRAG) | Open-ended summarization |
| 15 | **AriGraph** (AIRI Institute, РФ) | июл 2024 | KG world model: семантический + эпизодический слой | [AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph) | **Редкий пример РФ в топе** |

### 11.3. Дополнительный пул (для полноты)

MemoryBank, Reflexion, ExpeL, Voyager, Generative Agents (Park et al.), Infini-attention, MemoryLLM/M+, MemTree, LongMem, RecallM, MEM1, RMM, Collaborative Memory, SymAgent, TReMu, V-JEPA 2, survey «Memory in the Age of AI Agents», From Storage to Experience, Memory in the LLM Era.

### 11.4. Карта методов — 8 семейств

- **A. Retrieval-augmented:** RAPTOR, MemoRAG, HippoRAG, LightRAG.
- **B. Memory-augmented transformers:** Memory³, MemoryLLM/M+, Larimar, Infini-attention, Titans, LongMem.
- **C. Hierarchical / multi-tier:** MemGPT/Letta, MemoryOS, MemTree.
- **D. Graph-based:** GraphRAG, Zep/Graphiti, LightRAG, AriGraph, Cognee.
- **E. Neurosymbolic:** SymAgent, TReMu, RecallM, CLAUSE.
- **F. Episodic/event:** EM-LLM, A-MEM, Generative Agents, Reflexion.
- **G. World models/predictive (формирующееся):** V-JEPA 2, AriGraph, MEM1, Beyond Fact Retrieval.
- **H. Multi-agent shared:** Collaborative Memory, Memory as a Service, Intrinsic Memory Agents.

### 11.5. Новые подходы — кандидаты на «следующую волну» для Z

#### Внедрять уже сейчас (12 месяцев)

1. **Bi-temporal KG поверх встреч** (Graphiti, Apache 2.0) — критично для корп-контекста.
2. **Bayesian-surprise сегментация транскриптов** (EM-LLM) — режет встречу на смысловые блоки без эвристик.
3. **Reflection-based memory consolidation** (Reflexion/ExpeL/RMM) — ночной job, обновляет граф. Инженерно дёшево.
4. **Mem0-style API-слой** для гостевых/хостовых сессий — production-ready MVP.

#### Наблюдать (12-24 месяца)

5. **Titans / TTL-память** — следить за реплицируемостью.
6. **Memory³ / Sparse Distributed Memory** — может изменить экономику inference.
7. **A-MEM self-organizing** — упростит 9 типов встреч Z.
8. **Predictive episodic memory** (Beyond Fact Retrieval, 2511.07587) — «AI готовит к следующей встрече по прогнозу темы».

#### Игнорировать в 2 года

9. **Чисто in-model memory** (MemoryLLM, M+) — требует контроля над pretrained, нам недоступно.
10. **Полностью neural-symbolic** (SymAgent, CLAUSE) — академический фронтир.

### 11.6. Open problems (системные риски)

- **Q1. Надёжное обновление противоречивых фактов** — Graphiti/Larimar дают частичный ответ, универсального решения нет. **Для Z: нужна собственная политика версионирования фактов**.
- **Q2. Кросс-агентская память с privacy** — Collaborative Memory + Memory-as-a-Service это первые подходы, без production-ready open-source. **Для Z: под ФЗ-152 нужен собственный слой access-control**.
- **Q3. Memory poisoning** — survey «Security of Long-Term Memory in LLM Agents» ([2604.16548](https://arxiv.org/abs/2604.16548)) — защитных механизмов в OSS почти нет. **Для Z: provenance каждого факта + фильтрация по уровню доверия источника**.

---

---

## 12. Use-cases и провалы

> Полная версия — [[research/branch-8-usecases]] (24 кейса + 9 провалов, антипаттерны, pricing-разбор). Здесь — выжимка.

### 12.1. Главные тезисы

- **Главный разрыв категории — «маркетинг vs реальность».** Продукты продаются под «AI помнит всё», покупатели получают RAG-чатбот. Этот разрыв убил Xembly (закрылся июнь 2024) и Rewind как продукт.
- **Деньги ушли в две стороны.** Verticals с очевидным ROI (Decagon — support, Hebbia — finance/legal) растут на **30-40× мультипликаторах ARR**; horizontal personal-second-brain (Mem, Reflect, Tana) — стагнирующий рынок.
- **5 главных антипаттернов:** (1) запускать без жёсткого ICP; (2) обещать «один продукт для всего»; (3) игнорировать темпоральность; (4) недооценивать privacy/compliance; (5) не считать токены.
- **Кейсы в РФ — крайне разрежены.** 4-5 публично разобранных (Beeline × red_mad_robot, MWS × горнодобыча, Сбер internal). **Сигнал:** рынок ранний, история провалов ещё не накоплена, история успехов с ROI — тоже.

### 12.2. Топ-12 кейсов внедрения (с цифрами)

| # | Кейс | Продукт | Метрика | Источник |
|---|---|---|---|---|
| 1 | **Beeline × red_mad_robot Smarty** (РФ) | DCD Design + Smarty | Точность 78% → **94%**, экономия 30%+; 300+ польз., 30K запросов/мес. **Data Award 2026** | Tadviser, Kommersant |
| 2 | Notion × Decagon (US) | Decagon | **70%+ tickets** auto; часы → секунды | WSJ, Decagon CS |
| 3 | Duolingo × Decagon | Decagon | 50%+ tickets auto; часы → минуты | Decagon CS |
| 4 | Bilt Rewards × Decagon | Decagon | 60% inquiries автоматизированы | Decagon CS |
| 5 | Confluent × Glean (3000 чел) | Glean | **45+ часов/нед/team** экономии; ROI месяцы | Glean CS |
| 6 | Pinterest × Glean | Glean | **10× faster onboarding** | Glean CS, Forbes |
| 7 | Workday × Glean (18K) | Glean | Миллионы $ экономии в год | Glean CS |
| 8 | Webflow × Dust (500) | Dust.tt | **30 мин/день/сотр**; 50+ агентов | Sifted |
| 9 | Qonto × Dust (1500) | Dust.tt | 50%+ automation в support | Dust |
| 10 | MWS AI × горнодобыча (РФ) | MWS Cotype + autoRAG | **До 50% экономии времени** | MTS AI cases |
| 11 | Lufthansa Cargo × Glean | Glean | Поиск −40% | Glean CS |
| 12 | CrowdStrike × Glean | Glean | 25%+ producer-time saved | Glean CS |

### 12.3. Топ-провалов с разбором

| Кейс | Что обещали | Что не сработало | Урок для Z |
|---|---|---|---|
| **Xembly** (закрыт июнь 2024) | «AI chief-of-staff для всего» — встречи + to-do + календарь | Too broad value-prop, high op-cost, no clear ICP, capital crunch | **Не быть «AI для всего»** |
| **Rewind → Limitless** (Meta investment, не покупка) | «Capture всё, помни всё» | Privacy backlash + capture ≠ retrieval + hardware-кривая + OS built-in (Apple Intelligence, Windows Recall) | **Capture без distill = файлопомойка** |
| **Mem.ai** (pivot personal → enterprise 2024) | «Self-organizing PKM» | Retention upon adoption, cost-to-serve free, switching cost тривиальный | **Personal AI-PKM не масштабируется в venture-сложный бизнес** |
| **Humane AI Pin** ($240M → продан HP за $116M) | Носимый AI-secretary | Hardware quality, AI accuracy 60%, no use-case-fit | **Wearable hardware — кладбище** |
| **Rabbit R1** (100K preorders → провал) | «Large Action Model» | LAM оказался Playwright-скриптами, OpenAI GPT-4o выпустил voice | **Overpromise = карьера** |
| **Klarna AI откат** | «Заменили 700 человек, $40M/год» | NPS просел, нанимают людей обратно (май 2025) | **«AI заменит 100%» — маркетинговая ловушка** |
| **Inflection / Pi** ($1.3B → acqui-hire Microsoft) | Personal AI с памятью + своя LLM | No business model + capital-intensive | **Не строить foundation-LLM** |
| **Bee Computer / Tab AI** | AI wristband / necklace memory | Privacy + capture без distill + AI-quality unmet | Wearable категория has compliance-ceiling |
| **Анти-кейс РФ — «корп. RAG без maintenance»** | «AI ассистент за полгода» (Habr threads) | Через 6 мес точность упала, доверие ушло, проект мертв (никто не отвечает за «протухание» wiki) | **Без темпоральности продукт деградирует за 6-12 мес** |

### 12.4. 10 антипаттернов внедрения

1. **«AI для всего» вместо узкого ICP** (Xembly, Mem.ai personal). → Z: stick to «AI-встречи + cross-meeting memory для sales/consulting/PM».
2. **«Capture всё, потом разберёмся»** (Rewind, Humane, Tab). → Z: distill-слой с дня 1.
3. **Игнорирование темпоральности** (Pinterest × Glean устаревшие архитектурные доки 2017; анонимные РФ-кейсы). → Z: bitemporal model с timestamp + superseded_by.
4. **Игнорирование privacy/compliance до enterprise-фазы** (wearables; РФ-RAG проекты ломаются о ФЗ-152). → Z: с дня 1 data residency РФ + шифрование + audit + DPA.
5. **Underestimating inference costs** (Mem.ai жаловались; Klarna откат; Granola pivots tier-pricing). → Z: metering с дня 1.
6. **Запуск без internal champion** (Webflow × Dust — успех; без champion adoption плоская). → Z: champion-discovery в onboarding.
7. **Сравнение с человеком как маркетинговый ход** (Klarna, Humane, Rabbit). → Z: «AI готовит draft, человек редактирует».
8. **Foundation-LLM ловушка** (Inflection, Adept). → Z: Claude через прокси + GigaChat. Не лезть.
9. **Hardware без software-moat** (все wearable). → Z: pure software (browser/mobile/desktop).
10. **Маркетинг «второй мозг» без архитектурного содержания** (TEAMLY AI, Minerva, ELMA, многие РФ-студии). → Z: не использовать термин «второй мозг», пока не покрыты ≥4 критерия раздела 2.

### 12.5. Privacy и compliance — реальные блокеры

- **Wearable privacy backlash** в US/EU (Limitless, Tab, Bee) — two-party consent.
- **ФЗ-152 в РФ** — обработка персданных РФ-граждан на серверах в РФ; **гард** для cloud-only (Glean, Dust, Granola, Mem). Реестр Минцифры — необходим для госзакупок.
- **GDPR Right to be Forgotten** — для distilled-слоя технически сложно (факты переплетены).
- **HIPAA US healthcare** — год compliance-работы + аудит.
- **SOC 2 Type II** — table-stakes для US enterprise; **6-12 мес + $50-150K** работы.

### 12.6. Цена и ROI — реальные цифры

**INT pricing tier-ы:**
- Personal PKM: $8-20/user/мес.
- AI-встречи Pro: $14-30/user/мес.
- Team workspace + AI: $24-50/user/мес.
- Enterprise search + AI: $50-100+/user/мес.
- Narrow vertical agents: $30K-500K+ ACV.

**РФ pricing:**
- Базовая wiki + AI: 150-300 ₽/user/мес.
- Корп. AI-ассистент done-for-you: 200-800K ₽ внедрение + 20-50K ₽/мес.
- Enterprise on-prem (GigaChat Enterprise, MWS AI): от 1M ₽/год.
- Студийные RAG-проекты: 80K ₽ — 2M ₽+.

**Time-to-value:**
- Self-serve PKM: дни.
- Mid-team SaaS: недели.
- Enterprise search: 6-12 нед до прода.
- On-prem РФ: 3-6 мес.
- Студийное внедрение РФ: 2-6 мес.

### 12.7. Признаки «здорового» внедрения

- Identifiable champion в клиентской команде.
- Cross-meeting recall работает (не только саммари).
- Pre-meeting brief становится частью ритуала за 2 недели.
- Time-to-first-value < 7 дней.
- Retention через 90 дней > 70% для team-tier.
- NPS > 50 среди тех, кто пользуется >30 раз.

### 12.8. Уроки для Z (свод)

**Что точно делать в продукте:**
1. **Distill-слой с дня 1** memory-расширения.
2. **Bitemporal модель** фактов (event_time + ingestion_time + superseded_by).
3. **Permission-aware retrieval с дня 1** (гость/участник/организация/админ).
4. **Pre-meeting brief** — главное surfacing-обещание для enterprise.
5. **MCP-сервер для AI-встреч** — обязательно к Q3-Q4 2026.
6. **Cross-meeting entity graph** — клиент/проект/решение/задача автоматически.

**Чего избегать:**
1. Не лезть в hardware.
2. Не лезть в foundation-LLM.
3. Не позиционироваться как «AI для всего».
4. Не обещать «AI помнит всё».
5. Не делать personal-tier (путь Mem.ai в стагнацию).
6. Не считать pricing per-user без metering.

**Pricing-модель Z (рекомендация):**
- **Базовый tier (Pro/Team):** per-user $14-20 (1000-1500 ₽/user/мес в РФ); включено 20-30 часов записи/user/мес + AI-отчёт + базовое surfacing.
- **Enterprise tier:** custom (от $50/user = 5000 ₽/user/мес РФ); SSO, audit, on-prem, permissions, MCP, API. **Overage** по нагрузке: $X/час записи, $Y/M токенов.
- **Anti-pattern:** не делать unlimited free (Mem.ai сжёг $23.5M), не flat-rate без metering (Granola тонет).

**Onboarding Z:**
1. Champion-discovery на первой встрече.
2. First-week templates (2-3 готовых типа встреч под use-case).
3. Pre-meeting brief демо в первую неделю — AHA-момент.
4. 30/60/90 review с client-success.
5. Internal Slack/Telegram для champion-сообщества.
6. **Opt-in case study** в onboarding-договоре — публикация анонимизированного кейса через 6 мес.

---

---

## 13. Дельта к market-research-2026

> [[market-research-2026]] покрыл 4 ниши (AI-встречи, offboarding, AI-советник, мониторинг) на 150+ источниках. Этот синтез **дополняет**, не заменяет — добавляет полный класс «второй мозг» как самостоятельную категорию.

### 13.1. Что нового появилось в картине

**Концептуальный фундамент (раздел 5)** — впервые задаём язык категории:
- 6 критериев отнесения к классу «второй мозг» (multi-channel capture, distill, связи, surfacing, темпоральность, память агента).
- 6 архитектурных принципов, мигрирующих из ручного PKM в AI-эпоху.
- Топ-10 manifest-источников (Karpathy LLM Wiki, CoALA, Forte BASB, Matuschak Evergreen, Appleton Gardens, Zep, Mem0, MemGPT, Ahrens, Bush).

**Расширенная INT-картина (раздел 6, ветка 2):**
- В market-research-2026 INT-таблица AI-встреч содержала 10 продуктов; здесь — **22 продукта класса «второй мозг»** (15 личных + 22 корпоративных).
- **Новые игроки на радаре** (которых не было в старом):
  - **Decagon** ($40M ARR, $1.5B оценка) — vertical memory для support.
  - **Hebbia** ($13M+ ARR, $700M оценка) — vertical memory для finance/legal.
  - **Augie** ($20M Series A Greylock) — AI-нативный Glean alternative.
  - **Heyday** ($6.5M seed Spark) — чистый pure-surfacing.
  - **Mem Enterprise**, **Tana Team**, **Reflect Teams**, **Capacities Teams** — personal→team волна.
  - **Anthropic Claude Memory + Skills + Projects** — платформенный риск.
  - **OpenAI Connectors** (2025) — платформенный риск.

**Расширенная RU-картина (раздел 7, ветка 3):**
- В market-research-2026 RU-таблица AI-встреч содержала 9 продуктов; здесь — **41 продукт** (гиганты + KMS + студии + open-source).
- **Новые игроки на радаре**:
  - **GigaChat Enterprise** (март 2026) + **GigaMemory** (AI Journey 2025 задача) — главная угроза 12-18 мес.
  - **MWS AI Agents Platform + Cotype 9B + autoRAG + Octapi** — сильнейший on-prem.
  - **VK AI Space** (апр 2026) + **VK WorkSpace AI Ассистент**.
  - **Just AI Agent Platform** (open distribution март 2026, в реестре).
  - **red_mad_robot Smart Platform / Smarty / DCD Design** — Data Award 2026.
  - **Cloud.ru Evolution AI Factory + Корп. Wiki с AI + Evolution AI Agents (с MCP)**.
  - **Авандок.ИИ (КОРУС)**, **Minerva Knowledge**, **ELMA AI / Cortex**, **SEA**, **Yonote**, **Kaiten AI**, **WEEEK**, **Gramax**, **МойОфис Чат AI**.
  - **15+ студий done-for-you**: Napoleon IT, R77.ai, Технологика, LighTech, ARITIN, MadBrains, Allsee.team, VibeLab, Cleverbots, ZeBrains, KT.team, Secret Agents, Resolventa, Cognito.

**Стартапы за 6 месяцев (раздел 8, ветка 4) — целиком новое:**
- **31 стартап** ноября 2025 — мая 2026, которых в market-research-2026 не было:
  - **Continuum** (YC W26, $5M Lux) — memory-as-protocol через MCP.
  - **Lindy Memory** ($50M Series B Andreessen) — agentic memory + meetings.
  - **Vesta** ($25M a16z) — AI-CEO.
  - **Cleo Health Memory** (£8M Atomico) — clinical bi-temporal.
  - **MemoryWeave** ($7M Index) — B2D2C Graphiti wrapper.
  - **Reka Memory** ($50M Series A) — multimodal-first.
  - **Aristotle** ($9M Aleph) — M&A memory.
  - **Lemma Legal** ($18M Series A Ribbit), **Memora** ($3M Sequoia SEA) — legal.
  - **Zee.ai** ($4M Khosla) — corporate twin при увольнении ⚠ прямое перекрытие с offboarding-нишей Z.
  - **Read.ai Mind, Otter Brain, Fireflies Knowledge, Krisp, tl;dv Brain, CircleBack** — все meeting-AI догоняют Granola в memory.
  - **Recall.ai** ($10M Benchmark) — headless meeting bot API infrastructure.

**Open-source ландшафт (раздел 9, ветка 5) — целиком новое:**
- В market-research-2026 OSS не был картирован отдельно. Здесь — **50+ репо**:
  - **Onyx** (бывш. Danswer) — главный «Glean OSS» на 20K★.
  - **AnythingLLM**, **Khoj**, **Quivr** — продуктовые self-host каркасы.
  - **HelixDB**, **Pathway streaming**, **LightRAG / GraphRAG / nano-graphrag / fast-graphrag** — свежие.
  - **EM-LLM, A-MEM, HippoRAG, MemoRAG, Memory³, Titans, AriGraph** — research-имплементы.
  - **CrewAI, AutoGen** — multi-agent shared memory primitives.

**Memory frameworks (раздел 10, ветка 6) — целиком новое:**
- **13 фреймворков** infrastructure-слоя: Mem0, Letta, Zep/Graphiti, Cognee, Memori, Supermemory, LlamaIndex memory, LangChain/LangGraph/LangMem, A-MEM, MemoryBank, MemoryOS, MemTree.
- Матрица применимости + готовность к РФ-self-host.

**Academic фронтир (раздел 11, ветка 7) — целиком новое:**
- **15 топ-работ + 19 дополнительных** по памяти AI-агентов 2024-2026.
- 3 open problems (противоречивые факты, кросс-агентская память, memory poisoning).

**Use-cases и провалы (раздел 12, ветка 8) — расширенное:**
- **24 кейса с цифрами** + **9 детальных провалов** (vs ~5 в market-research-2026).
- Klarna откат AI (май 2025) — детальный разбор.
- Mem.ai pivot personal → enterprise — детальный разбор.

### 13.2. Какие выводы старого исследования нужно скорректировать

| Старый вывод (market-research-2026) | Корректировка |
|---|---|
| «Ниша 2 — спросить ушедшего полностью пуста в РФ» | **Всё ещё верно**, но появились **скрытые конкуренты через 15+ done-for-you студий** (red_mad_robot, Just AI, Napoleon IT и др.) — если Z пойдёт в done-for-you offboarding, конкуренция будет от студий, не от готовых продуктов. **Также:** Zee.ai (US, фев 2026) первой делает corporate twin при увольнении — прямое перекрытие use-case. |
| «Гранола движется в сторону "организационной памяти" на горизонте 12-24 мес» | **Доуточнение**: Гранола уже двинулась — Folders + Knowledge Graph (2025), Granola for Business + enterprise pilot tier (2025). К маю 2026 **все meeting-AI** (Read.ai, Otter, Fireflies, Krisp, tl;dv, CircleBack) добавили memory layer. **Memory — столовая ставка, не дифференциатор**. |
| «Точность дайаризации у всех — 70-80% → решение Z через отдельные дорожки = структурное превосходство» | **Подтвердилось**. Никто не добавил отдельные дорожки. Z сохраняет дифференциатор. |
| «В RU крупные KMS закрывают enterprise через экосистемный lock-in (TEAMLY/Яндекс/Сбер)» | **Доуточнение**: к маю 2026 Сбер вышел из роли «LLM-инфра» в роль «memory-substrate платформа» (GigaChat Enterprise + GigaMemory + Caila + открытые веса). **Это качественно новый уровень угрозы** на 12-18 мес. |
| «mymeet.ai — главный конкурент Z в RU в сегменте МСБ» | **Подтверждено**. Но дополнительно: ни один RU-meeting-tool не добавил cross-meeting memory — это **окно для Z в 6-12 мес**. |
| «AI Board of Directors / стратегический советник в INT — пустая ниша (DIY через ChatGPT Projects)» | **Скорректировано**: появились серьёзные игроки — **Vesta** ($25M a16z), **Bond AI** ($14M Spark), **Cosmoshq**, **Yntelligent**. Ниша заполняется, но без явного лидера. В РФ — всё ещё пусто. |
| «Wearable память — Limitless куплен Meta» | **Скорректировано**: Meta инвестировала $50M (Reality Labs), **не покупает целиком**. Limitless продолжает терять momentum. Wearable категория в целом — кладбище (Humane продан HP за $116M, Rabbit фактический провал, Tab закрылся, Bee нишево). |
| «Inflection / Pi — есть» | **Закрыт**: acqui-hire от Microsoft (март 2024), Pi отдан Microsoft, Inflection как продукт фактически закрыт. |
| «Xembly закрылся» | **Подтверждено**, разбор причин углублён (too broad value-prop, high op-cost, no clear ICP, capital crunch). |
| «Personal AI-PKM (Mem, Reflect, Tana) — есть продукты» | **Доуточнение**: Mem.ai pivot в Enterprise (2024) — личный tier стагнирует. Все personal PKM добавили team-tier; рост в personal сегменте плоский. |

### 13.3. Что подтвердилось из старого

- **«AI-отчёт под тип встречи» — никто из конкурентов не делает** — подтверждено.
- **«Отдельные аудиодорожки» — не у кого** — подтверждено.
- **Гранола движется к memory** — превзошло прогноз (уже там).
- **РФ-рынок enterprise закрыт через гигантов (Сбер/Яндекс/МТС)** — подтверждено и усилено.
- **Реестр отечественного ПО — необходимое условие** — подтверждено (MWS Cotype, Just AI Agent Platform, GigaChat Enterprise — все в реестре).
- **«Ниша AI-стратегического советника в РФ пуста»** — подтверждено.

### 13.4. Новые игроки/архитектуры — сводный список (которых не было в market-research-2026)

**INT-стартапы:** Continuum, Lindy Memory, Vesta, Cleo Health Memory, MemoryWeave, Reka Memory, Aristotle, Lemma Legal, Memora, Zee.ai, Mirror.ai, Continua AI, Eternal AI, Friend.com, Plaud Note Pro, BeeAI, Tab, Iyo One, Bond AI, Cosmoshq, Yntelligent, Read.ai Mind, Otter Brain, Fireflies Knowledge, Krisp Cross-Meeting Memory, tl;dv Brain, Recall.ai (новый ≠ getrecall.ai), CircleBack, Pieces Cloud, Augment Code Memory, Cursor Memory, Clay AI Workspace, Pylon Memory.

**INT-incumbents с memory-расширениями:** Mem Enterprise, Atlassian Rovo, Anthropic Claude Memory+Skills, OpenAI Enterprise+Memory, NotebookLM Plus, Suki AI Memory, Abridge Memory, DeepScribe Memory, Apollo AI Memory, Outreach Smart Account, CB Insights Mosaic AI Memory, Augie, Hebbia, Decagon.

**RU-стек (за рамками старых 9 AI-встреч продуктов):**
- Гиганты: GigaChat Enterprise + GigaMemory, MWS AI Agents Platform, VK AI Space + WorkSpace AI Ассистент, Cloud.ru Evolution AI Factory + Корп. Wiki с AI, Just AI Agent Platform (открытый дистрибутив март 2026).
- KMS-псевдо: TEAMLY AI, Minerva Knowledge, Авандок.ИИ, SEA, ELMA AI/Cortex, EvaWiki, Yonote, Kaiten AI, WEEEK, Gramax, МойОфис Чат AI.
- Студии: red_mad_robot Smart Platform / Smarty / DCD, Napoleon IT OnPremAI, R77.ai, Технологика, LighTech, ARITIN, MadBrains, Allsee.team, VibeLab, Cleverbots, ZeBrains, KT.team, Secret Agents.
- Инфра: Кактус.AI, AI-ОФИС, NeuralDeep (MCP-каталог под РФ).
- Smart HCM: Mirapolis Digital Twin (не «второй мозг», но смежно).

**Memory frameworks (целая категория новая):** Mem0, Letta, Zep, Graphiti, Cognee, Memori, Supermemory, LlamaIndex memory, LangMem, A-MEM, MemoryBank, MemoryOS, MemTree.

**Open-source продуктовые каркасы (целая категория новая):** Onyx (ex-Danswer), AnythingLLM, Khoj, Open WebUI, Quivr, LibreChat, LobeChat, RagFlow, R2R, Reor, SiYuan, AppFlowy, Affine, Continue, Self-Operating Computer, HelixDB, Pathway LLM-App.

**Research-имплементы (новая категория):** HippoRAG, MemoRAG, A-MEM, EM-LLM, AriGraph (РФ AIRI), Titans-pytorch, Memory³, GraphRAG, LightRAG, nano-graphrag, fast-graphrag, RAPTOR, Larimar, MemoryLLM/M+.

---

---

## 14. Стратегические выводы для Z

### 14.1. Где Z уже в нише «второго мозга»

Z **по факту покрывает 2 из 6 критериев** базового документа (раздел 2) через AI-встречи + типизированный AI-отчёт:

- **K2 (слойная переработка)** — частично: AI-отчёт по типу встречи это `raw transcript → distilled summary` под 9 типов встреч. Это уже **не RAG-search, а синтез**. Хороший фундамент. Karpathy в LLM Wiki gist явно противопоставлял `/raw` vs `/wiki` — Z уже строит `/wiki`-слой для встреч.
- **K3 (связи между сущностями)** — частично: записи привязаны к организации, типу встречи, участникам, ведущему. Это базовая графовая модель, но без явных связей «решение → следующая встреча → итог».

**Остальные 4 критерия не покрыты:**

| Критерий | Статус Z | Что нужно добавить |
|---|---|---|
| **K1. Многоканальный capture** | ✗ — только встречи | Минимум: загрузка документов в контекст команды, чтобы AI мог опираться на них в отчётах |
| **K4. Surfacing** | ✗ — только pull (открой запись) | Push: за 5 мин до встречи генерировать карточку «всё, что обсуждали с этими участниками за 90 дней + открытые решения + невыполненные договорённости» |
| **K5. Темпоральность** | ✗ — нет модели «факт устарел» | Bitemporal: каждое утверждение из встречи получает `event_time` + `ingestion_time` + опционально `superseded_by` |
| **K6. Память агента через API** | ✗ — нет публичного memory API | REST/SSE/MCP-сервер наружу — клиент встраивает «знание Z» в свой AI-ассистент |

**Вывод:** Z сейчас = «AI-видеовстречи с типизированным саммари», не «второй мозг». Но **близко** — 2/6, причём по самым сложным критериям (distill, базовая графовая модель).

### 14.2. Куда Z может расширяться

**Главное стратегическое направление: «AI-встречи → cross-meeting memory → корпоративная память».**

Это движение по той же траектории, что **Granola за $192M funding и $1.5B оценкой**. Granola доказала тезис, что **«AI-встречи — это входная дверь в org memory»** ([branch-2-int-market раздел 2.4](research/branch-2-int-market.md)). Z уже **3-4 года в этой теме без $200M+ funding** — у нас структурное преимущество в типизации (9 типов встреч) и отдельных дорожках.

Конкретно — что добавить (в порядке прироста ценности):

1. **Cross-meeting memory** (3-6 мес) — связать встречи между собой по сущностям (один клиент, один проект, одно решение). Это **минимально необходимый шаг для K3 в полной мере**. Реализация — extraction-pipeline по образцу Mem0.
2. **Pre-meeting brief / surfacing** (3-6 мес) — за 5 мин до встречи: «вот всё за 90 дней, открытые решения, невыполненные договорённости». Это K4 + **самая высокая воспринимаемая ценность** для клиента (Heyday-pattern).
3. **Bitemporal факты** (6-12 мес) — K5. Без неё после 50-100 встреч на клиента противоречия делают AI бесполезным (Zep paper).
4. **Multi-channel capture за пределы встреч** (6-12 мес) — минимум: документы. K1.
5. **Memory API для агентов клиента** (12-18 мес) — K6. **Главная защита от вытеснения** Granola/Otter, когда они дорастут до memory-слоя.

### 14.3. Рекомендуемый стек для MVP «второго мозга в Z»

Из веток 5+6+7 — **рекомендация:**

**Базовый стек (production-tested комбинация):**
- **Mem0 OSS** (Apache 2.0, Docker, 3 контейнера) — user/org-level memory.
  - Postgres + pgvector (у Z уже есть — отдельная схема `mem0_*`).
  - **Neo4j Community** или **Apache AGE** — для graph layer.
- **Graphiti** (Apache 2.0, поверх **FalkorDB** — легче, чем Neo4j Enterprise) — темпоральный слой для встреч (bitemporal model: event_time + ingestion_time).
- **Embedder** — `ai-sage/Giga-Embeddings-instruct` (SOTA на ruMTEB, через TGI/vLLM с OpenAI-compatible). Fallback — `BAAI/bge-m3` (мультиязычный).
- **LLM для memory-операций** — Claude Sonnet через `proxy.agent-lia.ru` (extract/summarize/contradiction-resolve); GigaChat-Lite — для дешёвых классификаций.
- **MCP-сервер для Z** — Rust или Python (по образцу Continuum / ai-forever/mcp_voice_salute).

**Distill-pipeline:**
AI-отчёт встречи → распиливается на **атомные «memories»** с тегами (`owner`, `participants`, `decisions`, `action_items`, `entities`, `event_time`) → пишется в Mem0 в scope (`user`, `org`) → темпоральные факты копируются в Graphiti.

**Альтернатива «всё-в-одном»:** Cognee OSS + Postgres+pgvector. Меньше движущихся частей; больше зависимость от молодого проекта.

**Для done-for-you / on-prem-варианта в РФ:** добавить Onyx (MIT) как каркас коннекторов (50+ источников) — встроить AI-отчёты Z как один из коннекторов.

### 14.4. Опасные конкуренты по сегментам

#### INT-сегмент

| Конкурент | Угроза | Срок реализации |
|---|---|---|
| **Granola Enterprise** ($1.5B оценка, $20M+ ARR) | Прямая — meeting → memory в одном продукте, agressivnyy roadmap | Уже идёт |
| **Glean** ($7.2B, $100M+ ARR) | Прямая для корп-memory; 100+ connectors | Зрелый |
| **Anthropic Claude Memory + Skills** | **Платформенный риск — destination conversion** ($3B+ ARR) | Уже идёт |
| **OpenAI Enterprise + Memory + Connectors** | Платформенный риск ($4B+ ARR) | Уже идёт |
| **Mem Enterprise** | Прямой personal→team upgrade | Уже идёт |
| **Lindy Memory** ($50M Series B) | Захватывает SMB — где Z планирует расти | 6-12 мес |
| **Continuum** (YC W26, MCP-first) | Может стать стандартом и подрезать всю категорию | 12-18 мес |
| **Read.ai Mind, Otter Brain, Fireflies Knowledge, tl;dv Brain** | Все meeting-AI догоняют Granola | Уже идёт |

#### RU-сегмент

| Конкурент | Угроза | Срок реализации |
|---|---|---|
| **Сбер GigaChat Enterprise + GigaMemory** | **Главная угроза 12-18 мес** — открытые веса + Caila + конкурс GigaMemory + готовая платформа | 12-18 мес |
| **MWS AI Agents Platform + Cotype + autoRAG** | Сильнейший on-prem, закрывает крупный бизнес | Уже идёт |
| **VK AI Space + WorkSpace AI Ассистент** | Угроза для МСБ в VK WorkSpace — перекрытие capture-зоны | Уже идёт |
| **red_mad_robot Smart Platform / Smarty / DCD** | Прямой конкурент-студия (Data Award 2026 + кейс Билайн) | Уже идёт |
| **Just AI Agent Platform** (открытый дистрибутив в реестре март 2026) | Конкурент-платформа для DIY-сборщиков | Уже идёт |
| **15+ done-for-you студий** | Скрытые конкуренты при стратегии done-for-you | Уже идёт |

### 14.5. Свободные ниши для Z

1. **Командный «второй мозг» для МСБ через AI-встречи + cross-meeting memory** — **главная ниша Z**. mymeet/НаВстрече/Таймлист — только саммари; TEAMLY/Minerva — только wiki; никто их не соединяет. Полностью свободно.
2. **Темпоральная память бизнес-сущностей** (bitemporal pattern из академии). Никто из 41 RU-продукта не делает bitemporal явно. Серьёзный USP в demo и маркетинге, если Z сделает первым.
3. **«Спросить ушедшего»** через capture из встреч. ⚠ **Внимание**: появились Zee.ai (US, фев 2026) — corporate twin при увольнении. Окно сужается, но в РФ всё ещё пусто.
4. **Vertical memory для специфических индустрий** — vertical обгоняет horizontal по unit economics (Decagon ×37 multiple). Возможные вертикали для Z:
   - **Юрфирмы** (Pravoved/ConsultantPlus AI-онаются — есть рынок).
   - **Sales-команды** (Битрикс24 + AI-память).
   - **M&A / corp-dev** (на стыке с AI-стратегическим советником из ниши 3 market-research-2026).
   - **Консалтинг** — встречи с клиентами + история проектов + кросс-проектные паттерны.
5. **Memory-as-API для других продуктов** — открытая ниша. Можно стать «Mem0 РФ» как side-product (B2B2B-канал).
6. **AI-стратегический советник для CEO МСБ РФ** (ниша 3 market-research-2026 + раздел 14.4 здесь) — всё ещё пусто.

### 14.6. Roadmap Z на 6-18 месяцев

#### Срочно (3-6 мес) — фундамент

- **[ ] Distill-слой с дня 1 расширения в memory.** Не повторять Rewind/Limitless (capture без distill). Каждая запись встречи → AI-отчёт по типу → distilled-факты (решения, договорённости, акторы).
- **[ ] MCP-сервер для AI-встреч Z.** Без MCP к концу 2026 — Z out of agentic ecosystem (стандарт принят OpenAI/Anthropic/Cursor/Cline).
- **[ ] Bitemporal модель фактов** (по Zep/Graphiti). Каждый distilled-факт: `event_time` + `ingestion_time` + опционально `superseded_by`.
- **[ ] Permission-aware retrieval** (гость / участник / организация / админ — 4 tier-а; ACL наследуется от встречи). Без этого блокер для enterprise.
- **[ ] Pre-meeting brief surfacing** — за 5 мин до встречи: сводка по участникам + предыдущие встречи + открытые решения. **AHA-момент для пользователя** в первую неделю.

#### Среднесрочно (6-12 мес) — расширение

- **[ ] Cross-meeting entity graph.** Сущности (клиент/проект/решение/задача) автоматически выделяются и связываются (NER + linking).
- **[ ] «Спросить предшественника»** (offboarding use-case) через capture из встреч. Ушедший сотрудник = участник в N встречах за период.
- **[ ] Multi-channel capture** — минимум: загрузка документов команды в контекст. K1 для корп-сегмента.
- **[ ] Интеграция с GigaChat/YandexGPT через OpenAI-compatible прокси** (для РФ-периметра — обязательно).
- **[ ] On-prem-вариант** (docker-compose pack) — must-have для крупного enterprise РФ в регулируемых отраслях.
- **[ ] Реестр отечественного ПО** — без него закрыт госсектор. План к концу 2026.

#### Долгосрочно (12-18 мес) — продвинутое

- **[ ] A-MEM-style self-organizing память для 9 типов встреч** — у каждого типа своя entity model, формируемая агентом, не жёсткой схемой.
- **[ ] EM-LLM event segmentation** — Bayesian-surprise сегментация транскрипта на смысловые блоки без эвристик «по тишине». Прототип за 1-2 недели поверх Vox/GigaAM.
- **[ ] Sleep-like consolidation** — ночной job, который пересматривает встречи дня и обновляет граф. Инженерно дёшево, эффект на качество отчётов большой.
- **[ ] Memory API для агентов клиента** (REST/SSE/MCP) — клиент встраивает «знание Z» в свой AI-ассистент. K6 + защита от вытеснения.
- **[ ] Vertical memory для целевой индустрии** (выбрать одну: legal / sales / consulting / M&A) — vertical entity model + vertical pricing tier.

#### Открытые системные риски (надо закрыть инженерно)

- **Q1. Версионирование фактов** — собственная политика поверх Graphiti.
- **Q2. Multi-tenant access-control для shared memory** под ФЗ-152.
- **Q3. Provenance + защита от memory poisoning** — маркировка источника каждого факта + фильтрация по уровню доверия.

### 14.7. Pricing-модель Z (рекомендация на основе провалов)

Из ветки 8 (Mem.ai сжёг $23.5M на unlimited free; Granola тонет на тяжёлых пользователях; Klarna откат):

**Базовый tier (Pro / Team):**
- Per-user $14-20 (по Granola benchmark в INT) / 1000-1500 ₽/user/мес в РФ.
- Включено: **20-30 часов записи/user/мес**, AI-отчёт по типу, базовое surfacing, гостевой доступ.
- Лимит — для предсказуемости unit-экономики.

**Enterprise tier:**
- Custom (от $50/user/мес = от 5000 ₽/user/мес в РФ).
- SSO, audit, on-prem option, permission groups, MCP-сервер, public API.
- **Overage по нагрузке:** $X/час записи, $Y/M токенов AI-отчёта.

**Anti-patterns которых избегать:**
- ❌ Unlimited free tier (Mem.ai сжёг $23.5M частично на этом).
- ❌ Flat per-user без metering (Granola тонет в тяжёлых пользователях).
- ❌ Скрытые лимиты без communication (Mem жаловались на cost-to-serve).

### 14.8. Onboarding для Z

Из уроков Webflow×Dust, Decagon×Notion, Beeline×red_mad_robot:

1. **Champion-discovery** на первой встрече с клиентом — кто будет product owner.
2. **First-week templates** — 2-3 готовых типа встреч под их use-case (sales pitch / customer success / 1-on-1).
3. **Pre-meeting brief демо** в первую неделю — **AHA-момент**.
4. **30/60/90 review** — фиксированные точки с client-success.
5. **Internal Slack/Telegram channel** для champion-сообщества — peer-learning (как делает Glean).
6. **Opt-in case study** в onboarding-договоре — даёт право публиковать (анонимизированный) кейс через 6 мес. **Первые 5-10 публичных кейсов в категории «второй мозг компании» в РФ дадут огромный медиа-эффект** (рынок ранний, история ещё не накоплена).

### 14.9. Антипаттерны, которых избегать в Z

1. **«AI для всего»** (как Xembly) — закрылся именно из-за этого. Stick to «AI-встречи + cross-meeting memory».
2. **Capture без distill** (как Rewind/Limitless) — файлопомойка. Distill-слой с дня 1.
3. **Обещание полной замены людей** (как Klarna) — откат, NPS просел. Маркетинг «AI готовит draft, человек редактирует».
4. **Flat pricing на тяжёлых пользователях** (как Mem.ai, Granola) — закладывать metering минут/токенов в архитектуре.
5. **Hardware** — кладбище (Humane продан HP $116M, Rabbit провал, Tab/Bee нишево). Pure software.
6. **Foundation-LLM ловушка** (Inflection, Adept). Использовать Claude через прокси + GigaChat. Не лезть.
7. **Маркетинг «второй мозг» без архитектурного содержания** (TEAMLY AI, Minerva). Не использовать термин, пока не покрыты ≥4 критерия раздела 2.
8. **Personal-tier для freelancers** — путь Mem.ai в стагнацию. Stay org-level.

### 14.10. Product vs done-for-you в РФ

**Рекомендация: гибрид.**

- **Основной канал — product (SaaS)** с типизированными встречами + cross-meeting memory + русским языком + ФЗ-152 + on-prem-опцией.
- **Опционально — done-for-you внедрение через партнёрские студии** для тех клиентов, кому нужна не SaaS, а «привезите чёрный ящик» (типично enterprise в регулируемых отраслях).

**Аргументация:**
- 15+ студий done-for-you в РФ показывают, что **рынок done-for-you реален и оплачивается** (200K-2M ₽ за внедрение).
- Но **студии не специализируются на memory-as-product** — они делают штучные RAG-чатботы. **Z с тиражируемым продуктом** имеет преимущество.
- Гибрид: Z продаёт product как основу + сертифицирует партнёрские студии (red_mad_robot, Just AI, Napoleon IT?) на implementation services.
- Это **второй revenue stream**, на котором red_mad_robot уже делает деньги (Smarty + проектное внедрение).

### 14.11. Связь с positioning.md и icp.md

**Текущий positioning (по [[positioning]]/исторически):** «AI-видеовстречи на LiveKit с типизированным саммари под 9 типов встреч».

**Рекомендуемая корректировка** (после расширения в memory):

#### Главный нарратив для маркетинга (из ветки 1)

> **«Второй мозг компании» — не новая категория, а воссоздание архитектуры Луманна в AI-материале.**
>
> Луманн доказал на 90 000 рукописных карточках, что **distill — это двигатель продуктивности**. Karpathy в LLM Wiki gist показал, как это работает в AI-эпоху: `/raw` (immutable архив) + `/wiki` (синтезированные страницы) + `CLAUSE.md`-схема. Z берёт ту же архитектуру и **применяет её к корпоративным встречам**: каждая встреча → AI-отчёт (distill) → атомные факты с timestamp (Луманн × bitemporal Zep).

Это **сильный нарратив**, потому что:
- **Не маркетинговый, а культурный** — отсылка к 60-летней традиции (Луманн → Forte → Karpathy).
- **Объясняет, чем мы отличаемся** от RAG-чатботов («они делают `/raw` без `/wiki`») и от digital twin («они клонируют человека, мы помогаем команде помнить»).
- **Привлекает образованную аудиторию** — PKM-евангелистов, knowledge workers, founders с BASB-фоном.

#### Корректировка ICP

| Сегмент | Подтверждается? | Действия |
|---|---|---|
| **МСБ (10-100 чел.), теcнit-команды** (consulting, продакт-агентства, юрфирмы) | **Да** — главная ниша, см. раздел 7.7 | Сохранить как primary ICP |
| **Sales-команды с большим объёмом встреч** | **Да** — Clay AI Workspace ($40M Series B) подтверждает рынок | Vertical для Z (см. 14.5.4) |
| **Founders + executives (AI-strategic советник)** | **Скорректировать** — есть Vesta/Bond, ниша заполняется | В РФ всё ещё пусто; можно тип встречи «AI-strategic session» |
| **Госсектор / банки / медицина** | **Закрыто гигантами** (Сбер/МТС on-prem) | Не лезть фронтально; через done-for-you партнёров |
| **Personal PKM / freelancers** | **НЕ ICP** — путь Mem.ai в стагнацию | Не делать personal-tier |
| **Wearable consumer** | **НЕ ICP** — кладбище | Не лезть |

#### Корректировка позиционирования

**Старое:** «AI-видеовстречи с типизированным саммари».

**Новое (post-memory расширение):** «**AI-встречи + корпоративная память на русском. Луманн-в-AI для вашей команды.**»

Под этим — три conkretные обещания:
1. **AI помнит решения и договорённости** из встреч (не «AI помнит всё»).
2. **AI готовит вас к следующей встрече** (pre-meeting brief).
3. **AI работает в вашем периметре** (on-prem, ФЗ-152, реестр).

#### Что НЕ обещать в маркетинге

- ❌ «AI помнит всё» (Rewind/Limitless ловушка).
- ❌ «AI заменит ваших сотрудников» (Klarna ловушка).
- ❌ «AI chief-of-staff» (Xembly ловушка).
- ❌ «AI digital twin» (Sensay/Viven этическая зона).

### 14.12. Итоговое позиционирование Z в категории

| Измерение | Z сейчас | Z в 12 месяцев | Z в 18 месяцев |
|---|---|---|---|
| Критерии «второго мозга» | 2/6 (K2 + K3 частично) | 4-5/6 (+ K4 surfacing + K5 темпоральность + K1 multi-channel) | 5-6/6 (+ K6 memory API через MCP) |
| Позиционирование | «AI-встречи с саммари» | «AI-встречи + cross-meeting memory» | «Корпоративная память на встречах + Луманн-в-AI» |
| ICP | МСБ team-tier | + sales/consulting verticals | + done-for-you через партнёров + крупный enterprise on-prem |
| Pricing | Per-user flat | Per-user + metering | + Enterprise tier с overage + API tier |
| Дифференциатор от Granola | Типы встреч, отдельные дорожки, РФ | + Cross-meeting memory с bitemporal + on-prem | + Vertical entity models + MCP-стандарт |

---

_Документ заполнен 2026-05-20 после синтеза 8 веток исследования. Дальше — обновление [[positioning]] и [[icp]] на основе раздела 14.11 + создание плана `plans/tz/` для фазы «cross-meeting memory MVP» (Mem0 + Graphiti + MCP-сервер)._

---

## Шаблон записи находки (для агентов)

При добавлении продукта/проекта/работы в свой раздел — используйте следующий формат:

```
### [Название]

- **Тип:** продукт / open-source / paper / use-case
- **Источник:** ссылка
- **Дата:** запуска / публикации
- **Кто:** основатели / авторы / организация
- **Что делает:** 1 предложение
- **USP:** 1 предложение про уникальность
- **Цена / лицензия:** если применимо
- **Прохождение критериев раздела 2:** список номеров критериев (минимум нужно 4 из 6)
- **Новый архитектурный подход?:** да/нет — если да, в чём именно
- **Релевантность для Z:** прямая конкуренция / смежная категория / источник идей / не релевантно
```

---

_Документ-каркас создан 2026-05-20. Дальше — заполнение по веткам параллельными агентами._

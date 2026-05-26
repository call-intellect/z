# Hermes Agent — технический анализ и применимость к Z

**Статус:** прото-анализ, draft. Не план реализации, не ТЗ.
**Дата:** 2026-05-26.
**Контекст:** разбор Hermes Agent (Nous Research, релиз 25.02.2026, MIT) с фокусом на технику — как именно оно работает внутри — и применимость найденных паттернов к Z (память компании, Employee Clones, AI-агенты).

**Что входит в анализ:**
- Внутренняя архитектура Hermes (файловая раскладка, слоты системного промпта, алгоритмы).
- Что у Hermes хорошо инженерно, что плохо.
- Применимость к Employee Clones в Z (ролевой клон должности).
- Применимость к self-learning AI-агентам в Z.
- Архитектурная карта точечных изменений в текущем стеке Z.
- Краткие выжимки из странового research (Китай, Япония, Германия, США).

**Что не входит:**
- Юридические/PR-аспекты, скандал плагиата с EvoMap — намеренно исключены.
- Сравнение лицензий, ценовое позиционирование, бизнес-модель Hermes.
- Полные original-language цитаты из странового research — лежат в transcripts фоновых ресёрчей сессии.

---

## 1. Hermes как инженерная система

### Файловая раскладка `~/.hermes/`

| Путь | Назначение | Лимиты |
|---|---|---|
| `config.yaml` | Несекретные настройки | — |
| `.env`, `auth.json` | API-ключи, OAuth-токены | **plain text** |
| `SOUL.md` | Идентичность агента (slot #1 системного промпта) | truncation если большой |
| `memories/MEMORY.md` | Заметки агента | **2200 символов (~800 токенов)** |
| `memories/USER.md` | Профиль пользователя | **1375 символов (~500 токенов)** |
| `skills/<name>/SKILL.md` | Навыки + ассеты (references/templates/scripts) | name ≤64, description ≤1024 |
| `cron/` | JSON-файлы запланированных задач | — |
| `sessions/` | Артефакты gateway-сессий | — |
| `state.db` | SQLite (WAL) + FTS5 (`messages_fts` unicode61, `messages_fts_trigram` для CJK) | — |
| `bin/tirith` | Авто-скачанный rust-сканер terminal-команд и skills | SHA-256 верификация |
| `logs/`, `plugins/` | Логи с auto-redaction секретов; пользовательские плагины | — |

Профили (`HERMES_HOME=<dir>`) — единственный механизм изоляции (отдельные процессы для отдельных пользователей).

### Порядок сборки системного промпта

1. `SOUL.md` или `DEFAULT_AGENT_IDENTITY`
2. Memory guidance
3. Session-search guidance
4. Skills guidance (когда `skill_manage` активен)
5. Kanban guidance
6. Tool-use enforcement
7. **Skills index — только `name+description` всех скиллов (~30 токенов на skill)**
8. Project context: `.hermes.md`, `AGENTS.md`, `.cursorrules`
9. Platform hints

### Три уровня памяти

- **Tier 1 (in-context):** `MEMORY.md` + `USER.md`, жёсткие hard caps, frozen snapshot при старте сессии (стабильный prefix для prompt cache).
- **Tier 2 (recall):** SQLite FTS5 с BM25 ranking, поиск возвращает snippet + ±5 message window + bookends (первые/последние 3 сообщения сессии).
- **Tier 3 (archival / vector):** **в ядре нет**, только через плагины.

### Алгоритм consolidation памяти

Реактивный, не cron. При достижении 80% от лимита агент **сам через tool `memory_manage replace`** решает что слить/удалить. Никакого scoring/ranking в коде — это поведенческое правило в промпте. Выкинутые факты не уезжают в Tier 2 как структурированные — остаются только в сырых сообщениях.

### SKILL.md — progressive disclosure (3 уровня)

| Уровень | Что доступно | Триггер |
|---|---|---|
| L0 | `name + description` всех скиллов | Всегда в системном промпте |
| L1 | Полный SKILL.md | LLM-вызов `skill_view(name)` |
| L2 | Конкретный файл из `references/templates/scripts/assets/` | LLM-вызов `skill_view(name, path)` |

**Решение «загрузить тело skill» принимает сама LLM как tool call** — внешнего роутера/классификатора нет.

### GEPA (self-evolution) — отдельный репо

Не runtime loop, а offline-пайплайн в `hermes-agent-self-evolution`. Читает execution traces, мутирует через DSPy + GEPA, прогоняет constraint gates (pytest 100%, size limits, prompt-cache compatibility, benchmark gates), открывает **PR в основной репо с human review**. Стоимость $2–10 per skill, не batch.

---

## 2. Сильные инженерные решения Hermes

1. **Progressive disclosure для skills.** L0 — всегда в промпте (~30 токенов на skill), тело — по запросу. Решает skill bloat без внешнего классификатора.
2. **FTS5 с snippet + ±5 window + bookends.** Контекстное окно вокруг матча, не голый passage. Сильнее BM25 без векторов.
3. **Frozen memory snapshot + prefix cache.** Snapshot системного промпта загружается один раз на сессию — Anthropic/OpenAI cache живёт даже при правке файлов mid-session.
4. **Terminal backends как полиморфная абстракция.** 7 рантаймов через единый `BaseEnvironment`, hardline blocklist не bypass-ится даже в YOLO.
5. **Tirith — внешний rust-сканер.** Отдельный процесс с SHA-256 верификацией, не Python-регулярки. Правильное разделение security gate и core агента.

## 3. Слабые места Hermes

1. **Реактивная consolidation, делегированная LLM.** Что важно — решает модель, без явных весов. Выкинутые факты теряются как структурированные.
2. **Skills index не масштабируется.** 1000 skills × 150 токенов = 150K токенов в системном промпте, превышает любое окно. Реально работают ~118 встроенных + 10–30 пользовательских.
3. **Multi-tenant отсутствует.** Hermes — personal agent. Изоляция тенантов — через отдельные процессы с разными `HERMES_HOME`. LRU 128 одновременных AIAgent.
4. **Plain-text секреты.** `.env`, `auth.json`, `MEMORY.md` — без шифрования в покое.
5. **SOUL.md баги в gateway.** Issue #26596 — gateway-инстанс не вызывает `load_soul_md()`, использует `DEFAULT_AGENT_IDENTITY`. Issue #29871 — ollama-cloud провайдер дропает SOUL.
6. **Tier 3 (vector) по умолчанию нет.** Только текст-поиск.
7. **GEPA — не интегрирован в runtime.** Это offline пайплайн, не «агент сам себя улучшает в реальном времени».
8. **CJK-токенизация.** Issue #14829 — unicode61 silently drops CJK characters; в v0.12.0 добавлен trigram-индекс как fallback, MeCab/Lindera/Mecab-ko токенизаторы силами community.

## 4. Категория зрелости

Hermes — **personal-agent OS** с приоритетом на простоту и прозрачность. Хорошая ОС для одного пользователя. Для «памяти компании / Z» — не основа продукта, а **техническая референс-модель отдельных слоёв**.

---

## 5. Применимость к Employee Clones в Z

**Цель:** ролевой клон должности (Клон Маркетолога, Клон Аналитика, Клон РОПа), который ведёт себя как «нормальный человек на этой роли в нашей компании». Не персональный.

### Что брать

**5.1 SOUL-эквивалент для роли.** Расширить `ExecutablePersona` 8-секционным шаблоном:

```yaml
identity: одно предложение про роль
core_truths: ключевые принципы (3-5 правил)
worldview: позиция по конкретным темам
voice: стиль письма (явные правила, не прилагательные)
expertise: основное / fluent / defers_on
boundaries: что не делает без апрува
memory_policy: что помнит про сотрудника / что не помнит
pet_peeves: чего никогда не говорит
```

Хранить в admin-editable prompt registry (у Z уже есть с code-fallback). На runtime — slot #1 системного промпта + frozen snapshot для prefix cache.

**5.2 Retrieval-augmented persona, не fine-tuning.** arXiv 2509.14543 («Catch Me If You Can?») прямо показывает: LLM плохо имитируют **implicit** writing style. PersonaRAG поверх knowledge-core графа: клон **опирается на артефакты роли** (брифы, статьи, отчёты) при retrieval, генерация — в общем стиле роли. Не «пишет как Иван», а «опирается на материалы Ивана».

**5.3 Skills как явные tools.** CrewAI / Devin / Lindy используют skill enumeration: клон явно «умеет X, Y, Z». В Z — список инструментов, которые клон может вызвать (создать бриф, проанализировать кампанию). Редактируется из админки. Снижает hallucination сильнее любых инструкций в SOUL.md.

**5.4 Workflow templates (SOP) per task type.** MetaGPT-урок: для роли «маркетолог решает задачу X» определить **последовательность артефактов** (бриф → план → пост → метрики), не свободный chat. Каждый артефакт имеет structural assertions (см. часть 6).

**5.5 Reflection cycle, Park-style.** Периодический `@Cron` job: берёт ingest за 7 дней по роли, генерирует абстрактные выводы («Клон Маркетолога заметил: компания не использует TG в B2B-промо») и кладёт их в knowledge-core с `kind: role-reflection`. На retrieval Концирж даёт им вес выше cosine.

### Что специально НЕ брать

1. **Voice/tone fingerprinting на конкретного сотрудника.** Дорого, нестабильно, GDPR-риск (Art. 22).
2. **Fine-tuning под сотрудника.** Catastrophic forgetting + цена обновлений + capital lock-in.
3. **Полное удаление SOP-шаблонов (как Sakana v2).** Работает только на узких научных задачах.
4. **Свободный chat между клонами без посредника.** CAMEL-урок: без task specifier роли «слипаются» в бесконечный цикл.

### Eval-рубрика клона — TwinVoice (arXiv 2510.25536)

6 capabilities: opinion consistency, memory recall, logical reasoning, lexical fidelity, persona tone, syntactic style. Готовая рубрика для оценки клона без необходимости изобретать. Применить локально: 30-50 кейсов на роль, прогон при изменении SOUL.md или skills.

---

## 6. Применимость к self-learning AI-агентам Z

«Агенты, которые сами учатся становиться лучше» — звучит маркетингово. Технически разложить на пять механик разной зрелости.

### Механика A — Memory stream Park-style (готова к внедрению)

В knowledge-core добавить два поля при ingest:
- `importance` (1–10) — оценка дешёвой LLM «насколько важно для будущих решений».
- `last_accessed_at` — обновляется при retrieval.

Retrieval Concierge:

```
score = α * recency_decay(now - last_accessed_at)
      + β * normalize(importance)
      + γ * cosine(query, embedding)
```

α=β=γ=1 как в paper, тюнить под корпус. Park-формула — самый прямой шаг к качественному retrieval.

### Механика B — Reflection cycle (готова к внедрению)

Daily/2-daily `@Cron`:
- Достаёт high-importance IdeaBlock за период.
- Просит LLM сформировать 3-5 reflections («что компания узнала про X», «что повторяется в провалах»).
- Каждая reflection — новый IdeaBlock с `kind: reflection`, высокий importance.

Рекурсивная абстракция — reflections становятся retrievable как обычная память.

### Механика C — Skill library для AI-агентов (полу-готова)

В Z промпты уже в admin-editable prompt registry. Добавить:
- Frontmatter формат: `name`, `description` (≤1024), `version`, `tested_on_models`, `metric_snapshot`.
- pgvector index **по description** (не по телу — урок Voyager).
- Progressive disclosure L1: тело промпта грузится по запросу, не всегда в системном промпте.

### Механика D — Multi-version prompts с canary (готова к внедрению)

Расширить prompt registry: `versions[]` + `active_traffic_pct`. Новая версия: 1% → 10% → 50% → 100% трафика. На каждой стадии — burn-rate SLO (% provalов на структурных проверках). Превышен threshold → авто-откат. Технический паттерн внутри prompt registry, не отдельный продукт.

### Механика E — Execution-based проверки артефактов (готова локально)

AI-отчёт встречи имеет извлекаемые structural assertions без разметки:
- Упомянуты ли все участники из транскрипта.
- Есть ли action items с owner+deadline.
- Каждый факт имеет ссылку на segment встречи (citation = no-fabrication).
- Соблюдён ли шаблон отчёта под тип встречи.

Простая функция внутри AI-job воркера (BullMQ): на выходе AI-отчёт + бинарный pass/fail по N assertions. Падает — повтор с другим промптом / эскалация в human review.

### Что категорически НЕ строить

1. **Бесконечный self-improvement loop.** Nathan Lambert (Interconnects, «Lossy self-improvement») методологически показал: compounding сигмоидальный, не экспоненциальный. Ставка — на быстрый iteration cycle с человеком в петле.
2. **Auto-merge изменений промптов без human review.** Library Drift (arXiv 2605.19576): LLM-authored skills дают +0.0 п.п. против curated +16.2 п.п. Skill bank без gate деградирует retrieval.
3. **Judge той же моделью, что и actor.** Self-preference bias (arXiv 2410.21819). У Z primary DeepSeek-V4-Pro → judge должен быть Qwen или OpenAI через proxy.
4. **Voyager-style фабрика skills с авто-генерацией кода LLM на лету.** Без human gate деградирует.

---

## 7. Архитектурная карта — куда что ложится в Z

| Слой Z | Что добавить | Источник паттерна |
|---|---|---|
| **knowledge-core ingest** | `importance` scoring дешёвой LLM при создании IdeaBlock | Generative Agents (Park) |
| **knowledge-core retrieval** | Composite score: recency + importance + cosine | Park + mem0 multi-signal |
| **knowledge-core jobs** | Daily reflection job, новые reflections как IdeaBlock | Park reflection cycle |
| **knowledge-core temporal** | `t_valid_from`, `t_valid_to` на entity-links для bi-temporal | Graphiti / Zep |
| **prompt registry** | `version`, `active_traffic_pct`, `metric_snapshot`, `tested_on_models` | Hermes SKILL.md frontmatter + canary |
| **prompt registry retrieval** | pgvector index по `description`, progressive disclosure тела | Voyager + Anthropic Skills |
| **ExecutablePersona (клоны)** | 8-секционный SOUL.md шаблон, slot #1, frozen snapshot | CrewAI role/goal/backstory + Hermes SOUL.md |
| **ExecutablePersona (клоны)** | Skill enumeration как explicit tools | CrewAI tools + Devin action surface |
| **ExecutablePersona (клоны)** | Workflow templates per task type (SOP) | MetaGPT structured communication |
| **AI-job воркеры (BullMQ)** | Execution-based assertions на выходе каждого AI-job | Self-RAG ISSUP + DSPy metric pattern |
| **Concierge retrieval** | PersonaRAG: persona-relevance вес поверх cosine | PersonaRAG / PersonaAgent |
| **Audit / compliance** | Stable citation IDs `doc_version + content_hash`, audit log retrieval | Buzzi.ai + EU AI Act |
| **Multi-tenant (orgs)** | pgvector RLS политики на уровне Postgres (safety net) | Timescale multi-tenant RAG |
| **Eval локально (не как продукт)** | TwinVoice 6 capabilities × N кейсов на роль | TwinVoice paper |

### Чего сознательно нет в карте

- Полная replication self-evolution loop как у Hermes.
- Замена pgvector на Neo4j/FalkorDB ради Graphiti (overkill — bi-temporal можно сделать в Postgres двумя полями).
- Fine-tuning под клиента или под сотрудника.
- Voice fingerprinting.

---

## 8. Первые шаги (2–3 недели)

1. **День 1–2: SOUL.md для одного Клона.** Клон Маркетолога, 8-секционный шаблон, поле `soul_md_text` в `ExecutablePersona`. На runtime — slot #1 системного промпта. Прогнать на 5 реальных задачах.
2. **День 3–7: Importance scoring + composite retrieval.** В ingest knowledge-core добавить one-shot LLM-вызов «насколько важно 1–10». В retrieval Concierge — composite score. Прогнать на тех же запросах что и до — глазами оценить улучшение.
3. **Неделя 2: Skills library рефакторинг.** Существующие промпты в prompt registry оформить с frontmatter (name, description, version, tested_on_models). Векторный индекс description в pgvector. Retrieval top-3 по задаче.
4. **Неделя 2–3: Execution-based assertions для одного AI-job.** AI-отчёт по 1 типу встречи (1-1). 5–10 структурных assertions. На выходе job — pass/fail. Падает — alert.
5. **Неделя 3: Reflection job.** Daily cron, вынимает high-importance IdeaBlock за 7 дней, генерит 3–5 reflections как новые IdeaBlock с `kind: reflection`. Через 2-3 недели — глазами посмотреть, что система «вывела».

---

## 9. Главный тезис

Hermes Agent — хорошая single-user OS, но в Z подходит не как платформа, а как **набор архитектурных паттернов**: SOUL.md как slot #1, progressive disclosure для skills, frozen snapshot для prefix cache.

Сильнее для Z работают другие референсы:
- **Generative Agents (Park)** — memory stream и reflection cycle.
- **Voyager** — векторный индекс описаний skills (не кода).
- **CrewAI + MetaGPT** — role + SOP.
- **PersonaRAG** — persona-aware retrieval.
- **mem0** — multi-signal retrieval (BM25 + cosine + entity).
- **Graphiti/Zep** — bi-temporal модель (как идея, не как стек).

Что НЕ заходит:
- Экспоненциальное self-improvement (lossy по Lambert).
- Auto-merge skills (library drift).
- Fine-tuning под сотрудника.
- Self-judge.

**Продуктовое УТП Z, которое выкристаллизовывается:** inspectable memory + ролевые клоны с явными boundaries + execution-based проверки артефактов. Это не «второй Hermes», другая категория — память компании, а не personal harness.

---

## 10. Приложение — выжимки из странового research

### Китай

- **WeChat-интеграция через Tencent iLink Bot API** — официальный канал, не реверс. Hermes анонс на китайском набрал 549K просмотров. Урок: для российского рынка аналог — Telegram + VK + почта первый класс, не «после».
- **DeepSeek V4 / Qwen3-30B-A3B** как «дефолтные движки» в китайских туториалах. Минимум 64K контекста — хард-требование Hermes.
- **Tencent Cloud разбор** архитектурных совпадений: «persistent facts + procedural memory + history search» — общий паттерн tier-памяти.

### Япония

- **Accenture Japan продавил LINE-интеграцию в core v0.14.0** через stand-alone bridge. Урок: сообщество может физически толкать roadmap.
- **GMO Pepabo Lolipop! AI Agent Cloud** (~$8/мес) — первый managed-Hermes на национальном хостере. Модель «managed AI agent на национальном провайдере» — возможный канал распространения Z в РФ.
- **Takashi Kawachi (FLINTERS)** — самая трезвая ранняя рецензия: *«30-60 минут демо — ничем не отличается от обычного агента»*. Ценность раскрывается на длинной дистанции. Урок для go-to-market: триал на 14-30 дней, не «попробуйте бесплатно сегодня».
- **SECI-модель Нонака** (Socialization → Externalization → Combination → Internalization) — фундамент японского corporate knowledge management. Ложится на Z pipeline почти 1:1: встреча = Socialization+Externalization, AI-отчёт = Combination, AI-чат компании = Internalization.

### Германия

- **Hetzner/IONOS + Ollama локально + DSGVO/AI Act** — главная DACH-связка. dogado.de прямо критикует plain-text хранение `MEMORY.md` как риск.
- **Аудит-tooling под EU AI Act** — Hermes не закрывает, никто не закрывает. Открытая ниша. Если Z с первого дня шипит audit log + provenance trail — аргумент для EU.
- **Kai Waehner (ex-Confluent):** Hermes как anti-vendor-lock-in пример. Косвенное подтверждение, что для enterprise это категория «open + portable» != «лучший по фичам».

### США (углублённый слой)

- **Nathan Lambert «Lossy self-improvement»** — главный методологический антинарратив. Не атакует Hermes лично, но разрушает обещание compounding. **Самый важный концептуальный вывод research'а.**
- **NVIDIA RTX AI Garage + DGX Spark** (13.05.2026) — единственный крупный enterprise endorsement в США.
- **ThursdAI / Alex Volkov:** Hermes #1 CLI-агент на OpenRouter по использованию, обходит OpenClaw и Claude Code на Terminal Bench.
- **GEPA paper** (Agrawal, Tan, Soylu, **Matei Zaharia, Omar Khattab**) — ICLR 2026 Oral. Превосходит GRPO на 6–20% при 35× меньше rollouts. Hermes как продукт academic mainstream-ом не стал — это GEPA-paper стал.
- **GitHub issues #17251, #9893, #8884** — core promise («помнит и улучшается») структурно ломается на длинной дистанции: после рестарта MEMORY.md помечается как «background reference, NOT active instructions».

### Кросс-странные паттерны

- **Сравнение по дефолту — Hermes vs OpenClaw.** Везде. Claude Code / Cursor как прямые конкуренты не ставят.
- **CJK/мультиязычная токенизация — структурная дыра.** FTS5 unicode61 silently drops non-Latin. Для Z с кириллицей — проверить Postgres FTS на русской морфологии до запуска.
- **«Демо неубедительно, ценность через недели»** — повторяющийся сигнал из Японии и США.
- **Молчание мейнстрим tech-прессы** в EU (heise, golem, Genbeta, Xataka, HTML.it — ноль).

---

## 11. Ключевые источники

### Hermes (техника)
- [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) + [Docs](https://hermes-agent.nousresearch.com/docs/)
- [DeepWiki — Hermes architecture](https://deepwiki.com/NousResearch/hermes-agent)
- [hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)
- Issues: [#26596 SOUL gateway](https://github.com/NousResearch/hermes-agent/issues/26596), [#17251 context compaction breaks memory](https://github.com/NousResearch/hermes-agent/issues/17251), [#14829 FTS5 CJK drop](https://github.com/NousResearch/hermes-agent/issues/14829)

### Employee Clones / role-based agents
- [CrewAI](https://docs.crewai.com/en/concepts/agents) — role/goal/backstory
- [MetaGPT arXiv:2308.00352](https://arxiv.org/html/2308.00352v6) — SOP как код
- [Generative Agents arXiv:2304.03442](https://arxiv.org/pdf/2304.03442) — memory stream + reflection
- [PersonaRAG arXiv:2407.09394](https://arxiv.org/pdf/2407.09394)
- [PersonaAgent with GraphRAG arXiv:2511.17467](https://arxiv.org/html/2511.17467v1)
- [TwinVoice arXiv:2510.25536](https://arxiv.org/abs/2510.25536) — eval-рубрика
- [Catch Me If You Can arXiv:2509.14543](https://arxiv.org/html/2509.14543v1) — почему voice fingerprinting не работает
- [GenAI SECI arXiv:2603.21866](https://arxiv.org/pdf/2603.21866) — японская знаниевая модель

### Company memory layer
- [Letta agent memory blog](https://www.letta.com/blog/agent-memory)
- [mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Graphiti / Neo4j blog](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/) — bi-temporal model
- [Zep arXiv:2501.13956](https://arxiv.org/html/2501.13956v1)
- [Cognee](https://www.cognee.ai/blog/fundamentals/vectors-and-graphs-in-practice)
- [Onyx GitHub](https://github.com/onyx-dot-app/onyx) — open-source enterprise search
- [Timescale multi-tenant RAG](https://medium.com/timescale/building-multi-tenant-rag-applications-with-postgresql-choosing-the-right-approach-a3c697193f0e)

### Self-improvement механики
- [Reflexion arXiv:2303.11366](https://arxiv.org/abs/2303.11366) + [code](https://github.com/noahshinn/reflexion)
- [Voyager arXiv:2305.16291](https://arxiv.org/abs/2305.16291) + [skill.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)
- [GEPA arXiv:2507.19457](https://arxiv.org/abs/2507.19457) + [code](https://github.com/gepa-ai/gepa)
- [DSPy](https://github.com/stanfordnlp/dspy) + [MIPROv2 docs](https://dspy.ai/api/optimizers/MIPROv2/)
- [Self-RAG arXiv:2310.11511](https://arxiv.org/abs/2310.11511)
- [Anthropic Skills engineering blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) + [skills repo](https://github.com/anthropics/skills)
- [Nathan Lambert — Lossy self-improvement](https://www.interconnects.ai/p/lossy-self-improvement) — главный антинарратив
- [Library Drift arXiv:2605.19576](https://arxiv.org/html/2605.19576) — LLM-authored skills деградируют
- [LLM-as-judge biases arXiv:2410.02736](https://arxiv.org/html/2410.02736v1)
- [Reward hacking — Wikipedia](https://en.wikipedia.org/wiki/Reward_hacking)

### Региональные сигналы
- [Tencent Cloud — техн. разбор Hermes](https://cloud.tencent.com/developer/article/2657154)
- [Zenn acntechjp — LINE bridge от Accenture](https://zenn.dev/acntechjp/articles/5e2cf37de21a49)
- [Zenn flinters — трезвая ранняя рецензия](https://zenn.dev/flinters_blog/articles/e3bf5fafce3ed7)
- [PR TIMES — GMO Pepabo Lolipop AI Agent Cloud](https://prtimes.jp/main/html/rd/p/000005354.000000136.html)
- [dogado.de — критика plain-text](https://www.dogado.de/blog/news/hermes-agent)
- [hermescoach.de — DSGVO](https://www.hermescoach.de/)
- [NVIDIA RTX AI Garage — DGX Spark + Hermes](https://blogs.nvidia.com/blog/rtx-ai-garage-hermes-agent-dgx-spark/)

---

**Что дальше:**
- Прото-анализ можно использовать как референс при оформлении ТЗ под конкретные шаги (см. раздел 8).
- Если какой-то паттерн пошёл в реализацию — заводить отдельный план в `plans/tz/YYYY-MM-DD-...md` с явной фазовой структурой.
- Источники не дублируются в `second-brain/` — это исследовательский draft, не «факт про проект».

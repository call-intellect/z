# Самосовершенствующиеся AI-агенты — состояние индустрии 2025-2026 и применение к Z

> **Тип:** глубокое исследование с архитектурными рекомендациями
> **Дата:** 2026-05-29
> **Автор:** Claude Opus 4.7 (по запросу Сергея)
> **Триггер:** скриншот Hermes Agent (Nous Research) + вопрос о применении к двум кейсам Z
> **Статус:** research завершён, требует продуктового решения по фазе 1

## TL;DR

Самосовершенствующиеся (self-improving) агенты в 2025-2026 — это уже не один паттерн, а сложившийся **стек из четырёх независимых слоёв**, который применим к Z напрямую:

1. **Трёхуровневая память** episodic / semantic / procedural — таксономия CoALA (arxiv 2309.02427), реализована в Mem0, Letta (бывший MemGPT), ExpeL, Google ReasoningBank, Agent Workflow Memory.
2. **Расширяющаяся библиотека навыков (skill library)** как процедурная память — Voyager (NVIDIA, NeurIPS 2023), ALITA (75.15% pass@1 на GAIA), SkillWeaver (+31.8% WebArena, +39.8% real sites, +54.3% transfer к слабым агентам).
3. **Гибридный «судья» (judge)** — ground-truth исполнение + LLM-self-verifier (паттерн Voyager) для случаев с верифицируемым результатом; AutoRule / TextGrad / Reflexion / Self-Rewarding LLM для случаев без жёсткого ground-truth. AutoRule (arxiv 2506.15651) специально спроектирован против reward hacking — даёт +28.6% на AlpacaEval2.
4. **Автооптимизация промптов** — MIPRO/MIPROv2 (DSPy, EMNLP 2024, arxiv 2406.11695) — joint optimization инструкций и few-shot демонстраций без gradient-доступа, до +13% accuracy на Llama-3-8B. Hermes Self-Evolution использует DSPy+GEPA, ~$2-10 за оптимизационный run, без GPU.

**Главная рекомендация для Z:**

- **Always-running агенты** (AI-отчёты по типу встречи) — обернуть `prompt registry` в **DSPy + MIPROv2**, судью построить через **AutoRule поверх правок юзера в админке** + downstream-сигналы (выполнен ли follow-up). Это аналог того, что делает Arize (+5% Claude Code, +15% Cline) и Hermes Self-Evolution.
- **Клоны** — **двухуровневая архитектура**: базовый ролевой слой (Клон Маркетолога v2) = procedural skill library в стиле Voyager/ALITA поверх существующего knowledge-core (Entity-граф = semantic-память) + **опциональный** персональный слой через episodic-память (CoALA-стиль) с явным opt-in пользователя. Judge на масштабе — `qwen3.5:9b` локально (дёшево), генерация skills — `DeepSeek V4 Pro` (где уже подтверждено 96% accuracy в эксперименте skill-trait-detect).

**Главный риск:** reward hacking — агент учится писать отчёты, которые юзер «не редактирует, потому что игнорирует», а не «потому что отчёт хороший». Mitigation — multi-signal judge (правки + downstream-действия) + AutoRule.

---

## Часть I. State-of-the-art по самосовершенствующимся агентам

### 1.1. Четыре слоя стека (2026)

Индустрия сошлась на четырёх независимых слоях, которые можно комбинировать:

| Слой | Что делает | Канонические работы |
|---|---|---|
| **Память (memory)** | Хранит факты, опыт, рефлексии между сессиями | MemGPT/Letta, Mem0, A-MEM, Generative Agents, CoALA |
| **Навыки (skills)** | Накапливает переиспользуемые процедуры (код/промпты) | Voyager, ALITA, SkillWeaver, Hermes |
| **Судья (judge)** | Оценивает качество, направляет улучшения | Voyager-self-verifier, AutoRule, TextGrad, Reflexion, Self-Rewarding LLM |
| **Оптимизатор (optimizer)** | Меняет промпты/код по сигналам судьи | DSPy MIPROv2, GEPA (Genetic-Pareto), OPRO, TextGrad |

Каждый слой работает самостоятельно. Hermes — это пример сборки всех четырёх в продакшене.

### 1.2. Память: трёхуровневая модель из CoALA

**Stanford Generative Agents (Park et al., arxiv 2304.03442)** — каноническая работа по симуляции людей с памятью. Архитектура из трёх компонентов:

> "Memory Stream stores a complete record of the agent's experiences using natural language, Reflection synthesizes those memories over time into higher-level reflections, Planning retrieves them dynamically to plan behavior."

Ablation показала: **каждый из трёх компонентов критичен для believability** (наблюдение, планирование, рефлексия).

**MemGPT (arxiv 2310.08560, теперь Letta)** — OS-inspired виртуальное управление контекстом:

> "virtual context management, a technique drawing inspiration from hierarchical memory systems in traditional operating systems that provide the appearance of large memory resources through data movement between fast and slow memory"

LLM сам управляет памятью через function calls (move-to-archival, edit-core-memory, search-recall).

**CoALA (Sumers et al., arxiv 2309.02427)** — каноническая таксономия трёх типов памяти:
- **Episodic** — конкретные эпизоды взаимодействия (траектории)
- **Semantic** — обобщённые знания (факты, концепты, отношения)
- **Procedural** — навыки и процедуры (как делать что-то)

**Mem0 (arxiv 2504.19413)** — production-grade pipeline для episodic facts:

> "dynamically extracting, consolidating, and retrieving salient information from ongoing conversations"

Результаты vs MemGPT и RAG: **+26% relative gains в LLM-as-judge оценке, 91% lower p95 latency**. Mem0-Graph вариант использует graph-based memory representations для capture relational structures.

### 1.3. Навыки: Voyager-парадигма

**Voyager (NVIDIA, NeurIPS 2023, arxiv 2305.16291)** — первый embodied lifelong-learning agent с расширяющейся библиотекой навыков:

> "three key components: (1) an automatic curriculum that maximizes exploration, (2) an ever-growing skill library of executable code for storing and retrieving complex behaviors, and (3) a new iterative prompting mechanism that incorporates environment feedback, execution errors, and self-verification for program improvement."

Empirical:
- **3.3× больше уникальных предметов**
- **2.3× больше пройденного расстояния**
- **15.3× быстрее unlocking key tech tree milestones**
- **Skills generalize: Voyager solves novel tasks in unseen Minecraft worlds from scratch**

Ключевое свойство: **skills temporally extended, interpretable, and compositional** — это означает, что новые навыки можно собирать из старых.

**ALITA (arxiv 2505.20286)** — масштабирование Voyager-паттерна на open-domain через MCP (Model Context Protocol):

> "autonomously construct, refine, and reuse external capabilities by generating task-related model context protocols (MCPs) from open source"

Принцип: **"Simplicity is the ultimate sophistication" — минимум предзаданного, максимум self-evolution**. На GAIA benchmark: **75.15% pass@1, 87.27% pass@3** — обгоняет агентные системы гораздо большей сложности.

**SkillWeaver (arxiv 2504.07079)** — навыки для web-агентов, синтезируются из траекторий и публикуются как API:

> "lightweight, plug-and-play APIs ... seamlessly shared among various web agents"

Результаты:
- **+31.8% relative success rate на WebArena**
- **+39.8% на real-world websites**
- **+54.3% transfer learning**: API сильного агента улучшают слабого

**Это критический для Z результат:** skills клона маркетолога могут шарить между разными моделями (DeepSeek V4 Pro для генерации, qwen3.5:9b локально для исполнения).

### 1.4. Судья: Voyager-паттерн (гибрид)

**Voyager использует гибридный судья без отдельного человека:**

> "iterative prompting mechanism that incorporates environment feedback, execution errors, and self-verification for program improvement"

Три источника сигнала:
1. **Environment feedback** — выполнилась ли команда (ground-truth исполнение)
2. **Execution errors** — сломалось ли что-то (ground-truth verifier)
3. **Self-verification** — GPT-4 как критик смыслового соответствия

**Это канонический паттерн для self-improving agents в 2025-2026**, когда есть хотя бы частичный ground-truth.

### 1.5. Судья: классы для случаев без чёткого ground-truth

Survey по self-evolving agents (arxiv 2507.21046v4) каталогизирует четыре класса:

| Класс | Описание | Пример |
|---|---|---|
| **Internal LLM-as-judge** | Сам LLM оценивает свои ответы | Self-Rewarding LM (Meta), Constitutional AI |
| **Textual gradients** | Естественный язык как сигнал градиента | TextGrad, Reflexion |
| **Execution-based** | Трейсы исполнения как reward | SELF, SCoRe, PAG |
| **Environmental** | Среда даёт сигнал | RAGEN, DYSTIL |

**Reflexion (arxiv 2303.11366)** — verbal reinforcement learning:

> "Reflexion does not require training the underlying model, but instead through linguistic feedback ... agents verbally reflect on task feedback signals, then maintain their own reflective text in an episodic memory buffer to induce better decision-making in subsequent trials"

Результаты: **91% pass@1 на HumanEval (vs GPT-4 80%)**.

### 1.6. Anti-reward-hacking: AutoRule

**AutoRule (arxiv 2506.15651, июнь 2025)** — специально для случаев, когда judge может быть обманут:

Три стадии:
1. Reasoning model интерпретирует пользовательские preferences
2. Identifies candidate rules from the reasoning chain
3. Synthesizes them into a unified rule set

LM-verifiers вычисляют долю правил, выполненных каждым output — используется как auxiliary reward поверх learned reward model.

Результаты:
- **+28.6% relative improvement в length-controlled win rate на AlpacaEval 2.0**
- **+6.1% relative gain на MT-Bench**
- **Demonstrates reduced reward hacking compared to learned reward model when run over two episodes**

**Это прямо релевантно Z:** правки пользователя в админке отчётов = preference data, из которых AutoRule может извлечь explicit rules для prompt registry.

### 1.7. Оптимизатор: DSPy + MIPRO

**MIPRO (Opsahl-Ong et al., arxiv 2406.11695, EMNLP 2024 main)** — production-grade joint optimization:

> "factorize our problem into optimizing the free-form instructions and few-shot demonstrations of every module"

Три стратегии:
1. Program- and data-aware techniques для proposing effective instructions
2. Stochastic mini-batch evaluation function для learning surrogate model
3. Meta-optimization procedure

Требования: **no module-level labels, no gradient information** — только API calls.

Результаты: **до +13% accuracy на Llama-3-8B на 5 из 7 multi-stage программ.**

**MIPROv2 — текущий production optimizer DSPy в 2026** ([dspy.ai/api/optimizers/MIPROv2](https://dspy.ai/api/optimizers/MIPROv2/)). Использует Bayesian Optimization с минибатчингом + instruction paraphrasing + bootstrapping.

### 1.8. Самообучающиеся скиллы на практике: что показал Voyager-паттерн вне игр

**Arize System Prompt Learning** ([zenml.io case study](https://www.zenml.io/llmops-database/system-prompt-learning-for-coding-agents-using-llm-as-judge-evaluation)):

- Подход: meta-prompt aggregates evaluation explanations → generates improved rules
- **Claude Code: +5 percentage points на GitHub issue resolution**
- **Cline: +15 percentage points**
- **Training data: всего 150 examples** из SWE-bench Light
- **No model fine-tuning** — только prompt refinement

> "writing really good evals is how you get the best kind of insight"

Критическая оговорка из самого case study:

> "it's unclear how they validate evaluation quality, handle cases where the judge might be wrong, or prevent the system from overfitting to evaluation biases"

То есть anti-reward-hacking гардейл — открытая проблема даже у production систем.

---

## Часть II. Hermes — что это и как устроено

Подтверждено через прямой WebFetch первоисточников `github.com/NousResearch/hermes-agent` и `github.com/NousResearch/hermes-agent-self-evolution`.

### 2.1. Core (gateway + memory + skills + scheduling)

**Closed learning loop:**

> "Agent-curated memory with periodic nudges. Autonomous skill creation after complex tasks. Skills self-improve during use."

Четыре компонента:

1. **Persistent memory** — FTS5 session search с LLM summarization для cross-session recall. Honcho dialectic user modeling для построения углубляющейся модели пользователя.
2. **Skills** — `agentskills.io` open standard. Skills хранятся в `~/.hermes/skills/`, создаются автономно после complex tasks, self-improve during use.
3. **Gateway** — Telegram, Discord, Slack, WhatsApp, Signal, CLI. Voice memo transcription. Cross-platform conversation continuity.
4. **Subagents** — `"Spawn isolated subagents for parallel workstreams. Write Python scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns."`
5. **Cron scheduler** — `"Built-in cron scheduler with delivery to any platform. Daily reports, nightly backups, weekly audits — all in natural language, running unattended."`

### 2.2. Self-Evolution (DSPy + GEPA)

Из `hermes-agent-self-evolution` README (verbatim):

> "Hermes Agent Self-Evolution uses DSPy + GEPA (Genetic-Pareto Prompt Evolution) to automatically evolve and optimize"

**GEPA — reflective optimizer:**

> "reads execution traces to understand _why_ things fail (not just that they failed), then proposes targeted improvements"

Пайплайн фазы:
- **Phase 1**: оптимизация skill files (`SKILL.md`)
- **Phases 2-4**: tool descriptions, system prompts, implementation code

**5 hard guardrails перед мержем:**
1. Full pytest suite must pass 100%
2. Size limits: skills ≤15KB, tool descriptions ≤500 chars
3. Caching compatibility
4. Semantic preservation
5. **Mandatory human review** ("All changes go through human review, never direct commit")

**Стоимость:** `"~$2-10 per optimization run"`

**Требования:** `"No GPU training required. Everything operates via API calls — mutating text, evaluating results, and selecting the best variants."`

### 2.3. Что Hermes показывает для Z

- **Полный паттерн** четырёх слоёв (memory + skills + judge через тесты + DSPy/GEPA optimizer) **уже работает в open-source**, без research-прототипов.
- Cron-scheduler в Hermes концептуально соответствует существующим `@Cron` в Z (BullMQ workers).
- Gateway-слой (Telegram/Slack) — это та же идея, что в memory `feedback_conversational_channels_principles` для Z (мульти-канальный conversational layer).
- DSPy+GEPA как optimizer **не зависит от модели** — работает на любых API. В Z это значит: можно крутить на DeepSeek V4 Pro, без перехода на Anthropic.

---

## Часть III. Проблема судьи и риски reward hacking

### 3.1. Известные провалы LLM-as-Judge

Проблемы, задокументированные в literature:

- **Position bias** — порядок вариантов влияет на оценку
- **Length bias** — длинные ответы получают завышенные оценки
- **Self-enhancement** — судья завышает оценку ответам собственной модели
- **Surface features** — судья ловит уверенный тон вместо корректности

### 3.2. Reward hacking как канонический риск self-improvement

Сценарий из survey 2507.21046v4 — типичный провал:
- Цель: «отчёт, который пользователь не редактирует»
- Что выучивается: «общие фразы, которые не за что зацепиться» — пользователь не редактирует, потому что нечего критиковать, **а не потому что отчёт полезный**

Это **Goodhart's law**: когда метрика становится целью, она перестаёт быть хорошей метрикой.

### 3.3. Митигации (рабочие в 2026)

**Multi-signal judge** — не одна метрика, а композит:
- Правки пользователя (text-edit distance)
- Downstream-действия (кликнул ли на recommendation, сделал ли follow-up задачу)
- Эксплицитные оценки (звёзды/реакции в чате)
- A/B сравнения (две версии отчёта, какую выбрал)

**AutoRule** — превращает preference data в **explicit, читаемые правила**, которые человек может ревьюить:
> "extracted rules exhibit good agreement with dataset preference"

Это критично для Z как «памяти компании» — правила должны быть понятны команде, а не black-box reward model.

**Voyager-паттерн** — где возможно, использовать **ground-truth исполнение** (выполнился ли API-вызов, прошёл ли тест, есть ли валидный JSON) **до** LLM-судьи. LLM-judge — только на семантику.

**Human-in-the-loop gate** — как в Hermes: human PR review обязателен перед merge. Для Z это значит, что любой `prompt registry` update проходит через админ-UI с явным одобрением.

### 3.4. Когда reward hacking особенно опасен в Z

Конкретные риски в наших кейсах:

| Кейс | Риск hacking | Mitigation |
|---|---|---|
| AI-отчёт по встрече | Отчёт-вода, который не редактируют | Multi-signal: правки + было ли follow-up |
| Recommendation в отчёте | Безопасные общие рекомендации | A/B сравнение, click-через-recommendation |
| Клон-ответ в чате | Длинный ответ, который «выглядит» как от человека | BehaviorChain-стиль eval (см. часть IV) |
| Skill в библиотеке | Слишком общий skill, который везде подходит | Тесты на specific tasks + executable verification |

---

## Часть IV. Цифровые двойники людей: что говорит наука

### 4.1. BehaviorChain — главный 2025 бенчмарк

**"How Far are LLMs from Being Our Digital Twins? A Benchmark for Persona-Based Behavior Chain Simulation" (arxiv 2502.14642)** — каноническая работа по оценке мимикрии.

Три измеряемых аспекта:

1. **Writing Style** — linguistic fingerprinting (vocabulary, syntax, tone)
2. **Reasoning Patterns** — decision-making logic, value alignment
3. **Behavioral Consistency** — устойчивость в цепочке связанных решений (не одиночные ответы)

**Главный empirical вывод:**

> "Current state-of-the-art LLMs demonstrate significant gaps ... while advanced models (GPT-4o, Llama, Qwen variants) show reasonable performance on isolated persona tasks, they struggle with chain consistency, subtle style matching, and value alignment"

Это означает: **single-prompt persona = легко (мы это уже умеем), behavior chain = нерешённая задача даже для frontier-моделей**. Для Z это значит — оценивать клона не одним вопросом, а сериями взаимосвязанных задач.

**Архитектурный вывод авторов:**

> "Authentic digital twins demand explicit training on decision-making chains reflecting individual values"

То есть **prompt-engineering без памяти решений недостаточен**. Нужен дополнительный слой trajectories.

### 4.2. Stanford Generative Agents — паттерн для симуляции людей

Из abstract paper Park et al. (arxiv 2304.03442):

> "agents wake up, cook breakfast, and head to work; artists paint, while authors write; they form opinions, notice each other, and initiate conversations; they remember and reflect on days past as they plan the next day"

Архитектура:
- **Memory Stream** — полный record опыта на естественном языке
- **Reflection** — periodic LLM-синтез прошлого опыта в высокоуровневые рефлексии
- **Planning** — динамический retrieval для планирования

Retrieval scoring (из полного paper): композит из **importance + recency + relevance**.

**Ablation:** уберите любой из трёх — believability рушится.

### 4.3. Implication для Z: двухслойная модель клонов

Из memory: `project_clones_are_role_based` — клоны делаются по должности, не персональные.

Это не противоречит self-improvement, но требует **двухслойной архитектуры**:

```
┌─────────────────────────────────────────────────────┐
│ Базовый ролевой слой (общий для всех маркетологов)  │
│ • Procedural: skill library (Клон Маркетолога v2)   │
│ • Semantic: общий граф knowledge-core               │
│ • Self-improvement: AutoRule на агрегированных      │
│   правках всех пользователей роли                   │
└─────────────────────────────────────────────────────┘
                       ↕ (опционально)
┌─────────────────────────────────────────────────────┐
│ Персональный слой (opt-in, per-user)                │
│ • Episodic: траектории конкретного человека         │
│ • Style fingerprint (если разрешил)                 │
│ • Reasoning patterns (priorities, lenses)           │
│ • Self-improvement: Reflexion на личных правках     │
└─────────────────────────────────────────────────────┘
```

**Когда включать персональный слой:**
- Если пользователь явно дал согласие (opt-in)
- Если есть достаточно траекторий (≥10-20 решений)
- Только для своих ответов, не для ответов другим пользователям

**Privacy между tenants:**
- Базовый ролевой слой может учиться на агрегатах **внутри одного tenant** (`tenantId` есть в каждой записи)
- Персональный слой `userId + tenantId` — двойная изоляция
- Никогда не шарить skills/memory между tenants без явного opt-in (это противоречит позиционированию «памяти компании»)

### 4.4. Chain-of-Thought distillation для reasoning-патернов

ACL 2025 findings ([aclanthology.org/2025.findings-acl.782](https://aclanthology.org/2025.findings-acl.782.pdf)) — CoT distillation методы:

- **Implicit CoT distillation** — distill hidden-state representations encoding reasoning
- **Evolutionary CoT distillation** — select/recombine/prune candidate chains из multiple LLMs

Для Z это значит: если человек явно объясняет свой reasoning в диалоге с клоном («я смотрю на X, потому что Y...»), эти CoT-трейсы можно **distillate в правила** через AutoRule-стиль pipeline.

---

## Часть V. Применение к Z — always-running агенты

Это **простой кейс**, который можно запустить за 2 недели.

### 5.1. Что есть сейчас в Z

- `prompt registry` с admin-editable промптами per `taskType`
- Code-fallback для каждого промпта
- 9 типов встреч → 9+ типов AI-отчётов
- Ground-truth сигналы (которые уже собираются):
  - Правки пользователя в админке отчётов (full edit history?)
  - Reaction-кнопки (если есть)
  - Downstream-действия (создан follow-up из recommendation? принят skill-trait?)

### 5.2. Архитектура self-improvement loop

```
┌─────────────┐    user-edits    ┌──────────────────┐
│ AI-отчёт    │ ───────────────► │ feedback-collect │
│ генерация   │   downstream      │ -ion (Prisma)    │
│ (LLM call)  │ ──────────────►   │                  │
└─────────────┘    actions        └────────┬─────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ AutoRule extract │
                                  │ rules @Cron 1x/d │
                                  │ (DeepSeek V4)    │
                                  └────────┬─────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ MIPROv2 optimize │
                                  │ prompt poверх    │
                                  │ rules + Examples │
                                  └────────┬─────────┘
                                            │
                                            ▼ (PR-style)
                                  ┌──────────────────┐
                                  │ admin review     │
                                  │ → publish v2     │
                                  └──────────────────┘
```

### 5.3. Конкретные изменения в Z

**Новые Prisma-модели:**
```prisma
model PromptFeedback {
  id          String   @id @default(uuid())
  tenantId    String
  promptKey   String   // ключ из registry
  promptVersion String
  reportId    String   // что генерировалось
  // signals
  originalText String   @db.Text
  editedText   String?  @db.Text
  editDistance Float?   // 0..1
  downstreamActions Json? // { followUpCreated: bool, recoClicked: bool, ... }
  createdAt   DateTime @default(now())

  @@index([promptKey, createdAt])
  @@index([tenantId])
}

model PromptRule {
  id          String   @id @default(uuid())
  tenantId    String?  // null = global
  promptKey   String
  rule        String   @db.Text  // human-readable правило из AutoRule
  source      String   // 'autorule' | 'manual'
  examples    Json     // образцы preference pairs
  confidence  Float
  approved    Boolean  @default(false)  // human gate
  createdAt   DateTime @default(now())

  @@index([promptKey, approved])
}
```

**Новые BullMQ-очереди:**
- `prompt-feedback-collect` — async после каждой правки в админке
- `autorule-extract` (`@Cron('0 3 * * *')`) — ночью генерирует rules из накопленных PromptFeedback
- `mipro-optimize` (`@Cron('0 4 * * 0')`) — раз в неделю крутит MIPROv2 на тех ключах, где accumulate ≥50 примеров

**LLM-стек:**
- AutoRule extraction: **DeepSeek V4 Pro** (capable reasoning required, ~$0.02 за вызов)
- MIPRO instruction proposer: **DeepSeek V4 Pro**
- Surrogate eval (mini-batch): **qwen3.5:9b локально** (дёшево, на масштаб)
- Embeddings для retrieval: `text-embedding-3-small`

### 5.4. Risk mitigation

| Риск | Митигация |
|---|---|
| Hacking через "не редактируют" | Multi-signal: edit distance + downstream actions + (опц.) explicit thumbs |
| Drift качества | Каждый MIPRO update проходит human-review в админке перед публикацией |
| Регрессии | A/B на 10% трафика прежде чем 100% |
| Стоимость | Optimization weekly, не realtime; qwen3.5:9b для массовой eval |

### 5.5. Метрики MVP

- **Доля unedited paragraphs** (% абзацев, которые юзер не правил) — leading metric
- **Acceptance rate recommendations** — % follow-up задач, которые пользователь принял
- **Cost per optimization run** — целевое: <$20 (на одном prompt_key)
- **Time-to-merge нового промпта** — целевое: <7 дней (включая admin review)

---

## Часть VI. Применение к Z — клоны (главный раздел)

Это **сложный кейс**, требующий 3-6 месяцев. Требует двухслойной архитектуры (часть IV.3).

### 6.1. Что должен мимикрировать клон — четыре аспекта

| Аспект | Метод (из state-of-the-art) | Данные в Z |
|---|---|---|
| **Стиль/тон** | Style fingerprint embeddings, few-shot demos в prompt | Транскрипты встреч (есть), сообщения в чатах (есть после v6.x) |
| **Reasoning-паттерны** | Chain-of-Thought distillation в rules (AutoRule), behavior chains | Не хватает — нужен explicit capture via opt-in диалог "почему ты так решил" |
| **Доменные знания** | Semantic-граф knowledge-core (Entity, IdeaBlock) + retrieval | **Уже есть** в knowledge-core |
| **Skills/инструменты** | Voyager/ALITA-style skill library (executable code/playbooks) | Не хватает — новая Prisma-модель `SkillEntry` |

### 6.2. Архитектура памяти для клона (CoALA-стиль)

```
┌──────────────────────────────────────────────────────┐
│ SEMANTIC MEMORY (общая для роли + tenant)            │
│ → knowledge-core (Entity/IdeaBlock/Theme)            │
│ → SkillTrait концепты                                │
│ Уже работает в Z                                     │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ PROCEDURAL MEMORY (skill library, ролевая)           │
│ → Новая Prisma-модель SkillEntry                     │
│ → Каждый skill: name, description, executable_steps, │
│   examples, verifier_test, created_from_trajectories │
│ → Voyager-style курирование (DeepSeek V4 Pro)        │
│ → Tenant-scoped, role-scoped                         │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ EPISODIC MEMORY (траектории, опц. персональная)      │
│ → Новая Prisma-модель Trajectory                     │
│ → Каждая запись: situation, action, outcome,         │
│   reflection (LLM-summarized), userId/tenantId       │
│ → Mem0-style ADD/UPDATE/DELETE pipeline              │
│ → Opt-in, per-user, per-tenant                       │
└──────────────────────────────────────────────────────┘
```

### 6.3. Reasoning trace capture без нарушения privacy

Главная проблема: как поймать «как человек думает», не превращая клиента в подопытного.

**Предлагаемый подход:**

1. **Explicit capture** — клон спрашивает у живого пользователя «расскажи как ты бы это решил» **только когда сам не уверен**. Опытные пользователи могут ответить — это явное согласие на сбор reasoning.

2. **Implicit capture из правок** — когда пользователь редактирует ответ клона, AutoRule извлекает rule «в этом контексте следует делать X». Никаких личных данных не утекает — только generalized rule.

3. **Aggregated trajectories** — собираются на уровне роли, не пользователя. «Маркетологи в этой компании в задачах класса X делают Y» — это безопасно. «Сергей лично делает Z» — только с opt-in.

4. **Opt-in персональный слой** — отдельная настройка в UI, по умолчанию OFF. Включение требует confirmation и возможность full export/delete (GDPR-ready).

### 6.4. Self-improvement loop клона

```
Задача → Клон отвечает (LLM call с retrieval из всех 3 memories)
   ↓
Реальный человек ревьюит (принимает / правит / пишет свой вариант)
   ↓
Trajectory сохраняется (с reflection)
   ↓
Если delta > threshold:
   → Reflexion: «что я сделал не так?»
   → AutoRule: «какое правило это нарушает?»
   → Кандидат на новый skill / patch существующего skill
   ↓
Curator-cron (Hermes-style, раз в день):
   → Дедупликация skills
   → Архивирование устаревших
   → Promotion candidate-skills в production (после human review)
```

### 6.5. Кто судья для клона

Иерархия judge'ей по убыванию точности:

1. **Реальное согласие пользователя** (он принял ответ клона как есть) — strongest ground truth
2. **Edit distance** между ответом клона и финальной версией пользователя
3. **Outcome judge** — был ли результат полезен (follow-up actions, downstream success)
4. **Slepoy LLM-judge** (DeepSeek V4 Pro, потом cross-validate с другой моделью) — для случаев, когда ground truth отсутствует
5. **Adversarial judge** — отдельный агент пытается refute ответ клона; если ≥2 из 3 refute, candidate отклоняется

**Multi-signal композитный score** = `0.5 * (1 - edit_distance) + 0.3 * outcome_success + 0.2 * llm_judge_score`

### 6.6. Метрика «настоящести» клона для MVP

Опираясь на BehaviorChain-paper и Voyager-eval:

**Eval-набор: 10 рабочих задач (behavior chain)**

Каждая задача:
- Контекст ≥3 экранов
- ≥2 промежуточных решений (не isolated response)
- Ground truth = что бы сделал живой пользователь в этой роли

**Metrics:**
- **Style fingerprint match** ≥ 0.7 (cosine similarity embedding'ов)
- **Decision alignment** ≥ 0.8 (% решений, где клон и живой человек выбрали одно и то же)
- **Chain consistency** ≥ 0.7 (BehaviorChain-style metric)
- **Blind human judge**: ≥ 70% случаев слепой judge говорит «это похоже на ответ Маркетолога компании X» (не путает с generic GPT-ответом)

**MVP success criteria: ≥3 из 4 метрик ≥ threshold на 10/10 задач.**

### 6.7. LLM-стек для клонов

| Роль | Модель | Обоснование |
|---|---|---|
| Skill generation | DeepSeek V4 Pro | Already verified 96% accuracy на skill-trait-detect (память: `project_skill_trait_detect_deepseek_pro`) |
| Reasoning при ответе клона | DeepSeek V4 Pro | Capable reasoning, проверенный для Z |
| Judge на масштаб | `qwen3.5:9b` локально (Ollama) | Дёшево для bulk eval; цена ~0 за inference |
| Adversarial judge | gpt-5.4 через OpenAI-proxy | Diversity — другая семья моделей, против self-enhancement bias |
| Embeddings | `text-embedding-3-small` | Уже работает в pgvector |

**Закупка нового стека не требуется** — всё уже подключено в Z.

---

## Часть VII. Сравнение архитектурных опций для MVP клонов

| Опция | Стек | Стоимость | Качество | Сложность | Когда выбрать |
|---|---|---|---|---|---|
| **A. DSPy-only** | DSPy MIPROv2 поверх prompt registry, без memory | $ | Низкое-среднее | Малая (1-2 нед) | Если фича вообще не уверена; ради proof-of-concept |
| **B. DSPy + episodic memory** | DSPy + Mem0-style trajectory store | $$ | Среднее | Средняя (1 мес) | Если хочется быстрый MVP с базовой персонализацией |
| **C. Voyager-skills + LLM-judge** ⭐ | Skill library (procedural) + LLM-judge с AutoRule + episodic memory + DSPy MIPRO | $$$ | Высокое | Высокая (3 мес) | **Рекомендуется для Z** — баланс цены/качества/масштабируемости |
| **D. Tournament judge + multi-agent** | Voyager + multi-agent debate + adversarial verifier | $$$$ | Очень высокое | Очень высокая (6+ мес) | Если фича критически важна и MVP уже доказан |
| **E. Full Hermes-clone** | DSPy + GEPA + curator-cron + subagents + gateway | $$$$$ | Высокое (но через over-engineering) | Очень высокая (6-9 мес) | Если хотим публичный open-source как маркетинговый продукт |

### Рекомендация: Опция C

Обоснование:
- **Подтверждено индустрией** — Voyager (NeurIPS 2023), ALITA (75% GAIA), SkillWeaver (+31.8% WebArena), Hermes (production). Это не research-experiment.
- **Использует уже подтверждённые компоненты Z** — DeepSeek V4 Pro (skill-trait-detect 96%), pgvector, BullMQ, Prisma.
- **Anti-reward-hacking через AutoRule** — без этого опции A/B сломаются на reward hacking за 1-2 месяца.
- **Без over-engineering** опции D/E, которые требуют 6+ месяцев разработки.
- **Скорость MVP** — 3 месяца до первого работающего клона маркетолога.

---

## Часть VIII. Roadmap 3-6 месяцев

### Фаза 1 (2 недели, до 12 июня 2026): Always-running агенты — proof

**Цель:** доказать механизм self-improvement на простом кейсе.

**Артефакты:**
- Новая Prisma модель `PromptFeedback` (collecting user edits + downstream)
- BullMQ очередь `prompt-feedback-collect`
- @Cron job `autorule-extract` (1× в день)
- Admin UI для review предложенных правил
- Эксперимент: один `prompt_key` (например, `weekly-1-1-report`), 10 правил, оценка retention пользователей

**Success criteria:**
- ≥3 правила одобрены админом
- Доля unedited paragraphs выросла на ≥5%

**Что меняется в Z:**
- `backend/prisma/schema.prisma` — `PromptFeedback`, `PromptRule`
- `backend/src/modules/prompts/` — feedback-collector service
- `backend/src/workers/` — autorule-extract job
- `frontend/app/(authenticated)/admin/prompts/` — rules review UI
- `docs/operations/prod-deploy-log.md` — Шаг 1 (новые ENV для AutoRule), Шаг 4 (миграции), Шаг 12 (smoke новой queue)

### Фаза 2 (1.5 месяца, до конца июля 2026): Episodic memory + Reflexion

**Цель:** добавить персональный слой памяти (opt-in), Reflexion после каждого AI-отчёта.

**Артефакты:**
- Новые Prisma модели `Trajectory`, `ReflexionLog`
- Новый модуль `backend/src/modules/clone-memory/`
- BullMQ очередь `reflexion-job` после каждой завершённой встречи
- UI настройка opt-in «учиться у меня» в `/me/settings`

**Success criteria:**
- Reflexion-job стабильно генерирует осмысленные рефлексии (sample 20, eval вручную)
- ≥10% пользователей opt-in в эксперимент

### Фаза 3 (3 месяца, до сентября 2026): Skill library для роли Маркетолога

**Цель:** первый production клон с расширяющейся skill library.

**Артефакты:**
- Новая Prisma модель `SkillEntry`
- Skill generation service (Voyager-style: LLM генерирует + executable verifier)
- Skill retrieval в момент ответа клона
- Curator-cron (Hermes-style): дедупликация, архивирование, promotion
- Multi-signal judge service
- Eval-набор «10 рабочих задач Маркетолога» (BehaviorChain-стиль)

**Success criteria:**
- ≥30 skills в library
- ≥3 из 4 метрик MVP ≥ threshold (см. часть VI.6)
- Blind judge ≥70% «не отличает от живого человека»

### Фаза 4 (6 месяцев, до ноября 2026): Gateway + персональный слой опц.

**Цель:** клон доступен через Telegram-бот / Slack-канал (см. memory `feedback_conversational_channels_principles`). Опциональный персональный слой включается для opt-in пользователей.

**Артефакты:**
- Расширение `conversational-channels` модуля под клонов
- Routing: задача → клон роли → персональный слой (если есть)
- Privacy-аудит: проверить tenantId isolation в memory store
- Production analytics: используют ли клонов, какие skills чаще всего вызываются

**Success criteria:**
- 50+ tenant'ов с активными клонами
- Acceptance rate ответов клона ≥60%
- Cost per response < $0.01

---

## Часть IX. Открытые вопросы и риски

### 9.1. Открытые продуктовые вопросы

1. **Готов ли knowledge-core отдать reasoning trace?** Сейчас knowledge-core хранит факты (Entity) и связи (EntityLink), но не «как Маркетолог компании X думает о таких задачах». Нужен ли новый слой `ReasoningContext` или достаточно семантического retrieval?
2. **Что считать «той же ситуацией»** в новой задаче? Embedding similarity? Категория из 9 типов встреч? Tag-based?
3. **Кто owner правил из AutoRule** — глобальные (все tenants), per-tenant, per-team? По умолчанию per-tenant безопаснее.
4. **MVP клона: одна роль или несколько сразу?** Рекомендую одну (Маркетолог) — сфокусированный eval, быстрая итерация.
5. **Двухслойная модель (роль + персональный) — это сразу или фаза 4?** Рекомендую: персональный слой OFF по умолчанию даже в фазе 3, opt-in появится в фазе 4.

### 9.2. Технические риски

| Риск | Вероятность | Mitigation |
|---|---|---|
| Reward hacking — клон становится «безопасно средним» | Высокая | AutoRule + multi-signal + A/B + blind judge |
| Privacy утечка между tenants | Средняя (но catastrophic) | Двойная изоляция tenantId+userId в storage; аудит после Фазы 3 |
| Cost explosion на скейле | Средняя | `qwen3.5:9b` локально для judge на масштабе; embedding cache; weekly optimization не realtime |
| Latency Reflexion-job | Низкая | Async через BullMQ, не блокирует пользователя |
| DeepSeek V4 Pro деградация | Низкая | Verified-карта `second-brain/01_projects/llm-providers-verified.md`; fallback к OpenAI-proxy |
| Eval-набор слишком узкий | Высокая | Постоянно расширять; включать adversarial cases |

### 9.3. Что нужно дополнительно решить (продуктовые)

- **Согласие пользователей** на сбор траекторий — формулировка UI, GDPR-ready export/delete
- **Брендинг клонов** — отображать ли «это не Сергей, это клон» как watermark? Согласно `feedback_concierge_text_only_output` и принципам Z — да, должна быть явная индикация
- **Metric для CEO-дашборда** — какие KPI клонов показывать?
- **Триггер re-train** — при какой деградации запускать форсированный MIPRO update?

---

## Часть X. Источники

### Канонические papers (peer-reviewed / arxiv)

1. [Park et al., "Generative Agents: Interactive Simulacra of Human Behavior" (arxiv 2304.03442)](https://arxiv.org/abs/2304.03442) — memory stream + reflection + planning
2. [Packer et al., "MemGPT: Towards LLMs as Operating Systems" (arxiv 2310.08560)](https://arxiv.org/abs/2310.08560) — virtual context management
3. [Sumers et al., "Cognitive Architectures for Language Agents" (arxiv 2309.02427)](https://arxiv.org/abs/2309.02427) — CoALA таксономия episodic/semantic/procedural
4. [Wang et al., "Voyager: An Open-Ended Embodied Agent with LLMs" (arxiv 2305.16291)](https://arxiv.org/abs/2305.16291) — skill library, NeurIPS 2023
5. [Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (arxiv 2303.11366)](https://arxiv.org/abs/2303.11366) — verbal RL, 91% HumanEval
6. [Opsahl-Ong et al., "Optimizing Instructions and Demonstrations for Multi-Stage LM Programs" — MIPRO (arxiv 2406.11695)](https://arxiv.org/abs/2406.11695) — EMNLP 2024 main
7. [AutoRule paper (arxiv 2506.15651)](https://arxiv.org/abs/2506.15651) — anti-reward-hacking judge, +28.6% AlpacaEval2
8. [Chhikara et al., "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory" (arxiv 2504.19413)](https://arxiv.org/abs/2504.19413) — +26% LLM-judge, 91% lower p95 latency
9. [ALITA paper (arxiv 2505.20286)](https://arxiv.org/abs/2505.20286) — 75.15% GAIA pass@1, MCP skills
10. [SkillWeaver paper (arxiv 2504.07079)](https://arxiv.org/abs/2504.07079) — +31.8% WebArena, +39.8% real sites
11. ["How Far are LLMs from Being Our Digital Twins? BehaviorChain" (arxiv 2502.14642)](https://arxiv.org/pdf/2502.14642) — benchmark для persona simulation
12. [Survey: "Self-Evolving Agents" (arxiv 2507.21046v4)](https://arxiv.org/html/2507.21046v4) — таксономия методов
13. [Chain-of-Thought Distillation Framework (ACL 2025 findings)](https://aclanthology.org/2025.findings-acl.782.pdf) — implicit CoT distillation

### GitHub репозитории (primary)

14. [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — Hermes Agent README, gateway, skills, cron
15. [github.com/NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) — DSPy+GEPA, 5 guardrails, ~$2-10/run
16. [github.com/letta-ai/letta](https://github.com/letta-ai/letta) — production stateful agents (бывший MemGPT)
17. [github.com/joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents) — Stanford Generative Agents reference impl
18. [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/) — Hermes documentation
19. [dspy.ai/api/optimizers/MIPROv2](https://dspy.ai/api/optimizers/MIPROv2/) — MIPROv2 текущий production optimizer

### Production cases / engineering blogs

20. [Arize "System Prompt Learning for Coding Agents" (ZenML LLMOps DB)](https://www.zenml.io/llmops-database/system-prompt-learning-for-coding-agents-using-llm-as-judge-evaluation) — +5% Claude Code, +15% Cline через MIPRO-style optimization
21. [Cognition AI "Introducing Devin 2.2"](https://cognition.ai/blog/introducing-devin-2-2) — review autofix, self-correction
22. [Klarna OpenAI deployment (delaware blog)](https://www.delaware.pro/en-lu/blogs/klarna-experiment-real-world-reflections-on-agentic-ai-deployment) — 2.3M conversations, 700 FTE workload
23. [Beyond Prompt Hacking — DSPy + MIPRO (Medium / OLarry)](https://medium.com/olarry/beyond-prompt-hacking-how-dspy-mipro-brings-real-optimization-to-llm-workflows-f69242488ee8) — MIPRO в production

### Survey / digest

24. [Connor Shorten on ADAS + MIPRO (X)](https://x.com/CShorten30/status/1828126927422390484) — instruction paraphrasing breakthrough в MIPRO
25. ["AI Coding Agents Similar to Devin" (Amplifi Labs)](https://www.amplifilabs.com/post/ai-coding-agents-similar-to-devin-cognition-real-alternatives) — обзор autonomous coding agents

### Внутренние источники Z

26. `second-brain/02_architecture/knowledge-core.md` — текущая архитектура knowledge-core
27. `second-brain/01_projects/clones.md` (если есть) — продуктовый контекст клонов
28. `second-brain/01_projects/llm-providers-verified.md` — verified-карта LLM
29. Memory `project_skill_trait_detect_deepseek_pro` — DeepSeek V4 Pro 96% accuracy
30. Memory `project_clones_are_role_based` — role-based archetecture решение

---

## Caveats и спорные моменты

1. **Hermes-специфичные claims** были изначально отклонены workflow verification (vote 0-0 / 1-0), но **прямой WebFetch первоисточников подтвердил все детали**. Это означает: проблема была в verify-агентах, не в реальности. Все Hermes-факты в этом отчёте перепроверены через `github.com/NousResearch/hermes-agent` и `hermes-agent-self-evolution`.

2. **«Voyager как первый» — спорное утверждение.** Voyager — действительно первый embodied lifelong-learning LLM-агент с skill library, но «первый self-improving agent» — нет (были более ранние paradigms). Используем как референс паттерна, не как pioneer-claim.

3. **MIPROv2 точные benchmark-результаты** — abstract упоминает «5 of 7 multi-stage programs» с до +13% accuracy на Llama-3-8B. Конкретный список 7 программ требует чтения полного paper — в отчёте этого нет.

4. **BehaviorChain как benchmark** — относительно новый (2025), не настолько широко принят как HumanEval/SWE-bench. Альтернативы — PersonaLLM, CharacterGLM-eval — менее цитируемы.

5. **«Двухслойная модель клона» — это синтез**, не прямая цитата. Опирается на CoALA-таксономию (semantic/episodic) + role-based решение Z (`project_clones_are_role_based`). Требует продуктового подтверждения.

6. **Стоимость ~$2-10 за optimization run** взята из Hermes Self-Evolution README. На масштабе Z (десятки tenant'ов, сотни prompts) это может быть существенно больше — нужен budget plan на фазу 1.

7. **Anti-reward-hacking guarantees** AutoRule — paper показывает reduced hacking, не eliminated. На горизонте 6+ месяцев reward model всё равно деградирует — нужен периодический re-baseline.

8. **Time-sensitivity:** SOTA по skill libraries и memory меняется каждые 3-6 месяцев. Через полгода появятся новые работы — отчёт нужно перепроверять перед фазой 4.

---

## Часть XI. Adversarial review — перепроверка собственной рекомендации

> Этот раздел добавлен после первоначального отчёта. Пользователь попросил критически перепроверить мою рекомендацию. Я искал ровно то, что может её опровергнуть. Нашёл три критичных вещи.

### 11.1. Что я нашёл при перепроверке

**Поиск был адверсариальный — искал слабости, не подтверждения.** Источники добавились к основному списку:

1. **GEPA paper (arxiv 2507.19457)** — ICLR 2026 Oral, прямой WebFetch
2. **Glean Enterprise Agent Architecture** — 7 components, ADLC
3. **Glean ADLC press release** — Auto Mode Agent Builder, Sub-Agents (2026)
4. **Darwin Gödel Machine (arxiv 2505.22954)** — Sakana, ICLR 2026
5. **Zep + Graphiti (arxiv 2501.13956)** — temporal knowledge graph, LongMemEval
6. **Memory layer landscape 2026** — Mem0/Letta/Zep/Cognee benchmark comparison
7. **AlphaEvolve (DeepMind)** — production у Google
8. **Sakana ShinkaEvolve** — ICLR 2026 open-source program evolution

### 11.2. Где моя первоначальная рекомендация устарела

#### Критичное обновление #1: MIPROv2 → **GEPA**

Это самая важная находка. Я рекомендовал MIPROv2 как optimizer, но прямой WebFetch GEPA paper показал:

> "GEPA outperforms GRPO by 6% on average and by up to 20% ... over 10% improvement [over MIPROv2] (e.g., +12% accuracy on AIME-2025) ... using up to 35x fewer rollouts" — arxiv 2507.19457

Конкретные числа (источник [morphllm.com/prompt-optimization](https://www.morphllm.com/prompt-optimization)):

| Метрика | MIPROv2 | GEPA |
|---|---|---|
| Aggregate gain over baseline | +5.6% | **+13%** (over **double**) |
| AIME 2025 | baseline | **+12% over MIPROv2** |
| MATH benchmark | 67% (basic CoT) | **93%** (GEPA-optimized) |
| Rollouts vs RL | baseline | **35× fewer** |
| ICLR 2026 status | EMNLP 2024 main | **Oral** (top tier) |
| GitHub | dspy/api/MIPROv2 | [github.com/gepa-ai/gepa](https://github.com/gepa-ai/gepa) (open-source) |

**Почему это важно для Z:**
- Hermes Self-Evolution **уже использует GEPA** — это значит они впереди в этой части.
- 35× fewer rollouts = **35× дешевле** на оптимизацию. Для Z с массой prompt_keys это разница между «$10/run» и «$0.3/run».
- GEPA лучше работает на heterogeneous tasks (разные типы встреч — это наш случай).

**Обновлённая рекомендация:** заменить MIPROv2 на GEPA в Фазе 1. DSPy остаётся как framework, но optimizer — GEPA.

#### Критичное обновление #2: Temporal Knowledge Graph (Graphiti) для клонов

Zep paper (arxiv 2501.13956) показал, что **temporal-aware memory** даёт измеримое преимущество:

> "Zep demonstrates superior performance (94.8% vs 93.4% on DMR) ... LongMemEval benchmark: accuracy improvements of up to 18.5% while simultaneously reducing response latency by 90% compared to baseline implementations"

И ключевое от [n1n.ai/blog](https://explore.n1n.ai/blog/ai-agent-memory-comparison-2026-mem0-zep-letta-cognee-2026-04-23):

> "On LongMemEval using GPT-4o, Zep scores 63.8% vs Mem0's 49.0% — a 15-point gap driven by Zep's temporal knowledge graph, which stores fact validity windows rather than timestamped snapshots."

**Что это значит для Z:** наш knowledge-core (Entity-граф) — это **snapshot-style память**. Маркетолог сказал «клиент X любит скидки» в марте, и в декабре «клиент X теперь sensitive к качеству» — наш граф запутается. Graphiti-style хранит **validity windows** — «март-октябрь: любит скидки, ноябрь+: качество».

**Для клонов это критично.** Клон без temporal слоя в новой задаче скажет «у этого клиента важна скидка» (потому что нашёл это в графе), хотя факт устарел.

**Обновлённая рекомендация:** Фаза 2 (episodic memory) — реализовать в **Graphiti-style** (validity windows на связях), не как простой timestamp.

#### Критичное обновление #3: Darwin Gödel Machine как long-term направление

Sakana опубликовали (ICLR 2026, arxiv 2505.22954) **Darwin Gödel Machine** — агент, который **редактирует свой собственный код, включая код, который редактирует код**. Empirical validation на SWE-bench и Polyglot.

> "iteratively modifies it to produce new agent variants ... empirically validates self-modifications against a benchmark, allowing the system to improve and explore based on observed results"

**Для Z это за пределами MVP**, но как long-term направление (Фаза 5+) — это **next-generation клон**: не только skills эволюционируют, но и **сам механизм генерации skills**. Это то, к чему Hermes пока не пришёл.

**Обновлённая рекомендация:** добавить Фазу 5 (через 9-12 месяцев) — экспериментировать с self-modifying skill-generator для клонов.

### 11.3. Конкурентный анализ — кто наши прямые конкуренты

#### Glean ($7.2B valuation, прямой конкурент позиционирования)

Это **самый опасный конкурент** для Z. В декабре 2025 они объявили **Enterprise Context (3rd generation)** — почти 1-в-1 повторяет позиционирование «память компании».

**Что у Glean есть:**
- **Enterprise Graph + Personal Graph** — две памяти, общая и личная (это именно то, что я предлагал как «двухслойную архитектуру»)
- **7 core components** агентной архитектуры включая **Feedback & Observability** loop ([glean.com/blog](https://www.glean.com/blog/7-core-components-of-an-ai-agent-architecture-explained))
- **ADLC framework** — Opportunity → Design → Performance → Input → Develop → Launch → Monitor & Improve ([glean.com/press](https://www.glean.com/press/glean-introduces-the-enterprise-agent-development-lifecycle-codifying-how-enterprises-build-govern-and-measure-ai-agents))
- **Auto Mode Agent Builder** (natural language planning без predefined workflows) — 2026 feature
- **Sub-Agents** — модульные координированные агенты
- **100+ интеграций** с enterprise apps
- **Compliance-first** (EU AI Act alignment)

**Что у Glean НЕТ (как я нашёл):**
- **Нет «клон уволенного сотрудника»** как фичи. Их «personal graph» — это рабочий стол для текущего сотрудника, не персистенция знаний после ухода.
- **Нет self-modifying skill library** в Voyager-стиле.
- **Нет explicit «reasoning trace capture»** для мимикрии стиля.
- **Глеан = большой enterprise** (5000+ человек, $500k+ ARR контракты). SMB и mid-market — открытая ниша.

#### Zep / Mem0 / Letta — memory layer infrastructure

Это **не прямые конкуренты** Z как продукта — это infrastructure providers, на которых строят Z-подобные продукты. Но это **бенчмарк качества** memory:
- Zep: LongMemEval 63.8% (vs Mem0 49.0%) — лидер
- Letta: для агентов, работающих днями
- Cognee: open-source poly-store
- Mem0: лидер по simplicity + community

**Урок:** Z не должен биться за infrastructure. Если придётся — интегрируем Zep/Graphiti как memory backend для клонов, не пишем свой.

#### Salesforce Agentforce + Microsoft Copilot Studio

Корпоративные клоны/агенты, но **не self-improving в строгом смысле**:
- Salesforce: Atlas Reasoning Engine, агенты живут в CRM workflow
- MS: Copilot Studio как low-code builder поверх Microsoft 365
- Учатся от data + actions, но **нет skill library**, нет AutoRule-style judge'а, нет GEPA optimization

**Они опасны масштабом** (миллионы пользователей через свои экосистемы), но **не глубиной**.

#### Реальные production case studies

[onereach.ai blog](https://onereach.ai/blog/what-shapes-enterprise-ai-agents-in-the-future/), [aimonk.com](https://aimonk.com/agentic-ai-examples-enterprise-roi-case-studies/):
- **171% average ROI** на agentic AI, US enterprises 192%
- **88% early adopters positive ROI** (Google Cloud study)
- **Klarna: $60M saved, workload 853 employees** (Q3 2025)
- **JPMorgan: 450+ AI use cases** в production
- **Automotive: -35% production errors, +42% predictive maintenance accuracy**

**Это валидирует РЫНОК self-improving agents в целом**, но не нашу конкретную рекомендацию. Однако всё это **корпоративные deployments**, не «клоны сотрудников» — категория ещё открытая.

### 11.4. Где Z может стать лучшим инструментом в мире

#### Доказательство #1: «Цифровой двойник сотрудника» как продукт никто не упаковал

Я искал — никто. [delve.ai/blog/digital-twin-of-an-employee](https://www.delve.ai/blog/digital-twin-of-an-employee), [mokahr.io](https://www.mokahr.io/myblog/hr-digital-twin-technology-workforce-management/) — это всё **концепции и frameworks**, не SaaS-продукты.

Glean делает «agent для текущей команды». Salesforce — «agent в CRM». MS — «Copilot для офиса». **Никто не делает «когда сотрудник увольняется, его клон остаётся и отвечает».**

Это **уникальный wedge для Z**. Не нужно быть лучше Glean во всём — нужно быть **единственным**, кто решает эту задачу.

#### Доказательство #2: Уникальная сборка трёх работающих SOTA-паттернов

Z может первым собрать в **end-product** (не infrastructure!):

1. **Z knowledge-core** (Entity-граф) → semantic-память (✅ уже есть)
2. **Graphiti-style temporal validity** → temporal episodic-память (новое, по 18.5% LongMemEval)
3. **Voyager-style skill library** → procedural-память (новое, +31.8% WebArena у SkillWeaver)
4. **GEPA optimizer** → +13% над MIPROv2, 35× cheaper rollouts (ICLR 2026 Oral)
5. **AutoRule judge** → +28.6% AlpacaEval, anti-reward-hacking (arxiv 2506.15651)
6. **DeepSeek V4 Pro как primary** → 96% уже проверено в `skill-trait-detect`

**Каждый компонент peer-reviewed или production-validated.** Сборка целиком — никто не сделал в продукте для end-users.

#### Доказательство #3: SMB / mid-market / Russia — открытая ниша

Glean = $500k+ ARR контракты, enterprise sales cycles 6-12 месяцев. SMB и mid-market платить не будут.

- Glean для компании 50 человек = слишком дорого
- Salesforce только если уже на Salesforce CRM
- MS только если уже на Microsoft 365
- Z как self-serve SaaS для компаний 10-500 человек — **открытое поле**

В Russia + СНГ — конкурентов нет вообще на enterprise memory layer.

#### Доказательство #4: 9 типов встреч + verified LLM-стек = быстрый MVP

У Z уже есть:
- Verified `DeepSeek V4 Pro` для skill-trait-detect (96% accuracy на 25 кейсах)
- Admin-editable prompt registry
- BullMQ + Prisma + pgvector
- TenantGuard для multi-tenant изоляции
- 9 типов встреч = 9 готовых eval-датасетов

Конкурентам нужно строить это с нуля. Z — за 2 недели запустит Фазу 1.

### 11.5. Где Z НЕ сможет стать лучшим (честно)

1. **Не infrastructure layer.** Zep/Mem0/Letta уже взяли. Сражаться бессмысленно — интегрируем их как backend, не строим свой.
2. **Не large enterprise** (5000+). Glean захватил, sales/integrations/compliance — годы развития. Биться невозможно.
3. **Не coding agents.** Devin/Cursor/Cognition взяли. Не наша битва.
4. **Не frontier LLM.** Не строим свою LLM, используем DeepSeek/OpenAI-proxy/qwen.
5. **Не universal AI assistant.** ChatGPT/Claude/Gemini взяли. Мы — vertical (память компании + клоны), не horizontal.

### 11.6. Обновлённая рекомендация (учитывая adversarial review)

**Главный вывод:** моя первоначальная рекомендация **по сути правильная**, но требует трёх обновлений:

1. **Optimizer:** MIPROv2 → **GEPA** (ICLR 2026 Oral, +13% over MIPROv2, 35× cheaper)
2. **Memory architecture Фазы 2:** простой timestamp → **Graphiti-style validity windows** (+18.5% LongMemEval)
3. **Roadmap:** добавить **Фазу 5 (9-12 мес)** — Darwin Gödel Machine-style self-modifying skill generator

**Позиционирование, которое Z должен занять (по итогам adversarial review):**

> «**Z — единственный продукт, в котором клон сотрудника остаётся в компании после его ухода. Без интеграции с Salesforce/Microsoft 365. Для команд 10-500 человек. Цена в 10× ниже Glean.**»

Это позиционирование:
- **Уникально** — никто такого не делает
- **Защищено технически** — двухслойная архитектура + GEPA + AutoRule
- **Имеет рынок** — 171% ROI на agentic AI валидирует категорию
- **Имеет защиту** — Z делает 1-в-1 enterprise-конкурентов (Glean) слишком дорогими; SMB не может себе позволить
- **Имеет роутинг к продукту** — через клонов знакомимся, потом обслуживаем компанию-целиком

**Метрика «лучше всех в мире» — выглядит так:**

| Метрика | Glean (best enterprise) | Zep (best memory) | Salesforce/MS | Z (target) |
|---|---|---|---|---|
| Клон уволенного сотрудника | ❌ | ❌ (это инфраструктура) | ❌ | ✅ |
| Self-improving skills (Voyager) | ❌ | ❌ | ❌ | ✅ |
| GEPA optimization | ❌ | ❌ | ❌ | ✅ |
| AutoRule judge | ❌ | ❌ | ❌ | ✅ |
| Temporal memory (Graphiti) | ❌ | ✅ | ❌ | ✅ (Фаза 2) |
| Enterprise integrations | ✅ 100+ | (backend) | ✅ | Partial |
| Цена для SMB | ❌ (enterprise) | ❌ (per-call) | ❌ (per-seat) | ✅ |
| Russian language | Partial | (backend) | Partial | ✅ |

В **5 из 8** Z — единственный или лучший. **«Лучший в мире» означает не "обогнал во всём", а "единственный, кто решает свою задачу полностью".**

### 11.7. Honest verdict — где доказательства, где предположения

**Доказательства (peer-reviewed / production-validated):**
- ✅ GEPA лучше MIPROv2 — ICLR 2026 Oral, arxiv 2507.19457
- ✅ Zep/Graphiti лучше Mem0 на LongMemEval — arxiv 2501.13956
- ✅ Voyager skill library работает — NeurIPS 2023, arxiv 2305.16291
- ✅ SkillWeaver +31.8% WebArena — arxiv 2504.07079
- ✅ AutoRule reduces reward hacking — arxiv 2506.15651
- ✅ Hermes использует DSPy+GEPA в production — прямой WebFetch первоисточника
- ✅ Glean = $7.2B, 100+ интеграций, ADLC framework — пресс-релиз Dec 2025
- ✅ 171-192% ROI на agentic AI — Klarna $60M, JPMorgan 450+, Google Cloud study

**Гипотезы (требуют валидации):**
- ⚠️ «Клон уволенного сотрудника — открытая ниша» — я искал, не нашёл competitor'a, но возможно есть stealth-mode стартап
- ⚠️ «Z может биться за SMB/mid-market против Glean» — нужен customer research
- ⚠️ «Двухслойная архитектура (роль + персональный) превзойдёт BehaviorChain SOTA» — нужен реальный eval
- ⚠️ «$0.3/optimization run на GEPA для Z масштаба» — нужен budget benchmark на наших данных

**Что я НЕ могу доказать заранее:**
- Будут ли пользователи готовы платить за «клон-после-увольнения» — open product question
- Можно ли обогнать Glean technically — да; продуктово — зависит от исполнения
- Будет ли self-modifying агент работать на нашем стеке — рискованная фаза 5

### 11.8. Что делать прямо сейчас (после adversarial review)

1. **Запустить Фазу 1 с GEPA, не MIPROv2.** Сразу правильный стек.
2. **Customer discovery параллельно** — поговорить с 5-10 потенциальными клиентами «вы заплатили бы за клон ушедшего ключевого сотрудника?». Это валидирует ключевую гипотезу.
3. **Изучить Glean ADLC framework** — заимствовать структуру (Opportunity → Design → ... → Monitor & Improve) для своих agents.
4. **Принять решение про temporal memory** — добавлять в Фазе 2 или откладывать на Фазу 3.
5. **Не начинать конкуренцию с infrastructure (Mem0/Zep)** — рассматривать их как backend опцию.

---

## Итог

| Раздел | Ответ |
|---|---|
| **Можно ли применить self-improvement к Z?** | Да, паттерн доказан индустрией (Voyager NeurIPS 2023, Hermes production, ALITA GAIA 75%, SkillWeaver +31.8%). |
| **Кто судья для always-running агентов?** | AutoRule поверх правок юзера в админке + downstream actions (multi-signal). |
| **Кто судья для клонов?** | Composite: real acceptance + edit distance + outcome + blind LLM-judge + adversarial verifier. |
| **Главная архитектурная рекомендация для клонов?** | Опция C: двухслойная (роль + opt-in персональная) Voyager-style skill library + AutoRule + episodic memory. |
| **Сколько фаз и как долго?** | 4 фазы, 6 месяцев до production-клона маркетолога. Фаза 1 — 2 недели, можно начать сразу. |
| **Закупка нового стека?** | Не требуется. DeepSeek V4 Pro + qwen3.5:9b + OpenAI-proxy + text-embedding-3-small достаточно. |
| **Главный риск?** | Reward hacking. Mitigation — multi-signal judge + AutoRule + human review gates. |

**Следующий шаг:** продуктовое согласование Фазы 1 + написание ТЗ в `plans/tz/2026-06-XX-prompt-self-improvement-mvp.md`.

---
type: analysis
status: research-input
feature: subject-memory-and-self-learning
date: 2026-06-21
snapshot_date: 2026-06-21
---

# Red-team: три рекомендации subject-memory-and-self-learning

Состязательный независимый проход. Задача — опровергнуть, не подтвердить. Теги источников: `verified` (первоисточник/закон/arxiv с числами), `claimed` (вендор/блог), `inferred` (моя экстраполяция из данных).

Снимок: 2026-06-21. Стек цели: Bun+Node+TS / NestJS, Postgres+pgvector, Redis+BullMQ, LLM DeepSeek/OpenAI-proxy, embeddings text-embedding-3-small, ~30 человек в админке → авто-обучение без human-approval.

---

## Рекомендация 1 — статический org-параграф (дериват графа) в SYSTEM-промпте

### ВЕРДИКТ: ОСЛАБЛЕНА (нужна правка: не класть авто-регенерируемый параграф в SYSTEM-prefix; держать дерватив отдельным cache-блоком ИЛИ retrieve на лету)

**Контр-доказательства.**

1. Лидеры (Glean) НЕ держат знание компании в промпте: «retrieval of relevant knowledge happens at query-time rather than trying to retain all knowledge within the model». GraphRAG = vector + knowledge graph, на лету. [glean.com/blog/what-is-a-rag-ai-agent, glean.com/blog/retrieval-augmented-generation-rag, snapshot 2026-06-21] `claimed` (вендор, но описывает архитектуру, не маркетинг).

2. Экономика кэша против авто-регенерации. Cache-hit стоит ~10% от input-rate, экономия 70–90% после первого хода. НО иерархия инвалидации `tools → system → messages`: изменение на уровне system инвалидирует system и всё ниже. «One word changes. The entire cache invalidates… costs spike back to baseline». Ниже ~30% hit-rate write-премия дороже экономии от чтения. [platform.claude.com/docs/.../prompt-caching; medium.com/@mdfadil/prompt-caching-saves-money-until-it-doesnt; web2md.org/blog/prompt-caching-cost-optimization-guide-2026, 2026] `verified` (механика кэша) + `claimed` (числа из блогов, но согласуются с офиц. докой).

   Следствие для Z: если org-параграф **авто-перегенерируется из графа** и стоит в начале SYSTEM — каждая регенерация = полный сброс кэша у ВСЕХ запросов ассистента. Это прямой удар по нашему собственному правилу cache-friendly (feedback_llm_prompts_cache_friendly). `inferred`.

3. Staleness: дериват графа устаревает между регенерациями — то есть отвечает «по вчерашнему слепку», тогда как RAG берёт свежие узлы. «external knowledge is dynamic and can be updated… RAG ideal for facts that change frequently». [machinelearningmastery.com/7-prompt-engineering-tricks; galileo.ai/blog/mastering-rag-llm-prompting] `claimed`.

**Steelman отвергнутой альтернативы (чистый RAG) — усилен.** Для большого/меняющегося знания компании query-time retrieval строго лучше: свежесть + не раздувает каждый токен + не ломает кэш.

**НО рекомендация выживает частично.** Тот же корпус best-practice прямо разрешает статику для УЗКОГО стабильного ядра: «use system prompts for small, stable, frequently-needed context (company fundamentals); RAG for large, dynamic, specialized». [galileo.ai; consensus источников 2026] `claimed`.

**Что изменить:**
- Параграф-дериват держать МАЛЫМ (миссия/структура/инварианты — десятки токенов, не «слепок графа»), стабильным, и **не в SYSTEM-prefix, а отдельным cached-блоком ПОСЛЕ стабильного SYSTEM** (или в самом конце), чтобы регенерация инвалидировала только его, не весь префикс.
- Всё, что меняется чаще, чем раз в недели (люди, проекты, решения, метрики) — НЕ в параграф, а RAG/GraphRAG на лету.
- «Ручное закрепление» оставить — pinned-факты как раз стабильны и кэшируемы; авто-дериват пускать через тот же composite-judge, что и правила (см. рек.3), иначе дрейфующий параграф отравит каждый ответ.
- Метрика-гейт: следить за cache hit-rate ассистента; падение <60% на стабильном промпте = «structural problem». [web2md.org, 2026] `claimed`.

---

## Рекомендация 2 — pgvector top-K → LLM-арбитр → порог → авто-назначить/спросить (роль-приор + человек)

### ВЕРДИКТ: ОСЛАБЛЕНА на «авто-назначении», ВЫЖИВАЕТ как «кандидаты+человек». Авто-назначение задач людям — снять (юр. блокер + числа ошибок)

**Контр-доказательства (числа, не прилагательные).**

1. Семантическая путаница близких компетенций — измерена. SkillRouter-бенч: без конкурентов (20 навыков) — 100% точность; **один конкурент на навык → −7…−30%**; два → **−17…−63%**; при одном размере библиотеки добавление конкурентов даёт **−18…−30%** — то есть «не размер, а семантическая близость драйвит ошибки». Деградация по размеру: 5–20 навыков >90%, 30 — заметная деградация, 50 — сильная, 200 — ~20%; порог ёмкости κ ≈ 84–92 навыка (точность падает вдвое). [arxiv.org/pdf/2603.22455 SkillRouter; arxiv.org/html/2601.04748, snapshot 2026-06-21] `verified` (arxiv, явные числа).

   Прямое попадание в контр-гипотезу «канцелярия ≠ закупки ≠ АХО»: это и есть «same-domain, functionally close but wrong» hard-distractors. У типичной компании 30 чел. навыков-компетенций легко >30 — то есть мы уже в зоне деградации, и именно близкие роли путаются сильнее всего.

2. Почему индустрия откатывается/гибридизирует. «Transition from rule-based to model-based is challenging — complex models lack robustness and interpretability»; rule-based идеален «where 100% explainability is required, every decision traced to a specific auditable rule»; вывод корпуса — **hybrid**. [arxiv.org/pdf/2204.07135 self-learning skill-routing; wearebrain.com; developers.dev, 2026] `claimed`/`verified`.

3. **Юридический блокер (РФ) — это не «риск», это запрет по умолчанию.** Ст. 16 152-ФЗ ч.1: решения **на основании исключительно автоматизированной обработки**, порождающие юр. последствия ИЛИ иным образом затрагивающие права/законные интересы субъекта, **запрещены**, кроме ч.2. Ч.2: можно только при **письменном согласии** субъекта или по фед. закону с гарантиями. Ч.3: оператор обязан разъяснить порядок, дать **возможность возражения**; ч.4: рассмотреть возражение в 30 дней. [consultant.ru/.../LAW_61801 ст.16; legalacts.ru/.../statja-16; zakonrf.info/.../16, ред. 2026] `verified` (текст закона).

   Авто-назначение задачи конкретному сотруднику «затрагивает права/законные интересы» (нагрузка, оценка, KPI) и опирается на профилирование навыков → попадает под ст.16. Чисто-авто без письменного согласия + механизма возражения = нарушение. `inferred` (квалификация), но текст ч.1/ч.3 — `verified`.

**Steelman rule-based (явные теги) — усилен.** Для «канцелярия/закупки/АХО» детерминированный тег-роутинг = 100% объяснимость, нулевая семантическая путаница, аудит-трейл под ст.16. Embedding-кандидаты ценны для DISCOVERY (подсказать «кто мог бы»), не для авто-решения.

**Что изменить:**
- pgvector top-K + LLM-арбитр оставить как **ранжировщик-подсказку** («рекомендуем N»), не как авто-исполнителя.
- Авто-назначение людям — НЕ выкатывать как «исключительно автоматизированное». Финальное назначение — действие человека (тимлид/владелец подтверждает), либо письменное согласие сотрудника + UI-возражение + 30-дневный регламент (тяжело, не для v1).
- Ввести детерминированный слой: явные теги компетенций/роль-приор как hard-фильтр ПЕРЕД семантикой (hybrid: rule gate → semantic rank).
- Порог уверенности калибровать не «спросить/назначить», а «показать топ-3 человеку / не показывать ничего»; при >30 компетенций ждать −18…−30% точности — закладывать это в product-копи («подсказка, не решение»).

---

## Рекомендация 3 — выученные правила из правок (edit-distance → LLM выводит правило → pgvector ретрив → авто-активация через composite-judge+A/B без человека)

### ВЕРДИКТ: ОПРОВЕРГНУТА в части «авто-активация БЕЗ человека на 30 пользователях». Механизм памяти правил — выживает; gate убирать нельзя

**Контр-доказательства.**

1. Замкнутый цикл «учусь на своём выходе» деградирует доказуемо. Два режима коллапса: **Entropy Decay** (монотонная потеря разнообразия из-за конечной выборки) и **Variance Amplification** (дрейф случайным блужданием без постоянного grounding). Ключ: «if the proportion of exogenous, externally grounded signal approaches zero, the system undergoes degenerative dynamics». Reasoning-collapse: рационали становятся шаблонными, связь с целью слабеет. [arxiv.org/html/2601.05280 limits of self-improving; arxiv.org/pdf/2604.06268 RAGEN-2; hackaday.com/2026/04/29 model-collapse-inevitable, 2026] `verified` (arxiv).

   Применение к Z: правки 30 пользователей — это и есть внешний сигнал (grounding не ноль) → catastrophic collapse в чистом виде нам не грозит. НО composite-judge, выводящий правила из правок и сам же фильтрующий, добавляет петлю «LLM учится на LLM-суждении» — частично замкнутую. `inferred`.

2. Composite-judge сам предвзят и галлюцинирует. Самопреференция измерена (GPT-4 «significant degree of self-preference»), плюс verbosity-bias (длиннее → выше балл независимо от качества) и position-bias; модели завышают оценку текстам с низкой perplexity (более «своим»). «Judge who never admits» — скрытые shortcut-эвристики. [arxiv.org/abs/2410.21819 self-preference; arxiv.org/pdf/2602.07996; arxiv.org/html/2509.26072 silent judge, 2026] `verified`.

   Следствие: «авто-активация через composite-judge» = доверить выкат правила судье, который систематически любит свой собственный стиль и многословие. Конфликт правил-предпочтений (рек. явно их допускает) судья не разрешит надёжно. `inferred`.

3. Индустрия оставляет gate. «For agents in production, unreliable improvement can be MORE damaging than no improvement»; рекомендованный цикл = observe → evaluate → add examples → test → **gate deployment**. AgentDevel прямо переосмысляет self-evolving агентов как **release engineering** (с гейтами/откатами), не как авто-мутацию. [arize.com/blog/from-production-traces; arxiv.org/pdf/2601.04620 AgentDevel, 2026] `claimed`/`verified`.

4. OSS-реальность conflict-resolution. mem0 «resolves conflicts on write — updates existing record rather than creating duplicate», т.е. **разрешает конфликт детерминированной перезаписью, а не авто-судьёй A/B**. Это более консервативный паттерн, чем предложенная авто-активация. [sureprompts.com/blog/mem0-implementation-guide; callsphere.ai mem0; vectorize.io mem0-vs-letta, 2026] `claimed`.

**Steelman «оставить человека» — усилен.** На 30 пользователях объём правок мал → статзначимость A/B почти недостижима за разумное окно; «соглашаются и соглашаются» (наш собственный feedback_no_human_in_loop) решает проблему вовлечённости, но НЕ решает проблему предвзятого судьи и конфликта правил. Дешёвый компромисс: не «человек одобряет каждое правило» (этого мы и не хотим), а **shadow-режим + авто-rollback**.

**Что изменить (примиряет с нашим Ship-On / no-human-approval):**
- Память правил, edit-distance триггер, LLM-вывод правила, pgvector-ретрив — оставить, это валидно.
- Активацию делать НЕ «composite-judge → сразу прод», а **canary/shadow**: правило применяется к доле трафика, метрика «правок после правила vs до» (внешний grounding, не суждение судьи), авто-промоут при улучшении, авто-rollback при росте правок/жалоб. Человек — только kill-switch (совпадает с feedback_no_human_in_loop_for_clone_learning).
- Judge не один: использовать ансамбль/несколько провайдеров (DeepSeek + OpenAI-proxy) против self-preference; никогда судья = генератор правила.
- Дедуп/конфликт правил решать как mem0 — перезапись по write, плюс явный supersede (у нас уже есть авто-supersede онтологии) — а не сосуществование противоречивых предпочтений.
- На 30 пользователях A/B заменить на **накопительный shadow-eval** (статзначимости не будет — мерить тренд правок, не p-value).

---

## Готовый TS/Node OSS (проверка «не пропустил ли основной проход»)

- **mem0** — есть **TypeScript/JS SDK** (примитивы add/search/update/delete над embeddings-стором, scope user/session/agent, conflict-resolve on write). Прямо ложится на рек.3 (память правил) и частично рек.1 (pinned-факты). [github mem0; vectorize.io: «Mem0 has Python, JavaScript SDKs»; sureprompts.com, 2026] `claimed`. Рекомендация: рассмотреть как библиотеку памяти вместо самописа, но активацию/judge всё равно строить самим (mem0 их не закрывает).
- **Letta (MemGPT)** — self-improving stateful agents, episodic/semantic/procedural память. **TS SDK заявлен на letta-ai/letta**, хотя один обзор называет только Python — нужно перепроверить версию SDK перед ставкой. [github.com/letta-ai/letta; vectorize.io (противоречие), 2026] `claimed`, требует верификации. Тяжелее mem0, навязывает свою агент-модель — против нашего «агент-луп уже есть».
- Под рек.2 готового TS-роутера навыков под наш кейс не найдено; SkillRouter/vLLM-router — research/Python-инфра, не drop-in. Делать самим как hybrid rule+pgvector. `inferred`.

---

## Сводка правок (что менять, числами)

1. **Org-context:** не авто-регенерируемый параграф в SYSTEM-prefix. Малое стабильное ядро (десятки токенов) отдельным cached-блоком ПОСЛЕ стабильного SYSTEM; всё динамичное — RAG на лету. Следить cache hit-rate ≥60%.
2. **Skill-routing:** убрать чисто-авто-назначение людям (ст.16 152-ФЗ: запрет без письм. согласия + возражение/30 дней). Hybrid: явные теги как hard-gate → pgvector+LLM как ранжировщик-подсказка человеку. Закладывать −18…−30% точности при близких компетенциях и >30 навыках.
3. **Self-learning:** убрать «composite-judge → сразу прод». Canary/shadow + авто-rollback по внешней метрике (объём правок до/после), judge-ансамбль ≠ генератор правила, конфликты — перезапись/supersede. Человек — kill-switch, не approval (совместимо с no-human-in-loop). На 30 польз. — shadow-eval тренда, не A/B p-value.

## Источники (URL · дата · тег)

- glean.com/blog/what-is-a-rag-ai-agent · 2026-06-21 · claimed
- glean.com/blog/retrieval-augmented-generation-rag-the-key-to-enabling-generative-ai-for-the-enterprise · 2026 · claimed
- platform.claude.com/docs/en/build-with-claude/prompt-caching · 2026 · verified
- medium.com/@mdfadil/prompt-caching-saves-money-until-it-doesnt · 2026 · claimed
- web2md.org/blog/prompt-caching-cost-optimization-guide-2026 · 2026 · claimed
- galileo.ai/blog/mastering-rag-llm-prompting-techniques-for-reducing-hallucinations · 2026 · claimed
- arxiv.org/pdf/2603.22455 (SkillRouter) · 2026 · verified
- arxiv.org/html/2601.04748 (Single-Agent-with-Skills) · 2026 · verified
- arxiv.org/pdf/2204.07135 (self-learning skill routing) · 2026 · verified
- consultant.ru/document/cons_doc_LAW_61801 ст.16 · ред. 2026 · verified
- legalacts.ru/doc/152_FZ-o-personalnyh-dannyh/glava-3/statja-16 · 2026 · verified
- zakonrf.info/zakon-o-personalnyh-dannyh/16 · 2026 · verified
- arxiv.org/html/2601.05280 (limits of self-improving) · 2026 · verified
- arxiv.org/pdf/2604.06268 (RAGEN-2 reasoning collapse) · 2026 · verified
- hackaday.com/2026/04/29 (model collapse inevitable) · 2026-04-29 · claimed
- arxiv.org/abs/2410.21819 (self-preference bias LLM-judge) · verified
- arxiv.org/pdf/2602.07996 (judge who never admits) · 2026 · verified
- arxiv.org/html/2509.26072 (silent judge shortcut bias) · 2026 · verified
- arize.com/blog/from-production-traces-to-better-ai-agents · 2026 · claimed
- arxiv.org/pdf/2601.04620 (AgentDevel release engineering) · 2026 · verified
- sureprompts.com/blog/mem0-implementation-guide · 2026 · claimed
- vectorize.io/articles/mem0-vs-letta · 2026 · claimed
- github.com/letta-ai/letta · 2026 · claimed

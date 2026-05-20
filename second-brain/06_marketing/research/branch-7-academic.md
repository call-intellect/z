---
title: "Ветка 7 — Academic / Research памяти AI-агентов"
date: 2026-05-20
type: research
status: draft
distilled: false
---

# Ветка 7 — Academic / Research памяти AI-агентов

> Что нового в академическом фронтире 2024-2026. Что может стать следующей волной.
> Дата сборки: 2026-05-20.
> Связано с [[second-brain-approach-research]] (раздел 11) и [[market-research-2026]].

## 0. Контекст и метод

Цель сборки — понять, какие архитектурные идеи памяти LLM-агентов **уже доказали состоятельность** (есть код, бенчмарки, цитирование), какие **только формируются**, и где Z может оказаться, если будет строить «второй мозг компании» на горизонте 12-24 месяцев.

Источники: arXiv (cs.CL, cs.AI, cs.LG), Papers with Code, Semantic Scholar, материалы ICML 2024, NeurIPS 2024, ICLR 2024-2025, ACL 2025, EMNLP 2025, блоги DeepMind / Meta AI / Microsoft Research, обзорные посты Lil'Log (Lilian Weng), репозиторий Shichun-Liu/Agent-Memory-Paper-List.

Сокращения:
- **RAG** (Retrieval-Augmented Generation — генерация с подмешиванием поиска) — базовый паттерн поиска фрагментов в векторной базе и инъекции в промпт.
- **KG** (Knowledge Graph — граф знаний) — структурированное представление сущностей и связей.
- **KV-cache** (Key-Value cache — кэш ключей и значений внутреннего внимания трансформера) — состояние трансформера на инференсе, основная нагрузка по памяти для длинного контекста.
- **ICL** (In-Context Learning — обучение в контексте) — приём, когда модель «учится» прямо из примеров в промпте без обновления весов.
- **TTL** (Test-Time Learning — обучение во время инференса) — модификация состояния модели прямо во время работы, без полноценного дообучения.

---

## 7.1. Топ-15 работ по памяти LLM 2024-2026

### 1. MemGPT / Letta — память как ОС (Packer et al., UC Berkeley, окт 2023, v2 фев 2024)

- arXiv: [2310.08560](https://arxiv.org/abs/2310.08560), NeurIPS 2024 (oral).
- Авторы: Charles Packer, Sarah Wooders, Kevin Lin, Vivian Fang, Shishir G. Patil, Ion Stoica, Joseph E. Gonzalez.
- **Идея:** перенести идею иерархической памяти ОС (быстрая RAM ↔ медленный диск) в LLM-агента. Модель сама вызывает функции `core_memory_append`, `archival_memory_search`, переключая фрагменты между «main context» и «recall storage».
- **Отличие от RAG:** управление памятью становится действием самой модели через function calls, а не внешним пайплайном. Появляется идея «прерываний» (interrupt) — агент может уйти в самосозерцание, перебрать архив и вернуться.
- **Open-source:** [letta-ai/letta](https://github.com/letta-ai/letta) (бывший MemGPT) — Apache 2.0, активная разработка, REST API, поддержка любых LLM-провайдеров.
- **Решает:** ограничение контекстного окна в многосессионных диалогах и работе с документами, превышающими размер контекста.
- **Цитирование / impact:** >1000 цитат на Semantic Scholar; стал каноническим референсом для агентов «с памятью», коммерческая Letta построена вокруг него.

### 2. HippoRAG — нейробиологически вдохновлённая память (Gutierrez et al., Ohio State, май 2024)

- arXiv: [2405.14831](https://arxiv.org/abs/2405.14831), NeurIPS 2024.
- **Идея:** имитация теории «гиппокампального индекса» из нейронауки. Неокортекс ↔ LLM (фрагменты), гиппокамп ↔ knowledge graph + Personalized PageRank. При запросе пробуждаются связанные концепты через распространение активации по графу.
- **Отличие от RAG:** один запрос → не top-K независимых фрагментов, а связный кластер сущностей, найденный по PageRank-обходу. Это даёт «memory hop» бесплатно — multi-hop reasoning без итеративного вызова LLM.
- **Open-source:** [OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG), MIT.
- **Решает:** multi-hop QA, где факт собирается из нескольких документов. До 20% улучшения относительно SOTA RAG; в 10-30 раз дешевле итеративных подходов.
- **Impact:** активно сравнивают со всеми новыми graph-RAG системами. В 2025 вышел HippoRAG-V2.

### 3. Zep / Graphiti — темпоральный knowledge graph для агентов (Rasmussen et al., Zep AI, янв 2025)

- arXiv: [2501.13956](https://arxiv.org/abs/2501.13956).
- **Идея:** memory layer-сервис, где факты представлены как сущности и отношения **с явными временными окнами валидности** (bi-temporal model: когда факт создан в системе vs. когда он действовал в реальности). Граф непрерывно обновляется из чата и структурированных данных.
- **Отличие от RAG:** базовый RAG возвращает релевантные фрагменты без понимания «было vs. есть сейчас». Graphiti знает, что вчерашний адрес клиента ≠ сегодняшний, и помечает старый как expired.
- **Open-source:** [getzep/graphiti](https://github.com/getzep/graphiti), Apache 2.0.
- **Решает:** факты, меняющиеся со временем (роль сотрудника, цена контракта, статус задачи). Обходит MemGPT в Deep Memory Retrieval benchmark (94.8% vs 93.4%).
- **Impact:** одна из двух наиболее обсуждаемых архитектур памяти 2025 (вторая — Mem0). Активно интегрируется в LangGraph.

### 4. A-MEM — агентная самоорганизующаяся память (Xu et al., Rutgers, фев 2025)

- arXiv: [2502.12110](https://arxiv.org/abs/2502.12110).
- **Идея:** Zettelkasten-вдохновлённая память. Каждая новая заметка → агент самостоятельно строит её представление (тег, контекст, эмбеддинг), затем анализирует архив и решает, к каким старым заметкам её связать. Структура графа возникает динамически, без заранее заданной схемы.
- **Отличие от RAG / Mem0:** в стандартном Mem0 структура памяти зафиксирована (профиль / факты). В A-MEM нет схемы — агент сам решает, какие атрибуты выделить и какие связи протянуть. Близко к идее «self-organizing memory».
- **Open-source:** [agiresearch/A-mem](https://github.com/agiresearch/a-mem), MIT.
- **Решает:** адаптацию памяти под разные задачи и предметные области без переписывания схемы.
- **Impact:** одна из самых обсуждаемых работ 2025 на стыке Zettelkasten и LLM. Базовая идея уже расходится по open-source (см. Mem0 v2, Cognee).

### 5. Mem0 — production-ready память (Chhikara et al., Mem0.ai, апр 2025, ECAI 2025)

- arXiv: [2504.19413](https://arxiv.org/abs/2504.19413).
- **Идея:** scalable memory-centric architecture: динамическое извлечение, консолидация, retrieval salient information. Mem0+ добавляет graph memory поверх. Главное — production-fit: p95 латентность на 91% ниже, цена в токенах на 90% ниже.
- **Отличие от RAG / MemGPT:** упор не на новую идею, а на инженерное упрощение и измерение на LoCoMo. Это первая работа, где честно сравниваются все 10 подходов памяти (RAG, full-context, OpenAI Memory, Letta, Zep, Mem0) на одной задаче.
- **Open-source:** [mem0ai/mem0](https://github.com/mem0ai/mem0), Apache 2.0.
- **Решает:** инженерный gap «есть прототип на arXiv → нет продакшена». Стал стандартом сравнения новых работ.
- **Impact:** ECAI 2025, $24M Series A, де-факто референс для всех memory-frameworks 2025-2026.

### 6. MemoryOS — операционная система памяти агента (Bai Lab et al., май 2025, EMNLP 2025 Oral)

- arXiv: [2506.06326](https://arxiv.org/abs/2506.06326).
- **Идея:** трёхуровневая память (short-term / mid-term / long-term persona memory) + правила миграции между уровнями (FIFO для short→mid, segmented page organization для mid→long). Развитие идеи MemGPT с акцентом на «persona memory» — устойчивый профиль пользователя.
- **Отличие от MemGPT:** добавлен mid-term уровень и автоматическое обновление пользовательского профиля; работает поверх любой LLM.
- **Open-source:** [BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS), Apache 2.0.
- **Решает:** persistent personalization. SOTA на LoCoMo: F1 +49.11%, BLEU-1 +46.18%.
- **Impact:** EMNLP 2025 Oral, активно реализуется в китайских AI-стартапах.

### 7. Titans — обучение памяти во время инференса (Behrouz et al., Google Research, янв 2025)

- arXiv: [2501.00663](https://arxiv.org/abs/2501.00663), ICLR 2025.
- **Идея:** Neural Long-Term Memory Module (LMM) — отдельный глубокий нелинейный рекуррентный модуль, который **обновляет собственные веса прямо в forward pass**. Внимание = краткосрочная память, нейромодуль = долгосрочная.
- **Отличие от RAG / KV-cache:** не retrieval, а реальное TTL. Память живёт не как внешняя база, а как часть модели, изменяющаяся в момент работы.
- **Open-source:** есть [tiantians-flame/titans-pytorch](https://github.com/lucidrains/titans-pytorch) (неофициальный port от lucidrains).
- **Решает:** scaling до 2M+ токенов, обходит GPT-4 на BABILong reasoning benchmark.
- **Impact:** очень высокий медиаэффект; есть критическая работа [Titans Revisited](https://arxiv.org/abs/2510.09551), которая указывает на проблемы воспроизводимости — но сама идея TTL-памяти уже разветвилась в несколько работ.

### 8. EM-LLM — эпизодическая память по «удивлению» (Fountas et al., Huawei + UCL, июль 2024)

- arXiv: [2407.09450](https://arxiv.org/abs/2407.09450), ICLR 2025.
- **Идея:** сегментация потока токенов на «эпизоды» по точкам высокой Bayesian surprise (моменты, где предсказание модели сильно расходится с реальностью — нейробиологический аналог event boundaries в человеческой эпизодической памяти). Retrieval — двухстадийный: similarity + temporal contiguity.
- **Отличие от RAG:** сегментация не по фиксированным окнам, а по семантическим границам, найденным самой моделью. Похоже на то, как человек делит непрерывный опыт на эпизоды («совещание утром», «обед», «разбор инцидента»).
- **Open-source:** [em-llm/em-llm](https://github.com/em-llm/em-llm), MIT.
- **Решает:** retrieval на 10M токенах без fine-tuning, превосходит full-context модели.
- **Impact:** база для будущих «когнитивно-обоснованных» memory-архитектур.

### 9. Memory³ — явная память как третий тип (Yang et al., июль 2024)

- arXiv: [2407.01178](https://arxiv.org/abs/2407.01178).
- **Идея:** в LLM есть implicit memory (веса), working memory (контекст) — Memory³ добавляет третий тип: явная sparse-memory bank в специальном embedding-слое. Знания выносятся из весов в дешёвый внешний банк.
- **Отличие от RAG:** не текстовые фрагменты, а пред-вычисленные sparse-репрезентации, которые подключаются через специальное внимание. Дешевле параметров модели и дешевле RAG.
- **Open-source:** есть страница проекта Memory3, код частично открыт.
- **Решает:** обучили 2.4B модель с этой памятью — обгоняет большие LLM и RAG-системы, при этом быстрее на инференсе.
- **Impact:** концептуальный мост к Kanerva Sparse Distributed Memory (1988) — биологически правдоподобный sparse-distributed подход к памяти в современных трансформерах.

### 10. Larimar — эпизодический контроль и быстрое редактирование фактов (Das et al., IBM Research, мар 2024, ICML 2024)

- arXiv: [2403.11901](https://arxiv.org/abs/2403.11901).
- **Идея:** brain-inspired distributed episodic memory модуль, подключаемый к любому LLM. Обновление фактов = pseudo-inverse update, переформулированный как least-squares. One-shot правка без fine-tuning.
- **Отличие от RAG:** редактирование происходит в латентной памяти модели, не в внешней базе текстов. 8-10x ускорение по сравнению с конкурентами.
- **Open-source:** есть на IBM GitHub, в исследовательском режиме.
- **Решает:** factual updating (новый факт пришёл — старый аннулировать), selective forgetting, information leakage prevention.
- **Impact:** ICML 2024. Прямой ответ на проблему «как обновить знание в LLM без дообучения».

### 11. RAPTOR — иерархическое суммирование дерева (Sarthi et al., Stanford, янв 2024, ICLR 2024)

- arXiv: [2401.18059](https://arxiv.org/abs/2401.18059).
- **Идея:** документы кластеризуются, каждый кластер суммируется LLM, рекурсивно строится дерево. На retrieval запрос ходит по уровням дерева — может вернуть детальный фрагмент или верхнеуровневое summary.
- **Отличие от RAG:** не плоский набор chunks, а дерево обобщений. Многоуровневое чтение документа.
- **Open-source:** [parthsarthi03/raptor](https://github.com/parthsarthi03/raptor), MIT.
- **Решает:** holistic understanding длинных документов. +20% на QuALITY benchmark с GPT-4.
- **Impact:** ICLR 2024 spotlight. Базовая идея «иерархия абстракций» переехала в LightRAG и GraphRAG.

### 12. GraphRAG — Microsoft Research (Edge et al., апр 2024)

- arXiv: [2404.16130](https://arxiv.org/abs/2404.16130).
- **Идея:** LLM строит knowledge graph по корпусу, кластеризует его в иерархию communities (Leiden), генерирует summary для каждой community. На запрос идёт map-reduce по community summaries.
- **Отличие от RAG:** «global» вопросы («какая главная тема корпуса?») RAG не решает в принципе. GraphRAG отвечает через community summaries.
- **Open-source:** [microsoft/graphrag](https://github.com/microsoft/graphrag), MIT.
- **Решает:** sense-making по корпусу (нарративные private-данные), не только targeted QA.
- **Impact:** один из самых цитируемых RAG-extension 2024. Породил волну Graph-RAG в коммерческих платформах.

### 13. LightRAG — двухуровневый retrieval по графу (Guo et al., HKU, окт 2024, EMNLP 2025)

- arXiv: [2410.05779](https://arxiv.org/abs/2410.05779).
- **Идея:** комбинация vector + graph. Двухуровневый retrieval: low-level (конкретные сущности) + high-level (темы и связи). Инкрементальное обновление без полной перестройки графа.
- **Отличие от GraphRAG:** дешевле и быстрее, инкрементальное обновление. Не нужно пересчитывать всю иерархию communities при добавлении документа.
- **Open-source:** [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG), MIT — один из самых популярных Graph-RAG проектов 2025 (>15K stars).
- **Решает:** «GraphRAG, но без боли с обновлениями» — критично для систем, куда постоянно поступают новые встречи / документы.
- **Impact:** EMNLP 2025; massively-adopted open-source baseline.

### 14. MemoRAG — глобальная память поверх длинного контекста (Qian et al., BAAI, сен 2024)

- arXiv: [2409.05591](https://arxiv.org/abs/2409.05591), WWW 2025.
- **Идея:** dual-system: лёгкая, но длинно-контекстная LLM формирует «global memory» базы через KV-компрессию, и эта память «подсказывает» (clues) основной модели, куда смотреть. Memory ↔ Generation обучаются через RLGF (RL from Generation Feedback).
- **Отличие от RAG:** не нужен explicit query — память сама даёт подсказки, что вытащить. Работает на задачах, где query плохо сформулирован.
- **Open-source:** [qhjqhj00/MemoRAG](https://github.com/qhjqhj00/MemoRAG), Apache 2.0.
- **Решает:** long-context tasks, где запрос не явный (open-ended summarization, exploratory analytics).
- **Impact:** один из перспективных шагов к «next-gen RAG» — память не как хранилище, а как guidance.

### 15. AriGraph — KG world models с эпизодической памятью (Anokhin et al., AIRI Institute, июл 2024)

- arXiv: [2407.04363](https://arxiv.org/abs/2407.04363).
- **Идея:** агент строит память как knowledge graph с двумя слоями: семантический (объекты и связи в среде) и эпизодический (вершины-события, связанные с семантическими сущностями). По сути — world model для агента в текстовых играх.
- **Отличие от RAG:** граф служит моделью среды, не только поисковой базой. Агент использует его для планирования.
- **Open-source:** [AIRI-Institute/AriGraph](https://github.com/AIRI-Institute/AriGraph), MIT.
- **Решает:** decision-making в интерактивных средах, где RAG неэффективен из-за отсутствия структуры.
- **Impact:** один из мостов между LLM-агентами и классическими world models LeCun-овской школы. Российский институт (AIRI) — редкий пример работы из РФ в топе цитирования по memory.

---

## 7.2. Дополнительный пул упомянутых работ

(минимум 10 ещё, для полноты карты)

16. **MemoryBank** — Zhong et al., AAAI 2024, [2305.10250](https://arxiv.org/abs/2305.10250). Память + механизм «забывания» по кривой Эббингауза. SiliconFriend как PoC. Базовая идея «забывать как человек» цитируется во всех последующих работах.

17. **Reflexion** — Shinn et al., NeurIPS 2023, [2303.11366](https://arxiv.org/abs/2303.11366). Verbal reinforcement learning: агент сам пишет рефлексию в episodic memory buffer. Идеологический предок ExpeL и всех memory-as-learning систем.

18. **ExpeL** — Zhao et al., AAAI 2024, [2308.10144](https://arxiv.org/abs/2308.10144). Сравнение успешных / провальных траекторий, извлечение «правил» как переиспользуемой эвристики. [LeapLabTHU/ExpeL](https://github.com/LeapLabTHU/ExpeL).

19. **Voyager** — Wang et al., NVIDIA + Caltech, 2023, [2305.16291](https://arxiv.org/abs/2305.16291). Skill library как растущая память исполнимого кода. Открыл идею «memory = compositional skills».

20. **Generative Agents** (Park et al., Stanford + Google, 2023, [2304.03442](https://arxiv.org/abs/2304.03442)). Memory stream + reflection. Идеологический отец всей сегодняшней «agent memory» литературы — на него ссылаются почти все более новые работы.

21. **Infini-attention** — Munkhdalai et al., Google, [2404.07143](https://arxiv.org/abs/2404.07143). Compressive memory как часть внутреннего внимания. До 1M токенов на 1B-модели.

22. **MemoryLLM** — Wang et al., ICML 2024, [2402.04624](https://arxiv.org/abs/2402.04624). Trainable memory pool внутри трансформера, self-updatable. [wangyu-ustc/MemoryLLM](https://github.com/wangyu-ustc/MemoryLLM). Продолжение — **M+** ([2502.00592](https://arxiv.org/abs/2502.00592)), 2025.

23. **MemTree** — Rezazadegan Tavakoli et al., NeurIPS 2024, [2410.14052](https://arxiv.org/abs/2410.14052). Динамическое дерево-схема, формируется по семантическим эмбеддингам в диалоге.

24. **LongMem** — Wang et al., NeurIPS 2023, [2306.07174](https://arxiv.org/abs/2306.07174). Decoupled memory: основная LLM заморожена, side-network — memory retriever/reader. До 65K токенов кэша.

25. **RecallM** — Kynoch et al., 2023, [2307.02738](https://arxiv.org/abs/2307.02738). Гибрид graph + vector с темпоральным reasoning. Один из ранних предков Graphiti.

26. **MEM1** — Yuan et al., июн 2025, [2506.15841](https://arxiv.org/abs/2506.15841). End-to-end RL: агент учится держать constant-memory state, синергизирующий рассуждение и память. 3.5x улучшение, 3.7x меньше памяти.

27. **RMM / Reflective Memory Management** — Tan et al., ACL 2025, [2503.08026](https://arxiv.org/abs/2503.08026). Prospective + Retrospective reflection. +10% на LongMemEval.

28. **Collaborative Memory** — Hatamizadeh et al., май 2025, [2505.18279](https://arxiv.org/abs/2505.18279). Multi-user shared memory с динамическим access control. Закладка под корпоративные сценарии.

29. **SymAgent** — фев 2025, [2502.03283](https://arxiv.org/abs/2502.03283). Neural-symbolic self-learning agent поверх KG.

30. **TReMu** — фев 2025, [2502.01630](https://arxiv.org/abs/2502.01630). Neuro-symbolic temporal reasoning для multi-session диалогов.

31. **V-JEPA 2** — Meta AI / Yann LeCun, июн 2025, [2506.09985](https://arxiv.org/abs/2506.09985). Self-supervised video world model — не про LLM-память напрямую, но даёт архитектурный pattern «predict the future = compress the past», который в 2026 уже мигрирует в текстовые агенты.

32. **Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers** — survey, мар 2026, [2603.07670](https://arxiv.org/abs/2603.07670). Самый свежий обзор; именно из него мы берём раздел «emerging frontiers».

33. **From Storage to Experience** — survey, май 2026, [2605.06716](https://arxiv.org/abs/2605.06716). Эволюционная схема: Storage → Reflection → Experience.

34. **Memory in the LLM Era: Modular Architectures** — survey, апр 2026, [2604.01707](https://arxiv.org/abs/2604.01707). Унифицированный фреймворк для сравнения архитектур.

---

## 7.3. Карта методов — группировка по семействам

### A. Retrieval-augmented (классический RAG и его варианты)
Базовый паттерн: top-K векторного поиска → инъекция в промпт. Эволюция:
- **RAPTOR** — иерархия абстракций.
- **MemoRAG** — global memory как guidance.
- **HippoRAG** — graph + PageRank вместо плоского top-K.
- **LightRAG** — двухуровневый retrieval + инкрементальное обновление.

### B. Memory-augmented transformers (память внутри модели)
- **Memory³** — sparse explicit memory как третий тип.
- **MemoryLLM / M+** — обучаемый memory pool в архитектуре.
- **Larimar** — distributed episodic memory + pseudo-inverse update.
- **Infini-attention** — compressive memory в attention.
- **Titans** — TTL-обучение Neural LMM в forward pass.
- **LongMem** — decoupled side-network как retriever/reader.

### C. Hierarchical / multi-tier memory
- **MemGPT / Letta** — main context ↔ recall storage ↔ archival memory.
- **MemoryOS** — short / mid / long-term + persona.
- **MemTree** — динамическое дерево-схема.

### D. Graph-based memory
- **GraphRAG** — communities + Leiden + summaries.
- **Zep / Graphiti** — bi-temporal KG.
- **LightRAG** — vector × graph.
- **AriGraph** — KG world model.
- **Cognee** ([2505.24478](https://arxiv.org/abs/2505.24478)) — открытый control-plane.

### E. Neurosymbolic
- **SymAgent** — self-learning neural-symbolic agent.
- **TReMu** — temporal reasoning на нейро-символическом мосте.
- **RecallM** — гибрид graph + vector с темпоральной семантикой.
- **CLAUSE** ([2509.21035](https://arxiv.org/abs/2509.21035)) — agentic neuro-symbolic KG reasoning.

### F. Episodic / event memory
- **EM-LLM** — сегментация по Bayesian surprise.
- **A-MEM** — Zettelkasten-вдохновлённая агентная организация.
- **Generative Agents** — memory stream + reflection.
- **Reflexion** — verbal RL по эпизодам.

### G. World models / predictive memory (формирующееся семейство)
- **V-JEPA 2** — joint embedding predictive architecture для видео.
- **AriGraph** — KG world model для текстовых сред.
- **MEM1** — RL для memory + reasoning через constant state.
- Свежие 2026: Beyond Fact Retrieval ([2511.07587](https://arxiv.org/abs/2511.07587)), Position: Episodic Memory ([2502.06975](https://arxiv.org/abs/2502.06975)).

### H. Multi-agent / shared memory
- **Collaborative Memory** ([2505.18279](https://arxiv.org/abs/2505.18279)) — private + shared с access control.
- **Memory as a Service** ([2506.22815](https://arxiv.org/abs/2506.22815)) — память как сервис-ориентированный модуль.
- **Intrinsic Memory Agents** ([2508.08997](https://arxiv.org/abs/2508.08997)) — структурированный контекст для гетерогенной команды агентов.

---

## 7.4. Новые подходы — кандидаты на «следующую волну»

10 направлений, которые ещё не массово в продакшене, но имеют шансы стать стандартом в 12-24 месяцев. По каждому — почему интересно именно для Z.

### NW-1. Test-Time-Learning памяти (Titans-семейство)
**Что это:** память не как retrieval-база, а как **модуль, обучающийся в forward pass**. Веса памяти меняются прямо во время инференса.
**Почему интересно для Z:** если идея воспроизведётся (Titans Revisited показал, что воспроизводимость пока спорная), это снимает потребность во внешнем KG и vector store для long-context задач. Для встреч это означает «модель помнит контекст всей серии встреч без отдельной memory-инфраструктуры». Сейчас — наблюдать, не строить.

### NW-2. Bayesian-surprise event segmentation (EM-LLM)
**Что это:** автоматическая сегментация потока контекста на «эпизоды» по точкам неожиданности.
**Почему интересно для Z:** автоматически режет транскрипт длинной встречи на смысловые блоки без эвристик «по тишине / по смене спикера». Идеальный кандидат под наш AI-отчёт: вместо ручного chunking — нейробиологически обоснованная сегментация. Уже сейчас можно прототипировать поверх Vox/GigaAM транскриптов.

### NW-3. Bi-temporal KG (Graphiti)
**Что это:** факты живут с двумя временными метками — «когда в системе» и «когда в реальности». Старые версии не удаляются, а помечаются expired.
**Почему интересно для Z:** «второй мозг компании» обязан различать «адрес офиса до переезда / после переезда», «роль человека до и после повышения». Это критично для атрибуции по встречам, охватывающим месяцы. Graphiti уже production-ready — можно брать.

### NW-4. Self-organizing memory без фиксированной схемы (A-MEM)
**Что это:** агент сам решает, какие атрибуты выделять и какие связи строить, без заранее зафиксированной онтологии.
**Почему интересно для Z:** разные типы встреч (1:1, planning, retrospective, sales-call) требуют разной структуры заметок. A-MEM-подход избавляет от написания 9 отдельных схем под 9 типов встреч.

### NW-5. Multi-agent shared memory с access-control (Collaborative Memory)
**Что это:** память, разделённая на private (один пользователь) + shared (команда), с динамическими правами на чтение.
**Почему интересно для Z:** прямая параллель к корпоративной модели — «мои встречи / встречи команды / встречи компании», и нужно ФЗ-152 соблюдать. Близкая к нашему ICP архитектура. Берётся практически как чертёж.

### NW-6. Predictive / generative episodic memory (Beyond Fact Retrieval, 2511.07587)
**Что это:** память не только хранит факты, но и **предсказывает следующее событие**. Память = генеративная модель, способная к экстраполяции.
**Почему интересно для Z:** «следующая встреча по этому проекту — что будет обсуждаться?» — это и есть predictive memory. На горизонте 12-18 месяцев это превратится в фичу «AI готовит вас к встрече по прогнозу темы». Сейчас — наблюдать в академии, мониторить.

### NW-7. Sparse Distributed Memory (Memory³ + Kanerva-revival)
**Что это:** возврат идей Pentti Kanerva 1988-го (sparse distributed memory) в современные трансформеры. Знания — sparse-репрезентации, дешевле параметров и быстрее RAG.
**Почему интересно для Z:** долгосрочно — может полностью заменить vector DB. Сейчас — следить, особенно за Memory³ и работами на стыке neuroscience + transformer memory.

### NW-8. Memory-Reasoning RL co-training (MEM1)
**Что это:** end-to-end RL, где модель учится одновременно рассуждать и поддерживать compact memory state. Constant memory footprint на любых горизонтах.
**Почему интересно для Z:** для длинной серии связанных встреч это даёт ограниченный (предсказуемый) расход токенов и затрат на LLM. Технически сложно — но если выстрелит, изменит экономику long-horizon agents.

### NW-9. Sleep-like memory consolidation
**Что это:** работы 2025-2026 ([2603.14517](https://arxiv.org/abs/2603.14517)) о консолидации памяти в фазах «сна» — пакетный пересмотр пройденного материала с переподписыванием связей. Близко к Reflexion+ExpeL, но как самостоятельный паттерн.
**Почему интересно для Z:** ночной job, который пересматривает встречи дня и переподписывает граф знаний. Архитектурно понятно, инженерно дешёво — реализуемо сейчас.

### NW-10. Neurosymbolic temporal reasoning (TReMu, SymAgent, CLAUSE)
**Что это:** граф + нейронный reasoner + символический планировщик в одной петле, с явной темпоральной логикой.
**Почему интересно для Z:** «кто что обещал и к какому сроку» — задача темпорального reasoning. Сейчас все решают её ad-hoc через промпт. Через 12 месяцев это станет стандартным компонентом.

---

## 7.5. Связь академии с open-source

Из топ-15 работ **12 имеют рабочий open-source код**, что необычно высоко. Это отражает важную особенность memory-research 2024-2026: исследовательский импульс синхронизирован с инженерным.

| Академическая работа | Open-source | Влияние на коммерческие фреймворки |
|---|---|---|
| MemGPT | letta-ai/letta | Letta SaaS целиком построен на этой работе |
| HippoRAG | OSU-NLP-Group/HippoRAG | LightRAG переосмыслил идею, Cognee использует |
| Zep / Graphiti | getzep/graphiti | Сам Zep SaaS = коммерческая Graphiti |
| A-MEM | agiresearch/a-mem | Идея Zettelkasten-связности уже в Mem0 v2 |
| Mem0 | mem0ai/mem0 | Сам Mem0 SaaS — open-core |
| MemoryOS | BAI-LAB/MemoryOS | Используется в азиатских AI-стартапах |
| Titans | lucidrains/titans-pytorch (unofficial) | Пока только эксперименты |
| EM-LLM | em-llm/em-llm | Пока нет коммерческой реализации |
| Memory³ | проект-страница | Концепция, нет полного open-source |
| Larimar | IBM repo | В исследовательском режиме |
| RAPTOR | parthsarthi03/raptor | Используется в LlamaIndex |
| GraphRAG | microsoft/graphrag | Породил всю Graph-RAG волну |
| LightRAG | HKUDS/LightRAG | Один из топ-репо памяти 2025 |
| MemoRAG | qhjqhj00/MemoRAG | Активно развивается |
| AriGraph | AIRI-Institute/AriGraph | Российский институт; малоиспользуем |

### Что из «фреймворков ветки 6» — реальное переоформление академии vs. упаковка
- **Mem0** — реальная инженерия (своя ECAI 2025 работа), но архитектура близка к стандартному «vector + graph» паттерну.
- **Letta** — прямой потомок MemGPT, академический генезис.
- **Zep / Graphiti** — единственная коммерческая платформа, у которой собственная research-работа (bi-temporal KG, ICLR/workshop tier).
- **Cognee** — собственная исследовательская работа [2505.24478](https://arxiv.org/abs/2505.24478) про оптимизацию KG-LLM интерфейса. Реальный research-backend.
- **Supermemory, GibsonAI/memori, cipher** — больше упаковка, чем своя архитектура.

---

## 7.6. Чего academia ещё не решила

3 системных нерешённых проблемы (≥3 свежих работы по каждой подтверждают, что ни одна не закрыта).

### Q1. Надёжное обновление противоречивых фактов
- **Симптом:** факт изменился (роль человека, дата дедлайна), старая версия в памяти не аннулируется автоматически.
- **Состояние:** Graphiti / Larimar дают частичные ответы (bi-temporal, pseudo-inverse), но универсального решения нет. Свежие survey прямо это фиксируют как open problem.
- **Что это значит для Z:** нельзя слепо положиться на любую memory-библиотеку — потребуется собственная политика «версионирования фактов» поверх инструмента.

### Q2. Кросс-агентная и кросс-пользовательская память с privacy
- **Симптом:** как делить память между агентами / людьми, чтобы один не утёк к другому. Особенно остро для multi-tenant SaaS.
- **Состояние:** Collaborative Memory ([2505.18279](https://arxiv.org/abs/2505.18279)) и Memory-as-a-Service ([2506.22815](https://arxiv.org/abs/2506.22815)) — первые подходы, но без production-ready open-source.
- **Что это значит для Z:** под ФЗ-152 и корпоративную модель «свой мозг команды» нужен собственный слой access-control. Академия дала чертёж, инженерия — пока на нас.

### Q3. Атаки и безопасность памяти (memory poisoning)
- **Симптом:** злонамеренный участник встречи может «подложить» в долгую память агента ложный факт, который потом будет использоваться против организации.
- **Состояние:** свежий survey «Security of Long-Term Memory in LLM Agents» ([2604.16548](https://arxiv.org/abs/2604.16548)) — первая систематизация. Защитных механизмов в open-source почти нет.
- **Что это значит для Z:** про «второй мозг компании» это не отложишь — гость может ввести в речь ложную информацию. Нужна как минимум маркировка provenance каждого факта и фильтрация по уровню доверия источника.

---

## 7.7. Выводы для Z

### Внедрять уже сейчас (12 месяцев)
1. **Bi-temporal KG поверх встреч** — взять Graphiti (open-source, Apache 2.0). Связать с нашим episodic-слоем встреч. Решает большую часть «факты меняются со временем» — критично для корпоративного контекста. Прямая параллель к нашему требованию «темпоральность» из критериев раздела 2.
2. **Bayesian-surprise сегментация транскриптов** — взять идею EM-LLM, прототипировать поверх Vox/GigaAM. Не нужна как полный модуль — нужен только сегментатор для AI-отчёта.
3. **Reflection-based memory consolidation** — ночной job в духе Reflexion / ExpeL / RMM. Пересматриваем встречи дня, обновляем граф. Инженерно дёшево, эффект на качество отчётов большой.
4. **Mem0-style API-слой** для гостевых и хостовых сессий — самый простой production-ready путь для MVP, можно потом мигрировать на Graphiti.

### Наблюдать (12-24 месяца)
5. **Titans / TTL-память** — следить за реплицируемостью; если кто-то выложит проверенный pretrained-чекпойнт, переосмыслить long-context архитектуру встреч.
6. **Memory³ / Sparse Distributed Memory** — может изменить экономику inference. Следить за релизами от китайских и европейских лабораторий.
7. **A-MEM self-organizing approach** — если победит над фиксированными схемами, упростит наши 9 типов встреч.
8. **Predictive episodic memory** — «AI готовит к следующей встрече по прогнозу темы» — стратегическая фича, пока не готова к продакшену.

### Игнорировать в горизонте 2 лет
9. **Чисто in-model memory (MemoryLLM, M+)** — требует контроля над pretrained-моделью, что нам недоступно при работе через прокси / коммерческие API.
10. **Полностью neural-symbolic стек (SymAgent, CLAUSE)** — академический фронтир, ROI не очевиден для нашей ниши.

### Системные риски, которые надо закрыть инженерно
- Версионирование фактов (Q1).
- Multi-tenant access-control для shared memory (Q2).
- Provenance + защита от memory poisoning (Q3).

### Связь с другими ветками исследования
- Ветка 5 (GitHub): репозитории академических работ — кандидаты для прямого использования (Graphiti, EM-LLM, LightRAG).
- Ветка 6 (frameworks): только Zep и Cognee имеют собственный research-фундамент; остальные — инженерия поверх известных идей.
- Ветка 4 (новые стартапы): следить за стартапами, лицензирующими Titans / EM-LLM / A-MEM первыми.

---

_Заполнено: 2026-05-20, ветка 7. Следующий шаг — синтез с разделами 5-12 в разделе 13 (дельта к market-research-2026)._

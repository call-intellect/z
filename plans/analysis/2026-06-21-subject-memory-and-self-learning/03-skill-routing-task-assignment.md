---
type: analysis
status: research-input
feature: subject-memory-and-self-learning
date: 2026-06-21
snapshot_date: 2026-06-21
---

# Профиль навыков и авто-маршрутизация задачи без явного исполнителя

Как индустрия (а) строит «инвентарь навыков» сотрудника/должности и (б) сама понимает, кому отдать задачу, когда исполнитель не назван («заказать канцелярию» → офис-менеджер, «сделать дизайн» → дизайнер). Срез на 2026-06-21.

Статусы фактов: `[verified]` — прямой первоисточник; `[triangulated(N)]` — N независимых источников; `[claimed]` — утверждение вендора/блога; `[inferred]` — мой вывод из фактов.

---

## A. КАК СТРОЯТ ПРОФИЛЬ НАВЫКОВ (две стратегии: авто-вывод vs ручной)

### A1. Workday Skills Cloud — LLM-инференс навыков из текстовых «улик»
- `[verified]` Сервис Skill Inference принимает «skill evidence» — фразы естественного языка (должности, сертификаты, образование) и определяет, какие навыки они подразумевают. URL: https://medium.com/workday-engineering/skill-inference-building-an-llm-based-service-in-the-workday-skills-cloud-47c9cce9f7bd (2026-06-21 fetch)
- `[verified]` Пайплайн 3 шага: (1) NL-улики → промпт в LLM; (2) LLM генерит навыки в естественном языке; (3) пост-обработка + маппинг на Workday Skill Ontology + ранжирование по релевантности. URL: тот же.
- `[verified]` Модель — self-hosted LLM <13B параметров (сначала тестили off-the-shelf third-party LLM, потом перешли на свою). Файн-тюн через LoRA на внутренней платформе «Aviato». URL: тот же.
- `[verified]` Обучение на синтетически сгенерированном датасете, проверенном людьми-аннотаторами. URL: тот же.
- `[verified]` Латентность: <доли секунды с Redis-кэшем, несколько секунд без кэша (с >10с до долей секунды). Объём >1 млн запросов/день на регион. Вывод ограничен 20 навыками на инференс. URL: тот же.
- `[verified]` Фундамент Skills Cloud использует ML + graph-технологию: растущий список навыков + карта близости навыков друг к другу; пространственное представление навыков и документов даёт неявное обнаружение навыков у работников/кандидатов/контента БЕЗ явного ввода. URL: https://blog.workday.com/en-us/2020/foundation-workday-skills-cloud.html (2026-06-21)
- `[claimed]` Источники улик: position, job profile, work experience, learning transcripts, job descriptions, feedback. URL: https://www.suretysystems.com/insights/how-workday-skills-cloud-can-optimize-your-companys-skill-sets/ (2026-06-21)

### A2. Gloat — инференс из реальной работы + валидация микро-опросами
- `[claimed]` Инферит навыки из project assignments, code commits, document authorship, learning completions; шире — резюме, история проектов, сертификаты, паттерны коллаборации → автоматический профиль навыков. URL: https://gloat.com/platform/workforce-graph/ , https://gloat.com/blog/ai-enabled-skills-management/ (2026-06-21)
- `[claimed]` Точность инференса >90% для «demonstrated skills». URL: https://gloat.com/blog/ai-enabled-skills-management/
- `[claimed]` Для добора точности — таргетированные микро-опросы (сотруднику дают подтвердить 3-5 инферированных навыков) + промпты на эндорс от менеджера во время перформанс-чекинов. URL: тот же.
- `[claimed]` Тезис против самооценки: сотрудники недо-репортят навыки, которые считают само собой разумеющимися, и пере-репортят аспирационные навыки → инференс из реальных рабочих сигналов точнее самоотчёта. URL: тот же. `[inferred]` Прямая поддержка нашей гипотезы «строить субъект-память из активности, а не из анкеты».

### A3. Eightfold — deep-learning career graph
- `[claimed]` Нейросеть на >1.6 млрд career data points инферит навыки из записей о сотрудниках, карьерных историй, онлайн-профилей; сотрудник НЕ строит профиль вручную — AI генерит из существующих данных. URL: https://eightfold.ai/talent-intelligence-syntax/ , обзоры (2026-06-21)
- `[claimed]` Понимает «adjacency» навыков (математика → статистика/кибербез/ML) — то есть граф смежности навыков, не плоский список. URL: тот же.

### A4. Microsoft People Skills (Viva / M365 Copilot) — инференс из Graph-сигналов
- `[verified]` Inference engine использует поведенческие сигналы Microsoft Graph: документы, письма, чаты, встречи → персональный профиль навыков, маппится на кастомизируемую таксономию (база — LinkedIn Skills Taxonomy 16 000+ навыков). URL: https://techcommunity.microsoft.com/blog/microsoft365copilotblog/announcing-people-skills-general-availability-and-new-skills-agent/4406364 , https://learn.microsoft.com/en-us/viva/skills/skills-overview (2026-06-21)
- `[verified]` Два класса навыков с РАЗНЫМ статусом доверия: AI-inferred (на карточке серым) vs Confirmed пользователем (синим с галочкой). URL: https://learn.microsoft.com/en-us/copilot/microsoft-365/people-skills-sharing-inferencing-controls (2026-06-21) `[inferred]` Это прямой паттерн для нас: provenance-флаг «навык выведен AI» vs «подтверждён человеком».

### A5. Общий паттерн построения профиля
- `[triangulated(4)]` Все 4 enterprise-платформы (Workday/Gloat/Eightfold/Microsoft) строят профиль АВТО-ИНФЕРЕНСОМ из активности, а ручной ввод — лишь валидация/добор. Источники: A1-A4.
- `[triangulated(3)]` Навыки представлены не плоским списком, а графом смежности/онтологией (Workday graph, Eightfold adjacency, MS taxonomy 16k). Источники: A1, A3, A4.
- `[inferred]` Архитектура «event → LLM-extract навык → маппинг на онтологию → ранжирование» (Workday) изоморфна нашему knowledge-core пайплайну `ingest → IdeaBlock + Entity → graph`. Навык — это вид Entity, привязанный к Person/Role.

---

## B. КАК РОУТЯТ ЗАДАЧУ БЕЗ ЯВНОГО ИСПОЛНИТЕЛЯ (правила vs ML/embeddings)

### B1. ServiceNow Advanced Work Assignment — правила: skill + capacity + availability
- `[verified]` AWA авто-назначает рабочие айтемы на основе availability, capacity и (опционально) skillset; «agent best suited in that moment». URL: https://www.servicenow.com/docs/bundle/yokohama-servicenow-platform/page/product/skills-management/concept/skill-based-routing.html (2026-06-21)
- `[verified]` Процесс: work item создаётся → попадает в очередь по условиям → предлагается агентам группы с приоритетом тем, у кого совпали skills/capacity/availability. URL: https://www.servicenow.com/docs/bundle/xanadu-servicenow-platform/page/administer/advanced-work-assignment/concept/skills-routing-tutorial.html
- `[inferred]` Чистая rule-based маршрутизация: задача уже тегирована требуемым навыком (триггером), матч навыка детерминированный. Семантику «что за задача» определяет НЕ роутер.

### B2. Zendesk skills-based routing — правила, hard-match по навыкам
- `[verified]` Админ создаёт навыки и привязывает к агентам (несколько навыков на агента, из разных skill types). Для каждого навыка задаются ticket conditions, требующие этот навык. URL: https://support.zendesk.com/hc/en-us/articles/4408838892826 , https://support.zendesk.com/hc/en-us/articles/5833468891674 (2026-06-21)
- `[verified]` Агент считается матчем, только если у него ВСЕ требуемые навыки тикета. Required: тикет ждёт, если матча нет; Optional: уходит любому, но предпочтение совпавшим. URL: тот же.
- `[inferred]` Слабое место: тег навыка ставится правилами/триггерами по условиям тикета. Семантическое «о чём задача» решается отдельным шагом (auto-triage/classifier), не самим роутером.

### B3. Embedding-based assignment — семантика без правил (наш целевой подход)
- `[triangulated(2)]` Embedding-роутинг заменяет хардкод skill-keyword матчинга на cosine similarity между вектором экспертизы инженера и вектором задачи (заголовка тикета). URL: https://arxiv.org/pdf/2603.14997 (OrgForge), также упомянуто в обзорах semantic talent matching. (2026-06-21)
- `[claimed]` Композитный скор = cosine(expertise, task) + inverse stress + network centrality + prior history. Вектор экспертизы считается один раз и хранится; вектор задачи — на создании и кэшируется. Глобально-оптимальное назначение — венгерский алгоритм (Hungarian) для лучшего one-to-one матчинга с учётом capacity. URL: https://arxiv.org/pdf/2603.14997
- `[claimed]` Пример размерностей: эмбеддинги Qwn3-Embedding-4B (2560 dim), профиль инженера — вектор «at genesis», тикет — на создании. URL: тот же. `[inferred]` У нас аналог — text-embedding-3-small (1536 dim) + pgvector.
- `[verified]` Semantic job/talent matching: и профили, и описания задач маппятся в общее embedding-пространство, хранятся в vector index под ANN-поиск, ранжируются cosine similarity; несколько эмбеддингов на человека по аспектам (опыт/образование/навыки/языки) с весами дают лучший контроль similarity. URL: https://huggingface.co/blog/MCP-1st-Birthday/building-jobly-semantic-job-matching-with-rag-and , https://www.ingedata.ai/blog/2025/04/01/talent-matching-with-vector-embeddings/ (2026-06-21)
- `[verified]` Dev2vec: представление доменной экспертизы разработчика в embedding-пространстве (из issue/коммитов/обсуждений) — отдельная исследовательская линия «вектор человека из его работы». URL: https://arxiv.org/pdf/2207.05132 (2026-06-21)
- `[verified]` Академическая база semantic expertise retrieval: векторные представления слов и кандидатов-экспертов ловят близость концептов близостью в векторном пространстве. URL: https://arxiv.org/pdf/1608.06651 (2026-06-21)

### B4. Спектр подходов к маршрутизации
- `[inferred]` Три уровня зрелости: (1) rule-based hard-match (Zendesk/ServiceNow) — нужен явный тег навыка на задаче; (2) classifier+routing — LLM/ML классифицирует задачу в категорию, дальше rule-match (ServiceNow auto-triage, Zendesk standalone skills routing); (3) embedding semantic match — cosine задача↔человек без тегов/правил (OrgForge, Jobly, Dev2vec).
- `[inferred]` Для кейса «заказать канцелярию»/«сделать дизайн» нужен именно уровень 2-3: NL-фраза без явного навыка → определить требуемую способность → найти носителя.

---

## C. МАППИНГ НА СТЕК Z (Bun+Node+TS / Postgres+pgvector / DeepSeek+OpenAI-proxy / text-embedding-3-small)

### C1. Построение профиля навыков (под наш knowledge-core)
- `[inferred]` Навык = Entity типа `skill`, привязанный к Person и/или Role через EntityLink, с provenance-флагом source ∈ {ai_inferred, human_confirmed} (паттерн MS People Skills A4). Инферится LLM-экстрактором из событий (встречи/чаты/задачи/решения) — изоморфно Workday «evidence → LLM → ontology» (A1) и нашему `ingest → Entity → graph`.
- `[inferred]` Хранить эмбеддинг профиля навыков (агрегат активности человека/роли) в pgvector рядом с уже используемым text-embedding-3-small. Аспектные эмбеддинги (B3 Jobly) — опц. усложнение, на v1 один агрегатный вектор.
- `[inferred]` Маппинг на онтологию навыков (Workday/Eightfold/MS все так делают) у нас — нормализация в общий справочник Entity, иначе «дизайн» и «дизайнер» и «оформление» разойдутся.

### C2. Маршрутизация задачи без явного исполнителя — гибрид (рекомендация)
- `[inferred]` Шаг 1 (семантика): эмбеддинг текста задачи → pgvector cosine-поиск top-K кандидатов (Person/Role) по вектору профиля навыков. Это B3, дёшево, без LLM-вызова на каждую задачу.
- `[inferred]` Шаг 2 (арбитр): LLM (DeepSeek/OpenAI-proxy) ранжирует top-K с учётом контекста (загрузка, доступность, прошлая история) и возвращает исполнителя + confidence + объяснение. Это композитный скор OrgForge (B3) в LLM-форме; cache-friendly промпт (стабильный SYSTEM, кандидаты в конце user).
- `[inferred]` Порог уверенности → авто-назначение vs уточняющий вопрос владельцу (созвучно политике автономии из MEMORY: AUTO/HYBRID/NUDGE). Низкая уверенность = probe, не молчание.
- `[inferred]` Венгерский алгоритм (B3) — для батч-назначения нескольких задач разом без перегруза одного человека; на v1 (по одной задаче) избыточен.

### C3. Что НЕ тащить
- `[inferred]` Не делать чистый rule-based hard-match (B1/B2): требует ручного тегирования навыков на каждой задаче и явного справочника условий — это ровно то, от чего уходим (фраза без явного навыка). Правила — только как fallback/override.

---

## D. КОЛЛИЗИЯ: ПРОФИЛЬ НАВЫКОВ ПЕРСОНАЛЬНЫЙ (Маша/Олег) vs РОЛЕВОЙ (должность)

### D1. Что лучше для маршрутизации
- `[inferred]` Для МАРШРУТИЗАЦИИ нужен персональный уровень: задачу ставят конкретному человеку, и «офис-менеджер» может быть один — но если их двое (Маша и Олег), ролевой профиль не разрулит, кому именно. Embedding-матч (B3) по своей природе персональный (вектор человека из его активности).
- `[inferred]` Ролевой профиль лучше как (а) приор/бутстрэп для нового сотрудника (cold-start: пока нет личной активности — наследует профиль роли, ср. Workday «infer from job title» A1) и (б) грубый первый фильтр «канцелярия → роль офис-менеджер», внутри которой персональный матч выбирает человека.
- `[inferred]` Рекомендация для Z: ДВУХУРОВНЕВО. Role-профиль = приор и cold-start (совпадает с уже принятым в Z решением «клоны ролевые, не персональные», [[project_clones_are_role_based]]); Person-профиль = уточнение для выбора конкретного исполнителя при ≥2 носителях роли. Хранить оба как Entity-векторы; person наследует role при нехватке данных.

### D2. Приватность / ПДн при персональных скилл-профилях
- `[verified]` GDPR: инференс навыков из активности (письма/чаты/встречи) = профилирование (Art. 22), форма автоматизированного решения; consent в трудовых отношениях проблематичен из-за power imbalance (EDPB), обычная правовая база — legitimate interests / legal obligation. URL: https://www.osborneclarke.com/insights/profiling-and-automated-decision-making-under-gdpr , https://gdprlocal.com/gdpr-employee-monitoring/ (2026-06-21)
- `[verified]` 152-ФЗ ст. 16: решение, порождающее юр. последствия или иначе затрагивающее права субъекта, принятое ИСКЛЮЧИТЕЛЬНО на автоматизированной обработке — только с письменного согласия субъекта (или по федзакону); оператор обязан разъяснить порядок, дать возможность ВОЗРАЗИТЬ и рассмотреть возражение за 30 дней. URL: https://www.consultant.ru/document/cons_doc_LAW_61801/22e884a41450dcb5cb62d956583ad32abe2bbbe9/ (2026-06-21)
- `[inferred]` Авто-назначение задачи человеку «затрагивает права/интересы» → если решение ЧИСТО автоматическое, по 152-ФЗ нужен письменный consent ИЛИ человек-в-петле (владелец подтверждает). Гибрид C2 (LLM предлагает → владелец/порог подтверждает) снимает «исключительно автоматизированную обработку».
- `[verified]` Практика Microsoft People Skills как образец комплаенса: AI-инференс по умолчанию ON с opt-out для пользователя; видимость профиля управляема (soft/hard disable); для Workers Council / регионов (пример — Германия) есть полный hard-disable инференса по группам; при выключении — данные навыков пользователя УДАЛЯЮТСЯ. URL: https://learn.microsoft.com/en-us/copilot/microsoft-365/people-skills-sharing-inferencing-controls (2026-06-21)
- `[inferred]` Перенос на Z: (1) provenance ai_inferred vs human_confirmed (A4) — обязателен; (2) видимость персонального профиля навыков — крутилка (admin-setting), не хардкод; (3) право возражения/корректировки навыка субъектом; (4) РОЛЕВОЙ профиль безопаснее персонального с т.з. ПДн (не про конкретное лицо) — ещё аргумент держать role-профиль как основной слой, person — как наслоение с контролем видимости. Согласуется с зафиксированным в Z риском «single-incumbent роль = ПДн 152-ФЗ» ([[project_clone_depth_and_persona_method]]): если в роли один человек, ролевой профиль де-факто персональный.

---

## Источники (ключевые)
- Workday Engineering: Skill Inference LLM-сервис — https://medium.com/workday-engineering/skill-inference-building-an-llm-based-service-in-the-workday-skills-cloud-47c9cce9f7bd
- Workday: фундамент Skills Cloud (graph) — https://blog.workday.com/en-us/2020/foundation-workday-skills-cloud.html
- Gloat: Workforce Graph / AI skills management — https://gloat.com/platform/workforce-graph/ , https://gloat.com/blog/ai-enabled-skills-management/
- Eightfold: talent intelligence syntax — https://eightfold.ai/talent-intelligence-syntax/
- Microsoft People Skills GA — https://techcommunity.microsoft.com/blog/microsoft365copilotblog/announcing-people-skills-general-availability-and-new-skills-agent/4406364
- Microsoft People Skills privacy/inferencing controls — https://learn.microsoft.com/en-us/copilot/microsoft-365/people-skills-sharing-inferencing-controls
- ServiceNow AWA skill-based routing — https://www.servicenow.com/docs/bundle/yokohama-servicenow-platform/page/product/skills-management/concept/skill-based-routing.html
- Zendesk skills routing — https://support.zendesk.com/hc/en-us/articles/5833468891674 , https://support.zendesk.com/hc/en-us/articles/4408838892826
- OrgForge (embedding assignment + Hungarian) — https://arxiv.org/pdf/2603.14997
- Jobly semantic matching (RAG + vectors) — https://huggingface.co/blog/MCP-1st-Birthday/building-jobly-semantic-job-matching-with-rag-and
- ingedata talent matching vectors — https://www.ingedata.ai/blog/2025/04/01/talent-matching-with-vector-embeddings/
- Dev2vec (developer expertise embedding) — https://arxiv.org/pdf/2207.05132
- Semantic expertise retrieval — https://arxiv.org/pdf/1608.06651
- GDPR profiling (Osborne Clarke) — https://www.osborneclarke.com/insights/profiling-and-automated-decision-making-under-gdpr
- 152-ФЗ ст. 16 (КонсультантПлюс) — https://www.consultant.ru/document/cons_doc_LAW_61801/22e884a41450dcb5cb62d956583ad32abe2bbbe9/

# Ветка 1 — Концептуальный фундамент «второго мозга»

> Исследование подхода как класса, не как продукта. Часть параллельного исследования (см. [[second-brain-approach-research]]).
> Дата: 2026-05-20.
> Автор: исследовательский агент (Ветка 1).
> Согласовано с критериями (раздел 2) и терминами (раздел 3) базового документа.

---

## 1.1. История подхода

«Второй мозг» как идея — это длинная линия преемственности от аналоговых картотек до AI-памяти. Хронология ключевых вех:

**1945 — Vannevar Bush, эссе «As We May Think» (The Atlantic).**
Введён концепт **Memex** — гипотетического электромеханического устройства, в котором человек хранит «все свои книги, записи и коммуникации» и обращается к ним по ассоциативным «trails» (тропам). Bush сформулировал тезис, который остаётся центральным до сих пор: «человеческий разум работает по ассоциации, мгновенно перепрыгивая к следующему элементу по сложной сети троп». Эссе называют интеллектуальным фундаментом гипертекста, персональных компьютеров и Интернета ([Wikipedia: As We May Think](https://en.wikipedia.org/wiki/As_We_May_Think), [As We May Think — оригинал](https://www2.cs.sfu.ca/~cameron/Teaching/470/vbush.html), [History of Information](https://www.historyofinformation.com/detail.php?id=676)).

**1965 — Ted Nelson вводит термин «hypertext».**
Цитирует Memex Буша и развивает идею двунаправленных связей в проекте Xanadu — прямой предшественник bi-directional linking, которое 50 лет спустя коммерциализирует Roam Research ([RG: Bush & Nelson](https://www.researchgate.net/publication/375380187_Influential_Concepts_How_Vannevar_Bush%27s_Memex_and_Ted_Nelson%27s_Hypertext_Shaped_Information_Science_and_the_Internet)).

**1951 — Niklas Luhmann начинает свой Zettelkasten.**
Немецкий социолог за ~40 лет накапливает ~90 000 рукописных карточек в двух связанных боксах: библиографическом (только метаданные источников) и основном (только переработанные собственные мысли). На этой картотеке он напишет ~600 публикаций, включая ~60 книг. Главные принципы Луманна — атомарность (одна карточка = одна идея), уникальные идентификаторы, явные ссылки между карточками. Это первая полноценная архитектура «второго мозга» ([Grokipedia: Zettelkasten](https://grokipedia.com/page/Zettelkasten), [zettelkasten.de — introduction](https://zettelkasten.de/introduction/), [Luhmann original method](https://www.ernestchiang.com/en/posts/2025/niklas-luhmann-original-zettelkasten-method/)).

**2017 — Sönke Ahrens, «How to Take Smart Notes».**
Книга, превратившая «легенду о Лумане» в воспроизводимый метод. До неё Zettelkasten был фольклором; после — тираж ≈200 000 экземпляров, переводы на десятки языков, рост рынка PKM-софта. Ahrens описал три уровня заметок (fleeting → literature → permanent) и связал их с письменной работой ([fortelabs: Smart Notes](https://fortelabs.com/blog/how-to-take-smart-notes/), [Take Smart Notes — soenkeahrens.de](https://www.soenkeahrens.de/en/takesmartnotes), [Ahrens systematization](https://www.ernestchiang.com/en/posts/2025/sonke-ahrens-how-to-take-smart-notes/)).

**2019 — Roam Research (Conor White-Sullivan).**
Первая массовая реализация bi-directional linking поверх графовой БД: упоминание `[[X]]` на странице A автоматически создаёт обратную ссылку на странице X. Кодифицирована концепция «networked thought» — мышления через связи, а не через папки. Roam запустил волну: Obsidian (2020), Logseq (2020), RemNote, Tana ([Brief History of Roam](https://canvasbusinessmodel.com/blogs/brief-history/roam-brief-history), [Roam history — Medium](https://jimmylv.medium.com/part-%E2%85%B0-3-stories-about-roam-research-starting-with-the-project-xanadu-5575c96ad1d3), [Ness Labs: Roam](https://nesslabs.com/roam-research)).

**2020 — Maggie Appleton формализует Digital Gardens.**
Эссе «A Brief History & Ethos of the Digital Garden» закрепляет 6 принципов: топография (вместо хронологии), непрерывный рост, обучение в публичном пространстве (seedling → budding → evergreen), игривость и личность, разнообразие медиа, независимое владение доменом. Appleton ссылается на Mark Bernstein (1998, «Hypertext Gardens») и Mike Caulfield (2015, «streams vs gardens»). Digital garden — это «не блог», а вики, которая медленно растёт; интуитивно ближе всего к тому, как описывают «второй мозг» сегодня ([Brief History & Ethos](https://maggieappleton.com/garden-history), [Digital Gardening topic](https://maggieappleton.com/topics/digital-gardening/)).

**2020 (parallel) — Andy Matuschak публикует свои Evergreen Notes.**
Не книга, а публично доступная рабочая площадка `notes.andymatuschak.org`. Формулирует «evergreen notes» как фундаментальную единицу knowledge work и фиксирует принципы: атомарность, концептоориентированность, плотные связи, ассоциативные онтологии (вместо иерархических таксономий), писать «для себя, игнорируя аудиторию». Главный тезис: «better note-taking misses the point; what matters is better thinking» ([notes.andymatuschak.org — Evergreen notes](https://notes.andymatuschak.org/Evergreen_notes), [Evergreen note-writing as fundamental unit](https://notes.andymatuschak.org/Evergreen_note-writing_as_fundamental_unit_of_knowledge_work)).

**2022 — Tiago Forte, «Building a Second Brain».**
Книга-бестселлер, кодифицировавшая термин «Second Brain» как массовый бренд. Два каркаса:
- **CODE** — четырёхшаговый цикл: Capture → Organize → Distill → Express.
- **PARA** — иерархия папок: Projects → Areas → Resources → Archives, по «горизонту действия».

Forte начинал как консультант и заболел хроническим заболеванием, что и привело к разработке системы для управления медицинскими записями и работой одновременно ([buildingasecondbrain.com](https://www.buildingasecondbrain.com/), [BASB overview — Forte Labs](https://fortelabs.com/blog/basboverview/), [PARA Method — buildingasecondbrain.com](https://www.buildingasecondbrain.com/para)).

**2023 — Sumers et al., «Cognitive Architectures for Language Agents» (CoALA).**
Princeton-paper, который перенёс таксономию памяти из когнитивной науки (SOAR, ACT-R) в архитектуру LLM-агентов. Каноническое разделение: working memory + long-term memory, где long-term делится на episodic / semantic / procedural. С этой работы началась «эпоха AI-вторых мозгов» — теперь «второй мозг» это не папка с заметками, а memory substrate для агента ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427), [CoALA explained — Cognee](https://www.cognee.ai/blog/fundamentals/cognitive-architectures-for-language-agents-explained), [awesome-language-agents](https://github.com/ysymyth/awesome-language-agents)).

**2023 — MemGPT (Packer et al., UC Berkeley).**
Первая работа, переосмыслившая управление контекстом LLM как «операционную систему»: in-context memory (как RAM — оперативная память) + out-of-context memory (как диск), paging между ними через tool calls. В 2024 проект превратился в коммерческий Letta ([arXiv 2310.08560](https://arxiv.org/abs/2310.08560), [Letta docs — MemGPT](https://docs.letta.com/letta-memgpt), [LLMs as OS — Leonie Monigatti](https://www.leoniemonigatti.com/papers/memgpt.html)).

**2025 — Mem0 paper (ECAI 2025) и Zep / Graphiti.**
Mem0 ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) — scalable memory-centric архитектура: вместо хранения сырых сообщений LLM динамически экстрагирует, консолидирует и обновляет «salient information». Заявленный результат: −91% p95 latency, −90% токенов по сравнению с full-context подходом ([Mem0 paper page](https://huggingface.co/papers/2504.19413)).

Zep ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) — темпоральный граф знаний Graphiti с bitemporal моделью: для каждого факта хранится и event time (когда произошло), и ingestion time (когда узнали). На DMR-бенчмарке: Zep 94.8% vs MemGPT 93.4% ([Zep paper](https://arxiv.org/html/2501.13956v1), [getzep/graphiti — GitHub](https://github.com/getzep/graphiti)).

**Конец 2025 — Andrej Karpathy, «LLM Wiki» gist.**
Минималистичный паттерн на 5 000 ⭐ за дни: три слоя — `/raw` (исходники, immutable), `/wiki` (LLM-генерируемые синтезированные страницы 500 слов), `CLAUDE.md`-схема (правила игры для агента). Три операции: ingest, query, lint. Главная мысль: «tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping... LLMs don't get bored, don't forget to update a cross-reference». Karpathy дал имя паттерну, который индустрия уже строила, но фрагментарно ([karpathy/llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), [Karpathy LLM Wiki — askglitch breakdown](https://www.askglitch.com/blog/build-a-second-brain), [innobu enterprise reality check](https://www.innobu.com/en/articles/karpathy-llm-wiki-second-brain-enterprise-reality.html)).

**Декабрь 2025 — survey «Memory in the Age of AI Agents».**
Большая обзорная работа, фиксирующая раздробленность области: ~10+ конкурирующих таксономий памяти, отсутствие единого бенчмарка ([arxiv-list репо](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)). К 2026 году «второй мозг» уже скорее не методология заметок, а способ организации памяти для агента.

---

## 1.2. Ключевые мыслители

Кто что внёс в каноничный каркас. Ниже — пять мыслителей, на которых ссылается ≥80% современных публикаций по теме.

### Niklas Luhmann (1927–1998)
- **Внёс:** концепцию атомных карточек с уникальными идентификаторами и явными перекрёстными ссылками. Разделил «библиографический слой» (метаданные) и «основной слой» (свои переработанные мысли) — буквальный прообраз `/raw` vs `/wiki` у Karpathy.
- **Главное правило:** «в главный бокс попадает только то, что я переформулировал своими словами» ([Luhmann original method](https://www.ernestchiang.com/en/posts/2025/niklas-luhmann-original-zettelkasten-method/)).
- **Аргумент в нашу пользу:** Луман доказал, что **distill — это не косметика, а двигатель продуктивности**. 90 000 карточек дали 600 публикаций — это коэффициент конверсии знаний.

### Tiago Forte (Forte Labs)
- **Внёс:** массовый бренд «Second Brain», фреймворки CODE и PARA, методику Progressive Summarization (4 уровня выделения важного в заметке).
- **Главное правило:** «organize for actionability, not for retrieval» — PARA сортирует не по теме, а по горизонту действия (активные проекты vs архив) ([PARA Method](https://www.buildingasecondbrain.com/para)).
- **Аргумент:** Forte популяризировал, но многие критикуют его за «слишком процессно-консультантский» подход; для AI-эпохи методология слишком ручная.

### Andy Matuschak
- **Внёс:** концепцию evergreen notes как живых сущностей и фиксацию принципов: атомарность, концептоориентированность, плотные связи, ассоциативные онтологии, аутентичность ([Evergreen notes](https://notes.andymatuschak.org/Evergreen_notes)).
- **Главное правило:** «better note-taking misses the point; what matters is better thinking». Заметки — побочный продукт мышления, не цель.
- **Аргумент:** Matuschak задал стандарт качества для distilled слоя — он не должен быть саммари, он должен быть **новой смысловой единицей**.

### Andrej Karpathy
- **Внёс:** перевёл подход в AI-эпоху одним постом-spec. Жёсткая трёхуровневая архитектура (`/raw` + `/wiki` + schema-файл), три операции (ingest / query / lint), идея «LLM как disciplined wiki maintainer» ([Karpathy gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)).
- **Главное правило:** «LLMs are much better at reasoning over a well-structured 500-word wiki page than over a raw 8 000-word transcript» — синтез не как сжатие, а как **трансляция в формат, который модель умеет читать**.
- **Аргумент:** Karpathy дал индустрии общий язык. До его gist каждая команда придумывала свою архитектуру; теперь есть baseline для сравнения.

### Maggie Appleton
- **Внёс:** этос «обучения в публичном пространстве» (learning in public) и формализацию growth stages (🌱 seedling → 🌿 budding → 🌳 evergreen). Подчеркнула, что **процесс важнее финального артефакта** ([garden-history](https://maggieappleton.com/garden-history)).
- **Главное правило:** «несовершенство и итерация — фича, не баг»; статус заметки важнее её содержания.
- **Аргумент:** Appleton ближе всех к идее «второго мозга компании», который не должен быть отполированной wiki — он должен расти.

### Conor White-Sullivan (Roam Research)
- **Внёс:** двунаправленные ссылки в массовый продукт, концепцию «networked thought». Цитата: «collaborate with your past and future selves» ([Crema interview](https://www.crema.us/people-of-product/62)).
- **Аргумент:** доказал, что граф связей — это коммерчески жизнеспособный UI-паттерн, а не академическая прихоть.

### Бонусом — Charles Packer + Joseph Gonzalez (MemGPT/Letta) и Daniel Chalef (Zep)
- Они не «мыслители» в классическом смысле, но именно их работы 2023–2025 перевели «второй мозг» из методологии в инфраструктурный слой ([MemGPT arXiv](https://arxiv.org/abs/2310.08560), [Zep arXiv](https://arxiv.org/abs/2501.13956)). Без них раздел 1.4 не имел бы смысла.

---

## 1.3. Сравнение со смежными концепциями

| Концепция | Что это | Чем «второй мозг» отличается |
|---|---|---|
| **PKM** (Personal Knowledge Management) | Методология ведения личных заметок и связей вручную. Bottom-up подход: индивид сам коллекционирует, классифицирует, связывает ([Wikipedia: PKM](https://en.wikipedia.org/wiki/Personal_knowledge_management), [Glasp: PKM guide](https://glasp.co/articles/personal-knowledge-management)). | «Второй мозг» — **надстройка над PKM**: добавляет автоматический capture (встречи, чаты, голос), distill через LLM, surfacing вместо search. PKM ручной — «второй мозг» полу-автоматический. |
| **KMS** (Knowledge Management System) | Корпоративная база знаний, top-down: Confluence, SharePoint, TEAMLY. Фокус — единый источник правды + compliance ([dsebastien: PKM vs KMS](https://www.dsebastien.net/why-is-personal-knowledge-management-pkm-useful/)). | KMS — статичная wiki + поиск; «второй мозг» — **динамическая память с переработкой**. KMS обслуживает «найди документ»; «второй мозг» — «расскажи, что произошло на встречах с клиентом X в этом квартале». |
| **RAG** (Retrieval-Augmented Generation) | Паттерн: индексировать корпус → искать релевантные чанки → подмешивать в промпт. Без synthesis, без temporal awareness ([Karpathy gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)). | RAG отвечает на запрос «по сырому корпусу»; «второй мозг» строит **distilled слой**, на котором LLM думает гораздо точнее. Karpathy явно противопоставляет: «синтез — не сжатие, это трансляция в формат, который модель умеет читать». |
| **Digital twin** (личный AI-клон) | AI-агент, обученный имитировать конкретного человека и **действовать от его имени**. Sensay, Viven — корпоративные клоны сотрудников ([Inc: Viven](https://www.inc.com/ben-sherry/viven-says-ai-clones-of-your-employees-will-boost-productivity-heres-how/91253251), [Cointelegraph: digital twin](https://cointelegraph.com/magazine/your-ai-digital-twin-can-take-meetings-and-comfort-your-loved-ones/)). | Digital twin **действует**; «второй мозг» **помнит и подсказывает**. Twin живёт автономно, второй мозг — компаньон пользователя/команды. Этически это две разные категории (twin = вопросы о согласии, persona rights, эксплуатации). |
| **Zettelkasten** | Метод атомных карточек Луманна: 1 идея = 1 карточка, ID + ссылки, два бокса (библиография + мышление) ([zettelkasten.de](https://zettelkasten.de/introduction/)). | Zettelkasten — это **техника ручного письма** для одного человека. «Второй мозг» — продуктовая категория с автокаптурой, AI-синтезом и многопользовательским режимом. Zettelkasten — внутри второго мозга как один из принципов. |
| **Digital garden** | Публичная медленно растущая wiki с маркерами зрелости (seedling/budding/evergreen). Топография вместо хронологии ([Appleton garden-history](https://maggieappleton.com/garden-history)). | Digital garden — это **формат публикации**, а не система памяти. «Второй мозг» включает приватный слой, atribution, security/compliance; digital garden — изначально публичен и личен. |
| **In-app copilot** (Notion AI, Slack AI) | AI внутри одного приложения, ограниченный его данными. | Copilot не делает **cross-app capture** — критерий №1 раздела 2. «Второй мозг» по определению многоканальный. |
| **Enterprise search** (Glean базовый) | Корпоративный поиск с генеративным ответом поверх индекса. | Не делает temporal awareness и распиленный слой. Glean Pro с workflows подбирается к «второму мозгу», но базовый Glean — это enhanced search, не память. |

**Ключевая ось различения** (по моему чтению): «второй мозг» = это любая система, у которой одновременно есть (а) **слойная переработка** raw → distilled и (б) **темпоральность фактов**. Без (а) — это RAG. Без (б) — это wiki/KMS. Без обоих — это поиск.

---

## 1.4. Архитектурные принципы — перенос из ручного PKM в AI-эпоху

Шесть принципов, унаследованных из аналоговой эры и переосмысленных в AI-стеке. Это карта «что осталось, что мутировало».

### 1. Многоканальный capture

**Ручная эра:** человек сам решает, что записать (Forte CODE: первый шаг = Capture).
**AI-эра:** система ловит сама — встречи (Granola, Otter, Z), чаты (Slack/Telegram-боты), почта, экран (Rewind), голос, документы. Главный качественный скачок: **capture стал пассивным**.
**Принцип, который перешёл без изменений:** «лови всё, фильтруй позже». Forte цитировал David Allen («Getting Things Done») — «if you have to remember it, you'll forget it». Это правило живо ([BASB overview](https://fortelabs.com/blog/basboverview/)).
**Связь со Z:** AI-встречи Z — это сильный canale capture; нам нужно лишь добавить дополнительные источники (минимум: чаты, документы) для соответствия критерию 1.

### 2. Слойная переработка (raw → distilled)

**Ручная эра:** Луман делил две картотеки; Ahrens — fleeting → literature → permanent; Forte — Progressive Summarization (4 уровня выделения).
**AI-эра:** Karpathy формализовал как `/raw` (immutable) + `/wiki` (LLM-generated 500-word pages). Mem0 в paper делает то же на уровне фактов: extract → consolidate → update.
**Что мутировало:** **distill стал автоматическим**, но качество синтеза = главный конкурентный фронт. Плохой distill = плохой второй мозг, даже на хорошем сыром материале.
**Связь со Z:** AI-отчёт по типу встречи — это уже частный случай distill. Шаг наверх — distill **между встречами** в долгоживущие сущности (клиент, проект, решение, договорённость).

### 3. Связи как граф

**Ручная эра:** Луман писал ID на каждой карточке и явные ссылки; Roam в 2019 добавил bi-directional links автоматически ([Brief History of Roam](https://canvasbusinessmodel.com/blogs/brief-history/roam-brief-history)).
**AI-эра:** ассоциативные связи (вектора) + явные связи (графы знаний) + темпоральные графы (Zep/Graphiti). Чистый вектор хорош для «похожего», граф нужен для «структурного» — кто кому подчиняется, какое решение чему предшествовало.
**Что мутировало:** появилась **bitemporal модель** (Zep): «факт X был верен с T1 по T2, узнали в T3». Это невозможно сделать руками.
**Связь со Z:** для корпоративного второго мозга граф клиентов / проектов / решений нужен **в первую очередь**, не вектор. Вектор — только когда есть достаточный объём текста (после нескольких десятков встреч).

### 4. Surfacing вместо search

**Ручная эра:** Forte писал об этом как о «creative reuse» — система сама напоминает о старых заметках, релевантных текущей задаче. Реализовывалось вручную через папки PARA.
**AI-эра:** агент сам подсовывает релевантное при работе. Granola показывает «прошлые встречи с этим клиентом» перед звонком; Slack AI — «вот тред, на который ссылается этот вопрос». Surfacing — **главное UX-отличие** от старых wiki.
**Что мутировало:** появилось proactive notification, основанное на контексте (календарь, текущий документ, тред).
**Связь со Z:** до сих пор у Z только pull (открой запись/отчёт). Push (за 5 минут до встречи показать резюме всех прошлых разговоров с этим участником) — критичный шаг к «второму мозгу».

### 5. Темпоральность

**Ручная эра:** карточка Лумана не знала, что её содержимое устарело. Версионирование = переписывание.
**AI-эра:** Zep ввёл bitemporal модель явно ([Zep paper](https://arxiv.org/html/2501.13956v1)). Mem0 делает «consolidation/update» как первоклассную операцию. Без темпоральности система выдаёт устаревшие факты как актуальные — главная боль RAG-чатботов.
**Что мутировало:** факты получили жизненный цикл (валидно с / до / источник изменения).
**Связь со Z:** для «второго мозга компании» это жизненно. Клиент сменил роль, проект закрылся, договорённость отменена на следующей встрече — без темпоральности AI начнёт галлюцинировать историю.

### 6. Память агента (episodic / semantic / procedural)

**Ручная эра:** этого слоя просто не было — карточки Лумана не были «памятью агента», они были его рабочей средой.
**AI-эра:** CoALA (Sumers et al., 2023) ввёл каноническую таксономию ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427)):
- **Episodic** — конкретные эпизоды («на встрече 15.04 решили запустить пилот»).
- **Semantic** — обобщённые факты («клиент любит короткие саммари по утрам»).
- **Procedural** — выученные паттерны («после встречи типа discovery всегда отправляй follow-up в течение 24h»).
- **Working** — контекст текущей сессии.

[Atlan: types of AI agent memory](https://atlan.com/know/types-of-ai-agent-memory/) даёт хороший обзор по каждому типу; [Analytics Vidhya: memory systems in AI agents](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/) — практическое сравнение реализаций.
**Что нового:** это **разлом эпох**. До CoALA «второй мозг» был UI-категорией. После — API-категорией: память отдаётся агенту, не человеку.
**Связь со Z:** если Z хочет быть «вторым мозгом», нужно отдавать память **через API агентам клиента** — не только показывать в UI. Это и есть критерий №6 базового документа.

---

## 1.5. Топ-10 обязательных источников

Список ранжирован по принципу: «если читать только это — будет понятно 80% области».

1. **Karpathy A. «LLM Wiki» (gist, 2025)** — [gist.github.com/karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
   Минимально достаточная архитектура «второго мозга» AI-эпохи на 1 страницу. Если бы можно было прочитать только один источник — этот. Задаёт общий язык для всего рынка.

2. **Sumers T. R. et al. «Cognitive Architectures for Language Agents» (arXiv 2309.02427, 2023)** — [arxiv.org/abs/2309.02427](https://arxiv.org/abs/2309.02427).
   Каноническая таксономия памяти агентов: working + episodic + semantic + procedural. Перевод когнитивной науки (SOAR, ACT-R) в LLM-архитектуру. Цитируется ~везде.

3. **Forte T. «Building a Second Brain» (книга, 2022)** — [buildingasecondbrain.com](https://www.buildingasecondbrain.com/), [PARA Method](https://www.buildingasecondbrain.com/para).
   Массовый бренд категории. Фреймворки CODE и PARA. Читать как фольклор / культурный контекст: на эту книгу опираются все клиенты, у которых «уже есть свой второй мозг».

4. **Matuschak A. «Evergreen notes» (живая публикация, 2020–наст.вр.)** — [notes.andymatuschak.org/Evergreen_notes](https://notes.andymatuschak.org/Evergreen_notes).
   Эталон качества distilled слоя. Принципы атомарности, концептоориентированности, плотных связей. Главный тезис: «лучше думать, а не лучше записывать». Читать как стандарт, к которому стоит стремиться при синтезе.

5. **Appleton M. «A Brief History & Ethos of the Digital Garden» (2020)** — [maggieappleton.com/garden-history](https://maggieappleton.com/garden-history).
   Манифест Digital Gardens, 6 принципов. Показывает, почему «второй мозг» — это не отполированная wiki, а живой растущий организм. Важно для UX-мышления.

6. **Rasmussen P., Chalef D. «Zep: A Temporal Knowledge Graph Architecture for Agent Memory» (arXiv 2501.13956, 2025)** — [arxiv.org/abs/2501.13956](https://arxiv.org/abs/2501.13956).
   Bitemporal модель: event time + ingestion time для каждого факта. Лучший существующий ответ на вопрос «как помнить, что факт устарел». На DMR-бенчмарке: 94.8% vs MemGPT 93.4%.

7. **Mem0 paper «Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory» (arXiv 2504.19413, ECAI 2025)** — [arxiv.org/abs/2504.19413](https://arxiv.org/abs/2504.19413).
   Первый широкий head-to-head бенчмарк ([LoCoMo](https://mem0.ai/blog/state-of-ai-agent-memory-2026)) 10 подходов к памяти: RAG, full-context, OpenAI Memory, Zep и др. Показывает реальную цену вопроса: −91% latency, −90% токенов при extract/consolidate подходе.

8. **Packer C. et al. «MemGPT: Towards LLMs as Operating Systems» (arXiv 2310.08560, 2023)** — [arxiv.org/abs/2310.08560](https://arxiv.org/abs/2310.08560).
   Paging-модель памяти: in-context (RAM) + out-of-context (диск), управляющий LLM сам перекладывает данные через tool calls. Базовая идея «второго мозга как OS», важна для интуиции архитектора.

9. **Ahrens S. «How to Take Smart Notes» (книга, 2017)** — [soenkeahrens.de/takesmartnotes](https://www.soenkeahrens.de/en/takesmartnotes), [Forte Labs обзор](https://fortelabs.com/blog/how-to-take-smart-notes/).
   Книга, систематизировавшая Zettelkasten и запустившая массовый PKM-рынок. Три уровня заметок (fleeting → literature → permanent). Объясняет, почему distill — главный bottleneck.

10. **Bush V. «As We May Think» (The Atlantic, 1945)** — [As We May Think — оригинал](https://www2.cs.sfu.ca/~cameron/Teaching/470/vbush.html), [Wikipedia](https://en.wikipedia.org/wiki/As_We_May_Think).
    Истоки концепции Memex. Цитата «человеческий разум работает по ассоциации» — фундамент всего, что мы делаем. Читать для исторической перспективы и для того, чтобы видеть, что 80 лет идея почти не сдвинулась.

**Дополнительно (если осталось время):**

- Survey «Memory in the Age of AI Agents» — arXiv-list [Shichun-Liu/Agent-Memory-Paper-List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List), декабрь 2025. Карта фрагментации области.
- Atlan «Best AI Agent Memory Frameworks 2026» — [atlan.com](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/). Прикладной обзор для практиков.
- Atlan «Types of AI Agent Memory» — [atlan.com](https://atlan.com/know/types-of-ai-agent-memory/). Лучший популярный гайд по episodic/semantic/procedural.
- Latent Space podcast — [latent.space/podcast](https://www.latent.space/podcast). Эпизоды 2025 по «memory as the real bottleneck» и «memory, world models, next frontier of intelligence».
- No Priors podcast (Sarah Guo & Elad Gil) — [linktr.ee/nopriors](https://linktr.ee/nopriors). Эпизод с Eric Zelikman (ex-Stanford/xAI) о long-term memory.
- Lenny's и Creator Science podcast эпизоды с Forte — [podcast.creatorscience.com/tiago-forte](https://podcast.creatorscience.com/tiago-forte/), [ClearerThinking podcast](https://podcast.clearerthinking.org/episode/144/tiago-forte-how-to-build-your-second-brain/).
- Trilogy AI «From Karpathy's Second Brain to Entropy» — [trilogyai.substack.com](https://trilogyai.substack.com/p/from-karpathys-second-brain-to-entropy). Хороший пример того, как индустрия переинтерпретирует Karpathy в архитектуру.

---

## 1.6. Выводы для Z

### Что из подхода уже есть в Z

Z по факту покрывает **2 из 6 критериев** базового документа (раздел 2):

- **Критерий 2 (слойная переработка)** — частично: AI-отчёт по типу встречи это `raw transcript → distilled summary`. Это уже не RAG-search, а синтез. Хороший фундамент.
- **Критерий 3 (связи между сущностями)** — частично: записи привязаны к организации, типу встречи, участникам, ведущему. Это базовая графовая модель, но без явных связей «решение → следующая встреча → итог».

Остальные 4 критерия (многоканальный capture, surfacing, темпоральность, память агента через API) **не покрыты**. Z сейчас — это «AI-видеовстречи с типизированным саммари», а не «второй мозг».

### Что можно добавить, чтобы перейти в категорию «второй мозг»

В порядке прироста ценности для клиента и затрат для нас:

1. **Cross-meeting memory** (квартальная цель). Связать встречи между собой по сущностям: один клиент, один проект, одно решение. Технически — добавить layer над AI-отчётами, где LLM выделяет именованные сущности и связывает встречи. Это **минимально необходимый шаг для соответствия критерию 3 в полной мере**. Реализация — через extraction-pipeline по образцу Mem0.
2. **Surfacing перед встречей** (квартальная цель). За 5 минут до встречи генерировать карточку: «вот всё, что обсуждали с этими участниками за последние 90 дней, вот открытые решения, вот невыполненные договорённости». Это критерий 4 и одновременно самая высокая воспринимаемая ценность для клиента.
3. **Темпоральные факты** (полугодовая цель). Каждое извлечённое из встречи утверждение получает event time + источник. Если на следующей встрече клиент сказал обратное — старый факт помечается как superseded, не удаляется. Это критерий 5; без него мы будем галлюцинировать историю при росте корпуса встреч.
4. **Capture за пределы встреч** (полугодовая цель). Минимум: загрузка документов в контекст команды, чтобы AI мог опираться на них в отчётах. Без этого мы не покрываем критерий 1 (multi-channel capture).
5. **Memory API для агентов клиента** (годовая цель). Отдавать память через REST/SSE-API наружу — чтобы клиент мог встроить «знание Z» в свой AI-ассистент. Это критерий 6 и наша **главная защита от вытеснения** Granola/Otter, когда они дорастут до memory-слоя.

### Какие принципы критичны при расширении

- **Двухслойная архитектура (raw + distilled) — обязательна с первого дня**. Karpathy прав: LLM работает лучше по distilled слою. Если расширяться, нельзя «затащить ещё больше сырого материала в RAG» — это путь Glean базового, который проиграл.
- **Distill — это не саммари**. Matuschak настаивал: атомарные концепт-страницы, а не пересказ. Для Z это значит: единица distill — не «отчёт о встрече», а «решение / договорённость / открытый вопрос / актор».
- **Темпоральность вводить раньше, чем кажется нужным**. Zep paper показывает: после 50–100 встреч на одного клиента противоречий между фактами становится столько, что без bitemporal модели AI становится бесполезным.
- **Surfacing — это UX-обещание, без которого «второй мозг» неотличим от wiki в восприятии клиента**. Маркетинг будет проигрывать, пока мы не показываем relevance проактивно.
- **PARA Forte хороша как ментальная модель для клиента**, но плоха как структура хранения для AI. Не закладывать жёсткую иерархию папок — она ломается под graph-моделью.

Если Z двинется в эту сторону, мы окажемся **не на конкурентном поле AI-встреч (Granola, Otter, Fireflies)**, а на стыке «AI-встречи × AI-память компании». На том поле в РФ практически пусто (раздел 7 базового документа это подтвердит), а на INT-рынке — там, где смогли подняться Glean ($7B), Dust, Decagon ($1B+). Это **существенно более крупный рынок и более защищённое позиционирование**.

---

_Готово. Ветка 1 закрыта. Следующий шаг — синтез веток 1–8 в раздел 13–14 базового документа._

---
type: analysis
status: research-input
feature: subject-memory-and-self-learning
date: 2026-06-21
snapshot_date: 2026-06-21
---

# Зарубежные продукты «корпоративной AI-памяти»: как они формируют и подставляют «контекст компании»

Срез данных (snapshot_date): 2026-06-21. Контекст нашего продукта: «память компании» (RU), стек Bun+Node+TypeScript / NestJS, Postgres+pgvector, LLM DeepSeek/OpenAI-proxy.

Статусы фактов: [verified] — прямая формулировка в первоисточнике (вендор/докдока); [triangulated(N)] — подтверждено N независимыми источниками; [claimed] — маркетинговое утверждение вендора без раскрытия механики; [inferred] — вывод/реконструкция (стек только из косвенных данных).

---

## Главный вывод сразу (для нашего решения)

- **Ни один из 8 разобранных продуктов НЕ держит «описание компании» как авторскую статическую строку в системном промпте как основной механизм.** Доминирующий паттерн — **grounding/RAG в момент запроса**: контекст компании собирается на лету из проиндексированного корпуса (документы, чаты, встречи, графы связей), а не пишется человеком один раз. [triangulated(5): Glean, Dust, Notion, M365 Copilot, Sana]
- **Авто-сгенерированное «описание компании» (миссия/рынок/продукты) как отдельная сущность встречается НЕ у memory-платформ, а у генераторов профилей** (iWeaver, PerfectAssistant, Easy-Peasy) — это разовая генерация маркетингового текста из сайта/PDF, не живой контекст ассистента. [triangulated(3)]
- **Самое близкое к «авто-профилю организации, который кормит ассистента» — Glean Enterprise Graph + Google Knowledge Catalog/Knowledge Engine**: они автоматически строят граф сущностей бизнеса и «context graph всего бизнеса», но это структура связей, а не текстовый параграф «чем мы занимаемся». [triangulated(2)]
- **Что перенять для Коры:** (1) auto-summary организации как кэшируемый дериват графа (а не ручное поле), пересчитываемый по расписанию; (2) подстановка в промпт = короткий стабильный «org-capsule» (cache-friendly SYSTEM) + RAG-доказательства в конце user; (3) доверие через verification/citation как у Guru/Notion.

---

## 1. Glean — Work AI / Enterprise Graph

**Функциональный разрез (простым языком):** сотрудник спрашивает ассистента на естественном языке, Glean ищет по всем рабочим инструментам (документы, переписки, веб) и отвечает «как человек, который понимает, как устроена компания». Понимание строится из графа: кто с кем работает, какие проекты, клиенты, какие документы популярны. [verified] (glean.com/, glean.com/product/assistant)

**Технический разрез:**
- **Enterprise Graph** = слой интеллекта, строит динамическое понимание «как происходит работа»: связи людей, контента, рабочих процессов, приложений. Плюс **personal graph** на каждого сотрудника (его задачи, отношения, паттерны работы). [verified] (glean.com/press/...third-generation-ai-assistant)
- **Граф строится АВТОМАТИЧЕСКИ, не вручную**: «automated noun extraction» алгоритмами по всему корпусу → статистическая фильтрация шума → «elevation» сущностей по сигналам (заголовки документов, кросс-линковка, популярность файла) → «selective property extraction and predicate identification» для связей с надёжными повторяемыми доказательствами. [verified] (glean.com/blog/knowledge-graph-agentic-engine)
- **Обновление — непрерывное**: «real-time crawler architecture... continuously ingesting enterprise content and metadata»; personal graph ловит «chronological activity streams». [verified] (тот же URL)
- **Подстановка контекста в ассистента = grounded retrieval (RAG) + граф**, «hybrid search architecture» (keyword + semantic + graph centrality). НЕ полагается на знания LLM. Явного «company description string» в системном промпте источник НЕ описывает. [verified что hybrid+grounding; inferred что нет статической company-string]
- Метрика бизнеса (контекст зрелости, не механика): ARR $200M, рост ×2. [claimed] (futurumgroup.com)

**Маппинг на наш стек:** граф у нас уже есть (knowledge-core: IdeaBlock+Entity+Link+Theme). Glean подтверждает наш путь «авто-граф из событий». Их «elevation сущностей по популярности/заголовкам/кросс-линковке» — это готовый рецепт для нашего ранжирования сущностей при сборке org-summary. Их personal graph ≈ наш Person/subject-слой.

---

## 2. Dust.tt — AI-агенты, которые «знают компанию» (Париж)

**Функциональный разрез:** команда без кода создаёт агентов, подключает Notion/Slack/GitHub/Drive «за минуты», агенты «знают то, что знает команда». Инструкции агенту пишутся обычным языком («проанализируй фидбек за квартал…»). [verified] (dust.tt/home/product, docs.dust.tt/welcome)

**Технический разрез — здесь явно видно разделение «статика vs RAG»:**
- **Static prompt (agent instructions)** — фундамент поведения агента, постоянная часть. [verified] (docs.dust.tt RAG-guide)
- **Connected data sources** — Drive/Notion/Confluence и т.д.; синхронизируются с платформами. [verified]
- **Два метода получения контекста:**
  - **Search (RAG):** семантический поиск по смыслу, достаёт документы «most likely to contain the info». [verified]
  - **Include Data:** тянет свежие документы в обратном хронопорядке, пока не заполнит контекстное окно модели. [verified]
- **Числа:** Extract Data обрабатывает «up to 500k tokens (≈1000 страниц)»; размеры чанков в доке не раскрыты. [verified] (docs.dust.tt)
- **Авто-описания компании НЕТ** — «context appears purely retrieved at query time»; статичная часть = только инструкции агенту, которые пишет человек. [verified]
- **Agent Memory (новое направление):** persistent понимание паттернов/предпочтений пользователя между разговорами; «living memory of your company», «ambient AI operating system», обучение от ежедневного использования. [claimed] (dust.tt/blog/agent-memory-building-persistence-into-ai-collaboration)
- Финансирование €34M (контекст зрелости). [claimed]

**Маппинг:** прямой аналог нашего разделения. Их «static instructions + retrieved context» = наш паттерн «cache-friendly SYSTEM (стабильный) + переменные данные в конце user» (см. [[feedback_llm_prompts_cache_friendly]]). «Include Data до заполнения окна» — антипаттерн для нас (дорого, ломает кэш); нам ближе Search/RAG. Их Agent Memory = ровно тема нашего subject-memory-and-self-learning.

---

## 3. Notion AI / Q&A

**Функциональный разрез:** вопрос на естественном языке → ответ, «grounded in your workspace content», с **цитатами-источниками** для проверки. Понимает OKR, спринты, цели кампаний — «из библиотеки информации, которую вы построили как компания». [verified] (notion.com/help/guides/get-answers...with-q-and-a)

**Технический разрез:**
- **Механика = RAG**: «AI doesn't make things up or pull from the wider internet. It first retrieves relevant info from your private Notion pages and then generates an answer based only on that material». [verified] (eesel.ai, gend.co — triangulated с notion help)
- Учитывает права доступа (читает только страницы, к которым есть доступ); на части тарифов — коннекторы к Slack/Drive/Jira/GitHub/Teams/SharePoint/Gmail. [verified]
- Модели: «GPT-4 and Claude with the context of your workspace». [claimed] (notion help)
- **Авто-описания компании НЕТ** — контекст = retrieval из страниц в момент запроса. [inferred из описания механики]

**Маппинг:** их сила — **цитаты-источники + permission-aware retrieval**. Это наш ориентир для доверия в ChatV2 (у нас gap по «уверенности/источникам» — см. [[project_competitor_istok_ai]]). RAG-only без графа — мы сильнее за счёт графа.

---

## 4. Guru — governed knowledge layer + verification (доверие)

**Функциональный разрез:** структурированная, «управляемая» (governed) база знаний — единый источник правды; AI-ответы с цитатами в Slack/Teams/браузере; ключевая фишка — **верификация экспертом (SME)**, чтобы «каждому AI-ответу можно было доверять». [verified] (getguru.com/, /features/verification)

**Технический разрез (это раздел про ДОВЕРИЕ из ТЗ):**
- Каждая Card имеет статус **verified / unverified** + timestamp + назначенный верификатор (человек/группа), либо AI предлагает эксперта по тому, кто создавал/правил контент. [verified] (help.getguru.com, /features/verification)
- **Расписание реверификации:** weekly / monthly / quarterly / yearly / custom (даты до 9999 года). Напоминания в Slack/email/web, верификация в один клик. [verified]
- **Trust score** (балл доверия) на базу; **auto-archive** неверифицированных и неиспользуемых Card в очередь на ревью. [verified]
- AI-ответы: источники только из того, что клиент явно сконфигурировал как доступное; в ответе — citations откуда взято. **Knowledge Agents** верифицируют контент «непрерывно и автономно». [verified] (диги-новика, getguru features — triangulated)
- Точные формулы trust score и влияние verified-статуса на ранжирование ответа НЕ раскрыты. [verified что не раскрыто]

**Маппинг:** модель «verified + interval + trust score + auto-archive» — готовый каркас доверия для нашего org-summary и фактов графа. Перенять: статус факта (verified/stale), TTL реверификации как **крутилка в AdminSetting** (не ENV — см. CLAUDE.md §9), citation в каждом ответе. Их «human SME verify» нам нельзя по нашему правилу [[feedback_no_human_in_loop_for_clone_learning]] (30 человек, «соглашаются не вникая») → у нас верификация должна быть автоматической (composite judge), human только как kill-switch.

---

## 5. Sana AI (Stockholm; куплен Workday)

**Функциональный разрез:** ассистент + поиск по базе + автоматизация; подключается к 50+ SaaS, уважает нативные права, отвечает/пишет документы/запускает многошаговые автоматизации «на ваших реальных данных, не из интернета». [verified] (sanalabs.com/assistant)

**Технический разрез:**
- «Grounded in all your company's information», агенты приоритезируют **verified organizational knowledge** для снижения галлюцинаций. [claimed] (sanalabs.com)
- Поток: Google Drive + Slack + Notion → Sana AI (index + permissions) → Chat/Voice/In-app + Agent actions. [verified] (aurora-designs.ca teardown)
- Внутри Workday: сидит в «governed context and process graph», грунтит действия в data model людей/финансов Workday. [claimed] (newsroom.workday.com)
- Авто-описания компании как текст НЕ описано; контекст = index + permission-aware retrieval. [inferred]

**Маппинг:** подтверждает паттерн «index + permissions + grounding». «Process graph» Workday — аналог нашей идеи связывать процессы (у нас second-brain/03_processes/). Голосовой ВВОД у них есть — у нас ОК, но без голосового вывода ([[feedback_concierge_text_only_output]]).

---

## 6. Microsoft 365 Copilot — Graph grounding (самая раскрытая механика)

**Функциональный разрез:** в Word/PowerPoint/etc пользователь пишет промпт → Copilot подмешивает контекст из его почты/файлов/встреч/чатов/календаря (в рамках его прав) → отвечает релевантно задаче. [verified] (learn.microsoft.com/.../microsoft-365-copilot-architecture)

**Технический разрез — точный data-flow:**
1. Пользователь вводит промпт.
2. Copilot **preprocesses через grounding**, обращаясь к **Microsoft Graph** в тенанте. Grounding = «assigning extra context and content to the prompt» из Graph (emails, files, meetings, chats, calendars) + **Semantic Index** (семантический индекс поверх Graph). [verified архитектура; Semantic Index triangulated: aguidetocloud, voitanos]
3. Grounded-промпт уходит в LLM → ответ → возврат в приложение. [verified]
- **System prompt**: «default system prompt» обеспечивает Responsible AI правила и тип доступного контента, но **«won't have any special context on a specific scenario»** — то есть статический системный промпт НЕ несёт описания компании; весь org-контекст приходит через grounding. [verified] (nboldapp.com — про дефолтный system prompt)
- Доступ строго по правам пользователя (RBAC, Conditional Access, MFA). Данные не покидают service boundary тенанта. [verified] (learn.microsoft.com)
- **Авто-описания компании НЕТ**; org-контекст = grounding из Graph + Semantic Index в момент запроса. [verified]

**Маппинг:** эталонная формулировка для нашего ТЗ: «системный промпт = правила поведения, org-контекст = grounding». Semantic Index ≈ наш pgvector. RBAC по subject — у нас TenantGuard + tenantId на каждый knowledge-запрос (уже есть).

---

## 7. Google Gemini Enterprise — Knowledge Catalog / Knowledge Engine

**Функциональный разрез:** платформа для построения корпоративных агентов, «grounded in enterprise data»; подключение приватных данных и внутренних инструментов через MCP-серверы. [verified] (cloud.google.com/blog/.../introducing-gemini-enterprise-agent-platform)

**Технический разрез:**
- Grounding: привязка вывода модели к проверяемым источникам через **RAG / Google Search / Maps** для снижения галлюцинаций. [verified] (docs.cloud.google.com/.../grounding/overview)
- **Knowledge Catalog** грунтит агентов в «trusted business context across the entire data estate»; **Knowledge Engine** автономно тегирует, выводит логику и маппит связи по предприятию → строит **«unified, dynamic context graph of an entire business»**. [claimed] (bain.com, cloud.google.com Next26)
- **Memory Bank** — persistent долгосрочный контекст; long-running агенты держат состояние сутками. [claimed]
- Это **ближайший аналог «авто-context-graph всей компании»**, но снова — граф/каталог связей, не текстовый параграф-описание. [verified что граф; inferred что нет текст-описания]

**Маппинг:** «Knowledge Engine автономно строит context graph всего бизнеса» = наш knowledge-core, только у Google это маркетинговый claim, а у нас уже работает pipeline. Memory Bank = наш subject-memory. MCP — у нас claim «MCP» в коде НЕ подтверждён (см. [[project_moat...]]), это направление, не факт.

---

## 8. Паттерн «авто-summary организации из её данных» (отдельно, по заданию)

**Кто реально делает текстовое авто-описание компании:**
- **Генераторы профилей** (iWeaver AI, PerfectAssistant, Easy-Peasy.AI, Template.net): сканируют сайт/PDF/текст → генерят «company overview / mission / services / value proposition» под индустрию. [triangulated(3)] (iweaver.ai, perfectassistant.ai, easy-peasy.ai)
  - Это **разовая генерация маркетингового текста**, НЕ живой контекст ассистента, без пересчёта/доверия/источников. [inferred из назначения инструментов]
- **AI-онбординг-генераторы** (ClickUp, aidocmaker): «AI engine scans provided materials → auto-customizes content», «role-adapted onboarding packets». Тоже разовый документ, не контекст-слой. [triangulated(2)]

**Кто делает авто-контекст организации как ЖИВОЙ слой (не текст, а граф/индекс):**
- Glean Enterprise Graph, Google Knowledge Catalog/Engine — **непрерывно** строят граф сущностей и связей бизнеса. [triangulated(2)]
- Частота пересчёта: «real-time / continuous crawling» (Glean); конкретные интервалы НЕ публикуются ни у кого. [verified что не публикуют]

**Как показывают доверие/источники:**
- Guru: verified/unverified статус + trust score + интервал реверификации + citations. [verified]
- Notion Q&A: citations-источники на каждый ответ. [verified]
- M365 Copilot / Gemini: grounding к «verifiable sources», ссылки на источники. [verified/claimed]

**Вывод по паттерну:** «авто-summary организации» в зрелых продуктах — это **дериват графа/индекса**, а не первичная сущность. Текстовое «чем компания занимается» либо (а) не существует как отдельное поле (всё через retrieval), либо (б) генерится разово вспомогательными инструментами без жизненного цикла. **Ниша «живое авто-описание компании с источниками и пересчётом, которое кормит ассистента» — фактически свободна.** Это потенциальный дифференциатор Коры.

---

## Конфликты / расхождения в данных

1. **«Есть ли вообще статический company-context в промпте»** — M365 Copilot прямо говорит «нет, дефолтный system prompt без специфики компании» [verified]; Dust имеет «static instructions», но это поведение агента, не описание компании [verified]. Конфликта по сути нет, но терминология «system prompt context» в маркетинге размыта — нужно разделять «правила поведения» vs «org-факты».
2. **«Граф vs текст-summary»** — все memory-платформы строят ГРАФ/ИНДЕКС; «текстовое описание компании» делают только генераторы профилей. Два разных класса продуктов, которые в маркетинге звучат похоже («company context»). Разводить явно.
3. **Verification: human vs auto** — Guru завязан на human SME [verified], Gemini/Glean заявляют «autonomous Knowledge Agents» [claimed]. Для нас обязателен авто-путь (наше правило against human-in-loop).
4. **Стек backend** — ни один вендор не раскрывает backend-стек в первоисточниках; в этом отчёте backend-стек НЕ указан (нет данных из вакансий). Все наши маппинги — на уровне архитектурных паттернов, не реализации. [inferred]

---

## Перенять в Кору (приоритезация)

| Что | Источник-донор | Как лечь на наш стек |
|---|---|---|
| Org-summary как **дериват графа**, не ручное поле | Glean, Google Knowledge Catalog | Воркер строит summary из knowledge-core (Entity/IdeaBlock по «elevation»: популярность, заголовки, кросс-линки) |
| Пересчёт по расписанию + кэш | Glean (continuous), Guru (interval) | @Cron + кэш в Postgres; интервал — **AdminSetting**, не ENV |
| Промпт = стабильный SYSTEM (правила) + org-capsule + RAG-факты в конце user | M365 Copilot, Dust | cache-friendly ([[feedback_llm_prompts_cache_friendly]]); org-capsule короткий и стабильный |
| **Citations + статус доверия** на каждый ответ | Notion, Guru | gap в нашем ChatV2; добавить источники + «уверенность» |
| verified/stale + TTL реверификации + auto-archive | Guru | статус факта в графе; TTL крутилка; **авто**-судья вместо human SME |
| permission-aware retrieval по subject | M365 Copilot, Sana | у нас TenantGuard+tenantId уже есть; расширить на subject-слой |

---

## Источники

- Glean: https://www.glean.com/ , https://www.glean.com/product/assistant , https://www.glean.com/press/glean-introduces-third-generation-ai-assistant-new-enterprise-graph-to-enable-the-superintelligent-enterprise , https://www.glean.com/blog/knowledge-graph-agentic-engine (доступ 2026-06-21)
- Dust: https://dust.tt/home/product , https://docs.dust.tt/docs/understanding-retrieval-augmented-generation-rag-and-the-search-method-in-dust , https://docs.dust.tt/docs/include-data , https://dust.tt/blog/agent-memory-building-persistence-into-ai-collaboration (2026-06-21)
- Notion: https://www.notion.com/help/guides/get-answers-about-content-faster-with-q-and-a , https://www.eesel.ai/blog/notion-ai-qa-in-knowledge-hub , https://www.gend.co/blog/notion-q-and-a (2026-06-21)
- Guru: https://www.getguru.com/ , https://www.getguru.com/features/verification , https://help.getguru.com/docs/what-is-verifcation , https://diginomica.com/guru-adds-verification-generative-ai-speed-capture-trusted-enterprise-knowledge (2026-06-21)
- Sana: https://sanalabs.com/assistant , https://newsroom.workday.com/2026-03-17-Introducing-Sana-from-Workday... , https://aurora-designs.ca/tools/sana-ai (2026-06-21)
- Microsoft 365 Copilot: https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture , https://nboldapp.com/advanced-microsoft-365-copilot-techniques-prompting-grounding-and-automation/ , https://www.aguidetocloud.com/blog/how-microsoft-365-copilot-works-layer-by-layer/ (2026-06-21)
- Gemini Enterprise: https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform , https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/overview , https://www.bain.com/insights/google_cloud_next_2026_the_agentic_enterprise_control_plane_comes_into_view/ (2026-06-21)
- Генераторы профилей: https://www.iweaver.ai/agents/company-profile-generator/ , https://perfectassistant.ai/tools/business/company-profile , https://easy-peasy.ai/templates/company-profile-generator (2026-06-21)

# Ветка 3 — RU коммерческий рынок «второго мозга»

> Карта российских продуктов и студий через линзу «второго мозга компании». Фильтр — критерии раздела 2 базового документа `second-brain-approach-research.md` (минимум 4 из 6).
> Дата: 2026-05-20.
> Автор-агент: Branch-3 (RU market).
> Дополняет, не заменяет [[market-research-2026]] и [[branch-1-concept]].

---

## 0. Краткое резюме (TL;DR)

- **Прямых «корпоративных вторых мозгов» в РФ практически нет.** Из ~40 проанализированных продуктов критериям раздела 2 (минимум 4 из 6) формально проходят 3–4 кейса, и ни один не делает это полноценно: либо нет темпоральности, либо нет API памяти для агентов, либо capture однопоточный. Главные кандидаты: **red_mad_robot Smart Platform / DCD Design + Smarty**, **MWS AI Agents Platform + autoRAG**, **GigaChat Enterprise + GigaMemory**.
- **Псевдо-«вторые мозги» — корпоративные RAG-чатботы поверх KMS.** TEAMLY AI, Minerva Knowledge, Авандок.ИИ, Smart Enterprise Assistant, ELMA AI, Cloud.ru «Корпоративная Wiki с AI», EvaWiki — все позиционируются маркетингом как «AI-память компании», но архитектурно это RAG-чатбот по wiki без слойной переработки, без temporal awareness, без surfacing.
- **Главная угроза от гигантов — Сбер.** GigaChat Enterprise (март 2026) + соревновательная задача GigaMemory на AI Journey 2025 + открытые веса GigaChat Ultra + платформа Caila — Сбер строит memory-substrate для корпоративных агентов на уровне инфраструктуры. По темпу развития обгоняет Яндекс и МТС.
- **Скрытые конкуренты — студии done-for-you.** В РФ ~30+ AI-студий делают «RAG-ассистент под ключ» с ценником 200K – 2 млн ₽ за внедрение. Топ: red_mad_robot (Smart Platform, кейс с Beeline — Data Award 2026), Just AI (Agent Platform), Napoleon IT (OnPremAI), R77.ai (выпускники МФТИ), Технологика, LighTech, ARITIN, MadBrains, Allsee.team, VibeLab, Cleverbots, ZeBrains, KT.team, Secret Agents.
- **Свободные ниши для Z.** Личный AI-«второй мозг» для русскоязычного знаниевого работника — пусто (Mem.ai/Reflect не работают, mymeet — про встречи). Командный «второй мозг» для МСБ с capture из встреч + чатов + документов — пусто. «Memory-as-API» для других продуктов — никто не делает явно.

Прямых конкурентов Z в категории «AI-встречи + второй мозг компании» сегодня **нет ни одного**. Granola движется к этому на INT-рынке, но локальные игроки (mymeet, НаВстрече, Таймлист) отстают: они делают саммари встречи, а не cross-meeting memory.

---

## 3.1. Обзорная таблица — все найденные продукты

| # | Продукт | Компания | Тип | Стек | Цена | Реестр РФ | Критерии (из 6) | Class? | Релевантность Z |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **TEAMLY AI** | QSOFT (Газпромбанк) | Корп. KMS + AI | RAG поверх wiki, GigaChat/YandexGPT | от 150 ₽/чел/мес | Да | 2, 3 | **Нет** (RAG-search) | Прямой конкурент при расширении в KMS |
| 2 | **Minerva Knowledge** (ex-Naumen KMS) | Minervasoft | Корп. KMS + AI Copilot | semantic search + Just AI чатбот | по запросу | Да | 2, 3 | **Нет** (RAG-search) | Конкурент в энтерпрайз-KMS |
| 3 | **Авандок.ИИ Ассистент** | КОРУС Консалтинг | Корп. документооборот + AI | локальная LLM, Telegram-бот | по запросу | Да | 1, 2, 3 | **Нет** (нет temporal/surfacing) | Конкурент при работе с госсектором |
| 4 | **Smart Enterprise Assistant (SEA)** | Smart Enterprise Assistant | Корп. KMS + AI | RAG, ACL по доступам | по запросу | Да | 2, 3 | **Нет** | Псевдо-«второй мозг» |
| 5 | **ELMA AI / ELMA365 KMS / ELMA Cortex** | ELMA | ECM/BPM + AI агенты | low-code + GigaChat/YandexGPT, RAG | от 290K₽/год | Да | 1, 2, 3 | **Нет** | Конкурент при расширении в workflow |
| 6 | **EvaWiki / EvaProject** | EvaTeam | Корп. wiki | wiki + права + поиск | от 299 ₽/мес/польз | Да | 2 | Нет | Только KMS, не «мозг» |
| 7 | **Yonote** | Yonote | Корп. wiki + AI | wiki + AI-блоки | freemium / по запросу | Да | 2 | Нет | Только KMS |
| 8 | **Kaiten AI** | Кайтен | Task tracker + AI | задачи + AI-ассистент | от 420 ₽/мес/польз | Да | 2 | Нет | Только task-AI |
| 9 | **WEEEK AI** | WEEEK | Workspace + AI | задачи + базы знаний + CRM | freemium | Да | 2 | Нет | Только KMS |
| 10 | **Gramax / Документерра** | Гранатум / Документерра | Tech docs + AI | wiki под docs-as-code, AI-помощник | по запросу | Да | 2 | Нет | Только docs |
| 11 | **GigaChat Enterprise + GigaMemory** | Сбер | Платформа корп. LLM + memory | Caila MLOps, On-prem/SaaS/Hybrid, RAG, long-term memory | по запросу | Да | 1, 2, 3, 6 | **Да** (4/6) | Главная угроза |
| 12 | **YandexGPT 5 Pro + Alice Pro + Я-Wiki + AI Studio** | Яндекс | Платформа корп. LLM + Workspace AI | Я 360 + AI Studio + RAG + on-prem от конца 2026 | в тарифе Я 360 | Да | 1, 2, 3 | Близко (3/6) | Угроза через Я 360 lock-in |
| 13 | **MWS AI Agents Platform + Cotype + autoRAG** | МТС (MTS AI / MWS AI) | Корп. LLM + AI агенты | Cotype 9B, on-prem, low-code, ASR/TTS, AgentOps | по запросу, enterprise | Да | 1, 2, 3, 6 | **Да** (4/6) | Сильнейший on-prem конкурент |
| 14 | **T-Bank AI / Gen-T / Sage AI** | T-Tech (Тинькофф) | Личные AI-ассистенты + Observability AI | Gen-T LLM + speech | по запросу | Да | 1, 2 | Нет | Не в корпоративной памяти |
| 15 | **Cloud.ru Evolution AI Factory + Корпоративная Wiki с AI** | Cloud.ru (СберCloud) | Cloud RAG + KB | RAG + Evolution AI Agents + MCP | usage-based | Да | 1, 2, 3 | Близко (3/6) | Конкурент по инфра |
| 16 | **VK AI Space + VK AI Ассистент (WorkSpace)** | VK Tech | Корп. LLM-агенты + Workspace AI | каталог агентов, MCP, суммаризация встреч/писем/чатов | в тарифе VK WorkSpace | Да | 1, 2, 3 | Близко (3/6) | Угроза через VK WorkSpace |
| 17 | **Kaspersky KIRA AI + Container Security AI** | Kaspersky | Безопасность + AI Assistant | LLM-API hook, OWASP ASI Top 10 ориентир | в продуктах | Да | — | Не релевантно | Не в knowledge |
| 18 | **МойОфис Чат AI + Платформа AI** | МойОфис | Workspace + AI | MOST-документы, чат AI | в тарифе | Да | 1, 2 | Нет | Конкурент по Workspace |
| 19 | **Smart Platform / Smarty / DCD Design** | red_mad_robot | Корп. AI-агенты + Knowledge Base | DCD (Domain–Collection–Document), мульти-агентная KB-генерация, под ключ | проектная | — (студия) | 1, 2, 3, 4 | **Да** (4/6) | Прямой конкурент-студия |
| 20 | **Just AI Agent Platform (JAICP)** | Just AI | Корп. AI-агенты + memory | low/pro-code, MCP, память между сессиями, on-prem | по запросу | Да (март 2026) | 1, 3, 5, 6 | **Да** (4/6) | Конкурент-инфраструктура |
| 21 | **NeuralDeep / NDT by red_mad_robot** | red_mad_robot / vakovalskii | Каталог MCP-серверов + AI | MCP агрегатор под РФ-сервисы (1С, Яндекс, GigaChat, VK) | freemium / open-source | — | 1, 6 | Нет | Источник идей для интеграций |
| 22 | **Napoleon IT OnPremAI** | Napoleon IT | Платформа on-prem LLM + KB | LLM + мультимодальные базы знаний | проектная | Да | 1, 2, 3 | Близко (3/6) | Конкурент-инфраструктура |
| 23 | **Кактус.AI (kkts.ai)** | Кактус | Корп. AI-платформа | OpenWebUI + LiteLLM, рубли, on-prem | от ~5K₽/мес | Да | 1 | Нет | Конкурент-инфраструктура |
| 24 | **AI-ОФИС (aiworkplace.ru)** | AI-ОФИС | Корп. AI-Workplace | REST API + MCP + Workflow | по запросу | Да | 1 | Нет | Конкурент-инфраструктура |
| 25 | **ZeBrains Цифровой офис AI** | ZeBrains | Студия + платформа | мульти-агентная low-code | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 26 | **KT.team Assistant AI** | KT.team | Студия done-for-you | RAG + бизнес-процессы | проектная | — (студия) | 1, 2 | Нет | Скрытый конкурент-студия |
| 27 | **R77.ai** | R77.ai (выпускники МФТИ) | Студия done-for-you | RAG + LLM + CV + Telegram | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 28 | **Технологика** | Технологика | Студия done-for-you | RAG-системы + интеграция | проектная (1–2 млн ₽) | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 29 | **LighTech** | LighTech | Студия done-for-you | RAG под ключ + roadmap | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 30 | **ARITIN** | ARITIN | Студия done-for-you | собственные LLM в РФ-контуре | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 31 | **MadBrains** | MadBrains | Студия done-for-you | RAG + chatbot + video analytics | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 32 | **Allsee.team** | Allsee | Студия done-for-you | RAG ассистенты + поиск | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 33 | **VibeLab** | VibeLab | Студия done-for-you | RAG + GigaChat/YandexGPT для МСБ | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 34 | **Cleverbots** | Cleverbots | Студия done-for-you | NLU + GenAI + RAG | проектная (от 100K₽) | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 35 | **Secret Agents** | Secret Agents | Студия done-for-you | IT-аудит → AI → BI, без облака | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 36 | **resolventa.group** | Resolventa | Студия done-for-you | RAG-поиск + LLM | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 37 | **Cognito** | Cognito | Студия done-for-you | RAG-агенты | проектная | — (студия) | 1 | Нет | Скрытый конкурент-студия |
| 38 | **Mirapolis HCM + Digital Twin профили** | Mirapolis | HCM + цифровой двойник профиль | HR-данные + ML-аналитика | от 30–50K₽/мес | Да | 3 | Нет | Не «второй мозг», HCM |
| 39 | **AISHA (aisha.one)** | AISHA | Recruiter assistant | AI поверх hh.ru | по запросу | Да | — | Нет | Не релевантно |
| 40 | **mymeet.ai** (контрольно, уже в market-research) | mymeet.ai | AI-ассистент встреч | ASR + LLM summary | $8–32/мес | Нет | 2 | Нет | Прямой конкурент Z по AI-встречам, не по памяти |
| 41 | **НаВстрече, Таймлист, FollowUp, MeetScribe** (контрольно) | разные | AI-ассистенты встреч | ASR + LLM summary | 0–8K₽/мес | частично | 2 | Нет | Прямые конкуренты Z по AI-встречам |

> Расшифровка критериев (из раздела 2 базового документа):
> 1 — многоканальный capture, 2 — слойная переработка, 3 — связи между сущностями, 4 — surfacing, 5 — темпоральность, 6 — память для агента (API).

---

## 3.2. Гиганты экосистем

### 3.2.1. GigaChat / Сбер — **главная угроза**

**Что есть в категории memory/knowledge:**

- **GigaChat Enterprise** (запуск март 2026) — корпоративная платформа на базе модели GigaChat Ultra. Доступна в трёх конфигурациях: локальная (для крупнейших компаний, банков и КИИ), облачная (SaaS), гибридная (для среднего и крупного бизнеса с хранением данных на серверах компании). Включает: контроль доступов, модерацию контента, защиту данных. Источник: [Сбер: GigaChat (ГигаЧат) — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80:_GigaChat_(%D0%93%D0%B8%D0%B3%D0%B0%D0%A7%D0%B0%D1%82)), [ixbt.pro: Сбер представил корпоративную платформу GigaChat Enterprise](https://ixbt.pro/en/news/2026/03/03/sber-predstavil-korporativnuiu-platformu-gigachat-enterprise-dlia-sozdaniia-ii-agentov.html).
- **GigaChat Ultra с long-term memory** (март 2026 обновление) — модель «запоминает факты о пользователе между сессиями, сохраняя интересы, профессию, жизненные цели, образование» для персонализации. Источник: [Сбер представил большое обновление ГигаЧат — АИФ](https://aif.ru/techno/technology/personalnyy-ii-pomoshchnik-sber-predstavil-bolshoe-obnovlenie-gigachat), [Сбер представил ГигаЧат — Т-Банк инвест-новость](https://www.tbank.ru/invest/social/profile/Sber_Official/9f1fc9cf-6067-4884-b048-126ef64ba6c7/).
- **GigaMemory — соревновательная задача AI Journey 2025** — Сбер открыто двигает память LLM в продакшен. Задача: «Создание глобальной памяти для LLM в виде самостоятельного модуля. Глобальная память — способность извлекать и помнить атомарные факты о пользователе». Решения-победители построены на двух агентах (memory + verification). Репозиторий: [github.com/ai-forever/memory_aij2025](https://github.com/ai-forever/memory_aij2025), описание: [AI Journey Contest 2025 — Baikal24](https://baikal24.ru/text/24-11-2025/062/).
- **Открытые веса GigaChat Ultra** (март 2026) — Сбер выложил веса, чтобы организации (от банков до стартапов) могли поставить нейросеть в закрытый контур и адаптировать под корпоративные данные. Источник: [news.inhouse-marketing.ru: масштабное обновление GigaChat](https://news.inhouse-marketing.ru/2026/03/24/sber-predstavil-masshtabnoe-obnovlenie-gigachat/).
- **Caila MLOps** — платформа MLOps для жизненного цикла моделей, на которой работает GigaChat Enterprise. Источник: [Just AI: сравнение российских платформ](https://just-ai.com/blog/sravnenie-rossijskih-platform-dlya-sozdaniya-ai-agentov).
- **SaluteSpeech** — ASR/TTS платформа, открыта полностью. Источник: [Сбер: SaluteSpeech — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80_SaluteSpeech_(SmartSpeech)).
- **MCP-серверы от ai-forever** — официальные обвязки: [mcp_voice_salute](https://github.com/ai-forever/mcp_voice_salute), [mcp_giga_checker](https://github.com/ai-forever/mcp_giga_checker).

**Темп развития:** агрессивный. От «чатбота с памятью» (2025) → к «корпоративной платформе с памятью» (март 2026) → к «открытым весам + локальное развёртывание + конкурс на алгоритмы памяти». Это самый явный движок к organizational memory среди российских гигантов.

**Закрытость экосистемы:** относительно низкая для гиганта — открытые веса, OpenAI-compatible API, ставка на интеграторов через Caila.

**Критерии раздела 2 для GigaChat Enterprise + GigaMemory:** 1 (capture через коннекторы), 2 (RAG + structured extract), 3 (атомарные факты + entity), 6 (API). Темпоральности и surfacing нет явно. Итого 4/6 — формально проходит.

**Опасность для Z:** очень высокая на горизонте 12–18 месяцев. Сбер строит универсальный memory-substrate, поверх которого любой интегратор соберёт «второй мозг компании» дешевле, чем self-host Mem0+Graphiti.

### 3.2.2. YandexGPT / Яндекс — **угроза через экосистему**

**Что есть:**

- **Alice Pro (Нейроэксперт)** — AI-ассистент в Яндекс 360, работает с письмами, документами, конспектами встреч (Телемост). Извлекает факты из текстов, таблиц, презентаций, аудио и видео. Источник: [Alice Pro — Yandex 360](https://360.yandex.ru/business/alicepro/), [Анти-Malware: Yandex 360 on-premise + Alice Pro](https://www.anti-malware.ru/analytics/Technology_Analysis/Yandex-360-on-premises-Alisa-Pro).
- **YandexGPT 5 Pro + RAG** — для корпоративных баз знаний и FAQ. Источник: [YandexGPT in 2026 review — mysummit.school](https://mysummit.school/blog/en/yandexgpt-review-2026/).
- **Yandex AI Studio** — интеграция с корпоративными системами (ERP, БД, тикеты, документы) через единый API-шлюз. Источник: [JET & Yandex GPT Lab — Habr](https://habr.com/ru/companies/jetinfosystems/articles/956042/).
- **Yandex Wiki** — корпоративная wiki в Яндекс 360. Источник: [Wiki Yandex — Yandex 360](https://360.yandex.com/business/wiki/).
- **On-prem Я 360** к концу 2026 — анонсирован на Yandex Connect 2025 для секретного периметра, поддержка ГОСТ, единый защищённый клиент.

**Темп развития:** средний — Я 360 движется планомерно, но без открытых весов и без явного «memory product». Cross-meeting memory не заявлена.

**Закрытость экосистемы:** высокая — основное хождение через Я 360 lock-in. Не годится для тех, кто не на Я 360.

**Критерии:** 1 (через Я 360 capture: почта, документы, встречи), 2 (Alice Pro извлекает факты), 3 (entity и связи в YandexGPT 5.1 Pro). Темпоральности, явного surfacing и memory-as-API наружу не заявлено. Итого 3/6 — не проходит, но близко.

**Опасность для Z:** средняя. Угроза для клиентов, которые уже на Я 360 — там встройка дешевле, чем переход на Z. Для тех, кто не в экосистеме — Я 360 не вытесняет.

### 3.2.3. MTS AI / MWS AI — **сильнейший on-prem конкурент по инфре**

**Что есть:**

- **Cotype Light 3 / Cotype Pro 2 — мультимодальные LLM** (апрель 2026, 9B параметров): работает с текстом и визуальными данными (договоры, чертежи, формы, изображения). MERA-бенчмарк: 0.792 из 1.0 (топ-3). В реестре отечественного ПО. Источник: [MWS AI Cotype — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:MTS_AI:_Cotype_(%D0%91%D0%BE%D0%BB%D1%8C%D1%88%D0%B0%D1%8F_%D1%8F%D0%B7%D1%8B%D0%BA%D0%BE%D0%B2%D0%B0%D1%8F_%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C,_LLM)), [Ведомости: MWS AI Cotype](https://www.vedomosti.ru/technologies/new_technologies/news/2026/04/02/1187408-korporativnih-ii-agentov).
- **MWS AI Agents Platform** — enterprise-платформа для жизненного цикла AI-агентов: low-code конструктор, autoRAG, ASR/TTS, LLMOps/AgentOps. Только on-prem и private cloud. SLA + команда внедрения. В реестре. Источник: [mts.ai Product: AI Agents Platform](https://mts.ai/product/ai-agents-platform/).
- **MWS Octapi** — интеграционная платформа для подключения AI-агентов к корпоративному ландшафту, поддерживает MCP. Ускоряет создание мультиагентных систем на 30%. Источник: [MWS Octapi — mws.ru](https://mws.ru/dev-tools/octapi/), [CNews: MWS Octapi](https://www.cnews.ru/news/line/2026-01-30_mts_web_services_na_30_uskorila).
- **MTS Link** — внедрил ИИ-помощника в онлайн-доски (ноябрь 2025). Источник: [CNews: MTS Link ИИ-помощник](https://www.cnews.ru/news/line/2025-11-14_mts_link_vnedril_ii-pomoshchnika).
- **Кейсы:** MWS AI развернула для крупной горнодобывающей компании набор цифровых ассистентов на базе Cotype LLM с RAG-функциональностью для технологических инцидентов, ТО, ОТ. Заявленная экономия — до 50% времени работы. Источник: [MTS AI Кейсы](https://mts.ai/kejsy-vnedreniya-ii/).
- **Forbes о МТС:** платформа для ИИ-агентов и линейка корпоративных AI-помощников на 7 отраслей (госсектор, банкинг, промышленность, ритейл, телеком, медицина, ИТ). Источник: [Forbes: МТС платформа для ИИ-агентов](https://www.forbes.ru/tekhnologii/551248-sredi-begusih-pervyh-net-i-otstausih-mts-zapustila-platformu-dla-ii-agentov), [Forbes: МТС корпоративные ИИ-помощники](https://www.forbes.ru/tekhnologii/533813-agenty-vystraivautsa-v-linejku-mts-vypustit-na-rynok-korporativnyh-ii-pomosnikov).

**Темп развития:** высокий. Цель: 7 отраслей × отраслевые ассистенты, мультимодальная Cotype, AgentOps как первый класс продукта.

**Закрытость экосистемы:** низкая — vendor-agnostic, поддерживает любые LLM, on-prem-приоритет.

**Критерии:** 1 (multi-channel capture через Octapi/MCP), 2 (autoRAG), 3 (entity-extraction), 6 (API + MCP). Темпоральность и surfacing не заявлены явно. Итого 4/6 — проходит формально.

**Опасность для Z:** высокая. Если МТС добавит к Cotype memory-слой как первый класс — это будет универсальная замена self-host Mem0+Graphiti для enterprise.

### 3.2.4. T-Bank AI (T-Tech) — **в стороне от корп. памяти**

**Что есть:**

- **Gen-T** — собственная LLM-технология, на которой построены 6 личных AI-ассистентов («первая экосистема персональных помощников в России»). Источник: [T-Bank AI: AI-powered FinTech](https://ai.tbank.ru/), [T-Bank AI: assistants](https://ai.tbank.ru/assistants/).
- **AI-ассистент в интернет-банке для бизнеса (Точка)** — 24/7-помощник для бизнеса. Источник: [Точка: AI-ассистент для бизнеса](https://tochka.com/rko/aiassistant/spec/).
- **Sage Observability + Sage AI** (анонсирована на CIPR-2026 для запуска H2 2026) — мониторинг бизнес-процессов и ИТ + интеллектуальный слой. AI-агент в платформе наблюдаемости — конец 2026. Источник: [Ведомости: T-Bank запустит первого ИИ-агента в платформе наблюдаемости](https://www.vedomosti.ru/technologies/industries_and_markets/news/2026/05/20/1198439-t-bank-zapustit-pervogo).
- **AI-ассистент для разработчиков** — Sage AI Code (внутренний). Источник: [T-Bank: AI-ассистент для разработчиков](https://www.tbank.ru/career/technologies/ai-assistant/).

**Темп развития:** средний; фокус на финтех и обсервабилити, не на корпоративной памяти.

**Опасность для Z:** низкая. T-Tech не строит memory-substrate для корпоративных знаний.

### 3.2.5. Cloud.ru / SberCloud — **инфраструктурный конкурент**

**Что есть:**

- **Evolution AI Factory** — платформа нового поколения для GenAI и ML. Источник: [Cloud.ru: Evolution AI Factory](https://cloud.ru/products/evolution-ai-factory).
- **Evolution AI Agents** — мультиагентные системы с MCP и real-time мониторингом. Источник: [Cloud.ru: Evolution AI Agents](https://cloud.ru/products/evolution-ai-agents).
- **Корпоративная Wiki с AI** — managed RAG поверх своего объектного хранилища, intelligent search, AI-assistant, защита от галлюцинаций, соответствие ФЗ-152. Источник: [Cloud.ru: Корпоративная база знаний с AI](https://cloud.ru/solutions/korporativnaya-baza-znaniy-s-ai).
- **Умный поиск и AI-помощник на базе RAG в облаке Cloud.ru** — отдельный продукт. Источник: [Cloud.ru: Умный поиск с AI](https://cloud.ru/solutions/umniy-poisk-i-ai-pomoschnik).
- **Habr про RAG+Ragas: учим AI-помощника без галлюцинаций** — публичная инженерная экспертиза. Источник: [Habr: Cloud.ru RAG+Ragas](https://habr.com/ru/companies/cloud_ru/articles/966698/), [Habr: облачные ассистенты и RAG — интервью](https://habr.com/ru/articles/941384/).

**Темп развития:** высокий — два managed-продукта в категории «корп. knowledge с AI» прямо сейчас.

**Опасность для Z:** средняя. Cloud.ru — это инфраструктурный конкурент: «возьми наш RAG как сервис», а не «купи готовый второй мозг». Опасно для команд, выбирающих self-host: Cloud.ru дешевле и быстрее.

**Критерии:** 1 (через object storage capture), 2 (managed RAG), 3 (entity extraction). Темпоральности и surfacing нет. Итого 3/6 — не проходит.

### 3.2.6. VK Tech / VK Workspace — **угроза через VK WorkSpace**

**Что есть:**

- **VK AI Space** (запуск апрель 2026) — платформа для разработки и запуска ИИ-агентов с готовой библиотекой агентов под типовые задачи: суммаризация, перевод, корпоративный поиск по базам знаний, подготовка документов и протоколирование встреч. Источник: [VK AI Space — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:VK_AI_Space), [CNews: VK AI Space](https://www.cnews.ru/news/line/2026-04-30_vk_tech_predstavil_platformu).
- **VK WorkSpace AI Ассистент** — встроен в почту, мессенджер, ВКС. Делает саммари переписки, чатов, авторезюме онлайн-встреч (через запись). Источник: [iot.ru: VK WorkSpace AI Ассистент](https://iot.ru/gadzhety/v-vk-workspace-poyavilsya-ai-assistent-virtualnyy-pomoshchnik-na-baze-generativnogo-ii), [CNews: VK AI Ассистент](https://www.cnews.ru/news/line/2024-11-07_v_vk_workspace_poyavilsya_ai_assistent).
- **Мессенджер MAX от VK** — обзор функций для бизнеса. Источник: [BotHelp: обзор MAX](https://bothelp.io/ru/blog/obzor-messendzhera-max).

**Темп развития:** ускоряется (VK AI Space — недавний запуск).

**Опасность для Z:** средняя для МСБ-клиентов в VK WorkSpace. VK закрывает «AI-саммари встреч + чатов + писем» внутри WorkSpace — это прямое перекрытие нашей capture-зоны. Но без cross-meeting memory: ассистент работает на одной встрече за раз, ему нужно «отправить файл в бот».

**Критерии:** 1 (multi-channel внутри WorkSpace: почта/чат/встречи), 2 (саммари), 3 (mention пользователей). Итого 3/6 — не проходит.

### 3.2.7. Касперский — **не в категории**

**Что есть:** KIRA AI (Kaspersky Investigation and Response Assistant) для SOC-аналитиков, AI-ассистент в Kaspersky Container Security (с API для внешних LLM через OpenAI-compatible), тренинг «Large Language Models Security», подход OWASP ASI Top 10 к agentic AI. Источники: [Kaspersky Container Security AI](https://www.kaspersky.com/blog/cws-update-2026/55368/), [Kaspersky Next + KIRA AI](https://www.kaspersky.com/about/press-releases/kaspersky-next-updates-its-all-in-one-soc-management-console-and-enhances-ai-functionality), [Kaspersky LLM Security training](https://www.kaspersky.com/about/press-releases/kaspersky-introduces-a-new-training-large-language-models-security).

**Опасность для Z:** не релевантно — категория безопасности, не корпоративная память.

---

## 3.3. Специализированные продукты, проходящие критерии (≥4/6)

### 3.3.1. red_mad_robot Smart Platform / DCD Design / Smarty

- **Тип:** платформа корпоративной памяти + студийное внедрение под ключ.
- **Что делает:** Smart Platform — корпоративная мультиагентная сеть. Smarty (внутри Smart Platform) — интеллектуальная база знаний, где мульти-агентная сеть самостоятельно создаёт базу знаний, тестирует и валидирует её без участия человека. DCD Design (Domain–Collection–Document) — реплицируемая архитектура: первый агент определяет нужный раздел («Domain»), второй уточняет тему («Collection»), третий выбирает источники («Document»). Источники: [SmartPlatform — rdl.redmadrobot.ru](http://rdl.redmadrobot.ru/), [red_mad_robot: разработка цифровых решений](https://redmadrobot.ru/), [Habr: red_mad_robot опенсорс-экосистема](https://habr.com/ru/articles/986828/), [redmadrobot.ru: SMARTY case Билайн](https://redmadrobot.ru/czifrovye-servisy/kak-my-sdelali-bazu-znanij-smarty-na-osnove-rag).
- **Кейс с Билайн (Data Award 2026):** точность ответов выросла с 78% до 94%, экономия времени сотрудников 30%+, снижение нагрузки на поддержку 30–40%. Масштаб: 20+ организаций, 300+ активных пользователей, ~30 000 запросов/месяц. AI-агенты: ассистент продаж, оператор контакт-центра, аналитик, маркетолог, секретарь. Источники: [OSP: Билайн x red_mad_robot ИИ-практики](https://www.osp.ru/articles/2026/0330/13060627), [beelinenow: ИИ-агенты Билайн x red_mad_robot](https://beelinenow.ru/articles/beeline-i-red-mad-robot-predstavili-ii-agentov/), [Tadviser: ИИ-агенты Билайн x red_mad_robot Data Award 2026](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%98%D0%98-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0_%D0%BE%D1%82_%D0%91%D0%B8%D0%BB%D0%B0%D0%B9%D0%BD%D0%B0_%D0%B8_red_mad_robot_%D0%B7%D0%B0%D0%B2%D0%BE%D0%B5%D0%B2%D0%B0%D0%BB%D0%B8_%D0%BD%D0%B0%D0%B3%D1%80%D0%B0%D0%B4%D1%83_Data_Award_2026), [Kommersant: Билайн x red_mad_robot DCD Design](https://www.kommersant.ru/doc/8656358), [workspace.ru: нейрочат Билайн x daisy](https://workspace.ru/cases/neyrochat-bilayn-x-daisy/).
- **Стек:** мульти-агентная сеть, RAG поверх корпоративных данных, доменно-структурированная маршрутизация. **Не open-source** — Smarty был pet-project'ом, превратился в коммерческий продукт.
- **Инвестиции:** red_mad_robot вложили $2 млн в GenAI. Источник: [Forbes: red_mad_robot инвестирует $2 млн в генеративный ИИ](https://www.forbes.ru/tekhnologii/498218-razrabotcik-cifrovyh-resenij-red-mad-robot-investiruet-2-mln-v-generativnyj-ii).
- **Критерии:** 1 (multi-channel capture в DCD), 2 (мульти-агентная переработка), 3 (Domain/Collection — иерархия + связи), 4 (маршрутизация запроса = частичный surfacing). Темпоральность и API наружу — не подтверждены явно. **Итого 4/6 — проходит.**
- **Релевантность Z:** **прямой конкурент-студия**. Если Z пойдёт в done-for-you — red_mad_robot — главный соперник. Они уже выиграли Data Award 2026 и имеют референсные кейсы (Билайн).

### 3.3.2. MWS AI Agents Platform + autoRAG + Cotype

Описан в 3.2.3. Проходит критерии 1, 2, 3, 6.
- **Релевантность Z:** конкурент-инфраструктура для enterprise. Если клиент хочет on-prem AI с памятью — это первый кандидат.

### 3.3.3. GigaChat Enterprise + GigaMemory

Описан в 3.2.1. Проходит критерии 1, 2, 3, 6.
- **Релевантность Z:** главная угроза для Z в горизонте 12–18 месяцев.

### 3.3.4. Just AI Agent Platform (JAICP)

- **Тип:** open distribution AI Agent Platform.
- **Что делает:** визуальный low/pro-code конструктор для диалоговых и workflow-агентов, подключение к чат-каналам и почте, триггеры по расписанию и событиям, **память агентов между сессиями**, готовые коннекторы к корпоративным сервисам, MCP-стандарт для внешних инструментов. Не требует передачи данных за периметр компании, поддерживает собственные LLM и корпоративные данные. Источник: [CNews: Just AI запускает открытый дистрибутив](https://www.cnews.ru/news/line/2026-04-22_just_ai_zapuskaet_otkrytyj_distributiv), [just-ai.com](https://just-ai.com/), [Tadviser: Just AI Agent Platform](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:Just_AI_Agent_Platform_%D0%B4%D0%BB%D1%8F_%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B8_%D0%B8_%D1%83%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D1%8F_AI-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D0%B0%D0%BC%D0%B8).
- **Реестр:** Just AI Agent Platform официально включён в реестр российского ПО в марте 2026.
- **Критерии:** 1 (multi-channel connectors), 3 (по типам сущностей в workflow), 5 (память между сессиями = темпоральность по сессиям), 6 (API + MCP). **Итого 4/6 — проходит.**
- **Релевантность Z:** конкурент-платформа. Если клиент хочет собрать «второй мозг» на готовом фреймворке, Just AI Agent Platform — первая альтернатива самосбору.

---

## 3.4. KM-системы с AI-апгрейдом (псевдо-«вторые мозги»)

Все продукты ниже маркетинг позиционирует как «AI-память компании / корпоративный AI-ассистент со знаниями», но архитектурно это **RAG-чатбот поверх wiki** — не «второй мозг».

### 3.4.1. TEAMLY AI (QSOFT)

- **Что делает:** RAG-чатбот поверх корпоративной wiki, использует GigaChat/YandexGPT. Источники: [TEAMLY AI](https://teamly.ru/ai/), [TEAMLY blog: что скрывает AI](https://teamly.ru/blog/chtoi_skrivaeti_aii_kaki_vdohnuti_jizn/), [Habr TEAMLY: обновление 2026](https://habr.com/ru/companies/teamly/articles/1029618/), [TEAMLY spring 2026](https://teamly.ru/spring_2026/).
- **Цена:** от 150 ₽/чел/мес (по market-research-2026).
- **Размер:** тысячи компаний (по заявлениям TEAMLY).
- **Стек:** wiki + RAG + GigaChat/YandexGPT.
- **В реестре:** да, [Qsoft Teamly — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:Qsoft_Teamly_%D0%A1%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B0_%D1%83%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D1%8F_%D0%B7%D0%BD%D0%B0%D0%BD%D0%B8%D1%8F%D0%BC%D0%B8).
- **Критерии:** 2 (саммари), 3 (по тегам/папкам). Нет multi-channel capture (только wiki), нет темпоральности, нет surfacing, нет memory-API. **2/6 — не проходит.**
- **Почему «псевдо»:** маркетинг «второй мозг компании», но это статичная wiki + RAG. Нет автоматического capture встреч/чатов, нет cross-document memory.

### 3.4.2. Minerva Knowledge (Minervasoft)

- **Что делает:** wiki + semantic search + Minerva Copilot (RAG-чатбот через Chatmeai/Just AI). Источники: [Minerva Knowledge — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:Minerva_Knowledge_(%D1%80%D0%B0%D0%BD%D0%B5%D0%B5_Minerva_KMS_%D0%B8_Naumen_KMS)), [Minerva AI knowledge base](https://minervasoft.ru/ai-baza-znanij), [Minervasoft blog: обзор ИИ-ассистентов](https://minervasoft.ru/blog/tpost/728rl7j0f1-obzor-populyarnih-na-rossiiskom-rinke-ii).
- **Стек:** wiki + semantic search + RAG-чатбот.
- **В реестре:** да.
- **Критерии:** 2 (саммари), 3 (по структуре документов). **2/6 — не проходит.**
- **Почему «псевдо»:** то же — wiki + RAG, без cross-channel.

### 3.4.3. Авандок.ИИ Ассистент (КОРУС Консалтинг)

- **Что делает:** документы → база знаний → ассистент с естественным языком. Использует локальную модель GPT с русским языком, можно работать без интернета. Telegram-бот как интерфейс. Источники: [Avandoc AI Assistant](https://avandoc.ru/avandoc-ai/solutions/ai-assistant), [Habr: КОРУС Авандок.ИИ](https://habr.com/ru/companies/korus_consulting/articles/934992/), [РБК Компании: Авандок](https://companies.rbc.ru/news/HUIQVQS9xU/korus-konsalting-vyipustil-reliz-platformyi-avandok-s-ii-tools-instrumentami/), [CNews: КОРУС Авандок релиз](https://www.cnews.ru/news/line/2025-12-15_korus_konsalting_vypustil).
- **В реестре:** да.
- **Стек:** локальная дообученная LLM + RAG + Telegram.
- **Критерии:** 1 (документы + Telegram), 2 (саммари + ссылки на разделы), 3 (через метаданные документов). Нет темпоральности и surfacing. **3/6 — не проходит.**
- **Почему почти-проходит:** есть multi-channel (документы + Telegram + голос), есть локальная модель — это шаг от «псевдо» к настоящему. Но cross-meeting memory нет.

### 3.4.4. Smart Enterprise Assistant (SEA) — sea-ai.ru

- **Что делает:** корпоративная база знаний с интеллектуальным помощником, в реестре РФ-ПО. RAG поверх PDF/Word/PowerPoint/Excel/Text/EML/MSG/RTF + ACL. Цитирует факты для проверки. Источник: [SEA — sea-ai.ru](https://sea-ai.ru/).
- **В реестре:** да.
- **Критерии:** 2 (саммари с цитатами), 3 (по структуре документов). **2/6 — не проходит.**

### 3.4.5. ELMA AI / ELMA365 KMS / ELMA Cortex

- **Что делает:** BPM/ECM + GigaChat/YandexGPT, поиск объектов в документах, сравнение, классификация. В зимнем релизе 2026 — платформа ELMA Cortex для корпоративных AI-агентов. Источники: [ELMA AI](https://elma365.com/ru/elma-ai/), [CSP.AI ELMA](https://elma365.com/ru/products/ecm/elma-ai/), [ELMA winter 2026](https://elma365.com/ru/news/2026-winter-release/), [ELMA365 KMS обзор](https://toolfox.ru/services/s/elma365), [ELMA SD AI trends 2026](https://service.elma365.com/webinars/sd-ai-trends-2026/).
- **В реестре:** да.
- **Критерии:** 1 (документы + BPM), 2 (саммари), 3 (по объектам). **3/6 — не проходит.**

### 3.4.6. Прочие KM-системы

| Продукт | Чем отличается | Источник |
|---|---|---|
| EvaWiki (EvaTeam) | Wiki-замена Confluence от 299 ₽/мес. AI-функций по сути нет. | [EvaWiki pricing](https://www.evateam.ru/evawiki/pricing/), [EvaTeam](https://www.evateam.ru/) |
| Yonote | Wiki + AI-блоки. | [Yonote](https://www.yonote.ru/) |
| Kaiten AI | Task tracker + AI-помощник по задачам. | [Kaiten AI](https://kaiten.ru/ai) |
| WEEEK | Workspace + базы знаний + CRM + AI. | [Список российских аналогов Notion — Cloud.ru blog](https://cloud.ru/blog/rossiyskiye-analogi-notion) |
| Gramax / Документерра | Tech docs + AI. | [Документерра vs Gramax](https://documenterra.ru/sravnenie/gramax/) |
| МойОфис Чат AI + Платформа AI | Workspace AI поверх MOST-документов. | [МойОфис Чат AI](https://myoffice.ru/new-products/chat-platform-AI/) |

Все — псевдо-«вторые мозги» (см. раздел 3.7).

---

## 3.5. Студии «знаниевые системы под ключ» — скрытые конкуренты

Если Z пойдёт в done-for-you (а это серьёзный путь для РФ, где enterprise часто хочет «привезите нам в чёрной коробке»), вот ~15 студий, которые уже это делают.

### 3.5.1. red_mad_robot (Москва)

- **Контакты:** [redmadrobot.ru](https://redmadrobot.ru/), [LinkedIn](https://ru.linkedin.com/company/redmadrobot-easterneurope).
- **Кейсы:** Билайн (DCD Design + Smarty), Билайн x daisy (нейрочат). Data Award 2026 победитель. RUWARD AWARD 2025.
- **Стек:** Smart Platform / Smarty / DCD Design / NDT (NeuralDeep Tech).
- **Цена внедрения:** не публикует, проектная. Внутренние инвестиции $2M в GenAI.
- **Подводный камень для Z:** имеет собственный продукт Smarty + инвест-портфель. Самый сильный соперник.

### 3.5.2. Just AI (Москва)

- **Контакты:** [just-ai.com](https://just-ai.com/).
- **Продукт:** Just AI Agent Platform (раздел 3.3.4) + JAICP + Aimylogic + Conversational Cloud. Источник: [Just AI Conversational Cloud docs](https://help.cloud.just-ai.com/en/aimylogic/), [Just AI Aimylogic — Bitrix24](https://www.bitrix24.ru/apps/app/justai.aimylogic/).
- **Кейсы:** не публикует чёткие, но партнёрство с Minerva через чатботы.
- **Цена внедрения:** open-source distribution бесплатно, enterprise — по запросу.
- **Подводный камень для Z:** **vendor-agnostic + open-source** — это серьёзный конкурент для self-host-стратегии Z.

### 3.5.3. Napoleon IT (Москва, Челябинск)

- **Контакты:** [napoleonit.ru](https://napoleonit.ru/llm/on-premise-llm).
- **Продукт:** Napoleon IT OnPremAI — платформа для on-prem LLM + мультимодальных баз знаний.
- **Цена:** проектная.

### 3.5.4. R77.ai (выпускники МФТИ)

- **Контакты:** [r77.ai](https://r77.ai/), Telegram-канал [@r77_ai](https://t.me/r77_ai).
- **Кейсы:** RAG-системы для бизнеса, разработка ИИ-агентов.
- **Цена:** проектная.
- **Особенность:** позиционируют себя как «выпускники МФТИ», академическая школа.

### 3.5.5. Технологика

- **Контакты:** [technologika.ru/rag-systems-with-ai](https://www.technologika.ru/rag-systems-with-ai).
- **Цена:** не публикуется, но рынок 200K–2M ₽ за корпоративный RAG.

### 3.5.6. LighTech

- **Контакты:** [thelightech.ru/services/sozdanie-rag-sistemy](https://thelightech.ru/services/sozdanie-rag-sistemy/), [thelightech.ru/services/razrabotka-rag-sistemy-dlya-biznesa](https://thelightech.ru/services/razrabotka-rag-sistemy-dlya-biznesa/).
- **Цена:** проектная, дорожная карта.

### 3.5.7. ARITIN

- **Контакты:** [aritin.ru/services/razrabotka_rag](https://aritin.ru/services/razrabotka_rag/).
- **Стек:** собственные LLM в российском контуре, RAG под ключ.

### 3.5.8. MadBrains

- **Контакты:** [madbrains.ru](https://madbrains.ru/), [madbrains.ru/services/ai-dlya-biznesa/rag](https://madbrains.ru/services/ai-dlya-biznesa/rag/).
- **Стек:** RAG + chatbot + LLM + CV + video analytics. 10+ лет, 65+ проектов.

### 3.5.9. Allsee.team

- **Контакты:** [allsee.team/services/razrabotka-ii-botov/razrabotka-ii-assistenta-s-rag](https://allsee.team/services/razrabotka-ii-botov/razrabotka-ii-assistenta-s-rag), [allsee.team/dlya-kompanij/rag-poisk](https://allsee.team/dlya-kompanij/rag-poisk).

### 3.5.10. VibeLab

- **Контакты:** [vibelab.ru/services/ai-rag-platforms](https://vibelab.ru/services/ai-rag-platforms/), [vibelab.ru](https://vibelab.ru/).
- **Особенность:** AI-студия 30+ человек для МСБ. На GigaChat и YandexGPT.

### 3.5.11. Cleverbots

- **Контакты:** [cleverbots.ru](https://cleverbots.ru/), [cleverbots.ru/generativnyj-iskusstvennyj-intellekt](https://cleverbots.ru/generativnyj-iskusstvennyj-intellekt/).
- **Цена:** от 100 000 ₽.

### 3.5.12. ZeBrains

- **Контакты:** [zebrains.ru/services/ai-digital-office](https://zebrains.ru/services/ai-digital-office/), [zebrains.ru/blog/multiagentnye-platformy-trend-2026-i-uroki-2025](https://zebrains.ru/blog/multiagentnye-platformy-trend-2026-i-uroki-2025/).
- **Продукт:** Цифровой офис ZeBrains AI — мультиагентная low-code платформа.

### 3.5.13. KT.team

- **Контакты:** [kt-team.ru/solutions/ai-for-business](https://www.kt-team.ru/solutions/ai-for-business), [kt-team.ru/product-pages/assistant-ai-business](https://www.kt-team.ru/product-pages/assistant-ai-business).
- **Продукт:** Assistant AI — корпоративный ИИ-ассистент для автоматизации процессов.

### 3.5.14. Secret Agents

- **Контакты:** [secret-agents.ru](https://secret-agents.ru/), [vc.ru: рейтинг AI-студий](https://vc.ru/dev/2744189-top-10-ai-studiy-rossii-luchshie-razrabotchiki-ii-resheniy).
- **Особенность:** работает с чувствительными данными без облака, полный цикл: IT-аудит → AI → BI.

### 3.5.15. Resolventa, Cognito, IT-Implant и другие

- [resolventagroup.ru/uslugi/razrabotka-ai-poiska](https://resolventagroup.ru/uslugi/razrabotka-ai-poiska)
- [cognito.ru/blog/rag-agent](https://cognito.ru/blog/rag-agent/)
- [it-implant.ru/vnedrenie-ii-v-biznes](https://it-implant.ru/vnedrenie-ii-v-biznes/) (от 3500 ₽/час)
- [duc-technologies.ru/vnedrenie-ii-dlya-biznesa](https://duc-technologies.ru/vnedrenie-ii-dlya-biznesa)
- [v-ai-labs.ru/blog/stoimost-vnedreniya-ai](https://v-ai-labs.ru/blog/stoimost-vnedreniya-ai)
- [softwarecenter.ru/solutions/ai_cost](https://softwarecenter.ru/solutions/ai_cost/) (от 100 000 ₽ за готовое решение)
- [evmapps.ru/ii-pod-klyuch](https://evmapps.ru/ii-pod-klyuch/)
- [veonix.ru/ai](https://veonix.ru/ai/) (от 100 000 ₽)
- [pixelplus.ru/razrabotka-sajtov/bazy-znaniy](https://pixelplus.ru/razrabotka-sajtov/bazy-znaniy/) (от 800 000 ₽ за систему управления знаниями)

### Сводная статистика по студиям

- **Найдено студий done-for-you:** 15+ только в Москве с публичным предложением RAG/AI под ключ. По данным Рейтинг Рунета — топ-34 агентств по внедрению ИИ. Источник: [Рейтинг Рунета AI development](https://ratingruneta.ru/ai-development/).
- **Ценовой диапазон рынка (2025–2026):**
  - Кастомный ассистент с обучением базы знаний — от 80 000 ₽.
  - AI-аналитика с CRM-подключением — от 100 000 ₽.
  - Готовые модули — от 100 000 ₽.
  - SaaS-старт для МСБ — 30 000–50 000 ₽.
  - Типовые RAG-решения — 200 000–300 000 ₽.
  - Кастомные ИИ-боты с RAG — 500 000–800 000 ₽.
  - Корпоративные системы с интеграцией — 1–2 млн ₽+.
  - Системы управления знаниями целиком — от 800 000 ₽.
  - Средняя разработка под ключ — 250 000–500 000 ₽ + 20–30 тыс./мес поддержка.

Источники: [vc.ru: стоимость внедрения ИИ в малый бизнес](https://vc.ru/ai/2925488-stoimost-vnedreniya-ii-v-malyj-biznes), [v-ai-labs.ru: стоимость внедрения](https://v-ai-labs.ru/blog/stoimost-vnedreniya-ai), [softwarecenter.ru](https://softwarecenter.ru/solutions/ai_cost/).

---

## 3.6. Open-source RU

### 3.6.1. ai-forever / Сбер

- **github.com/ai-forever** — официальная орг Сбера. Источник: [ai-forever org](https://github.com/ai-forever).
- **memory_aij2025** ([github.com/ai-forever/memory_aij2025](https://github.com/ai-forever/memory_aij2025)) — конкурсная задача и baseline по long-term memory для GigaChat. **Самый прямой open-source RU-проект про память LLM** (см. 3.2.1).
- **gigachat** ([github.com/ai-forever/gigachat](https://github.com/ai-forever/gigachat)) — API access library.
- **mcp_voice_salute** ([github.com/ai-forever/mcp_voice_salute](https://github.com/ai-forever/mcp_voice_salute)) — MCP-сервер для SaluteSpeech.
- **mcp_giga_checker** ([github.com/ai-forever/mcp_giga_checker](https://github.com/ai-forever/mcp_giga_checker)) — MCP-сервер для детектора AI-текста через GigaChat.
- **MERA benchmark** ([github.com/ai-forever/MERA](https://github.com/ai-forever/MERA)) — мультимодальный benchmark для русского.
- **ru-gpts**, **ru-clip**, **ru-dalle**, **rudalle-Malevich**, **model-zoo** — публичные русские модели.
- **Giga-Embeddings-instruct** ([huggingface.co/ai-sage/Giga-Embeddings-instruct](https://huggingface.co/ai-sage/Giga-Embeddings-instruct)) — SOTA-эмбеддинги на ruMTEB.

### 3.6.2. salute-developers

- **salute-speech** ([github.com/salute-developers/salute-speech](https://github.com/salute-developers/salute-speech)).
- **salute-speech-insights** ([github.com/salute-developers/salute-speech-insights](https://github.com/salute-developers/salute-speech-insights)).

### 3.6.3. IlyaGusev / Saiga

- **Saiga** ([github.com/IlyaGusev/saiga](https://github.com/IlyaGusev/saiga)) — training and data processing для русских LLM. Под капотом — file-tuning Llama 3 8B. Memory-проектов в экосистеме не обнаружено.

### 3.6.4. NeuralDeep (vakovalskii)

- **github.com/vakovalskii/neuraldeep** — агрегатор MCP-серверов под российские сервисы (1С, Битрикс, GigaChat, Yandex Tracker, Wildberries, ВкусВилл, Kubernetes, PostgreSQL). Источник: [NeuralDeep](https://neuraldeep.ru/), [NeuralDeep MCP](https://neuraldeep.ru/mcp), Telegram [@neuraldeep](https://t.me/neuraldeep).
- **Не «второй мозг» сам по себе**, но **критическая инфраструктура** для тех, кто его собирает: коннекторы под РФ-стек.

### 3.6.5. ru-rag

- **github.com/mpashkovskiy/ru-rag** — пример RAG-pipeline для русского языка. Источник: [ru-rag](https://github.com/mpashkovskiy/ru-rag).

### 3.6.6. Чего НЕ обнаружено

- **Российских открытых аналогов Mem0/Letta/Zep/Graphiti** — не обнаружено. Никто из РФ не переупаковывает их под русский с self-host из коробки.
- **Открытого продукта класса «личный второй мозг для русскоязычного знаниевого работника»** — не обнаружено. Личные Obsidian/Logseq-плагины с GigaChat есть в habr-кейсах (например, [Habr bothub: второй мозг на Obsidian + Claude Code](https://habr.com/ru/companies/bothub/articles/985736/)), но это hacks, не продукты.

---

## 3.7. Псевдо-«вторые мозги» — продукты с маркетингом, но не проходящие критерии

| Продукт | Маркетинг говорит | Что на самом деле | Почему не проходит |
|---|---|---|---|
| TEAMLY AI | «корпоративный мозг, без галлюцинаций» | RAG-чатбот поверх wiki | Capture однопоточный (только wiki); нет темпоральности; нет surfacing; нет memory-API |
| Minerva Knowledge / Copilot | «AI-ассистент знаний компании» | Semantic search + RAG-чатбот через Just AI/Chatmeai | То же |
| Авандок.ИИ Ассистент | «корпоративный мозг» | RAG + Telegram, документы | Есть multi-channel, но нет cross-meeting/temporal/surfacing |
| SEA (sea-ai.ru) | «корпоративная база знаний с интеллектуальным помощником» | RAG + ACL | Однопоточный capture, нет темпоральности |
| ELMA AI / ELMA Cortex | «AI для документов компании», агенты | RAG + BPM + workflow-агенты | Capture в одном контуре (документы ELMA), нет cross-channel и cross-temporal |
| EvaWiki | «база знаний компании» | Wiki + права + поиск | AI-фичи минимальны |
| Cloud.ru Корпоративная Wiki с AI | «база знаний с AI» | Managed RAG поверх object storage | Нет cross-meeting memory, нет API памяти отдельно от RAG |
| VK WorkSpace AI Ассистент | «виртуальный помощник» | Суммаризация writ-by-write (нужно отправить файл в бот) | Capture не активный — пользователь сам отдаёт файлы; нет графа сущностей |
| МойОфис Чат AI + Платформа AI | «корпоративный помощник» | Чат-LLM + поиск по MOST | То же |
| Mirapolis Digital Twin | «цифровой двойник сотрудника» | HR-данные + ML профиль | Не категория «второй мозг» — это HCM с предиктивной аналитикой |

Все эти продукты используют ту же терминологию, что и Granola/Glean/Mem.ai, но архитектурно это **enhanced KMS** (RAG-search над wiki), не **memory substrate**. См. анти-критерии в разделе 2 базового документа.

---

## 3.8. Карта пустых ниш в РФ

| Ниша | Статус в РФ | Игроки | Свободно для Z? |
|---|---|---|---|
| **Личный AI-«второй мозг» для русскоязычного знаниевого работника** | Пусто | На западе — Mem.ai, Reflect, Tana, Capacities; в РФ — никого. Только Obsidian-хаки через GigaChat на Habr. | **Полностью свободно**, но рынок узкий — это direct-to-consumer SaaS, в РФ тяжёлая монетизация |
| **Командный «второй мозг» для МСБ (10–100 чел.)** с capture из встреч + чатов + документов | Пусто полностью | mymeet/НаВстрече — только встречи. TEAMLY/Minerva — только wiki. Нет соединителя. | **Полностью свободно — главная ниша Z** |
| **Корпоративный «второй мозг» (100–1000+ чел.)** | Полу-пусто | red_mad_robot Smarty / DCD, MWS AI Agents Platform, GigaChat Enterprise + GigaMemory — близко, но не «второй мозг» полностью | Конкуренция с гигантами + студиями. Узкое окно через **специализацию на AI-встречах** |
| **Memory-as-API для других продуктов** | Полностью пусто | NeuralDeep делает MCP-каталог, но не саму память. На западе — Mem0 SaaS, Supermemory. В РФ — нет. | **Полностью свободно** — это потенциальный B2B2B-канал |
| **Done-for-you внедрение «второго мозга» под ключ** | Конкурентно | 15+ студий, но никто не специализируется именно на memory — все делают RAG-чатботы | Можно войти **специализацией: «второй мозг через AI-встречи»** |
| **AI-«второй мозг» для самозанятых / фрилансеров на русском** | Пусто | Никого в РФ. | Свободно, но монетизация низкая |
| **Personal AI memory для CEO / founder (RU MidCap)** | Пусто | alfred_/Bond/Xembly — INT. В РФ — никого. | Свободно, ниша из ниши 3 market-research-2026 |
| **Темпоральная память бизнес-сущностей (когда факт устарел)** | Пусто | Никто из 40+ продуктов не делает явно bitemporal | Если Z сделает первым — серьёзный USP |
| **«Спросить ушедшего сотрудника» (offboarding)** | Пусто полностью (см. market-research-2026) | Sensay/Viven — INT-only. Mirapolis Digital Twin профиль — это HCM, не «спросить» | Свободно полностью |
| **Корпоративный AI-стратегический советник для CEO** | Пусто (см. market-research-2026) | Visary BI, Форсайт, ICL Цифровой советник — для крупных enterprise | Свободно для МСБ |

**Где гиганты закрывают рынок:**
- Сбер закрывает enterprise через Caila + GigaChat Enterprise + GigaMemory.
- Яндекс — через Я 360 lock-in.
- МТС — через MWS AI Agents Platform on-prem с Cotype.
- VK — через VK WorkSpace AI Ассистент.

Все эти gиганты делают **memory-substrate / infrastructure**, не готовый «второй мозг» как UX-продукт. Их игроки используют их как фундамент — и это окно для Z.

---

## 3.9. Выводы для Z

### Прямые конкуренты в РФ (в категории «второй мозг компании»)

Полноценных прямых конкурентов **нет ни одного**. По формальным критериям ≥4/6 проходят:

1. **red_mad_robot Smart Platform / Smarty / DCD Design** — самый сильный кандидат, но это **студия с продуктом**, а не SaaS. Их главное оружие — done-for-you и кейс с Билайн. Если Z останется SaaS — они не прямой конкурент, они смежная категория.
2. **MWS AI Agents Platform + autoRAG + Cotype** — самый сильный **enterprise on-prem конкурент**. Но они нацелены на крупный бизнес и не делают «AI-встречи» как первичный capture.
3. **GigaChat Enterprise + GigaMemory** — конкурент-инфраструктура. Они дают substrate, поверх которого Z (и любой студией) можно собрать «второй мозг». Угроза: Сбер может выпустить готовый продукт в горизонте 12 месяцев.
4. **Just AI Agent Platform** — конкурент-платформа. Universal AI-агенты с памятью между сессиями. Угроза: разработчики Z-альтернатив выберут JAICP вместо self-host.

### Скрытые конкуренты в done-for-you

Если Z пойдёт в **«done-for-you внедрение второго мозга»** — конкуренция на этом поле:

- **15+ AI-студий**, делающих RAG-ассистентов под ключ (200K–2M ₽ за внедрение).
- **Лидер по узнаваемости** — red_mad_robot (Data Award 2026 + кейс Билайн + Smarty).
- **Сильные по архитектуре** — Just AI (Agent Platform), Napoleon IT (OnPremAI), Технологика, R77.ai.
- **Дешёвые/массовые** — Cleverbots, VibeLab, Allsee.team, IT-Implant.

**Угроза для Z в done-for-you:** студии **не специализируются на memory-as-product** — они делают «RAG под клиента». Если Z приходит с готовым **тиражируемым «вторым мозгом из встреч»** — у него преимущество тиража против штучного проектирования студий.

### Свободные ниши под Z

1. **Командный «второй мозг» для МСБ через AI-встречи + cross-meeting memory** — главное окно. Z уже делает первую часть (AI-встречи с типизированным саммари), вторую часть (cross-meeting memory) — никто в РФ.
2. **Темпоральная память бизнес-сущностей** — никто не делает явно bitemporal. Если Z первым добавит — серьёзный USP в demo и маркетинге.
3. **Memory-as-API для других продуктов** — открытая ниша, можно стать «Mem0 РФ» как side-product.
4. **«Спросить ушедшего» (offboarding)** — пусто. Возможна синергия с capture из AI-встреч (ушедший сотрудник = у нас уже есть его участие в N встречах).

### Угрозы со стороны гигантов

**По убыванию опасности:**

1. **Сбер (GigaChat Enterprise + GigaMemory + открытые веса)** — главная угроза. Темп очень высокий, открытые веса + Caila дают вертикальный стек для интеграторов. В 12–18 месяцев может выпустить готовый продукт «корпоративная память».
2. **МТС (MWS AI Agents Platform + Cotype)** — сильный on-prem конкурент. Закрывает крупный бизнес.
3. **VK (VK AI Space + WorkSpace AI Ассистент)** — угроза для МСБ-клиентов уже в VK WorkSpace. Перекрытие зоны capture (встречи + чаты + почта).
4. **Яндекс (Alice Pro + Я 360)** — угроза только для тех, кто уже на Я 360. Темп умеренный.
5. **Cloud.ru (Evolution AI Factory + Корпоративная Wiki с AI)** — инфраструктурный конкурент. Опасен дешевизной managed-варианта.

### Что значит это для стратегии Z

- **Не вступать в лобовую с гигантами на платформенном уровне.** Не строить «свою Caila» / «свою MWS AI Agents Platform». Вместо этого — **поверх их LLM собрать вертикальный продукт «второй мозг из встреч»**, который продаётся не как фреймворк, а как готовое решение.
- **USP против KMS** (TEAMLY/Minerva/Авандок): **«мы не wiki, мы помним встречи и видим связи между ними»**. Cross-meeting memory — это то, что они не сделают за горизонт ~12 месяцев (потому что у них нет capture-канала встреч).
- **USP против студий**: **«готовый продукт против штучного проектирования»** — Z тиражируем, студии — нет.
- **USP против гигантов**: **специализация на AI-встречах + типы встреч + отдельные дорожки + cross-meeting memory** — это вертикаль, в которую гигант не пойдёт пока размер ниши не вырастет.
- **Готовиться к экспорту в done-for-you**: иметь playbook внедрения для тех клиентов, кому нужна не SaaS, а «привезите чёрный ящик». Это второй revenue stream, на котором red_mad_robot уже делает деньги.

---

## Источники (≥35)

### Гиганты — Сбер / GigaChat
1. [Сбер: GigaChat Enterprise — Sberpress](https://www.sberbank.ru/ru/sberpress/all/article?newsID=d411da09-8097-467b-8b0a-e6419a402d96&blockID=1303&regionID=77&lang=ru&type=NEWS)
2. [GigaChat API — Sber Developers](https://developers.sber.ru/portal/products/gigachat-api)
3. [Сбер: GigaChat — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80:_GigaChat_(%D0%93%D0%B8%D0%B3%D0%B0%D0%A7%D0%B0%D1%82))
4. [Сбер представил большое обновление ГигаЧат — АиФ](https://aif.ru/techno/technology/personalnyy-ii-pomoshchnik-sber-predstavil-bolshoe-obnovlenie-gigachat)
5. [Сбер: масштабное обновление GigaChat — inhouse-marketing](https://news.inhouse-marketing.ru/2026/03/24/sber-predstavil-masshtabnoe-obnovlenie-gigachat/)
6. [Сбер: GigaChat Enterprise для ИИ-агентов — ixbt.pro](https://ixbt.pro/en/news/2026/03/03/sber-predstavil-korporativnuiu-platformu-gigachat-enterprise-dlia-sozdaniia-ii-agentov.html)
7. [Сбер представил ГигаЧат — Т-Банк инвестновость](https://www.tbank.ru/invest/social/profile/Sber_Official/9f1fc9cf-6067-4884-b048-126ef64ba6c7/)
8. [Сбер GigaChat 2 — Aitunnel](https://aitunnel.ru/providers/sber)
9. [Baikal24: AI Journey Contest 2025 итоги](https://baikal24.ru/text/24-11-2025/062/)
10. [github.com/ai-forever/memory_aij2025](https://github.com/ai-forever/memory_aij2025) — GigaMemory baseline и задача
11. [ai-forever org GitHub](https://github.com/ai-forever)
12. [GigaChat Family — arXiv](https://arxiv.org/html/2506.09440v1)

### Гиганты — Яндекс
13. [Alice Pro — Yandex 360](https://360.yandex.ru/business/alicepro/)
14. [Yandex Wiki — Yandex 360](https://360.yandex.com/business/wiki/)
15. [Anti-malware: Yandex 360 on-premises + Alice Pro](https://www.anti-malware.ru/analytics/Technology_Analysis/Yandex-360-on-premises-Alisa-Pro)
16. [YandexGPT 2026 review — mysummit.school](https://mysummit.school/blog/en/yandexgpt-review-2026/)
17. [JET & Yandex GPT Lab — Habr](https://habr.com/ru/companies/jetinfosystems/articles/956042/)
18. [DEV: AI-ассистент для wiki Яндекса с RAG и LangChain](https://dev.to/andrew_markhai_27ffd3a6b8/ai-assistient-dlia-dokumientatsii-iz-wiki-iandieksa-s-ispolzovaniiem-rag-i-langchain-1169)

### Гиганты — МТС / MWS AI
19. [MTS AI Cotype — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:MTS_AI:_Cotype_(%D0%91%D0%BE%D0%BB%D1%8C%D1%88%D0%B0%D1%8F_%D1%8F%D0%B7%D1%8B%D0%BA%D0%BE%D0%B2%D0%B0%D1%8F_%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C,_LLM))
20. [Ведомости: MWS AI Cotype для агентов](https://www.vedomosti.ru/technologies/new_technologies/news/2026/04/02/1187408-korporativnih-ii-agentov)
21. [CNews: MWS AI выпустила Cotype](https://www.cnews.ru/news/line/2026-04-02_mws_ai_vypustila_pervuyu_multimodalnuyu)
22. [mts.ai: MWS AI Agents Platform](https://mts.ai/product/ai-agents-platform/)
23. [MWS Octapi — mws.ru](https://mws.ru/dev-tools/octapi/)
24. [CNews: MWS Octapi на 30% ускоряет создание AI-агентов](https://www.cnews.ru/news/line/2026-01-30_mts_web_services_na_30_uskorila)
25. [MTS AI: ИИ-помощник для банковских сотрудников — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:MTS_AI_%D0%98%D0%98-%D0%BF%D0%BE%D0%BC%D0%BE%D1%89%D0%BD%D0%B8%D0%BA_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B0%D0%BD%D0%BA%D0%BE%D0%B2%D1%81%D0%BA%D0%B8%D1%85_%D1%81%D0%BE%D1%82%D1%80%D1%83%D0%B4%D0%BD%D0%B8%D0%BA%D0%BE%D0%B2)
26. [Forbes: МТС платформа для ИИ-агентов](https://www.forbes.ru/tekhnologii/551248-sredi-begusih-pervyh-net-i-otstausih-mts-zapustila-platformu-dla-ii-agentov)
27. [Forbes: МТС корпоративные ИИ-помощники](https://www.forbes.ru/tekhnologii/533813-agenty-vystraivautsa-v-linejku-mts-vypustit-na-rynok-korporativnyh-ii-pomosnikov)
28. [MTS AI кейсы внедрения](https://mts.ai/kejsy-vnedreniya-ii/)
29. [MTS AI Releases New Corporate AI Assistants](https://mts.ai/en/solutions/mws-ai-launches-corporate-ai-assistants-for-document-search-and-analytics/)

### Гиганты — VK / T-Bank / Cloud.ru / Касперский
30. [iot.ru: VK WorkSpace AI Ассистент](https://iot.ru/gadzhety/v-vk-workspace-poyavilsya-ai-assistent-virtualnyy-pomoshchnik-na-baze-generativnogo-ii)
31. [CNews: VK WorkSpace AI Ассистент](https://www.cnews.ru/news/line/2024-11-07_v_vk_workspace_poyavilsya_ai_assistent)
32. [VK AI Space — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:VK_AI_Space)
33. [CNews: VK Tech VK AI Space](https://www.cnews.ru/news/line/2026-04-30_vk_tech_predstavil_platformu)
34. [T-Bank AI: AI-powered FinTech](https://ai.tbank.ru/)
35. [T-Bank AI: Assistants](https://ai.tbank.ru/assistants/)
36. [Ведомости: T-Bank — первый ИИ-агент в Observability](https://www.vedomosti.ru/technologies/industries_and_markets/news/2026/05/20/1198439-t-bank-zapustit-pervogo)
37. [Cloud.ru: Корпоративная Wiki с AI](https://cloud.ru/solutions/korporativnaya-baza-znaniy-s-ai)
38. [Cloud.ru: Умный поиск с AI](https://cloud.ru/solutions/umniy-poisk-i-ai-pomoschnik)
39. [Cloud.ru: Evolution AI Factory](https://cloud.ru/products/evolution-ai-factory)
40. [Cloud.ru: Evolution AI Agents](https://cloud.ru/products/evolution-ai-agents)
41. [Habr: Cloud.ru RAG+Ragas](https://habr.com/ru/companies/cloud_ru/articles/966698/)
42. [Habr: Cloud.ru — облачные ассистенты и RAG](https://habr.com/ru/articles/941384/)
43. [Kaspersky Container Security AI](https://www.kaspersky.com/blog/cws-update-2026/55368/)
44. [Kaspersky Next + KIRA AI](https://www.kaspersky.com/about/press-releases/kaspersky-next-updates-its-all-in-one-soc-management-console-and-enhances-ai-functionality)

### KMS с AI (псевдо-«вторые мозги»)
45. [TEAMLY AI](https://teamly.ru/ai/)
46. [Habr: TEAMLY обновление 2026](https://habr.com/ru/companies/teamly/articles/1029618/)
47. [TEAMLY spring 2026](https://teamly.ru/spring_2026/)
48. [Minerva Knowledge — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:Minerva_Knowledge_(%D1%80%D0%B0%D0%BD%D0%B5%D0%B5_Minerva_KMS_%D0%B8_Naumen_KMS))
49. [Minerva AI knowledge base](https://minervasoft.ru/ai-baza-znanij)
50. [Minervasoft: обзор ИИ-ассистентов в России](https://minervasoft.ru/blog/tpost/728rl7j0f1-obzor-populyarnih-na-rossiiskom-rinke-ii)
51. [Avandoc AI Assistant](https://avandoc.ru/avandoc-ai/solutions/ai-assistant)
52. [Habr: КОРУС Авандок](https://habr.com/ru/companies/korus_consulting/articles/934992/)
53. [CNews: КОРУС Авандок релиз](https://www.cnews.ru/news/line/2025-12-15_korus_konsalting_vypustil)
54. [Smart Enterprise Assistant — sea-ai.ru](https://sea-ai.ru/)
55. [ELMA AI](https://elma365.com/ru/elma-ai/)
56. [ELMA CSP.AI](https://elma365.com/ru/products/ecm/elma-ai/)
57. [ELMA365 winter 2026](https://elma365.com/ru/news/2026-winter-release/)
58. [EvaWiki pricing](https://www.evateam.ru/evawiki/pricing/)
59. [EvaWiki — evateam.ru](https://www.evateam.ru/evawiki/)
60. [Документерра обзор](https://picktech.ru/product/dokumenterra/)
61. [Документерра vs Gramax](https://documenterra.ru/sravnenie/gramax/)
62. [Kaiten AI](https://kaiten.ru/ai)
63. [Yonote](https://www.yonote.ru/)
64. [МойОфис Чат AI + Платформа AI](https://myoffice.ru/new-products/chat-platform-AI/)
65. [Российские аналоги Notion — Cloud.ru blog](https://cloud.ru/blog/rossiyskiye-analogi-notion)
66. [vc.ru: топ-11 аналогов Notion](https://vc.ru/services/2687079-luchshie-analogi-notion-v-rossii)
67. [shtab.app: 14 аналогов Confluence 2026](https://shtab.app/blog/chiem-zamienit-confluence-v-rossii-ghaid-po-vyboru-korporativnoi-bazy-znanii/)

### Студии и интеграторы (done-for-you)
68. [red_mad_robot](https://redmadrobot.ru/)
69. [Smart Platform — rdl.redmadrobot.ru](http://rdl.redmadrobot.ru/)
70. [OSP: Билайн x red_mad_robot](https://www.osp.ru/articles/2026/0330/13060627)
71. [Beelinenow: ИИ-агенты Билайн x red_mad_robot](https://beelinenow.ru/articles/beeline-i-red-mad-robot-predstavili-ii-agentov/)
72. [Tadviser: Data Award 2026 Билайн x red_mad_robot](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%98%D0%98-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0_%D0%BE%D1%82_%D0%91%D0%B8%D0%BB%D0%B0%D0%B9%D0%BD%D0%B0_%D0%B8_red_mad_robot_%D0%B7%D0%B0%D0%B2%D0%BE%D0%B5%D0%B2%D0%B0%D0%BB%D0%B8_%D0%BD%D0%B0%D0%B3%D1%80%D0%B0%D0%B4%D1%83_Data_Award_2026)
73. [Kommersant: DCD Design](https://www.kommersant.ru/doc/8656358)
74. [Habr: red_mad_robot опенсорс-экосистема](https://habr.com/ru/articles/986828/)
75. [Forbes: red_mad_robot $2M в GenAI](https://www.forbes.ru/tekhnologii/498218-razrabotcik-cifrovyh-resenij-red-mad-robot-investiruet-2-mln-v-generativnyj-ii)
76. [Just AI](https://just-ai.com/)
77. [CNews: Just AI Agent Platform open distribution](https://www.cnews.ru/news/line/2026-04-22_just_ai_zapuskaet_otkrytyj_distributiv)
78. [Just AI Agent Platform — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:Just_AI_Agent_Platform_%D0%B4%D0%BB%D1%8F_%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B8_%D0%B8_%D1%83%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D1%8F_AI-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D0%B0%D0%BC%D0%B8)
79. [Just AI: сравнение RU AI-агент платформ 2026](https://just-ai.com/blog/sravnenie-rossijskih-platform-dlya-sozdaniya-ai-agentov)
80. [Napoleon IT OnPremAI](https://napoleonit.ru/llm/on-premise-llm)
81. [R77.ai](https://r77.ai/)
82. [R77.ai RAG](https://r77.ai/rag)
83. [Технологика RAG](https://www.technologika.ru/rag-systems-with-ai)
84. [LighTech RAG системы](https://thelightech.ru/services/sozdanie-rag-sistemy/)
85. [ARITIN RAG](https://aritin.ru/services/razrabotka_rag/)
86. [MadBrains AI для бизнеса](https://madbrains.ru/services/ai-dlya-biznesa/rag/)
87. [Allsee.team RAG](https://allsee.team/services/razrabotka-ii-botov/razrabotka-ii-assistenta-s-rag)
88. [VibeLab RAG платформы](https://vibelab.ru/services/ai-rag-platforms/)
89. [Cleverbots GenAI для бизнеса](https://cleverbots.ru/generativnyj-iskusstvennyj-intellekt/)
90. [ZeBrains Цифровой офис AI](https://zebrains.ru/services/ai-digital-office/)
91. [KT.team Assistant AI](https://www.kt-team.ru/product-pages/assistant-ai-business)
92. [Secret Agents](https://secret-agents.ru/)
93. [vc.ru: топ-11 AI-студий России 2025](https://vc.ru/dev/2744189-top-10-ai-studiy-rossii-luchshie-razrabotchiki-ii-resheniy)
94. [vc.ru: digital-агентства AI-разработки 2025-2026](https://vc.ru/digital/2663034-luchshie-digital-agentstva-po-ai-razrabotke-v-rossii)
95. [Рейтинг Рунета: топ-34 агентств по внедрению ИИ](https://ratingruneta.ru/ai-development/)
96. [vc.ru: стоимость внедрения ИИ в малый бизнес](https://vc.ru/ai/2925488-stoimost-vnedreniya-ii-v-malyj-biznes)
97. [vc.ru: топ-10 компаний по ИИ-автоматизации](https://vc.ru/services/2873629-top-kompaniy-po-ii-avtomatizatsii-v-rossii)
98. [softwarecenter: стоимость ИИ](https://softwarecenter.ru/solutions/ai_cost/)

### Open-source RU
99. [github.com/ai-forever/gigachat](https://github.com/ai-forever/gigachat)
100. [github.com/ai-forever/mcp_voice_salute](https://github.com/ai-forever/mcp_voice_salute)
101. [github.com/ai-forever/mcp_giga_checker](https://github.com/ai-forever/mcp_giga_checker)
102. [github.com/ai-forever/MERA](https://github.com/ai-forever/MERA)
103. [github.com/salute-developers/salute-speech](https://github.com/salute-developers/salute-speech)
104. [github.com/IlyaGusev/saiga](https://github.com/IlyaGusev/saiga)
105. [NeuralDeep — neuraldeep.ru](https://neuraldeep.ru/)
106. [github.com/vakovalskii/neuraldeep](https://github.com/vakovalskii/neuraldeep)
107. [NeuralDeep MCP servers](https://neuraldeep.ru/mcp)
108. [github.com/mpashkovskiy/ru-rag](https://github.com/mpashkovskiy/ru-rag)
109. [huggingface.co/ai-sage/Giga-Embeddings-instruct](https://huggingface.co/ai-sage/Giga-Embeddings-instruct)

### Habr / vc.ru / Tadviser / CNews — концепты и обзоры
110. [Habr: Второй мозг строят все. Но большинство — не для себя](https://habr.com/ru/articles/1031112/)
111. [Habr: Второй мозг и LLM-Wiki](https://habr.com/ru/articles/1031970/)
112. [Habr (bothub): Второй мозг через Obsidian + Claude Code](https://habr.com/ru/companies/bothub/articles/985736/)
113. [Habr: Корпоративная память против галлюцинаций (RAG)](https://habr.com/ru/amp/publications/1032136/)
114. [Habr: Как заставить AI-ассистента работать с базой знаний в enterprise](https://habr.com/ru/articles/923490/)
115. [Habr: GraphRAG AI-ассистент для Жилкодекса РФ](https://habr.com/ru/articles/935468/)
116. [Habr: корпоративный RAG-ассистент (Runity)](https://habr.com/ru/companies/runity/articles/1014712/)
117. [Habr: Создание корпоративной базы знаний для LLM](https://habr.com/ru/articles/974992/)
118. [Habr: ИИ в ITSM 2026 (SimpleOne)](https://habr.com/ru/companies/simpleone/articles/1021836/)
119. [CNews: ИИ-ассистенты для бизнеса 2026](https://www.cnews.ru/projects/2026/aiassistants_2026)
120. [CNews market: ИИ-ассистенты 2026 — как создать ИИ-эксперта](https://market.cnews.ru/articles/2026-02-11_kak_sozdat_korporativnogo_ii-eksperta)
121. [Ведомости: AI-ассистенты нового поколения](https://www.vedomosti.ru/press_releases/2025/11/25/ai-assistenti-novogo-pokoleniya-konkurentsiya-mezhdu-korporativnimi-i-personalnimi-agentami)
122. [vc.ru: AI-ассистенты для бизнеса — стоимость 2026](https://vc.ru/id1175613/2832067-ai-assistenty-dlya-biznesa-vozmozhnosti-i-stoimost-v-2026-godu)
123. [vc.ru: Российские нейросети 2026](https://vc.ru/ai/2733649-rossiyskie-neuroseti-2026-modeli-i-servisy-dlya-biznesa)
124. [tproger: российские ИИ-инструменты 2026](https://tproger.ru/articles/rossijskie-ii-instrumenty--kotorye-sovetuem-zatestit-v-2026)
125. [Habr: Цифровая копия сотрудника](https://habr.com/ru/articles/1026998/)
126. [CNews: Импортозамещение, AI и цифровые двойники](https://www.cnews.ru/articles/2025-12-01_importozameshchenieai_i_tsifrovye_dvojniki)
127. [Mirapolis: цифровой двойник сотрудника](https://www.mirapolis.ru/blog/cifrovoy-dvoynik-sotrudnikov/)
128. [vc.ru: Colleague Skill — оцифровка коллег (контекст)](https://vc.ru/ai/2853675-otsifrovka-kolleg-dlya-ii-proekt-colleague-skill-v-kitae)
129. [ICT.Moscow: AI](https://ict.moscow/projects/ai/)
130. [OpenTalks.AI 2026 расписание](https://opentalks.ai/ru/timetable)
131. [Skolkovo AI](https://ai.sk.ru/)

### Реестр Минцифры
132. [reestr.digital.gov.ru — реестр российского ПО](https://reestr.digital.gov.ru/reestr/)
133. [Каталог российского ПО — каталог-по.рф](https://xn--80aajzhsbhw.xn--p1ai/)
134. [Tadviser: реестр отечественного ПО](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%A0%D0%B5%D0%B5%D1%81%D1%82%D1%80_%D0%BE%D1%82%D0%B5%D1%87%D0%B5%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D0%BE%D0%B3%D0%BE_%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%BD%D0%BE%D0%B3%D0%BE_%D0%BE%D0%B1%D0%B5%D1%81%D0%BF%D0%B5%D1%87%D0%B5%D0%BD%D0%B8%D1%8F)

### Кактус.AI / AI-ОФИС / Кейсы внедрения
135. [Кактус.AI платформа](https://kkts.ai/platform)
136. [AI-ОФИС aiworkplace.ru](https://aiworkplace.ru/)
137. [SaluteSpeech — Tadviser](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80_SaluteSpeech_(SmartSpeech))
138. [SaluteSpeech docs](https://developers.sber.ru/docs/ru/salutespeech/overview)
139. [SL Soft: On-Premise ИИ в контуре компании](https://slsoft.ru/news/on-premise-ii-kak-poluchit-vse-preimushchestva-iskusstvennogo-intellekta-v-konture-kompanii/)
140. [redmadrobot.ru: Smarty case](https://redmadrobot.ru/czifrovye-servisy/kak-my-sdelali-bazu-znanij-smarty-na-osnove-rag)
141. [Onboarding c AI-ассистентом — vc.ru](https://vc.ru/hr/2855393-onboarding-s-ai-assistentom)

---

_Документ создан 2026-05-20 агентом Branch-3 (RU market). Раздел 7 базового документа `second-brain-approach-research.md` теперь имеет агентский материал. Перенос ключевых выводов в раздел 13–14 базового документа — задача синтеза._

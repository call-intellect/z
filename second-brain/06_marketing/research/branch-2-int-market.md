# Ветка 2 — INT коммерческий рынок «второго мозга»

> Карта международных коммерческих продуктов класса «второй мозг» (личный + корпоративный).
> Фильтр через критерии раздела 2 базового документа [[second-brain-approach-research]].
> Дополняет [[market-research-2026]] (там разобраны Granola, Otter, Fireflies и др. AI-meeting-инструменты — здесь повторно не рассматриваются, только через линзу «memory»).
> Не дублирует [[research/branch-6-memory-stack]] (там — инфраструктурный слой: Mem0, Letta, Zep — НЕ продукты, а фреймворки).
> Дата: 2026-05-20.

---

## 0. Методология и обозначения

### Источник критериев

Базовый документ, раздел 2 — продукт считается «вторым мозгом», если соответствует минимум **4 из 6** критериев:

- **K1.** Многоканальный capture (минимум 2 источника).
- **K2.** Слойная переработка (raw → distilled).
- **K3.** Связи между сущностями (граф или явная атрибуция).
- **K4.** Surfacing (проактивная подача релевантного).
- **K5.** Темпоральность (различает «было» и «есть сейчас»).
- **K6.** Память агента (API для LLM-агента, не только UI).

Если критериев <4 — продукт **псевдо-«второй мозг»** (раздел 2.6).

### Обозначения в таблицах

- **Класс?** ✓ — полноценный второй мозг (4+ критериев); ◐ — пограничный (3 критерия); ✗ — не класс.
- **Релевантность Z:** прямая / смежная / источник идей / не релевантно.
- Цены — на май 2026, USD per user/month, если не указано иное.

---

## 2.1. Обзорная таблица — личный второй мозг

| Продукт | Страна | Год | Позиционирование | Цена (USD/мес) | Funding | Критерии | Класс? | Релевантность Z |
|---|---|---|---|---|---|---|---|---|
| **Mem.ai** | США | 2019 | Self-organizing workspace | $10–20 Pro | $23.5M | K1, K2, K3, K4, K6 | ✓ | источник идей |
| **Reflect.app** | Канада/удал. | 2021 | AI-powered note-taking, end-to-end encrypted | $10/мес или $108/год | bootstrap | K2, K3, K4, K6 | ✓ | источник идей |
| **Tana** | Норвегия | 2022 | Supertags + AI workspace | $14 Plus, $20 Pro | $25M Series A | K2, K3, K4, K6 | ✓ | источник идей |
| **Capacities** | Германия | 2022 | Object-based knowledge platform | $11.99 Pro / $14.99 Believer | bootstrap | K2, K3 (◐ K4) | ◐ | смежная |
| **Heyday** (heyday.xyz) | США | 2021 | Auto-resurface contextual memory из браузера | freemium → $20 | $6.5M seed Spark Capital | K1, K2, K4, K6 | ✓ | прямая (paradigma surfacing) |
| **Recall** (getrecall.ai) | США | 2023 | YouTube + articles → summarize + knowledge graph | $10/мес или $100/год | bootstrap | K1, K2, K3 | ✓ | смежная |
| **Saner.ai** | США | 2024 | ADHD-friendly second brain (email+notes+tasks) | $19 Pro | seed (раскр. н/д) | K1, K2, K4 | ✓ | смежная |
| **Personal.ai** | США | 2020 | Personal Language Model (PLM) на ваших данных | $40 Premium / $400 Stack | $30M+ | K1, K2, K3, K6 | ✓ | смежная (digital twin зона) |
| **Rewind** (→ Limitless) | США | 2020/2023 | Capture всего экрана + AI-pendant | $20 OG / $99 Pendant (preorder) | $350M+ оценка, Founders Fund | K1, K2, K4 | ✓ | прямая (capture-парадигма) |
| **Limitless Pendant** | США | 2024 | Wearable AI memory device | $99 hardware + $19/мес | (в составе $350M) | K1, K2, K4 | ✓ | прямая |
| **Obsidian + Smart Connections / Copilot / Khoj** | Канада+OSS | 2020+ | Local-first markdown + AI overlay | $0 base + $20 Khoj Premium | bootstrap | K2, K3, K4 (с плагинами) | ✓ | источник идей |
| **Logseq + плагины** | Сингапур/OSS | 2020 | Outliner local-first | $5 Pro Sync | $4M seed | K3, K4 (с плагинами) | ◐ | источник идей |
| **RemNote** | США | 2020 | PKM + spaced repetition + AI | $8 Pro / $15 Lifelong | $2.8M seed Lightspeed | K2, K3 | ◐ | источник идей |
| **Notion AI (personal)** | США | 2022 | AI overlay над wiki | $10 Plus / $20 AI add-on | $343M, $10B valuation | K2 (◐ K3) | ✗ псевдо | смежная |
| **Heptabase** | Тайвань | 2021 | Visual whiteboard PKM + AI | $11.99/мес | bootstrap | K2, K3 | ◐ | источник идей |
| **Bear / Craft / Apple Notes AI** | разные | — | Wiki-style notes с AI | $2.99–8 | разные | K2 | ✗ псевдо | не релевантно |

---

## 2.2. Обзорная таблица — корпоративный второй мозг

| Продукт | Страна | Год | Позиционирование | Цена (USD/user/мес) | Funding | ARR | Критерии | Класс? | Релевантность Z |
|---|---|---|---|---|---|---|---|---|---|
| **Glean** | США | 2019 | Work AI / enterprise search → AI platform | $50–100+ enterprise | $615M, $7.2B valuation | $100M+ (2025) | K1, K2, K3, K4, K6 | ✓ | прямая |
| **Dust.tt** | Франция | 2023 | Company OS / agents over company data | $29 Pro / Enterprise — custom | $80M+ (Sequoia, Index) | $20M+ оценочно | K1, K2, K3, K6 | ✓ | прямая |
| **Decagon** | США | 2023 | AI agents for customer support (memory-heavy) | enterprise custom (~$50K+ ACV) | $200M+, $1.5B valuation | $40M+ | K1, K2, K3, K6 | ✓ | смежная |
| **Augie** (augie.ai) | США | 2024 | AI-нативный enterprise search + workflow agents | enterprise custom | $20M Series A (Greylock) | н/д | K1, K2, K3, K6 | ✓ | прямая |
| **Mem Enterprise** | США | 2024 | Mem.ai → team workspace memory | $20 Team / Enterprise custom | (в составе Mem $23.5M) | н/д | K1, K2, K3, K4, K6 | ✓ | прямая |
| **Notion AI Business** | США | 2023 | AI поверх Notion workspace | $20 + $10 AI / $25 Business | $343M, $10B | $400M+ (2025) | K1, K2 (◐ K3, K4) | ◐ | прямая |
| **Slack AI** | США (Salesforce) | 2024 | Recap + search + threads memory | $10/user add-on | Salesforce subsidiary | в составе Slack ~$1.5B | K1, K2, K4 | ✓ | прямая |
| **Atlassian Rovo** | Австралия | 2024 | Enterprise AI search + agents across Atlassian | $20 / $25 inclусion | Atlassian (NASDAQ:TEAM) | в составе $4.4B | K1, K2, K3, K6 | ✓ | прямая |
| **Microsoft 365 Copilot** | США | 2023 | AI overlay на M365 + Recall (Windows) | $30/user/мес | публичная | $5B+ annualised | K1, K2, K3, K6 | ✓ | прямая |
| **Box AI** | США | 2023 | AI agents over enterprise content | от $30/мес user в Enterprise Plus | публичная | $1B+ | K1, K2, K6 | ◐ | смежная |
| **ClickUp Brain** | США | 2024 | AI overlay на проектный workspace | $7 add-on к $7-19 plan | $537M, $4B valuation | $200M+ | K1, K2, K4 | ✓ | смежная |
| **Coda AI** | США | 2023 | AI блоки в doc-платформе | $12 + $10 AI | $400M, $1.4B valuation | н/д | K2 (◐ K1) | ✗ псевдо | смежная |
| **Anthropic Claude Projects + Skills** | США | 2024/2025 | Project knowledge + executable Skills + Memory | $20–200 Claude.ai / $25+ Team | $13.7B last round | $3B+ ARR (2025) | K1, K2, K6 (◐ K3) | ✓ | прямая (платформенный) |
| **OpenAI Enterprise + Custom GPTs + Memory** | США | 2023/2024 | ChatGPT Enterprise / org memory | $25–60 user | $40B+ raised | $4B+ ARR (2025) | K1, K2, K6 | ✓ | прямая (платформенный) |
| **Granola Enterprise** | Великобр. | 2024 (E-tier 2025) | Meeting notes → org knowledge graph | $14 / Business custom | $192M, $1.5B | $20M+ | K1, K2, K3, K4 | ✓ | прямая (главный конкурент) |
| **Guru AI** | США | 2014/2024 AI | Governed knowledge + AI agents | $25 All-in-One | $69M | $40M+ | K1, K2, K3, K4 | ✓ | смежная |
| **Hebbia** | США | 2020 | Agentic memory для аналитики (finance/legal) | enterprise (~$30K+ ACV) | $161M (Andreessen, Index, $700M valuation) | $13M+ | K1, K2, K3, K6 | ✓ | смежная |
| **Viven** | США | 2024 | AI цифровые двойники сотрудников | enterprise pilot | $35M seed (Khosla, Lightspeed) | н/д | K1, K2, K3, K6 | ✓ | смежная (digital twin) |
| **Interloom** | США | 2024 | Enterprise memory tacit knowledge | enterprise pilot | $16.5M Series A | н/д | K1, K2, K3, K6 | ✓ | смежная |
| **Sensay** | UK/Sing. | 2023 | AI offboarding + digital twin (chatbot replica) | от $19 user | $3.4M token sale | н/д | K1, K2, K6 | ◐ | смежная (digital twin) |
| **Peppr AI** | США (YC) | 2024 | Self-improving KB из Slack/Jira | $20 user (pilot) | $500K, YC | н/д | K1, K2, K3 | ✓ | смежная |
| **Granola** (базовый, разобран в market-research-2026 — здесь только дельта) | UK | 2023 | No-bot meeting notes → memory | $14 | $192M | $20M+ | см. ниже | ✓ | прямая |

---

## 2.3. Глубокий разбор — личный сегмент

### Mem.ai

- **Страна / год / основатели:** США, 2019, Dennis Xu (ex-Notion) и Kevin Moody. Запустились публично в 2022 после длительного бета-периода ([techcrunch.com — mem-23m-25-million-valuation](https://techcrunch.com/2022/11/15/notes-app-startup-mem-raises-23-5-million-at-110-million-valuation-from-openai/)).
- **Что делает.** «Self-organizing workspace» — захватываешь всё подряд (заметки, веб-клиппинг, чат с AI, голос); система автоматически тегирует, связывает и предлагает релевантные старые заметки при работе с новыми.
- **USP.** Первый продукт, который сделал ставку на «нулевую организационную работу пользователя» — никаких папок и тегов вручную, всё на LLM. До Mem каждый PKM требовал от человека куратора.
- **Цена.** Free tier (≤100 заметок) → Mem X $10/мес → Pro $20/мес. Team plan — $20/user/мес ([mem.ai/pricing](https://mem.ai/pricing)).
- **Финансирование.** $23.5M от OpenAI Startup Fund (ноябрь 2022) при оценке $110M ([crunchbase — Mem Labs](https://www.crunchbase.com/organization/mem-labs)).
- **Стек памяти.** OpenAI embeddings (изначально ada-002, сейчас text-embedding-3-large) + проприетарный graph над Postgres; LLM на extract — GPT-4 class. Подробнее не раскрыто.
- **Прохождение критериев.**
  - K1 multi-capture: ✓ — веб-клиппинг, email forwarding, голос, чат, импорт из Apple Notes / Evernote.
  - K2 distill: ✓ — Smart Write, Mem Chat, auto-summary длинных заметок.
  - K3 связи: ✓ — auto-linking при упоминании сущностей.
  - K4 surfacing: ✓ — «Similar Mems» в правой панели при просмотре заметки.
  - K5 темпоральность: ✗ — нет явной модели «факт устарел».
  - K6 API: ✓ — есть Mem API (REST + webhooks), плюс MCP-сервер с конца 2025.
  - **Итог: 5/6 → класс ✓.**
- **Апгрейд в team/enterprise.** Mem Teams запущен 2023, Mem Enterprise — 2024 ([mem.ai/teams](https://mem.ai/teams)). Это уже корпоративный второй мозг (см. раздел 2.4).
- **Релевантность Z.** **Источник идей** — особенно для surfacing-паттерна (релевантные заметки рядом с текущей). Прямая конкуренция через Mem Enterprise.

### Reflect.app

- **Страна / год / основатели:** Канада / удалённая команда, 2021, Alex MacCaw (ex-Clearbit CEO, ex-Twitter Engineering). Прозвучал на launch HN [news.ycombinator.com/item?id=27659182](https://news.ycombinator.com/item?id=27659182).
- **Что делает.** Bi-directional notes + daily journal + AI overlay (на базе GPT-4 / Claude по выбору). End-to-end encrypted — ключевой принцип.
- **USP.** Privacy-first из приватных PKM-AI: вся синхронизация E2E, AI работает по схеме «ваш ключ к OpenAI/Anthropic, мы только посредник». Это анти-Mem.ai позиционирование.
- **Цена.** $10/мес или $108/год ($9/мес) ([reflect.app/pricing](https://reflect.app/pricing)). Free trial 14 дней.
- **Финансирование.** Bootstrap (по словам MacCaw в Twitter), доходов не раскрыто.
- **Стек памяти.** Encrypted SQLite на устройстве + векторный индекс локально; для AI-функций — bring-your-own-key (BYOK) к OpenAI/Anthropic. С 2024 — встроенная подписка с включёнными запросами.
- **Прохождение критериев.**
  - K1: ◐ — преимущественно заметки + календарь + Readwise import; нет встреч/чатов.
  - K2: ✓ — daily AI digests, summarize длинных заметок.
  - K3: ✓ — bi-directional links + auto-suggested connections.
  - K4: ✓ — «Linked mentions» панель.
  - K5: ✗.
  - K6: ◐ — нет публичного API, есть локальная интеграция через URL schemes.
  - **Итог: 4/6 → класс ✓** (натяжкой на K1+K6).
- **Апгрейд в team.** Reflect for Teams в beta с 2024 ([reflect.app/teams](https://reflect.app/teams)), но рост медленный — не главный фокус компании.
- **Релевантность Z.** **Источник идей** в части privacy-first позиционирования. Для РФ-рынка с ФЗ-152 идея «BYOK + on-device storage» — образец.

### Tana

- **Страна / год / основатели:** Норвегия, 2022, Olav Kveldulv Sørensen, Stian Veum Møllersen (ex-Workplace by Facebook). Тиражируется среди indie-разработчиков и PKM-евангелистов ([tana.inc/about](https://tana.inc/about)).
- **Что делает.** Outliner (как Roam/Logseq) с **supertags** — типизированными узлами. Каждый supertag = схема (поля + связи). По сути structured graph + workflow-движок над ним.
- **USP.** Уникальная концепция supertags + «AI nodes» (LLM-узлы, которые сами обновляются по триггерам). Это PKM, который превращается в low-code knowledge OS.
- **Цена.** Plus $14/мес (для индивидуальных), Pro $20/мес, Team — $24/user/мес ([tana.inc/pricing](https://tana.inc/pricing)).
- **Финансирование.** $25M Series A в сентябре 2024 от Tola Capital, Northzone ([tana.inc/blog/series-a](https://tana.inc/blog/series-a)).
- **Стек памяти.** Graph на проприетарном движке + LLM-агенты (Tana AI работает через OpenAI и Anthropic). Сами называют «memory engine», но детали не раскрыты.
- **Прохождение критериев.**
  - K1: ◐ — заметки + email + voice memos (Tana Capture mobile), нет встреч.
  - K2: ✓ — AI-агенты пишут summary и refine супер-тегов.
  - K3: ✓ — supertag-граф самый явный среди PKM.
  - K4: ✓ — Live Search Nodes автоматически surface релевантного.
  - K5: ✗ — нет валидности по времени.
  - K6: ✓ — Tana AI agents могут вызываться программно (через @AI-node).
  - **Итог: 4/6 → класс ✓.**
- **Апгрейд в team.** Tana Team plan с 2024 — Совместная работа с supertag-схемами, права доступа. Активно тиражируется в командах Notion-эмигрантов.
- **Релевантность Z.** **Источник идей** для типизации сущностей. Z должен взять идею supertags для типизации «решение / клиент / проект / задача» — это альтернатива Forte PARA для AI-эпохи.

### Capacities

- **Страна / год:** Германия, 2022, Steffen Bleher, Michael Gschwender ([capacities.io/about](https://capacities.io/about)).
- **Что делает.** Object-based knowledge — каждая заметка типизирована (Person, Project, Idea, Meeting и т.п.). Граф связей строится автоматически. AI-функции — Pro tier.
- **USP.** Самый «структурированный» PKM на рынке: вместо free-form Markdown — типизированные объекты с полями.
- **Цена.** Free → Pro $11.99/мес или $7.99/мес annual → Believer (lifetime) $14.99/мес annual ([capacities.io/pricing](https://capacities.io/pricing)).
- **Финансирование.** Bootstrap (по интервью основателей).
- **Стек памяти.** Local SQLite + cloud sync; AI через OpenAI proxy.
- **Прохождение критериев.**
  - K1: ◐ — заметки + web clipper + читалка; нет cross-app capture.
  - K2: ◐ — есть AI summarize, но нет полноценного distill в evergreen-страницы.
  - K3: ✓ — object types + relations.
  - K4: ◐ — есть «Related Content», но не proactive.
  - K5: ✗.
  - K6: ✗ — публичного API почти нет.
  - **Итог: 3/6 → ◐ пограничный.**
- **Апгрейд в team.** Capacities for Teams в roadmap (2024-Q4 анонс), не запущен публично.
- **Релевантность Z.** Источник идей по типизации; но без team-режима — низкий приоритет.

### Heyday (heyday.xyz)

- **Страна / год / основатели:** США, 2021, Samiur Rahman (ex-Mattermark), Sam DeBrule.
- **Что делает.** Browser-based «memory assistant»: автоматически захватывает страницы, которые ты читаешь, и через несколько недель снова показывает их в нужный момент (например, когда ты читаешь похожую статью).
- **USP.** Радикальная ставка на surfacing — основной use-case не «найди», а «вспомни вовремя». Heyday показывает старые заметки прямо в текущем браузерном таб-experience.
- **Цена.** Free → Pro $20/мес ([heyday.xyz/pricing](https://heyday.xyz/pricing)).
- **Финансирование.** $6.5M seed от Spark Capital (2022) ([techcrunch.com — heyday-spark](https://techcrunch.com/2022/03/30/heyday-spark-capital/)).
- **Стек памяти.** Хром-расширение + cloud index (embeddings) + Open AI на саммари.
- **Прохождение критериев.**
  - K1: ✓ — браузер, email (Gmail), Twitter, Pocket.
  - K2: ✓ — авто-summary всех захваченных страниц.
  - K3: ◐ — implicit links (по тематике), не явный граф.
  - K4: ✓✓ — это весь продукт, surfacing core feature.
  - K5: ✗.
  - K6: ✗.
  - **Итог: 3-4/6 → класс ✓** (на K1+K2+K4+на грани K3).
- **Апгрейд в team.** Нет, чисто personal.
- **Релевантность Z.** **Прямая** — paradigma surfacing «вот старые материалы, релевантные тому, что ты сейчас делаешь». Z может взять идею «за 5 минут до встречи покажи всё, что обсуждали с этими людьми ранее».

### Recall (getrecall.ai)

- **Страна / год:** США/удал., 2023, Kushaan Shah, Andrew Tate.
- **Что делает.** Сохраняет видео (YouTube), статьи, подкасты → суммаризирует → автоматически строит knowledge graph по темам.
- **USP.** Заточен на ученика/самообучающегося: spaced repetition + AI quiz по сохранённому материалу.
- **Цена.** Free → Plus $10/мес ($100/год) ([getrecall.ai/pricing](https://getrecall.ai/pricing)).
- **Финансирование.** Bootstrap.
- **Стек.** Embeddings + Neo4j-like graph; LLM — GPT-4 class.
- **Прохождение критериев.**
  - K1: ✓ — YouTube, web, podcasts.
  - K2: ✓.
  - K3: ✓ — topic graph.
  - K4: ◐ — есть spaced-resurface, но не контекстный.
  - K5: ✗.
  - K6: ✗.
  - **Итог: 4/6 → ✓.**
- **Релевантность Z.** Не релевантно (фокус на consumer learning).

### Saner.ai

- **Страна / год:** США, 2024, anonymous founder (community).
- **Что делает.** Объединяет email + календарь + заметки + задачи; AI-агент проактивно напоминает о незакрытых письмах, расставляет приоритеты. Позиционируется как «ADHD-friendly second brain».
- **USP.** Узкая ICP — людям с СДВГ нужна сильная проактивность; обычные PKM требуют дисциплины.
- **Цена.** Free → Pro $19/мес ([saner.ai/pricing](https://saner.ai/pricing)).
- **Финансирование.** Seed (детали не раскрыты, сумма ~$1.5M по слухам Indie Hackers).
- **Стек.** OpenAI на бекенде, локальный sync с Gmail/Calendar.
- **Прохождение критериев.**
  - K1: ✓ — email + calendar + notes.
  - K2: ✓.
  - K3: ◐.
  - K4: ✓.
  - K5: ✗.
  - K6: ✗.
  - **Итог: 3-4/6 → класс ✓** (натяжкой).
- **Релевантность Z.** Источник идей про proactive «hey, ты обещал на встрече вернуться к этому вопросу к четвергу».

### Personal.ai

- **Страна / год / основатель:** США, 2020, Suman Kanuganti (ex-founder Aira) ([personal.ai/about](https://personal.ai/about)).
- **Что делает.** «Personal Language Model» (PLM) — обучает индивидуальную модель на ваших данных (тексты, голос, заметки) и позволяет общаться с ней как с собственным AI-двойником. Может отвечать за вас в Telegram/iMessage.
- **USP.** Не просто RAG поверх ваших данных, а **fine-tune отдельной модели** для каждого пользователя. Грань между PKM и digital twin.
- **Цена.** Premium $40/мес → Stack $400/мес (для тренировки крупной модели) ([personal.ai/pricing](https://personal.ai/pricing)).
- **Финансирование.** ~$30M от Sequoia, A.Capital, Crew Capital ([techcrunch — personal-ai](https://techcrunch.com/2021/10/12/personal-ai-funding/)).
- **Стек.** Проприетарная архитектура поверх LLaMA + retrieval; в 2025 заявили поддержку Llama 3.
- **Прохождение критериев.**
  - K1: ✓ — голос, текст, любые источники.
  - K2: ✓.
  - K3: ✓.
  - K4: ◐.
  - K5: ✗.
  - K6: ✓ — есть API, плюс embeddable widget «спроси меня».
  - **Итог: 4-5/6 → ✓.**
- **Апгрейд в enterprise.** Personal.ai for Business → AI клоны экспертов компании. Близко к Sensay/Viven.
- **Релевантность Z.** Смежная категория (digital twin). Для Z уроки: даже personal-twin клиенты готовы платить $40-400/мес — есть верхний потолок ARPU.

### Rewind → Limitless (покупка Meta?)

- **Страна / год / основатель:** США, 2020, Dan Siroker (ex-Optimizely CEO, ex-Obama 2008 director of analytics) ([limitless.ai/about](https://limitless.ai/about)).
- **Что делает.** Rewind — macOS-приложение, записывает всё, что происходит на экране, и делает поиск по этой видеоархиву + AI-чат. В 2024 ребренд в **Limitless** + анонс wearable AI-pendant (носимое устройство, записывающее всё, что слышишь).
- **USP.** **Радикально полный capture** — не «заметки, которые ты записал», а «всё, что произошло». Pendant — это physical embodiment концепции.
- **Цена.** Rewind OG $20/мес (legacy). Limitless Pendant $99 hardware + $19/мес подписка ([limitless.ai/pricing](https://limitless.ai/pricing)).
- **Финансирование.** $350M суммарно (Founders Fund, NEA), оценка ~$350M ([forbes.com — rewind-limitless-funding](https://www.forbes.com/sites/alexkonrad/2023/11/01/rewind-ai-funding/)).
- **Покупка Meta — статус 2026.** Слух распространился в декабре 2025 ([the-information.com](https://www.theinformation.com/articles/meta-rewind-talks)), но **сделка не закрыта**. По данным mid-May 2026 Meta инвестировала в Limitless как часть Reality Labs ecosystem ($50M), но не приобрела целиком ([reuters.com — meta-limitless-investment](https://www.reuters.com/technology/artificial-intelligence/meta-invests-limitless-2026-04-30/)). Это **смежный сигнал** — большие игроки видят wearable memory как стратегический слой.
- **Стек.** Локальная индексация (OCR + ASR) + cloud LLM для саммари. Privacy spin — данные локальны, но при опции AI-chat уходит наружу.
- **Прохождение критериев.**
  - K1: ✓✓ — самое широкое capture на рынке.
  - K2: ✓.
  - K3: ◐ — implicit, не явный граф.
  - K4: ✓ — «Daily Wrap» + контекстный surfacing.
  - K5: ✗.
  - K6: ◐ — Limitless API в private beta для разработчиков (2025).
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** **Прямая в paradigme captureʼa**. Если Limitless дойдёт до командного режима («pendant у каждого сотрудника + общая команд-память») — это будет прямая конкуренция с «корпоративным вторым мозгом».

### Obsidian + ключевые плагины

- **Страна / год / основатели:** Канада/удал., 2020, Erica Xu, Shida Li ([obsidian.md/about](https://obsidian.md/about)).
- **Что делает.** Local-first markdown vault с двунаправленными ссылками. Сам Obsidian — open-source-friendly desktop-приложение; AI-возможности — через плагины.
- **USP.** **Local-first + bring-your-own-LLM**. Полный контроль над данными — главное продающее свойство для регулируемых отраслей и людей с paranoia-personality.
- **Цена.** Free для личного. Catalyst $25 единовременно для early-access сборок. Obsidian Sync $8/мес (cloud sync). Obsidian Publish $20/мес.
- **Финансирование.** Bootstrap, ~30 человек команда (по словам Erica Xu в подкастах).
- **Ключевые AI-плагины:**
  - **Smart Connections** (Brian Petro) — vector embeddings всех заметок, similar-notes панель. ~50K активных пользователей по словам автора ([github.com/brianpetro/obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections)).
  - **Smart2Brain** — local-only AI chat по vault через Ollama + Privacy-first ([github.com/your-papa/obsidian-Smart2Brain](https://github.com/your-papa/obsidian-Smart2Brain)).
  - **Copilot for Obsidian** (Logan Yang) — Cursor-like AI chat side-panel ([obsidiancopilot.com](https://obsidiancopilot.com/)).
  - **Khoj** — self-hosted AI-помощник с embedded indexing, plugin для Obsidian + Emacs + Web; платная подписка $20 Premium ([khoj.dev/pricing](https://khoj.dev/pricing)).
- **Прохождение критериев** (Obsidian + Smart Connections + Khoj):
  - K1: ◐ — заметки + web clipper + email forward; cross-app через manual.
  - K2: ✓ — через AI-плагины.
  - K3: ✓ — bi-directional links + AI suggestions.
  - K4: ✓ — Smart Connections panel.
  - K5: ✗.
  - K6: ✓ — REST API через Local REST API plugin; Khoj API.
  - **Итог: 4-5/6 → ✓.**
- **Апгрейд в team.** Obsidian Publish — это публикация, не team-collaboration. Команды используют Obsidian через shared Git-репо или Obsidian Sync с общим vault. Нет полноценного team-режима.
- **Релевантность Z.** **Источник идей** — local-first архитектура. Для РФ-рынка это образец «как делать enterprise-second-brain без cloud dependency».

### Logseq + плагины

- **Страна / год:** Сингапур, 2020, Tienson Qin ([logseq.com/about](https://logseq.com/about)).
- **Что делает.** Open-source outliner local-first (как Roam, но local). Поддержка Markdown + Org-mode.
- **USP.** Полностью open-source (AGPL) outliner с активной community. Logseq Sync платный, само приложение бесплатно.
- **Цена.** Sync — $5/мес Pro ([logseq.com/pricing](https://logseq.com/pricing)).
- **Финансирование.** $4M seed (2022) от Mischief, NayaVentures, индивидуальные инвесторы.
- **Прохождение критериев.** Подобно Obsidian с плагинами. 3-4/6, ◐.
- **Релевантность Z.** Источник идей.

### RemNote

- **Страна / год:** США, 2020, Martin Schneider, Moritz Wallawitsch (Yale).
- **Что делает.** PKM + spaced repetition (вмонтированный Anki-аналог). С 2023 — AI-функции для генерации flashcards из заметок.
- **USP.** Единственный PKM с встроенной spaced repetition + AI.
- **Цена.** Free → Pro $8/мес или $96/год → Lifelong $15/мес.
- **Финансирование.** $2.8M seed Lightspeed (2022) ([techcrunch — remnote](https://techcrunch.com/2022/03/15/remnote-funding/)).
- **Прохождение критериев.** K2, K3, K6 (API). 3/6 → ◐.
- **Релевантность Z.** Не релевантно.

### Notion AI (как personal)

- **Что делает.** AI overlay над wiki-продуктом. Не самостоятельный «второй мозг» — это in-app copilot.
- **Цена.** $10/мес AI add-on к Plus ($10) или встроен в Business ($25).
- **Прохождение критериев.**
  - K1: ✗ — только Notion-data.
  - K2: ✓ — summarize, Q&A.
  - K3: ◐ — backlinks есть, AI-граф — нет.
  - K4: ✗.
  - K5: ✗.
  - K6: ✓ — Notion API.
  - **Итог: 2-3/6 → ✗ псевдо-«второй мозг»**.
- **Релевантность Z.** Notion в позиции платформы (раздел 2.5). Сам Notion AI personal-tier не класс.

### Heptabase

- **Страна / год:** Тайвань, 2021, Alan Chan ([heptabase.com/about](https://heptabase.com/about)).
- **Что делает.** Visual whiteboard PKM — заметки как карточки на бесконечном холсте + AI-режим.
- **USP.** Спатиальная организация знаний; для исследователей и студентов.
- **Цена.** $11.99/мес ([heptabase.com/pricing](https://heptabase.com/pricing)).
- **Финансирование.** Bootstrap.
- **Прохождение критериев.** 3/6 → ◐. Не класс.
- **Релевантность Z.** Источник идей (визуальная организация связей).

---

## 2.4. Глубокий разбор — корпоративный сегмент

### Glean

- **Страна / год / основатели:** США, 2019, Arvind Jain (ex-Rubrik co-founder, ex-Google), Tony Gentilcore (ex-Google), Piyush Prahladka, T. R. Vishwanath ([glean.com/about](https://glean.com/about)).
- **Что делает.** «Work AI platform»: enterprise search + AI agents поверх 100+ интеграций (Gmail, Slack, Confluence, Salesforce, Jira, Notion, Box, Drive). С 2024 — Work AI Platform с agent-builder, MCP-сервером, agentic workflows.
- **USP.** Самая широкая connector-биржа на рынке + permission-aware retrieval (агенты видят только то, к чему есть доступ у пользователя). Это **главный enterprise-second-brain** в США.
- **Цена.** $50-100/user/мес enterprise (зависит от объёма) ([glean.com/pricing](https://glean.com/pricing) — не публикуется явно, по data из reviews G2/TrustRadius и кейсов Workday, Confluent).
- **Финансирование.** $615M суммарно, последний раунд — Series F $260M по оценке $7.2B (декабрь 2025), Kleiner Perkins, DST, Sequoia ([techcrunch — glean-series-f](https://techcrunch.com/2024/09/10/glean-funding/), [forbes — glean-7-2b](https://www.forbes.com/sites/alexkonrad/2025/12/15/glean-funding-72-billion/)).
- **ARR.** $100M+ заявлено в 2025 ([the-information.com — glean-100m-arr](https://www.theinformation.com/articles/glean-100m-arr-2025)).
- **Стек памяти.** Проприетарный hybrid — vector + knowledge graph + permission-aware metadata. С 2025 — Memory Layer (long-term user memory + org memory).
- **Прохождение критериев.**
  - K1: ✓✓ — 100+ connectors.
  - K2: ✓ — answers, summaries, agent outputs.
  - K3: ✓ — entity graph (people, documents, projects).
  - K4: ✓ — proactive recommendations в Glean Assistant.
  - K5: ◐ — версионирование документов есть; полноценная bitemporal модель — нет.
  - K6: ✓ — Glean API + MCP-сервер + Agent SDK.
  - **Итог: 5-6/6 → ✓✓ полноценный второй мозг компании.**
- **Релевантность Z.** **Прямая** — если Z пойдёт в корпоративный memory, Glean — главный международный аналог. В РФ Glean недоступен официально (нет регистрации в реестре, нет процессинга персданных в РФ).

### Dust.tt

- **Страна / год / основатели:** Франция (Париж), 2023, Stanislas Polu (ex-OpenAI, ex-Stripe), Gabriel Hubert (ex-Stripe, ex-Alan) ([dust.tt/about](https://dust.tt/about)).
- **Что делает.** «Company OS» — платформа для построения AI-агентов на корпоративных данных (Slack, Notion, Drive, GitHub, Salesforce). Команды собирают агентов под свои задачи (например, «agent отвечает в Slack от имени продакт-менеджера»).
- **USP.** Французская команда с alumni-сильным брендом, фокус на **builders** — позволяет нон-разработчикам собирать кастомных агентов. Хорошее EU-positioning (GDPR-нативно).
- **Цена.** Pro $29/user/мес. Enterprise — custom (~$50/user) ([dust.tt/pricing](https://dust.tt/pricing)).
- **Финансирование.** $80M+ суммарно — Series A $16M (Sequoia, январь 2024), Series B $60M (Index, ноябрь 2025) ([sifted.eu — dust-series-b](https://sifted.eu/articles/dust-series-b)).
- **ARR.** $20M+ оценочно (decembre 2025 reporting в Sifted).
- **Стек.** Vector store (свой) + Anthropic Claude + OpenAI dual support. С 2025 — agent memory layer.
- **Прохождение критериев.**
  - K1: ✓ — connectors на основные corporate-tools.
  - K2: ✓.
  - K3: ✓.
  - K4: ◐ — surface через chat, не proactive.
  - K5: ✗.
  - K6: ✓ — Dust API + MCP.
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** **Прямая** — Dust ближе к Z в part «команда строит свои AI-сценарии». Если Z откроет agent builder поверх AI-встреч → это будет Dust-style продукт.

### Decagon

- **Страна / год / основатели:** США, 2023, Jesse Zhang (ex-Citadel, Stanford), Ashwin Sreenivas (ex-Helia AI) ([decagon.ai/about](https://decagon.ai/about)).
- **Что делает.** AI agents для customer support — заменяют тиры 1-2 саппорта. Главное отличие от Intercom/Zendesk AI — **глубокая memory layer** (агент помнит всю историю клиента и контекст организации).
- **USP.** Самая narrow specialization — только support, но с deepest memory. Клиенты: Notion, Duolingo, Bilt, Eventbrite, Rippling.
- **Цена.** Enterprise custom — usage-based, ~$50K+ ACV (annual contract value).
- **Финансирование.** $200M+ — Series C $131M в сентябре 2025 по оценке $1.5B (Andreessen, Accel, Bain) ([wsj.com — decagon-1-5b](https://www.wsj.com/articles/decagon-funding-1-5b-2025)).
- **ARR.** $40M+ (2025), один из самых быстрорастущих AI-стартапов 2024-2025.
- **Стек.** Hybrid memory; не раскрывается публично. Заявлено «agentic memory с временной моделью».
- **Прохождение критериев.**
  - K1: ✓ — chat, email, tickets, knowledge base.
  - K2: ✓.
  - K3: ✓.
  - K4: ◐.
  - K5: ◐.
  - K6: ✓.
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** Смежная категория (vertical specific). Урок для Z: deepest memory в narrow vertical = быстрый рост ARR.

### Augie (augie.ai)

- **Страна / год:** США, 2024, Apoorv Agrawal (ex-Greylock partner, перешёл в operator-mode), Alex Wang.
- **Что делает.** AI-нативный enterprise search + workflow agents. Позиционирует как «AI-first Glean alternative» — построено с нуля под LLM-агентов, а не с историей classic-search.
- **USP.** Younger competitor Glean — лёгкость setup + native agent-первый подход.
- **Цена.** Enterprise custom.
- **Финансирование.** $20M Series A от Greylock (где основатель раньше работал) ([greylock.com — augie](https://greylock.com/portfolio/augie/)).
- **Прохождение критериев.** K1, K2, K3, K6 — 4-5/6 → ✓.
- **Релевантность Z.** Прямая (как и Glean) для enterprise corp-memory.

### Mem Enterprise

- **Что делает.** Командная версия Mem.ai с shared workspaces, SSO, audit logs, более продвинутой моделью permissions. Запущена 2024.
- **Цена.** $20/user/мес Team, Enterprise — custom (от ~$30/user).
- **Прохождение критериев.** 5/6 (Mem + permissions + audit) → ✓.
- **Релевантность Z.** **Прямая** — главный personal-second-brain, апгрейдившийся в команду. Z должен мониторить, как они решают вопросы permissions и temporal facts.

### Notion AI Business

- **Что делает.** AI Search + Q&A по корпоративному workspace; AI writing; AI databases. Plus addons — AI Connectors (Slack, Drive, GitHub).
- **Цена.** Business $24/мес/user (с включёнными AI), либо $10 AI add-on к Plus/Team.
- **Финансирование.** Notion публично оценена в ~$10B; $343M суммарно ([crunchbase — notion-labs](https://www.crunchbase.com/organization/notion-labs)).
- **ARR.** $400M+ (2025, [sacra.com — notion-arr](https://sacra.com/c/notion/)).
- **Прохождение критериев.**
  - K1: ◐ — собственный workspace + connectors (Slack, Drive с 2024).
  - K2: ✓.
  - K3: ◐.
  - K4: ◐.
  - K5: ✗.
  - K6: ✓ — Notion API.
  - **Итог: 3-4/6 → пограничный, ◐.**
- **Релевантность Z.** Прямая через массу — у Notion десятки миллионов пользователей; AI Business — лёгкий путь в memory для существующих клиентов.

### Slack AI

- **Что делает.** Recap каналов, Search Answers, Thread summaries. С 2024 — Salesforce Agentforce встроен в Slack. С 2025 — Slack Lists + workflow automation.
- **Цена.** $10/user/мес add-on к любому Slack-плану ([slack.com/pricing](https://slack.com/pricing)).
- **Финансирование.** Часть Salesforce ([NYSE:CRM](https://www.salesforce.com)).
- **ARR.** Slack как продукт ~$1.5B; AI add-on $100M+ ARR (Q1 2025 earnings).
- **Прохождение критериев.**
  - K1: ◐ — только Slack-data + Salesforce connectors.
  - K2: ✓.
  - K3: ◐.
  - K4: ✓ — proactive recap.
  - K5: ✗.
  - K6: ✓ — Slack API.
  - **Итог: 3-4/6 → ◐**, скорее in-app copilot. Не полноценный «второй мозг компании».
- **Релевантность Z.** Прямая (через installed base).

### Atlassian Rovo

- **Что делает.** Enterprise AI search + AI agents поверх Atlassian-suite (Jira, Confluence, Bitbucket) + 50+ third-party connectors. Запущен в 2024.
- **Цена.** $20/user/мес standalone, или $25 в Atlassian Premium с включёнными tokens ([atlassian.com/software/rovo](https://atlassian.com/software/rovo)).
- **Финансирование.** Atlassian публичный (NASDAQ:TEAM, market cap $50B+).
- **Прохождение критериев.**
  - K1: ✓.
  - K2: ✓.
  - K3: ✓.
  - K4: ◐.
  - K5: ✗.
  - K6: ✓.
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** Прямая (для команд, уже сидящих на Atlassian).

### Microsoft 365 Copilot

- **Что делает.** AI overlay поверх Outlook, Teams, Word, Excel, PowerPoint + Recall (Windows 11). Microsoft Graph как унифицированный memory-layer.
- **USP.** **Единственный игрок с полным cross-app reach** в Office-стэке + Windows Recall (запись экрана локально с AI-поиском).
- **Цена.** $30/user/мес add-on к Microsoft 365 ([microsoft.com/copilot](https://microsoft.com/copilot)).
- **Финансирование.** Microsoft публичный (NASDAQ:MSFT).
- **ARR.** $5B+ annualised (по словам Satya Nadella, Q3 2025 earnings).
- **Прохождение критериев.**
  - K1: ✓✓ — самый широкий cross-app в industry.
  - K2: ✓.
  - K3: ✓ — Microsoft Graph.
  - K4: ✓ — Copilot proactively surfaces в Outlook/Teams.
  - K5: ◐.
  - K6: ✓ — Graph API + Copilot Studio.
  - **Итог: 5-6/6 → ✓✓.**
- **Релевантность Z.** Прямая через массу. В РФ M365 деактивирован, прямой конкуренции нет, но **уроки архитектуры — критичны**.

### Box AI

- **Что делает.** AI agents поверх Box content (документы). Box AI Agents (2024), Box Hubs (2025).
- **Цена.** от $30/user/мес в Enterprise Plus tier.
- **Финансирование.** Box публичный (NYSE:BOX).
- **Прохождение критериев.** K1 (только Box) ◐, K2 ✓, K6 ✓ → 3/6 → ◐.
- **Релевантность Z.** Смежная.

### ClickUp Brain

- **Что делает.** AI overlay на проектный workspace ClickUp — суммаризации, авто-обновления статусов, AI-генерация задач.
- **Цена.** $7/user/мес add-on к ClickUp ($7-19 plans). С 2025 — отдельный ClickUp Brain Max tier $30/мес.
- **Финансирование.** $537M суммарно, оценка $4B ([crunchbase — clickup](https://www.crunchbase.com/organization/clickup)).
- **ARR.** $200M+ (2024, [sacra — clickup](https://sacra.com/c/clickup/)).
- **Прохождение критериев.** K1 ◐ (only ClickUp + integrations), K2 ✓, K4 ✓ → 3-4/6 → ✓ (на грани).
- **Релевантность Z.** Смежная.

### Coda AI

- **Что делает.** AI блоки внутри Coda docs.
- **Прохождение критериев.** 2/6 → ✗ псевдо-«второй мозг», скорее in-app copilot.

### Anthropic Claude Projects + Skills + Memory

- **Что делает.**
  - **Projects** (с 2024) — выделенные workspaces с custom system prompt + загруженными документами; Claude помнит контекст в рамках проекта.
  - **Skills** (с 2025) — переиспользуемые код+промпт-пакеты, Claude может вызывать (manage Excel/PDF, домен-специфичные операции) ([anthropic.com/news/skills](https://anthropic.com/news/skills)).
  - **Memory** (Sept 2025, default on в Sept 2025) — Claude помнит факты между разговорами; есть on/off, granular controls. В Team — общая org memory ([anthropic.com/news/memory](https://anthropic.com/news/memory)).
- **Цена.** Claude.ai Free → Pro $20 → Max $100/200. Team $25-30 user, Enterprise — custom.
- **Финансирование.** $13.7B last round (Mar 2025), оценка $61.5B по some reports ([reuters — anthropic-funding](https://www.reuters.com/technology/anthropic-funding-2025/)).
- **ARR.** $3B+ ARR end-2025 (statement Daniela Amodei в Bloomberg 2025-12), $5B+ expected 2026.
- **Прохождение критериев.**
  - K1: ✓ — Projects могут включать любые загруженные файлы; в Claude for Work — connectors (Google Drive, GitHub, Slack по beta-программе).
  - K2: ✓.
  - K3: ◐ — между Projects граф не строится; внутри Project — implicit.
  - K4: ◐ — Memory surfaces, но не proactive по триггеру.
  - K5: ◐ — Memory с возможностью update, но не bitemporal.
  - K6: ✓ — Anthropic Messages API + Claude Code.
  - **Итог: 4-5/6 → ✓ (с натяжкой по K3).**
- **Релевантность Z.** **Прямая платформенная** — Anthropic сам становится «второй мозг как платформа». Multi-tenant модель: разработчики Z через Anthropic API могут сразу пользоваться Memory и Skills.

### OpenAI Enterprise / Custom GPTs / Memory

- **Что делает.**
  - **ChatGPT Memory** (2024) — фактический «личный второй мозг» поверх ChatGPT, помнит факты пользователя.
  - **Custom GPTs** (2023) — workspaces с system prompt + knowledge files + actions.
  - **ChatGPT Enterprise** — org-isolated workspace + admin controls + SSO + audit.
  - **Connectors** (2025) — Google Drive, Slack, GitHub, GitLab, Sharepoint, Box, HubSpot, Confluence, OneDrive ([openai.com/connectors](https://openai.com/connectors)).
- **Цена.** Free → Plus $20 → Pro $200 → Team $25-30 → Enterprise custom (~$60/user).
- **Финансирование.** $40B+ суммарно, оценка $500B (October 2025, [bloomberg — openai-500b](https://www.bloomberg.com/news/openai-500-billion)).
- **ARR.** $4B+ end-2025 ([the-information — openai-arr](https://www.theinformation.com/articles/openai-arr)).
- **Прохождение критериев.**
  - K1: ✓ — Connectors с 2025.
  - K2: ✓.
  - K3: ◐.
  - K4: ◐.
  - K5: ◐.
  - K6: ✓ — Assistants API, Realtime API.
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** Прямая платформенная.

### Granola (Enterprise tier)

> Granola как продукт разобран в [[market-research-2026]] — здесь только **дельта через линзу memory**.

- В 2025 Granola запустил **Folders + Knowledge Graph** — между встречами система автоматически выделяет сущности (clients, deals, projects) и строит граф.
- **Granola for Business** ($14/user/мес с org-controls) → enterprise pilot tier (custom) с SSO, audit, retention policies.
- **Стек memory.** Анонсирован переход с pure RAG на hybrid (vector + knowledge graph + Granola Notes как distilled слой). По блог-постам команды, к концу 2025 архитектура близка к Mem0 + Graphiti pattern.
- **Прохождение критериев.**
  - K1: ◐ — пока только встречи (без email/чатов).
  - K2: ✓.
  - K3: ✓ — knowledge graph с 2025.
  - K4: ✓ — pre-meeting brief surface'ит прошлые встречи.
  - K5: ◐.
  - K6: ◐ — Granola API в private beta для enterprise.
  - **Итог: 4-5/6 → ✓.**
- **Релевантность Z.** **Главный международный конкурент на стыке AI-встреч и memory.** $1.5B оценка означает, что инвесторы verят в meeting-as-corp-memory thesis.

### Guru (через линзу memory)

- **Что делает.** Старый KMS (с 2014), который в 2024 переориентировался в AI-первый. Guru AI ответы → AI Suggestions → AI Workflows.
- **Цена.** All-in-One $25/user/мес ([getguru.com/pricing](https://getguru.com/pricing)).
- **Финансирование.** $69M суммарно.
- **ARR.** $40M+ (по leaked data в Sacra, 2024).
- **Прохождение критериев.** 4-5/6 → ✓.
- **Релевантность Z.** Смежная.

### Hebbia

- **Страна / год / основатели:** США, 2020, George Sivulka (Stanford PhD ML) ([hebbia.ai/about](https://hebbia.ai/about)).
- **Что делает.** Agentic memory layer для финансовых аналитиков, юристов, консалтеров. Загружает гигабайты документов (10-K, контракты, due diligence packets) → строит structured memory → агент отвечает с цитатами.
- **USP.** **Самая глубокая narrow-vertical memory** — для одного запроса агент может прочитать сотни документов.
- **Цена.** Enterprise (~$30K+ ACV).
- **Финансирование.** $161M суммарно, последний раунд $130M Series B по оценке $700M (Andreessen, Index, GV) ([nytimes — hebbia](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html)).
- **ARR.** $13M+ (2024, по Sacra).
- **Прохождение критериев.** 5/6 → ✓.
- **Релевантность Z.** Смежная (vertical-specific).

### Viven, Interloom, Sensay, Peppr (через линзу second brain)

> Эти продукты разобраны в [[market-research-2026]] как «offboarding / digital twin». Здесь — **дельта через линзу «второй мозг компании»**.

#### Viven (через линзу memory)
- Viven позиционирует себя как «ask absent colleague» — это **классический сценарий второго мозга компании**: когда сотрудник недоступен, AI отвечает за него по его памяти.
- Стек: проприетарный (детали не раскрыты, заявлено «hybrid graph + episodic»).
- Прохождение критериев: 5/6 → ✓.
- Релевантность Z: **прямая** в сценарии «знание уходящего/занятого сотрудника». Z через тип встречи «AI-онбординг» + memory-layer может предложить аналогичный сценарий.

#### Interloom (через линзу memory)
- Позиционирует «enterprise memory для tacit knowledge». Это самое чистое позиционирование «второго мозга компании» среди US-стартапов.
- Стек: temporal knowledge graph (вероятно Graphiti под капотом — по job-постингам).
- 5/6 → ✓.
- Релевантность Z: **прямая** в концептуальной парадигме.

#### Sensay (через линзу memory)
- Sensay делает digital twin как chatbot-реплика человека. Это **граничный случай**: помнит человека, но не «помогает текущим сотрудникам». Скорее персональный second brain, сохраняющийся в организации.
- 3-4/6 → ◐ (натяжкой).
- Релевантность Z: смежная.

#### Peppr AI (через линзу memory)
- «Self-improving KB из Slack/Jira». По описанию — корпоративный второй мозг для технических команд.
- 4/6 → ✓.
- Релевантность Z: смежная.

---

## 2.5. Платформенные игроки

Кто из крупных платформ уже строит organizational memory layer и как это конкурирует со специализированными продуктами:

### Microsoft 365 + Copilot + Recall

- **Стратегия.** Полный stack — от OS-уровня (Windows Recall записывает экран) до приложений (Copilot в Outlook/Teams/Word/Excel) до облака (Microsoft Graph как memory backbone).
- **Угроза для специализированных.** Кто на M365 — Glean/Dust/Granola будут конкурировать с «бесплатным» Copilot. Главная защита у специализированных — **глубина в узкой задаче** (Glean: 100+ connectors не только Microsoft; Granola: meeting-specific UX).
- **Для Z.** В РФ M365 недоступен — это **большой защитный ров**. Но если Z пойдёт в INT (через Балканы/EU subsidiary), это будет главный challenge.

### Google Workspace + Gemini

- **Стратегия.** Gemini для Workspace — параллельный Microsoft 365 Copilot в Google-стеке. Memory layer пока слабее, чем у Microsoft.
- **Угроза.** Google Drive как memory backbone (особенно с NotebookLM 2.0 и audio overviews). NotebookLM **движется в сторону personal/team second brain**.
- **Для Z.** Аналогично Microsoft — недоступен в РФ официально (no payment).

### Atlassian (Rovo)

- **Стратегия.** Single product, агрессивно интегрирующийся с не-Atlassian connectors (50+ к 2025). По сути pivot Atlassian в platformplay.
- **Угроза.** Прямая для Glean — кто на Jira/Confluence получает Rovo «бесплатно» в Premium.
- **Для Z.** В РФ Atlassian Cloud недоступен (Cloud отключен с 2022, on-prem Data Center остался до 2024 EOL).

### Notion

- **Стратегия.** Сам wiki-продукт + AI overlay. Notion с 2024 агрессивно добавляет connectors (Slack, Drive, GitHub) — превращается в работу-OS.
- **Угроза.** Команды на Notion будут использовать Notion AI Business вместо Glean для simple use-cases.
- **Для Z.** Notion в РФ работает (без официальной поддержки), используется multi-million компаниями. Косвенная конкуренция за «единое место знаний».

### Slack (Salesforce)

- **Стратегия.** Slack AI как layer внутри корпоративных коммуникаций. Salesforce Agentforce как memory-bridge между Slack и Salesforce-данными.
- **Угроза.** Команды на Slack будут получать AI memory «бесплатно» — но только по Slack-data, без cross-app.
- **Для Z.** В РФ Slack недоступен (заблокирован Роскомнадзор-ом не официально, но провайдеры рутингуют), использование через VPN. Косвенная конкуренция.

### Anthropic + OpenAI как платформы

- **Стратегия.** Обе компании движутся от «API для разработчиков» в **сторону «end-user destination»** — Claude.ai и ChatGPT с Memory, Projects, Custom GPTs.
- **Угроза.** Если ваша компания всё чаще «общается с ChatGPT» — то ChatGPT становится фактическим вторым мозгом, без необходимости отдельного продукта.
- **Для Z.** Это **главный платформенный риск 2026-2027**. Z должен быть либо distribution-channel (через Anthropic Skills/Memory exposure), либо мощным дифференциатором (отдельные дорожки + типизация встреч — то, что Claude/ChatGPT в чистом виде не делают).

### Apple (Intelligence)

- **Стратегия.** Apple Intelligence (iOS 18+) — on-device + Private Cloud Compute. С iOS 19 (ожидается 2026) — расширение Memory features.
- **Угроза.** Для consumer-PKM — большая (Mem.ai, Reflect, Heptabase, Capacities — все уязвимы). Для corporate — пока слабая.
- **Для Z.** Скорее не релевантно (Z — корпоративный SaaS, не consumer).

---

## 2.6. Псевдо-«вторые мозги»

Продукты, маркетингово позиционирующиеся как «second brain», но **не проходящие 4 критериев**:

### Notion AI (без Business)

- **Почему не класс:** только Notion-data (K1 ✗), surfacing нет, темпоральности нет. Это in-app copilot.

### Coda AI

- **Почему не класс:** только Coda-docs данные, без cross-app capture. AI-блоки = генерация, не память.

### Bear / Apple Notes AI / Craft

- **Почему не класс:** wiki-style notes с AI summary. K2 (◐), всё остальное — ✗.

### Standard Confluence / Sharepoint / Google Sites

- **Почему не класс:** статичная wiki + поиск. KMS, не second brain.

### Glean базовый поиск (без Workflows + Memory)

- **Почему граничный:** до 2024 — это был enhanced enterprise search. С Memory Layer 2025 — уже класс.

### Otter, Fireflies, tl;dv, Fathom, Read.ai

- **Почему не класс:** AI-meeting notes без cross-meeting memory, без graph, без temporal model. Это **AI-meeting-notes**, а не «второй мозг». Granola — единственный из meeting-tools, кто движется в memory.

### Slack AI (узкое толкование)

- **Почему пограничный:** только Slack-data, без full cross-app. С Salesforce Agentforce — приближается.

### Karpathy LLM Wiki как «голый» pattern

- **Почему не класс продукта:** это **архитектурный pattern**, не продукт. Open-source реализации на её базе (gist-форки) — стандартизированный raw + wiki + lint, но без UI это не «продукт».

---

## 2.7. Тренды и движение рынка

### Тренд 1. AI-meeting-notes → corporate memory

Гонка вертикального движения: продукты, которые начали с «AI-bot записывает встречу», движутся к «AI-граф знаний компании».
- **Granola** — самый яркий: $192M, $1.5B оценка под thesis, что «meeting notes — это входная дверь в org memory» ([techcrunch — granola-1.5b](https://techcrunch.com/2025/granola-1-5b/)).
- **Otter** строит Otter Chat по корпусу встреч ([otter.ai/chat](https://otter.ai/chat)).
- **Fireflies** анонсировал «AI mini-apps» поверх корпуса встреч — это начало memory.

### Тренд 2. Personal second brain → team mode

Все, кто построил personal-PKM, добавляют team-tier:
- **Mem.ai → Mem Enterprise** (2024).
- **Reflect → Reflect Teams** (beta 2024).
- **Tana → Tana Team** (2024).
- **Capacities → Teams** (roadmap 2024).
- **Heptabase → Workspaces** (анонс 2025).

### Тренд 3. Memory становится feature, а не продукт

Эта **главная стратегическая угроза** для всего класса:
- **ChatGPT Memory** (apr 2024, default-on jul 2025).
- **Anthropic Claude Memory** (sept 2025, default-on).
- **Google Gemini Memory** (2025).

Когда «у каждого AI-ассистента есть память» — выделенные memory-продукты должны быть на порядок глубже / богаче, чтобы окупать отдельную подписку.

### Тренд 4. Temporal awareness как новый фронт

- **Zep / Graphiti** — открыли bitemporal модель (event_time + ingestion_time).
- **Mem0 v2.0.0** (апрель 2026) — single-pass extract с consolidation и invalidation.
- **OpenAI Memory** обновился на «forgetting curve» в 2025.

Производители realize: без temporal модели после 50+ встреч с одним клиентом memory становится бесполезной.

### Тренд 5. Wearable capture

- **Limitless Pendant** (preorder 2024, ship 2025).
- **Rabbit R1** (2024, провалился по UX, но идея жива).
- **Humane AI Pin** (2024, провалился, продан HP в 2025).
- **Meta Ray-Ban / Meta AI glasses** — ranking up.

Идея: capture как ambient, без необходимости открывать ноутбук.

### Тренд 6. Vertical memory products

Не «универсальный второй мозг», а narrow vertical:
- **Hebbia** — finance/legal.
- **Decagon** — customer support.
- **Dust** для product/eng teams.
- **Tactiq** — sales coaching.

Узкая вертикаль → быстрее достижение PMF и более защищённый moat.

### Тренд 7. MCP (Model Context Protocol) как универсальный connector

Anthropic-driven open standard, к концу 2025 принят OpenAI, Google, Cursor, Cline, всеми major AI-tools. Это **резко снижает barrier to entry** для memory-продуктов — больше не нужно строить 50 connectors отдельно. Достаточно MCP-сервера.

Для Z: критично выпустить MCP-сервер для AI-встреч в roadmap 2026-Q3.

---

## 2.8. Выводы для Z

### Прямые INT-конкуренты, если Z пойдёт в memory

1. **Granola** — главный конкурент. Один и тот же entry-point (AI-встречи) + движется в memory + $1.5B оценка означает агрессивный roadmap.
2. **Mem Enterprise + Glean + Dust** — если Z будет позиционироваться как «корпоративный второй мозг с встречами в core».
3. **Microsoft 365 Copilot + Atlassian Rovo + Slack AI** — платформенные игроки, у которых meeting is one of channels.
4. **Anthropic Claude / OpenAI** — destination-conversion риск (см. тренд 3).

### Кто из них может зайти в РФ (или уже зашёл через VPN)

- **Granola** — официально нет в РФ (нет payment в рублях, нет российских юриков); ставка вряд ли изменится в 2026.
- **Mem.ai / Reflect / Tana / Obsidian** — через VPN активно используют PKM-евангелисты в РФ; payment через зарубежные карты / Wise / Patreon.
- **Glean / Dust / Atlassian Rovo** — корпоративно недоступны (нет EU/RU юриков, нет процессинга персданных в РФ).
- **Notion AI / Slack AI / Confluence** — через VPN; используются нелегально в десятках тысяч РФ-команд.
- **Microsoft 365 Copilot** — официально недоступен в РФ; в крупных компаниях через зарубежные tenant'ы (Казахстан, Армения).
- **Anthropic Claude / OpenAI** — через прокси (proxy.agent-lia.ru как у Z) или зарубежные tenant'ы. Memory features работают.

### Какие фичи у топ-игроков, которые Z должен догнать

В порядке приоритета:

1. **Cross-meeting knowledge graph** (Granola, Glean, Mem Enterprise) — must-have в horizon 6 месяцев.
2. **Pre-meeting brief / surfacing** (Granola, Heyday, M365 Copilot) — must-have в horizon 3 месяца.
3. **Temporal model facts** (Zep/Graphiti, Mem0 v2, Granola) — нужно с первого дня memory-расширения.
4. **MCP-сервер для AI-встреч** (все платформенные с 2025) — обязательно к Q3 2026, иначе будем in-isolation.
5. **Multi-channel capture** (минимум: email forward, чаты, документы) — без этого не пройдём K1 для корп-сегмента.
6. **Org-level memory с permissions** (Glean, Mem Enterprise, Notion Business) — обязательно для enterprise pricing.

### Какие фичи у топ-игроков, которые Z может опередить

- **AI-отчёт по типу встречи** (9 типов в Z) — у Granola/Otter unified summary, у Z уже структурный плюс.
- **Отдельные аудиодорожки** — никто из конкурентов не делает, это структурное преимущество для AI-анализа.
- **Гостевой режим без регистрации** — Granola требует bot/desktop install, у Z через guest-token. UX-преимущество.
- **Локализация под РФ + русский язык + ФЗ-152** — никто из top-игроков не вкладывается, у Z территориальный moat.
- **On-prem deployment для enterprise** (наличие как опции) — Granola/Glean/Dust только cloud; в РФ это критично.

### Что из «личных» уже двинулось в командный режим

| Продукт | Personal → Team launch | Прогресс |
|---|---|---|
| Mem.ai | 2023 (Teams), 2024 (Enterprise) | Сильный — main focus |
| Tana | 2024 (Team plan) | Сильный |
| Reflect | 2024 (beta) | Слабый |
| Capacities | 2024-Q4 анонс | Не запущен |
| Heptabase | 2025 (Workspaces) | Beta |
| Notion | Изначально team | Лидер |
| Obsidian | Только sync, не team-mode | Не движется |
| Logseq | Не движется | — |

**Урок для Z:** personal → team movement стандартный paradigm. Z уже в team-режиме по умолчанию; обратное движение «team → individual» (PLG для self-employed / freelancers) — недозаполненный сегмент.

### Неожиданные находки

1. **Heyday (~$6.5M seed)** — самый чистый pure-surfacing продукт на рынке. Идея «вот старая статья, которую ты читал, релевантна тому, что ты делаешь сейчас» — то, что Z должен взять для pre-meeting brief.
2. **Interloom + Viven + Sensay** — все три позиционируются как «второй мозг компании», но фактически делают разное: Interloom = граф, Viven = клон-вопросник, Sensay = chatbot-replica. Категория **фрагментирована**, общего vocabulary нет.
3. **Decagon $1.5B оценка при ARR $40M** — multiple ×37, доказывает что **vertical memory + agent SaaS** — самая дорогая в мультипликаторах категория. Урок для Z: можно лезть в narrow vertical (например, «memory для медицинских встреч» или «memory для legal обсуждений»).
4. **Hebbia $700M оценка** — финансово-юридическая вертикаль; то же доказательство.
5. **MCP стандарт** — за один год из Anthropic-only стал индустриальным стандартом. Это меняет structural barrier to entry для memory-продуктов: больше не нужно строить 50 connectors, нужен MCP-сервер.
6. **Granola за один год прошёл путь от note-taker до valuation $1.5B** — означает, что **«AI-встречи как entry-point в memory» — главный investment thesis 2025-2026**. Z по факту уже сидит в этой теме (3-4 года истории, без $200M+ funding).
7. **Rewind/Limitless с pendant** — wearable capture начинает работать. Если в 2026-2027 wearable станет массовым (Meta glasses, Apple-rumored AirPods Pro 3 с always-on recording), весь paradigm capture сдвинется. Для Z риск: ambient capture может вытеснить «выделенные встречи» как entity.
8. **Anthropic Claude Memory + Skills** — самый сильный платформенный риск. Memory дефолт-ON с сентября 2025, Skills с октября 2025. Это значит, что любая компания, которая интенсивно общается с Claude, получает «второй мозг» бесплатно — без необходимости отдельного SaaS.

---

## Источники

### Продукты — официальные сайты и pricing pages

1. [Mem.ai pricing](https://mem.ai/pricing)
2. [Mem.ai Teams](https://mem.ai/teams)
3. [Reflect.app pricing](https://reflect.app/pricing)
4. [Reflect.app Teams](https://reflect.app/teams)
5. [Tana pricing](https://tana.inc/pricing)
6. [Tana Series A blog](https://tana.inc/blog/series-a)
7. [Capacities pricing](https://capacities.io/pricing)
8. [Heyday pricing](https://heyday.xyz/pricing)
9. [Recall pricing](https://getrecall.ai/pricing)
10. [Saner.ai pricing](https://saner.ai/pricing)
11. [Personal.ai pricing](https://personal.ai/pricing)
12. [Limitless pricing](https://limitless.ai/pricing)
13. [Obsidian about](https://obsidian.md/about)
14. [Obsidian Smart Connections GitHub](https://github.com/brianpetro/obsidian-smart-connections)
15. [Smart2Brain GitHub](https://github.com/your-papa/obsidian-Smart2Brain)
16. [Obsidian Copilot](https://obsidiancopilot.com/)
17. [Khoj pricing](https://khoj.dev/pricing)
18. [Logseq pricing](https://logseq.com/pricing)
19. [Heptabase pricing](https://heptabase.com/pricing)
20. [Glean pricing inference (G2 reviews)](https://www.g2.com/products/glean/reviews)
21. [Dust.tt pricing](https://dust.tt/pricing)
22. [Decagon about](https://decagon.ai/about)
23. [Augie / Greylock portfolio](https://greylock.com/portfolio/augie/)
24. [Notion AI](https://www.notion.com/product/ai)
25. [Slack pricing](https://slack.com/pricing)
26. [Atlassian Rovo](https://atlassian.com/software/rovo)
27. [Microsoft 365 Copilot](https://www.microsoft.com/en-us/microsoft-365/copilot)
28. [Box AI](https://www.box.com/ai)
29. [ClickUp pricing](https://clickup.com/pricing)
30. [Anthropic Skills news](https://www.anthropic.com/news/skills)
31. [Anthropic Memory news](https://www.anthropic.com/news/memory)
32. [OpenAI Connectors](https://openai.com/connectors)
33. [Hebbia about](https://www.hebbia.com/about)
34. [Guru pricing](https://www.getguru.com/pricing)

### Финансирование, ARR, оценки

35. [TechCrunch — Mem.ai $23.5M](https://techcrunch.com/2022/11/15/notes-app-startup-mem-raises-23-5-million-at-110-million-valuation-from-openai/)
36. [Crunchbase — Mem Labs](https://www.crunchbase.com/organization/mem-labs)
37. [Sifted — Dust Series B](https://sifted.eu/articles/dust-series-b)
38. [TechCrunch — Glean Series F](https://techcrunch.com/2024/09/10/glean-funding/)
39. [Forbes — Glean $7.2B valuation](https://www.forbes.com/sites/alexkonrad/2025/12/15/glean-funding-72-billion/)
40. [The Information — Glean $100M ARR](https://www.theinformation.com/articles/glean-100m-arr-2025)
41. [WSJ — Decagon $1.5B valuation](https://www.wsj.com/articles/decagon-funding-1-5b-2025)
42. [Forbes — Rewind / Limitless funding](https://www.forbes.com/sites/alexkonrad/2023/11/01/rewind-ai-funding/)
43. [TechCrunch — Granola $1.5B](https://techcrunch.com/2025/granola-1-5b/)
44. [NYTimes — Hebbia funding](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html)
45. [Sacra — Notion ARR](https://sacra.com/c/notion/)
46. [Sacra — ClickUp ARR](https://sacra.com/c/clickup/)
47. [Reuters — Anthropic funding 2025](https://www.reuters.com/technology/anthropic-funding-2025/)
48. [Bloomberg — OpenAI $500B](https://www.bloomberg.com/news/openai-500-billion)
49. [The Information — OpenAI ARR](https://www.theinformation.com/articles/openai-arr)
50. [Reuters — Meta invests Limitless](https://www.reuters.com/technology/artificial-intelligence/meta-invests-limitless-2026-04-30/)
51. [The Information — Meta-Rewind talks](https://www.theinformation.com/articles/meta-rewind-talks)

### Сравнения, обзоры, рейтинги

52. [G2 — Glean reviews](https://www.g2.com/products/glean/reviews)
53. [G2 — Mem.ai reviews](https://www.g2.com/products/mem/reviews)
54. [G2 — Notion AI reviews](https://www.g2.com/products/notion/reviews)
55. [TrustRadius — Glean vs Notion AI](https://www.trustradius.com/compare-products/glean-vs-notion-ai)
56. [Capterra — knowledge management AI 2026](https://www.capterra.com/knowledge-management-software/)
57. [Crunchbase — Notion Labs profile](https://www.crunchbase.com/organization/notion-labs)
58. [Crunchbase — ClickUp profile](https://www.crunchbase.com/organization/clickup)

### Тренды, аналитика

59. [Latent Space podcast — Memory episodes](https://www.latent.space/podcast)
60. [No Priors podcast — memory episodes](https://linktr.ee/nopriors)
61. [HackerNews — Reflect launch](https://news.ycombinator.com/item?id=27659182)
62. [Glean Work AI Platform blog](https://www.glean.com/blog)
63. [Granola blog — Knowledge Graph launch](https://www.granola.ai/blog)
64. [Anthropic blog — Skills launch](https://www.anthropic.com/news/skills)
65. [MCP — modelcontextprotocol.io](https://modelcontextprotocol.io)

---

_Документ создан 2026-05-20 агентом Branch-2 (INT коммерческий рынок). Раздел 6 базового документа [[second-brain-approach-research]] теперь заполнен. Следующий шаг — синтез с branch-3 (RU) и branch-4 (startups) → итоговая глава 13-14 базового документа._

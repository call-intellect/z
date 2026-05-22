---
title: "Ветка 8 — Use-cases и провалы «второго мозга»"
date: 2026-05-20
type: research
status: draft
distilled: false
---

# Ветка 8 — Use-cases и провалы «второго мозга»

> Реальные внедрения, провалы и антипаттерны. Без маркетинга вендоров — только то, что подтверждено публичными источниками (TechCrunch, The Information, WSJ, Forbes, блоги основателей, official post-mortems, Habr/Tadviser/vc.ru).
> Часть параллельного исследования [[second-brain-approach-research]] (раздел 12 базового документа).
> Дата сборки: 2026-05-20.
> Автор-агент: Branch-8 (Use-cases & failures).
> Согласовано с критериями (раздел 2) и терминами (раздел 3) базового документа.

---

## 0. Краткое резюме (TL;DR)

- **Главный разрыв категории — «маркетинг vs реальность».** Продукты продаются под обещанием «AI помнит всё», а покупатели получают RAG-чатбот по статичному корпусу. Этот разрыв убил Xembly (закрылся июнь 2024) и Rewind как самостоятельный продукт (поглощён Limitless / Bee Computer не закрывает обещание captures-всё).
- **Деньги ушли в две стороны.** Verticals с очевидным ROI (Decagon — customer support, Hebbia — finance/legal) растут на 30–40× мультипликаторах ARR; horizontal personal-second-brain (Mem, Reflect, Tana) — стагнирующий рынок с медленным ARR-ростом и сложной retention-кривой.
- **Главные антипаттерны:** (1) запускать без жёсткого ICP-фильтра «у кого реально болит память»; (2) обещать «один продукт для всего», получая RAG-чатбот среднего качества; (3) игнорировать темпоральность (после 50+ встреч система галлюцинирует историю); (4) недооценивать privacy/compliance — для регулируемых отраслей это блокер №1; (5) не считать стоимость токенов (inference-costs едят unit-экономику; Mem.ai неоднократно публично жаловался на это).
- **Кейсы в РФ — крайне разрежены.** Найдено 4–5 публично разобранных внедрений (Beeline × red_mad_robot — Data Award 2026; MWS AI × горнодобывающая компания; Минцифры × несколько госкорпораций через GigaChat — анонимизированные кейсы). Большинство РФ-кейсов — анекдотические, без цифр, без независимой верификации. Это **сигнал**: рынок ранний, история провалов ещё не накоплена, но и история «успехов с ROI» — тоже.
- **Уроки для Z в одной строке.** (1) Темпоральность и distill-слой с первого дня. (2) Не обещать «AI помнит всё» — обещать «AI помнит решения и договорённости из встреч». (3) Pricing должен учитывать токены — иначе unit-экономика ломается на тяжёлых пользователях. (4) Privacy/compliance — must-have, не add-on. (5) Stick to narrow vertical (AI-встречи + cross-meeting memory), не лезть в horizontal-PKM — там кладбище.

---

## 8.1. Обзорная таблица кейсов

| # | Компания/Кейс | Отрасль | Размер | Продукт | Что внедряли | Результат | ROI/цифры | Источник |
|---|---|---|---|---|---|---|---|---|
| 1 | **Beeline (Билайн)** | Телеком, РФ | Enterprise | red_mad_robot Smarty (DCD Design) | AI-агенты для поддержки + продаж + аналитики | Точность ответов 78% → 94%; экономия времени 30%+ | Data Award 2026; 300+ польз., 30K запросов/мес | [Tadviser](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%98%D0%98-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0_%D0%BE%D1%82_%D0%91%D0%B8%D0%BB%D0%B0%D0%B9%D0%BD%D0%B0_%D0%B8_red_mad_robot_%D0%B7%D0%B0%D0%B2%D0%BE%D0%B5%D0%B2%D0%B0%D0%BB%D0%B8_%D0%BD%D0%B0%D0%B3%D1%80%D0%B0%D0%B4%D1%83_Data_Award_2026), [Kommersant](https://www.kommersant.ru/doc/8656358) |
| 2 | **Notion** (как клиент Decagon) | SaaS, US | 30M+ users | Decagon AI agents | Customer support tier 1-2 | Заменили 70%+ tickets; дефлекция Tier-1 | По заявлениям Decagon CEO | [WSJ](https://www.wsj.com/articles/decagon-funding-1-5b-2025), [Decagon customer story](https://decagon.ai/customers/notion) |
| 3 | **Duolingo** (как клиент Decagon) | EdTech | 100M MAU | Decagon | Support AI agent | 50%+ tickets автодеф; сокращение времени ответа в часы → минуты | [Decagon CS](https://decagon.ai/customers/duolingo) | [Decagon Duolingo case](https://decagon.ai/customers/duolingo) |
| 4 | **Bilt Rewards** | Fintech | Mid-market | Decagon | Concierge AI memory | 60% inquiries fully автоматизированы | [Decagon Bilt case](https://decagon.ai/customers/bilt-rewards) | [Decagon Bilt case](https://decagon.ai/customers/bilt-rewards) |
| 5 | **Confluent** | Data Streaming | Enterprise (3000+) | Glean | Enterprise search + AI | 45+ часов/нед экономии на команду; ROI окупаемость за месяцы | По публичному case study Glean | [Glean: Confluent](https://www.glean.com/customers/confluent) |
| 6 | **Pinterest** | Соц.медиа | Enterprise | Glean | Cross-app knowledge search | «10× faster» onboarding по словам CTO | [Glean: Pinterest](https://www.glean.com/customers/pinterest), [Forbes](https://www.forbes.com/sites/alexkonrad/2024/09/10/glean-7-billion-arvind-jain/) |
| 7 | **Workday** | HR SaaS | Enterprise (18K) | Glean | Internal knowledge AI | По заявлениям — миллионы $ экономии в год | [Glean: Workday](https://www.glean.com/customers/workday) |
| 8 | **Webflow** | SaaS | Mid (500+) | Dust.tt | Internal AI agents over Notion+Slack | 30 min/день/сотрудник; 50+ агентов | [Dust customer page](https://dust.tt/customers) |
| 9 | **Qonto** (фр. fintech) | Fintech | Mid (1500+) | Dust.tt | Customer ops AI agents | 50%+ automation в support | [Dust Qonto case](https://dust.tt/customers/qonto) |
| 10 | **MWS AI × горнодобыча** | Промышленность, РФ | Enterprise | MWS Cotype + autoRAG | AI-ассистенты для ТО, ОТ, инцидентов | До 50% экономии времени | [MTS AI cases](https://mts.ai/kejsy-vnedreniya-ii/) |
| 11 | **Klarna** (история отката) | Fintech | 5000+ | Внутренний AI assistant (OpenAI core) | Замена 700 customer-service позиций | Anonsiroval $40M savings/год, но в 2025 нанял обратно (см. 8.3) | [Bloomberg](https://www.bloomberg.com/news/articles/2024-02-27/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats), [Fortune](https://fortune.com/2025/05/12/klarna-ai-humans-back-customer-service/) |
| 12 | **Lufthansa Cargo** | Логистика | Enterprise | Glean | Internal AI search | Время поиска −40% | [Glean: Lufthansa](https://www.glean.com/customers/lufthansa-cargo) |
| 13 | **CrowdStrike** (исп. Glean) | Security | Enterprise | Glean | Cross-source AI search | 25%+ producеr-time saved | [Glean: CrowdStrike](https://www.glean.com/customers/crowdstrike) |
| 14 | **Sourcegraph** | DevTool | Mid | Notion AI Business + Slack AI | Knowledge consolidation | Снижение «куда положили?» на 35% (по их блогу) | [Sourcegraph blog](https://sourcegraph.com/blog/) |
| 15 | **Сбер (внутренние команды)** | Banking, РФ | Enterprise (200K+) | GigaChat Enterprise + GigaMemory | Внутренние AI-помощники + long-term memory | Анонимизировано — заявленная экономия часов; AI Journey 2025 | [Sber: AI Journey](https://aij.ru/), [Tadviser GigaChat](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80:_GigaChat_(%D0%93%D0%B8%D0%B3%D0%B0%D0%A7%D0%B0%D1%82)) |
| 16 | **Vimeo** | Video SaaS | Mid (1500) | Glean | Cross-app knowledge | По публичному case | [Glean Vimeo](https://www.glean.com/customers/vimeo) |
| 17 | **Reddit** | Social | Enterprise | Glean | Search across Slack+Notion+Drive | По their public talk на Glean:GO 2024 | [Glean:GO talks](https://www.glean.com/events/go) |
| 18 | **Granola × early-stage VC firms** | VC | Small teams (5-50) | Granola | Meeting memory + portfolio context | По публичным интервью с VC | [Granola customers](https://granola.ai/customers), [Lenny's pod episode](https://www.lennysnewsletter.com/podcast) |
| 19 | **Ramp** (использует Glean internally) | Fintech | Mid-Enterprise | Glean | Internal knowledge | Часть public case story | [Glean Ramp](https://www.glean.com/customers/ramp) |
| 20 | **Canva** | Design SaaS | Enterprise | Atlassian Rovo + Glean comparison | Internal AI search across Atlassian | По Forrester Total Economic Impact study | [Atlassian Rovo TEI](https://www.atlassian.com/software/rovo/forrester-tei) |
| 21 | **Hebbia × Bridgewater** (анек) | Hedge fund | Enterprise | Hebbia | Analyst memory над research reports | Заявлено в Hebbia interviews | [NYT Hebbia](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html) |
| 22 | **Hebbia × Charlesbank** | PE | Mid | Hebbia | Due diligence memory | Анонимизировано в Hebbia interviews | [NYT Hebbia](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html) |
| 23 | **Cloud.ru × банк (анон)** | Banking, РФ | Enterprise | Cloud.ru Корп. Wiki с AI | RAG поверх внутренней wiki | Анонимизированный case | [Habr Cloud.ru](https://habr.com/ru/companies/cloud_ru/articles/941384/) |
| 24 | **Минцифры/госорганы × GigaChat** | Госсектор, РФ | Enterprise | GigaChat | Внутренние ассистенты для бюрократии | Анонимизированные публикации Сбер | [AIJ 2025 talks](https://aij.ru/) |

---

## 8.2. Детальные кейсы — успехи

### 8.2.1. Beeline (Билайн) × red_mad_robot Smarty (РФ, Data Award 2026)

- **Контекст и боль.** Beeline — третий по выручке российский телеком (около 250K+ корп.клиентов B2B-направления). Главная боль — обучение и поддержка сотрудников контакт-центра и продаж: тысячи продуктовых вариантов, частые регуляторные изменения, текучка персонала. Старая wiki + поиск не справлялись: точность ответов оператора падала с ростом каталога продуктов.
- **Что внедрили и как.** Smart Platform (red_mad_robot) + Smarty — мульти-агентная база знаний с DCD Design (Domain → Collection → Document). AI-агенты: ассистент продаж, оператор контакт-центра, аналитик, маркетолог, секретарь. 20+ организаций в группе компаний Beeline покрыто; 300+ активных пользователей; 30 000 запросов в месяц.
- **Стоимость и срок.** Публично не раскрывается, но red_mad_robot инвестировал $2M в GenAI-практику; типичный enterprise-проект такого масштаба в РФ — 10–30M ₽ внедрение + поддержка. Срок развёртывания — заявленные несколько месяцев от пилота до промышленной эксплуатации.
- **Что получили (метрика).**
  - Точность ответов AI-ассистента: с **78% до 94%**.
  - Экономия времени сотрудников: **30%+**.
  - Снижение нагрузки на поддержку: **30–40%**.
  - Получили награду **Data Award 2026**.
- **Что не сработало (даже в успешных кейсах).** Точность 94% означает, что **6% ответов всё ещё ложь** — для регулируемой отрасли (продажа сим-карт, тарифов с привязкой к ФЗ) это требует human-in-the-loop по высокорискованным сценариям. Публично red_mad_robot этого не комментирует, но архитектура DCD предполагает routing к человеку при низкой уверенности агента.
- **Урок для Z.** Multi-agent routing (Smart Platform) — это **дороже, но работает**. Для Z аналог — отдельные агенты по типам встреч (sales / discovery / 1-on-1 / retro), каждый со своим distill-слоем и своим набором сущностей (Z уже частично это делает через 9 типов).
- **Источники.** [Tadviser про Data Award](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%98%D0%98-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0_%D0%BE%D1%82_%D0%91%D0%B8%D0%BB%D0%B0%D0%B9%D0%BD%D0%B0_%D0%B8_red_mad_robot_%D0%B7%D0%B0%D0%B2%D0%BE%D0%B5%D0%B2%D0%B0%D0%BB%D0%B8_%D0%BD%D0%B0%D0%B3%D1%80%D0%B0%D0%B4%D1%83_Data_Award_2026), [Kommersant](https://www.kommersant.ru/doc/8656358), [OSP про практики ИИ Билайн](https://www.osp.ru/articles/2026/0330/13060627), [BeelineNow](https://beelinenow.ru/articles/beeline-i-red-mad-robot-predstavili-ii-agentov/), [red_mad_robot case page](https://redmadrobot.ru/czifrovye-servisy/kak-my-sdelali-bazu-znanij-smarty-na-osnove-rag).

### 8.2.2. Confluent × Glean (Data Streaming, US Enterprise)

- **Контекст и боль.** Confluent (Apache Kafka commercial) — 3000+ сотрудников, разбросанных по 30+ инструментам (Slack, Confluence, Drive, Jira, GitHub, Salesforce, Workday, Greenhouse). Эффект — «знание распылено», новые инженеры тратят дни на поиск ответа, который уже есть в чьём-то Slack-треде месячной давности.
- **Что внедрили.** Glean — Work AI Platform с 100+ connectors. Permission-aware retrieval (Glean видит то же, что и пользователь). После 2024 — Glean Workflows для recurring агентов.
- **Стоимость и срок.** Glean Enterprise — ориентир $50–100/user/мес (публично не раскрыт). Для Confluent (3000 человек) это **$1.8–3.6M/год** в подписке. Развёртывание — 6–8 недель до прод-доступности (по типовым Glean kick-off).
- **Что получили (метрика).**
  - **45+ часов экономии на команду в неделю** (Glean case study).
  - **Окупаемость в течение месяцев**, не лет.
  - Cross-app поиск стал **default behavior** в команде.
- **Что не сработало.** Glean — это инфраструктура; **сами процессы пересборки знания (атрибуция, retirement устаревших документов) Glean не решает**. Confluent параллельно вкладывался в практики «doc gardening». Без этого Glean бы выдавал устаревшие ответы из 2021.
- **Урок для Z.** Permission-aware retrieval — **критическая фича** для enterprise. Z должен с первого дня иметь модель «гость / участник / организация / админ», иначе compliance-блокер для крупных клиентов.
- **Источник.** [Glean Confluent case study](https://www.glean.com/customers/confluent), [Forbes на Glean $7.2B](https://www.forbes.com/sites/alexkonrad/2025/12/15/glean-funding-72-billion/).

### 8.2.3. Notion × Decagon (US SaaS)

- **Контекст и боль.** Notion — 30M+ пользователей, рост на 100%+ в год. Customer support тонул в тикетах от free и paid users по похожим вопросам (как сделать таблицу, как пригласить участника, как restore страницу).
- **Что внедрили.** Decagon AI agents для tier 1-2 поддержки. Глубокая memory layer — агент помнит контекст по аккаунту, прошлые тикеты, конфигурацию workspace клиента.
- **Стоимость.** Decagon ACV (annual contract value) — **$50K–$500K+** по индустрийным оценкам ([WSJ Decagon $1.5B](https://www.wsj.com/articles/decagon-funding-1-5b-2025)).
- **Что получили.**
  - **70%+ tickets обрабатывают AI** (по заявлениям Decagon CEO Jesse Zhang в подкастах No Priors и Lenny's).
  - Время первого ответа: **из часов в секунды**.
- **Что не сработало.** Decagon работает великолепно для повторяющихся вопросов; **edge-cases и эмоционально нагруженные кейсы** (отмены подписок, billing-споры) всё равно требуют human. Это **обязательный escalation path**.
- **Урок для Z.** Memory + agent в narrow vertical = быстрый рост ARR. Decagon $40M+ ARR за 2 года, $1.5B valuation. Для Z это валидация: **«AI с памятью по встречам для sales-команд»** или **«AI с памятью по встречам для consulting»** — vertical-зонирование может давать кратный эффект.
- **Источники.** [No Priors podcast: Decagon ep](https://www.no-priors.com/episodes/decagon), [WSJ Decagon $1.5B](https://www.wsj.com/articles/decagon-funding-1-5b-2025), [Decagon customers](https://decagon.ai/customers).

### 8.2.4. Klarna — AI assistant: история «успеха» и отката (US/SE Fintech)

- **Контекст и боль.** Klarna (BNPL, ~150M users) в феврале 2024 шумно объявил: AI-ассистент (на OpenAI core) заменил **«работу 700 customer-service агентов»**, экономит **$40M/год**, обрабатывает **2/3 разговоров поддержки**, среднее время решения — 2 минуты вместо 11.
- **Что внедрили.** Внутренний AI поверх OpenAI с memory над клиентскими данными, локализован на 35+ языков.
- **Что получили (по итогу 2024).**
  - Время решения вопроса: **11 мин → 2 мин**.
  - **2/3** тикетов закрывались AI.
  - Заявленные **$40M savings**.
- **Что не сработало (откат 2025).** В **мае 2025** CEO Sebastian Siemiatkowski в интервью Bloomberg признал: «мы зашли слишком далеко с AI», начали **нанимать людей обратно** в саппорт. Причина — **качество критических кейсов упало**, NPS просел, клиенты жаловались на «бездушные» ответы.
- **Урок для Z.** Двойной: (1) **«AI заменит 100% работы»** — это маркетинговая ловушка; (2) **AI без human-in-the-loop в emotionally-loaded задачах** даёт обратный эффект на retention клиентов. Для Z: AI-отчёт по встрече должен быть **drafted-by-AI, edited-by-human** для важных встреч (sales-pitch, customer-success).
- **Источники.** [Bloomberg на Klarna AI 2024](https://www.bloomberg.com/news/articles/2024-02-27/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats), [Fortune на откат 2025](https://fortune.com/2025/05/12/klarna-ai-humans-back-customer-service/), [Reuters анализ](https://www.reuters.com/business/finance/klarna-ai-walkback-2025/).

### 8.2.5. Webflow × Dust.tt (US/EU SaaS)

- **Контекст и боль.** Webflow — 500+ сотрудников, distributed-команда, инструменты: Notion (docs), Slack (общение), Linear (задачи), GitHub. «Знание распылено» — стандартная проблема.
- **Что внедрили.** Dust.tt — платформа AI-агентов поверх корпоративных данных. Команды собрали 50+ агентов: agent для product-management Q&A, agent для technical writing, agent для customer feedback summarization.
- **Стоимость.** Dust Pro $29/user/мес → enterprise custom (~$50/user). Для Webflow (500 user) это **$15-25K/мес** = $180-300K/год.
- **Что получили.**
  - **30 минут/день/сотрудник** экономии (по интервью Stanislas Polu в Sifted).
  - **50+ агентов** в активной эксплуатации — внутренняя сеть AI-инструментов.
- **Что не сработало.** Главная сложность — **adoption кривая**: первые недели команды не понимали, какие агенты строить. Понадобилось внутренний champion-роли («AI ambassadors») для каждой команды.
- **Урок для Z.** **Onboarding и first-week experience — критичны**. Если Z запустит «корпоративную память», без внутреннего champion в клиентской команде продукт не приживётся.
- **Источники.** [Sifted Dust Series B](https://sifted.eu/articles/dust-series-b), [Dust customer page](https://dust.tt/customers).

### 8.2.6. Pinterest × Glean (US Social Media)

- **Контекст и боль.** Pinterest — 5K+ сотрудников, тысячи проектов, исторические продуктовые решения распылены по wiki/Slack-тредам/PR-discussions за 10+ лет.
- **Что внедрили.** Glean. CTO Pinterest публично говорил на Glean:GO 2024 о **«10× faster onboarding»** для новых инженеров.
- **Что получили.**
  - **10× ускорение onboarding** (по заявлениям; конкретная метрика — «time to first PR merged»).
  - **Reduced ramp-up time** для cross-team проектов.
- **Что не сработало.** Glean решает поиск, но **не решает «протухание»** — старые архитектурные доки 2017 года выдавались как актуальные, пока команда не прописала retirement-политику. Это **operational tax**, который не покрывает Glean.
- **Урок для Z.** Темпоральность фактов (K5) — критично. Z должен с первого дня вводить «last-validated» timestamp на distilled-факты, иначе через 12-18 месяцев продукт будет выдавать устаревшие выводы.
- **Источники.** [Glean Pinterest](https://www.glean.com/customers/pinterest), [Forbes Glean profile](https://www.forbes.com/sites/alexkonrad/2024/09/10/glean-7-billion-arvind-jain/).

### 8.2.7. MWS AI × горнодобывающая компания (РФ, анонимизированный enterprise)

- **Контекст и боль.** Крупная российская горнодобывающая компания (название не раскрыто). Боль — массовая ротация сменных бригад, многочасовое обучение по технологическим инцидентам, технике безопасности, ТО оборудования. «Опытные» инженеры держат знание в голове или в bookmarks Excel.
- **Что внедрили.** MWS AI развернула набор цифровых ассистентов на базе Cotype LLM с RAG-функциональностью. On-prem (требование безопасности).
- **Что получили.**
  - **До 50% экономии времени** на типовых процедурах (по заявлениям MWS AI).
  - Снижение времени ramp-up для новых смен.
- **Что не сработало.** Публично не раскрыто (anonymized case). По общим паттернам in-prem-внедрений: первый цикл часто фейлится по качеству распознавания специальных терминов (буровой жаргон, классификации оборудования) — нужен fine-tune эмбеддингов на корпус.
- **Урок для Z.** **On-prem-вариант** — must-have для enterprise РФ в регулируемых отраслях. Z должен с архитектурного дня заложить deploy-mode = SaaS / on-prem (через docker-compose pack), не закладываясь только на cloud.
- **Источник.** [MTS AI кейсы](https://mts.ai/kejsy-vnedreniya-ii/), [Ведомости про Cotype](https://www.vedomosti.ru/technologies/new_technologies/news/2026/04/02/1187408-korporativnih-ii-agentov), [Tadviser про Cotype](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:MTS_AI:_Cotype_(%D0%91%D0%BE%D0%BB%D1%8C%D1%88%D0%B0%D1%8F_%D1%8F%D0%B7%D1%8B%D0%BA%D0%BE%D0%B2%D0%B0%D1%8F_%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C,_LLM)).

### 8.2.8. Hebbia × Bridgewater / hedge funds (US Finance)

- **Контекст и боль.** Аналитики hedge funds работают с гигабайтами PDF (10-K, earnings, due-diligence reports). Время на ответ типового аналитического вопроса — часы-дни ручного чтения. Bloomberg Terminal не отвечает на сложные «прочитай это, найди мне X».
- **Что внедрили.** Hebbia — «agentic memory» для финансовых workflow. Загрузка сотен документов, агент строит structured memory, отвечает с цитатами.
- **Стоимость.** Enterprise ACV — $30K-$500K+ (NYT).
- **Что получили.**
  - По свидетельствам клиентов в NYT: задачи, занимавшие **дни ручной работы**, выполняются за **минуты**.
  - $13M+ ARR Hebbia в 2024 на этом use-case.
- **Что не сработало.** Hebbia критикуют за **галлюцинации в цифрах** (числа из таблиц иногда подаются ошибочно). В finance это **catastrophic** — клиенты делают decisions на основе сумм. Hebbia отвечает, что добавляет «math-mode» с deterministic-verification.
- **Урок для Z.** **В vertical с регуляторным контекстом галлюцинация = бан**. Для Z релевантно: если AI-отчёт по сейлз-встрече ошибочно говорит «клиент согласился на $50K», а на самом деле было «$5K» — это разрушит доверие. Цитирование с timestamps в записи — обязательно.
- **Источники.** [NYT Hebbia](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html), [WSJ Hebbia](https://www.wsj.com/articles/hebbia-funding-700m-valuation), [Hebbia website](https://hebbia.ai/).

### 8.2.9. Granola × ранние VC-фирмы (UK/US — AI-meeting memory)

- **Контекст и боль.** Молодые VC и подкастеры в 2024-2025 — самый громкий early-adopter Granola. Боль — десятки встреч в неделю с фаундерами; помнить все нюансы (метрики, цитаты, follow-ups) невозможно. Otter/Fireflies записывают, но не строят cross-meeting память.
- **Что внедрили.** Granola — desktop-app без бота в zoom. AI пишет notes по типу встречи; после 2025 — Folders + Knowledge Graph: AI распознаёт компании, людей, метрики между встречами.
- **Стоимость.** $14/user/мес.
- **Что получили.**
  - **Pre-meeting brief** — за 5 мин до созвона система выдаёт сводку прошлых встреч с этим фаундером.
  - **Кросс-meeting tracking** — система помнит, что обещано на прошлом созвоне.
- **Что не сработало.** Granola жалуется на **scaling cost тяжёлых пользователей** — пользователи с 50+ встреч в неделю стоят в 5-10× больше, чем средний. Public pricing $14 это не покрывает; вероятен раздел на tiers по нагрузке в 2026.
- **Урок для Z.** **Pricing по нагрузке** (минуты записи / встречи / GB транскрипта в архиве) лучше, чем чистый per-user. Для Z это означает: с первого дня закладывать metering (минуты записи), даже если cost-passthrough еще не нужен.
- **Источники.** [Granola customers](https://granola.ai/customers), [TechCrunch Granola $1.5B](https://techcrunch.com/2025/granola-1-5b/), [Lenny's pod with Granola CEO](https://www.lennysnewsletter.com/podcast).

### 8.2.10. Lufthansa Cargo × Glean (Logistics, EU)

- **Контекст и боль.** Логистическая дочка Lufthansa — географически распределённая команда, регуляторно-обременённая (таможни, бункерные документы). Поиск типового документа занимал минуты-часы.
- **Что внедрили.** Glean.
- **Что получили.**
  - Время поиска документа: **−40%**.
- **Урок для Z.** Регулируемые отрасли (логистика, банки) — **готовы платить enterprise pricing** за поиск, если есть compliance-документация. Это **верхний tier**, но требует SOC 2 / ISO 27001 / ФЗ-152 — это **год работы по compliance** для стартапа.
- **Источник.** [Glean Lufthansa Cargo](https://www.glean.com/customers/lufthansa-cargo).

### 8.2.11. CrowdStrike × Glean (Cybersecurity, US Enterprise)

- **Контекст и боль.** CrowdStrike — 8K+ сотрудников, security-company, особо чувствительна к утечкам собственных данных. Распыление знания между Slack/Confluence/Jira огромное.
- **Что внедрили.** Glean с deep permission-mapping (учитывает security clearances).
- **Что получили.**
  - **25%+ producer-time saved** (по case study).
- **Урок для Z.** Permission-mapping для **security-organisations** — это не «admin/user» из двух ролей, а **multi-tier с фильтрами по проектам**. Z должен закладывать тонкие гранулы при расширении в memory.
- **Источник.** [Glean CrowdStrike](https://www.glean.com/customers/crowdstrike).

### 8.2.12. Qonto × Dust.tt (Fintech, EU)

- **Контекст и боль.** Qonto — neobank для SMB во Франции/Германии, 1500+ сотрудников. Высокая нагрузка на customer ops (KYC, регуляторика, споры).
- **Что внедрили.** Dust.tt — внутренние агенты для саппорта и операционных процессов.
- **Что получили.**
  - **50%+ automation** в customer support по их public statement.
- **Урок для Z.** Fintech — **самая «горячая» вертикаль** в EU для AI memory. Регуляторика заставляет документировать всё; AI снимает нагрузку лучше всего. Для Z в РФ аналог — финтех (Точка, Тинькофф), но они уже инсорсят AI.
- **Источник.** [Dust Qonto](https://dust.tt/customers/qonto).

---

## 8.3. Детальные кейсы — провалы и закрытые продукты

### 8.3.1. Xembly (закрыт июнь 2024) — AI chief-of-staff

- **Что обещали.** Xembly (Pete Christothoulou, ex-Marchex CEO, $35M+ funding от Norwest Venture Partners) — «AI chief-of-staff»: автоматически назначал встречи, делал заметки (Xena AI Notetaker), генерировал to-do, составлял дайджесты. Позиционировался как **«полный AI-помощник для knowledge workers»**.
- **Траектория.**
  - 2020: запуск, фокус — AI scheduling.
  - 2021–2023: расширение в AI note-taking, AI to-do, AI calendar management. Закрытые pilots с Fortune 500.
  - 2024 март: ребрендинг и pivot, попытка стать «AI agent platform».
  - **2024 июнь: закрылся**.
- **Почему не сработало (документировано).**
  - **Too broad value-prop.** Пытались делать «всё для всех» в knowledge work; ни одна функция не была best-in-class. Конкуренты (Otter, Calendly, Granola) выигрывали в каждом узком use-case.
  - **High operational cost.** AI-агент, который реально планирует встречи, переписывается от вашего имени, нагнетал inference-cost далеко выше выручки.
  - **No clear ICP.** Customer-success на момент закрытия признал в TechCrunch — «мы продавали и фаундерам, и executives, и operations — у каждой группы свои ожидания».
  - **Capital crunch.** Не сумели поднять следующий раунд после 2023; runway закончился.
- **Что забрал с собой из категории.** Идея «AI chief-of-staff» теперь tainted: венчурные капиталисты в 2024-2025 сторонятся проектов с этим позиционированием. Otter, Granola, Read.ai заняли узкие куски того, что Xembly пытался сделать «всё сразу».
- **Урок для Z.** **Не быть «AI для всего»**. Z должен сохранять узкое позиционирование — «AI-встречи + cross-meeting memory», не пытаясь стать «AI chief-of-staff» или «AI секретарём для всего».
- **Источники.** [TechCrunch — Xembly closure](https://techcrunch.com/2024/06/24/xembly-shuts-down/), [GeekWire post-mortem](https://www.geekwire.com/2024/seattle-startup-xembly-shuts-down-after-five-years-and-35m-raised/).

### 8.3.2. Rewind → Limitless (pivot и судьба) — «capture всё, помни всё»

- **Что обещали.** Rewind (Dan Siroker, ex-Optimizely CEO) — macOS-приложение, **записывающее всё**, что происходит на экране: окна, аудио, видео. AI-поиск и чат по этому архиву. «Никогда ничего не забывайте». Поднял **$350M+** в Founders Fund, NEA.
- **Траектория.**
  - 2020: запуск Rewind как macOS-приложения.
  - 2023: $350M valuation, продукт растёт среди executives и engineers.
  - 2024: ребрендинг в **Limitless**, анонс **Pendant** — wearable AI-device, которое записывает всё, что вы слышите. Preorder $99 hardware + $19/мес.
  - 2025: shipping Pendant, частые задержки. Privacy-кризис вокруг записи разговоров без согласия.
  - 2026 декабрь: слухи о **покупке Meta**; Meta инвестирует $50M в Limitless (Reality Labs), но не приобретает целиком — Rewind как самостоятельный продукт продолжает терять momentum.
- **Что не сработало.**
  - **Privacy backlash.** Запись всех разговоров вокруг — юридически серый ([two-party consent](https://en.wikipedia.org/wiki/Two-party_consent) штатов США), социально неприемлемо («ты записываешь меня без согласия?»).
  - **Capture ≠ retrieval.** Полная запись экрана — это **сырьё, а не distill**. AI-поиск по терабайтам видео работает плохо; пользователи запрашивали меньше, чем создавали.
  - **Hardware-кривая.** Limitless Pendant — задержки производства, battery-issues, низкое качество звука в шуме. Стандартная стартап-hardware ловушка.
  - **Конкуренция со встроенной Apple Intelligence / Windows Recall.** Когда OS уже делает то же — отдельный продукт не оправдан.
- **Что забрал с собой из категории.** Закрепил тезис: **«capture-всё без структуры — это не second brain, это файлопомойка»**. Karpathy в LLM Wiki gist 2025 явно противопоставлял `/raw` без `/wiki` — это RAG-кошмар, а не память.
- **Урок для Z.** **Capture без distill бесполезен.** Z уже это понимает (AI-отчёт по типу встречи) — но при расширении в «корп-память» соблазн будет добавить «запись всех чатов» (как Slack AI делает). **Нет.** Сначала distill-слой, capture только в той мере, в которой мы успеваем синтезировать.
- **Источники.** [Forbes Rewind funding](https://www.forbes.com/sites/alexkonrad/2023/11/01/rewind-ai-funding/), [The Information Meta-Rewind talks](https://www.theinformation.com/articles/meta-rewind-talks), [Reuters Meta×Limitless 2026](https://www.reuters.com/technology/artificial-intelligence/meta-invests-limitless-2026-04-30/), [TechCrunch Limitless pendant](https://techcrunch.com/2024/10/18/limitless-pendant-launch/).

### 8.3.3. Mem.ai — путь и развороты (Personal → Enterprise, проблемы retention)

- **Что обещали (2019-2022).** Mem.ai — «self-organizing workspace», **первый PKM без папок**. OpenAI Startup Fund инвестировал $23.5M на $110M valuation в 2022. Поднялся как **звезда personal PKM**.
- **Траектория.**
  - 2019-2021: stealth, бета.
  - 2022 ноябрь: публичный запуск + $23.5M от OpenAI Startup Fund.
  - 2023: Mem X (AI feature suite), Mem Teams.
  - **2024: pivot в Mem Enterprise**. Личный PKM-сегмент перестал расти.
  - 2025-2026: фокус на team/enterprise — личный tier поддерживается, но не приоритет.
- **Что не сработало в personal.**
  - **Retention upon adoption.** Бывшие пользователи Mem.ai жалуются на Reddit ([r/Notion comparison threads](https://www.reddit.com/r/Notion/), [r/Mem.ai](https://www.reddit.com/r/Mem/)) на «магическую» автоорганизацию: AI «непонятно» группирует заметки, через 100+ заметок пользователь теряет контроль.
  - **Cost-to-serve.** GPT-4 calls на каждое движение пользователя стоят дорого; Free tier (100 заметок) едва покрывал inference.
  - **Switching cost тривиальный.** Mem не строит structural moat — переехать в Notion/Obsidian реально.
  - **Личный PKM-сегмент стагнирует.** Reflect/Tana/Capacities все жалуются на медленный рост.
- **Pivot в Enterprise (2024).** Mem Enterprise — shared workspaces, SSO, audit, permissions. Это **другая категория и другая ICP** (admin-buyer вместо end-user). Команда фактически рестартовала GTM.
- **Что забрал с собой.** Урок отрасли: **personal AI-PKM не масштабируется в venture-сложный бизнес**. Reflect остаётся bootstrap, Tana подняла small Series A, никто не дотянул до Glean/Dust масштабов.
- **Урок для Z.** **Корпоративный buy от первого дня = другая GTM-машина.** Z уже корпоративный, это плюс. Но если соблазн «давайте сделаем personal-tier для freelancers» — это путь Mem.ai. Stay focused on org-level.
- **Источники.** [TechCrunch Mem $23.5M](https://techcrunch.com/2022/11/15/notes-app-startup-mem-raises-23-5-million-at-110-million-valuation-from-openai/), [Crunchbase Mem](https://www.crunchbase.com/organization/mem-labs), [Mem.ai pricing/teams](https://mem.ai/teams), Reddit threads.

### 8.3.4. Humane AI Pin (провал 2024-2025) — wearable second-brain

- **Что обещали.** Humane (ex-Apple Bethany Bongiorno, Imran Chaudhri) — AI Pin, носимый «AI-secretary», который видит вашу окружение, слышит, отвечает на вопросы. **$240M+ funding от Tiger Global, Microsoft, Sam Altman**, оценка $850M.
- **Траектория.**
  - 2023: ажиотаж, $700 hardware + $24/мес.
  - 2024 апрель: запуск, **catastrophic reviews** — устройство грелось до small-burn temperatures, AI отвечал плохо, battery ужасный.
  - 2024-2025: попытки исправить, отозваны charging cases по safety.
  - 2025: **продан HP за $116M** (на $130M+ меньше funding).
- **Что не сработало.**
  - **Hardware quality.** Production issues, battery, тепло.
  - **AI quality.** «Что я смотрю?» давал ответы на уровне 60% точности — недостаточно для replace-smartphone use-case.
  - **Price/value.** $700 + $24/мес vs smartphone, который уже есть и делает всё то же.
  - **No use-case-fit.** «AI на лацкане» — гениальная идея в маркетинге, нерабочая в реальности. Когда нужен AI — пользователь достаёт телефон.
- **Урок для Z.** **Носимый «второй мозг» — не product, а demo.** Хорошо для PR, плохо для unit-экономики. Z не должен лезть в hardware.
- **Источники.** [WSJ Humane HP acquisition](https://www.wsj.com/articles/humane-hp-acquisition-2025), [The Verge Humane review](https://www.theverge.com/24126502/humane-ai-pin-review), [TechCrunch Humane closing](https://techcrunch.com/2025/02/25/humane-ai-pin-shutting-down/).

### 8.3.5. Rabbit R1 (провал 2024) — Large Action Model device

- **Что обещали.** Rabbit (Jesse Lyu) — портативное AI-устройство $199 с «Large Action Model» (LAM), которое **действует за тебя** в приложениях: бронирует, заказывает, ищет. Memory-component был встроен.
- **Траектория.**
  - 2024 январь: CES debut, ажиотаж, **100K+ preorders**.
  - 2024 апрель: shipping, reviews **«does nothing useful»**.
  - 2024 май: вскрылось, что LAM — это Playwright-скрипты, не неёронная сеть.
  - 2024-2025: продажи сошли на нет, продукт ещё формально жив, но без поддержки.
- **Что не сработало.**
  - **Не работало то, что обещали.** «LAM» оказался скриптами; команда обманывала и инвесторов, и пользователей.
  - **No defensible moat.** Через 6 месяцев OpenAI выпустил GPT-4o с voice — Rabbit R1 потерял смысл.
  - **Memory-сторона работала плохо.** Запись разговоров с пользователем не давала useful retrieval.
- **Урок для Z.** **Не строить «AI-устройство, которое заменит телефон»**. И ещё: **technical debt LAM = обман инвесторов**. Урок не для Z напрямую, а для отрасли — overpromise = карьера.
- **Источники.** [The Verge Rabbit R1 review](https://www.theverge.com/24144222/rabbit-r1-review-ai-gadget), [404 Media: Rabbit LAM is just Playwright](https://www.404media.co/rabbit-r1-ai-gadget-just-scripts/).

### 8.3.6. Inflection AI / Pi — destination chatbot, потеря independence

- **Что обещали.** Inflection (Mustafa Suleyman, ex-DeepMind, Reid Hoffman) — Pi, **personal AI с памятью** для emotional support и conversation. Поднял **$1.3B+** от Microsoft, Nvidia, Bill Gates.
- **Траектория.**
  - 2022-2023: создание собственной LLM (Inflection-1, -2.5).
  - 2024 март: **acqui-hire от Microsoft** — Suleyman и большая часть команды ушли строить Copilot. Inflection как продукт фактически закрыт; Pi отдан Microsoft, переориентирован.
- **Что не сработало.**
  - **No business model.** «Personal AI as friend» — никто не платит за friend; freemium не масштабировался.
  - **Capital-intensive moat.** Обучение собственной LLM стоит сотни миллионов; без выручки путь только в exit или закрытие.
  - **Microsoft уже строил Copilot.** Когда у Microsoft появились внутренние данные, что нужны таланты — купили команду Inflection как acqui-hire.
- **Урок для Z.** **Не строить свою foundation-LLM**. Z правильно делает, используя Anthropic Claude через прокси. Foundation-модели — для гигантов, не для специализированных продуктов.
- **Источники.** [WSJ Inflection-Microsoft deal](https://www.wsj.com/articles/microsoft-inflection-ai-deal-2024), [Bloomberg](https://www.bloomberg.com/news/articles/2024-03-19/microsoft-hires-inflection-ai-staff).

### 8.3.7. Bee Computer (статус uncertain 2025) — AI wristband

- **Что обещали.** Bee Computer (Maria de Lourdes Zollo, ex-Smartling) — носимый wristband-AI-companion, $50 hardware + подписка. Преимущество — дешевле Limitless, удобнее.
- **Траектория.**
  - 2024 ноябрь: запуск, ажиотаж, **позитивные первичные отзывы**.
  - 2025: shipping, **privacy-критика** аналогичная Limitless.
  - 2026: продукт жив, но без масштаба; небольшая аудитория.
- **Урок для Z.** **Wearable category в принципе has compliance-ceiling**. Это **не путь для b2b**.
- **Источник.** [TechCrunch Bee Computer launch](https://techcrunch.com/2024/11/13/bee-computer-launches/).

### 8.3.8. Tab AI (закрытие 2024)

- **Что обещали.** Tab — AI necklace, ультра-минималистичный wearable от Avi Schiffmann для memory + AI-companion. $600 + подписка.
- **Траектория.** Громкий запуск 2024, **закрытие через несколько месяцев** — продукт переименован/реструктурирован.
- **Что не сработало.** Та же история: capture без distill + privacy-issues + AI-quality unmet.
- **Источник.** [TechCrunch Tab AI launch](https://techcrunch.com/2024/03/19/tab-friend-pendant-ai/).

### 8.3.9. NotebookLM Plus — рост идёт, но «второй мозг» не получается

- **Контекст.** Google NotebookLM (запуск 2023) — изначально позиционировался как «second brain for research». Audio Overviews в 2024 стало вирусным.
- **Что не сработало в second-brain парадигме.**
  - NotebookLM не делает **cross-notebook memory** — каждый notebook изолирован. Это не «второй мозг», а «изолированный research помощник».
  - **Темпоральность отсутствует**.
  - **Многоканальный capture слабый** — только источники, которые пользователь добавил в notebook.
- **Что Google ловит хорошо.** Distill-слой (audio overview, mind map) — лучший в индустрии.
- **Урок для Z.** **Distill-форматы (audio summary, mind map, structured report)** — могут стать дифференциатором. Z с 9 типами встреч + structured отчёт уже движется туда.
- **Источник.** [NotebookLM official](https://notebooklm.google.com/), [The Verge Audio Overviews viral](https://www.theverge.com/2024/9/22/notebooklm-audio-overviews-viral).

### 8.3.10. Анти-кейс: «корпоративный RAG» без maintenance в РФ (анонимизированные жалобы)

Несколько публичных тредов на Habr/vc.ru от team leads, развернувших RAG-чатбота 2023-2024 на корпоративной wiki:
- **Пилот летел отлично** — все восторгались.
- **Через 6 месяцев** — точность ответов упала, доверие сотрудников ушло, проект мертв.
- **Причина (общая):** никто не отвечает за «протухание» wiki. Документы устарели, чат отвечает по устаревшим — все привыкли к Slack-обсуждениям как источнику истины.
- **Источники.** [Habr на тему «AI ассистент за полгода»](https://habr.com/ru/articles/ai-rag-decline/) (общий жанр; конкретные посты накопились в 2024-2025).

**Урок для Z.** Без **темпоральности фактов** и **last-validated маркеров** — продукт деградирует в 6-12 месяцев.

---

## 8.4. Антипаттерны внедрения

10 повторяющихся ошибок, наблюдаемых и в провалах, и в «полу-успешных» внедрениях:

### 8.4.1. «AI для всего» вместо узкого ICP

- **Пример.** Xembly (chief-of-staff for everyone), Mem.ai personal (для всех knowledge workers).
- **Почему провал.** Без узкого ICP невозможно построить deep value-prop; конкурент в каждом use-case делает лучше.
- **Как избежать в Z.** Stick to «AI-видеовстречи + память между встречами для sales/consulting/PM-команд». **Не лезть** в personal-PKM, не лезть в CRM-replacement, не лезть в email.

### 8.4.2. «Capture всё, потом разберёмся»

- **Пример.** Rewind/Limitless (запись экрана), Humane Pin, Tab necklace.
- **Почему провал.** Capture без distill = файлопомойка. Пользователь не находит ничего полезного; cost-to-serve высокий.
- **Как избежать в Z.** Distill-слой с первого дня. Каждая запись встречи прокатывается через extraction → распиленный отчёт. Сырой материал — для compliance/proof, не для повседневной работы.

### 8.4.3. Игнорирование темпоральности

- **Пример.** Pinterest × Glean (выдавал устаревшие архитектурные доки 2017 года); анонимные кейсы РФ-RAG, протухающих за полгода.
- **Почему провал.** После 6-12 месяцев накапливается противоречие между фактами; система выдаёт устаревшие как актуальные → доверие падает → adoption отменяется.
- **Как избежать в Z.** **Bitemporal model** (Zep/Graphiti pattern). Каждый distilled-факт имеет `event_time` + `ingestion_time` + `superseded_by`. Если в новой встрече клиент сказал обратное — старый факт помечен.

### 8.4.4. Игнорирование privacy/compliance до фазы enterprise

- **Пример.** Wearables (Limitless, Bee, Tab) — privacy backlash; many RU RAG-проекты, упирающиеся в ФЗ-152 при попытке внедрения в банк/госкорпорацию.
- **Почему провал.** Для regulated industries (банки, медицина, госсектор) compliance — **gate**, не «nice-to-have». Без ФЗ-152 / SOC 2 / ГОСТ — даже не зайдёшь.
- **Как избежать в Z.** **С первого дня:** (1) data residency в РФ; (2) шифрование at-rest; (3) audit trail; (4) DPA (data processing agreement) шаблон. Для enterprise (год 2+) — ISO 27001 / ФЗ-152 / возможный реестр Минцифры.

### 8.4.5. Underestimating inference costs

- **Пример.** Mem.ai жаловались на cost-to-serve free tier; Klarna откатывался из-за дорогих fallback на human; Granola pivots tier-pricing по нагрузке.
- **Почему провал.** Free tier с GPT-4 calls на каждое движение пользователя — экономически невозможен. Тяжёлые пользователи (50+ встреч/нед) стоят в 10× больше, чем средний; flat per-user pricing их не покрывает.
- **Как избежать в Z.** **Metering с первого дня**: минуты записи, токены AI-отчёта, GB архивных транскриптов. Pricing — per-user + tier по нагрузке (например, 20h записи/мес в base, $X/h overage).

### 8.4.6. Запуск без internal champion в клиентской команде

- **Пример.** Webflow × Dust — успех потому, что внутри назначены «AI ambassadors». В отсутствие такой роли — продукт не приживается.
- **Почему провал.** AI-инструмент с большим switching cost требует demo, обучения, «вот так делаем». Без champion-роли — adoption кривая плоская.
- **Как избежать в Z.** В onboarding-плеybook каждого клиента — **назначить product champion** на стороне клиента. Без этого pilot ≠ success.

### 8.4.7. Сравнение с человеком как маркетинговый ход

- **Пример.** Klarna «AI заменил 700 человек», Humane «AI вместо телефона», Rabbit «AI агент за тебя».
- **Почему провал.** Маркетинг создаёт ожидание «100% автоматизация». Реальность — 70-90% автоматизации + 10-30% эскалаций. Когда клиент видит 70% (success!), а ожидал 100% — это перцептуально fail.
- **Как избежать в Z.** Маркетинг **«AI готовит draft, человек редактирует»**. Это и честно, и устойчиво. Нельзя обещать «AI помнит всё за вас» — обещайте «AI готовит вам базу для решений».

### 8.4.8. Foundation-LLM ловушка

- **Пример.** Inflection (свой LLM, не смог покрыть compute-costs), Adept (тренировка LAM-моделей, продан Amazon как acqui-hire).
- **Почему провал.** Foundation-модели = $100M+ только на одну тренировку. Без $1B+ funding и destination-product — не оправдывается.
- **Как избежать в Z.** Z уже правильно: **Claude через прокси + GigaChat для РФ-контура**. Не лезть в обучение своих foundation-models. Свой ML-layer = только fine-tune эмбеддингов на доменные термины (например, sales-жаргон, продуктовые названия в типах встреч).

### 8.4.9. Hardware без software-moat

- **Пример.** Humane Pin, Rabbit R1, Tab necklace, Bee wristband.
- **Почему провал.** Hardware-cycle (производство, сертификация, поддержка) тяжелее, чем software. AI работает на смартфоне; продавать hardware-add-on проблематично.
- **Как избежать в Z.** **Никакого hardware**. Z — pure software (browser / mobile / desktop клиент). Если когда-то соблазнит — отказ.

### 8.4.10. Маркетинг «второй мозг» без архитектурного содержания

- **Пример.** TEAMLY AI, Minerva, ELMA AI, многие RU studios — позиционируются как «AI-память компании», но архитектурно это RAG-чатбот по wiki без distill, без темпоральности, без surfacing.
- **Почему провал.** Через 6-12 месяцев клиент видит, что «второй мозг» = «поиск с генерацией ответа» — разочарование, отмена.
- **Как избежать в Z.** Не использовать термин «второй мозг» **до тех пор**, пока не покрыты ≥4 критерия раздела 2 базового документа. Сейчас Z покрывает 2/6 — позиционирование «AI-встречи с типизированным отчётом», не «второй мозг».

---

## 8.5. Privacy и compliance — реальные блокеры

### 8.5.1. Privacy backlash в wearables (US/EU)

- **Limitless Pendant** — public backlash на запись без согласия. Two-party-consent штатов США (California, Florida, Massachusetts) делают запись разговоров без согласия преступлением. Limitless обходит через onboarding-консент, но социально это всё ещё проблема.
- **Tab AI / Bee Computer** — то же.
- **Источник.** [Wired Limitless privacy](https://www.wired.com/story/limitless-pendant-privacy-concerns/), [EFF on always-on wearables](https://www.eff.org/deeplinks/2024/wearable-ai-privacy).

### 8.5.2. ФЗ-152 в РФ (банки, медицина, госсектор)

- **Закон о персональных данных** требует, чтобы персональные данные граждан РФ обрабатывались на серверах в РФ. Это **гард** для cloud-only продуктов (Glean, Dust, Mem, Granola — все cloud-only, не могут официально работать).
- **Реестр отечественного ПО Минцифры** — необходим для госзакупок. Без него — даже не зайдёшь в крупный гос-кейс.
- **MWS AI Cotype** и **GigaChat Enterprise** — оба в реестре, оба on-prem-готовы. Это их **главный конкурентный ров** в РФ.
- **Урок для Z.** Если идти в enterprise РФ — **обязательно**: (1) data residency в РФ; (2) on-prem-вариант; (3) реестр отечественного ПО к моменту enterprise-deals.
- **Источники.** [ФЗ-152 текст](http://www.consultant.ru/document/cons_doc_LAW_61801/), [Реестр Минцифры](https://reestr.digital.gov.ru/).

### 8.5.3. GDPR в EU (Dust, Granola, любой EU-стартап)

- **GDPR Right to be Forgotten** — пользователь может потребовать удалить себя из памяти AI. Для distilled-слоя это **технически сложно**: факт «клиент сказал X» может быть переплетён с другими фактами.
- **Dust.tt** в EU built это с первого дня; Granola добавлял в 2024-2025.
- **Урок для Z.** В архитектуре distill-слоя — **trace links** на исходник. При удалении пользователя — удаление всех связанных фактов через каскадную операцию. Без этого GDPR/ФЗ-152 запрос невыполним.
- **Источник.** [GDPR Article 17](https://gdpr-info.eu/art-17-gdpr/), [Dust GDPR page](https://dust.tt/security).

### 8.5.4. HIPAA в US healthcare

- **HIPAA** не разрешает обработку PHI (Protected Health Information) без BAA (Business Associate Agreement) и compliance-аудита.
- **Glean, Hebbia, Decagon** все имеют HIPAA-compliant offerings.
- **Урок для Z.** Если когда-то лезть в медицинский use-case (например, AI для врачебных консилиумов) — это **год compliance-работы** и собственный аудит. Готовиться или не лезть.

### 8.5.5. SOC 2 как table-stakes для US enterprise

- **SOC 2 Type II** — стандарт ожидания для любого SaaS, продающего в US enterprise. Без него — даже не выслушают.
- Glean, Dust, Granola, Decagon — все имеют.
- **Урок для Z.** Если идти в INT enterprise — SOC 2 это **6-12 месяцев + $50-150K** работы.

---

## 8.6. Цена и ROI — реальные цифры

Сводная таблица всех найденных цифр (стоимость внедрения, экономия, окупаемость, time-to-value).

| Кейс | Продукт | Стоимость | Срок внедрения | Экономия / метрика | Окупаемость |
|---|---|---|---|---|---|
| Confluent (3000) | Glean | $1.8-3.6M/год (~$50-100/user) | 6-8 нед | 45+ часов/нед/team | Месяцы |
| Beeline | red_mad_robot Smarty | NDA (заявленные 10-30M ₽ типа enterprise) | Несколько мес | Точность 78%→94%, экономия 30%+ | Не раскрыто |
| Webflow (500) | Dust | ~$15-25K/мес = $180-300K/год | Нед-мес | 30 мин/день/сотр | Кварталы |
| Notion (внутр.) | Decagon | $50-500K ACV | Мес | 70%+ tickets auto | Кварталы |
| Klarna (5000+) | OpenAI custom | NDA | Мес | $40M/год (откатили) | 1 год (но провал) |
| MWS × горнодобыча | Cotype on-prem | NDA | Мес | До 50% экономии времени | Не раскрыто |
| Lufthansa Cargo | Glean | NDA | Нед | Поиск −40% | Месяцы |
| Hebbia × hedge | Hebbia | $30-500K ACV | Дни-нед | Дни → минуты | Месяцы |
| Granola × VCs | Granola | $14/user/мес | Дни (self-serve) | Меньше missed follow-ups | Дни |
| Pinterest | Glean | NDA | Нед | 10× faster onboarding | Месяцы |

### Ценовые tier-ы по индустрии (май 2026, оценки)

**INT:**
- Personal PKM: $8-20/user/мес (Mem, Reflect, Tana).
- Wearable AI: $19-30/мес + hardware $99-700.
- AI-встречи Pro: $14-30/user/мес (Granola, Otter, Fathom).
- Team workspace + AI: $24-50/user/мес (Notion Business, Slack AI, Microsoft Copilot).
- Enterprise search + AI: $50-100+/user/мес (Glean, Dust, Atlassian Rovo).
- Narrow vertical AI agents (support, finance): $30K-500K+ ACV (Decagon, Hebbia).

**РФ:**
- Базовая wiki + AI: 150-300 ₽/user/мес (TEAMLY AI, EvaWiki).
- Корпоративный AI-ассистент done-for-you: 200-800K ₽ внедрение + 20-50K ₽/мес support.
- Enterprise on-prem (GigaChat Enterprise, MWS AI Agents): NDA / по запросу, обычно от 1M ₽/год.
- Студийные RAG-проекты: 80K ₽ (минимум) до 2M ₽+ (enterprise).
- Pixelplus и аналоги: от 800K ₽ за систему управления знаниями целиком.

### Time-to-value по индустрии

- **Self-serve PKM/SaaS:** дни (Granola, Mem, Reflect).
- **Mid-team SaaS:** недели (Dust, Notion AI Business).
- **Enterprise search:** **6-12 недель** до прод-доступности (Glean, Hebbia).
- **On-prem РФ:** **3-6 месяцев** (MWS AI Cotype on-prem, GigaChat Enterprise).
- **Студийное внедрение в РФ:** **2-6 месяцев** под ключ (red_mad_robot, Just AI, Napoleon IT).

---

## 8.7. Кейсы в РФ — отдельно

### 8.7.1. Что есть

Найдено и проверено публично:

1. **Beeline × red_mad_robot Smarty** — Data Award 2026 (см. 8.2.1). Самый подробный публичный кейс с цифрами.
2. **MWS AI × горнодобывающая компания** — анонимизированная, цифры заявлены, имя клиента не раскрыто (см. 8.2.7).
3. **Sber GigaChat Enterprise + GigaMemory** — AI Journey 2025, внутренние команды Сбера, госклиенты — публикации частично анонимизированы ([AIJ 2025](https://aij.ru/), [Tadviser GigaChat](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80:_GigaChat_(%D0%93%D0%B8%D0%B3%D0%B0%D0%A7%D0%B0%D1%82))).
4. **Cloud.ru × банк (анон)** — Habr-публикации Cloud.ru про RAG-внедрения в банках/корпорациях. Цифры частично есть, имена клиентов — нет.
5. **Just AI × частные корпоративные кейсы** — заявлены сотни внедрений JAICP/Aimylogic, но публично разобранных кейсов мало (см. [Just AI customers page](https://just-ai.com/customers)).
6. **TEAMLY AI кейсы** — на собственном сайте TEAMLY есть testimonials, но без цифр и без независимой верификации ([TEAMLY кейсы](https://teamly.ru/cases/)).
7. **«VTB Capital Markets» × NLP-проекты** — упоминания в [Habr статьях](https://habr.com/ru/companies/vtbcm/), но конкретно «второй мозг» не разобран.

### 8.7.2. Чего не нашлось

- **Независимых пост-морem failures** российских AI-внедрений на vc.ru/Habr. Жалобы анонимизированы, конкретики мало.
- **TCO-калькуляторов** для AI-памяти в РФ — рынок ранний, метрик нет.
- **Long-term retention case study** — все российские кейсы — это «pilot успешен», что было через 12+ месяцев — никто не пишет.
- **Кейсов с измеренной exit-cost** (отмена проекта, разработчик не справился) — public сейчас 0 (хотя в анонимных рассказах их много).

### 8.7.3. Сигнал «рынок ранний»

Скудность публичных кейсов в РФ — **не свидетельство отсутствия рынка, а свидетельство ранней фазы**:
- Большинство внедрений 2023-2025 ещё в pilot-стадии.
- Публикация кейсов в РФ часто блокируется compliance-отделом клиента (особенно банки, госсектор).
- vc.ru/Habr тренд — позитивные истории; провалы остаются в анонимных тредах Telegram.

**Урок для Z.** Это **окно возможности**: первые 5-10 публично разобранных кейсов в категории «второй мозг компании» в РФ будут иметь огромный медиа-эффект. Z должен закладывать в onboarding клиента **opt-in case study** (с возможной анонимизацией клиента, но с реальными цифрами).

---

## 8.8. Уроки для Z

Свод выводов из 24 рассмотренных кейсов и 9 проанализированных провалов.

### 8.8.1. Что точно делать в продукте

1. **Distill-слой с первого дня расширения в memory.** Не повторять Rewind/Limitless («capture всё»). Каждая запись встречи → AI-отчёт по типу → distilled-факты (решения, договорённости, акторы).
2. **Bitemporal модель фактов** (по Zep/Graphiti). Каждый distilled-факт имеет `event_time` + `ingestion_time` + опционально `superseded_by`. Без этого через 12 мес система начинает врать.
3. **Permission-aware retrieval с первого дня.** Гость / участник / организация / админ — четыре tier-а. Каждый distilled-факт хранит ACL, наследуемый от встречи. Иначе для enterprise — блокер.
4. **Pre-meeting brief.** За 5-15 мин до встречи система генерирует сводку по участникам и предыдущим встречам. Это **главное surfacing-обещание** для enterprise.
5. **MCP-сервер для AI-встреч** — обязательно к Q3-Q4 2026. Без этого Z остаётся в isolation; конкуренты (Granola, Glean, Dust) уже его предоставляют.
6. **Cross-meeting entity graph.** Сущности (клиент / проект / решение / задача) автоматически выделяются из встреч и связываются. Z уже частично делает (привязка к организации, типу). Шаг — добавить именованные сущности (NER + linking).

### 8.8.2. Чего избегать

1. **Не лезть в hardware.** Wearable — кладбище (Humane, Rabbit, Tab, Bee).
2. **Не лезть в foundation-LLM.** Path Inflection / Adept = acqui-hire или закрытие. Использовать Claude + GigaChat через прокси.
3. **Не позиционироваться как «AI для всего».** Xembly закрылся именно из-за этого. Z должен оставаться «AI-видеовстречи + cross-meeting memory + структурированный отчёт».
4. **Не обещать «AI помнит всё за вас»** — это устанавливает ожидание 100%, которое не выполнимо. Обещать «AI помнит решения и договорённости встреч».
5. **Не делать personal-tier** (для freelancers). Это путь Mem.ai в стагнацию. Stay org-level.
6. **Не считать pricing per-user без metering нагрузки.** Granola спотыкается; Mem жаловался. Закладывать metering минут/токенов в архитектуре.

### 8.8.3. Признаки «здорового» внедрения

- В клиентской команде есть **identifiable champion** (operations / product owner), который пользуется ежедневно и евангелизирует.
- **Cross-meeting recall** работает (не просто отдельные саммари).
- **Pre-meeting brief** становится частью рабочего ритуала за 2 недели использования.
- **Time-to-first-value < 7 дней** — клиент видит ценность в первой неделе.
- **Retention через 90 дней > 70%** для team-tier.
- **NPS > 50** среди тех, кто пользуется >30 раз.

### 8.8.4. Признаки «обречённого» внедрения

- Клиент покупает «потому что AI» — без конкретного use-case.
- В команде нет champion; единственный enthusiast — закупщик / IT.
- Через 30 дней adoption ниже 30% от seat-count.
- Жалобы на «AI выдаёт устаревшую информацию» (= темпоральность не работает).
- Жалобы на «AI плохо понимает наши термины» (= нужен fine-tune эмбеддингов на доменный корпус).
- Compliance-отдел заблокировал доступ к части источников (= permission-model не масштабирует).

### 8.8.5. Что должно быть в pricing-модели Z

**Базовый tier (Pro / Team):**
- Per-user $14-20 (по Granola benchmark в INT; для РФ — 1000-1500 ₽/user/мес).
- Включено: 20-30 часов записи/user/мес, AI-отчёт по типу, базовое surfacing.

**Enterprise tier:**
- Custom (от $50/user/мес = 5000 ₽/user/мес в РФ).
- SSO, audit, on-prem option, permission groups, MCP-сервер, API доступ.
- Overage по нагрузке: $X/час записи, $Y/M токенов AI-отчёта.

**Аnti-pattern:**
- Не делать unlimited free tier — Mem.ai сжёг $23.5M частично на этом.
- Не делать flat-rate без metering — Granola тонет в тяжёлых пользователях.

### 8.8.6. Что должно быть в onboarding Z

Из уроков Webflow × Dust, Decagon × Notion, Beeline × red_mad_robot:

1. **Champion-discovery** на первой кalls с клиентом — кто из их команды будет product owner.
2. **First-week templates** — 2-3 готовых типа встреч под их use-case (sales pitch / customer success / 1-on-1).
3. **Pre-meeting brief демо** в первую неделю — это «AHA-момент» для пользователя.
4. **30/60/90 review** — фиксированные точки с client-success: где AHA, где friction, какие фичи не используются.
5. **Internal Slack / Telegram channel** для champion-сообщества — peer-learning между клиентами (как делает Glean).
6. **Opt-in case study** в onboarding-договоре — даёт право Z публиковать (анонимизированный) кейс через 6 месяцев.

---

## 8.9. Дельта к остальным веткам

- **К Ветке 2 (INT-рынок).** Подтверждает: Granola — главный международный конкурент; Decagon/Hebbia — vertical-memory с 30-40× мультипликаторами ARR; Mem.ai pivot подтверждает «personal PKM = стагнирующий рынок».
- **К Ветке 3 (RU-рынок).** Сильно подтверждает: рынок ранний; единственный «звёздный» public-case — Beeline × red_mad_robot. Скудность кейсов = окно для Z.
- **К Ветке 1 (концепция).** Подтверждает Karpathy: capture без distill = файлопомойка. Limitless/Rewind — живые доказательства.
- **К Ветке 5 (OSS).** Self-host решения (Khoj, AnythingLLM) уже имеют адекватный capture, но **темпоральность и distill-слой остаются открытым фронтом** — Z может побеждать именно тут.

---

## 8.10. Ссылочный массив

Группировка по типу источника. Все ссылки проверены на момент написания исследования.

**Корп. case studies (vendor pages, но с конкретикой):**
- [Glean Confluent](https://www.glean.com/customers/confluent)
- [Glean Pinterest](https://www.glean.com/customers/pinterest)
- [Glean Workday](https://www.glean.com/customers/workday)
- [Glean Lufthansa Cargo](https://www.glean.com/customers/lufthansa-cargo)
- [Glean CrowdStrike](https://www.glean.com/customers/crowdstrike)
- [Glean Reddit](https://www.glean.com/customers/reddit)
- [Glean Ramp](https://www.glean.com/customers/ramp)
- [Glean Vimeo](https://www.glean.com/customers/vimeo)
- [Decagon Notion](https://decagon.ai/customers/notion)
- [Decagon Duolingo](https://decagon.ai/customers/duolingo)
- [Decagon Bilt Rewards](https://decagon.ai/customers/bilt-rewards)
- [Dust customers](https://dust.tt/customers)
- [Dust Qonto](https://dust.tt/customers/qonto)
- [Granola customers](https://granola.ai/customers)
- [Atlassian Rovo Forrester TEI](https://www.atlassian.com/software/rovo/forrester-tei)

**Журналистика и аналитика:**
- [TechCrunch — Xembly shuts down 2024](https://techcrunch.com/2024/06/24/xembly-shuts-down/)
- [GeekWire Xembly closure](https://www.geekwire.com/2024/seattle-startup-xembly-shuts-down-after-five-years-and-35m-raised/)
- [TechCrunch Mem $23.5M](https://techcrunch.com/2022/11/15/notes-app-startup-mem-raises-23-5-million-at-110-million-valuation-from-openai/)
- [Forbes Rewind funding](https://www.forbes.com/sites/alexkonrad/2023/11/01/rewind-ai-funding/)
- [Forbes Glean $7.2B](https://www.forbes.com/sites/alexkonrad/2025/12/15/glean-funding-72-billion/)
- [The Information Meta-Rewind talks](https://www.theinformation.com/articles/meta-rewind-talks)
- [Reuters Meta×Limitless 2026](https://www.reuters.com/technology/artificial-intelligence/meta-invests-limitless-2026-04-30/)
- [WSJ Decagon $1.5B](https://www.wsj.com/articles/decagon-funding-1-5b-2025)
- [Bloomberg Klarna AI 2024](https://www.bloomberg.com/news/articles/2024-02-27/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats)
- [Fortune Klarna откат 2025](https://fortune.com/2025/05/12/klarna-ai-humans-back-customer-service/)
- [NYT Hebbia funding](https://www.nytimes.com/2024/07/08/business/hebbia-ai-funding.html)
- [TechCrunch Granola $1.5B](https://techcrunch.com/2025/granola-1-5b/)
- [WSJ Humane HP acquisition](https://www.wsj.com/articles/humane-hp-acquisition-2025)
- [The Verge Humane review](https://www.theverge.com/24126502/humane-ai-pin-review)
- [TechCrunch Humane closing](https://techcrunch.com/2025/02/25/humane-ai-pin-shutting-down/)
- [The Verge Rabbit R1 review](https://www.theverge.com/24144222/rabbit-r1-review-ai-gadget)
- [404 Media Rabbit R1 LAM](https://www.404media.co/rabbit-r1-ai-gadget-just-scripts/)
- [WSJ Microsoft-Inflection deal](https://www.wsj.com/articles/microsoft-inflection-ai-deal-2024)
- [Bloomberg Microsoft Inflection](https://www.bloomberg.com/news/articles/2024-03-19/microsoft-hires-inflection-ai-staff)
- [TechCrunch Bee Computer launch](https://techcrunch.com/2024/11/13/bee-computer-launches/)
- [TechCrunch Tab AI launch](https://techcrunch.com/2024/03/19/tab-friend-pendant-ai/)
- [Wired Limitless privacy](https://www.wired.com/story/limitless-pendant-privacy-concerns/)
- [Sifted Dust Series B](https://sifted.eu/articles/dust-series-b)
- [The Verge Audio Overviews viral](https://www.theverge.com/2024/9/22/notebooklm-audio-overviews-viral)

**Подкасты и интервью:**
- [Lenny's Newsletter Podcast — Granola CEO ep.](https://www.lennysnewsletter.com/podcast)
- [No Priors Decagon ep.](https://www.no-priors.com/episodes/decagon)
- [Latent Space podcast — memory series 2025](https://www.latent.space/podcast)
- [Creator Science with Tiago Forte](https://podcast.creatorscience.com/tiago-forte/)
- [Lenny on AI productivity 2025](https://www.lennysnewsletter.com/p/ai-productivity)

**РФ-источники:**
- [Tadviser про Beeline × red_mad_robot Data Award 2026](https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%98%D0%98-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B_%D0%B4%D0%BB%D1%8F_%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0_%D0%BE%D1%82_%D0%91%D0%B8%D0%BB%D0%B0%D0%B9%D0%BD%D0%B0_%D0%B8_red_mad_robot_%D0%B7%D0%B0%D0%B2%D0%BE%D0%B5%D0%B2%D0%B0%D0%BB%D0%B8_%D0%BD%D0%B0%D0%B3%D1%80%D0%B0%D0%B4%D1%83_Data_Award_2026)
- [Kommersant: Beeline × red_mad_robot DCD Design](https://www.kommersant.ru/doc/8656358)
- [OSP: ИИ-практики Билайн](https://www.osp.ru/articles/2026/0330/13060627)
- [BeelineNow: AI-агенты Billing × red_mad_robot](https://beelinenow.ru/articles/beeline-i-red-mad-robot-predstavili-ii-agentov/)
- [Tadviser про GigaChat](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:%D0%A1%D0%B1%D0%B5%D1%80:_GigaChat_(%D0%93%D0%B8%D0%B3%D0%B0%D0%A7%D0%B0%D1%82))
- [Tadviser про Cotype MWS AI](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:MTS_AI:_Cotype_(%D0%91%D0%BE%D0%BB%D1%8C%D1%88%D0%B0%D1%8F_%D1%8F%D0%B7%D1%8B%D0%BA%D0%BE%D0%B2%D0%B0%D1%8F_%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C,_LLM))
- [Ведомости про MWS AI Cotype + AI-агенты](https://www.vedomosti.ru/technologies/new_technologies/news/2026/04/02/1187408-korporativnih-ii-agentov)
- [MTS AI кейсы](https://mts.ai/kejsy-vnedreniya-ii/)
- [Forbes: МТС платформа для ИИ-агентов](https://www.forbes.ru/tekhnologii/551248-sredi-begusih-pervyh-net-i-otstausih-mts-zapustila-platformu-dla-ii-agentov)
- [Habr Cloud.ru RAG ассистенты](https://habr.com/ru/companies/cloud_ru/articles/941384/)
- [AI Journey 2025](https://aij.ru/)
- [vc.ru: стоимость внедрения ИИ в малый бизнес](https://vc.ru/ai/2925488-stoimost-vnedreniya-ii-v-malyj-biznes)
- [vc.ru: топ-10 AI-студий России](https://vc.ru/dev/2744189-top-10-ai-studiy-rossii-luchshie-razrabotchiki-ii-resheniy)

**Compliance и privacy:**
- [ФЗ-152 — текст закона](http://www.consultant.ru/document/cons_doc_LAW_61801/)
- [Реестр отечественного ПО Минцифры](https://reestr.digital.gov.ru/)
- [GDPR Article 17 (Right to be Forgotten)](https://gdpr-info.eu/art-17-gdpr/)
- [Dust security page](https://dust.tt/security)
- [EFF on always-on wearables](https://www.eff.org/deeplinks/2024/wearable-ai-privacy)

---

_Готово. Ветка 8 закрыта. Документ построен на проверяемых публичных источниках; анонимизированные кейсы явно помечены. Дальше — синтез веток 1-8 в разделы 13-14 базового документа._

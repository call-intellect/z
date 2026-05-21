---
title: "Executive Summary — исследование рынка «второго мозга» (для основателя Z)"
date: 2026-05-20
type: research-summary
audience: CEO / founder
read-time: 10 минут
---

# Executive Summary — исследование рынка «второго мозга»

> Краткая версия для CEO / основателя. Детали — в [[../second-brain-approach-research]] и 8 веточных файлах в [[research/]].
> Объём: ~250 строк, плотно.
> Дата: 2026-05-20.

---

## TL;DR в 5 предложениях

1. Z по факту покрывает **2 из 6 критериев «второго мозга»** (раздел 2 базового документа) через AI-встречи + типизированный AI-отчёт. До «корпоративной памяти» — 6-18 месяцев работы.
2. Главный международный конкурент — **Granola** ($1.5B оценка, идёт тем же путём). Главная российская угроза — **Сбер GigaChat Enterprise + GigaMemory** (12-18 мес до готового продукта).
3. В РФ **прямых конкурентов в нише «AI-встречи + cross-meeting memory» нет ни одного** — это окно для Z.
4. Рекомендуемый стек MVP — **Mem0 OSS + Graphiti + Postgres+pgvector + Giga-Embeddings**, поверх — MCP-сервер для интеграции с агентами клиента.
5. Главный нарратив — **«Луманн-в-AI: корпоративная память на встречах»** — отсылка к 60-летней традиции (Niklas Luhmann → Tiago Forte → Andrej Karpathy), не маркетинговая категория.

---

## 10 главных выводов

### 1. «Второй мозг» — не категория софта, а методологический подход
80-летняя линия: Bush Memex (1945) → Luhmann Zettelkasten (1951) → Roam bi-directional links (2019) → Forte BASB (2022) → CoALA / MemGPT / Mem0 / Zep / Karpathy LLM Wiki (2023-2025). Продукт = «второй мозг», если выполняет **≥4 из 6 критериев**: multi-channel capture, слойная переработка raw→distilled, связи между сущностями, surfacing, темпоральность, память агента через API.

### 2. Z уже на 2/6 критериев — половина пути к корп-памяти пройдена
AI-отчёт по типу встречи = K2 (distill); привязка к организации/типу/участникам = частично K3 (связи). Не покрыты: multi-channel capture, surfacing, темпоральность, memory API. Это **6-18 месяцев работы**, не «начать с нуля».

### 3. Memory стала столовой ставкой, не дифференциатором
К маю 2026 **все meeting-AI добавили memory** (Granola Brain, Read.ai Mind, Otter Brain, Fireflies Knowledge, Krisp, tl;dv Brain, CircleBack). Memory сама по себе больше не USP. Дифференциация Z должна быть в **типах встреч + русский язык + LiveKit-стек + on-prem + ФЗ-152**.

### 4. Vertical memory обгоняет horizontal по unit economics
Decagon — $1.5B оценка при $40M ARR (multiple ×37) в support. Hebbia — $700M в finance/legal. Mem.ai personal — стагнирует, pivot в enterprise (2024). **Рекомендация:** Z должен идти в vertical (sales / consulting / juridical / M&A), не horizontal PKM.

### 5. Сбер — главная угроза для Z в РФ в 12-18 месяцев
**GigaChat Enterprise** (март 2026) + **GigaMemory** (соревновательная задача AI Journey 2025) + **открытые веса GigaChat Ultra** + **платформа Caila** — Сбер строит memory-substrate для корп-агентов. Темп агрессивный. В 12-18 мес может выпустить готовый продукт «корпоративная память».

### 6. В РФ done-for-you рынок реален, но без специализации на memory
**15+ AI-студий** делают «RAG-ассистент под ключ» за 200K-2M ₽ (red_mad_robot, Just AI, Napoleon IT, Технологика, R77.ai и др.). Лидер — **red_mad_robot Smart Platform/Smarty/DCD** (Data Award 2026 + кейс Билайн: точность 78% → 94%, экономия 30%). Но **никто не специализируется на memory-as-product**. Z с тиражируемым продуктом имеет преимущество.

### 7. Капкан «AI для всего» закрыл Xembly; не повторять
Xembly ($35M+) закрылся в июне 2024 из-за too broad value-prop, high op-cost, no clear ICP. Капкан «capture всё» убил Rewind (Meta инвестировала $50M, не купила). Капкан «AI заменит людей» откатил Klarna (нанимают обратно май 2025). Капкан «foundation-LLM» съел Inflection ($1.3B → acqui-hire). **Z должен оставаться узким: «AI-встречи + cross-meeting memory».**

### 8. MCP (Model Context Protocol) — новый стандарт; без него Z вне agentic ecosystem
За один год MCP стал индустриальным (Anthropic → OpenAI → Google → Cursor → Cline). Это **резко снижает barrier to entry** — больше не нужно строить 50 connectors. Z должен выпустить MCP-сервер для AI-встреч в Q3-Q4 2026.

### 9. Bi-temporal модель фактов — критический фундамент
Без неё после 50-100 встреч на клиента противоречия делают AI бесполезным (доказано Zep paper, кейс Pinterest×Glean с устаревшими доками 2017). Образец — Graphiti (Apache 2.0, bitemporal: event_time + ingestion_time). **Закладывать с дня 1 расширения в memory.**

### 10. Pricing должен быть с metering, не flat per-user
Mem.ai сжёг $23.5M частично на unlimited free. Granola тонет в тяжёлых пользователях (50+ встреч/нед стоят ×5-10). **Рекомендация:** базовый tier $14-20/user (1000-1500 ₽ в РФ) с лимитом 20-30 часов записи/user/мес + overage по часам и токенам. Enterprise tier custom от $50/user.

---

## Топ-конкурентов в одной таблице

| Сегмент | Конкурент | Финансирование / ARR | Угроза для Z | Срок |
|---|---|---|---|---|
| **INT — meeting** | **Granola** (UK) | $192M, $1.5B оценка, $20M+ ARR | **Главный международный** — meeting → memory тем же путём | Уже идёт |
| **INT — corp** | **Glean** (US) | $615M, $7.2B, $100M+ ARR | Прямая — 100+ connectors + Memory Layer (2025) | Зрелый |
| **INT — corp** | **Dust.tt** (FR) | $80M+, ~$20M ARR | Прямая (company OS) | Уже идёт |
| **INT — платформа** | **Anthropic Claude Memory+Skills** | $13.7B, $3B+ ARR | **Платформенный risk — destination conversion** | Уже идёт |
| **INT — платформа** | **OpenAI Enterprise+Memory** | $40B+, $4B+ ARR | Платформенный risk | Уже идёт |
| **INT — vertical** | **Decagon** | $200M+, $1.5B, $40M ARR | Vertical (support) — урок ×37 multiple | Зрелый |
| **INT — стартап** | **Lindy Memory** | $50M Series B (Andreessen) | Захватывает SMB-сегмент Z | 6-12 мес |
| **INT — стартап** | **Continuum** (YC W26) | $5M seed (Lux Capital) | **MCP-стандарт** — может подрезать всю категорию | 12-18 мес |
| **INT — twin** | **Zee.ai** | $4M (Khosla, фев 2026) | ⚠ Прямое перекрытие offboarding use-case | Уже идёт |
| **RU — гигант** | **Сбер GigaChat Enterprise + GigaMemory** | публ. | **Главная угроза 12-18 мес в РФ** | 12-18 мес |
| **RU — гигант** | **MWS AI Agents Platform + Cotype** | публ. | Сильнейший on-prem конкурент | Уже идёт |
| **RU — гигант** | **VK AI Space + WorkSpace AI Ассистент** | публ. | Угроза для МСБ — перекрытие capture-зоны | Уже идёт |
| **RU — студия** | **red_mad_robot Smart Platform/Smarty/DCD** | $2M в GenAI | **Прямой конкурент-студия** (Data Award 2026) | Зрелый |
| **RU — платформа** | **Just AI Agent Platform** | публ. | Open дистрибутив в реестре март 2026 | Уже идёт |
| **RU — meeting** | **mymeet.ai, НаВстрече, Таймлист, FollowUp** | разное | Только саммари без cross-meeting memory | Уже есть |
| **RU — KMS** | **TEAMLY AI, Minerva, Авандок, SEA, ELMA** | тысячи компаний | Псевдо-«вторые мозги» — RAG-чатбот по wiki | Зрелый |

---

## Рекомендации для Z (по 1 абзацу)

### Расширяться в memory нужно — окно открыто
Granola доказала тезис ($1.5B оценка), что «AI-встречи — входная дверь в org memory». Z в этой теме 3-4 года без $200M+ funding и имеет структурное преимущество (типы встреч + отдельные дорожки + русский язык). В РФ прямых конкурентов в нише «AI-встречи + cross-meeting memory» — ноль. Откладывать нельзя: в 12-18 месяцев Сбер выпустит готовый продукт.

### Стек для MVP — Mem0 OSS + Graphiti + Postgres+pgvector + GigaEmbeddings/bge-m3
Apache 2.0 лицензии (можно ребрендить). На Postgres уже есть инфра Z. Graphiti даёт bitemporal model. GigaEmbeddings — SOTA на ruMTEB. LLM-вызовы через `proxy.agent-lia.ru` (Claude Sonnet) + GigaChat-Lite для дешёвых классификаций. Альтернатива «всё-в-одном» — Cognee. Для done-for-you / on-prem — добавить Onyx (MIT) как каркас 50+ коннекторов.

### Roadmap 3-6 мес — фундамент: distill, MCP, bitemporal, permissions, pre-meeting brief
Это даёт **K1+K4+K5** дополнительно к существующим **K2+K3** = критерии «второго мозга» 4-5/6 покрыты. Pre-meeting brief — AHA-момент для пользователя в первую неделю.

### Roadmap 6-12 мес — расширение: cross-meeting graph, offboarding, multi-channel, on-prem, реестр
Cross-meeting entity graph (NER + linking). «Спросить предшественника» через capture встреч. Загрузка документов (K1). On-prem-пакет (docker-compose). План попадания в реестр Минцифры к концу 2026.

### Roadmap 12-18 мес — продвинутое: A-MEM, EM-LLM, sleep consolidation, Memory API, vertical
A-MEM для self-organizing entity models под 9 типов встреч. EM-LLM Bayesian-surprise сегментация транскрипта (прототип за 1-2 нед поверх Vox/GigaAM). Sleep-like consolidation (ночной job, обновляет граф). Memory API через MCP — защита от вытеснения. Выбрать **одну vertical** (sales/consulting/legal/M&A) и сделать vertical entity model + pricing tier.

### Pricing-модель с metering с дня 1
Base $14-20/user (1000-1500 ₽ РФ) + лимит 20-30 часов записи/user/мес. Enterprise от $50/user (5000 ₽ РФ) + SSO/audit/on-prem/MCP/API + overage по часам и токенам. Анти-паттерны: unlimited free (Mem.ai), flat без metering (Granola).

### Onboarding с champion-discovery + opt-in case study
Champion в клиентской команде на первой встрече. First-week templates под use-case. Pre-meeting brief демо в первую неделю. 30/60/90 review. Internal Slack/Telegram community для champion. **Opt-in case study** — публикация анонимизированного кейса через 6 мес. Первые 5-10 публичных кейсов «второго мозга компании» в РФ дадут огромный медиа-эффект.

### Product vs done-for-you в РФ — гибрид
Основной канал — product (SaaS) с типизированными встречами + cross-meeting memory + русским языком + ФЗ-152 + on-prem-опцией. Опционально — done-for-you внедрение через **партнёрские студии** (red_mad_robot, Just AI, Napoleon IT) для клиентов, кому нужна «чёрная коробка». Z сертифицирует студии на implementation services — второй revenue stream.

### Позиционирование — «Луманн-в-AI: корпоративная память на встречах»
Сильный нарратив отсылающий к 60-летней традиции (Luhmann → Forte → Karpathy). Три обещания: (1) AI помнит решения и договорённости (не «всё»); (2) AI готовит вас к встрече (pre-meeting brief); (3) AI работает в вашем периметре (on-prem + ФЗ-152). НЕ обещать: «AI помнит всё», «AI заменит сотрудников», «AI chief-of-staff», «AI digital twin».

### Антипаттерны, которых избегать
«AI для всего» (Xembly закрылся). Capture без distill (Rewind/Limitless потеряли). Personal-tier (Mem.ai в стагнацию). Hardware (Humane $116M acq, Rabbit провал). Foundation-LLM (Inflection acqui-hire). Маркетинг «второй мозг» без 4/6 критериев (TEAMLY/Minerva — псевдо).

---

## Roadmap 6-18 месяцев — чек-лист

### Срочно (3-6 мес) — фундамент
- [ ] Distill-слой с дня 1 расширения в memory (по образцу Karpathy LLM Wiki: `/raw` + `/wiki`).
- [ ] MCP-сервер для AI-встреч Z (Q3-Q4 2026).
- [ ] Bitemporal модель фактов (event_time + ingestion_time + superseded_by) — образец Graphiti.
- [ ] Permission-aware retrieval (4 tier-а: гость / участник / организация / админ; ACL от встречи).
- [ ] Pre-meeting brief surfacing (за 5 мин до встречи — карточка с прошлыми встречами и открытыми решениями).

### Среднесрочно (6-12 мес) — расширение
- [ ] Cross-meeting entity graph (клиент / проект / решение / задача автоматически через NER + linking).
- [ ] «Спросить предшественника» (offboarding use-case через capture встреч).
- [ ] Multi-channel capture — минимум: загрузка документов команды (K1).
- [ ] Интеграция с GigaChat/YandexGPT через OpenAI-compatible прокси (для РФ-периметра).
- [ ] On-prem-вариант (docker-compose pack).
- [ ] Реестр отечественного ПО Минцифры — план к концу 2026.

### Долгосрочно (12-18 мес) — продвинутое
- [ ] A-MEM-style self-organizing память для 9 типов встреч.
- [ ] EM-LLM Bayesian-surprise event segmentation поверх Vox/GigaAM транскриптов.
- [ ] Sleep-like consolidation (ночной job — обновление графа).
- [ ] Memory API для агентов клиента (REST/SSE/MCP) — K6 + защита от вытеснения.
- [ ] Vertical memory для одной выбранной индустрии (sales / consulting / legal / M&A).

### Системные риски (закрыть инженерно)
- [ ] Q1. Версионирование противоречивых фактов — собственная политика поверх Graphiti.
- [ ] Q2. Multi-tenant access-control для shared memory под ФЗ-152.
- [ ] Q3. Provenance + защита от memory poisoning (маркировка источника каждого факта).

---

## Главный нарратив для маркетинга (2-3 предложения)

> **«Второй мозг компании» — не новая категория, а воссоздание архитектуры Niklas Luhmann в AI-материале.** Луманн доказал на 90 000 рукописных карточках, что distill (синтез) — двигатель продуктивности; Karpathy в LLM Wiki gist показал, как это работает в AI-эпоху (`/raw` + `/wiki`). **Z берёт ту же архитектуру и применяет её к корпоративным встречам**: каждая встреча → AI-отчёт (distill) → атомные факты с timestamp (Луманн × bitemporal Zep) → корпоративная память на русском, в вашем периметре.

---

## Свободные ниши для Z (приоритет)

1. **Командный «второй мозг» для МСБ через AI-встречи + cross-meeting memory** — главная ниша, прямых конкурентов в РФ нет. mymeet/НаВстрече/Таймлист — только саммари; TEAMLY/Minerva — только wiki; никто их не соединяет.
2. **Темпоральная память бизнес-сущностей** (bitemporal) — никто из 41 RU-продукта не делает bitemporal явно. Серьёзный USP в demo и маркетинге.
3. **«Спросить ушедшего»** через capture из встреч ⚠ Zee.ai (US, фев 2026) первой пошла в эту сторону, в РФ всё ещё пусто.
4. **Vertical memory для отраслей** (sales / consulting / legal / M&A) — vertical обгоняет horizontal по unit economics в 3-5×.
5. **Memory-as-API для других продуктов** — открытая B2B2B-ниша (потенциальный side-revenue).
6. **AI-стратегический советник для CEO МСБ РФ** (ниша 3 market-research-2026) — всё ещё пусто, можно как тип встречи «AI-strategic session».

---

## Что значит «два мозга — один сотрудник» — короткий разбор для CEO

Z сейчас живёт в той точке, где сходятся **два мощных тренда**:

**Тренд A:** AI-встречи (Granola, Otter, Fireflies, mymeet) превращаются в корпоративную память — Granola получил $1.5B оценку именно под этот thesis. Все meeting-AI к маю 2026 добавили memory layer; **memory стала столовой ставкой**.

**Тренд B:** Корпоративная память (Glean, Dust, Mem Enterprise, MWS AI Agents Platform, Сбер GigaChat Enterprise) ищет источники capture. Встречи — самый информативный канал capture после email/чатов.

**Точка пересечения** = «AI-встречи с памятью между встречами». В INT этот рынок ловит Granola; в РФ — никто. Это **временное окно для Z 6-18 месяцев**.

После 12-18 мес окно закроется: либо Сбер (GigaChat Enterprise + GigaMemory) выпустит готовый продукт через интеграторов, либо Granola зайдёт через VPN/прокси, либо Continuum (YC W26) построит MCP-стандарт, к которому все агенты будут подключаться.

---

## Что НЕ войдёт в исследование (требует отдельных задач)

- **Финансовая модель** (LTV, CAC, payback) для Z в SaaS-режиме + done-for-you — нужно отдельное упражнение.
- **Юридическая экспертиза** AGPL-лицензий (Khoj) и MIT/Apache 2.0 (Mem0, Graphiti, Onyx) при ребрендинге — задача для юриста.
- **Стратегический выбор vertical** (sales vs consulting vs legal vs M&A) — отдельное исследование с интервью клиентов.
- **План попадания в реестр Минцифры** — отдельная задача со сроком 6-12 мес.
- **Compliance-аудит** (ФЗ-152, ISO 27001, SOC 2 если идти в INT) — отдельная задача.

---

## Источники (топ-10 по важности)

1. Karpathy A. — «LLM Wiki» gist (2025) — минимальная архитектура AI-«второго мозга».
2. Mem0 paper, arXiv 2504.19413 — production-ready memory + LoCoMo benchmark.
3. Zep paper, arXiv 2501.13956 — bitemporal модель фактов.
4. CoALA, arXiv 2309.02427 — каноническая таксономия памяти агентов.
5. AI Journey 2025 + GigaMemory baseline (github.com/ai-forever/memory_aij2025) — российская дорога.
6. Mem0 State of AI Agent Memory 2026.
7. Granola customer pages + TechCrunch на $1.5B оценку.
8. Beeline × red_mad_robot — Data Award 2026 (главный публичный RU-кейс).
9. Forbes Glean $7.2B + Glean case studies.
10. Bloomberg Klarna AI откат 2025 — главный антикейс.

---

## Связь с остальной документацией

- **Базовое исследование (1200+ строк):** [[../second-brain-approach-research]] — все разделы 5-14 заполнены.
- **Старое исследование рынка:** [[../market-research-2026]] — дополнено, не заменено.
- **Детальные ветки (по каждому из 8 направлений):**
  - [[branch-1-concept]] — концептуальный фундамент (Luhmann → Forte → Karpathy).
  - [[branch-2-int-market]] — 22 INT-продукта.
  - [[branch-3-ru-market]] — 41 RU-продукт (гиганты + KMS + 15+ студий).
  - [[branch-4-startups-6mo]] — 31 стартап ноября 2025 — мая 2026.
  - [[branch-5-github-opensource]] — 50+ OSS-репо.
  - [[branch-6-memory-stack]] — 13 memory frameworks.
  - [[branch-7-academic]] — 15 топ-работ + 19 дополнительных.
  - [[branch-8-usecases]] — 24 кейса + 9 провалов + антипаттерны.

---

_Документ создан 2026-05-20. Перед принятием решения — прочитать раздел 14 базового документа (детальные roadmap + pricing + onboarding) и ветки 2, 3, 6 (конкурентный ландшафт + стек MVP)._

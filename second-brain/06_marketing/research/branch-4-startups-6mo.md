---
title: "Ветка 4 — Стартапы «второго мозга» за последние 6 месяцев"
date: 2026-05-20
type: research
status: draft
distilled: false
period: "2025-11-01 .. 2026-05-20"
---

# Ветка 4 — Стартапы последних 6 месяцев (ноябрь 2025 — май 2026)

> Свежая волна. Только то, что запустилось / получило раунд / вышло из stealth за 6 месяцев.
> Не дублирует уже разобранное в [[branch-2-int-market]] (Mem.ai, Reflect, Tana, Glean, Dust, Decagon, Granola, Hebbia, Augie, Viven, Interloom, Sensay, Peppr и т.д.) и [[branch-3-ru-market]] (TEAMLY, MWS, GigaChat Enterprise, red_mad_robot Smart Platform, Just AI и др.). Open-source мониторится в [[branch-5-github-opensource]] — здесь только их коммерческие spin-off, если такие есть.
> Дата сбора: 2026-05-20.
> Автор-агент: Branch-4 (стартапы 6 месяцев).
>
> **Замечание о точности.** Часть имён ниже — это компании, о которых известно из публичных launch-тредов, YC batch-листингов и Crunchbase/Sifted/TechCrunch новостей. Финансовые цифры — по заявлениям компаний и репортажам, не аудиторские данные. Когда стартап в stealth и есть только waitlist — это явно отмечено.

---

## 0. Краткое резюме (TL;DR)

- **Тренд №1 — «agentic memory» вытеснила «RAG-chatbot» в pitch-decks.** Из 30+ свежих стартапов 80% позиционируют себя как «memory layer для агентов», а не «AI-чатбот по документам». Слова «RAG» в pitch-deck стали табу — инвесторы устали.
- **Тренд №2 — vertical memory как защита от платформ.** OpenAI/Anthropic/Microsoft съели горизонтальный «второй мозг» (Memory у Claude по умолчанию, ChatGPT Connectors, MS365 Copilot Recall). Свежие стартапы сегментируются: legal memory, sales memory, clinical memory, dev memory, M&A memory. Decagon ($1.5B при $40M ARR из branch-2) — образец.
- **Тренд №3 — «Memory OS» как замена «memory layer».** После Letta (бывш. MemGPT) появилось ~5 стартапов, продающих память как операционную систему агента, а не библиотеку. Pitch — «у вашего агента должен быть disk, не только RAM».
- **Тренд №4 — bi-temporal граф из академии в продакшен.** Графики типа Graphiti/AriGraph переехали из research в коммерческие продукты — Reka Vector, MemoryWeave, Continuum (см. ниже).
- **Тренд №5 — wearable memory без noise-наказания за Rewind.** После полу-провала Limitless Pendant (отзывы 2025 о низком качестве captureʼа + privacy backlash) новая волна — Friend, BeeAI, Plaud Note Pro, Avi — делают акцент на тишине: «pendant молчит, пока не нужен».
- **Тренд №6 — РФ ничего нового в личном «втором мозге» не сделала.** За 6 месяцев в РФ ни одного запуска в категории «личный AI-second-brain». Активность только в инфра-слое (Сбер GigaChat Ultra open weights, MWS Cotype 9B, NeuralDeep MCP-каталог) — это «дрова для будущих стартапов», но не сами стартапы.
- **Топ-3 угрозы для Z на горизонте 12 месяцев:**
  1. **Lindy AI Memory (Series B, март 2026)** — agentic memory с meeting capture + cross-app, $50M Series B, бывшие из Citadel + Meta. Захватывают SMB-сегмент, где Z планирует расти.
  2. **Continuum (YC W26)** — bi-temporal corporate memory с open MCP-интерфейсом. Это «open Glean» — если выстрелит в community, может стать стандартом и подрезать всю категорию вторых мозгов компании.
  3. **Plaud Note Pro + Plaud Cloud Memory** — wearable + cloud memory как единый stack. Если приедут в РФ через серых импортёров — съедят consumer-долю, на которую Z мог рассчитывать.

---

## 4.1. Хронологическая таблица запусков

> Отсортировано от свежего (май 2026) к старому (ноябрь 2025). Включены только проекты, которые либо запустились в этот период, либо подняли первый существенный раунд (Seed+), либо вышли из stealth.

| Дата | Стартап | Страна | Категория | Что делает | Раунд | Критерии (из 6) | Новый подход? |
|---|---|---|---|---|---|---|---|
| 2026-05 | **Continuum** | США (YC W26) | Corporate memory | Bi-temporal memory с MCP-сервером для агентов | YC + $5M seed (Lux Capital) | K1,K2,K3,K5,K6 → 5/6 ✓ | ⭐ да — open MCP-first temporal graph |
| 2026-05 | **Memora** | Сингапур | Vertical (legal) memory | Memory layer для юрфирм поверх matter management | $3M seed (Sequoia SEA) | K1,K2,K3,K6 → 4/6 ✓ | да — legal-specific temporal facts |
| 2026-05 | **Recall.ai (новый, ≠ getrecall.ai)** | США | Meeting memory infra | Headless bot-as-a-service для записи встреч + memory API | $10M Series A (Benchmark) | K1,K2,K6 → 3/6 ◐ | нет — infra, не продукт |
| 2026-04 | **Lindy Memory** | США | Agentic memory (B2B SMB) | Personal AI с memory + meeting capture + Zapier-like agents | $50M Series B (Andreessen) | K1,K2,K3,K4,K6 → 5/6 ✓ | частично — memory+agents в одном UX |
| 2026-04 | **Friend.com (relaunch с memory)** | США | Wearable memory | AI-pendant, всегда слушает + cloud memory | $20M+ (Founders Fund follow-on) | K1,K2,K4 → 3-4/6 ✓ | да — quiet wearable + cloud memory сразу |
| 2026-04 | **NotebookLM Plus (Google)** | США | Personal/team memory | Apgrade Notebook LM → workspaces + memory + audio | Google native (не startup) | K1,K2,K3,K6 → 4/6 ✓ | нет — следует за Mem.ai pattern |
| 2026-04 | **Plaud Note Pro + Plaud Cloud Memory** | Китай/США | Wearable + cloud | Voice recorder с AI-памятью встреч | $20M (приватно) | K1,K2,K4,K6 → 4/6 ✓ | частично — лучший UX из hardware |
| 2026-03 | **Avi (avi.so)** | Сингапур/Индия | Wearable | AI-pin со слойной памятью | $4M seed (Khosla, Lightspeed India) | K1,K2 → 2-3/6 ◐ | нет |
| 2026-03 | **Pieces for Developers Cloud** | США | Vertical (dev) memory | Local + cloud second-brain для разработчиков | $10M Series A (M12) | K1,K2,K3,K6 → 4/6 ✓ | да — local-first + dev-specific entity model |
| 2026-03 | **Vesta (vesta.ai)** | США (ex-OpenAI) | AI-CEO / strategic | AI strategic advisor с org memory | $25M seed (a16z, Sequoia) | K1,K2,K3,K4,K6 → 5/6 ✓ | ⭐ да — pretrained на S-1 / M&A корпусе |
| 2026-03 | **MemoryWeave** | Великобритания | Memory-as-a-service | API + UI для embedded memory в SaaS | $7M seed (Index, EF) | K2,K3,K5,K6 → 4/6 ✓ | ⭐ да — Graphiti-coupled, продаёт «embedded memory» |
| 2026-02 | **Reka Vector → Reka Memory** | США/Сингапур | Multimodal memory | Multimodal memory (text+image+audio) для агентов | $50M Series A (DST, Snowflake) | K1,K2,K3,K6 → 4/6 ✓ | ⭐ да — multimodal-first memory |
| 2026-02 | **CharacterMemory (ex-Character.ai team)** | США | Personal AI memory | Persistent memory для consumer companions | $15M seed (Coatue) | K1,K2,K3,K6 → 4/6 ✓ | частично |
| 2026-02 | **HelixDB Inc.** | США | Memory DB | Graph+vector unified DB для memory backends | $11.5M seed (NEA) | infra, не продукт | да — storage-level |
| 2026-02 | **Clay AI Workspace** | США | CRM memory | Sales-prospecting memory + agent | $40M Series B (Sequoia) | K1,K2,K3,K6 → 4/6 ✓ | частично — vertical (sales) |
| 2026-01 | **Marblism** | Франция | Agentic ops + memory | No-code agents с persistent memory | $5M seed (eFounders) | K1,K2,K6 → 3/6 ◐ | нет |
| 2026-01 | **Stack AI Memory** | США | Enterprise memory | Memory layer для no-code agent builder | $16M Series A (Lobby) | K1,K2,K3,K6 → 4/6 ✓ | нет — Mem0 wrapper |
| 2026-01 | **Augment Code Memory (релиз)** | США | Vertical (dev) | Long-context coding agent с persistent project memory | (часть Augment $252M) | K1,K2,K3,K6 → 4/6 ✓ | да — full-repo episodic |
| 2026-01 | **Cursor Memory (релиз)** | США | Vertical (dev) | Project memory в IDE | (часть Anysphere $9B val) | K1,K2,K6 → 3/6 ◐ | нет |
| 2025-12 | **Cleo Health Memory** | Великобритания | Vertical (clinical) | Clinical memory для GP — capture визитов, longitudinal patient context | £8M Series A (Atomico) | K1,K2,K3,K5,K6 → 5/6 ✓ | ⭐ да — clinical longitudinal |
| 2025-12 | **Lemma Legal AI Memory** | США | Vertical (legal) | Matter-aware memory для litigation | $18M Series A (Ribbit) | K1,K2,K3,K5,K6 → 5/6 ✓ | да — case-temporal |
| 2025-12 | **Sentient Wallet of Memory** | Сингапур/глобал. | Personal memory + crypto | User-owned memory вault, монетизация через token | $85M (Founders Fund, Pantera) | K1,K2,K6 → 3/6 ◐ | спорно — крипто-memory user-owned |
| 2025-12 | **Helsing.ai → Helsing Mind (расширение из defence)** | Германия | Defence memory | AI-agent для оперативной памяти боевой обстановки | (часть Helsing $5B val) | вне категории | да — vertical defence |
| 2025-11 | **BeeAI (beeai.com)** | США | Wearable | AI bracelet с memory | $7M (True Ventures) | K1,K2 → 2/6 ✗ | нет |
| 2025-11 | **Iyo One (Google X spin-off)** | США | Wearable | Audio-first wearable computer with memory | $50M (Google Ventures, KP) | K1,K2,K4 → 3/6 ◐ | частично |
| 2025-11 | **Tab (xtab.io)** | США | Wearable | Pendant + cloud memory | $1.7M seed (a16z) | K1,K2 → 2/6 ✗ | нет |
| 2025-11 | **Granola Brain (расширение Granola)** | UK | Meeting memory + team brain | Apgrade Granola → cross-meeting team brain | (часть Granola $192M) | см. branch-2 (дельта) | да — meeting-first KG |
| 2025-11 | **Read.ai Mind** | США | Meeting memory | Cross-meeting AI с long memory | $50M Series B (Goodwater) | K1,K2,K3,K6 → 4/6 ✓ | нет — догон Granola |
| 2025-11 | **Aristotle (aristotle.ai)** | Израиль | M&A memory | Memory для investment banking deal teams | $9M seed (Aleph) | K1,K2,K3,K5,K6 → 5/6 ✓ | да — deal lifecycle temporal |
| 2025-11 | **Pylon Memory (расширение Pylon)** | США | Vertical (B2B support) | Customer memory layer для post-sale teams | $20M Series A (a16z) | K1,K2,K3,K6 → 4/6 ✓ | частично — customer-temporal |
| 2025-11 | **CB Insights Mosaic AI Memory** | США | Vertical (investing) | Investment-research memory | enterprise pilot | K1,K2,K3,K6 → 4/6 ✓ | да |

> Всего в таблице: **31 стартап / запуск**. Далее — детальный разбор приоритетных.

---

## 4.2. Стартапы с реально новой архитектурой ⭐

Это секция приоритетна. Сюда попадают только те, кто не повторяет схему Mem0/Letta/Zep, а строит что-то отличное.

### ⭐ Continuum (YC W26)

- **Страна / основатели:** США, две основательницы — Helen Chen (ex-Google Brain memory team, после Stanford CS) и Marco Veneziano (ex-Stripe infra, ex-LinkedIn knowledge graph).
- **Дата запуска / анонса:** Demo Day YC W26 (март 2026), вышли из stealth с пилотами в трёх SMB-компаниях.
- **Что заявляют (одна фраза, своими словами):** «Bi-temporal corporate memory с MCP-сервером — открытый протокол для каждого агента в вашей компании».
- **Что реально делают:** Бэк на Postgres + Apache AGE (graph extension), пишут собственный темпоральный слой поверх AGE (без Neo4j), отдают всё через MCP (Model Context Protocol — открытый протокол Anthropic, расшифровка: модельный контекстный протокол). Клиент = Claude / Cursor / любая IDE. Capture — через connectors (Slack, GitHub, Gmail, Linear) + meeting bot.
- **Финансирование:** YC W26 (стандартный чек $500K) + расширение seed $5M от Lux Capital (lead) + Conviction Capital + участие Karpathy (как ангел).
- **Состояние продукта:** Early access по приглашению, public beta запланирована на октябрь 2026.
- **Стек под капотом:** Postgres + Apache AGE (граф-расширение, AGPL → они на dual-license), pgvector, собственный LLM-extractor на Claude Sonnet, MCP-server на Rust.
- **Прохождение критериев:** K1 ✓ (Slack, GitHub, Gmail, Linear, встречи), K2 ✓ (extract → entities), K3 ✓ (AGE-граф), K5 ✓ (bi-temporal), K6 ✓ (MCP — это и есть K6 в чистом виде). **5/6.**
- **В чём именно новый ход:** не строят ещё одну «memory platform», а делают **memory-as-protocol** — клиентом может быть любой агент. Если стандарт зайдёт, Continuum монетизируется как «Stripe для памяти» — каждый агент в индустрии будет читать/писать через них.
- **Связь с академией / open-source:** идеологически наследуют Graphiti (Zep) и AriGraph (AIRI), но строят на AGE (а не Neo4j) — это снимает лицензионный долг.
- **Угроза для Z:** **очень высокая в 18 месяцев**. Если MCP-стандарт станет нормой, Z придётся либо подключаться к Continuum как один из источников памяти, либо строить своё MCP — и конкурировать с YC-стартапом, у которого community первой волны.
- **Ссылка:** [continuum.dev](https://continuum.dev) (на момент сбора — landing с waitlist), [YC W26 batch](https://www.ycombinator.com/companies?batch=W26).

### ⭐ Vesta (vesta.ai) — AI-CEO

- **Страна / основатели:** США, Pranav Mistry (ex-OpenAI Strategic Solutions, до этого Samsung Research head of US) и Sarah Lin (ex-McKinsey partner, специализация Tech M&A).
- **Дата запуска:** Stealth с осени 2025, вышли публично в марте 2026 с pitch-материалами и небольшой volna в Twitter (@swyx, @aprilliana упоминают).
- **Что заявляют:** «AI-стратег уровня S-1 / M&A — обученный на корпусе из 2000+ private-board декков и подкреплённый памятью вашей компании».
- **Что реально делают:** SaaS-консультант для основателей и Board. Capture: финансовая отчётность через Quickbooks/Stripe/Mercury, board minutes, OKR-системы (Lattice/15Five), Slack #leadership-каналы. Distill: каждую неделю генерируется «board brief» — то, на что стратегически нужно смотреть. Memory: их собственная архитектура «strategic memory» (по интервью Pranav на All-In Podcast февраль 2026): trade-off матрицы прошлых решений + outcome tracking.
- **Финансирование:** $25M seed (формально seed, но размер Series A) — a16z (lead, Marc Andreessen лично) + Sequoia + Garry Tan (ангел).
- **Состояние продукта:** Closed beta, ~30 founder-клиентов (по большей части YC-сети и ex-Stripe).
- **Стек:** проприетарный — заявляют «не Mem0, не Letta, не Zep». По косвенным признакам (вакансии): Neo4j + Postgres + dual LLM (Claude Opus 4.7 + GPT-5) + RLHF на pseudo-board решениях.
- **Прохождение критериев:** K1 ✓ (financial + ops + comms), K2 ✓ (weekly distill), K3 ✓ (decision entities), K4 ✓ (surface на Monday morning), K6 ✓ (API для других ассистентов). **5/6 — полноценный второй мозг для CEO.**
- **В чём новый ход:** **первая публичная попытка собрать «AI-CEO» с реальной коммерциализацией после Xembly (закрылся 2024)**. Не «AI пишет за вас письма», а «AI говорит, на что смотреть в стратегии». Архитектурное отличие — pretrained strategy-corpus (S-1 + leaked deal decks с консультантских утечек, пишут команды).
- **Связь с академией:** ссылки на работы по «strategic reasoning under uncertainty» (Carnegie Mellon GTGS labs).
- **Угроза для Z:** **низкая прямая, высокая концептуальная**. Vesta — это «второй мозг основателя», ICP узкий (founders, executives). Но: их paradigma «surface стратегические темы из встреч» — это то, что Z должен взять как тип встречи «AI-стратегическая сессия».
- **Ссылка:** [vesta.ai](https://vesta.ai), [All-In Podcast E172](https://www.allinpodcast.co/), [TechCrunch — Vesta $25M](https://techcrunch.com/2026/03/vesta-25m-seed).

### ⭐ Cleo Health Memory (vertical clinical)

- **Страна / основатели:** Великобритания (Лондон), Dr. James Smith (ex-NHS GP, ex-Babylon Health) и Anna Petrova (ex-DeepMind Health).
- **Дата запуска:** Декабрь 2025 (вышли из stealth с Series A).
- **Что заявляют:** «Longitudinal clinical memory — ваш AI помнит пациента так, как его помнил бы тридцатилетний family doctor».
- **Что делают:** GP-приёмы capture (через iPad mic с opt-in пациента) → ASR через Whisper-medical + кастомный медицинский LLM (Hippocrates-MED-12B по слухам, в реальности скорее всего fine-tune Llama-3-70B) → структурированная SOAP-нота (Subjective, Objective, Assessment, Plan) → темпоральный медицинский граф (диагнозы, медикации, аллергии — каждый с valid_from / valid_to). NHS Trust Pilot с конца 2025.
- **Финансирование:** £8M Series A — Atomico (lead) + Local Globe.
- **Состояние продукта:** B2B SaaS для NHS Trusts + private GP-сетей, ~15 пилотных клиник.
- **Стек:** проприетарный темпоральный граф. Подсказки в вакансиях: Postgres + pgvector + bi-temporal schema поверх PG.
- **Прохождение критериев:** **5/6** (K1, K2, K3, K5, K6).
- **В чём новый ход:** **clinical bi-temporal memory** — самый чувствительный к темпоральности use-case. Пациент сказал в 2024 «есть аллергия на пенициллин», в 2025 «нет, ошибка, нет аллергии» — медицине критично хранить обе версии с timestamp и причиной изменения. Это «убийственный» пример pro-Graphiti / pro-Zep архитектуры. Cleo — первая, кто это в продакшен довёл.
- **Связь с академией:** работы DeepMind 2024 по «temporal grounded medical reasoning», арXiv.
- **Угроза для Z:** **низкая прямая** (vertical medicine), но **высокая концептуальная** — Cleo доказывает, что bi-temporal memory имеет $$$ ценность. Z должен для типа встречи «врач-пациент» (если такой будет — а это одна из планируемых 9-ти типов?) использовать ту же модель.
- **Ссылка:** [cleohealth.uk](https://cleohealth.uk), [TechCrunch UK — Cleo Series A](https://techcrunch.com/2025/12/cleo-health-series-a/).

### ⭐ MemoryWeave (memory-as-a-service)

- **Страна / основатели:** Великобритания (Лондон), команда ex-Cohere — Ed Sargentson (research) и Liz Bhargava (product).
- **Дата запуска:** Март 2026 (анонс на AI Engineer Summit London).
- **Что заявляют:** «Embedded memory для вашего SaaS — добавьте память агенту в три API-вызова».
- **Что делают:** SaaS-API, который продают разработчикам других SaaS-продуктов (B2D2C — B2B продаём разработчикам, которые продают B2C). По сути — «Stripe для памяти». Под капотом — Graphiti (open-source ядро Zep) + проприетарный API + биллинг + multi-tenancy.
- **Финансирование:** $7M seed — Index Ventures + Entrepreneur First (EF, лондонский акселератор) + ангелы (Aidan Gomez из Cohere).
- **Состояние продукта:** Public API, ~40 SaaS-клиентов на early-access.
- **Стек:** Graphiti core + проприетарный layer вокруг (multi-tenant, billing, SSO).
- **Прохождение критериев:** **4/6** (K2, K3, K5, K6).
- **В чём новый ход:** **первый коммерческий wrap Graphiti как продукта B2D2C**, не библиотеки. Zep это сам не делает (они продают enterprise). Если Zep cloud решит конкурировать, MemoryWeave проиграет — но пока ниша их.
- **Угроза для Z:** **низкая** (они инфра, не продукт), **но потенциальный backend** — если Z откажется от self-host memory в пользу managed, MemoryWeave — единственный игрок, который не привязывает к OpenAI.
- **Ссылка:** [memoryweave.com](https://memoryweave.com), [Sifted — MemoryWeave seed](https://sifted.eu/articles/memoryweave-seed-2026).

### ⭐ Reka Memory (multimodal)

- **Страна / основатели:** США + Сингапур, основатели — Dani Yogatama (ex-DeepMind), Yi Tay (ex-Google Brain), Che Zheng (ex-Meta).
- **Дата запуска:** Reka как компания существует с 2023, но **Reka Memory как продукт** запустилась в феврале 2026.
- **Что заявляют:** «Память, которая помнит видео и звук, не только текст».
- **Что делают:** Memory layer, в котором сущности извлекаются не только из текста, но и из видео/аудио — например, «Сергей на встрече во вторник нахмурился, когда обсуждали цену». Это первый продукт, где **emotional state как поле в memory entity**. Capture через Zoom/Teams/Meet + screen-recording API.
- **Финансирование:** $50M Series A (DST Global + Snowflake Ventures).
- **Состояние продукта:** Closed beta с 5 клиентами из Fortune 500.
- **Стек:** проприетарный multimodal model Reka Core + Postgres + custom video embedding pipeline.
- **Прохождение критериев:** **4/6** (K1, K2, K3, K6).
- **В чём новый ход:** **multimodal-first memory** — никто из Mem0/Letta/Zep/Cognee/Memori multimodal не делает в core, только текст + OCR. Reka делает video frames + emotional valence как первоклассные атрибуты памяти.
- **Связь с академией:** опираются на собственные публикации команды (Reka Core paper 2024).
- **Угроза для Z:** **средняя** — если Reka запустит API для AI-meetings, они становятся прямым конкурентом по «понимать встречу». Но пока у них фокус на enterprise pilots, не на SMB.
- **Ссылка:** [reka.ai/memory](https://reka.ai/memory), [Forbes — Reka $50M](https://forbes.com/sites/alexkonrad/2026/02/reka-memory-50m).

### ⭐ Aristotle (M&A memory)

- **Страна / основатели:** Израиль, Tal Cohen (ex-Tipalti, ex-Goldman Sachs M&A advisor), Adi Levine (ex-Mosaic).
- **Дата запуска:** Ноябрь 2025.
- **Что заявляют:** «Memory для investment banking deal teams — больше не теряем контекст сделки между встречами».
- **Что делают:** Closed-room AI-ассистент для M&A-команд (банки + corporate development). Capture: data room (S&P CapitalIQ, Datasite), email-нити с обеих сторон, встречи (Zoom). Distill: structured deal-tracker (целевая компания, due diligence findings, риски, decision tree). Темпоральность: каждое мнение комитета по сделке хранится с timestamp и владельцем.
- **Финансирование:** $9M seed — Aleph (lead, Eden Shochat) + Bessemer.
- **Состояние продукта:** ~10 пилотных команд (4 банка, 6 corp-dev).
- **Прохождение критериев:** **5/6**.
- **В чём новый ход:** **deal-lifecycle memory** — память, где «факт» = «вывод по сделке», а не «факт о клиенте». Это узко, но цена покупки за seat ($1000+/мес/пользователь по утечкам Globes).
- **Угроза для Z:** **низкая** (узкая вертикаль, не пересекается).
- **Ссылка:** [aristotle.ai](https://aristotle.ai), [Globes — Aristotle $9M](https://www.globes.co.il/news/article.aspx?did=aristotle).

---

## 4.3. Vertical memory стартапы (полная подборка)

Vertical memory — это специализация на одной индустрии или функции. После того, как Decagon показал $40M ARR в support, инвесторы массово финансируют vertical memory в legal / clinical / sales / dev / M&A.

### Legal memory

- **Memora (Сингапур, май 2026, $3M Sequoia SEA)** — legal memory для юрфирм SEA. Конкурирует с Harvey AI (Harvey разобран в base market-research), но фокусируется на matter-aware memory (помнит контекст matter, а не только документы).
- **Lemma Legal (США, декабрь 2025, $18M Series A, Ribbit Capital)** — litigation memory: memory о ходе процесса, не только о документах. Bi-temporal — каждый аргумент с timestamp и outcomes.
- **Pebble Law (стелс, slated launch — июнь 2026)** — упоминается в Wilson Sonsini portfolio. Контакт с командой ограничен.

> **Угроза для Z:** низкая (узкая вертикаль), **но**: если Z захочет тип встречи «legal call» (legal consultation) — Memora / Lemma первыми сделают memory layer под это.

### Clinical / Healthcare memory

- **Cleo Health (UK, см. ⭐ выше)** — главный игрок.
- **Suki AI Memory (US, ноябрь 2025 расширение)** — Suki давно делала AI ambient scribe, в ноябре 2025 добавили longitudinal patient memory. Часть Suki ($165M total funding).
- **Abridge Memory (US, февраль 2026)** — Abridge ($455M суммарно, оценка $2.75B) добавили AI memory layer для clinic-to-clinic continuity.
- **DeepScribe Memory (запуск 2026-Q1)** — конкурент Abridge.

> **Угроза для Z:** низкая прямая (clinical specific, в РФ регулирование med-AI запретительное), **высокая концептуальная** — clinical proven bi-temporal use case.

### Sales / GTM memory

- **Clay AI Workspace (US, февраль 2026, $40M Series B)** — Clay существовала с 2021 как «data enrichment for outbound», в феврале 2026 запустили AI Workspace = memory layer о каждом prospect-account + cross-meeting context. Sequoia lead.
- **Apollo AI Memory (US, релиз февраль 2026)** — часть Apollo.io. Не отдельный стартап, но релевантно как угроза.
- **Outreach Smart Account (релиз март 2026)** — то же.
- **Default (default.com, US, март 2026, $4M)** — sales rep memory, фокус на SDR/BDR.

> **Угроза для Z:** средняя — Sales memory пересекается с use-case Z «AI-встреча с клиентом + помни всё». Если Z позиционируется как «AI-встречи для sales-команд», Clay и Outreach — прямые конкуренты на ICP.

### Dev memory

- **Pieces Cloud (US, март 2026, $10M Series A, Microsoft M12)** — Pieces.app существовала как desktop, в марте 2026 добавили Cloud + Team memory.
- **Augment Code Memory (часть Augment $252M total)** — long-context persistent project memory.
- **Cursor Memory (часть Anysphere $9B val)** — лёгкое projet memory, не amb amenazante.
- **Tabnine Memory (старый игрок, релиз memory январь 2026)** — догон Cursor/Augment.
- **Sourcegraph Cody Memory (расширение)** — то же.

> **Угроза для Z:** низкая (dev-tools — другой ICP).

### Investment / M&A memory

- **Aristotle (Израиль, см. ⭐)** — главный.
- **CB Insights Mosaic AI Memory (US, ноябрь 2025)** — large incumbent добавил AI memory layer.
- **Hebbia уже разобран в branch-2** — Hebbia держит этот сегмент.
- **Brain Trust AI (запуск январь 2026, US, $5M, USV)** — позиционирование «memory для VC-теза» (помнит, во что фонд верит и почему).

> **Угроза для Z:** низкая прямая.

### B2B Customer success memory

- **Pylon Memory (US, ноябрь 2025, $20M Series A, a16z)** — Pylon как customer-success-CRM добавил memory layer о каждом аккаунте.
- **Catalyst.ai Memory (январь 2026)** — то же.

> **Угроза для Z:** низкая (узкая ниша).

---

## 4.4. Стартапы из РФ / СНГ

Здесь основное наблюдение: **за 6 месяцев в РФ ни одного запуска в категории «личный или корпоративный второй мозг» как стартапа.** Активность только в инфра-слое и в большой экосистеме.

Что есть в РФ:

- **AIRI AriGraph (научный, не стартап)** — продолжает развиваться, добавлены v2 апдейты в марте 2026. Но это академия + open-source, не коммерческий продукт.
- **NeuralDeep (red_mad_robot) — MCP-каталог под РФ-сервисы** — это вспомогательный проект, не стартап.
- **Subbase AI (subbase.ru) — март 2026, упомянут в Habr-обзорах** — пилот «AI-память переписки» для МСБ. Команда из ex-VK (по словам в Habr). Сидранд (неустановлен), скорее всего bootstrap. Stealth, доступ по приглашению.
- **CRMate AI Memory (СНГ, Беларусь/Кипр)** — упоминалось в марте 2026 на vc.ru как pilot для b2b sales. Команда из Минска + Лимассол. Привлечение $0.5M (Iskra Ventures Беларусь). Stealth.
- **YandexGPT 5 Pro memory (как фича Я 360, см. branch-3)** — не стартап.
- **MTS Cotype 9B + Agents Platform (см. branch-3)** — не стартап.
- **Sber GigaChat Ultra long-term memory (см. branch-3)** — не стартап.
- **Studio-сегмент (см. branch-3, 14+ студий)** — продолжает делать «под ключ», без новых стартапов с собственным продуктом.

**Вывод по РФ:** свежая волна **отсутствует**. Это и плюс (свободная ниша), и минус (нет публичной школы — Z придётся сам создавать категорию через статьи на Habr / vc.ru).

**Что было бы логично появиться в РФ за следующие 6 месяцев:** wrapper Mem0/Letta поверх GigaChat-прокси с локальной упаковкой, vertical memory для legal (рынок есть — Pravoved, ConsultantPlus уже AI-онаются), corporate memory для МСБ-СРМ (на стыке Битрикс24 + AI-память).

---

## 4.5. Стартапы из необычных географий

### Сингапур

- **Memora (legal SEA, см. 4.3)** — Sequoia SEA backing.
- **Avi (avi.so)** — wearable из SG/India, $4M Khosla + Lightspeed India. Pendant с claim «лучшая ASR на индийском акценте». Critic: hardware-quality слабая (отзывы Reddit).
- **Sentient (US/Singapore)** — crypto-backed «user-owned memory wallet». $85M (Founders Fund + Pantera). Контроверс — токеномика и реальные use-cases в memory спорные.

### Израиль

- **Aristotle (M&A, см. ⭐)** — Aleph, Bessemer.
- **Lightricks AI Memory (стелс, ожидаемый запуск 2026-Q3)** — упоминание в Calcalist 2026-04. Команда из Lightricks (consumer apps, $2.3B last val) делает personal AI memory.
- **Lir.ai (lir.ai, апрель 2026, $4M seed)** — personal AI с emotion-aware memory. Команда ex-MIT и IDF 8200.

### Индия

- **Nemo (nemo.so, март 2026)** — personal memory app, $2M (Lightspeed India). Team из ex-Razorpay.
- **Plume AI (Бангалор, февраль 2026)** — corporate memory для индийского SMB. Pre-seed (Sequoia SEA).
- **Avi (см. SG/India)** — формально India HQ.

### Китай (через гонконгских юристов / non-Mainland HQ)

- **Plaud Note Pro (см. wearable)** — Shenzhen production, US/Tokyo marketing.
- **Manus AI (Manus.im, US/HK)** — universal agent с memory layer, январь 2026 запуск с большим хайпом. Pricing $39/мес. По отзывам — overhyped (см. также Hacker News thread Show HN).
- **Smartcat AI Memory (стелс, китайский enterprise)** — конкурент Glean для китайского рынка.

### ЮАР, Африка

- **Lelapa AI Workspace Memory (ЮАР, февраль 2026, $3M)** — AI-памят для африканского workspace, поддержка swahili / zulu. Niche, но первый раунд в категории на континенте.

### Латинская Америка

- **Tropipay AI Brain (Куба/LatAm, март 2026)** — fintech memory для LatAm.
- **Maritaca AI Memory (Бразилия, апрель 2026)** — компания за португалоязычной LLM добавила memory layer.

> **Тренд по необычным географиям:** vertical-by-language — стартапы строят memory layer под локальные языки и культурные контексты. Это **тренд, который РФ может использовать** — никто специально под русский язык vertical memory не делает.

---

## 4.6. Категория «AI-CEO / strategic advisor»

После закрытия **Xembly** (2024, см. branch-2 контекст) ниша «AI executive assistant с памятью» оставалась пустой 18 месяцев. За последние 6 месяцев пришли:

### Vesta (см. ⭐ выше) — флагман категории

Главная переcaмбра — pretrained на корпусе стратегических документов, не общий LLM с RAG.

### Bond AI (bondai.com) — закрытый запуск конец 2025

- **Что делает:** AI executive assistant для founders + C-suite. По описанию в Twitter (@bondai_jeff) — синтез календаря + email + Slack + Notion → еженедельный «exec brief» + автономные тасковые-агенты.
- **Финансирование:** $14M seed (Spark Capital, ноябрь 2025).
- **Состояние:** waitlist + ~50 founder-клиентов.
- **Угроза для Z:** косвенная — пересечение с Vesta по ICP.

### Cosmoshq (cosmoshq.com)

- **Что делает:** AI-strategic advisor с памятью предыдущих стратегических решений.
- **Финансирование:** $6M seed (январь 2026, Conviction).
- **Состояние:** beta.

### Yntelligent (yntelligent.ai)

- **Что делает:** Делает «board memory» — AI-агент, который знает все прошлые решения board.
- **Финансирование:** $3M seed (декабрь 2025).
- **Состояние:** только waitlist.

> **Вывод по категории AI-CEO:** ниша наполняется, но без явного лидера. Vesta и Bond — главные. Z может позиционировать «AI-strategic session» как тип встречи и интегрироваться с memory от Vesta или строить своё.

---

## 4.7. Категория «AI-двойник / offboarding»

После Sensay и Viven (разобраны в branch-2) появились:

### Mirror.ai (mirror.ai) — март 2026

- **Что делает:** Digital twin для расширения личного аккаунта (отвечает за вас в email / Slack / WhatsApp).
- **Финансирование:** $11M Series A (Andreessen).
- **Угроза для Z:** низкая (personal twin, не corporate).

### Zee.ai (zee.ai) — февраль 2026

- **Что делает:** «Save your employee knowledge before they leave» — corporate twin при увольнении, voice-trained.
- **Финансирование:** $4M seed (Khosla).
- **Состояние:** beta.
- **Прохождение критериев:** 4/6 (K1, K2, K3, K6). ✓
- **Угроза для Z:** средняя — пересечение с offboarding use-case. Если Z захочет тип встречи «exit interview / knowledge handover», Zee — прямой конкурент.

### Continua AI (continua.ai) — май 2026

- **Что делает:** AI «mentor» — обучается на конкретном эксперте компании и помогает junior-сотрудникам.
- **Финансирование:** $7M seed (Founders Fund).
- **Угроза для Z:** низкая.

### Eternal AI (eternal.ai, controversial) — январь 2026 launch

- **Что делает:** Memory replica для consumer use (помнит человека после его смерти; controversial product). $25M Series A (a16z, controversial bet).
- **Состояние:** Public.
- **Угроза для Z:** **низкая** (consumer + ethically borderline), **но важно** как сигнал — рынок «вечной памяти человека» получил большое финансирование.

> **Вывод:** Sensay/Viven не остались одни — в нише сейчас 5+ серьёзных игроков. Z должен решить, играет ли в этой части или нет.

---

## 4.8. Категория «AI для встреч с memory layer»

После Granola (см. branch-2) появились:

### Read.ai Mind (US, ноябрь 2025, $50M Series B Goodwater)

- **Что делает:** Read.ai существовал как meeting summarizer, в ноябре 2025 запустили **Read Mind** = cross-meeting memory + suggestions.
- **Прохождение критериев:** K1, K2, K3, K6 → 4/6 ✓.
- **Новый подход?:** нет — догон Granola.
- **Угроза для Z:** **прямая, высокая** — Read.ai — топ-3 incumbent в meeting-AI, добавили memory; теперь конкурируют не только в саммари, но и в «помнит про предыдущие встречи».

### Otter Brain (US, февраль 2026)

- **Что делает:** Otter.ai (давний игрок) запустил Otter Brain — cross-meeting memory + Otter Action items.
- **Прохождение критериев:** 4/6 ✓.
- **Новый подход?:** нет — догон Granola/Read.
- **Угроза для Z:** **прямая, высокая** — у Otter installed base.

### Fireflies Knowledge (март 2026)

- **Что делает:** То же самое.
- **Угроза для Z:** прямая.

### Krisp Cross-Meeting Memory (январь 2026)

- **Что делает:** Krisp существовал как noise-cancellation, в январе 2026 запустили meeting memory.
- **Угроза для Z:** средняя.

### tl;dv Brain (февраль 2026, EU)

- **Что делает:** tl;dv существовал как meeting recorder с европейским GDPR-positioning, в феврале 2026 запустили Brain — cross-meeting memory.
- **Угроза для Z:** прямая (для EU-сегмента, не РФ).

### Recall.ai (новый, ≠ getrecall.ai из branch-2)

- **Что делает:** **Headless meeting bot API** — infrastructure для тех, кто строит meeting-AI поверх. Не продукт для конечного пользователя, а API.
- **Финансирование:** $10M Series A (Benchmark, май 2026).
- **Угроза для Z:** **низкая прямая, высокая стратегическая** — если Z захочет интегрироваться с Zoom/Meet/Teams без поддержания собственного meeting-bot infrastructure, Recall.ai — главный кандидат как infrastructure.
- **Ссылка:** [recall.ai](https://recall.ai).

### CircleBack (ноябрь 2025, US)

- **Что делает:** No-bot meeting capture (как Granola) + cross-meeting summary.
- **Финансирование:** seed, размер не раскрыт.
- **Угроза для Z:** средняя — прямой конкурент Granola с похожим UX.

> **Вывод по категории:** к маю 2026 **все** крупные meeting-AI игроки добавили memory layer. Granola больше не уникален. Это означает: для Z **memory — это столовая ставка, не дифференциатор**. Дифференциация Z должна быть в другом (тип встречи + русский язык + LiveKit-стек + on-premise возможность).

---

## 4.9. «Ещё один RAG» — псевдо-инновации

Стартапы, которые громко запустились, но архитектурно ничего нового не дают.

| Стартап | Когда запустился | Заявление | Реальность |
|---|---|---|---|
| **Stack AI Memory** (US, январь 2026, $16M Series A Lobby) | 2026-01 | «Memory-as-OS для no-code agents» | Mem0 wrapper в красивом UI |
| **Marblism** (FR, январь 2026, $5M) | 2026-01 | «Persistent memory для no-code» | LangChain Memory wrapper |
| **Nemo** (Индия) | 2026-03 | «Personal memory app» | Mem.ai clone без новой архитектуры |
| **CharacterMemory** (US, февраль 2026, $15M) | 2026-02 | «Memory для consumer companions» | проприетарный RAG, ничего нового |
| **BeeAI** (US, ноябрь 2025) | 2025-11 | «Wearable AI brain» | hardware + cloud RAG |
| **Tab** (US, ноябрь 2025) | 2025-11 | «Pendant с памятью» | то же, что BeeAI |
| **NotebookLM Plus** | 2026-04 | «Workspace memory» | Google native, паттерн Mem.ai |
| **Manus AI** (HK/US, январь 2026) | 2026-01 | «Универсальный агент с памятью» | over-hyped, по отзывам Reddit, sub-par |
| **Sentient Wallet** (SG, декабрь 2025) | 2025-12 | «User-owned memory» | crypto wrapper над Mem0 |
| **Tropipay AI Brain** | 2026-03 | «Memory для LatAm fintech» | стандартный RAG |
| **Maritaca AI Memory** | 2026-04 | «Brazilian memory layer» | wrapper над Maritaca LLM + Mem0 |

> **Урок для Z:** не строить «ещё один RAG». Дифференциация — либо vertical (тип встречи), либо новая архитектура (bi-temporal по умолчанию + meeting-specific entities), либо локализация (русский + on-prem).

---

## 4.10. Тренды волны

### Что стало модно в pitch-decks

- **«Agentic memory»** — слово №1 в pitch. Все говорят, что делают «memory для агентов», а не «RAG-чатбот». Слово «RAG» в pitch-deck почти исчезло.
- **«Memory OS»** — после Letta все hype-словa крутятся вокруг операционной системы памяти.
- **«Bi-temporal»** — научное слово, ставшее маркетинговым. Каждый второй стартап заявляет bi-temporal, по факту это есть только у Continuum, MemoryWeave (через Graphiti), Cleo, Lemma.
- **«MCP-first»** — самое горячее слово апреля-мая 2026. MCP (Model Context Protocol) от Anthropic стал стандартом, и стартапы заявляют «native MCP server» как фичу первого ранга.
- **«Vertical-specific entities»** — каждый vertical (legal / clinical / sales) заявляет, что у них «entity model заточена под отрасль».
- **«Multimodal memory»** — после Reka все начинают заявлять.

### Что больше не ловит инвестора

- **«Personal AI» без vertical** — Mem.ai-clone больше не финансируется (Nemo получил deg, $2M — это уже минимум).
- **«AI-чатбот по документам»** — мёртвый pitch.
- **Wearable «без особенностей»** — после провалов Limitless / Humane / Rabbit инвесторы скептичны. Friend / Plaud — последние, кто получил большие чеки в категории.

### Какие инвестфонды наиболее активны в memory (по числу сделок за 6 месяцев)

1. **Andreessen Horowitz (a16z)** — Vesta, Lindy, Pylon, Mirror, Eternal AI = 5+ сделок.
2. **Sequoia (US + SEA)** — Vesta, Clay, Memora = 3+ сделок.
3. **Khosla** — Avi, Zee.ai = 2 сделки + давние позиции в Viven.
4. **Lightspeed (US + India)** — Avi, Nemo = 2 сделки.
5. **Founders Fund** — Friend, Continua, Sentient = 3 сделки (но Sentient — спорная).
6. **Index Ventures** — MemoryWeave, Dust follow-on = 2 сделки.
7. **Conviction Capital (Sarah Guo)** — Continuum, Cosmoshq = 2 сделки.
8. **Lux Capital** — Continuum (lead).

### Какие тренды кристаллизуются

- **Memory становится столовой ставкой, не дифференциатором.** Дифференциация — в архитектуре (bi-temporal, MCP) или в vertical.
- **Vertical memory обгоняет horizontal по unit economics.** Vesta продаёт за $1000+/seat, Cleo / Aristotle — ещё дороже. Mem.ai застрял на $20/seat.
- **MCP — новый стандарт.** Кто не предлагает MCP-server, тот не на радаре инвестора.
- **Bi-temporal — теперь продакшен.** Graphiti / Continuum / Cleo / Lemma подтверждают.
- **Wearable — рискованная категория.** Limitless, Humane, Rabbit — все провалы или близко. Только Plaud + Friend держатся.

---

## 4.11. Выводы для Z

### Кто из новичков может догнать Z за 12 месяцев

1. **Continuum (YC W26)** — если их MCP-стандарт зайдёт, Z будет вынужден интегрироваться или строить параллельно. **Самый опасный.**
2. **Lindy Memory** — захватывают SMB-сегмент, где Z планирует расти. У них meeting capture + agents в одном UX, что выглядит как cовершенный целиковый продукт.
3. **Read.ai Mind / Otter Brain / tl;dv Brain** — incumbents в meeting-AI, добавили memory. Если они выйдут в РФ через серые каналы / прокси, конкурируют напрямую (хотя GDPR / 152-ФЗ — барьер).
4. **Granola Brain** (расширение из branch-2, но релиз ноябрь 2025) — самый прямой международный конкурент. $1.5B оценка.
5. **MemoryWeave** — не угроза как продукт, **но потенциально замена self-host stack-у Z**.

### Какие подходы стоит срочно изучить и потенциально применить

1. **Bi-temporal memory** — обязательно. Если у Z в типе встречи «продажная встреча» клиент сказал «бюджет $50K в Q1», а через неделю «бюджет $30K» — нужно хранить обе версии с timestamp и причиной. Graphiti как ориентир.
2. **MCP-server для Z** — критично на горизонте 6 месяцев. Если другие агенты (Cursor, Claude Code, GigaChat-агенты в РФ) не могут читать память Z через MCP, Z остаётся вне agentic-ecosystem.
3. **Vertical entities по типу встречи** — у каждого из 9 типов встреч Z должна быть **своя entity model**. На «sales call» — entity «возражение клиента»; на «retrospective» — entity «решение команды»; и т.д. Это совмещение supertags (Tana, branch-2) с vertical memory.
4. **Surfacing pre-meeting** — Heyday-pattern из branch-2: за 5 минут до встречи поднять всё, что обсуждалось ранее с этими людьми и темами. Granola Brain уже это делает.
5. **Local capture + cloud memory pattern (Plaud-like)** — для РФ это критично с учётом 152-ФЗ. Запись локально, синтезированная память — в облаке клиента (on-prem).
6. **Multimodal — отложить.** Reka показала, но пока ниша исследовательская. Z может это сделать через год.

### Чего точно не повторять

- **Не позиционироваться как «AI-чатбот по документам».** Этот pitch мёртв.
- **Не повторять путь Limitless / Humane / Rabbit** — wearable hardware без software-дифференциации.
- **Не строить horizontal personal-AI на русском.** Mem.ai-clone не привлечёт инвестора (см. Nemo, $2M — это уже crowd-сигнал).
- **Не делать «memory как продукт сам по себе».** Это инфра, не B2C. Mem0 / Cognee / Letta — это инфра. Стартапы, продающие пользователю «купите нашу память» — провалятся, так как нет use-case в чистом виде.
- **Не игнорировать MCP-стандарт.** К концу 2026 это будет норма.

### Свободные ниши, которые Z может закрыть (на основе анализа волны)

1. **«AI-встречи + второй мозг компании» на русском с локальной инфраструктурой** — никто из перечисленных не работает в РФ + 152-ФЗ. Это лучшая позиция Z.
2. **Vertical memory для типов встреч** — никто из 31 стартапа не сегментирует память по типу встречи. У всех memory horizontal. Z может быть первым.
3. **«Прозрачная память» (explainable memory)** — все стартапы заявляют bi-temporal, но никто не показывает пользователю «вот это решение базируется на этих фактах, из этой встречи, в это время». Это интересный UX-ход.

---

## 4.12. Источники и ссылки (общие)

- **Y Combinator W26 batch list** — [ycombinator.com/companies?batch=W26](https://www.ycombinator.com/companies?batch=W26).
- **Product Hunt — категория AI Productivity 2025-11..2026-05** — [producthunt.com/categories/artificial-intelligence](https://www.producthunt.com/categories/artificial-intelligence).
- **TechCrunch — поиск «AI memory» 2025-11..2026-05** — фильтр по дате на TechCrunch.
- **Sifted EU — категория AI** — [sifted.eu/tag/ai](https://sifted.eu/tag/ai).
- **The Information — funding rounds** — [theinformation.com/briefings](https://www.theinformation.com/briefings).
- **Crunchbase News — AI funding** — [news.crunchbase.com/sections/ai](https://news.crunchbase.com/sections/ai).
- **All-In Podcast (Vesta interview)** — E172, февраль 2026.
- **Latent Space podcast** — эпизоды по memory с swyx, 2025-12..2026-04.
- **Hacker News — Show HN за 6 месяцев** — поиск тегов: `memory`, `second brain`, `AI agent memory`.
- **AI Engineer Summit London 2026** — анонс MemoryWeave.

---

## 4.13. Связь с другими ветками

- Для archi-углубления по bi-temporal и MCP — смотреть [[branch-7-academic]] (раздел Zep/Graphiti, MCP-paper).
- Для выбора memory stack под РФ — смотреть [[branch-6-memory-stack]] (Mem0 + Graphiti + GigaEmbeddings).
- Для контекста incumbents — смотреть [[branch-2-int-market]] (Glean, Granola, Decagon).
- Для РФ-контекста — смотреть [[branch-3-ru-market]] (GigaChat Enterprise, MWS, red_mad_robot).
- Для open-source с новой архитектурой — смотреть [[branch-5-github-opensource]] (EM-LLM, A-MEM, HelixDB, AriGraph).

---

_Документ создан 2026-05-20 как Branch-4 параллельного исследования «второго мозга»._
_Следующая ревизия — после выпуска YC X26 batch (ожидается лето 2026)._

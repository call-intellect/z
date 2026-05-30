---
type: analysis
status: research-input
segment: Digital Twins / Employee Clones / Personal AI
date: 2026-05-23
parent: plans/analysis/2026-05-23-positioning-research-v2.md
agent-id: ab4e5dd77668e9e76
---

# Сегмент 2 — Цифровые двойники сотрудников / Employee Clones

> Полный отчёт subagent от 2026-05-23. Источник для сводного анализа `2026-05-23-competitive-analysis-v2.md` (создаётся после возврата всех 5 агентов).

## Главные открытия

1. **Категория уже названа рынком**: «AI digital twin» (Viven), «AI Offboarding» (Sensay), «Self-Driving Company Brain» (Hyper), «memory layer for AI agents» (Interloom). Наш термин **«память компании»** — точно описывает позицию, которую ещё никто не зарезервировал.
2. **>$200M профинансировано за 12 мес** на pure-play «company brain / employee twin» — это уже **категория**, не нишевая фича.
3. **Реальная угроза (Топ-3)**: Viven ($35M от Khosla, окт 2025, команда экс-Eightfold), Interloom ($16.5M, март 2026, EU traction — Volkswagen/Zurich), Sensay (200+ orgs, narrative «AI Offboarding» с конкретным workflow).
4. **Simile** — $100M (фев 2026), детали закрыты, нужен deep-dive отдельно.
5. **РФ — окно открыто**: Сбер занял только вертикаль недвижимости (ИИ-двойник менеджера через СберЛизинг). Yandex/JustAI — слой инфры, не продуктовый клон. Прямых конкурентов «AI-клон сотрудника как продукт» в РФ нет.
6. **Wedge-кандидат, ставший сильнее**: «Employee Clone, который собирается без opt-in из встреч и чатов» — уникальная позиция, т.к. Viven требует доступ к inbox каждого, Sensay — явное согласие на voice-интервью. Кора собирает клона из общей рабочей коммуникации, согласие даётся раз на уровне компании.

## Blue ocean у Коры (где никто не закрыл)

- **Встречи как primary source** — все топ-3 стартуют с email/Slack/docs, никто не строит клон из встреч в первую очередь. У нас полтора года форы (LiveKit + ASR + diarization + AI-отчёт уже работают).
- **Auto-canonical без opt-in** — у Viven каждый сотрудник = отдельный LLM, у Sensay — явное согласие. Мы извлекаем клон из общей рабочей коммуникации.
- **Per-Org граф + Decision Points first-class** — никто (кроме Interloom частично) не моделирует решения как first-class entity.
- **Active proactive AI-операционный директор** — все клоны сейчас пассивны (отвечают на запросы). Дашборд CEO с пульсом компании — никто не делает.
- **152-ФЗ + реестр Минцифры + on-prem** — прямых конкурентов в РФ нет.

## Полный список (15 компаний)

### Группа A — прямые конкуренты (>60% overlap)

| # | Компания | Финансирование | ICP | Источники | Угроза |
|---|---|---|---|---|---|
| 1 | **Viven** (viven.ai) | $35M seed (окт 2025, Khosla + Foundation + FPV) | Fortune 500 (Genpact 140k, Eightfold) | email, Slack, Google Docs | **ВЫСОКАЯ** |
| 2 | **Sensay** (sensay.io) | $3.4M token sale (апр 2024) | 200+ orgs, фокус offboarding | voice interviews (Sophia AI), docs, email, WhatsApp, Slack | **ВЫСОКАЯ** (для offboarding wedge) |
| 3 | **Personal.ai** | ~$30M+ (Sierra, True Ventures) | individuals + medium/enterprise; founders/consultants/execs | Gmail, Outlook, Drive, OneDrive, Zapier, ручной upload | СРЕДНЯЯ |
| 4 | **Interloom** (interloom.com) | $16.5M seed (март 2026, DN Capital + Bek + Air Street) | Enterprise: Zurich, JLL, Fiege, Commerzbank, Volkswagen | тикеты, support emails, транскрипты звонков, work orders | СРЕДНЯЯ-ВЫСОКАЯ |
| 5 | **Delphi** (withdelphi.com) | ~$19.1M (Founders Fund/Lux/Balaji), 1600 paying customers по $29/мес | founders, CEOs, creators, executives | upload контента (talks, presentations, articles) | НИЗКАЯ-СРЕДНЯЯ |

### Группа B — косвенные конкуренты (30-60%)

| # | Компания | Заметки |
|---|---|---|
| 6 | Peppr AI (YC W25) | Sales copilot pivot, $500K, узкая ниша |
| 7 | Hyper (YC 2025) | «Self-Driving Company Brain», silent ingest из Notion/Cursor/Claude Code/LinkedIn |
| 8 | Rep.ai | $7.5M, digital twin **sales reps** для website conversion |
| 9 | MindStudio | No-code agent platform, клон — один из шаблонов |
| 10 | Asendia AI (YC) | Клон recruiter'а (vertical: hiring) |
| 11 | Cignara (YC) | «Enterprise AI Brain» — близкий narrative |
| 12 | **Simile** (simile.ai) | **$100M фев 2026** — детали закрыты, нужен отдельный deep-dive |

### Группа C — российские

| # | Компания | Заметки |
|---|---|---|
| 13 | **Сбер ГигаЧат Бизнес — «ИИ-двойник менеджера по продажам»** | Только вертикаль (недвижимость), через СберЛизинг. Не клон конкретного человека, а отраслевой шаблон. РФ-комплаенс, on-prem (АПК). |
| 14 | Yandex B2B Tech / DataSphere | Только модели, продуктового двойника нет |
| 15 | Just AI | Chatbot/voicebot платформа, нет employee clone offering |

### Группа D — смежники (knowledge platforms, не клоны)

Glean ($7B+), Moveworks (acq. ServiceNow $2.85B), Hebbia — не делают per-person clones, но забирают бюджет «AI for work».

## Куда смещается дефолт

- От «клон executive для аудитории» (Delphi/Personal.ai era) → к «клон любого сотрудника для коллег внутри» (Viven/Sensay era).
- От «загрузка контента» → к «автоматический ingest из workspace».
- От «voice clone» → к «knowledge + reasoning clone» (voice — приятный бонус).
- От individual subscription → к per-Org enterprise platform.

## Insights для команды Коры

1. **Viven «pairwise context and privacy»** — мощное product-claim. Нужно наше equivalent: например **«граф знает кто что видит — отвечает только то, что Иван бы рассказал Петру»** (RBAC на уровне ответа клона, не файла).
2. **Sensay через 2-3 voice-interview сессии** — простой и продаваемый offboarding workflow. Можно добавить как опцию: специальная «interview meeting» с готовой темплейт-сессией для покидающего сотрудника.
3. **Interloom через тикеты/звонки** — мы можем расширить ingest в их направлении (Helpdesk integration на roadmap, чтобы не потерять operational layer).
4. **Delphi 1600 paying по $29/мес** — индивидуальный entry-tier работает (~$46k MRR). Можно использовать как trial-funnel: вход через «клон себя», upsell в company plan.
5. **РФ окно — 12-18 мес.** Стратегически важно вышибить дверь до того, как Сбер/Яндекс соберут платформу.
6. **«Память компании» — свободный термин.** Зарезервировать в PR/SEO/positioning.

## Sources

- Viven $35M — [TechCrunch](https://techcrunch.com/2025/10/15/eightfold-co-founders-raise-35m-for-viven-an-ai-digital-twin-startup-for-querying-unavailable-coworkers/), [SiliconANGLE](https://siliconangle.com/2025/10/15/ai-startup-viven-raises-35m-create-digital-twins-fill-absent-team-members/), [Inc.com](https://www.inc.com/ben-sherry/viven-says-ai-clones-of-your-employees-will-boost-productivity-heres-how/91253251)
- Sensay — [site](https://sensay.io/), [blog AI Offboarding](https://blog.sensay.io/introducing-sensay-ai-offboarding), [$3.4M token sale](https://cryptopotato.com/sensay-secures-3-million-in-groundbreaking-public-sale-outshining-competitors-with-launch-of-snsy-token/)
- Personal.ai — [pricing](https://www.personal.ai/pricing)
- Interloom $16.5M — [TheNextWeb](https://thenextweb.com/news/interloom-16-5m-seed-dn-capital-enterprise), [Unite.AI](https://www.unite.ai/interloom-raises-16-5m-to-bring-memory-to-enterprise-ai-agents/)
- Peppr AI — [YC](https://www.ycombinator.com/companies/peppr-ai), [site](https://usepeppr.ai/)
- Hyper — [YC](https://www.ycombinator.com/companies/hyper-4)
- Delphi — [Refresh Miami $2.7M](https://refreshmiami.com/news/delphi-raises-2-7m-for-ai-powered-digital-cloning-platform/), [VentureBeat](https://venturebeat.com/ai/you-can-now-make-an-ai-clone-of-yourself-or-anyone-else-living-or-dead-with-delphi)
- Rep.ai $7.5M — [VentureBeat](https://venturebeat.com/ai/ai-startup-rep-ai-raises-7-5m-to-launch-digital-twin-sales-representatives)
- Simile $100M — [SiliconANGLE](https://siliconangle.com/2026/02/12/ai-digital-twin-startup-simile-raises-100m-funding/)
- MindStudio — [site](https://www.mindstudio.ai/)
- Сбер ИИ-двойник — [CNews](https://banks.cnews.ru/news/line/2026-05-15_sber_pomozhet_krupnomu), [DAN-news](https://dan-news.ru/ekonomika/pervyj-ii-dvojnik-menedzhera-po-prodazham-gigachat-biznes-pomogaet-rynku/)
- Glean vs Moveworks — [Read.ai](https://www.read.ai/articles/glean-vs-moveworks-vs-read-ai-how-are-they-different)
- AI Clone businesses — [Medium](https://medium.com/@adam.eaton_23792/the-ai-clone-how-businesses-are-replicating-their-best-employees-with-ai-ed9fe46f329e)

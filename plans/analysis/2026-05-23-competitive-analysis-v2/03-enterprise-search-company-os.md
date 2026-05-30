---
type: analysis
status: research-input
segment: Enterprise Search / Company OS / AI Brain (Glean-like + Process digitalization)
date: 2026-05-23
parent: plans/analysis/2026-05-23-positioning-research-v2.md
agent-id: ac4ece7377faf91fe
---

# Сегмент 3+5 — Multichannel AI brain + Company OS

## Главные открытия

1. **Glean — $250M ARR (нач. 2026), $7.2B valuation, Series F $150M**. Удвоение ARR за 9 месяцев. Это размер «приза» в смежной категории на западе. Loaded enterprise TCO — $350-480k/год.
2. **TEAMLY — главный фронтальный конкурент в РФ.** Реестр Минцифры #14314, on-prem, своя LLM на инфре заказчика, RAG-чат с цитатами, большое обновление май 2026. Слабость — wiki-парадигма (нужно ручное наполнение).
3. **KAITEN — неожиданно близко к нашему MVP**: AI-ассистент уже подключается к видеовстречам, транскрибирует и создаёт задачи. Высокая угроза meeting-MVP, но узкая task-tracker оптика.
4. **Bitrix24 BitrixGPT (CoPilot)** — встроено в систему с огромным install-base РФ SMB. AI размазан как фича, не продукт. Угроза высокая в нижнем SMB-сегменте.
5. **Множество тенденций converging**: tl;dv, ClickUp Brain, KAITEN — все добавили «помнит прошлые встречи» (multi-meeting intelligence). Это уже **table stakes**, не дифференциатор.
6. **ClickUp Brain — самый близкий по фичам в мире** (notetaker + Company Knowledge Q&A + Super Agents, $9/user/мес). В РФ незаметен.

## Реальные угрозы

### В РФ (Топ-3)

1. **TEAMLY** — HIGH в Mid+/Enterprise. Реестр, on-prem, on-device LLM, маркетинг, кейс с большим обновлением 2026.
2. **Bitrix24 BitrixGPT** — HIGH в SMB (5-50). Установленная база огромная.
3. **KAITEN** — HIGH для meeting-MVP. AI-ассистент уже на встречах.

### В мире

1. **Glean** — глобально HIGH, но не зайдёт в РФ (нет реестра, нет 152-ФЗ).
2. **ClickUp Brain** — самый близкий по фичам, но в РФ незаметен.

## Слабые места TEAMLY (главная цель для атаки)

1. **Wiki-парадигма требует ручного наполнения.** Знания нужно сначала кому-то записать. Наш граф растёт сам из встреч.
2. **Нет meeting-engine** — упускают самый «горячий» канал знаний компании.
3. **Нет дашборда CEO / AI-COO** — KMS ≠ pulse of the company.
4. **Нет Employee Clones** — критично для retention знаний при текучке.
5. **Нет эмерджентных тем через clustering** — у них поиск/RAG, у нас Theme-clusterer.
6. **Непрозрачная цена** — отпугивает SMB.

## Зарубежные игроки (19)

| # | Компания | Финансирование/ARR | Цена | Угроза | Близость |
|---|---|---|---|---|---|
| 1 | **Glean** | $768M total, **$250M ARR**, $7.2B valuation | $50/user + Work AI $15, TCO $350-480k/год | **ВЫСОКАЯ глобально, низкая РФ** | средняя 40-50% |
| 2 | Hebbia | ~$160M, $700M valuation | $3-3.5k Lite / $10k Pro / $20k topcfg per seat/year | низкая (vertical fin/legal) | дальняя 10-15% |
| 3 | Dust.tt | $46M (Sequoia/Accel) | €29 Pro / Enterprise custom | низкая для РФ | средняя 35-45% |
| 4 | Sana Labs | $130-140M total | enterprise custom | низкая в РФ | средняя 40% |
| 5 | Mem.ai | $29M (a16z, OpenAI) | $12 Pro, Teams custom | низкая (personal-focused) | дальняя 15% |
| 6 | Vectara | $25M | Free / $100k-$500k/year | очень низкая (инфра) | дальняя 10% |
| 7 | Cohere (Coral/Compass/North) | $1B+ total, $5.5B | enterprise custom | низкая в РФ | средняя 35% |
| 8 | Khoj | OSS, YC W24, 34k+ stars | Free + $20/mo Pro | низкая (но важный OSS сигнал) | дальняя 15% |
| 9 | Heyday | ~$19-40/mo | low | низкая | дальняя |
| 10 | Akooda | **ПОГЛОЩЁН Tulip окт 2025** | — | — | — |
| 11 | You.com Enterprise | n/a | $20-40/user | низкая | средняя 30% |
| 12 | Notion AI + Connectors | Business $20/user + Enterprise | n/a | в РФ нет | средняя 40% |
| 13 | Coda AI | $10-30/maker | n/a | низкая в РФ | средняя 30% |
| 14 | Asana Intelligence + AI Studio | $10.99-45/user + AI Studio | n/a | низкая в РФ | дальняя 25% |
| 15 | Linear Agent (март 2026 beta) | n/a | n/a | низкая в РФ | дальняя 25% |
| 16 | **ClickUp Brain** | $9/user/мес | мульти-модель (GPT-5/Claude/o3) + notetaker + Knowledge Q&A + Super Agents | **ВЫСОКАЯ в мире**, низкая РФ | **ближняя 55-60%** |
| 17 | Spinach/Fathom/Otter/tl;dv | разное | meeting-bots с multi-meeting intelligence | средняя | ближняя 60% по MVP |
| 18 | Hyperscience | $50K+/year | document IDP | не конкурент | — |
| 19 | Reggie/Regology | vertical compliance | n/a | не конкурент | — |

## Российские игроки (16) — главный фронт

| # | Компания | Реестр/152-ФЗ/On-prem | AI-функционал | Угроза | Близость |
|---|---|---|---|---|---|
| 20 | **TEAMLY (Qsoft)** | да/да/да + своя LLM на инфре | TEAMLY AI: RAG-чат, цитаты, AI-агенты (в rollout) | **ВЫСОКАЯ Mid+/Enterprise** | **ближняя 55-65%** |
| 21 | GigaChat Enterprise (Сбер) | да/да/да + банковский | Платформа для агентов (LEGO) | низкая прямая, средняя косвенная | средняя 35% |
| 22 | YandexGPT 5.1 Pro / Yandex Cloud | да/да | LLM-as-a-Service | низкая прямая | средняя 30% |
| 23 | Yonote | n/a | Базовый AI-ассистент | низкая | дальняя 20% |
| 24 | Weeek | n/a | AI Vika базовый | низкая | средняя 30% |
| 25 | **Bitrix24 BitrixGPT** | да/да/да (коробка) | CoPilot + follow-up видеозвонков (транскрипция, выжимка, чат) | **ВЫСОКАЯ для SMB** | средняя-ближняя 45-55% |
| 26 | MTS Web Services / MWS AI Agents / MTS Link | да/да | Cotype LLM + платформа агентов + MTS Link с AI | средняя в Enterprise | средняя 40% |
| 27 | Minerva Knowledge / Naumen Erudite | да | RAG + Copilot для embed-AI, intelligent search | средняя в Enterprise/Contact-centers | средняя 35% |
| 28 | ELMA365 / ELMA Cortex | да | AI-агенты в low-code BPM | средняя в BPM | средняя 35% |
| 29 | Pyrus + ИИ-ассистент (фев 2026) | да | AI-боты для задач + HR/customer service | средняя в SMB-Mid | средняя 35% |
| 30 | Compass (Dialog) | да | Чат-боты, AI тонкий | низкая | дальняя 15% |
| 31 | **KAITEN** | да/да | AI-агенты: контроль/support/риски/эффективность + **AI Личный ассистент подключается к встречам, транскрибирует, создаёт задачи** | **ВЫСОКАЯ для meeting-MVP** | **ближняя 55-60%** |
| 32 | Just AI (JAICP) | да | Conversational AI платформа | в contact-центрах высокая, не наш ICP | средняя 35% |
| 33 | 1С:Документооборот + ИИ | да | Чат-бот «Ася», OCR 98%, YandexGPT/OpenAI | в 1C-shop высокая | средняя 30% |
| 34 | Directum RX (Generative AI) | да | Generative AI для текстов, RAG+LLM, локальный deploy | в ECM высокая | средняя 35% |
| 35 | ONLYOFFICE DocSpace + AI | да | Мульти-провайдер AI-агенты | низкая | дальняя 20% |
| 36 | VK Cloud AI | да | AI-консультант RAG/HyDE/Router/Reranker | не конкурент | — |
| 37 | L2U / EvaTeam / Notamedia | — | низкая видимость | низкая | дальняя |

## Куда движется рынок

- **Multi-agent layer over RAG** — все переходят от «search + summary» к «agents that act».
- **Connector wars** — Notion в апр 2026 добавил Salesforce/Box, Glean 100+, Dust сделал MCP. РФ-аналоги отстают.
- **Multi-meeting intelligence** — tl;dv, ClickUp Brain, KAITEN — все добавили «помнит прошлые встречи». Уже **table stakes**.
- **Local LLM как must-have в РФ** — TEAMLY, Directum, GigaChat все поддерживают on-prem + локальную LLM.
- **AI Notetaker встроен в task-tracker** — новая норма (KAITEN, ClickUp, Asana). Убивает stand-alone meeting-tools.

## Главный вывод по wedge C (AI-чат компании)

**Wedge C самый перегретый сегмент.**

- Glean $250M ARR доказал рынок.
- TEAMLY, Minerva, Directum, MTS — все РФ-«AI knowledge assistant».
- ClickUp Brain, Notion AI, Dust — все продают «AI chat over company data».

**Если идти только с AI-чатом — мы попадаем в поле, где Glean диктует UX, а TEAMLY доминирует РФ.**

**НО** AI-чат как **wedge внутри большего нарратива «память компании / AI-COO»** — работает отлично:
- Понятная точка входа («покажите всё что мы решили про X»).
- Демо-эффект мгновенный.
- Из RAG-чата естественно вырастает дашборд CEO и Employee Clones.

**Рекомендация:** AI-чат — первичный wedge для демо/продажи, но позиционирование сразу обозначает категорию «память компании / AI-COO», иначе нас сравнят с Glean/TEAMLY по фичам и проиграем по зрелости.

## Sources

Glean: [$7.2B Series F](https://www.glean.com/press/glean-raises-150m-series-f-at-7-2b-valuation-to-accelerate-enterprise-ai-agent-innovation-globally), [$200M ARR](https://www.glean.com/press/glean-surpasses-200m-in-arr-for-enterprise-ai-doubling-revenue-in-nine-months), [pricing](https://www.gosearch.ai/blog/glean-pricing-explained/)
Hebbia: [pricing 2026](https://www.eesel.ai/blog/hebbia-ai-pricing)
Dust.tt: [pricing](https://dust.tt/home/pricing)
Sana: [$62M Series B](https://sanalabs.com/resources/sana-reaches-62m-dollars-in-series-b-funding)
Mem.ai: [pricing](https://get.mem.ai/pricing)
Vectara: [pricing](https://www.vectara.com/pricing)
Cohere: [Coral](https://cohere.com/blog/introducing-coral-the-knowledge-assistant-for-enterprises)
Khoj: [GitHub](https://github.com/khoj-ai/khoj)
Akooda: [acquired by Tulip](https://news.aibase.com/news/23083)
Notion: [AI Connectors](https://www.notion.com/help/notion-ai-connectors)
ClickUp: [Brain](https://clickup.com/brain)
Asana: [pricing](https://asana.com/pricing)
Linear: [Agent launch](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
TEAMLY: [main](https://teamly.ru/), [on-prem](https://teamly.ru/enterprise/), [spring 2026](https://teamly.ru/spring_2026/), [Habr May 2026 update](https://habr.com/ru/companies/teamly/articles/1029618/)
Sber: [GigaChat Enterprise](https://www.sberbank.ru/ru/sberpress/all/article?newsID=d411da09-8097-467b-8b0a-e6419a402d96)
Yandex: [YandexGPT pricing](https://geoscout.pro/ru/blog/yandexgpt-dlya-biznesa)
Bitrix24: [CoPilot manual](https://helpdesk.bitrix24.ru/manual/copilot/)
Minerva: [site](https://minervasoft.ru/kms)
Naumen Erudite: [site](https://www.naumen.ru/products/erudite/)
ELMA: [Cortex](https://elma365.com/ru/products/ai-cortex/), [winter 2026 release](https://elma365.com/ru/news/2026-winter-release/)
Pyrus: [AI assistant](https://pyrus.com/ru/help/ai/assistant)
KAITEN: [AI](https://kaiten.ru/ai)
Just AI: [JAICP](https://just-ai.com/platforma-jaicp)
1С: [Документооборот AI](https://binavigator.ru/articles/servisy-1s/iskusstvennyy-intellekt-v-1s-dokumentooborot/)
Directum: [Generative AI](https://www.directum.ru/products/directum/intelligence/generative-ai)
MTS AI: [Agents Platform](https://mts.ai/product/ai-agents-platform/)
Constellation Research: [enterprise trends 2026](https://www.constellationr.com/blog-news/insights/enterprise-technology-2026-15-ai-saas-data-business-trends-watch)

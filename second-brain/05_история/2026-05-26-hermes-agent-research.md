---
title: Hermes Agent — research-сессия по технике и применимости к Z
date: 2026-05-26
type: research
distilled: false
---

# Hermes Agent — research-сессия по технике и применимости к Z

## Что было поставлено

Пользователь принёс шпаргалку «Anatomy of a SOUL.md» (8 секций для файла личности AI-агента) + ссылку на гайд по Hermes Agent от Nous Research. Попросил разобрать, что это, какие сильные стороны, как использовать для Z. Затем последовательно расширял запрос:

1. Сначала — общий обзор Hermes (RU + EN).
2. Потом — обсуждения «на других языках, не русский».
3. Потом — углубление в англо-американский слой (подкасты, Substack, инфлюенсеры).
4. Финал: смена фокуса — выкинуть юридическую часть (плагиат-скандал), сфокусироваться на технике + применимости к Z, и параллельно искать как другие страны строят «второй мозг компании» и «клонов сотрудников» технически.
5. Сохранить итог как прото-анализ.

## Как решал

Четыре волны параллельных subagent-ов (по 3-4 агента в каждой волне, общий счёт — 14 агентов).

**Волна 1 — общий контекст.** 3 агента: официальные источники, независимые отзывы, русскоязычные обсуждения + сравнение с альтернативами (Letta/mem0/CrewAI).

**Волна 2 — не-английские страны.** 3 агента: китайское сообщество (Zhihu/V2EX/Tencent Cloud/Bilibili), японско-корейское (Qiita/Zenn/note/velog/PyTorchKR), европейско-латиноамериканское (DACH/FR/ES/PT/IT).

**Волна 3 — углублённый англо-американский слой.** 1 агент: подкасты (Latent Space, ThursdAI), Substack-лонгриды (Lambert «Lossy self-improvement» — главная находка), YouTube, инфлюенсеры (Simon Willison, Karpathy), arXiv (GEPA paper), enterprise endorsements (NVIDIA).

**Волна 4 — техника + применимость.** 4 агента после переориентации запроса: технический deep-dive Hermes (файловая раскладка, slot-порядок промпта, FTS5-схема, GEPA pipeline), employee clones (CrewAI/MetaGPT/Generative Agents/11x/Devin/TwinVoice eval), company memory layer (Letta/mem0/Graphiti/Cognee/Glean/Onyx/pgvector benchmarks/RRF+rerank), self-improvement механики (Reflexion/Voyager/Park/GEPA/DSPy/library drift/reward hacking).

## Что вышло

Один файл: [plans/analysis/2026-05-26-hermes-agent-tech-analysis.md](../../plans/analysis/2026-05-26-hermes-agent-tech-analysis.md) — прото-анализ в 11 разделах:

- Техническая раскладка Hermes (файлы, slot-порядок промпта, 3-tier memory, SKILL.md progressive disclosure, GEPA pipeline).
- Сильные/слабые инженерные решения.
- Применимость к Employee Clones (что брать: SOUL-эквивалент 8 секций, PersonaRAG, skill enumeration, SOP-шаблоны, Park-style reflection; что не брать: voice fingerprinting, fine-tuning под сотрудника, свободный chat между клонами).
- Применимость к self-learning агентам (5 механик: memory stream Park, reflection cycle, skill library с pgvector index по description, multi-version + canary, execution-based assertions).
- Архитектурная карта точечных изменений в Z.
- Первые шаги на 2-3 недели.
- Странновые выжимки.

В код / БД / second-brain структура не вносил — только исследовательский draft.

## Чему научился (применимое к будущим сессиям)

1. **Многоволновая параллельная оркестрация subagent-ов работает.** Четыре волны по 3-4 агента дали плотный материал, который сам бы я собрал в 3-5 раз дольше. Каждая волна — переопределение фокуса с учётом нового запроса пользователя.
2. **На переориентации запроса не пересоздавать прошлые findings.** Когда пользователь сказал «техника, не юридическая часть», новая волна агентов получила НОВЫЕ вопросы, а старые findings (плагиат-скандал, странновые обсуждения) переместились в приложение, не выкидывались.
3. **Архитектурный паттерн «progressive disclosure для skills» (Hermes) + «retrieval по description, не по коду» (Voyager) + «recency+importance+relevance retrieval» (Park) — три самые ценные находки для текущего Z-стека.** Все три ложатся на существующие knowledge-core и prompt registry без переписывания.
4. **Главный антинарратив для категории — Nathan Lambert «Lossy self-improvement».** Не атакует ни один продукт, методологически рушит обещание compounding. **Важно не закладывать в маркетинг Z обещание «становится умнее со временем»** — это методологически уязвимо. Закладывать «сохраняет знания, которые иначе исчезнут».
5. **inspectable memory (markdown-файлы, человеко-читаемые) — реальное продающее свойство в B2B.** Z уже на pgvector, но idea-block + entity + theme можно делать «инспектируемыми» через UI — это аргумент против vector-DB «чёрного ящика» в продажах.
6. **Японский урок «30-60 минут демо — неотличимо от обычного агента».** Compounding-агенты не продаются через демо. Под Z это значит — триал на 14-30 дней, а не «попробуйте сейчас».
7. **Tirith как образец архитектуры security-gate.** Внешний rust-процесс с SHA-256 верификацией, не Python-регулярки в core. Правильное разделение security gate и core. Если в Z будет нужен скан pre-merge для prompts/skills — этот паттерн.
8. **PersonaRAG для Employee Clones лучше fine-tuning во всех осях для текущей задачи Z.** Это явный и подтверждённый из 3 независимых статей вывод (Catch Me If You Can, PersonaRAG, PersonaAgent), который сам по себе экономит компании 6-12 месяцев попыток с fine-tuning.

## Прод-операции

Не требуются — изменений в коде / БД / конфиге не было. Только один markdown-файл в `plans/analysis/` и эта рефлексия.

## Что дальше

- Прото-анализ — отправная точка. Если паттерн идёт в реализацию (например, SOUL.md для Клона Маркетолога или Park-style importance scoring) — отдельный план в `plans/tz/YYYY-MM-DD-...md` с фазовой структурой.
- Источники research'а — в самом анализе, не дублируются в `second-brain/01_projects/`. Если какая-то идея станет частью продукта Z — тогда вынести в профильный 01_projects-файл.

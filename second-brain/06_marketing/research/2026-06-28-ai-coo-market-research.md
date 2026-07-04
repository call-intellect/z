---
title: Рынок AI-операционного директора (AI COO) для компаний 20–100 человек
type: research / competitor-market
status: reference (внешнее исследование, импортировано)
date: 2026-06-28
source: внешний deep-research отчёт (восстановлен из присланного файла; кириллица была в битой кодировке)
related:
  - "[[market-research-2026]]"
  - "[[competitors]]"
  - "[[company-ontology]]"
  - "[[positioning]]"
  - "../../01_projects/ai-coo-layers-blueprint.md"
  - "../../../plans/analysis/2026-05-20-gtm-700m.md"
---

# Рынок AI-операционного директора (AI COO) для компаний 20–100 сотрудников

> **Что это.** Внешнее исследование рынка решений, способных закрыть хотя бы часть функций операционного директора (COO) в SMB 20–100 человек: контроль исполнения задач, синхронизация между отделами, управление бизнес-процессами, управление проектами, разбор коммуникаций. Сохранено как справочный референс — для positioning, GTM и продуктовых развилок Коры.
>
> **Зачем нам.** Кора категорийно — «память компании» ([[positioning]]), и слой Company Memory из парного блюпринта ([ai-coo-layers-blueprint](../../01_projects/ai-coo-layers-blueprint.md)) — это фундамент «AI COO». Это исследование показывает, кто рядом, как они устроены и где пустая ниша. Аналитический разбор «что взять / что отложить» — в [ai-coo-layers-blueprint](../../01_projects/ai-coo-layers-blueprint.md) §«Маппинг на Кору».

---

## Краткий разбор для Коры (мой синтез)

- **AI COO сегодня — не один продукт, а архитектура из трёх слоёв:** system of record (где живут задачи/проекты/процессы), system of action (где AI/автоматизация реально что-то делают), system of memory (встречи, транскрипты, договорённости). Ни один игрок в одиночку не закрывает весь контур COO для SMB.
- **Где Кора уже сильна:** system of memory + граф знаний (наш профиль — [[company-ontology]], [company-framework-slots](../../01_projects/company-framework-slots.md)). Это именно тот слой, на котором конкуренты-«таск-трекеры с AI-кнопкой» проседают.
- **Где пустая ниша (наш шанс):** нет простого AI-COO для 20–100 человек, который сам смотрит на задачи, чаты, встречи, CRM и документы, извлекает обязательства/блокеры, объясняет ПОЧЕМУ компания тормозит и каждый день даёт собственнику короткий брифинг с действиями. Большинство либо красивый таск-трекер с AI-кнопкой, либо meeting-bot без доведения до действия.
- **Ближе всех к «AI COO из коробки»:** Asana (Agentic Work Management), monday.com, ClickUp; из РФ — Bitrix24, Kaiten AI; плюс связка Яндекс Трекер + Yandex Workflows + YandexGPT.
- **Вывод для нас:** дифференциатор Коры — связность памяти (граф) + переход «память → исполнение → процессы → брифинг собственнику», а не очередной work-management UI.

---

## Рамка исследования

Искали не просто «AI-фичи», а решения, закрывающие хотя бы часть функций COO в компании 20–100 человек: контроль исполнения задач, синхронизацию между отделами, управление бизнес-процессами, управление проектами, разбор коммуникаций. В охват вошли и готовые SaaS-платформы, и open-source / self-hosted инструменты, из которых можно собрать собственный слой AI COO.

Оценка по шкале **5.0 → 1.0**:
- **5.0** — почти полноценный AI COO-кокпит для SMB;
- **4.0–4.5** — сильный AI co-pilot для операций, которому обычно нужен ещё один слой;
- **3.0–3.5** — мощный специализированный модуль;
- **2.0–2.5** — хороший строительный блок;
- **1.0–1.5** — точечный инструмент.

Колонка про русский язык: «RU подтверждён», если у решения есть русскоязычный продуктовый сайт или это российский продукт; иначе «RU не подтверждено» на дату исследования.

---

## Как сегодня устроен AI COO

Практически все сильные решения работают по одной логике:

1. **Входные данные:** задачи, проекты, статусы, дедлайны, зависимости, календари, переписки, записи встреч, документы, CRM-объекты, SLA и события из внешних систем.
2. **AI-слой** превращает сырой поток в структурированную «операционную картину»: блокеры, простои, риски, новые поручения, узкие места, перегрузки, нарушения регламентов, изменения приоритетов.
3. **Workflow/agent-слой** создаёт выход: новые задачи, комментарии, письма, протоколы, статусы проектов, executive summaries, напоминания, заполнение CRM, обновление карточек, запуск автоматизаций.

Примеры: Motion из текстового описания строит проект с задачами/датами/назначениями; Process Street генерирует workflow с approvals, ролями и dynamic due dates; Pipefy анализирует процесс, ищет разрывы и предлагает улучшения; Yandex Workflows прогоняет данные Tracker через YandexGPT и пишет результат в комментарий/письмо.

### Четыре архетипа дашбордов/решений

1. **Work management cockpit** — портфели, статусы, дедлайны, зависимости, workload, project health (monday dashboards, ClickUp live dashboards + AI cards, Teamwork project health/utilization/budget).
2. **Communication memory cockpit** — единая библиотека встреч, транскриптов, summary и action items (Fellow, Fireflies, Otter, Fathom, Avoma, Sembly, МТС Линк, Контур.Толк).
3. **Automation & orchestration console** — запуск сценариев, история исполнений, права, approvals, logs, human-in-the-loop, интеграции (Zapier, Make, n8n, Workato, UiPath, Power Automate, Relay.app, Camunda).
4. **Knowledge-and-agent builder** — конструкторы для сборки собственного AI-COO слоя (Flowise, Langflow, CrewAI, Microsoft Agent Framework, LangGraph, AG2; частично self-hosted Plane/OpenProject).

### Боли клиентов, которые закрывает рынок

Разрыв между отделами, потеря контекста после встреч, ручное статус-репортирование, перегруженные календари, скрытые блокеры, отсутствие единой картины по проектам, повторяющиеся ручные шаги.

---

## Короткий вывод по рынку

**AI COO сегодня — не один продукт, а архитектура из трёх слоёв:**
- **System of record:** Asana, monday, ClickUp, Notion, Airtable, Bitrix24, Kaiten, OpenProject, Plane.
- **System of action:** Zapier, Make, n8n, Workato, UiPath, Power Automate, Relay.app, Camunda, Process Street.
- **System of memory:** Fellow, Fireflies, Otter, Fathom, Avoma, Sembly, МТС Линк, Контур.Толк.

Без всех трёх слоёв «AI COO» обычно превращается либо в красивый таск-трекер с AI-кнопкой, либо в meeting-bot, который не умеет доводить дело до действия.

### Три сильных сценария для компаний 20–100 человек

1. Готовая англоязычная платформа (Asana / monday / ClickUp / Notion) + action-layer (Zapier/Make/n8n) + meeting-layer (Fellow/Fathom/Otter/Fireflies).
2. Российский/локализуемый стек: Bitrix24, Kaiten, Яндекс Трекер, МТС Линк, Контур.Толк, WEEEK + automation в n8n или Yandex Workflows.
3. On-prem / sovereignty: OpenProject или Plane + n8n + Flowise/Langflow + собственная LLM/MCP-интеграция.

---

## Сравнительная таблица коммерческих и российских решений

| Решение | Что делает как AI COO | Цена/API/RU | Оценка |
|---|---|---|---|
| **Asana — global** | Agentic work management: AI Teammates, AI Studio, Asana Dash. Сильнее всего в межфункциональной координации и visibility; слабее как memory-layer без отдельного meeting-слоя. | от $10.99/польз./мес; API/интеграции есть; RU не подтверждено | **4.7/5** — один из самых близких к «AI COO cockpit» для SMB |
| **monday.com — global** | AI work platform; dashboards дают единый вид по boards, AI credits измеряют все AI-функции. Хорош для контроля прогресса, блокеров, кросс-командной синхронизации. | от $9/seat/мес; API/интеграции есть; RU не подтверждено | **4.6/5** — сильный AI-координатор с хорошей наблюдаемостью |
| **ClickUp — global** | Live dashboards + ClickUp Brain. Строит готовые dashboards, executive overviews, pages, deliverables. | Brain от $9/польз./мес; API/MCP/webhooks; RU не подтверждено | **4.6/5** — кандидат на «операционный штаб» для 20–100 человек |
| **Bitrix24 — Россия** | AI-ассистент внутри CRM и рабочих процессов: ставит дела, назначает встречи, ищет документы, анализирует чаты/звонки, заполняет CRM; MCP для AI-агентов. | публичные тарифы; открытый API/MCP; RU подтверждён | **4.5/5** — лучший «локальный» претендент, если подходит экосистема Bitrix24 |
| **Kaiten AI — Россия** | «Команда ИИ-сотрудников»: AI личный ассистент, AI PM, AI руководитель. Протоколы встреч, создание задач, риски, анализ сроков/загрузки/потерь. | тарифы публичны; открытый API; RU подтверждён; часть AI в бете | **4.4/5** — сильный российский вариант, особенно при on-prem |
| **Motion — global** | AI Project Manager: из описания/документов строит проект со стадиями/датами/назначениями, постоянно перепланирует календарь. | от $19/seat/мес; API есть; RU не подтверждено | **4.3/5** — «операционный диспетчер», слабее в процессах и meeting intelligence |
| **Airtable — global** | AI-powered workflows, apps and agents поверх low-code модели. | публичные тарифы; Web API/интеграции; RU не подтверждено | **4.2/5** — мощно, если нужен кастомный AI COO без тяжёлой разработки |
| **Teamwork.com — EU/global** | Project health report, utilization, workload, budget usage, reminders. Для сервисных команд (агентства, интеграторы, проф-сервисы). | прайс/API публичны; 150+ интеграций и MCP; RU не подтверждено | **4.2/5** |
| **Notion — global** | AI workspace: агенты двигают работу 24/7, AI Meeting Notes транскрибируют и структурируют встречи, вытягивают риски и blockers со страниц. | публичные тарифы; API/webhooks; RU не подтверждено | **4.1/5** — «мозг и память» компании, action-layer лучше усиливать automation-платформой |
| **Pipefy — global** | AI Agents анализируют, оптимизируют, ищут разрывы, масштабируют операции. Силён в заявках/approvals/service delivery. | цены частично публичны/по запросу; API; RU не подтверждено | **4.1/5** — «процессный COO» |
| **Process Street — global** | Compliance operations: превращает policies в AI-enforced workflows с approvals, ролями, dynamic due dates. | публичный pricing/trial; API/automations; RU не подтверждено | **4.0/5** — если боль = повторяемость процессов и регламенты |
| **Wrike — global** | Wrike Copilot отвечает по данным Wrike, строит графики; линейки Apex/Pinnacle — human+AI-led workflows. | прайс частично публичен; высокие AI tiers — contact sales; RU не подтверждено | **3.9/5** — сильный enterprise-ish PM/copilot |
| **Яндекс Трекер + YandexGPT/Workflows — Россия** | Tracker даёт задачи/проекты/цели/dashboards/automation; Yandex Workflows + YandexGPT превращают данные в анализ, пишут в комментарий/email. Не один продукт, а связка-конструктор. | usage-based (Yandex Cloud + Tracker); API/automation; RU подтверждён | **3.9/5** — сильный конструктор российского AI COO, но требует сборки |
| **Smartsheet — global** | Data/project/reporting hub: dashboards, cross-system visibility, MCP и API к AI. Для PMO и operations. | прайс публичен; API/MCP; RU не подтверждено | **3.8/5** |
| **Coda — global** | Connected work assistant: docs + tables + workflows + AI в одном месте. | AI для Doc Makers; API/интеграции; RU не подтверждено | **3.8/5** — нужен action-layer рядом |
| **Jira — global** | Rovo/AI: natural-language search, AI automation, summarization, create child work items. Для engineering/product/ops backlog. | публичный прайс; API; RU не подтверждено | **3.8/5** — тяжелее как общий COO для всей компании |
| **UiPath — global** | Agentic automation + Maestro: координирует AI agents, robots, APIs и людей в BPMN/DMN-процессе. | от $25/мес базово, далее enterprise; API/orchestration; RU не подтверждено | **3.8/5** — мощнейший orchestration-движок, для многих SMB тяжеловат |
| **Relay.app — global** | AI-native automation с human-in-the-loop, NL workflow creation, агенты как владельцы ответственностей. | от $19/мес; 200+ интеграций; custom HTTP/API; RU не подтверждено | **3.8/5** — сильный no-code action-layer для SMB |
| **Zapier — global** | Agents как AI teammates; no-code action-layer к 9000+ приложениям. Превращает summary/signals в задачи/письма/комментарии/обновления CRM. | прайс публичен; огромная экосистема; RU не подтверждено | **3.7/5** — не cockpit, а очень сильная «рука» AI COO |
| **Make — global** | AI Agents + visual builder. Мультишаговая автоматизация back-office, синхронизация между системами. | прайс и AI Agent API публичны; RU не подтверждено | **3.7/5** |
| **Workato — global** | Agentic orchestration, secure MCP, 14000+ apps, governance, audit trails. | usage-based; интеграции публичны; RU не подтверждено | **3.7/5** — часто избыточен для классического SMB |
| **Power Automate — global** | Copilot строит cloud flows из естественного языка; action-layer внутри Microsoft 365. | Premium от €15/польз./мес; RU не подтверждено | **3.7/5** — если компания уже в Microsoft 365 |
| **Camunda — global** | Open platform for agentic orchestration: координация AI agents, людей и систем через end-to-end процессы. | free/self-managed + enterprise; API/SDK; RU не подтверждено | **3.6/5** — сильный process engine, не готовый AI COO интерфейс |
| **Fellow — global** | Meeting assistant + AskFellow agent + CRM automation + pre-meeting briefs + action items. | публичный pricing; API/MCP; RU не подтверждено | **3.6/5** — один из лучших meeting-layer для COO |
| **Otter — global** | AI notetaker + conversational knowledge engine: transcripts, insights, action items, workflows, API/webhooks. | от $8.33/польз./мес; API для Enterprise; RU не подтверждено | **3.5/5** — memory layer, не единый COO |
| **Fireflies.ai — global** | Meeting/email/chat/CRM assistant: notes, tasks, automations, searchable KB. | публичный pricing; API; RU не подтверждено | **3.5/5** |
| **Fathom — global** | Conversation intelligence + CRM updates, scorecards, API, webhooks, MCP. Для sales/success/service ops. | free + paid team plan; RU не подтверждено | **3.5/5** |
| **Avoma — global** | AI meeting assistant + scheduler + CRM updates + deal risk alerts + coaching. | от $19/seat/мес; API/webhooks; RU не подтверждено | **3.5/5** — вокруг revenue/service ops |
| **Sembly AI — global** | Meeting intelligence + AI chat + tasks + conversation search + webhooks/Zapier. | от $20/польз./мес; RU не подтверждено | **3.4/5** |
| **МТС Линк — Россия** | Платформа встреч/работы/обучения с ИИ. AI secretary готовит протокол, фиксирует ответственных и итоги. | стоимость зависит от продукта/тарифа; публичный API для AI minutes неочевиден; RU подтверждён | **3.4/5** — российский memory/протоколирование layer |
| **Контур.Толк — Россия** | AI-саммари, протокол встречи, расшифровка, задачи с ответственными и дедлайнами на платных тарифах; API и интеграции с календарями. | есть бесплатный старт и платные тарифы; API; RU подтверждён | **3.4/5** — communication layer для русскоязычной компании |
| **Reclaim.ai — global** | AI calendar: задачи, фокус-время, meetings, habits, people analytics, scheduling links. | free + от $12/seat/мес; интеграции/webhooks; RU не подтверждено | **3.3/5** — операционный ассистент по времени, не полный COO |
| **Trello — global** | AI генерирует/трансформирует/суммирует контент; 200+ интеграций, но модель boards/cards ограничивает глубину аналитики. | Premium от $10/польз./мес; REST API; RU не подтверждено | **3.2/5** |
| **WEEEK — Россия** | Таск-менеджер + CRM + база знаний; публичный API; в материалах фигурируют Weeek-GPT и AI-помощник. | публичные тарифы и API; RU подтверждён | **3.1/5** — доступная база для lightweight ops, AI-функции пока ранние |

---

## Открытые и self-hosted решения

Важны не как «готовое окно для руководителя», а как способ собрать собственный операционный слой под требования по безопасности, интеграциям и data residency (особенно для РФ — реальный путь к AI COO on-premise).

| Решение | Что можно собрать | Цена и зрелость | Когда уместно |
|---|---|---|---|
| **n8n** — source-available/self-hosted | Visual automation с AI agents и traceable reasoning «на canvas». Action-layer: читает события, вызывает LLM, пишет обратно в Jira/Bitrix/CRM/почту/Slack. «Операционная нервная система» AI COO. | публичные cloud-тарифы; self-hosting; source-available | Нужен self-hosted automation-layer с контролем логики и данных |
| **OpenProject Community/Enterprise** — OSS | Open-source PM: portfolios, schedules, work packages, meeting management, API/webhooks. Надёжный system of record под self-hosted операции. | Community бесплатна; enterprise/cloud платные | Нужен суверенный PM/portfolio hub и on-prem |
| **Plane Community Edition** — OSS | AI-native PM workspace: Projects, Wiki, AI; Community под AGPL, self-hosting на Docker/K8s, REST API, SDK, MCP server. | free Community + платные cloud/business | Современный open-source PM hub с AI и self-hosting |
| **Flowise** — OSS + cloud | Visual builder для AI agents и LLM workflows: tracing, analytics, evaluations, human-in-the-loop, API/CLI/SDK, Agentflow. | OSS бесплатно; cloud от $35/мес | Быстро собрать внутренних агентов без тяжёлой разработки |
| **Langflow** — OSS + cloud | Low-code builder для agentic/RAG: fleet of agents, Flow as API, cloud/self-hosted, сотни data sources. | OSS бесплатно; cloud/free account | AI-слой поверх внутренних баз знаний и процессов |
| **CrewAI** — open framework/platform | Orchestration автономных агентов и сложных workflows; enterprise tools/integrations. | free tier + enterprise; OSS-ядро | Multi-agent orchestration под конкретные бизнес-роли |
| **AutoGen** — OSS framework | Deterministic/dynamic agentic workflows, multi-agent collaboration, task decomposition. Сейчас в maintenance mode. | бесплатный OSS | Только если команда уже знает AutoGen; иначе смотреть AG2/Microsoft Agent Framework |
| **Microsoft Agent Framework** — OSS | Multi-language framework для production-grade AI agents и multi-agent workflows в .NET и Python. | бесплатный OSS | Команда сильна в Microsoft stack |
| **LangGraph** — OSS | Low-level orchestration для long-running, stateful agents: durable execution, human-in-the-loop, streaming, deployment. | MIT OSS; managed deployment платный | Надёжное «ядро» агентного COO-слоя |
| **AG2** — OSS | Open-source multi-agent (бывший AutoGen-путь): orchestration, A2A, tools, observability, scalable multi-agent. | бесплатный OSS | Современный open-source multi-agent стек вместо классического AutoGen |

---

## Что выбрать российской компании 20–100 человек

- **Самый короткий путь без разработки:** Asana / monday / ClickUp как основной cockpit + один automation-layer + один meeting-layer. Для INT-стека: ClickUp + Make/Zapier + Fellow/Fathom, либо Asana + Zapier/n8n + Otter/Fireflies.
- **Российский/русскоязычный стек:** Kaiten или Bitrix24 (system of record) + МТС Линк или Контур.Толк (system of memory) + n8n или Yandex Workflows (system of action). Для лёгких сценариев — WEEEK.
- **On-prem / data residency:** OpenProject или Plane + n8n + Flowise/Langflow + собственная LLM/MCP; либо инженерный путь n8n + LangGraph/CrewAI/AG2/Microsoft Agent Framework, где продукт — собственная агентная операционная система компании.

**Главный вывод:** технологий на рынке уже достаточно, чтобы заменить значительную часть рутины COO, но почти всегда это не один «чудо-сервис», а связка cockpit + action layer + memory layer. Хочешь быстро — бери готовые work-management продукты с AI. Приоритет локализации и контроля данных — стек вокруг Kaiten/Bitrix24/Яндекса/Контур-МТС + self-hosted automation. Нужен реально кастомный AI COO, принадлежащий компании — открытый стек (n8n, Plane/OpenProject, агентные фреймворки).

---

_Примечание: исходный отчёт содержал инлайн-ссылки на источники (внутренние ref-токены deep-research инструмента); при восстановлении они опущены как нечитаемые артефакты. Перечень типов источников — официальные сайты, прайсы и документация перечисленных платформ._

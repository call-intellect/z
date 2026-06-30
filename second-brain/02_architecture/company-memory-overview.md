---
type: architecture
feature: company-memory
status: active
created: 2026-05-31
updated: 2026-05-31
---

# Второй мозг компании-клиента — обзорная карта

> **Зачем этот файл:** быстрый ответ на вопрос «как у нас в Коре устроен второй мозг для компании-клиента». Карта 7 слоёв + сравнение с нашим разработческим `second-brain/`. Технические детали воркеров — в [[knowledge-core]]. Бизнес-контекст — в [[../06_marketing/positioning|positioning]].

## TL;DR

Внутри Коры для каждой компании-клиента (`Org`) живёт **изолированный граф знаний** в PostgreSQL + pgvector. В отличие от папок с `.md`, которые ведёт разработчик, тут записи кладут **AI-агенты автоматически** из всех каналов (встречи, Telegram, email, документы, трекер). Граф организован в **7 слоёв** с per-tenant изоляцией, RBAC, DataClassPolicy и bitemporal-моделью.

## Главная разница с нашим разработческим second-brain

| `second-brain/` в репо | Память компании в Коре |
|---|---|
| Папки `.md`, кладёт человек/Claude вручную | БД PostgreSQL + pgvector, кладут AI-агенты автоматически |
| Жёсткая таксономия из 7 папок | Гибкий граф из узлов и связей |
| Перелинковка `[[wikilinks]]` руками | Связи рисуются KNN-поиском + LLM-арбитром |
| Источник один — разработчик | Источников много: встречи, Telegram, email, документы, трекер, in-app |
| Один проект | Multi-tenancy: десятки `Org` на одном движке |
| Правила в `STRUCTURE_RULES.md` | Правила в коде специалистов + DataClassPolicy + RBAC |

Аналогия: наш `second-brain/` — личный блокнот разработчика с дисциплиной. Кора для клиента — AI-секретариат из 9 специалистов, общий куратор-редактор и архивариус, которые сами слушают каналы, сами раскладывают по полкам, сами рисуют связи, сами ловят противоречия, сами задают уточняющие вопросы и сами отвечают, когда у них спрашивают.

## 7 слоёв архитектуры

### Слой 1 — Каналы (входящие источники)
Унифицированный приёмник: LiveKit-встречи, Telegram-бот, email, in-app заметки, трекер задач, документы (PDF/DOCX/MD). Каждый источник пишет в `RawEvent` через свой адаптер (`meeting.adapter`, `telegram.adapter`, `text.adapter`, `tracker.adapter`, `document.adapter`). Это «уши» компании. Детали: [[../01_projects/ingest-and-sources]], [[../01_projects/conversational-channels]].

### Слой 2 — Атомы знания
Из сырых событий выделяются **IdeaBlock'и** — атомарные мысли (одна идея, одно решение, один факт). У каждого блока есть `signalType` (decision / fact / rationale / regulation / process_step / pain / risk / idea / commitment / …). Параллельно достаются **Entity** — упомянутые сущности (person/customer/project/product/vendor/…). На атомах считается embedding (`embeddinggemma:latest`, 768-dim) и работает гибридный поиск (cosine 0.7 + BM25 0.3). Детали: [[knowledge-core]].

### Слой 3 — Специалисты (9 виртуальных «отделов»)
Каждый собирает свою область знаний из общего потока блоков. Работают по единому контракту (§5 зонтичного ТЗ `2026-05-21-second-brain-agents-umbrella.md`), но каждый — независимый воркер с собственным LLM-промптом. Все подписаны на `core.specialist-routing` и сами решают, тригерится их логика по `signalType` или нет. Добавить специалиста 3.10/3.11/3.12 можно без переделки ядра — через `CardSpecialistRegistry`.

| Специалист | Что собирает | Заметка |
|---|---|---|
| 3.1 Regulations | Регламенты, процессы, политики | [[../01_projects/regulations]] |
| 3.2 Knowledge Clone | Что **знает** каждый сотрудник | [[../01_projects/knowledge-clone]] |
| 3.3 Decisions | Реестр решений с rationale, alternatives, supersede | [[../01_projects/decisions]] |
| 3.4 Project/Customer | Карточки клиентов и проектов (эталон §5) | [[../01_projects/specialist-3-4-project-customer]] |
| 3.5 Insights Radar | Повторяющиеся боли, риски, блокеры с динамикой | [[../01_projects/insights]] |
| 3.6 Ideas | Идеи сотрудников и запросы клиентов | [[../01_projects/ideas]] |
| 3.7 SkillProfile + Клоны ролей | «Клон Маркетолога v2» — артефакт по должности | [[../01_projects/skill-and-clone]] |

### Слой 4 — Куратор
Не каждый блок сразу становится «каноном». Делает **triage**: `auto` (низкий риск → пишем сразу), `light` (лёгкая проверка), `deep` (для критичных — `decision` всегда deep). Ловит **конфликты**; главное — отдельный тип резолюции `evolving` («оба верны в разное время»), потому что в бизнесе «закрыто vs активно» — это не противоречие, а эволюция. Детали: [[../01_projects/curation]].

### Слой 5 — Chat-v2 (AI-чат компании)
Единая точка чтения накопленного. Три режима: `factual` (с цитатами), `synthetic` (синтез из нескольких источников), `clone_style` (отвечает как «Клон Маркетолога» через специалиста 3.7). Omnichannel: Telegram / web / in-app / email — везде один и тот же мозг. Детали: [[../01_projects/chat-v2]].

### Слой 6 — Probe-агент
Когда специалист видит дыру (нет владельца у регламента, нет дедлайна у решения, новая экспертиза у сотрудника) — он не молчит, а **сам задаёт вопрос человеку** через любой канал. С дедупом (Redis по contentHash, TTL 72ч), rate-limit (5/час и 20/день на пользователя), приоритизацией, cold-start защитой. Принципиально — **только свободный текст или голос (ASR)**, никаких inline-кнопок (см. memory `feedback_probe_no_buttons_text_voice_only`). Детали: [[../01_projects/probe-agent]].

### Слой 7 — Темы
Каждый час кластеризатор группирует блоки по смыслу (KNN-greedy + union-find, threshold 0.78), LLM именует кластер, получается `Theme`. Темы — самоорганизующиеся «папки», компания не выбирает рубрики заранее. `reframing.cron` раз в сутки разводит/сливает темы по дрейфу.

## Граф связей — это и есть «перелинковка»

В нашем `second-brain/` ссылки расставляет человек. У клиента — алгоритм:

- **IdeaBlockLink** — 7 типов: `develops`, `contradicts`, `causes`, `consequences_of`, `shares_topic`, `shares_entity`, `question_answered_by`.
- **EntityLink** — 6 типов: `works_at`, `belongs_to`, `part_of`, `opposes`, `depends_on`, `mentions_with`.

Алгоритм: `block-linker.worker` берёт каждый новый блок → KNN ищет top-10 ближайших по смыслу → LLM-арбитр выносит вердикт «это какая из 7 связей или вообще не связь». Связи с confidence < 0.75 отбрасываются. `entity-graph-builder.cron` (раз в час) ищет co-mentioned пары сущностей и тоже маркирует через LLM. `reframing.cron` раз в сутки чистит слабые связи.

## Multi-tenancy и доступ

Каждая запись имеет `tenantId = Org.id`. Любой запрос в knowledge-core **обязан** прийти с `X-Org-Id` через `TenantGuard`. Внутри одной БД живут десятки `Org`, но они не видят друг друга.

Поверх — **RBAC** (5 ролей: super_admin / owner / admin / manager / coo) + два режима видимости:
- `open` — менеджер видит всё в компании;
- `strict` — менеджер видит только свою команду.

Плюс **DataClassPolicy** (4 уровня чувствительности: `public` / `internal` / `sensitive` / `private`). Каждый канал доставки маркирован максимальным уровнем (например `telegram_dm` по умолчанию `internal`). Чтобы `sensitive`-инфа полетела в Telegram — владелец должен явно включить opt-in в `/me/channels`. `private` не утекает наружу никогда. Аудит — на каждой проекции (`dataClassAudit`). Детали: [[../01_projects/rbac-access-control]], `plans/archive/2026-05-25-knowledge-core-temporal-and-graph-quality.md` Волна 4.

## Bitemporal — память помнит «как было тогда»

В отличие от перезаписи `.md`, блоки и связи имеют **два времени**:
- `validFrom` / `validUntil` — когда факт был **истинным в реальности**;
- `recordedAt` / `supersededAt` — когда мы **узнали** этот факт.

Snapshot API `?at=ISO` возвращает состояние графа на любую дату. Это даёт обоснованный аудит-трейл («почему мы тогда так решили?») и работающую функцию supersede у решений. Generic-арбитр `fact-supersede-detect` закрывает по времени 6 типов signalType (fact / commitment / commitment_status / plan_item / done_item / client_request). Детали: волна 1 ТЗ `2026-05-25-knowledge-core-temporal-and-graph-quality.md`.

## Pipeline — упрощённая схема

```
LiveKit-встреча / Telegram / email / трекер / документ / in-app
        │
        ▼
   RawEvent (Слой 1)
        │
        ▼ core.raw-events
   block-ingest.worker
        ├─ нарезка на ≤2000 токенов
        ├─ LLM выделяет IdeaBlock'и (signalType, текст, evidence)
        ├─ embedding (embeddinggemma:latest, 768-dim)
        └─ Entity (findOrCreate)
        │
        ▼ debounce 30s
   block-distill.worker          ← дедуп блоков: KNN cosine > 0.92 + LLM-арбитр
        │
        ▼
   block-linker.worker           ← 7 типов связей
   entity-resolver.worker        ← дедуп сущностей
   theme-clusterer.cron          ← :15 каждый час
   reframing.cron                ← раз в сутки 3:00, чистит слабые связи + decay
        │
        ▼
   core.specialist-routing — fan-out по 9 специалистам
        ├─ 3.1 Regulations
        ├─ 3.2 Knowledge Clone
        ├─ 3.3 Decisions
        ├─ 3.4 Project/Customer
        ├─ 3.5 Insights
        ├─ 3.6 Ideas
        └─ 3.7 SkillProfile/Clones
        │
        ▼
   Curator (Слой 4) — auto / light / deep
        ▼
   Chat-v2 (Слой 5) ← пользователь спрашивает
   Probe (Слой 6) → пользователю задают вопрос
```

## Что даёт «более профессиональное» по сравнению с папками

1. **Автоматизм** — никто не сортирует записи руками. Специалисты делят поток сами по `signalType`.
2. **Дедупликация** — «купим CRM», сказанное на 3 встречах, не превращается в 3 решения, а в одно с тремя evidence.
3. **Граф вместо дерева** — одна сущность (клиент Acme) живёт в одной записи, к ней подцеплены все блоки, решения, идеи, риски, регламенты.
4. **Эволюция вместо удаления** — `supersede`-цепочки, `evolving`-конфликты, `validFrom/validUntil` дают историю «как менялась правда».
5. **Multi-tenancy + RBAC + DataClass** — клиентская изоляция, ролевой доступ, политика конфиденциальности на каждой проекции.
6. **Обратная связь** — Probe-агент сам приходит и спрашивает недостающее. В наших папках мы пишем, что «надо обновить», а в Коре агент сам задаёт уточнение.
7. **Куратор** — авто-канон только для безопасных вещей; критичное (решения, регламенты) идёт на постфактумный human review через `mark_as_misleading` — без блокирующего одобрения, но с ретроактивной правкой (см. memory `feedback_no_human_in_loop_for_clone_learning`).
8. **Один поиск на всё** — гибридный (смысл + ключевые слова + граф) поверх всей истории компании, а не grep по папкам.

## Куда углубляться дальше

- Технический pipeline и воркеры — [[knowledge-core]]
- Multi-tenancy и роли — [[../01_projects/rbac-access-control]], [[../01_projects/rbac-access-control]]
- LLM-провайдеры и каналы — [[../01_projects/llm-providers-verified]], [[llm-cache-status]]
- Карта модулей и потоков — [[module-map]]
- Каждый специалист отдельно — `01_projects/regulations|knowledge-clone|decisions|insights|ideas|skill-and-clone|specialist-3-4-project-customer`
- Куратор и конфликты — [[../01_projects/curation]]
- Probe-агент — [[../01_projects/probe-agent]]
- AI-чат — [[../01_projects/chat-v2]]

[[../index|← index]]

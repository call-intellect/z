---
type: tz
status: draft
feature: Второй мозг компании — архитектура 12 агентов в 6 слоях
date: 2026-05-21
umbrella: true
children:
  - tz/2026-05-21-sba-alpha-1-channels-foundation.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-beta-1-channels-telegram-max.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md (draft, создан 2026-05-21)
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (draft, создан 2026-05-21)
related:
  - tz/2026-05-10-knowledge-core-tz.md (Фазы 1–12 knowledge-core — фундамент, поверх которого строится этот ТЗ)
  - tz/2026-05-21-phase-0-roles-and-onboarding.md (Фаза 0 — каркас компании, поглощается специалистами Слоя 3)
  - second-brain/02_architecture/knowledge-core.md (актуальное состояние ядра)
  - second-brain/06_marketing/company-ontology.md (13 классов сущностей — источник для онтологии Слоя 2)
---

# ТЗ: Второй мозг компании — архитектура 12 агентов в 6 слоях (зонтичный документ)

> **Это зонтичный документ.** Он фиксирует цель, scope, шесть принятых архитектурных решений, карту 12 агентов в 6 слоях, фазовую раскатку α/β/γ и карту 13 sub-TZ. Сами sub-TZ — отдельные документы. Этот файл — точка контроля «ничего не потеряли» **до** старта объёмной работы.
>
> **Источник архитектурных решений:** диалог с владельцем продукта от 2026-05-21 (фиксация 6 развилок). Каждое решение зафиксировано в §3 с обоснованием.
>
> **При расхождениях** между этим зонтичным и sub-TZ — приоритет у этого документа. Sub-TZ детализируют, не пересматривают.

---

## 1. Цель

После реализации всех фаз (α + β + γ) в Z работает **полноценный «второй мозг компании»** — омниканальная система, которая:

1. **Превращает поток сырья** (встречи, чек-ины, чаты, документы, голосовые сообщения через любой канал) **в структурированное знание** через типизированный конвейер шести слоёв.
2. **Хранит знание как два связных слоя**: универсальные атомы смысла (`IdeaBlock` + граф) и типизированные карточки специалистов (Decision, Regulation, Insight, Idea, SkillProfile и т.д.) с провенансом до исходной цитаты.
3. **Отвечает пользователю через AI-чат компании**, доступный через **любой канал** (in-app, Telegram, MAX, email, …) — единый conversational layer, не «веб-приложение с нотификациями».
4. **Замыкает петлю самообучения** — активно задаёт точечные вопросы сотруднику через привычный канал, когда находит пробел или неоднозначность.
5. **Имеет систему контроля качества** с triage'ем (auto-canonical / light review / deep review), per-domain кураторами и обязательным разрешением конфликтов как first-class событий, включая `evolving` для temporal-памяти.
6. **Создаёт исполняемые клоны сотрудников** на базе наблюдаемого реального поведения роли — рабочий артефакт компании, доступный через тот же conversational layer.

Это уровень продукта, после которого Z перестаёт быть «AI-видеовстречи» и становится **memory layer для команды**.

---

## 2. Scope

### Входит

**A. Расширение Слоя 1 (Разметка).**
- Расширение enum `IdeaBlock.signalType` — добавление `reasoning` / `rationale` / `decision_basis` (главный источник для Слоя 3.7) и `regulation` / `process_step` (источники для Слоя 3.1).
- Reasoning-extractor — отдельная подтипизация в `BlockExtractionService`: распознавание блоков-обоснований («потому что», «я учёл», «есть trade-off X vs Y»).

**B. Расширение Слоя 2 (Маршрутизатор и сущности).**
- Расширение enum `Entity.type` с 7 до ~12 значений: `person | customer | vendor | project | product | document | goal | event | topic | location | technology | metric`. Миграция `client → customer` (rename значения + patch-script).
- Удаление значения `custom` как мусорки.
- Новые модели категории A (первичные сущности, существуют независимо от извлечения): `Vendor`, `Event`. Расширение существующих (`Person`, `Customer/Card.kind=client`, `Project/Card.kind=project`, `Goal`, `Document`, `Product`) — поле `entityId` для связки с графовым узлом.
- Расширение `EntityResolutionService` на новые типы.
- Внутренний `RouterService` — диспатчер атомов к специалистам Слоя 3 на основе `signalType` + контекста.

**C. Слой 3 — специалисты по типам знания (7 агентов).**
- **3.1 Regulations** (α) — карточки `Regulation`/`Process`/`Policy` из блоков с `signalType='regulation'/'process_step'` + Document-ingest. Поглощает каркас 5 уровней из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md).
- **3.2 Knowledge Clone** (β) — расширение `Person` фактами «что знает / опыт / типовые ответы». UI «мой клон» (preview-только) в ЛК.
- **3.3 Decisions** (β) — новая модель `Decision` с `rationale`/`alternatives`/`status`/`supersedesId`/`decidedByIds[]`. Реестр решений с автором, сроком, статусом.
- **3.4 Project/Customer Context** (α) — расширение существующего [card-rollup-v2.worker](../../backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts) + Card. Эталонный референс «как должен выглядеть специалист» — паттерн для всех остальных.
- **3.5 Insights Radar** (β) — детектор повторяющихся проблем/блокеров. Дашборд динамики.
- **3.6 Ideas Collector** (β) — собирает идеи (внутренние + клиентские) + кластеризация. Выпускается **только** в паре со Слоем 6.
- **3.7 SkillProfile + Executable Persona + Clone API** (γ) — наблюдение поведенческих паттернов из reasoning-блоков. Эмерджентные категории. Клон-агент через `POST /api/v1/clones/persons/:id/ask`.

**D. Слой 4 (Контроль качества).**
- Triage с тремя уровнями (auto-canonical / light review / deep review) и настраиваемыми порогами per-org через `/settings/curation`.
- `CuratorAssignment` per-ResourceType — гибкое назначение кураторов.
- Multi-touch UI: страница `/curation`, inline-виджет на странице карточки, conversational probe, dashboard-widget.
- Модели: `CurationItem`, `CurationDecision` (typed audit event), `ConflictItem`, `CardVersion`.
- Conflict как first-class: resolution-типы `accept_new` / `keep_old` / `merge` / `evolving`. `evolving` — обязательная категория для temporal-памяти.
- Stale-detection (cron) — probe владельцу через channels, fallback на `stale` → `superseded`.
- Skill — post-hoc контроль (mark_as_misleading), без pre-approval.

**E. Слой 5 (Ответы).**
- Chat-v2 поверх knowledge-core — заменяет deprecated chunk-RAG ([`MeetingTranscriptChunk`](../../backend/src/modules/ai/services/embeddings/)).
- Работает поверх `IdeaBlock` + всех карточек специалистов через единый поиск + графовый обход.
- Цитирует через `IdeaBlockEvidence` цепочку.
- **Omnichannel** — доступен через все каналы, не только web-UI. Это часть его ТЗ.
- Уровни ответа: factual (с цитатой) / synthetic (свод с указанием неуверенности) / clone-style (от имени конкретного носителя).

**F. Слой 6 (Активный уточнитель).**
- Probe-Agent — отдельный воркер, читающий сигналы «пробел/неоднозначность» от специалистов Слоя 3.
- Формулирует точечный вопрос, выбирает адресата, отправляет через `ConversationalModule`.
- Анти-спам логика: rate limits per-user, quiet hours, приоритизация.
- Ответ возвращается через любой канал как новый `RawEvent` с `respondsToNotificationId` → идёт через ingest.

**G. Conversational Channels (Inbound + Outbound).**
- `ConversationalModule` как отдельный инфра-слой (не «notification»).
- Channel = **двунаправленная** абстракция. InApp — равноправный канал, не «UI».
- Channel kinds (α): `in_app`, `email_smtp`, `email_imap` (опц.).
- Channel kinds (β): `telegram_bot`, `max_bot`.
- Channel kinds (γ+): открыто к Slack, Mattermost, VK Messenger, WhatsApp, web_push, voice_via_asr.
- Три типа inbound: free note → ingest, response → linked to probe, AI-chat query → routed to chat-v2.
- Модели: `Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery`.
- `dataClass`-фильтр на канал (паттерн из `LlmRouterService`).
- Universal linking flow (одноразовый код в ЛК → команда `/link` в боте).

**H. Сквозные требования.**
- Контракт специалиста (см. §5) — обязательный для всех 7 агентов Слоя 3.
- Расширение RBAC (`ResourceType`) на все новые модели: `regulation`, `decision`, `insight`, `idea`, `skill_profile`, `clone_persona`, `curation_item`, `conflict_item`, `channel`, `notification`.
- Расширение `BusinessMetricsService` — counters/gauges/histograms по новому conversational layer и curation.
- Расширение `LlmTaskType` enum новыми taskType'ами под каждого специалиста и под reasoning-extractor.
- Все промпты — placeholders в коде с TODO «согласовать с владельцем продукта», **тексты — отдельный круг согласования** (см. §11).

### Не входит

- **Перезапись Фаз 1–4 knowledge-core.** Двухслойная модель (см. §3.1) — это эволюция, не замена. `IdeaBlock` + граф + темы остаются.
- **CRUD-страницы и админка для сущностей категории C** (Regulation, Process, Decision, Risk, Metric) — UI появляется внутри соответствующих sub-TZ специалистов, не централизованно.
- **Voice-через-ASR канал** — архитектурно поддерживается, реализация в γ+.
- **WhatsApp / Slack / Mattermost адаптеры** — после γ под клиентский запрос.
- **Multi-org агрегаты skill** (отраслевые бенчмарки) — после γ.
- **Биллинг по использованию AI-чата** (per-message pricing) — отдельный плановый блок, не в этом ТЗ.
- **Mobile-приложение Z** — отдельный продуктовый трек.

---

## 3. Принятые архитектурные решения

Шесть решений зафиксированы в диалоге 2026-05-21. Каждое — с обоснованием. Все sub-TZ обязаны следовать этим решениям; пересмотр — только через явное обновление зонтичного.

### 3.1. Двухслойная модель знания (эволюция, не замена)

**Решение.** `IdeaBlock` + `Entity` + `IdeaBlockEvidence` + `IdeaBlockLink` + `EntityLink` + `Theme` остаются как **универсальный фундамент** (Слой атомов). Специалисты Слоя 3 — это **проекции атомов в типизированные карточки** (Слой карточек), не альтернативная модель знания.

**Почему не радикальная замена:**
- Граф знаний работает только если узлы однотипны. Полиморфные модели рушат единый BFS-обход «как X связан с Y через Z».
- AI-чат и темы работают поверх **единого индекса**. UNION ALL по 13 таблицам не масштабируется.
- Каждый новый тип знания через год = новый воркер-проектор, не миграция таблицы.

**Контракт перехода между слоями:**
- Слой 1 пишет в `IdeaBlock` (как сейчас).
- Слой 3 читает блоки своего типа + создаёт/обновляет типизированную карточку.
- Карточка обязана хранить `sourceBlockIds[]` или join-таблицу — иначе провенанс рвётся.
- Human-in-the-loop (Слой 4) работает **на уровне карточки**, не блока.

### 3.2. Онтология — три категории классов

**Решение.** 13 классов из [company-ontology.md](../../second-brain/06_marketing/company-ontology.md) разделяются на три категории:

| Категория | Где живёт | Из 13 классов |
|---|---|---|
| **A. Первичные сущности** (существуют независимо от извлечения) | модель + `Entity(type=…)` через `<Model>.entityId` | Person, Customer, Vendor, Project, Product, Document, Goal, Event |
| **B. Упоминаемые ярлыки** (без своей жизни) | только `Entity` | Topic, Location, Technology |
| **C. Извлекаемые карточки специалистов** (рождаются из текста, богатые атрибуты) | модели карточек Слоя 3 (+ `Entity(type=…)` при необходимости) | Decision, Process/Regulation, Risk, Metric |

**Применение.**
- `Entity.type` расширяется с 7 до 12 значений (см. §2.B).
- `custom` убирается как escape-hatch.
- Каркас 5 уровней из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md) (Mission/Vision/Strategy/Process/Regulation/Policy/Tool/Metric/Decision) **поглощается** карточками Слоя 3 — это они и есть, не параллельная система. Фаза 0b остаётся источником для PDF-extraction.
- Каждая модель категории A получает поле `entityId` (паттерн из [`Card.entityId`](../../backend/prisma/schema.prisma) Фазы 4).

### 3.3. Фазовая раскатка α / β / γ — по архитектурной устойчивости, не по сложности

**Решение.** Раскатка определяется зависимостями между слоями, не «что быстрее». Каждая фаза заканчивается работающим AI-чатом + Слоем 4 по своим картам + событиями в Слой 6.

**α — устойчивый двигатель.**
- Расширение Слоя 1 (`signalType`).
- Расширение Слоя 2 (онтология + новые модели категории A).
- Слой 4 базовый (curation foundation).
- Слой 5 базовый (chat-v2 omnichannel).
- Слой 3 — 3.4 (Project/Customer Context — эталонный референс) + 3.1 (Regulations — первая видимая ценность).
- ConversationalModule с in_app + email.

**β — социальные специалисты + замыкание петли.**
- Слой 3 — 3.2 (Knowledge Clone) + 3.3 (Decisions) + 3.5 (Insights) + **(3.6 ∧ Слой 6 полный)** парой.
- ConversationalModule расширение — Telegram + MAX.

**γ — мышление.**
- Слой 3 — 3.7 (SkillProfile + Executable Persona + Clone API + try-my-clone UI).

**Жёсткие правила фаз.**
- **Запрет на выпуск 3.6 без Слоя 6** — кладбище идей убивает доверие.
- **Запрет на выпуск 3.7 без интерфейса «попробовать своего клона»** для носителя — окно прозрачности обязательно.
- **Каждый специалист с момента запуска** подключён к Слою 4 (через triage) и Слою 6 (через `probe-event`).

### 3.4. Skill-профиль — рабочий артефакт компании, не персональное владение

**Решение.** Skill — исполняемая спецификация рабочего поведения роли в компании, по аналогии с Claude skills. Это инструмент компании, не персональные данные.

**Главный источник.** Блоки с `IdeaBlockEntity.role='subject'` и `signalType='reasoning'/'rationale'/'decision_basis'`. Главное — **обоснования**, которые сотрудник даёт.

**Жёсткие правила.**
- Категории traits **эмерджентные**, агент сам формирует, не предзаданный enum.
- Минимум N=5 наблюдений одной логики рассуждения.
- Источники **только** subject-role. «Маша про Ивана» = trait Маши, не Ивана.
- Гипотезные формулировки («похоже, склонен к…»), не приговорные.
- **Никакого onboarding, opt-in, прав скрытия от руководителя.**
- Видимость: owner / admin / direct manager. Носитель видит **факт существования** своего клона + кнопку «попробовать его» (прозрачность через инструмент).
- Только для `Person.relationship='employee'`. Внешние участники — только Слой 3.2 (факты).

**Иерархия трёх уровней.**
```
Role (нормативная должность)            ← Фаза 0
  → RoleProfile (наблюдаемая карта)     ← Фаза 0d, RoleProfileAgent
    → SkillProfile (поведение носителя) ← γ, Слой 3.7
      → ExecutablePersona (исполняемая) ← γ, версионированный snapshot
```

**Клон-агент.** API `POST /api/v1/clones/persons/:id/ask` и `POST /api/v1/clones/roles/:id/ask`. Берёт активную `ExecutablePersona` + subgraph носителя + вопрос → отвечает в стиле носителя с цитированием.

**При уходе носителя.** Skill переходит в `archived`, остаётся доступен как наследие компании. Новый носитель формирует свой поверх той же роли.

### 3.5. Conversational Channels — двунаправленные, pluggable, омниканальные

**Решение.** Channel — двунаправленная абстракция «канал общения с человеком». Не «notification system», а **conversational layer для всей памяти компании**. AI-чат, probe, ingest заметок, статусы — всё работает через один и тот же набор каналов одинаково.

**Принципы.**
- `Channel` поддерживает три типа сообщений в каждом направлении (см. §2.G).
- InApp — равноправный канал, **не «UI»**. Веб-UI ЛК — рендерер канала `in_app`.
- Channels — pluggable. Добавление нового канала = новый адаптер интерфейса `IChannel`, без правки Слоёв 3/5/6.
- Каждый ответ через канал → новый `RawEvent` через универсальный ingest. Симметрия inbound — критична.
- `dataClass`-фильтр на канал. Чувствительные probe не уходят во внешние каналы.
- Каждый user имеет несколько `ChannelBinding` с per-channel `preferences` (quiet hours, rate limits, типы событий).

**Раскатка каналов.**
- α: `in_app`, `email_smtp`, `email_imap` (опц.)
- β: `telegram_bot`, `max_bot`
- γ+: `slack`, `mattermost`, `vk_messenger`, `whatsapp_business`, `web_push`, `voice_via_asr`

**Продуктовое следствие.** Z перестаёт быть «веб-приложением с нотификациями» и становится **omnichannel-ассистентом памяти компании**. Кора живёт там, где сотрудник уже работает.

### 3.6. Curation (Слой 4) — triage, per-domain кураторы, multi-touch, conflict first-class

**Решение.** Layer 4 — это не «один admin одобряет всё». Это система с triage'ем, гибким назначением кураторов и интеграцией в conversational layer.

**Triage (три уровня).**

| Уровень | Условие | Действие |
|---|---|---|
| auto-canonical | `confidence ≥ 0.85`, нет conflict-сигналов, тип не в critical-list | канонизация без ревью + аудит |
| light review | `confidence 0.6–0.85` ИЛИ мягкий конфликт | probe куратору, одна кнопка approve/reject/edit |
| deep review | `confidence < 0.6` ИЛИ сильный конфликт ИЛИ critical-type | полная цепочка провенанса, обязательный reasoning |

Пороги — настраиваемые per-org через `/settings/curation`. Critical-list — по умолчанию Regulation, Process, Decision.

**Curator per-domain.** `CuratorAssignment(tenantId, resourceType, criteria, curatorUserIds[])` — гибкое назначение через `/settings/curation`. Дефолт = owner/admin.

**Multi-touch UI.**
1. `/curation` — центральная очередь с фильтрами и batch-actions.
2. Inline-виджет на странице карточки.
3. Conversational probe через все каналы.
4. Dashboard-виджет «N pending».

**Conflict — first-class.** `ConflictItem` создаётся автоматически из `relationType='contradicts'` или при конкуренции карточек. Resolution-типы:
- `accept_new` — старое архивируется
- `keep_old` — новое отклоняется
- `merge` — объединение
- `evolving` — **обязательная категория**: старое было правдой до даты X, новое — после. Обе версии остаются с временными диапазонами. Без этого AI-чат теряет temporal-память.

**Stale-detection.** Cron-based: `lastConfirmedAt > 6 мес` + упавший `dynamicScore` → probe владельцу через channels. Без ответа за 30 дней → `stale`. Активное противоречие свежим блокам → `superseded`.

**Skill — особый case.** Без pre-approval. Manager получает дайджест свежих traits, может `mark_as_misleading`. Misleading traits архивируются + фиксируются как сигнал для тюна промпта.

**Версионность.** Каждая правка → новый `CardVersion` с авторством. AI-чат всегда читает current.

### 3.7. LLM provider routing — трёхуровневая подстраховка + admin-переключение per-agent

**Решение.** Каждый агент (= taskType) обязан иметь **минимум три уровня провайдеров** в цепочке, и они должны переключаться через админку без выкатки кода. Это снимает три класса инцидентов: ошибка/отказ модели, отсутствие связи с провайдером, потребность сравнить модели на реальном трафике.

**Трёхуровневая цепочка (обязательная для каждого taskType).**

| Уровень | Назначение | Пример |
|---|---|---|
| **Primary (рабочий)** | Основной провайдер по выбору владельца — лучшее качество/цена по результатам тестов из [llm-models-playbook.md](../../llm-models-playbook.md) | DeepSeek V4-flash через `proxy.agent-lia.ru` |
| **Secondary (если что-то пошло не так)** | Другой провайдер той же категории качества — переключается при ошибке/таймауте primary | gpt-5.4-mini через OpenAI proxy |
| **Tertiary (когда связи нет)** | Local fallback — работает без внешней связи, гарантирует, что агент не падает совсем | Ollama qwen3:30b на нашем GPU-сервере |

**Источник выбора провайдеров.** Файл [`llm-models-playbook.md`](../../llm-models-playbook.md) в корне репозитория — карта моделей, ENV, шаблоны вызова, цены, методология бенчмарка. Любое добавление/замена провайдера в `LlmTaskRoute` — со ссылкой на playbook-результаты.

**Z-Admin UI для управления цепочкой per-agent.** Расширение существующих `admin-functions/admin-experiments/admin-prices` controllers (Phase 7):
- Страница `/admin/ai-models` — для каждого taskType (= каждого агента) видна цепочка `primary → secondary → tertiary`.
- Кнопка «переключить primary» — выбор из доступных provider'ов того же `maxDataClass`.
- A/B-тестирование per-agent: на N% трафика — другой primary; сравнение метрик side-by-side.
- Метрики per-agent: cost (₽ per 1k вызовов), latency (p50/p95/p99), success rate, conflict rate (если применимо), quality proxy (например, % auto-canonical от Слоя 4).
- История переключений с авторством (audit log).
- Ссылка на playbook-результаты для каждого provider'а в цепочке.

**Автоматическое поведение `LlmRouterService.call()`.**
- Запрос идёт в primary.
- При ошибке/timeout/rate-limit → fallback на secondary (логируется в `AiUsageLog.fallbackUsed=true`).
- При ошибке/недоступности secondary → fallback на tertiary.
- Если все три недоступны → `NoEligibleProviderError` + метрика `core_llm_no_provider_total{taskType}` + блок (специалист помечает блок как `processingStatus='llm_unavailable'`, retry через час).

**Применение.**
- Каждый sub-TZ при создании нового taskType **обязан** включать seed/patch скрипт `seed-llm-task-routes-<feature>.ts` с тремя provider'ами (по [skill `safe-seed-rules`](../../.claude/skills/safe-seed-rules)).
- Каждый seed-script ссылается на playbook-результаты в комментарии (какие модели тестировались, почему выбрана такая цепочка).
- Расширение `LlmTaskRoute` модели полем `tier` (`primary` | `secondary` | `tertiary`) + `priority` для порядка (если в одном tier несколько).
- Расширение `AiUsageLog` — `tier` использованного provider'а (для аналитики «сколько % запросов ушло в fallback»).

**Связь с другими решениями.**
- §3.1 (Двухслойная модель) — не меняет: специалист пишет в карточку независимо от того, какой provider ответил.
- §3.4 (Skill) — особо чувствителен к качеству LLM: трёхуровневая цепочка + A/B-тестирование критичны для тюна skill-detection.
- §3.5 (Channels) — chat-v2 омниканальный использует тот же LlmRouter; user видит ответ одинаково через любой канал, независимо от того, какой provider был задействован.
- §3.6 (Curation) — `% auto-canonical` per-agent — это качественная метрика провайдера. Падение этого числа после переключения primary = сигнал к откату.

---

## 4. Карта 6 слоёв × 12 агентов

```
   СЫРЬЁ
   (встречи, чек-ины, чаты, документы, заметки через каналы, ответы на probe)
        ↓
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 1 — Разметка                                                     │
│ • block-ingest.worker (расширенный signalType)                        │
│ • reasoning-extractor (новая подтипизация)                            │
│ Производит: IdeaBlock с signalType + Evidence + confidence            │
└───────────────────────────────────────────────────────────────────────┘
        ↓
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 2 — Маршрутизатор и сущности                                     │
│ • entity-resolver.worker/cron (расширенный на новые типы)             │
│ • RouterService (новый — диспатчинг к специалистам Слоя 3)            │
│ Производит: Entity (12 типов), привязка к моделям категории A         │
└───────────────────────────────────────────────────────────────────────┘
        ↓
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 3 — Специалисты (7 агентов)                                      │
│ ┌──────────────────────┬──────────────────────────────┬─────────────┐ │
│ │ 3.1 Regulations      │ Regulation/Process/Policy     │ α           │ │
│ │ 3.2 Knowledge Clone  │ Person facts/expertise        │ β           │ │
│ │ 3.3 Decisions        │ Decision registry             │ β           │ │
│ │ 3.4 Project/Customer │ Card rollup (эталонный реф.)  │ α           │ │
│ │ 3.5 Insights         │ Insight (повторяющ. проблемы) │ β           │ │
│ │ 3.6 Ideas Collector  │ Idea + clusters               │ β (с Сл.6)  │ │
│ │ 3.7 SkillProfile     │ Skill + ExecutablePersona     │ γ           │ │
│ └──────────────────────┴──────────────────────────────┴─────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
        ↓                                                       ↑
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 4 — Контроль качества                                            │
│ • Triage (auto / light / deep)                                        │
│ • CurationItem + CurationDecision + ConflictItem + CardVersion        │
│ • Stale-detection cron                                                │
│ • Skill — post-hoc mark_as_misleading                                 │
│ Multi-touch UI: /curation + inline + channels + dashboard             │
└───────────────────────────────────────────────────────────────────────┘
        ↓                                                       ↑
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 5 — Ответы                                                       │
│ • Chat-v2 (omnichannel) — заменяет chunk-RAG                          │
│ • Уровни: factual / synthetic / clone-style                           │
│ • Provenance через IdeaBlockEvidence                                  │
└───────────────────────────────────────────────────────────────────────┘
        ↑
┌───────────────────────────────────────────────────────────────────────┐
│ Слой 6 — Активный уточнитель                                          │
│ • Probe-Agent — читает probe-events от специалистов                   │
│ • Анти-спам + приоритизация + выбор адресата                          │
│ • Отправка через ConversationalModule (любой канал)                   │
│ Ответ → новый RawEvent → возвращается в Слой 1                        │
└───────────────────────────────────────────────────────────────────────┘
        ↕↕↕
┌───────────────────────────────────────────────────────────────────────┐
│ Conversational Channels (Inbound + Outbound — поверх всех слоёв)      │
│ in_app | email_smtp | email_imap (α) | telegram_bot | max_bot (β)     │
│ + pluggable: slack | mattermost | vk_messenger | whatsapp | web_push  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 5. Контракт специалиста (сквозной для Слоя 3)

Каждый из 7 агентов Слоя 3 **обязан** реализовать единый контракт. Нарушение контракта — блокер выпуска специалиста. Контракт детализируется в sub-TZ каждого специалиста, но фиксируется здесь как источник правды.

**5.1. Чтение источника.**
- Специалист подписан на конкретные `signalType` блоков (через очередь BullMQ).
- Может опционально подписываться на типы карточек других специалистов (например, 3.5 Insights читает Decision-карточки 3.3).
- Никогда не читает сырьё (`RawEvent`) напрямую — только через `IdeaBlock`.

**5.2. Карточка специалиста.**
- Своя Prisma-модель ИЛИ расширение `Card.kind`.
- Обязательные поля: `tenantId`, `entityId?` (привязка к узлу графа), `sourceBlockIds[]`, `confidence Decimal(4,3)`, `status (draft|canonical|archived|superseded)`, `version`, `createdAt`, `updatedAt`.
- Богатые атрибуты — типизированные поля модели, не `Json` сваливание.

**5.3. Triage перед канонизацией.**
- Любая новая/изменённая карточка проходит через `CurationService.triage(card)`.
- Triage возвращает: auto-canonical / pending light / pending deep.
- Карточка не становится `canonical` до завершения triage'а (или сразу — если auto).

**5.4. Probe-events в Слой 6.**
- При обнаружении пробела (нет автора решения, неясен owner процесса, пропущена дата) → `ProbeService.suggest({ type, recipientCandidates, payload, contextBlockId })`.
- Probe-Agent (Слой 6) решает, отправлять ли, кому, через какой канал.
- Специалист не выбирает канал сам.

**5.5. Conflict-events.**
- При обнаружении противоречия с существующей карточкой → `ConflictService.report({ existingCardId, newCardId, evidence, relationType })`.
- Слой 4 создаёт `ConflictItem` и эскалирует куратору.

**5.6. Поддержка chat-v2.**
- Каждая карточка должна быть индексируемой для chat-v2 (поле `searchableText` или generated column).
- Каждая карточка отдаёт цитаты через `getCitations(blockIds)` (унифицированный интерфейс).

**5.7. Метрики.**
- Каждый специалист обязан репортить в `BusinessMetricsService`:
  - `core_specialist_cards_total{type, status}` (gauge)
  - `core_specialist_pipeline_duration_seconds{type}` (histogram)
  - `core_specialist_llm_tokens_total{type, model}` (counter)
  - `core_specialist_probe_events_total{type, reason}` (counter)
  - `core_specialist_conflict_events_total{type}` (counter)

**5.8. RBAC.**
- Каждая модель карточки регистрируется в `RbacService.ResourceType`.
- Дефолтные права: read — все member'ы Org, write/delete — owner/admin (+ curator role, если назначена).

**5.9. Idempotency.**
- Воркер специалиста должен быть идемпотентен по `IdeaBlock.id` (jobId паттерн `<specialistName>_<blockId>`).
- Дебаунс — настраиваемый per-specialist (рекомендуется 30–60s).

**5.10. Контракт «специалист для skill».**
- Карточки специалиста, у которых в `sourceBlockIds[]` есть блок с `IdeaBlockEntity.role='subject'` для конкретного Person, должны проставлять `personSubjectIds[]` — для последующей сборки SkillProfile (γ).

**5.11. LLM-провайдеры — трёхуровневая цепочка обязательна (§3.7).**
- Каждый новый `LlmTaskType` регистрируется через seed-script `seed-llm-task-routes-<feature>.ts` с **тремя** provider'ами: primary (рабочий) + secondary (если что-то пошло не так) + tertiary (когда связи нет, local fallback).
- Выбор каждого provider'а в цепочке обосновывается ссылкой на [llm-models-playbook.md](../../llm-models-playbook.md) в комментарии seed-script'а — какие модели тестировались, по каким метрикам выбрана данная.
- Все три provider'а должны проходить фильтр по `maxDataClass` для каждого taskType (если task оперирует `confidential` данными — все три уровня тоже не ниже `confidential`).
- Tertiary — обязательно local (Ollama), даёт гарантию работы агента при полном отказе внешних провайдеров.
- В Z-Admin `/admin/ai-models` цепочка переключается без выкатки кода (см. §3.7 «admin-UI»).

---

## 6. Карта 13 sub-TZ

### Фаза α — устойчивый двигатель (7 sub-TZ)

#### α-1. Conversational Channels Foundation

**Файл:** `plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md`

**Scope:**
- `ConversationalModule` как `@Global` модуль в `backend/src/modules/conversational/`.
- Модели: `Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery`.
- Интерфейс `IChannel` (send + ingest + parseResponse).
- Адаптеры `InAppChannelAdapter`, `EmailSmtpChannelAdapter`, `EmailImapChannelAdapter` (опц.).
- Routing-слой: per-user preferences + per-event-type policy + dataClass-фильтр.
- Universal linking flow (генерация кода в ЛК, верификация в боте).
- `NotificationDelivery` lifecycle: queued → sent → delivered → read → responded.
- API: `GET /api/v1/me/notifications`, `POST /api/v1/me/notifications/:id/respond`, `GET/PATCH /api/v1/me/channel-preferences`, `GET /api/v1/me/channels`, `POST /api/v1/me/channels/:kind/link-code`.
- UI: страница `/me/channels` (привязка), `/me/notifications` (центр уведомлений).

**Входы:** существующие модели `User`, `Org`; SMTP-инфра из [accounts](../../second-brain/01_projects/auth-and-accounts.md).

**Выходы (контракт для других sub-TZ):**
- `ConversationalService.sendNotification(event)`
- `ConversationalService.subscribeInbound(handler)` (для специалистов 5/6)
- События `notification.responded` — для Слоя 6
- События `inbound.ingested` — новый `RawEvent` через ingest

#### α-2. Layer 1 — Marking Extension

**Файл:** `plans/tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md`

**Scope:**
- Расширение enum `IdeaBlock.signalType` — добавление `reasoning`, `rationale`, `decision_basis`, `regulation`, `process_step`. Patch-script для существующих блоков (опц. бэкфил).
- Расширение `BlockExtractionService` — JSON Schema strict обновляется, prompt template (placeholder) учитывает новые типы.
- Reasoning-подтипизация — отдельные правила распознавания в prompt (когда фраза содержит «потому что», «я учёл», «trade-off», «выбрал X над Y»).
- LlmTaskType: `block-ingest` обновляется; опционально новый `reasoning-detect` для второго прохода.

**Входы:** существующий `BlockExtractionService`, `LlmRouterService`.

**Выходы:** `IdeaBlock`-и с расширенным `signalType`. Контракт для Слоёв 2 и 3.

#### α-3. Layer 2 — Ontology Extension

**Файл:** `plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md`

**Scope:**
- Расширение enum `Entity.type` до 12 значений + удаление `custom`.
- Patch-script: rename `client → customer` (миграция данных через `bun run` patch).
- Новые модели категории A: `Vendor`, `Event` (с `entityId` для связки в графе).
- Расширение существующих моделей категории A полем `entityId`: `Person` (в [persons module](../../backend/src/modules/persons/)), `Goal`, `Document`, `Product` (если есть), `Card` (уже имеет с Фазы 4).
- Расширение `EntityResolutionService` на новые типы (доменные правила дедупа).
- `RouterService` — диспатчер атомов к специалистам Слоя 3 на основе `signalType` + контекста. BullMQ-очередь `core.specialist-routing`.
- Применение `postgres-init.sql` (HNSW индексы для embedding'ов новых типов через generic-pattern).

**Входы:** существующие knowledge-core модели; решение §3.2.

**Выходы:**
- Полная онтология категорий A/B/C доступна.
- `RouterService.dispatch(block)` — контракт для специалистов.

#### α-4. Layer 4 — Curation Foundation

**Файл:** `plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md`

**Scope:**
- Модели: `CurationItem`, `CurationDecision` (typed audit log), `ConflictItem`, `CardVersion`, `CuratorAssignment`.
- `CurationService.triage(card)` — три уровня по порогам из org-config.
- `CuratorRoutingService` — выбор куратора по `CuratorAssignment`.
- Conflict resolution с типами `accept_new` / `keep_old` / `merge` / `evolving`.
- Stale-detection cron + dynamicScore decay (расширение существующего [reframing.cron](../../backend/src/modules/knowledge-core/workers/reframing.cron.ts)).
- API: `GET /api/v1/curation/queue`, `POST /api/v1/curation/items/:id/decide`, `GET /api/v1/curation/conflicts`, `POST /api/v1/curation/conflicts/:id/resolve`, `GET/PATCH /api/v1/settings/curation`.
- UI: страница `/curation` (master-detail), inline-виджет `<CurationBanner>` для встраивания на странице любой карточки, dashboard-виджет «N pending».
- Интеграция с ConversationalModule — probe-нотификации куратору через channels (light review).
- Расширение `BusinessMetricsService`: `curation_*` метрики.
- Расширение RBAC: `curation_item`, `conflict_item`, `card_version` ResourceType.

**Входы:** ConversationalModule из α-1; решение §3.6.

**Выходы:**
- `CurationService.triage()` — контракт для специалистов Слоя 3.
- UI и API для кураторской работы.

#### α-5. Layer 5 — Chat-v2 Omnichannel

**Файл:** `plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md`

**Scope:**
- Новый модуль `chat-v2/` в `backend/src/modules/chat-v2/` (старый chat живёт параллельно до полной миграции).
- `ChatV2Service` поверх knowledge-core: гибридный поиск (cosine + BM25) + графовый обход + чтение карточек специалистов.
- Три уровня ответа: `factual` (с цитатой), `synthetic` (свод с маркировкой неуверенности), `clone-style` (от имени носителя — задел под γ).
- Provenance через `IdeaBlockEvidence` — обязательно.
- `org-scope` поиск (tenantId изоляция) + `personal-scope` (свой клон — задел под γ).
- API: `POST /api/v1/chat-v2/messages`, `GET /api/v1/chat-v2/conversations/:id`.
- Omnichannel: ChatV2 регистрируется как handler `subscribeInbound('chat-query')` в ConversationalModule. Inbound `/ask <вопрос>` в Telegram/MAX/Email → routed в ChatV2 → ответ через тот же канал.
- UI: страница `/chat` (master-detail conversations), встроенный виджет `<ChatPanel>` для других страниц.
- Deprecation plan: `MeetingTranscriptChunk` chunk-RAG → старый chat помечен `@deprecated`, миграция в Фазе β/γ по факту стабильности chat-v2.
- LlmTaskType: `chat-v2-synthesize`, `chat-v2-cite-select`.

**Входы:** knowledge-core (текущий), ConversationalModule из α-1, расширения категории A из α-3.

**Выходы:** AI-чат компании доступен через все каналы.

#### α-6. Specialist 3.4 — Project/Customer Context

**Файл:** `plans/tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md`

**Scope:**
- Развитие существующего [card-rollup-v2.worker](../../backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts) до полного контракта специалиста (§5).
- Расширение `Card.kind` под `vendor` (новая категория A).
- Подключение к `CurationService.triage()` для новых rollup'ов.
- Эмиссия probe-events: «у Customer X нет account_manager», «у Project Y нет deadline», «два проекта похожи — merge?».
- Эмиссия conflict-events: «Card X говорит «закрыт», но свежие блоки говорят «активный»».
- Поддержка `chat-v2.getCitations()`.
- Метрики через `BusinessMetricsService`.

**Особый статус.** Этот специалист — **эталонный референс**. Все остальные специалисты Слоя 3 строятся по его паттерну. Sub-TZ детализирует «как должен выглядеть специалист» в общем виде, не только частный случай Card.

**Входы:** card-rollup-v2 (текущий), α-3 (расширения категории A), α-4 (Curation), §5 (контракт).

**Выходы:** работающий 3.4 + reference-имплементация для остальных специалистов.

#### α-7. Specialist 3.1 — Regulations

**Файл:** `plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md`

**Scope:**
- Новая модель `Regulation(id, tenantId, kind ['regulation'|'process'|'policy'|'standard'], title, statement Text, ownerEntityId?, scope, status, currentVersion → CardVersion, sourceBlockIds[], personSubjectIds[], confidence, entityId?, …)` ИЛИ расширение карточек категории C из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md) — решается в начале sub-TZ.
- Воркер `regulation-detector.worker` — consumer `core.specialist-routing` для `signalType='regulation'/'process_step'`.
- Дедупликация регламентов: один регламент = одна каноническая карточка с версиями.
- Извлечение шагов процесса (для `kind='process'`) как структурированных полей.
- Подключение к ConversationalModule — `mark_for_owner_review` через Слой 4.
- Probe-events: «новый процесс упомянут, кто owner?», «регламент X устарел — подтвердить?» (stale-detection per regulation).
- Conflict-events: «регламент X противоречит регламенту Y по шагу N».
- Поглощение каркаса 5 уровней из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md) — миграция данных, если они есть.
- API: `GET /api/v1/regulations`, `GET /api/v1/regulations/:id`, `GET /api/v1/regulations/:id/history`, `POST /api/v1/regulations/:id/supersede`.
- UI: страница `/regulations` (master-detail с фильтрами по kind/owner/scope).
- RBAC: `regulation` ResourceType, write/delete — owner/admin + curator(operations).
- LlmTaskType: `regulation-extract`, `regulation-dedupe`, `process-steps-extract`.

**Входы:** α-2 (новые signalType), α-3 (онтология), α-4 (curation), §5 (контракт), [Фаза 0b](2026-05-21-phase-0b-document-ingest.md).

**Выходы:** работающий специалист 3.1 + первая видимая ценность «регламенты появились сами».

---

### Фаза β — социальные специалисты + замыкание петли (5 sub-TZ)

#### β-1. Channels — Telegram + MAX Adapters

**Файл:** `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md`

**Scope:**
- `TelegramBotChannelAdapter` (outbound + inbound через webhook). Переиспользование инфры из существующего inbound-адаптера [backend/src/modules/ingest/adapters/telegram](../../backend/src/modules/ingest/adapters/telegram).
- `MaxBotChannelAdapter` (outbound + inbound). API MAX (mssgr.ru) — проверка через context7 на момент реализации.
- Inline-кнопки, диалоговые формы, slash-commands (`/ask`, `/note`, `/idea`, `/status`, `/myideas`, `/link`).
- Routing inbound: thread context > slash command > default heuristic.
- Bot setup automation: `bun run scripts/setup-telegram-bot.ts`, аналогично MAX.
- Bot tokens — через `TypedConfigService`, в `env.schema.ts`.
- Linking — переиспользует universal linking из α-1.
- ChatV2 → ответы через любой канал автоматически (никаких правок в ChatV2).

**Входы:** α-1 (ConversationalModule + IChannel интерфейс), α-5 (ChatV2 как handler).

**Выходы:** все probe Слоя 6 и AI-чат Слоя 5 доступны через Telegram + MAX.

#### β-2. Specialist 3.2 — Knowledge Clone

**Файл:** `plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md`

**Scope:**
- Расширение `Person` модели полями: `knowledgeProfile Json?` (структурированный кеш «что знает / опыт / типовые ответы»), `lastProfileBuildAt`, `profileBuildVersion`.
- Воркер `knowledge-clone.worker` — consumer `core.specialist-routing` для `signalType='expertise'/'fact'/'experience'`.
- Cron `knowledge-clone-rebuild.cron` — раз в N часов перестройка профиля при изменениях.
- Категории фактов профиля: эмерджентные (как в 3.7, но для «что знает», не «как думает»).
- Probe-events: «обнаружен новый опыт Person X в области Y — подтвердить?».
- API: `GET /api/v1/persons/:id/knowledge-profile`, `GET /api/v1/me/knowledge-profile`.
- UI: расширение страницы Person (`/persons/:id`) разделом «Профиль знаний» (read-only preview). Виджет «мой клон» на `/me`.
- RBAC: `knowledge_profile` ResourceType. Read — все member'ы Org (это shared knowledge внутри Org). Без управления.
- LlmTaskType: `knowledge-clone-extract`, `knowledge-clone-merge`.

**Особенность.** Этот специалист — **подготовка к 3.7 (γ)**. SkillProfile надстраивается над `Person.knowledgeProfile` + reasoning-блоки.

**Входы:** α-2 (signalType), α-3 (Person.entityId), α-4 (Curation), §5 (контракт), [Фаза 0d RoleProfileAgent](2026-05-21-phase-0d-role-profile-agent.md) (паттерн воркера).

**Выходы:** работающий специалист 3.2 + готовая инфраструктура для 3.7.

#### β-3. Specialist 3.3 — Decisions Registry

**Файл:** `plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md`

**Scope:**
- Новая модель `Decision(id, tenantId, entityId?, statement Text, rationale Text?, alternatives Json?, decidedByPersonIds[], decidedAt?, deadline?, status ['proposed'|'approved'|'rejected'|'superseded'|'implemented'], supersedesId? → Decision, affectsEntityIds[], sourceBlockIds[], personSubjectIds[], confidence, currentVersion → CardVersion, …)`.
- Воркер `decision-detector.worker` — consumer `core.specialist-routing` для `signalType='decision'/'rationale'/'decision_basis'`.
- Дедуп: «новое решение» vs «развитие старого» через KNN cosine + LLM-арбитр.
- Probe-events: «решение принято, но нет ответственного», «прошёл срок исполнения, статус?», «нашёл два конкурирующих решения — какое финальное?».
- Conflict-events: `supersedes` цепочки + `evolving` для решений, меняющихся во времени.
- API: `GET /api/v1/decisions`, `GET /api/v1/decisions/:id`, `POST /api/v1/decisions/:id/supersede`.
- UI: страница `/decisions` (master-detail с фильтрами по статусу/автору/affects).
- RBAC: `decision` ResourceType.
- LlmTaskType: `decision-extract`, `decision-supersede-detect`.

**Входы:** α-2/α-3/α-4, §5.

**Выходы:** работающий реестр решений + интеграция с 3.5 (Insights видит «какие решения вызвали проблемы»).

#### β-4. Specialist 3.5 — Insights Radar

**Файл:** `plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md`

**Scope:**
- Новая модель `Insight(id, tenantId, kind ['problem'|'risk'|'blocker'|'inefficiency'], statement Text, severity, frequencyScore, dynamicScore, affectedEntityIds[], firstObservedAt, lastObservedAt, relatedDecisionIds[], sourceBlockIds[], status ['active'|'mitigated'|'archived'], …)`.
- Воркер `insight-detector.worker` — consumer `core.specialist-routing` для `signalType='problem'/'risk'/'blocker'`.
- Кластеризация повторяющихся проблем через embedding cosine (порог `INSIGHT_CLUSTER_THRESHOLD`).
- Связывание с Decisions: «эта проблема следует из решения X» (через `IdeaBlockLink relationType='consequences_of'`).
- Probe-events: «проблема Y повторилась N раз за неделю — эскалировать?».
- API: `GET /api/v1/insights`, `GET /api/v1/insights/:id`, `POST /api/v1/insights/:id/mitigate`.
- UI: дашборд `/insights` с динамикой (chart по времени) + master-detail.
- Расширение [Director Dashboard](2026-05-10-phase-8-director-dashboard.md) — виджет «Топ-5 повторяющихся проблем».
- RBAC: `insight` ResourceType.
- LlmTaskType: `insight-extract`, `insight-cluster-merge`.

**Входы:** α-2/α-3/α-4, β-3 (Decisions для связки), §5.

**Выходы:** работающий радар + виджет в дашборде директора.

#### β-5. Specialist 3.6 — Ideas Collector + Layer 6 — Probe Agent

**Файл:** `plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md`

**Особое правило.** Эти два компонента **неразделимы** — выпускаются одним sub-TZ. Без Слоя 6 идеи превращаются в кладбище, без идей Слой 6 не имеет первой видимой ценности.

**Scope (Ideas, 3.6):**
- Новая модель `Idea(id, tenantId, kind ['internal'|'client-request'], statement Text, weight Decimal, supporterCount, supporters PersonOrCustomerIds[], firstProposedAt, status ['captured'|'in-discussion'|'accepted'|'in-progress'|'shipped'|'rejected'|'archived'], statusChangedAt, statusChangedBy, sourceBlockIds[], clusterId?, …)`.
- `IdeaCluster` — смысловые кластеры (переиспользование паттерна Theme).
- Воркер `idea-detector.worker` — consumer `core.specialist-routing` для `signalType='idea'/'suggestion'/'client-request'`.
- Cron `idea-clusterer.cron` — кластеризация (порог `IDEA_CLUSTER_THRESHOLD`).
- API: `GET /api/v1/ideas`, `GET /api/v1/me/ideas` (мои), `POST /api/v1/ideas/:id/status`, `GET /api/v1/idea-clusters`.
- UI: страница `/ideas` (master-detail + фильтры), персональная вкладка «мои идеи» с текущим статусом.

**Scope (Probe-Agent, Слой 6):**
- Новый модуль `probe/` в `backend/src/modules/probe/`.
- `ProbeService.suggest(probeEvent)` — контракт для специалистов.
- `probe-dispatcher.worker` — consumer `core.probe-events`. Логика:
  - Дедуп (не задавать тот же вопрос дважды).
  - Анти-спам (rate limits per-user через Redis).
  - Quiet hours (читает из `User.notification_preferences`).
  - Приоритизация по `severity` + `freshness` + `recipient_engagement_rate`.
  - Выбор адресата (если несколько candidates).
- Отправка через `ConversationalService.sendNotification(probe)` — канал выбирается роутером.
- Status: queued → sent → delivered → responded → resolved.
- Обработка ответа: `notification.responded` event → новый `RawEvent` с `respondsToNotificationId` → ingest → пайплайн знаний (специалист видит ответ через свежий блок).
- Closing loop для Ideas: при изменении `Idea.status` — авто-нотификация авторам через ConversationalService.
- API: `GET /api/v1/probe/queue` (admin), `GET /api/v1/me/probe-history`.
- UI: расширение `/me/notifications` — фильтр «probe».
- Метрики: `probe_sent_total`, `probe_response_rate`, `probe_response_time_seconds`, `probe_idle_total{user}`.

**Входы:** все α-фазы (особенно α-1 ConversationalModule), §5 (контракт specialist предоставляет probe-events).

**Выходы:** замкнутая петля самообучения + работающий 3.6.

---

### Фаза γ — мышление (1 sub-TZ)

#### γ-1. Specialist 3.7 — SkillProfile + Executable Persona + Clone API

**Файл:** `plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md`

**Scope:**
- Новая модель `SkillProfile(id, tenantId, personId → Person, status ['active'|'archived'], lastBuildAt, …)` — 1:1 с Person.
- Модель `SkillTrait(id, profileId, category Text [эмерджентная], statement Text, confidence ['low'|'medium'|'high'], observationCount, sourceBlockIds[], firstObservedAt, lastConfirmedAt, status ['active'|'superseded_by'|'archived'|'misleading'])`.
- Модель `ExecutablePersona(id, profileId, version, snapshotAt, personaPrompt Text, traitIds[], status ['active'|'superseded'])` — версионированный snapshot.
- Воркер `skill-trait-detector.worker` — consumer `core.specialist-routing` для блоков с `IdeaBlockEntity.role='subject'` + `signalType='reasoning'/'rationale'/'decision_basis'`. Минимум N=5 наблюдений.
- Эмерджентные категории — агент сам формирует, не enum.
- Cron `skill-profile-recalibrate.cron` — переоценка traits с учётом свежих данных, decay для давно не подтверждавшихся.
- Cron `executable-persona-build.cron` — раз в неделю snapshot активных traits в новую `ExecutablePersona.version`.
- API клона: `POST /api/v1/clones/persons/:personId/ask`, `POST /api/v1/clones/roles/:roleId/ask` (агрегат по роли).
- Манагерский дайджест: еженедельно через ConversationalModule — «новые черты в skill-профилях твоих подчинённых», кнопки `mark_as_misleading`.
- UI:
  - `/me/clone` — страница «попробовать своего клона» (диалоговая, как chat-v2 но с persona injection). **Обязательная** часть выпуска (§3.3 правило).
  - `/persons/:id/skill-profile` — manager-доступ (по RBAC).
  - `/roles/:id/skill-profile` — агрегат по роли.
- RBAC: `skill_profile`, `clone_persona` ResourceType. Read — owner/admin/direct manager. Носитель — read только `/me/clone` (диалог), не сам профиль.
- LlmTaskType: `skill-trait-detect`, `skill-trait-merge`, `executable-persona-compile`, `clone-respond`.
- Жизненный цикл: при `Person.relationship` смене с `employee` → SkillProfile.status = `archived`, persona snapshots остаются доступны.
- Skill только для `Person.relationship='employee'` — расширение `Person.relationship` enum в α-3 ИЛИ здесь.

**Входы:** β-2 (Person.knowledgeProfile), все β-фазы (богатые источники блоков), §5 (контракт).

**Выходы:** работающие клоны сотрудников + API запроса в их стиле.

---

## 7. Матрица прослеживаемости решений → sub-TZ

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| **A. Двухслойная модель знания (§3.1)** | | | | |
| A1 | `IdeaBlock` + граф + темы остаются как универсальный фундамент | §3.1 | (не изменяется) | [x] |
| A2 | Карточки специалистов хранят `sourceBlockIds[]` для провенанса | §3.1, §5.2 | все α-6/α-7, β-2/β-3/β-4/β-5, γ-1 | [ ] |
| A3 | Human-in-the-loop работает на уровне карточки, не блока | §3.1, §3.6 | α-4 | [ ] |
| **B. Онтология (§3.2)** | | | | |
| B1 | `Entity.type` enum расширен с 7 до 12 значений | §3.2 | α-3 | [ ] |
| B2 | Удаление `custom` из enum | §3.2 | α-3 | [ ] |
| B3 | Patch-script: `client → customer` rename | §3.2 | α-3 | [ ] |
| B4 | Новые модели категории A: `Vendor`, `Event` | §3.2 | α-3 | [ ] |
| B5 | `entityId` поле на всех моделях категории A | §3.2 | α-3 | [ ] |
| B6 | Поглощение каркаса 5 уровней из Фазы 0b в карточки Слоя 3 | §3.2 | α-7, β-3 | [ ] |
| **C. Фазовая раскатка (§3.3)** | | | | |
| C1 | α содержит расширения слоёв 1+2 + 4+5 базовые + 3.4 + 3.1 | §3.3 | α-1..α-7 | [ ] |
| C2 | β содержит 3.2 + 3.3 + 3.5 + (3.6 ∧ Слой 6) | §3.3 | β-1..β-5 | [ ] |
| C3 | γ содержит 3.7 + Clone API + try-my-clone UI | §3.3 | γ-1 | [ ] |
| C4 | Запрет на выпуск 3.6 без Слоя 6 | §3.3 | β-5 (один sub-TZ для обоих) | [ ] |
| C5 | Запрет на выпуск 3.7 без `/me/clone` | §3.3 | γ-1 | [ ] |
| C6 | Каждый специалист с момента запуска подключён к Слою 4 + Слою 6 | §3.3, §5 | все sub-TZ Слоя 3 | [ ] |
| **D. Skill-профиль (§3.4)** | | | | |
| D1 | Эмерджентные категории traits (не enum) | §3.4 | γ-1 | [ ] |
| D2 | Минимум N=5 наблюдений | §3.4 | γ-1 | [ ] |
| D3 | Источники только `IdeaBlockEntity.role='subject'` | §3.4 | γ-1 | [ ] |
| D4 | `signalType='reasoning'/'rationale'/'decision_basis'` как главный источник | §3.4 | α-2 (signalType), γ-1 (использование) | [ ] |
| D5 | Гипотезные формулировки в промпте | §3.4, §11 | γ-1 | [ ] |
| D6 | Видимость: owner/admin/direct manager. Носитель — только `/me/clone` | §3.4 | γ-1 | [ ] |
| D7 | Только для `Person.relationship='employee'` | §3.4 | α-3 или γ-1 (enum extension) | [ ] |
| D8 | Иерархия Role → RoleProfile → SkillProfile → ExecutablePersona | §3.4 | γ-1 | [ ] |
| D9 | API `POST /api/v1/clones/persons/:id/ask` и `/clones/roles/:id/ask` | §3.4 | γ-1 | [ ] |
| D10 | При уходе носителя — SkillProfile.status = `archived`, остаётся как наследие | §3.4 | γ-1 | [ ] |
| **E. Conversational Channels (§3.5)** | | | | |
| E1 | `Channel` как двунаправленная абстракция (in + out) | §3.5 | α-1 | [ ] |
| E2 | InApp — равноправный канал, не «UI» | §3.5 | α-1 | [ ] |
| E3 | Pluggable архитектура `IChannel` | §3.5 | α-1 | [ ] |
| E4 | Три типа inbound: free note / response / chat-query | §3.5 | α-1 (инфра), α-5 (chat-query routing) | [ ] |
| E5 | Симметрия: response → новый RawEvent через ingest | §3.5 | α-1 | [ ] |
| E6 | `dataClass`-фильтр на канал | §3.5 | α-1 | [ ] |
| E7 | Универсальный linking flow (код в ЛК → `/link` в боте) | §3.5 | α-1 (инфра), β-1 (использование) | [ ] |
| E8 | Каналы α: `in_app`, `email_smtp`, `email_imap` | §3.5 | α-1 | [ ] |
| E9 | Каналы β: `telegram_bot`, `max_bot` | §3.5 | β-1 | [ ] |
| E10 | ChatV2 работает через все каналы одинаково | §3.5 | α-5 | [ ] |
| **F. Curation (§3.6)** | | | | |
| F1 | Triage: auto-canonical / light review / deep review | §3.6 | α-4 | [ ] |
| F2 | Пороги triage настраиваемые per-org через `/settings/curation` | §3.6 | α-4 | [ ] |
| F3 | Critical-list (default: Regulation, Process, Decision) → всегда deep review | §3.6 | α-4 | [ ] |
| F4 | `CuratorAssignment` per-ResourceType | §3.6 | α-4 | [ ] |
| F5 | Multi-touch UI: `/curation` + inline + channels + dashboard | §3.6 | α-4 | [ ] |
| F6 | Модели `CurationItem`, `CurationDecision`, `ConflictItem`, `CardVersion` | §3.6 | α-4 | [ ] |
| F7 | Conflict resolution с типом `evolving` (temporal-память) — обязательно | §3.6 | α-4 | [ ] |
| F8 | Stale-detection cron через probe в каналы | §3.6 | α-4 (cron) + β-5 (probe channel) | [ ] |
| F9 | Skill — post-hoc контроль `mark_as_misleading`, без pre-approval | §3.6, §3.4 | γ-1 | [ ] |
| F10 | Версионность через `CardVersion`, AI-чат читает current | §3.6 | α-4 (модель) + α-5 (использование) | [ ] |
| **G. Слой 1 — расширение разметки** | | | | |
| G1 | Расширение enum `IdeaBlock.signalType` (+5 значений) | §2.A | α-2 | [ ] |
| G2 | Reasoning-extractor подтипизация в BlockExtractionService | §2.A, §3.4 | α-2 | [ ] |
| **H. Слой 5 — Chat-v2 omnichannel** | | | | |
| H1 | Новый модуль `chat-v2/` | §2.E | α-5 | [ ] |
| H2 | Три уровня ответа: factual / synthetic / clone-style | §2.E | α-5 (factual+synthetic), γ-1 (clone-style) | [ ] |
| H3 | Provenance через `IdeaBlockEvidence` | §3.1 | α-5 | [ ] |
| H4 | Deprecation chunk-RAG (`MeetingTranscriptChunk`) | §2.E | α-5 (план), β/γ (исполнение) | [ ] |
| **I. Слой 6 — Probe Agent** | | | | |
| I1 | `ProbeService.suggest()` — контракт для специалистов | §2.F, §5.4 | β-5 | [ ] |
| I2 | Анти-спам + quiet hours + приоритизация | §2.F | β-5 | [ ] |
| I3 | Дедуп probe-events | §2.F | β-5 | [ ] |
| I4 | Symmetric response: ответ → новый RawEvent → ingest | §2.F, §3.5 | β-5 (+α-1 инфра) | [ ] |
| I5 | Closing loop для Ideas: автонотификация авторам при изменении статуса | §2.C (3.6), §3.3 (запрет C4) | β-5 | [ ] |
| **J. Слой 3 — контракт специалиста (сквозной)** | | | | |
| J1 | Карточка с `tenantId`, `entityId?`, `sourceBlockIds[]`, `confidence`, `status`, `version` | §5.2 | все sub-TZ Слоя 3 | [ ] |
| J2 | Triage через `CurationService.triage()` | §5.3 | все sub-TZ Слоя 3 | [ ] |
| J3 | Probe-events через `ProbeService.suggest()` | §5.4 | все sub-TZ Слоя 3 | [ ] |
| J4 | Conflict-events через `ConflictService.report()` | §5.5 | все sub-TZ Слоя 3 | [ ] |
| J5 | `getCitations(blockIds)` для chat-v2 | §5.6 | все sub-TZ Слоя 3 | [ ] |
| J6 | Метрики `core_specialist_*` | §5.7 | все sub-TZ Слоя 3 | [ ] |
| J7 | RBAC ResourceType для каждой карточки | §5.8 | все sub-TZ Слоя 3 | [ ] |
| J8 | Idempotency воркера по `IdeaBlock.id` | §5.9 | все sub-TZ Слоя 3 | [ ] |
| J9 | `personSubjectIds[]` для последующей сборки SkillProfile | §5.10 | все sub-TZ Слоя 3 + γ-1 | [ ] |
| J10 | LlmTaskType зарегистрирован через seed-script `seed-llm-task-routes-<feature>.ts` с тремя provider'ами | §5.11, §3.7 | все sub-TZ Слоя 3 + α-2 + α-5 | [ ] |
| J11 | В каждом seed-script — комментарий со ссылкой на [llm-models-playbook.md](../../llm-models-playbook.md) (какие модели тестировались, по каким метрикам выбрана) | §5.11, §3.7 | все sub-TZ Слоя 3 + α-2 + α-5 | [ ] |
| **K. Расширение существующего knowledge-core** | | | | |
| K1 | `Person.relationship` enum (`employee` | `external` | `candidate` | `former`) | §3.4 | α-3 | [ ] |
| K2 | Card.kind расширен `vendor` | §2.B (Vendor) | α-3 или α-6 | [ ] |
| K3 | RouterService — диспатчер атомов к специалистам Слоя 3 | §2.B | α-3 | [ ] |
| K4 | Расширение `LlmTaskType` enum новыми taskType'ами под каждого специалиста | §2.H | каждый sub-TZ | [ ] |
| K5 | Расширение `BusinessMetricsService` (curation_* + conversational_* + probe_* + specialist_*) | §2.H, §5.7 | все sub-TZ | [ ] |
| **L. UI обновления** | | | | |
| L1 | `/curation` (master-detail) + `/settings/curation` | F5 | α-4 | [ ] |
| L2 | `/chat` (master-detail + ChatPanel виджет) | H1 | α-5 | [ ] |
| L3 | `/me/channels` + `/me/notifications` | E7 | α-1 | [ ] |
| L4 | `/regulations` (master-detail) | C1 | α-7 | [ ] |
| L5 | `/decisions` (master-detail) | C2 | β-3 | [ ] |
| L6 | `/insights` (дашборд + master-detail) | C2 | β-4 | [ ] |
| L7 | `/ideas` (master-detail + персональная вкладка) | C2 | β-5 | [ ] |
| L8 | `/me/clone` (диалоговая страница) | C5, D6 | γ-1 | [ ] |
| L9 | `/persons/:id/skill-profile` (manager-доступ) | D6 | γ-1 | [ ] |
| L10 | Расширение глоссария UI русскими названиями всех новых сущностей | (`feedback_admin_ui_russian_only.md`) | каждый sub-TZ | [ ] |
| **M. LLM provider routing — трёхуровневая подстраховка + admin-управление (§3.7)** | | | | |
| M1 | Расширение `LlmTaskRoute` модели полем `tier` (`primary`\|`secondary`\|`tertiary`) + `priority` | §3.7 | α-фаза (отдельный мини-блок в α-2 ИЛИ один из sub-TZ) | [ ] |
| M2 | `LlmRouterService.call()` поддерживает auto-fallback по цепочке primary → secondary → tertiary | §3.7 | α-фаза (вместе с M1) | [ ] |
| M3 | Tertiary провайдер для каждого taskType — обязательно local (Ollama / on-prem) | §3.7, §5.11 | каждый sub-TZ при регистрации taskType | [ ] |
| M4 | Расширение `AiUsageLog` полем `tier` + `fallbackUsed` boolean | §3.7 | α-фаза (вместе с M1) | [ ] |
| M5 | Метрика `core_llm_no_provider_total{taskType}` + `core_llm_fallback_total{taskType,tier}` | §3.7 | α-фаза | [ ] |
| M6 | Z-Admin страница `/admin/ai-models` — расширение [admin-functions](../../second-brain/02_architecture/module-map.md) — цепочка per-agent, кнопка «переключить primary», метрики per-agent (cost/latency/success rate/quality proxy), история переключений | §3.7 | α-фаза (расширение Phase 7 admin) | [ ] |
| M7 | A/B-тестирование per-agent (N% трафика на другой primary) — расширение существующего [admin-experiments](../../second-brain/02_architecture/module-map.md) | §3.7 | α-фаза (расширение Phase 7 admin) | [ ] |
| M8 | Все три provider'а в цепочке проходят фильтр по `maxDataClass >= taskType.dataClass` | §3.7, §9.3 | каждый sub-TZ при регистрации taskType | [ ] |
| M9 | NoEligibleProviderError → специалист помечает блок `processingStatus='llm_unavailable'`, retry через час | §3.7 | α-фаза (логика router) + каждый воркер специалиста | [ ] |
| M10 | Аналитика per-agent в Z-Admin: `% запросов в fallback`, `% запросов в local tertiary`, deviation primary vs secondary в качестве | §3.7 | α-фаза (расширение Phase 7 admin) | [ ] |

---

## 8. Изменения существующего knowledge-core (delta)

| Что | Где | Изменение | Sub-TZ |
|---|---|---|---|
| `IdeaBlock.signalType` enum | schema.prisma | +5 значений | α-2 |
| `BlockExtractionService` | knowledge-core/services | Reasoning-подтипизация | α-2 |
| `Entity.type` enum | schema.prisma | 7→12, `custom` удалён, `client → customer` | α-3 |
| `EntityResolutionService` | knowledge-core/services | Доменные правила для новых типов | α-3 |
| `Person` | schema.prisma | `entityId?`, `relationship` enum, `knowledgeProfile Json?` | α-3 (entityId, relationship), β-2 (knowledgeProfile) |
| `Goal`, `Document`, `Product` | schema.prisma | `entityId?` | α-3 |
| `Card.kind` | schema.prisma | +`vendor` | α-3 или α-6 |
| `card-rollup-v2.worker` | knowledge-core/workers | Контракт специалиста §5 | α-6 |
| `LlmTaskType` enum | schema.prisma | Новые taskType'ы для каждого специалиста + chat-v2 + reasoning-detect + clone-respond + curation-related | каждый sub-TZ |
| `LlmTaskRoute` | schema.prisma | +поля `tier` (`primary`\|`secondary`\|`tertiary`) и `priority` (см. §3.7) | α-фаза (один раз) |
| `LlmRouterService.call` | ai/services | Auto-fallback по цепочке primary → secondary → tertiary. NoEligibleProviderError при отказе всех трёх. | α-фаза (один раз) |
| `AiUsageLog` | schema.prisma | +поля `tier` и `fallbackUsed` boolean | α-фаза (один раз) |
| Z-Admin `/admin/ai-models` | admin/controllers/admin-functions + admin-experiments + admin-prices | UI цепочки provider'ов per-agent, кнопка переключения, A/B, метрики per-agent, история | α-фаза (расширение Phase 7) |
| Каждый новый taskType | seed/scripts | `seed-llm-task-routes-<feature>.ts` с **тремя** provider'ами + ссылка на [llm-models-playbook.md](../../llm-models-playbook.md) в комментарии | каждый sub-TZ при создании taskType |
| `reframing.cron` | knowledge-core/workers | Расширение stale-detection per card type | α-4 |
| `policy.csv` (RBAC) | rbac/policies | Новые ResourceType: `regulation`, `decision`, `insight`, `idea`, `skill_profile`, `clone_persona`, `curation_item`, `conflict_item`, `card_version`, `channel`, `notification`, `knowledge_profile` | каждый sub-TZ |
| `BusinessMetricsService` | common/metrics | Новые counters/gauges/histograms (см. §5.7 + curation_* + conversational_* + probe_*) | каждый sub-TZ |
| `TypedConfigService` + `env.schema.ts` | common/config | Новые ENV для порогов triage, dataClass-маппингов, бот-токенов, rate limits, cron-расписаний | каждый sub-TZ |
| `apply-postgres-init.sql` | scripts | HNSW индексы для embedding'ов новых моделей (Decision, Regulation, Insight, Idea, SkillProfile) | каждый sub-TZ |

---

## 9. Сквозные нефункциональные требования

### 9.1. Multi-tenancy

Все новые модели имеют `tenantId`. Все API защищены `TenantGuard`. Запросы через `tenantId` извлечённый из `X-Org-Id` (паттерн уже работает).

### 9.2. RBAC

- Каждая новая модель регистрируется в `RbacService.ResourceType`.
- Дефолтные права: read — все member'ы Org, write/delete — owner/admin.
- Special cases: skill_profile — только owner/admin/direct manager (не все member'ы).
- `CuratorAssignment` даёт write права куратору на конкретные ResourceType.

### 9.3. DataClass и privacy

- `dataClass` (существующий enum: `public` / `internal` / `confidential` / `restricted` / `top_secret`) проставляется на каждой карточке специалиста на основе `IdeaBlock.dataClass` блоков-источников (max).
- `LlmRouterService` уже фильтрует провайдеров — расширение не требуется.
- `ConversationalModule` фильтрует каналы по `Channel.maxDataClass`.
- Probe-события наследуют `dataClass` от исходной карточки.

### 9.4. Observability

- Все воркеры и cron'ы инструментированы метриками `core_specialist_*`, `curation_*`, `conversational_*`, `probe_*`.
- Все API-эндпоинты — Pino-логирование с `tenantId`, `userId`, `requestId`.
- Дашборды Grafana обновляются — отдельный sub-TZ infra (не входит в эту фазу, выпускается параллельно при необходимости).

### 9.5. Idempotency

- Все воркеры идемпотентны по jobId (паттерн `<workerName>_<entityId>`).
- Все API мутирующие операции поддерживают `Idempotency-Key` header (по паттерну существующего ingest).

### 9.6. Retention

- Новые модели подключаются к существующей retention-pipeline (Фаза 11).
- Стратегии retention настраиваемые per Org через `/settings/retention`.

### 9.7. Прайс-карта и аналитика стоимости

- Каждый LLM-вызов через `LlmRouterService` логируется в `AiUsageLog` (уже работает).
- Новые taskType'ы автоматически попадают в Z-Admin аналитику стоимости.
- Дополнительная разбивка `usage by specialist` — отдельный admin-view (можно добавить в любую фазу).

### 9.8. LLM provider routing — трёхуровневая подстраховка + admin-управление per-agent

Это сквозное требование (см. §3.7 и §5.11), относящееся к **каждому** новому taskType.

- **Цепочка из ≥3 provider'ов** обязательна для каждого taskType:
  - `primary` (рабочий) — выбран по результатам тестов из [llm-models-playbook.md](../../llm-models-playbook.md), лучшее качество/цена.
  - `secondary` (если что-то пошло не так) — провайдер той же категории качества, переключается при ошибке/timeout/rate-limit primary.
  - `tertiary` (когда связи нет) — **обязательно local** (Ollama/on-prem), гарантирует работу без внешней связи.
- **Auto-fallback** в `LlmRouterService.call()` — прозрачен для специалистов, логируется в `AiUsageLog.fallbackUsed=true` + метрика `core_llm_fallback_total{taskType,tier}`.
- **NoEligibleProviderError** при отказе всех трёх → специалист помечает блок `processingStatus='llm_unavailable'`, retry через час; метрика `core_llm_no_provider_total{taskType}`.
- **Все три provider'а** в цепочке должны проходить фильтр `provider.maxDataClass >= taskType.dataClass` (паттерн уже работает в `LlmRouterService`).
- **Z-Admin `/admin/ai-models`** (расширение существующего Phase 7) — переключение primary без выкатки кода, A/B-тестирование per-agent, метрики per-agent (cost / latency p50-p95-p99 / success rate / quality proxy `% auto-canonical`), история переключений с авторством.
- **Каждый sub-TZ** при создании taskType **обязан** включать seed-script `seed-llm-task-routes-<feature>.ts` с тремя provider'ами и комментарием со ссылкой на playbook-результаты.

---

## 10. Промпты — отдельный круг согласования

**Правило.** Все промпты в этом ТЗ — **placeholders в коде** с TODO `// TODO(owner-product): согласовать текст промпта`. Тексты промптов — отдельный круг согласования с владельцем продукта, не часть ТЗ.

**Список промптов, требующих согласования (по фазам):**

α-фаза:
- `reasoning-detect` (Слой 1 расширение) — распознавание блоков-обоснований
- `regulation-extract`, `regulation-dedupe`, `process-steps-extract` (3.1)
- `card-rollup-v2` обновление под §5 контракт (3.4) — пересмотр существующего
- `chat-v2-synthesize`, `chat-v2-cite-select` (5)
- `curation-conflict-judge` — LLM-арбитр для conflict resolution (опц., можно полностью ручным)

β-фаза:
- `knowledge-clone-extract`, `knowledge-clone-merge` (3.2)
- `decision-extract`, `decision-supersede-detect` (3.3)
- `insight-extract`, `insight-cluster-merge` (3.5)
- `idea-extract`, `idea-cluster-merge` (3.6)
- `probe-formulate` — формулировка вопроса по probe-event (Слой 6)
- `idea-status-summarize` — для дайджеста авторам

γ-фаза:
- `skill-trait-detect`, `skill-trait-merge` (3.7)
- `executable-persona-compile` (3.7)
- `clone-respond` (Clone API)
- `skill-trait-misleading-feedback` — дайджест manager'у

**Процесс согласования промпта:** PR с placeholder → demo на 5-10 реальных кейсах → правки владельца → seed/patch скрипт через [skill `safe-seed-rules`](../../.claude/skills/safe-seed-rules) → выкатка.

---

## 11. Открытые вопросы

Вопросы, решения по которым **не зафиксированы** в зонтичном — определяются в начале соответствующего sub-TZ.

1. **Reasoning-extractor — один проход или два?** Один LLM-вызов `block-ingest` с расширенным prompt'ом, или второй проход `reasoning-detect` отдельно? Влияет на стоимость и качество. Решение — α-2.

2. **`RouterService` — статический mapping или LLM-routing?** Простой mapping `signalType → specialist` против гибкого LLM-роутера (`«какой специалист должен обработать этот блок?»`). Решение — α-3.

3. **`MaxBotChannelAdapter` — есть ли публичный bot API?** Если нет — пишем через email-bridge или ждём. Решение — β-1, после context7.

4. **Skill-trait — нужна ли отдельная модель `SkillTraitCategory` для эмерджентных категорий, или это просто Text-поле?** Если делаем модель — появляется возможность merge/rename категорий через UI. Решение — γ-1.

5. **`Decision.affectsEntityIds[]` — массив или join-таблица?** Производительность vs простота. Решение — β-3.

6. **`ExecutablePersona` — версионируется при каждом изменении traits или раз в неделю?** Влияет на consistency «как отвечает клон». Решение — γ-1.

7. **Card-rollup-v2 для существующих Card-типов (`client`/`deal`/`project`/`topic`/`custom`) — переписывается под §5 контракт или ставится `@deprecated`, заменяется новыми воркерами?** Решение — α-6.

8. **chat-v2 — отдельный модуль ИЛИ переписывание существующего `chat/` модуля?** Решение — α-5, после ревью существующего кода chat.

9. **Каркас 5 уровней из Фазы 0b — миграция данных в новые карточки Слоя 3 или они там уже совместимы?** Зависит от того, насколько Фаза 0b будет реализована к моменту α. Решение — α-7.

10. **`evolving` resolution — нужны ли temporal queries в `chat-v2` («как мы продавали в марте 2026?»)?** Если да — расширяем chat-v2. Решение — α-4 (модель) + α-5 (использование).

---

## 12. DoD зонтичного

Этот зонтичный ТЗ считается готовым к старту реализации, когда:

- [x] Все шесть архитектурных решений зафиксированы с обоснованиями (§3).
- [x] Карта 12 агентов в 6 слоях нарисована (§4).
- [x] Контракт специалиста описан (§5).
- [x] Все 13 sub-TZ перечислены со scope, входами, выходами, ссылкой на матрицу (§6).
- [x] Матрица прослеживаемости (66 строк) заполнена (§7).
- [x] Delta существующего knowledge-core зафиксирован (§8).
- [x] Сквозные нефункциональные требования перечислены (§9).
- [x] Список промптов на согласование с владельцем продукта собран (§10).
- [x] Открытые вопросы выписаны с указанием sub-TZ для решения (§11).
- [ ] Каждое sub-TZ создано как draft в `plans/tz/` (после согласования зонтичного).
- [ ] Ссылка на этот зонтичный добавлена в [second-brain/index.md](../../second-brain/index.md).
- [ ] Владелец продукта подтвердил scope и переходим к sub-TZ.

---

## 13. Итог

**Реализовано целиком:** нет (это ТЗ только что создан).

**Что осталось:**
1. Согласование с владельцем продукта.
2. Создание 13 sub-TZ как draft файлов с заполненным scope (на основе §6).
3. Согласование промптов (см. §10).
4. Решение 10 открытых вопросов в начале соответствующих sub-TZ (§11).
5. Реализация по фазам α → β → γ.

**Ожидаемый эффект после полной реализации:**
- Z становится полноценным **memory layer компании** с 12 специалистами и омниканальным conversational layer.
- AI-чат отвечает на любой вопрос компании через любой канал, цитируя источники.
- Сотрудники получают точечные вопросы в Telegram/MAX/email, отвечают одним тапом, петля самообучения замкнута.
- Каждый сотрудник имеет работающий клон-агент, доступный руководителю и самому сотруднику (для прозрачности).
- Знания не теряются при уходе сотрудников — SkillProfile архивируется и доступен как наследие.

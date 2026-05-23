---
type: analysis
status: approved
feature: Кора v2 — единая финальная архитектура продукта (память компании, AI-агенты, концьерж, юнит-экономика, zero-button каналы)
date: 2026-05-22
approved-date: 2026-05-23
approved-by: владелец продукта (sergrv80@gmail.com)
author: claude (по запросу владельца, синтез 5 analysis-документов сессии + зонтичного ТЗ + новых требований)
supersedes: plans/tz/2026-05-21-second-brain-agents-umbrella.md (становится главной точкой правды; зонтичное ТЗ от 2026-05-21 переходит в исторический режим)
related:
  - plans/analysis/2026-05-22-ontology-reasoning-from-scratch.md
  - plans/analysis/2026-05-22-role-map-ontology-gap.md
  - plans/analysis/2026-05-22-company-ontology-gap.md
  - plans/analysis/2026-05-22-dialog-layer-query-processing.md
  - plans/analysis/2026-05-22-coo-dashboard-and-checkins.md
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/analysis/2026-05-22-ui-design-deep-audit.md
  - plans/analysis/2026-05-22-second-brain-visualization.md
  - second-brain/06_marketing/positioning.md
  - second-brain/02_architecture/knowledge-core.md
---

# Кора v2 — единая финальная архитектура продукта

> ⚠️ **REALITY CHECK (2026-05-23).** После прогона 7 code-audit агентов выяснилось, что **~60-70% продуктового scope из этого документа уже реализовано** в существующем коде. Продуктовые **решения и архитектура** (8 принципов, 4 оси, 7 слоёв, 20+ агентов, концьерж-режимы, юнит-экономика, zero-button философия) — **остаются в силе** и являются точкой правды. Изменился только **масштаб инженерной работы** — он почти втрое меньше заявленного. См. парный документ [`plans/analysis/2026-05-22-code-reality-deltas.md`](2026-05-22-code-reality-deltas.md) — там разбивка готовности по каждому sub-ТЗ + 6 критических багов (CRIT-1..CRIT-6) + решения по точкам конфликта с реальным кодом (PersonRole→Appointment, Metric→KPI, Mission/Vision/Strategy→CompanyProfile, Process→ProcessTemplate, унификация admin-групп).
>
> ---
>
> **Назначение.** Это **главная архитектурная карта продукта**. Она собирает в одно место всё, что обсудили в сессии 2026-05-22: ответы на 50+ открытых вопросов, новые требования (концьерж-агент в кабинете, юнит-экономика, zero-button каналы), уточнённую онтологию (4 оси знания вместо 2), полную карту слоёв и агентов.
>
> **Этот документ — для владельца продукта.** Технические детали (Prisma-модели, API, миграции) — в парном `plans/tz/2026-05-22-final-roadmap.md` (для программистов).
>
> **Принцип согласования.** После одобрения этого документа он становится главной точкой правды; зонтичное ТЗ от 2026-05-21 переходит в режим «исторический документ, см. v2». Все sub-ТЗ создаются от этой карты.
>
> **Принцип «ничего не урезаем» зафиксирован.** Время и ресурсы есть — строим полный продукт миллиардной компании, не MVP.

---

## Часть 1. Что мы строим — видение в одной странице

**Кора — это память компании.** Платформа, которая автоматически собирает всё, что произнесли, написали и решили внутри компании, превращает это в **граф знаний**, и даёт компании **умного второго мозга**, к которому можно обратиться через любой канал — в кабинете, в Telegram, в MAX, по email, голосом.

**Что Кора делает за пользователя**, без его ручного труда:
- Слушает встречи (LiveKit), читает чаты и документы.
- Сама выделяет факты, решения, регламенты, идеи, проблемы.
- Сама связывает их между собой (граф).
- Сама замечает противоречия и пробелы.
- Сама задаёт уточняющие вопросы тому человеку, кто скорее всего знает.
- Сама собирает «клон сотрудника» — что он знает, как думает, какие у него типовые рассуждения.
- Сама показывает руководителю операционный пульс компании.

**Что пользователь делает сам:**
- Говорит с Корой на естественном языке.
- Реагирует на короткие уточняющие вопросы.
- Принимает решения, которые Кора не должна принимать за него (наём, увольнение, стратегия).

**Категория рынка:** memory layer / память компании. Встречи на LiveKit — первый и обязательный источник знания, но не единственный и не главный. Кора живёт там, где работает команда.

**ICP и позиционирование** — см. [second-brain/06_marketing/positioning.md](../../second-brain/06_marketing/positioning.md). При расхождениях этого документа с positioning — приоритет у positioning.

---

## Часть 2. Восемь принципов продукта (всё остальное вытекает отсюда)

Это не «правила разработчика». Это **продуктовые принципы**, которые должны соблюдать ВСЕ агенты, ВСЕ UI-компоненты, ВСЕ каналы. Если что-то нарушает один из принципов — это блокер выпуска.

### Принцип 1. Максимальная автоматизация — минимум ручного труда пользователя

Если что-то можно сделать за пользователя — делаем за него. Ручной труд оставляем только там, где требуется **человеческое решение** (одобрение, выбор стратегии, увольнение, согласование скидки выше полномочий).

**Применение:**
- Нет форм с >3 полями без AI-подсказок.
- Нет ручной привязки встречи к проекту — агент сам предлагает 1-2 варианта.
- Нет ручного назначения owner'а — агент предлагает по контексту.
- Нет dropdown'ов с >20 опциями без typeahead + AI-предложений сверху.
- Нет confirmation-модалок для reversible действий (отменить можно одной кнопкой).
- Нет многошаговых wizards (кроме обязательного onboarding) — если шагов больше 1, агент собирает данные через диалог.

### Принцип 2. Никаких кнопок там, где можно говорить

**Telegram, MAX и любой мессенджер — это канал связи, не приложение.** Три типа входа:
- Текст.
- Голос (через ASR — мы транскрибируем).
- Документ.

**Никаких inline_keyboard, никаких reply_keyboard, никаких BotCommand'ов** (кроме одного `/start` для линковки аккаунта). «Покажи мои идеи» — это естественный язык, не slash-команда. Probe-вопросы — текст в чате, ответ — тоже текст в чате.

Деталь по реализации и существующему коду — в Части 6.

### Принцип 3. Доверяем LLM-агентам, минимум жёстких правил

Современные LLM умеют гораздо больше, чем мы дёргаем через жёсткие if/else. Подход:

- **Категории — эмерджентные.** Skill-traits, темы, кластеры идей, причины сбоев — пусть LLM сам формирует категории, не предзаданный enum. Enum только для системных статусов (active / archived / superseded).
- **Маршрутизация — гибрид.** Default — статический mapping `signalType → specialist`, потому что он дёшев и предсказуем. Для unmatched / неоднозначных блоков — LLM-роутер с тремя кандидатами.
- **Подтверждения от куратора — минимум.** Только critical-types (Regulation, Process, Decision) идут через deep review. Остальное — `auto-canonical` если `confidence ≥ 0.85`.
- **Промпты — admin-editable из БД, не код.** Владелец продукта или его помощник может менять промпт без выкатки (Prompt Registry уже в плане Phase A).
- **Модели — admin-switchable из админки.** Можно поменять primary/secondary/tertiary для любого taskType без релиза (см. Часть 7).

### Принцип 4. Гибкость — у агентов те же возможности, что у пользователя

Агенты компании работают по тому же паттерну, что я (Claude) сейчас работаю с владельцем — у них есть **skills, tools, knowledge access**. Не «жёстко прописанный pipeline», а **набор инструментов и свобода их комбинировать**.

**Применение:**
- Каждый специалист Слоя 3 — это не «функция», а **агент с набором tools**: `search`, `getCard`, `createCard`, `linkBlocks`, `emitProbeEvent`, `emitConflictEvent`.
- Концьерж-агент (Часть 5) имеет tool-схему доступа ко всем основным REST-эндпоинтам — он может сам сделать то, что сделал бы пользователь руками.
- Оркестратор сложных запросов (γ-2) спавнит субагентов с изолированным контекстом, как делает Anthropic в multi-agent research.
- Skills и промпты редактируются администратором без релиза.

### Принцип 5. LiveKit — священная корова, только медиа

LiveKit Server отвечает за **медиа** (аудио, видео, screen share) и **ничего больше**. Бизнес-логика, FSM встречи, AI-pipeline — всё на нашем бэке. Никаких токенов гостям, никакой проверки прав внутри LiveKit, никакой записи через LiveKit Server (запись через Egress в отдельную инфру).

Это **не меняется** в Коре v2. Архитектура встроек LiveKit React Components, Egress в S3, отдельный TURN — всё остаётся как есть. Кора **добавляет** новые источники знания (Telegram, чек-ины, email), но **не заменяет** LiveKit-pipeline.

Деталь — в Части 8.

### Принцип 6. Источник правды — наша БД, не LLM

Каждый факт в карточке имеет провенанс до исходной цитаты в блоке. AI-чат отвечает с источниками. Если данных нет — честно говорит «не знаю», а не выдумывает. Promote из «эфемерного диалога» в «факт о компании» — только через явный шаг (специалист пишет в карточку → triage → канонизация).

### Принцип 7. Прозрачность для носителя — Skill не превращается в HR-инструмент

Skill-профиль и клон сотрудника — **рабочий артефакт компании**, не персональные данные. Но у носителя есть:
- Право видеть свой клон и попробовать его (страница `/me/clone`).
- Право пометить trait как `misleading` (без удаления, но архивируется).
- Право видеть, кто и когда обращался к его клону (audit log).

Чего нет (зафиксировано как несгибаемое правило):
- Кнопки «выключить наблюдение» — её нет, потому что Skill — про компанию, не про человека.
- Скрытия traits от руководителя — нельзя.
- Onboarding opt-in — Skill включается автоматически у `Person.relationship='employee'`.

### Принцип 8. Pluggable каналы, pluggable LLM, pluggable storage

Никаких хардкодов конкретного провайдера. Switchable из ENV или админки:
- **Каналы:** в коде интерфейс `IChannel` — реализации `in_app`, `email`, `telegram`, `max`, `slack`, `whatsapp`, `voice_via_asr`.
- **LLM:** `LlmRouterService` с цепочкой primary → secondary → tertiary, переключаемой из админки.
- **Storage:** `S3-compatible` — поддерживаются Yandex, Selectel, SberCloud, MinIO; switch через ENV.
- **TURN, SFU (LiveKit), Egress:** отдельные ноды, switchable через инфра-конфиг.

---

## Часть 3. Архитектура — общая картина

Это пересмотр зонтичного ТЗ от 2026-05-21 с учётом 5 analysis-документов этой сессии и новых требований. Главные изменения:

1. **Было 2 оси знания (WHO × FUNCTIONAL), стало 4** — добавлены CONTEXTUAL (Customer / Project / Market) и TEMPORAL (явная цепочка через evolving).
2. **Было 6 слоёв, стало 7** — добавлен Слой 0 «Источники знания» (Sources), потому что омниканальный ingest — это отдельная архитектурная задача, не «инфраструктура».
3. **Было 12 агентов, стало 20+** — добавлены Role Map Builder, Experiment Tracker, Brand Voice Curator, Consistency Checker, Orchestrator, Proactive Watcher, COO Operations, Concierge Agent, Dialog Layer (контекстуализатор/классификатор/multi-query/summarizer), Org Knowledge Index Builder.
4. **Раскатка стала α / β / γ / δ** — добавлена δ-фаза для оркестратора, проактивного агента и расширенного концьержа.
5. **Принцип «один факт → много контейнеров»** (fan-out маршрутизация) формализован — не «выбираем один домен», а проецируем на все релевантные оси одновременно.
6. **Сборка нормативных артефактов инкрементальная.** Каждый процесс / регламент / принцип имеет `completeness 0..1` first-class + список незаполненных слотов → автоматические probe-вопросы.

### 3.1. Четыре оси знания (формализованная онтология)

Каждый факт в Коре проецируется одновременно на четыре независимые оси. Это не одно поле «куда положить», а **fan-out на N контейнеров**.

| Ось | Что отвечает на вопрос | Контейнеры |
|---|---|---|
| **WHO (Кто)** | «чьё это знание, кому оно принадлежит» | Person · Role · RoleProfile · SkillProfile · Department · CompanyProfile · Appointment · PersonalRelation |
| **FUNCTIONAL (Какая функция)** | «о какой функциональной области» | FunctionalDomain (дерево с авто-расширением, 8 базовых функций + per-industry templates) |
| **CONTEXTUAL (Какой объект)** | «вокруг какого внешнего объекта это знание» | Customer · Project · Vendor · Product · Market · Event |
| **TEMPORAL (Когда верно)** | «до какого момента факт актуален» | через `evolving` resolution + temporal-цепочки фактов (не отдельная ось узлов, а сквозной механизм) |

**Пример.** Факт «CMO Иванов решил поднять цены на enterprise-сегмент в Q3 на 15%» проецируется на:
- WHO: Иванов (Person) + CMO (Role) + Иванов-как-CMO (SkillProfile) + Маркетинг (Department) + наша компания (CompanyProfile)
- FUNCTIONAL: Pricing (домен) + Marketing (домен) — два домена одновременно
- CONTEXTUAL: Enterprise-сегмент (Market) — и опц. конкретные клиенты, если упомянуты
- TEMPORAL: точка Q3 + начало действия (validFrom) + если есть «до конца года» — validUntil

Один `IdeaBlock` → 6-10 связей с контейнерами. Граф богатеет, не растекается.

### 3.2. Семь слоёв системы

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 0 — ИСТОЧНИКИ (Sources)                                            │
│ • Встречи LiveKit (общая запись + отдельные аудиодорожки)              │
│ • Inbound через каналы: Telegram, MAX, in-app, email                   │
│ • Документы: PDF / DOCX / MD / TXT / Markdown через document.adapter   │
│ • Голос через ASR (Vox + GigaAM) → транскрипт → текст                  │
│ • Webhooks от внешних систем (Crossmark и др.)                         │
│ • Ежедневные чек-ины (утро/вечер) через привычный канал                │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ (Source → RawEvent)
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 1 — РАЗМЕТКА (Marking)                                             │
│ • block-ingest.worker — текст в IdeaBlock с signalType                  │
│ • signalType: fact · idea · decision · regulation · process_step ·     │
│   reasoning · rationale · decision_basis · expertise · experience ·    │
│   hypothesis · result · lesson · content_artifact · brand_principle ·  │
│   commitment · commitment_status · plan_item · done_item · blocker ·   │
│   team_friction · process_friction · resource_gap · pain · risk · ...  │
│ • reasoning-extractor — подтипизация для блоков-обоснований             │
│ • Confidence scoring на каждый блок                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 2 — ОНТОЛОГИЯ И МАРШРУТИЗАЦИЯ (Ontology & Routing)                 │
│ • Entity (12+ типов): Person · Customer · Vendor · Project · Product ·  │
│   Document · Goal · Event · Topic · Location · Technology · Metric ·   │
│   Market · OrgUnit                                                      │
│ • EntityResolutionService — дедуп новых сущностей                       │
│ • Axis-classifier — fan-out по 4 осям (WHO × FUNCTIONAL × CONTEXTUAL ×  │
│   TEMPORAL)                                                             │
│ • RouterService — гибрид: статический mapping + LLM для unmatched      │
│   диспатч на специалистов Слоя 3                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 3 — СПЕЦИАЛИСТЫ (12 агентов вместо 7)                              │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ 3.1 Regulations & Process Templates    [α] процессы/политики       │  │
│ │ 3.2 Knowledge Clone                    [β] что человек знает       │  │
│ │ 3.3 Decisions Registry                 [β] журнал решений          │  │
│ │ 3.4 Project/Customer Context           [α] карточки CRM             │  │
│ │ 3.5 Insights Radar                     [β] повтор. проблемы        │  │
│ │ 3.6 Ideas Collector                    [β] идеи + клиент-запросы   │  │
│ │ 3.7 SkillProfile + Persona             [γ] как человек думает      │  │
│ │ 3.8 Role Map Builder                   [α] карта должности         │  │
│ │ 3.9 Experiment Tracker                 [β] попытки и результаты    │  │
│ │ 3.10 Brand Voice Curator (Asset)       [β] корпус + голос бренда   │  │
│ │ 3.11 Personal Relation Graph           [β] кто с кем работает      │  │
│ │ 3.12 Company & Department Profile      [α] CompanyProfile/Domain   │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
        ↓                                                             ↑
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 4 — КОНТРОЛЬ КАЧЕСТВА (Curation)                                   │
│ • CurationService.triage — три уровня (auto / light / deep)             │
│ • Conflict-events first-class с evolving для temporal-памяти            │
│ • ConsistencyCheckerCron — структурные несостыковки графа               │
│ • Stale-detection per-card-type                                          │
│ • Inкрементальная сборка нормативки: completeness 0..1                  │
│ • Multi-touch UI: /curation + inline + channels + dashboard             │
└─────────────────────────────────────────────────────────────────────────┘
        ↓                                                             ↑
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 5 — ОТВЕТЫ (Answers / Dialog Layer)                                │
│ • DialogService (новое) — контекстуализация + классификация + multi-    │
│   query expansion + summarizer для длинных диалогов                     │
│ • ChatV2Service — основной chat backend (factual / synthetic / clone)   │
│ • OrchestratorService [δ] — для сложных запросов: план → субагенты →    │
│   синтез → проверка                                                     │
│ • Provenance через IdeaBlockEvidence обязателен                         │
│ • Omnichannel — работает через все каналы                               │
└─────────────────────────────────────────────────────────────────────────┘
        ↑
┌─────────────────────────────────────────────────────────────────────────┐
│ Слой 6 — АКТИВНЫЕ АГЕНТЫ (Probe + Proactive)                            │
│ • ProbeAgent — пассивный: отвечает на события «пробел/конфликт»         │
│ • ProactiveWatcher [δ] — активный: сам мониторит граф, формирует        │
│   инициативные сообщения «заметил риск в проекте X», «вижу повторно     │
│   обсуждаемое решение без owner'а»                                      │
│ • COO-Agent [β/γ] — ежедневные утренние/вечерние чек-ины                │
│ • ConciergeAgent — навигатор по сервису + executor действий            │
│   через tool-use; виден из любой страницы кабинета                      │
└─────────────────────────────────────────────────────────────────────────┘
        ↕↕↕
┌─────────────────────────────────────────────────────────────────────────┐
│ КАНАЛЫ — Conversational Channels (через все слои)                       │
│ in_app | email | telegram | max | (γ+) slack | whatsapp | voice_asr     │
│ Один интерфейс IChannel — три типа сообщений: free note / response /    │
│ chat-query. Все каналы zero-button (см. Часть 6).                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3. Изменения по сравнению с зонтичным ТЗ от 2026-05-21

| Что | Было | Стало |
|---|---|---|
| Оси знания | 2 (WHO × FUNCTIONAL, неявно) | 4 формализованные оси (WHO × FUNCTIONAL × CONTEXTUAL × TEMPORAL) с fan-out маршрутизацией |
| Слои | 6 | 7 (добавлен Слой 0 Sources) |
| Агенты Слоя 3 | 7 | 12 — добавлены Role Map Builder, Experiment Tracker, Brand Voice Curator, PersonalRelation Graph, Company & Department Profile |
| Слой 6 | один Probe-Agent | Probe + ProactiveWatcher + COO-Agent + ConciergeAgent — четыре сущности |
| Слой 5 | один ChatV2Service | DialogService (контекстуализация/классификация/multi-query) → ChatV2Service → OrchestratorService для сложных |
| Фазы | α / β / γ | α / β / γ / δ — добавлена δ для оркестратора и проактивного |
| Каналы | предусматривали кнопки (`/myideas`, inline_keyboard) | **ZERO кнопок** — только текст / голос / документ |
| Onтология | плоский enum signalType (5 значений) | расширен до 25+ значений (см. Слой 1 выше) |
| Институциональная память | отсутствовала как first-class | Слой 3.9 Experiment Tracker + Слой 3.10 Brand Voice Curator |
| Должность | три слоя (Role → RoleProfile → SkillProfile) | **четыре** (Role → RoleProfile → SkillProfile → Person), плюс PersonalRelation + Appointment |
| Решения | один объект Decision | три (`DecisionPoint`, `DecisionPolicy`, `Decision`) |
| Артефакт + Актив | две сущности | одна `Artifact` с типизацией useCase (`use_in_process` / `use_for_generation` / `reference`) |
| BrandVoice | заполняется руками | derived из Asset-корпуса воркером |
| Handoff | вложение в процесс | ребро между процессами с атрибутами |
| ProcessTemplate vs Instance | один объект | три слоя: Template → TemplateVersion → Instance → OperationalTask |
| FunctionalDomain | отсутствует (только `Theme.branch` enum) | дерево с авто-расширением + 8 базовых + per-industry templates |
| CompanyProfile | только Org как tenant | first-class node со слотами Mission/Vision/Strategy/Values |
| Department | отсутствует | отдельная модель с теми же слотами что Role |
| Maturity Indicator | отсутствует | per-Role + Org-level метрика, виджет в Director Dashboard |
| Concierge agent | отсутствует | сквозной UX-слой во всём ЛК |
| Юнит-экономика | LlmModelPrice как есть | полноценная админ-страница (см. Часть 7) с manual pricing + cost-per-Org-per-month |
| Telegram кнопки | планировались (`/myideas`, inline) | **полностью убраны** (см. Часть 6) |

---

## Часть 4. Ответы на все открытые вопросы (50+)

Группирую по источнику. Каждое решение — с обоснованием. Решения принимаю **сам**, как просил владелец продукта; если что-то спорно — пишу явно.

### 4.1. Из ontology-from-scratch (15 предложений)

**Все 15 принимаются.** Владелец сказал «не урезаем», у нас есть время и ресурсы.

| # | Предложение | Решение | Обоснование |
|---|---|---|---|
| ADD-1 | Role → RoleProfile → SkillProfile → Person — 4 слоя должность/носитель | ПРИНЯТО | Без этого слой «как Иванов работает CMO" сваливается то в Role (плохо: следующий CMO не такой), то в Person (плохо: вне работы не проявляется). Четвёртый слой решает retention знаний при увольнении. |
| ADD-2 | Отдел × домен m:n + «домены константа, отделы переменная» | ПРИНЯТО | Без cardinality m:n один маркетолог = один отдел = один домен (теряем «маркетинг = Performance + Бренд + Контент» декомпозицию). |
| ADD-3 | ProcessTemplateVersion между Template и Instance | ПРИНЯТО | Без версии: «по какому регламенту был принят экземпляр в марте?» — нечем ответить. Провенанс рвётся. |
| ADD-4 | 4-я ось — Customer / Project / Market (CONTEXTUAL) | ПРИНЯТО, **главный архитектурный сдвиг** | Без неё нельзя ответить «что мы знаем про Сбер» — реальный запрос дня №1. См. Часть 3.1. |
| ADD-5 | PersonalRelation как ребро Person↔Person | ПРИНЯТО | Нужен для onboarding («с кем работает Маша»), chat-v2 («к кому идти за X»), network-graph. Реализуем как `EntityLink(from='person',to='person',relationType='collaborates_with'/'reports_to'/'mentors'/'conflicted_with')` + специалист 3.11. |
| ADD-6 | Appointment — историческое отношение Person × Role | ПРИНЯТО | Без него нельзя «кто был маркетологом в марте?». Реализуем как отдельная модель с `validFrom` / `validUntil` / `loadPercent` / `department`. |
| ADD-7 | Маршрутизация = fan-out, не single-target | ПРИНЯТО | Один блок → много контейнеров (см. пример в 3.1). Без этого знание «утекает» в один контейнер вместо распределения. |
| ADD-8 | Temporal через evolving — основной механизм, не частный | ПРИНЯТО | Срок-как-атрибут не выражает «было 30 клиентов в январе + сейчас 50». Каждая меняющаяся метрика — цепочка evolving. |
| ADD-9 | OrganizationalUnit как общая форма Company / Department / Role | ПРИНЯТО, но **через интерфейс**, не через одну Prisma-модель | Реализуем через TypeScript-интерфейс `IOrganizationalUnit` с обязательными слотами; три отдельные модели (CompanyProfile, Department, Role) его реализуют. Это даёт UI-полиморфизм и единые UI-компоненты. |
| ADD-10 | Инкрементальная сборка нормативки — first-class механизм | ПРИНЯТО | `completeness 0..1` + список незаполненных слотов на каждом нормативном узле. Незаполненный обязательный слот → автоматический probe. Применяется к Process, Regulation, Policy, Principle, Methodology, DecisionPolicy, Experiment, RoleProfile, CompanyProfile, FunctionalDomain. |
| RES-1 | Решение → 3 объекта (DecisionPoint / DecisionPolicy / Decision) | ПРИНЯТО | Без разделения нельзя ответить «как мы обычно решаем X» (DecisionPolicy) против «что решили по X» (Decision). DecisionPoint — структурный элемент Process. |
| RES-2 | Artifact + Asset → одна модель `Artifact` с use-case | ПРИНЯТО | Один документ может быть и инструментом в процессе, и образцом для генерации. Один объект, типизация через поле `useCase` (multi-value). |
| RES-3 | BrandVoice — derived (output воркера), не первичный | ПРИНЯТО | Никто не будет заполнять «тон голоса» руками — LLM извлекает из корпуса Asset'ов. Куратор только подтверждает или помечает части корпуса как «выбросить из обучения». |
| RES-4 | Handoff — ребро между процессами, не вложение | ПРИНЯТО | Принимающий процесс должен видеть, что его ждёт. Реализуем как `ProcessHandoff(from, to, payload, format, frequency, owner, typicalFailures[])`. |
| SIM-1 | Зона / Функция / Обязанность → 2 уровня (Outcome + Activity) | ПРИНЯТО **с поправкой** | Не упрощаем до 2, оставляем 3 (Outcome → Function → Activity) но реализуем через одну модель `ResponsibilityElement` с полем `kind`. Это даёт гибкость UI (можно отобразить как 3 уровня или схлопнуть в 2) без дублирования таблиц. |

### 4.2. Из role-map-ontology-gap (7 вопросов)

1. **Сколько слотов карты должности отдельными моделями vs Json внутри Role?**
   **Решение: отдельными моделями для query-производительности и графовой связности.** Json только для редких UI-only полей. Конкретно отдельными моделями: `ResponsibilityZone`, `RoleFunction` (через `ResponsibilityElement` с kind), `ProcessTemplate`, `ProcessStep`, `ProcessInstance`, `OperationalTask`, `AuthorityBoundary`, `RequiredKnowledge`, `KPI`, `Interaction`. Внутри Role как Json — только UI preferences (display order, color tag).

2. **ProcessTemplate vs Regulation(kind='process') — две модели или одна?**
   **Решение: две модели с FK.** `ProcessTemplate` — структурная (есть steps, inputs, outputs). `Regulation(kind='process')` — нормативная (есть documentSource, regulatoryLevel). Они **связаны** через `ProcessTemplate.regulationId?` (один регламент может описывать процесс, но регламент — это про обязательность, процесс — про последовательность шагов). В UI отображаются вместе на странице `/processes/:id`.

3. **ProcessInstance переиспользует Card или отдельная модель?**
   **Решение: отдельная модель `ProcessInstance`.** Card.kind='process_instance' не годится — у Process есть exec-семантика (`currentStep`, `stuckSince`, `nextActor`), которой нет у Card. Связь с Card — через `Card.processInstanceId?` опционально, если из инстанса родилась клиентская карточка.

4. **Maturity Indicator — per-Role или Org-level?**
   **Решение: оба.** На каждой Role / Department / CompanyProfile / FunctionalDomain — `maturityScore Decimal(4,3)` first-class поле. Агрегат на Org — отдельная гауджа в Director Dashboard + страница `/maturity` с разбивкой по узлам и динамикой. Считается воркером `MaturityScorerCron` (раз в 4 часа): `completed slots / declared slots`.

5. **Типы рёбер между ролями — `EntityLink.relationType` или отдельная модель `RoleEdge`?**
   **Решение: расширить `EntityLink.relationType`.** Единый граф проще для BFS-обхода. Добавляются типы: `transfers_result_to`, `depends_on`, `coordinates_with`, `escalates_to`, `manages`, `collaborates_with`, `mentors`, `conflicted_with`, `reports_to`. Атрибуты ребра (по какому поводу, как часто) — в `EntityLink.attributes Json`.

6. **Consistency Checker — частота?**
   **Решение: cron каждые 4 часа + on-event при больших изменениях.** Cron `consistency-checker.cron` (`0 */4 * * *`) проходит по всем нормативным узлам с `completeness < 1.0`, эмитит probe-events. Дополнительно — on-event hook при создании/изменении любой нормативной карточки.

7. **DecisionLogic — расширение Decision или новая модель `DecisionPolicy`?**
   **Решение: новая модель `DecisionPolicy`.** `Decision` — факт сделанного выбора. `DecisionPolicy` — паттерн рассуждения роли (`trigger`, `factors[]`, `heuristic`, `typicalOutcome`). Связь: `Decision.appliedPolicyId?` (если решение принято по известному паттерну).

### 4.3. Из company-ontology-gap (10 вопросов)

1. **Theme vs FunctionalDomain — одна модель или две?**
   **Решение: две.** Theme — emergent (кластеры блоков). FunctionalDomain — структурный контейнер с детьми. Связь: `Theme.domainId? FK FunctionalDomain` (опц.). `Theme.branch` enum помечаем `@deprecated`, мигрируем в FunctionalDomain в γ-фазе. В α — обе работают параллельно.

2. **Department — отдельная модель или Role с типом `department`?**
   **Решение: отдельная модель.** Реализует тот же интерфейс `IOrganizationalUnit` что и Role, но это разные сущности (Role — позиция, Department — группа позиций). Хранение полей идентичное, но запросы и связи разные.

3. **Principle / Methodology — `Regulation.kind` или отдельная модель?**
   **Решение: расширение `Regulation.kind`** (минимум сущностей) + обязательное поле `methodologyType?` enum (`принцип` / `методика` / `чек-лист` / `подход`) когда `kind ∈ ('principle', 'methodology')`. Regulation — про «что нельзя/нужно», Principle — про «как мы думаем». Семантика разная, но структура одна (statement, owner, scope, validity).

4. **CrossFunctionalProcess — поглощается α-7 Regulations или отдельный β-блок?**
   **Решение: отдельный β-блок.** Sub-ТЗ `β-9 CrossFunctionalProcess + Handoff`. CrossFunctionalProcess наследует поля от ProcessTemplate, но имеет `ownerChain[]` (цепочка владельцев), `handoffs[]` (ProcessHandoff), `crossDepartmentMetric`. Реализуем после α-7 (нужны ProcessTemplate как базис).

5. **Experiment vs Insight vs Decision — где границы?**
   **Решение: явная FSM перехода.**
   - `Experiment` = попытка с гипотезой и результатом («попробовали X, получили Y»).
   - `Insight` = повторяющаяся проблема/блокер/риск (Insight.frequencyScore > порога).
   - `Decision` = сделанный выбор с rationale.

   **Переходы:**
   - Если Experiment даёт повторяющийся отрицательный результат → автоматически создаётся Insight (риск).
   - Если Experiment даёт принятый паттерн → автоматически создаётся DecisionPolicy.
   - Если Insight даёт mitigation → автоматически создаётся Decision (с `appliesToInsightId`).

   Воркер `EntityTransitionCron` (раз в день) проверяет переходы. Связи через FK, не через дублирование данных.

6. **Asset + BrandVoice — переиспользует Document или отдельная сущность?**
   **Решение: расширение существующей `Document` модели** через RES-2 (типизация `useCase[]`). Document получает `useCases[]` (multi-value: `reference` / `use_in_process` / `use_for_generation`), `extractedBrandVoiceProfileId?` (FK на BrandVoiceProfile, генерируемый отдельной моделью). BrandVoiceProfile — отдельная derived модель.

7. **База-затравка функциональных доменов — фиксированный список или per-industry?**
   **Решение: 8 базовых + per-industry templates.** Сидируется в `FunctionalDomainSeed` при создании Org. Базовая затравка: Маркетинг / Продажи / Производство / Финансы / HR / Закупки / Продукт / Логистика. Per-industry templates: при выборе индустрии в onboarding (SaaS, Девелопер, Ритейл, Производство, B2B-услуги) — догружается релевантный сет.

8. **Авто-расширение домена — частота / порог?**
   **Решение:** воркер `DomainExpanderCron` (раз в день) собирает блоки за день, для которых `axis-classifier.functionalDomain` вернул `confidence < 0.6` или `noMatch=true`. Если таких блоков ≥ 3 за неделю в схожем семантическом кластере (KNN cosine ≥ 0.78) — LLM-вызов `domain-name-suggest`. Если confidence ≥ 0.75 — создаётся новый домен с `status='proposed'`, попадает в curation `light review`. После одобрения — `status='canonical'`.

9. **Maturity Indicator — отдельный дашборд или виджет в Director Dashboard?**
   **Решение: оба.** Виджет «Зрелость второго мозга» в Director Dashboard (1 цифра + динамика 30 дней). Отдельная страница `/maturity` с разбивкой по узлам (CompanyProfile / каждый Department / каждая Role / каждый FunctionalDomain) и список незаполненных слотов с deep-link на карточку.

10. **Двухосевая маршрутизация (axis-classifier) — отдельный LLM-call или часть block-ingest?**
    **Решение: отдельный LLM-step.** Precision важнее cost — axis-classifier — это критичный шаг (если ошибся — блок улетел не в тот контейнер на месяцы). Делаем отдельный taskType `axis-classify` с дешёвой моделью (DeepSeek-flash или Ollama qwen3.5:9b как primary, OpenAI-mini secondary). Срабатывает после `block-ingest`, до `RouterService.dispatch`.

### 4.4. Из dialog-layer (6 вопросов)

1. **Документ про оркестратор сложных запросов — где он?**
   **Решение:** ещё не написан. Будет создан как часть δ-фазы (`δ-1` sub-ТЗ). Сейчас фиксируется только концепция в этом документе (Часть 3.2, Слой 5).

2. **Контекстуализация — отдельный модуль или внутри Chat-v2?**
   **Решение: отдельный модуль `dialog-layer`.** Логически: `DialogService` (контекстуализация + классификация + multi-query + summarizer) — это **препроцессор перед** `ChatV2Service` и **постпроцессор после**. Отделение даёт переиспользование dialog-layer'а для оркестратора и concierge-агента.

3. **Multi-query — нужны ли все 3 в каждом запросе?**
   **Решение: всегда 3.** Recall важнее cost — multi-query expansion это дёшево (один LLM-вызов на нём, мелкая модель). Для простых факт-запросов 1 запрос даёт recall 60-70%, три — 85-90%. На больших объёмах знаний разница критична. Скрутить до 1 — это premature optimization.

4. **Триггеры классификации (простой / сложный / неоднозначный) — LLM на каждом или эвристика?**
   **Решение: гибрид.** Эвристика на дёшево (длина < 60 символов + нет глаголов «сравни / подготовь / проанализируй» → простой; есть множественные сущности или сравнение → сложный). LLM-fallback только при неопределённости (`length 60-100` + неоднозначные слова). 70% запросов решает эвристика, 30% — LLM.

5. **Кэширование — final answer или retrieval?**
   **Решение: оба уровня.**
   - `AnswerCache` (Redis) — точный match по standalone-вопросу (после контекстуализации) + по `tenantId` + по `userId`. TTL 24 часа. Invalidation при изменении источников.
   - `RetrievalCache` (Redis) — query → blockIds[]. TTL 1 час. Invalidation при поступлении новых блоков связанной тематики.

6. **Confidence score — отдельный mini-step?**
   **Решение: да.** После контекстуализации — `confidence-estimator` мини-шаг (дешёвая модель, 100-200 токенов): «насколько уверенно ты восстановил вопрос». Score < 0.7 → ветка «уточнить у пользователя».

### 4.5. Из COO-dashboard (6 вопросов)

1. **Чек-ины обязательные или факультативные?**
   **Решение: факультативные с мягким probe.** Обязательные → формализм через 2 недели → мусор в графе. Probe от Probe-Agent через 3 дня молчания, мягко: «давно тебя не слышно — что было сегодня?». Без штрафов, без напоминаний бота.

2. **Декомпозиция целей `Goal.parentId` — каскад сразу или потом?**
   **Решение: каскад сразу.** Goal расширяется полями `parentGoalId?`, `decomposedAt`, `decomposedByUserId`. UI: дерево целей с draggable rearrange. Каждая под-цель привязана к Department/Role + KPI. Это базис для функции 3 COO.

3. **Карта коммуникаций — только чек-ин или + парсинг чатов / упоминаний?**
   **Решение: оба, но с консентом.** Базис — чек-ин «с кем работал плотнее всего сегодня» (раз в неделю). Расширение — парсинг встреч и in-app чата на упоминания и совместное участие (через `IdeaBlockEntity` с роль 'participant'). Парсинг внешних чатов (Telegram) — только если Org включил `settings.communicationGraphIncludeTelegram=true` в админке. Дефолт — выключено (приватность).

4. **Кому виден дашборд COO?**
   **Решение: отдельная RBAC-роль `coo` + по умолчанию owner/admin.** В RBAC добавляется ресурс `operations_dashboard`. Дефолт — read для owner/admin. Role `coo` (опц., назначается из админки) — то же read + write для caters mitigation actions. Member видит только свою часть.

5. **Категоризация причин сбоев — LLM автоматически или куратор?**
   **Решение: LLM ставит, куратор подтверждает (через α-4).** Insight → LLM-вызов `insight-categorize-cause` ставит `causeCategory` ∈ (`process`, `people`, `resources`, `task_formulation`) + `causeConfidence`. Если confidence < 0.7 — попадает в curation light review.

6. **Чек-ины «с кем работал», «решение принял сам» — не нарушает ли Skill-privacy?**
   **Решение: не нарушает, но разделяем хранилище.** Это операционные данные коммуникации, не персональные паттерны рассуждения. Хранятся в новой модели `DailyCheckIn` (не в SkillProfile). Используются для дашборда COO и Insights, не для clone-API. Skill-агент эти блоки **не читает** — только блоки с `signalType IN ('reasoning', 'rationale', 'decision_basis')`.

### 4.6. Из umbrella TZ (10 вопросов)

1. **Reasoning-extractor — один проход или два?**
   **Решение: один проход с расширенным prompt'ом** в `block-ingest`. Cost-оптимизация — два прохода удваивают LLM-биллинг на самом массовом шаге. Если качество reasoning-классификации < 0.8 на тестах — переходим на два прохода в γ.

2. **RouterService — статический mapping или LLM-routing?**
   **Решение: гибрид.** Статический mapping `signalType → specialists[]` для 90% случаев (быстро, дёшево, предсказуемо). LLM-routing `router-dispatch-llm` для unmatched signalType или блоков с двусмысленным контекстом (5-10%). LLM-routing возвращает top-3 кандидатов с confidence.

3. **MaxBotChannelAdapter — публичный API есть?**
   **Решение:** проверяется в β-1 после context7. Если API нет — реализуем через email-bridge или ждём. Не блокер для остальных каналов.

4. **SkillTraitCategory — отдельная модель или Text-поле?**
   **Решение: отдельная модель.** Это даёт merge/rename из админки + KNN-кластеризация для подсветки похожих категорий. `SkillTrait.categoryId FK SkillTraitCategory`.

5. **Decision.affectsEntityIds[] — массив или join-таблица?**
   **Решение: массив на старте, миграция на join-таблицу при performance issue.** Postgres array индексируется GIN, для нашего объёма (≤ 1000 решений на Org за год) хватает. Миграция при 10k+.

6. **ExecutablePersona — версионируется каждое изменение или раз в неделю?**
   **Решение: гибрид.** Snapshot еженедельно (cron, для consistency «клон Иванова отвечает одинаково всю неделю»). Внеочередной snapshot — при значимом изменении (≥ 3 новых traits с confidence high ИЛИ ≥ 1 mark_as_misleading critical). Активная persona — последний snapshot.

7. **Card-rollup-v2 для существующих типов — переписывается или deprecate?**
   **Решение: переписывается под §5 контракт.** Существующие 5 типов Card (`client`, `deal`, `project`, `topic`, `custom`) остаются, но воркер переходит на контракт специалиста. `custom` — депрекатим (миграция в `topic`).

8. **chat-v2 — отдельный модуль или переписывание chat/?**
   **Решение: отдельный модуль `chat-v2/`.** Старый `chat/` живёт параллельно до полной миграции; помечен `@deprecated`. UI постепенно переключается на chat-v2. Полная декомиссия — в δ.

9. **Каркас Фазы 0b — миграция данных в карточки Слоя 3?**
   **Решение: миграция (один раз) + adapter для PDF-extraction.** Каркас 0b остаётся как PDF/DOCX парсер (вход данных), но извлечённые сущности летят в карточки специалистов Слоя 3 (Regulation, Process), не в параллельные таблицы. Patch-script `migrate-phase-0b-to-specialists.ts` (one-off).

10. **evolving temporal queries в chat-v2— нужны?**
    **Решение: да, расширяем.** chat-v2 поддерживает temporal-фильтры `validAt: Date` в запросе («как мы продавали в марте 2026?»). Реализация в α-5: при retrieval из карточек с `evolving`-цепочкой — выбираем версию с `validFrom ≤ validAt ≤ validUntil`.

### 4.7. Из dialog-layer §5.6 (5 вопросов про оркестратор)

1. **Карта базы — статика-схема или on-demand?**
   **Решение: гибрид.** Статика-схема (Prisma-генерация + CardSpecialistRegistry) обновляется при изменении схемы (build-time). Динамические агрегаты (`OrgKnowledgeIndex`) — cron раз в день. On-demand для уточнений — оркестратор может запросить `index.refresh(scope)` если данные старше 4 часов.

2. **Глубина оркестрации — depth=1 или 2?**
   **Решение: depth=1 hard limit на MVP, opt-in depth=2 для admin.** Глубже 1 = риск бесконечной декомпозиции и financial blowup. Opt-in включается в `OrgSettings.orchestratorMaxDepth` (default 1, max 2, только owner может менять).

3. **Доступ к оркестратору — кому?**
   **Решение: owner + Org-Admin + role coo + opt-in member через quota.** Quota — отдельная entitlement (`orchestrator_calls_per_user_per_day`), default 5/день для member, ∞ для owner/admin/coo.

4. **Голосовой канал для директора через ASR — этот ТЗ или отдельный?**
   **Решение: отдельный трек.** Архитектурно поддерживается с γ (Channel.kind='voice_via_asr'). Реализация — отдельный sub-ТЗ `δ-3 Voice Channel`.

5. **Proactive-режим — часть оркестратора или отдельный агент?**
   **Решение: отдельный агент `ProactiveWatcher`** в Слое 6. Запускается cron'ом каждые 6 часов, проходит по графу, эмитит инициативные сообщения. Это **не реактив** (Probe реагирует на события специалистов), а **проактив** (сам ищет, о чём поговорить). Sub-ТЗ `δ-2 ProactiveWatcher`.

### 4.8. Новые решения по требованиям владельца этой сессии

1. **Концьерж-агент** — отдельный агент `ConciergeAgent`, виден в `Cmd+K` palette + плавающая кнопка-вход на каждой странице ЛК + отдельная страница `/assistant`. Знает структуру сервиса (страницы, агенты, разрешения) + умеет выполнять действия через tool-use (создать карточку, изменить статус, отправить отчёт). Деталь — Часть 5.

2. **Юнит-экономика и manual token pricing** — расширение админки. Поля input/output/cached price в LlmModelPrice, manual override в UI, дашборд cost-per-Org-per-month. Деталь — Часть 7.

3. **Zero-button каналы** — Telegram и MAX не имеют BotCommand'ов, inline_keyboard, callback_query. Только текст / голос (ASR) / документ. Деталь — Часть 6.

4. **User wiki** — отдельный документ `docs/user-guide/` для пользователя (не для программиста), на русском, простым языком. Будет создан агентом отдельно.

5. **Управление сервисом через агента** — Концьерж-агент имеет tool-use доступ к большинству REST-эндпоинтов (read + write для разрешённых ресурсов по RBAC). Пользователь может сказать «изучи тему X, сделай отчёт» — концьерж спавнит оркестратора (если у пользователя есть quota).

---

## Часть 5. Концьерж-агент — управление сервисом через диалог

### 5.1. Зачем

Современный сервис не должен заставлять пользователя искать «куда нажать». Пользователь говорит, что хочет — концьерж делает или объясняет.

Концьерж-агент — **сквозной UX-слой** в ЛК. Он знает:
- Структуру сервиса (страницы, разделы, что где найти).
- Состояние данных пользователя (мои встречи, мои задачи, мои probe-вопросы, мои сделки).
- Что умеют другие агенты (3.1-3.12, Probe, Proactive, COO).
- Как выполнить действие (через tool-use).

### 5.2. Где живёт

Три точки входа, **одинаковая логика**:

1. **Command palette `Ctrl+K` / `Cmd+K`** — открывается на любой странице. Поле ввода + история контекста (что было на странице).
2. **Плавающий значок в правом нижнем углу** — на каждой странице, всегда виден. Клик — открывает диалог в боковой панели (`<ConciergeSidebar>`).
3. **Отдельная страница `/assistant`** — full-screen диалог, для длинных сессий.

Все три используют один backend — `ConciergeService.ask({ userId, tenantId, query, contextPage, contextSelection })`.

### 5.3. Что умеет — три режима ответа

**Режим 1: Объясни (navigational).**
«Где найти регламенты?», «Что такое probe-вопрос?», «Куда нажать чтобы посмотреть мою историю?»
→ Концьерж читает свою внутреннюю **карту сервиса** (`ServiceMap` — генерируется при build, обновляется при изменении страниц / агентов / RBAC), отвечает с deep-link на нужную страницу.

**Режим 2: Сделай (actional).**
«Создай карточку клиента Сбер», «Поменяй статус идеи 47 на shipped», «Привяжи последнюю встречу к проекту Хорека», «Отправь моему руководителю отчёт по неделе».
→ Концьерж классифицирует запрос → находит подходящий tool → выполняет через REST-API → возвращает результат с подтверждением. Все действия — undoable (отмена одной кнопкой в чате).

**Режим 3: Исследуй (research).**
«Изучи, как мы работаем с клиентами enterprise-сегмента, сделай отчёт», «Подготовь сводку по всем срывам сроков за квартал».
→ Концьерж распознаёт сложный запрос → передаёт OrchestratorService (если у пользователя есть quota) → возвращает итоговый отчёт с источниками.

### 5.4. Tool-use схема

Концьерж работает по паттерну `tool_use` (как Claude Anthropic). Список tools:

```
navigation:
  - get_service_map(filter?) — список страниц/разделов с описанием
  - get_page_help(pageRoute) — что делать на этой странице
  - get_agent_help(agentName) — что умеет агент

read:
  - search.hybrid({query, filters}) — гибридный поиск по всему knowledge-core
  - cards.list({kind?, status?}), cards.get(id)
  - decisions.list({...}), decisions.get(id)
  - regulations.list({kind?, status?}), regulations.get(id)
  - insights.list({status?, severity?}), insights.get(id)
  - ideas.list({status?, kind?}), ideas.get(id)
  - persons.list({role?, department?}), persons.get(id), persons.getKnowledgeProfile(id)
  - skill_profile.get(personId) — RBAC-restricted
  - meetings.list({date?, type?}), meetings.get(id)
  - documents.list({tag?}), documents.get(id)
  - me.notifications(), me.probeHistory(), me.checkInHistory()

write (с подтверждением для destructive):
  - cards.create({...}), cards.update(id, {...}), cards.delete(id)
  - decisions.create({...}), decisions.update(id, {...})
  - ideas.create({...}), ideas.update_status(id, status)
  - meetings.link_to_card(meetingId, cardId)
  - regulations.create({...}), regulations.update(id, {...})
  - me.respond_to_probe(notificationId, text)
  - me.send_check_in({plan?, done?, blockers?, insights?})
  - reports.generate({type, params}) — генерация отчёта

orchestration (RBAC + quota):
  - orchestrator.run({task, scope}) — для сложных research-задач
```

Tool-use промпт описывает условия использования каждого tool'а. LLM сам выбирает. Tier provider'а — primary (capable, например DeepSeek-V4 или Claude-4.6) с fallback.

### 5.5. Контекстуализация концьержа

Концьерж знает:
- **Куда смотрит пользователь** — текущая страница (route), выделение в редакторе (`contextSelection`), активная карточка.
- **Кто пользователь** — роль, отдел, недавно открытые карточки (за день), активные probe-вопросы.
- **Состояние организации** — сжатая карта базы (OrgKnowledgeIndex), top активных Insight'ов, последние решения.

Промпт инжектится `ConciergeContextBuilder` (~1.5k токенов).

### 5.6. Запрет на дублирование

Концьерж — это **не chat-v2**. Разделение:
- chat-v2 = **знание компании** (что внутри компании произошло, кто что решил, какие регламенты).
- concierge = **знание про сервис + действия в сервисе** + маршрутизация в chat-v2 для контентных вопросов.

Если пользователь спрашивает «что мы знаем про Сбер» — концьерж распознаёт content-query → передаёт chat-v2 → возвращает ответ из него.

### 5.7. UI-детали

- Стиль — плавающий чат-окно как в Intercom, но более минималистичный (mint-accent дизайн-системы Z).
- Сообщения — markdown с поддержкой `[card:id]`, `[meeting:id]`, `[regulation:id]` — кликабельные ссылки на сущности.
- Любое выполненное действие — карточка с `Undo` (5 минут).
- Голосовой ввод — `Hold to talk` (в `Cmd+K` тоже).
- Avatar concierge'а — нейтральный, sub-text «Кора-помощник».

### 5.8. Метрики

- `concierge_queries_total{intent, success}` (counter)
- `concierge_tool_use_total{tool, success}` (counter)
- `concierge_quota_blocked_total{userId}` (counter — research-quota)
- `concierge_query_duration_seconds{intent}` (histogram)
- `concierge_undo_total{tool}` (counter — индикатор плохих авто-действий)

---

## Часть 6. Каналы связи — zero-button подход

### 6.1. Принцип

**Никаких кнопок ни в каком мессенджере.** Каналы — это **естественно-языковой интерфейс**. Сотрудник пишет текст / голос / документ — Кора понимает и реагирует. Кора пишет текст — сотрудник отвечает текстом.

Бекофис (in-app web-UI ЛК) может иметь кнопки и формы (но и там — Принцип 1, минимум ручного). А мессенджеры — нет.

### 6.2. Почему

1. Кнопки в Telegram = командное мышление, которое умирает быстро (через 2 недели пользователь не помнит, какая кнопка что делает).
2. Inline_keyboard убивает контекст диалога — сообщение «нажал кнопку X» не имеет смысла.
3. Slash-команды — не natural language. «/myideas» — пользователю надо помнить эту команду. Естественно сказать «покажи мои идеи».
4. Голос (через ASR) → текст → агент его поймёт.
5. Документ → ingest → агенты разберут.

### 6.3. Что разрешено

Минимальный набор «технических» элементов в боте:

- **Один BotCommand `/start <linkCode>`** — только для линковки аккаунта при первом контакте.
- Никаких других BotCommand'ов в menuButton (`setMyCommands` оставляем пустым после линковки).
- Никаких `reply_markup` с кнопками.
- Никаких `callback_data`.

### 6.4. Что должно быть

**Inbound (от пользователя в бот):**
- Текст любой длины → передаётся в `axis-classifier` → `RouterService` → попадает к нужному специалисту.
- Голосовое сообщение → `ASR-pipeline` (Vox/GigaAM) → текст → как выше.
- Документ (PDF / DOCX / TXT / MD / изображение с OCR) → `document.adapter` → ingest → агенты.
- Repliy на сообщение бота (треды) → треки контекст для DialogService.

**Outbound (от Коры в бот):**
- Текст (markdown, поддержка `[ссылок](https://...)` на ЛК для deep-link'ов).
- Голосовое (TTS, опц. в γ+) — для proactive-сообщений когда руки заняты.
- Документ (генерируемый отчёт PDF — например, отчёт по встрече).
- Никаких inline-кнопок. Если нужно действие — пишем «Ответь "да" чтобы подтвердить» (естественный язык).

### 6.5. Onboarding (линковка аккаунта)

Сейчас существующий flow — `/start <code>` где код берётся из ЛК. Это **сохраняется**, минимальное:

1. Пользователь в ЛК → `/me/channels` → «Привязать Telegram» → генерируется одноразовый код (формат `Z-XXXX-YYYY`, TTL 10 минут).
2. Бот предлагает deep-link `https://t.me/{бот}?start=Z-XXXX-YYYY`.
3. Пользователь жмёт ссылку → попадает в чат → автоматический `/start` отправляется.
4. Бот линкует, отвечает естественно: **«Привет, Иван! Ты подключил Telegram к Коре. Просто пиши мне — текстом, голосом или присылай документы. Я разберу и передам куда нужно.»**

Это **единственный** /start. Дальше — никаких команд.

### 6.6. Особые сценарии

**Сценарий «покажи мои идеи».**
Пользователь: `покажи мои идеи`
Бот: `→` распознаёт через DialogService → ConciergeService.askForUser → tool `ideas.list({createdBy=me, status!=archived})` → возвращает текстовый список с `Z-deep-link`'ом.

**Сценарий «у меня идея — давай добавим к BizDev стратегии».**
Пользователь: `у меня идея — давай переименуем тариф enterprise в "Кора Pro+"`
Бот: ничего не спрашивает (никаких кнопок «это идея?» / «куда сохранить?»). Просто транзита → `block-ingest` ставит `signalType='idea'` → специалист 3.6 создаёт `Idea` → бот отвечает: **«Записал. Идея №147 «переименовать enterprise в Pro+». Подсветил её в твоём списке идей: [открыть в Коре](...).»**

**Сценарий probe-вопроса.**
Кора (бот): `Иван, ты вчера в встрече с Хорекой упомянул "посмотрим в финале". Это касается какой задачи — лендинг под Q4 или редизайн админки?`
Пользователь отвечает текстом: `лендинг под Q4` → ответ улетает в ingest как `RawEvent` с `respondsToNotificationId` → специалист дописывает контекст в карточку.

Никаких кнопок «лендинг / редизайн» в боте.

### 6.7. Что нужно убрать из существующего кода и планов

(Эту секцию финализирую после отчёта Telegram-аудит-агента; здесь только структурный список.)

- Из `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md` — выкинуть упоминания «Inline-кнопки, диалоговые формы, slash-commands (`/ask`, `/note`, `/idea`, `/status`, `/myideas`, `/link`)». Оставить только `/start`.
- Из `plans/tz/2026-05-21-telegram-employee-channel.md` — пересмотреть на zero-button.
- Из второго мозга `01_projects/conversational-channels.md` — убрать упоминания slash-команд.
- Из `01_projects/ideas.md` — фраза «Telegram `/myideas` теперь функциональна» → «понимание запроса "покажи мои идеи" через DialogService».
- В коде (если уже реализовано) — миграция: убрать `setMyCommands`, убрать `reply_markup`, убрать callback_query handler'ы, всё проходит через text-handler + DialogService.

### 6.8. Голосовой ввод как первый класс

Голос — это **не add-on**, а **первый класс**. Многие пользователи (особенно из e-commerce / производства / руководители на ходу) будут наговаривать голос.

Pipeline голоса:
1. Telegram voice message → URL → бот скачивает.
2. → ASR (Vox / GigaAM) → текст.
3. Дальше — как text input.
4. В ответе боту — опционально TTS (γ+).

Качество ASR — критично. Используем те же модели, что для транскрипции встреч.

---

## Часть 7. Админка моделей и юнит-экономика

### 7.1. Требования владельца (этой сессии)

1. Я (как владелец) должен иметь возможность **менять любую LLM-модель из админки**, без выкатки кода.
2. Я должен **проставить стоимость за токены вручную** (в рублях / долларах).
3. На основе этих стоимостей я должен **видеть свою юнит-экономику** — сколько мы тратим на одного клиента в месяц.

### 7.2. Текущее состояние (будет уточнено отчётом subagent'а)

В текущем коде уже есть:
- `LlmModelPrice` модель (версионируемая прайс-карта).
- `AiUsageLog` (логи вызовов с `cachedTokens`, `sourceRef`, `experimentGroup`).
- `LlmRouter` с поддержкой `taskType → tier (primary/secondary/tertiary)`.
- Phase 7 admin план с аналитикой стоимости.
- Phase A (Prompt Registry) — версионируемые промпты из БД.

Чего нет (моя оценка до отчёта subagent'а):
- Полноценной admin-страницы для CRUD моделей (`LlmModel` как сущность, не enum).
- Manual override price из UI с историей изменений.
- Дашборда «себестоимость на Org в месяц».
- Алертов превышения лимита.
- Сравнения «себестоимость × тариф = маржа».

### 7.3. Целевая модель данных (расширение)

```
LlmProvider (новая):
  id, name (deepseek|openai|gigachat|ollama|anthropic|custom),
  endpoint, authType, apiKeyEnvVar (имя ENV, не сам ключ),
  isActive, supportedDataClasses[], notes

LlmModel (новая):
  id, providerId → LlmProvider, modelName (например 'deepseek-chat-v4-flash'),
  contextWindow, maxOutputTokens,
  supportsTools, supportsJsonMode, supportsCaching, supportsVision,
  isActive, createdAt, deprecatedAt?,
  notes (markdown, описание модели)

LlmModelPrice (расширение):
  id, modelId → LlmModel, currency ('USD'|'RUB'),
  inputPricePer1M Decimal(12,4),    -- цена за 1M input токенов
  outputPricePer1M Decimal(12,4),
  cachedInputPricePer1M Decimal(12,4)?,  -- cache hit (DeepSeek/Anthropic дешевле)
  embeddingPricePer1M Decimal(12,4)?,
  validFrom, validUntil?, sourceNote (где взяли цену, URL),
  createdByUserId (кто внёс)

LlmTaskRoute (расширение):
  +tier (primary|secondary|tertiary), +priority,
  +maxLatencyMs?, +maxDataClass

AiUsageLog (расширение):
  +modelId FK LlmModel (вместо строкового modelName),
  +priceId FK LlmModelPrice (snapshot цены на момент вызова),
  +costRub Decimal(12,6) (вычисленная стоимость в рублях),
  +costUsd Decimal(12,6),
  +tier (primary|secondary|tertiary использованный),
  +fallbackUsed boolean

CostAggregateDaily (новая):
  date, tenantId, taskType, modelId, providerId,
  callCount, inputTokens, outputTokens, cachedInputTokens,
  costRub Decimal(14,4), costUsd Decimal(14,4)
  -- агрегируется кроном раз в день

OrgUnitEconomics (новая):
  tenantId, periodYearMonth ('2026-05'),
  llmCostRub, llmCostUsd, storageCostRub, infraCostRub,
  totalCostRub, tariffRevenueRub, marginRub, marginPercent,
  computedAt
  -- обновляется кроном раз в день, snapshot месяца
```

### 7.4. Целевые страницы админки

**Для Z-Admin (super_admin):**

1. **`/admin/llm/providers`** — список провайдеров (DeepSeek, OpenAI, GigaChat, Ollama). CRUD. Каждый — endpoint, auth, isActive, list of supported models.
2. **`/admin/llm/models`** — список моделей. CRUD. Поля: provider, modelName, contextWindow, supports*, isActive, notes. Кнопка «Тест connectivity» (вызов с тестовым промптом). Кнопка «Запустить smoke-test» (как verified-карта).
3. **`/admin/llm/prices`** — таблица цен. Колонки: модель, валюта, input/output/cached/embedding, validFrom, validUntil, источник. Кнопка «Добавить цену» (создаёт новую версию, не перетирает). История изменений.
4. **`/admin/llm/task-routes`** — таблица маршрутов. Для каждого taskType цепочка primary/secondary/tertiary. Drag-and-drop переключение. Кнопка «A/B-тест» (вкладка «Эксперименты»).
5. **`/admin/llm/usage`** — usage dashboard. Фильтры: dateRange, tenantId, taskType, model, tier. Метрики: calls, tokens (input/output/cached), cost in RUB/USD. Графики: cost over time, cost by tenant, cost by taskType. Top-10 most expensive queries.
6. **`/admin/llm/experiments`** — A/B-тесты. Создание: выбрать taskType, два варианта routing, split %. Live-результаты: cost / latency / success rate / quality proxy.
7. **`/admin/economics`** — юнит-экономика. Главная страница для super_admin:
   - Месячный отчёт: total LLM cost, by Org, by taskType.
   - Сравнение «cost per Org / tariff per Org / margin» — таблица.
   - Org-level: затраты по специалистам (3.1 / 3.2 / ... / 3.12), по слоям (Слой 1 / 4 / 5).
   - Алерты: «Org X превысил $50 в этом месяце», «cost вырос на 30% за неделю».
   - Прогноз cost на конец месяца (linear extrapolation).
   - Export в CSV / Excel.

**Для Org-Admin (owner / admin Org'и):**

1. **`/admin/org/llm-usage`** — usage только своей Org. Те же метрики, но без cross-Org.
2. **`/admin/org/economics`** — мой Org: сколько потратили этот месяц, история, прогноз.

### 7.5. Кроны и воркеры

- `CostAggregatorCron` (раз в день в 02:00) — пробегает `AiUsageLog` за вчера, агрегирует в `CostAggregateDaily`.
- `OrgEconomicsCron` (раз в день в 03:00) — обновляет `OrgUnitEconomics` за текущий месяц.
- `CostAlertCron` (раз в час) — проверяет правила алертов из `CostAlertRule`, отправляет нотификации owner/admin через channels.

### 7.6. Метрики Prometheus

- `cost_per_org_rub{tenantId, month}` (gauge)
- `cost_per_tasktype_rub{tenantId, taskType, month}` (gauge)
- `tokens_total{tenantId, model, tier, kind=input|output|cached}` (counter)
- `cache_hit_ratio{model}` (gauge)
- `margin_per_org_rub{tenantId, month}` (gauge)

### 7.7. Связь с тарифами клиентов

Поле `Org.tariffPlanId FK TariffPlan` — уже есть в системе тарифов. `OrgUnitEconomics.tariffRevenueRub` берётся из `TariffPlan.pricePerMonthRub`. `marginRub = revenue - totalCost`. Это даёт владельцу прямой ответ «сколько мы зарабатываем на Сбере в этом месяце».

### 7.8. Кросс-проверка с playbook

В админке `/admin/llm/models` и `/admin/llm/task-routes` — ссылка на `docs/reference/llm-models-playbook.md` (методология бенчмарка) и `second-brain/01_projects/llm-providers-verified.md` (verified-карта). При добавлении новой модели — кнопка «Прогнать smoke-test» (как в playbook).

---

## Часть 8. Что мы НЕ ломаем

### 8.1. LiveKit и встречи — священная корова

Архитектура встреч **не меняется**:
- LiveKit Server (SFU) — медиа.
- LiveKit Egress — запись (общая + аудиодорожки на каждого участника).
- Отдельный TURN на другой ноде.
- Backend генерирует токены, гость не получает секреты.
- AI-pipeline (транскрипция → разделение спикеров → шаблон отчёта по типу) работает как есть, но теперь как один из источников Слоя 0.
- 9 типов встреч MVP остаются.
- Шаблоны AI-отчёта по типу остаются (см. `01_projects/ai-analysis-by-type.md`).
- Все 5 sub-ТЗ competitor-parity (A-Prompt Registry, B-Behavior Metrics, C-Quality Score, D-Transcript Cleaning, E-Multi Reports) остаются в плане.

Что **добавляется**: после встречи `meeting.adapter` отправляет блоки в новый pipeline через `Source → RawEvent → block-ingest` с расширенным `signalType`. Карточки специалистов (Decision, Insight, Regulation, ...) получают встречу как один из источников.

### 8.2. Текущее ядро knowledge-core (Фазы 1-4)

Не меняется:
- `IdeaBlock` + `Entity` + `IdeaBlockEvidence` + `IdeaBlockLink` + `EntityLink` + `Theme`.
- pgvector HNSW + tsvector GIN индексы.
- Гибридный поиск (cosine + BM25) через `search.service.ts`.
- block-ingest.worker, block-distill.worker, entity-resolver.worker, block-linker.worker, theme-clusterer.cron, reframing.cron.
- card-rollup-v2.worker (расширяется до §5 контракта в α-6).

Что **добавляется**:
- Расширение `signalType` enum (см. Слой 1).
- Расширение `Entity.type` enum (12+ значений).
- Новые модели специалистов.
- Axis-classifier и RouterService (новые шаги в pipeline).

### 8.3. Существующие интеграции

Не ломаем:
- Crossmark integration (через API).
- Public REST API (для интеграторов).
- Webhook events (`card.created/updated/deleted`, `meeting.linked_to_card/unlinked`).
- Auth (argon2id, UserSession+jti, mail.hosting.reg.ru SMTP).
- Multi-tenancy (Org / Membership / TenantGuard / X-Org-Id).
- RBAC (Casbin-совместимый, policy.csv).

### 8.4. Существующие UI

Не выкидываем — постепенно расширяем:
- Все 28 existing страниц в `(authenticated)/` остаются.
- AppShell, dark-first дизайн, mint accent.
- Master-detail паттерн.
- LiveKit React Components.

Где **upgrades**:
- Появление концьерж-агента (Cmd+K + floating + `/assistant`).
- AI-suggestion слой в формах (см. Принцип 1).
- Расширение Director Dashboard виджетами (maturity, Insights top, communication graph).
- Новая страница `/maturity`.
- Новая страница `/assistant`.
- Новая страница `/economics` (для owner/admin Org'и) и `/admin/economics` (для Z-Admin).

---

## Часть 9. Метрики продукта — как поймём, что работает

### 9.1. Леaдерные показатели качества знаний

- **Maturity Score per Org** — `completed slots / declared slots` по всем нормативным узлам. Цель: ≥ 0.6 через 90 дней после внедрения, ≥ 0.85 через год.
- **Provenance coverage** — % карточек, у которых каждое утверждение имеет `sourceBlockId`. Цель: 100% для critical-types (Regulation/Process/Decision).
- **Curation throughput** — среднее время от создания карточки до канонизации. Цель: ≤ 24 часа для light review.
- **Conflict resolution time** — от создания ConflictItem до resolve. Цель: ≤ 72 часа.

### 9.2. Удовлетворённость пользователей

- **chat-v2 NPS** — после каждых N ответов на сессию — короткий «помогло?» (1 кнопка в UI, никаких кнопок в боте — там голосование текстом).
- **Probe response rate** — % probe-вопросов, на которые получен ответ в течение 7 дней. Цель: ≥ 50%.
- **Concierge action success rate** — % действий через concierge, выполненных без отмены. Цель: ≥ 90%.

### 9.3. Юнит-экономика

- **Cost per Org per month** — total LLM + storage + infra cost / Org.
- **Margin per Org per month** — revenue − total cost.
- **Cost per active user per month** — total cost / DAU.
- **LLM fallback rate** — % запросов, ушедших в secondary/tertiary. Цель: ≤ 5% в secondary, ≤ 0.5% в tertiary.

### 9.4. Стабильность

- **Pipeline lag** — от меetinga до канонизации Decision. Цель: ≤ 30 минут.
- **AI agent error rate** — % вызовов LLM с ошибкой. Цель: ≤ 0.5%.
- **Probe spam complaints** — индикатор перенасыщения. Цель: 0.

### 9.5. Бизнес-метрики

- **Time-to-first-value** — от регистрации до первого «полезного ответа от Коры». Цель: ≤ 24 часа.
- **D7 / D30 retention** для Org-admin.
- **Adoption of channels** — % member'ов Org, подключивших Telegram.

---

## Часть 10. Что меняется по сравнению с зонтичным ТЗ 2026-05-21

Сводная таблица главных дельт. Полный список — в Части 3.3.

| Категория | Где меняется | Деталь |
|---|---|---|
| Онтология | расширение | 4 оси вместо 2 (CONTEXTUAL + TEMPORAL явные) |
| Агенты Слоя 3 | расширение | 12 вместо 7 (+ Role Map, Experiment, Brand Voice, PersonalRelation, Company/Department Profile) |
| Слой 6 | расширение | 4 агента (Probe + Proactive + COO + Concierge) вместо 1 |
| Слой 5 | расширение | DialogService препроцессор (контекстуализация + multi-query + классификация + summarizer) |
| Фазы | расширение | + δ-фаза (оркестратор, проактив, voice, decommission legacy chat) |
| Каналы | сужение | zero-button — никаких inline_keyboard / slash-команд кроме `/start` |
| Админка | расширение | LLM CRUD + manual pricing + юнит-экономика дашборд |
| UI | расширение | Concierge agent сквозной + страница `/maturity` + страница `/assistant` + `/economics` |
| Принципы | формализация | 8 принципов как блокеры выпуска (Часть 2) |
| Решение vs DecisionPolicy vs DecisionPoint | разделение | 3 разных объекта |
| Artifact ≡ Asset | объединение | 1 модель с useCase[] |
| BrandVoice | переосмысление | derived, не первичный |
| Handoff | переосмысление | ребро между процессами, не вложение |
| ProcessTemplate / Version / Instance / Task | разделение | 4 слоя вместо 1 |
| FunctionalDomain | новое | дерево с авто-расширением + 8 базовых + per-industry seed |
| CompanyProfile | новое | first-class node со слотами |
| Department | новое | отдельная модель с IOrganizationalUnit интерфейсом |
| Maturity Indicator | новое | first-class, виджет + страница |
| Inкрементальная сборка нормативки | формализация | `completeness 0..1` + автоматические probe |
| Experiment ↔ Insight ↔ Decision FSM | новое | явные переходы между моделями |
| evolving temporal в chat-v2 | расширение | поддержка `validAt` фильтра в запросе |
| Concierge agent | новое | сквозной UX-слой |
| Юнит-экономика | новое | дашборды + manual pricing + per-Org cost |

---

## Часть 11. Что дальше (после согласования)

### Визирование владельца — зафиксировано 2026-05-23

Владелец продукта (sergrv80@gmail.com) одобрил документ целиком, без правок. Зафиксированные подтверждения:

1. **Не урезаем скоп** — все 24 sub-ТЗ в 4 фазах (α/β/γ/δ).
2. **Telegram zero-button rip-out** — выполняется сейчас (β-1), удаляем `command-handler.service.ts`, BotCommand'ы кроме `/start`, inline_keyboard, callback_query.
3. **Concierge Agent (γ-2)** — реализуется сейчас как сквозной UX-слой кабинета.
4. **δ-фаза (Orchestrator + Proactive + Voice)** — реализуется сейчас, не откладывается.
5. **4 оси знания и 12 специалистов Слоя 3** — принимаются как целевая архитектура.
6. **Юнит-экономика (α-10)** — реализуется сейчас, с уточнением: прайс моделей должен иметь **кодовый source of truth** (отдельный модуль/файл LLM-каталога с моделями и ценами), из которого данные **поставляются** в БД (seed) и далее видны на админ-странице. Это даёт версионирование цен в git + единую точку правды + работающий fallback, если БД пуста. Деталь — в `plans/tz/2026-05-22-final-roadmap.md` §9.6 (новый параграф).
7. **Все 50+ ответов в Части 4 (4.1-4.6)** — приняты целиком.

**Статус документа:** `approved` (был `draft`). Парный roadmap (`plans/tz/2026-05-22-final-roadmap.md`) переведён в `approved` тем же актом.

### Следующие шаги (исполнитель: оркестратор)

Дальше владелец фиксирует визу и пока ничего не делает. Подготовка к реализации (НЕ запускается без отдельного разрешения):

1. Архивирование заменённых sub-ТЗ от 2026-05-21 (`plans/archive/`), синхронизация ссылок в `second-brain/`.
2. Реалити-чек: 37 новых моделей × фактический `backend/prisma/schema.prisma` → точная DDL-дельта.
3. Развёртывание sub-ТЗ α-фазы в полные ТЗ-файлы (10 документов, начиная с α-1/α-2/α-10 — параллельно по графу Приложения C).
4. Решение точек слияния (`schema.prisma`, `policy.csv`, AppShell-навигация, seed taskType'ов) — выделить «хранителей файлов».
5. Только после п.1–4 — запуск агентов на код по фазам.

---

## Приложение A. Полный список sub-ТЗ финальной раскладки

Реструктурированная карта 20+ sub-ТЗ (вместо 13 из зонтичного 2026-05-21). Детали — в `plans/tz/2026-05-22-final-roadmap.md`.

### Фаза α — устойчивый двигатель (10 sub-ТЗ)

- **α-1.** Conversational Channels Foundation (in_app + email) — **zero-button** уточнение
- **α-2.** Layer 1 — Marking Extension (signalType +25 значений, reasoning-extractor)
- **α-3.** Layer 2 — Ontology Extension (12+ Entity types, Vendor, Event, Market, OrgUnit, axis-classifier, RouterService)
- **α-4.** Layer 4 — Curation Foundation (triage, ConflictItem, evolving, ConsistencyChecker, CardVersion, completeness)
- **α-5.** Layer 5 — Chat-v2 + DialogService (контекстуализация + классификация + multi-query + summarizer + evolving temporal)
- **α-6.** Specialist 3.4 — Project/Customer Context (рефернс §5)
- **α-7.** Specialist 3.1 — Regulations & Process Templates (Regulation, ProcessTemplate, ProcessTemplateVersion, ProcessStep, ProcessHandoff с ребром)
- **α-8.** Specialist 3.8 — Role Map Builder + Phase 0 поглощение (карта должности 9+ слотов, ResponsibilityElement с kind, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, KPI, Interaction)
- **α-9.** Specialist 3.12 — Company & Department Profile (CompanyProfile, Department, FunctionalDomain дерево + база-затравка + авто-расширение, IOrganizationalUnit interface, Maturity Indicator first-class)
- **α-10.** Admin LLM management + Unit Economics (LlmProvider, LlmModel, расширенный LlmModelPrice, manual override UI, CostAggregateDaily, OrgUnitEconomics, страницы `/admin/llm/*` + `/admin/economics`)

### Фаза β — социальные специалисты + петля + операционка (8 sub-ТЗ)

- **β-1.** Channels — Telegram + MAX (zero-button)
- **β-2.** Specialist 3.2 — Knowledge Clone
- **β-3.** Specialist 3.3 — Decisions Registry (+ DecisionPoint, + Decision.appliedPolicyId связь)
- **β-4.** Specialist 3.5 — Insights Radar + Insight↔Experiment↔Decision FSM
- **β-5.** Specialist 3.6 — Ideas Collector + Layer 6 Probe Agent (выпускаются парой)
- **β-6.** Specialist 3.9 — Experiment Tracker
- **β-7.** Specialist 3.10 — Brand Voice Curator (Document расширение useCases[] + BrandVoiceProfile derived)
- **β-8.** Specialist 3.11 — Personal Relation Graph + Appointment + COO Operations Dashboard + DailyCheckIn (+ Goal.parentId каскад)

### Фаза γ — мышление + видимая институциональная память (3 sub-ТЗ)

- **γ-1.** Specialist 3.7 — SkillProfile + ExecutablePersona + Clone API
- **γ-2.** Concierge Agent (сквозной UX-слой, command palette, floating, `/assistant`, tool-use схема)
- **γ-3.** CrossFunctionalProcess + Handoff Tracker (β-9 из company-gap, переименован для линии γ — нужны зрелые ProcessTemplate'ы и сильный Maturity indicator)

### Фаза δ — оркестрация и автономия (3 sub-ТЗ)

- **δ-1.** Orchestrator Agent + Org Knowledge Index (для сложных research-запросов от концьержа и chat-v2)
- **δ-2.** Proactive Watcher (автономно мониторит граф, эмитит инициативные probe-сообщения)
- **δ-3.** Voice Channel (voice_via_asr inbound + TTS outbound через каналы)

### Карта зависимостей

```
α-1 (channels) → α-4 (curation needs channels for probe) → α-5 (chat-v2 omnichannel)
α-2 (signalType) → α-3 (router needs signal types)
α-3 (entities + router) → α-6, α-7, α-8, α-9 (специалисты нуждаются в router)
α-4 → все специалисты
α-10 (admin LLM) — параллельно, нужен для seed-LLM-task-routes каждого специалиста

β-1 (channels) — требует α-1 (foundation)
β-2 / β-3 / β-4 / β-5 / β-6 / β-7 — требуют α (полная)
β-8 (PersonalRelation + COO) — требует α (полная) + β-5 (Probe для чек-инов)

γ-1 (SkillProfile) — требует β (полная)
γ-2 (Concierge) — требует α (полная)
γ-3 (CrossFunctional) — требует α-7 + α-9 + γ-1

δ-1 (Orchestrator) — требует γ-2 (Concierge spawns)
δ-2 (Proactive) — требует γ-1 + δ-1
δ-3 (Voice) — параллельно с δ-2
```

---

## Приложение B. Кому что показывать (RBAC обзор)

| Роль | Видит | Не видит |
|---|---|---|
| super_admin (Z) | всё кросс-Org: usage, economics, models | — |
| owner (Org) | всё в своей Org: economics, все карточки, все skill-профили подчинённых | другие Org'и |
| admin (Org) | то же, что owner | то же, что owner |
| coo (Org, опц. роль) | operations dashboard, insights, regulations, чек-ины всех | skill-профили (только своих прямых подчинённых) |
| direct_manager (computed по Appointment) | skill-профили своих прямых подчинённых, их чек-ины (агрегированные) | skill-профили вне линии подчинения |
| member | свой /me/clone, свои probe-вопросы, общие карточки (Regulation/Decision/Process/Insight/Idea канонические), chat-v2 в org-scope | skill-профили других, чек-ины других |
| curator (per ResourceType, опц.) | очередь curation для назначенного типа, всё связанное | права за пределами назначения |
| external (Person.relationship='external') | ничего автоматического | всё |

---

## Приложение C. Архитектурные блокеры выпуска (DoD product-level)

Это финальные правила «когда продукт можно показывать клиенту». Нарушение — блокер.

- [ ] Все 8 принципов (Часть 2) проходят аудит на каждой странице ЛК.
- [ ] Каналы (in-app, email, telegram, MAX) — все zero-button (никаких inline_keyboard / slash-команд кроме `/start`).
- [ ] Concierge доступен из Cmd+K на любой странице ЛК.
- [ ] LiveKit pipeline (встречи) не сломан — все 9 типов работают, AI-pipeline даёт отчёт.
- [ ] chat-v2 поддерживает temporal queries (`validAt`).
- [ ] Все critical-карточки (Regulation/Decision/Process) имеют sourceBlockId на каждое утверждение.
- [ ] Probe response rate ≥ 50% на тестовой Org.
- [ ] Maturity Score ≥ 0.5 на тестовой Org через 30 дней использования.
- [ ] Юнит-экономика дашборд показывает cost per Org per month.
- [ ] Для каждого taskType зарегистрирована тройная LLM-цепочка primary/secondary/tertiary с tertiary=local Ollama.
- [ ] User wiki (`docs/user-guide/`) доступна и валидна (тест на новом пользователе — может понять «куда нажать» из wiki).

---

_Создан: 2026-05-22 (сессия консолидации). Финальная архитектура продукта Кора v2. Синтез 5 analysis-документов сессии + зонтичного ТЗ + новых требований владельца. Заменяет зонтичное ТЗ 2026-05-21 как точку правды._

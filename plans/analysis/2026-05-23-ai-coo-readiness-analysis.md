---
type: analysis
status: draft
feature: AI-COO readiness — что готово в коде / что нужно доделать под концепцию «второй мозг для операционного директора»
date: 2026-05-23
author: claude (по запросу владельца «сделать gap-анализ концепции COO-дашборда»)
related:
  - plans/tz/2026-05-22-final-roadmap.md
  - plans/analysis/2026-05-22-code-reality-deltas.md
  - plans/analysis/2026-05-22-unified-product-architecture.md
  - plans/analysis/2026-05-23-positioning-research-v2.md
  - second-brain/06_marketing/positioning.md
---

# AI-операционный директор — анализ готовности (что есть в коде vs что нужно доделать)

> **Назначение.** Сопоставление концепции владельца «Второй мозг для COO» (дневная/недельная сводка + утренние/вечерние чек-ины) с реальным состоянием кода и планом Коры v2. Отвечает на вопрос: «что у нас уже готово, что нужно дописать, чтобы агент работал как операционный директор и выполнял 7 структурных функций COO».
>
> **Контекст.** Владелец принёс концепцию COO-дашборда (форматы чек-инов, дневная/недельная сводка, 7 структурных функций операционного директора) и попросил структурный gap-анализ. Концепция — wedge B+E из [позиционирования v2](2026-05-23-positioning-research-v2.md), частично пересекается с зафиксированным sub-ТЗ β-8.

---

## TL;DR

1. **70-80% инфраструктуры уже в коде.** Каналы доставки чек-инов, knowledge-core с pipeline ingest → IdeaBlock → Entity → Theme, специалисты Слоя 3 (Decisions/Insights/Regulations/Project-Customer), Probe Agent, Curation, RBAC, Employee Clones — всё работает.
2. **Концепция владельца ≈ sub-ТЗ β-8 (PersonalRelation + COO Operations Dashboard + DailyCheckIn) + доделки β-4/α-2.** Главный недостающий блок — именно β-8 (15% done).
3. **Минимальный MVP «AI-COO» = 3 must-have пункта:** β-8 целиком + α-2 доделка signalType (6 типов для чек-инов) + β-4 доделка `causeCategory`.
4. **5 открытых решений** до старта реализации (см. часть 4).

---

## Часть 1. Mapping 7 функций COO ↔ что реально в коде

Использован аудит из [code-reality-deltas.md](2026-05-22-code-reality-deltas.md) (2026-05-23) + список модулей backend (`backend/src/modules/`) + список страниц frontend (`frontend/app/`).

### Функция 1. Команда и структура (оргструктура, зоны ответственности, дублирование)

| Уже в коде | Готовность | Gap |
|---|---|---|
| `Department`, `/structure` страница | done | — |
| `Role` + `RoleProfile` + `RoleProfileAgent` (BullMQ-воркер, cron каждые 4 часа, авто-карта должности из observed-данных) | done (5-полевая JSON-схема) | нормализация (α-8) |
| `/persons`, `/roles`, `/me/clone`, `/persons/[id]/skill-profile`, `/roles/[id]/skill-profile` | done | — |
| `PersonRole` с `validFrom/validTo` | done | переименовать в `Appointment` + `loadPercent, status, departmentId` (α-8) |
| **Employee Clone** (γ-1 SkillProfile + ExecutablePersona + Clone API) — что человек знает + как думает | **done** | — |
| `RBAC` + Casbin policy.csv | done | — |

**Чего не хватает:**
- **α-8 Role Map Builder (35% done)** — 5 нормализованных таблиц: `ResponsibilityElement`, `AuthorityBoundary`, `RequiredKnowledge`, `DecisionPolicy`, `Interaction`. Сейчас всё в `RoleProfile.summaryCache Json` — поиск дублирования и пробелов невозможен.
- **α-9 Company Foundation (25% done)** — `CompanyProfile`, `FunctionalDomain` (дерево с авто-расширением), `DepartmentDomainLink`, `MaturityScorerCron`. Без этого COO не видит зоны без покрытия отделом.
- **CompletenessSlot** (α-4 доделка) — first-class модель «незаполненный обязательный слот» — прямо отвечает на «где в структуре пробелы».
- **ConsistencyCheckerCron** (α-4 доделка) — раз в 4 часа сканирует граф на дубли/несостыковки (роль без процесса, шаг без ответственного и т.д.).

### Функция 2. Процессы и работа (узкие места, перевод с героизма на систему)

| Уже в коде | Готовность | Gap |
|---|---|---|
| `Regulation`, `Process`, `ProcessStep`, `Policy`, `Tool`, `Metric` модели | partial (60%) | 4 новые модели (см. ниже) |
| `specialist-3-1-regulations` (α-7) — автогенерация регламентов из встреч/чек-инов с провенансом до цитаты | done | — |
| `/regulations`, `/policies` страницы | done | — |
| **Insights Radar** (β-4, 90% done) — детектор повторяющихся проблем/блокеров с динамикой (spike/growing/stable/declining), KNN-кластеризация повторов, виджет «Топ-5» в Director Dashboard | **done** | поле `causeCategory` |

**Чего не хватает:**
- **α-7 доделка** — `ProcessTemplate`, `ProcessTemplateVersion`, `DecisionPoint`, `ProcessHandoff` (4 новые модели).
- **γ-3 CrossFunctionalProcess + Handoff (0% done)** — целиком новое. Закрывает межотдельные сбои.
- **β-4 доделка**: поле `Insight.causeCategory` (`process | people | resources | task_setup`) — прямо функция №7 COO «отличает причины сбоев».

### Функция 3. Цели (декомпозиция, вклад отделов, синхронизация)

| Уже в коде | Готовность | Gap |
|---|---|---|
| `Goal` модель + `/goals` страница (Фаза 9 knowledge-core) | done | — |
| `strategic-alignment` воркер + alignment 0-100 + history snapshots | done | — |
| Индикатор «Согласованность стратегии» в Director Dashboard | done | — |

**Чего не хватает:**
- **Связка Goal → Department → Role → Person** через граф — модели есть, визуальной декомпозиции на дашборде нет.
- **Goal → KPI** — после `α-8 KPI` (расширение/переименование `Metric` + поля `attachedToResponsibilityElementId, attachedToRoleId, attachedToDepartmentId, currentValue, frequency`).
- **Goal → ProcessTemplate** — после α-7 доделки.

### Функция 4. Стратегия → исполнение (план действий, ресурсы, приоритеты)

| Уже в коде | Готовность | Gap |
|---|---|---|
| `Mission`, `Vision`, `Strategy` — отдельные модели **без UI** | partial | мигрировать в CompanyProfile (α-9) |
| **Decisions Registry** (β-3, 95% done) — реестр решений с rationale, alternatives, supersede chains, evolving конфликты, deadline, actualOutcomes | **done** | `appliedPolicyId` после α-8 |
| `/decisions` страница | done | — |

**Чего не хватает:**
- **α-9 CompanyProfile** + UI `/company` — единое место для миссии/видения/стратегии.
- **γ-2 Concierge Agent (0% done)** — проактивная приоритизация (сейчас есть CommandPalette, его надо расширить).

### Функция 5. Управление (лидеры направлений, правила игры, распределение ресурсов)

| Уже в коде | Готовность | Gap |
|---|---|---|
| `RBAC` + `/admin` страницы (orgs, members, ai-models, prompts, llm-prices, usage) | done | унификация двух admin-групп (α-10 P0) |
| `ExecutablePersona` (γ-1) + Clone API (`/persons/:id/ask`, `/roles/:id/ask`) | done | — |
| `Probe Agent` (β-5) — проактивные сигналы куратору | done | — |

**Чего не хватает:**
- **β-7 Brand Voice Curator (0% done)** — управление стилем коммуникации команды.
- **β-8 распределение нагрузки** — часть COO Operations Dashboard.
- **α-10 Admin LLM + Unit Economics (5% done)** — экономика операций, бюджеты по отделам.

### Функция 6. Контроль (видимость, договорённости, движение к целям, отклонения) — САМОЕ СИЛЬНОЕ

| Уже в коде | Готовность | Gap |
|---|---|---|
| `/dashboard` Director Dashboard с 5 виджетами | done | расширить под COO-сценарии |
| **Insights Radar** (β-4) — повторяющиеся проблемы с динамикой | done | `causeCategory` |
| **Probe Agent** (β-5) — проактивные вопросы куратору когда что-то протухло | done | — |
| `commitment` + `commitment_status` signalType (α-2) | partial | 11 оставшихся signalType (включая `plan_item, done_item, blocker, team_friction, process_friction, resource_gap`) |
| `chat-v2` AI-чат компании | partial (30%) | dialog-layer (α-5 остаток) |

**Чего не хватает (главный gap для концепции):**
- **β-8 PersonalRelation + COO Operations Dashboard + DailyCheckIn (15% done)** — целиком. Сердце концепции.
- **δ-2 ProactiveWatcher (10% done)** — превентивный детектор паттернов.

### Функция 7. Анализ (причины сбоев, разовый vs системный, формирование решений)

| Уже в коде | Готовность | Gap |
|---|---|---|
| **Insights Radar** (β-4) — отделяет повторяющиеся от разовых через `frequencyScore + dynamicScore + ratio 7d/30d-avg` | done | `causeCategory` |
| Decisions Registry с `rationale, alternatives, actualOutcomes` (β-3) | done | — |
| `ConflictItem` с evolving (α-4) — temporal-конфликты | done | — |
| `chat-v2` AI-чат компании | partial 30% | dialog-layer + temporal queries |

**Чего не хватает:**
- **β-6 Experiment Tracker (0% done)** — A/B тесты гипотез исправлений: «попробовали изменить процесс, проверяем результат».
- **δ-1 Orchestrator + OrgKnowledgeIndex (0% done)** — для сложных research-задач анализа.

---

## Часть 2. Главный вывод — концепция = β-8 + доделки β-4/α-2

Концепция владельца «дневная/недельная сводка для COO + утренний/вечерний чек-ин» — это в точности sub-ТЗ **β-8** из roadmap'а:

> **β-8 PersonalRelation + COO Operations Dashboard + DailyCheckIn (15% done)** — PersonalRelation базис (EntityLink) есть, всё остальное новое.

Инфраструктура (каналы для чек-инов, knowledge-core, специалисты, probe-агент) уже работает. Сами чек-ины и сводка для COO — ещё не написаны.

### Соответствие концепция → код

| Из концепции | sub-ТЗ | Готовность |
|---|---|---|
| Утренний/вечерний чек-ин (свободный текст/голос) | β-8 DailyCheckIn | 0% — нет |
| Канал доставки чек-ина (in-app, Telegram, email) | α-1 ConversationalChannels | **100% done** |
| ASR голоса в чек-ине | δ-3 Voice Channel | 30% (Vox/GigaAM есть для встреч, для чек-инов — нет) |
| Извлечение `plan_item, done_item, blocker, team_friction, resource_gap` из свободного текста | α-2 + block-distill worker | 65% — нужны эти 6 signalType |
| Связка чек-ина с проектом/целью | knowledge-core + α-3 AxisClassifier | 75% — частично |
| «Кто кого блокирует» (PersonalRelation) | β-8 PersonalRelation | 15% — базис в EntityLink |
| **«Тот же блокер 5 дней подряд» — паттерны** | **β-4 Insights Radar** | **90% done — почти готово** |
| Конфликты из чатов (evolving) | α-4 ConflictItem + evolving | done |
| Настроение зелёный/жёлтый/красный (sentiment) | НЕТ в плане | 0% — добавить в β-8 |
| Дневная сводка «требует внимания сейчас» | β-8 COO Operations Dashboard | 0% — нет |
| Недельная сводка «системные проблемы» | β-8 + β-4 + cron | 0% — нет |
| «Что обещали vs что в данных» | `commitment` signalType + β-3 Decisions | partial — нужен `commitment_status` (α-2) |
| Из Zoom-планёрки → решения | meeting-types + AI-pipeline | **done полностью** |
| Категоризация сбоя (процесс/люди/ресурсы/постановка) | β-4 `causeCategory` | 0% — поле есть в плане, не реализовано |

---

## Часть 3. Минимальный набор sub-ТЗ для рабочего «AI-операционного директора»

### MUST (без них концепция не работает)

#### M1. β-8 целиком — PersonalRelation + COO Operations Dashboard + DailyCheckIn

- DailyCheckIn модель + cron-напоминания через `α-1 ConversationalService.sendNotification(event='checkin.morning'|'checkin.evening')`.
- `IngestService` подписан на ответы чек-инов (inbound от каналов через α-1) → создаёт `RawEvent` → знакомым путём в knowledge-core.
- Sentiment-анализ ответа (новый LlmTaskType `checkin-sentiment`) → зелёный/жёлтый/красный.
- PersonalRelation — расширить `EntityLink.relationType` (`blocks`, `helped_by`, `mentors`, `conflicted_with` — 3 из них уже в роадмапе α-3).
- **COO Operations Dashboard** — новая страница `/dashboard/coo` или role-based на `/dashboard`: 4 секции из концепции (требует внимания / картина команды / движение к целям / сигналы и инсайты).
- **Weekly digest cron** — отдельный воркер, агрегирует insights/decisions/commitments/personal-relations за 5 дней + Zoom-планёрку. Шаблон отчёта — через PromptRegistry (А.5 уже готов).

#### M2. α-2 доделка — 6 критичных signalType для чек-инов

Из 11 оставшихся достаточно: `plan_item, done_item, blocker, team_friction, process_friction, resource_gap`. Остальные (`hypothesis, lesson, content_artifact, brand_principle, methodology_step`) — можно отложить.

Плюс **bug-fix CRIT-1**: `ENTITY_TYPE_VALUES` в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts:30-38` (без него LLM не возвращает новые типы Entity).

#### M3. β-4 доделка — `Insight.causeCategory`

Поле + извлечение через LLM в существующем `3-5-insights` worker'е + фильтр в виджете «Топ-5 проблем». Прямо функция №7 COO «отличить процесс/люди/ресурсы/постановку».

### SHOULD (значительно усиливают ценность для COO)

#### S1. α-5 доделка DialogService (для AI-чата компании)

COO задаёт вопросы в свободной форме: «Что говорят в команде про новый процесс согласования?». Сейчас chat-v2 работает на 30%. Нужны: ContextualizerService (standalone-вопрос), MultiQueryExpansion (recall ≥85%), temporal `validAt`, mode-prompts (factual/synthetic).

#### S2. α-8 Role Map нормализация

Без неё COO не видит дублирование функций между ролями и пробелы в зонах ответственности (функция №1). 5 моделей + миграция `PersonRole → Appointment` + `Metric → KPI`.

#### S3. α-9 Company Foundation

`CompanyProfile` + `FunctionalDomain` + `MaturityScorerCron`. Зрелость функций — это та самая «картина компании», которую COO смотрит на недельном горизонте.

#### S4. α-4 доделка — CompletenessSlot + ConsistencyChecker

First-class «незаполненный обязательный слот» + cron-сканер несостыковок. Инфраструктура для функций №1 и №2 (структура и процессы).

### NICE-TO-HAVE (для полной зрелости продукта)

- **γ-2 Concierge Agent** — проактивная приоритизация на дашборде («сегодня сначала посмотри сюда»).
- **γ-3 CrossFunctionalProcess + Handoff** — межотдельные сбои.
- **δ-2 ProactiveWatcher** — превентивные сигналы до того, как проблема стала повторяющейся.
- **β-6 Experiment Tracker** — A/B-гипотезы исправлений (функция №7 «формирует решения»).
- **δ-3 Voice Channel TTS** — если хочешь, чтобы AI-COO мог звонить голосом.

---

## Часть 4. Открытые решения до старта реализации

1. **Где живёт DailyCheckIn — отдельный модуль или внутри `operations`?** В коде уже создан `backend/src/modules/operations/operations.module.ts`, но reality-deltas говорит «целиком новое». Нужно посмотреть, что там сейчас и совпадает ли scope.

2. **Telegram zero-button rip-out (β-1) — до или после β-8?** Чек-ины удобно работают через бота. Сейчас бот ещё на slash-командах и callback_query. Без β-1 rip-out новые чек-ины тоже будут на старой механике, и потом всё придётся переписывать.

3. **Sentiment (зелёный/жёлтый/красный) — кому виден?** Этический момент. COO видит, сотрудник — видит свои или нет? В концепции не зафиксировано. Влияет на DTO и RBAC.

4. **«Утренняя/вечерняя форма» vs «свободный голос/текст»** в концепции описаны оба варианта. Первая итерация — что? Свободный текст с auto-структуризацией реалистичнее: даёт adoption, требует только LLM-промпта.

5. **Где живёт COO Dashboard URL** — `/dashboard` role-split (как сейчас в Director Dashboard) или отдельный `/dashboard/coo`? По UI-аудиту 12 правил (часть 2.8 roadmap'а) — «`/dashboard` показывает что важно сейчас». Это и есть COO-логика → расширить existing `/dashboard`.

---

## Часть 5. Связь с позиционированием

Концепция COO-дашборда — это wedge B+E (чек-ины + операционный дайджест) из [позиционирования v2](2026-05-23-positioning-research-v2.md). На лендинге это соответствует категории-гипотезе **«AI-операционный директор + цифровой двойник компании»**.

Расхождение между концепцией и зафиксированной миссией:
- Концепция реализует **одну функцию** (операционный директор через чек-ины + дайджест).
- Миссия обещает **три вещи**: память навсегда + клоны сотрудников + операционный директор.

Это не блокер для разработки, но влияет на hero-нарратив. Подробный разбор противоречия — в отдельном анализе позиционирования (см. диалог с владельцем 2026-05-23).

---

## Часть 6. Что делать дальше (предлагаемый порядок)

1. **Открыть `backend/src/modules/operations/`** и проверить, что там уже сделано (модуль есть, scope из roadmap'а — 15% done, конкретики этого анализа не хватает).
2. **Открыть [final-roadmap.md](../tz/2026-05-22-final-roadmap.md) Часть 4 (β-8 раздел)** — детальный scope β-8 в roadmap'е, уточнить какие именно поля DailyCheckIn планируются.
3. **Принять решения по 5 открытым вопросам выше** (часть 4) — минимум по №3, №4, №5 до старта.
4. **Написать sub-ТЗ `plans/tz/2026-05-23-coo-mvp.md`** — выжимка из β-8 + α-2 доделки + β-4 доделки под концепцию «дневная/недельная сводка». Это будет один атомарный план реализации MVP-фичи AI-операционного директора.

---

_2026-05-23: документ создан по запросу владельца. Следующее обновление — после прочтения `backend/src/modules/operations/` и раздела β-8 в final-roadmap.md._

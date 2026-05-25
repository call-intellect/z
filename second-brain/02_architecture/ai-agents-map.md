---
title: Карта AI-агентов проекта Z
date: 2026-05-25
status: living-document
owner: architecture
---

# Карта AI-агентов проекта Z

Полный реестр всех AI-агентов в Z (Кора) — каждое место, где код самостоятельно вызывает LLM (большую языковую модель), обрабатывает знание или общается с человеком. Карта живая: при добавлении нового агента — обновляй этот файл и индекс в `module-map.md`.

Связанные документы:
- [Карта модулей backend](module-map.md) — где живут модули и очереди
- [Архитектура knowledge-core](knowledge-core.md) — ядро памяти компании
- [AI-интеграция](ai-integration.md) — провайдеры и роутер
- [LLM-провайдеры verified](../01_projects/llm-providers-verified.md) — какие модели сейчас primary
- [AI-jobs](../01_projects/ai-jobs.md) — список jobs (заданий) в BullMQ
- [Skill & Clone](../01_projects/skill-and-clone.md) — клоны ролей

## Содержание

1. [Картина в общем — три модуля](#1-картина-в-общем--три-модуля)
2. [Модуль 1: Наполнение базы знаний (второй мозг)](#2-модуль-1-наполнение-базы-знаний-второй-мозг)
3. [Модуль 2: Автоматические агенты (cron и триггерные)](#3-модуль-2-автоматические-агенты-cron-и-триггерные)
4. [Модуль 3: Диалоговые точки входа](#4-модуль-3-диалоговые-точки-входа-с-человеком)
5. [Probe — агент уточняющих вопросов](#5-probe--агент-уточняющих-вопросов-критический-блок)
6. [Цепочки vs одиночки](#6-цепочки-vs-одиночки)
7. [Общая LLM-инфраструктура](#7-общая-llm-инфраструктура-роутер-промпты-эмбеддинги)
8. [Что в discovery / исследовании](#8-что-в-discovery--исследовании)

---

## 1. Картина в общем — три модуля

В Z агенты делятся на три модуля по способу запуска и роли:

| Модуль | Кто запускает | Куда уходит результат | Примеры |
|---|---|---|---|
| **1. Наполнение базы знаний** | События в системе (встреча завершилась, пришёл документ) | В БД — IdeaBlock, Entity, Decision, Insight, Skill и т.д. | block-ingest, 9 специалистов, кластеры, граф, клоны ролей |
| **2. Автоматические агенты** | Cron-расписание или watcher-триггер | Дашборды, digest-ы, нотификации, probe-вопросы | COO daily/weekly digest, snapshot метрик, trigger-watcher persona, proactive watcher |
| **3. Диалоговые с человеком** | Человек написал/нажал кнопку | Ответ в чате/UI | Concierge, Cmd+K, Chat-v2 компании, чат с клоном роли, чат встречи, orchestrator |

Поверх всех трёх модулей — **общая LLM-инфраструктура**: маршрутизатор моделей (LlmRouter), реестр промптов с правкой из админки (Prompt Registry), сервис эмбеддингов (KnowledgeEmbeddingService), общий слой метрик.

И отдельно — **Probe** (уточняющие вопросы): это не отдельный модуль, а механизм, который пронизывает Модуль 1 (специалисты ловят пропущенные данные) и приходит к человеку через Модуль 3 (нотификация + inline-кнопки). Подробно — раздел 5.

---

## 2. Модуль 1: Наполнение базы знаний (второй мозг)

Главный поток: сырое событие (встреча, документ, трекер) → блоки знаний (IdeaBlock) → типизированные сущности (Decision, Insight, Idea, Regulation и т.д.) → граф связей → темы и кластеры → клоны ролей.

### 2.1. Pipeline ингеста (фундамент)

Это базовая цепочка, через которую проходят все события до того, как ими займутся специалисты.

| # | Агент | Файл | Триггер | Что делает | LLM | В цепочке |
|---|---|---|---|---|---|---|
| 1 | **Block-Ingest** | `workers/block-ingest.worker.ts` | BullMQ-очередь `core.raw-events` | Из сырого события (`RawEvent`) извлекает семантические блоки (`IdeaBlock`) и типизированные сущности через `GraphService` (Process, Decision, Regulation, Policy, Tool, Metric). Один LLM-вызов на скользящее окно сегментов. | `block-ingest.prompt.ts` | Начало → enqueue в block-distill |
| 2 | **Block-Merge** (вспомогательный) | `services/block-merge.service.ts` | Вызов из Block-Distill | LLM-арбитр: новый блок — дубликат существующего canonical-блока или новое знание? Возвращает `merge` / `distinct` + canonicalId. | встроенный JUDGE_SYSTEM_PROMPT | Вспомогательный для block-distill |
| 3 | **Block-Distill** | `workers/block-distill.worker.ts` | BullMQ `core.block-distill` (debounce 30 секунд после ingest) | Дедупликация блоков: KNN (ближайшие соседи по эмбеддингу) + LLM-арбитр → одобряет дубликат или оставляет как новый canonical. | через Block-Merge | block-ingest → **distill** → block-linker |
| 4 | **Block-Link** (вспомогательный) | `services/block-link.service.ts` | Вызов из Block-Linker | LLM-классификация типа связи между двумя canonical-блоками: develops / contradicts / causes / consequences_of / shares_topic / shares_entity / question_answered_by. | встроенный LINK_JSON_SCHEMA | Вспомогательный для block-linker |
| 5 | **Block-Linker** | `workers/block-linker.worker.ts` | BullMQ `core.block-linker` (после distill, gated по числу блоков) | Строит граф `IdeaBlockLink` через LLM-арбитра на KNN-кандидатах. При `contradicts` + confidence ≥ 0.85 — эскалация в ConflictService. | через Block-Link | distill → **linker** → (опц.) conflict |
| 6 | **Axis-Classifier** (параллельный) | `services/axis-classifier.service.ts` | Async-dispatch из block-ingest | Размечает блок по 4 осям: who (Person), functional (FunctionalDomain), contextual (Project/Customer/Vendor/Event), temporal (past/future/current/permanent/periodic). LLM-вызов только если статические резолверы не покрыли. | `axis-classify.prompt.ts` | Параллельно ingest, не блокирует |

Вспомогательные сервисы без LLM: `block-fetch.service.ts` (загрузка блоков), `segment-builder.service.ts` (нарезка сырого транскрипта на сегменты), `embedding.service.ts` (эмбеддинги в pgvector), `task-assignee-resolver.service.ts` (резолв исполнителя задачи).

### 2.2. Анализ встреч в отчёт

Параллельная ветка: после ingest строится итоговый отчёт встречи (главы, задачи, краткое содержание, оценка качества).

| Агент | Файл | Триггер | Что делает | LLM-промпт |
|---|---|---|---|---|
| **Meeting-Analyze-V2 cron** | `workers/meeting-analyze-v2.cron.ts` | `*/10 * * * *` (каждые 10 минут) | Сканирует встречи в статусе `ai_ready`, ставит в очередь на v2-обработку. | — |
| **Meeting-Analyze-V2 worker** (@deprecated, замена идёт) | `workers/meeting-analyze-v2.worker.ts` | BullMQ `core.meeting-analyze-v2` | Параллельно вызывает три экстрактора: главы, задачи, summary. Использует canonical-блоки. | три раздельных вызова |
| Chapters-Extractor-V2 | `services/chapters-extractor-v2.service.ts` | Из Meeting-Analyze-V2 | Нарезка блоков на главы по таймкодам и тематике. | `chapters-v2.prompt.ts` |
| Summary-Extractor-V2 | `services/summary-extractor-v2.service.ts` | Из Meeting-Analyze-V2 | Итоговая сводка в markdown под тип встречи (9 типов: team/standup/plan_fact/project/sales/custdev/partner/training/investor). | `summary-v2.prompt.ts` (SYSTEM_BY_TYPE) |
| Tasks-Extractor-V2 | `services/tasks-extractor-v2.service.ts` | Из Meeting-Analyze-V2 | Извлекает явные задачи из commitment/decision-блоков. | `tasks-v2.prompt.ts` |
| **Meeting-Report-Fast** (новый, идёт замена deprecated v2) | `workers/meeting-report-fast.worker.ts` | BullMQ `core.meeting-report-fast` | Один LLM-вызов с tool-call'ом извлекает главы + задачи + summary + quality-score прямо из сырого транскрипта. В 4× дешевле, в 3.5× быстрее v2. | `meeting-report-fast.prompt.ts` |
| **Task-Assignee-Resolver** (post-processing) | `services/task-assignee-resolver.service.ts` | После экстракторов | Резолв исполнителя задачи (точный матчинг userId / по имени). Без LLM. | — |

### 2.3. Card-Rollup-V2 — сводки карточек

| Агент | Файл | Триггер | Что делает | LLM |
|---|---|---|---|---|
| **Card-Rollup-V2** | `services/card-rollup-v2.service.ts` + `workers/card-rollup-v2.worker.ts` | BullMQ `core.card-rollup-v2` (на ready-встречу / изменение линка / явный regenerate) | Собирает блоки карточки → top-3 темы → LLM-rollup по типу карточки (vendor/customer/project и т.д.) → CurationService.triage (auto/light/deep) → CardVersion + конфликт-детекция. | `card-rollup-v2.prompts.ts` |

### 2.4. Девять специалистов извлечения сущностей

У каждого специалиста унифицированная тройка: **`*-{topic}.service.ts`** (главный экстрактор, основной LLM-агент) + **`*-card-handler.service.ts`** (обработчик пользовательских правок карточек, регистрируется в `CardSpecialistRegistry`) + **`*-probe.service.ts`** (формулирование уточняющих вопросов) + **`*.worker.ts`** в очереди `core.specialist-routing`.

#### 2.4.1. Сводная таблица

| № | Специалист | Что извлекает | Promote-кронs | Auto-canonical порог | Critical-typing |
|---|---|---|---|---|---|
| **3-1** | Регламенты, процессы, политики | Regulation, Process+ProcessStep, Policy | нет (probe-синхронные) | confidence ≥ 0.85 (deep review для critical) | по `severity` |
| **3-2** | Knowledge Clone (что роль знает) | Person.knowledgeProfile (категории экспертизы) | `knowledge-clone-rebuild.cron` каждые 6 часов | confidence ≥ 0.85 | по `confidence` |
| **3-3** | Решения (Decisions) | Decision (статус, deadline, decider, basis) | `specialist-3-3-probe` cron'ы 5:00 / 7:00 (overdue, outcome_unknown) | **всегда** deep-review (в CURATION_CRITICAL_TYPES) | принудительный |
| **3-4** | Project/Customer (маршрутизация) | НЕ извлекает данные — триггерит CardRollupV2 на изменения по упоминанию customer/vendor/project | — | — | — |
| **3-5** | Insights (боли, риски, churn-risk, возражения) | Insight (severity, dynamicLabel, mitigationPlan, linked decisions) | `insight-clusterer.cron` каждые 6 часов | confidence ≥ 0.85 (severity=critical → принудительно deep) | по `severity` |
| **3-6** | Ideas (идеи, feature-requests) | Idea (internal или client_request) с подсчётом supporters | `ideas-closing-loop.handler` слушает transitions | confidence ≥ 0.85 | — |
| **3-7** | Skill (как роль думает — навыки/трейты) | SkillTrait + SkillTraitConcept (нормализация) | `skill-profile-recalibrate.cron` 5:00 daily, `skill-trait-concept-normalizer.cron` 3:00 daily | confidence ≥ medium | по `severity` (мislead-черты) |
| **3-9** | Эксперименты | Experiment (hypothesis → running → completed/dropped) с lessons | `experiment-status-resolver.cron` каждые 6 часов, `experiment-transitions.cron` 7:00 daily | confidence ≥ 0.7 для авто-перехода | — |
| **Process** (без номера) | Process detector | `process-detector.worker.ts`, `process-template-completeness.cron.ts` | — | — | — |

#### 2.4.2. По каждому специалисту — главное

**Специалист 3-1 — Регламенты, процессы, политики.** Файл `services/specialist-3-1-regulations.service.ts` (~1350 строк). Делает: KNN top-5 dedup → LLM-арбитр `regulation-dedupe.prompt.ts` решает new / merge / extension / contradicts. Извлечение через `regulation-extract.prompt.ts`. Воркер: `workers/specialist-3-1-regulations.worker.ts` (concurrency=2 для rate-limit LLM). Probe (4 триггера): `regulation.missing_owner`, `regulation.process_no_steps`, `regulation.stale` (старше 6 мес + свежие блоки), `regulation.scope_unclear`. Card-handler: `services/specialist-3-1-card-handler.service.ts` (возвращает Regulation/Process/Policy, у которых `sourceBlockIds` пересекаются с retrieval-блоками для chat-v2).

**Специалист 3-2 — Knowledge Clone (что роль знает).** Файл `services/specialist-3-2-knowledge-clone.service.ts`. Делает: загружает блоки роли за 12 месяцев → LLM `knowledge-clone-extract.prompt.ts` → категории экспертизы. Если есть старый профиль — LLM-merge через `knowledge-clone-merge.prompt.ts` + детект противоречий → ConflictService. Auto-canonical при confidence ≥ 0.85, иначе CurationItem для manager review. Cron `knowledge-clone-rebuild.cron.ts` (`0 */6 * * *`) каждые 6 часов находит роли со свежей активностью и ставит rebuild. Probe (2 триггера): `knowledge.new_expertise_detected` (новая high-confidence категория) и `knowledge.contradiction_detected`. Получатели — direct manager через `probe-recipient.util.ts`.

**Специалист 3-3 — Решения.** Файл `services/specialist-3-3-decisions.service.ts`. LLM-extract через `decision-extract.prompt.ts`, потом LLM-merge через `decision-supersede-detect.prompt.ts` (KNN top-5). Если verdict `supersedes` — эскалация в ConflictService (relationType=`contradicts`, suggestedResolution=`evolving`). Decision **всегда** в `CURATION_CRITICAL_TYPES_DEFAULT` → принудительный deep review. Probe (5 триггеров): `decision.missing_decider` (sync), `decision.no_deadline_critical` (sync), `decision.overdue` (cron `0 5 * * *` ежедневно), `decision.competing_versions`, `decision.outcome_unknown` (cron). Самый «громкий» специалист по probe — выдаёт максимум уточняющих вопросов.

**Специалист 3-4 — Project / Customer Context.** Не извлекает данные сам — это маршрутизатор. Воркер `workers/specialist-3-4-project-customer.worker.ts` фильтрует блоки с упомянутыми customer/vendor/project/product → для каждой затронутой Card ставит `CardRollupV2Job` (debounce 60 секунд). Probe (4 триггера): `card.missing_owner`, `card.missing_deadline` (для project-карточек), `card.merge_suggestion` (2+ карточки с одним entityId), `card.outdated_summary`.

**Специалист 3-5 — Insights.** Файл `services/specialist-3-5-insights.service.ts`. LLM-extract `insight-extract.prompt.ts` → KNN top-10 кластеризация в существующие Insights → LLM-link к Decisions через `insight-link-to-decisions.prompt.ts`. Critical severity → принудительный deep review (снижением confidence до 0.3). Cron `insight-clusterer.cron.ts` (`0 */6 * * *`) пересчитывает `frequencyScore`, `dynamicScore`, `dynamicLabel` ∈ {growing, stable, declining, spike}. Probe (4 триггера): `insight.escalation_suggested` (если label стал `spike`), `insight.no_mitigation_plan` (severity high/critical + старше 7 дней, cron), `insight.linked_decision_question` (sync), `insight.recurring_after_mitigation` (sync).

**Специалист 3-6 — Ideas.** Файл `services/specialist-3-6-ideas.service.ts`. KNN top-10 в существующие Idea → match (добавить supporter, sourceBlockId) или miss → LLM `idea-extract.prompt.ts`. EventEmitter `idea.created` для `ideas-closing-loop.handler.ts` (он слушает переходы captured → in_discussion → implemented/rejected и шлёт уведомления supporters/creator). Кластеризация идей: `idea-clusterer.cron.ts` (`30 */4 * * *`) через `idea-cluster-merge.prompt.ts`. Probe (2 триггера): `idea.support_request` (новая Idea, всем members кроме автора, спрашиваем «поддержать?»), `idea.status_unclear` (in_discussion > 14 дней, cron).

**Специалист 3-7 — Skill (как роль думает).** Файл `services/specialist-3-7-skill.service.ts`. Загружает reasoning-блоки за 3 месяца (max 200) → KNN-greedy grouping (similarity ≥ 0.78) → для группы ≥ MIN_OBSERVATIONS → LLM `skill-trait-detect.prompt.ts`. Затем KNN-merge с активными trait'ами (cosine ≥ threshold), decay по `lastConfirmedAt`. Нормализация концептов: `services/skill-trait-concept.service.ts` + cron `skill-trait-concept-normalizer.cron.ts` (`0 3 * * *`) — union-find кластеризация концептов (cosine ≥ 0.92), LLM `skill-trait-concept-name.prompt.ts` выбирает каноническое имя при слиянии. Decay: `skill-profile-recalibrate.cron.ts` (`0 5 * * *`) ежедневно — high → medium → low → archived. **Primary capable модель — DeepSeek V4 Pro** (96% accuracy на golden-наборе по эксперименту 2026-05-25). Probe (2 триггера): `skill.profile_starved` (мало reasoning-блоков), `skill.contradicting_traits`. Получатели — direct manager.

**Специалист 3-9 — Эксперименты.** Файл `services/specialist-3-9-experiments.service.ts`. LLM `experiment-extract.prompt.ts` → Experiment + ExperimentVersion snapshot. Auto-status transition только при confidence ≥ 0.7. Cron'ы: `experiment-status-resolver.cron.ts` (каждые 6 часов, проверка transitions), `experiment-transitions.cron.ts` (`0 7 * * *` ежедневно). Probe (3 триггера): `experiment.no_owner` (старше 24 ч), `experiment.running_too_long` (running > 30 дней без результата), `experiment.result_without_lesson` (sync).

**Process detector** (без номера). `workers/process-detector.worker.ts` + `workers/process-template-completeness.cron.ts` + промпты `process-steps-extract.prompt.ts`, `process-template-extract.prompt.ts`. Детектит процессы из блоков, проверяет полноту шаблонов процессов.

### 2.5. Граф знаний (entity-resolution + linking)

| Агент | Файл | Расписание | Что делает | LLM |
|---|---|---|---|---|
| **Entity-Resolver cron** | `workers/entity-resolver.cron.ts` | `*/5 * * * *` каждые 5 минут | Находит Entity-пары с cosine-similarity > порога, enqueue до 50 пар в очередь `core.entity-resolver`. | — |
| **Entity-Resolver worker** | `workers/entity-resolver.worker.ts` | BullMQ consumer (concurrency=1) | LLM-арбитр через `entity-merge.service.ts` решает merge / distinct → перенос EntityAlias, `mergedIntoId`. | встроенный `ARBITER_SYSTEM_PROMPT` |
| **Entity-Graph-Builder cron** | `workers/entity-graph-builder.cron.ts` | `0 * * * *` каждый час | Находит co-mentioned Entity-пары (≥2 общих блока) → грузит 5 блоков контекста → LLM `judgeRelation` решает тип связи (works_at, belongs_to, part_of, opposes, depends_on, mentions_with). Confidence ≥ 0.5 → upsert EntityLink. | встроенный `ENTITY_LINK_SYSTEM_PROMPT` |
| **Entity-Merge service** | `services/entity-merge.service.ts` | Вызов из Resolver | KNN top-5 кандидатов того же типа, LLM-арбитр. | встроенный |
| **Entity-Graph service** | `services/entity-graph.service.ts` | Вызов из Builder | SQL co-mentioned pairs + LLM judgeRelation. | — |
| **Entity-Resolution service** | `services/entity-resolution.service.ts` | Используется ingest'ом и cron'ом | `findOrCreateEntity` (по lower-name), `findCandidates` (cosine). | — |

### 2.6. Темы и кластеры

| Агент | Файл | Расписание | Что делает | LLM |
|---|---|---|---|---|
| **Theme-Clusterer** | `workers/theme-clusterer.cron.ts` | `15 * * * *` ежечасно в :15 | KNN union-find кластеризация canonical-блоков без темы, на кластер — LLM `theme-classification.service.ts` → Theme (name, description, branch, weight) + ThemeIdeaBlock + ThemeEntity. | `theme-classify` промпт |
| **Insight-Clusterer** | `workers/insight-clusterer.cron.ts` | `0 */6 * * *` каждые 6 часов | Пересчитывает `frequencyScore`, `dynamicScore`, `dynamicLabel` для всех active/mitigating Insight'ов. Spike → probe `insight.escalation_suggested`. Без LLM (чистая математика). | — |
| **Idea-Clusterer** | `workers/idea-clusterer.cron.ts` | `30 */4 * * *` каждые 4 часа в :30 | KNN cosine к IdeaCluster'ам (порог 0.80), на miss → LLM `idea-cluster-merge.prompt.ts` (new / add / standalone). Кластер создаётся при ≥5 идей за 14 дней. | `idea-cluster-merge.prompt.ts` |
| **Reframing** (ночной переосмыслитель) | `workers/reframing.cron.ts` | `0 3 * * *` ежедневно в 03:00 | Четыре этапа: (1) архивация слабых связей (confidence < 0.5, age > 7 дн); (2) decay dynamicScore старых блоков; (3) LLM-анализ свежих блоков → splitCandidates / mergeCandidates / themeShifts; (4) LLM-рефлексия над темами → themeSplits / themeMerges / themesToArchive (merge'ы применяются автоматически). | `REFRAMING_SYSTEM_PROMPT` + `REFRAMING_THEMES_SYSTEM_PROMPT` |
| **Strategic-Alignment cron** | `workers/strategic-alignment.cron.ts` | `0 4 * * *` ежедневно в 04:00 (после reframing) | На каждую активную Goal ставит job. | — |
| **Strategic-Alignment worker** | `workers/strategic-alignment.worker.ts` | BullMQ consumer | LLM оценивает достижение цели по свежим темам, инсайтам, успешным идеям. | `goal-alignment.prompt.ts` |

### 2.7. Клоны ролей (skill → knowledge → executable persona)

Многоступенчатый pipeline. Документ-источник правды: [Skill & Clone](../01_projects/skill-and-clone.md).

```
Встреча → reasoning-блок (subject = роль)
    ↓
RouterService (signalType=reasoning, role=employee) → dispatch 3-7
    ↓
Skill-Profile-Rebuild (debounce 60s)
    ├─ KNN-grouping (≥0.78)
    ├─ LLM skill-trait-detect (DeepSeek V4 Pro)
    ├─ KNN-merge с активными traits
    └─ SkillTraitConceptService.findOrCreateConcept (cosine ≥ 0.85, синхронно)
    ↓
Daily decay (5:00) + Concept normalizer (3:00, union-find ≥ 0.92)
    ↓
Параллельно: Knowledge-Clone-Rebuild (что роль знает)
    └─ LLM knowledge-clone-extract → knowledgeProfile
    ↓
RoleProfile (4ч cron): агрегат traits всех людей роли
    ↓
ExecutablePersonaBuildService.buildForProfile / buildForRole
    └─ LLM executable-persona-compile → personaPrompt 300–800 слов от первого лица
    ↓
ExecutablePersona (versioned, status=active)
    ↓
[Trigger-Watcher каждые 2ч следит за: critical-traits, ≥2 новых за 24ч, max-age 48ч]
    ↓
ClonesService.askPerson / askRole → анти-фальшивка (≥2 reasoning-блока, cosine≥0.70)
    ↓
LLM clone-respond (system = personaPrompt, user = retrieval) → ответ + [BLOCK:id] + дисклеймер
```

Ключевые файлы:
- `services/specialist-3-7-skill.service.ts` — детект и слияние черт
- `services/skill-trait-concept.service.ts` — нормализация концептов
- `workers/skill-trait-concept-normalizer.cron.ts` (`0 3 * * *`) — ночное слияние концептов
- `workers/skill-profile-recalibrate.cron.ts` (`0 5 * * *`) — daily decay
- `workers/skill-profile-rebuild.worker.ts` — consumer ребилда
- `services/specialist-3-2-knowledge-clone.service.ts` — что роль знает
- `workers/knowledge-clone-rebuild.cron.ts` (`0 */6 * * *`) и `.worker.ts`
- `workers/role-profile.cron.ts` + `.worker.ts` — профиль роли
- `services/executable-persona-build.service.ts` — компилятор персоны
- `services/executable-persona-versioning.service.ts` — обёртка с Redis SETNX-локом (TTL 60 мин)
- `workers/executable-persona-build.cron.ts` (`0 6 * * SUN`) — weekly snapshot
- `workers/executable-persona-trigger-watcher.cron.ts` (`0 */2 * * *`) — реактивный rebuild
- Промпты: `skill-trait-detect.prompt.ts`, `skill-trait-merge.prompt.ts`, `skill-trait-concept-name.prompt.ts`, `knowledge-clone-extract.prompt.ts`, `knowledge-clone-merge.prompt.ts`, `role-profile-build.prompt.ts`, `executable-persona-compile.prompt.ts`, `clone-respond.prompt.ts`

Антифальшивка в `clone-respond` — программное правило **до** LLM-вызова: ищем минимум 2 reasoning-блока с cosine ≥ 0.70 к вопросу. Меньше → отказ без LLM (`refused`, reason=`insufficient_context`). Запрещены обещания/согласия/оценки коллег. В конце обязательный дисклеймер «(ответ — от клона; могу ошибаться, спроси оригинал)».

Rate-limit инференса: `cfg.skill.cloneAskPerUserPerDay` (по умолчанию 20).

---

## 3. Модуль 2: Автоматические агенты (cron и триггерные)

Все агенты ниже бегут сами по расписанию или триггеру и пишут что-то наружу — дашборд, уведомление, метрика, probe-вопрос.

### 3.1. Digest-агенты (сводные отчёты для людей)

| Агент | Файл | Расписание | Получатель | LLM |
|---|---|---|---|---|
| **COO Daily Digest** (β-8.3 Wave) | `modules/operations/workers/operations-daily-digest.cron.ts` | `0 22 * * *` (22:00 UTC = 01:00 МСК) — отчёт за вчерашний день к утру | COO, Owner Org | Да (внутри `DailyDigestService`) |
| **COO Weekly Digest** | `modules/operations/workers/operations-weekly-digest.cron.ts` | `0 * * * *` ежечасный pre-check, фактически — понедельник 08:00 локального часового пояса (по `Org.timezone`) | COO, Owner | Да |
| **Skill Manager Digest** | `modules/knowledge-core/workers/skill-manager-digest.cron.ts` | `0 9 * * MON` понедельник 09:00 UTC | Direct managers | Нет (БД-запрос + actionUrl на curation page) |
| **Recognition Weekly Digest** | `modules/recognition/cron/recognition-weekly-digest.cron.ts` | `0 9 * * 1` понедельник 09:00 UTC | Команда (in-app feed) | Да — отдельный `recognition-formulate.worker` формулирует благодарность |
| **Activity Feed Digest** | `modules/activity-feed/cron/feed-digest.cron.ts` | Daily `0 9 * * *` + Weekly `0 9 * * 1` | Подписчики (channels TODO) | Нет (пока только логирование) |
| **Director Dashboard Narrative** | внутри `modules/dashboard/services/director-dashboard.service.ts` | Invalidate cache в `0 6 * * *`, LLM-генерация по запросу дашборда (TTL 24ч) | CEO | Да (taskType=`dashboard-summary`) |

Все digest-агенты идемпотентны по дате/неделе через unique constraint. Master-флаги для включения/отключения: `COO_DAILY_DIGEST_ENABLED`, `COO_WEEKLY_DIGEST_ENABLED`, `PROACTIVE_WATCHER_ENABLED`, `PERSONA_SCHEDULED_REBUILD_ENABLED` — все читаются через `TypedConfigService.getDynamic()` без перезапуска.

### 3.2. Snapshot-агенты (срезы метрик)

| Агент | Файл | Расписание | Куда пишет |
|---|---|---|---|
| **Core Metrics Snapshot** | `workers/core-metrics-snapshot.cron.ts` | `*/5 * * * *` каждые 5 минут | Prometheus gauge'и: `core_blocks_total{tenant,status}`, `core_entities_total{tenant,type}`, `core_links_total{tenant,relationType}`, `core_raw_events_total`, `core_facts_open_total{tenant,signal_type}` |
| **Contribution Snapshot** | `modules/recognition/cron/contribution-snapshot.cron.ts` | (periodic) | `ContributionSnapshot` для weekly digest |

### 3.3. Watcher-агенты (реактивные)

| Агент | Файл | Расписание | Что мониторит |
|---|---|---|---|
| **Executable Persona Trigger Watcher** | `workers/executable-persona-trigger-watcher.cron.ts` | `0 */2 * * *` каждые 2 часа | 3 триггера для внеочередного rebuild persona: critical-misleading trait, ≥2 новых traits за 24ч, snapshot старше 48ч. Redis SETNX-лок защищает от шквала. Метрики `persona_rebuild_triggered_total{reason}`. |
| **Proactive Watcher** | `modules/proactive/workers/proactive-watcher.cron.ts` | `0 */6 * * *` каждые 6 часов | 8 правил контроля по всем Org: риски выгорания, выход сотрудников, нарушения commitments, критические метрики. Шлёт probe/alerts. Тумблер `PROACTIVE_WATCHER_ENABLED`. |
| **Executable Persona Build (weekly)** | `workers/executable-persona-build.cron.ts` | `0 6 * * SUN` воскресенье 06:00 UTC | Базовый weekly snapshot persona (person + role-агрегаты). |

### 3.4. Технические/инфраструктурные cron'ы

| Агент | Файл | Расписание | Что делает |
|---|---|---|---|
| **Daily Cost Aggregator** | `modules/admin/economics/daily-cost-aggregator.cron.ts` | `0 1 * * *` 01:00 UTC | Агрегирует `AiUsageLog` за вчерашний день в `AiCostDaily` (по tenant, taskType, provider, model). Идемпотентен. |
| **Currency Rate Sync** | `modules/admin/economics/currency-rate-sync.cron.ts` | hourly | Курсы валют для costRub |
| **Budget Alert** | `modules/admin/economics/budget-alert.cron.ts` | periodic | Threshold violations |
| **Provider Smoke Test** | `modules/admin/economics/provider-smoke-test.cron.ts` | periodic health-check | Проверка живости LLM-провайдеров |
| **Org Economics** | `modules/admin/economics/org-economics.cron.ts` | periodic | Aggregate metrics |
| **Chat-V2 Cleanup** | `modules/chat-v2/workers/chat-v2-cleanup.cron.ts` | periodic | Чистка устаревших сессий чата |
| **Email Fetch** | `modules/ingest/adapters/email/email-fetch.cron.ts` | periodic IMAP | Pull писем в knowledge-core |
| **Idle Meeting Detector** | `modules/meetings/cron/idle-meeting.cron.ts` | periodic | Помечает зависшие встречи |

### 3.5. Спец-агенты для специалистов (probe и переходы)

Эти cron'ы относятся к специалистам 3-x, но запускаются автоматически. Сгруппирую отдельно:

- `specialist-3-3-probe` cron-методы (`0 5 * * *`, `0 7 * * *`) — overdue-решения и outcome_unknown
- `insight-clusterer.cron.ts` (`0 */6 * * *`) — пересчёт динамики инсайтов
- `idea-clusterer.cron.ts` (`30 */4 * * *`) — кластеризация идей
- `experiment-status-resolver.cron.ts` (каждые 6ч) и `experiment-transitions.cron.ts` (`0 7 * * *`)
- `skill-profile-recalibrate.cron.ts` (`0 5 * * *`) — decay черт
- `skill-trait-concept-normalizer.cron.ts` (`0 3 * * *`) — слияние концептов
- `process-template-completeness.cron.ts` — полнота шаблонов процессов
- `knowledge-clone-rebuild.cron.ts` (`0 */6 * * *`)
- `role-profile.cron.ts` (4ч)
- `reframing.cron.ts` (`0 3 * * *`) — ночное переосмысление
- `strategic-alignment.cron.ts` (`0 4 * * *`) — выравнивание целей
- `theme-clusterer.cron.ts` (`15 * * * *`) — темы
- `entity-resolver.cron.ts` (`*/5 * * * *`) и `entity-graph-builder.cron.ts` (`0 * * * *`)
- `meeting-analyze-v2.cron.ts` (`*/10 * * * *`)

### 3.6. Плановый агент — AI-Директор по ценности (Value Director)

Статус: дизайн + частичная реализация. Источник: [ai-value-director.md](../01_projects/ai-value-director.md). Endpoint `/api/v1/dashboard/value-director`. Идея — первый из «AI Board of Directors»: синтезирует сигналы о клиентской ценности (боли, ЦП, фидбек) и даёт CEO второе мнение и рекомендации по методологии client-value-framework.

Планируемое расписание:
- Daily — 1 ценностный сигнал в ленту AI-совета
- Weekly — динамика метрики ценности
- Monthly — аудит карты ценности
- Quarterly — full value review (CAC/LTV)
- On-demand — чат с CEO
- Proactive алерты при триггерах (CAC > LTV, LTV ↓ X%, новая боль клиента)

Антирол: не даёт советов по продукту, найму, маркетингу, технологиям — только ценность.

---

## 4. Модуль 3: Диалоговые точки входа с человеком

Все диалоговые агенты отвечают **только текстом** (по продуктовому решению). Голосовой ввод да — голосовой вывод нет. `ConciergeVoice` существует как технический компонент, но в текущий Concierge не интегрирован.

### 4.1. Concierge — главный универсальный ассистент

**Это основной вход в AI для обычного сотрудника.** Не разработчик, не админ — рядовой пользователь.

| Аспект | Детали |
|---|---|
| **Главный вход** | Плавающий значок (`MessageCircle`) внизу-справа на всех authenticated-страницах. Файл `frontend/src/ui/concierge/ConciergeFloatingButton.tsx`. |
| **Полноразмерная страница** | `/assistant` → `frontend/app/(authenticated)/assistant/AssistantClient.tsx` |
| **Backend endpoint** | `POST /api/v1/concierge/messages` (SSE — streaming событий), `POST /api/v1/concierge/messages/once` (polling fallback), `POST /api/v1/concierge/undo/:logId`, `GET /api/v1/concierge/quota` |
| **Цепочка** | Текст → ToolRouter (loop до 5 итераций) → LLM с системным промптом + история + ToolSchemas → если tool_call → выполнить → результат в `ConciergeMessage(role=tool)` + `ConciergeUndoLog` → следующий LLM-вызов → … → финальный ответ |
| **Контекст страницы** | Автоматически подмешивается `pathname` + `currentEntityKind/Id` |
| **Память** | Полная история в `ConciergeConversation` + `ConciergeMessage` |
| **Голос** | Только текстовый ввод/вывод. `ConciergeVoice.tsx` существует, но не подключён. |
| **SSE-события** | thinking, tool_call, tool_result, message, done, error |
| **Квоты** | daily/monthly через `ConciergeQuotaService` |

Возможности через tool-use: поиск по базе, создание задач, редактирование карточек, формирование отчётов. Каждый tool проверяет RBAC.

**Цепочка vs одиночка:** Concierge — это **цепочка-внутри-агента**: классификация → tool-выбор → выполнение → суммаризация результата → новый цикл. Память — длинная (в `ConciergeConversation`).

### 4.2. Command Palette (Cmd+K) — три режима

Файл `frontend/src/ui/components/command-palette/CommandPalette.tsx`. Горячая клавиша ⌘K / Ctrl+K, всем authenticated. На мобильном — bottom-sheet, на desktop — центрированный диалог.

Три режима по префиксу ввода:
1. **Поиск** (без префикса) — 200мс debounce → `searchApi` по карточкам, встречам, задачам, ролям, людям, документам.
2. **Команда Concierge** (префикс `>`) — `conciergeApi.askOnce` → toast с возможным undo.
3. **AI-помощник** (префикс `?` или пункт «Спросить AI») — `chatV2Api.ask({ scope: 'org', mode: 'synthetic' })` → inline ответ с цитатами + кнопка «Открыть полный чат» (deep-link `/chat-v2?conversationId=...`).

Не «главный вход» (это Concierge floating-button), но альтернативный быстрый путь для desktop-пользователей.

### 4.3. Chat-V2 — AI-чат компании (общий поиск по знаниям)

| Аспект | Детали |
|---|---|
| **Backend** | `backend/src/modules/chat-v2/` контроллер + `ChatV2OrchestrationService` (chat-v2) + `services/chat-v2.service.ts` и `chat-v2-retrieval.service.ts` (knowledge-core) |
| **Endpoint** | `POST /api/v1/chat-v2/messages` |
| **Frontend** | `/chat-v2` → `ChatV2Client.tsx` + компонент `OrgChatPanel.tsx`. Также embedded на `/dashboard` (director view, `withHistory={false}`). |
| **Цепочка** | 1) Эмбед запроса в pgvector 2) `ChatV2RetrievalService.fetchCandidates` гибридный (cosine + BM25) с темпоральным фильтром `validAt` (поддержка «что мы знали тогда» — SBA α-5 dialog-layer) и опц. multi-query expansion 3) 1-hop graph-расширение через IdeaBlockLink 4) Системный промпт `BASE_SYSTEM_PROMPT` (~127 строк, не выдумывать, ссылаться [BLOCK:id]) 5) История диалога опц. (до 6 сообщений + опц. `conversationSummary`) 6) LLM через `LlmRouterService` |
| **Память** | `ChatV2Conversation` + `ChatV2Message`. Поддержка pin/archive. Кэш ответов `AnswerCache` + retrieval `RetrievalCache`. |
| **Scope** | `org` (вся компания), `meeting`, `card`, `theme`, `entity` |
| **Mode** | `factual` / `synthetic` / `clone_style` |
| **Citations** | Обязательны: `meetingId`, `snippet`, `startMs`, `endMs` |
| **Streaming** | Нет (одним JSON) |

### 4.4. Чат с клоном роли

| Аспект | Детали |
|---|---|
| **Backend** | `backend/src/modules/clones/` — `ClonesService` методы `askPerson`, `askRole` |
| **Endpoints** | `POST /api/v1/clones/persons/:personId/ask`, `POST /api/v1/clones/roles/:roleId/ask` |
| **Frontend** | `/roles/[id]/skill-profile` — embedded chat в `RoleSkillProfileClient.tsx`. Старый `/me/clone` и `/persons/[id]/skill-profile` удалены (клоны теперь ролевые, не персональные — решение 2026-05-25). |
| **Цепочка** | 1) RBAC (owner/admin/self/manager) 2) Rate-limit (Redis, `cfg.skill.cloneAskPerUserPerDay`=20) 3) Загрузить active `ExecutablePersona` или on-demand build 4) **Анти-фальшивка**: ≥2 reasoning-блока с cosine ≥ 0.70 — иначе отказ без LLM 5) System prompt = `personaPrompt` 6) User prompt = `clone-respond` с reasoning-блоками + knowledge-profile + relevant decisions 7) LLM-ответ от первого лица + обязательное цитирование + дисклеймер «(клон; могу ошибаться)» |
| **Память** | `ChatV2Conversation` с `mode='clone_style'` |
| **Голос** | Только текст |

### 4.5. Чат внутри встречи

- Frontend: `MeetingChatPanel.tsx` встраивается на `/meetings/[id]/result`
- Backend endpoint: `POST /api/v1/meetings/:id/chat` (single-meeting context-stuffing)
- История: `GET /api/v1/meetings/:id/chat/history`
- Получатель: участники встречи, owner
- Это та цепочка про которую пользователь спрашивал — «трекер чата». Q&A по одной встрече с временными цитатами.

### 4.6. Чат внутри карточки (issue / task)

- Backend endpoint: `POST /api/v1/cards/:id/chat` (scope=`card`/`issue`)
- Frontend: встроенный чат в issue-detail (`/issues/[id]` или `/projects/[slug]/board`)
- Получатель: члены проекта

### 4.7. Orchestrator — глубокий research с субагентами

| Аспект | Детали |
|---|---|
| **Frontend** | `/orchestrator` (request) → `/orchestrator/runs/:id` (live SSE timeline) |
| **Backend** | `POST /api/v1/orchestrator/run` (SSE), `GET /api/v1/orchestrator/runs/:id/events` |
| **Что делает** | Длительный one-shot research-запрос: до 5 параллельных субагентов, до 15 минут. Сразу redirect на live-страницу, не ждёт завершения. |
| **Применение** | Отчёты, сравнения, хронологии — то, что нельзя сделать одним LLM-вызовом |
| **Голос** | Только текст |

### 4.8. Сводная таблица диалоговых агентов

| Агент | Endpoint | LLM | Память | Голос | Инициатор | Streaming |
|---|---|---|---|---|---|---|
| **Concierge** | `/concierge/messages` (SSE) | DeepSeek / fallback | `ConciergeConversation` (длинная) | Только текст | Сотрудник | Да (SSE) |
| **Command Palette AI-mode** | `/chat-v2/ask` (через AI-mode) | DeepSeek | Нет (one-shot) | Только текст | Сотрудник | Нет |
| **Chat-V2 (Org)** | `/chat-v2/messages` | DeepSeek | `ChatV2Conversation` | Только текст | Сотрудник | Нет |
| **Clone (Role)** | `/clones/roles/:id/ask` | DeepSeek | `ChatV2Conversation`(mode=clone_style) | Только текст | Сотрудник | Нет |
| **Meeting Chat** | `/meetings/:id/chat` | DeepSeek | Per-meeting history | Только текст | Участник встречи | Нет |
| **Card Chat** | `/cards/:id/chat` | DeepSeek | Per-card | Только текст | Член проекта | Нет |
| **Orchestrator** | `/orchestrator/run` (SSE) | Multi-agent | OrchestratorRun | Только текст | Сотрудник | Да (SSE) |

---

## 5. Probe — агент уточняющих вопросов (критический блок)

**Это та часть, которую пользователь специально просил детально описать.** Probe — не один агент, а сквозной механизм через всю систему специалистов. Когда специалист видит, что данных не хватает, он формулирует короткий уточняющий вопрос человеку и шлёт через единый канал.

### 5.1. Где живёт probe

| Слой | Файлы |
|---|---|
| **Единая точка входа** | `ProbeService` (модуль `modules/probe`) — дедупликация, rate-limit, priority scoring, cold-start window |
| **Утилита получателей** | `services/probe-recipient.util.ts` — резолвит, кому слать (owner ресурса / direct manager / admin Org как fallback) |
| **Формулирование вопроса** | `prompts/probe-formulate.prompt.ts` — единый промпт «Кора формулирует короткий вопрос ≤ 200 символов + 2–4 inline-кнопки ≤ 30 символов каждая» |
| **Probe per-specialist** | `services/specialist-3-1-probe.service.ts` ... `specialist-3-9-experiment-probe.service.ts` — каждый специалист имеет свой набор триггеров |
| **Обработка ответа** | `ProbeResponseHandler` — ответ пользователя → `RawEvent(kind=notification_response)` → обратно в knowledge-core (замыкание контура, SBA β-5 closing-loop) |

### 5.2. Когда срабатывает (по специалистам)

| Специалист | Reason | Условие | Когда (sync/cron) | Получатель |
|---|---|---|---|---|
| 3-1 | `regulation.missing_owner` | Regulation/Process/Policy без ownerPersonId + status=canonical | sync после upsert | админы Org |
| 3-1 | `regulation.process_no_steps` | Process без ProcessStep | sync | owner + админы |
| 3-1 | `regulation.stale` | lastConfirmedAt > 6 мес + свежие блоки | проверка раз в 7 дней | owner |
| 3-1 | `regulation.scope_unclear` | Нет scope + severity критический | sync | админы |
| 3-2 | `knowledge.new_expertise_detected` | Новая категория с confidence=high | sync после rebuild | direct manager роли |
| 3-2 | `knowledge.contradiction_detected` | Старый и новый профиль противоречат | sync | manager |
| 3-3 | `decision.missing_decider` | status=approved, decidedByPersonIds=[] | sync | участники встречи |
| 3-3 | `decision.no_deadline_critical` | approved + deadline=null + critical-tag | sync | owner / админы |
| 3-3 | `decision.overdue` | deadline < now + status ∉ {implemented, cancelled} | `0 5 * * *` daily | owner |
| 3-3 | `decision.competing_versions` | KNN: ≥2 похожих Decision без supersedes-связи | placeholder | админы |
| 3-3 | `decision.outcome_unknown` | implemented > 3 мес назад, actualOutcomes=null | daily cron | owner |
| 3-4 | `card.missing_owner` | Card creator без активного Membership | sync | админы |
| 3-4 | `card.missing_deadline` | Card(kind=project) + нет deadline + age > 7 дней | sync | owner |
| 3-4 | `card.merge_suggestion` | 2+ Card с одинаковым entityId | sync | админы |
| 3-4 | `card.outdated_summary` | lastConfirmedAt > 6 мес + свежие блоки | sync | owner |
| 3-5 | `insight.escalation_suggested` | dynamicLabel='spike' ИЛИ high/critical+растёт | sync | owner / админы |
| 3-5 | `insight.no_mitigation_plan` | high/critical + mitigationPlan=null + age > 7 дней | `0 */6 * * *` cron | админы |
| 3-5 | `insight.linked_decision_question` | LLM нашёл candidate Decisions | sync | owner / админы |
| 3-5 | `insight.recurring_after_mitigation` | status=mitigated + новое упоминание | sync | админы |
| 3-6 | `idea.support_request` | Новая Idea, supporterCount=1 | sync | все members Org (кроме автора) |
| 3-6 | `idea.status_unclear` | in_discussion > 14 дней без statusChange | cron | админы |
| 3-7 | `skill.profile_starved` | employee > 3 мес, reasoning-блоков < MIN_OBSERVATIONS | cron | direct manager |
| 3-7 | `skill.contradicting_traits` | Новый trait противоречит high-confidence существующему | sync | manager |
| 3-9 | `experiment.no_owner` | Без ownerEntityId > 24 ч | cron | админы |
| 3-9 | `experiment.running_too_long` | running > 30 дней + currentResult=null | cron | owner / админы |
| 3-9 | `experiment.result_without_lesson` | currentResult есть, lessonsJson=[] | sync | админы |

Особо — `skill.concepts_merged`: эмитится `skill-trait-concept-normalizer.cron`, когда слитие концептов затронуло ≥ 5 черт. Получатель — админы Org.

Также `recognition.unrecognized_high_contributor` — из `recognition-weekly-digest`.

### 5.3. Как формулируется вопрос

Промпт `probe-formulate.prompt.ts`:
- System-инструкция: «Ты Кора, память компании. Сформулируй короткий уточняющий вопрос за роль `{specialistKind}`».
- Output strict JSON: `{ question: string ≤ 200 символов, options: ["вариант 1" ≤ 30, "вариант 2" ≤ 30, ...] }` (2–4 варианта)
- UI рендерит как inline-кнопки (Telegram inline keyboard или web-buttons).

Пример (для `decision.missing_decider`):
```
question: "Кто здесь принял это решение?"
options: ["Я", "Мария Иванова", "Команда продаж", "Решение не принято"]
```

### 5.4. Как доставляется

Каналы (через `ConversationalService.sendNotification` с `eventType='specialist.probe'`):
1. **Telegram-бот** `@kora_bot` (если у пользователя привязан Telegram через magic-link).
2. **Email** (если есть `notificationEmail` у пользователя).
3. **In-app уведомление** в Concierge и через `Notification` таблицу.

Защита от шума:
- Дедупликация в Redis по reason + payload-hash (TTL)
- Rate-limit per recipient
- Cold-start window — первые N часов жизни Org игнорим
- Priority scoring: severity × freshness × engagement

### 5.5. Замыкание контура

Когда пользователь нажал inline-кнопку или ответил текстом:
1. Канал (бот/email/UI) шлёт payload в `ProbeResponseHandler`.
2. Тот создаёт `RawEvent(kind='notification_response')` с метаданными probe.
3. RawEvent попадает в обычный pipeline ingest и сразу обогащает соответствующую сущность (Decision получает decider, Idea — supporter, и т.д.).
4. Если ответ требует ручной кураторской проверки — создаётся `CurationItem`.

Это **критическая фича**: Z не просто пассивно копит знания, а активно дозапрашивает у людей то, чего не хватает.

### 5.6. Отдельно — UI inbox для probe-вопросов

На текущий момент полноценного UI «инбокс probe-вопросов» **нет**: `/me/inbox` — это только список персональных задач исполнителя. Probe доставляется через Telegram-бот и системные уведомления, но единого экрана «все мои уточняющие вопросы» в frontend пока не реализовано. Это потенциальная следующая фаза.

### 5.7. Карта зон-ответственности probe-специалистов

| Зона | Кто следит | Тип вопроса |
|---|---|---|
| Регламенты и процессы | 3-1 | «Кто отвечает?», «Какие шаги?», «Регламент актуален?» |
| Знания людей | 3-2 | «У сотрудника появилась новая компетенция — это планировалось?» |
| Решения | 3-3 | «Кто решил?», «Когда дедлайн?», «Что в итоге?» |
| Контекст карточек | 3-4 | «Чей проект?», «Когда deadline?», «Слить дубль?» |
| Боли и риски | 3-5 | «Spike — нужно внимание?», «Где план митигации?» |
| Идеи | 3-6 | «Поддержать?», «Где статус?» |
| Навыки | 3-7 | «Сотрудник не накапливает решения — норма для роли?» |
| Эксперименты | 3-9 | «Кто отвечает?», «Бежит слишком долго?», «Какие выводы?» |

---

## 6. Цепочки vs одиночки

Пользователь специально просил разделить.

### 6.1. Длинные цепочки (агенты, передающие работу следующим)

1. **Основной ingest-пайплайн** (фундамент всей системы):
   `block-ingest → block-distill (через block-merge) → block-linker (через block-link) → (опц. conflict-report)` + параллельно `axis-classifier`.
2. **Анализ встречи v2** (deprecated в пользу fast):
   `meeting-analyze-v2.cron → meeting-analyze-v2.worker → [chapters-v2 ∥ summary-v2 ∥ tasks-v2] → task-assignee-resolver`.
3. **Анализ встречи fast**:
   `meeting-report-fast.worker (один LLM с tool-call всё-в-одном)`.
4. **Карточные сводки**:
   `block-linker ↗︎ (изменение линка) ↘︎ card-rollup-v2.worker → card-rollup-v2.service (LLM) → curation.triage → (CardVersion auto или CurationItem)`.
5. **Каждый специалист 3-x**: `router → specialist-3-x.worker → service (LLM extract) → merge/dedupe (LLM) → triage → probe.service → ProbeService → notification`.
6. **Клон роли** (самая длинная):
   `reasoning-блок → specialist-3-7.worker → skill-trait-detect (LLM) → concept-normalize → daily decay → role-profile-build (LLM) → executable-persona-compile (LLM) → versioning (Redis lock) → ExecutablePersona → askPerson/askRole (LLM clone-respond)`.
7. **Граф + темы**:
   `entity-resolver.cron → entity-merge.worker (LLM) → entity-graph-builder.cron (LLM judgeRelation) → theme-clusterer (LLM theme-classify)`.
8. **Ночная ревизия**:
   `reframing.cron (LLM анализ блоков + LLM рефлексия тем) → strategic-alignment.cron → strategic-alignment.worker (LLM goal-alignment)`.
9. **Closing-loop идей**:
   `specialist-3-6 → Idea created → EventEmitter 'idea.created' → ideas-closing-loop.handler → sendNotification supporters → (на статус-переходах)`.
10. **Concierge tool-use loop**:
    `user → LLM → tool_call → ToolRouter → DB/API → result → LLM → ... → final answer`.
11. **Probe-замыкание контура**:
    `specialist-probe → ProbeService → sendNotification → user clicks button → ProbeResponseHandler → RawEvent(notification_response) → ingest → специалист обогащает сущность`.
12. **Orchestrator multi-agent**:
    `request → планировщик → до 5 параллельных субагентов → агрегатор → final report`.

### 6.2. Одиночки (standalone-агенты, не вызывают других AI-агентов)

1. **Axis-Classifier** — single-shot классификация по 4 осям.
2. **Core Metrics Snapshot** — снимает gauge'и в Prometheus (без LLM).
3. **Contribution Snapshot** — срез данных для recognition.
4. **Daily Cost Aggregator** + другие admin/economics cron'ы (currency-rate, budget-alert, smoke-test).
5. **Skill Manager Digest** — БД-запрос + ссылка на curation, без LLM.
6. **Activity Feed Digest** — пока только лог-агрегация.
7. **Chat-V2 Cleanup** — maintenance.
8. **Idle Meeting Detector** — пометка зависших встреч.
9. **Director Dashboard Narrative** — генерация одной сводки CEO по запросу (cache 24ч).
10. **Insight-Clusterer** — пересчёт frequency/dynamic-score (математика, без LLM).
11. **Skill-Profile-Recalibrate** — decay (математика).
12. **Process-Template-Completeness** — анализ полноты шаблонов.

### 6.3. Чисто-разговорные одиночки

- **Meeting Chat** — Q&A по одной встрече без следующего шага.
- **Card Chat** — Q&A по одной карточке.
- **Command Palette AI-mode** — one-shot Q&A с inline-ответом.

---

## 7. Общая LLM-инфраструктура (роутер, промпты, эмбеддинги)

### 7.1. LLM-Router

Файл `backend/src/modules/ai/services/llm-router.service.ts`. Центральный диспетчер. Параметры запроса:
- `taskType` — семейство задачи (50+ типов: summary, chapters, tasks, chat-v2, block-ingest, skill-trait-detect, knowledge-clone-extract, clone-respond, executable-persona-compile, theme-classify и т.д.)
- `dataClass` — public < internal < sensitive < private
- `tenantId` — обязателен

**Иерархия dataClass провайдеров**:
- Anthropic — maxDataClass=`sensitive` (но не закупается, см. ниже)
- DeepSeek / OpenAI-via-proxy / KIE / GRSAI — `internal`
- Ollama — `private` (localOnly)

**Fallback**: primary → secondary → tertiary. Каждый уровень логируется в `AiUsageLog` с причиной (timeout, rate_limit, server_5xx).

### 7.2. Провайдеры и модели (verified 2026-05-25)

Источник правды: [llm-providers-verified.md](../01_projects/llm-providers-verified.md).

| Слой | Provider | Модель | Применение |
|---|---|---|---|
| Primary capable (γ-1) | DeepSeek | `deepseek-v4-pro` | summary-v2, goal-alignment, meeting-report-fast, skill-trait-detect (96% golden, $0.02 vs $0.10 у gpt-5.4) |
| Primary стандарт | DeepSeek | `deepseek-v4-flash` | block-ingest, chat-v2, knowledge-core |
| Fallback top | OpenAI via proxy | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` | summary-v2, универсальные |
| Tool-use | OpenAI via proxy | `gpt-4o`, `gpt-4.1` | concierge-respond |
| Tertiary | Ollama (self-hosted) | `qwen3.5:9b` | last-resort |
| A/B (с 2026-05-25) | KIE | Claude Opus 4.7, GPT-5-4, Gemini | эксперименты |
| A/B | GRSAI | Gemini через прокси | эксперименты |
| **Embeddings (единственный)** | proxy | `text-embedding-3-small` (dim=1536) | для pgvector |

Anthropic в продакшене **не используется** (нет ключа, не закупаем). Ollama для embeddings/chat не входит в основной поток (qwen3.5:9b только tertiary).

### 7.3. Prompt Registry

Двойная архитектура:
1. **БД** — `PromptTemplate` + `PromptTemplateVersion`. Scope `system` (глобальные) / `org` (override). Status `active`/`draft`. Версионирование. Редактируется из админки `/admin/prompt-templates`.
2. **Code fallback** — `backend/src/modules/ai/services/prompts/type-*.ts` (type-summary, type-interview, type-sales и др.). Применяется при пустой БД или ошибке.

`PromptResolverService` резолвит по приоритету:
1. Active `PromptExperiment` (фаза A.3 — заведена, не активна)
2. Org-override (scope=org, active)
3. System default (scope=system, active)
4. Code-fallback

Любая ошибка БД → code-fallback + лог warn + метрика `z_prompt_resolver_fallback_total{reason='db_error'}`.

Patch-скрипты в `backend/scripts/`:
- `seed-prompt-templates.ts` — первичное заполнение
- `patch-prompt-*.ts` — безопасные обновления без перезаписи ручных правок (см. skill `safe-seed-rules`)

### 7.4. Эмбеддинги

`KnowledgeEmbeddingService` — обёртка над `EmbeddingFallbackService`. Каскад: OpenAI-proxy `text-embedding-3-small` → local fallback. Сохранение в pgvector (PostgreSQL vector extension). Используется в KNN-поисках (entity-resolver, theme-clusterer, knowledge-clone-merge, clone-respond anti-fake, chat-v2 retrieval). Поиск: raw SQL `embedding <=> $vec::vector`.

Эмбеддингу подвергаются: `IdeaBlock` (`criticalQuestion + ' ' + trustedAnswer`), `Entity` (`canonicalName`), `SkillTraitConcept` (`category + statement`), потенциально `ExecutablePersona`.

### 7.5. Бизнес-метрики

`backend/src/common/metrics/business-metrics.service.ts` (Prometheus):
- `z_llm_cache_hit_total{provider,model,task_type}` — prompt-cache хиты
- `z_llm_cache_read_tokens_total`, `z_llm_cache_creation_tokens_total`
- `z_core_llm_tokens_total{tenant,task_type}`
- `z_core_data_class_violations_total{task_type,attempted_class}`
- `z_core_llm_no_provider_total{task_type}` — когда ни один не подходит
- `z_prompt_resolver_total{source}` — source ∈ db_org / db_system / code_fallback / experiment
- `z_prompt_resolver_fallback_total{reason}`
- `z_prompt_injection_attempt_total{source,pattern}`
- `z_deepseek_schema_to_tool_conversion_total{model}`
- `z_prompt_invalid_response_total{task_type,model,reason}`
- `persona_rebuild_triggered_total{reason}`
- `coo_daily_digest_*` / `coo_weekly_digest_*`
- `clone_ask_total`, `clone_ask_by_owner`
- `core_blocks_total`, `core_entities_total`, `core_links_total`, `core_facts_open_total`

### 7.6. Eval-инфраструктура (scripts/eval)

Новые скрипты (2026-05-25):
- `backend/scripts/eval/judge-dialog-deepseek.ts` — сравнивает 5 раздельных вызовов диалогового слоя vs 1 объединённый. Judge — DeepSeek V4 Pro (с маскированием меток).
- `backend/scripts/eval/judge-kie-claude.ts` — meeting-report-fast: 4 раздельных (chapters/tasks/summary/quality-score) vs 1 unified, через KIE → Claude Opus 4.7 (скидка ~71.5% vs raw Anthropic).
- `backend/scripts/eval/judge-specialists-bplus-vs-g.ts` — гипотеза «Б+ один unified call на 8 типов сущностей ≈ Г восемь раздельных» по качеству, но ~3.7× дешевле. Извлекает decisions, ideas, insights, experiments, regulations, knowledge_categories, skill_traits, helpfulness_traits.

Все читают фикстуры из `test/eval/**/fixtures/*.json`, пишут отчёты в `test/eval/**/reports/*-variant-*.json` + `SUMMARY.md`.

### 7.7. Цены

`backend/src/modules/ai/services/model-prices.ts` — `MODEL_PRICES` + функция `calcCostUsd`. Учитывает prompt-cache (cachedPer1M ≈ −90% от inputPer1M). Fallback БД-таблица `LlmModelPrice`. Скидка DeepSeek V4 Pro действует до 31.05.2026.

---

## 8. Что в discovery / исследовании

Не реализовано полностью или в активной разработке (информация может устареть — проверяй коммиты):

- **AI Value Director** — дизайн готов, частичная реализация. Endpoint `/api/v1/dashboard/value-director` есть, но полный цикл daily/weekly/monthly/quarterly + proactive алерты — план.
- **Inbox для probe-вопросов** — UI-страницы со списком всех уточняющих вопросов нет. Сейчас доставка только через Telegram + push.
- **Голосовой ввод в Concierge (γ-2)** — `ConciergeVoice.tsx` написан, не интегрирован. По продуктовому решению (см. memory) — голос только на вход, не на выход.
- **PromptExperiment / A/B-промпты (фаза A.3)** — таблица и резолвер готовы, активных экспериментов нет.
- **Activity Feed Digest** — доставка через каналы (Telegram/email) — TODO, сейчас только логирует.
- **Meeting-Report-Fast vs Meeting-Analyze-V2** — fast в роли primary, v2 помечен `@deprecated`, но обе ветки пока живут параллельно.
- **B+ unified-call экстракция (8 типов сущностей одним вызовом)** — гипотеза в эвалюации (`judge-specialists-bplus-vs-g`), production-rollout — следующая волна.

---

**Конец карты.** При добавлении нового агента — добавь строку в соответствующую таблицу и краткое описание. При удалении — убери и пометь в `code-pitfalls.md`, если есть подводные камни.

---
type: analysis
status: research-complete
feature: extraction-agents-inventory-and-modular-standardization
date: 2026-06-29
snapshot_date: 2026-06-29
owner: Сергей (владелец продукта Кора)
related:
  - plans/analysis/2026-06-22-unified-extraction-spine-and-modular-extractors.md
  - plans/analysis/2026-06-29-task-extraction-pipeline-unification.md
  - plans/analysis/2026-06-29-conflict-detector-vs-graph-report.md
  - plans/analysis/2026-06-29-operational-inspectors-cleanup.md
  - plans/analysis/2026-06-29-commitment-task-unification.md
  - second-brain/02_architecture/knowledge-core.md
method: vexp + Read по коду + многоагентный fan-out (8 семейств) + критик-полноты; всё [verified по коду], где не помечено иначе
---

> Вопрос владельца (2026-06-29): «Сколько у нас агентов, которые вытаскивают сущности (задачи, решения, обещания, цели, выполнение задач), и кто откуда берёт вход? Сейчас хаос — разные агенты тянут данные из разных источников (детектор конфликтов вообще читает regex-ом текст чек-ина, а не граф). Хочу стандартизацию: единый хаб, куда стекается всё, и любой новый агент-нарезчик берёт сущность ОТТУДА. Найди всех, пойми вход, краткое описание, разбей по модулям — что можно объединить.»

# Инвентарь агентов-экстракторов Коры и план модульной стандартизации

## 0. Главный вывод (переворачивает постановку)

**Хаб, которого тебе «не хватает», уже построен и работает.** Это связка `block-ingest` (нарезчик) → `signalType` → `RouterService`. Любой источник проходит через ОДНУ точку входа `IngestService.ingest` → `RawEvent` → нарезчик режет на `IdeaBlock` и **классифицирует каждый блок одним из 56 `signalType`** → `RouterService` статически диспатчит блок специалистам по `signalType`. Это и есть «единая точка, куда стекается вся информация, и откуда любой специалист забирает свою сущность».

**Хаос — не в отсутствии хаба, а в агентах, которые хаб ОБХОДЯТ.** Их ровно три типа, и все три — твои примеры:
1. **Детектор конфликтов** читает regex-ом сырой текст чек-ина и **полностью игнорирует** `signalType=team_friction/process_friction`, которые нарезчик уже разметил в графе ([conflict-detector-vs-graph-report](2026-06-29-conflict-detector-vs-graph-report.md)).
2. **Задачи** извлекаются **5 путями**, из которых только часть идёт через спайн ([task-extraction-pipeline-unification](2026-06-29-task-extraction-pipeline-unification.md)).
3. **Обещания** читают `signalType=commitment` **тремя** независимыми потребителями в трёх модулях (probe / cascade / snapshot) — сейчас сносится ([commitment-task-unification](2026-06-29-commitment-task-unification.md)).

Плюс единичные деривативы создают сущности **мимо `signalType`** (напр. `ThemeSilenceDetector` пишет `Insight` без `IdeaBlock`).

**Принцип стандартизации, который из этого следует (одной фразой):** *любой агент, который что-то «вытаскивает», обязан брать вход из графа по `signalType` (из хаба), а не перечитывать сырой текст или ходить в источник напрямую.* Детектор конфликтов — эталонный антипример; миграция его на graph-derive — образец для всех.

---

## 1. Архитектура одним взглядом — конвейер уже «хаб-и-спицы»

```
  ИСТОЧНИКИ (каналы)                 ХАБ                           СПЕЦИАЛИСТЫ-НАРЕЗЧИКИ            ДЕРИВАТИВЫ
  ─────────────────                  ───                           ──────────────────              ──────────
  встречи (LiveKit)  ┐
  chatbox / Bitrix   │   IngestService.ingest                     RouterService.dispatch          кластеризация (Theme/Idea/Insight)
  Telegram / MAX     ├──►   → RawEvent  ──► block-ingest ─► IdeaBlock ──(по signalType)──►  3-1 regulations    профили (clone/skill/persona/role)
  email / звонки     │      (1 точка)      (НАРЕЗЧИК)     +56 signalType                    3-2 knowledge-clone снапшоты дашборда (риск/прогноз)
  документы / dump   │                     + типизир.                                       3-3 decisions       детекторы конфликтов/отношений
  tracker-события    ┘                     сущности                  ▲                       3-5 insights        completion-петля задач
                                           (process/...)             │                       3-6 ideas
  ── ОБХОД ХАБА (хаос) ──                                            │ matchSpecialists       3-7 skill
  telegram-task-parser ─────────────────────────► IntakeIssue       │ switch(signalType)    3-8 helpfulness
  me-tasks (помощник)  ─────────────────────────► Issue (напрямую)  │                       3-9 experiments
  conflict-detector ─── regex по тексту чек-ина ─► EntityLink        │                      3-14 goals
                        (игнорит team_friction в графе!)             │                      3-15 tasks
                                                          block-distill→canonical
```

Пять логических слоёв (это и есть «модули», по которым тебя надо разложить):

| Слой | Что делает | Сколько агентов | Куда пишет |
|---|---|---|---|
| **L0. Каналы-ингесторы** | приём источника → `RawEvent` | ~15 правильных + 2 обхода | RawEvent |
| **L1. Нарезчик (спайн)** | `RawEvent` → `IdeaBlock` + `signalType` + типизир. сущности | 7 компонентов (1 конвейер) | IdeaBlock, Entity, граф |
| **L2. Роутер** | диспатч блока специалистам по `signalType` | 1 (+ диспетчер) | очередь `core.specialist-routing` |
| **L3. Граф-специалисты (первичные экстракторы)** | блок → бизнес-сущность | 15 + combined | Decision/Idea/Issue/Goal/… |
| **L4. Probe-инспекторы** | спрашивают про сущности (не извлекают) | ~24 | ProbeEvent / нудж |
| **L5. Деривативы** | из графа/сущностей деривят высшие сущности и метрики | ~70 | Theme/профили/снапшоты/рёбра |

Всего «агентов» в широком смысле — **150+**. Но **первичных экстракторов сущностей** (то, что ты называешь «нарезчиками» — кто из сырья достаёт задачу/решение/обещание/цель/выполнение/конфликт) — **компактный набор**, см. §3.

---

## 2. Главная карта: `signalType` → специалист (мастер-таблица диспатча)

Это и есть тот «единый реестр», вокруг которого крутится вся идея. `RouterService.matchSpecialists` — `switch(signalType)` (без LLM в основном пути). [verified: router.service.ts]

| `signalType` (вход) | Специалист (кто забирает) | Производит сущность |
|---|---|---|
| `decision`, `rationale`, `decision_basis` | **3-3 decisions** | `Decision` |
| `regulation`, `process_step` | **3-1 regulations** (+ `3-1-process-detector` для process/methodology) | `Regulation/Process/Policy/Instruction`, `ProcessTemplate` |
| `methodology_step` | `3-1-process-detector`, `3-8-role-map-builder`, `3-7 skill`(если employee) | `ProcessTemplate`, `RoleMap`, `SkillTrait` |
| `pain`, `risk`, `churn_risk`, `objection`, `blocker`, `resource_gap` | **3-5 insights** | `Insight` |
| `team_friction`, `process_friction` | **3-5 insights** + **3-12 personal-relation** | `Insight` + `EntityLink(conflicted_with)` |
| `idea`, `feature_request` (`suggestion`/`client_request` — роутятся, но service-гард их роняет) | **3-6 ideas** | `Idea` |
| `expertise`, `experience`, `competence` | **3-7 skill** + **3-2 knowledge-clone** (оба если employee-subject) | `SkillTrait`, `KnowledgeProfile` |
| `reasoning` | **3-7 skill** (если employee-subject) | `SkillTrait` |
| `lesson`, `hypothesis`, `result` | **3-9 experiments** (всегда) + 3-7 skill (если employee) | `Experiment` |
| `fact` | **3-4 project-customer** (если customer/project entity) + **3-2 knowledge-clone** (если employee-mention) | пересборка `Card` / `KnowledgeProfile` |
| `knowledge_gap`, `question` | **3-2 knowledge-clone** | `KnowledgeProfile` |
| `commitment`, `plan_item` | **3-14 goals** | `Goal` |
| `action_item` | **3-15 tasks** | `IntakeIssue` → `Issue` |
| `help_provided`, `proactive_hint`, `mentoring`, `emotional_support`, `constructive_feedback`, `question_unanswered`, `helped_by/to`, `thanks_explicit`, `task_comment`, `task_mention` | **3-8 helpfulness** | `HelpfulnessTrait` |
| `expertise`, `competence`, `methodology_step` | **3-8 role-map-builder** | `RoleMap` (responsibility/authority/...) |
| `brand_principle` | *(no-op — `BrandVoiceExtractorCron` читает их кроном, а не через router)* | `BrandVoice` |
| `done_item`, `task_completed`, `task_status_changed` | **emit `task.completion_signalled`** → `TaskCompletionHandler` (operations) | закрытие `Issue` (не извлечение) |
| `commitment_status` | **emit `commitment.status_received`** → `CommitmentResponseHandler` (operations) | `commitment_status`-блок (сносится) |
| `mood`, `drift`, `competitor_move`, `metric_change` | **default → 0 потребителей** (LLM-fallback OFF) | нигде (потребитель не реализован) |
| `task_created/blocked/overdue/reassigned` | default → 0 (tracker-эхо, не линкуется) | нигде (осознанно) |

**Две асимметрии в самой карте (важно для стандартизации):**
- **Роутер шире/уже воркеров.** Диспетчер регистрирует **15** хендлеров, а `switch` умеет диспатчить **13** (2 — `role-map-builder` и `sprint-helper` — приезжают мимо `signalType`, из `processes`/`projection-rebuilder`). А внутри 3-6/3-7 service-гард уже роутерного списка → `suggestion`/`client_request`/`expertise` могут молча отбрасываться (пробел охвата).
- **Combined переписывает карту.** При `specialistsCombined.enabled` 9 специалистов (3-1/3-2/3-3/3-5/3-6/3-7/3-8/process-detector/3-9) **вырезаются** из диспатча и заменяются ОДНИМ combined-проходом (meeting-only). См. §4.

---

## 3. Первичные экстракторы сущностей — ядро ответа на твой вопрос

Это «нарезчики» в твоём смысле: из сырья достают конкретную бизнес-сущность. Каждый — один файл-сервис, вход = `IdeaBlock` нужного `signalType`, выход = одна сущность.

| # | Агент | Вход (что читает) | Сущность (выход) | Триггер | Промпт | В combined? |
|---|---|---|---|---|---|---|
| 3-1 | **Specialist31 regulations** | блок `regulation`/`process_step` + evidence | `Regulation`/`Process`/`Policy`/`Instruction` | router по signalType | `regulation-extract`, `regulation-dedupe` | да |
| 3-1d | **ProcessDetectorWorker** | блок `process_step`/`methodology_step` (батч) | `ProcessTemplate` | router | `process-template-extract` | — |
| 3-2 | **Specialist32 knowledge-clone** | блок про employee + упоминания | `Person.knowledgeProfile`, категории | router / rebuild-cron | `knowledge-clone-extract/-merge` | да |
| 3-3 | **Specialist33 decisions** | блок `decision`/`rationale`/`decision_basis` + KNN | `Decision` (+supersede-цепочки) | router | `decision-extract`, `decision-supersede-detect` | да |
| 3-4 | **Specialist34 project-customer** | блок `fact` + customer/project entity | *(не сущность — enqueue пересборки `Card`)* | router | — (без LLM) | нет |
| 3-5 | **Specialist35 insights** | блок боль/риск/блокер/трение + KNN | `Insight` (+ линк к Decision) | router | `insight-extract`, `insight-link-to-decisions` | да |
| 3-6 | **Specialist36 ideas** | блок `idea`/`feature_request` + дедуп | `Idea` | router | `idea-extract` | да |
| 3-7 | **Specialist37 skill** | блоки employee (reasoning/methodology…) | `SkillProfile` + `SkillTrait` | router | `skill-trait-detect/-merge/-verify` (4 промпта) | да |
| 3-8 | **Specialist38 helpfulness** | блоки helpfulness (12 типов) | `HelpfulnessTrait` | router | `helpfulness-detect`, `-trait-merge` | да |
| 3-9 | **Specialist39 experiments** (воркер `experiment-detector`) | блок `hypothesis`/`result`/`lesson` | `Experiment` | router | `experiment-extract` | да |
| 3-12 | **PersonalRelationBuilder** | блок `team_friction`/`process_friction` с ≥2 person | `EntityLink(conflicted_with)` | router | — | нет |
| 3-14 | **Specialist314 goals** | блок `commitment`/`plan_item` + KNN | `Goal` (+ иерархия) | router | `goal-extract`, `goal-hierarchy-link` | нет |
| 3-15 | **Specialist315 tasks** | блок `action_item` (НЕ meeting) | `IntakeIssue` → `Issue` | router | `task-extract` | нет |

**Сущности, которые собираем (список «что»):** `Decision`, `Idea`, `Insight`, `Regulation`/`Process`/`Policy`/`Instruction`/`ProcessTemplate`, `Goal`, `Issue`/`IntakeIssue`, `Experiment`, `SkillProfile`/`SkillTrait`, `KnowledgeProfile` (Employee Clone), `HelpfulnessTrait`, `PracticeSkill`, `ExecutablePersona`, `RoleProfile`/`RoleMap`, `Card`, `Theme`, `Entity`/`EntityLink`, `BrandVoice`, `Recognition`, `CustomerRiskSnapshot` и др. снапшоты. Плюс граф-примитивы `IdeaBlock`/`Evidence`.

**Где «выполнение задач» (твой пример):** это НЕ извлечение, а **закрытие петли**. `signalType=done_item/task_completed/task_status_changed` нарезчик эмитит событием `task.completion_signalled` → `TaskCompletionHandler` (operations) матчит с открытой `Issue` и закрывает. Рядом `TaskReconcileCron` подбирает пропущенные матчи, `ProgressAutoDraftCron` черновит апдейты прогресса, `me-tasks.completeTask` + probe `task.completion_detail_missing` спрашивают «что конкретно сделал». Новый агент «расскажи как решал» ([task-completion-method-capture](2026-06-29-task-completion-method-capture.md)) встаёт ровно сюда — на переход `Issue→completed`.

---

## 4. Параллельный meeting-путь (вторая ось, источник дублей)

Встреча запускает **оба** конвейера ([analyze.worker](../../backend/src/modules/ai/workers/analyze.worker.ts)):

| Агент | Вход | Выход | Заметка |
|---|---|---|---|
| **block-ingest** (через `ingestMeeting`) | транскрипт → сегменты | `IdeaBlock` + граф | общий нарезчик — питает ВСЕ сущности |
| **MeetingExtractActionsService** | **полный транскрипт** + participants + roomChat | `IntakeIssue` (задачи) | промпт `tasks-unified`; **дубль с 3-15** |
| **SpecialistsCombinedService** | canonical-блоки одной встречи | **8–9 сущностей за 1 LLM** | Decision/Idea/Insight/Experiment/Regulation/Instruction/KnowledgeCategory/SkillTrait/HelpfulnessTrait |
| **MeetingReportFastWorker** | полный транскрипт | главы+саммари+качество (поле `tasks` — **мёртвый выход**) | за флагом |

**Ключевое для модуляризации:** `SpecialistsCombined` — это **уже готовый образец слияния**: один промпт делает работу 8 раздельных специалистов, и по замеру выигрывает у них **18:13 по качеству и в 3.7× дешевле**. Но он (а) meeting-only, (б) **не покрывает goals и tasks** (8 из 10 сущностей), (в) per-block специалисты **продолжают существовать** параллельно как router-путь. Это прямой дубль — кандидат №1 на консолидацию (§10).

---

## 5. Probe-инспекторы — «агенты, которые задают вопросы» (~24)

Они **не извлекают** сущности, а спрашивают про них (нудж/уточнение в Telegram). Все шлют через `ProbeService.suggest` (+ хрупкий fallback `sendNotification` во ВСЕХ specialist-probe, минующий dedup).

| Инспектор | На что смотрит | Повод (reason) | Триггер |
|---|---|---|---|
| 3-1 / process-template probe | Regulation/Process без владельца/шагов/scope | `regulation.*`, `process_template.*` | on-ingest + `@Cron 0 3` |
| 3-2 knowledge probe | новая экспертиза / противоречие | `knowledge.*` | on-rebuild |
| 3-3 decisions probe | решение без owner/срока/итога | `decision.*` | on-ingest + `@Cron 0 5` |
| 3-4 card probe | карточка без срока/устаревшая | `card.*` | on-rollup |
| 3-5 insights probe | инсайт без плана митигации / spike | `insight.*` | event + `@Cron 0 */6` |
| 3-7 skill probe (CDM) | «почему так решил» (интервью) | `skill.cdm_interview` | on-rebuild |
| 3-9 experiment probe | эксперимент без owner / висит >30д | `experiment.*` | event + `@Cron 0 */6` |
| 3-14 goals checkpoint | KR-чекпойнт при `Idea→shipped` | `goal.kr_checkpoint_suggested` | event |
| 3-15 / me-tasks task probe | задача без исполнителя/срока/деталей закрытия | `task.assignee_unresolved/due_date_missing/completion_detail_missing` | on-ingest / из чата |
| **TemporalProbe** | устаревший факт vs свежий | `temporal.fact_stale_contradiction` | `@Cron 0 7 * * 1` |
| **ProactiveWatcher** (7 правил) | insight/experiment/process/role/dept/plan-overdue | `proactive.*` | `@Cron 0 */6` |
| **ConsistencyChecker** (R1–R6) | документ без процесса, шаг без owner, компания без MVS | `consistency_violation.R1..R6` | `@Cron 0 */4` |
| **CompanyProfileCompleteness** | пустые mission/vision/strategy | `companyprofile.missing_*` | `@Cron 0 4` |
| **Strategic/GoalAlignment** | работа не привязана к целям | `strategic_misalignment_high`, `goal_alignment_low` | `@Cron` |
| **Specialist38 helpfulness probe** | вклад без признания | `helpfulness.*` | `@Cron 0 10` |
| **BlockIngest attribution probe** | entity клиент/вендор без атрибуции | `attribution.unresolved_at_ingest` | on-ingest |
| **3-9 promise-keeper** (commitment) | обещание просрочено / молчит | `commitment.followup/silence_escalation` | `@Cron 0 *` |
| **CommitmentResponseHandler** | ответ на followup | пишет `commitment_status` | event |
| **PromiseCascadeCron** | обещание блокирует чужую цель | нудж `promise_cascade` | `@Cron 0 8` |

**Сносится сегодня:** весь `decision.*` инспектор (Specialist33Probe + нудж) и весь `commitment.*` соц-слой (3-9 promise-keeper, CommitmentResponseHandler, PromiseCascade) — [operational-inspectors-cleanup](2026-06-29-operational-inspectors-cleanup.md), [commitment-task-unification](2026-06-29-commitment-task-unification.md). Из задачных остаются и чинятся A+B (адресат = автор реплики; добавить probe срока).

**Находки-дубли probe-слоя:**
- **probe ↔ proactive по одному условию:** `insight.no_mitigation_plan` (3-5 probe) И `insight_no_mitigation` (proactive) — две петли/два дедупа. То же `experiment.running_too_long`.
- **structure ↔ probe:** `consistency_violation.R6` (компания без MVS) ↔ `companyprofile.missing_*` — один предмет, разные reason/каналы. `R3` (шаг без owner) ↔ `process_template.step_without_owner`. `strategic_misalignment_high` ↔ `goal_alignment_low`.
- **Мёртвый код:** `Specialist36ProbeService` (idea probe) не вызывается нигде. `decision.*` apply-ветка жива в `ProbeResponseHandler`, но emit-стороны нет (заготовка).
- **Двойной closing-loop на `notification.responded`:** универсальный `ProbeResponseHandler` + узкий `CommitmentResponseHandler`. После сноса commitment — второй удалить.

---

## 6. Детекторы конфликтов/отношений — твой исходный триггер

**Два независимых детектора `conflicted_with` живут в ОДНОМ файле и не согласованы** ([personal-relation-builder.worker.ts](../../backend/src/modules/operations/workers/personal-relation-builder.worker.ts)):

| | CheckInConflictDetectorCron | PersonalRelationBuilderWorker |
|---|---|---|
| Источник | **regex по сырому тексту чек-ина** (`rawResponseText`+plans+dones+blockers) | **граф**: `IdeaBlock` `team_friction`/`process_friction` |
| Триггер | `@Cron 0 4` (UTC) | router-dispatch по signalType |
| Условие | паттерн «X с Y», именительный падеж, кириллица, корень 3 буквы | **≥2 person-сущности в одном блоке** |
| confidence | 0.55 (хардкод) | 0.65 (хардкод) |
| Слепая зона | игнорит `team_friction`/`process_friction` из графа | трение с **одним** названным человеком не даёт ребра |

**Это эталон хаоса, о котором ты говоришь:** один детектор regex-ит синтезированный текст, второй читает граф, оба пишут одно ребро с разным confidence, и **между ними дыра** — конфликт из чата/Bitrix, размеченный нарезчиком как `team_friction`, до regex-детектора не доходит, а graph-детектор его не берёт (нужно ≥2 person в блоке). Решение уже описано: мигрировать оба на единый **graph-derive по `signalType`** ([conflict-detector-vs-graph-report](2026-06-29-conflict-detector-vs-graph-report.md), вариант A) — ровно «бери из хаба, не regexь текст».

---

## 7. Деривативный слой (builders/snapshots/profiles) — ~70 агентов

Не извлекают из сырья, а **из графа/сущностей деривят высшие сущности и метрики**. Сгруппированы по подсистемам (полный список — приложение А):

- **Граф-гигиена:** `EntityResolver` (cron+worker, дедуп сущностей), `EntityGraphBuilder` (рёбра), `block-linker`, `Reframing`.
- **Темы:** `ThemeClusterer` + `ThemeSummarize` + `Reframing` (3 пересекающихся), `TopicRecurrenceDetector`.
- **Кластеризация:** `IdeaClusterer` + `InsightClusterer` (почти идентичны, `clustering.service` пустой).
- **Профили человека:** knowledge-clone (cron+worker), skill-clone (**7 агентов**: rebuild/recalibrate/verify/concept-normalize/manager-digest + practice-skill extract/evaluate), executable-persona (build-cron + trigger-watcher + service + validation), role-profile/role-principle/role-map.
- **Компания/структура:** `CompanyProfileBuilder`/`SummaryCompiler`/`Completeness`, `DepartmentDetector`, `DomainExpander`, `MaturityScorer` (дубль-зона со `structure`).
- **Operations-снапшоты:** `BlockerSynthesis`, `CustomerRiskRadar`, `KnowledgeAtRisk`, `PortfolioHealth`, `OnboardingRamp`, `DecisionImplementation` (сносится).
- **Dashboard-снапшоты (критик добрал, ~10):** `Forecaster`, `EngagementScorer`, `BusFactorAnalyzer` (**дубль `KnowledgeAtRisk`!**), `KnowledgeVelocity`, `GoalVectorTracker`, `HrRecommender`, `TeamHealthAnalyzer`, `ThemeSilenceDetector` (**создаёт `Insight` без `signalType`!**), `PromiseNetworkAnalyzer` (сносится).
- **Чек-ин-энричеры (критик добрал):** `CheckinSentimentBatch` + `ReflectionQualityScorer` + `BurnoutRiskDetector` (три энричера одной `DailyCheckIn`).
- **Задачная петля:** `TaskCompletionHandler`, `TaskReconcile`, `ProgressAutoDraft`, `GoalTaskLinker`, `GoalThemeLinker`, `GoalCascade`.
- **Дедуп-пост:** `RegulationConsolidator` (cron+worker), `CurationItemLifecycle` (**дубль expire с `TaskReconcile`**), `ConflictArbiter`.
- **Соц-слой:** `Recognition` (formulate/contribution/badge/streak/digest).

---

## 8. Каналы-ингесторы (L0) и асимметрия «через спайн vs мимо»

**Правильно (через `IngestService.ingest` → нарезчик):** chatbox, Bitrix (диалоги+CRM-дайджест), free-note, message-bridge, документы, email, телефония (Mango), web-form/dump, tracker-события (обратная петля Issue→граф), report-adapter. ~15 каналов — расширяемость подтверждена: новый канал = 1 адаптер.

**Обход хаба (хаос):** `telegram-task-parser` → `IntakeIssue` напрямую; `me-tasks` (помощник) → `Issue` **сразу** (даже не IntakeIssue — асимметрия двух «помощник»-путей); concierge-тулы создают Issue/Meeting/Event минуя граф. Задача из чата **не проходит граф знаний** — только постфактум через `tracker.event_occurred`.

**Развилка двух Telegram (не путать):** `conversational/adapters/telegram-bot` — глобальный бот-помощник Коры (assistant/free-note/checkin); `ingest/adapters/telegram` — per-source бот-источник для ингеста чужих чатов в спайн.

**Замечание:** chat-v2 / dialog-layer — это **retrieval** (вопрос→ответ по графу), а НЕ извлечение из диалога. Диалог с Корой сущности не порождает (только явные concierge-тулы).

---

## 9. Где именно хаос (сводка обходов хаба)

1. **Конфликты** — regex по тексту чек-ина мимо `team_friction` в графе (§6).
2. **Задачи** — 5 путей, разная политика материализации (IntakeIssue vs Issue), дедуп только эмбеддинговый внутри Issue (§4, §8).
3. **Обещания** — 3 потребителя `signalType=commitment` в 3 модулях (probe/cascade/snapshot) (§5).
4. **Insight производится двумя путями** — через нарезчик (3-5) и `ThemeSilenceDetector` мимо `signalType`.
5. **Дубли деривативов:** `BusFactor`↔`KnowledgeAtRisk`; `IdeaClusterer`↔`InsightClusterer`; `CompletenessScanner`↔`ConsistencyChecker`↔`MaturityScorer`; `CurationItemLifecycle`↔`TaskReconcile` (expire); `CheckinSentiment`↔`ReflectionQuality` (энрич одной сущности); 3 темо-агента; 2 закрывателя `notification.responded`.
6. **probe ↔ proactive** дублируют поводы (insight/experiment).
7. **Промпты извлечения — code-константы мимо admin-registry** (редактируется только report-промпт); дискриминатор класса прописан трижды (§11).
8. **Хардкод-крутилки** (нарушение принципа 9): confidence 0.55/0.65 у детекторов, веса maturity 0.4/0.3/0.3, окна promise 60д и т.д.

---

## 10. Предложение по модульной стандартизации

### 10.1. Один принцип (инвариант для всех агентов)

> **«Derive-from-graph-by-signalType».** Никакой агент не читает сырьё (текст чек-ина, транскрипт, чат) напрямую и не ходит в источник — он подписывается на `IdeaBlock` нужного `signalType` из хаба. Новый «нарезчик» = новый `case` в router + один specialist, **а не** новый воркер со своим чтением источника. Любое создание сущности мимо `signalType` — нарушение, как `process.env` мимо `env.schema`.

### 10.2. Группировка по модулям (целевая раскладка)

| Модуль | Что входит | Действие |
|---|---|---|
| **`extraction/spine`** | ingest, block-ingest, distill, router, dispatcher | оставить как ядро-хаб |
| **`extraction/specialists`** | 3-1…3-15 + **combined** | свести per-block в combined (10.3) |
| **`extraction/tasks`** (новый единый) | 3-15 + meeting-extract + telegram + me-tasks + report-fast.tasks | **один** conversation-экстрактор задач (10.4) |
| **`graph/dedup-cluster`** | entity-resolver, idea/insight-clusterer, theme-*, regulation-consolidator | слить кластеризацию; согласовать темо-агентов |
| **`profiles`** | knowledge-clone, skill-clone (7), persona, role-* | единый оркестратор rebuild профилей |
| **`relations`** (новый) | оба конфликт-детектора + personal-relation | **graph-derive по friction-signalType** (10.5) |
| **`probe`** | все probe-инспекторы + proactive | единый probe-генератор, убрать probe↔proactive дубли (10.6) |
| **`dashboard/snapshots`** | forecaster/engagement/bus-factor/health/risk/velocity | слить дубли (bus-factor↔knowledge-risk) |
| **`checkin`** | sentiment + reflection-quality + burnout | один checkin-enrichment слой |
| **`task-loop`** | completion/reconcile/progress/expire | один reconcile/expire слой |

### 10.3. Слияние №1 (наибольший выигрыш): добить `SpecialistsCombined`

`SpecialistsCombined` уже доказал: 1 промпт > 8 раздельных (18:13, 3.7× дешевле). Шаги:
1. Обобщить combined с meeting-only на **все каналы** (per-block специалисты выпиливаются в пользу одного combined-прохода по «единице понимания»).
2. **Добавить goals и tasks** в combined (сейчас 8 из 10 сущностей) — закрыть асимметрию.
3. Перевести промпт combined в **admin-editable registry** (в коде помечено «следующая волна»).
> ⚠️ Риск, уже зафиксированный в [unified-extraction-spine §6](2026-06-22-unified-extraction-spine-and-modular-extractors.md): дробление/обобщение combined **ломает prompt-cache** и риск регресса качества — поэтому goals/tasks добавлять В combined, а не выносить combined на per-channel поштучно. Это требует замера.

### 10.4. Слияние №2: единый экстрактор задач («унификация вверх»)

Уже доказано в [task-extraction-pipeline-unification](2026-06-29-task-extraction-pipeline-unification.md) (вариант 2): один движок извлечения задач из **разговора целиком** для всех каналов (как у встреч), per-block 3-15 выводится. Цена — сессионизация стриминговых каналов. Закрывает 4 промпта (task-extract / tasks-unified / report-fast.tasks / telegram-inline) и 5 путей в один.

### 10.5. Слияние №3: единый детектор отношений (твой триггер)

Снести regex-детектор, оставить **один graph-derive** поверх `team_friction`/`process_friction` + упоминания людей через entities → `EntityLink`. Различать тип ребра (team vs process). Confidence — в AdminSetting. Восстанавливает чат/Bitrix-охват семантически. ([conflict-detector-vs-graph-report](2026-06-29-conflict-detector-vs-graph-report.md) вариант A).

### 10.6. Слияние №4: probe-слой

Единый probe-генератор поверх `ProbeService`: убрать дубль-канал `sendNotification` (минует dedup), схлопнуть probe↔proactive по одному условию, удалить мёртвый idea-probe, после сноса commitment — убрать второй closing-loop. Реестр reason-кодов синхронизировать с эмиттерами (сейчас часть reason не в `PROBE_REASON_WINDOW` → уходят устаревшими).

### 10.7. Реестр экстракторов (трек B — отложить)

Внешний паттерн `EntityHandler`-registry (NestJS `DiscoveryService`) превращает «новая сущность = правка в 5 местах» в «1 файл». Но это quality-улучшение под будущие сущности, **не лечит** фрагментацию задач; на масштабе Z (1 команда) рефакторить работающие специалисты ради симметрии — карго-культ. **Делать только когда появится реальная N+1 сущность**, начав с 9 хардкод-persist в `specialists-combined.service.ts`. ([unified-extraction-spine §7](2026-06-22-unified-extraction-spine-and-modular-extractors.md)).

---

## 11. Промпты — отдельная ось консолидации

- **Два несвязанных «реестра»:** admin-editable `PromptResolverService`/`PromptTemplatesService` покрывает **только report-промпты** (taskType×meetingType); ВСЕ extraction-промпты (block-ingest, `*-extract`, combined, tasks-unified) — статичные **code-константы мимо реестра** (не редактируются из админки).
- **Дискриминатор класса прописан трижды** (block-ingest / combined / per-block) с вариациями — риск расхождения. Часть уже вынесена в `common.ts` (`withDecisionDiscriminator`, `withNotATaskDiscriminator`, `task-decision-examples.ts`) — **это базис консолидации**, расширять его, а не плодить инлайн-копии.
- **`telegram-task-parser` держит system-промпт ИНЛАЙН в коде сервиса** — мёртвая зона для registry; вынести в `prompts/`.
- **8 per-block extract-промптов дублируют combined** — выпил после полного перехода на combined (10.3).

---

## 12. Что дальше

1. Этот инвентарь — вход для **ТЗ на упрощение**. Порядок приоритета слияний: §10.5 (конфликты, малый blast-radius, твой триггер) → §10.4 (задачи, уже доказано) → §10.6 (probe) → §10.3 (combined, требует замера на prompt-cache) → дедупы деривативов (§9.5).
2. Перед ТЗ — закрыть осознанные пробелы охвата из §2 (3-6/3-7 service-гард роняет блоки) и §6 (дыра конфликтов).
3. Через `solution-blueprint` → `tz-author` по каждому слиянию отдельно (не бандлить — разные зоны риска).

---

## Приложение А. Метод и оговорки

- Источник: многоагентный fan-out по 8 семействам (spine / graph-specialists / meeting / probe / operations / channels / derived / prompts) + критик-полноты; ~150 агентов, всё `[verified по коду]` через vexp+Read (Grep маскируется vexp-хуком).
- `[уточнить при ТЗ]`: критик добрал ~22 dashboard/checkin-агента по триггерам `@Cron`/`@Process` — их точные сущности-выходы и пересечения подтвердить картографией перед ТЗ (часть имён — по структуре, не по полному Read).
- Номерные ловушки: `3-8` = ДВА разных специалиста (`helpfulness` и `role-map-builder`); `3-9` сервис `experiments`, но воркер `experiment-detector` (нет `specialist-3-9-*.worker`); `3-4` — единственный «специалист» без `*.service.ts`.
- Совпадает с уже принятыми решениями владельца: снос `decision.*`/`commitment.*` инспекторов, унификация задач «вверх», graph-derive конфликтов.

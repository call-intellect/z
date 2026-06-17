---
type: tz
status: draft
feature: Симулятор месяца работы компании на 20 человек — реальные вызовы DeepSeek через весь pipeline Z для проверки сквозной работоспособности и расчёта unit-economics
date: 2026-05-25
relates_to:
  - plans/archive/2026-05-25-demo-mode-tz.md
  - second-brain/01_projects/ai-analysis-by-type.md
  - second-brain/01_projects/ai-jobs.md
  - second-brain/01_projects/workers-queues.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/module-map.md
depends_on: []
---

# ТЗ: Симулятор месяца работы компании (Simulation Harness)

> **Это НЕ маркетинговый демо-кабинет** (см. `2026-05-25-demo-mode-tz.md` — там статичная JSON-фикстура без реальных вызовов агентов).
> Это **внутренний QA-стенд на проде**: одна синтетическая Org, реальные вызовы DeepSeek через всю систему, кабинет живёт постоянно, super-admin вручную запускает прогоны и наблюдает.

## Цель

Один раз настроить и запускать по кнопке полную имитацию месячной работы компании из 20 синтетических сотрудников: встречи всех 9 типов, чек-ины утром и вечером, чаты, трекер-события, AI-отчёты, граф знаний, темы, клоны ролей, дашборд директора. Все вызовы LLM — настоящие, через `LlmRouterService` к DeepSeek. По итогам прогона автоматически считаем 14 smoke-проверок (всё ли реально работает) и выгружаем фактическую стоимость месяца из `AiUsageLog` — это unit-economics для будущего тарифа.

**Зачем это нужно:**

1. **Проверить сквозную работоспособность.** Сейчас в проде ~85 cron'ов и воркеров; никто никогда не прогонял их в связке на «полнометражном» сценарии. Симулятор находит мёртвых агентов, сломанные стыки, неработающие цепочки до того, как платящий клиент столкнётся.
2. **Посчитать реальную цену месяца на 20-человек-компанию.** Все вызовы DeepSeek логируются в `AiUsageLog` с `costUsd/costRub`; постфактум выгружаем разбивку по taskType / провайдеру / дню. Это база для ценообразования тарифа.
3. **Иметь живой кабинет для ручной проверки.** После прогона super-admin (владелец продукта) заходит как обычный owner, задаёт вопросы AI-чату компании, общается с клонами ролей, листает дашборд директора — проверяет «выглядит ли это вообще как настоящая работающая система».

## Scope

**Входит:**

- Новые поля `Org.kind: 'real' | 'internal_test'` и `User.isSynthetic: Boolean @default(false)`.
- Новые модели `SimulationRun` и `SimulationEvent` — журнал прогонов и их событий.
- Новый Nest-модуль `backend/src/modules/simulation-harness/` с сервисами:
  - `MonthPlanGenerator` — LLM-генератор плана месяца (5–7 сюжетных линий, 22 рабочих дня).
  - `EventBriefGenerator` — LLM-генератор полного транскрипта / чата / чек-ина из краткого брифа.
  - `DayRunnerService` — оркестратор: кладёт `RawEvent`'ы дня в очередь, ждёт затихания pipeline, дёргает cron'ы дня, проверяет промежуточные assert'ы.
  - `MonthRunnerService` — крутит все 22 дня подряд, ведёт прогресс в `SimulationRun`.
  - `SmokeAssertsService` — финальные 14 проверок.
  - `SimulationCostReportService` — выгрузка из `AiUsageLog`.
- Новый промпт `simulation-month-plan.prompt.ts` (генератор плана) и `simulation-event-brief.prompt.ts` (генератор транскрипта).
- Новый `LlmTaskRoute { taskType: 'simulation-month-plan', primary: 'deepseek:deepseek-v4-pro' }` и `{ taskType: 'simulation-event-brief', primary: 'deepseek:deepseek-v4-pro' }`.
- Глобальный kill-switch `simulation.enabled` в `AdminSetting`.
- Снижение приоритета BullMQ-job'ов для синтетической Org (`priority=10`).
- Фильтры `isSynthetic`/`kind='internal_test'` в `NotificationDispatcher`, `EmailService`, `PushService`, биллинговых отчётах, реферальном пуле.
- Prometheus-label `org_kind` на ключевых метриках (AI-вызовы, длительности воркеров).
- Frontend: страница `/admin/simulation` в супер-админке (видна только `User.isSuperAdmin`) с UI прогонов.
- Backend-скрипты: `generate-simulation-plan.ts`, `run-simulation.ts`, `simulation-cost-report.ts`.
- Тесты: unit на сервисы, интеграционный на dev-БД с моком LLM, e2e на staging с реальным DeepSeek (опц.).

**Не входит:**

- ASR / диаризация / реальное аудио. Подаём готовые транскрипты как `RawEvent.payload`. Аудио-pipeline (`ai/workers/transcribe.worker`, `merge.worker`, `clip-render.worker`) **исключён из scope первого прогона** — проверяется отдельно на реальных записях.
- LiveKit-комнаты, реальный Egress, реальные participant'ы. Симулятор работает на уровне `RawEvent + Meeting`, без подключения к медиа.
- Очистка после прогона. Кабинет живёт постоянно. Есть отдельный admin-endpoint «полностью удалить эту симуляцию» с двойным подтверждением — на случай экстренного reset.
- Маркетинговый демо-кабинет — отдельное ТЗ (`2026-05-25-demo-mode-tz.md`). Связь («может быть, заберём данные оттуда как заготовку») — задача следующих итераций, не этой.
- Time-travel в воркерах через подмену `Date.now()`. Сжатие времени достигается через `createdAt = вычисленная дата прошлого` на `RawEvent` + ручное дёргание cron'ов в правильном порядке.
- Real-time progress в UI через WebSocket — для MVP достаточно SWR polling каждые 3 секунды.

---

## Принципы симулятора

1. **Прод — единственное окружение.** Симулятор работает на проде. Только так мы видим реальное поведение под фактическими cron-расписаниями, реальной инфрой, реальными квотами провайдеров. Изоляция от настоящих клиентов — через флаги `Org.kind`, `User.isSynthetic`, фильтры в рассылках, приоритет в очередях.
2. **Реальные вызовы LLM, никаких mock'ов.** Каждый AI-job идёт через `LlmRouterService` → DeepSeek (или фактическую primary-модель соответствующего `LlmTaskRoute`). Бюджет — реальные деньги. Цена покрывается тем, что прогон редкий (раз в неделю / перед релизом / по запросу).
3. **Одна синтетическая Org на всё.** Создаётся один раз вручную через seed-скрипт (`Org.kind='internal_test'`, `name='Симулятор: вымышленная компания'`). Все последующие прогоны работают над ней — либо `reset-and-run` (стираем синтетическое содержимое и сеем заново), либо `append-month` (доливаем ещё один месяц поверх).
4. **Super-admin как живой наблюдатель.** Я (super-admin Z, реальный `User`) — owner синтетической Org через `Org.ownerId = мой userId`. 20 сотрудников — отдельные синтетические `User`'ы с `isSynthetic=true`. Это позволяет мне заходить в кабинет как обычный owner и руками крутить интерфейс.
5. **Сценарий = `MonthPlan` (LLM-генерация) + `EventBrief` (тоже LLM-генерация).** План месяца с сюжетными линиями генерируется один раз LLM по описанию компании + `seed`. Дальше для каждого `EventBrief` (одна встреча / один чек-ин / один чат) — отдельная LLM-генерация полного транскрипта. Это даёт И воспроизводимость скелета через seed, И живое разнообразие текстов.
6. **Покрытие — все агенты системы.** В первый прогон проверяем ~70 cron'ов и воркеров (всё, кроме аудио-pipeline и retention-cron'ов). Если агент в первом прогоне не сработал — это баг (или у нас нет триггера, или мы не подали ему данные). Любой пропуск — красный assert.
7. **Воспроизводимость через seed.** Каждый `SimulationRun` хранит `seed` (целое число). Один и тот же seed → один и тот же `MonthPlan` (но не один и тот же текст транскриптов — LLM каждый раз свой). Это даёт возможность сравнивать прогоны при изменении промптов / моделей.
8. **Cost — главный артефакт.** После прогона автоматически генерируется `simulation-cost-report-{runId}.md` с разбивкой по taskType / провайдеру / дню. Это unit-economics для тарифа.
9. **Smoke-assert'ы — критерий «зелёный/красный».** 14 автоматических проверок после прогона. Зелёные все → система работает. Любой красный → дыра, нужен fix до следующего прогона.
10. **Kill-switch обязателен.** `AdminSetting.simulation.enabled = false` → весь модуль отключается мгновенно. Текущие прогоны добегают, новые не стартуют. Это страховка на случай, если что-то пошло не так.

---

## Содержание

### Что генерируем

Объёмы для одного месяца «компания на 20 человек, 6 отделов, 22 рабочих дня».

| Сущность | Кол-во | Чем заполняется | Источник |
|---|--:|---|---|
| `User` (синтетические сотрудники) | 20 | `isSynthetic=true`, `email=sim-<uuid>@kora-sim.local`, `passwordHash=NULL` (login невозможен), `signupSource='crossmark'` | Seed (один раз при создании Org) |
| `Membership` | 21 | 20 сотрудников + я как owner | Seed |
| `Department` | 6 | Продажи, Маркетинг, Продукт, Разработка, Операции, HR | Seed |
| `Role` | 12 | По 2 типовые должности на отдел | Seed |
| `Person` + `Appointment` | 20 | По одному на сотрудника, с привязкой к Role | Seed |
| `Goal` | 6 | OKR отделов (генерируется `MonthPlan`'ом) | Run |
| `Meeting` + `RawEvent` (source `meeting`) | ~90 | По всем 9 типам, распределены по 22 дням (больше во вт-чт, меньше в пн/пт) | Run |
| `RawEvent` (source `chat`) | ~150 | Чат-сообщения в каналах команд (Telegram-имитация) | Run |
| `RawEvent` (source `form`) для чек-инов | ~880 | 20 чел × 22 дня × 2 (утро/вечер) | Run |
| `RawEvent` (source `tracker`) | ~80 | Задачи созданы / переведены / закрыты / просрочены | Run |
| `IdeaBlock` | ~250 | Извлекается реальными воркерами `block-linker`, `specialist-3-*` | Pipeline |
| `Entity` | ~50 | Извлекается реальным `entity-resolver` | Pipeline |
| `IdeaBlockLink` | ~400 | Реальный `block-linker` + `entity-graph-builder` | Pipeline |
| `Theme` | ~7 | Реальный `theme-clusterer` | Pipeline |
| `Insight` | ~12 | Реальный `specialist-3-5-insights` + `insight-clusterer` | Pipeline |
| `Idea` + `IdeaCluster` | ~15 + ~4 | Реальный `specialist-3-6-ideas` + `idea-clusterer` | Pipeline |
| `Decision` | ~20 | Реальный `specialist-3-3-decisions` | Pipeline |
| `SkillProfile` + `SkillTrait` | ~12 + ~120 | Реальный `specialist-3-7-skill` + `skill-profile-rebuild` | Pipeline |
| `ExecutablePersona` | ~10 | Реальный `executable-persona-build.cron` | Pipeline |
| `ProbeEvent` (дашборд директора) | ~25 | Реальный `probe-priority.cron` + `specialist-3-3-probe` | Pipeline |
| `Notification` | ~30 | Реальные `proactive-watcher`, `commitment-followup`, `operations-*-digest` | Pipeline |
| `AiUsageLog` | **~2000** | Каждый вызов LLM пишет запись — это и есть наш cost-источник | Real LLM |

**Что НЕ заполняем (исключения):**

- Реальные аудио-файлы / `Recording.objectKey` (всегда `NULL`).
- `Webhook` / `IntegrationDestination` — нет внешних подписок.
- `PushSubscription` / email-получатели — отключены через фильтры `isSynthetic` (см. «Изоляция»).

### Какие агенты должны сработать (~70 шт.)

Это карта покрытия. Каждый агент либо триггерится явно (cron-вызов через admin-trigger в нужный «день симуляции»), либо срабатывает реактивно (когда мы кладём `RawEvent` / создаём `Meeting`).

#### Группа A. Ingest

| Агент / cron | Триггер | Что должен сделать |
|---|---|---|
| `RawEvent` ingest (через `IngestService.ingest`) | Прямой вызов из `DayRunner` | Принять `RawEvent` синтетического источника, поставить в `processingStatus='received'` |
| `block-linker.worker` | Реактивно по `RawEvent` | Извлечь `IdeaBlock`'и через LLM, связать с `Entity` |
| `entity-resolver.cron` | Дёргается раз в день симуляции | Дедуп `Entity` по эмбеддингам |

#### Группа B. AI base-агенты по встречам (модуль `ai`)

| Агент | Триггер | Покрываем? |
|---|---|---|
| `transcribe.worker` | — | **Нет** (text-mode) |
| `merge.worker` | — | **Нет** (text-mode) |
| `analyze.worker` (AI-отчёт по типу встречи) | Реактивно после `Meeting.create` | **Да**, все 9 типов |
| `chapters.worker` (главы) | Реактивно | **Да** |
| `tasks-extract.worker` (задачи из встречи) | Реактивно | **Да** |
| `transcript-clean.worker` | Если включён `Org.transcriptCleaningAuto` | **Опц.** (включаем для проверки) |
| `transcript-index.worker` (для поиска) | Реактивно | **Да** |
| `quality-score.worker` | Реактивно | **Да** |
| `behavior-metrics.worker` | Реактивно | **Да** |
| `custom-report.worker` | Триггер через UI/API | **Опц.** |
| `card-rollup.worker` | Реактивно при создании `Card` | **Да** |
| `notify.worker` | Реактивно | **Да** (но фильтр `isSynthetic` блокирует отправку) |

#### Группа C. Knowledge-core (cron'ы)

| Cron | Покрываем? |
|---|---|
| `meeting-analyze-v2.cron` | **Да** |
| `theme-clusterer.cron` | **Да** |
| `idea-clusterer.cron` | **Да** |
| `insight-clusterer.cron` | **Да** |
| `reframing.cron` | **Да** |
| `temporal-probe.cron` | **Да** |
| `signal-type-stats.cron` | **Да** |
| `core-metrics-snapshot.cron` | **Да** |
| `confidence-calibration.cron` | **Да** |
| `dataclass-audit-snapshot.cron` | **Да** |
| `entity-graph-builder.cron` | **Да** |
| `entity-resolver.cron` | **Да** |
| `skill-trait-concept-normalizer.cron` | **Да** |
| `strategic-alignment.cron` | **Да** |
| `role-profile.cron` | **Да** |
| `executable-persona-build.cron` | **Да** (главный — создание клонов) |
| `executable-persona-trigger-watcher.cron` | **Да** |
| `knowledge-clone-rebuild.cron` | **Да** |
| `skill-profile-recalibrate.cron` | **Да** |
| `skill-manager-digest.cron` | **Да** |
| `process-template-completeness.cron` | **Да** |
| `experiment-status-resolver.cron` | **Да** |
| `experiment-transitions.cron` | **Да** |

#### Группа D. Specialists 3.1–3.8 (workers)

| Worker | Покрываем? |
|---|---|
| `specialist-3-1-regulations.worker` | **Да** |
| `specialist-3-2-knowledge-clone.worker` | **Да** |
| `specialist-3-3-decisions.worker` | **Да** |
| `specialist-3-3-probe.service` | **Да** |
| `specialist-3-4-project-customer.worker` | **Да** |
| `specialist-3-5-insights.worker` | **Да** |
| `specialist-3-6-ideas.worker` | **Да** |
| `specialist-3-7-skill.worker` | **Да** |
| `specialist-3-8-helpfulness.worker` + 4 cron'а | **Да** |

#### Группа E. Operations

| Cron / worker | Покрываем? |
|---|---|
| `daily-checkin-prompt.cron` | **Да** (триггерится раз в день) |
| `checkin-sentiment-analyzer.worker` | **Да** (реактивно по `RawEvent` чек-ина) |
| `checkin-sentiment-batch.cron` | **Да** |
| `operations-daily-digest.cron` | **Да** (триггерим в конце «дня симуляции») |
| `operations-weekly-digest.cron` | **Да** (в конце «недели симуляции») |
| `commitment-followup.cron` | **Да** |
| `personal-relation-builder.worker` | **Да** |

#### Группа F. Company-foundation / Brand-voice

| Cron | Покрываем? |
|---|---|
| `company-profile-builder.cron` | **Да** |
| `department-detector.cron` | **Да** |
| `domain-expander.cron` | **Да** |
| `maturity-scorer.cron` | **Да** |
| `brand-voice-extractor.cron` | **Да** |

#### Группа G. Curation / Conflict

| Cron | Покрываем? |
|---|---|
| `card-stale-detector.cron` | **Да** |
| `completeness-scanner.cron` | **Да** |
| `consistency-checker.cron` | **Да** |

#### Группа H. Processes / Experiments

| Воркер / cron | Покрываем? |
|---|---|
| `process-detector.worker` | **Да** |
| `experiment-detector.worker` | **Да** |
| `cross-functional-friction-aggregator.cron` | **Да** |

#### Группа I. Goals / Tracker

| Воркер / cron | Покрываем? |
|---|---|
| `goal-alignment-low.cron` | **Да** |
| `issue-overdue-detector.cron` | **Да** |
| `issue-state-gauge.cron` | **Да** |
| `issue-embed.worker` | **Да** |
| `intake-auto-triage.worker` | **Да** |
| `import-tracker.worker` | **Опц.** (если генерируем сценарий импорта) |
| `role-map-builder.worker` + `role-map-completeness.cron` | **Да** |

#### Группа J. Dashboard / Probe / Recognition / Activity

| Cron | Покрываем? |
|---|---|
| `probe-priority.cron` | **Да** |
| `recognition-weekly-digest.cron` | **Да** |
| `contribution-snapshot.cron` | **Да** |
| `badge-awarder.cron` | **Да** |
| `streak-detector.cron` | **Да** |
| `feed-digest.cron` | **Да** |
| `feed-expire.cron` | **Да** |
| `helpfulness-spotlight.cron` | **Да** |
| `social-contribution-profile.cron` | **Да** |
| `helpfulness-probe.cron` | **Да** |
| `helpfulness-trait-decay.cron` | **Да** |

#### Группа K. Concierge / Orchestrator / Proactive

| Cron / worker | Покрываем? |
|---|---|
| `concierge-conversation-summarizer.cron` | **Опц.** (если генерируем concierge-диалоги) |
| `concierge-quota-reset.cron` | **Да** |
| `orchestrator-subagent.worker` | **Опц.** |
| `org-knowledge-index-builder.cron` | **Да** |
| `proactive-watcher.cron` | **Да** |

#### Группа L. Conversational / Calendar / Mail

| Cron | Покрываем? |
|---|---|
| `telegram-digest.cron` | **Да** |
| `event-reminder-scheduler.cron` | **Да** (если генерируем calendar-события) |
| `imap-poll.cron` / `email-fetch.cron` | **Нет** (нет реальных IMAP) |
| `dialog-layer/conversation-summarizer.cron` | **Да** |

#### Группа M. Не покрываем (системные cron'ы вне scope)

- `retention.cron`, `retention-extras.cron` — удаление по политике хранения (испортит наши данные).
- `chat-v2-cleanup.cron`, `push-cleanup.cron` — техническая уборка.
- `admin/economics/*` cron'ы (`daily-cost-aggregator`, `currency-rate-sync`, `provider-smoke-test`, `budget-alert`, `org-economics`) — системные, работают сами, мы их не триггерим.
- `idle-meeting.cron` — для реальных живых встреч.
- `org-invitation-reminders.cron` — для реальных приглашений.

**Итого в покрытии: ~70 агентов / cron'ов.**

---

## Архитектура

### Поток данных при одном прогоне (`reset-and-run`)

```
[ super-admin → /admin/simulation → клик "Запустить" ]
        ↓
[ POST /api/v1/admin/simulation/runs ] → создаёт SimulationRun(status='pending', seed)
        ↓
[ MonthRunnerService.start(runId) — фоновая job ]
        ↓
1. SimulationCleanupService.cleanup(orgId)
   — удаляет все isSynthetic-сущности кроме User'ов и Department/Role (структура остаётся)
        ↓
2. MonthPlanGenerator.generate(seed, companyDescription)
   — один LLM-вызов (DeepSeek V4 Pro, ~$0.10), возвращает MonthPlan JSON
   — сохраняется в SimulationRun.monthPlanJson
        ↓
3. for day in 1..22:
   a. SimulationRun.currentDay = day
   b. for event in plan.days[day].events:
      - EventBriefGenerator.expandToTranscript(event) — LLM (DeepSeek, ~$0.02-0.05)
      - DayRunnerService.enqueueRawEvent(event, transcript, occurredAt)
      - SimulationEvent.create(type, status='enqueued')
   c. wait until all BullMQ queues drain (active+waiting == 0 for tenantId=simOrgId)
   d. CronTriggerService.runForDay(day):
      — дёргает по списку: daily-checkin-prompt, operations-daily-digest, probe-priority,
        proactive-watcher, commitment-followup, ... (всё, что в реальном проде @Cron('0 ...'))
   e. wait until queues drain again
   f. SmokeAssertsService.checkDailyAsserts(day) — лёгкие проверки (опц.)
   g. if day % 7 == 0:
      — дёргает weekly cron'ы: operations-weekly-digest, recognition-weekly-digest,
        skill-manager-digest, theme-clusterer, executable-persona-build, ...
   h. SimulationRun.progressPercent = day/22 * 100
        ↓
4. SmokeAssertsService.runAll(orgId, runId) → 14 assert'ов
   — пишутся в SimulationRun.assertsResultsJson
        ↓
5. SimulationCostReportService.generate(runId)
   — выгрузка из AiUsageLog WHERE tenantId=simOrgId AND createdAt BETWEEN run.startedAt AND now()
   — markdown в tmp/simulation-cost-report-{runId}.md
   — итог в SimulationRun.costUsd / costRub
        ↓
6. SimulationRun.status = 'completed' (или 'failed' с errorText)
```

### Формат `MonthPlan`

```typescript
type MonthPlan = {
  companyName: string;
  companyDomain: string;        // например "B2B SaaS для логистических компаний"
  storyArcs: StoryArc[];        // 5-7 сюжетных линий, тянущихся через месяц
  days: DayPlan[];              // 22 рабочих дня
};

type StoryArc = {
  id: string;
  title: string;                // "Запуск B2B-тарифа"
  description: string;          // 2-3 предложения
  participantPersonIds: string[];
  affectedDepartments: string[];
  expectedSignals: ('decision'|'pain'|'idea'|'insight'|'objection')[];
};

type DayPlan = {
  dayIndex: number;             // 1..22
  dateOffset: number;           // дней назад от сегодня (для createdAt)
  events: EventBrief[];
};

type EventBrief =
  | { type: 'meeting', meetingType: MeetingType, title: string, ownerPersonId: string,
      participantPersonIds: string[], storyArcId: string, brief: string }      // 2-3 предложения
  | { type: 'chat',    channelKind: 'team'|'project'|'one-on-one',
      participantPersonIds: string[], storyArcId: string, brief: string }
  | { type: 'checkin', kind: 'morning'|'evening', personId: string,
      moodHint: 'good'|'neutral'|'bad', brief: string }
  | { type: 'tracker', action: 'create'|'transition'|'close'|'overdue',
      issueTitle: string, assigneePersonId: string, storyArcId: string };
```

### `EventBriefGenerator` — превращение брифа в полный текст

Один промпт, принимает `EventBrief` + контекст компании + предыдущие события storyArc'а (последние 3-5 для контекстуальности). Возвращает:

- Для `meeting`: транскрипт в формате `RawEvent.payload` (массив `{ speakerPersonId, ts, text }`).
- Для `chat`: массив сообщений `{ authorPersonId, ts, text }`.
- Для `checkin`: текст ответа сотрудника на стандартный чек-ин-вопрос.
- Для `tracker`: payload `IssueEvent` в формате модуля tracker.

`primary: 'deepseek:deepseek-v4-pro'`, `responseFormat: 'json_object'`, валидация Zod.

### `DayRunnerService` — что значит «прогнать день N»

1. Берёт `DayPlan` из `MonthPlan`.
2. Для каждого `EventBrief`:
   - Зовёт `EventBriefGenerator.expandToTranscript(event)` (если ещё не развёрнуто — кешируем в `SimulationEvent.transcriptJson`).
   - Создаёт `RawEvent` с `occurredAt = startOfDay - dateOffset` и `receivedAt = now()`.
   - Для `meeting` дополнительно создаёт `Meeting` + `Participant`'ы + `Transcript`.
   - Ставит job в BullMQ-очередь (как обычный ingest).
3. **Ждёт затихания.** Опрашивает `BullMQ.getJobCounts()` по всем очередям, где могут быть job'ы для нашей Org. Условие выхода: `active + waiting + delayed === 0` в течение 5 секунд подряд. Таймаут — 10 минут на день.
4. **Триггерит daily cron'ы.** Через `CronManagerService.runCron(name, { orgId })` (или прямо через `cronManagerService.runForOrg(name, orgId)` — точное API уточняется в Фазе 4 по существующему `admin/crons/cron-manager.service.ts`). Список dailies — `cfg.simulation.dailyCrons` (массив в `AdminSetting`).
5. **Ждёт затихания второй раз.**
6. **Если день кратен 7** — дёргает weekly cron'ы из `cfg.simulation.weeklyCrons`.
7. Обновляет `SimulationRun.currentDay` и `progressPercent`.

### Триггер cron'ов — переиспользование `CronManagerService`

В проекте уже есть `backend/src/modules/admin/crons/cron-manager.service.ts` — сервис, который умеет дёргать cron'ы вручную (для админских кнопок «Запустить сейчас»). `DayRunnerService` использует этот сервис, не дублирует логику.

Уточнение: если `CronManagerService` не умеет «прогнать cron только для одной Org» — Фаза 4 расширяет API (`runForOrg(name, orgId)`).

### Cost-report — формат

Markdown с разделами:

1. **Итог:** `$XX.XX (₽YYYY)`, длительность прогона, # вызовов LLM.
2. **По taskType:** таблица `taskType | calls | costUsd | avgLatencyMs`, отсортирована по убыванию costUsd.
3. **По провайдеру/модели:** аналогично.
4. **По дню:** график (ASCII или markdown-table) роста стоимости.
5. **Топ-10 самых дорогих вызовов:** drill-down с `requestPreview`/`responsePreview`.
6. **Аномалии:** список вызовов с `tier='secondary'/'tertiary'` (fallback срабатывал — primary не справился).

Файл: `tmp/simulation-cost-report-{runId}-{timestamp}.md`. Также пушится в `SimulationRun.costReportPath`.

---

## Технические изменения

### База данных

**Новые поля:**

```prisma
model Org {
  // ...
  /// Тип Org: 'real' (реальный клиент, дефолт) или 'internal_test' (синтетическая для simulation-harness).
  /// Фильтруется в биллинге, рассылках, реферальном пуле, экономических отчётах.
  kind             String   @default("real")  // 'real' | 'internal_test'
}

model User {
  // ...
  /// Синтетический пользователь, созданный simulation-harness. Не получает email/push,
  /// не может login'иться (passwordHash=NULL), не учитывается в DAU/MAU.
  isSynthetic      Boolean  @default(false)
}
```

**Новые модели:**

```prisma
model SimulationRun {
  id                  String   @id @default(cuid())
  orgId               String
  org                 Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  /// 'reset-and-run' | 'append-month'
  mode                String
  /// Seed для воспроизводимого MonthPlan (один и тот же seed → одинаковая структура плана).
  seed                Int
  /// 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  status              String   @default("pending")
  /// Текущий день симуляции (1..22), для progress UI.
  currentDay          Int      @default(0)
  /// 0..100
  progressPercent     Int      @default(0)
  /// Сгенерированный план месяца (валидируется Zod-схемой при чтении).
  monthPlanJson       Json?
  /// Результаты 14 smoke-assert'ов { name, passed, actual, expected }.
  assertsResultsJson  Json?
  costUsd             Decimal? @db.Decimal(10, 6)
  costRub             Decimal? @db.Decimal(14, 4)
  /// Путь к markdown-отчёту со стоимостью.
  costReportPath      String?
  errorText           String?  @db.Text
  startedBy           String   // userId super-admin'а
  startedAt           DateTime?
  finishedAt          DateTime?
  createdAt           DateTime @default(now())

  events              SimulationEvent[]

  @@index([orgId, createdAt])
  @@index([status])
}

model SimulationEvent {
  id                  String   @id @default(cuid())
  runId               String
  run                 SimulationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  dayIndex            Int
  /// 'meeting' | 'chat' | 'checkin' | 'tracker'
  eventType           String
  /// 'enqueued' | 'processed' | 'failed'
  status              String   @default("enqueued")
  /// Сохранённый brief из MonthPlan.
  briefJson           Json
  /// Развёрнутый LLM-ом транскрипт / сообщения / payload. Кешируется для повторных прогонов.
  transcriptJson      Json?
  /// Ссылка на созданный RawEvent / Meeting (для traceability).
  resultRef           Json?
  errorText           String?  @db.Text
  createdAt           DateTime @default(now())

  @@index([runId, dayIndex])
  @@index([runId, status])
}
```

**Индексы:**

- `@@index([kind])` на `Org` — для быстрой фильтрации в биллинге.
- `@@index([isSynthetic])` на `User` — для фильтра в рассылках.

**Миграция:**

- `bun run prisma:push` (не migrate, см. `prisma-db-push-rules`).
- `bun run prisma:generate`.
- Новые поля nullable / с default — обратно совместимо.

### Backend

**Новый модуль `backend/src/modules/simulation-harness/`:**

```
simulation-harness/
├── simulation-harness.module.ts
├── controllers/
│   └── simulation-admin.controller.ts          # super-admin API
├── services/
│   ├── simulation-org-setup.service.ts         # создать/проверить синтетическую Org
│   ├── simulation-cleanup.service.ts           # удалить isSynthetic-контент (не User'ов!)
│   ├── month-plan-generator.service.ts         # LLM генератор MonthPlan
│   ├── event-brief-generator.service.ts        # LLM генератор транскрипта/чата/чек-ина
│   ├── day-runner.service.ts                   # один день: enqueue + wait + crons
│   ├── month-runner.service.ts                 # весь месяц: оркестрация
│   ├── cron-trigger.service.ts                 # обёртка над CronManagerService
│   ├── queue-drain-waiter.service.ts           # ждёт пока BullMQ затихнет для нашей Org
│   ├── smoke-asserts.service.ts                # 14 проверок
│   ├── simulation-cost-report.service.ts       # выгрузка из AiUsageLog
│   └── simulation-killswitch.service.ts        # читает AdminSetting.simulation.enabled
├── workers/
│   └── month-runner.worker.ts                  # BullMQ-job, концurrency=1
├── prompts/
│   ├── simulation-month-plan.prompt.ts
│   └── simulation-event-brief.prompt.ts
├── schemas/
│   ├── month-plan.schema.ts                    # Zod
│   └── event-brief.schema.ts                   # Zod
└── simulation.types.ts
```

**Изменения существующих модулей:**

- `notifications/notification-dispatcher.service.ts` — добавить фильтр `recipient.isSynthetic === false`.
- `mail/email.service.ts` — аналогично.
- `push/push-sender.worker.ts` — аналогично.
- `admin/economics/*` — фильтр `org.kind !== 'internal_test'` во всех агрегатах.
- `referrals/*` (когда будет реализовано в ТЗ billing-and-referrals) — аналогично.
- BullMQ-job enqueue'ры — где есть `tenantId`, при `tenantId.kind === 'internal_test'` ставить `priority: 10` вместо дефолта.

> **Имплементация фильтра priority:** обёртка `EnqueueWithOrgPriority` в `common/queues/`, читает `Org.kind` из кеша (Redis), при `internal_test` → `priority=10`. Альтернатива (проще): отдельная BullMQ-очередь `simulation-low-pri` с теми же воркерами, но `concurrency=1`. Решение в Фазе 4.

**Скрипты:**

- `backend/scripts/seed-simulation-org.ts` — one-off, создаёт `Org(kind='internal_test')`, 20 синтетических User'ов, 6 Department, 12 Role, 20 Person+Appointment. Идемпотентен (пере-вызов проверяет наличие). Используется однажды при настройке стенда.
- `backend/scripts/generate-simulation-plan.ts` — генерирует `MonthPlan` без прогона (для предварительного просмотра). Аргумент `--seed=N --org=ID`. Пишет в `tmp/`.
- `backend/scripts/run-simulation.ts` — CLI-альтернатива UI-кнопке. Аргументы: `--org=ID --mode=reset|append --seed=N`. Полезно для CI.
- `backend/scripts/simulation-cost-report.ts` — `--run=ID`. Выгружает markdown.

**Новые `LlmTaskRoute`:**

```typescript
[
  { taskType: 'simulation-month-plan',
    primary: 'deepseek:deepseek-v4-pro',
    secondary: 'openai-via-proxy:gpt-5.4',
    responseFormat: 'json_object',
    maxOutputTokens: 8000 },
  { taskType: 'simulation-event-brief',
    primary: 'deepseek:deepseek-v4-pro',
    secondary: 'openai-via-proxy:gpt-5.4-mini',
    responseFormat: 'json_object',
    maxOutputTokens: 4000 },
]
```

Seed-скрипт: `backend/scripts/seed-llm-task-routes-simulation.ts`.

**Очереди BullMQ:**

- `simulation.month-runner` — concurrency=1 (одновременно только один прогон).
- (Опц.) `simulation.event-brief-generate` — для распараллеливания LLM-вызовов внутри дня, concurrency=3.

### Frontend

**Новая страница `/admin/simulation`** (роут в `(authenticated)` или `(admin)` — точная route-группа уточняется в Фазе 7 по существующему layout супер-админки):

- Видна только при `currentUser.isSuperAdmin === true`.
- Заголовок: «Симулятор месяца работы».
- Виджет «Текущий прогон» (если есть `SimulationRun.status === 'running'`): progress bar (`progressPercent`), текущий день `(currentDay/22)`, кнопка «Отменить».
- Кнопка «Создать новый прогон» → модалка:
  - Выбор Org (из списка `kind='internal_test'`).
  - Режим: `reset-and-run` / `append-month`.
  - Seed (число; по умолчанию `Date.now() % 1000000`, кнопка «Использовать предыдущий»).
  - Preview оценки: «~90 встреч, ~880 чек-инов, ~2000 LLM-вызовов, ожидаемая стоимость $25-40».
  - Кнопка «Запустить» (двойное подтверждение через native `confirm`).
- Таблица «История прогонов» (`SimulationRun[]`):
  - Колонки: id (короткий), дата, mode, seed, status (badge), длительность, costUsd, # red asserts, действия.
  - Клик по строке → drill-down: smoke-assert'ы (14 строк с зелёным/красным), ссылка на cost-report.
- Кнопка «Открыть синтетическую Org» — переключает контекст текущего пользователя на синтетическую Org (через стандартный switcher или `X-Org-Id` header в API), редирект на `/dashboard`. После прогона super-admin ходит по UI как обычный owner.

**Локализация:** русский (см. `feedback_admin_ui_russian_only`).

### Интеграции

**Внешние:** только LLM-провайдеры (DeepSeek через `agent-lia` proxy и OpenAI через тот же proxy для fallback). Уже подключены.

**Очереди:**
- `simulation.month-runner` (новая).
- Все существующие очереди (`ai.*`, `knowledge-core.*`, `operations.*`, etc.) — переиспользуются без изменений, фильтр приоритета через флаг `Org.kind`.

**События:**
- Эмитит `simulation.run.started`, `simulation.run.day-completed`, `simulation.run.completed`, `simulation.run.failed` — для `AuditLog` и потенциальных будущих метрик.

### Конфигурация

В `AdminSetting`:

| Key | Default | Описание |
|---|---|---|
| `simulation.enabled` | `true` | Глобальный kill-switch. `false` → MonthRunnerService возвращает 503 при попытке старта. |
| `simulation.dailyCrons` | `['daily-checkin-prompt', 'operations-daily-digest', 'commitment-followup', 'probe-priority', 'proactive-watcher', 'checkin-sentiment-batch', ...]` | Список cron'ов, которые `DayRunner` дёргает в конце каждого дня. |
| `simulation.weeklyCrons` | `['operations-weekly-digest', 'recognition-weekly-digest', 'skill-manager-digest', 'theme-clusterer', 'executable-persona-build', 'idea-clusterer', 'insight-clusterer', 'role-profile', 'strategic-alignment', ...]` | Список cron'ов, дёргаемых в конце каждой 7-дневки. |
| `simulation.queueDrainTimeoutMs` | `600000` | Таймаут ожидания затихания BullMQ. |
| `simulation.dayBudgetUsd` | `5.0` | Максимальная стоимость одного дня (если превышено — прогон остановлен с `failed`). Защита от runaway-биллинга. |
| `simulation.monthBudgetUsd` | `80.0` | Максимальная стоимость всего прогона. |

В `cfg` (`env.schema.ts`) — не вводим, всё конфигурируется через `AdminSetting`.

---

## Endpoint'ы

Все требуют `isSuperAdmin === true`. Префикс `/api/v1/admin/simulation`.

| Метод | Путь | Body | Ответ |
|---|---|---|---|
| `POST` | `/orgs/setup` | `{}` | `{ orgId: string, alreadyExisted: boolean, syntheticUsersCount: number }` |
| `GET` | `/orgs` | — | `Org[]` где `kind='internal_test'` |
| `POST` | `/runs` | `{ orgId, mode: 'reset-and-run'\|'append-month', seed: number }` | `{ runId: string, estimatedCostUsd: number }` |
| `GET` | `/runs` | — | `SimulationRun[]` (последние 20) |
| `GET` | `/runs/:id` | — | `SimulationRun` + посчитанная live-прогрессия |
| `POST` | `/runs/:id/cancel` | — | `{ ok: true }` |
| `GET` | `/runs/:id/asserts` | — | `{ asserts: AssertResult[] }` |
| `GET` | `/runs/:id/cost-report` | — | markdown-файл (text/markdown) |
| `POST` | `/orgs/:orgId/purge` | `{ confirmText: string }` | Двойное подтверждение (`confirmText === 'УДАЛИТЬ ВСЁ В СИМУЛЯТОРЕ'`). Удаляет всю синтетику. |

> Открытие синтетической Org из UI не требует отдельного endpoint'а — используется стандартный механизм `X-Org-Id` (через `Org-switcher` в шапке).

---

## Smoke-assert'ы (14 проверок после прогона)

`SmokeAssertsService.runAll(orgId, runId)` возвращает массив `AssertResult { name, passed, actual, expected, severity }`.

| # | Имя | Проверка | Порог | Severity |
|---|---|---|---|---|
| 1 | `meetings_have_reports` | Доля `Meeting` с непустым `MeetingReport` | =100% | critical |
| 2 | `all_meeting_types_covered` | Уникальных `Meeting.type` среди созданных | ≥9 | critical |
| 3 | `idea_blocks_created` | `IdeaBlock.count(where: { tenantId, status: 'canonical' })` | ≥150 | critical |
| 4 | `blocks_connected` | Доля `IdeaBlock` с ≥1 `IdeaBlockLink` | ≥80% | critical |
| 5 | `entities_created` | `Entity.count` | ≥40 | high |
| 6 | `blocks_have_entities` | Доля `IdeaBlock` с ≥1 `IdeaBlockEntity` | ≥85% | high |
| 7 | `themes_clustered` | `Theme.count` где ≥10 блоков | ≥5 | critical |
| 8 | `daily_digests_filled` | Доля рабочих дней с `OperationsDailyDigest` | ≥80% | critical |
| 9 | `weekly_digests_filled` | Недель с `OperationsWeeklyDigest` | =4 | high |
| 10 | `clones_built_with_evidence` | `ExecutablePersona` с ≥30 evidence-блоков | ≥5 | critical |
| 11 | `skill_profiles_with_traits` | `SkillProfile` с ≥10 `SkillTrait` | ≥10 | high |
| 12 | `insights_diverse` | Уникальных `Insight.signalType` (pain/risk/objection/churn_risk) | ≥3 | high |
| 13 | `director_dashboard_probes` | `ProbeEvent.count(status='dispatched')` | ≥10 | medium |
| 14 | `cost_in_range` | Итоговый `SimulationRun.costUsd` | $15-80 | medium (sanity) |

**Поверх — ручной чек-лист для super-admin'а (не assert'ы, но в DoD):**

- Открыть `/dashboard/knowledge/chat` — задать 3 проверочных вопроса («Какие сейчас самые острые проблемы?», «Кто отвечает за маркетинг?», «Что обсуждали на последней стратегической сессии?»). Ответы должны быть конкретными, со ссылками на блоки.
- Открыть 2 клона из `/clones`, задать каждому по 2 вопроса. Клон должен отвечать в стиле своей роли и ссылаться на evidence.
- Пролистать `/dashboard` директора — должны быть pulse-метрики, probe-события, alert'ы.
- Открыть граф знаний `/dashboard/knowledge/graph` — должно быть видно ≥5 кластеров, не «звёздное небо».
- Открыть ленту тем `/dashboard/themes` — каждая тема должна иметь summary, evidence-blocks, участников.

---

## Принципы изоляции на проде

1. **Флаги `Org.kind` + `User.isSynthetic` — единый источник истины.** Везде, где запрос «реальный/нет», читается одно из этих полей.
2. **Биллинг / выручка / реферальная программа** — все агрегационные запросы добавляют `WHERE org.kind != 'internal_test'`.
3. **Уведомления** — три точки правки (`NotificationDispatcher`, `EmailService`, `PushSenderWorker`). Каждая получает recipient → если `isSynthetic === true`, метод `send()` сразу возвращает `{ skipped: 'synthetic-recipient' }` и пишет в лог. **Super-admin (я) — реальный User**, я уведомления получаю как обычно (это полезно — увижу, что генерирует наш `proactive-watcher`).
4. **BullMQ приоритет.** Job'ы с `tenantId.kind === 'internal_test'` ставятся с `priority=10` (низкий). Реальные клиенты с `priority=5` (дефолт) всегда обгоняют. Если `priority`-поле в job'е не используется одной из очередей — добавляем; не ломает существующих consumer'ов.
5. **Prometheus.** В ключевые метрики (`ai_call_duration_seconds`, `ai_call_cost_usd_total`, `worker_job_duration_seconds`) добавить label `org_kind`. В Grafana существующие дашборды можно расширить переключателем «real-only / all / internal-only».
6. **Kill-switch `simulation.enabled`.** При `false`:
   - `POST /api/v1/admin/simulation/runs` возвращает 503 `{ error: 'simulation_disabled' }`.
   - Уже запущенные прогоны добегают (не останавливаем на лету).
   - Изменение через `AdminSetting` — мгновенно (нет кеша).
7. **Бюджетный gate.** `MonthRunnerService` перед каждым днём проверяет `currentCostUsd vs cfg.simulation.dayBudgetUsd` и `currentCostUsd vs cfg.simulation.monthBudgetUsd`. Превышение → `status='failed'`, `errorText='budget_exceeded'`. Защита от runaway.
8. **AuditLog.** Каждый старт/отмена прогона, каждое изменение `simulation.enabled` — пишется в `AuditLog` и `AdminSettingHistory`.

---

## Фазы реализации

### Фаза 1 — Prisma: `kind`, `isSynthetic`, `SimulationRun`, `SimulationEvent`

- [ ] `Org.kind` String @default("real") + `@@index([kind])`.
- [ ] `User.isSynthetic` Boolean @default(false) + `@@index([isSynthetic])`.
- [ ] Новые модели `SimulationRun` и `SimulationEvent`.
- [ ] `bun run prisma:push` + `bun run prisma:generate`.
- [ ] `bun run typecheck` зелёный.
- [ ] Backfill: `UPDATE "Org" SET kind='real' WHERE kind IS NULL` (на проде — после deploy одним SQL-запросом, в коде явно не нужно).

**DoD фазы 1:** схема обновлена, типы доступны в TypeScript.

### Фаза 2 — Seed синтетической Org и фильтры в существующих модулях

- [ ] `backend/scripts/seed-simulation-org.ts` — создаёт `Org('Симулятор: вымышленная компания', kind='internal_test')`, 20 `User(isSynthetic=true)`, 6 Department, 12 Role, 20 Person+Appointment, `ownerId = my-super-admin-user-id`.
- [ ] Прогнать локально и на staging, убедиться в идемпотентности.
- [ ] Фильтр `isSynthetic` в `NotificationDispatcher`, `EmailService`, `PushSenderWorker` — unit-тесты для каждой точки.
- [ ] Фильтр `kind != 'internal_test'` в `admin/economics/*` агрегатах — unit-тесты.
- [ ] Smoke на dev: создать `Org(kind='internal_test')`, попробовать отправить email синтетическому User'у → `skipped: 'synthetic-recipient'` в логе.

**DoD фазы 2:** синтетическая Org создаётся, рассылки её игнорируют, экономические отчёты её исключают.

### Фаза 3 — Генератор `MonthPlan` и `EventBrief`

- [ ] Zod-схемы `MonthPlanSchema`, `EventBriefSchema`, `TranscriptSchema` (для разных типов).
- [ ] Промпт `simulation-month-plan.prompt.ts` — генерирует план месяца на 22 дня, 5-7 storyArc, ~90 встреч + чек-ины + чаты + tracker-события. На вход — описание компании + seed.
- [ ] Промпт `simulation-event-brief.prompt.ts` — разворачивает один `EventBrief` в полный транскрипт/чат/чек-ин/payload. На вход — brief + контекст storyArc'а (последние 3-5 событий).
- [ ] `LlmTaskRoute` зарегистрированы (seed-скрипт `seed-llm-task-routes-simulation.ts`).
- [ ] `MonthPlanGenerator.generate(seed, orgId)` + unit-тест с моком LLM.
- [ ] `EventBriefGenerator.expandToTranscript(event)` + unit-тест.
- [ ] CLI `backend/scripts/generate-simulation-plan.ts --seed=42 --org=ID` — пишет в `tmp/month-plan-{seed}.json`, человек ревьюит на адекватность.
- [ ] Один реальный прогон на staging с DeepSeek, ручная проверка качества плана.

**DoD фазы 3:** валидный `MonthPlan` JSON генерируется по seed'у, разворачивание брифа в транскрипт работает, оба прошли human-eyeball-test.

### Фаза 4 — `DayRunner` + `MonthRunner` + триггер cron'ов

- [ ] Расширить `CronManagerService` методом `runForOrg(cronName, orgId)` — если ещё нет (проверить существующий API).
- [ ] `QueueDrainWaiterService.waitUntilQuiet(orgId, timeoutMs)` — polling `BullMQ.getJobCounts` для всех очередей, фильтр по `tenantId` в job-data.
- [ ] `DayRunner.runDay(runId, day)`:
  1. Для каждого `EventBrief` дня — `expandToTranscript` + `enqueueRawEvent`.
  2. `waitUntilQuiet`.
  3. Дёрнуть `cfg.simulation.dailyCrons` через `CronTriggerService`.
  4. `waitUntilQuiet`.
  5. Если день кратен 7 — `cfg.simulation.weeklyCrons` + `waitUntilQuiet`.
- [ ] `MonthRunner` (BullMQ-job `simulation.month-runner`, concurrency=1): крутит 22 дня, обновляет прогресс, проверяет бюджетный gate.
- [ ] `SimulationKillswitchService.assertEnabled()` — кидает 503 если `simulation.enabled=false`.
- [ ] BullMQ priority обёртка `EnqueueWithOrgPriority` (читает `Org.kind` из Redis-кеша).
- [ ] Unit-тесты на каждый сервис.

**DoD фазы 4:** один день успешно проходит в dev (с моком LLM), все cron'ы дня дёргаются, queue waiter корректно ждёт.

### Фаза 5 — `SmokeAssertsService` (14 проверок)

- [ ] Реализовать каждый из 14 assert'ов как отдельный метод (`checkMeetingsHaveReports`, etc.).
- [ ] `runAll(orgId, runId): Promise<AssertResult[]>` — параллельные запросы, агрегация.
- [ ] Unit-тесты с моками Prisma на каждую проверку (тестируем граничные случаи: ровно на пороге, ниже, выше).
- [ ] Интеграционный тест на dev-БД с подготовленным набором данных.

**DoD фазы 5:** assert-сервис работает, в `SimulationRun.assertsResultsJson` корректно пишется массив с зелёными/красными.

### Фаза 6 — `SimulationCostReportService`

- [ ] Запрос к `AiUsageLog` с фильтром `tenantId=simOrgId AND createdAt BETWEEN run.startedAt AND run.finishedAt`.
- [ ] Группировки: by taskType, by provider/model, by day, top-10 calls, fallback-вызовы.
- [ ] Генерация markdown в `tmp/simulation-cost-report-{runId}-{ts}.md`.
- [ ] Запись `SimulationRun.costUsd / costRub / costReportPath`.
- [ ] CLI-скрипт `backend/scripts/simulation-cost-report.ts --run=ID` — печатает в stdout.
- [ ] Unit-тест: заранее seeded `AiUsageLog`-записи → проверяем агрегаты.

**DoD фазы 6:** после ручного прогона есть markdown-отчёт с понятной разбивкой.

### Фаза 7 — Admin UI `/admin/simulation`

- [ ] Определить route-группу (по существующему layout супер-админки — `(authenticated)/admin/*` или отдельное приложение).
- [ ] Страница `/admin/simulation` — список прогонов, виджет текущего, кнопка «Создать».
- [ ] Модалка «Создать прогон» с preview оценки стоимости и двойным подтверждением.
- [ ] Drill-down страница `/admin/simulation/[runId]` — smoke-assert'ы (14 строк цветными бейджами), ссылка на cost-report, ссылка «Открыть синтетическую Org как owner».
- [ ] SWR polling `/api/v1/admin/simulation/runs/[id]` каждые 3 секунды пока `status='running'`.
- [ ] RTL-тесты на: рендер без super-admin (403), список прогонов, модалка создания, drill-down.

**DoD фазы 7:** super-admin может из UI запустить прогон, наблюдать прогресс, посмотреть результаты.

### Фаза 8 — Сквозной прогон на staging + первый прогон на проде

- [ ] Прогнать `seed-simulation-org` на staging.
- [ ] Запустить полный `reset-and-run` на staging (реальные DeepSeek вызовы, бюджет $30-40).
- [ ] Все 14 assert'ов зелёные — фиксируем.
- [ ] Если красные — фикс соответствующих агентов до зелёного.
- [ ] Cost-report проанализирован: видим разбивку, понимаем top-cost taskType'ы.
- [ ] Ручной обход (5 пунктов чек-листа выше) — субъективная оценка «выглядит ли как настоящая компания».
- [ ] Записать `second-brain/05_история/2026-05-XX-первый-прогон-симулятора.md` с фактическими цифрами.
- [ ] Если staging прошёл — `seed-simulation-org` на проде, первый прогон на проде, рефлексия.

**DoD фазы 8:** один полный успешный прогон на staging, фактическая стоимость месяца зафиксирована, готов к проду.

---

## Edge-cases

| Кейс | Решение |
|---|---|
| Прогон упал на 15-м дне (LLM-провайдер таймаут) | `SimulationRun.status='failed'`, `errorText` заполнен. Следующий запуск через UI — пользователь выбирает либо `reset-and-run` (всё с нуля), либо новый `append-month` поверх частичных данных (с диагностикой того, что половина месяца «оборвана»). Resume в середине одного прогона — не поддерживается (сложность не окупается). |
| Параллельный запуск двух прогонов | `simulation.month-runner` BullMQ-очередь с `concurrency=1` — второй просто ждёт. Дополнительно — endpoint `POST /runs` проверяет, что нет `SimulationRun(status='running')` в этой Org → возвращает 409. |
| `simulation.enabled=false` посреди прогона | Текущий прогон добегает (Killswitch проверяется только на старте). Это сделано специально — иначе застрянет в неконсистентном состоянии. Для «срочно стоп» — endpoint `POST /runs/:id/cancel` ставит `status='cancelled'` и `MonthRunner` на следующей итерации цикла прерывается. |
| Превышение `monthBudgetUsd` | На границе дня (после `runDay` + cost-report промежуточный) — gate проверяется. `status='failed'`, `errorText='budget_exceeded: $X > $Y'`. Прогон останавливается. |
| Cron не дёргается через `CronManagerService` (нет API) | Фаза 4 расширяет `CronManagerService.runForOrg(name, orgId)`. Если расширение упёрлось — fallback: вызывать соответствующие сервисы напрямую (`OperationsDailyDigestService.runForOrg(orgId, day)`) — у каждого cron'а есть метод-payload, который crontab дёргает. Список fallback'ов фиксируется в `cfg.simulation.dailyCrons` как `{ name, fallbackService, fallbackMethod }`. |
| Синтетический User случайно попал в реальную рассылку (баг фильтра) | Юнит-тест в каждой точке (`NotificationDispatcher`, `EmailService`, `PushSenderWorker`) проверяет, что `isSynthetic=true` пропускается. Дополнительно — мониторинг: если синтетический email появился в `EmailQueue.sent` — алерт в Prometheus. |
| `Org.kind='internal_test'` случайно попал в реальный биллинг | Аналогично — юнит-тесты во всех агрегатах `admin/economics/*`. Дополнительно — отчёт `/admin/economics/revenue` явно показывает «исключено N Org(internal_test)» для прозрачности. |
| Я (super-admin) случайно использовал кнопку «Открыть синтетическую Org» и забыл переключиться обратно | UI шапки `AppShell` в режиме синтетической Org показывает плашку «🟡 Вы в синтетической Org (Симулятор)» с кнопкой «Вернуться в основной кабинет». Плашка постоянная, не скрывается. |
| Два прогона с одним seed'ом дают разные `MonthPlan` | Это допустимо — LLM не полностью детерминирован даже при `temperature=0`. Seed детерминирует только «структуру» плана (5-7 storyArc, распределение по дням), внутренние тексты — нет. Если нужна полная детерминированность — Phase 4+ может кешировать `MonthPlan` по seed'у в `tmp/cache/month-plan-{seed}.json`. |
| LLM-генератор `EventBrief` сгенерировал транскрипт с упоминанием реального бренда / реальной компании | Промпт `simulation-event-brief.prompt.ts` явно запрещает упоминать реальные бренды (`'не используй названия реальных компаний кроме общих типа Google, не выдумывай конкретных людей'`). При обнаружении (ручной обзор первых 10 событий) — итерация промпта. |
| Бюджет вышел, прогон остался в `failed`, но кабинет частично заполнен | Это OK — UI показывает «прогон оборван», но владелец может всё равно зайти и посмотреть, что успело создаться. Следующий прогон с `reset-and-run` всё уберёт. |

---

## Безопасность

1. **Доступ к `/api/v1/admin/simulation/*` — только `isSuperAdmin === true`.** Guard `SuperAdminGuard` (существующий или новый, проверить в Фазе 7).
2. **Покупка `kind='internal_test'` через API** — `Org.kind` нельзя менять через обычный `OrgsService.update`. Только через специальный endpoint `/admin/orgs/:id/kind` (или вообще только через DBA-скрипт). В Фазе 1 явно не вводим setter — `seed-simulation-org` пишет напрямую в Prisma.
3. **Утечка через синтетических User'ов.** Они не могут login'иться (`passwordHash=NULL`), не получают email/push. Дополнительно — `AuthService.login` уже проверяет `passwordHash` (без него — `Invalid credentials`), но добавим явный assert `user.isSynthetic === false` для защиты от bcrypt-collision в теории.
4. **Утечка cost-report'а с превью промптов.** `AiUsageLog.requestPreview` может содержать чувствительный текст (например, имена сотрудников). Cost-report генерируется в `tmp/`, не коммитится. Доступ к скачиванию — только super-admin. Превью усечены до 8KB.
5. **Cross-tenant.** Стандартный `TenantGuard` всегда отсекает Org A от Org B. Симулятор не пробивает изоляцию — синтетическая Org для других tenant'ов невидима. Embeddings в pgvector с `tenantId='simOrgId'` тоже отфильтруются всеми поисковыми запросами других Org.
6. **Бюджетный gate как safety net** — основная защита от runaway-стоимости LLM. Дополнительно — алерт Prometheus `simulation_cost_usd_total{run_id} > 50` → Slack/Telegram-уведомление мне.

---

## Связь с другими ТЗ

| ТЗ | Связь |
|---|---|
| `2026-05-25-demo-mode-tz.md` (маркетинговый демо-кабинет) | **Раздельные модули, не пересекаются.** Demo-mode — статичный JSON для новых клиентов; Simulation-harness — живая Org для нашего QA. В будущем (отдельным ТЗ) можно сделать экспорт «срез данных из симулятора → JSON для demo-mode», но это не цель этого ТЗ. |
| `2026-05-25-billing-and-referrals-tz.md` | Биллинговые отчёты учитывают наш `kind`-фильтр (Phase 2). Если billing-ТЗ катится после симулятора — там нужно сразу добавить фильтр; если раньше — мы добавляем фильтр в его агрегатах в Phase 2 этого ТЗ. |
| AI-стек (`feedback_z_positioning_source`, `project_z_infra_and_ai`) | Все вызовы идут через `LlmRouterService` на DeepSeek primary, согласно `project_z_infra_and_ai`. Anthropic не используем. Embeddings — `text-embedding-3-small`. Это уже зашито в существующие `LlmTaskRoute`. |

---

## Риски и ограничения

| Риск | Митигация |
|---|---|
| LLM сгенерирует план с поломанной структурой (Zod не пройдёт) | Retry 3 раза с `temperature` +0.1. Если все 3 раза fail — `SimulationRun.status='failed'` с `errorText='month_plan_generation_failed'`. Человек итерирует промпт. |
| Реальный bill DeepSeek превысит ожидание (например, в 3 раза) | Бюджетный gate (`dayBudgetUsd`, `monthBudgetUsd`) — основная защита. Если выскочило — прогон стопается, цифра видна в cost-report'е, мы корректируем промпты / cap'ы. |
| Cron-задачи на проде дополнительно срабатывают по своему расписанию во время прогона | Это даже плюс — проверим, что наши ручные триггеры не конфликтуют с автоматическими. Дублирующие вызовы должны быть идемпотентны (это обязательство crons системы в целом, не наша забота тут). |
| Симулятор грузит прод-воркеры → реальные клиенты ждут | Priority=10 для синтетики решает основную долю. Дополнительно — `cfg.simulation.dailyCrons` можно сокращать (запускать не все cron'ы в каждом дне симуляции, только раз в 3-5 дней) — если нагрузка окажется неприемлемой. |
| Один из 70 покрываемых агентов внезапно требует данные, которых у нас нет в `MonthPlan` | Это и есть цель — найти. Падающий assert / пустой результат → итерация `MonthPlan`-промпта (добавить нужный тип события / источника). Это нормальный QA-цикл. |
| Embedding'и для синтетических `IdeaBlock` забивают pgvector-индексы (HNSW) → влияет на скорость поиска для реальных Org | На 250 блоков прирост индекса незначителен (общий объём прода — десятки тысяч). Если станет проблемой — можно завести отдельный namespace pgvector, но это сильное архитектурное изменение, в первом ТЗ не нужно. |
| Super-admin (я) случайно удаляю настоящую Org через `POST /orgs/:orgId/purge` | Endpoint проверяет `org.kind === 'internal_test'` и кидает 400 для реальных Org. Дополнительно — двойное подтверждение через `confirmText='УДАЛИТЬ ВСЁ В СИМУЛЯТОРЕ'`. |

---

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._

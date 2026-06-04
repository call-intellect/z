---
name: goals-auto-lifecycle
title: Авто-добыча и ведение целей (Граф целей / Goals OKR v2)
trigger_type: event
status_overall: partial
last_audited: 2026-06-02
owners_human:
  - продакт «памяти компании»
  - инженер knowledge-core
related_plans:
  - plans/tz/2026-06-02-goals-okr-v2.md
  - plans/analysis/2026-06-02-goals-okr-research-and-gap.md
related_projects:
  - 01_projects/goals-and-strategic-alignment.md
  - 01_projects/ideas.md
  - 01_projects/sprints.md
---

# Авто-добыча и ведение целей (Граф целей)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Раздел 8 — расхождения с ТЗ. Шаги между разделами 3 и 5 пронумерованы синхронно.

## 1. О чём это (бытовой рассказ)

На встречах люди постоянно проговаривают цели: «хочу провести сто встреч с клиентами за квартал», «к лету выйти на новый регион», «снизить отток в два раза». Раньше это растворялось в записях встреч — через месяц никто не помнил, какие цели вообще ставили и движемся ли мы к ним.

«Граф целей» решает это двумя путями сразу. Во-первых, **Кора сама замечает цель в разговоре** и заводит её как карточку-черновик с пометкой «Предложено Корой» — владельцу остаётся одним нажатием подтвердить её или поправить. Во-вторых, **любую цель можно завести и вести руками** — это полностью равноправный путь. У каждой цели есть измеримые ориентиры («ключевые результаты»): например, «100 встреч», и платформа **сама подсчитывает текущее число** встреч/закрытых задач, рисует прогресс-полоску и помечает цель «в движении / под риском / застряла / выполнена».

Цели выстраиваются в **дерево** «главная цель → подцели», а раз в неделю в понедельник утром приходит **пульс целей** — короткая сводка: что продвинулось, что застряло, что выполнено. Если по ходу проверяется гипотеза, связанная с целью, или спринт работает на цель — это тоже видно.

Главный принцип: **рука человека всегда главнее**. Если кто-то поправил поле цели вручную — автоматика его больше не перетирает.

## 2. Что запускает (триггер)

- **Тип:** событие (авто-добыча) + расписание (авто-прогресс и пульс) + действие человека (ручное ведение).
- **Кто инициирует:** маршрутизатор знаний (когда на встрече прозвучало обещание/план), ежедневный/еженедельный cron, либо владелец/админ через UI.
- **Технический источник:**
  - Событие: очередь `core.specialist-routing`, jobName `'3-14-goals'` (source: `signalType ∈ {commitment, plan_item}`).
  - Cron авто-прогресса: `GoalKrProgressCron` (`@Cron('0 5 * * *')`).
  - Cron пульса: `GoalsPulseCron` (`@Cron('0 6 * * 1')` = пн 09:00 МСК).
  - Manual: `POST /goals`, `POST/PATCH/DELETE /goals/:id/key-results[/:krId]`, `POST /goals/:id/supersede`, `PATCH /goals/:id` (owner/admin).

## 3. Шаги процесса (общий список)

1. **Маршрутизатор увидел на встрече обещание или план** — кладёт блок в очередь специалиста целей.
2. **Специалист пытается извлечь цель** — LLM решает: это цель или просто болтовня (может вернуть «не цель»).
3. **Платформа ищет похожие цели** — если такая уже есть, не плодит дубль, а обновляет существующую.
4. **Цель создаётся как черновик «Предложено Корой»** — или сразу становится активной при высокой уверенности / повторе.
5. **Платформа пристраивает цель в дерево** — арбитр решает, какая существующая цель ей родитель.
6. **Раз в сутки платформа сама обновляет числа ключевых результатов** — считает встречи / закрытые задачи / упоминания и пишет точку истории.
7. **По тренду платформа пересчитывает статус движения** — «в движении / под риском / застряла / выполнена».
8. **Раз в неделю формируется пульс целей** — короткая сводка, при включённом тумблере уходит владельцу/COO.
9. **Человек в любой момент правит цель руками** — добавляет/меняет ключевые результаты, переносит подцель к другому родителю, заменяет цель новой версией; правленые поля автоматика больше не трогает.
10. **Связь со спринтами и гипотезами** — спринт можно пометить «продвигает цель», гипотезу — «двигает цель»; когда гипотеза завершена, платформа предлагает (не записывает молча) обновить ключевой результат.

## 4. Что получается на выходе

- **Кому:** всем сотрудникам Org (read), owner/admin (write), owner/COO (еженедельный пульс), AI-чату компании (retrieval).
- **В каком виде:** запись `Goal` (`source='ai'|'manual'`, `promotionState`, `progressStatus`) + `GoalKeyResult` с историей `GoalKeyResultCheckpoint` + `WeeklyGoalsPulseDigest` (пульс) + связи `Idea.goalId`/`Cycle.primaryGoalId`.
- **Где видно:** `/goals` (переключатель «Список / Дерево» + секция «Ключевые результаты»), дашборд CEO (виджет «Пульс целей» + дерево), карточка идеи («Двигает цель»), дашборд спринта («Продвигает цель»), Telegram/in-app (пульс, при включённом тумблере).

## 5. Технический разрез (по шагам)

> Номера синхронизированы с разделом 3.

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Маршрутизатор кладёт блок в очередь | `RouterService.matchSpecialists` для `signalType ∈ {commitment, plan_item}` добавляет цель `'3-14-goals'` (PRIORITY 3.8). НЕ `decision` — иначе двойная обработка с 3-3 | `knowledge-core/services/router.service.ts` | `core.specialist-routing` jobName=`3-14-goals` | — | ✅ |
| 2 | Извлечение цели (может вернуть «не цель») | `Specialist314GoalsWorker` фильтрует `job.name`, проверяет tenant + `canonical`; `Specialist314GoalsService` зовёт LLM `goal-extract` (strict JSON, `isGoal=false` для не-целей) → формулировка + горизонт + опц. KR + провенанс + confidence | `knowledge-core/workers/specialist-3-14-goals.worker.ts` + `services/specialist-3-14-goals.service.ts` + `prompts/goal-extract.prompt.ts` | LLM `goal-extract` (capable: DeepSeek V4 Pro → gpt-5.4-mini → qwen3.5:9b) | — | ✅ (юнит-тесты) |
| 3 | Поиск похожих целей (dedup) | KNN-дедуп против существующих целей; у `Goal` нет embedding-колонки → ILIKE-fallback. Совпадение → promote существующей `suggested`, не плодит дубль. Cap=7 active+suggested на горизонт | `services/specialist-3-14-goals.service.ts` | — | `Goal` | ✅ |
| 4 | Создание цели-черновика / промоут | Создаёт `Goal(source='ai', promotionState='suggested', sourceBlockIds, confidence, createdById=owner Org)`. При `confidence≥0.8` или повторе → `promotionState='active'`. Нет owner → skip | `services/specialist-3-14-goals.service.ts` | — | `Goal` | ✅ |
| 5 | Пристроить в дерево | LLM-арбитр `goal-hierarchy-link` (KNN + cheap) → проставляет `parentGoalId` | `services/specialist-3-14-goals.service.ts` + `prompts/goal-hierarchy-link.prompt.ts` | LLM `goal-hierarchy-link` (cheap) | `Goal.parentGoalId` | ✅ |
| 6 | Авто-обновление чисел KR | `GoalKrProgressCron` по `sourceKind`: `meeting_count`→`meeting.count(completed)`, `issue_rollup`→`issue.count(state.category=completed, goalId)`, `metric_entity`→`Entity.mentionsCount`, `manual`→skip. Checkpoint(`recordedBy='auto'`) только при изменении значения, в `$transaction`. **M0:** `manualOverride` уважается | `goals/cron/goal-kr-progress.cron.ts` + `GoalKrProgressService` | `@Cron('0 5 * * *')` (05:00 UTC) | `GoalKeyResult.currentValue`, `GoalKeyResultCheckpoint` | ⚠️ работает, проверено юнит-тестами; прод-прогон по расписанию |
| 7 | Пересчёт статуса движения | Из тренда checkpoints за 14 дней: `achieved`(≥100%) / `stalled`(goalDelta≤0) / `at_risk`(отставание >25 п.п.) / `on_track`. `dropped` авто не выставляется. `progressStatus`∈`Goal.manualOverride` → skip | `GoalKrProgressService` | — | `Goal.progressStatus` | ⚠️ работает, юнит-тесты; прод-прогон по расписанию |
| 8 | Еженедельный пульс | `GoalsPulseCron` → `GoalsPulseService.getOrGenerate` (агрегат счётчиков по `progressStatus` + `newThisWeek` + LLM `goals-pulse-summarize`, сухой fallback). Идемпотентно `(tenantId, isoWeek)`. Доставка owner/coo через `ConversationalService.sendNotification(eventType='goals.pulse')` при тумблерах `goals.pulse.enabled`/`deliver_to_telegram` | `goals/cron/goals-pulse.cron.ts` + `GoalsPulseService` + `prompts/goals-pulse-summarize` + `common/utils/iso-week.ts` | `@Cron('0 6 * * 1')` (пн 09:00 МСК) | `WeeklyGoalsPulseDigest`, `Notification` | ⚠️ работает, юнит-тесты; реальная доставка по расписанию на проде |
| 9 | Ручное ведение | `GoalKeyResultsService` (CRUD KR + checkpoint `recordedBy='manual'`), `GoalsService.supersede` (новая версия + старой `validUntil`), reparent `PATCH parentGoalId` с `assertNoCycle`/`assertParentExists`, `mergeManualOverride` на каждой правке | `goals/services/goal-key-results.service.ts` + `goals.service.ts` + `goals.controller.ts` + frontend `GoalsClient/GoalDetailClient.tsx` | `POST/PATCH/DELETE /goals/:id/key-results[/:krId]`, `POST /goals/:id/supersede`, `PATCH /goals/:id` | `Goal`, `GoalKeyResult`, `GoalKeyResultCheckpoint`, `AuditLog` | ✅ |
| 10 | Связь со спринтами/гипотезами | `POST /ideas/:id/goal` (`IdeasService.linkGoal`), `primaryGoalId` в `PATCH /cycles/:id`; `GoalsCheckpointProbeHandler` (`@OnEvent('idea.status_changed')`) при `shipped`+`goalId` → `ProbeService.suggest(reason='goal.kr_checkpoint_suggested')` — НЕ авто-запись KR | `ideas/...`, `tracker/...`, `knowledge-core/...GoalsCheckpointProbeHandler` + frontend `GoalPickerDialog` | `POST /ideas/:id/goal`, `PATCH /cycles/:id` | `Idea.goalId`, `Cycle.primaryGoalId`, probe `Notification` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {commitment, plan_item}, status='canonical')
  ↓ RouterService.matchSpecialists → core.specialist-routing jobName='3-14-goals'
Specialist314GoalsWorker
  ↓ goal-extract (LLM, может вернуть isGoal=false)
  ↓ KNN-dedup (ILIKE-fallback) → promote existing suggested | cap=7 на горизонт
Goal (source='ai', promotionState='suggested'|'active', sourceBlockIds, confidence)
  ↓ goal-hierarchy-link (LLM-арбитр) → parentGoalId
  ↓ GoalKrProgressCron (meeting_count|issue_rollup|metric_entity) → checkpoint + progressStatus
GoalKeyResult.currentValue + GoalKeyResultCheckpoint (тренд)
  ↓ GoalsPulseCron → WeeklyGoalsPulseDigest → ConversationalService (goals.pulse)
Notification (owner/coo)
  + ручной слой: GoalKeyResultsService / supersede / reparent (manualOverride прибивает поля)
  + мост: Idea.goalId / Cycle.primaryGoalId / GoalsCheckpointProbeHandler (probe при shipped)
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 2 | `goal-extract` (capable) | DeepSeek V4 Pro | gpt-5.4-mini → qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/goal-extract.prompt.ts` |
| 5 | `goal-hierarchy-link` (cheap) | DeepSeek V4 Flash | gpt-5.4-mini → qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/goal-hierarchy-link.prompt.ts` |
| 8 | `goals-pulse-summarize` | DeepSeek-chat | gpt-5.4-nano → qwen3.5:9b | `backend/src/modules/goals/prompts/goals-pulse-summarize.prompt.ts` |

Все cache-friendly (стабильный SYSTEM, переменные данные в конце USER). **Без `anthropic`** (не закупаем). Конфиг — `backend/scripts/seed-llm-task-routes-goals.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `goal_kr_autoprogress_total{source_kind, status}` — авто-прогресс KR.
- `goals_pulse_generated_total`, `goals_pulse_failed_total`, `goals_pulse_delivered_total{channel}`.
- `core_specialist_*{type='goal'}` (pipeline_duration / llm_tokens / extraction_failure) — по паттерну специалистов Слоя 3.

**BullMQ очереди** (видно в `/admin/platform/workers`): `core.specialist-routing` (jobName `3-14-goals`).

**Cron'ы** (видно в `/admin/crons`): `goal-kr-progress` (05:00 UTC), `goals-pulse` (пн 06:00 UTC). Оба под `WorkerOrgGate` — admin может выключить per-Org.

**Тумблеры пульса:** `AdminSetting.goals.pulse.enabled` (default true), `goals.pulse.deliver_to_telegram` (default false) — редактируются super_admin через UI настроек.

**Известные грабли:**
- `metric_entity` тянет `Entity.mentionsCount` — у Entity нет числовой value/score, поэтому метрика-источник это best-effort прокси, а не реальное значение KPI.
- AI-цели создаются без `Entity{type=goal}` (`entityId=null`) — линковка с графом отложена в vNext.
- `goal-extract` может зашуметь псевдоцелями из болтовни — митигации: порог confidence, KNN-dedup, cap=7 на горизонт, `promotionState='suggested'` (отличима от official).

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 0 (как `IdeaBlock` со `signalType='commitment'/'plan_item'` появляется).
- [[meeting-post-processing]] — основной поставщик блоков.
- [[specialist-3-3-decisions]] — параллельный специалист Слоя 3; намеренно разделены триггеры (`decision` → 3-3, `commitment`/`plan_item` → 3-14).
- [[probe-question-flow]] — Шаг 10 (probe `goal.kr_checkpoint_suggested` при `idea.status='shipped'`).
- [[notification-dispatch]] — Шаг 8 (доставка пульса через `ConversationalService`).
- [[coo-daily-digest]] — пульс целей построен по образцу COO-дайджеста (клон `DailyOperationsDigest`).
- [[issue-lifecycle]] — Шаг 6 (`issue_rollup` считает закрытые задачи с `goalId`).

## 8. Расхождения «задумано vs реализовано»

**Реализовано по ТЗ (Фазы 0–5, ветка `feature/goals-okr-v2`):**
- ✅ Авто-добыча целей специалистом 3-14 (extract + dedup + hierarchy-link), ручной слой M0 (CRUD KR, supersede, reparent, `manualOverride`), авто-прогресс KR, пульс + дерево, мост к гипотезам.
- ✅ Все фазы: typecheck/lint/build/vitest зелёные.

**Работает, но прод-прогон только по расписанию:**
- ⚠️ Cron'ы `goal-kr-progress` (05:00 UTC) и `goals-pulse` (пн 06:00 UTC) и доставка пульса через `ConversationalService` проверены **юнит-тестами**; реальный прогон и доставка в Telegram/in-app произойдут на проде по расписанию (на момент аудита фича только что выкачена в ветку).

**Осознанные отсрочки (vNext, §9 ТЗ):**
- `Goal.departmentId` (цели отдела) — пока только Org-уровень + дерево.
- Линковка AI-целей с `Entity{type=goal}` (`entityId` остаётся null).
- Регистрация целей в chat-v2 `CardSpecialistRegistry` — не трогали.
- HTTP-e2e дашборд-эндпоинта `goalsTree`/`goalsPulse` — покрыто unit-тестами `fetchGoalsTree`/`fetchGoalsPulse`, e2e отложен (нет авторизованного test-harness).
- Грейдинг цикла 0.0–1.0, кросс-Org бенчмаркинг, AI-предложение целей «с нуля».

**Реализовано иначе, чем дословно в ТЗ:**
- `progressStatusTone`: `ChartTone` не имеет `info`/`sand`, поэтому `achieved→accent`, `dropped→neutral` (ближайшие валидные тона).
- Триггер специалиста — только `commitment` + `plan_item` (НЕ `decision`, как было среди кандидатов в §10 ТЗ), чтобы не дублировать обработку со специалистом 3-3.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-06-02 | Карточка создана; выкат Goals OKR v2 (Фазы 0–5) | `40d5ee3`..`f3f4b2d`, [[05_история/2026-06-02-goals-okr-v2]] |

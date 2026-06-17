---
type: project
status: in_progress
phase: 9
updated: 2026-06-02
---

# Цели компании + стратегический согласователь

> Owner Org создаёт 1–10 целей, привязывает темы — суточный AI-агент оценивает «движется ли компания к цели».
>
> **С 2026-06-02 поверх этого построен «Граф целей» (Goals OKR v2)** — двухуровневая OKR-надстройка (Цель → измеримые Key Results), где цели рождаются и из встреч, и руками, выстраиваются в дерево, обновляют прогресс сами и подсвечиваются еженедельным «пульсом». См. раздел [Goals OKR v2](#goals-okr-v2-граф-целей-2026-06-02) ниже. Это **отдельная ось** — «термометр согласованности» (strategic-alignment воркер) остаётся как был.

## Сущности

`Goal` — цель Org. Поля: `name, description, targetDate?, status, weight, cachedAlignment, cachedAlignmentDelta, cachedAlignmentAt, cachedSnapshotId`.

`GoalTheme` — M:M `Goal ↔ Theme`. `source: manual|ai`, `weight`. На MVP только `manual` (AI-suggester тем — vNext).

`GoalAlignmentSnapshot` — иммутабельный снапшот alignment. Поля: `score (0..100)`, `delta`, `explanation`, `signals: {pro, contra}`, `windowDays`, `themesCount`, `blocksCount`, `aiUsageLogId`, `alertPending`.

Enum'ы: `GoalStatus { active, paused, achieved, abandoned }`, `GoalThemeSource { manual, ai }`.

Расширение `Org`: `strategicAlignmentWindowDays Int @default(30)` — окно расчёта в днях.

## Воркер `strategic-alignment.worker`

- Очередь `core.strategic-alignment` (concurrency 2).
- На каждый job (`{tenantId, goalId, windowDays?}`):
  1. Загрузить Goal + связанные Themes + блоки за окно (LIMIT 200).
  2. LLM-вызов `taskType='goal-alignment'` с JSON Schema (score 0-100, explanation, signals.pro/contra). Validate через Zod.
  3. Загрузить prev snapshot (24-50h назад). `delta = score - prev.score` (или null).
  4. `alertPending = delta <= -15 AND score <= 60`.
  5. Транзакция: создать `GoalAlignmentSnapshot` + обновить `Goal.cached*`.
- На фейл LLM — НЕ создаём snapshot, AuditLog `goal.alignment.failed`. BullMQ ретраит.
- `WorkerOrgGate.checkOrThrow(tenantId, 'strategic-alignment')` — owner может выключить.

## Cron

`@Cron('0 4 * * *')` — каждые сутки в 04:00. Per-Org (`deletedAt IS NULL`) → активные `Goal` → enqueue с jobId `strat_${goalId}_${YYYYMMDD}` (дневной dedup).

## Промпт

`backend/src/modules/knowledge-core/prompts/goal-alignment.prompt.ts` — system + user-builder. Если `targetDate` ≤ 7 дней — добавляется пометка «Дедлайн близок (N дней)».

LlmTaskRoute создан патчем `patch-goal-alignment-route.ts`, providers: `[anthropic, deepseek, openai-via-proxy]`.

## API

```
GET    /api/v1/goals?status=&limit=
GET    /api/v1/goals/:id                          → Goal + themes[] + latestSnapshot + timeline[≤30]
POST   /api/v1/goals                              [owner only]
PATCH  /api/v1/goals/:id                          [owner only]
DELETE /api/v1/goals/:id                          [owner only — soft archive]
POST   /api/v1/goals/:id/themes  body: {themeIds} [owner only]
DELETE /api/v1/goals/:id/themes/:themeId          [owner only]
POST   /api/v1/goals/:id/recompute                [owner/admin/super_admin, quota 5/день]
```

RBAC: ресурс `goal`. owner — read/write/delete. admin — read. manager — read.

Quota: `MAX_GOAL_RECOMPUTE_PER_DAY=5` (per-user, отклонение от ТЗ — фиксировано в decisions-log).

## Расширение дашборда директора (Фаза 8)

`DirectorDashboardDto.strategicAlignment?: { average, goalsCount, alertGoals[] }`:
- `average = SUM(weight * cachedAlignment) / SUM(weight)` для активных целей.
- `alertGoals` = `cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`.

В UI — топ-индикатор `<StrategicAlignmentWidget>` ([frontend/app/(authenticated)/dashboard/widgets/StrategicAlignmentWidget.tsx](frontend/app/(authenticated)/dashboard/widgets/StrategicAlignmentWidget.tsx)) над сеткой 5 виджетов.

## Frontend

- `/goals` — список целей (Tabs: Все / Активные / На паузе / Достигнутые / Архив), поиск, диалог создания/редактирования (только owner).
- `/goals/[id]` — детальная: pro/contra сигналы, timeline (SVG-line), связанные темы, ручной recompute.
- `<TierGate feature="feature.goals_strategy">` (Phase 12) — доступно только на `tier_enterprise`.

## Связанные документы

- [themes.md](themes.md) — темы, связанные с целями.
- [director-dashboard.md](director-dashboard.md) — где встроен индикатор.
- [llm-router.md](llm-router.md) — taskType `goal-alignment`.
- [tariffs-and-entitlements.md](tariffs-and-entitlements.md) — gating `feature.goals_strategy`.

---

# Goals OKR v2 (Граф целей, 2026-06-02)

> **ТЗ:** [`plans/archive/2026-06-02-goals-okr-v2.md`](../../plans/archive/2026-06-02-goals-okr-v2.md) (Фазы 0–5, реализовано целиком). **Анализ-основание:** [`plans/analysis/2026-06-02-goals-okr-research-and-gap.md`](../../plans/analysis/2026-06-02-goals-okr-research-and-gap.md). Ветка `feature/goals-okr-v2`, коммиты `40d5ee3` (Ф0) → `2f7f672` (Ф1) → `e9bc21d` (Ф2) → `efda4de` (Ф3) → `ab82f9a` (Ф4) → `f3f4b2d` (Ф5).
>
> **Суть:** превратить плоский список целей в **граф целей** — двухуровневую OKR-надстройку (Цель → измеримые Key Results), где цель появляется двумя равноправными путями (авто из встреч + руками), выстраивается в дерево «главная → подцели», прогресс обновляется сам из родных источников (счётчик встреч / задачи трекера / метрики графа), а еженедельный «пульс» подсвечивает, что движется / застряло / выполнено.

## Принцип M0 — ручной контроль первичен

Главное архитектурное решение: **авто — это удобство поверх ручного слоя, а не замена**.

- Любое поле любой цели и любого KR правится в любой момент через UI/API, независимо от источника (`Goal.source ∈ {manual, ai}`).
- **Создать цель/KR руками** = первоклассный путь, равный авто-добыче.
- **Перепривязка в дереве** (сменить родителя подцели) — руками, через `PATCH /goals/:id` поле `parentGoalId` (с защитой от циклов `assertNoCycle`).
- **«Передумали через 2 дня»** = правка или supersede; прежняя версия уходит в историю (bitemporal `validFrom/validUntil/supersededById`), но текущая цель отражает новое решение.
- **AI никогда не перетирает поле, отредактированное человеком** — флаг `manualOverride` (JSON-набор имён «прибитых» полей) на уровне Goal и KR. Сервисы авто-прогресса и специалист 3-14 уважают его жёстко.

## Модель данных

Подробные Prisma-определения — [`02_architecture/data-model.md`](../02_architecture/data-model.md) §«Goals OKR v2». Кратко:

- **`Goal` расширен** полями: `source` (GoalSource: manual|ai), `promotionState` (GoalPromotionState: suggested|active|dismissed), `progressStatus` (GoalProgressStatus: on_track|at_risk|stalled|achieved|dropped), `sourceBlockIds[]` (провенанс, GIN-индекс), `confidence` (Decimal 0..1 для AI), `manualOverride` (Json), bitemporal `validFrom/validUntil/recordedAt/supersededById` + self-relations `supersedes/supersedeChain`, relations `keyResults/linkedIdeas/linkedCycles`. Существующие `status` (GoalStatus) и `horizon` (GoalHorizon) НЕ менялись — `progressStatus` это отдельная ось «движение для пульса».
- **`GoalKeyResult`** (новая) — измеримый ориентир, 0..N на цель: `name`, `unit?`, `startValue/targetValue/currentValue` (Decimal(18,4)), `sourceKind` (GoalKrSourceKind: manual|meeting_count|issue_rollup|metric_entity), `sourceConfig` (Json), `source`, `manualOverride`, `createdById?`, relation `checkpoints`.
- **`GoalKeyResultCheckpoint`** (новая) — иммутабельная история значений для тренда: `keyResultId`, `value`, `recordedBy` ('auto'|'manual'), `note?`, `createdAt`.
- **Тонкие FK слоёв (развилка 2):** `Idea.goalId?` (гипотеза, двигающая цель), `Cycle.primaryGoalId?` («этот спринт продвигает цель»). `Issue.goalId` уже был — используется для роллапа.
- **Backfill** `backend/scripts/backfill-goal-v2-defaults.ts` — проставляет legacy-целям `source='manual'`, `promotionState='active'`, `progressStatus='on_track'`, `recordedAt=createdAt` (идемпотентен, в `apply-prod-deploy.ts` STEPS).

## Ручной слой (Фаза 1)

- **`GoalKeyResultsService`** (`backend/src/modules/goals/services/goal-key-results.service.ts`) — CRUD Key Results; при ручном изменении `currentValue` в той же `$transaction` пишет `GoalKeyResultCheckpoint(recordedBy='manual')`. На каждой ручной правке Goal/KR вызывает `mergeManualOverride` — помечает правленые поля.
- **`GoalsService.supersede`** (`goals.service.ts`) — создаёт новую версию цели + проставляет старой `validUntil=now` (status сохраняется как история).
- **Reparent** через `PATCH /goals/:id` поле `parentGoalId` с `assertNoCycle` / `assertParentExists`.
- Эндпоинты: `POST/PATCH/DELETE /goals/:id/key-results[/:krId]`, `POST /goals/:id/supersede`. RBAC ресурс `goal_key_result` (owner r/w/d, admin/manager r).
- Frontend: секция «Ключевые результаты» (CRUD, ручной ввод `currentValue`, прогресс-бар парными токенами), диалоги «Сделать подцелью…» (reparent) и «Заменить цель» (supersede), маркер «Предложено Корой» для `promotionState='suggested'` + кнопка «Принять цель».

## Авто-добыча целей — специалист 3-14-goals (Фаза 2)

Цели рождаются из встреч так же, как решения/идеи у других специалистов Слоя 3.

- **Воркер** `backend/src/modules/knowledge-core/workers/specialist-3-14-goals.worker.ts` — consumer очереди `core.specialist-routing`, jobName-фильтр `'3-14-goals'`, concurrency 2.
- **Сервис** `specialist-3-14-goals.service.ts` — `extract → KNN-dedup → hierarchy-арбитр → create`.
- **RouterService:** `SPECIALIST.GOALS='3-14-goals'`, PRIORITY 3.8, `matchSpecialists` диспатчит блоки с `signalType ∈ {commitment, plan_item}` (НЕ `decision` — иначе двойная обработка с 3-3; LLM-extract сам фильтрует не-цели).
- **Промпты** `goal-extract` (capable, может вернуть `isGoal=false` — анти-плодёж) и `goal-hierarchy-link` (cheap, арбитр «какая цель — родитель данной»), cache-friendly, strict JSON Schema.
- **Жизненный цикл:** AI-цель создаётся как `source='ai', promotionState='suggested'`; при `confidence≥0.8` или повторном упоминании (dedup→promote существующей suggested) → `promotionState='active'`; иначе ждёт тапа owner'а. Cap = 7 active+suggested целей на горизонт (антиплодёж). `createdById=owner Org` (нет owner → skip). Goal без embedding-колонки → KNN-дедуп через ILIKE-fallback.
- **Осознанные отсрочки:** `Entity{type=goal}` для AI-целей НЕ создаётся (`entityId=null`, backfill отдельно vNext); `CardSpecialistRegistry` (chat-v2) не трогали.

## Авто-прогресс Key Results (Фаза 3)

Числа двигаются сами.

- **`GoalKrProgressService`** + cron **`GoalKrProgressCron`** (`@Cron('0 5 * * *')` — ежедневно 05:00 UTC), per-Org/per-goal try/catch, только `status='active'` + `validUntil=null` цели.
- По `sourceKind`:
  - `meeting_count` → `prisma.meeting.count({ status:'completed', deletedAt:null, опц. type/endedAt.gte })`;
  - `issue_rollup` → `prisma.issue.count({ state.category='completed', goalId })`;
  - `metric_entity` → `Entity.mentionsCount` (best-effort — у Entity нет числовой value/score, только mentionsCount);
  - `manual` → skip.
- `GoalKeyResultCheckpoint(recordedBy='auto')` пишется **только при изменении** значения, в `$transaction`.
- **M0 уважается:** если `'currentValue' ∈ KR.manualOverride` или `'progressStatus' ∈ Goal.manualOverride` — авто не трогает.
- `progressStatus` пересчитывается из тренда checkpoints за 14 дней: `achieved` (≥100%), `stalled` (goalDelta≤0), `at_risk` (отставание от темпа >25 п.п.), иначе `on_track`. `dropped` авто не выставляется.
- Метрика `goal_kr_autoprogress_total{source_kind,status}`.

## Пульс + дерево (Фаза 4)

То, что видит пользователь.

- **Модель `WeeklyGoalsPulseDigest`** (клон `DailyOperationsDigest`, `@@unique([tenantId, isoWeek]`) — идемпотентность cron'а.
- **`GoalsPulseService`** — агрегирует счётчики целей по `progressStatus` + `newThisWeek`; `getOrGenerate` идемпотентен; LLM `goals-pulse-summarize` для связного текста + сухой fallback при ошибке LLM. Хелпер `common/utils/iso-week.ts`.
- **`GoalsPulseCron`** (`@Cron('0 6 * * 1')` — понедельник 06:00 UTC = 09:00 МСК): тумблеры `goals.pulse.enabled` / `goals.pulse.deliver_to_telegram` через `getDynamic`; доставка ролям owner/coo через `ConversationalService.sendNotification(eventType='goals.pulse')` (+ payload-схема + строка в `EVENT_TYPE_CHANNEL_POLICY`); `markDelivered`; per-Org try/catch.
- AdminSetting `goals.pulse.enabled` (default true) / `goals.pulse.deliver_to_telegram` (default false), seed `seed-admin-setting-goals-pulse.ts`. Метрики `goals_pulse_{generated,failed,delivered}_total`.
- **Дашборд:** `DirectorDashboardDto.goalsTree?` (иерархия parent→children с per-KR `progressPercent`) и `goalsPulse?` (счётчики недели), наполняются `fetchGoalsTree` / `fetchGoalsPulse` в `getDirectorView`.
- **Frontend:** `GoalsPulseWidget` (5 счётчиков парными токенами) + `GoalsTreeView` (рекурсивное дерево, чип статуса, per-KR бары) + переключатель «Список / Дерево» на `/goals`; на дашборде виджет + дерево смонтированы рядом со `StrategicAlignmentWidget`. Мапперы `progressStatusChipClasses` / `progressStatusTone` / `buildTree`.
- **Отсрочка:** HTTP-e2e дашборд-эндпоинта отложен (нет авторизованного test-harness) — покрытие unit-тестами `fetchGoalsTree`/`fetchGoalsPulse`.

## Мост к гипотезам (Фаза 5)

«Цель = проверить гипотезу».

- **`POST /ideas/:id/goal`** (`IdeasService.linkGoal`) — привязка гипотезы к цели (валидация goal+tenant, audit).
- **`primaryGoalId`** в `UpdateCycleSchema` / `CyclesService.update` (валидация goal) + в `CycleResponseDto` и sprint-analyst — «этот спринт продвигает цель X».
- **`GoalsCheckpointProbeHandler`** (`@OnEvent('idea.status_changed')`): при `status='shipped'` + наличии `idea.goalId` → `ProbeService.suggest(reason='goal.kr_checkpoint_suggested')` ролям owner-цели + owner/admin. **НЕ авто-запись KR** — outcome требует подтверждения человеком (свободный текст без кнопок). `ProbeService` через `@Optional` → no-op в worker-процессе без него.
- Frontend: секция «Двигает цель» в карточке идеи + блок «Продвигает цель» в дашборде спринта + общий `GoalPickerDialog`, гейт owner/admin.
- Специалист целей по-прежнему **НЕ создаёт** идеи/спринты/задачи (развилка 2).

## Что осталось (vNext, §9 ТЗ)

`Goal.departmentId` (цели отдела); грейдинг цикла 0.0–1.0; кросс-Org бенчмаркинг; линковка AI-целей с `Entity{type=goal}`; регистрация в chat-v2 `CardSpecialistRegistry`; HTTP-e2e дашборда; AI-предложение целей «с нуля» (без встреч).

## ТЗ-F — Ответственный за цель + читаемость (2026-06-05)

**Источник:** [`plans/tz/2026-06-05-goals-improvements.md`](../../plans/tz/2026-06-05-goals-improvements.md) (Ф1–Ф4; Ф5 голос — vNext). Ветка `feature/goals-improvements`. Коммиты Ф1 `afe344b2`+`2701cff2`, Ф2 `62febeec`, Ф3 `158ac9df`, Ф4 `184bce07`.

- **Ответственный человек** — `Goal.ownerPersonId` (nullable, relation `GoalOwnerPerson`, `onDelete: SetNull`, `@@index([tenantId, ownerPersonId])`; back-relation `Person.ownedGoals`). Сервис: guard `assertOwnerPersonExists` (`owner_person_not_found`), connect/disconnect в create/update, `GoalListItemDto` += `ownerPersonId`/`ownerPersonName`. UI: пикер через `usePersons` в Create/Edit диалогах (sentinel `__none__` = «Не назначен»), вывод «Ответственный: {имя}» в карточке.
- **Светофор уверенности** (derive, без новой колонки) — `confidenceLevel(themesCount, blocksCount)` в `frontend/src/domain/goal.ts` → 3 состояния «Мало/Достаточно/Много данных» (парные токены, без процентов). Воркер `strategic-alignment.worker` пишет `Goal.cachedBlocksCount` (для светофора в списке без JOIN). Чип в `GoalCard` и шапке `GoalDetailClient`.
- **Один вердикт движения** — `movementVerdict(cachedAlignment, progressStatus)` склеивает два индикатора в один текст (статус приоритетнее балла: achieved/dropped/stalled/at_risk + on_track×балл). Поля БД (`cachedAlignment`, `progressStatus`) не трогаются — склейка в UI (C-2).
- **Русификация UI** — из видимого текста целей убраны `cron`/`snapshot`/`timeline`/`₽` (Timeline→«История движения к цели», snapshots→«замеры», «cron'а 04:00»→«Кора рассчитывает каждую ночь», placeholder «встреч, %, ₽»→«встреч, задач, %»). Имена компонентов/пропсов (`TimelineChart`/`SnapshotRow`) — контракт, не трогали.
- Пороги светофора — code-fallback в `domain/goal.ts`; вынос в AdminSetting → vNext. Ф5 (голосовая постановка цели) — vNext.

## Связанные документы (v2)

- [`02_architecture/data-model.md`](../02_architecture/data-model.md) — модели Goal/GoalKeyResult/Checkpoint/WeeklyGoalsPulseDigest.
- [`02_architecture/module-map.md`](../02_architecture/module-map.md) — специалист 3-14, cron'ы пульса и авто-прогресса.
- [`workers-queues.md`](workers-queues.md), [`ai-jobs.md`](ai-jobs.md) — воркер/cron'ы + 3 taskType.
- [`api-layer.md`](api-layer.md) — новые эндпоинты Goals OKR v2.
- [`frontend-pages.md`](frontend-pages.md) — дерево/пульс на `/goals` и дашборде.
- [`03_processes/goals-auto-lifecycle.md`](../03_processes/goals-auto-lifecycle.md) — карточка процесса «авто-добыча и ведение целей».
- [`ideas.md`](ideas.md), [`sprints.md`](sprints.md) — мост к гипотезам и спринтам.

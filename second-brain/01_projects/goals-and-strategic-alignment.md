---
type: project
status: in_progress
phase: 9
---

# Цели компании + стратегический согласователь

> Owner Org создаёт 1–10 целей, привязывает темы — суточный AI-агент оценивает «движется ли компания к цели».

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

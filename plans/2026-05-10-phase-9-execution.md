---
type: execution-plan
phase: 9
feature: knowledge-core — Goal + strategic-alignment (backend slice)
status: in_progress
date: 2026-05-10
---

# Фаза 9 — execution (backend, шаги 1-6)

Реализация по [plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md](tz/2026-05-10-phase-9-goals-strategic-alignment.md).
Текущий слайс — backend (шаги 1-6). Frontend (шаги 7-8) и документация (шаг 9) — следующие итерации.

## Backend slice

- [x] **Шаг 1 — Prisma schema** (commit `35a8788`).
  - enum'ы `GoalStatus { active, paused, achieved, abandoned }`, `GoalThemeSource { manual, ai }`.
  - Модели `Goal`, `GoalTheme`, `GoalAlignmentSnapshot` (полные поля, индексы по ТЗ §9.1).
  - Расширил `Org.strategicAlignmentWindowDays Int @default(30)`.
  - Обратные связи: `User.goalsCreated`, `Theme.goalLinks`, `Org.goals`, `Org.goalAlignmentSnapshots`.
  - `bun run prisma:push --accept-data-loss && bun run prisma:generate` — чисто.
  - `bun run typecheck` — зелёный.

- [x] **Шаг 2 — RBAC ресурс `goal` + Quota** (commit `68261b5`).
  - `RbacService.ResourceType += 'goal'`, `isResourceType` массив расширен.
  - `policy.csv`: `owner` — read/write/delete; `admin` — read; `manager` — read.
  - Новая ENV `MAX_GOAL_RECOMPUTE_PER_DAY=5` в `env.schema.ts` + `cfg.workspace.maxGoalRecomputePerDay`.

- [x] **Шаг 3 — Модуль `goals` (CRUD + темы)** (commit `9b3df56`).
  - `backend/src/modules/goals/{goals.module,goals.controller}.ts`.
  - `services/goals.service.ts` — `list/get/create/update/archive/addThemes/removeTheme`.
  - `dto/goals.dto.ts` — Zod-схемы для query/body, response interfaces.
  - Auth: `@UseGuards(CookieAuthGuard, TenantGuard)`. RBAC через `RbacService.canRead/canWrite/check('delete')`.
  - AuditLog actions: `goal.created`, `goal.updated`, `goal.deleted`, `goal.theme.added`, `goal.theme.removed`.
  - Регистрация в `AppModule`.

- [x] **Шаг 4 — `core.strategic-alignment` worker + cron + prompt + LlmTaskRoute** (commit `506426c`).
  - Очередь `STRATEGIC_ALIGNMENT = 'core.strategic-alignment'` + payload `StrategicAlignmentJobData`.
  - `CoreQueueService.enqueueStrategicAlignment({tenantId, goalId, manual?, windowDays?})` —
    jobId `strat_<goalId>_<YYYYMMDD>` (cron) или `strat_manual_<goalId>_<ts>` (manual).
  - `strategic-alignment.worker.ts` — concurrency 2, WorkerOrgGate.checkOrThrow,
    LIMIT 200 блоков, prev snapshot 20-50h, alertPending по правилу,
    транзакция snapshot+Goal cache, AuditLog `goal.alignment.{computed,failed,skipped}`.
  - `strategic-alignment.cron.ts` — `@Cron('0 4 * * *')`, AuditLog `goal.alignment.scheduled`.
  - `goal-alignment.prompt.ts` — system prompt + JSON Schema strict + Zod validate +
    builder с пометкой «Дедлайн близок» при ≤7 дн.
  - `backend/scripts/patch-goal-alignment-route.ts` — idempotent (findFirst+create),
    запущен → `[created]` (id `cmozm8axq0001gye8oc4d708k`).
  - WorkersModule: `AuditModule` import (для AuditLogService) + регистрация воркера и cron.

- [x] **Шаг 5 — `POST /goals/:id/recompute` + quota** (commit `1855f17`).
  - `GoalsController.recompute` под `RbacService.canManageOrg` (owner / super_admin).
  - `GoalsService.recompute` — quota `goal_recompute_per_day` через `QuotaService.checkAndIncrement`,
    enqueue strategic-alignment с `manual: true`, AuditLog `goal.alignment.recompute_requested`.
  - Возвращает `{enqueued: true, jobId}`.
  - HTTP 202 Accepted.

- [x] **Шаг 6 — `DirectorDashboardService.strategicAlignment` блок** (commit `7bf2ed6`).
  - `DirectorDashboardDto.strategicAlignment?: {average, goalsCount, alertGoals[]}` — opt для backward compat.
  - `fetchStrategicAlignment` — 7-й параллельный запрос в `Promise.all`.
  - `average = Σ(weight × cachedAlignment) / Σweight` для целей с `cachedAlignment != null`.
  - `alertGoals` = цели где `cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`.
  - `bun run build` — чистый.

## Verification

- `bun run typecheck` — все 6 шагов зелёные.
- `bun run build` — после Шага 6 зелёный.
- `bun run prisma:push` — после Шага 1, без warnings.
- Patch-script `patch-goal-alignment-route.ts` — `[created]` → повторно `[skipped]` (идемпотентен).

## Не входит (этого слайса)

- Шаги 7-8 — frontend `/goals`, `/goals/[id]`, `Sidebar`, `DirectorDashboardClient`.
- Шаг 9 — second-brain документация и decisions-log.

## Открытые вопросы / отклонения

1. **Quota per-user, не per-Org.** ТЗ говорит «5 пересчётов/сутки/Org», но `QuotaService.checkAndIncrement`
   принимает только `userId` (через FK `UserQuotaCounter.userId → User.id`). Использован реальный `userId`
   запроса. На малых Org (1 owner) — эквивалентно. Для строгого per-Org квотирования потребуется отдельная
   таблица или дополнительный quota-key. Зафиксировать в `decisions-log.md` (под оркестратором).

2. **`LlmRouterService` метод `call`, не `invoke`.** ТЗ упоминает `invoke`, в коде — `call`. Используется
   фактическое имя.

3. **`responseFormat: 'json_schema'` strict в воркере** — провайдеры, не поддерживающие, отвалятся
   и LlmRouter перейдёт к следующему. Если все откажутся — Zod-валидация ответа всё равно сработает.
   На фейл LLM/parse — snapshot НЕ создаётся (ТЗ §9.2), AuditLog `goal.alignment.failed`,
   throw → BullMQ ретраит через стандартные attempts.

4. **Org-Admin тумблер воркера: имя `'strategic-alignment'`** — owner Org может выключить новый воркер
   через `Org.workersEnabled` map (Phase 7).

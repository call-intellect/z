---
type: execution-plan
phase: 9
feature: knowledge-core — Goal + strategic-alignment (backend + frontend slice)
status: in_progress
date: 2026-05-10
---

# Фаза 9 — execution (backend шаги 1-6 + frontend шаги 7-8)

Реализация по [plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md](tz/2026-05-10-phase-9-goals-strategic-alignment.md).
Backend (шаги 1-6) и frontend (шаги 7-8) — готовы. Документация (шаг 9) — оркестратор.

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

## Frontend slice

- [x] **Шаг 7 — frontend domain + API + страница `/goals`** (commit `986e0e9`).
  - `frontend/src/domain/goal.ts` — `GoalApi/Domain`, snapshot/theme-link mappers,
    форматтеры (`formatAlignment`, `formatDelta`, `alignmentTextColor/BarColor`,
    `daysUntil/targetDateLabel`, `statusBadgeVariant`).
  - `frontend/src/api/goals.api.ts` — `goalsApi.{list, get, create, update,
    archive, addThemes, removeTheme, recompute}` через `apiClient` + `orgHeaders`.
  - `frontend/app/(authenticated)/goals/{page,GoalsClient}.tsx`:
    - Список Card'ов с прогресс-баром согласованности (цвет 0-40 red, 40-70
      yellow, 70-100 green) + delta-стрелка.
    - Tabs-фильтр статуса (Все/Активные/На паузе/Достигнутые/Архив), поиск по
      `name` (clientside debounce 300ms), pluralizeRu для счётчиков.
    - Диалоги «Создать» и «Редактировать» (с архивацией) — только owner.
    - Empty state с подсказкой про owner / еженедельный мониторинг.
  - `Sidebar.tsx` — пункт «Цели» (icon Target) между «AI-темы» и «AI-чат» для
    всех ролей; manager увидит read-only (без кнопок).

- [x] **Шаг 8 — frontend `/goals/[id]` + StrategicAlignmentWidget** (commit pending).
  - `frontend/app/(authenticated)/goals/[id]/{page,GoalDetailClient}.tsx`:
    - Header: name, description, status, targetDate, кнопки «Пересчитать»
      (toast «Quota exceeded» на `quota_exceeded`), «Редактировать» (owner),
      «Архивировать» (owner).
    - Карточка «Текущая согласованность» с крупной цифрой, delta-pill,
      прогресс-бар, AI explanation, alert-баннер при `alertPending`.
    - Блок pro/contra (success/danger карточки).
    - SVG-Timeline (line + цветные точки по диапазонам) при `timeline ≥ 3`,
      иначе мелкая надпись «Недостаточно данных».
    - Список snapshots под графиком (дата, score, delta, explanation).
    - Связанные темы (read-only с linkable themeName) + диалог «Добавить
      темы» (поиск через `themesApi.list`, multi-select, owner only).
  - `frontend/app/(authenticated)/dashboard/widgets/StrategicAlignmentWidget.tsx`:
    - 3 состояния: «нет целей» / «не считалось» / основной body с крупной
      цифрой `average`, числом активных целей, списком `alertGoals`
      (clickable, с подсветкой и Δ).
  - `DirectorDashboardClient.tsx` — `<StrategicAlignmentWidget>` вместо TODO-якоря.
  - `bun run typecheck` — зелёный.
  - `bun run build` — зелёный.

## Verification

- `bun run typecheck` (backend + frontend) — все 8 шагов зелёные.
- `bun run build` (frontend) — после шага 8 зелёный.
- `bun run prisma:push` — после Шага 1, без warnings.
- Patch-script `patch-goal-alignment-route.ts` — `[created]` → повторно `[skipped]` (идемпотентен).

## Не входит (этого слайса)

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

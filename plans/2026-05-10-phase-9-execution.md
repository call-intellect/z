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

- [ ] Шаг 1 — Prisma schema: enum'ы `GoalStatus`, `GoalThemeSource`; модели `Goal`, `GoalTheme`, `GoalAlignmentSnapshot`; `Org.strategicAlignmentWindowDays`; обратные связи в `User`/`Theme`.
- [ ] Шаг 2 — RBAC `goal` ресурс + `policy.csv` правила + ENV `MAX_GOAL_RECOMPUTE_PER_DAY=5`.
- [ ] Шаг 3 — Модуль `goals` (CRUD + темы), регистрация в `AppModule`.
- [ ] Шаг 4 — `core.strategic-alignment` очередь + worker + cron + промпт + `LlmTaskRoute` patch.
- [ ] Шаг 5 — `POST /goals/:id/recompute` с quota.
- [ ] Шаг 6 — DirectorDashboardService.strategicAlignment + DTO.

## Не входит (этого слайса)

- Шаг 7-8 — frontend `/goals`, `/goals/[id]`, `Sidebar`, `DirectorDashboardClient`.
- Шаг 9 — second-brain документация и decisions-log.

## Открытые вопросы / отклонения

(заполняется по ходу)

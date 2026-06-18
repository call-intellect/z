# Orchestrator-prompt — Единый рабочий стол задач

Промпт для запуска скилла **tz-orchestrator** по ТЗ `plans/tz/2026-06-18-tasks-unified-workspace-phase1.md`. Ведёт по ТЗ (не дублирует). Реализовать в отдельном git-worktree, фаза за фазой, строго последовательно.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (стек Bun+Node+TS, Ship-On, prisma-migrate-правила, vexp-first, UI только русский, парные цвет-токены).
2. `second-brain/index.md`, затем `02_architecture/module-map.md` (раздел tracker).
3. **ТЗ целиком** — `plans/tz/2026-06-18-tasks-unified-workspace-phase1.md` (контракты К1–К9, фазы Ф1–Ф8, решения Р1–Р6, доказательства Д1/Д2 — не пересматривать). Парный Календарь (`2026-06-18-tasks-workspace-calendar.md`) — вне scope этого прогона.
4. Код-якоря (перечитать, номера строк могли сместиться — искать по символам):
   - `backend/src/modules/tracker/services/issues.service.ts` — `findAll`, `findMyInbox`, `moveToProject` (блок «Ремап state по category»), `transitionState`, `toResponseFromInclude`.
   - `backend/src/modules/tracker/controllers/{me-inbox,issues,intake,sprints}.controller.ts`, `tracker.module.ts`.
   - `backend/src/modules/rbac/rbac.service.ts` — `canViewOperationsDashboard`, `getMembershipRole`, membership-контекст `:440-488` (role+visibility).
   - `backend/prisma/schema.prisma` — `enum OrgVisibilityMode :208`, `Org.visibilityMode :2455`.
   - `backend/src/modules/tracker/services/intake.service.ts:414` (`findAll` сквозной), `dto/sprints/sprint-list-item.dto.ts` (`GET /sprints`).
   - `frontend/src/ui/tracker/{Board,IssueList,IssueCard,IntakeBoard,ProjectPickerDialog}.tsx`, `frontend/src/hooks/tracker/{useIssues,useMyInbox,useProjects,useCycles}.ts`, `frontend/src/domain/tracker/{issue,enums,project}.ts`, `frontend/src/api/tracker/issues.api.ts`, `frontend/src/api/org-members.api.ts`, `frontend/app/(authenticated)/projects/{page,ProjectsListClient}.tsx`, `frontend/app/(authenticated)/settings/organization/OrganizationClient.tsx`.

## Инструменты
- Контекст по коду — `run_pipeline` (vexp) первым; при живом демоне Grep/Glob блокируются хуком. В этой сессии vexp был недоступен → Explore + Grep/Read.
- Context7 — не нужен (стек уже в проекте), кроме сомнений в API.

## Граф фаз (строго последовательно, без остановки между волнами)
**Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 → Ф7 → Ф8.** Ф1/Ф2 backend. Ф3←контракты Ф1+Ф2. Ф4←Ф3. Ф5←Ф4 (стол: Доска/Список/Архив). Ф6←Ф5 (виды Спринты/Входящие — встраивание готовых `GET /sprints`/`GET /intake`). Ф7←Ф1 (тумблер `visibilityMode` в админке). Ф8 — доводка. Зелёная верификация → commit фазы → следующая; **push — только с подтверждением владельца**.

## Факт-чек суб-агентов («не верь отчёту [x]»)
После каждого кодера — независимо: грепнуть маркеры Acceptance в реальных файлах; re-Read изменённого; свой `bun run typecheck && lint && build` в затронутом пакете + `bunx vitest run <spec>`.
- **Критично Ф1:** интеграционный тест видимости — `manager`+`strict` НЕ видит чужую задачу; `manager`+`open` видит; руководитель видит всё. Без него Ф1 не закрыта.
- **Критично Ф2:** `transitionToCategory` **делегирует** в `transitionState` (грепнуть вызов), не дублирует activity/ingest.
- **Критично Ф4:** `git diff --stat frontend/src/ui/tracker/Board.tsx` пуст (R6).

## Failure-modes
- Композиция Prisma `where` для рядового: `q.OR` и self-scope.OR не затирают друг друга — self-scope в `where.AND=[{OR:[…]}]` (см. К4-примечание).
- Видимость: НЕ заводить новую настройку — использовать `Org.visibilityMode` (Р4/Д2). Если в `OrganizationClient` тумблера нет — добавить туда через `orgs.api.ts`, не создавать task-специфичный конфиг.
- Входящие у рядового: RBAC `intake_issue` = owner/admin/coo — вкладку рядовому не показывать, фронт не должен падать на 403.
- `GET /issues` vs `issues/:id` — bare `/issues` резолвится в новый контроллер (Swagger-smoke).
- После удаления `ProjectsListClient` — `grep -rn "ProjectsListClient" frontend` = 0.
- tenant-scope на `GET /issues` обязателен (TenantGuard + `where.tenantId`).

## Прод
Миграций/ENV/очередей/seed нет (`visibilityMode` и `stateCategory`-в-ответе не требуют БД-изменений). Prod = `docker compose up -d --build`. Обновить только Шаг 12 prod-deploy-log (Swagger-smoke новых эндпоинтов). Feature-flag не нужен (Ship-On; видимость = существующий `Org.visibilityMode`).

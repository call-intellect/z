---
type: tz
status: ready-to-implement
feature: tasks-unified-workspace
date: 2026-06-18
owner: Сергей (Владелец)
relates_to:
  - plans/analysis/2026-06-13-cabinet-redesign-prototypes/_parts/part-tasks.html
  - plans/analysis/2026-06-13-cabinet-redesign-architecture.md
  - plans/tz/2026-06-15-issue-move-to-project.md
  - plans/tz/2026-06-18-tasks-workspace-calendar.md
---
> Эталон-прототип: `plans/analysis/2026-06-13-cabinet-redesign-prototypes/_parts/part-tasks.html` · Развилки согласованы с владельцем 2026-06-18 (Р1–Р6 ниже).

# Единый «рабочий стол задач» вместо «список проектов → проваливание в проект»

## Цель

Сделать так, чтобы пункт меню **«Задачи»** открывал **единый рабочий стол**, где проект — это **фильтр**, а не отдельный экран. Сейчас «Задачи» ведут на список проектов; чтобы увидеть задачи, надо провалиться в конкретный проект (`/projects/[slug]/board`), а смена проекта = выйти назад и зайти заново. Цель — единый стол с переключателем «Все проекты / конкретный проект», видами **Доска / Список / Спринты / Входящие / Архив** и фильтрами **команда / спринт / поиск**, как в прототипе. Богатый **Календарь** (встречи + дедлайны + подсказки Коры) — парным ТЗ (`2026-06-18-tasks-workspace-calendar.md`).

### Зачем (болезненное состояние → решение)
- **Сейчас:** доска жёстко привязана к одному проекту и в UI (`ProjectViewShell` оборачивает каждый `/projects/[slug]/*`), и в API (`GET /api/v1/projects/{projectId}/issues` **требует** `projectId`). Кросс-проектной выборки задач нет, кроме `GET /api/v1/me/inbox` — а он отдаёт **только** задачи, где `assignee = currentUser`. Руководитель не видит «все задачи компании» за один экран.
- **Станет:** «Задачи» = рабочий стол. По умолчанию режим «Все проекты», переключение на проект — фильтр без перехода. Глубокие/настроечные страницы проекта (Обзор/Настройки/Документы/Приложения/Гант/Загруженность) остаются на `/projects/[slug]/*` и открываются кнопкой «Открыть проект →».

## REALITY-CHECK (проверено по коду 2026-06-18)

| Что | Статус | Где |
|---|---|---|
| Per-project доска с DnD по статусам + fallback на 5 категорий (DnD выкл.) | ✅ работает | `frontend/src/ui/tracker/Board.tsx` |
| Per-project список с группировкой по категориям | ✅ работает | `frontend/src/ui/tracker/IssueList.tsx` |
| Кросс-проектная выборка «мои» | ✅ есть | `IssuesService.findMyInbox` `issues.service.ts:508` |
| Кросс-проектная выборка «все/по команде» (задачи) | ❌ нет — **ядро** | — |
| Резолв «статус проекта по category» (для DnD «Все проекты») | ✅ паттерн есть | `IssuesService.moveToProject` блок `// Ремап state по category` `issues.service.ts:1066-1085` |
| **Входящие сквозные** | ✅ **уже tenant-scoped** (опц. `projectId`) | `IntakeService.findAll(tenantId, query, userId)` `intake.service.ts:414`; эндпоинт `GET /api/v1/intake` |
| **Спринты org-wide** (богатый master-detail) | ✅ **уже есть** | `GET /api/v1/sprints` → `ListSprintsResponse` (`sprint-list-item.dto.ts`); detail `/sprints/[id]` + `GET /cycles/:id/dashboard` |
| **Видимость рядового per-Org** (`open`/`strict`) | ✅ **уже есть и применяется RBAC** | `enum OrgVisibilityMode` `schema.prisma:208`; `Org.visibilityMode` `:2455`; контекст в `rbac.service.ts:440-488` |
| UI переключателя видимости организации | ✅ вероятно есть | `frontend/app/(authenticated)/settings/organization/OrganizationClient.tsx` (проверить, что owner/admin видит тумблер) |
| Предикат лидерства owner/admin/coo | ✅ есть | `RbacService.canViewOperationsDashboard` `rbac.service.ts:328`; роль — `getMembershipRole` `:424` |
| 5 универсальных категорий + русские подписи | ✅ есть | `frontend/src/domain/tracker/enums.ts:43` (`Бэклог/К работе/В работе/Готово/Отменено`) |
| `IssueResponseDto` несёт `projectId/identifier/cycleId/dueDate/assigneeUserIds`, но НЕ `stateCategory` | ⚠️ — **добавить** `stateCategory` | `dto/issues/issue-response.dto.ts:1` |
| Диалог выбора проекта (создать в режиме «Все проекты») | ✅ переиспользовать | `frontend/src/ui/tracker/ProjectPickerDialog.tsx` |
| Меню «Задачи» → `/projects` (matchPrefix `/projects`) | ✅ — **НЕ менять** href | `frontend/src/ui/components/app-shell/nav-config.ts:223` |
| Легаси `/tasks` («задачи из встреч», `tasksApi`) | ⚠️ orphaned (меню туда не ведёт) | `frontend/app/(authenticated)/tasks/TasksClient.tsx` — вне scope, строка в `04_не-сделано` |

**Вывод:** готовность выше, чем казалось. **Спринты, Входящие, Видимость рядового** уже имеют backend/данные — добор дешёвый (фронт встраивает готовое). Недостаёт двух backend-примитивов (сквозной список задач + переход-по-категории) и фронтового стола. Дорогой и обособленный только **богатый Календарь** → вынесен в парное ТЗ.

## Принятые решения владельца (2026-06-18 — открыты к пересмотру, но сейчас зафиксированы)

| # | Решение | Обоснование (почему) |
|---|---|---|
| **Р1** | Объём: единый стол с видами **Доска · Список · Спринты · Входящие · Архив** + фильтры команда/спринт/поиск + быстрое создание + сквозной backend. Богатый **Календарь** — парным ТЗ. | Владелец: «ничего не откладывать» по тому, что дёшево. Спринты/Входящие уже имеют org-wide инфраструктуру; Архив = флаг `includeArchived`. Календарь тянет подсистему встреч и LLM-подсказки — отдельная фича, иначе ТЗ разрастётся и застрянет. |
| **Р2** | Режим «Все проекты» — колонки по 5 категориям; **перетаскивание работает**: задача переходит в статус **своего** проекта по целевой колонке-категории. Режим одного проекта — реальные статусы (как сейчас). | У проектов разные наборы статусов (напр. «На проверке» из прототипа — кастомный статус одного проекта, не категория). Резолв «category → статус проекта» уже в `moveToProject` — переиспользуем. Механика DnD дешёвая, UX живее. |
| **Р3** | Видимость в «Все проекты»: **руководитель** (`owner`/`admin`/`coo`) — задачи всей команды; **рядовой** (`manager`) — зависит от `Org.visibilityMode`: `open` → видит все (read), `strict` → только свои (assignee=self ИЛИ создатель). Фильтр по человеку — поверх (руководителю). | Это «галочка», которую просил владелец, и она **уже существует** per-Org и применяется ко всему кабинету. См. Р4 — доказательство, почему переиспользуем, а не плодим новую настройку. |
| **Р4** | «Галочку видимости» НЕ делать новой настройкой — **переиспользовать `Org.visibilityMode`** (`open`/`strict`). Убедиться, что тумблер доступен owner/admin в админке организации; если нет — добавить туда. | Новая task-настройка = второй конфликтующий рубильник (память видит одно, задачи — другое) → расхождение, путаница владельца, дублирование логики. Чини класс, не кейс. `visibilityMode` уже интегрирован в RBAC и покрыт `rbac.service.spec.ts`. |
| **Р5** | Спринты-вид и Входящие-вид — **встраивание готового** (`GET /sprints`, `GET /intake`), не переписывание. Detail спринта — существующий `/sprints/[id]`. | Org-wide ручки и компоненты уже есть; дублировать = код ради кода. |
| **Р6** | Богатый Календарь — парное ТЗ `2026-06-18-tasks-workspace-calendar.md` (draft). В этом ТЗ вкладку «Календарь» **не рендерим**. | Завязан на meetings + sprint-hints + LLM — отдельная подсистема. |

## Доказательство выбора

### Д1. Сквозные задачи: backend-эндпоинт (A) vs фронтовый fan-out (B)
| Критерий | A (org-эндпоинт) | B (фронт fan-out по проектам) |
|---|---|---|
| Запросов при N проектах | 1 | N (N+1) |
| Пагинация/поиск сквозь проекты | на сервере, единым запросом | на клиенте, рвётся между страницами |
| RBAC/visibility (Р3/Р4) | централизованно на сервере | дублировать на клиенте, дыра |
| Рост числа проектов | O(1) | линейная деградация |
| Согласованность с `me/inbox`/`sprints` (прецеденты org-wide ручек) | да | нет |
**A выбран.** Challenge-loop: корень (нет сквозной выборки) а не симптом; переиспуем `toResponseFromInclude`/`findAll`-фильтры/резолв категории/`Board`/`IssueList`/`ProjectPickerDialog`; в режиме одного проекта НИЧЕГО не дублируем (используем существующий `<Board>`).

### Д2. Видимость рядового: переиспользовать `visibilityMode` (A) vs новая task-настройка (B)
| Критерий | A (`Org.visibilityMode`) | B (новая `tracker.memberSeesAllTasks`) |
|---|---|---|
| Согласованность со всем кабинетом (память/регламенты/issues) | один рубильник для всего | два разных → задачи видны, а память нет (или наоборот) |
| Новая модель данных / миграция | нет (поле есть) | да (новая настройка + сид + реестр) |
| Интеграция с RBAC | уже есть (`canRead`/контекст `:440-488`) | писать заново |
| Покрытие тестами | есть (`rbac.service.spec.ts`) | нет |
| UX владельца | одна понятная галочка «рядовые видят всё / только своё» | две галочки про «видимость», конфликтуют |
**A выбран** — решает класс «видимость рядового», а не кейс «задачи». B отвергнут как второй конфликтующий источник правды.

> **Web/Context7 не привлекались** — внутренний рефактор на готовом стеке (NestJS/Prisma/SWR/@dnd-kit уже в проекте), новых внешних API нет.

## Scope

### Входит
1. Backend: сквозной `GET /api/v1/issues` (задачи всей org, фильтры проект/исполнитель/категория/приоритет/спринт/метка/поиск, пагинация, видимость по Р3/Р4, `stateCategory` в ответе).
2. Backend: `POST /api/v1/issues/:id/transition-to-category` (DnD в «Все проекты», Р2).
3. Frontend: api `listOrg`+`transitionToCategory`, поле `stateCategory` в домене, хук `useOrgIssues`.
4. Frontend: `OrgBoard` (колонки-категории + DnD).
5. Frontend: `TasksWorkspaceClient` — landing «Задач»: виды **Доска/Список/Спринты/Входящие/Архив**, переключатель проектов, фильтры команда/спринт/поиск, быстрое создание, «Открыть проект →». Маршрут `/projects` рендерит стол.
6. Frontend: вид «Спринты» — встраивание `GET /sprints` (Р5); вид «Входящие» — встраивание `GET /intake` сквозного (Р5, руководители); вид «Архив» — `includeArchived`.
7. Видимость (Р4): применить `Org.visibilityMode` в `GET /issues`; убедиться, что тумблер виден owner/admin в `OrganizationClient` (или добавить).

### Не входит (судьба у каждого хвоста)
- **Богатый Календарь** (встречи+дедлайны+спринты+подсказки Коры) → парное ТЗ `2026-06-18-tasks-workspace-calendar.md` (draft). Вкладку «Календарь» в Ф1 не рендерим.
- **Чистка легаси `/tasks`** → строка в `second-brain/04_не-сделано/README.md` (orphaned; cleanup-ТЗ позже).
- **DRY `OrgBoard`/`Board`** (дублирование DnD-каркаса ~80 строк принято сознательно) → строка в `04_не-сделано`, отдельный рефактор-ТЗ.
- **Изменение `nav-config.ts` / мобильных табов** — не требуется (href `/projects` сохраняется).

## Граничные контракты
- `/projects/[slug]/*` и `/sprints/[id]` — **остаются как есть**. Стол ссылается на `/projects/[slug]/overview` и `/sprints/[id]`.
- В режиме одного проекта стол рендерит **существующий** `<Board orgId projectId>` без изменений; `OrgBoard` — только режим «Все проекты».
- `GET /me/inbox`, `useMyInbox`, `TasksClient` (`/tasks`), `GET /sprints`, `GET /intake` — контракты не меняем, только потребляем.

---

## Контракты (контракт-first)

### К1. `IssueResponseDto` — добавить `stateCategory` (опционально, как `childrenCount?`)
`backend/src/modules/tracker/dto/issues/issue-response.dto.ts` рядом с `childrenCount?` (`:61`):
```ts
  /** Org-wide list (2026-06-18) — категория статуса. Заполняется только GET /api/v1/issues
   * (фронт группирует кросс-проектные карточки по 5 колонкам-категориям). На прочих эндпоинтах отсутствует. */
  stateCategory?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
```

### К2. Zod-DTO query сквозного списка
Новый `backend/src/modules/tracker/dto/issues/list-org-issues-query.dto.ts`:
```ts
import { z } from 'zod';
import { IssuePrioritySchema } from './create-issue.dto';
export const ListOrgIssuesQuerySchema = z.object({
  projectId: z.string().max(64).optional(),
  assigneeUserId: z.string().max(64).optional(),
  stateCategory: z.enum(['backlog','unstarted','started','completed','cancelled']).optional(),
  priority: IssuePrioritySchema.optional(),
  cycleId: z.string().max(64).optional(),
  labelId: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  includeArchived: z.coerce.boolean().default(false),
  includeDeleted: z.coerce.boolean().default(false),
  includeChildrenCount: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type ListOrgIssuesQuery = z.infer<typeof ListOrgIssuesQuerySchema>;
```

### К3. Эндпоинт сквозного списка
Новый `backend/src/modules/tracker/controllers/org-issues.controller.ts` (образец `me-inbox.controller.ts`; регистрация в `tracker.module.ts`):
```
GET /api/v1/issues
  query: ListOrgIssuesQuery
  guard: CookieAuthGuard + TenantGuard; RBAC: rbac.canRead(user.id, t, 'issue')
  Резолвит контекст видимости: { role, visibility } из RBAC (см. rbac.service.ts:440-488 — есть membership-cache с role+visibility;
    если публичного аксессора нет — добавить тонкий getAccessContext(userId, tenantId): { role, visibility, isSuperAdmin }).
    isLeadership = role ∈ {owner,admin,coo} || isSuperAdmin (или прямо rbac.canViewOperationsDashboard).
  → svc.findAllAcrossProjects(t, user.id, query, { isLeadership, visibility })
  200 → ListIssuesResponse (items: IssueResponseDto[] c stateCategory; total; page; limit)
  400 tenant_required · 403 forbidden
```
Маршрут `GET /issues` свободен (в `IssuesController` только `issues/:id`, `issues/by-identifier/:identifier` — коллизии нет).

### К4. `IssuesService.findAllAcrossProjects` — сквозной список + видимость (Р3/Р4)
Рядом с `findMyInbox` (`:508`). Where — образец `findAll` (`:354`):
```ts
async findAllAcrossProjects(
  tenantId: string, userId: string, query: ListOrgIssuesQuery,
  ctx: { isLeadership: boolean; visibility: 'open' | 'strict' },
): Promise<ListIssuesResponse> {
  const where: Prisma.IssueWhereInput = { tenantId };
  if (!query.includeDeleted) where.deletedAt = null;
  if (!query.includeArchived) where.archivedAt = null;
  if (query.projectId) where.projectId = query.projectId;
  if (query.stateCategory) where.state = { category: query.stateCategory };
  if (query.priority) where.priority = query.priority;
  if (query.cycleId) where.cycleId = query.cycleId;
  if (query.labelId) where.labels = { some: { labelId: query.labelId } };
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: 'insensitive' } },
      { descriptionStripped: { contains: query.q, mode: 'insensitive' } },
      { identifier: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  // Р3/Р4 видимость:
  const seesAll = ctx.isLeadership || ctx.visibility === 'open';
  if (seesAll) {
    if (query.assigneeUserId) where.assignees = { some: { userId: query.assigneeUserId } };
  } else {
    // manager + strict → только свои (assignee=self ИЛИ создатель). assigneeUserId игнорируется.
    where.AND = [{ OR: [{ assignees: { some: { userId } } }, { createdById: userId }] }];
  }
  const [items, total] = await Promise.all([
    this.prisma.issue.findMany({
      where, orderBy: [{ updatedAt: 'desc' }],
      take: query.limit, skip: (query.page - 1) * query.limit,
      include: { assignees: { select: { userId: true } }, labels: { select: { labelId: true } }, state: { select: { category: true } } },
    }),
    this.prisma.issue.count({ where }),
  ]);
  // childrenCount — при includeChildrenCount скопировать блок из findAll (:402-420).
  return {
    items: items.map((i) => ({
      ...this.toResponseFromInclude(i),
      stateCategory: (i as { state?: { category: string } | null }).state?.category ?? null,
    })),
    total, page: query.page, limit: query.limit,
  };
}
```
> **[РЕАЛИЗАЦИЯ]** `q` живёт в `where.OR`, self-scope — отдельным `where.AND=[{OR:[…]}]`; Prisma объединит верхний уровень и `AND` логическим И. Перед правкой перечитать `findAll:379-385`.

### К5. Эндпоинт + DTO перехода-по-категории (Р2)
DTO `backend/src/modules/tracker/dto/issues/transition-to-category.dto.ts`:
```ts
import { z } from 'zod';
export const TransitionToCategorySchema = z.object({
  category: z.enum(['backlog','unstarted','started','completed','cancelled']),
  reason: z.string().max(500).nullish(),
}).strict();
export type TransitionToCategoryDto = z.infer<typeof TransitionToCategorySchema>;
```
Эндпоинт в `IssuesController` рядом с `transition` (`:197`):
```
POST /api/v1/issues/:id/transition-to-category
  body: TransitionToCategoryDto; RBAC: rbac.canWrite(user.id, t, 'issue'); @RequireSubscription()
  200 → IssueResponseDto · 400 invalid_category|no_state_for_category · 404 issue_not_found
```
`IssuesService.transitionToCategory(id, category, tenantId, userId, reason?)`:
1. `requireIssue` → `existing`.
2. Резолв целевого статуса (копия паттерна `moveToProject:1078-1085`): `issueState.findFirst({ where:{ projectId: existing.projectId, category }, orderBy:{ sequence:'asc' }, select:{ id:true }})` → `?? project.defaultStateId`. Нет ни того, ни другого → `400 no_state_for_category`.
3. `existing.stateId === targetStateId` → идемпотентно `assemble`.
4. Иначе — **делегировать** в существующий `transitionState(id, { stateId: targetStateId, reason }, tenantId, userId)` (переиспуем activity/WS/ingest/webhooks; НЕ дублировать).

### К6. Frontend api + domain + hook
- `src/api/tracker/issues.api.ts`: `listOrg(orgId, req)` → `GET /api/v1/issues`; `transitionToCategory(orgId, issueId, category, reason?)` → `POST /issues/:id/transition-to-category`; интерфейс `ListOrgIssuesRequest` (зеркало К2).
- `src/domain/tracker/issue.ts`: в `IssueApi` + `Issue` добавить `stateCategory: IssueStateCategory | null`; в `issueFromApi` — `stateCategory: api.stateCategory ?? null` (перечитать файл — подтвердить имя маппера/наличие `isCompleted`).
- Новый `src/hooks/tracker/useOrgIssues.ts` (SWR, ключ `['tracker.org-issues', orgId, …req]`; live-refresh `useTrackerLiveRefresh(orgId, {}, Boolean(orgId))` — org-room, как `useMyInbox.ts:110`).

### К7. `OrgBoard` — кросс-проектная доска
Новый `src/ui/tracker/OrgBoard.tsx` (**`Board.tsx` НЕ трогать**):
- Колонки = `ISSUE_STATE_CATEGORY_VALUES` (5), подписи `ISSUE_STATE_CATEGORY_LABELS`.
- Группировка: `issue.stateCategory ?? (issue.isCompleted ? 'completed' : issue.archivedAt ? 'cancelled' : 'backlog')`.
- DnD (@dnd-kit, как в `Board.tsx`): drop в колонку-категорию → `issuesApi.transitionToCategory(orgId, issueId, cat)`; оптимистично переставить, `mutate()` на успех/откат + toast на ошибке.
- Карточка = существующий `IssueCard` (identifier `KORA-123` уже показывает проект). «+ Новая задача» — на уровне стола (К8), не в колонке.

### К8. `TasksWorkspaceClient` + маршрут + виды
- Новый `frontend/app/(authenticated)/projects/TasksWorkspaceClient.tsx`; `projects/page.tsx` рендерит его вместо `ProjectsListClient`; `ProjectsListClient.tsx` удалить (роль «список проектов» поглощает селектор проекта; «+ Новый проект» → `/projects/new`).
- Состав:
  - Заголовок «Задачи» + строка-сводка (легко: `{total} задач · {overdue} просрочено`, из загруженных).
  - Виды: **Доска / Список / Спринты / Входящие / Архив** (URL-стейт `?view=`).
  - Селектор проекта: «Все проекты» + `useProjects` + «+ Новый проект» (`?project=<slug|all>`, фильтр, не переход).
  - Фильтр команды: «Вся команда» + человек (`orgMembersApi.search`) → `assigneeUserId`. Виден руководителю; рядовому скрыт (бэкенд и так фильтрует, Р3).
  - Фильтр спринта: дропдаун спринтов (`GET /sprints`, фильтр `?status=active`) → `cycleId`. Доступен и в «Все проекты» (Р5), и в одном проекте.
  - Поиск → `q` (debounce).
  - «Открыть проект →» (когда выбран проект) → `/projects/[slug]/overview`.
  - «+ Новая задача»: выбран проект → `issuesApi.create`; «Все проекты» → `ProjectPickerDialog` → создать.
  - Рендер видов:
    - **Доска:** «Все проекты» → `<OrgBoard req={фильтры}/>` (`useOrgIssues`); проект → существующий `<Board orgId projectId/>`.
    - **Список:** `IssueList` поверх `useOrgIssues` (group по `stateCategory`) / `useIssues` для проекта.
    - **Спринты:** встроить существующий org-wide список спринтов (`GET /sprints` через sprintsApi/`useSprints`; detail → `/sprints/[id]`). Фильтруется выбранным проектом (по `project` в `SprintListItemDto`).
    - **Входящие:** встроить сквозной `GET /api/v1/intake` (опц. `projectId`); только руководителям (RBAC intake_issue = owner/admin/coo) — у рядового вкладку не показывать. Переиспуем `IntakeBoard`/intake-хуки.
    - **Архив:** `OrgBoard`/`IssueList` с `includeArchived=true` (только архивные).

### К9. Видимость owner/admin (Р4)
- Применить `Org.visibilityMode` в `GET /issues` (К3/К4) — реализуется в Ф1.
- Проверить `frontend/app/(authenticated)/settings/organization/OrganizationClient.tsx`: есть ли тумблер «рядовые видят все задачи / только свои» (= `visibilityMode` open/strict), доступный owner/admin. Если есть — оставить как есть (ссылку-подсказку со стола). Если нет — добавить тумблер туда (контракт изменения org — через существующий `orgs.api.ts` patch; не создавать новую настройку).

---

## Фазы (dependency-ordered; `[ ]`)
Граф: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 → Ф7 → Ф8.** Ф1/Ф2 — backend. Ф3 зависит от контрактов Ф1+Ф2. Ф4←Ф3. Ф5←Ф4. Ф6 (виды Спринты/Входящие/Архив)←Ф5. Ф7 (видимость UI)←Ф1. Ф8 — доводка. Между волнами без остановки: зелёная верификация → commit фазы → следующая; **push — только с подтверждением владельца**.

### [x] Ф1 — Backend: `GET /api/v1/issues` + видимость
**Входит:** К1, К2, К3, К4 (+ резолв `{role,visibility}`/`isLeadership`).
**Файлы:** `dto/issues/issue-response.dto.ts`, `dto/issues/list-org-issues-query.dto.ts`(нов.), `controllers/org-issues.controller.ts`(нов.), `services/issues.service.ts`, `tracker.module.ts`, при необходимости `rbac.service.ts` (тонкий публичный `getAccessContext`).
**Не входит:** переход-по-категории, фронт.
**Acceptance:**
- `bun run typecheck && lint && build` (backend) — зелёные.
- Грепы: `findAllAcrossProjects` в `issues.service.ts` ≥1; `Get('issues')` в `org-issues.controller.ts` =1; `OrgIssuesController` в `tracker.module.ts` =1.
- Integration (`bunx vitest run` соответствующего spec — создать при отсутствии): руководитель видит задачи 2 проектов; `manager`+`strict` — только свои+созданные, чужую НЕ видит; `manager`+`open` — видит все; `stateCategory` совпадает с категорией статуса; `projectId=X` → только X; `q='абв'` → только с `абв` в title/identifier; `stateCategory='started'` → только started.
- Swagger smoke: `GET /api/v1/issues` в `/api/docs-json`.
**Закрывает:** R1, R3, R4(чтение), R7.

### [x] Ф2 — Backend: `POST /issues/:id/transition-to-category`
**Входит:** К5.
**Файлы:** `dto/issues/transition-to-category.dto.ts`(нов.), `controllers/issues.controller.ts`, `services/issues.service.ts`.
**Acceptance:** typecheck/lint/build; грепы `transition-to-category` в контроллере =1, `transitionToCategory` в сервисе ≥1, вызов `this.transitionState(` внутри метода (делегирование); unit: в `started` ставит первый по `sequence` статус категории целевого проекта; повтор той же категорией идемпотентен (без 2-й записи activity); категория без статуса и без defaultStateId → `400 no_state_for_category`; в `completed` проставляет `completedAt`.
**Закрывает:** R2(backend), R5(category).

### [x] Ф3 — Frontend: api + domain + hook
**Входит:** К6. **Файлы:** `src/api/tracker/issues.api.ts`, `src/domain/tracker/issue.ts`, `src/hooks/tracker/useOrgIssues.ts`(нов.), `src/hooks/tracker/index.ts`.
**Acceptance:** typecheck/lint/build (frontend); грепы `listOrg`/`transitionToCategory` в api ≥1; `stateCategory` в `issue.ts` ≥2; `useOrgIssues` ≥1.
**Закрывает:** R1, R2 (клиент).

### [x] Ф4 — Frontend: `OrgBoard`
**Входит:** К7. **Файлы:** `src/ui/tracker/OrgBoard.tsx`(нов.), `src/ui/tracker/index.ts`. **`Board.tsx` НЕ менять.**
**Acceptance:** typecheck/lint/build; грепы `transitionToCategory`/`ISSUE_STATE_CATEGORY_VALUES` в `OrgBoard.tsx` ≥1; `git diff --stat src/ui/tracker/Board.tsx` пуст; unit (по образцу `Board.spec.tsx`): 5 колонок; задача `stateCategory='started'` → колонка «В работе»; drop в «Готово» → `transitionToCategory(...,'completed')`.
**Закрывает:** R2, R6.

### [x] Ф5 — Frontend: `TasksWorkspaceClient` (Доска/Список/Архив) + маршрут
**Входит:** К8 (виды Доска/Список/Архив, селектор проекта, фильтры команда/спринт/поиск, создание, route swap). **Спринты/Входящие — Ф6.**
**Файлы:** `app/(authenticated)/projects/TasksWorkspaceClient.tsx`(нов.), `projects/page.tsx`, удалить `ProjectsListClient.tsx`.
**Acceptance:** typecheck/lint/build; `grep -rn "ProjectsListClient" frontend/app` =0; грепы в `TasksWorkspaceClient.tsx`: `OrgBoard`/`Board`/`ProjectPickerDialog`/`Открыть проект`/`Все проекты` ≥1 каждый; вкладка «Архив» дёргает `includeArchived`. Ручная приёмка (qa-tester): «Задачи» открывают стол сразу с доской «Все проекты»; смена проекта без перехода на `/projects/[slug]`; фильтр команды виден владельцу, скрыт рядовому; «+ Новая задача» в «Все проекты» открывает выбор проекта; перетаскивание между колонками в «Все проекты» меняет статус (после рефреша задача в новой колонке).
**Закрывает:** R1, R6.

### [x] Ф6 — Frontend: виды «Спринты» + «Входящие» (+ фильтр спринта, перенесён из Ф5)
**Входит:** встраивание `GET /sprints` (master-detail, detail → `/sprints/[id]`) и сквозного `GET /intake` (только руководителям) в стол; фильтрация выбранным проектом.
**Файлы:** `TasksWorkspaceClient.tsx` (+ вкладки), переиспуем `sprintsApi`/`useSprints`, `IntakeBoard`/intake-хуки.
**Что НЕ входит:** новые backend-ручки (всё готово), Календарь.
**Acceptance:** typecheck/lint/build; вкладка «Спринты» рендерит список из `GET /sprints`, клик → `/sprints/[id]`; «Входящие» рендерит `GET /intake`, у рядового вкладка скрыта; грепы соответствующих api-вызовов в `TasksWorkspaceClient` ≥1. Ручная приёмка: обе вкладки наполнены.
**Закрывает:** R5.

### [x] Ф7 — Видимость в админке (Р4)
**Входит:** К9 — проверить/добавить тумблер `visibilityMode` (open/strict) для owner/admin в `OrganizationClient`; со стола — подсказка «Кто что видит — в настройках организации».
**Файлы:** `settings/organization/OrganizationClient.tsx` (+ при необходимости `orgs.api.ts`).
**Acceptance:** owner видит тумблер «Рядовые видят все задачи / только свои»; переключение `strict`↔`open` меняет, что рядовой видит в «Все проекты» (e2e/ручная). Если тумблер уже был — грепом подтвердить и не дублировать.
**Закрывает:** R4(UI).

### [x] Ф8 — Доводка и заметки
**Входит:** строки в `second-brain/04_не-сделано/README.md` (orphaned `/tasks`; парный Календарь; DRY OrgBoard/Board); обновить `01_projects/frontend-pages.md` (новый landing «Задач» + виды), `02_architecture/module-map.md` (`OrgIssuesController` + эндпоинты); рефлексия.
**Acceptance:** грепом — файлы содержат новые строки; `git status` без посторонних staged-файлов.
**Закрывает:** R8.

---

## Требования (трассируемость)
- **R1.** Когда пользователь открывает «Задачи», система shall показать рабочий стол с доской «Все проекты» (без промежуточного списка проектов).
- **R2.** В «Все проекты» система shall группировать по 5 категориям и при перетаскивании переводить задачу в статус её проекта, соответствующий целевой категории.
- **R3.** Если роль ∈ {owner,admin,coo} — задачи всей команды; если `manager` — по `Org.visibilityMode`: `open` → все (read), `strict` → только assignee=self|создатель.
- **R4.** Видимость рядового управляется существующим `Org.visibilityMode`; тумблер доступен owner/admin в админке организации (не новая настройка).
- **R5.** Виды «Спринты»/«Входящие» питаются существующими `GET /sprints`/`GET /intake`; фильтр спринта работает в «Все проекты».
- **R6.** Когда выбран проект — реальные статусы-колонки (существующий `Board`) + «Открыть проект →»; `Board.tsx` и `/projects/[slug]/*` не меняются.
- **R7.** `GET /api/v1/issues` shall возвращать `stateCategory` в каждом item.
- **R8.** Каждый хвост (Календарь, легаси `/tasks`, DRY OrgBoard/Board) shall иметь судьбу (парное ТЗ / `04_не-сделано`).

## Границы фичи
- ✅ Always: переиспользовать `toResponseFromInclude`/`transitionState`/резолв категории из `moveToProject`/`Board`/`IssueCard`/`IssueList`/`ProjectPickerDialog`/`GET sprints`/`GET intake`/`Org.visibilityMode`; tenant-scope везде; парные цвет-токены; UI только русский.
- ⚠️ Ask first: менять `Board.tsx`/`nav-config.ts`/мобильные табы; трогать `/me/inbox`/`TasksClient`; заводить НОВУЮ настройку видимости (вместо `visibilityMode`); кросс-проектная агрегация спринтов сверх фильтра.
- 🚫 Never: дублировать activity/ingest при переходе-по-категории (только делегировать в `transitionState`); хардкодить статусы/категории; `GET /issues` без tenant-scope; показывать рядовому чужие задачи при `strict`; второй конфликтующий рубильник видимости.

## Риски / Pre-mortem (для `strict-production-review-gate`)
- **Утечка чужих задач рядовому при `strict`** — самый критичный аспект. Интеграционный тест: `manager`+`strict` НЕ видит чужую задачу; `manager`+`open` видит. Без него Ф1 не закрыта.
- **Композиция `where`** (q.OR + self-scope.OR) — не затереть; self-scope в `where.AND`. Тест «manager+strict+q».
- **DnD по category без статуса в проекте** → `no_state_for_category` 400; фронт показывает toast и откатывает (не молча).
- **Входящие у рядового** — RBAC `intake_issue` = owner/admin/coo; вкладку рядовому не показывать (и бэкенд вернёт 403). Проверить, что фронт не падает.
- **Производительность сквозного запроса** — есть `@@index([tenantId, …])` на Issue (проверить в `schema.prisma`); пагинация page/limit; триггер «при >5000 задач в Org — на cursor» (отложено).
- **Идемпотентность перехода-по-категории** — ранний return при совпадении stateId.
- **Орфан `ProjectsListClient`** — после удаления грепнуть отсутствие битых импортов.

## Idempotency / feature-flag / prod-deploy
- **Миграции/схема/ENV/очереди/seed:** нет (новое поле — только в DTO-ответе, не в БД; `visibilityMode` уже существует).
- **Feature-flag:** не нужен. Видимость управляется существующим `Org.visibilityMode` (per-Org «решение владельца», уже включён, дефолт `open`) — это и есть параметр владельца по Ship-On, новый флаг не заводим.
- **Prod-инструкция:** prod-операций нет — `docker compose up -d --build backend` + пересборка frontend. В `prod-deploy-log.md` обновить только Шаг 12 (Swagger-smoke: `GET /api/v1/issues`, `POST /issues/:id/transition-to-category`).

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные в backend и frontend; vitest по затронутым spec; добавлены тесты видимости (Р3/Р4) и перехода-по-категории.
- second-brain обновлён (frontend-pages, module-map, 04_не-сделано).
- Ручная приёмка Ф5/Ф6/Ф7 (qa-tester) пройдена.
- Рефлексия в `second-brain/05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф8).** Ветка `feature/tasks-unified-workspace` (от актуального `dev` `314dbf4c`), 7 пофазных коммитов + доводка:

| Фаза | Коммит | Суть |
|---|---|---|
| Ф1 | `71a4aeb4` | `GET /api/v1/issues` (`OrgIssuesController` + `findAllAcrossProjects`), видимость Р3/Р4 через `RbacService.loadContext`, `stateCategory` в DTO; 8 тестов видимости |
| Ф2 | `eba9aad3` | `POST /issues/:id/transition-to-category` (резолв по категории → делегирует в `transitionState`); 5 unit-тестов |
| Ф3 | `6040e2b4` | api `listOrg`/`transitionToCategory`, домен `stateCategory`, хук `useOrgIssues` (ключ `tracker.issues`/`org` → live-refresh) |
| Ф4 | `f38e8969` | `OrgBoard` (5 колонок-категорий, DnD→transitionToCategory, оптимистика); `Board.tsx` не тронут (R6); 8 тестов |
| Ф5 | `cea9ae08` | `TasksWorkspaceClient` (Доска/Список/Архив, селектор проекта, фильтр команды, поиск, создание, «Открыть проект»), `/projects`→стол, `ProjectsListClient` удалён |
| Ф6 | `4f3c1830` | виды «Спринты» (`useSprints`) + «Входящие» (`IntakeBoard`, руководителю) + фильтр спринта (`?cycle`) |
| Ф7 | `cee31300` | подсказка-ссылка «Кто видит задачи» → настройки организации (тумблер `visibilityMode` уже существовал — переиспользован, Р4) |

**Верификация (прогнана оркестратором против `dev`):** backend typecheck/lint/build = 0; tracker-тесты **248 passed**. frontend typecheck/lint = 0; `next build` = 0 (×2: после Ф5 и Ф6); OrgBoard-тесты **8 passed**.

**Отклонения от буквы ТЗ (осознанные):**
1. **Фильтр спринта перенесён из Ф5 в Ф6** — источник org-wide списка спринтов на фронте (`useSprints`/`@/api/sprints.api`) логично подключать вместе с видом «Спринты», не дважды.
2. **Ключ SWR `useOrgIssues` = `['tracker.issues','org',…]`**, а не `['tracker.org-issues',…]` (как в К6): доказано, что `useTrackerLiveRefresh` мутирует по **точному** `key[0]==='tracker.issues'` — иначе доска не обновлялась бы на live-события.
3. **Тумблер видимости (Ф7) правится только владельцем (`isOwner`), не admin** — это существующее поведение `OrganizationClient` на `dev`; ТЗ предписывал «если есть — оставить как есть». Расширение на admin = изменение чужого экрана вне scope (при необходимости — отдельной задачей).

**Важно (контекст):** ветка изначально была отпочкована от устаревшего `d2403217` (`dev~5`); по требованию владельца **перенесена rebase'ом на актуальный `dev`** (merge `#47` переформатировал трекер), конфликты (косметические — комментарии/кавычки) разрешены, всё перепроверено. Дублей фичи в `dev` нет.

**Хвосты** (в `04_не-сделано`): богатый Календарь (парное ТЗ), легаси `/tasks` (orphaned, cleanup позже), DRY `OrgBoard`/`Board` (рефактор позже). Прод: миграций/ENV/seed нет — `docker compose up -d --build` + пересборка frontend; `prod-deploy-log` Шаг 12 — Swagger-smoke новых эндпоинтов.

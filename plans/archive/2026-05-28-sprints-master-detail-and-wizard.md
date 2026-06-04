---
type: tz
status: draft
created: 2026-05-28
author: Claude (после обсуждения с владельцем)
parent: plans/tz/2026-05-27-sprints.md
related:
  - second-brain/01_projects/sprints.md
  - second-brain/01_projects/api-layer.md
  - second-brain/01_projects/frontend-pages.md
  - frontend/app/(authenticated)/sprints/SprintsListClient.tsx
  - frontend/src/ui/tracker/SprintCreateWizard.tsx
  - backend/src/modules/tracker/controllers/cycles.controller.ts
  - backend/src/modules/vendors/vendors.controller.ts
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 97%.**
> Все 3 фазы реализованы и подтверждены кодом: backend (SprintsController/Service, VendorsService CRUD, translit-утилиты, RBAC, unit+integration тесты, расширенный smoke), frontend (master-detail SprintsListClient без загл
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Спринты — master-detail список и расширенный мастер создания

## 0. Контекст

Родительское ТЗ [plans/tz/2026-05-27-sprints.md](2026-05-27-sprints.md) реализовано
почти полностью. Остались два недоделанных пункта:

1. **Страница `/sprints`** — сейчас заглушка с текстом «Список спринтов в
   разработке». Нужен полноценный master-detail (список слева, preview
   справа) с фильтрами и поиском.
2. **`SprintCreateWizard`** — поддерживает только Вариант А (выбрать
   существующий проект). Вариант Б (создать новый проект-спринт со scope
   = клиент / поставщик / отдел / сотрудник) не реализован.

Это ТЗ закрывает оба пункта **без компромиссов по качеству** —
атомарные операции на backend, UI-паритет всех 4 scope-вариантов,
покрытие тестами, документация second-brain.

## 1. Продуктовые решения (по итогам обсуждения 2026-05-28)

| # | Решение |
|---|---|
| 1 | Inline-create поставщика в мастере — добавляем полноценный `POST /api/v1/vendors` (паритет с другими scope) |
| 2 | Slug+identifier для нового Project — генерируется на backend в одной transaction через `POST /api/v1/sprints/quick-create` |
| 3 | Endpoint списка — `GET /api/v1/sprints` (новый `SprintsController`) |
| 4 | Существующий `SprintCreateWizard` расширяем (шаг 0 = выбор привязки), новый компонент не плодим |
| 5 | Person scope — двухступенчатый combobox: Role → Person через Appointment |
| 6 | Фильтры: tabs status + chip-фильтр scope-kind + поиск + сортировки (start/progress/hints); параметры в URL |
| 7 | Preview: scope-badge, даты, progress-bar, счётчики, топ-3 SprintHint, топ-3 задач без срока |
| 8 | Mobile: список на весь экран, detail открывается как `Sheet` |
| 9 | Live-обновления через `/ws/tracker` + SWR-fallback |
| 10 | Серверная пагинация (page+limit, default 20, max 100) |
| 11 | Удалённая scope-сущность отображается с маркером «(удалён)», спринт остаётся виден |
| 12 | Полное покрытие unit + integration + smoke + frontend-unit |

## 2. Фазы реализации

### Фаза 1 — Backend (новые endpoint'ы, сервисы, тесты)

#### 1.1 `VendorsService.create` + REST endpoints (паритет с Card/Person/Department)

- [ ] Расширить `backend/src/modules/vendors/dto/vendors.dto.ts`:
  - `CreateVendorSchema` (`zod`): `{ name: string min(1) max(300), inn?: string max(20), segment?: VendorSegment, status?: VendorStatus default 'active', responsibleUserId?: string }`
  - `UpdateVendorSchema`: partial без `tenantId`
  - Все поля строгие; `name.trim().length >= 1`
- [ ] Расширить `backend/src/modules/vendors/services/vendors.service.ts`:
  - `create({tenantId, dto, actorUserId}): Promise<VendorDto>` — создаёт `Entity{type='vendor'}` + `Vendor` в одной transaction (см. `PersonsService.create` как образец)
  - `update({tenantId, id, dto, actorUserId}): Promise<VendorDto>` — частичное обновление с soft-undeleted gate
  - `softDelete({tenantId, id, actorUserId}): Promise<{ok:true}>` — `deletedAt = now`
- [ ] Расширить `backend/src/modules/vendors/vendors.controller.ts`:
  - `POST /api/v1/vendors` — `CreateVendorDto`, RBAC `vendor:write`, Swagger
  - `PATCH /api/v1/vendors/:id` — `UpdateVendorDto`, RBAC `vendor:write`
  - `DELETE /api/v1/vendors/:id` — soft-delete, RBAC `vendor:delete`
- [ ] Обновить `backend/src/modules/rbac/policies/policy.csv`:
  - owner/admin: `vendor:read/write/delete`
  - manager: `vendor:read/write` (без delete)
  - member: `vendor:read`
  - Если уже добавлены write/delete — проверить, ничего не дублировать
- [ ] Unit-тесты: `backend/src/modules/vendors/services/vendors.service.spec.ts`
  - `create`: успех + создание Entity + tenantId isolation
  - `create`: коллизия имени (дубликат не запрещаем, документируем поведение)
  - `update`: только разрешённые поля
  - `softDelete`: deletedAt установлен, повторный вызов идемпотентен

#### 1.2 `SprintsService` — новый сервис

Файл: `backend/src/modules/tracker/services/sprints.service.ts`

- [ ] `SprintsService.list({tenantId, query}): Promise<ListSprintsResponse>`
  - Query DTO `ListSprintsQuerySchema`:
    ```ts
    {
      status?: 'active' | 'completed' | 'upcoming' | 'all',  // default 'all'
      scopeKind?: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project',
      q?: string,                                            // поиск по name
      sortBy?: 'startDate' | 'progress' | 'hints',           // default 'startDate'
      sortDir?: 'asc' | 'desc',                              // default 'desc'
      page?: number,                                         // default 1
      limit?: number,                                        // default 20, max 100
    }
    ```
  - **status semantic:**
    - `active`: `completedAt = null AND startDate <= now AND endDate >= now`
    - `completed`: `completedAt != null`
    - `upcoming`: `completedAt = null AND startDate > now`
    - `all`: без фильтра по datам
  - **scopeKind filter:**
    - `org`: все 4 поля Project = null
    - `customer/vendor/person/department`: соответствующее поле != null
    - `project`: все 4 поля = null И спринт явно «не org» — это V2, пока == org
  - **q filter:** `Cycle.name ILIKE %q% OR Project.name ILIKE %q% OR Project.identifier ILIKE %q%`
  - **JOIN'ы:** `Cycle → Project (include customerCard, vendor, subjectPerson{include appointments where status='active' order desc, include role}, department)`
  - **Counters:**
    - `progress.total/completed` — count `Issue WHERE cycleId AND deletedAt=null`
    - `activeHintsCount` — count `SprintHint WHERE cycleId AND status='active'`
    - `criticalHintsCount` — count `SprintHint WHERE cycleId AND status='active' AND severity='critical'`
    - `linkedMeetingsCount` — count `Meeting WHERE linkedCycleId`
  - **Mapping `scope`:**
    - kind = `detectProjectScopeKind` (уже есть в `cycles.service.ts` — экспортируй в utility)
    - label = русский лейбл («Компания», «Клиент: Альфа», «Клиент: Альфа (удалён)», «Сотрудник: Маша — Маркетолог»)
    - refId = `customerCardId | vendorId | subjectPersonId | departmentId | null`
    - isDeleted = `customerCard.deletedAt != null` (или соотв. для других)
  - **Sort:**
    - `startDate`: `ORDER BY Cycle.startDate <dir>`
    - `progress`: вычисляется post-query (после count'ов), сортируется в JS — допустимо для page<=100
    - `hints`: `ORDER BY criticalHintsCount DESC, activeHintsCount DESC` (всегда desc игнорируя dir)
  - **Performance:** counters получаем 1 batch-запросом через `groupBy` где возможно, иначе один запрос на список + один на counters. N+1 запрещён.
- [ ] DTO ответа `backend/src/modules/tracker/dto/sprints/sprint-list-item.dto.ts`:
  ```ts
  export interface SprintListItemDto {
    id: string;
    projectId: string;
    name: string;
    project: { id: string; name: string; identifier: string };
    scope: {
      kind: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
      label: string;          // русский, для UI
      refId: string | null;
      isDeleted: boolean;
    };
    startDate: string;        // ISO
    endDate: string;          // ISO
    status: 'active' | 'completed' | 'upcoming';
    progress: {
      total: number;
      completed: number;
      ratio: number;          // 0..1
    };
    activeHintsCount: number;
    criticalHintsCount: number;
    linkedMeetingsCount: number;
    createdAt: string;        // ISO
    updatedAt: string;        // ISO
    completedAt: string | null;
  }
  export interface ListSprintsResponse {
    items: SprintListItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }
  ```
- [ ] Unit-тесты: `backend/src/modules/tracker/services/sprints.service.spec.ts`
  - Фильтр по status (active/completed/upcoming/all) — каждый случай
  - Фильтр по scopeKind — каждый из 5 вариантов
  - Поиск по q — name/projectName/identifier
  - Сортировка по hints — critical-первые
  - Маркер isDeleted для удалённой Card/Person/Department
  - Пагинация — page=2 limit=10
  - tenantId isolation — другой tenant не виден

#### 1.3 `SprintsService.quickCreate` — атомарное создание Project+Cycle

- [ ] `quickCreate({tenantId, dto, userId}): Promise<QuickCreateResponse>`
- [ ] DTO `backend/src/modules/tracker/dto/sprints/quick-create-sprint.dto.ts`:
  ```ts
  export const QuickCreateSprintSchema = z.object({
    scope: z.enum(['org', 'customer', 'vendor', 'person', 'department', 'project']),
    refId: z.string().max(64).nullable().optional(),  // null для 'org'
    existingProjectId: z.string().max(64).nullable().optional(),  // если scope='project'
    sprintName: z.string().min(1).max(120),
    durationDays: z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(28)]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),  // YYYY-MM-DD
    timezone: z.string().max(64).default('Europe/Moscow'),
  }).strict().superRefine((v, ctx) => {
    if (v.scope === 'project' && !v.existingProjectId) {
      ctx.addIssue({code:'custom', message:'existingProjectId обязателен при scope=project', path:['existingProjectId']});
    }
    if (['customer','vendor','person','department'].includes(v.scope) && !v.refId) {
      ctx.addIssue({code:'custom', message:'refId обязателен для этого scope', path:['refId']});
    }
  });
  ```
- [ ] Логика:
  1. Валидация refId — существование сущности (Card/Vendor/Person/Department) в tenantId
  2. Если `scope === 'project'` — переиспользуем существующий Project, создаём только Cycle (через `CyclesService.create`)
  3. Иначе — `prisma.$transaction`:
     - Сгенерировать `projectName` (на основе scope: «Клиент: Альфа», «Отдел: Маркетинг» — для UI; для slug/identifier — отдельный source)
     - Сгенерировать `slug` через утилиту `generateProjectSlug(scopeKind, refLabel, tenantId, tx)` — транслитерация + проверка уникальности с auto-suffix `-2`, `-3` (до 5 попыток)
     - Сгенерировать `identifier` через утилиту `generateProjectIdentifier(scopeKind, refLabel, tenantId, tx)` — 3-5 заглавных латинских букв из транслитерированного имени + проверка уникальности с числовым суффиксом
     - Создать `Project` с соответствующим scope-полем
     - Создать `Cycle` через `tx.cycle.create`
     - Записать `IssueActivity` (?) — здесь нет issue, поэтому пропускаем
     - Создать `Board` default = true для нового Project (через `BoardsService.ensureDefaultBoard` или inline)
     - Создать `IssueState` default-набор (Backlog/Unstarted/Started/Completed/Cancelled) — переиспользуем существующую логику из `ProjectsService.create` если есть
  4. Вызвать `metrics.incCycleCreated({tenant, scopeKind})`
  5. Эмитить `cycle.created` + best-effort webhook
- [ ] Response DTO `QuickCreateSprintResponse`:
  ```ts
  {
    cycleId: string;
    projectId: string;
    projectIdentifier: string;
    projectSlug: string;
  }
  ```
- [ ] Транслитерация — отдельная утилита `backend/src/modules/tracker/utils/translit.ts`:
  - `transliterate(input: string): string` — кириллица → латиница (используй существующий `slugify` из `orgs.service.ts` за основу, вынеси в общий util)
  - `generateProjectSlug(name: string, tenantId: string, tx): Promise<string>` — `transliterate + slugify → проверка collision → суффикс`
  - `generateProjectIdentifier(name: string, tenantId: string, tx): Promise<string>` — первые 3-5 заглавных букв после транслита, fallback `PRJ`, collision → числовой суффикс `PRJ1`, `PRJ2`
- [ ] Unit-тесты `sprints.service.spec.ts` (продолжение):
  - quickCreate scope='customer' успех + создание Project + Cycle + Board + States
  - quickCreate scope='vendor' успех
  - quickCreate scope='person' успех
  - quickCreate scope='department' успех
  - quickCreate scope='org' (без refId) успех — Project без scope-полей
  - quickCreate scope='project' с existingProjectId — Project не создаётся, только Cycle
  - quickCreate refId не существует → 404
  - quickCreate refId из другого tenant → 404
  - quickCreate slug-collision → auto-suffix
  - quickCreate identifier-collision → auto-suffix
  - quickCreate transaction rollback — если падает создание Cycle, Project не создаётся
  - Валидация: scope='customer' без refId → 400
  - Валидация: scope='project' без existingProjectId → 400

#### 1.4 `SprintsController` — REST endpoints

- [ ] Файл: `backend/src/modules/tracker/controllers/sprints.controller.ts`
- [ ] Endpoints (под `CookieAuthGuard + TenantGuard`):
  - `GET /api/v1/sprints` — `ListSprintsQuery` → `ListSprintsResponse`. RBAC `cycle:read`
  - `POST /api/v1/sprints/quick-create` — `QuickCreateSprintDto` → `QuickCreateSprintResponse`. RBAC `cycle:write`. Idempotency-Key header (если уже есть pattern — переиспользуй)
- [ ] Swagger: `@ApiTags('tracker / sprints')`, `@ApiOperation`, `@ApiBearerAuth`
- [ ] Регистрация в `tracker.module.ts`: `SprintsController` в controllers[], `SprintsService` в providers[]

#### 1.5 Integration-тесты

- [ ] Файл: `backend/test/integration/sprints-master-detail.spec.ts`
- [ ] Сценарии:
  1. Setup: создать 2 tenant'а, в первом — 3 проекта (по customer, по department, без scope)
  2. Создать в каждом проекте по 2 Cycle (один active, один completed)
  3. Создать в одном спринте 3 Issue (1 без срока, 1 без assignee, 1 done)
  4. Создать SprintHint (1 critical, 2 warning)
  5. Создать Meeting с linkedCycleId
  6. Дёрнуть `GET /api/v1/sprints?status=active` → 3 спринта (по 1 active на проект)
  7. Дёрнуть `GET /api/v1/sprints?scopeKind=customer` → 1 спринт
  8. Дёрнуть `GET /api/v1/sprints?q=маркетинг` → отфильтровано
  9. Дёрнуть `GET /api/v1/sprints?sortBy=hints` → спринт с critical-hint первый
  10. Дёрнуть `POST /api/v1/sprints/quick-create {scope:'customer', refId, sprintName:'Тест Альфа', durationDays:14, startDate}` → проект+цикл созданы, identifier уникален
  11. Дёрнуть второй quick-create с тем же именем клиента → identifier другой
  12. Удалить Card → `GET /api/v1/sprints` → `scope.isDeleted=true`, спринт всё ещё виден
  13. tenant isolation: `X-Org-Id` второго tenant → пустой список

#### 1.6 Live-обновления (WebSocket)

- [ ] Проверить существующий `TrackerEventsService` — есть ли уже emitter для `sprint_hint.*` и `cycle.*`
- [ ] Если нет — добавить:
  - `publishSprintHintCreated(hint, tenantId)` → emit `sprint_hint.created` в `/ws/tracker` room `tenant:<tenantId>`
  - `publishSprintHintUpdated(hint, tenantId)` → `sprint_hint.updated`
  - `publishCycleUpdated` — должен быть, проверить
- [ ] В `SprintHintsService.dismiss/resolve` — вызвать emit
- [ ] В `CyclesService.update/complete` — должен уже эмитить, проверить

#### 1.7 Smoke-script

- [ ] Расширить `backend/scripts/smoke-sprints.ts`:
  - Шаг N+1: дёрнуть `GET /api/v1/sprints` с разными фильтрами, проверить status code
  - Шаг N+2: дёрнуть `POST /api/v1/sprints/quick-create scope='customer'` → success
  - Шаг N+3: дёрнуть `POST /api/v1/vendors` → success → quick-create scope='vendor'
- [ ] Проверить регистрацию в `apply-prod-deploy.ts` — smoke не меняет данные, регистрация не нужна

**DoD Фазы 1:**
- `bun run typecheck` зелёный
- `bun run lint` зелёный
- `bun run test:unit` зелёный
- `bun run test:integration` зелёный
- Swagger показывает 4 новых endpoint'а (`POST /vendors`, `PATCH /vendors/:id`, `DELETE /vendors/:id`, `GET /sprints`, `POST /sprints/quick-create`)
- `smoke-sprints.ts` отрабатывает локально

---

### Фаза 2 — Frontend (API-слой, master-detail, расширенный мастер)

#### 2.1 API-слой

- [ ] Создать `frontend/src/api/sprints.api.ts`:
  ```ts
  export interface ListSprintsRequest {
    status?: 'active' | 'completed' | 'upcoming' | 'all';
    scopeKind?: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
    q?: string;
    sortBy?: 'startDate' | 'progress' | 'hints';
    sortDir?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }
  export interface QuickCreateSprintRequest {
    scope: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
    refId?: string | null;
    existingProjectId?: string | null;
    sprintName: string;
    durationDays: 7 | 14 | 21 | 28;
    startDate: string;
    timezone?: string;
  }
  export const sprintsApi = {
    list: (orgId, req) => apiClient.get<ListSprintsResponseApi>(`/api/v1/sprints${buildQuery(req)}`, { headers: orgHeaders(orgId) }),
    quickCreate: (orgId, body) => apiClient.post<QuickCreateSprintResponseApi>(`/api/v1/sprints/quick-create`, body, { headers: orgHeaders(orgId) }),
  };
  ```
- [ ] Расширить `frontend/src/api/vendors.api.ts`:
  - `create(orgId, body: CreateVendorRequest): Promise<VendorApi>`
  - `update(orgId, id, body: UpdateVendorRequest): Promise<VendorApi>`
  - `remove(orgId, id): Promise<void>`

#### 2.2 Domain mapper

- [ ] Создать `frontend/src/domain/sprint.ts`:
  ```ts
  export interface DomainSprintListItem {
    id: string;
    projectId: string;
    projectName: string;
    projectIdentifier: string;
    name: string;
    scope: DomainSprintScope;
    startDate: Date;
    endDate: Date;
    status: 'active' | 'completed' | 'upcoming';
    progress: { total: number; completed: number; ratio: number };
    activeHintsCount: number;
    criticalHintsCount: number;
    linkedMeetingsCount: number;
    completedAt: Date | null;
  }
  export interface DomainSprintScope {
    kind: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
    label: string;       // уже русский с backend
    refId: string | null;
    isDeleted: boolean;
  }
  // Хелперы:
  export function getScopeKindLabel(kind): string  // 'Компания' / 'Клиент' / ...
  export function getStatusLabel(status): string   // 'Активный' / 'Завершён' / 'Предстоящий'
  export function getSortByLabel(sortBy): string   // 'По дате старта' / 'По прогрессу' / 'По подсказкам'
  export function mapApiSprint(api: SprintListItemApi): DomainSprintListItem
  ```
- [ ] Unit-тесты: `frontend/src/domain/sprint.spec.ts`
  - Маппер: ISO-строки → Date, scope.label вынесен как есть
  - getScopeKindLabel для каждого варианта
  - Проверка маппинга isDeleted

#### 2.3 Master-detail UI

- [ ] Переписать `frontend/app/(authenticated)/sprints/SprintsListClient.tsx`:
  - Layout desktop (`md+`): `grid grid-cols-[420px,1fr]` — слева список, справа preview
  - Layout mobile (`<md`): список занимает 100%, при выборе спринта открывается `Sheet` (`@/ui/shadcn/sheet`) с preview
  - URL-параметры синхронизируются: `?status=active&scope=customer&q=...&sort=hints&sortDir=desc&page=1&selected=<cycleId>`
  - Используем SWR для fetch с `keepPreviousData: true`
- [ ] Шапка списка:
  - Кнопка «+ Создать спринт» (открывает `SprintCreateWizard`)
  - Tabs «Активные / Завершённые / Предстоящие / Все»
  - Поиск по name (debounced 300ms)
  - Chip-фильтр scope-kind (multi-select chips: Компания / Отдел / Клиент / Поставщик / Сотрудник / Проект)
  - Select «Сортировка» (По дате старта / По прогрессу / По подсказкам)
- [ ] Список:
  - Карточка спринта: name (truncate), project.identifier, scope-badge (цвет по kind + русский label), progress-bar, счётчики (задач/подсказок/встреч), статус
  - Badge «(удалён)» рядом с scope если `scope.isDeleted`
  - При активном спринте — индикатор `pulse` рядом с датой
  - Выбранная карточка подсвечивается (`bg-bg-elevated`)
  - Пустое состояние: empty-state с CTA
- [ ] Пагинация (footer списка):
  - Page navigation: «← Назад / Стр. X из Y / Вперёд →»
  - Total: «N спринтов»
- [ ] Preview-карточка `frontend/src/ui/tracker/SprintPreviewCard.tsx`:
  - Header: name + кнопка «Открыть спринт →» (router.push `/sprints/[id]`)
  - scope-badge с tooltip («Проект KORA · Клиент: Альфа»)
  - Прогресс-бар + цифры
  - Даты + статус
  - Счётчики
  - Топ-3 SprintHint (через `GET /cycles/:id/hints` SWR) — `SprintHintCard` (компактный variant)
  - Топ-3 задач без срока (из `GET /cycles/:id/dashboard.tasksWithoutDueDate`)
  - Кнопка «Закрыть» (mobile, в sheet)
- [ ] WebSocket-listener в `SprintsListClient`:
  - Подписка через существующий `useTrackerSocket` (или аналог) на события `cycle.*`, `sprint_hint.*`
  - На событие → `mutate('/api/v1/sprints', ...)` (SWR invalidate)
- [ ] Удалить `Placeholder` функцию

#### 2.4 Расширенный `SprintCreateWizard`

- [ ] Переписать `frontend/src/ui/tracker/SprintCreateWizard.tsx`:
  - Стейт-машина шагов: `'scope' | 'parameters' | 'submitting'`
  - **Шаг 'scope':**
    - Radio group (6 вариантов): «Компания / Отдел / Клиент / Поставщик / Сотрудник / Проект»
    - Под radio — combobox соответствующего scope:
      - `org` — combobox скрыт
      - `department` — `DepartmentCombobox` (use `useDepartments`, inline-create через `POST /departments`)
      - `customer` — `CardCombobox` (use `useCards`, inline-create через `POST /cards`)
      - `vendor` — `VendorCombobox` (use `useVendors`, inline-create через `POST /vendors`)
      - `person` — двухступенчатый `RolePersonPicker`:
        - Шаг 1: `RoleCombobox` (use `useRoles`)
        - Шаг 2: `PersonCombobox` (use `usePersons({roleId})`) с inline-create через `POST /persons/quick-create`
      - `project` — `ProjectCombobox` (use `useProjects`)
    - Валидация: для всех кроме `org` — нужен выбранный refId (или existingProjectId)
    - Кнопка «Далее» disabled пока валидация не пройдена
  - **Шаг 'parameters':** (текущая логика)
    - Название спринта
    - Длительность (7/14/21/28)
    - Дата начала
    - Кнопка «Назад» (возврат к 'scope') и «Создать спринт»
  - **Submit:**
    - Если `scope === 'project'` (выбрали existing project) — `sprintsApi.quickCreate({scope:'project', existingProjectId, sprintName, durationDays, startDate})`
    - Иначе — `sprintsApi.quickCreate({scope, refId, sprintName, durationDays, startDate})`
    - Backend сам создаёт Project (если нужно) + Cycle атомарно
    - На успех — `router.push('/sprints/' + cycleId)`, закрыть wizard
- [ ] Inline-create UX:
  - В combobox'е поверх списка отображается кнопка «+ Создать “<query>”»
  - При клике открывается мини-форма с минимальным набором полей (name + опц. контактные)
  - На submit — вызов соответствующего `POST` API, новый объект попадает в список и автоматически выбирается
  - Ошибки показываются inline под формой
- [ ] Хук `useVendors(orgId, q?)`:
  - Если такого хука ещё нет — создать аналогично `useProjects`
  - SWR-кэширование, дебаунс поиска
- [ ] Аналогично `useRoles`, `usePersons({roleId})`, `useCards`, `useDepartments` — проверить наличие, создать если нет
- [ ] Доступность (a11y):
  - Radio группа — `role="radiogroup"`, `aria-label="Привязка спринта"`
  - Comboboxes — `role="combobox"`, `aria-expanded`, keyboard navigation
  - Кнопки «+ Создать» — `aria-label` явный
- [ ] Все строки русские (по `feedback_admin_ui_russian_only`)
- [ ] Парные цветовые токены (по `feedback_paired_color_tokens`)

#### 2.5 Frontend unit-тесты

- [ ] `frontend/src/domain/sprint.spec.ts` — маппер + хелперы
- [ ] `frontend/src/ui/tracker/SprintCreateWizard.spec.tsx` (если testing infra поддерживает):
  - Render: первый шаг = выбор scope
  - Переход 'scope' → 'parameters' только после валидного выбора
  - Submit вызывает sprintsApi.quickCreate с правильными аргументами для каждого scope

**DoD Фазы 2:**
- `bun run typecheck` зелёный (frontend)
- `bun run lint` зелёный (frontend)
- `bun run test:unit` зелёный
- Ручной smoke (через `verify` skill):
  1. `/sprints` — master-detail виден; tabs/filters/search/sort работают; URL обновляется
  2. Выбор спринта — preview отображается; mobile sheet работает
  3. Live: открыть две вкладки, в одной создать спринт → во второй появляется без refresh
  4. Wizard scope='customer' → выбрать существующий → создать → редирект на /sprints/:id
  5. Wizard scope='customer' → inline-create нового → выбрать → создать
  6. Wizard scope='vendor' → inline-create → создать
  7. Wizard scope='person' → выбрать Role → выбрать Person → создать
  8. Wizard scope='department' → inline-create → создать
  9. Wizard scope='project' → выбрать existing → создать
  10. Удалить Card → /sprints → спринт виден с маркером «(удалён)»
- Все тексты русские
- Парные цветовые токены

---

### Фаза 3 — Документация и prod-deploy

#### 3.1 second-brain

- [ ] Обновить `second-brain/01_projects/sprints.md`:
  - Добавить секцию «Master-detail список»
  - Добавить секцию «Расширенный мастер: 6 scope-вариантов»
  - Описать UX-flow создания
- [ ] Обновить `second-brain/01_projects/api-layer.md`:
  - Новые endpoints: `GET /api/v1/sprints`, `POST /api/v1/sprints/quick-create`, `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id`, `DELETE /api/v1/vendors/:id`
- [ ] Обновить `second-brain/01_projects/frontend-pages.md`:
  - `/sprints` — теперь master-detail
- [ ] Обновить `second-brain/01_projects/tracker.md`:
  - Раздел «Спринты» — упомянуть мастер и quick-create

#### 3.2 docs/operations/prod-deploy-log.md

- [ ] В разделе «🚨 Накоплено к выкату»:
  - **Шаг 4 (Prisma):** нет изменений — vendors уже в схеме
  - **Шаг 12 (smoke):** `docker compose exec backend bun run scripts/smoke-sprints.ts` (уже есть, обновляем заметку)
  - Никаких новых миграций, seed, patch — только новый код

#### 3.3 Рефлексия

- [ ] После push — заметка `second-brain/05_история/2026-MM-DD-sprints-master-detail.md`

**DoD Фазы 3:**
- Все ссылки кликабельны
- prod-deploy-log актуален

---

## 3. Архитектурные ограничения

1. **Никаких миграций схемы БД** — все нужные поля уже в `schema.prisma` (Project scope-fields, Vendor model, SprintHint).
2. **Никаких новых очередей BullMQ** — переиспользуем существующие `cycle.*` events и `sprint_hint.*`.
3. **Никаких новых seed-скриптов** — RBAC-permissions для vendor добавляем правкой `policy.csv` (уже apply через существующий механизм).
4. **Атомарность через `prisma.$transaction`** — quick-create обязан быть атомарным; project-сирота недопустим.
5. **Russian-first UI** — все user-facing строки только на русском.
6. **Парные цветовые токены** — никаких hardcoded hex, только `bg-{color} + text-{color}-fg`.

## 4. Тестирование

| Уровень | Что |
|---|---|
| Unit backend | `VendorsService.{create,update,softDelete}`, `SprintsService.{list,quickCreate}`, утилиты translit/slug/identifier |
| Integration backend | E2E: setup tenant → fixtures → list-filter-sort-paginate → quick-create-with-collision → soft-delete-source → tenant-isolation |
| Smoke backend | `smoke-sprints.ts` расширен |
| Unit frontend | Domain mapper sprint.ts |
| Manual frontend | 10 сценариев из DoD Фазы 2 через `verify` skill |

## 5. Связь с другими модулями

| Модуль | Изменение |
|---|---|
| `tracker` | новый SprintsController/Service, расширение translit util |
| `vendors` | POST/PATCH/DELETE endpoints + service.create/update/delete |
| `rbac` | actions `vendor:write`, `vendor:delete` (проверить, возможно уже есть) |
| `cards/persons/departments` | не меняются — переиспользуем существующие POST endpoints |

## 6. Definition of Done (всё ТЗ)

- [ ] Все 3 фазы закрыты
- [ ] `bun run typecheck` + `bun run lint` зелёные (backend + frontend)
- [ ] `bun run test:unit` + `bun run test:integration` зелёные
- [ ] Smoke `smoke-sprints.ts` отрабатывает локально
- [ ] Все 10 ручных сценариев из DoD Фазы 2 пройдены
- [ ] Документация second-brain обновлена
- [ ] prod-deploy-log актуален (даже если изменений минимально)
- [ ] Рефлексия записана
- [ ] Коммит в ветку `sergdev` (по правилам `feedback_branch_sergdev`)
- [ ] Push только после явного подтверждения владельца

## 7. Открытые риски

| Риск | Митигация |
|---|---|
| Slug/identifier collision retry упирается в лимит 5 попыток | Лог + ошибка `slug_collision` с понятным сообщением для UI |
| Маппер scope.label для удалённой сущности падает | unit-тест на каждый scope-kind + isDeleted=true |
| Сортировка по progress в JS медленна на больших страницах | limit page<=100 защищает; индексы на `Cycle.startDate` уже есть |
| WebSocket race: создаём спринт, событие приходит до возврата POST | SWR mutate после POST + invalidate по событию — оба пути сходятся к актуальному state |
| Inline-create person без appointment | UX: показываем подсказку «Сотрудник создан, привяжите должность через раздел /persons/[id]» |

---

_Создан: 2026-05-28. На основе обсуждения 2026-05-28 с владельцем (7 вопросов решены)._

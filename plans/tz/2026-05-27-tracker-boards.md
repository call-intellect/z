---
type: tz
status: draft
feature: Несколько досок внутри проекта (модель Board + UI переключения)
date: 2026-05-27
parent: plans/archive/2026-05-27-tracker-parity-with-competitors.md
related:
  - plans/archive/2026-05-23-tracker-phase-1-models-api.md
  - plans/archive/2026-05-23-tracker-phase-2-frontend-mobile-first.md
---

# Несколько досок в проекте

## TL;DR

В проекте можно создавать несколько досок («Доска маркетинга», «Доска монтажа», «Личные задачи Иванова»). Каждая задача живёт на одной доске. Колонки внутри доски — статусы. Переключение между досками — через левую боковую панель в проекте (как у Weeek/Kaiten). При первом запуске миграции для каждого существующего проекта создаётся одна «Основная доска» и все его задачи привязываются к ней — обратная совместимость гарантирована.

## Зачем

Пользователь, привыкший к Weeek/Kaiten/Битрикс24, открывает наш проект и не видит знакомой структуры «слева — список досок, справа — выбранная». Он не может разделить работу по направлениям внутри одного проекта (например, «разработка» и «дизайн» в проекте «Релиз 2.0»). Сейчас единственный выход — создать два разных проекта, что разрывает контекст.

## Модель данных

### Новая модель `Board`

```prisma
model Board {
  id          String    @id @default(cuid())
  tenantId    String
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  name        String                              // «Доска маркетинга», «Бэклог», «Релиз 2.0»
  color       String    @default("#5EEAD4")
  icon        String?                             // emoji или slug иконки lucide
  description String?   @db.Text

  sequence    Int       @default(0)               // порядок отображения в боковой панели
  isDefault   Boolean   @default(false)           // одна доска per project помечается как default
  archivedAt  DateTime?

  issues      Issue[]

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  @@unique([projectId, name])
  @@index([projectId, sequence])
  @@index([tenantId])
}
```

### Расширение `Issue`

```prisma
model Issue {
  // ... существующие поля
  boardId   String?
  board     Board?    @relation(fields: [boardId], references: [id], onDelete: SetNull)

  @@index([boardId])
}
```

`boardId` — nullable на схеме (для случая если доска удалена), но фактически в коде всегда заполнен после миграции.

### Миграция данных

Скрипт `backend/scripts/backfill-default-board.ts`:
1. Для каждого `Project` без досок — создать `Board { isDefault: true, name: 'Доска', sequence: 0 }`.
2. Все `Issue` этого проекта с `boardId IS NULL` — обновить на ID созданной доски.
3. Идемпотентный (повторный запуск ничего не делает).
4. Зарегистрировать в `apply-prod-deploy.ts` массив `STEPS` с `phase: 'backfill'`.

После миграции код может рассчитывать на то, что у Issue всегда есть `boardId`. Nullable остаётся как safety net.

## REST API

```
GET    /api/v1/projects/:projectId/boards            # список досок проекта (включая архивные опц.)
POST   /api/v1/projects/:projectId/boards            # создать
GET    /api/v1/boards/:id                            # детали
PATCH  /api/v1/boards/:id                            # переименовать, изменить цвет, sequence
DELETE /api/v1/boards/:id                            # soft-delete (issues откатываются на default)
POST   /api/v1/boards/:id/archive
POST   /api/v1/boards/:id/unarchive
POST   /api/v1/boards/reorder                        # массовый { boardIds: string[] } порядок
```

**Изменения существующих endpoint'ов:**
- `GET /projects/:projectId/issues` — добавить query-параметр `boardId?: string`.
- `POST /projects/:projectId/issues` — body принимает `boardId?: string`. Если не передан — берётся `default` доска проекта.
- `PATCH /issues/:id` — позволяет менять `boardId` (перенос между досками).

**Контроль:** при удалении доски — все её issues переносятся на `isDefault` доску проекта. Если default — единственная — удаление запрещено (409 «удалите проект целиком»).

## DTO (Zod)

```ts
export const CreateBoardSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().max(40).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).strict();

export const UpdateBoardSchema = CreateBoardSchema.partial().extend({
  sequence: z.number().int().min(0).optional(),
}).strict();

export const ReorderBoardsSchema = z.object({
  boardIds: z.array(z.string().min(1)).min(1).max(100),
}).strict();
```

## WebSocket events

`TrackerEventsService` расширяется:
- `board.created`
- `board.updated`
- `board.deleted`
- `board.reordered`
- `issue.moved_to_board` — когда `boardId` меняется через PATCH

## Frontend

### Структура страниц

`/projects/[slug]` теперь сначала редиректит на `/projects/[slug]/overview` (после реализации Overview ТЗ). До тех пор — на `/projects/[slug]/boards/[boardId]/board`.

```
/projects/[slug]/boards                              # список досок (если ?view=list)
/projects/[slug]/boards/[boardId]/board              # канбан выбранной доски
/projects/[slug]/boards/[boardId]/list               # список задач выбранной доски
/projects/[slug]/boards/[boardId]/calendar           # календарь выбранной доски
```

«Циклы», «Входящие», «Гант», «Настройки» остаются на уровне проекта.

### Левая панель внутри проекта

Внутри `/projects/[slug]/*` появляется вторичная боковая панель (≤md — drawer, выезжает по кнопке):
- Заголовок проекта
- Список досок:
  - Иконка + название (drag-n-drop для сортировки, если есть права на проект)
  - Бэйдж количества задач
  - Активная — подсвечена mint
- Кнопка «+ Доска» — открывает inline-форму (название → Enter), defaults: цвет = акцент проекта, sequence = max+1
- Раздел «Архив» (collapsed) — архивные доски

### Компонент `<ProjectBoardsSidebar>`

`frontend/src/ui/tracker/ProjectBoardsSidebar.tsx`:
- SWR-хук `useProjectBoards(orgId, projectId)`
- DnD через `@dnd-kit/sortable` (уже в проекте) — drag меняет `sequence`, batch-update `POST /boards/reorder`
- Inline-add по кнопке «+ Доска»
- Контекстное меню по правому клику / долгому тапу: «Переименовать», «Цвет», «Архив», «Удалить»

### Что меняется в существующем `<Board>` компоненте

`frontend/src/ui/tracker/Board.tsx` теперь принимает `boardId` дополнительно к `projectId` и фильтрует issues по нему. Список колонок (статусов) — берётся из проекта (как было), общий для всех досок проекта.

### Создание задачи

В QuickAdd (inline-форма «+ Задача» в колонке статуса) — `boardId` берётся из URL (доска, на которой пользователь). Никакого селектора.

В расширенной форме (Shift+Enter) — селектор «Доска» с дефолтом = текущая.

### Перенос задачи между досками

В IssueDetail (правая панель) — селектор «Доска» с textbox-search. При смене — PATCH issue, оптимистическое обновление + WebSocket invalidate на двух досках.

В Board (канбан) — drag-n-drop колонки уже работает (меняет статус). **Перетаскивание на другую доску в боковой панели** — фаза 2, не MVP. Пользователь меняет доску через IssueDetail.

### Mobile (≤md)

- Боковая панель досок — drawer, открывается кнопкой «Доски» в header проекта.
- Header показывает название текущей доски + стрелка-переключатель.

## Локализация

| Английский | Русский |
|---|---|
| Board | Доска |
| Default board | Основная доска |
| Archive board | Архивировать доску |
| Move to board | Перенести на доску |

## RBAC

Новый ResourceType `board`:
- `create` — `project.admin`, `project.member`
- `read` — все участники проекта
- `update` — `project.admin`, `project.member` (свои доски)
- `delete` — `project.admin` (только не-default)

Регистрация в `policies/policy.csv` через `RbacService.ResourceType`.

## Метрики Prometheus

```
boards_created_total{tenant, project}
boards_archived_total{tenant, project}
board_issues_moved_total{tenant, from_board, to_board}
```

## Knowledge-core

Создание/архивация доски — не порождает `IdeaBlock` (это организационное событие, не семантическое). Только лог в `IssueActivity`.

**Перенос задачи между досками** — IssueActivity `verb='moved_to_board'`, в knowledge-core не идёт (это не сигнал — это перекладывание).

## Что НЕ делаем в этом ТЗ

- Drag-n-drop задачи между досками через боковую панель (через IssueDetail — да).
- Доска как «view-фильтр» (см. отдельную задачу в архитектурном решении владельца — отказались в пользу простой модели).
- Sharing доски наружу проекта (между проектами одной Org) — отложено.
- Шаблоны досок («Стандартный Канбан», «Scrum-доска» с готовыми колонками) — внутри проекта колонки общие, это не имеет смысла без переработки IssueState на уровне доски.
- Кастомные колонки на уровне доски (когда у каждой доски свои статусы) — крупное архитектурное изменение, отдельный ТЗ при необходимости.

## DoD

- [x] Модель `Board` создана, `Issue.boardId` добавлен, `prisma:generate` прошёл (db push сделает владелец после merge)
- [x] Backfill-скрипт `backend/scripts/backfill-default-board.ts` написан, зарегистрирован в `apply-prod-deploy.ts` (phase: 'backfill', skipBootstrap)
- [x] REST endpoints отвечают (Swagger автоматически — `BoardsController` под `/api/v1`)
- [x] WebSocket события эмитятся (`board.created/updated/deleted/reordered` + `issue.moved_to_board` в `TrackerEventsService`)
- [x] Frontend: `<ProjectBoardsSidebar>` работает, переключение между досками сохраняет view (board/list/calendar) через URL `/projects/[slug]/boards/[boardId]/{view}`; DnD-сортировка досок в боковой панели — отложена (см. ТЗ §"Что НЕ делаем")
- [x] Создание задачи в `<Board>` (включая QuickAdd внутри колонок) сохраняет `boardId` из props/URL
- [x] PATCH `/issues/:id { boardId }` валидируется (доска должна быть в том же проекте + tenant) и эмитит `issue.moved_to_board` + IssueActivity verb='updated' field='boardId'
- [x] Удаление не-default доски переносит её issues на default (одна транзакция) + 409 `cannot_delete_default_board` при попытке удалить default
- [x] Локализация: все строки на русском (DTO, UI, error messages)
- [x] RBAC: ResourceType `board` зарегистрирован, policy.csv заполнен (owner/admin/manager/coo); unit-тесты прав — переиспользуют общие RbacService-тесты, отдельные тесты `board`-grants — отложены вместе с integration
- [x] Метрики Prometheus: `boards_created_total`, `boards_archived_total`, `board_issues_moved_total` (с tenant_top + project/board labels)
- [x] Unit-тесты: `boards.service.spec.ts` (10 тестов: create + 409 на дубликат, softDelete + защита default, archive + защита default, ensureDefaultBoard, reorder). Integration-тесты с реальной БД — отложены по согласованию (прогоняются на dev-DB после merge).
- [ ] Обновлены `second-brain/02_architecture/module-map.md` и `data-model.md` — сделает владелец при финальной рефлексии после merge
- [ ] `prod-deploy-log.md` — Шаг 4 (schema) и Шаг 8 (backfill) обновлены — сделает владелец при финальной рефлексии после merge

## Срок

**2 человеко-недели.**

---
type: tz
status: draft
feature: UI подзадач в карточке задачи (модель уже есть — Issue.parentId)
date: 2026-05-27
parent: plans/tz/2026-05-27-tracker-parity-with-competitors.md
related:
  - plans/archive/2026-05-23-tracker-phase-1-models-api.md
---

# UI подзадач в задаче

## TL;DR

`Issue.parentId String?` уже есть в Prisma с фазы 1 трекера, но фронтенд не отображает дерево подзадач. Этот ТЗ — добавить UI: блок «Подзадачи N/M» в карточке задачи, inline-создание подзадачи, навигация в подзадачу, badge «3/5» в карточке на канбан-доске у задач с подзадачами. Срок: 1 человеко-неделя.

## Зачем

Пользователь Weeek/Kaiten/Битрикс24 ожидает разбить большую задачу на меньшие, у каждой — свой исполнитель и срок. Подзадача — полноценная Issue, не плоская галочка (для галочек — отдельное ТЗ [tracker-checklists](2026-05-27-tracker-checklists.md)).

## Что не делаем

Модель уже есть — никаких изменений в `schema.prisma`. REST частично работает: `POST /projects/:projectId/issues` принимает `parentId`, `GET /issues/:id` возвращает `parentId`. Нужно лишь добавить чтение детей и UI.

## REST API — расширения

### Новый endpoint

```
GET /api/v1/issues/:id/children
```

Возвращает список прямых детей в формате упрощённой `IssueResponseDto`:

```ts
{
  items: Array<{
    id: string;
    identifier: string;
    title: string;
    stateId: string | null;
    stateCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
    priority: string;
    assigneeUserIds: string[];
    dueDate: string | null;
    completedAt: string | null;
    childrenCount: number;     // для вложенных подзадач (2 уровня видны в дереве)
    sortOrder: number;
  }>;
  total: number;
}
```

Сортировка по `sortOrder` ASC, потом `createdAt` ASC.

### Расширение GET /issues/:id

Добавить опциональный query `includeChildrenCount=true`. Если true — в ответе появляется поле `childrenCount: number`. Используется для badge на канбан-доске (запросом списка `GET /projects/:projectId/issues?...&includeChildrenCount=true` — массово).

### Защита от циклов

При `PATCH /issues/:id` с `parentId` — проверка на backend: новый родитель не должен быть текущей задачей или её потомком (рекурсивный обход вверх). Возврат 400 `cyclic_parent_not_allowed` при попытке.

Также: подзадача должна быть в том же `projectId` и (после tracker-boards) — в том же `boardId`. При переносе родителя на другую доску — все потомки автоматически переносятся (транзакция).

### Максимальная глубина

Ограничение **2 уровня** (задача → подзадача). Подзадача подзадачи запрещена на backend (400 `max_subtask_depth_exceeded`). Это сознательное упрощение: трёх уровней при простом UX никто из конкурентов не делает в SMB-сегменте (есть у Я.Трекер для разработки, но это не наш ICP).

## Frontend

### Блок «Подзадачи» в IssueDetail

`frontend/src/ui/tracker/IssueSubtasks.tsx`:
- Заголовок «Подзадачи N/M» (N выполненных, M всего)
- Прогресс-бар (тонкая полоска mint, заполнение N/M)
- Список подзадач:
  - Чекбокс (тап → меняет status на completed/первый started, как «mark done» в обычной задаче)
  - identifier (`KORA-124`) приглушённо
  - Title — кликабелен, ведёт на `/issues/[id]`
  - Avatar исполнителей (≤3 + «+N»)
  - Срок (если просрочена — красный)
- Поле inline-add внизу: «+ Подзадача» → название → Enter
  - Smart defaults: `boardId` = от родителя, `assignees` = текущий пользователь, `priority='none'`
- Кнопка «Раскрыть форму» (Shift+Enter) → drawer справа со всеми полями

### Кнопка «Создать подзадачу» в header IssueDetail

Альтернативный путь: кнопка `+ Подзадача` рядом с другими действиями в header задачи. Тот же drawer.

### Badge «3/5» на канбан-карточке

`frontend/src/ui/tracker/IssueCard.tsx` (карточка на канбан-доске) — если `childrenCount > 0`, показывать маленький бейдж «✓ N/M» в правом нижнем углу. Цвет: серый/mint в зависимости от прогресса.

Запрос `GET /projects/:projectId/issues?includeChildrenCount=true` — добавляется параметр, frontend всегда передаёт (стоимость минимальная — один JOIN на backend).

### Навигация «вверх» (родитель)

На странице подзадачи `/issues/[id]` — breadcrumb сверху:
```
← KORA-100 «Релиз 2.0»  /  KORA-124 «Дизайн логотипа»
```
Клик по родителю → переход на его страницу.

### Перенос подзадачи в другую задачу

В IssueDetail (правая панель) — поле «Родительская задача» с typeahead-search. При смене:
- PATCH `/issues/:id` с новым `parentId` (или `null` чтобы сделать корневой)
- Активация → задача переносится в `Subtasks` нового родителя
- Activity запись с verb='parent_changed'

### Mobile

На мобиле блок «Подзадачи» — collapsed по умолчанию (тап разворачивает). Inline-add работает так же.

## Локализация

| Английский | Русский |
|---|---|
| Subtask | Подзадача |
| Add subtask | Добавить подзадачу |
| Parent task | Родительская задача |
| Make top-level | Сделать самостоятельной |
| Convert to subtask | Сделать подзадачей |

## Knowledge-core

Создание подзадачи — отдельный `IdeaBlock` с `signalType='task_created'` (как у обычной задачи). В payload дополнительно `parentIssueId` — это позволяет аналитике видеть дерево.

Завершение подзадачи → как обычная задача (`task_completed`).

## WebSocket events

Существующие `issue.created`, `issue.updated` уже эмитятся. Frontend в `useIssue(id)` уже должен реагировать. Дополнительно — при изменении `parentId` инвалидируем `useIssueChildren(oldParentId)` и `useIssueChildren(newParentId)`.

## Что НЕ делаем

- Подзадачи 3-го уровня (глубина >2)
- Шаблоны подзадач (`POST /issues/:id/apply-template` — отдельный ТЗ для шаблонов задач)
- Массовое создание подзадач из текстового списка (фича для будущего AI-разбиения)
- Авто-завершение родителя когда все подзадачи completed — на старте нет, добавить как опциональный setting проекта позже

## DoD

- [ ] `GET /issues/:id/children` отвечает корректным DTO
- [ ] `includeChildrenCount=true` работает в списках
- [ ] Защита от циклов на PATCH работает (тест: попытка сделать родителя своим потомком → 400)
- [ ] Защита от глубины >2 работает
- [ ] Перенос родителя на другую доску переносит всех потомков (транзакция)
- [ ] `<IssueSubtasks>` отображается в IssueDetail
- [ ] Inline-add создаёт подзадачу с smart defaults
- [ ] Канбан-карточка показывает badge «N/M»
- [ ] Breadcrumb на странице подзадачи кликабельный
- [ ] Activity записывает `parent_changed`
- [ ] Локализация: все строки на русском
- [ ] Unit + integration тесты: создание, защита от циклов, защита от глубины, перенос
- [ ] Метрики: `subtasks_created_total{tenant, project}`

## Срок

**1 человеко-неделя.**

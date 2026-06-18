---
type: tz
status: draft
feature: Вкладка «Обзор» проекта + «Загруженность» + «Приложения»
date: 2026-05-27
parent: plans/archive/2026-05-27-tracker-parity-with-competitors.md
related:
  - plans/tz/2026-05-27-tracker-boards.md
  - plans/tz/2026-05-27-tracker-project-documents.md
---

# Обзор + Загруженность + Приложения в проекте

## TL;DR

Три новые вкладки в проекте, объединённые этим ТЗ потому что используют общую инфраструктуру дашбордов:
1. **Обзор** (`/projects/[slug]/overview`) — стартовая страница проекта: метрики, активность, прогресс цикла, краткая сводка
2. **Загруженность** (`/projects/[slug]/workload`) — кто чем занят в проекте, сколько у кого открытых задач
3. **Приложения** (`/projects/[slug]/integrations`) — список доступных интеграций для этого проекта: импорт, Telegram, email-to-task

Backend для большинства — переиспользование существующих endpoint'ов с фильтром `projectId`. Срок: 2 человеко-недели.

## Зачем

В Weeek/Kaiten/Битрикс24 проект открывается на «Обзор» — пользователь видит дашборд с агрегатами. Сейчас у нас редирект на канбан-доску — пользователь сразу попадает в работу, без контекста состояния. Для руководителя проекта это критично: ему нужен «пульс» проекта за 5 секунд.

«Загруженность» — частый запрос: «У кого что в работе?». Сейчас можно увидеть только через личный инбокс каждого, не агрегировано по проекту.

«Приложения» — нет точки входа для подключения интеграций к конкретному проекту. Сейчас Email-to-task UI разбросан в settings, импорт — в `/integrations/import-tracker`. На вкладку «Приложения» собираем единую витрину.

---

## Часть 1. Вкладка «Обзор»

### Структура страницы

`/projects/[slug]/overview` — новая default-страница проекта (редирект из `/projects/[slug]` идёт сюда вместо `/board` после реализации).

### Виджеты (сверху вниз)

**1. Шапка проекта**
- Название, бэйдж статуса («В работе» / «Архив»)
- Описание (опц., из `Project.description`)
- Аватары участников (≤8 + «+N»)
- Быстрые кнопки: «+ Задача» (открывает inline на дефолтной доске), «Начать встречу» (если есть AI-Coo / общая встреча проекта)

**2. Ключевые метрики (4 KPI-карточки в ряд, mobile — 2x2)**
- Всего задач
- В работе
- Просрочено (красный, если >0)
- Завершено за 7 дней

**3. Прогресс активного цикла**
- Если у проекта есть `Cycle` с `now BETWEEN startDate AND endDate`:
  - Название цикла, даты
  - Прогресс-бар «23/50 задач»
  - Сравнение «опережаем / отстаём» (issue_progress_ratio vs time_progress_ratio из strategic-alignment воркера)
  - Кнопка «Посмотреть цикл» → `/projects/[slug]/cycles/[cycleId]`
- Если активного цикла нет — placeholder «Циклы в проекте не настроены» с кнопкой «Создать цикл»

**4. Распределение задач по статусам**
- Простой stacked-bar или 4 числа с цветными точками: backlog / unstarted / started / completed / cancelled

**5. Лента активности (последние 10 событий)**
- Источник: `IssueActivity` где `issue.projectId = current` ORDER BY epoch DESC LIMIT 10
- Каждое событие: «Иванов сменил статус KORA-123 → В работе, 5 минут назад»
- Кнопка «Все события» → переход на полную ленту (отдельная страница `/projects/[slug]/activity` — отложено, в этом ТЗ необязательно)

**6. Связанные цели (Goals)**
- Список целей, к которым привязаны задачи проекта (через `Issue.goalId`)
- Для каждой — прогресс через strategic-alignment

**7. Связанные документы (последние 5 ProjectDocument)**
- Превью карточек документов (из [tracker-project-documents](2026-05-27-tracker-project-documents.md))
- Кнопка «Все документы»

### REST API

Новый endpoint, объединяющий данные в один запрос (чтобы не делать 7 параллельных fetch'ей с frontend):

```
GET /api/v1/projects/:projectId/overview
```

Ответ:
```ts
{
  project: ProjectMiniDto,
  members: UserMiniDto[],         // ≤8
  metrics: {
    totalIssues: number,
    inProgressIssues: number,
    overdueIssues: number,
    completedLast7d: number,
  },
  statesDistribution: Array<{ category: string, count: number }>,
  activeCycle: {
    id: string,
    name: string,
    startDate: string,
    endDate: string,
    progressSnapshot: Json,        // из существующего поля
    alignmentScore: number | null, // из strategic-alignment
  } | null,
  recentActivity: IssueActivityMiniDto[],   // ≤10
  linkedGoals: GoalMiniDto[],
  recentDocuments: ProjectDocumentMiniDto[], // ≤5, если ТЗ documents применён
}
```

Кэширование: 30 секунд в Redis по ключу `project:overview:{projectId}`. Инвалидация при `issue.created/updated/completed`, `cycle.updated`, `project_document.created/updated` через event listener в `OverviewCacheService`.

### Frontend

`/projects/[slug]/overview/page.tsx` + `OverviewClient.tsx`:
- Один SWR-запрос на `/api/v1/projects/:projectId/overview`
- Каждый виджет — отдельный компонент в `frontend/src/ui/tracker/overview/*`:
  - `ProjectHeader.tsx`
  - `MetricsRow.tsx`
  - `ActiveCycleWidget.tsx`
  - `StatesDistributionWidget.tsx`
  - `ActivityFeedWidget.tsx` (переиспользует существующий `<ActivityFeedWidget>` из feed-модуля с filter `projectId`)
  - `LinkedGoalsWidget.tsx`
  - `RecentDocumentsWidget.tsx` (если documents ТЗ применён)
- Skeleton-loaders для каждого виджета

---

## Часть 2. Вкладка «Загруженность»

### Структура

`/projects/[slug]/workload` — таблица «участник × состояние»:

| Участник | Открыто | В работе | Просрочено | Завершено за 7 дней |
|---|---|---|---|---|
| Иванов | 8 | 3 | 1 (красный) | 5 |
| Петров | 12 | 6 | 3 (красный) | 2 |

- Кликабельные ячейки — по клику открывается отфильтрованный список задач (`/projects/[slug]/boards/[default]/list?assigneeUserId=X&stateCategory=started`)
- Сортировка по любому столбцу
- Топ-3 загруженных — мягкая подсветка mint
- Среднее по проекту — строка снизу

### REST API

Переиспользуем существующий `/api/v1/dashboard/operations/capacity` — добавить query-параметр `projectId?: string`:

```
GET /api/v1/dashboard/operations/capacity?projectId=:projectId
```

В существующем endpoint расширить фильтр по `Issue.projectId = projectId AND deletedAt IS NULL`. Backend изменение — точечное.

### Frontend

`/projects/[slug]/workload/page.tsx` + `WorkloadClient.tsx`:
- SWR-запрос
- Таблица через существующий `<DataTable>` (если есть) или простая `<table>` с Tailwind
- Mobile: таблица превращается в карточки по участникам (имя сверху, метрики ниже)

---

## Часть 3. Вкладка «Приложения»

### Структура

`/projects/[slug]/integrations` — витрина доступных интеграций для проекта:

**Карточки интеграций (сетка 2-3 в ряд):**

1. **Импорт задач** — карточка с иконкой Битрикс24 / Trello / Я.Трекер
   - Кнопка «Импортировать» → `/integrations/import-tracker?projectId=<id>` (новый query-параметр в существующем wizard'е — pre-fill target project)

2. **Email-to-task** — карточка
   - Статус: «Не настроено» / «Активно: proj-xxx@inbox.kora.app»
   - Кнопка «Настроить» → существующий UI (был в settings, переезжает сюда)
   - Скрыта если фича Email-to-task недоступна (см. tracker-phase-4 — не реализована полностью, в этом ТЗ просто скрываем карточку)

3. **Telegram-уведомления проекта** — карточка
   - Toggle «Получать уведомления о задачах проекта в Telegram»
   - Если у пользователя нет привязанного Telegram — кнопка «Привязать Telegram»
   - Backend: новая модель `ProjectTelegramSubscription { projectId, userId, isActive }` или расширение существующих preferences

4. **Webhooks** — карточка
   - «Уведомлять другую систему о событиях проекта»
   - Кнопка «Добавить webhook» → существующий `/admin/webhooks?projectId=<id>` (если есть, иначе создать страницу управления per-project webhooks)

5. **AI-помощник проекта** — карточка
   - «AI-чат, который знает всё про этот проект» — переадресация на Concierge с pre-set scope = project

### REST API

Минимальные новые endpoints:
- `GET /api/v1/projects/:projectId/integrations-status` — возвращает состояние каждой интеграции:
  ```ts
  {
    emailToTask: { enabled: boolean, alias: string | null },
    telegramSubscription: { isActive: boolean, telegramLinked: boolean },
    webhooksCount: number,
    lastImport: { source: string, completedAt: string } | null,
  }
  ```

### Frontend

`/projects/[slug]/integrations/page.tsx` + `IntegrationsClient.tsx`:
- SWR на `/integrations-status`
- Простой `<IntegrationCard>` компонент с иконкой / заголовком / описанием / CTA
- Mobile: одна колонка карточек

---

## Изменения общей структуры проекта

### `ProjectViewShell` — обновление табов

Текущий список (видно в [ProjectViewShell.tsx:22-43](../../frontend/app/(authenticated)/projects/[slug]/ProjectViewShell.tsx#L22-L43)):
- Доска / Список / Циклы / Входящие / Календарь / Гант / Настройки

После этого ТЗ — новый порядок (как у Weeek):
1. **Обзор** (новая, default)
2. **Задачи** (объединяет Доску/Список/Календарь/Гант под одним пунктом — раскрывается выпадающим меню или sub-tabs; альтернативный путь см. ниже)
3. **Документы** (из [tracker-project-documents](2026-05-27-tracker-project-documents.md))
4. **Приложения**
5. **Циклы** (если включены)
6. **Входящие** (если включены)
7. **Загруженность**
8. **Настройки**

### Решение по группировке «Задачи» 

**Минимальный вариант (рекомендую):** оставить отдельные табы для Доска / Список / Календарь / Гант как сейчас (под влиянием [tracker-boards](2026-05-27-tracker-boards.md) — внутри одной доски). Не группировать.

**Альтернатива (отложено):** добавить выпадающее меню «Задачи ▾» (Доска / Список / Календарь / Гант) — потребует переделки навигации. Решаем в `done`-ревизии этого ТЗ если получим UX-фидбек.

### Default-страница проекта

`/projects/[slug]` редиректит на `/projects/[slug]/overview` (заменяет текущий редирект на `/board`).

## Локализация

| Английский | Русский |
|---|---|
| Overview | Обзор |
| Workload | Загруженность |
| Integrations | Приложения |
| Total tasks | Всего задач |
| In progress | В работе |
| Overdue | Просрочено |
| Completed | Завершено |
| Open | Открыто |
| Linked goals | Связанные цели |
| Recent activity | Последняя активность |

## RBAC

- **Обзор** — read доступен всем участникам проекта
- **Загруженность** — read доступен всем участникам (как в COO Dashboard)
- **Приложения** — read доступен всем; **mutate** (включить Email-to-task, добавить webhook) только `project.admin`

## Метрики Prometheus

```
project_overview_views_total{tenant, project}
project_workload_views_total{tenant, project}
project_integrations_action_total{tenant, project, action}
```

## Что НЕ делаем

- Кастомные виджеты (drag-n-drop layout как у Notion) — далеко за рамки
- Экспорт обзора в PDF — отложено
- AI-сводка «состояние проекта одной фразой» — отложено (есть в AI-COO дашборде, отдельный путь)
- Burn-down chart по циклу — отложено (есть только prog-bar)
- Полная история активности с фильтрами — `/projects/[slug]/activity` создаём только если будет запрос
- Group-by «по проектам» на global workload (отдельно от vehicle) — переделка `/dashboard/operations/capacity` — не сейчас

## DoD

- [ ] `GET /projects/:projectId/overview` отвечает агрегированными данными, Redis-cache 30 сек с инвалидацией по событиям
- [ ] `GET /dashboard/operations/capacity?projectId=...` фильтрует корректно
- [ ] `GET /projects/:projectId/integrations-status` отвечает
- [ ] `/projects/[slug]/overview` — все виджеты отображаются (или skeleton)
- [ ] `/projects/[slug]/workload` — таблица со всеми участниками
- [ ] `/projects/[slug]/integrations` — карточки всех 5 интеграций (с условным скрытием Email-to-task если фича недоступна)
- [ ] `/projects/[slug]` редиректит на `/overview`
- [ ] `ProjectViewShell` — обновлён порядок табов
- [ ] Mobile-адаптация всех трёх страниц
- [ ] Локализация: все строки на русском
- [ ] Unit + integration тесты: cache invalidation overview, capacity-filter, integrations-status
- [ ] Метрики Prometheus
- [ ] Обновлены `second-brain/01_projects/frontend-pages.md` и `module-map.md`

## Срок

**2 человеко-недели.**

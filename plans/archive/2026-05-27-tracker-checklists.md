---
type: tz
status: draft
feature: Чек-листы внутри задачи (плоские пункты с галочками, «0/7»)
date: 2026-05-27
parent: plans/tz/2026-05-27-tracker-parity-with-competitors.md
related:
  - plans/tz/2026-05-27-tracker-subtasks-ui.md
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Фича реализована целиком и подключена в прод-путь: обе Prisma-модели + денормализованные счётчики, все 9 REST-эндпоинтов, DTO с .strict() и лимитом 50, WS-события, метрики Prometheus, фронтовый компонент с DnD/inline-edi
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# Чек-листы внутри задачи

## TL;DR

Внутри задачи можно создать один или несколько чек-листов с галочками («позвонить клиенту», «отправить договор», «получить подтверждение»). У пункта нет исполнителя, срока, статуса — только текст и состояние «сделано / не сделано». В карточке на канбан-доске и в IssueDetail отображается прогресс «3/7». Новые модели Prisma + UI. Срок: 1 человеко-неделя.

## Зачем

Подзадача — это полноценная Issue с исполнителем и сроком. Когда мне нужно просто записать 5 микро-пунктов внутри задачи, которую я делаю сам — заводить 5 Issue избыточно. Чек-лист закрывает этот сценарий: лёгкие пункты внутри одной задачи без accountability на конкретного человека.

Эта пара (чек-лист + подзадачи) — стандарт у Weeek, Kaiten, YouGile, Trello.

## Модель данных

### Новая модель `IssueChecklist`

```prisma
model IssueChecklist {
  id        String   @id @default(cuid())
  tenantId  String
  issueId   String
  issue     Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)

  title     String   @default("Чек-лист")     // в одной задаче может быть несколько чек-листов
  sequence  Int      @default(0)

  items     IssueChecklistItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@index([issueId, sequence])
  @@index([tenantId])
}
```

### Новая модель `IssueChecklistItem`

```prisma
model IssueChecklistItem {
  id            String   @id @default(cuid())
  tenantId      String
  checklistId   String
  checklist     IssueChecklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)

  text          String   @db.Text             // короткий текст пункта (без rich-text)
  isDone        Boolean  @default(false)
  sequence      Int      @default(0)

  completedAt   DateTime?
  completedById String?                        // кто отметил выполненным

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([checklistId, sequence])
  @@index([tenantId])
}
```

### Расширение `Issue`

Денормализованные счётчики для быстрого отображения прогресса в карточке (не делать `COUNT()` на каждый запрос списка):

```prisma
model Issue {
  // ... существующие поля
  checklistTotalCount    Int   @default(0)
  checklistDoneCount     Int   @default(0)
  checklists IssueChecklist[]
}
```

Счётчики пересчитываются триггером в коде (не в SQL):
- При создании/удалении item — `ChecklistService.recountCounters(issueId)`
- При смене `isDone` — то же

## REST API

```
GET    /api/v1/issues/:id/checklists                 # все чек-листы задачи с items inline
POST   /api/v1/issues/:id/checklists                 # создать чек-лист
PATCH  /api/v1/checklists/:id                        # переименовать
DELETE /api/v1/checklists/:id                        # удалить весь чек-лист
POST   /api/v1/checklists/reorder                    # { issueId, checklistIds: string[] }

POST   /api/v1/checklists/:id/items                  # создать пункт { text }
PATCH  /api/v1/checklist-items/:id                   # { text?, isDone?, sequence? }
DELETE /api/v1/checklist-items/:id
POST   /api/v1/checklist-items/reorder               # { checklistId, itemIds: string[] }
POST   /api/v1/checklist-items/bulk-create           # { checklistId, lines: string[] } — для вставки списка
```

`bulk-create` — массовое создание пунктов из текстового блока (пользователь вставляет 10 строк сразу).

## DTO (Zod)

```ts
export const CreateChecklistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
}).strict();

export const CreateChecklistItemSchema = z.object({
  text: z.string().min(1).max(500),
}).strict();

export const UpdateChecklistItemSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  isDone: z.boolean().optional(),
  sequence: z.number().int().min(0).optional(),
}).strict();

export const BulkCreateChecklistItemsSchema = z.object({
  lines: z.array(z.string().min(1).max(500)).min(1).max(50),
}).strict();
```

## WebSocket events

- `checklist.created`, `checklist.updated`, `checklist.deleted`
- `checklist_item.created`, `checklist_item.updated`, `checklist_item.deleted`
- `issue.checklist_progress_changed` — отдельное событие для оптимистичного обновления карточек на канбан-доске у других пользователей (payload: `{ issueId, total, done }`).

## Frontend

### Блок «Чек-листы» в IssueDetail

`frontend/src/ui/tracker/IssueChecklists.tsx`:
- Для каждого чек-листа задачи:
  - Заголовок (редактируемый inline)
  - Прогресс-бар «3/7» + полоска mint
  - Список пунктов:
    - Чекбокс (тап → PATCH `isDone`, оптимистично)
    - Текст (редактируемый inline — кликаешь и редактируешь)
    - Кнопка «×» на hover (удалить пункт)
    - DnD-handle (вертикальная иконка, drag меняет sequence)
  - Поле inline-add «+ Пункт» снизу — Enter создаёт пункт, Esc закрывает
  - При вставке многострочного текста (paste) — модалка «Создать N пунктов?» → `bulk-create`
- Кнопка «+ Чек-лист» — внизу всех существующих, создаёт новый чек-лист с дефолтным title «Чек-лист»

### Badge прогресса на канбан-карточке

В `IssueCard.tsx` — если `checklistTotalCount > 0`, показать «☑ 3/7» в правом нижнем углу карточки. Цвет: серый → mint по мере прогресса (полностью завершён — зелёный).

Если у задачи есть И подзадачи И чек-лист — два бейджа рядом: «✓ 2/3» (подзадачи) и «☑ 5/7» (чек-лист).

### Bulk-create UX

В поле «+ Пункт» — если пользователь paste'ит несколько строк, фронтенд:
1. Определяет это (`\n` в clipboard data)
2. Открывает модалку «Создать N пунктов из вставленного текста?» с превью первых 5
3. По подтверждению — POST `/checklist-items/bulk-create`

### Mobile

- Чек-лист — secondary блок в IssueDetail, между описанием и комментариями
- DnD по long-press
- Чекбокс — крупный (≥24px touch target)

## Локализация

| Английский | Русский |
|---|---|
| Checklist | Чек-лист |
| Add item | Добавить пункт |
| Add checklist | Добавить чек-лист |
| Done | Сделано |
| Items | Пунктов |

## Knowledge-core

**Не создаём** `IdeaBlock` на каждый пункт чек-листа. Это слишком мелкие сигналы — забьют граф.

Но если 80%+ пунктов выполнены — задача считается «почти готовой», это влияет на сводки в COO Dashboard. Расширение `analyze-issue-progress` job (если есть) или добавление поля в существующие метрики.

При завершении **всех** пунктов чек-листа — IssueActivity с verb='checklist_completed', payload включает количество пунктов. Аналитика может использовать для «такие задачи в среднем имеют 5 пунктов» инсайтов.

## RBAC

- `read` чек-листов — все, у кого read на parent Issue
- `update` — все, у кого update на parent Issue (участники проекта)
- Отдельный ResourceType `checklist` НЕ нужен — наследуем от issue

## Метрики

```
checklists_created_total{tenant, project}
checklist_items_added_total{tenant, project, via_bulk}
checklist_items_completed_total{tenant, project}
```

## Что НЕ делаем

- Шаблоны чек-листов (часто запрашиваемые «стандартные пункты» — отдельный ТЗ)
- Конвертация пункта в подзадачу одним кликом (планируется в Wave 2, не MVP)
- Назначение исполнителя на пункт (это уже подзадача — путь в [tracker-subtasks-ui](2026-05-27-tracker-subtasks-ui.md))
- Срок на пункт (то же)
- Уведомления при выполнении пункта (мелкое, не нужно — фокус на тех, кто внутри задачи и так видит)

## DoD

- [ ] Модели `IssueChecklist` и `IssueChecklistItem` созданы, `Issue.checklistTotalCount`/`checklistDoneCount` добавлены, `bun run prisma:push` прошёл
- [ ] Счётчики `checklistTotalCount/DoneCount` пересчитываются корректно после CRUD на item (unit-тест)
- [ ] Все REST endpoints отвечают, Swagger автоматически
- [ ] `bulk-create` принимает до 50 строк
- [ ] WebSocket события эмитятся
- [ ] `<IssueChecklists>` отображается в IssueDetail с DnD сортировкой
- [ ] Inline-edit пункта работает (тап → input → Enter сохраняет)
- [ ] Bulk-paste UX: paste многострочного → модалка → массовое создание
- [ ] Badge «☑ 3/7» на канбан-карточке
- [ ] Локализация: все строки на русском
- [ ] Unit + integration тесты: CRUD чек-листа, item, bulk-create, пересчёт счётчиков, проверка прав
- [ ] Метрики Prometheus
- [ ] Обновлены `second-brain/02_architecture/data-model.md` и `module-map.md`
- [ ] `prod-deploy-log.md` Шаг 4 обновлён (новые модели)

## Срок

**1 человеко-неделя.**

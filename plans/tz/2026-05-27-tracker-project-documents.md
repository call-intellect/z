---
type: tz
status: draft
feature: Вкладка «Документы» в проекте (ProjectDocument + связанные карточки)
date: 2026-05-27
parent: plans/archive/2026-05-27-tracker-parity-with-competitors.md
related:
  - plans/archive/2026-05-09-cards.md
---

# Вкладка «Документы» в проекте

## TL;DR

Вкладка `/projects/[slug]/documents` показывает: (а) простые rich-text документы, привязанные к проекту — брифы, спецификации, протоколы (новая модель `ProjectDocument`); (б) список CRM-карточек, связанных с проектом через подвязанные к задачам встречи. Один rich-text редактор (TipTap, как в Issue description). Без realtime-collab. Срок: 1.5 человеко-недели.

## Зачем

Пользователь Weeek/Битрикс24 ожидает на проекте видеть «документы» — место, где лежат бриф, ТЗ, инструкция, итоги встречи. Без этой вкладки команда вынужденно тащит документы в Google Docs / Notion / почту, разрывая контекст.

Карточки (CRM) и документы — разные вещи: карточка = «клиент Иванов» (сущность), документ = «бриф ремонта» (артефакт). Оба нужны, не сливаем.

## Модель данных

### Новая модель `ProjectDocument`

```prisma
model ProjectDocument {
  id              String    @id @default(cuid())
  tenantId        String
  projectId       String
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  title           String                              // «Бриф ремонта офиса»
  content         Json                                // TipTap JSON (rich-text)
  contentHtml     String?   @db.Text                  // отрендеренный HTML (для preview, share)
  contentStripped String?   @db.Text                  // plain text для поиска / AI

  // Иерархия (опц., второй этап)
  parentId        String?
  parent          ProjectDocument? @relation("ProjectDocumentChildren", fields: [parentId], references: [id], onDelete: SetNull)
  children        ProjectDocument[] @relation("ProjectDocumentChildren")
  sortOrder       Int       @default(0)

  pinned          Boolean   @default(false)

  // Связь с графом знаний
  entityId        String?

  createdById     String
  updatedById     String?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?

  @@unique([projectId, title])
  @@index([projectId, sortOrder])
  @@index([tenantId])
  @@index([parentId])
}
```

**Иерархия `parentId`** — заложена в модель, в MVP UI плоский список с возможностью pin'ить. Древовидная навигация — Wave 2.

### Расширение `Project`

```prisma
model Project {
  // ... существующие
  documents ProjectDocument[]
}
```

## REST API

```
GET    /api/v1/projects/:projectId/documents              # список (плоский, отсортирован по pinned desc, sortOrder asc)
POST   /api/v1/projects/:projectId/documents              # создать { title, content? }
GET    /api/v1/project-documents/:id                      # один документ с content
PATCH  /api/v1/project-documents/:id                      # обновить { title?, content?, pinned?, parentId?, sortOrder? }
DELETE /api/v1/project-documents/:id                      # soft-delete (30-day grace, retention cron)
POST   /api/v1/project-documents/:id/restore

GET    /api/v1/projects/:projectId/linked-cards           # связанные карточки (через подвязанные ко встречам задачи)
```

### `linked-cards` — алгоритм

Возвращает уникальные `Card`, на которые ссылаются `Meeting`, принадлежащие задачам этого проекта:

```sql
-- псевдо-код
SELECT DISTINCT c.* FROM "Card" c
JOIN "Meeting" m ON m."cardId" = c.id
JOIN "Issue" i ON m."linkedIssueId" = i.id   -- или i.linkedMeetingIds @> ARRAY[m.id]
WHERE i."projectId" = $1
  AND i."deletedAt" IS NULL
  AND m."deletedAt" IS NULL
  AND c."deletedAt" IS NULL
ORDER BY m."createdAt" DESC
LIMIT 50;
```

Карточки в DTO — минимальное представление: `{ id, name, kind, color, meetingCount, lastMeetingAt, contactName }`.

## DTO (Zod)

```ts
export const CreateProjectDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.unknown().optional(),   // TipTap JSON, валидируется отдельной schema на уровне приёма
  parentId: z.string().max(64).nullable().optional(),
}).strict();

export const UpdateProjectDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.unknown().optional(),
  pinned: z.boolean().optional(),
  parentId: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
}).strict();
```

## WebSocket events

- `project_document.created`
- `project_document.updated` — без content в payload (event только триггерит revalidate; контент тянем отдельным запросом, чтобы не гонять килобайты по WS)
- `project_document.deleted`

## Frontend

### Структура страницы

`/projects/[slug]/documents` — два под-раздела:

**Сверху:**
- Заголовок «Документы проекта»
- Кнопка «+ Документ» (создание inline: название → Enter → переход к редактору)
- Список документов:
  - Pinned документы — сверху, иконка пина
  - Остальные — отсортированы по `sortOrder` ASC (DnD меняет порядок)
  - Каждая карточка: title, preview первых 2-3 строк plain text, дата обновления, аватар автора
  - Hover/long-press: контекстное меню — Pin/Unpin, Удалить, Дублировать

**Снизу (collapsed по умолчанию, разворачивается):**
- Заголовок «Связанные карточки»
- Список карточек из `/projects/:id/linked-cards`
- Каждая ведёт на `/cards/[id]`
- Если пусто — placeholder «У задач этого проекта пока нет привязанных карточек CRM»

### Редактор документа

`/projects/[slug]/documents/[docId]` — полноэкранный режим:
- Header: breadcrumb «Проект → Документы → Title», кнопки Pin, Share (отложено), Delete
- TipTap-редактор:
  - Toolbar: H1/H2/H3, bold/italic/strike, list/ordered-list/check-list, link, image (upload в S3), quote, code, divider, table (опц.)
  - Slash-команды (`/h1`, `/list`, `/image`)
  - Авто-сохранение каждые 3 секунды debounce (PATCH)
  - При закрытии вкладки — синхронный PATCH перед unmount

### Поиск

В Cmd+K (command palette) — раздел «Документы проекта» — поиск по `title + contentStripped`. Endpoint: `GET /api/v1/search?type=project_document&q=...`. Расширение существующего search-сервиса.

### Mobile

- Список документов — карточки полной ширины
- Редактор — full-screen, toolbar collapsed в drawer внизу
- Pin/Delete — через long-press

## Загрузка файлов внутри документа

Изображения в редакторе — кнопка «+ Картинка» в toolbar → multipart upload в существующий S3-bucket через `POST /api/v1/uploads/document-asset` (новый endpoint, переиспользует `S3UploadService`). Возвращает URL, фронт вставляет в TipTap.

## Локализация

| Английский | Русский |
|---|---|
| Document | Документ |
| Pin | Закрепить |
| Linked cards | Связанные карточки |
| Edit | Редактировать |
| Last edited | Последнее изменение |

## Knowledge-core

При создании/обновлении `ProjectDocument` — отправлять в `ingest` adapter как `RawEvent` с типом `project_document_change`. Воркер `block-ingest` извлекает из `contentStripped` `IdeaBlock`'и с подходящим `signalType` (`decision`, `note`, `rule`, `idea`). Это органично включает документы проекта в граф знаний компании.

Дополнительно: при первом создании документа — auto-tag через `axis-classifier` (knowledge-core фаза 4), `entityId` записывается в модель.

## RBAC

Новый ResourceType `project_document`:
- `create` — `project.admin`, `project.member`
- `read` — все участники проекта
- `update` — author + `project.admin`
- `delete` — author + `project.admin`

## Метрики

```
project_documents_created_total{tenant, project}
project_documents_updated_total{tenant, project}
linked_cards_view_total{tenant, project}
```

## Что НЕ делаем

- Совместное редактирование в реальном времени (Y.js / CRDT) — слишком тяжело для MVP, добавим в Wave 2 если будет запрос
- Версии документа (история изменений с откатом) — добавим если будут запросы
- Шаблоны документов («Бриф», «Протокол») — отдельный мелкий ТЗ позже
- Внешний share-link на документ для гостя — отложено
- Inline-комментарии к фрагменту документа — отложено
- Полнотекстовый поиск с подсветкой — MVP только ILIKE по title + contentStripped, без HNSW/embedding
- Древовидная иерархия документов в UI — модель готова, UI плоский

## DoD

- [ ] Модель `ProjectDocument` создана, `bun run prisma:push` прошёл
- [ ] REST endpoints отвечают (CRUD + linked-cards), Swagger
- [ ] WebSocket события эмитятся
- [ ] Вкладка `/projects/[slug]/documents` отображает список + блок «Связанные карточки»
- [ ] Создание документа inline работает
- [ ] Редактор TipTap открывается на `/projects/[slug]/documents/[docId]`
- [ ] Auto-save через 3 сек debounce + перед закрытием вкладки
- [ ] Pin/Unpin меняет позицию в списке
- [ ] Поиск в Cmd+K по документам проекта работает
- [ ] Upload картинок в S3 через `/uploads/document-asset` работает
- [ ] Knowledge-core ingest получает `RawEvent` при изменении документа (e2e: создать документ → через 30 сек появился `IdeaBlock`)
- [ ] Локализация: все строки на русском
- [ ] Unit + integration тесты: CRUD, права (создатель vs admin), linked-cards SQL
- [ ] Метрики Prometheus
- [ ] Обновлены `second-brain/02_architecture/data-model.md` и `module-map.md`
- [ ] `prod-deploy-log.md` Шаг 4 обновлён (новая модель + связь с knowledge-core)

## Срок

**1.5 человеко-недели.**

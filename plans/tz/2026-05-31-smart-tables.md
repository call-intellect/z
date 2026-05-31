---
type: tz
status: ready-to-implement
date: 2026-05-31
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-05-31-document-ingest-universal.md
  - plans/analysis/2026-05-31-document-conversion-stack.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/data-model.md
phases:
  - 0
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 9
  - 10
  - 11
  - 12
  - 13
  - 14
---

> **Статус:** ТЗ согласовано владельцем 2026-05-31. Все принципиальные развилки закрыты — разработчик может стартовать **Фазу 0** без дополнительных уточнений. Если по ходу реализации появляется новая развилка — сначала задать вопрос владельцу через issue, не принимать решение «по-своему».

# Умные таблицы Z (Smart Tables)

## Зачем

У главного российского конкурента в категории «корпоративная wiki / память компании» — **Teamly** — релиз Spring 2026 официально позиционирует «Умные таблицы» как «аналог базы данных в Notion», и это центральная фича позиционирования (см. [research-отчёт по Teamly](../analysis/2026-05-31-document-conversion-stack.md), раздел Teamly в этом же ТЗ описан кратко ниже). У Teamly уже есть: 6 представлений, full Notion-database-паритет по колонкам, relations + rollups + формулы, карточка строки = мини-документ, embed в статью. Главная новинка Spring 2026 — **сохраняемые именованные фильтры** (saved views).

Сейчас в Z **таблиц нет вообще**. Если мы не отвечаем — клиент видит у Teamly «всё, что нужно для управления компанией», а у нас «AI и встречи». Это проигрыш в первом сравнении ещё до того, как клиент оценит наш граф знаний.

Цель этого ТЗ: за 2-3 месяца **полный паритет с Teamly + 5 киллер-фич**, которые у них объективно отсутствуют и которые естественно ложатся на наш knowledge-core.

## Что у Teamly есть и что у них нет (из [Teamly Spring 2026](https://teamly.ru/spring_2026/))

**Есть:**
- 6 представлений: Таблица, Канбан, Календарь, Гантт, Формы, Диаграммы.
- Колонки: text, number, currency, %, date, status, single/multi-select, link, checkbox, formula, **relation, rollup**.
- Карточка строки = мини-документ (редактор, обложка, эмодзи, вложения, комменты, журнал).
- Условное форматирование, автоматизации, триггеры.
- Embed таблицы в статью (виджет).
- CSV import/export.
- Сохраняемые наборы фильтров (Spring 2026 — главная новинка).

**Нет / слабо:**
1. **AI-функций внутри таблиц** (генерация строк из источников, саммари, семантический фильтр, auto-fill, генерация колонок).
2. **Прямой Excel-импорт со схема-инференсом** — только CSV.
3. **Связи «строка таблицы ↔ граф знаний компании»** — у них таблицы и статьи связаны вручную (relation на статью), у нас может быть автоматически через Entity.
4. **Gallery / Timeline / Map views** — нет (только 6 классических представлений).
5. **Bi-directional embed** (блок документа = rich-cell в таблице, синхронизация в обе стороны) — у них только односторонний widget.
6. **Real-time co-editing с CRDT** (mention'ы, курсоры, presence) — не подсвечено в коммуникации.
7. **Permissions на ячейки/колонки/строки** — не детализировано (общая модель прав уровня статьи/пространства).
8. **API + webhooks** для интеграций — не упомянуто.

## Принятые архитектурные решения

| # | Решение | Обоснование |
|---|---|---|
| **A1** | **Хранение строк** — `cells JSONB` (одна колонка JSON с map property→value), GIN-индекс для фильтра. **Не нормализованная таблица per-Table.** | Стандартный паттерн для динамических схем (так делают Notion, ClickUp, Linear). Нормализация на 1000 таблиц = 1000 CREATE TABLE в проде = ад. JSONB + GIN — 200мс на 1M строк по простым фильтрам, хватает. |
| **A2** | **Real-time co-editing** — **Yjs** (CRDT) + `y-websocket` поверх нашего Redis pub/sub. **Не LiveKit data-channels** (это для медиа-room, не для длинных таблиц). | Yjs — индустриальный стандарт, есть `y-prosemirror` (для редактора в карточке строки) и `y-array` (для строк таблицы). Apache 2.0. Bus-factor высокий. |
| **A3** | **Frontend grid** — **Glide Data Grid** ([github.com/glideapps/glide-data-grid](https://github.com/glideapps/glide-data-grid), MIT). | Canvas-based, виртуализация миллионов строк, поддержка кастомных типов ячеек. Notion-clone'ы (NocoBase, AppFlowy, Outerbase) выбрали именно его. Tanstack Table — DOM-based, тормозит на 10k+ строк. AG Grid — community-версия урезана, enterprise платный. |
| **A4** | **Frontend для других views** (kanban/calendar/gantt/gallery/timeline/form) — **своя реализация на dnd-kit + Tanstack Virtual**. | Готовой open-source библиотеки «6 views в одном» нет. Каждый view — отдельный React-компонент, общий store через Zustand. |
| **A5** | **Каждая строка опционально привязана к Entity графа** (`TableRow.entityId String?`). | Это наш главный отличитель от Teamly. Таблица «Клиенты» → каждая строка автоматически создаёт/связывается с `Entity{type:'org'}`, и потом во встречах/документах эта Org находится в графе. Опционально, чтобы не ломать «таблицу-калькулятор», где Entity не нужны. |
| **A6** | **Backend модуль** — `backend/src/modules/tables/`. CRUD контроллеры + сервис + один воркер `table-automation.worker` для триггеров. | По образцу `documents/`. Не размазывать по knowledge-core — таблицы это самостоятельная подсистема. |
| **A7** | **AI-функции внутри таблиц** — через существующий `LLMRouter` + новые prompt-keys (`table.extract-rows`, `table.auto-fill`, `table.generate-column`, `table.semantic-filter`). Cache-friendly промпты. | feedback_llm_prompts_cache_friendly. |
| **A8** | **Embed таблицы в документ + bi-directional** — отдельная Phase 9. Через ProseMirror node-type `tableEmbed{tableId, viewId}`, ре-рендерится из live-API. | Это наш ключевой нарратив «всё связано», нельзя откладывать в безграничное «потом». |
| **A9** | **MVP-границы первой волны (Фазы 0-4):** Grid + Карточка строки + Сохраняемые срезы + Канбан + Excel-импорт. После этого — паритет минимум с Teamly. | Чтобы было что показать клиенту в течение месяца, не ждать всех 15 фаз. |
| **A10** | **В Z один тариф — никаких free/paid/enterprise-веток в коде.** Лимиты (`TABLE_MAX_*`) — единые для всех Org, технический guard от злоупотребления. Если в будущем появятся тарифы — добавим в `entitlements`-модуль, **не** размазывать тарифные проверки по `tables`-модулю. | Решение владельца 2026-05-31 |
| **A11** | **OCR — только локальный** (RapidOCR + Tesseract из ТЗ document-ingest). **Внешний платный API в Z один — LLM** (DeepSeek через `proxy.agent-lia.ru`). Никаких Yandex Vision / SberCloud / AWS Textract в коде Smart Tables. | Решение владельца 2026-05-31 |

## Архитектура data-model

```prisma
model Table {
  id            String      @id @default(cuid())
  tenantId      String
  name          String      @db.VarChar(255)
  description   String?     @db.Text
  icon          String?     @db.VarChar(50)     // эмодзи или ID лукапа
  coverImageS3  String?     @db.VarChar(500)
  /// Если таблица «живёт внутри документа» — ссылка на parent.
  parentDocumentId String?
  /// Если строки таблицы автоматически создают/линкуются с Entity.
  /// Например {type:'org', autoCreate:true} → таблица «Клиенты» = база Org в графе.
  entitySync    Json?       // { type: 'org'|'person'|..., autoCreate: bool, primaryProperty: string }
  defaultViewId String?
  /// Soft-delete.
  archivedAt    DateTime?
  createdBy     String
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  deletedAt     DateTime?

  org           Org              @relation(...)
  properties    TableProperty[]
  rows          TableRow[]
  views         TableView[]
  automations   TableAutomation[]
  @@index([tenantId, archivedAt])
  @@index([parentDocumentId])
}

model TableProperty {
  id          String         @id @default(cuid())
  tableId     String
  name        String         @db.VarChar(100)
  type        TablePropType
  config      Json           // тип-специфичный конфиг (см. ниже)
  isPrimary   Boolean        @default(false)  // primary колонка (как Title в Notion)
  order       Decimal        @db.Decimal(20,10) // фракционная сортировка (без перенумерации)
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  table       Table          @relation(fields:[tableId], references:[id], onDelete: Cascade)
  @@index([tableId, order])
}

enum TablePropType {
  text
  longtext       // multi-line, mini-document с ProseMirror
  number
  currency       // config: { currency: 'RUB'|'USD'|... }
  percent
  date           // config: { withTime: bool }
  status         // config: { options: [{id, name, color}] }
  selectSingle
  selectMulti
  checkbox
  person         // ссылка на User в Org
  url
  email
  phone
  file           // S3-attachment
  formula        // config: { expression: '...' }
  relation       // config: { relatedTableId, displayPropertyId }
  rollup         // config: { relationPropertyId, targetPropertyId, aggregator }
  createdAt
  updatedAt
  createdBy
  // Z-специфичные:
  entityLink     // линка на Entity графа любого type
  meetingLink    // линка на Meeting
  documentLink   // линка на Document
}

model TableRow {
  id          String     @id @default(cuid())
  tableId     String
  tenantId    String
  /// cells: { [propertyId]: value }. Value — JSON-serializable: string/number/array/etc.
  cells       Json
  /// Если таблица настроена на entitySync — авто-линка с Entity графа.
  entityId    String?
  order       Decimal    @db.Decimal(20,10)
  archivedAt  DateTime?
  createdBy   String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?
  table       Table      @relation(fields:[tableId], references:[id], onDelete: Cascade)
  /// Для embedded mini-document внутри карточки строки.
  pageContent Json?      // ProseMirror doc JSON
  @@index([tableId, order])
  @@index([tableId, archivedAt])
  @@index([entityId])
}

// GIN-индекс для фильтра по cells создаётся через postgres-init.sql:
//   CREATE INDEX table_row_cells_gin ON "TableRow" USING GIN (cells jsonb_path_ops);

model TableView {
  id          String       @id @default(cuid())
  tableId     String
  name        String       @db.VarChar(100)
  type        TableViewType
  /// config: { filters, sorts, groupBy, hiddenProps, propOrder, cardCover, ... }
  config      Json
  /// Принадлежность: персональный view (только создатель) или Org-shared.
  visibility  TableViewVisibility @default(personal)
  ownerId     String
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  @@index([tableId])
}

enum TableViewType {
  grid
  kanban
  calendar
  gantt
  gallery       // картоки с обложкой — у Teamly нет
  timeline      // хронологическая лента — у Teamly нет
  map           // карта по адресу/координатам — у Teamly нет
  form          // публичная форма-собиратель
  chart         // диаграмма
}

enum TableViewVisibility { personal shared public }

model TableAutomation {
  id          String   @id @default(cuid())
  tableId     String
  name        String   @db.VarChar(100)
  /// trigger: { kind:'property_change'|'row_created'|'row_deleted'|'cron', config: {...} }
  trigger     Json
  /// actions: [{ kind:'send_notification'|'update_property'|'create_row'|'webhook', config: {...} }]
  actions     Json
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Фазы реализации

### Фаза 0. Скаффолд модуля + базовая модель данных

- Prisma-модели выше через `bun run prisma:push`.
- `backend/src/modules/tables/tables.module.ts` с контроллером и сервисом.
- RBAC ресурс `table` в `policy.csv` (read/write/delete по уровням как у `document`).
- Базовый CRUD: `POST/GET/PATCH/DELETE /api/v1/tables`.
- `TableProperty` и `TableRow` — отдельные эндпоинты-resource'ы.
- GIN-индекс на `TableRow.cells` через `backend/scripts/postgres-init.sql`.
- ENV (единые для всех Org, тарифа в Z один):
  - `TABLE_MAX_ROWS_PER_TABLE=100000`
  - `TABLE_MAX_PROPS_PER_TABLE=200`
  - `TABLE_MAX_TABLES_PER_ORG=1000`
  - `TABLE_MAX_CELL_SIZE_BYTES=1048576` (1 MiB на ячейку, защита от вставки гигантских JSON).
  - При превышении — HTTP 400 с человекочитаемым сообщением. Не валим запрос техническим stacktrace.

**DoD:** через `curl` создаётся таблица, добавляются колонки, добавляются строки, всё лежит в БД. Swagger покрыт. Integration-тест на CRUD.

---

### Фаза 1. Frontend Grid-view с базовыми колонками

- Маршрут `frontend/app/(authenticated)/tables/[id]/page.tsx`.
- Зависимости: `@glideapps/glide-data-grid`, `zustand`, `@tanstack/react-virtual`.
- Поддержанные типы в первой волне: `text`, `longtext` (короткий inline), `number`, `currency`, `percent`, `date`, `status`, `selectSingle`, `selectMulti`, `checkbox`, `person`, `url`, `email`, `phone`, `createdAt`, `updatedAt`, `createdBy`.
- Inline-редактирование, drag&drop колонок и строк (через фракционный `order`), массовое выделение, copy/paste из Excel в grid.
- Добавление колонки через UI с выбором типа и редактором config'а.

**DoD:** на странице можно создать таблицу «Клиенты» с 10 колонками 5 типов, добавить 100 строк, редактировать ячейки, добавлять/переставлять колонки.

---

### Фаза 2. Карточка строки = мини-документ

- Клик на строку открывает modal/side-panel с **полноценным редактором ProseMirror** (тем же, что в документах проекта tracker).
- Поля сверху: все property'и таблицы, ниже — `pageContent` (rich text), затем comments, затем activity-журнал (audit-лог изменений).
- Обложка (cover image из S3) и эмодзи как иконка.
- Comments — переиспользовать модуль `comments` если есть, иначе minimal.

**DoD:** строка таблицы открывается как «мини-страница» с rich-text внутри. Текст сохраняется в `TableRow.pageContent`. Сравнимо с Teamly.

---

### Фаза 3. Сохраняемые срезы (saved views) — киллер-фича Teamly Spring 2026

- В `TableView` — `config: { filters, sorts, groupBy, hiddenProps, propOrder, rowHeight, ... }`.
- UI: dropdown «Виды» в шапке таблицы, кнопка «Сохранить как новый вид», переключатель grid/kanban/calendar/etc.
- Visibility: personal (только я) / shared (вся Org) / public (по ссылке с токеном).
- Каждый view имеет URL `/tables/:id?view=:viewId` — шарится напрямую.

**DoD:** пользователь A создаёт срез «Активные клиенты» с фильтром по статусу. Открывает по URL — фильтр сразу применён. Делится с пользователем B — у B тот же срез.

---

### Фаза 4. Канбан-view (паритет с Teamly базовый)

- Колонки канбана = значения single-select колонки (выбирается в config view).
- Drag&drop карточки между колонками = обновление property'и.
- На карточке отображаются 3-4 настраиваемых поля + обложка.
- Сборка через dnd-kit.

**DoD:** «Канбан задач» работает: drag меняет статус в БД, всё это видят остальные через polling/SSE (real-time оставляем на Phase 10).

---

### Фаза 5. Excel-импорт со schema-инференсом — киллер vs Teamly

Связан с Фазой 3 ТЗ document-ingest (там тоже tabular-pipeline, но в графе знаний). Здесь — конкретно создание Smart Table из Excel:

- `POST /api/v1/tables/import` (multipart, file).
- DCS-микросервис (см. document-ingest) парсит XLSX → возвращает `tables: [{sheetName, headers, rows}]`.
- **Schema-inference через LLM** (один cache-friendly вызов на весь файл):
  - SYSTEM: стабильная инструкция «по заголовкам и образцам строк определи тип каждой колонки».
  - USER: `{headers}` + 5 sample-rows.
  - Output: для каждого header — рекомендованный `TablePropType` + config (например, «Дата» → `date{withTime:false}`, «Email» → `email`, «Статус» → `status{options:['Активный','Завершён']}` извлечённые из уникальных значений).
- Пользователь видит preview таблицы с автоматически распознанными типами, может поправить, нажимает «Создать».
- Создаётся `Table` + `TableProperty`-и + bulk `TableRow`'ы.

**DoD:** XLSX с 5 листами, 1000 строк, 10 колонок (включая даты, статусы, валюту) → за один drag&drop создаются 5 готовых Smart Tables. У Teamly такого нет.

---

### Фаза 6. Календарь / Гантт / Gallery / Timeline / Map views

Паритет с Teamly + три бонусных view (Gallery/Timeline/Map), которых у них нет.

- **Calendar**: month/week, события размещаются по date-property. Drag меняет дату.
- **Gantt**: start-date + end-date properties + опц. dependency-relation. Используем `frappe-gantt` или `dhx-gantt-community`.
- **Gallery**: карточки с обложкой (`coverImageS3` строки), responsive grid.
- **Timeline**: хронологическая лента, события по date-property — для «истории компании», «релизов продукта».
- **Map**: pin'ы по `address` или `geo` property — для «офисов клиентов», «командировок».

**DoD:** все 5 views переключаются для одной таблицы, у каждого свой config (например, у map'а — колонка с адресом, у gallery — колонка с обложкой).

---

### Фаза 7. Relation + Rollup + Formula

Notion-database-паритет:

- **Relation**: `config:{relatedTableId, displayPropertyId}`. UI — multi-select из строк связанной таблицы. В БД хранится массив `rowId`'ов.
- **Rollup**: `config:{relationPropertyId, targetPropertyId, aggregator: 'sum'|'count'|'avg'|'min'|'max'|'concat'|'unique'|'percent_empty'}`. Вычисляется при чтении (или кешируется отдельной таблицей `TableRowRollupCache` при больших размерах).
- **Formula**: `config:{expression}`. Используем библиотеку `mathjs` (MIT) + safe-eval с whitelist'ом property-имён. Вычисляется на стороне backend в `compute-cells` middleware, не доверяем фронту.

**DoD:** в таблице «Заказы» есть relation «клиент → Клиенты», rollup «всего заказов у клиента» и formula «маржа = выручка - себестоимость». Всё пересчитывается при изменении.

---

### Фаза 8. AI внутри таблиц — наша главная киллер-фича

Пять AI-эндпоинтов под единый `POST /api/v1/tables/:id/ai/...`. Все cache-friendly (SYSTEM стабильный, USER переменный):

#### 8.1. Extract rows from source — «достать строки из источника»

Юзкейс: «У меня транскрипт встречи, в нём 12 принятых решений. Создай мне 12 строк в таблице Решений».

- Endpoint: `POST /api/v1/tables/:id/ai/extract-rows { sourceType: 'meeting'|'document'|'transcript', sourceId, instruction? }`.
- Worker подтягивает текст источника (Meeting transcript, Document parsedText, etc), вызывает LLM с промптом «извлеки сущности типа `<table.entitySync.type>` или строки с колонками `<headers>`, верни JSON-array».
- Превью пользователю → confirm → bulk insert.

#### 8.2. Summarize selection — «саммари по выделенным строкам»

Юзкейс: «У меня 50 строк в таблице обращений клиентов, дай саммари главных тем».

- `POST /api/v1/tables/:id/ai/summarize { rowIds[] }`.
- Возвращает markdown-сводку.

#### 8.3. Semantic filter — «семантический фильтр», эта фича невозможна у Teamly

Юзкейс: «Покажи клиентов с негативным фидбеком за квартал», «найди вакансии для людей с опытом NestJS».

- На каждой `text`/`longtext` колонке опционально включается embedding (генерируется при вставке, хранится в отдельной `TableRowEmbedding` таблице с pgvector).
- `POST /api/v1/tables/:id/ai/semantic-search { query, propertyId, limit }` → cosine-search через HNSW-индекс.
- В UI: над фильтрами кнопка «🔍 AI-поиск», поле для query на естественном языке.

#### 8.4. Auto-fill — «дозаполни пустые ячейки»

Юзкейс: «Колонка ИНН пустая, у тебя есть названия компаний — дозаполни через ИНН-lookup или через web-search».

- `POST /api/v1/tables/:id/ai/auto-fill { propertyId, rowIds[]? }`.
- LLM получает контекст других заполненных колонок строки + задачу «дозаполни property X».
- Поддержка tool-use: ИНН-lookup из существующего модуля Z (см. ТЗ `2026-05-25-inn-lookup-tz.md`), web-search через scraper-sidecar.
- Превью → confirm → bulk update.

#### 8.5. Generate column — «сгенерируй новую колонку из существующих»

Юзкейс: «Добавь колонку «уровень риска» — для каждой строки оцени риск по описанию проекта».

- `POST /api/v1/tables/:id/ai/generate-column { newPropertyType, instruction, sampleRowIds? }`.
- LLM сначала смотрит 3 sample-строки, предлагает тип колонки и пример вывода, пользователь подтверждает, дальше bulk-generate.

**DoD фазы 8:** все 5 AI-эндпоинтов работают, метрики `table_ai_request_total{kind}`, `table_ai_llm_tokens_total{kind}` собираются. Snapshot-тесты на промпты.

---

### Фаза 9. Embed таблицы в документ + bi-directional

- В ProseMirror-редакторе (документы проекта tracker) — новый node `tableEmbed{tableId, viewId?}`.
- Рендер: lightweight iframe-less компонент, ре-рендерится из live-API таблицы.
- **Bi-directional embed** (наше преимущество): обратное — блок документа можно превратить в строку таблицы (например, выделить параграф из встречи → «добавить в таблицу решений»). При изменении в одном — обновление в другом через event-bus.

**DoD:** в карточке проекта можно сделать `/table` slash-command → embed готовой таблицы. Изменения в таблице мгновенно отражаются в документе. И наоборот.

---

### Фаза 10. Real-time co-editing через Yjs

- Поднимаем `y-websocket`-сервер: либо как отдельный sidecar, либо как часть `workers/main.ts` через `@hocuspocus/server`.
- Frontend: `y-prosemirror` для редактора в карточке строки, `y-array` для самой таблицы (строки), `y-map` для cells одной строки.
- Presence: курсоры, кто что редактирует.
- Persistence: snapshots раз в N секунд в `TableRow.cells` через хук на y-update; full state в Redis для быстрого reconnect.

**DoD:** два пользователя одновременно редактируют разные ячейки одной строки — оба видят изменения друг друга мгновенно, без конфликтов.

---

### Фаза 11. Permissions на ячейки / колонки / строки

У Teamly не детализировано — наше преимущество.

- На уровне `TableProperty` — `permissions: { read: 'all'|'role-*'|'user-*', write: ... }`. Например, колонка «Зарплата» — read только HR.
- На уровне `TableRow` — `ownerId` + `sharedWith[]` (если row помечена «приватная»).
- На уровне ячейки — конфигурируется через formula-like правило, например: «строка видна только если `assignee = currentUser`».
- RBAC-чек в Backend в `TableRowGuard` и в Frontend в маске недоступных полей.

**DoD:** в таблице «Зарплаты» рядовой сотрудник видит только свою строку, HR — все, CEO — все + статистику.

---

### Фаза 12. Conditional formatting + Automations

- **Conditional formatting**: `config.conditionalFormat: [{when: {property, op, value}, then: {bgColor, textColor, icon}}]`. Хранится в View, не в Property — может быть разным для разных видов.
- **Automations** — модель `TableAutomation` (выше). Воркер `table-automation.worker` слушает `table.row.changed` события из BullMQ, проверяет триггеры, выполняет actions.
- Готовые actions: уведомление в чат-канал Z, обновление другого property, создание Issue в трекере, webhook.

**DoD:** автоматизация «когда статус задачи → Done, отправь уведомление автору» работает end-to-end.

---

### Фаза 13. API + webhooks

- REST для всех CRUD-операций — уже есть.
- Webhook: `TableAutomation.action.kind='webhook'` отправляет HMAC-подписанный POST на URL.
- API-key для внешних интеграций: новый ресурс `ApiKey` со scope «tables-read», «tables-write» — даёт доступ без cookie-auth.
- OpenAPI-схема в Swagger.

**DoD:** через POST/curl с api-key можно создать строку в таблице. Внешний Zapier/n8n-workflow может слушать webhook.

---

### Фаза 14. Forms-view (публичная форма-собиратель)

Паритет с Teamly Forms:

- В TableView типа `form`: config `{visibleProps, requiredProps, theme, submitText}`.
- Публичный URL `/forms/:viewId` без авторизации.
- Submission создаёт `TableRow` со специальной меткой `createdVia: 'form'`.
- Защита: rate-limit, hCaptcha опционально.

**DoD:** форма «Заявка на демо» публикуется на `/forms/abc123`, заявки автоматически попадают в таблицу.

---

## Общий DoD ТЗ

- [ ] Все 15 фаз закрыты или явно отмечены «not-now» с причиной.
- [ ] Все новые модели через `bun run prisma:push`, никаких migrate.
- [ ] GIN-индекс на cells применяется через `postgres-init.sql` (Шаг 5 prod-deploy-log).
- [ ] Все новые ENV — в `env.schema.ts` (Шаг 1 prod-deploy-log).
- [ ] Все воркеры/очереди — Шаг 12 prod-deploy-log.
- [ ] `second-brain/01_projects/smart-tables.md` — новый файл с описанием подсистемы.
- [ ] `second-brain/02_architecture/module-map.md` — добавлен модуль `tables`.
- [ ] Метрики Prometheus + панель Grafana «Smart Tables usage» (создания таблиц, строк, AI-вызовов).

## Бизнес-приоритет фаз

**Волна 1 — MVP за месяц (паритет минимум):**
1. Фаза 0 — каркас.
2. Фаза 1 — Grid.
3. Фаза 2 — карточка-документ.
4. Фаза 3 — сохраняемые срезы.
5. Фаза 4 — Канбан.
6. Фаза 5 — Excel-импорт (это объективное преимущество над Teamly уже на MVP).

После волны 1 — можно показывать клиенту: «у нас то же, что в Teamly, плюс Excel-импорт с AI-распознаванием схемы».

**Волна 2 — догоняем полный паритет (+ месяц):**
7. Фаза 6 — Calendar/Gantt/Gallery/Timeline/Map (Gallery/Timeline/Map — уже плюс к Teamly).
8. Фаза 7 — relation+rollup+formula.
9. Фаза 12 — conditional formatting + automations.

После волны 2 — полный паритет.

**Волна 3 — наши киллер-фичи (+ месяц):**
10. Фаза 8 — AI внутри таблиц (5 функций). **Главный продаваемый отличитель.**
11. Фаза 9 — bi-directional embed таблицы ↔ документа.
12. Фаза 10 — real-time co-editing.

После волны 3 — мы объективно лучше Teamly.

**Волна 4 — добивка:**
13. Фаза 11 — granular permissions.
14. Фаза 13 — API + webhooks.
15. Фаза 14 — Forms.

## Закрытые решения владельца (2026-05-31, перед стартом разработки)

Эти пункты были открытыми вопросами в первой версии ТЗ. Зафиксированы и закрыты — у разработчика **нет развилок**, реализуем строго так:

1. **Real-time сервер (Фаза 10):** **встроить `@hocuspocus/server` в существующий процесс `workers/main.ts`**. Не отдельный sidecar. Меньше движущихся частей.
2. **Релиз волны 1:** **закрытая бета 1 неделю** на 5 компаний из demo-cabinet'а → фикс багов → публичный анонс.
3. **Тарифы:** **в Z один тариф**, никаких free/paid/enterprise-веток. Smart Tables — часть единственной подписки.
4. **Импорт:** в Фазе 5 поддерживаем **XLSX/CSV + Notion JSON-export**. Teamly не импортируем (у них нет публичного API на 2026-05-31).
5. **Лимиты — технический guard от злоупотребления, не продажная воронка:**
   - `TABLE_MAX_ROWS_PER_TABLE = 100_000` — единый для всех Org.
   - `TABLE_MAX_PROPS_PER_TABLE = 200` — единый.
   - `TABLE_MAX_TABLES_PER_ORG = 1_000` — единый.
   - При попытке превысить — HTTP 400 с человекочитаемым сообщением «Превышен технический лимит N строк. Если нужно больше — напишите в поддержку.».
   - Лимиты вынесены в ENV (`TABLE_MAX_*` в `env.schema.ts`), чтобы поднять без передеплоя кода.

## Чем мы будем лучше Teamly (одной фразой)

**Teamly даёт таблицы как «российский Notion-database в wiki».** Z даёт **«AI-таблицы, каждая строка которых уже находится в графе знаний компании»** — XLSX импорт со schema-inference из коробки, семантический поиск через pgvector, генерация строк из транскриптов встреч, bi-directional embed таблицы ↔ документа, real-time CRDT-co-editing, granular permissions на ячейки. Полный паритет по «классическим» фичам (6 представлений, relation+rollup+formula, сохраняемые срезы, embed в статью) + 5 объективных преимуществ.

## Итог ТЗ

Реализовано: **0/15 фаз**. ТЗ согласовано, развилок нет, можно стартовать.

Связь с [ТЗ document-ingest](2026-05-31-document-ingest-universal.md): Фаза 5 (Excel-импорт) использует DCS-микросервис из document-ingest (его Фаза 1). Поэтому **document-ingest Фаза 1 должна быть готова до старта smart-tables Фазы 5**. Все остальные фазы smart-tables (0-4, 6-14) — независимы и могут идти параллельно с разработкой document-ingest.

## Чек-лист «передал агенту-разработчику»

- [ ] Агент прочитал это ТЗ полностью.
- [ ] Агент прочитал связанный [research-документ](../analysis/2026-05-31-document-conversion-stack.md).
- [ ] Агент прочитал [CLAUDE.md](../../CLAUDE.md) и skill'ы `core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`.
- [ ] Агент стартует с **Фазы 0** (скаффолд модуля + Prisma-модели). Не прыгает сразу в Фазу 8 (AI), даже если кажется интересным.
- [ ] Каждая фаза — отдельный PR с прохождением через `bun run typecheck`, `bun run lint`, `bun run test:unit` + relevant `test:integration`.
- [ ] После каждого закрытого PR — рефлексия в `second-brain/05_история/2026-MM-DD-smart-tables-phase-N.md`.
- [ ] Если возникает развилка, которой нет в ТЗ — **не принимать решение «по-своему»**, написать вопрос владельцу в issue.

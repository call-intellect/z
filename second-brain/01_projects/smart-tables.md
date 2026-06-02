---
name: smart-tables
title: Умные таблицы (Smart Tables) — MVP-старт
status_overall: partial
last_audited: 2026-06-02
related_plans:
  - plans/tz/2026-05-31-smart-tables.md
  - plans/tz/2026-06-02-smart-tables-auto-creation.md
related_processes: []
related_projects:
  - 01_projects/api-layer.md
  - 02_architecture/data-model.md
  - 02_architecture/module-map.md
---

# Умные таблицы (Smart Tables)

## Зачем

Конкурентный паритет с Teamly Spring 2026 («Умные таблицы» как «российский Notion-database») + 5 наших преимуществ (AI внутри, Excel-импорт со схема-инференсом, связь со графом знаний, bi-directional embed, granular permissions). ТЗ полный: [plans/tz/2026-05-31-smart-tables.md](../../plans/tz/2026-05-31-smart-tables.md).

## Что сделано (Волна 3, MVP-старт 2026-05-31, Фазы 0+1+2+3)

### Backend (Фаза 0)

- **5 Prisma-моделей** в `backend/prisma/schema.prisma` (~строка 9579): `Table`, `TableProperty`, `TableRow`, `TableView`, `TableAutomation` + обратная relation `Org.tables`.
- **3 enum'а**: `TablePropType` (24 значения), `TableViewType` (9), `TableViewVisibility` (3).
- **GIN-индекс** `table_row_cells_gin` на `TableRow.cells jsonb_path_ops` — `backend/scripts/postgres-init.sql`.
- **4 ENV-лимита** (единые для всех Org — тариф в Z один):
  - `TABLE_MAX_ROWS_PER_TABLE=100_000`
  - `TABLE_MAX_PROPS_PER_TABLE=200`
  - `TABLE_MAX_TABLES_PER_ORG=1_000`
  - `TABLE_MAX_CELL_SIZE_BYTES=1_048_576`
- **Модуль `backend/src/modules/tables/`** с 3 контроллерами и 3 сервисами:
  - `TablesController` (`/api/v1/tables`) — 7 эндпоинтов (CRUD + archive/unarchive + hard-delete).
  - `TablePropertiesController` (`/api/v1/tables/:tableId/properties`) — 5 эндпоинтов.
  - `TableRowsController` (`/api/v1/tables/:tableId/rows`) — 7 эндпоинтов.
- **RBAC**: ресурс `table` в `policy.csv` (9 строк: owner/admin/manager r/w/d, manager — self-scope на write/delete).
- Все эндпоинты под `CookieAuthGuard + TenantGuard`, лимиты через `TypedConfigService.smartTables.*` (никаких `process.env`).
- **Soft-delete**: `archivedAt` (архив, обратимо), `hardDelete` разрешён только после архивации.
- **19 unit-тестов** (`tables.service.spec.ts`, `table-properties.service.spec.ts`, `table-rows.service.spec.ts`) — passed.
- **Integration-spec** `backend/test/integration/tables.e2e.spec.ts` — `it.skip` с TODO (dev Postgres офлайн, требует testcontainers).

### Frontend (Фаза 1)

- Маршрут `/tables/[id]` — server component `page.tsx` + client `TableClient.tsx`.
- **Зависимости** (новые): `@glideapps/glide-data-grid@^6.0.3`, `@tanstack/react-virtual@^3.13.26` (зарезервирован для будущих view), `zustand@^5.0.14`.
- **Glide Data Grid** (Canvas) подключён через `next/dynamic({ ssr: false })` — обязательно из-за Canvas API.
- **Слои**: `ApiDto` (`frontend/src/api/types/tables.ts`) → `DomainModel` (`frontend/src/domain/table.ts`) → UI (`/tables/[id]/`).
- **Zustand store** `tableStore.ts` с optimistic updates + debounce 500мс на cell-edit (`updateRow` PATCH).
- **17 поддержанных типов** (Фаза 1):
  - 14 интерактивных: text, longtext (inline), number, currency, percent, date, status (Bubble, display-only — overlay-edit в Фазе 2), selectSingle, selectMulti, checkbox, person, url, email, phone.
  - 3 computed read-only: createdAt, updatedAt, createdBy.
- **7 типов в whitelist'е "не поддерживается в Фазе 1"**: file, formula, relation, rollup, entityLink, meetingLink, documentLink — показывают «Тип пока не поддерживается», тихо игнорируются на edit.
- **Drag&drop колонок и строк** через фракционный `order` (Decimal(20,10)).
- **Copy/paste из Excel** — встроенный clipboard handling Glide через `onPaste` + `getCellsForSelection`.
- **Add column UI** — popover `AddColumnButton` + `ColumnTypeSelector` с 14 кнопками типов и lucide-иконками.
- **Парные цветовые токены** — никаких `text-white`. Status colors через mapping `bg-{color}-100/text-{color}-900`.
- Все UI-копи на русском (память `feedback_admin_ui_russian_only`).

### Frontend (Фаза 2 — карточка строки = мини-документ)

- Клик на маркер строки (column -1) в Grid → открывается `RowDetail` Sheet справа (640px desktop, fullscreen mobile).
- В шапке Sheet: заголовок из `isPrimary`-property, метки created/updated, кнопка X.
- Список 14 интерактивных property'ей в формате `[140px_1fr]` с inline-редактированием (text/longtext/number/currency/percent/url/email/phone/checkbox). Read-only display для status/select/person/date. Заглушка «Тип пока не поддерживается» для file/formula/etc.
- Под property'ями — секция «Содержимое»: **Tiptap-editor** (`@tiptap/react@3.24` + `StarterKit` + `Link`, `immediatelyRender: false` для React 19 SSR) с mini-toolbar (B/I/S/H1/H2/list/numbered/blockquote/link, lucide-иконки). Сохранение через `store.updatePageContent(rowId, json)` → debounce 500мс → PATCH `pageContent` в `/rows/:rowId`.
- Заглушки `Комментарии — Скоро будет в Фазе 2+` и `История изменений — в разработке`.
- Новые зависимости фронта: `@tiptap/react@3.24.0`, `@tiptap/starter-kit@3.24.0`, `@tiptap/extension-link@3.24.0` (+188 transitive).

### Backend (Фаза 3 — сохраняемые срезы)

- `TableViewsController` (`/api/v1/tables/:tableId/views`) — **5 эндпоинтов** CRUD (list, getById, create, update, delete).
- `TableViewsService` с visibility-фильтром: пользователь видит personal только свои + все shared/public; owner-or-admin guard на update/delete.
- 6 unit-тестов (create-mine, list-visible, list-hides-other-personal, findById-чужой-personal, update-own, update-other-forbidden).

### Frontend (Фаза 3 — сохраняемые срезы)

- Маршрут с URL state: `/tables/:id?view=:viewId` через `useSearchParams`.
- `ViewSelector` в шапке таблицы: dropdown «Виды» (список SWR), dropdown «Колонки» (видимость + плотность compact/default/tall), кнопки «Сохранить вид» / «×».
- `SaveViewDialog`: input «Название» + radio «Только мне» / «Всей команде» / «Публичная ссылка».
- Store расширения: `views[]`, `currentView`, `draftConfig`, `hasUnsavedChanges`, методы `setViews/applyView/setHiddenProperty/setDraftPropOrder/setRowHeight/saveCurrentAsView/saveChangesToCurrentView/deleteView`, селекторы `selectVisibleProperties/selectVisibleRows/selectRowHeightPx`.
- TableClient использует селекторы для рендера → колонки скрываются/появляются мгновенно по applyView.
- `GridView` принимает `rowHeight?: number` и пробрасывает в `DataEditor.rowHeight` (compact 24, default 34, tall 48).
- Минимально реализовано: **hiddenProps + propOrder + rowHeight**. Sorts — реализован в селекторе, но без UI-крутилки. Filters/groupBy — структуры поддержаны, UI не добавлен (Фаза 4+).

## Что НЕ сделано (явно отложено — отдельные сессии)

- **Фаза 4**: Канбан view (через dnd-kit).
- **Фаза 5**: Excel-импорт со schema-инференсом через LLM (зависит от document-ingest Фазы 1).
- **Фаза 6**: Calendar / Gantt / Gallery / Timeline / Map views.
- **Фаза 7**: relation + rollup + formula (mathjs + safe-eval).
- **Фаза 8**: AI внутри таблиц (5 эндпоинтов: extract-rows, summarize, semantic-filter, auto-fill, generate-column).
- **Фаза 9**: bi-directional embed таблицы ↔ документа.
- **Фаза 10**: real-time co-editing через Yjs + `@hocuspocus/server` в `workers/main.ts`.
- **Фаза 11**: granular permissions (cell/column/row).
- **Фаза 12**: conditional formatting + automations.
- **Фаза 13**: API + webhooks.
- **Фаза 14**: Forms-view.

## Известные ограничения Фаз 1-3

- **Bubble cells (status/selectSingle/selectMulti) не редактируются inline** — Glide Data Grid Bubble не входит в `EditableGridCell`. В Grid view — display-only с пометкой в коде. В `RowDetail` карточке (Фаза 2) — read-only display. Кастомный popover-редактор поверх Bubble — отдельная задача.
- **Permissions на уровне таблицы** — только owner/admin/manager через `policy.csv`. Cell/column/row permissions — Фаза 11.
- **Bulk delete колонок/строк не реализован** — только через единичные действия. Header-context-menu — Фаза 2+.
- **Real-time через polling** (SWR), не Yjs — Фаза 10.
- **`/tables` (list-страница)** не реализована — пока только `/tables/[id]`. Создание новой таблицы — через CRUD API напрямую (POST /api/v1/tables) или будет добавлен отдельной задачей.

- **Drag&drop колонок vs view-local propOrder (Фаза 3)** — текущий `reorderColumn` мутирует глобальный `TableProperty.order` через PATCH/reorder API. Если активен view с собственным `propOrder`, drag-and-drop может конфликтовать (глобальный order перетрётся, локальный `propOrder` останется в config'е view). На MVP допустимо. Изоляция per-view reorder — отдельная задача.

## Связи

- **`Org.tables`** — обратная relation, multi-tenant фильтр.
- **`TableRow.entityId`** — опциональная линка с `Entity` графа знаний (`entitySync` config в `Table`). MVP — поле есть, бизнес-логика синка появится в Фазе 3+.
- **`TableRow.cells`** — JSONB, GIN-индекс для быстрого фильтра (`@>`, `@?`).
- **`TableView`** + **`TableAutomation`** — модели заведены, контроллеры/сервисы в Фазе 0 не реализованы (Views CRUD — Фаза 3, Automations — Фаза 12).

## Тех-долг к закрытию

1. **Integration-тест** через testcontainers — раскрыть `it.skip` после поднятия dev Postgres + testcontainers wrapper.
2. **`apply-prod-deploy.ts STEPS`** — для Фазы 0 нет seed/patch/backfill (только Prisma push + postgres-init), регистрация не нужна. В Фазах 2+ при появлении seed-скриптов — добавить.
3. **`/tables` list-страница** — Фаза 2.
4. **Tanstack Virtual** установлен, в Фазе 1 не используется (Glide само виртуализирует). Зарезервирован для Gallery/Timeline views.

---

# Smart-tables auto-creation (ТЗ [2026-06-02](../../plans/tz/2026-06-02-smart-tables-auto-creation.md))

Продолжение базового Smart-tables: уход от ручного труда. 6 фаз (0→5) + потоки Eval/Privacy. Принцип — автоматика поверх единого графа знаний; ручным остаётся только свободный текст в карточке строки, override превью схемы и подтверждение спорных правок из встреч.

## Что сделано

### Фаза 0 — системные таблицы при создании Org (auto-provision) ✅

При создании любой новой Org автоматически заводятся **10 системных таблиц** (пустыми; наполнение — Фаза 2). Видны в `/tables` сразу, помечены 🔒. Можно архивировать/восстанавливать/менять колонки, но **нельзя удалить навсегда**.

- **Prisma `Table`**: `isSystem Boolean @default(false)`, `systemKey String?`, `@@unique([tenantId, systemKey])`, `@@index([tenantId, isSystem])`.
- **Каталог** `backend/src/modules/tables/templates/system-tables.catalog.ts` — 10 TypeScript-шаблонов (`clients_deals`, `team`, `hypotheses`, `vendors`, `risks`, `ideas`, `promises`, `content_plan`, `regulations`, `okr`), у каждого ровно одна `isPrimary`-колонка. `entitySync` проставлен только для уже поддержанных DTO-типов (`org`→clients_deals/vendors, `person`→team, `document`→regulations); остальным `null` с TODO на Фазу 2 (расширение enum + живой sync).
- **`TablesAutoProvisionService.provisionDefaults(tenantId, ownerId, tx?)`** — идемпотентен через `findFirst({tenantId, systemKey})`. Вызывается из `OrgsService.createForOwner` в той же транзакции (`OrgsModule` импортирует `TablesModule`, цикла нет).
- **`TablesService.hardDelete`** — guard: `isSystem` → `403 system_table_hard_delete_forbidden`.
- **Backfill** `backend/scripts/backfill-system-tables.ts` для существующих Org (зарегистрирован в `apply-prod-deploy.ts` STEPS, `phase: backfill`, `skipBootstrap`).
- **Фронт**: `TableApi`/`TableDomain` получили `isSystem`/`systemKey`; на карточке системной таблицы — маркер 🔒 + tooltip. (Кнопки hard-delete в UI и не было — реальная защита на backend.)
- **Тесты**: `tables-auto-provision.service.spec.ts` (идемпотентность, 10 шаблонов, валидность типов) + тест guard'а в `tables.service.spec.ts`. 12 unit-тестов зелёные; e2e-заглушка 403 — `it.skip` (нет test-Postgres).

### Фаза 1 — Text-to-Schema через Кору (Concierge) ✅ (за feature-flag, default off)

Пользователь пишет ассистенту Кора «нужна таблица клиентов» → бэк генерит схему в 3 LLM-pass'а → карточка-превью прямо в окне Concierge → правка/подтверждение → таблица создаётся.

- **3 pass'а** в `TableAgentService.inferSchemaFromText` (`backend/src/modules/tables/services/table-agent.service.ts`): DRAFT (`table-infer-schema`) → ARCHITECT (`table-architect-pass`, дедуп колонок/оптимизация типов) → ENTITY-CHECK (`table-entity-check`, сверка `entitySync` с доступными типами, иначе `null`). После pass'ов — жёсткая нормализация инвариантов (≥1 колонка, ровно одна `isPrimary`, валидные `TablePropType`).
- **Prompt-keys** (code-fallback, cache-friendly — стабильный SYSTEM с каталогом типов/системных таблиц, переменное в USER): `backend/src/modules/ai/services/prompts/table-{infer-schema,architect-pass,entity-check}.prompt.ts`. taskType primary → **DeepSeek V4 Pro** (`seed-llm-task-routes-smart-tables.ts`; code-fallback chain работает и без seed).
- **Эндпоинты**: `POST /api/v1/tables/infer-schema` (превью) и `POST /api/v1/tables/from-schema` (создание) — оба за feature-flag `feature.tables_text_to_schema` (off → `403 feature_tables_text_to_schema_disabled`). `TablePropertiesService.createMany` — bulk-вставка колонок.
- **Concierge-tool** `infer_table_schema` (read-only превью); SSE `tool_result` расширен опциональным `data` для whitelist-инструментов (`RICH_PREVIEW_TOOLS`) — полная схема доходит до фронта (обрезанный `preview` остаётся для текстовой реплики).
- **Frontend**: `TableSchemaPreview.tsx` (карточка с правкой колонок/типов/ключевой), интеграция в `ConciergeChat`, кнопка «Спросить Кору» на `/tables` (открывает Concierge через CustomEvent `concierge:open` с префиллом). `tablesApi.createFromSchema`.
- **Тесты**: `table-agent.service.spec.ts` — 5 случаев (успех, hallucinated type, no entity match, инвариант isPrimary). Все tables-тесты зелёные (34).
- **Feature-flag default off** — включается только после прохождения Eval (Фаза 1.5, ≥0.85 accuracy).

### Фаза 2 — Graph-driven rows (живой entitySync) ✅

Системная таблица автоматически содержит связанные сущности графа как строки: создаётся/обновляется/архивируется Entity → строка появляется/обновляется/уходит в архив.

- **entitySync расширен** опц. `entityTypes: EntityType[]` (точный фильтр) + дефолт-маппинг `resolveEntityTypes` (`entity-sync.util.ts`): org→[customer,vendor], person→[person], document→[document], meeting→[]. Каталог: 4 sync-таблицы получили `autoCreate:true` + точные `entityTypes` (clients_deals→customer, vendors→vendor, team→person, regulations→document).
- **Шина событий Entity** (раньше отсутствовала): `EntityResolutionService` эмитит `entity.created`/`entity.updated` (через `@Optional() EventEmitter2`, best-effort), `entity-resolver.worker` — `entity.archived` при merge. Константы в `tables/events/entity-sync.events.ts`.
- **Sync-пайплайн**: `TableSyncListener` (`@OnEvent`) → очередь `tables.sync` (`TableSyncQueueService`) → `table-sync.worker` (зарегистрирован в `ai/workers.module.ts`, in-process) → `TableSyncService.applyEntityEvent` (upsert/archive строки, заполнение entity-cells по `config.entityAttribute`). Конфликт-резолвер: ручная строка с совпадающим primary/email сливается с Entity (проставляется `entityId`), без дубля.
- **Initial backfill**: при включении `autoCreate false→true` (`TablesService.update`) → `runInitialBackfill` (≤1000 синхронно `createMany`, >1000 — батчи в очередь). Скрипт `backfill-table-entity-sync.ts` для существующих Org (в `apply-prod-deploy.ts`).
- **Read-only attribute-колонки**: `config.{readonly,source:'entity',entityAttribute}`. Backend guard в `TableRowsService.update` → `422 table_cell_readonly`. Frontend: 🔗 в заголовке + tooltip, `allowOverlay:false` (грид), нередактируемый рендер в RowDetail, грейсфул-обработка 422.
- **Тесты**: `table-sync.service.spec` (created/updated/archived/идемпотентность/конфликт-резолвер) + read-only guard. 52 backend-теста зелёные (tables 43 + entity-resolution 9).

### Фаза 3 — Event-to-Cells из транскриптов встреч ✅

После встречи агент извлекает факты из транскрипта и патчит ПУСТЫЕ ячейки sync-таблиц с audit-link на тайминг; перезапись/спорное — в очередь подтверждений.

- **Новые Prisma-модели**: `TableCellProvenance` (что/откуда/когда + `previousValue` для undo + `sourceLink` на тайминг + `confidence`) и `TableCellPendingPatch` (очередь: `proposedValue`/`currentValue`/`reason: low_confidence|overwrite`/`status`).
- **Событие** `meeting.ai_ready` (EventEmitter2, best-effort) — эмитится в `AnalyzeWorker` после перехода встречи в `ai_ready`. Ловит `TableEnrichListener` → очередь `tables.enrich` → `table-enrich.worker` (Redis-throttle `table:enrich:jobs:${tenantId}` ≤ `table.agent.max_concurrent_enrich_jobs_per_org`).
- **`TableEnrichService.enrichFromEvent`**: резолв сущностей встречи (3 уровня: граф `RawEvent→IdeaBlockEvidence→IdeaBlockEntity→Entity` по `sourceExternalId=meetingId`; `Event.relatedMeetingId`; fallback — canonicalName в транскрипте) → строки sync-таблиц по `entityId` → LLM `table-extract-rows` (DeepSeek V4 Flash) по не-readonly колонкам → факты с confidence/quote/timeSec. Пустая ячейка + conf≥`table.agent.confirmation_threshold` (0.85) → авто-патч + provenance; непустая/низкий conf → pending. Кэш-идемпотентность по `(row, property, sourceId=meetingId)`.
- **Эндпоинты**: `GET /tables/rows/:rowId/provenance`, `POST /tables/cell-provenance/:id/undo`, `GET /tables/pending-patches?tableId`, `POST /tables/pending-patches/:id/decide`.
- **AdminSettings**: `table.agent.confirmation_threshold` (0.85), `table.agent.max_concurrent_enrich_jobs_per_org` (100), `table.agent.max_daily_tokens` (1000000).
- **Concierge-уведомление** через `ProactiveNotification` (`ruleType:'table_cells_enriched'`, owner встречи): «После встречи … обновила N ячеек и подготовила M правок».
- **Frontend**: в `RowDetail` — 🔗 + popover (источник/уверенность/ссылка на встречу/«Отменить»→undo); в `TableHeader` — бейдж «🔔 Правки на подтверждении: N» → `PendingPatchesPanel` (принять/отклонить по одной или все).
- **prompt-keys**: `table-extract-rows`, `table-auto-fill` (Flash; auto-fill заведён как hook, в pipeline пока не вызывается). **Тесты**: `table-enrich.service.spec` (7: авто-патч/overwrite-pending/low-conf-pending/readonly-skip/кэш/decide/undo). 50+ tables-тестов зелёные.

### Фаза 4 — Document-to-Table (Excel/CSV) ✅

Пользователь грузит Excel/CSV на `/tables` → инференс схемы → cosine-dedup со схемами существующих таблиц → «слить» или «создать новую» → строки появляются.

- **Парсинг — in-process Node (`exceljs`)** для XLSX/CSV. Решение владельца 2026-06-02: пока остаёмся на Node, Python-микросервис DCS не поднимаем. **Долг:** структурный парсинг по-хорошему должен идти через DCS (Docling) из [document-ingest-universal ТЗ](../../plans/tz/2026-05-31-document-ingest-universal.md) — Д2; PDF/сканы/HTML/PPTX **не поддержаны** (ждут DCS). Это сознательный stopgap, не финальная архитектура.
- **`TableFileParserService.parseFileToTable`** — первый лист/таблица → `{kind, headers, rows[][]}`, потолок 50k строк, неподдерживаемый формат → `400 unsupported_file_format`.
- **`TableAgentService.inferSchemaFromTabular`** — переиспользует 3-pass pipeline Фазы 1, вход — headers+первые 20 строк; `alignToHeaders` гарантирует «колонка файла j ↔ property j». **`findSimilarTables`** — cosine (text-embedding-3-small) схемы vs существующих, порог `table.import.dedup_threshold` (0.85). **`linkRowsToEntities`** — матч строк к Entity по canonicalName/aliases (не создаёт новые).
- **`TableImportService`** — `commitCreate`/`commitMerge` (merge сопоставляет колонки по имени), приведение типов ячеек.
- **Эндпоинты**: `POST /tables/import/analyze` (multipart → схема+rows+mergeCandidates), `POST /tables/import/commit` (mode create|merge). rows — `string[][]` по индексу колонок. ENV `TABLE_IMPORT_MAX_FILE_MB` (25), `TABLE_IMPORT_MAX_ROWS` (5000). Без feature-flag.
- **Frontend**: кнопка «Из файла» на `/tables` → `ImportFromFileDialog` (drag&drop → превью схемы + блок слияния → «Слить»/«Создать новую»).
- **Тесты**: `table-file-parser.service.spec` (xlsx/csv/неподдерживаемый) + дополнения в `table-agent.service.spec` (tabular-маппинг, cosine, entity-link). 63 tables-теста зелёные.

### Фаза 5 — NL Saved Views ✅

Пользователь пишет «покажи клиентов, кому месяц никто не писал» → LLM конвертит в filter JSON → фильтр применяется → можно сохранить как вид.

- **Фильтрация впервые реализована** (до Фазы 5 её не было — `selectVisibleRows` применял только сортировки). 10 операторов: `eq/neq/gt/lt/contains/in/empty/before/after/older_than`. Применяется **клиент-сайд** в `selectVisibleRows` (`applyFilters`) — согласованно с клиентскими сортировками; серверная JSON-фильтрация (GIN) — будущая оптимизация.
- **Backend**: prompt-key `table-semantic-filter` (DeepSeek V4 Flash, cache-friendly — стабильный SYSTEM с каталогом операторов, переменное в USER). `TableSemanticFilterService.parseSemanticFilter` → Redis-кэш `table:semfilter:{tableId}:{sha1(normQuery)}` (TTL 7д) → LLM → `validateFilters` (отбор по совместимости op×TablePropType, отброс несуществующих propertyId/битых value). `POST /tables/:id/semantic-filter`. `table-filter.dto.ts` — `FILTER_OPS`, `TableFilterCondition`, `validateFilters`.
- **Frontend**: `SemanticFilterBar` (поле «Найти срез» + индикатор/сброс + «Сохранить как новый вид» через `SaveViewDialog`). `applyFilters` в `domain/table.ts` (устойчивое сравнение по типам: status/select объекты по name, даты через Date.parse, older_than от now). `tableViewsApi.semanticFilter`. Сохранённые виды с фильтрами применяются автоматически (`applyView` копирует config.filters).
- **Visibility** (personal/shared/public) у видов уже была реализована (база Smart-tables).
- **Тесты**: backend `table-semantic-filter.service.spec` (cache hit/miss, валидатор, мусор-JSON) + `validateFilters` unit — 94 tables-теста; frontend `applyFilters` — 11 тестов.

## Итог

**Все 6 фаз (0–5) ТЗ [2026-06-02-smart-tables-auto-creation](../../plans/tz/2026-06-02-smart-tables-auto-creation.md) реализованы.** Параллельные потоки: Eval (Фаза 1.5) и Privacy — после основных фаз.

## Долг / далее

- **Фаза 1.5** (блокер для включения флага `feature.tables_text_to_schema`) — Eval Text-to-Schema на 100 русских NL-промптах.
- **Поток Privacy** — research конфиденциальности до публичного GTM.
- **Долг Фазы 4:** миграция парсинга Excel/CSV на DCS (Docling) + PDF/сканы/HTML, когда поднимем document-conversion микросервис.
- **Долг Фазы 5:** серверная фильтрация по cells (GIN) для масштаба; сейчас клиент-сайд.
- **Фаза 4** — Document-to-Table (DCS, cosine-dedup, entity-linking).
- **Фаза 5** — NL Saved Views.
- Потоки: Eval Text-to-Schema (100 русских промптов, блокер для feature-flag), Privacy research (до GTM).

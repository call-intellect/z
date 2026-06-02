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

## В работе / далее

- **Фаза 1.5** (параллельно, блокер для включения флага) — Eval Text-to-Schema на 100 русских NL-промптах.
- **Фаза 2** — Graph-driven rows (живой `entitySync`): расширить enum, `table-sync.worker`, read-only attribute-колонки.
- **Фаза 3** — Event-to-Cells из транскриптов + `TableCellProvenance` + очередь подтверждений.
- **Фаза 4** — Document-to-Table (DCS, cosine-dedup, entity-linking).
- **Фаза 5** — NL Saved Views.
- Потоки: Eval Text-to-Schema (100 русских промптов, блокер для feature-flag), Privacy research (до GTM).

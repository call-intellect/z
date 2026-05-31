---
name: smart-tables
title: Умные таблицы (Smart Tables) — MVP-старт
status_overall: partial
last_audited: 2026-05-31
related_plans:
  - plans/tz/2026-05-31-smart-tables.md
related_processes: []
related_projects:
  - 01_projects/api-layer.md
  - 02_architecture/data-model.md
  - 02_architecture/module-map.md
---

# Умные таблицы (Smart Tables)

## Зачем

Конкурентный паритет с Teamly Spring 2026 («Умные таблицы» как «российский Notion-database») + 5 наших преимуществ (AI внутри, Excel-импорт со схема-инференсом, связь со графом знаний, bi-directional embed, granular permissions). ТЗ полный: [plans/tz/2026-05-31-smart-tables.md](../../plans/tz/2026-05-31-smart-tables.md).

## Что сделано (Волна 3, MVP-старт 2026-05-31, Фазы 0+1)

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

## Что НЕ сделано (явно отложено — отдельные сессии)

- **Фаза 2**: карточка строки = мини-документ (ProseMirror editor для `pageContent`, comments, audit-журнал).
- **Фаза 3**: сохраняемые срезы (`TableView` views, dropdown «Виды», personal/shared/public).
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

## Известные ограничения Фазы 1

- **Bubble cells (status/selectSingle/selectMulti) не редактируются inline** — Glide Data Grid Bubble не входит в `EditableGridCell`. В Фазе 1 — display-only с пометкой в коде. В Фазе 2 поверх Bubble добавим кастомный popover-редактор.
- **Permissions на уровне таблицы** — только owner/admin/manager через `policy.csv`. Cell/column/row permissions — Фаза 11.
- **Bulk delete колонок/строк не реализован** — только через единичные действия. Header-context-menu — Фаза 2+.
- **Real-time через polling** (SWR), не Yjs — Фаза 10.
- **`/tables` (list-страница)** не реализована — Фаза 1 только `/tables/[id]`. Создание новой таблицы — через CRUD API напрямую (POST /api/v1/tables) или будет добавлен в Фазе 2.

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

# ТЗ — Детальная страница таблиц `/tables/[id]`: чинить React #185 (рендер-петля) + 404 очереди подтверждений

> **Приоритет: 🔴 P0.** Раздел «Память компании → Таблицы» в детальном виде **полностью нерабочий** на проде: любая таблица открывается в красный экран «Не удалось загрузить страницу». Вскрыто ретестом №2 на проде ([plans/analysis/2026-06-07-retest2-RESULTS-technical.md](../analysis/2026-06-07-retest2-RESULTS-technical.md) §1.1).
> **Тип:** баг-фикс (frontend критичный + backend минорный). **Одна функция:** вернуть работоспособность детальной таблицы.
> **Связь:** добивает остаток ТЗ-1 prod-stability (webpack убрал ChunkLoadError, но обнажил этот рендер-луп).

---

## 1. Проблема (что видит пользователь)

Открытие любой детальной таблицы (`/tables/<id>`, проверены `cmpwpjeal…` «Команда» и `cmpv3sqwe…` «1» — **детерминированно**, в т.ч. после reload) → русский error-boundary «Не удалось загрузить страницу. Попробуйте обновить страницу или вернуться назад. [Обновить]». Таблица не рендерится. Кнопка «Обновить» не помогает (краш детерминированный).

Консоль: `Minified React error #185` («Maximum update depth exceeded») в `4bd1b696-*.js` (React-внутренности) + `GET /api/v1/tables/pending-patches?tableId=… → 404`.

Сам список `/tables` — работает. ChunkLoadError больше **нет** (webpack-сборка ТЗ-1 его убрала) — экран ошибки теперь русский (ТЗ-1 Ф2).

---

## 2. Корень — ДВА независимых бага (оба подтверждены кодом)

### Баг A (🔴 крит — корень #185): нестабильные Zustand-селекторы

[TableClient.tsx:170-171](../../frontend/app/(authenticated)/tables/[id]/TableClient.tsx#L170):
```ts
const properties = useTableStore(selectVisibleProperties); // ← новый массив каждый вызов
const rows = useTableStore(selectVisibleRows);             // ← новый массив каждый вызов
```
Селекторы возвращают **новую ссылку на массив на каждый вызов**:
- [`selectVisibleProperties`](../../frontend/app/(authenticated)/tables/[id]/store/tableStore.ts#L931) — `all.filter(...)` + `[...visible].sort(...)`;
- [`selectVisibleRows`](../../frontend/app/(authenticated)/tables/[id]/store/tableStore.ts#L960) — `applyFilters(...)` (новый массив) + `rows.sort(...)`.

**Стек:** `zustand@^5.0.14` + `react@^19.2.6` (см. `frontend/package.json`). В **Zustand v5** это документированный breaking change: селектор, возвращающий новую ссылку, вызывает бесконечный ре-рендер → `React #185 «Maximum update depth exceeded»` (в v4 был лишь warning). Источник — официальная дока миграции Zustand v5 (подтверждено через Context7): *«if a selector returns a new reference on each call, it may cause infinite loops … fix: use the `useShallow` hook»*.

**Почему вскрылось только сейчас:** баг был всё время, но **маскировался ChunkLoadError** (Turbopack-сборка падала на динамическом `import()` GridView ДО рендера грида). webpack-сборка ТЗ-1 починила загрузку чанков → страница доходит до рендера грида → срабатывает рендер-луп.

`selectRowHeightPx` ([tableStore.ts:983](../../frontend/app/(authenticated)/tables/[id]/store/tableStore.ts#L983)) возвращает **число** — стабильно, его НЕ трогаем.

### Баг B (🟠 минор — очередь подтверждений правок не работает): коллизия маршрутов

`GET /api/v1/tables/pending-patches?tableId=…` → **404 `table_not_found`**. Код ошибки `table_not_found` отдаёт `@Get(':id')` основного контроллера, а не `pending-patches`-контроллер (тот вернул бы `tenant_required`/`forbidden`/список).

Причина — порядок регистрации контроллеров в [tables.module.ts:42-47](../../backend/src/modules/tables/tables.module.ts#L42):
```ts
controllers: [
  TablesController,            // ← @Get(':id') (tables.controller.ts:356) регистрируется ПЕРВЫМ
  TablePropertiesController,
  TableRowsController,
  TableViewsController,
  PendingPatchesController,    // ← @Get('pending-patches') регистрируется ПОСЛЕ → затенён
]
```
Express матчит в порядке регистрации: `GET tables/pending-patches` ловится как `:id="pending-patches"` → `tables.byId('pending-patches')` → 404. Очередь подтверждений авто-правок (`PendingPatchesPanel`) **никогда не загружается**.

Баг B **не является** причиной #185 (`loadPendingPatches()` зовётся один раз, guard `hydratedKey`), но это отдельный сломанный функционал — чиним заодно.

---

## 3. Решение (decisive)

### Фаза 1 — Фикс рендер-петли (`useShallow`) 🔴

[TableClient.tsx](../../frontend/app/(authenticated)/tables/[id]/TableClient.tsx): обернуть нестабильные селекторы в `useShallow` (канонический фикс Zustand v5, мелкая правка, без смены логики селекторов):
```ts
import { useShallow } from 'zustand/react/shallow';
// ...
const properties = useTableStore(useShallow(selectVisibleProperties));
const rows = useTableStore(useShallow(selectVisibleRows));
```
`useShallow` делает поверхностное сравнение массива → новая-но-равная ссылка не триггерит ре-рендер → петля разорвана. `selectRowHeightPx` (число) и `useTableStore((s) => s.rows)` / `(s) => s.isMutating` (примитив/стабильная ссылка) — **не трогать**.

**Аудит остальных `useTableStore(...)` (выполнен 2026-06-07, grep по `app/(authenticated)/tables/[id]/**`):** проверены все 40+ вызовов в `TableClient.tsx`, `ViewSelector.tsx`, `SemanticFilterBar.tsx`, `SaveViewDialog.tsx`. **Нестабильны (derived, новый массив) только строки 170-171** — их и чиним. Все прочие — стабильны и НЕ трогать: `s => s.field` (функции/примитивы/хранимые ссылки), включая `s => s.properties` (170≠168!), `s => s.rows`, `s => s.pendingPatches`, `s => s.draftConfig`, `s => s.draftConfig.filters` ([SemanticFilterBar.tsx:38](../../frontend/app/(authenticated)/tables/[id]/components/SemanticFilterBar.tsx#L38) — прямой доступ, не derived). Дополнительных `useShallow` не требуется.

### Фаза 2 — Фикс 404 очереди подтверждений 🟠

[tables.module.ts](../../backend/src/modules/tables/tables.module.ts): зарегистрировать `PendingPatchesController` **до** `TablesController`, чтобы статический путь `pending-patches` матчился раньше динамического `:id`:
```ts
controllers: [
  PendingPatchesController, // статические пути (pending-patches, cell-provenance, rows/:rowId/provenance) — первыми
  TablesController,         // @Get(':id') — после
  TablePropertiesController,
  TableRowsController,
  TableViewsController,
]
```
Проверить, что у `TablePropertiesController`/`TableRowsController`/`TableViewsController` нет одно-сегментных статических GET под `tables/<word>`, конфликтующих с `:id` (их пути 2-сегментные `:tableId/...` или `rows/:rowId/...` — не затеняются, но верифицировать e2e). Альтернатива (если переупорядочивание сочтут хрупким) — в `tables.controller.ts` сузить `@Get(':id')` regex-ограничением CUID (`@Get(':id([a-z0-9]{20,})')`); **рекомендация — переупорядочить контроллеры** (проще и явнее).

### Фаза 3 — Регрессионная защита

- **frontend unit/e2e:** тест, рендерящий `TableClient`/`Content` с непустым стором и проверяющий, что компонент рендерится без «Maximum update depth exceeded» (предотвратить регресс при будущих правках селекторов).
- **backend e2e:** `GET /api/v1/tables/pending-patches?tableId=<real>` → 200 `{ items: [] }` (не 404). Один тест в `tables` e2e-наборе.

---

## 4. Acceptance-сигнал (как проверить на проде после выката)

1. `/tables/<id>` (несколько разных таблиц) → открывается **грид с данными**, без «Не удалось загрузить страницу»; в консоли **нет** `React #185`; reload не возвращает краш.
2. `GET /api/v1/tables/pending-patches?tableId=<id>` → **200** (не 404); панель «Очередь подтверждений» (если есть pending) грузится.
3. Фильтры/сортировки грида (которые меняют `draftConfig` → пересчёт `selectVisibleRows`) работают без подвисаний/краша.
4. Прочие детальные страницы (`/structure/persons/<id>`, `/meetings/<id>/result`) — без регресса.

---

## 5. Объём / риски

- **Минимальный.** Фаза 1 — 2 строки + импорт (+ опц. ещё пара `useShallow`). Фаза 2 — переупорядочить массив. Blast-radius низкий: правки локальны для таблиц.
- Риск Фазы 2: переупорядочивание контроллеров теоретически меняет матчинг других путей — закрывается e2e-проверкой (Фаза 3) и ручным прокликом `/tables` (список, создание, строки, свойства, виды).
- **Зависимостей нет** (Context7 подтвердил `useShallow` штатен в zustand 5; уже в зависимостях). LLM/кэш — не затрагивается. ENV/миграции/прод-скрипты — не нужны.

## 6. Прод-операции

Нет (только пересборка фронта `docker compose up -d --build` + рестарт backend для Фазы 2). Миграций/seed/ENV нет.

---

## Итог (реализовано 2026-06-07, feature/retest2-agent-chain-overhaul)
- [x] Фаза 1 — `useShallow` на `selectVisibleRows`/`selectVisibleProperties` (+ аудит прочих селекторов: подтверждены стабильными)
- [x] Фаза 2 — порядок контроллеров в `tables.module.ts` (PendingPatchesController первым, +поясняющий комментарий)
- [x] Фаза 3 — регресс-тесты: front render-loop guard (`src/ui/components/tables/__tests__/table-render-loop.test.tsx`) + back порядок контроллеров (`tables.module.spec.ts`). _Полноценный HTTP-e2e на 200 не добавлен: в репо нет e2e-харнесса (`test/e2e` пуст) и он потребовал бы живую БД (недетерминированно) — заменён детерминированным гардом порядка регистрации, прямо фиксирующим корень бага._
- [ ] Прод-проба: `/tables/<id>` открывается, `pending-patches` 200 _(после выката)_

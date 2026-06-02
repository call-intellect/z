/**
 * Zustand-store страницы Smart Table (Фаза 1).
 *
 * Хранит локальные draft-копии table/properties/rows и синхронизирует их с
 * backend через `tablesApi`. Cell-updates дебаунсятся (500 мс), чтобы не
 * слать PATCH на каждое нажатие клавиши.
 *
 * Принципы:
 *   1. UI пишет в store → store optimistic-обновляет state → store шлёт
 *      запрос на backend → при ошибке откатывает + toast.
 *   2. Hydrate один раз через `init({tableId, orgId})` в TableClient.
 *   3. Drag&drop порядков использует фракционный `order`:
 *      между соседями o1, o2 → новый = (o1 + o2) / 2.
 *      В начало — firstOrder - 1, в конец — lastOrder + 1.
 *
 * Что НЕ делает store: data-fetching (это SWR на верхнем уровне для loading-
 * состояния). store берёт уже загруженные данные через `hydrate(...)`.
 */

import { toast } from 'sonner';
import { create } from 'zustand';

import { ApiError } from '@/api/api-error';
import {
  tableProvenanceApi,
  tableViewsApi,
  tablesApi,
} from '@/api/tables.api';
import type { TablePropTypeApi } from '@/api/types/tables';
import {
  cellProvenanceFromApi,
  pendingPatchFromApi,
  propertyFromApi,
  rowFromApi,
  tableViewConfigToApi,
  tableViewFromApi,
  type CellProvenanceDomain,
  type PendingPatchDomain,
  type TableDomain,
  type TablePropertyDomain,
  type TableRowDomain,
  type TableViewConfig,
  type TableViewDomain,
  type TableViewVisibility,
} from '@/domain/table';

// ─────────────────────────── debounce helper ─────────────────────────────

const CELL_DEBOUNCE_MS = 500;

interface PendingCellPatch {
  rowId: string;
  cells: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

// ─────────────────────────── state ───────────────────────────────────────

export interface TableStoreState {
  /** Контекст текущей таблицы (после init). */
  orgId: string | null;
  tableId: string | null;

  table: TableDomain | null;
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];

  /** Локальная ошибка mutation (отдельно от SWR-ошибки загрузки). */
  mutationError: string | null;
  isMutating: boolean;

  // ─── lifecycle ─────────────────────────────────────────────────────
  hydrate: (input: {
    orgId: string;
    tableId: string;
    table: TableDomain;
    properties: TablePropertyDomain[];
    rows: TableRowDomain[];
  }) => void;
  reset: () => void;

  // ─── mutations ──────────────────────────────────────────────────────
  updateCell: (
    rowId: string,
    propertyId: string,
    value: unknown,
  ) => Promise<void>;
  /**
   * Обновить `pageContent` строки (rich-text карточки, Фаза 2).
   * Debounce 500ms — store optimistic-обновляет state и шлёт один PATCH
   * после последнего изменения.
   */
  updatePageContent: (
    rowId: string,
    pageContentJson: Record<string, unknown> | null,
  ) => Promise<void>;
  addRow: () => Promise<TableRowDomain | null>;
  addColumn: (
    type: TablePropTypeApi,
    name: string,
  ) => Promise<TablePropertyDomain | null>;
  deleteRow: (rowId: string) => Promise<void>;
  deleteColumn: (propertyId: string) => Promise<void>;
  reorderColumn: (
    propertyId: string,
    newIndex: number,
  ) => Promise<void>;
  reorderRow: (rowId: string, newIndex: number) => Promise<void>;

  // ─── Saved Views (Фаза 3) ────────────────────────────────────────
  /** Все доступные пользователю виды (свои personal + shared/public). */
  views: TableViewDomain[];
  /** Активный view (из URL `?view=...`). null = «без вида / Все колонки». */
  currentView: TableViewDomain | null;
  /** Локальный draft-конфиг: hiddenProps, propOrder, rowHeight. */
  draftConfig: TableViewConfig;
  /** true, если draftConfig отличается от config'а текущего вида. */
  hasUnsavedChanges: boolean;
  /** Положить список доступных видов (SWR → store). */
  setViews: (views: TableViewDomain[]) => void;
  /** Применить view по id (или сбросить если null). */
  applyView: (viewId: string | null) => void;
  /** Локально скрыть колонку (мутация draftConfig). */
  setHiddenProperty: (propertyId: string, hidden: boolean) => void;
  /** Локально изменить порядок колонок (draft). */
  setDraftPropOrder: (propertyIds: string[]) => void;
  /** Локально сменить плотность строк. */
  setRowHeight: (rowHeight: 'compact' | 'default' | 'tall') => void;
  /** Сохранить текущий draft как новый вид. */
  saveCurrentAsView: (
    name: string,
    visibility: TableViewVisibility,
  ) => Promise<TableViewDomain | null>;
  /** Сохранить изменения в текущий активный вид. */
  saveChangesToCurrentView: () => Promise<TableViewDomain | null>;
  /** Удалить вид. Если был активный — сбросить currentView. */
  deleteView: (viewId: string) => Promise<void>;

  // ─── Pending-patches + provenance (Фаза 3, Event-to-Cells) ─────────
  /** Правки ячеек, ожидающие подтверждения (вся таблица). */
  pendingPatches: PendingPatchDomain[];
  /** Кол-во pending-правок (для бейджа в шапке). */
  pendingCount: number;
  /** Загрузить очередь подтверждений (вызывается при загрузке таблицы). */
  loadPendingPatches: () => Promise<void>;
  /** Принять одну правку: применить proposedValue в ячейку + убрать из очереди. */
  approvePatch: (patchId: string) => Promise<void>;
  /** Отклонить одну правку: убрать из очереди без изменения ячейки. */
  rejectPatch: (patchId: string) => Promise<void>;
  /** Принять все pending-правки разом. */
  approveAllPatches: () => Promise<void>;
  /** Отклонить все pending-правки разом. */
  rejectAllPatches: () => Promise<void>;
  /**
   * Загрузить провенансы строки (источники авто-правок ячеек).
   * Не кладёт в store — возвращает напрямую (карточка строки держит локально).
   * Скрывает откатанные записи (rolledBackAt != null).
   */
  loadRowProvenance: (rowId: string) => Promise<CellProvenanceDomain[]>;
  /** Откатить авто-правку ячейки (восстановить previousValue). */
  undoCellProvenance: (provenanceId: string) => Promise<boolean>;
  /**
   * Локально записать значение ячейки в store БЕЗ PATCH на backend.
   * Нужно после undo провенанса: backend уже восстановил previousValue в
   * cells, поэтому повторный PATCH не нужен — только синхронизация состояния.
   */
  setRowCellLocal: (rowId: string, propertyId: string, value: unknown) => void;
}

// ─────────────────────────── module-level debounce-bucket ────────────────

const pending: Map<string, PendingCellPatch> = new Map();

interface PendingPageContent {
  rowId: string;
  pageContent: Record<string, unknown> | null;
  timer: ReturnType<typeof setTimeout>;
}

/** Отдельный bucket для pageContent — не смешиваем с cells, чтобы PATCH'и
 *  по rich-text не задерживали PATCH'и по ячейкам и наоборот. */
const pendingPageContent: Map<string, PendingPageContent> = new Map();

const PAGE_CONTENT_DEBOUNCE_MS = 500;

/**
 * Грейсфул-обработка 422 `table_cell_readonly` (Smart-tables Фаза 2).
 * Возвращает true, если это именно read-only-ошибка (тогда вызывающий код
 * откатывает оптимистичное обновление и не пишет mutationError-баннер —
 * сообщение уже показано тостом).
 */
function isReadonlyCellError(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'table_cell_readonly';
}

const READONLY_TOAST =
  'Эту ячейку нельзя изменить вручную — значение приходит из памяти компании';

function clearPendingFor(rowId: string): void {
  const p = pending.get(rowId);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(rowId);
  }
  const pc = pendingPageContent.get(rowId);
  if (pc) {
    clearTimeout(pc.timer);
    pendingPageContent.delete(rowId);
  }
}

// ─────────────────────────── Saved Views helpers ─────────────────────────

function cloneConfig(c: TableViewConfig): TableViewConfig {
  return {
    hiddenProps: c.hiddenProps ? [...c.hiddenProps] : undefined,
    propOrder: c.propOrder ? [...c.propOrder] : undefined,
    rowHeight: c.rowHeight,
    sorts: c.sorts ? c.sorts.map((s) => ({ ...s })) : undefined,
    filters: c.filters ? c.filters.map((f) => ({ ...f })) : undefined,
    groupBy: c.groupBy,
  };
}

/**
 * Сравнение draftConfig и applied-config по нормализованному JSON.
 * `undefined`/пустой массив/пустой объект приравниваются — это позволяет
 * сравнить «свежий» pristine view с draft'ом, в котором поля просто `undefined`.
 */
function hasDiff(a: TableViewConfig, b: TableViewConfig): boolean {
  return normalize(a) !== normalize(b);
}

function normalize(c: TableViewConfig): string {
  const o: Record<string, unknown> = {};
  if (c.hiddenProps && c.hiddenProps.length > 0) {
    o.hiddenProps = [...c.hiddenProps].sort();
  }
  if (c.propOrder && c.propOrder.length > 0) o.propOrder = c.propOrder;
  if (c.rowHeight) o.rowHeight = c.rowHeight;
  if (c.sorts && c.sorts.length > 0) o.sorts = c.sorts;
  if (c.filters && c.filters.length > 0) o.filters = c.filters;
  if (c.groupBy) o.groupBy = c.groupBy;
  return JSON.stringify(o);
}

// ─────────────────────────── store ───────────────────────────────────────

export const useTableStore = create<TableStoreState>((set, get) => ({
  orgId: null,
  tableId: null,
  table: null,
  properties: [],
  rows: [],
  mutationError: null,
  isMutating: false,
  views: [],
  currentView: null,
  draftConfig: {},
  hasUnsavedChanges: false,
  pendingPatches: [],
  pendingCount: 0,

  hydrate: ({ orgId, tableId, table, properties, rows }) => {
    set({
      orgId,
      tableId,
      table,
      properties: [...properties].sort((a, b) => a.order - b.order),
      rows: [...rows].sort((a, b) => a.order - b.order),
      mutationError: null,
    });
  },

  reset: () => {
    pending.forEach((p) => clearTimeout(p.timer));
    pending.clear();
    pendingPageContent.forEach((p) => clearTimeout(p.timer));
    pendingPageContent.clear();
    set({
      orgId: null,
      tableId: null,
      table: null,
      properties: [],
      rows: [],
      mutationError: null,
      isMutating: false,
      views: [],
      currentView: null,
      draftConfig: {},
      hasUnsavedChanges: false,
      pendingPatches: [],
      pendingCount: 0,
    });
  },

  // ─── Saved Views (Фаза 3) ─────────────────────────────────────────
  setViews: (views) => {
    set({ views });
    // Если currentView пропал — сбросим.
    const cv = get().currentView;
    if (cv && !views.find((v) => v.id === cv.id)) {
      set({ currentView: null, draftConfig: {}, hasUnsavedChanges: false });
    }
  },

  applyView: (viewId) => {
    const { views } = get();
    if (!viewId) {
      set({ currentView: null, draftConfig: {}, hasUnsavedChanges: false });
      return;
    }
    const v = views.find((x) => x.id === viewId);
    if (!v) {
      // Vid id не найден среди доступных — игнорим, остаёмся «без вида».
      set({ currentView: null, draftConfig: {}, hasUnsavedChanges: false });
      return;
    }
    set({
      currentView: v,
      draftConfig: cloneConfig(v.config),
      hasUnsavedChanges: false,
    });
  },

  setHiddenProperty: (propertyId, hidden) => {
    const { draftConfig, currentView } = get();
    const current = new Set(draftConfig.hiddenProps ?? []);
    if (hidden) current.add(propertyId);
    else current.delete(propertyId);
    const next: TableViewConfig = {
      ...draftConfig,
      hiddenProps: Array.from(current),
    };
    set({
      draftConfig: next,
      hasUnsavedChanges: hasDiff(next, currentView?.config ?? {}),
    });
  },

  setDraftPropOrder: (propertyIds) => {
    const { draftConfig, currentView } = get();
    const next: TableViewConfig = { ...draftConfig, propOrder: propertyIds };
    set({
      draftConfig: next,
      hasUnsavedChanges: hasDiff(next, currentView?.config ?? {}),
    });
  },

  setRowHeight: (rowHeight) => {
    const { draftConfig, currentView } = get();
    const next: TableViewConfig = { ...draftConfig, rowHeight };
    set({
      draftConfig: next,
      hasUnsavedChanges: hasDiff(next, currentView?.config ?? {}),
    });
  },

  saveCurrentAsView: async (name, visibility) => {
    const { orgId, tableId, draftConfig, views } = get();
    if (!orgId || !tableId) return null;
    set({ isMutating: true, mutationError: null });
    try {
      const created = await tableViewsApi.create(orgId, tableId, {
        name,
        type: 'grid',
        config: tableViewConfigToApi(draftConfig),
        visibility,
      });
      const domain = tableViewFromApi(created);
      set({
        views: [...views, domain],
        currentView: domain,
        draftConfig: cloneConfig(domain.config),
        hasUnsavedChanges: false,
        isMutating: false,
      });
      return domain;
    } catch (e) {
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось сохранить вид',
      });
      return null;
    }
  },

  saveChangesToCurrentView: async () => {
    const { orgId, tableId, currentView, draftConfig, views } = get();
    if (!orgId || !tableId || !currentView) return null;
    set({ isMutating: true, mutationError: null });
    try {
      const updated = await tableViewsApi.update(
        orgId,
        tableId,
        currentView.id,
        { config: tableViewConfigToApi(draftConfig) },
      );
      const domain = tableViewFromApi(updated);
      set({
        views: views.map((v) => (v.id === domain.id ? domain : v)),
        currentView: domain,
        draftConfig: cloneConfig(domain.config),
        hasUnsavedChanges: false,
        isMutating: false,
      });
      return domain;
    } catch (e) {
      set({
        isMutating: false,
        mutationError:
          e instanceof Error
            ? e.message
            : 'Не удалось сохранить изменения в виде',
      });
      return null;
    }
  },

  deleteView: async (viewId) => {
    const { orgId, tableId, views, currentView } = get();
    if (!orgId || !tableId) return;
    set({ isMutating: true, mutationError: null });
    try {
      await tableViewsApi.remove(orgId, tableId, viewId);
      const nextViews = views.filter((v) => v.id !== viewId);
      const wasActive = currentView?.id === viewId;
      set({
        views: nextViews,
        currentView: wasActive ? null : currentView,
        draftConfig: wasActive ? {} : get().draftConfig,
        hasUnsavedChanges: wasActive ? false : get().hasUnsavedChanges,
        isMutating: false,
      });
    } catch (e) {
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось удалить вид',
      });
    }
  },

  // ─── updateCell с debounce ────────────────────────────────────────
  updateCell: async (rowId, propertyId, value) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;

    // Optimistic.
    const prev = rows.find((r) => r.id === rowId);
    if (!prev) return;
    const nextCells = { ...prev.cells, [propertyId]: value };
    set({
      rows: rows.map((r) =>
        r.id === rowId ? { ...r, cells: nextCells } : r,
      ),
    });

    // Debounce per-row: накапливаем cells, в финале — один PATCH.
    const existing = pending.get(rowId);
    if (existing) clearTimeout(existing.timer);
    const accumulated = existing
      ? { ...existing.cells, [propertyId]: value }
      : { [propertyId]: value };
    const timer = setTimeout(() => {
      void (async () => {
        const snapshot = pending.get(rowId);
        if (!snapshot) return;
        pending.delete(rowId);
        try {
          const updated = await tablesApi.updateRow(orgId, tableId, rowId, {
            cells: { ...prev.cells, ...snapshot.cells },
          });
          const domain = rowFromApi(updated);
          set({
            rows: get().rows.map((r) => (r.id === rowId ? domain : r)),
          });
        } catch (e) {
          // Read-only ячейка (значение из памяти компании): откатываем
          // оптимистичное изменение и показываем понятный тост, без баннера.
          if (isReadonlyCellError(e)) {
            toast.error(READONLY_TOAST);
            set({
              rows: get().rows.map((r) =>
                r.id === rowId ? { ...r, cells: prev.cells } : r,
              ),
            });
            return;
          }
          set({
            mutationError:
              e instanceof Error
                ? e.message
                : 'Не удалось сохранить изменение ячейки',
          });
        }
      })();
    }, CELL_DEBOUNCE_MS);
    pending.set(rowId, { rowId, cells: accumulated, timer });
  },

  // ─── updatePageContent с debounce ──────────────────────────────────
  updatePageContent: async (rowId, pageContentJson) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;

    const prev = rows.find((r) => r.id === rowId);
    if (!prev) return;

    // Optimistic.
    set({
      rows: rows.map((r) =>
        r.id === rowId ? { ...r, pageContent: pageContentJson } : r,
      ),
    });

    const existing = pendingPageContent.get(rowId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      void (async () => {
        const snapshot = pendingPageContent.get(rowId);
        if (!snapshot) return;
        pendingPageContent.delete(rowId);
        try {
          const updated = await tablesApi.updateRow(orgId, tableId, rowId, {
            pageContent: snapshot.pageContent,
          });
          const domain = rowFromApi(updated);
          set({
            rows: get().rows.map((r) => (r.id === rowId ? domain : r)),
          });
        } catch (e) {
          set({
            mutationError:
              e instanceof Error
                ? e.message
                : 'Не удалось сохранить содержимое',
          });
        }
      })();
    }, PAGE_CONTENT_DEBOUNCE_MS);
    pendingPageContent.set(rowId, {
      rowId,
      pageContent: pageContentJson,
      timer,
    });
  },

  // ─── addRow в конец ─────────────────────────────────────────────────
  addRow: async () => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return null;
    const lastOrder = rows.length ? rows[rows.length - 1]!.order : 0;
    set({ isMutating: true, mutationError: null });
    try {
      const created = await tablesApi.createRow(orgId, tableId, {
        cells: {},
        order: lastOrder + 1,
      });
      const domain = rowFromApi(created);
      set({ rows: [...get().rows, domain], isMutating: false });
      return domain;
    } catch (e) {
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось добавить строку',
      });
      return null;
    }
  },

  // ─── addColumn в конец ─────────────────────────────────────────────
  addColumn: async (type, name) => {
    const { orgId, tableId, properties } = get();
    if (!orgId || !tableId) return null;
    const lastOrder = properties.length
      ? properties[properties.length - 1]!.order
      : 0;
    set({ isMutating: true, mutationError: null });
    try {
      const created = await tablesApi.createProperty(orgId, tableId, {
        name,
        type,
        order: lastOrder + 1,
        config: {},
      });
      const domain = propertyFromApi(created);
      set({
        properties: [...get().properties, domain],
        isMutating: false,
      });
      return domain;
    } catch (e) {
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось создать колонку',
      });
      return null;
    }
  },

  // ─── deleteRow ──────────────────────────────────────────────────────
  deleteRow: async (rowId) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;
    clearPendingFor(rowId);
    set({
      isMutating: true,
      mutationError: null,
      rows: rows.filter((r) => r.id !== rowId), // optimistic
    });
    try {
      // Backend: hard-delete только архивная, поэтому сначала archive.
      await tablesApi.archiveRow(orgId, tableId, rowId);
      set({ isMutating: false });
    } catch (e) {
      // Откат: добавляем строку обратно.
      const removed = rows.find((r) => r.id === rowId);
      if (removed) set({ rows: [...get().rows, removed] });
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось удалить строку',
      });
    }
  },

  // ─── deleteColumn ───────────────────────────────────────────────────
  deleteColumn: async (propertyId) => {
    const { orgId, tableId, properties } = get();
    if (!orgId || !tableId) return;
    set({
      isMutating: true,
      mutationError: null,
      properties: properties.filter((p) => p.id !== propertyId),
    });
    try {
      await tablesApi.deleteProperty(orgId, tableId, propertyId);
      set({ isMutating: false });
    } catch (e) {
      const removed = properties.find((p) => p.id === propertyId);
      if (removed) set({ properties: [...get().properties, removed] });
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось удалить колонку',
      });
    }
  },

  // ─── reorderColumn через фракционный order ─────────────────────────
  reorderColumn: async (propertyId, newIndex) => {
    const { orgId, tableId, properties } = get();
    if (!orgId || !tableId) return;
    const sorted = [...properties].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((p) => p.id === propertyId);
    if (oldIndex === -1 || oldIndex === newIndex) return;

    // Считаем новый order: middle между соседями по newIndex (учитывая, что
    // мы «вынимаем» элемент из oldIndex).
    const without = sorted.filter((_, i) => i !== oldIndex);
    const insertAt = Math.max(0, Math.min(newIndex, without.length));
    const prevOrder = insertAt > 0 ? without[insertAt - 1]!.order : null;
    const nextOrder = insertAt < without.length ? without[insertAt]!.order : null;
    let newOrder: number;
    if (prevOrder === null && nextOrder !== null) newOrder = nextOrder - 1;
    else if (prevOrder !== null && nextOrder === null) newOrder = prevOrder + 1;
    else if (prevOrder !== null && nextOrder !== null)
      newOrder = (prevOrder + nextOrder) / 2;
    else newOrder = 0;

    // Optimistic.
    const updatedLocal = properties.map((p) =>
      p.id === propertyId ? { ...p, order: newOrder } : p,
    );
    set({
      properties: updatedLocal.sort((a, b) => a.order - b.order),
      mutationError: null,
    });

    try {
      const updated = await tablesApi.reorderProperty(
        orgId,
        tableId,
        propertyId,
        { order: newOrder },
      );
      const domain = propertyFromApi(updated);
      set({
        properties: get()
          .properties.map((p) => (p.id === propertyId ? domain : p))
          .sort((a, b) => a.order - b.order),
      });
    } catch (e) {
      // Откат к старому порядку.
      set({
        properties,
        mutationError:
          e instanceof Error
            ? e.message
            : 'Не удалось изменить порядок колонок',
      });
    }
  },

  // ─── reorderRow через фракционный order ────────────────────────────
  reorderRow: async (rowId, newIndex) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;
    const sorted = [...rows].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((r) => r.id === rowId);
    if (oldIndex === -1 || oldIndex === newIndex) return;

    const without = sorted.filter((_, i) => i !== oldIndex);
    const insertAt = Math.max(0, Math.min(newIndex, without.length));
    const prevOrder = insertAt > 0 ? without[insertAt - 1]!.order : null;
    const nextOrder = insertAt < without.length ? without[insertAt]!.order : null;
    let newOrder: number;
    if (prevOrder === null && nextOrder !== null) newOrder = nextOrder - 1;
    else if (prevOrder !== null && nextOrder === null) newOrder = prevOrder + 1;
    else if (prevOrder !== null && nextOrder !== null)
      newOrder = (prevOrder + nextOrder) / 2;
    else newOrder = 0;

    const updatedLocal = rows.map((r) =>
      r.id === rowId ? { ...r, order: newOrder } : r,
    );
    set({
      rows: updatedLocal.sort((a, b) => a.order - b.order),
      mutationError: null,
    });

    try {
      const updated = await tablesApi.updateRow(orgId, tableId, rowId, {
        order: newOrder,
      });
      const domain = rowFromApi(updated);
      set({
        rows: get()
          .rows.map((r) => (r.id === rowId ? domain : r))
          .sort((a, b) => a.order - b.order),
      });
    } catch (e) {
      set({
        rows,
        mutationError:
          e instanceof Error ? e.message : 'Не удалось изменить порядок строк',
      });
    }
  },

  // ─── Pending-patches + provenance (Фаза 3) ──────────────────────────
  loadPendingPatches: async () => {
    const { orgId, tableId } = get();
    if (!orgId || !tableId) return;
    try {
      const res = await tableProvenanceApi.listPendingPatches(orgId, tableId);
      const items = res.items.map(pendingPatchFromApi);
      set({ pendingPatches: items, pendingCount: items.length });
    } catch {
      // Тихо: очередь подтверждений вторична, не ломаем загрузку таблицы.
    }
  },

  approvePatch: async (patchId) => {
    const { orgId, pendingPatches, rows } = get();
    if (!orgId) return;
    const patch = pendingPatches.find((p) => p.id === patchId);
    if (!patch) return;

    // Optimistic: убираем из очереди + применяем proposedValue в ячейку.
    const nextPending = pendingPatches.filter((p) => p.id !== patchId);
    set({
      pendingPatches: nextPending,
      pendingCount: nextPending.length,
      rows: rows.map((r) =>
        r.id === patch.tableRowId
          ? {
              ...r,
              cells: { ...r.cells, [patch.propertyId]: patch.proposedValue },
            }
          : r,
      ),
    });

    try {
      await tableProvenanceApi.decidePendingPatch(orgId, patchId, 'approve');
      toast.success('Правка принята');
    } catch (e) {
      // Откат: возвращаем правку в очередь и старое значение в ячейку.
      set({
        pendingPatches: [...get().pendingPatches, patch],
        pendingCount: get().pendingCount + 1,
        rows: get().rows.map((r) =>
          r.id === patch.tableRowId
            ? {
                ...r,
                cells: { ...r.cells, [patch.propertyId]: patch.currentValue },
              }
            : r,
        ),
      });
      toast.error(
        e instanceof Error ? e.message : 'Не удалось принять правку',
      );
    }
  },

  rejectPatch: async (patchId) => {
    const { orgId, pendingPatches } = get();
    if (!orgId) return;
    const patch = pendingPatches.find((p) => p.id === patchId);
    if (!patch) return;

    const nextPending = pendingPatches.filter((p) => p.id !== patchId);
    set({ pendingPatches: nextPending, pendingCount: nextPending.length });

    try {
      await tableProvenanceApi.decidePendingPatch(orgId, patchId, 'reject');
      toast.success('Правка отклонена');
    } catch (e) {
      set({
        pendingPatches: [...get().pendingPatches, patch],
        pendingCount: get().pendingCount + 1,
      });
      toast.error(
        e instanceof Error ? e.message : 'Не удалось отклонить правку',
      );
    }
  },

  approveAllPatches: async () => {
    const { pendingPatches, approvePatch } = get();
    // Снимок id — список меняется по ходу (approvePatch мутирует state).
    const ids = pendingPatches.map((p) => p.id);
    for (const id of ids) {
      // Последовательно: backend decide идемпотентен per-patch, а
      // последовательность даёт предсказуемый порядок применения в cells.
      await approvePatch(id);
    }
  },

  rejectAllPatches: async () => {
    const { pendingPatches, rejectPatch } = get();
    const ids = pendingPatches.map((p) => p.id);
    for (const id of ids) {
      await rejectPatch(id);
    }
  },

  loadRowProvenance: async (rowId) => {
    const { orgId } = get();
    if (!orgId) return [];
    try {
      const res = await tableProvenanceApi.getRowProvenance(orgId, rowId);
      // Скрываем откатанные записи — у них нет актуального источника значения.
      return res.items
        .map(cellProvenanceFromApi)
        .filter((p) => p.rolledBackAt === null);
    } catch {
      return [];
    }
  },

  undoCellProvenance: async (provenanceId) => {
    const { orgId } = get();
    if (!orgId) return false;
    const res = await tableProvenanceApi.undoCellProvenance(
      orgId,
      provenanceId,
    );
    return res.rolledBack === true;
  },

  setRowCellLocal: (rowId, propertyId, value) => {
    set({
      rows: get().rows.map((r) =>
        r.id === rowId
          ? { ...r, cells: { ...r.cells, [propertyId]: value } }
          : r,
      ),
    });
  },
}));

// ─────────────────────────── selectors (view-aware) ──────────────────────

/**
 * Возвращает видимые колонки в правильном порядке с учётом draftConfig:
 *   1. фильтр по `hiddenProps`,
 *   2. если задан `propOrder` — сортируем по нему (остальные — в конец
 *      по исходному order).
 *
 * Используется в UI вместо прямого `useTableStore(s => s.properties)`,
 * когда нужно отрисовать grid через призму активного view.
 */
export function selectVisibleProperties(
  s: TableStoreState,
): TablePropertyDomain[] {
  const all = s.properties;
  const hidden = new Set(s.draftConfig.hiddenProps ?? []);
  const visible = all.filter((p) => !hidden.has(p.id));
  const propOrder = s.draftConfig.propOrder;
  if (!propOrder || propOrder.length === 0) {
    return [...visible].sort((a, b) => a.order - b.order);
  }
  const orderIndex = new Map(propOrder.map((id, i) => [id, i] as const));
  return [...visible].sort((a, b) => {
    const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.order - b.order;
  });
}

/**
 * Возвращает строки с учётом draftConfig.sorts (Фаза 3 — минимальная
 * поддержка: equality-сравнение для строковых/числовых значений; для
 * чего сложнее — будет Фаза 4). filters не применяются (Фаза 4+).
 */
export function selectVisibleRows(s: TableStoreState): TableRowDomain[] {
  const sorts = s.draftConfig.sorts ?? [];
  let rows = [...s.rows];
  // Применяем сорты последовательно (последний — самый приоритетный).
  for (let i = sorts.length - 1; i >= 0; i--) {
    const sort = sorts[i]!;
    const dir = sort.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const av = a.cells[sort.propertyId];
      const bv = b.cells[sort.propertyId];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number')
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'ru') * dir;
    });
  }
  return rows;
}

/** Числовой `rowHeight` для Glide Data Grid (compact / default / tall). */
export function selectRowHeightPx(s: TableStoreState): number {
  switch (s.draftConfig.rowHeight) {
    case 'compact':
      return 24;
    case 'tall':
      return 48;
    default:
      return 34;
  }
}

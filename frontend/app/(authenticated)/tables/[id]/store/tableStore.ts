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

import { create } from 'zustand';

import { tablesApi } from '@/api/tables.api';
import type { TablePropTypeApi } from '@/api/types/tables';
import {
  propertyFromApi,
  rowFromApi,
  type TableDomain,
  type TablePropertyDomain,
  type TableRowDomain,
} from '@/domain/table';

// ─────────────────────────── debounce helper ─────────────────────────────

const CELL_DEBOUNCE_MS = 500;

interface PendingCellPatch {
  rowId: string;
  cells: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

// ─────────────────────────── state ───────────────────────────────────────

interface TableStoreState {
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
}

// ─────────────────────────── module-level debounce-bucket ────────────────

const pending: Map<string, PendingCellPatch> = new Map();

function clearPendingFor(rowId: string): void {
  const p = pending.get(rowId);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(rowId);
  }
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
    set({
      orgId: null,
      tableId: null,
      table: null,
      properties: [],
      rows: [],
      mutationError: null,
      isMutating: false,
    });
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
}));

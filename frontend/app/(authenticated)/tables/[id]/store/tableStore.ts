import { toast } from "sonner";
import { create } from "zustand";

import { ApiError } from "@/api/api-error";
import { tableProvenanceApi, tableViewsApi, tablesApi } from "@/api/tables.api";
import type { TablePropTypeApi } from "@/api/types/tables";
import {
  applyFilters,
  cellProvenanceFromApi,
  pendingPatchFromApi,
  propertyFromApi,
  rowFromApi,
  tableViewConfigToApi,
  tableViewFromApi,
  type CellProvenanceDomain,
  type PendingPatchDomain,
  type TableDomain,
  type TableFilterCondition,
  type TablePropertyDomain,
  type TableRowDomain,
  type TableViewConfig,
  type TableViewDomain,
  type TableViewVisibility,
} from "@/domain/table";

const CELL_DEBOUNCE_MS = 500;

interface PendingCellPatch {
  rowId: string;
  cells: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

export interface TableStoreState {
  orgId: string | null;
  tableId: string | null;

  table: TableDomain | null;
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];

  mutationError: string | null;
  isMutating: boolean;

  hydrate: (input: {
    orgId: string;
    tableId: string;
    table: TableDomain;
    properties: TablePropertyDomain[];
    rows: TableRowDomain[];
  }) => void;
  reset: () => void;

  updateCell: (
    rowId: string,
    propertyId: string,
    value: unknown,
  ) => Promise<void>;
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
  reorderColumn: (propertyId: string, newIndex: number) => Promise<void>;
  reorderRow: (rowId: string, newIndex: number) => Promise<void>;

  views: TableViewDomain[];
  currentView: TableViewDomain | null;
  draftConfig: TableViewConfig;
  hasUnsavedChanges: boolean;
  setViews: (views: TableViewDomain[]) => void;
  applyView: (viewId: string | null) => void;
  setHiddenProperty: (propertyId: string, hidden: boolean) => void;
  setDraftPropOrder: (propertyIds: string[]) => void;
  setRowHeight: (rowHeight: "compact" | "default" | "tall") => void;
  setDraftFilters: (filters: TableFilterCondition[]) => void;
  clearDraftFilters: () => void;
  saveCurrentAsView: (
    name: string,
    visibility: TableViewVisibility,
  ) => Promise<TableViewDomain | null>;
  saveChangesToCurrentView: () => Promise<TableViewDomain | null>;
  deleteView: (viewId: string) => Promise<void>;

  pendingPatches: PendingPatchDomain[];
  pendingCount: number;
  loadPendingPatches: () => Promise<void>;
  approvePatch: (patchId: string) => Promise<void>;
  rejectPatch: (patchId: string) => Promise<void>;
  approveAllPatches: () => Promise<void>;
  rejectAllPatches: () => Promise<void>;
  loadRowProvenance: (rowId: string) => Promise<CellProvenanceDomain[]>;
  undoCellProvenance: (provenanceId: string) => Promise<boolean>;
  setRowCellLocal: (rowId: string, propertyId: string, value: unknown) => void;
}

const pending: Map<string, PendingCellPatch> = new Map();

interface PendingPageContent {
  rowId: string;
  pageContent: Record<string, unknown> | null;
  timer: ReturnType<typeof setTimeout>;
}

const pendingPageContent: Map<string, PendingPageContent> = new Map();

const PAGE_CONTENT_DEBOUNCE_MS = 500;

function isReadonlyCellError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "table_cell_readonly";
}

const READONLY_TOAST =
  "Эту ячейку нельзя изменить вручную — значение приходит из памяти компании";

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

  setViews: (views) => {
    set({ views });
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

  setDraftFilters: (filters) => {
    const { draftConfig, currentView } = get();
    const next: TableViewConfig = {
      ...draftConfig,
      filters: filters.length > 0 ? filters : undefined,
    };
    set({
      draftConfig: next,
      hasUnsavedChanges: hasDiff(next, currentView?.config ?? {}),
    });
  },

  clearDraftFilters: () => {
    const { draftConfig, currentView } = get();
    const next: TableViewConfig = { ...draftConfig, filters: undefined };
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
        type: "grid",
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
          e instanceof Error ? e.message : "Не удалось сохранить вид",
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
            : "Не удалось сохранить изменения в виде",
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
          e instanceof Error ? e.message : "Не удалось удалить вид",
      });
    }
  },

  updateCell: async (rowId, propertyId, value) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;

    const prev = rows.find((r) => r.id === rowId);
    if (!prev) return;
    const nextCells = { ...prev.cells, [propertyId]: value };
    set({
      rows: rows.map((r) => (r.id === rowId ? { ...r, cells: nextCells } : r)),
    });

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
                : "Не удалось сохранить изменение ячейки",
          });
        }
      })();
    }, CELL_DEBOUNCE_MS);
    pending.set(rowId, { rowId, cells: accumulated, timer });
  },

  updatePageContent: async (rowId, pageContentJson) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;

    const prev = rows.find((r) => r.id === rowId);
    if (!prev) return;

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
                : "Не удалось сохранить содержимое",
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
          e instanceof Error ? e.message : "Не удалось добавить строку",
      });
      return null;
    }
  },

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
          e instanceof Error ? e.message : "Не удалось создать колонку",
      });
      return null;
    }
  },

  deleteRow: async (rowId) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;
    clearPendingFor(rowId);
    set({
      isMutating: true,
      mutationError: null,
      rows: rows.filter((r) => r.id !== rowId),
    });
    try {
      await tablesApi.archiveRow(orgId, tableId, rowId);
      set({ isMutating: false });
    } catch (e) {
      const removed = rows.find((r) => r.id === rowId);
      if (removed) set({ rows: [...get().rows, removed] });
      set({
        isMutating: false,
        mutationError:
          e instanceof Error ? e.message : "Не удалось удалить строку",
      });
    }
  },

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
          e instanceof Error ? e.message : "Не удалось удалить колонку",
      });
    }
  },

  reorderColumn: async (propertyId, newIndex) => {
    const { orgId, tableId, properties } = get();
    if (!orgId || !tableId) return;
    const sorted = [...properties].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((p) => p.id === propertyId);
    if (oldIndex === -1 || oldIndex === newIndex) return;

    const without = sorted.filter((_, i) => i !== oldIndex);
    const insertAt = Math.max(0, Math.min(newIndex, without.length));
    const prevOrder = insertAt > 0 ? without[insertAt - 1]!.order : null;
    const nextOrder =
      insertAt < without.length ? without[insertAt]!.order : null;
    let newOrder: number;
    if (prevOrder === null && nextOrder !== null) newOrder = nextOrder - 1;
    else if (prevOrder !== null && nextOrder === null) newOrder = prevOrder + 1;
    else if (prevOrder !== null && nextOrder !== null)
      newOrder = (prevOrder + nextOrder) / 2;
    else newOrder = 0;

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
      set({
        properties,
        mutationError:
          e instanceof Error
            ? e.message
            : "Не удалось изменить порядок колонок",
      });
    }
  },

  reorderRow: async (rowId, newIndex) => {
    const { orgId, tableId, rows } = get();
    if (!orgId || !tableId) return;
    const sorted = [...rows].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((r) => r.id === rowId);
    if (oldIndex === -1 || oldIndex === newIndex) return;

    const without = sorted.filter((_, i) => i !== oldIndex);
    const insertAt = Math.max(0, Math.min(newIndex, without.length));
    const prevOrder = insertAt > 0 ? without[insertAt - 1]!.order : null;
    const nextOrder =
      insertAt < without.length ? without[insertAt]!.order : null;
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
          e instanceof Error ? e.message : "Не удалось изменить порядок строк",
      });
    }
  },

  loadPendingPatches: async () => {
    const { orgId, tableId } = get();
    if (!orgId || !tableId) return;
    try {
      const res = await tableProvenanceApi.listPendingPatches(orgId, tableId);
      const items = res.items.map(pendingPatchFromApi);
      set({ pendingPatches: items, pendingCount: items.length });
    } catch {}
  },

  approvePatch: async (patchId) => {
    const { orgId, pendingPatches, rows } = get();
    if (!orgId) return;
    const patch = pendingPatches.find((p) => p.id === patchId);
    if (!patch) return;

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
      await tableProvenanceApi.decidePendingPatch(orgId, patchId, "approve");
      toast.success("Правка принята");
    } catch (e) {
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
      toast.error(e instanceof Error ? e.message : "Не удалось принять правку");
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
      await tableProvenanceApi.decidePendingPatch(orgId, patchId, "reject");
      toast.success("Правка отклонена");
    } catch (e) {
      set({
        pendingPatches: [...get().pendingPatches, patch],
        pendingCount: get().pendingCount + 1,
      });
      toast.error(
        e instanceof Error ? e.message : "Не удалось отклонить правку",
      );
    }
  },

  approveAllPatches: async () => {
    const { pendingPatches, approvePatch } = get();
    const ids = pendingPatches.map((p) => p.id);
    for (const id of ids) {
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
    const ai = orderIndex.has(a.id)
      ? orderIndex.get(a.id)!
      : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b.id)
      ? orderIndex.get(b.id)!
      : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.order - b.order;
  });
}

export function selectVisibleRows(s: TableStoreState): TableRowDomain[] {
  let rows = applyFilters(s.rows, s.draftConfig.filters, s.properties);
  const sorts = s.draftConfig.sorts ?? [];
  for (let i = sorts.length - 1; i >= 0; i--) {
    const sort = sorts[i]!;
    const dir = sort.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const av = a.cells[sort.propertyId];
      const bv = b.cells[sort.propertyId];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ru") * dir;
    });
  }
  return rows;
}

export function selectRowHeightPx(s: TableStoreState): number {
  switch (s.draftConfig.rowHeight) {
    case "compact":
      return 24;
    case "tall":
      return 48;
    default:
      return 34;
  }
}

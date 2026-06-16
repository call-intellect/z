import type {
  CellProvenanceApi,
  PendingPatchApi,
  TableApi,
  TablePropTypeApi,
  TablePropertyApi,
  TableRowApi,
  TableViewApi,
  TableViewTypeApi,
  TableViewVisibilityApi,
} from "@/api/types/tables";

export type TablePropType = TablePropTypeApi;
export type TableViewType = TableViewTypeApi;
export type TableViewVisibility = TableViewVisibilityApi;

export interface TableDomain {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  icon: string | null;
  coverImageS3: string | null;
  parentDocumentId: string | null;
  entitySync: Record<string, unknown> | null;
  defaultViewId: string | null;
  archivedAt: Date | null;
  isSystem: boolean;
  systemKey: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TablePropertyDomain {
  id: string;
  tableId: string;
  name: string;
  type: TablePropType;
  config: Record<string, unknown>;
  isPrimary: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TableRowDomain {
  id: string;
  tableId: string;
  tenantId: string;
  cells: Record<string, unknown>;
  entityId: string | null;
  order: number;
  archivedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  pageContent: Record<string, unknown> | null;
}

export type TableFilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "contains"
  | "in"
  | "empty"
  | "before"
  | "after"
  | "older_than";

export interface TableFilterCondition {
  propertyId: string;
  op: TableFilterOp;
  value?: unknown;
}

export interface TableViewConfig {
  hiddenProps?: string[];
  propOrder?: string[];
  rowHeight?: "compact" | "default" | "tall";
  sorts?: Array<{ propertyId: string; direction: "asc" | "desc" }>;
  filters?: TableFilterCondition[];
  groupBy?: string;
}

const FILTER_OPS_SET: ReadonlySet<string> = new Set<TableFilterOp>([
  "eq",
  "neq",
  "gt",
  "lt",
  "contains",
  "in",
  "empty",
  "before",
  "after",
  "older_than",
]);

export interface TableViewDomain {
  id: string;
  tableId: string;
  name: string;
  type: TableViewType;
  config: TableViewConfig;
  visibility: TableViewVisibility;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CellProvenanceDomain {
  id: string;
  propertyId: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  appliedValue: unknown;
  previousValue: unknown;
  confidence: number | null;
  appliedAt: Date;
  appliedBy: string;
  rolledBackAt: Date | null;
}

export type PendingPatchReason = "low_confidence" | "overwrite";

export interface PendingPatchDomain {
  id: string;
  tableId: string;
  tableRowId: string;
  propertyId: string;
  proposedValue: unknown;
  currentValue: unknown;
  confidence: number;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  reason: PendingPatchReason | null;
  createdAt: Date;
}

export function tableFromApi(t: TableApi): TableDomain {
  return {
    id: t.id,
    tenantId: t.tenantId,
    name: t.name,
    description: t.description,
    icon: t.icon,
    coverImageS3: t.coverImageS3,
    parentDocumentId: t.parentDocumentId,
    entitySync: t.entitySync,
    defaultViewId: t.defaultViewId,
    archivedAt: t.archivedAt ? new Date(t.archivedAt) : null,
    isSystem: t.isSystem ?? false,
    systemKey: t.systemKey ?? null,
    createdBy: t.createdBy,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  };
}

export function propertyFromApi(p: TablePropertyApi): TablePropertyDomain {
  return {
    id: p.id,
    tableId: p.tableId,
    name: p.name,
    type: p.type,
    config: p.config ?? {},
    isPrimary: p.isPrimary,
    order: p.order,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

export function rowFromApi(r: TableRowApi): TableRowDomain {
  return {
    id: r.id,
    tableId: r.tableId,
    tenantId: r.tenantId,
    cells: r.cells ?? {},
    entityId: r.entityId,
    order: r.order,
    archivedAt: r.archivedAt ? new Date(r.archivedAt) : null,
    createdBy: r.createdBy,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    pageContent: r.pageContent,
  };
}

export function tableViewFromApi(v: TableViewApi): TableViewDomain {
  const rawConfig = (v.config ?? {}) as Record<string, unknown>;
  const config: TableViewConfig = {};
  if (Array.isArray(rawConfig.hiddenProps)) {
    config.hiddenProps = rawConfig.hiddenProps.filter(
      (x): x is string => typeof x === "string",
    );
  }
  if (Array.isArray(rawConfig.propOrder)) {
    config.propOrder = rawConfig.propOrder.filter(
      (x): x is string => typeof x === "string",
    );
  }
  if (
    rawConfig.rowHeight === "compact" ||
    rawConfig.rowHeight === "default" ||
    rawConfig.rowHeight === "tall"
  ) {
    config.rowHeight = rawConfig.rowHeight;
  }
  if (Array.isArray(rawConfig.sorts)) {
    config.sorts = rawConfig.sorts.filter(
      (s): s is { propertyId: string; direction: "asc" | "desc" } =>
        !!s &&
        typeof s === "object" &&
        typeof (s as { propertyId?: unknown }).propertyId === "string" &&
        ((s as { direction?: unknown }).direction === "asc" ||
          (s as { direction?: unknown }).direction === "desc"),
    );
  }
  if (Array.isArray(rawConfig.filters)) {
    config.filters = rawConfig.filters.filter(
      (f): f is TableFilterCondition => {
        if (!f || typeof f !== "object") return false;
        const o = f as Record<string, unknown>;
        if (typeof o.propertyId !== "string") return false;
        return typeof o.op === "string" && FILTER_OPS_SET.has(o.op);
      },
    );
  }
  if (typeof rawConfig.groupBy === "string") {
    config.groupBy = rawConfig.groupBy;
  }
  return {
    id: v.id,
    tableId: v.tableId,
    name: v.name,
    type: v.type,
    config,
    visibility: v.visibility,
    ownerId: v.ownerId,
    createdAt: new Date(v.createdAt),
    updatedAt: new Date(v.updatedAt),
  };
}

export function cellProvenanceFromApi(
  p: CellProvenanceApi,
): CellProvenanceDomain {
  return {
    id: p.id,
    propertyId: p.propertyId,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    sourceLabel: p.sourceLabel,
    sourceLink: p.sourceLink,
    appliedValue: p.appliedValue,
    previousValue: p.previousValue,
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    appliedAt: new Date(p.appliedAt),
    appliedBy: p.appliedBy,
    rolledBackAt: p.rolledBackAt ? new Date(p.rolledBackAt) : null,
  };
}

export function pendingPatchFromApi(p: PendingPatchApi): PendingPatchDomain {
  const reason: PendingPatchReason | null =
    p.reason === "low_confidence" || p.reason === "overwrite" ? p.reason : null;
  return {
    id: p.id,
    tableId: p.tableId,
    tableRowId: p.tableRowId,
    propertyId: p.propertyId,
    proposedValue: p.proposedValue,
    currentValue: p.currentValue,
    confidence: typeof p.confidence === "number" ? p.confidence : 0,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    sourceLabel: p.sourceLabel,
    sourceLink: p.sourceLink,
    reason,
    createdAt: new Date(p.createdAt),
  };
}

export const PENDING_PATCH_REASON_LABEL_RU: Record<PendingPatchReason, string> =
  {
    low_confidence: "низкая уверенность",
    overwrite: "перезапись значения",
  };

export function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null || !Number.isFinite(confidence)) return "";
  const fraction = confidence > 1 ? confidence / 100 : confidence;
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(fraction);
}

export const VIEW_VISIBILITY_LABEL_RU: Record<TableViewVisibility, string> = {
  personal: "Только мне",
  shared: "Всей команде",
  public: "Публичная ссылка",
};

export function tableViewConfigToApi(
  config: TableViewConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.hiddenProps && config.hiddenProps.length > 0) {
    out.hiddenProps = config.hiddenProps;
  }
  if (config.propOrder && config.propOrder.length > 0) {
    out.propOrder = config.propOrder;
  }
  if (config.rowHeight) out.rowHeight = config.rowHeight;
  if (config.sorts && config.sorts.length > 0) out.sorts = config.sorts;
  if (config.filters && config.filters.length > 0) out.filters = config.filters;
  if (config.groupBy) out.groupBy = config.groupBy;
  return out;
}

export const PROP_TYPE_LABEL_RU: Record<TablePropType, string> = {
  text: "Текст",
  longtext: "Длинный текст",
  number: "Число",
  currency: "Валюта",
  percent: "Процент",
  date: "Дата",
  status: "Статус",
  selectSingle: "Один выбор",
  selectMulti: "Несколько вариантов",
  checkbox: "Галочка",
  person: "Человек",
  url: "Ссылка",
  email: "E-mail",
  phone: "Телефон",
  file: "Файл",
  formula: "Формула",
  relation: "Связь",
  rollup: "Сводка",
  createdAt: "Создано",
  updatedAt: "Обновлено",
  createdBy: "Кем создано",
  entityLink: "Сущность графа",
  meetingLink: "Встреча",
  documentLink: "Документ",
};

export const FAZA1_SUPPORTED_TYPES: ReadonlySet<TablePropType> = new Set([
  "text",
  "longtext",
  "number",
  "currency",
  "percent",
  "date",
  "status",
  "selectSingle",
  "selectMulti",
  "checkbox",
  "person",
  "url",
  "email",
  "phone",
  "createdAt",
  "updatedAt",
  "createdBy",
]);

export type InferredEntitySyncType = "org" | "person" | "meeting" | "document";

export const ENTITY_SYNC_LABEL_RU: Record<InferredEntitySyncType, string> = {
  org: "Организации",
  person: "Люди",
  meeting: "Встречи",
  document: "Документы",
};

export interface InferredSchemaProperty {
  name: string;
  type: TablePropType;
  isPrimary: boolean;
  config?: Record<string, unknown>;
}

export interface InferredTableSchema {
  name: string;
  description: string | null;
  icon: string | null;
  entitySync: { type: InferredEntitySyncType } | null;
  properties: InferredSchemaProperty[];
}

export interface ImportMergeCandidate {
  tableId: string;
  name: string;
  cosine: number;
}

export interface ImportAnalyzeResult {
  schema: InferredTableSchema;
  rows: string[][];
  rawRowsCount: number;
  truncated: boolean;
  truncatedColumns: boolean;
  mergeCandidates: ImportMergeCandidate[];
}

const ALL_PROP_TYPES = new Set<string>(Object.keys(PROP_TYPE_LABEL_RU));
const ENTITY_SYNC_TYPES = new Set<string>([
  "org",
  "person",
  "meeting",
  "document",
]);

export function isInferredTableSchema(x: unknown): x is InferredTableSchema {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string") return false;
  if (o.description !== null && typeof o.description !== "string") return false;
  if (o.icon !== null && typeof o.icon !== "string") return false;
  if (o.entitySync !== null) {
    if (!o.entitySync || typeof o.entitySync !== "object") return false;
    const sync = o.entitySync as Record<string, unknown>;
    if (typeof sync.type !== "string" || !ENTITY_SYNC_TYPES.has(sync.type)) {
      return false;
    }
  }
  if (!Array.isArray(o.properties)) return false;
  return o.properties.every((p) => {
    if (!p || typeof p !== "object") return false;
    const prop = p as Record<string, unknown>;
    if (typeof prop.name !== "string") return false;
    if (typeof prop.type !== "string" || !ALL_PROP_TYPES.has(prop.type)) {
      return false;
    }
    if (typeof prop.isPrimary !== "boolean") return false;
    return true;
  });
}

export const FAZA1_CREATABLE_TYPES: readonly TablePropType[] = [
  "text",
  "longtext",
  "number",
  "currency",
  "percent",
  "date",
  "status",
  "selectSingle",
  "selectMulti",
  "checkbox",
  "person",
  "url",
  "email",
  "phone",
] as const;

export const COMPUTED_TYPES: ReadonlySet<TablePropType> = new Set([
  "createdAt",
  "updatedAt",
  "createdBy",
]);

export function isSupportedInPhase1(type: TablePropType): boolean {
  return FAZA1_SUPPORTED_TYPES.has(type);
}

export function isComputed(type: TablePropType): boolean {
  return COMPUTED_TYPES.has(type);
}

export function isReadonlyProperty(
  prop:
    | Pick<TablePropertyDomain, "config">
    | { config?: Record<string, unknown> | null }
    | null
    | undefined,
): boolean {
  const config = prop?.config;
  if (!config || typeof config !== "object") return false;
  return config.readonly === true || config.source === "entity";
}

export function formatCellValue(value: unknown, type: TablePropType): string {
  if (value === null || value === undefined || value === "") return "";

  switch (type) {
    case "text":
    case "longtext":
    case "url":
    case "email":
    case "phone":
      return String(value);

    case "number":
      return formatNumber(value);

    case "currency": {
      const num = toNumber(value);
      if (num === null) return "";
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 2,
      }).format(num);
    }

    case "percent": {
      const num = toNumber(value);
      if (num === null) return "";
      return new Intl.NumberFormat("ru-RU", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(num > 1 ? num / 100 : num);
    }

    case "date":
    case "createdAt":
    case "updatedAt":
      try {
        return new Date(String(value)).toLocaleDateString("ru-RU");
      } catch {
        return String(value);
      }

    case "checkbox":
      return value ? "Да" : "Нет";

    case "status":
    case "selectSingle": {
      if (typeof value === "object" && value !== null && "name" in value) {
        return String((value as { name: unknown }).name ?? "");
      }
      return String(value);
    }

    case "selectMulti": {
      if (Array.isArray(value)) {
        return value
          .map((v) =>
            typeof v === "object" && v !== null && "name" in v
              ? String((v as { name: unknown }).name ?? "")
              : String(v),
          )
          .join(", ");
      }
      return String(value);
    }

    case "person":
    case "createdBy": {
      if (typeof value === "object" && value !== null && "name" in value) {
        return String((value as { name: unknown }).name ?? "");
      }
      return String(value);
    }

    default:
      return "Тип пока не поддерживается";
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const s0 = value.replace(/[^\d.,\-]/g, "");
    if (!s0) return null;
    const lastComma = s0.lastIndexOf(",");
    const lastDot = s0.lastIndexOf(".");
    const s =
      lastComma > lastDot
        ? s0.replace(/\./g, "").replace(",", ".")
        : s0.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNumber(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return String(value ?? "");
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(n);
}

function cellToStrings(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => cellToStrings(v));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const label = o.name ?? o.id;
    return label === undefined || label === null ? [] : [String(label)];
  }
  return [String(value)];
}

function cellToDateMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function isCellEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const MS_PER_DAY = 86_400_000;

function isDatePropType(type: TablePropType | undefined): boolean {
  return type === "date" || type === "createdAt" || type === "updatedAt";
}

function matchCondition(
  raw: unknown,
  cond: TableFilterCondition,
  now: number,
  propertyType?: TablePropType,
): boolean {
  switch (cond.op) {
    case "empty":
      return isCellEmpty(raw);

    case "eq":
    case "neq": {
      if (isCellEmpty(raw)) return false;

      if (isDatePropType(propertyType)) {
        const cellMs = cellToDateMs(raw);
        const targetMs = cellToDateMs(cond.value);
        if (cellMs !== null && targetMs !== null) {
          const sameDay =
            Math.floor(cellMs / MS_PER_DAY) ===
            Math.floor(targetMs / MS_PER_DAY);
          return cond.op === "eq" ? sameDay : !sameDay;
        }
      }

      const target = cellToStrings(cond.value)[0] ?? "";
      const cells = cellToStrings(raw);
      const hit = cells.some((c) => c.toLowerCase() === target.toLowerCase());
      return cond.op === "eq" ? hit : !hit;
    }

    case "contains": {
      if (typeof cond.value !== "string") return false;
      const needle = cond.value.trim().toLowerCase();
      if (needle === "") return false;
      return cellToStrings(raw).some((c) => c.toLowerCase().includes(needle));
    }

    case "in": {
      if (!Array.isArray(cond.value)) return false;
      const set = new Set(
        cond.value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.toLowerCase()),
      );
      if (set.size === 0) return false;
      return cellToStrings(raw).some((c) => set.has(c.toLowerCase()));
    }

    case "gt":
    case "lt": {
      const cellNum = toNumber(raw);
      const targetNum = toNumber(cond.value);
      if (cellNum !== null && targetNum !== null) {
        return cond.op === "gt" ? cellNum > targetNum : cellNum < targetNum;
      }
      const cellDate = cellToDateMs(raw);
      const targetDate = cellToDateMs(cond.value);
      if (cellDate !== null && targetDate !== null) {
        return cond.op === "gt" ? cellDate > targetDate : cellDate < targetDate;
      }
      return false;
    }

    case "before":
    case "after": {
      const cellDate = cellToDateMs(raw);
      const targetDate = cellToDateMs(cond.value);
      if (cellDate === null || targetDate === null) return false;
      return cond.op === "before"
        ? cellDate < targetDate
        : cellDate > targetDate;
    }

    case "older_than": {
      const days = toNumber(cond.value);
      if (days === null || days <= 0) return false;
      const cellDate = cellToDateMs(raw);
      if (cellDate === null) return false;
      return cellDate < now - days * MS_PER_DAY;
    }

    default:
      return false;
  }
}

export function applyFilters<R extends { cells: Record<string, unknown> }>(
  rows: readonly R[],
  filters: readonly TableFilterCondition[] | undefined,
  properties: ReadonlyArray<{ id: string; type?: TablePropType }>,
  now: number = Date.now(),
): R[] {
  if (!filters || filters.length === 0) return [...rows];
  const typeById = new Map<string, TablePropType | undefined>();
  for (const p of properties) typeById.set(p.id, p.type);
  const knownIds = new Set(properties.map((p) => p.id));
  const active = filters.filter((f) => knownIds.has(f.propertyId));
  if (active.length === 0) return [...rows];
  return rows.filter((row) =>
    active.every((cond) =>
      matchCondition(
        row.cells[cond.propertyId],
        cond,
        now,
        typeById.get(cond.propertyId),
      ),
    ),
  );
}

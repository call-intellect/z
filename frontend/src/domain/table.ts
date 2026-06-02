/**
 * DomainModel Smart Tables (Фаза 1).
 *
 * Маппит ApiDto → DomainModel:
 *   - даты-строки в `Date`.
 *   - сужает enum'ы.
 *   - добавляет UI-метаданные: PROP_TYPE_LABEL_RU, поддерживаемые типы.
 *
 * Список типов синхронизирован с backend Prisma enum `TablePropType`.
 */

import type {
  TableApi,
  TablePropTypeApi,
  TablePropertyApi,
  TableRowApi,
  TableViewApi,
  TableViewTypeApi,
  TableViewVisibilityApi,
} from '@/api/types/tables';

// Re-export enum'ов как domain-типов — UI работает с этими названиями.
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

// ─────────────────────────── TableView (Saved Views, Фаза 3) ─────────────

/**
 * Семантика полей конфига сохраняемого вида.
 *
 * Все поля опциональны: пустой config = «всё видимо, без сортировки, без
 * фильтров». На бэк уходит как `Record<string, unknown>` без жёсткой Zod-
 * валидации (см. backend DTO) — стабильность UI обеспечивает этот тип.
 */
export interface TableViewConfig {
  /** Какие propertyId скрыть из отрисовки. Фаза 3. */
  hiddenProps?: string[];
  /** Кастомный порядок колонок (override `TableProperty.order`). Фаза 3. */
  propOrder?: string[];
  /** Плотность строк Grid (compact / default / tall). Фаза 3. */
  rowHeight?: 'compact' | 'default' | 'tall';
  /** Локальная сортировка (Фаза 3 — минимально, equality + order). */
  sorts?: Array<{ propertyId: string; direction: 'asc' | 'desc' }>;
  /** Простые фильтры. Полноценно — Фаза 4. */
  filters?: Array<{
    propertyId: string;
    op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
    value: unknown;
  }>;
  /** Для канбана/группировок. Фаза 4. */
  groupBy?: string;
}

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

// ─────────────────────────── мапперы ─────────────────────────────────────

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
  // `config` приходит как Record<string, unknown>. Безопасно сужаем до
  // TableViewConfig (поля опциональные, неизвестные ключи игнорятся).
  const rawConfig = (v.config ?? {}) as Record<string, unknown>;
  const config: TableViewConfig = {};
  if (Array.isArray(rawConfig.hiddenProps)) {
    config.hiddenProps = rawConfig.hiddenProps.filter(
      (x): x is string => typeof x === 'string',
    );
  }
  if (Array.isArray(rawConfig.propOrder)) {
    config.propOrder = rawConfig.propOrder.filter(
      (x): x is string => typeof x === 'string',
    );
  }
  if (
    rawConfig.rowHeight === 'compact' ||
    rawConfig.rowHeight === 'default' ||
    rawConfig.rowHeight === 'tall'
  ) {
    config.rowHeight = rawConfig.rowHeight;
  }
  if (Array.isArray(rawConfig.sorts)) {
    config.sorts = rawConfig.sorts.filter(
      (s): s is { propertyId: string; direction: 'asc' | 'desc' } =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as { propertyId?: unknown }).propertyId === 'string' &&
        ((s as { direction?: unknown }).direction === 'asc' ||
          (s as { direction?: unknown }).direction === 'desc'),
    );
  }
  if (Array.isArray(rawConfig.filters)) {
    config.filters = rawConfig.filters.filter(
      (
        f,
      ): f is {
        propertyId: string;
        op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
        value: unknown;
      } => {
        if (!f || typeof f !== 'object') return false;
        const o = f as Record<string, unknown>;
        if (typeof o.propertyId !== 'string') return false;
        return (
          o.op === 'eq' ||
          o.op === 'neq' ||
          o.op === 'contains' ||
          o.op === 'gt' ||
          o.op === 'lt'
        );
      },
    );
  }
  if (typeof rawConfig.groupBy === 'string') {
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

/** Метки видимости для UI (русский, по `feedback_admin_ui_russian_only`). */
export const VIEW_VISIBILITY_LABEL_RU: Record<TableViewVisibility, string> = {
  personal: 'Только мне',
  shared: 'Всей команде',
  public: 'Публичная ссылка',
};

/** Сериализация TableViewConfig обратно в JSON для отправки на backend. */
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

// ─────────────────────────── лейблы типов ────────────────────────────────

export const PROP_TYPE_LABEL_RU: Record<TablePropType, string> = {
  text: 'Текст',
  longtext: 'Длинный текст',
  number: 'Число',
  currency: 'Валюта',
  percent: 'Процент',
  date: 'Дата',
  status: 'Статус',
  selectSingle: 'Один выбор',
  selectMulti: 'Несколько вариантов',
  checkbox: 'Галочка',
  person: 'Человек',
  url: 'Ссылка',
  email: 'E-mail',
  phone: 'Телефон',
  file: 'Файл',
  formula: 'Формула',
  relation: 'Связь',
  rollup: 'Сводка',
  createdAt: 'Создано',
  updatedAt: 'Обновлено',
  createdBy: 'Кем создано',
  entityLink: 'Сущность графа',
  meetingLink: 'Встреча',
  documentLink: 'Документ',
};

/**
 * Типы, которые поддерживаются для редактирования в Grid-view Фазы 1.
 * Остальные показываются как «Тип пока не поддерживается».
 *
 * 14 интерактивных + 3 computed (read-only).
 */
export const FAZA1_SUPPORTED_TYPES: ReadonlySet<TablePropType> = new Set([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'createdAt',
  'updatedAt',
  'createdBy',
]);

/** Только реально редактируемые типы (без computed). Для UI кнопки «+ Колонка». */
export const FAZA1_CREATABLE_TYPES: readonly TablePropType[] = [
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
] as const;

/** Computed-типы (read-only, не редактируются). */
export const COMPUTED_TYPES: ReadonlySet<TablePropType> = new Set([
  'createdAt',
  'updatedAt',
  'createdBy',
]);

export function isSupportedInPhase1(type: TablePropType): boolean {
  return FAZA1_SUPPORTED_TYPES.has(type);
}

export function isComputed(type: TablePropType): boolean {
  return COMPUTED_TYPES.has(type);
}

// ─────────────────────────── формат значений ─────────────────────────────

/**
 * Текстовое представление значения ячейки. Для display-уровня в Grid.
 *
 * `value` — raw JSON-сериализуемое значение, как лежит в `TableRow.cells[propertyId]`.
 */
export function formatCellValue(
  value: unknown,
  type: TablePropType,
): string {
  if (value === null || value === undefined || value === '') return '';

  switch (type) {
    case 'text':
    case 'longtext':
    case 'url':
    case 'email':
    case 'phone':
      return String(value);

    case 'number':
      return formatNumber(value);

    case 'currency': {
      const num = toNumber(value);
      if (num === null) return '';
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 2,
      }).format(num);
    }

    case 'percent': {
      const num = toNumber(value);
      if (num === null) return '';
      return new Intl.NumberFormat('ru-RU', {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(num > 1 ? num / 100 : num);
    }

    case 'date':
    case 'createdAt':
    case 'updatedAt':
      try {
        return new Date(String(value)).toLocaleDateString('ru-RU');
      } catch {
        return String(value);
      }

    case 'checkbox':
      return value ? 'Да' : 'Нет';

    case 'status':
    case 'selectSingle': {
      if (typeof value === 'object' && value !== null && 'name' in value) {
        return String((value as { name: unknown }).name ?? '');
      }
      return String(value);
    }

    case 'selectMulti': {
      if (Array.isArray(value)) {
        return value
          .map((v) =>
            typeof v === 'object' && v !== null && 'name' in v
              ? String((v as { name: unknown }).name ?? '')
              : String(v),
          )
          .join(', ');
      }
      return String(value);
    }

    case 'person':
    case 'createdBy': {
      if (typeof value === 'object' && value !== null && 'name' in value) {
        return String((value as { name: unknown }).name ?? '');
      }
      return String(value);
    }

    default:
      return 'Тип пока не поддерживается';
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNumber(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return String(value ?? '');
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(n);
}

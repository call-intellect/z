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

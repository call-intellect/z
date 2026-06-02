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
  CellProvenanceApi,
  PendingPatchApi,
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
 * Операторы фильтра таблицы (Smart-tables Фаза 5 — NL Saved Views).
 * Синхронизировано с backend `FILTER_OPS`
 * (`backend/src/modules/tables/dto/table-filter.dto.ts`).
 *
 * Семантика:
 *   - eq/neq        — равно / не равно (любой тип).
 *   - contains      — подстрока (text/longtext/email/phone/url), case-insensitive.
 *   - gt/lt         — больше / меньше (number/currency/percent/date).
 *   - before/after  — дата строго раньше / позже заданной ISO-даты (value — строка-дата).
 *   - older_than    — значение-дата старше, чем N дней назад (value — число дней).
 *   - in            — значение ∈ массив (select/status/person; value — string[]).
 *   - empty         — ячейка пуста (value не нужен).
 */
export type TableFilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'contains'
  | 'in'
  | 'empty'
  | 'before'
  | 'after'
  | 'older_than';

/** Одно условие фильтра. Форма совпадает с backend `TableFilterCondition`. */
export interface TableFilterCondition {
  propertyId: string;
  op: TableFilterOp;
  /** Для `empty` не нужен; для остальных — зависит от оператора. */
  value?: unknown;
}

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
  /** Условия фильтра (AND). Полный набор операторов — Фаза 5 (NL Saved Views). */
  filters?: TableFilterCondition[];
  /** Для канбана/группировок. Фаза 4. */
  groupBy?: string;
}

/** Все валидные операторы фильтра (для type-guard при парсе config из API). */
const FILTER_OPS_SET: ReadonlySet<string> = new Set<TableFilterOp>([
  'eq',
  'neq',
  'gt',
  'lt',
  'contains',
  'in',
  'empty',
  'before',
  'after',
  'older_than',
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

// ─────────────── Provenance / pending-patches (Фаза 3) ────────────────────

/**
 * Происхождение значения ячейки (audit-link): откуда агент взял значение,
 * с какой уверенностью и когда применил. Если `rolledBackAt` != null —
 * правка была отменена (в UI скрываем такие записи).
 */
export interface CellProvenanceDomain {
  id: string;
  propertyId: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  appliedValue: unknown;
  previousValue: unknown;
  /** 0..1, либо null если уверенность не зафиксирована. */
  confidence: number | null;
  appliedAt: Date;
  appliedBy: string;
  rolledBackAt: Date | null;
}

/** Причина попадания авто-правки в очередь подтверждений. */
export type PendingPatchReason = 'low_confidence' | 'overwrite';

/**
 * Правка ячейки, ожидающая решения пользователя (очередь подтверждений).
 * `reason` сужаем до известных значений; неизвестное → null (бейдж не рисуем).
 */
export interface PendingPatchDomain {
  id: string;
  tableId: string;
  tableRowId: string;
  propertyId: string;
  proposedValue: unknown;
  currentValue: unknown;
  /** 0..1. */
  confidence: number;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  reason: PendingPatchReason | null;
  createdAt: Date;
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
      (f): f is TableFilterCondition => {
        if (!f || typeof f !== 'object') return false;
        const o = f as Record<string, unknown>;
        if (typeof o.propertyId !== 'string') return false;
        return typeof o.op === 'string' && FILTER_OPS_SET.has(o.op);
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
    confidence: typeof p.confidence === 'number' ? p.confidence : null,
    appliedAt: new Date(p.appliedAt),
    appliedBy: p.appliedBy,
    rolledBackAt: p.rolledBackAt ? new Date(p.rolledBackAt) : null,
  };
}

export function pendingPatchFromApi(p: PendingPatchApi): PendingPatchDomain {
  const reason: PendingPatchReason | null =
    p.reason === 'low_confidence' || p.reason === 'overwrite'
      ? p.reason
      : null;
  return {
    id: p.id,
    tableId: p.tableId,
    tableRowId: p.tableRowId,
    propertyId: p.propertyId,
    proposedValue: p.proposedValue,
    currentValue: p.currentValue,
    confidence: typeof p.confidence === 'number' ? p.confidence : 0,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    sourceLabel: p.sourceLabel,
    sourceLink: p.sourceLink,
    reason,
    createdAt: new Date(p.createdAt),
  };
}

/** Русские метки причины попадания правки в очередь подтверждений. */
export const PENDING_PATCH_REASON_LABEL_RU: Record<PendingPatchReason, string> =
  {
    low_confidence: 'низкая уверенность',
    overwrite: 'перезапись значения',
  };

/**
 * Уверенность в процентах для UI (например «уверенность 82%»).
 * Принимает как долю 0..1, так и уже-процент >1; null → пустая строка.
 */
export function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null || !Number.isFinite(confidence)) return '';
  const fraction = confidence > 1 ? confidence / 100 : confidence;
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
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

// ─────────────── Inferred schema (Text-to-Schema, Фаза 1) ────────────────

/** Тип привязки сгенерированной таблицы к памяти (сущностям графа). */
export type InferredEntitySyncType = 'org' | 'person' | 'meeting' | 'document';

/** Русские лейблы привязки к памяти для бейджа в превью схемы. */
export const ENTITY_SYNC_LABEL_RU: Record<InferredEntitySyncType, string> = {
  org: 'Организации',
  person: 'Люди',
  meeting: 'Встречи',
  document: 'Документы',
};

/** Одна колонка в сгенерированной/редактируемой схеме. */
export interface InferredSchemaProperty {
  name: string;
  type: TablePropType;
  isPrimary: boolean;
  config?: Record<string, unknown>;
}

/**
 * Сгенерированная Concierge-инструментом `infer_table_schema` схема таблицы.
 * Форма совпадает с backend `InferredTableSchemaDto`
 * (`backend/src/modules/tables/dto/tables.dto.ts`) и с телом
 * `POST /tables/from-schema` (`CreateTableFromSchemaBody`).
 */
export interface InferredTableSchema {
  name: string;
  description: string | null;
  icon: string | null;
  entitySync: { type: InferredEntitySyncType } | null;
  properties: InferredSchemaProperty[];
}

/**
 * Кандидат на слияние при импорте из файла (Фаза 4 Smart-tables
 * auto-creation). Backend сравнивает инферренную схему с существующими
 * таблицами по эмбеддингу и возвращает близкие по косинусной мере.
 * `cosine` — 0..1 (1 = идентичны).
 */
export interface ImportMergeCandidate {
  tableId: string;
  name: string;
  cosine: number;
}

/**
 * Результат анализа загруженного файла (Excel/CSV) для авто-создания
 * таблицы. Форма совпадает с backend-ответом
 * `POST /api/v1/tables/import/analyze`.
 *
 * `rows` — массив МАССИВОВ строк: `rows[i][j]` соответствует
 * `schema.properties[j]` ПО ПОРЯДКУ (propertyId ещё нет — таблица не
 * создана). Тот же формат уходит обратно в `import/commit`.
 */
export interface ImportAnalyzeResult {
  schema: InferredTableSchema;
  rows: string[][];
  rawRowsCount: number;
  truncated: boolean;
  /** true, если в файле было больше 50 колонок и лишние столбцы отброшены. */
  truncatedColumns: boolean;
  mergeCandidates: ImportMergeCandidate[];
}

const ALL_PROP_TYPES = new Set<string>(Object.keys(PROP_TYPE_LABEL_RU));
const ENTITY_SYNC_TYPES = new Set<string>(['org', 'person', 'meeting', 'document']);

/**
 * Type-guard для безопасного парса `ev.data` из SSE-события Concierge
 * (`tool_result` инструмента `infer_table_schema`). Проверяет форму, не
 * полагаясь на доверие к backend.
 */
export function isInferredTableSchema(x: unknown): x is InferredTableSchema {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== 'string') return false;
  if (o.description !== null && typeof o.description !== 'string') return false;
  if (o.icon !== null && typeof o.icon !== 'string') return false;
  if (o.entitySync !== null) {
    if (!o.entitySync || typeof o.entitySync !== 'object') return false;
    const sync = o.entitySync as Record<string, unknown>;
    if (typeof sync.type !== 'string' || !ENTITY_SYNC_TYPES.has(sync.type)) {
      return false;
    }
  }
  if (!Array.isArray(o.properties)) return false;
  return o.properties.every((p) => {
    if (!p || typeof p !== 'object') return false;
    const prop = p as Record<string, unknown>;
    if (typeof prop.name !== 'string') return false;
    if (typeof prop.type !== 'string' || !ALL_PROP_TYPES.has(prop.type)) {
      return false;
    }
    if (typeof prop.isPrimary !== 'boolean') return false;
    return true;
  });
}

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

/**
 * Read-only attribute-колонка (Smart-tables Фаза 2): значение приходит из
 * памяти компании / графа знаний (Entity) и редактируется в самой сущности,
 * а не в таблице.
 *
 * Backend помечает такие колонки в `config`:
 *   `{ readonly: true }` ИЛИ `{ source: 'entity', entityAttribute: '...' }`.
 * PATCH такой ячейки возвращает 422 `table_cell_readonly`
 * (см. `backend/src/modules/tables/services/table-rows.service.ts`).
 *
 * Хелпер принимает либо доменную property, либо «сырой» config —
 * чтобы вызываться и из Grid, и из карточки строки без дублирования логики.
 */
export function isReadonlyProperty(
  prop:
    | Pick<TablePropertyDomain, 'config'>
    | { config?: Record<string, unknown> | null }
    | null
    | undefined,
): boolean {
  const config = prop?.config;
  if (!config || typeof config !== 'object') return false;
  return config.readonly === true || config.source === 'entity';
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
  if (typeof value === 'string') {
    // Толерантный парс ru-RU чисел (зеркалит backend parseNumericLoose в
    // table-import.service.ts): срезаем валюту/%/буквы/пробелы (включая
    // неразрывные — разделители тысяч), затем определяем десятичный разделитель
    // по последнему вхождению `,`/`.` («1 234,56» → 1234.56; «1,234.56» → 1234.56).
    const s0 = value.replace(/[^\d.,\-]/g, '');
    if (!s0) return null;
    const lastComma = s0.lastIndexOf(',');
    const lastDot = s0.lastIndexOf('.');
    const s =
      lastComma > lastDot
        ? s0.replace(/\./g, '').replace(',', '.')
        : s0.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNumber(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return String(value ?? '');
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(n);
}

// ─────────────────────────── фильтры (Фаза 5) ────────────────────────────

/**
 * Извлекает сравнимое строковое представление значения ячейки для текстовых
 * операторов и `in`/`eq`/`neq` по статусам/селектам/людям. Учитывает формы,
 * в которых backend кладёт значения в `TableRow.cells`:
 *   - text/longtext/url/email/phone → string
 *   - status/selectSingle/person/createdBy → string ИЛИ объект `{ id?, name }`
 *   - selectMulti → массив (string | { id?, name })
 *   - createdAt/updatedAt/date → ISO-строка
 *
 * Возвращает массив атомарных строк (для скаляра — один элемент; для
 * selectMulti — несколько). Объект сводится к `name` (а если нет — к `id`).
 */
function cellToStrings(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => cellToStrings(v));
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const label = o.name ?? o.id;
    return label === undefined || label === null ? [] : [String(label)];
  }
  return [String(value)];
}

/** Дата из значения ячейки (ISO-строка / Date / число-таймстамп) → ms или null. */
function cellToDateMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Пуста ли ячейка: undefined / null / '' / пустой массив. */
function isCellEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const MS_PER_DAY = 86_400_000;

/** Является ли тип колонки датой (для календарного eq/neq и т.п.). */
function isDatePropType(type: TablePropType | undefined): boolean {
  return type === 'date' || type === 'createdAt' || type === 'updatedAt';
}

/**
 * Проверяет одно условие фильтра против значения ячейки `raw`.
 *
 * Контракт устойчивости: если значение нельзя осмысленно сравнить под
 * оператор (например, для `gt`/`before` ячейка не парсится в число/дату) —
 * строка НЕ проходит это условие (возвращаем false). Так фильтр никогда не
 * «роняется» и не показывает мусорные строки.
 *
 * `now` параметризован для детерминированных unit-тестов (older_than).
 */
function matchCondition(
  raw: unknown,
  cond: TableFilterCondition,
  now: number,
  propertyType?: TablePropType,
): boolean {
  switch (cond.op) {
    case 'empty':
      return isCellEmpty(raw);

    case 'eq':
    case 'neq': {
      // ФИКС 7: пустая ячейка не участвует в «равно/не равно X». И для eq, и для
      // neq возвращаем false — иначе neq:«Активен» ложно «проходил» бы строки с
      // пустым статусом (пустое ≠ «Активен» формально true, но семантически это
      // «значение не задано», а не «не равно X»). Симметрично с eq.
      if (isCellEmpty(raw)) return false;

      // ФИКС 3: для date-колонок сравниваем по КАЛЕНДАРНОМУ ДНЮ (floor к началу
      // суток UTC), а не по строкам — иначе «2026-05-30» и «2026-05-30T10:00:00Z»
      // считались бы разными. Если хотя бы одна сторона не парсится в дату —
      // падаем в строковое сравнение ниже.
      if (isDatePropType(propertyType)) {
        const cellMs = cellToDateMs(raw);
        const targetMs = cellToDateMs(cond.value);
        if (cellMs !== null && targetMs !== null) {
          const sameDay =
            Math.floor(cellMs / MS_PER_DAY) === Math.floor(targetMs / MS_PER_DAY);
          return cond.op === 'eq' ? sameDay : !sameDay;
        }
      }

      const target = cellToStrings(cond.value)[0] ?? '';
      const cells = cellToStrings(raw);
      const hit = cells.some(
        (c) => c.toLowerCase() === target.toLowerCase(),
      );
      return cond.op === 'eq' ? hit : !hit;
    }

    case 'contains': {
      if (typeof cond.value !== 'string') return false;
      const needle = cond.value.trim().toLowerCase();
      if (needle === '') return false;
      return cellToStrings(raw).some((c) =>
        c.toLowerCase().includes(needle),
      );
    }

    case 'in': {
      if (!Array.isArray(cond.value)) return false;
      const set = new Set(
        cond.value
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.toLowerCase()),
      );
      if (set.size === 0) return false;
      return cellToStrings(raw).some((c) => set.has(c.toLowerCase()));
    }

    case 'gt':
    case 'lt': {
      // number/currency/percent → числовое сравнение; date → по дате.
      // Пробуем число, затем дату (cond.value может быть ISO-строкой даты).
      const cellNum = toNumber(raw);
      const targetNum = toNumber(cond.value);
      if (cellNum !== null && targetNum !== null) {
        return cond.op === 'gt' ? cellNum > targetNum : cellNum < targetNum;
      }
      const cellDate = cellToDateMs(raw);
      const targetDate = cellToDateMs(cond.value);
      if (cellDate !== null && targetDate !== null) {
        return cond.op === 'gt'
          ? cellDate > targetDate
          : cellDate < targetDate;
      }
      return false;
    }

    case 'before':
    case 'after': {
      const cellDate = cellToDateMs(raw);
      const targetDate = cellToDateMs(cond.value);
      if (cellDate === null || targetDate === null) return false;
      return cond.op === 'before'
        ? cellDate < targetDate
        : cellDate > targetDate;
    }

    case 'older_than': {
      // value — число дней; ячейка-дата старше, чем (now - value дней).
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

/**
 * Применяет набор условий фильтра к строкам клиент-сайд (Smart-tables Фаза 5).
 *
 * Семантика — AND: строка проходит, только если выполнены ВСЕ условия. Пустой
 * массив условий → строки возвращаются без изменений. Условие с propertyId,
 * которого нет среди properties, игнорируется (не валит фильтр) — это безопасно,
 * т.к. backend уже валидирует фильтр против схемы, но UI остаётся устойчивым.
 *
 * `now` параметризован для тестируемости `older_than` (по умолчанию Date.now()).
 */
export function applyFilters<R extends { cells: Record<string, unknown> }>(
  rows: readonly R[],
  filters: readonly TableFilterCondition[] | undefined,
  properties: ReadonlyArray<{ id: string; type?: TablePropType }>,
  now: number = Date.now(),
): R[] {
  if (!filters || filters.length === 0) return [...rows];
  // Тип колонки по id — нужен matchCondition для date-aware операторов (eq/neq
  // по календарному дню). `type` опционален: старые вызовы без типа работают
  // как раньше (строковое сравнение).
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

'use client';

import '@glideapps/glide-data-grid/dist/index.css';

import {
  DataEditor,
  GridCellKind,
  type DataEditorProps,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridMouseEventArgs,
  type Item,
} from '@glideapps/glide-data-grid';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCallback, useMemo, useState } from 'react';

import {
  COMPUTED_TYPES,
  FAZA1_SUPPORTED_TYPES,
  formatCellValue,
  isReadonlyProperty,
  type TablePropertyDomain,
  type TableRowDomain,
} from '@/domain/table';

/**
 * Текст подсказки для read-only attribute-колонок (Smart-tables Фаза 2).
 * Значение приходит из памяти компании (граф знаний / Entity) и
 * редактируется в самой сущности, а не в таблице.
 */
const READONLY_HINT =
  'Значение приходит из памяти компании и редактируется в самой сущности';

/** Приглушённый тон для read-only attribute-ячеек (парные токены tokens.css). */
const READONLY_CELL_THEME = {
  bgCell: 'var(--bg-subtle)',
  textDark: 'var(--text-secondary)',
  textLight: 'var(--text-secondary)',
} as const;

/**
 * Тональная палитра для status / select ячеек.
 *
 * Glide Data Grid 6 не позволяет per-cell custom React-рендер без serialization
 * через `customRenderers` (это требует регистрации классов и риск ломки
 * copy/paste / undo). Безопасный путь — `themeOverride` на ячейке: подкрашиваем
 * фон и текст самой ячейки в тона `chip-*` из tokens.css. Это даёт визуальный
 * «цветной чип» без custom canvas-рендера.
 *
 * Если значение неизвестно — нейтральный тон.
 */
type CellTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_THEME: Record<
  CellTone,
  { bgCell: string; textDark: string; textLight: string }
> = {
  success: {
    bgCell: 'var(--chip-success-bg)',
    textDark: 'var(--chip-success-fg)',
    textLight: 'var(--chip-success-fg)',
  },
  warning: {
    bgCell: 'var(--chip-warning-bg)',
    textDark: 'var(--chip-warning-fg)',
    textLight: 'var(--chip-warning-fg)',
  },
  danger: {
    bgCell: 'var(--chip-danger-bg)',
    textDark: 'var(--chip-danger-fg)',
    textLight: 'var(--chip-danger-fg)',
  },
  info: {
    bgCell: 'var(--chip-info-bg)',
    textDark: 'var(--chip-info-fg)',
    textLight: 'var(--chip-info-fg)',
  },
  neutral: {
    bgCell: 'var(--bg-overlay)',
    textDark: 'var(--text-secondary)',
    textLight: 'var(--text-secondary)',
  },
};

/**
 * Эвристика тона по строке-значению статуса.
 * Совпадает с маппингом ColumnTypeSelector / админ-фильтров (русские синонимы).
 */
function pickToneByLabel(label: string): CellTone {
  const l = label.trim().toLowerCase();
  if (!l) return 'neutral';
  if (
    /^(готово|сделано|завершено|done|complete|closed|success|ок|ok)$/.test(l)
  )
    return 'success';
  if (
    /^(в работе|in.progress|active|идёт|идет|review|на проверке|открыт)$/.test(
      l,
    )
  )
    return 'info';
  if (
    /^(планируется|backlog|todo|новая|новое|новый|план|to.?do|ожидание|waiting)$/.test(
      l,
    )
  )
    return 'warning';
  if (
    /^(блокировано|отменено|cancelled|canceled|blocked|fail|failed|error|просрочено|overdue)$/.test(
      l,
    )
  )
    return 'danger';
  return 'neutral';
}

/**
 * Относительное представление даты для отображения в Grid: «2 часа назад»,
 * «3 дня назад». Если значение невалидное — пустая строка.
 *
 * Glide рисует только текст, поэтому это безопасный путь.
 */
function formatRelativeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  try {
    const date = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true, locale: ru });
  } catch {
    return '';
  }
}

/**
 * Обёртка `DataEditor` Glide Data Grid под наши DomainModel'и.
 *
 * Маппинг типов → GridCellKind:
 *   text / longtext / url / email / phone     → Text
 *   number / currency / percent               → Number
 *   checkbox                                  → Boolean (read-only overlay)
 *   status / selectSingle / selectMulti       → Bubble
 *   person                                    → Text (displayName)
 *   date                                      → Text (форматированный ISO)
 *   createdAt / updatedAt / createdBy         → Text, allowOverlay=false (read-only)
 *   все остальные (file/formula/relation/...) → Text «Тип пока не поддерживается»
 *
 * Drag&drop колонок и строк прокидывается наружу через коллбэки.
 * Glide встроенно поддерживает copy/paste: при `onPaste=true` + `getCellsForSelection`
 * вставка из Excel вызовет `onCellsEdited` / `onCellEdited` для диапазона.
 *
 * Провенанс авто-правок (Фаза 3): per-cell иконка-«звено» в canvas-гриде
 * Glide без custom-renderer'а недоступна, а backend отдаёт провенанс только
 * пер-строку (`GET rows/:rowId/provenance`) — массовая загрузка по всем
 * видимым строкам дала бы N запросов. Поэтому провенанс показываем в карточке
 * строки (RowDetail) и в панели подтверждений, а не в самом гриде. Здесь
 * остаётся только существующий маркер read-only attribute-колонок (🔗 в
 * заголовке).
 */
export interface GridViewProps {
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];
  onCellEdited: (rowId: string, propertyId: string, value: unknown) => void;
  onRowAppended: () => void;
  onColumnMoved: (from: number, to: number) => void;
  onRowMoved: (from: number, to: number) => void;
  /**
   * Открыть карточку строки (Фаза 2). Если не передан — клик по rowMarker
   * ничего не делает.
   */
  onOpenRow?: (rowId: string) => void;
  /**
   * Высота строки в пикселях (Фаза 3, saved views).
   * compact 24 / default 34 / tall 48. Default — 34, если не передан.
   */
  rowHeight?: number;
}

export function GridView({
  properties,
  rows,
  onCellEdited,
  onRowAppended,
  onColumnMoved,
  onRowMoved,
  onOpenRow,
  rowHeight,
}: GridViewProps) {
  // Read-only attribute-колонки (значение из памяти компании / графа знаний):
  // помечаем заголовок иконкой-«звеном» 🔗. Glide рисует заголовок на canvas и
  // не поддерживает произвольный React-элемент, поэтому префикс эмодзи —
  // самый надёжный минимальный способ. Подсказку показываем при наведении
  // (onItemHovered → headerHint).
  const columns = useMemo<GridColumn[]>(
    () =>
      properties.map((p) => ({
        id: p.id,
        title: isReadonlyProperty(p) ? `🔗 ${p.name}` : p.name,
        width: 180,
      })),
    [properties],
  );

  // Подсказка при наведении на заголовок read-only колонки.
  const [headerHint, setHeaderHint] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const getCellContent = useCallback<DataEditorProps['getCellContent']>(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const property = properties[col];
      const rowData = rows[row];
      if (!property || !rowData) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
        };
      }

      const raw = rowData.cells[property.id];

      // Не-Фаза-1 типы: показываем плейсхолдер, не позволяем редактировать.
      if (!FAZA1_SUPPORTED_TYPES.has(property.type)) {
        return {
          kind: GridCellKind.Text,
          data: 'Тип пока не поддерживается',
          displayData: 'Тип пока не поддерживается',
          allowOverlay: false,
          themeOverride: { textDark: 'var(--text-tertiary)' },
        };
      }

      // Read-only attribute-колонка: значение приходит из памяти компании
      // (граф знаний / Entity) и редактируется в самой сущности. Рисуем
      // приглушённую Text-ячейку без overlay-редактора — править нельзя.
      if (isReadonlyProperty(property)) {
        const display = formatCellValue(raw, property.type);
        return {
          kind: GridCellKind.Text,
          data: typeof raw === 'string' ? raw : display,
          displayData: display,
          allowOverlay: false,
          themeOverride: READONLY_CELL_THEME,
        };
      }

      const isReadOnly = COMPUTED_TYPES.has(property.type);

      switch (property.type) {
        case 'text':
        case 'longtext':
        case 'url':
        case 'email':
        case 'phone': {
          const display = formatCellValue(raw, property.type);
          return {
            kind: GridCellKind.Text,
            data: typeof raw === 'string' ? raw : display,
            displayData: display,
            allowOverlay: true,
          };
        }

        case 'number':
        case 'currency':
        case 'percent': {
          const num =
            typeof raw === 'number'
              ? raw
              : typeof raw === 'string' && raw.trim() !== ''
                ? Number(raw)
                : undefined;
          return {
            kind: GridCellKind.Number,
            data: Number.isFinite(num as number) ? (num as number) : undefined,
            displayData: formatCellValue(raw, property.type),
            allowOverlay: true,
          };
        }

        case 'checkbox':
          return {
            kind: GridCellKind.Boolean,
            data: Boolean(raw),
            allowOverlay: false,
          };

        case 'status':
        case 'selectSingle': {
          const label = formatCellValue(raw, property.type);
          // Префикс «●» рисует цветную точку. Bubble — иммутабельный
          // (overlay-редактор появится в следующих фазах с popover).
          // Сам Bubble оборачиваем в `themeOverride` — фон/текст подкрашиваем
          // в тон tokens.css. См. комментарий к TONE_THEME выше.
          const tone = label ? pickToneByLabel(label) : 'neutral';
          return {
            kind: GridCellKind.Bubble,
            data: label ? [label] : [],
            allowOverlay: true,
            themeOverride: label ? TONE_THEME[tone] : undefined,
          };
        }

        case 'selectMulti': {
          const arr = Array.isArray(raw)
            ? raw.map((v) =>
                typeof v === 'object' && v !== null && 'name' in v
                  ? String((v as { name: unknown }).name ?? '')
                  : String(v),
              )
            : [];
          // Тон берём по первому значению — нейтральная фоновая подкраска
          // ячейки. Per-bubble цвета в Glide 6 без custom renderer недоступны.
          const tone = arr.length > 0 ? pickToneByLabel(arr[0] ?? '') : 'neutral';
          return {
            kind: GridCellKind.Bubble,
            data: arr,
            allowOverlay: true,
            themeOverride: arr.length > 0 ? TONE_THEME[tone] : undefined,
          };
        }

        case 'date': {
          // Относительное время «3 дня назад» через date-fns. Сырое значение
          // хранится как ISO — `data` оставляем raw для копирования, а
          // `displayData` — для отрисовки.
          const display = formatRelativeDate(raw);
          return {
            kind: GridCellKind.Text,
            data: typeof raw === 'string' ? raw : formatCellValue(raw, property.type),
            displayData: display,
            allowOverlay: true,
          };
        }

        case 'person': {
          const display = formatCellValue(raw, property.type);
          return {
            kind: GridCellKind.Text,
            data: display,
            displayData: display,
            allowOverlay: true,
          };
        }

        case 'createdAt':
        case 'updatedAt':
        case 'createdBy': {
          // Computed — берём фактическое поле строки, ячейка cells игнорируется.
          // Для дат показываем относительное время («2 часа назад»), для
          // createdBy — id/имя как есть.
          let value: string;
          if (property.type === 'createdAt')
            value = formatRelativeDate(rowData.createdAt);
          else if (property.type === 'updatedAt')
            value = formatRelativeDate(rowData.updatedAt);
          else value = rowData.createdBy;
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            allowOverlay: false,
            themeOverride: isReadOnly
              ? { textDark: 'var(--text-tertiary)' }
              : undefined,
          };
        }

        default: {
          // Unreachable per FAZA1_SUPPORTED_TYPES guard, но TS exhaustive.
          return {
            kind: GridCellKind.Text,
            data: '',
            displayData: '',
            allowOverlay: false,
          };
        }
      }
    },
    [properties, rows],
  );

  const onCellEditedInner = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell;
      const property = properties[col];
      const rowData = rows[row];
      if (!property || !rowData) return;
      // Read-only attribute-колонка (значение из памяти компании) — игнорируем
      // правку (в т.ч. paste из Excel в диапазон), PATCH не шлём.
      if (isReadonlyProperty(property)) return;
      if (COMPUTED_TYPES.has(property.type)) return;
      if (!FAZA1_SUPPORTED_TYPES.has(property.type)) return;

      // Bubble не редактируется напрямую (нет EditableGridCell-ветки) —
      // изменение значений status/selectSingle/selectMulti делаем через
      // отдельный popover в будущих фазах. Пока обрабатываем editable-варианты.
      let value: unknown = undefined;
      switch (newValue.kind) {
        case GridCellKind.Text:
        case GridCellKind.Uri:
          value = newValue.data;
          break;
        case GridCellKind.Number:
          value = newValue.data ?? null;
          break;
        case GridCellKind.Boolean:
          value = Boolean(newValue.data);
          break;
        default: {
          const raw = (newValue as { data?: unknown }).data;
          value = raw;
        }
      }
      onCellEdited(rowData.id, property.id, value);
    },
    [properties, rows, onCellEdited],
  );

  const onColumnMovedInner = useCallback(
    (from: number, to: number) => {
      onColumnMoved(from, to);
    },
    [onColumnMoved],
  );

  const onRowMovedInner = useCallback(
    (from: number, to: number) => {
      onRowMoved(from, to);
    },
    [onRowMoved],
  );

  // Открытие карточки строки (Фаза 2).
  //
  // UX-решение: одиночный клик НЕ должен открывать карточку — он включает
  // inline-edit в Grid (нужно для быстрой правки таблицы). Поэтому используем
  // два триггера:
  //   1. Клик по row-marker (col === -1) — слева есть колонка с № строки и
  //      чекбоксом, клик по ней безопасно открывает карточку.
  //   2. Кнопка «Открыть» в первой колонке (вне Glide) — fallback из ТЗ. В
  //      Phase 2 пока используем (1), кнопочный fallback можно добавить
  //      позже отдельной колонкой если row-marker недостаточен.
  const onCellClicked = useCallback(
    (cell: Item, event: GridMouseEventArgs) => {
      if (!onOpenRow) return;
      const [col, row] = cell;
      if (col !== -1) return;
      if (event.button !== 0) return;
      const rowData = rows[row];
      if (!rowData) return;
      onOpenRow(rowData.id);
    },
    [rows, onOpenRow],
  );

  // Подсказка для read-only заголовков: показываем при наведении на header-
  // ячейку колонки с config.readonly/source==='entity'. Координаты — из
  // bounds события (позиция относительно вьюпорта).
  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind !== 'header') {
        setHeaderHint((prev) => (prev ? null : prev));
        return;
      }
      const [col] = args.location;
      const property = properties[col];
      if (property && isReadonlyProperty(property)) {
        setHeaderHint({
          x: args.bounds.x + args.bounds.width / 2,
          y: args.bounds.y + args.bounds.height,
        });
      } else {
        setHeaderHint((prev) => (prev ? null : prev));
      }
    },
    [properties],
  );

  return (
    <>
      {/* Portal element для overlay-редакторов Glide. */}
      <div
        id="portal"
        style={{ position: 'fixed', left: 0, top: 0, zIndex: 9999 }}
      />
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        onCellEdited={onCellEditedInner}
        onColumnMoved={onColumnMovedInner}
        onRowMoved={onRowMovedInner}
        onRowAppended={onRowAppended}
        onCellClicked={onCellClicked}
        onItemHovered={onItemHovered}
        rowMarkers="both"
        rowHeight={rowHeight ?? 34}
        smoothScrollX
        smoothScrollY
        getCellsForSelection
        onPaste
        trailingRowOptions={{
          sticky: true,
          tint: true,
          hint: 'Новая строка',
        }}
        width="100%"
        height={600}
      />
      {headerHint ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[10000] max-w-[260px] -translate-x-1/2 rounded-md border border-border-subtle bg-bg-overlay px-2.5 py-1.5 text-xs leading-snug text-fg-secondary shadow-md"
          style={{ left: headerHint.x, top: headerHint.y + 4 }}
        >
          {READONLY_HINT}
        </div>
      ) : null}
    </>
  );
}

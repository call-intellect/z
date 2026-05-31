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
import { useCallback, useMemo } from 'react';

import {
  COMPUTED_TYPES,
  FAZA1_SUPPORTED_TYPES,
  formatCellValue,
  type TablePropertyDomain,
  type TableRowDomain,
} from '@/domain/table';

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
  const columns = useMemo<GridColumn[]>(
    () =>
      properties.map((p) => ({
        id: p.id,
        title: p.name,
        width: 180,
      })),
    [properties],
  );

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
          themeOverride: { textDark: '#94a3b8' },
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
          return {
            kind: GridCellKind.Bubble,
            data: label ? [label] : [],
            allowOverlay: true,
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
          return {
            kind: GridCellKind.Bubble,
            data: arr,
            allowOverlay: true,
          };
        }

        case 'date': {
          const display = formatCellValue(raw, property.type);
          return {
            kind: GridCellKind.Text,
            data: typeof raw === 'string' ? raw : display,
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
          let value: string;
          if (property.type === 'createdAt')
            value = rowData.createdAt.toLocaleString('ru-RU');
          else if (property.type === 'updatedAt')
            value = rowData.updatedAt.toLocaleString('ru-RU');
          else value = rowData.createdBy;
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            allowOverlay: false,
            themeOverride: isReadOnly ? { textDark: '#94a3b8' } : undefined,
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
    </>
  );
}

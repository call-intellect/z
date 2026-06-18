"use client";

import "@glideapps/glide-data-grid/dist/index.css";

import {
  DataEditor,
  GridCellKind,
  type DataEditorProps,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridMouseEventArgs,
  type Item,
} from "@glideapps/glide-data-grid";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useCallback, useMemo, useState } from "react";

import {
  COMPUTED_TYPES,
  FAZA1_SUPPORTED_TYPES,
  formatCellValue,
  isReadonlyProperty,
  type TablePropertyDomain,
  type TableRowDomain,
} from "@/domain/table";

const READONLY_HINT =
  "Значение приходит из памяти компании и редактируется в самой сущности";

const READONLY_CELL_THEME = {
  bgCell: "var(--bg-subtle)",
  textDark: "var(--text-secondary)",
  textLight: "var(--text-secondary)",
} as const;

type CellTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_THEME: Record<
  CellTone,
  { bgCell: string; textDark: string; textLight: string }
> = {
  success: {
    bgCell: "var(--chip-success-bg)",
    textDark: "var(--chip-success-fg)",
    textLight: "var(--chip-success-fg)",
  },
  warning: {
    bgCell: "var(--chip-warning-bg)",
    textDark: "var(--chip-warning-fg)",
    textLight: "var(--chip-warning-fg)",
  },
  danger: {
    bgCell: "var(--chip-danger-bg)",
    textDark: "var(--chip-danger-fg)",
    textLight: "var(--chip-danger-fg)",
  },
  info: {
    bgCell: "var(--chip-info-bg)",
    textDark: "var(--chip-info-fg)",
    textLight: "var(--chip-info-fg)",
  },
  neutral: {
    bgCell: "var(--bg-overlay)",
    textDark: "var(--text-secondary)",
    textLight: "var(--text-secondary)",
  },
};

function pickToneByLabel(label: string): CellTone {
  const l = label.trim().toLowerCase();
  if (!l) return "neutral";
  if (/^(готово|сделано|завершено|done|complete|closed|success|ок|ok)$/.test(l))
    return "success";
  if (
    /^(в работе|in.progress|active|идёт|идет|review|на проверке|открыт)$/.test(
      l,
    )
  )
    return "info";
  if (
    /^(планируется|backlog|todo|новая|новое|новый|план|to.?do|ожидание|waiting)$/.test(
      l,
    )
  )
    return "warning";
  if (
    /^(блокировано|отменено|cancelled|canceled|blocked|fail|failed|error|просрочено|overdue)$/.test(
      l,
    )
  )
    return "danger";
  return "neutral";
}

function formatRelativeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  try {
    const date = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(date.getTime())) return "";
    return formatDistanceToNow(date, { addSuffix: true, locale: ru });
  } catch {
    return "";
  }
}

export interface GridViewProps {
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];
  onCellEdited: (rowId: string, propertyId: string, value: unknown) => void;
  onRowAppended: () => void;
  onColumnMoved: (from: number, to: number) => void;
  onRowMoved: (from: number, to: number) => void;
  onOpenRow?: (rowId: string) => void;
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
        title: isReadonlyProperty(p) ? `🔗 ${p.name}` : p.name,
        width: 180,
      })),
    [properties],
  );

  const [headerHint, setHeaderHint] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const getCellContent = useCallback<DataEditorProps["getCellContent"]>(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const property = properties[col];
      const rowData = rows[row];
      if (!property || !rowData) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
        };
      }

      const raw = rowData.cells[property.id];

      if (!FAZA1_SUPPORTED_TYPES.has(property.type)) {
        return {
          kind: GridCellKind.Text,
          data: "Тип пока не поддерживается",
          displayData: "Тип пока не поддерживается",
          allowOverlay: false,
          themeOverride: { textDark: "var(--text-tertiary)" },
        };
      }

      if (isReadonlyProperty(property)) {
        const display = formatCellValue(raw, property.type);
        return {
          kind: GridCellKind.Text,
          data: typeof raw === "string" ? raw : display,
          displayData: display,
          allowOverlay: false,
          themeOverride: READONLY_CELL_THEME,
        };
      }

      const isReadOnly = COMPUTED_TYPES.has(property.type);

      switch (property.type) {
        case "text":
        case "longtext":
        case "url":
        case "email":
        case "phone": {
          const display = formatCellValue(raw, property.type);
          return {
            kind: GridCellKind.Text,
            data: typeof raw === "string" ? raw : display,
            displayData: display,
            allowOverlay: true,
          };
        }

        case "number":
        case "currency":
        case "percent": {
          const num =
            typeof raw === "number"
              ? raw
              : typeof raw === "string" && raw.trim() !== ""
                ? Number(raw)
                : undefined;
          return {
            kind: GridCellKind.Number,
            data: Number.isFinite(num as number) ? (num as number) : undefined,
            displayData: formatCellValue(raw, property.type),
            allowOverlay: true,
          };
        }

        case "checkbox":
          return {
            kind: GridCellKind.Boolean,
            data: Boolean(raw),
            allowOverlay: false,
          };

        case "status":
        case "selectSingle": {
          const label = formatCellValue(raw, property.type);
          const tone = label ? pickToneByLabel(label) : "neutral";
          return {
            kind: GridCellKind.Bubble,
            data: label ? [label] : [],
            allowOverlay: true,
            themeOverride: label ? TONE_THEME[tone] : undefined,
          };
        }

        case "selectMulti": {
          const arr = Array.isArray(raw)
            ? raw.map((v) =>
                typeof v === "object" && v !== null && "name" in v
                  ? String((v as { name: unknown }).name ?? "")
                  : String(v),
              )
            : [];
          const tone =
            arr.length > 0 ? pickToneByLabel(arr[0] ?? "") : "neutral";
          return {
            kind: GridCellKind.Bubble,
            data: arr,
            allowOverlay: true,
            themeOverride: arr.length > 0 ? TONE_THEME[tone] : undefined,
          };
        }

        case "date": {
          const display = formatRelativeDate(raw);
          return {
            kind: GridCellKind.Text,
            data:
              typeof raw === "string"
                ? raw
                : formatCellValue(raw, property.type),
            displayData: display,
            allowOverlay: true,
          };
        }

        case "person": {
          const display = formatCellValue(raw, property.type);
          return {
            kind: GridCellKind.Text,
            data: display,
            displayData: display,
            allowOverlay: true,
          };
        }

        case "createdAt":
        case "updatedAt":
        case "createdBy": {
          let value: string;
          if (property.type === "createdAt")
            value = formatRelativeDate(rowData.createdAt);
          else if (property.type === "updatedAt")
            value = formatRelativeDate(rowData.updatedAt);
          else value = rowData.createdBy;
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            allowOverlay: false,
            themeOverride: isReadOnly
              ? { textDark: "var(--text-tertiary)" }
              : undefined,
          };
        }

        default: {
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
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
      if (isReadonlyProperty(property)) return;
      if (COMPUTED_TYPES.has(property.type)) return;
      if (!FAZA1_SUPPORTED_TYPES.has(property.type)) return;

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

  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind !== "header") {
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
      {}
      <div
        id="portal"
        style={{ position: "fixed", left: 0, top: 0, zIndex: 9999 }}
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
          hint: "Новая строка",
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

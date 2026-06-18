"use client";

import type { ReactNode } from "react";

import { CHART, GRAD, STATUS_TONE, glass } from "./tokens";

export function Avatar({
  name,
  grad = GRAD.violet,
}: {
  name: string;
  grad?: string;
}) {
  return (
    <div
      className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold"
      style={{ background: grad, color: CHART.text }}
    >
      {name.charAt(0)}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 w-28 overflow-hidden rounded-full"
        style={{ background: "var(--surface-inset-strong)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: GRAD.teal }}
        />
      </div>
      <span style={{ color: CHART.dim }}>{percent}%</span>
    </div>
  );
}

const STATUS_LABEL: Record<"ok" | "warning" | "risk", string> = {
  ok: "ок",
  warning: "внимание",
  risk: "риск",
};

export function StatusPill({ status }: { status: "ok" | "warning" | "risk" }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface ModernTableColumn<T> {
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
}

export function ModernTable<T>({
  title,
  titleIcon,
  titleGrad,
  columns,
  rows,
  getKey,
}: {
  title?: string;
  titleIcon?: ReactNode;
  titleGrad?: string;
  columns: ModernTableColumn<T>[];
  rows: T[];
  getKey: (row: T) => string;
}) {
  return (
    <div style={glass()} className="overflow-hidden p-6">
      {title && (
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl"
            style={{ background: titleGrad ?? GRAD.blue, color: CHART.text }}
          >
            {titleIcon}
          </span>
          <h3 className="text-[15px] font-semibold">{title}</h3>
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: CHART.faint }} className="text-left text-xs">
              {columns.map((col, ci) => (
                <th
                  key={col.header + ci}
                  className={`pb-3 font-medium${col.align === "right" ? " text-right" : ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getKey(row)}
                style={{ borderTop: "1px solid var(--border-inset)" }}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col.header + ci}
                    className={`py-3${col.align === "right" ? " text-right" : ""}`}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

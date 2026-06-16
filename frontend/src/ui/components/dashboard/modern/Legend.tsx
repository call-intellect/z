"use client";

import { CHART } from "./tokens";

export function Legend({ items }: { items: { c: string; t: string }[] }) {
  return (
    <div className="flex items-center gap-4">
      {items.map((it) => (
        <span
          key={it.t}
          className="flex items-center gap-2 text-xs"
          style={{ color: CHART.dim }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: it.c }}
          />
          {it.t}
        </span>
      ))}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

const ICON_ON_GRADIENT = "oklch(0.99 0.005 280)";
export function CardTitle({
  icon,
  grad,
  children,
}: {
  icon: ReactNode;
  grad: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 place-items-center rounded-xl"
        style={{ background: grad, color: ICON_ON_GRADIENT }}
      >
        {icon}
      </span>
      <h3 className="text-[15px] font-semibold">{children}</h3>
    </div>
  );
}

"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/ui/shadcn/lib/utils";
import type { CardDensity } from "@/hooks/tracker/useCardDensity";

export function CardDensityToggle({
  density,
  onChange,
}: {
  density: CardDensity;
  onChange: (next: CardDensity) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-bg-elevated p-0.5"
      role="group"
      aria-label="Плотность карточек"
    >
      <DensityButton
        active={density === "compact"}
        onClick={() => onChange("compact")}
        icon={<Rows3 size={13} />}
        label="Компактно"
      />
      <DensityButton
        active={density === "wide"}
        onClick={() => onChange("wide")}
        icon={<LayoutGrid size={13} />}
        label="Широко"
      />
    </div>
  );
}

function DensityButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
        active
          ? "bg-bg-overlay font-medium text-fg-primary"
          : "text-fg-tertiary hover:text-fg-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

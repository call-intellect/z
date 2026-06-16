import type { CSSProperties } from "react";

export const CHART = {
  text: "var(--text-primary)",
  dim: "var(--text-secondary)",
  faint: "var(--text-tertiary)",
  violet: "oklch(0.66 0.2 300)",
  indigo: "oklch(0.62 0.2 278)",
  blue: "oklch(0.7 0.16 245)",
  cyan: "oklch(0.8 0.13 205)",
  teal: "oklch(0.82 0.13 178)",
  mint: "oklch(0.85 0.15 165)",
  lime: "oklch(0.86 0.19 130)",
  amber: "oklch(0.84 0.16 80)",
  orange: "oklch(0.74 0.18 50)",
  pink: "oklch(0.74 0.2 350)",
  red: "oklch(0.66 0.22 25)",
} as const;

export const GRAD = {
  violet: "linear-gradient(135deg, oklch(0.7 0.2 300), oklch(0.58 0.2 268))",
  blue: "linear-gradient(135deg, oklch(0.74 0.15 240), oklch(0.62 0.18 270))",
  teal: "linear-gradient(135deg, oklch(0.86 0.15 168), oklch(0.74 0.13 205))",
  amber: "linear-gradient(135deg, oklch(0.86 0.16 85), oklch(0.72 0.18 45))",
  pink: "linear-gradient(135deg, oklch(0.78 0.2 350), oklch(0.62 0.2 300))",
} as const;

export function glass(extra?: CSSProperties): CSSProperties {
  return {
    background: "var(--glass-surface)",
    border: "1px solid var(--glass-border)",
    borderRadius: 22,
    boxShadow: "var(--glass-shadow)",
    backdropFilter: "var(--glass-blur)",
    WebkitBackdropFilter: "var(--glass-blur)",
    ...extra,
  };
}

export const MODERN_PAGE_BG: string = "var(--modern-page-bg)";

export const STATUS_TONE: Record<
  "ok" | "warning" | "risk",
  { c: string; bg: string }
> = {
  ok: { c: "var(--chip-success-fg)", bg: "var(--chip-success-bg)" },
  warning: { c: "var(--chip-warning-fg)", bg: "var(--chip-warning-bg)" },
  risk: { c: "var(--chip-danger-fg)", bg: "var(--chip-danger-bg)" },
};

export function kpiTone(
  value: number,
  threshold?: { green: number; yellow: number; inverted?: boolean },
): string {
  if (!threshold) return CHART.dim;
  if (threshold.inverted) {
    if (value <= threshold.green) return CHART.mint;
    if (value <= threshold.yellow) return CHART.amber;
    return CHART.red;
  }
  if (value >= threshold.green) return CHART.mint;
  if (value >= threshold.yellow) return CHART.amber;
  return CHART.red;
}

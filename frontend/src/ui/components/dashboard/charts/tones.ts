export type ChartTone = "success" | "warning" | "danger" | "accent" | "neutral";

export type ToneVars = {
  fg: string;
  bg: string;
};

const TONE_VARS: Record<ChartTone, ToneVars> = {
  success: { fg: "var(--chip-success-fg)", bg: "var(--chip-success-bg)" },
  warning: { fg: "var(--chip-warning-fg)", bg: "var(--chip-warning-bg)" },
  danger: { fg: "var(--chip-danger-fg)", bg: "var(--chip-danger-bg)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-muted)" },
  neutral: { fg: "var(--text-tertiary)", bg: "var(--bg-overlay)" },
};

export function toneVars(tone: ChartTone): ToneVars {
  return TONE_VARS[tone];
}

export function autoTone(ratio: number): ChartTone {
  if (Number.isNaN(ratio)) return "neutral";
  if (ratio < 0.3) return "danger";
  if (ratio < 0.7) return "warning";
  return "success";
}

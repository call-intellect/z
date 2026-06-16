export const GOAL_PROGRESS_STATUSES = [
  'on_track',
  'at_risk',
  'stalled',
  'achieved',
  'dropped',
] as const;

export type GoalProgressStatusKey = (typeof GOAL_PROGRESS_STATUSES)[number];

export type PortfolioByStatus = Record<GoalProgressStatusKey, number>;

export interface PortfolioHealthWeights {
  achieved: number;
  on_track: number;
  at_risk: number;
  stalled: number;
  dropped: number;
}

export interface PortfolioHealthThresholds {
  healthy: number;
  warning: number;
}

export const DEFAULT_PORTFOLIO_HEALTH_WEIGHTS: PortfolioHealthWeights = {
  achieved: 100,
  on_track: 80,
  at_risk: 40,
  stalled: 0,
  dropped: 0,
};

export const DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS: PortfolioHealthThresholds = {
  healthy: 60,
  warning: 40,
};

export type PortfolioHealthLevel = 'healthy' | 'warning' | 'critical';

export function emptyByStatus(): PortfolioByStatus {
  return { on_track: 0, at_risk: 0, stalled: 0, achieved: 0, dropped: 0 };
}

export function computePortfolioHealth(
  byStatus: PortfolioByStatus,
  weights: PortfolioHealthWeights,
): number {
  let total = 0;
  let weightedSum = 0;
  for (const s of GOAL_PROGRESS_STATUSES) {
    const c = safeNonNeg(byStatus[s]);
    const w = safeNonNeg(weights[s]);
    total += c;
    weightedSum += c * w;
  }
  if (total <= 0) return 0;
  const avg = weightedSum / total;
  return clamp0to100(Math.round(avg));
}

export function classifyPortfolioLevel(
  score: number,
  thresholds: PortfolioHealthThresholds,
): PortfolioHealthLevel {
  const s = safeNumber(score);
  const healthy = safeNumber(thresholds.healthy);
  const warning = safeNumber(thresholds.warning);
  if (s >= healthy) return 'healthy';
  if (s >= warning) return 'warning';
  return 'critical';
}

function clamp0to100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

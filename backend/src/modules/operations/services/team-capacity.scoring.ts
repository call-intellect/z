export type CapacityClass = 'overload' | 'underload' | 'ok';

export interface CapacityThresholds {
  overloadPercent: number;
  underloadPercent: number;
}

export const DEFAULT_CAPACITY_THRESHOLDS: CapacityThresholds = {
  overloadPercent: 120,
  underloadPercent: 50,
};

export function classifyCapacity(
  loadPercent: number,
  thresholds: CapacityThresholds,
): CapacityClass {
  const lp = safeNumber(loadPercent);
  const over = safeNumber(thresholds.overloadPercent);
  const under = safeNumber(thresholds.underloadPercent);
  if (lp > over) return 'overload';
  if (lp < under) return 'underload';
  return 'ok';
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

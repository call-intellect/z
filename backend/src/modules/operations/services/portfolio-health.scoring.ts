/**
 * ТЗ-2 Ф6.A (daily-value-dashboards) — чистая логика здоровья портфеля целей.
 *
 * Выделено отдельным модулем без зависимостей от Prisma/NestJS, чтобы покрыть
 * unit-тестами без БД/времени. Веса и пороги приходят аргументами (источник —
 * AdminSetting в `PortfolioHealthService`).
 */

/** Статусы движения цели (зеркало enum GoalProgressStatus). */
export const GOAL_PROGRESS_STATUSES = [
  'on_track',
  'at_risk',
  'stalled',
  'achieved',
  'dropped',
] as const;

export type GoalProgressStatusKey = (typeof GOAL_PROGRESS_STATUSES)[number];

export type PortfolioByStatus = Record<GoalProgressStatusKey, number>;

/**
 * Вес каждого статуса в интегральном здоровье портфеля (0..100). Достигнутые
 * и «в графике» цели тянут вверх, застрявшие/брошенные — вниз.
 */
export interface PortfolioHealthWeights {
  achieved: number;
  on_track: number;
  at_risk: number;
  stalled: number;
  dropped: number;
}

export interface PortfolioHealthThresholds {
  /** >= healthy → level 'healthy'. */
  healthy: number;
  /** >= warning → level 'warning'; иначе 'critical'. */
  warning: number;
}

/** Дефолты весов: достигнуто=100, в графике=80, риск=40, застряло/брошено=0. */
export const DEFAULT_PORTFOLIO_HEALTH_WEIGHTS: PortfolioHealthWeights = {
  achieved: 100,
  on_track: 80,
  at_risk: 40,
  stalled: 0,
  dropped: 0,
};

/** Дефолтные пороги: healthy=60, warning=40. */
export const DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS: PortfolioHealthThresholds = {
  healthy: 60,
  warning: 40,
};

export type PortfolioHealthLevel = 'healthy' | 'warning' | 'critical';

/** Нулевой разрез по статусам (для аккумулятора). */
export function emptyByStatus(): PortfolioByStatus {
  return { on_track: 0, at_risk: 0, stalled: 0, achieved: 0, dropped: 0 };
}

/**
 * Интегральное здоровье портфеля 0..100.
 *
 * Формула: `round(100 * Σ(weight_s * count_s) / total)`, зажатая в [0,100].
 * total = сумма count_s. total = 0 → 0. Веса заданы в шкале 0..100 (как баллы
 * статуса), поэтому делим итог на 100 (взвешенное среднее баллов статусов).
 * Неконечные/отрицательные счётчики/веса трактуются как 0 (защита от мусора).
 *
 * Чистая функция — для unit-тестов.
 */
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
  // weights в шкале 0..100 → взвешенное среднее уже в той же шкале; делим на 100
  // т.к. weightedSum = Σ(count * weight[0..100]) и нормируем средним веса.
  const avg = weightedSum / total; // 0..100
  return clamp0to100(Math.round(avg));
}

/**
 * Классификация уровня по порогам. `score >= healthy` → healthy;
 * `score >= warning` → warning; иначе critical. Чистая функция.
 */
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

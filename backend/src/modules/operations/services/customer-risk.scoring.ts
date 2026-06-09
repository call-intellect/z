/**
 * TZ-1 Фаза 1 (daily-value-engine) — чистая логика скоринга риска клиента.
 *
 * Выделено отдельным модулем без зависимостей от Prisma/NestJS, чтобы покрыть
 * unit-тестами без БД/времени. Веса и пороги приходят аргументами (источник —
 * AdminSetting в `CustomerRiskRadarService`).
 */

/** Сигналы, которые мы считаем риском денег/выручки. */
export const CUSTOMER_RISK_SIGNAL_TYPES = [
  'churn_risk',
  'objection',
  'pain',
  'feature_request',
] as const;

export type CustomerRiskSignalType =
  (typeof CUSTOMER_RISK_SIGNAL_TYPES)[number];

export type CustomerRiskLevel = 'critical' | 'warning' | 'ok';

export interface CustomerRiskSignalCounts {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
}

export interface CustomerRiskWeights {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
}

export interface CustomerRiskThresholds {
  critical: number;
  warning: number;
}

/** Дефолты весов: churn_risk весомее всего (деньги горят). */
export const DEFAULT_CUSTOMER_RISK_WEIGHTS: CustomerRiskWeights = {
  churn_risk: 5,
  objection: 3,
  pain: 2,
  feature_request: 1,
};

/** Дефолтные пороги: critical=10, warning=4. */
export const DEFAULT_CUSTOMER_RISK_THRESHOLDS: CustomerRiskThresholds = {
  critical: 10,
  warning: 4,
};

export const DEFAULT_CUSTOMER_RISK_WINDOW_DAYS = 14;

/** Нулевые счётчики (для аккумулятора). */
export function emptySignalCounts(): CustomerRiskSignalCounts {
  return { churn_risk: 0, objection: 0, pain: 0, feature_request: 0 };
}

/**
 * Взвешенная сумма сигналов. Чистая функция — для unit-тестов.
 * Неконечные/отрицательные счётчики/веса трактуются как 0 (защита от мусора).
 */
export function computeRiskScore(
  counts: CustomerRiskSignalCounts,
  weights: CustomerRiskWeights,
): number {
  let sum = 0;
  for (const t of CUSTOMER_RISK_SIGNAL_TYPES) {
    const c = safeNonNeg(counts[t]);
    const w = safeNumber(weights[t]);
    sum += c * w;
  }
  // Округление до 4 знаков (соответствует Decimal(8,4) в БД).
  return Math.round(sum * 10_000) / 10_000;
}

/**
 * Классификация уровня риска по порогам. `score >= critical` → critical;
 * `score >= warning` → warning; иначе ok. Чистая функция.
 *
 * Граница включается в верхний уровень (>=), как и порог Decimal в SQL-выборке.
 */
export function classifyRisk(
  score: number,
  thresholds: CustomerRiskThresholds,
): CustomerRiskLevel {
  const s = safeNumber(score);
  const crit = safeNumber(thresholds.critical);
  const warn = safeNumber(thresholds.warning);
  if (s >= crit) return 'critical';
  if (s >= warn) return 'warning';
  return 'ok';
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

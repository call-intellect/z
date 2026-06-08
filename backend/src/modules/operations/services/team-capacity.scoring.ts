/**
 * TZ-1 Фаза 4.D (daily-value-engine) — чистая логика классификации загрузки
 * команды по `Appointment.loadPercent`.
 *
 * Без зависимостей от Prisma/NestJS — unit-тестируется без БД.
 */

export type CapacityClass = 'overload' | 'underload' | 'ok';

export interface CapacityThresholds {
  /** Загрузка строго больше → перегруз. */
  overloadPercent: number;
  /** Загрузка строго меньше → недогруз. */
  underloadPercent: number;
}

/** Дефолтные пороги: перегруз > 120%, недогруз < 50%. */
export const DEFAULT_CAPACITY_THRESHOLDS: CapacityThresholds = {
  overloadPercent: 120,
  underloadPercent: 50,
};

/**
 * Классификация загрузки по порогам. Чистая функция.
 *   - `loadPercent > overloadPercent` → 'overload';
 *   - `loadPercent < underloadPercent` → 'underload';
 *   - иначе → 'ok'.
 *
 * Границы (== порог) трактуются как 'ok' (строгие неравенства).
 */
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

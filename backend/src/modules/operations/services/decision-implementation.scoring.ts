/**
 * TZ-1 Фаза 3.B (daily-value-engine) — чистая логика контролёра внедрения
 * решений. Без зависимостей от Prisma/NestJS (unit-тестируется без БД).
 */

export type DecisionImplementationStatus =
  | 'not_started'
  | 'in_progress'
  | 'done'
  | 'stalled';

export const DEFAULT_DECISION_STALE_DAYS = 21;

/**
 * Решение «застряло» (stalled), если:
 *   - старше `staleDays` (по `decidedAt` ИЛИ `createdAt`),
 *   - под ним 0 связанных задач (`linkedTaskCount === 0`),
 *   - нет фактических результатов (`hasOutcomes === false`).
 * Чистая функция.
 */
export function isDecisionStalled(args: {
  ageDays: number;
  linkedTaskCount: number;
  hasOutcomes: boolean;
  staleDays: number;
}): boolean {
  if (args.hasOutcomes) return false;
  if (safeNonNeg(args.linkedTaskCount) > 0) return false;
  return safeNonNeg(args.ageDays) >= safeNonNeg(args.staleDays);
}

/**
 * Статус внедрения решения. Чистая функция.
 *   - `done`        — есть actualOutcomes.
 *   - `stalled`     — застряло (см. isDecisionStalled).
 *   - `in_progress` — есть связанные задачи (но ещё нет outcomes).
 *   - `not_started` — нет ни задач, ни outcomes, и ещё не stalled.
 */
export function classifyImplementationStatus(args: {
  ageDays: number;
  linkedTaskCount: number;
  hasOutcomes: boolean;
  staleDays: number;
}): DecisionImplementationStatus {
  if (args.hasOutcomes) return 'done';
  if (
    isDecisionStalled({
      ageDays: args.ageDays,
      linkedTaskCount: args.linkedTaskCount,
      hasOutcomes: args.hasOutcomes,
      staleDays: args.staleDays,
    })
  ) {
    return 'stalled';
  }
  if (safeNonNeg(args.linkedTaskCount) > 0) return 'in_progress';
  return 'not_started';
}

/**
 * Агрегат пропускной способности решений: доля доведённых до actualOutcomes.
 * `throughputPercent` округляется до 1 знака. При `total === 0` → 0.
 * Чистая функция (несущая метрика витрины Ф5, Р7).
 */
export function computeDecisionThroughput(args: {
  total: number;
  doneWithOutcomes: number;
}): { total: number; doneWithOutcomes: number; throughputPercent: number } {
  const total = safeNonNeg(args.total);
  const done = Math.min(safeNonNeg(args.doneWithOutcomes), total);
  const pct = total > 0 ? (done / total) * 100 : 0;
  return {
    total,
    doneWithOutcomes: done,
    throughputPercent: Math.round(pct * 10) / 10,
  };
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

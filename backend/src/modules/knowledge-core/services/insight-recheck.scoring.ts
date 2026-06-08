/**
 * TZ-1 Фаза 4.B (daily-value-engine) — чистая логика re-check митигированных
 * инсайтов: если паттерн повторился после митигации, вернуть инсайт в active.
 *
 * Без зависимостей от Prisma/NestJS — unit-тестируется без БД/времени.
 */

export interface InsightRecheckInput {
  /** Текущий статус инсайта. */
  status: string;
  /**
   * Когда инсайт был митигирован (последнее подтверждение, `lastConfirmedAt`).
   * NULL — нет отметки (тогда берём `lastObservedAt`).
   */
  mitigatedAt: Date | null;
  /** Запасной маркер «когда видели последний блок» — если mitigatedAt NULL. */
  lastObservedAt: Date;
  /**
   * Сколько блоков-источников инсайта появилось ПОСЛЕ митигации (свежие
   * повторы паттерна). > 0 → паттерн вернулся.
   */
  recentRecurringBlockCount: number;
}

/**
 * Нужно ли реактивировать митигированный инсайт. Чистая функция.
 *
 * Условия (все обязательны):
 *   - статус инсайта == 'mitigated' (re-check только митигированных);
 *   - с момента митигации прошло >= `recheckDays` (даём митигации шанс
 *     сработать — не дёргаем на следующий день);
 *   - появился хотя бы один свежий блок-повтор (recentRecurringBlockCount > 0).
 *
 * Возвращает `false` для любого статуса кроме 'mitigated'.
 */
export function shouldReactivateInsight(
  input: InsightRecheckInput,
  now: Date,
  recheckDays: number,
): boolean {
  if (input.status !== 'mitigated') return false;
  if (safeNonNeg(input.recentRecurringBlockCount) <= 0) return false;

  const since = input.mitigatedAt ?? input.lastObservedAt;
  const ageDays = (now.getTime() - since.getTime()) / 86_400_000;
  return safeNonNeg(ageDays) >= safeNonNeg(recheckDays);
}

export const DEFAULT_INSIGHT_RECHECK_DAYS = 14;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

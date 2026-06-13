/**
 * Редизайн Ф4 «Требует вас» (2026-06-13) — единый расчёт `expiresAt` для
 * авто-протухающих источников очереди решений (ConflictItem / IntakeIssue).
 *
 * Одна функция-чистый-хелпер на все места создания: TTL приходит из
 * `cfg.pendingActions.conflictTtlDays` / `intakeTtlDays` (admin-editable
 * крутилка с code-fallback 16 / 30 дней), база — `createdAt` записи (по
 * умолчанию now). Так срок считается единообразно, без хардкода в 3+ местах.
 *
 * Sweep-крон (CurationItemLifecycleCron) закрывает записи с `expiresAt < now`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Вычисляет `expiresAt = from + ttlDays`. Если `ttlDays <= 0` или не конечное
 * число — возвращает `null` (бессрочно: некорректная крутилка не должна
 * мгновенно «протухать» свежие записи).
 */
export function computeExpiresAt(
  ttlDays: number,
  from: Date = new Date(),
): Date | null {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  return new Date(from.getTime() + ttlDays * DAY_MS);
}

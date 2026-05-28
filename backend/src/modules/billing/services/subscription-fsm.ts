/**
 * SubscriptionFSM — таблица переходов статусов подписки. Pure-функции,
 * без DI и БД. Использовать только через `SubscriptionService.transition`.
 *
 * Источник: plans/analysis/2026-05-25-billing-and-referrals.md §4.3
 *           plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §6.
 *
 * Граф:
 *
 *   DEMO   ────────► ACTIVE (admin activate paid/bonus)
 *   ACTIVE ────────► PAST_DUE (autopay failed) ──► SUSPENDED (grace expired)
 *   ACTIVE ────────► CANCELED (user toggled autoRenew=false; период ещё активен)
 *   ACTIVE ────────► EXPIRED  (bonus-период истёк) ──► DEMO (ручной сброс)
 *   CANCELED  ─────► EXPIRED  (период истёк после отмены)
 *   SUSPENDED ─────► ACTIVE   (новая оплата)
 *   PAST_DUE  ─────► ACTIVE   (charge удался; см. recurring cron)
 *   EXPIRED   ─────► ACTIVE   (новая оплата)
 *
 * Анти-стрелки (всегда запрещены):
 *   DEMO → CANCELED/EXPIRED  (нечего канселить — нет периода)
 *   CANCELED → PAST_DUE      (рекуррент уже выключен)
 *   CANCELED → ACTIVE        (только через новый платёж → renew/ACTIVE сразу)
 *
 * Force-переходы (через `ForceStatus` admin-эндпоинт) обходят FSM —
 * валидируются отдельно в `SubscriptionService.forceStatus` (только для
 * super_admin + обязательный reason).
 */

import { SubscriptionStatus } from '@prisma/client';

/**
 * Таблица допустимых переходов. `from → to[]`.
 *
 * NB: статус-в-себя (например `ACTIVE → ACTIVE`) НЕ включён как переход —
 * `transition()` идемпотентно возвращает success без события, см. сервис.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  DEMO: [SubscriptionStatus.ACTIVE],
  ACTIVE: [
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.EXPIRED,
  ],
  PAST_DUE: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED],
  SUSPENDED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
  CANCELED: [SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE],
  EXPIRED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.DEMO],
};

/** True если переход разрешён FSM-таблицей. */
export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Список разрешённых next-статусов для UI/диагностики. */
export function allowedNextStatuses(
  from: SubscriptionStatus,
): readonly SubscriptionStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Бросает Error с человекочитаемым сообщением если переход недопустим.
 * Не throw'ит для same-status (idempotent).
 */
export function assertCanTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (canTransition(from, to)) return;
  const allowed = ALLOWED_TRANSITIONS[from].join(', ');
  throw new Error(
    `Запрещённый переход FSM подписки: ${from} → ${to}. ` +
      `Допустимые из ${from}: ${allowed || 'нет'}.`,
  );
}

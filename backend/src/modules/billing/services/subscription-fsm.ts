import { SubscriptionStatus } from '@prisma/client';

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  DEMO: [SubscriptionStatus.ACTIVE],
  ACTIVE: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED],
  PAST_DUE: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED],
  SUSPENDED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
  CANCELED: [SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE],
  EXPIRED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.DEMO],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: SubscriptionStatus): readonly SubscriptionStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function assertCanTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (canTransition(from, to)) return;
  const allowed = ALLOWED_TRANSITIONS[from].join(', ');
  throw new Error(
    `Запрещённый переход FSM подписки: ${from} → ${to}. ` +
      `Допустимые из ${from}: ${allowed || 'нет'}.`,
  );
}

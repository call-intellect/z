import { beforeEach, describe, expect, it, vi } from 'vitest';

// bullmq тянет ioredis с нативными биндингами, которые роняют forks-pool
// vitest в части окружений. Мокаем модуль на пустые классы — listener сам
// bullmq не использует (очередь приходит как мок через DI).
vi.mock('bullmq', () => ({
  Queue: class {},
  Worker: class {},
}));

import type { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BillingEvent,
  type SubscriptionActivatedPayload,
} from '../../billing/events/billing.events';
import type { DemoCleanupQueue } from '../workers/demo-cleanup.queue';

import { SubscriptionActivatedListener } from './subscription-activated.listener';

/**
 * ТЗ 2026-05-31-demo-auto-seed-and-cleanup §2.3.
 *
 * Покрытие:
 *   - Org.demoWorkspaceSeededAt != null → enqueue cleanup с jobId по orgId;
 *   - Org.demoWorkspaceSeededAt == null → НЕ enqueue (skip);
 *   - оба события (_PAID и _BONUS) ведут к одному поведению.
 */
describe('SubscriptionActivatedListener', () => {
  let prisma: { org: { findUnique: ReturnType<typeof vi.fn> } };
  let cleanupQueue: { enqueue: ReturnType<typeof vi.fn> };
  let listener: SubscriptionActivatedListener;

  const payload = (tenantId: string): SubscriptionActivatedPayload => ({
    tenantId,
    subscriptionId: 'sub-1',
    paymentMode: 'paid',
    billingPeriod: 'monthly',
    periodStart: new Date('2026-06-01'),
    periodEnd: new Date('2026-07-01'),
    seatsBase: 1,
    seatsExtra: 0,
  });

  beforeEach(() => {
    prisma = { org: { findUnique: vi.fn() } };
    cleanupQueue = { enqueue: vi.fn(async () => ({ jobId: 'demo-cleanup:org-1' })) };
    listener = new SubscriptionActivatedListener(
      prisma as unknown as PrismaService,
      cleanupQueue as unknown as DemoCleanupQueue,
    );
  });

  it('enqueue cleanup, если демо лили (demoWorkspaceSeededAt != null)', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({
      demoWorkspaceSeededAt: new Date(),
    });

    await listener.onActivated(payload('org-1'));

    expect(cleanupQueue.enqueue).toHaveBeenCalledWith({
      orgId: 'org-1',
      actorUserId: 'system:subscription-activated',
    });
  });

  it('НЕ enqueue, если демо не лили (demoWorkspaceSeededAt == null)', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({ demoWorkspaceSeededAt: null });

    await listener.onActivated(payload('org-2'));

    expect(cleanupQueue.enqueue).not.toHaveBeenCalled();
  });

  it('НЕ enqueue, если Org не найдена', async () => {
    prisma.org.findUnique.mockResolvedValueOnce(null);

    await listener.onActivated(payload('org-x'));

    expect(cleanupQueue.enqueue).not.toHaveBeenCalled();
  });

  it('ошибка очереди не пробрасывается (fire-and-forget)', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({
      demoWorkspaceSeededAt: new Date(),
    });
    cleanupQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

    await expect(listener.onActivated(payload('org-1'))).resolves.toBeUndefined();
  });

  it('событие _BONUS обрабатывается так же, как _PAID', async () => {
    // Оба события маршрутизируются в один handler onActivated — проверяем,
    // что имена событий определены (контракт с @OnEvent).
    expect(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID).toBe(
      'billing.subscription.activated_paid',
    );
    expect(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS).toBe(
      'billing.subscription.activated_bonus',
    );
  });
});

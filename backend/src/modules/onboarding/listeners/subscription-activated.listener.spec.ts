import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BillingEvent,
  type SubscriptionActivatedPayload,
} from '../../billing/events/billing.events';

import { SubscriptionActivatedListener } from './subscription-activated.listener';

describe('SubscriptionActivatedListener', () => {
  let prisma: {
    org: { findUnique: ReturnType<typeof vi.fn> };
    membership: { deleteMany: ReturnType<typeof vi.fn> };
  };
  let cfg: { demo: { referenceOrgId: string | null } };
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
    prisma = {
      org: { findUnique: vi.fn() },
      membership: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    };
    cfg = { demo: { referenceOrgId: 'demo-org-id' } };
    listener = new SubscriptionActivatedListener(
      prisma as unknown as PrismaService,
      cfg as unknown as TypedConfigService,
    );
  });

  it('detach demo_observer membership owner-а активированной Org', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({ ownerId: 'owner-1' });

    await listener.onActivated(payload('org-1'));

    expect(prisma.membership.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        orgId: 'demo-org-id',
        role: 'demo_observer',
      },
    });
  });

  it('ZDEMO_ORG_ID не задана → ничего не трогаем', async () => {
    cfg.demo.referenceOrgId = null;

    await listener.onActivated(payload('org-1'));

    expect(prisma.org.findUnique).not.toHaveBeenCalled();
    expect(prisma.membership.deleteMany).not.toHaveBeenCalled();
  });

  it('активация самой эталонной Org → не отвязываем сам эталон', async () => {
    await listener.onActivated(payload('demo-org-id'));

    expect(prisma.org.findUnique).not.toHaveBeenCalled();
    expect(prisma.membership.deleteMany).not.toHaveBeenCalled();
  });

  it('Org не найдена → не падаем, deleteMany не вызывается', async () => {
    prisma.org.findUnique.mockResolvedValueOnce(null);

    await expect(listener.onActivated(payload('org-x'))).resolves.toBeUndefined();
    expect(prisma.membership.deleteMany).not.toHaveBeenCalled();
  });

  it('событие _BONUS обрабатывается так же, как _PAID', async () => {
    expect(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID).toBe('billing.subscription.activated_paid');
    expect(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS).toBe('billing.subscription.activated_bonus');
  });
});

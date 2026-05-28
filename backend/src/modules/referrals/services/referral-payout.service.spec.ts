/**
 * Unit-тесты ReferralPayoutService — реф-комиссии.
 *
 * Покрытие:
 *   - onInvoicePaid:
 *     * paymentMode='bonus' → no-op
 *     * subscriptionId=null → no-op
 *     * существующий payout по triggerInvoiceId → no-op (идемпотентно)
 *     * есть ClientReferralLink → создаёт payout 2 000 000
 *     * нет link → резолвит pending → создаёт link + payout + clearPending
 *     * нет link + нет pending → no-op
 *   - closePeriod:
 *     * verified реферал → status='paid' + paidAt
 *     * неверифицированный → status='void' + voidReason='referral_not_verified'
 *   - markPaidByAdmin / voidByAdmin
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { InvoicePaidPayload } from '../../billing/events/billing.events';

import type { AttributionService } from './attribution.service';
import {
  REFERRAL_COMMISSION_KOPECKS,
  ReferralPayoutService,
} from './referral-payout.service';

interface Mocks {
  prisma: {
    subscription: { findUnique: ReturnType<typeof vi.fn> };
    referralPayout: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    clientReferralLink: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  redis: { client: { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } };
  attribution: {
    resolvePendingForOrg: ReturnType<typeof vi.fn>;
    clearPendingForOrg: ReturnType<typeof vi.fn>;
  };
}

function makeMocks(): Mocks {
  return {
    prisma: {
      subscription: { findUnique: vi.fn() },
      referralPayout: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      clientReferralLink: {
        create: vi.fn(),
        update: vi.fn(),
      },
    },
    redis: { client: { set: vi.fn(), del: vi.fn() } },
    attribution: {
      resolvePendingForOrg: vi.fn(),
      clearPendingForOrg: vi.fn(),
    },
  };
}

function makeService(mocks: Mocks): ReferralPayoutService {
  return new ReferralPayoutService(
    mocks.prisma as unknown as PrismaService,
    mocks.redis as unknown as RedisService,
    mocks.attribution as unknown as AttributionService,
  );
}

function basePayload(over: Partial<InvoicePaidPayload> = {}): InvoicePaidPayload {
  return {
    invoiceId: 'inv-1',
    tenantId: 'org-1',
    subscriptionId: 'sub-1',
    amountKopecks: 6_000_000,
    paymentMode: 'paid',
    paidAt: new Date('2026-05-15T10:00:00Z'),
    ...over,
  };
}

describe('ReferralPayoutService.onInvoicePaid', () => {
  let mocks: Mocks;
  let svc: ReferralPayoutService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  it('paymentMode=bonus → no-op', async () => {
    await svc.onInvoicePaid(basePayload({ paymentMode: 'bonus' }));
    expect(mocks.prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.referralPayout.create).not.toHaveBeenCalled();
  });

  it('subscriptionId=null → no-op', async () => {
    await svc.onInvoicePaid(basePayload({ subscriptionId: null }));
    expect(mocks.prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('payout уже есть по triggerInvoiceId → no-op (идемпотентно)', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      clientReferralLink: null,
    });
    mocks.prisma.referralPayout.findFirst.mockResolvedValueOnce({ id: 'pay-existing' });

    await svc.onInvoicePaid(basePayload());

    expect(mocks.prisma.referralPayout.create).not.toHaveBeenCalled();
    expect(mocks.prisma.clientReferralLink.create).not.toHaveBeenCalled();
  });

  it('есть ClientReferralLink → создаёт payout 2 000 000', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      clientReferralLink: {
        id: 'link-1',
        referralId: 'ref-1',
        firstPaidAt: new Date('2026-04-01T00:00:00Z'),
      },
    });
    mocks.prisma.referralPayout.findFirst.mockResolvedValueOnce(null);

    await svc.onInvoicePaid(basePayload());

    expect(mocks.prisma.clientReferralLink.create).not.toHaveBeenCalled();
    expect(mocks.prisma.referralPayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referralId: 'ref-1',
        clientReferralLinkId: 'link-1',
        triggerInvoiceId: 'inv-1',
        periodMonth: '2026-05',
        amountKopecks: REFERRAL_COMMISSION_KOPECKS,
        status: 'pending',
      }),
    });
  });

  it('нет link но есть pending → создаёт link + payout + clearPending', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      clientReferralLink: null,
    });
    mocks.prisma.referralPayout.findFirst.mockResolvedValueOnce(null);
    mocks.attribution.resolvePendingForOrg.mockResolvedValueOnce({
      referralId: 'ref-2',
      slug: 'abcd1234',
      pendingAttributionAt: new Date(),
    });
    mocks.prisma.clientReferralLink.create.mockResolvedValueOnce({
      id: 'link-new',
      referralId: 'ref-2',
    });

    await svc.onInvoicePaid(basePayload());

    expect(mocks.prisma.clientReferralLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'org-1',
        referralId: 'ref-2',
        subscriptionId: 'sub-1',
        firstPaidAt: expect.any(Date),
      }),
    });
    expect(mocks.attribution.clearPendingForOrg).toHaveBeenCalledWith('org-1');
    expect(mocks.prisma.referralPayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referralId: 'ref-2',
        clientReferralLinkId: 'link-new',
        amountKopecks: REFERRAL_COMMISSION_KOPECKS,
      }),
    });
  });

  it('нет link и нет pending → no-op (без атрибуции)', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      clientReferralLink: null,
    });
    mocks.prisma.referralPayout.findFirst.mockResolvedValueOnce(null);
    mocks.attribution.resolvePendingForOrg.mockResolvedValueOnce(null);

    await svc.onInvoicePaid(basePayload());

    expect(mocks.prisma.clientReferralLink.create).not.toHaveBeenCalled();
    expect(mocks.prisma.referralPayout.create).not.toHaveBeenCalled();
  });

  it('есть link без firstPaidAt → проставляет firstPaidAt', async () => {
    mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      clientReferralLink: {
        id: 'link-1',
        referralId: 'ref-1',
        firstPaidAt: null,
      },
    });
    mocks.prisma.referralPayout.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.clientReferralLink.update.mockResolvedValueOnce({
      id: 'link-1',
      referralId: 'ref-1',
      firstPaidAt: new Date(),
    });

    await svc.onInvoicePaid(basePayload());

    expect(mocks.prisma.clientReferralLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: { firstPaidAt: expect.any(Date) },
    });
    expect(mocks.prisma.referralPayout.create).toHaveBeenCalled();
  });

  it('ошибка БД → swallow + лог (не throw в caller)', async () => {
    mocks.prisma.subscription.findUnique.mockRejectedValueOnce(new Error('DB down'));
    await expect(svc.onInvoicePaid(basePayload())).resolves.toBeUndefined();
  });
});

describe('ReferralPayoutService.closePeriod', () => {
  let mocks: Mocks;
  let svc: ReferralPayoutService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  it('verified реферал → paid + paidAt', async () => {
    mocks.prisma.referralPayout.findMany.mockResolvedValueOnce([
      {
        id: 'pay-1',
        referral: {
          id: 'ref-1',
          innVerifiedAt: new Date('2026-01-01'),
          contractAcceptedAt: new Date('2026-01-02'),
          slug: 'abcd',
        },
      },
    ]);
    mocks.prisma.referralPayout.update.mockResolvedValueOnce({});

    const result = await svc.closePeriod('2026-05');

    expect(result).toEqual({ paid: 1, voided: 0, skipped: 0 });
    expect(mocks.prisma.referralPayout.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({
        status: 'paid',
        paidAt: expect.any(Date),
      }),
    });
  });

  it('неверифицированный реферал → void + voidReason', async () => {
    mocks.prisma.referralPayout.findMany.mockResolvedValueOnce([
      {
        id: 'pay-2',
        referral: {
          id: 'ref-2',
          innVerifiedAt: null,
          contractAcceptedAt: new Date(),
          slug: 'noinn',
        },
      },
      {
        id: 'pay-3',
        referral: {
          id: 'ref-3',
          innVerifiedAt: new Date(),
          contractAcceptedAt: null,
          slug: 'nocontract',
        },
      },
    ]);

    const result = await svc.closePeriod('2026-05');

    expect(result).toEqual({ paid: 0, voided: 2, skipped: 0 });
    expect(mocks.prisma.referralPayout.update).toHaveBeenCalledWith({
      where: { id: 'pay-2' },
      data: expect.objectContaining({
        status: 'void',
        voidReason: 'referral_not_verified',
      }),
    });
    expect(mocks.prisma.referralPayout.update).toHaveBeenCalledWith({
      where: { id: 'pay-3' },
      data: expect.objectContaining({ status: 'void' }),
    });
  });
});

describe('ReferralPayoutService.markPaidByAdmin / voidByAdmin', () => {
  let mocks: Mocks;
  let svc: ReferralPayoutService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  it('markPaidByAdmin: payout pending → paid', async () => {
    mocks.prisma.referralPayout.findUnique.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'pending',
      payoutDocumentUrl: null,
    });
    mocks.prisma.referralPayout.update.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'paid',
    });
    const result = await svc.markPaidByAdmin({
      payoutId: 'pay-1',
      payoutDocumentUrl: 'https://docs/act.pdf',
    });
    expect(result.status).toBe('paid');
    expect(mocks.prisma.referralPayout.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({
        status: 'paid',
        paidAt: expect.any(Date),
        payoutDocumentUrl: 'https://docs/act.pdf',
      }),
    });
  });

  it('markPaidByAdmin: void → throw', async () => {
    mocks.prisma.referralPayout.findUnique.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'void',
    });
    await expect(
      svc.markPaidByAdmin({ payoutId: 'pay-1' }),
    ).rejects.toThrow(/нельзя пометить/);
  });

  it('voidByAdmin: pending → void с reason', async () => {
    mocks.prisma.referralPayout.findUnique.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'pending',
    });
    mocks.prisma.referralPayout.update.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'void',
    });
    const result = await svc.voidByAdmin({
      payoutId: 'pay-1',
      voidReason: 'manual cancel',
    });
    expect(result.status).toBe('void');
    expect(mocks.prisma.referralPayout.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'void', voidReason: 'manual cancel' },
    });
  });
});

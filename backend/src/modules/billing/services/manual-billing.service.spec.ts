import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  type BillingPeriod,
  type Invoice,
  type Subscription,
  SubscriptionStatus,
} from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MeetingsBalanceService } from '../../meetings-balance/meetings-balance.service';

import type { BillingEventService } from './billing-event.service';
import type { InvoiceService } from './invoice.service';
import { ManualBillingService } from './manual-billing.service';
import { SeatService } from './seat.service';
import type { SubscriptionService } from './subscription.service';

function makeSubscription(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    tenantId: 'org-1',
    status: SubscriptionStatus.DEMO,
    paymentMode: null,
    billingPeriod: null,
    startedAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    pastDueUntil: null,
    seatsBase: 30,
    seatsExtra: 0,
    monthlyPriceKopecks: 6_000_000,
    totalPaidKopecks: 0,
    autoRenew: false,
    renewalMethod: null,
    providerName: null,
    providerSubscriptionId: null,
    providerCustomerCode: null,
    providerConsumerId: null,
    lastRenewalAttemptAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    tenantId: 'org-1',
    subscriptionId: 'sub-1',
    billingNumber: 1,
    invoiceNumber: 'Z-2026-000001',
    periodStart: new Date('2026-05-01T00:00:00Z'),
    periodEnd: new Date('2026-06-01T00:00:00Z'),
    items: [],
    totalKopecks: 6_000_000,
    status: 'paid',
    paymentMethod: 'manual_admin',
    pdfUrl: null,
    pdfSource: null,
    pdfFetchedAt: null,
    providerName: null,
    providerInvoiceId: null,
    paymentUrl: null,
    externalStatus: null,
    issuedAt: null,
    paidAt: new Date(),
    voidedAt: null,
    dueAt: null,
    externalRef: null,
    markedByUserId: 'user-admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

interface Mocks {
  prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    adminAuditLog: { create: ReturnType<typeof vi.fn> };
    subscription: { update: ReturnType<typeof vi.fn> };
    subscriptionEvent: { create: ReturnType<typeof vi.fn> };
  };
  events: { emitAsync: ReturnType<typeof vi.fn> };
  subscriptions: {
    getByTenant: ReturnType<typeof vi.fn>;
    getByTenantOrFail: ReturnType<typeof vi.fn>;
    ensureDemo: ReturnType<typeof vi.fn>;
    transition: ReturnType<typeof vi.fn>;
    setSeatsExtra: ReturnType<typeof vi.fn>;
  };
  invoices: {
    create: ReturnType<typeof vi.fn>;
    markPaid: ReturnType<typeof vi.fn>;
    findOrFail: ReturnType<typeof vi.fn>;
  };
  eventLog: { log: ReturnType<typeof vi.fn> };
  balance: {
    grant: ReturnType<typeof vi.fn>;
    getBaseMeetingsGrant: ReturnType<typeof vi.fn>;
    getPerExtraSeatMeetingsGrant: ReturnType<typeof vi.fn>;
    calculateMeetingsGrant: ReturnType<typeof vi.fn>;
  };
}

function makeMocks(): Mocks {
  const txClient = {
    invoice: { create: vi.fn(), update: vi.fn() },
    subscription: { update: vi.fn().mockResolvedValue(makeSubscription({ seatsExtra: 5 })) },
    subscriptionEvent: { create: vi.fn() },
    billingEventLog: { findFirst: vi.fn(), create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
      adminAuditLog: { create: vi.fn() },
      subscription: { update: vi.fn() },
      subscriptionEvent: { create: vi.fn() },
    },
    events: { emitAsync: vi.fn().mockResolvedValue([]) },
    subscriptions: {
      getByTenant: vi.fn(),
      getByTenantOrFail: vi.fn(),
      ensureDemo: vi.fn(),
      transition: vi.fn(),
      setSeatsExtra: vi.fn(),
    },
    invoices: {
      create: vi.fn(),
      markPaid: vi.fn(),
      findOrFail: vi.fn(),
    },
    eventLog: { log: vi.fn().mockResolvedValue({ duplicate: false }) },
    balance: {
      grant: vi.fn(),
      getBaseMeetingsGrant: vi.fn().mockResolvedValue(150),
      getPerExtraSeatMeetingsGrant: vi.fn().mockResolvedValue(5),
      calculateMeetingsGrant: vi
        .fn()
        .mockImplementation(async (seatsExtra: number) => 150 + Math.max(0, seatsExtra) * 5),
    },
  };
}

function makeSeatService(balance: Mocks['balance']): SeatService {
  const cfgMock = {
    getDynamic: async <T>(_key: string, _env: string | undefined, def: T): Promise<T> => def,
  } as unknown as TypedConfigService;
  return new SeatService(cfgMock, balance as unknown as MeetingsBalanceService);
}

function makeService(mocks: Mocks): ManualBillingService {
  return new ManualBillingService(
    mocks.prisma as unknown as PrismaService,
    mocks.events as unknown as never,
    mocks.subscriptions as unknown as SubscriptionService,
    mocks.invoices as unknown as InvoiceService,
    makeSeatService(mocks.balance),
    mocks.eventLog as unknown as BillingEventService,
    mocks.balance as unknown as MeetingsBalanceService,
  );
}

describe('ManualBillingService.activate', () => {
  let mocks: Mocks;
  let svc: ManualBillingService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('paid: monthly seatsExtra=0 → ACTIVE/paid, Invoice paid, grant=150', async () => {
    mocks.subscriptions.getByTenant.mockResolvedValueOnce(makeSubscription());
    mocks.invoices.create.mockResolvedValueOnce(makeInvoice({ status: 'draft' }));
    mocks.invoices.markPaid.mockResolvedValueOnce(makeInvoice({ status: 'paid' }));
    mocks.subscriptions.transition.mockResolvedValueOnce(
      makeSubscription({
        status: SubscriptionStatus.ACTIVE,
        paymentMode: 'paid',
        billingPeriod: 'monthly',
      }),
    );

    const result = await svc.activate({
      tenantId: 'org-1',
      billingPeriod: 'monthly' as BillingPeriod,
      seatsExtra: 0,
      startedAt: new Date('2026-05-01T00:00:00Z'),
      paymentMode: 'paid',
      reason: 'New paying customer',
      byUserId: 'user-admin',
    });

    expect(result.grantedMeetings).toBe(150);
    expect(result.subscription.status).toBe('ACTIVE');
    expect(result.subscription.paymentMode).toBe('paid');
    expect(mocks.balance.grant).toHaveBeenCalledWith('org-1', 150);
    expect(mocks.invoices.markPaid).toHaveBeenCalledOnce();
    expect(mocks.subscriptions.transition).toHaveBeenCalledOnce();
    expect(mocks.eventLog.log).toHaveBeenCalled();
    expect(mocks.events.emitAsync).toHaveBeenCalledWith(
      'billing.subscription.activated_paid',
      expect.objectContaining({ tenantId: 'org-1', paymentMode: 'paid' }),
    );
  });

  it('bonus: НЕ зовёт markPaid, Invoice сразу bonus, эмитит activated_bonus', async () => {
    mocks.subscriptions.getByTenant.mockResolvedValueOnce(makeSubscription());
    mocks.invoices.create.mockResolvedValueOnce(makeInvoice({ status: 'bonus' }));
    mocks.subscriptions.transition.mockResolvedValueOnce(
      makeSubscription({
        status: SubscriptionStatus.ACTIVE,
        paymentMode: 'bonus',
        billingPeriod: 'yearly',
      }),
    );

    const result = await svc.activate({
      tenantId: 'org-1',
      billingPeriod: 'yearly' as BillingPeriod,
      seatsExtra: 10,
      startedAt: new Date('2026-05-01T00:00:00Z'),
      paymentMode: 'bonus',
      reason: 'Friends of the team',
      byUserId: 'user-admin',
    });

    expect(result.grantedMeetings).toBe(150 + 10 * 5);
    expect(mocks.invoices.markPaid).not.toHaveBeenCalled();
    expect(mocks.balance.grant).toHaveBeenCalledWith('org-1', 200);
    expect(mocks.events.emitAsync).toHaveBeenCalledWith(
      'billing.subscription.activated_bonus',
      expect.any(Object),
    );
    const emittedEvents = mocks.events.emitAsync.mock.calls.map((c: unknown[]) => c[0]);
    expect(emittedEvents).not.toContain('billing.invoice.paid');
  });

  it('reason короче 3 символов → BadRequestException', async () => {
    await expect(
      svc.activate({
        tenantId: 'org-1',
        billingPeriod: 'monthly' as BillingPeriod,
        seatsExtra: 0,
        startedAt: new Date(),
        paymentMode: 'paid',
        reason: 'X',
        byUserId: 'user-admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('seatsExtra > 10000 → BadRequestException', async () => {
    await expect(
      svc.activate({
        tenantId: 'org-1',
        billingPeriod: 'monthly' as BillingPeriod,
        seatsExtra: 10_001,
        startedAt: new Date(),
        paymentMode: 'paid',
        reason: 'reason text',
        byUserId: 'user-admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('повторная activate с тем же paymentMode → ConflictException', async () => {
    mocks.subscriptions.getByTenant.mockResolvedValueOnce(
      makeSubscription({
        status: SubscriptionStatus.ACTIVE,
        paymentMode: 'paid',
      }),
    );
    await expect(
      svc.activate({
        tenantId: 'org-1',
        billingPeriod: 'monthly' as BillingPeriod,
        seatsExtra: 0,
        startedAt: new Date(),
        paymentMode: 'paid',
        reason: 'duplicate',
        byUserId: 'user-admin',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ManualBillingService.adjustSeats', () => {
  let mocks: Mocks;
  let svc: ManualBillingService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  it('newSeatsExtra=current → no-op', async () => {
    const sub = makeSubscription({
      status: SubscriptionStatus.ACTIVE,
      paymentMode: 'paid',
      billingPeriod: 'monthly',
      seatsExtra: 5,
    });
    mocks.subscriptions.getByTenantOrFail.mockResolvedValueOnce(sub);

    const result = await svc.adjustSeats({
      tenantId: 'org-1',
      newSeatsExtra: 5,
      reason: 'same value',
      byUserId: 'user-admin',
    });
    expect(result.invoiceId).toBeNull();
    expect(result.grantedMeetings).toBe(0);
    expect(mocks.invoices.create).not.toHaveBeenCalled();
    expect(mocks.balance.grant).not.toHaveBeenCalled();
  });

  it('уменьшение seats → НЕТ Invoice, grant=0', async () => {
    const sub = makeSubscription({
      status: SubscriptionStatus.ACTIVE,
      paymentMode: 'paid',
      billingPeriod: 'monthly',
      seatsExtra: 10,
    });
    mocks.subscriptions.getByTenantOrFail.mockResolvedValueOnce(sub);
    mocks.subscriptions.setSeatsExtra.mockResolvedValueOnce({
      ...sub,
      seatsExtra: 5,
    });

    const result = await svc.adjustSeats({
      tenantId: 'org-1',
      newSeatsExtra: 5,
      reason: 'downsize',
      byUserId: 'user-admin',
    });
    expect(result.invoiceId).toBeNull();
    expect(result.grantedMeetings).toBe(0);
    expect(mocks.invoices.create).not.toHaveBeenCalled();
    expect(mocks.balance.grant).not.toHaveBeenCalled();
    expect(mocks.subscriptions.setSeatsExtra).toHaveBeenCalledWith({
      tenantId: 'org-1',
      newSeatsExtra: 5,
      byUserId: 'user-admin',
      reason: 'downsize',
    });
  });

  it('увеличение seats monthly → Invoice paid с pro-rata, grant=diff*5', async () => {
    const sub = makeSubscription({
      status: SubscriptionStatus.ACTIVE,
      paymentMode: 'paid',
      billingPeriod: 'monthly',
      seatsExtra: 0,
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    });
    mocks.subscriptions.getByTenantOrFail.mockResolvedValueOnce(sub);
    mocks.invoices.create.mockResolvedValueOnce(
      makeInvoice({ status: 'draft', totalKopecks: 250_000 }),
    );
    mocks.invoices.markPaid.mockResolvedValueOnce(
      makeInvoice({ status: 'paid', totalKopecks: 250_000 }),
    );

    const result = await svc.adjustSeats({
      tenantId: 'org-1',
      newSeatsExtra: 5,
      reason: 'add 5 seats',
      byUserId: 'user-admin',
      daysLeftInMonthlyPeriod: 15,
    });

    expect(result.invoiceId).toBe('inv-1');
    expect(result.grantedMeetings).toBe(25);
    expect(mocks.balance.grant).toHaveBeenCalledWith('org-1', 25);
    expect(mocks.invoices.create).toHaveBeenCalled();
    expect(mocks.invoices.markPaid).toHaveBeenCalled();
  });

  it('при не-ACTIVE → BadRequestException', async () => {
    mocks.subscriptions.getByTenantOrFail.mockResolvedValueOnce(
      makeSubscription({ status: SubscriptionStatus.DEMO }),
    );
    await expect(
      svc.adjustSeats({
        tenantId: 'org-1',
        newSeatsExtra: 5,
        reason: 'cant change demo',
        byUserId: 'user-admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ManualBillingService.forceStatus', () => {
  let mocks: Mocks;
  let svc: ManualBillingService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = makeService(mocks);
  });

  it('обход FSM + AdminAuditLog', async () => {
    mocks.subscriptions.transition.mockResolvedValueOnce(
      makeSubscription({ status: SubscriptionStatus.EXPIRED }),
    );

    const result = await svc.forceStatus({
      tenantId: 'org-1',
      newStatus: SubscriptionStatus.EXPIRED,
      reason: 'manual cleanup',
      byUserId: 'user-admin',
    });

    expect(result.status).toBe('EXPIRED');
    expect(mocks.subscriptions.transition).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ force: true, to: 'EXPIRED' }),
    );
    expect(mocks.prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-admin',
        action: 'billing.force_status',
        targetType: 'subscription',
      }),
    });
  });

  it('reason < 3 → BadRequestException', async () => {
    await expect(
      svc.forceStatus({
        tenantId: 'org-1',
        newStatus: SubscriptionStatus.EXPIRED,
        reason: 'X',
        byUserId: 'user-admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

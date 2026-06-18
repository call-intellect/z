import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { BillingProviderPort } from '../providers/billing-provider.port';

import type { InvoiceService } from './invoice.service';
import { TochkaRecurringChargeCron } from './tochka-recurring-charge.cron';

interface FakeSub {
  id: string;
  tenantId: string;
  providerSubscriptionId: string | null;
  monthlyPriceKopecks: number;
  billingPeriod: 'monthly' | 'yearly';
  currentPeriodEnd: Date | null;
  lastRenewalAttemptAt: Date | null;
}

interface FakeInvoice {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  status: string;
  providerName: string | null;
  providerInvoiceId: string | null;
  externalStatus: string | null;
  issuedAt: Date | null;
}

interface Store {
  subs: Map<string, FakeSub>;
  invoices: Map<string, FakeInvoice>;
  invoiceSeq: number;
}

function makeStore(): Store {
  return { subs: new Map(), invoices: new Map(), invoiceSeq: 1 };
}

interface ProviderCall {
  providerSubscriptionId: string;
  amountKopecks: number;
}

interface CronHandle {
  cron: TochkaRecurringChargeCron;
  providerCalls: ProviderCall[];
  getInvoiceCreateCalls: () => number;
}

function makeCron(opts: {
  store: Store;
  providerResult?: { providerInvoiceId: string; status: 'pending' | 'succeeded' | 'failed' };
  providerThrows?: Error;
  invoiceCreateThrows?: Error;
}): CronHandle {
  const { store } = opts;
  const providerCalls: ProviderCall[] = [];
  const counter = { invoiceCreateCalls: 0 };

  const prisma = {
    subscription: {
      findMany: vi.fn(async () => Array.from(store.subs.values())),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { lastRenewalAttemptAt: Date };
        }) => {
          const s = store.subs.get(where.id);
          if (s) s.lastRenewalAttemptAt = data.lastRenewalAttemptAt;
          return s;
        },
      ),
    },
    invoice: {
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeInvoice> }) => {
          const inv = store.invoices.get(where.id);
          if (!inv) throw new Error('invoice not found');
          Object.assign(inv, data);
          return inv;
        },
      ),
    },
  } as unknown as PrismaService;

  const redis = {
    client: {
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
    },
  } as unknown as RedisService;

  const cfg = {
    billing: { features: { cardRecurring: true } },
  } as unknown as TypedConfigService;

  const provider = {
    providerName: 'tochka' as const,
    chargeRecurringSubscription: vi.fn(async (req: ProviderCall) => {
      providerCalls.push(req);
      if (opts.providerThrows) throw opts.providerThrows;
      return (
        opts.providerResult ?? {
          providerInvoiceId: `op-${req.providerSubscriptionId}`,
          status: 'pending' as const,
        }
      );
    }),
  } as unknown as BillingProviderPort;

  const invoices = {
    create: vi.fn(
      async (input: {
        tenantId: string;
        subscriptionId: string | null;
        periodStart: Date;
        periodEnd: Date;
      }) => {
        counter.invoiceCreateCalls += 1;
        if (opts.invoiceCreateThrows) throw opts.invoiceCreateThrows;
        const id = `inv-${store.invoiceSeq++}`;
        const inv: FakeInvoice = {
          id,
          tenantId: input.tenantId,
          subscriptionId: input.subscriptionId,
          status: 'draft',
          providerName: null,
          providerInvoiceId: null,
          externalStatus: null,
          issuedAt: null,
        };
        store.invoices.set(id, inv);
        return inv;
      },
    ),
  } as unknown as InvoiceService;

  const cron = new TochkaRecurringChargeCron(prisma, redis, cfg, provider, invoices);
  return {
    cron,
    providerCalls,
    getInvoiceCreateCalls: () => counter.invoiceCreateCalls,
  };
}

describe('TochkaRecurringChargeCron (Б15)', () => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
    store.subs.set('sub-1', {
      id: 'sub-1',
      tenantId: 't-1',
      providerSubscriptionId: 'tochka-sub-1',
      monthlyPriceKopecks: 100_000,
      billingPeriod: 'monthly',
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      lastRenewalAttemptAt: null,
    });
  });

  it('создаёт локальный Invoice ДО chargeRecurringSubscription', async () => {
    const { cron, providerCalls, getInvoiceCreateCalls } = makeCron({ store });
    await cron.run();
    expect(getInvoiceCreateCalls()).toBe(1);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.providerSubscriptionId).toBe('tochka-sub-1');
  });

  it('после успешного charge: Invoice.providerInvoiceId = operationId Точки (не синтетический)', async () => {
    const { cron } = makeCron({
      store,
      providerResult: {
        providerInvoiceId: 'tochka-real-operation-id-XYZ',
        status: 'pending',
      },
    });
    await cron.run();
    const inv = Array.from(store.invoices.values())[0]!;
    expect(inv.providerInvoiceId).toBe('tochka-real-operation-id-XYZ');
    expect(inv.providerInvoiceId).not.toMatch(/^tochka-sub-1:\d+$/);
    expect(inv.providerName).toBe('tochka');
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).not.toBeNull();
    expect(inv.externalStatus).toBe('pending');
  });

  it('charge падает: Invoice остаётся в draft, lastRenewalAttemptAt всё равно обновляется', async () => {
    const { cron } = makeCron({
      store,
      providerThrows: new Error('Tochka 500'),
    });
    await cron.run();
    const inv = Array.from(store.invoices.values())[0]!;
    expect(inv.status).toBe('draft');
    expect(inv.providerInvoiceId).toBeNull();
    const sub = store.subs.get('sub-1')!;
    expect(sub.lastRenewalAttemptAt).not.toBeNull();
  });

  it('Invoice.create упал: chargeRecurringSubscription НЕ вызывается, lastRenewalAttemptAt всё равно обновляется', async () => {
    const { cron, providerCalls } = makeCron({
      store,
      invoiceCreateThrows: new Error('db down'),
    });
    await cron.run();
    expect(providerCalls).toHaveLength(0);
    expect(store.invoices.size).toBe(0);
    const sub = store.subs.get('sub-1')!;
    expect(sub.lastRenewalAttemptAt).not.toBeNull();
  });

  it('Subscription без currentPeriodEnd: пропускается, ни Invoice ни charge', async () => {
    store.subs.set('sub-2', {
      id: 'sub-2',
      tenantId: 't-1',
      providerSubscriptionId: 'tochka-sub-2',
      monthlyPriceKopecks: 100_000,
      billingPeriod: 'monthly',
      currentPeriodEnd: null,
      lastRenewalAttemptAt: null,
    });
    store.subs.delete('sub-1');
    const { cron, providerCalls, getInvoiceCreateCalls } = makeCron({ store });
    await cron.run();
    expect(providerCalls).toHaveLength(0);
    expect(getInvoiceCreateCalls()).toBe(0);
  });

  it('yearly period: +1 год к currentPeriodEnd, amount = monthly × 12 × 0.8', async () => {
    store.subs.set('sub-1', {
      id: 'sub-1',
      tenantId: 't-1',
      providerSubscriptionId: 'tochka-sub-1',
      monthlyPriceKopecks: 100_000,
      billingPeriod: 'yearly',
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      lastRenewalAttemptAt: null,
    });
    const { cron, providerCalls } = makeCron({ store });
    await cron.run();
    expect(providerCalls[0]?.amountKopecks).toBe(Math.round(100_000 * 12 * 0.8));
  });
});

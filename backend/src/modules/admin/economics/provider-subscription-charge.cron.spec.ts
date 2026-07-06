import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderSubscriptionChargeCron } from './provider-subscription-charge.cron';

function fakeSubscriptionProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'minimaxio2',
    billingMode: 'subscription',
    subscriptionMonthlyCostUsd: 50,
    subscriptionStartedAt: new Date('2026-05-06T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('ProviderSubscriptionChargeCron', () => {
  const findMany = vi.fn();
  const chargeFindUnique = vi.fn();
  const chargeCreate = vi.fn();

  const prisma = {
    llmProvider: { findMany },
    llmProviderSubscriptionCharge: { findUnique: chargeFindUnique, create: chargeCreate },
  } as unknown as ConstructorParameters<typeof ProviderSubscriptionChargeCron>[0];

  let cron: ProviderSubscriptionChargeCron;

  beforeEach(() => {
    vi.clearAllMocks();
    chargeFindUnique.mockResolvedValue(null);
    chargeCreate.mockResolvedValue({});
    cron = new ProviderSubscriptionChargeCron(prisma);
  });

  it('(a) сегодня — годовщина дня старта подписки (месяц с тем же числом дней) → создаёт charge', async () => {
    findMany.mockResolvedValueOnce([fakeSubscriptionProvider()]);

    const res = await cron.runOnce(new Date('2026-07-06T05:00:00.000Z'));

    expect(res).toEqual({ charged: 1 });
    expect(chargeCreate).toHaveBeenCalledWith({
      data: {
        providerId: 'p1',
        providerName: 'minimaxio2',
        chargeDate: new Date('2026-07-06T00:00:00.000Z'),
        amountUsd: 50,
      },
    });
  });

  it('(b) сегодня НЕ день списания → charge не создаётся', async () => {
    findMany.mockResolvedValueOnce([fakeSubscriptionProvider()]);

    const res = await cron.runOnce(new Date('2026-07-07T05:00:00.000Z'));

    expect(res).toEqual({ charged: 0 });
    expect(chargeCreate).not.toHaveBeenCalled();
  });

  it('(c) старт 31-го, короткий месяц (февраль, 28 дней) → списание кламповано на 28-е', async () => {
    findMany.mockResolvedValueOnce([
      fakeSubscriptionProvider({ subscriptionStartedAt: new Date('2026-01-31T00:00:00.000Z') }),
    ]);

    const resOn28th = await cron.runOnce(new Date('2026-02-28T05:00:00.000Z'));
    expect(resOn28th).toEqual({ charged: 1 });

    chargeCreate.mockClear();
    findMany.mockResolvedValueOnce([
      fakeSubscriptionProvider({ subscriptionStartedAt: new Date('2026-01-31T00:00:00.000Z') }),
    ]);
    const resOn27th = await cron.runOnce(new Date('2026-02-27T05:00:00.000Z'));
    expect(resOn27th).toEqual({ charged: 0 });
  });

  it('(d) повторный прогон в тот же день (charge уже существует) → идемпотентно, не дублирует', async () => {
    findMany.mockResolvedValueOnce([fakeSubscriptionProvider()]);
    chargeFindUnique.mockResolvedValueOnce(
      fakeSubscriptionProvider({ chargeDate: new Date('2026-07-06T00:00:00.000Z') }),
    );

    const res = await cron.runOnce(new Date('2026-07-06T05:00:00.000Z'));

    expect(res).toEqual({ charged: 0 });
    expect(chargeCreate).not.toHaveBeenCalled();
  });

  it('(e) subscriptionStartedAt в будущем (или сегодня — сам день старта) → не списывает', async () => {
    findMany.mockResolvedValueOnce([
      fakeSubscriptionProvider({ subscriptionStartedAt: new Date('2026-07-06T00:00:00.000Z') }),
    ]);

    const res = await cron.runOnce(new Date('2026-07-06T05:00:00.000Z'));

    expect(res).toEqual({ charged: 0 });
    expect(chargeCreate).not.toHaveBeenCalled();
  });

  it('(f) провайдер billingMode=per_token не запрашивается вовсе (where-фильтр)', async () => {
    findMany.mockResolvedValueOnce([]);

    await cron.runOnce(new Date('2026-07-06T05:00:00.000Z'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ billingMode: 'subscription' }),
      }),
    );
  });
});

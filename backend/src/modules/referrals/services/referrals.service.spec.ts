import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { InnLookupService } from '../../inn-lookup/inn-lookup.service';

import {
  ReferralsService,
  clientCodeFromLinkId,
  hasPayoutDetails,
} from './referrals.service';

/**
 * audit Б6 (2026-05-29) — спецификация на verifyInn:
 *   - mismatch ИНН в lookup-результате → метрика, БЕЗ innVerifiedAt.
 *   - company-payerType + directorName не совпадает с User.name → pending.
 *   - company-payerType + directorName совпадает → innVerifiedAt=now.
 *   - self_employed + правильный ИНН → innVerifiedAt=now.
 *
 * ТЗ referrals-cabinet-revamp (2026-05-31) — дополнительно:
 *   - verifyInn: ref.inn == null → возвращаем профиль без lookup, без метрики.
 */
describe('ReferralsService.verifyInn (audit Б6 + cabinet-revamp)', () => {
  let prisma: {
    referral: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
  let innLookup: { lookup: ReturnType<typeof vi.fn> };
  let metrics: { incReferralInnMismatch: ReturnType<typeof vi.fn> };
  let svc: ReferralsService;

  beforeEach(() => {
    prisma = {
      referral: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({ id: 'r-1', innVerifiedAt: new Date() })),
      },
      user: { findUnique: vi.fn() },
    };
    innLookup = { lookup: vi.fn() };
    metrics = { incReferralInnMismatch: vi.fn() };
    svc = new ReferralsService(
      prisma as unknown as PrismaService,
      innLookup as unknown as InnLookupService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  it('lookup.inn НЕ совпадает с ref.inn → mismatch, innVerifiedAt не ставим', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      inn: '7700123456',
      innVerifiedAt: null,
    });
    innLookup.lookup.mockResolvedValueOnce({
      source: 'mock',
      payerType: 'legal_entity',
      legalName: 'ООО Чужое',
      inn: '9999999999',
    });

    const ref = await svc.verifyInn('u-1');
    expect(prisma.referral.update).not.toHaveBeenCalled();
    expect(metrics.incReferralInnMismatch).toHaveBeenCalledWith({
      reason: 'lookup_inn_mismatch',
    });
    // Возвращаем оригинальный (с innVerifiedAt=null).
    expect((ref as unknown as { innVerifiedAt: Date | null }).innVerifiedAt).toBeNull();
  });

  it('company: directorName не совпадает с User.name → pending', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      inn: '7700123456',
      innVerifiedAt: null,
    });
    innLookup.lookup.mockResolvedValueOnce({
      source: 'mock',
      payerType: 'legal_entity',
      legalName: 'ООО Мост',
      inn: '7700123456',
      directorName: 'Сидоров Сидор Сидорович',
    });
    prisma.user.findUnique.mockResolvedValueOnce({ name: 'Иванов Иван Иванович' });

    await svc.verifyInn('u-1');
    expect(prisma.referral.update).not.toHaveBeenCalled();
    expect(metrics.incReferralInnMismatch).toHaveBeenCalledWith({
      reason: 'director_name_mismatch',
    });
  });

  it('company: directorName совпадает по фамилии → innVerifiedAt=now', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      inn: '7700123456',
      innVerifiedAt: null,
    });
    innLookup.lookup.mockResolvedValueOnce({
      source: 'mock',
      payerType: 'legal_entity',
      legalName: 'ООО Мост',
      inn: '7700123456',
      // На MVP extractLastName берёт самое длинное слово как «фамилию».
      // Тестируем сценарий «фамилия совпадает с фамилией director'а».
      directorName: 'Иван Иванов-Петров',
    });
    prisma.user.findUnique.mockResolvedValueOnce({ name: 'Иван Иванов-Петров' });

    await svc.verifyInn('u-1');
    expect(prisma.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ innVerifiedAt: expect.any(Date) }),
      }),
    );
  });

  it('self_employed + правильный ИНН → innVerifiedAt=now без проверки directorName', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      inn: '770012345678',
      innVerifiedAt: null,
    });
    innLookup.lookup.mockResolvedValueOnce({
      source: 'mock',
      payerType: 'self_employed',
      legalName: 'Иванов И. И.',
      inn: '770012345678',
    });

    await svc.verifyInn('u-1');
    expect(prisma.referral.update).toHaveBeenCalled();
    expect(metrics.incReferralInnMismatch).not.toHaveBeenCalled();
  });

  it('cabinet-revamp: ref.inn == null → возвращаем профиль без lookup и без метрики', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      inn: null,
      innVerifiedAt: null,
    });

    const ref = await svc.verifyInn('u-1');
    expect(innLookup.lookup).not.toHaveBeenCalled();
    expect(prisma.referral.update).not.toHaveBeenCalled();
    expect(metrics.incReferralInnMismatch).not.toHaveBeenCalled();
    expect((ref as unknown as { inn: string | null }).inn).toBeNull();
  });
});

/**
 * ТЗ referrals-cabinet-revamp (2026-05-31) §6.1 + §7.2 — create() новой формы:
 *   - contractAccepted !== true → BadRequest.
 *   - inn без legalForm (и наоборот) → BadRequest.
 *   - без inn/legalForm/payoutDetails — ok, профиль создан с contractAcceptedAt.
 */
describe('ReferralsService.create (cabinet-revamp)', () => {
  let prisma: {
    referral: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let svc: ReferralsService;

  beforeEach(() => {
    prisma = {
      referral: {
        findUnique: vi.fn(),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'r-new',
          slug: data['slug'],
          inn: data['inn'] ?? null,
          legalForm: data['legalForm'] ?? null,
          payoutDetails: data['payoutDetails'] ?? null,
          contractAcceptedAt: data['contractAcceptedAt'],
        })),
      },
    };
    const innLookup = { lookup: vi.fn() };
    const metrics = { incReferralInnMismatch: vi.fn() };
    svc = new ReferralsService(
      prisma as unknown as PrismaService,
      innLookup as unknown as InnLookupService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  it('contractAccepted !== true → BadRequest', async () => {
    await expect(
      svc.create({ ownerUserId: 'u-1', contractAccepted: false }),
    ).rejects.toThrow(/contractAccepted/);
    expect(prisma.referral.create).not.toHaveBeenCalled();
  });

  it('inn без legalForm → BadRequest', async () => {
    await expect(
      svc.create({
        ownerUserId: 'u-1',
        contractAccepted: true,
        inn: '7700123456',
      }),
    ).rejects.toThrow(/inn и legalForm/);
    expect(prisma.referral.create).not.toHaveBeenCalled();
  });

  it('legalForm без inn → BadRequest', async () => {
    await expect(
      svc.create({
        ownerUserId: 'u-1',
        contractAccepted: true,
        legalForm: 'self_employed',
      }),
    ).rejects.toThrow(/inn и legalForm/);
  });

  it('contractAccepted=true без всего остального → создаёт профиль с contractAcceptedAt', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce(null);

    const ref = await svc.create({
      ownerUserId: 'u-1',
      contractAccepted: true,
    });

    expect(prisma.referral.create).toHaveBeenCalledTimes(1);
    const calledWith = prisma.referral.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(calledWith.data['inn']).toBeNull();
    expect(calledWith.data['legalForm']).toBeNull();
    expect(calledWith.data['contractAcceptedAt']).toBeInstanceOf(Date);
    expect((ref as unknown as { contractAcceptedAt: Date }).contractAcceptedAt).toBeInstanceOf(Date);
  });
});

/**
 * ТЗ referrals-cabinet-revamp §6.4 — listClients возвращает маскированный view:
 *   - НЕТ org.id, org.name.
 *   - clientCode = 'C' + base36(crc32(linkId)).
 *   - status вычисляется из firstPaidAt + subscription.
 *   - monthlyEarningsKopecks / totalEarnedKopecks — агрегаты payouts.
 */
describe('ReferralsService.listClients (маскировка)', () => {
  let prisma: {
    clientReferralLink: { findMany: ReturnType<typeof vi.fn> };
    referralPayout: { findMany: ReturnType<typeof vi.fn> };
  };
  let svc: ReferralsService;

  beforeEach(() => {
    prisma = {
      clientReferralLink: { findMany: vi.fn() },
      referralPayout: { findMany: vi.fn() },
    };
    const innLookup = { lookup: vi.fn() };
    const metrics = { incReferralInnMismatch: vi.fn() };
    svc = new ReferralsService(
      prisma as unknown as PrismaService,
      innLookup as unknown as InnLookupService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  it('возвращает []  для пустого списка', async () => {
    prisma.clientReferralLink.findMany.mockResolvedValueOnce([]);
    const out = await svc.listClients('ref-1');
    expect(out).toEqual([]);
    expect(prisma.referralPayout.findMany).not.toHaveBeenCalled();
  });

  it('маскирует клиента: clientCode, status, без org.id/org.name', async () => {
    const link = {
      id: 'link-abc',
      attachedAt: new Date('2026-05-01T10:00:00Z'),
      firstPaidAt: new Date('2026-05-15T10:00:00Z'),
      subscription: { status: 'ACTIVE', paymentMode: 'paid' },
    };
    prisma.clientReferralLink.findMany.mockResolvedValueOnce([link]);
    prisma.referralPayout.findMany.mockResolvedValueOnce([
      {
        clientReferralLinkId: 'link-abc',
        amountKopecks: 2_000_000,
        createdAt: new Date(), // в текущем месяце
      },
      {
        clientReferralLinkId: 'link-abc',
        amountKopecks: 2_000_000,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const out = await svc.listClients('ref-1');
    expect(out).toHaveLength(1);
    const row = out[0]!;
    // Не должно быть полей идентифицирующих Org.
    expect(row).not.toHaveProperty('org');
    expect(row).not.toHaveProperty('orgId');
    expect(row).not.toHaveProperty('tenantId');
    expect(row).not.toHaveProperty('id'); // link.id тоже не утекает
    expect(row.clientCode).toBe(clientCodeFromLinkId('link-abc'));
    expect(row.clientCode).toMatch(/^C[0-9a-z]+$/);
    expect(row.status).toBe('active');
    expect(row.totalEarnedKopecks).toBe(4_000_000);
    expect(row.monthlyEarningsKopecks).toBe(2_000_000);
  });

  it('status="pending" если firstPaidAt == null', async () => {
    prisma.clientReferralLink.findMany.mockResolvedValueOnce([
      {
        id: 'link-x',
        attachedAt: new Date(),
        firstPaidAt: null,
        subscription: null,
      },
    ]);
    prisma.referralPayout.findMany.mockResolvedValueOnce([]);
    const out = await svc.listClients('ref-1');
    expect(out[0]!.status).toBe('pending');
    expect(out[0]!.monthlyEarningsKopecks).toBe(0);
  });

  it('status="churned" если firstPaidAt был, но подписка уже не ACTIVE+paid', async () => {
    prisma.clientReferralLink.findMany.mockResolvedValueOnce([
      {
        id: 'link-y',
        attachedAt: new Date('2025-01-01'),
        firstPaidAt: new Date('2025-02-01'),
        subscription: { status: 'CANCELED', paymentMode: 'paid' },
      },
    ]);
    prisma.referralPayout.findMany.mockResolvedValueOnce([]);
    const out = await svc.listClients('ref-1');
    expect(out[0]!.status).toBe('churned');
  });
});

/**
 * ТЗ referrals-cabinet-revamp §7.3 — getFunnel / getIncomeChart.
 */
describe('ReferralsService.getFunnel + getIncomeChart', () => {
  function makeFunnelMocks(slug: string | null) {
    return {
      referral: {
        findUnique: vi.fn().mockResolvedValue(slug ? { slug } : null),
      },
      referralAttribution: { count: vi.fn() },
      clientReferralLink: { count: vi.fn(), findMany: vi.fn() },
      org: { count: vi.fn() },
      referralPayout: { findMany: vi.fn() },
    };
  }

  it('getFunnel("30d"): корректные счётчики и конверсии', async () => {
    const prisma = makeFunnelMocks('mysiug');
    prisma.referralAttribution.count.mockResolvedValueOnce(200); // clicks
    prisma.clientReferralLink.count
      .mockResolvedValueOnce(40) // signups from links
      .mockResolvedValueOnce(8) // firstPayments
      .mockResolvedValueOnce(6); // activeNow
    prisma.org.count.mockResolvedValueOnce(10); // signups from pending orgs
    const innLookup = { lookup: vi.fn() };
    const metrics = { incReferralInnMismatch: vi.fn() };
    const svc = new ReferralsService(
      prisma as unknown as PrismaService,
      innLookup as unknown as InnLookupService,
      metrics as unknown as BusinessMetricsService,
    );

    const funnel = await svc.getFunnel('ref-1', '30d');
    expect(funnel.period).toBe('30d');
    expect(funnel.clicks).toBe(200);
    expect(funnel.signups).toBe(50); // 40 + 10
    expect(funnel.firstPayments).toBe(8);
    expect(funnel.activeNow).toBe(6);
    expect(funnel.conversions.clickToSignupPercent).toBe(25); // 50/200 = 25%
    expect(funnel.conversions.signupToPaidPercent).toBe(16); // 8/50 = 16%
    expect(funnel.conversions.clickToPaidPercent).toBe(4); // 8/200 = 4%
  });

  it('getFunnel: деление на 0 → конверсия 0, без NaN', async () => {
    const prisma = makeFunnelMocks('s');
    prisma.referralAttribution.count.mockResolvedValueOnce(0);
    prisma.clientReferralLink.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.org.count.mockResolvedValueOnce(0);
    const svc = new ReferralsService(
      prisma as unknown as PrismaService,
      { lookup: vi.fn() } as unknown as InnLookupService,
      { incReferralInnMismatch: vi.fn() } as unknown as BusinessMetricsService,
    );
    const funnel = await svc.getFunnel('ref-1', '90d');
    expect(funnel.conversions.clickToSignupPercent).toBe(0);
    expect(funnel.conversions.signupToPaidPercent).toBe(0);
    expect(funnel.conversions.clickToPaidPercent).toBe(0);
  });

  it('getIncomeChart: массив длиной 12, ключи YYYY-MM в хронологическом порядке', async () => {
    const prisma = {
      referralPayout: {
        findMany: vi.fn().mockResolvedValue([
          {
            periodMonth: new Date()
              .toISOString()
              .slice(0, 7), // текущий месяц 'YYYY-MM'
            amountKopecks: 2_000_000,
          },
        ]),
      },
      clientReferralLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const svc = new ReferralsService(
      prisma as unknown as PrismaService,
      { lookup: vi.fn() } as unknown as InnLookupService,
      { incReferralInnMismatch: vi.fn() } as unknown as BusinessMetricsService,
    );

    const points = await svc.getIncomeChart('ref-1');
    expect(points).toHaveLength(12);
    // последний элемент — текущий месяц с доходом 20 000 ₽.
    expect(points[11]!.incomeRub).toBe(20_000);
    // Все месяцы валидной формы.
    for (const p of points) {
      expect(p.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    }
    // Месяцы упорядочены по возрастанию.
    const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
    expect(points.map((p) => p.month)).toEqual(sorted.map((p) => p.month));
  });
});

/**
 * ТЗ referrals-cabinet-revamp §6.3 + §6.5 — hasPayoutDetails:
 *   - используется в `computeWithdrawalEligibility` (no_payout_details);
 *   - выставляется как computed-поле `hasPayoutDetails` в `ReferralViewBody`
 *     (фронт строит по нему `payoutDetailsAreFilled` → `canWithdraw`).
 */
describe('hasPayoutDetails (file-scope helper)', () => {
  it('null → false', () => {
    expect(hasPayoutDetails({ payoutDetails: null })).toBe(false);
  });

  it('пустой объект → false', () => {
    expect(hasPayoutDetails({ payoutDetails: {} })).toBe(false);
  });

  it('непустой объект → true', () => {
    expect(
      hasPayoutDetails({
        payoutDetails: { bankAccount: '40817810099910004312' },
      }),
    ).toBe(true);
  });

  it('массив → false (не объект-с-ключами)', () => {
    // На уровне Prisma JsonValue массив теоретически возможен,
    // но это не корректные реквизиты — считаем «не заполнено».
    expect(hasPayoutDetails({ payoutDetails: ['x'] })).toBe(false);
  });
});

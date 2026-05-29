import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { InnLookupService } from '../../inn-lookup/inn-lookup.service';

import { ReferralsService } from './referrals.service';

/**
 * audit Б6 (2026-05-29) — спецификация на verifyInn:
 *   - mismatch ИНН в lookup-результате → метрика, БЕЗ innVerifiedAt.
 *   - company-payerType + directorName не совпадает с User.name → pending.
 *   - company-payerType + directorName совпадает → innVerifiedAt=now.
 *   - self_employed + правильный ИНН → innVerifiedAt=now.
 */
describe('ReferralsService.verifyInn (audit Б6)', () => {
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
});

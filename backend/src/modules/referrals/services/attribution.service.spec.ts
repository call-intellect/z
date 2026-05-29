import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AttributionService } from './attribution.service';

/**
 * audit Б6 (2026-05-29) — спецификация на блок self-referral в attributeOrg.
 *
 * Покрытие:
 *   - self-referral (Referral.ownerUserId уже member orgId) → ConflictException
 *     + метрика referral_self_referral_denied_total.
 *   - обычный referral (ownerUserId НЕ member) → запись в pendingAttribution.
 *   - нет атрибуции → null.
 */
describe('AttributionService.attributeOrg (audit Б6)', () => {
  let prisma: {
    referralAttribution: { findFirst: ReturnType<typeof vi.fn> };
    referral: { findUnique: ReturnType<typeof vi.fn> };
    membership: { findUnique: ReturnType<typeof vi.fn> };
    org: { update: ReturnType<typeof vi.fn> };
  };
  let metrics: {
    incReferralSelfReferralDenied: ReturnType<typeof vi.fn>;
  };
  let svc: AttributionService;

  beforeEach(() => {
    prisma = {
      referralAttribution: { findFirst: vi.fn() },
      referral: { findUnique: vi.fn() },
      membership: { findUnique: vi.fn() },
      org: { update: vi.fn(async () => ({})) },
    };
    metrics = {
      incReferralSelfReferralDenied: vi.fn(),
    };
    svc = new AttributionService(
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  it('null если ни cookieSlug ни fingerprint не нашли запись', async () => {
    prisma.referralAttribution.findFirst.mockResolvedValue(null);
    const result = await svc.attributeOrg({
      tenantId: 'org-1',
      cookieSlug: 'abc12345',
    });
    expect(result).toBeNull();
    expect(prisma.org.update).not.toHaveBeenCalled();
  });

  it('обычная атрибуция: ownerUserId НЕ member orgId → pendingAttribution', async () => {
    prisma.referralAttribution.findFirst.mockResolvedValueOnce({
      id: 'attr-1',
      slug: 'abc12345',
      referralId: 'ref-1',
    });
    prisma.referral.findUnique.mockResolvedValueOnce({
      ownerUserId: 'u-partner',
      slug: 'abc12345',
    });
    prisma.membership.findUnique.mockResolvedValueOnce(null);

    const result = await svc.attributeOrg({
      tenantId: 'org-1',
      cookieSlug: 'abc12345',
    });
    expect(result).toEqual({
      referralId: 'ref-1',
      slug: 'abc12345',
      attributionId: 'attr-1',
    });
    expect(prisma.org.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          pendingAttributionSlug: 'abc12345',
        }),
      }),
    );
    expect(metrics.incReferralSelfReferralDenied).not.toHaveBeenCalled();
  });

  it('self-referral: ownerUserId уже member orgId → 409 + метрика', async () => {
    prisma.referralAttribution.findFirst.mockResolvedValueOnce({
      id: 'attr-1',
      slug: 'mine',
      referralId: 'ref-mine',
    });
    prisma.referral.findUnique.mockResolvedValueOnce({
      ownerUserId: 'u-self',
      slug: 'mine',
    });
    // Тот же u-self уже состоит в org-1.
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'owner' });

    await expect(
      svc.attributeOrg({ tenantId: 'org-1', cookieSlug: 'mine' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(metrics.incReferralSelfReferralDenied).toHaveBeenCalled();
    expect(prisma.org.update).not.toHaveBeenCalled();
  });
});

/**
 * audit Б8 (2026-05-29) — record() идемпотентен по
 * (referralId, fingerprint, dateBucket). DoS-flood защищён composite unique.
 */
describe('AttributionService.record (audit Б8)', () => {
  let prisma: {
    referral: { findUnique: ReturnType<typeof vi.fn> };
    referralAttribution: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let svc: AttributionService;

  beforeEach(() => {
    prisma = {
      referral: { findUnique: vi.fn() },
      referralAttribution: { create: vi.fn(), findFirst: vi.fn() },
    };
    const metrics = {
      incReferralSelfReferralDenied: vi.fn(),
    } as unknown as BusinessMetricsService;
    svc = new AttributionService(prisma as unknown as PrismaService, metrics);
  });

  it('новая запись: dateBucket = YYYY-MM-DD UTC, сохраняется fingerprint', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'ref-1',
      slug: 'abc',
    });
    prisma.referralAttribution.create.mockImplementationOnce(
      async ({ data }: { data: { dateBucket: string; fingerprint: string | null } }) => ({
        id: 'attr-new',
        dateBucket: data.dateBucket,
        fingerprint: data.fingerprint,
      }),
    );
    const result = await svc.record({
      slug: 'abc',
      fingerprint: 'fp-aaaa',
    });
    expect(result.id).toBe('attr-new');
    const createCall = prisma.referralAttribution.create.mock.calls[0]![0] as {
      data: { dateBucket: string; fingerprint: string };
    };
    expect(createCall.data.dateBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(createCall.data.fingerprint).toBe('fp-aaaa');
  });

  it('P2002 на composite unique: возвращает существующую запись (идемпотентность)', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'ref-1',
      slug: 'abc',
    });
    prisma.referralAttribution.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.referralAttribution.findFirst.mockResolvedValueOnce({
      id: 'attr-existing',
    });

    const result = await svc.record({
      slug: 'abc',
      fingerprint: 'fp-flood',
    });
    expect(result.id).toBe('attr-existing');
    expect(prisma.referralAttribution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referralId: 'ref-1',
          fingerprint: 'fp-flood',
        }),
      }),
    );
  });

  it('beacon на неизвестный slug: skipped, без create', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce(null);
    const result = await svc.record({
      slug: 'unknown',
      fingerprint: 'fp-x',
    });
    expect(result).toEqual({ id: 'skipped' });
    expect(prisma.referralAttribution.create).not.toHaveBeenCalled();
  });

  it('P2002 при fingerprint=NULL: НЕ перехватывается (composite unique не работает с NULL)', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce({
      id: 'ref-1',
      slug: 'abc',
    });
    const err = new Prisma.PrismaClientKnownRequestError('other unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.referralAttribution.create.mockRejectedValueOnce(err);

    await expect(
      svc.record({ slug: 'abc', fingerprint: null }),
    ).rejects.toBe(err);
  });
});

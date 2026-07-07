import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { CompanyCapsuleService } from './company-capsule.service';

type ProfileRow = {
  displayName: string | null;
  stage: string | null;
  summaryJson: unknown;
  missionJson: unknown;
} | null;

function makePrisma(findUnique: ReturnType<typeof vi.fn>): PrismaService {
  return {
    companyProfile: { findUnique },
  } as unknown as PrismaService;
}

function makeMetrics(): { incCompanyCapsuleInjected: ReturnType<typeof vi.fn> } {
  return { incCompanyCapsuleInjected: vi.fn() };
}

describe('CompanyCapsuleService.load', () => {
  it('непустой профиль → секция «О компании» + метрика с surface', async () => {
    const findUnique = vi.fn(async () => ({
      displayName: 'Ооо луа',
      stage: 'growth',
      summaryJson: { contentMd: 'Память компании для AI.' },
      missionJson: null,
    }));
    const metrics = makeMetrics();
    const svc = new CompanyCapsuleService(
      makePrisma(findUnique),
      metrics as unknown as BusinessMetricsService,
    );

    const out = await svc.load('t1', 'tasks');

    expect(out).toContain('## О компании');
    expect(out).toContain('Название: Ооо луа');
    expect(out).toContain('Чем занимается: Память компании для AI.');
    expect(out).toContain('Стадия: growth');
    expect(metrics.incCompanyCapsuleInjected).toHaveBeenCalledWith({
      surface: 'tasks',
    });
  });

  it('tenantId=null → пустая строка, prisma не зван', async () => {
    const findUnique = vi.fn();
    const svc = new CompanyCapsuleService(makePrisma(findUnique));

    const out = await svc.load(null, 'tasks');

    expect(out).toBe('');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('профиль отсутствует (null) → пустая строка', async () => {
    const findUnique = vi.fn(async () => null as ProfileRow);
    const svc = new CompanyCapsuleService(makePrisma(findUnique));

    const out = await svc.load('t1', 'tasks');

    expect(out).toBe('');
  });

  it('prisma бросает → fail-open «», метрика не зван', async () => {
    const findUnique = vi.fn(async () => {
      throw new Error('db down');
    });
    const metrics = makeMetrics();
    const svc = new CompanyCapsuleService(
      makePrisma(findUnique),
      metrics as unknown as BusinessMetricsService,
    );

    const out = await svc.load('t1', 'tasks');

    expect(out).toBe('');
    expect(metrics.incCompanyCapsuleInjected).not.toHaveBeenCalled();
  });
});

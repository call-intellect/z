import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { MeetingsBalanceService } from './meetings-balance.service';

interface FakePrisma {
  meetingsBalance: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): FakePrisma {
  return {
    meetingsBalance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

function makeFallbackCfg(): TypedConfigService {
  return {
    getDynamic: async <T>(_key: string, _envKey: string | undefined, def: T): Promise<T> => def,
  } as unknown as TypedConfigService;
}

function makeOverridingCfg(overrides: Record<string, number>): TypedConfigService {
  return {
    getDynamic: async <T>(key: string, _envKey: string | undefined, def: T): Promise<T> => {
      if (key in overrides) return overrides[key] as unknown as T;
      return def;
    },
  } as unknown as TypedConfigService;
}

describe('MeetingsBalanceService.calculateMeetingsGrant (code-fallback)', () => {
  let svc: MeetingsBalanceService;

  beforeEach(() => {
    const prisma = makePrisma();
    svc = new MeetingsBalanceService(prisma as unknown as PrismaService, makeFallbackCfg());
  });

  it('базовый грант = 150 при seatsExtra=0', async () => {
    expect(await svc.calculateMeetingsGrant(0)).toBe(150);
  });

  it('+5 за каждое доп. место', async () => {
    expect(await svc.calculateMeetingsGrant(1)).toBe(155);
    expect(await svc.calculateMeetingsGrant(10)).toBe(200);
    expect(await svc.calculateMeetingsGrant(100)).toBe(650);
  });

  it('отрицательный seatsExtra → clamp до 0', async () => {
    expect(await svc.calculateMeetingsGrant(-5)).toBe(150);
  });

  it('getBaseMeetingsGrant() / getPerExtraSeatMeetingsGrant() — code-fallback', async () => {
    expect(await svc.getBaseMeetingsGrant()).toBe(150);
    expect(await svc.getPerExtraSeatMeetingsGrant()).toBe(5);
  });
});

describe('MeetingsBalanceService.calculateMeetingsGrant — AdminSetting override', () => {
  it('правка billing.baseMeetingsGrant применяется сразу', async () => {
    const prisma = makePrisma();
    const cfg = makeOverridingCfg({ 'billing.baseMeetingsGrant': 200 });
    const svc = new MeetingsBalanceService(prisma as unknown as PrismaService, cfg);
    expect(await svc.calculateMeetingsGrant(0)).toBe(200);
    expect(await svc.calculateMeetingsGrant(10)).toBe(250);
  });

  it('правка billing.perExtraSeatMeetingsGrant применяется сразу', async () => {
    const prisma = makePrisma();
    const cfg = makeOverridingCfg({ 'billing.perExtraSeatMeetingsGrant': 10 });
    const svc = new MeetingsBalanceService(prisma as unknown as PrismaService, cfg);
    expect(await svc.calculateMeetingsGrant(0)).toBe(150);
    expect(await svc.calculateMeetingsGrant(5)).toBe(200);
  });
});

describe('MeetingsBalanceService', () => {
  let prisma: FakePrisma;
  let svc: MeetingsBalanceService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new MeetingsBalanceService(prisma as unknown as PrismaService, makeFallbackCfg());
  });

  it('getBalance: запись есть → view', async () => {
    const granted = new Date('2026-05-01T00:00:00Z');
    prisma.meetingsBalance.findUnique.mockResolvedValueOnce({
      balance: 75,
      totalGranted: 150,
      totalConsumed: 75,
      lastGrantedAt: granted,
    });
    const view = await svc.getBalance('t-1');
    expect(view).toEqual({
      balance: 75,
      totalGranted: 150,
      totalConsumed: 75,
      lastGrantedAt: granted,
    });
  });

  it('getBalance: записи нет → нулевой view', async () => {
    prisma.meetingsBalance.findUnique.mockResolvedValueOnce(null);
    const view = await svc.getBalance('t-empty');
    expect(view).toEqual({
      balance: 0,
      totalGranted: 0,
      totalConsumed: 0,
      lastGrantedAt: null,
    });
  });

  it('grant: upsert с inc balance и totalGranted', async () => {
    prisma.meetingsBalance.upsert.mockResolvedValueOnce({});
    await svc.grant('t-1', 150);
    expect(prisma.meetingsBalance.upsert).toHaveBeenCalledWith({
      where: { tenantId: 't-1' },
      create: expect.objectContaining({
        tenantId: 't-1',
        balance: 150,
        totalGranted: 150,
        lastGrantedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        balance: { increment: 150 },
        totalGranted: { increment: 150 },
        lastGrantedAt: expect.any(Date),
      }),
    });
  });

  it('grant(0) → no-op, БД не трогается', async () => {
    await svc.grant('t-1', 0);
    expect(prisma.meetingsBalance.upsert).not.toHaveBeenCalled();
  });

  it('grant(-5) → no-op, БД не трогается', async () => {
    await svc.grant('t-1', -5);
    expect(prisma.meetingsBalance.upsert).not.toHaveBeenCalled();
  });

  it('consume: affected=1 → не throw', async () => {
    prisma.meetingsBalance.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(svc.consume('t-1', 1)).resolves.toBeUndefined();
    expect(prisma.meetingsBalance.updateMany).toHaveBeenCalledOnce();
  });

  it('consume: affected=0 → ForbiddenException', async () => {
    prisma.meetingsBalance.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.consume('t-empty', 1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consume(0) → no-op, updateMany не зовётся', async () => {
    await svc.consume('t-1', 0);
    expect(prisma.meetingsBalance.updateMany).not.toHaveBeenCalled();
  });

  it('consume(-1) → no-op', async () => {
    await svc.consume('t-1', -1);
    expect(prisma.meetingsBalance.updateMany).not.toHaveBeenCalled();
  });

  it('consume передаёт tenantId и amount в типизированный updateMany', async () => {
    prisma.meetingsBalance.updateMany.mockResolvedValueOnce({ count: 1 });
    await svc.consume('tenant-abc', 3);
    expect(prisma.meetingsBalance.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-abc', balance: { gte: 3 } },
      data: {
        balance: { decrement: 3 },
        totalConsumed: { increment: 3 },
      },
    });
  });
});

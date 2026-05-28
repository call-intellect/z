/**
 * Unit-тесты MeetingsBalanceService.
 *
 * Покрытие:
 *   - calculateMeetingsGrant: 150 + seatsExtra*5, clamp negative
 *   - getBalance: запись есть → view; запись нет → нулевой view
 *   - grant: upsert (create на первом и increment на втором)
 *   - grant(0 или -1) → no-op
 *   - consume: affected=1 → не throw; affected=0 → ForbiddenException
 *   - consume(0) → no-op (не лезет в БД)
 *   - SQL содержит правильный tenantId и amount (через template tag)
 */

import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  BASE_MEETINGS_GRANT,
  calculateMeetingsGrant,
  MeetingsBalanceService,
  PER_EXTRA_SEAT_MEETINGS_GRANT,
} from './meetings-balance.service';

interface FakePrisma {
  meetingsBalance: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  $executeRaw: ReturnType<typeof vi.fn>;
}

function makePrisma(): FakePrisma {
  return {
    meetingsBalance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };
}

describe('calculateMeetingsGrant', () => {
  it('базовый грант = 150 при seatsExtra=0', () => {
    expect(calculateMeetingsGrant(0)).toBe(BASE_MEETINGS_GRANT);
    expect(calculateMeetingsGrant(0)).toBe(150);
  });

  it('+5 за каждое доп. место', () => {
    expect(calculateMeetingsGrant(1)).toBe(155);
    expect(calculateMeetingsGrant(10)).toBe(200);
    expect(calculateMeetingsGrant(100)).toBe(650);
  });

  it('per-extra-seat = 5', () => {
    expect(PER_EXTRA_SEAT_MEETINGS_GRANT).toBe(5);
  });

  it('отрицательный seatsExtra → clamp до 0', () => {
    expect(calculateMeetingsGrant(-5)).toBe(BASE_MEETINGS_GRANT);
  });
});

describe('MeetingsBalanceService', () => {
  let prisma: FakePrisma;
  let svc: MeetingsBalanceService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new MeetingsBalanceService(prisma as unknown as PrismaService);
  });

  // ────────── getBalance ──────────

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

  // ────────── grant ──────────

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

  // ────────── consume ──────────

  it('consume: affected=1 → не throw', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1);
    await expect(svc.consume('t-1', 1)).resolves.toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it('consume: affected=0 → ForbiddenException', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0);
    await expect(svc.consume('t-empty', 1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('consume(0) → no-op, $executeRaw не зовётся', async () => {
    await svc.consume('t-1', 0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('consume(-1) → no-op', async () => {
    await svc.consume('t-1', -1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('consume передаёт tenantId и amount в template tag', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1);
    await svc.consume('tenant-abc', 3);
    // Prisma tagged template передаёт SQL+values массивом. Проверяем что
    // строка содержит ключевые куски UPDATE.
    const callArgs = prisma.$executeRaw.mock.calls[0];
    expect(callArgs).toBeDefined();
    // первый аргумент — массив строк template literal
    const sqlParts = callArgs?.[0];
    expect(Array.isArray(sqlParts)).toBe(true);
    const sql = (sqlParts as string[]).join(' ').toLowerCase();
    expect(sql).toContain('update meetings_balance');
    expect(sql).toContain('balance >=');
    // values (после первого аргумента) содержат amount + tenant + amount
    const values = callArgs?.slice(1);
    expect(values).toContain(3);
    expect(values).toContain('tenant-abc');
  });
});

import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { CrossmarkUsageService } from './crossmark-usage.service';

function makePrismaMock(opts: {
  totalsSum: { inputTokens: number | null; outputTokens: number | null; costUsd: unknown };
  distinctMeetings: Array<{ meetingId: string }>;
  byModelRows: Array<{
    model: string;
    _count: { _all: number };
    _sum: { costUsd: unknown };
  }>;
  byTypeRows: Array<{ meetingType: string; _count: { _all: number } }>;
}): { prisma: PrismaService; calls: { aggregate: unknown; groupBy: unknown[] } } {
  const calls = { aggregate: undefined as unknown, groupBy: [] as unknown[] };
  const prisma = {
    aiUsageLog: {
      aggregate: vi.fn(async (args: unknown) => {
        calls.aggregate = args;
        return { _sum: opts.totalsSum };
      }),
      findMany: vi.fn(async () => opts.distinctMeetings),
      groupBy: vi.fn(async (args: unknown) => {
        calls.groupBy.push(args);
        return opts.byModelRows;
      }),
    },
    aiResult: {
      groupBy: vi.fn(async (args: unknown) => {
        calls.groupBy.push(args);
        return opts.byTypeRows;
      }),
    },
  } as unknown as PrismaService;
  return { prisma, calls };
}

describe('CrossmarkUsageService', () => {
  const FROM = new Date('2026-05-01T00:00:00Z');
  const TO = new Date('2026-05-08T00:00:00Z');

  it('агрегирует totals/by_model/by_meeting_type для пустого периода', async () => {
    const { prisma } = makePrismaMock({
      totalsSum: { inputTokens: null, outputTokens: null, costUsd: null },
      distinctMeetings: [],
      byModelRows: [],
      byTypeRows: [],
    });
    const svc = new CrossmarkUsageService(prisma);

    const result = await svc.getUsage(FROM, TO);

    expect(result.from).toBe(FROM.toISOString());
    expect(result.to).toBe(TO.toISOString());
    expect(result.totals).toEqual({
      meetings: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    expect(result.by_model).toEqual([]);
    expect(result.by_meeting_type).toEqual([]);
  });

  it('конвертирует Prisma.Decimal в number и считает distinct meetings', async () => {
    const { prisma } = makePrismaMock({
      totalsSum: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: new Prisma.Decimal('0.123456'),
      },
      distinctMeetings: [{ meetingId: 'm-1' }, { meetingId: 'm-2' }],
      byModelRows: [
        {
          model: 'claude-sonnet-4-6',
          _count: { _all: 5 },
          _sum: { costUsd: new Prisma.Decimal('0.099999') },
        },
        {
          model: 'vox-ru-v3',
          _count: { _all: 3 },
          _sum: { costUsd: new Prisma.Decimal('0.023457') },
        },
      ],
      byTypeRows: [
        { meetingType: 'sales', _count: { _all: 4 } },
        { meetingType: 'standup', _count: { _all: 2 } },
      ],
    });
    const svc = new CrossmarkUsageService(prisma);

    const result = await svc.getUsage(FROM, TO);

    expect(result.totals).toEqual({
      meetings: 2,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: expect.closeTo(0.123456, 6),
    });
    expect(result.by_model).toHaveLength(2);
    expect(result.by_model[0]).toEqual({
      model: 'claude-sonnet-4-6',
      count: 5,
      costUsd: expect.closeTo(0.099999, 6),
    });
    expect(result.by_meeting_type).toEqual([
      { type: 'sales', count: 4 },
      { type: 'standup', count: 2 },
    ]);
  });
});

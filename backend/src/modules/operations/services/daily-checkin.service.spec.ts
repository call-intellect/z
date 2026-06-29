import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { DailyCheckInService } from './daily-checkin.service';

function makeService() {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const prisma = {
    dailyCheckIn: { findUnique, upsert },
  };
  const metrics = { incDailyCheckinCompleted: vi.fn() };
  const emit = vi.fn();
  const eventEmitter = { emit };
  const service = new DailyCheckInService(
    prisma as unknown as PrismaService,
    metrics as unknown as BusinessMetricsService,
    eventEmitter as never,
  );
  return { service, findUnique, upsert, emit };
}

function rowFromUpsertArgs(callArgs: { where: any; create: any; update: any }, id: string) {
  const data = { ...callArgs.create };
  return {
    id,
    tenantId: data.tenantId,
    personId: data.personId,
    kind: data.kind,
    dateLocal: data.dateLocal,
    plansJson: data.plansJson,
    donesJson: data.donesJson,
    blockersJson: data.blockersJson,
    notificationId: data.notificationId ?? null,
    parseConfidence: data.parseConfidence,
    curatorReview: data.curatorReview,
    completedAt: data.completedAt ?? null,
    createdAt: new Date('2026-06-21T00:00:00.000Z'),
    updatedAt: new Date('2026-06-21T00:00:00.000Z'),
    source: data.source,
    sourceContributions: data.sourceContributions,
    sentiment: null,
    sentimentRationale: null,
    sentimentVersion: null,
    sentimentDeterminedAt: null,
  };
}

const NOW = new Date('2026-06-21T18:00:00Z');

describe('DailyCheckInService.upsertFromDaySignal', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
    ctx.upsert.mockImplementation((callArgs: any) => rowFromUpsertArgs(callArgs, 'ci-1'));
  });

  it('мердж двух вкладов на (person,date,morning): bitrix → meeting, план без дублей, meeting побеждает', async () => {
    const { service, findUnique, upsert } = ctx;

    findUnique.mockResolvedValueOnce(null);
    const first = await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      items: [{ text: 'A' }],
      dones: [],
      blockers: [],
      rawResponseText: 'raw-bitrix',
      parseConfidence: 0.9,
      source: 'bitrix',
      now: NOW,
    });

    const firstCall = upsert.mock.calls[0]![0];
    expect(firstCall.create.source).toBe('bitrix');
    expect(firstCall.create.plansJson).toEqual([{ text: 'A' }]);
    expect(Array.isArray(firstCall.create.sourceContributions)).toBe(true);
    expect(firstCall.create.sourceContributions).toHaveLength(1);
    expect(first.source).toBe('bitrix');

    const existingRow = {
      id: 'ci-1',
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      plansJson: [{ text: 'A' }],
      donesJson: null,
      blockersJson: null,
      notificationId: null,
      rawResponseText: 'raw-bitrix',
      parseConfidence: 0.9,
      curatorReview: false,
      completedAt: NOW,
      source: 'bitrix',
      sourceContributions: [{ source: 'bitrix', at: NOW.toISOString(), rank: 2 }],
      sentiment: null,
    };
    findUnique.mockResolvedValueOnce(existingRow);

    const second = await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      items: [{ text: 'A' }, { text: 'B' }],
      dones: [],
      blockers: [],
      rawResponseText: 'raw-meeting',
      parseConfidence: 0.8,
      source: 'meeting',
      now: NOW,
    });

    const secondCall = upsert.mock.calls[1]![0];
    expect(secondCall.update.source).toBe('meeting');
    expect(secondCall.update.plansJson).toEqual([{ text: 'A' }, { text: 'B' }]);
    expect(secondCall.update.sourceContributions).toHaveLength(2);
    expect(second.source).toBe('meeting');
    expect(second.plans).toHaveLength(2);
  });

  it('не-понижение: existing=manual (rank4), вклад bitrix → план дополнен, source/raw остаются manual', async () => {
    const { service, findUnique, upsert } = ctx;

    const existingRow = {
      id: 'ci-1',
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      plansJson: [{ text: 'manual-plan' }],
      donesJson: null,
      blockersJson: null,
      notificationId: null,
      rawResponseText: 'manual-raw',
      parseConfidence: 1,
      curatorReview: false,
      completedAt: NOW,
      source: 'manual',
      sourceContributions: [{ source: 'manual', at: NOW.toISOString(), rank: 4 }],
      sentiment: null,
    };
    findUnique.mockResolvedValueOnce(existingRow);

    await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      items: [{ text: 'C' }],
      dones: [],
      blockers: [],
      rawResponseText: 'bitrix-raw',
      parseConfidence: 0.7,
      source: 'bitrix',
      now: NOW,
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update).toEqual(
      expect.objectContaining({
        source: 'manual',
        rawResponseText: 'manual-raw',
        plansJson: [{ text: 'manual-plan' }, { text: 'C' }],
      }),
    );
    expect(call.update.sourceContributions).toHaveLength(2);
  });

  it('идемпотентность дедупа: повтор того же вклада (тот же text) → план не растёт', async () => {
    const { service, findUnique, upsert } = ctx;

    const existingRow = {
      id: 'ci-1',
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      plansJson: [{ text: 'A' }],
      donesJson: null,
      blockersJson: null,
      notificationId: null,
      rawResponseText: 'raw',
      parseConfidence: 0.9,
      curatorReview: false,
      completedAt: NOW,
      source: 'meeting',
      sourceContributions: [{ source: 'meeting', at: NOW.toISOString(), rank: 3 }],
      sentiment: null,
    };
    findUnique.mockResolvedValueOnce(existingRow);

    await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      items: [{ text: '  a  ' }],
      dones: [],
      blockers: [],
      rawResponseText: 'raw-2',
      parseConfidence: 0.9,
      source: 'meeting',
      now: NOW,
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update.plansJson).toEqual([{ text: 'A' }]);
  });

  it('эмитит checkin.created с kind/personId', async () => {
    const { service, findUnique, emit } = ctx;
    findUnique.mockResolvedValueOnce(null);

    await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'evening',
      dateLocal: '2026-06-21',
      items: [],
      dones: [{ text: 'D' }],
      blockers: [],
      rawResponseText: 'raw',
      parseConfidence: 0.9,
      source: 'chatbox',
      now: NOW,
    });

    expect(emit).toHaveBeenCalledWith(
      'checkin.created',
      expect.objectContaining({ kind: 'evening', personId: 'p1' }),
    );
  });

  it('evening: notDone/ideas прокидываются в upsert (create+update содержат notDoneJson/ideasJson)', async () => {
    const { service, findUnique, upsert } = ctx;
    findUnique.mockResolvedValueOnce(null);

    await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'evening',
      dateLocal: '2026-06-21',
      items: [],
      dones: [{ text: 'D' }],
      blockers: [],
      ideas: [{ text: 'Идея 1', sourceBlockId: 'blk-1' }],
      notDone: [{ text: 'не дожал', sourcePlanText: 'не дожал', verdictConfidence: 0.7 }],
      rawResponseText: 'raw',
      parseConfidence: 0.9,
      source: 'chatbox',
      now: NOW,
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.create).toEqual(
      expect.objectContaining({
        notDoneJson: [{ text: 'не дожал', sourcePlanText: 'не дожал', verdictConfidence: 0.7 }],
        ideasJson: [{ text: 'Идея 1', sourceBlockId: 'blk-1' }],
      }),
    );
    expect(call.update).toEqual(
      expect.objectContaining({
        notDoneJson: [{ text: 'не дожал', sourcePlanText: 'не дожал', verdictConfidence: 0.7 }],
        ideasJson: [{ text: 'Идея 1', sourceBlockId: 'blk-1' }],
      }),
    );
  });

  it('morning не затирает существующий notDone/ideas (сохраняет старые значения)', async () => {
    const { service, findUnique, upsert } = ctx;
    findUnique.mockResolvedValueOnce({
      id: 'ci-1',
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      plansJson: [{ text: 'A' }],
      donesJson: null,
      blockersJson: null,
      ideasJson: [{ text: 'старая идея' }],
      notDoneJson: [{ text: 'старый недодел' }],
      notificationId: null,
      rawResponseText: 'raw',
      parseConfidence: 0.9,
      curatorReview: false,
      completedAt: NOW,
      source: 'bitrix',
      sourceContributions: [{ source: 'bitrix', at: NOW.toISOString(), rank: 2 }],
      sentiment: null,
    });

    await service.upsertFromDaySignal({
      tenantId: 't1',
      personId: 'p1',
      kind: 'morning',
      dateLocal: '2026-06-21',
      items: [{ text: 'A' }, { text: 'B' }],
      dones: [],
      blockers: [],
      rawResponseText: 'raw-2',
      parseConfidence: 0.9,
      source: 'bitrix',
      now: NOW,
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update).toEqual(
      expect.objectContaining({
        notDoneJson: [{ text: 'старый недодел' }],
        ideasJson: [{ text: 'старая идея' }],
      }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegulationConsolidatorService } from './regulation-consolidator.service';

function makeProcessCard(trustTier: string) {
  return {
    id: 'p1',
    tenantId: 't1',
    name: 'Процесс A',
    status: 'active',
    scope: null,
    description: 'Описание процесса A',
    dataClass: 'internal',
    currentVersion: { trustTier },
  };
}

function makePrismaMock(card: ReturnType<typeof makeProcessCard>, curationHit: unknown) {
  const prismaMock: any = {
    process: {
      findUnique: vi.fn().mockResolvedValue(card),
      update: vi.fn().mockResolvedValue({}),
    },
    cardVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cv1' }),
    },
    curationDecision: {
      findFirst: vi.fn().mockResolvedValue(curationHit),
    },
  };
  prismaMock.$transaction = vi.fn(async (cb: any) => cb(prismaMock));
  return prismaMock;
}

function makeService(prismaMock: any, judgeDuplicate: any) {
  const redis = {
    client: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null) },
  } as any;
  const cfg = { aiFeatures: { regulationConsolidatorEnabled: true } } as any;
  const metrics = { incCoreSpecialistSkipped: vi.fn() } as any;
  const specialist = { judgeDuplicate } as any;
  return new RegulationConsolidatorService(prismaMock, redis, cfg, metrics, specialist);
}

describe('RegulationConsolidatorService.consolidateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('кейс 1: auto-карточка + кандидат + merge → merged, CardVersion(consolidate), loser deprecated', async () => {
    const card = makeProcessCard('auto');
    const prismaMock = makePrismaMock(card, null);
    const judgeDuplicate = vi
      .fn()
      .mockResolvedValue({ decision: 'merge', targetId: 'p2', reasoning: 'дубль' });
    const service = makeService(prismaMock, judgeDuplicate);
    vi.spyOn(service as any, 'findTopCandidate').mockResolvedValue({
      id: 'p2',
      name: 'Процесс A (копия)',
      statement: 'Описание процесса A',
      scope: null,
    });
    prismaMock.process.findUnique
      .mockResolvedValueOnce(card)
      .mockResolvedValueOnce({ currentVersion: { trustTier: 'auto' } })
      .mockResolvedValueOnce({ id: 'p1', sourceBlockIds: ['b1'], currentVersionId: null })
      .mockResolvedValueOnce({
        id: 'p2',
        tenantId: 't1',
        sourceBlockIds: ['b2'],
        currentVersionId: 'cvOld',
      });

    const outcome = await service.consolidateCard('process', 'p1');

    expect(outcome).toBe('merged');
    expect(prismaMock.cardVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeReason: 'consolidate' }),
      }),
    );
    expect(prismaMock.process.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'deprecated' }),
      }),
    );
  });

  it('кейс 2: trustTier=human → skipped_human, judge и cardVersion НЕ вызваны', async () => {
    const card = makeProcessCard('human');
    const prismaMock = makePrismaMock(card, null);
    const judgeDuplicate = vi.fn();
    const service = makeService(prismaMock, judgeDuplicate);
    const findTop = vi.spyOn(service as any, 'findTopCandidate');

    const outcome = await service.consolidateCard('process', 'p1');

    expect(outcome).toBe('skipped_human');
    expect(judgeDuplicate).not.toHaveBeenCalled();
    expect(prismaMock.cardVersion.create).not.toHaveBeenCalled();
    expect(findTop).not.toHaveBeenCalled();
  });

  it('кейс 3: человеко-решение «разные» (CurationDecision reject/split) → kept, judge не сливает', async () => {
    const card = makeProcessCard('auto');
    const prismaMock = makePrismaMock(card, { id: 'd1' });
    const judgeDuplicate = vi.fn();
    const service = makeService(prismaMock, judgeDuplicate);
    vi.spyOn(service as any, 'findTopCandidate').mockResolvedValue({
      id: 'p2',
      name: 'Процесс A (копия)',
      statement: 'Описание процесса A',
      scope: null,
    });
    prismaMock.process.findUnique
      .mockResolvedValueOnce(card)
      .mockResolvedValueOnce({ currentVersion: { trustTier: 'auto' } });

    const outcome = await service.consolidateCard('process', 'p1');

    expect(outcome).toBe('kept');
    expect(judgeDuplicate).not.toHaveBeenCalled();
    expect(prismaMock.cardVersion.create).not.toHaveBeenCalled();
  });
});

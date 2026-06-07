import { describe, expect, it, vi } from 'vitest';

import { GraphMaterializationService } from './graph-materialization.service';

/**
 * Agent-chain overhaul Фаза 0a (2026-06-07) — юнит-тесты наблюдаемости
 * материализации графа. PrismaService полностью замокан.
 *
 * Покрываем:
 *   (a) встреча с 3 блоками signalType='decision' и 0 Decision → gap decision;
 *   (b) встреча с decision-блоками И ненулевым Decision.count → нет gap decision;
 *   (c) встреча без rawEvents → blockCount=0, gaps=[].
 */

interface PrismaStub {
  rawEvent: { findMany: ReturnType<typeof vi.fn> };
  ideaBlockEvidence: { findMany: ReturnType<typeof vi.fn> };
  ideaBlock: { findMany: ReturnType<typeof vi.fn> };
  decision: { count: ReturnType<typeof vi.fn> };
  idea: { count: ReturnType<typeof vi.fn> };
  goal: { count: ReturnType<typeof vi.fn> };
}

function buildPrisma(): PrismaStub {
  return {
    rawEvent: { findMany: vi.fn(async () => []) },
    ideaBlockEvidence: { findMany: vi.fn(async () => []) },
    ideaBlock: { findMany: vi.fn(async () => []) },
    decision: { count: vi.fn(async () => 0) },
    idea: { count: vi.fn(async () => 0) },
    goal: { count: vi.fn(async () => 0) },
  };
}

function buildService(prisma: PrismaStub): GraphMaterializationService {
  return new GraphMaterializationService(prisma as never);
}

describe('GraphMaterializationService.getMeetingMaterialization', () => {
  it('(a) 3 блока signalType=decision, 0 Decision → gap decision {blocksWithSignal:3, materialized:0}', async () => {
    const prisma = buildPrisma();
    prisma.rawEvent.findMany.mockResolvedValueOnce([{ id: 're-1' }]);
    prisma.ideaBlockEvidence.findMany.mockResolvedValueOnce([
      { blockId: 'b1' },
      { blockId: 'b2' },
      { blockId: 'b3' },
      // дубликат — должен схлопнуться в Set.
      { blockId: 'b3' },
    ]);
    prisma.ideaBlock.findMany.mockResolvedValueOnce([
      { signalType: 'decision', status: 'canonical' },
      { signalType: 'decision', status: 'canonical' },
      { signalType: 'decision', status: 'draft' },
    ]);
    prisma.decision.count.mockResolvedValueOnce(0);
    prisma.idea.count.mockResolvedValueOnce(0);
    prisma.goal.count.mockResolvedValueOnce(0);

    const service = buildService(prisma);
    const res = await service.getMeetingMaterialization('tenant-1', 'm-1');

    expect(res.blockCount).toBe(3);
    expect(res.signalTypeDistribution).toEqual({ decision: 3 });
    expect(res.statusDistribution).toEqual({ canonical: 2, draft: 1 });
    expect(res.materialized).toEqual({ decisions: 0, ideas: 0, goals: 0 });
    expect(res.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'decision',
          blocksWithSignal: 3,
          materialized: 0,
        }),
      ]),
    );
    // blockIds дедуплицированы (b1,b2,b3) → count'ы вызваны с hasSome из 3 id.
    expect(prisma.decision.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          sourceBlockIds: { hasSome: ['b1', 'b2', 'b3'] },
        }),
      }),
    );
  });

  it('(b) decision-блоки И ненулевой Decision.count → нет gap decision', async () => {
    const prisma = buildPrisma();
    prisma.rawEvent.findMany.mockResolvedValueOnce([{ id: 're-1' }]);
    prisma.ideaBlockEvidence.findMany.mockResolvedValueOnce([
      { blockId: 'b1' },
      { blockId: 'b2' },
    ]);
    prisma.ideaBlock.findMany.mockResolvedValueOnce([
      { signalType: 'decision', status: 'canonical' },
      { signalType: 'decision', status: 'canonical' },
    ]);
    prisma.decision.count.mockResolvedValueOnce(2);
    prisma.idea.count.mockResolvedValueOnce(0);
    prisma.goal.count.mockResolvedValueOnce(0);

    const service = buildService(prisma);
    const res = await service.getMeetingMaterialization('tenant-1', 'm-2');

    expect(res.materialized.decisions).toBe(2);
    expect(res.gaps.some((g) => g.type === 'decision')).toBe(false);
  });

  it('(c) встреча без rawEvents → blockCount=0, gaps=[], без лишних запросов', async () => {
    const prisma = buildPrisma();
    prisma.rawEvent.findMany.mockResolvedValueOnce([]);

    const service = buildService(prisma);
    const res = await service.getMeetingMaterialization('tenant-1', 'm-3');

    expect(res.blockCount).toBe(0);
    expect(res.signalTypeDistribution).toEqual({});
    expect(res.statusDistribution).toEqual({});
    expect(res.materialized).toEqual({ decisions: 0, ideas: 0, goals: 0 });
    expect(res.gaps).toEqual([]);
    // Без rawEvents — дальше по цепочке не ходим.
    expect(prisma.ideaBlockEvidence.findMany).not.toHaveBeenCalled();
    expect(prisma.ideaBlock.findMany).not.toHaveBeenCalled();
    expect(prisma.decision.count).not.toHaveBeenCalled();
  });

  it('(d) idea-блоки, 0 Idea → gap idea; есть goals → нет gap goal (тип не отслеживается)', async () => {
    const prisma = buildPrisma();
    prisma.rawEvent.findMany.mockResolvedValueOnce([{ id: 're-1' }]);
    prisma.ideaBlockEvidence.findMany.mockResolvedValueOnce([{ blockId: 'b1' }]);
    prisma.ideaBlock.findMany.mockResolvedValueOnce([
      { signalType: 'idea', status: 'canonical' },
    ]);
    prisma.decision.count.mockResolvedValueOnce(0);
    prisma.idea.count.mockResolvedValueOnce(0);
    prisma.goal.count.mockResolvedValueOnce(1);

    const service = buildService(prisma);
    const res = await service.getMeetingMaterialization('tenant-1', 'm-4');

    expect(res.materialized).toEqual({ decisions: 0, ideas: 0, goals: 1 });
    expect(res.gaps).toEqual([
      { type: 'idea', blocksWithSignal: 1, materialized: 0 },
    ]);
  });
});

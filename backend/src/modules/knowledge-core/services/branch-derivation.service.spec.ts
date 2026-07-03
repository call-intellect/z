import { describe, expect, it, vi } from 'vitest';

import { BranchDerivationService, computeBranchSignal } from './branch-derivation.service';

interface PrismaStub {
  themeEntity: { findMany: ReturnType<typeof vi.fn> };
  theme: { findMany: ReturnType<typeof vi.fn> };
  regulation: { findMany: ReturnType<typeof vi.fn> };
  process: { findMany: ReturnType<typeof vi.fn> };
  decision: { findMany: ReturnType<typeof vi.fn> };
  document: { findMany: ReturnType<typeof vi.fn> };
}

function buildPrisma(): PrismaStub {
  return {
    themeEntity: { findMany: vi.fn(async () => []) },
    theme: { findMany: vi.fn(async () => []) },
    regulation: { findMany: vi.fn(async () => []) },
    process: { findMany: vi.fn(async () => []) },
    decision: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
  };
}

function buildService(prisma: PrismaStub): BranchDerivationService {
  return new BranchDerivationService(prisma as never);
}

describe('computeBranchSignal', () => {
  it('пусто → green', () => {
    expect(computeBranchSignal([])).toBe('green');
  });

  it('есть declining → red', () => {
    expect(
      computeBranchSignal([{ dynamic: 'growing' }, { dynamic: 'declining' }, { dynamic: 'stable' }]),
    ).toBe('red');
  });

  it('все growing → green', () => {
    expect(computeBranchSignal([{ dynamic: 'growing' }, { dynamic: 'growing' }])).toBe('green');
  });

  it('смешанное со stable → yellow', () => {
    expect(computeBranchSignal([{ dynamic: 'growing' }, { dynamic: 'stable' }])).toBe('yellow');
  });
});

describe('BranchDerivationService.deriveBranchForEntityIds', () => {
  it('сущность в двух темах: берётся branch темы с бОльшим weight', async () => {
    const prisma = buildPrisma();
    prisma.themeEntity.findMany.mockResolvedValueOnce([
      { entityId: 'e1', theme: { branch: 'clients', weight: 0.3 } },
      { entityId: 'e1', theme: { branch: 'sales', weight: 0.8 } },
    ]);
    const service = buildService(prisma);

    const map = await service.deriveBranchForEntityIds('t1', ['e1'], 'u1');

    expect(map.get('e1')).toBe('sales');
  });

  it('where содержит visibility-фильтр (team OR createdByUserId=viewer) и tenantId', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);

    await service.deriveBranchForEntityIds('t1', ['e1'], 'viewer-1');

    expect(prisma.themeEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          entityId: { in: ['e1'] },
          theme: expect.objectContaining({
            branch: { not: null },
            status: 'active',
            OR: [{ visibility: 'team' }, { createdByUserId: 'viewer-1' }],
          }),
        }),
      }),
    );
  });

  it('пустой вход → пустая Map, без запроса', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);

    const map = await service.deriveBranchForEntityIds('t1', [], 'u1');

    expect(map.size).toBe(0);
    expect(prisma.themeEntity.findMany).not.toHaveBeenCalled();
  });
});

describe('BranchDerivationService.deriveBranchForThemeIds', () => {
  it('возвращает Map themeId→branch (branch может быть null)', async () => {
    const prisma = buildPrisma();
    prisma.theme.findMany.mockResolvedValueOnce([
      { id: 'th1', branch: 'marketing' },
      { id: 'th2', branch: null },
    ]);
    const service = buildService(prisma);

    const map = await service.deriveBranchForThemeIds('t1', ['th1', 'th2'], 'u1');

    expect(map.get('th1')).toBe('marketing');
    expect(map.get('th2')).toBeNull();
  });
});

describe('BranchDerivationService.aggregateBranchMap', () => {
  it('регламент со связью через сущность темы «clients» → counts.regulations в clients; регламент без entityId → unassigned; themes по branch; tenant-scoped', async () => {
    const prisma = buildPrisma();
    prisma.theme.findMany.mockResolvedValueOnce([
      { branch: 'clients', dynamic: 'growing' },
      { branch: 'clients', dynamic: 'stable' },
      { branch: 'sales', dynamic: 'declining' },
      { branch: null, dynamic: 'stable' },
    ]);
    prisma.regulation.findMany.mockResolvedValueOnce([{ entityId: 'ent-clients' }]);
    prisma.themeEntity.findMany.mockResolvedValueOnce([
      { entityId: 'ent-clients', theme: { branch: 'clients', weight: 0.9 } },
    ]);
    const service = buildService(prisma);

    const result = await service.aggregateBranchMap('tenant-42', 'viewer-1');

    const clients = result.find((e) => e.branch === 'clients');
    const sales = result.find((e) => e.branch === 'sales');
    const unassigned = result.find((e) => e.branch === 'unassigned');

    expect(clients?.counts.themes).toBe(2);
    expect(clients?.counts.regulations).toBe(1);
    expect(clients?.signal).toBe('yellow');
    expect(sales?.counts.themes).toBe(1);
    expect(sales?.signal).toBe('red');
    expect(unassigned?.counts.themes).toBe(1);
    expect(result).toHaveLength(13);

    expect(prisma.theme.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-42', status: 'active' }),
      }),
    );
  });

  it('регламент без entityId → unassigned; пустой прочий контент → unassigned не появляется если нет counts', async () => {
    const prisma = buildPrisma();
    prisma.theme.findMany.mockResolvedValueOnce([{ branch: 'finance', dynamic: 'growing' }]);
    const service = buildService(prisma);

    const result = await service.aggregateBranchMap('tenant-1', 'u1');

    expect(result).toHaveLength(12);
    expect(result.find((e) => e.branch === 'unassigned')).toBeUndefined();
    expect(result.find((e) => e.branch === 'finance')?.signal).toBe('green');
  });
});

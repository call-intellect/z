import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleRegulationRetrievalService } from './role-regulation-retrieval.service';

const DIM = 1536;
const validVec = () => Array(DIM).fill(0.1) as number[];

interface Mocks {
  prisma: {
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    role: { findFirst: ReturnType<typeof vi.fn> };
    regulation: { findMany: ReturnType<typeof vi.fn> };
    instruction: { findMany: ReturnType<typeof vi.fn> };
    policy: { findMany: ReturnType<typeof vi.fn> };
    process: { findMany: ReturnType<typeof vi.fn> };
  };
  cfg: {
    getDynamic: ReturnType<typeof vi.fn>;
    ai: { embeddings: { dimensions: number } };
  };
  embedder: { embedQuery: ReturnType<typeof vi.fn> };
}

const tableOf = (sql: string): string => {
  const m = /FROM\s+"([a-z_]+)"/i.exec(sql);
  return m?.[1] ?? '';
};

const buildService = (mocks: Mocks): RoleRegulationRetrievalService =>
  new RoleRegulationRetrievalService(
    mocks.prisma as never,
    mocks.cfg as never,
    mocks.embedder as never,
  );

const makeMocks = (): Mocks => {
  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'clone.regulations.retrieval.top_n') return 6;
    if (key === 'clone.regulations.retrieval.min_similarity') return 0.3;
    if (key === 'clone.regulations.scope.include_org') return true;
    if (key === 'clone.regulations.snapshot.max_items') return 20;
    return def;
  });
  return {
    prisma: {
      $queryRawUnsafe: vi.fn(),
      role: { findFirst: vi.fn().mockResolvedValue({ departmentId: null }) },
      regulation: { findMany: vi.fn().mockResolvedValue([]) },
      instruction: { findMany: vi.fn().mockResolvedValue([]) },
      policy: { findMany: vi.fn().mockResolvedValue([]) },
      process: { findMany: vi.fn().mockResolvedValue([]) },
    },
    cfg: { getDynamic, ai: { embeddings: { dimensions: DIM } } },
    embedder: { embedQuery: vi.fn() },
  };
};

describe('RoleRegulationRetrievalService.retrieveForRole', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('happy-path: правила вернулись, Policy(blocking) первым, длина = topN', async () => {
    mocks.embedder.embedQuery.mockResolvedValue(validVec());
    mocks.prisma.$queryRawUnsafe.mockImplementation((sql: string) => {
      const table = tableOf(sql);
      if (table === 'regulations') {
        return Promise.resolve([
          { id: 'reg1', name: 'Регламент 1', text: 'тело-рег', scope: 'role:r1', severity: null, distance: 0.05 },
          { id: 'reg2', name: 'Регламент 2', text: 'тело-рег2', scope: 'org', severity: null, distance: 0.07 },
        ]);
      }
      if (table === 'instructions') {
        return Promise.resolve([
          { id: 'ins1', name: 'Инструкция 1', text: 'тело-инстр', scope: 'role:r1', severity: null, distance: 0.06 },
        ]);
      }
      if (table === 'policies') {
        return Promise.resolve([
          { id: 'pol1', name: 'Политика blocking', text: 'нельзя', scope: 'role:r1', severity: 'blocking', distance: 0.9 },
          { id: 'pol2', name: 'Политика mandatory', text: 'обязательно', scope: 'org', severity: 'mandatory', distance: 0.8 },
        ]);
      }
      if (table === 'processes') {
        return Promise.resolve([
          { id: 'prc1', name: 'Процесс 1', text: 'шаги', scope: 'role:r1', severity: null, distance: 0.04 },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'как делать X',
    });

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ id: 'pol1', kind: 'policy', severity: 'blocking' });
    expect(result[1]).toMatchObject({ id: 'pol2', kind: 'policy', severity: 'mandatory' });
    expect(mocks.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    expect(mocks.prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"regulations"'),
      expect.any(String),
      't1',
      expect.arrayContaining(['role:r1', 'org']),
      0.3,
    );
  });

  it("пустой query ('   ') → [], embedQuery не вызывался", async () => {
    const result = await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: '   ',
    });
    expect(result).toEqual([]);
    expect(mocks.embedder.embedQuery).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('embedQuery вернул null → []', async () => {
    mocks.embedder.embedQuery.mockResolvedValue(null);
    const result = await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'вопрос',
    });
    expect(result).toEqual([]);
    expect(mocks.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('embedQuery бросил → [] (не упало)', async () => {
    mocks.embedder.embedQuery.mockRejectedValue(new Error('embed down'));
    const result = await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'вопрос',
    });
    expect(result).toEqual([]);
    expect(mocks.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('guard reject: вектор размерности 3 (не 1536) → []', async () => {
    mocks.embedder.embedQuery.mockResolvedValue([1, 2, 3]);
    const result = await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'вопрос',
    });
    expect(result).toEqual([]);
    expect(mocks.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('включает department:<id> в scope, когда у роли есть departmentId', async () => {
    mocks.embedder.embedQuery.mockResolvedValue(validVec());
    mocks.prisma.role.findFirst.mockResolvedValue({ departmentId: 'd1' });
    mocks.prisma.$queryRawUnsafe.mockResolvedValue([]);
    await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'вопрос',
    });
    expect(mocks.prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', tenantId: 't1' } }),
    );
    expect(mocks.prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      't1',
      expect.arrayContaining(['role:r1', 'org', 'department:d1']),
      0.3,
    );
  });

  it('без departmentId у роли — scope ровно role+org (department не добавляется)', async () => {
    mocks.embedder.embedQuery.mockResolvedValue(validVec());
    mocks.prisma.role.findFirst.mockResolvedValue({ departmentId: null });
    mocks.prisma.$queryRawUnsafe.mockResolvedValue([]);
    await buildService(mocks).retrieveForRole({
      tenantId: 't1',
      roleId: 'r1',
      query: 'вопрос',
    });
    expect(mocks.prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      't1',
      ['role:r1', 'org'],
      0.3,
    );
  });
});

describe('RoleRegulationRetrievalService.listRoleSnapshot', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('собирает все 4 типа, kind корректный, severity только у policy, отсортировано по свежести', async () => {
    mocks.prisma.regulation.findMany.mockResolvedValue([
      {
        id: 'reg1',
        name: 'Регламент 1',
        scope: 'role:r1',
        lastConfirmedAt: new Date('2026-06-10T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mocks.prisma.instruction.findMany.mockResolvedValue([
      {
        id: 'ins1',
        name: 'Инструкция 1',
        scope: 'role:r1',
        lastConfirmedAt: null,
        updatedAt: new Date('2026-06-20T00:00:00Z'),
      },
    ]);
    mocks.prisma.policy.findMany.mockResolvedValue([
      {
        id: 'pol1',
        name: 'Политика 1',
        scope: 'role:r1',
        severity: 'blocking',
        lastConfirmedAt: new Date('2026-06-15T00:00:00Z'),
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      },
    ]);
    mocks.prisma.process.findMany.mockResolvedValue([
      {
        id: 'prc1',
        name: 'Процесс 1',
        scope: 'role:r1',
        lastConfirmedAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-03-01T00:00:00Z'),
      },
    ]);

    const result = await buildService(mocks).listRoleSnapshot({
      tenantId: 't1',
      roleId: 'r1',
    });

    expect(result).toHaveLength(4);
    expect(result.map((r) => r.id)).toEqual(['ins1', 'pol1', 'reg1', 'prc1']);
    const policy = result.find((r) => r.id === 'pol1');
    expect(policy).toMatchObject({ kind: 'policy', severity: 'blocking' });
    expect(result.find((r) => r.id === 'reg1')).toMatchObject({
      kind: 'regulation',
      severity: null,
    });
    expect(result.find((r) => r.id === 'ins1')).toMatchObject({
      kind: 'instruction',
      severity: null,
    });
    expect(result.find((r) => r.id === 'prc1')).toMatchObject({
      kind: 'process',
      severity: null,
    });
    for (const m of [
      mocks.prisma.regulation.findMany,
      mocks.prisma.instruction.findMany,
      mocks.prisma.policy.findMany,
      mocks.prisma.process.findMany,
    ]) {
      expect(m).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            scope: 'role:r1',
            status: 'active',
            deletedAt: null,
          }),
          take: 20,
        }),
      );
    }
  });

  it('обрезает до maxItems', async () => {
    mocks.cfg.getDynamic.mockImplementation(
      async (key: string, _env: unknown, def: unknown) =>
        key === 'clone.regulations.snapshot.max_items' ? 2 : def,
    );
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `reg${i}`,
      name: `Регламент ${i}`,
      scope: 'role:r1',
      lastConfirmedAt: new Date(2026, 5, i + 1),
      updatedAt: new Date(2026, 0, 1),
    }));
    mocks.prisma.regulation.findMany.mockResolvedValue(rows);

    const result = await buildService(mocks).listRoleSnapshot({
      tenantId: 't1',
      roleId: 'r1',
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['reg4', 'reg3']);
  });

  it('упавшая одна таблица (policy reject) не валит остальные', async () => {
    mocks.prisma.policy.findMany.mockRejectedValue(new Error('policy table down'));
    mocks.prisma.regulation.findMany.mockResolvedValue([
      {
        id: 'reg1',
        name: 'Регламент 1',
        scope: 'role:r1',
        lastConfirmedAt: new Date('2026-06-10T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mocks.prisma.instruction.findMany.mockResolvedValue([
      {
        id: 'ins1',
        name: 'Инструкция 1',
        scope: 'role:r1',
        lastConfirmedAt: new Date('2026-06-12T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await buildService(mocks).listRoleSnapshot({
      tenantId: 't1',
      roleId: 'r1',
    });

    expect(result.map((r) => r.id).sort()).toEqual(['ins1', 'reg1']);
    expect(result.some((r) => r.kind === 'policy')).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleRegulationRetrievalService } from './role-regulation-retrieval.service';

const DIM = 1536;
const validVec = () => Array(DIM).fill(0.1) as number[];

interface Mocks {
  prisma: { $queryRawUnsafe: ReturnType<typeof vi.fn> };
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
    return def;
  });
  return {
    prisma: { $queryRawUnsafe: vi.fn() },
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
});

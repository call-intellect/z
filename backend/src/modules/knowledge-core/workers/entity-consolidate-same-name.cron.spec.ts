import type { EntityType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { EntityConsolidateSameNameCronService } from './entity-consolidate-same-name.cron';

interface FakeEntity {
  id: string;
  tenantId: string;
  type: EntityType;
  canonicalName: string;
  mergedIntoId: string | null;
  mentionsCount: number;
}

type Verdict =
  | { verdict: 'merge'; canonicalId: string; canonicalType?: EntityType; explanation: string }
  | { verdict: 'distinct'; explanation: string };

function makeCron(args: {
  entities: FakeEntity[];
  groups: Array<{ lname: string; ids: string[] }>;
  enabled?: boolean;
  batchSize?: number;
  distinctPairs?: Set<string>;
  verdictFor?: (fromId: string, canonicalId: string) => Verdict;
  mergeSpy?: ReturnType<typeof vi.fn>;
  judgeSpy?: ReturnType<typeof vi.fn>;
  markDistinctSpy?: ReturnType<typeof vi.fn>;
}) {
  const byId = new Map(args.entities.map((e) => [e.id, { ...e }]));
  const distinctPairs = args.distinctPairs ?? new Set<string>();

  const queryRawUnsafe = vi.fn(async () => args.groups.slice(0, args.batchSize ?? 200));
  const entityFindFirst = vi.fn(async (q: { where: { id: string } }) => {
    const found = byId.get(q.where.id);
    return found ? { ...found } : null;
  });
  const ideaBlockEntityFindMany = vi.fn(async () => []);

  const fakePrisma = {
    org: { findMany: async () => [{ id: 'org_1' }] },
    entity: { findFirst: entityFindFirst },
    ideaBlockEntity: { findMany: ideaBlockEntityFindMany },
    $queryRawUnsafe: queryRawUnsafe,
  } as unknown as ConstructorParameters<typeof EntityConsolidateSameNameCronService>[0];

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'knowledge.entityConsolidateSameNameEnabled') return args.enabled ?? true;
    if (key === 'knowledge.entityConsolidateSameNameBatchSize') return args.batchSize ?? 200;
    return def;
  });
  const fakeCfg = {
    getDynamic,
  } as unknown as ConstructorParameters<typeof EntityConsolidateSameNameCronService>[1];

  const judgeSpy =
    args.judgeSpy ??
    vi.fn(async (a: { entity: FakeEntity; candidate: FakeEntity }): Promise<Verdict> => {
      if (args.verdictFor) return args.verdictFor(a.entity.id, a.candidate.id);
      return { verdict: 'merge', canonicalId: a.candidate.id, explanation: 'same' };
    });
  const mergeSpy =
    args.mergeSpy ??
    vi.fn(async (a: { fromEntityId: string; intoEntityId: string; canonicalType?: EntityType }) => {
      const from = byId.get(a.fromEntityId);
      if (from) from.mergedIntoId = a.intoEntityId;
      const into = byId.get(a.intoEntityId);
      if (into && a.canonicalType) into.type = a.canonicalType;
      return { ok: true as const };
    });
  const fakeMerger = {
    judgeMerge: judgeSpy,
    mergeEntities: mergeSpy,
  } as unknown as ConstructorParameters<typeof EntityConsolidateSameNameCronService>[2];

  const markDistinctSpy = args.markDistinctSpy ?? vi.fn(async () => undefined);
  const isDistinctSpy = vi.fn(async (idA: string, idB: string) => {
    return distinctPairs.has(`${idA}:${idB}`) || distinctPairs.has(`${idB}:${idA}`);
  });
  const fakeResolution = {
    isEntityPairDistinct: isDistinctSpy,
    markEntityPairDistinct: markDistinctSpy,
  } as unknown as ConstructorParameters<typeof EntityConsolidateSameNameCronService>[3];

  const checkOrThrow = vi.fn(async () => undefined);
  const fakeGate = {
    checkOrThrow,
  } as unknown as ConstructorParameters<typeof EntityConsolidateSameNameCronService>[4];

  return {
    cron: new EntityConsolidateSameNameCronService(
      fakePrisma,
      fakeCfg,
      fakeMerger,
      fakeResolution,
      fakeGate,
    ),
    judgeSpy,
    mergeSpy,
    markDistinctSpy,
    isDistinctSpy,
    queryRawUnsafe,
    byId,
  };
}

function ent(
  id: string,
  type: EntityType,
  name: string,
  mentions = 1,
): FakeEntity {
  return {
    id,
    tenantId: 'org_1',
    type,
    canonicalName: name,
    mergedIntoId: null,
    mentionsCount: mentions,
  };
}

describe('EntityConsolidateSameNameCronService', () => {
  it('одноимённые разных типов → merge с вычисленным canonicalType (domain > generic)', async () => {
    const canonical = ent('e_canon', 'topic', 'retention', 10);
    const from = ent('e_from', 'goal', 'retention', 3);
    const { cron, mergeSpy, judgeSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'retention', ids: ['e_canon', 'e_from'] }],
    });

    const summary = await cron.runForAllOrgs();

    expect(judgeSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromEntityId: 'e_from',
        intoEntityId: 'e_canon',
        canonicalType: 'goal',
      }),
    );
    expect(summary.merged).toBe(1);
  });

  it('disputed тип (generic vs generic не покрыт как domain) → берётся verdict.canonicalType', async () => {
    const canonical = ent('e_canon', 'vendor', 'Логистик Плюс', 8);
    const from = ent('e_from', 'customer', 'Логистик Плюс', 4);
    const { cron, mergeSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'логистик плюс', ids: ['e_canon', 'e_from'] }],
      verdictFor: () => ({
        verdict: 'merge',
        canonicalId: 'e_canon',
        canonicalType: 'customer',
        explanation: 'один клиент, он же поставщик',
      }),
    });

    await cron.runForAllOrgs();

    expect(mergeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromEntityId: 'e_from',
        intoEntityId: 'e_canon',
        canonicalType: 'customer',
      }),
    );
  });

  it('negative-cache: isEntityPairDistinct=true → judge/merge НЕ вызваны, пропуск', async () => {
    const canonical = ent('e_canon', 'product', 'Битрикс', 10);
    const from = ent('e_from', 'vendor', 'Битрикс', 5);
    const { cron, mergeSpy, judgeSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'битрикс', ids: ['e_canon', 'e_from'] }],
      distinctPairs: new Set(['e_from:e_canon']),
    });

    await cron.runForAllOrgs();

    expect(judgeSpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  it('kill-switch off → no-op, 0 merge', async () => {
    const canonical = ent('e_canon', 'product', 'Битрикс', 10);
    const from = ent('e_from', 'vendor', 'Битрикс', 5);
    const { cron, mergeSpy, judgeSpy, queryRawUnsafe } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'битрикс', ids: ['e_canon', 'e_from'] }],
      enabled: false,
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.merged).toBe(0);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(judgeSpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  it("verdict='distinct' → markEntityPairDistinct вызван, mergeEntities НЕ вызван", async () => {
    const canonical = ent('e_canon', 'project', 'Портал', 10);
    const from = ent('e_from', 'product', 'Портал', 5);
    const { cron, mergeSpy, markDistinctSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'портал', ids: ['e_canon', 'e_from'] }],
      verdictFor: () => ({ verdict: 'distinct', explanation: 'разные объекты' }),
    });

    const summary = await cron.runForAllOrgs();

    expect(markDistinctSpy).toHaveBeenCalledWith('e_from', 'e_canon');
    expect(mergeSpy).not.toHaveBeenCalled();
    expect(summary.distinct).toBe(1);
  });

  it('батч-лимит: групп больше batchSize → обработано ≤ batchSize', async () => {
    const entities: FakeEntity[] = [];
    const groups: Array<{ lname: string; ids: string[] }> = [];
    for (let i = 0; i < 5; i++) {
      const c = ent(`c${i}`, 'topic', `name${i}`, 10);
      const f = ent(`f${i}`, 'goal', `name${i}`, 2);
      entities.push(c, f);
      groups.push({ lname: `name${i}`, ids: [`c${i}`, `f${i}`] });
    }
    const { cron, mergeSpy } = makeCron({
      entities,
      groups,
      batchSize: 2,
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.groups).toBeLessThanOrEqual(2);
    expect(mergeSpy).toHaveBeenCalledTimes(summary.merged);
    expect(summary.merged).toBeLessThanOrEqual(2);
  });

  it('группа > MAX_MEMBERS_PER_GROUP → обработано ≤ cap за проход', async () => {
    const cap = 50;
    const members = cap + 20;
    const entities: FakeEntity[] = [];
    const ids: string[] = [];
    for (let i = 0; i < members; i++) {
      const isCanon = i === 0;
      const e = ent(`m${i}`, isCanon ? 'topic' : 'goal', 'дубль', isCanon ? 100 : 1);
      entities.push(e);
      ids.push(e.id);
    }
    const { cron, judgeSpy } = makeCron({
      entities,
      groups: [{ lname: 'дубль', ids }],
      verdictFor: () => ({ verdict: 'distinct', explanation: 'не сливаем в тесте' }),
    });

    await cron.runForAllOrgs();

    expect(judgeSpy.mock.calls.length).toBeLessThanOrEqual(cap - 1);
    expect(judgeSpy.mock.calls.length).toBe(cap - 1);
  });

  it("verdict='merge' с иным каноном → markEntityPairDistinct НЕ вызван, distinct не растёт", async () => {
    const canonical = ent('e_canon', 'topic', 'Спорный', 10);
    const from = ent('e_from', 'goal', 'Спорный', 5);
    const { cron, mergeSpy, markDistinctSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'спорный', ids: ['e_canon', 'e_from'] }],
      verdictFor: () => ({
        verdict: 'merge',
        canonicalId: 'e_from',
        explanation: 'LLM выбрал другой канон',
      }),
    });

    const summary = await cron.runForAllOrgs();

    expect(markDistinctSpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
    expect(summary.distinct).toBe(0);
    expect(summary.merged).toBe(0);
  });

  it('dry-run: считает группы, но НЕ зовёт judge/merge/markDistinct', async () => {
    const canonical = ent('e_canon', 'topic', 'retention', 10);
    const from = ent('e_from', 'goal', 'retention', 3);
    const { cron, judgeSpy, mergeSpy, markDistinctSpy } = makeCron({
      entities: [canonical, from],
      groups: [{ lname: 'retention', ids: ['e_canon', 'e_from'] }],
    });

    const summary = await cron.runForAllOrgs(true);

    expect(summary.groups).toBe(1);
    expect(summary.merged).toBe(0);
    expect(summary.distinct).toBe(0);
    expect(judgeSpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
    expect(markDistinctSpy).not.toHaveBeenCalled();
  });

  it('идемпотентность: пустой набор групп → 0 действий', async () => {
    const { cron, mergeSpy, judgeSpy } = makeCron({
      entities: [],
      groups: [],
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.groups).toBe(0);
    expect(summary.merged).toBe(0);
    expect(judgeSpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
  });
});

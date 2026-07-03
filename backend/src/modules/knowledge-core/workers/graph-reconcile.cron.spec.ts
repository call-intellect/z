import { describe, expect, it, vi } from 'vitest';

import { GraphReconcileCronService } from './graph-reconcile.cron';

interface ActiveLink {
  id: string;
  fromEntityId: string;
  fromType: string | null;
  toEntityId: string;
  toType: string | null;
  relationType: string;
  confidence: unknown;
  validFrom: Date | null;
  validTo: Date | null;
}

interface ArchivedLink {
  id: string;
  fromEntityId: string;
  fromType: string | null;
  toEntityId: string;
  toType: string | null;
  relationType: string;
}

function makeCron(args: {
  activeLinks?: ActiveLink[];
  archivedLinks?: ArchivedLink[];
  mergedAwayEntities?: Array<{ id: string }>;
  enabled?: boolean;
  batchSize?: number;
  mergeEdgeSpy?: ReturnType<typeof vi.fn>;
  deleteEdgeSpy?: ReturnType<typeof vi.fn>;
  deleteNodeSpy?: ReturnType<typeof vi.fn>;
}) {
  const activeLinks = args.activeLinks ?? [];
  const archivedLinks = args.archivedLinks ?? [];
  const mergedAwayEntities = args.mergedAwayEntities ?? [];

  const entityLinkFindMany = vi.fn(
    async (q: { where: { status: string }; cursor?: { id: string } }) => {
      if (q.where.status === 'active') {
        if (q.cursor) return [];
        return activeLinks;
      }
      return archivedLinks;
    },
  );
  const entityFindMany = vi.fn(async () => mergedAwayEntities);

  const fakePrisma = {
    org: { findMany: async () => [{ id: 'org_1' }] },
    entityLink: { findMany: entityLinkFindMany },
    entity: { findMany: entityFindMany },
  } as unknown as ConstructorParameters<typeof GraphReconcileCronService>[0];

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'knowledge.graphReconcileEnabled') return args.enabled ?? true;
    if (key === 'knowledge.graphReconcileBatchSize') return args.batchSize ?? 500;
    return def;
  });
  const fakeCfg = {
    getDynamic,
  } as unknown as ConstructorParameters<typeof GraphReconcileCronService>[1];

  const mergeEdgeSpy = args.mergeEdgeSpy ?? vi.fn(async () => undefined);
  const deleteEdgeSpy = args.deleteEdgeSpy ?? vi.fn(async () => undefined);
  const deleteNodeSpy = args.deleteNodeSpy ?? vi.fn(async () => undefined);
  const fakeGraph = {
    mergeEdgeGraphOnly: mergeEdgeSpy,
    deleteEdgeGraphOnly: deleteEdgeSpy,
    deleteNodeGraphOnly: deleteNodeSpy,
  } as unknown as ConstructorParameters<typeof GraphReconcileCronService>[2];

  const incGraphReconcileMerged = vi.fn();
  const incGraphReconcileDeleted = vi.fn();
  const fakeMetrics = {
    incGraphReconcileMerged,
    incGraphReconcileDeleted,
  } as unknown as ConstructorParameters<typeof GraphReconcileCronService>[3];

  return {
    cron: new GraphReconcileCronService(fakePrisma, fakeCfg, fakeGraph, fakeMetrics),
    mergeEdgeSpy,
    deleteEdgeSpy,
    deleteNodeSpy,
    entityLinkFindMany,
    entityFindMany,
    getDynamic,
    incGraphReconcileMerged,
    incGraphReconcileDeleted,
  };
}

function makeCounters() {
  return { mergedEdges: 0, deletedEdges: 0, deletedNodes: 0, skipped: 0 };
}

describe('GraphReconcileCronService', () => {
  it('идемпотентность: два прогона reconcileOrg → mergeEdgeGraphOnly с одинаковыми args, без дублей create', async () => {
    const activeLinks: ActiveLink[] = [
      {
        id: 'l1',
        fromEntityId: 'e1',
        fromType: 'entity',
        toEntityId: 'e2',
        toType: 'entity',
        relationType: 'reports_to',
        confidence: 0.8,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
      },
      {
        id: 'l2',
        fromEntityId: 'e3',
        fromType: null,
        toEntityId: 'e4',
        toType: null,
        relationType: 'works_with',
        confidence: null,
        validFrom: null,
        validTo: null,
      },
    ];
    const { cron, mergeEdgeSpy } = makeCron({ activeLinks });

    await cron.reconcileOrg('org_1', 500, makeCounters());
    const firstRunArgs = mergeEdgeSpy.mock.calls.map((c) => c[0]);

    mergeEdgeSpy.mockClear();
    await cron.reconcileOrg('org_1', 500, makeCounters());
    const secondRunArgs = mergeEdgeSpy.mock.calls.map((c) => c[0]);

    expect(firstRunArgs).toEqual(secondRunArgs);
    expect(mergeEdgeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org_1',
        from: { type: 'entity', id: 'e1' },
        to: { type: 'entity', id: 'e2' },
        linkType: 'reports_to',
      }),
    );
    expect(mergeEdgeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { type: 'entity', id: 'e3' },
        to: { type: 'entity', id: 'e4' },
        linkType: 'works_with',
      }),
    );
  });

  it('DETACH DELETE архивного ребра: deleteEdgeGraphOnly вызван с from/to/linkType', async () => {
    const archivedLinks: ArchivedLink[] = [
      {
        id: 'a1',
        fromEntityId: 'e1',
        fromType: 'entity',
        toEntityId: 'e2',
        toType: 'entity',
        relationType: 'reports_to',
      },
    ];
    const { cron, deleteEdgeSpy, incGraphReconcileDeleted } = makeCron({ archivedLinks });
    const counters = makeCounters();

    await cron.reconcileOrg('org_1', 500, counters);

    expect(counters.deletedEdges).toBe(1);
    expect(deleteEdgeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org_1',
        from: { type: 'entity', id: 'e1' },
        to: { type: 'entity', id: 'e2' },
        linkType: 'reports_to',
      }),
    );
    expect(incGraphReconcileDeleted).toHaveBeenCalledWith({ type: 'entityLink' });
  });

  it('merged-away узел: deleteNodeGraphOnly({type:entity, id}) вызван', async () => {
    const { cron, deleteNodeSpy, incGraphReconcileDeleted } = makeCron({
      mergedAwayEntities: [{ id: 'e9' }],
    });
    const counters = makeCounters();

    await cron.reconcileOrg('org_1', 500, counters);

    expect(counters.deletedNodes).toBe(1);
    expect(deleteNodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org_1', type: 'entity', id: 'e9' }),
    );
    expect(incGraphReconcileDeleted).toHaveBeenCalledWith({ type: 'entity' });
  });

  it('skip неизвестного типа: mergeEdgeGraphOnly бросает → skipped растёт, проход продолжается', async () => {
    const activeLinks: ActiveLink[] = [
      {
        id: 'l1',
        fromEntityId: 'e1',
        fromType: 'entity',
        toEntityId: 'e2',
        toType: 'entity',
        relationType: 'conflicted_with',
        confidence: 0.7,
        validFrom: null,
        validTo: null,
      },
      {
        id: 'l2',
        fromEntityId: 'e3',
        fromType: 'entity',
        toEntityId: 'e4',
        toType: 'entity',
        relationType: 'reports_to',
        confidence: 0.9,
        validFrom: null,
        validTo: null,
      },
    ];
    const mergeEdgeSpy = vi.fn(async (p: { linkType: string }) => {
      if (p.linkType === 'conflicted_with') throw new Error('unknown rel type');
    });
    const { cron } = makeCron({ activeLinks, mergeEdgeSpy });
    const counters = makeCounters();

    await cron.reconcileOrg('org_1', 500, counters);

    expect(counters.skipped).toBe(1);
    expect(counters.mergedEdges).toBe(1);
    expect(mergeEdgeSpy).toHaveBeenCalledTimes(2);
  });

  it('kill-switch OFF: ни один graph-метод не вызван', async () => {
    const { cron, mergeEdgeSpy, deleteEdgeSpy, deleteNodeSpy, entityLinkFindMany } = makeCron({
      enabled: false,
      activeLinks: [
        {
          id: 'l1',
          fromEntityId: 'e1',
          fromType: 'entity',
          toEntityId: 'e2',
          toType: 'entity',
          relationType: 'reports_to',
          confidence: 0.8,
          validFrom: null,
          validTo: null,
        },
      ],
    });

    const res = await cron.runForAllOrgs();

    expect(res.mergedEdges).toBe(0);
    expect(res.deletedEdges).toBe(0);
    expect(res.deletedNodes).toBe(0);
    expect(mergeEdgeSpy).not.toHaveBeenCalled();
    expect(deleteEdgeSpy).not.toHaveBeenCalled();
    expect(deleteNodeSpy).not.toHaveBeenCalled();
    expect(entityLinkFindMany).not.toHaveBeenCalled();
  });
});

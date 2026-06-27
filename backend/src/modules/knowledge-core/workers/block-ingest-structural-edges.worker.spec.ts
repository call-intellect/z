import { describe, expect, it, vi } from 'vitest';

import { BlockIngestWorker } from './block-ingest.worker';

describe('BlockIngestWorker.createStructuralEntityEdges — детерминированные shares_entity', () => {
  function buildWorker(opts: {
    entitiesByBlock?: Record<string, string[]>;
    otherBlocksByEntity?: Record<string, string[]>;
  }) {
    const upsert = vi.fn(async (_args: Record<string, unknown>) => undefined);
    const prisma = {
      ideaBlockEntity: {
        findMany: vi.fn(async (args: { where: Record<string, unknown>; distinct?: unknown }) => {
          const where = args.where as {
            blockId?: string;
            entityId?: { in: string[] };
          };
          if (typeof where.blockId === 'string') {
            const ents = opts.entitiesByBlock?.[where.blockId] ?? [];
            return ents.map((entityId) => ({ entityId }));
          }
          const entityIds = where.entityId?.in ?? [];
          const seen = new Set<string>();
          for (const eid of entityIds) {
            for (const bid of opts.otherBlocksByEntity?.[eid] ?? []) {
              seen.add(bid);
            }
          }
          return [...seen].map((blockId) => ({ blockId }));
        }),
      },
      ideaBlockLink: { upsert },
    };
    const cfg = {
      getDynamic: vi.fn(async (_key: string, _env?: unknown, def?: unknown) => def),
    };
    const worker = Object.create(BlockIngestWorker.prototype) as BlockIngestWorker;
    Object.assign(worker, { prisma, cfg });
    return { worker, upsert, cfg };
  }

  it('создаёт shares_entity (createdBy=system) на другой блок с общей сущностью', async () => {
    const { worker, upsert } = buildWorker({
      entitiesByBlock: { b1: ['e1'] },
      otherBlocksByEntity: { e1: ['b2'] },
    });
    await (worker as any).createStructuralEntityEdges('t-1', ['b1']);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0] as unknown as {
      where: { fromBlockId_toBlockId_relationType_tenantId: Record<string, unknown> };
      create: Record<string, unknown>;
    };
    expect(call.where.fromBlockId_toBlockId_relationType_tenantId).toMatchObject({
      fromBlockId: 'b1',
      toBlockId: 'b2',
      relationType: 'shares_entity',
    });
    expect(call.create).toMatchObject({
      tenantId: 't-1',
      fromBlockId: 'b1',
      toBlockId: 'b2',
      relationType: 'shares_entity',
      createdBy: 'system',
      status: 'active',
    });
  });

  it('НЕ создаёт self-link (блок с самим собой)', async () => {
    const { worker, upsert } = buildWorker({
      entitiesByBlock: { b1: ['e1'] },
      otherBlocksByEntity: { e1: ['b1'] },
    });
    await (worker as any).createStructuralEntityEdges('t-1', ['b1']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('блок без сущностей — ничего не создаёт', async () => {
    const { worker, upsert } = buildWorker({
      entitiesByBlock: { b1: [] },
    });
    await (worker as any).createStructuralEntityEdges('t-1', ['b1']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('пустой список blockIds — no-op', async () => {
    const { worker, upsert } = buildWorker({});
    await (worker as any).createStructuralEntityEdges('t-1', []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('читает cap через getDynamic с дефолтом 10', async () => {
    const { worker, cfg } = buildWorker({
      entitiesByBlock: { b1: ['e1'] },
      otherBlocksByEntity: { e1: ['b2'] },
    });
    await (worker as any).createStructuralEntityEdges('t-1', ['b1']);
    expect(cfg.getDynamic).toHaveBeenCalledWith(
      'knowledge.structural_shares_entity_topk',
      undefined,
      10,
    );
  });
});

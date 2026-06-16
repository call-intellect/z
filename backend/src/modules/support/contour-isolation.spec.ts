import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChatV2RetrievalService } from '../knowledge-core/services/chat-v2-retrieval.service';

describe('ChatV2RetrievalService — R-INV-1 контур поддержки (pre-filter)', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn() },
    };
    embeddingsStub = { embedQuery: vi.fn().mockRejectedValue(new Error('no')) };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  function poolWhere(): Record<string, unknown> {
    const call = prismaStub.ideaBlock.findMany.mock.calls[0] as
      | [{ where: Record<string, unknown> }]
      | undefined;
    return call?.[0]?.where ?? {};
  }

  it('A — фильтр контура присутствует В pool-запросе (pre-filter, не post)', async () => {
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b1', updatedAt: new Date('2025-01-01') }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      accessWhere: undefined,
      contourGroupId: 'grp-support',
    });

    expect(poolWhere()).toMatchObject({
      blockAccess: { some: { groupId: 'grp-support' } },
    });
    expect(result.map((r) => r.blockId)).toEqual(['b1']);
  });

  it('B1 — фильтр контура есть даже при accessWhere=undefined (enforcement off)', async () => {
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b1', updatedAt: new Date('2025-01-01') }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      accessWhere: undefined,
      contourGroupId: 'grp-support',
    });

    const where = poolWhere();
    expect(where.blockAccess).toEqual({ some: { groupId: 'grp-support' } });
  });

  it('B2 — при непустом accessWhere оба ключа сосуществуют (нет коллизии)', async () => {
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b1', updatedAt: new Date('2025-01-01') }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const accessWhere = { AND: [{ OR: [{ blockAccess: { none: {} } }] }] };
    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      accessWhere,
      contourGroupId: 'grp-support',
    });

    const where = poolWhere();
    expect(where.AND).toEqual(accessWhere.AND);
    expect(where.blockAccess).toEqual({ some: { groupId: 'grp-support' } });
  });

  it('C — без contourGroupId ключа blockAccess нет (регресс byte-identical)', async () => {
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }])
      .mockResolvedValueOnce([
        { id: 'b1', updatedAt: new Date('2025-01-01') },
        { id: 'b2', updatedAt: new Date('2025-01-01') },
      ]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
    });

    const where = poolWhere();
    expect(where).not.toHaveProperty('blockAccess');
  });
});

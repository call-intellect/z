import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — адаптивный 2-й block-link hop', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn() },
      $queryRawUnsafe: vi.fn(),
    };
    embeddingsStub = { embedQuery: vi.fn() };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  it('graphHops=2 + непустой 1-й hop → expandViaGraph вызван ДВАЖДЫ', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(768).fill(0.01));
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    const spy = vi
      .spyOn(svc as any, 'expandViaGraph')
      .mockResolvedValue([{ blockId: 'n1', score: -1, fromGraph: true }]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'кто отвечает за то, что блокирует',
      limit: 10,
      graphHops: 2,
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('graphHops=1 → expandViaGraph вызван ОДИН раз', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(768).fill(0.01));
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    const spy = vi
      .spyOn(svc as any, 'expandViaGraph')
      .mockResolvedValue([{ blockId: 'n1', score: -1, fromGraph: true }]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'кто отвечает за то, что блокирует',
      limit: 10,
      graphHops: 1,
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('graphHops=2, но 1-й hop пуст → expandViaGraph вызван ОДИН раз', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(768).fill(0.01));
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    const spy = vi
      .spyOn(svc as any, 'expandViaGraph')
      .mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'кто отвечает за то, что блокирует',
      limit: 10,
      graphHops: 2,
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

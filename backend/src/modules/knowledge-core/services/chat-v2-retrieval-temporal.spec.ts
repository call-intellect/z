import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

/**
 * SBA α-5 dialog-layer — unit-тест temporal validAt в ChatV2RetrievalService.
 *
 * Покрывает DoD §15: «Temporal query тест: `validAt = 2025-01-01` для
 * evolving card возвращает версию валидную на эту дату».
 *
 * Тест проверяет:
 *  1. validAt не задан → блоки не фильтруются по createdAt.
 *  2. validAt задан → блоки с createdAt > validAt отсекаются.
 */
describe('ChatV2RetrievalService — temporal validAt', () => {
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

  it('validAt задан — отфильтровывает блоки из «будущего»', async () => {
    const validAt = new Date('2025-01-01T00:00:00Z');
    // 1. pool: org scope — возвращает 3 блока (b1, b2, b3).
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }])
      // 2. filterByValidAt: только b1 — остальные созданы ПОСЛЕ validAt.
      .mockResolvedValueOnce([{ id: 'b1' }])
      // 3. rankByCosineOrRecency fallback: возвращает b1.
      .mockResolvedValueOnce([
        { id: 'b1', updatedAt: new Date('2024-12-15') },
      ]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      validAt,
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);

    // Проверим, что filterByValidAt был вызван с createdAt <= validAt.
    const filterCall = prismaStub.ideaBlock.findMany.mock.calls[1]?.[0];
    expect(filterCall?.where?.createdAt).toEqual({ lte: validAt });
  });

  it('validAt не задан — фильтр НЕ применяется (no createdAt clause в pool-фильтре)', async () => {
    // 1. pool: org scope.
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }])
      // 2. rankByCosineOrRecency fallback.
      .mockResolvedValueOnce([
        { id: 'b1', updatedAt: new Date() },
        { id: 'b2', updatedAt: new Date() },
      ]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      // validAt отсутствует
    });

    // Должны вернуться оба блока (нет фильтра).
    expect(result.length).toBe(2);
    // Только 2 вызова ideaBlock.findMany (pool + rank), без filterByValidAt.
    expect(prismaStub.ideaBlock.findMany).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

/**
 * Agents v2 Фаза A1 (2026-05-30) — unit-тест bi-temporal edges фильтра в
 * ChatV2RetrievalService.expandViaGraph под флагом BI_TEMPORAL_EDGES_ENABLED.
 *
 * Покрывает DoD §A1: «validAt=2026-08-15 находит link с validFrom=2026-06-01,
 * validUntil=2026-10-01; не находит с validUntil=2026-07-01».
 */
describe('ChatV2RetrievalService — bi-temporal edges filter (A1)', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: {
    knowledgeCore: { chatV2TopBlocks: number; biTemporalEdgesEnabled: boolean };
  };
  let metricsStub: { incTemporalFilterHit: ReturnType<typeof vi.fn> };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn() },
    };
    embeddingsStub = { embedQuery: vi.fn().mockRejectedValue(new Error('no')) };
    cfgStub = {
      knowledgeCore: { chatV2TopBlocks: 10, biTemporalEdgesEnabled: true },
    };
    metricsStub = { incTemporalFilterHit: vi.fn() };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
      metricsStub as unknown as never,
    );
  });

  it('BI_TEMPORAL_EDGES_ENABLED=true — добавляет AND-условие на validFrom/validUntil в findMany', async () => {
    const validAt = new Date('2026-08-15T00:00:00Z');
    // pool: один блок.
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'seed-block' }]) // collectPool / org
      // filterByValidAt — все блоки прошли.
      .mockResolvedValueOnce([{ id: 'seed-block' }])
      // rankByCosineOrRecency fallback.
      .mockResolvedValueOnce([{ id: 'seed-block', updatedAt: new Date('2026-07-01') }]);
    // expandViaGraph: link от seed-block к target1; target1 — canonical.
    prismaStub.ideaBlockLink.findMany
      .mockResolvedValueOnce([
        { toBlockId: 'target-1', confidence: '0.9' },
      ])
      .mockResolvedValueOnce([]);
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'target-1' }]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 1,
      validAt,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.blockId === 'target-1' && r.fromGraph)).toBe(true);

    // Проверяем что в where для ideaBlockLink.findMany попал AND-блок
    // c validFrom/validUntil фильтром.
    const linksFromCall = prismaStub.ideaBlockLink.findMany.mock.calls[0]?.[0];
    expect(linksFromCall.where.AND).toBeDefined();
    const andClauses = linksFromCall.where.AND;
    // Первый OR — про validFrom.
    expect(andClauses[0].OR).toContainEqual({ validFrom: null });
    expect(andClauses[0].OR).toContainEqual({ validFrom: { lte: validAt } });
    // Второй OR — про validUntil.
    expect(andClauses[1].OR).toContainEqual({ validUntil: null });
    expect(andClauses[1].OR).toContainEqual({ validUntil: { gt: validAt } });

    // Метрика passed — была дёрнута (для возвращённых links).
    expect(metricsStub.incTemporalFilterHit).toHaveBeenCalledWith({
      result: 'passed',
    });
  });

  it('BI_TEMPORAL_EDGES_ENABLED=false — фильтр НЕ применяется (backward-compat)', async () => {
    cfgStub.knowledgeCore.biTemporalEdgesEnabled = false;

    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'seed-block' }])
      .mockResolvedValueOnce([{ id: 'seed-block', updatedAt: new Date() }]);
    prismaStub.ideaBlockLink.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 1,
      // validAt не задан — backward-compat сценарий
    });

    // В where для ideaBlockLink.findMany нет AND-блока с validFrom/validUntil.
    const linksFromCall = prismaStub.ideaBlockLink.findMany.mock.calls[0]?.[0];
    expect(linksFromCall.where.AND).toBeUndefined();

    // Метрика passed не дёргается, когда флаг выключен.
    expect(metricsStub.incTemporalFilterHit).not.toHaveBeenCalled();
  });
});

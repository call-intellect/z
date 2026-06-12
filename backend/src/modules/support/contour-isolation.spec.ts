import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChatV2RetrievalService } from '../knowledge-core/services/chat-v2-retrieval.service';

/**
 * R-INV-1 (support-desk Ф2, ТЗ 2026-06-09) — закрытый контур поддержки
 * изолируется ПОЗИТИВНЫМ pre-retrieval фильтром: блоки вне группы контура НЕ
 * попадают в пул ещё ДО ранжирования. Фильтр БЕЗУСЛОВНЫЙ — не зависит от
 * `accessWhere`/`KNOWLEDGE_ACCESS_ENFORCEMENT`.
 *
 * Этот тест — обязательный негатив-CI: доказывает, что
 *   1. `blockAccess.some.groupId` присутствует в `where` пул-запроса
 *      `ideaBlock.findMany` (pre-filter, НЕ post-фильтрация результата);
 *   2. фильтр есть и при `accessWhere=undefined` (enforcement off);
 *   3. при непустом accessWhere оба ключа сосуществуют (нет коллизии);
 *   4. без `contourGroupId` ключа `blockAccess` нет (регресс byte-identical).
 *
 * Мок по образцу `chat-v2-retrieval-temporal.spec.ts`: embedQuery rejects →
 * recency-path; `ideaBlock.findMany` отдаёт support-блок.
 */
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
    // embedQuery падает → ранжирование уходит в recency-fallback (без $queryRaw).
    embeddingsStub = { embedQuery: vi.fn().mockRejectedValue(new Error('no')) };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  /** Извлечь `where` первого вызова pool-запроса `ideaBlock.findMany`. */
  function poolWhere(): Record<string, unknown> {
    const call = prismaStub.ideaBlock.findMany.mock.calls[0] as
      | [{ where: Record<string, unknown> }]
      | undefined;
    return call?.[0]?.where ?? {};
  }

  it('A — фильтр контура присутствует В pool-запросе (pre-filter, не post)', async () => {
    prismaStub.ideaBlock.findMany
      // 1) pool (org scope) — отдаём ТОЛЬКО support-блок.
      .mockResolvedValueOnce([{ id: 'b1' }])
      // 2) recency-fallback ранжирование.
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

    // Фильтр контура — В where пул-запроса (доказывает pre-retrieval).
    expect(poolWhere()).toMatchObject({
      blockAccess: { some: { groupId: 'grp-support' } },
    });
    // Только support-блок дошёл до результата.
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
    // accessWhere-ключ (AND) И contour-ключ (blockAccess) — оба на месте.
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
      // contourGroupId отсутствует
    });

    const where = poolWhere();
    expect(where).not.toHaveProperty('blockAccess');
  });
});

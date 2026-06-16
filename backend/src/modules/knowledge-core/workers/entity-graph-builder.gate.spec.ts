import { describe, expect, it, vi } from 'vitest';

import { EntityGraphBuilderCron } from './entity-graph-builder.cron';

/**
 * Б17 [K2] — EntityGraphBuilderCron уважает Org-Admin тумблер воркера через
 * WorkerOrgGate. При выключенном тумблере Org пропускается: ни LLM, ни даже
 * выборка co-mentioned пар не вызываются (граф не строится, бюджет LLM не жжётся).
 */
function buildCron() {
  const prisma = {
    org: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const cfg = {
    knowledgeCore: {
      entityGraphMinComentions: 2,
      linkMinConfidence: 0.6,
    },
  };
  const graph = {
    findCoMentionedPairs: vi.fn().mockResolvedValue([]),
    findRecentSharedBlocks: vi.fn().mockResolvedValue([]),
    judgeRelation: vi
      .fn()
      .mockResolvedValue({ relationType: null, confidence: 0, explanation: '' }),
  };
  const entityLinks = { upsertRichEdge: vi.fn().mockResolvedValue(undefined) };
  const gate = { checkOrThrow: vi.fn().mockResolvedValue(undefined) };
  const cron = new EntityGraphBuilderCron(
    prisma as never,
    cfg as never,
    graph as never,
    entityLinks as never,
    gate as never,
  );
  return { cron, prisma, graph, entityLinks, gate };
}

describe('EntityGraphBuilderCron — WorkerOrgGate (Б17 [K2])', () => {
  it('gate disabled (checkOrThrow кидает) → Org пропущен, LLM/выборка не вызваны', async () => {
    const { cron, prisma, graph, entityLinks, gate } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    gate.checkOrThrow.mockRejectedValue(new Error('disabled'));

    const summary = await cron.scanAllOrgs();

    // Org не засчитана, связи не строились.
    expect(summary.scannedOrgs).toBe(0);
    expect(summary.upsertedLinks).toBe(0);
    expect(gate.checkOrThrow).toHaveBeenCalledWith(
      'org-1',
      'entity-graph-builder',
    );
    expect(graph.findCoMentionedPairs).not.toHaveBeenCalled();
    expect(graph.judgeRelation).not.toHaveBeenCalled();
    expect(entityLinks.upsertRichEdge).not.toHaveBeenCalled();
  });

  it('gate enabled → Org сканируется (findCoMentionedPairs вызван)', async () => {
    const { cron, prisma, graph } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);

    const summary = await cron.scanAllOrgs();

    expect(summary.scannedOrgs).toBe(1);
    expect(graph.findCoMentionedPairs).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
    );
  });
});

/**
 * KC-Temporal W3.2 (2026-05-25) — unit-тесты ReasoningChainService.buildChain.
 *
 * Покрытие:
 *   1. simple chain (depth=1) — seed + 2 соседа через `consequences_of` и
 *      `causes`.
 *   2. deep chain (depth=3) — узлы трёх уровней; проверяем, что depth=N
 *      ограничивает обход (4-й уровень не подгружается).
 *   3. cycle prevention — кольцевая структура A→B→C→A не приводит к
 *      бесконечному циклу или дублям узлов.
 *
 * Зависимость PrismaService мокается. BFS читает ideaBlock.findUnique для
 * seed и ideaBlockLink.findMany + ideaBlock.findMany для уровней.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ReasoningChainService } from './reasoning-chain.service';


interface BlockRow {
  id: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tenantId: string;
  status: string;
}

interface LinkRow {
  fromBlockId: string;
  toBlockId: string;
  relationType: string;
  confidence: number;
}

function makeMocks(args: {
  blocks: ReadonlyArray<BlockRow>;
  links: ReadonlyArray<LinkRow>;
}) {
  const blocksMap = new Map(args.blocks.map((b) => [b.id, b]));

  const ideaBlockFindUnique = vi.fn(async (q: { where: { id: string } }) => {
    return blocksMap.get(q.where.id) ?? null;
  });

  const ideaBlockFindMany = vi.fn(
    async (q: { where: { id?: { in: string[] }; tenantId: string; status: string } }) => {
      const ids = q.where.id?.in ?? [];
      return ids
        .map((id) => blocksMap.get(id))
        .filter(
          (b): b is BlockRow =>
            !!b &&
            b.tenantId === q.where.tenantId &&
            b.status === q.where.status,
        );
    },
  );

  const ideaBlockLinkFindMany = vi.fn(
    async (q: {
      where: {
        tenantId: string;
        status: string;
        relationType: { in: string[] };
        OR: Array<{ fromBlockId?: { in: string[] }; toBlockId?: { in: string[] } }>;
      };
    }) => {
      const allowed = new Set(q.where.relationType.in);
      const fromIds = new Set<string>();
      const toIds = new Set<string>();
      for (const o of q.where.OR) {
        for (const id of o.fromBlockId?.in ?? []) fromIds.add(id);
        for (const id of o.toBlockId?.in ?? []) toIds.add(id);
      }
      return args.links.filter(
        (l) =>
          allowed.has(l.relationType) &&
          (fromIds.has(l.fromBlockId) || toIds.has(l.toBlockId)),
      );
    },
  );

  const prisma = {
    ideaBlock: {
      findUnique: ideaBlockFindUnique,
      findMany: ideaBlockFindMany,
    },
    ideaBlockLink: { findMany: ideaBlockLinkFindMany },
  } as unknown as PrismaService;

  return { prisma, ideaBlockFindMany, ideaBlockLinkFindMany };
}

function makeBlock(id: string): BlockRow {
  return {
    id,
    name: `block-${id}`,
    signalType: 'reasoning',
    criticalQuestion: `Q ${id}?`,
    trustedAnswer: `A ${id}.`,
    tenantId: 'org-1',
    status: 'canonical',
  };
}

describe('ReasoningChainService.buildChain', () => {
  let svc: ReasoningChainService;

  beforeEach(() => {
    // svc создаётся в каждом тесте после makeMocks.
  });

  it('depth=1: возвращает seed + прямых соседей по reasoning-link типам', async () => {
    const m = makeMocks({
      blocks: ['A', 'B', 'C'].map(makeBlock),
      links: [
        { fromBlockId: 'A', toBlockId: 'B', relationType: 'consequences_of', confidence: 0.9 },
        { fromBlockId: 'C', toBlockId: 'A', relationType: 'causes', confidence: 0.8 },
        // Не reasoning-link — НЕ должен попасть в chain.
        { fromBlockId: 'A', toBlockId: 'C', relationType: 'shares_topic', confidence: 1.0 },
      ],
    });
    svc = new ReasoningChainService(m.prisma);

    const chain = await svc.buildChain('A', 1);
    const ids = chain.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
    // depth=0 — seed, depth=1 — соседи.
    const seed = chain.nodes.find((n) => n.id === 'A');
    expect(seed?.depth).toBe(0);
    const others = chain.nodes.filter((n) => n.id !== 'A');
    for (const o of others) expect(o.depth).toBe(1);
    // Ровно 2 ребра (shares_topic отфильтрован).
    expect(chain.edges).toHaveLength(2);
    for (const e of chain.edges) {
      expect(['consequences_of', 'causes']).toContain(e.relationType);
    }
  });

  it('depth=3: подгружает три уровня; depth>3 кламп до 3 (4-й уровень НЕ попадает)', async () => {
    // Линейная цепочка A → B → C → D → E
    const m = makeMocks({
      blocks: ['A', 'B', 'C', 'D', 'E'].map(makeBlock),
      links: [
        { fromBlockId: 'A', toBlockId: 'B', relationType: 'develops', confidence: 0.9 },
        { fromBlockId: 'B', toBlockId: 'C', relationType: 'develops', confidence: 0.9 },
        { fromBlockId: 'C', toBlockId: 'D', relationType: 'develops', confidence: 0.9 },
        { fromBlockId: 'D', toBlockId: 'E', relationType: 'develops', confidence: 0.9 },
      ],
    });
    svc = new ReasoningChainService(m.prisma);

    // maxDepth=10 → clamp to 3.
    const chain = await svc.buildChain('A', 10);
    const ids = chain.nodes.map((n) => n.id).sort();
    // 3 уровня от A: B (depth 1), C (depth 2), D (depth 3). E (depth 4) НЕ должен попасть.
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
    expect(chain.edges).toHaveLength(3);
  });

  it('cycle prevention: A→B→C→A не приводит к дублям', async () => {
    const m = makeMocks({
      blocks: ['A', 'B', 'C'].map(makeBlock),
      links: [
        { fromBlockId: 'A', toBlockId: 'B', relationType: 'causes', confidence: 0.9 },
        { fromBlockId: 'B', toBlockId: 'C', relationType: 'causes', confidence: 0.9 },
        // Цикл обратно: C → A.
        { fromBlockId: 'C', toBlockId: 'A', relationType: 'causes', confidence: 0.9 },
      ],
    });
    svc = new ReasoningChainService(m.prisma);

    const chain = await svc.buildChain('A', 3);
    // Ровно 3 уникальных узла.
    expect(chain.nodes).toHaveLength(3);
    const ids = chain.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

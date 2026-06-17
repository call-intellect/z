/**
 * Волна 5 (LOW) — unit-тесты Specialist34CardHandler.getCardsForQuery.
 *
 * Покрытие:
 *   - Б41 [K3]: оба card.findMany вызываются с детерминированным orderBy
 *     ([confidence desc, lastConfirmedAt desc, id asc]) при take — иначе
 *     chat-v2 получал недетерминированный набор карточек.
 *   - Б43 [K2]: ideaBlockEntity.findMany фильтруется по block.tenantId —
 *     tenant-инвариант (у IdeaBlockEntity нет своего tenantId).
 *
 * Postgres не требуется — Prisma полностью замокан.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CardSpecialistRegistry } from '../../chat-v2/services/card-specialist-registry.service';

import { Specialist34CardHandler } from './specialist-3-4-card-handler.service';

function makeMocks() {
  const cardFindMany = vi.fn(async () => [] as unknown[]);
  const ideaBlockEntityFindMany = vi.fn(async () => [] as unknown[]);
  const prisma = {
    card: { findMany: cardFindMany },
    ideaBlockEntity: { findMany: ideaBlockEntityFindMany },
  } as unknown as PrismaService;

  const registry = {
    register: vi.fn(),
  } as unknown as CardSpecialistRegistry;

  return {
    prisma,
    registry,
    spies: { cardFindMany, ideaBlockEntityFindMany },
  };
}

const EXPECTED_ORDER_BY = [
  { confidence: 'desc' },
  { lastConfirmedAt: 'desc' },
  { id: 'asc' },
];

describe('Specialist34CardHandler.getCardsForQuery (Волна 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Б41: первый card.findMany (по sourceBlockIds) вызван с детерминированным orderBy', async () => {
    const m = makeMocks();
    const svc = new Specialist34CardHandler(m.prisma, m.registry);

    await svc.getCardsForQuery({
      tenantId: 'org-1',
      query: 'клиент',
      candidateBlockIds: ['b1', 'b2'],
      limit: 5,
    });

    expect(m.spies.cardFindMany).toHaveBeenCalled();
    const firstCall = (m.spies.cardFindMany.mock.calls as unknown[][])[0]?.[0] as {
      orderBy?: unknown;
    };
    expect(firstCall.orderBy).toEqual(EXPECTED_ORDER_BY);
  });

  it('Б41: второй card.findMany (по entityId) тоже вызван с тем же orderBy', async () => {
    const m = makeMocks();
    // Вернём упоминание сущности, чтобы сработала ветка candidatesByEntity.
    m.spies.ideaBlockEntityFindMany.mockResolvedValueOnce([
      { entityId: 'e1' },
    ]);
    const svc = new Specialist34CardHandler(m.prisma, m.registry);

    await svc.getCardsForQuery({
      tenantId: 'org-1',
      query: 'клиент',
      candidateBlockIds: ['b1'],
      limit: 5,
    });

    expect(m.spies.cardFindMany).toHaveBeenCalledTimes(2);
    const secondCall = (m.spies.cardFindMany.mock.calls as unknown[][])[1]?.[0] as {
      orderBy?: unknown;
    };
    expect(secondCall.orderBy).toEqual(EXPECTED_ORDER_BY);
  });

  it('Б43: ideaBlockEntity.findMany фильтруется по block.tenantId', async () => {
    const m = makeMocks();
    const svc = new Specialist34CardHandler(m.prisma, m.registry);

    await svc.getCardsForQuery({
      tenantId: 'org-42',
      query: 'клиент',
      candidateBlockIds: ['b1', 'b2'],
      limit: 5,
    });

    expect(m.spies.ideaBlockEntityFindMany).toHaveBeenCalledTimes(1);
    const callArgs = (m.spies.ideaBlockEntityFindMany.mock.calls as unknown[][])[0]?.[0] as {
      where?: { block?: { tenantId?: string } };
    };
    expect(callArgs.where?.block).toEqual({ tenantId: 'org-42' });
  });

  it('пустой candidateBlockIds → раннее возвращение [] без запросов', async () => {
    const m = makeMocks();
    const svc = new Specialist34CardHandler(m.prisma, m.registry);

    const r = await svc.getCardsForQuery({
      tenantId: 'org-1',
      query: 'q',
      candidateBlockIds: [],
      limit: 5,
    });

    expect(r).toEqual([]);
    expect(m.spies.cardFindMany).not.toHaveBeenCalled();
    expect(m.spies.ideaBlockEntityFindMany).not.toHaveBeenCalled();
  });
});

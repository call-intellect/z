/**
 * Волна 5 (LOW) — unit-тест Specialist34ProjectCustomerWorker.handle.
 *
 * Покрытие:
 *   - Б42 [K3]: card.findMany (поиск затронутых карточек) вызывается с
 *     детерминированным orderBy ([lastConfirmedAt asc, id asc]) при take:200,
 *     иначе часть карточек систематически не получала rollup.
 *
 * Postgres не требуется — Prisma/очередь/метрики замоканы.
 */
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { SpecialistRoutingJobData } from '../../core-queue/queues';

import { Specialist34ProjectCustomerWorker } from './specialist-3-4-project-customer.worker';

function makeMocks() {
  const ideaBlockFindUnique = vi.fn(async () => ({
    id: 'block-1',
    tenantId: 'org-1',
    status: 'canonical',
    signalType: 'fact',
  }));
  const ideaBlockEntityFindMany = vi.fn(async () => [{ entityId: 'e1' }]);
  const cardFindMany = vi.fn(async () => [{ id: 'card-1' }, { id: 'card-2' }]);

  const prisma = {
    ideaBlock: { findUnique: ideaBlockFindUnique },
    ideaBlockEntity: { findMany: ideaBlockEntityFindMany },
    card: { findMany: cardFindMany },
  } as unknown as PrismaService;

  const enqueueCardRollupV2 = vi.fn(async () => undefined);
  const coreQueue = {
    enqueueCardRollupV2,
  } as unknown as CoreQueueService;

  const metrics = {
    incCoreSpecialistSkipped: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
  } as unknown as BusinessMetricsService;

  return {
    prisma,
    coreQueue,
    metrics,
    spies: { ideaBlockFindUnique, ideaBlockEntityFindMany, cardFindMany, enqueueCardRollupV2 },
  };
}

function makeJob(): Job<SpecialistRoutingJobData> {
  return {
    data: { blockId: 'block-1', tenantId: 'org-1' },
  } as unknown as Job<SpecialistRoutingJobData>;
}

describe('Specialist34ProjectCustomerWorker.handle (Волна 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Б42: card.findMany вызван с детерминированным orderBy при take', async () => {
    const m = makeMocks();
    const worker = new Specialist34ProjectCustomerWorker(
      m.prisma,
      m.coreQueue,
      m.metrics,
    );

    await worker.handle(makeJob());

    expect(m.spies.cardFindMany).toHaveBeenCalledTimes(1);
    const callArgs = (m.spies.cardFindMany.mock.calls as unknown[][])[0]?.[0] as {
      orderBy?: unknown;
      take?: number;
    };
    expect(callArgs.orderBy).toEqual([
      { lastConfirmedAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(callArgs.take).toBe(200);
    // Каждая найденная карточка enqueue'ится на rollup.
    expect(m.spies.enqueueCardRollupV2).toHaveBeenCalledTimes(2);
  });
});

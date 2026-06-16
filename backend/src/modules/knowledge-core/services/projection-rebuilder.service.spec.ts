import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';

import { ProjectionRebuilderService } from './projection-rebuilder.service';

function makeMocks() {
  const decisionFindMany = vi.fn(async () => []);
  const insightFindMany = vi.fn(async () => []);
  const ideaFindMany = vi.fn(async () => []);
  const cardFindMany = vi.fn(async () => []);
  const regulationFindMany = vi.fn(async () => []);
  const processFindMany = vi.fn(async () => []);
  const policyFindMany = vi.fn(async () => []);
  const skillTraitFindMany = vi.fn(async () => []);
  const processTemplateFindMany = vi.fn(async () => []);
  const experimentFindMany = vi.fn(async () => []);
  const prisma = {
    decision: { findMany: decisionFindMany },
    insight: { findMany: insightFindMany },
    idea: { findMany: ideaFindMany },
    card: { findMany: cardFindMany },
    regulation: { findMany: regulationFindMany },
    process: { findMany: processFindMany },
    policy: { findMany: policyFindMany },
    skillTrait: { findMany: skillTraitFindMany },
    processTemplate: { findMany: processTemplateFindMany },
    experiment: { findMany: experimentFindMany },
  } as unknown as PrismaService;

  const enqueueSpecialistCustom = vi.fn(async (args: Record<string, unknown>) => ({
    jobId: String(args.jobId),
  }));
  const enqueueCardRollupV2 = vi.fn(
    async (_cardId: string, _opts?: Record<string, unknown>) => undefined,
  );
  const coreQueue = {
    enqueueSpecialistRoutingWithCustomJobId: enqueueSpecialistCustom,
    enqueueCardRollupV2,
  } as unknown as CoreQueueService;

  const metrics = {
    incKcProjectionRebuild: vi.fn(),
    observeKcProjectionRebuildLagMs: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    projectionRebuild: { debounceMs: 300_000 },
  } as unknown as TypedConfigService;

  return {
    prisma,
    coreQueue,
    metrics,
    cfg,
    fns: {
      decisionFindMany,
      insightFindMany,
      ideaFindMany,
      cardFindMany,
      regulationFindMany,
      processFindMany,
      policyFindMany,
      skillTraitFindMany,
      processTemplateFindMany,
      experimentFindMany,
      enqueueSpecialistCustom,
      enqueueCardRollupV2,
    },
  };
}

describe('ProjectionRebuilderService', () => {
  let svc: ProjectionRebuilderService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    svc = new ProjectionRebuilderService(mocks.prisma, mocks.coreQueue, mocks.cfg, mocks.metrics);
  });

  it('Один блок обновлён → две зависимые проекции (Decision + Insight) → два enqueue с правильными jobId', async () => {
    mocks.fns.decisionFindMany.mockResolvedValueOnce([{ id: 'dec-1' }] as never);
    mocks.fns.insightFindMany.mockResolvedValueOnce([{ id: 'ins-1' }] as never);

    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'updated',
      emittedAt: Date.now() - 5,
    });

    expect(mocks.fns.enqueueSpecialistCustom).toHaveBeenCalledTimes(2);

    const decisionCall = mocks.fns.enqueueSpecialistCustom.mock.calls.find(
      (c) => (c[0] as { jobId: string }).jobId === 'projection-rebuild_decision_dec-1',
    );
    expect(decisionCall).toBeDefined();
    expect(decisionCall?.[0]).toMatchObject({
      specialistName: '3-3-decisions',
      blockId: 'block-1',
      tenantId: 'tenant-1',
      signalType: 'projection_rebuild',
      jobId: 'projection-rebuild_decision_dec-1',
      delayMs: 300_000,
    });

    const insightCall = mocks.fns.enqueueSpecialistCustom.mock.calls.find(
      (c) => (c[0] as { jobId: string }).jobId === 'projection-rebuild_insight_ins-1',
    );
    expect(insightCall).toBeDefined();
    expect(insightCall?.[0]).toMatchObject({
      specialistName: '3-5-insights',
      blockId: 'block-1',
      jobId: 'projection-rebuild_insight_ins-1',
      delayMs: 300_000,
    });

    expect(mocks.metrics.incKcProjectionRebuild).toHaveBeenCalledWith({
      type: 'decision',
    });
    expect(mocks.metrics.incKcProjectionRebuild).toHaveBeenCalledWith({
      type: 'insight',
    });
    expect(mocks.metrics.observeKcProjectionRebuildLagMs).toHaveBeenCalledTimes(1);
  });

  it('Idempotency: повторный event на тот же блок → тот же jobId (BullMQ дедуплицирует, сервис стабильно строит jobId)', async () => {
    mocks.fns.decisionFindMany.mockResolvedValue([{ id: 'dec-1' }] as never);

    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'updated',
    });
    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'updated',
    });

    expect(mocks.fns.enqueueSpecialistCustom).toHaveBeenCalledTimes(2);
    const jobIds = mocks.fns.enqueueSpecialistCustom.mock.calls.map(
      (c) => (c[0] as { jobId: string }).jobId,
    );
    expect(jobIds[0]).toBe('projection-rebuild_decision_dec-1');
    expect(jobIds[1]).toBe('projection-rebuild_decision_dec-1');
  });

  it('Infinite-loop защита: changeKind=projection_rebuild_emitted_by_self → ничего не делается', async () => {
    mocks.fns.decisionFindMany.mockResolvedValue([{ id: 'dec-1' }] as never);
    mocks.fns.insightFindMany.mockResolvedValue([{ id: 'ins-1' }] as never);

    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'projection_rebuild_emitted_by_self',
    });

    expect(mocks.fns.decisionFindMany).not.toHaveBeenCalled();
    expect(mocks.fns.insightFindMany).not.toHaveBeenCalled();
    expect(mocks.fns.enqueueSpecialistCustom).not.toHaveBeenCalled();
    expect(mocks.fns.enqueueCardRollupV2).not.toHaveBeenCalled();
    expect(mocks.metrics.incKcProjectionRebuild).not.toHaveBeenCalled();
  });

  it('Card → enqueueCardRollupV2 с правильными reason/delayMs (отдельная очередь, не specialist-routing)', async () => {
    mocks.fns.cardFindMany.mockResolvedValueOnce([{ id: 'card-1' }, { id: 'card-2' }] as never);

    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'updated',
    });

    expect(mocks.fns.enqueueCardRollupV2).toHaveBeenCalledTimes(2);
    expect(mocks.fns.enqueueCardRollupV2).toHaveBeenNthCalledWith(1, 'card-1', {
      delayMs: 300_000,
      reason: 'projection-rebuild',
    });
    expect(mocks.fns.enqueueCardRollupV2).toHaveBeenNthCalledWith(2, 'card-2', {
      delayMs: 300_000,
      reason: 'projection-rebuild',
    });
    expect(mocks.fns.enqueueSpecialistCustom).not.toHaveBeenCalled();
    expect(mocks.metrics.incKcProjectionRebuild).toHaveBeenCalledWith({ type: 'card' });
  });

  it('Ф4 регресс-гард: skillTrait.findMany фильтрует через profile.tenantId, БЕЗ верхнеуровневого tenantId', async () => {
    await svc.onIdeaBlockUpdated({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      changeKind: 'updated',
    });

    expect(mocks.fns.skillTraitFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.fns.skillTraitFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          profile: { tenantId: 'tenant-1' },
          sourceBlockIds: { has: 'block-1' },
        }),
      }),
    );

    expect(mocks.fns.skillTraitFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ tenantId: expect.anything() }),
      }),
    );
  });

  it("Устойчивость класса: reject одного подзапроса (insight) не валит остальные — Decision всё равно enqueue'ится", async () => {
    mocks.fns.decisionFindMany.mockResolvedValueOnce([{ id: 'dec-1' }] as never);
    mocks.fns.insightFindMany.mockRejectedValueOnce(
      new Error('PrismaClientValidationError: insight broke'),
    );

    await expect(
      svc.onIdeaBlockUpdated({
        tenantId: 'tenant-1',
        blockId: 'block-1',
        changeKind: 'updated',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.fns.enqueueSpecialistCustom).toHaveBeenCalledTimes(1);
    expect(mocks.fns.enqueueSpecialistCustom).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'projection-rebuild_decision_dec-1',
        specialistName: '3-3-decisions',
      }),
    );
    expect(mocks.metrics.observeKcProjectionRebuildLagMs).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProbeService } from '../../probe/probe.service';

import { GoalsCheckpointProbeHandler } from './goals-checkpoint-probe.handler';

/**
 * Goals OKR v2 (Фаза 5) — unit-тесты GoalsCheckpointProbeHandler.
 *
 *   - newStatus='shipped' + Idea.goalId → probe.suggest вызван
 *     (reason='goal.kr_checkpoint_suggested', emittedByService='3-14-goals');
 *   - newStatus!='shipped' → НЕ вызван;
 *   - Idea.goalId=null → НЕ вызван;
 *   - goal не найден → НЕ вызван.
 *
 * Никогда НЕ авто-пишем KR — только предложение (probe).
 */

type Fn = ReturnType<typeof vi.fn>;

interface PrismaStub {
  idea: { findFirst: Fn };
  goal: { findFirst: Fn };
  membership: { findMany: Fn };
}

function makeHandler(prismaStub: PrismaStub): {
  handler: GoalsCheckpointProbeHandler;
  suggest: Fn;
  inc: Fn;
} {
  const suggest = vi.fn(async () => ({ ok: true, probeEventId: 'pe-1' }));
  const inc = vi.fn();
  const probe = { suggest } as unknown as ProbeService;
  const metrics = {
    incCoreSpecialistProbeEvent: inc,
  } as unknown as BusinessMetricsService;
  const handler = new GoalsCheckpointProbeHandler(
    prismaStub as unknown as PrismaService,
    metrics,
    probe,
  );
  return { handler, suggest, inc };
}

function baseEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: 't-1',
    ideaId: 'idea-1',
    oldStatus: 'in_progress',
    newStatus: 'shipped',
    reason: null,
    changedByUserId: 'u-1',
    ...over,
  } as {
    tenantId: string;
    ideaId: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    changedByUserId: string;
  };
}

describe('GoalsCheckpointProbeHandler', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = {
      idea: {
        findFirst: vi.fn(async () => ({
          id: 'idea-1',
          statement: 'Если упростить онбординг, активация вырастет',
          goalId: 'goal-1',
        })),
      },
      goal: {
        findFirst: vi.fn(async () => ({
          id: 'goal-1',
          name: 'Рост активации',
          createdById: 'owner-1',
          tenantId: 't-1',
          keyResults: [
            {
              id: 'kr-1',
              name: 'Активация 60%',
              currentValue: 40,
              targetValue: 60,
              unit: '%',
            },
          ],
        })),
      },
      membership: {
        findMany: vi.fn(async () => [{ userId: 'admin-1' }]),
      },
    };
  });

  it('shipped + Idea.goalId set → probe.suggest вызван с нужными reason/service', async () => {
    const { handler, suggest, inc } = makeHandler(prisma);
    await handler.handle(baseEvent());
    expect(suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        emittedByService: '3-14-goals',
        reason: 'goal.kr_checkpoint_suggested',
        payload: expect.objectContaining({
          contextCardId: 'goal-1',
          contextCardKind: 'goal',
          actionUrl: '/goals/goal-1',
        }),
      }),
    );
    const call = suggest.mock.calls[0]![0] as {
      recipientCandidates: string[];
    };
    expect(call.recipientCandidates).toContain('owner-1');
    expect(call.recipientCandidates).toContain('admin-1');
    expect(inc).toHaveBeenCalledWith({
      type: 'goal',
      reason: 'kr_checkpoint_suggested',
    });
  });

  it('newStatus != shipped → probe НЕ вызван', async () => {
    const { handler, suggest } = makeHandler(prisma);
    await handler.handle(baseEvent({ newStatus: 'in_progress' }));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('Idea.goalId = null → probe НЕ вызван', async () => {
    prisma.idea.findFirst = vi.fn(async () => ({
      id: 'idea-1',
      statement: 'x',
      goalId: null,
    }));
    const { handler, suggest } = makeHandler(prisma);
    await handler.handle(baseEvent());
    expect(suggest).not.toHaveBeenCalled();
  });

  it('goal не найден → probe НЕ вызван', async () => {
    prisma.goal.findFirst = vi.fn(async () => null);
    const { handler, suggest } = makeHandler(prisma);
    await handler.handle(baseEvent());
    expect(suggest).not.toHaveBeenCalled();
  });
});

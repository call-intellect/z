import type { IdeaBlock } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';

import { RouterService } from './router.service';

function makeMocks(opts: { hasEmployeeSubject: boolean }) {
  const findFirst = vi.fn(async () => (opts.hasEmployeeSubject ? { entityId: 'ent-emp-1' } : null));
  const prisma = {
    ideaBlockEntity: { findFirst },
    ideaBlock: { findUnique: vi.fn() },
  } as unknown as PrismaService;

  const enqueueSpecialistRouting = vi.fn(async () => undefined);
  const coreQueue = {
    enqueueSpecialistRouting,
  } as unknown as CoreQueueService;

  const incCoreRouterDispatched = vi.fn();
  const incCoreRouterTrimmed = vi.fn();
  const observeCoreRouterFanOut = vi.fn();
  const incRouterFallbackCall = vi.fn();
  const incRouterFallbackCacheHit = vi.fn();
  const metrics = {
    incCoreRouterDispatched,
    incCoreRouterTrimmed,
    observeCoreRouterFanOut,
    incRouterFallbackCall,
    incRouterFallbackCacheHit,
  } as unknown as BusinessMetricsService;

  const cfg = {
    router: { maxSpecialistsPerBlock: 4 },
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  return {
    prisma,
    coreQueue,
    metrics,
    cfg,
    findFirst,
    enqueueSpecialistRouting,
    incCoreRouterDispatched,
  };
}

function makeBlock(
  signalType: IdeaBlock['signalType'],
): Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'> {
  return { id: 'blk-1', tenantId: 'org-1', signalType };
}

describe('RouterService.dispatch — Фаза 0.5 (expertise/experience/competence → SKILL + KNOWLEDGE_CLONE)', () => {
  beforeEach(() => {
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });

  it('signalType=expertise + employee subject → dispatches SKILL + KNOWLEDGE_CLONE', async () => {
    const m = makeMocks({ hasEmployeeSubject: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);

    const result = await router.dispatch(makeBlock('expertise'));

    expect(result.dispatched).toEqual(
      expect.arrayContaining([
        RouterService.SPECIALIST.SKILL,
        RouterService.SPECIALIST.KNOWLEDGE_CLONE,
      ]),
    );
    expect(result.dispatched).toHaveLength(2);
    expect(m.enqueueSpecialistRouting).toHaveBeenCalledTimes(2);
    expect(m.incCoreRouterDispatched).toHaveBeenCalledTimes(2);
  });

  it('signalType=experience + external subject → 0 specialists (нет employee, KNOWLEDGE_CLONE не enqueue)', async () => {
    const m = makeMocks({ hasEmployeeSubject: false });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);

    const result = await router.dispatch(makeBlock('experience'));

    expect(result.dispatched).toEqual([]);
    expect(m.enqueueSpecialistRouting).not.toHaveBeenCalled();
  });

  it('signalType=competence + employee subject → 2 specialists (SKILL + KNOWLEDGE_CLONE)', async () => {
    const m = makeMocks({ hasEmployeeSubject: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);

    const result = await router.dispatch(makeBlock('competence'));

    expect(result.dispatched).toEqual(
      expect.arrayContaining([
        RouterService.SPECIALIST.SKILL,
        RouterService.SPECIALIST.KNOWLEDGE_CLONE,
      ]),
    );
    expect(result.dispatched).toHaveLength(2);
    const calls = m.enqueueSpecialistRouting.mock.calls.map((c) => {
      const arg0 = (c as unknown as [unknown])[0] as {
        specialistName: string;
      };
      return arg0.specialistName;
    });
    expect(calls).toEqual(expect.arrayContaining(['3-7-skill', '3-2-knowledge-clone']));
  });
});

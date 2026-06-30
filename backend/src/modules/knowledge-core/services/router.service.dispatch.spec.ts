import type { IdeaBlock } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';

import { RouterService } from './router.service';

function makeMocks(opts: { hasEmployeeSubject: boolean; combinedEnabled?: boolean }) {
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
    specialistsCombined: {
      enabled: opts.combinedEnabled ?? false,
      delayMs: 90_000,
    },
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

describe('RouterService.dispatch — гибрид combined (skip 9 покрытых, keep 3 multi-step)', () => {
  beforeEach(() => {
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });

  it('combined ON: decision → DECISIONS покрыт combined → 0 раздельных', async () => {
    const m = makeMocks({ hasEmployeeSubject: false, combinedEnabled: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);
    const result = await router.dispatch(makeBlock('decision'));
    expect(result.dispatched).toEqual([]);
    expect(m.enqueueSpecialistRouting).not.toHaveBeenCalled();
  });

  it('combined ON: commitment → GOALS (multi-step) остаётся раздельным', async () => {
    const m = makeMocks({ hasEmployeeSubject: false, combinedEnabled: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);
    const result = await router.dispatch(makeBlock('commitment'));
    expect(result.dispatched).toEqual([RouterService.SPECIALIST.GOALS]);
    expect(m.enqueueSpecialistRouting).toHaveBeenCalledTimes(1);
  });

  it('combined ON: team_friction → INSIGHTS убран, PERSONAL_RELATION остаётся (фильтр по специалисту)', async () => {
    const m = makeMocks({ hasEmployeeSubject: false, combinedEnabled: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);
    const result = await router.dispatch(makeBlock('team_friction'));
    expect(result.dispatched).toEqual([RouterService.SPECIALIST.PERSONAL_RELATION]);
  });

  it('combined OFF: decision → DECISIONS диспатчится как обычно', async () => {
    const m = makeMocks({ hasEmployeeSubject: false, combinedEnabled: false });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);
    const result = await router.dispatch(makeBlock('decision'));
    expect(result.dispatched).toEqual([RouterService.SPECIALIST.DECISIONS]);
  });

  it('WP-B combined ON: process_step → REGULATIONS убран (covered), PROCESS_DETECTOR остаётся раздельным', async () => {
    const m = makeMocks({ hasEmployeeSubject: false, combinedEnabled: true });
    const router = new RouterService(m.prisma, m.coreQueue, m.metrics, m.cfg);
    const result = await router.dispatch(makeBlock('process_step'));
    expect(result.dispatched).toEqual([RouterService.SPECIALIST.PROCESS_DETECTOR]);
    expect(m.enqueueSpecialistRouting).toHaveBeenCalledTimes(1);
  });
});

describe('RouterService.COMBINED_COVERED — инвариант (WP-B)', () => {
  it('НЕ содержит PROCESS_DETECTOR (process-detector диспатчится раздельно)', () => {
    expect(RouterService.COMBINED_COVERED.has(RouterService.SPECIALIST.PROCESS_DETECTOR)).toBe(
      false,
    );
  });

  it('содержит derive-only специалистов (decisions/regulations/insights/ideas/skill/knowledge-clone/experiments/helpfulness)', () => {
    for (const s of [
      RouterService.SPECIALIST.DECISIONS,
      RouterService.SPECIALIST.REGULATIONS,
      RouterService.SPECIALIST.INSIGHTS,
      RouterService.SPECIALIST.IDEAS,
      RouterService.SPECIALIST.SKILL,
      RouterService.SPECIALIST.KNOWLEDGE_CLONE,
      RouterService.SPECIALIST.EXPERIMENT_TRACKER,
      RouterService.SPECIALIST.HELPFULNESS,
    ]) {
      expect(RouterService.COMBINED_COVERED.has(s)).toBe(true);
    }
  });
});

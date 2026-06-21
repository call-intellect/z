import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { SubjectMemoryActivationService } from './subject-memory-activation.service';

interface RuleRow {
  id: string;
  tenantId: string;
  kind: string;
  contextText: string;
  ruleText: string;
  confirmCount: number;
  refuteCount: number;
  confidence: number;
  canaryAt: Date | null;
  staleAfter: Date | null;
  createdAt: Date;
}

const JUDGE_MODELS = ['deepseek-v4-flash', 'gpt-5.4-mini'] as const;

function makeService(args: {
  enabled?: boolean;
  judgeApprovals?: boolean[];
  findManyRows?: RuleRow[];
  probeCounts?: number[];
}): {
  svc: SubjectMemoryActivationService;
  llmCall: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  probeCount: ReturnType<typeof vi.fn>;
  metrics: {
    incSubjectMemoryRuleActivated: ReturnType<typeof vi.fn>;
    incSubjectMemoryRuleRolledBack: ReturnType<typeof vi.fn>;
    incSubjectMemoryApply: ReturnType<typeof vi.fn>;
  };
} {
  const approvals = args.judgeApprovals ?? [];
  let callIdx = 0;
  const llmCall = vi.fn().mockImplementation(() => {
    const approve = approvals[callIdx] ?? false;
    callIdx++;
    return Promise.resolve({ text: JSON.stringify({ approve }) });
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const findMany = vi.fn().mockResolvedValue(args.findManyRows ?? []);
  const update = vi.fn().mockResolvedValue({ id: 'sm' });
  const probeCounts = args.probeCounts ?? [];
  let countIdx = 0;
  const probeCount = vi.fn().mockImplementation(() => {
    const v = probeCounts[countIdx] ?? 0;
    countIdx++;
    return Promise.resolve(v);
  });
  const prisma = {
    subjectMemory: { findMany, update },
    probeEvent: { count: probeCount },
  } as unknown as PrismaService;

  const incSubjectMemoryRuleActivated = vi.fn();
  const incSubjectMemoryRuleRolledBack = vi.fn();
  const incSubjectMemoryApply = vi.fn();
  const metrics = {
    incSubjectMemoryRuleActivated,
    incSubjectMemoryRuleRolledBack,
    incSubjectMemoryApply,
  } as unknown as BusinessMetricsService;

  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    subjectMemory: {
      enabled: args.enabled ?? true,
      judgeQuorum: 2,
      judgeModels: JUDGE_MODELS,
      canaryRollbackWindowHours: 48,
      ttlDays: 180,
      shadowToCanaryMinConfirm: 0,
    },
  } as unknown as TypedConfigService;

  const svc = new SubjectMemoryActivationService(prisma, llm, metrics, cfg);
  return {
    svc,
    llmCall,
    findMany,
    update,
    probeCount,
    metrics: {
      incSubjectMemoryRuleActivated,
      incSubjectMemoryRuleRolledBack,
      incSubjectMemoryApply,
    },
  };
}

function shadowRule(over: Partial<RuleRow> = {}): RuleRow {
  return {
    id: 'sm-1',
    tenantId: 'org-1',
    kind: 'term',
    contextText: 'КП',
    ruleText: 'КП = коммерческое предложение',
    confirmCount: 1,
    refuteCount: 0,
    confidence: 0.9,
    canaryAt: null,
    staleAfter: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    ...over,
  };
}

describe('SubjectMemoryActivationService.promoteShadowRules', () => {
  it('единогласное approve → canary + canaryAt + staleAfter, 2 разных модели', async () => {
    const { svc, llmCall, update } = makeService({
      findManyRows: [shadowRule()],
      judgeApprovals: [true, true],
    });

    const r = await svc.promoteShadowRules();

    expect(r).toEqual({ promoted: 1, rejected: 0 });
    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'subject-memory-judge',
        model: 'deepseek-v4-flash',
        tenantId: 'org-1',
      }),
    );
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'subject-memory-judge',
        model: 'gpt-5.4-mini',
        tenantId: 'org-1',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-1' },
        data: expect.objectContaining({
          status: 'canary',
          canaryAt: expect.any(Date),
          staleAfter: expect.any(Date),
        }),
      }),
    );
  });

  it('один judge против → правило остаётся shadow (нет update в canary), rejected=1', async () => {
    const { svc, update } = makeService({
      findManyRows: [shadowRule()],
      judgeApprovals: [true, false],
    });

    const r = await svc.promoteShadowRules();

    expect(r).toEqual({ promoted: 0, rejected: 1 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('SubjectMemoryActivationService.evaluateCanaryRules', () => {
  const canaryRule = (over: Partial<RuleRow> = {}): RuleRow =>
    shadowRule({
      canaryAt: new Date('2026-06-01T10:00:00Z'),
      ...over,
    });

  it('refute≤confirm и метрика не ухудшилась → active + incActivated', async () => {
    const { svc, update, metrics } = makeService({
      findManyRows: [canaryRule({ confirmCount: 3, refuteCount: 0 })],
    });
    const spy = vi
      .spyOn(svc, 'measureRollbackWorsened')
      .mockResolvedValue(false);

    const r = await svc.evaluateCanaryRules();

    expect(r).toEqual({ activated: 1, rolledBack: 0 });
    expect(spy).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-1' },
        data: expect.objectContaining({ status: 'active' }),
      }),
    );
    expect(metrics.incSubjectMemoryRuleActivated).toHaveBeenCalled();
  });

  it('метрика ухудшилась → rolled_back cause metric_worsened', async () => {
    const { svc, update, metrics } = makeService({
      findManyRows: [canaryRule({ confirmCount: 3, refuteCount: 0 })],
    });
    vi.spyOn(svc, 'measureRollbackWorsened').mockResolvedValue(true);

    const r = await svc.evaluateCanaryRules();

    expect(r).toEqual({ activated: 0, rolledBack: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-1' },
        data: expect.objectContaining({ status: 'rolled_back' }),
      }),
    );
    expect(metrics.incSubjectMemoryRuleRolledBack).toHaveBeenCalledWith({
      cause: 'metric_worsened',
    });
  });

  it('refute>confirm → rolled_back cause refute_exceeds_confirm, measure не зовётся', async () => {
    const { svc, update, metrics } = makeService({
      findManyRows: [canaryRule({ confirmCount: 1, refuteCount: 5 })],
    });
    const spy = vi.spyOn(svc, 'measureRollbackWorsened');

    const r = await svc.evaluateCanaryRules();

    expect(r).toEqual({ activated: 0, rolledBack: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-1' },
        data: expect.objectContaining({ status: 'rolled_back' }),
      }),
    );
    expect(metrics.incSubjectMemoryRuleRolledBack).toHaveBeenCalledWith({
      cause: 'refute_exceeds_confirm',
    });
  });
});

describe('SubjectMemoryActivationService.decayStaleRules', () => {
  it('refute>confirm → superseded; refute≤confirm → confidence понижен + staleAfter обновлён', async () => {
    const past = new Date('2026-01-01T10:00:00Z');
    const { svc, update } = makeService({
      findManyRows: [
        shadowRule({
          id: 'sm-sup',
          confirmCount: 1,
          refuteCount: 5,
          staleAfter: past,
        }),
        shadowRule({
          id: 'sm-decay',
          confirmCount: 3,
          refuteCount: 0,
          confidence: 0.9,
          staleAfter: past,
        }),
      ],
    });

    const r = await svc.decayStaleRules();

    expect(r).toEqual({ decayed: 1, superseded: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-sup' },
        data: expect.objectContaining({ status: 'superseded' }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-decay' },
        data: expect.objectContaining({
          confidence: expect.closeTo(0.8, 5),
          staleAfter: expect.any(Date),
        }),
      }),
    );
  });
});

describe('SubjectMemoryActivationService kill-switch', () => {
  it('enabled=false → нули и findMany не вызывается', async () => {
    const { svc, findMany } = makeService({ enabled: false });

    const promote = await svc.promoteShadowRules();
    const evaluate = await svc.evaluateCanaryRules();
    const decay = await svc.decayStaleRules();

    expect(promote).toEqual({ promoted: 0, rejected: 0 });
    expect(evaluate).toEqual({ activated: 0, rolledBack: 0 });
    expect(decay).toEqual({ decayed: 0, superseded: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

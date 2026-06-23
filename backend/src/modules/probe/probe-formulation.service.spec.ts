import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';

import { ProbeFormulationService } from './probe-formulation.service';
import type { SubjectMemoryService } from './subject-memory/subject-memory.service';

function makeProbe(payload: Record<string, unknown>): never {
  return {
    id: 'probe-gate-1',
    tenantId: 'org-gate',
    reason: 'decision.missing_decider',
    payload,
  } as unknown as never;
}

function makeService(args: {
  valueGateEnabled?: boolean;
  llmResponse?: { text: string };
  llmThrow?: Error;
  subjectMemoryEnabled?: boolean;
  retrieveBeforeAskEnabled?: boolean;
  applicableRule?: {
    id: string;
    kind: string;
    ruleText: string;
    similarity: number;
  } | null;
  relevantRules?: string[];
  experimentRow?: {
    name: string;
    currentResult: string | null;
    hypothesisText: string | null;
  } | null;
  decisionRows?: {
    statement: string | null;
    text: string | null;
    rationale: string | null;
  }[];
}): {
  svc: ProbeFormulationService;
  llmCall: ReturnType<typeof vi.fn>;
  findApplicableRule: ReturnType<typeof vi.fn>;
  findRelevantRules: ReturnType<typeof vi.fn>;
  incSubjectMemoryProbeSuppressed: ReturnType<typeof vi.fn>;
  experimentFindFirst: ReturnType<typeof vi.fn>;
  decisionFindMany: ReturnType<typeof vi.fn>;
} {
  const llmCall = vi.fn();
  if (args.llmThrow) {
    llmCall.mockRejectedValue(args.llmThrow);
  } else {
    llmCall.mockResolvedValue(
      args.llmResponse ?? { text: JSON.stringify({ ask: true, reason: 'ok' }) },
    );
  }
  const llm = { call: llmCall } as unknown as LlmRouterService;
  const incSubjectMemoryProbeSuppressed = vi.fn();
  const metrics = {
    incProbeQualityJudged: vi.fn(),
    incSubjectMemoryProbeSuppressed,
  } as unknown as BusinessMetricsService;
  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    subjectMemory: {
      enabled: args.subjectMemoryEnabled ?? true,
      retrieveBeforeAskEnabled: args.retrieveBeforeAskEnabled ?? true,
      matchMinSimilarity: 0.82,
      suppressMinConfidence: 0.7,
    },
    getDynamic: vi
      .fn()
      .mockImplementation(async (key: string, _e: unknown, def: unknown) => {
        if (key === 'probe.valueGateEnabled') {
          return args.valueGateEnabled ?? true;
        }
        return def;
      }),
  } as unknown as TypedConfigService;

  const findApplicableRule = vi
    .fn()
    .mockResolvedValue(args.applicableRule ?? null);
  const findRelevantRules = vi
    .fn()
    .mockResolvedValue(args.relevantRules ?? []);
  const subjectMemory = {
    findApplicableRule,
    findRelevantRules,
  } as unknown as SubjectMemoryService;

  const experimentFindFirst = vi
    .fn()
    .mockResolvedValue(args.experimentRow ?? null);
  const decisionFindMany = vi
    .fn()
    .mockResolvedValue(args.decisionRows ?? []);
  const prisma = {
    experiment: { findFirst: experimentFindFirst },
    decision: { findMany: decisionFindMany },
  } as unknown as PrismaService;

  return {
    svc: new ProbeFormulationService(
      llm,
      metrics,
      cfg,
      subjectMemory,
      prisma,
    ),
    llmCall,
    findApplicableRule,
    findRelevantRules,
    incSubjectMemoryProbeSuppressed,
    experimentFindFirst,
    decisionFindMany,
  };
}

describe('ProbeFormulationService.gate', () => {
  it('флаг valueGateEnabled=false → ask=true reason=gate_disabled БЕЗ LLM-вызова', async () => {
    const { svc, llmCall } = makeService({ valueGateEnabled: false });
    const verdict = await svc.gate(makeProbe({ objectName: 'Склад №3' }));
    expect(verdict).toEqual({ ask: true, reason: 'gate_disabled' });
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('флаг ON, LLM ask=false → проброшен вердикт ask=false', async () => {
    const { svc, llmCall } = makeService({
      valueGateEnabled: true,
      llmResponse: { text: JSON.stringify({ ask: false, reason: 'пусто' }) },
    });
    const verdict = await svc.gate(makeProbe({ objectName: 'отчёт' }));
    expect(verdict.ask).toBe(false);
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(
      (llmCall.mock.calls[0]![0] as { taskType: string }).taskType,
    ).toBe('probe-value-gate');
  });

  it('флаг ON, LLM упал → fail-open ask=true reason=gate_error', async () => {
    const { svc } = makeService({
      valueGateEnabled: true,
      llmThrow: new Error('gate down'),
    });
    const verdict = await svc.gate(makeProbe({ objectName: 'Склад №3' }));
    expect(verdict).toEqual({ ask: true, reason: 'gate_error' });
  });

  it('память знает ответ → ask=false reason=answered_by_memory, LLM не вызван', async () => {
    const { svc, llmCall, incSubjectMemoryProbeSuppressed } = makeService({
      valueGateEnabled: true,
      applicableRule: {
        id: 'r1',
        kind: 'term',
        ruleText: 'КП = коммерческое предложение',
        similarity: 0.9,
      },
    });
    const verdict = await svc.gate(makeProbe({ objectName: 'Склад №3' }));
    expect(verdict).toEqual({ ask: false, reason: 'answered_by_memory' });
    expect(llmCall).not.toHaveBeenCalled();
    expect(incSubjectMemoryProbeSuppressed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'answered_by_memory' }),
    );
  });

  it('правила нет → обычный value-gate (LLM вызван, вердикт проброшен)', async () => {
    const { svc, llmCall, findApplicableRule } = makeService({
      valueGateEnabled: true,
      applicableRule: null,
      llmResponse: { text: JSON.stringify({ ask: false, reason: 'пусто' }) },
    });
    const verdict = await svc.gate(makeProbe({ objectName: 'отчёт' }));
    expect(findApplicableRule).toHaveBeenCalledTimes(1);
    expect(verdict.ask).toBe(false);
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(
      (llmCall.mock.calls[0]![0] as { taskType: string }).taskType,
    ).toBe('probe-value-gate');
  });

  it('kill-switch retrieveBeforeAsk=false → findApplicableRule НЕ вызывается, обычный гейт', async () => {
    const { svc, llmCall, findApplicableRule } = makeService({
      valueGateEnabled: true,
      retrieveBeforeAskEnabled: false,
      applicableRule: {
        id: 'r1',
        kind: 'term',
        ruleText: 'правило',
        similarity: 0.99,
      },
      llmResponse: { text: JSON.stringify({ ask: true, reason: 'ok' }) },
    });
    const verdict = await svc.gate(makeProbe({ objectName: 'Склад №3' }));
    expect(findApplicableRule).not.toHaveBeenCalled();
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(verdict.ask).toBe(true);
  });
});

function makeExperimentProbe(
  payload: Record<string, unknown>,
  reason = 'experiment.result_without_lesson',
): never {
  return {
    id: 'probe-draft-1',
    tenantId: 'org-draft',
    reason,
    payload,
  } as unknown as never;
}

describe('ProbeFormulationService.draftFromMemory', () => {
  it('experiment.result_without_lesson + результат + LLM → черновик урока', async () => {
    const { svc, experimentFindFirst, llmCall } = makeService({
      experimentRow: {
        name: 'Битрикс',
        currentResult: 'CRM восстановлена',
        hypothesisText: 'миграция ускорит продажи',
      },
      llmResponse: {
        text: JSON.stringify({ draftAnswer: 'урок X', missingNote: '' }),
      },
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({ contextCardId: 'exp-1' }),
    );
    expect(draft).toEqual({ draftAnswer: 'урок X', draftKind: 'experiment_lesson' });
    expect(experimentFindFirst).toHaveBeenCalledTimes(1);
    expect(
      (llmCall.mock.calls[0]![0] as { taskType: string }).taskType,
    ).toBe('probe-draft-from-memory');
  });

  it('нет currentResult → null, LLM не зовётся', async () => {
    const { svc, llmCall } = makeService({
      experimentRow: {
        name: 'Битрикс',
        currentResult: null,
        hypothesisText: 'гипотеза',
      },
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({ contextCardId: 'exp-1' }),
    );
    expect(draft).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('нет contextCardId → null, prisma не зовётся', async () => {
    const { svc, experimentFindFirst } = makeService({});
    const draft = await svc.draftFromMemory(makeExperimentProbe({}));
    expect(draft).toBeNull();
    expect(experimentFindFirst).not.toHaveBeenCalled();
  });

  it('другой reason → null', async () => {
    const { svc, experimentFindFirst } = makeService({});
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({ contextCardId: 'exp-1' }, 'decision.missing_decider'),
    );
    expect(draft).toBeNull();
    expect(experimentFindFirst).not.toHaveBeenCalled();
  });

  it('LLM упал → null (best-effort)', async () => {
    const { svc } = makeService({
      experimentRow: {
        name: 'Битрикс',
        currentResult: 'CRM восстановлена',
        hypothesisText: null,
      },
      llmThrow: new Error('llm down'),
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({ contextCardId: 'exp-1' }),
    );
    expect(draft).toBeNull();
  });

  it('companyprofile.missing_mission + решения + LLM → черновик миссии', async () => {
    const { svc, decisionFindMany, llmCall } = makeService({
      decisionRows: [
        { statement: 'Выходим на рынок РФ', text: null, rationale: 'спрос' },
        { statement: 'Делаем ставку на память компании', text: null, rationale: null },
      ],
      llmResponse: {
        text: JSON.stringify({ draftAnswer: 'Миссия X', missingNote: '' }),
      },
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({}, 'companyprofile.missing_mission'),
    );
    expect(draft).toEqual({ draftAnswer: 'Миссия X', draftKind: 'company_mission' });
    expect(decisionFindMany).toHaveBeenCalledTimes(1);
    expect(
      (llmCall.mock.calls[0]![0] as { taskType: string }).taskType,
    ).toBe('probe-draft-from-memory');
  });

  it('companyprofile.missing_vision → draftKind company_vision', async () => {
    const { svc } = makeService({
      decisionRows: [{ statement: 'Решение А', text: null, rationale: null }],
      llmResponse: {
        text: JSON.stringify({ draftAnswer: 'Видение Y', missingNote: '' }),
      },
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({}, 'companyprofile.missing_vision'),
    );
    expect(draft).toEqual({ draftAnswer: 'Видение Y', draftKind: 'company_vision' });
  });

  it('companyprofile.missing_strategy → draftKind company_strategy', async () => {
    const { svc } = makeService({
      decisionRows: [{ statement: 'Решение Б', text: null, rationale: null }],
      llmResponse: {
        text: JSON.stringify({ draftAnswer: 'Стратегия Z', missingNote: '' }),
      },
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({}, 'companyprofile.missing_strategy'),
    );
    expect(draft).toEqual({ draftAnswer: 'Стратегия Z', draftKind: 'company_strategy' });
  });

  it('companyprofile.missing_mission + 0 решений → null, LLM не зовётся', async () => {
    const { svc, llmCall } = makeService({
      decisionRows: [],
    });
    const draft = await svc.draftFromMemory(
      makeExperimentProbe({}, 'companyprofile.missing_mission'),
    );
    expect(draft).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });
});

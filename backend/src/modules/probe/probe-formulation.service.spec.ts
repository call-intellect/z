import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
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
}): {
  svc: ProbeFormulationService;
  llmCall: ReturnType<typeof vi.fn>;
  findApplicableRule: ReturnType<typeof vi.fn>;
  findRelevantRules: ReturnType<typeof vi.fn>;
  incSubjectMemoryProbeSuppressed: ReturnType<typeof vi.fn>;
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

  return {
    svc: new ProbeFormulationService(llm, metrics, cfg, subjectMemory),
    llmCall,
    findApplicableRule,
    findRelevantRules,
    incSubjectMemoryProbeSuppressed,
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

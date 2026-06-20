import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';

import { ProbeFormulationService } from './probe-formulation.service';

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
}): { svc: ProbeFormulationService; llmCall: ReturnType<typeof vi.fn> } {
  const llmCall = vi.fn();
  if (args.llmThrow) {
    llmCall.mockRejectedValue(args.llmThrow);
  } else {
    llmCall.mockResolvedValue(
      args.llmResponse ?? { text: JSON.stringify({ ask: true, reason: 'ok' }) },
    );
  }
  const llm = { call: llmCall } as unknown as LlmRouterService;
  const metrics = {
    incProbeQualityJudged: vi.fn(),
  } as unknown as BusinessMetricsService;
  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    getDynamic: vi
      .fn()
      .mockImplementation(async (key: string, _e: unknown, def: unknown) => {
        if (key === 'probe.valueGateEnabled') {
          return args.valueGateEnabled ?? true;
        }
        return def;
      }),
  } as unknown as TypedConfigService;

  return { svc: new ProbeFormulationService(llm, metrics, cfg), llmCall };
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
});

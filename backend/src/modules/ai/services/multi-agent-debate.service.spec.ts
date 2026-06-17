import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import type { LlmCallResult, LlmRouterService } from './llm-router.service';
import { type DebateVerdict, MultiAgentDebateService } from './multi-agent-debate.service';

interface VoteMock {
  verdict: string;
  reasoning?: string;
  confidence?: number;
  provider: 'deepseek' | 'openai-via-proxy';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

function buildLlmRouter(votes: Array<VoteMock | Error>): {
  router: LlmRouterService;
  calls: Array<{ taskType: string }>;
} {
  const calls: Array<{ taskType: string }> = [];
  let i = 0;
  const call = vi.fn(async (params: { taskType: string }): Promise<LlmCallResult> => {
    calls.push({ taskType: params.taskType });
    const next = votes[i++];
    if (!next) throw new Error('No more votes mocked');
    if (next instanceof Error) throw next;
    const text = JSON.stringify({
      verdict: next.verdict,
      reasoning: next.reasoning ?? 'because',
      confidence: next.confidence ?? 0.8,
    });
    return {
      text,
      modelUsed: `${next.provider}:${next.model}`,
      inputTokens: next.inputTokens ?? 500,
      outputTokens: next.outputTokens ?? 100,
      cachedTokens: 0,
      durationMs: 50,
      providerUsed: next.provider,
    };
  });
  return {
    router: { call } as unknown as LlmRouterService,
    calls,
  };
}

function buildMetrics() {
  return {
    incDebateJudgment: vi.fn(),
    incDebateCost: vi.fn(),
    incDebateRound2Triggered: vi.fn(),
    incDebateProviderDisagreement: vi.fn(),
    incDebateFallbackToSingle: vi.fn(),
  };
}

function buildCfg(
  overrides?: Partial<{
    enabled: boolean;
    defaultN: number;
    defaultRounds: number;
    round2Enabled: boolean;
    costCapUsdPerRun: number;
  }>,
): TypedConfigService {
  const debate = {
    enabled: true,
    defaultN: 3,
    defaultRounds: 1,
    round2Enabled: false,
    costCapUsdPerRun: 0.05,
    ...overrides,
  };
  return { debate } as unknown as TypedConfigService;
}

const baseRequest = {
  task: 'Является ли candidate superseding existing?',
  candidates: [{ id: 'cand-1', text: 'new policy' }],
  contextBlocks: [],
  taskType: 'debate-decision-supersede',
  tenantId: 'tenant-A',
};

describe('MultiAgentDebateService.judge', () => {
  let metrics: ReturnType<typeof buildMetrics>;

  beforeEach(() => {
    metrics = buildMetrics();
  });

  it('сценарий 1: unanimous 3-0 → consensusType=unanimous, decision=supersedes', async () => {
    const { router, calls } = buildLlmRouter([
      { verdict: 'supersedes', provider: 'deepseek', model: 'deepseek-v4-pro' },
      { verdict: 'supersedes', provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { verdict: 'supersedes', provider: 'deepseek', model: 'deepseek-v4-flash' },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict: DebateVerdict = await service.judge(baseRequest);

    expect(verdict.decision).toBe('supersedes');
    expect(verdict.consensusType).toBe('unanimous');
    expect(verdict.votes).toHaveLength(3);
    expect(verdict.rounds).toBe(1);
    expect(verdict.fallbackUsed).toBeNull();
    expect(calls.map((c) => c.taskType)).toEqual([
      'debate-decision-supersede-critic',
      'debate-decision-supersede-supporter',
      'debate-decision-supersede-neutral',
    ]);
    expect(metrics.incDebateJudgment).toHaveBeenCalledWith({
      taskType: 'debate-decision-supersede',
      decision: 'supersedes',
      consensusType: 'unanimous',
    });
    expect(metrics.incDebateProviderDisagreement).not.toHaveBeenCalled();
    expect(metrics.incDebateFallbackToSingle).not.toHaveBeenCalled();
  });

  it('сценарий 2: majority 2-1 → consensusType=majority, decision=новый по majority', async () => {
    const { router } = buildLlmRouter([
      { verdict: 'new', provider: 'deepseek', model: 'deepseek-v4-pro' },
      { verdict: 'merge', provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { verdict: 'new', provider: 'deepseek', model: 'deepseek-v4-flash' },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict = await service.judge(baseRequest);

    expect(verdict.decision).toBe('new');
    expect(verdict.consensusType).toBe('majority');
    expect(verdict.votes).toHaveLength(3);
    expect(verdict.fallbackUsed).toBeNull();
    expect(metrics.incDebateJudgment).toHaveBeenCalledWith({
      taskType: 'debate-decision-supersede',
      decision: 'new',
      consensusType: 'majority',
    });
    expect(metrics.incDebateProviderDisagreement).toHaveBeenCalled();
  });

  it('сценарий 3: split 1-1-1 → consensusType=split, decision=split_uncertain', async () => {
    const { router } = buildLlmRouter([
      { verdict: 'supersedes', provider: 'deepseek', model: 'deepseek-v4-pro' },
      { verdict: 'merge', provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { verdict: 'new', provider: 'deepseek', model: 'deepseek-v4-flash' },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict = await service.judge(baseRequest);

    expect(verdict.decision).toBe('split_uncertain');
    expect(verdict.consensusType).toBe('split');
    expect(verdict.fallbackUsed).toBeNull();
    expect(metrics.incDebateJudgment).toHaveBeenCalledWith({
      taskType: 'debate-decision-supersede',
      decision: 'split_uncertain',
      consensusType: 'split',
    });
    expect(metrics.incDebateRound2Triggered).not.toHaveBeenCalled();
  });

  it('сценарий 4: cost cap exceeded → fallbackUsed=cost_cap, метрика fallback дёрнута', async () => {
    const heavyTokens = { inputTokens: 500_000, outputTokens: 100_000 };
    const { router } = buildLlmRouter([
      { verdict: 'supersedes', provider: 'deepseek', model: 'deepseek-v4-pro', ...heavyTokens },
      { verdict: 'supersedes', provider: 'openai-via-proxy', model: 'gpt-5.4', ...heavyTokens },
      { verdict: 'supersedes', provider: 'deepseek', model: 'deepseek-v4-flash', ...heavyTokens },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg({ costCapUsdPerRun: 0.05 }),
    );
    const verdict = await service.judge(baseRequest);

    expect(verdict.fallbackUsed).toBe('cost_cap');
    expect(verdict.votes).toHaveLength(3);
    expect(verdict.totalCostUsd).toBeGreaterThan(0.05);
    expect(metrics.incDebateFallbackToSingle).toHaveBeenCalledWith({
      reason: 'cost_cap',
    });
  });

  it('cost budget: один обычный debate-run < $0.01 (3 calls × ~$0.003)', async () => {
    const standardTokens = { inputTokens: 1000, outputTokens: 300 };
    const { router } = buildLlmRouter([
      { verdict: 'merge', provider: 'deepseek', model: 'deepseek-v4-pro', ...standardTokens },
      { verdict: 'merge', provider: 'openai-via-proxy', model: 'gpt-5.4', ...standardTokens },
      { verdict: 'merge', provider: 'deepseek', model: 'deepseek-v4-flash', ...standardTokens },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict = await service.judge(baseRequest);

    expect(verdict.totalCostUsd).toBeLessThan(0.01);
    expect(verdict.fallbackUsed).toBeNull();
    expect(verdict.decision).toBe('merge');
  });

  it("A1: taskFamily=curation-verify резолвит curation stance-taskType'ы", async () => {
    const { router, calls } = buildLlmRouter([
      { verdict: 'accept', provider: 'deepseek', model: 'deepseek-v4-flash' },
      { verdict: 'accept', provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { verdict: 'accept', provider: 'deepseek', model: 'deepseek-v4-flash' },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict = await service.judge({
      ...baseRequest,
      taskFamily: 'curation-verify',
      taskType: 'debate-curation-verify',
    });

    expect(verdict.decision).toBe('accept');
    expect(verdict.consensusType).toBe('unanimous');
    expect(calls.map((c) => c.taskType)).toEqual([
      'debate-curation-verify-critic',
      'debate-curation-verify-supporter',
      'debate-curation-verify-neutral',
    ]);
  });

  it("A1: без taskFamily → старые decision-supersede stance-taskType'ы (обратная совместимость)", async () => {
    const { router, calls } = buildLlmRouter([
      { verdict: 'new', provider: 'deepseek', model: 'deepseek-v4-pro' },
      { verdict: 'new', provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { verdict: 'new', provider: 'deepseek', model: 'deepseek-v4-flash' },
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    await service.judge(baseRequest);

    expect(calls.map((c) => c.taskType)).toEqual([
      'debate-decision-supersede-critic',
      'debate-decision-supersede-supporter',
      'debate-decision-supersede-neutral',
    ]);
  });

  it('все 3 голоса упали → fallbackUsed=provider_unavailable, decision=split_uncertain', async () => {
    const { router } = buildLlmRouter([
      new Error('deepseek down'),
      new Error('openai 503'),
      new Error('ollama timeout'),
    ]);
    const service = new MultiAgentDebateService(
      router,
      metrics as unknown as BusinessMetricsService,
      buildCfg(),
    );
    const verdict = await service.judge(baseRequest);

    expect(verdict.decision).toBe('split_uncertain');
    expect(verdict.fallbackUsed).toBe('provider_unavailable');
    expect(verdict.votes).toHaveLength(0);
    expect(metrics.incDebateFallbackToSingle).toHaveBeenCalledWith({
      reason: 'provider_unavailable',
    });
  });
});

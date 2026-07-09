import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { BudgetGuardService } from './budget-guard.service';
import { LlmBudgetExceededError, LlmRouterService, type LlmTaskType } from './llm-router.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import type { LlmProtocolAdapterRegistry } from './protocol-adapter/llm-protocol-adapter.registry';
import type { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

function makeOutput(
  provider: LlmCompleteOutput['provider'],
  model = 'deepseek-v4-flash',
): LlmCompleteOutput {
  return { text: `text-${provider}`, inputTokens: 100, outputTokens: 20, model, provider };
}

interface BuildOpts {
  bev?: { over: boolean; mtdRub: number; capRub: number | null; capKind: string };
  enforce?: boolean;
}

const DEFAULT_CHAIN = [
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'openai-via-proxy', model: 'gpt-5-mini' },
];

function build(opts: BuildOpts = {}) {
  const findMany = vi.fn(async () => [] as unknown[]);
  const priceFindFirst = vi.fn(async () => null);
  const prisma = {
    llmTaskRoute: { findMany },
    llmModelPrice: { findFirst: priceFindFirst },
    llmModelExperiment: { findMany: vi.fn(async () => []) },
    llmProvider: {
      findMany: vi.fn(async () => DEFAULT_CHAIN.map((c) => ({ name: c.provider }))),
      count: vi.fn(async () => DEFAULT_CHAIN.length),
    },
  } as unknown as PrismaService;

  const deepseekComplete = vi.fn(async () => makeOutput('deepseek'));
  const openaiComplete = vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5-mini'));
  const byProviderName: Record<string, ReturnType<typeof vi.fn>> = {
    deepseek: deepseekComplete,
    'openai-via-proxy': openaiComplete,
  };

  const adapter = {
    complete: async ({
      provider,
      input,
    }: {
      provider: { name: string };
      input: LlmCompleteInput;
    }) => {
      const complete = byProviderName[provider.name]! as unknown as (
        i: LlmCompleteInput,
      ) => Promise<LlmCompleteOutput>;
      return complete(input);
    },
  };
  const registry = { resolve: () => adapter } as unknown as LlmProtocolAdapterRegistry;
  const providerInfo = {
    resolveByName: vi.fn(async (name: string) => ({
      info: { name, baseUrl: 'https://test.local', apiKey: null },
      protocolKind: name,
    })),
  } as unknown as ProviderInfoResolver;

  const usage = { record: vi.fn() } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const incLlmBudgetExceeded = vi.fn();
  const metrics = {
    incLlmRouterDispatch,
    incLlmBudgetExceeded,
  } as unknown as BusinessMetricsService;

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'llm.budget.enforce_enabled') return opts.enforce ?? false;
    if (key === 'llm.router.defaultChain') return DEFAULT_CHAIN;
    return def;
  });
  const cfg = {
    getDynamic,
    budget: { useProtocolAdapterRegistry: true },
    llmRouter: { dispatchTimeoutMs: 300_000 },
  } as unknown as TypedConfigService;

  const evaluate = vi.fn(
    async () => opts.bev ?? { over: false, mtdRub: 0, capRub: null, capKind: 'soft' },
  );
  const budgetGuard =
    opts.bev === undefined && !('bev' in opts)
      ? undefined
      : ({ evaluate } as unknown as BudgetGuardService);

  const router = new LlmRouterService(
    prisma,
    usage,
    metrics,
    cfg,
    registry,
    providerInfo,
    undefined,
    budgetGuard,
  );

  return { router, deepseekComplete, openaiComplete, incLlmBudgetExceeded, evaluate, getDynamic };
}

const baseParams = {
  systemPrompt: 'sys',
  userMessage: 'u',
  tenantId: 't1' as string | null,
  taskType: 'tasks' as LlmTaskType,
};

describe('LlmRouterService — budget gate (cost-safety Ф2)', () => {
  it('over=true + enforce=false → НЕ блокирует, метрика observe, dispatch продолжается', async () => {
    const ctx = build({
      bev: { over: true, mtdRub: 200, capRub: 100, capKind: 'hard' },
      enforce: false,
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({ ...baseParams });

    expect(ctx.evaluate).toHaveBeenCalledWith('t1');
    expect(ctx.incLlmBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'observe' }),
    );
    expect(ctx.deepseekComplete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('deepseek:deepseek-v4-flash');
  });

  it('over=true + enforce=true → бросает LlmBudgetExceededError ДО dispatch', async () => {
    const ctx = build({
      bev: { over: true, mtdRub: 200, capRub: 100, capKind: 'hard' },
      enforce: true,
    });
    await ctx.router.refreshCache();

    await expect(ctx.router.call({ ...baseParams })).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(ctx.incLlmBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'enforce' }),
    );
    expect(ctx.deepseekComplete).not.toHaveBeenCalled();
  });

  it('over=false → gate прозрачен, метрика бюджета не инкрементится, dispatch идёт', async () => {
    const ctx = build({
      bev: { over: false, mtdRub: 10, capRub: 100, capKind: 'hard' },
      enforce: true,
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({ ...baseParams });

    expect(ctx.incLlmBudgetExceeded).not.toHaveBeenCalled();
    expect(ctx.deepseekComplete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('deepseek:deepseek-v4-flash');
  });
});

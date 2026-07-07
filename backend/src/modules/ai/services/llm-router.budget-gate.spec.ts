import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import type { BudgetGuardService } from './budget-guard.service';
import type { DeepSeekService } from './deepseek.service';
import type { GrsaiService } from './grsai.service';
import type { KieService } from './kie.service';
import { LlmBudgetExceededError, LlmRouterService, type LlmTaskType } from './llm-router.service';
import type { LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OllamaService } from './ollama.service';
import type { OpenAiProxyService } from './openai-proxy.service';

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

function build(opts: BuildOpts = {}) {
  const findMany = vi.fn(async () => [] as unknown[]);
  const priceFindFirst = vi.fn(async () => null);
  const prisma = {
    llmTaskRoute: { findMany },
    llmModelPrice: { findFirst: priceFindFirst },
    llmModelExperiment: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;

  const deepseekComplete = vi.fn(async () => makeOutput('deepseek'));
  const deepseek = { complete: deepseekComplete } as unknown as DeepSeekService;
  const openaiComplete = vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5-mini'));
  const openai = { complete: openaiComplete } as unknown as OpenAiProxyService;
  const passthrough = (p: LlmCompleteOutput['provider']) =>
    ({ complete: vi.fn(async () => makeOutput(p)) }) as unknown;
  const anthropic = passthrough('anthropic') as AnthropicService;
  const minimax = passthrough('minimax') as MinimaxService;
  const ollama = passthrough('ollama') as OllamaService;
  const kie = {
    complete: vi.fn(async () => makeOutput('kie', 'gemini-3-pro')),
  } as unknown as KieService;
  const grsai = {
    complete: vi.fn(async () => makeOutput('grsai', 'gemini-3-pro')),
  } as unknown as GrsaiService;

  const usage = { record: vi.fn() } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const incLlmBudgetExceeded = vi.fn();
  const metrics = {
    incLlmRouterDispatch,
    incLlmBudgetExceeded,
  } as unknown as BusinessMetricsService;

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'llm.budget.enforce_enabled') return opts.enforce ?? false;
    return def;
  });
  const cfg = { getDynamic } as unknown as TypedConfigService;

  const evaluate = vi.fn(
    async () => opts.bev ?? { over: false, mtdRub: 0, capRub: null, capKind: 'soft' },
  );
  const budgetGuard =
    opts.bev === undefined && !('bev' in opts)
      ? undefined
      : ({ evaluate } as unknown as BudgetGuardService);

  const router = new LlmRouterService(
    prisma,
    anthropic,
    minimax,
    openai,
    deepseek,
    ollama,
    kie,
    grsai,
    usage,
    metrics,
    cfg,
    undefined as never,
    undefined as never,
    undefined as never,
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

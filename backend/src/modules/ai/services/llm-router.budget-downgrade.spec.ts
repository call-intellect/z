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

function makeOutput(provider: LlmCompleteOutput['provider'], model = 'm-test'): LlmCompleteOutput {
  return {
    text: `text-${provider}`,
    inputTokens: 100,
    outputTokens: 20,
    model,
    provider,
  };
}

function tierRow(opts: {
  taskType: string;
  tier: 'primary' | 'secondary' | 'tertiary';
  providerName: string;
  model: string;
  priority?: number;
  isActive?: boolean;
}) {
  return {
    id: `${opts.taskType}-${opts.tier}-${opts.providerName}`,
    taskType: opts.taskType,
    tenantId: null,
    providers: null,
    tier: opts.tier,
    priority: opts.priority ?? 0,
    providerName: opts.providerName,
    model: opts.model,
    editedByAdmin: false,
    experiment: null,
    isActive: opts.isActive ?? true,
    updatedAt: new Date(),
  };
}

interface Bev {
  over: boolean;
  mtdRub: number;
  capRub: number | null;
  capKind: string;
}

interface BuildOpts {
  rows: Array<ReturnType<typeof tierRow>>;
  bevSequence?: Array<Bev | undefined>;
  enforce?: boolean;
  deepseek?: ReturnType<typeof vi.fn>;
  openai?: ReturnType<typeof vi.fn>;
  ollama?: ReturnType<typeof vi.fn>;
  minimax?: ReturnType<typeof vi.fn>;
  anthropic?: ReturnType<typeof vi.fn>;
  kie?: ReturnType<typeof vi.fn>;
  grsai?: ReturnType<typeof vi.fn>;
}

function build(opts: BuildOpts) {
  const findMany = vi.fn(async () => opts.rows);
  const priceFindFirst = vi.fn(async () => null);

  const deepseek = {
    complete: opts.deepseek ?? vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash')),
  };
  const openai = {
    complete: opts.openai ?? vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5.5-pro')),
  };
  const ollama = {
    complete: opts.ollama ?? vi.fn(async () => makeOutput('ollama', 'qwen3.5:9b')),
  };
  const minimax = {
    complete: opts.minimax ?? vi.fn(async () => makeOutput('minimax', 'MiniMax-M2.5')),
  };
  const anthropic = {
    complete: opts.anthropic ?? vi.fn(async () => makeOutput('anthropic', 'claude-sonnet-4-6')),
  };
  const kie = { complete: opts.kie ?? vi.fn(async () => makeOutput('kie', 'gemini-3-pro')) };
  const grsai = { complete: opts.grsai ?? vi.fn(async () => makeOutput('grsai', 'gemini-3.1-pro')) };

  const byProviderName: Record<string, { complete: ReturnType<typeof vi.fn> }> = {
    deepseek,
    'openai-via-proxy': openai,
    ollama,
    minimax,
    anthropic,
    kie,
    grsai,
  };

  const prisma = {
    llmTaskRoute: { findMany, findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    llmModelPrice: { findFirst: priceFindFirst },
    llmModelExperiment: { findMany: vi.fn(async () => []) },
    llmProvider: {
      findMany: vi.fn(async () => Object.keys(byProviderName).map((name) => ({ name }))),
      count: vi.fn(async () => Object.keys(byProviderName).length),
    },
  } as unknown as PrismaService;

  const adapter = {
    complete: async ({
      provider,
      input,
    }: {
      provider: { name: string };
      input: LlmCompleteInput;
    }) => {
      const complete = byProviderName[provider.name]!.complete as unknown as (
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

  const usageRecord = vi.fn();
  const usage = { record: usageRecord } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const incCoreLlmNoProvider = vi.fn();
  const incLlmBudgetExceeded = vi.fn();
  const metrics = {
    incLlmRouterDispatch,
    incCoreLlmNoProvider,
    incLlmBudgetExceeded,
  } as unknown as BusinessMetricsService;

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'llm.budget.enforce_enabled') return opts.enforce ?? false;
    return def;
  });
  const cfg = {
    getDynamic,
    budget: { useProtocolAdapterRegistry: true },
    llmRouter: { dispatchTimeoutMs: 300_000 },
  } as unknown as TypedConfigService;

  const sequence = opts.bevSequence ?? [];
  let callIdx = 0;
  const evaluate = vi.fn(async () => {
    const bev = sequence[callIdx];
    callIdx += 1;
    return bev;
  });
  const budgetGuard =
    sequence.length === 0 ? undefined : ({ evaluate } as unknown as BudgetGuardService);

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
  return {
    router,
    findMany,
    deepseek,
    openai,
    ollama,
    minimax,
    anthropic,
    kie,
    grsai,
    usageRecord,
    incLlmBudgetExceeded,
    evaluate,
  };
}

const baseParams = {
  systemPrompt: 'sys',
  userMessage: 'u',
  tenantId: 't1' as string | null,
};

describe('LlmRouterService — экономный роутинг при over&&downgrade (llm-budget-downgrade-tier Ф2)', () => {
  it('over && capKind=downgrade, [дорогая primary, дешёвая secondary] → дёргается дешёвая, fallbackReason=budget_downgrade', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'summary',
          tier: 'primary',
          providerName: 'openai-via-proxy',
          model: 'gpt-5.5-pro',
        }),
        tierRow({
          taskType: 'summary',
          tier: 'secondary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
      ],
      bevSequence: [{ over: true, mtdRub: 100, capRub: 50, capKind: 'downgrade' }],
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });

    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('deepseek:deepseek-v4-flash');
    expect(ctx.incLlmBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'downgrade' }),
    );
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: 'budget_downgrade', success: true }),
    );
  });

  it('цепочка из ОДНОЙ модели → работает как обычно, fallbackReason=null (Р2 — не деградирует)', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'chapters',
          tier: 'primary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
      ],
      bevSequence: [{ over: true, mtdRub: 100, capRub: 50, capKind: 'downgrade' }],
    });
    await ctx.router.refreshCache();
    await ctx.router.call({ ...baseParams, taskType: 'chapters' as LlmTaskType });

    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: null, success: true }),
    );
  });

  it('обе модели цепочки с ОДИНАКОВОЙ ценой → порядок не меняется, fallbackReason=null', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'tasks',
          tier: 'primary',
          providerName: 'kie',
          model: 'gemini-3-pro',
        }),
        tierRow({
          taskType: 'tasks',
          tier: 'secondary',
          providerName: 'grsai',
          model: 'gemini-3.1-pro',
        }),
      ],
      bevSequence: [{ over: true, mtdRub: 100, capRub: 50, capKind: 'downgrade' }],
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'tasks' as LlmTaskType });

    expect(ctx.kie.complete).toHaveBeenCalledOnce();
    expect(ctx.grsai.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('kie:gemini-3-pro');
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: null, success: true }),
    );
  });

  it('over && capKind=hard, enforce_enabled=true → по-прежнему бросает LlmBudgetExceededError (регрессия)', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'summary',
          tier: 'primary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
      ],
      bevSequence: [{ over: true, mtdRub: 200, capRub: 100, capKind: 'hard' }],
      enforce: true,
    });
    await ctx.router.refreshCache();

    await expect(
      ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType }),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(ctx.incLlmBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'enforce' }),
    );
    expect(ctx.deepseek.complete).not.toHaveBeenCalled();
  });

  it('over && capKind=soft → по-прежнему НЕ блокирует, incLlmBudgetExceeded {mode:observe} (регрессия)', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'summary',
          tier: 'primary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
      ],
      bevSequence: [{ over: true, mtdRub: 200, capRub: 100, capKind: 'soft' }],
      enforce: false,
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });

    expect(ctx.incLlmBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'observe' }),
    );
    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('deepseek:deepseek-v4-flash');
  });

  it('дешёвая модель после reorder падает с ошибкой → цикл продолжает со следующей по цене', async () => {
    const failDeepseek = vi.fn(async () => {
      throw new Error('500 server boom');
    });
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'summary',
          tier: 'primary',
          providerName: 'openai-via-proxy',
          model: 'gpt-5.5-pro',
        }),
        tierRow({
          taskType: 'summary',
          tier: 'secondary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
        tierRow({
          taskType: 'summary',
          tier: 'tertiary',
          providerName: 'kie',
          model: 'gemini-3-pro',
        }),
      ],
      deepseek: failDeepseek,
      bevSequence: [{ over: true, mtdRub: 100, capRub: 50, capKind: 'downgrade' }],
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });

    expect(failDeepseek).toHaveBeenCalledOnce();
    expect(ctx.kie.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('kie:gemini-3-pro');
  });

  it('два последовательных call(): первый over&&downgrade реордерит, второй over=false использует ИСХОДНЫЙ порядок (не мутирует общий кэш)', async () => {
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'summary',
          tier: 'primary',
          providerName: 'openai-via-proxy',
          model: 'gpt-5.5-pro',
        }),
        tierRow({
          taskType: 'summary',
          tier: 'secondary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
        }),
      ],
      bevSequence: [
        { over: true, mtdRub: 100, capRub: 50, capKind: 'downgrade' },
        { over: false, mtdRub: 10, capRub: 50, capKind: 'downgrade' },
      ],
    });
    await ctx.router.refreshCache();

    const out1 = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });
    expect(out1.modelUsed).toBe('deepseek:deepseek-v4-flash');

    const out2 = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });
    expect(out2.modelUsed).toBe('openai-via-proxy:gpt-5.5-pro');
    expect(ctx.openai.complete).toHaveBeenCalledOnce();
    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
  });
});

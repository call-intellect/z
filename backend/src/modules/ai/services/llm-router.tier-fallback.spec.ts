/**
 * Фаза A.4 — unit-тесты на tier-fallback. Проверяем, что LlmRouterService
 * корректно собирает цепочку из нормализованных записей (tier+priority) и
 * пробует primary → secondary → tertiary в правильном порядке.
 *
 * Сценарии (≥3):
 *   1) Все tier'ы есть, primary успешен — secondary/tertiary не дёргаются.
 *   2) Primary падает, secondary успешен — в AiUsageLog.tier='secondary'
 *      и fallbackReason заполнен.
 *   3) Primary+secondary падают, tertiary успешен — в AiUsageLog.tier='tertiary'.
 *   4) Все 3 tier'а упали → incCoreLlmNoProvider + LlmRouterAllProvidersFailedError.
 */

import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import type { DeepSeekService } from './deepseek.service';
import type { GrsaiService } from './grsai.service';
import type { KieService } from './kie.service';
import {
  LlmRouterAllProvidersFailedError,
  LlmRouterService,
  type LlmTaskType,
} from './llm-router.service';
import type { LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OllamaService } from './ollama.service';
import type { OpenAiProxyService } from './openai-proxy.service';

function makeOutput(provider: LlmCompleteOutput['provider'], model = 'm-test'): LlmCompleteOutput {
  return {
    text: `text-${provider}`,
    inputTokens: 100,
    outputTokens: 20,
    model,
    provider,
  };
}

/**
 * Тестовая запись `LlmTaskRoute` с tier — имитирует то, что вернёт
 * `prisma.llmTaskRoute.findMany()`. Поля минимально-достаточные для роутера.
 */
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

interface BuildOpts {
  rows: Array<ReturnType<typeof tierRow>>;
  deepseek?: ReturnType<typeof vi.fn>;
  openai?: ReturnType<typeof vi.fn>;
  ollama?: ReturnType<typeof vi.fn>;
  minimax?: ReturnType<typeof vi.fn>;
  anthropic?: ReturnType<typeof vi.fn>;
}

function build(opts: BuildOpts) {
  const findMany = vi.fn(async () => opts.rows);
  const findFirst = vi.fn(async () => null);
  const priceFindFirst = vi.fn(async () => null);
  const prisma = {
    llmTaskRoute: { findMany, findFirst, create: vi.fn(), update: vi.fn() },
    llmModelPrice: { findFirst: priceFindFirst },
  } as unknown as PrismaService;

  const deepseek = {
    complete: opts.deepseek ?? vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash')),
  } as unknown as DeepSeekService;
  const openai = {
    complete: opts.openai ?? vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5-mini')),
  } as unknown as OpenAiProxyService;
  const ollama = {
    complete: opts.ollama ?? vi.fn(async () => makeOutput('ollama', 'qwen3.5:9b')),
  } as unknown as OllamaService;
  const minimax = {
    complete: opts.minimax ?? vi.fn(async () => makeOutput('minimax', 'MiniMax-M2.5')),
  } as unknown as MinimaxService;
  const anthropic = {
    complete: opts.anthropic ?? vi.fn(async () => makeOutput('anthropic', 'claude-sonnet-4-6')),
  } as unknown as AnthropicService;
  const kie = {
    complete: vi.fn(async () => makeOutput('kie', 'gemini-3-pro')),
  } as unknown as KieService;
  const grsai = {
    complete: vi.fn(async () => makeOutput('grsai', 'gemini-3-pro')),
  } as unknown as GrsaiService;

  const usageRecord = vi.fn();
  const usage = { record: usageRecord } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const incCoreLlmNoProvider = vi.fn();
  const metrics = {
    incLlmRouterDispatch,
    incCoreLlmNoProvider,
  } as unknown as BusinessMetricsService;

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
  );
  return {
    router,
    findMany,
    deepseek,
    openai,
    ollama,
    minimax,
    anthropic,
    usageRecord,
    incLlmRouterDispatch,
    incCoreLlmNoProvider,
  };
}

describe('LlmRouterService — tier-based fallback (Фаза A.4)', () => {
  const baseParams = {
    systemPrompt: 'sys',
    userMessage: 'u',
    tenantId: null as string | null,
  };

  it('tier-цепочка: primary успешен → secondary/tertiary НЕ дёргаются, AiUsageLog.tier=primary', async () => {
    const ctx = build({
      rows: [
        tierRow({ taskType: 'summary', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' }),
        tierRow({ taskType: 'summary', tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' }),
        tierRow({ taskType: 'summary', tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' }),
      ],
    });
    await ctx.router.refreshCache();
    await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });
    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).not.toHaveBeenCalled();
    expect(ctx.ollama.complete).not.toHaveBeenCalled();
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'primary', fallbackReason: null, success: true }),
    );
  });

  it('fallback primary→secondary: deepseek упал, openai сработал, tier=secondary + fallbackReason заполнен', async () => {
    const failDeepseek = vi.fn(async () => {
      throw new Error('500 server boom');
    });
    const ctx = build({
      rows: [
        tierRow({ taskType: 'summary', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' }),
        tierRow({ taskType: 'summary', tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' }),
        tierRow({ taskType: 'summary', tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' }),
      ],
      deepseek: failDeepseek,
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType });
    expect(failDeepseek).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).toHaveBeenCalledOnce();
    expect(ctx.ollama.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('openai-via-proxy:gpt-5-mini');
    // Успешная запись должна иметь tier='secondary' + fallbackReason='primary_server_5xx'.
    const successCalls = ctx.usageRecord.mock.calls.filter(
      (c) => (c[0] as { success: boolean }).success === true,
    );
    expect(successCalls).toHaveLength(1);
    const successCall = successCalls[0]?.[0] as { tier: string; fallbackReason: string | null };
    expect(successCall.tier).toBe('secondary');
    expect(successCall.fallbackReason).toMatch(/^primary_/);
  });

  it('fallback primary+secondary → tertiary: ollama сработал, tier=tertiary', async () => {
    const fail = vi.fn(async () => {
      throw new Error('timeout');
    });
    const ctx = build({
      rows: [
        tierRow({ taskType: 'chat-v2', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' }),
        tierRow({ taskType: 'chat-v2', tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' }),
        tierRow({ taskType: 'chat-v2', tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' }),
      ],
      deepseek: fail,
      openai: fail,
    });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });
    expect(out.modelUsed).toBe('ollama:qwen3.5:9b');
    const successCall = ctx.usageRecord.mock.calls
      .map((c) => c[0] as { success: boolean; tier: string; fallbackReason: string | null })
      .find((r) => r.success === true);
    expect(successCall?.tier).toBe('tertiary');
    expect(successCall?.fallbackReason).toMatch(/_(timeout|error)$/);
  });

  it('все 3 tier-а упали → LlmRouterAllProvidersFailedError + incCoreLlmNoProvider дёргается', async () => {
    const fail = vi.fn(async () => {
      throw new Error('rate-limit 429');
    });
    const ctx = build({
      rows: [
        tierRow({ taskType: 'summary', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' }),
        tierRow({ taskType: 'summary', tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' }),
        tierRow({ taskType: 'summary', tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' }),
      ],
      deepseek: fail,
      openai: fail,
      ollama: fail,
    });
    await ctx.router.refreshCache();
    await expect(
      ctx.router.call({ ...baseParams, taskType: 'summary' as LlmTaskType }),
    ).rejects.toBeInstanceOf(LlmRouterAllProvidersFailedError);
    expect(ctx.incCoreLlmNoProvider).toHaveBeenCalledWith({ taskType: 'summary' });
  });

  it('priority внутри tier: primary с priority=0 идёт раньше priority=1', async () => {
    const minimaxFn = vi.fn(async () => makeOutput('minimax', 'MiniMax-M2.5'));
    const ctx = build({
      rows: [
        tierRow({
          taskType: 'chapters',
          tier: 'primary',
          providerName: 'minimax',
          model: 'MiniMax-M2.5',
          priority: 0,
        }),
        tierRow({
          taskType: 'chapters',
          tier: 'primary',
          providerName: 'deepseek',
          model: 'deepseek-v4-flash',
          priority: 1,
        }),
      ],
      minimax: minimaxFn,
    });
    await ctx.router.refreshCache();
    await ctx.router.call({ ...baseParams, taskType: 'chapters' as LlmTaskType });
    expect(minimaxFn).toHaveBeenCalledOnce();
    expect(ctx.deepseek.complete).not.toHaveBeenCalled();
  });
});

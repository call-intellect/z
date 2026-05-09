import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import {
  LlmRouterAllProvidersFailedError,
  LlmRouterService,
  type LlmTaskType,
} from './llm-router.service';
import type { LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
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

interface BuildOpts {
  routes?: Array<{ taskType: string; providers: string[]; isActive: boolean }>;
  anthropic?: ReturnType<typeof vi.fn>;
  minimax?: ReturnType<typeof vi.fn>;
  openai?: ReturnType<typeof vi.fn>;
}

function build(opts: BuildOpts) {
  const findMany = vi.fn(async () =>
    (opts.routes ?? []).map((r, i) => ({
      id: `r-${i}`,
      taskType: r.taskType,
      providers: r.providers,
      isActive: r.isActive,
      updatedAt: new Date(),
    })),
  );
  const upsert = vi.fn(async (args: { create: { taskType: string; providers: string[]; isActive: boolean } }) => ({
    id: 'r-up',
    taskType: args.create.taskType,
    providers: args.create.providers,
    isActive: args.create.isActive,
    updatedAt: new Date(),
  }));
  const prisma = {
    llmTaskRoute: { findMany, upsert },
  } as unknown as PrismaService;

  const anthropic = {
    complete: opts.anthropic ?? vi.fn(async () => makeOutput('anthropic', 'claude-sonnet-4-6')),
  } as unknown as AnthropicService;
  const minimax = {
    complete: opts.minimax ?? vi.fn(async () => makeOutput('minimax', 'MiniMax-M2.5')),
  } as unknown as MinimaxService;
  const openai = {
    complete: opts.openai ?? vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5-mini')),
  } as unknown as OpenAiProxyService;

  const usageRecord = vi.fn();
  const usage = { record: usageRecord } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const metrics = { incLlmRouterDispatch } as unknown as BusinessMetricsService;

  const router = new LlmRouterService(prisma, anthropic, minimax, openai, usage, metrics);
  return { router, findMany, upsert, anthropic, minimax, openai, usageRecord, incLlmRouterDispatch };
}

describe('LlmRouterService', () => {
  const baseParams = {
    systemPrompt: 'sys',
    userMessage: 'u',
  };

  it('использует первый provider из route, если он есть', async () => {
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['minimax', 'anthropic'], isActive: true }],
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });

    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    expect(ctx.anthropic.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('minimax:MiniMax-M2.5');
    expect(ctx.usageRecord).toHaveBeenCalledOnce();
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'minimax', status: 'success' }),
    );
  });

  it('fallback: первый упал → второй сработал', async () => {
    const failingMinimax = vi.fn(async () => {
      throw new Error('boom-minimax');
    });
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['minimax', 'openai-via-proxy'], isActive: true }],
      minimax: failingMinimax,
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });

    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('openai-via-proxy:gpt-5-mini');
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'minimax', status: 'fallback' }),
    );
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-via-proxy', status: 'success' }),
    );
  });

  it('все упали → LlmRouterAllProvidersFailedError + status=failed на последнем', async () => {
    const fail = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['anthropic', 'minimax'], isActive: true }],
      anthropic: fail,
      minimax: fail,
    });
    await ctx.router.refreshCache();

    await expect(
      ctx.router.call({ ...baseParams, taskType: 'chapters' as LlmTaskType }),
    ).rejects.toBeInstanceOf(LlmRouterAllProvidersFailedError);
    // Последний — minimax (fallback chain).
    const failedCall = ctx.incLlmRouterDispatch.mock.calls.find(
      (c) => (c[0] as { status: string }).status === 'failed',
    );
    expect(failedCall?.[0]).toMatchObject({ provider: 'minimax', status: 'failed' });
  });

  it('нет route → используется дефолтная цепочка [anthropic,minimax,openai-via-proxy]', async () => {
    const ctx = build({ routes: [] });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'tasks' as LlmTaskType,
    });
    expect(ctx.anthropic.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('anthropic:claude-sonnet-4-6');
  });

  it('isActive=false → route игнорируется, используется дефолт', async () => {
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['minimax'], isActive: false }],
    });
    await ctx.router.refreshCache();
    await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });
    expect(ctx.minimax.complete).not.toHaveBeenCalled();
    expect(ctx.anthropic.complete).toHaveBeenCalledOnce();
  });

  it('AiUsageLog пишется на success', async () => {
    const ctx = build({});
    await ctx.router.refreshCache();
    await ctx.router.call({
      ...baseParams,
      taskType: 'summary' as LlmTaskType,
      meetingId: 'm-1',
      userId: 'u-1',
      jobId: 'j-1',
    });
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'm-1',
        agentType: 'summary',
        provider: 'anthropic',
        success: true,
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
  });

  it('setRoute: апсерт + инвалидация кэша', async () => {
    const ctx = build({});
    await ctx.router.refreshCache();
    await ctx.router.setRoute({
      taskType: 'tasks' as LlmTaskType,
      providers: ['minimax'],
      isActive: true,
    });
    expect(ctx.upsert).toHaveBeenCalledOnce();
    // refreshCache был дёрнут setRoute'ом — findMany вызван дважды (init + после setRoute).
    expect(ctx.findMany).toHaveBeenCalledTimes(2);
  });

  it('setRoute: без валидных провайдеров → ошибка', async () => {
    const ctx = build({});
    await expect(
      ctx.router.setRoute({
        taskType: 'tasks' as LlmTaskType,
        providers: ['unknown' as never],
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});

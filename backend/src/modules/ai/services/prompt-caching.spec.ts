import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import { buildSystemBlocks, buildUserContent } from './anthropic.service';
import type { DeepSeekService } from './deepseek.service';
import type { GrsaiService } from './grsai.service';
import type { KieService } from './kie.service';
import { LlmFallbackService } from './llm-fallback.service';
import { LlmRouterService, type LlmTaskType } from './llm-router.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OllamaService } from './ollama.service';
import type { OpenAiProxyService } from './openai-proxy.service';

/**
 * T7-F3 — prompt caching distribution tests.
 *
 * Покрытие:
 *   1. `buildUserContent` корректно превращает `{text, cacheControl: 'ephemeral'}`
 *      в Anthropic content-блок с `cache_control: { type: 'ephemeral' }`.
 *   2. `buildSystemBlocks` уже покрыт тестами в anthropic.service; здесь проверяем
 *      что user-блок имеет тот же контракт.
 *   3. `LlmRouterService.dispatch` гарантированно ставит `cacheControl: 'ephemeral'`
 *      на system message → провайдер видит флаг даже если caller не выставил.
 *   4. `LlmFallbackService.complete` тоже теперь делает это (parity с router).
 *   5. `LlmCompleteOutput.cachedTokens` и `cacheCreationTokens` пробрасываются
 *      через router в `AiUsageLogService.record`.
 */

describe('prompt caching: buildUserContent / buildSystemBlocks', () => {
  it('buildUserContent: string → string (legacy)', () => {
    expect(buildUserContent('hello')).toBe('hello');
  });

  it('buildUserContent: {text} без cacheControl → string', () => {
    expect(buildUserContent({ text: 'hello' })).toBe('hello');
  });

  it('buildUserContent: {text, cacheControl: "ephemeral"} → content-блок с cache_control', () => {
    const out = buildUserContent({
      text: 'large transcript here',
      cacheControl: 'ephemeral',
    });
    expect(out).toEqual([
      {
        type: 'text',
        text: 'large transcript here',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('buildSystemBlocks: с cacheControl → массив с cache_control', () => {
    const out = buildSystemBlocks({
      text: 'system prompt',
      cacheControl: 'ephemeral',
    });
    expect(out).toEqual([
      {
        type: 'text',
        text: 'system prompt',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('buildSystemBlocks: без cacheControl → строка (legacy)', () => {
    expect(buildSystemBlocks({ text: 'sys' })).toBe('sys');
  });
});

describe('LlmRouterService.dispatch: cacheControl на system всегда выставляется', () => {
  it('даже если caller передал systemPrompt как строку — провайдер получает {cacheControl: "ephemeral"}', async () => {
    // Spy на anthropic.complete — проверим, что input.system.cacheControl === 'ephemeral'.
    let capturedInput: LlmCompleteInput | null = null;
    const anthropicComplete = vi.fn(async (input: LlmCompleteInput) => {
      capturedInput = input;
      return {
        text: 'ok',
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 50,
        cacheCreationTokens: 25,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic' as const,
      } satisfies LlmCompleteOutput;
    });

    const prisma = {
      llmTaskRoute: {
        findMany: vi.fn(async () => [
          {
            id: 'r-1',
            taskType: 'block-ingest' as const,
            providers: ['anthropic'],
            isActive: true,
            tenantId: null,
            experiment: null,
            tier: null,
            providerName: null,
            priority: 0,
            requiredDataClass: null,
            updatedAt: new Date(),
          },
        ]),
        findFirst: vi.fn(),
      },
      llmModelPrice: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;

    const usageRecord = vi.fn();
    const usage = { record: usageRecord } as unknown as AiUsageLogService;
    const metrics = {
      incLlmRouterDispatch: vi.fn(),
      incCoreLlmNoProvider: vi.fn(),
    } as unknown as BusinessMetricsService;

    const router = new LlmRouterService(
      prisma,
      { complete: anthropicComplete } as unknown as AnthropicService,
      { complete: vi.fn() } as unknown as MinimaxService,
      { complete: vi.fn() } as unknown as OpenAiProxyService,
      { complete: vi.fn() } as unknown as DeepSeekService,
      { complete: vi.fn() } as unknown as OllamaService,
      { complete: vi.fn() } as unknown as KieService,
      { complete: vi.fn() } as unknown as GrsaiService,
      usage,
      metrics,
    );
    await router.refreshCache();

    await router.call({
      taskType: 'block-ingest' as LlmTaskType,
      systemPrompt: 'You extract knowledge blocks from transcripts.',
      userMessage: 'transcript text here…',
      tenantId: null,
    });

    expect(anthropicComplete).toHaveBeenCalledOnce();
    expect(capturedInput).not.toBeNull();
    expect(capturedInput!.system.cacheControl).toBe('ephemeral');
  });

  it('cachedTokens и cacheCreationTokens пробрасываются в AiUsageLogService.record', async () => {
    const usageRecord = vi.fn();
    const anthropicComplete = vi.fn(async () => ({
      text: 'ok',
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 800, // cache hit
      cacheCreationTokens: 200, // cache write
      model: 'claude-sonnet-4-6',
      provider: 'anthropic' as const,
    }));

    const prisma = {
      llmTaskRoute: {
        findMany: vi.fn(async () => [
          {
            id: 'r-1',
            taskType: 'summary' as const,
            providers: ['anthropic'],
            isActive: true,
            tenantId: null,
            experiment: null,
            tier: null,
            providerName: null,
            priority: 0,
            requiredDataClass: null,
            updatedAt: new Date(),
          },
        ]),
        findFirst: vi.fn(),
      },
      llmModelPrice: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;

    const router = new LlmRouterService(
      prisma,
      { complete: anthropicComplete } as unknown as AnthropicService,
      { complete: vi.fn() } as unknown as MinimaxService,
      { complete: vi.fn() } as unknown as OpenAiProxyService,
      { complete: vi.fn() } as unknown as DeepSeekService,
      { complete: vi.fn() } as unknown as OllamaService,
      { complete: vi.fn() } as unknown as KieService,
      { complete: vi.fn() } as unknown as GrsaiService,
      { record: usageRecord } as unknown as AiUsageLogService,
      {
        incLlmRouterDispatch: vi.fn(),
        incCoreLlmNoProvider: vi.fn(),
      } as unknown as BusinessMetricsService,
    );
    await router.refreshCache();

    await router.call({
      taskType: 'summary' as LlmTaskType,
      systemPrompt: 'sys',
      userMessage: 'u',
      tenantId: 'org-1',
    });

    expect(usageRecord).toHaveBeenCalledOnce();
    const recorded = usageRecord.mock.calls[0]![0] as {
      cachedTokens: number;
      cacheCreationTokens: number;
    };
    expect(recorded.cachedTokens).toBe(800);
    expect(recorded.cacheCreationTokens).toBe(200);
  });
});

describe('LlmFallbackService.complete: cacheControl на system выставляется автоматически', () => {
  it('caller передал system без cacheControl → anthropic.complete получает cacheControl: "ephemeral"', async () => {
    let captured: LlmCompleteInput | null = null;
    const anthropic = {
      complete: vi.fn(async (input: LlmCompleteInput) => {
        captured = input;
        return {
          text: 'ok',
          inputTokens: 10,
          outputTokens: 5,
          model: 'claude-sonnet-4-6',
          provider: 'anthropic' as const,
        } satisfies LlmCompleteOutput;
      }),
    } as unknown as AnthropicService;
    const minimax = { complete: vi.fn() } as unknown as MinimaxService;
    const openai = { complete: vi.fn() } as unknown as OpenAiProxyService;

    const fallback = new LlmFallbackService(anthropic, minimax, openai);

    await fallback.complete({
      system: { text: 'sys prompt' },
      user: 'user msg',
    });

    expect(captured).not.toBeNull();
    expect(captured!.system.cacheControl).toBe('ephemeral');
    expect(captured!.system.text).toBe('sys prompt'); // не изменили текст
  });

  it('caller уже передал system.cacheControl → не перезаписываем', async () => {
    // Edge case: если caller сам решил НЕ кешировать (для каких-то A/B-тестов),
    // эта семантика сейчас невыразима (тип `'ephemeral'` единственный), но
    // защищаем сценарий «caller явно поставил ephemeral» — проверяем что
    // не наслаиваем второй раз (тип всё равно тот же).
    let captured: LlmCompleteInput | null = null;
    const anthropic = {
      complete: vi.fn(async (input: LlmCompleteInput) => {
        captured = input;
        return {
          text: 'ok',
          inputTokens: 10,
          outputTokens: 5,
          model: 'claude-sonnet-4-6',
          provider: 'anthropic' as const,
        } satisfies LlmCompleteOutput;
      }),
    } as unknown as AnthropicService;
    const minimax = { complete: vi.fn() } as unknown as MinimaxService;
    const openai = { complete: vi.fn() } as unknown as OpenAiProxyService;

    const fallback = new LlmFallbackService(anthropic, minimax, openai);

    await fallback.complete({
      system: { text: 'sys prompt', cacheControl: 'ephemeral' },
      user: 'user msg',
    });

    expect(captured).not.toBeNull();
    expect(captured!.system.cacheControl).toBe('ephemeral');
  });
});

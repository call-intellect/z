/**
 * ТЗ 2026-07-02-llm-providers-models-routing-admin — Фаза 10, R19.
 *
 * Доказывает конец-в-конец: DB-провайдер с РЕАЛЬНО зашифрованным ключом
 * (настоящий CryptoService.encrypt/decrypt, не мок) → LlmRouterService.call()
 * уходит на его baseUrl с расшифрованным ключом. Real Postgres не нужен —
 * Prisma и внешний HTTP (пакет `openai`) мокированы на границе; всё
 * остальное (CryptoService, ProviderInfoResolver, LlmProtocolAdapterRegistry,
 * OpenAiChatProtocolAdapter, LlmRouterService) — реальные классы, как в
 * analyze-worker-with-resolver.integration.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../src/common/config/index';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../src/common/metrics/business-metrics.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { AiUsageLogService } from '../../src/modules/ai/services/ai-usage-log.service';
import type { AnthropicService } from '../../src/modules/ai/services/anthropic.service';
import type { DeepSeekService } from '../../src/modules/ai/services/deepseek.service';
import type { GrsaiService } from '../../src/modules/ai/services/grsai.service';
import type { KieService } from '../../src/modules/ai/services/kie.service';
import { LlmRouterService, type LlmTaskType } from '../../src/modules/ai/services/llm-router.service';
import type { MinimaxService } from '../../src/modules/ai/services/minimax.service';
import type { OllamaService } from '../../src/modules/ai/services/ollama.service';
import type { OpenAiProxyService } from '../../src/modules/ai/services/openai-proxy.service';
import { AnthropicMessagesProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/custom-http.adapter';
import { GrsaiProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/grsai-native.adapter';
import { KieProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/kie-native.adapter';
import { OllamaNativeProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/ollama-native.adapter';
import { OpenAiChatProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/openai-chat.adapter';
import { OpenAiResponsesProtocolAdapter } from '../../src/modules/ai/services/protocol-adapter/adapters/openai-responses.adapter';
import { LlmProtocolAdapterRegistry } from '../../src/modules/ai/services/protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from '../../src/modules/ai/services/protocol-adapter/provider-info.resolver';

interface CapturedOpenAiCtor {
  opts: { baseURL?: string; apiKey?: string } | null;
}
const captured: CapturedOpenAiCtor = { opts: null };

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat: { completions: { create: ReturnType<typeof vi.fn> } };
      constructor(opts: { baseURL?: string; apiKey?: string }) {
        captured.opts = opts;
        this.chat = {
          completions: {
            create: vi.fn(async () => ({
              choices: [{ message: { content: 'ok-from-db-provider' } }],
              usage: { prompt_tokens: 10, completion_tokens: 2 },
            })),
          },
        };
      }
    },
  };
});

describe('LlmProvider из БД с реальным шифрованием → LlmRouterService.call() (Ф10, R19)', () => {
  it('encrypt(plaintext) в create → decrypt в резолвере → dispatch уходит на DB baseUrl/ключ, не на ENV', async () => {
    // 32 байта base64 — валидный CRYPTO_MASTER_KEY для настоящего CryptoService.
    const masterKey = Buffer.alloc(32, 7).toString('base64');
    const crypto = new CryptoService({
      crypto: { masterKey },
    } as unknown as TypedConfigService);

    const plaintextApiKey = 'sk-real-db-secret-do-not-log';
    const encrypted = crypto.encrypt(plaintextApiKey);
    expect(encrypted.startsWith('gcm:v1:')).toBe(true);
    expect(encrypted).not.toContain(plaintextApiKey);

    const dbRow = {
      name: 'deepseek',
      baseUrl: 'https://db-configured.example.com/v1',
      apiKeyEncrypted: encrypted,
      protocolKind: 'openai-chat',
      defaultHeaders: null,
      useProxy: false,
      proxyPath: null,
      timeoutMs: null,
      capability: 'internal',
      defaultModelKey: null,
    };
    const findUnique = vi.fn(async () => dbRow);
    const prismaForResolver = { llmProvider: { findUnique } } as unknown as PrismaService;
    const cfgForResolver = {
      ai: {
        proxy: { baseUrl: 'https://proxy.test/v1', prefix: 'testprefix' },
        anthropic: { apiKey: 'env-key', model: 'm', useProxy: false, proxyUrl: '' },
        minimax: { apiKey: 'env-key', baseUrl: 'https://minimax.test' },
        openai: { apiKey: 'env-key' },
        deepseek: {
          apiKey: 'ENV-KEY-MUST-NOT-BE-USED',
          baseUrl: 'https://ENV-BASEURL-MUST-NOT-BE-USED.example.com',
          defaultModel: 'ds-env-default',
        },
        ollama: { apiKey: '', baseUrl: 'https://ollama.test' },
        kie: { apiKey: 'env-key', baseUrl: 'https://kie.test', timeoutMs: 180_000 },
        grsai: { apiKey: 'env-key', baseUrl: 'https://grsai.test' },
      },
    } as unknown as TypedConfigService;

    const providerInfo = new ProviderInfoResolver(prismaForResolver, cfgForResolver, crypto);

    const anthropicSvc = { complete: vi.fn() } as unknown as AnthropicService;
    const minimaxSvc = { complete: vi.fn() } as unknown as MinimaxService;
    const openaiSvc = { complete: vi.fn() } as unknown as OpenAiProxyService;
    const deepseekSvc = { complete: vi.fn() } as unknown as DeepSeekService;
    const ollamaSvc = { complete: vi.fn() } as unknown as OllamaService;
    const kieSvc = { complete: vi.fn() } as unknown as KieService;
    const grsaiSvc = { complete: vi.fn() } as unknown as GrsaiService;

    const registry = new LlmProtocolAdapterRegistry(
      new OpenAiChatProtocolAdapter(cfgForResolver, undefined),
      new OpenAiResponsesProtocolAdapter(openaiSvc),
      new AnthropicMessagesProtocolAdapter(anthropicSvc, minimaxSvc),
      new OllamaNativeProtocolAdapter(ollamaSvc),
      new KieProtocolAdapter(kieSvc),
      new GrsaiProtocolAdapter(grsaiSvc),
      new CustomHttpProtocolAdapter(),
    );

    const cfgForRouter = {
      budget: { useProtocolAdapterRegistry: true },
      llmRouter: { dispatchTimeoutMs: 300_000 },
    } as unknown as TypedConfigService;

    const findManyRoutes = vi.fn(async () => [
      {
        id: 'r-1',
        taskType: 'chat-v2',
        providers: ['deepseek'],
        isActive: true,
        tenantId: null,
        experiment: null,
        updatedAt: new Date(),
      },
    ]);
    const prismaForRouter = {
      llmTaskRoute: {
        findMany: findManyRoutes,
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(),
      },
      llmModelPrice: { findFirst: vi.fn(async () => null) },
      llmModelExperiment: { findMany: vi.fn(async () => []) },
      llmProvider: { findUnique },
    } as unknown as PrismaService;

    const usageRecord = vi.fn();
    const usage = { record: usageRecord } as unknown as AiUsageLogService;
    const metrics = {
      incLlmRouterDispatch: vi.fn(),
      incCoreDataClassViolation: vi.fn(),
      incLlmCostUnpriced: vi.fn(),
      incCoreLlmNoProvider: vi.fn(),
      incLlmBudgetExceeded: vi.fn(),
      incLlmThinkingModelGuard: vi.fn(),
      incDeepseekSchemaToToolConversion: vi.fn(),
    } as unknown as BusinessMetricsService;

    const router = new LlmRouterService(
      prismaForRouter,
      anthropicSvc,
      minimaxSvc,
      openaiSvc,
      deepseekSvc,
      ollamaSvc,
      kieSvc,
      grsaiSvc,
      usage,
      metrics,
      cfgForRouter,
      registry,
      providerInfo,
    );

    await router.refreshCache();
    captured.opts = null;
    const out = await router.call({
      systemPrompt: 'sys',
      userMessage: 'u',
      tenantId: null,
      taskType: 'chat-v2' as LlmTaskType,
    });

    // Легаси DeepSeekService НЕ вызван — openai-chat адаптер строит клиент сам.
    expect(deepseekSvc.complete).not.toHaveBeenCalled();

    // Реально расшифрованный ключ и DB baseUrl дошли до HTTP-клиента — не ENV.
    const ctorOpts = captured.opts as { baseURL?: string; apiKey?: string } | null;
    if (ctorOpts === null) throw new Error('OpenAI-клиент не был сконструирован');
    expect(ctorOpts.apiKey).toBe(plaintextApiKey);
    expect(ctorOpts.baseURL).toBe('https://db-configured.example.com/v1');
    expect(ctorOpts.apiKey).not.toBe('ENV-KEY-MUST-NOT-BE-USED');
    expect(ctorOpts.baseURL).not.toContain('ENV-BASEURL-MUST-NOT-BE-USED');

    expect(out.text).toBe('ok-from-db-provider');
    expect(out.providerUsed).toBe('deepseek');
    expect(usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek', success: true }),
    );
  });
});

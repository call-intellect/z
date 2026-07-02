import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import type { DeepSeekService } from './deepseek.service';
import type { GrsaiService } from './grsai.service';
import type { KieService } from './kie.service';
import { LlmRouterService, type LlmTaskType } from './llm-router.service';
import type { LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OllamaService } from './ollama.service';
import type { OpenAiProxyService } from './openai-proxy.service';
import { AnthropicMessagesProtocolAdapter } from './protocol-adapter/adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from './protocol-adapter/adapters/custom-http.adapter';
import { GrsaiProtocolAdapter } from './protocol-adapter/adapters/grsai-native.adapter';
import { KieProtocolAdapter } from './protocol-adapter/adapters/kie-native.adapter';
import { OllamaNativeProtocolAdapter } from './protocol-adapter/adapters/ollama-native.adapter';
import { OpenAiChatProtocolAdapter } from './protocol-adapter/adapters/openai-chat.adapter';
import { OpenAiResponsesProtocolAdapter } from './protocol-adapter/adapters/openai-responses.adapter';
import { LlmProtocolAdapterRegistry } from './protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

/**
 * protocolKind='openai-chat' (используется для deepseek через buildFromEnv, см.
 * provider-info.resolver.ts) — единственный из 7 легаси-провайдеров, чей
 * адаптер (OpenAiChatProtocolAdapter) НЕ делегирует в легаси-сервис
 * (DeepSeekService), а строит свой OpenAI-SDK клиент напрямую из
 * ProviderInfo. Поэтому DeepSeekService.complete в registry-ветке не
 * вызывается вообще — 'openai' мокается здесь, чтобы перехватить этот
 * прямой вызов и проверить, что connection-параметры совпадают с
 * buildFromEnv('deepseek'), не проверяя тождество вызываемого объекта.
 */
let lastOpenAiCtorOpts: unknown = null;
const DEFAULT_OPENAI_CHAT_TEXT = 'text-deepseek-via-openai-chat';

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat: { completions: { create: ReturnType<typeof vi.fn> } };
      responses: { create: ReturnType<typeof vi.fn> };
      constructor(opts: unknown) {
        lastOpenAiCtorOpts = opts;
        this.chat = {
          completions: {
            create: vi.fn(async () => ({
              choices: [{ message: { content: DEFAULT_OPENAI_CHAT_TEXT } }],
              usage: { prompt_tokens: 50, completion_tokens: 10 },
            })),
          },
        };
        this.responses = {
          create: vi.fn(async () => ({ output_text: '', output: [], usage: {} })),
        };
      }
    },
  };
});

type LegacyKey = 'anthropic' | 'minimax' | 'openai' | 'deepseek' | 'ollama' | 'kie' | 'grsai';

function emptySpies(): Record<LegacyKey, ReturnType<typeof vi.fn>> {
  return {
    anthropic: vi.fn(),
    minimax: vi.fn(),
    openai: vi.fn(),
    deepseek: vi.fn(),
    ollama: vi.fn(),
    kie: vi.fn(),
    grsai: vi.fn(),
  };
}

/**
 * Общий fake-cfg — источник правды и для buildFromEnv (ProviderInfoResolver),
 * и для ожидаемых значений override в assertions. Значения произвольны, но
 * согласованы между собой (тест эквивалентности ДВУХ ПУТЕЙ через ОДИН cfg,
 * а не сверка с реальным ENV).
 */
function makeCfg(): TypedConfigService {
  return {
    budget: { useProtocolAdapterRegistry: true },
    llmRouter: { dispatchTimeoutMs: 300_000 },
    ai: {
      proxy: { baseUrl: 'https://proxy.test/v1', prefix: 'testprefix' },
      anthropic: { apiKey: 'anthropic-key', model: 'claude-test', useProxy: false, proxyUrl: '' },
      minimax: { apiKey: 'minimax-key', baseUrl: 'https://minimax.test' },
      openai: { apiKey: 'openai-key' },
      deepseek: { apiKey: 'deepseek-key', baseUrl: 'https://deepseek.test', defaultModel: 'ds-test' },
      ollama: { apiKey: '', baseUrl: 'https://ollama.test' },
      kie: { apiKey: 'kie-key', baseUrl: 'https://kie.test', timeoutMs: 180_000 },
      grsai: { apiKey: 'grsai-key', baseUrl: 'https://grsai.test' },
    },
  } as unknown as TypedConfigService;
}

function makeCryptoNoop(): CryptoService {
  return {
    isEncrypted: vi.fn(() => false),
    decrypt: vi.fn((v: string) => v),
  } as unknown as CryptoService;
}

function makeOutput(provider: LlmCompleteOutput['provider'], model = 'm-test'): LlmCompleteOutput {
  return { text: `text-${provider}`, inputTokens: 100, outputTokens: 20, model, provider };
}

/**
 * Строит роутер, разделяющий ОДНИ И ТЕ ЖЕ spy-моки легаси-сервисов между
 * legacy-веткой (registryOn=false) и registry-веткой (registryOn=true) —
 * если оба пути зовут ОДИН И ТОТ ЖЕ мок с одинаковым результатом, разница
 * в поведении может быть ТОЛЬКО в том, ЧТО и С КАКИМИ АРГУМЕНТАМИ вызвано,
 * а не в остальной логике роутера (fallback/dataClass/usage-log/metrics).
 */
function buildRouter(opts: {
  registryOn: boolean;
  spies: Record<LegacyKey, ReturnType<typeof vi.fn>>;
  providers: string[];
}) {
  const findMany = vi.fn(async () => [
    {
      id: 'r-1',
      taskType: 'chat-v2',
      providers: opts.providers,
      isActive: true,
      tenantId: null,
      experiment: null,
      updatedAt: new Date(),
    },
  ]);
  const priceFindFirst = vi.fn(async () => null);
  const llmProviderFindUnique = vi.fn(async () => null); // всегда null → резолвер падает в buildFromEnv
  const prisma = {
    llmTaskRoute: { findMany, findFirst: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
    llmModelPrice: { findFirst: priceFindFirst },
    llmProvider: { findUnique: llmProviderFindUnique },
  } as unknown as PrismaService;

  const anthropicSvc = { complete: opts.spies.anthropic } as unknown as AnthropicService;
  const minimaxSvc = { complete: opts.spies.minimax } as unknown as MinimaxService;
  const openaiSvc = { complete: opts.spies.openai } as unknown as OpenAiProxyService;
  const deepseekSvc = { complete: opts.spies.deepseek } as unknown as DeepSeekService;
  const ollamaSvc = { complete: opts.spies.ollama } as unknown as OllamaService;
  const kieSvc = { complete: opts.spies.kie } as unknown as KieService;
  const grsaiSvc = { complete: opts.spies.grsai } as unknown as GrsaiService;

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

  const cfg = makeCfg();
  const crypto = makeCryptoNoop();
  const providerInfo = new ProviderInfoResolver(prisma, cfg, crypto);

  const anthropicMessagesAdapter = new AnthropicMessagesProtocolAdapter(anthropicSvc, minimaxSvc);
  const ollamaNativeAdapter = new OllamaNativeProtocolAdapter(ollamaSvc);
  const kieNativeAdapter = new KieProtocolAdapter(kieSvc);
  const grsaiNativeAdapter = new GrsaiProtocolAdapter(grsaiSvc);
  // deepseek резолвится в protocolKind='openai-chat' (buildFromEnv) — адаптер
  // самодостаточен, НЕ принимает legacy-сервис в конструкторе.
  const openaiChatAdapter = new OpenAiChatProtocolAdapter(cfg, undefined);
  const openaiResponsesAdapter = new OpenAiResponsesProtocolAdapter(openaiSvc);
  const customHttpAdapter = new CustomHttpProtocolAdapter();
  const registry = new LlmProtocolAdapterRegistry(
    openaiChatAdapter,
    openaiResponsesAdapter,
    anthropicMessagesAdapter,
    ollamaNativeAdapter,
    kieNativeAdapter,
    grsaiNativeAdapter,
    customHttpAdapter,
  );

  const router = new LlmRouterService(
    prisma,
    anthropicSvc,
    minimaxSvc,
    openaiSvc,
    deepseekSvc,
    ollamaSvc,
    kieSvc,
    grsaiSvc,
    usage,
    metrics,
    opts.registryOn ? cfg : undefined,
    opts.registryOn ? registry : undefined,
    opts.registryOn ? providerInfo : undefined,
  );
  return { router, usageRecord, prisma };
}

const baseParams = {
  systemPrompt: 'sys',
  userMessage: 'u',
  tenantId: null as string | null,
};

interface DelegatingCase {
  providerName: 'anthropic' | 'minimax' | 'openai-via-proxy' | 'ollama' | 'kie' | 'grsai';
  legacyServiceKey: LegacyKey;
  expectedBaseUrl: string;
  expectedApiKey: string | null;
}

/**
 * 6 из 7 легаси-провайдеров, чьи адаптеры делегируют в легаси-сервис с
 * connection-override (Б9, Ф3): AnthropicMessages/OllamaNative/KieNative/
 * GrsaiNative/OpenAiResponses. deepseek — 7-й провайдер — тестируется
 * отдельным блоком ниже (protocolKind='openai-chat' самодостаточен, не
 * делегирует).
 */
const CASES: DelegatingCase[] = [
  {
    providerName: 'anthropic',
    legacyServiceKey: 'anthropic',
    expectedBaseUrl: 'https://api.anthropic.com',
    expectedApiKey: 'anthropic-key',
  },
  {
    providerName: 'minimax',
    legacyServiceKey: 'minimax',
    expectedBaseUrl: 'https://minimax.test',
    expectedApiKey: 'minimax-key',
  },
  {
    providerName: 'openai-via-proxy',
    legacyServiceKey: 'openai',
    expectedBaseUrl: 'https://proxy.test/v1',
    // Легаси OpenAiProxyService ВСЕГДА префиксует ключ `${PROXY_PREFIX}:${key}`
    // (см. его конструктор) — buildFromEnv обязан вернуть тот же готовый ключ
    // (исправлено в этой фазе, см. provider-info.resolver.ts).
    expectedApiKey: 'testprefix:openai-key',
  },
  {
    providerName: 'ollama',
    legacyServiceKey: 'ollama',
    expectedBaseUrl: 'https://ollama.test',
    // cfg.ai.ollama.apiKey='' → buildFromEnv возвращает `'' || null` = null.
    expectedApiKey: null,
  },
  {
    providerName: 'kie',
    legacyServiceKey: 'kie',
    expectedBaseUrl: 'https://kie.test',
    expectedApiKey: 'kie-key',
  },
  {
    providerName: 'grsai',
    legacyServiceKey: 'grsai',
    expectedBaseUrl: 'https://grsai.test',
    expectedApiKey: 'grsai-key',
  },
];

describe('Фаза 4 — parity: registry-путь эквивалентен legacy-switch для всех 7 провайдеров', () => {
  for (const c of CASES) {
    describe(`провайдер=${c.providerName}`, () => {
      it('вызывает ТОТ ЖЕ легаси-сервис (переключение протокола не меняет, КОГО зовём)', async () => {
        const spy = vi.fn(async () => makeOutput(c.providerName));
        const spies = { ...emptySpies(), [c.legacyServiceKey]: spy };
        const legacy = buildRouter({ registryOn: false, spies, providers: [c.providerName] });
        await legacy.router.refreshCache();
        await legacy.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        const spy2 = vi.fn(async () => makeOutput(c.providerName));
        const spies2 = { ...emptySpies(), [c.legacyServiceKey]: spy2 };
        const registryRouter = buildRouter({ registryOn: true, spies: spies2, providers: [c.providerName] });
        await registryRouter.router.refreshCache();
        await registryRouter.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        expect(spy).toHaveBeenCalledOnce();
        expect(spy2).toHaveBeenCalledOnce();
      });

      it('legacy: вызов БЕЗ override (1 аргумент)', async () => {
        const spy = vi.fn(async () => makeOutput(c.providerName));
        const spies = { ...emptySpies(), [c.legacyServiceKey]: spy };
        const ctx = buildRouter({ registryOn: false, spies, providers: [c.providerName] });
        await ctx.router.refreshCache();
        await ctx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        expect(spy.mock.calls[0]).toHaveLength(1);
      });

      it('registry: вызов С override, baseUrl/apiKey совпадают с ожидаемыми из buildFromEnv', async () => {
        const spy = vi.fn(async () => makeOutput(c.providerName));
        const spies = { ...emptySpies(), [c.legacyServiceKey]: spy };
        const ctx = buildRouter({ registryOn: true, spies, providers: [c.providerName] });
        await ctx.router.refreshCache();
        await ctx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        expect(spy).toHaveBeenCalledOnce();
        const call = spy.mock.calls[0] as unknown[];
        expect(call).toHaveLength(2);
        const override = call[1] as { baseUrl: string; apiKey: string | null };
        expect(override.baseUrl).toBe(c.expectedBaseUrl);
        expect(override.apiKey).toBe(c.expectedApiKey);
      });

      it('итоговый результат router.call() идентичен в обеих ветках (modelUsed/providerUsed/text)', async () => {
        const output = makeOutput(c.providerName, 'shared-model');
        const spyA = vi.fn(async () => output);
        const spiesA = { ...emptySpies(), [c.legacyServiceKey]: spyA };
        const legacy = buildRouter({ registryOn: false, spies: spiesA, providers: [c.providerName] });
        await legacy.router.refreshCache();
        const outA = await legacy.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        const spyB = vi.fn(async () => output);
        const spiesB = { ...emptySpies(), [c.legacyServiceKey]: spyB };
        const registryRouter = buildRouter({ registryOn: true, spies: spiesB, providers: [c.providerName] });
        await registryRouter.router.refreshCache();
        const outB = await registryRouter.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

        expect(outA.modelUsed).toBe(outB.modelUsed);
        expect(outA.providerUsed).toBe(outB.providerUsed);
        expect(outA.text).toBe(outB.text);
      });
    });
  }

  describe('провайдер=deepseek (особый случай: protocolKind=openai-chat самодостаточен, НЕ делегирует в DeepSeekService)', () => {
    it('legacy: вызывает DeepSeekService.complete(input) напрямую, 1 аргумент (без override)', async () => {
      const spy = vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash'));
      const spies = { ...emptySpies(), deepseek: spy };
      const ctx = buildRouter({ registryOn: false, spies, providers: ['deepseek'] });
      await ctx.router.refreshCache();
      const out = await ctx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]).toHaveLength(1);
      expect(out.providerUsed).toBe('deepseek');
    });

    it('registry: НЕ вызывает легаси DeepSeekService — openai-chat строит собственный OpenAI-клиент по buildFromEnv(deepseek)', async () => {
      lastOpenAiCtorOpts = null;
      const spy = vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash'));
      const spies = { ...emptySpies(), deepseek: spy };
      const ctx = buildRouter({ registryOn: true, spies, providers: ['deepseek'] });
      await ctx.router.refreshCache();
      const out = await ctx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

      expect(spy).not.toHaveBeenCalled();
      expect(lastOpenAiCtorOpts).toMatchObject({
        baseURL: 'https://deepseek.test',
        apiKey: 'deepseek-key',
      });
      expect(out.providerUsed).toBe('deepseek');
      expect(out.text).toBe(DEFAULT_OPENAI_CHAT_TEXT);
    });

    it('обе ветки успешно завершают router.call() для одного и того же route (поведенческая эквивалентность верхнего уровня)', async () => {
      const spyLegacy = vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash'));
      const legacy = buildRouter({
        registryOn: false,
        spies: { ...emptySpies(), deepseek: spyLegacy },
        providers: ['deepseek'],
      });
      await legacy.router.refreshCache();
      const outLegacy = await legacy.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

      const registryCtx = buildRouter({
        registryOn: true,
        spies: emptySpies(),
        providers: ['deepseek'],
      });
      await registryCtx.router.refreshCache();
      const outRegistry = await registryCtx.router.call({
        ...baseParams,
        taskType: 'chat-v2' as LlmTaskType,
      });

      expect(outLegacy.providerUsed).toBe('deepseek');
      expect(outRegistry.providerUsed).toBe('deepseek');
      expect(outLegacy.tier).toBe('primary');
      expect(outRegistry.tier).toBe('primary');
      expect(outLegacy.text.length).toBeGreaterThan(0);
      expect(outRegistry.text.length).toBeGreaterThan(0);
    });

    it('AiUsageLog.provider = "deepseek" в обеих ветках (атрибуция usage не ломается сменой пути диспатча)', async () => {
      const spyLegacy = vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash'));
      const legacy = buildRouter({
        registryOn: false,
        spies: { ...emptySpies(), deepseek: spyLegacy },
        providers: ['deepseek'],
      });
      await legacy.router.refreshCache();
      await legacy.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

      const registryCtx = buildRouter({
        registryOn: true,
        spies: emptySpies(),
        providers: ['deepseek'],
      });
      await registryCtx.router.refreshCache();
      await registryCtx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

      expect(legacy.usageRecord).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'deepseek', success: true }),
      );
      expect(registryCtx.usageRecord).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'deepseek', success: true }),
      );
    });
  });

  it('fallback: primary(anthropic) падает с 429 → secondary(deepseek) срабатывает, classifyError одинаково классифицирует ошибку в обеих ветках (fallbackReason содержит rate_limit в обеих)', async () => {
    const legacySpies = {
      ...emptySpies(),
      anthropic: vi.fn(async () => {
        throw new Error('429 rate limited');
      }),
      deepseek: vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash')),
    };
    const legacy = buildRouter({
      registryOn: false,
      spies: legacySpies,
      providers: ['anthropic', 'deepseek'],
    });
    await legacy.router.refreshCache();
    await legacy.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

    const registrySpies = {
      ...emptySpies(),
      anthropic: vi.fn(async () => {
        throw new Error('429 rate limited');
      }),
      // deepseek идёт через openai-chat (см. блок выше, не вызывает
      // легаси-сервис) — FakeOpenAI мок отдаёт успешный ответ по умолчанию.
    };
    const registryCtx = buildRouter({
      registryOn: true,
      spies: registrySpies,
      providers: ['anthropic', 'deepseek'],
    });
    await registryCtx.router.refreshCache();
    await registryCtx.router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

    type UsageCall = { fallbackReason: string | null; success: boolean };
    const legacyRecord = legacy.usageRecord.mock.calls.find(
      (call) => (call[0] as UsageCall).fallbackReason,
    )?.[0] as UsageCall | undefined;
    const registryRecord = registryCtx.usageRecord.mock.calls.find(
      (call) => (call[0] as UsageCall).fallbackReason,
    )?.[0] as UsageCall | undefined;

    expect(legacyRecord).toBeDefined();
    expect(registryRecord).toBeDefined();
    expect(legacyRecord?.success).toBe(true);
    expect(registryRecord?.success).toBe(true);
    expect(legacyRecord?.fallbackReason).toContain('rate_limit');
    expect(registryRecord?.fallbackReason).toContain('rate_limit');
  });
});

describe('Фаза 5 — dispatch учитывает LlmProvider.defaultModelKey из БД', () => {
  /**
   * Строит registry-роутер для 'kie' с DB-строкой llmProvider (не buildFromEnv)
   * — resolveByName идёт по DB-ветке ProviderInfoResolver, откуда и берётся
   * defaultModelKey. Маршрут — плоский массив ['kie'] (без объекта {model}),
   * т.е. entry.model не задан.
   */
  function buildKieRouter(opts: { defaultModelKey: string | null }) {
    const findMany = vi.fn(async () => [
      {
        id: 'r-kie',
        taskType: 'chat-v2',
        providers: ['kie'],
        isActive: true,
        tenantId: null,
        experiment: null,
        updatedAt: new Date(),
      },
    ]);
    const llmProviderFindUnique = vi.fn(async () => ({
      name: 'kie',
      baseUrl: 'https://kie.db.test',
      apiKeyEncrypted: null,
      protocolKind: 'kie-native',
      defaultHeaders: null,
      useProxy: false,
      proxyPath: null,
      timeoutMs: null,
      // effectiveDataClass по умолчанию='internal' (Фаза 11) — capability
      // провайдера должен покрывать хотя бы 'internal', иначе фильтр
      // dataClass отбрасывает кандидата до диспатча (NoEligibleProviderError).
      capability: 'internal',
      defaultModelKey: opts.defaultModelKey,
    }));
    const prisma = {
      llmTaskRoute: {
        findMany,
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(),
      },
      llmModelPrice: { findFirst: vi.fn(async () => null) },
      llmProvider: { findUnique: llmProviderFindUnique },
    } as unknown as PrismaService;

    const kieSpy = vi.fn(async () => makeOutput('kie', 'used-model'));
    const kieSvc = { complete: kieSpy } as unknown as KieService;
    const anthropicSvc = { complete: vi.fn() } as unknown as AnthropicService;
    const minimaxSvc = { complete: vi.fn() } as unknown as MinimaxService;
    const openaiSvc = { complete: vi.fn() } as unknown as OpenAiProxyService;
    const deepseekSvc = { complete: vi.fn() } as unknown as DeepSeekService;
    const ollamaSvc = { complete: vi.fn() } as unknown as OllamaService;
    const grsaiSvc = { complete: vi.fn() } as unknown as GrsaiService;

    const usage = { record: vi.fn() } as unknown as AiUsageLogService;
    const metrics = {
      incLlmRouterDispatch: vi.fn(),
      incCoreDataClassViolation: vi.fn(),
      incLlmCostUnpriced: vi.fn(),
      incCoreLlmNoProvider: vi.fn(),
      incLlmBudgetExceeded: vi.fn(),
      incLlmThinkingModelGuard: vi.fn(),
      incDeepseekSchemaToToolConversion: vi.fn(),
    } as unknown as BusinessMetricsService;

    const cfg = makeCfg();
    const crypto = makeCryptoNoop();
    const providerInfo = new ProviderInfoResolver(prisma, cfg, crypto);

    const anthropicMessagesAdapter = new AnthropicMessagesProtocolAdapter(anthropicSvc, minimaxSvc);
    const ollamaNativeAdapter = new OllamaNativeProtocolAdapter(ollamaSvc);
    const kieNativeAdapter = new KieProtocolAdapter(kieSvc);
    const grsaiNativeAdapter = new GrsaiProtocolAdapter(grsaiSvc);
    const openaiChatAdapter = new OpenAiChatProtocolAdapter(cfg, undefined);
    const openaiResponsesAdapter = new OpenAiResponsesProtocolAdapter(openaiSvc);
    const customHttpAdapter = new CustomHttpProtocolAdapter();
    const registry = new LlmProtocolAdapterRegistry(
      openaiChatAdapter,
      openaiResponsesAdapter,
      anthropicMessagesAdapter,
      ollamaNativeAdapter,
      kieNativeAdapter,
      grsaiNativeAdapter,
      customHttpAdapter,
    );

    const router = new LlmRouterService(
      prisma,
      anthropicSvc,
      minimaxSvc,
      openaiSvc,
      deepseekSvc,
      ollamaSvc,
      kieSvc,
      grsaiSvc,
      usage,
      metrics,
      cfg,
      registry,
      providerInfo,
    );
    return { router, kieSpy };
  }

  it('маршрут без явной модели у провайдера с defaultModelKey="my-default-model" → адаптер вызывается с input.model="my-default-model"', async () => {
    const { router, kieSpy } = buildKieRouter({ defaultModelKey: 'my-default-model' });
    await router.refreshCache();
    await router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

    expect(kieSpy).toHaveBeenCalledOnce();
    const call = kieSpy.mock.calls[0] as unknown[];
    const input = call[0] as { model?: string };
    expect(input.model).toBe('my-default-model');
  });

  it('маршрут без явной модели у провайдера с defaultModelKey=null → input.model не передаётся вовсе (undefined, поведение как раньше)', async () => {
    const { router, kieSpy } = buildKieRouter({ defaultModelKey: null });
    await router.refreshCache();
    await router.call({ ...baseParams, taskType: 'chat-v2' as LlmTaskType });

    expect(kieSpy).toHaveBeenCalledOnce();
    const call = kieSpy.mock.calls[0] as unknown[];
    const input = call[0] as { model?: string };
    expect(input.model).toBeUndefined();
  });
});

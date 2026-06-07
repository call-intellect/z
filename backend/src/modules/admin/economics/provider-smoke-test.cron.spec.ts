import { describe, expect, it, vi, beforeEach } from 'vitest';

import { validateEventPayload } from '../../conversational/types/event-payload.registry';

import { ProviderSmokeTestCron } from './provider-smoke-test.cron';

/**
 * SBA α-10 wave 3 — ProviderSmokeTestCron: metrics + fail streak alert.
 */
describe('ProviderSmokeTestCron', () => {
  const findMany = vi.fn();
  const update = vi.fn(async () => ({}));
  const userFindMany = vi.fn(async () => []);
  const resolveByName = vi.fn();
  const resolve = vi.fn();
  const sendNotification = vi.fn(async () => ({}));
  const setProviderSmokeTestSuccess = vi.fn();
  const observeProviderSmokeTestDuration = vi.fn();

  const prisma = {
    llmProvider: { findMany, update },
    user: { findMany: userFindMany },
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[0];
  const cfg = {
    budget: {
      providerSmokeTestEnabled: true,
      providerSmokeTestFailThreshold: 3,
    },
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[1];
  const adapters = {
    resolve,
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[2];
  const providerInfo = {
    resolveByName,
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[3];
  const conversational = {
    sendNotification,
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[4];
  const metrics = {
    setProviderSmokeTestSuccess,
    observeProviderSmokeTestDuration,
  } as unknown as ConstructorParameters<typeof ProviderSmokeTestCron>[5];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('пишет метрику success при успешном ответе', async () => {
    resolveByName.mockResolvedValueOnce({
      info: { name: 'deepseek', baseUrl: 'http://x', apiKey: 'k' },
      protocolKind: 'openai-chat',
    });
    resolve.mockReturnValueOnce({
      complete: vi.fn(async () => ({
        text: 'OK',
        inputTokens: 1,
        outputTokens: 1,
        model: 'x',
        provider: 'deepseek',
      })),
    });
    const cron = new ProviderSmokeTestCron(
      prisma,
      cfg,
      adapters,
      providerInfo,
      conversational,
      metrics,
    );
    const result = await cron.testProvider('deepseek');
    expect(result.success).toBe(true);
    expect(setProviderSmokeTestSuccess).toHaveBeenCalledWith({
      provider: 'deepseek',
      success: true,
    });
    expect(observeProviderSmokeTestDuration).toHaveBeenCalled();
  });

  it('пишет метрику fail при ошибке', async () => {
    resolveByName.mockResolvedValueOnce({
      info: { name: 'deepseek', baseUrl: 'http://x', apiKey: 'k' },
      protocolKind: 'openai-chat',
    });
    resolve.mockReturnValueOnce({
      complete: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const cron = new ProviderSmokeTestCron(
      prisma,
      cfg,
      adapters,
      providerInfo,
      conversational,
      metrics,
    );
    const result = await cron.testProvider('deepseek');
    expect(result.success).toBe(false);
    expect(setProviderSmokeTestSuccess).toHaveBeenCalledWith({
      provider: 'deepseek',
      success: false,
    });
  });

  it('проба запрашивает maxTokens >= 16 (SMOKE_MAX_TOKENS=64)', async () => {
    resolveByName.mockResolvedValueOnce({
      info: { name: 'deepseek', baseUrl: 'http://x', apiKey: 'k' },
      protocolKind: 'openai-chat',
    });
    const complete = vi.fn(async () => ({
      text: 'OK',
      inputTokens: 1,
      outputTokens: 1,
      model: 'x',
      provider: 'deepseek',
    }));
    resolve.mockReturnValueOnce({ complete });
    const cron = new ProviderSmokeTestCron(
      prisma,
      cfg,
      adapters,
      providerInfo,
      conversational,
      metrics,
    );
    await cron.testProvider('deepseek');
    // maxTokens === 64 (>= OpenAI floor 16) — проверяем через objectContaining
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ maxTokens: 64 }),
      }),
    );
    const completeCalls = complete.mock.calls as unknown as Array<
      [{ input: { maxTokens: number } }]
    >;
    const sentMaxTokens = completeCalls[0]![0].input.maxTokens;
    expect(sentMaxTokens).toBeGreaterThanOrEqual(16);
  });

  it('при провале сверх порога шлёт system.message payload, проходящий схему', async () => {
    resolveByName.mockResolvedValue({
      info: { name: 'openai', baseUrl: 'http://x', apiKey: 'k' },
      protocolKind: 'openai-chat',
    });
    resolve.mockReturnValue({
      complete: vi.fn(async () => {
        throw new Error('max_output_tokens too small');
      }),
    });
    userFindMany.mockResolvedValueOnce([
      { id: 'u1', memberships: [{ orgId: 'org1' }] },
    ] as never);
    const cron = new ProviderSmokeTestCron(
      prisma,
      cfg,
      adapters,
      providerInfo,
      conversational,
      metrics,
    );
    // threshold=3 → нужно 3 провала подряд, чтобы сработал алерт
    await cron.testProvider('openai');
    await cron.testProvider('openai');
    await cron.testProvider('openai');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const notifyCalls = sendNotification.mock.calls as unknown as Array<
      [{ eventType: string; payload: Record<string, unknown> }]
    >;
    const arg = notifyCalls[0]![0];
    expect(arg.eventType).toBe('system.message');
    expect(arg.payload).toHaveProperty('title');
    expect(arg.payload).toHaveProperty('body');
    expect(arg.payload).toHaveProperty('severity', 'error');
    expect(arg.payload).not.toHaveProperty('kind');
    expect(arg.payload).not.toHaveProperty('streak');
    // payload должен пройти валидацию реальной схемы system.message без throw
    expect(() =>
      validateEventPayload('system.message', arg.payload),
    ).not.toThrow();
  });

  it('runOnce пропускает провайдер с пустым baseUrl', async () => {
    findMany.mockResolvedValueOnce([
      { name: 'configured', baseUrl: 'http://x' },
      { name: 'unconfigured', baseUrl: '' },
    ]);
    resolveByName.mockResolvedValue({
      info: { name: 'configured', baseUrl: 'http://x', apiKey: 'k' },
      protocolKind: 'openai-chat',
    });
    resolve.mockReturnValue({
      complete: vi.fn(async () => ({
        text: 'OK',
        inputTokens: 1,
        outputTokens: 1,
        model: 'x',
        provider: 'configured',
      })),
    });
    const cron = new ProviderSmokeTestCron(
      prisma,
      cfg,
      adapters,
      providerInfo,
      conversational,
      metrics,
    );
    const result = await cron.runOnce();
    expect(result.providersScanned).toBe(1);
    expect(result.successes).toBe(1);
    expect(resolveByName).toHaveBeenCalledTimes(1);
    expect(resolveByName).toHaveBeenCalledWith('configured');
  });
});

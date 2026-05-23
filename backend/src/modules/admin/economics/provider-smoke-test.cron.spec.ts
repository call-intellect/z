import { describe, expect, it, vi, beforeEach } from 'vitest';

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
});

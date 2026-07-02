import { describe, expect, it, vi } from 'vitest';

import type { KieService } from '../../kie.service';
import { LlmError } from '../../llm.types';
import type { ProtocolAdapterProviderInfo } from '../protocol-adapter.types';

import { KieProtocolAdapter } from './kie-native.adapter';

function makeProvider(
  overrides?: Partial<ProtocolAdapterProviderInfo>,
): ProtocolAdapterProviderInfo {
  return {
    name: 'kie',
    baseUrl: 'https://api.kie.ai',
    apiKey: 'kie-key',
    defaultHeaders: { 'x-extra': '1' },
    timeoutMs: 45_000,
    ...overrides,
  };
}

describe('KieProtocolAdapter.complete', () => {
  it('вызывает KieService.complete с override, собранным из ProviderInfo', async () => {
    const complete = vi.fn(async () => ({
      text: 'ok',
      inputTokens: 1,
      outputTokens: 1,
      model: 'claude-opus-4-7',
      provider: 'kie' as const,
    }));
    const kie = { complete } as unknown as KieService;
    const adapter = new KieProtocolAdapter(kie);
    const provider = makeProvider();

    const out = await adapter.complete({
      provider,
      input: { system: { text: 's' }, user: 'u', model: 'claude-opus-4-7' },
    });

    expect(out.text).toBe('ok');
    expect(complete).toHaveBeenCalledWith(
      { system: { text: 's' }, user: 'u', model: 'claude-opus-4-7' },
      expect.objectContaining({
        baseUrl: 'https://api.kie.ai',
        apiKey: 'kie-key',
        defaultHeaders: { 'x-extra': '1' },
        timeoutMs: 45_000,
      }),
    );
  });

  it('KieService бросает LlmError → пробрасывается как есть', async () => {
    const complete = vi.fn(async () => {
      throw new LlmError('KIE HTTP 500', 500);
    });
    const kie = { complete } as unknown as KieService;
    const adapter = new KieProtocolAdapter(kie);

    await expect(
      adapter.complete({
        provider: makeProvider(),
        input: { system: { text: 's' }, user: 'u', model: 'gpt-5.4' },
      }),
    ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 500 });
  });

  it('неожиданная ошибка → оборачивается в LlmError с provider.name в сообщении', async () => {
    const complete = vi.fn(async () => {
      throw new Error('network down');
    });
    const kie = { complete } as unknown as KieService;
    const adapter = new KieProtocolAdapter(kie);

    await expect(
      adapter.complete({
        provider: makeProvider({ name: 'kie-secondary' }),
        input: { system: { text: 's' }, user: 'u', model: 'gemini-3.1-pro' },
      }),
    ).rejects.toMatchObject({
      name: 'LlmError',
      message: expect.stringContaining('kie-native kie-secondary'),
    });
  });
});

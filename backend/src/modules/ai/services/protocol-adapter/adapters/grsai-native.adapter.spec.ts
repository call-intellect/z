import { describe, expect, it, vi } from 'vitest';

import type { GrsaiService } from '../../grsai.service';
import { LlmError } from '../../llm.types';
import type { ProtocolAdapterProviderInfo } from '../protocol-adapter.types';

import { GrsaiProtocolAdapter } from './grsai-native.adapter';

function makeProvider(
  overrides?: Partial<ProtocolAdapterProviderInfo>,
): ProtocolAdapterProviderInfo {
  return {
    name: 'grsai',
    baseUrl: 'https://grsaiapi.com',
    apiKey: 'grsai-key',
    defaultHeaders: { 'x-extra': '1' },
    timeoutMs: 60_000,
    ...overrides,
  };
}

describe('GrsaiProtocolAdapter.complete', () => {
  it('вызывает GrsaiService.complete с override, собранным из ProviderInfo', async () => {
    const complete = vi.fn(async () => ({
      text: 'ok',
      inputTokens: 1,
      outputTokens: 1,
      model: 'gemini-3-pro',
      provider: 'grsai' as const,
    }));
    const grsai = { complete } as unknown as GrsaiService;
    const adapter = new GrsaiProtocolAdapter(grsai);
    const provider = makeProvider();

    const out = await adapter.complete({
      provider,
      input: { system: { text: 's' }, user: 'u', model: 'gemini-3-pro' },
    });

    expect(out.text).toBe('ok');
    expect(complete).toHaveBeenCalledWith(
      { system: { text: 's' }, user: 'u', model: 'gemini-3-pro' },
      expect.objectContaining({
        baseUrl: 'https://grsaiapi.com',
        apiKey: 'grsai-key',
        defaultHeaders: { 'x-extra': '1' },
        timeoutMs: 60_000,
      }),
    );
  });

  it('GrsaiService бросает LlmError → пробрасывается как есть', async () => {
    const complete = vi.fn(async () => {
      throw new LlmError('GRSAI HTTP 500', 500);
    });
    const grsai = { complete } as unknown as GrsaiService;
    const adapter = new GrsaiProtocolAdapter(grsai);

    await expect(
      adapter.complete({
        provider: makeProvider(),
        input: { system: { text: 's' }, user: 'u', model: 'gemini-3-pro' },
      }),
    ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 500 });
  });

  it('неожиданная ошибка → оборачивается в LlmError с provider.name в сообщении', async () => {
    const complete = vi.fn(async () => {
      throw new Error('network down');
    });
    const grsai = { complete } as unknown as GrsaiService;
    const adapter = new GrsaiProtocolAdapter(grsai);

    await expect(
      adapter.complete({
        provider: makeProvider({ name: 'grsai-secondary' }),
        input: { system: { text: 's' }, user: 'u', model: 'gemini-3.1-pro' },
      }),
    ).rejects.toMatchObject({
      name: 'LlmError',
      message: expect.stringContaining('grsai-native grsai-secondary'),
    });
  });
});

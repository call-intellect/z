import { describe, expect, it, vi } from 'vitest';

import type { LlmCompleteOutput } from '../llm.types';

import type { AnthropicMessagesProtocolAdapter } from './adapters/anthropic-messages.adapter';
import type { CustomHttpProtocolAdapter } from './adapters/custom-http.adapter';
import type { OllamaNativeProtocolAdapter } from './adapters/ollama-native.adapter';
import type { OpenAiChatProtocolAdapter } from './adapters/openai-chat.adapter';
import type { OpenAiResponsesProtocolAdapter } from './adapters/openai-responses.adapter';
import { LlmProtocolAdapterRegistry } from './llm-protocol-adapter.registry';

/**
 * SBA α-10 wave 3 — registry резолвит адаптер по protocolKind.
 */
function buildRegistry(): LlmProtocolAdapterRegistry {
  const dummy = vi.fn(async (): Promise<LlmCompleteOutput> => ({
    text: 'OK',
    inputTokens: 1,
    outputTokens: 1,
    model: 'x',
    provider: 'deepseek',
  }));
  const openaiChat = {
    protocolKind: 'openai-chat' as const,
    complete: dummy,
  } as unknown as OpenAiChatProtocolAdapter;
  const openaiResp = {
    protocolKind: 'openai-responses' as const,
    complete: dummy,
  } as unknown as OpenAiResponsesProtocolAdapter;
  const anthropic = {
    protocolKind: 'anthropic-messages' as const,
    complete: dummy,
  } as unknown as AnthropicMessagesProtocolAdapter;
  const ollama = {
    protocolKind: 'ollama-native' as const,
    complete: dummy,
  } as unknown as OllamaNativeProtocolAdapter;
  const custom = {
    protocolKind: 'custom-http' as const,
    complete: dummy,
  } as unknown as CustomHttpProtocolAdapter;
  return new LlmProtocolAdapterRegistry(
    openaiChat,
    openaiResp,
    anthropic,
    ollama,
    custom,
  );
}

describe('LlmProtocolAdapterRegistry', () => {
  it('резолвит все 5 protocolKind', () => {
    const r = buildRegistry();
    expect(r.resolve('openai-chat').protocolKind).toBe('openai-chat');
    expect(r.resolve('openai-responses').protocolKind).toBe('openai-responses');
    expect(r.resolve('anthropic-messages').protocolKind).toBe(
      'anthropic-messages',
    );
    expect(r.resolve('ollama-native').protocolKind).toBe('ollama-native');
    expect(r.resolve('custom-http').protocolKind).toBe('custom-http');
  });

  it('listKinds возвращает все 5 типов', () => {
    const r = buildRegistry();
    const kinds = r.listKinds();
    expect(kinds).toHaveLength(5);
    expect(kinds).toContain('openai-chat');
    expect(kinds).toContain('custom-http');
  });

  it('throws при unknown protocolKind', () => {
    const r = buildRegistry();
    expect(() => r.resolve('non-existing' as never)).toThrow(
      /нет адаптера для protocolKind/,
    );
  });
});

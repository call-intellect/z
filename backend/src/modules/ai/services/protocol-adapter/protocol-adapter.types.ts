import type { LlmCompleteInput, LlmCompleteOutput } from '../llm.types';

export type ProtocolKind =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'ollama-native'
  | 'custom-http';

export interface ProtocolAdapterProviderInfo {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  defaultHeaders?: Record<string, string>;
  defaultModel?: string;
  authPrefix?: string;
}

export interface LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind;
  complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput>;
}

export const PROTOCOL_ADAPTER_TOKEN = Symbol.for('LlmProtocolAdapter');

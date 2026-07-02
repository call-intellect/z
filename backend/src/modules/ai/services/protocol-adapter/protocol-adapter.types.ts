import type { LlmCompleteInput, LlmCompleteOutput } from '../llm.types';

export type ProtocolKind =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'ollama-native'
  | 'kie-native'
  | 'grsai-native'
  | 'custom-http';

export interface ProtocolAdapterProviderInfo {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  defaultHeaders?: Record<string, string>;
  defaultModel?: string;
  /** DataClass провайдера ('public'|'internal'|'sensitive'|'private') из LlmProvider.capability. undefined = нет DB-строки, роутер фолбэкается на хардкод-карту. */
  capability?: string;
  /** Переопределение hard-timeout dispatch, мс. NULL/undefined = используется дефолт роутера. */
  timeoutMs?: number | null;
  /** Модель по умолчанию провайдера из LlmProvider.defaultModelKey (DB). Отдельно от defaultModel (ENV-фолбэк buildFromEnv). */
  defaultModelKey?: string | null;
}

/** Единый контракт переопределения подключения — передаётся из ProviderInfoResolver (DB) в легаси-сервисы, чтобы admin-правка baseUrl/ключа реально действовала. */
export interface LlmConnectionOverride {
  baseUrl: string;
  apiKey: string | null;
  defaultHeaders?: Record<string, string> | null;
  timeoutMs?: number | null;
}

export interface LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind;
  complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput>;
}

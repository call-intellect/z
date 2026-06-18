import { Inject, Injectable, Logger } from '@nestjs/common';

import { AnthropicMessagesProtocolAdapter } from './adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from './adapters/custom-http.adapter';
import { OllamaNativeProtocolAdapter } from './adapters/ollama-native.adapter';
import { OpenAiChatProtocolAdapter } from './adapters/openai-chat.adapter';
import { OpenAiResponsesProtocolAdapter } from './adapters/openai-responses.adapter';
import type { LlmProtocolAdapter, ProtocolKind } from './protocol-adapter.types';

@Injectable()
export class LlmProtocolAdapterRegistry {
  private readonly logger = new Logger(LlmProtocolAdapterRegistry.name);
  private readonly map = new Map<ProtocolKind, LlmProtocolAdapter>();

  constructor(
    @Inject(OpenAiChatProtocolAdapter)
    openaiChat: OpenAiChatProtocolAdapter,
    @Inject(OpenAiResponsesProtocolAdapter)
    openaiResponses: OpenAiResponsesProtocolAdapter,
    @Inject(AnthropicMessagesProtocolAdapter)
    anthropicMessages: AnthropicMessagesProtocolAdapter,
    @Inject(OllamaNativeProtocolAdapter)
    ollamaNative: OllamaNativeProtocolAdapter,
    @Inject(CustomHttpProtocolAdapter)
    customHttp: CustomHttpProtocolAdapter,
  ) {
    const adapters: LlmProtocolAdapter[] = [
      openaiChat,
      openaiResponses,
      anthropicMessages,
      ollamaNative,
      customHttp,
    ];
    for (const a of adapters) {
      this.map.set(a.protocolKind, a);
    }
    this.logger.log(`LlmProtocolAdapterRegistry: зарегистрировано ${this.map.size} адаптеров`);
  }

  resolve(kind: ProtocolKind): LlmProtocolAdapter {
    const adapter = this.map.get(kind);
    if (!adapter) {
      throw new Error(`LlmProtocolAdapterRegistry: нет адаптера для protocolKind=${kind}`);
    }
    return adapter;
  }

  listKinds(): ProtocolKind[] {
    return [...this.map.keys()];
  }
}

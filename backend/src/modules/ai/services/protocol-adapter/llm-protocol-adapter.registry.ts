import { Inject, Injectable, Logger } from '@nestjs/common';

import { AnthropicMessagesProtocolAdapter } from './adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from './adapters/custom-http.adapter';
import { OllamaNativeProtocolAdapter } from './adapters/ollama-native.adapter';
import { OpenAiChatProtocolAdapter } from './adapters/openai-chat.adapter';
import { OpenAiResponsesProtocolAdapter } from './adapters/openai-responses.adapter';
import type {
  LlmProtocolAdapter,
  ProtocolKind,
} from './protocol-adapter.types';

/**
 * SBA α-10 wave 3 — Registry адаптеров протоколов LLM.
 *
 * Используется при USE_PROTOCOL_ADAPTER_REGISTRY=true (feature-flag в
 * cfg.budget). LlmRouterService.dispatch() резолвит provider.protocolKind
 * → адаптер → complete().
 *
 * При false — legacy switch(provider) в LlmRouterService продолжает работать.
 * Это позволяет безопасно жить параллельно с другими coders, которые
 * добавляют новые LlmTaskType (без изменения adapter logic).
 *
 * Расширяемость: новый protocolKind → новый @Injectable Adapter +
 * добавить в конструктор registry. ALL coders могут продолжать добавлять
 * taskTypes — adapter registry на них не влияет.
 */
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
    this.logger.log(
      `LlmProtocolAdapterRegistry: зарегистрировано ${this.map.size} адаптеров`,
    );
  }

  /**
   * Резолв адаптера по protocolKind. Throws при unknown kind.
   */
  resolve(kind: ProtocolKind): LlmProtocolAdapter {
    const adapter = this.map.get(kind);
    if (!adapter) {
      throw new Error(
        `LlmProtocolAdapterRegistry: нет адаптера для protocolKind=${kind}`,
      );
    }
    return adapter;
  }

  /**
   * Список доступных protocolKind — для админ-UI / smoke-теста.
   */
  listKinds(): ProtocolKind[] {
    return [...this.map.keys()];
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../../llm.types';
import { LlmError } from '../../llm.types';
import { OpenAiProxyService } from '../../openai-proxy.service';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

/**
 * SBA α-10 wave 3 — OpenAI Responses API адаптер.
 *
 * Делегирует в существующий OpenAiProxyService (proxy.agent-lia.ru), который
 * реализует Responses API (gpt-5-*, reasoning effort, json_schema strict,
 * tool calls). Сейчас единственный провайдер — 'openai-via-proxy';
 * адаптер позволяет регистрировать дополнительные через registry.
 */
@Injectable()
export class OpenAiResponsesProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'openai-responses';
  private readonly logger = new Logger(OpenAiResponsesProtocolAdapter.name);

  constructor(
    @Inject(OpenAiProxyService)
    private readonly proxy: OpenAiProxyService,
  ) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    try {
      return await this.proxy.complete(input);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        `openai-responses ${provider.name}: ${message}`,
        undefined,
        err,
      );
    }
  }
}

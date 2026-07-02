import { Inject, Injectable, Logger } from '@nestjs/common';

import { AnthropicService } from '../../anthropic.service';
import type { LlmCompleteInput, LlmCompleteOutput } from '../../llm.types';
import { LlmError } from '../../llm.types';
import { MinimaxService } from '../../minimax.service';
import type {
  LlmConnectionOverride,
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

@Injectable()
export class AnthropicMessagesProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'anthropic-messages';
  private readonly logger = new Logger(AnthropicMessagesProtocolAdapter.name);

  constructor(
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
  ) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    const override: LlmConnectionOverride = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      defaultHeaders: provider.defaultHeaders,
      timeoutMs: provider.timeoutMs,
    };
    try {
      if (provider.name === 'anthropic') {
        return await this.anthropic.complete(input, override);
      }
      if (provider.name === 'minimax') {
        return await this.minimax.complete(input, override);
      }
      this.logger.warn(
        `anthropic-messages: unknown provider=${provider.name}, fallback на MinimaxService`,
      );
      return await this.minimax.complete(input, override);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(`anthropic-messages ${provider.name}: ${message}`, undefined, err);
    }
  }
}

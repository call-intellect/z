import { Inject, Injectable, Logger } from '@nestjs/common';

import { AnthropicService } from '../../anthropic.service';
import { MinimaxService } from '../../minimax.service';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../../llm.types';
import { LlmError } from '../../llm.types';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

/**
 * SBA α-10 wave 3 — Anthropic Messages API адаптер.
 *
 * Обёртка над существующими AnthropicService / MinimaxService — реальная
 * реализация streaming + non-streaming живёт в них. Адаптер выбирает
 * правильный underlying client по имени провайдера:
 *   - 'anthropic' → AnthropicService;
 *   - 'minimax'   → MinimaxService (anthropic-compat endpoint).
 *
 * Этот же протокол обслужит любой будущий anthropic-compatible провайдер
 * (через MinimaxService.complete с переопределённым baseUrl на уровне ENV).
 */
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
    try {
      if (provider.name === 'anthropic') {
        return await this.anthropic.complete(input);
      }
      if (provider.name === 'minimax') {
        return await this.minimax.complete(input);
      }
      // Generic anthropic-compatible — пытаемся через MinimaxService
      // (он самый «дженерик» из двух — anthropic-compat endpoint).
      this.logger.warn(
        `anthropic-messages: unknown provider=${provider.name}, fallback на MinimaxService`,
      );
      return await this.minimax.complete(input);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        `anthropic-messages ${provider.name}: ${message}`,
        undefined,
        err,
      );
    }
  }
}

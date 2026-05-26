import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../../llm.types';
import { LlmError } from '../../llm.types';
import { OllamaService } from '../../ollama.service';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

/**
 * SBA α-10 wave 3 — Ollama native API адаптер.
 *
 * Обёртка над OllamaService — реальная реализация (POST /api/generate либо
 * /v1/chat/completions, без prompt cache) живёт там.
 */
@Injectable()
export class OllamaNativeProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'ollama-native';
  private readonly logger = new Logger(OllamaNativeProtocolAdapter.name);

  constructor(@Inject(OllamaService) private readonly ollama: OllamaService) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    try {
      return await this.ollama.complete(input);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        `ollama-native ${provider.name}: ${message}`,
        undefined,
        err,
      );
    }
  }
}

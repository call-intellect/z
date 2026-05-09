import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { TypedConfigService } from '../../../common/config/index';

import {
  buildSystemBlocks,
  mapAnthropicResponseToOutput,
} from './anthropic.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { LlmError } from './llm.types';

/**
 * MiniMax — Anthropic-совместимый канал. Используется как первый fallback,
 * если Anthropic вернул 403 (блокировка из РФ).
 *
 * Endpoint: `cfg.ai.minimax.baseUrl` (по умолчанию `https://api.minimax.io/anthropic`).
 * Ключ — `cfg.ai.minimax.apiKey`. SDK тот же `@anthropic-ai/sdk` с кастомным `baseURL`.
 */
@Injectable()
export class MinimaxService {
  private readonly logger = new Logger(MinimaxService.name);
  private readonly client: Anthropic;
  private readonly defaultModel = 'MiniMax-M2.5';

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.client = new Anthropic({
      apiKey: this.cfg.ai.minimax.apiKey,
      baseURL: this.cfg.ai.minimax.baseUrl,
    });
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;
    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: input.maxTokens ?? 4096,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        system: buildSystemBlocks(input.system),
        messages: [{ role: 'user', content: input.user }],
        ...(input.tools ? { tools: input.tools } : {}),
        stream: false,
      });
      return mapAnthropicResponseToOutput(message, model, 'minimax');
    } catch (err) {
      const status = extractStatus(err);
      this.logger.warn(`MiniMax complete (${status ?? 'no-status'}): ${errMsg(err)}`);
      throw new LlmError(`MiniMax: ${errMsg(err)}`, status, err);
    }
  }
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

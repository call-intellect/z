import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { AnthropicService } from './anthropic.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { LlmError } from './llm.types';
import { MinimaxService } from './minimax.service';
import { OpenAiProxyService } from './openai-proxy.service';

/**
 * Каскад LLM-fallback'а:
 *
 *   1. Anthropic (api.anthropic.com или прокси) — основной канал.
 *   2. На 403 (РФ-блок) → MiniMax (Anthropic-compat).
 *   3. На любой устойчивый сбой MiniMax → OpenAI Responses через `proxy.agent-lia.ru`.
 *
 * Финальный ответ оборачивается в общий `LlmCompleteOutput`. Логи провайдера
 * (`provider: 'anthropic' | 'minimax' | 'openai-via-proxy'`) — для AiUsageLog.
 *
 * Этот сервис НЕ пишет AiUsageLog сам — ответ возвращается, и caller (analyze.worker)
 * пишет лог по результату с правильным `agentType`.
 */
@Injectable()
export class LlmFallbackService {
  private readonly logger = new Logger(LlmFallbackService.name);

  constructor(
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    // BusinessMetricsService может отсутствовать в юнит-тестах LlmFallbackService —
    // делаем его опциональным, чтобы не ломать существующие тесты.
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Пытается выполнить запрос по цепочке провайдеров.
   * Возвращает успешный ответ либо последнюю ошибку.
   *
   * При каждом переключении инкрементируется метрика `llm_fallback_total{provider}`,
   * где `provider` — провайдер, на КОТОРЫЙ перешли.
   */
  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    // 1. Anthropic.
    try {
      return await this.anthropic.complete(input);
    } catch (err) {
      const status = err instanceof LlmError ? err.httpStatus : undefined;
      // Только на 403 переходим к MiniMax. На остальное — пробуем дальше тоже,
      // потому что MiniMax часто оказывается бодрее, чем «временная» ошибка.
      this.logger.warn(
        `Fallback Anthropic→MiniMax (status=${status ?? 'no-status'}): ${errMsg(err)}`,
      );
      this.metrics?.incLlmFallback('minimax');
    }

    // 2. MiniMax.
    try {
      return await this.minimax.complete(input);
    } catch (err) {
      this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
      this.metrics?.incLlmFallback('openai-via-proxy');
    }

    // 3. OpenAI-via-proxy.
    return this.openai.complete(input);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

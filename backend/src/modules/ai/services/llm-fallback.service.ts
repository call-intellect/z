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
   *
   * T7-F3 (prompt caching distribution): автоматически выставляем
   * `cacheControl: 'ephemeral'` на system, если caller не сделал это явно.
   * Это даёт parity с `LlmRouterService.dispatch()` (где то же самое уже
   * делается на каждый вызов). Для не-Anthropic провайдеров cacheControl
   * молча игнорируется на уровне адаптеров.
   */
  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const withCache: LlmCompleteInput =
      input.system.cacheControl === undefined
        ? { ...input, system: { ...input.system, cacheControl: 'ephemeral' } }
        : input;
    // 1. Anthropic.
    try {
      return await this.anthropic.complete(withCache);
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
      return await this.minimax.complete(withCache);
    } catch (err) {
      this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
      this.metrics?.incLlmFallback('openai-via-proxy');
    }

    // 3. OpenAI-via-proxy.
    return this.openai.complete(withCache);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

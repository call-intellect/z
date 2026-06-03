import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { MinimaxService } from './minimax.service';
import { OpenAiProxyService } from './openai-proxy.service';

/**
 * Каскад LLM-fallback'а.
 *
 *   1. MiniMax (Anthropic-compat) — основной канал.
 *   2. На любой устойчивый сбой MiniMax → OpenAI Responses через `proxy.agent-lia.ru`.
 *
 * Anthropic выведен из каскада 2026-06-03: ключа нет (не закупаем), любой вызов
 * давал 403 (РФ-блок) и только тратил время перед переходом на MiniMax. Класс
 * `AnthropicService` физически остаётся (роутер/протокол-адаптер), но в дефолтном
 * fallback'е больше не участвует.
 *
 * Финальный ответ оборачивается в общий `LlmCompleteOutput`. Логи провайдера
 * (`provider: 'minimax' | 'openai-via-proxy'`) — для AiUsageLog.
 *
 * Этот сервис НЕ пишет AiUsageLog сам — ответ возвращается, и caller (analyze.worker)
 * пишет лог по результату с правильным `agentType`.
 */
@Injectable()
export class LlmFallbackService {
  private readonly logger = new Logger(LlmFallbackService.name);

  constructor(
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
   * делается на каждый вызов). Для не-Anthropic-совместимых провайдеров
   * cacheControl молча игнорируется на уровне адаптеров.
   */
  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const withCache: LlmCompleteInput =
      input.system.cacheControl === undefined
        ? { ...input, system: { ...input.system, cacheControl: 'ephemeral' } }
        : input;

    // 1. MiniMax — основной канал (Anthropic-compat, поддерживает cacheControl).
    try {
      return await this.minimax.complete(withCache);
    } catch (err) {
      this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
      this.metrics?.incLlmFallback('openai-via-proxy');
    }

    // 2. OpenAI-via-proxy.
    return this.openai.complete(withCache);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

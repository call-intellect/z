import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { DeepSeekService } from './deepseek.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { MinimaxService } from './minimax.service';
import { OpenAiProxyService } from './openai-proxy.service';

/**
 * Каскад LLM-fallback'а главного отчёта встречи (потребитель — `analyze.worker`).
 *
 * Две явные ветки по `ai.mainReport.primary` (retest3 Ф5 #51/Р3):
 *   - `deepseek` (Ship-On, дефолт): DeepSeek → MiniMax → OpenAI-via-proxy.
 *     Включает кэш DeepSeek и per-agent pro-модель (`input.model`).
 *   - `minimax` (kill-switch-откат): дословно прежний каскад MiniMax → OpenAI.
 *
 * Anthropic выведен из каскада 2026-06-03: ключа нет (не закупаем), любой вызов
 * давал 403 (РФ-блок) и только тратил время. Класс `AnthropicService` физически
 * остаётся (роутер/протокол-адаптер), но в дефолтном fallback'е не участвует.
 *
 * D1 (retest3): `input.model` — per-agent имя DeepSeek-модели (напр.
 * `deepseek-v4-pro`). MiniMax/OpenAI берут `input.model ?? default`
 * (`minimax.service:36`), поэтому перед ними model СБРАСЫВАЕТСЯ — иначе они
 * попытаются использовать имя deepseek-модели и сломают откат/fallback.
 *
 * Этот сервис НЕ пишет AiUsageLog сам — ответ возвращается, и caller
 * (analyze.worker) пишет лог по результату с правильным `agentType`.
 */
@Injectable()
export class LlmFallbackService {
  private readonly logger = new Logger(LlmFallbackService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
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
    // model оставляем только DeepSeek-ветке; MiniMax/OpenAI его не понимают (D1).
    const withoutModel: LlmCompleteInput = { ...withCache, model: undefined };

    if (this.cfg.ai.mainReport.primary === 'deepseek') {
      // 1. DeepSeek (primary) — кэш DeepSeek + per-agent pro-модель (input.model).
      try {
        return await this.deepseek.complete(withCache);
      } catch (err) {
        this.logger.warn(`Fallback DeepSeek→MiniMax: ${errMsg(err)}`);
        this.metrics?.incLlmFallback('minimax');
      }
      // 2. MiniMax (откат) — без deepseek-model.
      try {
        return await this.minimax.complete(withoutModel);
      } catch (err) {
        this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
        this.metrics?.incLlmFallback('openai-via-proxy');
      }
      // 3. OpenAI-via-proxy.
      return this.openai.complete(withoutModel);
    }

    // primary='minimax' — дословно прежний каскад (kill-switch-откат).
    // 1. MiniMax — основной канал (Anthropic-compat, поддерживает cacheControl).
    try {
      return await this.minimax.complete(withoutModel);
    } catch (err) {
      this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
      this.metrics?.incLlmFallback('openai-via-proxy');
    }
    // 2. OpenAI-via-proxy.
    return this.openai.complete(withoutModel);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

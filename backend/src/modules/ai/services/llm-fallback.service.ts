import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { DeepSeekService } from './deepseek.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { MinimaxService } from './minimax.service';
import { OpenAiProxyService } from './openai-proxy.service';

@Injectable()
export class LlmFallbackService {
  private readonly logger = new Logger(LlmFallbackService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const withCache: LlmCompleteInput =
      input.system.cacheControl === undefined
        ? { ...input, system: { ...input.system, cacheControl: 'ephemeral' } }
        : input;
    const withoutModel: LlmCompleteInput = { ...withCache, model: undefined };

    if (this.cfg.ai.mainReport.primary === 'deepseek') {
      try {
        return await this.deepseek.complete(withCache);
      } catch (err) {
        this.logger.warn(`Fallback DeepSeek→MiniMax: ${errMsg(err)}`);
        this.metrics?.incLlmFallback('minimax');
      }
      try {
        return await this.minimax.complete(withoutModel);
      } catch (err) {
        this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
        this.metrics?.incLlmFallback('openai-via-proxy');
      }
      return this.openai.complete(withoutModel);
    }

    try {
      return await this.minimax.complete(withoutModel);
    } catch (err) {
      this.logger.warn(`Fallback MiniMax→OpenAI-via-proxy: ${errMsg(err)}`);
      this.metrics?.incLlmFallback('openai-via-proxy');
    }
    return this.openai.complete(withoutModel);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  CHECKIN_SENTIMENT_PROMPT_VERSION,
  CHECKIN_SENTIMENT_SYSTEM_PROMPT,
  type CheckinSentiment,
  buildCheckinSentimentUserMessage,
} from '../prompts/checkin-sentiment.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class CheckinSentimentAnalyzerWorker {
  private readonly logger = new Logger(CheckinSentimentAnalyzerWorker.name);
  private static readonly LLM_TIMEOUT_MS = 30_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('checkin.created')
  async handle(event: {
    tenantId: string;
    checkInId: string;
    personId: string;
    kind: 'morning' | 'evening';
    rawText: string | null;
  }): Promise<void> {
    if (!this.cfg.betaOps.sentimentEnabled) return;
    if (!event.rawText || event.rawText.trim().length === 0) return;
    if (event.kind !== 'evening') return;

    const tenantTop = resolveOperationsTenantTop(event.tenantId);

    try {
      const result = await Promise.race([
        this.llm.call({
          taskType: 'checkin-sentiment',
          tenantId: event.tenantId,
          systemPrompt: CHECKIN_SENTIMENT_SYSTEM_PROMPT,
          userMessage: buildCheckinSentimentUserMessage({
            kind: event.kind,
            rawText: event.rawText,
          }),
          responseFormat: { type: 'json_object' },
          maxTokens: 1_500,
          sourceRef: { type: 'checkin', id: event.checkInId },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('checkin-sentiment LLM timeout')),
            CheckinSentimentAnalyzerWorker.LLM_TIMEOUT_MS,
          ),
        ),
      ]);

      const parsed = this.parseSentimentResponse(result.text);
      if (!parsed) {
        this.metrics.incCooSentimentFailed({ tenantTop });
        this.logger.warn(
          { checkInId: event.checkInId, rawHead: result.text.slice(0, 200) },
          'checkin-sentiment: невалидный JSON в ответе LLM — sentiment остаётся null',
        );
        return;
      }

      const version = `${CHECKIN_SENTIMENT_PROMPT_VERSION}+${result.modelUsed}`;
      await this.prisma.dailyCheckIn.update({
        where: { id: event.checkInId },
        data: {
          sentiment: parsed.sentiment,
          sentimentRationale: parsed.rationale,
          sentimentVersion: version,
          sentimentDeterminedAt: new Date(),
        },
      });

      this.metrics.incCooSentimentAnalyzed({
        tenantTop,
        sentiment: parsed.sentiment,
      });
    } catch (err) {
      this.metrics.incCooSentimentFailed({ tenantTop });
      this.logger.warn(
        {
          checkInId: event.checkInId,
          err: err instanceof Error ? err.message : String(err),
        },
        'checkin-sentiment-analyzer: ошибка LLM или таймаут — sentiment остаётся null',
      );
    }
  }

  private parseSentimentResponse(text: string): {
    sentiment: CheckinSentiment;
    rationale: string;
  } | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const sentimentRaw = obj.sentiment;
    if (sentimentRaw !== 'green' && sentimentRaw !== 'yellow' && sentimentRaw !== 'red') {
      return null;
    }
    const rationaleRaw = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1_000) : '';
    return {
      sentiment: sentimentRaw,
      rationale: rationaleRaw,
    };
  }
}

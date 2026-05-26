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

/**
 * SBA β-8.1 — CheckinSentimentAnalyzerWorker.
 *
 * Слушает событие `checkin.created`, эмиттированное `CheckinResponseHandler`
 * после успешного upsert'а DailyCheckIn. Делает один вызов модели через
 * `LlmRouterService` (`taskType='checkin-sentiment'`), парсит JSON-ответ
 * `{sentiment, rationale}` и обновляет запись DailyCheckIn.
 *
 * Best-effort: любая ошибка LLM или невалидный ответ → `sentiment=null`,
 * `coo_sentiment_failed_total++`. Чек-ин остаётся валидным.
 *
 * Master-flag — `COO_SENTIMENT_ENABLED`. False → handler выходит сразу.
 */
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
    // Анализируем только вечерние чек-ины — у утренних нет «настроения дня»,
    // а только план задач (см. ТЗ §3 — обоснование «вечернего ответа»).
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
          // ТЗ 2026-05-25 LLM-architecture §6.6 — поднято 300 → 1500.
          // На DeepSeek-Pro с thinking при 300 — 56% ответов пустые
          // (thinking-токены съедают весь лимит). 1500 — безопасный минимум.
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

  /**
   * Безопасный парсер ответа модели. Если JSON некорректен — возвращает null.
   * Подстраховка от моделей, которые возвращают текст вокруг JSON.
   */
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
    if (
      sentimentRaw !== 'green' &&
      sentimentRaw !== 'yellow' &&
      sentimentRaw !== 'red'
    ) {
      return null;
    }
    const rationaleRaw =
      typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1_000) : '';
    return {
      sentiment: sentimentRaw,
      rationale: rationaleRaw,
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  CHECKIN_SENTIMENT_BATCH_PROMPT_VERSION,
  CHECKIN_SENTIMENT_BATCH_SIZE,
  CHECKIN_SENTIMENT_BATCH_SYSTEM_PROMPT,
  CHECKIN_SENTIMENT_BATCH_TOOL,
  buildCheckinSentimentBatchUserMessage,
  parseCheckinSentimentBatchToolInput,
  type CheckinSentimentBatchItem,
} from '../prompts/checkin-sentiment.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class CheckinSentimentBatchCron {
  private readonly logger = new Logger(CheckinSentimentBatchCron.name);
  private static readonly LLM_TIMEOUT_MS = 60_000;
  private static readonly LOOKBACK_MS = 60 * 60 * 1000;
  private static readonly MAX_PER_RUN = 100;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/5 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.sentimentEnabled) {
      this.logger.debug('checkin-sentiment-batch.cron: COO_SENTIMENT_ENABLED=false, skip');
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      if (stats.totalCheckIns > 0) {
        this.logger.debug(stats, 'checkin-sentiment-batch.cron: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'checkin-sentiment-batch.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    totalCheckIns: number;
    batches: number;
    classified: number;
    failed: number;
  }> {
    const sinceUtc = new Date(now.getTime() - CheckinSentimentBatchCron.LOOKBACK_MS);

    const pending = await this.prisma.dailyCheckIn.findMany({
      where: {
        kind: 'evening',
        sentiment: null,
        completedAt: { gte: sinceUtc },
        rawResponseText: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        rawResponseText: true,
      },
      orderBy: { completedAt: 'asc' },
      take: CheckinSentimentBatchCron.MAX_PER_RUN,
    });

    if (pending.length === 0) {
      return { totalCheckIns: 0, batches: 0, classified: 0, failed: 0 };
    }

    const byTenant = new Map<string, Array<{ checkInId: string; rawText: string }>>();
    for (const row of pending) {
      const list = byTenant.get(row.tenantId) ?? [];
      list.push({
        checkInId: row.id,
        rawText: row.rawResponseText ?? '',
      });
      byTenant.set(row.tenantId, list);
    }

    let totalBatches = 0;
    let totalClassified = 0;
    let totalFailed = 0;
    for (const [tenantId, items] of byTenant) {
      const batches = chunk(items, CHECKIN_SENTIMENT_BATCH_SIZE);
      for (const batch of batches) {
        totalBatches++;
        const { classified, failed } = await this.processBatch({
          tenantId,
          items: batch,
        });
        totalClassified += classified;
        totalFailed += failed;
      }
    }

    return {
      totalCheckIns: pending.length,
      batches: totalBatches,
      classified: totalClassified,
      failed: totalFailed,
    };
  }

  private async processBatch(args: {
    tenantId: string;
    items: CheckinSentimentBatchItem[];
  }): Promise<{ classified: number; failed: number }> {
    const tenantTop = resolveOperationsTenantTop(args.tenantId);
    const ids = args.items.map((c) => c.checkInId);

    try {
      const callPromise = this.llm.call({
        taskType: 'checkin-sentiment-batch',
        tenantId: args.tenantId,
        systemPrompt: CHECKIN_SENTIMENT_BATCH_SYSTEM_PROMPT,
        userMessage: buildCheckinSentimentBatchUserMessage(args.items),
        maxTokens: 8_000,
        tools: [CHECKIN_SENTIMENT_BATCH_TOOL],
        sourceRef: {
          type: 'checkin-batch',
          id: `${args.tenantId}:${ids[0] ?? ''}+${args.items.length - 1}`,
        },
      });
      const result = await Promise.race([
        callPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('checkin-sentiment-batch LLM timeout')),
            CheckinSentimentBatchCron.LLM_TIMEOUT_MS,
          ),
        ),
      ]);

      const toolCall = result.toolCalls?.find((t) => t.name === 'submit_batch_sentiments');
      if (!toolCall) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            ids,
            rawHead: result.text.slice(0, 200),
          },
          'checkin-sentiment-batch: модель не позвала tool — все чек-ины батча остаются null',
        );
        for (let i = 0; i < args.items.length; i++) {
          this.metrics.incCooSentimentFailed({ tenantTop });
        }
        return { classified: 0, failed: args.items.length };
      }

      const parsed = parseCheckinSentimentBatchToolInput(toolCall.input);

      const skippedByParser = Math.max(0, args.items.length - parsed.length);
      for (let i = 0; i < skippedByParser; i++) {
        this.metrics.incCooSentimentFailed({
          tenantTop,
          reason: 'invalid_element',
        });
      }

      if (parsed.length === 0) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            ids,
          },
          'checkin-sentiment-batch: tool_call вернул 0 валидных элементов',
        );
        return { classified: 0, failed: args.items.length };
      }

      const version = `${CHECKIN_SENTIMENT_BATCH_PROMPT_VERSION}+${result.modelUsed}`;
      const idsInBatch = new Set(args.items.map((i) => i.checkInId));
      let classified = 0;
      let updateFailed = 0;
      for (const r of parsed) {
        if (!idsInBatch.has(r.checkInId)) continue;
        try {
          await this.prisma.dailyCheckIn.update({
            where: { id: r.checkInId },
            data: {
              sentiment: r.sentiment,
              sentimentRationale: r.rationale,
              sentimentVersion: version,
              sentimentDeterminedAt: new Date(),
            },
          });
          classified++;
          this.metrics.incCooSentimentAnalyzed({
            tenantTop,
            sentiment: r.sentiment,
          });
        } catch (err) {
          updateFailed++;
          this.metrics.incCooSentimentFailed({ tenantTop });
          this.logger.warn(
            {
              tenantId: args.tenantId,
              checkInId: r.checkInId,
              err: err instanceof Error ? err.message : String(err),
            },
            'checkin-sentiment-batch: ошибка update — sentiment остаётся null',
          );
        }
      }
      const notReturnedByLlm = args.items.length - classified - skippedByParser - updateFailed;
      for (let i = 0; i < Math.max(0, notReturnedByLlm); i++) {
        this.metrics.incCooSentimentFailed({ tenantTop });
      }
      const failed = args.items.length - classified;
      return { classified, failed };
    } catch (err) {
      for (let i = 0; i < args.items.length; i++) {
        this.metrics.incCooSentimentFailed({ tenantTop });
      }
      this.logger.warn(
        {
          tenantId: args.tenantId,
          ids,
          err: err instanceof Error ? err.message : String(err),
        },
        'checkin-sentiment-batch: упал весь батч — чек-ины остаются null до следующего прогона',
      );
      return { classified: 0, failed: args.items.length };
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

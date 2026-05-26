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

/**
 * ТЗ 2026-05-25 LLM-architecture §6 — CheckinSentimentBatchCron.
 *
 * Источник: plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md §6
 * (эксперимент 4 — batch в 2× дешевле и точнее single).
 *
 * Раз в 5 минут (`@Cron('*\/5 * * * *')`) выбирает вечерние чек-ины с
 * `sentiment IS NULL` за последний час, делит на батчи по 10 и для каждого
 * батча делает ОДИН вызов LLM (`taskType='checkin-sentiment-batch'`,
 * primary `deepseek-v4-pro`, tool `submit_batch_sentiments`, max_tokens=8000).
 *
 * Архитектурное решение по триггеру (§6.5 ТЗ, Вариант Б):
 *   - **Batch-cron — основной механизм.** Проще, легче перезапустить,
 *     даёт батчинг по дизайну.
 *   - **Старый event-worker `CheckinSentimentAnalyzerWorker` оставлен как
 *     fallback.** Реагирует мгновенно на отдельный чек-ин — это улучшает
 *     UX для админа («только что заполнили — уже видна метка»). Cron
 *     подбирает все, кого event-worker не успел или для кого LLM упал
 *     (фильтр `sentiment IS NULL`).
 *   - Risk «двойной обработки»: cron всегда фильтрует по `sentiment IS NULL`,
 *     поэтому если event-worker уже проставил — cron не возьмёт.
 *
 * Master-flag — `COO_SENTIMENT_ENABLED` (тот же, что и у event-worker).
 * False → cron срабатывает, но сразу выходит.
 *
 * Best-effort: ошибка в одном батче не валит остальные.
 *
 * Метрики (переиспользуем существующие из BusinessMetricsService):
 *   - `coo_sentiment_analyzed_total{sentiment}` — на каждый успешный результат.
 *   - `coo_sentiment_failed_total` — на каждый чек-ин в упавшем батче.
 */
@Injectable()
export class CheckinSentimentBatchCron {
  private readonly logger = new Logger(CheckinSentimentBatchCron.name);
  private static readonly LLM_TIMEOUT_MS = 60_000;
  /** Окно «свежих» чек-инов (last hour). Защита от долгого backlog'а. */
  private static readonly LOOKBACK_MS = 60 * 60 * 1000;
  /** Максимум чек-инов за один прогон cron'а (10 батчей × 10 = 100). */
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
      this.logger.debug(
        'checkin-sentiment-batch.cron: COO_SENTIMENT_ENABLED=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      if (stats.totalCheckIns > 0) {
        this.logger.log(stats, 'checkin-sentiment-batch.cron: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'checkin-sentiment-batch.cron: непойманная ошибка',
      );
    }
  }

  /**
   * Выделен для unit-тестов: можно передать произвольный `now`.
   */
  async runOnce(now: Date): Promise<{
    totalCheckIns: number;
    batches: number;
    classified: number;
    failed: number;
  }> {
    const sinceUtc = new Date(
      now.getTime() - CheckinSentimentBatchCron.LOOKBACK_MS,
    );

    // Выбираем pending evening чек-ины — `sentiment IS NULL`, есть текст.
    // ORDER BY completedAt ASC чтобы наиболее старые шли первыми (FIFO).
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

    // Группируем по tenantId — каждый Org получает свою цепочку маршрутов
    // (LlmRouter учитывает `tenantId` при выборе провайдера).
    const byTenant = new Map<
      string,
      Array<{ checkInId: string; rawText: string }>
    >();
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

  /**
   * Один batch-вызов LLM + апдейт N чек-инов одного tenant'а.
   * Возвращает { classified, failed } по каждому элементу batch'а.
   */
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
            () =>
              reject(new Error('checkin-sentiment-batch LLM timeout')),
            CheckinSentimentBatchCron.LLM_TIMEOUT_MS,
          ),
        ),
      ]);

      const toolCall = result.toolCalls?.find(
        (t) => t.name === 'submit_batch_sentiments',
      );
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

      // Silent-skip элементов парсером (невалидный sentiment-enum, не
      // строковой checkInId, не-объект и т.п.) — фиксируем как
      // `invalid_element`. Решение пользователя 2026-05-26 (ТЗ §1.4).
      const skippedByParser = Math.max(
        0,
        args.items.length - parsed.length,
      );
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
      // Итог failed = парсер выкинул + update упал + LLM не вернул id из батча.
      // skippedByParser уже посчитан выше; updateFailed уже инкрементирован
      // в catch'е. Остаток (id не найден в parsed) — это «ничего не сделано
      // для записи», fail-метрику пишем тут же.
      const notReturnedByLlm =
        args.items.length - classified - skippedByParser - updateFailed;
      for (let i = 0; i < Math.max(0, notReturnedByLlm); i++) {
        this.metrics.incCooSentimentFailed({ tenantTop });
      }
      const failed = args.items.length - classified;
      return { classified, failed };
    } catch (err) {
      // Весь батч упал — каждый элемент считается failed.
      // Сюда же попадает throw парсера на дубликат checkInId
      // (см. parseCheckinSentimentBatchToolInput, §1.4 ТЗ).
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

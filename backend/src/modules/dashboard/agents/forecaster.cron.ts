import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  FORECASTER_JSON_SCHEMA,
  FORECASTER_SYSTEM_PROMPT,
  buildForecasterUserMessage,
  parseForecasterResponse,
  type ForecasterTrendPoint,
} from '../prompts/forecaster.prompt';

/**
 * Pulse Wave 4 §4.6 — Forecaster cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §4.6.
 *
 * Weekly (`@Cron('0 4 * * 1')`, понедельник 04:00 UTC) для каждой Org
 * считает тренды 4 метрик за последние 4 недели, вызывает LLM-агент
 * `forecast-weekly` и сохраняет результат в `ForecastSnapshot`
 * (scope='company', scopeId=null). Используется в Weekly digest вместо
 * placeholder'а из §2.2.
 *
 * 4 метрики (агрегаты по неделе):
 *   - sentiment_index: (green - red) / total из DailyCheckIn.
 *   - commitment_kept_ratio: kept / (kept+broken+overdue) из IdeaBlock(commitment).
 *   - hanging_decisions: Decision.raisedCount ≥ 2, активные за неделю.
 *   - engagement_score: avg(Person.engagementScore) среди employee'ев Org
 *     (используем PersonEngagementSnapshot — историческая лента).
 *
 * Принципы:
 *   - cache-friendly промпт (стабильный SYSTEM, переменные данные в конце);
 *   - JSON-strict через `responseFormat: json_schema`;
 *   - best-effort: ошибка по одной Org не валит общий проход;
 *   - history: каждую неделю create-запись (не upsert) — для UI трендов;
 *   - EU AI Act: только структурированные метрики, без текстов.
 *
 * Master-flag: пока нет. 1 LLM-вызов на Org в неделю — дёшево.
 */
@Injectable()
export class ForecasterCron {
  private readonly logger = new Logger(ForecasterCron.name);
  private static readonly WEEKS = 4;
  private static readonly WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  /** Жёсткий лимит на размер выборки Org-ов за прогон (страхуем worker memory). */
  private static readonly MAX_ORGS_PER_RUN = 5_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /** Weekly Mon 04:00 UTC (после Engagement-Scorer 03:00 / Burnout 03:45). */
  @Cron('0 4 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'forecaster.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `forecaster.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    snapshotsCreated: number;
    parseErrors: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      take: ForecasterCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let parseErrors = 0;
    let errors = 0;

    const now = new Date();
    for (const org of orgs) {
      orgsProcessed++;
      try {
        const trends = await this.computeTrends({ tenantId: org.id, now });
        const result = await this.llm.call({
          taskType: 'forecast-weekly',
          tenantId: org.id,
          systemPrompt: FORECASTER_SYSTEM_PROMPT,
          userMessage: buildForecasterUserMessage({
            tenantName: org.name,
            trends,
          }),
          maxTokens: 1_200,
          responseFormat: {
            type: 'json_schema',
            name: 'ForecastWeekly',
            schema: FORECASTER_JSON_SCHEMA,
            strict: true,
          },
          sourceRef: { type: 'forecast-weekly', id: org.id },
        });
        const parsed = parseForecasterResponse(result.text);
        if (!parsed) {
          parseErrors++;
          this.logger.warn(
            `forecaster.cron org ${org.id}: парсер не смог разобрать ответ модели (${result.modelUsed})`,
          );
          continue;
        }
        await this.prisma.forecastSnapshot.create({
          data: {
            tenantId: org.id,
            scope: 'company',
            scopeId: null,
            payloadJson: {
              trend: parsed.trend,
              risks: parsed.risks,
              opportunities: parsed.opportunities,
              expectedShifts: parsed.expectedShifts,
              modelName: result.modelUsed,
              provenance: { weeks: ForecasterCron.WEEKS },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        snapshotsCreated++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `forecaster.cron org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, parseErrors, errors };
  }

  /**
   * Считает 4 тренд-точки (одна на неделю) для Org. Каждая точка —
   * структурированный JSON с 4 метриками.
   */
  private async computeTrends(args: {
    tenantId: string;
    now: Date;
  }): Promise<ForecasterTrendPoint[]> {
    const trends: ForecasterTrendPoint[] = [];
    for (let weeksAgo = ForecasterCron.WEEKS; weeksAgo >= 1; weeksAgo--) {
      const start = new Date(
        args.now.getTime() - weeksAgo * ForecasterCron.WEEK_MS,
      );
      const end = new Date(start.getTime() + ForecasterCron.WEEK_MS);
      const point = await this.aggregateWeek({
        tenantId: args.tenantId,
        start,
        end,
      });
      trends.push(point);
    }
    return trends;
  }

  private async aggregateWeek(args: {
    tenantId: string;
    start: Date;
    end: Date;
  }): Promise<ForecasterTrendPoint> {
    const [checkIns, commits, hanging, engagementSnapshots] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: args.start, lt: args.end },
          sentiment: { in: ['green', 'yellow', 'red'] },
        },
        select: { sentiment: true },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentDueDate: { gte: args.start, lt: args.end },
        },
        select: { commitmentStatus: true, commitmentDueDate: true },
      }),
      this.prisma.decision.count({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'proposed', 'approved'] },
          raisedCount: { gte: 2 },
          createdAt: { lt: args.end },
        },
      }),
      this.prisma.personEngagementSnapshot.findMany({
        where: {
          tenantId: args.tenantId,
          snapshotAt: { gte: args.start, lt: args.end },
        },
        select: { score: true },
      }),
    ]);

    // sentiment_index: (green - red) / total, [-1..+1]; null если total=0.
    let g = 0;
    let r = 0;
    for (const c of checkIns) {
      if (c.sentiment === 'green') g++;
      else if (c.sentiment === 'red') r++;
    }
    const total = checkIns.length;
    const sentimentIndex = total > 0 ? round3((g - r) / total) : null;

    // commitment_kept_ratio: kept / (kept+broken+overdue); null если знаменатель=0.
    let kept = 0;
    let broken = 0;
    let overdue = 0;
    const nowEnd = args.end;
    for (const c of commits) {
      const s = c.commitmentStatus;
      if (s === 'fulfilled') kept++;
      else if (s === 'missed') broken++;
      else if (
        (s === 'open' || s === 'asked') &&
        c.commitmentDueDate !== null &&
        c.commitmentDueDate < nowEnd
      ) {
        overdue++;
      }
    }
    const denom = kept + broken + overdue;
    const commitmentKeptRatio = denom > 0 ? round3(kept / denom) : null;

    // engagement_score: avg(score) по снапшотам недели; null если нет данных.
    let engagementScore: number | null = null;
    if (engagementSnapshots.length > 0) {
      const sum = engagementSnapshots.reduce(
        (acc, s) => acc + Number(s.score),
        0,
      );
      engagementScore = round3(sum / engagementSnapshots.length);
    }

    return {
      weekStart: args.start.toISOString().slice(0, 10),
      sentiment_index: sentimentIndex,
      commitment_kept_ratio: commitmentKeptRatio,
      hanging_decisions: hanging,
      engagement_score: engagementScore,
    };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

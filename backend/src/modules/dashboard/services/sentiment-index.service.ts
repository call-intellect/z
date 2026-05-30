import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

/**
 * DTO для KPI hero «Индекс настроения недели» (Pulse Wave 1 §1.3).
 *
 * Внимание: это НЕ eNPS — eNPS строится на опросе 0-10 с тремя бакетами
 * (promoter/passive/detractor), а здесь — три цветовые категории
 * `green/yellow/red` за окно. Шкалы несовместимы, в UI не подменять.
 */
export interface SentimentIndexDto {
  /**
   * Индекс настроения недели: `(greenShare - redShare) * 100`.
   * Диапазон `[-100..+100]`. `>0` = больше зелёных, `<0` = больше красных.
   * Округление до целого. `0` если `totalCheckIns=0`.
   *
   * НЕ называть eNPS в UI: это другая шкала (eNPS строится на 0-10 опросе
   * с тремя бакетами, не на трёх color-категориях за неделю).
   */
  value: number;
  /**
   * `'up'` если sentiment улучшается (`redShareDelta < -0.05`).
   * `'down'` если ухудшается (`redShareDelta > 0.05`).
   * `'flat'` иначе (включая `redShareDelta=null`).
   */
  trend: 'up' | 'flat' | 'down';
  /**
   * Sparkline за 12 недель индекса настроения, `old→new` (index 0 = неделя
   * 12 недель назад, index 11 = последняя завершившаяся неделя). Значения
   * в диапазоне `[-100..+100]`. `null` для недель без чек-инов.
   */
  sparkline12w: Array<number | null>;
  /** Всего чек-инов за текущее окно (`days`, default 7). */
  totalCheckIns: number;
  /** Окно расчёта `value` и `trend` в днях. */
  days: number;
}

const DEFAULT_DAYS = 7;
const SPARKLINE_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 5 * 60;

/**
 * SentimentIndexService — KPI hero «Индекс настроения недели» (Pulse Wave 1 §1.3).
 *
 * Формула: `(greenShare - redShare) * 100`, диапазон -100..+100. >0 = команда
 * скорее зелёная, <0 = скорее красная.
 *
 * Использует существующий `OperationsDashboardService.getTeamTemperature` для
 * текущего окна (single source of truth). Sparkline 12 недель строит сам прямой
 * выборкой `DailyCheckIn` — отдельный grouped query.
 *
 * Redis-кэш 5 минут. Не называть в UI eNPS.
 */
@Injectable()
export class SentimentIndexService {
  private readonly logger = new Logger(SentimentIndexService.name);

  /** Порог дельты для `trend` (5 п.п.). */
  private static readonly TREND_THRESHOLD = 0.05;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OperationsDashboardService)
    private readonly ops: OperationsDashboardService,
  ) {}

  async getIndex(args: {
    tenantId: string;
    days?: number;
  }): Promise<SentimentIndexDto> {
    const days = args.days ?? DEFAULT_DAYS;
    return this.compute({ tenantId: args.tenantId, days, now: new Date() });
  }

  /** Public для тестов — можно подменить `now`. */
  async compute(args: {
    tenantId: string;
    days: number;
    now: Date;
  }): Promise<SentimentIndexDto> {
    const cacheKey = `sentiment_index:${args.tenantId}:${args.days}`;

    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as SentimentIndexDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Current value через переиспользование getTeamTemperature.
    const temp = await this.ops.getTeamTemperature({
      tenantId: args.tenantId,
      days: args.days,
    });
    const value = Math.round((temp.greenShare - temp.redShare) * 100);

    let trend: 'up' | 'flat' | 'down' = 'flat';
    if (temp.redShareDelta !== null) {
      if (temp.redShareDelta < -SentimentIndexService.TREND_THRESHOLD)
        trend = 'up';
      else if (temp.redShareDelta > SentimentIndexService.TREND_THRESHOLD)
        trend = 'down';
    }

    const sparkline12w = await this.buildSparkline(args.tenantId, args.now);

    const result: SentimentIndexDto = {
      value,
      trend,
      sparkline12w,
      totalCheckIns: temp.totalCheckIns,
      days: args.days,
    };

    try {
      await this.redis.client.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }

  /**
   * Sparkline 12 еженедельных значений индекса. Одной выборкой берём все
   * чек-ины с `sentiment` за последние 12 недель, в коде группируем по неделям.
   *
   * Индекс 0 — самая старая неделя (`now - 12*7d`), индекс 11 — последняя.
   * Чек-ины с `sentiment=null` и `sentimentDeterminedAt=null` отсекаются на
   * уровне where (`sentiment IN ('green','yellow','red')`).
   */
  private async buildSparkline(
    tenantId: string,
    now: Date,
  ): Promise<Array<number | null>> {
    const sparklineStart = new Date(now.getTime() - SPARKLINE_WEEKS * WEEK_MS);

    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        sentiment: { in: ['green', 'yellow', 'red'] },
        createdAt: { gte: sparklineStart, lt: now },
      },
      select: { sentiment: true, createdAt: true },
    });

    const buckets: Array<{ green: number; red: number; total: number }> =
      Array.from({ length: SPARKLINE_WEEKS }, () => ({
        green: 0,
        red: 0,
        total: 0,
      }));

    const startMs = sparklineStart.getTime();
    const nowMs = now.getTime();
    for (const c of checkIns) {
      const t = c.createdAt.getTime();
      if (t < startMs || t >= nowMs) continue;
      const idx = Math.min(
        SPARKLINE_WEEKS - 1,
        Math.floor((t - startMs) / WEEK_MS),
      );
      const bucket = buckets[idx];
      if (!bucket) continue;
      bucket.total++;
      if (c.sentiment === 'green') bucket.green++;
      else if (c.sentiment === 'red') bucket.red++;
    }

    return buckets.map((b) => {
      if (b.total === 0) return null;
      const greenShare = b.green / b.total;
      const redShare = b.red / b.total;
      return Math.round((greenShare - redShare) * 100);
    });
  }
}

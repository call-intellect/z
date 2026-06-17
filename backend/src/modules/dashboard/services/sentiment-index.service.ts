import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

export interface SentimentIndexDto {
  value: number;
  trend: 'up' | 'flat' | 'down';
  sparkline12w: Array<number | null>;
  totalCheckIns: number;
  days: number;
}

const DEFAULT_DAYS = 7;
const SPARKLINE_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 5 * 60;

@Injectable()
export class SentimentIndexService {
  private readonly logger = new Logger(SentimentIndexService.name);

  private static readonly TREND_THRESHOLD = 0.05;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OperationsDashboardService)
    private readonly ops: OperationsDashboardService,
  ) {}

  async getIndex(args: { tenantId: string; days?: number }): Promise<SentimentIndexDto> {
    const days = args.days ?? DEFAULT_DAYS;
    return this.compute({ tenantId: args.tenantId, days, now: new Date() });
  }

  async compute(args: { tenantId: string; days: number; now: Date }): Promise<SentimentIndexDto> {
    const cacheKey = `sentiment_index:${args.tenantId}:${args.days}`;

    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as SentimentIndexDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const temp = await this.ops.getTeamTemperature({
      tenantId: args.tenantId,
      days: args.days,
    });
    const value = Math.round((temp.greenShare - temp.redShare) * 100);

    let trend: 'up' | 'flat' | 'down' = 'flat';
    if (temp.redShareDelta !== null) {
      if (temp.redShareDelta < -SentimentIndexService.TREND_THRESHOLD) trend = 'up';
      else if (temp.redShareDelta > SentimentIndexService.TREND_THRESHOLD) trend = 'down';
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
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }

  private async buildSparkline(tenantId: string, now: Date): Promise<Array<number | null>> {
    const sparklineStart = new Date(now.getTime() - SPARKLINE_WEEKS * WEEK_MS);

    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        sentiment: { in: ['green', 'yellow', 'red'] },
        createdAt: { gte: sparklineStart, lt: now },
      },
      select: { sentiment: true, createdAt: true },
    });

    const buckets: Array<{ green: number; red: number; total: number }> = Array.from(
      { length: SPARKLINE_WEEKS },
      () => ({
        green: 0,
        red: 0,
        total: 0,
      }),
    );

    const startMs = sparklineStart.getTime();
    const nowMs = now.getTime();
    for (const c of checkIns) {
      const t = c.createdAt.getTime();
      if (t < startMs || t >= nowMs) continue;
      const idx = Math.min(SPARKLINE_WEEKS - 1, Math.floor((t - startMs) / WEEK_MS));
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

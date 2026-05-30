import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * HangingDecisionsService — счётчик «висящих» решений: тех, что
 * status ∈ {proposed, approved, active}, возраст ≥ minAgeDays, и поднимались
 * ≥ minRaisedCount раз. Pulse Wave 1 §1.2.
 *
 * Используется KPI hero «Висящие решения» (Фаза 1.5) и drill-down
 * /decisions?status=hanging. Sparkline 12w показывает тренд повторных
 * упоминаний по неделям.
 */
export interface HangingDecisionsDto {
  /** Текущее число висящих решений по фильтру. */
  count: number;
  /** Параметры запроса (для дебага UI). */
  minAgeDays: number;
  minRaisedCount: number;
  /**
   * Sparkline 12 недель: для каждой недели — число «merge-событий»
   * (lastRaisedAt в этой неделе) для решений, удовлетворяющих критерию
   * hanging ПО ИТОГУ окна. Old→new, длина 12.
   */
  sparkline12w: number[];
}

const HANGING_STATUSES = ['proposed', 'approved', 'active'] as const;

@Injectable()
export class HangingDecisionsService {
  private readonly logger = new Logger(HangingDecisionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async count(args: {
    tenantId: string;
    minAgeDays?: number;
    minRaisedCount?: number;
  }): Promise<HangingDecisionsDto> {
    const minAgeDays = args.minAgeDays ?? 7;
    const minRaisedCount = args.minRaisedCount ?? 2;
    return this.compute({
      tenantId: args.tenantId,
      minAgeDays,
      minRaisedCount,
      now: new Date(),
    });
  }

  /** Public для тестов — можно подменить `now`. */
  async compute(args: {
    tenantId: string;
    minAgeDays: number;
    minRaisedCount: number;
    now: Date;
  }): Promise<HangingDecisionsDto> {
    const cacheKey = `hanging_decisions:${args.tenantId}:${args.minAgeDays}:${args.minRaisedCount}`;

    // Cache get.
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as HangingDecisionsDto;
      }
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const ageThreshold = new Date(
      args.now.getTime() - args.minAgeDays * 24 * 60 * 60 * 1000,
    );

    // Текущий count.
    const count = await this.prisma.decision.count({
      where: {
        tenantId: args.tenantId,
        status: { in: [...HANGING_STATUSES] },
        createdAt: { lte: ageThreshold },
        raisedCount: { gte: args.minRaisedCount },
      },
    });

    // Sparkline 12w: одной выборкой берём все decisions, удовлетворяющие
    // критерию hanging, с lastRaisedAt за последние 12 недель.
    const weeksBack = 12;
    const sparklineStart = new Date(
      args.now.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000,
    );

    const events = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: [...HANGING_STATUSES] },
        createdAt: { lte: ageThreshold },
        raisedCount: { gte: args.minRaisedCount },
        lastRaisedAt: { gte: sparklineStart, lt: args.now },
      },
      select: { lastRaisedAt: true },
    });

    const sparkline12w = this.bucketize(events, args.now, weeksBack);

    const result: HangingDecisionsDto = {
      count,
      minAgeDays: args.minAgeDays,
      minRaisedCount: args.minRaisedCount,
      sparkline12w,
    };

    // Cache set.
    try {
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }

  /**
   * Раскладывает массив событий по 12 недельным bucket'ам.
   * bucket[0] = самая старая неделя ([now-12w, now-11w)),
   * bucket[11] = последняя завершившаяся неделя ([now-1w, now)).
   */
  private bucketize(
    events: Array<{ lastRaisedAt: Date | null }>,
    now: Date,
    weeksBack: number,
  ): number[] {
    const buckets = new Array<number>(weeksBack).fill(0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const sparklineStart = now.getTime() - weeksBack * weekMs;

    for (const e of events) {
      if (!e.lastRaisedAt) continue;
      const t = e.lastRaisedAt.getTime();
      if (t < sparklineStart || t >= now.getTime()) continue;
      const offset = t - sparklineStart;
      const idx = Math.min(weeksBack - 1, Math.floor(offset / weekMs));
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }

    return buckets;
  }
}

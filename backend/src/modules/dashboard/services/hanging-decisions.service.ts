import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

export interface HangingDecisionsDto {
  count: number;
  minAgeDays: number;
  minRaisedCount: number;
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

  async listHangingWithAuthors(args: {
    tenantId: string;
    minAgeDays?: number;
    minRaisedCount?: number;
    now?: Date;
  }): Promise<Array<{ id: string; decidedByPersonIds: string[] }>> {
    const minAgeDays = args.minAgeDays ?? 7;
    const minRaisedCount = args.minRaisedCount ?? 2;
    const now = args.now ?? new Date();
    const ageThreshold = new Date(now.getTime() - minAgeDays * 24 * 60 * 60 * 1000);
    return this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: [...HANGING_STATUSES] },
        createdAt: { lte: ageThreshold },
        raisedCount: { gte: minRaisedCount },
      },
      select: { id: true, decidedByPersonIds: true },
    });
  }

  async compute(args: {
    tenantId: string;
    minAgeDays: number;
    minRaisedCount: number;
    now: Date;
  }): Promise<HangingDecisionsDto> {
    const cacheKey = `hanging_decisions:${args.tenantId}:${args.minAgeDays}:${args.minRaisedCount}`;

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

    const ageThreshold = new Date(args.now.getTime() - args.minAgeDays * 24 * 60 * 60 * 1000);

    const count = await this.prisma.decision.count({
      where: {
        tenantId: args.tenantId,
        status: { in: [...HANGING_STATUSES] },
        createdAt: { lte: ageThreshold },
        raisedCount: { gte: args.minRaisedCount },
      },
    });

    const weeksBack = 12;
    const sparklineStart = new Date(args.now.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000);

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

    try {
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }

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

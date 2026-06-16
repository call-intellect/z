import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

import {
  PROBE_ENGAGEMENT_TTL_SEC,
  probeEngagementRedisKey,
  probeTopicCooldownRedisKey,
} from './probe-fatigue.util';

@Injectable()
export class ProbePriorityCron {
  private readonly logger = new Logger(ProbePriorityCron.name);
  private static readonly LOOKBACK_DAYS = 30;
  private static readonly USER_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - ProbePriorityCron.LOOKBACK_DAYS * 24 * 3600 * 1000);

      const expiredCandidates = await this.prisma.probeEvent.findMany({
        where: {
          status: { in: ['pending', 'queued_digest', 'routed_to_digest'] },
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          dispatchedNotificationId: true,
          reason: true,
          tenantId: true,
          contentHash: true,
        },
      });
      const expirable: Array<{
        id: string;
        reason: string;
        tenantId: string;
        contentHash: string;
      }> = [];
      for (const cand of expiredCandidates) {
        if (cand.dispatchedNotificationId) {
          const n = await this.prisma.notification.findUnique({
            where: { id: cand.dispatchedNotificationId },
            select: { respondedAt: true },
          });
          if (n?.respondedAt) continue;
        }
        expirable.push({
          id: cand.id,
          reason: cand.reason,
          tenantId: cand.tenantId,
          contentHash: cand.contentHash,
        });
      }
      let expiredCount = 0;
      if (expirable.length > 0) {
        const expired = await this.prisma.probeEvent.updateMany({
          where: {
            id: { in: expirable.map((e) => e.id) },
            status: { in: ['pending', 'queued_digest', 'routed_to_digest'] },
          },
          data: { status: 'expired' },
        });
        expiredCount = expired.count;
        for (let i = 0; i < expired.count; i++) this.metrics.incProbeExpired();
        await this.recordIgnoredOutcomes(expirable);
      }

      const sent = await this.prisma.notification.groupBy({
        by: ['recipientUserId'],
        where: {
          eventType: 'probe.question',
          createdAt: { gte: cutoff },
        },
        _count: { _all: true },
        orderBy: { recipientUserId: 'asc' },
        take: ProbePriorityCron.USER_LIMIT,
      });

      let usersDone = 0;
      for (const row of sent) {
        const sentCount = (row as { _count: { _all: number } })._count._all;
        const userId = (row as { recipientUserId: string }).recipientUserId;
        if (sentCount === 0) continue;
        const answeredCount = await this.prisma.notification.count({
          where: {
            recipientUserId: userId,
            eventType: 'probe.question',
            responseStatus: 'answered',
            createdAt: { gte: cutoff },
          },
        });
        const rate = answeredCount / sentCount;
        this.metrics.setProbeRecipientEngagementRate({ userId, rate });
        try {
          await this.redis.client.set(
            probeEngagementRedisKey(userId),
            String(rate),
            'EX',
            PROBE_ENGAGEMENT_TTL_SEC,
          );
        } catch {}
        usersDone += 1;
      }

      this.logger.debug({ expiredCount, users: usersDone }, 'probe-priority: sweep завершён');
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'probe-priority: ошибка прохода — пропускаю',
      );
    }
  }

  private async recordIgnoredOutcomes(
    expired: Array<{ reason: string; tenantId: string; contentHash: string }>,
  ): Promise<void> {
    for (const e of expired) {
      this.metrics.incProbeOutcome({ outcome: 'ignored', reason: e.reason });
    }
    try {
      const cooldownHours = await this.cfg.getDynamic<number>(
        'probe.topicCooldownHours',
        undefined,
        48,
      );
      const ttlSec = Math.max(1, Math.round(cooldownHours * 3600));
      for (const e of expired) {
        try {
          await this.redis.client.set(
            probeTopicCooldownRedisKey(e.tenantId, e.contentHash),
            '1',
            'EX',
            ttlSec,
          );
        } catch {}
      }
    } catch {}
  }
}

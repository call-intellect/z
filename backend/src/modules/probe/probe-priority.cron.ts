import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CoreQueueService } from '../core-queue/core-queue.service';

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
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(
        now.getTime() - ProbePriorityCron.LOOKBACK_DAYS * 24 * 3600 * 1000,
      );

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
          payload: true,
          recipientCandidates: true,
          priority: true,
          emittedByService: true,
        },
      });
      const expirable: ExpirableProbe[] = [];
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
          payload: cand.payload,
          recipientCandidates: cand.recipientCandidates,
          priority: cand.priority,
          emittedByService: cand.emittedByService,
        });
      }

      const reaskEnabled = await this.readReaskEnabled();
      const reaskGroup: ExpirableProbe[] = [];
      const closeGroup: ExpirableProbe[] = [];
      for (const e of expirable) {
        const reaskCount = this.readReaskCount(e.payload);
        if (reaskEnabled && reaskCount < 1) reaskGroup.push(e);
        else closeGroup.push(e);
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
        await this.recordIgnoredOutcomes(closeGroup);
        for (const e of reaskGroup) await this.createReask(e);
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
        } catch {
          /* eslint-disable-next-line no-empty */
        }
        usersDone += 1;
      }

      this.logger.debug(
        { expiredCount, users: usersDone },
        'probe-priority: sweep завершён',
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'probe-priority: ошибка прохода — пропускаю',
      );
    }
  }

  private async recordIgnoredOutcomes(
    expired: ExpirableProbe[],
  ): Promise<void> {
    if (expired.length === 0) return;
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
        } catch {
          /* eslint-disable-next-line no-empty */
        }
      }
    } catch {
      /* eslint-disable-next-line no-empty */
    }
  }

  private async readReaskEnabled(): Promise<boolean> {
    try {
      return await this.cfg.getDynamic<boolean>(
        'probe.reaskEnabled',
        undefined,
        true,
      );
    } catch {
      return true;
    }
  }

  private readReaskCount(payload: Prisma.JsonValue): number {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const raw = (payload as Record<string, unknown>).reaskCount;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  private async createReask(src: ExpirableProbe): Promise<void> {
    try {
      const basePayload =
        src.payload &&
        typeof src.payload === 'object' &&
        !Array.isArray(src.payload)
          ? (src.payload as Record<string, unknown>)
          : {};
      const reaskPayload: Prisma.InputJsonValue = {
        ...basePayload,
        reaskCount: 1,
        originalProbeEventId: src.id,
      };
      const reask = await this.prisma.probeEvent.create({
        data: {
          tenantId: src.tenantId,
          emittedByService: src.emittedByService,
          reason: src.reason,
          payload: reaskPayload,
          recipientCandidates: [...src.recipientCandidates],
          contentHash: src.contentHash,
          priority: src.priority,
          status: 'pending',
          expiresAt: this.computeExpiresAt(),
        },
      });
      this.metrics.incProbeEvent({
        emittedByService: src.emittedByService,
        reason: src.reason,
        status: 'pending',
      });
      await this.queue.enqueueProbeEvent({ probeEventId: reask.id });
      this.logger.log(
        `probe re-ask: создан переспрос id=${reask.id} (исходный=${src.id} reason=${src.reason})`,
      );
    } catch (err) {
      this.logger.warn(
        {
          originalProbeEventId: src.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-priority: createReask упал — переспрос не создан (исходный уже expired)',
      );
    }
  }

  private computeExpiresAt(): Date {
    return new Date(Date.now() + this.cfg.probe.expiryDays * 24 * 3600 * 1000);
  }
}

interface ExpirableProbe {
  id: string;
  reason: string;
  tenantId: string;
  contentHash: string;
  payload: Prisma.JsonValue;
  recipientCandidates: string[];
  priority: number;
  emittedByService: string;
}

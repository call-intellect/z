import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * SBA β-5 — ProbePriorityCron (Layer 6).
 *
 * Каждые 15 минут:
 *   1. Пересчитывает engagement_rate per-user (отвечено за 30д / отправлено
 *      за 30д) и выставляет gauge `probe_recipient_engagement_rate{user_id}`.
 *   2. Помечает истёкшие ProbeEvent (`expiresAt < now` AND status='pending')
 *      статусом 'expired' (+ метрика probe_expired_total).
 *
 * Cron-выражение в декораторе литералом (NestJS @Cron не читает ENV). Если
 * `PROBE_PRIORITY_REFRESH_CRON` отличается — заменить декоратор.
 */
@Injectable()
export class ProbePriorityCron {
  private readonly logger = new Logger(ProbePriorityCron.name);
  private static readonly LOOKBACK_DAYS = 30;
  private static readonly USER_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(
        now.getTime() - ProbePriorityCron.LOOKBACK_DAYS * 24 * 3600 * 1000,
      );

      // 1. Истёкшие ProbeEvent → expired.
      const expired = await this.prisma.probeEvent.updateMany({
        where: {
          status: 'pending',
          expiresAt: { lt: now },
        },
        data: { status: 'expired' },
      });
      for (let i = 0; i < expired.count; i++) this.metrics.incProbeExpired();

      // 2. engagement_rate per recipient.
      // Считаем по probe-уведомлениям (eventType='probe.question') за 30 дней.
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
        usersDone += 1;
      }

      this.logger.debug(
        { expiredCount: expired.count, users: usersDone },
        'probe-priority: sweep завершён',
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'probe-priority: ошибка прохода — пропускаю',
      );
    }
  }
}

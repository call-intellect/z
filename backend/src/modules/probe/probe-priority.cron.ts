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
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(
        now.getTime() - ProbePriorityCron.LOOKBACK_DAYS * 24 * 3600 * 1000,
      );

      // 1. Истёкшие ProbeEvent → expired.
      // SBA β-5 closing-loop (sub-TZ 2026-05-23): дополнительно фильтруем
      // probe'ы, у которых dispatchedNotificationId уже отвечен
      // (`Notification.respondedAt IS NOT NULL`). Так мы избегаем гонки
      // «истёк по таймеру, хотя ответ только что пришёл» — закрытый probe
      // не должен пере-помечаться `expired`.
      const expiredCandidates = await this.prisma.probeEvent.findMany({
        where: {
          status: 'pending',
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          dispatchedNotificationId: true,
          // Probe Фаза 5 — для исход-сигнала (ignored) и cooldown темы.
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
          if (n?.respondedAt) continue; // уже закрыт пользователем — пропускаем
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
          where: { id: { in: expirable.map((e) => e.id) }, status: 'pending' },
          data: { status: 'expired' },
        });
        expiredCount = expired.count;
        for (let i = 0; i < expired.count; i++) this.metrics.incProbeExpired();
        // Probe Фаза 5 (R10): истёкший без ответа = исход «ignored» (сигнал
        // калибровки Фазы 2). Тему ставим на cooldown — не доставать человека
        // тем же вопросом в течение probe.topicCooldownHours.
        await this.recordIgnoredOutcomes(expirable);
      }

      // 2. engagement_rate per recipient.
      // Считаем по probe-уведомлениям (eventType='probe.question') за 30 дней.
      // SBA β-5 closing-loop: `respondedAt IS NULL` в знаменателе НЕ
      // вычитаем — знаменатель = «всего отправлено», числитель = «отвечено»
      // (`responseStatus='answered'`, что эквивалентно `respondedAt IS NOT NULL`).
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
        // Probe Фаза 5 — снимок engagement в Redis: filterByRateLimit режет
        // бюджет низко-отзывчивым (adaptive fatigue). Best-effort.
        try {
          await this.redis.client.set(
            probeEngagementRedisKey(userId),
            String(rate),
            'EX',
            PROBE_ENGAGEMENT_TTL_SEC,
          );
        } catch {
          // Redis down — adaptive просто не применится (graceful).
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

  /**
   * Probe Фаза 5 — для каждого истёкшего без ответа probe:
   *   - метрика `probe_outcome_total{outcome=ignored, reason}` (калибровка Фазы 2);
   *   - cooldown темы (`contentHash`) в Redis на `probe.topicCooldownHours` —
   *     не доставать человека тем же вопросом сразу после игнора.
   * Best-effort: ошибки Redis/настроек не валят sweep.
   */
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
        } catch {
          // Redis down — cooldown просто не применится (graceful).
        }
      }
    } catch {
      // настройка недоступна — пропускаем cooldown.
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { PendingActionsService } from '../../pending-actions/services/pending-actions.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class ExecMorningPushCron {
  private readonly logger = new Logger(ExecMorningPushCron.name);

  private static readonly DEFAULT_MORNING_HOUR = 9;

  private static readonly DEDUP_KEY_PREFIX = 'exec-morning-push';
  private static readonly DEDUP_TTL_SEC = 90_000;

  private static readonly MAX_RECIPIENTS_PER_RUN = 5_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.daily_digest.deliver_to_webpush',
      'OPS_DIGEST_DELIVER_TO_WEBPUSH',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'exec-morning-push.cron: operations.daily_digest.deliver_to_webpush=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'exec-morning-push.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'exec-morning-push.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    processed: number;
    delivered: number;
    skippedOutsideWindow: number;
    skippedEmpty: number;
    skippedAlreadyDelivered: number;
    errors: number;
  }> {
    const morningHour = await this.resolveMorningHour();

    const memberships = await this.prisma.membership.findMany({
      where: { role: { in: ['owner', 'admin'] } },
      select: { orgId: true, userId: true },
      take: ExecMorningPushCron.MAX_RECIPIENTS_PER_RUN,
    });

    let processed = 0;
    let delivered = 0;
    let skippedOutsideWindow = 0;
    let skippedEmpty = 0;
    let skippedAlreadyDelivered = 0;
    let errors = 0;

    const timezoneByKey = await this.loadTimezones(memberships);

    for (const m of memberships) {
      processed++;
      const tenantId = m.orgId;
      const userId = m.userId;
      const tenantTop = resolveOperationsTenantTop(tenantId);
      const tz = timezoneByKey.get(`${userId}:${tenantId}`) ?? null;

      const localHour = getLocalHour(now, tz);
      if (localHour !== morningHour) {
        skippedOutsideWindow++;
        continue;
      }

      const dateLocal = getLocalDate(now, tz);

      try {
        const setResult = await this.redis.client.set(
          `${ExecMorningPushCron.DEDUP_KEY_PREFIX}:${tenantId}:${userId}:${dateLocal}`,
          '1',
          'EX',
          ExecMorningPushCron.DEDUP_TTL_SEC,
          'NX',
        );
        if (setResult !== 'OK') {
          skippedAlreadyDelivered++;
          continue;
        }

        const { total } = await this.pendingActions.getCount({ tenantId, userId });
        if (total <= 0) {
          skippedEmpty++;
          continue;
        }

        await this.coreQueue.enqueuePushSend({
          tenantId,
          userId,
          title: 'Кора',
          body: `Требует тебя сегодня: ${total}`,
          data: { url: '/dashboard' },
        });
        this.metrics.incExecMorningPushDelivered({ channel: 'webpush' });
        delivered++;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId,
            userId,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'exec-morning-push.cron: ошибка по пользователю',
        );
      }
    }

    return {
      processed,
      delivered,
      skippedOutsideWindow,
      skippedEmpty,
      skippedAlreadyDelivered,
      errors,
    };
  }

  private async loadTimezones(
    memberships: Array<{ orgId: string; userId: string }>,
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (memberships.length === 0) return out;
    const userIds = [...new Set(memberships.map((m) => m.userId))];
    const persons = await this.prisma.person.findMany({
      where: { deletedAt: null, userId: { in: userIds } },
      select: { userId: true, tenantId: true, timezone: true },
    });
    for (const p of persons) {
      if (!p.userId) continue;
      out.set(`${p.userId}:${p.tenantId}`, p.timezone);
    }
    return out;
  }

  private async resolveMorningHour(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'operations.daily_digest.webpush_morning_hour',
      'OPS_DIGEST_WEBPUSH_MORNING_HOUR',
      ExecMorningPushCron.DEFAULT_MORNING_HOUR,
    );
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 23
      ? Math.floor(v)
      : ExecMorningPushCron.DEFAULT_MORNING_HOUR;
  }
}

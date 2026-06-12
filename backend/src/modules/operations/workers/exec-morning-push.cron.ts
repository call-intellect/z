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

/**
 * B6/Ф7 (remaining-handoff / mobile-cora-exec-manager §Ф7) — ExecMorningPushCron.
 *
 * ПЕРВОЕ подключение браузерного web-push к утреннему циклу. До этого
 * `PushSubscription` / `WebPushSender` / очередь `core.push-send` были
 * построены, но НИ ОДИН крон не звал `enqueuePushSend` — web-push физически
 * не запускался. Этот крон закрывает разрыв.
 *
 * Раз в час (`@Cron('0 * * * *')`) обходит руководителей (Membership с
 * role ∈ {owner, admin} и привязанным User) и для тех, у кого локальный час ==
 * утреннему окну (`operations.daily_digest.webpush_morning_hour`, default 9),
 * считает N = «Требует тебя сегодня» (PendingActionsService.getCount.total) и,
 * если N > 0, отправляет браузерный web-push «Кора · Требует тебя сегодня: N»
 * через `CoreQueueService.enqueuePushSend` (`data.url='/dashboard'` — тап
 * открывает мобильный «Обзор»).
 *
 * Тихие часы соблюдаются тем, что шлём ТОЛЬКО в утреннее окно (один час в
 * сутки в TZ пользователя). Пустым (N===0) — не спамим.
 *
 * Master kill-switch `operations.daily_digest.deliver_to_webpush` (ON по
 * умолчанию, Ship-On). False → крон тикает, но сразу выходит.
 *
 * Идемпотентность — Redis NX-гард `exec-morning-push:<tenantId>:<userId>:<dateLocal>`
 * (TTL ~25ч): не более одного web-push на пользователя в локальные сутки.
 *
 * NB: без VAPID-ключей `WebPushSender` делает graceful no-op — это норма
 * (ключи задаёт владелец на проде; Ship-On).
 *
 * Метрика: `z_exec_morning_push_delivered_total{channel}` (channel='webpush').
 */
@Injectable()
export class ExecMorningPushCron {
  private readonly logger = new Logger(ExecMorningPushCron.name);

  private static readonly DEFAULT_MORNING_HOUR = 9;

  /** Префикс Redis-ключа идемпотентности (один push на пользователя в сутки). */
  private static readonly DEDUP_KEY_PREFIX = 'exec-morning-push';
  /** ~25 часов: гарантированно покрывает локальные сутки с запасом на TZ-сдвиги. */
  private static readonly DEDUP_TTL_SEC = 90_000;

  /** Защита от runaway: максимум руководителей за один проход. */
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
      this.logger.log(stats, 'exec-morning-push.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'exec-morning-push.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    processed: number;
    delivered: number;
    skippedOutsideWindow: number;
    skippedEmpty: number;
    skippedAlreadyDelivered: number;
    errors: number;
  }> {
    const morningHour = await this.resolveMorningHour();

    // Аудитория — руководители: Membership с role ∈ {owner, admin} и
    // привязанным User. tenantId берём прямо из Membership.orgId (не через
    // глобальный канал) — путь чистый и однозначный.
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

    // Batch-резолв Person.timezone по ключу `userId:tenantId` (default —
    // 'Europe/Moscow', если Person для пользователя в этой Org нет).
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
        // Идемпотентность — один web-push на пользователя в локальные сутки.
        // NX: ключ уже есть (set вернул не 'OK', т.е. null) → уже отправлено.
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

        // N = «Требует тебя сегодня» — единый агрегатор Action Center.
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

  /**
   * Batch-резолв Person.timezone по ключу `userId:tenantId`. Если Person для
   * пользователя в этой Org не найден — ключа не будет, и caller возьмёт
   * default ('Europe/Moscow' внутри getLocalHour/getLocalDate при null).
   */
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

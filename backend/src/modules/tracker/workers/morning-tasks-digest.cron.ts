import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { ChannelKind } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import type { ConversationalJson } from '../../conversational/types/channel.types';
import {
  buildTasksDailyOpenPayload,
  groupOpenIssuesByUser,
  MorningTasksDigestService,
} from '../services/morning-tasks-digest.service';

const DEFAULT_CHANNELS = ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'];

@Injectable()
export class MorningTasksDigestCron {
  private readonly logger = new Logger(MorningTasksDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MorningTasksDigestService) private readonly digest: MorningTasksDigestService,
    @Inject(ConversationalService) private readonly conversational: ConversationalService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Europe/Moscow' })
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'morning-tasks-digest: непойманная ошибка',
      );
    }
  }

  async run(now: Date = new Date()): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.morningDigest.enabled',
      undefined,
      true,
    );
    if (!enabled) {
      return;
    }

    const mskHour =
      Number(
        new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow',
          hour: '2-digit',
          hour12: false,
        }).format(now),
      ) % 24;
    const mskDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
    const parts = mskDate.split('-');
    const startOfTodayMskUtc = new Date(
      Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0) - 3 * 3600_000,
    );

    const hourMsk = await this.cfg.getDynamic<number>(
      'tracker.morningDigest.hourMsk',
      undefined,
      9,
    );
    if (mskHour !== hourMsk) {
      return;
    }

    const maxItemsTotal = await this.cfg.getDynamic<number>(
      'tracker.morningDigest.maxItemsTotal',
      undefined,
      50,
    );
    const sendWhenEmpty = await this.cfg.getDynamic<boolean>(
      'tracker.morningDigest.sendWhenEmpty',
      undefined,
      true,
    );
    const channelsRaw = await this.cfg.getDynamic<string[]>(
      'tracker.morningDigest.channels',
      undefined,
      DEFAULT_CHANNELS,
    );
    let channels = channelsRaw;
    if (!Array.isArray(channels) || channels.length === 0) {
      this.logger.warn('morning-tasks-digest: пустой список каналов — фолбэк на ["in_app"]');
      channels = ['in_app'];
    }

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let sent = 0;
    for (const org of orgs) {
      const tenantId = org.id;
      const memberIds = await this.digest.listActiveMemberUserIds(tenantId);
      const rows = await this.digest.listOpenAssignedIssues(tenantId);
      const byUser = groupOpenIssuesByUser(rows);

      for (const userId of memberIds) {
        try {
          const already = await this.prisma.notification.findFirst({
            where: {
              tenantId,
              recipientUserId: userId,
              eventType: 'tasks.daily_open',
              createdAt: { gte: startOfTodayMskUtc },
            },
            select: { id: true },
          });
          if (already) {
            continue;
          }

          const openIssues = byUser.get(userId) ?? [];
          if (openIssues.length === 0 && !sendWhenEmpty) {
            continue;
          }

          const payload = buildTasksDailyOpenPayload({ openIssues, now, maxItemsTotal });
          await this.conversational.sendNotification({
            tenantId,
            recipientUserId: userId,
            eventType: 'tasks.daily_open',
            payload: payload as unknown as ConversationalJson,
            dataClass: 'internal',
            preferredChannelKinds: channels as ChannelKind[],
            priorityTier: 3,
          });
          this.metrics.incMorningTasksDigest({ isEmpty: payload.isEmpty });
          sent++;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'morning-tasks-digest: пропустил получателя — продолжаем',
          );
        }
      }
    }

    this.logger.debug({ orgs: orgs.length, sent }, 'morning-tasks-digest: проход завершён');
  }
}

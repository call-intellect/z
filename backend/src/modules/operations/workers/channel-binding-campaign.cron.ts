import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class ChannelBindingCampaignCron {
  private readonly logger = new Logger(ChannelBindingCampaignCron.name);

  private static readonly REMINDER_AFTER_DAYS = 3;
  private static readonly LOCAL_HOUR = 9;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 9 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'notifications.binding_campaign.enabled',
      'NOTIFICATIONS_BINDING_CAMPAIGN_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'channel-binding-campaign.cron: notifications.binding_campaign.enabled=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'channel-binding-campaign.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'channel-binding-campaign.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    invited: number;
    reminded: number;
    bound: number;
    skippedOutsideWindow: number;
    skippedAlreadyBound: number;
    errors: number;
  }> {
    const persons = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        userId: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        name: true,
        timezone: true,
        channelBindingCampaignState: true,
        channelBindingInvitedAt: true,
      },
      take: 5_000,
    });

    let invited = 0;
    let reminded = 0;
    let bound = 0;
    let skippedOutsideWindow = 0;
    let skippedAlreadyBound = 0;
    let errors = 0;

    for (const p of persons) {
      if (!p.userId) continue;

      if (p.channelBindingCampaignState === 'bound') {
        skippedAlreadyBound++;
        continue;
      }

      const hasTelegram = await this.hasVerifiedTelegram({
        tenantId: p.tenantId,
        userId: p.userId,
      });

      if (hasTelegram) {
        if (p.channelBindingCampaignState !== 'bound') {
          await this.prisma.person.update({
            where: { id: p.id },
            data: { channelBindingCampaignState: 'bound' },
          });
          bound++;
        }
        continue;
      }

      const localHour = getLocalHour(now, p.timezone);
      if (localHour !== ChannelBindingCampaignCron.LOCAL_HOUR) {
        skippedOutsideWindow++;
        continue;
      }

      const tenantTop = resolveOperationsTenantTop(p.tenantId);

      try {
        if (p.channelBindingCampaignState == null) {
          await this.sendInvite({
            tenantId: p.tenantId,
            userId: p.userId,
            name: p.name,
            isReminder: false,
          });
          await this.prisma.person.update({
            where: { id: p.id },
            data: {
              channelBindingCampaignState: 'invited',
              channelBindingInvitedAt: now,
            },
          });
          this.metrics.incChannelBindingCampaignInvited({ tenantTop });
          invited++;
        } else if (
          p.channelBindingCampaignState === 'invited' &&
          this.isReminderDue(p.channelBindingInvitedAt, now)
        ) {
          await this.sendInvite({
            tenantId: p.tenantId,
            userId: p.userId,
            name: p.name,
            isReminder: true,
          });
          await this.prisma.person.update({
            where: { id: p.id },
            data: { channelBindingCampaignState: 'reminded' },
          });
          this.metrics.incChannelBindingCampaignInvited({ tenantTop });
          reminded++;
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            personId: p.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'channel-binding-campaign.cron: ошибка отправки приглашения',
        );
      }
    }

    return {
      invited,
      reminded,
      bound,
      skippedOutsideWindow,
      skippedAlreadyBound,
      errors,
    };
  }

  private async hasVerifiedTelegram(args: { tenantId: string; userId: string }): Promise<boolean> {
    const binding = await this.prisma.channelBinding.findFirst({
      where: {
        userId: args.userId,
        verifiedAt: { not: null },
        channel: {
          kind: 'telegram_bot',
          OR: [{ tenantId: args.tenantId }, { tenantId: null }],
        },
      },
      select: { id: true },
    });
    return binding !== null;
  }

  private isReminderDue(invitedAt: Date | null, now: Date): boolean {
    if (!invitedAt) return false;
    const ageMs = now.getTime() - invitedAt.getTime();
    return ageMs >= ChannelBindingCampaignCron.REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000;
  }

  private async sendInvite(args: {
    tenantId: string;
    userId: string;
    name: string;
    isReminder: boolean;
  }): Promise<void> {
    const firstName = args.name.split(' ')[0] || args.name;
    const text = args.isReminder
      ? `Напоминаем, ${firstName}: подключите бота Коры в Telegram, чтобы получать ` +
        `утренний и вечерний чек-ин, напоминания и ответы прямо в чат. ` +
        `Привязка канала — в настройках профиля, раздел «Каналы связи».`
      : `${firstName}, подключите бота Коры в Telegram — так чек-ины, ` +
        `напоминания и ответы будут приходить прямо в чат, без захода в кабинет. ` +
        `Привязать канал можно в настройках профиля, раздел «Каналы связи».`;

    await this.conversational.sendNotification({
      tenantId: args.tenantId,
      recipientUserId: args.userId,
      eventType: 'system.message',
      priorityTier: 1,
      payload: {
        kind: 'system',
        title: 'Подключите Telegram-бота Коры',
        body: text,
      },
      dataClass: 'internal',
    });
  }
}

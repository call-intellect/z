import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * TZ-1 Фаза 0 (daily-value-engine) — ChannelBindingCampaignCron.
 *
 * Раз в день (`@Cron('0 9 * * *')`, тик каждый день в 09:00 серверного
 * времени; фактическое окно — локальные 9:00 каждого Person'а через
 * `Person.timezone`) обходит сотрудников и ведёт кампанию привязки канала
 * (Telegram-бот):
 *
 *   - Person ещё не приглашён (`channelBindingCampaignState` IS NULL) и нет
 *     verified telegram-binding → отправляем приглашение, ставим `'invited'`.
 *   - Приглашён `> 3 дней` назад и всё ещё нет binding'а → отправляем
 *     напоминание, ставим `'reminded'`.
 *   - Появился verified telegram-binding → ставим `'bound'` (терминальное).
 *
 * Доставка приглашения — `ConversationalService.sendNotification(eventType=
 * 'system.message', priorityTier=1)`. priorityTier=1 → обходит дневной
 * бюджет/тихие часы (онбординг-приглашение важнее лимита).
 *
 * Master-flag `notifications.binding_campaign.enabled` (kill-switch, ON по
 * умолчанию). False → cron тикает, но сразу выходит (без рестарта).
 *
 * Идемпотентность: per-day окно (локальные 9:00) + state-машина гарантируют,
 * что одному человеку не уйдёт два приглашения/напоминания в один день.
 */
@Injectable()
export class ChannelBindingCampaignCron {
  private readonly logger = new Logger(ChannelBindingCampaignCron.name);

  /** Сколько дней ждать после приглашения перед напоминанием. */
  private static readonly REMINDER_AFTER_DAYS = 3;
  /** Локальный час окна кампании (9:00). */
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

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
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

      // Уже терминально привязан — пропускаем (не дёргаем БД лишний раз).
      if (p.channelBindingCampaignState === 'bound') {
        skippedAlreadyBound++;
        continue;
      }

      const hasTelegram = await this.hasVerifiedTelegram({
        tenantId: p.tenantId,
        userId: p.userId,
      });

      // Появилась привязка → переводим в bound (терминальное состояние).
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

      // Окно: локальные 9:00 Person'а.
      const localHour = getLocalHour(now, p.timezone);
      if (localHour !== ChannelBindingCampaignCron.LOCAL_HOUR) {
        skippedOutsideWindow++;
        continue;
      }

      const tenantTop = resolveOperationsTenantTop(p.tenantId);

      try {
        if (p.channelBindingCampaignState == null) {
          // Первое приглашение.
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
          // Напоминание спустя REMINDER_AFTER_DAYS.
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
        // 'reminded' и ещё-не-наступившее напоминание — ничего не делаем.
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

  /** Есть ли у пользователя verified telegram-binding в этой Org. */
  private async hasVerifiedTelegram(args: {
    tenantId: string;
    userId: string;
  }): Promise<boolean> {
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

  /** Прошло ли ≥ REMINDER_AFTER_DAYS с момента приглашения. */
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
      // priorityTier=1 → обходит дневной бюджет и тихие часы (онбординг важнее).
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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { PersonalDailyBriefService } from '../services/personal-daily-brief.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class PersonalDailyBriefCron {
  private readonly logger = new Logger(PersonalDailyBriefCron.name);

  private static readonly DEFAULT_MORNING_HOUR = 9;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PersonalDailyBriefService)
    private readonly briefs: PersonalDailyBriefService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.personal_daily_brief.enabled',
      'OPERATIONS_PERSONAL_DAILY_BRIEF_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'personal-daily-brief.cron: operations.personal_daily_brief.enabled=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'personal-daily-brief.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'personal-daily-brief.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    briefsBuilt: number;
    delivered: number;
    skippedOutsideWindow: number;
    skippedEmpty: number;
    skippedAlreadyDelivered: number;
    errors: number;
  }> {
    const morningHour = await this.resolveMorningHour();

    const persons = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        userId: { not: null },
      },
      select: { id: true, tenantId: true, userId: true, timezone: true },
      take: 5_000,
    });

    let briefsBuilt = 0;
    let delivered = 0;
    let skippedOutsideWindow = 0;
    let skippedEmpty = 0;
    let skippedAlreadyDelivered = 0;
    let errors = 0;

    for (const p of persons) {
      if (!p.userId) continue;
      const localHour = getLocalHour(now, p.timezone);
      if (localHour !== morningHour) {
        skippedOutsideWindow++;
        continue;
      }
      const dateLocal = getLocalDate(now, p.timezone);
      const tenantTop = resolveOperationsTenantTop(p.tenantId);

      try {
        const payload = await this.briefs.buildFor({
          tenantId: p.tenantId,
          personId: p.id,
          dateLocal,
        });
        const { id, alreadyDelivered } = await this.briefs.upsert({
          tenantId: p.tenantId,
          personId: p.id,
          dateLocal,
          payload,
        });
        briefsBuilt++;

        if (alreadyDelivered) {
          skippedAlreadyDelivered++;
          continue;
        }
        if (!this.briefs.hasContent(payload)) {
          skippedEmpty++;
          continue;
        }

        await this.conversational.sendNotification({
          tenantId: p.tenantId,
          recipientUserId: p.userId,
          eventType: 'proactive.notification',
          priorityTier: 2,
          payload: {
            proactiveNotificationId: id,
            ruleType: 'personal_daily_brief',
            severity: 'low',
            title: 'Твой день',
            body: this.buildPushBody(payload),
            actionUrl: '/me/daily-brief',
          },
          dataClass: 'internal',
        });
        await this.briefs.markDelivered(id);
        this.metrics.incPersonalDailyBriefDelivered({ channel: 'push' });
        delivered++;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            personId: p.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'personal-daily-brief.cron: ошибка по Person',
        );
      }
    }

    return {
      briefsBuilt,
      delivered,
      skippedOutsideWindow,
      skippedEmpty,
      skippedAlreadyDelivered,
      errors,
    };
  }

  private buildPushBody(payload: {
    counts: { tasks: number; promises: number; blockers: number; promisedToMe: number };
    hint: string;
  }): string {
    const parts: string[] = [];
    if (payload.counts.tasks > 0) parts.push(`задач: ${payload.counts.tasks}`);
    if (payload.counts.promises > 0) parts.push(`обещаний: ${payload.counts.promises}`);
    if (payload.counts.blockers > 0) parts.push(`блокеров: ${payload.counts.blockers}`);
    if (payload.counts.promisedToMe > 0) parts.push(`обещано тебе: ${payload.counts.promisedToMe}`);
    const summary = parts.length > 0 ? `Сегодня: ${parts.join(', ')}.` : '';
    const hint = payload.hint ? ` ${payload.hint}` : '';
    return `${summary}${hint}`.trim().slice(0, 4_000) || 'Твой день готов.';
  }

  private async resolveMorningHour(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'operations.personal_daily_brief.morning_hour',
      'OPERATIONS_PERSONAL_DAILY_BRIEF_MORNING_HOUR',
      PersonalDailyBriefCron.DEFAULT_MORNING_HOUR,
    );
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 23
      ? Math.floor(v)
      : PersonalDailyBriefCron.DEFAULT_MORNING_HOUR;
  }
}

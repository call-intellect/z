import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { MonthlyDigestService } from '../services/monthly-digest.service';
import { shiftPeriod } from '../services/value-recap.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export function formatPeriodRu(periodYm: string): string {
  const [yearStr, monthStr] = periodYm.split('-');
  const monthIdx = Number(monthStr) - 1;
  const name = MONTHS_RU[monthIdx] ?? monthStr ?? periodYm;
  return `${name} ${yearStr ?? ''}`.trim();
}

@Injectable()
export class OperationsMonthlyDigestCron {
  private readonly logger = new Logger(OperationsMonthlyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MonthlyDigestService)
    private readonly digestService: MonthlyDigestService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.monthlyDigestEnabled) {
      this.logger.debug('operations-monthly-digest.cron: COO_MONTHLY_DIGEST_ENABLED=false, skip');
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.debug(stats, 'operations-monthly-digest.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'operations-monthly-digest.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    notificationsSent: number;
    skippedOutsideWindow: number;
    errors: number;
  }> {
    const tz = 'Europe/Moscow';
    const localDate = getLocalDate(now, tz);
    const localHour = getLocalHour(now, tz);
    const targetHour = this.cfg.betaOps.monthlyDigestLocalHour;

    if (localDate.slice(8, 10) !== '01' || localHour !== targetHour) {
      return {
        digestsGenerated: 0,
        digestsSkippedAlreadyExists: 0,
        notificationsSent: 0,
        skippedOutsideWindow: 1,
        errors: 0,
      };
    }

    const currentPeriodYm = localDate.slice(0, 7);
    const periodYm = shiftPeriod(currentPeriodYm, -1);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);

      const existing = await this.digestService.getStored({
        tenantId: org.id,
        periodYm,
      });
      if (existing && existing.deliveredAt) {
        digestsSkippedAlreadyExists++;
        continue;
      }

      try {
        const digest =
          existing ?? (await this.digestService.getOrGenerate({ tenantId: org.id, periodYm }));
        if (!existing) digestsGenerated++;

        if (!digest.deliveredAt) {
          notificationsSent += await this.notifyRecipients({
            tenantId: org.id,
            digestId: digest.id,
            periodYm,
            tenantTop,
          });
          await this.digestService.markDelivered({ tenantId: org.id, periodYm });
        }
      } catch (err) {
        errors++;
        this.metrics.incCooMonthlyDigestFailed({ tenantTop, reason: 'exception' });
        this.logger.warn(
          {
            tenantId: org.id,
            periodYm,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-monthly-digest.cron: ошибка генерации/доставки',
        );
      }
    }

    return {
      digestsGenerated,
      digestsSkippedAlreadyExists,
      notificationsSent,
      skippedOutsideWindow: 0,
      errors,
    };
  }

  private async notifyRecipients(args: {
    tenantId: string;
    digestId: string;
    periodYm: string;
    tenantTop: string;
  }): Promise<number> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'coo'] },
      },
      select: { userId: true },
    });
    if (memberships.length === 0) return 0;

    const title = `Месяц компании ${formatPeriodRu(args.periodYm)}`;
    const body =
      'Готов месячный брифинг: вердикт по 4 осям, тренд осей по неделям, письмо «как прошёл месяц», компас к цели и темп, что решить и фокус на следующий месяц. Открой «Месяц компании».';
    const actionUrl = '/month';

    let sent = 0;
    for (const m of memberships) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'operations.monthly_digest',
          payload: {
            digestId: args.digestId,
            periodYm: args.periodYm,
            title,
            body,
            actionUrl,
          },
          dataClass: 'internal',
        });
        sent++;
        this.metrics.incCooMonthlyDigestDelivered({
          tenantTop: args.tenantTop,
          channel: 'conversational',
        });
      } catch (err) {
        this.metrics.incCooMonthlyDigestFailed({
          tenantTop: args.tenantTop,
          reason: 'notify_failed',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-monthly-digest.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }
}
